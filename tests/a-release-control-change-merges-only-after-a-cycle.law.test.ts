/**
 * A RELEASE-CONTROL CHANGE MERGES ONLY AFTER A CYCLE (2026-11-26, release custody)
 *
 * A Backup certificate is selectable only while projection(commit) equals
 * projection(main) (scripts/ci/read-engine-prequalification.py). One merge that
 * changes a projected file strands every certificate, and a new one takes
 * about an hour on the one Backup host. Two cycles were lost to that in two
 * days, each against a written rule that nothing enforced:
 *   - 2026-11-25 22:50 Chicago: O27 (#12038) merged; the 01:00 cycle kept serving;
 *   - 2026-11-26 12:40: the O31 batch (#12103) left 13:00 with nothing selectable.
 * (A Horse script edit at 07:15 on 11-26 also stranded a certificate, but it
 * landed ten minutes after a cycle with the whole three hours left: that is
 * the window, and it stays open there.)
 *
 * Laws:
 *  1. The required status "Migration merge window" is failure for a pull
 *     request into main that changes a projected file, except in the same
 *     minutes an ordinary migration may merge, or under the written outage
 *     override.
 *  2. Which files are projected has one source: the Python constants. The
 *     JavaScript classifier and projection()'s own filter agree on every
 *     tracked file of this checkout.
 *  3. When the constants cannot be read, the release workflows and release
 *     directories are still held (unreadable is never "no controls").
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MERGE_WINDOW_CONTEXT,
  MERGE_WINDOW_OVERRIDE_LABEL,
  mergeWindowOpen,
  mergeWindowVerdict,
} from '../scripts/ci/migration-merge-window.mjs';
import {
  CONTROL_LIST_NAMES,
  FALLBACK_CONTROL_LISTS,
  controlLists,
  isReleaseControlPath,
  parseControlLists,
  releaseControlChanges,
} from '../scripts/ci/release-control-paths.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (iso: string) => Date.parse(iso);
const C = 'three-hourly';
const PYTHON = read('scripts/ci/read-engine-prequalification.py');
const LISTS = parseControlLists(PYTHON);
const file = (path: string, changeType = 'MODIFIED') => ({ path, changeType });
const verdict = (iso: string, files: unknown[], labels: string[] = [], body = '') =>
  mergeWindowVerdict({
    nowMs: at(iso),
    cadence: C,
    baseRef: 'main',
    files,
    labels,
    body,
    lists: LISTS,
  });

const STAGE = '.github/workflows/stage-engine-release.yml';

describe('a release-control change merges only after a cycle', () => {
  it('refuses the two merges that cost a cycle on 2026-11-25 and 2026-11-26, and admits the one made in the window', () => {
    // O27, 22:50 Chicago on 11-25 (04:50Z on 11-26): Stage workflow.
    expect(verdict('2026-11-26T04:50:00Z', [file(STAGE)]).state).toBe('failure');
    // The Horse script edit, 07:15 Chicago (13:15Z): fifteen minutes after the 07:00 cycle, inside the window.
    expect(
      verdict('2026-11-26T13:15:00Z', [file('server/scripts/engine-release-seal.py')]).state
    ).toBe('success');
    // The same edit two hours later would have left 10:00 with no time to recertify.
    expect(
      verdict('2026-11-26T15:15:00Z', [file('server/scripts/engine-release-seal.py')]).state
    ).toBe('failure');
    // The O31 batch, 12:40 Chicago (18:40Z): the projection reader itself.
    expect(
      verdict('2026-11-26T18:40:00Z', [file('scripts/ci/read-engine-prequalification.py')]).state
    ).toBe('failure');
  });

  it('opens in exactly the minutes an ordinary migration may merge, and names the next window', () => {
    let open = 0;
    const day = at('2026-11-26T06:00:00Z');
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const now = day + minute * 60_000;
      const state = mergeWindowVerdict({
        nowMs: now,
        cadence: C,
        baseRef: 'main',
        files: [file(STAGE)],
        labels: [],
        body: '',
        lists: LISTS,
      }).state;
      expect(state === 'success').toBe(mergeWindowOpen(now, C));
      if (state === 'success') open += 1;
    }
    expect(open).toBeGreaterThan(0);
    // 13:10 Chicago, ten minutes after the 13:00 cycle: open.
    expect(verdict('2026-11-26T19:15:00Z', [file(STAGE)]).description).toMatch(
      /^Install window open/
    );
    const closed = verdict('2026-11-26T18:40:00Z', [file(STAGE)]);
    expect(closed.description).toMatch(/^Release controls merge 10-27 min after a cycle/);
    expect(closed.description).toContain('next ');
    expect(closed.description.length).toBeLessThanOrEqual(140);
  });

  it('a deletion or a rename out of the projection is still a release-control change', () => {
    expect(verdict('2026-11-26T18:40:00Z', [file(STAGE, 'DELETED')]).state).toBe('failure');
    expect(
      releaseControlChanges(
        [
          {
            path: 'docs/moved.md',
            changeType: 'RENAMED',
            previousPath: 'server/scripts/engine-release-seal.py',
          },
        ],
        LISTS
      )
    ).toEqual(['server/scripts/engine-release-seal.py']);
  });

  it('leaves every other pull request alone: tests, excluded Horse research, docs, client and engine source', () => {
    for (const path of [
      'src/pages/TablePage.tsx',
      'docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md',
      'server/src/engine/HandController.ts',
      'server/standby/standby-engine.sh',
      'server/scripts/oop-reraise-range/league.ts',
      'server/scripts/horse-anything.mjs',
      'server/src/maintenance/maintenanceBreak.test.ts',
      'scripts/ci/migration-merge-window.mjs',
      'scripts/release/three-hourly-readiness.py',
      '.github/workflows/migration-merge-window.yml',
    ]) {
      expect(isReleaseControlPath(path, LISTS), path).toBe(false);
      expect(verdict('2026-11-26T18:40:00Z', [file(path)]).state, path).toBe('success');
    }
    expect(verdict('2026-11-26T18:40:00Z', [file(STAGE)]).description).not.toBe(
      verdict('2026-11-26T18:40:00Z', [file('src/a.ts')]).description
    );
  });

  it('admits an outage only with the label and a written justification', () => {
    const body = 'Outage override: no certificate is selectable and Stage cannot select\n';
    expect(
      verdict('2026-11-26T18:40:00Z', [file(STAGE)], [MERGE_WINDOW_OVERRIDE_LABEL], body).state
    ).toBe('success');
    expect(verdict('2026-11-26T18:40:00Z', [file(STAGE)], [], body).state).toBe('failure');
    expect(
      verdict('2026-11-26T18:40:00Z', [file(STAGE)], [MERGE_WINDOW_OVERRIDE_LABEL], 'x').state
    ).toBe('failure');
  });

  it('with a migration in the same pull request the migration text stands', () => {
    const mig = {
      path: 'supabase/migrations/20261126000000_x.sql',
      changeType: 'ADDED',
      sql: 'BEGIN;\nCOMMIT;\n',
    };
    expect(verdict('2026-11-26T18:40:00Z', [file(STAGE), mig]).description).toMatch(
      /^Migrations merge/
    );
  });
});

describe('which files are release controls has one source', () => {
  it('reads every list from the Python constants and copies none', () => {
    for (const name of CONTROL_LIST_NAMES) expect(Array.isArray(LISTS[name]), name).toBe(true);
    expect(LISTS.CONTROL_INPUTS).toContain(STAGE);
    expect(LISTS.CONTROL_INPUTS).toContain('server/scripts');
    expect(LISTS.NON_RELEASE_SERVER_SCRIPT_PREFIXES).toContain('server/scripts/oop-reraise-range/');
    expect(controlLists()).toEqual(LISTS);
    const source = read('scripts/ci/release-control-paths.mjs');
    // The module names no projected script or exclusion of its own beyond the fallback.
    expect(source).not.toContain('oop-reraise-range');
    expect(source).not.toContain('select-daily-engine');
  });

  it('agrees with projection() on every tracked file of this checkout', () => {
    const listed = spawnSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    expect(listed.status).toBe(0);
    const paths = listed.stdout.split('\0').filter(Boolean);
    expect(paths.length).toBeGreaterThan(1000);
    const script = `
import json, runpy, sys
m = runpy.run_path('scripts/ci/read-engine-prequalification.py')
inputs = m['CONTROL_INPUTS']
pure, non = m['_is_pure_test_control_path'], m['_is_non_release_server_script_path']
out = []
for path in sys.stdin.read().split('\\0'):
    if not path:
        continue
    inside = any(path == i or path.startswith(i + '/') for i in inputs)
    if inside and not pure(path) and not non(path):
        out.append(path)
print(json.dumps(sorted(out)))
`;
    const python = spawnSync('python3', ['-B', '-c', script], {
      cwd: ROOT,
      input: paths.join('\0'),
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    expect(python.status, python.stderr).toBe(0);
    const expected: string[] = JSON.parse(python.stdout);
    const actual = paths.filter((p) => isReleaseControlPath(p, LISTS)).sort();
    expect(expected.length).toBeGreaterThan(20);
    expect(actual).toEqual(expected);
  });

  it('refuses a constant it cannot parse as plain strings, and then holds the fallback', () => {
    expect(() => parseControlLists('CONTROL_INPUTS = [\n    "a",\n]\n')).toThrow(/not found/);
    const broken = PYTHON.replace('"server/scripts",', 'os.path.join("server", "scripts"),');
    expect(() => parseControlLists(broken)).toThrow(/plain strings/);
    const fallback = controlLists(() => {
      throw new Error('unreadable');
    });
    expect(fallback).toBe(FALLBACK_CONTROL_LISTS);
    for (const path of [
      STAGE,
      '.github/workflows/backup-engine.yml',
      'server/scripts/x.py',
      'scripts/ci/select-daily-engine.py',
    ]) {
      expect(isReleaseControlPath(path, fallback), path).toBe(true);
    }
    // No exclusion applies under the fallback: unknown is held.
    expect(isReleaseControlPath('server/scripts/oop-reraise-range/league.ts', fallback)).toBe(true);
    expect(
      mergeWindowVerdict({
        nowMs: at('2026-11-26T18:40:00Z'),
        cadence: C,
        baseRef: 'main',
        files: [file(STAGE)],
        labels: [],
        body: '',
        lists: fallback,
      }).state
    ).toBe('failure');
  });
});

describe('the gate is wired to the required status', () => {
  it('rides the existing trusted workflow, whose checkout holds the Python constants', () => {
    const workflow = read('.github/workflows/migration-merge-window.yml');
    expect(workflow).toContain('scripts/ci\n');
    expect(workflow).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(MERGE_WINDOW_CONTEXT).toBe('Migration merge window');
    const sweep = read('scripts/ci/migration-merge-window.mjs');
    expect(sweep).toContain("from './release-control-paths.mjs'");
    expect(sweep).toContain('releaseControlChanges(files, lists)');
    // The watch counts a held control pull request as a candidate that proves a window opened.
    expect(read('scripts/ci/merge-window-watch.mjs')).toContain('Release controls merge');
  });
});
