/**
 * LAW: A FOLD FACING THE FIRST BET OF A HEADS-UP NLH CASH TURN AFTER A CHECKED FLOP IS PRICED WITH THE RIVER PLAYED TO A
 * PLAN, AND THE PLAN'S RIVER CALLS ARE MADE (holdemTurnFacingBetAfterCheckedFlopIsPeoplePriced; default OFF, read
 * `=== true`; PLO-OWNER lead-10 2026-11-28; docs/horse-option-authority.d/holdemTurnFacingBetAfterCheckedFlopIsPeoplePriced.md).
 *
 *  1. THE PLAN (HorseHoldemTurnRiverPlan): his turn range by turn region from his own stabs -> people's cell (hidden
 *     bets counted) -> equilibrium; on every river card his barrel is the part of that range whose make-up matches his
 *     river bets after his own turn bet, how often he barrels moved by his own record; the Horse calls a barrel exactly
 *     where the river price calls (its value clears its error), and takes its showdown share when he checks. A turn
 *     call is bought only with value the plan counts, taken with his shares one standard error toward his top fifth.
 *  2. THE RECORD is public only: a mucked showdown loser is spread over the turn regions of the holdings that lose to
 *     the shown winner (the mucked cards are never read); his river after a called stab is a barrel or a check.
 *  3. REAL RECORDED NODES (the deciding Horse's own cards only): off the brain folds; on it calls where the plan says
 *     so and the fold stands where it does not; a truthy non-boolean is off; a tournament copy is never touched; a
 *     stabber with an all-air record turns a standing fold into a call, on the turn and on the river after a call.
 *  4. COST: an applicable decision with the option on costs a bounded multiple of the same decision off
 *     (src/testing/relativeCost.ts; theServerSuiteAssertsNoTightWallClockBound forbids a millisecond limit).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  holdemTurnRiverPlanBarrelChance,
  holdemTurnRiverPlanRiverPrice,
  holdemTurnRiverPlanToTop,
  holdemTurnRiverPlanTurnPrice,
} from './HorseHoldemTurnRiverPlan.js';
import {
  holdemBetReadBarrelIncrementOf,
  holdemBetReadBarrelOf,
  holdemBetReadLearn,
  holdemBetReadMuckSpreadOf,
  holdemBetReadNewStore,
  holdemBetReadNote,
  holdemBetReadNoteBarrel,
  holdemBetReadNoteTurn,
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

const OPTION = 'holdemTurnFacingBetAfterCheckedFlopIsPeoplePriced';
const RATIO_DECISION = 40;
interface FixNode {
  hand: ExtractedHand;
  ord: number;
  street: string;
  option: string;
  expect: string;
}
const FIX = JSON.parse(
  readFileSync(
    new URL(
      './HorseHoldemTurnFacingBetAfterCheckedFlopIsPeoplePriced.fixture.json',
      import.meta.url
    ),
    'utf8'
  )
) as { nodes: FixNode[]; productionOpts: Record<string, unknown> };
const PROD = FIX.productionOpts;
const prof = replayProfiles('cash')[0];
const SEEDS = [1, 7, 42];
const stateOf = (n: FixNode) =>
  stateAt(n.hand, n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction);
const c = (s: string): Card =>
  ({
    rank: s[0],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[s[1] as 'c'],
  }) as Card;
const cards = (s: string) => s.split(' ').map(c);
const UNIFORM = [0.05, 0.05, 0.1, 0.1, 0.2, 0.5];
const PEOPLE_RIVER = { share: [0.31, 0.17, 0.08, 0.06, 0.01, 0.37], n: 7.4 };
const spot = (over: Partial<Parameters<typeof holdemTurnRiverPlanTurnPrice>[4]> = {}) => ({
  toCall: 8,
  winnable: 18,
  behind: 180,
  riverRatio: 0.8,
  rake: 0,
  river: PEOPLE_RIVER,
  ...over,
});
const receipt = (street: string, what: string) =>
  street === 'turn' ? `holdem_turn_plan_${what}` : `holdem_turn_plan_river_${what}`;

describe('the plan: the turn call is priced with the river played to it', () => {
  const board = cards('Kd 7c 2h 9s');
  it('with no river betting the value is the showdown share of the pot less the call', () => {
    const p = holdemTurnRiverPlanTurnPrice(
      cards('Th 8h'),
      board,
      UNIFORM,
      1e9,
      spot({ behind: 0 })
    );
    expect(p).not.toBeNull();
    const v = p!.central;
    expect(v.barrel).toBe(0);
    expect(v.value).toBeCloseTo(v.equity * 26 - 8, 9);
  });

  it('a river barrel he can make costs the call; a barrel the plan calls is counted at the river price', () => {
    const quiet = holdemTurnRiverPlanTurnPrice(
      cards('Qs Js'),
      board,
      UNIFORM,
      1e9,
      spot({ behind: 0 })
    )!;
    const loud = holdemTurnRiverPlanTurnPrice(cards('Qs Js'), board, UNIFORM, 1e9, spot())!;
    expect(loud.central.barrel).toBeGreaterThan(0);
    expect(loud.central.value).toBeLessThan(quiet.central.value);
    // a barrel made of air is called and paid on the river: the call is worth more than with no river at all
    const airRiver = { share: [0, 0, 0, 0, 0, 1], n: 400 };
    const bluffed = holdemTurnRiverPlanTurnPrice(
      cards('Qs Js'),
      board,
      UNIFORM,
      1e9,
      spot({ river: airRiver })
    )!;
    expect(bluffed.central.riverCall).toBeGreaterThan(0.5);
    expect(bluffed.central.value).toBeGreaterThan(quiet.central.value);
  });

  it('the call is taken on the cautious value: his shares one standard error toward his top fifth', () => {
    const moved = holdemTurnRiverPlanToTop(UNIFORM, 20);
    expect(moved.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(moved[0]! + moved[1]! + moved[2]!).toBeGreaterThan(0.2);
    const p = holdemTurnRiverPlanTurnPrice(cards('9h 3h'), board, UNIFORM, 20, spot())!;
    expect(p.cautious.value).toBeLessThan(p.central.value);
    expect(p.call).toBe(p.cautious.value > 0);
    // air folds against any range; a strong hand calls
    expect(holdemTurnRiverPlanTurnPrice(cards('5c 4c'), board, UNIFORM, 20, spot())!.call).toBe(
      false
    );
    expect(holdemTurnRiverPlanTurnPrice(cards('Kh 3s'), board, UNIFORM, 20, spot())!.call).toBe(
      true
    );
  });

  it('his own barrel record moves how often he barrels; with no record the make-up alone decides', () => {
    const p = [1, 0.5, 0.2, 0, 0, 0.1];
    expect(holdemTurnRiverPlanBarrelChance(p, 0.3, null)).toEqual(p);
    const never = holdemTurnRiverPlanBarrelChance(p, 0.3, { spots: 60, barrels: 0 });
    for (let r = 0; r < 6; r++) expect(never[r]!).toBeLessThan(p[r]! + 1e-12);
    expect(never[0]! / never[1]!).toBeCloseTo(2, 9); // the make-up is kept
    const always = holdemTurnRiverPlanBarrelChance(p, 0.3, { spots: 60, barrels: 60 });
    for (let r = 0; r < 6; r++) expect(always[r]!).toBeGreaterThanOrEqual(p[r]!);
    expect(always[0]).toBe(1);
    // a give-up record is worth more to the call than a barrel record
    const q = (x: { spots: number; barrels: number }) =>
      holdemTurnRiverPlanTurnPrice(cards('Qs Js'), board, UNIFORM, 1e9, spot({ barrels: x }))!
        .central.value;
    expect(q({ spots: 80, barrels: 0 })).toBeGreaterThan(q({ spots: 80, barrels: 80 }));
  });

  it('the river half prices the bet that came on the card that came, as the plan priced it', () => {
    const b5 = cards('Kd 7c 2h 9s 3d');
    const price = holdemTurnRiverPlanRiverPrice(
      cards('9h 8h'),
      b5,
      UNIFORM,
      PEOPLE_RIVER,
      41.6,
      20.8,
      0
    );
    expect(price).not.toBeNull();
    const air = holdemTurnRiverPlanRiverPrice(
      cards('9h 8h'),
      b5,
      UNIFORM,
      { share: [0, 0, 0, 0, 0, 1], n: 400 },
      41.6,
      20.8,
      0
    )!;
    expect(air.equity).toBeGreaterThan(price!.equity);
    expect(air.call).toBe(true);
    expect(
      holdemTurnRiverPlanRiverPrice(
        cards('9h 8h'),
        cards('Kd 7c 2h 9s'),
        UNIFORM,
        PEOPLE_RIVER,
        41.6,
        20.8,
        0
      )
    ).toBeNull();
  });
});

describe('the record: public only', () => {
  const A = (
    stage: string,
    uid: string,
    action: string,
    amount: number,
    pot: number,
    toCall = 0
  ) => ({
    stage,
    userId: uid,
    action,
    amount,
    publicNode: { pot, toCall },
  });
  const hand = (riverA: string, riverB: string) => ({
    handKey: `h-${riverA}-${riverB}`,
    variant: 'nlh',
    mode: 'cash' as const,
    boardCount: 1,
    board: cards('Kd 7c 2h 9s 4d'),
    actions: [
      A('preflop', 'a', 'call', 1, 3),
      A('preflop', 'b', 'check', 0, 4),
      A('flop', 'b', 'check', 0, 4),
      A('flop', 'a', 'check', 0, 4),
      A('turn', 'b', 'bet', 3, 4),
      A('turn', 'a', 'call', 3, 7, 3),
      A('river', 'b', riverB, riverB === 'bet' ? 5 : 0, 10),
      A(
        'river',
        'a',
        riverA,
        riverA === 'call' ? 5 : 0,
        riverB === 'bet' ? 15 : 10,
        riverB === 'bet' ? 5 : 0
      ),
    ],
    shown: new Map([['a', cards('9h 8h')]]),
    showdown: [{ user_id: 'a' }, { user_id: 'b', mucked: true }],
  });
  it('a mucked stab is spread over the turn regions of the holdings that lose to the shown winner', () => {
    const h = hand('check', 'check');
    const inc = holdemBetReadTurnIncrementOf(h as never)!;
    expect(inc.source).toBe('mucked');
    const spread = inc.spread!;
    expect(spread.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    // nothing that beats a pair of nines on the river stood in his top fifth on this turn
    expect(spread[0]! + spread[1]! + spread[2]!).toBe(0);
    expect(spread[5]!).toBeGreaterThan(0.5);
    expect(holdemBetReadMuckSpreadOf(h as never, 'b')).toEqual(spread);
    // with no shown winner it stays the lower middle
    const blind = { ...h, shown: new Map() };
    expect(holdemBetReadTurnIncrementOf(blind as never)?.spread).toBeUndefined();
  });
  it('his river after a called stab is a barrel or a check, and both are learned', () => {
    const before = holdemBetReadUseStore(holdemBetReadNewStore());
    try {
      expect(holdemBetReadBarrelIncrementOf(hand('check', 'check') as never)).toEqual({
        userId: 'b',
        barrel: false,
      });
      expect(holdemBetReadBarrelIncrementOf(hand('call', 'bet') as never)).toEqual({
        userId: 'b',
        barrel: true,
      });
      holdemBetReadLearn(hand('check', 'check') as never);
      holdemBetReadLearn(hand('call', 'bet') as never);
      expect(holdemBetReadBarrelOf('b')).toEqual({ spots: 2, barrels: 1 });
      const rec = holdemBetReadTurnOf('b', 0.75)!;
      expect(rec.reduce((x, y) => x + y, 0)).toBeCloseTo(2, 9);
    } finally {
      holdemBetReadUseStore(before);
    }
  });
  it('no unshown card is read: the store and the plan read only shown cards, the board and the deciding Horse', () => {
    const src = readFileSync(new URL('./HorseHoldemTurnRiverPlan.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/hole_cards|holeCards|horseHoleCards/);
    const logic = readFileSync(new URL('./HorseLogic.ts', import.meta.url), 'utf8');
    const at = logic.indexOf('private static holdemTurnRiverPlanOnPeople(');
    const body = logic.slice(at, logic.indexOf('\n  /**', at));
    expect(body).toMatch(/opts\.holdemTurnFacingBetAfterCheckedFlopIsPeoplePriced !== true/);
    expect(body).toMatch(/decision\.action !== 'fold'/);
    expect(body).not.toMatch(/is_human|isHuman|isPerson|horseIds/);
  });
});

describe('a turn fold after a checked flop is priced with its river plan: real recorded nodes', () => {
  it('the fixture holds turn calls, turn folds that stand and river calls a record buys, with the deciding Horse cards only', () => {
    const kinds = new Set(FIX.nodes.map((n) => n.expect));
    for (const k of ['call', 'stands', 'record_call', 'river_record_call'])
      expect(kinds.has(k)).toBe(true);
    for (const n of FIX.nodes)
      expect(
        Object.keys((n.hand as unknown as { horseHoleCards: object }).horseHoleCards)
      ).toHaveLength(1);
  });

  for (const n of FIX.nodes) {
    it(`${n.hand.handId} (${n.street}, ${n.expect})`, () => {
      const rng = saveFastRandom();
      const before = holdemBetReadUseStore(holdemBetReadNewStore());
      try {
        const st = stateOf(n);
        const off = replayAt(st, prof, SEEDS, PROD);
        expect(off.kinds).toEqual({ fold: SEEDS.length });
        for (const v of [false, 1, 'true'])
          expect(replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: v }).kinds).toEqual(off.kinds);
        const on = replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: true });
        if (n.expect === 'call') {
          expect(on.kinds).toEqual({ call: SEEDS.length });
          expect(on.receipts[receipt(n.street, 'call')]).toBe(SEEDS.length);
          const t = stateOf(n);
          (t.gs as unknown as { gameMode: string }).gameMode = 'tournament';
          expect(
            replayAt(t, prof, SEEDS, { ...PROD, [OPTION]: true }).receipts[
              receipt(n.street, 'call')
            ] ?? 0
          ).toBe(0);
          return;
        }
        expect(on.kinds).toEqual({ fold: SEEDS.length });
        expect(on.receipts[receipt(n.street, 'fold_stands')]).toBe(SEEDS.length);
        if (n.expect === 'stands') return;
        // an all-air stabber (turn stabs, river barrels and river bets all shown as air) buys the call
        const me = (n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction).seat;
        const opp = (
          st.gs.players as Array<{ seat: number; user_id: string; is_folded?: boolean }>
        ).find((p) => p.seat !== me && !p.is_folded)!;
        for (let size = 0; size < 4; size++)
          for (let i = 0; i < 48; i++) {
            holdemBetReadNoteTurn(opp.user_id, size, 5);
            holdemBetReadNote(opp.user_id, 'b', size, 5);
          }
        for (let i = 0; i < 40; i++) holdemBetReadNoteBarrel(opp.user_id, true);
        const opts = { ...PROD, [OPTION]: true, mind: true, observeMind: false };
        const air = replayAt(st, prof, SEEDS, opts);
        expect(air.kinds).toEqual({ call: SEEDS.length });
        expect(air.receipts[receipt(n.street, 'call')]).toBe(SEEDS.length);
        expect(air.receipts[receipt(n.street, 'own_record_read')]).toBe(SEEDS.length);
        // with the mind off his record is not read
        const blind = replayAt(st, prof, SEEDS, { ...opts, mind: false });
        expect(blind.receipts[receipt(n.street, 'call')] ?? 0).toBe(0);
        // off: his record changes nothing
        expect(replayAt(st, prof, SEEDS, { ...opts, [OPTION]: false }).kinds).toEqual({
          fold: SEEDS.length,
        });
      } finally {
        holdemBetReadUseStore(before);
        restoreFastRandom(rng);
      }
    });
  }
});

describe('LAW: the river-planned turn call is cheap where it applies', () => {
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
      `[holdem turn river plan] on ${(cost.subjectMs / n).toFixed(2)} ms, off ${(cost.referenceMs / n).toFixed(2)} ms ` +
        `per decision over ${n} decisions, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
