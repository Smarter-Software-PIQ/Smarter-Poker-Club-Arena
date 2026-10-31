-- 20261031172611_restart_gate_records_breaks_since_restart_certified_and_seco.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Phase 6, 2026-10-31):
--
-- The last four maintenance breaks ended gate_opened=false with 36/0/81/16
-- unparked tables, and the only number that says "the engine cannot be
-- replaced" (MaintenanceBreak.breaksSinceRestartCertified) lived on /metrics
-- alone. engine_maintenance_break_faults' last row was 2026-10-06.
--
-- 1. engine_maintenance_break_log.breaks_since_restart_certified: the engine
--    writes the consecutive-uncertified count with every break row, and a
--    crash restart on the same build reads it back at boot.
-- 2. engine_maintenance_break_faults accepts the second-break restart gate's
--    record: stage 'restart_gate', outcome 'straggler_reported' (a table still
--    unparked for a break-scoped reason at a second consecutive uncertified
--    break, reported by reason for the operator; never fenced automatically)
--    or 'refusing_accounting_pending' (the same table with accounting
--    genuinely in flight).
--
-- Small evidence tables, no foreign keys; one transaction, short lock_timeout
-- (production DDL policy rules 1, 7 and 9).

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.engine_maintenance_break_log
  ADD COLUMN IF NOT EXISTS breaks_since_restart_certified INTEGER;

COMMENT ON COLUMN public.engine_maintenance_break_log.breaks_since_restart_certified IS
  'Consecutive breaks, this one included, that ended with no restart certificate (0 = this break certified). Written by the engine at MaintenanceBreak.end(); >= 2 raises ClubArenaRestartGateShut. NULL on rows written before 2026-10-31.';

ALTER TABLE public.engine_maintenance_break_faults
  DROP CONSTRAINT IF EXISTS engine_maintenance_break_faults_stage_check;
ALTER TABLE public.engine_maintenance_break_faults
  ADD CONSTRAINT engine_maintenance_break_faults_stage_check
  CHECK (stage IN ('announcement', 'countdown', 'adoption', 'boot', 'restart_gate'));

ALTER TABLE public.engine_maintenance_break_faults
  DROP CONSTRAINT IF EXISTS engine_maintenance_break_faults_outcome_check;
ALTER TABLE public.engine_maintenance_break_faults
  ADD CONSTRAINT engine_maintenance_break_faults_outcome_check
  CHECK (outcome IN ('cancelled', 'held_without_restart', 'straggler_reported', 'refusing_accounting_pending'));

COMMIT;
