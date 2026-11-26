/**
 * LAW - THE REPOSITORY ROOT HOLDS NO SCRATCH FILES
 *
 * On 2026-11-26 the root held 33 one-off files from August: SQL pasted for a
 * manual run (sql_to_run.txt, kill_locks.sql, get_view.sql), patch and fix
 * scripts for single edits (patch_tablepage.sh, fix.cjs, fix-buyin.patch),
 * captured output (deploy_out.txt, response.out, .vitest-full.log), polling
 * loops (wait_pr.sh) and an empty db_schema.sql, plus a stray dry-run copy in
 * scratch/. Nothing referenced any of them. They were removed, and this law
 * keeps the root from collecting them again: scratch work belongs in a branch
 * or a pull request, not on main.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCRATCH = [
  /\.sql$/i,
  /\.(patch|diff|out|log)$/i,
  /^sql_.*\.txt$/i,
  /^(deploy_out|schedule_dump)\.txt$/i,
  /^(kill|get|fix|patch|resolve|copy|run|wait|update)[_-][^/]*\.(sql|sh|cjs|js|mjs|py|txt)$/i,
  /^fix\.(cjs|js|mjs)$/i,
  /^localhost_.*\.png$/i,
];

describe('LAW: the repository root holds no scratch files', () => {
  it('no tracked root file looks like scratch work', () => {
    const rootFiles = execFileSync('git', ['ls-files', '--', ':(glob)*'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => f && !f.includes('/'));
    expect(rootFiles.length).toBeGreaterThan(10);
    const scratch = rootFiles.filter((f) => SCRATCH.some((re) => re.test(f)));
    expect(scratch, 'keep scratch work in a branch, not on main').toEqual([]);
  });

  it('nothing is tracked under scratch/', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'scratch'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    expect(tracked).toBe('');
  });
});
