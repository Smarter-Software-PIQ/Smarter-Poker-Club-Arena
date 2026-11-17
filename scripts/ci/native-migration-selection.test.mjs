import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeMigrationSelection } from './native-migration-selection.mjs';

test('missing rg uses a complete native grep scan, including ignored and linked SQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-migrations-'));
  try {
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, '.gitignore'), '*.sql\n');
    writeFileSync(join(root, 'one.sql'), 'exact.guard\n');
    writeFileSync(join(root, 'nested/two.sql'), 'exact.guard\n');
    writeFileSync(join(root, 'other.txt'), 'exact.guard\n');
    symlinkSync(join(root, 'one.sql'), join(root, 'linked.sql'));
    const missing = { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) };
    const fallback = (command, args, options) =>
      command === 'rg' ? missing : spawnSync(command, args, options);
    const result = nativeMigrationSelection('exact.guard', root, { fixed: true, runner: fallback });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(
      result.stdout.trim().split('\n').sort(),
      ['linked.sql', 'nested/two.sql', 'one.sql'].map((p) => join(root, p)).sort()
    );
    assert.equal(nativeMigrationSelection('absent', root, { runner: fallback }).status, 1);
    assert.equal(
      nativeMigrationSelection('x', join(root, 'missing'), { runner: fallback }).status,
      2
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('read, timeout and permission errors never fall back or become an empty success', () => {
  for (const result of [
    { status: 2, stderr: 'read error' },
    { error: { code: 'ETIMEDOUT' } },
    { error: { code: 'EACCES' } },
  ]) {
    let calls = 0;
    assert.equal(
      nativeMigrationSelection('x', 'supabase/migrations', {
        runner: () => {
          calls++;
          return result;
        },
      }),
      result
    );
    assert.equal(calls, 1);
  }
});
