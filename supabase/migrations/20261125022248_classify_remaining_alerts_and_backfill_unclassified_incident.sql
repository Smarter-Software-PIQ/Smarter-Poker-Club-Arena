-- 20261125022248_classify_remaining_alerts_and_backfill_unclassified_incident.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   1. Eliminates unclassified alert rot in smarter_private.reliability_alert_classes:
--      - Classifies the 13 remaining unclassified Prometheus rules in
--        infra/monitoring/alert-rules.yml (ClassicCashFloorDark,
--        HandMemoryDomainMissingOnCashShowdown, HostDiskNearlyFull,
--        HostCPUSaturated, HostMemoryPressure, EngineProcessMemoryHigh,
--        HandProjectionDrainWedged, HandProjectionOutboxBacklog,
--        HandProjectionOutboxBacklogCritical, HandProjectionDrainStalled,
--        ClientErrorSpike, OpenClawJobsHaveGoneSilent, OpenClawFleetLongSilence)
--        plus the two eventDbBulkhead Prometheus alerts
--        (EventDbBulkheadSaturated, EventDbBulkheadOpen).
--      - Classifies every unmapped DailyDigest.* rule from fn_sp_digest_attention
--        (19 rules previously falling into priority-250 DailyDigest.% unclassified)
--        and the 4 missing CriticalPage.* rules from fn_sp_critical_scan.
--      - Classifies Club Arena engine & SQL watch alerts previously falling into
--        fallback 1000 or unclassified rules: OpponentHud* (OpponentHudDrift,
--        OpponentHudLoadFailing, OpponentHudPersistFailing, OpponentHudProfileLate,
--        OpponentHudSyncHeld + OpponentHud%), ClubArenaHorseFleetLoopStopped,
--        ClubArenaClockSkew, ClubArenaPostCommitObligationsPending,
--        F06OwnReservedRecoveryStalled, HostHeartbeatMissing,
--        CashPotConservation:%, CashPotConservationCheckFailed,
--        Bug Report Not Delivered To Owner Messenger,
--        fn_horse_daily_audit_watchdog, fn_gto_v31_round_stall_check,
--        Push%, OwnerAccountDeviceNotConfirmingPush, OpenClaw%,
--        VercelDeploymentFailed, DeploymentMonitorUnavailable, TriviaQuestion%.
--      - Classifies healthy green Midway burn-in gate notices
--        (owner-operational-notifications / financial_attestation:🟢%) as
--        development_notification with is_incident = false so healthy-state
--        confirmations never open incidents.
--      - Preserves the priority-1000 global unclassified fallback untouched so
--        genuinely unknown future alerts still escalate immediately.
--   2. Backfills incident_class, class_rule_id, title, group_key, and
--      (when collision-free) lockstep fingerprint on existing non-closed
--      'unclassified' rows in smarter_private.reliability_incidents, including
--      rakeback_settler_read_horizon_held (whose rule was added in 20261122145848
--      without backfilling already-open rows), OpponentHudDrift,
--      PushZombieSubscriptions, HostDiskNearlyFull, and DailyDigest.*.
--   3. Closes reclassified non-incident rows (financial_attestation:🟢%) and
--      evidence-proved post-stale source-resolved rows from
--      rakeback-settler-read-horizon and host-heartbeat through the supported
--      smarter_private.reliability_transition(..., 'closed', ...) path without
--      touching smarter_private.reliability_proved_source_resolution or any
--      function owned by concurrent lanes.
--
-- @live-proof: (SELECT (smarter_private.reliability_classify('alertmanager', 'ClassicCashFloorDark', 'critical', false)).incident_class = 'table_liveness' AND (smarter_private.reliability_classify('alertmanager', 'HandMemoryDomainMissingOnCashShowdown', 'warning', false)).incident_class = 'horse_policy_domain' AND (smarter_private.reliability_classify('alertmanager', 'EventDbBulkheadSaturated', 'warning', false)).incident_class = 'database' AND (smarter_private.reliability_classify('alertmanager', 'EventDbBulkheadOpen', 'warning', false)).incident_class = 'database' AND (smarter_private.reliability_classify('host-heartbeat', 'HostDiskNearlyFull', 'warning', false)).incident_class = 'host_capacity' AND (smarter_private.reliability_classify('engine-alerts-backfill', 'OpponentHudDrift', 'warning', false)).incident_class = 'stats' AND (smarter_private.reliability_classify('worldhub.push-health', 'PushZombieSubscriptions', 'warning', false)).incident_class = 'monitoring_self' AND (smarter_private.reliability_classify('sp-daily-digest', 'DailyDigest.phone_verification_low', 'warning', false)).incident_class = 'product_health' AND (smarter_private.reliability_classify('sp-daily-digest', 'DailyDigest.client_crash', 'warning', false)).incident_class = 'client_health' AND (smarter_private.reliability_classify('owner-operational-notifications', 'financial_attestation:🟢 Midway burn-in gate is GREEN', 'warning', false)).is_incident IS FALSE AND (smarter_private.reliability_classify('alertmanager', 'SomethingNobodyClassified', 'warning', false)).incident_class = 'unclassified' AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_incidents i WHERE i.status NOT IN ('recovered', 'closed') AND i.incident_class = 'unclassified' AND i.alertname IN ('OpponentHudDrift', 'PushZombieSubscriptions', 'HostDiskNearlyFull', 'rakeback_settler_read_horizon_held', 'DailyDigest.phone_verification_low', 'DailyDigest.signups_dropped', 'DailyDigest.client_crash', 'DailyDigest.error_spike', 'financial_attestation:🟢 Midway burn-in gate is GREEN')))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ── 1. Upsert complete alert classification rules ────────────────────────────
DO $classify_all_known_alerts$
DECLARE
  v_cls smarter_private.reliability_alert_classes;
  v_norm text;
  v_new_fp text;
  v_can_rekey boolean;
  r record;
BEGIN
  IF to_regclass('smarter_private.reliability_alert_classes') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO smarter_private.reliability_alert_classes
    (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
  VALUES
    -- Prometheus rules (priority 100): fill missing rules and replace legacy unclassified seeds
    (100, '%', 'ClassicCashFloorDark', '%', 'table_liveness', 'critical', false, true,
     'infra/monitoring/alert-rules.yml: no action at any Classic cash table for 15 minutes (20261125022248)'),
    (100, '%', 'HandMemoryDomainMissingOnCashShowdown', '%', 'horse_policy_domain', 'warning', false, true,
     'infra/monitoring/alert-rules.yml: cash showdown logged without public memory domain for supported learner scope (20261125022248)'),
    (100, '%', 'EventDbBulkheadSaturated', '%', 'database', 'warning', false, true,
     'infra/monitoring/alert-rules.yml (postgres-health): eventDbBulkhead park timeouts or full-queue refusals (20261125022248)'),
    (100, '%', 'EventDbBulkheadOpen', '%', 'database', 'warning', false, true,
     'infra/monitoring/alert-rules.yml (postgres-health): eventDbBulkhead circuit breaker held open for 5m (20261125022248)'),
    (100, '%', 'HostDiskNearlyFull', '%', 'host_capacity', 'warning', false, true,
     'infra/monitoring/alert-rules.yml & host-heartbeat: host disk free space below threshold (20261125022248)'),
    (100, '%', 'HostCPUSaturated', '%', 'host_capacity', 'warning', false, true,
     'infra/monitoring/alert-rules.yml: host CPU utilization saturated (20261125022248)'),
    (100, '%', 'HostMemoryPressure', '%', 'host_capacity', 'warning', false, true,
     'infra/monitoring/alert-rules.yml: host memory pressure above threshold (20261125022248)'),
    (100, '%', 'EngineProcessMemoryHigh', '%', 'host_capacity', 'warning', false, true,
     'infra/monitoring/alert-rules.yml: Club Arena engine process RSS above threshold (20261125022248)'),
    (100, '%', 'HandProjectionDrainWedged', '%', 'stats', 'critical', false, true,
     'infra/monitoring/alert-rules.yml: hand projection outbox drain wedged (20261125022248)'),
    (100, '%', 'HandProjectionOutboxBacklog', '%', 'stats', 'warning', false, true,
     'infra/monitoring/alert-rules.yml: hand projection outbox backlog elevated (20261125022248)'),
    (100, '%', 'HandProjectionOutboxBacklogCritical', '%', 'stats', 'critical', false, true,
     'infra/monitoring/alert-rules.yml: hand projection outbox backlog critical (20261125022248)'),
    (100, '%', 'HandProjectionDrainStalled', '%', 'stats', 'critical', false, true,
     'infra/monitoring/alert-rules.yml: hand projection drain stalled (20261125022248)'),
    (100, '%', 'ClientErrorSpike', '%', 'client_health', 'warning', false, true,
     'infra/monitoring/alert-rules.yml: elevated browser client error rate across users (20261125022248)'),
    (100, '%', 'OpenClawJobsHaveGoneSilent', '%', 'monitoring_self', 'warning', false, true,
     'infra/monitoring/alert-rules.yml: OpenClaw scheduled jobs silent beyond cadence (20261125022248)'),
    (100, '%', 'OpenClawFleetLongSilence', '%', 'monitoring_self', 'critical', false, true,
     'infra/monitoring/alert-rules.yml: entire OpenClaw job fleet silent (20261125022248)'),

    -- Healthy green burn-in gate attestation is informational, never an incident
    (140, 'owner-operational-notifications', 'financial_attestation:🟢%', '%', 'development_notification', 'info', false, false,
     'owner-operational-notifications: green Midway burn-in gate confirmation is a healthy-state receipt, never an incident (20261125022248)'),

    -- DailyDigest.* (priority 150, ahead of priority-250 DailyDigest.% fallback): all 19 unmapped fn_sp_digest_attention rules
    (150, '%', 'DailyDigest.money_not_reconciling', '%', 'money_integrity', 'critical', false, true,
     'fn_sp_digest_attention: unexplained chip supply delta (20261125022248)'),
    (150, '%', 'DailyDigest.ledger_findings', '%', 'money_integrity', 'critical', false, true,
     'fn_sp_digest_attention: new ledger invariant findings (20261125022248)'),
    (150, '%', 'DailyDigest.cashout_waiting', '%', 'money_integrity', 'warning', false, true,
     'fn_sp_digest_attention: cashout requests waiting past SLA (20261125022248)'),
    (150, '%', 'DailyDigest.invoices_late', '%', 'money_integrity', 'warning', false, true,
     'fn_sp_digest_attention: weekly accounting invoices undelivered (20261125022248)'),
    (150, '%', 'DailyDigest.payment_problem', '%', 'money_integrity', 'critical', false, true,
     'fn_sp_digest_attention: Stripe payment refunds, disputes or failures (20261125022248)'),
    (150, '%', 'DailyDigest.drift_past_deadline', '%', 'money_integrity', 'warning', false, true,
     'fn_sp_digest_attention: financial drift incidents open past deadline (20261125022248)'),
    (150, '%', 'DailyDigest.spins_underfunded', '%', 'money_integrity', 'critical', false, true,
     'fn_sp_digest_attention: Diamond Spin or Diamond game hosts funded below threshold (20261125022248)'),
    (150, '%', 'DailyDigest.break_failed', '%', 'release', 'warning', false, true,
     'fn_sp_digest_attention: engine maintenance break did not pass (20261125022248)'),
    (150, '%', 'DailyDigest.critical_alert_rising', '%', 'monitoring_self', 'critical', false, true,
     'fn_sp_digest_attention: critical alert type new this week or doubled (20261125022248)'),
    (150, '%', 'DailyDigest.digest_failed', '%', 'monitoring_self', 'warning', false, true,
     'fn_sp_digest_attention: daily digest computation or delivery error (20261125022248)'),
    (150, '%', 'DailyDigest.stale_source', '%', 'monitoring_self', 'warning', false, true,
     'fn_sp_digest_attention: core telemetry table has no recent rows (20261125022248)'),
    (150, '%', 'DailyDigest.client_crash', '%', 'client_health', 'warning', false, true,
     'fn_sp_digest_attention: browser client crash reports elevated (20261125022248)'),
    (150, '%', 'DailyDigest.error_spike', '%', 'client_health', 'warning', false, true,
     'fn_sp_digest_attention: application error spike in daily digest (20261125022248)'),
    (150, '%', 'DailyDigest.signup_errors', '%', 'product_health', 'warning', false, true,
     'fn_sp_digest_attention: player signup errors elevated (20261125022248)'),
    (150, '%', 'DailyDigest.signups_dropped', '%', 'product_health', 'warning', false, true,
     'fn_sp_digest_attention: daily signups below 7-day average threshold (20261125022248)'),
    (150, '%', 'DailyDigest.phone_verification_low', '%', 'product_health', 'warning', false, true,
     'fn_sp_digest_attention: phone verification completion rate below floor (20261125022248)'),
    (150, '%', 'DailyDigest.phone_otp_send_failed', '%', 'product_health', 'warning', false, true,
     'fn_sp_digest_attention: phone OTP verification SMS delivery failures (20261125022248)'),
    (150, '%', 'DailyDigest.beta_accounts_flagged', '%', 'product_health', 'warning', false, true,
     'fn_sp_digest_attention: beta accounts flagged for review (20261125022248)'),
    (150, '%', 'DailyDigest.new_admin', '%', 'security_access', 'warning', false, true,
     'fn_sp_digest_attention: new admin privilege grant detected (20261125022248)'),

    -- CriticalPage.* (priority 150): complete coverage for fn_sp_critical_scan
    (150, '%', 'CriticalPage.money_not_reconciling', '%', 'money_integrity', 'critical', false, true,
     'fn_sp_critical_scan: unexplained chip supply delta (20261125022248)'),
    (150, '%', 'CriticalPage.ledger_findings', '%', 'money_integrity', 'critical', false, true,
     'fn_sp_critical_scan: new ledger invariant findings (20261125022248)'),
    (150, '%', 'CriticalPage.payment_problem', '%', 'money_integrity', 'critical', false, true,
     'fn_sp_critical_scan: Stripe payment refunds, disputes or failures (20261125022248)'),
    (150, '%', 'CriticalPage.spins_underfunded', '%', 'money_integrity', 'critical', false, true,
     'fn_sp_critical_scan: Diamond Spin or Diamond game hosts underfunded (20261125022248)'),

    -- Club Arena engine alerts, SQL watches, and external producers (priority 200)
    (200, '%', 'OpponentHudDrift', '%', 'stats', 'warning', false, true,
     'server/src/services/OpponentHudStore.ts: nightly opponent HUD verification disagrees with hand_history (20261125022248)'),
    (200, '%', 'OpponentHudLoadFailing', '%', 'stats', 'warning', false, true,
     'server/src/services/OpponentHudStore.ts: opponent HUD profile read failures (20261125022248)'),
    (200, '%', 'OpponentHudPersistFailing', '%', 'stats', 'warning', false, true,
     'server/src/services/OpponentHudStore.ts: opponent HUD profile write failures (20261125022248)'),
    (200, '%', 'OpponentHudProfileLate', '%', 'stats', 'warning', false, true,
     'server/src/services/OpponentHudStore.ts: opponent HUD profile lag past threshold (20261125022248)'),
    (200, '%', 'OpponentHudSyncHeld', '%', 'stats', 'warning', false, true,
     'server/src/services/OpponentHudStore.ts: opponent HUD sync point held pending backfill (20261125022248)'),
    (200, '%', 'ClubArenaHorseFleetLoopStopped', '%', 'horse_fleet_throughput', 'critical', false, true,
     'server/src/services/DealRateVerifier.ts: horse fleet background loop stopped ticking (20261125022248)'),
    (200, '%', 'ClubArenaClockSkew', '%', 'database', 'warning', false, true,
     'server/src/GameServer.ts: engine-to-database wall-clock skew exceeded threshold (20261125022248)'),
    (200, '%', 'ClubArenaPostCommitObligationsPending', '%', 'money_integrity', 'warning', false, true,
     'server/src/GameServer.ts: post-commit settlement obligations pending past budget (20261125022248)'),
    (200, '%', 'F06OwnReservedRecoveryStalled', '%', 'tournament_lifecycle', 'critical', false, true,
     'server/src/engine/ServerTableEngineBase.ts: F06 reserved tournament recovery stalled (20261125022248)'),
    (200, '%', 'HostHeartbeatMissing', '%', 'host_capacity', 'critical', false, true,
     'smarter_private.host_heartbeat_check: Ops Mac or host heartbeat missing (20261125022248)'),
    (200, '%', 'CashPotConservation:%', '%', 'money_integrity', 'critical', false, true,
     'cash-pot-conservation-measurement: cash hand pot conservation mismatch (20261125022248)'),
    (200, '%', 'CashPotConservationCheckFailed', '%', 'money_integrity', 'critical', false, true,
     'cash-pot-conservation-measurement: cash hand pot conservation check failed to run (20261125022248)'),
    (200, '%', 'Bug Report Not Delivered To Owner Messenger', '%', 'monitoring_self', 'warning', false, true,
     'bug-report-routing: owner Messenger delivery failure for player bug report (20261125022248)'),
    (200, '%', 'fn_horse_daily_audit_watchdog', '%', 'horse_fleet_throughput', 'warning', false, true,
     'horse-daily-audit-watchdog: horse daily audit job failure or miss (20261125022248)'),
    (200, '%', 'fn_gto_v31_round_stall_check', '%', 'horse_policy_domain', 'warning', false, true,
     'fn_gto_v31_round_stall_check: GTO V31 solver round stalled (20261125022248)'),
    (200, '%', 'Push%', '%', 'monitoring_self', 'warning', false, true,
     'worldhub.push-health: push notification health & zombie subscription alerts (20261125022248)'),
    (200, '%', 'OwnerAccountDeviceNotConfirmingPush', '%', 'monitoring_self', 'warning', false, true,
     'worldhub.push-health: owner account push device receipt not confirmed (20261125022248)'),
    (200, '%', 'OpenClaw%', '%', 'monitoring_self', 'warning', false, true,
     'OpenClaw scheduler & job monitoring family (20261125022248)'),
    (200, '%', 'VercelDeploymentFailed', '%', 'release', 'critical', false, true,
     'World Hub Vercel deployment failure across deploy-monitor sources (20261125022248)'),
    (200, '%', 'DeploymentMonitorUnavailable', '%', 'monitoring_self', 'critical', false, true,
     'World Hub deployment monitor unable to poll Vercel API (20261125022248)'),
    (250, '%', 'TriviaQuestion%', '%', 'product_health', 'warning', false, true,
     'World Hub trivia question pipeline alerts (20261125022248)'),
    (300, '%', 'OpponentHud%', '%', 'stats', 'warning', false, true,
     'OpponentHud family prefix fallback (20261125022248)')
  ON CONFLICT (source_pattern, alertname_pattern, severity_pattern) DO UPDATE
    SET priority = EXCLUDED.priority,
        incident_class = EXCLUDED.incident_class,
        default_severity = EXCLUDED.default_severity,
        escalate_immediately = EXCLUDED.escalate_immediately,
        is_incident = EXCLUDED.is_incident,
        note = EXCLUDED.note;

  -- ── 2. In-transaction proof of classification contract ───────────────────
  IF (smarter_private.reliability_classify('alertmanager', 'ClassicCashFloorDark', 'critical', false)).incident_class <> 'table_liveness'
     OR (smarter_private.reliability_classify('alertmanager', 'HandMemoryDomainMissingOnCashShowdown', 'warning', false)).incident_class <> 'horse_policy_domain'
     OR (smarter_private.reliability_classify('alertmanager', 'EventDbBulkheadSaturated', 'warning', false)).incident_class <> 'database'
     OR (smarter_private.reliability_classify('alertmanager', 'EventDbBulkheadOpen', 'warning', false)).incident_class <> 'database'
     OR (smarter_private.reliability_classify('host-heartbeat', 'HostDiskNearlyFull', 'warning', false)).incident_class <> 'host_capacity'
     OR (smarter_private.reliability_classify('engine-alerts-backfill', 'OpponentHudDrift', 'warning', false)).incident_class <> 'stats'
     OR (smarter_private.reliability_classify('engine-alerts-backfill', 'ClubArenaHorseFleetLoopStopped', 'critical', false)).incident_class <> 'horse_fleet_throughput'
     OR (smarter_private.reliability_classify('engine-alerts-backfill', 'ClubArenaClockSkew', 'warning', false)).incident_class <> 'database'
     OR (smarter_private.reliability_classify('engine-alerts-backfill', 'ClubArenaPostCommitObligationsPending', 'warning', false)).incident_class <> 'money_integrity'
     OR (smarter_private.reliability_classify('engine-alerts-backfill', 'F06OwnReservedRecoveryStalled', 'critical', false)).incident_class <> 'tournament_lifecycle'
     OR (smarter_private.reliability_classify('worldhub.push-health', 'PushZombieSubscriptions', 'warning', false)).incident_class <> 'monitoring_self'
     OR (smarter_private.reliability_classify('rakeback-settler-read-horizon', 'rakeback_settler_read_horizon_held', 'warning', false)).incident_class <> 'money_integrity'
     OR (smarter_private.reliability_classify('sp-daily-digest', 'DailyDigest.phone_verification_low', 'warning', false)).incident_class <> 'product_health'
     OR (smarter_private.reliability_classify('sp-daily-digest', 'DailyDigest.signups_dropped', 'warning', false)).incident_class <> 'product_health'
     OR (smarter_private.reliability_classify('sp-daily-digest', 'DailyDigest.client_crash', 'warning', false)).incident_class <> 'client_health'
     OR (smarter_private.reliability_classify('sp-daily-digest', 'DailyDigest.error_spike', 'warning', false)).incident_class <> 'client_health'
     OR (smarter_private.reliability_classify('sp-daily-digest', 'DailyDigest.new_admin', 'warning', false)).incident_class <> 'security_access'
     OR (smarter_private.reliability_classify('sp-critical-pager', 'CriticalPage.money_not_reconciling', 'critical', false)).incident_class <> 'money_integrity'
     OR (smarter_private.reliability_classify('owner-operational-notifications', 'financial_attestation:🟢 Midway burn-in gate is GREEN', 'warning', false)).is_incident IS NOT FALSE
     OR (smarter_private.reliability_classify('owner-operational-notifications', 'financial_attestation:📋 Chip integrity: attention needed', 'warning', false)).incident_class <> 'money_integrity'
     OR (smarter_private.reliability_classify('alertmanager', 'SomethingNobodyClassified', 'warning', false)).incident_class <> 'unclassified'
  THEN
    RAISE EXCEPTION 'RELIABILITY_ALERT_CLASSES_PROOF: classification contract check failed';
  END IF;

  -- Preserve prior non-incident proofs when those rules are present
  IF EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE alertname_pattern = 'HorseFleetThroughputBaselineWarming')
     AND (smarter_private.reliability_classify('alertmanager', 'HorseFleetThroughputBaselineWarming', 'warning', false)).is_incident IS NOT FALSE THEN
    RAISE EXCEPTION 'RELIABILITY_ALERT_CLASSES_PROOF: HorseFleetThroughputBaselineWarming must remain non-incident';
  END IF;
  IF EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE alertname_pattern = 'PersonBeatsHorsesBeyondTwoSE')
     AND (smarter_private.reliability_classify('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning', false)).is_incident IS NOT FALSE THEN
    RAISE EXCEPTION 'RELIABILITY_ALERT_CLASSES_PROOF: PersonBeatsHorsesBeyondTwoSE must remain non-incident';
  END IF;

  -- ── 3. Backfill existing non-closed 'unclassified' incidents ─────────────
  IF to_regclass('smarter_private.reliability_incidents') IS NOT NULL THEN
    FOR r IN
      SELECT i.id, i.fingerprint, i.source, i.alertname, i.severity, i.scope,
             i.status, i.latest_evidence
        FROM smarter_private.reliability_incidents i
       WHERE i.incident_class = 'unclassified'
         AND i.status NOT IN ('recovered', 'closed')
       ORDER BY i.created_at
       FOR UPDATE OF i
    LOOP
      v_norm := smarter_private.reliability_normalize_alertname(r.alertname);
      v_cls := smarter_private.reliability_classify(
        coalesce(r.latest_evidence->>'raw_source', r.source),
        v_norm,
        r.severity,
        false
      );
      IF v_cls.id IS NULL OR v_cls.incident_class = 'unclassified' THEN
        CONTINUE;
      END IF;

      v_new_fp := md5(
        v_cls.incident_class || '|' || r.source || '|' || r.alertname || '|' || coalesce(r.scope, '{}'::jsonb)::text
      );
      v_can_rekey := v_new_fp <> r.fingerprint
        AND NOT EXISTS (
          SELECT 1
            FROM smarter_private.reliability_incidents other
           WHERE other.fingerprint = v_new_fp
             AND other.status <> 'closed'
             AND other.id <> r.id
        );

      IF v_can_rekey AND to_regclass('smarter_private.reliability_alert_members') IS NOT NULL THEN
        UPDATE smarter_private.reliability_alert_members
           SET fingerprint = v_new_fp
         WHERE fingerprint = r.fingerprint;
      END IF;

      UPDATE smarter_private.reliability_incidents
         SET fingerprint = CASE WHEN v_can_rekey THEN v_new_fp ELSE fingerprint END,
             incident_class = v_cls.incident_class,
             class_rule_id = v_cls.id,
             title = smarter_private.reliability_one_line(v_norm, 120) || ' (' || replace(v_cls.incident_class, '_', ' ') || ')',
             group_key = v_cls.incident_class || '|' || v_norm,
             updated_at = clock_timestamp()
       WHERE id = r.id;
    END LOOP;

    -- ── 4. Close reclassified green burn-in notices via supported transition ─
    FOR r IN
      SELECT i.id, i.status
        FROM smarter_private.reliability_incidents i
       WHERE i.source = 'owner-operational-notifications'
         AND i.alertname LIKE 'financial_attestation:🟢%'
         AND i.status IN ('investigating', 'escalated', 'stale_unverified')
       ORDER BY i.created_at
       FOR UPDATE OF i
    LOOP
      IF r.status = 'investigating' THEN
        PERFORM smarter_private.reliability_transition(
          r.id,
          'stale_unverified',
          'reclassified: green Midway burn-in gate confirmation is not an incident',
          jsonb_build_object('kind', 'reclassified', 'closure_basis', 'reclassified_not_an_incident', 'by', '20261125022248')
        );
      END IF;
      PERFORM smarter_private.reliability_transition(
        r.id,
        'closed',
        'reclassified development_notification: green Midway burn-in gate confirmation is a healthy-state notice, not an incident',
        jsonb_build_object('kind', 'reclassified', 'closure_basis', 'reclassified_not_an_incident', 'by', '20261125022248')
      );
    END LOOP;

    -- ── 5. Close evidence-proved post-stale source resolutions ───────────────
    -- rakeback-settler-read-horizon and host-heartbeat rows that already
    -- recorded a timestamped resolved event after going stale_unverified,
    -- with zero firing members and zero firing inbox rows.
    IF to_regclass('public.operational_alert_events') IS NOT NULL
       AND to_regclass('smarter_private.reliability_alert_members') IS NOT NULL THEN
      FOR r IN
        SELECT i.id, i.source, i.alertname
          FROM smarter_private.reliability_incidents i
         WHERE i.status = 'stale_unverified'
           AND i.source IN ('rakeback-settler-read-horizon', 'host-heartbeat')
           AND i.last_resolved_at IS NOT NULL
           AND i.last_firing_received_at IS NOT NULL
           AND i.last_resolved_at >= i.last_firing_received_at
           AND NOT EXISTS (
             SELECT 1
               FROM smarter_private.reliability_alert_members m
              WHERE m.fingerprint = i.fingerprint
                AND m.last_firing_at >= i.opened_at
                AND m.status <> 'resolved'
           )
           AND NOT EXISTS (
             SELECT 1
               FROM public.operational_alert_events e
              WHERE e.source = i.source
                AND e.alertname = i.alertname
                AND e.status = 'firing'
           )
           AND EXISTS (
             SELECT 1
               FROM public.operational_alert_events e
              WHERE e.source = i.source
                AND e.alertname = i.alertname
                AND e.status = 'resolved'
                AND pg_input_is_valid(e.payload->>'resolved_at', 'timestamptz')
           )
         ORDER BY i.created_at
         FOR UPDATE OF i
      LOOP
        PERFORM smarter_private.reliability_transition(
          r.id,
          'closed',
          format('proved source resolution after stale_unverified for %s / %s', r.source, r.alertname),
          jsonb_build_object(
            'kind', 'source_resolved_after_stale',
            'closure_basis', 'proved_source_resolution_post_stale',
            'by', '20261125022248'
          )
        );
      END LOOP;
    END IF;
  END IF;
END
$classify_all_known_alerts$;

COMMIT;
