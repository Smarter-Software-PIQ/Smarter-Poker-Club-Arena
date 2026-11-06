import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('existing release recovery evidence stays a fixed read', () => {
  it('pins the current diagnostic producers on every platform', () => {
    const root = resolve(__dirname, '..');
    const reader = readFileSync(
      resolve(root, 'scripts/ci/read-scoped-release-recovery.py'),
      'utf8'
    );
    const current = reader.match(/^RETAINED_REFUSAL_SOURCES = (\{[^\n]+\})$/m)?.[1];
    expect(current).toBeDefined();
    for (const name of ['engine-release-seal.py', 'engine-release-transaction.sh']) {
      const digest = createHash('sha256')
        .update(readFileSync(resolve(root, 'server/scripts', name)))
        .digest('hex');
      expect(current).toContain(`'${name}': '${digest}'`);
    }
  });

  it('executes the native exact-run, filesystem, export and transport refusal fixtures', () => {
    const root = resolve(__dirname, '..');
    const result = spawnSync('python3', ['-B', 'tests/operations/release-recovery-read.test.py'], {
      cwd: root,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Ran 196 tests/);
    if (process.platform === 'linux') expect(result.stderr).not.toMatch(/skipped=/);
  });
});
