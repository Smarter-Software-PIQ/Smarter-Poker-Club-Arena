-- 20261122054826_mystery_bounty_and_addon_break_are_owed_waits.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- MYSTERY BOUNTY CHEST REVEALS AND ADD-ON BREAKS ARE OWED WAITS; THE HAND-GAP
-- RUNBOOK NEVER MISCLASSIFIES A TOURNAMENT BUST AS AN INTENDED REBUY WAIT
-- (incident 1e532243, fn_ca_hand_gap_watch).
--
-- WHAT WAS MEASURED ON PRODUCTION (2026-11-22, serving engine c2d6e45e3bcc):
--   1. Mystery Bounty chest reveals (Dan 2026-08-21, server/src/config/mysteryChestSpec.ts:
--      mysteryChestHoldMs ~14.3 s + 0.9 s coalesce on top of showdown hold = ~20.3 s):
--      Between 04:45 and 05:00 UTC, tournament f99647e1 had six MYSTERY CHEST reveals
--      (a44f0266 at 04:48:34->04:48:54 20,259 ms, 04:50:11->04:50:32 20,260 ms,
--      04:51:36->04:51:56 20,343 ms; f6bfc10b at 04:50:55->04:51:15 20,547 ms).
--      Because fn_ca_hand_gap_unintended_delay did not exclude pairs with a reserved
--      tournament_bounty_awards row on that table/hand, every Mystery Bounty knockout
--      graded +14 s unintended delay and re-fired incident 1e532243 at 05:01 UTC.
--   2. Add-on breaks (TournamentManagerBase.scheduleAddOnBreak): hold dealing via
--      holdDealingUntil(addon_period_ends_at) for the final addon_break_minutes
--      (clamped 1..10) of [addon_period_started_at, addon_period_ends_at] without
--      setting break_started_at/break_ends_at. Any hand gap < 60 s spanning an
--      add-on break was therefore graded as unintended delay. Using GREATEST(
--      addon_period_started_at, addon_period_ends_at - addon_break_minutes) excludes
--      only the actual add-on break, never the earlier open play of addon_from_start.
--   3. smarter_private.reliability_runbook_hand_gap_classification (20261119234324):
--      (a) classified any tournament bust in an is_rebuy/is_reentry tournament as
--          intended 'rebuy', even though tournament tables never pause for rebuys
--          (ServerTableEngineDealing.ts: only cash tables run the <= 5 s rebuy
--          pause). In event 2d444aeb (02:30-02:40 UTC), 143 real unintended delays
--          (10-33 s parked balancing waits) were mislabeled 'rebuy' (intended),
--          risking false auto-resolution of real critical alerts;
--      (b) omitted 'mystery_bounty' and 'addon_break' intended wait classes;
--      (c) scanned 10 minutes instead of the watch's 15-minute (3 x 5 min) window.
--
-- WHAT THIS CHANGES (one transaction, zero hot-table locks):
--   1. Anchored edit of public.fn_ca_hand_gap_unintended_delay(timestamptz, integer)
--      from production's own text (anchor must match exactly once): adds indexed
--      NOT EXISTS exclusions for tournament_bounty_awards (idx_bounty_awards_tournament)
--      and the add-on break window on tournaments (PK lookup), keeping every prior
--      exclusion (Lightning, maintenance break, hand-for-hand, tournament break),
--      shape, owed beat, budget and split column byte-for-byte.
--   2. Replaces smarter_private.reliability_runbook_hand_gap_classification to scan
--      the 15-minute window, classify 'mystery_bounty' and 'addon_break' as intended,
--      and classify 'rebuy' only for cash busts (tournament_id IS NULL).
--
-- Pinned by tests/mystery-bounty-and-addon-break-are-owed-waits.law.test.ts;
-- proved on PostgreSQL 16 by scripts/ci/test-hand-gap-watch.py and
-- scripts/ci/test-reliability-runbooks.py.
--
-- @live-proof: (SELECT strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'FROM tournament_bounty_awards ba') > 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'ta.addon_period_ends_at') > 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'ca_tournament_hand_for_hand') > 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'FROM tournaments t') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)'::regprocedure), '''mystery_bounty''') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)'::regprocedure), '''addon_break''') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)'::regprocedure), 'interval ''15 minutes''') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)'::regprocedure), 't.is_rebuy') = 0 AND NOT has_function_privilege('anon', 'smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)', 'EXECUTE'))

BEGIN;

SET LOCAL lock_timeout = '4s';

-- 1. Exclude Mystery Bounty chest reveals and tournament add-on breaks from
--    fn_ca_hand_gap_unintended_delay via an exact single-match anchored edit.
DO $edit$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure);
  c_old constant text := 'AND NOT EXISTS (SELECT 1 FROM tournaments t';
  c_new constant text := 'AND NOT EXISTS (SELECT 1 FROM tournament_bounty_awards ba'
    || chr(10) || '                      WHERE ba.tournament_id = p.tournament_id'
    || chr(10) || '                        AND (ba.table_id = nx.table_id OR ba.hand_id = p.id::text)'
    || chr(10) || '                        AND ba.reserved_at >= p.ended_at - interval ''5 seconds'''
    || chr(10) || '                        AND ba.reserved_at < nx.started_at)'
    || chr(10) || '     AND NOT EXISTS (SELECT 1 FROM tournaments ta'
    || chr(10) || '                      WHERE ta.id = p.tournament_id'
    || chr(10) || '                        AND ta.addon_period_started_at IS NOT NULL'
    || chr(10) || '                        AND ta.addon_period_ends_at IS NOT NULL'
    || chr(10) || '                        AND GREATEST(ta.addon_period_started_at, ta.addon_period_ends_at - make_interval(mins => LEAST(10, GREATEST(1, COALESCE(ta.addon_break_minutes, 1))))) < nx.started_at'
    || chr(10) || '                        AND ta.addon_period_ends_at > p.ended_at)'
    || chr(10) || '     AND NOT EXISTS (SELECT 1 FROM tournaments t';
BEGIN
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay tournament-break anchor did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$edit$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;

-- 2. Fix smarter_private.reliability_runbook_hand_gap_classification:
--    - 15-minute window matching fn_ca_hand_gap_watch (3 x 5 minutes)
--    - classify Mystery Bounty chest reveals ('mystery_bounty') and add-on
--      breaks ('addon_break') as intended waits
--    - classify 'rebuy' ONLY for cash busts (tournament_id IS NULL); tournament
--      tables never pause for rebuys, so a slow tournament bust is never an
--      intended rebuy wait.
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_hand_gap_classification(
  p_incident_id uuid, p_dry_run boolean, p_limits jsonb, p_now timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_alerts integer := least(coalesce((p_limits->>'max_alerts_per_attempt')::integer, 10), 20);
  v_h4h boolean := to_regclass('public.ca_tournament_hand_for_hand') IS NOT NULL;
  v_h4h_clause text := CASE WHEN to_regclass('public.ca_tournament_hand_for_hand') IS NOT NULL THEN
    'WHEN sh.tournament_id IS NOT NULL AND EXISTS (SELECT 1 FROM ca_tournament_hand_for_hand h'
    || ' WHERE h.tournament_id = sh.tournament_id AND h.started_at < sh.next_start'
    || ' AND coalesce(h.ended_at, ''infinity'') > sh.ended_at - interval ''5 seconds'') THEN ''hand_for_hand'''
    ELSE '' END;
  a record;
  v_slow jsonb;
  v_counts jsonb;
  v_total integer;
  v_intended integer;
  v_resolved integer := 0;
  v_alerts jsonb := '[]'::jsonb;
  v_end timestamptz;
BEGIN
  FOR a IN
    SELECT fa.id, fa.context FROM public.financial_alerts fa
     WHERE fa.source = 'fn_ca_hand_gap_watch' AND NOT fa.resolved
     ORDER BY fa.created_at
     LIMIT c_alerts
  LOOP
    v_end := (a.context->>'window_end')::timestamptz;
    CONTINUE WHEN v_end IS NULL;
    -- The grader's own pairing and owed beats (fn_ca_hand_gap_unintended_delay),
    -- over the alert's 15-minute sustained window and WITHOUT its exclusions,
    -- so every slow hand is classified rather than silently dropped.
    EXECUTE replace($q$
      WITH k AS (
        SELECT 500 AS bets_sweep_ms, 1100 AS pot_push_ms, 250 AS muck_ms,
               1400 AS showdown_read_base_ms, 350 AS showdown_read_per_extra_hand_ms,
               2200 AS showdown_read_max_ms, 1500 AS winning_cards_extra_ms,
               2000 AS all_in_showdown_extra_ms, 900 AS pot_award_stagger_ms,
               1500 AS next_hand_rest_ms
      ),
      nx AS (
        SELECT n.id, n.table_id, n.started_at, n.created_at FROM hand_history n
         WHERE n.created_at >= $1 - interval '15 minutes' AND n.created_at < $1 AND n.table_id IS NOT NULL
      ),
      pair AS (
        SELECT p.*, nx.table_id, nx.started_at AS next_start FROM nx
        CROSS JOIN LATERAL (
          SELECT hh.id, hh.tournament_id, hh.ended_at, hh.actions, hh.players, hh.pots, hh.rit_boards,
                 CASE WHEN jsonb_typeof(hh.showdown) = 'array' THEN hh.showdown ELSE '[]'::jsonb END AS shown
            FROM hand_history hh
           WHERE hh.table_id = nx.table_id AND hh.created_at < nx.created_at
             AND hh.created_at >= nx.created_at - interval '30 minutes'
           ORDER BY hh.created_at DESC LIMIT 1) p
        WHERE nx.started_at > p.ended_at AND nx.started_at - p.ended_at < interval '60 seconds'
          AND NOT EXISTS (SELECT 1 FROM lightning_hand lh WHERE lh.hand_history_id IN (nx.id, p.id))
      ),
      s AS (
        SELECT pair.*, extract(epoch FROM pair.next_start - pair.ended_at) * 1000 AS gap_ms,
               jsonb_array_length(pair.shown) AS shown_n,
               EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) x
                        WHERE x->>'stage' = 'river' AND coalesce((x->>'amount')::numeric, 0) > 0 AND x->>'action' <> 'return') AS river_chips,
               EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) x, jsonb_array_elements(pair.shown) sd
                        WHERE x->>'action' = 'all_in' AND x->>'userId' = sd->>'user_id') AS all_in_shown,
               GREATEST(1, (SELECT count(*) FROM jsonb_array_elements(coalesce(pair.pots, '[]'::jsonb)) pp,
                                   jsonb_array_elements(coalesce(pp->'awards', '[]'::jsonb)) aw
                             WHERE coalesce((aw->>'amount')::numeric, 0) > 0)) AS award_groups,
               EXISTS (SELECT 1 FROM jsonb_array_elements(pair.players) pl WHERE coalesce((pl->>'stack')::numeric, 1) = 0) AS someone_busted
          FROM pair
      ),
      shaped AS (
        SELECT s.*, CASE WHEN s.tournament_id IS NULL THEN 'cash' ELSE 'tournament' END AS kind,
          CASE WHEN s.rit_boards IS NOT NULL THEN 'rit'
               WHEN s.tournament_id IS NULL AND s.someone_busted THEN 'cash_bust'
               WHEN s.shown_n < 2 THEN 'fold'
               WHEN s.all_in_shown THEN 'all_in_showdown'
               WHEN s.river_chips THEN 'showdown_river_chips'
               ELSE 'showdown_checked_river' END AS shape,
          CASE WHEN s.shown_n < 2 THEN k.bets_sweep_ms + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
               ELSE least(k.showdown_read_max_ms, k.showdown_read_base_ms + greatest(0, s.shown_n - 2) * k.showdown_read_per_extra_hand_ms)
                    + greatest(CASE WHEN s.all_in_shown THEN k.all_in_showdown_extra_ms ELSE 0 END, k.winning_cards_extra_ms)
                    + CASE WHEN s.river_chips THEN k.bets_sweep_ms ELSE 0 END
                    + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
          END + k.next_hand_rest_ms AS owed_ms
        FROM s CROSS JOIN k
      ),
      slow AS (
        SELECT sh.*,
          CASE
            /*H4H*/
            WHEN sh.tournament_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM tournament_bounty_awards ba
                    WHERE ba.tournament_id = sh.tournament_id
                      AND (ba.table_id = sh.table_id OR ba.hand_id = sh.id::text)
                      AND ba.reserved_at >= sh.ended_at - interval '5 seconds'
                      AND ba.reserved_at < sh.next_start) THEN 'mystery_bounty'
            WHEN sh.tournament_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM tournaments ta
                    WHERE ta.id = sh.tournament_id
                      AND ta.addon_period_started_at IS NOT NULL
                      AND ta.addon_period_ends_at IS NOT NULL
                      AND GREATEST(ta.addon_period_started_at, ta.addon_period_ends_at - make_interval(mins => LEAST(10, GREATEST(1, COALESCE(ta.addon_break_minutes, 1))))) < sh.next_start
                      AND ta.addon_period_ends_at > sh.ended_at) THEN 'addon_break'
            WHEN sh.tournament_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM tournaments t WHERE t.id = sh.tournament_id AND t.break_started_at < sh.next_start
                      AND coalesce(t.break_ends_at, 'infinity') > sh.ended_at) THEN 'tournament_break'
            WHEN EXISTS (SELECT 1 FROM engine_maintenance_break_log b
                          WHERE b.break_started_at < sh.next_start AND b.break_started_at > sh.ended_at - interval '30 minutes'
                            AND coalesce(b.break_ended_at, 'infinity') > sh.ended_at) THEN 'maintenance_break'
            WHEN sh.tournament_id IS NULL AND sh.someone_busted THEN 'rebuy'
            ELSE 'other' END AS wait_class
          FROM shaped sh
         WHERE sh.kind = $2 AND sh.shape = $3 AND sh.gap_ms - sh.owed_ms > $4
      )
      SELECT coalesce((SELECT jsonb_object_agg(c.wait_class, c.n)
                         FROM (SELECT wait_class, count(*) AS n FROM slow GROUP BY wait_class) c), '{}'::jsonb),
             coalesce((SELECT jsonb_agg(jsonb_build_object('hand_id', x.id, 'tournament_id', x.tournament_id,
                                                           'unintended_ms', round(x.gap_ms - x.owed_ms), 'class', x.wait_class))
                         FROM (SELECT * FROM slow ORDER BY gap_ms - owed_ms DESC LIMIT 10) x), '[]'::jsonb)
    $q$, '/*H4H*/', v_h4h_clause)
    INTO v_counts, v_slow
    USING v_end, coalesce(a.context->>'kind', 'tournament'), coalesce(a.context->>'shape', ''),
          coalesce((a.context->>'budget_ms')::integer, 250);
    SELECT coalesce(sum(value::integer), 0),
           coalesce(sum(value::integer) FILTER (WHERE key IN ('hand_for_hand', 'mystery_bounty', 'addon_break', 'tournament_break', 'maintenance_break', 'rebuy')), 0)
      INTO v_total, v_intended
      FROM jsonb_each_text(v_counts);
    IF v_total > 0 AND v_intended = v_total AND NOT p_dry_run THEN
      UPDATE public.financial_alerts fa
         SET resolved = true, resolved_at = clock_timestamp(),
             resolution = format('reliability runbook hand_gap_classification: every slow hand (%s) in the 15-minute window ending %s was an intended wait %s',
                                 v_total, v_end, v_counts)
       WHERE fa.id = a.id AND fa.source = 'fn_ca_hand_gap_watch' AND NOT fa.resolved;
      IF FOUND THEN v_resolved := v_resolved + 1; END IF;
    END IF;
    v_alerts := v_alerts || jsonb_build_object('financial_alert_id', a.id, 'kind', a.context->>'kind', 'shape', a.context->>'shape',
      'window_end', v_end, 'slow_hands', v_total, 'intended', v_intended, 'by_class', v_counts, 'worst', v_slow,
      'all_intended', v_total > 0 AND v_intended = v_total);
  END LOOP;
  RETURN jsonb_build_object(
    'outcome', CASE WHEN jsonb_array_length(v_alerts) = 0 THEN 'nothing_to_do'
                    WHEN p_dry_run THEN 'observed'
                    WHEN v_resolved > 0 THEN 'resolved_producer'
                    ELSE 'diagnosed' END,
    'summary', CASE WHEN jsonb_array_length(v_alerts) = 0 THEN 'no fn_ca_hand_gap_watch alert is open'
               ELSE format('%s open hand-gap alert(s) classified; %s resolved because every slow hand was an intended wait%s',
                           jsonb_array_length(v_alerts), v_resolved,
                           CASE WHEN v_h4h THEN '' ELSE ' (ca_tournament_hand_for_hand is not installed yet, so a hand-for-hand wait reads as other)' END) END,
    'hand_for_hand_table', v_h4h,
    'alerts', v_alerts);
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;

-- @probe-for: public.fn_ca_hand_gap_unintended_delay
-- @probe-for: smarter_private.reliability_runbook_hand_gap_classification
DO $probe$
DECLARE v_n int; v_res jsonb;
BEGIN
  SELECT count(*) INTO v_n FROM public.fn_ca_hand_gap_unintended_delay(now(), 5);
  v_res := smarter_private.reliability_runbook_hand_gap_classification(
    '00000000-0000-0000-0000-000000000000'::uuid, true, '{"max_alerts_per_attempt": 0}'::jsonb, clock_timestamp());
  IF v_res->>'outcome' IS NULL THEN
    RAISE EXCEPTION 'hand_gap_classification probe returned null outcome';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
