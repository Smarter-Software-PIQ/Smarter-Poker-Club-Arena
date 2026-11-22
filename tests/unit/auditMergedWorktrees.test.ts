import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT_PATH = resolve(ROOT, 'scripts/ops/audit-merged-worktrees.sh');

function pickTempBase(): string {
  // Prefer verified external SSD work volume on Ops Mac; fall back to os.tmpdir() on CI runners.
  for (const candidate of [
    '/Volumes/SmarterWork/agent-work/shared-capacity',
    '/Volumes/SmarterWork/agent-work/extreme-capacity',
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return tmpdir();
}

function stripCommentsAndQuotedLiterals(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) =>
      line
        // Blank out single-quoted strings (such as printf format strings)
        .replace(/'[^']*'/g, "''")
        // Blank out double-quoted strings in printf/echo lines
        .replace(/^\s*(?:printf|echo)\s+.*$/, '')
    )
    .join('\n');
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim();
}

describe('scripts/ops/audit-merged-worktrees.sh', () => {
  it('passes bash syntax check and contains zero executable mutating commands', () => {
    execFileSync('bash', ['-n', SCRIPT_PATH], { encoding: 'utf8' });

    const raw = readFileSync(SCRIPT_PATH, 'utf8');
    const executable = stripCommentsAndQuotedLiterals(raw);

    expect(executable).not.toMatch(/\brm\s+/);
    expect(executable).not.toMatch(/\bgit\b[^\n]*\bworktree\s+remove\b/);
    expect(executable).not.toMatch(/\bgit\b[^\n]*\bworktree\s+prune\b/);
    expect(executable).not.toMatch(/\bgit\b[^\n]*\breset\b/);
    expect(executable).not.toMatch(/\bgit\b[^\n]*\bclean\b/);
    expect(executable).not.toMatch(/\bgit\b[^\n]*\bbranch\s+-[dD]\b/);
  });

  describe('runtime classification and read-only guarantee in a temp git repo', () => {
    let sandbox: string;
    let bareRemote: string;
    let mainRepo: string;
    let wtMergedClean: string;
    let wtMergedDirty: string;
    let wtUnmerged: string;
    let wtDetachedMerged: string;

    beforeAll(() => {
      sandbox = mkdtempSync(join(pickTempBase(), 'audit-wt-test-'));
      bareRemote = join(sandbox, 'remote.git');
      mainRepo = join(sandbox, 'repo');
      wtMergedClean = join(sandbox, 'wt-merged-clean');
      wtMergedDirty = join(sandbox, 'wt-merged-dirty');
      wtUnmerged = join(sandbox, 'wt-unmerged');
      wtDetachedMerged = join(sandbox, 'wt-detached-merged');

      execFileSync('git', ['init', '--bare', bareRemote], { encoding: 'utf8' });
      execFileSync('git', ['init', '-b', 'main', mainRepo], { encoding: 'utf8' });
      git(mainRepo, ['remote', 'add', 'origin', bareRemote]);

      writeFileSync(join(mainRepo, 'README.md'), 'initial\n');
      git(mainRepo, ['add', 'README.md']);
      git(mainRepo, ['commit', '-m', 'init']);
      git(mainRepo, ['push', '-u', 'origin', 'main']);

      // 1. Branch merged cleanly into origin/main
      git(mainRepo, ['checkout', '-b', 'feat/merged-clean']);
      writeFileSync(join(mainRepo, 'merged-clean.txt'), 'done\n');
      git(mainRepo, ['add', 'merged-clean.txt']);
      git(mainRepo, ['commit', '-m', 'merged clean commit']);
      git(mainRepo, ['checkout', 'main']);
      git(mainRepo, ['merge', '--no-ff', 'feat/merged-clean', '-m', 'merge feat/merged-clean']);
      git(mainRepo, ['push', 'origin', 'main']);
      git(mainRepo, ['worktree', 'add', wtMergedClean, 'feat/merged-clean']);

      // 2. Branch merged into origin/main, but worktree has uncommitted edits
      git(mainRepo, ['checkout', '-b', 'feat/merged-dirty']);
      writeFileSync(join(mainRepo, 'merged-dirty.txt'), 'done\n');
      git(mainRepo, ['add', 'merged-dirty.txt']);
      git(mainRepo, ['commit', '-m', 'merged dirty commit']);
      git(mainRepo, ['checkout', 'main']);
      git(mainRepo, ['merge', '--no-ff', 'feat/merged-dirty', '-m', 'merge feat/merged-dirty']);
      git(mainRepo, ['push', 'origin', 'main']);
      git(mainRepo, ['worktree', 'add', wtMergedDirty, 'feat/merged-dirty']);
      writeFileSync(join(wtMergedDirty, 'wip.txt'), 'uncommitted work\n');

      // 3. Unmerged active branch worktree
      git(mainRepo, ['worktree', 'add', '-b', 'feat/unmerged-active', wtUnmerged, 'origin/main']);
      writeFileSync(join(wtUnmerged, 'active.txt'), 'in progress\n');
      git(wtUnmerged, ['add', 'active.txt']);
      git(wtUnmerged, ['commit', '-m', 'unmerged commit']);

      // 4. Detached HEAD at an ancestor of origin/main
      const baseSha = git(mainRepo, ['rev-parse', 'origin/main~1']);
      git(mainRepo, ['worktree', 'add', '--detach', wtDetachedMerged, baseSha]);
    });

    afterAll(() => {
      if (sandbox && existsSync(sandbox)) {
        rmSync(sandbox, { recursive: true, force: true });
      }
    });

    it('accurately classifies merged, dirty-merged, detached-merged, and unmerged worktrees without mutating anything', () => {
      const worktreesBefore = git(mainRepo, ['worktree', 'list', '--porcelain']);
      const branchesBefore = git(mainRepo, ['branch', '--list']);

      const output = execFileSync(
        'bash',
        [SCRIPT_PATH, '--repo', mainRepo, '--base', 'origin/main', '--no-gh'],
        { encoding: 'utf8' }
      );

      // Header + summary counts
      expect(output).toContain('READ-ONLY — no worktrees modified');
      expect(output).toContain(
        'Summary: linked=4 merged_clean=2 merged_dirty=1 closed_clean=0 closed_dirty=0 unmerged=1 missing=0'
      );

      // Accurate row classifications
      expect(output).toMatch(/MERGED\s+clean\s+\S+\s+feat\/merged-clean\s+/);
      expect(output).toMatch(/MERGED-DIRTY\s+dirty\s+\S+\s+feat\/merged-dirty\s+/);
      expect(output).toMatch(/UNMERGED\s+clean\s+\S+\s+feat\/unmerged-active\s+/);
      expect(output).toMatch(/DETACHED-MERGED\s+clean\s+\S+\s+\(detached@[0-9a-f]+\)\s+/);

      // Suggested removal commands ONLY for clean merged worktrees (NOT unmerged or dirty)
      expect(output).toContain(`worktree remove ${wtMergedClean}`);
      expect(output).toContain(`worktree remove ${wtDetachedMerged}`);
      expect(output).not.toContain(`worktree remove ${wtUnmerged}`);
      expect(output).not.toContain(`worktree remove ${wtMergedDirty}`);
      expect(output).not.toContain(`worktree remove ${mainRepo}`);

      // Dirty merged worktree flagged for manual inspection
      expect(output).toContain(`WARNING: branch is ancestor of origin/main (uncommitted changes) -> ${wtMergedDirty}`);

      // Strictly read-only proof: nothing changed on disk or in git metadata
      expect(git(mainRepo, ['worktree', 'list', '--porcelain'])).toBe(worktreesBefore);
      expect(git(mainRepo, ['branch', '--list'])).toBe(branchesBefore);
      expect(existsSync(wtMergedClean)).toBe(true);
      expect(existsSync(wtMergedDirty)).toBe(true);
      expect(existsSync(join(wtMergedDirty, 'wip.txt'))).toBe(true);
      expect(existsSync(wtUnmerged)).toBe(true);
      expect(existsSync(wtDetachedMerged)).toBe(true);
    });
  });
});
