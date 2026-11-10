\set QUIET 1
\pset tuples_only on
\pset format unaligned
SELECT set_config('test.mode', :'mode', false);

-- S1. THE REPORTED STRAND: Leave pressed with hands owed. The Lightning door
-- stops first, the engine then confirms the blind off, the player goes away.
SELECT sim.reset();
SELECT sim.ok((sim.state() ->> 'pool_open')::boolean AND (sim.state() ->> 'leave_allowed')::boolean IS FALSE, 'S1 seeded: in pool, 3 of 10, leave refused');
SELECT set_config('test.s1', sim.stop()::text, false);
SELECT sim.ok(CASE sim.mode() WHEN 'before' THEN (current_setting('test.s1')::jsonb ->> 'exited')::boolean
  ELSE current_setting('test.s1')::jsonb @> '{"ok":true,"exited":false,"deferred":"HANDS_OWED","hands_owed":7}' END, 'S1 stop door answer');
SELECT sim.ok((sim.state() ->> 'pool_open')::boolean = (sim.mode() = 'after') AND NOT (sim.state() ->> 'stop_mark')::boolean, 'S1 pool session after stop');
SELECT sim.confirm();
SELECT sim.disconnect();
SELECT fn_lightning_reap_expired_disconnects(sim.c());
SELECT set_config('test.n', sim.deal_many(12, ARRAY[sim.h()])::text, false);
SELECT fn_lightning_reap_expired_disconnects(sim.c());
SELECT sim.ok(current_setting('test.n')::int = CASE sim.mode() WHEN 'before' THEN 0 ELSE 7 END, 'S1 owed hands dealt to the absent seat: ' || current_setting('test.n'));
SELECT sim.ok(sim.state() @> CASE sim.mode()
  WHEN 'before' THEN '{"played":3,"completed":false,"leave_allowed":false,"seat_live":true,"pool_open":false,"last_exit":"stop_playing"}'::jsonb
  ELSE '{"played":10,"completed":true,"leave_allowed":true,"seat_live":true}'::jsonb END, 'S1 state after twelve passes: ' || sim.state()::text);
SELECT sim.ok(sim.release() = (sim.mode() = 'after'), 'S1 held leave release');
SELECT sim.ok(sim.state() @> CASE sim.mode()
  WHEN 'before' THEN '{"seat_live":true,"stack":40,"pool_open":false}'::jsonb
  ELSE '{"seat_live":false,"pool_open":false,"open_slots":0}'::jsonb END, 'S1 end: ' || sim.state()::text);
SELECT CASE sim.mode() WHEN 'before' THEN 'S1 STRAND REPRODUCED (count frozen, leave refused, chips on the seat)' ELSE 'S1 COMPLETES' END;

-- S2. Blind off confirmed with the pool session open, then a disconnect past
-- the timeout and a reaper pass.
SELECT sim.reset();
SELECT sim.confirm();
SELECT sim.disconnect();
SELECT set_config('test.r', fn_lightning_reap_expired_disconnects(sim.c())::text, false);
SELECT sim.ok(CASE sim.mode() WHEN 'before' THEN (current_setting('test.r')::jsonb ->> 'expired')::int = 1
  ELSE current_setting('test.r')::jsonb -> 'skipped' @> '[{"reason":"blind_off_hands_owed","hands_owed":7}]' END, 'S2 reaper pass');
SELECT set_config('test.n', sim.deal_many(12, ARRAY[sim.h()])::text, false);
SELECT sim.ok(current_setting('test.n')::int = CASE sim.mode() WHEN 'before' THEN 0 ELSE 7 END, 'S2 hands dealt: ' || current_setting('test.n'));
SELECT sim.ok(sim.release() = (sim.mode() = 'after'), 'S2 held leave release');
SELECT sim.ok(sim.state() @> CASE sim.mode()
  WHEN 'before' THEN '{"played":3,"seat_live":true,"pool_open":false,"last_exit":"disconnect_expired"}'::jsonb
  ELSE '{"played":10,"seat_live":false,"pool_open":false,"last_exit":"anchor_seat_left"}'::jsonb END, 'S2 end: ' || sim.state()::text);
SELECT CASE sim.mode() WHEN 'before' THEN 'S2 STRAND REPRODUCED' ELSE 'S2 COMPLETES' END;

-- S3. Stop pressed mid-hand BEFORE profit; the hand then wins. The leave was
-- asked for while the player was free to go and is honoured in both images.
SELECT sim.reset(25);
INSERT INTO lightning_instance(id, cluster_id, hand_id, state) VALUES ('50000000-0000-4000-8000-000000000001', sim.c(), '50000000-0000-4000-8000-000000000002', 'dealing');
INSERT INTO lightning_reservation VALUES (sim.c(), sim.h(), 'committed', '50000000-0000-4000-8000-000000000001');
SELECT sim.ok(sim.stop() @> '{"ok":true,"exited":false,"in_hand":true}', 'S3 stop mid-hand is marked, not exited');
INSERT INTO seat_departure_requests SELECT occupancy_id, user_id, table_id, seat_number, 'voluntary' FROM table_seats WHERE user_id = sim.h();
UPDATE table_seats SET leave_pending = true WHERE user_id = sim.h();
UPDATE table_seats SET stack = 40 WHERE user_id = sim.h();
SELECT set_config('test.engine', 'true', false);
SELECT fn_cash_session_evaluate(sim.t(), jsonb_build_array(jsonb_build_object('user_id', sim.h(), 'active', true, 'hit_run', true, 'hand_id', 'h-s3', 'hand_source', 'lightning'))) IS NOT NULL;
SELECT set_config('test.engine', 'false', false);
UPDATE lightning_instance SET state = 'settled'; UPDATE lightning_reservation SET state = 'released';
SELECT sim.ok(sim.state() @> '{"required":10,"played":0,"leave_allowed":true,"stop_mark":true}', 'S3 countdown started after the request, leave still honoured');
SELECT fn_lightning_reap_expired_disconnects(sim.c());
SELECT sim.ok(sim.state() @> '{"pool_open":false,"last_exit":"stop_playing"}', 'S3 the stopper exits when the hand lets go');
SELECT sim.ok(sim.release(), 'S3 leave completes');
SELECT 'S3 UNCHANGED (' || sim.mode() || ')';

-- S4. The production shape: the pool session was already closed by a stop,
-- hr_blind_off stands, 3 of 10. The engine restores the hold (restart) and
-- re-confirms; the player later reconnects and presses stop again.
SELECT sim.reset();
UPDATE cash_player_session SET hr_blind_off = true WHERE player_id = sim.h();
UPDATE lightning_pool_session SET exited_at = now(), state = 'closed', exit_reason = 'stop_playing', stop_requested_at = now() WHERE player_id = sim.h();
UPDATE lightning_pool_slot SET closed_at = now() WHERE player_id = sim.h();
SELECT sim.confirm();
SELECT sim.ok((sim.state() ->> 'pool_open')::boolean = (sim.mode() = 'after'), 'S4 confirmation re-enters the pool');
SELECT set_config('test.n', sim.deal_many(3, ARRAY[sim.h()])::text, false);
SELECT fn_lightning_presence_report(sim.c(), ARRAY[]::uuid[], ARRAY[sim.h()]) IS NOT NULL;
SELECT sim.ok(CASE sim.mode() WHEN 'before' THEN true ELSE sim.stop() @> '{"exited":false,"deferred":"HANDS_OWED","hands_owed":4}' END, 'S4 stop on reconnect is deferred');
SELECT set_config('test.n', (current_setting('test.n')::int + sim.deal_many(9))::text, false);
SELECT sim.ok(current_setting('test.n')::int = CASE sim.mode() WHEN 'before' THEN 0 ELSE 7 END, 'S4 hands dealt: ' || current_setting('test.n'));
SELECT sim.ok(sim.release() = (sim.mode() = 'after'), 'S4 held leave release');
SELECT CASE sim.mode() WHEN 'before' THEN 'S4 STRAND REPRODUCED' ELSE 'S4 COMPLETES' END;

-- S5. The profit goes during the blind off: the count clears and the seat leaves.
SELECT sim.reset();
SELECT sim.confirm();
SELECT sim.disconnect();
SELECT sim.deal_many(2, ARRAY[sim.h()]);
UPDATE table_seats SET stack = 24 WHERE user_id = sim.h();
SELECT sim.deal_many(1, ARRAY[sim.h()]);
SELECT sim.ok(CASE sim.mode() WHEN 'before' THEN true ELSE sim.state() @> '{"leave_allowed":true}' AND sim.release() END, 'S5 profit gone releases the seat');

-- S6. Responsible gaming ends a blind off: never dealt again, the owed hands
-- are waived on the record and the seat leaves with its chips.
SELECT sim.reset();
SELECT sim.confirm();
INSERT INTO responsible_gaming_limits VALUES (sim.h());
SELECT sim.ok(sim.deal_many(3) = 0, 'S6 an excluded player is never dealt');
SELECT fn_lightning_reap_expired_disconnects(sim.c());
SELECT sim.ok(sim.state() @> '{"pool_open":false,"last_exit":"rg_limit"}', 'S6 responsible gaming ends the session');
SELECT sim.ok((SELECT count(*) FROM cash_cluster_events WHERE kind = 'blind_off_waived' AND payload @> '{"reason":"rg_limit","hands_played":3}') = CASE sim.mode() WHEN 'before' THEN 0 ELSE 1 END, 'S6 waiver recorded');
SELECT sim.ok(sim.release() = (sim.mode() = 'after'), 'S6 held leave release');
SELECT CASE sim.mode() WHEN 'before' THEN 'S6 STRAND REPRODUCED' ELSE 'S6 COMPLETES' END;

-- S7. An unconfirmed disconnect with hands owed keeps its existing treatment
-- in both images: not dealt, expired after the timeout, seat and count kept.
SELECT sim.reset();
SELECT sim.disconnect();
SELECT sim.ok(sim.deal_many(2, ARRAY[sim.h()]) = 0, 'S7 a disconnected player who did not confirm is not dealt');
SELECT sim.ok((fn_lightning_reap_expired_disconnects(sim.c()) ->> 'expired')::int = 1, 'S7 the disconnect expires');
SELECT sim.ok(sim.state() @> '{"played":3,"pool_open":false,"last_exit":"disconnect_expired","blind_off":false}', 'S7 unchanged');
-- A stop without hands owed still stops at once in both images.
SELECT sim.reset(25);
SELECT sim.ok(sim.stop() @> '{"ok":true,"exited":true}', 'S7 a stop with nothing owed exits at once');
SELECT 'LIGHTNING_BLIND_OFF_POSTGRES_PASS ' || sim.mode();
