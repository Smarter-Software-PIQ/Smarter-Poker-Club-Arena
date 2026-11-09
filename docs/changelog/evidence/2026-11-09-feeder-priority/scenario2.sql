\set ON_ERROR_STOP 1
-- Focused acceptance tests for the two remaining questions.
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
CREATE FUNCTION pg_temp.u(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.seated(t uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.table_seats WHERE table_id = t AND left_at IS NULL $$;
CREATE FUNCTION pg_temp.check(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, label; END $$;

-- ===== A/B. Nine-handed: bumped players return on a LEAVE and on a BUST, feeder under 7 =====
INSERT INTO public.cash_games (id, name, handedness) VALUES (pg_temp.u(1000), 'NLH 1/2', 9);
INSERT INTO public.tables (id, cluster_id, role, main_index, lifecycle, max_players, name, created_at)
  VALUES (pg_temp.u(2000), pg_temp.u(1000), 'main', 1, 'live', 9, 'NLH 1/2', now() - interval '1 day');
INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
SELECT pg_temp.u(2000), pg_temp.u(i), i, now() - interval '3 hours' + i * interval '1 minute' FROM generate_series(1, 9) i;
INSERT INTO public.cash_game_waitlist (game_id, user_id, status) SELECT pg_temp.u(1000), pg_temp.u(100 + i), 'waiting' FROM generate_series(1, 4) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL AS tick;           -- feeder start, bump p9 + p8
SELECT pg_temp.exec_moves() AS bumped;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL AS tick;           -- feeder live
-- Two list players sit at the feeder (feeder = 4: p8, p9 + 2); a longer-seated feeder player exists.
INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
SELECT (SELECT id FROM public.tables WHERE role = 'feeder'), pg_temp.u(100 + i), 4 + i, now() - interval '5 hours' FROM generate_series(1, 2) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL AS tick;
SELECT pg_temp.check('A0 nothing moves while Main 7 + 2 held, feeder 4',
  NOT EXISTS (SELECT 1 FROM public.cash_seat_moves WHERE state = 'pending'));

-- A. A Main player LEAVES (p1). Feeder has 4 (< 7). A bumped player must go first, ahead of the
--    two list players who have been seated longer.
UPDATE public.table_seats SET left_at = now() WHERE user_id = pg_temp.u(1) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL AS tick;
SELECT pg_temp.check('A1 exactly one move planned after a Main leave',
  (SELECT count(*) FROM public.cash_seat_moves WHERE state = 'pending') = 1);
SELECT pg_temp.check('A2 the mover is a bumped player (p9 or p8), not a longer-seated list player',
  (SELECT player_id FROM public.cash_seat_moves WHERE state = 'pending') IN (pg_temp.u(8), pg_temp.u(9)));
SELECT pg_temp.exec_moves() AS moved;

-- B. A Main player BUSTS (p2: stack 0, still in the rebuy window). The chair is still theirs,
--    so nothing moves yet.
UPDATE public.table_seats SET stack = 0 WHERE user_id = pg_temp.u(2) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL AS tick;
SELECT pg_temp.check('B1 a busted player in the rebuy window keeps the chair (no move yet)',
  NOT EXISTS (SELECT 1 FROM public.cash_seat_moves WHERE state = 'pending'));
-- The busted player does not rebuy and leaves: the remaining bumped player takes the chair at once.
UPDATE public.table_seats SET left_at = now() WHERE user_id = pg_temp.u(2) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL AS tick;
SELECT pg_temp.check('B2 after the bust-out leaves, the other bumped player moves (feeder still under 7)',
  (SELECT player_id FROM public.cash_seat_moves WHERE state = 'pending') IN (pg_temp.u(8), pg_temp.u(9))
  AND (SELECT count(*) FROM public.cash_seat_moves WHERE state = 'pending') = 1
  AND pg_temp.seated((SELECT id FROM public.tables WHERE role = 'feeder')) < 7);
SELECT pg_temp.exec_moves() AS moved;
SELECT pg_temp.check('B3 both bumped players are back on Main, held chairs still held (2)',
  (SELECT count(*) FROM public.table_seats WHERE table_id = pg_temp.u(2000) AND left_at IS NULL AND user_id IN (pg_temp.u(8), pg_temp.u(9))) = 2
  AND (SELECT held FROM public.cash_cluster_feeder_starts) = 2);
-- Another Main player leaves: no bumped player left, feeder 2 (< 7): nobody moves.
UPDATE public.table_seats SET left_at = now() WHERE user_id = pg_temp.u(3) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(1000), 0) IS NOT NULL AS tick;
SELECT pg_temp.check('B4 with no bumped player on the feeder and feeder under 7, nobody moves',
  NOT EXISTS (SELECT 1 FROM public.cash_seat_moves WHERE state = 'pending'));

-- ===== C. 6-max: two waiting players start the feeder, nobody bumped, live with exactly two =====
INSERT INTO public.cash_games (id, name, handedness) VALUES (pg_temp.u(3000), 'PLO 6max', 6);
INSERT INTO public.tables (id, cluster_id, role, main_index, lifecycle, max_players, name)
  VALUES (pg_temp.u(4000), pg_temp.u(3000), 'main', 1, 'live', 6, 'PLO 6max');
INSERT INTO public.table_seats (table_id, user_id, seat_number) SELECT pg_temp.u(4000), pg_temp.u(500 + i), i FROM generate_series(1, 6) i;
INSERT INTO public.cash_game_waitlist (game_id, user_id, status) SELECT pg_temp.u(3000), pg_temp.u(600 + i), 'waiting' FROM generate_series(1, 2) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(3000), 0) IS NOT NULL AS tick;   -- no horses counted: list only
SELECT pg_temp.check('C1 two waiting players open the 6-max feeder',
  EXISTS (SELECT 1 FROM public.tables WHERE cluster_id = pg_temp.u(3000) AND role = 'feeder' AND lifecycle = 'opening'));
SELECT pg_temp.check('C2 nobody bumped off the 6-max Main, no feeder-start row',
  NOT EXISTS (SELECT 1 FROM public.cash_seat_moves WHERE game_id = pg_temp.u(3000))
  AND NOT EXISTS (SELECT 1 FROM public.cash_cluster_feeder_starts WHERE game_id = pg_temp.u(3000))
  AND pg_temp.seated(pg_temp.u(4000)) = 6);
SELECT pg_temp.check('C3 the 6-max Main is not a list-only chair (rule is full ring only)',
  NOT public.fn_cash_main_chair_is_the_lists(pg_temp.u(4000)));
-- The two list players sit.
INSERT INTO public.table_seats (table_id, user_id, seat_number)
SELECT (SELECT id FROM public.tables WHERE cluster_id = pg_temp.u(3000) AND role = 'feeder'), pg_temp.u(600 + i), i FROM generate_series(1, 2) i;
SELECT public.fn_cash_cluster_tick(pg_temp.u(3000), 0) IS NOT NULL AS tick;
SELECT pg_temp.check('C4 the 6-max feeder goes live with exactly two seated (heads-up start)',
  EXISTS (SELECT 1 FROM public.tables WHERE cluster_id = pg_temp.u(3000) AND role = 'feeder' AND lifecycle = 'live')
  AND pg_temp.seated((SELECT id FROM public.tables WHERE cluster_id = pg_temp.u(3000) AND role = 'feeder')) = 2);
-- A Main seat opens: the first on the 6-max list moves (existing priority, no 7-gate on 6-max).
UPDATE public.table_seats SET left_at = now() WHERE user_id = pg_temp.u(501) AND left_at IS NULL;
SELECT public.fn_cash_cluster_tick(pg_temp.u(3000), 0) IS NOT NULL AS tick;
SELECT pg_temp.check('C5 6-max: an open Main seat is filled from the feeder at once (no gate)',
  (SELECT count(*) FROM public.cash_seat_moves WHERE game_id = pg_temp.u(3000) AND state = 'pending' AND reason = 'must_move') = 1);
