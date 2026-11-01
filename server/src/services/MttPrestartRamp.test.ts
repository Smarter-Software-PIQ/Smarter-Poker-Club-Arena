/** Owner November 1: paid MTTs build a small random field from T-60;
 * free entry events build hours ahead. Capacity and funding doors stay intact. */
import { describe, it, expect } from 'vitest';
import { mttPlannedField, mttPrestartPlan } from './mttHorseArrivalPlan.js';
import {
  mttPrestartHorseTarget as recordedMttPrestartHorseTarget,
  MTT_PRESTART_RAMP_MS,
  MTT_FREEROLL_PRESTART_RAMP_MS,
  MTT_PRESTART_MAX_STEP,
  MTT_PRESTART_TICK_MS,
  MTT_PUBLISH_LEAD_MS,
} from './TournamentRecurringService.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const ID = 'ramp-fixture';
const mttPrestartHorseTarget = (
  opts: Omit<
    Parameters<typeof recordedMttPrestartHorseTarget>[0],
    'format_contract' | 'tournamentId'
  >
) =>
  recordedMttPrestartHorseTarget({
    tournamentId: ID,
    ...opts,
    format_contract:
      opts.variant === 'spin' ? 'spin-v1' : opts.variant === 'sng' ? 'sng-v1' : 'mtt-v1',
  });
const mtt = (msUntilStart: number, maxPlayers: number | null = 200, isFree = false) =>
  mttPrestartHorseTarget({
    msUntilStart,
    maxPlayers,
    variant: 'freezeout',
    currentPlayers: 0,
    isFree,
  });

/** Read the cumulative target independently of one call's bounded slice. */
function curveAt(msUntilStart: number, over: Record<string, unknown> = {}) {
  for (let current = 0; current <= 300; current++) {
    const target = mttPrestartHorseTarget({
      msUntilStart,
      maxPlayers: null,
      variant: 'freezeout',
      currentPlayers: current,
      ...over,
    });
    if (target === 0) return current;
  }
  throw new Error('A normal prestart field must remain below 300');
}

function replay(isFree = false, over: Record<string, unknown> = {}) {
  let current = 0;
  const horizon = isFree ? MTT_FREEROLL_PRESTART_RAMP_MS : MTT_PRESTART_RAMP_MS;
  const counts: number[] = [];
  for (let remaining = horizon; remaining > 0; remaining -= MTT_PRESTART_TICK_MS) {
    const target = mttPrestartHorseTarget({
      msUntilStart: remaining,
      maxPlayers: null,
      variant: 'freezeout',
      currentPlayers: current,
      isFree,
      ...over,
    });
    current = Math.max(current, target);
    counts.push(current);
  }
  return { current, counts };
}

describe('paid MTTs build a small field from an hour before start', () => {
  it('opens the ordinary window at T-60, not T-10', () => {
    expect(MTT_PRESTART_RAMP_MS).toBe(HOUR);
    expect(mtt(HOUR + 1)).toBe(0);
    expect(mtt(2 * HOUR)).toBe(0);
    expect(mtt(HOUR)).toBeGreaterThanOrEqual(3);
    expect(mtt(HOUR)).toBeLessThanOrEqual(7);
    expect(mtt(30 * MIN)).toBeGreaterThan(0);
    expect(mtt(11 * MIN)).toBeGreaterThan(0);
  });

  it('trickles progressively closer to start instead of buying a hundred seats', () => {
    const opening = curveAt(HOUR);
    const halfway = curveAt(30 * MIN);
    const closing = curveAt(1);
    expect(opening).toBeGreaterThanOrEqual(3);
    expect(opening).toBeLessThanOrEqual(7);
    expect(halfway).toBeGreaterThanOrEqual(opening);
    expect(closing).toBeGreaterThan(halfway);
    expect(closing).toBeGreaterThanOrEqual(32);
    expect(closing).toBeLessThanOrEqual(48);
    let previous = 0;
    for (let minute = 60; minute > 0; minute--) {
      const next = curveAt(minute * MIN);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });

  it('cannot turn a huge guarantee into a hundred prestart purchases', () => {
    for (const guaranteedPrize of [0, 500, 20_000, 5_000_000]) {
      const { current, counts } = replay(false, { guaranteedPrize, buyInPrizeShare: 1 });
      expect(current).toBeGreaterThanOrEqual(32);
      expect(current).toBeLessThanOrEqual(48);
      expect(counts.every((count) => count < 100)).toBe(true);
    }
  });

  it('uses the same small prestart choice despite different guarantees', () => {
    const ordinary = replay(false, { guaranteedPrize: 0, buyInPrizeShare: 5 });
    const guaranteed = replay(false, { guaranteedPrize: 1_000_000, buyInPrizeShare: 5 });
    expect(ordinary.current).toBe(guaranteed.current);
    expect(ordinary.current).toBe(mttPrestartPlan(mttPlannedField(0, 5, ID), null, ID));
  });

  it('does not mistake a zero net prize share for a free entry', () => {
    expect(
      mttPrestartHorseTarget({
        msUntilStart: 2 * HOUR,
        maxPlayers: null,
        variant: 'bounty',
        guaranteedPrize: 500,
        buyInPrizeShare: 0,
        isFree: false,
      })
    ).toBe(0);
  });

  it('publishes the recurring board early enough for its one-hour opening group', () => {
    expect(MTT_PUBLISH_LEAD_MS).toBeGreaterThanOrEqual(HOUR);
  });
});

describe('free entry MTTs build hours ahead', () => {
  it('uses a separate day-long horizon and is populated hours from start', () => {
    expect(MTT_FREEROLL_PRESTART_RAMP_MS).toBe(24 * HOUR);
    expect(mtt(24 * HOUR + 1, null, true)).toBe(0);
    for (const remaining of [24 * HOUR, 4 * HOUR, 2 * HOUR]) {
      expect(mtt(remaining, null, true)).toBeGreaterThan(0);
    }
    expect(mtt(4 * HOUR, null, false)).toBe(0);
  });

  it('keeps the free field increasing through the hours before start', () => {
    let previous = 0;
    for (let remaining = 24 * HOUR; remaining > 0; remaining -= 10 * MIN) {
      const next = curveAt(remaining, { isFree: true, guaranteedPrize: 250, buyInPrizeShare: 0 });
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    const plan = mttPrestartPlan(mttPlannedField(250, 0, ID), null, ID, true);
    expect(replay(true, { guaranteedPrize: 250, buyInPrizeShare: 0 }).current).toBe(plan);
    expect(previous).toBeGreaterThan(curveAt(24 * HOUR, { isFree: true }));
  });
});

describe('prestart clock, format and capacity safety', () => {
  it('does nothing at or after start, or on a non-finite clock', () => {
    for (const remaining of [0, -MIN, NaN, Infinity]) {
      expect(mtt(remaining)).toBe(0);
      expect(mtt(remaining, null, true)).toBe(0);
    }
  });

  it('always leaves a published seat and never launches a finite event early', () => {
    for (const maxPlayers of [3, 4, 6, 9, 18, 60, 200]) {
      for (const msUntilStart of [HOUR, 30 * MIN, MIN, 1]) {
        expect(mtt(msUntilStart, maxPlayers)).toBeLessThanOrEqual(maxPlayers - 1);
        expect(mtt(msUntilStart, maxPlayers, true)).toBeLessThanOrEqual(maxPlayers - 1);
        for (const isFree of [false, true]) {
          expect(
            mttPrestartHorseTarget({
              msUntilStart,
              maxPlayers,
              variant: 'freezeout',
              isFree,
              currentPlayers: maxPlayers - 1,
            })
          ).toBe(0);
        }
      }
    }
    for (const capacity of [0, 1]) expect(mtt(MIN, capacity)).toBe(0);
  });

  it('leaves bought-seat formats alone, including free ones', () => {
    for (const variant of ['spin', 'sng']) {
      for (const isFree of [false, true])
        expect(
          mttPrestartHorseTarget({
            msUntilStart: MIN,
            maxPlayers: 3,
            variant,
            isFree,
            guaranteedPrize: 5000,
          })
        ).toBe(0);
    }
  });

  it('includes each registration-first bounty format', () => {
    for (const variant of ['freezeout', 'progressive_bounty', 'mystery_bounty', 'bounty']) {
      expect(
        mttPrestartHorseTarget({
          msUntilStart: 30 * MIN,
          maxPlayers: null,
          variant,
        })
      ).toBeGreaterThan(0);
    }
  });

  it('takes bounded slices even when the field is behind near the start', () => {
    for (const guaranteedPrize of [0, 5000, 5_000_000]) {
      for (const msUntilStart of [HOUR, 30 * MIN, MIN, 1])
        expect(
          mttPrestartHorseTarget({
            msUntilStart,
            maxPlayers: null,
            variant: 'freezeout',
            currentPlayers: 0,
            guaranteedPrize,
            buyInPrizeShare: 1,
          })
        ).toBeLessThanOrEqual(MTT_PRESTART_MAX_STEP);
    }
  });

  it('does not add entrants once humans have passed the curve', () => {
    expect(
      mttPrestartHorseTarget({
        msUntilStart: 30 * MIN,
        maxPlayers: null,
        variant: 'freezeout',
        currentPlayers: 100,
      })
    ).toBe(0);
  });

  it('tolerates a negative cached count without an oversized request', () => {
    const target = mttPrestartHorseTarget({
      msUntilStart: 30 * MIN,
      maxPlayers: null,
      variant: 'freezeout',
      currentPlayers: -5,
    });
    expect(target).toBeGreaterThan(0);
    expect(target).toBeLessThanOrEqual(MTT_PRESTART_MAX_STEP);
  });

  it('honors the persisted MTT contract despite stale SNG spelling', () => {
    expect(
      recordedMttPrestartHorseTarget({
        tournamentId: ID,
        msUntilStart: 30 * MIN,
        maxPlayers: null,
        format_contract: 'mtt-v1',
        variant: 'sng',
        currentPlayers: 0,
      })
    ).toBeGreaterThan(0);
    expect(() =>
      recordedMttPrestartHorseTarget({
        tournamentId: ID,
        msUntilStart: MIN,
        maxPlayers: null,
        format_contract: null,
        variant: 'mtt',
      })
    ).toThrow('TOURNAMENT_FORMAT_CONTRACT_INVALID');
  });
});
