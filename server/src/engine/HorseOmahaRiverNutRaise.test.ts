/**
 * ONLY THE NUTS RAISE AN OMAHA RIVER BET, AND A SET POUNDS THE TURN.
 *
 * Hand 59401453 (PLO5 1/2, six handed, 2026-11-14). A Horse with top set bet
 * 24 into 52 on A-6-T two clubs, bet 42 into 100 when an 8 came (a straight
 * became possible, the club draw was live), and on a queen river (no pair, no
 * possible flush, three possible straights) faced a full-pot lead of 184 and
 * moved all in for 314.35. It was called by the nut straight.
 *
 * The owner's ruling: facing a river bet a Horse without the nuts never
 * raises, whoever the bettor is; it calls at most and leans toward folding.
 * A strong, vulnerable made hand on the turn bets big.
 *
 * The nodes below are the hand's own public record (the complaint fixture);
 * the variations change one thing at a time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import {
  omahaRiverNutRaiseInScope,
  omahaRiverNutRaiseOnly,
  omahaRiverRaiseLicense,
} from './HorseOmahaRiverNutRaise.js';
import { V81_RIVER_SET_CELL, v81Cell, type V81Input } from './HorseOmahaBigBetCalls.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  omahaSlowplayAdmitsCall,
  omahaSlowplayCallScope,
} from './HorseOmahaStrongHandSlowplayMix.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { omahaRaiseNeedsNutsAdmitsCall } from './HorseOmahaTurnRiverRaiseNeedsNuts.js';
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import FIXTURE from './horseComplaints/plo5-top-set-jams-over-a-pot-river-lead.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

const HERO_SEAT = 4;
const TURN_ORD = 20;
const RIVER_ORD = 23;
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const LIVE = replayProfiles('cash').find((p) => p.live)!;

/** The Horse's own cards, read from the fixture (never retyped here). */
const HELD = FX.hole[String(HERO_SEAT)];
const heldText = HELD.map((c) => c.rank + c.suit[0]).join('');

interface Variation {
  ord?: number;
  hole?: string;
  variant?: 'plo4' | 'plo5' | 'plo6' | 'plo8';
  /** Edit the recorded public snapshot. */
  node?: (pn: ComplaintPublicNode) => void;
  /** Edit the recorded actions before the decision. */
  actions?: (fx: ComplaintFixture) => void;
}

function spot(v: Variation = {}) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  if (v.hole) fx.hole[String(HERO_SEAT)] = cards(v.hole);
  v.actions?.(fx);
  const node = fx.actions.find((a) => a.ord === (v.ord ?? RIVER_ORD))!;
  if (v.variant) {
    fx.variant = v.variant;
    node.publicNode!.variant = v.variant;
  }
  v.node?.(node.publicNode!);
  return stateAt(fx, node);
}

type Built = ReturnType<typeof spot>;
interface Run {
  action: string;
  amount: number | null;
  fires: string[];
}

function decideMany(s: Built, opts: Record<string, unknown> = {}, seeds = SEEDS): Run[] {
  enableBrainTelemetry();
  return seeds.map((seed) => {
    seedFastRandom(seed);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    } as never);
    return {
      action: d.action,
      amount: typeof d.amount === 'number' ? d.amount : null,
      fires: drainFires().map((f) => f.feature),
    };
  });
}

/** A raise, or an all-in for more than the call. */
const raises = (s: Built, runs: Run[]) =>
  runs.filter(
    (r) => r.action === 'raise' || (r.action === 'all_in' && s.hero.stack > (s.gs.toCall ?? 0))
  ).length;
const count = (runs: Run[], action: string) => runs.filter((r) => r.action === action).length;
const fired = (runs: Run[], feature: string) =>
  runs.filter((r) => r.fires.includes(feature)).length;
const same = (a: Run[], b: Run[]) =>
  expect(a.map((r) => [r.action, r.amount])).toEqual(b.map((r) => [r.action, r.amount]));

/** Deep stacks, so a pot raise (not only an all-in) is on the menu. */
const deep = (pn: ComplaintPublicNode) => {
  pn.seats[0][1] = 2000;
  pn.seats[HERO_SEAT - 1][1] = 2000;
  pn.minRaiseTo = 368;
  pn.maxRaiseTo = 736;
  pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
};

const NUT_STRAIGHT = 'KdJc7d2h2s';
const OFF = { omahaRiverNutRaiseOnly: false };

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('hand 59401453, river: three aces facing a full-pot lead', () => {
  it('the node is the recorded one', () => {
    const s = spot();
    expect(s.gs.stage).toBe('river');
    expect(s.gs.gameVariant).toBe('plo5');
    expect(s.gs.toCall).toBe(184);
    expect(s.gs.pot).toBe(368);
    expect(s.hero.stack).toBe(314.35);
    expect(omahaRiverNutRaiseInScope(s.hero, s.gs)).toBe(true);
    expect(omahaRiverRaiseLicense(s.hero, s.gs)).toBeNull();
  });

  it('never raises, at any seed, with the opponent memory off or on', () => {
    for (const opts of [{}, { mind: undefined }]) {
      const s = spot();
      const runs = decideMany(s, opts);
      expect(raises(s, runs)).toBe(0);
      expect(count(runs, 'fold') + count(runs, 'call')).toBe(SEEDS.length);
      // Every seed reached the raise and had it taken away: not a vacuous pass.
      expect(fired(runs, 'omaha_river_non_nut_raise_flatted')).toBe(SEEDS.length);
    }
  });

  it('leans to the fold: the call of a pot-sized river bet with a set is the V81 set cell', () => {
    const runs = decideMany(spot());
    expect(count(runs, 'fold')).toBe(SEEDS.length);
    expect(fired(runs, 'v81_river_set_big_bet_fold')).toBe(SEEDS.length);
  });

  it('control: with the rule off the recorded all-in comes back', () => {
    const s = spot();
    expect(raises(s, decideMany(s, OFF))).toBe(SEEDS.length);
  });

  it('a bettor measured as a postflop over-bluffer is called, never raised', () => {
    const s = spot();
    vi.spyOn(HorseMind, 'opponentRead').mockImplementation(((id: string) =>
      id === 'p1' ? { stats: { betCheckedTo: { engaged: 'high', mean: 0.9 } } } : null) as never);
    const runs = decideMany(s);
    expect(raises(s, runs)).toBe(0);
    expect(count(runs, 'call')).toBe(SEEDS.length);
    expect(fired(runs, 'v81_river_set_big_bet_fold')).toBe(0);
  });
});

describe('the rule across PLO4, PLO5 and PLO6', () => {
  const HOLES: Record<string, Record<'plo4' | 'plo5' | 'plo6', string>> = {
    'top set': { plo4: 'AdAc7d2h', plo5: heldText, plo6: 'AdAc7d2h2s3c' },
    'second-nut straight': { plo4: 'Jd9c7d2h', plo5: 'Jd9c7d2h2s', plo6: 'Jd9c7d2h2s3c' },
    'top two pair': { plo4: 'AdQc7d2h', plo5: 'AdQc7d2h2s', plo6: 'AdQc7d2h2s3c' },
  };
  for (const [name, byVariant] of Object.entries(HOLES))
    for (const variant of ['plo4', 'plo5', 'plo6'] as const)
      it(`${variant} ${name}: no raise over the river bet, all in or not`, () => {
        for (const node of [undefined, deep]) {
          const s = spot({ variant, hole: byVariant[variant], node });
          expect(omahaRiverRaiseLicense(s.hero, s.gs)).toBeNull();
          expect(raises(s, decideMany(s, {}, SEEDS.slice(0, 20)))).toBe(0);
        }
      });

  it('the nuts still raise: the pot when it is on the menu, all in when it is not', () => {
    for (const variant of ['plo4', 'plo5', 'plo6'] as const) {
      const hole =
        variant === 'plo4' ? 'KdJc7d2h' : variant === 'plo5' ? NUT_STRAIGHT : 'KdJc7d2h2s3c';
      const shallow = spot({ variant, hole });
      expect(omahaRiverRaiseLicense(shallow.hero, shallow.gs)).toBe('nuts');
      const jams = decideMany(shallow, {}, SEEDS.slice(0, 10));
      expect(count(jams, 'all_in')).toBe(10);
      const s = spot({ variant, hole, node: deep });
      const runs = decideMany(s, {}, SEEDS.slice(0, 10));
      expect(count(runs, 'raise')).toBe(10);
      expect(runs.every((r) => r.amount === 736)).toBe(true);
      expect(fired(runs, 'omaha_river_non_nut_raise_flatted')).toBe(0);
    }
  });

  it('an all-in that is itself the call is a call and is left alone', () => {
    const s = spot({ node: (pn) => (pn.seats[HERO_SEAT - 1][1] = 150) });
    const shove: HorseDecision = { action: 'all_in', thinkTime: 0 };
    expect(omahaRiverNutRaiseOnly(shove, s.hero, s.gs, true)).toEqual({
      decision: shove,
      changed: null,
    });
    const runs = decideMany(s, {}, SEEDS.slice(0, 20));
    expect(fired(runs, 'omaha_river_non_nut_raise_flatted')).toBe(0);
    expect(fired(runs, 'v81_river_set_big_bet_fold')).toBe(0);
    expect(count(runs, 'all_in')).toBe(20);
    same(runs, decideMany(s, { ...OFF }, SEEDS.slice(0, 20)));
  });
});

describe('what the rule leaves alone', () => {
  it('a river that faces no bet', () => {
    const checkedTo: Variation = {
      actions: (fx) => {
        const lead = fx.actions.find((a) => a.ord === 22)!;
        lead.action = 'check';
        lead.amount = 0;
      },
      node: (pn) => {
        pn.pot = 184;
        pn.toCall = 0;
        pn.currentBet = 0;
        pn.seats[0] = [1, 1034.8, 0, 78, 2, 0, 0];
        pn.minRaiseTo = 2;
        pn.maxRaiseTo = 184;
        pn.legalActions = ['fold', 'check', 'bet', 'all_in'];
      },
    };
    for (const hole of [heldText, NUT_STRAIGHT]) {
      const s = spot({ ...checkedTo, hole });
      expect(omahaRiverNutRaiseInScope(s.hero, s.gs)).toBe(false);
      same(decideMany(s), decideMany(s, OFF));
    }
  });

  it('hi-lo, a second board, fixed limit, all-in-or-fold, the turn and hold’em are out of scope', () => {
    const s = spot();
    const out = (gs: Partial<HorseGameStateV2>, hero: SeatPlayer = s.hero) =>
      expect(omahaRiverNutRaiseInScope(hero, { ...s.gs, ...gs } as HorseGameStateV2)).toBe(false);
    out({ variantRules: { splitLow8OrBetter: true } as never });
    out({ gameVariant: 'plo8', variantRules: undefined }, { ...s.hero, cards: cards('AdAc7d2h') });
    out({ communityCards2: cards('Kh9d5c3s2c') });
    out({ boardCount: 2 });
    out({ bettingStructure: 'fixed_limit' });
    out({ allInOrFold: true });
    out({ stage: 'turn' });
    out({ gameVariant: 'nlh' }, { ...s.hero, cards: cards('AdAc') });
    out({ toCall: 0, currentBet: 0 });
    const jam: HorseDecision = { action: 'all_in', thinkTime: 0 };
    expect(omahaRiverNutRaiseOnly(jam, s.hero, s.gs, false).changed).toBeNull();
    expect(omahaRiverNutRaiseOnly(jam, s.hero, s.gs, true).decision).toMatchObject({
      action: 'call',
      amount: 184,
    });
  });

  it('hi-lo decisions are the same with the rule on and off', () => {
    const s = spot({ variant: 'plo8', hole: 'AdAc7d2h' });
    same(decideMany(s, {}, SEEDS.slice(0, 20)), decideMany(s, OFF, SEEDS.slice(0, 20)));
  });

  it('a fold a later owner raised over comes back as the fold', () => {
    const s = spot();
    const raise: HorseDecision = { action: 'all_in', thinkTime: 0 };
    const fold: HorseDecision = { action: 'fold', thinkTime: 0 };
    expect(omahaRiverNutRaiseOnly(raise, s.hero, s.gs, true, fold)).toMatchObject({
      decision: { action: 'fold' },
      changed: 'fold_restored',
    });
  });
});

describe('the worker receipt for the raise that became a call', () => {
  /** The same river facing 100 into 184: under 0.9 pot, so the call is not the V81 set cell. */
  const smaller: Variation = {
    actions: (fx) => {
      fx.actions.find((a) => a.ord === 22)!.amount = 100;
    },
    node: (pn) => {
      pn.pot = 284;
      pn.toCall = 100;
      pn.currentBet = 100;
      pn.seats[0] = [1, 934.8, 100, 178, 2, 0, 0];
    },
  };
  const decideOne = (s: Built) => {
    seedFastRandom(7);
    HorseMind.reset();
    return structuredClone(
      HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, { mind: false, telemetry: false })
    );
  };

  it('is a priced call the validator admits with the request, as the production client validates', () => {
    const s = spot(smaller);
    const d = decideOne(s);
    expect({ action: d.action, amount: d.amount }).toEqual({ action: 'call', amount: 100 });
    const node = d.policyGraph!.transitions.find((t) => t.node === 'wager_rules')!;
    expect(node.before?.action).toBe('all_in');
    expect(node.after).toMatchObject({ action: 'call', amount: 100 });
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { player: s.hero, gameState: s.gs })
    ).toBeNull();
    // Without the request the rule cannot be re-run, so the receipt is not admitted.
    expect(horseDecisionReceiptRefusal(structuredClone(d), 'plo5')).toBe('policy_graph');
  });

  it('is admitted against a nut-class request (the slow-play mix), and refused against a request that could not have produced it', () => {
    const s = spot(smaller);
    const d = decideOne(s);
    // The same receipt against a request in which the Horse holds the nuts is
    // admitted since omahaStrongHandSlowplayMix (owner 2026-11-15 14:13): a
    // nut-class raise facing a bet may become the call, and the request
    // carries neither the option nor the draw (omahaSlowplayAdmitsCall).
    const nuts = spot({ ...smaller, hole: NUT_STRAIGHT });
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: nuts.hero,
        gameState: nuts.gs,
      })
    ).toBeNull();
    // STILL REFUSED, PLO5, a hand that is NOT nut class: the same raise that
    // became a call of 100 against the recorded request, in which 184 is owed
    // (three aces, no nut-class hand). No rule turns a raise into a call of
    // chips the request does not owe, and the slow-play admission needs a
    // nut-class hand.
    const owes184 = spot();
    expect(owes184.gs.toCall).toBe(184);
    expect(omahaRiverRaiseLicense(owes184.hero, owes184.gs)).toBeNull();
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: owes184.hero,
        gameState: owes184.gs,
      })
    ).toBe('policy_graph');
    // And never in a game the rule does not govern.
    expect(horseDecisionReceiptRefusal(structuredClone(d), 'nlh')).not.toBeNull();
  });
});

describe('the slow-play admission on the river needs a nut-class hand (review note N4)', () => {
  const smaller: Variation = {
    actions: (fx) => {
      fx.actions.find((a) => a.ord === 22)!.amount = 100;
    },
    node: (pn) => {
      pn.pot = 284;
      pn.toCall = 100;
      pn.currentBet = 100;
      pn.seats[0] = [1, 934.8, 100, 178, 2, 0, 0];
    },
  };

  it('refuses the exact call of 100 in the same river spot with a hand that is not nut class; the whole receipt is admitted there only by the turn-and-river raise rule', () => {
    // The recorded river, 100 owed, the Horse's own cards: three aces, not nut class.
    const s = spot(smaller);
    expect(s.gs.toCall).toBe(100);
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(false);
    // The mix's spot holds for exactly these chips; only the nut-class condition fails.
    expect(omahaSlowplayCallScope(s.hero, s.gs)).toMatchObject({ street: 'river', paid: 100 });
    expect(omahaSlowplayAdmitsCall(s.hero, s.gs, 100)).toBe(false);
    // The same chips with the nut straight: admitted by the mix.
    const nuts = spot({ ...smaller, hole: NUT_STRAIGHT });
    expect(omahaNutClassNow(nuts.hero, nuts.gs)).toBe(true);
    expect(omahaSlowplayAdmitsCall(nuts.hero, nuts.gs, 100)).toBe(true);
    // On the river the turn-and-river raise rule (omahaTurnRiverRaiseNeedsNuts)
    // turns every non-nut raise facing a bet into a call, so the whole
    // validator admits this receipt through that rule, not through the mix.
    // There is no river request that isolates the mix at the receipt level;
    // the turn case is in HorseOmahaMadeHandDefense.test.ts.
    expect(omahaRaiseNeedsNutsAdmitsCall(s.hero, s.gs, 100)).toBe(true);
  });
});

describe('the license', () => {
  const at = (hole: string, board: string) => {
    const s = spot({ hole });
    return omahaRiverRaiseLicense(s.hero, { ...s.gs, communityCards: cards(board) });
  };
  it('the exact nuts and the effective-nut classes hold it; everything else does not', () => {
    const RIVER = 'As6cTc8dQh';
    expect(at(NUT_STRAIGHT, RIVER)).toBe('nuts');
    expect(at(heldText, RIVER)).toBeNull(); // top set under three straights
    expect(at('Jd9c7d2h2s', RIVER)).toBeNull(); // a straight a bigger straight beats
    expect(at('9d7c5d2h2s', RIVER)).toBeNull();
    // Flushes: the nut flush on an unpaired board; no flush on a paired one.
    expect(at('KhQh5d3s2s', 'Ah9h4h7c2d')).toBe('nuts');
    expect(at('QhJh5d3s2s', 'Ah9h4h7c2d')).toBeNull();
    expect(at('KhQh5d3s2s', 'Ah9h4h7c7d')).toBeNull();
    // A nut straight is not a raise when a flush is possible.
    expect(at('KdJc7d2s2c', 'AhTh8hQs6c')).toBeNull();
    // Boats: one exact holding making quads leaves the effective nuts; a bigger boat does not.
    expect(at('AsAc7d3s3c', '9s9dAh5c2d')).toBe('effective_nuts');
    expect(at('5h5d7d3s3c', '9s9dAh5c2d')).toBeNull();
  });
});

describe('V81: the river set cell', () => {
  const base: V81Input = {
    variant: 'plo5',
    street: 'river',
    hole: HELD,
    board: cards('As6cTc8dQh'),
    potFrac: 1,
    effectiveBB: 150,
    tournament: false,
    headsUpTable: false,
    bountyEvent: false,
    hiLo: false,
    multiBoard: false,
    bombPot: false,
    heroHasStreetChips: false,
    bettorOverBluffs: false,
    callPrice: 1 / 3,
    riverSetCell: true,
  };
  it('is admitted on the river only, with every V81 exclusion kept', () => {
    expect(v81Cell(base)).toBe(V81_RIVER_SET_CELL);
    expect(v81Cell({ ...base, variant: 'plo4', hole: cards('AdAc7d2h') })).toBe(V81_RIVER_SET_CELL);
    expect(v81Cell({ ...base, riverSetCell: false })).toBeNull();
    expect(v81Cell({ ...base, riverSetCell: undefined })).toBeNull();
    expect(v81Cell({ ...base, street: 'turn', board: cards('As6cTc8d') })).toBeNull();
    expect(v81Cell({ ...base, potFrac: 0.89 })).toBeNull();
    expect(v81Cell({ ...base, bettorOverBluffs: true })).toBeNull();
    expect(v81Cell({ ...base, headsUpTable: true })).toBeNull();
    expect(v81Cell({ ...base, heroHasStreetChips: true })).toBeNull();
    expect(v81Cell({ ...base, callPrice: 0.12 })).toBeNull();
    expect(v81Cell({ ...base, effectiveBB: 20 })).toBeNull();
    expect(v81Cell({ ...base, bombPot: true })).toBeNull();
    expect(v81Cell({ ...base, hiLo: true })).toBeNull();
    // A set on a board with no possible straight or flush is not the cell.
    expect(v81Cell({ ...base, hole: cards('KdKc7d3h3s'), board: cards('Ks8c3d2hQh') })).toBeNull();
    expect(v81Cell({ ...base, variant: 'plo6', hole: cards('AdAc7d2h2s3c') })).toBeNull();
  });
});

describe('hand 59401453, turn: top set when the straight card comes', () => {
  const POT = 100;
  const bets = (runs: Run[]) => runs.filter((r) => r.action === 'bet').map((r) => r.amount ?? 0);

  it('bets big at every seed, with the opponent memory off or on', () => {
    for (const opts of [{}, { mind: undefined }]) {
      const runs = decideMany(spot({ ord: TURN_ORD }), opts);
      expect(count(runs, 'bet')).toBe(SEEDS.length);
      expect(Math.min(...bets(runs))).toBeGreaterThanOrEqual(0.75 * POT);
      expect(fired(runs, 'omaha_turn_set_pound')).toBe(SEEDS.length);
    }
  });

  it('control: with the rule off the half-pot small ball (and the check) come back', () => {
    const off = { omahaTurnSetPound: false };
    const live = decideMany(spot({ ord: TURN_ORD }), { ...off, mind: undefined });
    expect(Math.max(...bets(live))).toBeLessThanOrEqual(0.5 * POT);
    const blind = decideMany(spot({ ord: TURN_ORD }), off);
    expect(count(blind, 'check')).toBeGreaterThan(0);
    expect(Math.max(...bets(blind))).toBeLessThanOrEqual(0.5 * POT);
  });

  it('PLO4 and PLO6 sets pound the same turn', () => {
    for (const [variant, hole] of [
      ['plo4', 'AdAc7d2h'],
      ['plo6', 'AdAc7d2h2s3c'],
    ] as const) {
      const runs = decideMany(spot({ ord: TURN_ORD, variant, hole }), { mind: undefined });
      expect(bets(runs).length).toBeGreaterThan(0);
      expect(Math.min(...bets(runs))).toBeGreaterThanOrEqual(0.75 * POT);
    }
  });

  it('a turn with three of a suit, a set that is not one, and hi-lo keep today', () => {
    const today = (v: Variation) => {
      const s = spot({ ord: TURN_ORD, ...v });
      const on = decideMany(s, { mind: undefined }, SEEDS.slice(0, 20));
      expect(fired(on, 'omaha_turn_set_pound')).toBe(0);
      same(on, decideMany(s, { omahaTurnSetPound: false, mind: undefined }, SEEDS.slice(0, 20)));
    };
    today({ node: (pn) => (pn.boards = ['As6cTc8c']) });
    today({ hole: 'AdTd7d2h2s' }); // top two pair
    today({ variant: 'plo8', hole: 'AdAc7d2h' });
  });
});
