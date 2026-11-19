-- 20261119052513_a_late_registration_never_pauses_the_tournament.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A LATE REGISTRATION NEVER PAUSES THE TOURNAMENT (incident 075013fd, lane L).
-- Owner rules: "i just don't want any 'un intended delays'" (Dan 2026-11-18)
-- and "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION" (2026-08-30).
-- Requires 20261119011750 (lane R2: the event's shared change lane, which the
-- rolling-lane helper and the F06 try accept as already held); refuses to run
-- if its post-images are not installed. Full account:
-- docs/changelog/2026-11-19-a-late-registration-never-pauses-the-tournament.md.
--
-- THE DEFECT, MEASURED ON PRODUCTION (2026-11-19 01:00-01:15 UTC). A late
-- registration into a RUNNING event (horses join in waves of 4-8 every ~2 min,
-- humans too) enters through fn_ca_lock_tournament_seat_acquisition, which takes
-- the event's rolling lane T(id) EXCLUSIVE and then locks EVERY table row,
-- roster row and live seat of the event FOR UPDATE. Every per-hand call of the
-- event (card writes, F06 begin/finish, the hand commit) holds T(id) shared or
-- those rows, so all tables queued behind each registration: 1-7.8 s waits,
-- fold gap p90 8.9 s and p99 14.3 s during waves against p99 5.1 s without.
--
-- THE FIX.
-- 1. public.fn_ca_lock_tournament_registration_acquisition(event, player): the
--    registration doors' seat root. For a RUNNING mtt-v1/mtt-v2 event, taken
--    by a transaction that holds no exclusive authority of its own, it joins
--    the event's shared change lane through
--    public.fn_ca_share_tournament_lane_for_rebuy (R(id) exclusive - rebuys,
--    re-entries, add-ons, busts and registrations of one event are recorded one
--    at a time - then G and T(id) SHARED), re-reads the status under it, and
--    asks the seat gate's refusals and player keys in the gate's order (daily
--    window, floor park 530093, entry boundary 530090, table cap, daily-mission
--    user) and locks the launch receipt. No field-wide row locks: every other
--    seat acquisition of the event holds T(id) exclusive or R(id). Re-entry
--    (to_target -> horse door -> late seat) reuses the lane already held. Any
--    other case - REGISTERING or ANNOUNCED (registration before start is
--    untouched), another format, a caller already holding G or T(id)
--    exclusive (satellite seat delivery, rematch, resume) - is exactly the
--    seat gate, unchanged.
-- 2. The five doors call it in place of the seat gate: fn_register_for_tournament,
--    fn_register_for_tournament_with_ticket, fn_register_horse_for_tournament,
--    fn_register_horse_for_tournament_to_target and fn_seat_late_registrant.
--    Everything beneath them is unchanged: their nested rolling-lane calls (the
--    horse terminal gate, ticket and cashier-ticket admission) already return
--    at once inside the change lane (20261119011750), and the roster and chair
--    writes pass the F06 source guard and the seat root guard on the same
--    held-lane proof the rebuy uses (the chosen table's row is locked by
--    fn_seat_late_registrant_before_maintenance_gate before its chair).
-- 3. fn_satellite_target_player_provenance_is_immutable accepts, for an INSERT,
--    the held change lane of the row's own event and player in place of T(id)
--    exclusive: a satellite-ticket entrant admitted late. The source's terminal
--    settlement is still excluded by G shared, the target's unregistration and
--    ticket-return doors by T(id) shared, other admissions by R(id).
-- 4. Doctrine: rule 6 names the registration gate among the change lane's
--    callers; rule 7 pins the five doors to it and keeps the gate off any
--    exclusive tournament key.
--
-- A NEW TABLE NEEDS NOTHING EXCLUSIVE. When no table has a free chair,
-- fn_ensure_late_registration_capacity (unchanged) opens one inside this same
-- transaction: an INSERT of a table row no hand can hold (f06_table_guard
-- passes inserts and counter-only updates), its receipt and its manager wake,
-- under the tournament row the core already holds FOR UPDATE. Everything that
-- reshapes an event's tables (balancing moves, table breaks, final table,
-- terminal settlement) holds T(id) or G exclusive and so cannot run beside it;
-- two registrations cannot both open one, R(id). So the step that might have
-- needed exclusive authority needs none, and no shared hold is ever upgraded.
--
-- BOUNTY, PKO AND MYSTERY events are included: 20261119011750 moved their
-- rebuys and busts onto the same change lane and made the nested authorities
-- (bounty collection, mystery reserve and pay) take it as held.
--
-- LOCK ORDER. R(id), then G -> T(id) shared, then 530093, 530090, table cap,
-- daily-mission user, launch receipt, tournament row (the core), the chosen
-- table row, the chair. The hand commit takes the tournament row FOR SHARE
-- before its roster rows and table: the same order. Nothing that holds G, F, B
-- or T waits for R(id). Native proof, PostgreSQL 16, production pre-images:
-- scripts/ci/test-late-registration-never-pauses-the-tournament.py.
--
-- LOCK FOOTPRINT. CREATE FUNCTION and CREATE OR REPLACE FUNCTION only: no
-- table or row lock, no install window, one transaction, one schema reload.
--
-- @live-proof: (SELECT to_regprocedure('public.fn_ca_lock_tournament_registration_acquisition(uuid,uuid)') IS NOT NULL AND md5(pg_get_functiondef('public.fn_seat_late_registrant(uuid,uuid)'::regprocedure)) = 'b7eb300ef99bebf72761b2b787b0cd77')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $requires$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)'::regprocedure)) <> 'b76daaf8587cca4eeac91ec39e9e7ce3'
     OR md5(pg_get_functiondef('smarter_private.f06_try_lane(uuid)'::regprocedure)) <> '96ce828d6019c6c18fe660222bbd9feb'
     OR md5(pg_get_functiondef('smarter_private.tournament_rebuy_lane_held(uuid,uuid)'::regprocedure)) <> 'd32dad9b538f214bdeb224e1596d5416'
     OR md5(pg_get_functiondef('public.fn_ca_share_tournament_lane_for_rebuy(uuid,uuid)'::regprocedure)) <> '004125787ce2db12d8f3e8d68ab6da94'
     OR md5(pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure)) <> '651ddfe7bd5fa4884edae4df0050268a' THEN
    RAISE EXCEPTION 'late registration lane: 20261119011750 (lane R2) must be installed first';
  END IF;
END $requires$;

CREATE FUNCTION public.fn_ca_lock_tournament_registration_acquisition(p_tournament_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status text;
  v_format text;
  v_max integer := 0;
  v_started_at timestamptz;
  v_active integer := 0;
  v_window_refusal text;
  v_g bigint := hashtextextended('ca:tournament-terminal-settlement:v1', 0);
  v_t bigint;
  v_exclusive boolean := false;
BEGIN
  /* A LATE REGISTRATION NEVER PAUSES THE TOURNAMENT (20261119052513,
     incident 075013fd lane L). The seat root of the registration doors. A
     RUNNING mtt event is entered under its shared change lane (R(id)
     exclusive, G and T(id) shared) with the seat gate's refusals and player
     keys and none of its field-wide row locks; every other case is the seat
     gate itself. */
  IF p_tournament_id IS NULL OR p_user_id IS NULL THEN
    RETURN public.fn_ca_lock_tournament_seat_acquisition(p_tournament_id, NULL, p_user_id);
  END IF;

  IF NOT smarter_private.tournament_rebuy_lane_held(p_tournament_id, p_user_id) THEN
    SELECT upper(COALESCE(t.status::text, '')), t.format_contract
      INTO v_status, v_format
      FROM public.tournaments t
     WHERE t.id = p_tournament_id;
    v_t := hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0);
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_locks l
       WHERE l.pid = pg_backend_pid()
         AND l.locktype = 'advisory'
         AND l.objsubid = 1
         AND l.mode = 'ExclusiveLock'
         AND l.granted
         AND l.database = (SELECT d.oid FROM pg_catalog.pg_database d
                            WHERE d.datname = current_database())
         AND ((l.classid = ((v_g >> 32) & 4294967295)::oid AND l.objid = (v_g & 4294967295)::oid)
           OR (l.classid = ((v_t >> 32) & 4294967295)::oid AND l.objid = (v_t & 4294967295)::oid)))
      INTO v_exclusive;
    -- Before the start, another format, or inside an exclusive authority of
    -- its own: the seat gate, unchanged.
    IF v_status IS DISTINCT FROM 'RUNNING'
       OR v_format IS NULL OR v_format NOT IN ('mtt-v1', 'mtt-v2')
       OR v_exclusive THEN
      RETURN public.fn_ca_lock_tournament_seat_acquisition(p_tournament_id, NULL, p_user_id);
    END IF;

    -- THE DAILY WINDOW, exactly as the seat gate asks it, before any lock.
    IF NOT EXISTS (SELECT 1 FROM public.tournament_players tp
         WHERE tp.tournament_id = p_tournament_id AND tp.user_id = p_user_id
           AND tp.status IN ('registered', 'playing'))
       AND NOT EXISTS (SELECT 1 FROM public.table_seats ts JOIN public.tables tb ON tb.id = ts.table_id
         WHERE tb.tournament_id = p_tournament_id AND ts.user_id = p_user_id AND ts.left_at IS NULL) THEN
      v_window_refusal := public.fn_daily_window_entry_refusal(p_tournament_id);
      IF v_window_refusal IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', v_window_refusal);
      END IF;
    END IF;

    PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id, p_user_id);

    -- Status is written only under T(id) or G exclusive, so it cannot move
    -- now; it may have moved before the lane was granted.
    SELECT upper(COALESCE(t.status::text, '')) INTO v_status
      FROM public.tournaments t WHERE t.id = p_tournament_id;
    IF v_status IS DISTINCT FROM 'RUNNING' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'registration_closed');
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(530093);
  IF EXISTS (SELECT 1 FROM public.ca_operator_floor_hold h
               JOIN public.ca_launch_operator_scopes m ON m.operation_id = h.operation_id
               JOIN public.tournaments t ON t.id = p_tournament_id
              WHERE h.mode = 'park' AND (t.club_id = ANY(m.club_ids) OR t.union_id = ANY(m.club_ids))
                AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                                 WHERE tp.tournament_id = t.id AND tp.user_id = p_user_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock_shared(530090, 1);
  IF public.fn_ca_new_tournament_starts_blocked() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('table_cap'), hashtext(p_user_id::text));
  PERFORM public.fn_lock_daily_mission_user(p_user_id);

  PERFORM 1 FROM public.tournament_launch_receipts r
   WHERE r.tournament_id = p_tournament_id
   FOR UPDATE;

  SELECT upper(COALESCE(t.status::text, '')), COALESCE(t.max_players, 0), t.started_at
    INTO v_status, v_max, v_started_at
    FROM public.tournaments t
   WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;

  SELECT COUNT(DISTINCT u.uid)::integer INTO v_active
    FROM (SELECT tp.user_id AS uid FROM public.tournament_players tp
           WHERE tp.tournament_id = p_tournament_id
             AND tp.status::text IN ('registered', 'playing') AND tp.user_id IS NOT NULL
          UNION
          SELECT ts.user_id FROM public.table_seats ts JOIN public.tables tb ON tb.id = ts.table_id
           WHERE tb.tournament_id = p_tournament_id AND COALESCE(tb.status, 'active') <> 'closed'
             AND ts.left_at IS NULL AND ts.user_id IS NOT NULL) u;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_id', p_tournament_id,
    'table_id', NULL,
    'status', v_status,
    'max_players', v_max,
    'active_players', v_active,
    'started_at', v_started_at,
    'lane', 'shared_change'
  );
END;
$function$;

ALTER FUNCTION public.fn_ca_lock_tournament_registration_acquisition(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_ca_lock_tournament_registration_acquisition(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The five doors, the provenance guard and the doctrine: exact substitutions
-- on the pinned pre-images, each anchor counted, each post-image pinned,
-- owner, ACL, SECURITY DEFINER and proconfig preserved.
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
    ('public.fn_register_horse_for_tournament(uuid,uuid,boolean)',
     '4b8c7f774073fcb8b2f86e1e8aeb4afd', '7ebcd833d30a509a6547eb469d2ebf07',
     ARRAY[$o1$  v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
    p_tournament_id,NULL,p_user_id);
$o1$],
     ARRAY[$n1$  -- 20261119052513 (075013fd lane L): a late entry shares its event's lane.
  v_gate:=public.fn_ca_lock_tournament_registration_acquisition(
    p_tournament_id,p_user_id);
$n1$]),
    ('public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)',
     'afb54a9112c4fe974ef3b398d8dbe748', '03ceb659b427d0f4f2ce2bde9b71e4bf',
     ARRAY[$o2$  v_gate := public.fn_ca_lock_tournament_seat_acquisition(
    p_tournament_id,NULL,p_user_id);
$o2$],
     ARRAY[$n2$  -- 20261119052513 (075013fd lane L): a late entry shares its event's lane.
  v_gate := public.fn_ca_lock_tournament_registration_acquisition(
    p_tournament_id,p_user_id);
$n2$]),
    ('public.fn_register_for_tournament(uuid,boolean)',
     '88dc44b7cb63b2bd845f89d672335b97', '86eb905a06045123ad499d12d384fd8f',
     ARRAY[$o3$  v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
    p_tournament_id,NULL,auth.uid());
$o3$],
     ARRAY[$n3$  -- 20261119052513 (075013fd lane L): a late entry shares its event's lane.
  v_gate:=public.fn_ca_lock_tournament_registration_acquisition(
    p_tournament_id,auth.uid());
$n3$]),
    ('public.fn_register_for_tournament_with_ticket(uuid,uuid)',
     'f4c3915267d89c852ef5dc31dbc96b1f', 'e99814bf8b9e70b8173e42ea22ed752c',
     ARRAY[$o4$  v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
    p_tournament_id,NULL,auth.uid());
$o4$],
     ARRAY[$n4$  -- 20261119052513 (075013fd lane L): a late entry shares its event's lane.
  v_gate:=public.fn_ca_lock_tournament_registration_acquisition(
    p_tournament_id,auth.uid());
$n4$]),
    ('public.fn_seat_late_registrant(uuid,uuid)',
     '51a3254789bfdc2c1f80994d0c26ad6a', 'b7eb300ef99bebf72761b2b787b0cd77',
     ARRAY[$o5$  v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
    p_tournament_id,NULL,p_user_id);
$o5$],
     ARRAY[$n5$  -- 20261119052513 (075013fd lane L): a late seat shares its event's lane.
  v_gate:=public.fn_ca_lock_tournament_registration_acquisition(
    p_tournament_id,p_user_id);
$n5$]),
    ('public.fn_satellite_target_player_provenance_is_immutable()',
     '68f98d4ec2cb186aae11787f1666cffc', 'a5a8bbea88d133aa55319fbf09f2f8b0',
     ARRAY[$o6$      INTO v_owns_acquisition_root;
  END IF;
$o6$],
     ARRAY[$n6$      INTO v_owns_acquisition_root;
  END IF;
  -- 20261119052513 (075013fd lane L): a late admission holds its event's
  -- shared change lane (R(id) exclusive, G and T(id) shared and a marker bound
  -- to this event, this player and this transaction). G shared still excludes
  -- the source's terminal settlement, T(id) shared the target's unregistration
  -- and ticket-return doors, R(id) every other admission: the same proof.
  IF TG_OP='INSERT' AND NOT COALESCE(v_owns_acquisition_root,false)
     AND smarter_private.tournament_rebuy_lane_held(NEW.tournament_id,NEW.user_id) THEN
    v_owns_acquisition_root:=true;
  END IF;
$n6$]),
    ('public.fn_ca_settlement_lane_doctrine()',
     'be8d765b7d03821ef9a4c9ea730a8f30', 'd1c13960687824de74bf3836e7b54259',
     ARRAY[$o7$  IF v_set IS DISTINCT FROM 'fn_claim_tournament_bounty_elimination,fn_eliminate_tournament_player_atomic,process_tournament_rebuy'
$o7$, $o8$  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$o8$],
     ARRAY[$n7$  IF v_set IS DISTINCT FROM 'fn_ca_lock_tournament_registration_acquisition,fn_claim_tournament_bounty_elimination,fn_eliminate_tournament_player_atomic,process_tournament_rebuy'
$n7$, $n8$  -- 7. A late registration shares its event's lane (20261119052513, incident
  --    075013fd lane L; Dan 2026-11-18: "i just don't want any 'un intended
  --    delays'"). The five registration doors take the registration seat
  --    root and never the seat gate directly; that root reaches the event key
  --    only through the change lane and the seat gate, never exclusively
  --    itself. Names in pieces, so this source matches no pattern.
  SELECT string_agg(DISTINCT p.proname::text COLLATE "C", ',' ORDER BY p.proname::text COLLATE "C")
    INTO v_set
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'smarter_private') AND p.prokind = 'f'
     AND p.prosrc ~ ('(PERFORM|SELECT|:=)\s*public\.fn_ca_lock_tournament_registration_' || 'acquisition\s*\(');
  IF v_set IS DISTINCT FROM 'fn_register_for_tournament,fn_register_for_tournament_with_ticket,fn_register_horse_for_tournament,fn_register_horse_for_tournament_to_target,fn_seat_late_registrant'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid IN (to_regprocedure('public.fn_register_' || 'for_tournament(uuid,boolean)'),
                        to_regprocedure('public.fn_register_' || 'for_tournament_with_ticket(uuid,uuid)'),
                        to_regprocedure('public.fn_register_' || 'horse_for_tournament(uuid,uuid,boolean)'),
                        to_regprocedure('public.fn_register_' || 'horse_for_tournament_to_target(uuid,uuid,boolean,bigint)'),
                        to_regprocedure('public.fn_seat_' || 'late_registrant(uuid,uuid)'))
          AND p.prosrc ~ ('fn_ca_lock_tournament_seat_' || 'acquisition\s*\('))
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = to_regprocedure('public.fn_ca_lock_tournament_registration_' || 'acquisition(uuid,uuid)')
          AND p.prosrc ~ ('PERFORM\s+public\.fn_ca_share_tournament_lane_' || 'for_rebuy\s*\(')
          AND p.prosrc !~ ('pg_advisory_xact_lock\(\s*hashtextextended\(\s*''ca:tournament-terminal-' || 'settlement')
          AND p.prosrc !~ ('fn_ca_lock_settlement_lane_' || 'for_tournament\s*\(')) THEN
    v_violations := v_violations || jsonb_build_object('rule', 'a_late_registration_shares_its_event_lane', 'found', COALESCE(v_set, 'none'));
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$n8$])
    ) AS s(signature, preimage, postimage, olds, news)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'late registration lane: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    FOR i IN 1 .. cardinality(r.olds) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'late registration lane: % anchor % occurs % times', r.signature, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    IF md5(v_def) <> r.postimage THEN
      RAISE EXCEPTION 'late registration lane: % would not land on its reviewed post-image (md5 %)', r.signature, md5(v_def);
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) <> r.postimage
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
            AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
            AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'late registration lane: % did not land on its post-image, or its metadata changed', r.signature;
    END IF;
  END LOOP;
END $subs$;

DO $post$
DECLARE
  v_doctrine jsonb;
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_lock_tournament_registration_acquisition(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '7770f83129207c3a73f534cb5b2aecdc' THEN
    RAISE EXCEPTION 'late registration lane: the registration seat root is not its reviewed text';
  END IF;
  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'late registration lane: the lane doctrine fails after the change: %', v_doctrine;
  END IF;
END $post$;

COMMIT;
