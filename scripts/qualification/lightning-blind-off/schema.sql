-- Minimal isolated schema for the Lightning blind-off lifecycle. Only the
-- columns the installed owners read or write. Surrounding admission inputs
-- (configuration, responsible gaming, freeze, restrictions) are synthetic
-- switches; every Lightning and hit-and-run owner under test runs verbatim.
-- Roles service_role, authenticated and anon are created once per cluster by the harness.
CREATE SCHEMA auth; CREATE SCHEMA realtime; CREATE SCHEMA smarter_private; CREATE SCHEMA sim;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid', true), '')::uuid$$;
CREATE TABLE realtime.signals(payload jsonb, event text, topic text, private boolean);
CREATE FUNCTION realtime.send(jsonb, text, text, boolean) RETURNS void LANGUAGE sql AS $$INSERT INTO realtime.signals VALUES ($1, $2, $3, $4)$$;

CREATE TABLE clubs(id uuid PRIMARY KEY, hit_run_enabled boolean NOT NULL DEFAULT true, hit_run_hands integer NOT NULL DEFAULT 10);
CREATE TABLE cash_games(id uuid PRIMARY KEY, cluster_mode text, lightning_enabled boolean DEFAULT true, cluster_epoch integer DEFAULT 1);
CREATE TABLE cash_cluster_epoch(cluster_id uuid, epoch integer, ended_at timestamptz);
CREATE TABLE ca_operator_policy(restrictions_enforced boolean);
CREATE TABLE tables(id uuid PRIMARY KEY, club_id uuid, tournament_id uuid, cluster_id uuid, lifecycle text DEFAULT 'live', is_deleted boolean DEFAULT false);
CREATE TABLE table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid, seat_number integer,
  stack numeric, left_at timestamptz, is_sitting_out boolean DEFAULT false, leave_pending boolean DEFAULT false,
  occupancy_id uuid DEFAULT gen_random_uuid(), joined_at timestamptz DEFAULT now());
CREATE TABLE seat_departure_requests(occupancy_id uuid, user_id uuid, table_id uuid, seat_number integer, leave_mode text, created_at timestamptz DEFAULT now());
CREATE TABLE cash_player_session(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, scope_type text, scope_id uuid,
  table_id uuid, cluster_id uuid, baseline numeric, opened_at timestamptz DEFAULT now(), closed_at timestamptz,
  stay_remaining_ms integer DEFAULT 0, stay_running boolean DEFAULT false, stay_last_tick_at timestamptz, stay_clock_ms integer DEFAULT 600000,
  hr_hands_required integer NOT NULL DEFAULT 0, hr_hands_played integer NOT NULL DEFAULT 0, hr_reference_stack numeric,
  hr_doubles integer NOT NULL DEFAULT 0, hr_completed boolean NOT NULL DEFAULT false, hr_last_hand_ref text,
  hr_engine_ack boolean NOT NULL DEFAULT false, hr_blind_off boolean NOT NULL DEFAULT false, hr_started_at timestamptz);
CREATE TABLE lightning_pool_session(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid, cluster_epoch integer, player_id uuid,
  cash_player_session_id uuid, anchor_seat_id uuid, state text, entered_at timestamptz, starting_stack numeric, exited_at timestamptz,
  exit_reason text, stop_requested_at timestamptz, disconnected_at timestamptz, ending_stack numeric, updated_at timestamptz);
CREATE UNIQUE INDEX one_open_session ON lightning_pool_session(cluster_id, player_id) WHERE exited_at IS NULL;
CREATE TABLE lightning_pool_slot(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pool_session_id uuid, cluster_id uuid, cluster_epoch integer,
  player_id uuid, opened_at timestamptz, closed_at timestamptz, close_reason text, updated_at timestamptz);
CREATE TABLE lightning_instance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid, hand_id uuid, state text, created_at timestamptz DEFAULT now());
CREATE TABLE lightning_reservation(cluster_id uuid, player_id uuid, state text, lightning_instance_id uuid);
CREATE TABLE lightning_hand_player(hand_id uuid, player_id uuid);
CREATE TABLE cash_cluster_events(id bigserial PRIMARY KEY, game_id uuid, table_id uuid, kind text, payload jsonb, at timestamptz DEFAULT now(), cluster_epoch integer);
CREATE TABLE responsible_gaming_limits(user_id uuid PRIMARY KEY);

-- Synthetic surrounding inputs.
CREATE FUNCTION fn_caller_is_engine() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('test.engine', true), ''), 'false')::boolean$$;
CREATE FUNCTION fn_platform_frozen() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE FUNCTION fn_lightning_config(uuid) RETURNS jsonb LANGUAGE sql STABLE AS
  $$SELECT '{"disconnect_timeout_ms":180000,"multi_table_limit":{"mobile":2,"tablet":3,"desktop":4},"lightning_joins_enabled":true}'::jsonb$$;
CREATE FUNCTION fn_lightning_joins_enabled(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
CREATE FUNCTION fn_rg_require_not_excluded(p uuid) RETURNS jsonb LANGUAGE sql STABLE AS
  $$SELECT jsonb_build_object('ok', NOT EXISTS (SELECT 1 FROM responsible_gaming_limits l WHERE l.user_id = p))$$;
CREATE FUNCTION fn_ca_player_restricted(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE TYPE sim_restriction AS (reason_code text);
CREATE FUNCTION fn_ca_player_restriction_for(uuid, text) RETURNS sim_restriction LANGUAGE sql STABLE AS $$SELECT ROW(NULL::text)::sim_restriction$$;
CREATE FUNCTION fn_lightning_pool_exposure(uuid, uuid) RETURNS numeric LANGUAGE sql STABLE AS $$SELECT 0::numeric$$;
CREATE FUNCTION smarter_private.lightning_top_up_pending(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE FUNCTION smarter_private.lightning_top_up_finish(uuid, uuid, text) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_cash_session_open(uuid, uuid, numeric) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture sessions are seeded'; END$$;
CREATE FUNCTION fn_cash_stay_remaining_ms(integer, boolean, timestamptz) RETURNS integer LANGUAGE sql IMMUTABLE AS $$SELECT 0$$;
CREATE FUNCTION fn_lightning_pool_slot_open(p_ps uuid, p_now timestamptz) RETURNS void LANGUAGE sql AS $$
  INSERT INTO lightning_pool_slot(pool_session_id, cluster_id, cluster_epoch, player_id, opened_at)
  SELECT s.id, s.cluster_id, s.cluster_epoch, s.player_id, p_now FROM lightning_pool_session s
   WHERE s.id = p_ps AND NOT EXISTS (SELECT 1 FROM lightning_pool_slot sl
     WHERE sl.cluster_id = s.cluster_id AND sl.player_id = s.player_id AND sl.closed_at IS NULL)$$;
