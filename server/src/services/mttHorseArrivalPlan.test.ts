import { describe, expect, it } from 'vitest';
import {
  mttLevelWindowMs,
  mttPlannedField,
  mttPrestartPlan,
  mttPrizeShare,
} from './mttHorseArrivalPlan.js';
import { mttPrestartHorseTarget, MTT_PRESTART_TICK_MS } from './TournamentRecurringService.js';
import { lateRegArrivalsFor } from './HorseOverlayGuard.js';

const MIN = 60_000;
function beforeStart(
  guarantee: number,
  prize: number,
  maxPlayers: number | null = null,
  tournamentId = 'arrival-test',
  free = prize === 0
) {
  let current = 0;
  for (let remaining = (free ? 360 : 60) * MIN; remaining > 0; remaining -= MTT_PRESTART_TICK_MS) {
    const target = mttPrestartHorseTarget({
      tournamentId,
      isFree: free,
      msUntilStart: remaining,
      maxPlayers,
      format_contract: 'mtt-v2',
      variant: 'freezeout',
      currentPlayers: current,
      guaranteedPrize: guarantee,
      buyInPrizeShare: prize,
      prizePool: guarantee,
    });
    current = Math.max(current, target);
  }
  return current;
}

describe('varied prestart fields and arrivals throughout late registration', () => {
  it.each([
    [5000, 36],
    [1000, 6.5],
    [50000, 90],
    [0, 0],
  ])(
    "delivers this event's stable random prestart plan for %s at %s per entry",
    (guarantee, share) => {
      const id = 'arrival-test';
      const field = mttPlannedField(guarantee, share, id);
      const expected = mttPrestartPlan(field, null, id, share === 0);
      expect(beforeStart(guarantee, share, null, id)).toBe(expected);
      if (share > 0) {
        expect(expected).toBeGreaterThanOrEqual(12);
        expect(expected).toBeLessThanOrEqual(28);
      } else {
        expect(expected).toBeGreaterThanOrEqual(field * 0.4);
        expect(expected).toBeLessThanOrEqual(Math.ceil(field * 0.6));
      }
    }
  );
  it('retains capped entry room while keeping regular opening fields small', () => {
    for (const cap of [9, 40]) {
      const plan = mttPrestartPlan(139, cap, 'capped');
      expect(plan).toBeGreaterThan(0);
      expect(plan).toBeLessThan(cap);
      expect(plan).toBeLessThanOrEqual(28);
      expect(beforeStart(5000, 36, cap, 'capped')).toBe(plan);
    }
    expect(mttPrestartPlan(48, 1, 'capped')).toBe(0);
  });
  it('shows only a handful an hour ahead and no hundred-player regular opening field', () => {
    const base = {
      tournamentId: 'regular-billion-guarantee',
      maxPlayers: null,
      format_contract: 'mtt-v2',
      variant: 'freezeout',
      guaranteedPrize: 1_000_000,
      buyInPrizeShare: 2.5,
      currentPlayers: 0,
    };
    const opening = mttPrestartHorseTarget({ ...base, msUntilStart: 60 * MIN });
    expect(opening).toBeGreaterThanOrEqual(3);
    expect(opening).toBeLessThanOrEqual(7);
    expect(beforeStart(1_000_000, 2.5)).toBeLessThanOrEqual(28);
    expect(
      mttPrestartHorseTarget({
        ...base,
        isFree: true,
        buyInPrizeShare: 0,
        msUntilStart: 3 * 60 * MIN,
      })
    ).toBeGreaterThan(0);
  });

  it.each([20, 25])(
    'paces only remaining capped seats when %s entered before the start',
    (atStart) => {
      let late = 0;
      const arrivalMinutes: number[] = [];
      for (let minute = 0; minute < 80; minute += 2) {
        const n = lateRegArrivalsFor({
          tournament_id: 'capped',
          startedAtMs: 0,
          nowMs: minute * MIN,
          lateRegMins: 80,
          lateRegLevels: 10,
          currentLevel: 0,
          plannedField: 139,
          maxPlayers: 40,
          entriesAtStart: atStart,
          lateEntries: late,
        });
        late += n;
        if (n) arrivalMinutes.push(minute);
        expect(atStart + late).toBeLessThanOrEqual(40);
      }
      expect(late).toBe(40 - atStart);
      expect(arrivalMinutes.some((minute) => minute > 60)).toBe(true);
    }
  );
  it('subtracts the bounty head, not just the fee', () => {
    expect(mttPrizeShare({ buy_in_amount: '13.50', bounty_amount: '7.00' })).toBe(6.5);
    expect(mttPlannedField(1000, 6.5, 'bounty')).toBeGreaterThanOrEqual(154);
  });
  it('reads the real stored JSON ladder and seconds-shaped ladders', () => {
    expect(
      mttLevelWindowMs(
        JSON.stringify(Array.from({ length: 10 }, () => ({ durationMinutes: 8 }))),
        10
      )
    ).toBe(80 * MIN);
    expect(mttLevelWindowMs([{ duration: 60 }, { duration: 120 }], 2)).toBe(3 * MIN);
    expect(mttLevelWindowMs('bad', 2)).toBeUndefined();
    expect(mttLevelWindowMs([{ duration: 60 }], 2)).toBeUndefined();
  });
  it('trickles the remaining planned entries across the entire 48-minute mystery window', () => {
    let late = 0;
    const arrivals: number[] = [];
    for (let minute = 0; minute < 48; minute += 2) {
      const n = lateRegArrivalsFor({
        tournament_id: 'mystery',
        startedAtMs: 0,
        nowMs: minute * MIN,
        lateRegMins: 48,
        lateRegLevels: 6,
        currentLevel: 0,
        levelWindowMs: 48 * MIN,
        plannedField: 154,
        entriesAtStart: 77,
        lateEntries: late,
      });
      expect(n).toBeLessThanOrEqual(6);
      late += n;
      if (n) arrivals.push(minute);
    }
    expect(late).toBeGreaterThanOrEqual(70);
    expect(late).toBeLessThanOrEqual(77);
    expect(arrivals.some((minute) => minute > 40)).toBe(true);
  });
  it('continues the level-only freezeout even when current_level remains zero', () => {
    expect(
      lateRegArrivalsFor({
        tournament_id: 'freezeout',
        startedAtMs: 0,
        nowMs: 20 * MIN,
        lateRegMins: 0,
        lateRegLevels: 10,
        currentLevel: 0,
        levelWindowMs: 80 * MIN,
        plannedField: 139,
        entriesAtStart: 70,
        lateEntries: 0,
      })
    ).toBeGreaterThan(0);
  });
  it('keeps bounded arrivals after pauses while the actual DB door remains open', () => {
    const paused = {
      tournament_id: 'paused-mystery',
      startedAtMs: 0,
      nowMs: 60 * MIN,
      lateRegMins: 0,
      lateRegLevels: 6,
      currentLevel: 5,
      levelWindowMs: 48 * MIN,
      plannedField: 154,
      entriesAtStart: 77,
      lateEntries: 1,
    };
    expect(lateRegArrivalsFor({ ...paused, registrationOpen: true })).toBeGreaterThan(0);
    expect(lateRegArrivalsFor({ ...paused, registrationOpen: true })).toBeLessThanOrEqual(6);
    expect(lateRegArrivalsFor({ ...paused, registrationOpen: false })).toBe(0);
    expect(lateRegArrivalsFor(paused)).toBe(0);
    expect(lateRegArrivalsFor({ ...paused, registrationOpen: true, lateEntries: 77 })).toBe(0);
  });
  it('never opens purchases early or after late registration closes', () => {
    expect(
      mttPrestartHorseTarget({
        tournamentId: 'closed',
        msUntilStart: 61 * MIN,
        maxPlayers: null,
        format_contract: 'mtt-v2',
        variant: 'freezeout',
        guaranteedPrize: 5000,
        buyInPrizeShare: 36,
      })
    ).toBe(0);
    expect(
      lateRegArrivalsFor({
        tournament_id: 'closed',
        startedAtMs: 0,
        nowMs: 48 * MIN,
        lateRegMins: 48,
        lateRegLevels: 0,
        currentLevel: 0,
        entriesAtStart: 77,
        lateEntries: 0,
      })
    ).toBe(0);
  });
});
