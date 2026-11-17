/**
 * AN ORDINARY MIGRATION WAITS FOR THE DAILY ENGINE SELECTION (owner
 * instruction, 11:04 Chicago 2026-11-17: the 04:00 engine cutover "IS
 * SUPPOSED TO RUN AUTOMATICALLY AT 4AM CST EVERY DAY").
 *
 * The 03:30 selector (scripts/ci/select-daily-engine.py) admits only a Backup
 * certificate whose restored copy holds every migration production has
 * installed. On 2026-11-16 (Stage 43824655446) and 2026-11-17 (Stage
 * 44034697186) every candidate was deferred "Backup copy lacks installed
 * migration": ordinary installs landed after the last copy (2026-11-17:
 * 20261117053627 at 07:04Z; the copy restored 07:06:53Z without it), and the
 * routine run kept serving. The nightly Backup refresh runs at 00:07 Chicago,
 * so the merge dispatcher holds ordinary migrations from 23:45 to 04:15
 * Chicago in its own single bounded wait. The 2026-11-17 install at 07:04Z
 * was 01:04 Chicago: under this rule it is held to 04:15.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  RELEASE_FREEZE_WAIT_BUDGET_MINUTES,
  RELEASE_SCHEMA_FREEZE_CHICAGO,
  WAIT_BUDGET_MINUTES,
  admissibleAt,
  earliestDispatch,
  inReleaseSchemaFreeze,
  planDispatch,
} from '../scripts/ci/merged-migration-dispatch.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (iso: string) => Date.parse(iso);
const ORDINARY = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
const WINDOWED = '-- @install-window: daily-maintenance\nBEGIN;\nSELECT 1;\nCOMMIT;\n';

describe('ordinary installs hold from before the nightly Backup copy until the seal', () => {
  it('the freeze starts before the 00:07 nightly refresh and ends after the 04:00-04:05 cutover', () => {
    expect(RELEASE_SCHEMA_FREEZE_CHICAGO).toEqual({ from: [23, 45], until: [4, 15] });
    const crons = (
      parse(read('.github/workflows/backup-engine.yml')) as Record<string, any>
    ).on.schedule.map((s: { cron: string }) => s.cron);
    // 05:07 UTC is 00:07 CDT; 06:07 UTC is 00:07 CST.
    expect(crons).toEqual(['7,23,41 5 * * *', '7,23,41 6 * * *']);
  });

  it('holds a merge at the 2026-11-17 install moment (01:04 CST) until 04:15 CST', () => {
    const merged = at('2026-11-17T07:04:05Z');
    expect(inReleaseSchemaFreeze(merged)).toBe(true);
    expect(admissibleAt(merged, 1, false)).toBe(false);
    expect(new Date(earliestDispatch(merged, 1, false)!).toISOString()).toBe(
      '2026-11-17T10:15:05.000Z'
    );
  });

  it('wraps midnight on both DST sides', () => {
    // CST (UTC-6)
    expect(inReleaseSchemaFreeze(at('2026-11-18T05:44:00Z'))).toBe(false); // 23:44
    expect(inReleaseSchemaFreeze(at('2026-11-18T05:45:00Z'))).toBe(true); // 23:45
    expect(inReleaseSchemaFreeze(at('2026-11-18T06:07:00Z'))).toBe(true); // 00:07
    expect(inReleaseSchemaFreeze(at('2026-11-18T09:30:00Z'))).toBe(true); // 03:30
    expect(inReleaseSchemaFreeze(at('2026-11-18T10:14:59Z'))).toBe(true); // 04:14:59
    expect(inReleaseSchemaFreeze(at('2026-11-18T10:15:00Z'))).toBe(false); // 04:15
    // CDT (UTC-5)
    expect(inReleaseSchemaFreeze(at('2026-07-01T04:44:00Z'))).toBe(false); // 23:44
    expect(inReleaseSchemaFreeze(at('2026-07-01T04:46:00Z'))).toBe(true); // 23:46
    expect(inReleaseSchemaFreeze(at('2026-07-01T09:15:00Z'))).toBe(false); // 04:15
  });

  it('daytime merges are untouched', () => {
    expect(admissibleAt(at('2026-11-17T16:10:00Z'), 1, false)).toBe(true); // 10:10 CST
    expect(admissibleAt(at('2026-11-18T05:30:00Z'), 1, false)).toBe(true); // 23:30 CST, :30 UTC
    const plan = planDispatch(
      ['supabase/migrations/20261117000000_a.sql'],
      () => ORDINARY,
      at('2026-11-17T16:10:00Z')
    );
    expect(plan.waitSeconds).toBe(0);
    expect(plan.heldForDailyRelease).toBe(false);
  });

  it('a merge just before the freeze that the :50 break pushes into it is held, and says so', () => {
    // 23:30 CST = 05:30 UTC: the :50-:03 break does not apply yet; 23:49 CST = 05:49 UTC needs
    // the :04 instant, which is 00:04 CST, inside the freeze.
    const plan = planDispatch(
      ['supabase/migrations/20261117000000_a.sql'],
      () => ORDINARY,
      at('2026-11-18T05:49:00Z')
    );
    expect(plan.heldForDailyRelease).toBe(true);
    expect(plan.dispatchAt).toBe('2026-11-18T10:15:00.000Z');
    expect(plan.withinBudget).toBe(true);
  });

  it('window files keep their own 04:00 route and are not held here', () => {
    const plan = planDispatch(
      ['supabase/migrations/20261117000000_w.sql'],
      () => WINDOWED,
      at('2026-11-18T07:00:00Z')
    );
    expect(plan.dispatch).toEqual([]);
    expect(plan.windowQueued).toEqual(['20261117000000_w.sql']);
    expect(plan.heldForDailyRelease).toBe(false);
  });

  it('the worst hold fits the bounded wait and the job timeout', () => {
    const worst =
      earliestDispatch(at('2026-11-18T05:45:00Z'), 1, false)! - at('2026-11-18T05:45:00Z');
    expect(worst / 60_000).toBe(270);
    expect(worst / 60_000).toBeLessThanOrEqual(RELEASE_FREEZE_WAIT_BUDGET_MINUTES);
    // The ordinary hourly bound is unchanged.
    expect(WAIT_BUDGET_MINUTES).toBe(22);
    const timeout = (
      parse(read('.github/workflows/dispatch-merged-migrations.yml')) as Record<string, any>
    ).jobs['dispatch-merged-migrations']['timeout-minutes'];
    expect(RELEASE_FREEZE_WAIT_BUDGET_MINUTES + 5).toBeLessThanOrEqual(timeout);
    expect(timeout).toBeLessThanOrEqual(360);
  });

  it('the dispatcher tells the PR it is held, and names the outage route', () => {
    const script = read('.github/scripts/dispatch-merged-migrations.sh');
    expect(script).toContain("jq -r '.heldForDailyRelease'");
    expect(script).toContain('HELD FOR THE DAILY ENGINE RELEASE');
    expect(script).toContain('dispatch \\`apply-merged-migration\\` by hand');
    // Held is announced before the one sleep, and the clock is asked again after it.
    expect(script.indexOf('HELD FOR THE DAILY ENGINE RELEASE')).toBeLessThan(
      script.indexOf('sleep "$WAIT"')
    );
    expect(script.indexOf('sleep "$WAIT"')).toBeLessThan(
      script.indexOf('node "$PLANNER" admitted')
    );
  });
});
