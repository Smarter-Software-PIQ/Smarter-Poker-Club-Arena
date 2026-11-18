-- Minimal production shape (read from PokerIQ-Production 2026-11-12, read-only)
-- of the two columns the range-evidence trigger reads. Both live ingest
-- functions (fn_gto_v31_ingest_source_artifact_matrix_v2 and
-- fn_gto_v31_public215_ingest_m2) insert this row and then the
-- gto_v31_source_artifacts row in one transaction. Never applied to production.
CREATE TABLE public.solved_spots_gold (
  id uuid NOT NULL PRIMARY KEY,
  strategy_matrix_v2 jsonb
);
