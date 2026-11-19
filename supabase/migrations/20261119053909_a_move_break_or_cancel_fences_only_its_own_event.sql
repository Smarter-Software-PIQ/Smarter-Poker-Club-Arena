-- 20261119053909_a_move_break_or_cancel_fences_only_its_own_event.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A MOVE, A BREAK, AN ENTRY CLOSE, A BOUNTY SWEEP AND A CANCEL FENCE ONLY WHAT
-- THEY TOUCH (incident 075013fd, lane E2). Owner rulings: "a tournament issue
-- must always be isolated and never affect other tournaments or cash games"
-- (2026-11-17); "I don't want any unintended delays". Requires 20261119011750
-- (lane R2: the shared change lane covers rebuys and busts) and rebases on
-- 20261119052513 (lane L: late registration shares the lane; its doctrine
-- post-image is this file's pre-image); refuses to run if its post-images
-- are not installed. Full account:
-- docs/changelog/2026-11-19-a-move-break-or-cancel-fences-only-its-own-event.md.
--
-- WHAT WAS LEFT AFTER LANES T, R AND R2.
-- 1. A balancing move (fn_move_tournament_player) and every step of a table
--    break (park, begin, amend, close, claim, acknowledge, through
--    smarter_private.f06_lock_break) took the event's rolling lane, T(id)
--    EXCLUSIVE, so every table of the event stopped while a move or a break
--    step ran: the rare 5-17 s gaps on tables nowhere near the move.
-- 2. The entry-window close took T(id) exclusive for a read that almost
--    always returns "not yet", and the break scan (fn_f06_discover_breaks)
--    took it for a cursor read, every engine tick, queuing every hand of the
--    event behind it.
-- 3. The bounty sweep took T(id) exclusive (a try) for up to twenty payouts,
--    and a direct bounty collection outside a rebuy took the rolling lane.
-- 4. One event's operator or owner cancel, and the abort settles, went
--    through smarter_private.cancellation_lane's standalone mode: a try of the
--    platform key G and the hand barrier B EXCLUSIVE, which pauses every
--    table and every cash hand on the platform while held and is refused
--    whenever any hand anywhere holds B.
--
-- THE FIX.
-- 1. public.fn_ca_share_tournament_lane_for_tables(event, player, tables, try):
--    the shared change lane of 20261118191946 (R(id) exclusive, G and T(id)
--    SHARED, the marker smarter_private.tournament_rebuy_lane_held proves),
--    then, when tables are named, the launch receipt, the event row and the
--    given tables' rows in id order: a hand commit's order (event row FOR
--    SHARE, then its table row) and a live chair's launch-proof order
--    (receipt, then event row FOR UPDATE), so they wait for each other and
--    never cross. A hand commit at another table waits for the event row only
--    for this transaction's own duration, as it does for a rebuy or a bust;
--    hand begins, actions, cards and every other per-hand write never wait.
--    Re-entrant
--    inside that lane; a no-op for the lane under an exclusive authority that
--    already holds T(id) or G. In try mode it takes nothing when any key is
--    busy and answers false.
-- 2. A move takes it for its player and its two tables before any row; every
--    break step takes it for the break's source and destination tables before
--    f06_prefix's rows. f06_prefix's rolling-lane call returns at once inside
--    the lane (20261119011750), and it locks a member's live chair, not every
--    chair the member ever left (a left chair is a row of an untouched table,
--    whose hands lock all of its chairs). Tables of the event not involved
--    keep dealing; a hand of the source or destination table waits on that
--    table's row, and the move waits on the hand's. A breaking table is
--    parked, so its players are moved off before it deals again, as before.
-- 3. The entry close takes the lane with no table rows; its finalization
--    reaches only the tournaments row and pool rows. The break scan takes the
--    lease fence only: it reads operations and moves its own cursor row.
-- 4. The bounty sweep tries the lane for its event (never queues), then locks
--    the tables of the claimants it may pay in id order, before any roster
--    row, as a hand of those tables does. A direct collection does the same
--    for its own obligation.
-- 5. smarter_private.cancellation_lane: a plain event with a bank scope takes
--    its own finish lane (G shared, F shared, F(scope) exclusive, T(id)
--    exclusive; the 2026-09-17 wallet order of every finish), which pauses
--    that event's tables only. A satellite (two events) or an unknown id keeps
--    the platform try. The held-lane branch accepts the event's own finish
--    lane. fn_ca_request_tournament_abort keeps the platform try only for a
--    request naming several events (smarter_private.cancellation_lane_for_events).
-- 6. Doctrine rule 8 names the lane's callers, its shared T, the scan's
--    absence of any lane and the cancellation's scoping; rule 2's pin on
--    cancellation_lane moves to its new body.
--
-- LOCK ORDER. R(id), then lane T's G -> F -> B -> T(id), then rows: launch
-- receipt, tournament, tables in id order, roster, seats (lanes R and R2's
-- order, and a hand commit's: tournament row, table row, roster). Only holders of R(id)
-- lock more than one table row of an event, and they run one at a time. A
-- cancellation's finish lane is G s, F s, F(scope) x, T(id) x, as every finish.
--
-- LOCK FOOTPRINT. CREATE FUNCTION and CREATE OR REPLACE FUNCTION only: no
-- table or row lock, no install window, one transaction, one schema reload.
--
-- STALE PINS. fn_ca_guard_mtt_admission_contract pins the sweep's and the
-- collection's bodies in its activation manifest, read only on the
-- legacy-capacity-v1 -> unlimited-mtt-v2 transition, which production
-- completed (abi = unlimited-mtt-v2, immutable).
-- smarter_private.original_hand_correction_sources_match() pins f06_prefix's
-- body in its list; it already answers false on production (read 2026-11-19),
-- so its outcome does not change. The doctrine's pin on cancellation_lane
-- moves in this migration.
-- @stale-pin-ok: 81512d0707a7a8a8c334234838974019 fn_ca_guard_mtt_admission_contract activation manifest; the transition it guards is complete and immutable
-- @stale-pin-ok: a09b607ee2fa1471db815a9fc8a30b97 fn_ca_guard_mtt_admission_contract activation manifest; the transition it guards is complete and immutable
-- @stale-pin-ok: dae9d5b5f71a68362f202dfdf89c8fae original_hand_correction_sources_match already answers false on production; moving one of its pins would not revive it
--
-- @live-proof: (SELECT to_regprocedure('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)') IS NOT NULL AND md5(pg_get_functiondef('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure)) = '6feaec933d08af1aa821d17f3c5dc093')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $requires$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)'))) IS DISTINCT FROM 'b76daaf8587cca4eeac91ec39e9e7ce3'
     OR md5(pg_get_functiondef(to_regprocedure('smarter_private.f06_try_lane(uuid)'))) IS DISTINCT FROM '96ce828d6019c6c18fe660222bbd9feb'
     OR md5(pg_get_functiondef(to_regprocedure('smarter_private.tournament_rebuy_lane_held(uuid,uuid)'))) IS DISTINCT FROM 'd32dad9b538f214bdeb224e1596d5416' THEN
    RAISE EXCEPTION 'event lane E2: 20261119011750 (lane R2) must be installed first';
  END IF;
END $requires$;

CREATE FUNCTION public.fn_ca_share_tournament_lane_for_tables(p_tournament_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_table_ids uuid[] DEFAULT NULL::uuid[], p_try boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_held text := COALESCE(current_setting('ca.tournament_rebuy_lane', true), '');
  v_g bigint := hashtextextended('ca:tournament-terminal-settlement:v1', 0);
  v_t bigint;
  v_exclusive boolean;
BEGIN
  /* AN EVENT'S CHANGE AND THE TABLES IT TOUCHES (20261119053909, incident
     075013fd lane E2). A move, a break step, an entry close, a bounty sweep
     or collection of one event: the event's shared change lane (R(id)
     exclusive, then G and T(id) SHARED, then the transaction-bound marker
     smarter_private.tournament_rebuy_lane_held proves), then, when tables
     are named, the launch receipt, the event row and the tables' rows in id
     order (a hand commit's and a live chair's order), before any roster or
     seat row. Every table of the event that is not named keeps dealing; a
     hand of a named table waits on its row, and a hand commit elsewhere
     waits only for the event row, for this transaction's own duration. The event's exclusive authorities still
     exclude it through T(id), and its rebuys, busts and other changes wait
     for R(id), which nothing that holds G, F, B or T ever waits for.
     Re-entered free inside the same lane. Under an exclusive authority that
     already holds T(id) or G, only the rows are taken. p_try: never queue;
     answer false and hold nothing when a key is busy. */
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'an event lane needs its event' USING ERRCODE = '22004';
  END IF;
  v_t := hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0);
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks l
     WHERE l.pid = pg_backend_pid() AND l.locktype = 'advisory' AND l.objsubid = 1
       AND l.granted AND l.mode = 'ExclusiveLock'
       AND l.database = (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = current_database())
       AND ((l.classid = ((v_t >> 32) & 4294967295)::oid AND l.objid = (v_t & 4294967295)::oid)
         OR (l.classid = ((v_g >> 32) & 4294967295)::oid AND l.objid = (v_g & 4294967295)::oid)))
    INTO v_exclusive;
  IF NOT v_exclusive THEN
    IF v_held <> '' THEN
      IF split_part(v_held, ':', 1) <> p_tournament_id::text
         OR split_part(v_held, ':', 3) <> txid_current()::text
         OR (p_user_id IS NOT NULL AND split_part(v_held, ':', 2) NOT IN ('', p_user_id::text))
         OR NOT smarter_private.tournament_rebuy_lane_held(p_tournament_id, NULL) THEN
        RAISE EXCEPTION 'an event lane is held in this transaction as %, refused for %:%',
          v_held, p_tournament_id, p_user_id USING ERRCODE = '55000';
      END IF;
      IF p_user_id IS NOT NULL AND split_part(v_held, ':', 2) = '' THEN
        PERFORM set_config('ca.tournament_rebuy_lane',
          p_tournament_id::text || ':' || p_user_id::text || ':' || txid_current()::text, true);
      END IF;
    ELSE
      IF p_try THEN
        BEGIN
          IF NOT pg_try_advisory_xact_lock(
                   hashtextextended('ca:tournament-rebuy-lane:v1:' || p_tournament_id::text, 0))
             OR NOT pg_try_advisory_xact_lock_shared(
                   hashtextextended('ca:tournament-terminal-settlement:v1', 0))
             OR NOT pg_try_advisory_xact_lock_shared(
                   hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0)) THEN
            RAISE EXCEPTION 'EVENT_LANE_BUSY' USING ERRCODE = '55P03';
          END IF;
        EXCEPTION WHEN lock_not_available THEN
          -- The subtransaction's partial holds are released with it.
          RETURN false;
        END;
      ELSE
        PERFORM pg_advisory_xact_lock(
          hashtextextended('ca:tournament-rebuy-lane:v1:' || p_tournament_id::text, 0));
        PERFORM pg_advisory_xact_lock_shared(
          hashtextextended('ca:tournament-terminal-settlement:v1', 0));
        PERFORM pg_advisory_xact_lock_shared(
          hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0));
      END IF;
      PERFORM set_config('ca.tournament_rebuy_lane',
        p_tournament_id::text || ':' || COALESCE(p_user_id::text, '') || ':' || txid_current()::text, true);
    END IF;
  END IF;
  IF p_table_ids IS NOT NULL THEN
    -- A hand commit takes the event row (FOR SHARE) before its table row, and
    -- a live chair's launch proof takes the launch receipt, then the event
    -- row FOR UPDATE (fn_lock_tournament_launch_proof_parents). Every holder
    -- of this lane that names tables takes them in that order first, so it
    -- never upgrades the event row behind a hand that waits for its table.
    PERFORM 1 FROM public.tournament_launch_receipts r
     WHERE r.tournament_id = p_tournament_id FOR UPDATE;
    PERFORM 1 FROM public.tournaments t WHERE t.id = p_tournament_id FOR UPDATE;
    PERFORM 1 FROM public.tables tb
     WHERE tb.id = ANY (p_table_ids) AND tb.tournament_id = p_tournament_id
     ORDER BY tb.id
     FOR UPDATE;
  END IF;
  RETURN true;
END;
$function$;

CREATE FUNCTION smarter_private.tournament_bounty_claimant_tables(p_tournament_id uuid, p_eliminated_user_id uuid, p_extra jsonb DEFAULT NULL::jsonb)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  /* The tables the players a pending bounty may pay sit at now (20261119053909):
     the claimants and knocker of the event's pending obligations (of one
     eliminated player, or all of them), plus any extra claimants named. A
     bounty payer locks these in id order before any roster row, as the hand
     of each such table does. */
  SELECT COALESCE(array_agg(DISTINCT s.table_id ORDER BY s.table_id), '{}'::uuid[])
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id = s.table_id AND tb.tournament_id = p_tournament_id
   WHERE s.left_at IS NULL
     AND s.user_id IN (
       SELECT (e.value ->> 'user_id')::uuid
         FROM public.tournament_bounty_obligations o
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(o.claimants) = 'array' THEN o.claimants ELSE '[]'::jsonb END) e
        WHERE o.tournament_id = p_tournament_id AND o.state = 'pending'
          AND (p_eliminated_user_id IS NULL OR o.eliminated_user_id = p_eliminated_user_id)
          AND NULLIF(e.value ->> 'user_id', '') IS NOT NULL
       UNION
       SELECT o.knocker_user_id
         FROM public.tournament_bounty_obligations o
        WHERE o.tournament_id = p_tournament_id AND o.state = 'pending'
          AND (p_eliminated_user_id IS NULL OR o.eliminated_user_id = p_eliminated_user_id)
       UNION
       SELECT (e.value ->> 'user_id')::uuid
         FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p_extra) = 'array' THEN p_extra ELSE '[]'::jsonb END) e
        WHERE NULLIF(e.value ->> 'user_id', '') IS NOT NULL)
$function$;

CREATE FUNCTION smarter_private.cancellation_lane_for_events(p_tournament_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE
 g bigint := hashtextextended('ca:tournament-terminal-settlement:v1',0);
 b bigint := hashtextextended('ca:hand-settlement-barrier:v1',0);
 gx boolean; bx boolean;
BEGIN
 /* A CANCELLATION OF SEVERAL EVENTS (20261119053909). One event: that event's
    own lane, through smarter_private.cancellation_lane. Several: the platform
    lane, admitted by the original try (G then B exclusive, never queued, a
    55P03 refusal before any write), because their rows and banks span
    events. A batch already holding G and B keeps that authority. */
 IF p_tournament_ids IS NULL OR cardinality(p_tournament_ids) = 0 THEN
  RAISE EXCEPTION 'Tournament ids are required' USING ERRCODE='22004';
 END IF;
 IF cardinality(p_tournament_ids) = 1 THEN
  PERFORM smarter_private.cancellation_lane(p_tournament_ids[1]);
  RETURN;
 END IF;
 SELECT COALESCE(bool_or(k.key=g),false), COALESCE(bool_or(k.key=b),false)
   INTO gx, bx
   FROM pg_catalog.pg_locks l JOIN (VALUES(g),(b)) k(key)
     ON l.classid=((k.key>>32)&4294967295)::oid AND l.objid=(k.key&4294967295)::oid
  WHERE l.pid=pg_backend_pid() AND l.locktype='advisory' AND l.objsubid=1 AND l.mode='ExclusiveLock'
    AND l.database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND l.granted;
 IF gx THEN
  IF NOT bx THEN RAISE EXCEPTION 'CANCELLATION_GLOBAL_AUTHORITY_INCOMPLETE' USING ERRCODE='55000'; END IF;
  RETURN;
 END IF;
 IF NOT pg_try_advisory_xact_lock(g) THEN
  RAISE EXCEPTION 'CANCELLATION_GLOBAL_LANE_BUSY' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(b) THEN
  RAISE EXCEPTION 'CANCELLATION_BARRIER_BUSY' USING ERRCODE='55P03';
 END IF;
END;
$function$;

ALTER FUNCTION public.fn_ca_share_tournament_lane_for_tables(uuid, uuid, uuid[], boolean) OWNER TO postgres;
ALTER FUNCTION smarter_private.tournament_bounty_claimant_tables(uuid, uuid, jsonb) OWNER TO postgres;
ALTER FUNCTION smarter_private.cancellation_lane_for_events(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_ca_share_tournament_lane_for_tables(uuid, uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.tournament_bounty_claimant_tables(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.cancellation_lane_for_events(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_share_tournament_lane_for_tables(uuid, uuid, uuid[], boolean) TO service_role;

-- Exact substitutions on the pinned pre-images, each anchor counted, each
-- post-image pinned, owner, ACL, SECURITY DEFINER and proconfig preserved.
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
    ('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)',
     '4c3d4522dc52340a334e15b1b61af651', '6feaec933d08af1aa821d17f3c5dc093',
     ARRAY[$o1$  -- HOTFIX EDIT (b): G -> T via the 20260910035245 helper, not the raw global key.
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
$o1$],
     ARRAY[$n1$  -- A MOVE PAUSES ONLY ITS TWO TABLES (20261119053909, incident 075013fd
  -- lane E2). It took the event's rolling lane, T(id) EXCLUSIVE, and every
  -- table of the event stopped while it ran. It writes its player's seat and
  -- roster row and the counts of its source and destination tables: the
  -- event's shared change lane (R(id) exclusive, G and T(id) shared, the
  -- marker for this player), then, in a hand commit's order, the event row
  -- and those two tables' rows in id order, before any other row. Other
  -- tables keep dealing; a hand of either table and the move wait for each
  -- other on that table's row; a hand commit elsewhere waits only for the
  -- event row, which the move's chair needs anyway (the launch-proof lock on
  -- every live seat acquisition), for the move's own few milliseconds.
  PERFORM public.fn_ca_share_tournament_lane_for_tables(
    p_tournament_id,p_user_id,ARRAY[p_source_table_id,p_destination_table_id]);
$n1$]),
    ('smarter_private.f06_lock_break(uuid,uuid,uuid,uuid)',
     '96942d8b2ea2ff76eee349fec9913d2d', '3e1517132732c4c3831ce475372e1faf',
     ARRAY[$o2$ PERFORM public.fn_ca_lock_settlement_lane_for_tournament(t);
$o2$, $o3$ PERFORM smarter_private.f06_prefix(t,g,COALESCE(users,'{}'),ids);
$o3$],
     ARRAY[$n2$ -- 20261119053909 (075013fd lane E2): the event's shared change lane, not
 -- T(id) exclusive; a break step pauses only the tables it names below.
 PERFORM public.fn_ca_share_tournament_lane_for_tables(t,NULL,NULL);
$n2$, $n3$ -- The break's source and destination tables, in id order, before f06_prefix
 -- locks the members' roster rows: the order a hand of those tables keeps.
 PERFORM public.fn_ca_share_tournament_lane_for_tables(t,NULL,ids);
 PERFORM smarter_private.f06_prefix(t,g,COALESCE(users,'{}'),ids);
$n3$]),
    ('public.fn_f06_begin_break(uuid,uuid,uuid,jsonb)',
     'efebd049c672b162c180bbed1fd41af0', '2af9c300c9abad88765005e651e8da7e',
     ARRAY[$o4$ PERFORM smarter_private.f06_prefix(p_tournament_id,p_lease_generation,users,array_append(ids,o.source_table_id));
$o4$],
     ARRAY[$n4$ -- 20261119053909 (075013fd lane E2): the event's shared change lane and the
 -- source and destination tables' rows; other tables of the event keep dealing.
 PERFORM smarter_private.f06_authority(p_tournament_id,p_lease_generation);
 PERFORM public.fn_ca_share_tournament_lane_for_tables(p_tournament_id,NULL,array_append(ids,o.source_table_id));
 PERFORM smarter_private.f06_prefix(p_tournament_id,p_lease_generation,users,array_append(ids,o.source_table_id));
$n4$]),
    ('smarter_private.f06_prefix(uuid,uuid,uuid[],uuid[])',
     'dae9d5b5f71a68362f202dfdf89c8fae', '4c5e4678099189489491ea66d02d1e7a',
     ARRAY[$o16$ WHERE tb.tournament_id=t AND (s.user_id=ANY(users) OR s.table_id=ANY(ids)) ORDER BY s.id FOR UPDATE OF s;
$o16$],
     ARRAY[$n16$ -- 20261119053909 (075013fd lane E2): a member's LIVE chair, not every chair it
 -- ever left: a left chair belongs to the table it was left at, whose hands
 -- lock all of that table's chairs, and a break step no longer pauses them.
 WHERE tb.tournament_id=t AND (s.table_id=ANY(ids) OR (s.user_id=ANY(users) AND s.left_at IS NULL)) ORDER BY s.id FOR UPDATE OF s;
$n16$]),
    ('public.fn_f06_request_park(uuid,uuid,uuid,uuid,bigint,uuid)',
     'b26c7d2be9e33057ec884bab875f283f', '723d83ccb6d25dd694001bc5622ab9d8',
     ARRAY[$o5$ PERFORM smarter_private.f06_prefix(p_tournament_id,p_lease_generation,'{}',ARRAY[p_table_id]);
$o5$],
     ARRAY[$n5$ -- 20261119053909 (075013fd lane E2): parking one table fences that table.
 PERFORM smarter_private.f06_authority(p_tournament_id,p_lease_generation);
 PERFORM public.fn_ca_share_tournament_lane_for_tables(p_tournament_id,NULL,ARRAY[p_table_id]);
 PERFORM smarter_private.f06_prefix(p_tournament_id,p_lease_generation,'{}',ARRAY[p_table_id]);
$n5$]),
    ('public.fn_f06_discover_breaks(uuid,uuid,bigint,integer)',
     'ee849383bac8962af9d110341293317a', '56718b7cffa17dde7b16bc5a2994d901',
     ARRAY[$o6$ PERFORM smarter_private.f06_prefix(p_tournament_id,p_lease_generation,'{}','{}');
$o6$],
     ARRAY[$n6$ -- 20261119053909 (075013fd lane E2): the scan reads operations and moves
 -- its own cursor row (locked below). It takes the lease fence and no lane
 -- and no tournament row, so it never queues a hand of the event.
 PERFORM smarter_private.f06_authority(p_tournament_id,p_lease_generation);
$n6$]),
    ('public.fn_close_tournament_entry_window(uuid,text)',
     '0d8f5951cdf5ded326f01ad39ba86d44', 'd0769704a1b0d503aa165c6b9d865502',
     ARRAY[$o7$  IF p_tournament_id IS NOT NULL THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  END IF;
$o7$],
     ARRAY[$n7$  /* 20261119053909 (075013fd lane E2): the event's SHARED change lane, not
     T(id) exclusive. The close reads the tournaments row and, once, writes it
     and the pool rows; it touches no table, seat or roster row, so no table
     waits for it. Rebuys, registrations and busts of the event wait for R(id)
     and see the window it leaves; the deferred payer's lane request at
     COMMIT returns at once inside this lane (20261119011750). */
  IF p_tournament_id IS NOT NULL THEN
    PERFORM public.fn_ca_share_tournament_lane_for_tables(p_tournament_id,NULL,NULL);
  END IF;
$n7$]),
    ('public.fn_sweep_pending_tournament_bounties(uuid,integer)',
     '81512d0707a7a8a8c334234838974019', 'c023c1ff8910890f17132fee6d373252',
     ARRAY[$o8$      IF pg_try_advisory_xact_lock(hashtextextended(
           'ca:tournament-terminal-settlement:v1:' || candidate.tournament_id::text, 0)) THEN
$o8$, $o9$    END LOOP;
  END IF;
  FOR candidate IN
$o9$],
     ARRAY[$n8$      -- 20261119053909 (075013fd lane E2): the event's shared change lane,
      -- tried (never queued), not T(id) exclusive: no table of the event
      -- waits for the payouts below.
      IF public.fn_ca_share_tournament_lane_for_tables(candidate.tournament_id,NULL,NULL,true) THEN
$n8$, $n9$    END LOOP;
  END IF;
  -- The tables the claimants it may pay sit at, in id order, before any
  -- roster row: a hand of one of them and this sweep wait on its row.
  IF v_scope IS NOT NULL THEN
    PERFORM public.fn_ca_share_tournament_lane_for_tables(v_scope,NULL,
      smarter_private.tournament_bounty_claimant_tables(v_scope,NULL,NULL));
  END IF;
  FOR candidate IN
$n9$]),
    ('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)',
     'a09b607ee2fa1471db815a9fc8a30b97', '208d836177414ccc989bd47e941d83bb',
     ARRAY[$o10$  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
$o10$],
     ARRAY[$n10$  -- 20261119053909 (075013fd lane E2): the event's shared change lane (taken
  -- as held inside a rebuy, a bust or a sweep; under an exclusive authority
  -- only the rows), then the tables its claimants sit at, in id order, before
  -- any roster row. A collection outside a rebuy no longer pauses the event.
  PERFORM public.fn_ca_share_tournament_lane_for_tables(p_tournament_id,NULL,NULL);
  PERFORM public.fn_ca_share_tournament_lane_for_tables(p_tournament_id,NULL,
    smarter_private.tournament_bounty_claimant_tables(p_tournament_id,p_eliminated_user_id,
      COALESCE(CASE WHEN jsonb_typeof(p_claimants)='array' THEN p_claimants END,'[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('user_id',p_collector_user_id))));
$n10$]),
    ('smarter_private.cancellation_lane(uuid)',
     'd66f767af93b4c9e93c42bcc9472005e', '2e0ee1b699d2b368490e796e1195a090',
     ARRAY[$o11$  IF NOT gs OR NOT fx OR scope<>'' THEN
$o11$, $o12$ -- Preserve the original complete financial exclusion. A try-lock never
$o12$],
     ARRAY[$n11$  -- 20261119053909: or this event's own finish lane (F shared, F(scope)
  -- exclusive), which a single-event cancellation takes below.
  IF NOT gs OR NOT (fx OR (scope<>'' AND EXISTS(SELECT 1 FROM pg_catalog.pg_locks l
       WHERE l.pid=pg_backend_pid() AND l.locktype='advisory' AND l.objsubid=1
       AND l.database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
       AND l.classid=((hashtextextended('ca:tournament-finish-lane:v1:scope:'||scope,0)>>32)&4294967295)::oid
       AND l.objid=(hashtextextended('ca:tournament-finish-lane:v1:scope:'||scope,0)&4294967295)::oid
       AND l.mode='ExclusiveLock' AND l.granted))) THEN
$n11$, $n12$ -- ONE EVENT'S CANCELLATION FENCES ONE EVENT (20261119053909, incident
 -- 075013fd lane E2). An operator or owner cancel, an abort settle or any
 -- other single-event cancellation of a plain event with a bank scope takes
 -- that event's own finish lane: G shared, F shared, F(scope) exclusive and
 -- T(id) exclusive, the 2026-09-17 wallet order of every finish. It pauses
 -- that event's tables only; no other event's table and no cash hand waits.
 -- Nested authorities re-enter it through the finish marker. A satellite
 -- (two events) or an id that is not a plain event keeps the platform try.
 IF EXISTS (SELECT 1 FROM public.tournaments t LEFT JOIN public.clubs c ON c.id=t.club_id
             WHERE t.id=p_tournament_id
               AND NOT (lower(COALESCE(t.variant::text,''))='satellite'
                     OR upper(COALESCE(t.tournament_type::text,''))='SATELLITE'
                     OR t.satellite_target_id IS NOT NULL OR t.satellite_target IS NOT NULL)
               AND COALESCE(c.union_id::text,t.club_id::text,'')<>'') THEN
  PERFORM public.fn_ca_lock_settlement_lane_for_finish(p_tournament_id);
  RETURN;
 END IF;
 -- Preserve the original complete financial exclusion. A try-lock never
$n12$]),
    ('public.fn_ca_request_tournament_abort(uuid,uuid[],text)',
     '3abdfc8c4401a3e99f563b5862456b22', '32f142943524e1c31fe87d8c61a5112d',
     ARRAY[$o13$ -- This existing try-admission takes G and the settlement barrier before any
 -- parent/child row. It never queues an exclusive global request behind play.
 PERFORM smarter_private.cancellation_lane(ids[1]);
$o13$],
     ARRAY[$n13$ -- 20261119053909 (075013fd lane E2): a request naming one event takes that
 -- event's own lane; one naming several keeps the platform try (G and the
 -- settlement barrier, never queued) before any parent/child row.
 PERFORM smarter_private.cancellation_lane_for_events(ids);
$n13$]),
    ('public.fn_ca_settlement_lane_doctrine()',
     'd1c13960687824de74bf3836e7b54259', 'dba20d4f19dd94eab19506582ffb04f3',
     ARRAY[$o14$       AND md5(pg_get_functiondef(p.oid))='d66f767af93b4c9e93c42bcc9472005e'
$o14$, $o15$  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$o15$],
     ARRAY[$n14$       AND md5(pg_get_functiondef(p.oid))='2e0ee1b699d2b368490e796e1195a090'
$n14$, $n15$  -- 8. An event's moves, breaks, entry close and bounty payouts share its
  --    lane, and one event's cancellation takes only that event's lane
  --    (20261119053909, incident 075013fd lane E2; 2026-11-17: "a tournament
  --    issue must always be isolated and never affect other tournaments or
  --    cash games"). The event-and-tables lane takes T(id) only shared; its
  --    callers are exactly the reviewed ones and none of them still calls the
  --    rolling helper; the break scan takes no lane; the cancellation lane
  --    scopes a single plain event to its finish lane, and the abort request
  --    reaches the platform try only for several events. Names in pieces.
  SELECT string_agg(p.proname::text, ',' ORDER BY p.proname::text COLLATE "C")
    INTO v_set
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'smarter_private') AND p.prokind = 'f'
     AND p.prosrc LIKE '%fn_ca_share_tournament_lane_' || 'for_tables(%'
     AND p.prosrc ~ ('(PERFORM|SELECT|:=|IF)\s+public\.fn_ca_share_tournament_lane_' || 'for_tables\s*\(');
  IF v_set IS DISTINCT FROM 'f06_lock_break,fn_close_tournament_entry_window,fn_collect_bounty,fn_f06_begin_break,'
       'fn_f06_request_park,fn_move_tournament_player,fn_sweep_pending_tournament_bounties'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = to_regprocedure('public.fn_ca_share_tournament_lane_' || 'for_tables(uuid,uuid,uuid[],boolean)')
          AND p.prosrc ~ ('pg_advisory_xact_lock_shared\(\s*hashtextextended\(\s*''ca:tournament-terminal-' || 'settlement:v1:''')
          AND p.prosrc !~ ('(pg_advisory_xact_lock|pg_try_advisory_xact_lock)\(\s*hashtextextended\(\s*''ca:tournament-terminal-' || 'settlement:v1'))
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid IN (to_regprocedure('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'),
                        to_regprocedure('smarter_private.f06_lock_break(uuid,uuid,uuid,uuid)'),
                        to_regprocedure('public.fn_f06_begin_break(uuid,uuid,uuid,jsonb)'),
                        to_regprocedure('public.fn_f06_request_park(uuid,uuid,uuid,uuid,bigint,uuid)'),
                        to_regprocedure('public.fn_f06_discover_breaks(uuid,uuid,bigint,integer)'),
                        to_regprocedure('public.fn_close_tournament_entry_window(uuid,text)'),
                        to_regprocedure('public.fn_sweep_pending_tournament_bounties(uuid,integer)'),
                        to_regprocedure('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'))
          AND (p.prosrc ~ ('(PERFORM|SELECT|:=)\s+public\.fn_ca_lock_settlement_lane_for_' || 'tournament\s*\(')
               OR p.prosrc ~ ('pg_(try_)?advisory_xact_lock\(\s*hashtextextended\(\s*''ca:tournament-terminal-' || 'settlement:v1')))
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = to_regprocedure('public.fn_f06_discover_breaks(uuid,uuid,bigint,integer)')
          AND p.prosrc !~ ('f06_' || 'prefix\(|fn_ca_lock_settlement_lane_|fn_ca_share_tournament_lane_'))
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = to_regprocedure('smarter_private.cancellation_lane(uuid)')
          AND p.prosrc ~ ('PERFORM\s+public\.fn_ca_lock_settlement_lane_for_' || 'finish\(p_tournament_id\)'))
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = to_regprocedure('public.fn_ca_request_tournament_abort(uuid,uuid[],text)')
          AND p.prosrc ~ ('smarter_private\.cancellation_lane_' || 'for_events\(ids\)')
          AND p.prosrc !~ ('smarter_private\.cancellation_' || 'lane\(')) THEN
    v_violations := v_violations || jsonb_build_object('rule', 'an_event_change_fences_only_its_own_tables', 'found', COALESCE(v_set, 'none'));
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$n15$])
    ) AS s(signature, preimage, postimage, olds, news)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'event lane E2: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    FOR i IN 1 .. cardinality(r.olds) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'event lane E2: % anchor % occurs % times', r.signature, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    IF md5(v_def) <> r.postimage THEN
      RAISE EXCEPTION 'event lane E2: % would not land on its reviewed post-image (md5 %)', r.signature, md5(v_def);
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) <> r.postimage
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
            AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
            AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'event lane E2: % did not land on its post-image, or its metadata changed', r.signature;
    END IF;
  END LOOP;
END $subs$;

-- Probes (scripts/ci/templates/function-probe.sql): each new body runs once in
-- a subtransaction that is always undone. They use an event id that does not
-- exist, so they reach the changed lane code and take no lock any live event
-- or table holds. The full behaviour runs natively in
-- scripts/ci/test-rebuy-never-pauses-the-tournament.py (section LANE E2).

-- @probe-for: public.fn_collect_bounty
DO $probe$
BEGIN
  PERFORM public.fn_collect_bounty(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '[]'::jsonb);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_sweep_pending_tournament_bounties
DO $probe$
BEGIN
  PERFORM public.fn_sweep_pending_tournament_bounties(gen_random_uuid(), 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_close_tournament_entry_window
DO $probe$
BEGIN
  PERFORM public.fn_close_tournament_entry_window(gen_random_uuid(), 'migration.probe');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_share_tournament_lane_for_tables
DO $probe$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.fn_ca_share_tournament_lane_for_tables(v_id, NULL, ARRAY[gen_random_uuid()])
     OR NOT smarter_private.tournament_rebuy_lane_held(v_id, NULL)
     OR smarter_private.tournament_bounty_claimant_tables(v_id, NULL, '[]'::jsonb) <> '{}'::uuid[] THEN
    RAISE EXCEPTION 'event lane E2: the new lane does not prove itself held';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-exempt: public.fn_move_tournament_player requires the engine's service authority (fn_caller_is_engine); executed natively by the harness
-- @probe-exempt: smarter_private.f06_lock_break requires a live protocol-2 engine lease (f06_authority); executed natively by the harness
-- @probe-exempt: public.fn_f06_begin_break requires a live protocol-2 engine lease (f06_authority); executed natively by the harness
-- @probe-exempt: smarter_private.f06_prefix requires a live protocol-2 engine lease (f06_authority); executed natively by the harness
-- @probe-exempt: public.fn_f06_request_park requires a live protocol-2 engine lease (f06_authority); executed natively by the harness
-- @probe-exempt: public.fn_f06_discover_breaks requires a live protocol-2 engine lease (f06_authority); executed natively by the harness
-- @probe-exempt: public.fn_ca_request_tournament_abort requires service_role and writes operator abort state; pinned by the law test
-- @probe-exempt: smarter_private.cancellation_lane would take a live event's finish lane or the platform try; executed natively by the harness

DO $post$
DECLARE
  v_doctrine jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)', '76dddeb34b3508a48b777c2c79442072'),
      ('smarter_private.tournament_bounty_claimant_tables(uuid,uuid,jsonb)', '6e05b91a607dc80f359386bd47c6a423'),
      ('smarter_private.cancellation_lane_for_events(uuid[])', '2b06eebd282edeb476feba2299561d33')
    ) AS x(sig, post)
    WHERE md5(pg_get_functiondef(x.sig::regprocedure)) IS DISTINCT FROM x.post) THEN
    RAISE EXCEPTION 'event lane E2: a new lane function is not its reviewed text';
  END IF;
  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'event lane E2: the lane doctrine fails after the change: %', v_doctrine;
  END IF;
END $post$;

COMMIT;
