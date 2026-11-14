import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// November 14, 2026: booking an off-cycle owner engine window was a 14-file
// hand edit (docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md, step 4). It is now
// scripts/release/book-owner-engine-window.py, which validates the booking,
// computes every file in memory, writes all of them or none, and then runs the
// native floor suite. This law runs that command against disposable copies of
// the release controls; it never writes this checkout.
const ROOT = resolve(__dirname, '..');
const suite = 'tests/operations/book-owner-engine-window.test.py';
// Five cases, three of which run the whole native floor suite (about 30 s each).
const CHILD_HANG_GUARD_MS = 840_000;

describe('an owner engine window is booked by one command', () => {
  it('books, composes, refuses and reports failure in a disposable tree', () => {
    const result = spawnSync('python3', ['-B', suite], {
      cwd: ROOT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      timeout: CHILD_HANG_GUARD_MS,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Ran 9 tests/);
    expect(result.stderr).not.toMatch(/skipped=/);
  }, 900_000);

  it('the playbook names the command where it tells an agent to book', () => {
    const playbook = readFileSync(
      resolve(ROOT, 'docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md'),
      'utf8'
    );
    expect(playbook).toContain('python3 scripts/release/book-owner-engine-window.py');
    expect(playbook).toContain('--dry-run');
  });
});
