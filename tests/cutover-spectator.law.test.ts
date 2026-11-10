import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { correlateSpectator } from '../scripts/ci/correlate-cutover-spectator.mjs';

const run = '123-1';
const receipt = {
  runId: run,
  result: 'sealed',
  sha: 'a'.repeat(40),
  instanceId: '1-abcd1234',
  completionRuntime: { instanceId: '1-abcd1234' },
  startedAt: '2026-11-10T10:00:15Z',
};
const started = Date.parse(receipt.startedAt);
const witness = {
  runId: run,
  target: receipt.sha,
  predecessor: 'b'.repeat(40),
  beforeInstance: '1-eeeeeeee',
  afterInstance: receipt.instanceId,
  sameAuthenticatedSpectator: true,
  tableId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  armedAt: started - 5000,
  freeze: started - 1000,
  thaw: started + 1000,
  restoredAt: started + 2000,
  handNumber: 100,
  committedAt: new Date(started + 5000).toISOString(),
};

describe('authenticated cutover spectator', () => {
  it('binds the same fixture and its committed hand to the original sealed instance and freeze', () => {
    expect(correlateSpectator(receipt, witness, run)).toMatchObject({
      fixtureCleanupVerified: true,
    });
  });
  it.each([
    { runId: '123-2' },
    { afterInstance: witness.beforeInstance },
    { armedAt: started },
    { thaw: started - 1 },
    { restoredAt: started - 1 },
    { committedAt: receipt.startedAt },
    { sameAuthenticatedSpectator: false },
  ])('refuses broken provenance %o', (delta) => {
    expect(() => correlateSpectator(receipt, { ...witness, ...delta }, run)).toThrow();
  });
  it('does not let either observer gate the production owner or change its workflow conclusion', () => {
    const { jobs } = parse(readFileSync('.github/workflows/auto-deploy-hetzner.yml', 'utf8'));
    expect(jobs['cutover-spectator'].needs).toBe('preflight');
    expect(jobs['cutover-spectator']['continue-on-error']).toBe(true);
    expect(jobs['correlate-cutover-spectator']['continue-on-error']).toBe(true);
    for (const [name, job] of Object.entries(jobs) as [string, { needs?: string | string[] }][]) {
      if (name !== 'correlate-cutover-spectator')
        expect([job.needs].flat()).not.toContain('cutover-spectator');
      expect([job.needs].flat()).not.toContain('correlate-cutover-spectator');
    }
  });
});
