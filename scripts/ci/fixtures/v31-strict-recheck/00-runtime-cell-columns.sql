-- Columns of production public.gto_v31_runtime_cells (2026-11-06) that the
-- contract v3 fixture schema leaves out and fn_gto_v31_evaluation_cells reads.
ALTER TABLE public.gto_v31_runtime_cells
  ADD COLUMN hand_matrix jsonb, ADD COLUMN action_specs jsonb, ADD COLUMN policy_ev_matrix jsonb,
  ADD COLUMN action_ev_matrix jsonb, ADD COLUMN public_model jsonb, ADD COLUMN public_template jsonb,
  ADD COLUMN public_training_provenance jsonb, ADD COLUMN public_model_build_receipt jsonb,
  ADD COLUMN model_checksum text, ADD COLUMN template_checksum text, ADD COLUMN feature_schema_checksum text,
  ADD COLUMN training_provenance_checksum text, ADD COLUMN model_build_receipt_checksum text;
