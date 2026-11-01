import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
const workflow = YAML.parse(readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8'));
const lane = workflow.jobs['live-table-e2e'];
const origin = workflow.jobs['publication-gate'].steps.find((s: any) => s.id === 'origin');
const observation = lane.steps.find((s: any) => s.id === 'natural_addon');
describe('natural add-on is a narrow existing-lane observation', () => {
  it('shell admission rejects malformed, null and mixed explicit inputs', () => {
    const script = origin.run;
    const env = {
      ...process.env,
      EVENT_NAME: 'repository_dispatch',
      GITHUB_OUTPUT: '/dev/null',
      ENGINE_TRIGGER_SHA: 'a'.repeat(40),
      ENGINE_TRIGGER_JSON: JSON.stringify('a'.repeat(40)),
      MOBILE_MULTIRUN_JSON: 'null',
      MOBILE_MULTIRUN_TARGET_JSON: 'null',
      HORSE_SOCIAL_JSON: 'null',
      CLIENT_NAVIGATION_JSON: 'null',
    };
    const base = {
      natural_addon_tournament_id: '11111111-1111-4111-8111-111111111111',
      engine_sha: 'a'.repeat(40),
    };
    expect(() => execFileSync('bash', ['-n'], { input: origin.run })).not.toThrow();
    expect(() =>
      execFileSync('bash', ['-c', script], {
        env: { ...env, CLIENT_NAVIGATION_PAYLOAD: JSON.stringify(base) },
        stdio: 'pipe',
      })
    ).not.toThrow();
    for (const payload of [
      { ...base, natural_addon_tournament_id: null },
      { ...base, engine_sha: 'short' },
      { ...base, client_navigation: true },
    ])
      expect(() =>
        execFileSync('bash', ['-c', script], {
          env: { ...env, CLIENT_NAVIGATION_PAYLOAD: JSON.stringify(payload) },
          stdio: 'pipe',
        })
      ).toThrow();
  });
  it('isolates the time-bound observation from publisher and other passive queues', () => {
    const expression = lane.concurrency.group
      .slice(3, -2)
      .trim()
      .replaceAll('needs.publication-gate', "needs['publication-gate']");
    const queue = (event: string, payload: Record<string, unknown>, admitted = false) =>
      new Function('github', 'needs', 'toJSON', `return (${expression})`)(
        { event_name: event, event: { client_payload: payload } },
        { 'publication-gate': { outputs: { natural_addon: String(admitted) } } },
        (value: unknown) => JSON.stringify(value ?? null)
      );
    const natural = queue('repository_dispatch', { natural_addon_tournament_id: 'target' }, true);
    expect(natural).toBe('post-deploy-live-table-natural-addon-production');
    expect(queue('workflow_run', {}, false)).toBe('post-deploy-live-table-production');
    expect(queue('repository_dispatch', {}, false)).toBe('post-deploy-live-table-production');
    expect(queue('repository_dispatch', { mobile_multirun: true })).toBe(
      'post-deploy-live-table-multirun-production'
    );
    expect(queue('repository_dispatch', { horse_social: true })).toBe(
      'post-deploy-live-table-horse-social-production'
    );
    expect(lane.concurrency['cancel-in-progress']).toBe(false);
  });
  it('keeps isolated account creation, spectator membership, cleanup and exact provenance', () => {
    expect(observation.run).toContain('production-natural-addon.spec.ts');
    expect(observation.run).toContain('--workers=1 --retries=0');
    expect(observation.run).toContain('assert-e2e-actually-ran.mjs');
    expect(observation.run).toContain('production-e2e-provenance.mjs release-window');
    const runs = lane.steps.map((s: any) => s.run || '').join('\n');
    for (const operation of ['create', 'prepare-spectator', 'cleanup'])
      expect(runs).toContain(`production-e2e-account.mjs ${operation}`);
    const cleanup = lane.steps.find(
      (s: any) => s.run === 'node scripts/ci/production-e2e-account.mjs cleanup'
    );
    expect(cleanup.if).toContain('always()');
    expect(cleanup.if).not.toContain('natural_addon');
    expect(workflow.jobs['post-deploy-verdict'].if).toContain("natural_addon != 'true'");
    expect(lane.steps.find((s: any) => s.id === 'live_coverage').if).toContain(
      "natural_addon != 'true'"
    );
    expect(lane.steps.find((s: any) => s.id === 'release_window').run).toContain(
      'LIVE_COVERAGE_COMPLETE'
    );
  });
});
