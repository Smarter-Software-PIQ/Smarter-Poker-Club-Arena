/**
 * An expired failed routine owner stops blocking later cycles only through a
 * recorded terminal-failure proof made under the engine and seal locks: its
 * durable failure, restored desired runtime, absent request files and fully
 * stopped, disabled native units. The owner gate never probes native state,
 * and any unknown keeps the owner authoritative.
 */
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

it('records a terminal failed owner only under complete proof and keeps every unproved owner', () => {
  const result = spawnSync('python3', ['-B', 'tests/operations/terminal-failed-routine-owner.py'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout + result.stderr).toContain('Ran 3 tests');
  expect(result.stdout + result.stderr).toContain('OK');
}, 35000);
