/**
 * LAW: holdemFlopTurnBluffIsPriced (2026-11-22, Horse Switch lane, DARK / DEFAULT OFF).
 *
 * Proves every invariant of the dark default-OFF priced replacement for `flopTurnBluffBaseline`
 * (A3, REVIEW-HOLDEM-OFFLIST-20261121.md §5, unopened / checked-to single-board 2-card NLH flops
 * and turns):
 *  (a) Bit-identical when OFF (absent, false, or any non-boolean truthy value) across NLH cash/MTT
 *      and PLO4/PLO5 (decision, telemetry fires, and PRNG state).
 *  (b) Deterministic EV-driven candidate sizing (`0.33x`, `0.55x`, `0.75x`, `1.0x` pot / stack cap)
 *      vs realized `EV(check)` when ON, backed by empirical NLH flop/turn fold-to-bet curves
 *      (`holdemEmpiricalPriors.ts`), multiway compounding discount, selection-bias surplus
 *      retention, draw vs air equity realization when called (`eqWhenCalled`), calling-station
 *      discipline, and risk-calibrated margin — independent of `flopTurnBluffBaseline`, with
 *      clean `holdem_flop_turn_bluff_priced_*_seen` receipts.
 *  (c) Zero `fastRandom` / `Math.random` coin flips on the priced path: identical spot inputs
 *      yield the exact same bet-or-check decision and size across arbitrary PRNG seeds.
 *  (d) Strict NLH-only flop/turn unopened scope: PLO4, PLO5, PLO6, PLO8 Hi-Lo, Short Deck, Fixed
 *      Limit, multi-board, bomb pot, All-In-or-Fold, satellite-locked, river (`holdemRiverBluffIsPriced`
 *      / `v87RiverBlockBetTrapIsPriced`), and facing-bet (`v78`) spots are never hijacked and
 *      remain 100% bit-identical to OFF.
 *  (e) Dark registration & isolation: listed in `OPTION_SWITCH_REFUSED`, mirrored in
 *      `scripts/ci/test-horse-option-switch-evidence-postgres.sh`, registered in `HORSE_DATA_LEDGER`,
 *      `HORSE_REFERENCE_DECISION_SOURCE_REASONS`, and `DEVELOPMENT_LEAGUE_CARDS` (never
 *      `LEAGUE_MATCHUPS`), with zero import dependency on `opponentHud/`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import { HORSE_REFERENCE_DECISION_SOURCE_REASONS } from './HorseReferenceDecisionSources.js';
import { DEVELOPMENT_LEAGUE_CARDS, LEAGUE_MATCHUPS } from '../benchmark/HorseLeague.js';
import {
  HOLDEM_FLOP_TURN_BLUFF_CANDIDATE_FRACS,
  HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS,
  HOLDEM_FLOP_TURN_BLUFF_STATION_FOLD_CAP,
  HOLDEM_FLOP_TURN_BLUFF_SURPLUS_RETENTION,
  classifyHoldemFlopTexture,
  computeHoldemFlopTurnEqWhenCalled,
  conditionHoldemFlopTurnBluffFoldProb,
  holdemEmpiricalFlopTurnSmoothFoldPrior,
  holdemFlopTurnBluffIsPricedApplies,
  holdemFlopTurnBluffPricedVerdict,
  type HoldemFlopTurnBluffPricedGateInput,
  type HoldemFlopTurnBluffPricedInput,
} from './HorseHoldemFlopTurnBluffIsPriced.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, '../../..');

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  }
  return out;
}

const fireCounts = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));

function stripWallClock<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripWallClock(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'elapsedMs' || k === 'latencyMs' || k === 'policyMs') continue;
      out[k] = stripWallClock(v);
    }
    return out as T;
  }
  return value;
}

function decideWithOpts(hero: SeatPlayer, gs: HorseGameStateV2, opts: HorseDecideOpts) {
  return HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts });
}

function buildFlopTurnSpot(params: {
  variant?: string;
  street: 'flop' | 'turn';
  hole: string;
  board: string;
  heroId?: string;
  villainId?: string;
  pot?: number;
  heroStack?: number;
  villainStack?: number;
  bigBlind?: number;
  inPosition?: boolean;
  line?: 'cbet' | 'barrel' | 'delayed' | 'probe' | 'stab';
  extraOpponents?: number;
  facingBetAmount?: number;
  bombPot?: boolean;
  multiBoard?: boolean;
  allInOrFold?: boolean;
  fixedLimit?: boolean;
  mode?: 'cash' | 'tournament';
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroId = params.heroId ?? 'hero-ft-priced';
  const villainId = params.villainId ?? 'villain-ft-priced';
  const pot = params.pot ?? 60;
  const heroStack = params.heroStack ?? 220;
  const villainStack = params.villainStack ?? 220;
  const bb = params.bigBlind ?? 2;
  const ip = params.inPosition ?? true;
  const heroSeat = ip ? 1 : 2;
  const villainSeat = ip ? 2 : 1;
  const dealerSeat = 1;

  const hero: SeatPlayer = {
    seat: heroSeat,
    user_id: heroId,
    username: heroId,
    stack: heroStack,
    bet: 0,
    totalInvested: pot / 2,
    cards: cards(params.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const facingBetAmount = params.facingBetAmount ?? 0;
  const villain: SeatPlayer = {
    seat: villainSeat,
    user_id: villainId,
    username: villainId,
    stack: Math.max(0, villainStack - facingBetAmount),
    bet: facingBetAmount,
    totalInvested: pot / 2 + facingBetAmount,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const players: SeatPlayer[] = [hero, villain];
  const extras = params.extraOpponents ?? 0;
  for (let i = 0; i < extras; i++) {
    players.push({
      seat: 3 + i,
      user_id: `extra-ft-${i}`,
      username: `extra-ft-${i}`,
      stack: villainStack,
      bet: 0,
      totalInvested: pot / 3,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    });
  }

  const line = params.line ?? (params.street === 'flop' ? 'cbet' : 'barrel');
  const history: ActionRecord[] = [];
  if (line === 'cbet') {
    history.push(
      {
        seat: heroSeat,
        userId: heroId,
        action: 'raise',
        amount: 6,
        stage: 'preflop',
        timestamp: 1,
      },
      {
        seat: villainSeat,
        userId: villainId,
        action: 'call',
        amount: 6,
        stage: 'preflop',
        timestamp: 2,
      }
    );
    if (ip) {
      history.push({
        seat: villainSeat,
        userId: villainId,
        action: 'check',
        amount: 0,
        stage: 'flop',
        timestamp: 3,
      });
    }
  } else if (line === 'barrel') {
    history.push(
      {
        seat: heroSeat,
        userId: heroId,
        action: 'raise',
        amount: 6,
        stage: 'preflop',
        timestamp: 1,
      },
      {
        seat: villainSeat,
        userId: villainId,
        action: 'call',
        amount: 6,
        stage: 'preflop',
        timestamp: 2,
      },
      { seat: heroSeat, userId: heroId, action: 'bet', amount: 18, stage: 'flop', timestamp: 3 },
      {
        seat: villainSeat,
        userId: villainId,
        action: 'call',
        amount: 18,
        stage: 'flop',
        timestamp: 4,
      }
    );
    if (ip) {
      history.push({
        seat: villainSeat,
        userId: villainId,
        action: 'check',
        amount: 0,
        stage: 'turn',
        timestamp: 5,
      });
    }
  } else if (line === 'delayed') {
    history.push(
      {
        seat: heroSeat,
        userId: heroId,
        action: 'raise',
        amount: 6,
        stage: 'preflop',
        timestamp: 1,
      },
      {
        seat: villainSeat,
        userId: villainId,
        action: 'call',
        amount: 6,
        stage: 'preflop',
        timestamp: 2,
      },
      {
        seat: villainSeat,
        userId: villainId,
        action: 'check',
        amount: 0,
        stage: 'flop',
        timestamp: 3,
      },
      { seat: heroSeat, userId: heroId, action: 'check', amount: 0, stage: 'flop', timestamp: 4 }
    );
    if (ip) {
      history.push({
        seat: villainSeat,
        userId: villainId,
        action: 'check',
        amount: 0,
        stage: 'turn',
        timestamp: 5,
      });
    }
  } else if (line === 'probe') {
    history.push(
      {
        seat: villainSeat,
        userId: villainId,
        action: 'raise',
        amount: 6,
        stage: 'preflop',
        timestamp: 1,
      },
      { seat: heroSeat, userId: heroId, action: 'call', amount: 6, stage: 'preflop', timestamp: 2 },
      { seat: heroSeat, userId: heroId, action: 'check', amount: 0, stage: 'flop', timestamp: 3 },
      {
        seat: villainSeat,
        userId: villainId,
        action: 'check',
        amount: 0,
        stage: 'flop',
        timestamp: 4,
      }
    );
  } else if (line === 'stab') {
    history.push(
      {
        seat: villainSeat,
        userId: villainId,
        action: 'raise',
        amount: 6,
        stage: 'preflop',
        timestamp: 1,
      },
      { seat: heroSeat, userId: heroId, action: 'call', amount: 6, stage: 'preflop', timestamp: 2 }
    );
    if (params.street === 'flop') {
      history.push({
        seat: villainSeat,
        userId: villainId,
        action: 'check',
        amount: 0,
        stage: 'flop',
        timestamp: 3,
      });
    } else {
      history.push(
        {
          seat: villainSeat,
          userId: villainId,
          action: 'bet',
          amount: 16,
          stage: 'flop',
          timestamp: 3,
        },
        { seat: heroSeat, userId: heroId, action: 'call', amount: 16, stage: 'flop', timestamp: 4 },
        {
          seat: villainSeat,
          userId: villainId,
          action: 'check',
          amount: 0,
          stage: 'turn',
          timestamp: 5,
        }
      );
    }
  }

  if (facingBetAmount > 0) {
    history.push({
      seat: villainSeat,
      userId: villainId,
      action: 'bet',
      amount: facingBetAmount,
      stage: params.street,
      timestamp: 9,
    });
  }

  const variant = params.variant ?? 'nlh';
  const gs: HorseGameStateV2 = {
    gameVariant: variant,
    stage: params.street,
    communityCards: cards(params.board),
    pot: pot + facingBetAmount,
    currentBet: facingBetAmount,
    toCall: facingBetAmount,
    minRaise: facingBetAmount > 0 ? facingBetAmount * 2 : bb,
    minRaiseTo: facingBetAmount > 0 ? facingBetAmount * 2 : bb,
    maxRaiseTo: heroStack,
    bigBlind: bb,
    smallBlind: bb / 2,
    dealerSeat,
    players,
    actionHistory: history,
    legalActions:
      facingBetAmount > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    stateSchemaVersion: 1,
    bombPot: params.bombPot === true,
    allInOrFold: params.allInOrFold === true,
    ...(params.fixedLimit
      ? { bettingStructure: 'fixed_limit' as const, fixedBetSize: bb * 2 }
      : variant.startsWith('plo')
        ? { bettingStructure: 'pot_limit' as const }
        : { bettingStructure: 'no_limit' as const }),
    ...(params.multiBoard ? { communityCards2: cards('2c3d4h') } : {}),
    ...(params.mode === 'tournament'
      ? {
          isTournament: true,
          tournament: {
            nearBubble: false,
            inMoney: false,
          },
        }
      : {}),
  };
  return { hero, gs };
}

function seedStationProfile(userId: string) {
  HorseMind.importStats([
    {
      user_id: userId,
      hands: 300,
      vpip: 155,
      pfr: 28,
      threeBet: 4,
      aggr: 35,
      passive: 220,
      folds: 10,
      facedAggr: 120,
      riverBetOpps: 30,
      riverBetFolds: 3,
    },
  ]);
}

describe('LAW: holdemFlopTurnBluffIsPriced (dark default-OFF priced replacement for flopTurnBluffBaseline)', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
    HorseMind.reset();
  });

  afterEach(() => {
    drainFires();
    HorseMind.reset();
  });

  describe('1. Standalone deterministic module invariants & empirical curves', () => {
    const baseGate: HoldemFlopTurnBluffPricedGateInput = {
      enabled: true,
      isOmaha: false,
      isPotLimit: false,
      isHiLo: false,
      isShortDeck: false,
      isFixedLimit: false,
      holeCount: 2,
      holeCardCount: 2,
      street: 'flop',
      boardLength: 3,
      facingBet: false,
      multiBoard: false,
      bombPot: false,
      allInOrFold: false,
      satelliteActive: false,
      opponentsLive: 1,
      opponentsCanRespond: true,
      pot: 60,
      heroStack: 220,
      effectiveVillainStack: 220,
    };

    const baseInput: HoldemFlopTurnBluffPricedInput = {
      street: 'flop',
      pot: 60,
      heroStack: 220,
      effectiveVillainStack: 220,
      bigBlind: 2,
      equity: 0.38,
      line: 'cbet',
      selection: 'strongDraw',
      opponents: 1,
      inPosition: true,
      flopTexture: 'unpaired_nonmono',
      pairedBoard: false,
      threeFlushBoard: false,
      nutFlushDraw: true,
      rangeAdvantage: true,
      rangesFavorOpponent: false,
      scareUnblocked: false,
      callDeductionFraction: 0.04,
      icmRisk: 0,
      station: false,
      foldToCbet: null,
      bluffMod: 1,
    };

    it('strictly enforces single-board 2-card NLH unopened flop/turn gate and fails closed on every exclusion', () => {
      expect(holdemFlopTurnBluffIsPricedApplies(baseGate)).toBe(true);
      expect(
        holdemFlopTurnBluffIsPricedApplies({ ...baseGate, street: 'turn', boardLength: 4 })
      ).toBe(true);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, opponentsLive: 3 })).toBe(true);

      // Default OFF / non-boolean truthy refused
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, enabled: false })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, enabled: undefined })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, enabled: 1 })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, enabled: 'true' })).toBe(false);

      // Non-NLH variants & excluded modes refused
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, isOmaha: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, isPotLimit: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, isHiLo: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, isShortDeck: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, isFixedLimit: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, holeCount: 4 })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, holeCardCount: 5 })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, multiBoard: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, bombPot: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, allInOrFold: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, satelliteActive: true })).toBe(
        false
      );

      // River, facing-bet, and 4+ opponents refused
      expect(
        holdemFlopTurnBluffIsPricedApplies({ ...baseGate, street: 'river', boardLength: 5 })
      ).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, boardLength: 4 })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, facingBet: true })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, opponentsLive: 4 })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, opponentsCanRespond: false })).toBe(
        false
      );
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, pot: 0 })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, heroStack: 0 })).toBe(false);
      expect(holdemFlopTurnBluffIsPricedApplies({ ...baseGate, effectiveVillainStack: 0 })).toBe(
        false
      );
    });

    it('smoothly increases empirical flop and turn fold priors with bet size and reflects IP > OOP and texture', () => {
      for (const street of ['flop', 'turn'] as const) {
        for (const ip of [true, false]) {
          const rates = HOLDEM_FLOP_TURN_BLUFF_CANDIDATE_FRACS.map((f) =>
            holdemEmpiricalFlopTurnSmoothFoldPrior({
              street,
              bettorInPosition: ip,
              potFraction: f,
              texture: 'unpaired_nonmono',
              spr: 8,
            })
          );
          for (let i = 1; i < rates.length; i++) {
            expect(rates[i]).toBeGreaterThan(rates[i - 1]);
          }
        }
        // IP bets fold villains strictly more than OOP bets at every size
        for (const f of HOLDEM_FLOP_TURN_BLUFF_CANDIDATE_FRACS) {
          const ipR = holdemEmpiricalFlopTurnSmoothFoldPrior({
            street,
            bettorInPosition: true,
            potFraction: f,
          });
          const oopR = holdemEmpiricalFlopTurnSmoothFoldPrior({
            street,
            bettorInPosition: false,
            potFraction: f,
          });
          expect(ipR).toBeGreaterThan(oopR);
        }
      }
      // Flop texture ordering: paired > unpaired_nonmono > mono
      const paired = holdemEmpiricalFlopTurnSmoothFoldPrior({
        street: 'flop',
        bettorInPosition: true,
        potFraction: 0.33,
        texture: 'paired',
      });
      const normal = holdemEmpiricalFlopTurnSmoothFoldPrior({
        street: 'flop',
        bettorInPosition: true,
        potFraction: 0.33,
        texture: 'unpaired_nonmono',
      });
      const mono = holdemEmpiricalFlopTurnSmoothFoldPrior({
        street: 'flop',
        bettorInPosition: true,
        potFraction: 0.33,
        texture: 'mono',
      });
      expect(paired).toBeGreaterThan(normal);
      expect(normal).toBeGreaterThan(mono);

      // Texture classifier checks
      expect(classifyHoldemFlopTexture(cards('Kh9h2h'))).toBe('mono');
      expect(classifyHoldemFlopTexture(cards('KdKc7s'))).toBe('paired');
      expect(classifyHoldemFlopTexture(cards('Kd9c4s'))).toBe('unpaired_nonmono');
    });

    it('applies selection-bias surplus retention, multiway compounding discount, and station fold cap', () => {
      // Multiway discount strictly lowers all-fold probability as opponents rise 1 -> 2 -> 3
      const hu = conditionHoldemFlopTurnBluffFoldProb(0.55, { ...baseInput, opponents: 1 });
      const threeWay = conditionHoldemFlopTurnBluffFoldProb(0.55, { ...baseInput, opponents: 2 });
      const fourWay = conditionHoldemFlopTurnBluffFoldProb(0.55, { ...baseInput, opponents: 3 });
      expect(hu.foldProb).toBeGreaterThan(threeWay.foldProb);
      expect(threeWay.foldProb).toBeGreaterThan(fourWay.foldProb);

      // Selection-bias retention keeps raw surplus discounted relative to raw empirical pool rate
      expect(HOLDEM_FLOP_TURN_BLUFF_SURPLUS_RETENTION).toBeGreaterThan(0);
      expect(HOLDEM_FLOP_TURN_BLUFF_SURPLUS_RETENTION).toBeLessThan(1);
      expect(hu.singleVillainFoldProb).toBeLessThan(hu.rawEmpiricalFoldProb + 0.08);

      // Station discipline caps single-villain fold probability cleanly
      const vsStation = conditionHoldemFlopTurnBluffFoldProb(0.75, {
        ...baseInput,
        station: true,
      });
      expect(vsStation.singleVillainFoldProb).toBeLessThanOrEqual(
        HOLDEM_FLOP_TURN_BLUFF_STATION_FOLD_CAP
      );
    });

    it('preserves strong-draw equity when called while heavily truncating bare air, and discounts future streets', () => {
      const strongDrawEq = computeHoldemFlopTurnEqWhenCalled(0.38, 0.45, 0.55, false, {
        street: 'flop',
        inPosition: true,
        selection: 'strongDraw',
        nutFlushDraw: true,
        opponents: 1,
      });
      const airEq = computeHoldemFlopTurnEqWhenCalled(0.38, 0.45, 0.55, false, {
        street: 'flop',
        inPosition: true,
        selection: 'blocker',
        nutFlushDraw: false,
        opponents: 1,
      });
      // Strong draw keeps substantial live-out equity when called; bare blocker loses far more
      expect(strongDrawEq).toBeGreaterThan(0.28);
      expect(strongDrawEq).toBeGreaterThan(airEq * 1.4);

      // All-in realizes full truncated equity (no future street pressure) > non-all-in
      const allInEq = computeHoldemFlopTurnEqWhenCalled(0.38, 0.45, 0.55, true, {
        street: 'flop',
        inPosition: true,
        selection: 'strongDraw',
        nutFlushDraw: true,
        opponents: 1,
      });
      expect(allInEq).toBeGreaterThan(strongDrawEq);

      // IP realizes more than OOP when called
      const oopEq = computeHoldemFlopTurnEqWhenCalled(0.38, 0.45, 0.55, false, {
        street: 'flop',
        inPosition: false,
        selection: 'strongDraw',
        nutFlushDraw: true,
        opponents: 1,
      });
      expect(strongDrawEq).toBeGreaterThan(oopEq);
    });

    it('prices strong IP flop/turn semi-bluffs to bet and checks air into calling stations & hostile OOP spots', () => {
      // Strong IP flop nut flush draw c-bet -> profitable priced semi-bluff bet
      const nfdVerdict = holdemFlopTurnBluffPricedVerdict(baseInput);
      expect(nfdVerdict.decision).toBe('bet');
      expect(nfdVerdict.isDraw).toBe(true);
      expect(nfdVerdict.betPotFrac).not.toBeNull();
      expect(nfdVerdict.bestNetEdge).toBeGreaterThan(0);
      expect(nfdVerdict.candidates.length).toBe(HOLDEM_FLOP_TURN_BLUFF_CANDIDATE_FRACS.length);

      // Air into a confirmed calling station -> deterministic check
      const stationAir = holdemFlopTurnBluffPricedVerdict({
        ...baseInput,
        equity: 0.14,
        selection: 'overcards',
        nutFlushDraw: false,
        rangeAdvantage: false,
        station: true,
      });
      expect(stationAir.decision).toBe('check');
      expect(stationAir.isDraw).toBe(false);

      // Hostile OOP turn barrel with bare blocker when ranges favor opponent & unblocked scare -> check
      const hostileTurn = holdemFlopTurnBluffPricedVerdict({
        ...baseInput,
        street: 'turn',
        line: 'barrel',
        inPosition: false,
        equity: 0.1,
        selection: 'blocker',
        nutFlushDraw: false,
        rangeAdvantage: false,
        rangesFavorOpponent: true,
        scareUnblocked: true,
      });
      expect(hostileTurn.decision).toBe('check');

      // Multiway 3-way weak OOP draw -> checks rather than donating
      const mwWeakDraw = holdemFlopTurnBluffPricedVerdict({
        ...baseInput,
        opponents: 2,
        inPosition: false,
        equity: 0.16,
        selection: 'weakDraw',
        nutFlushDraw: false,
        rangeAdvantage: false,
      });
      expect(mwWeakDraw.decision).toBe('check');

      // Severe tournament ICM withholds non-draw all-in bluff shoves
      const icmShallowAir = holdemFlopTurnBluffPricedVerdict({
        ...baseInput,
        heroStack: 35,
        effectiveVillainStack: 35,
        pot: 60,
        equity: 0.12,
        selection: 'blocker',
        nutFlushDraw: false,
        icmRisk: 0.08,
      });
      expect(icmShallowAir.isAllIn).toBe(false);
    });
  });

  describe('2. Strict OFF bit-identity across NLH cash/MTT and PLO4/PLO5', () => {
    it('changes zero decisions, zero telemetry fires, and zero PRNG draws when OFF (absent, false, or non-boolean)', () => {
      const spots = [
        buildFlopTurnSpot({
          variant: 'nlh',
          street: 'flop',
          hole: 'Ah5h',
          board: 'Kh9h2c',
          line: 'cbet',
          inPosition: true,
        }),
        buildFlopTurnSpot({
          variant: 'nlh',
          street: 'turn',
          hole: 'QdJd',
          board: 'Td9c2s4h',
          line: 'barrel',
          inPosition: true,
        }),
        buildFlopTurnSpot({
          variant: 'nlh',
          street: 'flop',
          hole: 'AsKd',
          board: '9c6h2d',
          line: 'cbet',
          inPosition: true,
          mode: 'tournament',
        }),
        buildFlopTurnSpot({
          variant: 'plo4',
          street: 'turn',
          hole: 'AhKhQcJd',
          board: 'Th9h2c4s',
          line: 'barrel',
          inPosition: true,
        }),
        buildFlopTurnSpot({
          variant: 'plo5',
          street: 'flop',
          hole: 'AhKhQcJd8s',
          board: 'Th9h2c',
          line: 'cbet',
          inPosition: true,
        }),
      ];

      for (const spot of spots) {
        // Warm up any one-time process-wide variant cache (e.g. Omaha reservoir init) before comparison.
        seedFastRandom(20261122);
        decideWithOpts(spot.hero, spot.gs, {});
        drainFires();

        const run = (opts: HorseDecideOpts) => {
          HorseMind.reset();
          drainFires();
          seedFastRandom(20261122);
          const decision = stripWallClock(decideWithOpts(spot.hero, spot.gs, opts));
          const fires = fireCounts();
          const nextRand = fastRandom();
          return { decision, fires, nextRand };
        };

        const absent = run({});
        const explicitFalse = run({ holdemFlopTurnBluffIsPriced: false });
        const nonBoolTruthy = run({
          holdemFlopTurnBluffIsPriced: 'true' as unknown as boolean,
        });

        expect(explicitFalse).toEqual(absent);
        expect(nonBoolTruthy).toEqual(absent);
        for (const r of Object.values(HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS)) {
          expect(absent.fires[r] ?? 0).toBe(0);
        }
      }
    });
  });

  describe('3. Live HorseLogic.decide end-to-end behavior, determinism, and independence', () => {
    it('fires deterministic priced semi-bluff bet receipts on NLH flop OESD across arbitrary PRNG seeds and independent of flopTurnBluffBaseline', () => {
      const { hero, gs } = buildFlopTurnSpot({
        variant: 'nlh',
        street: 'flop',
        hole: '9s8d',
        board: 'Th7c2s',
        line: 'cbet',
        inPosition: true,
        pot: 60,
        heroStack: 240,
        villainStack: 240,
      });

      const results = [101, 202, 303, 404, 505].map((seed) => {
        HorseMind.reset();
        drainFires();
        seedFastRandom(seed);
        const decision = decideWithOpts(hero, gs, {
          flopTurnBluffBaseline: false,
          holdemFlopTurnBluffIsPriced: true,
        });
        return { decision: stripWallClock(decision), fires: fireCounts() };
      });

      // Zero coin-flip checks across arbitrary PRNG seeds; every bet lands on the priced candidate grid.
      const legalGrid = new Set(
        HOLDEM_FLOP_TURN_BLUFF_CANDIDATE_FRACS.map((f) => Math.round(60 * f))
      );
      for (const r of results) {
        expect(r.decision.action).toBe('bet');
        expect(legalGrid.has(Math.round(r.decision.amount ?? -1))).toBe(true);
        expect(r.fires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.bet]).toBe(1);
        expect(r.fires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.semibluff]).toBe(1);
        expect(r.fires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.air] ?? 0).toBe(0);
      }

      // Exact zero PRNG consumption inside the standalone priced verdict function
      seedFastRandom(424242);
      const expectedNext = fastRandom();
      seedFastRandom(424242);
      const directVerdict = holdemFlopTurnBluffPricedVerdict({
        street: 'flop',
        pot: 60,
        heroStack: 240,
        effectiveVillainStack: 240,
        bigBlind: 2,
        equity: 0.35,
        line: 'cbet',
        selection: 'strongDraw',
        opponents: 1,
        inPosition: true,
        flopTexture: 'unpaired_nonmono',
        pairedBoard: false,
        threeFlushBoard: false,
        nutFlushDraw: false,
        rangeAdvantage: true,
        rangesFavorOpponent: false,
        scareUnblocked: false,
      });
      expect(directVerdict.decision).toBe('bet');
      expect(fastRandom()).toBe(expectedNext);

      // Identical outcome on the same seed whether flopTurnBluffBaseline is true or false
      HorseMind.reset();
      drainFires();
      seedFastRandom(101);
      const withBaselineOn = stripWallClock(
        decideWithOpts(hero, gs, {
          flopTurnBluffBaseline: true,
          holdemFlopTurnBluffIsPriced: true,
        })
      );
      expect(withBaselineOn.action).toBe(results[0].decision.action);
      expect(withBaselineOn.amount).toBe(results[0].decision.amount);
    });

    it('never mutates HorseMind.notePlan when the priced flop/turn bet is legalized to check (unplaceable bet)', () => {
      const { hero, gs } = buildFlopTurnSpot({
        variant: 'nlh',
        street: 'flop',
        hole: '9s8d',
        board: 'Th7c2s',
        line: 'cbet',
        inPosition: true,
        pot: 60,
        heroStack: 240,
        villainStack: 240,
      });
      // Force bet to be illegal so betSize legalizes to check (placedFtPriced === false).
      const illegalGs: HorseGameStateV2 = {
        ...gs,
        legalActions: ['check'],
      };
      const notePlanSpy = vi.spyOn(HorseMind, 'notePlan');
      try {
        HorseMind.reset();
        drainFires();
        seedFastRandom(101);
        const decision = decideWithOpts(hero, illegalGs, {
          flopTurnBluffBaseline: false,
          holdemFlopTurnBluffIsPriced: true,
        });
        const fires = fireCounts();
        expect(decision.action).toBe('check');
        expect(fires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.illegal]).toBe(1);
        expect(fires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.bet] ?? 0).toBe(0);
        expect(notePlanSpy).not.toHaveBeenCalled();
      } finally {
        notePlanSpy.mockRestore();
      }
    });

    it('fires deterministic priced air bet or station-check receipts cleanly on NLH turn overcards spots', () => {
      // Confirmed calling station with turn overcards -> deterministic check + station_check receipt
      const { hero, gs } = buildFlopTurnSpot({
        variant: 'nlh',
        street: 'turn',
        hole: 'AcQd',
        board: '8h5c2sJd',
        line: 'barrel',
        inPosition: true,
        villainId: 'station-villain-ft',
        pot: 60,
        heroStack: 240,
        villainStack: 240,
      });
      seedStationProfile('station-villain-ft');

      for (const seed of [11, 22, 33, 44]) {
        drainFires();
        seedFastRandom(seed);
        const decision = decideWithOpts(hero, gs, {
          flopTurnBluffBaseline: true,
          holdemFlopTurnBluffIsPriced: true,
        });
        const fires = fireCounts();
        expect(decision.action).toBe('check');
        expect(fires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.check]).toBe(1);
        expect(fires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.stationCheck]).toBe(1);
        expect(fires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.bet] ?? 0).toBe(0);
      }

      // Profitable IP flop c-bet with qualified air (overcards + backdoor on low dry flop)
      // against an unknown opponent -> deterministic priced air bet + air receipt
      const { hero: airHero, gs: airGs } = buildFlopTurnSpot({
        variant: 'nlh',
        street: 'flop',
        hole: 'QhJd',
        board: '8s4d2c',
        line: 'cbet',
        inPosition: true,
        pot: 60,
        heroStack: 240,
        villainStack: 240,
      });
      HorseMind.reset();
      drainFires();
      seedFastRandom(777);
      const unknownDecision = decideWithOpts(airHero, airGs, {
        flopTurnBluffBaseline: false,
        holdemFlopTurnBluffIsPriced: true,
      });
      const unknownFires = fireCounts();
      expect(unknownDecision.action).toBe('bet');
      expect(unknownFires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.bet]).toBe(1);
      expect(unknownFires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.air]).toBe(1);
      expect(unknownFires[HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS.semibluff] ?? 0).toBe(0);
    });
  });

  describe('4. Zero reach outside single-board 2-card NLH unopened flop/turn', () => {
    it('is 100% bit-identical to OFF on PLO4, PLO5, PLO6, Hi-Lo, Short Deck, Fixed Limit, multi-board, bomb pot, AoF, and facing-bet spots', () => {
      const excludedSpots: Array<{
        label: string;
        spot: { hero: SeatPlayer; gs: HorseGameStateV2 };
      }> = [
        {
          label: 'plo4',
          spot: buildFlopTurnSpot({
            variant: 'plo4',
            street: 'turn',
            hole: 'AhKhQcJd',
            board: 'Th9h2c4s',
            line: 'barrel',
          }),
        },
        {
          label: 'plo5',
          spot: buildFlopTurnSpot({
            variant: 'plo5',
            street: 'flop',
            hole: 'AhKhQcJd8s',
            board: 'Th9h2c',
            line: 'cbet',
          }),
        },
        {
          label: 'plo6',
          spot: buildFlopTurnSpot({
            variant: 'plo6',
            street: 'flop',
            hole: 'AhKhQcJd8s7c',
            board: 'Th9h2c',
            line: 'cbet',
          }),
        },
        {
          label: 'plo8_hilo',
          spot: buildFlopTurnSpot({
            variant: 'plo8',
            street: 'flop',
            hole: 'Ah2hKcQd',
            board: 'Th9h3c',
            line: 'cbet',
          }),
        },
        {
          label: 'short_deck',
          spot: buildFlopTurnSpot({
            variant: 'short_deck',
            street: 'flop',
            hole: 'AhQh',
            board: 'Kh9h7c',
            line: 'cbet',
          }),
        },
        {
          label: 'fixed_limit',
          spot: buildFlopTurnSpot({
            variant: 'flh',
            street: 'flop',
            hole: 'Ah5h',
            board: 'Kh9h2c',
            line: 'cbet',
            fixedLimit: true,
          }),
        },
        {
          label: 'multi_board',
          spot: buildFlopTurnSpot({
            variant: 'nlh',
            street: 'flop',
            hole: 'Ah5h',
            board: 'Kh9h2c',
            line: 'cbet',
            multiBoard: true,
          }),
        },
        {
          label: 'bomb_pot',
          spot: buildFlopTurnSpot({
            variant: 'nlh',
            street: 'flop',
            hole: 'Ah5h',
            board: 'Kh9h2c',
            line: 'cbet',
            bombPot: true,
          }),
        },
        {
          label: 'all_in_or_fold',
          spot: buildFlopTurnSpot({
            variant: 'nlh',
            street: 'flop',
            hole: 'Ah5h',
            board: 'Kh9h2c',
            line: 'cbet',
            allInOrFold: true,
          }),
        },
        {
          label: 'facing_bet_nlh',
          spot: buildFlopTurnSpot({
            variant: 'nlh',
            street: 'flop',
            hole: 'Ah5h',
            board: 'Kh9h2c',
            line: 'stab',
            facingBetAmount: 20,
          }),
        },
      ];

      for (const { label, spot } of excludedSpots) {
        // Warm up any one-time process-wide variant cache (e.g. Omaha reservoir init) before comparison.
        seedFastRandom(20261122);
        decideWithOpts(spot.hero, spot.gs, { holdemFlopTurnBluffIsPriced: false });
        drainFires();

        const run = (on: boolean) => {
          HorseMind.reset();
          drainFires();
          seedFastRandom(20261122);
          const decision = stripWallClock(
            decideWithOpts(spot.hero, spot.gs, { holdemFlopTurnBluffIsPriced: on })
          );
          const fires = fireCounts();
          const nextRand = fastRandom();
          return { decision, fires, nextRand };
        };

        const off = run(false);
        const on = run(true);
        expect(
          on,
          `${label} must remain bit-identical when holdemFlopTurnBluffIsPriced is ON`
        ).toEqual(off);
        for (const r of Object.values(HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS)) {
          expect(on.fires[r] ?? 0, `${label} must never emit ${r}`).toBe(0);
        }
      }
    });
  });

  describe('5. Dark registration, source isolation, and dev-only league cards', () => {
    it('is dark-refused in OPTION_SWITCH_REFUSED and mirrored in the CI postgres proof script', () => {
      expect(OPTION_SWITCH_REFUSED.holdemFlopTurnBluffIsPriced).toBeTruthy();
      const ciScript = readFileSync(
        resolve(REPO_ROOT, 'scripts/ci/test-horse-option-switch-evidence-postgres.sh'),
        'utf8'
      );
      const refusedLine = ciScript.split('\n').find((line) => line.startsWith("refused='"));
      expect(refusedLine).toBeDefined();
      expect(refusedLine).toContain('holdemFlopTurnBluffIsPriced');
    });

    it('is registered in HORSE_DATA_LEDGER (flag + all 6 receipts) and HORSE_REFERENCE_DECISION_SOURCE_REASONS', () => {
      const flagEntry = HORSE_DATA_LEDGER.find(
        (e) => e.kind === 'flag' && e.key === 'holdemFlopTurnBluffIsPriced'
      );
      expect(flagEntry).toBeDefined();
      expect(flagEntry?.note).toMatch(/default[- ]off/i);

      for (const receiptKey of Object.values(HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS)) {
        const entry = HORSE_DATA_LEDGER.find((e) => e.kind === 'receipt' && e.key === receiptKey);
        expect(entry, `missing ledger receipt ${receiptKey}`).toBeDefined();
      }

      expect(
        HORSE_REFERENCE_DECISION_SOURCE_REASONS['src/engine/HorseHoldemFlopTurnBluffIsPriced.ts']
      ).toBeTruthy();
    });

    it('declares cash6 and hu dev league cards in DEVELOPMENT_LEAGUE_CARDS and never in LEAGUE_MATCHUPS', () => {
      const expected = [
        'cash6_holdem_flop_turn_bluff_is_priced',
        'hu_holdem_flop_turn_bluff_is_priced',
      ];
      for (const cardName of expected) {
        const card = DEVELOPMENT_LEAGUE_CARDS.find((c) => c.name === cardName);
        expect(card, `missing dev card ${cardName}`).toBeDefined();
        expect(card?.variant).toBe('nlh');
        expect((card?.a as Record<string, unknown>)?.holdemFlopTurnBluffIsPriced).toBe(true);
        expect((card?.a as Record<string, unknown>)?.flopTurnBluffBaseline).toBe(true);
        expect((card?.b as Record<string, unknown>)?.holdemFlopTurnBluffIsPriced).toBeUndefined();
        expect((card?.b as Record<string, unknown>)?.flopTurnBluffBaseline).toBe(true);
        expect(LEAGUE_MATCHUPS.some((c) => c.name === cardName)).toBe(false);
      }
    });

    it('has zero fastRandom, zero Math.random, and zero opponentHud/ imports in the module source', () => {
      const src = readFileSync(
        resolve(REPO_ROOT, 'server/src/engine/HorseHoldemFlopTurnBluffIsPriced.ts'),
        'utf8'
      );
      // Strip block/line comments before checking for runtime calls or imports.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      expect(code).not.toMatch(/\bfastRandom\b/);
      expect(code).not.toMatch(/\bMath\.random\b/);
      expect(code).not.toMatch(/from\s+['"][^'"]*opponentHud/);
    });
  });
});
