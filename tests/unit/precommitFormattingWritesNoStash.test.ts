/**
 * The pre-commit formatter never writes a stash (2026-11-21).
 *
 * .husky/reference-transaction refuses every new refs/stash entry (#11620),
 * and lint-staged writes refs/stash as its backup unless told not to. Every
 * lint-staged call in the pre-commit hook therefore carries --no-stash, or
 * every commit from a worktree with node_modules is refused.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const hook = readFileSync(join(__dirname, '..', '..', '.husky', 'pre-commit'), 'utf8');

describe('pre-commit formatting writes no stash', () => {
  it('passes --no-stash to every lint-staged call', () => {
    const calls = hook.split('\n').filter((line) => /^\s*"\$LS"/.test(line));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('--no-stash');
  });
});
