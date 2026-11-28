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
 *  5. (2026-11-27) It outlasts a spent shared REST quota: when the quota resets
 *     before the cycle's deadline it waits once, then reads once and sends at
 *     most once; a reset after the deadline sends nothing and says so; every
 *     gh failure is logged with gh's own reason, never "Command failed".
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CYCLE_HOURS,
  EVENT_TYPE,
  EXIT_RATE_LIMITED_PAST_DEADLINE,
  RESET_SETTLE_MS,
  SEND_MARGIN_MS,
  PREPARATION_LEAD_MINUTES,
  PREPARATION_WINDOW_MINUTES,
  REPO,
  RESERVATION_LOOKBACK_MINUTES,
  canOwn,
  chicagoHHMM,
  decide,
  failureReason,
  main,
  preparationWindow,
  readStageRuns,
  sendDeadline,
  takeCycleLock,
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

describe('the fallback outlasts a spent quota (2026-11-27)', () => {
  // The 13:00 Chicago cycle of 2026-11-27: cutoff 18:30Z, window to 18:50Z, deadline 18:49Z.
  const FIRE = at('2026-11-27T18:33:00Z'); // 12:33 CST, the first refused firing
  const quota = (remaining: number, resetIso: string) =>
    JSON.stringify({
      resources: { core: { limit: 5000, remaining, reset: at(resetIso) / 1000, used: 0 } },
    });
  const gh403 = (msg: string) =>
    Object.assign(new Error('Command failed: gh api --method POST ...'), {
      stderr: `{"message":"x"}\ngh: ${msg} (HTTP 403)\n`,
    });
  const harness = (handlers: { rate?: () => string; list?: () => string; post?: () => string }) => {
    const calls: string[][] = [];
    const logs: string[] = [];
    const sleeps: number[] = [];
    const lockDir = mkdtempSync(join(tmpdir(), 'quota-'));
    let now = FIRE;
    const gh = (args: string[]) => {
      calls.push(args);
      if (args[1] === 'rate_limit')
        return (handlers.rate ?? (() => quota(5000, '2026-11-27T19:00:00Z')))();
      if (args.includes('POST')) return (handlers.post ?? (() => ''))();
      return (handlers.list ?? (() => JSON.stringify({ total_count: 0, workflow_runs: [] })))();
    };
    const go = () =>
      main({
        nowMs: FIRE,
        run: gh,
        log: (l: string) => logs.push(l),
        sleep: (ms: number) => {
          sleeps.push(ms);
          now += ms;
        },
        clock: () => now,
        lockDir,
      });
    const count = (pred: (c: string[]) => boolean) => calls.filter(pred).length;
    return { go, calls, logs, sleeps, lockDir, count };
  };
  const isList = (c: string[]) => c.some((a) => a.includes('stage-engine-release.yml/runs'));
  const isPost = (c: string[]) => c.includes('POST');

  it('the deadline is the preparation window end, less the send margin', () => {
    const window = preparationWindow(FIRE)!;
    expect(window.end).toBe(at('2026-11-27T18:50:00Z'));
    expect(sendDeadline(window)).toBe(window.end - SEND_MARGIN_MS);
    expect(chicagoHHMM(at('2026-11-27T18:42:00Z'))).toBe('12:42 CST');
  });

  it('rate limited with a reset before the deadline: waits once, then one read and one send', () => {
    // Another lane measured the shared quota at 0/5000 until 12:42 CST.
    const h = harness({ rate: () => quota(0, '2026-11-27T18:42:00Z') });
    expect(h.go()).toBe(0);
    expect(h.sleeps).toEqual([at('2026-11-27T18:42:00Z') + RESET_SETTLE_MS - FIRE]);
    expect(h.count(isList)).toBe(1);
    expect(h.count(isPost)).toBe(1);
    // The read and the send both come after the wait, never before it.
    const firstRead = h.calls.findIndex(isList);
    expect(h.calls.slice(0, firstRead).every((c) => c[1] === 'rate_limit')).toBe(true);
    expect(h.logs.join('\n')).toContain('RATE LIMITED until 12:42 CST; waiting once');
    expect(h.logs.join('\n')).toContain('SENT');
    // The cycle's lock is released afterwards: a new instance can take it.
    const release = takeCycleLock(preparationWindow(FIRE)!, h.lockDir);
    expect(release).not.toBeNull();
    release!();
  });

  it('a second firing while one instance waits sends nothing', () => {
    const h = harness({ rate: () => quota(0, '2026-11-27T18:42:00Z') });
    const window = preparationWindow(FIRE)!;
    // A live holder: this very process.
    writeFileSync(
      join(h.lockDir, `ca-cutover-operator-preparation-${window.start}.lock`),
      String(process.pid)
    );
    expect(h.go()).toBe(0);
    expect(h.sleeps).toEqual([]);
    expect(h.count(isList) + h.count(isPost)).toBe(0);
    expect(h.logs.join('\n')).toMatch(/FOLLOW: another instance is waiting/);
    // A stale lock (dead pid) is taken over.
    writeFileSync(
      join(h.lockDir, `ca-cutover-operator-preparation-${window.start}.lock`),
      '999999999'
    );
    const release = takeCycleLock(window, h.lockDir);
    expect(release).not.toBeNull();
    release!();
  });

  it('rate limited with a reset after the deadline: sends nothing and names both times', () => {
    const h = harness({ rate: () => quota(1, '2026-11-27T18:55:00Z') });
    expect(h.go()).toBe(EXIT_RATE_LIMITED_PAST_DEADLINE);
    expect(EXIT_RATE_LIMITED_PAST_DEADLINE).not.toBe(0);
    expect(EXIT_RATE_LIMITED_PAST_DEADLINE).not.toBe(2);
    expect(h.sleeps).toEqual([]);
    expect(h.count(isList) + h.count(isPost)).toBe(0);
    expect(h.logs.join('\n')).toContain(
      'RATE LIMITED until 12:55 CST after the deadline 12:49 CST'
    );
  });

  it('an unreadable rate_limit behaves as before: read, then send', () => {
    for (const rate of [
      () => {
        throw gh403('API rate limit exceeded for user ID 1');
      },
      () => 'not json',
      () => JSON.stringify({ resources: {} }),
    ]) {
      const h = harness({ rate });
      expect(h.go()).toBe(0);
      expect(h.sleeps).toEqual([]);
      expect(h.count(isList)).toBe(1);
      expect(h.count(isPost)).toBe(1);
    }
    // Enough quota left: no wait either.
    const h = harness({ rate: () => quota(2, '2026-11-27T18:42:00Z') });
    expect(h.go()).toBe(0);
    expect(h.sleeps).toEqual([]);
  });

  it('a failed read and a failed send log gh stderr reason, never just "Command failed"', () => {
    const h = harness({
      rate: () => 'unreadable',
      list: () => {
        throw gh403('API rate limit exceeded for user ID 1');
      },
      post: () => {
        throw gh403('API rate limit exceeded for user ID 1');
      },
    });
    expect(h.go()).toBe(2);
    const text = h.logs.join('\n');
    expect(text).toContain(
      'READ FAILED: RATE LIMITED: gh: API rate limit exceeded for user ID 1 (HTTP 403)'
    );
    expect(text).toMatch(
      /SEND FAILED: RATE LIMITED until an unreadable reset: gh: API rate limit exceeded/
    );
    expect(text).not.toMatch(/SEND FAILED: Command failed/);
    // With the quota readable after the failure, the reset is named in Chicago time.
    let rateCalls = 0;
    const h2 = harness({
      rate: () => (rateCalls++ === 0 ? 'unreadable' : quota(0, '2026-11-27T18:42:00Z')),
      post: () => {
        throw gh403('API rate limit exceeded for user ID 1');
      },
    });
    expect(h2.go()).toBe(2);
    expect(h2.logs.join('\n')).toContain(
      'SEND FAILED: RATE LIMITED until 12:42 CST: gh: API rate limit'
    );
    // Another cause is named as gh said it.
    const h3 = harness({
      post: () => {
        throw Object.assign(new Error('Command failed: gh api'), {
          stderr: 'gh: Resource not accessible by personal access token (HTTP 403)\n',
        });
      },
    });
    expect(h3.go()).toBe(2);
    expect(h3.logs.join('\n')).toContain(
      'SEND FAILED: gh: Resource not accessible by personal access token (HTTP 403)'
    );
  });

  it('never logs a token gh might echo', () => {
    const reason = failureReason(
      Object.assign(new Error('x'), {
        stderr: 'bad credentials for ghp_abcDEF123 and github_pat_11AA_bb22\n',
      })
    );
    expect(reason).not.toMatch(/ghp_|github_pat_/);
    expect(reason).toContain('[redacted]');
    expect(failureReason(new Error('first line\nsecond line'))).toBe('second line');
  });

  it('the cron timeout covers the longest possible wait', () => {
    const job = JSON.parse(read('ops/openclaw/ca-cutover-operator-preparation.json'));
    const [minutes] = String(job.schedule.expr).split(' ');
    const earliest = Math.min(...minutes.split(',').map(Number)) % 60; // minutes past the hour
    // Each cutoff falls at :30, so the earliest firing is (earliest - 30) min after it.
    const waitMs = PREPARATION_WINDOW_MINUTES * MIN - SEND_MARGIN_MS - (earliest - 30) * MIN;
    expect(job.payload.timeoutSeconds * 1000).toBeGreaterThanOrEqual(waitMs + 120_000);
    expect(job.comment).toContain(`--timeout-seconds ${job.payload.timeoutSeconds}`);
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
