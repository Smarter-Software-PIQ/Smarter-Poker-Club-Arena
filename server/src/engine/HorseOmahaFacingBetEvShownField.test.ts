/**
 * omahaFacingBetEvShownField (WooWoo F-04/F-11 C3, default OFF).
 * Spots are anonymised shapes of the audited multiway turn folds (the Horse's
 * own cards and the board only; no ids, no other player's cards).
 */
import { describe, expect, it } from 'vitest';
import {
  omahaFacingBetEvVerdict,
  OMAHA_EV_CALLER_SHARE,
  type OmahaFacingBetEvSpot,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_SHOWN_TURN_REALIZATION,
  omahaShownFieldMixUnit,
  omahaShownFieldVerdict,
  omahaShownJoint,
  omahaShownPhi,
  omahaShownTurnClass,
} from './HorseOmahaFacingBetEvShownField.js';
import { omahaFlopEvBehindContinue } from './HorseOmahaFlopFacingBetEv.js';
import { cardsOf } from './HorseOmahaFacingBetEv.test-support.js';

function spot(over: Partial<OmahaFacingBetEvSpot>): OmahaFacingBetEvSpot {
  return {
    street: 'turn',
    bettorSeat: 2,
    potFrac: 0.6,
    bucket: 'mid',
    isRaise: false,
    aggressorStreets: 1,
    callerStreets: 0,
    callers: 1,
    allIns: 0,
    behind: 1,
    callerSeats: [3],
    paid: 60,
    winnable: 220,
    allIn: false,
    final: false,
    bettorCanBarrelRiver: true,
    valueShare: 0.3,
    priorBluff: 0.25,
    ...over,
  };
}
const on = (potFrac = 0.6, mixUnit = 0.5) => ({
  shownField: { inPosition: false, continueRate: omahaFlopEvBehindContinue(potFrac), mixUnit },
});

// F-04 shape: PLO5 bottom set on an unpaired two-tone turn, OOP, one caller and one player behind.
const SET_HOLE = cardsOf('7h7d9cKsQd');
const SET_BOARD = cardsOf('7cJh2s5h');
// F-11 shape: PLO5 nut straight (on 9-T-J-2 with K-Q in hand), one caller.
const STR_HOLE = cardsOf('KdQc4h4s8d');
const STR_BOARD = cardsOf('9sTdJc2h');
// Air, for the fold control.
const AIR_HOLE = cardsOf('3c4d8h8sAc');
const AIR_BOARD = cardsOf('KhQsJdTh');

describe('omahaFacingBetEvShownField: option off is the serving verdict', () => {
  it('without ctx.shownField the verdict carries no shownField key and is unchanged', () => {
    const a = omahaFacingBetEvVerdict(spot({}), SET_HOLE, SET_BOARD, [], null, { rake: 0.05 });
    const b = omahaFacingBetEvVerdict(spot({}), SET_HOLE, SET_BOARD, [], null, { rake: 0.05 });
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a && 'shownField' in a).toBe(false);
  });
  it('heads-up (no other player) is untouched even with the option on', () => {
    const hu = spot({ callers: 0, behind: 0, callerSeats: [] });
    const off = omahaFacingBetEvVerdict(hu, SET_HOLE, SET_BOARD, [], null, { rake: 0.05 });
    const onV = omahaFacingBetEvVerdict(hu, SET_HOLE, SET_BOARD, [], null, { rake: 0.05, ...on() });
    expect(onV).toEqual(off);
  });
  it('six-card hands are untouched', () => {
    const six = cardsOf('7h7d9cKsQd3c');
    const off = omahaFacingBetEvVerdict(
      spot({ street: 'river', final: true }),
      six,
      cardsOf('7cJh2s5h8d'),
      [],
      null,
      {}
    );
    const onV = omahaFacingBetEvVerdict(
      spot({ street: 'river', final: true }),
      six,
      cardsOf('7cJh2s5h8d'),
      [],
      null,
      on()
    );
    expect(onV).toEqual(off);
  });
});

describe('omahaFacingBetEvShownField: the joint field', () => {
  it('is deterministic and each player behind who continues can only lower the share', () => {
    const j1 = omahaShownJoint(SET_HOLE, SET_BOARD, [], 0.3, [0.45], 2, 0.45)!;
    const j2 = omahaShownJoint(SET_HOLE, SET_BOARD, [], 0.3, [0.45], 2, 0.45)!;
    expect(j1).toEqual(j2);
    for (const arr of [j1.value, j1.other]) {
      expect(arr).toHaveLength(3);
      expect(arr[0]).toBeGreaterThanOrEqual(arr[1] - 1e-12);
      expect(arr[1]).toBeGreaterThanOrEqual(arr[2] - 1e-12);
    }
    expect(j1.nValue).toBeGreaterThan(100);
  });
  it('a wider caller range is easier to beat (no rate-as-range: share is the range, not the continue rate)', () => {
    const narrow = omahaShownJoint(SET_HOLE, SET_BOARD, [], 0.3, [0.2], 0, 1)!;
    const wide = omahaShownJoint(SET_HOLE, SET_BOARD, [], 0.3, [0.7], 0, 1)!;
    expect(wide.value[0]).toBeGreaterThan(narrow.value[0]);
  });
  it('refuses a field beyond five other players', () => {
    expect(omahaShownJoint(SET_HOLE, SET_BOARD, [], 0.3, [0.5, 0.5, 0.5], 3, 0.5)).toBeNull();
  });
});

describe('omahaFacingBetEvShownField: realization is the measured cell, no cap for a player behind', () => {
  it('a non-final OOP turn two-pair+ call takes the realfit OOP cell, not min(.., 0.85)', () => {
    const v = omahaFacingBetEvVerdict(spot({}), SET_HOLE, SET_BOARD, [], null, {
      rake: 0.05,
      ...on(),
    })!;
    expect(v.shownField).toBeDefined();
    expect(v.shownField!.realizationClass).toBe('two_pair_plus');
    expect(v.realization).toBeCloseTo(OMAHA_SHOWN_TURN_REALIZATION.two_pair_plus.oop.r, 6);
  });
  it('the river and a final call realize in full', () => {
    const v = omahaFacingBetEvVerdict(
      spot({ street: 'river', final: true, behind: 0 }),
      SET_HOLE,
      cardsOf('7cJh2s5hKd'),
      [],
      null,
      on()
    )!;
    expect(v.shownField).toBeDefined();
    expect(v.realization).toBe(1);
  });
  it('hand classes follow the realfit cells', () => {
    expect(omahaShownTurnClass(SET_HOLE, SET_BOARD)).toBe('two_pair_plus');
    expect(omahaShownTurnClass(cardsOf('AhKh9c8d3s'), cardsOf('2h7h9sQd'))).toBe('nut_combo_draw');
    expect(omahaShownTurnClass(cardsOf('AsKd3c4d6h'), cardsOf('AdTh7s2c'))).toBe('one_pair');
  });
});

describe('omahaFacingBetEvShownField: decisions', () => {
  it('F-04 shape: a set facing a 60% pot turn bet with one caller and one player behind calls', () => {
    const v = omahaFacingBetEvVerdict(spot({}), SET_HOLE, SET_BOARD, [], null, {
      rake: 0.05,
      ...on(),
    })!;
    expect(v.shownField!.ev).toBeGreaterThan(v.margin);
    expect(v.call).toBe(true);
  });
  it('F-11 shape: the current nut straight facing a pot turn bet with a caller calls', () => {
    const s = spot({ potFrac: 1, bucket: 'big', paid: 140, winnable: 280, behind: 0 });
    const v = omahaFacingBetEvVerdict(s, STR_HOLE, STR_BOARD, [], null, { rake: 0.05, ...on(1) })!;
    expect(v.call).toBe(true);
  });
  it('air facing a pot bet into two players folds', () => {
    const s = spot({ potFrac: 1, bucket: 'big', paid: 140, winnable: 280 });
    const v = omahaFacingBetEvVerdict(s, AIR_HOLE, AIR_BOARD, [], null, { rake: 0.05, ...on(1) })!;
    expect(v.call).toBe(false);
  });
  it('the caller range share used is the stated turn share (declared fallback)', () => {
    expect(OMAHA_EV_CALLER_SHARE.turn).toBe(0.45);
  });
});

describe('omahaFacingBetEvShownField: close calls are mixed, never thresholded', () => {
  const base = {
    street: 'turn' as const,
    rake: 0.05,
    final: false,
    bluff: 0.25,
    always: [0.45],
    behind: 1,
    behindShare: 0.45,
    continueRate: 0.5,
    inPosition: false,
  };
  it('inside 2 SE the probability of a call is Phi(edge / SE) and the public draw decides', () => {
    const probe = omahaShownFieldVerdict(SET_HOLE, SET_BOARD, [], 0.3, {
      ...base,
      paid: 60,
      winnable: 220,
      margin: 0,
      mixUnit: 0.5,
    })!;
    // put the margin at the EV: a coin flip
    const v0 = omahaShownFieldVerdict(SET_HOLE, SET_BOARD, [], 0.3, {
      ...base,
      paid: 60,
      winnable: 220,
      margin: probe.ev,
      mixUnit: 0.01,
    })!;
    const v1 = omahaShownFieldVerdict(SET_HOLE, SET_BOARD, [], 0.3, {
      ...base,
      paid: 60,
      winnable: 220,
      margin: probe.ev,
      mixUnit: 0.99,
    })!;
    expect(v0.mixed).toBe(true);
    expect(v0.pCall).toBeCloseTo(0.5, 3);
    expect(v0.call).toBe(true);
    expect(v1.call).toBe(false);
    expect(probe.se).toBeGreaterThan(0);
  });
  it('outside 2 SE the sign decides whatever the draw', () => {
    const probe = omahaShownFieldVerdict(SET_HOLE, SET_BOARD, [], 0.3, {
      ...base,
      paid: 60,
      winnable: 220,
      margin: 0,
      mixUnit: 0.5,
    })!;
    const far = omahaShownFieldVerdict(SET_HOLE, SET_BOARD, [], 0.3, {
      ...base,
      paid: 60,
      winnable: 220,
      margin: probe.ev - 3 * probe.se,
      mixUnit: 0.999,
    })!;
    expect(far.mixed).toBe(false);
    expect(far.call).toBe(true);
  });
  it('the draw reads public state only and is stable', () => {
    const k = 'turn|7cJh2s5h|28000|6000|4|17';
    expect(omahaShownFieldMixUnit(k)).toBe(omahaShownFieldMixUnit(k));
    expect(omahaShownFieldMixUnit(k)).toBeGreaterThanOrEqual(0);
    expect(omahaShownFieldMixUnit(k)).toBeLessThan(1);
    expect(omahaShownFieldMixUnit(k)).not.toBe(omahaShownFieldMixUnit(k + '|x'));
  });
  it('Phi', () => {
    expect(omahaShownPhi(0)).toBeCloseTo(0.5, 6);
    expect(omahaShownPhi(1.96)).toBeCloseTo(0.975, 3);
    expect(omahaShownPhi(-1.96)).toBeCloseTo(0.025, 3);
  });
});
