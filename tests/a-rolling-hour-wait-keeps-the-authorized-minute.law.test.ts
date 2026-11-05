import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

// recovery-rolling-eligibility.py executes server/scripts/engine-release-transaction.sh
// and server/scripts/engine-release-seal.py; retain both transitive source bindings
// so the normal affected-test selector runs this law when either source changes.
it('keeps authoritative rolling-hour eligibility inside the existing owner minute', () => {
  const result = spawnSync(
    'python3',
    ['-B', resolve('tests/operations/recovery-rolling-eligibility.py')],
    {
      encoding: 'utf8',
      timeout: 30_000,
    }
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toContain('Ran 12 tests');
}, 35_000);
