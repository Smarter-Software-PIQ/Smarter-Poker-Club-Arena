-- 20261123013241_a_called_name_keeps_its_place_under_the_hourly_cap.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A CALLED NAME KEEPS ITS PLACE, AND A FEEDER START IS NEVER STRANDED BY THE
-- HOURLY CAP'S PACING (Dan 2026-11-22: "Horses need to join waiting lists ...
-- MAKE SURE THIS FUNCTIONALITY IS FULLY UPDATED AND CORRECTED"; "FINISH UP ANY
-- AND ALL UNFINISHED WORK").
--
-- WHAT WAS WRONG, READ FROM THE RECORDED BODIES (native proof below)
--
-- The hourly cash policy (20261116153902, 20261116194028) does two jobs. It
-- caps how many horse tables run each Chicago hour, which is what keeps the
-- weekly horse cash rake in budget, and it paces the fleet's own unsolicited
-- seating: one new autonomous table per 2-4 minutes on the floor clock, and
-- one autonomous horse per 2-4 minutes into a table that is still assembling.
-- fn_cash_hourly_table_admit, run on every seat insert, applied both clocks to
-- every horse arrival, including the game's OWN seating:
--
--  1. A name the list called. fn_offer_open_seat holds a chair for sixty
--     seconds; a new feeder admits one horse per 2-4 minutes, so the second
--     to fourth names were refused (cash_hourly_horse_arrival_paced), the hold
--     lapsed and the lapsed call took the name off the list (20261023094000).
--     The engine also skipped every table the projection refused, so even an
--     answerable call at such a table went unanswered.
--  2. A full-ring feeder start. Of the last two players moved off a full
--     nine-handed Main 1, the second is a one-way move into an assembling
--     table: refused by the same arrival clock, so the feeder started with
--     one player and the held Main chairs waited on a move that never came.
--     The first could be refused too: the opener (fn_cash_hourly_feeder_
--     admissible) counts empty opening feeders against the cap, the admission
--     did not, so an unrelated start took the slot (cash_hourly_table_cap_
--     reached), or stamped the floor clock (cash_hourly_table_start_paced),
--     between the feeder opening and its first move.
--  3. A table the cap is closing. fn_offer_open_seat called its seat to the
--     first name in line; a horse there is refused at an excess table, so the
--     call lapsed and the horse left the list behind the person it was ahead of.
--
-- WHAT THE PACING GATES NOW (the decision, stated once)
--
--   The table cap gates every horse start of a new table and every horse
--   arrival at a table it is closing: it limits the NUMBER of horse tables and
--   nothing else. The two 2-4 minute clocks gate the fleet's own unsolicited
--   purchases. Neither clock gates the game's own seating: a name the list
--   called to this table, or a sanctioned move inside the game (must-move, a
--   feeder start's bump, a break). Those are spaced by the game itself (one
--   name per table at a time, 20 s apart; moves at a hand boundary) and still
--   restart both clocks, so the next unsolicited start or arrival still waits.
--   A person is never gated, as before.
--
-- THE CHANGE
--
--   fn_cash_hourly_table_admit     the game's own seating skips both clocks;
--                                  a new start counts empty opening feeders
--                                  (not its own table) against the cap, as
--                                  the opener does; clocks only move later.
--   fn_cash_hourly_table_admissions the projection counts the same reserved
--                                  feeders, so the fleet does not try a start
--                                  the database will refuse.
--   fn_cash_hourly_call_admissible  NEW: would the admission seat this player
--                                  if called here now? (only the cap can say
--                                  no to a called horse).
--   fn_offer_open_seat              passes over, for this seat only, a player
--                                  the policy would refuse; the place in line
--                                  is untouched (the wallet check's rule). With
--                                  nobody it can seat it says so
--                                  ('hourly_cap_passes_over').
--   fn_lightning_admission_policy   the throughput cohort counts the new
--                                  predicate as its thirteenth input.
--
-- Unchanged: the hourly ranges, the caps, who is excess, closures, the human
-- expansion, the 3-7 minute fill of a person's table (unsolicited arrivals are
-- still paced), the lapse rule for a call nobody answers, money paths, owners,
-- SECURITY DEFINER, search_path and grants. Nothing reads who is a horse to
-- give anyone a different deal: the hourly policy has always been the horse
-- capacity rule, and a horse it refuses keeps its place exactly as a player
-- whose wallet cannot cover the seat does.
--
-- INSTALL ORDER (safe either way, and safe while the current engine runs)
--
--   Functions only, CREATE OR REPLACE plus one CREATE FUNCTION: no hot-table
--   lock, so no install window. Every signature and result type is unchanged;
--   the serving engine keeps calling fn_cash_hourly_table_admissions and the
--   seat call exactly as before. Installed first, the database immediately
--   lands both bump moves of a feeder start (the executor is database-side)
--   and stops calling a horse to a chair it would refuse; the current engine
--   still skips calls at a table the projection paces, so those calls lapse as
--   today until the engine of the same pull request, which answers every
--   call (the database re-checks every seat), goes live at the next cutover.
--   That engine, served against the old database, would only be refused at
--   the door as now; no money moves on a refusal.
--
-- fn_cash_cluster_tick and fn_cash_cluster_tick_uncapped are NOT touched, so
-- this file is independent of PR #11790 (20261122232612, FOR NO KEY UPDATE on
-- the tick's game row) in either install order.
--
-- Proof: scripts/ci/test-a-called-name-keeps-its-place-postgres.py (every
-- scenario red on the installed bodies, green after this file).
-- Law: server/src/services/aCalledNameKeepsItsPlace.law.test.ts.
-- Changelog: docs/changelog/2026-11-22-a-called-name-keeps-its-place.md.
--
-- Rows written by this file: none.
--
-- @live-proof: (position('THE GAME''S OWN SEATING IS NOT PACED' in pg_get_functiondef('public.fn_cash_hourly_table_admit(uuid,uuid)'::regprocedure)) > 0 AND position('AN OPENING FEEDER HOLDS ITS SLOT' in pg_get_functiondef('public.fn_cash_hourly_table_admissions()'::regprocedure)) > 0 AND to_regprocedure('public.fn_cash_hourly_call_admissible(uuid,uuid)') IS NOT NULL AND position('fn_cash_hourly_call_admissible(p_table_id, v_next.user_id)' in pg_get_functiondef('public.fn_offer_open_seat(uuid,interval,interval)'::regprocedure)) > 0 AND position('fn_cash_hourly_call_admissible(uuid,uuid)' in pg_get_functiondef('public.fn_lightning_admission_policy()'::regprocedure)) > 0)
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Each body below is production's recorded text with marked edits. Any drift
-- in what is installed changes nothing: the whole file aborts.
DO $preimage$
DECLARE f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.fn_cash_hourly_table_admit(uuid,uuid)', 'bca1235b7c8993cfd43a0b94c136d944'),
    ('public.fn_cash_hourly_table_admissions()', '203c0850da8ab1c1a90289a31f607db7'),
    ('public.fn_offer_open_seat(uuid,interval,interval)', 'b8ab9033f6227bcf26c1f64b236830a7'),
    ('public.fn_lightning_admission_policy()', '356b5dcc156803174159eb694b8a309f')
  ) AS e(signature, digest) LOOP
    IF to_regprocedure(f.signature) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(f.signature))) IS DISTINCT FROM f.digest THEN
      RAISE EXCEPTION 'called_name_keeps_place_preimage_changed:% (md5 %)', f.signature,
        md5(pg_get_functiondef(to_regprocedure(f.signature))) USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF to_regprocedure('public.fn_cash_hourly_call_admissible(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'called_name_keeps_place_preimage_changed:fn_cash_hourly_call_admissible exists'
      USING ERRCODE = '55000';
  END IF;
END $preimage$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_admit(p_table_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
DECLARE t public.tables%ROWTYPE; n integer; cap integer; human boolean; empty boolean;
 funded_move boolean; releases_source boolean; neutral_swap boolean; policy_enabled boolean;
 called boolean; own_seating boolean; reserved integer:=0;
 now_at timestamptz:=clock_timestamp(); pace public.cash_hourly_table_starts%ROWTYPE;
BEGIN
 SELECT * INTO t FROM public.tables WHERE id=p_table_id;
 IF NOT FOUND OR t.tournament_id IS NOT NULL OR coalesce(t.is_spins,false) THEN RETURN; END IF;
 policy_enabled:=public.fn_cash_hourly_table_enabled();
 -- A first human seat and boundary close share this lock. Existing stack,
 -- settlement and departure updates bypass this function in the caller.
 SELECT * INTO t FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE;
 IF policy_enabled AND (t.status='closed' OR t.lifecycle='closed') THEN
  RAISE EXCEPTION 'cash_hourly_table_closed' USING ERRCODE='42501'; END IF;
 -- The original atomic swap temporarily clears BOTH old chairs first. Its
 -- reciprocal, ready, unexpired plans prove a headcount-neutral exchange;
 -- never mistake that temporary empty state for a newly started game.
 SELECT coalesce(public.fn_caller_is_engine(),false)
 AND current_setting('app.cash_seat_move',true)='on' AND t.cluster_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.cash_seat_moves m JOIN public.cash_seat_moves partner
 ON partner.id=m.swap_move_id AND partner.swap_move_id=m.id
 WHERE m.player_id=p_user_id AND m.to_table_id=t.id AND m.game_id=t.cluster_id
 AND partner.game_id=m.game_id AND partner.from_table_id=m.to_table_id
 AND partner.to_table_id=m.from_table_id AND partner.player_id<>m.player_id
 AND m.state='pending' AND partner.state='pending'
 AND m.ready_at IS NOT NULL AND partner.ready_at IS NOT NULL
 AND m.expires_at>now_at AND partner.expires_at>now_at) INTO neutral_swap;
 IF neutral_swap THEN RETURN; END IF;
 SELECT NOT EXISTS(SELECT 1 FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL)
 INTO empty;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND is_horse) THEN
  IF empty AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND is_horse IS FALSE) THEN
   INSERT INTO public.cash_hourly_table_origins(table_id,human_started) VALUES(p_table_id,true)
   ON CONFLICT(table_id) DO UPDATE SET human_started=true;
  END IF;
  RETURN;
 END IF;
 IF empty THEN
  INSERT INTO public.cash_hourly_table_origins(table_id,human_started) VALUES(p_table_id,false)
  ON CONFLICT(table_id) DO UPDATE SET human_started=false;
 END IF;
 -- Origin follows actual first seating across cold starts/older rollbacks;
 -- capacity and arrival restrictions still remain inactive for that leader.
 IF NOT policy_enabled THEN RETURN; END IF;
 SELECT EXISTS(SELECT 1 FROM public.table_seats s LEFT JOIN public.profiles p ON p.id=s.user_id
 WHERE s.table_id=p_table_id AND s.left_at IS NULL AND p.is_horse IS DISTINCT FROM true) INTO human;
 -- One-way funded moves into established games keep their ordinary behavior.
 -- An assembling game still admits one arrival per window, whoever funds it.
 -- The original one-way executor inserts before releasing its source chair.
 SELECT coalesce(public.fn_caller_is_engine(),false)
 AND current_setting('app.cash_seat_move',true)='on' AND t.cluster_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.table_seats s JOIN public.tables src ON src.id=s.table_id
 WHERE s.user_id=p_user_id AND s.left_at IS NULL AND src.id<>t.id
 AND src.cluster_id=t.cluster_id AND src.tournament_id IS NULL AND NOT coalesce(src.is_spins,false))
 INTO funded_move;
 IF funded_move AND NOT empty
 AND NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_starts WHERE table_id=t.id)
 AND EXISTS(SELECT 1 FROM public.table_seats s JOIN public.profiles p ON p.id=s.user_id
 WHERE s.table_id=t.id AND s.left_at IS NULL AND p.is_horse) THEN RETURN; END IF;
 SELECT coalesce(funded_move,false) AND EXISTS(
 SELECT 1 FROM public.table_seats s JOIN public.tables src ON src.id=s.table_id
 WHERE s.user_id=p_user_id AND s.left_at IS NULL AND src.id<>t.id AND src.cluster_id=t.cluster_id
 AND NOT EXISTS(SELECT 1 FROM public.table_seats other WHERE other.table_id=src.id
 AND other.left_at IS NULL AND other.id<>s.id)) INTO releases_source;
 -- THE GAME'S OWN SEATING IS NOT PACED (20261123013241). A name the list called
 -- to THIS table (a live hold fn_offer_open_seat wrote) and a sanctioned move
 -- inside the game (must-move, a feeder start's bump, a break) are the game's
 -- own seating, already spaced by the game itself: one name per table at a
 -- time, a move at a hand boundary. The 2-4 minute arrival and start clocks
 -- space the fleet's own unsolicited purchases; refusing a called name lapsed
 -- its sixty-second hold and took it off the list, and refusing a bump
 -- abandoned the feeder. The table cap still applies to both.
 SELECT EXISTS(SELECT 1 FROM public.table_waitlist h WHERE h.table_id=p_table_id AND h.user_id=p_user_id
 AND h.status='notified' AND coalesce(h.hold_expires_at,h.notified_at+interval '60 seconds')>now_at) INTO called;
 own_seating:=coalesce(funded_move,false) OR called;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('cash_hourly_table_capacity',0)) THEN
  RAISE EXCEPTION 'cash_hourly_table_capacity_busy' USING ERRCODE='55P03'; END IF;
 IF NOT human THEN
  SELECT table_cap INTO STRICT cap FROM public.fn_cash_hourly_table_range();
  SELECT count(*) INTO n FROM public.fn_cash_hourly_table_capacity_census();
  -- AN OPENING FEEDER HOLDS ITS SLOT (20261123013241). The opener admitted it on
  -- the census plus every empty opening feeder (fn_cash_hourly_feeder_admissible);
  -- a new start counts the same reservations, other than its own table, so an
  -- unrelated start cannot take the slot before the feeder's first player sits.
  IF empty THEN
   SELECT count(*) INTO reserved FROM public.tables tb
    WHERE tb.cluster_id IS NOT NULL AND tb.role='feeder' AND tb.lifecycle='opening'
      AND tb.status IN('waiting','running','active') AND NOT coalesce(tb.is_deleted,false)
      AND tb.tournament_id IS NULL AND NOT coalesce(tb.is_spins,false)
      AND NOT EXISTS(SELECT 1 FROM public.table_seats ts WHERE ts.table_id=tb.id AND ts.left_at IS NULL)
      AND tb.id<>p_table_id;
  END IF;
  IF (empty AND n+reserved-CASE WHEN releases_source THEN 1 ELSE 0 END>=cap) OR (NOT empty AND public.fn_cash_hourly_table_excess(p_table_id)) THEN
   RAISE EXCEPTION 'cash_hourly_table_cap_reached:%',cap USING ERRCODE='42501'; END IF;
  IF empty THEN
   -- A feeder the opener admitted starts with its first called name or bump;
   -- that start still restarts the floor clock for every other start.
   IF NOT (own_seating AND t.cluster_id IS NOT NULL AND t.role='feeder')
      AND EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing WHERE scope='floor' AND next_open_at>now_at) THEN
    RAISE EXCEPTION 'cash_hourly_table_start_paced' USING ERRCODE='42501'; END IF;
   UPDATE public.cash_hourly_table_pacing SET next_open_at=greatest(next_open_at,now_at+public.fn_cash_hourly_table_delay(p_table_id))
    WHERE scope='floor';
  END IF;
 END IF;
 -- Every NEW game builds its Horse seats individually over 2-4 minute gaps.
 -- A human who starts an empty table grants only THAT table the cap exception.
 -- Once established, ordinary replenishment keeps its existing behavior.
 IF empty OR NOT EXISTS(SELECT 1 FROM public.table_seats s JOIN public.profiles p ON p.id=s.user_id
                        WHERE s.table_id=p_table_id AND s.left_at IS NULL AND p.is_horse) THEN
  INSERT INTO public.cash_hourly_table_starts(table_id,started_at,next_horse_at)
  VALUES(p_table_id,now_at,'-infinity') ON CONFLICT(table_id) DO NOTHING;
 END IF;
 SELECT * INTO pace FROM public.cash_hourly_table_starts WHERE table_id=p_table_id;
 IF FOUND THEN
  IF pace.next_horse_at>now_at AND NOT own_seating THEN
   RAISE EXCEPTION 'cash_hourly_horse_arrival_paced' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL)+1>=t.max_players THEN
   DELETE FROM public.cash_hourly_table_starts WHERE table_id=p_table_id;
  ELSE
   UPDATE public.cash_hourly_table_starts SET next_horse_at=greatest(next_horse_at,now_at+public.fn_cash_hourly_table_delay(p_table_id))
    WHERE table_id=p_table_id;
  END IF;
 END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_admissions()
RETURNS TABLE(table_id uuid,allowed boolean,max_horses integer,starts_game boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_census()),
 counted AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_capacity_census()),
 -- AN OPENING FEEDER HOLDS ITS SLOT (20261123013241), as the admission counts it.
 opening AS MATERIALIZED(SELECT tb.id FROM public.tables tb
    WHERE tb.cluster_id IS NOT NULL AND tb.role='feeder' AND tb.lifecycle='opening'
      AND tb.status IN('waiting','running','active') AND NOT coalesce(tb.is_deleted,false)
      AND tb.tournament_id IS NULL AND NOT coalesce(tb.is_spins,false)
      AND NOT EXISTS(SELECT 1 FROM public.table_seats ts WHERE ts.table_id=tb.id AND ts.left_at IS NULL)),
 budget AS(SELECT table_cap cap,(SELECT count(*) FROM counted) occupied,(SELECT count(*) FROM opening) reserved,
 greatest(0,table_cap-(SELECT count(*) FROM counted WHERE humans>0)) retained
 FROM public.fn_cash_hourly_table_range()),
 ranked AS(SELECT table_id,row_number() OVER(ORDER BY opened_at NULLS LAST,table_id) n FROM floor WHERE humans=0)
 SELECT t.id,
 (NOT public.fn_cash_hourly_table_enabled() OR ((coalesce(f.humans,0)>0 OR CASE WHEN f.table_id IS NULL
  THEN b.occupied+b.reserved-CASE WHEN EXISTS(SELECT 1 FROM opening o WHERE o.id=t.id) THEN 1 ELSE 0 END<b.cap
  ELSE coalesce(r.n,0)<=b.retained END)
 AND (f.table_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing
  WHERE scope='floor' AND next_open_at>clock_timestamp()))
 AND (p.table_id IS NULL OR p.next_horse_at<=clock_timestamp()))),
 CASE WHEN p.table_id IS NOT NULL OR f.table_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.table_seats s JOIN public.profiles hp ON hp.id=s.user_id
  WHERE s.table_id=t.id AND s.left_at IS NULL AND hp.is_horse) THEN 1 ELSE t.max_players END,
 f.table_id IS NULL
 FROM public.tables t CROSS JOIN budget b LEFT JOIN floor f ON f.table_id=t.id
 LEFT JOIN ranked r ON r.table_id=t.id LEFT JOIN public.cash_hourly_table_starts p ON p.table_id=t.id
 WHERE t.tournament_id IS NULL AND NOT coalesce(t.is_spins,false)
 AND NOT coalesce(t.is_template,false) AND NOT coalesce(t.is_deleted,false)
 AND t.status IN('waiting','running') AND coalesce(t.lifecycle,'') NOT IN('closed','breaking');
$fn$;

CREATE FUNCTION public.fn_cash_hourly_call_admissible(p_table_id uuid,p_user_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 -- WOULD THE ADMISSION SEAT THIS PLAYER IF THE LIST CALLED THEM HERE NOW?
 -- fn_cash_hourly_table_admit's own branches, in its order, for a called name:
 -- no clock refuses one (THE GAME'S OWN SEATING IS NOT PACED), so only the
 -- table cap can. fn_offer_open_seat asks this before it holds a chair, and
 -- the native proof holds the two to the same answer at every kind of table.
 WITH t AS (SELECT * FROM public.tables WHERE id=p_table_id)
 SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM t) THEN true
  WHEN (SELECT tournament_id IS NOT NULL OR coalesce(is_spins,false) FROM t) THEN true
  WHEN NOT public.fn_cash_hourly_table_enabled() THEN true
  WHEN (SELECT status='closed' OR lifecycle='closed' FROM t) THEN false
  WHEN NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND is_horse) THEN true
  WHEN EXISTS(SELECT 1 FROM public.table_seats s LEFT JOIN public.profiles p ON p.id=s.user_id
   WHERE s.table_id=p_table_id AND s.left_at IS NULL AND p.is_horse IS DISTINCT FROM true) THEN true
  WHEN EXISTS(SELECT 1 FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL)
   THEN NOT public.fn_cash_hourly_table_excess(p_table_id)
  ELSE (SELECT count(*) FROM public.fn_cash_hourly_table_capacity_census())
     + (SELECT count(*) FROM public.tables tb
    WHERE tb.cluster_id IS NOT NULL AND tb.role='feeder' AND tb.lifecycle='opening'
      AND tb.status IN('waiting','running','active') AND NOT coalesce(tb.is_deleted,false)
      AND tb.tournament_id IS NULL AND NOT coalesce(tb.is_spins,false)
      AND NOT EXISTS(SELECT 1 FROM public.table_seats ts WHERE ts.table_id=tb.id AND ts.left_at IS NULL)
      AND tb.id<>p_table_id)
     < (SELECT r.table_cap FROM public.fn_cash_hourly_table_range() r)
   AND ((SELECT cluster_id IS NOT NULL AND role='feeder' FROM t)
        OR NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing WHERE scope='floor' AND next_open_at>clock_timestamp()))
 END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_offer_open_seat(p_table_id uuid, p_offer_ttl interval DEFAULT '00:01:00'::interval, p_entry_ttl interval DEFAULT '24:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tbl      record;
  v_next     record;
  v_notif_id uuid;
  v_expired  int := 0;
  v_cap      int := 1;
  v_selected boolean := false;
  v_game_id uuid;
  v_table_entry_id uuid;
  v_legacy_holds integer := 0;
  v_sweep_game uuid;
  v_sweep record;
  v_passed_over int := 0;
BEGIN
  -- Share the actual seat admission key with cash-game joins and buy-ins.
  -- A busy table is left untouched; a caller may already hold sweep rows,
  -- so waiting for another claimant here can invert that caller's locks.
  IF p_table_id IS NOT NULL AND NOT pg_try_advisory_xact_lock(
       hashtextextended('table_seat:' || p_table_id::text, 0)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_claim_busy');
  END IF;

  SELECT COALESCE(max_concurrent_holds, 1) INTO v_cap FROM public.waitlist_policy WHERE id;
  IF v_cap IS NULL THEN v_cap := 1; END IF;

  SELECT t.id, t.name, t.tournament_id, t.max_players, t.current_players
    INTO v_tbl
    FROM public.tables t
   WHERE t.id = p_table_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_not_found');
  END IF;

  IF v_tbl.tournament_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_table');
  END IF;

  -- The cached lobby count cannot authorize an exclusive chair offer.
  v_tbl.current_players := (SELECT count(*) FROM public.table_seats s
                            WHERE s.table_id=p_table_id AND s.left_at IS NULL);
  IF v_tbl.current_players >= COALESCE(v_tbl.max_players, 9) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_full');
  END IF;

  WITH dead AS (
    UPDATE public.table_waitlist
       SET status = 'expired'
     WHERE table_id = p_table_id
       AND status = 'notified'
       AND COALESCE(hold_expires_at, notified_at + p_offer_ttl) < now()
    RETURNING user_id
  )
  -- A lapsed hold is not a notification (Dan 2026-10-14).
  SELECT count(*) INTO v_expired FROM dead;

  -- A LAPSED GAME OFFER IS NO PLACE IN LINE (2026-10-23). A game list row
  -- moves waiting -> notified when this pass hands its player a chair. Once
  -- that chair is taken the row is 'seated'; once every hold of theirs in
  -- this game has lapsed and they sit nowhere in it, the row is 'expired',
  -- by the same TTL that just expired the table holds above. Left 'notified',
  -- the player could never be offered a seat in this game again and Join Game
  -- answered 'waitlisted' forever. Players genuinely waiting are untouched.
  -- Each row is claimed nonblocking, as the game queue below claims its
  -- candidates, so this pass never waits while it owns the table key.
  SELECT t.cluster_id INTO v_sweep_game FROM public.tables t WHERE t.id = p_table_id;
  IF v_sweep_game IS NOT NULL THEN
    FOR v_sweep IN
      SELECT w.id, w.user_id FROM public.cash_game_waitlist w
       WHERE w.game_id = v_sweep_game AND w.status = 'notified'
       ORDER BY w.created_at, w.id
    LOOP
      CONTINUE WHEN NOT pg_try_advisory_xact_lock(
        hashtextextended('waitlist_offer_user:' || v_sweep.user_id::text, 0));
      PERFORM 1 FROM public.cash_game_waitlist w
       WHERE w.id = v_sweep.id AND w.status = 'notified' FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
      UPDATE public.cash_game_waitlist w SET status = 'seated', updated_at = now()
       WHERE w.id = v_sweep.id AND w.status = 'notified'
         AND EXISTS (SELECT 1 FROM public.table_seats s JOIN public.tables t ON t.id = s.table_id
                      WHERE s.user_id = w.user_id AND s.left_at IS NULL
                        AND t.cluster_id = v_sweep_game AND t.lifecycle <> 'closed');
      CONTINUE WHEN FOUND;
      UPDATE public.cash_game_waitlist w SET status = 'expired', updated_at = now()
       WHERE w.id = v_sweep.id AND w.status = 'notified'
         AND NOT EXISTS (SELECT 1 FROM public.table_waitlist h JOIN public.tables t ON t.id = h.table_id
                          WHERE h.user_id = w.user_id AND h.status = 'notified'
                            AND COALESCE(h.hold_expires_at, h.notified_at + p_offer_ttl) > now()
                            AND t.cluster_id = v_sweep_game AND NOT COALESCE(t.is_deleted, false)
                            AND t.lifecycle <> 'closed');
    END LOOP;
  END IF;

  UPDATE public.table_waitlist
     SET status = 'expired'
   WHERE table_id = p_table_id
     AND status = 'waiting'
     AND created_at < now() - p_entry_ttl;

  UPDATE public.table_waitlist w
     SET status = 'seated'
   WHERE w.table_id = p_table_id
     AND w.status = 'waiting'
     AND EXISTS (
       SELECT 1 FROM public.table_seats s
        WHERE s.table_id = p_table_id
          AND s.left_at IS NULL
          AND s.user_id = w.user_id
     );

  -- This same reader also reserves pending non-swap seat moves. Re-read it
  -- after expiry and under the common table key, just like the join door.
  -- Pre-column offers retain their original notified_at + TTL reservation.
  -- The shared reader counts explicit hold_expires_at values only.
  SELECT count(*) INTO v_legacy_holds FROM public.table_waitlist h
   WHERE h.table_id=p_table_id AND h.status='notified'
     AND h.hold_expires_at IS NULL AND h.notified_at+p_offer_ttl>now();
  IF COALESCE(public.fn_cash_game_open_seats(p_table_id),0) <= v_legacy_holds THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'open_seats_already_held', 'offers_expired', v_expired
    );
  END IF;

  -- THE HEAD OF THE QUEUE, LOCKED, AND NOT ALREADY HOLDING A SEAT ELSEWHERE.
  -- A hold is exclusive, so handing one player several at once takes seats
  -- away from everybody behind them. Skipping a capped player leaves their
  -- place in line untouched: they are passed over for THIS seat only.
  --
  -- 2026-08-31 (Dan, binding: horses are never skipped): the is_horse
  -- exclusion that used to sit in this predicate is GONE. Whoever is first in
  -- line is offered the seat. The JOIN to profiles stays: it is no longer read
  -- to exclude anyone, but dropping it would newly qualify waitlist rows whose
  -- user has no profile row at all.
  FOR v_next IN
  SELECT w.id, w.user_id, COALESCE(p.is_horse, false) AS is_horse
    FROM public.table_waitlist w
    JOIN public.profiles p ON p.id = w.user_id
   WHERE w.table_id = p_table_id
     AND w.status = 'waiting'
     AND (
       v_cap = 0
       OR (
         SELECT count(*) FROM public.table_waitlist h
          WHERE h.user_id = w.user_id
            AND h.status = 'notified'
            AND COALESCE(h.hold_expires_at, h.notified_at + p_offer_ttl) > now()
       ) < v_cap
     )
   ORDER BY w.created_at, w.id
     FOR UPDATE OF w SKIP LOCKED
  LOOP
    -- Queue-row locks on different tables do not serialize this player's
    -- offer allowance. A nonblocking claim preserves other queue members'
    -- progress without waiting while this transaction owns a table key.
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(
      hashtextextended('waitlist_offer_user:' || v_next.user_id::text, 0));
    CONTINUE WHEN v_cap > 0 AND (
      SELECT count(*) FROM public.table_waitlist h
       WHERE h.user_id=v_next.user_id AND h.status='notified'
         AND COALESCE(h.hold_expires_at,h.notified_at+p_offer_ttl)>now()
    ) >= v_cap;
    -- NO CHAIR IS HELD FOR A PLAYER WHO CANNOT PAY FOR IT (Dan 2026-10-12).
    -- A player in line whose wallets cannot cover this table's minimum is
    -- passed over for THIS seat and keeps their place, exactly as a capped
    -- player is above; the same rule for every player in line (10.5).
    CONTINUE WHEN NOT public.fn_ca_cash_wallet_covers(
      v_next.user_id, p_table_id, NULL,
      public.fn_ca_cash_entry_need(v_next.user_id, p_table_id));
    -- A CALLED NAME KEEPS ITS PLACE (20261123013241). A seat is called only to a
    -- player the hourly cash policy will seat in it now (a table it is closing,
    -- or a start the floor's cap cannot hold, is refused to a horse and never to
    -- a person). The same rule as the wallet check above: passed over for THIS
    -- seat only, the place in line untouched. A call that cannot be taken lapsed
    -- in sixty seconds and took the name off the list.
    IF NOT public.fn_cash_hourly_call_admissible(p_table_id, v_next.user_id) THEN
      v_passed_over := v_passed_over + 1;
      CONTINUE;
    END IF;
    v_selected := true;
    EXIT;
  END LOOP;


  -- A game queue is admitted by this same vacancy event, not by another
  -- Join Game click or a repair worker. Table-specific FIFO keeps its priority.
  IF NOT v_selected THEN
    SELECT g.id INTO v_game_id
      FROM public.tables t JOIN public.cash_games g ON g.id=t.cluster_id
     WHERE t.id=p_table_id AND g.enabled
       AND t.lifecycle IN ('live','opening') AND t.status IN ('waiting','running','active')
       AND NOT coalesce(t.is_deleted,false);
    IF v_game_id IS NOT NULL THEN
      UPDATE public.cash_game_waitlist SET status='expired',updated_at=now()
       WHERE game_id=v_game_id AND status='waiting' AND created_at<=now()-p_entry_ttl;
      FOR v_next IN
        SELECT w.id,w.user_id,coalesce(p.is_horse,false) AS is_horse
          FROM public.cash_game_waitlist w JOIN public.profiles p ON p.id=w.user_id
         WHERE w.game_id=v_game_id AND w.status='waiting'
           AND w.created_at > now()-p_entry_ttl
         ORDER BY w.created_at,w.id
      LOOP
        -- Lock one candidate at a time. A cursor that locks the entire list
        -- would hide later eligible buyers from a simultaneous vacancy.
        PERFORM 1 FROM public.cash_game_waitlist w
         WHERE w.id=v_next.id AND w.status='waiting' FOR UPDATE SKIP LOCKED;
        CONTINUE WHEN NOT FOUND;
        CONTINUE WHEN NOT pg_try_advisory_xact_lock(
          hashtextextended('waitlist_offer_user:' || v_next.user_id::text,0));
        CONTINUE WHEN EXISTS(
          SELECT 1 FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id
           WHERE s.user_id=v_next.user_id AND s.left_at IS NULL AND t.cluster_id=v_game_id);
        CONTINUE WHEN EXISTS(
          SELECT 1 FROM public.table_waitlist h JOIN public.tables t ON t.id=h.table_id
           WHERE h.user_id=v_next.user_id AND h.status='notified'
             AND coalesce(h.hold_expires_at,h.notified_at+p_offer_ttl)>now()
             AND t.cluster_id=v_game_id);
        CONTINUE WHEN v_cap>0 AND (
          SELECT count(*) FROM public.table_waitlist h
           WHERE h.user_id=v_next.user_id AND h.status='notified'
             AND coalesce(h.hold_expires_at,h.notified_at+p_offer_ttl)>now())>=v_cap;
        CONTINUE WHEN public.fn_cash_game_barred_seconds(v_game_id,v_next.user_id) IS NOT NULL;
        CONTINUE WHEN EXISTS(
          SELECT 1 FROM public.cash_games g WHERE g.id=v_game_id
            AND (coalesce((g.ruleset_snapshot #>> '{options,is_private}')::boolean,false)
                 OR EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=g.club_id AND c.is_public=false))
            AND NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=g.club_id AND c.owner_id=v_next.user_id)
            AND NOT EXISTS(SELECT 1 FROM public.club_members m WHERE m.club_id=g.club_id
                 AND m.user_id=v_next.user_id AND m.status IN ('active','approved')));
        CONTINUE WHEN NOT public.fn_ca_cash_wallet_covers(
          v_next.user_id,p_table_id,NULL,public.fn_ca_cash_entry_need(v_next.user_id,p_table_id));
        -- A CALLED NAME KEEPS ITS PLACE (20261123013241): see the table list above.
        IF NOT public.fn_cash_hourly_call_admissible(p_table_id, v_next.user_id) THEN
          v_passed_over := v_passed_over + 1;
          CONTINUE;
        END IF;
        UPDATE public.cash_game_waitlist SET status='notified',updated_at=now()
         WHERE id=v_next.id AND status='waiting';
        INSERT INTO public.table_waitlist(table_id,user_id,position,status)
          VALUES(p_table_id,v_next.user_id,0,'waiting')
          ON CONFLICT (table_id,user_id) WHERE status IN ('waiting','notified')
          DO UPDATE SET status='waiting'
          RETURNING id INTO v_table_entry_id;
        v_next.id := v_table_entry_id;
        v_selected := true;
        EXIT;
      END LOOP;
    END IF;
  END IF;

  IF NOT v_selected THEN
    RETURN jsonb_build_object(
      'ok', false,
      -- Waiting players the hourly policy cannot seat here keep their places;
      -- the answer says so instead of claiming nobody is waiting.
      'reason', CASE WHEN v_passed_over > 0 THEN 'hourly_cap_passes_over' ELSE 'nobody_waiting' END,
      'passed_over', v_passed_over, 'offers_expired', v_expired
    );
  END IF;

  UPDATE public.table_waitlist
     SET status = 'notified',
         notified_at = now(),
         hold_expires_at = now() + p_offer_ttl
   WHERE id = v_next.id;

  -- The notification row is written for every player alike, so the queue's
  -- audit trail is identical. Only the PUSH flag differs: a horse has no
  -- device to push to, which is the sanctioned identification-for-display use,
  -- and it reuses the `_push:skip` marker the expiry notification above
  -- already uses. It decides how a message is delivered, never whether a seat
  -- is offered.
  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES (
    v_next.user_id,
    'waitlist_seat_open',
    'Seat Open',
    'A Seat Just Opened At ' || COALESCE(v_tbl.name, 'Your Waitlisted Table') ||
      '. It Is Held For You For 60 Seconds. Sit Down Now To Claim It.',
    CASE WHEN v_next.is_horse
         THEN jsonb_build_object('table_id', p_table_id, '_push', 'skip')
         ELSE jsonb_build_object('table_id', p_table_id)
    END
  )
  RETURNING id INTO v_notif_id;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_next.user_id,
    'table_name', v_tbl.name,
    'notification_id', v_notif_id,
    'hold_expires_in_seconds', EXTRACT(epoch FROM p_offer_ttl)::int,
    'offers_expired', v_expired
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_lightning_admission_policy()
RETURNS TABLE(fingerprint bigint, hourly_contract text, hourly_fingerprint bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '5s'
AS $function$
 WITH definitions AS (
  SELECT signature,pg_get_functiondef(to_regprocedure(signature)) AS definition
  FROM (VALUES
   ('public.fn_cash_hourly_table_range(timestamp with time zone)'),
   ('public.fn_cash_hourly_table_census()'),
   ('public.fn_cash_hourly_table_capacity_census()'),
   ('public.fn_cash_hourly_table_excess(uuid)'),
   ('public.fn_cash_hourly_table_enabled()'),
   ('public.fn_cash_hourly_table_delay(uuid)'),
   ('public.fn_cash_hourly_table_drain_candidate()'),
   ('public.fn_cash_hourly_table_admit(uuid,uuid)'),
   ('public.fn_cash_hourly_table_admissions()'),
   ('public.fn_cash_hourly_call_admissible(uuid,uuid)'),
   ('public.fn_cash_hourly_table_close(uuid,uuid,text,uuid)'),
   ('public.fn_ca_horse_roster_seat_guard()'),
   ('public.fn_lightning_player_legality(uuid,timestamp with time zone,uuid[],jsonb)')
  ) AS inputs(signature)
 )
 SELECT ('x'||left(md5(pg_get_functiondef(to_regprocedure(
   'public.fn_lightning_horse_admit_paced(uuid,uuid,timestamp with time zone)'))),13))::bit(52)::bigint,
  'cash-hourly-tables/v1'::text,
  CASE WHEN count(definition)=13 THEN
   ('x'||left(md5(string_agg(signature||':'||definition,'|' ORDER BY signature)),13))::bit(52)::bigint
  END
 FROM definitions;
$function$;

REVOKE ALL ON FUNCTION public.fn_cash_hourly_call_admissible(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_call_admissible(uuid,uuid) TO service_role;
-- Restated with every replaced body (the engine is their only caller, as
-- service_role): CREATE OR REPLACE keeps the installed ACL, and saying it
-- here keeps the file honest about it.
REVOKE ALL ON FUNCTION public.fn_cash_hourly_table_admissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_table_admissions() TO service_role;
REVOKE ALL ON FUNCTION public.fn_lightning_admission_policy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_admission_policy() TO service_role;
REVOKE ALL ON FUNCTION public.fn_cash_hourly_table_admit(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_table_admit(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_offer_open_seat(uuid,interval,interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_offer_open_seat(uuid,interval,interval) TO service_role;

-- Read back what was installed, or abort the whole file.
DO $readback$
BEGIN
  IF position('THE GAME''S OWN SEATING IS NOT PACED' IN pg_get_functiondef('public.fn_cash_hourly_table_admit(uuid,uuid)'::regprocedure)) = 0
     OR position('AN OPENING FEEDER HOLDS ITS SLOT' IN pg_get_functiondef('public.fn_cash_hourly_table_admissions()'::regprocedure)) = 0
     OR (length(pg_get_functiondef('public.fn_offer_open_seat(uuid,interval,interval)'::regprocedure))
         - length(replace(pg_get_functiondef('public.fn_offer_open_seat(uuid,interval,interval)'::regprocedure),
                          'fn_cash_hourly_call_admissible(p_table_id, v_next.user_id)', '')))
        / length('fn_cash_hourly_call_admissible(p_table_id, v_next.user_id)') <> 2
     OR position('count(definition)=13' IN pg_get_functiondef('public.fn_lightning_admission_policy()'::regprocedure)) = 0
     OR (SELECT hourly_fingerprint FROM public.fn_lightning_admission_policy()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.fn_cash_hourly_call_admissible(uuid,uuid)'::regprocedure
                     AND p.prosecdef AND pg_get_userbyid(p.proowner) = current_user)
     OR has_function_privilege('authenticated', 'public.fn_cash_hourly_call_admissible(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_cash_hourly_call_admissible(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'called_name_keeps_place_did_not_install' USING ERRCODE = '55000';
  END IF;
END $readback$;

COMMIT;
