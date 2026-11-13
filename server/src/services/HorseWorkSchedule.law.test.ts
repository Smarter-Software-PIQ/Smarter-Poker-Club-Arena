/**
 * A HORSE KEEPS ITS WORK SCHEDULE AND ITS DAYS OFF (owner 2026-11-12).
 * "HORSES MUST BE FOLLOWING THERE 'DAILY WORK SCHEDULE' AND ALSO THERE DAYS
 * OFF. MAKE SURE THIS IS FULLY FOLLOWED AND IMPLEMENTED."
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { offDutyExitNow, offDutyReason, onDuty } from './HorseWorkSchedule.js';
import { availableNow } from './HorseRegulars.js';
import { planHorseQueues } from './HorseGameQueue.js';
import type { HorseState } from './StableHandTags.js';

const TODAY = '2026-11-12';
const THURSDAY = 4; // Sunday-first, chicagoNow().weekday
const NOW = Date.parse('2026-11-12T17:00:00Z');

function state(over: Partial<HorseState> = {}): HorseState {
  return {
    horseId: 'h',
    restWeekday: null,
    dailyCapMinutes: 600,
    minutesPlayedToday: 0,
    sessionStartBalance: null,
    cashSitsToday: {},
    twoHourWindow: {},
    countersResetOn: TODAY,
    ...over,
  };
}

/** A horse id inside / outside its work hours at NOW, found deterministically. */
function horseWhere(on: boolean): string {
  for (let i = 0; i < 5000; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    if (availableNow(id, NOW) === on) return id;
  }
  throw new Error('no horse found');
}
const working = horseWhere(true);
const offShift = horseWhere(false);

describe('the work schedule decides who may hold a cash seat', () => {
  it('a working horse on a normal day is on duty', () => {
    expect(offDutyReason(working, state(), NOW, THURSDAY, TODAY)).toBeNull();
    expect(onDuty(working, state(), NOW, THURSDAY, TODAY)).toBe(true);
  });
  it('its rest day takes it off, whatever its hours', () => {
    expect(offDutyReason(working, state({ restWeekday: THURSDAY }), NOW, THURSDAY, TODAY)).toBe(
      'rest_day'
    );
    expect(offDutyReason(working, state({ restWeekday: 3 }), NOW, THURSDAY, TODAY)).toBeNull();
  });
  it('a played-out daily cap takes it off; yesterday`s counter does not', () => {
    const capped = state({ dailyCapMinutes: 300, minutesPlayedToday: 300 });
    expect(offDutyReason(working, capped, NOW, THURSDAY, TODAY)).toBe('daily_cap');
    expect(
      offDutyReason(working, { ...capped, countersResetOn: '2026-11-11' }, NOW, THURSDAY, TODAY)
    ).toBeNull();
  });
  it('outside its work hours it is off shift, even with no state row', () => {
    expect(offDutyReason(offShift, state(), NOW, THURSDAY, TODAY)).toBe('off_shift');
    expect(offDutyReason(offShift, undefined, NOW, THURSDAY, TODAY)).toBe('off_shift');
  });
  it('a missing state row is not a rest day and not a played-out cap', () => {
    expect(offDutyReason(working, undefined, NOW, THURSDAY, TODAY)).toBeNull();
  });
});

describe('every path obeys it: no waiver, no widening', () => {
  const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
  const rotator = readFileSync(new URL('./HorseSessionRotator.ts', import.meta.url), 'utf8');
  const tourney = readFileSync(new URL('./TournamentRecurringService.ts', import.meta.url), 'utf8');
  it('seating never waives the rest day or the daily cap for a person short at a table', () => {
    expect(fleet).not.toContain('!humanNeedsRescue && isRestDayFor');
    expect(fleet).not.toContain('!humanNeedsRescue && dailyCapReached');
    expect(fleet).toContain('if (isRestDayFor(st, chicagoWeekday)) {');
    expect(fleet).toContain('if (dailyCapReached(st, todayKey)) {');
  });
  it('seating never widens the work hours (rescue, PLO Lightning, opening feeder, dealable minimum)', () => {
    expect(fleet).toContain(
      'const pool = sittable.filter((h) => availableNow(h.id, regularsNowMs));'
    );
    expect(fleet).not.toMatch(/\bpool = sittable;/);
    expect(fleet).not.toContain('ploActivityPool');
  });
  it('an off-duty horse does not answer a seat call', () => {
    expect(fleet).toMatch(
      /if \(!dutyOk\(String\(offer\.user_id\)\)\) \{\s*recordSeatCallDeclined\(\);\s*continue;/
    );
  });
  it('the rotator sends an off-duty cash horse home through the ordinary leave door', () => {
    expect(rotator).toContain(
      'offDutyReason(uid, dutyBook?.states.get(uid), dutyNowMs, dutyWeekday, dutyToday)'
    );
    // Cash seats only: a tournament seat is never sent home by the schedule.
    expect(rotator).toMatch(
      /const dutyReason =\s*t\?\.tournament_id == null\s*\?\s*offDutyReason\(/
    );
    // HIT AND RUN and the big-pot orbit decide WHEN, never WHETHER.
    expect(rotator).toMatch(
      /owesHandsOrOrbit:\s*this\.owesHands\(tableId, uid, engine\) \|\| this\.owesBigPotOrbit\(uid, engine\)/
    );
  });
  it('one off-duty exit per table per cycle, never leaving a person short (2026-11-13)', () => {
    const base = {
      offDutyLeftHereThisCycle: 0,
      playingHumansHere: 0,
      seatedHere: 6,
      personFloor: 4,
      owesHandsOrOrbit: false,
    };
    expect(offDutyExitNow(base)).toBe(true);
    // A second off-duty exit at the same table waits for the next cycle.
    expect(offDutyExitNow({ ...base, offDutyLeftHereThisCycle: 1 })).toBe(false);
    // A person playing at a table that would drop below four keeps the horse.
    expect(offDutyExitNow({ ...base, playingHumansHere: 1, seatedHere: 4 })).toBe(false);
    expect(offDutyExitNow({ ...base, playingHumansHere: 1, seatedHere: 5 })).toBe(true);
    expect(offDutyExitNow({ ...base, playingHumansHere: 1, seatedHere: 2 })).toBe(false);
    // Horse-only tables may thin; HIT AND RUN and the orbit still decide when.
    expect(offDutyExitNow({ ...base, seatedHere: 2 })).toBe(true);
    expect(offDutyExitNow({ ...base, owesHandsOrOrbit: true })).toBe(false);
    // The rotator asks it, counts each exit and each seat it frees.
    expect(rotator).toMatch(/onlyOffDuty &&\s*!offDutyExitNow\(\{/);
    expect(rotator).toMatch(/personFloor: NIGHT_MIN_PLAYERS,/);
    expect(rotator).toMatch(
      /if \(onlyOffDuty\) \{\s*offDutyLeftHere\+\+;\s*offDutyExitTables\.add\(tableId\);\s*\}\s*seatedHere--;/
    );
    // The ordinary session end does not thin the same table in the same cycle,
    // unless a person is waiting for the seat.
    expect(rotator).toMatch(
      /if \(releaseWanted === 0 && offDutyExitTables\.has\(tableId\)\) continue;/
    );
  });
  it('no new tournament registration on a rest day, ticket or not', () => {
    const rest = tourney.indexOf('if (isRestDayFor(restBook?.states.get(h.id), restWeekday)) {');
    expect(rest).toBeGreaterThan(-1);
    // Before the ticket shortcut: a ticket does not buy a day off back.
    expect(rest).toBeLessThan(tourney.indexOf('if (ticketHintIds.has(h.id)) return true;'));
  });
});

describe('an off-duty horse leaves every waiting list', () => {
  it('its row is cancelled and it is not kept in line', () => {
    const plan = planHorseQueues({
      asks: [],
      tables: [{ gameId: 'g', maxPlayers: 6, seated: 6 }],
      rows: [
        {
          id: 'r-off',
          game_id: 'g',
          user_id: 'off',
          created_at: new Date(NOW - 60_000).toISOString(),
        },
        {
          id: 'r-on',
          game_id: 'g',
          user_id: 'on',
          created_at: new Date(NOW - 60_000).toISOString(),
        },
      ],
      excludedGameIds: new Set(),
      humanWaitingGameIds: new Set(),
      seatedByGame: new Map(),
      nowMs: NOW,
      onDuty: (id) => id !== 'off',
    });
    expect(plan.cancel).toContain('r-off');
    expect(plan.cancel).not.toContain('r-on');
  });
});

describe('the schedule is visible on /health (owner 2026-11-12)', () => {
  it('counts leaves by reason, deferrals, declined calls, cancelled rows and the last census', async () => {
    const m = await import('./HorseWorkSchedule.js');
    m.resetHorseWorkScheduleEvidenceForTests();
    m.recordOffDutyLeave('rest_day');
    m.recordOffDutyLeave('off_shift');
    m.recordOffDutyLeave('off_shift');
    m.recordOffDutyDeferred();
    m.recordSeatCallDeclined();
    m.recordListRowCancelled();
    m.recordListRowCancelled();
    m.recordScheduleCycle(
      { rest_day: 3, daily_cap: 1, asleep: 9 },
      [{ hostId: 'host-a', eligible: 400, onDuty: 250, target: 96 }],
      NOW
    );
    const e = m.horseWorkScheduleEvidence();
    expect(e.offDutyLeaves).toEqual({ rest_day: 1, daily_cap: 0, off_shift: 2 });
    expect(e.offDutyLeavesDeferred).toBe(1);
    expect(e.seatCallsDeclined).toBe(1);
    expect(e.listRowsCancelled).toBe(2);
    expect(e.lastCycle).toEqual({
      at: new Date(NOW).toISOString(),
      seatingRefused: { rest_day: 3, daily_cap: 1, asleep: 9 },
      supply: [{ hostId: 'host-a', eligible: 400, onDuty: 250, target: 96 }],
    });
    // An unknown reason is ignored, never a new key.
    m.recordOffDutyLeave('nonsense' as never);
    expect(Object.keys(m.horseWorkScheduleEvidence().offDutyLeaves)).toEqual([
      'rest_day',
      'daily_cap',
      'off_shift',
    ]);
    m.resetHorseWorkScheduleEvidenceForTests();
    expect(m.horseWorkScheduleEvidence().lastCycle).toBeNull();
  });

  it('every recording site is wired, and /health serves it', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    const rotator = readFileSync(new URL('./HorseSessionRotator.ts', import.meta.url), 'utf8');
    const health = readFileSync(new URL('../handlers/health.ts', import.meta.url), 'utf8');
    expect(rotator).toContain('recordOffDutyLeave(dutyReason);');
    expect(rotator).toMatch(/recordOffDutyDeferred\(\);\s*continue;/);
    expect(fleet).toMatch(
      /if \(!dutyOk\(String\(offer\.user_id\)\)\) \{\s*recordSeatCallDeclined\(\);/
    );
    expect(fleet).toContain('if (!ok) recordListRowCancelled();');
    expect(fleet).toMatch(
      /recordScheduleCycle\(\s*\{ rest_day: restDayDropped, daily_cap: dailyCapDropped, asleep: asleepDropped \},\s*scheduleSupply\s*\);/
    );
    expect(fleet).toContain('target: stableHandCaps.get(hostId) ?? null,');
    expect(health).toContain('horseWorkSchedule: horseWorkScheduleEvidence(),');
  });
});

describe('a table in its post-human dwell is filled from the next stake too (owner 2026-11-12)', () => {
  const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
  it('only a short table inside its dwell, with no human seated, qualifies', () => {
    expect(fleet).toMatch(
      /const dwellNeedsHorses =\s*!humanAtTable &&\s*currentCount < 4 &&\s*withinHumanDepartureDwellFor\(table, Date\.now\(\)\);/
    );
  });
  it('it waives only the preferred-stake tag; work hours, days off, variant and band still apply', () => {
    expect(fleet).toContain('if (stakeOk === false && !humanNeedsRescue && !dwellNeedsHorses) {');
    expect(fleet).not.toMatch(/variantOk === false && [^\n]*dwellNeedsHorses/);
    expect(fleet).toContain('if (isRestDayFor(st, chicagoWeekday)) {');
    expect(fleet).toContain('if (dailyCapReached(st, todayKey)) {');
    expect(fleet).toContain(
      'const pool = sittable.filter((h) => availableNow(h.id, regularsNowMs));'
    );
    expect(fleet).toMatch(/stakeOk === undefined &&\s*!stakeBandAllows\(/);
    // dwellNeedsHorses appears exactly where it is declared and where it waives.
    expect(fleet.match(/dwellNeedsHorses/g)?.length).toBe(2);
  });
});
