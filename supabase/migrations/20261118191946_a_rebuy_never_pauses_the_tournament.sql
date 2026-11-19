-- 20261118191946_a_rebuy_never_pauses_the_tournament.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A REBUY NEVER PAUSES THE TOURNAMENT (incident 075013fd, lane R).
-- Owner rule, Dan 2026-08-30: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
-- ACTION." Requires 20261118160405 and 20261118171613 (lane T: table writers
-- take the hand barrier B, never G; a counter-only table update does not try
-- the lane); refuses to run if they are not installed. Full account:
-- docs/changelog/2026-11-18-a-rebuy-never-pauses-the-tournament.md.
--
-- THE DEFECT, MEASURED ON PRODUCTION (2026-11-18 15:02-15:33 UTC, Morning
-- Free Buy 7004d241, 61 tables). process_tournament_rebuy took its event's
-- rolling lane, T(id) = 'ca:tournament-terminal-settlement:v1:<id>'
-- EXCLUSIVE, for its whole transaction: 375 ms on average, 28.7 s at most,
-- about 21 rebuys a minute. Every per-hand F06 call, card write and hand
-- settlement of the event takes T(id) SHARED, so all 61 tables queued behind
-- every rebuy; fold p90 went to 5.9-10.7 s. Two more things held the event
-- still once the lane was gone, and they are fixed here too, or moving the
-- lock would only move the queue:
--  * fn_ca_lock_tournament_seat_acquisition, called by the rebuy, locks EVERY
--    table row, roster row and live seat of the event FOR UPDATE, which every
--    hand writer then waits for in its own row locks.
--  * the seat root guard (fn_tournament_live_seat_acquisition_requires_
--    authority) and the F06 source guard (smarter_private.f06_source_guard,
--    through f06_try_lane) accept a chair or roster coordinate write only
--    from a holder of T(id) EXCLUSIVE, so a rebuy holding T(id) shared would
--    be refused whenever any hand of the event is in flight.
--
-- THE FIX.
-- 1. public.fn_ca_share_tournament_lane_for_rebuy(event, player): the rebuy
--    key R(id) = 'ca:tournament-rebuy-lane:v1:<id>' EXCLUSIVE (one purchase
--    of an event at a time: capacity, chip-cap and roster checks stay exact),
--    then G SHARED and T(id) SHARED, then a transaction-local marker
--    'event:player:txid' in ca.tournament_rebuy_lane.
-- 2. smarter_private.tournament_rebuy_lane_held(event, player): the proof. The
--    marker must name this event, this player (when given) and THIS
--    transaction, and this backend must hold T(id) and R(id) exclusive. A
--    marker set by hand in another transaction, or without the locks, proves
--    nothing; the helper that sets it is not executable by PUBLIC, anon or
--    authenticated.
-- 3. public.fn_ca_lock_tournament_rebuy_acquisition(event, table, player): the
--    seat gate's refusals and player keys (daily window, operator floor park,
--    530093/530090 shared, table_cap, daily-missions user), the launch receipt
--    and tournament rows in the gate's order, and the candidate's own table
--    row. No field-wide row locks.
-- 4. process_tournament_rebuy: rebuys, re-entries and add-ons take (1) and,
--    for a seat, (3). A rebuy or re-entry of a bounty, PKO or mystery event
--    keeps the rolling lane and the seat gate: its prior bounty generation is
--    settled under the event's seat-exit authority (T(id) exclusive), and a
--    shared hold upgraded mid-flight would deadlock with the event's hands.
-- 5. The seat root guard accepts a rebuy's own player's chair on (2) plus the
--    destination table row, held already (the rebuy locks it before the chair)
--    or taken here NOWAIT: a hand or a move holding that table refuses the
--    chair rather than race it. Every other acquisition still needs G or T(id)
--    exclusive.
-- 6. The F06 source guard accepts (2) in place of f06_try_lane for the rebuy's
--    roster and chair writes; its custody checks (a table in an F06 break,
--    a move in flight) run unchanged after it.
-- 7. Doctrine rule 6: the shared rebuy lane is taken only by
--    process_tournament_rebuy, takes T and G only shared, and the two guards
--    accept it only through the held-lane proof.
--
-- INVARIANTS. Exclusive authority stays on balancing moves, breaks, the final
-- table and terminal settlement: each holds T(id) or G exclusive, so it waits
-- for a rebuy in flight and a rebuy waits for it. A rebuy and a hand of its
-- destination table serialise on that table's row (the hand's lane locks the
-- table row and its seats; the rebuy locks the candidate's table row in the
-- gate, before any seat, and the chosen table's row before its chair). Two
-- rebuys of one event serialise on R(id). Lock order: R(id), then lane T's
-- G -> F -> B -> T(id), then rows: launch receipt, tournament, table, roster,
-- seats, as the seat gate. Nothing that holds G, F, B or T ever waits for
-- R(id). Native proof, PostgreSQL 16, production pre-images and the lane T
-- migrations: scripts/ci/test-rebuy-never-pauses-the-tournament.py.
--
-- LOCK FOOTPRINT. CREATE FUNCTION and CREATE OR REPLACE FUNCTION only: no
-- table or row lock, no install window, one transaction, one schema reload.
--
-- STALE PIN. fn_ca_guard_mtt_admission_contract pins the rebuy's body in its
-- activation manifest, read only on the legacy-capacity-v1 -> unlimited-mtt-v2
-- transition, which production completed (abi = unlimited-mtt-v2, immutable).
-- @stale-pin-ok: 21cbb3a7feaa634552aeb33541b075d2 fn_ca_guard_mtt_admission_contract activation manifest; the transition it guards is complete and immutable
--
-- @live-proof: (SELECT to_regprocedure('public.fn_ca_share_tournament_lane_for_rebuy(uuid,uuid)') IS NOT NULL AND md5(pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) = '6629aceb3ff583a87272c4127f91923f')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $requires$
BEGIN
  IF md5(pg_get_functiondef('smarter_private.f06_table_guard()'::regprocedure)) <> '08f84155a603076693d56f086add0b77'
     OR md5(pg_get_functiondef('public.fn_ca_settlement_lane_doctrine()'::regprocedure)) <> '203a70a10f5398414e831d1d073334d9'
     OR md5(pg_get_functiondef('smarter_private.f06_source_guard()'::regprocedure)) <> '1355f6d7edff0f4939d7c46f86c98699' THEN
    RAISE EXCEPTION 'rebuy lane: 20261118160405 and 20261118171613 (lane T) must be installed first';
  END IF;
END $requires$;

CREATE FUNCTION smarter_private.tournament_rebuy_lane_held(p_tournament_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_marker text := current_setting('ca.tournament_rebuy_lane', true);
  v_t bigint;
  v_r bigint;
BEGIN
  /* THE PROOF THAT A REBUY HOLDS ITS SHARED LANE (20261118191946). The marker
     public.fn_ca_share_tournament_lane_for_rebuy sets is transaction-local and
     names the event, the player and the transaction; it proves nothing on its
     own. This backend must also hold the event's T(id) (shared is enough: the
     event's exclusive authorities are then excluded) and its rebuy key R(id)
     exclusively. Cheap when there is no marker: one setting read, no pg_locks
     scan, so the guards that call it cost an ordinary writer nothing. */
  IF p_tournament_id IS NULL OR COALESCE(v_marker, '') = '' THEN
    RETURN false;
  END IF;
  IF split_part(v_marker, ':', 1) <> p_tournament_id::text
     OR split_part(v_marker, ':', 3) <> txid_current()::text
     OR (p_user_id IS NOT NULL AND split_part(v_marker, ':', 2) <> p_user_id::text) THEN
    RETURN false;
  END IF;
  v_t := hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0);
  v_r := hashtextextended('ca:tournament-rebuy-lane:v1:' || p_tournament_id::text, 0);
  RETURN COALESCE((
    SELECT bool_or(s.k = 't') AND bool_or(s.k = 'r')
      FROM (SELECT CASE
                     WHEN l.classid = ((v_t >> 32) & 4294967295)::oid
                      AND l.objid = (v_t & 4294967295)::oid THEN 't'
                     WHEN l.classid = ((v_r >> 32) & 4294967295)::oid
                      AND l.objid = (v_r & 4294967295)::oid
                      AND l.mode = 'ExclusiveLock' THEN 'r'
                   END AS k
              FROM pg_catalog.pg_locks l
             WHERE l.pid = pg_backend_pid()
               AND l.locktype = 'advisory'
               AND l.objsubid = 1
               AND l.granted
               AND l.database = (SELECT d.oid FROM pg_catalog.pg_database d
                                  WHERE d.datname = current_database())) s), false);
END;
$function$;

CREATE FUNCTION public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_held text := COALESCE(current_setting('ca.tournament_rebuy_lane', true), '');
  v_marker text;
BEGIN
  /* THE SHARED REBUY LANE (20261118191946, incident 075013fd lane R). Dan,
     2026-08-30: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION." A
     rebuy, re-entry or add-on of one event: R(id) exclusive first (one
     purchase of this event at a time; nothing that holds G, F, B or T ever
     waits for R), then G and T(id) SHARED, so every table of the event keeps
     dealing while it runs. The event's exclusive authorities (balancing
     moves, breaks, final table, terminal settlement) hold T(id) or G
     exclusive and so still exclude it; a hand of its destination table is
     fenced by that table's row. The transaction-bound marker is read by
     smarter_private.tournament_rebuy_lane_held, never trusted alone. */
  IF p_tournament_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'a rebuy lane needs its event and its player' USING ERRCODE = '22004';
  END IF;
  v_marker := p_tournament_id::text || ':' || p_user_id::text || ':' || txid_current()::text;
  IF v_held <> '' AND v_held <> v_marker THEN
    RAISE EXCEPTION 'a rebuy lane is already held in this transaction for %, refused for %', v_held, v_marker
      USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca:tournament-rebuy-lane:v1:' || p_tournament_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-terminal-settlement:v1', 0));
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0));
  PERFORM set_config('ca.tournament_rebuy_lane', v_marker, true);
END;
$function$;

CREATE FUNCTION public.fn_ca_lock_tournament_rebuy_acquisition(p_tournament_id uuid, p_table_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_max integer := 0;
  v_started_at timestamptz;
  v_window_refusal text;
  v_table_tournament uuid;
BEGIN
  /* THE SHARED REBUY'S SEAT ROOT (20261118191946). What
     fn_ca_lock_tournament_seat_acquisition does for a rebuy, in its order,
     minus its rolling lane and its field-wide row locks (every table, roster
     row and live seat of the event FOR UPDATE), which held every table of the
     event as surely as T(id) exclusive did. Under the shared rebuy lane those
     locks serialised nothing that R(id) and T(id) do not already: every other
     seat acquisition of the event holds T(id) exclusive, and every other
     purchase of the event waits for R(id). It locks the candidate's table row
     (the chair a rebuy keeps, and the table whose hands would otherwise race
     its seat) before any seat row, as the seat gate did. */
  IF p_tournament_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','missing_user_id');
  END IF;
  IF NOT smarter_private.tournament_rebuy_lane_held(p_tournament_id, p_user_id) THEN
    RAISE EXCEPTION 'TOURNAMENT_REBUY_LANE_REQUIRED: take public.fn_ca_share_tournament_lane_for_rebuy first'
      USING ERRCODE = '55000';
  END IF;
  -- THE DAILY WINDOW, exactly as the seat gate asks it.
  IF NOT EXISTS(SELECT 1 FROM public.tournament_players tp
       WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id AND tp.status IN ('registered','playing'))
     AND NOT EXISTS(SELECT 1 FROM public.table_seats ts JOIN public.tables tb ON tb.id=ts.table_id
       WHERE tb.tournament_id=p_tournament_id AND ts.user_id=p_user_id AND ts.left_at IS NULL) THEN
    v_window_refusal := public.fn_daily_window_entry_refusal(p_tournament_id);
    IF v_window_refusal IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'reason',v_window_refusal);
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(530093);
  IF EXISTS(SELECT 1 FROM public.ca_operator_floor_hold h JOIN public.ca_launch_operator_scopes m ON m.operation_id=h.operation_id JOIN public.tournaments t ON t.id=p_tournament_id WHERE h.mode='park' AND (t.club_id=ANY(m.club_ids) OR t.union_id=ANY(m.club_ids)) AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id AND tp.user_id=p_user_id)) THEN
    RETURN jsonb_build_object('ok',false,'reason','operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock_shared(530090,1);
  IF public.fn_ca_new_tournament_starts_blocked() THEN
    RETURN jsonb_build_object('ok',false,'reason','operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('table_cap'), hashtext(p_user_id::text));
  PERFORM public.fn_lock_daily_mission_user(p_user_id);

  PERFORM 1
  FROM public.tournament_launch_receipts r
  WHERE r.tournament_id = p_tournament_id
  FOR UPDATE;

  SELECT
    upper(COALESCE(t.status::text, '')),
    COALESCE(t.max_players, 0),
    t.started_at
  INTO v_status, v_max, v_started_at
  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;

  IF p_table_id IS NOT NULL THEN
    SELECT tb.tournament_id INTO v_table_tournament
    FROM public.tables tb
    WHERE tb.id = p_table_id
    FOR UPDATE;
    IF v_table_tournament IS DISTINCT FROM p_tournament_id THEN
      RETURN jsonb_build_object('ok',false,'reason','table_tournament_mismatch');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_id', p_tournament_id,
    'table_id', p_table_id,
    'status', v_status,
    'max_players', v_max,
    'started_at', v_started_at,
    'lane', 'shared_rebuy'
  );
END;
$function$;

ALTER FUNCTION smarter_private.tournament_rebuy_lane_held(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.fn_ca_share_tournament_lane_for_rebuy(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.fn_ca_lock_tournament_rebuy_acquisition(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION smarter_private.tournament_rebuy_lane_held(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_share_tournament_lane_for_rebuy(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_lock_tournament_rebuy_acquisition(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_share_tournament_lane_for_rebuy(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_lock_tournament_rebuy_acquisition(uuid, uuid, uuid) TO service_role;

-- The rebuy, the two guards and the doctrine: exact substitutions on the
-- pinned pre-images, each anchor counted, each post-image pinned, owner, ACL,
-- SECURITY DEFINER and proconfig preserved.
DO $subs$
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
    ('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)',
     '21cbb3a7feaa634552aeb33541b075d2', '6629aceb3ff583a87272c4127f91923f',
     ARRAY[$o1$  v_choice jsonb;
$o1$, $o2$  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  PERFORM pg_advisory_xact_lock_shared(530090,1);
$o2$, $o3$    v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
      p_tournament_id,NULL,p_user_id);
$o3$],
     ARRAY[$n1$  v_choice jsonb;
  v_lane_shared boolean:=false;
$n1$, $n2$  -- A REBUY NEVER PAUSES THE TOURNAMENT (20261118191946, incident 075013fd
  -- lane R; Dan 2026-08-30: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
  -- ACTION"). A rebuy, re-entry or add-on shares its event's lane: R(id)
  -- exclusive (one purchase of this event at a time), then G and T(id)
  -- SHARED, so every table of the event keeps dealing. The event's exclusive
  -- authorities still exclude it through T(id); a hand of its destination
  -- table is fenced by that table's row. A rebuy or re-entry of a bounty, PKO
  -- or mystery event keeps the rolling lane: its prior bounty generation is
  -- settled under the event's exclusive seat-exit authority.
  IF v_type<>'addon' AND EXISTS (
       SELECT 1 FROM public.tournaments t
        WHERE t.id=p_tournament_id
          AND (COALESCE(t.is_bounty,false) OR COALESCE(t.is_pko,false)
               OR COALESCE(t.is_mystery_bounty,false))) THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  ELSE
    PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);
    v_lane_shared:=true;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(530090,1);
$n2$, $n3$    IF v_lane_shared THEN
      -- The shared lane's seat root: the seat gate's refusals and player
      -- keys and the candidate's table row, without its field-wide row locks.
      v_gate:=public.fn_ca_lock_tournament_rebuy_acquisition(
        p_tournament_id,v_table_id,p_user_id);
    ELSE
      v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
        p_tournament_id,NULL,p_user_id);
    END IF;
$n3$]),
    ('public.fn_tournament_live_seat_acquisition_requires_authority()',
     '2039e26a8513bba99c057a28b79f44e5', '6d2346c65c1940b5c4953214bbe4b519',
     ARRAY[$o4$    INTO v_owns_authority;
  IF NOT COALESCE(v_owns_authority,false) THEN
$o4$],
     ARRAY[$n4$    INTO v_owns_authority;
  -- A REBUY'S OWN CHAIR (20261118191946, incident 075013fd lane R). A rebuy
  -- shares its event's lane: R(id) exclusive, T(id) shared and a marker bound
  -- to this event, this player and this transaction, which together are
  -- smarter_private.tournament_rebuy_lane_held. With the destination table's
  -- row - held already, the rebuy locks it before it picks the chair, or taken
  -- here without waiting - that is its authority for its own player's chair
  -- and nobody else's. A hand or a move holding the table refuses it instead.
  IF NOT COALESCE(v_owns_authority,false)
     AND smarter_private.tournament_rebuy_lane_held(v_tournament_id,NEW.user_id) THEN
    BEGIN
      PERFORM 1 FROM public.tables tb WHERE tb.id=NEW.table_id FOR UPDATE NOWAIT;
      v_owns_authority:=FOUND;
    EXCEPTION WHEN lock_not_available THEN
      v_owns_authority:=false;
    END;
  END IF;
  IF NOT COALESCE(v_owns_authority,false) THEN
$n4$]),
    ('smarter_private.f06_source_guard()',
     '1355f6d7edff0f4939d7c46f86c98699', '0b9d60df00b7fb673767534b59bacf51',
     ARRAY[$o5$ ELSE
  PERFORM smarter_private.f06_try_lane(t);
 END IF;
$o5$],
     ARRAY[$n5$ ELSIF NOT smarter_private.tournament_rebuy_lane_held(t,NULL) THEN
  -- 20261118191946 (075013fd lane R): a rebuy shares its event's lane (R(t)
  -- exclusive, T(t) shared, its transaction-bound marker); its roster and
  -- chair writes need no exclusive T, which would refuse it whenever any hand
  -- of the event is in flight. Every canonical begin and move still holds T
  -- exclusive and cannot run beside it; the custody checks below still apply.
  PERFORM smarter_private.f06_try_lane(t);
 END IF;
$n5$]),
    ('public.fn_ca_settlement_lane_doctrine()',
     '203a70a10f5398414e831d1d073334d9', '86d052c0c8aee728385ddcab51d83795',
     ARRAY[$o6$  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$o6$],
     ARRAY[$n6$  -- 6. A rebuy shares its event's lane (20261118191946, incident 075013fd
  --    lane R; Dan 2026-08-30: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
  --    ACTION"). The shared rebuy lane is taken only by the rebuy, takes the
  --    event key T(id) shared and never G or T exclusive, and the two guards
  --    that otherwise demand exclusive authority accept it only through the
  --    held-lane proof. Names in pieces, so this source matches no pattern.
  SELECT string_agg(p.proname::text, ',' ORDER BY p.proname::text COLLATE "C")
    INTO v_set
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'smarter_private') AND p.prokind = 'f'
     AND p.prosrc LIKE '%fn_ca_share_tournament_lane_' || 'for_rebuy(%'
     AND p.prosrc ~ ('(PERFORM|SELECT|:=)\s+public\.fn_ca_share_tournament_lane_' || 'for_rebuy\s*\(');
  IF v_set IS DISTINCT FROM 'process_tournament_rebuy'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = to_regprocedure('public.fn_ca_share_tournament_lane_' || 'for_rebuy(uuid,uuid)')
          AND p.prosrc ~ ('pg_advisory_xact_lock_shared\(\s*hashtextextended\(\s*''ca:tournament-terminal-' || 'settlement:v1:''')
          AND p.prosrc !~ ('pg_advisory_xact_lock\(\s*hashtextextended\(\s*''ca:tournament-terminal-' || 'settlement:v1'))
     OR (SELECT count(*) FROM pg_catalog.pg_proc p
          WHERE p.oid IN (to_regprocedure('public.fn_tournament_live_seat_acquisition_requires_authority()'),
                          to_regprocedure('smarter_private.f06_source_guard()'))
            AND p.prosrc ~ ('smarter_private\.tournament_rebuy_' || 'lane_held\(')) <> 2 THEN
    v_violations := v_violations || jsonb_build_object('rule', 'a_rebuy_shares_its_event_lane', 'found', COALESCE(v_set, 'none'));
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$n6$])
    ) AS s(signature, preimage, postimage, olds, news)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'rebuy lane: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    FOR i IN 1 .. cardinality(r.olds) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'rebuy lane: % anchor % occurs % times', r.signature, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    IF md5(v_def) <> r.postimage THEN
      RAISE EXCEPTION 'rebuy lane: % would not land on its reviewed post-image (md5 %)', r.signature, md5(v_def);
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) <> r.postimage
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
            AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
            AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'rebuy lane: % did not land on its post-image, or its metadata changed', r.signature;
    END IF;
  END LOOP;
END $subs$;

DO $post$
DECLARE
  v_doctrine jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('smarter_private.tournament_rebuy_lane_held(uuid,uuid)', 'd32dad9b538f214bdeb224e1596d5416'),
      ('public.fn_ca_share_tournament_lane_for_rebuy(uuid,uuid)', '004125787ce2db12d8f3e8d68ab6da94'),
      ('public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)', '2ea19582f62ecd683304b1f85f17466c')
    ) AS x(sig, post)
    WHERE md5(pg_get_functiondef(x.sig::regprocedure)) IS DISTINCT FROM x.post) THEN
    RAISE EXCEPTION 'rebuy lane: a new lane function is not its reviewed text';
  END IF;
  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'rebuy lane: the lane doctrine fails after the change: %', v_doctrine;
  END IF;
END $post$;

COMMIT;
