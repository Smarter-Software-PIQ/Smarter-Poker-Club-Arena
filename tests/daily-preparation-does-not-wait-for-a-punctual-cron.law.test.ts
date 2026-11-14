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
 *   1. The preparation stays 03:30-03:50 America/Chicago. The original job
 *      can reserve five elapsed hours early, then waits once to 03:30.
 *      Protected pushes, schedules and automatic push-Backup completions
 *      share the election; current protected source is bound at the cutoff.
 *   2. An event outside the reservation/preparation interval does nothing.
 *      A replay, changed release authority or missed date fails closed.
 *   3. ONCE PER CHICAGO DATE. The first eligible original run owns it;
 *      any later one refuses by naming the owner. Never a
 *      second dispatch or a second installer run.
 *   4. A run list that cannot be read, or is truncated, is UNKNOWN and
 *      prepares nothing (CLAUDE.md 10.86): it is never read as "no owner yet".
 *   5. Nothing new is added: no publisher, receiver, watcher, retry agent or
 *      repair loop. The extra schedule minutes are only more chances to be the
 *      first run; the emergency and owner-window routes are unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = process.cwd();
const stageText = readFileSync(join(root, '.github/workflows/stage-engine-release.yml'), 'utf8');
const stage = parse(stageText);
const admissionStep = stage.jobs.detect.steps.find((s: { id?: string }) => s.id === 'admission');
const admission: string = admissionStep.run;

type Run = {
  id: number;
  event: string;
  created_at: string;
  actor?: { type: string };
  run_attempt?: number;
  head_branch?: string;
  display_title?: string;
};
type Case = {
  event: 'push' | 'schedule' | 'repository_dispatch' | 'workflow_run';
  sender?: string;
  attempt?: number;
  createdAt?: string; // schedule: the run's own created_at from the API
  pushedAt?: string; // push: github.event.repository.pushed_at (epoch seconds)
  runs?: Run[];
  totalCount?: number;
  listFails?: boolean;
  pages?: unknown[];
  health?: string;
  message?: string;
};

const epoch = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

function admit(c: Case) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-prep-'));
  try {
    const policy = JSON.parse(
      readFileSync(join(root, 'server/src/maintenance/maintenanceSchedulePolicy.json'), 'utf8')
    );
    policy.phase1Status = 'off';
    policy.completionEvidence = 'isolated daily-preparation fixture';
    mkdirSync(join(dir, 'server/scripts'), { recursive: true });
    writeFileSync(
      join(dir, 'server/scripts/engine-release-seal.py'),
      readFileSync(join(root, 'server/scripts/engine-release-seal.py'))
    );
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'policy.json'), JSON.stringify(policy));
    writeFileSync(
      join(dir, 'bin/git'),
      `#!/usr/bin/env bash
set -eu
[ "$1" = -C ] && [ "$2" = . ] && [ "$3" = show ]
[ "$4" = '${'a'.repeat(40)}:server/src/maintenance/maintenanceSchedulePolicy.json' ]
cat '${join(dir, 'policy.json')}'
`
    );
    chmodSync(join(dir, 'bin/git'), 0o755);
    const runs = (c.runs ?? []).map((r) => ({ head_branch: 'main', ...r }));
    const result = spawnSync(
      'bash',
      [
        '-c',
        `
      git() { printf '%s' "$MESSAGE"; }
      date() { printf 14; }
      gh() {
        case "$*" in
          *'/workflows/'*)
            printf '%s\\n' "\${@: -1}" >> "$LIST_LOG"
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
          PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
          GITHUB_SHA: 'a'.repeat(40),
          EVENT_NAME: c.event,
          SENDER_TYPE: c.sender ?? 'User',
          GITHUB_RUN_ATTEMPT: String(c.attempt ?? 1),
          PUSHED_AT: c.pushedAt ?? '',
          RUN_CREATED_AT: c.createdAt ?? '',
          RUNS_JSON: JSON.stringify(
            c.pages ?? {
              total_count: c.totalCount ?? runs.length,
              workflow_runs: runs,
            }
          ),
          LIST_FAILS: c.listFails ? '1' : '0',
          LIST_LOG: join(dir, 'list.log'),
          HEALTH: c.health ?? '{"liveness":"ok"}',
          MESSAGE: c.message ?? 'routine',
          REPO: 'test/repo',
          RUNNER_TEMP: dir,
          RUN_ID: '123',
          GITHUB_OUTPUT: join(dir, 'output'),
        },
      }
    );
    expect(result.status, result.stdout + result.stderr).toBe(c.attempt === 2 ? 1 : 0);
    if (c.attempt === 2)
      return {
        outputs: {} as Record<string, string>,
        listed: [],
        stdout: result.stdout,
        status: result.status,
      };
    const outputs = Object.fromEntries(
      readFileSync(join(dir, 'output'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
    );
    const listed = existsSync(join(dir, 'list.log'))
      ? readFileSync(join(dir, 'list.log'), 'utf8').trim().split('\n')
      : [];
    return { outputs, listed, stdout: result.stdout, status: result.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the daily preparation reserves early and executes at the unchanged cutoff', () => {
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

  it('admits the original operator delivery using the same window and first owner', () => {
    expect(stage.on.repository_dispatch.types).toEqual(['prepare-daily-engine']);
    const event = 'repository_dispatch' as const;
    const createdAt = '2026-11-08T09:35:00Z';
    expect(admit({ event, createdAt, attempt: 2 }).status).toBe(1);
    expect(admit({ event, createdAt }).outputs.daily_preparation_date).toBe('2026-11-08');
    for (const refused of [
      { sender: 'Bot' },
      { createdAt: '2026-11-08T09:50:00Z' },
      { createdAt: '2026-11-08T04:31:00Z' },
      { listFails: true },
      { runs: [{ id: 11, event: 'schedule', created_at: createdAt }] },
    ]) {
      expect(admit({ event, createdAt, ...refused }).outputs.allowed).toBe('false');
    }
    const previous = {
      id: 12,
      event,
      created_at: createdAt,
      actor: { type: 'User' },
      run_attempt: 1,
      display_title: 'Original operator daily preparation',
    };
    expect(admit({ event: 'schedule', createdAt, runs: [previous] }).outputs.allowed).toBe('false');
    expect(
      admit({ event: 'schedule', createdAt, runs: [{ ...previous, run_attempt: 2 }] }).outputs
        .allowed
    ).toBe('false');
    expect(
      admit({ event: 'schedule', createdAt, runs: [{ ...previous, actor: { type: 'Bot' } }] })
        .outputs.allowed
    ).toBe('true');
  });

  it('a run created outside the window prepares nothing and asks nobody', () => {
    for (const createdAt of [
      '2026-11-01T03:29:59Z', // before the five-hour elapsed reservation
      '2026-10-21T09:31:00Z', // 04:31 CDT: the CST twin on a CDT day
      '2026-12-21T04:29:59Z', // one second before reservation
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

  it('reserves up to five elapsed hours early across both DST changes', () => {
    for (const [createdAt, expected] of [
      ['2026-11-09T04:30:00Z', '2026-11-09'],
      ['2026-11-01T04:30:00Z', '2026-11-01'],
      ['2027-03-14T03:30:00Z', '2027-03-14'],
    ]) {
      const { outputs } = admit({ event: 'schedule', createdAt });
      expect(outputs.daily_preparation).toBe('true');
      expect(outputs.daily_preparation_date).toBe(expected);
      expect(Number(outputs.cutoff_epoch) - Number(epoch(createdAt))).toBe(18000);
    }
  });

  it('an early original reservation owns the date but an old no-op does not', () => {
    const run = { id: 1, event: 'push', created_at: '2026-11-09T04:31:00Z' };
    const c = { event: 'schedule' as const, createdAt: '2026-11-09T09:31:00Z' };
    expect(admit({ ...c, runs: [run] }).outputs.allowed).toBe('true');
    expect(
      admit({ ...c, runs: [{ ...run, display_title: 'Daily engine reservation' } as never] })
        .outputs.allowed
    ).toBe('false');
  });

  it('reads all reservation pages and refuses an incomplete page', () => {
    const c = { event: 'schedule' as const, createdAt: '2026-11-09T09:31:00Z' };
    const owner = {
      id: 1,
      event: 'push',
      created_at: '2026-11-09T04:31:00Z',
      head_branch: 'main',
      display_title: 'Daily engine reservation',
    };
    expect(
      admit({
        ...c,
        pages: [
          { total_count: 1, workflow_runs: [] },
          { total_count: 1, workflow_runs: [owner] },
        ],
      }).outputs.allowed
    ).toBe('false');
    expect(
      admit({ ...c, pages: [{ total_count: 1, workflow_runs: [] }] }).outputs.daily_preparation
    ).toBe('unknown');
    expect(admit({ ...c, pages: [{ total_count: 1 }] }).outputs.daily_preparation).toBe('unknown');
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
      'repos/test/repo/actions/workflows/stage-engine-release.yml/runs?created=2026-11-01T04:30:00Z..2026-11-01T09:50:00Z&per_page=100',
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

  it('admits the automatic Backup completion in the original window and preserves the cutoff', () => {
    expect(stage.on.workflow_run).toEqual({
      workflows: ['Backup Engine (Clone, Stage, Certify)'],
      branches: ['main'],
      types: ['completed'],
    });
    expect(stage.jobs.detect.if).toContain("github.event.workflow_run.event == 'push'");
    expect(stage.jobs.detect.if).toContain("github.event.workflow_run.conclusion == 'success'");
    const automatic = {
      id: 90,
      event: 'workflow_run',
      created_at: '2026-11-08T09:41:03Z',
      display_title: 'Automatic Backup daily reservation',
    };
    expect(
      admit({ event: 'workflow_run', createdAt: automatic.created_at }).outputs.daily_preparation
    ).toBe('true');
    expect(
      admit({ event: 'workflow_run', createdAt: '2026-11-08T09:50:00Z' }).outputs.daily_preparation
    ).toBe('false');
    const push = { event: 'push' as const, pushedAt: epoch('2026-11-08T09:44:00Z') };
    expect(admit({ ...push, runs: [automatic] }).outputs.daily_preparation).toBe('false');
    expect(
      admit({
        ...push,
        runs: [{ ...automatic, display_title: 'Backup completion outside election' }],
      }).outputs.daily_preparation
    ).toBe('true');
  });

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

  it('unrelated manual, foreign-branch and out-of-window runs do not compete', () => {
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

  it('a refused duplicate cannot regain admission through emergency or transition routes', () => {
    const earlier = { runs: [{ id: 1, event: 'schedule', created_at: '2026-11-01T09:32:00Z' }] };
    const degraded = admit({ ...inWindow, ...earlier, health: '{"liveness":"dead"}' });
    expect(degraded.outputs.allowed).toBe('false');
    expect(degraded.outputs.daily_preparation).toBe('false');
    const transition = admit({
      ...inWindow,
      ...earlier,
      message: 'x\n\nEngine-Release: daily-maintenance-transition',
    });
    expect(transition.outputs.allowed).toBe('false');
    expect(transition.outputs.daily_preparation).toBe('false');
    // Commit urgency is still nothing, inside the window or out of it.
    expect(
      admit({ ...inWindow, ...earlier, message: 'x\n\nEngine-Release: urgent' }).outputs.allowed
    ).toBe('false');
  });
});

describe('the workflow adds chances, not authority', () => {
  it('separates the installer from an explicit owner engine selection', () => {
    const job = stage.jobs['window-migrations'];
    expect(job.if).toContain('!inputs.request_engine_release');
    expect(job.if).toContain("needs.detect.outputs.daily_preparation == 'true'");
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

  it('retains only daily odd-minute DST chances', () => {
    expect(stage.on.schedule).toEqual([
      { cron: '31,35,39,43 3,8 * * *' },
      { cron: '31,35,39,43 4,9 * * *' },
    ]);
    expect(Object.keys(stage.jobs).sort()).toEqual([
      'detect',
      'selection',
      'signal',
      'window-migrations',
    ]);
  });

  it('the admission itself only reads: no dispatch, no write, no wait', () => {
    expect(admissionStep.env.PUSHED_AT).toBe("${{ github.event.repository.pushed_at || '' }}");
    expect(stage.jobs.detect.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(admission).not.toMatch(/dispatches|--method|-X POST|sleep|while true/);
    expect(admission).toContain('START_HOUR, START_MINUTE, WINDOW_MINUTES = 3, 30, 20');
    expect(admission).toContain('ZoneInfo("America/Chicago")');
  });
});

describe('the original reserved job waits once and expires without a release', () => {
  const cutoffStep = stage.jobs.detect.steps.find((s: { id?: string }) => s.id === 'cutoff');
  const cutoff = Number(epoch('2026-11-09T09:30:00Z'));
  function bind(before: number, after: number, changed = false, owner = false) {
    const dir = mkdtempSync(join(tmpdir(), 'daily-reservation-'));
    try {
      const result = spawnSync(
        'bash',
        [
          '-c',
          `
        date() { if [ -f "$MARK" ]; then printf '%s' "$AFTER"; else touch "$MARK"; printf '%s' "$BEFORE"; fi; }
        sleep() { printf '%s' "$1" > "$WAIT_LOG"; }
        git() { if [ "$1" = rev-list ]; then printf '%040d' 1; fi; }
        python3() { cat > /dev/null; return "$CHANGED"; }
        gh() { return 1; }
        ${cutoffStep.run}
      `,
        ],
        {
          encoding: 'utf8',
          cwd: dir,
          env: {
            ...process.env,
            CUTOFF_EPOCH: owner ? '' : String(cutoff),
            OWNER_WINDOW_ID: owner ? 'validated-finite-owner' : '',
            BEFORE: String(before),
            AFTER: String(after),
            MARK: join(dir, 'clock'),
            WAIT_LOG: join(dir, 'wait'),
            GITHUB_OUTPUT: join(dir, 'output'),
            CHANGED: changed ? '1' : '0',
            GITHUB_SHA: 'a'.repeat(40),
          },
        }
      );
      return {
        status: result.status,
        wait: existsSync(join(dir, 'wait')) ? readFileSync(join(dir, 'wait'), 'utf8') : null,
        output: existsSync(join(dir, 'output')) ? readFileSync(join(dir, 'output'), 'utf8') : '',
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  it('preserves the already admitted finite owner source without a daily cutoff or wait', () => {
    expect(cutoffStep.env.OWNER_WINDOW_ID).toBe('${{ steps.admission.outputs.owner_window_id }}');
    expect(bind(cutoff + 24000, cutoff + 24001, false, true)).toEqual({
      status: 0,
      wait: null,
      output: `sha=${'a'.repeat(40)}\n`,
    });
  });
  it('waits once for five hours maximum and binds source only at the cutoff', () => {
    expect(bind(cutoff - 18000, cutoff)).toEqual({
      status: 0,
      wait: '18000',
      output: `sha=${'0'.repeat(39)}1\n`,
    });
    expect(bind(cutoff + 1, cutoff + 2).wait).toBeNull();
    expect(stage.jobs.detect['timeout-minutes']).toBe(315);
    expect(cutoffStep.run).toContain('git fetch --no-tags origin main');
    expect(cutoffStep.run).toContain(
      'module.projection(os.environ["GITHUB_SHA"], release_authority=True)'
    );
    expect(stage.jobs.selection.steps[0].with.ref).toBe(
      '${{ needs.detect.outputs.protected_sha }}'
    );
  });
  it('refuses an excessive wait, early wake, missed date and changed authority', () => {
    for (const args of [
      [cutoff - 18001, cutoff],
      [cutoff - 1, cutoff - 1],
      [cutoff, cutoff + 1200],
      [cutoff, cutoff, true],
    ] as [number, number, boolean?][]) {
      const result = bind(args[0], args[1], args[2]);
      expect(result.status).not.toBe(0);
      // A refusal binds no source. A changed-authority refusal only names
      // whether a later run owns the date (here the run list is unreadable),
      // so the window installer is launched once (2026-11-14).
      expect(result.output).not.toContain('sha=');
      expect(result.output).toBe(args[2] ? 'successor=unknown\n' : '');
    }
  });
});
