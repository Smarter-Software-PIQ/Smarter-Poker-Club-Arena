import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
const workflow = (name: string) => parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
it('doubles only the declared qualification envelopes and preserves production operation budgets', () => {
  const expected = {
    'ci.yml': {
      changes: 10,
      source_windows: 12,
      typecheck: 4,
      typecheck_compile: 40,
      unit_shards: 30,
      accounting_postgres: 100,
      server_shards: 80,
      verdict: 4,
      build: 30,
      'live-e2e': 50,
      'css-beats-build': 30,
      'css-beats-e2e': 60,
      'diamond-playfield-e2e': 50,
    },
    'auto-deploy-hetzner.yml': {
      preflight: 80,
      deploy: 210,
      'engine-doors': 10,
      'record-receipt': 4,
      'withdraw-waiting-release': 4,
      'observe-private-horse-fleet': 35,
    },
    'publish-club-arena-client.yml': {
      admit: 10,
      'client-tests': 40,
      'build-and-store': 60,
      'publication-floor': 3,
    },
    'engine-build-resource-proof.yml': { containment: 80 },
    'source-bindings.yml': { verify: 10 },
  };
  for (const [name, jobs] of Object.entries(expected)) {
    const source = workflow(name);
    for (const [job, minutes] of Object.entries(jobs))
      expect(source.jobs[job]['timeout-minutes'], `${name}:${job}`).toBe(minutes);
  }
  const driver = readFileSync(
    'server/scripts/qualification/retained-original-checkpoint/qualify.mjs',
    'utf8'
  );
  expect(driver).toContain('nativeMode ? 180000 : 360000');
  const wrapper = readFileSync(
    'server/src/engine/RetainedHistoricalCheckpointQualification.test.ts',
    'utf8'
  );
  expect(wrapper).toContain('timeout: 390_000');
  expect(wrapper).toContain('}, 420_000)');
});
