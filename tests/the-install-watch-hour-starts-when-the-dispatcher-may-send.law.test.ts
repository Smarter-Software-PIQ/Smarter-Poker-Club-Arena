/**
 * THE INSTALL WATCH'S HOUR STARTS WHEN THE DISPATCHER MAY SEND (2026-11-19).
 *
 * Reliability incident dc479141 (MergedMigrationNotInstalled, alert 445153).
 * Dispatch Merged Migrations holds every ordinary migration merged inside the
 * nightly release schema freeze (RELEASE_SCHEMA_FREEZE_CHICAGO, 23:45-04:15
 * Central) until 04:15, on purpose: an install after the 00:07 Backup copy
 * strands the 03:30 engine certificate. The database install watch
 * (public.fn_ca_merged_migration_install_watch) did not know that clock. It
 * paged every freeze-held merge 60 minutes after merging, told the reader to
 * "Dispatch Apply Merged Migration for it" (the one action that spoils the
 * cutover), and kept a refused file's hour running from its original merge
 * after the fix in place had already merged.
 *
 * Two clocks that must agree lived in two languages with nothing tying them.
 * This law ties them: the SQL helper's freeze bounds must equal the
 * dispatcher's constants, and the watch's newest definition must take its hour
 * from that helper, restart it on a fix in place, give the re-page its own key,
 * and never say "dispatch it" inside the freeze. Moving the freeze in
 * merged-migration-dispatch.mjs without moving the SQL fails here.
 * Behaviour is proved natively by
 * scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';
import schedulePolicy from '../server/src/maintenance/maintenanceSchedulePolicy.json';
import {
  RELEASE_SCHEMA_FREEZE_CHICAGO,
  THREE_HOURLY_START_HOURS,
  THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES,
  THREE_HOURLY_POST_SEAL_CLEAR_MINUTE,
  inReleaseSchemaFreeze,
  threeHourlyDeferralWindow,
} from '../scripts/ci/merged-migration-dispatch.mjs';

const hhmm = ([h, m]: number[]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const FROM = hhmm(RELEASE_SCHEMA_FREEZE_CHICAGO.from);
const UNTIL = hhmm(RELEASE_SCHEMA_FREEZE_CHICAGO.until);

function newestBody(defines: RegExp): { name: string; body: string } {
  const last = migrationCorpus()
    .filter(({ sql }) => defines.test(sql))
    .pop();
  expect(last, `no migration matches ${defines}`).toBeDefined();
  const sql = last!.sql;
  const start = sql.search(defines);
  const open = sql.indexOf('$function$', start);
  return { name: last!.name, body: sql.slice(start, sql.indexOf('$function$', open + 1)) };
}

const FREEZE =
  /create\s+or\s+replace\s+function\s+smarter_private\.ca_release_schema_freeze_holds\s*\(/i;
const THREE_HOURLY =
  /create\s+or\s+replace\s+function\s+smarter_private\.ca_three_hourly_deferral_clears_at\s*\(/i;
const DUE =
  /create\s+or\s+replace\s+function\s+smarter_private\.ca_merged_migration_install_due_at\s*\(/i;

describe("the install watch's hour starts when the dispatcher may send", () => {
  it('the dispatcher freeze is still a midnight-wrapping Chicago window', () => {
    expect(FROM > UNTIL).toBe(true);
    // 2026-11-19 is CST (UTC-6): 05:44Z = 23:44, 05:45Z = 23:45, 10:15Z = 04:15.
    expect(inReleaseSchemaFreeze(Date.parse('2026-11-19T05:44:59Z'))).toBe(false);
    expect(inReleaseSchemaFreeze(Date.parse('2026-11-19T05:45:00Z'))).toBe(true);
    expect(inReleaseSchemaFreeze(Date.parse('2026-11-19T10:14:59Z'))).toBe(true);
    expect(inReleaseSchemaFreeze(Date.parse('2026-11-19T10:15:00Z'))).toBe(false);
  });

  it("the SQL freeze helper's bounds equal RELEASE_SCHEMA_FREEZE_CHICAGO", () => {
    const { body } = newestBody(FREEZE);
    expect(body).toMatch(/AT TIME ZONE 'America\/Chicago'/);
    expect(body).toContain(`>= time '${FROM}'`);
    expect(body).toContain(`<  time '${UNTIL}'`);
    const times = [...body.matchAll(/time '(\d\d:\d\d)'/g)].map((m) => m[1]).sort();
    expect(times).toEqual([FROM, UNTIL].sort());
  });

  it("the SQL three-hourly deferral helper's bounds equal merged-migration-dispatch.mjs and maintenanceSchedulePolicy.json", () => {
    expect(schedulePolicy.frequency).toBe('three-hourly');
    expect(schedulePolicy.startHours).toEqual(THREE_HOURLY_START_HOURS);
    // Exact incident ba9d1133 / alert 447640 timestamp: 2026-11-22 21:35:11Z (15:35 CST).
    expect(threeHourlyDeferralWindow(Date.parse('2026-11-22T21:35:11Z'))?.clearAt).toBe(
      '2026-11-22T22:10:00.000Z'
    );
    expect(threeHourlyDeferralWindow(Date.parse('2026-11-22T20:29:59Z'))).toBeNull();
    expect(threeHourlyDeferralWindow(Date.parse('2026-11-22T22:10:00Z'))).toBeNull();

    const { body } = newestBody(THREE_HOURLY);
    expect(body).toMatch(/AT TIME ZONE 'America\/Chicago'/);
    expect(body).toContain(`ARRAY[${THREE_HOURLY_START_HOURS.join(', ')}]`);
    expect(body).toContain(`interval '${THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES} minutes'`);
    expect(body).toContain(`interval '${THREE_HOURLY_POST_SEAL_CLEAR_MINUTE} minutes'`);
  });

  it('the due-at helper releases O3-deferred and freeze-held files at the dispatcher release instant, plus the hour', () => {
    const { body } = newestBody(DUE);
    expect(body).toContain('smarter_private.ca_three_hourly_deferral_clears_at(p_clock)');
    expect(body).toContain('smarter_private.ca_release_schema_freeze_holds(');
    expect(body).toContain(`+ time '${UNTIL}'`);
    expect(body).toContain(`>= time '${FROM}'`);
    expect(body).toMatch(/END \+ interval '60 minutes'/);
  });

  it("the watch's newest amendment takes its hour from the helper, restarts it on a fix in place, and refuses hand-dispatch during O3 deferral", () => {
    const corpus = migrationCorpus();
    const at = corpus.findIndex(({ name }) =>
      name.includes('the_install_watch_hour_starts_when_the_dispatcher_may_send')
    );
    const atO3 = corpus.findIndex(({ name }) =>
      name.includes('the_install_watch_follows_three_hourly_deferral')
    );
    expect(at).toBeGreaterThanOrEqual(0);
    expect(atO3).toBeGreaterThan(at);
    const sql = corpus[at].sql;
    const sqlO3 = corpus[atO3].sql;
    // A later wholesale redefinition must keep both clocks and both non-dispatch warnings.
    const WHOLE =
      /create\s+or\s+replace\s+function\s+public\.fn_ca_merged_migration_install_watch\s*\(/i;
    for (const later of corpus.slice(at + 1).filter(({ sql: s }) => WHOLE.test(s))) {
      expect(
        later.sql,
        `${later.name} redefines the watch without the dispatcher's clock`
      ).toContain('ca_merged_migration_install_due_at(');
      expect(later.sql, `${later.name} redefines the watch without the freeze wording`).toContain(
        'do NOT hand-dispatch'
      );
      if (corpus.indexOf(later) > atO3) {
        expect(
          later.sql,
          `${later.name} redefines the watch without the three-hourly deferral wording`
        ).toContain('ca_three_hourly_deferral_clears_at(p_at)');
      }
    }
    expect(sql).toContain(
      'ca_merged_migration_install_due_at(GREATEST(v_row.merged_at, v_row.modified_at)) > p_at'
    );
    expect(sql).toContain('modified_at = GREATEST(COALESCE(modified_at, v_at), v_at)');
    // One page per (file, fix): alerts are unique on (source, event_key).
    expect(sql).toContain(
      "'uninstalled:' || v_row.version || COALESCE('@' || left(v_row.modified_sha, 12), '')"
    );
    // Inside the nightly freeze or a three-hourly O3 deferral, the page must never instruct a hand dispatch.
    expect(sql).toMatch(
      /WHEN smarter_private\.ca_release_schema_freeze_holds\(p_at\)\s+THEN 'It is inside the nightly release schema freeze/
    );
    expect(sql).toContain('do NOT hand-dispatch');
    expect(sqlO3).toContain(
      'WHEN smarter_private.ca_three_hourly_deferral_clears_at(p_at) IS NOT NULL'
    );
    expect(sqlO3).toContain(
      'do NOT hand-dispatch Apply Merged Migration, an install now strands the active cutover certificate'
    );
  });
});
