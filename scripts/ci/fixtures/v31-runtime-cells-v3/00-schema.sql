-- Production shapes for the native proof of the V31 runtime-cell contract v3
-- migration (FLOP-5 D6). Read from PokerIQ-Production (kuklfnapbkmacvwxktbh)
-- on 2026-11-15 inside READ ONLY transactions; never applied to production.
-- gto_v31_runtime_cells carries every live constraint and trigger with its
-- live text (pg_get_constraintdef); the two validator functions the
-- constraints call are stubbed. fn_gto_v31_active_cells and
-- fn_gto_v31_evaluation_cells are in 01-live-functions.sql, byte for byte.
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.gto_v31_input_bundles (
  input_bundle_id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, bundle_checksum text NOT NULL,
  approval_status text NOT NULL DEFAULT 'approved', feature_contract_version text, policy_export_schema text,
  policy_representation text);
CREATE TABLE public.gto_v31_datasets (
  dataset_id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, dataset_key text NOT NULL UNIQUE,
  dataset_checksum text, solver_version text NOT NULL DEFAULT 'PioSOLVER-edge-3.0',
  solver_binary_checksum text NOT NULL DEFAULT repeat('a',64), pipeline_commit text NOT NULL DEFAULT repeat('b',40),
  pipeline_bundle_checksum text NOT NULL DEFAULT repeat('c',64), manifest_version text NOT NULL DEFAULT 'v31.1',
  manifest_checksum text NOT NULL DEFAULT repeat('d',64), source_artifact_checksum text,
  source_combo_order_checksum text NOT NULL DEFAULT repeat('f',64), range_bundle_checksum text NOT NULL DEFAULT repeat('e',64),
  icm_model_checksum text NOT NULL DEFAULT repeat('1',64), input_bundle_id uuid NOT NULL REFERENCES public.gto_v31_input_bundles,
  input_bundle_checksum text NOT NULL, quality_status text NOT NULL DEFAULT 'validated', state text NOT NULL,
  coverage jsonb NOT NULL DEFAULT '{}', source_rows bigint NOT NULL DEFAULT 2, train_source_rows bigint NOT NULL DEFAULT 1,
  holdout_source_rows bigint NOT NULL DEFAULT 1, invalid_rows bigint NOT NULL DEFAULT 0, audited_at timestamptz DEFAULT now(),
  feature_contract_version text, policy_export_schema text, policy_representation text);
CREATE TABLE public.gto_v31_round_registrations (
  registration_id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, round_key text NOT NULL UNIQUE,
  dataset_key text NOT NULL UNIQUE, cells jsonb NOT NULL, dataset_id uuid UNIQUE REFERENCES public.gto_v31_datasets);

-- Stubs for the two validators the live constraints call (their own proofs live elsewhere).
CREATE FUNCTION public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE FUNCTION public.fn_gto_v31_hand_matrix_valid(jsonb,text,text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE FUNCTION public.fn_gto_v31_public215_cell_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
 IF OLD.policy_representation='public_hist215_v1' THEN RAISE EXCEPTION 'numeric model cell and all immutable receipts cannot be rewritten or deleted';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $function$;
CREATE FUNCTION public.fn_gto_v31_feature_binding_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
 IF NEW.feature_contract_version IS DISTINCT FROM OLD.feature_contract_version OR NEW.policy_export_schema IS DISTINCT FROM OLD.policy_export_schema OR NEW.policy_representation IS DISTINCT FROM OLD.policy_representation THEN RAISE EXCEPTION 'feature, policy and representation bindings are immutable';END IF;RETURN NEW;
END $function$;

CREATE TABLE public.gto_v31_runtime_cells (
  cell_id uuid NOT NULL DEFAULT gen_random_uuid(), dataset_id uuid NOT NULL, cell_key_checksum text NOT NULL,
  street text NOT NULL, game_family text NOT NULL, objective text NOT NULL, utility_context text NOT NULL,
  table_size smallint NOT NULL, pot_type text NOT NULL, hero_position text NOT NULL, opponent_position text NOT NULL,
  depth_bucket integer NOT NULL, texture_class text NOT NULL, node_role text NOT NULL, facing_kind text NOT NULL,
  facing_size_bucket text NOT NULL, hand_matrix jsonb, action_specs jsonb NOT NULL, policy_ev_matrix jsonb,
  action_ev_matrix jsonb, source_rows integer NOT NULL, train_source_rows integer NOT NULL,
  holdout_source_rows integer NOT NULL, cell_payload_checksum text NOT NULL, lineage_checksum text NOT NULL,
  built_at timestamp with time zone NOT NULL DEFAULT now(), feature_contract_version text, policy_export_schema text,
  policy_representation text, public_model jsonb, public_template jsonb, public_training_provenance jsonb,
  public_model_build_receipt jsonb, model_checksum text, template_checksum text, feature_schema_checksum text,
  training_provenance_checksum text, model_build_receipt_checksum text, sql_physics_checksum text);
ALTER TABLE public.gto_v31_runtime_cells
  ADD CONSTRAINT gto_v31_runtime_cells_pkey PRIMARY KEY (cell_id),
  ADD CONSTRAINT gto_v31_runtime_cells_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES gto_v31_datasets(dataset_id) ON DELETE CASCADE,
  ADD CONSTRAINT gto_v31_runtime_cells_dataset_id_cell_key_checksum_key UNIQUE (dataset_id, cell_key_checksum),
  ADD CONSTRAINT gto_v31_runtime_cells_dataset_id_street_game_family_objecti_key UNIQUE (dataset_id, street, game_family, objective, utility_context, table_size, pot_type, hero_position, opponent_position, depth_bucket, texture_class, node_role, facing_kind, facing_size_bucket),
  ADD CONSTRAINT gto_v31_runtime_cells_action_ev_matrix_check CHECK ((jsonb_typeof(action_ev_matrix) = 'object'::text)),
  ADD CONSTRAINT gto_v31_runtime_cells_action_specs_check CHECK ((jsonb_typeof(action_specs) = 'object'::text)),
  ADD CONSTRAINT gto_v31_runtime_cells_cell_key_checksum_check CHECK (((cell_key_checksum ~ '^[0-9a-f]{64}$'::text) AND (cell_key_checksum <> repeat('0'::text, 64)))),
  ADD CONSTRAINT gto_v31_runtime_cells_cell_payload_checksum_check CHECK (((cell_payload_checksum ~ '^[0-9a-f]{64}$'::text) AND (cell_payload_checksum <> repeat('0'::text, 64)))),
  ADD CONSTRAINT gto_v31_runtime_cells_check CHECK (((opponent_position = ANY (ARRAY['UTG'::text, 'UTG1'::text, 'UTG2'::text, 'UTG3'::text, 'MP'::text, 'HJ'::text, 'CO'::text, 'BTN'::text, 'SB'::text, 'BB'::text])) AND (opponent_position <> hero_position))),
  ADD CONSTRAINT gto_v31_runtime_cells_check1 CHECK ((source_rows = (train_source_rows + holdout_source_rows))),
  ADD CONSTRAINT gto_v31_runtime_cells_check2 CHECK ((((game_family = 'cash'::text) AND (objective = 'cash_ev'::text)) OR ((game_family = 'tourney_icm'::text) AND (objective = 'icm'::text)) OR ((game_family = 'tourney_ev'::text) AND (objective = 'chip_ev'::text)) OR ((game_family = 'spin'::text) AND (objective = ANY (ARRAY['chip_ev'::text, 'icm'::text]))))),
  ADD CONSTRAINT gto_v31_runtime_cells_check3 CHECK ((((objective = 'cash_ev'::text) AND (utility_context = 'cash_ev'::text)) OR ((objective = 'chip_ev'::text) AND (utility_context = 'chip_ev'::text)) OR ((objective = 'icm'::text) AND (game_family = 'spin'::text) AND (utility_context = 'spin_ladder'::text)) OR ((objective = 'icm'::text) AND (game_family = 'tourney_icm'::text) AND (utility_context = ANY (ARRAY['satellite'::text, 'bubble'::text, 'final_table'::text, 'in_money'::text, 'ladder'::text]))))),
  ADD CONSTRAINT gto_v31_runtime_cells_check4 CHECK ((((node_role = ANY (ARRAY['open'::text, 'cbet'::text, 'probe'::text, 'delayed_cbet'::text, 'barrel'::text])) AND (facing_kind = 'none'::text) AND (facing_size_bucket = 'none'::text)) OR ((node_role = 'all_in'::text) AND (facing_kind = 'all_in'::text) AND (facing_size_bucket = 'all_in'::text)) OR ((node_role = 'facing_bet'::text) AND (facing_kind = 'bet'::text) AND (facing_size_bucket = ANY (ARRAY['small'::text, 'mid'::text, 'big'::text]))) OR ((node_role = ANY (ARRAY['facing_raise'::text, 'check_raise'::text, 'bet_raise'::text])) AND (facing_kind = 'raise'::text) AND (facing_size_bucket = ANY (ARRAY['small'::text, 'mid'::text, 'big'::text]))))),
  ADD CONSTRAINT gto_v31_runtime_cells_compact_matrices_valid_chk CHECK (fn_gto_v31_compact_matrices_valid(hand_matrix, action_specs, policy_ev_matrix, action_ev_matrix, street, feature_contract_version)),
  ADD CONSTRAINT gto_v31_runtime_cells_depth_bucket_check CHECK ((depth_bucket = ANY (ARRAY[10, 20, 40, 80, 150]))),
  ADD CONSTRAINT gto_v31_runtime_cells_facing_kind_check CHECK ((facing_kind = ANY (ARRAY['none'::text, 'bet'::text, 'raise'::text, 'all_in'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_facing_size_bucket_check CHECK ((facing_size_bucket = ANY (ARRAY['none'::text, 'small'::text, 'mid'::text, 'big'::text, 'all_in'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_feature_contract_version_check CHECK ((feature_contract_version = ANY (ARRAY['rank-suit-count-v1'::text, 'holdem-board-relative-v2'::text, 'holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_game_family_check CHECK ((game_family = ANY (ARRAY['cash'::text, 'spin'::text, 'tourney_ev'::text, 'tourney_icm'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_hand_keys_match_street_chk CHECK (fn_gto_v31_hand_matrix_valid(hand_matrix, street, feature_contract_version)),
  ADD CONSTRAINT gto_v31_runtime_cells_hand_matrix_check CHECK ((jsonb_typeof(hand_matrix) = 'object'::text)),
  ADD CONSTRAINT gto_v31_runtime_cells_hero_position_check CHECK ((hero_position = ANY (ARRAY['UTG'::text, 'UTG1'::text, 'UTG2'::text, 'UTG3'::text, 'MP'::text, 'HJ'::text, 'CO'::text, 'BTN'::text, 'SB'::text, 'BB'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_holdout_source_rows_check CHECK ((holdout_source_rows > 0)),
  ADD CONSTRAINT gto_v31_runtime_cells_lineage_checksum_check CHECK (((lineage_checksum ~ '^[0-9a-f]{64}$'::text) AND (lineage_checksum <> repeat('0'::text, 64)))),
  ADD CONSTRAINT gto_v31_runtime_cells_node_role_check CHECK ((node_role = ANY (ARRAY['open'::text, 'cbet'::text, 'probe'::text, 'delayed_cbet'::text, 'barrel'::text, 'facing_bet'::text, 'facing_raise'::text, 'check_raise'::text, 'bet_raise'::text, 'all_in'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_numeric_representation_identity_chk CHECK ((((feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v1'::text) AND (feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v2'::text) AND (COALESCE(policy_representation, 'matrix_v2'::text) = 'matrix_v2'::text)) OR ((feature_contract_version = ANY (ARRAY['holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text])) AND (policy_representation = 'public_hist215_v1'::text) AND (policy_export_schema = 'smarter-poker.pio-policy.v4'::text)))),
  ADD CONSTRAINT gto_v31_runtime_cells_objective_check CHECK ((objective = ANY (ARRAY['cash_ev'::text, 'chip_ev'::text, 'icm'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_policy_ev_matrix_check CHECK ((jsonb_typeof(policy_ev_matrix) = 'object'::text)),
  ADD CONSTRAINT gto_v31_runtime_cells_policy_export_schema_check CHECK ((policy_export_schema = 'smarter-poker.pio-policy.v4'::text)),
  ADD CONSTRAINT gto_v31_runtime_cells_policy_representation_check CHECK ((policy_representation = ANY (ARRAY['matrix_v2'::text, 'public_hist215_v1'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_pot_type_check CHECK ((pot_type = ANY (ARRAY['limped'::text, 'srp'::text, '3bet'::text, '4bet_plus'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_representation_payload_chk CHECK (((((COALESCE(policy_representation, 'matrix_v2'::text) = 'matrix_v2'::text) AND (hand_matrix IS NOT NULL) AND (policy_ev_matrix IS NOT NULL) AND (action_ev_matrix IS NOT NULL) AND (public_model IS NULL) AND (public_template IS NULL) AND (public_training_provenance IS NULL) AND (public_model_build_receipt IS NULL) AND (model_checksum IS NULL) AND (template_checksum IS NULL) AND (feature_schema_checksum IS NULL) AND (training_provenance_checksum IS NULL) AND (model_build_receipt_checksum IS NULL) AND (sql_physics_checksum IS NULL)) OR ((policy_representation = 'public_hist215_v1'::text) AND (feature_contract_version = ANY (ARRAY['holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text])) AND (policy_export_schema = 'smarter-poker.pio-policy.v4'::text) AND (hand_matrix IS NULL) AND (policy_ev_matrix IS NULL) AND (action_ev_matrix IS NULL) AND (public_model IS NOT NULL) AND (public_template IS NOT NULL) AND (public_training_provenance IS NOT NULL) AND (public_model_build_receipt IS NOT NULL) AND (model_checksum IS NOT NULL) AND (template_checksum IS NOT NULL) AND (feature_schema_checksum IS NOT NULL) AND (training_provenance_checksum IS NOT NULL) AND (model_build_receipt_checksum IS NOT NULL) AND (sql_physics_checksum IS NOT NULL))) IS TRUE)),
  ADD CONSTRAINT gto_v31_runtime_cells_source_rows_check CHECK ((source_rows > 0)),
  ADD CONSTRAINT gto_v31_runtime_cells_street_check CHECK ((street = ANY (ARRAY['flop'::text, 'turn'::text, 'river'::text]))),
  ADD CONSTRAINT gto_v31_runtime_cells_table_size_check CHECK (((table_size >= 2) AND (table_size <= 10))),
  ADD CONSTRAINT gto_v31_runtime_cells_texture_class_check CHECK ((texture_class ~ '^[ABML][mtr][pu][cd]$'::text)),
  ADD CONSTRAINT gto_v31_runtime_cells_train_source_rows_check CHECK ((train_source_rows > 0)),
  ADD CONSTRAINT gto_v31_runtime_cells_utility_context_check CHECK ((utility_context = ANY (ARRAY['cash_ev'::text, 'chip_ev'::text, 'spin_ladder'::text, 'satellite'::text, 'bubble'::text, 'final_table'::text, 'in_money'::text, 'ladder'::text])));
CREATE TRIGGER gto_v31_public215_cell_immutable BEFORE DELETE OR UPDATE ON public.gto_v31_runtime_cells FOR EACH ROW EXECUTE FUNCTION fn_gto_v31_public215_cell_immutable();
CREATE TRIGGER gto_v31_runtime_cells_feature_binding_immutable BEFORE UPDATE ON public.gto_v31_runtime_cells FOR EACH ROW EXECUTE FUNCTION fn_gto_v31_feature_binding_immutable();
