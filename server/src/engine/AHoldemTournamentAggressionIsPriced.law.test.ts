/**
 * LAW: `holdemTournamentAggressionIsPriced` (Wave 10.1, 2026-11-22) is a dark,
 * default-OFF, zero-migration, 100% deterministic EV + ICM priced postflop
 * single-board 2-card NLH tournament replacement for `v57TournamentAggression`.
 *
 * Proves:
 *   1. Static hygiene: zero fastRandom / Math.random, zero opponentHud/ imports,
 *      dark refusal in OPTION_SWITCH_REFUSED, registered in HorseDataLedger +
 *      HorseReferenceDecisionSources, dev-only cards in DEVELOPMENT_LEAGUE_CARDS
 *      (never LEAGUE_MATCHUPS), and v58MadeHandCellSkip decoupling preserved.
 *   2. Strict single-board 2-card NLH tournament postflop scope gate.
 *   3. Mathematical monotonicity, ICM survival weighting, HUD/exploit EB
 *      shrinkage, determinism, and adversarial NaN/Infinity safety across all
 *      four priced sub-decisions.
 *   4. End-to-end HorseLogic.decide proofs: 100% bit-identical when OFF/unset,
 *      zero reach to preflop/cash/Omaha/Short Deck/Fixed Limit/multi-board,
 *      independence from opts.v57TournamentAggression, v58MadeHandCellSkip
 *      preservation, and literal telemetry receipts on live tournament spots.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, SeatPlayer } from '../types.js';
import {
  DEVELOPMENT_LEAGUE_CARDS,
  HOLDEM_TOURNAMENT_AGGRESSION_PRICED_CARDS,
  LEAGUE_MATCHUPS,
} from '../benchmark/HorseLeague.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { seedFastRandom } from './HorseEval.js';
import {
  computeTournamentIcmLossMult,
  holdemFlopTextureFromBoard,
  holdemFourFlushOneCardStatus,
  holdemTournamentAggressionIsPricedApplies,
  priceHoldemTournamentBarrelContinue,
  priceHoldemTournamentBarrelPlan,
  priceHoldemTournamentLowSprDecision,
  priceHoldemTournamentOneCardFlushCall,
  truncateCalledEquity,
  type HoldemTournamentAggroScopeInput,
} from './HorseHoldemTournamentAggressionPriced.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED, OPTION_SWITCH_RELEASE_DEFAULT_ON } from './HorseOptionSwitch.js';
import { HORSE_REFERENCE_DECISION_SOURCE_REASONS } from './HorseReferenceDecisionSources.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horsePlanHandKey } from './HorseDecisionEffects.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';

const ENGINE_DIR = __dirname;
const MODULE_PATH = resolve(ENGINE_DIR, 'HorseHoldemTournamentAggressionPriced.ts');
const HORSE_LOGIC_PATH = resolve(ENGINE_DIR, 'HorseLogic.ts');

const EXPECTED_RECEIPTS = [
  'holdem_tourney_aggro_priced_plan_yes_seen',
  'holdem_tourney_aggro_priced_plan_no_seen',
  'holdem_tourney_aggro_priced_low_spr_jam_seen',
  'holdem_tourney_aggro_priced_low_spr_bet_seen',
  'holdem_tourney_aggro_priced_low_spr_check_seen',
  'holdem_tourney_aggro_priced_turn_cell_skip_seen',
  'holdem_tourney_aggro_priced_barrel_bet_seen',
  'holdem_tourney_aggro_priced_barrel_check_seen',
  'holdem_tourney_aggro_priced_one_card_flush_fold_seen',
  'holdem_tourney_aggro_priced_one_card_flush_call_seen',
] as const;

const SUIT_MAP: Record<string, Card['suit']> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

function cards(spec: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < spec.length; i += 2) {
    out.push({
      rank: spec[i] as Card['rank'],
      suit: SUIT_MAP[spec[i + 1]],
    });
  }
  return out;
}

function makeSeat(
  seatNum: number,
  userId: string,
  stack: number,
  bet: number,
  invested: number,
  folded = false,
  hole: Card[] = []
): SeatPlayer {
  return {
    seat: seatNum,
    user_id: userId,
    username: userId,
    stack,
    bet,
    totalInvested: invested,
    cards: hole,
    is_folded: folded,
    is_sitting_out: false,
    is_all_in: false,
  };
}

const T0 = 1_760_000_000_000;

function makeMttBubbleContext(stackByUser: Record<string, number>): HorseGameStateV2['tournament'] {
  return {
    schemaVersion: 1,
    contextStatus: 'complete',
    contextIssues: [],
    playersLeft: 13,
    spotsPaid: 12,
    entrants: 80,
    avgStackChips: 220_000,
    medianStackChips: 200_000,
    seatsPerTable: 8,
    nearBubble: true,
    inMoney: false,
    payoutPct: [25, 16, 12, 9.5, 7.5, 6, 5, 4.5, 4, 3.8, 3.4, 3.3],
    currentSmallBlind: 5_000,
    currentBigBlind: 10_000,
    currentAnte: 10_000,
    anteType: 'big_blind',
    nextSmallBlind: 6_000,
    nextBigBlind: 12_000,
    nextAnte: 12_000,
    nextBlindInMin: 6,
    stacks: [...Object.values(stackByUser), 166_936, 225_546, 361_230, 779_742, 199_474, 263_380],
    stackByUser,
  };
}

function makeLowSprSpot(overrides?: {
  hole?: string;
  board?: string;
  stage?: 'flop' | 'turn';
  mode?: 'tournament' | 'cash';
  variant?: HorseGameStateV2['gameVariant'];
  board2?: string;
  heroStack?: number;
  pot?: number;
}): { player: SeatPlayer; gs: HorseGameStateV2 } {
  const heroStack = overrides?.heroStack ?? 50_036;
  const pot = overrides?.pot ?? 63_752;
  const stage = overrides?.stage ?? 'flop';
  const mode = overrides?.mode ?? 'tournament';
  const hole = cards(overrides?.hole ?? '9c2d');
  const players = [
    makeSeat(1, 'p1', 98_037, 0, 0, true),
    makeSeat(4, 'opener', 204_942, 0, 21_876, false),
    makeSeat(7, 'hero', heroStack, 0, 21_876, false, hole),
    makeSeat(8, 'bb', 206_014, 0, 20_000, true),
  ];
  const stackByUser = Object.fromEntries(
    players.map((p) => [p.user_id, p.stack + p.totalInvested])
  );
  const history = [
    { stage: 'preflop', seat: 7, userId: 'hero', action: 'sb', amount: 5_000, timestamp: T0 },
    { stage: 'preflop', seat: 8, userId: 'bb', action: 'bb', amount: 10_000, timestamp: T0 },
    {
      stage: 'preflop',
      seat: 4,
      userId: 'opener',
      action: 'raise',
      amount: 21_876,
      timestamp: T0 + 1,
      isFullRaise: true,
    },
    {
      stage: 'preflop',
      seat: 7,
      userId: 'hero',
      action: 'call',
      amount: 16_876,
      timestamp: T0 + 2,
    },
    { stage: 'preflop', seat: 8, userId: 'bb', action: 'fold', amount: 0, timestamp: T0 + 3 },
  ];
  const gs: HorseGameStateV2 = {
    stage,
    pot,
    currentBet: 0,
    minRaise: 10_000,
    bigBlind: 10_000,
    smallBlind: 5_000,
    dealerSeat: 4,
    players,
    communityCards: cards(overrides?.board ?? '9h8d6d'),
    ...(overrides?.board2 ? { communityCards2: cards(overrides.board2) } : {}),
    actionHistory: history as HorseGameStateV2['actionHistory'],
    legalActions: ['fold', 'check', 'bet', 'all_in'],
    gameMode: mode,
    format: mode === 'tournament' ? 'mtt' : 'cash',
    gameVariant: overrides?.variant ?? 'nlh',
    ...(mode === 'tournament' ? { tournament: makeMttBubbleContext(stackByUser) } : {}),
  };
  return { player: players[2], gs };
}

function makeFourFlushSpot(overrides?: {
  hole?: string;
  board?: string;
  pot?: number;
  currentBet?: number;
  heroStack?: number;
  mode?: 'tournament' | 'cash';
  nearBubble?: boolean;
}): { player: SeatPlayer; gs: HorseGameStateV2 } {
  const mode = overrides?.mode ?? 'tournament';
  const heroStack = overrides?.heroStack ?? 50_036;
  const currentBet = overrides?.currentBet ?? 51_192;
  const pot = overrides?.pot ?? 114_944;
  const hole = cards(overrides?.hole ?? '9c2d');
  const players = [
    makeSeat(1, 'p1', 98_037, 0, 0, true),
    makeSeat(4, 'opener', 153_750, currentBet, 21_876 + currentBet, false),
    makeSeat(7, 'hero', heroStack, 0, 21_876, false, hole),
    makeSeat(8, 'bb', 206_014, 0, 20_000, true),
  ];
  const stackByUser = Object.fromEntries(
    players.map((p) => [p.user_id, p.stack + p.totalInvested])
  );
  const history = [
    { stage: 'preflop', seat: 7, userId: 'hero', action: 'sb', amount: 5_000, timestamp: T0 },
    { stage: 'preflop', seat: 8, userId: 'bb', action: 'bb', amount: 10_000, timestamp: T0 },
    {
      stage: 'preflop',
      seat: 4,
      userId: 'opener',
      action: 'raise',
      amount: 21_876,
      timestamp: T0 + 1,
      isFullRaise: true,
    },
    {
      stage: 'preflop',
      seat: 7,
      userId: 'hero',
      action: 'call',
      amount: 16_876,
      timestamp: T0 + 2,
    },
    { stage: 'preflop', seat: 8, userId: 'bb', action: 'fold', amount: 0, timestamp: T0 + 3 },
    { stage: 'flop', seat: 7, userId: 'hero', action: 'check', amount: 0, timestamp: T0 + 4 },
    { stage: 'flop', seat: 4, userId: 'opener', action: 'check', amount: 0, timestamp: T0 + 5 },
    { stage: 'turn', seat: 7, userId: 'hero', action: 'check', amount: 0, timestamp: T0 + 6 },
    { stage: 'turn', seat: 4, userId: 'opener', action: 'check', amount: 0, timestamp: T0 + 7 },
    { stage: 'river', seat: 7, userId: 'hero', action: 'check', amount: 0, timestamp: T0 + 8 },
    {
      stage: 'river',
      seat: 4,
      userId: 'opener',
      action: 'bet',
      amount: currentBet,
      timestamp: T0 + 9,
      isFullRaise: true,
    },
  ];
  const baseTourney = makeMttBubbleContext(stackByUser)!;
  const gs: HorseGameStateV2 = {
    stage: 'river',
    pot,
    currentBet,
    minRaise: currentBet,
    bigBlind: 10_000,
    smallBlind: 5_000,
    dealerSeat: 4,
    players,
    communityCards: cards(overrides?.board ?? '9h8d6d3d7d'),
    actionHistory: history as HorseGameStateV2['actionHistory'],
    legalActions: ['fold', 'call', 'all_in'],
    gameMode: mode,
    format: mode === 'tournament' ? 'mtt' : 'cash',
    gameVariant: 'nlh',
    ...(mode === 'tournament'
      ? {
          tournament:
            overrides?.nearBubble === false
              ? {
                  ...baseTourney,
                  playersLeft: 180,
                  spotsPaid: 30,
                  nearBubble: false,
                  stacks: undefined,
                  stackByUser: undefined,
                }
              : baseTourney,
        }
      : {}),
  };
  return { player: players[2], gs };
}

function makeTurnBarrelSpot(overrides?: {
  hole?: string;
  board?: string;
  mode?: 'tournament' | 'cash';
}): { player: SeatPlayer; gs: HorseGameStateV2 } {
  const mode = overrides?.mode ?? 'tournament';
  const hole = cards(overrides?.hole ?? 'As5s');
  const players = [
    makeSeat(4, 'hero', 240_000, 0, 45_000, false, hole),
    makeSeat(8, 'villain', 260_000, 0, 45_000, false),
  ];
  const history = [
    { stage: 'preflop', seat: 4, userId: 'hero', action: 'sb', amount: 5_000, timestamp: T0 },
    { stage: 'preflop', seat: 8, userId: 'villain', action: 'bb', amount: 10_000, timestamp: T0 },
    {
      stage: 'preflop',
      seat: 4,
      userId: 'hero',
      action: 'raise',
      amount: 25_000,
      timestamp: T0 + 1,
      isFullRaise: true,
    },
    {
      stage: 'preflop',
      seat: 8,
      userId: 'villain',
      action: 'call',
      amount: 15_000,
      timestamp: T0 + 2,
    },
    { stage: 'flop', seat: 8, userId: 'villain', action: 'check', amount: 0, timestamp: T0 + 3 },
    {
      stage: 'flop',
      seat: 4,
      userId: 'hero',
      action: 'bet',
      amount: 20_000,
      timestamp: T0 + 4,
      isFullRaise: true,
    },
    {
      stage: 'flop',
      seat: 8,
      userId: 'villain',
      action: 'call',
      amount: 20_000,
      timestamp: T0 + 5,
    },
    { stage: 'turn', seat: 8, userId: 'villain', action: 'check', amount: 0, timestamp: T0 + 6 },
  ];
  const gs: HorseGameStateV2 = {
    stage: 'turn',
    pot: 90_000,
    currentBet: 0,
    minRaise: 10_000,
    bigBlind: 10_000,
    smallBlind: 5_000,
    dealerSeat: 4,
    players,
    communityCards: cards(overrides?.board ?? 'Ks9d4s2c'),
    actionHistory: history as HorseGameStateV2['actionHistory'],
    legalActions: ['fold', 'check', 'bet', 'all_in'],
    gameMode: mode,
    format: mode === 'tournament' ? 'mtt' : 'cash',
    gameVariant: 'nlh',
    ...(mode === 'tournament'
      ? {
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: 180,
            spotsPaid: 30,
            entrants: 300,
            avgStackChips: 300_000,
            medianStackChips: 280_000,
            seatsPerTable: 6,
            nearBubble: false,
            inMoney: false,
            payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            currentSmallBlind: 5_000,
            currentBigBlind: 10_000,
            currentAnte: 10_000,
            anteType: 'big_blind',
            nextSmallBlind: 6_000,
            nextBigBlind: 12_000,
            nextAnte: 12_000,
            nextBlindInMin: 10,
          },
        }
      : {}),
  };
  return { player: players[0], gs };
}

function makePreflopTourneySpot(): { player: SeatPlayer; gs: HorseGameStateV2 } {
  const players = [
    makeSeat(1, 'p1', 250_000, 0, 0, true),
    makeSeat(4, 'hero', 250_000, 0, 0, false, cards('Kd9s')),
    makeSeat(7, 'sb', 250_000, 5_000, 5_000, false),
    makeSeat(8, 'bb', 250_000, 10_000, 10_000, false),
  ];
  const gs: HorseGameStateV2 = {
    stage: 'preflop',
    pot: 25_000,
    currentBet: 10_000,
    minRaise: 10_000,
    bigBlind: 10_000,
    smallBlind: 5_000,
    dealerSeat: 4,
    players,
    communityCards: [],
    actionHistory: [
      { stage: 'preflop', seat: 7, userId: 'sb', action: 'sb', amount: 5_000, timestamp: T0 },
      { stage: 'preflop', seat: 8, userId: 'bb', action: 'bb', amount: 10_000, timestamp: T0 },
    ] as unknown as HorseGameStateV2['actionHistory'],
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    gameMode: 'tournament',
    format: 'mtt',
    gameVariant: 'nlh',
  };
  return { player: players[1], gs };
}

function stableDecision(d: ReturnType<typeof HorseLogic.decide>) {
  return {
    action: d.action,
    amount: d.amount ?? null,
    thinkTime: d.thinkTime,
    continuationGuard: d.continuationGuard ?? null,
  };
}

function decideWithCapture(
  spot: { player: SeatPlayer; gs: HorseGameStateV2 },
  opts: HorseDecideOpts,
  seed = 20261122,
  keepMind = false
) {
  if (!keepMind) HorseMind.reset();
  seedFastRandom(seed);
  seedHorseTimingRandom(seed);
  seedHorseBetSizeRandom(seed);
  enableBrainTelemetry();
  drainFires();
  const decision = HorseLogic.decide(
    spot.player,
    spot.gs,
    'balanced',
    {},
    {
      telemetry: true,
      decisionTimeMs: 1_792_990_001_000,
      ...opts,
    }
  );
  const fires: Record<string, number> = Object.fromEntries(
    drainFires().map((r) => [r.feature, r.fires])
  );
  return { decision: stableDecision(decision), fires };
}

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('holdemTournamentAggressionIsPriced: static hygiene, registry, and decoupling', () => {
  it('pure module has zero RNG draws and zero opponentHud/ imports', () => {
    const src = readFileSync(MODULE_PATH, 'utf8');
    expect(src).not.toMatch(/\bfastRandom\s*\(/);
    expect(src).not.toMatch(/\bMath\.random\s*\(/);
    expect(src).not.toMatch(/from\s+['"][^'"]*opponentHud\//);
  });

  it('is dark in OPTION_SWITCH_REFUSED, absent from default-ON, registered in ledger + reference sources + dev league cards only', () => {
    expect(OPTION_SWITCH_REFUSED.holdemTournamentAggressionIsPriced).toBeTruthy();
    expect(OPTION_SWITCH_RELEASE_DEFAULT_ON).not.toContain('holdemTournamentAggressionIsPriced');
    expect(
      HORSE_REFERENCE_DECISION_SOURCE_REASONS['src/engine/HorseHoldemTournamentAggressionPriced.ts']
    ).toBeTruthy();

    const flagEntry = HORSE_DATA_LEDGER.find(
      (e) => e.kind === 'flag' && e.key === 'holdemTournamentAggressionIsPriced'
    );
    expect(flagEntry).toBeDefined();
    expect(flagEntry!.note).toMatch(/default[- ]off/i);

    for (const receiptKey of EXPECTED_RECEIPTS) {
      const r = HORSE_DATA_LEDGER.find((e) => e.kind === 'receipt' && e.key === receiptKey);
      expect(r, `missing receipt ${receiptKey} in HorseDataLedger`).toBeDefined();
    }

    expect(HOLDEM_TOURNAMENT_AGGRESSION_PRICED_CARDS.length).toBeGreaterThanOrEqual(3);
    for (const card of HOLDEM_TOURNAMENT_AGGRESSION_PRICED_CARDS) {
      expect(DEVELOPMENT_LEAGUE_CARDS.some((c) => c.name === card.name)).toBe(true);
      expect(LEAGUE_MATCHUPS.some((c) => c.name === card.name)).toBe(false);
    }
  });

  it('HorseLogic keeps exact 5 opts.v57TournamentAggression reads and leaves v58MadeHandCellSkip decoupled', () => {
    const src = readFileSync(HORSE_LOGIC_PATH, 'utf8');
    const v57Reads = [...src.matchAll(/opts\.v57TournamentAggression/g)];
    expect(v57Reads).toHaveLength(5);
    expect(src).toMatch(
      /const madeBeyondClass58 = cat >= 4 && opts\.v58MadeHandCellSkip !== false;/
    );
    expect(src).not.toMatch(/madeBeyondClass58[^\n]*holdemTournamentAggressionIsPriced/);
    for (const receiptKey of EXPECTED_RECEIPTS) {
      expect(src).toContain(`noteFire('${receiptKey}')`);
    }
  });
});

describe('holdemTournamentAggressionIsPriced: strict single-board NLH tournament postflop scope gate', () => {
  const validScope: HoldemTournamentAggroScopeInput = {
    enabled: true,
    isTournament: true,
    isCashFormat: false,
    street: 'turn',
    isOmaha: false,
    isPotLimit: false,
    isFixedLimit: false,
    isShortDeck: false,
    isHiLo: false,
    holeCount: 2,
    holeCardCount: 2,
    boardLength: 4,
    multiBoard: false,
    bombPot: false,
    allInOrFold: false,
    pot: 50_000,
    heroStack: 100_000,
  };

  it('accepts flop, turn, and river single-board 2-card NLH tournaments when strictly === true', () => {
    expect(
      holdemTournamentAggressionIsPricedApplies({ ...validScope, street: 'flop', boardLength: 3 })
    ).toBe(true);
    expect(
      holdemTournamentAggressionIsPricedApplies({ ...validScope, street: 'turn', boardLength: 4 })
    ).toBe(true);
    expect(
      holdemTournamentAggressionIsPricedApplies({ ...validScope, street: 'river', boardLength: 5 })
    ).toBe(true);
  });

  it('rejects unset/false/non-boolean, preflop, cash, Omaha, Short Deck, Fixed Limit, Pot Limit, multi-board, bomb pot, AoF, and bad pot/stack', () => {
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, enabled: false })).toBe(
      false
    );
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, enabled: undefined })).toBe(
      false
    );
    expect(
      holdemTournamentAggressionIsPricedApplies({ ...validScope, enabled: 1 as unknown as boolean })
    ).toBe(false);
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, isTournament: false })).toBe(
      false
    );
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, isCashFormat: true })).toBe(
      false
    );
    expect(
      holdemTournamentAggressionIsPricedApplies({
        ...validScope,
        street: 'preflop',
        boardLength: 0,
      })
    ).toBe(false);
    expect(
      holdemTournamentAggressionIsPricedApplies({
        ...validScope,
        isOmaha: true,
        holeCount: 4,
        holeCardCount: 4,
      })
    ).toBe(false);
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, isPotLimit: true })).toBe(
      false
    );
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, isFixedLimit: true })).toBe(
      false
    );
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, isShortDeck: true })).toBe(
      false
    );
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, isHiLo: true })).toBe(false);
    expect(
      holdemTournamentAggressionIsPricedApplies({ ...validScope, holeCount: 3, holeCardCount: 3 })
    ).toBe(false);
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, multiBoard: true })).toBe(
      false
    );
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, bombPot: true })).toBe(false);
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, allInOrFold: true })).toBe(
      false
    );
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, pot: 0 })).toBe(false);
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, pot: Number.NaN })).toBe(
      false
    );
    expect(holdemTournamentAggressionIsPricedApplies({ ...validScope, heroStack: -1 })).toBe(false);
  });
});

describe('holdemTournamentAggressionIsPriced: pure EV/ICM monotonicity, determinism, and adversarial safety', () => {
  it('computeTournamentIcmLossMult is exact 1.0 at zero risk and strictly monotonic in icmRisk, stack risk fraction, and bounty cover discount', () => {
    expect(computeTournamentIcmLossMult(0, 50_000, 50_000, 0)).toBe(1);
    const lowRisk = computeTournamentIcmLossMult(0.05, 50_000, 50_000, 0);
    const highRisk = computeTournamentIcmLossMult(0.18, 50_000, 50_000, 0);
    expect(highRisk).toBeGreaterThan(lowRisk);
    expect(lowRisk).toBeGreaterThan(1);

    const partialWager = computeTournamentIcmLossMult(0.12, 10_000, 50_000, 0);
    const fullJam = computeTournamentIcmLossMult(0.12, 50_000, 50_000, 0);
    expect(fullJam).toBeGreaterThan(partialWager);

    const withBounty = computeTournamentIcmLossMult(0.12, 50_000, 50_000, 0.3);
    expect(withBounty).toBeLessThan(fullJam);
    expect(withBounty).toBeGreaterThanOrEqual(1);
  });

  it('truncateCalledEquity equals rawEquity at pFold=0 and is strictly monotonic in equity and pFold', () => {
    expect(truncateCalledEquity(0.55, 0, 'turn', false)).toBe(0.55);
    expect(truncateCalledEquity(0.55, 0, 'river', false)).toBe(0.55);

    expect(truncateCalledEquity(0.65, 0.4, 'river', false)).toBeGreaterThan(
      truncateCalledEquity(0.45, 0.4, 'river', false)
    );
    expect(truncateCalledEquity(0.5, 0.5, 'river', false)).toBeLessThan(
      truncateCalledEquity(0.5, 0.2, 'river', false)
    );
    expect(truncateCalledEquity(0.35, 0.45, 'river', false)).toBeLessThan(
      truncateCalledEquity(0.35, 0.45, 'turn', true)
    );
  });

  it('priceHoldemTournamentBarrelPlan is deterministic and responds monotonically to equity, draws, ICM, and multiway field', () => {
    const base = {
      street: 'flop' as const,
      equity: 0.36,
      pot: 40_000,
      heroStack: 180_000,
      effBehind: 180_000,
      currentBetApprox: 16_000,
      inPosition: true,
      oppCount: 1,
      wetness: 0.35,
      drawsLive: true,
      blocker: true,
      icmRisk: 0,
      bubblePressure: 0,
      ownBountyScale: 1,
    };
    const v1 = priceHoldemTournamentBarrelPlan(base);
    const v2 = priceHoldemTournamentBarrelPlan(base);
    expect(v1).toEqual(v2);
    expect(v1.shouldPlan).toBe(true);

    const highIcm = priceHoldemTournamentBarrelPlan({
      ...base,
      icmRisk: 0.28,
      drawsLive: false,
      equity: 0.14,
    });
    expect(highIcm.evBarrel).toBeLessThan(v1.evBarrel);

    const multiway = priceHoldemTournamentBarrelPlan({ ...base, oppCount: 3 });
    expect(multiway.pFoldAll).toBeLessThan(v1.pFoldAll);
    expect(multiway.evBarrel).toBeLessThan(v1.evBarrel);

    const shortBehind = priceHoldemTournamentBarrelPlan({ ...base, effBehind: 18_000 });
    expect(shortBehind.shouldPlan).toBe(false);
  });

  it('priceHoldemTournamentLowSprDecision jams Hand 48403158 top pair, checks air, and shifts away from jamming marginal pairs under severe bubble ICM', () => {
    const topPair = priceHoldemTournamentLowSprDecision({
      street: 'flop',
      equity: 0.61,
      cat: 2,
      pot: 63_752,
      heroStack: 50_036,
      effBehind: 50_036,
      minBet: 10_000,
      inPosition: false,
      oppCount: 1,
      wetness: 0.65,
      texture: 'unpaired_nonmono',
      drawsLive: true,
      icmRisk: 0.06,
      bubblePressure: 0,
      ownBountyScale: 1,
    });
    expect(topPair.action).toBe('all_in');
    expect(topPair.evJam).toBeGreaterThan(topPair.evCheck);

    const air = priceHoldemTournamentLowSprDecision({
      street: 'flop',
      equity: 0.14,
      cat: 1,
      pot: 63_752,
      heroStack: 50_036,
      effBehind: 50_036,
      minBet: 10_000,
      inPosition: false,
      oppCount: 2,
      wetness: 0.65,
      texture: 'unpaired_nonmono',
      drawsLive: false,
      icmRisk: 0.12,
      bubblePressure: 0,
      ownBountyScale: 1,
    });
    expect(air.action).toBe('check');

    const marginalBubble = priceHoldemTournamentLowSprDecision({
      street: 'flop',
      equity: 0.46,
      cat: 2,
      pot: 63_752,
      heroStack: 50_036,
      effBehind: 50_036,
      minBet: 10_000,
      inPosition: false,
      oppCount: 2,
      wetness: 0.35,
      texture: 'unpaired_nonmono',
      drawsLive: false,
      icmRisk: 0.22,
      bubblePressure: 0,
      ownBountyScale: 1,
    });
    expect(marginalBubble.action).not.toBe('all_in');
    expect(marginalBubble.evJam).toBeLessThan(marginalBubble.evCheck);

    // HUD opponent who folds frequently raises jam EV cleanly.
    const vsFolder = priceHoldemTournamentLowSprDecision({
      street: 'flop',
      equity: 0.46,
      cat: 2,
      pot: 63_752,
      heroStack: 50_036,
      effBehind: 50_036,
      minBet: 10_000,
      inPosition: true,
      oppCount: 1,
      wetness: 0.35,
      texture: 'unpaired_nonmono',
      drawsLive: false,
      icmRisk: 0.04,
      bubblePressure: 0,
      ownBountyScale: 1,
      villain: { hudOpp: { eff: { 'f.fBet': [40, 32] } } },
    });
    const vsStation = priceHoldemTournamentLowSprDecision({
      street: 'flop',
      equity: 0.46,
      cat: 2,
      pot: 63_752,
      heroStack: 50_036,
      effBehind: 50_036,
      minBet: 10_000,
      inPosition: true,
      oppCount: 1,
      wetness: 0.35,
      texture: 'unpaired_nonmono',
      drawsLive: false,
      icmRisk: 0.04,
      bubblePressure: 0,
      ownBountyScale: 1,
      villain: { hudOpp: { eff: { 'f.fBet': [40, 4] } } },
    });
    expect(vsFolder.pFoldAll).toBeGreaterThan(vsStation.pFoldAll);
    expect(vsFolder.evJam).toBeGreaterThan(vsStation.evJam);
  });

  it('priceHoldemTournamentBarrelContinue responds monotonically to dangered, outlook, ICM, multiway, and HUD fold rates', () => {
    const base = {
      street: 'turn' as const,
      equity: 0.34,
      pot: 90_000,
      heroStack: 240_000,
      effBehind: 240_000,
      minBet: 10_000,
      inPosition: true,
      oppCount: 1,
      playersBehind: 0,
      wetness: 0.35,
      drawsLive: true,
      blocker: true,
      dangered: false,
      barrelPlan: true,
      outlook: 'good' as const,
      geomFrac: 0.65,
      icmRisk: 0,
      bubblePressure: 0,
      ownBountyScale: 1,
    };
    const good = priceHoldemTournamentBarrelContinue(base);
    expect(good.action).toBe('bet');
    expect(good.betFraction).toBeGreaterThan(0);

    const dangered = priceHoldemTournamentBarrelContinue({
      ...base,
      dangered: true,
      blocker: false,
      outlook: 'scare',
      drawsLive: false,
      equity: 0.16,
    });
    expect(dangered.action).toBe('check');
    expect(dangered.evBestBet).toBeLessThan(good.evBestBet);

    const highIcm = priceHoldemTournamentBarrelContinue({
      ...base,
      icmRisk: 0.28,
      heroStack: 75_000,
      effBehind: 75_000,
    });
    expect(highIcm.evBestBet).toBeLessThan(good.evBestBet);

    const multiway = priceHoldemTournamentBarrelContinue({ ...base, oppCount: 3 });
    expect(multiway.pFoldAll).toBeLessThan(good.pFoldAll);
  });

  it('priceHoldemTournamentOneCardFlushCall folds 2-high flush on 4-flush board, calls J-high flush at good odds, and is monotonic in higherFlushRanks & ICM', () => {
    // Hand 48403158: 9c2d on 9h8d6d3d7d (8 live diamonds above 2d) facing full-stack river bet.
    const twoHigh = priceHoldemTournamentOneCardFlushCall({
      street: 'river',
      pot: 114_944,
      toCall: 50_036,
      heroStack: 50_036,
      potFrac: 51_192 / 63_752,
      higherFlushRanks: 8,
      oppCount: 1,
      pairedBoard: false,
      raisedAfterAggr: false,
      icmRisk: 0.1,
    });
    expect(twoHigh.action).toBe('fold');
    expect(twoHigh.evCall).toBeLessThan(0);

    // J-high flush (3 higher ranks: A, K, Q) getting ~4.3:1 on small river bet with low ICM -> calls!
    const jackHigh = priceHoldemTournamentOneCardFlushCall({
      street: 'river',
      pot: 100_000,
      toCall: 22_000,
      heroStack: 40_000,
      potFrac: 22_000 / 78_000,
      higherFlushRanks: 3,
      oppCount: 1,
      pairedBoard: false,
      raisedAfterAggr: false,
      icmRisk: 0.01,
    });
    expect(jackHigh.action).toBe('call');
    expect(jackHigh.evCall).toBeGreaterThan(0);

    // Monotonicity in higherFlushRanks, ICM risk, pairedBoard, and oppCount.
    const midFlush = priceHoldemTournamentOneCardFlushCall({
      street: 'river',
      pot: 100_000,
      toCall: 30_000,
      heroStack: 50_000,
      potFrac: 30_000 / 70_000,
      higherFlushRanks: 5,
      oppCount: 1,
      pairedBoard: false,
      raisedAfterAggr: false,
      icmRisk: 0.02,
    });
    const lowFlush = priceHoldemTournamentOneCardFlushCall({
      street: 'river',
      pot: 100_000,
      toCall: 30_000,
      heroStack: 50_000,
      potFrac: 30_000 / 70_000,
      higherFlushRanks: 8,
      oppCount: 1,
      pairedBoard: false,
      raisedAfterAggr: false,
      icmRisk: 0.02,
    });
    expect(midFlush.posteriorEquity).toBeGreaterThan(lowFlush.posteriorEquity);
    expect(midFlush.evCall).toBeGreaterThan(lowFlush.evCall);

    const paired = priceHoldemTournamentOneCardFlushCall({
      street: 'river',
      pot: 100_000,
      toCall: 30_000,
      heroStack: 50_000,
      potFrac: 30_000 / 70_000,
      higherFlushRanks: 5,
      oppCount: 1,
      pairedBoard: true,
      raisedAfterAggr: false,
      icmRisk: 0.02,
    });
    expect(paired.posteriorEquity).toBeLessThan(midFlush.posteriorEquity);

    const highIcm = priceHoldemTournamentOneCardFlushCall({
      street: 'river',
      pot: 100_000,
      toCall: 30_000,
      heroStack: 50_000,
      potFrac: 30_000 / 70_000,
      higherFlushRanks: 5,
      oppCount: 1,
      pairedBoard: false,
      raisedAfterAggr: false,
      icmRisk: 0.25,
    });
    expect(highIcm.requiredEquity).toBeGreaterThan(midFlush.requiredEquity);
    expect(highIcm.evCall).toBeLessThan(midFlush.evCall);
  });

  it('survives adversarial NaN / Infinity / zero inputs with finite, legal verdicts', () => {
    const nan = Number.NaN;
    const inf = Number.POSITIVE_INFINITY;
    const ninf = Number.NEGATIVE_INFINITY;

    expect(Number.isFinite(computeTournamentIcmLossMult(nan, inf, ninf, nan))).toBe(true);
    expect(Number.isFinite(truncateCalledEquity(nan, inf, 'river', false))).toBe(true);
    expect(holdemFlopTextureFromBoard([])).toBe('unpaired_nonmono');
    expect(holdemFourFlushOneCardStatus([], []).isFourFlushOneCard).toBe(false);

    const plan = priceHoldemTournamentBarrelPlan({
      street: 'flop',
      equity: nan,
      pot: nan,
      heroStack: ninf,
      effBehind: inf,
      currentBetApprox: nan,
      inPosition: true,
      oppCount: nan,
      wetness: inf,
      drawsLive: false,
      blocker: false,
      icmRisk: inf,
      bubblePressure: nan,
      ownBountyScale: ninf,
    });
    expect(Number.isFinite(plan.evBarrel)).toBe(true);
    expect(Number.isFinite(plan.evGiveUp)).toBe(true);

    const lowSpr = priceHoldemTournamentLowSprDecision({
      street: 'turn',
      equity: nan,
      cat: 2,
      pot: nan,
      heroStack: nan,
      effBehind: nan,
      minBet: ninf,
      inPosition: false,
      oppCount: 0,
      wetness: inf,
      texture: 'mono',
      drawsLive: true,
      icmRisk: nan,
      bubblePressure: inf,
      ownBountyScale: nan,
    });
    expect(['all_in', 'bet', 'check']).toContain(lowSpr.action);
    expect(Number.isFinite(lowSpr.evCheck)).toBe(true);
    expect(Number.isFinite(lowSpr.evBest)).toBe(true);

    const cont = priceHoldemTournamentBarrelContinue({
      street: 'river',
      equity: inf,
      pot: nan,
      heroStack: 0,
      effBehind: inf,
      minBet: nan,
      inPosition: false,
      oppCount: ninf,
      playersBehind: nan,
      wetness: nan,
      drawsLive: false,
      blocker: false,
      dangered: false,
      barrelPlan: true,
      outlook: undefined,
      geomFrac: inf,
      icmRisk: nan,
      bubblePressure: nan,
      ownBountyScale: nan,
    });
    expect(['bet', 'check']).toContain(cont.action);
    expect(Number.isFinite(cont.evCheck)).toBe(true);
    expect(Number.isFinite(cont.evBestBet)).toBe(true);

    const flush = priceHoldemTournamentOneCardFlushCall({
      street: 'river',
      pot: nan,
      toCall: inf,
      heroStack: 0,
      potFrac: nan,
      higherFlushRanks: inf,
      oppCount: 0,
      pairedBoard: false,
      raisedAfterAggr: false,
      icmRisk: nan,
    });
    expect(['call', 'fold']).toContain(flush.action);
    expect(Number.isFinite(flush.evCall)).toBe(true);
    expect(Number.isFinite(flush.posteriorEquity)).toBe(true);
  });
});

describe('holdemTournamentAggressionIsPriced: HorseLogic.decide end-to-end invariance and live pricing', () => {
  it('100% bit-identical when unset vs false across NLH tournament, cash, PLO4, Short Deck, Fixed Limit, and multi-board', () => {
    const spots = [
      makeLowSprSpot(),
      makeFourFlushSpot(),
      makeTurnBarrelSpot(),
      makePreflopTourneySpot(),
      makeLowSprSpot({ mode: 'cash' }),
      makeLowSprSpot({ variant: 'plo4', hole: '9c2dAhKs' }),
      makeLowSprSpot({ variant: 'short_deck', hole: '9cTd', board: '9h8d6d' }),
      makeLowSprSpot({ variant: 'flh' }),
      makeLowSprSpot({ board2: 'AhKh2c' }),
    ];
    // Warm up one-time per-process lazy Omaha reservoir initialization so fires compare cleanly.
    decideWithCapture(makeLowSprSpot({ variant: 'plo4', hole: '9c2dAhKs' }), {});
    for (const spot of spots) {
      const a = decideWithCapture(spot, {});
      const b = decideWithCapture(spot, { holdemTournamentAggressionIsPriced: false });
      expect(b.decision).toEqual(a.decision);
      expect(b.fires).toEqual(a.fires);
    }
  });

  it('zero reach to preflop, cash, PLO4, Short Deck, Fixed Limit, and multi-board when ON', () => {
    const outOfScopeSpots = [
      ['mtt-preflop', makePreflopTourneySpot()],
      ['nlh-cash-low-spr', makeLowSprSpot({ mode: 'cash' })],
      ['nlh-cash-four-flush', makeFourFlushSpot({ mode: 'cash' })],
      ['nlh-cash-turn-barrel', makeTurnBarrelSpot({ mode: 'cash' })],
      ['plo4-mtt-flop', makeLowSprSpot({ variant: 'plo4', hole: '9c2dAhKs' })],
      [
        'short-deck-mtt-flop',
        makeLowSprSpot({ variant: 'short_deck', hole: '9cTd', board: '9h8d6d' }),
      ],
      ['fixed-limit-mtt-flop', makeLowSprSpot({ variant: 'flh' })],
      ['multi-board-mtt-flop', makeLowSprSpot({ board2: 'AhKh2c' })],
    ] as const;

    for (const [label, spot] of outOfScopeSpots) {
      const off = decideWithCapture(spot, {});
      const on = decideWithCapture(spot, { holdemTournamentAggressionIsPriced: true });
      expect(on.decision, label).toEqual(off.decision);
      expect(on.fires, label).toEqual(off.fires);
      for (const r of EXPECTED_RECEIPTS) {
        expect(on.fires[r], `${label} unexpectedly fired ${r}`).toBeUndefined();
      }
    }
  });

  it('replaces v58_low_spr_stack_off cleanly and independently of opts.v57TournamentAggression', () => {
    const topPairSpot = makeLowSprSpot({ hole: '9c2d', board: '9h8d6d' });
    const legacy = decideWithCapture(topPairSpot, { v57TournamentAggression: true });
    expect(legacy.fires.v58_low_spr_stack_off).toBe(1);
    expect(legacy.decision.action).toBe('all_in');

    const pricedV57On = decideWithCapture(topPairSpot, {
      v57TournamentAggression: true,
      holdemTournamentAggressionIsPriced: true,
    });
    const pricedV57Off = decideWithCapture(topPairSpot, {
      v57TournamentAggression: false,
      holdemTournamentAggressionIsPriced: true,
    });
    expect(pricedV57On.decision.action).toBe('all_in');
    expect(pricedV57On.fires.holdem_tourney_aggro_priced_low_spr_jam_seen).toBe(1);
    expect(pricedV57On.fires.v58_low_spr_stack_off).toBeUndefined();
    expect(pricedV57Off.decision).toEqual(pricedV57On.decision);
    expect(pricedV57Off.fires.holdem_tourney_aggro_priced_low_spr_jam_seen).toBe(1);

    const airSpot = makeLowSprSpot({ hole: '4c2s', board: '9h8d6d' });
    const airPriced = decideWithCapture(airSpot, { holdemTournamentAggressionIsPriced: true });
    expect(airPriced.decision.action).toBe('check');
    expect(airPriced.fires.holdem_tourney_aggro_priced_low_spr_check_seen).toBe(1);
  });

  it('replaces v58_one_card_low_flush_fold cleanly, folding 2-high flush and calling J-high flush at favorable odds independently of v57TournamentAggression', () => {
    const twoHighSpot = makeFourFlushSpot({ hole: '9c2d', board: '9h8d6d3d7d' });
    const legacy = decideWithCapture(twoHighSpot, { v57TournamentAggression: true });
    expect(legacy.fires.v58_one_card_low_flush_fold).toBe(1);
    expect(legacy.decision.action).toBe('fold');

    const pricedOn = decideWithCapture(twoHighSpot, {
      v57TournamentAggression: true,
      holdemTournamentAggressionIsPriced: true,
    });
    const pricedOff = decideWithCapture(twoHighSpot, {
      v57TournamentAggression: false,
      holdemTournamentAggressionIsPriced: true,
    });
    expect(pricedOn.decision.action).toBe('fold');
    expect(pricedOn.fires.holdem_tourney_aggro_priced_one_card_flush_fold_seen).toBe(1);
    expect(pricedOn.fires.v58_one_card_low_flush_fold).toBeUndefined();
    expect(pricedOff.decision).toEqual(pricedOn.decision);
    expect(pricedOff.fires.holdem_tourney_aggro_priced_one_card_flush_fold_seen).toBe(1);

    // J-high one-card flush (3 higher live ranks: A, K, Q) facing small committing bet (pot odds 0.18) with no bubble ICM.
    const jackHighSpot = makeFourFlushSpot({
      hole: 'Jd2c',
      board: '9h8d6d3d7d',
      pot: 100_000,
      currentBet: 22_000,
      heroStack: 40_000,
      nearBubble: false,
    });
    const legacyJack = decideWithCapture(jackHighSpot, { v57TournamentAggression: true });
    expect(legacyJack.fires.v58_one_card_low_flush_fold).toBe(1);
    expect(legacyJack.decision.action).toBe('fold');

    const pricedJack = decideWithCapture(jackHighSpot, {
      v57TournamentAggression: false,
      holdemTournamentAggressionIsPriced: true,
    });
    expect(pricedJack.fires.holdem_tourney_aggro_priced_one_card_flush_call_seen).toBe(1);
    expect(pricedJack.fires.v58_one_card_low_flush_fold).toBeUndefined();
    expect(pricedJack.decision.action).toBe('call');
  });

  it('replaces turn barrel continuation deterministically with zero v57_turn_cell_initiative_skip', () => {
    // Bottom pair on a high-card board: has showdown value (skips flopTurnBluffBaseline),
    // below value-bet bar (equity < 0.62), reaches V7 barrel continuation deterministically.
    const spot = makeTurnBarrelSpot({
      hole: '5s3s',
      board: 'KsQd9c5h',
    });
    const planKey = horsePlanHandKey(spot.gs.actionHistory, undefined);

    const results: Array<{ action: string; firedBet: number; firedCheck: number }> = [];
    for (const seed of [101, 202, 303, 404, 505]) {
      HorseMind.reset();
      HorseMind.notePlan(planKey, 'hero', true);
      const r = decideWithCapture(
        spot,
        { v57TournamentAggression: true, holdemTournamentAggressionIsPriced: true },
        seed,
        true
      );
      expect(r.fires.v57_turn_cell_initiative_skip).toBeUndefined();
      expect(r.fires.holdem_tourney_aggro_priced_turn_cell_skip_seen).toBe(1);
      const firedBet = r.fires.holdem_tourney_aggro_priced_barrel_bet_seen ?? 0;
      const firedCheck = r.fires.holdem_tourney_aggro_priced_barrel_check_seen ?? 0;
      expect(firedBet + firedCheck).toBe(1);
      results.push({ action: r.decision.action, firedBet, firedCheck });
    }
    // Identical decision across every seed (zero RNG variance in barrel continuation).
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }

    // Independent of opts.v57TournamentAggression.
    HorseMind.reset();
    HorseMind.notePlan(planKey, 'hero', true);
    const v57Off = decideWithCapture(
      spot,
      { v57TournamentAggression: false, holdemTournamentAggressionIsPriced: true },
      101,
      true
    );
    expect(v57Off.decision.action).toBe(results[0].action);
    expect(v57Off.fires.holdem_tourney_aggro_priced_turn_cell_skip_seen).toBe(1);
  });

  it('preserves v58MadeHandCellSkip on MTT nut-flush open spots when holdemTournamentAggressionIsPriced is ON', () => {
    const base = makeTurnBarrelSpot({
      hole: 'AcJc',
      board: 'Qc8c5c',
    });
    const deepPlayers = base.gs.players.map((p) => ({ ...p, stack: 500_000 }));
    const spot = {
      player: deepPlayers[0],
      gs: {
        ...base.gs,
        players: deepPlayers,
        stage: 'flop' as const,
        pot: 60_000,
        actionHistory: (base.gs.actionHistory ?? []).slice(0, 4),
      },
    };
    const on = decideWithCapture(spot, {
      v57TournamentAggression: false,
      holdemTournamentAggressionIsPriced: true,
    });
    expect(on.fires.v58_made_hand_cell_skip).toBe(1);

    const v58Disabled = decideWithCapture(spot, {
      v57TournamentAggression: false,
      holdemTournamentAggressionIsPriced: true,
      v58MadeHandCellSkip: false,
    });
    expect(v58Disabled.fires.v58_made_hand_cell_skip).toBeUndefined();
  });
});
