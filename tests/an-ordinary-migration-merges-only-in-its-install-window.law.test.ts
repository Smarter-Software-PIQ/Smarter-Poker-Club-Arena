/**
 * LAW (2026-11-26): an ordinary migration merges only in its install window.
 *
 * The dispatcher installs an ordinary migration only in [cycle + 10m,
 * cycle + 30m) (04:15-04:30 for the 04:00 anchor). A file merged outside that
 * window sat uninstalled on main for up to 150 minutes on 2026-11-25, and the
 * Backup refuses to certify a commit that carries one, so every later engine
 * commit was uncertifiable until the next window. The pull-request check
 * "An ordinary migration merges only in its install window" is red outside the
 * window, naming the next one in Chicago time, and green inside it.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import * as merge from '../scripts/ci/migration-merge-window.mjs';
// @ts-expect-error untyped CI module
import * as dispatcher from '../scripts/ci/merged-migration-dispatch.mjs';

const ROOT = resolve(__dirname, '..');
const at = (iso: string) => Date.parse(iso);
const label = (ms: number | null) => (ms === null ? null : merge.chicagoLabel(ms));
const scratch: string[] = [];
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('the merge window is the dispatcher install window, with a five-minute margin', () => {
  it.each([
    // [UTC instant, Chicago, open, closes or opens, next closes]
    ['2026-11-25T22:15:00Z', '16:15 CST', true, '16:25 CST', null],
    ['2026-11-25T22:27:00Z', '16:27 CST', false, '19:10 CST', '19:25 CST'],
    ['2026-11-26T00:00:00Z', '18:00 CST', false, '19:10 CST', '19:25 CST'],
    ['2026-11-26T05:00:00Z', '23:00 CST', false, '04:15 CST', '04:25 CST'],
    ['2026-11-26T07:15:00Z', '01:15 CST', false, '04:15 CST', '04:25 CST'],
    ['2026-11-26T10:20:00Z', '04:20 CST', true, '04:25 CST', null],
    ['2026-07-01T15:12:00Z', '10:12 CDT', true, '10:25 CDT', null],
  ])('%s (%s) open=%s', (iso, chicago, open, first, second) => {
    const now = at(iso);
    expect(label(now)).toBe(chicago);
    const w = merge.mergeWindow(now, 1, false, 'three-hourly');
    expect(w.open).toBe(open);
    if (open) expect(label(w.closesAt)).toBe(first);
    else {
      expect(label(w.opensAt)).toBe(first);
      expect(label(w.nextClosesAt)).toBe(second);
    }
  });

  it('an open answer is always an instant the dispatcher installs at once, now and five minutes later', () => {
    for (let t = at('2026-11-25T06:00:00Z'); t < at('2026-11-26T06:00:00Z'); t += 60_000) {
      if (!merge.mergeOpenAt(t, 1, false, 'three-hourly')) continue;
      expect(dispatcher.admissibleAt(t, 1, false, 'three-hourly')).toBe(true);
      expect(dispatcher.admissibleAt(t + 5 * 60_000, 1, false, 'three-hourly')).toBe(true);
    }
    expect(merge.MERGE_MARGIN_MINUTES).toBe(5);
    // Seven windows a day under the three-hourly cadence, none of them inside
    // [cycle - 150m, cycle + 10m) or the nightly freeze.
    let windows = 0;
    let was = false;
    for (let t = at('2026-11-25T06:00:00Z'); t < at('2026-11-26T06:00:00Z'); t += 60_000) {
      const open = merge.mergeOpenAt(t, 1, false, 'three-hourly');
      if (open && !was) windows++;
      was = open;
    }
    expect(windows).toBe(7);
  });

  it('a pull request with no ordinary migration is always open', () => {
    expect(merge.mergeWindow(at('2026-11-26T00:00:00Z'), 0, false, 'three-hourly').open).toBe(true);
  });
});

describe('the check the pull request shows', () => {
  function check(files: Record<string, string>, nowIso: string, list?: string) {
    const dir = mkdtempSync(join(tmpdir(), 'merge-window-'));
    scratch.push(dir);
    const sql = join(dir, 'migrations');
    mkdirSync(sql);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(sql, name), body);
    const fileList = join(dir, 'files.txt');
    writeFileSync(
      fileList,
      list ??
        Object.keys(files)
          .map((n) => `added\tsupabase/migrations/${n}`)
          .join('\n') + '\n'
    );
    return spawnSync(
      'node',
      [
        'scripts/ci/migration-merge-window.mjs',
        'check',
        fileList,
        sql,
        String(at(nowIso)),
        '--schedule',
        'three-hourly',
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
  }

  it('is red outside the window and names the next window in Chicago time', () => {
    const r = check({ '20261126000707_held.sql': 'select 1;\n' }, '2026-11-26T00:43:00Z');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      'CLOSED: merged now, 1 ordinary migration(s) (20261126000707_held.sql)'
    );
    expect(r.stdout).toContain('the next merge window is 19:10 CST to 19:25 CST (America/Chicago)');
    expect(r.stdout).toContain('Re-run this check inside that window');
  });

  it('is green inside the window', () => {
    const r = check({ '20261126011611_ok.sql': 'select 1;\n' }, '2026-11-26T01:12:00Z');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain(
      'OPEN: 1 ordinary migration(s) (20261126011611_ok.sql) install at once if merged before 19:25 CST'
    );
  });

  it('a daily-maintenance window file never blocks, and no migration at all is green', () => {
    const windowFile = check(
      { '20261126000800_window.sql': '-- @install-window: daily-maintenance\nselect 1;\n' },
      '2026-11-26T00:43:00Z'
    );
    expect(windowFile.status, windowFile.stdout + windowFile.stderr).toBe(0);
    expect(windowFile.stdout).toContain('install in the 04:00 break');
    const none = check({}, '2026-11-26T00:43:00Z', '');
    expect(none.status).toBe(0);
    expect(none.stdout).toContain('No ordinary migration in this pull request.');
  });
});

describe('the workflow', () => {
  const wf = parse(
    readFileSync(
      join(ROOT, '.github/workflows/an-ordinary-migration-merges-only-in-its-install-window.yml'),
      'utf8'
    )
  );
  const job = wf.jobs.window;

  it('answers every pull-request event to main and every merge-group event, with no timer', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['merge_group', 'pull_request']);
    expect(wf.on.pull_request.types).toEqual(
      expect.arrayContaining(['opened', 'synchronize', 'reopened', 'ready_for_review', 'labeled'])
    );
    // No path filter: a required check must report on every pull request.
    expect(wf.on.pull_request.paths).toBeUndefined();
    expect(job.name).toBe('An ordinary migration merges only in its install window');
  });

  it("runs the default branch's script, reads the proposal as data, and holds no secret", () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(job.environment).toBeUndefined();
    const text = readFileSync(
      join(ROOT, '.github/workflows/an-ordinary-migration-merges-only-in-its-install-window.yml'),
      'utf8'
    );
    expect(text).not.toMatch(/secrets\./);
    const [scripts, proposed] = job.steps.filter((s: any) => s.uses === 'actions/checkout@v4');
    expect(scripts.with.ref).toBe(
      '${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}'
    );
    expect(scripts.with['sparse-checkout']).toContain('scripts/ci/migration-merge-window.mjs');
    expect(proposed.with.path).toBe('proposed');
    expect(proposed.with['sparse-checkout']).toBe('supabase/migrations');
    const decide = job.steps.at(-1).run as string;
    expect(decide).toContain(
      'node scripts/ci/migration-merge-window.mjs check files.txt proposed/supabase/migrations'
    );
    expect(decide).not.toContain('node proposed/');
    // The pull request that introduces the check passes before main has the script.
    expect(decide.indexOf('[ ! -f scripts/ci/migration-merge-window.mjs ]')).toBeLessThan(
      decide.indexOf('node scripts/ci/migration-merge-window.mjs check')
    );
  });
});
