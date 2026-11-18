/**
 * A COMMITTED TOURNAMENT STACK IS NOT FOLDED AT A SMALL PRICE.
 *
 * Study leads HVH2D-NLH-M-COMMIT and HVH2D-NLH-007a (two-day Human vs Horse
 * study, 2026-11-12). In tournaments a Horse folded preflop after putting
 * most of its stack in, at prices of 0.5 to 19 percent: 31 chips to call into
 * a pot of 6,062 with 63 percent of the stack in is the plainest one.
 *
 * Why it folded. Every one of these spots is classed `multiway_all_in` (an
 * opponent all in plus a caller or a raise). The jam-or-fold node there reads
 * hand strength only. The priced-in guard in decidePreflopV7 would have
 * called, but it stood aside for that branch without exception.
 *
 * What changed (behind the default-off flag committedStackPricedIn; every
 * case below runs with it on unless it says otherwise). The guard stands
 * aside only for a fresh decision. It decides
 * again when the price is 0.05 or better, when 2 big blinds or fewer remain
 * (the hand is not junk, or three-handed the price is 0.12 or better, where
 * any two cards have the odds), or when half or more of the starting stack is
 * in and the hand is not junk. Two-card no-limit hold'em only: every other
 * variant decides as it did, option on or off.
 * A committed hero whose call is all in also continues with a top-half hand
 * up to a price of 0.18. The tournament utility arbiter still runs afterwards
 * and still folds when it is confident.
 *
 * THE SIX SPOTS ARE RECONSTRUCTIONS from public development-packet rows, not
 * replays: see the fixture's `_about` and the test-support header for what is
 * recorded and what is assumed. They show how the code decides a spot of this
 * shape. They do not prove what the original decision computed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { bettingStructureFor } from './BettingStructure.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { holdemPreflopScore } from './HorseEval.js';
import {
  COMMITTED_ALL_IN_MIN_STRENGTH,
  COMMITTED_ALL_IN_PRICE_BAR,
  COMMITTED_CRUMBS_ANY_TWO_MAX_OPPONENTS,
  COMMITTED_CRUMBS_ANY_TWO_PRICE,
  COMMITTED_CRUMBS_BB,
  COMMITTED_MIN_STRENGTH,
  COMMITTED_STACK_SHARE,
  MULTIWAY_TOKEN_PRICE,
} from './HorsePreflop.js';
import {
  SPOTS,
  build,
  decide,
  decideBuilt,
  spotNamed,
  type Built,
  type Decided,
  type Pool,
  type Spot,
} from './ACommittedStackIsNotFoldedAtAPrice.test-support.js';
import { horseVariantRulesFor } from './VariantRules.js';

const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);

/** The price the guard reads: the call against what the hero can win. */
function price(rq: Built): number {
  const call = Math.min(rq.gameState.toCall, rq.player.stack);
  return call / (rq.gameState.contestablePot + call);
}

/** Own live chips in as a share of the stack the hand started with. */
function share(rq: Built): number {
  const own = rq.gameState.currentBet - rq.gameState.toCall;
  return own / (own + rq.player.stack);
}

function behindBB(rq: Built): number {
  return rq.player.stack / rq.gameState.bigBlind;
}

function overSeeds(spot: Spot, pool: Pool = 'priced'): Decided[] {
  return SEEDS.map((seed) => decide(spot, seed, pool));
}

function actions(decisions: Decided[]): string[] {
  return [...new Set(decisions.map((d) => d.action))].sort();
}

function references(decisions: Decided[]): string[] {
  return [...new Set(decisions.map((d) => d.preflopAuthority?.referenceAction ?? '?'))].sort();
}

function withCards(spot: Spot, a: [string, string], b: [string, string]): Spot {
  const next = structuredClone(spot);
  next.cards = [
    { rank: a[0], suit: a[1] },
    { rank: b[0], suit: b[1] },
  ];
  return next;
}

afterEach(() => HorseMind.reset());

describe('the fixture is six reconstructed multiway all-in spots and holds no identity', () => {
  it('has six spots, each in the multiway all-in branch of a tournament', () => {
    expect(SPOTS.map((s) => s.handClass)).toEqual(['33', '77', 'A8s', 'A7o', 'QJs', 'J8o']);
    for (const spot of SPOTS) {
      const d = decide(spot, SEEDS[0]);
      expect(d.tournamentPreflopAttribution?.lookup?.policy?.branch, spot.name).toBe(
        'multiway_all_in'
      );
    }
  });

  it('needs the M state the live feed always sends: without it there is no branch at all', () => {
    // The first independent replay of these hands left `tournament.m` out.
    // HorseLogic then skips the Phase 6 coordinate, the spot is never classed
    // multiway all-in and the old guard calls, which hid the defect. The live
    // engine builds `m` for every tournament decision, so a fixture without
    // it does not describe production.
    const rq = build(spotNamed('pair-of-threes-button'));
    delete (rq.gameState as unknown as { tournament: { m?: unknown } }).tournament.m;
    const d = decideBuilt(rq, SEEDS[0]);
    expect(d.tournamentPreflopAttribution?.lookup?.policy?.branch).toBeUndefined();
    expect(d.preflopAuthority?.referenceAction).not.toBe('fold');
  });

  it('carries no user, table, hand or tournament id', () => {
    const text = JSON.stringify(SPOTS);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/user_?id|table_?id|hand_?id|tournament_?id|username/i);
  });

  it('has the commitment and the price the study recorded', () => {
    const facts = SPOTS.map((spot) => {
      const rq = build(spot);
      return [
        spot.handClass,
        +share(rq).toFixed(3),
        +behindBB(rq).toFixed(2),
        +price(rq).toFixed(3),
      ];
    });
    expect(facts).toEqual([
      ['33', 0.69, 3.69, 0.11],
      // The big blind: 800 live plus an 800 ante from a 3,051 stack. The live
      // share is under half; it is the 2 big blind line that applies here.
      ['77', 0.355, 1.81, 0.192],
      ['A8s', 0.63, 5.51, 0.005],
      ['A7o', 0.551, 8.74, 0.122],
      ['QJs', 0.561, 5.41, 0.159],
      ['J8o', 0.593, 6.14, 0.144],
    ]);
  });
});

describe('a committed stack continues at a small price (each folded 12 of 12 before)', () => {
  it('33 on the button, 69% of the stack in, price 0.110: calls all in', () => {
    const decisions = overSeeds(spotNamed('pair-of-threes-button'));
    expect(references(decisions)).toEqual(['call']);
    expect(actions(decisions)).toEqual(['all_in']);
  });

  it('77 in the big blind, 1.8 big blinds behind, price 0.192: calls all in', () => {
    const rq = build(spotNamed('pair-of-sevens-big-blind'));
    expect(behindBB(rq)).toBeLessThanOrEqual(COMMITTED_CRUMBS_BB);
    const decisions = overSeeds(spotNamed('pair-of-sevens-big-blind'));
    expect(references(decisions)).toEqual(['call']);
    expect(actions(decisions)).toEqual(['all_in']);
  });

  it('A8s, 31 chips to call into 6,062, price 0.005: calls', () => {
    const spot = spotNamed('ace-eight-suited-31-chips');
    expect([spot.toCall, spot.pot]).toEqual([31, 6062]);
    expect(price(build(spot))).toBeLessThanOrEqual(MULTIWAY_TOKEN_PRICE);
    const decisions = overSeeds(spot);
    expect(references(decisions)).toEqual(['call']);
    expect(actions(decisions)).toEqual(['call']);
  });

  it('A7o on the hand-for-hand bubble, hero covers, price 0.122: calls', () => {
    const spot = spotNamed('ace-seven-offsuit-bubble');
    expect(spot.stage.handForHand).toBe(true);
    const decisions = overSeeds(spot);
    expect(references(decisions)).toEqual(['call']);
    expect(actions(decisions)).toEqual(['call']);
  });

  // review 5d35da81 M1: the bubble call above stands because it leaves 3.3 big blinds behind. The same node with
  // the stack cut so the call leaves 2 big blinds or less is a bust in all but name: the option changes nothing.
  for (const [left, changes] of [
    [0.1, false],
    [1, false],
    [2, false],
    [2.5, true],
  ] as const) {
    it(`A7o on the hand-for-hand bubble, the call leaves ${left} big blinds: ${changes ? 'calls' : 'as with the option absent'}`, () => {
      const spot = spotNamed('ace-seven-offsuit-bubble');
      spot.seats = spot.seats.map((row) =>
        row[0] === spot.hero
          ? [row[0], spot.toCall + Math.round(left * spot.bigBlind), ...row.slice(2)]
          : row
      );
      const rq = build(spot);
      for (const seed of SEEDS) {
        const on = decideBuilt(rq, seed, true);
        if (changes) expect(on.action).toBe('call');
        else expect(stable(on)).toBe(stable(decideBuilt(rq, seed, 'absent')));
      }
    });
  }

  it('QJs in the hijack (HVH2D-NLH-007a), 56% in, price 0.159, the call is all in: calls', () => {
    const spot = spotNamed('queen-jack-suited-hijack');
    const rq = build(spot);
    expect(price(rq)).toBeGreaterThan(0.15);
    expect(price(rq)).toBeLessThanOrEqual(COMMITTED_ALL_IN_PRICE_BAR);
    expect(share(rq)).toBeGreaterThanOrEqual(COMMITTED_STACK_SHARE);
    expect(spot.toCall).toBeGreaterThanOrEqual(rq.player.stack);
    const decisions = overSeeds(spot);
    expect(references(decisions)).toEqual(['call']);
    expect(actions(decisions)).toEqual(['all_in']);
  });
});

describe('what still folds', () => {
  it('J8o in the money: a junk hand keeps its fold three ways, committed or not', () => {
    // 59% of the stack in at a price of 0.144, so this is the any-two zone.
    // The hand is below the 0.26 floor, its raw equity against two tight
    // ranges (0.166) barely clears the price, and the arbiter's own estimate
    // rates the fold above the call here. Not shown to be a defect; unchanged.
    const decisions = overSeeds(spotNamed('jack-eight-offsuit-in-the-money'));
    expect(references(decisions)).toEqual(['fold']);
    expect(actions(decisions)).toEqual(['fold']);
  });

  it('the same A7o node with a deep stack behind is a fresh decision and still folds', () => {
    // Hero keeps 25,761 in, but has 80,979 behind: 24% of the stack. Same
    // price (0.122, hero already covered the all-ins), same branch.
    const spot = spotNamed('ace-seven-offsuit-bubble');
    spot.seats.find((s) => s[0] === spot.hero)![1] += 60_000;
    const rq = build(spot);
    expect(share(rq)).toBeLessThan(COMMITTED_STACK_SHARE);
    expect(behindBB(rq)).toBeGreaterThan(COMMITTED_CRUMBS_BB);
    expect(price(rq)).toBeGreaterThan(MULTIWAY_TOKEN_PRICE);
    expect(price(rq)).toBeLessThanOrEqual(0.15);
    const decisions = SEEDS.map((seed) => decideBuilt(rq, seed));
    expect(decisions[0].tournamentPreflopAttribution?.lookup?.policy?.branch).toBe(
      'multiway_all_in'
    );
    expect(references(decisions)).toEqual(['fold']);
    expect(actions(decisions)).toEqual(['fold']);
  });

  it('at the QJs node, a hand outside the top half folds: 0.159 is above the any-two bar', () => {
    const spot = spotNamed('queen-jack-suited-hijack');
    for (const cards of [
      withCards(spot, ['A', 'spades'], ['7', 'hearts']),
      withCards(spot, ['J', 'spades'], ['8', 'hearts']),
      withCards(spot, ['7', 'spades'], ['2', 'hearts']),
    ]) {
      const decisions = overSeeds(cards);
      expect(references(decisions)).toEqual(['fold']);
      expect(actions(decisions)).toEqual(['fold']);
    }
  });

  // Independent review 461281e7: the 2 big blinds behind clause shares the
  // 0.26 floor, so junk no longer goes in at the 77 node's 0.192 price three
  // ways, where it holds about 0.13 to 0.17 against tight ranges.
  for (const [rank1, suit1, rank2, suit2] of [
    ['7', 'spades', '2', 'hearts'],
    ['K', 'clubs', '2', 'diamonds'],
    ['9', 'spades', '4', 'hearts'],
    ['8', 'clubs', '3', 'diamonds'],
  ] as const) {
    it(`at the 77 node (1.8 big blinds behind, price 0.192), ${rank1}${rank2} offsuit is junk and folds`, () => {
      const decisions = overSeeds(
        withCards(spotNamed('pair-of-sevens-big-blind'), [rank1, suit1], [rank2, suit2])
      );
      expect(actions(decisions)).toEqual(['fold']);
    });
  }

  it('at the 33 node (price 0.110), seven-deuce is junk and folds', () => {
    const decisions = overSeeds(
      withCards(spotNamed('pair-of-threes-button'), ['7', 'spades'], ['2', 'hearts'])
    );
    expect(references(decisions)).toEqual(['fold']);
    expect(actions(decisions)).toEqual(['fold']);
  });
});

describe('the tournament utility arbiter still decides when it is confident', () => {
  // With the pool priced the way the feed did before #10612 (a pool of 100
  // and the rebuy open) a bust is charged a rebuy against an empty pool. The
  // reference now calls, and the arbiter turns the call back into a fold.
  for (const name of [
    'pair-of-threes-button',
    'pair-of-sevens-big-blind',
    'queen-jack-suited-hijack',
  ]) {
    it(`${name}: reference call, arbiter all_in to fold, final fold`, () => {
      const decisions = overSeeds(spotNamed(name), 'mispriced');
      expect(references(decisions)).toEqual(['call']);
      expect(actions(decisions)).toEqual(['fold']);
      for (const d of decisions) {
        expect(d.tournamentUtility?.baselineAction).toBe('all_in');
        expect(d.tournamentUtility?.selectedAction).toBe('fold');
        expect(d.tournamentUtility?.baselineRetainedForUncertainty).not.toBe(true);
      }
    });
  }

  it('and keeps the call when the pool is priced correctly', () => {
    for (const d of overSeeds(spotNamed('pair-of-threes-button'))) {
      expect(d.tournamentUtility?.baselineAction).toBe('all_in');
      expect(d.tournamentUtility?.selectedAction).toBe('all_in');
    }
  });
});

describe('a cash game is not touched', () => {
  it('the 33 node as a cash hand has no tournament branch and decides as before', () => {
    // No tournament context means no Phase 6 branch, so the changed lines are
    // not reached. The guard's cash behaviour is the 0.15 any-two bar it
    // always had: this call was a call before the change too.
    const rq = build(spotNamed('pair-of-threes-button'));
    const gs = rq.gameState as unknown as Record<string, unknown>;
    gs.gameMode = 'cash';
    gs.format = 'cash';
    delete gs.tournament;
    const decisions = SEEDS.map((seed) => decideBuilt(rq, seed));
    expect(decisions[0].tournamentPreflopAttribution?.lookup?.policy?.branch).toBeUndefined();
    expect(actions(decisions)).toEqual(CASH_ACTIONS_BEFORE_THE_CHANGE);
  });
});

/** Measured with HorsePreflop.ts at the merge base, same seeds. */
const CASH_ACTIONS_BEFORE_THE_CHANGE = ['all_in'];

/** The decision-bearing part of a decision: action, amount, the reference
 *  proposal and its branch, and what the tournament arbiter did with it. The
 *  rest of the record carries wall-clock fields (latencies, and a shadow
 *  utility that is dropped when its operation budget runs out under load),
 *  which differ between two runs of the same decision with the flag absent. */
function stable(d: Decided): string {
  const x = d as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return JSON.stringify({
    action: x.action,
    amount: x.amount ?? null,
    reference: x.preflopAuthority?.referenceAction ?? null,
    events: x.preflopAuthority?.events ?? null,
    branch: x.tournamentPreflopAttribution?.lookup?.policy?.branch ?? null,
    baseline: x.tournamentUtility?.baselineAction ?? null,
    selected: x.tournamentUtility?.selectedAction ?? null,
    retained: x.tournamentUtility?.baselineRetainedForUncertainty ?? null,
  });
}

describe('default OFF: without the flag nothing changes', () => {
  // Before the change every one of the six folded on every seed (the reference
  // proposal itself, multiway all-in branch). Off and absent must still do so,
  // and must return the same decision as each other, field for field.
  for (const spot of SPOTS) {
    it(`${spot.name}: absent and explicit off both fold, identically`, () => {
      for (const seed of SEEDS) {
        const absent = decide(spot, seed, 'priced', 'absent');
        const off = decide(spot, seed, 'priced', false);
        expect(absent.action).toBe('fold');
        expect(absent.preflopAuthority?.referenceAction).toBe('fold');
        expect(stable(off)).toBe(stable(absent));
      }
    });
  }
});

describe('the option on cannot move a decision outside the committed multiway all-in', () => {
  // The guard is reached only by a tournament multiway all-in. Everywhere the
  // rule does not fire, the option on must return the decision the option
  // absent returns, field for field.
  function cashOf(name: string): Built {
    const rq = build(spotNamed(name));
    const gs = rq.gameState as unknown as Record<string, unknown>;
    gs.gameMode = 'cash';
    gs.format = 'cash';
    delete gs.tournament;
    return rq;
  }

  for (const name of SPOTS.map((s) => s.name)) {
    it(`${name} as a cash hand: on equals absent`, () => {
      const rq = cashOf(name);
      for (const seed of SEEDS) {
        expect(stable(decideBuilt(rq, seed, true))).toBe(stable(decideBuilt(rq, seed, 'absent')));
      }
    });
  }

  it('the protected tournament folds: on equals absent', () => {
    const deep = spotNamed('ace-seven-offsuit-bubble');
    deep.seats.find((s) => s[0] === deep.hero)![1] += 60_000;
    const qj = spotNamed('queen-jack-suited-hijack');
    for (const spot of [
      spotNamed('jack-eight-offsuit-in-the-money'),
      deep,
      withCards(qj, ['A', 'spades'], ['7', 'hearts']),
      withCards(qj, ['7', 'spades'], ['2', 'hearts']),
      withCards(spotNamed('pair-of-threes-button'), ['7', 'spades'], ['2', 'hearts']),
    ]) {
      for (const seed of SEEDS) {
        expect(stable(decide(spot, seed, 'priced', true))).toBe(
          stable(decide(spot, seed, 'priced', 'absent'))
        );
      }
    }
  });
});

describe('the receipt fires only when the rule makes the call', () => {
  it('committed_stack_priced_in_seen counts the five calls and nothing with the flag off', () => {
    enableBrainTelemetry();
    drainFires();
    const count = () =>
      drainFires().find((r) => r.feature === 'committed_stack_priced_in_seen')?.fires ?? 0;
    for (const spot of SPOTS) decide(spot, SEEDS[0], 'priced', 'absent');
    expect(count()).toBe(0);
    for (const spot of SPOTS) decide(spot, SEEDS[0]);
    // 33, 77, A8s, A7o and QJs are rescued; J8o keeps its fold.
    expect(count()).toBe(5);
  });
});

// ── Review 20261113, findings A1, A3 and A5 ────────────────────────────────

/** The 77 node rebuilt so the hero is the big blind facing two covering
 *  all-ins with the small blind folded: seat 7 jams, the button (seat 8)
 *  calls, the small blind (seat 9) folds its 400. `behind` is the hero's
 *  stack in chips (the big blind is 800); `fourWay` puts seat 6 in as a third
 *  covering opponent. A constructed spot, not a recorded one. */
function bigBlindCrumbs(behind: number, fourWay = false): Spot {
  const spot = spotNamed('pair-of-sevens-big-blind');
  spot.seats = spot.seats.map((row) => {
    if (row[0] === spot.hero) return [row[0], behind, 800, 1600, 800, 0, 0];
    if (row[0] === 8) return [8, 5700 - 3772, 3772, 3772, 0, 0, 0];
    if (row[0] === 9) return [9, 3076 + 3372, 400, 400, 0, 0, 1];
    if (row[0] === 6 && fourWay) return [6, 6100 - 3772, 3772, 3772, 0, 0, 0];
    return row;
  });
  // Four ways seat 6 opens for the same amount and seat 7's all-in calls it:
  // the same public node with one more covering stack in.
  spot.history = [
    [2, 'fold', 0, null],
    [3, 'fold', 0, null],
    [4, 'fold', 0, null],
    fourWay ? [6, 'raise', 3772, true] : [6, 'fold', 0, null],
    [7, 'all_in', 3772, fourWay ? null : true],
    [8, 'call', 3772, null],
    [9, 'fold', 0, null],
  ];
  spot.pot = 800 + 800 + 400 + 3772 * (fourWay ? 3 : 2);
  return spot;
}

function withHand(spot: Spot, hand: string): Spot {
  const suits: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
  const next = structuredClone(spot);
  next.cards = (hand.match(/../g) ?? []).map((c) => ({ rank: c[0], suit: suits[c[1]] }));
  return next;
}

/** The hold'em ladder score of a two-card hand, before the caller's jitter. */
function ladder(hand: string): number {
  const [a, b] = withHand(spotNamed('pair-of-sevens-big-blind'), hand).cards;
  return holdemPreflopScore(a as never, b as never, false);
}

/** The strength jitter HorseLogic adds to the ladder score, either way. */
const JITTER = 0.03;

describe('the crumbs floor respects the price (review 20261113, A1)', () => {
  it('the big blind with 0.5 big blinds behind is laid 0.083 three ways', () => {
    const rq = build(bigBlindCrumbs(400));
    expect(behindBB(rq)).toBe(0.5);
    // 800 ante + 800 blind + 400 small blind + 2 x 1,200 it can win = 4,400
    // before the call; 400 / 4,800.
    expect(price(rq)).toBeCloseTo(400 / 4800, 6);
    expect(price(rq)).toBeLessThanOrEqual(COMMITTED_CRUMBS_ANY_TWO_PRICE);
    expect(decideBuilt(rq, SEEDS[0]).tournamentPreflopAttribution?.lookup?.policy?.branch).toBe(
      'multiway_all_in'
    );
  });

  for (const hand of ['7s2h', '3s2h', 'Ks2h', '5s4h']) {
    it(`${hand} at that price: calls with the option on, folds with it off or absent`, () => {
      expect(ladder(hand) + JITTER).toBeLessThan(COMMITTED_MIN_STRENGTH);
      const spot = withHand(bigBlindCrumbs(400), hand);
      const on = overSeeds(spot);
      expect(references(on)).toEqual(['call']);
      expect(actions(on)).toEqual(['all_in']);
      for (const seed of SEEDS) {
        const absent = decide(spot, seed, 'priced', 'absent');
        expect(absent.action).toBe('fold');
        expect(absent.preflopAuthority?.referenceAction).toBe('fold');
        expect(stable(decide(spot, seed, 'priced', false))).toBe(stable(absent));
      }
    });
  }

  it('0.8 big blinds behind is still inside the price (0.116): seven-deuce calls', () => {
    const spot = withHand(bigBlindCrumbs(640), '7s2h');
    expect(price(build(spot))).toBeCloseTo(640 / 5520, 6);
    expect(price(build(spot))).toBeLessThanOrEqual(COMMITTED_CRUMBS_ANY_TWO_PRICE);
    expect(actions(overSeeds(spot))).toEqual(['all_in']);
  });

  it('1 big blind behind is just above the price (0.133): the floor still folds trash', () => {
    for (const hand of ['7s2h', '3s2h', 'Ks2h', '5s4h']) {
      const spot = withHand(bigBlindCrumbs(800), hand);
      const rq = build(spot);
      expect(behindBB(rq)).toBeLessThanOrEqual(COMMITTED_CRUMBS_BB);
      expect(price(rq)).toBeCloseTo(800 / 6000, 6);
      expect(price(rq)).toBeGreaterThan(COMMITTED_CRUMBS_ANY_TWO_PRICE);
      for (const seed of SEEDS) {
        const on = decideBuilt(rq, seed, true);
        expect(on.action, hand).toBe('fold');
        expect(stable(on)).toBe(stable(decideBuilt(rq, seed, 'absent')));
      }
    }
  });

  it('four ways the any-two price does not apply: 0.5 big blinds behind at 0.067 still folds trash', () => {
    // Against three tight ranges K2o holds 0.079 and 72o 0.116, less than a
    // four-way crumbs price can be, so the price rule is three-way only.
    for (const hand of ['7s2h', 'Ks2h']) {
      const rq = build(withHand(bigBlindCrumbs(400, true), hand));
      expect(price(rq)).toBeCloseTo(400 / 6000, 6);
      expect(price(rq)).toBeGreaterThan(MULTIWAY_TOKEN_PRICE);
      expect(price(rq)).toBeLessThanOrEqual(COMMITTED_CRUMBS_ANY_TWO_PRICE);
      for (const seed of SEEDS) {
        const on = decideBuilt(rq, seed, true);
        expect(on.tournamentPreflopAttribution?.lookup?.policy?.branch).toBe('multiway_all_in');
        expect(on.action, hand).toBe('fold');
        expect(stable(on)).toBe(stable(decideBuilt(rq, seed, 'absent')));
      }
    }
  });
});

describe('the any-two call is chip arithmetic only: it stands aside when a pay jump is live (review 3e22706d, H1)', () => {
  // The same 0.083 spot. On the bubble a fold cashes whenever another all-in loses, so the chip price is not the
  // whole price; in the money every bust-out below is a pay jump; an unknown payout context is not "no pay jump".
  const STAGES: [name: string, stage: Record<string, number | boolean>][] = [
    ['hand for hand, 10 left and 9 paid', { playersLeft: 10, spotsPaid: 9, handForHand: true }],
    ['one off the money, 73 left and 72 paid', { playersLeft: 73, spotsPaid: 72 }],
    ['within 15 percent of the money, 10 left and 9 paid', { playersLeft: 10, spotsPaid: 9 }],
    ['flagged near the bubble', { nearBubble: true }],
    ['in the money, 8 left and 9 paid', { playersLeft: 8, spotsPaid: 9, inMoney: true }],
    // review 347b0afc M1: one off the money in a small field is over 1.15 times the paid places and is the bubble
    ['small-field bubble with no flag, 4 left and 3 paid', { playersLeft: 4, spotsPaid: 3 }],
    ['small-field bubble with no flag, 7 left and 6 paid', { playersLeft: 7, spotsPaid: 6 }],
    // review 347b0afc L1: a satellite is live whatever its seat count says
    [
      'a satellite far from the seats with no seat count',
      { playersLeft: 60, spotsPaid: 9, satellite: true, satelliteSeats: 0 },
    ],
    [
      'a satellite far from the seats',
      { playersLeft: 60, spotsPaid: 9, satellite: true, satelliteSeats: 9 },
    ],
  ];
  for (const [name, stage] of STAGES) {
    it(`${name}: trash folds with the option on, exactly as with it absent`, () => {
      for (const hand of ['7s2h', 'Ks2h', '5s4h']) {
        const spot = withHand(bigBlindCrumbs(400), hand);
        spot.stage = { ...spot.stage, ...stage };
        const rq = build(spot);
        expect(price(rq)).toBeLessThanOrEqual(COMMITTED_CRUMBS_ANY_TWO_PRICE);
        for (const seed of SEEDS) {
          const absent = decideBuilt(rq, seed, 'absent');
          const on = decideBuilt(rq, seed, true);
          expect(on.action, `${hand} ${name}`).toBe('fold');
          expect(stable(on)).toBe(stable(absent));
        }
      }
    });
  }

  it('far from the money the any-two call still acts (the control for the cases above)', () => {
    const spot = withHand(bigBlindCrumbs(400), '7s2h');
    spot.stage = { ...spot.stage, playersLeft: 60, spotsPaid: 9 };
    expect(actions(overSeeds(spot))).toEqual(['all_in']);
  });

  // review 347b0afc M2: the crumbs strength clause is chip arithmetic too. With a pay jump live a hand over the
  // 0.26 floor is decided exactly as with the option absent; far from the money the clause still acts.
  for (const hand of ['7s7h', 'As2h']) {
    it(`${hand} with crumbs on the hand-for-hand bubble: the option changes nothing`, () => {
      const spot = withHand(bigBlindCrumbs(400), hand);
      spot.stage = { ...spot.stage, playersLeft: 10, spotsPaid: 9, handForHand: true };
      const rq = build(spot);
      for (const seed of SEEDS)
        expect(stable(decideBuilt(rq, seed, true)), hand).toBe(
          stable(decideBuilt(rq, seed, 'absent'))
        );
    });
    it(`${hand} with crumbs far from the money: the strength clause still acts`, () => {
      const spot = withHand(bigBlindCrumbs(400), hand);
      spot.stage = { ...spot.stage, playersLeft: 60, spotsPaid: 9 };
      expect(actions(overSeeds(spot))).toEqual(['all_in']);
    });
  }
});

describe('the 0.26 floor has a pinned boundary (review 20261113, A5)', () => {
  // The 77 node: 1.81 big blinds behind at 0.192, above the any-two price, so
  // only the floor decides. HorseLogic jitters the ladder score by up to 0.03
  // either way; the hands here sit further than that from 0.26, so no seed
  // can move them across it.
  for (const hand of ['5s4h', 'Qs8h', 'Qs6h']) {
    it(`${hand} is under the floor by more than the jitter: folds on every seed`, () => {
      expect(ladder(hand) + JITTER).toBeLessThan(COMMITTED_MIN_STRENGTH);
      const decisions = overSeeds(withHand(spotNamed('pair-of-sevens-big-blind'), hand));
      expect(references(decisions)).toEqual(['fold']);
      expect(actions(decisions)).toEqual(['fold']);
    });
  }

  for (const hand of ['As2h', 'As3h', '8s6s']) {
    it(`${hand} is over the floor by more than the jitter: the reference calls on every seed`, () => {
      expect(ladder(hand) - JITTER).toBeGreaterThanOrEqual(COMMITTED_MIN_STRENGTH);
      const decisions = overSeeds(withHand(spotNamed('pair-of-sevens-big-blind'), hand));
      expect(references(decisions)).toEqual(['call']);
      expect(actions(decisions)).toEqual(['all_in']);
    });
  }

  it('a hand on the floor (K7o, 0.26) mixes by seed, and each seed decides the same way twice', () => {
    expect(ladder('Ks7h')).toBeCloseTo(COMMITTED_MIN_STRENGTH, 6);
    const spot = withHand(spotNamed('pair-of-sevens-big-blind'), 'Ks7h');
    for (const seed of SEEDS) {
      const first = decide(spot, seed);
      expect(['fold', 'all_in']).toContain(first.action);
      expect(stable(decide(spot, seed))).toBe(stable(first));
    }
  });
});

describe("the option is two-card no-limit hold'em only (review 20261113, A3)", () => {
  // In every other variant the hand strength is a percentile on another
  // ladder and no study covers the call. By default the variant all-in
  // arithmetic (V38) decides these spots before the priced-in guard is asked;
  // with it ablated (v38Ev false, or whenever it has no price) the guard is
  // the decider. Both routes: option on equals option absent. Each case is a
  // spot the rule would otherwise rescue: the reference folds every seed and
  // the token price, the crumbs line or the commitment would end the
  // exemption.
  const CASES: [variant: string, node: string, hand: string, absentAction?: string][] = [
    ['plo4', 'ace-eight-suited-31-chips', 'AsKh7d2c'],
    ['plo5', 'ace-eight-suited-31-chips', 'AsKh7d2c9s'],
    ['plo6', 'ace-eight-suited-31-chips', 'AsKh7d2c9s4h'],
    ['short_deck', 'pair-of-sevens-big-blind', '7s7h'],
    ['short_deck', 'pair-of-threes-button', 'As8s'],
    ['short_deck', 'ace-eight-suited-31-chips', '9s6h'],
    ['pineapple', 'pair-of-sevens-big-blind', 'As8s2d'],
    ['pineapple', 'pair-of-threes-button', '7s7hKd'],
    ['pineapple', 'ace-eight-suited-31-chips', '7s2h9d'],
    // review 3e22706d M1: the fixed-limit term of the gate had no case
    ['flh', 'pair-of-sevens-big-blind', '9s6h'],
    // since e6a1b60c (fixed limit is never jam-or-fold) this hand plays on with the option absent, so what is
    // pinned here is only that the option changes nothing
    ['flh', 'pair-of-threes-button', 'As8s', 'all_in'],
    ['flh', 'ace-eight-suited-31-chips', '9s6h'],
  ];

  function variantSpot(variant: string, node: string, hand: string): Built {
    const rq = build(withHand(spotNamed(node), hand));
    const gs = rq.gameState as unknown as Record<string, unknown>;
    gs.gameVariant = variant;
    gs.variantRules = horseVariantRulesFor(variant);
    gs.bettingStructure = bettingStructureFor(variant);
    return rq;
  }

  for (const [variant, node, hand, absentAction = 'fold'] of CASES) {
    it(`${variant} ${hand} at ${node}: on equals absent, and the absent decision (${absentAction}) stands`, () => {
      const rq = variantSpot(variant, node, hand);
      for (const seed of SEEDS) {
        const absent = decideBuilt(rq, seed, 'absent', { v38Ev: false });
        expect(absent.tournamentPreflopAttribution?.lookup?.policy?.branch).toBe('multiway_all_in');
        expect(absent.action).toBe(absentAction);
        expect(stable(decideBuilt(rq, seed, true, { v38Ev: false }))).toBe(stable(absent));
      }
      for (const seed of SEEDS.slice(0, 4)) {
        expect(stable(decideBuilt(rq, seed, true))).toBe(stable(decideBuilt(rq, seed, 'absent')));
      }
    });
  }

  it("the receipt never fires outside hold'em", () => {
    enableBrainTelemetry();
    drainFires();
    for (const [variant, node, hand] of CASES) {
      const rq = variantSpot(variant, node, hand);
      decideBuilt(rq, SEEDS[0], true, { v38Ev: false });
      decideBuilt(rq, SEEDS[0], true);
    }
    expect(
      drainFires().find((r) => r.feature === 'committed_stack_priced_in_seen')?.fires ?? 0
    ).toBe(0);
  });
});

describe('the thresholds are the documented ones', () => {
  it('pins each constant', () => {
    expect(COMMITTED_STACK_SHARE).toBe(0.5);
    expect(COMMITTED_CRUMBS_BB).toBe(2);
    expect(MULTIWAY_TOKEN_PRICE).toBe(0.05);
    expect(COMMITTED_MIN_STRENGTH).toBe(0.26);
    expect(COMMITTED_CRUMBS_ANY_TWO_PRICE).toBe(0.12);
    expect(COMMITTED_CRUMBS_ANY_TWO_MAX_OPPONENTS).toBe(2);
    expect(COMMITTED_ALL_IN_PRICE_BAR).toBe(0.18);
    expect(COMMITTED_ALL_IN_MIN_STRENGTH).toBe(0.5);
  });
});
