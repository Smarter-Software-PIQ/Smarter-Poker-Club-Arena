\set ON_ERROR_STOP on
\set T '22222222-2222-2222-2222-222222222222'
\set G '11111111-1111-1111-1111-111111111111'
\set U '33333333-3333-3333-3333-333333333333'

CREATE OR REPLACE FUNCTION pg_temp.reset_hands(n int, v int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.ca_hand_facts;
  DELETE FROM public.ca_nit_warnings;
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
         now() - ((n - i) * interval '1 minute'), i <= v
    FROM generate_series(1, n) i;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.add_hands(n int, v int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
         now() + (i * interval '1 second'), i <= v
    FROM generate_series(1, n) i;
END $$;

-- T4: WARN, DO NOT BOOT. First lapse opens exactly one warning and evicts nobody.
DO $$
DECLARE n int; w int;
BEGIN
  PERFORM pg_temp.reset_hands(30, 0);
  SELECT count(*) INTO n FROM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  IF n <> 0 THEN RAISE EXCEPTION 'T4a first lapse evicted % seats', n; END IF;
  SELECT count(*) INTO w FROM public.ca_nit_warnings WHERE cleared_at IS NULL;
  IF w <> 1 THEN RAISE EXCEPTION 'T4b warnings open: %', w; END IF;
  -- A second boundary with no new hands must not warn again or boot.
  SELECT count(*) INTO n FROM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  IF n <> 0 THEN RAISE EXCEPTION 'T4c second boundary evicted inside grace'; END IF;
  SELECT count(*) INTO w FROM public.ca_nit_warnings WHERE cleared_at IS NULL;
  IF w <> 1 THEN RAISE EXCEPTION 'T4d double warned: %', w; END IF;
  RAISE NOTICE 'T4 PASS  first lapse warns once, boots nobody';
END $$;

-- T5: RECOVERY clears the warning, and a later lapse earns a FRESH full grace.
DO $$
DECLARE w record; n int; gr int;
BEGIN
  PERFORM pg_temp.reset_hands(30, 0);
  PERFORM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  -- Play 30 loose hands: the rolling 30 is now 100% and the seat has recovered.
  PERFORM pg_temp.add_hands(30, 30);
  PERFORM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  SELECT count(*) INTO n FROM public.ca_nit_warnings WHERE cleared_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'T5a recovery left a warning open'; END IF;
  SELECT cleared_reason INTO w FROM public.ca_nit_warnings ORDER BY id DESC LIMIT 1;
  IF w.cleared_reason <> 'recovered' THEN RAISE EXCEPTION 'T5b reason: %', w.cleared_reason; END IF;
  -- Lapse again: a brand new warning with the FULL grace, not a shortened one.
  PERFORM pg_temp.add_hands(30, 0);
  PERFORM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  SELECT grace_hands INTO gr FROM public.ca_nit_warnings WHERE cleared_at IS NULL;
  IF gr <> 10 THEN RAISE EXCEPTION 'T5c fresh grace is %, expected 10', gr; END IF;
  RAISE NOTICE 'T5 PASS  recovery clears; a later lapse gets a full fresh grace';
END $$;

-- T6: INSIDE GRACE no boot; AT grace expiry, boot once.
DO $$
DECLARE n int; r record;
BEGIN
  PERFORM pg_temp.reset_hands(30, 0);
  PERFORM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');  -- warn
  PERFORM pg_temp.add_hands(9, 0);                                        -- 9 of 10 spent
  SELECT count(*) INTO n FROM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  IF n <> 0 THEN RAISE EXCEPTION 'T6a booted at 9 of 10 grace hands'; END IF;
  PERFORM pg_temp.add_hands(1, 0);                                        -- 10th hand
  SELECT * INTO r FROM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  IF r.user_id IS NULL THEN RAISE EXCEPTION 'T6b did not boot at grace expiry'; END IF;
  IF r.required <> 20 THEN RAISE EXCEPTION 'T6c required %', r.required; END IF;
  -- And the SAME lapse cannot boot twice: the row is closed.
  SELECT count(*) INTO n FROM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  IF n <> 0 THEN RAISE EXCEPTION 'T6d booted the same lapse twice'; END IF;
  RAISE NOTICE 'T6 PASS  no boot at 9 of 10, boot at 10, never twice for one lapse';
END $$;

-- T7: CONCURRENT BOUNDARIES. Two enforcement passes racing on one expired grace
-- must yield exactly one eviction between them.
DO $$
DECLARE a int; b int;
BEGIN
  PERFORM pg_temp.reset_hands(30, 0);
  PERFORM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  PERFORM pg_temp.add_hands(10, 0);
  SELECT count(*) INTO a FROM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  SELECT count(*) INTO b FROM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  IF a + b <> 1 THEN RAISE EXCEPTION 'T7 two passes produced % evictions', a + b; END IF;
  RAISE NOTICE 'T7 PASS  two passes over one expired grace evict exactly once';
END $$;

-- T8: FORCED BLINDS ARE NOT VOLUNTARY. 30 hands in which the only participation
-- is posted blinds (vpip false, as deriveFlowFlags records them) is 0%, not 100%.
DO $$
DECLARE s record;
BEGIN
  PERFORM pg_temp.reset_hands(30, 0);
  SELECT * INTO s FROM public.fn_nit_sample('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333', now() - interval '3 hours', true, 30);
  IF s.hands <> 30 OR s.vpip <> 0.0 THEN RAISE EXCEPTION 'T8 blind-only read as % over %', s.vpip, s.hands; END IF;
  RAISE NOTICE 'T8 PASS  blind-only hands count as dealt but never as voluntary';
END $$;

-- T9: RECONNECT. The chair closes and reopens; the roster row does not. The
-- window, the warning and the grace all survive.
DO $$
DECLARE s record; w int;
BEGIN
  PERFORM pg_temp.reset_hands(30, 0);
  PERFORM public.fn_nit_enforce('22222222-2222-2222-2222-222222222222');
  UPDATE public.table_seats SET left_at = now() WHERE table_id='22222222-2222-2222-2222-222222222222';
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
    VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', 1, now());
  SELECT * INTO s FROM public.fn_nit_status('22222222-2222-2222-2222-222222222222');
  IF s.hands <> 30 THEN RAISE EXCEPTION 'T9a reconnect reset the window to %', s.hands; END IF;
  IF NOT s.warned THEN RAISE EXCEPTION 'T9b reconnect lost the warning'; END IF;
  IF s.grace_remaining <> 10 THEN RAISE EXCEPTION 'T9c grace remaining %', s.grace_remaining; END IF;
  RAISE NOTICE 'T9 PASS  a reconnect keeps the window, the warning and the grace';
END $$;

-- T10: ACTION / MADNESS UNCHANGED. No rolling key, grace 0, window 10, and a
-- seat under the floor is returned for eviction on the spot, as today.
DO $$
DECLARE g2 uuid := '44444444-4444-4444-4444-444444444444';
        t2 uuid := '55555555-5555-5555-5555-555555555555';
        u2 uuid := '66666666-6666-6666-6666-666666666666';
        pol record; s jsonb; n int;
BEGIN
  INSERT INTO public.profiles (id, username) VALUES (u2, 'madnesshero');
  INSERT INTO public.cash_games (id, template_name, variant, sb, bb, ruleset_snapshot)
    VALUES (g2, 'madness', 'nlh', 1, 2, '{}'::jsonb);
  SELECT ruleset_snapshot INTO s FROM public.cash_games WHERE id = g2;
  IF s ? 'vpip_rolling' THEN RAISE EXCEPTION 'T10a madness snapshot carries vpip_rolling'; END IF;
  IF (s->>'vpip_floor')::int <> 40 THEN RAISE EXCEPTION 'T10b madness floor changed to %', s->>'vpip_floor'; END IF;
  IF (s->>'vpip_window')::int <> 10 THEN RAISE EXCEPTION 'T10c madness window changed to %', s->>'vpip_window'; END IF;
  INSERT INTO public.tables (id, cluster_id, name, game_variant, big_blind, nit_game, maintain_percent_min, maintain_hands)
    VALUES (t2, g2, 'NLH 1/2 Madness', 'nlh', 2, true, 40, 10);
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at) VALUES (t2, u2, 1, now() - interval '1 hour');
  INSERT INTO public.cash_game_roster (game_id, user_id, joined_at) VALUES (g2, u2, now() - interval '1 hour');
  SELECT * INTO pol FROM public.fn_nit_policy(t2);
  IF pol.rolling OR pol.grace_hands <> 0 OR pol.window_hands <> 10 THEN RAISE EXCEPTION 'T10d madness policy: %', pol; END IF;
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT u2, t2, now() - ((12 - i) * interval '1 minute'), false FROM generate_series(1,12) i;
  SELECT count(*) INTO n FROM public.fn_nit_enforce(t2);
  IF n <> 1 THEN RAISE EXCEPTION 'T10e madness did not boot on the spot: % evictions', n; END IF;
  IF EXISTS (SELECT 1 FROM public.ca_nit_warnings WHERE table_id = t2) THEN
    RAISE EXCEPTION 'T10f madness opened a warning'; END IF;
  RAISE NOTICE 'T10 PASS  Action/Madness keep window 10, no grace, boot on the spot';
END $$;

-- T11: A sub-threshold BB game is untouched. Classic nlh at 0.50 BB is below
-- the configured minimum, so it carries no floor at all.
DO $$
DECLARE g3 uuid := '77777777-7777-7777-7777-777777777777'; s jsonb;
BEGIN
  INSERT INTO public.cash_games (id, template_name, variant, sb, bb, ruleset_snapshot)
    VALUES (g3, 'classic', 'nlh', 0.25, 0.5, '{}'::jsonb);
  SELECT ruleset_snapshot INTO s FROM public.cash_games WHERE id = g3;
  IF (s->>'vpip_floor')::int <> 0 THEN RAISE EXCEPTION 'T11a 0.25/0.50 got floor %', s->>'vpip_floor'; END IF;
  IF s ? 'vpip_rolling' THEN RAISE EXCEPTION 'T11b 0.25/0.50 got rolling'; END IF;
  RAISE NOTICE 'T11 PASS  Classic below 0.50/1.00 carries no floor';
END $$;

-- T12: plo5 keeps the stronger existing 50, never lowered to a config row.
DO $$
DECLARE g4 uuid := '88888888-8888-8888-8888-888888888888'; s jsonb;
BEGIN
  INSERT INTO public.cash_games (id, template_name, variant, sb, bb, ruleset_snapshot)
    VALUES (g4, 'classic', 'plo5', 1, 2, '{"rules_profile":"madness_without_lightning"}'::jsonb);
  SELECT ruleset_snapshot INTO s FROM public.cash_games WHERE id = g4;
  IF (s->>'vpip_floor')::int <> 50 THEN RAISE EXCEPTION 'T12 plo5 floor became %', s->>'vpip_floor'; END IF;
  RAISE NOTICE 'T12 PASS  the stronger existing plo5 floor of 50 is preserved';
END $$;
