\set ON_ERROR_STOP 1
CREATE FUNCTION pg_temp.exec_moves() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE m record; n integer := 0; v_seat integer;
BEGIN
  FOR m IN SELECT * FROM public.cash_seat_moves WHERE state = 'pending' ORDER BY created_at LOOP
    SELECT gs INTO v_seat FROM generate_series(1, 9) gs
     WHERE NOT EXISTS (SELECT 1 FROM public.table_seats ts WHERE ts.table_id = m.to_table_id AND ts.seat_number = gs AND ts.left_at IS NULL)
     ORDER BY gs LIMIT 1;
    UPDATE public.table_seats SET left_at = clock_timestamp() WHERE table_id = m.from_table_id AND user_id = m.player_id AND left_at IS NULL;
    INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at) VALUES (m.to_table_id, m.player_id, v_seat, now() - interval '1 hour');
    UPDATE public.cash_seat_moves SET state = 'done', executed_at = clock_timestamp() WHERE id = m.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
CREATE FUNCTION pg_temp.u(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.check(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, label; END $$;
INSERT INTO public.cash_games (id, name, handedness) VALUES (pg_temp.u(1000), 'NLH 0.50/1', 9);
INSERT INTO public.tables (id, cluster_id, role, main_index, lifecycle, max_players, name, created_at)
  VALUES (pg_temp.u(2000), pg_temp.u(1000), 'main', 1, 'live', 9, 'NLH 0.50/1', now() - interval '1 day');
INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
SELECT pg_temp.u(2000), pg_temp.u(i), i, now() - interval '3 hours' + i * interval '1 minute' FROM generate_series(1, 9) i;
INSERT INTO public.cash_game_waitlist (game_id, user_id, status) SELECT pg_temp.u(1000), pg_temp.u(100 + i), 'waiting' FROM generate_series(1, 4) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;   -- bump p9, p8
SELECT pg_temp.exec_moves();
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;   -- feeder live
INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
SELECT (SELECT id FROM public.tables WHERE role = 'feeder'), pg_temp.u(100 + i), 4 + i, now() - interval '5 hours' FROM generate_series(1, 2) i;
-- Main leave: a bumped player returns (feeder 4 < 7).
UPDATE public.table_seats SET left_at = now() WHERE user_id = pg_temp.u(1) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
SELECT pg_temp.check('R1 a bumped player returns on a Main leave with the feeder under 7',
  (SELECT player_id FROM public.cash_seat_moves WHERE state = 'pending') IN (pg_temp.u(8), pg_temp.u(9)));
CREATE TEMP TABLE returned AS SELECT player_id FROM public.cash_seat_moves WHERE state = 'pending';
SELECT pg_temp.exec_moves();
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
SELECT pg_temp.check('R2 the returned player is no longer first to move',
  NOT (ARRAY[(SELECT player_id FROM returned)] <@ (SELECT first_to_move FROM public.cash_cluster_feeder_starts)));
SELECT pg_temp.check('R3 the bumped player still on the feeder keeps priority',
  cardinality((SELECT first_to_move FROM public.cash_cluster_feeder_starts)) = 1);
-- The production case: the returned player cashes out of Main and buys into the feeder.
UPDATE public.table_seats SET left_at = now() WHERE user_id = (SELECT player_id FROM returned) AND left_at IS NULL;
INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
  VALUES ((SELECT id FROM public.tables WHERE role = 'feeder'), (SELECT player_id FROM returned), 8, now());
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
SELECT pg_temp.check('R4 the vacated Main chair goes to the bumped player still waiting, not the rejoiner',
  (SELECT player_id FROM public.cash_seat_moves WHERE state = 'pending') IN (pg_temp.u(8), pg_temp.u(9))
  AND (SELECT player_id FROM public.cash_seat_moves WHERE state = 'pending') <> (SELECT player_id FROM returned));
SELECT pg_temp.exec_moves();
-- Another Main leave with no bumped player waiting and the feeder under 7: the rejoiner does NOT jump the gate.
UPDATE public.table_seats SET left_at = now() WHERE user_id = pg_temp.u(2) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
SELECT pg_temp.check('R5 a returned-then-rejoined player waits for the seven-player gate like anyone else',
  NOT EXISTS (SELECT 1 FROM public.cash_seat_moves WHERE state = 'pending'));
