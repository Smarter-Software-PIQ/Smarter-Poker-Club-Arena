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
    // CI checks out with `filter: blob:none`, so the historical sources this
    // proof reads with `git show <sha>:...` are fetched lazily, one blob per
    // round trip. The 50 cases run in about a second; the fetches alone ran
    // past 30 s on busy runners (39 of 50 cases done, status null).
    timeout: 120000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout + result.stderr).toContain('Ran 50 tests');
  expect(result.stdout + result.stderr).toContain('OK');
}, 125000);
