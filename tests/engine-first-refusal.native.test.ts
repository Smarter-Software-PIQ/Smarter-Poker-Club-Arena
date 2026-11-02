import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('retains the original release refusal without changing release authority or exit status', () => {
  const result = spawnSync(
    'python3',
    ['-B', join(process.cwd(), 'tests/operations/engine-first-refusal.test.py')],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 }
  );
  const output = `${result.stdout}\n${result.stderr}`;
  expect(result.error, output).toBeUndefined();
  expect(result.status, output).toBe(0);
  expect(output).toContain('Ran 13 tests');
  expect(output).toMatch(/\nOK\s*$/);
  expect(output).not.toMatch(/skipped|FAILED|ERROR/);
}, 35_000);
