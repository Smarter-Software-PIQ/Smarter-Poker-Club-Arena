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
CREATE FUNCTION pg_temp.seated(t uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.table_seats WHERE table_id = t AND left_at IS NULL $$;
CREATE FUNCTION pg_temp.feeder() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.tables WHERE role = 'feeder' AND lifecycle <> 'closed' LIMIT 1 $$;
CREATE FUNCTION pg_temp.ftm() RETURNS uuid[] LANGUAGE sql AS $$ SELECT coalesce(first_to_move, '{}') FROM public.cash_cluster_feeder_starts $$;
-- A cash-out with chips, as production writes it: the exit row and left_at in one transaction.
CREATE FUNCTION pg_temp.cash_out(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ca_seat_stack_exits (table_id, user_id, stack)
    SELECT table_id, user_id, stack FROM public.table_seats WHERE user_id = p AND left_at IS NULL AND coalesce(stack, 0) > 0;
  UPDATE public.table_seats SET left_at = clock_timestamp() WHERE user_id = p AND left_at IS NULL;
END $$;
-- A direct sit-down at the feeder (fresh buy-in), with no tick in between.
CREATE FUNCTION pg_temp.sit_feeder(p uuid, s int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at) VALUES (pg_temp.feeder(), p, s, clock_timestamp()) $$;

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
SELECT pg_temp.feeder(), pg_temp.u(100 + i), 4 + i, now() - interval '5 hours' FROM generate_series(1, 2) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
SELECT pg_temp.check('D0 both bumped players start first to move', pg_temp.ftm() @> ARRAY[pg_temp.u(8), pg_temp.u(9)]);
-- E1. A bumped player on the feeder BUSTS and rebuys without leaving: keeps priority.
UPDATE public.table_seats SET stack = 0 WHERE user_id = pg_temp.u(9) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
UPDATE public.table_seats SET stack = 100 WHERE user_id = pg_temp.u(9) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
SELECT pg_temp.check('E1 a bumped player who busts and rebuys on the feeder keeps priority', pg_temp.u(9) = ANY (pg_temp.ftm()));
-- E2. The other bumped player cashes out of the feeder and sits back down before a tick: leaving the game ends it.
SELECT pg_temp.cash_out(pg_temp.u(8));
SELECT pg_temp.sit_feeder(pg_temp.u(8), 9);
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
SELECT pg_temp.check('E2 cashed out of the feeder and back before a tick: priority gone', NOT (pg_temp.u(8) = ANY (pg_temp.ftm())));
SELECT pg_temp.check('E3 the player who stayed keeps priority', pg_temp.u(9) = ANY (pg_temp.ftm()));
-- E4. A Main leave now moves the one still entitled.
SELECT pg_temp.cash_out(pg_temp.u(1));
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL;
SELECT pg_temp.check('E4 the Main chair goes to the bumped player who stayed',
  (SELECT player_id FROM public.cash_seat_moves WHERE state = 'pending') = pg_temp.u(9));
