/**
 * Worker-start warm-up of the PLO math core (2026-11-21, PLO-OWNER lead-2 order, lane CORE-POOLED-3).
 *
 * WHY. The first core computation of a process is cold (JIT, table reads): measured 55-108 ms against ~14 ms warm
 * on PLO5 flop. The shadow stage's latency breaker (HorseOptionShadowStage.ts: three re-decisions over 50 ms in the
 * last 20, or one over 150 ms) counted the cold start as two of its three strikes in a measured run, so a worker
 * could switch off the staged core flag for reasons that are not the core's cost.
 *
 * WHAT. One throwaway core computation on a fixed, constructed public PLO5 cash flop spot (no player, no table, no
 * hole card of anyone: the cards are written here), run by the worker as a boot step BEFORE it reports READY, so no
 * request can be waiting for it and no decision is delayed. Its result is discarded: it is never a decision, never
 * journaled, never counted. Afterwards every cache the core fills (tracked ranges, size mix, reference pools, the
 * 2+3 memo) is cleared, so the first real decision finds the core's state exactly as a cold worker would (only the
 * compiled code and the pure lookup tables stay warm). It reads no switch and turns nothing on: a worker with every
 * core option off pays one computation at boot and nothing else. Any failure is swallowed (a warm-up must never
 * stop a worker).
 */
import type { SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';
import { decideOmahaMathCore } from './OmahaMathCore.js';
import { resetOmahaBestMemo } from './OmahaMathCoreEval.js';
import { clearPlaybookBlockerCache } from './OmahaMathCorePlaybookBlockers.js';
import { omahaMathCoreState } from './OmahaMathCoreRule.js';
import { clearOmahaMathCoreWireCaches } from './OmahaMathCoreWire.js';

const card = (s: string) => ({ rank: s.slice(0, -1), suit: s.slice(-1) });
const seat = (n: number, stack: number, bet: number, cards: string[] = []) =>
  ({
    seat: n,
    stack,
    bet,
    cards: cards.map(card),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }) as unknown as SeatPlayer;

interface WarmShape {
  stacks: number[];
  bets: number[];
  history: Array<{ seat: number; action: string; amount: number; stage: string }>;
  legal: string[];
  pot: number;
}
/** The shapes a PLO5 cash flop decision takes most: heads-up facing a bet, three-way facing a bet, four-way checked to. */
const SHAPES: WarmShape[] = [
  {
    stacks: [190, 180],
    bets: [0, 10],
    history: [
      { seat: 2, action: 'raise', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'call', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'flop' },
      { seat: 2, action: 'bet', amount: 10, stage: 'flop' },
    ],
    legal: ['fold', 'call', 'raise'],
    pot: 30,
  },
  {
    stacks: [194, 190, 188],
    bets: [0, 12, 0],
    history: [
      { seat: 2, action: 'call', amount: 2, stage: 'preflop' },
      { seat: 3, action: 'call', amount: 2, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'flop' },
      { seat: 2, action: 'bet', amount: 12, stage: 'flop' },
      { seat: 3, action: 'call', amount: 12, stage: 'flop' },
    ],
    legal: ['fold', 'call', 'raise'],
    pot: 30,
  },
  {
    stacks: [194, 194, 194, 194],
    bets: [0, 0, 0, 0],
    history: [
      { seat: 2, action: 'call', amount: 2, stage: 'preflop' },
      { seat: 3, action: 'call', amount: 2, stage: 'preflop' },
      { seat: 4, action: 'call', amount: 2, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'preflop' },
      { seat: 2, action: 'check', amount: 0, stage: 'flop' },
      { seat: 3, action: 'check', amount: 0, stage: 'flop' },
      { seat: 4, action: 'check', amount: 0, stage: 'flop' },
    ],
    legal: ['check', 'bet'],
    pot: 8,
  },
];

function warmSpot(shape: WarmShape): { player: SeatPlayer; gs: HorseGameStateV2 } {
  const players = shape.stacks.map((st, i) =>
    seat(i + 1, st, shape.bets[i]!, i === 0 ? ['Ah', 'Kd', 'Qs', '9h', '8c'] : [])
  );
  const currentBet = Math.max(...shape.bets);
  const gs = {
    gameVariant: 'plo5',
    gameMode: 'cash',
    stage: 'flop',
    players,
    dealtSeatIds: players.map((p) => p.seat),
    dealerSeat: players.length,
    communityCards: ['Th', '7h', '2s'].map(card),
    pot: shape.pot,
    currentBet,
    toCall: currentBet,
    bigBlind: 2,
    chipUnit: 0.01,
    asset: 'chips',
    legalActions: shape.legal,
    actionHistory: shape.history,
  } as unknown as HorseGameStateV2;
  return { player: players[0]!, gs };
}

/** Clears every cache the core fills; called after the warm-up (and by tests). */
export function clearOmahaMathCoreCaches(): void {
  clearOmahaMathCoreWireCaches();
  clearPlaybookBlockerCache();
  resetOmahaBestMemo();
}

/** The throwaway core computations; returns whether every one priced its spot and how long it took. Never throws. */
export function warmOmahaMathCore(now: () => number = () => performance.now()): {
  ok: boolean;
  ms: number;
} {
  const t0 = now();
  let ok = false;
  try {
    ok = true;
    for (const shape of SHAPES) {
      const { player, gs } = warmSpot(shape);
      const { receipt } = decideOmahaMathCore(omahaMathCoreState(player, gs), { now });
      ok = ok && !!receipt?.choice;
    }
  } catch {
    ok = false;
  } finally {
    try {
      clearOmahaMathCoreCaches();
    } catch {
      /* a warm-up never stops a worker */
    }
  }
  return { ok, ms: now() - t0 };
}
