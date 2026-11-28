/**
 * THE BLUFF-RAISE PRICE READS EACH OPPONENT'S FOLDS (2026-11-28, HORSE DECISIONS).
 *
 * v78NoCommittingBluffRaiseIsPriced (dark, default OFF) priced every opponent on the population, so on about
 * 108,000 graded deals it made exactly the blanket rule's choices. These tests pin the per-opponent read it now has:
 *  1. HorseMind counts, per player and postflop street, his first answer when his own bet or raise was raised, from
 *     the public action stream, once per action, for Hold'em hands only, in its own capped map.
 *  2. Counting it changes nothing else: no other counter, no read-frame view, and no decision with the option off.
 *  3. The estimate is shrunk toward people's measured rate and priced at its lower bound, and only from
 *     V78_FOLD_READ_MIN_OPPORTUNITIES answers on; below that the price is exactly the population price.
 *  4. HorseLogic passes the read to the price only with the option on and the mind in use.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HOLDEM_FOLD_TO_RAISE_MAX_ROWS, HorseMind } from './HorseMind.js';
import { seedFastRandom, variantInfo } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  V78_FOLD_READ_EVIDENCE,
  V78_FOLD_READ_LOWER_BOUND_Z,
  V78_FOLD_READ_MIN_OPPORTUNITIES,
  V78_FOLD_READ_PEOPLE_PRIOR,
  V78_FOLD_READ_PRIOR_STRENGTH,
  committingBluffRaiseFoldBound,
  priceCommittingBluffRaise,
  type CommittingBluffRaisePriceInput,
} from './HorseV78CommittingBluffRaisePriced.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const A = '10000000-0000-4000-8000-00000000a001';
const B = '10000000-0000-4000-8000-00000000b002';
const C = '10000000-0000-4000-8000-00000000c003';
const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] => {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]!]! });
  return out;
};

let clock = 1_000;
type Step = [stage: string, userId: string, action: string, amount?: number, isFullRaise?: boolean];
/** A hand's public action stream; every hand gets its own timestamps, so observe() sees it as a new hand. */
function hand(steps: Step[]): ActionRecord[] {
  clock += 1_000;
  return steps.map(
    ([stage, userId, action, amount, isFullRaise], i) =>
      ({
        stage,
        userId,
        seat: userId === A ? 1 : userId === B ? 2 : 3,
        action,
        amount: amount ?? 0,
        timestamp: clock + i,
        ...(isFullRaise === undefined ? {} : { isFullRaise }),
      }) as unknown as ActionRecord
  );
}
const PRE: Step[] = [
  ['preflop', A, 'raise', 3],
  ['preflop', B, 'call', 3],
];
function observeAs(scope: 'holdem:hu' | 'omaha:hu' | null, history: ActionRecord[]): void {
  HorseMind.setDecisionScope(scope, scope === 'omaha:hu' ? 'plo4' : 'nlh');
  try {
    HorseMind.observe(history, [], undefined, undefined, 1, 'no_limit');
  } finally {
    HorseMind.setDecisionScope(null);
  }
}
function readOf(id: string, street: 'flop' | 'turn' | 'river') {
  HorseMind.setDecisionScope('holdem:hu', 'nlh');
  try {
    return HorseMind.holdemFoldToRaiseOf(id, street);
  } finally {
    HorseMind.setDecisionScope(null);
  }
}
/** A bets the turn, B raises, A folds or calls: `n` hands, `folds` of them folds. */
function teachTurn(n: number, folds: number): void {
  for (let i = 0; i < n; i++)
    observeAs(
      'holdem:hu',
      hand([
        ...PRE,
        ['flop', A, 'check'],
        ['flop', B, 'check'],
        ['turn', A, 'bet', 6],
        ['turn', B, 'raise', 20],
        ['turn', A, i < folds ? 'fold' : 'call', i < folds ? 0 : 14],
      ])
    );
}

beforeEach(() => {
  enableBrainTelemetry();
  HorseMind.reset();
  drainFires();
});
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

describe("HorseMind counts each player's answers when his own bet is raised (Hold'em, by street)", () => {
  it('counts a fold, a call and a re-raise as answers, and only the fold as a fold', () => {
    observeAs(
      'holdem:hu',
      hand([...PRE, ['flop', A, 'bet', 4], ['flop', B, 'raise', 12], ['flop', A, 'fold']])
    );
    expect(readOf(A, 'flop')).toEqual({ opportunities: 1, folds: 1 });
    observeAs(
      'holdem:hu',
      hand([...PRE, ['flop', A, 'bet', 4], ['flop', B, 'raise', 12], ['flop', A, 'call', 8]])
    );
    expect(readOf(A, 'flop')).toEqual({ opportunities: 2, folds: 1 });
    // A re-raises: his answer is counted, and B, whose raise was raised, now owes an answer; he folds.
    observeAs(
      'holdem:hu',
      hand([
        ...PRE,
        ['flop', A, 'bet', 4],
        ['flop', B, 'raise', 12],
        ['flop', A, 'raise', 36],
        ['flop', B, 'fold'],
      ])
    );
    expect(readOf(A, 'flop')).toEqual({ opportunities: 3, folds: 1 });
    expect(readOf(B, 'flop')).toEqual({ opportunities: 1, folds: 1 });
    expect(readOf(A, 'turn')).toBeNull();
    expect(readOf(A, 'river')).toBeNull();
  });

  it('keeps streets apart and counts a check-raised bettor', () => {
    observeAs(
      'holdem:hu',
      hand([
        ...PRE,
        ['flop', A, 'check'],
        ['flop', B, 'bet', 4],
        ['flop', A, 'raise', 14],
        ['flop', B, 'call', 10],
        ['turn', A, 'bet', 20],
        ['turn', B, 'raise', 60],
        ['turn', A, 'call', 40],
        ['river', A, 'check'],
        ['river', B, 'bet', 50],
        ['river', A, 'all_in', 120, true],
        ['river', B, 'fold'],
      ])
    );
    expect(readOf(B, 'flop')).toEqual({ opportunities: 1, folds: 0 });
    expect(readOf(A, 'turn')).toEqual({ opportunities: 1, folds: 0 });
    expect(readOf(B, 'river')).toEqual({ opportunities: 1, folds: 1 });
    expect(readOf(A, 'flop')).toBeNull();
    expect(readOf(B, 'turn')).toBeNull();
    expect(readOf(A, 'river')).toBeNull();
  });

  it('does not count a caller, a bettor who was only called, a short all-in over the bet, or a raise left unanswered at the street change', () => {
    observeAs(
      'holdem:hu',
      hand([
        ['preflop', A, 'raise', 3],
        ['preflop', B, 'call', 3],
        ['preflop', C, 'call', 3],
        // B only calls A's bet, C raises: A owes an answer (he folds), B never bet and is not counted.
        ['flop', A, 'bet', 4],
        ['flop', B, 'call', 4],
        ['flop', C, 'raise', 16],
        ['flop', A, 'fold'],
        ['flop', B, 'fold'],
      ])
    );
    expect(readOf(A, 'flop')).toEqual({ opportunities: 1, folds: 1 });
    expect(readOf(B, 'flop')).toBeNull();
    expect(readOf(C, 'flop')).toBeNull();
    HorseMind.reset();
    // A short all-in that is not a full raise is not a raise of A's bet.
    observeAs(
      'holdem:hu',
      hand([
        ...PRE,
        ['flop', A, 'bet', 10],
        ['flop', B, 'all_in', 12, false],
        ['flop', A, 'call', 2],
      ])
    );
    expect(readOf(A, 'flop')).toBeNull();
    // A raise the observation ends on is not answered; the next street starts clean.
    observeAs(
      'holdem:hu',
      hand([...PRE, ['flop', A, 'bet', 4], ['flop', B, 'raise', 12], ['turn', A, 'fold']])
    );
    expect(readOf(A, 'flop')).toBeNull();
    expect(readOf(A, 'turn')).toBeNull();
  });

  it('counts an action once however often the hand is observed again, as decisions observe a growing prefix', () => {
    const h = hand([...PRE, ['flop', A, 'bet', 4], ['flop', B, 'raise', 12], ['flop', A, 'fold']]);
    observeAs('holdem:hu', h.slice(0, 4));
    expect(readOf(A, 'flop')).toBeNull();
    observeAs('holdem:hu', h);
    observeAs('holdem:hu', h);
    observeAs('holdem:hu', h);
    expect(readOf(A, 'flop')).toEqual({ opportunities: 1, folds: 1 });
  });

  it("counts Hold'em hands only and answers only a Hold'em decision", () => {
    const steps: Step[] = [
      ...PRE,
      ['flop', A, 'bet', 4],
      ['flop', B, 'raise', 12],
      ['flop', A, 'fold'],
    ];
    observeAs('omaha:hu', hand(steps));
    observeAs(null, hand(steps));
    expect(HorseMind.holdemFoldToRaiseRowCount()).toBe(0);
    observeAs('holdem:hu', hand(steps));
    expect(HorseMind.holdemFoldToRaiseRowCount()).toBe(1);
    // outside a decision, and in an Omaha decision, the read answers nothing
    expect(HorseMind.holdemFoldToRaiseOf(A, 'flop')).toBeNull();
    HorseMind.setDecisionScope('omaha:hu', 'plo4');
    expect(HorseMind.holdemFoldToRaiseOf(A, 'flop')).toBeNull();
    HorseMind.setDecisionScope(null);
  });

  it('is capped: the least recently updated players go first', () => {
    const N = HOLDEM_FOLD_TO_RAISE_MAX_ROWS + 60;
    for (let i = 0; i < N; i++) {
      const bettor = `p-${i}`;
      observeAs(
        'holdem:hu',
        hand([
          ['preflop', bettor, 'raise', 3],
          ['preflop', B, 'call', 3],
          ['flop', bettor, 'bet', 4],
          ['flop', B, 'raise', 12],
          ['flop', bettor, 'fold'],
        ])
      );
      expect(HorseMind.holdemFoldToRaiseRowCount()).toBeLessThanOrEqual(
        HOLDEM_FOLD_TO_RAISE_MAX_ROWS
      );
    }
    expect(readOf('p-0', 'flop')).toBeNull();
    expect(readOf(`p-${N - 1}`, 'flop')).toEqual({ opportunities: 1, folds: 1 });
  }, 120_000);

  it('lives in its own map: no other counter, no read-frame view and no sandbox shape changes', () => {
    teachTurn(6, 3);
    // the pooled row gained no field: the read is not an OpponentStats counter, so no read frame carries it
    expect(Object.keys(HorseMind.getStats(A)!).filter((k) => /raise/i.test(k))).toEqual([
      'riverTripleCheckRaiseOpps',
      'riverTripleCheckRaiseFolds',
    ]);
    const players = [{ user_id: A }, { user_id: B }] as SeatPlayer[];
    expect('holdemFoldToRaise' in HorseMind.snapshotDecisionReads(players, null)).toBe(false);
    // a sandbox that never learned an answer keeps its shape; one that did carries its own rows, never the live ones
    const idle = HorseMind.createSandbox();
    HorseMind.runInSandbox(idle, () => undefined);
    expect('holdemFoldToRaise' in idle).toBe(false);
    const sb = HorseMind.createSandbox();
    HorseMind.runInSandbox(sb, () => {
      expect(readOf(A, 'turn')).toBeNull();
      teachTurn(2, 2);
      expect(readOf(A, 'turn')).toEqual({ opportunities: 2, folds: 2 });
    });
    expect(sb.holdemFoldToRaise?.get(A)?.turn).toEqual([2, 2]);
    expect(readOf(A, 'turn')).toEqual({ opportunities: 6, folds: 3 });
    const copy = structuredClone(sb);
    HorseMind.runInSandbox(copy, () => teachTurn(1, 0));
    expect(copy.holdemFoldToRaise?.get(A)?.turn).toEqual([3, 2]);
    expect(sb.holdemFoldToRaise?.get(A)?.turn).toEqual([2, 2]);
  });
});

describe('the shrunk estimate and its lower bound', () => {
  it('pins the prior to the measured people rates and their evidence', () => {
    const e = V78_FOLD_READ_EVIDENCE.people;
    expect(V78_FOLD_READ_PEOPLE_PRIOR.flop).toBe(e.flop[0] / e.flop[1]);
    expect(V78_FOLD_READ_PEOPLE_PRIOR.turn).toBe(e.turn[0] / e.turn[1]);
    expect(V78_FOLD_READ_PEOPLE_PRIOR.river).toBe(e.river[0] / e.river[1]);
    expect([e.flop, e.turn, e.river, e.all]).toEqual([
      [78, 198, 39],
      [67, 167, 45],
      [17, 58, 26],
      [162, 423, 57],
    ]);
    expect(V78_FOLD_READ_EVIDENCE.peopleWithoutTheTopPerson.all).toEqual([136, 372]);
    expect(V78_FOLD_READ_PRIOR_STRENGTH).toBe(20);
    expect(V78_FOLD_READ_MIN_OPPORTUNITIES).toBe(10);
    expect(V78_FOLD_READ_LOWER_BOUND_Z).toBe(1.645);
  });

  it('answers nothing below the minimum sample or for a malformed read', () => {
    for (const read of [
      null,
      undefined,
      { folds: 9, opportunities: 9 },
      { folds: 0, opportunities: 0 },
      { folds: 11, opportunities: 10 },
      { folds: -1, opportunities: 20 },
      { folds: Number.NaN, opportunities: 20 },
      { folds: 5, opportunities: Number.POSITIVE_INFINITY },
    ])
      expect(committingBluffRaiseFoldBound('turn', read)).toBeNull();
    expect(committingBluffRaiseFoldBound('turn', { folds: 10, opportunities: 10 })).not.toBeNull();
  });

  it('shrinks toward the prior, sits under its mean, and a few answers cannot swing it', () => {
    for (const street of ['flop', 'turn', 'river'] as const) {
      const prior = V78_FOLD_READ_PEOPLE_PRIOR[street];
      const k = V78_FOLD_READ_PRIOR_STRENGTH;
      // ten folds in ten answers: the mean is (10 + k p) / (10 + k), far from 1, and the bound is lower still
      const ten = committingBluffRaiseFoldBound(street, { folds: 10, opportunities: 10 })!;
      expect(ten.mean).toBeCloseTo((10 + k * prior) / (10 + k), 12);
      expect(ten.lowerBound).toBeLessThan(ten.mean);
      expect(ten.lowerBound).toBeLessThan(0.5);
      // an opponent who folds at people's rate has a bound under people's rate at every sample size
      for (const n of [10, 40, 200, 2000]) {
        const b = committingBluffRaiseFoldBound(street, {
          folds: Math.round(n * prior),
          opportunities: n,
        })!;
        expect(b.lowerBound).toBeLessThan(prior + 0.01);
      }
      // more evidence at the same rate raises the bound toward the rate, never past it
      let last = 0;
      for (const n of [10, 20, 40, 100, 400]) {
        const b = committingBluffRaiseFoldBound(street, { folds: 0.9 * n, opportunities: n })!;
        expect(b.lowerBound).toBeGreaterThan(last);
        expect(b.lowerBound).toBeLessThan(0.9);
        last = b.lowerBound;
      }
    }
  });
});

const basePrice = (
  read: { folds: number; opportunities: number } | null | undefined,
  overrides: Partial<CommittingBluffRaisePriceInput> = {}
): CommittingBluffRaisePriceInput => ({
  street: 'turn',
  legalAction: 'raise',
  legalAmount: 67,
  heroBet: 0,
  heroStack: 84,
  currentBet: 15,
  pot: 34,
  toCall: 15,
  equity: 0.15,
  inPosition: false,
  spr: 2.5,
  board: cards('8c6h9h3d'),
  opponents: [
    {
      stack: 400,
      bet: 15,
      isAllIn: false,
      ...(read === undefined ? {} : { foldToRaiseRead: read }),
    },
  ],
  heroBubbleFactor: 1,
  ...overrides,
});

describe('the price uses the read at its lower bound, behind a minimum sample', () => {
  it('a thin read prices exactly as no read', () => {
    const none = priceCommittingBluffRaise(basePrice(undefined));
    expect(none.veto).toBe(true);
    expect(none.foldPriorSource).toBe('pool_prior');
    expect(none.foldReadOpportunities).toBe(0);
    for (const read of [null, { folds: 9, opportunities: 9 }, { folds: 0, opportunities: 3 }])
      expect(priceCommittingBluffRaise(basePrice(read))).toEqual(none);
  });

  it('a proven folder is raised, a few folds are not, and a caller is never raised', () => {
    const none = priceCommittingBluffRaise(basePrice(undefined));
    // ten folds in ten: the read is used, the fold share barely moves, the veto stands
    const ten = priceCommittingBluffRaise(basePrice({ folds: 10, opportunities: 10 }));
    expect(ten.foldPriorSource).toBe('opponent_sample');
    expect(ten.foldReadOpportunities).toBe(10);
    expect(ten.veto).toBe(true);
    expect(ten.foldProb - none.foldProb).toBeLessThan(0.05);
    // ninety folds in a hundred: the raise is profitable at the lower bound
    const folder = priceCommittingBluffRaise(basePrice({ folds: 90, opportunities: 100 }));
    expect(folder.allow).toBe(true);
    expect(folder.evRaise).toBeGreaterThan(folder.baselineEv);
    // the same mean rate on a tenth of the evidence is not enough: the bound, not the mean, prices
    expect(priceCommittingBluffRaise(basePrice({ folds: 18, opportunities: 20 })).veto).toBe(true);
    // a caller: the fold share falls below the population's and the veto stands at every equity
    for (const equity of [0.02, 0.15, 0.3]) {
      const caller = priceCommittingBluffRaise(
        basePrice({ folds: 2, opportunities: 60 }, { equity })
      );
      expect(caller.veto).toBe(true);
      expect(caller.foldProb).toBeLessThan(
        priceCommittingBluffRaise(basePrice(undefined, { equity })).foldProb
      );
    }
  });

  it('never prices a fold share above the bound itself, on any street or sample', () => {
    for (const street of ['flop', 'turn', 'river'] as const)
      for (const n of [10, 25, 80, 300])
        for (const rate of [0, 0.3, 0.6, 0.9, 1]) {
          const read = { folds: Math.round(n * rate), opportunities: n };
          const bound = committingBluffRaiseFoldBound(street, read)!;
          const r = priceCommittingBluffRaise(
            basePrice(read, { street, board: cards(street === 'flop' ? '8c6h9h' : '8c6h9h3d') })
          );
          expect(r.foldProb).toBeLessThanOrEqual(bound.lowerBound + 1e-12);
          expect(r.foldProb).toBeGreaterThanOrEqual(0);
        }
  });

  it('multiway, only the bettor is read and the other opponents still thin the fold share', () => {
    const read = { folds: 90, opportunities: 100 };
    const hu = priceCommittingBluffRaise(basePrice(read));
    const mw = priceCommittingBluffRaise(
      basePrice(read, {
        opponents: [
          { stack: 400, bet: 15, isAllIn: false, foldToRaiseRead: read },
          {
            stack: 400,
            bet: 0,
            isAllIn: false,
            foldToRaiseRead: { folds: 100, opportunities: 100 },
          },
        ],
      })
    );
    expect(mw.foldProb).toBeLessThan(hu.foldProb);
  });
});

describe('HorseLogic passes the read only with the option on and the mind in use', () => {
  type Gate = (
    raiseTo: number,
    player: SeatPlayer,
    gs: unknown,
    vi: unknown,
    opts: Record<string, unknown>,
    ctx?: unknown
  ) => boolean;
  const L = HorseLogic as unknown as { v78CommitsWithoutJam: Gate };
  const vi = variantInfo('nlh');
  function spot() {
    const players = [
      {
        seat: 1,
        user_id: 'hero',
        username: 'h',
        stack: 84,
        bet: 0,
        totalInvested: 9.5,
        cards: cards('AsTd'),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      },
      {
        seat: 2,
        user_id: A,
        username: 'v',
        stack: 400,
        bet: 15,
        totalInvested: 24.5,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: false,
      },
    ] as unknown as SeatPlayer[];
    const gs = {
      players,
      communityCards: cards('8c6h9h3d'),
      pot: 34,
      currentBet: 15,
      minRaise: 15,
      stage: 'turn',
      gameVariant: 'nlh',
      gameMode: 'cash',
      bigBlind: 1,
      dealerSeat: 2,
      actionHistory: [],
    };
    return { hero: players[0]!, villain: players[1]!, gs };
  }
  function gate(opts: Record<string, unknown>, useMind: boolean) {
    const s = spot();
    drainFires();
    HorseMind.setDecisionScope('holdem:hu', 'nlh');
    try {
      const veto = L.v78CommitsWithoutJam.call(HorseLogic, 67, s.hero, s.gs, vi, opts, {
        street: 'turn',
        pot: 34,
        toCall: 15,
        equity: 0.15,
        inPosition: false,
        spr: 84 / 34,
        board: s.gs.communityCards,
        opponents: [s.villain],
        multiBoard: false,
        useMind,
        tele: true,
      });
      return { veto, fires: drainFires().map((r) => r.feature) };
    } finally {
      HorseMind.setDecisionScope(null);
    }
  }
  const ON = { v78NoCommittingBluffRaiseIsPriced: true };

  it('ON: a stranger and a thin read are vetoed as before; a proven folder is raised; a proven caller is not', () => {
    expect(gate(ON, true).veto).toBe(true);
    teachTurn(V78_FOLD_READ_MIN_OPPORTUNITIES - 1, V78_FOLD_READ_MIN_OPPORTUNITIES - 1);
    expect(gate(ON, true)).toEqual({
      veto: true,
      fires: ['v78_committing_bluff_raise_priced_vetoed'],
    });
    teachTurn(91, 81);
    expect(readOf(A, 'turn')).toEqual({ opportunities: 100, folds: 90 });
    expect(gate(ON, true)).toEqual({
      veto: false,
      fires: ['v78_committing_bluff_raise_priced_allowed'],
    });
    // the same Horse with the mind switched off for the decision prices the population
    expect(gate(ON, false)).toEqual({
      veto: true,
      fires: ['v78_committing_bluff_raise_priced_vetoed'],
    });
    // the folder's flop and river answers are unknown: his turn record does not leak into another street
    expect(readOf(A, 'flop')).toBeNull();
    HorseMind.reset();
    teachTurn(100, 5);
    expect(gate(ON, true)).toEqual({
      veto: true,
      fires: ['v78_committing_bluff_raise_priced_vetoed'],
    });
  });

  it('OFF: the blanket rule answers, whatever the mind holds, and nothing reads the mind', () => {
    const before = [gate({}, true), gate({ v78NoCommittingBluffRaiseIsPriced: false }, true)];
    teachTurn(100, 90);
    const after = [gate({}, true), gate({ v78NoCommittingBluffRaiseIsPriced: false }, true)];
    expect(after).toEqual(before);
    for (const g of after) expect(g).toEqual({ veto: true, fires: [] });
    expect(gate({ v78NoCommittingBluffRaise: false }, true)).toEqual({ veto: false, fires: [] });
  });

  it('OFF: whole decisions are identical with and without the read in memory', () => {
    const s = spot();
    const gs = {
      ...s.gs,
      actionHistory: hand([
        ['preflop', A, 'raise', 3.5],
        ['preflop', 'hero', 'call', 3],
        ['flop', 'hero', 'check'],
        ['flop', A, 'bet', 6],
        ['flop', 'hero', 'call', 6],
        ['turn', 'hero', 'check'],
        ['turn', A, 'bet', 15],
      ]),
    };
    const run = (seed: number, style: string, opts: Record<string, unknown>) => {
      seedFastRandom(seed * 7919 + 13);
      drainFires();
      const d = HorseLogic.decide(s.hero, gs as never, style as never, {}, {
        telemetry: true,
        observeMind: false,
        ...opts,
      } as never) as { action: string; amount?: number };
      return {
        action: d.action,
        amount: d.amount ?? null,
        fires: drainFires().map((r) => r.feature),
      };
    };
    const sweep = (opts: Record<string, unknown>) => {
      const out: unknown[] = [];
      for (const style of ['balanced', 'tag', 'lag', 'tricky', 'grinder'])
        for (let seed = 1; seed <= 25; seed++) out.push(run(seed, style, opts));
      return out;
    };
    // Two minds that watched the same hundred hands; one has its fold-to-raise rows removed. Every other read is
    // the same in both, so any difference could only come from the new read.
    const taught = HorseMind.createSandbox();
    HorseMind.runInSandbox(taught, () => teachTurn(100, 90));
    expect(taught.holdemFoldToRaise?.get(A)?.turn).toEqual([100, 90]);
    const stripped = structuredClone(taught);
    delete stripped.holdemFoldToRaise;
    for (const opts of [{}, { v78NoCommittingBluffRaiseIsPriced: false }]) {
      const withRead = HorseMind.runInSandbox(structuredClone(taught), () => sweep(opts));
      const without = HorseMind.runInSandbox(structuredClone(stripped), () => sweep(opts));
      expect(withRead).toEqual(without);
    }
  }, 300_000);
});
