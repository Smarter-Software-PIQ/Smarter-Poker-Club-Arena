/**
 * The one-card league runner's argument handling, refusals and result block
 * (HorseLeagueCard.ts; the command is src/scripts/horseLeagueCard.ts). No
 * hand is dealt here.
 */
import { describe, expect, it } from 'vitest';

import {
  LeagueCardRefusal,
  formatLeagueCardResult,
  hydrateLeagueCardSolverStores,
  leagueCardOptionsUnderTest,
  leagueCardPairs,
  leagueCardVerdict,
  parseLeagueCardArgs,
  pooledLeagueCardSeeds,
  resolveLeagueCard,
} from './HorseLeagueCard.js';
import type { LeagueMatchup, LeagueResult, UnmeasurableMatchup } from './HorseLeague.js';

const CARDS: LeagueMatchup[] = [
  { name: 'nlh_alpha', pairs: 6000, a: { holdemHeadsUpPostflopBalance: true }, b: {} },
  {
    name: 'plo4_beta',
    variant: 'plo4',
    seats: 2,
    stackBB: 40,
    a: { omahaEvFoldModel: true, omahaEvFoldModelHeadsUp: true },
    b: { omahaEvFoldModel: true },
  },
];
const REFUSED: UnmeasurableMatchup[] = [
  {
    name: 'nlh_gamma',
    a: { huOpenerDefendsToPrice: true },
    b: {},
    reason: 'No league seat reaches the spot.',
  },
];

function result(over: Partial<LeagueResult> = {}): LeagueResult {
  return {
    matchup: 'nlh_alpha',
    hands: 200,
    bb100: 5,
    stderr: 2,
    durationMs: 1500,
    illegalActions: 0,
    truncatedStreets: 0,
    candidatePolicyHits: 0,
    candidateExecutionMismatches: 0,
    candidateNodeRoles: [],
    benchmarkComponents: [],
    divergentPairs: 12,
    inert: false,
    ...over,
  };
}

describe('parseLeagueCardArgs', () => {
  it('reads a card, one or several seeds, pairs and opt-in solver hydration', () => {
    expect(parseLeagueCardArgs(['--card=nlh_alpha', '--seed=7', '--pairs=600'])).toEqual({
      list: false,
      card: 'nlh_alpha',
      seeds: [7],
      pairs: 600,
      hydrateSolverStores: false,
    });
    expect(parseLeagueCardArgs(['--card=nlh_alpha', '--seed=7,8,9'])).toEqual({
      list: false,
      card: 'nlh_alpha',
      seeds: [7, 8, 9],
      pairs: null,
      hydrateSolverStores: false,
    });
    expect(
      parseLeagueCardArgs(['--card=nlh_alpha', '--seed=7', '--hydrate-solver-stores'])
    ).toEqual({
      list: false,
      card: 'nlh_alpha',
      seeds: [7],
      pairs: null,
      hydrateSolverStores: true,
    });
    expect(parseLeagueCardArgs(['--list']).list).toBe(true);
    expect(parseLeagueCardArgs(['--list']).hydrateSolverStores).toBe(false);
  });

  it.each([
    [['--seed=7'], '--card is required'],
    [['--card=nlh_alpha'], '--seed is required'],
    [['--card=nlh_alpha', '--seed=7', '--card=plo4_beta'], '--card given twice'],
    [
      ['--card=nlh_alpha', '--seed=7', '--hydrate-solver-stores', '--hydrate-solver-stores'],
      '--hydrate-solver-stores given twice',
    ],
    [['--card=nlh_alpha', '--seed=7', '--turbo'], 'unknown argument: --turbo'],
    [['--card=nlh_alpha', '--seed=0'], '--seed must be between'],
    [['--card=nlh_alpha', '--seed=4294967296'], '--seed must be between'],
    [['--card=nlh_alpha', '--seed=1.5'], '--seed must be a whole number'],
    [['--card=nlh_alpha', '--seed=7,7'], 'same seed twice'],
    [['--card=nlh_alpha', '--seed=7', '--pairs=1'], '--pairs must be between'],
    [['--card=nlh_alpha', '--seed=7', '--pairs=65537'], '--pairs must be between'],
    [['--card=nlh_alpha', '--seed=7', '--pairs=many'], '--pairs must be a whole number'],
    [['--list', '--card=nlh_alpha'], '--list takes no other argument'],
    [['--list', '--hydrate-solver-stores'], '--list takes no other argument'],
  ])('refuses %j', (argv, message) => {
    expect(() => parseLeagueCardArgs(argv)).toThrow(LeagueCardRefusal);
    expect(() => parseLeagueCardArgs(argv)).toThrow(message);
  });
});

describe('hydrateLeagueCardSolverStores', () => {
  it('loads all three stores and returns their counts when hydrated', async () => {
    const counts = await hydrateLeagueCardSolverStores({
      loadCharts: async () => 240,
      loadPostflop: async () => 1800,
      loadPostflopV31: async () => 500,
      getCounts: () => ({ charts: 240, postflop: 1800, postflopV31: 500 }),
    });
    expect(counts).toEqual({ charts: 240, postflop: 1800, postflopV31: 500 });
  });

  it('fails closed with LeagueCardRefusal when all three stores return 0', async () => {
    await expect(
      hydrateLeagueCardSolverStores({
        loadCharts: async () => 0,
        loadPostflop: async () => 0,
        loadPostflopV31: async () => 0,
        getCounts: () => ({ charts: 0, postflop: 0, postflopV31: 0 }),
      })
    ).rejects.toThrow(LeagueCardRefusal);
  });
});

describe('resolveLeagueCard', () => {
  it('returns the declared card object itself', () => {
    expect(resolveLeagueCard('plo4_beta', CARDS, REFUSED)).toBe(CARDS[1]);
  });

  it('refuses an unknown card and names the near ones', () => {
    expect(() => resolveLeagueCard('nlh_nope', CARDS, REFUSED)).toThrow(LeagueCardRefusal);
    expect(() => resolveLeagueCard('nlh_nope', CARDS, REFUSED)).toThrow(
      'no league card is named nlh_nope'
    );
    expect(() => resolveLeagueCard('beta', CARDS, REFUSED)).toThrow('plo4_beta');
  });

  it('refuses an unmeasurable card with its recorded reason', () => {
    expect(() => resolveLeagueCard('nlh_gamma', CARDS, REFUSED)).toThrow(LeagueCardRefusal);
    expect(() => resolveLeagueCard('nlh_gamma', CARDS, REFUSED)).toThrow(
      'UNMEASURABLE_MATCHUPS and is not dealt. Recorded reason: No league seat reaches the spot.'
    );
  });

  it('refuses a refused name even if a card of that name is also dealable', () => {
    const both = [...CARDS, { name: 'nlh_gamma', a: {}, b: {} }];
    expect(() => resolveLeagueCard('nlh_gamma', both, REFUSED)).toThrow('Recorded reason');
  });

  it('refuses a name two cards share', () => {
    expect(() => resolveLeagueCard('nlh_alpha', [...CARDS, CARDS[0]], REFUSED)).toThrow(
      '2 cards are named nlh_alpha'
    );
  });
});

describe('pairs, option and verdict', () => {
  it('uses the requested pairs, else the pairs the card declares, else refuses', () => {
    expect(leagueCardPairs(CARDS[0], 300)).toBe(300);
    expect(leagueCardPairs(CARDS[0], null)).toBe(6000);
    expect(() => leagueCardPairs(CARDS[1], null)).toThrow('declares no pairs');
  });

  it('names only the options the arms differ in', () => {
    expect(leagueCardOptionsUnderTest(CARDS[1])).toEqual(['omahaEvFoldModelHeadsUp']);
    expect(
      leagueCardOptionsUnderTest({
        a: { omahaEvFoldModel: true },
        b: { omahaEvFoldModel: false, huOpenerDefendsToPrice: true },
      })
    ).toEqual(['huOpenerDefendsToPrice', 'omahaEvFoldModel']);
  });

  it("uses the nightly's rule: |bb/100| > 2 x stderr, and inert is never significant", () => {
    expect(leagueCardVerdict({ bb100: 5, stderr: 2 })).toBe('SIGNIFICANT');
    expect(leagueCardVerdict({ bb100: -5, stderr: 2 })).toBe('SIGNIFICANT');
    expect(leagueCardVerdict({ bb100: 4, stderr: 2 })).toBe('not resolved');
    expect(leagueCardVerdict({ bb100: 0, stderr: 0, inert: true })).toBe('INERT');
  });
});

describe('formatLeagueCardResult', () => {
  const facts = {
    matchup: CARDS[0],
    configA: { holdemHeadsUpPostflopBalance: true },
    configB: {},
    pairs: 100,
    seed: 7,
    result: result(),
    engineRevision: 'abc123',
    solverStores: { charts: 0, postflop: 0, postflopV31: 0 },
    equityGovernor: 'off',
  };

  it('prints every field of the block', () => {
    const block = formatLeagueCardResult(facts);
    for (const line of [
      'card:            nlh_alpha',
      'option:          holdemHeadsUpPostflopBalance',
      'arm A:           {"holdemHeadsUpPostflopBalance":true}',
      'arm B:           {}',
      'table:           variant=nlh seats=6 stackBB=100 gameMode=cash field=mirror',
      'pairs:           100 requested, 100 played (200 hands)',
      'seed:            7',
      'bb/100 (A - B):  5.00',
      'stderr:          2.00',
      'z:               2.50',
      'SIGNIFICANT:     yes (SIGNIFICANT; rule |bb/100| > 2 x stderr)',
      'divergent pairs: 12',
      'engine revision: abc123',
      'solver stores:   charts=0 postflop=0 postflopV31=0 (EMPTY',
      'wall time:       1.5 s',
    ]) {
      expect(block).toContain(line);
    }
    expect(block).not.toContain('NOTE:');
  });

  it('says so when an inert run measured nothing and when pairs fell short', () => {
    const block = formatLeagueCardResult({
      ...facts,
      result: result({ hands: 120, bb100: 0, stderr: 0, divergentPairs: 0, inert: true }),
    });
    expect(block).toContain('SIGNIFICANT:     no (INERT;');
    expect(block).toContain('z:               n/a (stderr is 0)');
    expect(block).toContain('NOTE:            60 of 100 requested pairs were played');
  });
});

describe('pooledLeagueCardSeeds', () => {
  it('averages equal-size seeds and combines their standard errors', () => {
    const pooled = pooledLeagueCardSeeds([
      result({ bb100: 4, stderr: 3 }),
      result({ bb100: 2, stderr: 4 }),
    ]);
    expect(pooled).toEqual({ bb100: 3, stderr: 2.5, seeds: 2 });
  });

  it('pools nothing for one run, unequal runs or an inert run', () => {
    expect(pooledLeagueCardSeeds([result()])).toBeNull();
    expect(pooledLeagueCardSeeds([result(), result({ hands: 100 })])).toBeNull();
    expect(pooledLeagueCardSeeds([result(), result({ inert: true })])).toBeNull();
  });
});
