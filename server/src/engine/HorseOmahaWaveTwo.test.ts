/**
 * OMAHA WAVE TWO (2026-11-16): where the multiway discipline options and the
 * street plan's flop, three-way and preflop layers meet on one decision.
 *
 *  - Receipt crediting on the multiway turn bet: omahaMultiwayWeakHandNoBet
 *    (an owner-ruled check, inside omahaOopCheckRules) and
 *    omahaStreetPlanThreeWay (a street-plan check, after the owner-ruled
 *    checks) both cover a three-way turn bet. Any check wins; exactly one
 *    non-vetoed check receipt describes the final check: the weak-hand
 *    rule's when it checks (the three-way plan then never runs), the
 *    three-way plan's only on a bet the weak-hand rule let stand.
 *  - Lazy big-draw pricing: the one wager omahaBigDrawVerdict can return is
 *    fixed before any equity is counted; finalCheckVetoes is asked with
 *    exactly that wager, and a true answer skips the count (withheld
 *    'final_check'), a false answer leaves the verdict as it was.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { omahaMultiwayWeakHandSpot } from './HorseOmahaMultiwayDiscipline.js';
import { omahaStreetPlanThreeWaySpot } from './HorseOmahaStreetPlan.js';
import { omahaBigDrawVerdict, type OmahaBigDrawInput } from './HorseOmahaBigDrawAggression.js';
import {
  omahaHandRiverScore,
  omahaTurnRiverTables,
  omahaTurnRiverTablesClear,
  omahaTurnRiverTablesHeld,
} from './HorseOmahaRiverTables.js';
import { scoreOmahaHi, scoreOmahaHiPartial } from './HorseEval.js';
import type { Card, CardRank, CardSuit } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (t: string): Card[] =>
  (t.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 16 }, (_, i) => 9100 + i);

/** PLO4 three-way turn Kh9c4d2s: seat 1 bet the flop, seats 2 and 3 called; the turn is checked to the Horse on the button. */
function multiwayTurn(hole: string) {
  const history: [number, string, string, number][] = [
    [1, 'preflop', 'sb', 1],
    [2, 'preflop', 'bb', 2],
    [3, 'preflop', 'raise', 7],
    [1, 'preflop', 'call', 6],
    [2, 'preflop', 'call', 5],
    [1, 'flop', 'bet', 10],
    [2, 'flop', 'call', 10],
    [3, 'flop', 'call', 10],
    [1, 'turn', 'check', 0],
    [2, 'turn', 'check', 0],
  ];
  const actions = history.map(([seat, stage, action, amount], i) => ({
    ord: i + 1,
    seat,
    stage,
    action,
    amount,
    origin: seat === 3 ? 'horse_policy' : 'player',
  }));
  const node = {
    ord: actions.length + 1,
    seat: 3,
    stage: 'turn',
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot: 51,
      mode: 'cash',
      seats: [
        [1, 400, 0, 17, 0, 0, 0],
        [2, 400, 0, 17, 0, 0, 0],
        [3, 400, 0, 17, 0, 0, 0],
      ],
      boards: ['Kh9c4d2s'],
      street: 'turn',
      toCall: 0,
      currentBet: 0,
      minRaiseTo: 2,
      maxRaiseTo: 51,
      legalActions: ['check', 'bet', 'all_in'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 2,
      smallBlind: 1,
      variant: 'plo4',
      structure: 'pot_limit',
      actorSeat: 3,
      bombPot: false,
      tournamentStage: { status: 'not_applicable', version: 1 },
    },
  };
  const fx = {
    version: 1,
    slug: 'synthetic',
    title: 'synthetic',
    complaint: '',
    handId: 'synthetic',
    fmt: 'cash',
    variant: 'plo4',
    players: [1, 2, 3].map((seat) => ({ seat, isHorse: seat === 3 })),
    hole: { '3': cards(hole) },
    actions: [...actions, node],
    forbidden: [],
    seeds: [],
  } as unknown as ComplaintFixture;
  return stateAt(fx, node as never);
}
type Node = ReturnType<typeof multiwayTurn>;

interface Outcome {
  actions: string[];
  fires: string[][];
  next: number[];
  refusals: (string | null)[];
}
function play(
  build: () => Node,
  opts: HorseDecideOpts,
  reads?: (id: string) => OmahaReadConditional | null
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { actions: [], fires: [], next: [], refusals: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads)
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(((id: string) =>
        reads(id)) as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = structuredClone(
      HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        telemetry: true,
        ...opts,
      } as never)
    );
    out.next.push(fastRandom());
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    out.refusals.push(
      horseDecisionReceiptRefusal(structuredClone(d), st.gs.gameVariant as string, {
        player: st.hero,
        gameState: st.gs,
      })
    );
    vi.restoreAllMocks();
  }
  return out;
}
const isBet = (a: string) => a === 'bet' || a === 'all_in' || a === 'raise';
const WEAK_CHECK = 'omaha_multiway_weak_hand_bet_checked';
const THREE_CHECK = 'omaha_street_plan_three_way_checked';
const BOTH: HorseDecideOpts = { omahaMultiwayWeakHandNoBet: true, omahaStreetPlanThreeWay: true };
const stat = (mean: number) => ({ mean, n: 30, engaged: null, excess: 0 });
/** Measured players who fold to almost every bet: the weak-hand rule's EV comparison lets the bet stand. */
const folder = {
  measured: true,
  valueLeader: false,
  tightReRaiser: false,
  riverCall: stat(0.05),
  foldToBet: stat(0.97),
} as unknown as OmahaReadConditional;

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('Omaha Wave Two: The Multiway Turn Bet Has One Credited Check', () => {
  const TOP_PAIR = () => multiwayTurn('AsKd8c3h');

  it('Both Options Cover The Spot: Top Pair Three-Way On The Turn', () => {
    const st = TOP_PAIR();
    expect(omahaMultiwayWeakHandSpot(st.hero, st.gs)).toBe('turn');
    expect(omahaStreetPlanThreeWaySpot(st.hero, st.gs)).toBe(true);
  });

  it('The Weak-Hand Check Comes First: Its Receipt Alone Describes The Final Check, The Plan Proposes Nothing', () => {
    const off = play(TOP_PAIR, {});
    const on = play(TOP_PAIR, BOTH);
    expect(off.actions.filter(isBet).length).toBeGreaterThan(0);
    SEEDS.forEach((_, i) => {
      expect(isBet(on.actions[i])).toBe(false);
      const f = on.fires[i];
      expect(f.includes(WEAK_CHECK)).toBe(isBet(off.actions[i]));
      expect(f.filter((x) => x === THREE_CHECK || x === `${THREE_CHECK}_vetoed`)).toEqual([]);
      expect(f.filter((x) => x === `${WEAK_CHECK}_vetoed`)).toEqual([]);
      expect(on.refusals[i]).toBeNull();
    });
    expect(on.next).toEqual(off.next);
  });

  it('A Bet The Weak-Hand Rule Lets Stand Is The Plan’s To Check: At Most One Non-Vetoed Check Receipt, And Only On A Final Check', () => {
    const reads = (id: string) => (id === 'p3' ? null : folder);
    const off = play(TOP_PAIR, {}, reads);
    const weak = play(TOP_PAIR, { omahaMultiwayWeakHandNoBet: true }, reads);
    const on = play(TOP_PAIR, BOTH, reads);
    SEEDS.forEach((_, i) => {
      // the folders make the bet worth more: the weak-hand rule keeps today's decision
      expect(weak.actions[i]).toBe(off.actions[i]);
      const f = on.fires[i];
      const credited = f.filter((x) => x === WEAK_CHECK || x === THREE_CHECK);
      expect(credited.length).toBeLessThanOrEqual(1);
      expect(f.includes(WEAK_CHECK)).toBe(false);
      if (credited.length === 1) {
        expect(on.actions[i]).toBe('check');
        expect(isBet(off.actions[i])).toBe(true);
      }
      if (isBet(off.actions[i]) && on.actions[i] === 'check')
        expect(credited).toEqual([THREE_CHECK]);
      expect(on.refusals[i]).toBeNull();
    });
    // the plan does check some of the bets the weak-hand rule let stand, and is credited there
    expect(on.fires.filter((f) => f.includes(THREE_CHECK)).length).toBeGreaterThan(0);
  });
});

const spot = (over: Partial<OmahaBigDrawInput> = {}): OmahaBigDrawInput => ({
  variant: 'plo4',
  street: 'flop',
  hole: cards('AhJh9s7c'),
  board: cards('Th8h2c'),
  action: 'check',
  pot: 20,
  toCall: 0,
  stack: 200,
  heroBet: 0,
  currentBet: 0,
  minRaiseTo: 2,
  maxRaiseTo: 20,
  legalActions: ['fold', 'check', 'bet', 'all_in'],
  opponents: [{ stack: 200, bet: 0, allIn: false, foldToBet: null }],
  inPosition: true,
  hiLo: false,
  multiBoard: false,
  bombPot: false,
  tournament: false,
  allInOrFold: false,
  wagersCapped: false,
  ...over,
});

describe('Omaha Wave Two: Lazy Big-Draw Pricing', () => {
  const INPUTS: [string, OmahaBigDrawInput][] = [
    ['checked to, the pot bet', spot()],
    [
      'checked to, short stacks: the stack',
      spot({ stack: 45, opponents: [{ stack: 45, bet: 0, allIn: false, foldToBet: null }] }),
    ],
    [
      'facing a bet, the pot raise',
      spot({
        action: 'call',
        pot: 30,
        toCall: 10,
        currentBet: 10,
        minRaiseTo: 20,
        maxRaiseTo: 50,
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        opponents: [{ stack: 190, bet: 10, allIn: false, foldToBet: null }],
      }),
    ],
  ];

  it('The Question Is Asked With Exactly The Wager The Verdict Returns', () => {
    for (const [, input] of INPUTS) {
      const full = omahaBigDrawVerdict(input)!;
      expect(full.wager).not.toBeNull();
      const asked: unknown[] = [];
      const kept = omahaBigDrawVerdict({
        ...input,
        finalCheckVetoes: (w) => {
          asked.push(w);
          return false;
        },
      })!;
      expect(asked).toEqual([full.wager]);
      expect(kept).toEqual(full);
    }
  });

  it('A Vetoed Wager Is Not Priced: No Wager, Withheld Final Check, No Equity Count', () => {
    for (const [, input] of INPUTS) {
      const v = omahaBigDrawVerdict({ ...input, finalCheckVetoes: () => true })!;
      expect(v.wager).toBeNull();
      expect(v.withheld).toBe('final_check');
      expect(v.equities).toBeNull();
    }
  });

  it('A Spot The Rule Withholds Before Pricing Never Asks', () => {
    const asked: unknown[] = [];
    const ask = (w: unknown) => {
      asked.push(w);
      return true;
    };
    expect(
      omahaBigDrawVerdict({ ...spot({ inPosition: false }), finalCheckVetoes: ask })!.withheld
    ).toBe('out_of_position');
    expect(
      omahaBigDrawVerdict({
        ...spot({
          opponents: [0, 1, 2].map(() => ({ stack: 200, bet: 0, allIn: false, foldToBet: null })),
        }),
        finalCheckVetoes: ask,
      })!.withheld
    ).toBe('multiway');
    expect(asked).toEqual([]);
  });
});

describe('Omaha Wave Two: The Shared Turn River Tables', () => {
  // flush-heavy, paired, connected and dry turn boards, four- and five-card hands, a dead card
  const SPOTS: [string, string, string][] = [
    ['AhJh9s7c', 'Th8h2c3h', ''],
    ['KsKc7d7c3h', 'Td9d4d2s', ''],
    ['QsQcTd9h', '5s5d8s8h', ''],
    ['9s3dAs9hKh', 'ThQd4h7h', '2d'],
    ['4c3d9cTd8h', '7h5c6h8c', ''],
  ];
  it('Every Entry Is The Engine Evaluator’s Score Of That Pair On That River, Bit For Bit', () => {
    for (const [hole, board, dead] of SPOTS) {
      omahaTurnRiverTablesClear();
      const B = cards(board);
      const t = omahaTurnRiverTables(cards(hole), B, cards(dead))!;
      expect(t.n).toBe(52 - hole.length / 2 - 4 - dead.length / 2);
      const two: Card[] = [t.unseen[0], t.unseen[0]];
      for (let r = 0; r < t.n; r += 5) {
        const five = [...B, t.unseen[r]];
        for (let i = 0; i < t.n; i++)
          for (let j = i + 1; j < t.n; j++) {
            two[0] = t.unseen[i];
            two[1] = t.unseen[j];
            const want = i === r || j === r ? 0 : scoreOmahaHiPartial(two, five);
            expect(t.river[r][i * t.n + j]).toBe(want);
            expect(t.river[r][j * t.n + i]).toBe(want);
            if (r === 0) expect(t.now[i * t.n + j]).toBe(scoreOmahaHiPartial(two, B));
          }
      }
    }
  });

  it('A Hand’s River Score Is scoreOmahaHi’s, And The Entry Is Kept Only For Its Own Cards', () => {
    const [hole, board] = SPOTS[3];
    omahaTurnRiverTablesClear();
    expect(omahaTurnRiverTablesHeld()).toBe(false);
    const t = omahaTurnRiverTables(cards(hole), cards(board))!;
    expect(omahaTurnRiverTables(cards(hole), cards(board))).toBe(t);
    for (let k = 0; k < 40; k++) {
      const hand = [
        k % t.n,
        (k * 7 + 1) % t.n,
        (k * 13 + 2) % t.n,
        (k * 17 + 3) % t.n,
        (k * 19 + 4) % t.n,
      ];
      if (new Set(hand).size !== 5) continue;
      for (let r = 0; r < t.n; r++) {
        if (hand.includes(r)) continue;
        expect(omahaHandRiverScore(t, hand, r)).toBe(
          scoreOmahaHi(
            hand.map((i) => t.unseen[i]),
            [...cards(board), t.unseen[r]]
          )
        );
      }
    }
    // other cards: a new entry, not the old one
    expect(omahaTurnRiverTables(cards(SPOTS[0][0]), cards(SPOTS[0][1]))).not.toBe(t);
    expect(omahaTurnRiverTables(cards(hole), cards('ThQd4h'))).toBeNull();
    omahaTurnRiverTablesClear();
    expect(omahaTurnRiverTablesHeld()).toBe(false);
  });
});
