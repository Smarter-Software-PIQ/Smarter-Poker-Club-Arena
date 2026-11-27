/**
 * LAW: A FOLD FACING THE FIRST BET OF A HEADS-UP NLH CASH RIVER IS RE-PRICED ON WHAT SUCH A BET IS
 * (holdemRiverFacingBetPriorIsPeopleMeasured; default OFF, read `=== true`; PLO-OWNER lead-9 2026-11-27;
 * docs/horse-option-authority.d/holdemRiverFacingBetPriorIsPeopleMeasured.md).
 *
 *  1. THE SHARES: equilibrium is the anchor (a bet of s pots bluffs s / (1 + 2 s)). People's measured river first bets
 *     (bets by PEOPLE only, shown cards only: the table and its fit never count a Horse's bet or an unshown card), by
 *     size, line and pot type, in five regions (the top fifth cut in three), move it, each cell shrunk by 20
 *     pseudo-bets. The bettor's own public record moves it again and dominates as it grows: his lifetime rate of
 *     making the first wager on an unopened heads-up river, shrunk to people's river rate times his pooled rate
 *     ratio (his betCheckedTo counters): a frequent river bettor's bets are less often top, a rare one's more often.
 *  2. THE PRICE: the Horse's exact share of wins against each region; the call is taken only when its value clears
 *     the sampling error of the share it was priced on.
 *  3. REAL RECORDED NODES (the deciding Horse's own cards only): off the brain folds; on it calls on every seed with
 *     its receipt where the price says so, and the fold stands with its receipt where it does not; a truthy
 *     non-boolean is off; a tournament copy is never touched; a rare river bettor's record turns the call back into
 *     a fold. His river record reaches the decision through the installed NLH packet (the option is a consumer).
 *     The option never changes a decision that is not a fold.
 *  4. COST: an applicable decision with the option on costs a bounded multiple of the same decision off
 *     (src/testing/relativeCost.ts; theServerSuiteAssertsNoTightWallClockBound forbids a millisecond limit).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tables from './HorseHoldemFacingBetPeoplePriorTables.json' with { type: 'json' };
import {
  HOLDEM_FACING_BET_PEOPLE_CHECKED_TO_RATE,
  HOLDEM_FACING_BET_PEOPLE_RIVER_RATE,
  HOLDEM_FACING_BET_RIVER_RECORD_PRIOR_OPPS,
  holdemFacingBetRho,
  HOLDEM_FACING_BET_PRIOR_BETS,
  HOLDEM_FACING_BET_RECORD_PRIOR_OPPS,
  holdemFacingBetAnchor,
  holdemFacingBetLineOf,
  holdemFacingBetOwnShares,
  holdemFacingBetPeopleShares,
  holdemFacingBetPotOf,
  holdemFacingBetPrice,
  holdemFacingBetRegionWins,
  holdemFacingBetSizeCell,
  holdemFacingBetTopShare,
  HOLDEM_FACING_BET_REGION_FROM,
  HOLDEM_FACING_BET_TOP_REGIONS,
} from './HorseHoldemFacingBetPeoplePrior.js';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { restoreFastRandom, saveFastRandom } from './HorseEval.js';
import { HorseMind } from './HorseMind.js';
import { buildHudPacket, clearDecisionHud, installDecisionHud } from './opponentHud/OpponentHud.js';
import { emptyHudProfile } from './opponentHud/OpponentHudProfile.js';
import { omahaLifetimeStreetRecordHudProvider } from './opponentHud/OmahaTurn4bHudProviders.js';
import { HUD_NLH_RIVER_CONSUMERS } from '../services/OpponentHudStore.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import type { Card } from '../types.js';

const OPTION = 'holdemRiverFacingBetPriorIsPeopleMeasured';
const RATIO_DECISION = 16;
interface FixNode {
  hand: ExtractedHand;
  ord: number;
  street: string;
  option: string;
  expect: string;
}
const FIX = JSON.parse(
  readFileSync(
    new URL('./HorseHoldemRiverFacingBetPriorIsPeopleMeasured.fixture.json', import.meta.url),
    'utf8'
  )
) as { nodes: FixNode[]; productionOpts: Record<string, unknown> };
const PROD = FIX.productionOpts;
const prof = replayProfiles('cash')[0];
const SEEDS = [1, 7, 42];
const CALL = 'holdem_river_people_prior_call';
const STANDS = 'holdem_river_people_prior_fold_stands';
const calls = FIX.nodes.filter((n) => n.expect === CALL);
const stays = FIX.nodes.filter((n) => n.expect === STANDS);
const stateOf = (n: FixNode) =>
  stateAt(n.hand, n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction);
const T = tables as unknown as {
  note: string;
  checkedTo: { bets: number; opps: number; rate: number; priorStrength: number };
  riverUnopened: { bets: number; opps: number; rate: number; priorStrength: number };
  cells: Record<string, number[]>;
};
const sum = (x: readonly number[]) => x.reduce((a, b) => a + b, 0);
const c = (s: string): Card =>
  ({
    rank: s[0],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[s[1] as 'c'],
  }) as Card;
const cards = (s: string) => s.split(' ').map(c);

describe('what a river first bet is: the table and the shares', () => {
  it('the table holds people-only river cells counted on shown cards', () => {
    expect(T.note).toMatch(
      /People-only FIRST bets of a heads-up NLH river \(the bettor a person; shown cards only\)/
    );
    const keys = Object.keys(T.cells);
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const key of keys) expect(key).toMatch(/^river\|(cash|any)\|/);
    const all = T.cells['river|any|all|all|all'] as number[];
    expect(all).toHaveLength(5);
    expect(sum(all)).toBeGreaterThanOrEqual(300);
    // every finer cell is a part of its pooled cell
    for (const [key, v] of Object.entries(T.cells)) {
      const pooled = T.cells[key.replace(/\|[^|]+$/, '|all')] as number[];
      for (let i = 0; i < 5; i++) expect(v[i]).toBeLessThanOrEqual(pooled[i] as number);
    }
    expect(T.checkedTo.rate).toBeCloseTo(T.checkedTo.bets / T.checkedTo.opps, 3);
    expect(HOLDEM_FACING_BET_PEOPLE_CHECKED_TO_RATE).toBe(T.checkedTo.rate);
    expect(HOLDEM_FACING_BET_RECORD_PRIOR_OPPS).toBe(T.checkedTo.priorStrength);
    expect(HOLDEM_FACING_BET_REGION_FROM).toEqual([0.95, 0.9, 0.8, 0.5, 0]);
    expect(HOLDEM_FACING_BET_TOP_REGIONS).toBe(3);
  });

  it('the fit reads no unshown card and counts no bet by a Horse', () => {
    const src = readFileSync(
      new URL('../../../scripts/ops/holdem-people-facing-bet-prior-fit.mjs', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/seat\.horse \|\| d\.origin === 'horse_policy'\) return null/);
    expect(src).toMatch(/H\.shown\.get\(seat\.uid\)/);
    expect(src).not.toMatch(/hole_cards|holeCards/);
  });

  it('the anchor is the indifference share and a cell is shrunk to its parent', () => {
    const a1 = holdemFacingBetAnchor(1);
    expect(a1[4]).toBeCloseTo(1 / 3, 12);
    expect(a1[3]).toBe(0);
    expect(a1[0] + a1[1] + a1[2]).toBeCloseTo(2 / 3, 12);
    expect(a1[2]).toBeCloseTo(2 * a1[0], 12); // by width: the good region is twice as wide as the nut region
    expect(holdemFacingBetAnchor(0.5)[4]).toBeCloseTo(0.25, 12);
    expect(holdemFacingBetSizeCell(0.39)).toBe('a<40');
    expect(holdemFacingBetSizeCell(0.4)).toBe('b40-70');
    expect(holdemFacingBetSizeCell(1.1)).toBe('c70-110');
    expect(holdemFacingBetSizeCell(1.11)).toBe('d>110');
    for (const ratio of [0.3, 0.55, 0.9, 1.5])
      for (const line of ['b', 'c', 'x', null] as const)
        for (const pot of ['limped', 'single', 'reraised', null] as const) {
          const s = holdemFacingBetPeopleShares(ratio, line, pot);
          expect(sum(s.share)).toBeCloseTo(1, 12);
          expect(holdemFacingBetTopShare(s.share)).toBeGreaterThan(0);
          expect(s.n).toBeGreaterThanOrEqual(HOLDEM_FACING_BET_PRIOR_BETS);
        }
    // a size few people have been shown betting stays near the anchor of that size
    const pooledBig = T.cells['river|any|d>110|all|all'] ?? [0, 0, 0, 0, 0];
    if (sum(pooledBig) < 20) {
      const big = holdemFacingBetPeopleShares(1.5, null, null);
      expect(Math.abs((big.share[4] as number) - holdemFacingBetAnchor(1.5)[4])).toBeLessThan(0.2);
    }
    // people's big river bets are nut-heavy inside the top fifth: the cell says so
    const bigBet = holdemFacingBetPeopleShares(0.9, null, null).share;
    expect(bigBet[0]).toBeGreaterThan(bigBet[2] as number);
  });

  it('his own record moves the shares: a frequent river bettor is less often top, a rare one more often', () => {
    const people = holdemFacingBetPeopleShares(0.9, 'x', 'single');
    const top0 = holdemFacingBetTopShare(people.share);
    expect(holdemFacingBetRho(null, null)).toEqual({ rho: 1, opps: 0 });
    expect(holdemFacingBetOwnShares(people, 1)).toBe(people);
    const p = HOLDEM_FACING_BET_PEOPLE_CHECKED_TO_RATE;
    const pr = HOLDEM_FACING_BET_PEOPLE_RIVER_RATE;
    // records at exactly people's rates change nothing
    expect(holdemFacingBetRho({ bets: pr * 1000, opps: 1000 }, null).rho).toBeCloseTo(1, 9);
    expect(holdemFacingBetRho(null, { bets: p * 1000, opps: 1000 }).rho).toBeCloseTo(1, 9);
    // his river record dominates as it grows: he bets every unopened river
    let last = top0;
    let lastRho = 1;
    for (const opps of [5, 20, 80, 320]) {
      const { rho } = holdemFacingBetRho({ bets: opps, opps }, null);
      expect(rho).toBeGreaterThan(lastRho);
      const often = holdemFacingBetOwnShares(people, rho);
      const top = holdemFacingBetTopShare(often.share);
      expect(top).toBeLessThan(last);
      expect(sum(often.share)).toBeCloseTo(1, 12);
      // each part keeps people's proportions inside it
      expect((often.share[3] as number) / (often.share[4] as number)).toBeCloseTo(
        (people.share[3] as number) / (people.share[4] as number),
        9
      );
      expect((often.share[0] as number) / (often.share[2] as number)).toBeCloseTo(
        (people.share[0] as number) / (people.share[2] as number),
        9
      );
      last = top;
      lastRho = rho;
    }
    expect(lastRho).toBeGreaterThan(0.9 / pr); // at 320 of 320 his river rate is near 1
    expect(last).toBeLessThan(top0 * (pr + 0.05));
    // a value-only river bettor: he bets one unopened river in eight, whatever he does on the flop and turn
    const rare = holdemFacingBetRho({ bets: 25, opps: 200 }, { bets: p * 600, opps: 600 });
    expect(rare.rho).toBeLessThan(0.5);
    const rareShares = holdemFacingBetOwnShares(people, rare.rho);
    expect(holdemFacingBetTopShare(rareShares.share)).toBeCloseTo(1, 12);
    expect((rareShares.share[3] as number) + (rareShares.share[4] as number)).toBeCloseTo(0, 12);
    // with no river record his pooled record is the estimate, and it is the prior his river record starts from
    const pooledOnly = holdemFacingBetRho(null, { bets: 300, opps: 400 });
    expect(pooledOnly.rho).toBeGreaterThan(2);
    const thinRiver = holdemFacingBetRho({ bets: 1, opps: 2 }, { bets: 300, opps: 400 });
    expect(thinRiver.rho).toBeGreaterThan(1.5);
    expect(thinRiver.rho).toBeLessThan(pooledOnly.rho + 0.5);
    expect(HOLDEM_FACING_BET_RIVER_RECORD_PRIOR_OPPS).toBe(T.riverUnopened.priorStrength);
    expect(pr).toBeCloseTo(T.riverUnopened.bets / T.riverUnopened.opps, 3);
  });

  it('the line and the pot type are read from the public action', () => {
    const h = (rows: [number, string, string][]) =>
      rows.map(([seat, stage, action]) => ({ seat, stage, action }));
    expect(
      holdemFacingBetLineOf(
        h([
          [1, 'flop', 'bet'],
          [2, 'turn', 'check'],
          [1, 'turn', 'check'],
        ]),
        1
      )
    ).toBe('x');
    expect(
      holdemFacingBetLineOf(
        h([
          [1, 'turn', 'bet'],
          [2, 'turn', 'call'],
        ]),
        1
      )
    ).toBe('b');
    expect(
      holdemFacingBetLineOf(
        h([
          [1, 'turn', 'bet'],
          [2, 'turn', 'raise'],
          [1, 'turn', 'call'],
        ]),
        1
      )
    ).toBe('c');
    expect(
      holdemFacingBetPotOf(
        h([
          [1, 'preflop', 'call'],
          [2, 'preflop', 'check'],
        ])
      )
    ).toBe('limped');
    expect(
      holdemFacingBetPotOf(
        h([
          [1, 'preflop', 'raise'],
          [2, 'preflop', 'call'],
        ])
      )
    ).toBe('single');
    expect(
      holdemFacingBetPotOf(
        h([
          [1, 'preflop', 'raise'],
          [2, 'preflop', 'raise'],
          [1, 'preflop', 'call'],
        ])
      )
    ).toBe('reraised');
  });
});

describe('the price of the call', () => {
  const board = cards('Ah Kd 9c 8s 3d');
  it('the Horse wins exactly what its hand beats in each region', () => {
    const nuts = holdemFacingBetRegionWins(cards('As Ac'), board)!.wins;
    const pair = holdemFacingBetRegionWins(cards('Kh Qh'), board)!.wins;
    const air = holdemFacingBetRegionWins(cards('7h 6h'), board)!.wins;
    expect(nuts).toEqual([1, 1, 1, 1, 1]);
    expect(pair[4]).toBe(1);
    expect(pair[3]).toBeGreaterThan(0.5);
    expect(pair[0]).toBe(0); // second pair beats no nut-region hand
    expect(pair[2]).toBeLessThan(1);
    expect(air[0] + air[1] + air[2] + air[3]).toBe(0);
    expect(air[4]).toBeLessThan(0.6);
    // stronger hands win at least as much in every region
    for (let r = 0; r < 5; r++) {
      expect(nuts[r]).toBeGreaterThanOrEqual(pair[r] as number);
      expect(pair[r]).toBeGreaterThanOrEqual(air[r] as number);
    }
    expect(holdemFacingBetRegionWins(cards('As Ac'), board.slice(0, 4))).toBeNull();
    expect(holdemFacingBetRegionWins(cards('Ah Ac'), board)).toBeNull(); // a card twice
  });

  it('the call needs its value to clear the sampling error of the share', () => {
    const wins = [0, 0, 0, 1, 1] as const;
    const shares = { share: [0.3, 0.2, 0.1, 0.15, 0.25] as const, n: 40 };
    // pot 100 with his bet of 50 in it: the call of 50 wins 100; equity 0.4 > 1/3
    const p = holdemFacingBetPrice(wins, shares, 100, 50, 0)!;
    expect(p.equity).toBeCloseTo(0.4, 12);
    expect(p.value).toBeCloseTo(0.4 * 150 - 50, 9);
    expect(p.error).toBeCloseTo(Math.sqrt((0.4 * 0.6) / 40) * 150, 9);
    expect(p.call).toBe(false); // value 10 does not clear an error of 11.6
    expect(holdemFacingBetPrice(wins, { ...shares, n: 400 }, 100, 50, 0)!.call).toBe(true);
    // a hand that beats the good part of the top fifth is not paid for the nut part
    const good = holdemFacingBetPrice([0, 0, 1, 1, 1], { ...shares, n: 400 }, 100, 50, 0)!;
    expect(good.equity).toBeCloseTo(0.5, 12);
    // rake comes out of the prize
    expect(holdemFacingBetPrice(wins, shares, 100, 50, 0.05)!.value).toBeCloseTo(
      0.4 * 150 * 0.95 - 50,
      9
    );
    expect(holdemFacingBetPrice(wins, shares, 0, 50, 0)).toBeNull();
    expect(holdemFacingBetPrice(wins, shares, 100, 0, 0)).toBeNull();
  });
});

describe('a river fold is re-priced on people: real recorded nodes', () => {
  it('the fixture holds folds that become calls and folds that stand, with the deciding Horse cards only', () => {
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(stays.length).toBeGreaterThanOrEqual(2);
    for (const n of FIX.nodes)
      expect(
        Object.keys((n.hand as unknown as { horseHoleCards: object }).horseHoleCards)
      ).toHaveLength(1);
  });

  for (const n of calls) {
    it(`${n.hand.handId}: off folds, on calls with its receipt`, () => {
      const rng = saveFastRandom();
      try {
        const st = stateOf(n);
        const off = replayAt(st, prof, SEEDS, PROD);
        expect(off.kinds).toEqual({ fold: SEEDS.length });
        for (const v of [false, 1, 'true'])
          expect(replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: v }).kinds).toEqual(off.kinds);
        const on = replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: true });
        expect(on.kinds).toEqual({ call: SEEDS.length });
        expect(on.receipts[CALL]).toBe(SEEDS.length);
        // tournaments are out of scope
        const t = stateOf(n);
        (t.gs as unknown as { gameMode: string }).gameMode = 'tournament';
        const tOn = replayAt(t, prof, SEEDS, { ...PROD, [OPTION]: true });
        expect(tOn.receipts[CALL] ?? 0).toBe(0);
      } finally {
        restoreFastRandom(rng);
      }
    });
  }

  for (const n of stays) {
    it(`${n.hand.handId}: the fold stands`, () => {
      const rng = saveFastRandom();
      try {
        const st = stateOf(n);
        const on = replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: true });
        expect(on.kinds).toEqual({ fold: SEEDS.length });
        expect(on.receipts[STANDS]).toBe(SEEDS.length);
        expect(on.receipts[CALL] ?? 0).toBe(0);
      } finally {
        restoreFastRandom(rng);
      }
    });
  }

  it("the bettor's own river record decides: a rare river bettor's turns the call back into a fold, a frequent one's keeps it", () => {
    const rng = saveFastRandom();
    let record: { bets: number; opps: number } | null = null;
    const asked: string[] = [];
    HorseMind.setOmahaLifetimeStreetRecordProvider({
      unopenedWagerRecord: (_u, game, street, players) => {
        asked.push(`${game}|${street}|${players}`);
        return record;
      },
      stabSizeRecord: () => null,
      firstWagerFoldRecord: () => null,
    });
    try {
      for (const n of calls) {
        const st = stateOf(n);
        const opts = { ...PROD, [OPTION]: true, mind: true, observeMind: false };
        // (with the mind on the brain itself may already call a seed; where it folds, the option is asked)
        record = { bets: 20, opps: 200 };
        const rare = replayAt(st, prof, SEEDS, opts);
        expect(rare.receipts[CALL] ?? 0, 'rare river bettor').toBe(0);
        expect(rare.receipts.holdem_river_people_prior_own_record_read ?? 0).toBe(
          rare.receipts[STANDS] ?? 0
        );
        record = { bets: 150, opps: 200 };
        const often = replayAt(st, prof, SEEDS, opts);
        expect(often.kinds, 'frequent river bettor').toEqual({ call: SEEDS.length });
        expect(often.receipts[STANDS] ?? 0, 'frequent river bettor').toBe(0);
      }
      // the record asked for is the NLH heads-up river record
      expect(new Set(asked)).toEqual(new Set(['nlh|river|hu']));
    } finally {
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
      restoreFastRandom(rng);
    }
  });
});

describe('his lifetime river record reaches the decision through the installed NLH packet', () => {
  it('the worker provider serves his NLH heads-up river stab and lead cells; no packet or another family is no record', () => {
    const OPP = '50000000-0000-4000-8000-0000000000e2';
    const AT = Date.UTC(2099, 0, 1, 0, 0, 30);
    const packet = (family: 'nlh' | 'plo5') => {
      const profile = emptyHudProfile(OPP, family);
      profile.hands = 400;
      profile.recAt = AT;
      profile.life['r.stab.hu'] = [60, 30];
      profile.life['r.lead.hu'] = [40, 6];
      // a multiway cell and a turn cell are never read for it
      profile.life['r.stab.mw'] = [90, 9];
      profile.life['t.stab.hu'] = [80, 8];
      return buildHudPacket(family, [profile], {}, AT, 'river');
    };
    try {
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
      installDecisionHud(packet('nlh'));
      expect(HorseMind.holdemRiverUnopenedWagerRecordOf(OPP)).toBeNull();
      // the provider the decision worker installs (installOmahaTurn4bHudProviders)
      HorseMind.setOmahaLifetimeStreetRecordProvider(omahaLifetimeStreetRecordHudProvider);
      expect(HorseMind.holdemRiverUnopenedWagerRecordOf(OPP)).toEqual({ bets: 36, opps: 100 });
      expect(HorseMind.holdemRiverUnopenedWagerRecordOf('somebody-else')).toBeNull();
      installDecisionHud(packet('plo5'));
      expect(HorseMind.holdemRiverUnopenedWagerRecordOf(OPP)).toBeNull();
      clearDecisionHud();
      expect(HorseMind.holdemRiverUnopenedWagerRecordOf(OPP)).toBeNull();
    } finally {
      clearDecisionHud();
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
    }
  });

  it('the option is a consumer of the NLH river packet', () => {
    expect(HUD_NLH_RIVER_CONSUMERS).toContain(OPTION);
  });
});

describe('LAW: the people-priced river fold is cheap where it applies', () => {
  it('an applicable decision with the option on costs a bounded multiple of the same decision off', () => {
    const spots = FIX.nodes.map((n) => stateOf(n));
    const costSeeds = [1, 7];
    const cost = measureRelativeCost(
      () => {
        for (const st of spots) replayAt(st, prof, costSeeds, { ...PROD, [OPTION]: true });
      },
      () => {
        for (const st of spots) replayAt(st, prof, costSeeds, PROD);
      },
      { warmupRounds: 1, rounds: 5 }
    );
    const n = spots.length * costSeeds.length;
    console.info(
      `[holdem river facing bet on people] on ${(cost.subjectMs / n).toFixed(2)} ms, off ${(cost.referenceMs / n).toFixed(2)} ms ` +
        `per decision over ${n} decisions, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
