-- 20261118171613_tournament_and_club_lanes_fence_only_their_own_tables.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- AN AUTHORITY FENCES ONLY ITS OWN TABLES (incident 075013fd, lane T, part 2).
-- Owner ruling, 2026-11-17: "a tournament issue must always be isolated and
-- never affect other tournaments or cash games". Requires 20261118160405
-- (table writers take the hand barrier B, never the platform key G); refuses
-- to run if that is not installed. Full account:
-- docs/changelog/2026-11-18-an-authority-fences-only-its-own-tables.md.
--
-- WHAT WAS LEFT. After 20261118160405 a global authority that only QUEUES for
-- G pauses no table, but one that HOLDS the lane (G then B exclusive) still
-- pauses every table on the platform for its whole transaction. 30 functions
-- took it for work scoped to one club or one or two events: club retirement,
-- the welcome-package unwind (fn_remove_first_club_welcome_games, and the
-- club-create certification job on production, 6 stalls of up to 14.5 s on
-- 2026-11-17), the heads-up fixture unwind, deal review and final-table
-- deals, satellite seats and tickets, diamond and managed-game cancellation,
-- the retired-event void, legacy fee custody and the standalone settles.
-- The post-deploy account cleanup (scripts/ci/reserved-terminal-welcome-fixture.mjs)
-- also took it as a script statement.
--
-- THE FIX.
-- 1. public.fn_ca_lock_settlement_lane_for_club(club): G shared, F shared,
--    F(bank scope) exclusive, C(club) exclusive, then T(id) exclusive for each
--    of the club's live events in uuid order. Cash hand commits of that club
--    take C(club) shared (fn_ca_share_settlement_lane_for_table); the club's
--    tournament tables are fenced by their T. Nothing outside the club waits.
-- 2. public.fn_ca_lock_settlement_lane_for_event(id, exclusive): inside any
--    lane, or under the global lane, exactly what the global helper did
--    there (re-entry); otherwise the event's own lane - the satellite finish
--    lane for a satellite (both events' T in uuid order under F), the sweep
--    member lane (G s, F x, T x; what cancellation_lane accepts) when
--    exclusive, else the finish lane (G s, F s, F(scope) x, T x).
-- 3. The 30 callers take the scoped lane in place of the global helper: one
--    md5-pinned substitution each, post-image computed on production
--    read-only; the heads-up fixture's pin on the unwind body moves with it.
-- 4. fn_ca_lock_settlement_lane_global() refuses to be a script's top-level
--    statement as postgres (the certification job's shape); scripts take a
--    scoped lane.
-- 5. smarter_private.f06_table_guard no longer tries the lane for a
--    counter-only update (current_players, updated_at): the hand commit that
--    writes it already holds its T shared, so the try only produced 55P03.
-- 6. smarter_private.cancellation_lane accepts a club lane for a cancellation
--    of one of that club's own events (the welcome unwind cancels its unused
--    games through atomic_cancel_tournament), taking that event's T without
--    waiting; any other club's event is refused. Its standalone mode (try G
--    and B exclusive, never queued) is unchanged.
-- 7. Doctrine: the global lane's callers are now only the two multi-event
--    sweeps and the lane helpers; F may be taken by the club lane; a rolling
--    authority may not reach the club lane; its pin on cancellation_lane moves
--    to the new body.
--
-- INVARIANTS. Authority vs authority: every scoped lane takes G shared, so
-- the remaining global authorities (G exclusive) still exclude it, and F /
-- F(scope) / T keep the 2026-09-17 wallet order (finishes and club lanes of
-- one bank scope serialise on F(scope); satellite, sweep and exclusive event
-- lanes hold F exclusive). Authority vs hand writes: an event lane holds its
-- T exclusive (that event's writers hold T shared); a club lane holds C and
-- every live event's T (that club's cash commits hold C shared). Order
-- everywhere: G < F < F(scope) < B < C < T, and every multi-T holder either
-- holds F exclusive or is a club lane holding its F(scope) (club lanes of one
-- scope serialise; different scopes have disjoint events). Native proof:
-- scripts/ci/test-tournament-lane-isolation.py.
--
-- LOCK FOOTPRINT. CREATE / CREATE OR REPLACE FUNCTION only: no table or row
-- lock, no install window, one transaction, one schema reload.
--
-- STALE PINS. fn_ca_guard_mtt_admission_contract pins two bodies in its
-- activation manifest, read only on the legacy-capacity-v1 -> unlimited-mtt-v2
-- transition, which production completed (abi = unlimited-mtt-v2, immutable).
-- @stale-pin-ok: 7c759bb7a639c3124de2607bdbf12577 fn_ca_guard_mtt_admission_contract activation manifest; the transition it guards is complete and immutable
-- @stale-pin-ok: 503a9f90806bf5498ebd0b006dcc0641 fn_ca_guard_mtt_admission_contract activation manifest; the transition it guards is complete and immutable
--
-- @live-proof: (SELECT count(*) = 2 FROM pg_proc WHERE proname IN ('fn_ca_lock_settlement_lane_for_club','fn_ca_lock_settlement_lane_for_event') AND pronamespace = 'public'::regnamespace)

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $requires$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_share_settlement_lane_for_table(uuid)'::regprocedure)) <> 'ff501f74982567097241b1d90fbb4b96'
     OR md5(pg_get_functiondef('public.fn_ca_settlement_lane_doctrine()'::regprocedure)) <> 'a386f2d5adfbdc1a5ab2ee4a5bee298d' THEN
    RAISE EXCEPTION 'scoped lanes: 20261118160405 (table writers never take G) must be installed first';
  END IF;
END $requires$;

CREATE FUNCTION public.fn_ca_lock_settlement_lane_for_club(p_club uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_held text := COALESCE(current_setting('ca.club_lane', true), '');
  v_scope text;
  r record;
BEGIN
  /* THE CLUB LANE (20261118171613). A club operation (retirement, the
     welcome-package unwind, the heads-up fixture) fences that club and
     nothing else: G shared (the remaining global authorities still exclude
     it), F shared, the club's bank scope F(scope) exclusive (the 2026-09-17
     wallet order with this scope's finishes), C(club) exclusive (that club's
     cash hand commits hold it shared), then T exclusive for each of the
     club's live events in uuid order (their tables and authorities). */
  IF p_club IS NULL THEN
    RAISE EXCEPTION 'a club lane needs a club' USING ERRCODE = '22004';
  END IF;
  IF v_held <> '' AND v_held <> p_club::text THEN
    RAISE EXCEPTION 'club lane is held for club %, refused for %', v_held, p_club USING ERRCODE = '55000';
  END IF;
  IF COALESCE(current_setting('ca.finish_lane_tournament', true), '') <> '' THEN
    RAISE EXCEPTION 'a club lane cannot be taken inside an event lane' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(c.union_id::text, c.id::text) INTO v_scope FROM public.clubs c WHERE c.id = p_club;
  v_scope := COALESCE(v_scope, p_club::text);
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-terminal-settlement:v1', 0));
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-finish-lane:v1', 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca:tournament-finish-lane:v1:scope:' || v_scope, 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca:club-settlement-lane:v1:' || p_club::text, 0));
  FOR r IN
    SELECT t.id FROM public.tournaments t
     WHERE t.club_id = p_club
       AND upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED')
     ORDER BY t.id::text
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ca:tournament-terminal-settlement:v1:' || r.id::text, 0));
  END LOOP;
  PERFORM set_config('ca.club_lane', p_club::text, true);
END;
$function$;

CREATE FUNCTION public.fn_ca_lock_settlement_lane_for_event(p_tournament_id uuid, p_exclusive boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_g bigint := hashtextextended('ca:tournament-terminal-settlement:v1', 0);
  v_t bigint := hashtextextended('ca:tournament-terminal-settlement:v1:' || COALESCE(p_tournament_id::text, ''), 0);
  v_satellite boolean;
BEGIN
  /* THE EVENT LANE (20261118171613). Where a caller used to take the global
     lane for work on one event (or a satellite and its target):
     - inside any finish, satellite or sweep lane, or under the global lane,
       it does exactly what the global helper did there (re-entry);
     - inside a club lane it requires that the club lane holds this event;
     - otherwise it takes the event's own lane, which pauses no table and no
       authority outside the event (and its satellite target). */
  IF COALESCE(current_setting('ca.finish_lane_tournament', true), '') <> ''
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
                 WHERE l.pid = pg_backend_pid() AND l.locktype = 'advisory' AND l.objsubid = 1
                   AND l.granted AND l.mode = 'ExclusiveLock'
                   AND l.classid = ((v_g >> 32) & 4294967295)::oid
                   AND l.objid = (v_g & 4294967295)::oid) THEN
    PERFORM public.fn_ca_lock_settlement_lane_global();
    RETURN;
  END IF;
  IF COALESCE(current_setting('ca.club_lane', true), '') <> '' THEN
    IF p_tournament_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM pg_catalog.pg_locks l
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'advisory' AND l.objsubid = 1
            AND l.granted AND l.mode = 'ExclusiveLock'
            AND l.classid = ((v_t >> 32) & 4294967295)::oid
            AND l.objid = (v_t & 4294967295)::oid) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'event % is outside the club lane this transaction holds', p_tournament_id
      USING ERRCODE = '55000';
  END IF;
  IF p_tournament_id IS NULL THEN
    PERFORM public.fn_ca_lock_settlement_lane_global();
    RETURN;
  END IF;
  SELECT (lower(COALESCE(t.variant::text, '')) = 'satellite'
          OR upper(COALESCE(t.tournament_type::text, '')) = 'SATELLITE'
          OR t.satellite_target_id IS NOT NULL
          OR t.satellite_target IS NOT NULL)
    INTO v_satellite
    FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    PERFORM public.fn_ca_lock_settlement_lane_global();
  ELSIF v_satellite THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_satellite_finish(p_tournament_id);
  ELSIF p_exclusive THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_sweep_member(p_tournament_id);
  ELSE
    PERFORM public.fn_ca_lock_settlement_lane_for_finish(p_tournament_id);
  END IF;
END;
$function$;

ALTER FUNCTION public.fn_ca_lock_settlement_lane_for_club(uuid) OWNER TO postgres;
ALTER FUNCTION public.fn_ca_lock_settlement_lane_for_event(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_ca_lock_settlement_lane_for_club(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_lock_settlement_lane_for_event(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_lock_settlement_lane_for_club(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_lock_settlement_lane_for_event(uuid, boolean) TO service_role;

-- Lane helpers, the hand commit, the table guard and the doctrine.
DO $helpers$
DECLARE
  r record;
  i integer;
  v_sig regprocedure;
  v_def text;
  v_n integer;
  v_acl text; v_owner oid; v_definer boolean; v_config text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('public.fn_ca_lock_settlement_lane_global()', '7c759bb7a639c3124de2607bdbf12577',
     ARRAY[$o1$BEGIN
  -- Inside a non-satellite finish (2026-09-17)$o1$],
     ARRAY[$n1$BEGIN
  -- 20261118171613: never a script's own lock. A top-level
  -- "SELECT fn_ca_lock_settlement_lane_global()" from a postgres session is
  -- a job holding every authority on the platform for its own transaction
  -- (the club-create certification did it six times on 2026-11-17); a
  -- script takes fn_ca_lock_settlement_lane_for_club or _for_event.
  IF session_user = 'postgres'
     AND current_query() ~* '^\s*select\s+(public\.)?fn_ca_lock_settlement_lane_global\s*\(\s*\)\s*;?\s*$' THEN
    RAISE EXCEPTION 'GLOBAL_LANE_IS_NOT_A_SCRIPT_LOCK: take fn_ca_lock_settlement_lane_for_club or fn_ca_lock_settlement_lane_for_event'
      USING ERRCODE = '42501';
  END IF;
  -- Inside a non-satellite finish (2026-09-17)$n1$]),
    ('public.fn_ca_share_settlement_lane_for_table(uuid)', 'ff501f74982567097241b1d90fbb4b96',
     ARRAY[$o2$  v_tournament_id uuid;
$o2$, $o3$  SELECT tb.tournament_id INTO v_tournament_id
$o3$, $o4$      hashtextextended('ca:tournament-terminal-settlement:v1:' || v_tournament_id::text, 0));
  END IF;
$o4$],
     ARRAY[$n2$  v_tournament_id uuid;
  v_club uuid;
$n2$, $n3$  SELECT tb.tournament_id, tb.club_id INTO v_tournament_id, v_club
$n3$, $n4$      hashtextextended('ca:tournament-terminal-settlement:v1:' || v_tournament_id::text, 0));
  ELSIF v_club IS NOT NULL THEN
    -- 20261118171613: a cash hand yields to its own club's lane (C(club)
    -- exclusive, taken by club retirement and the welcome unwind), never
    -- to another club's.
    PERFORM pg_advisory_xact_lock_shared(
      hashtextextended('ca:club-settlement-lane:v1:' || v_club::text, 0));
  END IF;
$n4$]),
    ('smarter_private.f06_table_guard()', 'd8775467cf3f807b1992be752638d308',
     ARRAY[$o5$ PERFORM smarter_private.f06_try_lane(OLD.tournament_id);
$o5$],
     ARRAY[$n5$ -- 20261118171613: a counter-only update (the hand commit's
 -- current_players) is written under the hand's own T shared; trying the lane
 -- for it proved nothing and refused it whenever an authority was queued.
 IF TG_OP='DELETE' OR (to_jsonb(NEW) - ARRAY['current_players','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['current_players','updated_at']) THEN
 PERFORM smarter_private.f06_try_lane(OLD.tournament_id);
 END IF;
$n5$]),
    ('smarter_private.cancellation_lane(uuid)', 'bc4f86f56d7349416264a237817969b2',
     ARRAY[$o9$ -- A marker alone is never authority. Validate its existing global/event
$o9$],
     ARRAY[$n9$ -- 20261118171613: inside a club lane (fn_ca_lock_settlement_lane_for_club:
 -- G shared, F shared, the club's bank scope and C(club) exclusive, every live
 -- event of the club exclusive) a cancellation of one of that club's events
 -- (the welcome unwind cancels its unused games) has its whole authority:
 -- the event's T is held or taken here without waiting.
 IF COALESCE(current_setting('ca.club_lane',true),'')<>'' AND held='' AND scope='' THEN
  IF NOT gs OR NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id
       AND t.club_id::text=current_setting('ca.club_lane',true))
     OR NOT pg_try_advisory_xact_lock(hashtextextended('ca:tournament-terminal-settlement:v1:'||p_tournament_id::text,0)) THEN
   RAISE EXCEPTION 'CANCELLATION_CLUB_AUTHORITY_INCOMPLETE' USING ERRCODE='55000';
  END IF;
  RETURN;
 END IF;
 -- A marker alone is never authority. Validate its existing global/event
$n9$]),
    ('public.fn_ca_settlement_lane_doctrine()', 'a386f2d5adfbdc1a5ab2ee4a5bee298d',
     ARRAY[$o6$  v_global_allowed CONSTANT text[] := ARRAY[
    'atomic_cancel_tournament','fn_ca_operator_cancel_tournament','fn_award_satellite_seat','fn_backpay_unfinalised_bounty_pools',
    'fn_begin_tournament_deal_review','fn_ca_lock_settlement_lane_for_finish',
    'fn_ca_lock_settlement_lane_for_satellite_finish',
    'fn_ca_return_satellite_entitlement_as_ticket','fn_ca_tournament_deal_snapshot',
    'fn_cancel_tournament_deal_review','fn_close_managed_game','fn_close_tournament_deal_review',
    'fn_complete_tournament_terminal_pre_seat_guard','fn_complete_tournament_terminal_proposal',
    'fn_deliver_satellite_ticket_exact','fn_execute_managed_game_command','fn_finalize_bounty_pool',
    'fn_get_tournament_deal_consensus','fn_mystery_bounty_settle','fn_poker_diamond_cancel_tournament',
    'fn_poker_diamond_tournament_cancel','fn_remove_first_club_welcome_games','fn_retire_settled_club','fn_unwind_unused_first_club_welcome_package',
    'fn_request_tournament_deal_review','fn_resolve_satellite_settlement_outcome',
    'fn_resolve_tournament_terminal_proposal_outcome','fn_settle_final_table_deal_atomic',
    'fn_settle_satellite_finish_atomic','fn_settle_tournament_final_table_deal',
    'fn_ca_begin_legacy_fee_resolution','fn_ca_hold_legacy_tournament_fee',
    'fn_settle_tournament_places','fn_settle_tournament_rake','fn_sweep_unsettled_tournament_rake',
    'fn_ca_bounty_only_pko_final_two'];
$o6$, $o7$     'fn_ca_lock_settlement_lane_for_finish,fn_ca_lock_settlement_lane_for_satellite_finish,'
$o7$, $o8$      IF r.callee = 'fn_ca_lock_settlement_lane_global' OR r.callee = ANY (v_globals) THEN
$o8$, $o10$       AND md5(pg_get_functiondef(p.oid))='bc4f86f56d7349416264a237817969b2'
$o10$],
     ARRAY[$n6$  -- 20261118171613: work on one club or one event takes the club lane or
  -- the event lane, which fence only that club or event. The global lane
  -- (every table on the platform while held) is left to the two multi-event
  -- sweeps and the lane helpers' own fallbacks.
  v_global_allowed CONSTANT text[] := ARRAY[
    'fn_backpay_unfinalised_bounty_pools','fn_sweep_unsettled_tournament_rake',
    'fn_ca_lock_settlement_lane_for_finish','fn_ca_lock_settlement_lane_for_satellite_finish',
    'fn_ca_lock_settlement_lane_for_event'];
$n6$, $n7$     'fn_ca_lock_settlement_lane_for_club,fn_ca_lock_settlement_lane_for_finish,fn_ca_lock_settlement_lane_for_satellite_finish,'
$n7$, $n8$      IF r.callee = 'fn_ca_lock_settlement_lane_global' OR r.callee = ANY (v_globals)
         OR r.callee = 'fn_ca_lock_settlement_lane_for_club' THEN
$n8$, $n10$       AND md5(pg_get_functiondef(p.oid))='d66f767af93b4c9e93c42bcc9472005e'
$n10$])
    ) AS s(signature, preimage, olds, news)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'scoped lanes: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    FOR i IN 1 .. cardinality(r.olds) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'scoped lanes: % anchor % occurs % times', r.signature, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_def;
    IF pg_get_functiondef(v_sig) IS DISTINCT FROM v_def
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
            AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
            AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'scoped lanes: % did not land as written, or its metadata changed', r.signature;
    END IF;
    RAISE NOTICE '% post-image md5 %', r.signature, md5(v_def);
  END LOOP;
END $helpers$;

-- @begin caller substitutions
DO $callers$
DECLARE
  r record;
  v_sig regprocedure;
  v_def text;
  v_new text;
  v_n integer;
  v_acl text; v_owner oid; v_definer boolean; v_config text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('public.fn_award_satellite_seat(uuid,uuid,uuid,text,integer)', 'd35f7ed56d4ec85b7ffa7cd411109ecd', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_satellite_id);$new$, 'd539843e84eb57ad24a6aa7ae142322d'),
    ('public.fn_begin_tournament_deal_review(uuid,uuid)', '38ef591da01466c0a69a2e43e41ef218', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '55f68d6278a92d4c2fcad2ce411458e9'),
    ('public.fn_ca_begin_legacy_fee_resolution(uuid)', 'bdcedd8acbf81c2f925d390d825d422c', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '6ea64e2663eaad9bb29a4cb079bc4d5c'),
    ('public.fn_ca_bounty_only_pko_final_two(uuid)', '30a52bfbfc283f59924a22a18f116d06', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '3c2f837c28ca4f3c81be2ccc6a38e0fe'),
    ('public.fn_ca_hold_legacy_tournament_fee(uuid,text)', '0ae6944a5d05e2eadcaa5ad698bb3a92', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '7bba38cc56382f110bd5dcd531f3f8e9'),
    ('public.fn_ca_return_satellite_entitlement_as_ticket(uuid,text,text)', '6e1ec5ea807a7e80ca6bf294f218997b', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(v_tournament_id);$new$, 'badd61dbe4dc344ab693663e0a19cf77'),
    ('public.fn_ca_tournament_deal_snapshot(uuid)', '42cc7f84771a104957d2429311e983cb', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '3cc3cd0265a4b4c276eb318c2d93b50d'),
    ('public.fn_cancel_tournament_deal_review(uuid,uuid,uuid)', 'b9f41b13612f793729a9409511fea48f', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '304d1f41c07d62fa8c7dddc4d3f4b662'),
    ('public.fn_close_tournament_deal_review(uuid,uuid,text)', 'caf796a4fd545a1c1e68a5c0c1de3af4', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '9830903b1928409849f7353aa9465782'),
    ('public.fn_complete_tournament_terminal_pre_seat_guard(uuid,uuid,text)', '6f526acdf5150c7f7ec8d83b5b069519', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, 'ce6c0db83ade41d9fd4d99d6e9f399ed'),
    ('public.fn_complete_tournament_terminal_proposal(uuid,uuid,text,uuid,text)', '20a359f0554e5eaaa58dd0ae4be14864', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, 'ef84375c65af71324ac76723358c43de'),
    ('public.fn_deliver_satellite_ticket_exact(uuid,uuid,uuid,text,integer,numeric)', '503a9f90806bf5498ebd0b006dcc0641', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_satellite_id);$new$, 'cd83686d3b353f6f7778add3dc72034a'),
    ('public.fn_execute_managed_game_command(uuid,text,uuid,text,integer,jsonb)', '5a98aec56bdd4815393ab20cc202d4ae', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_game_id, true);$new$, 'd2617f867a6e64ccb824ec4ea1c89b2c'),
    ('public.fn_finalize_bounty_pool(uuid,uuid)', '707cefa7cf781542a09934fa8df0b134', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, 'a132e18070ebefb391b3feebd7c8a1df'),
    ('public.fn_get_tournament_deal_consensus(uuid)', 'f799fdcd4c862cbf288dcb03e12a5534', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '6db391fa0a88ca1460f560e45ae780ae'),
    ('public.fn_mystery_bounty_settle(uuid,uuid)', 'fe3b1540a94cbb88114283d8082d806a', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, 'f87779d3eb6f4edd32fb738802126844'),
    ('public.fn_poker_diamond_cancel_tournament(uuid)', 'bb382f4aac55b0fc59507d37aee54f44', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id, true);$new$, '8ea2bcdcb90e081a396a50ad91eaa9d7'),
    ('public.fn_request_tournament_deal_review(uuid,uuid)', '3613e972d0785e1ab253396b684c2c58', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '7b1f85cfba2046f83b34f2ab03930b5d'),
    ('public.fn_resolve_satellite_settlement_outcome(uuid,uuid)', '340b06dc703f230ab2e7fc0dff174c41', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '3fb65247596eca99fa6b6fe71ea30ed9'),
    ('public.fn_resolve_tournament_terminal_proposal_outcome(uuid,uuid,text,uuid,text)', '3b9c4472cf38ac7e622b0fa7b3625c4f', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, 'd6bfcca27297199092739766e1dd4501'),
    ('public.fn_retire_settled_club(uuid,text,text)', '2c6890c42f1a0b446856b2702c7b46b5', $new$PERFORM public.fn_ca_lock_settlement_lane_for_club(p_club_id);$new$, '233f200a34b227703b6a9d5a8aa3c321'),
    ('public.fn_settle_final_table_deal_atomic(uuid)', '26fe5e16e89f4ca0b16eb71027abec4d', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '4e3ad3521f00e4bb09404ff9a9ceeb1a'),
    ('public.fn_settle_satellite_finish_atomic(uuid,text)', 'df08610be815463f0b709d680c1ab9eb', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, 'b8c823d4f14bf715a23fd5f2ea6ca013'),
    ('public.fn_settle_tournament_final_table_deal(uuid)', '812112adeecbebd52fa5b96ed2e973a9', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '08c283656d38471b3e6553bb8ad98e20'),
    ('public.fn_settle_tournament_places(uuid,uuid)', '89b4ff8fb3095497babbec9064d92196', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, '4459254ef9159070fd6bc9a69d4bcd5d'),
    ('public.fn_settle_tournament_rake(uuid,text)', 'eb274b45fd978ad295f2161a69ccb8ea', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id);$new$, 'ed9c8f7380d9c260d83313e27750c8b7'),
    ('public.fn_unwind_unused_first_club_welcome_package(uuid,uuid)', '68a129330e900f837c4222b6a49ae470', $new$PERFORM public.fn_ca_lock_settlement_lane_for_club(p_club_id);$new$, '31b3749dd0afa5212ccf5ec00140e0ee'),
    ('smarter_private.f06_void_retired_mixed_custody_event(uuid,text)', '136f37af859dea2e4da40c05ace6a68f', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event(p_tournament_id, true);$new$, '2ec770e6427119374440eec0dd2ac817'),
    ('smarter_private.lock_terminal_request_lane(jsonb)', '879072020cd7593676ea48361e309bd2', $new$PERFORM public.fn_ca_lock_settlement_lane_for_event((p_request->>'tournamentId')::uuid);$new$, '1daae73f7ac259d3f77b357e2e85e999'),
    ('smarter_private.unwind_heads_up_fixture(uuid,uuid,uuid[])', '27528b6295ba28e8fbcb6d84d868b2fb', $new$PERFORM public.fn_ca_lock_settlement_lane_for_club(p_club_id);$new$, 'b04562851fbfbea1e5c84969ed9e7d24'),
    ('public.fn_ca_retire_heads_up_fixture(uuid,text)', '4a64543ec3a196368ec943766e0afa11', NULL, 'c6215d35774bce307e68bbd6b644e0cf')
    ) AS s(signature, preimage, new_text, postimage)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'scoped lanes: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    IF r.new_text IS NULL THEN
      -- The heads-up fixture refuses unless the unwind body is the one it
      -- qualified: move its pin to the unwind's reviewed post-image.
      v_n := (length(v_def) - length(replace(v_def, '68a129330e900f837c4222b6a49ae470', ''))) / 32;
      v_new := replace(v_def, '68a129330e900f837c4222b6a49ae470', '31b3749dd0afa5212ccf5ec00140e0ee');
    ELSE
      v_n := (length(v_def) - length(replace(v_def, 'PERFORM public.fn_ca_lock_settlement_lane_global();', '')))
             / length('PERFORM public.fn_ca_lock_settlement_lane_global();');
      v_new := replace(v_def, 'PERFORM public.fn_ca_lock_settlement_lane_global();', r.new_text);
    END IF;
    IF v_n <> 1 OR md5(v_new) <> r.postimage THEN
      RAISE EXCEPTION 'scoped lanes: % anchor count % or post-image % is not the reviewed one', r.signature, v_n, md5(v_new);
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_new;
    IF md5(pg_get_functiondef(v_sig)) <> r.postimage
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
            AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
            AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'scoped lanes: % did not land on its post-image, or its metadata changed', r.signature;
    END IF;
  END LOOP;
END $callers$;
-- @end caller substitutions

DO $post$
DECLARE
  v_doctrine jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.fn_ca_lock_settlement_lane_global()', '71c46ff5a6865ef17ef9fb8d704fc9d5'),
      ('public.fn_ca_share_settlement_lane_for_table(uuid)', '5f5271b1c1c630f8bc0b66abe9bf1144'),
      ('smarter_private.f06_table_guard()', '08f84155a603076693d56f086add0b77'),
      ('smarter_private.cancellation_lane(uuid)', 'd66f767af93b4c9e93c42bcc9472005e'),
      ('public.fn_ca_settlement_lane_doctrine()', '203a70a10f5398414e831d1d073334d9'),
      ('public.fn_ca_lock_settlement_lane_for_club(uuid)', '34e6fce6e778850f13e32ef3922049bb'),
      ('public.fn_ca_lock_settlement_lane_for_event(uuid,boolean)', 'a85d48e2b4bd0420520fa9697df6a147')
    ) AS x(sig, post)
    WHERE md5(pg_get_functiondef(x.sig::regprocedure)) IS DISTINCT FROM x.post) THEN
    RAISE EXCEPTION 'scoped lanes: a lane helper is not its reviewed text';
  END IF;
  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'scoped lanes: the lane doctrine fails after the change: %', v_doctrine;
  END IF;
END $post$;

COMMIT;
