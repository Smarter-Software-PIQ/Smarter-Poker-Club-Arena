import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('loads the real candidate feature dependency graph before refusing an absent private fixture', () => {
  const run = spawnSync(
    process.execPath,
    ['scripts/ci/probes/horse-phase4-certified-solver/run-public215-feature-parity.mjs'],
    {
      env: { ...process.env, PGHOST: '', V31_FEATURE_PRIVATE_FIXTURE_ROOT: '' },
      encoding: 'utf8',
    }
  );
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('public215 parity requires its own disconnected fixture socket');
  expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
});
