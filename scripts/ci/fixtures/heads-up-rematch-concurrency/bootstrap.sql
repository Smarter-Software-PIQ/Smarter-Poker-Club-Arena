-- Fixture for scripts/ci/test-heads-up-rematch-concurrency-postgres.py.
--
-- The rematch core and its two browser doors are installed from the merged
-- migration text and checked against the md5 of the production definitions.
-- Everything below is the minimum world they read. The seat purchases and the
-- game creation door are stand-ins that keep the contract the core depends
-- on: a purchase charges the named payer once, locks the payer's wallet row,
-- refuses an empty wallet with ok=false, answers already_seated on a repeat
-- and writes one ledger row. The production purchase layers themselves were
-- probed on production in rolled-back transactions (docs/changelog/
-- 2026-11-08-heads-up-rematch.md). This fixture tests the part a probe cannot:
-- what the core does when independent sessions call it at the same moment.

-- The anon, authenticated and service_role roles are created by the test's
-- cluster administrator before this file runs.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Knobs the controller sets to widen race windows and to interrupt a purchase.
CREATE TABLE public.fixture_knobs (name text PRIMARY KEY, value text NOT NULL);
CREATE FUNCTION public.fixture_knob(p_name text) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT value FROM public.fixture_knobs WHERE name = p_name $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_horse boolean NOT NULL DEFAULT false);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  ended_at timestamptz,
  club_id uuid,
  union_id uuid,
  buy_in_amount numeric,
  buy_in_fee numeric,
  game_type text,
  variant text,
  format_contract text,
  max_players integer,
  satellite_target_id uuid,
  satellite_target text,
  free_buy boolean NOT NULL DEFAULT false,
  name text,
  tournament_type text,
  guaranteed_prize numeric,
  starting_chips integer,
  min_players integer,
  table_size integer,
  blind_structure jsonb,
  payout_structure jsonb,
  late_reg_levels integer,
  late_reg_mins integer,
  satellite_seats integer,
  short_description text,
  is_bounty boolean NOT NULL DEFAULT false,
  is_pko boolean NOT NULL DEFAULT false,
  is_mystery_bounty boolean NOT NULL DEFAULT false,
  bounty_amount numeric,
  created_by_rematch boolean NOT NULL DEFAULT false
);

CREATE TABLE public.tournament_players (
  tournament_id uuid NOT NULL,
  user_id uuid NOT NULL,
  position integer,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE public.tables (id uuid PRIMARY KEY, tournament_id uuid NOT NULL);

CREATE TABLE public.table_seats (
  table_id uuid NOT NULL,
  user_id uuid NOT NULL,
  seat_number integer NOT NULL,
  left_at timestamptz,
  UNIQUE (table_id, seat_number),
  UNIQUE (table_id, user_id)
);

CREATE TABLE public.club_members (
  club_id uuid NOT NULL,
  user_id uuid NOT NULL,
  chip_balance numeric NOT NULL CHECK (chip_balance >= 0),
  PRIMARY KEY (club_id, user_id)
);

-- One row per charge. txid proves which transaction committed it.
CREATE TABLE public.fixture_charges (
  id bigserial PRIMARY KEY,
  payer uuid NOT NULL,
  tournament_id uuid NOT NULL,
  amount numeric NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (payer, tournament_id)
);

CREATE FUNCTION public.fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(public.fixture_knob('frozen') = 'true', false) $$;
CREATE FUNCTION public.fn_daily_window_entry_refusal(p_tournament_id uuid) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT public.fixture_knob('daily_window_refusal') $$;
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(public.fixture_knob('session_dead_for') IS DISTINCT FROM auth.uid()::text, true) $$;
CREATE FUNCTION public.fn_ca_tournament_unit_cents(p_tournament_id uuid) RETURNS integer LANGUAGE sql STABLE AS
$$ SELECT 100 $$;

-- The drift interlock reads the md5 of each source layer. One stand-in layer.
CREATE FUNCTION public.fixture_source_layer() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;

-- The creation door: idempotent on its id, creates a REGISTERING copy.
CREATE FUNCTION public.fn_create_seat_first_game_atomic(p_tournament_id uuid, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_table uuid := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament_id) THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true,
      'table_id', (SELECT id FROM public.tables WHERE tournament_id = p_tournament_id));
  END IF;
  PERFORM pg_sleep(COALESCE(public.fixture_knob('create_delay')::numeric, 0));
  INSERT INTO public.tournaments (id, status, club_id, union_id, buy_in_amount, buy_in_fee,
    game_type, variant, format_contract, max_players, name, tournament_type, guaranteed_prize,
    starting_chips, min_players, table_size, blind_structure, payout_structure,
    satellite_target_id, created_by_rematch)
  VALUES (p_tournament_id, 'REGISTERING', (p_config->>'club_id')::uuid, (p_config->>'union_id')::uuid,
    (p_config->>'buy_in_amount')::numeric, (p_config->>'buy_in_fee')::numeric,
    p_config->>'game_type', p_config->>'variant', 'sng-v1', (p_config->>'max_players')::integer,
    p_config->>'name', p_config->>'tournament_type', (p_config->>'guaranteed_prize')::numeric,
    (p_config->>'starting_chips')::integer, (p_config->>'min_players')::integer,
    (p_config->>'table_size')::integer, '[{"level":1}]'::jsonb, p_config->'payout_structure',
    (p_config->>'satellite_target_id')::uuid, true);
  INSERT INTO public.tables (id, tournament_id) VALUES (v_table, p_tournament_id);
  RETURN jsonb_build_object('ok', true, 'table_id', v_table);
END $$;

CREATE FUNCTION public.fixture_charge(p_table uuid, p_seat integer, p_payer uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_cost numeric;
  v_left numeric;
BEGIN
  SELECT t.* INTO v_t FROM public.tournaments t JOIN public.tables tb ON tb.tournament_id = t.id
   WHERE tb.id = p_table;
  IF EXISTS (SELECT 1 FROM public.table_seats WHERE table_id = p_table AND user_id = p_payer AND left_at IS NULL) THEN
    RETURN jsonb_build_object('ok', true, 'already_seated', true);
  END IF;
  IF public.fixture_knob('seat_delay_for') = p_payer::text THEN
    PERFORM pg_sleep(COALESCE(public.fixture_knob('seat_delay')::numeric, 0));
  END IF;
  PERFORM pg_sleep(COALESCE(public.fixture_knob('seat_delay_all')::numeric, 0));
  v_cost := v_t.buy_in_amount + v_t.buy_in_fee;
  SELECT chip_balance INTO v_left FROM public.club_members
   WHERE club_id = v_t.club_id AND user_id = p_payer FOR UPDATE;
  IF v_left IS NULL OR v_left < v_cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance');
  END IF;
  UPDATE public.club_members SET chip_balance = chip_balance - v_cost
   WHERE club_id = v_t.club_id AND user_id = p_payer;
  INSERT INTO public.fixture_charges (payer, tournament_id, amount) VALUES (p_payer, v_t.id, v_cost);
  IF p_seat IS NULL THEN
    SELECT s INTO p_seat FROM generate_series(1, 2) s
     WHERE NOT EXISTS (SELECT 1 FROM public.table_seats WHERE table_id = p_table AND seat_number = s)
     ORDER BY s LIMIT 1;
  END IF;
  INSERT INTO public.table_seats (table_id, user_id, seat_number) VALUES (p_table, p_payer, p_seat);
  RETURN jsonb_build_object('ok', true, 'seat_number', p_seat, 'cost', v_cost, 'asset', 'chips');
END $$;

-- A person's purchase for a named payer (stand-in for the derived copy).
CREATE FUNCTION public.fn_ca_rematch_take_seat_for_payer(p_table_id uuid, p_seat_number integer, p_payer uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.fixture_charge(p_table_id, p_seat_number, p_payer) $$;

-- A horse's own seat door: it takes the free seat.
CREATE FUNCTION public.fn_seat_horse_in_seat_first_game(p_tournament_id uuid, p_horse_id uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.fixture_charge((SELECT id FROM public.tables WHERE tournament_id = p_tournament_id), NULL, p_horse_id)
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fixture_knob(text) TO authenticated;
