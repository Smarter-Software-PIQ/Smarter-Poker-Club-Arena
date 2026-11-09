-- 20261109184743_operational_alert_events_always_carry_a_destination.sql
--
-- ROOT CAUSE (read from rows and from the live function body, 2026-11-09):
-- fn_ca_table_stall_watch_ingest inserts TableStoppedDealing and
-- TournamentStopNotSettled into operational_alert_events with a payload that
-- has no target_task_id. 601 rows in 7 days (plus 7 from mac-studio-git-
-- maintenance) reached the store with no destination, so the Production
-- Alerts fleet cannot route them. Nothing in the owning table refused a row
-- without a destination, so every present and future in-database sender could
-- repeat the same omission.
--
-- FIX AT THE OWNING LAYER: a BEFORE INSERT trigger on the table guarantees
-- payload.target_task_id is present. A sender that stamps its own destination
-- is never overwritten. Historical rows are NOT rewritten (custody: original
-- raw events are preserved); the guarantee applies to every new row.
--
-- The trigger never raises: it only adds a key, so it cannot fail the capture
-- of an alert. One transaction, short lock_timeout, no retry loop.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.fn_operational_alert_stamp_destination()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $fn$
BEGIN
  IF NEW.payload IS NULL OR jsonb_typeof(NEW.payload) <> 'object' THEN
    NEW.payload := jsonb_build_object('original_payload', NEW.payload);
  END IF;
  IF NULLIF(NEW.payload->>'target_task_id', '') IS NULL THEN
    NEW.payload := NEW.payload || jsonb_build_object(
      'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca');
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS a00_operational_alert_stamp_destination ON public.operational_alert_events;
CREATE TRIGGER a00_operational_alert_stamp_destination
  BEFORE INSERT ON public.operational_alert_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_operational_alert_stamp_destination();

COMMIT;
