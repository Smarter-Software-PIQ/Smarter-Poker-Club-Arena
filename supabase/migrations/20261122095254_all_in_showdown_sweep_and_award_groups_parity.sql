-- 20261122095254_all_in_showdown_sweep_and_award_groups_parity.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ALL-IN CALL/BLIND SHOWDOWN, BETS-SWEEP, AND AWARD-GROUPS PARITY BETWEEN THE
-- ENGINE AND THE HAND-GAP GRADER & RUNBOOK (2026-11-22, incident 1e532243).
--
-- WHAT BROKE (proved live on production 2026-11-22 06:55 UTC and Backup Engine
-- run 44997134858 at 08:38 UTC):
--   1. All-in calls, bets, raises, blinds, and antes set player.is_all_in = true
--      in HandController while recording the original action verb ('call', 'bet',
--      'raise', 'small_blind', 'big_blind', 'ante') rather than 'all_in'.
--      ServerTableEngineHandEvents sets currentHandAllInShowdown from
--      p.is_all_in = true, so handCompletionHoldMs holds ALL_IN_SHOWDOWN_EXTRA_MS
--      (2000 ms, +500 ms over WINNING_CARDS_EXTRA_MS = 1500 ms).
--      fn_ca_hand_gap_unintended_delay only checked a->>'action' = 'all_in', so:
--        * On Backup run 44997134858, cash showdown_checked_river graded
--          unintended_p50_ms = 1, unintended_p95_ms = 499, unintended_p99_ms = 501
--          (over_budget = 3 of 29) and refused certification.
--        * On production at 06:55 UTC (incident 1e532243 refire #17), tournament
--          showdown_checked_river graded +622..633 ms unintended on hands
--          2fba1d1f and 6e9da799.
--   2. showdownSweepOwed() conservatively holds BETS_SWEEP_MS (+500 ms) on
--      non-5-card boards or non-flop-street actions, while SQL only checked
--      river actions with amount > 0.
--   3. ServerTableEngineDealing.countAwardGroups() deduplicates awards by
--      (board, potIndex, low), while SQL used count(*) over pots[].awards[],
--      over-counting every chopped pot by +900 ms per extra split winner and
--      hiding real unintended delay on chopped pots.
--
-- WHAT THIS CHANGES:
--   1. Anchored edit on public.fn_ca_hand_gap_unintended_delay(timestamptz, int):
--        * river_chips: river chip commitment OR next hand's cadence
--          bets_sweep_owed = 'true' (bounded strictly to BETS_SWEEP_MS = 500 ms).
--        * all_in_shown: 'all_in' action by a shown player OR a shown player
--          finishing with stack = 0 (covers legacy engines before cadence carries
--          all_in_showdown) OR next hand's cadence all_in_showdown = 'true'
--          (bounded strictly to +500 ms ALL_IN_SHOWDOWN_EXTRA_MS beat).
--        * award_groups: count(DISTINCT (board, potIndex, low)) matching
--          countAwardGroups() so chopped pots never inflate owed_ms.
--   2. Replaces smarter_private.reliability_runbook_hand_gap_classification in
--      lockstep with the exact same river_chips, all_in_shown, and DISTINCT
--      award_groups expressions (keeping 15-minute window, mystery_bounty,
--      addon_break, and cash-only rebuy intact).
--
-- @live-proof: (SELECT position('all_in_showdown' in pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)) > 0 AND position('bets_sweep_owed' in pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)) > 0 AND position('count(DISTINCT' in pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)) > 0 AND position('all_in_showdown' in pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure)) > 0 AND position('bets_sweep_owed' in pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure)) > 0 AND position('count(DISTINCT' in pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure)) > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $grade$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure);
  c_old constant text :=
    '         EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a' || chr(10) ||
    '                 WHERE a->>''stage'' = ''river'' AND coalesce((a->>''amount'')::numeric, 0) > 0' || chr(10) ||
    '                   AND a->>''action'' <> ''return'') AS river_chips,' || chr(10) ||
    '         EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a, jsonb_array_elements(pair.shown) sd' || chr(10) ||
    '                 WHERE a->>''action'' = ''all_in'' AND a->>''userId'' = sd->>''user_id'') AS all_in_shown,' || chr(10) ||
    '         GREATEST(1, (SELECT count(*) FROM jsonb_array_elements(coalesce(pair.pots, ''[]''::jsonb)) p,' || chr(10) ||
    '                             jsonb_array_elements(coalesce(p->''awards'', ''[]''::jsonb)) aw' || chr(10) ||
    '                      WHERE coalesce((aw->>''amount'')::numeric, 0) > 0)) AS award_groups,';
  c_new constant text :=
    '         (EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a' || chr(10) ||
    '                  WHERE a->>''stage'' = ''river'' AND coalesce((a->>''amount'')::numeric, 0) > 0' || chr(10) ||
    '                    AND a->>''action'' <> ''return'')' || chr(10) ||
    '          OR (jsonb_typeof(pair.next_cadence) = ''object''' || chr(10) ||
    '              AND pair.next_cadence->>''bets_sweep_owed'' = ''true'')) AS river_chips,' || chr(10) ||
    '         (EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a, jsonb_array_elements(pair.shown) sd' || chr(10) ||
    '                  WHERE a->>''action'' = ''all_in'' AND a->>''userId'' = sd->>''user_id'')' || chr(10) ||
    '          OR EXISTS (SELECT 1 FROM jsonb_array_elements(pair.players) pl, jsonb_array_elements(pair.shown) sd' || chr(10) ||
    '                     WHERE pl->>''userId'' = sd->>''user_id'' AND coalesce((pl->>''stack'')::numeric, 1) = 0)' || chr(10) ||
    '          OR (jsonb_typeof(pair.next_cadence) = ''object''' || chr(10) ||
    '              AND pair.next_cadence->>''all_in_showdown'' = ''true'')) AS all_in_shown,' || chr(10) ||
    '         GREATEST(1, (SELECT count(DISTINCT (coalesce(aw->>''board'', ''1''), coalesce(aw->>''potIndex'', p->>''index'', ''0''), coalesce(aw->>''low'', ''false'')))' || chr(10) ||
    '                        FROM jsonb_array_elements(coalesce(pair.pots, ''[]''::jsonb)) p,' || chr(10) ||
    '                             jsonb_array_elements(coalesce(p->''awards'', ''[]''::jsonb)) aw' || chr(10) ||
    '                       WHERE coalesce((aw->>''amount'')::numeric, 0) > 0)) AS award_groups,';
BEGIN
  IF position('all_in_showdown' IN v_def) > 0
     AND position('bets_sweep_owed' IN v_def) > 0
     AND position('count(DISTINCT' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay anchor did not match once: %', left(c_old, 120);
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END $grade$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;

CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_hand_gap_classification(
  p_incident_id uuid,
  p_dry_run boolean DEFAULT false,
  p_limits jsonb DEFAULT '{}'::jsonb,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'smarter_private'
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
    -- The grader's own pairing, shape facts, and owed beats
    -- (fn_ca_hand_gap_unintended_delay), over the alert's 15-minute sustained
    -- window and WITHOUT its exclusions, so every slow hand is classified
    -- rather than silently dropped.
    EXECUTE replace($q$
      WITH k AS (
        SELECT 500 AS bets_sweep_ms, 1100 AS pot_push_ms, 250 AS muck_ms,
               1400 AS showdown_read_base_ms, 350 AS showdown_read_per_extra_hand_ms,
               2200 AS showdown_read_max_ms, 1500 AS winning_cards_extra_ms,
               2000 AS all_in_showdown_extra_ms, 900 AS pot_award_stagger_ms,
               1500 AS next_hand_rest_ms
      ),
      nx AS (
        SELECT n.id, n.table_id, n.started_at, n.created_at, n.cadence AS next_cadence FROM hand_history n
         WHERE n.created_at >= $1 - interval '15 minutes' AND n.created_at < $1 AND n.table_id IS NOT NULL
      ),
      pair AS (
        SELECT p.*, nx.table_id, nx.started_at AS next_start, nx.next_cadence FROM nx
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
               (EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) x
                         WHERE x->>'stage' = 'river' AND coalesce((x->>'amount')::numeric, 0) > 0 AND x->>'action' <> 'return')
                OR (jsonb_typeof(pair.next_cadence) = 'object'
                    AND pair.next_cadence->>'bets_sweep_owed' = 'true')) AS river_chips,
               (EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) x, jsonb_array_elements(pair.shown) sd
                         WHERE x->>'action' = 'all_in' AND x->>'userId' = sd->>'user_id')
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(pair.players) pl, jsonb_array_elements(pair.shown) sd
                            WHERE pl->>'userId' = sd->>'user_id' AND coalesce((pl->>'stack')::numeric, 1) = 0)
                OR (jsonb_typeof(pair.next_cadence) = 'object'
                    AND pair.next_cadence->>'all_in_showdown' = 'true')) AS all_in_shown,
               GREATEST(1, (SELECT count(DISTINCT (coalesce(aw->>'board', '1'), coalesce(aw->>'potIndex', pp->>'index', '0'), coalesce(aw->>'low', 'false')))
                              FROM jsonb_array_elements(coalesce(pair.pots, '[]'::jsonb)) pp,
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
                                               'window_end', v_end, 'slow_hands', v_total, 'intended', v_intended,
                                               'all_intended', v_total > 0 AND v_intended = v_total,
                                               'by_class', v_counts, 'worst', v_slow);
  END LOOP;
  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_resolved > 0 THEN 'resolved_producer' ELSE 'diagnosed' END,
    'reason', format('%s open hand-gap alert(s) classified; %s resolved because every slow hand was an intended wait',
                     jsonb_array_length(v_alerts), v_resolved),
    'hand_for_hand_table', v_h4h,
    'alerts', v_alerts);
END $function$;

REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) TO service_role;

-- @probe-for: public.fn_ca_hand_gap_unintended_delay
DO $probe$
BEGIN
  PERFORM * FROM public.fn_ca_hand_gap_unintended_delay(now(), 1) LIMIT 1;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: smarter_private.reliability_runbook_hand_gap_classification
DO $probe$
BEGIN
  PERFORM smarter_private.reliability_runbook_hand_gap_classification(gen_random_uuid(), true, '{"max_alerts_per_attempt":1}'::jsonb, now());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
