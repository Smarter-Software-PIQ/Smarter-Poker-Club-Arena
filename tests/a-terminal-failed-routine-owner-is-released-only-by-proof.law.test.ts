/**
 * An expired failed routine owner stops blocking later cycles only through a
 * recorded terminal-failure proof made under the engine and seal locks: its
 * durable failure, restored desired runtime, absent request files and fully
 * stopped, disabled native units. The owner gate never probes native state,
 * and any unknown keeps the owner authoritative.
 */
import { beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// Fixture transport is explicit preparation, separate from the unchanged
// network-free behavior deadline. The helper kills its owned transport group
// within90seconds; the outer process/hook retain cleanup/reporting headroom.
beforeAll(() => {
  const prepared = spawnSync(
    'python3',
    ['-B', 'tests/operations/terminal-failed-routine-owner.py', '--prepare-history'],
    {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      timeout: 95000,
    }
  );
  expect(prepared.error, prepared.stdout + prepared.stderr).toBeUndefined();
  expect(prepared.signal, prepared.stdout + prepared.stderr).toBeNull();
  expect(prepared.status, prepared.stdout + prepared.stderr).toBe(0);
}, 100000);

it('records a terminal failed owner only under complete proof and keeps every unproved owner', () => {
  // Keep this real consumer selected when the shared preparation helper changes.
  expect(
    readFileSync(
      resolve(import.meta.dirname, '../tests/operations/pinned-history-sources.py'),
      'utf8'
    )
  ).toContain("GIT_NO_LAZY_FETCH='1'");
  const result = spawnSync('python3', ['-B', 'tests/operations/terminal-failed-routine-owner.py'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout + result.stderr).toContain('Ran 50 tests');
  expect(result.stdout + result.stderr).toContain('OK');
}, 35000);
