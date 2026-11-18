-- Production shapes for the native proof of migration 20261115162745 (FLOP-5 D6).
-- Generated from PokerIQ-Production (kuklfnapbkmacvwxktbh) on 2026-11-15 inside READ ONLY
-- transactions; never applied to production. Tables: every live column, default, constraint (pg_get_constraintdef, NOT VALID kept) and V31 trigger of the eleven relations below; the seal revision-clock and non-V31 triggers are omitted (their tables are not part of this proof).
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.gto_v31_public215_tree AS (feature smallint[], threshold double precision[], left_child smallint[], right_child smallint[], leaf_value double precision[]);
CREATE TYPE public.gto_v31_public215_head AS (baseline double precision, trees gto_v31_public215_tree[]);
CREATE TABLE public.gto_v31_input_bundles (
  input_bundle_id uuid DEFAULT gen_random_uuid() NOT NULL,
  bundle_key text NOT NULL,
  bundle_checksum text NOT NULL,
  range_bundle_checksum text NOT NULL,
  source_combo_order_checksum text NOT NULL,
  icm_model_checksum text NOT NULL,
  bundle_manifest jsonb NOT NULL,
  approval_status text DEFAULT 'approved'::text NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_by uuid,
  revoked_at timestamp with time zone,
  revocation_reason text,
  feature_contract_version text,
  policy_export_schema text,
  policy_representation text
);
CREATE TABLE public.gto_v31_datasets (
  dataset_id uuid DEFAULT gen_random_uuid() NOT NULL,
  dataset_key text NOT NULL,
  state text DEFAULT 'building'::text NOT NULL,
  quality_status text DEFAULT 'building'::text NOT NULL,
  solver_version text NOT NULL,
  solver_binary_checksum text NOT NULL,
  pipeline_commit text NOT NULL,
  pipeline_bundle_checksum text NOT NULL,
  manifest_version text NOT NULL,
  manifest_checksum text NOT NULL,
  source_combo_order_checksum text NOT NULL,
  range_bundle_checksum text NOT NULL,
  icm_model_checksum text NOT NULL,
  input_bundle_id uuid NOT NULL,
  input_bundle_checksum text NOT NULL,
  machine_ids text[] NOT NULL,
  declared_coverage jsonb NOT NULL,
  quality_gates jsonb NOT NULL,
  source_rows bigint DEFAULT 0 NOT NULL,
  train_source_rows bigint DEFAULT 0 NOT NULL,
  holdout_source_rows bigint DEFAULT 0 NOT NULL,
  invalid_rows bigint DEFAULT 0 NOT NULL,
  source_artifact_checksum text,
  dataset_checksum text,
  coverage jsonb DEFAULT '{}'::jsonb NOT NULL,
  heldout_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  paired_replay jsonb DEFAULT '{}'::jsonb NOT NULL,
  league_gate jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sealed_at timestamp with time zone,
  candidate_at timestamp with time zone,
  audited_at timestamp with time zone,
  promoted_at timestamp with time zone,
  retired_at timestamp with time zone,
  feature_contract_version text,
  policy_export_schema text,
  policy_representation text,
  evaluation_contract text DEFAULT 'gto_v31_candidate.v3'::text NOT NULL
);
CREATE TABLE public.gto_v31_runtime_cells (
  cell_id uuid DEFAULT gen_random_uuid() NOT NULL,
  dataset_id uuid NOT NULL,
  cell_key_checksum text NOT NULL,
  street text NOT NULL,
  game_family text NOT NULL,
  objective text NOT NULL,
  utility_context text NOT NULL,
  table_size smallint NOT NULL,
  pot_type text NOT NULL,
  hero_position text NOT NULL,
  opponent_position text NOT NULL,
  depth_bucket integer NOT NULL,
  texture_class text NOT NULL,
  node_role text NOT NULL,
  facing_kind text NOT NULL,
  facing_size_bucket text NOT NULL,
  hand_matrix jsonb,
  action_specs jsonb NOT NULL,
  policy_ev_matrix jsonb DEFAULT '{}'::jsonb,
  action_ev_matrix jsonb DEFAULT '{}'::jsonb,
  source_rows integer NOT NULL,
  train_source_rows integer NOT NULL,
  holdout_source_rows integer NOT NULL,
  cell_payload_checksum text NOT NULL,
  lineage_checksum text NOT NULL,
  built_at timestamp with time zone DEFAULT now() NOT NULL,
  feature_contract_version text,
  policy_export_schema text,
  policy_representation text,
  public_model jsonb,
  public_template jsonb,
  public_training_provenance jsonb,
  public_model_build_receipt jsonb,
  model_checksum text,
  template_checksum text,
  feature_schema_checksum text,
  training_provenance_checksum text,
  model_build_receipt_checksum text,
  sql_physics_checksum text
);
CREATE TABLE public.gto_v31_round_registrations (
  registration_id uuid DEFAULT gen_random_uuid() NOT NULL,
  round_key text NOT NULL,
  dataset_key text NOT NULL,
  composition jsonb NOT NULL,
  cells jsonb NOT NULL,
  cell_set_checksum text NOT NULL,
  owner_authorization jsonb NOT NULL,
  candidate jsonb NOT NULL,
  dataset_provenance jsonb NOT NULL,
  acceptance_criteria jsonb NOT NULL,
  evaluation_plan jsonb NOT NULL,
  registered_at timestamp with time zone DEFAULT now() NOT NULL,
  dataset_id uuid,
  heldout_consumed_at timestamp with time zone,
  cell_provenance jsonb
);
CREATE TABLE public.gto_v31_source_artifacts (
  dataset_id uuid NOT NULL,
  source_row_id uuid NOT NULL,
  machine_id text NOT NULL,
  scenario_hash text NOT NULL,
  game_family text NOT NULL,
  stack_depth integer NOT NULL,
  street text NOT NULL,
  source_artifact_checksum text NOT NULL,
  node_count integer NOT NULL,
  solved_at timestamp with time zone NOT NULL,
  ingested_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.gto_v31_cell_source_receipts (
  dataset_id uuid NOT NULL,
  cell_id uuid NOT NULL,
  source_row_id uuid NOT NULL,
  source_node text NOT NULL,
  source_node_checksum text NOT NULL,
  source_artifact_checksum text NOT NULL,
  machine_id text NOT NULL,
  split text NOT NULL,
  verified_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.gto_v31_range_evidence (
  evidence_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  dataset_id uuid NOT NULL,
  kind text NOT NULL,
  cell_key text NOT NULL,
  registered boolean NOT NULL,
  source_row_id uuid,
  source_node text,
  board text,
  oop_group text,
  ip_group text,
  oop_vector real[],
  ip_vector real[],
  attested_seat text,
  attested_reason text,
  upstream_evidence_checksum text,
  rescale_share numeric,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.gto_v31_public_model_audits (
  audit_key text NOT NULL,
  physics_key text NOT NULL,
  model_checksum text NOT NULL,
  template_checksum text NOT NULL,
  encoding_checksum text NOT NULL,
  chronological_board text[] NOT NULL,
  legal_combos integer NOT NULL,
  audit_checksum text NOT NULL,
  prepared_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.gto_v31_public_model_audit_combos (
  audit_key text NOT NULL,
  combo integer NOT NULL,
  features double precision[] NOT NULL,
  raw_heads double precision[] NOT NULL,
  policy_ev double precision NOT NULL,
  action_evs double precision[] NOT NULL,
  frequencies double precision[] NOT NULL
);
CREATE TABLE public.gto_v31_public_physics (
  physics_key text NOT NULL,
  implementation_checksum text NOT NULL,
  board_ids integer[] NOT NULL,
  normalized_weights_checksum text NOT NULL,
  exact_mass_rows jsonb NOT NULL,
  physics_checksum text NOT NULL,
  legal_combos integer NOT NULL,
  prepared_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.solved_spots_gold (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  scenario_hash text NOT NULL,
  game_type text,
  stack_depth integer,
  street text,
  strategy_matrix jsonb,
  created_at timestamp with time zone DEFAULT now(),
  strategy_matrix_v2 jsonb,
  solved_v2_at timestamp with time zone,
  solver_version text,
  solver_binary_checksum text,
  machine_id text,
  pipeline_commit text,
  manifest_version text,
  manifest_checksum text,
  source_artifact_checksum text,
  quality_status text,
  audited_at timestamp with time zone,
  pipeline_bundle_checksum text
);
