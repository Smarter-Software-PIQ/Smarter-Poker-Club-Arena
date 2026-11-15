/**
 * plo6NoMultiwayBetWithWeakMadeHand THROUGH HorseLogic.decide (PLO6 lane
 * 2026-11-15; the rule and its own cases are HorsePlo6MultiwayWeakBet.ts and
 * its test).
 *
 * What is pinned here:
 *  - unset and false are the same decision, byte for byte and seed by seed,
 *    and the receipt never fires (the option is default OFF);
 *  - on, every bet in the spot becomes a check and the receipt fires once
 *    for each bet that became one;
 *  - on, nothing changes heads-up, in PLO5, facing a bet, with the
 *    qualifying draw, or with a nut-class hand;
 *  - a rule that runs after the own-bet rules and proposes a bet does not
 *    turn the check back into a bet (omahaOwnerRuledFinal keeps it).
 *
 * The spot is synthetic: a three-way PLO6 cash flop, the Horse raised before
 * the flop, both blinds called and checked to it. Every hand and board here
 * is invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  PLO6_MULTIWAY_WEAK_BET_RECEIPT,
  plo6MultiwayWeakBetSpot,
} from './HorsePlo6MultiwayWeakBet.js';

const forced = vi.hoisted(() => ({
  /** the big-draw rule proposes a bet wherever it is asked about a check */
  laterRuleBets: false,
}));
vi.mock('./HorseOmahaBigDrawAggression.js', async (original) => {
  const real = await original<typeof import('./HorseOmahaBigDrawAggression.js')>();
  return {
    ...real,
    omahaBigDrawVerdict: (i: { action: string; pot: number }) => {
      if (forced.laterRuleBets && i.action === 'check')
        return {
          draw: null,
          wager: { action: 'bet', amount: Math.round(i.pot * 50) / 100 },
          withheld: null,
          foldEquity: 0,
          equities: null,
          evAggressive: 1,
          evPassive: 0,
        };
      return (real.omahaBigDrawVerdict as (x: unknown) => unknown)(i);
    },
  };
});

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map((t) => ({ rank: t[0] as CardRank, suit: SUIT[t[1]] }));

const HERO = 4;
const NODE = 12;
const RECEIPT = 'plo6_multiway_weak_made_hand_bet_checked';
const KEPT = 'omaha_owner_ruled_check_kept';
const ON: HorseDecideOpts = { plo6NoMultiwayBetWithWeakMadeHand: true };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** Queen, ace, five with two spades. */
const BOARD = 'QdAs5s';
/** A five (a pair below the top card), threes under it, no qualifying draw. */
const LOW_PAIR = '3s3d4s6d5hQs';
/** Nines and fives on K 5 9: the two lowest ranks of the flop. */
const BOTTOM_TWO: Over = { hole: '5c6d9h8hAhQd', board: 'Kd5s9d' };
/** A pair of fives on T 5 K two hearts, no heart draw to the nuts. */
const FIVES: Over = { hole: '7d5d4d9h2sJh', board: 'Ts5hKh' };

interface Over {
  hole?: string;
  board?: string;
  variant?: string;
  /** the big blind folded before the flop: one opponent */
  headsUp?: boolean;
  /** the big blind bets the flop: the Horse faces a wager */
  facingBet?: boolean;
}

function fixture(o: Over = {}): ComplaintFixture {
  const variant = o.variant ?? 'plo6';
  const headsUp = o.headsUp === true;
  const facing = o.facingBet === true;
  const pot = (headsUp ? 1.95 : 2.55) + (facing ? 1.5 : 0);
  const preflop: ComplaintAction[] = [
    { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 0.1 },
    { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 0.25 },
    { ord: 4, seat: 3, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 5, seat: 4, stage: 'preflop', action: 'raise', amount: 0.85, isFullRaise: true },
    { ord: 6, seat: 5, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 7, seat: 6, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 8, seat: 1, stage: 'preflop', action: 'call', amount: 0.75 },
    headsUp
      ? { ord: 9, seat: 2, stage: 'preflop', action: 'fold', amount: 0 }
      : { ord: 9, seat: 2, stage: 'preflop', action: 'call', amount: 0.6 },
    { ord: 10, seat: 1, stage: 'flop', action: 'check', amount: 0 },
  ];
  if (!headsUp)
    preflop.push(
      facing
        ? { ord: 11, seat: 2, stage: 'flop', action: 'bet', amount: 1.5, isFullRaise: true }
        : { ord: 11, seat: 2, stage: 'flop', action: 'check', amount: 0 }
    );
  return {
    version: 1,
    slug: 'plo6-multiway-weak-bet-synthetic',
    title: 'synthetic PLO6 three-way flop checked to the preflop raiser',
    complaint: 'synthetic',
    handId: 'synthetic',
    fmt: 'cash',
    variant,
    players: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, isHorse: true })),
    hole: { [HERO]: cards(o.hole ?? LOW_PAIR) },
    actions: [
      ...preflop,
      {
        ord: NODE,
        seat: HERO,
        stage: 'flop',
        action: 'check',
        amount: 0,
        publicNode: {
          pot,
          ante: 0,
          anteType: 'none',
          mode: 'cash',
          asset: 'chips',
          seats: [
            [1, 40.02, 0, 0.85, 0, 0, 0],
            headsUp
              ? [2, 92.93, 0, 0.25, 0, 0, 1]
              : [2, 92.93 - (facing ? 1.5 : 0), facing ? 1.5 : 0, facing ? 2.35 : 0.85, 0, 0, 0],
            [3, 54.43, 0, 0, 0, 0, 1],
            [4, 31.11, 0, 0.85, 0, 0, 0],
            [5, 216.74, 0, 0, 0, 0, 1],
            [6, 47.54, 0, 0, 0, 0, 1],
          ],
          boards: [o.board ?? BOARD],
          street: 'flop',
          toCall: facing ? 1.5 : 0,
          currentBet: facing ? 1.5 : 0,
          minRaiseTo: facing ? 3 : 0.25,
          maxRaiseTo: facing ? 7.05 : pot,
          legalActions: facing ? ['fold', 'call', 'raise'] : ['check', 'bet'],
          dealerSeat: 6,
          chipUnit: 0.01,
          bigBlind: 0.25,
          smallBlind: 0.1,
          variant,
          structure: 'pot_limit',
          actorSeat: HERO,
          bombPot: false,
          boardCount: 1,
          allInOrFold: false,
          fixedBetSize: null,
          wagersCapped: false,
          deductions: {
            bbj: { feeBB: 0, enabled: false, minPotBB: 10, minPlayersDealt: 3 },
            rake: {
              cap: 0.62,
              percent: 10,
              noFlopNoDrop: true,
              playerCountCaps: [
                [2, 0.31],
                [3, 0.62],
                [4, 0.62],
              ],
            },
            rules: 'controller-rake-bbj-v1',
            status: 'captured',
            version: 1,
          } as never,
          tournamentStage: { status: 'not_applicable', version: 1 },
        },
      },
    ],
    forbidden: [],
    seeds: SEEDS,
  } as ComplaintFixture;
}

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const nodeOf = (o: Over = {}) => {
  const fx = fixture(o);
  return stateAt(fx, fx.actions.find((a) => a.ord === NODE)!);
};

interface Outcome {
  actions: string[];
  /** the decision without its clock fields, one string per seed */
  bytes: string[];
  /** the receipts fired by each decision, with their counts */
  fires: Array<Record<string, number>>;
}
const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));

/** The live cash profile's decision at the node, one per seed. */
function play(o: Over = {}, opts: HorseDecideOpts = {}): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { actions: [], bytes: [], fires: [] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(seed);
    const st = nodeOf(o);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    } as never);
    out.actions.push(d.action);
    out.bytes.push(bytesOf(d));
    out.fires.push(Object.fromEntries(drainFires().map((f) => [f.feature, f.fires])));
  }
  HorseMind.reset();
  return out;
}
const count = (o: Outcome, action: string) => o.actions.filter((a) => a === action).length;
const fired = (o: Outcome, key: string) => o.fires.reduce((n, f) => n + (f[key] ?? 0), 0);
const wagers = (o: Outcome) => count(o, 'bet') + count(o, 'raise') + count(o, 'all_in');

afterEach(() => {
  forced.laterRuleBets = false;
  HorseMind.reset();
});

describe('plo6NoMultiwayBetWithWeakMadeHand through decide', () => {
  it('the receipt key in HorseLogic is the module constant', () => {
    expect(PLO6_MULTIWAY_WEAK_BET_RECEIPT).toBe(RECEIPT);
  });

  const spots: Array<[string, Over]> = [
    ['a pair below the top card', {}],
    ['bottom two pair', BOTTOM_TWO],
    ['a pair of fives under the king', FIVES],
  ];

  for (const [name, o] of spots) {
    it(`${name}: the node is the rule's spot and today's brain bets it at some seed`, () => {
      const st = nodeOf(o);
      expect(plo6MultiwayWeakBetSpot(st.hero, st.gs)).not.toBeNull();
      expect(count(play(o), 'bet')).toBeGreaterThan(0);
    }, 120_000);

    it(`${name}: unset and false are the same decision at every seed, and no receipt fires`, () => {
      const absent = play(o);
      const off = play(o, { plo6NoMultiwayBetWithWeakMadeHand: false });
      expect(off.bytes).toEqual(absent.bytes);
      expect(off.fires).toEqual(absent.fires);
      expect(fired(absent, RECEIPT)).toBe(0);
      expect(fired(off, RECEIPT)).toBe(0);
    }, 120_000);

    it(`${name}: on, every bet becomes a check and the receipt fires once per bet`, () => {
      const off = play(o);
      const on = play(o, ON);
      expect(wagers(on)).toBe(0);
      expect(count(on, 'check')).toBe(SEEDS.length);
      SEEDS.forEach((_, i) => {
        const wasBet = off.actions[i] !== 'check';
        // once where the bet became a check, never where the brain checked anyway
        expect(on.fires[i][RECEIPT] ?? 0).toBe(wasBet ? 1 : 0);
        // a seed the brain checked anyway is the same decision
        if (!wasBet) expect(on.bytes[i]).toBe(off.bytes[i]);
      });
      expect(fired(on, RECEIPT)).toBe(count(off, 'bet'));
    }, 120_000);
  }

  const controls: Array<[string, Over]> = [
    ['heads-up (the big blind folded before the flop)', { headsUp: true }],
    ['PLO5 (five hole cards)', { variant: 'plo5', hole: '3s3d4s6d5h' }],
    ['facing a bet', { facingBet: true }],
    // The king of spades with a spade on the ace-high two-spade flop.
    ['the nut flush draw', { hole: '3s3dKs6d5hQc' }],
    // Top set of aces on an unpaired flop.
    ['a nut-class hand (top set)', { hole: 'AcAd4s6d5h9c' }],
  ];
  for (const [name, o] of controls) {
    it(`control: ${name} is the same decision with the option on, and no receipt fires`, () => {
      const st = nodeOf(o);
      expect(plo6MultiwayWeakBetSpot(st.hero, st.gs)).toBeNull();
      const off = play(o);
      const on = play(o, ON);
      expect(on.bytes).toEqual(off.bytes);
      expect(on.fires).toEqual(off.fires);
      expect(fired(on, RECEIPT)).toBe(0);
    }, 120_000);
  }

  it('the heads-up control is not vacuous: the same hand heads-up is still bet at some seed', () => {
    const on = play({ headsUp: true }, ON);
    expect(count(on, 'bet')).toBeGreaterThan(0);
  }, 120_000);
});

describe('the check stands over a later rule that proposes a bet', () => {
  /** omahaBigDrawAggression runs after the own-bet rules; here it always proposes a bet. */
  const LATER: HorseDecideOpts = { omahaBigDrawAggression: true };

  it('without the option the later rule bets at every seed (the guard is what is tested)', () => {
    forced.laterRuleBets = true;
    const o = play({}, LATER);
    expect(count(o, 'bet')).toBe(SEEDS.length);
    expect(fired(o, RECEIPT)).toBe(0);
  }, 120_000);

  it('with the option the final action is a check at every seed and the kept receipt fires', () => {
    forced.laterRuleBets = true;
    const o = play({}, { ...LATER, ...ON });
    expect(count(o, 'check')).toBe(SEEDS.length);
    expect(wagers(o)).toBe(0);
    // The later rule is asked on each wager path of the node, so the kept
    // receipt fires at least once a decision; the option's own receipt is
    // not fired again by the outer guard.
    for (const f of o.fires) {
      expect(f[KEPT] ?? 0).toBeGreaterThanOrEqual(1);
      expect(f[RECEIPT] ?? 0).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it('the guard does not reach outside the spot: heads-up the later bet stands', () => {
    forced.laterRuleBets = true;
    const o = play({ headsUp: true }, { ...LATER, ...ON });
    expect(count(o, 'bet')).toBe(SEEDS.length);
    expect(fired(o, KEPT)).toBe(0);
  }, 120_000);
});
