-- 20261119011750_bounty_rebuys_and_eliminations_share_the_event_lane.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A REBUY NEVER PAUSES THE ACTION, IN ANY FORMAT, AND NEITHER DOES A BUST
-- (incident 075013fd, lane R2). Owner rule, Dan 2026-08-30: "REBUYS IN A
-- TOURNAMENT SHOULD NOT PAUSE THE ACTION." Requires 20261118191946 (the
-- shared rebuy lane); refuses to run if its post-images are not installed.
-- Full account: docs/changelog/2026-11-19-bounty-rebuys-and-busts-share-the-event-lane.md.
--
-- WHAT WAS LEFT AFTER 20261118191946.
-- 1. A rebuy or re-entry of a bounty, PKO or mystery event still took its
--    event's rolling lane, T(id) EXCLUSIVE: its prior bounty generation is
--    settled by fn_ca_settle_bounty_rebuy_generation_v1 through authorities
--    that each take that lane (seat-exit authority, the legacy claim,
--    fn_collect_bounty, fn_mystery_bounty_reserve and _pay), and a shared
--    hold upgraded there would deadlock with the event's hands.
-- 2. Every bust took the same exclusive lane: fn_eliminate_tournament_player_
--    atomic (fn_ca_lock_settlement_lane_for_tournament) and
--    fn_claim_tournament_bounty_elimination (G shared + T(id) exclusive
--    directly), so all tables of an event waited for each bust to record.
--
-- THE FIX. The shared change lane of 20261118191946 (R(id) exclusive, G and
-- T(id) shared, a marker bound to this transaction; proven by
-- smarter_private.tournament_rebuy_lane_held) becomes the authority of every
-- change to an event's field: rebuys, re-entries, add-ons and busts, in every
-- format. R(id) records them one at a time; T(id) still makes the event's
-- exclusive authorities (balancing moves, breaks, final table, terminal
-- settlement) wait for them and them for it.
--  * fn_ca_lock_settlement_lane_for_tournament returns at once for its event
--    inside that lane: the nested authorities above keep their own row locks
--    and take the lane as already held, so nothing upgrades to exclusive.
--  * smarter_private.f06_try_lane accepts the same proof, so the F06 guards
--    (source, table) accept the lane's own writes; custody checks unchanged.
--  * process_tournament_rebuy takes the shared lane in every format.
--  * fn_ca_settle_bounty_rebuy_generation_v1 locks the tables its claimants
--    sit at, in id order, before any roster row: the knockers it pays are
--    seated players whose rows the hands of those tables write after their
--    table row, so the two serialise on the table row and never cross.
--  * both elimination doors take the shared lane and then the busted
--    player's own table row before any of its rows.
--  * doctrine rule 6 names the three callers and the four places that accept
--    the proof.
--
-- WHY A BUST NEEDS NOTHING EXCLUSIVE. It writes the busted player's roster
-- row, its zero chair and its table's count (all under that table's row),
-- its own knockout candidate and bounty obligation, and - at commit, once the
-- pool is final - the standings and payouts of players already out
-- (fn_ca_pay_tournament_finishers_now). No hand of another table writes any
-- of those rows. Two busts, or a bust and a rebuy, of one event never run
-- side by side: R(id). The place a bust is given is the engine's, checked by
-- the place-collision guard as before.
--
-- LOCK ORDER. R(id), then lane T's G -> F -> B -> T(id), then rows: launch
-- receipt, tournament, tables in id order, roster, seats. Only R holders lock
-- more than one table row, and they run one at a time.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION and a GRANT only: no table or
-- row lock, no install window, one transaction, one schema reload.
--
-- STALE PIN. smarter_private.original_hand_correction_sources_match() pins the
-- rolling lane helper's body in its 26-function list; it already answers false
-- on production (read 2026-11-19), so its outcome does not change.
-- @stale-pin-ok: 9877846ffabee004690e6b24a3ddcee2 original_hand_correction_sources_match already answers false on production; moving one of its 26 pins would not revive it
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)'::regprocedure)) = 'b76daaf8587cca4eeac91ec39e9e7ce3')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $requires$
BEGIN
  IF to_regprocedure('smarter_private.tournament_rebuy_lane_held(uuid,uuid)') IS NULL
     OR md5(pg_get_functiondef('smarter_private.tournament_rebuy_lane_held(uuid,uuid)'::regprocedure)) <> 'd32dad9b538f214bdeb224e1596d5416'
     OR md5(pg_get_functiondef('public.fn_ca_share_tournament_lane_for_rebuy(uuid,uuid)'::regprocedure)) <> '004125787ce2db12d8f3e8d68ab6da94' THEN
    RAISE EXCEPTION 'rebuy lane R2: 20261118191946 (the shared rebuy lane) must be installed first';
  END IF;
END $requires$;

-- The proof is a predicate about the caller's own transaction; every caller of
-- the rolling lane helper and of the F06 try reaches it, whatever its role.
GRANT EXECUTE ON FUNCTION smarter_private.tournament_rebuy_lane_held(uuid, uuid) TO PUBLIC;

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
    ('public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)',
     '9877846ffabee004690e6b24a3ddcee2', 'b76daaf8587cca4eeac91ec39e9e7ce3',
     ARRAY[$o1$  IF v_tournament_id IS NULL THEN
    -- Nothing to scope to$o1$],
     ARRAY[$n1$  -- 20261119011750 (075013fd lane R2): inside its event's shared change
  -- lane (smarter_private.tournament_rebuy_lane_held: R(id) exclusive, T(id)
  -- shared and a marker bound to this transaction) a rebuy or an elimination
  -- already holds its event's authority for the rows it writes. Upgrading
  -- T(id) to exclusive here, as every nested authority it reaches asks
  -- (seat-exit, bounty collection, mystery reserve and pay, the finisher
  -- payout at commit), would pause every table of the event and deadlock
  -- with them. Every caller outside such a lane is unchanged.
  IF v_tournament_id IS NOT NULL
     AND smarter_private.tournament_rebuy_lane_held(v_tournament_id, NULL) THEN
    RETURN;
  END IF;

  IF v_tournament_id IS NULL THEN
    -- Nothing to scope to$n1$]),
    ('smarter_private.f06_try_lane(uuid)',
     'a0c4e1b564f90f934222cd298c668b2b', '96ce828d6019c6c18fe660222bbd9feb',
     ARRAY[$o2$ IF t IS NOT NULL AND (NOT pg_try_advisory_xact_lock_shared$o2$],
     ARRAY[$n2$ -- 20261119011750: the event's shared change lane is its own proof.
 IF t IS NOT NULL AND NOT smarter_private.tournament_rebuy_lane_held(t,NULL) AND (NOT pg_try_advisory_xact_lock_shared$n2$]),
    ('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)',
     '6629aceb3ff583a87272c4127f91923f', 'd5da73993760ca26529d284c144fec60',
     ARRAY[$o3$  -- A REBUY NEVER PAUSES THE TOURNAMENT (20261118191946, incident 075013fd
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
$o3$, $o4$    IF v_lane_shared THEN
      -- The shared lane's seat root: the seat gate's refusals and player
      -- keys and the candidate's table row, without its field-wide row locks.
      v_gate:=public.fn_ca_lock_tournament_rebuy_acquisition(
        p_tournament_id,v_table_id,p_user_id);
    ELSE
      v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
        p_tournament_id,NULL,p_user_id);
    END IF;
$o4$],
     ARRAY[$n3$  -- A REBUY NEVER PAUSES THE TOURNAMENT, IN ANY FORMAT (20261118191946,
  -- 20261119011750; incident 075013fd lanes R and R2; Dan 2026-08-30:
  -- "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION"). Every rebuy,
  -- re-entry and add-on shares its event's lane: R(id) exclusive (one change
  -- of this event's field at a time), then G and T(id) SHARED, so every table
  -- of the event keeps dealing. The event's exclusive authorities still
  -- exclude it through T(id); a hand of a table it writes is fenced by that
  -- table's row. A bounty, PKO or mystery generation is settled inside the
  -- same lane: its nested authorities take the lane as already held, and it
  -- locks the tables its claimants sit at before their rows.
  PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);
  v_lane_shared:=true;
  PERFORM pg_advisory_xact_lock_shared(530090,1);
$n3$, $n4$    -- The shared lane's seat root: the seat gate's refusals and player
    -- keys and the candidate's table row, without its field-wide row locks.
    v_gate:=public.fn_ca_lock_tournament_rebuy_acquisition(
      p_tournament_id,v_table_id,p_user_id);
$n4$]),
    ('public.fn_ca_settle_bounty_rebuy_generation_v1(uuid,uuid,uuid)',
     '0fa6068155c7d964e698ff13bccb36b2', 'c879b710d42ee6514e603c1983558330',
     ARRAY[$o5$  SELECT * INTO v_player
    FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
   FOR UPDATE;
$o5$],
     ARRAY[$n5$  -- 20261119011750 (075013fd lane R2): under the event's SHARED change lane
  -- this settles beside the event's hands. The knockers it pays are seated
  -- players whose roster rows those hands write, always after their own
  -- table's row; so take the tables the claimants sit at now, in id order,
  -- before any roster row, exactly as a hand would. A hand of one of those
  -- tables then waits for this settlement, or this waits for it; never both.
  IF smarter_private.tournament_rebuy_lane_held(p_tournament_id,p_user_id) THEN
    PERFORM 1
      FROM public.tables tb
     WHERE tb.tournament_id=p_tournament_id
       AND tb.id IN (
         SELECT s.table_id
           FROM public.tournament_knockout_candidates c
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(
             (SELECT o.claimants FROM public.tournament_bounty_obligations o
               WHERE o.tournament_id=c.tournament_id
                 AND o.eliminated_user_id=c.eliminated_user_id
                 AND o.table_id=c.table_id AND o.hand_id=c.hand_id
                 AND o.hand_number=c.hand_number
                 AND o.seat_joined_at=c.seat_joined_at
               ORDER BY o.id LIMIT 1),
             public.fn_exact_tournament_knockout_claimants(
               c.tournament_id,c.hand_id,c.eliminated_user_id),
             '[]'::jsonb)) e
           JOIN public.table_seats s
             ON s.user_id=(e->>'user_id')::uuid AND s.left_at IS NULL
          WHERE c.id=p_candidate_id AND c.tournament_id=p_tournament_id)
     ORDER BY tb.id
     FOR UPDATE;
  END IF;

  SELECT * INTO v_player
    FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
   FOR UPDATE;
$n5$]),
    ('public.fn_eliminate_tournament_player_atomic(uuid,uuid,integer,numeric,numeric)',
     '4f39ac5ff068867c42e07f3418205e82', '5098a06e22430936b7e40bbd59edc5c7',
     ARRAY[$o6$  -- Acquire G shared then T exclusive before any tournament/player row lock.
  -- The unchanged F06 trigger only tries this lane once rows are locked.
  -- A concurrent accepted hand owns T shared; waiting here lets that hand
  -- finish without a row-lock inversion or a failed elimination retry.
  IF p_tournament_id IS NOT NULL THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  END IF;
$o6$, $o7$  SELECT * INTO v_player FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
   FOR UPDATE;
$o7$],
     ARRAY[$n6$  -- AN ELIMINATION NEVER PAUSES THE TOURNAMENT (20261119011750, incident
  -- 075013fd lane R2). It took its event's rolling lane, T(id) EXCLUSIVE, so
  -- every table of the event waited for each bust to be recorded. It writes
  -- only the busted player's own rows, its own table's count and the
  -- standings of players already out, none of which another table's hand
  -- writes; so it takes the event's shared change lane (R(id) exclusive, G
  -- and T(id) shared): busts, rebuys and re-entries of one event are recorded
  -- one at a time, the event's exclusive authorities still exclude it, and
  -- the busted player's table row is taken below before any of its rows.
  IF p_tournament_id IS NOT NULL THEN
    PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);
  END IF;
$n6$, $n7$  -- The busted player's table, before its roster and seat rows, in the
  -- order a hand of that table takes them.
  PERFORM 1 FROM public.tables tb
   WHERE tb.tournament_id=p_tournament_id
     AND tb.id IN (SELECT s.table_id FROM public.table_seats s
                    WHERE s.user_id=p_user_id AND s.left_at IS NULL)
   ORDER BY tb.id
   FOR UPDATE;

  SELECT * INTO v_player FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
   FOR UPDATE;
$n7$]),
    ('public.fn_claim_tournament_bounty_elimination(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)',
     'd46a8bb396606348eaa05102ea8f0453', 'd5bc2c4fdd9fa012371d069182f85f51',
     ARRAY[$o8$    PERFORM pg_advisory_xact_lock_shared(
      hashtextextended('ca:tournament-terminal-settlement:v1', 0));
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0));
$o8$, $o9$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;
  IF EXISTS (
$o9$],
     ARRAY[$n8$    -- 20261119011750 (075013fd lane R2): the event's SHARED change lane
    -- (R(id) exclusive, G and T(id) shared), not T(id) exclusive: a bounty
    -- bust writes the busted player's rows, its table's count and its own
    -- obligation, and pauses no other table while it is recorded.
    PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_eliminated_user_id);
$n8$, $n9$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;
  -- The busted player's table, before any roster or seat row.
  PERFORM 1 FROM public.tables tb
   WHERE tb.id=p_table_id AND tb.tournament_id=p_tournament_id
   FOR UPDATE;
  IF EXISTS (
$n9$]),
    ('public.fn_ca_settlement_lane_doctrine()',
     '86d052c0c8aee728385ddcab51d83795', 'be8d765b7d03821ef9a4c9ea730a8f30',
     ARRAY[$o10$  IF v_set IS DISTINCT FROM 'process_tournament_rebuy'
$o10$, $o11$          WHERE p.oid IN (to_regprocedure('public.fn_tournament_live_seat_acquisition_requires_authority()'),
                          to_regprocedure('smarter_private.f06_source_guard()'))
            AND p.prosrc ~ ('smarter_private\.tournament_rebuy_' || 'lane_held\(')) <> 2 THEN$o11$],
     ARRAY[$n10$  IF v_set IS DISTINCT FROM 'fn_claim_tournament_bounty_elimination,fn_eliminate_tournament_player_atomic,process_tournament_rebuy'
$n10$, $n11$          WHERE p.oid IN (to_regprocedure('public.fn_tournament_live_seat_acquisition_requires_authority()'),
                          to_regprocedure('smarter_private.f06_source_guard()'),
                          to_regprocedure('smarter_private.f06_try_lane(uuid)'),
                          to_regprocedure('public.fn_ca_lock_settlement_lane_for_' || 'tournament(uuid,uuid)'))
            AND p.prosrc ~ ('smarter_private\.tournament_rebuy_' || 'lane_held\(')) <> 4 THEN$n11$])
    ) AS s(signature, preimage, postimage, olds, news)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'rebuy lane R2: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    FOR i IN 1 .. cardinality(r.olds) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'rebuy lane R2: % anchor % occurs % times', r.signature, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    IF md5(v_def) <> r.postimage THEN
      RAISE EXCEPTION 'rebuy lane R2: % would not land on its reviewed post-image (md5 %)', r.signature, md5(v_def);
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) <> r.postimage
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
            AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
            AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'rebuy lane R2: % did not land on its post-image, or its metadata changed', r.signature;
    END IF;
  END LOOP;
END $subs$;

DO $post$
DECLARE
  v_doctrine jsonb;
BEGIN
  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'rebuy lane R2: the lane doctrine fails after the change: %', v_doctrine;
  END IF;
END $post$;

COMMIT;
