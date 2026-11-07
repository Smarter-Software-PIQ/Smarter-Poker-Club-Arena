-- ═══════════════════════════════════════════════════════════════════════════
-- DECLARE THE fn_ca_cron_failure_watch DETECTOR RECEIPT (2026-11-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Drift incident 7d7c827e (open since 2026-11-06 21:25 UTC) reported that
-- fn_ca_cron_failure_watch was redefined since its last baseline with no
-- migration declaring it. Diffed ca_guard_def_history 44316 -> 92184: the
-- ONLY change is four lines appended before the RETURN -
--
--   -- A completed run is a re-measurement fn_ca_resolve_cleared_incidents reads.
--   INSERT INTO public.ca_detector_runs (detector, detail)
--   VALUES ('fn_ca_cron_failure_watch', jsonb_build_object('raised', n));
--
-- Detection logic, thresholds and the return value are otherwise identical.
-- This strengthens the alarm (it lets cleared incidents auto-resolve); it
-- does not weaken it. Declaring it here puts the review on the record and
-- names this migration as the baseline's declared_ref, which is what the
-- guard wanted and did not have.
--
-- @live-proof: dacb5465ac93efaf495006fecc6e42b0

SELECT public.fn_ca_declare_guard_redefinition(
  'fn_ca_cron_failure_watch',
  'migration 20261107131500_declare_the_cron_failure_watch_detector_receipt (reviewed: adds a ca_detector_runs completion receipt only; detection logic byte-identical)'
);