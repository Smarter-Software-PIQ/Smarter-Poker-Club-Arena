-- 20261110174051_reliability_controller_sends_critical_escalations.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- THE RELIABILITY CONTROLLER SENDS CRITICAL ESCALATIONS (activation)
-- ============================================================================
--
-- One change: smarter_private.reliability_settings.notify_mode goes from
-- 'observe' to 'critical_only'. mutation_paused stays true. Nothing else.
--
-- AUTHORITY. Owner approval 2026-11-10, owner instruction "enable the already
-- approved critical-escalation mode". The settings row has no setter function
-- and no history table, so this file is the record of the change, and
-- reliability_settings.updated_at is stamped with the activation time.
--
-- OBSERVATION WINDOW. Stage B (20261110000020) ran in observe mode from
-- 2026-11-10 07:24Z to 17:40Z. Two defects it found were fixed and verified
-- live by 20261110144203: drift mirrors are incidents (one
-- fn_ca_cron_failure_watch incident, 401 skipped rows admitted with 0
-- notifications and 0 duplicate open fingerprints) and push state mirrors
-- push_outbox (notification 2 provider_accepted). 0 intake rejections and 0
-- tick errors.
--
-- ACTIVATION SAFETY (proven by scripts/ci/test-reliability-controller-stage-b.py
-- on 20261110144203). A row in suppressed_observe is never resent:
-- reliability_deliver_notifications picks only queued and rate_limited rows;
-- a reminder repeats only a message that reached Messenger, so a group whose
-- latest escalation was suppressed is never reminded; and a new incident
-- never attaches to a suppressed escalation when its own would be sent.
-- Proven: suppressed in observe, switch to critical_only, tick past the
-- reminder window gives 0 messages and 0 pushes; the next new critical
-- incident gives exactly one message and one push row.
--
-- GUARD. Applies only to the row exactly as observation left it (observe,
-- mutation_paused true). Already critical_only with mutation_paused true is a
-- no-op. Any other state refuses, because it means someone else changed the
-- controller and this file no longer describes the step.

-- @live-proof: (SELECT s.notify_mode = 'critical_only' AND s.mutation_paused AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_notifications n WHERE n.kind IN ('escalation', 'reminder', 'status_change') AND n.created_at < s.updated_at AND n.state <> 'suppressed_observe') FROM smarter_private.reliability_settings s WHERE s.id)

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $activate$
DECLARE
  s smarter_private.reliability_settings;
BEGIN
  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id FOR UPDATE;
  IF s.notify_mode = 'critical_only' AND s.mutation_paused THEN
    RAISE NOTICE 'reliability controller already in critical_only; nothing changed';
    RETURN;
  END IF;
  IF s.notify_mode <> 'observe' OR NOT s.mutation_paused THEN
    RAISE EXCEPTION 'RELIABILITY_ACTIVATION_REFUSED: settings are notify_mode=% mutation_paused=%, expected observe and true',
      s.notify_mode, s.mutation_paused;
  END IF;
  IF EXISTS (SELECT 1 FROM smarter_private.reliability_notifications n
              WHERE n.kind IN ('escalation', 'reminder', 'status_change') AND n.state <> 'suppressed_observe') THEN
    RAISE EXCEPTION 'RELIABILITY_ACTIVATION_REFUSED: an escalation or reminder left suppressed_observe while observing';
  END IF;
  UPDATE smarter_private.reliability_settings
     SET notify_mode = 'critical_only', updated_at = clock_timestamp()
   WHERE id;
END
$activate$;

COMMIT;
