/**
 * The event-database bulkhead early-warning alarms are wired end to end:
 * engine Prometheus series -> alert-rules.yml -> runbook -> promtool + amtool CI.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

const ROOT = join(__dirname, '..');
type Rule = {
  alert?: string;
  expr?: string;
  for?: string;
  keep_firing_for?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};
const rules = (
  YAML.parse(readFileSync(join(ROOT, 'infra/monitoring/alert-rules.yml'), 'utf8')) as {
    groups: { name: string; rules: Rule[] }[];
  }
).groups.flatMap((g) => g.rules);
const rule = (name: string) => rules.find((r) => r.alert === name);

describe('event database bulkhead Prometheus telemetry and early-warning alarms', () => {
  it('defines EventDbBulkheadSaturated and EventDbBulkheadOpen warning alerts in alert-rules.yml', () => {
    const saturated = rule('EventDbBulkheadSaturated');
    expect(saturated, 'EventDbBulkheadSaturated alert missing').toBeDefined();
    expect(saturated!.expr).toContain('poker_event_db_bulkhead_park_timeouts_total');
    expect(saturated!.expr).toContain('poker_event_db_bulkhead_refused_full_total');
    expect(saturated!.labels).toMatchObject({ severity: 'warning', component: 'database' });
    expect(saturated!.keep_firing_for).toBe('10m');
    expect(saturated!.annotations?.runbook).toBe('docs/runbooks/event-db-bulkhead.md');

    const open = rule('EventDbBulkheadOpen');
    expect(open, 'EventDbBulkheadOpen alert missing').toBeDefined();
    expect(open!.expr!.trim()).toBe('poker_event_db_bulkhead_open == 1');
    expect(open!.for).toBe('5m');
    expect(open!.labels).toMatchObject({ severity: 'warning', component: 'database' });
    expect(open!.annotations?.runbook).toBe('docs/runbooks/event-db-bulkhead.md');
  });

  it('publishes all eventDbBulkhead Prometheus series from GameServer /metrics at cold start', () => {
    const bulkheadSrc = readFileSync(
      join(ROOT, 'server/src/services/supabase/eventDatabaseBulkhead.ts'),
      'utf8'
    );
    const expectedMetrics = [
      'poker_event_db_bulkhead_open',
      'poker_event_db_bulkhead_in_flight',
      'poker_event_db_bulkhead_parked_current',
      'poker_event_db_bulkhead_cooling_current',
      'poker_event_db_bulkhead_active_events',
      'poker_event_db_bulkhead_throttled_events',
      'poker_event_db_bulkhead_parked_total',
      'poker_event_db_bulkhead_park_timeouts_total',
      'poker_event_db_bulkhead_refused_full_total',
    ];
    for (const metric of expectedMetrics) {
      expect(bulkheadSrc).toContain(metric);
    }
    const gameServerSrc = readFileSync(join(ROOT, 'server/src/GameServer.ts'), 'utf8');
    expect(gameServerSrc).toContain('...eventDbBulkheadPrometheusLines(),');
  });

  it('includes a runbook and promtool/amtool CI coverage', () => {
    expect(existsSync(join(ROOT, 'docs/runbooks/event-db-bulkhead.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'tests/monitoring/event-db-bulkhead.test.yml'))).toBe(true);
    const script = readFileSync(join(ROOT, 'scripts/ci/test-fleet-throughput.sh'), 'utf8');
    expect(script).toContain('event-db-bulkhead.test.yml');
    expect(script).toContain('alertname=EventDbBulkheadSaturated');
    expect(script).toContain('alertname=EventDbBulkheadOpen');
  });
});
