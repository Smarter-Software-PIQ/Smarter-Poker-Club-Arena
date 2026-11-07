-- 20261107195847_a_new_table_fills_from_its_list_one_name_at_a_time_and_an_un.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (owner 2026-11-07: "GO AHEAD AND FULLY BUILD, FIX
-- AND ENHANCE ALL OF THESE"). Two steps of fn_cash_cluster_tick, nothing else.
--
-- 1. A NEW TABLE FILLS FROM THE LIST ONE NAME AT A TIME. The open-chair offer
--    step (20261107163937) called fn_offer_open_seat for every table with an
--    open chair on every 5-second tick, so a new second table could have
--    several names called inside a few seconds and the players arrived at
--    once. A card room calls one name, waits for that player to sit, then
--    calls the next. The step now skips a table that still has a live hold
--    (a called name that has not sat yet, 60 s at most) or that took a new
--    player in the last 20 seconds. Order is unchanged: fn_offer_open_seat
--    still calls the head of the list (FIFO), people and horses alike, with
--    the same 'Seat Open' notification. A cash-out still offers its chair at
--    once through notifyWaitlistSeatOpen; only this tick step is spaced.
--
-- 2. AN UNPICKED SECOND TABLE IS BROKEN, NOT DRAINED. A game's second table
--    is allowed only while fn_cash_game_second_table_picked says so (it moves
--    with the Chicago hour). When it stopped being picked nothing in the tick
--    reacted: BREAK only fires when everyone fits on the remaining tables, so
--    the horses' cash plan stood every horse at that table up at once and the
--    table looked like everybody quit together. Now a game with more live
--    tables than its cap (v_table_cap, which already carries the pick) breaks
--    its newest table through the ordinary BREAK path - same candidate order,
--    never Main 1, never Classic-under-players, same two-orbit / five-minute
--    window, same 'table_break_started' event and the same 'break' moves
--    ("This Table Is Closing. Moving To Main 1 After This Hand."), planned in
--    roster order onto open chairs. Anyone without a chair stays dealt in at
--    the closing table and is first for every chair that opens (must-move
--    draws the breaking table first, ahead of the list's offer step). A
--    forced break move keeps the player's stack; it is not a voluntary leave.
--    It only arms when every PERSON in the game fits on the remaining tables,
--    so a break never leaves a person waiting at a closing table; horses
--    that do not fit wait there for a chair like anyone else.
--
-- The engine mirrors neither step (the engine's secondTablePicked twin is
-- unchanged), so this installs on merge.
--
-- @live-proof: (position('ONE NAME AT A TIME' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0 AND position('AN UNPICKED SECOND TABLE IS BROKEN' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0)
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE original text; patched text; step text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
 IF md5(original) <> '43e5133f4fd48ec81878843301f243fa' THEN
   RAISE EXCEPTION 'list_order_and_table_break_preimage_changed' USING ERRCODE = '55000';
 END IF;
 patched := original;

 -- variables
 step := replace(patched,
   $a$  v_window interval;
BEGIN$a$,
   $b$  v_window interval;
  v_over_cap boolean := false;
  v_people integer := 0;
BEGIN$b$);
 IF step = patched THEN RAISE EXCEPTION 'declare anchor absent'; END IF;
 patched := step;

 -- 1. one name at a time
 step := replace(patched,
   $a$    FOR t IN SELECT * FROM unnest(v_census) c
              WHERE c.lifecycle IN ('live', 'opening') AND NOT c.breaking AND c.open_unreserved > 0
    LOOP
      BEGIN
        PERFORM public.fn_offer_open_seat(t.id);$a$,
   $b$    -- ONE NAME AT A TIME (2026-11-07): a table whose called name has not
    -- sat yet (a live hold), or that took a player in the last 20 seconds,
    -- is not called again this tick. The list still goes in its own order.
    FOR t IN SELECT * FROM unnest(v_census) c
              WHERE c.lifecycle IN ('live', 'opening') AND NOT c.breaking AND c.open_unreserved > 0
                AND NOT EXISTS (SELECT 1 FROM public.table_waitlist h
                                 WHERE h.table_id = c.id AND h.status = 'notified'
                                   AND coalesce(h.hold_expires_at, h.notified_at + interval '60 seconds') > v_now)
                AND NOT EXISTS (SELECT 1 FROM public.table_seats ts
                                 WHERE ts.table_id = c.id AND ts.left_at IS NULL
                                   AND ts.joined_at > v_now - interval '20 seconds')
    LOOP
      BEGIN
        PERFORM public.fn_offer_open_seat(t.id);$b$);
 IF step = patched THEN RAISE EXCEPTION 'offer step anchor absent'; END IF;
 patched := step;

 -- 2. an unpicked second table is broken
 step := replace(patched,
   $a$    IF v_remaining_tables >= 1
       AND v_seated_total < v_remaining_capacity THEN$a$,
   $b$    -- AN UNPICKED SECOND TABLE IS BROKEN, NOT DRAINED (2026-11-07). A game
    -- holding more live tables than its cap (v_table_cap carries
    -- fn_cash_game_second_table_picked) breaks its newest table through this
    -- same path, once every PERSON in the game fits on the rest. Players
    -- without a chair stay dealt in at the closing table and are first for
    -- every chair that opens (must-move reads the breaking table first).
    v_over_cap := (SELECT count(*) FROM unnest(v_census) c
                    WHERE c.lifecycle IN ('live', 'opening') AND NOT c.breaking) > v_table_cap;
    SELECT count(*) INTO v_people
      FROM public.table_seats ts
      JOIN unnest(v_census) c ON c.id = ts.table_id
      JOIN public.profiles p ON p.id = ts.user_id
     WHERE ts.left_at IS NULL AND NOT coalesce(p.is_horse, false);
    IF v_remaining_tables >= 1
       AND (v_seated_total < v_remaining_capacity
            OR (v_over_cap AND v_people < v_remaining_capacity)) THEN$b$);
 IF step = patched THEN RAISE EXCEPTION 'break fit anchor absent'; END IF;
 patched := step;

 step := replace(patched,
   $a$'hands_since_eligible', v_hands, 'orbit', v_orbit));$a$,
   $b$'hands_since_eligible', v_hands, 'orbit', v_orbit,
                                     'over_cap', v_over_cap, 'people', v_people));$b$);
 IF step = patched THEN RAISE EXCEPTION 'break event anchor absent'; END IF;
 patched := step;

 IF position('fn_cash_game_never_moves_players(' IN patched) = 0 THEN
   RAISE EXCEPTION 'cash cluster tick must keep reading the one must-move definition';
 END IF;
 IF position('AN OPEN CHAIR IS OFFERED TO THE LIST' IN patched) = 0 THEN
   RAISE EXCEPTION 'cash cluster tick must keep offering open chairs to the list';
 END IF;
 IF position('fn_cash_game_second_table_picked(g.id, v_now)' IN patched) = 0 THEN
   RAISE EXCEPTION 'cash cluster tick must keep reading the one second-table rule';
 END IF;
 EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;

COMMIT;
