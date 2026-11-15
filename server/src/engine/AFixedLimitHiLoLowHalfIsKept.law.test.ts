/**
 * LAW: A FIXED-LIMIT HI-LO LOW HALF IS KEPT UNDER THE WEAK-HIGH CAP
 * (2026-11-14, Fixed-Limit lane; HorseDecideOpts.fixedLimitHiLoLowHalfFloor,
 * default OFF).
 *
 * The V40 Omaha pressure cap is a ceiling for a weak HIGH hand (pair 0.28,
 * two pair 0.30 to 0.36, less 0.05 per point of heat). In hi-lo it clipped
 * the whole pot share, low half included, and the low-half floor
 * (HorseHiLoLowHalf.ts, HU-HILO-001) excluded fixed limit and multiway pots.
 * A better high hand cannot take the low half in any field. Measured in flo8
 * six-handed: pair-plus-low and high-plus-low river hands with a low half of
 * 0.46 and 0.59 were capped to 0.10 and 0.13 at a price of 0.05 and folded.
 *
 * Law, with the option on: on a fixed-limit hi-lo river the cap never goes
 * below half of the hand's sampled low share, heads-up and multiway; the
 * share carries ties, so a quartered low keeps a quarter. Earlier streets and
 * pot-limit multiway pots keep the ceiling as it was.
 *
 * No double counting: the low share and the joint pot share come from the
 * same sampler pass (HorseEval simulateEquity), and the capped share is
 * min(joint, max(0.08, cap, 0.5 x low share)) (hiLoCappedRiverShare): never
 * above the uncapped joint share, never below 0.5 x low share. Pinned on the
 * sampler's own output for a scoop, a nut low with no high, a quartered nut
 * low (heads-up and three-way) and a board with no low, the opponents' cards
 * fixed by leaving only their cards in the deck.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { hiLoCappedRiverShare, hiLoRiverLowHalfFloor } from './HorseHiLoLowHalf.js';
import { seedFastRandom, simulateEquity, variantInfo, type HiLoSplit } from './HorseEval.js';
import { cards } from './HuVariantSpot.test-support.js';
import type { Card } from '../types.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { decideSpot, fixedLimitRiverFacingOneBet } from './FixedLimitRiverCallSpot.test-support.js';

const ON = { fixedLimitHiLoLowHalfFloor: true } as const;
const BOARD = 'Kd Qs 7c 4h 3d';
const BETTOR_SET = 'Kc Kh Js Ts';
const CALLER = 'Qc Qh 8d 6d';
// Hero is seat 1 (the button); seat 2 bets every street.
const HERO_HANDS = ['Ac 2d 9h 9s', 'Ac 2d 9h Ts', 'Ac 2d Jh 5s'];

afterEach(() => HorseMind.reset());

const RANKS = '23456789TJQKA';
const ALL: Card[] = cards(
  [...RANKS].flatMap((r) => ['c', 'd', 'h', 's'].map((u) => r + u)).join(' ')
);
const key = (c: Card) => c.rank + c.suit;

/** The sampler's joint share and low share against fixed opponents: every
 *  card but the hero's, the board's and the opponents' is dead, so each
 *  iteration deals the opponents exactly their cards. */
function sampled(hero: string, board: string, opponents: string[]) {
  const live = new Set([hero, board, ...opponents].flatMap((t) => cards(t).map(key)));
  const dead = ALL.filter((c) => !live.has(key(c)));
  const split: HiLoSplit = { hi: 0, lo: 0, scoop: 0, quarter: 0 };
  seedFastRandom(7);
  const joint = simulateEquity(
    cards(hero),
    cards(board),
    opponents.length,
    variantInfo('flo8'),
    400,
    undefined,
    false,
    split,
    undefined,
    undefined,
    dead
  );
  return { joint, lo: split.lo, hi: split.hi };
}

describe('a fixed-limit hi-lo low half is kept under the weak-high cap', () => {
  it('floors the cap at half the low share in fixed limit, heads-up and multiway, river only', () => {
    const fl = { isHiLo: true, isFixedLimit: true, isRiver: true, fixedLimitLowHalf: true };
    expect(hiLoRiverLowHalfFloor({ ...fl, opponents: 1, lowShare: 1 })).toBe(0.5);
    expect(hiLoRiverLowHalfFloor({ ...fl, opponents: 2, lowShare: 1 })).toBe(0.5);
    expect(hiLoRiverLowHalfFloor({ ...fl, opponents: 5, lowShare: 0.5 })).toBe(0.25); // quartered
    expect(hiLoRiverLowHalfFloor({ ...fl, opponents: 2, lowShare: 0 })).toBe(0);
    expect(hiLoRiverLowHalfFloor({ ...fl, isRiver: false, opponents: 1, lowShare: 1 })).toBe(0);
    // Off: fixed limit returns 0 as before, heads-up and multiway.
    expect(
      hiLoRiverLowHalfFloor({ ...fl, fixedLimitLowHalf: false, opponents: 1, lowShare: 1 })
    ).toBe(0);
    expect(
      hiLoRiverLowHalfFloor({ ...fl, fixedLimitLowHalf: undefined, opponents: 2, lowShare: 1 })
    ).toBe(0);
    // Pot limit is unchanged by the option: heads-up floors, multiway does not.
    const pl = { isHiLo: true, isFixedLimit: false, isRiver: true, fixedLimitLowHalf: true };
    expect(hiLoRiverLowHalfFloor({ ...pl, opponents: 1, lowShare: 1 })).toBe(0.5);
    expect(hiLoRiverLowHalfFloor({ ...pl, opponents: 2, lowShare: 1 })).toBe(0);
  });

  it('caps the sampled joint share without double counting: never above it, never below half the low share', () => {
    // Heads-up the one opponent's cards are exact. Three-way the two
    // opponents share eight live cards dealt at random each iteration, so
    // only the bounds (and that some low halves were split) are pinned.
    const cases: Array<[string, string, string, string[], number | null, number | null]> = [
      // name, hero, board, opponents, expected joint share, expected low share
      ['scoop (nut low and nut high)', 'Ac 2d 5h 6s', 'Kd Qs 7c 4h 3d', ['Kc Kh Js Ts'], 1, 1],
      ['nut low, no high', 'Ac 2d 9h 9s', 'Kd Qs 7c 4h 3d', ['Kc Kh Js Ts'], 0.5, 1],
      ['quartered nut low heads-up', 'Ac 2d 9h 9s', 'Kd Qs 7c 4h 3d', ['Kc Kh As 2s'], 0.25, 0.5],
      [
        'nut low three-way, sometimes quartered',
        'Ac 2d 9h 9s',
        'Kd Qs 7c 4h 3d',
        ['Kc Kh As 2s', 'Qc Qh Ah 2h'],
        null,
        null,
      ],
      ['no low on the board', 'Ac 2d 9h 9s', 'Kd Qs Jc 9d 8h', ['Kc Kh Js Ts'], 0, 0],
    ];
    for (const [name, hero, board, opps, joint, lo] of cases) {
      const s = sampled(hero, board, opps);
      if (joint !== null) expect(s.joint, name).toBeCloseTo(joint, 9);
      if (lo !== null) expect(s.lo, name).toBeCloseTo(lo, 9);
      else {
        expect(s.lo, name).toBeGreaterThan(0.3);
        expect(s.lo, name).toBeLessThan(1);
      }
      // The joint share the sampler returns holds the low half already.
      expect(s.joint + 1e-9, name).toBeGreaterThanOrEqual(0.5 * s.lo);
      const floor = hiLoRiverLowHalfFloor({
        isHiLo: true,
        isFixedLimit: true,
        isRiver: true,
        opponents: opps.length,
        lowShare: s.lo,
        fixedLimitLowHalf: true,
      });
      expect(floor, name).toBeCloseTo(0.5 * s.lo, 12);
      for (const cap of [0.08, 0.13, 0.18, 0.28, 0.36, 0.5, 0.62]) {
        const capped = hiLoCappedRiverShare(s.joint, cap, floor);
        expect(capped, `${name} cap ${cap}`).toBeLessThanOrEqual(s.joint + 1e-12);
        expect(capped + 1e-12, `${name} cap ${cap}`).toBeGreaterThanOrEqual(0.5 * s.lo);
        // Without the floor (option off) the cap is exactly as it was.
        expect(hiLoCappedRiverShare(s.joint, cap, 0)).toBe(Math.min(s.joint, Math.max(0.08, cap)));
      }
      // A scoop is never priced as its joint share plus its low half.
      if (joint === 1) expect(hiLoCappedRiverShare(s.joint, 0.28, floor)).toBe(0.5);
    }
  });

  it('heads-up: a nut low with a pair is held at its low half, not the pair cap', () => {
    enableBrainTelemetry();
    const spot = () =>
      fixedLimitRiverFacingOneBet({
        variant: 'flo8',
        seats: 2,
        stack: 40,
        deck: `Ac 2d 9h 9s ${BETTOR_SET} ${BOARD}`,
        hero: 1,
      })!;
    for (let s = 0; s < 6; s++) {
      const on = withDecisionFireScope(() =>
        decideSpot(spot(), 300 + s * 13, { ...ON, telemetry: true })
      );
      expect(on.fired.has('v40_omaha_pressure_cap')).toBe(true);
      expect(on.fired.has('fixed_limit_hilo_low_half_kept_seen')).toBe(true);
      expect(on.value.d.action).not.toBe('fold');
      const off = withDecisionFireScope(() =>
        decideSpot(spot(), 300 + s * 13, { telemetry: true })
      );
      expect(off.fired.has('fixed_limit_hilo_low_half_kept_seen')).toBe(false);
    }
  }, 120_000);

  for (const hero of HERO_HANDS)
    it(`three-way: ${hero} (nut low, weak high) on ${BOARD} does not fold one bet`, () => {
      const spot = () =>
        fixedLimitRiverFacingOneBet({
          variant: 'flo8',
          seats: 3,
          stack: 40,
          deck: `${hero} ${BETTOR_SET} ${CALLER} ${BOARD}`,
          hero: 1,
        })!;
      for (let s = 0; s < 6; s++) {
        expect(decideSpot(spot(), 300 + s * 13, ON).d.action).not.toBe('fold');
        // Main (option off) folds this exact spot: the cap clipped the low half.
        expect(decideSpot(spot(), 300 + s * 13).d.action).toBe('fold');
      }
    }, 120_000);

  it('three-way, a quartered nut low (the bettor holds A-2 too) still does not fold one bet', () => {
    const spot = () =>
      fixedLimitRiverFacingOneBet({
        variant: 'flo8',
        seats: 3,
        stack: 40,
        deck: `Ac 2d 9h 9s Kc Kh As 2s ${CALLER} ${BOARD}`,
        hero: 1,
      })!;
    for (let s = 0; s < 6; s++) {
      expect(decideSpot(spot(), 300 + s * 13, ON).d.action).not.toBe('fold');
      expect(decideSpot(spot(), 300 + s * 13).d.action).toBe('fold');
    }
  }, 120_000);

  it('three-way, no low and a weak high still folds (the cap keeps its job for the high half)', () => {
    const spot = () =>
      fixedLimitRiverFacingOneBet({
        variant: 'flo8',
        seats: 3,
        stack: 40,
        deck: `Jc Td 9h 9s ${BETTOR_SET} ${CALLER} ${BOARD}`,
        hero: 1,
      })!;
    for (let s = 0; s < 6; s++) expect(decideSpot(spot(), 300 + s * 13, ON).d.action).toBe('fold');
  }, 120_000);
});
