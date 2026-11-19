/**
 * LAW - NO NPM CACHE IS EVER COMMITTED
 *
 * #11275 (2026-11-18) committed eleven npm debug logs under the repository's
 * root .npm-cache/_logs/. .gitignore ignored only server/.npm-cache/. npm
 * rotates its debug logs, deleting the oldest, so every npm or npx run in any
 * worktree then showed tracked files as deleted, and the pre-push gate (which
 * requires clean tracked files) refused every push until the agent restored
 * them by hand. An npm cache is machine-local state: no file under any
 * .npm-cache directory is ever tracked, and every such directory is ignored.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

describe('no npm cache is ever committed', () => {
  it('tracks no file under any .npm-cache directory', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      .split('\0')
      .filter((p) => /(^|\/)\.npm-cache\//.test(p));
    expect(tracked).toEqual([]);
  });

  it('ignores every .npm-cache directory, at the root and below', () => {
    const lines = readFileSync(resolve(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    expect(lines).toContain('**/.npm-cache/');
  });
});
