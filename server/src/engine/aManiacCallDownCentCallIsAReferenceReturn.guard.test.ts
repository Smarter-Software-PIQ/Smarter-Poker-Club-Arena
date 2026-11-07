import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import * as Eval from './HorseEval.js';
import type { OpponentExploitRead } from './HorseOpponentExploit.js';
import type { SeatPlayer } from '../types.js';
import {
  createPhase6Attribution,
  horsePhase6RefusalShape,
  necessaryReferenceRouteGates,
  referenceReturnShape,
} from './HorsePhase6Attribution.js';

/*
 * THE MANIAC CALL-DOWN'S CENT-ROUNDED CALL IS A VARIANT_PRICE RETURN (2026-11-07).
 *
 * Production: 1 of 789,282 eligible decisions was refused as reference_shape,
 * Lightning NLH 0.25/0.50, hand cc8a59bb. On the variant_price route a
 * maniac's raise is priced; when that price folds, the reference's maniac
 * call-down (HorseLogic maniacCallDown) may turn the fold into a call, and it
 * returns `Math.round(call * 100) / 100`. The validator compared the call to
 * the raw `min(currentBet - bet, stack)`. At cent stakes that subtraction is
 * not exact: a 3-bet to 3.45 over hero's 1.15 open owes 2.3000000000000003,
 * the call-down returns 2.30, and the strict equality
 * refused the horse's own legal call. The engine then folded the seat on the
 * liveness fallback. Integer-chip tables never produce an inexact difference,
 * which is why only a cent-stakes Lightning table ever showed it.
 */

const seat = (n: number, over: Partial<SeatPlayer> = {}): SeatPlayer => ({
  seat: n,
  user_id: `00000000-0000-4000-8000-00000000000${n}`,
  username: `seat-${n}`,
  stack: 50,
  bet: 0,
  totalInvested: 0,
  cards: [],
  is_folded: false,
  is_all_in: false,
  is_sitting_out: false,
  is_horse: true,
  ...over,
});

/** Lightning NLH 0.25/0.50 heads-up: hero (button, small blind) opened to
 * 1.15 and the big blind, a maniac, re-raised to 3.45. */
function lightningSpot(heroBet = 1.15, raiseTo = 3.45) {
  const hero = seat(1, {
    bet: heroBet,
    totalInvested: heroBet,
    stack: 50 - heroBet,
    cards: [
      { rank: 'J', suit: 'hearts' },
      { rank: '8', suit: 'hearts' },
    ],
  });
  const raiser = seat(2, { bet: raiseTo, totalInvested: raiseTo, stack: 50 - raiseTo });
  const gs = {
    stateSchemaVersion: 1,
    asset: 'chips',
    chipUnit: 0.01,
    players: [{ ...hero, cards: [] }, raiser],
    dealtSeatIds: [1, 2],
    dealerSeat: 1,
    communityCards: [],
    gameVariant: 'nlh',
    stage: 'preflop',
    gameMode: 'cash',
    format: 'cash',
    currentBet: raiseTo,
    smallBlind: 0.25,
    bigBlind: 0.5,
    minRaise: raiseTo - 0.5,
    pot: heroBet + raiseTo,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    minRaiseTo: raiseTo * 2 - 0.5,
    maxRaiseTo: 50,
    bettingStructure: 'no_limit',
    actionHistory: [
      {
        seat: 1,
        userId: hero.user_id,
        stage: 'preflop',
        action: 'raise',
        amount: heroBet,
        isFullRaise: true,
        timestamp: 1,
      },
      {
        seat: 2,
        userId: raiser.user_id,
        stage: 'preflop',
        action: 'raise',
        amount: raiseTo,
        isFullRaise: true,
        timestamp: 2,
      },
    ],
    rakeConfig: { percent: 5, cap: 1, noFlopNoDrop: true },
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

beforeEach(() => {
  const base = { engaged: null, mean: 0.2, excess: 0, lower: 0, upper: 1 };
  const stats = Object.fromEntries(
    ['vpip', 'pfr', 'rfi', 'threeBet', 'foldTo3Bet', 'betCheckedTo', 'foldToBet', 'riverCall'].map(
      (k) => [k, { ...base, ...(k === 'pfr' ? { engaged: 'high', mean: 1 } : {}) }]
    )
  );
  vi.spyOn(HorseMind, 'opponentRead').mockReturnValue({ stats } as unknown as OpponentExploitRead);
  vi.spyOn(HorseMind, 'bandFor').mockReturnValue([0, 1]);
  vi.spyOn(Eval, 'equitySampleSizeOfLastCall').mockReturnValue(360);
  vi.spyOn(Eval, 'simulateEquity').mockReturnValue(0.9);
});
afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

function produce(heroBet?: number, raiseTo?: number) {
  const { hero, gs } = lightningSpot(heroBet, raiseTo);
  const decision = HorseLogic.__testables.maniacCallDown(
    { action: 'fold', thinkTime: 0 },
    hero,
    gs,
    Eval.variantInfo('nlh'),
    {}
  );
  const attribution = createPhase6Attribution(
    { route: 'variant_price', lookup: null },
    gs,
    false,
    decision
  )!;
  return { hero, gs, decision, attribution, snapshot: { player: hero, gameState: gs } };
}

describe('the maniac call-down cent call on variant_price', () => {
  it('reproduces the live shape: an inexact owed amount, a cent-rounded call', () => {
    const { decision, attribution, snapshot } = produce();
    const raw = 3.45 - 1.15;
    expect(raw).not.toBe(2.3); // the subtraction is not exact at cent stakes
    expect(decision).toMatchObject({ action: 'call', amount: 2.3 });
    expect(attribution.referenceProposal).toEqual({ action: 'call', amount: 2.3 });
    expect(necessaryReferenceRouteGates('variant_price', snapshot)).toBe(true);
  });

  it('admits the producer call that the strict comparison refused', () => {
    const { attribution, snapshot } = produce();
    expect(referenceReturnShape(attribution, snapshot)).toBe(true);
  });

  it('still admits the raw route call and an exact cent difference', () => {
    const { attribution, snapshot } = produce();
    const raw = {
      ...attribution,
      referenceProposal: { action: 'call' as const, amount: 3.45 - 1.15 },
    };
    expect(referenceReturnShape(raw, snapshot)).toBe(true);
    const exact = produce(1.15, 2.65);
    expect(exact.decision).toMatchObject({ action: 'call', amount: 1.5 });
    expect(referenceReturnShape(exact.attribution, exact.snapshot)).toBe(true);
  });

  it('refuses any other call amount, and the rounding on other routes', () => {
    const { attribution, snapshot } = produce();
    for (const amount of [2.29, 2.31, 2.35, null]) {
      const r = { ...attribution, referenceProposal: { action: 'call' as const, amount } };
      expect(referenceReturnShape(r, snapshot)).toBe(false);
    }
    const bbDefend = {
      ...attribution,
      route: 'chart_bb_defend' as const,
      referenceProposal: { action: 'call' as const, amount: 2.3 },
    };
    expect(referenceReturnShape(bbDefend, snapshot)).toBe(false);
  });

  it('records the public refused shape against the expected one', () => {
    const { decision, attribution, snapshot } = produce();
    const shape = horsePhase6RefusalShape(
      { ...decision, tournamentPreflopAttribution: attribution },
      snapshot
    )!;
    expect(shape).toMatchObject({
      route: 'variant_price',
      action: 'call',
      amount: 2.3,
      expectedCall: 3.45 - 1.15,
      expectedCallCents: 2.3,
      currentBet: 3.45,
      heroBet: 1.15,
      heroStack: 48.85,
      bigBlind: 0.5,
      livePlayers: 2,
      liveResponders: 0,
      preflopRaises: 2,
      lastRaiserIsAllIn: false,
      legalRaise: true,
      stage: 'preflop',
      mode: 'cash',
      variant: 'nlh',
      structure: 'no_limit',
    });
    expect(shape.expectedRaiseTo).toBe(Math.round(Math.max(6.4, 3.45 * 2.3) * 100) / 100);
    // Public scalars only: no card, user id or opponent read is carried.
    const json = JSON.stringify(shape);
    expect(json).not.toMatch(/hearts|spades|user|seat-|[0-9a-f]{8}-[0-9a-f]{4}/);
    for (const v of Object.values(shape))
      expect(v === null || ['number', 'string', 'boolean'].includes(typeof v)).toBe(true);
  });
});
