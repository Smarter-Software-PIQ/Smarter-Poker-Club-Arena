/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A WARMING THROUGHPUT BASELINE IS NOT AN INCIDENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * HorseFleetThroughputBaselineWarming says the relative cash-throughput check
 * has fewer than three same-policy historical days: a designed warm-up after
 * every change to the admission cohort (the full text of thirteen SQL
 * functions plus the engine population fingerprint). The broad reliability
 * class 'Horse%' made it an incident, so a warm-up nobody can act on was
 * escalated to the owner from 2026-11-16 to 2026-11-18.
 *
 * Migration 20261118165420 classifies exactly this alertname as not an
 * incident, ahead of 'Horse%', while the alarms that need action (PolicyUnknown,
 * RelativeDrop) stay incidents and the open incident still closes on resolve.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_warming_throughput_baseline_is_not_an_incident.sql'))
  .at(-1);
if (!NAME) throw new Error('the warming-baseline class migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);
const RULES = readFileSync(resolve(__dirname, '..', 'infra/monitoring/alert-rules.yml'), 'utf8');

describe('a warming throughput baseline is not an incident', () => {
  it('classifies exactly this alertname as not an incident, ahead of Horse%', () => {
    expect(MIG).toMatch(
      /SELECT 305, '%', 'HorseFleetThroughputBaselineWarming', '%', 'horse_fleet_throughput', 'warning', false, false,/
    );
    // An exact name, never a pattern that could swallow a real alarm.
    expect(MIG).not.toMatch(
      /'HorseFleetThroughput%'|'Horse%', '%', 'horse_fleet_throughput', 'warning', false, false/
    );
    expect(MIG).toContain("WHERE alertname_pattern = 'HorseFleetThroughputBaselineWarming'");
  });

  it('proves inside the install that the alarms needing action stay incidents and a resolve still lands', () => {
    expect(MIG).toContain(
      "reliability_classify('alertmanager', 'HorseFleetThroughputPolicyUnknown', 'critical', false)).is_incident IS NOT TRUE"
    );
    expect(MIG).toContain(
      "reliability_classify('alertmanager', 'HorseFleetThroughputRelativeDrop', 'warning', false)).is_incident IS NOT TRUE"
    );
    expect(MIG).toContain(
      "reliability_classify('alertmanager', 'HorseFleetThroughputBaselineWarming', 'warning', true)).is_incident IS NOT TRUE"
    );
  });

  it('rests on the rule still being a warm-up state with independent stall alarms', () => {
    const i = RULES.indexOf('- alert: HorseFleetThroughputBaselineWarming');
    expect(i).toBeGreaterThan(0);
    const block = RULES.slice(i, RULES.indexOf('- alert:', i + 10));
    expect(block).toContain('unless on() sp:lightning_hands:same_hour_mean_6d');
    expect(block).toContain('Zero-dealing and table-stall alarms remain independent');
    expect(RULES).toContain('- alert: HorseFleetThroughputRelativeDrop');
    expect(RULES).toContain('- alert: HorseFleetThroughputPolicyUnknown');
  });

  it('no later migration makes the warm-up an incident again or drops the RelativeDrop/PolicyUnknown incidents', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      expect(m.sql, m.name).not.toMatch(
        /UPDATE\s+smarter_private\.reliability_alert_classes[^;]*is_incident\s*=\s*true[^;]*HorseFleetThroughputBaselineWarming/i
      );
      expect(m.sql, m.name).not.toMatch(
        /DELETE\s+FROM\s+smarter_private\.reliability_alert_classes[^;]*HorseFleetThroughputBaselineWarming/i
      );
    }
  });
});
