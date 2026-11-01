/**
 * ===========================================================================
 *  LAW: DAILY PREPARATION DOES NOT WAIT FOR A PUNCTUAL CRON (2026-11-01)
 * ===========================================================================
 *
 * stage-engine-release.yml prepares the owner-requested daily 04:00
 * America/Chicago engine release (CLAUDE.md section 13) and installs the
 * queued `-- @install-window: daily-maintenance` migrations inside its freeze.
 * Until today that preparation belonged to ONE schedule event per day, and
 * GitHub does not deliver schedule events on time. Measured schedule-run
 * creation times: 08:33-09:48 UTC through 2026-10-29, then 15:08 and 16:03 on
 * 2026-10-30, 14:37 and 15:24 on 2026-10-31 (5-6 hours late, so the release
 * offer could never reach its window), and NONE on 2026-11-01. Migration
 * 20261101005048 never got its window, and every newer engine build failed
 * the receiver's production-door check for want of the function it creates -
 * while protected-main pushes ran this same workflow every few minutes all
 * night.
 *
 * THE CONTRACT this file pins, by executing the real admission step:
 *   1. The preparation belongs to a WINDOW, 03:30-03:50 America/Chicago (DST
 *      aware), not to a schedule event. A push run and a schedule run are
 *      equally able to own it; the run's own creation instant decides.
 *   2. A run created outside the window - a cron delivered hours late, or a
 *      daytime push - prepares nothing, exactly as before.
 *   3. ONCE PER CHICAGO DATE. The first push/schedule run created in the
 *      window owns it; any later one refuses by naming the owner. Never a
 *      second dispatch or a second installer run.
 *   4. A run list that cannot be read, or is truncated, is UNKNOWN and
 *      prepares nothing (CLAUDE.md 10.86): it is never read as "no owner yet".
 *   5. Nothing new is added: no publisher, receiver, watcher, retry agent or
 *      repair loop. The extra schedule minutes are only more chances to be the
 *      first run; the emergency and owner-window routes are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = process.cwd();
const stageText = readFileSync(join(root, '.github/workflows/stage-engine-release.yml'), 'utf8');
const stage = parse(stageText);
const admissionStep = stage.jobs.detect.steps.find((s: { id?: string }) => s.id === 'admission');
const admission: string = admissionStep.run;

type Run = { id: number; event: string; created_at: string; head_branch?: string };
type Case = {
  event: 'push' | 'schedule';
  createdAt?: string; // schedule: the run's own created_at from the API
  pushedAt?: string; // push: github.event.repository.pushed_at (epoch seconds)
  runs?: Run[];
  totalCount?: number;
  listFails?: boolean;
  health?: string;
  message?: string;
};

const epoch = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

function admit(c: Case) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-prep-'));
  try {
    const runs = (c.runs ?? []).map((r) => ({ head_branch: 'main', ...r }));
    const result = spawnSync(
      'bash',
      [
        '-c',
        `
      git() { printf '%s' "$MESSAGE"; }
      date() { printf 14; }
      gh() {
        case "$2" in
          *'/workflows/'*)
            printf '%s\\n' "$2" >> "$LIST_LOG"
            [ "$LIST_FAILS" != 1 ] || return 1
            printf '%s' "$RUNS_JSON" ;;
          *) printf '%s' "$RUN_CREATED_AT" ;;
        esac
      }
      curl() { printf '%s' "$HEALTH"; }
      ${admission}
      `,
      ],
      {
        encoding: 'utf8',
        cwd: dir,
        env: {
          ...process.env,
          EVENT_NAME: c.event,
          PUSHED_AT: c.pushedAt ?? '',
          RUN_CREATED_AT: c.createdAt ?? '',
          RUNS_JSON: JSON.stringify({
            total_count: c.totalCount ?? runs.length,
            workflow_runs: runs,
          }),
          LIST_FAILS: c.listFails ? '1' : '0',
          LIST_LOG: join(dir, 'list.log'),
          HEALTH: c.health ?? '{"liveness":"ok"}',
          MESSAGE: c.message ?? 'routine',
          REPO: 'test/repo',
          RUN_ID: '123',
          GITHUB_OUTPUT: join(dir, 'output'),
        },
      }
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const outputs = Object.fromEntries(
      readFileSync(join(dir, 'output'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
    );
    const listed = existsSync(join(dir, 'list.log'))
      ? readFileSync(join(dir, 'list.log'), 'utf8').trim().split('\n')
      : [];
    return { outputs, listed, stdout: result.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the daily preparation belongs to the 03:30-03:50 Chicago window', () => {
  it('a schedule run that arrives inside the window prepares, in both DST states', () => {
    for (const [createdAt, date] of [
      ['2026-11-01T09:31:05Z', '2026-11-01'], // CST, the day DST ended
      ['2026-10-29T08:43:00Z', '2026-10-29'], // CDT
      ['2027-03-14T08:30:00Z', '2027-03-14'], // the day DST starts, 03:30 CDT
      ['2026-12-21T09:49:59Z', '2026-12-21'], // last second of the window
    ]) {
      const { outputs } = admit({ event: 'schedule', createdAt });
      expect(outputs.allowed, createdAt).toBe('true');
      expect(outputs.daily_preparation, createdAt).toBe('true');
      expect(outputs.daily_preparation_date, createdAt).toBe(date);
      expect(outputs.owner_window_id).toBe('');
    }
  });

  it('a run created outside the window prepares nothing and asks nobody', () => {
    for (const createdAt of [
      '2026-11-01T08:31:05Z', // 02:31 CST: the CDT twin on a CST day
      '2026-10-21T09:31:00Z', // 04:31 CDT: the CST twin on a CDT day
      '2026-12-21T09:29:59Z', // one second early
      '2026-12-21T09:50:00Z', // the end is exclusive
      '2026-10-30T15:08:44Z', // measured: delivered 6 hours late
      '2026-10-31T14:37:20Z', // measured: delivered 5 hours late
      'malformed',
      '',
    ]) {
      const { outputs, listed } = admit({ event: 'schedule', createdAt });
      expect(outputs.allowed, createdAt).toBe('false');
      expect(outputs.daily_preparation, createdAt).toBe('false');
      expect(listed, createdAt).toEqual([]);
    }
  });

  it('a protected-main push inside the window is just as able to prepare', () => {
    const { outputs, listed } = admit({
      event: 'push',
      pushedAt: epoch('2026-11-01T09:40:00Z'),
    });
    expect(outputs.allowed).toBe('true');
    expect(outputs.daily_preparation).toBe('true');
    expect(outputs.daily_preparation_date).toBe('2026-11-01');
    expect(listed).toEqual([
      'repos/test/repo/actions/workflows/stage-engine-release.yml/runs?created=2026-11-01T09:30:00Z..2026-11-01T09:50:00Z&per_page=100',
    ]);
    // Daytime pushes still queue, and no push instant is still no admission.
    for (const pushedAt of [epoch('2026-11-01T19:40:00Z'), '']) {
      const queued = admit({ event: 'push', pushedAt });
      expect(queued.outputs.allowed).toBe('false');
      expect(queued.outputs.daily_preparation).toBe('false');
      expect(queued.listed).toEqual([]);
    }
  });
});

describe('the preparation happens once per Chicago date', () => {
  const inWindow = { event: 'push' as const, pushedAt: epoch('2026-11-01T09:44:00Z') };

  it('an earlier push or schedule run in the window owns it; this run refuses by name', () => {
    for (const event of ['push', 'schedule']) {
      const { outputs, stdout } = admit({
        ...inWindow,
        runs: [
          { id: 200, event: 'push', created_at: '2026-11-01T09:46:00Z' },
          { id: 123, event: 'push', created_at: '2026-11-01T09:44:01Z' },
          { id: 100, event, created_at: '2026-11-01T09:33:00Z' },
          { id: 90, event, created_at: '2026-11-01T09:31:00Z' },
        ],
      });
      expect(outputs.allowed, event).toBe('false');
      expect(outputs.daily_preparation, event).toBe('false');
      expect(stdout).toContain('belongs to earlier run 90');
    }
  });

  it('only push and schedule runs on main inside the window compete', () => {
    const { outputs } = admit({
      ...inWindow,
      runs: [
        { id: 300, event: 'push', created_at: '2026-11-01T09:47:00Z' },
        { id: 123, event: 'push', created_at: '2026-11-01T09:44:01Z' },
        { id: 110, event: 'workflow_dispatch', created_at: '2026-11-01T09:40:00Z' },
        { id: 105, event: 'push', created_at: '2026-11-01T09:39:00Z', head_branch: 'other' },
        { id: 100, event: 'push', created_at: '2026-11-01T09:29:59Z' },
        { id: 99, event: 'schedule', created_at: '2026-11-01T09:50:00Z' },
      ],
    });
    expect(outputs.allowed).toBe('true');
    expect(outputs.daily_preparation).toBe('true');
  });

  it('an unreadable or truncated run list is UNKNOWN and prepares nothing', () => {
    for (const c of [
      { listFails: true },
      {
        totalCount: 150,
        runs: [{ id: 200, event: 'push', created_at: '2026-11-01T09:46:00Z' }],
      },
      { runs: [{ id: 'x', event: 'push', created_at: '2026-11-01T09:31:00Z' }] as never },
      { runs: [{ id: 50, event: 'push', created_at: 'not a time' }] },
    ]) {
      const { outputs, stdout } = admit({ ...inWindow, ...c });
      expect(outputs.allowed, JSON.stringify(c)).toBe('false');
      expect(outputs.daily_preparation, JSON.stringify(c)).toBe('unknown');
      expect(stdout).toContain('DAILY PREPARATION UNKNOWN');
    }
  });

  it('a refused duplicate keeps the measured emergency and transition routes, never the installer', () => {
    const earlier = { runs: [{ id: 1, event: 'schedule', created_at: '2026-11-01T09:32:00Z' }] };
    const degraded = admit({ ...inWindow, ...earlier, health: '{"liveness":"dead"}' });
    expect(degraded.outputs.allowed).toBe('true');
    expect(degraded.outputs.daily_preparation).toBe('false');
    const transition = admit({
      ...inWindow,
      ...earlier,
      message: 'x\n\nEngine-Release: daily-maintenance-transition',
    });
    expect(transition.outputs.allowed).toBe('true');
    expect(transition.outputs.daily_preparation).toBe('false');
    // Commit urgency is still nothing, inside the window or out of it.
    expect(
      admit({ ...inWindow, ...earlier, message: 'x\n\nEngine-Release: urgent' }).outputs.allowed
    ).toBe('false');
  });
});

describe('the workflow adds chances, not authority', () => {
  it('feeds the installer only from the owned daily preparation or an owner window', () => {
    const job = stage.jobs['window-migrations'];
    expect(job.if).toContain(
      "(needs.detect.outputs.daily_preparation == 'true' || needs.detect.outputs.owner_window_id != '')"
    );
    expect(job.if).toContain("needs.detect.outputs.admission_allowed == 'true'");
    expect(job.if).not.toContain("github.event_name == 'schedule'");
    expect(job.concurrency).toEqual({
      group: 'daily-maintenance-window-migrations',
      'cancel-in-progress': false,
    });
    expect(stage.jobs.detect.outputs.daily_preparation).toBe(
      '${{ steps.admission.outputs.daily_preparation }}'
    );
    expect(stage.jobs.signal.if).toBe(
      "needs.detect.outputs.release_required == 'true' && needs.detect.outputs.admission_allowed == 'true'"
    );
  });

  it('schedules only odd minutes inside the window for both DST twins', () => {
    expect(stage.on.schedule).toEqual([
      { cron: '31,35,39,43 8 * * *' },
      { cron: '31,35,39,43 9 * * *' },
    ]);
    expect(Object.keys(stage.jobs).sort()).toEqual(['detect', 'signal', 'window-migrations']);
  });

  it('the admission itself only reads: no dispatch, no write, no wait', () => {
    expect(admissionStep.env.PUSHED_AT).toBe("${{ github.event.repository.pushed_at || '' }}");
    expect(stage.jobs.detect.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(admission).not.toMatch(/dispatches|--method|-X POST|sleep|while true/);
    expect(admission).toContain('START_HOUR, START_MINUTE, WINDOW_MINUTES = 3, 30, 20');
    expect(admission).toContain('ZoneInfo("America/Chicago")');
  });
});
