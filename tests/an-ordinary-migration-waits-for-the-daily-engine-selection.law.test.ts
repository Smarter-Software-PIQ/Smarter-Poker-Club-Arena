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
 * routine run kept serving. So the merge dispatcher holds ordinary migrations
 * until 04:15 Chicago in its own single bounded wait. The 2026-11-17 install
 * at 07:04Z was 01:04 Chicago: under this rule it is held to 04:15.
 *
 * THE HOLD STARTS AT 00:45, NOT 23:45 (2026-11-19). On 2026-11-19 (Stage
 * 44462209828) every certified candidate was refused "Backup copy lacks the
 * exact candidate migration(s) 20261119013426, 20261119013430, ...": those
 * migrations merged 23:35-00:37 Chicago, were held to 04:15, and so could
 * never be on a copy by 03:30, and four merged engine fixes waited a day.
 * The 23:45 start was sized for a 00:07 nightly Backup schedule that GitHub
 * delivers seven to nine hours late; the copy is refreshed by contents on
 * every Backup push run. The hold now starts at the last instant whose
 * install two full Backup runs can still certify before the 03:30 cutoff.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  BACKUP_CERTIFICATE_WORST_MINUTES,
  DAILY_SELECTION_CHICAGO,
  RELEASE_FREEZE_WAIT_BUDGET_MINUTES,
  RELEASE_SCHEMA_FREEZE_CHICAGO,
  WAIT_BUDGET_MINUTES,
  admissibleAt,
  earliestDispatch,
  inReleaseSchemaFreeze,
  planDispatch,
  releaseFreezeLabel,
} from '../scripts/ci/merged-migration-dispatch.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (iso: string) => Date.parse(iso);
const ORDINARY = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
const WINDOWED = '-- @install-window: daily-maintenance\nBEGIN;\nSELECT 1;\nCOMMIT;\n';

describe('ordinary installs hold from the last certifiable instant until the seal', () => {
  const minutes = ([h, m]: number[]) => h * 60 + m;

  it('the hold ends after the 04:00-04:05 cutover', () => {
    expect(RELEASE_SCHEMA_FREEZE_CHICAGO).toEqual({ from: [0, 45], until: [4, 15] });
    expect(minutes(RELEASE_SCHEMA_FREEZE_CHICAGO.until)).toBeGreaterThan(minutes([4, 5]));
  });

  it('an install just before the hold is still certified before the 03:30 selection', () => {
    // The selector's own cutoff is the 03:30 this module names.
    expect(read('scripts/ci/select-daily-engine.py')).toContain(
      `time(${DAILY_SELECTION_CHICAGO[0]}, ${DAILY_SELECTION_CHICAGO[1]})`
    );
    expect(DAILY_SELECTION_CHICAGO).toEqual([3, 30]);
    // Two full Backup runs (measured max 68.7 min each) fit between the
    // hold's start and the cutoff: the run that copied just before the
    // install finishes, then the next run copies the install and certifies.
    expect(BACKUP_CERTIFICATE_WORST_MINUTES).toBeGreaterThanOrEqual(2 * 69 + 2);
    expect(
      minutes(RELEASE_SCHEMA_FREEZE_CHICAGO.from) + BACKUP_CERTIFICATE_WORST_MINUTES
    ).toBeLessThanOrEqual(minutes(DAILY_SELECTION_CHICAGO));
  });

  it('every ordinary migration merged on the 2026-11-19 night before 00:45 installs before the selection', () => {
    // 46f81acff 23:35, e775df7d5 00:15, 5d9295866 00:27, 5d12da55e 00:37 Chicago.
    for (const merged of [
      '2026-11-19T05:35:17Z',
      '2026-11-19T06:15:33Z',
      '2026-11-19T06:27:42Z',
      '2026-11-19T06:37:57Z',
    ]) {
      const plan = planDispatch(
        ['supabase/migrations/20261119013426_a.sql'],
        () => ORDINARY,
        at(merged)
      );
      expect(plan.heldForDailyRelease, merged).toBe(false);
      expect(plan.withinBudget, merged).toBe(true);
      // Installed, and a Backup certificate can still follow, before 03:30 CST (09:30Z).
      expect(at(plan.dispatchAt!) + BACKUP_CERTIFICATE_WORST_MINUTES * 60_000).toBeLessThanOrEqual(
        at('2026-11-19T09:30:00Z')
      );
    }
    // 518815486 (02:34 Chicago) is inside the hold: no copy could certify it by 03:30.
    expect(inReleaseSchemaFreeze(at('2026-11-19T08:34:41Z'))).toBe(true);
  });

  it('the dispatcher names the planner window, never a retyped one', () => {
    expect(releaseFreezeLabel()).toBe('00:45-04:15');
    const plan = planDispatch(
      ['supabase/migrations/20261117000000_a.sql'],
      () => ORDINARY,
      at('2026-11-18T07:00:00Z')
    );
    expect(plan.releaseFreezeChicago).toBe('00:45-04:15');
    const script = read('.github/scripts/dispatch-merged-migrations.sh');
    expect(script).toContain("jq -r '.releaseFreezeChicago'");
    expect(script).not.toMatch(/\b23:45\b/);
  });

  it('holds a merge at the 2026-11-17 install moment (01:04 CST) until 04:15 CST', () => {
    const merged = at('2026-11-17T07:04:05Z');
    expect(inReleaseSchemaFreeze(merged)).toBe(true);
    expect(admissibleAt(merged, 1, false)).toBe(false);
    expect(new Date(earliestDispatch(merged, 1, false)!).toISOString()).toBe(
      '2026-11-17T10:15:05.000Z'
    );
  });

  it('holds from 00:45 to 04:15 on both DST sides', () => {
    // CST (UTC-6)
    expect(inReleaseSchemaFreeze(at('2026-11-18T05:45:00Z'))).toBe(false); // 23:45
    expect(inReleaseSchemaFreeze(at('2026-11-18T06:07:00Z'))).toBe(false); // 00:07
    expect(inReleaseSchemaFreeze(at('2026-11-18T06:44:59Z'))).toBe(false); // 00:44:59
    expect(inReleaseSchemaFreeze(at('2026-11-18T06:45:00Z'))).toBe(true); // 00:45
    expect(inReleaseSchemaFreeze(at('2026-11-18T09:30:00Z'))).toBe(true); // 03:30
    expect(inReleaseSchemaFreeze(at('2026-11-18T10:14:59Z'))).toBe(true); // 04:14:59
    expect(inReleaseSchemaFreeze(at('2026-11-18T10:15:00Z'))).toBe(false); // 04:15
    // CDT (UTC-5)
    expect(inReleaseSchemaFreeze(at('2026-07-01T05:44:00Z'))).toBe(false); // 00:44
    expect(inReleaseSchemaFreeze(at('2026-07-01T05:46:00Z'))).toBe(true); // 00:46
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
    // 00:44 CST = 06:44 UTC needs 3 minutes before :50, so it is sent at once (00:44);
    // 00:49 CST = 06:49 UTC must wait for the :04 instant, which is 01:04 CST, inside the freeze.
    expect(
      planDispatch(['supabase/migrations/20261117000000_a.sql'], () => ORDINARY, at('2026-11-18T06:44:00Z'))
        .heldForDailyRelease
    ).toBe(false);
    const plan = planDispatch(
      ['supabase/migrations/20261117000000_a.sql'],
      () => ORDINARY,
      at('2026-11-18T06:49:00Z')
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
      earliestDispatch(at('2026-11-18T06:45:00Z'), 1, false)! - at('2026-11-18T06:45:00Z');
    expect(worst / 60_000).toBe(210);
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
