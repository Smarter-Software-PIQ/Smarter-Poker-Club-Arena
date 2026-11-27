/**
 * EVERY CYCLE GETS AN OWNER (2026-11-26, release custody)
 *
 * A cycle is prepared only when a Stage run created inside its election
 * window claims it. GitHub delivers few of Stage's scheduled runs and creates
 * no workflow_run for a job-token Backup, so a window with no merge to main
 * had no owner: the 10:00 Chicago cycles of 2026-11-25 and 2026-11-26 never
 * ran. The runbook's operator fallback (one `prepare-daily-engine` dispatch by
 * an authenticated user, admitted to the same election) existed, and nobody
 * was awake to send it.
 *
 * Laws:
 *  1. scripts/ops/cutover-operator-preparation.mjs sends that dispatch when,
 *     inside a cycle's preparation window, no Stage run can own the cycle; it
 *     follows an owner that exists and does nothing outside a window.
 *  2. Its eligibility is the election's own, and its windows are Stage's.
 *  3. A real cron runs it inside every cycle's preparation window, every day.
 *  4. Stage still admits the operator dispatch it sends.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CYCLE_HOURS,
  EVENT_TYPE,
  PREPARATION_LEAD_MINUTES,
  PREPARATION_WINDOW_MINUTES,
  REPO,
  RESERVATION_LOOKBACK_MINUTES,
  canOwn,
  decide,
  main,
  preparationWindow,
  readStageRuns,
} from '../scripts/ops/cutover-operator-preparation.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (iso: string) => Date.parse(iso);
const MIN = 60_000;

// The 10:00 Chicago cycle of 2026-11-26: start 16:00Z, cutoff 15:30Z, window to 15:50Z.
const CUTOFF = at('2026-11-26T15:30:00Z');
const run = (over: Record<string, unknown>) => ({
  id: 100,
  event: 'push',
  head_branch: 'main',
  display_title: 'Daily engine reservation',
  status: 'in_progress',
  conclusion: null,
  created_at: '2026-11-26T14:40:00Z',
  updated_at: '2026-11-26T14:40:30Z',
  actor: { type: 'User' },
  ...over,
});

describe('every cycle gets an owner', () => {
  it('sends the operator dispatch for the cycle that had no owner on 2026-11-26', () => {
    // 09:33 Chicago, three minutes after the 10:00 cycle's preparation opened; no Stage run at all.
    const verdict = decide(at('2026-11-26T15:33:00Z'), []);
    expect(verdict.action).toBe('send');
    expect(verdict.reason).toMatch(/^NO OWNER/);
    // Runs that ended before the cutoff claimed nothing (O25): still no owner.
    const stoodDown = run({
      status: 'completed',
      conclusion: 'success',
      updated_at: '2026-11-26T14:41:00Z',
    });
    expect(decide(at('2026-11-26T15:33:00Z'), [stoodDown]).action).toBe('send');
  });

  it('follows an owner that exists, whatever eligible event created it', () => {
    const now = at('2026-11-26T15:33:00Z');
    for (const owner of [
      run({ id: 7 }),
      run({ id: 8, event: 'schedule' }),
      run({ id: 9, event: 'workflow_run', display_title: 'Automatic Backup daily reservation' }),
      run({
        id: 10,
        event: 'repository_dispatch',
        display_title: 'Original operator daily preparation',
        created_at: '2026-11-26T15:31:00Z',
      }),
      run({
        id: 11,
        status: 'completed',
        conclusion: 'success',
        updated_at: '2026-11-26T15:31:30Z',
      }),
    ]) {
      const verdict = decide(now, [owner]);
      expect(verdict.action, String(owner.id)).toBe('follow');
      expect(verdict.runId).toBe(owner.id);
    }
    // The second cron firing sees the run the first one caused, and sends nothing.
    const first = run({
      id: 20,
      event: 'repository_dispatch',
      display_title: 'Original operator daily preparation',
      created_at: '2026-11-26T15:33:05Z',
    });
    expect(decide(at('2026-11-26T15:41:00Z'), [first]).action).toBe('follow');
  });

  it('counts only runs the election counts', () => {
    const window = preparationWindow(at('2026-11-26T15:33:00Z'))!;
    expect(canOwn(run({}), window)).toBe(true);
    expect(canOwn(run({ head_branch: 'feature' }), window)).toBe(false);
    // Created before the 100-minute reservation, or after the window.
    expect(canOwn(run({ created_at: '2026-11-26T13:49:59Z' }), window)).toBe(false);
    expect(canOwn(run({ created_at: '2026-11-26T15:50:00Z' }), window)).toBe(false);
    // A job-token dispatch, an operator request outside the election, a failed or cancelled early run.
    expect(canOwn(run({ event: 'workflow_dispatch' }), window)).toBe(false);
    expect(
      canOwn(
        run({
          event: 'repository_dispatch',
          display_title: 'Operator request outside election',
          created_at: '2026-11-26T15:31:00Z',
        }),
        window
      )
    ).toBe(false);
    expect(
      canOwn(
        run({
          event: 'repository_dispatch',
          display_title: 'Original operator daily preparation',
          created_at: '2026-11-26T15:31:00Z',
          actor: { type: 'Bot' },
        }),
        window
      )
    ).toBe(false);
    expect(
      canOwn(
        run({ event: 'workflow_run', display_title: 'Automatic protected Backup finished' }),
        window
      )
    ).toBe(false);
    expect(
      canOwn(
        run({ status: 'completed', conclusion: 'failure', updated_at: '2026-11-26T15:31:30Z' }),
        window
      )
    ).toBe(false);
  });

  it('does nothing outside a preparation window, and never reaches a later cycle early', () => {
    expect(decide(at('2026-11-26T15:29:59Z'), []).action).toBe('none');
    expect(decide(at('2026-11-26T15:50:00Z'), []).action).toBe('none');
    expect(decide(at('2026-11-26T17:00:00Z'), []).action).toBe('none');
    let minutes = 0;
    for (let t = at('2026-11-26T06:00:00Z'); t < at('2026-11-27T06:00:00Z'); t += MIN) {
      if (preparationWindow(t)) minutes += 1;
    }
    expect(minutes).toBe(8 * PREPARATION_WINDOW_MINUTES);
  });

  it('counts each daylight-saving day as Stage does: a repeated hour is one cycle, a missing hour is none', () => {
    // Fall back, 2026-11-01: 01:00 Chicago happens twice (06:00Z CDT and 07:00Z CST). One cycle, the first.
    expect(preparationWindow(at('2026-11-01T05:35:00Z'))?.start).toBe(at('2026-11-01T06:00:00Z'));
    expect(preparationWindow(at('2026-11-01T06:35:00Z'))).toBeNull();
    // Spring forward, 2027-03-14: 01:00 CST is 07:00Z and 04:00 CDT is 09:00Z, two real hours apart.
    expect(preparationWindow(at('2027-03-14T06:35:00Z'))?.start).toBe(at('2027-03-14T07:00:00Z'));
    expect(preparationWindow(at('2027-03-14T08:35:00Z'))?.start).toBe(at('2027-03-14T09:00:00Z'));
  });

  it('an unreadable run list is UNKNOWN, never "no owner", and still sends', () => {
    const verdict = decide(at('2026-11-26T15:33:00Z'), null);
    expect(verdict.action).toBe('send');
    expect(verdict.reason).toMatch(/^UNKNOWN/);
    expect(verdict.reason).not.toMatch(/NO OWNER/);
    const window = preparationWindow(at('2026-11-26T15:33:00Z'))!;
    expect(readStageRuns(window, () => 'not json')).toBeNull();
    expect(readStageRuns(window, () => JSON.stringify({ message: 'rate limited' }))).toBeNull();
    // A truncated page is unreadable, not empty.
    expect(
      readStageRuns(window, () => JSON.stringify({ total_count: 150, workflow_runs: [] }))
    ).toBeNull();
    expect(
      readStageRuns(window, () => JSON.stringify({ total_count: 0, workflow_runs: [] }))
    ).toEqual([]);
  });

  it('sends exactly one dispatch with no input of its own, and reports a failed send', () => {
    const calls: string[][] = [];
    const logs: string[] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return args.includes('POST') ? '' : JSON.stringify({ total_count: 0, workflow_runs: [] });
    };
    expect(
      main({ nowMs: at('2026-11-26T15:33:00Z'), run: gh, log: (l: string) => logs.push(l) })
    ).toBe(0);
    const posts = calls.filter((c) => c.includes('POST'));
    expect(posts).toEqual([
      ['api', '--method', 'POST', `repos/${REPO}/dispatches`, '-f', `event_type=${EVENT_TYPE}`],
    ]);
    expect(logs.join('\n')).toContain('SENT');
    // Followed: no POST.
    calls.length = 0;
    const owned = (args: string[]) => {
      calls.push(args);
      return JSON.stringify({ total_count: 1, workflow_runs: [run({ id: 5 })] });
    };
    expect(main({ nowMs: at('2026-11-26T15:33:00Z'), run: owned, log: () => {} })).toBe(0);
    expect(calls.some((c) => c.includes('POST'))).toBe(false);
    // Outside a window: gh is never called.
    calls.length = 0;
    expect(main({ nowMs: at('2026-11-26T17:00:00Z'), run: owned, log: () => {} })).toBe(0);
    expect(calls).toEqual([]);
    const failing = (args: string[]) => {
      if (args.includes('POST')) throw new Error('HTTP 403');
      return JSON.stringify({ total_count: 0, workflow_runs: [] });
    };
    expect(main({ nowMs: at('2026-11-26T15:33:00Z'), run: failing, log: () => {} })).toBe(2);
  });
});

describe('the script, Stage and the schedule agree', () => {
  const stage = read('.github/workflows/stage-engine-release.yml');

  it('uses the cycle hours of the schedule policy and the windows Stage elects in', () => {
    const policy = JSON.parse(read('server/src/maintenance/maintenanceSchedulePolicy.json'));
    expect([...CYCLE_HOURS]).toEqual(policy.startHours);
    expect(stage).toContain(`WINDOW_MINUTES = ${PREPARATION_WINDOW_MINUTES}`);
    expect(stage).toContain(`timedelta(minutes=${RESERVATION_LOOKBACK_MINUTES})`);
    expect(stage).toContain('cycle - 1800');
    expect(PREPARATION_LEAD_MINUTES).toBe(30);
  });

  it('Stage still admits the dispatch: the event type, a user sender, the election title', () => {
    expect(stage).toContain(`types: [${EVENT_TYPE}]`);
    expect(stage).toContain(
      `github.event.action == '${EVENT_TYPE}' && github.event.sender.type == 'User' && 'Original operator daily preparation'`
    );
    expect(stage).toContain('title == "Original operator daily preparation"');
    for (const title of ['Daily engine reservation', 'Automatic Backup daily reservation']) {
      expect(stage).toContain(title);
      expect(read('scripts/ops/cutover-operator-preparation.mjs')).toContain(title);
    }
    expect(read('docs/ENGINE-RELEASE-RUNBOOK.md')).toContain(`-f event_type=${EVENT_TYPE}`);
  });

  it('a real cron runs it inside every preparation window of the day, twice', () => {
    const job = JSON.parse(read('ops/openclaw/ca-cutover-operator-preparation.json'));
    expect(job.schedule.kind).toBe('cron');
    expect(job.schedule.tz).toBe('America/Chicago');
    expect(job.delivery.mode).toBe('none');
    expect(job.payload.argv.join(' ')).toContain('cutover-operator-preparation.mjs');
    const [minutes, hours] = String(job.schedule.expr).split(' ');
    const fires: number[] = [];
    const day = at('2026-11-26T06:00:00Z'); // 00:00 Chicago (UTC-6 on this date)
    for (const h of hours.split(',').map(Number)) {
      for (const m of minutes.split(',').map(Number)) fires.push(day + (h * 60 + m) * MIN);
    }
    expect(fires).toHaveLength(16);
    const cycles = new Map<number, number>();
    for (const fire of fires) {
      const window = preparationWindow(fire);
      expect(window, new Date(fire).toISOString()).not.toBeNull();
      // Late enough that a push or Backup owner is visible, early enough to be elected.
      expect(fire - window!.cutoff).toBeGreaterThanOrEqual(3 * MIN);
      expect(window!.end - fire).toBeGreaterThanOrEqual(5 * MIN);
      cycles.set(window!.start, (cycles.get(window!.start) ?? 0) + 1);
    }
    expect(cycles.size).toBe(8);
    expect([...cycles.values()].every((n) => n === 2)).toBe(true);
  });

  it('is self-contained, so the installed copy needs no checkout', () => {
    const source = read('scripts/ops/cutover-operator-preparation.mjs');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((name) => name.startsWith('node:'))).toBe(true);
    expect(source).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|secrets\./);
  });
});
