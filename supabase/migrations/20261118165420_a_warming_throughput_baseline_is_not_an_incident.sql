-- 20261118165420_a_warming_throughput_baseline_is_not_an_incident.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A WARMING THROUGHPUT BASELINE IS NOT AN INCIDENT (reliability incident
-- HorseFleetThroughputBaselineWarming, escalated since 2026-11-16 15:55 UTC)
--
-- WHAT WAS WRONG, READ FROM SOURCE AND ROWS (2026-11-18 ~16:45 UTC)
--
-- infra/monitoring/alert-rules.yml raises HorseFleetThroughputBaselineWarming
-- whenever sp:lightning_hands:same_hour_mean_6d is absent, i.e. whenever the
-- installed cash admission cohort has fewer than three same-hour historical
-- days. The cohort (server/scripts/collect-monitoring-health.sh) is a hash of
-- the md5 of the FULL TEXT of fn_lightning_horse_admit_paced plus, under the
-- cash-hourly-tables/v1 contract, the full text of twelve more SQL functions
-- and the engine's population fingerprint. Any migration touching any of them
-- restarts a three-day warm-up by design: history from a different policy is
-- never compared (docs/changelog/2026-11-12-cash-throughput-compares-the-
-- same-admission-policy.md). The last such change was 20261116200642
-- (2026-11-16 20:06 UTC), so the alert has fired continuously since and clears
-- hour by hour from 2026-11-19 into 2026-11-20 - and starts again after any
-- later change to that cohort.
--
-- It is a STATE of the monitoring, not a fault of the fleet: its own
-- description says "Zero-dealing and table-stall alarms remain independent",
-- there is no action that ends it except waiting, and the relative-drop alarm
-- it gates (HorseFleetThroughputRelativeDrop, class 77) stays an incident. But
-- the broad class 255 (alertname 'Horse%', priority 310) made it one, so the
-- controller found "no eligible recovery" and escalated a warm-up to the owner.
--
-- THE FIX
--
-- One class row, priority 305 (ahead of 255; no other row matches this alert
-- for source alertmanager / severity warning ahead of it, read 2026-11-18),
-- for this exact alertname, is_incident = false. Firing deliveries open
-- nothing. A RESOLVED delivery still classifies only against incident rows
-- (reliability_classify), so the incident already open closes on the alert's
-- own resolve. HorseFleetThroughputPolicyUnknown (critical: the cohort cannot
-- be READ) and HorseFleetThroughputRelativeDrop keep their incident classes.
--
-- No money moves. No incident, observation or alert row is written here.
--
-- @live-proof: EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE alertname_pattern = 'HorseFleetThroughputBaselineWarming' AND NOT is_incident AND priority < 310) AND (smarter_private.reliability_classify('alertmanager', 'HorseFleetThroughputBaselineWarming', 'warning', false)).is_incident IS FALSE AND (smarter_private.reliability_classify('alertmanager', 'HorseFleetThroughputPolicyUnknown', 'critical', false)).is_incident AND (smarter_private.reliability_classify('alertmanager', 'HorseFleetThroughputRelativeDrop', 'warning', false)).is_incident

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

INSERT INTO smarter_private.reliability_alert_classes
  (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
SELECT 305, '%', 'HorseFleetThroughputBaselineWarming', '%', 'horse_fleet_throughput', 'warning', false, false,
       'infra/monitoring/alert-rules.yml: a state of the throughput monitoring (fewer than three same-policy days after a cohort change, by design), not a fleet fault; no action ends it but time; RelativeDrop and PolicyUnknown stay incidents (20261118165420)'
 WHERE NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes
                    WHERE alertname_pattern = 'HorseFleetThroughputBaselineWarming');

DO $proof$
BEGIN
  IF (smarter_private.reliability_classify('alertmanager', 'HorseFleetThroughputBaselineWarming', 'warning', false)).is_incident IS NOT FALSE THEN
    RAISE EXCEPTION 'HorseFleetThroughputBaselineWarming still classifies as an incident';
  END IF;
  IF (smarter_private.reliability_classify('alertmanager', 'HorseFleetThroughputBaselineWarming', 'warning', true)).is_incident IS NOT TRUE THEN
    RAISE EXCEPTION 'a resolved HorseFleetThroughputBaselineWarming must still reach its open incident';
  END IF;
  IF (smarter_private.reliability_classify('alertmanager', 'HorseFleetThroughputPolicyUnknown', 'critical', false)).is_incident IS NOT TRUE
     OR (smarter_private.reliability_classify('alertmanager', 'HorseFleetThroughputRelativeDrop', 'warning', false)).is_incident IS NOT TRUE THEN
    RAISE EXCEPTION 'the throughput alarms that need action must stay incidents';
  END IF;
END $proof$;

COMMIT;
