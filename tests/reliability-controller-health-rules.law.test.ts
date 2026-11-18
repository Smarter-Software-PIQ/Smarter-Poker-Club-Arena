/**
 * The four ReliabilityController* rules (2026-11-09) are the path by which a
 * stopped or jammed Reliability Controller reaches the operator without
 * passing through the controller. Three things keep that true and are pinned
 * here: every metric a rule reads is one the collector really writes, the
 * labels keep the alerts on Alertmanager's inbox route (and the critical ones
 * on email-critical; since 2026-11-11 warnings send no email), and missing
 * telemetry and a frozen textfile are both alerts rather than silence, with
 * Stale naming which of its two causes it is. Behaviour is evaluated
 * by tests/monitoring/reliability-controller-health.test.yml (promtool, CI).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const rules = readFileSync(join(ROOT, 'infra/monitoring/recovery-rules.yml'), 'utf8');
const group = rules.slice(rules.indexOf('- name: reliability-controller'));
const alerts = group.split('- alert: ').slice(1);
const dir = mkdtempSync(join(tmpdir(), 'reliability-rules-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('reliability controller health rules', () => {
  it('declares the four alerts on the inbox route, critical ones also on email', () => {
    expect(alerts.map((a) => a.split('\n')[0])).toEqual([
      'ReliabilityControllerStale',
      'ReliabilityControllerMetricsAbsent',
      'ReliabilityControllerOutboxStuck',
      'ReliabilityControllerIntakeRejections',
    ]);
    for (const alert of alerts) {
      // The inbox and email-critical routes match on severity alone. A
      // tournament component, a tournament/mtt/spin name or a canary/info
      // severity would stop elsewhere.
      expect(alert).toMatch(/severity: (critical|warning)\n/);
      expect(alert).toContain('component: reliability-controller\n');
      expect(alert).not.toMatch(/page:/);
      expect(alert.split('\n')[0]).not.toMatch(/tournament|mtt|spin/i);
      expect(alert).toContain('runbook: docs/reliability-controller/HEALTH-SIGNAL.md');
    }
    expect(alerts[0]).toContain('severity: critical');
    expect(alerts[1]).toContain('severity: critical');
  });

  it('missing telemetry and a frozen textfile are alerts, not silence', () => {
    expect(group).toContain('expr: absent(reliability_controller_heartbeat_age_seconds)');
    expect(group).toContain(
      'time() - max(reliability_controller_heartbeat_timestamp_seconds) > 300'
    );
  });

  it('Stale says whether the controller stopped or the textfile froze', () => {
    const stale = alerts[0];
    expect(stale).toContain('"cause", "controller_not_ticking"');
    expect(stale).toContain('"cause", "health_textfile_frozen"');
    // The two halves are exclusive on the textfile's own age.
    expect(stale).toContain(
      'unless on() (time() - max(poker_health_collected_timestamp_seconds) > 180)'
    );
    expect(stale).toContain('(time() - max(poker_health_collected_timestamp_seconds) > 180)');
    expect(stale).toMatch(
      /summary: >-\n\s+\{\{ if eq \$labels\.cause "health_textfile_frozen" \}\}/
    );
  });

  it('every metric the rules read is one the collector writes', () => {
    const envFile = join(dir, 'engine.env');
    writeFileSync(envFile, 'SUPABASE_URL=https://db.invalid\nSUPABASE_SERVICE_ROLE_KEY=test-key\n');
    const money = JSON.stringify([
      {
        settlement_failure_rate: 0,
        settlement_window_hands: 10,
        settlement_stuck: 0,
        money_undeclared_triggers: 0,
        financial_alerts_unresolved: 1,
        financial_alerts_stale_critical: 0,
        financial_alerts_distinct_conditions: 1,
        cron_pg_runs: 800,
        cron_pg_failures: 0,
        cron_openclaw_stale: 0,
        cron_openclaw_worst_silence_minutes: 0,
        cron_jobs_skipping_all_work: 0,
      },
    ]);
    const health = JSON.stringify([
      {
        heartbeat_at_unix: 1794250000.25,
        heartbeat_age_seconds: 21,
        notifications_queued: 0,
        notifications_failed_24h: 0,
        intake_rejections_24h: 0,
        mutation_paused: true,
        notify_mode: 'observe',
      },
    ]);
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'curl'),
      `#!/usr/bin/env bash
case "$*" in
  *fn_monitoring_health_snapshot*) printf '%s' '${money}' ;;
  *fn_reliability_controller_health*) printf '%s' '${health}' ;;
  *) exit 7 ;;
esac
`
    );
    chmodSync(join(bin, 'curl'), 0o755);
    const out = execFileSync('bash', [join(ROOT, 'server/scripts/collect-monitoring-health.sh')], {
      env: { PATH: `${bin}:${process.env.PATH}`, ENGINE_ENV_FILE: envFile, DRY_RUN: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const named = new Set(group.match(/(?<![a-z_])reliability_controller_[a-z0-9_]+/g));
    expect(named.size).toBeGreaterThanOrEqual(5);
    // Stale also reads the collector's own collection time, from the same file.
    named.add('poker_health_collected_timestamp_seconds');
    for (const metric of named) {
      expect(out, metric).toMatch(new RegExp(`^${metric}(\\{[^}]*\\})? `, 'm'));
    }
  });

  it('the promtool and routing proof runs in CI', () => {
    const script = readFileSync(join(ROOT, 'scripts/ci/test-fleet-throughput.sh'), 'utf8');
    expect(script).toContain('reliability-controller-health.test.yml');
    // Critical: inbox plus email-critical. Warning: inbox only (2026-11-11).
    for (const [alert, receivers] of [
      ['ReliabilityControllerStale', 'codex-inbox,email-critical'],
      ['ReliabilityControllerMetricsAbsent', 'codex-inbox,email-critical'],
      ['ReliabilityControllerOutboxStuck', 'codex-inbox,email-critical'],
      ['ReliabilityControllerIntakeRejections', 'codex-inbox'],
    ]) {
      expect(script).toContain(
        `route --verify.receivers=${receivers} \\\n  alertname=${alert} severity=`
      );
    }
    expect(script).not.toContain('email-warning');
  });

  it('the retired warning email receiver sends nothing and no route reaches it', () => {
    const am = readFileSync(join(ROOT, 'infra/monitoring/alertmanager.yml'), 'utf8').replace(
      /^\s*#[^\n]*$/gm,
      ''
    );
    expect(am).not.toMatch(/receiver:\s*email-warning/);
    const receiver = am.slice(am.indexOf('- name: email-warning'));
    expect(receiver.split(/\n {2}- name: /)[0]).not.toMatch(/_configs:/);
    expect(am).toMatch(
      /- severity="warning"\n\s+- page!="sms"\n\s+receiver: codex-inbox\n[\s\S]*?continue: false/
    );
  });
});
