/**
 * READ CALIBRATION (2026-11-07): the two read fixes behind
 * HorseDecideOpts.readPostflopFoldRate and readShrinkResponse, and the
 * walk-forward harness that measured them (benchmark/HorseReadCalibration.ts).
 *
 *  - The legacy exploit's bluff-pricing fold rate counted preflop folds to a
 *    raise. A player who folds every preflop raise and never folds a
 *    postflop bet read as a folder (bluff more) - the opposite of the truth
 *    for the bets the rate prices. With the flag on, the rate is postflop
 *    fold-to-bet from the decision context's exploit counters.
 *  - riverFoldRate / foldToCbetOf trusted 8 and 10 raw opportunities; with
 *    the flag on they shrink toward the family's population rate.
 *
 * Default off: every read is byte-identical to before unless a decision
 * passes the flag.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FOLD_READ_MIN_OPPS,
  HorseMind,
  RESPONSE_READ_PRIOR,
  RESPONSE_READ_PRIOR_STRENGTH,
  readScopeOf,
} from './HorseMind.js';
import { HorseLogic } from './HorseLogic.js';
import type { ActionRecord } from '../types.js';
import {
  controllerActions,
  postflopFacedAggression,
  showdownOf,
  walkForwardReadCalibration,
  type CalibrationEvent,
  type CalibrationHand,
} from '../benchmark/HorseReadCalibration.js';

const SCOPE = readScopeOf('nlh', 2);
let clock = 1_790_000_000_000;

type Line = 'preflopFold' | 'postflopCall' | 'postflopFold';

/** One heads-up hand: hero opens; villain folds preflop, or calls and then
 *  calls or folds a flop bet. */
function hand(n: number, line: Line): ActionRecord[] {
  const t = (clock += 1000);
  const a = (
    seat: number,
    userId: string,
    action: ActionRecord['action'],
    amount: number,
    stage: ActionRecord['stage'],
    extra: Partial<ActionRecord> = {}
  ): ActionRecord => ({ seat, userId, action, amount, stage, timestamp: t + n, ...extra });
  const h: ActionRecord[] = [a(1, 'hero', 'raise', 6, 'preflop', { isFullRaise: true })];
  if (line === 'preflopFold') {
    h.push(a(2, 'villain', 'fold', 0, 'preflop', { origin: 'player' }));
    return h;
  }
  h.push(a(2, 'villain', 'call', 6, 'preflop'));
  h.push(a(1, 'hero', 'bet', 8, 'flop', { isFullRaise: true }));
  h.push(
    line === 'postflopFold'
      ? a(2, 'villain', 'fold', 0, 'flop', { origin: 'player' })
      : a(2, 'villain', 'call', 8, 'flop')
  );
  return h;
}

let handNo = 0;
function play(line: Line, times: number): void {
  for (let i = 0; i < times; i++) {
    const h = hand(handNo++, line);
    const identity = {
      version: 1 as const,
      tableId: '3e272439-6a6e-44a0-be35-3db383c300c3',
      handNumber: 1_000_000 + handNo,
    };
    HorseMind.setDecisionScope(SCOPE);
    HorseMind.observe(h, [], identity, 2);
    HorseMind.setDecisionScope(null);
    HorseMind.observeHandComplete(`t:${handNo}`, h, 2, null, SCOPE);
  }
}

function decide<T>(
  options: { postflopFoldRate?: boolean; shrinkResponseReads?: boolean },
  fn: () => T
): T {
  HorseMind.setDecisionScope(SCOPE, 'nlh', 'cash');
  HorseMind.setDecisionReadOptions(options);
  try {
    return fn();
  } finally {
    HorseMind.setDecisionScope(null);
  }
}

beforeEach(() => {
  HorseMind.reset();
  handNo = 0;
});
afterEach(() => HorseMind.setDecisionScope(null));

describe('readPostflopFoldRate', () => {
  it('reads a preflop folder who never folds a postflop bet as a station, not a folder', () => {
    for (let i = 0; i < 10; i++) {
      play('preflopFold', 4);
      play('postflopCall', 1);
    }
    // All-street rate: 40 folds of 60 faced (40 preflop folds, 10 preflop
    // calls, 10 flop calls) = 0.67 -> "folder".
    const legacy = decide({}, () => HorseMind.foldVsAggressionRate('villain'));
    expect(legacy).toBeGreaterThan(0.62);
    expect(decide({}, () => HorseMind.exploit('villain').bluffMod)).toBeGreaterThan(1.3);
    // Postflop: 0 folds of 10 bets faced.
    const postflop = decide({ postflopFoldRate: true }, () =>
      HorseMind.foldVsAggressionRate('villain')
    );
    expect(postflop).not.toBeNull();
    expect(postflop!).toBeLessThan(0.35);
    expect(
      decide({ postflopFoldRate: true }, () => HorseMind.exploit('villain').bluffMod)
    ).toBeLessThan(1);
  });

  it('keeps the fold-rate exploit neutral below the postflop sample instead of reading preflop folds', () => {
    play('preflopFold', 30);
    play('postflopFold', FOLD_READ_MIN_OPPS - 3);
    expect(decide({}, () => HorseMind.foldVsAggressionRate('villain'))).not.toBeNull();
    expect(
      decide({ postflopFoldRate: true }, () => HorseMind.foldVsAggressionRate('villain'))
    ).toBeNull();
    expect(decide({ postflopFoldRate: true }, () => HorseMind.exploit('villain').bluffMod)).toBe(1);
  });

  it('default off: the rate is the lifetime all-street rate the legacy exploit always read', () => {
    play('preflopFold', 12);
    play('postflopFold', 4);
    play('postflopCall', 8);
    const s = HorseMind.getStats('villain')!;
    expect(decide({}, () => HorseMind.foldVsAggressionRate('villain', false))).toBe(
      s.folds / s.facedAggr
    );
    // Outside a decision the options do not exist.
    HorseMind.setDecisionReadOptions({ postflopFoldRate: true });
    expect(HorseMind.currentDecisionReadOptions()).toEqual({});
  });
});

describe('readShrinkResponse', () => {
  it('shrinks the river fold rate toward the family prior above the unchanged gate', () => {
    HorseMind.importStats([{ user_id: 'villain', hands: 60, riverBetOpps: 10, riverBetFolds: 10 }]);
    const raw = decide({}, () => HorseMind.riverFoldRate('villain'));
    expect(raw).toBe(1);
    const m = RESPONSE_READ_PRIOR_STRENGTH;
    const prior = RESPONSE_READ_PRIOR.riverFold.holdem;
    expect(
      decide({ shrinkResponseReads: true }, () => HorseMind.riverFoldRate('villain'))
    ).toBeCloseTo((10 + m * prior) / (10 + m), 12);
    HorseMind.importStats([{ user_id: 'thin', hands: 60, riverBetOpps: 7, riverBetFolds: 7 }]);
    expect(decide({ shrinkResponseReads: true }, () => HorseMind.riverFoldRate('thin'))).toBeNull();
  });

  it('shrinks fold to c-bet the same way and leaves it raw when off', () => {
    HorseMind.importStats([{ user_id: 'villain', hands: 60, cbetOpps: 12, cbetFolds: 0 }]);
    expect(decide({}, () => HorseMind.foldToCbetOf('villain'))).toBe(0);
    const v = decide({ shrinkResponseReads: true }, () => HorseMind.foldToCbetOf('villain'))!;
    expect(v).toBeCloseTo(
      (RESPONSE_READ_PRIOR_STRENGTH * 0.46) / (12 + RESPONSE_READ_PRIOR_STRENGTH),
      12
    );
  });
});

describe('HorseDecideOpts wiring', () => {
  it('prepareOriginalReads carries both flags into the decision and they clear with the scope', () => {
    const players = [
      {
        seat: 1,
        user_id: 'hero',
        stack: 100,
        bet: 0,
        is_folded: false,
        is_sitting_out: false,
        cards: [],
      },
      {
        seat: 2,
        user_id: 'villain',
        stack: 100,
        bet: 0,
        is_folded: false,
        is_sitting_out: false,
        cards: [],
      },
    ];
    const gameState = { gameVariant: 'nlh', players, actionHistory: [] } as never;
    HorseLogic.prepareOriginalReads(players[0] as never, gameState, {
      readPostflopFoldRate: true,
      readShrinkResponse: true,
      mind: false,
    });
    HorseMind.setDecisionScope(null);
    HorseLogic.prepareOriginalReads(players[0] as never, gameState, {
      readBreakEvenBluff: true,
      readScopedShrink: true,
      omahaEvFoldModel: true,
      omahaNeutralUnknown: true,
      mind: false,
    });
    expect(HorseMind.currentDecisionReadOptions()).toEqual({
      postflopFoldRate: false,
      shrinkResponseReads: false,
      breakEvenBluff: true,
      scopedShrink: true,
      omahaEvFoldModel: true,
      omahaNeutralUnknown: true,
    });
    HorseMind.setDecisionScope(null);
    HorseLogic.prepareOriginalReads(players[0] as never, gameState, {
      readPostflopFoldRate: true,
      readShrinkResponse: true,
      omahaEvFoldModel: false,
      mind: false,
    });
    expect(HorseMind.currentDecisionReadOptions()).toEqual({
      postflopFoldRate: true,
      shrinkResponseReads: true,
      breakEvenBluff: false,
      scopedShrink: false,
      omahaEvFoldModel: false,
      omahaNeutralUnknown: false,
    });
    HorseMind.setDecisionScope(null);
    expect(HorseMind.currentDecisionReadOptions()).toEqual({});
    HorseLogic.prepareOriginalReads(players[0] as never, gameState, { mind: false });
    // omahaEvFoldModel is default ON (2026-11-08); the others default off,
    // omahaNeutralUnknown included (2026-11-13).
    expect(HorseMind.currentDecisionReadOptions()).toEqual({
      postflopFoldRate: false,
      shrinkResponseReads: false,
      breakEvenBluff: false,
      scopedShrink: false,
      omahaEvFoldModel: true,
      omahaNeutralUnknown: false,
    });
  });
});

describe('walk-forward read calibration harness', () => {
  const row = (id: string, n: number, line: Line): CalibrationHand => ({
    id,
    table_id: '3e272439-6a6e-44a0-be35-3db383c300c3',
    hand_number: 1_000_000 + n,
    created_at: new Date(1_790_000_000_000 + n * 60_000).toISOString(),
    game_variant: 'nlh',
    big_blind: 2,
    players: [
      { seat: 1, userId: 'hero' },
      { seat: 2, userId: 'villain' },
    ],
    actions: hand(n, line) as unknown as Array<Record<string, unknown>>,
  });

  it('predicts from earlier hands only and scores the hand the engine then observes', () => {
    const hands = [
      ...Array.from({ length: 12 }, (_, i) => row(`p${i}`, i + 1, 'postflopFold')),
      row('last', 13, 'postflopCall'),
    ];
    const events: CalibrationEvent[] = [];
    HorseMind.runInSandbox(HorseMind.createSandbox(), () =>
      walkForwardReadCalibration(
        hands,
        (id) => id === 'villain',
        (e) => events.push(e)
      )
    );
    const pf = events.filter((e) => e.read === 'legacy:foldVsAggrPostflop');
    expect(pf).toHaveLength(13);
    // First sight: no read, no hands.
    expect(pf[0].pred).toBeNull();
    expect(pf[0].hands).toBe(0);
    // The last hand is predicted from twelve earlier hands and scored as a
    // call. The all-street rate reads 0.5 (twelve preflop calls of a raise
    // plus twelve flop folds) for a player who folded every postflop bet.
    const last = pf[pf.length - 1];
    expect(last.handId).toBe('last');
    expect(last.pred).toBe(0.5);
    expect([last.y, last.m]).toEqual([0, 1]);
    const cal = events.filter((e) => e.read === 'calibrated:foldVsAggrPostflop').at(-1)!;
    expect(cal.pred).toBeGreaterThan(0.6);
    expect(cal.pred).toBeLessThan(1);
    // The live process memory was never touched.
    expect(HorseMind.getStats('villain')).toBeUndefined();
  });

  it('projects controller actions and counts postflop faced aggression like observe()', () => {
    const acts = controllerActions([
      { action: 'sb', userId: 'a', stage: 'preflop', origin: 'forced', amount: 1 },
      { action: 'return', userId: 'a', stage: 'preflop', amount: 1 },
      ...(hand(1, 'postflopFold') as unknown as Array<Record<string, unknown>>),
    ]);
    expect(acts.map((a) => a.action)).toEqual(['raise', 'call', 'bet', 'fold']);
    expect(postflopFacedAggression(acts, 'villain')).toEqual({ y: 1, m: 1 });
    expect(postflopFacedAggression(acts, 'hero')).toEqual({ y: 0, m: 0 });
  });

  it('names shown hands by category and reports an unshown live player as mucked', () => {
    const c = (rank: string, suit: string) => ({ rank, suit }) as never;
    const h: CalibrationHand = {
      ...row('sd', 1, 'postflopCall'),
      community_cards: [
        c('A', 'hearts'),
        c('A', 'spades'),
        c('7', 'clubs'),
        c('8', 'diamonds'),
        c('2', 'clubs'),
      ],
      hole_cards: { hero: [c('K', 'hearts'), c('K', 'spades')] },
    };
    expect(showdownOf(h)).toEqual([
      { user_id: 'hero', mucked: false, hand_name: 'two pair' },
      { user_id: 'villain', mucked: true },
    ]);
  });
});
