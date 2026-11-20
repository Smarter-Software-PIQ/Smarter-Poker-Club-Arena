import { describe, expect, it } from 'vitest';
import {
  lightningVpipFloorLimpOnlyInputs,
  vpipFloorLimpOnlyStep,
  type HorseGameStateV2,
} from './HorseLogic.js';
import {
  horsePhase6RefusalShape,
  referenceReturnShape,
  type HorsePhase6Attribution,
} from './HorsePhase6Attribution.js';
import type { HorseDecision, SeatPlayer } from '../types.js';

/*
 * A LIGHTNING POOL'S FLOOR LIMP IS A REFERENCE RETURN (2026-11-19).
 *
 * Production, dfaa9717f826: lightningVpipFloorLimpOnly was switched on at
 * 18:27:30Z and rolled back at 18:55:37Z. In those 28 minutes worker 1 refused
 * 8 DECIDE_FAST decisions as reference_shape (0 before, 0 after, 0 on
 * aec0d93b40cd). The logged shape: Lightning NLH 0.50/1 cash, route
 * chart_open_jam, action call, amount 1 (the big blind), hero 8.92 behind, no
 * preflop raise, six live players. The pool floor turned the chart's fold into
 * the limp inside the reference; the shape check knew only the TABLE floor's
 * call-down, so it refused the Horse's own limp and the engine folded the seat
 * on the liveness fallback. This pins the admission and its bounds.
 */

const seat = (n: number, over: Partial<SeatPlayer> = {}): SeatPlayer => ({
  seat: n,
  user_id: `00000000-0000-4000-8000-00000000000${n}`,
  username: `seat-${n}`,
  stack: 100,
  bet: 0,
  totalInvested: 0,
  cards: [],
  is_folded: false,
  is_all_in: false,
  is_sitting_out: false,
  is_horse: true,
  ...over,
});

type Pool = NonNullable<HorseGameStateV2['lightningVpipFloor']>;

/** The logged spot: hero (seat 4, 8.92 behind) first in after the blinds in a
 * six-handed Lightning NLH 0.50/1 pool, floor 40 percent over a ten-hand window. */
function spot(
  over: {
    pool?: Pool | null;
    raised?: boolean;
    gameMode?: string;
    speed?: string;
  } = {}
) {
  const hero = seat(4, { stack: 8.92 });
  const players = [1, 2, 3, 5, 6].map((n) =>
    seat(n, n === 2 ? { bet: 0.5, stack: 99.5 } : n === 3 ? { bet: 1, stack: 99 } : {})
  );
  const history: Array<Record<string, unknown>> = [
    { seat: 2, stage: 'preflop', action: 'small_blind', amount: 0.5, timestamp: 1 },
    { seat: 3, stage: 'preflop', action: 'big_blind', amount: 1, timestamp: 2 },
  ];
  if (over.raised)
    history.push({
      seat: 3,
      stage: 'preflop',
      action: 'raise',
      amount: 3,
      isFullRaise: true,
      timestamp: 3,
    });
  const pool: Pool | null =
    over.pool === undefined
      ? { floor: 40, windowHands: 10, own: { hands: 9, vpipHands: 2, leavingEntered: false } }
      : over.pool;
  const gs = {
    players: [hero, ...players],
    gameVariant: 'nlh',
    stage: 'preflop',
    gameMode: over.gameMode ?? 'cash',
    currentBet: over.raised ? 3 : 1,
    smallBlind: 0.5,
    bigBlind: 1,
    minRaiseTo: 2,
    maxRaiseTo: 8.92,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    bettingStructure: 'no_limit',
    actionHistory: history,
    publicMemoryDomain: { speed: over.speed ?? 'lightning' },
    ...(pool ? { lightningVpipFloor: pool } : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs, snapshot: { player: hero, gameState: gs } };
}

const receipt = (amount: number | null, route = 'chart_open_jam') =>
  ({
    route,
    referenceProposal: { action: 'call', amount },
  }) as unknown as HorsePhase6Attribution;

describe('the Lightning pool floor limp on chart_open_jam', () => {
  it('reproduces the producer: the pool floor (option on) turns the fold into a call of 1', () => {
    const { hero, gs } = spot();
    const pool = lightningVpipFloorLimpOnlyInputs(gs, { lightningVpipFloorLimpOnly: true }, false)!;
    expect(pool.shortfallHands).toBe(2);
    const limp = vpipFloorLimpOnlyStep(
      { action: 'fold', thinkTime: 0 } as HorseDecision,
      hero,
      gs,
      () => -1,
      'every',
      pool.shortfallHands
    );
    expect(limp.decision).toMatchObject({ action: 'call', amount: 1 });
  });

  it('admits that limp (the 8 production refusals)', () => {
    const { snapshot } = spot();
    expect(referenceReturnShape(receipt(1), snapshot)).toBe(true);
  });

  it('admits the one-hand-early priced limp of a pool exactly at its floor', () => {
    const { snapshot } = spot({
      pool: { floor: 40, windowHands: 10, own: { hands: 9, vpipHands: 4, leavingEntered: true } },
    });
    expect(referenceReturnShape(receipt(1), snapshot)).toBe(true);
  });

  it('refuses every other shape: another amount, a pool over its floor, no pool, a raised pot, a tournament, a table', () => {
    expect(referenceReturnShape(receipt(0.99), spot().snapshot)).toBe(false);
    expect(referenceReturnShape(receipt(null), spot().snapshot)).toBe(false);
    expect(
      referenceReturnShape(
        receipt(1),
        spot({ pool: { floor: 40, windowHands: 10, own: { hands: 9, vpipHands: 5 } } }).snapshot
      )
    ).toBe(false);
    expect(referenceReturnShape(receipt(1), spot({ pool: null }).snapshot)).toBe(false);
    expect(referenceReturnShape(receipt(3), spot({ raised: true }).snapshot)).toBe(false);
    expect(referenceReturnShape(receipt(1), spot({ gameMode: 'tournament' }).snapshot)).toBe(false);
    expect(referenceReturnShape(receipt(1), spot({ speed: 'regular' }).snapshot)).toBe(false);
  });

  it('a refused shape still names its route and amount (diagnostics unchanged)', () => {
    const { snapshot } = spot({ pool: null });
    const shape = horsePhase6RefusalShape(
      {
        action: 'call',
        amount: 1,
        thinkTime: 0,
        tournamentPreflopAttribution: receipt(1),
      } as unknown as HorseDecision,
      snapshot
    );
    expect(shape).toMatchObject({ route: 'chart_open_jam', action: 'call', amount: 1 });
  });
});
