import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  QUALIFICATION_GIT_MAX_BUFFER,
  qualificationGit,
} from './IncrementalPressureQualification.js';

// The decision-closure binding reads `git ls-files server`, which already
// prints about 1.5 MB. Under Node's 1 MiB execFileSync default the provider
// threw ENOBUFS after the held-out partition was reserved, so the first
// closure-bound dispatch would have burned its hands without dealing one.
const NODE_DEFAULT = 1024 * 1024;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

describe('the qualification provider reads large git output', () => {
  it('returns output larger than Node default buffer instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qual-git-'));
    try {
      execFileSync('git', ['init', '-q', dir], { env });
      const value = 'x'.repeat(2 * NODE_DEFAULT);
      appendFileSync(join(dir, '.git', 'config'), `[probe]\n\tbig = ${value}\n`);
      expect(() =>
        execFileSync('git', ['config', '--get', 'probe.big'], { cwd: dir, env, encoding: 'utf8' })
      ).toThrow(/ENOBUFS/);
      expect(qualificationGit(dir, env)('config', '--get', 'probe.big')).toBe(value);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the tracked server listing the closure binding needs', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const listing = qualificationGit(root, env)('ls-files', 'server');
    expect(listing.split('\n')).toContain(
      'server/src/benchmark/IncrementalPressureQualification.ts'
    );
    expect(QUALIFICATION_GIT_MAX_BUFFER).toBeGreaterThan(64 * listing.length);
  });

  it('every git read in the provider goes through the bounded helper', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./IncrementalPressureQualification.ts', import.meta.url)),
      'utf8'
    );
    const raw = source.match(/execFileSync\(\s*'git'/g) ?? [];
    expect(raw).toHaveLength(1);
    expect(source).toMatch(/maxBuffer: QUALIFICATION_GIT_MAX_BUFFER/);
    expect(source).toMatch(/const git = qualificationGit\(root, env\);/);
  });
});
