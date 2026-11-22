/**
 * Worker-start warm-up for HorseLogic.decide Omaha decision paths (audit P1-1, 2026-11-22).
 *
 * Lives in horseDecision/ (outside omahaMathCore/) so the math core remains strictly
 * identity-free while HorseLogic.decide receives valid synthetic SeatPlayer / HorseGameStateV2
 * records. Called once at worker boot by warmOmahaMathCore() before READY, with observeMind: false
 * and telemetry: false; RNG, HorseMind, core caches, and the turn/river HUD provider are restored
 * before returning.
 */
import type { SeatPlayer } from '../../types.js';
import { HorseLogic, type HorseGameStateV2 } from '../HorseLogic.js';
import {
  OMAHA_MATH_CORE_TR_FW_EDGES,
  omahaMathCoreTurnRiverProvider,
  setOmahaMathCoreTurnRiverProvider,
  type OmahaMathCoreTurnRiverProvider,
} from '../omahaMathCore/OmahaMathCoreTurnRiver.js';

const WARM_TIME_MS = 1_794_938_400_000;

const card = (s: string) => ({ rank: s.slice(0, -1), suit: s.slice(-1) });

function makeSeat(n: number, stack: number, bet: number, cards: string[] = []): SeatPlayer {
  return {
    user_id: `warm-seat-${n}`,
    username: `warm-seat-${n}`,
    seat: n,
    stack,
    bet,
    cards: cards.map(card),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
}

interface DecideWarmSpot {
  variant: 'plo4' | 'plo5';
  stage: 'flop' | 'turn' | 'river';
  hole: string[];
  board: string[];
  stacks: [number, number];
  bets: [number, number];
  pot: number;
  legal: string[];
  history: Array<{ seat: number; action: string; amount: number; stage: string }>;
  extraOpts: Record<string, unknown>;
}

const DECIDE_WARM_SPOTS: readonly DecideWarmSpot[] = [
  // PLO4 cash flop c-bet: warms HorseLogic.decideInternal + Plo4LivePolicy (plo4Policy) + B2 cbetRaiseShare
  {
    variant: 'plo4',
    stage: 'flop',
    hole: ['Ah', 'Kd', 'Qs', '9h'],
    board: ['Th', '7h', '2s'],
    stacks: [194, 194],
    bets: [0, 0],
    pot: 13,
    legal: ['check', 'bet', 'all_in'],
    history: [
      { seat: 1, action: 'raise', amount: 6, stage: 'preflop' },
      { seat: 2, action: 'call', amount: 6, stage: 'preflop' },
      { seat: 2, action: 'check', amount: 0, stage: 'flop' },
    ],
    extraOpts: { omahaMathCore: true, omahaMathCorePlo4Flop: true },
  },
  // PLO4 cash flop facing bet
  {
    variant: 'plo4',
    stage: 'flop',
    hole: ['Ah', 'Kd', 'Qs', '9h'],
    board: ['Th', '7h', '2s'],
    stacks: [188, 178],
    bets: [0, 10],
    pot: 22,
    legal: ['fold', 'call', 'raise', 'all_in'],
    history: [
      { seat: 2, action: 'raise', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'call', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'flop' },
      { seat: 2, action: 'bet', amount: 10, stage: 'flop' },
    ],
    extraOpts: { omahaMathCore: true, omahaMathCorePlo4Flop: true },
  },
  // PLO5 cash flop facing bet: warms OmahaVariantLivePolicy + PLO5 flop core rule
  {
    variant: 'plo5',
    stage: 'flop',
    hole: ['Ah', 'Kd', 'Qs', '9h', '8c'],
    board: ['Th', '7h', '2s'],
    stacks: [188, 178],
    bets: [0, 10],
    pot: 22,
    legal: ['fold', 'call', 'raise', 'all_in'],
    history: [
      { seat: 2, action: 'raise', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'call', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'flop' },
      { seat: 2, action: 'bet', amount: 10, stage: 'flop' },
    ],
    extraOpts: { omahaMathCore: true, omahaMathCorePlo5Flop: true },
  },
  // PLO5 cash turn facing pot bet: warms HorseLogic.decide turn path + B3 turn HUD fast-path
  {
    variant: 'plo5',
    stage: 'turn',
    hole: ['Kh', '9c', '8d', '5c', '3h'],
    board: ['Ks', '9d', '7c', '4h'],
    stacks: [188, 168],
    bets: [0, 20],
    pot: 42,
    legal: ['fold', 'call', 'raise', 'all_in'],
    history: [
      { seat: 2, action: 'raise', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'call', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'flop' },
      { seat: 2, action: 'check', amount: 0, stage: 'flop' },
      { seat: 1, action: 'check', amount: 0, stage: 'turn' },
      { seat: 2, action: 'bet', amount: 20, stage: 'turn' },
    ],
    extraOpts: { omahaMathCore: true, omahaMathCorePlo5Turn: true },
  },
  // PLO5 cash river facing pot bet: warms HorseLogic.decide river path + B3 river HUD fast-path
  {
    variant: 'plo5',
    stage: 'river',
    hole: ['Kh', '9c', '8d', '5c', '3h'],
    board: ['Ks', '9d', '7c', '4h', '2s'],
    stacks: [188, 168],
    bets: [0, 20],
    pot: 42,
    legal: ['fold', 'call', 'raise', 'all_in'],
    history: [
      { seat: 2, action: 'raise', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'call', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'flop' },
      { seat: 2, action: 'check', amount: 0, stage: 'flop' },
      { seat: 1, action: 'check', amount: 0, stage: 'turn' },
      { seat: 2, action: 'check', amount: 0, stage: 'turn' },
      { seat: 1, action: 'check', amount: 0, stage: 'river' },
      { seat: 2, action: 'bet', amount: 20, stage: 'river' },
    ],
    extraOpts: { omahaMathCore: true, omahaMathCorePlo5River: true },
  },
  // PLO4 cash turn facing pot bet
  {
    variant: 'plo4',
    stage: 'turn',
    hole: ['Kh', '9c', '8d', '5c'],
    board: ['Ks', '9d', '7c', '4h'],
    stacks: [188, 168],
    bets: [0, 20],
    pot: 42,
    legal: ['fold', 'call', 'raise', 'all_in'],
    history: [
      { seat: 2, action: 'raise', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'call', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'flop' },
      { seat: 2, action: 'check', amount: 0, stage: 'flop' },
      { seat: 1, action: 'check', amount: 0, stage: 'turn' },
      { seat: 2, action: 'bet', amount: 20, stage: 'turn' },
    ],
    extraOpts: { omahaMathCore: true, omahaMathCorePlo4Turn: true },
  },
  // PLO4 cash river facing pot bet
  {
    variant: 'plo4',
    stage: 'river',
    hole: ['Kh', '9c', '8d', '5c'],
    board: ['Ks', '9d', '7c', '4h', '2s'],
    stacks: [188, 168],
    bets: [0, 20],
    pot: 42,
    legal: ['fold', 'call', 'raise', 'all_in'],
    history: [
      { seat: 2, action: 'raise', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'call', amount: 6, stage: 'preflop' },
      { seat: 1, action: 'check', amount: 0, stage: 'flop' },
      { seat: 2, action: 'check', amount: 0, stage: 'flop' },
      { seat: 1, action: 'check', amount: 0, stage: 'turn' },
      { seat: 2, action: 'check', amount: 0, stage: 'turn' },
      { seat: 1, action: 'check', amount: 0, stage: 'river' },
      { seat: 2, action: 'bet', amount: 20, stage: 'river' },
    ],
    extraOpts: { omahaMathCore: true, omahaMathCorePlo4River: true },
  },
];

function makeWarmTrProvider(): OmahaMathCoreTurnRiverProvider {
  const bins = new Array<number>(OMAHA_MATH_CORE_TR_FW_EDGES.length + 1).fill(0);
  bins[bins.length - 1] = 160;
  const counts = { opps: 200, bets: 160, bins, priorRate: 0.3 };
  return {
    active: () => true,
    firstWager: () => counts,
    barrel: () => null,
    riverRate: () => ({ opps: 200, bets: 160 }),
  };
}

/**
 * Runs throwaway HorseLogic.decide calls across PLO4/PLO5 flop, turn, and river so V8 compiles
 * HorseLogic.decideInternal, Plo4LivePolicy, B2 cbetRaiseShare, OmahaVariantLivePolicy, and the
 * B3 turn/river rule before READY. Returns true iff every spot completed cleanly without throwing
 * or falling back to brain_exception recovery.
 */
export function warmOmahaDecidePaths(): boolean {
  const prevProvider = omahaMathCoreTurnRiverProvider();
  setOmahaMathCoreTurnRiverProvider(makeWarmTrProvider());
  let allOk = true;
  try {
    for (const spot of DECIDE_WARM_SPOTS) {
      try {
        const players = [
          makeSeat(1, spot.stacks[0], spot.bets[0], spot.hole),
          makeSeat(2, spot.stacks[1], spot.bets[1], []),
        ];
        const currentBet = Math.max(spot.bets[0], spot.bets[1]);
        const gs = {
          tableId: 'warm-table',
          handId: `warm-${spot.variant}-${spot.stage}`,
          gameVariant: spot.variant,
          gameMode: 'cash',
          stage: spot.stage,
          players,
          dealtSeatIds: [1, 2],
          dealerSeat: 2,
          communityCards: spot.board.map(card),
          pot: spot.pot,
          currentBet,
          toCall: currentBet,
          smallBlind: 1,
          bigBlind: 2,
          chipUnit: 0.01,
          asset: 'chips',
          legalActions: spot.legal,
          actionHistory: spot.history.map((h) => ({
            ...h,
            userId: `warm-seat-${h.seat}`,
          })),
        } as unknown as HorseGameStateV2;
        const d = HorseLogic.decide(
          players[0]!,
          gs,
          'balanced',
          {},
          {
            observeMind: false,
            telemetry: false,
            decisionTimeMs: WARM_TIME_MS,
            ...spot.extraOpts,
          }
        );
        const clean =
          !!d?.action &&
          d.omahaMathCore?.applied === true &&
          d.omahaMathCore?.error === null &&
          d.omahaMathCore?.core !== null;
        allOk = allOk && clean;
      } catch {
        allOk = false;
      }
    }
  } finally {
    setOmahaMathCoreTurnRiverProvider(prevProvider);
  }
  return allOk;
}
