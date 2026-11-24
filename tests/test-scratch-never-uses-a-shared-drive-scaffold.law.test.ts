import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * TEST SCRATCH NEVER USES A SHARED DRIVE SCAFFOLD (2026-11-24, incident fix audit).
 * On the Mac, /Volumes/SmarterWork/agent-work can be a read-only compatibility
 * scaffold (OWNER-POLICY, SSD availability). Tests that fell back to it for
 * mkdtemp failed with EACCES whenever TMPDIR was unset, and on 2026-11-17 that
 * failure blocked pre-push hooks for several agents. A test's scratch falls back
 * to the runner temp, TMPDIR, or the checkout's own node_modules/.cache.
 */
const ROOT = join(__dirname, '..');
function files(): string[] {
  // Tracked test sources only (git ls-files): fast, and never a generated tree.
  // git grep narrows to the test sources that make a temporary directory at all.
  let listed = '';
  try {
    listed = execFileSync('git', ['grep', '-lz', '--untracked', 'mkdtempSync', '--', 'tests'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error; // 1 = no match
  }
  return listed
    .split('\0')
    .filter((f) => /\.(test|spec)\.(ts|tsx|mts|js|mjs)$/.test(f))
    .filter((f) => !f.endsWith('test-scratch-never-uses-a-shared-drive-scaffold.law.test.ts'));
}
export function scaffoldFallbacks(source: string): number {
  let n = 0;
  for (const m of source.matchAll(/mkdtempSync\(/g)) {
    if (source.slice(m.index!, m.index! + 400).includes("'/Volumes/SmarterWork/agent-work'")) n++;
  }
  return n;
}

describe('test scratch never uses a shared drive scaffold', () => {
  it('no test makes its scratch directory under the agent-work scaffold', () => {
    const offenders = files().filter(
      (f) => scaffoldFallbacks(readFileSync(join(ROOT, f), 'utf8')) > 0
    );
    expect(offenders).toEqual([]);
  });
  it('recognises the shape that failed with EACCES on 2026-11-17', () => {
    const before =
      "fs.mkdtempSync(path.join(process.env.TMPDIR || (process.platform === 'darwin' ? '/Volumes/SmarterWork/agent-work' : tmpdir()), 'x-'))";
    expect(scaffoldFallbacks(before)).toBe(1);
  });
});
