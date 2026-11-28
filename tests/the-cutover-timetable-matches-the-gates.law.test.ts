/**
 * LAW: the published cutover timetable is the gates' own numbers.
 * ============================================================================
 * Owner order 2026-11-24 09:36 Chicago ("MAKE THE 3-HOUR CUTOVER RELIABLE"),
 * Cutover reliability programme item 5: one timetable per three-hour cycle in
 * docs/ops, kept in agreement with the gate scripts by a law. A lane lost a
 * write slot to the 03:05-04:45 switch blackout because that window lived only
 * in a gate script; a timetable written from memory rots the same way.
 *
 * docs/ops/engine-cutover-timetable.json holds every number. This law parses
 * each enforced number from the file that enforces it and fails when the JSON
 * disagrees, and fails when docs/ops/engine-cutover-timetable.md is not the
 * rendering of the JSON (scripts/ops/engine-cutover-timetable.mjs). Changing a
 * window is therefore the gate's constant, one JSON value and `--write`, in
 * one commit; changing only one of them is a red build.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import {
  BEGIN,
  END,
  documentIsCurrent,
  normalizeTimetable,
  renderTimetable,
} from '../scripts/ops/engine-cutover-timetable.mjs';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const T = JSON.parse(read('docs/ops/engine-cutover-timetable.json'));
const MD = read('docs/ops/engine-cutover-timetable.md');

const one = (src: string, re: RegExp, what: string): RegExpMatchArray => {
  const all = [
    ...src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')),
  ];
  expect(all.length, `${what}: expected exactly one match of ${re}`).toBe(1);
  return all[0];
};
const num = (src: string, re: RegExp, what: string) => Number(one(src, re, what)[1]);
const hours = (s: string) => s.split(',').map((x) => Number(x.trim()));
const hhmm = ([h, m]: number[]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

const POLICY = JSON.parse(read('server/src/maintenance/maintenanceSchedulePolicy.json'));
const DISPATCH = read('scripts/ci/merged-migration-dispatch.mjs');
const STAGE = read('.github/workflows/stage-engine-release.yml');
const BACKUP = read('.github/workflows/backup-engine.yml');
const SWITCH = read('scripts/ops/horse-option-switch-lib.mjs');
const APPLIER = read('scripts/ci/apply-recorded-migration.mjs');
const BREAK = read('server/src/maintenance/MaintenanceBreak.ts');
const SEAL = read('server/scripts/engine-release-seal.py');
const PREQUAL = read('scripts/ci/read-engine-prequalification.py');

/** The newest migration that defines `marker`: the definition production ends up with. */
const governing = (marker: string): string => {
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes(marker));
  expect(files.length, `no migration defines ${marker}`).toBeGreaterThan(0);
  return readFileSync(join(dir, files[files.length - 1]), 'utf8');
};

describe('the cutover timetable matches the gates', () => {
  it('names the slots every scheduler uses, in America/Chicago', () => {
    expect(T.timeZone).toBe(POLICY.timeZone);
    expect(POLICY.frequency).toBe('three-hourly');
    expect(T.slots).toEqual(POLICY.startHours);
    const dispatcher = one(
      DISPATCH,
      /THREE_HOURLY_START_HOURS = \[([0-9, ]+)\]/,
      'dispatcher slots'
    )[1];
    expect(hours(dispatcher)).toEqual(T.slots);
    const stage = one(STAGE, /HOURS = \(([0-9, ]+)\) if three_hourly/, 'Stage slots')[1];
    expect(hours(stage)).toEqual(T.slots);
    const seal = one(SEAL, /^THREE_HOURLY_START_HOURS = \(([0-9, ]+)\)$/m, 'seal slots')[1];
    expect(hours(seal)).toEqual(T.slots);
    const prequal = one(
      PREQUAL,
      /^THREE_HOURLY_START_HOURS = \(([0-9, ]+)\)$/m,
      'Backup cutoff slots'
    )[1];
    expect(hours(prequal)).toEqual(T.slots);
    expect(T.slots).toContain(T.anchorSlot);
  });

  it('Stage: reservation lookback, selection at the cutoff, and the preparation window', () => {
    const lookback = one(
      STAGE,
      /LOOKBACK = timedelta\(hours=(\d+)\) if not three_hourly else timedelta\(minutes=(\d+)\)/,
      'Stage lookback'
    );
    expect(Number(lookback[1])).toBe(T.daily.stageReservationLookbackHours);
    expect(Number(lookback[2])).toBe(T.cycle.stageReservationLookbackMinutes);
    expect(
      num(
        STAGE,
        /start = datetime\.fromtimestamp\(cycle - (\d+), timezone\.utc\)/,
        'Stage cutoff'
      ) / 60
    ).toBe(T.cycle.selectionMinutesBeforeSlot);
    expect(num(STAGE, /WINDOW_MINUTES = (\d+)\n/, 'Stage window')).toBe(
      T.cycle.preparationWindowMinutes
    );
  });

  it('Backup: the obsolete-run yield before the cutoff and the nightly refresh schedule', () => {
    expect(num(BACKUP, /"\$secs_to_cutoff" -ge (\d+) \]/, 'Backup yield')).toBe(
      T.cycle.backupYieldSecondsBeforeSelection
    );
    expect(num(BACKUP, /cutoff = start - (\d+)\n/, 'Backup cutoff') / 60).toBe(
      T.cycle.selectionMinutesBeforeSlot
    );
    const crons = [...BACKUP.matchAll(/- cron: '([0-9,]+) (\d+) \* \* \*'/g)];
    expect(crons.map((m) => Number(m[2]))).toEqual(T.daily.backupNightlyRefreshUtcHours);
    for (const m of crons) expect(hours(m[1])).toEqual(T.daily.backupNightlyRefreshMinutes);
  });

  it('Migrations: the cycle deferral, the nightly freeze, the daily guard and the applier minutes', () => {
    expect(num(DISPATCH, /THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES = (\d+);/, 'defer')).toBe(
      T.cycle.migrationDeferMinutesBeforeSlot
    );
    expect(num(DISPATCH, /THREE_HOURLY_POST_SEAL_CLEAR_MINUTE = (\d+);/, 'clear')).toBe(
      T.cycle.migrationClearMinutesAfterSlot
    );
    // O21 part 2 (2026-11-25): the windows never meet. An ordinary file installs
    // only in [S+10, S+30): 20 minutes, ending where the next slot's hold begins.
    expect(T.cycle.migrationDeferMinutesBeforeSlot).toBe(150);
    expect(
      3 * 60 - T.cycle.migrationDeferMinutesBeforeSlot - T.cycle.migrationClearMinutesAfterSlot
    ).toBe(20);
    expect(MD).toMatch(
      /\|\s*S\+30 min\s*\|\s*Ordinary migrations held again for the next slot: the install window is 20 minutes/
    );
    const freeze = one(
      DISPATCH,
      /RELEASE_SCHEMA_FREEZE_CHICAGO = \{ from: \[(\d+), (\d+)\], until: \[(\d+), (\d+)\] \}/,
      'freeze'
    )
      .slice(1)
      .map(Number);
    expect([hhmm(freeze.slice(0, 2)), hhmm(freeze.slice(2))]).toEqual(
      T.daily.releaseSchemaFreezeChicago
    );
    const guard = one(
      DISPATCH,
      /DAILY_GUARD_CHICAGO = \{ from: \[(\d+), (\d+)\], until: \[(\d+), (\d+)\] \}/,
      'daily guard'
    )
      .slice(1)
      .map(Number);
    expect([hhmm(guard.slice(0, 2)), hhmm(guard.slice(2))]).toEqual(
      T.daily.dailyMigrationGuardChicago
    );
    const applier = one(APPLIER, /\(minute >= (\d+) \|\| minute <= (\d+)\)/, 'applier minutes');
    expect(Number(applier[1])).toBe(T.hourlyUtc.applierRefusedFromMinute);
    expect(Number(applier[2])).toBe(T.hourlyUtc.applierRefusedThroughMinute);
    expect(num(DISPATCH, /FIRST_ADMITTED_MINUTE = (\d+);/, 'first admitted')).toBe(
      T.hourlyUtc.applierRefusedThroughMinute + 1
    );
    expect(num(DISPATCH, /WINDOW_OPENS_MINUTE = (\d+);/, 'window opens')).toBe(
      T.hourlyUtc.applierRefusedFromMinute
    );
  });

  it('the database break window is the newest definition of fn_ca_break_window_refuses_migrations', () => {
    const sql = governing(
      'CREATE OR REPLACE FUNCTION public.fn_ca_break_window_refuses_migrations'
    );
    expect(num(sql, /c_window_opens_minute\s+CONSTANT\s+integer\s*:=\s*(\d+);/, 'ddl opens')).toBe(
      T.hourlyUtc.ddlRefusedFromMinute
    );
    expect(
      num(sql, /c_window_closes_minute\s+CONSTANT\s+integer\s*:=\s*(\d+);/, 'ddl closes')
    ).toBe(T.hourlyUtc.ddlAdmittedFromMinute);
  });

  it('Horse switch: minute window, daily blackout and spacing', () => {
    expect(num(SWITCH, /export const WINDOW_MINUTE_MIN = (\d+);/, 'switch min')).toBe(
      T.hourlyUtc.switchWritesFromMinute
    );
    expect(num(SWITCH, /export const WINDOW_MINUTE_MAX = (\d+);/, 'switch max')).toBe(
      T.hourlyUtc.switchWritesThroughMinute
    );
    const start = one(
      SWITCH,
      /DAILY_BLACKOUT_START_UTC_MINUTES = (\d+) \* 60 \+ (\d+);/,
      'blackout start'
    )
      .slice(1)
      .map(Number);
    const end = one(
      SWITCH,
      /DAILY_BLACKOUT_END_UTC_MINUTES = (\d+) \* 60 \+ (\d+);/,
      'blackout end'
    )
      .slice(1)
      .map(Number);
    expect([hhmm(start), hhmm(end)]).toEqual(T.daily.switchBlackoutUtc);
    expect(num(SWITCH, /CROSS_LANE_SPACING_MINUTES = (\d+);/, 'cross-lane')).toBe(
      T.switchSpacing.crossLaneMinutes
    );
    expect(num(SWITCH, /SELF_LANE_SPACING_MINUTES = (\d+);/, 'self-lane')).toBe(
      T.switchSpacing.selfLaneMinutes
    );
  });

  it('the break itself: receiver admission lead, last-hand drain and break length', () => {
    expect(num(SEAL, /^ROUTINE_CYCLE_ADMISSION_LEAD_SECONDS = (\d+)$/m, 'admission lead')).toBe(
      T.cycle.receiverAdmissionLeadSeconds
    );
    expect(num(BREAK, /LAST_HAND_LEAD_MS = (\d+) \* 60 \* 1000;/, 'last hand')).toBe(
      T.cycle.lastHandLeadMinutes
    );
    expect(num(BREAK, /BREAK_DURATION_MS = (\d+) \* 60 \* 1000;/, 'break')).toBe(
      T.cycle.breakMinutes
    );
    expect(num(BREAK, /BREAK_START_MINUTE = (\d+);/, 'break start')).toBe(0);
  });

  it('the document is the rendering of the JSON (node scripts/ops/engine-cutover-timetable.mjs --write)', async () => {
    expect(MD).toContain(BEGIN);
    expect(MD).toContain(END);
    expect(documentIsCurrent(MD, T)).toBe(true);
    // Prettier's column padding (lint-staged) is not a difference; a changed cell is.
    expect(documentIsCurrent(await format(MD, { parser: 'markdown' }), T)).toBe(true);
    const shifted = { ...T, cycle: { ...T.cycle, migrationDeferMinutesBeforeSlot: 60 } };
    expect(documentIsCurrent(MD, shifted)).toBe(false);
    expect(normalizeTimetable('| a  |  b |\n| --- | :-: |')).toBe('|a|b|\n|---|---|');
    // Spot-check the rendering against the arithmetic a lane would do by hand.
    const table = renderTimetable(T);
    expect(table).toContain(
      '| 10:00 | 16:00 / 15:00 | 07:50 | 07:30-10:10 | 08:15 | 09:30 | 09:50 | 09:57 | 09:58 | 10:00-10:05 | 10:10 |'
    );
    expect(table).toContain('| 04:00 | 10:00 / 09:00 | 01:50 | 22:30-04:15 |');
  });

  it('every unenforced rule is listed as a gap with its source', () => {
    expect(T.conventions.length).toBeGreaterThan(0);
    for (const c of T.conventions) {
      for (const k of ['id', 'rule', 'source', 'enforcement', 'gap']) {
        expect(typeof c[k] === 'string' && c[k].length > 0, `${c.id ?? '?'}.${k}`).toBe(true);
      }
    }
  });
});
