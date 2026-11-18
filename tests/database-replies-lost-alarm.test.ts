/**
 * The lost-database-reply alarm (2026-11-05) is wired end to end:
 * engine counter -> Prometheus rule -> Alertmanager route -> operational inbox.
 *
 * - the two rules read the counters the engine seeds at zero
 *   (server/src/services/supabase/dbReplyMetrics.ts), split warning from
 *   critical, and hold one episode with keep_firing_for so they auto-resolve
 *   after ten quiet minutes;
 * - CI really evaluates their timing (promtool) and their routing (amtool)
 *   with pinned official images, in the script ci.yml runs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

const ROOT = join(__dirname, '..');
type Rule = {
  alert?: string;
  expr?: string;
  for?: string;
  keep_firing_for?: string;
  labels?: Record<string, string>;
};
const rules = (
  YAML.parse(readFileSync(join(ROOT, 'infra/monitoring/alert-rules.yml'), 'utf8')) as {
    groups: { rules: Rule[] }[];
  }
).groups.flatMap((g) => g.rules);
const rule = (name: string) => rules.find((r) => r.alert === name)!;

describe('the lost-database-reply alarm', () => {
  it('warns on five lost replies in a minute and is critical on any exhausted retry', () => {
    const lost = rule('DatabaseRepliesLost');
    expect(lost.expr!.trim()).toBe('sum(increase(poker_db_lost_replies_total[1m])) >= 5');
    expect(lost.labels).toMatchObject({ severity: 'warning', component: 'database' });
    const exhausted = rule('DatabaseWriteRetriesExhausted');
    expect(exhausted.expr!.trim()).toBe(
      'sum by (rpc) (increase(poker_db_rpc_retries_total{outcome="exhausted"}[1m])) > 0'
    );
    expect(exhausted.labels).toMatchObject({ severity: 'critical', component: 'database' });
    for (const r of [lost, exhausted]) {
      expect(r.keep_firing_for).toBe('10m');
      // A lost reply is never something the maintenance break schedules.
      expect(r.expr).not.toContain('poker_maintenance_break_active');
    }
  });

  it('reads series the engine publishes at zero on a cold start', () => {
    const src = readFileSync(join(ROOT, 'server/src/services/supabase/dbReplyMetrics.ts'), 'utf8');
    expect(src).toContain('poker_db_lost_replies_total{kind="${k}"}');
    expect(src).toContain('poker_db_rpc_retries_total{rpc="${rpc}",outcome="${o}"}');
    expect(readFileSync(join(ROOT, 'server/src/GameServer.ts'), 'utf8')).toContain(
      '...dbReplyPrometheusLines(),'
    );
  });

  it('CI evaluates the timing and the routing to the inbox', () => {
    const script = readFileSync(join(ROOT, 'scripts/ci/test-fleet-throughput.sh'), 'utf8');
    expect(script).toContain('database-replies-lost.test.yml');
    expect(script).toContain(
      'quay.io/prometheus/alertmanager@sha256:e13b6ed5cb929eeaee733479dce55e10eb3bc2e9c4586c705a4e8da41e5eacf5'
    );
    expect(script).toMatch(
      /--verify\.receivers=codex-inbox \\\n\s+alertname=DatabaseRepliesLost severity=warning/
    );
    expect(script).toMatch(
      /--verify\.receivers=codex-inbox,email-critical \\\n\s+alertname=DatabaseWriteRetriesExhausted severity=critical/
    );
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('bash scripts/ci/test-fleet-throughput.sh');
    const cases = readFileSync(
      join(ROOT, 'tests/monitoring/database-replies-lost.test.yml'),
      'utf8'
    );
    for (const phrase of ['never fires', 'is a warning, then resolves', 'is critical at once'])
      expect(cases).toContain(phrase);
  });
});
