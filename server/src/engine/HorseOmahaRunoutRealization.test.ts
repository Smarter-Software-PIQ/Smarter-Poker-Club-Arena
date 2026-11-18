/**
 * omahaTurnCallRealizationByRunout (default OFF): the realization factor of a
 * non-final turn call read from the hand's per-river counts
 * (HorseOmahaRunoutRealization.ts), inside omahaFacingBetEv.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import {
  omahaEvHandCounts,
  omahaEvHandCountsResetCache,
  omahaFacingBetEvVerdict,
  type OmahaFacingBetEvSpot,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_RUNOUT_CHECKDOWN,
  OMAHA_RUNOUT_REALIZATION_MIN,
  OMAHA_RUNOUT_ROW,
  omahaRunoutRealization,
} from './HorseOmahaRunoutRealization.js';

const SUIT: Record<string, Card['suit']> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};
const cards = (text: string): Card[] =>
  text.split(' ').map((t) => ({ rank: t[0], suit: SUIT[t[1]] }) as Card);

/** A nut flush draw with a nut wrap, a bare overpair on a three-suited board, top set on a dry board. */
const NUT_DRAW = { hole: cards('As Ks Qd Jd 3c'), board: cards('Ts 9s 4h 2c') };
const BARE_OVERPAIR = { hole: cards('Ah Ad 7c 6d 2h'), board: cards('Ks Qs 8s 5h') };
const TOP_SET_DRY = { hole: cards('Kc Kd 8h 4s 2d'), board: cards('Kh 7c 3s 9d') };

const spotOf = (over: Partial<OmahaFacingBetEvSpot> = {}): OmahaFacingBetEvSpot => ({
  street: 'turn',
  bettorSeat: 2,
  potFrac: 0.66,
  bucket: 'mid',
  isRaise: false,
  aggressorStreets: 1,
  callerStreets: 0,
  callers: 0,
  allIns: 0,
  behind: 0,
  callerSeats: [],
  paid: 66,
  winnable: 166,
  allIn: false,
  final: false,
  bettorCanBarrelRiver: true,
  valueShare: 0.3,
  priorBluff: 0.4,
  ...over,
});

const rows = (...r: number[][]): Float64Array => Float64Array.from(r.flat());

describe('omahaRunoutRealization (pure)', () => {
  it('reads nothing from an empty, ragged or equity-less runout', () => {
    expect(omahaRunoutRealization(undefined, 0.3, true)).toBeNull();
    expect(omahaRunoutRealization(new Float64Array(0), 0.3, true)).toBeNull();
    expect(omahaRunoutRealization(new Float64Array(OMAHA_RUNOUT_ROW + 1), 0.3, true)).toBeNull();
    expect(omahaRunoutRealization(rows([0, 10, 0, 10]), 0.3, true)).toBeNull();
    expect(omahaRunoutRealization(rows([5, 10, 5, 10]), Number.NaN, true)).toBeNull();
  });

  it('realizes in full the equity on rivers where the hand calls a river bet', () => {
    // beats 8 of 10 value holdings on both rivers
    const r = omahaRunoutRealization(rows([8, 10, 9, 10], [8, 10, 9, 10]), 0.3, false)!;
    expect(r.realization).toBe(1);
    expect(r.robustShare).toBe(1);
    expect(r.rivers).toBe(2);
  });

  it('realizes only the checked-down share where the hand folds to a river bet', () => {
    // beats 1 of 10 value holdings (under the fold line): the value wins are lost,
    // the wins against the rest are kept at the checkdown share
    const oop = omahaRunoutRealization(rows([1, 10, 8, 10]), 0.2, false)!;
    const ip = omahaRunoutRealization(rows([1, 10, 8, 10]), 0.2, true)!;
    const eqVal = (0.8 / 10) * 1;
    const eqOth = (0.2 / 10) * 8;
    expect(oop.realization).toBeCloseTo(
      Math.max(
        OMAHA_RUNOUT_REALIZATION_MIN,
        (eqOth * OMAHA_RUNOUT_CHECKDOWN.oop) / (eqVal + eqOth)
      ),
      12
    );
    expect(ip.realization).toBeGreaterThan(oop.realization);
    expect(oop.robustShare).toBe(0);
  });

  it('a bettor who bluffs often makes the bluff-catch right: the rest is realized in full', () => {
    const tight = omahaRunoutRealization(rows([0, 10, 9, 10]), 0.3, false)!;
    const wide = omahaRunoutRealization(rows([0, 10, 9, 10]), 0.6, false)!;
    expect(tight.realization).toBeCloseTo(OMAHA_RUNOUT_CHECKDOWN.oop, 12);
    expect(wide.realization).toBe(1);
  });

  it('never leaves its bounds', () => {
    const low = omahaRunoutRealization(rows([1, 10, 0.1, 10]), 0.05, false)!;
    expect(low.realization).toBe(OMAHA_RUNOUT_REALIZATION_MIN);
  });
});

describe('the turn count carries each river (OmahaEvHandCounts.runout)', () => {
  it('the rows sum to the shares the verdict already uses', () => {
    for (const h of [NUT_DRAW, BARE_OVERPAIR, TOP_SET_DRY]) {
      omahaEvHandCountsResetCache();
      const c = omahaEvHandCounts(h.hole, h.board, [], 0.3)!;
      const run = c.runout!;
      expect(run.length).toBe(c.unseen * OMAHA_RUNOUT_ROW);
      let vw = 0;
      let vn = 0;
      let ow = 0;
      let on = 0;
      for (let k = 0; k < c.unseen; k++) {
        vw += run[k * OMAHA_RUNOUT_ROW];
        vn += run[k * OMAHA_RUNOUT_ROW + 1];
        ow += run[k * OMAHA_RUNOUT_ROW + 2];
        on += run[k * OMAHA_RUNOUT_ROW + 3];
      }
      expect(vw / vn).toBeCloseTo(c.value.win + 0.5 * c.value.tie, 12);
      expect(ow / on).toBeCloseTo(c.other.win + 0.5 * c.other.tie, 12);
    }
  });

  it('a river count has no runout', () => {
    const c = omahaEvHandCounts(NUT_DRAW.hole, [...NUT_DRAW.board, ...cards('7d')], [], 0.3)!;
    expect(c.runout).toBeUndefined();
  });
});

describe('omahaFacingBetEvVerdict with the option', () => {
  const verdict = (
    h: { hole: Card[]; board: Card[] },
    on: boolean,
    over: Partial<OmahaFacingBetEvSpot> = {},
    inPosition = false
  ) =>
    omahaFacingBetEvVerdict(spotOf(over), h.hole, h.board, [], null, {
      realization: inPosition ? 0.92 : 0.85,
      ...(on ? { runoutRealization: { inPosition } } : {}),
    })!;

  it('off: the verdict is the one it was, key for key', () => {
    for (const h of [NUT_DRAW, BARE_OVERPAIR, TOP_SET_DRY]) {
      const off = verdict(h, false);
      expect('runoutRealization' in off).toBe(false);
      const plain = omahaFacingBetEvVerdict(spotOf(), h.hole, h.board, [], null, {
        realization: 0.85,
      })!;
      expect(JSON.stringify(off)).toBe(JSON.stringify(plain));
    }
  });

  it('on: the hand and the board set the factor, not one flat number', () => {
    const draw = verdict(NUT_DRAW, true);
    const overpair = verdict(BARE_OVERPAIR, true);
    const set = verdict(TOP_SET_DRY, true);
    expect(draw.runoutRealization).toBeDefined();
    // a nut draw's equity sits on rivers where it is the nuts; top set on a dry
    // board stays ahead of his value region on most rivers
    expect(draw.runoutRealization!).toBeGreaterThan(0.85);
    expect(set.runoutRealization!).toBeGreaterThan(0.85);
    // a bare overpair with no card of the suit on a three-suited turn is a
    // bluff-catcher on nearly every river
    expect(overpair.runoutRealization!).toBeLessThan(0.7);
    expect(overpair.realization).toBeLessThanOrEqual(overpair.runoutRealization!);
  });

  it('on: the size of the bet is not a term (same range, same read, three sizes)', () => {
    const at = (potFrac: number, paid: number) =>
      verdict(BARE_OVERPAIR, true, { potFrac, paid, winnable: 100 + paid }).runoutRealization;
    expect(at(0.3, 30)).toBe(at(0.66, 66));
    expect(at(1, 100)).toBe(at(0.66, 66));
  });

  it('on: a final call and a river call are untouched', () => {
    const fin = verdict(NUT_DRAW, true, { final: true });
    expect(fin.realization).toBe(1);
    expect('runoutRealization' in fin).toBe(false);
  });

  it('on: the reviewed caps still bound it from above', () => {
    // a player behind caps a non-final turn call at 0.85
    const v = verdict(TOP_SET_DRY, true, { behind: 1 });
    expect(v.realization).toBeLessThanOrEqual(0.85);
  });
});
