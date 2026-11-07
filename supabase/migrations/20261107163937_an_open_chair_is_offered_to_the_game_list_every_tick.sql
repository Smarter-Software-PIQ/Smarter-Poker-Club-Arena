-- 20261107163937_an_open_chair_is_offered_to_the_game_list_every_tick.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A seat on a game's waiting list (cash_game_waitlist) was only ever offered
-- when somebody LEFT a table: atomicCashout -> notifyWaitlistSeatOpen ->
-- fn_offer_open_seat. A chair that is already open - a second table the tick
-- just opened, a short table, a game that emptied - is never "vacated", so
-- nothing offered it, and the person on the list waited until their entry
-- aged out at 24 hours. Measured 2026-11-07 16:40 UTC, right after the engine
-- with horse waiting lines went live: 3Putt on NLH 0.10/0.25 Classic's list
-- since 22:50 the night before while its feeder sat at 2/9; Rubdznuts on
-- PLO4 0.50/1 Classic's list since 19:39 with the whole game at 0/6; Rooster on
-- two lists since 05:05 and 05:20. The lobby then printed "Waitlist 1" beside
-- open chairs (owner request 2026-11-07: "IT LOOKS FAKE"), and a person who
-- was actually waiting was never called.
--
-- The fix is one step in fn_cash_cluster_tick, before OPEN: when the game has a
-- 'waiting' row and a live table has an open unreserved chair, offer that chair
-- through the platform's own fn_offer_open_seat - the same door a cash-out
-- uses. It holds the chair for the FIFO head for its usual 60 seconds, claims
-- every row nonblocking, refuses a full or tournament table, and expires a
-- lapsed hold; a horse at the head answers it through claimOfferedSeats exactly
-- as a person does (CLAUDE.md 10.5). Each call is its own subtransaction, so an
-- offer that refuses can never fail the tick. Nothing else in the tick changes.
--
-- @live-proof: (position('AN OPEN CHAIR IS OFFERED TO THE LIST' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0)
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
 IF md5(original) <> 'bbcfba04b5140c008ec6082a43377e3c' THEN
   RAISE EXCEPTION 'open_chair_offer_preimage_changed' USING ERRCODE = '55000';
 END IF;
 patched := replace(original,
   $anchor$  -- ── 3. OPEN (18.3)$anchor$,
   $insert$  -- AN OPEN CHAIR IS OFFERED TO THE LIST (2026-11-07). A chair that is
  -- already open was never offered: only a cash-out called fn_offer_open_seat.
  -- Every tick now offers each live table's open unreserved chairs to the
  -- game's waiting list through that same door (60 s hold, FIFO, nonblocking).
  IF EXISTS (SELECT 1 FROM public.cash_game_waitlist w
              WHERE w.game_id = g.id AND w.status = 'waiting') THEN
    FOR t IN SELECT * FROM unnest(v_census) c
              WHERE c.lifecycle IN ('live', 'opening') AND NOT c.breaking AND c.open_unreserved > 0
    LOOP
      BEGIN
        PERFORM public.fn_offer_open_seat(t.id);
      EXCEPTION WHEN OTHERS THEN
        NULL; -- an offer that refuses never fails the tick
      END;
    END LOOP;
  END IF;

  -- ── 3. OPEN (18.3)$insert$);
 IF patched = original THEN RAISE EXCEPTION 'open step anchor absent'; END IF;
 IF position('fn_cash_game_never_moves_players(' IN patched) = 0 THEN
   RAISE EXCEPTION 'cash cluster tick must keep reading the one must-move definition';
 END IF;
 EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;

COMMIT;
