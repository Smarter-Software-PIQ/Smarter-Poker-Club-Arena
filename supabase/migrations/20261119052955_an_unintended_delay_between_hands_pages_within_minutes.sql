-- 20261119052955_an_unintended_delay_between_hands_pages_within_minutes.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- AN UNINTENDED DELAY BETWEEN HANDS PAGES WITHIN MINUTES (incident 075013fd,
-- lane E5). Dan 2026-11-18: "i just don't want any 'un intended delays'".
--
-- WHAT WAS TRUE. scripts/sql/hand-gap-unintended-delay.sql grades every hand's
-- gap (next started_at - ended_at) against the beats its shape is owed
-- (owedBetweenHandsMs) plus ENGINE_BETWEEN_HANDS_BUDGET_MS, but only when
-- someone runs it. Nothing watched it, so a delay the engine adds between
-- hands was found by a person looking, hours later, or by Dan at the table.
--
-- WHAT THIS ADDS. A DETECTOR, not a repair (CLAUDE.md 10.11/10.12): it reads
-- hand_history, writes its own history rows and financial_alerts rows, and
-- nothing else. It touches no money and no table, and re-drives nothing.
--
--   fn_ca_hand_gap_unintended_delay(window_end, minutes): STABLE. The same
--   grade as the script, for the hands whose NEXT hand on the same table was
--   written in [window_end - minutes, window_end) (minutes capped at 15), so
--   consecutive windows grade every pair exactly once. Per kind (cash /
--   tournament) x shape: hands, p50 gap, p50 owed, p50/p95/p99 unintended
--   delay, and how many hands were over the budget. Indexed reads only:
--   idx_hand_history_created for the window, idx_hand_history_table_created
--   for the previous hand on the table, idx_lightning_hand_hand_history_id,
--   engine_maintenance_break_log_pkey, the tournaments primary key.
--
--   Not graded, because the wait is intended or not knowable from the rows:
--     * gaps of 60 s or more (a pause, a break, a table that sat);
--     * Lightning hands (pooled hands share one host table_id), either side;
--     * a gap that overlaps a recorded maintenance break
--       (engine_maintenance_break_log) or the hand's tournament break
--       (tournaments.break_started_at .. break_ends_at);
--     * run-it-multiple hands: shape 'rit', recorded, never graded;
--     * cash hands where someone busted (the rebuy pause is not on the row):
--       shape 'cash_bust', recorded, never graded, never in over_budget.
--
--   ca_hand_gap_watch_history: one row per window x kind x shape, so a trend
--   is one SELECT. Kept 30 days (about 90K rows), trimmed by the watch on its
--   own primary key.
--
--   fn_ca_hand_gap_watch(), every 5 minutes (job hand-gap-unintended-delay-watch-5m,
--   at :01, :06, ... so the window that closed a minute ago is complete): records
--   the window that just closed, then raises ONE critical financial_alerts row
--   per kind x shape whose unintended p95 is over the budget in this window
--   AND the one before it, each with at least 5 graded hands. One open alert
--   per kind x shape (the guard reads context kind/shape), so a breach that
--   lasts an hour is one alert. The message is constant, so the incident
--   trigger (fn_ca_financial_alert_to_incident) folds every shape's alert
--   into ONE incident, which is the page. An open alert resolves when its
--   shape's latest window with enough hands is back under the budget, or
--   when the shape has had no such window for 30 minutes.
--
-- COST. EXPLAIN ANALYZE of the grading SELECT on production 2026-11-19
-- 05:30 UTC (read-only): 627 hands in the window, Index Scan on
-- idx_hand_history_created, per-hand Index Scan on
-- idx_hand_history_table_created (LIMIT 1), index-only lightning probe,
-- 11,316 shared buffers all hit, 56 ms. No new index, no DDL on any hot table.
--
-- periodic-work: a five-minute detector that only records its own grade and raises and resolves financial_alerts rows; it pays, re-drives, retries and repairs nothing, and is not the fix for any delay (those are the engine changes the alert points at); it exists so an unintended delay between hands pages within ten minutes with no human looking.
--
-- @live-proof: (SELECT to_regprocedure('public.fn_ca_hand_gap_watch(timestamp with time zone)') IS NOT NULL AND to_regprocedure('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)') IS NOT NULL AND to_regclass('public.ca_hand_gap_watch_history') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hand-gap-unintended-delay-watch-5m' AND active AND schedule = '1-59/5 * * * *' AND command = 'select public.fn_ca_hand_gap_watch()'))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.ca_hand_gap_watch_history (
  window_end         timestamptz NOT NULL,
  window_minutes     int         NOT NULL,
  kind               text        NOT NULL CHECK (kind IN ('cash', 'tournament')),
  shape              text        NOT NULL,
  graded             boolean     NOT NULL,
  hands              int         NOT NULL,
  gap_p50_ms         int,
  owed_p50_ms        int,
  unintended_p50_ms  int,
  unintended_p95_ms  int,
  unintended_p99_ms  int,
  over_budget        int,
  budget_ms          int         NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (window_end, kind, shape)
);

ALTER TABLE public.ca_hand_gap_watch_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_hand_gap_watch_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ca_hand_gap_watch_history TO service_role;

COMMENT ON TABLE public.ca_hand_gap_watch_history IS
  'One row per 5-minute window x kind x shape: the unintended delay between hands (gap - owed beats), from fn_ca_hand_gap_unintended_delay. Written only by fn_ca_hand_gap_watch. Incident 075013fd lane E5.';

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
         1500 AS next_hand_rest_ms, 250 AS engine_between_hands_budget_ms
),
nx AS (
  -- The NEXT hands: written inside the window. created_at is stamped at the
  -- end of the hand, so the pair (previous, next) belongs to exactly one window.
  SELECT n.id, n.table_id, n.started_at, n.created_at
    FROM hand_history n
   WHERE n.created_at >= p_window_end - make_interval(mins => least(greatest(p_minutes, 1), 15))
     AND n.created_at <  p_window_end
     AND n.table_id IS NOT NULL
),
pair AS (
  SELECT p.*, nx.started_at AS next_start
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
                 WHERE coalesce((pl->>'stack')::numeric, 1) = 0) AS someone_busted
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
    -- owedBetweenHandsMs for the shape (hold + rest).
    CASE WHEN s.shown_n < 2 THEN
           k.bets_sweep_ms + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
         ELSE
           least(k.showdown_read_max_ms, k.showdown_read_base_ms + greatest(0, s.shown_n - 2) * k.showdown_read_per_extra_hand_ms)
           + greatest(CASE WHEN s.all_in_shown THEN k.all_in_showdown_extra_ms ELSE 0 END, k.winning_cards_extra_ms)
           + CASE WHEN s.river_chips THEN k.bets_sweep_ms ELSE 0 END
           + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
    END + k.next_hand_rest_ms AS owed_ms,
    k.engine_between_hands_budget_ms AS budget_ms
  FROM s CROSS JOIN k
)
SELECT CASE WHEN tournament THEN 'tournament' ELSE 'cash' END AS kind, shape,
       shape NOT IN ('rit', 'cash_bust') AS graded,
       count(*)::int AS hands,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms))::int AS gap_p50_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY owed_ms))::int AS owed_p50_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms - owed_ms))::int AS unintended_p50_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms))::int AS unintended_p95_ms,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_ms - owed_ms))::int AS unintended_p99_ms,
       CASE WHEN shape IN ('rit', 'cash_bust') THEN NULL
            ELSE count(*) FILTER (WHERE gap_ms - owed_ms > budget_ms)::int END AS over_budget,
       min(budget_ms)::int AS budget_ms
  FROM shaped
 GROUP BY 1, 2
 ORDER BY 1, 2
$g$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;

COMMENT ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) IS
  'Read-only grade of scripts/sql/hand-gap-unintended-delay.sql for one window: per kind x shape p50/p95/p99 unintended delay between hands and the over-budget count. Incident 075013fd lane E5.';

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
  c_min_n    constant int      := 5;   -- graded hands a window needs before its p95 counts
  c_quiet    constant interval := interval '30 minutes';
  c_keep     constant interval := interval '30 days';
  v_end      timestamptz := date_trunc('hour', p_at)
                            + floor(extract(minute FROM p_at) / 5) * interval '5 minutes';
  v_prev     timestamptz := v_end - interval '5 minutes';
  v_recorded int := 0; v_breaching int := 0; v_new int := 0; v_resolved int := 0;
  r record;
BEGIN
  INSERT INTO ca_hand_gap_watch_history AS h
         (window_end, window_minutes, kind, shape, graded, hands, gap_p50_ms, owed_p50_ms,
          unintended_p50_ms, unintended_p95_ms, unintended_p99_ms, over_budget, budget_ms)
  SELECT v_end, c_minutes, g.kind, g.shape, g.graded, g.hands, g.gap_p50_ms, g.owed_p50_ms,
         g.unintended_p50_ms, g.unintended_p95_ms, g.unintended_p99_ms, g.over_budget, g.budget_ms
    FROM fn_ca_hand_gap_unintended_delay(v_end, c_minutes) g
  ON CONFLICT (window_end, kind, shape) DO NOTHING;
  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  -- Resolve: the shape's latest window with enough graded hands is back under
  -- the budget, or the shape has had no such window for 30 minutes.
  WITH done AS (
    UPDATE financial_alerts fa
       SET resolved = true, resolved_at = now(),
           resolution = 'unintended p95 back within the ' || l.budget_ms || ' ms budget for ' || l.kind || ' ' || l.shape
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
    RETURNING 1)
  SELECT count(*) INTO v_resolved FROM done;

  FOR r IN
    SELECT cur.*, prev.unintended_p95_ms AS prev_p95_ms, prev.hands AS prev_hands
      FROM ca_hand_gap_watch_history cur
      JOIN ca_hand_gap_watch_history prev
        ON prev.window_end = v_prev AND prev.kind = cur.kind AND prev.shape = cur.shape
     WHERE cur.window_end = v_end
       AND cur.graded AND cur.hands >= c_min_n AND cur.unintended_p95_ms > cur.budget_ms
       AND prev.graded AND prev.hands >= c_min_n AND prev.unintended_p95_ms > prev.budget_ms
     ORDER BY cur.unintended_p95_ms DESC, cur.kind, cur.shape
  LOOP
    v_breaching := v_breaching + 1;
    CONTINUE WHEN EXISTS (SELECT 1 FROM financial_alerts fa
                           WHERE fa.source = c_source AND NOT fa.resolved
                             AND fa.context->>'kind' = r.kind AND fa.context->>'shape' = r.shape);
    INSERT INTO financial_alerts (severity, source, message, context)
    VALUES ('critical', c_source,
            'Unintended delay between hands: for two 5-minute windows in a row, the p95 of the gap between hands beyond the beats the hand is owed is over the engine budget. Something the engine waits on between hands is not an intended animation or pause.',
            jsonb_build_object(
              'kind', r.kind, 'shape', r.shape, 'window_end', r.window_end, 'window_minutes', r.window_minutes,
              'hands', r.hands, 'gap_p50_ms', r.gap_p50_ms, 'owed_p50_ms', r.owed_p50_ms,
              'unintended_p50_ms', r.unintended_p50_ms, 'unintended_p95_ms', r.unintended_p95_ms,
              'unintended_p99_ms', r.unintended_p99_ms, 'over_budget', r.over_budget,
              'budget_ms', r.budget_ms, 'previous_window_p95_ms', r.prev_p95_ms,
              'previous_window_hands', r.prev_hands,
              'grade', 'scripts/sql/hand-gap-unintended-delay.sql',
              'history', 'ca_hand_gap_watch_history'));
    v_new := v_new + 1;
  END LOOP;

  DELETE FROM ca_hand_gap_watch_history WHERE window_end < v_end - c_keep;

  RETURN jsonb_build_object('window_end', v_end, 'recorded', v_recorded, 'breaching', v_breaching,
                            'opened', v_new, 'resolved', v_resolved, 'checked_at', now());
END
$f$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_watch(timestamptz) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_ca_hand_gap_watch(timestamptz) IS
  'Detector (not a repair): records the 5-minute unintended-delay grade per kind x shape into ca_hand_gap_watch_history and raises one critical financial_alerts row per kind x shape whose p95 is over the engine budget in two consecutive windows (>= 5 graded hands each); auto-resolving. Incident 075013fd lane E5.';

SELECT cron.schedule('hand-gap-unintended-delay-watch-5m', '1-59/5 * * * *', 'select public.fn_ca_hand_gap_watch()');

COMMIT;
