/**
 * LAW: A FOLD FACING THE FIRST BET OF A HEADS-UP NLH CASH RIVER IS RE-PRICED ON WHAT SUCH A BET IS
 * (holdemRiverFacingBetPriorIsPeopleMeasured; default OFF, read `=== true`; PLO-OWNER lead-9 2026-11-27;
 * docs/horse-option-authority.d/holdemRiverFacingBetPriorIsPeopleMeasured.md).
 *
 *  1. THE SHARES: equilibrium is the anchor (a bet of s pots bluffs s / (1 + 2 s)). People's measured river first bets
 *     (bets by PEOPLE only, shown cards only: the table and its fit never count a Horse's bet or an unshown card), by
 *     size, line and pot type, in six regions (the top fifth cut in three, the middle in two), move it, each cell
 *     shrunk by 20 pseudo-bets. The bettor's OWN SHOWN river bets (HorseHoldemBetRead: what his called heads-up river
 *     first bets turned out to be) move it again and dominate as they grow, against the measured between-bettor
 *     prior strength. How often he bets is not read.
 *  2. THE RECORD is public only: a river first bet enters with the cards its bettor SHOWED at the showdown (a mucked
 *     hand as lower middle, never as air); a bet that won without a showdown, a multiway river, a tournament, a bomb
 *     pot, a second board and every other game add nothing; a hand is learned once.
 *  3. THE PRICE: the Horse's exact share of wins against each region; the call is taken only when its value clears
 *     the error of the share about this bettor.
 *  4. REAL RECORDED NODES (the deciding Horse's own cards only): off the brain folds; on it calls on every seed with
 *     its receipt where the price says so, and the fold stands with its receipt where it does not; a truthy
 *     non-boolean is off; a tournament copy is never touched; a bettor whose shown river bets were all value turns
 *     the call back into a fold. The option never changes a decision that is not a fold.
 *  5. COST: an applicable decision with the option on costs a bounded multiple of the same decision off
 *     (src/testing/relativeCost.ts; theServerSuiteAssertsNoTightWallClockBound forbids a millisecond limit).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tables from './HorseHoldemFacingBetPeoplePriorTables.json' with { type: 'json' };
import {
  HOLDEM_FACING_BET_OWN_PRIOR_BETS,
  HOLDEM_FACING_BET_PRIOR_BETS,
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
  HOLDEM_BET_READ_MUCKED_REGION,
  holdemBetReadBeatsShare,
  holdemBetReadIncrementOf,
  holdemBetReadLearn,
  holdemBetReadNewStore,
  holdemBetReadNote,
  holdemBetReadOf,
  holdemBetReadRegionOf,
  holdemBetReadRowCount,
  holdemBetReadUseStore,
} from './HorseHoldemBetRead.js';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { restoreFastRandom, saveFastRandom } from './HorseEval.js';
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
// folds that stand against a bettor never seen at a showdown and become calls once he has been shown bluffing
const recordCalls = FIX.nodes.filter((n) => n.expect === 'record_call');
const stateOf = (n: FixNode) =>
  stateAt(n.hand, n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction);
const T = tables as unknown as {
  note: string;
  ownShown: { bettors: number; bets: number; priorStrength: number };
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
    for (const key of keys) expect(key).toMatch(/^(river|turn)\|(cash|any)\|/);
    expect(keys.filter((key) => key.startsWith('river|')).length).toBeGreaterThanOrEqual(20);
    const all = T.cells['river|any|all|all|all'] as number[];
    expect(all).toHaveLength(6);
    expect(sum(all)).toBeGreaterThanOrEqual(300);
    // every finer cell is a part of its pooled cell
    for (const [key, v] of Object.entries(T.cells)) {
      const pooled = T.cells[key.replace(/\|[^|]+$/, '|all')] as number[];
      for (let i = 0; i < 6; i++) expect(v[i]).toBeLessThanOrEqual(pooled[i] as number);
    }
    // the weight people's cell keeps against a bettor's own shown river bets is measured, not chosen
    expect(T.ownShown.bettors).toBeGreaterThanOrEqual(40);
    expect(HOLDEM_FACING_BET_OWN_PRIOR_BETS).toBe(T.ownShown.priorStrength);
    expect(HOLDEM_FACING_BET_OWN_PRIOR_BETS).toBeGreaterThan(2);
    expect(HOLDEM_FACING_BET_OWN_PRIOR_BETS).toBeLessThan(40);
    expect(HOLDEM_FACING_BET_REGION_FROM).toEqual([0.95, 0.9, 0.8, 0.7, 0.5, 0]);
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
    // how often a player bets is no longer measured: the price reads what his bets were shown to be
    expect(src).not.toMatch(/checkedTo|riverUnopened/);
  });

  it('the anchor is the indifference share and a cell is shrunk to its parent', () => {
    const a1 = holdemFacingBetAnchor(1);
    expect(a1[5]).toBeCloseTo(1 / 3, 12);
    expect(a1[3]).toBe(0);
    expect(a1[4]).toBe(0);
    expect(a1[0] + a1[1] + a1[2]).toBeCloseTo(2 / 3, 12);
    expect(a1[2]).toBeCloseTo(2 * a1[0], 12); // by width: the good region is twice as wide as the nut region
    expect(holdemFacingBetAnchor(0.5)[5]).toBeCloseTo(0.25, 12);
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
    const pooledBig = T.cells['river|any|d>110|all|all'] ?? [0, 0, 0, 0, 0, 0];
    if (sum(pooledBig) < 20) {
      const big = holdemFacingBetPeopleShares(1.5, null, null);
      expect(
        Math.abs((big.share[5] as number) - (holdemFacingBetAnchor(1.5)[5] as number))
      ).toBeLessThan(0.2);
    }
    // people's big river bets are nut-heavy inside the top fifth: the cell says so
    const bigBet = holdemFacingBetPeopleShares(0.9, null, null).share;
    expect(bigBet[0]).toBeGreaterThan(bigBet[2] as number);
  });

  it('his own shown river bets in the cell move the shares and dominate as they grow; how often he bets is not read', () => {
    const k = HOLDEM_FACING_BET_OWN_PRIOR_BETS;
    const people = holdemFacingBetPeopleShares(0.9, 'x', 'single');
    const top0 = holdemFacingBetTopShare(people.share);
    const none = holdemFacingBetOwnShares(0.9, 'x', 'single', null);
    // no shown bet of his in the cell: people's cell exactly, priced with the margin of a bettor nothing is known about
    expect(none.share).toEqual(people.share);
    expect(none.shown).toBe(0);
    expect(none.n).toBeCloseTo((k * people.n) / (k + people.n), 12);
    expect(none.n).toBeLessThan(k);
    expect(holdemFacingBetOwnShares(0.9, 'x', 'single', [0, 0, 0, 0, 0, 0])).toEqual(none);
    const rec = (region: number, n: number) => {
      const c = [0, 0, 0, 0, 0, 0];
      c[region] = n;
      return c;
    };
    // a bettor shown bluffing: the bottom share grows with every shown bet and the top share falls
    let lastBottom = people.share[5] as number;
    let lastTop = top0;
    for (const n of [1, 3, 9, 27, 81]) {
      const s = holdemFacingBetOwnShares(0.9, 'x', 'single', rec(5, n));
      expect(sum(s.share)).toBeCloseTo(1, 12);
      expect(s.share[5]).toBeGreaterThan(lastBottom);
      expect(holdemFacingBetTopShare(s.share)).toBeLessThan(lastTop);
      expect(s.shown).toBe(n);
      expect(s.n).toBeCloseTo(none.n + n, 12);
      // his bets enter once: n shown bluffs against k pseudo-bets of people's cell, nothing more
      expect(s.share[5]).toBeCloseTo((n + k * (people.share[5] as number)) / (n + k), 12);
      lastBottom = s.share[5] as number;
      lastTop = holdemFacingBetTopShare(s.share);
    }
    expect(lastBottom).toBeGreaterThan(0.9);
    // three shown bluffs do not make him a bluffer yet: people's cell still weighs more
    expect(holdemFacingBetOwnShares(0.9, 'x', 'single', rec(5, 3)).share[5]).toBeLessThan(0.5);
    // a bettor shown with the nuts every time: his bets are top, whatever people's are
    const value = holdemFacingBetOwnShares(0.9, 'x', 'single', rec(0, 81));
    expect(holdemFacingBetTopShare(value.share)).toBeGreaterThan(0.89);
    expect(value.share[5]).toBeLessThan(0.05);
    // a record exactly at people's proportions changes nothing but the margin
    const same = holdemFacingBetOwnShares(
      0.9,
      'x',
      'single',
      people.share.map((x) => 30 * x)
    );
    for (let i = 0; i < 6; i++) expect(same.share[i]).toBeCloseTo(people.share[i] as number, 9);
    expect(same.n).toBeCloseTo(none.n + 30, 9);
    // the module reads no frequency of his and pools nothing across his sizes or lines
    const src = readFileSync(
      new URL('./HorseHoldemFacingBetPeoplePrior.ts', import.meta.url),
      'utf8'
    );
    expect(src).not.toMatch(/betCheckedTo|unopenedWagerRecord|holdemFacingBetRho|tilted\(/);
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
    expect(nuts).toEqual([1, 1, 1, 1, 1, 1]);
    expect(pair[5]).toBe(1);
    expect(pair[4]).toBe(1);
    expect(pair[3]).toBeGreaterThan(0);
    expect(pair[0]).toBe(0); // second pair beats no nut-region hand
    expect(pair[2]).toBeLessThan(1);
    expect(air[0]! + air[1]! + air[2]! + air[3]! + air[4]!).toBe(0);
    expect(air[5]).toBeLessThan(0.6);
    // stronger hands win at least as much in every region
    for (let r = 0; r < 6; r++) {
      expect(nuts[r]).toBeGreaterThanOrEqual(pair[r] as number);
      expect(pair[r]).toBeGreaterThanOrEqual(air[r] as number);
    }
    expect(holdemFacingBetRegionWins(cards('As Ac'), board.slice(0, 4))).toBeNull();
    expect(holdemFacingBetRegionWins(cards('Ah Ac'), board)).toBeNull(); // a card twice
  });

  it('the call needs its value to clear the sampling error of the share', () => {
    const wins = [0, 0, 0, 1, 1, 1] as const;
    const shares = { share: [0.3, 0.2, 0.1, 0.05, 0.1, 0.25] as const, n: 40 };
    // pot 100 with his bet of 50 in it: the call of 50 wins 100; equity 0.4 > 1/3
    const p = holdemFacingBetPrice(wins, shares, 100, 50, 0)!;
    expect(p.equity).toBeCloseTo(0.4, 12);
    expect(p.value).toBeCloseTo(0.4 * 150 - 50, 9);
    expect(p.error).toBeCloseTo(Math.sqrt((0.4 * 0.6) / 40) * 150, 9);
    expect(p.call).toBe(false); // value 10 does not clear an error of 11.6
    expect(holdemFacingBetPrice(wins, { ...shares, n: 400 }, 100, 50, 0)!.call).toBe(true);
    // a hand that beats the good part of the top fifth is not paid for the nut part
    const good = holdemFacingBetPrice([0, 0, 1, 1, 1, 1], { ...shares, n: 400 }, 100, 50, 0)!;
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
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(recordCalls.length).toBeGreaterThanOrEqual(4);
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

  it("the bettor's own shown river bets decide: all air turns the fold into a call, all value keeps the fold", () => {
    const rng = saveFastRandom();
    const before = holdemBetReadUseStore(holdemBetReadNewStore());
    const shown = (uid: string, region: number) => {
      holdemBetReadUseStore(holdemBetReadNewStore());
      for (const line of ['b', 'c', 'x'] as const)
        for (let size = 0; size < 4; size++)
          for (let i = 0; i < 24; i++) holdemBetReadNote(uid, line, size, region);
    };
    try {
      for (const n of [...recordCalls, ...calls]) {
        const st = stateOf(n);
        const me = (n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction).seat;
        const opp = (
          st.gs.players as Array<{ seat: number; user_id: string; is_folded?: boolean }>
        ).find((p) => p.seat !== me && !p.is_folded)!;
        const opts = { ...PROD, [OPTION]: true, mind: true, observeMind: false };
        if (n.expect === 'record_call') {
          // never seen at a showdown: the fold stands
          holdemBetReadUseStore(holdemBetReadNewStore());
          const unknown = replayAt(st, prof, SEEDS, opts);
          expect(unknown.kinds, 'a bettor never shown').toEqual({ fold: SEEDS.length });
          expect(unknown.receipts[STANDS]).toBe(SEEDS.length);
          expect(unknown.receipts.holdem_river_people_prior_own_record_read ?? 0).toBe(0);
        }
        shown(opp.user_id, 5);
        const air = replayAt(st, prof, SEEDS, opts);
        expect(air.kinds, 'a bettor shown with air').toEqual({ call: SEEDS.length });
        expect(air.receipts[STANDS] ?? 0, 'a bettor shown with air').toBe(0);
        // a bet made into more than one player is not a heads-up bet: with a fold on the river before the Horse answers
        // (a third player folded to the bet) nothing is priced, whatever his record says
        const multi = stateOf(n);
        (multi.gs.actionHistory as unknown as Array<Record<string, unknown>>).push({
          seat: 99,
          stage: 'river',
          action: 'fold',
          amount: 0,
        });
        const three = replayAt(multi, prof, SEEDS, opts);
        expect(three.receipts[CALL] ?? 0, 'a bet into two players').toBe(0);
        expect(three.receipts[STANDS] ?? 0, 'a bet into two players').toBe(0);
        if (n.expect === 'record_call') {
          expect(air.receipts[CALL]).toBe(SEEDS.length);
          expect(air.receipts.holdem_river_people_prior_own_record_read).toBe(SEEDS.length);
          // off: his record changes nothing
          expect(replayAt(st, prof, SEEDS, { ...opts, [OPTION]: false }).kinds).toEqual({
            fold: SEEDS.length,
          });
          // with the mind off his record is not read
          const blind = replayAt(st, prof, SEEDS, { ...opts, mind: false });
          expect(blind.receipts.holdem_river_people_prior_own_record_read ?? 0).toBe(0);
          expect(blind.receipts[CALL] ?? 0).toBe(0);
        }
        shown(opp.user_id, 0);
        const value = replayAt(st, prof, SEEDS, opts);
        expect(value.receipts[CALL] ?? 0, 'a bettor shown with the nuts').toBe(0);
        expect(value.receipts.holdem_river_people_prior_own_record_read ?? 0).toBe(
          value.receipts[STANDS] ?? 0
        );
      }
    } finally {
      holdemBetReadUseStore(before);
      restoreFastRandom(rng);
    }
  });
});

describe('the record: what his called river bets were shown to be, public only', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001';
  const B = 'bbbbbbbb-0000-4000-8000-000000000002';
  const C = 'cccccccc-0000-4000-8000-000000000003';
  const act = (u: string, stage: string, action: string, amount = 0, pot?: number) => ({
    userId: u,
    stage,
    action,
    amount,
    ...(pot === undefined ? {} : { publicNode: { pot, toCall: 0 } }),
  });
  const BOARD = ['Ahearts', 'Kdiamonds', '9clubs', '8spades', '3diamonds'];
  const headsUp = (riverBet: number, turn: 'b' | 'c' | 'x' = 'x') => [
    act(A, 'preflop', 'sb', 1),
    act(B, 'preflop', 'bb', 2),
    act(C, 'preflop', 'fold'),
    act(A, 'preflop', 'call', 1),
    act(B, 'preflop', 'check'),
    act(B, 'flop', 'check'),
    act(A, 'flop', 'check'),
    ...(turn === 'x'
      ? [act(B, 'turn', 'check'), act(A, 'turn', 'check')]
      : turn === 'b'
        ? [act(B, 'turn', 'check'), act(A, 'turn', 'bet', 2), act(B, 'turn', 'call', 2)]
        : [act(B, 'turn', 'bet', 2), act(A, 'turn', 'call', 2)]),
    act(B, 'river', 'check'),
    act(A, 'river', 'bet', riverBet),
    act(B, 'river', 'call', riverBet),
  ];
  let nextHandKey = 0;
  const hand = (over: Record<string, unknown> = {}) => ({
    handKey: `k-${++nextHandKey}`,
    variant: 'nlh',
    mode: 'cash' as const,
    actions: headsUp(3),
    board: BOARD,
    shown: new Map<string, unknown[]>([
      [A, ['7hearts', '6hearts']],
      [B, ['Kclubs', 'Qclubs']],
    ]),
    showdown: [
      { user_id: A, mucked: false },
      { user_id: B, mucked: false },
    ],
    boardCount: 1,
    ...over,
  });
  const fresh = () => holdemBetReadUseStore(holdemBetReadNewStore());

  it('a shown river first bet enters by line, size and the region of the shown hand', () => {
    const before = fresh();
    try {
      // pot 4 before the river, a bet of 3: 0.75 pot, the turn checked through, seven high: bottom
      const inc = holdemBetReadIncrementOf(hand() as never)!;
      expect(inc).toMatchObject({ userId: A, line: 'x', size: 2, region: 5, shown: true });
      expect(holdemBetReadLearn(hand({ handKey: 'h1' }) as never)).toBe(true);
      expect(holdemBetReadLearn(hand({ handKey: 'h1' }) as never)).toBe(false); // once per hand
      expect(holdemBetReadOf(A, 'x', 0.75)).toEqual([0, 0, 0, 0, 0, 1]);
      // his bets are read in the cell they were made in: another size or another line holds nothing of this bet
      expect(holdemBetReadOf(A, 'x', 0.3)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(holdemBetReadOf(A, 'b', 0.75)).toEqual([0, 0, 0, 0, 0, 0]);
      // the caller made no river bet: he has no record, and neither has anybody else
      expect(holdemBetReadOf(B, 'x', 0.75)).toBeNull();
      expect(holdemBetReadRowCount()).toBe(1);
      // his line: he bet the turn himself / the other player did
      expect(holdemBetReadIncrementOf(hand({ actions: headsUp(4, 'b') }) as never)!.line).toBe('b');
      expect(holdemBetReadIncrementOf(hand({ actions: headsUp(4, 'c') }) as never)!.line).toBe('c');
      // the nuts shown: the nut region
      const nuts = hand({ shown: new Map([[A, ['Aspades', 'Aclubs']]]) });
      expect(holdemBetReadIncrementOf(nuts as never)!.region).toBe(0);
      const share = holdemBetReadBeatsShare(
        [
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'hearts' },
        ] as Card[],
        cards('Ah Kd 9c 8s 3d')
      )!;
      expect(share).toBeGreaterThan(0.5);
      expect(share).toBeLessThan(0.95);
      expect(holdemBetReadRegionOf(0.95)).toBe(0);
      expect(holdemBetReadRegionOf(0.75)).toBe(3);
      expect(holdemBetReadRegionOf(0.5)).toBe(4);
      expect(holdemBetReadRegionOf(0.49)).toBe(5);
    } finally {
      holdemBetReadUseStore(before);
    }
  });

  it('no unshown card ever enters: a mucked hand is lower middle, an uncalled bet adds nothing', () => {
    const before = fresh();
    try {
      // listed as mucked: his cards are not read even if the row carried them
      const mucked = hand({
        showdown: [
          { user_id: A, mucked: true },
          { user_id: B, mucked: false },
        ],
      });
      expect(holdemBetReadIncrementOf(mucked as never)).toMatchObject({
        region: HOLDEM_BET_READ_MUCKED_REGION,
        shown: false,
      });
      expect(HOLDEM_BET_READ_MUCKED_REGION).toBe(4);
      // not in the showdown list (the bet won without a showdown): nothing, whatever the shown map holds
      expect(holdemBetReadIncrementOf(hand({ showdown: [] }) as never)).toBeNull();
      expect(holdemBetReadIncrementOf(hand({ showdown: null }) as never)).toBeNull();
      // listed as shown but no cards came with the row: nothing
      expect(holdemBetReadIncrementOf(hand({ shown: new Map() }) as never)).toBeNull();
      // a three-way river is not a heads-up river bet
      const threeWay = hand({
        actions: [
          act(A, 'preflop', 'call', 2),
          act(B, 'preflop', 'check'),
          act(C, 'preflop', 'call', 2),
          act(B, 'river', 'check'),
          act(A, 'river', 'bet', 3),
          act(C, 'river', 'fold'),
          act(B, 'river', 'call', 3),
        ],
      });
      expect(holdemBetReadIncrementOf(threeWay as never)).toBeNull();
      // only NLH cash, one board, no bomb pot is learned
      for (const over of [
        { variant: 'plo5' },
        { mode: 'tournament' },
        { bombPot: true },
        { boardCount: 2 },
        { handKey: '' },
      ])
        expect(holdemBetReadLearn(hand(over) as never)).toBe(false);
      expect(holdemBetReadRowCount()).toBe(0);
      // the module and its callers take cards only from the showdown reveal
      const src = readFileSync(new URL('./HorseHoldemBetRead.ts', import.meta.url), 'utf8');
      expect(src).toMatch(/if \(!sd\) return null;/);
      expect(src).toMatch(/sd\.mucked === true/);
      expect(src).not.toMatch(/horseHoleCards|holeCardsAll/);
    } finally {
      holdemBetReadUseStore(before);
    }
  });

  it('the live learner, the boot rebuild and the grading harness feed it; nothing reads how often he bets', () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    expect(read('./horseDecision/workerRuntime.ts')).toMatch(/holdemBetReadLearn\(\{/);
    expect(read('../services/HorseExploitHydrator.ts')).toMatch(/holdemBetReadLearn\(hand\)/);
    expect(read('../benchmark/HorseGradeHarness.ts')).toMatch(
      /holdemBetReadUseStore\(this\.holdemStore\)/
    );
    const logic = read('./HorseLogic.ts');
    const at = logic.indexOf('private static holdemRiverFacingBetOnPeople(');
    const body = logic.slice(at, logic.indexOf('\n  /**', at));
    expect(body).toMatch(/holdemBetReadOf\(opp\.user_id, line, ratio\)/);
    expect(body).not.toMatch(/betCheckedTo|unopenedWagerRecord|getExploitCounters/);
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
