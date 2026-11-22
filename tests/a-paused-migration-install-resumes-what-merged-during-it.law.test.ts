/**
 * LAW: A PAUSED MIGRATION INSTALL RESUMES WHAT MERGED DURING IT
 * ═══════════════════════════════════════════════════════════════════════════
 * docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md pauses migration installs from
 * an owner engine-window booking to SEALED by switching a workflow off. A
 * switched-off workflow DROPS the events it misses; it does not queue them. On
 * 2026-11-15 the applier and the dispatcher were switched off at 17:12 UTC for
 * the 1806z cutover, the release sealed at 18:28 UTC, and five ordinary
 * migrations merged during the pause were never installed until
 * migration-install-watch paged MergedMigrationNotInstalled (incident
 * c1a85d20, fourth recurrence). The playbook's resume step was "re-enable the
 * applier", which installs nothing that was dropped.
 *
 * Pinned here: the resume step is scripts/release/resume-migration-installs.sh,
 * it re-sends every ordinary migration added or modified since the pause
 * (never a window file, never a removed file), it refuses a pause point that
 * is not on main, and the playbook names it instead of a bare re-enable.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCRIPT = resolve(ROOT, 'scripts/release/resume-migration-installs.sh');
const PLAYBOOK = resolve(ROOT, 'docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md');
const dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A bare "origin" and a clone, so `git fetch origin main` works offline. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'resume-installs-'));
  dirs.push(base);
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  spawnSync('git', ['init', '-q', '-b', 'main', work]);
  git(work, 'config', 'user.email', 't@t');
  git(work, 'config', 'user.name', 't');
  git(work, 'remote', 'add', 'origin', origin);
  mkdirSync(join(work, 'supabase/migrations'), { recursive: true });
  const put = (name: string, body: string) =>
    writeFileSync(join(work, 'supabase/migrations', name), body);
  const commit = (msg: string) => {
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', msg);
    git(work, 'push', '-q', 'origin', 'main');
    return git(work, 'rev-parse', 'HEAD');
  };
  return { work, put, commit };
}

function run(cwd: string, ...args: string[]) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('a paused migration install resumes what merged during it', () => {
  it('sends every ordinary migration added or modified since the pause, oldest first, and never a window file', () => {
    const f = fixture();
    f.put('20261101000000_before_the_pause.sql', 'select 1;\n');
    f.put('20261101000001_modified_later.sql', 'select 1;\n');
    const pause = f.commit('booking merge');
    f.put('20261115170236_merged_second.sql', 'select 2;\n');
    f.put('20261115164443_merged_first.sql', 'select 3;\n');
    f.put('20261101000001_modified_later.sql', 'select 4;\n');
    f.put(
      '20261115100000_needs_the_break.sql',
      '-- @install-window: daily-maintenance\nselect 5;\n'
    );
    f.commit('merges during the pause');

    const r = run(f.work, pause, '--dry-run');
    expect(r.status).toBe(0);
    const sent = r.stdout
      .split('\n')
      .filter((l) => l.startsWith('TO SEND: '))
      .map((l) => l.slice('TO SEND: '.length));
    expect(sent).toEqual([
      '20261101000001_modified_later.sql',
      '20261115164443_merged_first.sql',
      '20261115170236_merged_second.sql',
    ]);
    expect(r.stdout).toContain(
      'QUEUED FOR THE DAILY WINDOW (not sent): 20261115100000_needs_the_break.sql'
    );
    expect(r.stdout).not.toContain('before_the_pause');
    expect(r.stdout).toContain('DRY RUN: nothing enabled, nothing sent.');
  });

  it('never sends a removed file', () => {
    const f = fixture();
    f.put('20261101000000_removed_during_pause.sql', 'select 1;\n');
    const pause = f.commit('booking merge');
    rmSync(join(f.work, 'supabase/migrations/20261101000000_removed_during_pause.sql'));
    f.commit('revert a never-installed file');
    const r = run(f.work, pause, '--dry-run');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('TO SEND');
  });

  it('refuses a pause point that is not on main, sending nothing', () => {
    const f = fixture();
    f.put('20261101000000_a.sql', 'select 1;\n');
    f.commit('main');
    git(f.work, 'checkout', '-q', '-b', 'side');
    f.put('20261101000001_b.sql', 'select 2;\n');
    git(f.work, 'add', '-A');
    git(f.work, 'commit', '-q', '-m', 'side');
    const side = git(f.work, 'rev-parse', 'HEAD');
    const r = run(f.work, side, '--dry-run');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('is not an ancestor of origin/main');
  });

  it('switches both workflows back on and checks each is active before sending', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/gh workflow enable apply-merged-migration\.yml/);
    expect(src).toMatch(/gh workflow enable dispatch-merged-migrations\.yml/);
    expect(src.indexOf('!= "active"')).toBeLessThan(src.indexOf('repos/$REPO/dispatches'));
  });

  it('the playbook resumes with the script, not a bare re-enable', () => {
    const doc = readFileSync(PLAYBOOK, 'utf8');
    expect(doc).toContain('scripts/release/resume-migration-installs.sh <pause-start-sha>');
    expect(doc).toContain(':05-:49 UTC');
    expect(doc).not.toMatch(/^- Re-enable the applier, post SEALED/m);
  });

  it('documents the :05-:49 UTC run window in header usage and invalid-usage stderr', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toContain(
      'Run at :05-:49 UTC (refuses at :48-:04 UTC for the database :50-:03 DDL refusal window)'
    );
    const r = run(ROOT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      'Run at :05-:49 UTC (refuses at :48-:04 UTC for the database :50-:03 DDL refusal window)'
    );
  });
});
