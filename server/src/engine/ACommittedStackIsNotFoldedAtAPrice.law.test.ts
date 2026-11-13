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
 * again when the price is 0.05 or better, when 2 big blinds or fewer remain,
 * or when half or more of the starting stack is in and the hand is not junk.
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
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  COMMITTED_ALL_IN_MIN_STRENGTH,
  COMMITTED_ALL_IN_PRICE_BAR,
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

describe('the thresholds are the documented ones', () => {
  it('pins each constant', () => {
    expect(COMMITTED_STACK_SHARE).toBe(0.5);
    expect(COMMITTED_CRUMBS_BB).toBe(2);
    expect(MULTIWAY_TOKEN_PRICE).toBe(0.05);
    expect(COMMITTED_MIN_STRENGTH).toBe(0.26);
    expect(COMMITTED_ALL_IN_PRICE_BAR).toBe(0.18);
    expect(COMMITTED_ALL_IN_MIN_STRENGTH).toBe(0.5);
  });
});
