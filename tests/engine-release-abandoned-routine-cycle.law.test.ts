/**
 * An expired failed routine owner retains custody until its original,
 * explicitly qualified resolution. Expiry and systemctl error exits grant
 * no retirement or replay authority. Real seal subprocesses pin this boundary.
 */
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

it('preserves failed original ownership and refuses unverified retirement history', () => {
  const result = spawnSync(
    'python3',
    ['-B', 'tests/operations/failed-routine-owner-preservation.py'],
    {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      timeout: 30000,
    }
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout + result.stderr).toContain('Ran 5 tests');
  expect(result.stdout + result.stderr).toContain('OK');
}, 35000);
