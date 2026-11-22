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
 *
 * Lane CORE-FIX-1 (AUDIT-A item 15, owner order Nov 21): the warm-up covered PLO5 flop shapes only, so PLO4 (its
 * 4-card evaluator and memo), preflop tables, turn and river stayed cold for their first live decision. It now runs
 * one heads-up facing-a-bet spot on EVERY street the core can own (OMAHA_MATH_CORE_WARM_STREETS: PLO4 and PLO5 x
 * preflop, flop, turn, river) after the PLO5 flop shapes, and reports which it warmed. Still decision-free: the
 * caches are cleared after it, it reads no switch, and a worker with the core off decides exactly as before.
 */
import type { SeatPlayer } from '../../types.js';
import { restoreFastRandom, saveFastRandom } from '../HorseEval.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { warmOmahaDecidePaths } from '../horseDecision/warmOmahaDecidePaths.js';
import { decideOmahaMathCore, rakeNet } from './OmahaMathCore.js';
import { resetOmahaBestMemo } from './OmahaMathCoreEval.js';
import { clearPlaybookBlockerCache } from './OmahaMathCorePlaybookBlockers.js';
import { omahaMathCoreState } from './OmahaMathCoreRule.js';
import {
  OMAHA_MATH_CORE_TR_FW_EDGES,
  priceTurnRiverLifetimeCall,
} from './OmahaMathCoreTurnRiver.js';
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
  variant?: 'plo4' | 'plo5';
  stage?: 'preflop' | 'flop' | 'turn' | 'river';
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

/** The streets the core can own (lane CORE-FIX-1): each is warmed by one heads-up spot facing a bet. */
export const OMAHA_MATH_CORE_WARM_STREETS = (['plo4', 'plo5'] as const).flatMap((variant) =>
  (['preflop', 'flop', 'turn', 'river'] as const).map((stage) => ({ variant, stage }))
);
const BOARD: Record<'preflop' | 'flop' | 'turn' | 'river', string[]> = {
  preflop: [],
  flop: ['Th', '7h', '2s'],
  turn: ['Th', '7h', '2s', '4c'],
  river: ['Th', '7h', '2s', '4c', 'Jd'],
};
function streetShape(
  variant: 'plo4' | 'plo5',
  stage: 'preflop' | 'flop' | 'turn' | 'river'
): WarmShape {
  const pre = stage === 'preflop';
  const history: WarmShape['history'] = [{ seat: 2, action: 'raise', amount: 6, stage: 'preflop' }];
  if (!pre) history.push({ seat: 1, action: 'call', amount: 6, stage: 'preflop' });
  const streets = (['flop', 'turn', 'river'] as const).slice(
    0,
    ['preflop', 'flop', 'turn', 'river'].indexOf(stage)
  );
  // earlier streets checked through; on this street the hero checked and the opponent bet
  streets.forEach((st, i) => {
    history.push({ seat: 1, action: 'check', amount: 0, stage: st });
    history.push(
      i === streets.length - 1
        ? { seat: 2, action: 'bet', amount: 10, stage: st }
        : { seat: 2, action: 'check', amount: 0, stage: st }
    );
  });
  return {
    variant,
    stage,
    stacks: pre ? [196, 194] : [188, 178],
    bets: pre ? [2, 6] : [0, 10],
    history,
    legal: ['fold', 'call', 'raise'],
    pot: pre ? 9 : 22,
  };
}

function warmSpot(shape: WarmShape): { player: SeatPlayer; gs: HorseGameStateV2 } {
  const variant = shape.variant ?? 'plo5';
  const stage = shape.stage ?? 'flop';
  const hole = variant === 'plo4' ? ['Ah', 'Kd', 'Qs', '9h'] : ['Ah', 'Kd', 'Qs', '9h', '8c'];
  const players = shape.stacks.map((st, i) => seat(i + 1, st, shape.bets[i]!, i === 0 ? hole : []));
  const currentBet = Math.max(...shape.bets);
  const gs = {
    gameVariant: variant,
    gameMode: 'cash',
    stage,
    players,
    dealtSeatIds: players.map((p) => p.seat),
    dealerSeat: players.length,
    communityCards: BOARD[stage].map(card),
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

/** The warm spots (lane CORE-FIX-1): one per core street, then the PLO5 flop multiway shapes; for laws. */
export function omahaMathCoreStreetSpots(): Array<{
  key: string;
  player: SeatPlayer;
  gs: HorseGameStateV2;
}> {
  return [
    ...OMAHA_MATH_CORE_WARM_STREETS.map(({ variant, stage }) => ({
      key: `${variant}|${stage}`,
      ...warmSpot(streetShape(variant, stage)),
    })),
    // the PLO5 flop multiway shapes (2 and 3 opponents)
    ...SHAPES.map((shape) => ({
      key: `plo5|flop|${shape.stacks.length}-handed`,
      ...warmSpot(shape),
    })),
  ];
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
  /** '<variant>|<street>' of every spot that priced (lane CORE-FIX-1) */
  warmed: string[];
} {
  const t0 = now();
  let ok = false;
  const warmed: string[] = [];
  const savedRng = saveFastRandom();
  try {
    ok = true;
    const plo4CbetShape: WarmShape = {
      variant: 'plo4',
      stage: 'flop',
      stacks: [194, 194],
      bets: [0, 0],
      history: [
        { seat: 1, action: 'raise', amount: 6, stage: 'preflop' },
        { seat: 2, action: 'call', amount: 6, stage: 'preflop' },
        { seat: 2, action: 'check', amount: 0, stage: 'flop' },
      ],
      legal: ['check', 'bet'],
      pot: 13,
    };
    const shapes = [
      ...SHAPES,
      plo4CbetShape,
      ...OMAHA_MATH_CORE_WARM_STREETS.map(({ variant, stage }) => streetShape(variant, stage)),
    ];
    for (const shape of shapes) {
      // one spot that fails never stops the others (each street is warmed on its own)
      try {
        const { player, gs } = warmSpot(shape);
        const { receipt } = decideOmahaMathCore(omahaMathCoreState(player, gs), { now });
        const priced = !!receipt?.choice;
        ok = ok && priced;
        const key = `${shape.variant ?? 'plo5'}|${shape.stage ?? 'flop'}`;
        if (priced && !warmed.includes(key)) warmed.push(key);
      } catch {
        ok = false;
      }
    }
    // B3 turn/river HUD pricing warm-up (lane core-repair, 2026-11-22): warm holdsCurrentNuts +
    // priceTurnRiverLifetimeCall (5-card/4-card board evaluation & polarized pool) on synthetic
    // public turn/river spots so the first live turn/river decision never pays cold JIT compilation.
    const warmBins = new Array<number>(OMAHA_MATH_CORE_TR_FW_EDGES.length + 1).fill(0);
    warmBins[warmBins.length - 1] = 160;
    const warmCounts = { opps: 200, bets: 160, bins: warmBins, priorRate: 0.3 };
    for (const { variant, stage } of OMAHA_MATH_CORE_WARM_STREETS) {
      if (stage !== 'turn' && stage !== 'river') continue;
      try {
        const { player, gs } = warmSpot(streetShape(variant, stage));
        const st = omahaMathCoreState(player, gs);
        const tr = priceTurnRiverLifetimeCall({
          state: st,
          counts: warmCounts,
          pooledCounts: warmCounts,
          barrel: null,
          riverCounts: null,
          net: (p) => rakeNet(st, p),
          k: 5,
        });
        ok = ok && tr.applies === true;
      } catch {
        ok = false;
      }
    }
    // Audit P1-1 (2026-11-22): warm HorseLogic.decide + Plo4LivePolicy (plo4Policy) + B2 cbetRaiseShare
    // + OmahaVariantLivePolicy + B3 turn/river rule on synthetic public PLO4/PLO5 spots before READY,
    // eliminating the ~83-145 ms cold item-#0 JIT spike that trips the 150 ms Hetzner shadow breaker.
    // Runs with observeMind: false and telemetry: false; RNG, HorseMind, and core caches are restored in finally.
    ok = ok && warmOmahaDecidePaths();
  } catch {
    ok = false;
  } finally {
    try {
      restoreFastRandom(savedRng);
    } catch {
      /* a warm-up never stops a worker */
    }
    try {
      HorseMind.setDecisionScope(null);
      HorseMind.reset();
    } catch {
      /* a warm-up never stops a worker */
    }
    try {
      clearOmahaMathCoreCaches();
    } catch {
      /* a warm-up never stops a worker */
    }
  }
  return { ok, ms: now() - t0, warmed };
}
