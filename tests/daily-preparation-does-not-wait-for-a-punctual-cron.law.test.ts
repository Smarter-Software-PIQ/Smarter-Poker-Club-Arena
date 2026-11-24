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
  readdirSync,
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
  // What the election reads to tell whether an earlier run claimed (O25).
  status?: string;
  conclusion?: string | null;
  updated_at?: string;
};
type Case = {
  event: 'push' | 'schedule' | 'repository_dispatch' | 'workflow_run';
  sender?: string;
  attempt?: number;
  // The run's own created_at from the API: the moment of EVERY event, a push
  // included (2026-11-23), because it is the clock the election reads.
  createdAt?: string;
  // The push payload's repository.pushed_at (epoch seconds). The admission
  // must never read it; the harness still sets it so a case can prove that.
  pushedAt?: string;
  runId?: number;
  runs?: Run[];
  totalCount?: number;
  listFails?: boolean;
  runReadFails?: boolean;
  // O25: the first N reads of this run's own record / of /health fail.
  runReadFailFirst?: number;
  healthFailFirst?: number;
  // O25: the job record of an earlier run, by run id (absent: unreadable).
  jobs?: Record<number, unknown>;
  pages?: unknown[];
  health?: string;
  message?: string;
  policy?: Record<string, unknown>;
};

const epoch = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

function admit(c: Case) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-prep-'));
  try {
    const policy = c.policy ?? {
      // The retained v1 shape keeps this daily/Phase1 law on its own route;
      // the protected v2 three-hourly policy (2026-11-21) is pinned by
      // tests/the-engine-cuts-over-every-three-hours.law.test.ts.
      schema: 'engine-maintenance-schedule/v1',
      policyId: 'phase1-hourly-01a1944f',
      timeZone: 'America/Chicago',
      phase1Status: 'off',
      ownerMessageId: '01a1944f-7131-7f11-8dcc-873d576e781c',
      completionEvidence: null as string | null,
    };
    if (!c.policy) {
      policy.phase1Status = 'off';
      policy.completionEvidence = 'isolated daily-preparation fixture';
    }
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
    mkdirSync(join(dir, 'jobs'));
    for (const [id, record] of Object.entries(c.jobs ?? {}))
      writeFileSync(join(dir, 'jobs', `${id}.json`), JSON.stringify(record));
    const result = spawnSync(
      'bash',
      [
        '-c',
        `
      git() { printf '%s' "$MESSAGE"; }
      date() { printf 14; }
      gh() {
        case "$*" in
          *'/jobs?'*)
            printf '%s\\n' "$2" >> "$JOBS_LOG"
            record="$JOBS_DIR/$(printf '%s' "$2" | sed -E 's#.*/runs/([0-9]+)/jobs.*#\\1#').json"
            [ -f "$record" ] || return 1
            cat "$record" ;;
          *'/workflows/'*)
            printf '%s\\n' "\${@: -1}" >> "$LIST_LOG"
            [ "$LIST_FAILS" != 1 ] || return 1
            printf '%s' "$RUNS_JSON" ;;
          *)
            printf 'x\\n' >> "$RUN_READ_LOG"
            [ "$RUN_READ_FAILS" != 1 ] || return 1
            [ "$(wc -l < "$RUN_READ_LOG")" -gt "$RUN_READ_FAIL_FIRST" ] || return 1
            printf '%s' "$RUN_CREATED_AT" ;;
        esac
      }
      curl() {
        printf 'x\\n' >> "$HEALTH_LOG"
        [ "$(wc -l < "$HEALTH_LOG")" -gt "$HEALTH_FAIL_FIRST" ] || return 1
        # Not $HEALTH: the step itself assigns that name after its first read.
        printf '%s' "$HEALTH_BODY"
      }
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
          RUN_READ_FAILS: c.runReadFails ? '1' : '0',
          RUN_READ_FAIL_FIRST: String(c.runReadFailFirst ?? 0),
          RUN_READ_LOG: join(dir, 'run-read.log'),
          HEALTH_FAIL_FIRST: String(c.healthFailFirst ?? 0),
          HEALTH_LOG: join(dir, 'health.log'),
          JOBS_DIR: join(dir, 'jobs'),
          JOBS_LOG: join(dir, 'jobs.log'),
          LIST_LOG: join(dir, 'list.log'),
          HEALTH: c.health ?? '{"liveness":"ok"}',
          HEALTH_BODY: c.health ?? '{"liveness":"ok"}',
          MESSAGE: c.message ?? 'routine',
          REPO: 'test/repo',
          RUNNER_TEMP: dir,
          RUN_ID: String(c.runId ?? 123),
          GITHUB_OUTPUT: join(dir, 'output'),
        },
      }
    );
    expect(result.status, result.stdout + result.stderr).toBe(c.attempt === 2 ? 1 : 0);
    if (c.attempt === 2)
      return {
        outputs: {} as Record<string, string>,
        listed: [],
        asked: [] as string[],
        reads: { run: 0, health: 0 },
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
    const lines = (name: string) =>
      existsSync(join(dir, name))
        ? readFileSync(join(dir, name), 'utf8').trim().split('\n').filter(Boolean)
        : [];
    return {
      outputs,
      listed,
      asked: lines('jobs.log'),
      reads: { run: lines('run-read.log').length, health: lines('health.log').length },
      stdout: result.stdout + result.stderr,
      status: result.status,
    };
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
    // A push is judged by its run's created_at, like every other event.
    const { outputs, listed } = admit({ event: 'push', createdAt: '2026-11-01T09:40:00Z' });
    expect(outputs.allowed).toBe('true');
    expect(outputs.daily_preparation).toBe('true');
    expect(outputs.daily_preparation_date).toBe('2026-11-01');
    expect(listed).toEqual([
      'repos/test/repo/actions/workflows/stage-engine-release.yml/runs?created=2026-11-01T04:30:00Z..2026-11-01T09:50:00Z&per_page=100',
    ]);
    // Daytime pushes still queue, and a run whose creation time cannot be
    // read is still no admission, even with an in-window push payload time.
    for (const createdAt of ['2026-11-01T19:40:00Z', '']) {
      const queued = admit({ event: 'push', createdAt, pushedAt: epoch('2026-11-01T09:40:00Z') });
      expect(queued.outputs.allowed).toBe('false');
      expect(queued.outputs.daily_preparation).toBe('false');
      expect(queued.listed).toEqual([]);
    }
  });
});

describe('the preparation happens once per Chicago date', () => {
  const inWindow = { event: 'push' as const, createdAt: '2026-11-01T09:44:00Z' };

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
    const push = { event: 'push' as const, createdAt: '2026-11-08T09:44:00Z' };
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

  it('retains only odd-minute DST chances', () => {
    expect(stage.on.schedule).toEqual([
      // Every three-hourly preparation hour and the reservation hour before
      // it, in both offsets (owner order 2026-11-21); the daily policy admits
      // only 03:30 from the same events.
      { cron: '31,35,39,43 0,1,2,3,4,5,6,7,8,9,10,11 * * *' },
      { cron: '31,35,39,43 12,13,14,15,16,17,18,19,20,21,22,23 * * *' },
    ]);
    expect(Object.keys(stage.jobs).sort()).toEqual([
      'cutover-log-keep-serving',
      'detect',
      'selection',
      'signal',
      'window-migrations',
    ]);
    // cutover-log-keep-serving (O20) is reporting-only on issue #11599:
    // no contents:write, no environment/secrets, continue-on-error: true.
    expect(stage.jobs['cutover-log-keep-serving'].permissions).toEqual({
      actions: 'read',
      contents: 'read',
      issues: 'write',
    });
    expect(stage.jobs['cutover-log-keep-serving']['continue-on-error']).toBe(true);
    expect(stage.jobs['cutover-log-keep-serving'].environment).toBeUndefined();
  });

  it('the admission itself only reads: no dispatch, no write, no wait', () => {
    // MOVED 2026-11-23: this pin used to require PUSHED_AT (the push payload's
    // repository.pushed_at). That second clock is what stranded the 01:00
    // Chicago cycle: the election can only see created_at, so a push is now
    // judged by its run's created_at and the payload time is not read at all.
    expect(admissionStep.env.PUSHED_AT).toBeUndefined();
    expect(admission).not.toMatch(/\$\{?PUSHED_AT/);
    expect(stageText).not.toContain('${{ github.event.repository.pushed_at');
    expect(admission).toContain(
      'if [ "$EVENT_NAME" = schedule ] || [ "$EVENT_NAME" = push ] || [ "$EVENT_NAME" = workflow_run ]'
    );
    expect(admission).toContain(
      'moment=$(gh api "repos/$REPO/actions/runs/$RUN_ID" --jq .created_at)'
    );
    // MOVED 2026-11-24 (O25): detect gained issues: write and statuses: read
    // for the owner's readiness comments on the cutover log issue, posted from
    // inside its existing cutoff wait. The admission step still only reads
    // (next line), and the one write in the whole job is pinned in the O25
    // early-warning tests below: a comment on that issue, nothing else.
    expect(stage.jobs.detect.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      issues: 'write',
      statuses: 'read',
    });
    expect(admission).not.toMatch(/dispatches|--method|-X POST|sleep|while true/);
    expect(admission).toContain('WINDOW_MINUTES = 20');
    expect(admission).toContain('LOOKBACK = timedelta(hours=5) if not three_hourly');
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

describe('the real protected policy gets an early reservation before every cycle, winter and summer', () => {
  // The protected v2 policy itself (three-hourly since 2026-11-21) and its
  // daily setting: the same file with frequency "daily".
  const real = JSON.parse(
    readFileSync(join(root, 'server/src/maintenance/maintenanceSchedulePolicy.json'), 'utf8')
  );
  const threeHourly = { ...real, frequency: 'three-hourly' };
  const daily = { ...real, frequency: 'daily' };
  const serving = JSON.stringify({
    liveness: 'ok',
    maintenance: {
      schedule: { frequency: 'three-hourly', startHours: [1, 4, 7, 10, 13, 16, 19, 22] },
    },
  });
  // Every UTC instant the workflow's own cron lines fire in a day.
  function fires(cronLines: string[], dayIso: string): number[] {
    const base = Date.parse(`${dayIso}T00:00:00Z`);
    const out: number[] = [];
    for (const line of cronLines) {
      const [minutes, hours, ...rest] = line.split(' ');
      expect(rest).toEqual(['*', '*', '*']);
      for (const d of [-1, 0, 1])
        for (const h of hours.split(','))
          for (const m of minutes.split(','))
            out.push(base + d * 86_400_000 + Number(h) * 3_600_000 + Number(m) * 60_000);
    }
    return out.sort((a, b) => a - b);
  }
  // Each cycle start on this Chicago date: its first early cron firing inside
  // the reservation (cutoff - lookback .. cutoff) must reserve that cycle.
  function covered(
    cronLines: string[],
    dayIso: string,
    cycles: string[],
    policy: Record<string, unknown>,
    lookbackMinutes: number
  ): string[] {
    const missing: string[] = [];
    const all = fires(cronLines, dayIso);
    for (const startIso of cycles) {
      const cutoff = Date.parse(startIso) - 1_800_000;
      const early = all.find((t) => cutoff - lookbackMinutes * 60_000 <= t && t < cutoff);
      if (early === undefined) {
        missing.push(startIso);
        continue;
      }
      const { outputs } = admit({
        event: 'schedule',
        createdAt: new Date(early).toISOString(),
        policy,
        health: serving,
      });
      expect(outputs.daily_preparation, startIso).toBe('true');
      expect(Number(outputs.cutoff_epoch), startIso).toBe(cutoff / 1000);
    }
    return missing;
  }
  const crons = (stage.on.schedule as { cron: string }[]).map((s) => s.cron);
  const oldCrons = [
    '31,35,39,43 0,2,3,5,6,8,9,11 * * *',
    '31,35,39,43 12,14,15,17,18,20,21,23 * * *',
  ];
  // Chicago 01,04,...,22 as UTC: CST (UTC-6) on 2026-12-15, CDT (UTC-5) on 2027-06-15.
  const winter = [1, 4, 7, 10, 13, 16, 19, 22].map((h) =>
    new Date(Date.parse('2026-12-15T06:00:00Z') + h * 3_600_000).toISOString()
  );
  const summer = [1, 4, 7, 10, 13, 16, 19, 22].map((h) =>
    new Date(Date.parse('2027-06-15T05:00:00Z') + h * 3_600_000).toISOString()
  );

  it('three-hourly: every cycle, CST and CDT, has a reserving run before its :30', () => {
    expect(covered(crons, '2026-12-15', winter, threeHourly, 100)).toEqual([]);
    expect(covered(crons, '2027-06-15', summer, threeHourly, 100)).toEqual([]);
  });

  it('the previous cron lines left every CDT cycle without an early reservation', () => {
    expect(covered(oldCrons, '2027-06-15', summer, threeHourly, 100)).toEqual(summer);
  });

  it('daily: the 04:00 anchor is reserved early in both offsets, and no other cycle', () => {
    for (const [day, anchor] of [
      ['2026-12-15', '2026-12-15T10:00:00Z'],
      ['2027-06-15', '2027-06-15T09:00:00Z'],
    ]) {
      expect(covered(crons, day, [anchor], daily, 300)).toEqual([]);
      // A three-hourly-only preparation (07:00 cycle, 06:31 Chicago) prepares nothing.
      const seven = Date.parse(anchor) + 3 * 3_600_000 - 1_800_000 + 60_000;
      const { outputs } = admit({
        event: 'schedule',
        createdAt: new Date(seven).toISOString(),
        policy: daily,
        health: serving,
      });
      expect(outputs.daily_preparation, day).toBe('false');
    }
  });
});

describe('a reservation is elected by the moment it claims (2026-11-23, the 01:00 Chicago cycle)', () => {
  // The incident, as GitHub recorded it. The 01:00 CST cycle is 07:00Z; its
  // preparation is 06:30-06:50Z and, under the three-hourly policy, its
  // reservation opens 100 minutes before that, at 04:50:00Z. Push run
  // 45114163784 was pushed at 04:49:59Z (repository.pushed_at 1795409399) and
  // created at 04:50:01Z. It judged itself by the push time, found no window
  // and prepared nothing; every later run judged it by its created_at, found
  // an earlier eligible run and deferred to it. Nobody prepared the cycle and
  // the engine kept serving the 19:00 release through the 01:00 break.
  const real = JSON.parse(
    readFileSync(join(root, 'server/src/maintenance/maintenanceSchedulePolicy.json'), 'utf8')
  );
  const policy = { ...real, frequency: 'three-hourly' };
  const health = JSON.stringify({
    liveness: 'ok',
    maintenance: {
      schedule: { frequency: 'three-hourly', startHours: [1, 4, 7, 10, 13, 16, 19, 22] },
    },
  });
  const opens = '2026-11-23T04:50:00Z';
  const query =
    'repos/test/repo/actions/workflows/stage-engine-release.yml/runs?created=2026-11-23T04:50:00Z..2026-11-23T06:50:00Z&per_page=100';
  const title = 'Daily engine reservation';
  const first = {
    id: 45114163784,
    event: 'push',
    created_at: '2026-11-23T04:50:01Z',
    display_title: title,
  };
  const before = (iso: string, seconds: number) => String(Number(epoch(iso)) - seconds);
  const claim = (c: Partial<Case>) => admit({ event: 'push', policy, health, ...c });

  it('the push made one second before the opening, whose run is created after it, owns and prepares the cycle', () => {
    expect(epoch(opens)).toBe('1795409400');
    const { outputs, listed, stdout } = claim({
      runId: first.id,
      pushedAt: '1795409399', // 04:49:59Z: one second before the reservation opens
      createdAt: first.created_at, // 04:50:01Z: two seconds after
      runs: [first],
    });
    expect(outputs.allowed, stdout).toBe('true');
    expect(outputs.daily_preparation).toBe('true');
    expect(outputs.daily_preparation_date).toBe('2026-11-23T01');
    expect(outputs.cutoff_epoch).toBe(epoch('2026-11-23T06:30:00Z'));
    expect(outputs.lookback_seconds).toBe('6000');
    expect(listed).toEqual([query]);
    expect(stdout).toContain(`owned by this run (${first.id})`);
  });

  it('the later pushes in that window defer to it by name and prepare nothing', () => {
    const second = {
      id: 45121321101,
      event: 'push',
      created_at: '2026-11-23T06:00:51Z',
      display_title: title,
    };
    const third = {
      id: 45123768860,
      event: 'push',
      created_at: '2026-11-23T06:23:25Z',
      display_title: title,
    };
    for (const [me, runs] of [
      [second, [first, second]],
      [third, [first, second, third]],
    ] as const) {
      const { outputs, stdout } = claim({
        runId: me.id,
        pushedAt: before(me.created_at, 2),
        createdAt: me.created_at,
        runs: [...runs],
      });
      expect(outputs.allowed, String(me.id)).toBe('false');
      expect(outputs.daily_preparation, String(me.id)).toBe('false');
      expect(stdout).toContain(`belongs to earlier run ${first.id}`);
    }
  });

  it('a run created at or after the window end claims nothing, whatever its push time', () => {
    for (const createdAt of [
      '2026-11-23T06:50:00Z',
      '2026-11-23T06:50:01Z',
      '2026-11-23T07:20:00Z',
    ]) {
      const { outputs, listed } = claim({
        createdAt,
        pushedAt: epoch('2026-11-23T06:49:59Z'), // inside the window: a delayed event
      });
      expect(outputs.allowed, createdAt).toBe('false');
      expect(outputs.daily_preparation, createdAt).toBe('false');
      expect(listed, createdAt).toEqual([]);
    }
  });

  it('every run the election counts is a run that claims for itself, and no other', () => {
    // A run created at t (its push two seconds earlier) claims the cycle
    // exactly when a later run in the window would defer to it.
    const later = {
      id: 2000,
      event: 'push',
      created_at: '2026-11-23T06:49:59Z',
      display_title: title,
    };
    const table: [string, boolean][] = [
      ['2026-11-23T04:49:59Z', false],
      ['2026-11-23T04:50:00Z', true],
      ['2026-11-23T04:50:01Z', true],
      ['2026-11-23T06:49:59Z', true],
      ['2026-11-23T06:50:00Z', false],
    ];
    for (const [t, owns] of table) {
      const self = { id: 1000, event: 'push', created_at: t, display_title: title };
      const claimed =
        claim({ runId: 1000, createdAt: t, pushedAt: before(t, 2), runs: [self] }).outputs
          .daily_preparation === 'true';
      const elected = claim({
        runId: later.id,
        createdAt: later.created_at,
        pushedAt: before(later.created_at, 2),
        runs: [self, later],
      });
      const deferred = elected.outputs.daily_preparation === 'false';
      expect(claimed, t).toBe(owns);
      expect(deferred, t).toBe(claimed);
      if (deferred) expect(elected.stdout, t).toContain('belongs to earlier run 1000');
    }
  });

  it('a push whose own creation time cannot be read says UNKNOWN and prepares nothing', () => {
    const { outputs, listed, stdout } = claim({
      createdAt: first.created_at,
      pushedAt: before(first.created_at, 2),
      runReadFails: true,
    });
    expect(outputs.allowed).toBe('false');
    expect(outputs.daily_preparation).toBe('false');
    expect(listed).toEqual([]);
    expect(stdout).toContain(
      "DAILY PREPARATION UNKNOWN::Could not read this run's own creation time"
    );
  });
});

describe('a reservation that cannot claim does not orphan the cycle (O25, 2026-11-24)', () => {
  // The audit after #11836: the election handed the cycle to the lowest
  // earlier run id whatever that run did. A run whose own reads failed claimed
  // nothing and ended green, every later run still deferred to it, and the
  // cycle had no owner. The election now reads what each earlier run did.
  const real = JSON.parse(
    readFileSync(join(root, 'server/src/maintenance/maintenanceSchedulePolicy.json'), 'utf8')
  );
  const policy = { ...real, frequency: 'three-hourly' };
  const health = JSON.stringify({
    liveness: 'ok',
    maintenance: {
      schedule: { frequency: 'three-hourly', startHours: [1, 4, 7, 10, 13, 16, 19, 22] },
    },
  });
  // The 01:00 CST cycle of 2026-11-23: reservation 04:50Z, cutoff 06:30Z, end 06:50Z.
  const cutoffAt = '2026-11-23T06:30:00Z';
  const title = 'Daily engine reservation';
  const waitStep = stage.jobs.detect.steps.find((s: { id?: string }) => s.id === 'cutoff');
  const at = (iso: string, seconds: number) =>
    new Date(Date.parse(iso) + seconds * 1000).toISOString().replace('.000Z', 'Z');
  const claim = (c: Partial<Case>) => admit({ event: 'push', policy, health, ...c });
  const run = (id: number, created_at: string, extra: Partial<Run> = {}): Run => ({
    id,
    event: 'push',
    created_at,
    display_title: title,
    run_attempt: 1,
    ...extra,
  });
  const going = (id: number, created: string) =>
    run(id, created, { status: 'in_progress', conclusion: null, updated_at: at(created, 5) });
  const green = (id: number, created: string, finished = at(created, 25)) =>
    run(id, created, { status: 'completed', conclusion: 'success', updated_at: finished });
  // A run's job record as GET /actions/runs/{id}/jobs returned it for run
  // 45432841011 (cutoff step skipped) and 45408673446 (cutoff step success).
  const record = (wait: string, detect: Record<string, unknown> = {}) => ({
    total_count: 2,
    jobs: [
      {
        name: stage.jobs.detect.name,
        status: 'completed',
        conclusion: 'success',
        run_attempt: 1,
        steps: [
          { name: 'Set up job', status: 'completed', conclusion: 'success', number: 1 },
          { name: admissionStep.name, status: 'completed', conclusion: 'success', number: 3 },
          { name: waitStep.name, status: 'completed', conclusion: wait, number: 4 },
        ],
        ...detect,
      },
      {
        name: stage.jobs.selection.name,
        status: 'completed',
        conclusion: 'skipped',
        run_attempt: 1,
        steps: [],
      },
    ],
  });
  const A = '2026-11-23T04:50:01Z';
  const B = '2026-11-23T04:50:05Z';
  const C = '2026-11-23T05:10:00Z';
  const D = '2026-11-23T05:20:00Z';

  it('a run tries its own two reads three times at once before it gives the cycle up', () => {
    const self = going(1000, A);
    const plain = claim({ runId: 1000, createdAt: A, runs: [self] });
    expect(plain.outputs.daily_preparation, plain.stdout).toBe('true');
    expect(plain.reads.run).toBe(1);
    const firstTwoFail = claim({ runId: 1000, createdAt: A, runs: [self], runReadFailFirst: 2 });
    expect(firstTwoFail.outputs.daily_preparation, firstTwoFail.stdout).toBe('true');
    expect(firstTwoFail.reads.run).toBe(3);
    // /health is read once before the schedule read under this policy when
    // Phase 1 is not active; the schedule read itself is the last one.
    const before = plain.reads.health - 1;
    const healthTwice = claim({
      runId: 1000,
      createdAt: A,
      runs: [self],
      healthFailFirst: before + 2,
    });
    expect(healthTwice.outputs.daily_preparation, healthTwice.stdout).toBe('true');
    expect(healthTwice.reads.health).toBe(before + 3);
    const never = claim({ runId: 1000, createdAt: A, runs: [self], healthFailFirst: 99 });
    expect(never.outputs.daily_preparation).toBe('false');
    expect(never.outputs.allowed).toBe('false');
    expect(never.reads.health).toBe(before + 3);
    expect(never.stdout).toContain('is not yet a serving engine break');
    const blind = claim({ runId: 1000, createdAt: A, runs: [self], runReadFails: true });
    expect(blind.outputs.daily_preparation).toBe('false');
    expect(blind.reads.run).toBe(3);
    expect(blind.listed).toEqual([]);
    // Bounded and immediate: three attempts, and the admission still never waits.
    expect(admission.match(/for _ in 1 2 3; do/g)?.length).toBe(2);
    expect(admission).not.toMatch(/sleep|--retry/);
  });

  it('the first run cannot read and claims nothing; once it has finished, the next run owns the cycle', () => {
    const first = claim({ runId: 1000, createdAt: A, runs: [going(1000, A)], runReadFails: true });
    expect(first.outputs.allowed).toBe('false');
    expect(first.outputs.daily_preparation).toBe('false');
    const second = claim({ runId: 1001, createdAt: B, runs: [green(1000, A), going(1001, B)] });
    expect(second.outputs.allowed, second.stdout).toBe('true');
    expect(second.outputs.daily_preparation).toBe('true');
    expect(second.outputs.cutoff_epoch).toBe(epoch(cutoffAt));
    expect(second.stdout).toContain('owned by this run (1001)');
    expect(second.stdout).toContain(
      '1 earlier run(s) finished without claiming this cycle (first 1000)'
    );
    expect(second.asked).toEqual([]);
    const third = claim({
      runId: 1002,
      createdAt: C,
      runs: [green(1000, A), going(1001, B), going(1002, C)],
    });
    expect(third.outputs.daily_preparation).toBe('false');
    expect(third.stdout).toContain('belongs to earlier run 1001');
  });

  it('the first run fails after the second already deferred: the third owns, and nobody else', () => {
    const second = claim({ runId: 1001, createdAt: B, runs: [going(1000, A), going(1001, B)] });
    expect(second.outputs.daily_preparation).toBe('false');
    expect(second.stdout).toContain('belongs to earlier run 1000');
    const third = claim({
      runId: 1002,
      createdAt: C,
      runs: [green(1000, A), green(1001, B), going(1002, C)],
    });
    expect(third.outputs.daily_preparation, third.stdout).toBe('true');
    expect(third.stdout).toContain('2 earlier run(s) finished without claiming');
    const fourth = claim({
      runId: 1003,
      createdAt: D,
      runs: [green(1000, A), green(1001, B), going(1002, C), going(1003, D)],
    });
    expect(fourth.outputs.daily_preparation).toBe('false');
    expect(fourth.stdout).toContain('belongs to earlier run 1002');
  });

  it('a replay of the failed run cannot claim, and a replayed run is never passed over', () => {
    const replay = claim({ runId: 1000, createdAt: A, runs: [going(1000, A)], attempt: 2 });
    expect(replay.status).toBe(1);
    expect(replay.stdout).toContain('A daily reservation cannot be replayed.');
    for (const replayed of [
      run(1000, A, { status: 'completed', conclusion: 'failure', run_attempt: 2, updated_at: C }),
      run(1000, A, { status: 'in_progress', conclusion: null, run_attempt: 2, updated_at: C }),
      run(1000, A, { status: 'completed', conclusion: 'success', run_attempt: 2, updated_at: C }),
    ]) {
      const later = claim({ runId: 1002, createdAt: D, runs: [replayed, going(1002, D)] });
      expect(later.outputs.daily_preparation, JSON.stringify(replayed)).toBe('false');
      expect(later.stdout).toContain('belongs to earlier run 1000');
      expect(later.asked).toEqual([]);
    }
  });

  it('every interleaving of three runs has at most one owner, and the cycle is never left to a run that stood down', () => {
    // Three runs created seconds apart. Each either can claim or cannot read
    // its own record. Each run has one admission (e) and, when it claimed
    // nothing, one green finish (f) some time later; a run that claimed holds
    // its job open until the cutoff. Every order of the six events is played
    // against the real admission step, for all eight capability patterns.
    const ids = [1000, 1001, 1002];
    const created = [A, at(A, 2), B];
    const memo = new Map<string, boolean>();
    const admits = (i: number, can: boolean, visible: boolean[]) => {
      const key = `${i}|${can}|${visible.join(',')}`;
      if (!memo.has(key)) {
        const runs = [
          ...visible.map((done, j) =>
            done ? green(ids[j], created[j]) : going(ids[j], created[j])
          ),
          going(ids[i], created[i]),
        ];
        const result = claim({ runId: ids[i], createdAt: created[i], runs, runReadFails: !can });
        memo.set(key, result.outputs.daily_preparation === 'true');
      }
      return memo.get(key)!;
    };
    const events = ['e0', 'f0', 'e1', 'f1', 'e2', 'f2'];
    const orders: string[][] = [];
    const permute = (rest: string[], done: string[]) => {
      if (!rest.length) return void orders.push(done);
      for (const next of rest) {
        if (next[0] === 'f' && !done.includes(`e${next[1]}`)) continue;
        permute(
          rest.filter((e) => e !== next),
          [...done, next]
        );
      }
    };
    permute(events, []);
    expect(orders.length).toBe(90);
    let handedOn = 0;
    for (let pattern = 0; pattern < 8; pattern++) {
      const can = ids.map((_, i) => Boolean(pattern & (1 << i)));
      for (const order of orders) {
        const claimed = [false, false, false];
        const finished = [false, false, false];
        for (const event of order) {
          const i = Number(event[1]);
          if (event[0] === 'f') {
            if (!claimed[i]) finished[i] = true;
            continue;
          }
          const visible = finished.slice(0, i);
          claimed[i] = admits(i, can[i], visible);
          const label = `${pattern} ${order.join(' ')} @${event}`;
          // Never while an earlier run is still going, whatever it will do.
          if (visible.some((done) => !done)) expect(claimed[i], label).toBe(false);
          // Always once every earlier run stood down and this run can claim.
          else expect(claimed[i], label).toBe(can[i]);
          if (claimed[i] && i > 0) handedOn++;
        }
        expect(claimed.filter(Boolean).length, `${pattern} ${order.join(' ')}`).toBeLessThanOrEqual(
          1
        );
      }
    }
    expect(handedOn).toBeGreaterThan(0);
    expect(memo.size).toBe(14);
  }, 180_000);

  it('a run that finished green inside the last two minutes or after the cutoff is asked through its own job record', () => {
    const late = '2026-11-23T06:29:10Z';
    const me = '2026-11-23T06:31:00Z';
    const ask = 'repos/test/repo/actions/runs/1000/jobs?per_page=100';
    const lateGreen = green(1000, late, at(late, 30));
    const stoodDown = claim({
      runId: 2000,
      createdAt: me,
      runs: [lateGreen, going(2000, me)],
      jobs: { 1000: record('skipped') },
    });
    expect(stoodDown.outputs.daily_preparation, stoodDown.stdout).toBe('true');
    expect(stoodDown.asked).toEqual([ask]);
    // The owner that prepared the cycle and finished green keeps it.
    const owner = claim({
      runId: 2000,
      createdAt: me,
      runs: [green(1000, A, at(cutoffAt, 74)), going(2000, me)],
      jobs: { 1000: record('success') },
    });
    expect(owner.outputs.daily_preparation).toBe('false');
    expect(owner.stdout).toContain('belongs to earlier run 1000');
    expect(owner.asked).toEqual([ask]);
    // Anything but one green detect job with its cutoff step skipped keeps the cycle.
    const unclear: (unknown | undefined)[] = [
      undefined, // the record cannot be read
      {},
      record('failure'),
      record('cancelled'),
      record('skipped', { conclusion: 'failure' }),
      record('skipped', { status: 'in_progress', conclusion: null }),
      record('skipped', { run_attempt: 2 }),
      record('skipped', { steps: [] }),
      { ...record('skipped'), total_count: 3 },
      { total_count: 2, jobs: [record('skipped').jobs[0], record('success').jobs[0]] },
      {
        total_count: 1,
        jobs: [
          {
            ...record('skipped').jobs[0],
            steps: [{ name: waitStep.name, status: 'in_progress', conclusion: 'skipped' }],
          },
        ],
      },
    ];
    for (const document of unclear) {
      const result = claim({
        runId: 2000,
        createdAt: me,
        runs: [lateGreen, going(2000, me)],
        jobs: document === undefined ? {} : { 1000: document },
      });
      expect(result.outputs.daily_preparation, JSON.stringify(document)).toBe('false');
      expect(result.stdout).toContain('belongs to earlier run 1000');
    }
    // The boundary: two minutes before the cutoff needs no question, one second later does.
    const early = '2026-11-23T06:27:00Z';
    for (const [finished, asked] of [
      [at(cutoffAt, -120), []],
      [at(cutoffAt, -119), [ask]],
    ] as [string, string[]][]) {
      const result = claim({
        runId: 2000,
        createdAt: me,
        runs: [green(1000, early, finished), going(2000, me)],
        jobs: { 1000: record('skipped') },
      });
      expect(result.outputs.daily_preparation, finished).toBe('true');
      expect(result.asked, finished).toEqual(asked);
    }
    expect(admission).toContain('STOOD_DOWN_MARGIN = 120');
  });

  it('asks at most five job records; a sixth unanswered run keeps the cycle', () => {
    const me = '2026-11-23T06:40:00Z';
    const lateRuns = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        green(1000 + i, at(cutoffAt, 10 + i), at(cutoffAt, 40 + i))
      );
    const records = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [1000 + i, record('skipped')]));
    const five = claim({
      runId: 2000,
      createdAt: me,
      runs: [...lateRuns(5), going(2000, me)],
      jobs: records(5),
    });
    expect(five.outputs.daily_preparation, five.stdout).toBe('true');
    expect(five.asked.length).toBe(5);
    const six = claim({
      runId: 2000,
      createdAt: me,
      runs: [...lateRuns(6), going(2000, me)],
      jobs: records(6),
    });
    expect(six.outputs.daily_preparation).toBe('false');
    expect(six.stdout).toContain('belongs to earlier run 1005');
    expect(six.asked.length).toBe(5);
  });

  it('a run still going, failed, cancelled or unreadable keeps the cycle exactly as before', () => {
    const keepers: Partial<Run>[] = [
      {}, // the list shape of every earlier test: no status at all
      { status: 'queued', conclusion: null, updated_at: A },
      { status: 'in_progress', conclusion: null, updated_at: A },
      { status: 'completed', conclusion: 'failure', updated_at: at(A, 30) },
      { status: 'completed', conclusion: 'cancelled', updated_at: at(A, 30) },
      { status: 'completed', conclusion: 'skipped', updated_at: at(A, 30) },
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'success', updated_at: 'yesterday' },
      { status: 'completed', conclusion: 'success', updated_at: '2026-11-23T04:50:30' },
      { status: 'completed', conclusion: 'success', updated_at: at(A, 30), run_attempt: undefined },
    ];
    for (const extra of keepers) {
      const result = claim({
        runId: 1002,
        createdAt: C,
        runs: [run(1000, A, extra), going(1002, C)],
      });
      expect(result.outputs.daily_preparation, JSON.stringify(extra)).toBe('false');
      expect(result.stdout, JSON.stringify(extra)).toContain('belongs to earlier run 1000');
      expect(result.asked).toEqual([]);
    }
    // An unreadable or truncated list is still UNKNOWN and prepares nothing (10.86).
    const unknown = claim({ runId: 1002, createdAt: C, listFails: true });
    expect(unknown.outputs.daily_preparation).toBe('unknown');
    expect(unknown.outputs.allowed).toBe('false');
    const truncated = claim({
      runId: 1002,
      createdAt: C,
      runs: [green(1000, A), going(1002, C)],
      totalCount: 3,
    });
    expect(truncated.outputs.daily_preparation).toBe('unknown');
    expect(truncated.outputs.allowed).toBe('false');
  });

  it('the election names the job and the step it reads exactly as the workflow names them', () => {
    expect(admission).toContain(`DETECT_JOB = "${stage.jobs.detect.name}"`);
    expect(admission).toContain(`CUTOFF_STEP = "${waitStep.name}"`);
    // Why "finished green before the cutoff" means "claimed nothing": the
    // cutoff step is the only way to the engine jobs, it runs exactly when the
    // admission allowed, and it cannot end green before the cutoff.
    expect(waitStep.if).toBe("steps.admission.outputs.allowed == 'true'");
    expect(waitStep.run).toContain(
      `[ "$now" -ge "$CUTOFF_EPOCH" ] && [ "$now" -lt "$((CUTOFF_EPOCH + 1200))" ] || { echo '::error::Reserved preparation window missed.'; exit 1; }`
    );
    expect(admission).toContain(
      '[ "$GITHUB_RUN_ATTEMPT" = 1 ] || { echo "::error::A daily reservation cannot be replayed."; exit 1; }'
    );
    expect(stage.jobs.signal.if).toBe(
      "needs.detect.outputs.release_required == 'true' && needs.detect.outputs.admission_allowed == 'true'"
    );
    expect(stage.jobs.detect.outputs.admission_allowed).toBe(
      '${{ steps.admission.outputs.allowed }}'
    );
  });
});

describe('the owner says what the cycle will find while there is still time (O25 early warning)', () => {
  const cutoffStep = stage.jobs.detect.steps.find((s: { id?: string }) => s.id === 'cutoff');
  const cutoff = Number(epoch('2026-11-23T06:30:00Z'));
  const runUrl = 'https://github.example/test/repo/actions/runs/9';
  type Warn = {
    clock: number[];
    report?: unknown;
    reportRc?: number;
    postRc?: number;
    fetchRc?: number;
    env?: Record<string, string>;
  };
  const report = (verdict: string, extra: Record<string, unknown> = {}) => ({
    schema: 1,
    verdict,
    summary: '',
    selectableSha: null,
    schedule: { preparationCutoffEpoch: cutoff },
    git: { totalCommitsSinceServing: 3, servingSha: 'f'.repeat(40) },
    candidates: [],
    ...extra,
  });
  const ready = report('READY', { selectableSha: 'a1b2c3d4e5f6' + '0'.repeat(28) });
  function warn(o: Warn) {
    const dir = mkdtempSync(join(tmpdir(), 'cycle-readiness-'));
    try {
      mkdirSync(join(dir, 'bodies'));
      writeFileSync(join(dir, 'clock'), o.clock.join('\n') + '\n');
      const result = spawnSync(
        'bash',
        [
          '-c',
          String.raw`
        date() {
          local n value
          n=$(cat "$TICK" 2>/dev/null || printf 0); n=$((n + 1)); printf '%s' "$n" > "$TICK"
          value=$(sed -n "$n"p "$CLOCK"); [ -n "$value" ] || value=$(tail -1 "$CLOCK")
          printf '%s' "$value"
        }
        sleep() { printf 'sleep %s\n' "$1" >> "$EVENTS"; }
        timeout() { printf 'timeout %s %s\n' "$1" "$2" >> "$EVENTS"; shift; BOUNDED=1 "$@"; }
        git() {
          if [ "$1" = fetch ] && [ "$BOUNDED" = 1 ]; then return "$FETCH_RC"; fi
          if [ "$1" = rev-list ]; then printf '%040d' 1; fi
        }
        python3() {
          case "$*" in
            *three-hourly-readiness.py*)
              [ "$BOUNDED" = 1 ] || exit 97
              printf 'readiness %s\n' "$*" >> "$EVENTS"
              printf '%s' "$REPORT"; return "$REPORT_RC" ;;
            *) cat > /dev/null; return 0 ;;
          esac
        }
        gh() {
          case "$*" in
            *'--method POST'*)
              [ "$BOUNDED" = 1 ] || exit 98
              printf 'post %s\n' "$4" >> "$EVENTS"
              printf '%s' "$6" > "$BODIES/$(ls "$BODIES" | wc -l | tr -d ' ').txt"
              return "$POST_RC" ;;
            *) return 1 ;;
          esac
        }
        BOUNDED=0
        ` + cutoffStep.run,
        ],
        {
          encoding: 'utf8',
          cwd: dir,
          env: {
            ...process.env,
            CUTOFF_EPOCH: String(cutoff),
            LOOKBACK_SECONDS: '6000',
            OWNER_WINDOW_ID: '',
            DAILY_PREPARATION: 'true',
            GITHUB_RUN_ATTEMPT: '1',
            LOG_ISSUE: '11599',
            RUN_URL: runUrl,
            REPO: 'test/repo',
            GITHUB_SHA: 'a'.repeat(40),
            GITHUB_OUTPUT: join(dir, 'output'),
            CLOCK: join(dir, 'clock'),
            TICK: join(dir, 'tick'),
            EVENTS: join(dir, 'events'),
            BODIES: join(dir, 'bodies'),
            REPORT: o.report === undefined ? JSON.stringify(ready) : JSON.stringify(o.report),
            REPORT_RC: String(o.reportRc ?? 0),
            POST_RC: String(o.postRc ?? 0),
            FETCH_RC: String(o.fetchRc ?? 0),
            ...o.env,
          },
        }
      );
      const events = existsSync(join(dir, 'events'))
        ? readFileSync(join(dir, 'events'), 'utf8').trim().split('\n')
        : [];
      const bodies = readdirSync(join(dir, 'bodies'))
        .sort()
        .map((name) => readFileSync(join(dir, 'bodies', name), 'utf8').replace(/^body=/, ''));
      return {
        status: result.status,
        log: result.stdout + result.stderr,
        events,
        sleeps: events.filter((e) => e.startsWith('sleep ')).map((e) => Number(e.slice(6))),
        posts: events.filter((e) => e.startsWith('post ')),
        bodies,
        output: existsSync(join(dir, 'output')) ? readFileSync(join(dir, 'output'), 'utf8') : '',
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const bound = `sha=${'0'.repeat(39)}1\n`;
  const line = (minutes: number, verdict: string) =>
    `Cycle: 2026-11-23 01:00 CST | Readiness at T-${minutes}m: ${verdict}\nStage: ${runUrl}`;

  it('reserved 100 minutes early: one comment at once, one 45 minutes before the cutoff, and the same wait', () => {
    // The clock as the step reads it: on arrival, after the first comment
    // (10 s), after the second (10 s), and at the cutoff.
    const result = warn({ clock: [cutoff - 6000, cutoff - 5990, cutoff - 2690, cutoff] });
    expect(result.status, result.log).toBe(0);
    expect(result.output).toBe(bound);
    expect(result.bodies).toEqual([
      line(100, 'READY a1b2c3d4e5f6'),
      line(45, 'READY a1b2c3d4e5f6'),
    ]);
    expect(result.posts).toEqual([
      'post repos/test/repo/issues/11599/comments',
      'post repos/test/repo/issues/11599/comments',
    ]);
    // One wait cut in two: up to T-45m, then what is left, measured again
    // after each comment, so the wait still ends at the cutoff.
    expect(result.sleeps).toEqual([5990 - 2700, 2690]);
    expect(result.events).toEqual([
      'timeout 45 git',
      'timeout 120 python3',
      'readiness -B scripts/release/three-hourly-readiness.py --repo test/repo --repo-dir . --json',
      'timeout 20 gh',
      'post repos/test/repo/issues/11599/comments',
      'sleep 3290',
      'timeout 45 git',
      'timeout 120 python3',
      'readiness -B scripts/release/three-hourly-readiness.py --repo test/repo --repo-dir . --json',
      'timeout 20 gh',
      'post repos/test/repo/issues/11599/comments',
      'sleep 2690',
    ]);
  });

  it('reserved with 45 minutes or less to go: only the first comment; with under ten minutes or none: no comment', () => {
    const half = warn({ clock: [cutoff - 1800, cutoff - 1795, cutoff] });
    expect(half.status, half.log).toBe(0);
    expect(half.bodies).toEqual([line(30, 'READY a1b2c3d4e5f6')]);
    expect(half.sleeps).toEqual([1795]);
    const exact = warn({ clock: [cutoff - 2700, cutoff - 2700, cutoff] });
    expect(exact.bodies).toEqual([line(45, 'READY a1b2c3d4e5f6')]);
    expect(exact.sleeps).toEqual([2700]);
    const justOver = warn({ clock: [cutoff - 2760, cutoff - 2750, cutoff - 2690, cutoff] });
    expect(justOver.bodies.length).toBe(2);
    expect(justOver.sleeps).toEqual([50, 2690]);
    const tenMinutes = warn({ clock: [cutoff - 600, cutoff - 590, cutoff] });
    expect(tenMinutes.bodies).toEqual([line(10, 'READY a1b2c3d4e5f6')]);
    expect(tenMinutes.sleeps).toEqual([590]);
    const short = warn({ clock: [cutoff - 599, cutoff] });
    expect(short.status, short.log).toBe(0);
    expect(short.events).toEqual(['sleep 599']);
    const afterCutoff = warn({ clock: [cutoff + 5, cutoff + 6] });
    expect(afterCutoff.status, afterCutoff.log).toBe(0);
    expect(afterCutoff.events).toEqual([]);
    expect(afterCutoff.output).toBe(bound);
  });

  it('a comment that runs long never moves the cutoff: the rest of the wait is measured after it', () => {
    // Every bound spent in full, twice (185 s each).
    const slow = warn({ clock: [cutoff - 6000, cutoff - 5815, cutoff - 2515, cutoff] });
    expect(slow.status, slow.log).toBe(0);
    expect(slow.sleeps).toEqual([5815 - 2700, 2515]);
    expect(slow.output).toBe(bound);
    // The first comment ate past T-45m: the second is not posted late.
    const veryLate = warn({ clock: [cutoff - 2800, cutoff - 2650, cutoff] });
    expect(veryLate.bodies.length).toBe(1);
    expect(veryLate.sleeps).toEqual([2650]);
  });

  it('never fails or changes the run: fetch, readiness check and comment may all fail', () => {
    const clock = [cutoff - 6000, cutoff - 5990, cutoff - 2690, cutoff];
    const calm = warn({ clock });
    for (const broken of [
      { fetchRc: 1 },
      { postRc: 1 },
      { reportRc: 3, report: '' },
      { reportRc: 124, report: '' }, // the bound expired
      { report: 'not json' },
      { fetchRc: 1, postRc: 1, reportRc: 1, report: '' },
    ] as Partial<Warn>[]) {
      const result = warn({ clock, ...broken });
      expect(result.status, JSON.stringify(broken) + result.log).toBe(0);
      expect(result.output).toBe(bound);
      expect(result.sleeps).toEqual(calm.sleeps);
      expect(result.posts.length).toBe(2);
      if (broken.report !== undefined)
        expect(result.bodies[0]).toBe(
          line(100, 'readiness unknown (the read-only readiness check gave no verdict)')
        );
      if (broken.postRc) expect(result.log).toContain('was not posted to issue #11599');
    }
  });

  it('never on a run that does not own the cycle, a replay, or a finite owner window', () => {
    for (const env of [
      { DAILY_PREPARATION: 'false' },
      { DAILY_PREPARATION: 'unknown' },
      { DAILY_PREPARATION: '' },
      { GITHUB_RUN_ATTEMPT: '2' },
      { LOG_ISSUE: '' },
      { LOG_ISSUE: 'abc' },
    ]) {
      const result = warn({ clock: [cutoff - 6000, cutoff], env });
      expect(result.status, JSON.stringify(env) + result.log).toBe(0);
      expect(result.events, JSON.stringify(env)).toEqual(['sleep 6000']);
    }
    const ownerWindow = warn({
      clock: [cutoff - 6000, cutoff],
      env: { OWNER_WINDOW_ID: 'validated-finite-owner', DAILY_PREPARATION: 'false' },
    });
    expect(ownerWindow.events).toEqual([]);
    expect(ownerWindow.output).toBe(`sha=${'a'.repeat(40)}\n`);
    // The step only runs for a run the admission allowed, and the admission
    // refuses every replay before it allows anything.
    expect(cutoffStep.if).toBe("steps.admission.outputs.allowed == 'true'");
    expect(cutoffStep.env.DAILY_PREPARATION).toBe(
      '${{ steps.admission.outputs.daily_preparation }}'
    );
  });

  it('says READY, IN_FLIGHT, AT RISK, NO CHANGE or unknown in one line', () => {
    const sha = (c: string) => c.repeat(40);
    const table: [unknown, string][] = [
      [ready, 'READY a1b2c3d4e5f6'],
      [
        report('IN_FLIGHT', {
          summary:
            'no selectable candidate yet; bbbbbbbbbbbb is in flight (awaiting backup=in_progress (run 7), prequal=absent)',
          candidates: [
            { sha: sha('c'), status: 'PENDING', reason: 'awaiting backup=absent, prequal=absent' },
            {
              sha: sha('b'),
              status: 'PENDING',
              reason: 'awaiting backup=in_progress (run 7), prequal=absent',
            },
          ],
        }),
        'IN_FLIGHT bbbbbbbbbbbb (awaiting backup=in_progress (run 7), prequal=absent)',
      ],
      [
        report('IN_FLIGHT', {
          summary: 'engine maintenance phase is draining (cutover or break active)',
        }),
        'IN_FLIGHT (engine maintenance phase is draining (cutover or break active))',
      ],
      [
        report('NO_CANDIDATE', {
          summary: '0 selectable of 2 candidate(s); newest cccccccccccc: awaiting backup=absent',
          candidates: [
            { sha: sha('c'), status: 'PENDING', reason: 'awaiting backup=absent, prequal=absent' },
            {
              sha: sha('d'),
              status: 'DISQUALIFIED',
              reason: 'backup-engine/certified failure (run 8)\nsecond|line',
            },
          ],
        }),
        'AT RISK: no certified candidate; newest refusal: dddddddddddd backup-engine/certified failure (run 8) second line',
      ],
      [
        report('NO_CANDIDATE', {
          candidates: [
            { sha: sha('c'), status: 'PENDING', reason: 'awaiting backup=absent, prequal=absent' },
          ],
        }),
        'AT RISK: no certified candidate; newest refusal: cccccccccccc awaiting backup=absent, prequal=absent',
      ],
      [
        report('NO_CANDIDATE', { summary: 'no selectable candidates found' }),
        'AT RISK: no certified candidate; newest refusal: no selectable candidates found',
      ],
      [
        report('NO_CANDIDATE', { git: { totalCommitsSinceServing: 0, servingSha: sha('e') } }),
        'NO CHANGE: protected main is the serving engine eeeeeeeeeeee',
      ],
      [
        report('UNKNOWN', { summary: 'health read failed', schedule: null, git: null }),
        'readiness unknown (health read failed)',
      ],
      [report('UNKNOWN'), 'readiness unknown'],
      [report('SOMETHING_NEW', { summary: 'x' }), 'readiness unknown (x)'],
      [
        report('READY', {
          selectableSha: sha('a'),
          schedule: { preparationCutoffEpoch: cutoff + 10800 },
        }),
        'readiness unknown (the check read another cycle than this one)',
      ],
      [{}, 'readiness unknown'],
    ];
    for (const [document, verdict] of table) {
      const result = warn({ clock: [cutoff - 1800, cutoff - 1795, cutoff], report: document });
      expect(result.status, result.log).toBe(0);
      expect(result.bodies, JSON.stringify(document)).toEqual([line(30, verdict)]);
      // ASCII, short, and nothing the receiver's previous-seal parser reads.
      expect(result.bodies[0]).toMatch(/^[\x20-\x7e\n]+$/);
      expect(result.bodies[0]).not.toContain('Sealed SHA');
      expect(result.bodies[0].split('\n').length).toBe(2);
    }
  });

  it('is bounded, writes one thing, and adds no job, trigger or timer', () => {
    const run: string = cutoffStep.run;
    const start = run.indexOf('readiness_note() {');
    const end = run.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const note = run.slice(start, end);
    // Every command that leaves the runner is under a hard bound: 185 s in
    // all, against a first comment that needs ten minutes of wait and a second
    // that has forty-five.
    const bounds = [...note.matchAll(/timeout (\d+) (git fetch|python3 -B|gh api)/g)];
    expect(bounds.map((m) => m[2])).toEqual(['git fetch', 'python3 -B', 'gh api']);
    expect(bounds.reduce((sum, m) => sum + Number(m[1]), 0)).toBe(185);
    expect(note.match(/git fetch|python3 -B|gh api/g)?.length).toBe(3);
    expect(note).not.toMatch(/\bsleep\b|while |until /);
    expect(run).toContain('if [ "$remaining" -ge 600 ]; then');
    expect(run).toContain('if [ "$remaining" -gt 2700 ]; then');
    // The existing wait, cut in two: exactly two sleeps in the step, the
    // second one the original line.
    expect(run.match(/\bsleep "/g)?.length).toBe(2);
    expect(run).toContain('sleep "$((remaining - 2700))"');
    expect(run).toContain('[ "$remaining" -le 0 ] || sleep "$remaining"');
    expect(run.indexOf('readiness_note 45')).toBeLessThan(
      run.indexOf('[ "$remaining" -le 0 ] || sleep "$remaining"')
    );
    // The one write of the whole detect job is that comment, with the token
    // and the issue of the keep-serving log.
    const detectText = stage.jobs.detect.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(detectText.match(/--method|-X [A-Z]+|dispatches/g)).toEqual(['--method']);
    expect(detectText).toContain(
      'gh api --method POST "repos/$REPO/issues/$LOG_ISSUE/comments" -f body="$body"'
    );
    const keepServing = stage.jobs['cutover-log-keep-serving'].steps.find(
      (s: { id?: string }) => s.id === 'comment'
    );
    expect(cutoffStep.env.LOG_ISSUE).toBe('11599');
    expect(cutoffStep.env.LOG_ISSUE).toBe(keepServing.env.LOG_ISSUE);
    expect(cutoffStep.env.GH_TOKEN).toBe(keepServing.env.GH_TOKEN);
    expect(cutoffStep.env.RUN_URL).toBe(keepServing.env.RUN_URL);
    expect(stage.jobs.detect.environment).toBeUndefined();
    expect(stageText).not.toMatch(/secrets\.[A-Z_]+[^\n]*\n[^\n]*readiness_note/);
    // The readiness check is on disk in detect's sparse checkout, and is the
    // read-only CLI (pinned by the-three-hourly-readiness-cli-only-reads).
    expect(stage.jobs.detect.steps[0].with['sparse-checkout']).toContain(
      '/scripts/release/three-hourly-readiness.py\n'
    );
    // No new job, trigger or timer.
    expect(Object.keys(stage.on)).toEqual([
      'repository_dispatch',
      'workflow_run',
      'workflow_dispatch',
      'push',
      'schedule',
    ]);
    expect(stage.on.schedule.length).toBe(2);
    expect(Object.keys(stage.jobs).length).toBe(5);
    expect(stage.jobs.detect['timeout-minutes']).toBe(315);
  });
});

describe('the post-seal Backup completion is an election trigger too (O25 addition, 2026-11-24)', () => {
  // The post-seal Backup (repository_dispatch, display title "Backup after
  // seal <run>-<attempt>") completes inside the next cycle's election window.
  // Stage used to admit only the completion of a push Backup. Both are now the
  // same election trigger with the same title, so every reader of the
  // election (this workflow, read-engine-prequalification.py and
  // engine-release-window-doors.py) still agrees on who can own a cycle.
  const evaluate = (expression: string, context: Record<string, unknown>) => {
    const body = expression
      .replace(/^\$\{\{\s*/, '')
      .replace(/\s*\}\}$/, '')
      .replace(/\b(?:github|inputs)(?:\.[A-Za-z_]+)+/g, (path) => `get(${JSON.stringify(path)})`);
    const get = (path: string) =>
      path
        .split('.')
        .reduce<unknown>(
          (value, key) =>
            value !== null && typeof value === 'object'
              ? ((value as Record<string, unknown>)[key] ?? null)
              : null,
          context
        );
    const startsWith = (value: unknown, prefix: string) =>
      String(value ?? '')
        .toLowerCase()
        .startsWith(prefix.toLowerCase());
    return new Function('get', 'startsWith', `return (${body});`)(get, startsWith);
  };
  const completion = (run: Record<string, unknown>) => ({
    github: {
      event_name: 'workflow_run',
      repository: 'test/repo',
      ref: 'refs/heads/main',
      event: {
        workflow_run: {
          event: 'push',
          path: '.github/workflows/backup-engine.yml',
          head_repository: { full_name: 'test/repo' },
          head_branch: 'main',
          run_attempt: 1,
          conclusion: 'success',
          display_title: 'fix: something (#1)',
          ...run,
        },
      },
    },
    inputs: {},
  });
  const reservation = 'Automatic Backup daily reservation';
  const outside = 'Backup completion outside election';
  const seal = { event: 'repository_dispatch', display_title: 'Backup after seal 45408673446-1' };

  it('admits a successful first-attempt post-seal Backup on main exactly like a push Backup', () => {
    for (const run of [{}, seal]) {
      expect(evaluate(stage['run-name'], completion(run)), JSON.stringify(run)).toBe(reservation);
      expect(evaluate(stage.jobs.detect.if, completion(run)), JSON.stringify(run)).toBe(true);
    }
  });

  it('admits no other Backup completion: not a non-seal dispatch, a replay, a failure, another branch or repository', () => {
    const refused: Record<string, unknown>[] = [
      { event: 'repository_dispatch', display_title: 'Backup Engine (Clone, Stage, Certify)' },
      { event: 'repository_dispatch', display_title: '' },
      { event: 'repository_dispatch', display_title: null },
      { event: 'repository_dispatch', display_title: 'Backup after seal' },
      { event: 'repository_dispatch', display_title: 'A Backup after seal 1-1' },
      { event: 'workflow_dispatch', display_title: 'Backup after seal 1-1' },
      { event: 'schedule', display_title: 'Backup after seal 1-1' },
      { ...seal, run_attempt: 2 },
      { ...seal, conclusion: 'failure' },
      { ...seal, conclusion: 'cancelled' },
      { ...seal, head_branch: 'other' },
      { ...seal, head_repository: { full_name: 'fork/repo' } },
      { ...seal, path: '.github/workflows/other.yml' },
      { run_attempt: 2 },
      { conclusion: 'failure' },
    ];
    for (const run of refused) {
      expect(evaluate(stage['run-name'], completion(run)), JSON.stringify(run)).toBe(outside);
      expect(evaluate(stage.jobs.detect.if, completion(run)), JSON.stringify(run)).toBe(false);
    }
    // The other events are untouched by the addition.
    const other = (event_name: string, event: Record<string, unknown> = {}) => ({
      github: { event_name, repository: 'test/repo', ref: 'refs/heads/main', event },
      inputs: {},
    });
    expect(evaluate(stage['run-name'], other('push'))).toBe('Daily engine reservation');
    expect(evaluate(stage['run-name'], other('schedule'))).toBe('Daily engine reservation');
    expect(evaluate(stage.jobs.detect.if, other('push'))).toBe(true);
    expect(
      evaluate(
        stage['run-name'],
        other('repository_dispatch', { action: 'prepare-daily-engine', sender: { type: 'User' } })
      )
    ).toBe('Original operator daily preparation');
  });

  it('inside the window it reserves, outside it does nothing, and the election counts it as it claims', () => {
    const real = JSON.parse(
      readFileSync(join(root, 'server/src/maintenance/maintenanceSchedulePolicy.json'), 'utf8')
    );
    const policy = { ...real, frequency: 'three-hourly' };
    const health = JSON.stringify({
      liveness: 'ok',
      maintenance: {
        schedule: { frequency: 'three-hourly', startHours: [1, 4, 7, 10, 13, 16, 19, 22] },
      },
    });
    // The seal of the 22:00 cycle; its Backup completes at 22:55 CST (04:55Z),
    // five minutes into the 01:00 cycle's election window (04:50Z-06:50Z).
    const backup = {
      id: 3000,
      event: 'workflow_run',
      created_at: '2026-11-23T04:55:00Z',
      display_title: reservation,
      run_attempt: 1,
      status: 'in_progress',
      conclusion: null,
      updated_at: '2026-11-23T04:55:05Z',
    };
    const owns = admit({
      event: 'workflow_run',
      policy,
      health,
      runId: 3000,
      createdAt: backup.created_at,
      runs: [backup],
    });
    expect(owns.outputs.daily_preparation, owns.stdout).toBe('true');
    expect(owns.outputs.daily_preparation_date).toBe('2026-11-23T01');
    expect(owns.outputs.cutoff_epoch).toBe(epoch('2026-11-23T06:30:00Z'));
    // A later push defers to it by name: the election counts what claims.
    const push = {
      id: 3001,
      event: 'push',
      created_at: '2026-11-23T05:10:00Z',
      display_title: 'Daily engine reservation',
    };
    const later = admit({
      event: 'push',
      policy,
      health,
      runId: 3001,
      createdAt: push.created_at,
      runs: [backup, push],
    });
    expect(later.outputs.daily_preparation).toBe('false');
    expect(later.stdout).toContain('belongs to earlier run 3000');
    // A refused completion carries the other title and never competes.
    const notCounted = admit({
      event: 'push',
      policy,
      health,
      runId: 3001,
      createdAt: push.created_at,
      runs: [{ ...backup, display_title: outside }, push],
    });
    expect(notCounted.outputs.daily_preparation).toBe('true');
    // Completed before the window opens (04:49Z) or after it ends: nothing.
    for (const createdAt of ['2026-11-23T04:49:59Z', '2026-11-23T06:50:00Z']) {
      const ignored = admit({ event: 'workflow_run', policy, health, runId: 3000, createdAt });
      expect(ignored.outputs.daily_preparation, createdAt).toBe('false');
      expect(ignored.outputs.allowed, createdAt).toBe('false');
      expect(ignored.listed, createdAt).toEqual([]);
    }
    // And when it cannot claim, it stands down like any other run (O25).
    const stoodDown = admit({
      event: 'push',
      policy,
      health,
      runId: 3001,
      createdAt: push.created_at,
      runs: [
        {
          ...backup,
          status: 'completed',
          conclusion: 'success',
          updated_at: '2026-11-23T04:55:25Z',
        },
        push,
      ],
    });
    expect(stoodDown.outputs.daily_preparation, stoodDown.stdout).toBe('true');
  });

  it('adds no title: every reader of the election still names the same runs', () => {
    const titles = [
      ...stage['run-name'].matchAll(/'([A-Z][A-Za-z -]+ (?:reservation|election|preparation))'/g),
    ]
      .map((m) => m[1])
      .sort();
    expect(titles).toEqual([
      'Automatic Backup daily reservation',
      'Backup completion outside election',
      'Daily engine reservation',
      'Operator request outside election',
      'Original operator daily preparation',
    ]);
    expect(admission).toContain(
      'automatic_backup = run.get("event") == "workflow_run" and (title == "Automatic Backup daily reservation"'
    );
    expect(
      readFileSync(join(root, 'scripts/ci/read-engine-prequalification.py'), 'utf8')
    ).toContain('("Daily engine reservation", "Automatic Backup daily reservation")');
    expect(
      readFileSync(join(root, 'server/scripts/engine-release-window-doors.py'), 'utf8')
    ).toContain("title == 'Automatic Backup daily reservation'");
    // The trigger itself is unchanged: the same workflow_run subscription.
    expect(stage.on.workflow_run).toEqual({
      workflows: ['Backup Engine (Clone, Stage, Certify)'],
      branches: ['main'],
      types: ['completed'],
    });
    expect(
      readFileSync(join(root, '.github/workflows/backup-engine.yml'), 'utf8').split('\n')[1]
    ).toContain("format('Backup after seal {0}', github.event.client_payload.release_run_key)");
  });
});
