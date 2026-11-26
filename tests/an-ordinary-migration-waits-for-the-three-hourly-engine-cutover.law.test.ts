/**
 * LAW: AN ORDINARY MIGRATION WAITS FOR THE THREE-HOURLY ENGINE CUTOVER
 * (2026-11-21, Optimization O3).
 *
 * When the serving engine runs the three-hourly cutover cadence (01, 04, 07,
 * 10, 13, 16, 19, 22 America/Chicago), installing an ordinary migration between
 * a Backup DB refresh and the :30 preparation cutoff breaks
 * `Backup copy migrations == production installed migrations`. To eliminate
 * manual cross-chat migration holds without adding any cron, watcher or retry
 * loop, the merge dispatcher automatically defers ordinary merges inside
 * [cycleStart - 150m, cycleStart + 10m) for any non-04:00 three-hourly cycle
 * (150 minutes since 2026-11-25, O21 part 2; 90 before)
 * until cycleStart + 10m Chicago (strictly :10 UTC, outside the :50-:03 DDL
 * refusal window) inside its own single bounded wait.
 *
 * What this pins:
 *   1. scripts/ci/merged-migration-dispatch.mjs remains pure (zero network) and
 *      keeps RELEASE_SCHEMA_FREEZE_CHICAGO (23:45-04:15) and DAILY_GUARD_CHICAGO
 *      (03:50-04:10) intact.
 *   2. Under `three-hourly`, all 7 non-04:00 cycles defer inside
 *      [slot - 150m, slot + 10m) to slot + 10m on both CST and CDT, handling
 *      DST fall-back (first 01:00 only) and spring-forward accurately; merges
 *      outside that window dispatch immediately (subject to :50-:03); merges
 *      inside 23:45-04:15 keep the full nightly freeze to 04:15.
 *   3. Under `daily`, `unknown`, or omitted schedule, behavior is identical to
 *      prior daily + :50-:03 rules (no daytime deferral).
 *   4. Window files (`-- @install-window: daily-maintenance`) stay on the
 *      04:00 anchor unchanged.
 *   5. .github/scripts/dispatch-merged-migrations.sh reads live `/health`
 *      (read-only `curl --max-time 10`), passes `--schedule` to the pure
 *      planner, logs clearly when deferring, and falls back cleanly to daily
 *      when `/health` is unreadable (CLAUDE.md 10.86) without dropping a file.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  DAILY_GUARD_CHICAGO,
  RELEASE_FREEZE_WAIT_BUDGET_MINUTES,
  RELEASE_SCHEMA_FREEZE_CHICAGO,
  THREE_HOURLY_DEFER_WAIT_BUDGET_MINUTES,
  THREE_HOURLY_POST_SEAL_CLEAR_MINUTE,
  THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES,
  THREE_HOURLY_START_HOURS,
  WAIT_BUDGET_MINUTES,
  admissibleAt,
  earliestDispatch,
  inReleaseSchemaFreeze,
  inThreeHourlyCutoverDeferral,
  isThreeHourlySchedule,
  planDispatch,
  threeHourlyDeferralWindow,
} from '../scripts/ci/merged-migration-dispatch.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (iso: string) => Date.parse(iso);
const ORDINARY = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
const WINDOWED = '-- @install-window: daily-maintenance\nBEGIN;\nSELECT 1;\nCOMMIT;\n';
const MIG = 'supabase/migrations/20261121200000_o3_test.sql';

describe('three-hourly migration deferral constants, purity, and schedule agreement', () => {
  it('matches maintenanceSchedulePolicy.json startHours and preserves daily freeze constants', () => {
    const policy = JSON.parse(read('server/src/maintenance/maintenanceSchedulePolicy.json'));
    expect(THREE_HOURLY_START_HOURS).toEqual(policy.startHours);
    expect(THREE_HOURLY_START_HOURS).toEqual([1, 4, 7, 10, 13, 16, 19, 22]);
    expect(THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES).toBe(150);
    expect(THREE_HOURLY_POST_SEAL_CLEAR_MINUTE).toBe(10);
    expect(THREE_HOURLY_DEFER_WAIT_BUDGET_MINUTES).toBe(175);
    expect(RELEASE_SCHEMA_FREEZE_CHICAGO).toEqual({ from: [23, 45], until: [4, 15] });
    expect(DAILY_GUARD_CHICAGO).toEqual({ from: [3, 50], until: [4, 10] });
    expect(WAIT_BUDGET_MINUTES).toBe(22);
    expect(RELEASE_FREEZE_WAIT_BUDGET_MINUTES).toBe(345);
  });

  it('keeps merged-migration-dispatch.mjs pure with zero network calls', () => {
    const src = read('scripts/ci/merged-migration-dispatch.mjs');
    expect(src).not.toMatch(/\bfetch\s*\(|node:https?|https?:\/\/|child_process/);
  });

  it('recognizes three-hourly schedules and falls closed to daily for unknown/omitted', () => {
    expect(isThreeHourlySchedule('three-hourly')).toBe(true);
    expect(isThreeHourlySchedule({ frequency: 'three-hourly' })).toBe(true);
    expect(isThreeHourlySchedule({ threeHourly: true })).toBe(true);
    for (const v of [
      undefined,
      null,
      '',
      'daily',
      'unknown',
      'phase1-hourly',
      { frequency: 'daily' },
      { frequency: 'unknown' },
    ]) {
      expect(isThreeHourlySchedule(v), String(v)).toBe(false);
    }
  });

  it('workflow timeout covers both daytime three-hourly deferral and nightly freeze budgets', () => {
    const wf = parse(read('.github/workflows/dispatch-merged-migrations.yml')) as Record<
      string,
      any
    >;
    const timeout = wf.jobs['dispatch-merged-migrations']['timeout-minutes'];
    expect(THREE_HOURLY_DEFER_WAIT_BUDGET_MINUTES + 15).toBeLessThanOrEqual(timeout);
    expect(RELEASE_FREEZE_WAIT_BUDGET_MINUTES + 15).toBeLessThanOrEqual(timeout);
    expect(timeout).toBeLessThanOrEqual(360);
  });
});

describe('three-hourly pre-cutoff deferral across all 7 non-04:00 cycles (CST & CDT)', () => {
  // CST (UTC-6): 2026-11-21
  // CDT (UTC-5): 2026-07-15
  const seasons: Array<{ label: string; date: string; offsetHours: number }> = [
    { label: 'CST (UTC-6)', date: '2026-11-21', offsetHours: 6 },
    { label: 'CDT (UTC-5)', date: '2026-07-15', offsetHours: 5 },
  ];

  for (const { label, date, offsetHours } of seasons) {
    const chicagoIso = (hour: number, minute: number, second = 0) => {
      const base =
        Date.parse(`${date}T00:00:00Z`) +
        (hour + offsetHours) * 3_600_000 +
        minute * 60_000 +
        second * 1000;
      return new Date(base).toISOString();
    };

    it(`defers all 6 daytime non-04:00 cycles inside [slot-150m, slot+10m) to slot+10m on ${label}`, () => {
      for (const slot of [7, 10, 13, 16, 19, 22]) {
        const slotStartMs = Date.parse(chicagoIso(slot, 0));
        const deferStartMs = slotStartMs - THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES * 60_000;
        const clearAtMs = slotStartMs + 10 * 60_000;
        const slotStr = `${String(slot).padStart(2, '0')}:00`;
        const clearStr = `${String(slot).padStart(2, '0')}:10`;

        // 1 minute before deferral opens -> admitted immediately
        const beforeMs = deferStartMs - 60_000;
        expect(
          inThreeHourlyCutoverDeferral(beforeMs, 'three-hourly'),
          `${label} ${slotStr} -151m`
        ).toBe(false);
        const beforePlan = planDispatch([MIG], () => ORDINARY, beforeMs, [], 'three-hourly');
        expect(beforePlan.waitSeconds, `${label} ${slotStr} -151m`).toBe(0);
        expect(beforePlan.heldForThreeHourlyCutover).toBe(false);

        // Inside [slot - 150m, slot + 10m): start, -90m (the old start), cutoff (-30m),
        // cycle start (0m), and +9m59s
        for (const deltaMs of [0, 60 * 60_000, 120 * 60_000, 150 * 60_000, 159 * 60_000 + 59_000]) {
          const t = deferStartMs + deltaMs;
          expect(
            inThreeHourlyCutoverDeferral(t, 'three-hourly'),
            `${label} ${slotStr} +${deltaMs}`
          ).toBe(true);
          expect(admissibleAt(t, 1, false, 'three-hourly')).toBe(false);
          const plan = planDispatch([MIG], () => ORDINARY, t, [], 'three-hourly');
          expect(plan.heldForThreeHourlyCutover, `${label} ${slotStr}`).toBe(true);
          expect(plan.heldForDailyRelease, `${label} ${slotStr}`).toBe(false);
          expect(plan.threeHourlyCycle).toBe(slotStr);
          expect(plan.threeHourlyClearChicago).toBe(clearStr);
          expect(plan.withinBudget).toBe(true);
          // earliestDispatch steps at 15s resolution from t, so it lands in [clearAtMs, clearAtMs + 15s)
          const dispatchMs = Date.parse(plan.dispatchAt!);
          expect(dispatchMs).toBeGreaterThanOrEqual(clearAtMs);
          expect(dispatchMs).toBeLessThan(clearAtMs + 15_000);
          expect(new Date(dispatchMs).getUTCMinutes()).toBe(10);
        }

        // Exact clear instant (slot + 10m) -> admitted immediately
        expect(
          inThreeHourlyCutoverDeferral(clearAtMs, 'three-hourly'),
          `${label} ${slotStr} +10m`
        ).toBe(false);
        const afterPlan = planDispatch([MIG], () => ORDINARY, clearAtMs, [], 'three-hourly');
        expect(afterPlan.waitSeconds, `${label} ${slotStr} +10m`).toBe(0);
        expect(afterPlan.heldForThreeHourlyCutover).toBe(false);
      }
    });

    it(`covers the 01:00 cycle window [22:30, 01:10) and preserves the 23:45-04:15 nightly freeze on ${label}`, () => {
      // 01:00 cycle on next day: [22:30, 01:10)
      const oneAmMs = Date.parse(chicagoIso(25, 0)); // next day 01:00
      const wStart = threeHourlyDeferralWindow(oneAmMs - 150 * 60_000); // 22:30
      expect(wStart).not.toBeNull();
      expect(wStart!.cycleLabel).toBe('01:00');
      expect(wStart!.clearLabel).toBe('01:10');
      expect(threeHourlyDeferralWindow(oneAmMs + 9 * 60_000 + 59_000)!.clearLabel).toBe('01:10');
      expect(threeHourlyDeferralWindow(oneAmMs + 10 * 60_000)).toBeNull();

      // 22:29 dispatches immediately (after the 22:00 cycle's 22:10 clear)
      const pre = planDispatch([MIG], () => ORDINARY, oneAmMs - 151 * 60_000, [], 'three-hourly');
      expect(pre.waitSeconds).toBe(0);
      expect(pre.heldForDailyRelease).toBe(false);
      expect(pre.heldForThreeHourlyCutover).toBe(false);

      // 22:30 is deferred past 23:45 into the nightly release schema freeze -> 04:15 (345 min, within budget)
      const at2230 = planDispatch(
        [MIG],
        () => ORDINARY,
        oneAmMs - 150 * 60_000,
        [],
        'three-hourly'
      );
      expect(at2230.heldForDailyRelease).toBe(true);
      expect(at2230.heldForThreeHourlyCutover).toBe(false);
      expect(at2230.dispatchAt).toBe(chicagoIso(28, 15)); // next day 04:15
      expect(at2230.waitSeconds).toBe(345 * 60);
      expect(at2230.withinBudget).toBe(true);

      // Inside 23:45-04:15 (00:30, 01:04, 01:10, 03:30) keeps full nightly freeze to 04:15
      for (const [h, m] of [
        [24, 30],
        [25, 4],
        [25, 10],
        [27, 30],
      ]) {
        const t = Date.parse(chicagoIso(h, m));
        expect(inReleaseSchemaFreeze(t)).toBe(true);
        const p = planDispatch([MIG], () => ORDINARY, t, [], 'three-hourly');
        expect(p.heldForDailyRelease, `${label} ${h}:${m}`).toBe(true);
        expect(p.heldForThreeHourlyCutover, `${label} ${h}:${m}`).toBe(false);
        expect(p.dispatchAt, `${label} ${h}:${m}`).toBe(chicagoIso(28, 15));
        expect(p.withinBudget, `${label} ${h}:${m}`).toBe(true);
      }
    });

    it(`fits every minute of a full 24-hour ${label} day within budget for an ordinary merge`, () => {
      const dayStart = Date.parse(chicagoIso(0, 0));
      let maxThreeHourlyWaitMin = 0;
      for (let t = dayStart; t < dayStart + 24 * 3_600_000; t += 60_000) {
        const plan = planDispatch([MIG], () => ORDINARY, t, [], 'three-hourly');
        expect(plan.withinBudget, `${label} ${new Date(t).toISOString()}`).toBe(true);
        if (plan.heldForThreeHourlyCutover) {
          maxThreeHourlyWaitMin = Math.max(maxThreeHourlyWaitMin, plan.waitSeconds! / 60);
        }
      }
      expect(maxThreeHourlyWaitMin).toBe(160);
      expect(maxThreeHourlyWaitMin).toBeLessThanOrEqual(THREE_HOURLY_DEFER_WAIT_BUDGET_MINUTES);
    });
  }
});

describe('DST fall-back (first 01:00 only) and spring-forward accuracy', () => {
  it('fall-back day 2026-11-01: defers only for the first 01:00 CDT (06:00Z), never the repeated 01:00 CST (07:00Z)', () => {
    // First 01:00 CDT = 06:00Z -> [03:30Z, 06:10Z)
    expect(threeHourlyDeferralWindow(at('2026-11-01T03:29:59Z'))).toBeNull();
    const first = threeHourlyDeferralWindow(at('2026-11-01T03:30:00Z'));
    expect(first).not.toBeNull();
    expect(first!.cycleLabel).toBe('01:00');
    expect(first!.cycleStartAt).toBe('2026-11-01T06:00:00.000Z');
    expect(first!.clearAt).toBe('2026-11-01T06:10:00.000Z');
    expect(threeHourlyDeferralWindow(at('2026-11-01T06:09:59Z'))!.cycleStartAt).toBe(
      '2026-11-01T06:00:00.000Z'
    );
    expect(threeHourlyDeferralWindow(at('2026-11-01T06:10:00Z'))).toBeNull();

    // Repeated 01:00 CST = 07:00Z is NOT a cycle
    for (const iso of [
      '2026-11-01T06:15:00Z',
      '2026-11-01T06:30:00Z',
      '2026-11-01T07:00:00Z',
      '2026-11-01T07:05:00Z',
      '2026-11-01T07:09:59Z',
    ]) {
      expect(threeHourlyDeferralWindow(at(iso)), iso).toBeNull();
      // Nightly release schema freeze (23:45-04:15) still holds until 04:15 CST (10:15Z).
      expect(inReleaseSchemaFreeze(at(iso)), iso).toBe(true);
    }
    expect(
      new Date(
        earliestDispatch(at('2026-11-01T07:00:00Z'), 1, false, 'three-hourly')!
      ).toISOString()
    ).toBe('2026-11-01T10:15:00.000Z');
  });

  it('spring-forward day 2026-03-08: 01:00 CST (07:00Z), 04:00 CDT (09:00Z) nightly freeze, 07:00 CDT (12:00Z)', () => {
    expect(threeHourlyDeferralWindow(at('2026-03-08T05:30:00Z'))!.cycleStartAt).toBe(
      '2026-03-08T07:00:00.000Z'
    );
    // 04:00 CDT is the anchor (handled by RELEASE_SCHEMA_FREEZE_CHICAGO, not threeHourlyDeferralWindow)
    expect(threeHourlyDeferralWindow(at('2026-03-08T08:00:00Z'))).toBeNull();
    expect(inReleaseSchemaFreeze(at('2026-03-08T08:00:00Z'))).toBe(true);
    // 07:00 CDT (12:00Z) defers [09:30Z, 12:10Z) -> 12:10Z (09:30Z is 04:30 CDT, after the 04:15 freeze end)
    expect(threeHourlyDeferralWindow(at('2026-03-08T09:29:59Z'))).toBeNull();
    const p = planDispatch([MIG], () => ORDINARY, at('2026-03-08T09:30:00Z'), [], 'three-hourly');
    expect(p.heldForThreeHourlyCutover).toBe(true);
    expect(p.threeHourlyCycle).toBe('07:00');
    expect(p.threeHourlyClearChicago).toBe('07:10');
    expect(p.dispatchAt).toBe('2026-03-08T12:10:00.000Z');
  });
});

describe('daily, unknown, outside-window, and daily-maintenance window files', () => {
  it('daily and unknown schedules never defer during daytime three-hourly windows', () => {
    // 17:45 CST (23:45Z) is inside the 19:00 three-hourly window [16:30, 19:10), outside :50-:03
    const daytime = at('2026-11-21T23:45:00Z');
    expect(admissibleAt(daytime, 1, false, 'three-hourly')).toBe(false);
    for (const sched of [undefined, null, 'daily', 'unknown', { frequency: 'daily' }]) {
      expect(admissibleAt(daytime, 1, false, sched), String(sched)).toBe(true);
      const p = planDispatch([MIG], () => ORDINARY, daytime, [], sched);
      expect(p.waitSeconds, String(sched)).toBe(0);
      expect(p.heldForThreeHourlyCutover, String(sched)).toBe(false);
      expect(p.threeHourlyCycle).toBeNull();
      expect(p.threeHourlyClearChicago).toBeNull();
    }
  });

  it('outside three-hourly deferral windows an ordinary merge is sent at once; :50-:03 still binds daily', () => {
    // 16:15 CST (22:15Z) is in the 20-minute install window [16:10, 16:30) between the
    // 16:00 cycle's clear and the 19:00 cycle's [16:30, 19:10) deferral.
    const open = planDispatch(
      [MIG],
      () => ORDINARY,
      at('2026-11-21T22:15:00Z'),
      [],
      'three-hourly'
    );
    expect(open.heldForThreeHourlyCutover).toBe(false);
    expect(open.heldForDailyRelease).toBe(false);
    expect(open.waitSeconds).toBe(0);
    // 16:50 CST (22:50Z) is inside the 19:00 deferral under three-hourly ...
    const held = planDispatch(
      [MIG],
      () => ORDINARY,
      at('2026-11-21T22:50:00Z'),
      [],
      'three-hourly'
    );
    expect(held.heldForThreeHourlyCutover).toBe(true);
    expect(held.dispatchAt).toBe('2026-11-22T01:10:00.000Z');
    // ... and under daily the ordinary :50-:03 wait applies unchanged.
    const daily = planDispatch([MIG], () => ORDINARY, at('2026-11-21T22:50:00Z'), [], 'daily');
    expect(daily.heldForThreeHourlyCutover).toBe(false);
    expect(daily.dispatchAt).toBe('2026-11-21T23:04:00.000Z');
    expect(daily.waitSeconds).toBe(14 * 60);
    expect(daily.withinBudget).toBe(true);
  });

  it('an ordinary file installs only in the seven windows after a cycle clears: 135 minutes a day, none adjacent', () => {
    for (const [label, date, offsetHours] of [
      ['CST', '2026-11-21', 6],
      ['CDT', '2026-07-15', 5],
    ] as const) {
      const dayStart = Date.parse(`${date}T00:00:00Z`) + offsetHours * 3_600_000;
      const open: number[] = [];
      for (let m = 0; m < 24 * 60; m++) {
        if (admissibleAt(dayStart + m * 60_000, 1, false, 'three-hourly')) open.push(m);
      }
      expect(open.length, label).toBe(135);
      const runs: Array<[number, number]> = [];
      for (const m of open) {
        const last = runs[runs.length - 1];
        if (last && last[1] === m - 1) last[1] = m;
        else runs.push([m, m]);
      }
      // 04:15-04:29, then slot+10..slot+29 for 07, 10, 13, 16, 19, 22.
      expect(runs, label).toEqual([
        [4 * 60 + 15, 4 * 60 + 29],
        ...[7, 10, 13, 16, 19, 22].map((h) => [h * 60 + 10, h * 60 + 29]),
      ]);
    }
  });

  it('daily-maintenance window migrations stay on the 04:00 anchor unchanged under three-hourly', () => {
    const p = planDispatch([MIG], () => WINDOWED, at('2026-11-21T23:45:00Z'), [], 'three-hourly');
    expect(p.dispatch).toEqual([]);
    expect(p.windowQueued).toEqual(['20261121200000_o3_test.sql']);
    expect(p.heldForThreeHourlyCutover).toBe(false);
    expect(p.heldForDailyRelease).toBe(false);
  });
});

describe('dispatch-merged-migrations.sh wiring and CLAUDE.md 10.86 fallback', () => {
  const REAL_MIG = '20261108020000_a_job_failing_every_run_is_named.sql';

  function runShellFixture(opts: {
    healthScript: string;
    nowIso: string;
    phase: 'plan' | 'send';
    sleepMock?: boolean;
  }) {
    const box = mkdtempSync(join(tmpdir(), 'o3-dispatch-'));
    try {
      const calls = join(box, 'calls');
      const sleeps = join(box, 'sleeps');
      const files = join(box, 'files.json');
      writeFileSync(
        files,
        JSON.stringify([{ filename: `supabase/migrations/${REAL_MIG}`, status: 'added' }])
      );
      writeFileSync(
        join(box, 'gh'),
        `#!/usr/bin/env bash
echo "$*" >> '${calls}'
case "$*" in
  *pulls/11700/files*)
    while [ $# -gt 0 ]; do [ "$1" = --jq ] && { jq -r "$2" '${files}'; exit; }; shift; done
    exit 9 ;;
  *actions/workflows/apply-merged-migration.yml*)
    echo active
    exit 0 ;;
esac
`
      );
      chmodSync(join(box, 'gh'), 0o755);
      writeFileSync(join(box, 'curl'), opts.healthScript);
      chmodSync(join(box, 'curl'), 0o755);
      if (opts.sleepMock) {
        writeFileSync(
          join(box, 'sleep'),
          `#!/usr/bin/env bash\necho "$*" >> '${sleeps}'\nexit 0\n`
        );
        chmodSync(join(box, 'sleep'), 0o755);
      }
      const event = join(box, 'event.json');
      writeFileSync(
        event,
        JSON.stringify({
          repository: { default_branch: 'main' },
          pull_request: {
            number: 11700,
            merged: true,
            base: { ref: 'main', repo: { full_name: 'o/r' } },
            head: { sha: 'b'.repeat(40), repo: { full_name: 'o/r' } },
          },
        })
      );
      const summary = join(box, 'summary');
      const intents = join(box, 'intents');
      const state = join(box, 'state.jsonl');
      const runPhase = (phase: 'plan' | 'send', nowIso: string) =>
        spawnSync('bash', ['.github/scripts/dispatch-merged-migrations.sh'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${box}:${process.env.PATH}`,
            GH_TOKEN: 'x',
            REPO: 'o/r',
            PR: '11700',
            MERGED_BY: 'Smarter-Poker',
            GITHUB_STEP_SUMMARY: summary,
            GITHUB_RUN_ID: '99',
            GITHUB_RUN_ATTEMPT: '1',
            GITHUB_REPOSITORY: 'o/r',
            GITHUB_WORKFLOW_REF:
              'o/r/.github/workflows/dispatch-merged-migrations.yml@refs/heads/main',
            GITHUB_SHA: 'a'.repeat(40),
            GITHUB_EVENT_NAME: 'pull_request_target',
            GITHUB_EVENT_PATH: event,
            GITHUB_OUTPUT: join(box, 'output'),
            DISPATCH_PHASE: phase,
            INTENT_DIR: intents,
            INTENT_STATE: state,
            DISPATCH_NOW_MS: String(at(nowIso)),
          },
        });
      const planRes = runPhase('plan', opts.nowIso);
      const sendRes = opts.phase === 'send' ? runPhase('send', opts.nowIso) : null;
      return {
        planRes,
        sendRes,
        summary: readFileSync(summary, 'utf8'),
        calls: readFileSync(calls, 'utf8'),
        sleeps: opts.sleepMock
          ? (() => {
              try {
                return readFileSync(sleeps, 'utf8');
              } catch {
                return '';
              }
            })()
          : '',
      };
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  }

  it('defers with clear log + PR comment and sleeps once when /health reports three-hourly', () => {
    // 2026-11-21T23:45:00Z = 17:45 CST, inside 19:00 cycle [17:30, 19:10) -> defers 85m (5100s) to 19:10 CST
    const res = runShellFixture({
      healthScript: `#!/usr/bin/env bash\necho '{"maintenance":{"schedule":{"frequency":"three-hourly"}}}'\n`,
      nowIso: '2026-11-21T23:45:00Z',
      phase: 'send',
      sleepMock: true,
    });
    expect(res.planRes.status, res.planRes.stderr).toBe(0);
    // In send phase with frozen DISPATCH_NOW_MS, sleep is mocked (instant) and post-sleep
    // admitted re-check intentionally refuses because the frozen clock did not advance past 19:10.
    expect(res.summary).toContain(
      'Deferring ordinary migration install until 19:10 Chicago to protect the 19:00 3-hourly Backup certificate'
    );
    expect(res.calls).toContain(
      'Deferring ordinary migration install until 19:10 Chicago to protect the 19:00 3-hourly Backup certificate'
    );
    expect(res.sleeps.trim()).toBe('5100');
  });

  it('falls back cleanly to daily + :50-:03 and dispatches immediately when /health is unreadable (CLAUDE.md 10.86)', () => {
    // 2026-11-21T23:45:00Z = 17:45 CST: admitted immediately under daily/unknown fallback
    const res = runShellFixture({
      healthScript: `#!/usr/bin/env bash\nexit 22\n`,
      nowIso: '2026-11-21T23:45:00Z',
      phase: 'send',
      sleepMock: true,
    });
    expect(res.planRes.status, res.planRes.stderr).toBe(0);
    expect(res.sendRes!.status, res.sendRes!.stderr + res.sendRes!.stdout).toBe(0);
    expect(res.summary).toContain('COULD NOT TELL serving engine maintenance schedule');
    expect(res.summary).toContain('falling back to daily + :50-:03 rules');
    expect(res.sleeps.trim()).toBe('');
    expect(res.calls).toContain(`client_payload[migration]=${REAL_MIG}`);
  });

  it('reads /health with curl --max-time 10 and passes --schedule to both plan and admitted', () => {
    const sh = read('.github/scripts/dispatch-merged-migrations.sh');
    expect(sh).toContain('https://engine.smarter.poker/health');
    expect(sh).toContain('curl -fsS --max-time 10');
    expect(sh).toContain('.maintenance.schedule.frequency');
    expect(sh).toContain('--schedule "$SCHEDULE_FREQUENCY"');
    expect(sh.match(/--schedule "\$SCHEDULE_FREQUENCY"/g)).toHaveLength(2);
  });
});
