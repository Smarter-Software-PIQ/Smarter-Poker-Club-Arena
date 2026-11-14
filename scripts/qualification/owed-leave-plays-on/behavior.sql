-- 2026-11-14: a held leave that owes hands, alone at its table, while its game
-- deals at another table. Built on the lightning-blind-off fixture (installed
-- production images plus 20261109224717 and 20261113225904). The game is a
-- Classic must-move game here: the hero alone at table T, five players at T2.
-- Nothing reads horse identity.
\set QUIET 1
\pset tuples_only on
\pset format unaligned
SELECT set_config('test.mode', :'mode', false);

CREATE FUNCTION sim.t2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT '30000000-0000-4000-8000-000000000002'::uuid$$;
CREATE FUNCTION sim.classic_alone(p_hero_stack numeric DEFAULT 40) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sim.reset(p_hero_stack);
  UPDATE cash_games SET cluster_mode = 'must_move' WHERE id = sim.c();
  INSERT INTO tables(id, club_id, cluster_id) VALUES (sim.t2(), 'c0000000-0000-4000-8000-000000000001', sim.c());
  UPDATE tables SET game_variant = 'nlh', small_blind = 0.25, big_blind = 0.5, max_players = 6 WHERE id = sim.t();
  UPDATE table_seats SET table_id = sim.t2() WHERE user_id <> sim.h();
  UPDATE cash_player_session SET scope_id = sim.t2(), table_id = sim.t2() WHERE player_id <> sim.h();
END$$;
CREATE FUNCTION sim.queue_leave(p_mode text DEFAULT 'voluntary') RETURNS void LANGUAGE sql AS $$
  INSERT INTO seat_departure_requests(occupancy_id, user_id, table_id, seat_number, leave_mode)
  SELECT occupancy_id, user_id, table_id, seat_number, p_mode FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL;
  UPDATE table_seats SET status = 'sitting_out', is_sitting_out = true, leave_pending = true WHERE user_id = sim.h() AND left_at IS NULL;
$$;
CREATE FUNCTION sim.ask() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('test.engine', 'true', true);
  r := fn_owed_leave_plays_on_in_game(sim.h(), sim.t(), 1,
    (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL));
  PERFORM set_config('test.engine', 'false', true);
  RETURN r;
END$$;
CREATE FUNCTION sim.flags() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('leave_pending', leave_pending, 'sitting_out', is_sitting_out, 'status', status,
    'stack', stack, 'live', left_at IS NULL,
    'requests', (SELECT count(*) FROM seat_departure_requests d WHERE d.occupancy_id = ts.occupancy_id),
    'blind_off', (SELECT hr_blind_off FROM cash_player_session WHERE player_id = sim.h() AND closed_at IS NULL))
    FROM table_seats ts WHERE user_id = sim.h() ORDER BY joined_at DESC LIMIT 1 $$;

\if :after
TRUNCATE ca_owed_leave_decisions;
-- Q1. The game deals at a compatible T2 with an open chair: the seat plays on.
SELECT sim.classic_alone();
SELECT sim.queue_leave();
SELECT sim.ok(sim.ask() @> '{"keep":true,"returned":true,"reason":"plays_on","hands_remaining":7,"dest_table_id":"30000000-0000-4000-8000-000000000002","dest_open_chair":true}', 'Q1 answer');
SELECT sim.ok(sim.flags() @> '{"leave_pending":false,"sitting_out":false,"status":"active","requests":0,"blind_off":true,"stack":40,"live":true}', 'Q1 seat: ' || sim.flags()::text);
SELECT sim.ok((fn_cash_leave_check(sim.h(), sim.t()) ->> 'hands_remaining')::int = 7, 'Q1 the obligation is untouched');
SELECT sim.ok((SELECT row(user_id, table_id, cluster_id, dest_table_id, dest_open_chair, source, keep, returned, reason, hands_owed)::text
                 FROM ca_owed_leave_decisions ORDER BY id DESC LIMIT 1)
  = row(sim.h(), sim.t(), sim.c(), sim.t2(), true, 'engine_held_leave_release', true, true, 'plays_on', 7)::text, 'Q1 audit row');
SELECT 'Q1 PLAYS ON';
-- Q2. Asked again while the move is pending: keep, nothing written to the seat.
SELECT sim.ok(sim.ask() @> '{"keep":true,"returned":false,"reason":"awaiting_move"}', 'Q2 awaiting move');
-- Q3. An open chair keeps the seat past ten minutes; thirty minutes unmoved is a fault, recorded.
UPDATE ca_owed_leave_decisions SET occurred_at = occurred_at - interval '11 minutes';
SELECT sim.ok(sim.ask() @> '{"keep":true,"reason":"awaiting_move"}', 'Q3 an open chair is not waited out at ten minutes');
UPDATE ca_owed_leave_decisions SET occurred_at = occurred_at - interval '20 minutes';
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"not_moved"}', 'Q3 thirty minutes unmoved');
-- Q4. Every compatible table full for ten minutes: the waiver stands.
SELECT sim.classic_alone();
SELECT sim.queue_leave();
UPDATE tables SET max_players = 5 WHERE id = sim.t2();
SELECT sim.ok(sim.ask() @> '{"keep":true,"dest_open_chair":false}', 'Q4 full table still kept at first');
UPDATE ca_owed_leave_decisions SET occurred_at = occurred_at - interval '11 minutes' WHERE table_id = sim.t() AND occupancy_id = (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL);
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"compatible_full"}', 'Q4 full for ten minutes');
-- Q5. No compatible dealing table: other stakes, other variant, another club, one player, breaking.
SELECT sim.classic_alone(); SELECT sim.queue_leave();
UPDATE tables SET big_blind = 1 WHERE id = sim.t2();
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"nobody_in_game"}', 'Q5 other stakes');
SELECT sim.ok(sim.flags() @> '{"leave_pending":true,"sitting_out":true,"requests":1,"blind_off":false}', 'Q5 nothing written');
SELECT sim.classic_alone(); SELECT sim.queue_leave();
UPDATE tables SET game_variant = 'plo4' WHERE id = sim.t2();
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"nobody_in_game"}', 'Q5 other variant');
SELECT sim.classic_alone(); SELECT sim.queue_leave();
UPDATE tables SET club_id = gen_random_uuid() WHERE id = sim.t2();
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"nobody_in_game"}', 'Q5 another club');
SELECT sim.classic_alone(); SELECT sim.queue_leave();
UPDATE table_seats SET left_at = now() WHERE table_id = sim.t2() AND seat_number > 2;
UPDATE table_seats SET is_sitting_out = true WHERE table_id = sim.t2() AND seat_number = 2;
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"nobody_in_game"}', 'Q5 one active player');
SELECT sim.classic_alone(); SELECT sim.queue_leave();
UPDATE tables SET lifecycle = 'breaking' WHERE id = sim.t2();
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"nobody_in_game"}', 'Q5 breaking');
-- Q6. A Classic game never moves players: the per-table rule stands.
SELECT sim.classic_alone(); SELECT sim.queue_leave();
UPDATE cash_games SET template_name = 'classic' WHERE id = sim.c();
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"game_never_moves"}', 'Q6 Classic');
SELECT sim.ok(sim.flags() @> '{"leave_pending":true,"requests":1}', 'Q6 nothing written');
-- Q7. An administrator's exit is never kept; nothing owed releases.
SELECT sim.classic_alone(); SELECT sim.queue_leave('forced');
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"forced"}', 'Q7 forced');
SELECT sim.classic_alone(25); SELECT sim.queue_leave();
SELECT sim.ok(sim.ask() @> '{"keep":false,"reason":"not_owed"}', 'Q7 not owed');
-- Q8. A seat held by the engine only (no request) is kept without a withdrawal.
SELECT sim.classic_alone();
SELECT sim.ok(sim.ask() @> '{"keep":true,"returned":false,"reason":"awaiting_move"}', 'Q8 kept');
SELECT sim.ok(sim.flags() @> '{"blind_off":true,"requests":0}', 'Q8 blind off marked');
-- Q9. Stale occupancy and the caller check.
DO $$ BEGIN
  PERFORM set_config('test.engine', 'true', true);
  IF fn_owed_leave_plays_on_in_game(sim.h(), sim.t(), 1, gen_random_uuid()) ->> 'reason' <> 'stale_occupancy' THEN
    RAISE EXCEPTION 'Q9 stale occupancy not refused';
  END IF;
  PERFORM set_config('test.engine', 'false', true);
  BEGIN
    PERFORM fn_owed_leave_plays_on_in_game(sim.h(), sim.t(), 1, gen_random_uuid());
    RAISE EXCEPTION 'Q9 a non-engine caller was answered';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
-- Q10. Every answer is on the record, and only the engine role may read it.
SELECT sim.ok((SELECT count(*) FROM ca_owed_leave_decisions) = 15, 'Q10 decisions recorded: ' || (SELECT count(*) FROM ca_owed_leave_decisions));
SELECT sim.ok(NOT has_table_privilege('authenticated', 'public.ca_owed_leave_decisions', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.ca_owed_leave_decisions', 'SELECT')
  AND has_table_privilege('service_role', 'public.ca_owed_leave_decisions', 'SELECT')
  AND NOT has_function_privilege('authenticated', 'public.fn_owed_leave_plays_on_in_game(uuid,uuid,integer,uuid)', 'EXECUTE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ca_owed_leave_decisions'::regclass), 'Q10 access controls');
SELECT 'Q2-Q10 PASS';
\else
SELECT sim.ok(to_regprocedure('public.fn_owed_leave_plays_on_in_game(uuid,uuid,integer,uuid)') IS NULL, 'before: no door');
SELECT sim.classic_alone();
SELECT sim.queue_leave();
SELECT sim.ok((fn_cash_leave_check(sim.h(), sim.t()) ->> 'hands_remaining')::int = 7 AND (SELECT count(*) FROM table_seats WHERE table_id = sim.t2() AND left_at IS NULL) = 5,
  'before: 7 hands owed while the game seats five at T2');
SELECT 'Q0 WAIVER REPRODUCED (alone at T, the game dealing at T2: the engine has only the per-table waiver)';
\endif
SELECT 'OWED_LEAVE_PLAYS_ON_POSTGRES_PASS ' || :'mode';
