/**
 * THE OMAHA PRICED RULES (owner 2026-11-17 11:49: "there should not be any
 * blanket rules ... they must all be done by math"; ten default-OFF options).
 *
 * The pure comparisons and inputs: no size step, continuous shrinkage of the
 * opponent read, the opponent range conditioned on the Horse's own cards. The
 * rule sites: with no read the priced answer is the categorical rule's answer
 * on the classes that rule was written for; with a measured read it differs
 * where the math supports it. Every option unset or false is byte-identical;
 * every decision is legal and passes the receipt validator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { omahaTurnRiverRaiseNeedsNutsRule, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_EV_PRIOR_BLUFF,
  OMAHA_EV_VALUE_SHARE,
  OMAHA_EV_LINE_AGGRESSOR,
  OMAHA_EV_LINE_CALLER,
  omahaEvBluffShare,
  omahaEvHandCounts,
  omahaFacingBetEvSpot,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_PRICED_MODE_OFF,
  omahaPricedBluffFactor,
  omahaPricedBySize,
  omahaPricedFacingRange,
  omahaPricedModeOf,
  omahaPricedRamp,
  omahaPricedRealizationCap,
  withOmahaPricedMode,
} from './HorseOmahaPricedMode.js';
import {
  OMAHA_PRICED_NO_READ,
  OMAHA_PRICED_PERSON_BET_CHECKED_TO,
  omahaPricedCardImpactRead,
  omahaPricedBet,
  omahaPricedMixProbability,
  omahaPricedPublicSpotKey,
  omahaPricedRaise,
  omahaPricedRead,
  omahaPricedReadSpread,
  omahaPricedSampledRaise,
  omahaPricedShrunk,
} from './HorseOmahaPricedRules.js';
import {
  omahaPricedAdmitsRaiseToCall,
  omahaPricedInScope,
  omahaPricedOopTurnBarrelRule,
  omahaPricedPairedBoardBetRule,
  omahaPricedSetStreetRatesSource,
} from './HorseOmahaPricedWiring.js';
import {
  OMAHA_PRICED_RAISE_GATE_OPTIONS,
  horseDecisionReceiptRefusal,
} from './horseDecision/responseValidation.js';

const pricedRaiseGateOf = (opts: object): boolean =>
  OMAHA_PRICED_RAISE_GATE_OPTIONS.some((name) => (opts as Record<string, unknown>)[name] === true);
import {
  LIVE_OPTIONS,
  PRICED_OPTIONS,
  allPriced,
  cards,
  decideAt,
  pricedSpot,
  type PricedSpot,
} from './HorseOmahaPricedRules.test-support.js';
import type { HorseDecision } from '../types.js';

afterEach(() => {
  vi.restoreAllMocks();
  omahaPricedSetStreetRatesSource(null);
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const POP = { bet: 0.35, foldToBet: 0.4 };
const stat = (mean: number, n: number) => ({ mean, n, engaged: null, excess: 0 });
const cell = (hit: number, opp: number) => ({ hit, opp });
const foldsToRaises = (hit: number, opp: number) =>
  omahaPricedRead(null, POP, { bet: null, foldToBet: null, foldToRaise: cell(hit, opp) });

describe('the size of a bet is a continuous input, never a trigger', () => {
  const river = OMAHA_EV_VALUE_SHARE.river;
  const rows: [number, number, number, number] = [river.under40, river.mid, river.big, river.over];
  it('a size table read between its row centres has no step and never rises with the size', () => {
    expect(omahaPricedBySize(rows, 0.25)).toBeCloseTo(river.under40, 12);
    expect(omahaPricedBySize(rows, 0.55)).toBeCloseTo(river.mid, 12);
    expect(omahaPricedBySize(rows, 0.9)).toBeCloseTo(river.big, 12);
    expect(omahaPricedBySize(rows, 3)).toBeCloseTo(river.over, 12);
    let last = Infinity;
    for (let f = 0.01; f <= 2.5; f += 0.01) {
      const v = omahaPricedBySize(rows, f);
      expect(v).toBeLessThanOrEqual(last + 1e-12);
      // one percent of the pot never moves the value share by more than half a point
      if (Number.isFinite(last)) expect(last - v).toBeLessThan(0.006);
      last = v;
    }
  });
  it('39 and 40 percent of the pot, 69 and 70: the stepped table jumps, the continuous range does not', () => {
    const at = (potFrac: number, street: 'turn' | 'river') =>
      omahaPricedFacingRange({
        street,
        isRaise: false,
        chosenFrac: potFrac,
        potFrac,
        aggressorStreets: 0,
        callerStreets: 0,
        earlierRaised: false,
        boardPaired: false,
        heroBetTurn: false,
        others: 0,
        behindShare: 2,
        value: OMAHA_EV_VALUE_SHARE[street],
        bluff: OMAHA_EV_PRIOR_BLUFF[street],
        lineAggressor: OMAHA_EV_LINE_AGGRESSOR,
        lineCaller: OMAHA_EV_LINE_CALLER,
      });
    // the stepped turn table: 0.50 under 40 percent, 0.38 from 40 percent
    expect(OMAHA_EV_VALUE_SHARE.turn.under40 - OMAHA_EV_VALUE_SHARE.turn.mid).toBeCloseTo(0.12, 12);
    for (const street of ['turn', 'river'] as const)
      for (const edge of [0.4, 0.7, 1.1]) {
        const below = at(edge - 0.005, street);
        const above = at(edge + 0.005, street);
        expect(Math.abs(below.valueShare - above.valueShare)).toBeLessThan(0.006);
        expect(Math.abs(below.priorBluff - above.priorBluff)).toBeLessThan(0.006);
      }
  });
  it('the line overrides are weights that grow with the size, zero for a small bet', () => {
    const base = {
      street: 'river' as const,
      isRaise: false,
      aggressorStreets: 0,
      callerStreets: 1,
      earlierRaised: false,
      boardPaired: true,
      heroBetTurn: true,
      others: 0,
      behindShare: 2,
      value: OMAHA_EV_VALUE_SHARE.river,
      bluff: OMAHA_EV_PRIOR_BLUFF.river,
      lineAggressor: OMAHA_EV_LINE_AGGRESSOR,
      lineCaller: OMAHA_EV_LINE_CALLER,
    };
    const lead = (f: number) => omahaPricedFacingRange({ ...base, chosenFrac: f, potFrac: f });
    const plain = (f: number) =>
      omahaPricedFacingRange({ ...base, heroBetTurn: false, chosenFrac: f, potFrac: f });
    // a small lead into the turn aggressor reads as any small bet; a large one as a raise
    expect(lead(0.15).valueShare).toBeCloseTo(plain(0.15).valueShare, 12);
    expect(lead(0.8).valueShare).toBeCloseTo(
      OMAHA_EV_VALUE_SHARE.river.raise * OMAHA_EV_LINE_AGGRESSOR,
      12
    );
    expect(lead(0.8).priorBluff).toBeCloseTo(OMAHA_EV_PRIOR_BLUFF.river.raise, 12);
    let last = Infinity;
    for (let f = 0.1; f <= 1; f += 0.01) {
      const v = lead(f).valueShare;
      expect(v).toBeLessThanOrEqual(last + 1e-12);
      if (Number.isFinite(last)) expect(last - v).toBeLessThan(0.02);
      last = v;
    }
  });
  it('a ramp and a realization cap are continuous', () => {
    expect(omahaPricedRamp(0.2, 0.2, 0.6)).toBe(0);
    expect(omahaPricedRamp(0.6, 0.2, 0.6)).toBe(1);
    expect(omahaPricedRamp(0.4, 0.2, 0.6)).toBeCloseTo(0.5, 12);
    expect(omahaPricedRealizationCap(0.1, 0.2, 0.6, 0.42)).toBe(1);
    expect(omahaPricedRealizationCap(0.9, 0.2, 0.6, 0.42)).toBeCloseTo(0.42, 12);
    expect(
      omahaPricedRealizationCap(0.4, 0.2, 0.6, 0.42) -
        omahaPricedRealizationCap(0.41, 0.2, 0.6, 0.42)
    ).toBeLessThan(0.02);
  });
  it('the mode is off outside a PLO4/PLO5 cash decision and off by default', () => {
    const on = { rangeContinuous: true, bluffShareFromBetRate: true };
    expect(omahaPricedModeOf(on, { gameVariant: 'plo5', gameMode: 'cash' })).toEqual(on);
    expect(omahaPricedModeOf(on, { gameVariant: 'plo4', bigBlind: 2 })).toEqual(on);
    expect(omahaPricedModeOf(on, { gameVariant: 'plo6', gameMode: 'cash' })).toBe(
      OMAHA_PRICED_MODE_OFF
    );
    expect(omahaPricedModeOf(on, { gameVariant: 'nlh', gameMode: 'cash' })).toBe(
      OMAHA_PRICED_MODE_OFF
    );
    expect(omahaPricedModeOf(on, { gameVariant: 'plo5', gameMode: 'tournament' })).toBe(
      OMAHA_PRICED_MODE_OFF
    );
    expect(
      omahaPricedModeOf(
        { rangeContinuous: false, bluffShareFromBetRate: false },
        { gameVariant: 'plo5' }
      )
    ).toBe(OMAHA_PRICED_MODE_OFF);
  });
});

describe('the bluff share follows the bet rate, with no label', () => {
  it('is the prior with no evidence, falls with a low bet rate and rises with a high one, continuously', () => {
    expect(omahaPricedBluffFactor(null)).toBe(1);
    expect(omahaPricedBluffFactor(1)).toBe(1);
    expect(omahaPricedBluffFactor(0.8)).toBeCloseTo(0.8 ** 1.5, 12);
    let last = 0;
    for (let r = 0.2; r <= 2.5; r += 0.01) {
      const k = omahaPricedBluffFactor(r);
      expect(k).toBeGreaterThanOrEqual(last - 1e-12);
      if (last > 0) expect(k - last).toBeLessThan(0.03);
      last = k;
    }
  });
  it('with the mode on the value-leader label does not cap and the maniac label does not floor', () => {
    const leader = {
      measured: true,
      betCheckedToRatio: 1,
      postflopManiac: false,
      valueLeader: true,
      sizeShown: null,
    };
    const maniac = {
      measured: true,
      betCheckedToRatio: 1,
      postflopManiac: true,
      valueLeader: false,
      sizeShown: null,
    };
    expect(omahaEvBluffShare(0.2, leader)).toBeCloseTo(0.2 * 0.65, 12);
    expect(omahaEvBluffShare(0.2, maniac)).toBeCloseTo(0.2 * 1.3, 12);
    withOmahaPricedMode({ rangeContinuous: false, bluffShareFromBetRate: true }, () => {
      expect(omahaEvBluffShare(0.2, leader)).toBeCloseTo(0.2, 12);
      expect(omahaEvBluffShare(0.2, maniac)).toBeCloseTo(0.2, 12);
      expect(omahaEvBluffShare(0.2, { ...leader, betCheckedToRatio: 0.7 })).toBeCloseTo(
        0.2 * 0.7 ** 1.5,
        12
      );
      expect(omahaEvBluffShare(0.2, null)).toBeCloseTo(0.2, 12);
    });
  });
  it('the bluffs are counted once: with the measured prior in force his rate is read against the rate it was measured at', () => {
    // He bets exactly as often as a person does on the river (0.319), less than the Horse mean (ratio 0.7).
    const person = {
      measured: true,
      betCheckedToRatio: 0.7,
      betCheckedTo: OMAHA_PRICED_PERSON_BET_CHECKED_TO.river,
      postflopManiac: false,
      valueLeader: false,
      sizeShown: null,
    };
    withOmahaPricedMode({ rangeContinuous: true, bluffShareFromBetRate: true }, () => {
      // the measured prior already holds a person's bluffs at a person's rate: not scaled again
      expect(omahaEvBluffShare(0.3, person, 'river')).toBeCloseTo(0.3, 12);
      // a player betting twice as often as a person carries more, by the same law and cap
      expect(
        omahaEvBluffShare(
          0.3,
          { ...person, betCheckedTo: 2 * OMAHA_PRICED_PERSON_BET_CHECKED_TO.river },
          'river'
        )
      ).toBeCloseTo(0.3 * 1.6, 12);
      // no absolute rate: nothing to scale by
      expect(omahaEvBluffShare(0.3, { ...person, betCheckedTo: null }, 'river')).toBeCloseTo(
        0.3,
        12
      );
    });
    // the stepped prior has no rate of its own: the Horse-mean ratio scales it, as before
    withOmahaPricedMode({ rangeContinuous: false, bluffShareFromBetRate: true }, () => {
      expect(omahaEvBluffShare(0.3, person, 'river')).toBeCloseTo(0.3 * 0.7 ** 1.5, 12);
    });
  });
});

describe('the opponent read: one interface, shrinkage continuous in the opportunity count', () => {
  it('a cell with no opportunity is the prior; each opportunity moves it a little; many move it fully', () => {
    expect(omahaPricedShrunk(null, 0.3)).toBe(0.3);
    expect(omahaPricedShrunk(cell(0, 0), 0.3)).toBe(0.3);
    let last = 0.3;
    for (let n = 1; n <= 200; n++) {
      const v = omahaPricedShrunk(cell(0.9 * n, n), 0.3);
      expect(v).toBeGreaterThan(last);
      expect(v - last).toBeLessThan(0.09);
      last = v;
    }
    expect(last).toBeGreaterThan(0.88);
  });
  it('no read is the priors; the pooled read is used without its labels; a street cell replaces it after shrinking toward it', () => {
    expect(omahaPricedRead(null, null)).toEqual(OMAHA_PRICED_NO_READ);
    const pooled = {
      hands: 50,
      measured: false,
      tightReRaiser: false,
      wideReRaiser: false,
      valueLeader: true,
      postflopAggressor: false,
      threeBet: stat(0.1, 20),
      betCheckedTo: stat(0.28, 40),
      foldToBet: stat(0.6, 30),
      riverCall: stat(0.2, 10),
    };
    const p = omahaPricedRead(pooled as never, POP);
    expect(p.source).toBe('pooled');
    // `measured: false` does not gate the figures: they are posterior means, continuous in n
    expect(p.foldToBet).toBeCloseTo(0.6, 12);
    expect(p.betRatio).toBeCloseTo(0.28 / 0.35, 12);
    const thin = omahaPricedRead(pooled as never, POP, {
      bet: cell(1, 1),
      foldToBet: null,
      foldToRaise: null,
    });
    const deep = omahaPricedRead(pooled as never, POP, {
      bet: cell(60, 100),
      foldToBet: null,
      foldToRaise: null,
    });
    expect(thin.source).toBe('street');
    expect(thin.betCheckedTo!).toBeGreaterThan(0.28);
    expect(thin.betCheckedTo!).toBeLessThan(0.4);
    expect(deep.betCheckedTo!).toBeGreaterThan(0.57);
    expect(deep.betCheckedTo!).toBeLessThan(0.6);
  });
  it('the spread of a read narrows with its opportunities', () => {
    const at = (n: number) =>
      omahaPricedReadSpread({ ...OMAHA_PRICED_NO_READ, opportunities: n }, 100);
    expect(at(0)).toBeGreaterThan(at(10));
    expect(at(10)).toBeGreaterThan(at(100));
    expect(at(1000)).toBeLessThan(2);
  });
});

describe('the opponent range is conditioned on the Horse own cards and known dead cards', () => {
  it('the king-high flush is beaten only by holdings with the ace of the suit: none when that ace is dead', () => {
    const hole = cards('KhTh2c8s4s');
    const board = cards('9dQdJh7h2h');
    const live = omahaEvHandCounts(hole, board, [], 0.2)!;
    expect(live.unseen).toBe(42);
    const beatenLive = 1 - live.all.win - live.all.tie;
    expect(beatenLive).toBeGreaterThan(0.03);
    const dead = omahaEvHandCounts(hole, board, cards('Ah'), 0.2)!;
    expect(dead.unseen).toBe(41);
    expect(1 - dead.all.win - dead.all.tie).toBeCloseTo(0, 12);
    const st = pricedSpot({ hole: 'KhTh2c8s4s', board: '9dQdJh7h2h' });
    const v = omahaPricedRaise(st.hero, st.gs, {})!;
    expect(v.beaten).toBeCloseTo(beatenLive, 4);
    // the bet-or-check and the sampled comparison draw opponent hands from the unseen cards only
    // (HorseOmahaCardImpact and HorseOmahaBigDrawAggression build their decks without the
    // Horse's cards, the board and the dead cards): a hand holding all four aces faces no ace.
    const aces = omahaPricedSampledRaise({
      street: 'flop',
      hole: cards('AhAdAcAs2c'),
      board: cards('Kh7d2s'),
      pot: 100,
      toCall: 50,
      stack: 900,
      heroBet: 0,
      currentBet: 50,
      to: 200,
      inPosition: true,
      opponents: [{ stack: 900, bet: 50, read: null }],
    })!;
    expect(aces.equities.all).toBeGreaterThan(0.4);
  });
});

describe('raise, call or fold on the exact hand (omahaPricedRaise)', () => {
  const act = (s: PricedSpot, read = OMAHA_PRICED_NO_READ) => {
    const st = pricedSpot(s);
    return omahaPricedRaise(st.hero, st.gs, { read })!;
  };
  it('with no read: the nuts raise, the second nuts call, a set on a flush board and air fold', () => {
    expect(act({ hole: 'AhKh2c8s4s', board: '9dQdJh7h2h' }).action).toBe('raise');
    const second = act({ hole: 'Kh3h2c8s4s', board: '9dQdJh7h2h' });
    expect(second.action).toBe('call');
    // the knowledge of "raise only with the nuts": a larger raise is continued against by better hands
    const wins = second.rows.map((r) => r.win);
    expect(wins[wins.length - 1]).toBeLessThan(wins[0]);
    expect(act({ hole: 'JcJs2s3s4c', board: '9dQdJh7h2h' }).action).toBe('fold');
    const air = act({ hole: '3d3c4c8s5s', board: '9dQdJh7h2h' });
    expect(air.action).toBe('fold');
    // against the population a pure bluff raise never has positive expected value at any size
    for (const r of air.rows) expect(r.ev).toBeLessThan(0);
  });
  it('a fold to a bet when checked to is not read as a fold to a raise', () => {
    const folderToBets = omahaPricedRead(
      {
        foldToBet: stat(0.9, 65),
        betCheckedTo: stat(0.27, 300),
        riverCall: stat(0.1, 65),
      } as never,
      POP
    );
    expect(act({ hole: '3d3c4c8s5s', board: '9dQdJh7h2h' }, folderToBets).action).toBe('fold');
  });
  it('a measured fold to raises prices the bluff in, a single observation does not', () => {
    const air: PricedSpot = { hole: '3d3c4c8s5s', board: '9dQdJh7h2h' };
    const deep = act(air, foldsToRaises(18, 20));
    expect(['raise', 'all_in']).toContain(deep.action);
    expect(deep.best!.value).toBe(false);
    expect(act(air, foldsToRaises(1, 1)).action).toBe('fold');
    // continuous: each further fold observed moves the bluff's value up without a jump
    let last = -Infinity;
    for (let n = 0; n <= 30; n++) {
      const ev = act(air, foldsToRaises(n, n)).best!.ev;
      expect(ev).toBeGreaterThanOrEqual(last);
      if (Number.isFinite(last)) expect(ev - last).toBeLessThan(0.2 * 648);
      last = ev;
    }
  });
});

describe('the rule site on the turn and river (omahaTurnRiverRaiseIsPriced)', () => {
  const LEGACY: HorseDecideOpts = { omahaTurnRiverRaiseNeedsNuts: true };
  const PRICED: HorseDecideOpts = { ...LEGACY, omahaTurnRiverRaiseIsPriced: true };
  const raiseOf = (st: ReturnType<typeof pricedSpot>): HorseDecision => ({
    action: 'raise',
    amount: st.gs.maxRaiseTo as number,
    thinkTime: 1000,
  });
  const CLASSES: Array<[string, PricedSpot]> = [
    ['turn top two pair (hand 59534208)', { hole: 'QcJd6c6d4h', board: '9dQdJh7h' }],
    ['turn bottom set, straight possible', { hole: '7c7d2s3s4c', board: '9dQdJh7h' }],
    ['turn non-nut straight', { hole: '8c6c2s3s4d', board: '9dQdJh7h' }],
    ['turn non-nut flush', { hole: '5d3d2c8s4s', board: '9dQdJh7h' }],
    ['river set', { hole: 'JcJs2s3s4c', board: '9dQdJh7h2h' }],
    ['river two pair', { hole: 'QcJs5s3s4c', board: '9dQdJh7h2c' }],
    ['river non-nut straight', { hole: '8c6c2s3s4d', board: '9dQdJh7h2c' }],
    ['river non-nut flush', { hole: '5h3h2c8s4s', board: '9dQdJh7h2h' }],
    [
      'river top set, a third of the pot, dry board',
      { hole: 'QcQs8s3s4c', board: '9dQh5s2cKd', bet: 72 },
    ],
  ];
  for (const [name, s] of CLASSES)
    it(`${name}: with no read the priced answer is the nut rule's answer; off it is that rule`, () => {
      const st = pricedSpot(s);
      const legacy = omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, LEGACY);
      enableBrainTelemetry();
      drainFires();
      const priced = omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, {
        ...PRICED,
        telemetry: true,
      });
      const fires = drainFires().map((f) => f.feature);
      expect(['call', 'fold']).toContain(legacy.action);
      expect(priced.action).toBe(legacy.action);
      expect(priced.amount ?? null).toBe(legacy.amount ?? null);
      expect(fires).toContain(
        priced.action === 'call' ? 'omaha_priced_raise_called' : 'omaha_priced_raise_folded'
      );
      // the categorical rule's own receipts are silent: it did not decide
      expect(fires.some((f) => f.startsWith('omaha_turn_river_raise_needs_nuts'))).toBe(false);
      if (priced.action === 'call')
        expect(omahaPricedAdmitsRaiseToCall(st.hero, st.gs, priced.amount)).toBe(true);
      const off = omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, {
        ...LEGACY,
        omahaTurnRiverRaiseIsPriced: false,
      });
      expect(off).toEqual(legacy);
    });
  it('the nuts keep their raise', () => {
    const st = pricedSpot({ hole: 'AhKh2c8s4s', board: '9dQdJh7h2h' });
    expect(omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, PRICED)).toEqual(
      raiseOf(st)
    );
  });
  it('against a player measured to fold to raises a raise the nut rule forbids is made, and a fold becomes a bluff raise', () => {
    omahaPricedSetStreetRatesSource(() => ({
      bet: null,
      foldToBet: null,
      foldToRaise: cell(18, 20),
    }));
    enableBrainTelemetry();
    for (const [, s] of CLASSES.slice(0, 8)) {
      const st = pricedSpot(s);
      expect(omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, LEGACY).action).not.toBe(
        'raise'
      );
      const kept = omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, PRICED);
      expect(kept).toEqual(raiseOf(st));
    }
    const st = pricedSpot({ hole: '3d3c4c8s5s', board: '9dQdJh7h2h' });
    drainFires();
    const bluff = omahaTurnRiverRaiseNeedsNutsRule(
      { action: 'fold', thinkTime: 1000 },
      st.hero,
      st.gs,
      {
        ...PRICED,
        telemetry: true,
      }
    );
    expect(bluff.action).toBe('raise');
    expect(st.gs.legalActions).toContain('raise');
    expect(bluff.amount!).toBeGreaterThanOrEqual(st.gs.minRaiseTo as number);
    expect(bluff.amount!).toBeLessThanOrEqual(st.gs.maxRaiseTo as number);
    expect(drainFires().map((f) => f.feature)).toContain('omaha_priced_raise_made_bluff');
    // one observation is not a read: the fold stands
    omahaPricedSetStreetRatesSource(() => ({
      bet: null,
      foldToBet: null,
      foldToRaise: cell(1, 1),
    }));
    expect(
      omahaTurnRiverRaiseNeedsNutsRule({ action: 'fold', thinkTime: 1000 }, st.hero, st.gs, PRICED)
        .action
    ).toBe('fold');
  });
  it('out of scope (PLO6, a tournament, the flop) the option does nothing', () => {
    const st = pricedSpot({ hole: 'QcJd6c6d4h', board: '9dQdJh7h' });
    expect(omahaPricedInScope(st.hero, st.gs)).toBe(true);
    expect(omahaPricedInScope(st.hero, { ...st.gs, gameMode: 'tournament' } as never)).toBe(false);
    expect(omahaPricedInScope(st.hero, { ...st.gs, gameVariant: 'plo6' } as never)).toBe(false);
    expect(omahaPricedInScope(st.hero, { ...st.gs, bombPot: true } as never)).toBe(false);
    const tourney = { ...st.gs, gameMode: 'tournament' } as never;
    expect(omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, tourney, PRICED)).toEqual(
      omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, tourney, LEGACY)
    );
  });
});

describe('bet or check (omahaOopTurnBarrelIsPriced, omahaPairedBoardBetIsPriced)', () => {
  const bet = (amount: number): HorseDecision => ({ action: 'bet', amount, thinkTime: 1000 });
  it('the out-of-position turn barrel: top set bets on; the comparison names the check when it is worth more', () => {
    const set = pricedSpot({ hole: 'QcQd6c5d2h', board: '9dQs3h7h', bet: 0, heroBetFlop: true });
    const v = omahaPricedBet(set.hero, set.gs, () => OMAHA_PRICED_NO_READ, 100)!;
    expect(v.proposed!.ev).toBeGreaterThan(v.evCheck);
    enableBrainTelemetry();
    drainFires();
    const kept = omahaPricedOopTurnBarrelRule(bet(100), set.hero, set.gs, {
      omahaOopTurnBarrelIsPriced: true,
      telemetry: true,
    });
    expect(kept).toEqual(bet(100));
    expect(drainFires().map((f) => f.feature)).toContain('omaha_priced_oop_turn_barrel_kept');
    expect(omahaPricedOopTurnBarrelRule(bet(100), set.hero, set.gs, {})).toBeNull();
  });
  it('a paired river: trips bet into the population and check to a player measured to fold to bets and to bet when checked to; air bets into him', () => {
    const trips = pricedSpot({
      hole: 'AcQd6c5d2h',
      board: '9dQsQh7h3c',
      bet: 0,
      heroBetTurn: true,
    });
    const ON: HorseDecideOpts = { omahaPairedBoardBetIsPriced: true };
    expect(omahaPricedPairedBoardBetRule(bet(100), trips.hero, trips.gs, ON)).toEqual(bet(100));
    // He folds 30 of 40 bets and bets 18 of 40 times when checked to: checking to him earns his bets.
    const folder = omahaPricedRead(null, POP, {
      bet: cell(18, 40),
      foldToBet: cell(30, 40),
      foldToRaise: null,
    });
    const vsFolder = omahaPricedBet(trips.hero, trips.gs, () => folder, 100)!;
    expect(vsFolder.action).toBe('check');
    // The same folder with no bet-rate read takes a person's measured river rate (0.319, not the
    // stated 0.45): he bets too rarely when checked to for the check to earn more than the bet.
    const folderNoBetRead = omahaPricedRead(null, POP, {
      bet: null,
      foldToBet: cell(30, 40),
      foldToRaise: null,
    });
    expect(omahaPricedBet(trips.hero, trips.gs, () => folderNoBetRead, 100)!.action).toBe('bet');
    const air = pricedSpot({ hole: 'AcKd6c5d2h', board: '9dQsQh7h3c', bet: 0 });
    const none = omahaPricedBet(air.hero, air.gs, () => OMAHA_PRICED_NO_READ)!;
    expect(none.action).toBe('check');
    const bluff = omahaPricedBet(air.hero, air.gs, () => folder)!;
    expect(['bet', 'all_in']).toContain(bluff.action);
    expect(bluff.best!.value).toBe(false);
  });
});

describe('mixing (omahaPricedMix)', () => {
  it('one half at no gap, nothing at a gap of one uncertainty, and no chip constant', () => {
    expect(omahaPricedMixProbability(0, 10)).toBe(0.5);
    expect(omahaPricedMixProbability(5, 10)).toBeCloseTo(0.25, 12);
    expect(omahaPricedMixProbability(10, 10)).toBe(0);
    expect(omahaPricedMixProbability(50, 10)).toBe(0);
    expect(omahaPricedMixProbability(1, 0)).toBe(0);
    // scale free: the same gap in units of the uncertainty gives the same probability
    expect(omahaPricedMixProbability(3, 6)).toBe(omahaPricedMixProbability(300, 600));
  });
  it('the draw is keyed on public state only: the hole cards do not move it', () => {
    const a = pricedSpot({ hole: 'QcJd6c6d4h', board: '9dQdJh7h' });
    const b = pricedSpot({ hole: 'AsKs2c3c4d', board: '9dQdJh7h' });
    expect(omahaPricedPublicSpotKey(a.hero, a.gs)).toBe(omahaPricedPublicSpotKey(b.hero, b.gs));
    const c = pricedSpot({ hole: 'QcJd6c6d4h', board: '9dQdJh7h', bet: 108 });
    expect(omahaPricedPublicSpotKey(c.hero, c.gs)).not.toBe(omahaPricedPublicSpotKey(a.hero, a.gs));
  });
});

describe('through the whole decision', () => {
  const SPOTS: Array<[string, PricedSpot]> = [
    ['turn top two facing a pot bet', { hole: 'QcJd6c6d4h', board: '9dQdJh7h' }],
    ['river nut flush facing a pot bet', { hole: 'AhKh2c8s4s', board: '9dQdJh7h2h' }],
    ['river second-nut flush facing a pot bet', { hole: 'Kh3h2c8s4s', board: '9dQdJh7h2h' }],
    ['turn top set facing half the pot', { hole: 'QcQs2s3s4c', board: '9dQd5h7h', bet: 108 }],
    [
      'turn top set facing a third of the pot in position',
      { hole: 'QcQs2s3s4c', board: '9dQh5s2c', bet: 72, inPosition: true },
    ],
    ['flop nut flush draw and wrap facing a pot bet', { hole: 'AhKhJcTc2s', board: 'Qh9h3d' }],
    [
      'turn overpair out of position after the flop bet was called',
      { hole: 'AcAd6c5d2h', board: '9dQs3h7h', bet: 0, heroBetFlop: true },
    ],
    [
      'paired river trips first to act after the turn bet was called',
      { hole: 'AcQd6c5d2h', board: '9dQsQh7h3c', bet: 0, heroBetTurn: true },
    ],
    [
      'paired river air checked to',
      { hole: 'AcKd6c5d2h', board: '9dQsQh7h3c', bet: 0, inPosition: true },
    ],
  ];
  const SEEDS = [1, 3, 7, 11, 42, 2026];
  // The think time is not part of the comparison: with horseActionTimeIsPublicOnly on (it is, in
  // production) it is drawn apart from the decision's seeded stream.
  const bytes = (d: unknown) =>
    JSON.stringify(withoutMeasurements({ ...(d as object), thinkTime: 0 }));
  it('every priced option unset, false and a truthy non-boolean is byte-identical to today', () => {
    for (const [, s] of SPOTS) {
      const st = pricedSpot(s);
      for (const seed of SEEDS.slice(0, 3)) {
        const base = bytes(decideAt(st, LIVE_OPTIONS, seed));
        expect(bytes(decideAt(st, { ...LIVE_OPTIONS, ...allPriced(false) }, seed))).toBe(base);
        const truthy = Object.fromEntries(
          PRICED_OPTIONS.map((o) => [o, 1])
        ) as never as HorseDecideOpts;
        expect(bytes(decideAt(st, { ...LIVE_OPTIONS, ...truthy }, seed))).toBe(base);
        const bare = bytes(decideAt(st, {}, seed));
        expect(bytes(decideAt(st, allPriced(false), seed))).toBe(bare);
      }
    }
  });
  it('every option on, alone and together: every decision is legal and passes the receipt validator', () => {
    const configs: HorseDecideOpts[] = [
      { ...LIVE_OPTIONS, ...allPriced(true) },
      ...PRICED_OPTIONS.map((o) => ({ ...LIVE_OPTIONS, [o]: true }) as HorseDecideOpts),
      allPriced(true),
    ];
    let changed = 0;
    for (const [, s] of SPOTS) {
      const st = pricedSpot(s);
      for (const seed of SEEDS) {
        const base = decideAt(st, LIVE_OPTIONS, seed);
        for (const opts of configs) {
          const d = decideAt(st, opts, seed);
          expect(st.gs.legalActions).toContain(d.action);
          if (d.action === 'raise' || d.action === 'bet') {
            expect(d.amount!).toBeGreaterThanOrEqual((st.gs.minRaiseTo as number) - 1e-9);
            expect(d.amount!).toBeLessThanOrEqual((st.gs.maxRaiseTo as number) + 1e-9);
          }
          expect(
            horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
              player: st.hero,
              gameState: st.gs,
              // the decision's own priced-raise gate (the client builds it from the options it ran)
              omahaPricedRaise: pricedRaiseGateOf(opts),
            })
          ).toBeNull();
          if (d.action !== base.action) changed++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[priced, whole decision] actions changed from today: ${changed}`);
  });
  it('the same decision asked twice draws the same mix (fast, deep and retried decisions agree)', () => {
    const st = pricedSpot({ hole: 'AcAd6c5d2h', board: '9dQs3h7h', bet: 0, heroBetFlop: true });
    const opts = { ...LIVE_OPTIONS, ...allPriced(true) };
    for (const seed of SEEDS)
      expect(bytes(decideAt(st, opts, seed))).toBe(bytes(decideAt(st, opts, seed)));
  });
});

describe('the measured person bet rate stands in for the stated prior when there is no read', () => {
  it('by street, and the card-impact prior only where no street is given', () => {
    expect(OMAHA_PRICED_PERSON_BET_CHECKED_TO).toEqual({ flop: 0.289, turn: 0.343, river: 0.319 });
    for (const street of ['turn', 'river'])
      expect(omahaPricedCardImpactRead(OMAHA_PRICED_NO_READ, street).betCheckedTo).toBe(
        OMAHA_PRICED_PERSON_BET_CHECKED_TO[street]
      );
    expect(omahaPricedCardImpactRead(OMAHA_PRICED_NO_READ).betCheckedTo).toBe(0.45);
    // a read of him always wins over the population
    expect(
      omahaPricedCardImpactRead({ ...OMAHA_PRICED_NO_READ, betCheckedTo: 0.6 }, 'river')
        .betCheckedTo
    ).toBe(0.6);
  });
});
