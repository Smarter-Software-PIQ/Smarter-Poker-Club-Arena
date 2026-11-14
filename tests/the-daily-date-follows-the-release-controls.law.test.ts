/**
 * ===========================================================================
 *  LAW: THE DAILY DATE FOLLOWS THE RELEASE CONTROLS (2026-11-13)
 * ===========================================================================
 *
 * stage-engine-release.yml elects one run per Chicago date to prepare the
 * 04:00 engine release, and its cutoff step refuses any run whose own source
 * carries other release controls than protected main at the cutoff ("never
 * execute new release authority under an old reservation owner"). The election
 * handed the date to the earliest run regardless of the controls it carried.
 * So a single release-control merge during the five-hour reservation (an
 * owner-window booking in server/release/owner-maintenance-windows.json)
 * stranded the whole day: the earliest run refused at 03:30 and every later
 * run, which carried the new controls, had already deferred to it.
 * EngineCutoverMissed fired on 2026-11-11 and 2026-11-13 for exactly this.
 *
 * THE CONTRACT this file pins, by executing the real election script against
 * a real Git history:
 *   1. An earlier run reserved under the SAME release controls owns the date;
 *      this run defers to it, as before.
 *   2. An earlier run reserved under DIFFERENT release controls is not an
 *      owner: the first run carrying the new controls owns the date, so the
 *      run the cutoff will accept is the one that prepares it.
 *   3. A run whose source cannot be read (no head_sha, unknown commit) keeps
 *      its ownership: an unreadable projection never steals a date.
 *   4. The cutoff refusal itself is unchanged: nothing ever runs under older
 *      release authority, and nothing new (timer, retry, watcher) is added.
 */
import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = process.cwd();
const stage = parse(readFileSync(join(root, '.github/workflows/stage-engine-release.yml'), 'utf8'));
const steps = stage.jobs.detect.steps as Array<{ id?: string; run?: string }>;
const admission = steps.find((s) => s.id === 'admission')!.run!;
const cutoff = steps.find((s) => s.id === 'cutoff')!.run!;

function electionScript(): string {
  const start = admission.indexOf('RUNS_FILE="$runs_file"');
  expect(start).toBeGreaterThan(0);
  const open = admission.indexOf("<<'PYTHON'\n", start) + "<<'PYTHON'\n".length;
  const close = admission.indexOf('\nPYTHON\n', open);
  expect(close).toBeGreaterThan(open);
  return admission.slice(open, close + 1);
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'daily-authority-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Law');
  git('config', 'user.email', 'law@example.invalid');
  mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
  mkdirSync(join(dir, 'server/release'), { recursive: true });
  copyFileSync(
    join(root, 'scripts/ci/read-engine-prequalification.py'),
    join(dir, 'scripts/ci/read-engine-prequalification.py')
  );
  writeFileSync(join(dir, 'server/release/owner-maintenance-windows.json'), '{"windows":[]}\n');
  git('add', '.');
  git('commit', '-qm', 'controls A');
  const a = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'README.md'), 'not a release control\n');
  git('add', '.');
  git('commit', '-qm', 'same controls');
  const same = git('rev-parse', 'HEAD');
  writeFileSync(
    join(dir, 'server/release/owner-maintenance-windows.json'),
    '{"windows":[{"id":"booked-during-reservation"}]}\n'
  );
  git('add', '.');
  git('commit', '-qm', 'controls B');
  const b = git('rev-parse', 'HEAD');
  return { dir, a, same, b };
}

const windowStart = '2026-11-14T04:30:00Z';
const windowEnd = '2026-11-14T09:50:00Z';
const cutoffEpoch = String(Date.parse('2026-11-14T09:30:00Z') / 1000);

function elect(dir: string, mine: string, earlierHead?: string) {
  const run: Record<string, unknown> = {
    id: 100,
    event: 'push',
    created_at: '2026-11-14T05:00:00Z',
    head_branch: 'main',
    display_title: 'Daily engine reservation',
  };
  if (earlierHead) run.head_sha = earlierHead;
  const me = { ...run, id: 200, created_at: '2026-11-14T06:00:00Z', head_sha: mine };
  writeFileSync(
    join(dir, 'runs.json'),
    JSON.stringify([{ total_count: 2, workflow_runs: [run, me] }])
  );
  const result = spawnSync('python3', ['-'], {
    cwd: dir,
    input: electionScript(),
    encoding: 'utf8',
    env: {
      ...process.env,
      RUNS_FILE: join(dir, 'runs.json'),
      WINDOW_START: windowStart,
      WINDOW_END: windowEnd,
      CUTOFF_EPOCH: cutoffEpoch,
      RUN_ID: '200',
      GITHUB_SHA: mine,
    },
  });
  expect(result.status).toBe(0);
  return { verdict: result.stdout.trim(), log: result.stderr };
}

describe('the daily date follows the release controls', () => {
  it('defers to an earlier run reserved under the same release controls', () => {
    const { dir, a, same } = repo();
    try {
      expect(elect(dir, same, a).verdict).toBe('false 100');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes the date from an earlier run reserved under other release controls', () => {
    const { dir, a, b } = repo();
    try {
      const { verdict, log } = elect(dir, b, a);
      expect(verdict).toBe('true 200');
      expect(log).toContain('Earlier run 100 reserved under other release controls');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never lets an unreadable projection steal a date', () => {
    const { dir, b } = repo();
    try {
      expect(elect(dir, b).verdict).toBe('false 100');
      expect(elect(dir, b, 'f'.repeat(40)).verdict).toBe('false 100');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps refusing to run older release authority at the cutoff', () => {
    expect(cutoff).toContain(
      'module.projection(os.environ["GITHUB_SHA"], release_authority=True) != module.projection(os.environ["CONTROL"], release_authority=True)'
    );
    expect(cutoff).toContain('Release controls changed during reservation; keep serving.');
  });
});
