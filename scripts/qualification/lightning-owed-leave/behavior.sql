-- #10740: a queued Lightning leave that owes hit-and-run hands. Built on the
-- lightning-blind-off fixture (installed production images plus 20261109224717).
-- The hero is in profit, 3 of 10 hands played. Nothing here reads horse identity:
-- the same seat, door and count serve a person and a horse.
\set QUIET 1
\pset tuples_only on
\pset format unaligned
SELECT set_config('test.mode', :'mode', false);

CREATE FUNCTION sim.queue_leave(p_mode text DEFAULT 'voluntary') RETURNS void LANGUAGE sql AS $$
  -- What fn_request_seat_departure writes for a leave asked behind a live hand.
  INSERT INTO seat_departure_requests(occupancy_id, user_id, table_id, seat_number, leave_mode)
  SELECT occupancy_id, user_id, table_id, seat_number, p_mode FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL;
  UPDATE table_seats SET status = 'sitting_out', is_sitting_out = true, leave_pending = true WHERE user_id = sim.h() AND left_at IS NULL;
$$;
CREATE FUNCTION sim.seat_flags() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('leave_pending', leave_pending, 'sitting_out', is_sitting_out, 'status', status,
    'requests', (SELECT count(*) FROM seat_departure_requests d WHERE d.occupancy_id = ts.occupancy_id))
    FROM table_seats ts WHERE user_id = sim.h() ORDER BY joined_at DESC LIMIT 1 $$;

-- Q1. THE REPORTED STRAND: queued leave, then the count refuses the cash-out.
SELECT sim.reset();
SELECT sim.queue_leave();
SELECT sim.ok((sim.state() ->> 'leave_allowed')::boolean IS FALSE AND (sim.state() ->> 'pool_open')::boolean, 'Q1 seeded: pending, sat out, pool session open, leave refused');
SELECT set_config('test.n', sim.deal_many(12)::text, false);
SELECT sim.ok(current_setting('test.n')::int = 0, 'Q1 a pending, sat-out seat is never dealt: ' || current_setting('test.n'));
SELECT sim.ok(sim.release() IS FALSE AND (sim.state() ->> 'played')::int = 3, 'Q1 the held leave is refused and the count frozen');
\if :after
SELECT set_config('test.engine', 'true', false);
SELECT set_config('test.r', fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1,
  (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL))::text, false);
SELECT set_config('test.engine', 'false', false);
SELECT sim.ok(current_setting('test.r')::jsonb @> '{"returned":true,"hands_remaining":7}', 'Q1 the door returns the seat: ' || current_setting('test.r'));
SET CONSTRAINTS ALL IMMEDIATE;
SELECT sim.ok(sim.seat_flags() @> '{"leave_pending":false,"sitting_out":false,"status":"active","requests":0}', 'Q1 seat flags: ' || sim.seat_flags()::text);
SELECT sim.ok(sim.state() @> '{"blind_off":true,"pool_open":true,"open_slots":1}', 'Q1 blinded off, pool slot open: ' || sim.state()::text);
SELECT set_config('test.n', sim.deal_many(12)::text, false);
SELECT sim.ok(current_setting('test.n')::int = 7, 'Q1 the owed hands are dealt as a blind off: ' || current_setting('test.n'));
SELECT sim.ok(sim.state() @> '{"played":10,"completed":true,"leave_allowed":true}', 'Q1 count complete: ' || sim.state()::text);
SELECT sim.ok(sim.release(), 'Q1 the held leave cashes out through the voluntary door');
SELECT sim.ok(sim.state() @> '{"seat_live":false,"pool_open":false,"open_slots":0}', 'Q1 end: ' || sim.state()::text);
SELECT 'Q1 COMPLETES';
\else
SELECT 'Q1 STRAND REPRODUCED (pending seat never dealt, count frozen at 3 of 10, chips on the seat)';
\endif

\if :after
-- Q2. An administrator's (forced) exit is never turned into a blind off.
SELECT sim.reset();
SELECT sim.queue_leave('forced');
SELECT set_config('test.engine', 'true', false);
SELECT sim.ok(fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1, (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL)) @> '{"returned":false,"reason":"forced"}', 'Q2 forced refused');
SELECT sim.ok(sim.seat_flags() @> '{"leave_pending":true,"sitting_out":true,"requests":1}', 'Q2 nothing written');

-- Q3. Nothing owed: the ordinary cash-out completes instead; nothing written.
SELECT sim.reset(25);
SELECT sim.queue_leave();
SELECT sim.ok(fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1, (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL)) @> '{"returned":false,"reason":"not_owed"}', 'Q3 not owed refused');
SELECT sim.ok(sim.seat_flags() @> '{"leave_pending":true,"requests":1}' AND sim.release(), 'Q3 the pending leave cashes out');

-- Q4. Still in a live Lightning hand: refused, asked again after the hand.
SELECT sim.reset();
SELECT sim.queue_leave();
INSERT INTO lightning_instance(id, cluster_id, hand_id, state) VALUES ('50000000-0000-4000-8000-000000000011', sim.c(), '50000000-0000-4000-8000-000000000012', 'dealing');
INSERT INTO lightning_reservation VALUES (sim.c(), sim.h(), 'committed', '50000000-0000-4000-8000-000000000011');
SELECT sim.ok(fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1, (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL)) @> '{"returned":false,"reason":"in_hand"}', 'Q4 in hand refused');
UPDATE lightning_instance SET state = 'settled';
SELECT sim.ok(fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1, (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL)) @> '{"returned":true}', 'Q4 returned once the hand is over');
-- Q5. Asked twice: the second answer writes nothing.
SELECT sim.ok(fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1, (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL)) @> '{"returned":false,"reason":"not_pending"}', 'Q5 idempotent');
-- Q6. A stale occupancy is refused.
SELECT sim.ok(fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1, gen_random_uuid()) @> '{"returned":false,"reason":"stale_occupancy"}', 'Q6 stale occupancy');
SELECT set_config('test.engine', 'false', false);
-- Q7. Only the engine may call it.
DO $q7$ BEGIN
  PERFORM fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1, gen_random_uuid());
  RAISE EXCEPTION 'Q7 a non-engine caller was admitted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $q7$;
SELECT 'Q2-Q7 PASS';

-- The engine's door, as the anchor engine calls it.
CREATE FUNCTION sim.door() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('test.engine', 'true', true);
  r := fn_lightning_owed_leave_returns_to_pool(sim.h(), sim.t(), 1,
         (SELECT occupancy_id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL));
  PERFORM set_config('test.engine', 'false', true);
  RETURN r;
END$$;
-- What hand formation, hand start and the Classic-to-Lightning population
-- count all ask of the anchor (fn_lightning_form_hand,
-- fn_lightning_instance_begin_dealing, fn_cash_cluster_live_eligible).
CREATE FUNCTION sim.anchor_live() RETURNS boolean LANGUAGE sql AS $$
  SELECT fn_lightning_anchor_is_live_eligible(
    (SELECT id FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL), sim.c(), sim.h()) $$;
CREATE FUNCTION sim.sessions() RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM lightning_pool_session WHERE player_id = sim.h() AND exited_at IS NULL $$;

-- Q8. The shared anchor predicate, and no duplicate participation.
SELECT sim.reset();
SELECT sim.queue_leave();
SELECT sim.ok(sim.anchor_live() IS FALSE, 'Q8 a pending, sat-out anchor is not live for formation, start or the population count');
SELECT sim.ok((sim.door() ->> 'returned')::boolean, 'Q8 returned');
SELECT sim.ok(sim.anchor_live(), 'Q8 once returned the anchor is live for formation, start and the population count');
SELECT sim.ok(sim.sessions() = 1 AND (sim.state() ->> 'open_slots')::int = 1, 'Q8 one pool session and one slot, never two: ' || sim.state()::text);
SELECT sim.ok((sim.door() ->> 'returned')::boolean IS FALSE AND sim.sessions() = 1, 'Q8 a second return admits nobody twice');

-- Q9. Stop Playing while the returned blind off still owes hands: deferred, still dealt.
SELECT sim.reset();
SELECT sim.queue_leave();
SELECT sim.ok((sim.door() ->> 'returned')::boolean, 'Q9 returned');
SELECT set_config('test.r', sim.stop()::text, false);
SELECT sim.ok(current_setting('test.r')::jsonb @> '{"exited":false,"deferred":"HANDS_OWED"}', 'Q9 stop deferred for hands owed: ' || current_setting('test.r'));
SELECT sim.ok((sim.state() ->> 'pool_open')::boolean AND sim.sessions() = 1, 'Q9 the pool session stays open');
SELECT set_config('test.n', sim.deal_many(12)::text, false);
SELECT sim.ok(current_setting('test.n')::int = 7 AND (sim.state() ->> 'completed')::boolean, 'Q9 the seven owed hands are dealt and completed: ' || current_setting('test.n'));
SELECT sim.ok(sim.release(), 'Q9 the leave then settles through the voluntary door');

-- Q10. Disconnected after the return: the blind off is still dealt, folded by its host.
SELECT sim.reset();
SELECT sim.queue_leave();
SELECT sim.ok((sim.door() ->> 'returned')::boolean, 'Q10 returned');
SELECT sim.disconnect();
SELECT set_config('test.n', sim.deal_many(12, ARRAY[sim.h()])::text, false);
SELECT sim.ok(current_setting('test.n')::int = 7 AND (sim.state() ->> 'completed')::boolean, 'Q10 disconnected, the owed hands are still dealt as a blind off: ' || current_setting('test.n'));
SELECT sim.ok(sim.release(), 'Q10 then the leave settles');

-- Q11. A plain sit-out with no leave asked is not the door's: nothing written, not dealt.
SELECT sim.reset();
UPDATE table_seats SET status = 'sitting_out', is_sitting_out = true WHERE user_id = sim.h() AND left_at IS NULL;
SELECT sim.ok(sim.door() @> '{"returned":false}', 'Q11 a sit-out without a leave is refused');
SELECT sim.ok(sim.seat_flags() @> '{"leave_pending":false,"sitting_out":true,"requests":0}', 'Q11 nothing written: ' || sim.seat_flags()::text);
SELECT set_config('test.n', sim.deal_many(3)::text, false);
SELECT sim.ok(current_setting('test.n')::int = 0, 'Q11 a player who sat out on their own is not dealt');
SELECT 'Q8-Q11 PASS';
\endif
SELECT 'LIGHTNING_OWED_LEAVE_POSTGRES_PASS ' || sim.mode();
