\set ON_ERROR_STOP on
-- Lightning-format games and the relation that records a game leaving
-- Lightning, built on top of the Classic floor chain (fixtures 01-03, 07 and
-- migrations 20261111003710, 20261111022301, 20261111093132), BEFORE the
-- switch-off migration is applied, so 11-baseline can record the old answers.
--
-- cash_cluster_conversion carries the production columns this rule reads and
-- the production close-is-complete CHECK.
CREATE TABLE public.cash_cluster_conversion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL,
  from_mode text NOT NULL,
  to_mode text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','committed','aborted')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  epoch_before integer NOT NULL DEFAULT 1,
  epoch_after integer,
  abort_reason text,
  CONSTRAINT cash_cluster_conversion_close_is_complete CHECK (
    (status = 'pending' AND closed_at IS NULL AND epoch_after IS NULL AND abort_reason IS NULL)
 OR (status = 'committed' AND closed_at IS NOT NULL AND epoch_after IS NOT NULL AND abort_reason IS NULL)
 OR (status = 'aborted' AND closed_at IS NOT NULL AND epoch_after IS NULL AND abort_reason IS NOT NULL)));
GRANT SELECT ON public.cash_cluster_conversion TO service_role;

-- One clock for every file: each psql run is its own session with its own now().
CREATE TABLE public.proof_clock (base timestamptz NOT NULL, off_at timestamptz NOT NULL);
INSERT INTO public.proof_clock VALUES (now(), now() - interval '10 minutes');

CREATE TABLE public.proof_baseline (k text PRIMARY KEY, v text);

-- n dealt hands for one player on one table, the first n_vpip of them entered.
CREATE FUNCTION public.proof_hands(p_user uuid, p_table uuid, p_n int, p_vpip int,
                                   p_from timestamptz, p_step interval)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.ca_hand_facts (user_id, table_id, played_at, vpip)
  SELECT p_user, p_table, p_from + (i * p_step), i <= p_vpip
    FROM generate_series(1, p_n) i;
$f$;

-- A seated player: profile, chair and roster row.
CREATE FUNCTION public.proof_seat(p_user uuid, p_horse boolean, p_game uuid, p_table uuid,
                                  p_joined timestamptz)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.profiles (id, username, is_horse)
    VALUES (p_user, 'p' || left(p_user::text, 8), p_horse) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
    VALUES (p_table, p_user, 1, p_joined);
  INSERT INTO public.cash_game_roster (game_id, user_id, joined_at) VALUES (p_game, p_user, p_joined);
$f$;

-- A Lightning-format game with one anchor table, judged the Lightning way:
-- 25%, ten hands, whole sitting; p_grace > 0 configures a warning and grace.
CREATE FUNCTION public.proof_lightning_game(p_game uuid, p_table uuid, p_grace int)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.cash_games (id, club_id, template_name, variant, sb, bb, lightning_enabled, ruleset_snapshot)
    VALUES (p_game, 'aaaa0000-0000-0000-0000-000000000001', 'madness', 'nlh', 1, 2, true, '{}'::jsonb);
  IF p_grace > 0 THEN
    UPDATE public.cash_games
       SET ruleset_snapshot = ruleset_snapshot || jsonb_build_object('vpip_grace_hands', p_grace)
     WHERE id = p_game;
  END IF;
  INSERT INTO public.tables (id, cluster_id, club_id, name, game_variant, big_blind, nit_game,
                             maintain_percent_min, maintain_hands)
    VALUES (p_table, p_game, 'aaaa0000-0000-0000-0000-000000000001', 'Lightning ' || left(p_game::text, 4),
            'nlh', 2, true, 25, 10);
END $f$;

-- A committed conversion closed at p_at (the game left or entered Lightning).
CREATE FUNCTION public.proof_convert(p_game uuid, p_from text, p_to text, p_at timestamptz)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.cash_cluster_conversion (cluster_id, from_mode, to_mode, status, opened_at, closed_at, epoch_after)
    VALUES (p_game, p_from, p_to, 'committed', p_at - interval '5 seconds', p_at, 2);
$f$;

DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.proof_clock;

  -- L1: the 2026-11-21 08:47:56 shape. Lightning on 2h05m ago, a Horse and a
  -- person each play 200 pool hands at 20%, the game leaves Lightning.
  PERFORM public.proof_lightning_game('e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 0);
  PERFORM public.proof_convert('e1000000-0000-0000-0000-000000000001', 'must_move', 'lightning', c.base - interval '125 minutes');
  PERFORM public.proof_seat('e1a00000-0000-0000-0000-000000000001', true,  'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', c.base - interval '2 hours');
  PERFORM public.proof_seat('e1b00000-0000-0000-0000-000000000001', false, 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', c.base - interval '2 hours');
  -- and a second pair who will play ordinary hands at 30% after the switch-off
  PERFORM public.proof_seat('e1a00000-0000-0000-0000-000000000003', true,  'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', c.base - interval '2 hours');
  PERFORM public.proof_seat('e1b00000-0000-0000-0000-000000000003', false, 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', c.base - interval '2 hours');
  PERFORM public.proof_hands(u, 'e1100000-0000-0000-0000-000000000001', 200, 40, c.base - interval '2 hours', interval '30 seconds')
     FROM unnest(ARRAY['e1a00000-0000-0000-0000-000000000001','e1b00000-0000-0000-0000-000000000001',
                       'e1a00000-0000-0000-0000-000000000003','e1b00000-0000-0000-0000-000000000003']::uuid[]) u;
  PERFORM public.proof_convert('e1000000-0000-0000-0000-000000000001', 'lightning', 'must_move', c.off_at);

  -- L2: the same, on a game whose table rule carries a warning and ten hands of grace.
  PERFORM public.proof_lightning_game('e2000000-0000-0000-0000-000000000002', 'e2100000-0000-0000-0000-000000000002', 10);
  PERFORM public.proof_convert('e2000000-0000-0000-0000-000000000002', 'must_move', 'lightning', c.base - interval '125 minutes');
  PERFORM public.proof_seat('e2a00000-0000-0000-0000-000000000002', true,  'e2000000-0000-0000-0000-000000000002', 'e2100000-0000-0000-0000-000000000002', c.base - interval '2 hours');
  PERFORM public.proof_seat('e2b00000-0000-0000-0000-000000000002', false, 'e2000000-0000-0000-0000-000000000002', 'e2100000-0000-0000-0000-000000000002', c.base - interval '2 hours');
  PERFORM public.proof_hands(u, 'e2100000-0000-0000-0000-000000000002', 200, 40, c.base - interval '2 hours', interval '30 seconds')
     FROM unnest(ARRAY['e2a00000-0000-0000-0000-000000000002','e2b00000-0000-0000-0000-000000000002']::uuid[]) u;
  PERFORM public.proof_convert('e2000000-0000-0000-0000-000000000002', 'lightning', 'must_move', c.off_at);

  -- L3: on, off, ordinary hands, on again, a second pool at 0%, off again.
  PERFORM public.proof_lightning_game('e3000000-0000-0000-0000-000000000003', 'e3100000-0000-0000-0000-000000000003', 0);
  PERFORM public.proof_seat('e3a00000-0000-0000-0000-000000000003', true,  'e3000000-0000-0000-0000-000000000003', 'e3100000-0000-0000-0000-000000000003', c.base - interval '2 hours');
  PERFORM public.proof_seat('e3b00000-0000-0000-0000-000000000003', false, 'e3000000-0000-0000-0000-000000000003', 'e3100000-0000-0000-0000-000000000003', c.base - interval '2 hours');
  PERFORM public.proof_convert('e3000000-0000-0000-0000-000000000003', 'must_move', 'lightning', c.base - interval '119 minutes');
  PERFORM public.proof_hands(u, 'e3100000-0000-0000-0000-000000000003', 50, 5, c.base - interval '118 minutes', interval '30 seconds')
     FROM unnest(ARRAY['e3a00000-0000-0000-0000-000000000003','e3b00000-0000-0000-0000-000000000003']::uuid[]) u;
  PERFORM public.proof_convert('e3000000-0000-0000-0000-000000000003', 'lightning', 'must_move', c.base - interval '90 minutes');
  PERFORM public.proof_hands(u, 'e3100000-0000-0000-0000-000000000003', 10, 5, c.base - interval '89 minutes', interval '30 seconds')
     FROM unnest(ARRAY['e3a00000-0000-0000-0000-000000000003','e3b00000-0000-0000-0000-000000000003']::uuid[]) u;
  PERFORM public.proof_convert('e3000000-0000-0000-0000-000000000003', 'must_move', 'lightning', c.base - interval '80 minutes');
  PERFORM public.proof_hands(u, 'e3100000-0000-0000-0000-000000000003', 60, 0, c.base - interval '79 minutes', interval '30 seconds')
     FROM unnest(ARRAY['e3a00000-0000-0000-0000-000000000003','e3b00000-0000-0000-0000-000000000003']::uuid[]) u;
  PERFORM public.proof_convert('e3000000-0000-0000-0000-000000000003', 'lightning', 'must_move', c.off_at);

  -- L4: a switch-off still pending (the drain). L5: a switch-off that aborted.
  PERFORM public.proof_lightning_game('e4000000-0000-0000-0000-000000000004', 'e4100000-0000-0000-0000-000000000004', 0);
  PERFORM public.proof_convert('e4000000-0000-0000-0000-000000000004', 'must_move', 'lightning', c.base - interval '125 minutes');
  PERFORM public.proof_seat('e4a00000-0000-0000-0000-000000000004', true, 'e4000000-0000-0000-0000-000000000004', 'e4100000-0000-0000-0000-000000000004', c.base - interval '2 hours');
  PERFORM public.proof_hands('e4a00000-0000-0000-0000-000000000004', 'e4100000-0000-0000-0000-000000000004', 100, 10, c.base - interval '2 hours', interval '30 seconds');
  INSERT INTO public.cash_cluster_conversion (cluster_id, from_mode, to_mode, status, opened_at)
    VALUES ('e4000000-0000-0000-0000-000000000004', 'draining', 'must_move', 'pending', c.off_at);

  PERFORM public.proof_lightning_game('e5000000-0000-0000-0000-000000000005', 'e5100000-0000-0000-0000-000000000005', 0);
  PERFORM public.proof_convert('e5000000-0000-0000-0000-000000000005', 'must_move', 'lightning', c.base - interval '125 minutes');
  PERFORM public.proof_seat('e5a00000-0000-0000-0000-000000000005', true, 'e5000000-0000-0000-0000-000000000005', 'e5100000-0000-0000-0000-000000000005', c.base - interval '2 hours');
  INSERT INTO public.cash_cluster_conversion (cluster_id, from_mode, to_mode, status, opened_at, closed_at, abort_reason)
    VALUES ('e5000000-0000-0000-0000-000000000005', 'lightning', 'must_move', 'aborted', c.off_at - interval '5 seconds', c.off_at, 'population_recovered');

  -- L6: a warning opened on ORDINARY hands before Lightning came on; pool
  -- hands then pass the grace count; the game leaves Lightning.
  PERFORM public.proof_lightning_game('e6000000-0000-0000-0000-000000000006', 'e6100000-0000-0000-0000-000000000006', 10);
  PERFORM public.proof_seat('e6a00000-0000-0000-0000-000000000006', true,  'e6000000-0000-0000-0000-000000000006', 'e6100000-0000-0000-0000-000000000006', c.base - interval '2 hours');
  PERFORM public.proof_seat('e6b00000-0000-0000-0000-000000000006', false, 'e6000000-0000-0000-0000-000000000006', 'e6100000-0000-0000-0000-000000000006', c.base - interval '2 hours');
  PERFORM public.proof_hands(u, 'e6100000-0000-0000-0000-000000000006', 10, 0, c.base - interval '119 minutes', interval '30 seconds')
     FROM unnest(ARRAY['e6a00000-0000-0000-0000-000000000006','e6b00000-0000-0000-0000-000000000006']::uuid[]) u;
  INSERT INTO public.ca_nit_warnings (game_id, table_id, user_id, sitting_since, required, vpip_at_warn, hands_at_warn, grace_hands, warned_at)
  SELECT 'e6000000-0000-0000-0000-000000000006', 'e6100000-0000-0000-0000-000000000006', u,
         c.base - interval '2 hours', 25, 0, 10, 10, c.base - interval '114 minutes'
    FROM unnest(ARRAY['e6a00000-0000-0000-0000-000000000006','e6b00000-0000-0000-0000-000000000006']::uuid[]) u;
  PERFORM public.proof_convert('e6000000-0000-0000-0000-000000000006', 'must_move', 'lightning', c.base - interval '113 minutes');
  PERFORM public.proof_hands(u, 'e6100000-0000-0000-0000-000000000006', 40, 8, c.base - interval '112 minutes', interval '30 seconds')
     FROM unnest(ARRAY['e6a00000-0000-0000-0000-000000000006','e6b00000-0000-0000-0000-000000000006']::uuid[]) u;
  PERFORM public.proof_convert('e6000000-0000-0000-0000-000000000006', 'lightning', 'must_move', c.off_at);

  -- L7: the anchor_seat_left shape. A Horse and a person leave the pool
  -- (chair and roster closed) after 150 pool hands at 20%, the game leaves
  -- Lightning, and they sit back down inside the two-hour re-entry window.
  PERFORM public.proof_lightning_game('e7000000-0000-0000-0000-000000000007', 'e7100000-0000-0000-0000-000000000007', 0);
  PERFORM public.proof_convert('e7000000-0000-0000-0000-000000000007', 'must_move', 'lightning', c.base - interval '125 minutes');
  PERFORM public.proof_seat(u, u::text LIKE 'e7a%', 'e7000000-0000-0000-0000-000000000007', 'e7100000-0000-0000-0000-000000000007', c.base - interval '2 hours')
     FROM unnest(ARRAY['e7a00000-0000-0000-0000-000000000007','e7b00000-0000-0000-0000-000000000007']::uuid[]) u;
  PERFORM public.proof_hands(u, 'e7100000-0000-0000-0000-000000000007', 150, 30, c.base - interval '2 hours', interval '30 seconds')
     FROM unnest(ARRAY['e7a00000-0000-0000-0000-000000000007','e7b00000-0000-0000-0000-000000000007']::uuid[]) u;
  UPDATE public.table_seats SET left_at = c.off_at - interval '3 minutes' WHERE table_id = 'e7100000-0000-0000-0000-000000000007';
  UPDATE public.cash_game_roster SET left_at = c.off_at - interval '3 minutes' WHERE game_id = 'e7000000-0000-0000-0000-000000000007';
  PERFORM public.proof_convert('e7000000-0000-0000-0000-000000000007', 'lightning', 'must_move', c.off_at);
  INSERT INTO public.table_seats (table_id, user_id, seat_number, joined_at)
  SELECT 'e7100000-0000-0000-0000-000000000007', u, 2, c.off_at + interval '2 minutes'
    FROM unnest(ARRAY['e7a00000-0000-0000-0000-000000000007','e7b00000-0000-0000-0000-000000000007']::uuid[]) u;
  INSERT INTO public.cash_game_roster (game_id, user_id, joined_at)
  SELECT 'e7000000-0000-0000-0000-000000000007', u, c.off_at + interval '2 minutes'
    FROM unnest(ARRAY['e7a00000-0000-0000-0000-000000000007','e7b00000-0000-0000-0000-000000000007']::uuid[]) u;

  -- N1: a Lightning-format game that has never run Lightning (no conversion
  -- row at all): 40%, ten hands. One player under, one over.
  INSERT INTO public.cash_games (id, club_id, template_name, variant, sb, bb, ruleset_snapshot)
    VALUES ('ee000000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-000000000001', 'madness', 'nlh', 1, 2, '{}'::jsonb);
  INSERT INTO public.tables (id, cluster_id, club_id, name, game_variant, big_blind, nit_game, maintain_percent_min, maintain_hands)
    VALUES ('ee100000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-000000000001', 'Madness N1', 'nlh', 2, true, 40, 10);
  PERFORM public.proof_seat('eea00000-0000-0000-0000-00000000000a', true,  'ee000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-00000000000a', c.base - interval '2 hours');
  PERFORM public.proof_seat('eeb00000-0000-0000-0000-00000000000a', false, 'ee000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-00000000000a', c.base - interval '2 hours');
  PERFORM public.proof_hands('eea00000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-00000000000a', 30, 20, c.base - interval '100 minutes', interval '1 minute');
  PERFORM public.proof_hands('eeb00000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-00000000000a', 30, 2,  c.base - interval '100 minutes', interval '1 minute');

  -- C1: a Classic game on the rolling 30/10 floor (20%, 30 hands, 10 grace).
  INSERT INTO public.cash_games (id, club_id, template_name, variant, sb, bb, ruleset_snapshot)
    VALUES ('ec000000-0000-0000-0000-00000000000c', 'aaaa0000-0000-0000-0000-000000000001', 'classic', 'nlh', 0.5, 1.0, '{}'::jsonb);
  UPDATE public.cash_games SET ruleset_snapshot = ruleset_snapshot
    || jsonb_build_object('vpip_floor_since', to_jsonb(c.base - interval '3 hours'))
   WHERE id = 'ec000000-0000-0000-0000-00000000000c';
  INSERT INTO public.tables (id, cluster_id, club_id, name, game_variant, big_blind, nit_game, maintain_percent_min, maintain_hands)
  SELECT 'ec100000-0000-0000-0000-00000000000c', g.id, g.club_id, 'Classic C1', 'nlh', 1.0, true,
         (g.ruleset_snapshot->>'vpip_floor')::int, (g.ruleset_snapshot->>'vpip_window')::int
    FROM public.cash_games g WHERE g.id = 'ec000000-0000-0000-0000-00000000000c';
  PERFORM public.proof_seat('eca00000-0000-0000-0000-00000000000c', true,  'ec000000-0000-0000-0000-00000000000c', 'ec100000-0000-0000-0000-00000000000c', c.base - interval '2 hours');
  PERFORM public.proof_seat('ecb00000-0000-0000-0000-00000000000c', false, 'ec000000-0000-0000-0000-00000000000c', 'ec100000-0000-0000-0000-00000000000c', c.base - interval '2 hours');
  PERFORM public.proof_hands('eca00000-0000-0000-0000-00000000000c', 'ec100000-0000-0000-0000-00000000000c', 35, 20, c.base - interval '100 minutes', interval '1 minute');
  PERFORM public.proof_hands('ecb00000-0000-0000-0000-00000000000c', 'ec100000-0000-0000-0000-00000000000c', 35, 5,  c.base - interval '100 minutes', interval '1 minute');
END $$;

-- The fixtures say what they claim to.
DO $$
DECLARE pol record;
BEGIN
  SELECT * INTO pol FROM public.fn_nit_policy('e1100000-0000-0000-0000-000000000001');
  IF NOT (pol.nit_on AND pol.floor_pct = 25 AND pol.window_hands = 10 AND NOT pol.rolling AND pol.grace_hands = 0) THEN
    RAISE EXCEPTION 'fixture L1 policy is %', pol; END IF;
  SELECT * INTO pol FROM public.fn_nit_policy('e2100000-0000-0000-0000-000000000002');
  IF NOT (pol.nit_on AND pol.floor_pct = 25 AND pol.window_hands = 10 AND pol.grace_hands = 10) THEN
    RAISE EXCEPTION 'fixture L2 policy is %', pol; END IF;
  SELECT * INTO pol FROM public.fn_nit_policy('ec100000-0000-0000-0000-00000000000c');
  IF NOT (pol.nit_on AND pol.floor_pct = 20 AND pol.window_hands = 30 AND pol.rolling AND pol.grace_hands = 10) THEN
    RAISE EXCEPTION 'fixture C1 policy is %', pol; END IF;
END $$;

-- Production's grants on the window function (read 2026-11-21:
-- {postgres=X/postgres,service_role=X/postgres}). The chain above leaves the
-- default PUBLIC execute, which the migration's install-time assertion refuses.
REVOKE ALL ON FUNCTION public.fn_nit_sitting_since(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nit_sitting_since(uuid, uuid, timestamptz) TO service_role;
