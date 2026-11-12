import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HORSE_CASH_POLICY_START_MS as start,
  RELAUNCH_CASH_POLICY_START_MS as relaunch,
  RELAUNCHED_CASH_ACTIVITY_SCALE,
  REDUCED_CASH_ACTIVITY_SCALE,
  cashActivityScaleAt,
  horseCashGameAllowed,
} from './HorseCashSchedule.js';
import { curvePctAt, occupancyTargetForHost } from './StableHand.js';
import { chicagoNow, stableHandHostCaps } from './StableHandController.js';

describe('November 2 owner cash schedule', () => {
  it('activates at midnight Chicago after the DST change, with no early reduction', () => {
    expect(chicagoNow(new Date(start))).toMatchObject({
      hour: 0,
      minute: 0,
      cashActivityScale: 0.2,
    });
    expect(cashActivityScaleAt(start - 1)).toBe(0.5);
    expect(cashActivityScaleAt(start)).toBe(0.2);
    expect(cashActivityScaleAt(relaunch - 1)).toBe(0.2);
  });
  it('triples the reduced rate at the November 11 relaunch (owner: "TRIPLE THE CURRENT RATE")', () => {
    expect(relaunch).toBe(Date.parse('2026-11-12T00:00:00Z'));
    expect(RELAUNCHED_CASH_ACTIVITY_SCALE).toBeCloseTo(REDUCED_CASH_ACTIVITY_SCALE * 3, 12);
    expect(cashActivityScaleAt(relaunch)).toBeCloseTo(0.6, 12);
    expect(cashActivityScaleAt(relaunch + 365 * 86400000)).toBeCloseTo(0.6, 12);
  });
  it('retains exactly 40% of the current unrounded daily curve at every minute', () => {
    let before = 0,
      after = 0;
    for (let hour = 0; hour < 24; hour++)
      for (let minute = 0; minute < 60; minute++) {
        const previous = curvePctAt(hour, minute, cashActivityScaleAt(start - 1));
        const next = curvePctAt(hour, minute, cashActivityScaleAt(start));
        expect(next).toBeCloseTo(previous * 0.4, 12);
        before += previous;
        after += next;
        const cap = occupancyTargetForHost(1000, hour, minute, 0.2);
        expect(cap.max).toBeLessThanOrEqual(hour >= 3 && hour < 8 ? 10 : 80);
      }
    expect(after / before).toBeCloseTo(0.4, 12);
    expect(
      stableHandHostCaps(
        new Map([['host', 1000]]),
        chicagoNow(new Date('2026-11-03T00:00:00Z'))
      ).get('host')
    ).toBe(80);
  });
  it.each(['pineapple', 'crazy_pineapple', 'short_deck', 'shortdeck', '6+', 'plo8'])(
    'excludes all %s cash, preserving tournaments and the previous date',
    (variant) => {
      const table = { game_variant: variant, small_blind: 0.25, big_blind: 0.5 };
      expect(horseCashGameAllowed(table, start - 1)).toBe(true);
      expect(horseCashGameAllowed(table, start)).toBe(false);
      expect(horseCashGameAllowed({ ...table, tournament_id: 'event' }, start)).toBe(true);
    }
  );
  it.each(['plo4', 'plo5', 'plo6', 'nlh', 'flh', 'flo8', 'stud', 'unknown'])(
    'enforces the owner-selected actual-blind ceiling for %s',
    (variant) => {
      for (const [sb, bb, allowed] of [
        [0.25, 0.5, true],
        [0.5, 1, true],
        [1, 2, !['stud', 'unknown'].includes(variant)],
        [2, 5, ['flh', 'flo8'].includes(variant)],
        [5, 10, ['flh', 'flo8'].includes(variant)],
        [1, 1, !['stud', 'unknown'].includes(variant)],
        [5.01, 10, false],
        [5, 10.01, false],
      ] as const) {
        expect(
          horseCashGameAllowed({ game_variant: variant, small_blind: sb, big_blind: bb }, start)
        ).toBe(allowed);
      }
      expect(horseCashGameAllowed({ game_variant: variant, big_blind: null }, start)).toBe(false);
    }
  );
  it('requires known valid blinds for every cash variant, preserving tournaments', () => {
    for (const game_variant of ['nlh', 'plo4', 'flo8']) {
      for (const [small_blind, big_blind] of [
        [null, 1],
        [0.5, null],
        [undefined, 1],
        [0.5, undefined],
        [NaN, 1],
        [0.5, Infinity],
        [-0.5, 1],
        [0.5, 0],
      ]) {
        const table = { game_variant, small_blind, big_blind };
        expect(horseCashGameAllowed(table, start)).toBe(false);
        expect(horseCashGameAllowed(table, start - 1)).toBe(true);
        expect(horseCashGameAllowed({ ...table, tournament_id: 'event' }, start)).toBe(true);
      }
      expect(
        horseCashGameAllowed({ game_variant, small_blind: '0.50', big_blind: '1.00' }, start)
      ).toBe(true);
    }
  });
  it('wires eligibility before seeding and into the existing safe leave door', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    const rotator = readFileSync(new URL('./HorseSessionRotator.ts', import.meta.url), 'utf8');
    const snapshot = readFileSync(new URL('./StableHandSnapshot.ts', import.meta.url), 'utf8');
    expect(fleet).toContain('!horseCashGameAllowed(table, Date.now())');
    expect(rotator).toContain(
      'const restrictedCashGame = !horseCashGameAllowed(t ?? {}, Date.now());'
    );
    expect(rotator).toContain('!offGame && !restrictedCashGame && !outsideCashPlan && !offDuty)');
    expect(rotator).toContain('await engine.leaveTable(uid)');
    expect(snapshot).toContain('cashActivityScale: now.cashActivityScale');
  });
});
