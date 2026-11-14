-- 20261114001636_a_day_with_a_dropped_telemetry_batch_is_reported_incomplete
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-14 00:16:36 UTC.
--
-- WHAT WAS WRONG.
-- Since #10732 (2026-11-13) the engine's Horse telemetry publisher DROPS a
-- batch in two cases instead of resending it for ever: the writer
-- (fn_horse_brain_flush_receipt) refuses its bytes, or its write stays
-- unconfirmed for an hour. Each drop is counted on the next batch that does
-- get written: phase15_telemetry_batch_rejected and
-- phase15_telemetry_batch_abandoned in horse_brain_telemetry. The counters in
-- a dropped batch never arrive, so on such a day every Horse counter is a
-- LOWER BOUND - and the daily audit judged that day exactly like a complete
-- one. A ratio finding (data_unread, layer_went_silent) on such a day can be
-- the missing batch and not the layer, and nothing in the audit said so.
--
-- WHAT THIS CHANGES.
-- fn_audit_data_receipts(p_day) gains one finding, `telemetry_incomplete`,
-- when either drop counter is positive on p_day. It is a NOTE, never a
-- warning or a critical: the two counters are receipts with no expected
-- ratio (HorseDataLedger.ts gives them no minRatio and must never), and the
-- finding only tells the reader how to read the day's other numbers. The
-- same-day alert to the owner is the engine's (horseTelemetryGapAlert.ts);
-- this is the audit's own record of it.
--
-- EXPIRED DROPS ARE DELIBERATELY NOT COUNTED HERE. The third drop counter,
-- phase15_telemetry_batch_expired, is written on the day the writer refused
-- a batch older than its 32-day receipt window. The day that lost counters
-- is that batch's own day, more than 32 days before p_day, so adding it to
-- this finding would call p_day incomplete when it is not, and the audit of
-- the day that is incomplete ran a month earlier. The engine's alert
-- (HorseTelemetryBatchExpired) names the affected day; this finding stays
-- true to its title.
--
-- Two limits, stated in the finding itself:
--  * the drop counter is written on the day of the DROP. A batch collected
--    late one day and given up in the first hour of the next is counted on
--    the next day, so the day before may be the incomplete one;
--  * a zero does not prove a complete day: a batch lost at shutdown or with
--    a crashed process has no counter (the engine alerts the shutdown case).
--
-- HOW. The function's body is patched in place: one block inserted before its
-- final `return v_findings;`, located exactly once or the migration fails
-- and changes nothing. The body is the one last written in full by
-- 20260906150532; patching the stored definition keeps this file correct
-- even if production's copy differs from that file by whitespace. Running it
-- twice is a no-op. CREATE OR REPLACE keeps owner, SECURITY DEFINER,
-- search_path and the ACL (postgres + service_role only).
--
-- MEASURED, AND KEPT: scripts/ci/test-horse-audit-incomplete-telemetry.py
-- (run by scripts/ci/test-horse-daily-counts.py in the accounting_postgres
-- job) builds the 20260904224836 + 20260906150532 definitions on a private
-- PostgreSQL 17 cluster, applies this file and holds: no drop counter - no
-- finding; rejected = 2 - one note naming 2 and 0; abandoned = 1 on another
-- day - one note for that day only; expired alone - no finding; a second run
-- - unchanged; owner, definer, search_path and ACL kept; a body without the
-- anchor, or with two - refused and unchanged.
--
-- No table is read that the function did not already read
-- (horse_brain_telemetry through fn_ledger_fires), no live table is touched,
-- and there is one DDL statement in one transaction (production DDL policy).
--
-- The change creates no new object, so its liveness is the patched body:
-- @live-proof: position('telemetry_incomplete' in pg_get_functiondef('public.fn_audit_data_receipts(date)'::regprocedure)) > 0

BEGIN;

DO $migration$
DECLARE
  v_src text := pg_get_functiondef('public.fn_audit_data_receipts(date)'::regprocedure);
  v_anchor constant text := E'\n  return v_findings;\nend';
  v_block constant text := $block$

  -- ── incomplete telemetry: a dropped batch makes the day a lower bound (2026-11-14) ──
  v_fires := fn_ledger_fires(p_day, 'phase15_telemetry_batch_rejected');
  v_denom := fn_ledger_fires(p_day, 'phase15_telemetry_batch_abandoned');
  if v_fires + v_denom > 0 then
    v_findings := v_findings || jsonb_build_object(
      'severity', 'note', 'category', 'logic', 'code', 'telemetry_incomplete',
      'title', 'Incomplete telemetry on ' || p_day || ': ' || (v_fires + v_denom) ||
               ' Horse telemetry batch(es) were dropped unwritten - the day''s counters are a lower bound',
      'evidence', jsonb_build_object(
        'batches_rejected', v_fires, 'batches_abandoned', v_denom,
        'rejected_feature', 'phase15_telemetry_batch_rejected',
        'abandoned_feature', 'phase15_telemetry_batch_abandoned',
        'counted_from', 'horse_brain_telemetry for this day'),
      'recommendation', 'Read every Horse counter and every ratio finding for this day as a lower bound: the counters in a dropped batch never reached horse_brain_telemetry, so a layer reported low or silent may be the missing batch and not the layer. A drop is counted on the day it happened; a batch collected late on the previous day and given up within the hour is counted here, so the previous day may be the incomplete one. A day with no drop is not proven complete: a batch lost at shutdown or with a crashed process has no counter. The engine alerts each kind of loss once a day in Production Alerts (HorseTelemetryBatchRejected, HorseTelemetryBatchAbandoned, HorseTelemetryShutdownUnwritten).');
  end if;
$block$;
BEGIN
  IF position('telemetry_incomplete' in v_src) > 0 THEN
    RAISE NOTICE 'fn_audit_data_receipts already reports incomplete telemetry';
    RETURN;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one final "return v_findings;" in fn_audit_data_receipts';
  END IF;
  EXECUTE replace(v_src, v_anchor, v_block || v_anchor);
END
$migration$;

COMMIT;
