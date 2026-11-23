-- Minimal stand-ins for the production objects the private game hold
-- migrations call or read. The migrations themselves are installed UNCHANGED
-- from supabase/migrations by scripts/ci/test-private-game-holds-postgres.py.
-- The stand-in doors keep the shape that matters here: every entry writes a
-- tournament_players row (so the entry guard sees it), a refused door rolls
-- its own purchase back, and the seat door charges a wallet.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                  NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                  NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text, display_name text, is_horse boolean NOT NULL DEFAULT false);
CREATE TABLE public.wallets_fixture (user_id uuid PRIMARY KEY, balance numeric NOT NULL);
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY, club_id uuid, union_id uuid, name text NOT NULL, game_type text NOT NULL,
  variant text, tournament_type text, buy_in_amount numeric(15,2) NOT NULL, buy_in_fee numeric(15,2) NOT NULL,
  guaranteed_prize numeric(15,2), starting_chips integer, max_players integer NOT NULL, min_players integer,
  table_size integer NOT NULL, current_players integer, status text NOT NULL, blind_structure text,
  payout_structure text, start_time timestamptz NOT NULL, late_reg_levels integer, late_reg_mins integer,
  satellite_target_id uuid, satellite_target uuid, satellite_seats integer, short_description text,
  format_contract text, started_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.tables (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, max_players integer,
  status text NOT NULL DEFAULT 'waiting', created_at timestamptz DEFAULT now());
CREATE TABLE public.tournament_players (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL,
  user_id uuid NOT NULL, status text, chips integer, table_id uuid, seat_number integer,
  UNIQUE (tournament_id, user_id));
CREATE TABLE public.table_seats (table_id uuid NOT NULL, seat_number integer NOT NULL, user_id uuid,
  left_at timestamptz, joined_at timestamptz DEFAULT now(), PRIMARY KEY (table_id, seat_number));
CREATE TABLE public.engine_maintenance_thaws (freeze_started_at timestamptz PRIMARY KEY, frozen_seconds numeric NOT NULL);
CREATE TABLE public.engine_maintenance_break (id boolean PRIMARY KEY DEFAULT true, phase text NOT NULL,
  announced_at timestamptz NOT NULL DEFAULT now(), break_started_at timestamptz);
CREATE TABLE public.ca_declared_money_triggers (table_name text, trigger_name text, note text, PRIMARY KEY (table_name, trigger_name));
CREATE TABLE public.union_clubs (union_id uuid NOT NULL, club_id uuid NOT NULL, PRIMARY KEY (union_id, club_id));
CREATE TABLE public.fixture_knobs (name text PRIMARY KEY, value text);

CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.fn_daily_window_entry_refusal(p_tournament_id uuid, p_at timestamptz DEFAULT clock_timestamp())
RETURNS text LANGUAGE sql STABLE AS $$ SELECT value FROM public.fixture_knobs WHERE name = 'window' $$;
CREATE FUNCTION public.fn_tournament_primary_table(p_tournament_id uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.tables WHERE tournament_id = p_tournament_id AND status <> 'closed' ORDER BY created_at, id LIMIT 1 $$;

CREATE FUNCTION public.fn_create_seat_first_game_atomic(p_tournament_id uuid, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.tournaments%ROWTYPE; v_table uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.fixture_knobs WHERE name = 'create_refuses') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'platform_frozen');
  END IF;
  INSERT INTO public.tournaments (id, club_id, union_id, name, game_type, variant, tournament_type, buy_in_amount,
    buy_in_fee, guaranteed_prize, starting_chips, max_players, min_players, table_size, current_players, status,
    blind_structure, payout_structure, start_time, late_reg_levels, late_reg_mins, satellite_target_id, satellite_seats,
    short_description, format_contract)
  VALUES (p_tournament_id, (p_config->>'club_id')::uuid, NULLIF(p_config->>'union_id','')::uuid, p_config->>'name',
    p_config->>'game_type', lower(p_config->>'variant'), upper(p_config->>'tournament_type'),
    (p_config->>'buy_in_amount')::numeric, (p_config->>'buy_in_fee')::numeric,
    COALESCE(NULLIF(p_config->>'guaranteed_prize','')::numeric, 0), (p_config->>'starting_chips')::integer,
    (p_config->>'max_players')::integer, (p_config->>'min_players')::integer, (p_config->>'table_size')::integer, 0,
    'REGISTERING', (p_config->'blind_structure')::text, (p_config->'payout_structure')::text,
    (p_config->>'start_time')::timestamptz, COALESCE(NULLIF(p_config->>'late_reg_levels','')::integer,0),
    COALESCE(NULLIF(p_config->>'late_reg_mins','')::integer,0), NULLIF(p_config->>'satellite_target_id','')::uuid,
    NULLIF(p_config->>'satellite_seats','')::integer, p_config->>'short_description',
    CASE WHEN lower(COALESCE(p_config->>'variant','')) = 'spin' THEN 'spin-v1' ELSE 'sng-v1' END)
  RETURNING * INTO v;
  INSERT INTO public.tables (tournament_id, max_players) VALUES (p_tournament_id, v.max_players) RETURNING id INTO v_table;
  RETURN jsonb_build_object('ok', true, 'tournament', to_jsonb(v), 'table_id', v_table);
END $$;

-- The seat door: one entry row, one seat, one charge; a refusal anywhere rolls all three back.
CREATE FUNCTION public.fn_take_seat_and_buy_in(p_table_id uuid, p_seat_number integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_t public.tournaments%ROWTYPE; v_cost numeric;
BEGIN
  SELECT t.* INTO v_t FROM public.tournaments t JOIN public.tables tb ON tb.tournament_id = t.id WHERE tb.id = p_table_id FOR NO KEY UPDATE OF t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'table_not_found'); END IF;
  IF EXISTS (SELECT 1 FROM public.table_seats WHERE table_id = p_table_id AND seat_number = p_seat_number AND left_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'seat_taken'); END IF;
  v_cost := v_t.buy_in_amount + v_t.buy_in_fee;
  UPDATE public.wallets_fixture SET balance = balance - v_cost WHERE user_id = v_uid AND balance >= v_cost;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance'); END IF;
  INSERT INTO public.tournament_players (tournament_id, user_id, status, table_id, seat_number)
  VALUES (v_t.id, v_uid, 'registered', p_table_id, p_seat_number);
  UPDATE public.tournament_players SET status = 'playing' WHERE tournament_id = v_t.id AND user_id = v_uid;
  INSERT INTO public.table_seats (table_id, seat_number, user_id) VALUES (p_table_id, p_seat_number, v_uid)
  ON CONFLICT (table_id, seat_number) DO UPDATE SET user_id = EXCLUDED.user_id, left_at = NULL;
  RETURN jsonb_build_object('ok', true, 'table_id', p_table_id, 'seat_number', p_seat_number, 'cost', v_cost);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_take_seat_and_buy_in(uuid, integer) TO authenticated;

-- The horse door: the same entry row, written for a horse by the engine's service role.
CREATE FUNCTION public.fn_seat_horse_in_seat_first_game(p_tournament_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_table uuid; v_seat integer;
BEGIN
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;
  v_table := public.fn_tournament_primary_table(p_tournament_id);
  SELECT COALESCE(max(seat_number), 0) + 1 INTO v_seat FROM public.table_seats WHERE table_id = v_table AND left_at IS NULL;
  INSERT INTO public.tournament_players (tournament_id, user_id, status, table_id, seat_number)
  VALUES (p_tournament_id, p_user_id, 'registered', v_table, v_seat);
  INSERT INTO public.table_seats (table_id, seat_number, user_id) VALUES (v_table, v_seat, p_user_id)
  ON CONFLICT (table_id, seat_number) DO UPDATE SET user_id = EXCLUDED.user_id, left_at = NULL;
  RETURN jsonb_build_object('ok', true, 'seat_number', v_seat);
END $$;

-- ── Sit & Go registration doors (20261123071654) ────────────────────────────
-- A six or nine seat Sit & Go is a registration board: an entry is a
-- tournament_players row and nothing else until it launches. The stand-ins
-- keep the real doors' shape where it matters here: the entry boundary first,
-- the event row (FOR NO KEY UPDATE) last, a full field refused, one charge per
-- entry, and a refusal anywhere (the entry guard included) rolls the charge back.
CREATE FUNCTION public.fn_register_for_tournament_request(p_tournament_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_t public.tournaments%ROWTYPE; v_cost numeric; v_live integer; v_id uuid;
BEGIN
  IF v_uid IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'A live authenticated session is required' USING ERRCODE = '28000'; END IF;
  PERFORM pg_advisory_xact_lock_shared(530090, 1);
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); END IF;
  IF upper(v_t.status) NOT IN ('ANNOUNCED', 'REGISTERING') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'registration_closed'); END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_players WHERE tournament_id = v_t.id AND user_id = v_uid
              AND status IN ('registered', 'playing')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_registered'); END IF;
  SELECT count(*) INTO v_live FROM public.tournament_players WHERE tournament_id = v_t.id AND status IN ('registered', 'playing');
  IF v_live >= v_t.max_players THEN RETURN jsonb_build_object('ok', false, 'reason', 'tournament_full'); END IF;
  v_cost := v_t.buy_in_amount + v_t.buy_in_fee;
  UPDATE public.wallets_fixture SET balance = balance - v_cost WHERE user_id = v_uid AND balance >= v_cost;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance'); END IF;
  INSERT INTO public.tournament_players (tournament_id, user_id, status) VALUES (v_t.id, v_uid, 'registered')
  ON CONFLICT (tournament_id, user_id) DO UPDATE SET status = 'registered' RETURNING id INTO v_id;
  UPDATE public.tournaments SET current_players = v_live + 1 WHERE id = v_t.id;
  RETURN jsonb_build_object('ok', true, 'registration_id', v_id, 'request_id', p_request_id,
    'tournament_id', v_t.id, 'user_id', v_uid, 'cost', v_cost);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_register_for_tournament_request(uuid, uuid) TO authenticated;

-- The horse registration door: the same entry row, written for a horse by the engine.
CREATE FUNCTION public.fn_register_horse_for_tournament(p_tournament_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t public.tournaments%ROWTYPE; v_live integer;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(530090, 1);
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;
  SELECT count(*) INTO v_live FROM public.tournament_players WHERE tournament_id = v_t.id AND status IN ('registered', 'playing');
  IF v_live >= v_t.max_players THEN RETURN jsonb_build_object('ok', false, 'reason', 'tournament_full'); END IF;
  UPDATE public.wallets_fixture SET balance = balance - (v_t.buy_in_amount + v_t.buy_in_fee) WHERE user_id = p_user_id;
  INSERT INTO public.tournament_players (tournament_id, user_id, status) VALUES (v_t.id, p_user_id, 'registered')
  ON CONFLICT (tournament_id, user_id) DO UPDATE SET status = 'registered';
  UPDATE public.tournaments SET current_players = v_live + 1 WHERE id = v_t.id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- The unregister door: the entry leaves, the same buy-in comes back, once.
CREATE FUNCTION public.fn_unregister_from_tournament(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_t public.tournaments%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;
  UPDATE public.tournament_players SET status = 'unregistered'
   WHERE tournament_id = v_t.id AND user_id = v_uid AND status = 'registered';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_registered'); END IF;
  UPDATE public.wallets_fixture SET balance = balance + v_t.buy_in_amount + v_t.buy_in_fee WHERE user_id = v_uid;
  UPDATE public.tournaments SET current_players = current_players - 1 WHERE id = v_t.id;
  RETURN jsonb_build_object('ok', true, 'refunded', v_t.buy_in_amount + v_t.buy_in_fee);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_unregister_from_tournament(uuid) TO authenticated;

-- Exact unregister/refund authority stand-in called by fn_close_private_seat_first_match.
-- Matches live production signature (20261102154336): 5 args with p_request_id DEFAULT NULL.
CREATE FUNCTION public.fn_ca_unregister_tournament_player_exact(
  p_tournament_id uuid,
  p_user_id uuid,
  p_expected_table_id uuid DEFAULT NULL::uuid,
  p_description text DEFAULT NULL::text,
  p_request_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t public.tournaments%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); END IF;
  UPDATE public.tournament_players SET status = 'unregistered'
   WHERE tournament_id = v_t.id AND user_id = p_user_id AND status IN ('registered', 'playing');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_registered'); END IF;
  IF p_expected_table_id IS NOT NULL THEN
    UPDATE public.table_seats SET left_at = now()
     WHERE table_id = p_expected_table_id AND user_id = p_user_id AND left_at IS NULL;
  END IF;
  UPDATE public.wallets_fixture SET balance = balance + v_t.buy_in_amount + v_t.buy_in_fee WHERE user_id = p_user_id;
  UPDATE public.tournaments SET current_players = GREATEST(COALESCE(current_players, 0) - 1, 0) WHERE id = v_t.id;
  RETURN jsonb_build_object('ok', true, 'refunded', v_t.buy_in_amount + v_t.buy_in_fee, 'reason', p_description);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_unregister_tournament_player_exact(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_unregister_tournament_player_exact(uuid, uuid, uuid, text, uuid) TO service_role;
