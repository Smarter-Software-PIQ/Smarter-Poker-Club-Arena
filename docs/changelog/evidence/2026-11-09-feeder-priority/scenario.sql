\set ON_ERROR_STOP 1
-- Executes every pending move the way fn_cash_seat_move_execute does for a
-- landed move: the chair moves, the move is done.
CREATE FUNCTION pg_temp.exec_moves() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE m record; n integer := 0; v_seat integer;
BEGIN
  FOR m IN SELECT * FROM public.cash_seat_moves WHERE state = 'pending' ORDER BY created_at LOOP
    SELECT gs INTO v_seat FROM generate_series(1, 9) gs
     WHERE NOT EXISTS (SELECT 1 FROM public.table_seats ts WHERE ts.table_id = m.to_table_id AND ts.seat_number = gs AND ts.left_at IS NULL)
     ORDER BY gs LIMIT 1;
    UPDATE public.table_seats SET left_at = clock_timestamp() WHERE table_id = m.from_table_id AND user_id = m.player_id AND left_at IS NULL;
    INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
      VALUES (m.to_table_id, m.player_id, v_seat, now() - interval '1 hour');
    UPDATE public.cash_seat_moves SET state = 'done', executed_at = clock_timestamp() WHERE id = m.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
CREATE FUNCTION pg_temp.board() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(coalesce(tb.role,'?') || ':' || tb.lifecycle || '=' ||
           (SELECT count(*) FROM public.table_seats ts WHERE ts.table_id = tb.id AND ts.left_at IS NULL)
           || ' open_seats=' || public.fn_cash_game_open_seats(tb.id), ' | ' ORDER BY tb.created_at)
         || ' || held=' || coalesce((SELECT held::text FROM public.cash_cluster_feeder_starts), 'none')
         || ' pending=' || (SELECT count(*) FROM public.cash_seat_moves WHERE state = 'pending')
    FROM public.tables tb WHERE tb.lifecycle <> 'closed';
$$;
CREATE FUNCTION pg_temp.u(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- A nine-handed game, Main 1 full. p1..p9 sat in that order.
INSERT INTO public.cash_games (id, name, handedness) VALUES (pg_temp.u(1000), 'NLH 1/2', 9);
INSERT INTO public.tables (id, cluster_id, role, main_index, lifecycle, max_players, name, created_at)
  VALUES (pg_temp.u(2000), pg_temp.u(1000), 'main', 1, 'live', 9, 'NLH 1/2', now() - interval '1 day');
INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
SELECT pg_temp.u(2000), pg_temp.u(i), i, now() - interval '3 hours' + i * interval '1 minute' FROM generate_series(1, 9) i;

\echo '--- 3 on the list: nothing opens (full ring needs four)'
INSERT INTO public.cash_game_waitlist (game_id, user_id, status) SELECT pg_temp.u(1000), pg_temp.u(100 + i), 'waiting' FROM generate_series(1, 3) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT pg_temp.board();

\echo '--- 4th joins the list: feeder opens, last two to sit (p9, p8) are bumped'
INSERT INTO public.cash_game_waitlist (game_id, user_id, status) VALUES (pg_temp.u(1000), pg_temp.u(104), 'waiting');
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT player_id, reason FROM public.cash_seat_moves ORDER BY player_id;
SELECT pg_temp.board();

\echo '--- the bump lands; main 7, its two chairs held, feeder goes live'
SELECT pg_temp.exec_moves();
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT pg_temp.board();

\echo '--- the four from the list sit at the feeder: feeder 6, still nothing moves'
INSERT INTO public.table_seats (table_id, user_id, seat_number)
SELECT (SELECT id FROM public.tables WHERE role = 'feeder'), pg_temp.u(100 + i), 2 + i FROM generate_series(1, 4) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT pg_temp.board();

\echo '--- a direct buy-in at Main 1 is refused (held chair / list chair)'
DO $$ BEGIN
  PERFORM public.atomic_table_buyin_before_maintenance_announcement_gate(pg_temp.u(999), pg_temp.u(2000), 8, 100, false, NULL, NULL);
  RAISE NOTICE 'BUYIN WAS ALLOWED (WRONG)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'buy-in refused: %', SQLERRM; END $$;

\echo '--- a 7th sits at the feeder: one chair released, the first bumped player moves up'
INSERT INTO public.table_seats (table_id, user_id, seat_number) VALUES ((SELECT id FROM public.tables WHERE role = 'feeder'), pg_temp.u(105), 8);
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT player_id, reason FROM public.cash_seat_moves WHERE state = 'pending';
SELECT pg_temp.board();
SELECT pg_temp.exec_moves();
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT pg_temp.board();

\echo '--- a Main player (p1) leaves: the other bumped player moves right away (feeder only 6)'
UPDATE public.table_seats SET left_at = now() WHERE user_id = pg_temp.u(1) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT player_id, reason FROM public.cash_seat_moves WHERE state = 'pending';
SELECT pg_temp.exec_moves();
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT pg_temp.board();

\echo '--- another Main player (p2) leaves: no bumped player left, feeder 5 < 7: nobody moves'
UPDATE public.table_seats SET left_at = now() WHERE user_id = pg_temp.u(2) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT pg_temp.board();

\echo '--- two newcomers sit at the feeder (5 -> 7): one chair released, the first on the list moves (one at a time)'
INSERT INTO public.table_seats (table_id, user_id, seat_number) VALUES ((SELECT id FROM public.tables WHERE role = 'feeder'), pg_temp.u(106), 1), ((SELECT id FROM public.tables WHERE role = 'feeder'), pg_temp.u(107), 2);
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT player_id, reason FROM public.cash_seat_moves WHERE state = 'pending';
SELECT pg_temp.board();
SELECT pg_temp.exec_moves();
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 5)->'actions';
SELECT pg_temp.board();
SELECT kind, payload FROM public.cash_cluster_events WHERE kind LIKE 'feeder_start%' ORDER BY id;

\echo '--- 6-max is unchanged: two buyers open a feeder, nobody is bumped'
INSERT INTO public.cash_games (id, name, handedness) VALUES (pg_temp.u(3000), 'PLO 6max', 6);
INSERT INTO public.tables (id, cluster_id, role, main_index, lifecycle, max_players, name)
  VALUES (pg_temp.u(4000), pg_temp.u(3000), 'main', 1, 'live', 6, 'PLO 6max');
INSERT INTO public.table_seats (table_id, user_id, seat_number) SELECT pg_temp.u(4000), pg_temp.u(500 + i), i FROM generate_series(1, 6) i;
INSERT INTO public.cash_game_waitlist (game_id, user_id, status) SELECT pg_temp.u(3000), pg_temp.u(600 + i), 'waiting' FROM generate_series(1, 2) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(3000), 0)->'actions';
SELECT count(*) AS six_max_moves FROM public.cash_seat_moves WHERE game_id = pg_temp.u(3000);
