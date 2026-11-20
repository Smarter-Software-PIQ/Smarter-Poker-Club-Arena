-- 20261119180500_sustained_hand_delay_alerts_and_cadence_grading.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- SUSTAINED HAND-DELAY ALERTS (15 MINUTES, ONCE ON OPEN AND ONCE ON CLEAR)
-- AND CADENCE RECORDING FOR CASH BUSTS & RUN-IT-MULTIPLE HANDS
-- (incident 075013fd, lane 3).
--
-- WHAT WAS TRUE (from 20261119052955):
--   1. fn_ca_hand_gap_watch opened a critical financial_alerts row after 2
--      consecutive 5-minute windows (10 minutes), and when it auto-resolved
--      that row it emitted no owner clear notification.
--   2. Cash-bust hands (variable <= 5 s rebuy pause) and run-it-multiple hands
--      (rit_boards) were recorded as shapes 'cash_bust' and 'rit' but never
--      graded because the engine did not persist the actual pause times it
--      held between hands.
--
-- WHAT THIS CHANGES:
--   1. Adds nullable `cadence jsonb` (no default -> PG 11+ metadata-only
--      instant, lock_timeout = 3s) to public.hand_history. The engine writes
--      the prior hand's measured between-hand pause times on the NEXT hand's
--      row: {"hold_ms":..,"rest_ms":..,"rebuy_pause_ms":..,"rit_reveal_ms":..}.
--   2. Updates fn_ca_hand_gap_unintended_delay (STABLE, bounded indexed reads)
--      to match scripts/sql/hand-gap-unintended-delay.sql: cash_bust and rit
--      hands whose NEXT hand carries recorded cadence are graded accurately
--      (rebuy_pause_ms clamped to 5000 ms, rit_reveal_ms clamped to 30000 ms
--      so an engine hang cannot excuse itself), while legacy rows without
--      cadence remain safely ungraded.
--   3. Updates fn_ca_hand_gap_watch so a sustained unintended delay lasting
--      15 minutes (3 consecutive 5-minute windows: v_end, v_end - 5m,
--      v_end - 10m, each with >= 5 graded hands and p95 > budget) opens ONE
--      critical financial_alerts row per kind x shape and notifies senior
--      platform recipients ONCE via fn_raise_notification; when the alert
--      clears (auto-resolved), it notifies senior platform recipients ONCE
--      again. Deduplicated across further breaching windows and re-runs.
--      Existing cron job hand-gap-unintended-delay-watch-5m continues calling
--      select public.fn_ca_hand_gap_watch() every 5 minutes (no new job).
--
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.hand_history'::regclass AND a.attname = 'cadence' AND NOT a.attisdropped AND NOT a.attnotnull) AND position('rebuy_pause_max_ms' in pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)) > 0 AND position('rit_reveal_max_ms' in pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)) > 0 AND position('v_prev2' in pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure)) > 0 AND position('Hand Delay Cleared' in pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure)) > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Nullable column with no default: metadata-only instant in PostgreSQL 11+.
ALTER TABLE public.hand_history ADD COLUMN IF NOT EXISTS cadence jsonb;

COMMENT ON COLUMN public.hand_history.cadence IS
  'Actual between-hand pause times measured after the prior hand on this table (hold_ms, rest_ms, rebuy_pause_ms, and rit_reveal_ms for run-it-multiple hands), written on the NEXT hand so fn_ca_hand_gap_unintended_delay grades cash_bust and rit hands. NULL on first/legacy hands. Incident 075013fd lane 3.';

CREATE OR REPLACE FUNCTION public.fn_ca_hand_gap_unintended_delay(p_window_end timestamptz, p_minutes int DEFAULT 5)
RETURNS TABLE (kind text, shape text, graded boolean, hands int, gap_p50_ms int, owed_p50_ms int,
               unintended_p50_ms int, unintended_p95_ms int, unintended_p99_ms int,
               over_budget int, budget_ms int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $g$
WITH k AS (
  -- Pinned equal to src/config/handCompletionSpec.ts and to
  -- scripts/sql/hand-gap-unintended-delay.sql by
  -- tests/hand-gap-watch-pages-on-unintended-delay.law.test.ts.
  SELECT 500 AS bets_sweep_ms, 1100 AS pot_push_ms, 250 AS muck_ms,
         1400 AS showdown_read_base_ms, 350 AS showdown_read_per_extra_hand_ms,
         2200 AS showdown_read_max_ms, 1500 AS winning_cards_extra_ms,
         2000 AS all_in_showdown_extra_ms, 900 AS pot_award_stagger_ms,
         1500 AS next_hand_rest_ms, 250 AS engine_between_hands_budget_ms,
         5000 AS rebuy_pause_max_ms, 30000 AS rit_reveal_max_ms
),
nx AS (
  -- The NEXT hands: written inside the window. created_at is stamped at the
  -- end of the hand, so the pair (previous, next) belongs to exactly one window.
  SELECT n.id, n.table_id, n.started_at, n.created_at, n.cadence AS next_cadence
    FROM hand_history n
   WHERE n.created_at >= p_window_end - make_interval(mins => least(greatest(p_minutes, 1), 15))
     AND n.created_at <  p_window_end
     AND n.table_id IS NOT NULL
),
pair AS (
  SELECT p.*, nx.started_at AS next_start, nx.next_cadence
    FROM nx
    CROSS JOIN LATERAL (
      SELECT hh.id, hh.tournament_id, hh.ended_at, hh.actions, hh.players, hh.pots, hh.rit_boards,
             CASE WHEN jsonb_typeof(hh.showdown) = 'array' THEN hh.showdown ELSE '[]'::jsonb END AS shown
        FROM hand_history hh
       WHERE hh.table_id = nx.table_id
         AND hh.created_at < nx.created_at
         AND hh.created_at >= nx.created_at - interval '30 minutes'
       ORDER BY hh.created_at DESC
       LIMIT 1) p
   WHERE nx.started_at > p.ended_at
     AND nx.started_at - p.ended_at < interval '60 seconds'
     AND NOT EXISTS (SELECT 1 FROM lightning_hand lh WHERE lh.hand_history_id IN (nx.id, p.id))
     AND NOT EXISTS (SELECT 1 FROM engine_maintenance_break_log b
                      WHERE b.break_started_at < nx.started_at
                        AND b.break_started_at > p.ended_at - interval '30 minutes'
                        AND COALESCE(b.break_ended_at, 'infinity') > p.ended_at)
     AND NOT EXISTS (SELECT 1 FROM tournaments t
                      WHERE t.id = p.tournament_id AND t.break_started_at < nx.started_at
                        AND COALESCE(t.break_ends_at, 'infinity') > p.ended_at)
),
s AS MATERIALIZED (
  SELECT pair.*, extract(epoch FROM pair.next_start - pair.ended_at) * 1000 AS gap_ms,
         jsonb_array_length(pair.shown) AS shown_n,
         EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a
                 WHERE a->>'stage' = 'river' AND coalesce((a->>'amount')::numeric, 0) > 0
                   AND a->>'action' <> 'return') AS river_chips,
         EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a, jsonb_array_elements(pair.shown) sd
                 WHERE a->>'action' = 'all_in' AND a->>'userId' = sd->>'user_id') AS all_in_shown,
         GREATEST(1, (SELECT count(*) FROM jsonb_array_elements(coalesce(pair.pots, '[]'::jsonb)) p,
                             jsonb_array_elements(coalesce(p->'awards', '[]'::jsonb)) aw
                      WHERE coalesce((aw->>'amount')::numeric, 0) > 0)) AS award_groups,
         EXISTS (SELECT 1 FROM jsonb_array_elements(pair.players) pl
                 WHERE coalesce((pl->>'stack')::numeric, 1) = 0) AS someone_busted,
         (jsonb_typeof(pair.next_cadence) = 'object'
          AND (pair.next_cadence->>'hold_ms') ~ '^\d+(\.\d+)?$'
          AND (pair.next_cadence->>'rest_ms') ~ '^\d+(\.\d+)?$'
          AND (pair.next_cadence->>'rebuy_pause_ms') ~ '^\d+(\.\d+)?$'
          AND (pair.rit_boards IS NULL OR (pair.next_cadence->>'rit_reveal_ms') ~ '^\d+(\.\d+)?$')) AS has_cadence
  FROM pair
),
shaped AS (
  SELECT s.tournament_id IS NOT NULL AS tournament, s.gap_ms,
    CASE WHEN s.rit_boards IS NOT NULL THEN 'rit'
         WHEN s.tournament_id IS NULL AND s.someone_busted THEN 'cash_bust'
         WHEN s.shown_n < 2 THEN 'fold'
         WHEN s.all_in_shown THEN 'all_in_showdown'
         WHEN s.river_chips THEN 'showdown_river_chips'
         ELSE 'showdown_checked_river' END AS shape,
    ((s.rit_boards IS NULL AND NOT (s.tournament_id IS NULL AND s.someone_busted)) OR s.has_cadence) AS row_graded,
    -- owedBetweenHandsMs for the shape (hold + max(rest, rebuy_pause)).
    CASE WHEN s.rit_boards IS NOT NULL AND s.has_cadence THEN
           least(k.rit_reveal_max_ms, greatest(0, (s.next_cadence->>'rit_reveal_ms')::numeric))
           + k.bets_sweep_ms + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
           + CASE WHEN s.all_in_shown THEN k.all_in_showdown_extra_ms ELSE 0 END
           + greatest(
               k.next_hand_rest_ms,
               CASE WHEN s.tournament_id IS NULL AND s.someone_busted
                    THEN least(k.rebuy_pause_max_ms, greatest(0, (s.next_cadence->>'rebuy_pause_ms')::numeric))
                    ELSE 0 END)
         ELSE
           CASE WHEN s.shown_n < 2 THEN
                  k.bets_sweep_ms + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
                ELSE
                  least(k.showdown_read_max_ms, k.showdown_read_base_ms + greatest(0, s.shown_n - 2) * k.showdown_read_per_extra_hand_ms)
                  + greatest(CASE WHEN s.all_in_shown THEN k.all_in_showdown_extra_ms ELSE 0 END, k.winning_cards_extra_ms)
                  + CASE WHEN s.river_chips THEN k.bets_sweep_ms ELSE 0 END
                  + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
           END
           + greatest(
               k.next_hand_rest_ms,
               CASE WHEN s.tournament_id IS NULL AND s.someone_busted AND s.has_cadence
                    THEN least(k.rebuy_pause_max_ms, greatest(0, (s.next_cadence->>'rebuy_pause_ms')::numeric))
                    ELSE 0 END)
    END AS owed_ms,
    k.engine_between_hands_budget_ms AS budget_ms
  FROM s CROSS JOIN k
)
SELECT CASE WHEN tournament THEN 'tournament' ELSE 'cash' END AS kind, shape,
       count(*) FILTER (WHERE row_graded) > 0 AS graded,
       CASE WHEN count(*) FILTER (WHERE row_graded) > 0
            THEN count(*) FILTER (WHERE row_graded)::int
            ELSE count(*)::int END AS hands,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms) END)::int AS gap_p50_ms,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY owed_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.5) WITHIN GROUP (ORDER BY owed_ms) END)::int AS owed_p50_ms,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms - owed_ms) END)::int AS unintended_p50_ms,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) END)::int AS unintended_p95_ms,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_ms - owed_ms) END)::int AS unintended_p99_ms,
       CASE WHEN count(*) FILTER (WHERE row_graded) = 0 THEN NULL
            ELSE count(*) FILTER (WHERE row_graded AND gap_ms - owed_ms > budget_ms)::int END AS over_budget,
       min(budget_ms)::int AS budget_ms
  FROM shaped
 GROUP BY 1, 2
 ORDER BY 1, 2
$g$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;

COMMENT ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) IS
  'Read-only grade of scripts/sql/hand-gap-unintended-delay.sql for one window: per kind x shape p50/p95/p99 unintended delay between hands and over-budget count, grading cash_bust and rit hands when hand_history.cadence is recorded. Incident 075013fd lane 3.';

CREATE OR REPLACE FUNCTION public.fn_ca_hand_gap_watch(p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
SET lock_timeout TO '2s'
AS $f$
DECLARE
  c_source   constant text     := 'fn_ca_hand_gap_watch';
  c_minutes  constant int      := 5;
  c_windows  constant int      := 3;   -- 15 minutes = 3 consecutive 5-minute windows
  c_min_n    constant int      := 5;   -- graded hands a window needs before its p95 counts
  c_quiet    constant interval := interval '30 minutes';
  c_keep     constant interval := interval '30 days';
  v_end      timestamptz := date_trunc('hour', p_at)
                            + floor(extract(minute FROM p_at) / 5) * interval '5 minutes';
  v_prev1    timestamptz := v_end - interval '5 minutes';
  v_prev2    timestamptz := v_end - interval '10 minutes';
  v_recorded int := 0; v_breaching int := 0; v_new int := 0; v_resolved int := 0;
  v_notified_open int := 0; v_notified_clear int := 0;
  v_can_notify boolean := to_regprocedure('public.fn_raise_notification(uuid,text,text,text,text,jsonb)') IS NOT NULL
                      AND to_regclass('public.ca_incident_recipients') IS NOT NULL;
  v_alert_id uuid;
  v_rec uuid;
  r record;
  res record;
BEGIN
  INSERT INTO ca_hand_gap_watch_history AS h
         (window_end, window_minutes, kind, shape, graded, hands, gap_p50_ms, owed_p50_ms,
          unintended_p50_ms, unintended_p95_ms, unintended_p99_ms, over_budget, budget_ms)
  SELECT v_end, c_minutes, g.kind, g.shape, g.graded, g.hands, g.gap_p50_ms, g.owed_p50_ms,
         g.unintended_p50_ms, g.unintended_p95_ms, g.unintended_p99_ms, g.over_budget, g.budget_ms
    FROM fn_ca_hand_gap_unintended_delay(v_end, c_minutes) g
  ON CONFLICT (window_end, kind, shape) DO NOTHING;
  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  -- Resolve (CLEAR): the shape's latest window with enough graded hands is back
  -- under the budget, or the shape has had no such window for 30 minutes.
  -- Notify senior platform recipients ONCE per cleared alert.
  FOR res IN
    WITH done AS (
      UPDATE financial_alerts fa
         SET resolved = true, resolved_at = now(),
             resolution = CASE WHEN l.kind IS NULL
               THEN 'no graded windows with >= ' || c_min_n || ' hands for 30 minutes for '
                    || COALESCE(fa.context->>'kind', '?') || ' ' || COALESCE(fa.context->>'shape', '?')
               ELSE 'unintended p95 back within the ' || l.budget_ms || ' ms budget for ' || l.kind || ' ' || l.shape
             END
        FROM (SELECT DISTINCT ON (fa2.id) fa2.id, x.kind, x.shape, x.budget_ms, x.unintended_p95_ms
                FROM financial_alerts fa2
                LEFT JOIN ca_hand_gap_watch_history x
                  ON x.kind = fa2.context->>'kind' AND x.shape = fa2.context->>'shape'
                 AND x.graded AND x.hands >= c_min_n
                 AND x.window_end > v_end - c_quiet AND x.window_end <= v_end
               WHERE fa2.source = c_source AND NOT fa2.resolved
               ORDER BY fa2.id, x.window_end DESC NULLS LAST) l
       WHERE fa.id = l.id
         AND (l.kind IS NULL OR l.unintended_p95_ms <= l.budget_ms)
      RETURNING fa.id,
                COALESCE(fa.context->>'kind', l.kind, '?') AS kind,
                COALESCE(fa.context->>'shape', l.shape, '?') AS shape,
                l.unintended_p95_ms,
                COALESCE(l.budget_ms, (fa.context->>'budget_ms')::int, 250) AS budget_ms,
                (l.kind IS NULL) AS quiet_timeout)
    SELECT * FROM done
  LOOP
    v_resolved := v_resolved + 1;
    IF v_can_notify THEN
      BEGIN
        FOR v_rec IN
          SELECT DISTINCT rec.user_id FROM public.ca_incident_recipients rec
           WHERE rec.scope = 'platform' AND rec.active AND rec.senior AND rec.user_id IS NOT NULL
        LOOP
          PERFORM public.fn_raise_notification(
            v_rec,
            'system',
            'Hand Delay Cleared',
            CASE WHEN res.quiet_timeout
              THEN res.kind || ' ' || res.shape || ' unintended hand delay cleared (no breaching windows for 30 minutes).'
              ELSE res.kind || ' ' || res.shape || ' unintended hand delay cleared (p95 '
                   || res.unintended_p95_ms || ' ms, back within the ' || res.budget_ms || ' ms budget).'
            END,
            '/hub/club-arena',
            jsonb_build_object(
              'source', c_source, 'event', 'cleared', 'alert_id', res.id,
              'kind', res.kind, 'shape', res.shape, 'window_end', v_end,
              'unintended_p95_ms', res.unintended_p95_ms, 'budget_ms', res.budget_ms,
              'quiet_timeout', res.quiet_timeout));
          v_notified_clear := v_notified_clear + 1;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_ca_hand_gap_watch clear notification failed for %: %', res.id, SQLERRM;
      END;
    END IF;
  END LOOP;

  -- Open: sustained unintended delay lasting 15 minutes (3 consecutive 5-minute
  -- windows: v_end, v_prev1, v_prev2), each with >= 5 graded hands and p95 > budget.
  -- Raises ONE critical financial_alerts row and notifies senior platform recipients ONCE.
  FOR r IN
    SELECT cur.*,
           prev1.unintended_p95_ms AS prev1_p95_ms, prev1.hands AS prev1_hands,
           prev2.unintended_p95_ms AS prev2_p95_ms, prev2.hands AS prev2_hands
      FROM ca_hand_gap_watch_history cur
      JOIN ca_hand_gap_watch_history prev1
        ON prev1.window_end = v_prev1 AND prev1.kind = cur.kind AND prev1.shape = cur.shape
      JOIN ca_hand_gap_watch_history prev2
        ON prev2.window_end = v_prev2 AND prev2.kind = cur.kind AND prev2.shape = cur.shape
     WHERE cur.window_end = v_end
       AND cur.graded   AND cur.hands   >= c_min_n AND cur.unintended_p95_ms   > cur.budget_ms
       AND prev1.graded AND prev1.hands >= c_min_n AND prev1.unintended_p95_ms > prev1.budget_ms
       AND prev2.graded AND prev2.hands >= c_min_n AND prev2.unintended_p95_ms > prev2.budget_ms
     ORDER BY cur.unintended_p95_ms DESC, cur.kind, cur.shape
  LOOP
    v_breaching := v_breaching + 1;
    CONTINUE WHEN EXISTS (SELECT 1 FROM financial_alerts fa
                           WHERE fa.source = c_source AND NOT fa.resolved
                             AND fa.context->>'kind' = r.kind AND fa.context->>'shape' = r.shape);
    INSERT INTO financial_alerts (severity, source, message, context)
    VALUES ('critical', c_source,
            'Unintended delay between hands: for three consecutive 5-minute windows (15 minutes), the p95 of the gap between hands beyond the beats the hand is owed is over the engine budget. Something the engine waits on between hands is not an intended animation or pause.',
            jsonb_build_object(
              'kind', r.kind, 'shape', r.shape, 'window_end', r.window_end, 'window_minutes', r.window_minutes,
              'consecutive_windows', c_windows, 'sustained_minutes', c_windows * c_minutes,
              'hands', r.hands, 'gap_p50_ms', r.gap_p50_ms, 'owed_p50_ms', r.owed_p50_ms,
              'unintended_p50_ms', r.unintended_p50_ms, 'unintended_p95_ms', r.unintended_p95_ms,
              'unintended_p99_ms', r.unintended_p99_ms, 'over_budget', r.over_budget,
              'budget_ms', r.budget_ms,
              'previous_window_p95_ms', r.prev1_p95_ms, 'previous_window_hands', r.prev1_hands,
              'two_windows_ago_p95_ms', r.prev2_p95_ms, 'two_windows_ago_hands', r.prev2_hands,
              'grade', 'scripts/sql/hand-gap-unintended-delay.sql',
              'history', 'ca_hand_gap_watch_history'))
    RETURNING id INTO v_alert_id;
    v_new := v_new + 1;

    IF v_can_notify THEN
      BEGIN
        FOR v_rec IN
          SELECT DISTINCT rec.user_id FROM public.ca_incident_recipients rec
           WHERE rec.scope = 'platform' AND rec.active AND rec.senior AND rec.user_id IS NOT NULL
        LOOP
          PERFORM public.fn_raise_notification(
            v_rec,
            'system',
            'Unintended Delay Between Hands',
            r.kind || ' ' || r.shape || ' hands have been delayed for ' || (c_windows * c_minutes)
              || ' minutes (p95 +' || r.unintended_p95_ms || ' ms over the ' || r.budget_ms
              || ' ms budget across ' || c_windows || ' consecutive 5-minute windows).',
            '/hub/club-arena',
            jsonb_build_object(
              'source', c_source, 'event', 'opened', 'alert_id', v_alert_id,
              'kind', r.kind, 'shape', r.shape, 'window_end', r.window_end,
              'unintended_p95_ms', r.unintended_p95_ms,
              'previous_window_p95_ms', r.prev1_p95_ms,
              'two_windows_ago_p95_ms', r.prev2_p95_ms,
              'budget_ms', r.budget_ms,
              'sustained_minutes', c_windows * c_minutes,
              'consecutive_windows', c_windows));
          v_notified_open := v_notified_open + 1;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_ca_hand_gap_watch open notification failed for %: %', v_alert_id, SQLERRM;
      END;
    END IF;
  END LOOP;

  DELETE FROM ca_hand_gap_watch_history WHERE window_end < v_end - c_keep;

  RETURN jsonb_build_object(
    'window_end', v_end, 'recorded', v_recorded, 'breaching', v_breaching,
    'opened', v_new, 'resolved', v_resolved,
    'notified_open', v_notified_open, 'notified_clear', v_notified_clear,
    'checked_at', now());
END
$f$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_watch(timestamptz) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_ca_hand_gap_watch(timestamptz) IS
  'Detector (not a repair): records the 5-minute unintended-delay grade per kind x shape into ca_hand_gap_watch_history, raises one critical financial_alerts row and notifies senior platform recipients ONCE per kind x shape whose p95 is over budget for 15 minutes (3 consecutive 5-minute windows, >= 5 graded hands each), and notifies ONCE again when it clears. Incident 075013fd lane 3.';

-- Runs the new body once against the live window and undoes it, so a body
-- that cannot run never commits.
-- @probe-for: public.fn_ca_hand_gap_watch
DO $probe$
BEGIN
  PERFORM public.fn_ca_hand_gap_watch();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
