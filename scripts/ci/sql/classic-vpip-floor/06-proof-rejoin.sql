\set ON_ERROR_STOP on
-- T13-T16 use the Classic nlh game, table and player built by 04-proof-window.

-- T13: LEAVING AND REJOINING IS NOT AN ESCAPE HATCH. A player one hand from
-- the boot stands up and sits straight back down. Inside the platform's
-- re-entry window that is the SAME sitting: the sample, the open warning and
-- the hands left in its grace all survive.
DO $$
DECLARE s record; n int; w_before timestamptz; w_after timestamptz;
BEGIN
  DELETE FROM public.ca_hand_facts;
  DELETE FROM public.ca_nit_warnings;
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
         now() - ((30 - i) * interval '1 minute'), false FROM generate_series(1,30) i;
  PERFORM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');   -- warned
  SELECT warned_at INTO w_before FROM public.ca_nit_warnings WHERE cleared_at IS NULL;
  IF w_before IS NULL THEN RAISE EXCEPTION 'T13a no warning was opened'; END IF;

  -- Leave and return one minute later: chair closed and reopened, roster row
  -- closed and reopened, well inside the two-hour window.
  UPDATE public.table_seats SET left_at = now() WHERE table_id='22222222-2222-2222-2222-222222222222';
  UPDATE public.cash_game_roster SET left_at = now()
   WHERE game_id='11111111-1111-1111-1111-111111111111' AND left_at IS NULL;
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
    VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',1, now());
  INSERT INTO public.cash_game_roster (game_id, user_id, joined_at)
    VALUES ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333', now());

  SELECT * INTO s FROM public.fn_nit_status('22222222-2222-2222-2222-222222222222');
  IF s.hands <> 30 THEN RAISE EXCEPTION 'T13b a rejoin reset the sample to % hands', s.hands; END IF;
  IF NOT s.warned THEN RAISE EXCEPTION 'T13c a rejoin cleared the warning'; END IF;
  IF s.grace_remaining <> 10 THEN RAISE EXCEPTION 'T13d grace became %', s.grace_remaining; END IF;
  SELECT warned_at INTO w_after FROM public.ca_nit_warnings WHERE cleared_at IS NULL;
  IF w_after <> w_before THEN RAISE EXCEPTION 'T13e a second warning was opened'; END IF;
  SELECT count(*) INTO n FROM public.ca_nit_warnings;
  IF n <> 1 THEN RAISE EXCEPTION 'T13f % warning rows exist for one lapse', n; END IF;
  RAISE NOTICE 'T13 PASS  leaving and rejoining keeps the sample, the warning and the grace';
END $$;

-- T14: AND THE GRACE STILL RUNS OUT ACROSS THE REJOIN. Ten dealt hands after
-- the warning, wherever they were played, and the seat goes.
DO $$
DECLARE r record;
BEGIN
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
         now() + (i * interval '1 second'), false FROM generate_series(1,10) i;
  SELECT * INTO r FROM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  IF r.user_id IS NULL THEN RAISE EXCEPTION 'T14 the rejoined seat escaped the boot'; END IF;
  RAISE NOTICE 'T14 PASS  grace still expires across a rejoin, and the seat goes';
END $$;

-- T15: AN ABSENCE LONGER THAN THE WINDOW IS A GENUINELY NEW SITTING. Same
-- player, back after three hours: a clean sample and no warning, which is the
-- platform's own re-entry rule and not a punishment of this rule's invention.
DO $$
DECLARE s record;
BEGIN
  DELETE FROM public.ca_hand_facts;
  DELETE FROM public.ca_nit_warnings;
  DELETE FROM public.cash_game_roster;
  DELETE FROM public.table_seats WHERE table_id='22222222-2222-2222-2222-222222222222';
  -- An old sitting that ended three hours ago, and a fresh one now.
  INSERT INTO public.cash_game_roster (game_id, user_id, joined_at, left_at) VALUES
    ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333',
     now() - interval '5 hours', now() - interval '3 hours');
  INSERT INTO public.cash_game_roster (game_id, user_id, joined_at) VALUES
    ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333', now() - interval '20 minutes');
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
    VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',1, now() - interval '20 minutes');
  -- Thirty tight hands in the OLD sitting, none in the new one.
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
         now() - interval '4 hours' + (i * interval '1 minute'), false FROM generate_series(1,30) i;
  SELECT * INTO s FROM public.fn_nit_status('22222222-2222-2222-2222-222222222222');
  IF s.hands <> 0 THEN RAISE EXCEPTION 'T15 a three-hour absence carried % old hands forward', s.hands; END IF;
  RAISE NOTICE 'T15 PASS  an absence beyond the re-entry window starts a clean sitting';
END $$;

-- T16: A MOVE BETWEEN TABLES OF THE SAME GAME KEEPS EVERYTHING. The roster row
-- does not close on a must-move, so the sample spans both chairs and the
-- warning follows the player.
DO $$
DECLARE s record; t2 uuid := '99999999-9999-9999-9999-999999999999';
BEGIN
  DELETE FROM public.ca_hand_facts;
  DELETE FROM public.ca_nit_warnings;
  DELETE FROM public.cash_game_roster;
  DELETE FROM public.table_seats;
  INSERT INTO public.cash_game_roster (game_id, user_id, joined_at)
    VALUES ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333', now() - interval '1 hour');
  INSERT INTO public.tables (id, cluster_id, name, game_variant, big_blind, nit_game,
                             maintain_percent_min, maintain_hands)
    VALUES (t2,'11111111-1111-1111-1111-111111111111','NLH 0.50/1 Classic 2','nlh',1.0,true,20,30)
    ON CONFLICT (id) DO NOTHING;
  -- Fifteen hands at the first chair, fifteen at the second.
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
         now() - interval '50 minutes' + (i * interval '1 minute'), false FROM generate_series(1,15) i;
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333', t2,
         now() - interval '20 minutes' + (i * interval '1 minute'), false FROM generate_series(1,15) i;
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
    VALUES (t2,'33333333-3333-3333-3333-333333333333',3, now() - interval '20 minutes');
  SELECT * INTO s FROM public.fn_nit_status(t2);
  IF s.hands <> 30 THEN RAISE EXCEPTION 'T16a the move lost hands: % of 30', s.hands; END IF;
  PERFORM public.fn_nit_enforce(t2);
  IF NOT EXISTS (SELECT 1 FROM public.ca_nit_warnings
                  WHERE game_id='11111111-1111-1111-1111-111111111111' AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'T16b the warning is not keyed on the game';
  END IF;
  SELECT * INTO s FROM public.fn_nit_status('22222222-2222-2222-2222-222222222222');
  RAISE NOTICE 'T16 PASS  a move inside the game keeps the window and carries the warning';
END $$;
