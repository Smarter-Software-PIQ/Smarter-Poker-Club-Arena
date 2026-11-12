/**
 * A HORSE KEEPS ITS WORK SCHEDULE AND ITS DAYS OFF (owner 2026-11-12).
 * "HORSES MUST BE FOLLOWING THERE 'DAILY WORK SCHEDULE' AND ALSO THERE DAYS
 * OFF. MAKE SURE THIS IS FULLY FOLLOWED AND IMPLEMENTED."
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { offDutyReason, onDuty } from './HorseWorkSchedule.js';
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
    expect(fleet).toContain('if (!dutyOk(String(offer.user_id))) continue;');
  });
  it('the rotator sends an off-duty cash horse home through the ordinary leave door', () => {
    expect(rotator).toContain(
      'offDutyReason(uid, dutyBook?.states.get(uid), dutyNowMs, dutyWeekday, dutyToday)'
    );
    expect(rotator).toContain('t?.tournament_id == null &&');
    // HIT AND RUN and the big-pot orbit decide WHEN, never WHETHER.
    expect(rotator).toContain(
      '(this.owesHands(tableId, uid, engine) || this.owesBigPotOrbit(uid, engine))'
    );
  });
  it('no new tournament registration on a rest day', () => {
    expect(tourney).toContain('!isRestDayFor(restBook?.states.get(h.id), restWeekday);');
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
