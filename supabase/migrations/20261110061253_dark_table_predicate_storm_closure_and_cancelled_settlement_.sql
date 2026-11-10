-- 20261110061253_dark_table_predicate_storm_closure_and_cancelled_settlement_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('tb.updated_at <= GREATEST(' in pg_get_functiondef('public.fn_ca_tournament_dark_candidates(integer)'::regprocedure)) > 0 AND position('FROM public.fn_ca_tournament_dark_candidates(v_threshold) dc' in pg_get_functiondef('public.fn_ca_tournament_dark_while_running(integer)'::regprocedure)) > 0 AND position('IF NEW.source IS NOT NULL THEN' in pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure)) > 0 AND position('round(COALESCE(e.refund_prize,0)+COALESCE(e.refund_bounty,0)+COALESCE(e.refund_fee,0),2)=round(COALESCE(e.gross_in,0),2)' in pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id = 'c42daa27-c73c-4af2-bee0-3488f2d91949' AND status = 'resolved')
--
-- PHASE 2 TOURNAMENT SELF-HEALING: DARK-TABLE PREDICATE HARDENING, GENERALIZED
-- STORM-INCIDENT AUTO-CLOSURE, AND CANCELLED-TOURNAMENT SETTLEMENT RESOLUTION
--
-- WHAT WAS WRONG, READ FROM ROWS AND DEFINITIONS
--
-- 1. Dark-table detection (`public.fn_ca_tournament_dark_candidates(integer)` and
--    `public.fn_ca_tournament_dark_while_running(integer)`):
--      (a) `public.tables` has the `tables_updated_at` BEFORE UPDATE trigger, which
--          sets `updated_at = now()` on any table update, including non-dealing
--          writes such as periodic blind-level publications (`fn_publish_tournament_blind_level`),
--          late-registration seat-count updates (`fn_seat_late_registrant`), button-seat
--          updates, and maintenance thaw writes.
--      (b) In `public.fn_ca_tournament_dark_candidates(integer)`, `last_activity`
--          previously took an unbounded `(SELECT max(tb.updated_at) FROM public.tables tb ...)`,
--          allowing periodic blind-level advances or non-dealing table writes to push
--          `last_activity` forward indefinitely even when zero hands (`hand_history.created_at`)
--          were committed and zero players (`tournament_players.eliminated_at`) were
--          eliminated. Bound `tb.updated_at` by `GREATEST(t.started_at, COALESCE(max(tp.eliminated_at), t.started_at), COALESCE(latest(hh.created_at), t.started_at))`
--          so non-dealing `tables.updated_at` writes can never indefinitely conceal
--          a stopped table while preserving the composite activity signal (`t.started_at`,
--          bounded `tables.updated_at`, `tournament_players.eliminated_at`, and
--          `hand_history.created_at`).
--      (c) In `public.fn_ca_tournament_dark_while_running(integer)`, the `named`
--          self-resolution CTE also included `max(tb.updated_at)` in `last_activity`
--          without checking whether the tournament was still in
--          `public.fn_ca_tournament_dark_candidates(v_threshold)`. Remove
--          `max(tb.updated_at)` from `named.last_activity` so an open dark alert on
--          a `RUNNING` tournament resolves only when `last_activity > raised_at`
--          from an actual player elimination (`tp.eliminated_at`) or committed hand
--          (`hh.created_at`) AND the tournament is no longer present in
--          `public.fn_ca_tournament_dark_candidates(v_threshold)` (or when the
--          tournament reaches `COMPLETED`, `CANCELLED`, or `CANCELED`).
--
-- 2. Storm-capped financial-alert incident auto-closure
--    (`public.fn_ca_alert_resolution_reaches_the_incident()`):
--      - `public.fn_ca_raise_drift_incident` attaches `financial_member_version = 1`
--        and the exact `alert_id` to every `recurred` event on any
--        `storm:financial_alerts:<source>` incident, but
--        `public.fn_ca_alert_resolution_reaches_the_incident()` gated its storm
--        auto-closer behind a hardcoded 3-source allowlist
--        (`IF NEW.source IN ('Tournament.atomic_finish_refused','fn_ca_bust_backlog_page','GameServer.tournament_dark_after_rebuild')`).
--      - As a result, when tournament `09d7457e-194b-46ed-95e4-aeba00c13f1c`
--        (`Prime Time Free Buy (NLH)`) capped 3 `postHandTasks.hand_history_failed`
--        alerts (`79ac07ea-819f-4bf8-8fe0-446788ca0e5a`,
--        `3911efde-2374-4c10-af58-b0cfae8c92d5`, and
--        `0411e243-59f5-4585-b757-600ae78a4635`) into storm incident
--        `c42daa27-c73c-4af2-bee0-3488f2d91949` at `2026-11-10 03:33:13+00` and all
--        3 member alerts self-healed and resolved at `2026-11-10 03:44:00.146803+00`,
--        `c42daa27-c73c-4af2-bee0-3488f2d91949` remained stranded `open`.
--      - Generalize the storm auto-closer in `public.fn_ca_alert_resolution_reaches_the_incident()`
--        to any `NEW.source IS NOT NULL` whose `storm:financial_alerts:<source>`
--        incident has exact versioned member events (`financial_member_version = 1`)
--        with 100% resolved member alerts, and close any currently open
--        `storm:financial_alerts:*` incident meeting that exact member proof
--        (including `c42daa27-c73c-4af2-bee0-3488f2d91949`).
--
-- 3. Conservation-verified cancelled-tournament alert resolution
--    (`public.fn_resolve_settled_financial_alerts(boolean, integer)`):
--      - Extend `v_receipted_ids` so that if a tournament with an open
--        `Tournament.satellite_boundary_held`,
--        `Tournament.satellite_qualifiers_refused_repeatedly`,
--        `GameServer.tournament_repeated_recovery_refused`, or
--        `fn_ca_tournament_dark_while_running` alert is `CANCELLED`/`CANCELED` with
--        `current_players = 0`, `terminal_closed_at >= a.created_at`, zero prize,
--        bounty, and fee escrow balances, zero prize/bounty/fee outflows, and full
--        refund conservation (`round(refund_prize + refund_bounty + refund_fee, 2) = round(gross_in, 2)`),
--        the operational alert resolves automatically.
--
-- No money moves in this migration.

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
BEGIN
  IF public.fn_ca_break_window_refuses_migrations(now()) THEN
    RAISE EXCEPTION 'Refusing to run migration inside the hourly break window (:50-:03 UTC)';
  END IF;
END
$guard$;

-- 1. Replace public.fn_ca_tournament_dark_candidates(integer) with bounded tables.updated_at
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_dark_candidates(p_minutes integer DEFAULT 20)
 RETURNS TABLE(tournament_id uuid, name text, tournament_type text, variant text, started_at timestamp with time zone, alive integer, last_activity timestamp with time zone, wall_minutes numeric, live_minutes numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT GREATEST(COALESCE(p_minutes, 20), 1) AS threshold,
           make_interval(mins => GREATEST(COALESCE(p_minutes, 20), 1)) AS cutoff,
           GREATEST(make_interval(mins => 3 * GREATEST(COALESCE(p_minutes, 20), 1)), interval '60 minutes') AS wall
  ), running AS (
    SELECT t.id AS tournament_id,
           t.name::text AS name,
           t.tournament_type::text AS tournament_type,
           t.variant::text AS variant,
           t.started_at,
           (SELECT count(*)::integer FROM public.tournament_players tp
             WHERE tp.tournament_id = t.id
               AND tp.status::text IN ('playing', 'active')) AS alive,
           GREATEST(
             t.started_at,
             -- NON-DEALING TABLE WRITES CANNOT CONCEAL A STOPPED TABLE (2026-11-10):
             -- tables.updated_at also changes on blind level publication, seat syncs,
             -- button-seat updates, and thaw. Bound tb.updated_at by the latest
             -- authoritative start, elimination, or committed hand so non-dealing
             -- updates cannot advance last_activity indefinitely.
             (SELECT max(tb.updated_at) FROM public.tables tb
               WHERE tb.tournament_id = t.id
                 AND lower(COALESCE(tb.status::text, '')) <> 'closed'
                 AND tb.updated_at <= GREATEST(
                   t.started_at,
                   COALESCE((SELECT max(tp.eliminated_at) FROM public.tournament_players tp
                     WHERE tp.tournament_id = t.id), t.started_at),
                   COALESCE((SELECT hh.created_at FROM public.hand_history hh
                     WHERE hh.tournament_id = t.id
                     ORDER BY hh.created_at DESC
                     LIMIT 1), t.started_at))),
             (SELECT max(tp.eliminated_at) FROM public.tournament_players tp
               WHERE tp.tournament_id = t.id),
             -- A DEALT HAND IS ACTIVITY (2026-10-21): an event dealing between
             -- level changes writes no table row and may bust nobody.
             (SELECT hh.created_at FROM public.hand_history hh
               WHERE hh.tournament_id = t.id
               ORDER BY hh.created_at DESC
               LIMIT 1)) AS last_activity
      FROM public.tournaments t, bounds b
     WHERE t.status = 'RUNNING'
       AND (COALESCE(t.on_break, false) IS NOT TRUE
            OR COALESCE(t.break_started_at, t.updated_at) < now() - interval '30 minutes')
       AND t.started_at IS NOT NULL
       AND t.started_at < now() - b.cutoff
       AND NOT (COALESCE(t.is_multi_day, false)
                AND COALESCE(t.day_number, 1) < COALESCE(t.total_days, 1))
  ), dark AS (
    SELECT r.*,
           round(extract(epoch FROM (now() - r.last_activity)) / 60.0, 1) AS wall_minutes,
           public.fn_ca_engine_live_minutes(r.last_activity, now()) AS live_minutes
      FROM running r, bounds b
     WHERE r.alive >= 2
       AND r.last_activity IS NOT NULL
       AND r.last_activity < now() - b.cutoff
  )
  SELECT d.tournament_id, d.name, d.tournament_type, d.variant, d.started_at, d.alive,
         d.last_activity, d.wall_minutes, d.live_minutes
    FROM dark d, bounds b
   WHERE d.live_minutes >= b.threshold
      OR d.last_activity < now() - b.wall
   ORDER BY d.last_activity
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_tournament_dark_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_tournament_dark_candidates(integer) TO postgres, service_role;

-- 2. Patch fn_ca_tournament_dark_while_running(integer), fn_ca_alert_resolution_reaches_the_incident(),
--    and fn_resolve_settled_financial_alerts(boolean, integer)
DO $patch_phase2$
DECLARE
  v_dark_def text;
  v_dark_new text;
  c_dark_old constant text :=
    '  WITH named AS (' || chr(10)
    || '    SELECT fa.id AS alert_id, fa.created_at AS raised_at, t.id AS tournament_id, t.status,' || chr(10)
    || '           GREATEST(' || chr(10)
    || '             (SELECT max(tb.updated_at) FROM public.tables tb WHERE tb.tournament_id = t.id),' || chr(10)
    || '             (SELECT max(tp.eliminated_at) FROM public.tournament_players tp WHERE tp.tournament_id = t.id),' || chr(10)
    || '             (SELECT hh.created_at FROM public.hand_history hh WHERE hh.tournament_id = t.id ORDER BY hh.created_at DESC LIMIT 1)) AS last_activity' || chr(10)
    || '      FROM public.financial_alerts fa' || chr(10)
    || '      LEFT JOIN public.tournaments t' || chr(10)
    || '        ON t.id = CASE' || chr(10)
    || '                    WHEN (fa.context->>''tournament_id'') ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''' || chr(10)
    || '                    THEN (fa.context->>''tournament_id'')::uuid' || chr(10)
    || '                  END' || chr(10)
    || '     WHERE fa.source = ''fn_ca_tournament_dark_while_running''' || chr(10)
    || '       AND NOT fa.resolved' || chr(10)
    || '  )' || chr(10)
    || '  UPDATE public.financial_alerts fa' || chr(10)
    || '     SET resolved = true,' || chr(10)
    || '         resolved_at = now(),' || chr(10)
    || '         resolution = format(' || chr(10)
    || '           ''Re-measured by fn_ca_tournament_dark_while_running at %s: tournament %s is %s ''' || chr(10)
    || '           || ''and its last activity is %s, after the alert was raised at %s.'',' || chr(10)
    || '           now(), n.tournament_id, n.status, n.last_activity, n.raised_at)' || chr(10)
    || '    FROM named n' || chr(10)
    || '   WHERE fa.id = n.alert_id' || chr(10)
    || '     AND NOT fa.resolved' || chr(10)
    || '     AND (n.status IN (''COMPLETED'', ''CANCELLED'', ''CANCELED'')' || chr(10)
    || '          OR (n.status = ''RUNNING'' AND n.last_activity > n.raised_at));';
  c_dark_new constant text :=
    '  WITH named AS (' || chr(10)
    || '    SELECT fa.id AS alert_id, fa.created_at AS raised_at, t.id AS tournament_id, t.status,' || chr(10)
    || '           GREATEST(' || chr(10)
    || '             (SELECT max(tp.eliminated_at) FROM public.tournament_players tp WHERE tp.tournament_id = t.id),' || chr(10)
    || '             (SELECT hh.created_at FROM public.hand_history hh WHERE hh.tournament_id = t.id ORDER BY hh.created_at DESC LIMIT 1)) AS last_activity' || chr(10)
    || '      FROM public.financial_alerts fa' || chr(10)
    || '      LEFT JOIN public.tournaments t' || chr(10)
    || '        ON t.id = CASE' || chr(10)
    || '                    WHEN (fa.context->>''tournament_id'') ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''' || chr(10)
    || '                    THEN (fa.context->>''tournament_id'')::uuid' || chr(10)
    || '                  END' || chr(10)
    || '     WHERE fa.source = ''fn_ca_tournament_dark_while_running''' || chr(10)
    || '       AND NOT fa.resolved' || chr(10)
    || '  )' || chr(10)
    || '  UPDATE public.financial_alerts fa' || chr(10)
    || '     SET resolved = true,' || chr(10)
    || '         resolved_at = now(),' || chr(10)
    || '         resolution = format(' || chr(10)
    || '           ''Re-measured by fn_ca_tournament_dark_while_running at %s: tournament %s is %s ''' || chr(10)
    || '           || ''and its last activity is %s, after the alert was raised at %s.'',' || chr(10)
    || '           now(), n.tournament_id, n.status, n.last_activity, n.raised_at)' || chr(10)
    || '    FROM named n' || chr(10)
    || '   WHERE fa.id = n.alert_id' || chr(10)
    || '     AND NOT fa.resolved' || chr(10)
    || '     AND (n.status IN (''COMPLETED'', ''CANCELLED'', ''CANCELED'')' || chr(10)
    || '          OR (n.status = ''RUNNING''' || chr(10)
    || '              AND n.last_activity > n.raised_at' || chr(10)
    || '              AND NOT EXISTS (' || chr(10)
    || '                SELECT 1' || chr(10)
    || '                  FROM public.fn_ca_tournament_dark_candidates(v_threshold) dc' || chr(10)
    || '                 WHERE dc.tournament_id = n.tournament_id' || chr(10)
    || '              )));';

  v_inc_def text;
  v_inc_new text;
  c_inc_old constant text :=
    '  IF NEW.source IN (''Tournament.atomic_finish_refused'',''fn_ca_bust_backlog_page'',''GameServer.tournament_dark_after_rebuild'') THEN' || chr(10)
    || '    FOR v_storm IN' || chr(10)
    || '      SELECT i.id,i.occurrences,i.detected_at FROM public.ca_drift_incidents i' || chr(10)
    || '      WHERE i.source=''financial_alerts:'' || NEW.source' || chr(10)
    || '        AND i.dedupe_key=''storm:financial_alerts:'' || NEW.source' || chr(10)
    || '        AND i.status<>''resolved''' || chr(10)
    || '        AND (NEW.source IN (''fn_ca_bust_backlog_page'',''GameServer.tournament_dark_after_rebuild'') OR i.metadata->>''storm_member_version''=''1'')' || chr(10)
    || '      ORDER BY i.id FOR UPDATE' || chr(10)
    || '    LOOP' || chr(10)
    || '      SELECT count(*),count(*) FILTER(WHERE a.id IS NULL' || chr(10)
    || '                 OR a.source IS DISTINCT FROM NEW.source OR a.resolved IS DISTINCT FROM true),' || chr(10)
    || '             COALESCE(bool_or(a.id=NEW.id),false)' || chr(10)
    || '        INTO v_members,v_bad,v_current' || chr(10)
    || '        FROM public.ca_incident_events e' || chr(10)
    || '        LEFT JOIN public.financial_alerts a ON a.id=CASE' || chr(10)
    || '          WHEN jsonb_typeof(e.detail->''alert_id'')=''string''' || chr(10)
    || '            AND e.detail->>''alert_id'' ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''' || chr(10)
    || '          THEN (e.detail->>''alert_id'')::uuid END' || chr(10)
    || '       WHERE e.incident_id=v_storm.id AND e.kind=''recurred''' || chr(10)
    || '      HAVING NEW.source NOT IN (''fn_ca_bust_backlog_page'',''GameServer.tournament_dark_after_rebuild'')' || chr(10)
    || '          OR (count(DISTINCT a.id)=count(*)' || chr(10)
    || '            AND bool_and(COALESCE(e.detail->''financial_member_version''=''1''::jsonb' || chr(10)
    || '                  AND e.detail->>''source''=''financial_alerts:'' || NEW.source,false)));';
  c_inc_new constant text :=
    '  IF NEW.source IS NOT NULL THEN' || chr(10)
    || '    FOR v_storm IN' || chr(10)
    || '      SELECT i.id,i.occurrences,i.detected_at,i.metadata FROM public.ca_drift_incidents i' || chr(10)
    || '      WHERE i.source=''financial_alerts:'' || NEW.source' || chr(10)
    || '        AND i.dedupe_key=''storm:financial_alerts:'' || NEW.source' || chr(10)
    || '        AND i.status<>''resolved''' || chr(10)
    || '      ORDER BY i.id FOR UPDATE' || chr(10)
    || '    LOOP' || chr(10)
    || '      SELECT count(*),count(*) FILTER(WHERE a.id IS NULL' || chr(10)
    || '                 OR a.source IS DISTINCT FROM NEW.source OR a.resolved IS DISTINCT FROM true),' || chr(10)
    || '             COALESCE(bool_or(a.id=NEW.id),false)' || chr(10)
    || '        INTO v_members,v_bad,v_current' || chr(10)
    || '        FROM public.ca_incident_events e' || chr(10)
    || '        LEFT JOIN public.financial_alerts a ON a.id=CASE' || chr(10)
    || '          WHEN jsonb_typeof(e.detail->''alert_id'')=''string''' || chr(10)
    || '            AND e.detail->>''alert_id'' ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''' || chr(10)
    || '          THEN (e.detail->>''alert_id'')::uuid END' || chr(10)
    || '       WHERE e.incident_id=v_storm.id AND e.kind=''recurred''' || chr(10)
    || '      HAVING (NEW.source=''Tournament.atomic_finish_refused'' AND v_storm.metadata->>''storm_member_version''=''1'')' || chr(10)
    || '          OR (count(DISTINCT a.id)=count(*)' || chr(10)
    || '            AND bool_and(COALESCE(e.detail->''financial_member_version''=''1''::jsonb' || chr(10)
    || '                  AND e.detail->>''source''=''financial_alerts:'' || NEW.source,false)));';

  v_res_def text;
  v_res_new text;
  c_res_old constant text :=
    '    LEFT JOIN public.tournament_satellite_settlements s ON s.tournament_id=t.id' || chr(10)
    || '    LEFT JOIN public.tournament_terminal_settlements f ON f.tournament_id=t.id' || chr(10)
    || '    WHERE a.resolved IS NOT TRUE' || chr(10)
    || '      AND a.source IN (''Tournament.satellite_boundary_held'',' || chr(10)
    || '                       ''Tournament.satellite_qualifiers_refused_repeatedly'',' || chr(10)
    || '                       ''Tournament.satellite_qualifiers_outcome_unknown'',' || chr(10)
    || '                       ''tournament.real_time_payout_refused'',' || chr(10)
    || '                       ''GameServer.tournament_repeated_recovery_refused'',' || chr(10)
    || '                       ''fn_ca_tournament_dark_while_running'',' || chr(10)
    || '                       ''fn_ca_bounty_only_final_two_watch'')' || chr(10)
    || '      AND t.status=''COMPLETED'' AND t.current_players=0' || chr(10)
    || '      AND e.terminal_closed_at>=a.created_at' || chr(10)
    || '      AND e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0' || chr(10)
    || '      AND (' || chr(10)
    || '        (s.receipt_version=3 AND s.settled_at>=a.created_at';
  c_res_new constant text :=
    '    LEFT JOIN public.tournament_satellite_settlements s ON s.tournament_id=t.id' || chr(10)
    || '    LEFT JOIN public.tournament_terminal_settlements f ON f.tournament_id=t.id' || chr(10)
    || '    WHERE a.resolved IS NOT TRUE' || chr(10)
    || '      AND a.source IN (''Tournament.satellite_boundary_held'',' || chr(10)
    || '                       ''Tournament.satellite_qualifiers_refused_repeatedly'',' || chr(10)
    || '                       ''Tournament.satellite_qualifiers_outcome_unknown'',' || chr(10)
    || '                       ''tournament.real_time_payout_refused'',' || chr(10)
    || '                       ''GameServer.tournament_repeated_recovery_refused'',' || chr(10)
    || '                       ''fn_ca_tournament_dark_while_running'',' || chr(10)
    || '                       ''fn_ca_bounty_only_final_two_watch'')' || chr(10)
    || '      AND t.status IN (''COMPLETED'',''CANCELLED'',''CANCELED'') AND t.current_players=0' || chr(10)
    || '      AND e.terminal_closed_at>=a.created_at' || chr(10)
    || '      AND e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0' || chr(10)
    || '      AND (' || chr(10)
    || '        (t.status IN (''CANCELLED'',''CANCELED'')' || chr(10)
    || '          AND a.source IN (''Tournament.satellite_boundary_held'',' || chr(10)
    || '                           ''Tournament.satellite_qualifiers_refused_repeatedly'',' || chr(10)
    || '                           ''GameServer.tournament_repeated_recovery_refused'',' || chr(10)
    || '                           ''fn_ca_tournament_dark_while_running'')' || chr(10)
    || '          AND COALESCE(e.prize_out,0)=0 AND COALESCE(e.bounty_out,0)=0 AND COALESCE(e.fee_out,0)=0' || chr(10)
    || '          AND round(COALESCE(e.refund_prize,0)+COALESCE(e.refund_bounty,0)+COALESCE(e.refund_fee,0),2)=round(COALESCE(e.gross_in,0),2))' || chr(10)
    || '        OR (t.status=''COMPLETED'' AND s.receipt_version=3 AND s.settled_at>=a.created_at';
BEGIN
  v_dark_def := pg_get_functiondef('public.fn_ca_tournament_dark_while_running(integer)'::regprocedure);
  IF position('FROM public.fn_ca_tournament_dark_candidates(v_threshold) dc' IN v_dark_def) = 0 THEN
    IF (length(v_dark_def) - length(replace(v_dark_def, c_dark_old, ''))) / length(c_dark_old) <> 1 THEN
      RAISE EXCEPTION 'fn_ca_tournament_dark_while_running phase2 anchor not found exactly once';
    END IF;
    v_dark_new := replace(v_dark_def, c_dark_old, c_dark_new);
    EXECUTE v_dark_new;
  END IF;

  v_inc_def := pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure);
  IF position('IF NEW.source IS NOT NULL THEN' IN v_inc_def) = 0 THEN
    IF (length(v_inc_def) - length(replace(v_inc_def, c_inc_old, ''))) / length(c_inc_old) <> 1 THEN
      RAISE EXCEPTION 'fn_ca_alert_resolution_reaches_the_incident phase2 anchor not found exactly once';
    END IF;
    v_inc_new := replace(v_inc_def, c_inc_old, c_inc_new);
    EXECUTE v_inc_new;
  END IF;

  v_res_def := pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure);
  IF position('round(COALESCE(e.refund_prize,0)+COALESCE(e.refund_bounty,0)+COALESCE(e.refund_fee,0),2)=round(COALESCE(e.gross_in,0),2)' IN v_res_def) = 0 THEN
    IF (length(v_res_def) - length(replace(v_res_def, c_res_old, ''))) / length(c_res_old) <> 1 THEN
      RAISE EXCEPTION 'fn_resolve_settled_financial_alerts phase2 anchor not found exactly once';
    END IF;
    v_res_new := replace(v_res_def, c_res_old, c_res_new);
    EXECUTE v_res_new;
  END IF;
END
$patch_phase2$;

REVOKE ALL ON FUNCTION public.fn_ca_tournament_dark_while_running(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_tournament_dark_while_running(integer) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.fn_ca_alert_resolution_reaches_the_incident() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_alert_resolution_reaches_the_incident() TO postgres, service_role;

DO $revoke_resolver$
BEGIN
  IF to_regprocedure('public.fn_resolve_settled_financial_alerts(boolean, integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) TO postgres, service_role;
  END IF;
END
$revoke_resolver$;

-- 3. Reconcile any open storm:financial_alerts:* incident whose exact versioned
--    recurred members all exist, match the source, match occurrences, and are
--    100% resolved in public.financial_alerts (such as c42daa27-c73c-4af2-bee0-3488f2d91949).
DO $reconcile_resolved_storms$
DECLARE
  v_storm record;
  v_alert_source text;
  v_members bigint;
  v_bad bigint;
BEGIN
  FOR v_storm IN
    SELECT i.id, i.source, i.dedupe_key, i.occurrences, i.detected_at
      FROM public.ca_drift_incidents i
     WHERE i.status <> 'resolved'
       AND left(i.source, length('financial_alerts:')) = 'financial_alerts:'
       AND i.dedupe_key = 'storm:' || i.source
     ORDER BY i.id FOR UPDATE
  LOOP
    v_alert_source := substr(v_storm.source, length('financial_alerts:') + 1);
    SELECT count(*),
           count(*) FILTER (
             WHERE a.id IS NULL
                OR a.source IS DISTINCT FROM v_alert_source
                OR a.resolved IS DISTINCT FROM true
           )
      INTO v_members, v_bad
      FROM public.ca_incident_events e
      LEFT JOIN public.financial_alerts a
        ON a.id = CASE
          WHEN jsonb_typeof(e.detail->'alert_id') = 'string'
           AND e.detail->>'alert_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN (e.detail->>'alert_id')::uuid
        END
     WHERE e.incident_id = v_storm.id
       AND e.kind = 'recurred'
    HAVING count(DISTINCT a.id) = count(*)
       AND bool_and(COALESCE(
             e.detail->'financial_member_version' = '1'::jsonb
             AND e.detail->>'source' = v_storm.source,
             false));

    IF v_members > 0 AND v_members = v_storm.occurrences AND v_bad = 0 THEN
      UPDATE public.ca_drift_incidents
         SET status = 'resolved',
             resolved_at = GREATEST(now(), detected_at),
             closure_basis = 'verified_remeasured',
             correction_ref = 'verified: every exact storm member financial alert is resolved (20261110061253)',
             root_cause = 'The original findings were resolved by their authoritative financial alert transitions. This capped incident retained their exact alert identities and every member now has a resolved financial record.',
             resolution = 'Closed after verifying all ' || v_members || ' exact storm member financial alerts exist, belong to ' || v_alert_source || ', and are resolved. No chips moved for incident closure.'
       WHERE id = v_storm.id
         AND status <> 'resolved';
    END IF;
  END LOOP;
END
$reconcile_resolved_storms$;

COMMIT;
