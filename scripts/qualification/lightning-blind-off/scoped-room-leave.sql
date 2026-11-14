\set ON_ERROR_STOP on
SELECT set_config('test.mode', 'scoped leave', false);
SELECT sim.reset(25);
CREATE OR REPLACE FUNCTION sim.durable_room_state() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'rooms', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM lightning_pool_session p),
    'slots', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM lightning_pool_slot p),
    'departure_requests', (SELECT jsonb_agg(to_jsonb(d) ORDER BY occupancy_id) FROM seat_departure_requests d),
    'events', (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM cash_cluster_events e),
    'seats', (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM table_seats s),
    'cash_sessions', (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM cash_player_session c)
  )
$$;
SELECT set_config('test.uid', sim.h()::text, false);
SELECT id AS old_room FROM lightning_pool_session WHERE player_id = sim.h() \gset
-- Same human and cluster, same physical seat, subsequent pool admission.
SELECT sim.ok(sim.stop() @> '{"ok":true,"exited":true}', 'A closed through the existing stop owner');
SELECT occupancy_id AS held_occupancy FROM table_seats WHERE user_id = sim.h() AND left_at IS NULL \gset
SELECT fn_lightning_my_session(sim.c()) AS closed_anchor \gset
\if :before
SELECT sim.ok(:'closed_anchor'::jsonb->>'seat_number' = '1', 'legacy closed room still provides physical cash-out coordinates');
\else
SELECT sim.ok(:'closed_anchor'::jsonb @> jsonb_build_object('pool_session_id', NULL, 'seat_table_id', sim.t())
  AND :'closed_anchor'::jsonb->>'seat_number' = '1', 'existing client retains its closed-room seat coordinates during additive preparation');
SET ROLE authenticated;
SELECT fn_lightning_stopped_leave_anchor('70000000-0000-4000-8000-000000000001', :'old_room', :'held_occupancy') AS stopped_anchor \gset
RESET ROLE;
SELECT sim.ok(:'stopped_anchor'::jsonb @> jsonb_build_object('table_id', sim.t(), 'user_id', sim.h(), 'seat_number', 1, 'occupancy_id', :'held_occupancy'::uuid),
  'closed room resolves its still-held exact seat');
UPDATE table_seats SET occupancy_id = gen_random_uuid() WHERE user_id = sim.h();
SELECT sim.ok(fn_lightning_stopped_leave_anchor(sim.c(), :'old_room', :'held_occupancy') IS NULL, 'replacement occupancy rejects old anchor');
UPDATE table_seats SET occupancy_id = :'held_occupancy' WHERE user_id = sim.h();
\endif
SELECT fn_lightning_pool_enter(anchor_seat_id) AS new_room FROM lightning_pool_session WHERE id = :'old_room' \gset
SELECT sim.ok(:'old_room'::uuid <> :'new_room'::uuid AND
    (SELECT count(DISTINCT anchor_seat_id) = 1 AND count(*) = 2 FROM lightning_pool_session
      WHERE id IN (:'old_room', :'new_room')), 'same seat, distinct pool admissions');
SELECT sim.ok(fn_lightning_my_session(sim.c()) @> jsonb_build_object('pool_session_id', :'new_room'::uuid, 'seat_number', 1, 'anchor_table_id', sim.t()),
  'active room retains its own physical seat and table');
\if :before
-- A's previously valid read has returned to its tab. B has since entered the
-- same physical occupancy. Demonstrate the legacy engine writer accepts A.
BEGIN;
SELECT set_config('test.engine', 'true', true);
SELECT sim.ok(fn_request_seat_departure(sim.h(), sim.t(), 1, :'held_occupancy', 'voluntary') @> '{"accepted":true}'
    AND (SELECT id FROM lightning_pool_session WHERE id = :'new_room') IS NOT NULL,
  'legacy engine writer accepts A after B acquired the same occupancy');
SELECT sim.ok((SELECT leave_pending FROM table_seats WHERE user_id = sim.h())
    AND EXISTS (SELECT 1 FROM seat_departure_requests WHERE occupancy_id = :'held_occupancy'),
  'legacy request from A marks B paid seat for departure');
ROLLBACK;
SET ROLE authenticated;
SELECT fn_lightning_stop_playing('70000000-0000-4000-8000-000000000001') AS legacy_stop \gset
RESET ROLE;
SELECT sim.ok(:'legacy_stop'::jsonb @> jsonb_build_object('pool_session_id', :'new_room'::uuid, 'exited', true)
  AND (SELECT exited_at IS NOT NULL FROM lightning_pool_session WHERE id = :'new_room'), 'a cached cluster-only stop closes B after A has left');
SELECT 'LEGACY_STALE_ROOM_CLOSED_SUCCESSOR';
\else
SELECT sim.ok(fn_lightning_stopped_leave_anchor(sim.c(), :'old_room', :'held_occupancy') IS NULL AND
    fn_lightning_stopped_leave_anchor(sim.c(), :'new_room', :'held_occupancy') IS NULL,
  'neither stale room A nor active room B can resolve a stopped seat, even on the same occupancy');
SELECT sim.ok(NOT has_function_privilege('anon', 'public.fn_lightning_stopped_leave_anchor(uuid,uuid,uuid)', 'execute'), 'anonymous cannot read the stopped anchor');
-- The immutable cash-out record is dated before or after the next admission.
-- Exercise both ownerships with the same seat row, and retain the real reader.
BEGIN;
SELECT set_config('test.engine','true',true);
INSERT INTO seat_cashout_receipts(occupancy_id,user_id,table_id,seat_id,seat_number,receipt,created_at)
SELECT :'held_occupancy', sim.h(), sim.t(), p.anchor_seat_id, 1, '{"stack":25,"owner":"B"}', clock_timestamp()
  FROM lightning_pool_session p WHERE p.id = :'new_room';
SELECT sim.ok(fn_get_lightning_room_cashout_receipt(sim.h(),sim.t(),1,:'held_occupancy',:'old_room') IS NULL
  AND fn_get_lightning_room_cashout_receipt(sim.h(),sim.t(),1,:'held_occupancy',:'new_room') = '{"stack":25,"owner":"B"}'::jsonb,
  'A cannot replay the successor room cash-out for the same occupancy');
-- A finished before B's re-buy on a different occupancy. Its receipt survives.
SELECT gen_random_uuid() AS spent \gset
INSERT INTO seat_cashout_receipts(occupancy_id,user_id,table_id,seat_id,seat_number,receipt,created_at)
SELECT :'spent',sim.h(),sim.t(),p.anchor_seat_id,1,'{"stack":25,"owner":"A"}',p.exited_at
  FROM lightning_pool_session p WHERE p.id=:'old_room';
SELECT sim.ok(fn_get_lightning_room_cashout_receipt(sim.h(),sim.t(),1,:'spent',:'old_room') = '{"stack":25,"owner":"A"}'::jsonb
  AND fn_get_lightning_room_cashout_receipt(sim.h(),sim.t(),1,:'spent',:'new_room') IS NULL,
  'A can replay its own original occupancy receipt after B is admitted');
ROLLBACK;
SELECT sim.durable_room_state() AS before_stale \gset
SET ROLE authenticated;
SELECT fn_lightning_stop_playing('70000000-0000-4000-8000-000000000001', :'old_room') AS stale_stop \gset
SELECT fn_lightning_resume_playing('70000000-0000-4000-8000-000000000001', :'old_room') AS stale_resume \gset
RESET ROLE;
SELECT sim.ok(:'stale_stop'::jsonb @> '{"ok":false,"reason":"SESSION_CHANGED"}' AND :'stale_resume'::jsonb @> '{"ok":false,"reason":"SESSION_CHANGED"}', 'stale room cannot stop/resume successor');
SELECT sim.ok((SELECT stop_requested_at IS NULL AND exited_at IS NULL FROM lightning_pool_session WHERE id = :'new_room'), 'successor untouched');
SELECT sim.ok(has_function_privilege('authenticated','public.fn_lightning_stop_playing(uuid)','execute') AND has_function_privilege('authenticated','public.fn_lightning_resume_playing(uuid)','execute'), 'existing client retains both legacy RPC grants during additive preparation');
SELECT sim.ok(NOT has_function_privilege('anon','public.fn_lightning_stop_playing(uuid,uuid)','execute') AND NOT has_function_privilege('authenticated','smarter_private.lightning_room_leave_control(uuid,uuid,boolean)','execute'), 'private and anon doors remain closed');

-- The older tab already passed stopped_leave_anchor before the new admission.
-- Exercise the actual service writer it can finally reach after that response.
SELECT set_config('test.engine', 'true', false);
SELECT fn_lightning_request_room_departure(:'old_room', sim.h(), sim.t(), 1, :'held_occupancy', false) AS stale_physical \gset
SELECT set_config('test.engine', 'false', false);
SELECT sim.ok(:'stale_physical'::jsonb @> '{"ok":false,"reason":"STALE_OCCUPANCY"}',
  'stale physical departure refused after the exact-anchor read and a same-occupancy re-admission');
SELECT sim.ok(NOT has_function_privilege('authenticated','public.fn_lightning_request_room_departure(uuid,uuid,uuid,integer,uuid,boolean)','execute')
  AND NOT has_function_privilege('anon','public.fn_lightning_request_room_departure(uuid,uuid,uuid,integer,uuid,boolean)','execute')
  AND has_function_privilege('service_role','public.fn_lightning_request_room_departure(uuid,uuid,uuid,integer,uuid,boolean)','execute'), 'only the engine may submit a physical Lightning departure');
SELECT sim.ok(sim.durable_room_state() = :'before_stale'::jsonb, 'stale requests preserve every seat, balance, cash session, pool room, slot and event');
SELECT sim.ok(NOT has_function_privilege('anon','public.fn_lightning_resume_playing(uuid,uuid)','execute')
  AND has_function_privilege('service_role','public.fn_lightning_stop_playing(uuid)','execute')
  AND has_function_privilege('service_role','public.fn_lightning_resume_playing(uuid)','execute'), 'legacy service and anonymous grant boundaries');
INSERT INTO lightning_instance(id, cluster_id, hand_id, state) VALUES ('50000000-0000-4000-8000-000000000001', sim.c(), '50000000-0000-4000-8000-000000000002', 'dealing');
INSERT INTO lightning_reservation VALUES (sim.c(), sim.h(), 'committed', '50000000-0000-4000-8000-000000000001');
SET ROLE authenticated;
SELECT fn_lightning_stop_playing('70000000-0000-4000-8000-000000000001', :'new_room') AS stop_result \gset
RESET ROLE;
SELECT sim.ok(:'stop_result'::jsonb @> '{"ok":true,"in_hand":true}' AND :'stop_result'::jsonb->>'pool_session_id' = :'new_room', 'current room stop accepted');
SELECT sim.durable_room_state() AS after_stop \gset
SET ROLE authenticated;
SELECT fn_lightning_stop_playing('70000000-0000-4000-8000-000000000001', :'new_room') AS repeated_stop \gset
SELECT fn_lightning_resume_playing('70000000-0000-4000-8000-000000000001', :'old_room') AS obsolete_resume \gset
RESET ROLE;
SELECT sim.ok(:'repeated_stop'::jsonb = :'stop_result'::jsonb AND :'obsolete_resume'::jsonb @> '{"ok":false,"reason":"SESSION_CHANGED"}'
  AND sim.durable_room_state() = :'after_stop'::jsonb, 'duplicate stop and stale resume preserve exact receipt and all durable state');
UPDATE cash_games SET cluster_mode = 'frozen';
SELECT sim.ok(fn_lightning_resume_playing(sim.c(), :'new_room') @> '{"ok":false,"reason":"FROZEN"}', 'freeze refusal retained');
UPDATE cash_games SET cluster_mode = 'lightning';
SET ROLE authenticated;
SELECT fn_lightning_resume_playing('70000000-0000-4000-8000-000000000001', :'new_room') AS resumed \gset
RESET ROLE;
SELECT sim.ok(:'resumed'::jsonb @> '{"ok":true,"withdrawn":true}', 'current room can withdraw');
SELECT sim.durable_room_state() AS after_resume \gset
SET ROLE authenticated;
SELECT fn_lightning_resume_playing('70000000-0000-4000-8000-000000000001', :'new_room') AS repeated_resume \gset
RESET ROLE;
SELECT sim.ok(:'repeated_resume'::jsonb @> '{"ok":true,"withdrawn":false}' AND sim.durable_room_state() = :'after_resume'::jsonb,
  'duplicate resume preserves every balance, room, slot and event');
SELECT sim.ok(sim.durable_room_state()->'seats' = :'before_stale'::jsonb->'seats'
  AND sim.durable_room_state()->'cash_sessions' = :'before_stale'::jsonb->'cash_sessions'
  AND sim.durable_room_state()->'slots' = :'before_stale'::jsonb->'slots', 'valid stop and resume also preserve the funded seat and open slot');
SELECT sim.ok(fn_lightning_stop_playing(sim.c(), :'new_room') @> '{"ok":true,"in_hand":true}', 'same room can requeue');
-- The final hand newly creates an obligation. Stay must still be available
-- even if the reaper sees the settlement before the browser opens the prompt.
UPDATE table_seats SET stack=40 WHERE user_id=sim.h();
SELECT set_config('test.engine','true',false);
SELECT fn_cash_session_evaluate(sim.t(),jsonb_build_array(jsonb_build_object('user_id',sim.h(),'active',true,'hit_run',true,'hand_id','room-new-profit','hand_source','lightning')));
UPDATE lightning_instance SET state='settled';
UPDATE lightning_reservation SET state='released';
SELECT fn_lightning_reap_expired_disconnects(sim.c());
SELECT sim.ok((SELECT exited_at IS NULL AND stop_requested_at IS NULL FROM lightning_pool_session WHERE id=:'new_room'), 'new obligation holds for player choice');
SELECT sim.ok(fn_lightning_resume_playing(sim.c(), :'new_room') @> '{"ok":true}', 'Stay keeps seat matching');
SELECT sim.durable_room_state() AS before_choice \gset
SELECT fn_lightning_request_room_departure(:'new_room',sim.h(),sim.t(),1,:'held_occupancy',false) AS unconfirmed \gset
SELECT sim.ok(:'unconfirmed'::jsonb @> '{"ok":false,"reason":"LEAVE_LOCKED","hands_remaining":10}'
  AND sim.durable_room_state() = :'before_choice'::jsonb, 'owed hands require confirmation and change nothing until then');
SELECT sim.ok(fn_lightning_request_room_departure(:'new_room',sim.h(),sim.t(),1,:'held_occupancy',true)
  @> '{"ok":true,"blind_off":true,"hands_remaining":10}', 'confirmed owed hands enter the existing blind-off owner');
SELECT sim.ok(sim.state() @> '{"pool_open":true,"blind_off":true,"stack":40}' AND
  NOT EXISTS(SELECT 1 FROM seat_departure_requests WHERE occupancy_id = :'held_occupancy'), 'confirmed blind off preserves matching and seat balance');
-- Supply the physical transaction/re-admission pair to the two-connection
-- contention probe. The intended room is closed but its funded seat remains.
SELECT sim.reset(25);
SELECT sim.ok(sim.stop() @> '{"exited":true}', 'seed a stopped room with a funded seat');
CREATE FUNCTION sim.prepare_held_departure() RETURNS jsonb LANGUAGE sql AS $$
  SELECT fn_lightning_request_room_departure(p.id,sim.h(),sim.t(),s.seat_number,s.occupancy_id,false)
    FROM lightning_pool_session p JOIN table_seats s ON s.id = p.anchor_seat_id
   WHERE p.player_id = sim.h() ORDER BY p.entered_at DESC LIMIT 1
$$;
CREATE FUNCTION sim.readmit_held_seat() RETURNS uuid LANGUAGE sql AS $$
  SELECT fn_lightning_pool_enter(id) FROM table_seats WHERE user_id = sim.h()
$$;
SELECT 'SCOPED_LIGHTNING_LEAVE_POSTGRES_PASS';
\endif
