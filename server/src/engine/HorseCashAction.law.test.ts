/**
 * V85 CASH ACTION AT EVERY TABLE SIZE (owner direction, 2026-11-09).
 *
 * Dan, after a real player reported for the fourth time that the cash horses
 * play far too tight: "HORSES ARE PLAYING UNDER 20% VPIP OR LOWER! FOR A 9
 * HANDED GAME, THESE NUMBERS NEED TO BE INCREASED TO 25-30% VPIP, AND
 * INCREASE THE 3 BETTING. HOW DO YOU DO THIS WHILE MAINTAINING GTO
 * DISCIPLINE? AND THE HORSES ARE ALL OPENING WAY TOO SMALL ... REAL CASH GAME
 * OPENS ARE 2.5-4.5 BB OR LARGER IF THERE ARE LIMPERS", then "THIS NEEDS TO
 * BE FULLY ADJUSTED FOR 6 HANDED GAMES AND SHORT HANDED PLAY AS WELL".
 *
 * Production before (2026-11-10 UTC, engine 391f7bc0): nine-handed 15.9%
 * VPIP / 11.8% PFR / 4.0% 3-bet; the seats behind an open folded 94.0%.
 *
 * Every table number here is the all-horse preflop probe
 * (HoldemCashActionProbe) through HorseLogic.decide on the fleet's hybrid
 * cash profile, seeded, so a run repeats exactly. The bands are wide enough
 * for another seed and narrow enough that the tightness cannot come back.
 */
import { describe, expect, it } from 'vitest';
import { measureTable } from '../benchmark/HoldemCashActionProbe.js';
import {
  CASH_ACTION_OPEN_TARGET,
  OPEN_TARGET,
  openTargetShare,
  V85_CASH_OPEN_TARGET,
  V85_DEPTH_FULL_BB,
  V85_DEPTH_NONE_BB,
  v85DepthWeight,
  v85OpenTargetShare,
} from './HorseGtoOpeningRanges.js';
import { defenceTargets, V85_IP_FLOOR, type DefenceSpot } from './HorseGtoDefenceRanges.js';
import {
  NLH_CASH_ACTION_OPEN_MAX_BB,
  NLH_CASH_OPEN_FLOOR_BB,
  NLH_OPEN_BANDS_CASH_ACTION,
  nlhOpenBand,
  nlhOpenRaiseTo,
  type NlhOpenSeat,
} from './HorseNlhOpenSize.js';

const SEED = 20261110;
const HANDS = 2500;
const DEEP = 250; // the production median cash stack (253bb, 2026-11-10)
const OFF = { v85CashAction: false };

const table = (seats: number, depth = DEEP, opts = {}) =>
  measureTable(seats, HANDS, depth, SEED, opts);

describe('a full table of cash horses plays', () => {
  const nine = table(9);
  const nineOff = table(9, DEEP, OFF);

  it('nine-handed VPIP is no longer under 20%: 23-30% (15.9% in production before)', () => {
    expect(nineOff.vpip).toBeLessThan(18);
    expect(nine.vpip).toBeGreaterThanOrEqual(23);
    expect(nine.vpip).toBeLessThanOrEqual(30);
  });

  it('nine-handed 3-bets rise from under 4% to 5.5% or more, and squeezes exist', () => {
    expect(nineOff.threeBet).toBeLessThan(4.5);
    expect(nine.threeBet).toBeGreaterThanOrEqual(5.5);
    expect(nine.threeBet).toBeLessThanOrEqual(10);
    expect(nine.squeeze).toBeGreaterThanOrEqual(4);
  });

  it('the seats behind an open no longer fold 94%', () => {
    expect(nineOff.vsOpen.field.fold).toBeGreaterThan(92);
    expect(nine.vsOpen.field.fold).toBeLessThanOrEqual(81);
    expect(nine.vsOpen.field.call + nine.vsOpen.field.raise).toBeGreaterThanOrEqual(19);
    expect(nine.vsOpen.sb.fold).toBeLessThanOrEqual(84);
    expect(nine.vsOpen.bb.fold).toBeLessThanOrEqual(45);
  });

  it('the big blind does not fold MORE when a caller improves its price', () => {
    expect(nine.bbVsOpenCallerFold).toBeLessThanOrEqual(nine.vsOpen.bb.fold + 3);
  });

  it('it is still a raising game, not a calling one: PFR keeps pace and nobody open-limps', () => {
    expect(nine.pfr).toBeGreaterThanOrEqual(12.5);
    expect(nine.rfi).toBeGreaterThanOrEqual(21);
    expect(nine.rfi).toBeLessThanOrEqual(27);
  });

  it.each([8, 7])(
    'a nine-seat table with empty chairs (%i dealt in) is not left on the tight ranges',
    (seats) => {
      const t = table(seats);
      expect(t.vpip).toBeGreaterThanOrEqual(nine.vpip);
      expect(t.threeBet).toBeGreaterThanOrEqual(6);
      expect(t.vsOpen.field.fold).toBeLessThanOrEqual(81);
    }
  );
});

describe('six-handed and short-handed cash play wider still, in order', () => {
  const six = table(6);
  const five = table(5);
  const four = table(4);
  const three = table(3);
  const hu = table(2);

  it('six-handed 29-36% VPIP with a 7.5%+ 3-bet', () => {
    expect(six.vpip).toBeGreaterThanOrEqual(29);
    expect(six.vpip).toBeLessThanOrEqual(36);
    expect(six.threeBet).toBeGreaterThanOrEqual(7.5);
    expect(six.vsOpen.bb.fold).toBeLessThanOrEqual(40);
  });

  it('every seat removed loosens the table: 6 < 5 < 4 < 3 < heads-up', () => {
    expect(five.vpip).toBeGreaterThan(six.vpip);
    expect(four.vpip).toBeGreaterThan(five.vpip);
    expect(three.vpip).toBeGreaterThan(four.vpip);
    expect(hu.vpip).toBeGreaterThan(three.vpip + 15);
    expect(three.vpip).toBeGreaterThanOrEqual(44);
  });

  it('heads-up the big blind stops folding over half its hands to an open', () => {
    expect(table(2, DEEP, OFF).vsOpen.bb.fold).toBeGreaterThan(50);
    expect(hu.vsOpen.bb.fold).toBeLessThanOrEqual(35);
    expect(hu.vsOpen.bb.raise).toBeGreaterThanOrEqual(12);
    expect(hu.rfi).toBeGreaterThanOrEqual(76);
  });

  it('three-handed the blinds defend the button', () => {
    expect(three.vsOpen.bb.fold).toBeLessThanOrEqual(35);
    expect(three.vsOpen.sb.fold).toBeLessThanOrEqual(81);
  });
});

describe('cash opens are 2.5-4.5bb, larger over limpers, never read from the cards', () => {
  const SEATS: NlhOpenSeat[] = ['early', 'middle', 'cutoff', 'button', 'blind', 'heads_up'];
  const spot = (seat: NlhOpenSeat, depthBB = 100, tableSize = 6) => ({
    seat,
    depthBB,
    tournament: false,
    anteInPlay: false,
    tableSize,
    cashAction: true,
  });

  it('every seat band is 2.5bb or more and reaches 3.5bb; nothing passes 4.5bb', () => {
    for (const seat of SEATS)
      for (const depthBB of [60, 100, 160, 300])
        for (const tableSize of [2, 3, 6, 9]) {
          const b = nlhOpenBand(spot(seat, depthBB, tableSize));
          expect(b.lo).toBeGreaterThanOrEqual(NLH_CASH_OPEN_FLOOR_BB);
          expect(b.hi).toBeGreaterThanOrEqual(3.5);
          expect(b.hi).toBeLessThanOrEqual(NLH_CASH_ACTION_OPEN_MAX_BB);
          expect(b.minRaiseShare).toBe(0);
        }
    expect(NLH_CASH_ACTION_OPEN_MAX_BB).toBe(4.5);
    expect(nlhOpenBand(spot('early', 300, 9)).hi).toBe(4.5);
    expect(NLH_OPEN_BANDS_CASH_ACTION.button[1]).toBeGreaterThan(3);
  });

  it('each limper adds a full big blind on top of the band', () => {
    const draw = (limpers: number) =>
      nlhOpenRaiseTo({
        ...spot('button'),
        openUnit: 0.1,
        bigBlind: 0.1,
        limpers,
        sizingMultiplier: 1,
        rand: () => 0.5,
      });
    expect(draw(2) - draw(0)).toBeCloseTo(0.2, 6);
    expect(draw(3) / 0.1).toBeGreaterThanOrEqual(5.5);
  });

  it('the size is a function of the spot and the random source only', () => {
    // nlhOpenRaiseTo takes no cards at all: same spot, same draws, same size.
    const a = nlhOpenRaiseTo({
      ...spot('early', 200, 9),
      openUnit: 0.1,
      bigBlind: 0.1,
      limpers: 0,
      sizingMultiplier: 1,
      rand: () => 0.37,
    });
    const b = nlhOpenRaiseTo({
      ...spot('early', 200, 9),
      openUnit: 0.1,
      bigBlind: 0.1,
      limpers: 0,
      sizingMultiplier: 1,
      rand: () => 0.37,
    });
    expect(a).toBe(b);
  });

  it('at the table: no open under 2.5bb or over 4.5bb, the mean above 3.3bb when deep', () => {
    const t = table(9);
    expect(t.openMinBB).toBeGreaterThanOrEqual(2.5);
    expect(t.openMaxBB).toBeLessThanOrEqual(4.5 + 1e-9);
    expect(t.openAvgBB).toBeGreaterThanOrEqual(3.3);
  });

  it('a tournament and a short cash stack keep their own bands', () => {
    expect(nlhOpenBand({ ...spot('early'), tournament: true }).hi).toBeLessThanOrEqual(4);
    expect(nlhOpenBand(spot('early', 40)).hi).toBeLessThanOrEqual(3.75);
    expect(nlhOpenBand(spot('early', 20)).hi).toBe(2.8);
  });
});

describe('the discipline that stays', () => {
  it('each seat opens wider than the seat before it and wider than the prior profile', () => {
    for (let k = 8; k >= 2; k--) {
      if (k > 2) expect(V85_CASH_OPEN_TARGET[k]).toBeLessThan(V85_CASH_OPEN_TARGET[k - 1]);
      expect(V85_CASH_OPEN_TARGET[k]).toBeGreaterThan(CASH_ACTION_OPEN_TARGET[k]);
    }
    for (const dealt of [4, 5, 6, 7, 8, 9])
      for (let behind = 1; behind < dealt; behind++)
        expect(openTargetShare(behind, false, dealt, 'action')).toBe(
          V85_CASH_OPEN_TARGET[Math.min(8, behind)]
        );
  });

  it('ante games and tournaments read their own tables', () => {
    expect(openTargetShare(2, true, 9, 'action')).toBe(OPEN_TARGET.ante[2]);
    expect(openTargetShare(2, false, 9, false)).toBe(OPEN_TARGET.cash[2]);
  });

  const base: DefenceSpot = {
    defender: 'ip',
    openerBehind: 8,
    defenderBehind: 7,
    ante: false,
    openToBB: 3,
    dealt: 9,
    cashAction: true,
    callers: 0,
    depthBB: 200,
  };

  it('no seat behind an open collapses: the continue width keeps a floor at any table size', () => {
    for (let opener = 3; opener <= 8; opener++)
      for (let behind = 2; behind < opener; behind++) {
        const t = defenceTargets({ ...base, openerBehind: opener, defenderBehind: behind });
        expect(t.cont).toBeGreaterThanOrEqual(V85_IP_FLOOR.cont - 4);
        expect(t.value + t.bluff).toBeGreaterThanOrEqual(V85_IP_FLOOR.threeBet * 0.8);
      }
    // The prior base at the same spot: UTG+1 facing UTG continued about 3.5%.
    expect(defenceTargets({ ...base, cashAction: false }).cont).toBeLessThan(5);
  });

  it('an early open is still defended narrower than a late one, by every defender', () => {
    for (const defender of ['bb', 'sb'] as const) {
      const behind = defender === 'bb' ? 0 : 1;
      const late = defenceTargets({ ...base, defender, defenderBehind: behind, openerBehind: 2 });
      const early = defenceTargets({ ...base, defender, defenderBehind: behind, openerBehind: 8 });
      expect(early.cont).toBeLessThan(late.cont);
      expect(early.value + early.bluff).toBeLessThan(late.value + late.bluff);
    }
    const ipLate = defenceTargets({ ...base, openerBehind: 3, defenderBehind: 2 });
    const ipEarly = defenceTargets({ ...base, openerBehind: 8, defenderBehind: 2 });
    expect(ipEarly.cont).toBeLessThan(ipLate.cont);
  });

  it('a bigger open is still defended narrower', () => {
    const bb = { ...base, defender: 'bb' as const, defenderBehind: 0, openerBehind: 2 };
    expect(defenceTargets({ ...bb, openToBB: 4.5 }).cont).toBeLessThan(
      defenceTargets({ ...bb, openToBB: 2.5 }).cont
    );
  });

  it('the added 3-bets are value first: the bluff share never exceeds the value share', () => {
    for (const defender of ['bb', 'sb', 'ip'] as const)
      for (let opener = 3; opener <= 8; opener++) {
        const t = defenceTargets({
          ...base,
          defender,
          openerBehind: opener,
          defenderBehind: defender === 'bb' ? 0 : defender === 'sb' ? 1 : 2,
        });
        expect(t.bluff).toBeLessThan(t.value);
      }
  });

  it('a squeeze is narrower and more linear than a cold 3-bet; the big blind widens multiway', () => {
    const ip = { ...base, openerBehind: 4, defenderBehind: 2 };
    const cold = defenceTargets(ip);
    const squeeze = defenceTargets({ ...ip, callers: 1 });
    expect(squeeze.value + squeeze.bluff).toBeLessThan(cold.value + cold.bluff);
    expect(squeeze.bluff / squeeze.value).toBeLessThan(cold.bluff / cold.value);
    const bb = { ...base, defender: 'bb' as const, defenderBehind: 0, openerBehind: 4 };
    expect(defenceTargets({ ...bb, callers: 1 }).cont).toBeGreaterThan(defenceTargets(bb).cont);
  });
});

describe('short stacks keep the prior ranges', () => {
  it('the taper is none at 50bb, all of it from 85bb', () => {
    expect(V85_DEPTH_NONE_BB).toBe(50);
    expect(V85_DEPTH_FULL_BB).toBe(85);
    expect(v85DepthWeight(50)).toBe(0);
    expect(v85DepthWeight(40)).toBe(0);
    expect(v85DepthWeight(85)).toBe(1);
    expect(v85DepthWeight(300)).toBe(1);
    expect(v85OpenTargetShare(2, false, 9, 45)).toBe(openTargetShare(2, false, 9, true));
    expect(v85OpenTargetShare(2, false, 9, 120)).toBe(V85_CASH_OPEN_TARGET[2]);
  });

  it('a 45bb table decides exactly as it did with the profile off', () => {
    for (const seats of [9, 6, 2]) {
      const on = table(seats, 45);
      const off = table(seats, 45, OFF);
      expect(on).toEqual(off);
    }
  });
});
