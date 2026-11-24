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

test('the parallel native scan reads every file of a corpus larger than one batch per lane', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-migrations-many-'));
  try {
    const expected = [];
    for (let i = 0; i < 301; i++) {
      const name = `${String(i).padStart(14, '0')}_m.sql`;
      writeFileSync(
        join(root, name),
        i % 3 === 0 ? `-- @install-window ${i}\n` : `-- plain ${i}\n`
      );
      if (i % 3 === 0) expected.push(join(root, name));
    }
    const calls = [];
    const fallback = (command, args, options) => {
      calls.push([command, args]);
      return command === 'rg'
        ? { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }
        : spawnSync(command, args, options);
    };
    const result = nativeMigrationSelection('@install-window', root, { runner: fallback });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.stdout.trim().split('\n'), expected.sort());
    // One xargs over the complete list, split into more batches than lanes.
    assert.deepEqual(
      calls.map(([command]) => command),
      ['rg', 'xargs']
    );
    const args = calls[1][1];
    assert.ok(Number(args[args.indexOf('-n') + 1]) < 301);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed grep batch fails the whole native selection, never a partial success', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-migrations-fail-'));
  try {
    writeFileSync(join(root, 'one.sql'), 'exact.guard\n');
    const runner = (command) =>
      command === 'rg'
        ? { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }
        : { status: 124, stdout: `${join(root, 'one.sql')}\n`, stderr: '' };
    const result = nativeMigrationSelection('exact.guard', root, { runner });
    assert.equal(result.status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
