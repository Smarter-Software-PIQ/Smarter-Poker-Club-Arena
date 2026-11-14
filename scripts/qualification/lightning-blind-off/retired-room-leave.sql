\set ON_ERROR_STOP on
SELECT set_config('test.mode', 'retired unscoped leave', false);
SELECT sim.reset(25);
SELECT set_config('test.uid',sim.h()::text,false);
SELECT id AS room FROM lightning_pool_session WHERE player_id=sim.h() \gset
SELECT occupancy_id AS occupancy FROM table_seats WHERE user_id=sim.h() \gset
SELECT sim.ok(NOT has_function_privilege('authenticated','public.fn_lightning_stop_playing(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.fn_lightning_resume_playing(uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.fn_lightning_stop_playing(uuid)','EXECUTE'), 'unbound browser mutations retired');
SELECT sim.ok(fn_lightning_legacy_leave_requires_reload(sim.h(),sim.t(),:'occupancy'), 'cached room client must refresh before touching the matching occupancy');
SELECT sim.ok(NOT fn_lightning_legacy_leave_requires_reload(sim.h(),sim.t(),gen_random_uuid()), 'other occupancies unaffected');
SELECT sim.ok(fn_lightning_stop_room_playing(sim.c(),:'room') @> '{"ok":true,"exited":true}', 'room-bound stop closes the idle session');
SELECT fn_lightning_my_session(sim.c()) AS closed \gset
SELECT sim.ok(:'closed'::jsonb @> jsonb_build_object('pool_session_id',null,'seat_table_id',sim.t())
  AND NOT (:'closed'::jsonb ? 'seat_number'), 'old tab retains table navigation without fallback cashout coordinates');
SELECT sim.ok(fn_lightning_stopped_leave_anchor(sim.c(),:'room',:'occupancy') @> jsonb_build_object('occupancy_id',:'occupancy'::uuid), 'scoped client still finds original seat after close');
SELECT sim.ok(fn_lightning_resume_room_playing(sim.c(),:'room') @> '{"ok":false,"reason":"EXITED"}', 'a genuinely closed session cannot resume');
SELECT sim.reset(40);
SELECT id AS live_room FROM lightning_pool_session WHERE player_id=sim.h() \gset
SELECT occupancy_id AS live_seat FROM table_seats WHERE user_id=sim.h() \gset
SELECT sim.ok(fn_lightning_resume_room_playing(sim.c(),:'live_room') @> '{"ok":true}', 'eligible player can stay before confirming a blind-off');
SELECT set_config('test.engine','true',false);
SELECT sim.ok(fn_lightning_request_room_departure(:'live_room',sim.h(),sim.t(),1,:'live_seat',true) @> '{"ok":true,"blind_off":true}', 'room owner accepts confirmed blind-off');
SELECT sim.durable_room_state() AS committed \gset
SELECT sim.ok(fn_lightning_resume_room_playing(sim.c(),:'live_room') @> '{"ok":false,"reason":"LEAVE_CONFIRMED"}'
  AND sim.durable_room_state() = :'committed'::jsonb, 'a stale Stay cannot undo or conceal confirmed blind-off');
SELECT 'RETIRED_ROOM_LEAVE_POSTGRES_PASS';
