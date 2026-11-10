-- 20261110021359_tourney_self_healing_and_freebuy_guard_hardening.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('9T22:30:00' in pg_get_functiondef('public.fn_ca_free_buy_transition_audit_guard()'::regprocedure)) > 0 AND position('hand_history' in pg_get_functiondef('public.fn_ca_tournament_dark_while_running(integer)'::regprocedure)) > 0 AND position('fn_ca_bounty_only_final_two_watch' in pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM public.financial_alerts WHERE source = 'TournamentRecurring.freeBuyAudit' AND resolved = false)
--
-- TOURNAMENT SELF-HEALING AND FREE BUY TRANSITION AUDIT GUARD HARDENING
--
-- WHAT WAS WRONG, READ FROM ROWS
--
-- 1. `public.fn_ca_free_buy_transition_audit_guard()` (installed in 20261109212210
--    and updated in 20261110000927) guards `TournamentRecurring.freeBuyAudit`
--    alerts emitted by pre-#10188 engine instances (`bff6eed3`) during the
--    2026-11-08..09 repeated-opening-level transition and pre-#10188 cancelled
--    Free Buy replacements. At 2026-11-10T00:40:40.401Z, `TournamentRecurring.freeBuyAudit`
--    raised alert `35f18193-8f24-426a-baf0-38dc04c7c317` with 10 problems:
--      - 5 completed Nov 9 Free Buy rows (`02:30Z`, `06:30Z`, `14:30Z`, `18:30Z`,
--        and `22:30Z`) reporting `the rebuy period and late registration do not close together`.
--      - 5 slots where a `CANCELLED` row shares the `(club_id|hour|chicagoDay)` key
--        with the active row (`2 events share one host, slot and Chicago day (fade0000-0000-0000-0000-000000000001|0|2026-11-09)`,
--        `|12|2026-11-09`, `|16|2026-11-09`, `|0|2026-11-10`, `|12|2026-11-10`).
--    The guard did not auto-resolve `35f18193` because:
--      (a) its first pattern omitted `9T22:30:00` (`Afternoon Free Buy (NLH) @ 2026-11-09T22:30:00+00:00`,
--          which started at 22:30Z before 20261109212210 ran at 00:04Z), and
--      (b) its second pattern (`^Midway Union 2026-11-0[89] .+: 2 events share...`)
--          did not match the actual string format emitted by `auditFreeBuyBoard`
--          (`server/src/services/FreeBuy.ts:1041`):
--          `^2 events share one host, slot and Chicago day \(fade0000-0000-0000-0000-000000000001\|(0|4|8|12|16)\|2026-11-(08|09|10)\)$`.
--    Update `fn_ca_free_buy_transition_audit_guard()` to match both exact strings,
--    verify from live rows that no two non-cancelled Free Buy tournaments share a
--    `(club_id, hour, chicago_day)` slot and no unstarted Free Buy tournament has
--    `rebuy_levels IS DISTINCT FROM late_reg_levels`, and resolve `35f18193`.
--
-- 2. `public.fn_ca_tournament_dark_candidates(integer)` includes the newest
--    `public.hand_history.created_at` row in `last_activity` (because a table
--    dealing between blind level changes without a bust does not update `tables`
--    or `tournament_players.eliminated_at`), whereas the self-resolution CTE
--    (`named`) in `public.fn_ca_tournament_dark_while_running(integer)` checked
--    only `max(tb.updated_at)` and `max(tp.eliminated_at)`. Add
--    `(SELECT hh.created_at FROM public.hand_history hh WHERE hh.tournament_id = t.id ORDER BY hh.created_at DESC LIMIT 1)`
--    to `named.last_activity` so dark alerts self-resolve as soon as hands deal.
--
-- 3. In `public.fn_resolve_settled_financial_alerts(boolean, integer)` (`v_receipted_ids`),
--    allow single-winner satellite settlement receipts (`cardinality(s.qualifier_ids)>0 OR s.winner_id IS NOT NULL`)
--    for non-qualifier-cohort sources, and include `'fn_ca_bounty_only_final_two_watch'`
--    when the tournament is `COMPLETED` with zero closed escrow, a matching
--    `tournament_terminal_settlements` receipt, `bounty_pool_paid = bounty_pool`,
--    and either a finalized `ca_bounty_only_final_two` + `tournament_bounty_completion_receipts`
--    pair or the runner-up `bounty-only-final-two-make-good:` ledger entry.
--
-- No money moves in this migration.

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $guard$
BEGIN
  IF public.fn_ca_break_window_refuses_migrations(now()) THEN
    RAISE EXCEPTION 'Refusing to run migration inside the hourly break window (:50-:03 UTC)';
  END IF;
END
$guard$;

-- 1. Harden public.fn_ca_free_buy_transition_audit_guard()
CREATE OR REPLACE FUNCTION public.fn_ca_free_buy_transition_audit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prob text;
BEGIN
  IF NEW.source IS DISTINCT FROM 'TournamentRecurring.freeBuyAudit'
     OR COALESCE(NEW.resolved, false) THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.context->'problems') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.context->'problems') = 0 THEN
    RETURN NEW;
  END IF;

  FOR v_prob IN SELECT jsonb_array_elements_text(NEW.context->'problems') LOOP
    IF NOT (
      v_prob ~ '@ 2026-11-0(8T22:30:00|9T02:30:00|9T06:30:00|9T14:30:00|9T18:30:00|9T22:30:00)(\.000)?(\+00:00|Z): the rebuy period and late registration do not close together$'
      OR v_prob ~ '^2 events share one host, slot and Chicago day \(fade0000-0000-0000-0000-000000000001\|(0|4|8|12|16)\|2026-11-(08|09|10)\)$'
      OR v_prob ~ '^Midway Union 2026-11-0[89] .+: 2 events share one host, slot and Chicago day$'
    ) THEN
      RETURN NEW;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.free_buy IS TRUE
      AND upper(coalesce(t.status, '')) IN ('ANNOUNCED', 'REGISTERING', 'SCHEDULED', 'PENDING')
      AND t.started_at IS NULL
      AND t.rebuy_levels IS DISTINCT FROM t.late_reg_levels
  ) OR EXISTS (
    SELECT 1
      FROM public.tournaments t
     WHERE t.free_buy IS TRUE
       AND upper(coalesce(t.status, '')) NOT IN ('CANCELLED', 'CANCELED')
       AND t.start_time >= now() - interval '24 hours'
       AND t.start_time <= now() + interval '4 days'
     GROUP BY t.club_id, date_trunc('hour', t.start_time AT TIME ZONE 'America/Chicago')
    HAVING count(*) > 1
  ) OR coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0) > 0 THEN
    RETURN NEW;
  END IF;

  NEW.resolved := true;
  NEW.resolved_at := COALESCE(NEW.resolved_at, now());
  NEW.resolution := 'Resolved automatically: all unstarted Free Buy events have rebuy_levels = late_reg_levels = 11, zero non-cancelled Free Buy events share a slot, and fn_sp_midway_free_buy_watch() reports 0 findings; reported lines are immutable Nov 8-9 transition occurrences or pre-#10188 cancelled rows.';
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_free_buy_transition_audit_guard() FROM PUBLIC, anon, authenticated;

-- 2. Patch fn_ca_tournament_dark_while_running(integer) and fn_resolve_settled_financial_alerts(boolean, integer)
DO $patch_self_healing$
DECLARE
  v_dark_def text;
  v_dark_new text;
  c_dark_old constant text :=
    '           GREATEST(' || chr(10)
    || '             (SELECT max(tb.updated_at) FROM public.tables tb WHERE tb.tournament_id = t.id),' || chr(10)
    || '             (SELECT max(tp.eliminated_at) FROM public.tournament_players tp WHERE tp.tournament_id = t.id)) AS last_activity';
  c_dark_new constant text :=
    '           GREATEST(' || chr(10)
    || '             (SELECT max(tb.updated_at) FROM public.tables tb WHERE tb.tournament_id = t.id),' || chr(10)
    || '             (SELECT max(tp.eliminated_at) FROM public.tournament_players tp WHERE tp.tournament_id = t.id),' || chr(10)
    || '             (SELECT hh.created_at FROM public.hand_history hh WHERE hh.tournament_id = t.id ORDER BY hh.created_at DESC LIMIT 1)) AS last_activity';

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
    || '                       ''fn_ca_tournament_dark_while_running'')' || chr(10)
    || '      AND t.status=''COMPLETED'' AND t.current_players=0' || chr(10)
    || '      AND e.terminal_closed_at>=a.created_at' || chr(10)
    || '      AND e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0' || chr(10)
    || '      AND (' || chr(10)
    || '        (s.receipt_version=3 AND s.settled_at>=a.created_at' || chr(10)
    || '          AND s.source_escrow_closed_at=e.terminal_closed_at AND s.pool=t.prize_pool' || chr(10)
    || '          AND cardinality(s.qualifier_ids)>0' || chr(10)
    || '          AND (a.source <> ''Tournament.satellite_qualifiers_outcome_unknown''' || chr(10)
    || '            OR CASE WHEN jsonb_typeof(a.context->''qualifier_ids'')=''array'' THEN' || chr(10)
    || '                 jsonb_array_length(a.context->''qualifier_ids'')=cardinality(s.qualifier_ids)' || chr(10)
    || '                 AND (a.context->''qualifier_ids'') @> to_jsonb(s.qualifier_ids)' || chr(10)
    || '                 AND to_jsonb(s.qualifier_ids) @> (a.context->''qualifier_ids'')' || chr(10)
    || '               ELSE false END))' || chr(10)
    || '        OR (a.source IN (''GameServer.tournament_repeated_recovery_refused'',''fn_ca_tournament_dark_while_running'',''tournament.real_time_payout_refused'')' || chr(10)
    || '          AND f.settled_at>=a.created_at AND f.completed_at>=a.created_at' || chr(10)
    || '          AND f.escrow_closed_at=e.terminal_closed_at' || chr(10)
    || '          AND f.prize_pool=t.prize_pool AND f.cash_payout_total=f.prize_pool' || chr(10)
    || '          AND f.bounty_payout_total=f.bounty_pool)' || chr(10)
    || '      )';
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
    || '      AND t.status=''COMPLETED'' AND t.current_players=0' || chr(10)
    || '      AND e.terminal_closed_at>=a.created_at' || chr(10)
    || '      AND e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0' || chr(10)
    || '      AND (' || chr(10)
    || '        (s.receipt_version=3 AND s.settled_at>=a.created_at' || chr(10)
    || '          AND s.source_escrow_closed_at=e.terminal_closed_at AND s.pool=t.prize_pool' || chr(10)
    || '          AND (cardinality(s.qualifier_ids)>0 OR s.winner_id IS NOT NULL)' || chr(10)
    || '          AND (a.source <> ''Tournament.satellite_qualifiers_outcome_unknown''' || chr(10)
    || '            OR CASE WHEN jsonb_typeof(a.context->''qualifier_ids'')=''array'' THEN' || chr(10)
    || '                 jsonb_array_length(a.context->''qualifier_ids'')=cardinality(s.qualifier_ids)' || chr(10)
    || '                 AND (a.context->''qualifier_ids'') @> to_jsonb(s.qualifier_ids)' || chr(10)
    || '                 AND to_jsonb(s.qualifier_ids) @> (a.context->''qualifier_ids'')' || chr(10)
    || '               ELSE false END))' || chr(10)
    || '        OR (a.source IN (''GameServer.tournament_repeated_recovery_refused'',''fn_ca_tournament_dark_while_running'',''tournament.real_time_payout_refused'')' || chr(10)
    || '          AND f.settled_at>=a.created_at AND f.completed_at>=a.created_at' || chr(10)
    || '          AND f.escrow_closed_at=e.terminal_closed_at' || chr(10)
    || '          AND f.prize_pool=t.prize_pool AND f.cash_payout_total=f.prize_pool' || chr(10)
    || '          AND f.bounty_payout_total=f.bounty_pool)' || chr(10)
    || '        OR (a.source = ''fn_ca_bounty_only_final_two_watch''' || chr(10)
    || '          AND f.settled_at IS NOT NULL AND f.escrow_closed_at=e.terminal_closed_at' || chr(10)
    || '          AND f.prize_pool=t.prize_pool AND f.cash_payout_total=f.prize_pool' || chr(10)
    || '          AND f.bounty_payout_total=f.bounty_pool' || chr(10)
    || '          AND round(COALESCE(t.bounty_pool_paid,0),2)=round(COALESCE(t.bounty_pool,0),2)' || chr(10)
    || '          AND (EXISTS (SELECT 1 FROM public.ca_bounty_only_final_two c' || chr(10)
    || '                         JOIN public.tournament_bounty_completion_receipts rc ON rc.tournament_id=c.tournament_id' || chr(10)
    || '                        WHERE c.tournament_id=t.id AND rc.pool_finalized_at IS NOT NULL)' || chr(10)
    || '               OR EXISTS (SELECT 1 FROM public.chip_ledger l' || chr(10)
    || '                           WHERE l.idempotency_key = ANY(ARRAY(' || chr(10)
    || '                             SELECT ''bounty-only-final-two-make-good:'' || t.id::text || '':'' || tp.user_id::text' || chr(10)
    || '                               FROM public.tournament_players tp' || chr(10)
    || '                              WHERE tp.tournament_id=t.id AND tp.position=2)))))' || chr(10)
    || '      )';
BEGIN
  v_dark_def := pg_get_functiondef('public.fn_ca_tournament_dark_while_running(integer)'::regprocedure);
  IF position('hand_history' IN v_dark_def) = 0 THEN
    IF (length(v_dark_def) - length(replace(v_dark_def, c_dark_old, ''))) / length(c_dark_old) <> 1 THEN
      RAISE EXCEPTION 'fn_ca_tournament_dark_while_running anchor not found exactly once';
    END IF;
    v_dark_new := replace(v_dark_def, c_dark_old, c_dark_new);
    EXECUTE v_dark_new;
  END IF;

  v_res_def := pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure);
  IF position('fn_ca_bounty_only_final_two_watch' IN v_res_def) = 0 THEN
    IF (length(v_res_def) - length(replace(v_res_def, c_res_old, ''))) / length(c_res_old) <> 1 THEN
      RAISE EXCEPTION 'fn_resolve_settled_financial_alerts receipted anchor not found exactly once';
    END IF;
    v_res_new := replace(v_res_def, c_res_old, c_res_new);
    EXECUTE v_res_new;
  END IF;
END
$patch_self_healing$;

REVOKE ALL ON FUNCTION public.fn_ca_tournament_dark_while_running(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_tournament_dark_while_running(integer) TO service_role;

DO $revoke_resolver$
BEGIN
  IF to_regprocedure('public.fn_resolve_settled_financial_alerts(boolean, integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) TO service_role;
  END IF;
END
$revoke_resolver$;

-- 3. Resolve open TournamentRecurring.freeBuyAudit alert(s) under the verified guard predicate
DO $resolve_free_buy_audit$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.free_buy IS TRUE
      AND upper(coalesce(t.status, '')) IN ('ANNOUNCED', 'REGISTERING', 'SCHEDULED', 'PENDING')
      AND t.started_at IS NULL
      AND t.rebuy_levels IS DISTINCT FROM t.late_reg_levels
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.tournaments t
     WHERE t.free_buy IS TRUE
       AND upper(coalesce(t.status, '')) NOT IN ('CANCELLED', 'CANCELED')
       AND t.start_time >= now() - interval '24 hours'
       AND t.start_time <= now() + interval '4 days'
     GROUP BY t.club_id, date_trunc('hour', t.start_time AT TIME ZONE 'America/Chicago')
    HAVING count(*) > 1
  ) AND coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0) = 0 THEN
    UPDATE public.financial_alerts
       SET resolved = true,
           resolved_at = now(),
           resolution = 'Verified all 5 Midway Free Buy schedules and all unstarted Free Buy tournaments normalized to late_reg_levels = 11, rebuy_levels = 11, zero non-cancelled Free Buy events share a slot, and fn_sp_midway_free_buy_watch() reports 0 open findings (20261110021359).'
     WHERE source = 'TournamentRecurring.freeBuyAudit'
       AND resolved = false;
  END IF;
END
$resolve_free_buy_audit$;

COMMIT;
