\set ON_ERROR_STOP on
-- Fixtures: one Classic nlh game at 1.00 BB, one table in it, one player.
DO $$
DECLARE g uuid := '11111111-1111-1111-1111-111111111111';
        t uuid := '22222222-2222-2222-2222-222222222222';
        u uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  INSERT INTO public.profiles (id, username) VALUES (u, 'hero');
  INSERT INTO public.cash_games (id, template_name, variant, sb, bb, ruleset_snapshot)
    VALUES (g, 'classic', 'nlh', 0.5, 1.0, '{}'::jsonb);
  -- Simulate the propagators (fn_cash_cluster_open_table / fn_cash_apply_ruleset),
  -- which derive these three from the snapshot the trigger just wrote.
  INSERT INTO public.tables (id, cluster_id, name, game_variant, big_blind, nit_game,
                             maintain_percent_min, maintain_hands)
    SELECT t, g, 'NLH 0.50/1 Classic', 'nlh', 1.0,
           (gg.ruleset_snapshot->>'vpip_floor')::int > 0,
           (gg.ruleset_snapshot->>'vpip_floor')::int,
           (gg.ruleset_snapshot->>'vpip_window')::int
      FROM public.cash_games gg WHERE gg.id = g;
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
    VALUES (t, u, 1, now() - interval '2 hours');
  INSERT INTO public.cash_game_roster (game_id, user_id, joined_at)
    VALUES (g, u, now() - interval '2 hours');
  -- The floor was turned on two hours ago so the sample can reach the hands below.
  UPDATE public.cash_games SET ruleset_snapshot =
    ruleset_snapshot || jsonb_build_object('vpip_floor_since', to_jsonb(now() - interval '3 hours'))
   WHERE id = g;
END $$;

-- T0: the snapshot carries the policy, and the table inherited it.
DO $$
DECLARE s jsonb; pol record;
BEGIN
  SELECT ruleset_snapshot INTO s FROM public.cash_games WHERE id='11111111-1111-1111-1111-111111111111';
  IF (s->>'vpip_floor')::int <> 20 THEN RAISE EXCEPTION 'T0 floor: got %', s->>'vpip_floor'; END IF;
  IF (s->>'vpip_window')::int <> 30 THEN RAISE EXCEPTION 'T0 window: got %', s->>'vpip_window'; END IF;
  IF (s->>'vpip_rolling')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'T0 rolling not set'; END IF;
  IF (s->>'vpip_grace_hands')::int <> 10 THEN RAISE EXCEPTION 'T0 grace: got %', s->>'vpip_grace_hands'; END IF;
  SELECT * INTO pol FROM public.fn_nit_policy('22222222-2222-2222-2222-222222222222');
  IF NOT (pol.nit_on AND pol.floor_pct=20 AND pol.window_hands=30 AND pol.rolling AND pol.grace_hands=10)
    THEN RAISE EXCEPTION 'T0 policy: %', pol; END IF;
  RAISE NOTICE 'T0 PASS  policy reaches the table from the snapshot';
END $$;

-- Helper: replace the player's hand history with n hands, v of them voluntary.
CREATE OR REPLACE FUNCTION pg_temp.hands(n int, v int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.ca_hand_facts;
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
         now() - ((n - i) * interval '1 minute'), i <= v
    FROM generate_series(1, n) i;
END $$;

-- T1: EXACTLY 30. 29 hands cannot be judged; 30 can.
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.hands(29, 0);
  v := public.fn_nit_check('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', now() - interval '2 hours');
  IF v->>'reason' <> 'within_limits' THEN RAISE EXCEPTION 'T1a 29 hands judged: %', v; END IF;
  PERFORM pg_temp.hands(30, 0);
  v := public.fn_nit_check('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', now() - interval '2 hours');
  IF v->>'reason' <> 'maintain_vpip' OR (v->>'hands')::int <> 30 THEN RAISE EXCEPTION 'T1b 30 hands not judged: %', v; END IF;
  RAISE NOTICE 'T1 PASS  29 hands is not judged, 30 is';
END $$;

-- T2: THRESHOLD BOUNDARY. 6/30 = 20.0 is AT the floor and safe; 5/30 = 16.7 is under.
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.hands(30, 6);
  v := public.fn_nit_check('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', now() - interval '2 hours');
  IF v->>'reason' <> 'within_limits' THEN RAISE EXCEPTION 'T2a 20.0%% booted: %', v; END IF;
  PERFORM pg_temp.hands(30, 5);
  v := public.fn_nit_check('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', now() - interval '2 hours');
  IF v->>'reason' <> 'maintain_vpip' OR (v->>'vpip')::numeric <> 16.7 THEN RAISE EXCEPTION 'T2b 16.7%% not caught: %', v; END IF;
  RAISE NOTICE 'T2 PASS  at the floor is safe, below it is not';
END $$;

-- T3: ROLLING. 100 hands, the first 70 loose and the last 30 tight: the rolling
-- window must judge the recent 30 and catch it. Cumulative would not.
DO $$
DECLARE v jsonb; s record;
BEGIN
  DELETE FROM public.ca_hand_facts;
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
         now() - ((100 - i) * interval '1 minute'), i <= 70
    FROM generate_series(1,100) i;
  SELECT * INTO s FROM public.fn_nit_sample('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333', now() - interval '3 hours', true, 30);
  IF s.hands <> 30 OR s.vpip <> 0.0 THEN RAISE EXCEPTION 'T3a rolling sample wrong: % / %', s.hands, s.vpip; END IF;
  SELECT * INTO s FROM public.fn_nit_sample('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333', now() - interval '3 hours', false, 30);
  IF s.hands <> 100 OR s.vpip <> 70.0 THEN RAISE EXCEPTION 'T3b cumulative sample wrong: % / %', s.hands, s.vpip; END IF;
  RAISE NOTICE 'T3 PASS  rolling judges the last 30 (0.0%%), cumulative all 100 (70.0%%)';
END $$;
