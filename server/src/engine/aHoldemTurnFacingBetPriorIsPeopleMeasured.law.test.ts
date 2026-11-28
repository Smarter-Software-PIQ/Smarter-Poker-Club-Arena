/**
 * LAW: A FOLD FACING THE FIRST BET OF A HEADS-UP NLH CASH TURN AFTER A CHECKED FLOP IS RE-PRICED ON WHAT SUCH A BET IS
 * (holdemTurnFacingBetPriorIsPeopleMeasured; default OFF, read `=== true`; PLO-OWNER lead-9 2026-11-27;
 * docs/horse-option-authority.d/holdemTurnFacingBetPriorIsPeopleMeasured.md).
 *
 *  1. THE SHARES: equilibrium is the anchor. People's measured first bets of a heads-up turn after a flop nobody bet
 *     (bets by PEOPLE only; shown cards, plus the hidden bets the public record marks as not value: mucked at the
 *     showdown, given up on the river), by size and pot type, in the river's six regions taken ON THE TURN, move it.
 *     The bettor's OWN turn stabs (HorseHoldemBetRead) move it again and dominate as they grow, against the measured
 *     between-bettor prior strength.
 *  2. THE RECORD is public only: a turn stab enters with the cards its bettor showed, as lower middle when he mucked
 *     at the showdown, as bottom when he gave the hand up (nobody raised his bet, he checked the river and folded);
 *     a bet that was raised and folded, a bet that won without a showdown, a turn after a flop somebody bet and a
 *     multiway turn add nothing.
 *  3. THE PRICE: the Horse's exact equity over every river card against each region, discounted by the realization
 *     of a turn call; the call is taken only when its value clears the error of the share about this bettor.
 *  4. REAL RECORDED NODES (the deciding Horse's own cards only): off the brain folds; on it calls on every seed with
 *     its receipt where the price says so and the fold stands with its receipt where it does not; a truthy
 *     non-boolean is off; a tournament copy is never touched; a bettor shown stabbing with air turns a standing fold
 *     into a call and one shown with the nuts keeps the fold. The option never changes a decision that is not a fold.
 *  5. COST: an applicable decision with the option on costs a bounded multiple of the same decision off
 *     (src/testing/relativeCost.ts; theServerSuiteAssertsNoTightWallClockBound forbids a millisecond limit).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tables from './HorseHoldemFacingBetPeoplePriorTables.json' with { type: 'json' };
import {
  HOLDEM_FACING_BET_PRIOR_BETS,
  HOLDEM_TURN_FACING_BET_OWN_PRIOR_BETS,
  holdemFacingBetFlopWasChecked,
  holdemFacingBetRealized,
  holdemFacingBetTopShare,
  holdemTurnFacingBetOwnShares,
  holdemTurnFacingBetPeopleShares,
  holdemTurnFacingBetRegionEquities,
} from './HorseHoldemFacingBetPeoplePrior.js';
import {
  HOLDEM_BET_READ_MUCKED_REGION,
  holdemBetReadBeatsShare,
  holdemBetReadLearn,
  holdemBetReadNewStore,
  holdemBetReadNoteTurn,
  holdemBetReadOf,
  holdemBetReadTurnIncrementOf,
  holdemBetReadTurnOf,
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

const OPTION = 'holdemTurnFacingBetPriorIsPeopleMeasured';
const RATIO_DECISION = 24;
interface FixNode {
  hand: ExtractedHand;
  ord: number;
  street: string;
  option: string;
  expect: string;
}
const FIX = JSON.parse(
  readFileSync(
    new URL('./HorseHoldemTurnFacingBetPriorIsPeopleMeasured.fixture.json', import.meta.url),
    'utf8'
  )
) as { nodes: FixNode[]; productionOpts: Record<string, unknown> };
const PROD = FIX.productionOpts;
const prof = replayProfiles('cash')[0];
const SEEDS = [1, 7, 42];
const CALL = 'holdem_turn_people_prior_call';
const STANDS = 'holdem_turn_people_prior_fold_stands';
const READ = 'holdem_turn_people_prior_own_record_read';
const calls = FIX.nodes.filter((n) => n.expect === CALL);
const stays = FIX.nodes.filter((n) => n.expect === STANDS);
const recordCalls = FIX.nodes.filter((n) => n.expect === 'record_call');
const stateOf = (n: FixNode) =>
  stateAt(n.hand, n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction);
const T = tables as unknown as {
  note: string;
  turn: { betsUsed: number; shown: number; mucked: number; gaveUp: number };
  ownShownTurn: { bettors: number; bets: number; priorStrength: number | null };
  ownShown: { priorStrength: number };
  cells: Record<string, number[]>;
};
const sum = (x: readonly number[]) => x.reduce((a, b) => a + b, 0);
const c = (s: string): Card =>
  ({
    rank: s[0],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[s[1] as 'c'],
  }) as Card;
const cards = (s: string) => s.split(' ').map(c);

describe('what a turn bet after a checked flop is: the table and the shares', () => {
  it('the table holds people-only turn cells with the hidden bets counted', () => {
    expect(T.note).toMatch(/Key turn\|fmt\|size\|line\|pot/);
    expect(T.note).toMatch(/mucked at the showdown \(lower middle\) and given up/);
    const x = T.cells['turn|any|all|x|all'] as number[];
    expect(x).toHaveLength(6);
    expect(sum(x)).toBeGreaterThanOrEqual(80);
    expect(T.turn.betsUsed).toBe(T.turn.shown + T.turn.mucked + T.turn.gaveUp);
    expect(T.turn.mucked + T.turn.gaveUp).toBeGreaterThan(0);
    for (const [key, v] of Object.entries(T.cells)) {
      if (!key.startsWith('turn|')) continue;
      const pooled = T.cells[key.replace(/\|[^|]+$/, '|all')] as number[];
      for (let i = 0; i < 6; i++) expect(v[i]).toBeLessThanOrEqual(pooled[i] as number);
    }
    // people's turn bets after a checked flop are the weakest of the three lines
    const notTop = (k: string) => {
      const v = T.cells[k] as number[];
      return 1 - (v[0]! + v[1]! + v[2]!) / sum(v);
    };
    expect(notTop('turn|any|all|x|all')).toBeGreaterThan(notTop('turn|any|all|b|all'));
    expect(HOLDEM_TURN_FACING_BET_OWN_PRIOR_BETS).toBe(
      T.ownShownTurn.priorStrength ?? T.ownShown.priorStrength
    );
    const src = readFileSync(
      new URL('../../../scripts/ops/holdem-people-facing-bet-prior-fit.mjs', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/export function turnFirstBetOf/);
    expect(src).toMatch(/hidden = 'gaveUp'/);
    expect(src).not.toMatch(/hole_cards|holeCards/);
  });

  it('a cell is shrunk to its parent and his own turn stabs move it and dominate as they grow', () => {
    for (const ratio of [0.3, 0.55, 0.9, 1.5])
      for (const pot of ['limped', 'single', null] as const) {
        const s = holdemTurnFacingBetPeopleShares(ratio, pot);
        expect(sum(s.share)).toBeCloseTo(1, 12);
        expect(s.n).toBeGreaterThanOrEqual(HOLDEM_FACING_BET_PRIOR_BETS);
      }
    const k = HOLDEM_TURN_FACING_BET_OWN_PRIOR_BETS;
    const people = holdemTurnFacingBetPeopleShares(0.6, 'single');
    const none = holdemTurnFacingBetOwnShares(0.6, 'single', null);
    expect(none.share).toEqual(people.share);
    expect(none.shown).toBe(0);
    expect(none.n).toBeCloseTo((k * people.n) / (k + people.n), 12);
    const rec = (region: number, n: number) => {
      const v = [0, 0, 0, 0, 0, 0];
      v[region] = n;
      return v;
    };
    let lastBottom = people.share[5] as number;
    for (const n of [2, 6, 18, 54, 162]) {
      const s = holdemTurnFacingBetOwnShares(0.6, 'single', rec(5, n));
      expect(sum(s.share)).toBeCloseTo(1, 12);
      expect(s.share[5]).toBeGreaterThan(lastBottom);
      expect(s.n).toBeCloseTo(none.n + n, 12);
      lastBottom = s.share[5] as number;
    }
    expect(lastBottom).toBeGreaterThan(0.9);
    const value = holdemTurnFacingBetOwnShares(0.6, 'single', rec(0, 162));
    expect(holdemFacingBetTopShare(value.share)).toBeGreaterThan(0.9);
    // his stabs enter once: n against k pseudo-bets of people's cell
    const six = holdemTurnFacingBetOwnShares(0.6, 'single', rec(5, 6));
    expect(six.share[5]).toBeCloseTo((6 + k * (people.share[5] as number)) / (6 + k), 12);
    expect(holdemTurnFacingBetOwnShares(0.6, 'single', [0, 0, 0, 0, 0, 0])).toEqual(none);
  });

  it('the checked flop is read from the public action', () => {
    const h = (rows: [string, string][]) => rows.map(([stage, action]) => ({ stage, action }));
    expect(
      holdemFacingBetFlopWasChecked(
        h([
          ['preflop', 'raise'],
          ['flop', 'check'],
          ['flop', 'check'],
          ['turn', 'bet'],
        ])
      )
    ).toBe(true);
    expect(
      holdemFacingBetFlopWasChecked(
        h([
          ['flop', 'bet'],
          ['flop', 'call'],
        ])
      )
    ).toBe(false);
    expect(
      holdemFacingBetFlopWasChecked(
        h([
          ['flop', 'check'],
          ['flop', 'all_in'],
        ])
      )
    ).toBe(false);
    // no flop action at all (all-in before the flop) is not a checked flop
    expect(holdemFacingBetFlopWasChecked(h([['preflop', 'raise']]))).toBe(false);
    expect(holdemFacingBetFlopWasChecked(undefined)).toBe(false);
  });
});

describe('the price of the turn call', () => {
  const board = cards('Ah Kd 9c 3s');
  it('the Horse wins against each region exactly what its hand wins over every river card', () => {
    const set = holdemTurnFacingBetRegionEquities(cards('As Ac'), board)!.wins;
    const pair = holdemTurnFacingBetRegionEquities(cards('Kh Qh'), board)!.wins;
    const air = holdemTurnFacingBetRegionEquities(cards('7h 6h'), board)!.wins;
    for (const w of [set, pair, air]) {
      expect(w).toHaveLength(6);
      for (const x of w) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
    // top set is far ahead of every region, and even of the nut region (lower sets, two pair)
    expect(set[5]).toBeGreaterThan(0.95);
    expect(set[0]).toBeGreaterThan(0.6);
    // second pair: ahead of the bottom, behind the top; a turn equity, so never exactly 0 or 1 against the middle
    expect(pair[5]).toBeGreaterThan(0.75);
    expect(pair[0]).toBeLessThan(0.15);
    expect(pair[4]).toBeGreaterThan(pair[2] as number);
    // seven high: behind everything but the very bottom, with a few outs
    expect(air[5]).toBeLessThan(0.45);
    expect(air[0]).toBeLessThan(0.1);
    // a stronger hand wins more against every region (the cards a hand holds change his holdings a little, so the
    // comparison is made with a small allowance)
    for (let r = 0; r < 6; r++) {
      expect((set[r] as number) + 0.02).toBeGreaterThanOrEqual(pair[r] as number);
      expect((pair[r] as number) + 0.02).toBeGreaterThanOrEqual(air[r] as number);
    }
    // a flush draw has equity against the top that a made bottom hand has not
    const draw = holdemTurnFacingBetRegionEquities(cards('Qc Jc'), cards('Ac Kd 9c 3s'))!.wins;
    expect(draw[1]).toBeGreaterThan(0.15);
    expect(holdemTurnFacingBetRegionEquities(cards('As Ac'), cards('Ah Kd 9c 8s 3d'))).toBeNull();
    expect(holdemTurnFacingBetRegionEquities(cards('Ah Ac'), board)).toBeNull(); // a card twice
    // the realization of a call before the river scales every region; none (or a nonsense value) leaves it whole
    expect(holdemFacingBetRealized([1, 0.5, 0, 0, 0, 0], 0.8)).toEqual([0.8, 0.4, 0, 0, 0, 0]);
    expect(holdemFacingBetRealized([1, 0.5], 1)).toEqual([1, 0.5]);
    expect(holdemFacingBetRealized([1, 0.5], Number.NaN)).toEqual([1, 0.5]);
    // the standing a hand is given on the turn is the record's own measure
    expect(holdemBetReadBeatsShare(cards('As Ac'), board)).toBeGreaterThan(0.99);
    expect(holdemBetReadBeatsShare(cards('7h 6h'), board)).toBeLessThan(0.3);
    expect(holdemBetReadBeatsShare(cards('As Ac'), board.slice(0, 3))).toBeNull();
  });
});

describe('the record: what his turn stabs were, public only', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001';
  const B = 'bbbbbbbb-0000-4000-8000-000000000002';
  const C = 'cccccccc-0000-4000-8000-000000000003';
  const act = (u: string, stage: string, action: string, amount = 0) => ({
    userId: u,
    stage,
    action,
    amount,
  });
  const BOARD = ['Ahearts', 'Kdiamonds', '9clubs', '3spades', '8diamonds'];
  const pre = [
    act(A, 'preflop', 'sb', 1),
    act(B, 'preflop', 'bb', 2),
    act(C, 'preflop', 'fold'),
    act(A, 'preflop', 'call', 1),
    act(B, 'preflop', 'check'),
  ];
  const flopChecked = [act(B, 'flop', 'check'), act(A, 'flop', 'check')];
  const stab = [act(B, 'turn', 'check'), act(A, 'turn', 'bet', 2), act(B, 'turn', 'call', 2)];
  const hand = (over: Record<string, unknown> = {}) => ({
    handKey: `k-${Math.random()}`,
    variant: 'nlh',
    mode: 'cash' as const,
    actions: [...pre, ...flopChecked, ...stab, act(B, 'river', 'check'), act(A, 'river', 'check')],
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

  it('a turn stab enters by size and by where the shown hand stood on the turn', () => {
    const before = holdemBetReadUseStore(holdemBetReadNewStore());
    try {
      // pot 4 before the turn, a bet of 2: half pot; seven high on A K 9 3: bottom
      expect(holdemBetReadTurnIncrementOf(hand() as never)).toEqual({
        userId: A,
        size: 1,
        region: 5,
        source: 'shown',
      });
      expect(holdemBetReadLearn(hand({ handKey: 't1' }) as never)).toBe(true);
      expect(holdemBetReadTurnOf(A, 0.5)).toEqual([0, 0, 0, 0, 0, 1]);
      // read in the size cell it was made in
      expect(holdemBetReadTurnOf(A, 0.9)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(holdemBetReadTurnOf(B, 0.5)).toBeNull();
      // the turn stab is not a river bet: his river record is untouched
      for (const line of ['b', 'c', 'x'] as const)
        for (const ratio of [0.3, 0.5, 0.9, 1.5])
          expect(sum(holdemBetReadOf(A, line, ratio)!)).toBe(0);
      // the region is the turn's: a hand that made its straight on the river is counted as it stood on the turn
      const rivered = hand({
        shown: new Map([[A, ['7hearts', '6hearts']]]),
        board: [...BOARD.slice(0, 4), '5clubs'],
      });
      expect(holdemBetReadTurnIncrementOf(rivered as never)!.region).toBe(5);
      const nuts = hand({ shown: new Map([[A, ['Aspades', 'Aclubs']]]) });
      expect(holdemBetReadTurnIncrementOf(nuts as never)!.region).toBe(0);
    } finally {
      holdemBetReadUseStore(before);
    }
  });

  it('a hidden bet enters by its public outcome only; everything else adds nothing', () => {
    const noShow = { shown: new Map(), showdown: [] };
    // mucked at the showdown: lower middle
    expect(
      holdemBetReadTurnIncrementOf(
        hand({
          showdown: [
            { user_id: A, mucked: true },
            { user_id: B, mucked: false },
          ],
        }) as never
      )
    ).toEqual({ userId: A, size: 1, region: HOLDEM_BET_READ_MUCKED_REGION, source: 'mucked' });
    // a give-up: he checked the river and folded to a bet: bottom
    const gaveUp = hand({
      ...noShow,
      actions: [
        ...pre,
        ...flopChecked,
        act(A, 'turn', 'bet', 2),
        act(B, 'turn', 'call', 2),
        act(A, 'river', 'check'),
        act(B, 'river', 'bet', 6),
        act(A, 'river', 'fold'),
      ],
    });
    expect(holdemBetReadTurnIncrementOf(gaveUp as never)).toEqual({
      userId: A,
      size: 1,
      region: 5,
      source: 'gaveUp',
    });
    // his bet was raised and he folded: his hand is unknown, nothing
    const raised = hand({
      ...noShow,
      actions: [
        ...pre,
        ...flopChecked,
        act(B, 'turn', 'check'),
        act(A, 'turn', 'bet', 2),
        act(B, 'turn', 'raise', 8),
        act(A, 'turn', 'fold'),
      ],
    });
    expect(holdemBetReadTurnIncrementOf(raised as never)).toBeNull();
    // the bet won without a showdown: nothing
    const won = hand({
      ...noShow,
      actions: [
        ...pre,
        ...flopChecked,
        act(B, 'turn', 'check'),
        act(A, 'turn', 'bet', 2),
        act(B, 'turn', 'fold'),
      ],
    });
    expect(holdemBetReadTurnIncrementOf(won as never)).toBeNull();
    // he bet the river himself and it was folded to, or he folded the river to a bet without checking first: nothing
    const barrel = hand({
      ...noShow,
      actions: [
        ...pre,
        ...flopChecked,
        ...stab,
        act(B, 'river', 'check'),
        act(A, 'river', 'bet', 6),
        act(B, 'river', 'fold'),
      ],
    });
    expect(holdemBetReadTurnIncrementOf(barrel as never)).toBeNull();
    // somebody bet the flop: not this line
    const flopBet = hand({
      actions: [...pre, act(B, 'flop', 'bet', 2), act(A, 'flop', 'call', 2), ...stab],
    });
    expect(holdemBetReadTurnIncrementOf(flopBet as never)).toBeNull();
    // three players live on the turn: not a heads-up stab
    const threeWay = hand({
      actions: [
        act(A, 'preflop', 'call', 2),
        act(B, 'preflop', 'check'),
        act(C, 'preflop', 'call', 2),
        act(B, 'flop', 'check'),
        act(A, 'flop', 'check'),
        act(C, 'flop', 'check'),
        act(B, 'turn', 'check'),
        act(A, 'turn', 'bet', 3),
        act(C, 'turn', 'fold'),
        act(B, 'turn', 'call', 3),
      ],
    });
    expect(holdemBetReadTurnIncrementOf(threeWay as never)).toBeNull();
    const src = readFileSync(new URL('./HorseHoldemBetRead.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/horseHoleCards|holeCardsAll/);
  });
});

describe('a turn fold after a checked flop is re-priced on people: real recorded nodes', () => {
  it('the fixture holds folds that become calls and folds that stand, with the deciding Horse cards only', () => {
    expect(calls.length + recordCalls.length).toBeGreaterThanOrEqual(4);
    expect(recordCalls.length).toBeGreaterThanOrEqual(2);
    expect(stays.length).toBeGreaterThanOrEqual(2);
    for (const n of FIX.nodes) {
      expect(
        Object.keys((n.hand as unknown as { horseHoleCards: object }).horseHoleCards)
      ).toHaveLength(1);
      const st = stateOf(n);
      expect(st.gs.stage).toBe('turn');
      expect(holdemFacingBetFlopWasChecked(st.gs.actionHistory as never)).toBe(true);
    }
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
        // the river option is another option: it does not touch a turn decision
        const river = replayAt(st, prof, SEEDS, {
          ...PROD,
          holdemRiverFacingBetPriorIsPeopleMeasured: true,
        });
        expect(river.kinds).toEqual(off.kinds);
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

  it("the bettor's own turn stabs decide: all air turns the fold into a call, all value keeps the fold", () => {
    const rng = saveFastRandom();
    const before = holdemBetReadUseStore(holdemBetReadNewStore());
    const stabs = (uid: string, region: number, n = 48) => {
      holdemBetReadUseStore(holdemBetReadNewStore());
      for (let size = 0; size < 4; size++)
        for (let i = 0; i < n; i++) holdemBetReadNoteTurn(uid, size, region);
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
          holdemBetReadUseStore(holdemBetReadNewStore());
          const unknown = replayAt(st, prof, SEEDS, opts);
          expect(unknown.kinds, 'a bettor never seen').toEqual({ fold: SEEDS.length });
          expect(unknown.receipts[STANDS]).toBe(SEEDS.length);
          expect(unknown.receipts[READ] ?? 0).toBe(0);
        }
        stabs(opp.user_id, 5);
        const air = replayAt(st, prof, SEEDS, opts);
        expect(air.kinds, 'a bettor shown stabbing with air').toEqual({ call: SEEDS.length });
        // a bet made into more than one player is not a heads-up bet: with a fold on the turn before the Horse answers
        // (a third player folded to the bet) nothing is priced, whatever his record says
        const multi = stateOf(n);
        (multi.gs.actionHistory as unknown as Array<Record<string, unknown>>).push({
          seat: 99,
          stage: 'turn',
          action: 'fold',
          amount: 0,
        });
        const three = replayAt(multi, prof, SEEDS, opts);
        expect(three.receipts[CALL] ?? 0, 'a bet into two players').toBe(0);
        expect(three.receipts[STANDS] ?? 0, 'a bet into two players').toBe(0);
        if (n.expect === 'record_call') {
          expect(air.receipts[CALL]).toBe(SEEDS.length);
          expect(air.receipts[READ]).toBe(SEEDS.length);
          expect(replayAt(st, prof, SEEDS, { ...opts, [OPTION]: false }).kinds).toEqual({
            fold: SEEDS.length,
          });
          const blind = replayAt(st, prof, SEEDS, { ...opts, mind: false });
          expect(blind.receipts[READ] ?? 0).toBe(0);
          expect(blind.receipts[CALL] ?? 0).toBe(0);
        }
        // shown stabbing with the nuts hundreds of times: a fold that only stood or fell on what the bet is stands
        stabs(opp.user_id, 0, 800);
        const value = replayAt(st, prof, SEEDS, opts);
        if (n.expect === 'record_call')
          expect(value.receipts[CALL] ?? 0, 'a bettor shown stabbing with the nuts').toBe(0);
        else
          expect(value.receipts[READ] ?? 0, 'his record is read').toBe(
            (value.receipts[CALL] ?? 0) + (value.receipts[STANDS] ?? 0)
          );
      }
    } finally {
      holdemBetReadUseStore(before);
      restoreFastRandom(rng);
    }
  });
});

describe('LAW: the people-priced turn fold is cheap where it applies', () => {
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
      `[holdem turn facing bet on people] on ${(cost.subjectMs / n).toFixed(2)} ms, off ${(cost.referenceMs / n).toFixed(2)} ms ` +
        `per decision over ${n} decisions, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
