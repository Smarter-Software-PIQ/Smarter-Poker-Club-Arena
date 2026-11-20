/**
 * LAW: HOLD'EM COMMITTED NO-PAIR JAMS AND FOUR-CARD DANGER-BOARD EQUITY ARE PRICED
 * (options holdemCommittedNoPairIsPriced and holdemDangerBoardEquityIsPriced, both default OFF).
 *
 * Registry: docs/laws.d/server-src-engine-HoldemCommittedAndDangerBoardArePriced.md
 *
 * Replaces the unmeasured blanket drafts in Antigravity commits 633eec005d5 and 6496e1610f0:
 *   1. holdemCommittedNoPairIsPriced: in heads-up no-limit hold'em cash, when the committed branch faces a bet
 *      with no pair and no real hole draw, fold / call / all-in jam is chosen by closed-form EV against the
 *      bettor's range calibrated to eq15 and people's measured fold rate to Horse postflop raises by price
 *      (HOLDEM_RAISE_FOLD_SHARE_BY_PRICE: <0.20 0/5, 0.20-0.30 24/55, >=0.30 28/64; 30-day NLH cash).
 *   2. holdemDangerBoardEquityIsPriced: in heads-up no-limit hold'em cash on a four-flush or four-straight
 *      turn or river, one pair facing a bet prices eq15 as exact per-combo equity against the bettor's measured
 *      showdown class distribution on such boards (HOLDEM_DANGER_BOARD_BETTOR_SHOWN: 3 / 5 / 42 of 50).
 *
 * Every assertion below fails if either option's wiring in HorseLogic.ts is removed, while unset, false and
 * non-boolean values are byte-identical with zero receipts and leave fastRandom untouched.
 */
import { describe, expect, it } from 'vitest';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from './HorseEval.js';
import {
  HOLDEM_DANGER_BOARD_BETTOR_SHOWN,
  HOLDEM_RAISE_FOLD_SHARE_BY_PRICE,
  boardHasFourFlush,
  boardHasFourStraight,
  holdemCalledRangeEquity,
  holdemComboRows,
  holdemCommittedNoPairDecision,
  holdemCommittedNoPairPrice,
  holdemDangerBoardBettorEquity,
  holdemRaiseFoldShare,
} from './HorseHoldemCommittedPricing.js';
import type { Card } from '../types.js';

const SUIT = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const;
const cards = (text: string): Card[] =>
  (text.match(/.{2}/g) ?? []).map((t) => ({
    rank: t[0] as Card['rank'],
    suit: SUIT[t[1] as keyof typeof SUIT],
  }));

/** The 20 options switched ON in production on 2026-11-20 that govern no-limit hold'em cash. */
const LIVE: Record<string, boolean> = Object.fromEntries(
  [
    'holdemCallDownExcludesCurrentHand',
    'holdemCallDownNeedsStyleEvidence',
    'holdemGearShiftReach',
    'holdemManiacSampleGate',
    'holdemManiacShortHandedReach',
    'holdemPersonaPostflop',
    'holdemProfileCompletenessCap',
    'holdemRiverFullHouseValue',
    'horseActionTimeIsPublicOnly',
    'styleBigBetHonesty',
    'styleFoldBluff',
    'styleFoldRatePreRepair',
    'styleLongShownMemory',
    'styleRaiseRespect',
    'styleTightMultiSignal',
    'styleTightPlayerExploit',
    'styleTightReRaiserRespect',
    'styleValueBettorNotManiac',
    'styleValueExtraction',
    'vpipFloorLimpOnly',
  ].map((o) => [o, true])
);

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const PROFILE = replayProfiles('cash')[0];

/** Cash 1/2 heads-up single-raised pot: button (seat 3) raises to 6, Horse in BB (seat 2) calls; checks to
 * `street` and faces `bet` with `heroStack` behind. */
function facingSingleRaised(
  hole: string,
  board: string,
  street: 'flop' | 'turn' | 'river',
  bet: number,
  heroStack: number,
  oppStack: number,
  oppAllIn = false
): ReturnType<typeof stateAt> {
  const actions: ComplaintAction[] = [
    { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
    { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
    { ord: 3, seat: 3, stage: 'preflop', action: 'raise', amount: 6, isFullRaise: true },
    { ord: 4, seat: 1, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 5, seat: 2, stage: 'preflop', action: 'call', amount: 4 },
  ];
  let ord = 6;
  for (const st of ['flop', 'turn', 'river'] as const) {
    if (st === street) break;
    actions.push({ ord: ord++, seat: 2, stage: st, action: 'check', amount: 0 });
    actions.push({ ord: ord++, seat: 3, stage: st, action: 'check', amount: 0 });
  }
  actions.push({ ord: ord++, seat: 2, stage: street, action: 'check', amount: 0 });
  actions.push({
    ord: ord++,
    seat: 3,
    stage: street,
    action: oppAllIn ? 'all_in' : 'bet',
    amount: bet,
    isFullRaise: true,
  });
  const node: ComplaintAction = {
    ord: ord++,
    seat: 2,
    stage: street,
    action: 'fold',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot: 13 + bet,
      ante: 0,
      anteType: 'none',
      mode: 'cash',
      seats: [
        [1, 199, 0, 1, 0, 0, 1],
        [2, heroStack, 0, 6, 0, 0, 0],
        [3, oppAllIn ? 0 : oppStack, bet, 6 + bet, oppAllIn ? 1 : 0, 0, 0],
      ],
      boards: [board],
      street,
      toCall: bet,
      currentBet: bet,
      minRaiseTo: bet * 2,
      maxRaiseTo: heroStack,
      legalActions: heroStack <= bet ? ['fold', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 2,
      smallBlind: 1,
      variant: 'nlh',
      structure: 'no_limit',
      actorSeat: 2,
      bombPot: false,
      allInOrFold: false,
      tournamentStage: null,
    },
  };
  const hand = {
    handId: 'nlh-committed-srp',
    variant: 'nlh',
    bigBlind: 2,
    smallBlind: 1,
    buttonSeat: 3,
    players: [1, 2, 3].map((seat) => ({ seat, userId: `p${seat}`, isHorse: seat !== 3 })),
    horseHoleCards: { p2: cards(hole) },
    actions: [...actions, node],
  } as unknown as ExtractedHand;
  return stateAt(hand, node);
}

/** Cash 1/2 heads-up 4-bet pot: BTN opens 6, BB (Horse) 3-bets 22, BTN 4-bets 52, BB calls 30 (pot 105),
 * checks to `street` and faces `bet` with `heroStack` behind (>30% of stack already invested). */
function facingFourBetPot(
  hole: string,
  board: string,
  street: 'flop' | 'turn' | 'river',
  bet: number,
  heroStack: number,
  oppStack: number
): ReturnType<typeof stateAt> {
  const actions: ComplaintAction[] = [
    { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
    { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
    { ord: 3, seat: 3, stage: 'preflop', action: 'raise', amount: 6, isFullRaise: true },
    { ord: 4, seat: 1, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 5, seat: 2, stage: 'preflop', action: 'raise', amount: 22, isFullRaise: true },
    { ord: 6, seat: 3, stage: 'preflop', action: 'raise', amount: 52, isFullRaise: true },
    { ord: 7, seat: 2, stage: 'preflop', action: 'call', amount: 30 },
  ];
  let ord = 8;
  for (const st of ['flop', 'turn', 'river'] as const) {
    if (st === street) break;
    actions.push({ ord: ord++, seat: 2, stage: st, action: 'check', amount: 0 });
    actions.push({ ord: ord++, seat: 3, stage: st, action: 'check', amount: 0 });
  }
  actions.push({ ord: ord++, seat: 2, stage: street, action: 'check', amount: 0 });
  actions.push({
    ord: ord++,
    seat: 3,
    stage: street,
    action: 'bet',
    amount: bet,
    isFullRaise: true,
  });
  const node: ComplaintAction = {
    ord: ord++,
    seat: 2,
    stage: street,
    action: 'fold',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot: 105 + bet,
      ante: 0,
      anteType: 'none',
      mode: 'cash',
      seats: [
        [1, 199, 0, 1, 0, 0, 1],
        [2, heroStack, 0, 52, 0, 0, 0],
        [3, oppStack, bet, 52 + bet, 0, 0, 0],
      ],
      boards: [board],
      street,
      toCall: bet,
      currentBet: bet,
      minRaiseTo: bet * 2,
      maxRaiseTo: heroStack,
      legalActions: heroStack <= bet ? ['fold', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 2,
      smallBlind: 1,
      variant: 'nlh',
      structure: 'no_limit',
      actorSeat: 2,
      bombPot: false,
      allInOrFold: false,
      tournamentStage: null,
    },
  };
  const hand = {
    handId: 'nlh-committed-4bp',
    variant: 'nlh',
    bigBlind: 2,
    smallBlind: 1,
    buttonSeat: 3,
    players: [1, 2, 3].map((seat) => ({ seat, userId: `p${seat}`, isHorse: seat !== 3 })),
    horseHoleCards: { p2: cards(hole) },
    actions: [...actions, node],
  } as unknown as ExtractedHand;
  return stateAt(hand, node);
}

const run = (st: ReturnType<typeof stateAt>, opts: Record<string, unknown>) =>
  replayAt(st, PROFILE, SEEDS, opts);
const sum = (o: Record<string, number>, keys: string[]) =>
  keys.reduce((n, k) => n + (o[k] ?? 0), 0);

const NO_PAIR_RECEIPTS = [
  'holdem_committed_no_pair_jam_priced',
  'holdem_committed_no_pair_call_priced',
  'holdem_committed_no_pair_fold_priced',
];

describe('LAW: measured empirical constants are cited and exact', () => {
  it('cites the 30-day NLH cash person raise-fold counts and Laplace posterior means', () => {
    expect(HOLDEM_RAISE_FOLD_SHARE_BY_PRICE.map((c) => [c.below, c.folds, c.answers])).toEqual([
      [0.2, 0, 5],
      [0.3, 24, 55],
      [Infinity, 28, 64],
    ]);
    expect(holdemRaiseFoldShare(0.16)).toBeCloseTo(1 / 7, 12);
    expect(holdemRaiseFoldShare(0.25)).toBeCloseTo(25 / 57, 12);
    expect(holdemRaiseFoldShare(0.45)).toBeCloseTo(29 / 66, 12);
  });

  it('cites the 30-day NLH cash 4-flush / 4-straight person bettor showdown counts (3 / 5 / 42 of 50)', () => {
    const d = HOLDEM_DANGER_BOARD_BETTOR_SHOWN;
    expect([d.noPair, d.onePair, d.twoPairPlus]).toEqual([3, 5, 42]);
    expect(d.noPair + d.onePair + d.twoPairPlus).toBe(50);
    expect(d.shares.noPair).toBeCloseTo(4 / 53, 12);
    expect(d.shares.onePair).toBeCloseTo(6 / 53, 12);
    expect(d.shares.twoPairPlus).toBeCloseTo(43 / 53, 12);
    expect(d.shares.noPair + d.shares.onePair + d.shares.twoPairPlus).toBeCloseTo(1, 12);
  });
});

describe('LAW: closed-form pricing & deterministic combo enumeration touch zero fastRandom draws', () => {
  it('evaluates fold, call and jam EVs exactly and refuses invalid numbers', () => {
    const callWin = holdemCommittedNoPairPrice({
      pot: 100,
      toCall: 20,
      jamTotal: 20,
      equity: 0.3,
      equityCalled: 0.2,
      foldShare: 0.4,
      rake: 0,
    })!;
    expect(callWin.evCall).toBeCloseTo(0.3 * 120 - 20, 12);
    expect(callWin.evJam).toBeNull();
    expect(callWin.action).toBe('call');

    const foldWin = holdemCommittedNoPairPrice({
      pot: 40,
      toCall: 40,
      jamTotal: 120,
      equity: 0.25,
      equityCalled: 0.1,
      foldShare: 0.3,
      rake: 0.05,
    })!;
    expect(foldWin.evCall).toBeLessThan(0);
    expect(foldWin.evJam!).toBeLessThan(0);
    expect(foldWin.action).toBe('fold');

    const jamWin = holdemCommittedNoPairPrice({
      pot: 100,
      toCall: 30,
      jamTotal: 60,
      equity: 0.2,
      equityCalled: 0.15,
      foldShare: 0.6,
      rake: 0,
    })!;
    expect(jamWin.evJam!).toBeCloseTo(0.6 * 100 + 0.4 * (0.15 * (100 + 120 - 30) - 60), 12);
    expect(jamWin.action).toBe('all_in');

    expect(
      holdemCommittedNoPairPrice({
        pot: 0,
        toCall: 1,
        jamTotal: 1,
        equity: 0.5,
        equityCalled: 0.5,
        foldShare: 0,
        rake: 0,
      })
    ).toBeNull();
    expect(
      holdemCommittedNoPairPrice({
        pot: 1,
        toCall: 1,
        jamTotal: 1,
        equity: NaN,
        equityCalled: 0.5,
        foldShare: 0,
        rake: 0,
      })
    ).toBeNull();
  });

  it('calibrates the continuing range and computes danger-board equity deterministically without advancing fastRandom', () => {
    seedFastRandom(9001);
    const rngBefore = saveFastRandom();

    const rows = holdemComboRows(cards('AdKc'), cards('7h8s2d'), []);
    expect(rows.length).toBe(1081);
    for (const e of [0.2, 0.35, 0.5]) {
      const c = holdemCalledRangeEquity(rows, e, 0.44)!;
      expect(c.equityCalled).toBeLessThanOrEqual(e + 1e-9);
      expect(c.rangeShare).toBeGreaterThan(0);
      expect(c.rangeShare).toBeLessThanOrEqual(1);
    }
    const dec = holdemCommittedNoPairDecision({
      hole: cards('Ad9c'),
      board: cards('Ks7h2d4c'),
      dead: [],
      pot: 38,
      toCall: 25,
      jamTotal: 35,
      equity: 0.38,
      rake: 0.05,
    });
    expect(dec).not.toBeNull();

    const eqDanger = holdemDangerBoardBettorEquity(cards('KdQc'), cards('Ks9s5s2h3s'), [])!;
    expect(eqDanger).toBeGreaterThan(0);
    expect(eqDanger).toBeLessThan(0.3);

    expect(boardHasFourFlush(cards('Ks9s5s2h3s'))).toBe(true);
    expect(boardHasFourFlush(cards('Ks9s5d2h3s'))).toBe(false);
    expect(boardHasFourStraight(cards('KdQs7sTd8s'))).toBe(false);
    expect(boardHasFourStraight(cards('Kd7s9sTd8c'))).toBe(true);
    expect(boardHasFourStraight(cards('Ad2c3h4sKd'))).toBe(true);

    expect(saveFastRandom()).toBe(rngBefore);
    restoreFastRandom(rngBefore);
  });
});

describe('LAW: holdemCommittedNoPairIsPriced — fixed-input before/after replay (fails if wiring removed)', () => {
  // Turn SRP committed spot: Ad9c on Ks7h2d4c facing 25 into 13 (35 behind, SPR < 1.2).
  // Before (LIVE OFF): unpriced 0.42 committed floor jams 12/40 seeds and folds 28/40 (0 calls).
  // After  (ON):       jamming 10 more into 63 lays price 10/73 = 0.137 (measured foldShare 1/7),
  //                    so EV(jam) < EV(call) on every seed -> 0 jams, 28 priced calls, 12 priced folds!
  const turnCommitted = facingSingleRaised('Ad9c', 'Ks7h2d4c', 'turn', 25, 35, 300);

  // Turn 4-bet pot committed spot: AdKc on Jc8h4s2d facing 50 into 105 (90 behind, 52 already invested).
  // Before (LIVE OFF): jams 40/40 seeds under the 0.42 committed floor.
  // After  (ON):       prices EV(call) above EV(jam) on 36/40 seeds -> flips 36/40 jams to calls!
  const fourBetTurn = facingFourBetPot('AdKc', 'Jc8h4s2d', 'turn', 50, 90, 200);

  it('off, false and truthy non-boolean are byte-identical with zero receipts', () => {
    for (const st of [turnCommitted, fourBetTurn]) {
      const base = run(st, LIVE);
      expect(run(st, { ...LIVE, holdemCommittedNoPairIsPriced: false })).toEqual(base);
      expect(run(st, { ...LIVE, holdemCommittedNoPairIsPriced: 'on' })).toEqual(base);
      expect(sum(base.receipts, NO_PAIR_RECEIPTS)).toBe(0);
    }
  });

  it('replaces unpriced committed Ace-high jams with EV-priced calls and folds (red off, green on)', () => {
    const offTurn = run(turnCommitted, LIVE);
    const onTurn = run(turnCommitted, { ...LIVE, holdemCommittedNoPairIsPriced: true });

    // Without the change, the committed branch jams 12/40 seeds with bare A9 high on Ks7h2d4c
    expect(offTurn.kinds.jam ?? 0).toBe(12);
    expect(offTurn.kinds.call ?? 0).toBe(0);
    // With holdemCommittedNoPairIsPriced on, EV(jam) loses to EV(call)/fold on all 40 seeds (0 jams)
    expect(onTurn.kinds.jam ?? 0).toBe(0);
    expect(onTurn.kinds).toEqual({ call: 28, fold: 12 });
    expect(onTurn.receipts.holdem_committed_no_pair_call_priced).toBe(28);
    expect(onTurn.receipts.holdem_committed_no_pair_fold_priced).toBe(12);
    expect(sum(onTurn.receipts, NO_PAIR_RECEIPTS)).toBe(SEEDS.length);

    const off4bp = run(fourBetTurn, LIVE);
    const on4bp = run(fourBetTurn, { ...LIVE, holdemCommittedNoPairIsPriced: true });
    expect(off4bp.kinds).toEqual({ jam: 40 });
    expect(on4bp.kinds).toEqual({ call: 36, jam: 4 });
    expect(sum(on4bp.receipts, NO_PAIR_RECEIPTS)).toBe(SEEDS.length);
  });

  it('leaves pairs, draws, deep uncommitted stacks, tournaments and Lightning untouched', () => {
    const madePair = facingSingleRaised('AdKc', '7h8sKd', 'flop', 25, 40, 300);
    const flushDraw = facingSingleRaised('AdKd', '7d8d2c', 'flop', 25, 40, 300);
    const deepUncommitted = facingSingleRaised('Ad9c', 'Ks7h2d4c', 'turn', 10, 400, 400);
    for (const s of [madePair, flushDraw, deepUncommitted]) {
      expect(run(s, { ...LIVE, holdemCommittedNoPairIsPriced: true })).toEqual(run(s, LIVE));
    }

    const tourney = {
      ...turnCommitted,
      gs: { ...turnCommitted.gs, gameMode: 'tournament' } as typeof turnCommitted.gs,
    };
    expect(run(tourney, { ...LIVE, holdemCommittedNoPairIsPriced: true })).toEqual(
      run(tourney, LIVE)
    );

    const lightning = {
      ...turnCommitted,
      gs: {
        ...turnCommitted.gs,
        publicMemoryDomain: { speed: 'lightning' },
      } as unknown as typeof turnCommitted.gs,
    };
    expect(run(lightning, { ...LIVE, holdemCommittedNoPairIsPriced: true })).toEqual(
      run(lightning, LIVE)
    );
  });
});

describe('LAW: holdemDangerBoardEquityIsPriced — fixed-input before/after replay (fails if wiring removed)', () => {
  // Four-flush turn: KdQc (top pair, no spade) on Ks9s5s2s facing 10 into 13.
  // Before (LIVE OFF): calls 40/40 seeds under generic range read.
  // After  (ON):       eqDanger against 3/5/42 shown bettor classes drops below pot odds -> folds 40/40!
  const fourFlushTurn = facingSingleRaised('KdQc', 'Ks9s5s2s', 'turn', 10, 150, 150);

  // Four-straight river: AdAc (bare overpair, no J or 6) on 7s8h9dTc2h facing 10 into 13.
  // Before (LIVE OFF): calls 40/40 seeds.
  // After  (ON):       eqDanger against 3/5/42 shown bettor classes drops below pot odds -> folds 40/40!
  const fourStraightRiver = facingSingleRaised('AdAc', '7s8h9dTc2h', 'river', 10, 150, 150);

  it('off, false and truthy non-boolean are byte-identical with zero receipts', () => {
    for (const st of [fourFlushTurn, fourStraightRiver]) {
      const base = run(st, LIVE);
      expect(run(st, { ...LIVE, holdemDangerBoardEquityIsPriced: false })).toEqual(base);
      expect(run(st, { ...LIVE, holdemDangerBoardEquityIsPriced: 1 })).toEqual(base);
      expect(base.receipts.holdem_danger_board_equity_priced ?? 0).toBe(0);
    }
  });

  it('flips unpriced one-pair calls on four-flush and four-straight boards to priced folds (red off, green on)', () => {
    const offFlush = run(fourFlushTurn, LIVE);
    const onFlush = run(fourFlushTurn, { ...LIVE, holdemDangerBoardEquityIsPriced: true });
    expect(offFlush.kinds).toEqual({ call: 40 });
    expect(onFlush.kinds).toEqual({ fold: 40 });
    expect(onFlush.receipts.holdem_danger_board_equity_priced).toBe(SEEDS.length);

    const offStraight = run(fourStraightRiver, LIVE);
    const onStraight = run(fourStraightRiver, { ...LIVE, holdemDangerBoardEquityIsPriced: true });
    expect(offStraight.kinds).toEqual({ call: 40 });
    expect(onStraight.kinds).toEqual({ fold: 40 });
    expect(onStraight.receipts.holdem_danger_board_equity_priced).toBe(SEEDS.length);
  });

  it('leaves non-danger boards, two-pair+ hands, tournaments and Lightning untouched', () => {
    // Witness #59783807 shape: 3 spades and 3 to a straight, neither 4-flush nor 4-straight -> untouched
    const threeSuitBoard = facingSingleRaised('KdQc', 'Ks9s5d2h3s', 'river', 10, 150, 150);
    const twoPair = facingSingleRaised('Kd9c', 'Ks9s5s2s', 'turn', 10, 150, 150);
    for (const s of [threeSuitBoard, twoPair]) {
      expect(run(s, { ...LIVE, holdemDangerBoardEquityIsPriced: true })).toEqual(run(s, LIVE));
    }

    const tourney = {
      ...fourFlushTurn,
      gs: { ...fourFlushTurn.gs, gameMode: 'tournament' } as typeof fourFlushTurn.gs,
    };
    expect(run(tourney, { ...LIVE, holdemDangerBoardEquityIsPriced: true })).toEqual(
      run(tourney, LIVE)
    );

    const lightning = {
      ...fourFlushTurn,
      gs: {
        ...fourFlushTurn.gs,
        publicMemoryDomain: { speed: 'lightning' },
      } as unknown as typeof fourFlushTurn.gs,
    };
    expect(run(lightning, { ...LIVE, holdemDangerBoardEquityIsPriced: true })).toEqual(
      run(lightning, LIVE)
    );
  });
});
