import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

// Connected consumers: engine-release-database-proof.py, engine-release-transaction.sh,
// engine-release-seal.py, legacy-engine-checkpoint.sh, legacy-engine-checkpoint.mjs and native/legacy-census.cc.
it('proves certified publisher ownership, complete clock credit and terminal cleanup', () => {
  const result = spawnSync('python3', ['-B', 'tests/operations/certified-checkpoint-contract.py'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toContain('Ran 9 tests');
}, 35_000);

it('runs the real bounded legacy adapter allocation and transport checks', () => {
  const result = spawnSync(
    process.execPath,
    ['--test', 'tests/operations/eed-checkpoint-helper-budget.test.mjs'],
    {
      encoding: 'utf8',
      timeout: 30_000,
    }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain('# pass 8');
}, 35_000);
