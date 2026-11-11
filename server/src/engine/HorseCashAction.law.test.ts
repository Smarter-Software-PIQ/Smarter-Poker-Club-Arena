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
import { measureTable, playPreflop } from '../benchmark/HoldemCashActionProbe.js';
import { seedFastRandom } from './HorseEval.js';
import {
  CASH_ACTION_OPEN_TARGET,
  classifyHoldemEpLimpCandidate,
  gtoCashActionOpenStrength,
  gtoOpenStrength,
  OPEN_TARGET,
  openTargetShare,
  V85_CASH_OPEN_TARGET,
  V85_DEPTH_FULL_BB,
  V85_DEPTH_NONE_BB,
  v85DepthWeight,
  v85OpenTargetShare,
} from './HorseGtoOpeningRanges.js';
import { decidePreflopV7, type PreflopAuthorityEvent, type PreflopCtx } from './HorsePreflop.js';
import type { Card } from '../types.js';
import {
  defenceTargets,
  V85_IP_FLOOR,
  V87_MULTIWAY_DEFENCE,
  v87LowStakesWeight,
  v87WidenDefence,
  type DefenceSpot,
} from './HorseGtoDefenceRanges.js';
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
  const nine100 = table(9, 100);
  const nineOff = table(9, DEEP, OFF);

  it('nine-handed VPIP lands squarely in 25-30% at both 250bb and 100bb (15.9% in production before)', () => {
    expect(nineOff.vpip).toBeLessThan(18);
    expect(nine.vpip).toBeGreaterThanOrEqual(25);
    expect(nine.vpip).toBeLessThanOrEqual(30);
    expect(nine100.vpip).toBeGreaterThanOrEqual(25);
    expect(nine100.vpip).toBeLessThanOrEqual(30);
  });

  it('nine-handed 3-bets rise from under 4% to 5.5% or more, and squeezes exist', () => {
    expect(nineOff.threeBet).toBeLessThan(4.5);
    expect(nine.threeBet).toBeGreaterThanOrEqual(5.5);
    expect(nine.threeBet).toBeLessThanOrEqual(10);
    expect(nine.squeeze).toBeGreaterThanOrEqual(4);
  });

  it('the seats behind an open no longer fold 94%', () => {
    expect(nineOff.vsOpen.field.fold).toBeGreaterThan(92);
    expect(nine.vsOpen.field.fold).toBeLessThanOrEqual(82);
    expect(nine.vsOpen.field.call + nine.vsOpen.field.raise).toBeGreaterThanOrEqual(18);
    expect(nine.vsOpen.sb.fold).toBeLessThanOrEqual(84);
    expect(nine.vsOpen.bb.fold).toBeLessThanOrEqual(46);
  });

  it('the big blind does not fold MORE when a caller improves its price', () => {
    expect(nine.bbVsOpenCallerFold).toBeLessThanOrEqual(nine.vsOpen.bb.fold + 3);
  });

  it('it remains an aggressive game: PFR and early-position RFI expand cleanly', () => {
    expect(nine.pfr).toBeGreaterThanOrEqual(13.5);
    expect(nine.rfi).toBeGreaterThanOrEqual(24);
    expect(nine.rfi).toBeLessThanOrEqual(34);
    expect(V85_CASH_OPEN_TARGET[8]).toBeGreaterThanOrEqual(22);
  });

  it('strict monotonicity holds across 9, 8, and 7 seats dealt in', () => {
    const eight = table(8);
    const seven = table(7);
    expect(eight.vpip).toBeGreaterThan(nine.vpip);
    expect(seven.vpip).toBeGreaterThan(eight.vpip);
    for (const t of [eight, seven]) {
      expect(t.threeBet).toBeGreaterThanOrEqual(6);
      expect(t.vsOpen.field.fold).toBeLessThanOrEqual(82);
    }
  });
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

describe('V87 early-position limp-reraise trap and suited-connector limp mix', () => {
  const SUITS: Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
  const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

  function baseEpCtx(holeCards: [Card, Card], over: Partial<PreflopCtx> = {}): PreflopCtx {
    return {
      strength: 0.96,
      position: 'early',
      raiserPosition: null,
      raises: 0,
      limpers: 0,
      callers: 0,
      oppsLeft: 8,
      tableSize: 9,
      toCall: 2,
      currentBet: 2,
      pot: 3,
      bigBlind: 2,
      stack: 200,
      stackBB: 100,
      effectiveStackBB: 100,
      tightness: 1,
      bluffFreq: 0.35,
      aggression: 1,
      slowplayFreq: 0.2,
      sizingMultiplier: 1,
      isOmaha: false,
      isPotLimit: false,
      riskAdd: 0,
      mode: 'cash',
      cashActionSizes: true,
      holeCards,
      heroSeat: 3,
      dealerSeat: 9,
      rand: () => 0.5,
      ...over,
    };
  }

  it('mixes ~15-18% open-limps with QQ/KK/AA and ~18-22% with 54s-T9s, then defends iso-raises 100%', () => {
    const bigPairs: [Card, Card][] = [];
    for (const r of ['Q', 'K', 'A'] as const) {
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) bigPairs.push([card(r, SUITS[i]), card(r, SUITS[j])]);
    }
    const suitedConnectors: [Card, Card][] = [];
    for (const [hi, lo] of [
      ['5', '4'],
      ['6', '5'],
      ['7', '6'],
      ['8', '7'],
      ['9', '8'],
      ['T', '9'],
    ] as const) {
      for (const s of SUITS) suitedConnectors.push([card(hi, s), card(lo, s)]);
    }

    let pairLimps = 0;
    for (const h of bigPairs) {
      expect(classifyHoldemEpLimpCandidate(h[0], h[1])).toBe('big_pair_trap');
      const events: PreflopAuthorityEvent[] = [];
      const res = decidePreflopV7(baseEpCtx(h, { noteAuthority: (e) => events.push(e) }));
      if (res.a === 'call') {
        pairLimps++;
        expect(events.some((e) => e.branch === 'v87_ep_limp_trap')).toBe(true);
      } else {
        expect(res.a).toBe('raiseTo');
      }
      // Facing an iso-raise after limping, QQ/KK/AA 100% limp-reraises.
      const isoEvents: PreflopAuthorityEvent[] = [];
      const vsIso = decidePreflopV7(
        baseEpCtx(h, {
          raises: 1,
          raiserPosition: 'late',
          currentBet: 9,
          toCall: 7,
          pot: 14,
          heroPreviouslyActed: true,
          heroWasInitialRaiser: false,
          noteAuthority: (e) => isoEvents.push(e),
        })
      );
      expect(vsIso.a === 'raiseTo' || vsIso.a === 'jam').toBe(true);
      expect(isoEvents.some((e) => e.branch === 'v87_ep_limp_reraise_value')).toBe(true);
    }
    const pairRate = pairLimps / bigPairs.length;
    expect(pairRate).toBeGreaterThanOrEqual(0.14);
    expect(pairRate).toBeLessThanOrEqual(0.2);

    let scLimps = 0;
    let scIsoBluffs = 0;
    let scIsoCalls = 0;
    for (const h of suitedConnectors) {
      expect(classifyHoldemEpLimpCandidate(h[0], h[1])).toBe('suited_connector');
      const events: PreflopAuthorityEvent[] = [];
      const res = decidePreflopV7(
        baseEpCtx(h, { strength: 0.64, noteAuthority: (e) => events.push(e) })
      );
      if (res.a === 'call') {
        scLimps++;
        expect(events.some((e) => e.branch === 'v87_ep_limp_suited_connector')).toBe(true);
      }
      const isoEvents: PreflopAuthorityEvent[] = [];
      const vsIso = decidePreflopV7(
        baseEpCtx(h, {
          strength: 0.64,
          raises: 1,
          raiserPosition: 'late',
          currentBet: 9,
          toCall: 7,
          pot: 14,
          heroPreviouslyActed: true,
          heroWasInitialRaiser: false,
          noteAuthority: (e) => isoEvents.push(e),
        })
      );
      if (vsIso.a === 'raiseTo' || vsIso.a === 'jam') {
        scIsoBluffs++;
        expect(isoEvents.some((e) => e.branch === 'v87_ep_limp_reraise_bluff')).toBe(true);
      } else {
        expect(vsIso.a).toBe('call');
        scIsoCalls++;
        expect(isoEvents.some((e) => e.branch === 'v87_ep_limp_call_iso')).toBe(true);
      }
    }
    const scRate = scLimps / suitedConnectors.length;
    expect(scRate).toBeGreaterThanOrEqual(0.15);
    expect(scRate).toBeLessThanOrEqual(0.24);
    expect(scIsoBluffs).toBeGreaterThanOrEqual(4);
    expect(scIsoBluffs + scIsoCalls).toBe(suitedConnectors.length);

    // Implied-odds EP open strength equals base at 45bb and beats ATo/KJo/QJo at 100bb.
    expect(gtoCashActionOpenStrength(card('6', 'hearts'), card('5', 'hearts'), 8, 45)).toBe(
      gtoOpenStrength(card('6', 'hearts'), card('5', 'hearts'), 8)
    );
    expect(
      gtoCashActionOpenStrength(card('6', 'hearts'), card('5', 'hearts'), 8, 100)
    ).toBeGreaterThan(gtoCashActionOpenStrength(card('K', 'hearts'), card('J', 'clubs'), 8, 100));
  });
});

/**
 * V87 MULTIWAY LOW-STAKES DEFENCE (owner direction, 2026-11-10 22:48
 * Chicago): "I HAVEN'T SEEN ANY OR MANY 3 HANDED OR EVEN 4 HANDED FLOPS, AND
 * THAT TYPICALLY HAPPENS OFTEN IN LOWER STAKES GAMES... HORSES ARE NOT
 * CALLING OR 3 BETTING ENOUGH.... PREFLOP RANGES APPEAR TO BE WAY TO TIGHT."
 *
 * Measured on this probe (seed 20261110, 2,500 hands, $0.05/$0.10), V85
 * alone (v87HoldemOverhaul off) against V87, nine-handed 100bb: VPIP 26.1 ->
 * 28.0, 3-bet 6.2 -> 9.0, flat share facing a raise 20.7 -> 23.6, single
 * raised pots with a caller 78.9 -> 82.9%, three-way 39.8 -> 47.4%, four-way
 * 13.1 -> 22.3%. 250bb: VPIP 26.9 -> 29.3, 3-bet 6.2 -> 8.8, three-way 43.9
 * -> 53.0%. Six-handed 100bb: VPIP 32.4 -> 35.3, 3-bet 8.5 -> 10.5.
 */
describe('V87 multiway low-stakes defence: more flats, more 3-bets, more multiway flops', () => {
  const V87_OFF = { v87HoldemOverhaul: false };
  const rng = (seed: number) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** Single raised pots only: every caller of the one open sees the flop. */
  const multiway = (n: number, depth: number, opts: Record<string, unknown>) => {
    const r = rng(777 + n);
    seedFastRandom(4242 + n);
    let srp = 0;
    let called = 0;
    let three = 0;
    let four = 0;
    let flats = 0;
    let facing = 0;
    for (let h = 0; h < HANDS; h++) {
      const seats = playPreflop(n, depth, r, opts);
      for (const x of seats) {
        if (x.vsOpen || x.vsOpenCaller) {
          facing++;
          if (x.vsOpen === 'call' || x.vsOpenCaller === 'call') flats++;
        }
      }
      if (seats.filter((x) => x.pfr).length !== 1) continue;
      srp++;
      const players = seats.filter((x) => x.vpip).length;
      if (players >= 2) called++;
      if (players >= 3) three++;
      if (players >= 4) four++;
    }
    const pct = (a: number, b: number) => (100 * a) / b;
    return {
      called: pct(called, srp),
      three: pct(three, srp),
      four: pct(four, srp),
      flatShare: pct(flats, facing),
    };
  };

  const nine100 = table(9, 100);
  const nine100Off = table(9, 100, V87_OFF);
  const nine = table(9);
  const nineV85 = table(9, DEEP, V87_OFF);
  const six = table(6, 100);
  const six85 = table(6, 100, V87_OFF);

  it("nine-handed VPIP stays inside Dan's 25-30% while 3-bets reach 8-11%", () => {
    for (const t of [nine100, nine]) {
      expect(t.vpip).toBeGreaterThanOrEqual(25);
      expect(t.vpip).toBeLessThanOrEqual(30);
      expect(t.threeBet).toBeGreaterThanOrEqual(8);
      expect(t.threeBet).toBeLessThanOrEqual(11);
    }
    expect(nine100.threeBet).toBeGreaterThanOrEqual(nine100Off.threeBet + 2);
    expect(nine.threeBet).toBeGreaterThanOrEqual(nineV85.threeBet + 2);
    expect(nine.vpip).toBeGreaterThan(nineV85.vpip);
  });

  it('six-handed runs wider (32-38%) with a 3-bet that stays under 11.5%', () => {
    expect(six.vpip).toBeGreaterThan(six85.vpip);
    expect(six.vpip).toBeGreaterThanOrEqual(32);
    expect(six.vpip).toBeLessThanOrEqual(38);
    expect(six.threeBet).toBeGreaterThan(six85.threeBet);
    expect(six.threeBet).toBeLessThanOrEqual(11.5);
  });

  it('a single open at a nine-handed 100bb table draws callers materially more often', () => {
    const on = multiway(9, 100, {});
    const off = multiway(9, 100, V87_OFF);
    expect(on.flatShare).toBeGreaterThanOrEqual(off.flatShare + 2);
    expect(on.called).toBeGreaterThanOrEqual(off.called + 2.5);
    expect(on.three).toBeGreaterThanOrEqual(off.three + 5);
    expect(on.four).toBeGreaterThanOrEqual(off.four + 5);
    // Three-way flops are common: nearly half of all single raised pots.
    expect(on.three).toBeGreaterThanOrEqual(42);
  });

  it('the low-stakes weight is full at a $2 big blind, gone at $10, and taper is linear', () => {
    expect(v87LowStakesWeight(0.1)).toBe(1);
    expect(v87LowStakesWeight(2)).toBe(1);
    expect(v87LowStakesWeight(5)).toBeCloseTo(0.625, 9);
    expect(v87LowStakesWeight(10)).toBe(0);
    expect(v87LowStakesWeight(25)).toBe(0);
    expect(v87LowStakesWeight(undefined)).toBe(0);
  });

  it('the widening is pure, zero at weight 0, wider at lower stakes and with every caller', () => {
    const bars = { continueBar: 0.42, valueBar: 0.68, bluffProb: 0.2 };
    const spot = { defender: 'ip' as const, callers: 0, lowStakes: 0, weight: 1, dealt: 9 };
    expect(v87WidenDefence(bars, { ...spot, weight: 0 })).toEqual(bars);
    const base = v87WidenDefence(bars, spot);
    expect(v87WidenDefence(bars, spot)).toEqual(base);
    expect(base.continueBar).toBeLessThan(bars.continueBar);
    expect(base.valueBar).toBeLessThan(bars.valueBar);
    expect(base.bluffProb).toBeGreaterThan(bars.bluffProb);
    const low = v87WidenDefence(bars, { ...spot, lowStakes: 1 });
    expect(low.continueBar).toBeLessThan(base.continueBar);
    const caller = v87WidenDefence(bars, { ...spot, callers: 1 });
    const callers2 = v87WidenDefence(bars, { ...spot, callers: 2 });
    expect(caller.continueBar).toBeLessThan(base.continueBar);
    expect(callers2.continueBar).toBeLessThan(caller.continueBar);
    // Bluffs stay a scaled share of the existing chart, never a new class.
    expect(v87WidenDefence({ ...bars, bluffProb: 0 }, spot).bluffProb).toBe(0);
    expect(V87_MULTIWAY_DEFENCE.maxCont).toBeLessThanOrEqual(90);
  });

  it('V87 off is V85 exactly, and a 45bb table is untouched by the widening', () => {
    expect(table(9, 45)).toEqual(table(9, 45, V87_OFF));
  });
});
