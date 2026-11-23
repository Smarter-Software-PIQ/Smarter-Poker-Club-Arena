/**
 * LAW: holdemRiverBluffIsPriced (2026-11-22, Horse Switch lane, DARK / DEFAULT OFF).
 *
 * Proves every invariant of the dark default-OFF priced replacement for `riverBluffBaseline`
 * (A2, REVIEW-HOLDEM-OFFLIST-20261121.md §5, unopened / checked-to heads-up NLH river air bluffs):
 *  (a) Bit-identical when OFF (absent, false, or any non-boolean truthy value) across NLH cash/MTT
 *      and PLO4/PLO5 (decision, telemetry fires, and PRNG state).
 *  (b) Deterministic EV-driven candidate sizing (`0.33x`, `0.55x`, `0.75x`, `1.0x`, `1.25x` pot /
 *      stack cap) vs `EV(check)` when ON, backed by `estimateHoldemRiverFoldToBet`, blocker /
 *      unblocker / board-scare / line conditioning, risk-calibrated margin, and calling-station
 *      discipline — independent of `riverBluffBaseline`, with clean
 *      `holdem_river_bluff_priced_*_seen` receipts.
 *  (c) Zero `fastRandom` coin flips on the priced path: identical spot inputs yield the exact same
 *      bet-or-check decision and size across arbitrary PRNG seeds.
 *  (d) Strict NLH-only scope: PLO4, PLO5, PLO6, PLO8 Hi-Lo, Short Deck, Fixed Limit, multi-board,
 *      bomb pot, All-In-or-Fold, satellite-locked, multiway, river value hands, and facing-bet
 *      river spots are never hijacked and remain 100% bit-identical to OFF.
 *  (e) Dark registration & isolation: listed in `OPTION_SWITCH_REFUSED`, mirrored in
 *      `scripts/ci/test-horse-option-switch-evidence-postgres.sh`, registered in `HORSE_DATA_LEDGER`,
 *      `HORSE_REFERENCE_DECISION_SOURCE_REASONS`, and `DEVELOPMENT_LEAGUE_CARDS` (never
 *      `LEAGUE_MATCHUPS`), with zero import dependency on `opponentHud/`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import { HORSE_REFERENCE_DECISION_SOURCE_REASONS } from './HorseReferenceDecisionSources.js';
import { DEVELOPMENT_LEAGUE_CARDS, LEAGUE_MATCHUPS } from '../benchmark/HorseLeague.js';
import {
  HOLDEM_RIVER_BLUFF_CANDIDATE_FRACS,
  HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS,
  HOLDEM_RIVER_BLUFF_STATION_FOLD_CAP,
  conditionHoldemRiverBluffFoldProb,
  holdemRiverBluffIsPricedApplies,
  holdemRiverBluffPricedVerdict,
  type HoldemRiverBluffPricedGateInput,
  type HoldemRiverBluffPricedInput,
} from './HorseHoldemRiverBluffIsPriced.js';
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

function buildUnopenedRiverSpot(params: {
  variant?: string;
  hole: string;
  board: string;
  heroId?: string;
  villainId?: string;
  pot?: number;
  heroStack?: number;
  villainStack?: number;
  bigBlind?: number;
  inPosition?: boolean;
  line?: 'barrel' | 'checkedThrough' | 'opponentGaveUp' | 'leadBlank';
  extraOpponents?: number;
  bombPot?: boolean;
  multiBoard?: boolean;
  allInOrFold?: boolean;
  fixedLimit?: boolean;
  mode?: 'cash' | 'tournament';
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroId = params.heroId ?? 'hero-rb-priced';
  const villainId = params.villainId ?? 'villain-rb-priced';
  const pot = params.pot ?? 100;
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
  const villain: SeatPlayer = {
    seat: villainSeat,
    user_id: villainId,
    username: villainId,
    stack: villainStack,
    bet: 0,
    totalInvested: pot / 2,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const players: SeatPlayer[] = [hero, villain];
  for (let i = 0; i < (params.extraOpponents ?? 0); i++) {
    const id = `extra-opp-${i + 1}`;
    players.push({
      seat: 3 + i,
      user_id: id,
      username: id,
      stack: villainStack,
      bet: 0,
      totalInvested: pot / 3,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    });
  }

  let history: ActionRecord[];
  if (params.line === 'checkedThrough') {
    history = [
      {
        stage: 'preflop',
        seat: 1,
        userId: ip ? heroId : villainId,
        action: 'raise',
        amount: 6,
        timestamp: 1,
      },
      {
        stage: 'preflop',
        seat: 2,
        userId: ip ? villainId : heroId,
        action: 'call',
        amount: 4,
        timestamp: 2,
      },
      {
        stage: 'flop',
        seat: 2,
        userId: ip ? villainId : heroId,
        action: 'check',
        amount: 0,
        timestamp: 3,
      },
      {
        stage: 'flop',
        seat: 1,
        userId: ip ? heroId : villainId,
        action: 'check',
        amount: 0,
        timestamp: 4,
      },
      {
        stage: 'turn',
        seat: 2,
        userId: ip ? villainId : heroId,
        action: 'check',
        amount: 0,
        timestamp: 5,
      },
      {
        stage: 'turn',
        seat: 1,
        userId: ip ? heroId : villainId,
        action: 'check',
        amount: 0,
        timestamp: 6,
      },
      ...(ip
        ? [
            {
              stage: 'river' as const,
              seat: 2,
              userId: villainId,
              action: 'check' as const,
              amount: 0,
              timestamp: 7,
            },
          ]
        : []),
    ];
  } else if (params.line === 'opponentGaveUp') {
    history = [
      { stage: 'preflop', seat: 1, userId: heroId, action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 2, userId: villainId, action: 'call', amount: 4, timestamp: 2 },
      { stage: 'flop', seat: 2, userId: villainId, action: 'bet', amount: 12, timestamp: 3 },
      { stage: 'flop', seat: 1, userId: heroId, action: 'call', amount: 12, timestamp: 4 },
      { stage: 'turn', seat: 2, userId: villainId, action: 'bet', amount: 28, timestamp: 5 },
      { stage: 'turn', seat: 1, userId: heroId, action: 'call', amount: 28, timestamp: 6 },
      { stage: 'river', seat: 2, userId: villainId, action: 'check', amount: 0, timestamp: 7 },
    ];
  } else if (params.line === 'leadBlank') {
    history = [
      { stage: 'preflop', seat: 1, userId: villainId, action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 2, userId: heroId, action: 'call', amount: 4, timestamp: 2 },
      { stage: 'flop', seat: 2, userId: heroId, action: 'check', amount: 0, timestamp: 3 },
      { stage: 'flop', seat: 1, userId: villainId, action: 'bet', amount: 12, timestamp: 4 },
      { stage: 'flop', seat: 2, userId: heroId, action: 'call', amount: 12, timestamp: 5 },
      { stage: 'turn', seat: 2, userId: heroId, action: 'check', amount: 0, timestamp: 6 },
      { stage: 'turn', seat: 1, userId: villainId, action: 'bet', amount: 28, timestamp: 7 },
      { stage: 'turn', seat: 2, userId: heroId, action: 'call', amount: 28, timestamp: 8 },
    ];
  } else {
    // Hero barrelled flop + turn and villain called; river checked to hero (or hero first OOP).
    history = [
      {
        stage: 'preflop',
        seat: 1,
        userId: ip ? heroId : villainId,
        action: 'raise',
        amount: 6,
        timestamp: 1,
      },
      {
        stage: 'preflop',
        seat: 2,
        userId: ip ? villainId : heroId,
        action: 'call',
        amount: 4,
        timestamp: 2,
      },
      ...(ip
        ? [
            {
              stage: 'flop' as const,
              seat: 2,
              userId: villainId,
              action: 'check' as const,
              amount: 0,
              timestamp: 3,
            },
          ]
        : []),
      { stage: 'flop', seat: heroSeat, userId: heroId, action: 'bet', amount: 14, timestamp: 4 },
      {
        stage: 'flop',
        seat: villainSeat,
        userId: villainId,
        action: 'call',
        amount: 14,
        timestamp: 5,
      },
      ...(ip
        ? [
            {
              stage: 'turn' as const,
              seat: 2,
              userId: villainId,
              action: 'check' as const,
              amount: 0,
              timestamp: 6,
            },
          ]
        : []),
      { stage: 'turn', seat: heroSeat, userId: heroId, action: 'bet', amount: 30, timestamp: 7 },
      {
        stage: 'turn',
        seat: villainSeat,
        userId: villainId,
        action: 'call',
        amount: 30,
        timestamp: 8,
      },
      ...(ip
        ? [
            {
              stage: 'river' as const,
              seat: 2,
              userId: villainId,
              action: 'check' as const,
              amount: 0,
              timestamp: 9,
            },
          ]
        : []),
    ];
  }

  const gs: HorseGameStateV2 = {
    gameVariant: params.variant ?? 'nlh',
    stage: 'river',
    pot,
    currentBet: 0,
    toCall: 0,
    bigBlind: bb,
    smallBlind: bb / 2,
    dealerSeat,
    communityCards: cards(params.board),
    ...(params.multiBoard ? { communityCards2: cards('2c3d4h7s9c') } : {}),
    players,
    actionHistory: history,
    legalActions: ['check', 'bet', 'all_in'],
    minRaise: bb,
    minRaiseTo: bb,
    maxRaiseTo: heroStack,
    stateSchemaVersion: 1,
    bombPot: params.bombPot === true,
    allInOrFold: params.allInOrFold === true,
    ...(params.fixedLimit
      ? { bettingStructure: 'fixed_limit' as const, fixedBetSize: bb * 2 }
      : {}),
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

function seedStationOpponent(opponentId: string): void {
  // Record enough river calls (3 folds in 30 river bets => 10% river fold rate) so HorseMind
  // classifies the opponent as a calling station via riverFoldRate < 0.35.
  HorseMind.importStats([
    {
      user_id: opponentId,
      hands: 300,
      vpip: 140,
      pfr: 30,
      threeBet: 5,
      aggr: 40,
      passive: 200,
      folds: 12,
      facedAggr: 120,
      riverBetOpps: 30,
      riverBetFolds: 3,
    },
  ]);
}

describe('LAW: holdemRiverBluffIsPriced (dark default-OFF priced river bluff replacement)', () => {
  beforeEach(() => {
    HorseMind.reset();
    enableBrainTelemetry();
    drainFires();
  });

  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  describe('(a) Dark default-OFF bit-identity', () => {
    it('absent, false, and non-boolean truthy values produce bit-identical decisions, fires, and PRNG draws', () => {
      const scenarios = [
        // NLH cash barrel air with nut flush blocker on 3-spade river
        buildUnopenedRiverSpot({
          variant: 'nlh',
          hole: 'As2c',
          board: 'KsQsTs9d4c',
          line: 'barrel',
        }),
        // NLH MTT checked-through missed draw
        buildUnopenedRiverSpot({
          variant: 'nlh',
          hole: '8h7h',
          board: 'Kd6h5hTc2s',
          line: 'checkedThrough',
          mode: 'tournament',
        }),
        // PLO4 cash river air
        buildUnopenedRiverSpot({
          variant: 'plo4',
          hole: 'As6c5d4c',
          board: 'Ks9s2sJd7h',
          line: 'barrel',
        }),
        // PLO5 cash river air
        buildUnopenedRiverSpot({
          variant: 'plo5',
          hole: 'As6c5d4c3d',
          board: 'Ks9s2sJd7h',
          line: 'barrel',
        }),
      ];

      for (const { hero, gs } of scenarios) {
        // Warm up any one-time process-wide variant cache (e.g. Omaha reservoir init) before comparison.
        HorseMind.reset();
        seedFastRandom(20261122);
        decideWithOpts(hero, gs, {});
        drainFires();

        const run = (opts: HorseDecideOpts) => {
          HorseMind.reset();
          seedFastRandom(20261122);
          drainFires();
          const decision = stripWallClock(decideWithOpts(hero, gs, opts));
          const fires = fireCounts();
          const nextRng = fastRandom();
          return { decision, fires, nextRng };
        };

        const base = run({});
        expect(run({ holdemRiverBluffIsPriced: false })).toEqual(base);
        expect(run({ holdemRiverBluffIsPriced: 1 as unknown as boolean })).toEqual(base);
        expect(run({ holdemRiverBluffIsPriced: 'true' as unknown as boolean })).toEqual(base);
        expect(run({ holdemRiverBluffIsPriced: {} as unknown as boolean })).toEqual(base);

        // Zero priced receipts emitted when OFF.
        for (const receiptKey of Object.values(HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS)) {
          expect(base.fires[receiptKey] ?? 0).toBe(0);
        }
      }
    });
  });

  describe('(b) Strict fail-closed NLH-only structural gate', () => {
    const validGate: HoldemRiverBluffPricedGateInput = {
      enabled: true,
      isOmaha: false,
      isPotLimit: false,
      isHiLo: false,
      isShortDeck: false,
      isFixedLimit: false,
      holeCount: 2,
      holeCardCount: 2,
      boardLength: 5,
      isRiver: true,
      facingBet: false,
      multiBoard: false,
      bombPot: false,
      allInOrFold: false,
      satelliteActive: false,
      barrelOutlookRiverPending: false,
      opponentsLive: 1,
      opponentCanRespond: true,
      pot: 100,
      heroStack: 200,
      villainStack: 200,
    };

    it('admits single-board 2-card NLH heads-up unopened river only and rejects every other domain', () => {
      expect(holdemRiverBluffIsPricedApplies(validGate)).toBe(true);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, enabled: false })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, enabled: undefined })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, enabled: 1 })).toBe(false);
      expect(
        holdemRiverBluffIsPricedApplies({
          ...validGate,
          isOmaha: true,
          holeCount: 4,
          holeCardCount: 4,
        })
      ).toBe(false);
      expect(
        holdemRiverBluffIsPricedApplies({
          ...validGate,
          isOmaha: true,
          holeCount: 5,
          holeCardCount: 5,
        })
      ).toBe(false);
      expect(
        holdemRiverBluffIsPricedApplies({
          ...validGate,
          isOmaha: true,
          holeCount: 6,
          holeCardCount: 6,
        })
      ).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, isPotLimit: true })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, isHiLo: true })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, isShortDeck: true })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, isFixedLimit: true })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, multiBoard: true })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, bombPot: true })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, allInOrFold: true })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, satelliteActive: true })).toBe(false);
      expect(
        holdemRiverBluffIsPricedApplies({ ...validGate, barrelOutlookRiverPending: true })
      ).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, facingBet: true })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, isRiver: false })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, boardLength: 4 })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, opponentsLive: 2 })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, opponentCanRespond: false })).toBe(
        false
      );
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, heroStack: 0 })).toBe(false);
      expect(holdemRiverBluffIsPricedApplies({ ...validGate, villainStack: 0 })).toBe(false);
    });

    it('leaves PLO4, PLO5, PLO6, PLO8, Short Deck, Fixed Limit, multi-board, bomb pot, AoF, and multiway NLH bit-identical even with flag ON', () => {
      const nonNlhSpots = [
        buildUnopenedRiverSpot({ variant: 'plo4', hole: 'As6c5d4c', board: 'Ks9s2sJd7h' }),
        buildUnopenedRiverSpot({ variant: 'plo5', hole: 'As6c5d4c3d', board: 'Ks9s2sJd7h' }),
        buildUnopenedRiverSpot({ variant: 'plo6', hole: 'As6c5d4c3d2d', board: 'Ks9s2sJd7h' }),
        buildUnopenedRiverSpot({ variant: 'plo8', hole: 'As6c5d4c', board: 'Ks9s2s3d7h' }),
        buildUnopenedRiverSpot({ variant: 'short_deck', hole: 'As9c', board: 'KsQsTs8d7h' }),
        buildUnopenedRiverSpot({
          variant: 'nlh',
          hole: 'As6c',
          board: 'Ks9s4s7d2h',
          fixedLimit: true,
        }),
        buildUnopenedRiverSpot({
          variant: 'nlh',
          hole: 'As6c',
          board: 'Ks9s4s7d2h',
          multiBoard: true,
        }),
        buildUnopenedRiverSpot({
          variant: 'nlh',
          hole: 'As6c',
          board: 'Ks9s4s7d2h',
          bombPot: true,
        }),
        buildUnopenedRiverSpot({
          variant: 'nlh',
          hole: 'As6c',
          board: 'Ks9s4s7d2h',
          allInOrFold: true,
        }),
        buildUnopenedRiverSpot({
          variant: 'nlh',
          hole: 'As6c',
          board: 'Ks9s4s7d2h',
          extraOpponents: 1,
        }),
      ];

      for (const { hero, gs } of nonNlhSpots) {
        // Warm up one-time process-wide variant caches (e.g. Omaha reservoir) before comparing.
        HorseMind.reset();
        seedFastRandom(77777);
        decideWithOpts(hero, gs, { holdemRiverBluffIsPriced: false });
        drainFires();

        const run = (opts: HorseDecideOpts) => {
          HorseMind.reset();
          seedFastRandom(77777);
          drainFires();
          const decision = stripWallClock(decideWithOpts(hero, gs, opts));
          const fires = fireCounts();
          const nextRng = fastRandom();
          return { decision, fires, nextRng };
        };
        const off = run({ holdemRiverBluffIsPriced: false });
        const on = run({ holdemRiverBluffIsPriced: true });
        expect(on).toEqual(off);
        for (const receiptKey of Object.values(HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS)) {
          expect(on.fires[receiptKey] ?? 0).toBe(0);
        }
      }
    });
  });

  describe('(c) Pure EV pricing, sizing discrimination, and zero-randomness invariants', () => {
    const baseInput: HoldemRiverBluffPricedInput = {
      pot: 100,
      heroStack: 250,
      villainStack: 250,
      bigBlind: 2,
      showdownEquity: 0.05,
      line: 'barrel',
      selection: 'blockerAndDraw',
      nutBlocker: true,
      unblocker: false,
      missedDraw: true,
      scareCard: true,
      riverHelpsHero: true,
      rangesFavorOpponent: false,
      calledBarrels: 1,
      callDeductionFraction: 0,
      icmRisk: 0,
      station: false,
    };

    it('evaluates all 5 canonical candidate fractions deep-stacked and caps cleanly at effective stack all-in when shallow', () => {
      const deep = holdemRiverBluffPricedVerdict(baseInput);
      expect(deep.candidates.map((c) => c.targetPotFrac)).toEqual([
        ...HOLDEM_RIVER_BLUFF_CANDIDATE_FRACS,
      ]);
      expect(deep.decision).toBe('bet');
      expect(deep.betPotFrac).toBeCloseTo(1.25, 6);
      expect(deep.isAllIn).toBe(false);
      expect(deep.evBestBluff).not.toBeNull();
      expect(deep.evBestBluff!).toBeGreaterThan(deep.evCheck + deep.bestRiskMargin!);

      // Shallow effective stack (60 into 100 pot): candidates >= 0.75x collapse to one 0.60x all-in.
      const shallow = holdemRiverBluffPricedVerdict({
        ...baseInput,
        heroStack: 60,
        villainStack: 200,
      });
      expect(shallow.decision).toBe('bet');
      expect(shallow.betAmount).toBeCloseTo(60, 6);
      expect(shallow.betPotFrac).toBeCloseTo(0.6, 6);
      expect(shallow.isAllIn).toBe(true);
      expect(shallow.candidates.some((c) => c.isAllIn && Math.abs(c.betAmount - 60) < 1e-4)).toBe(
        true
      );
    });

    it('chooses smaller sizes on capped/sticky spots and checks pure junk, high showdown equity, blank leads, and stations', () => {
      // Polar barrel with nut blocker + scare + range help => 1.25x overbet
      const polarOverbet = holdemRiverBluffPricedVerdict(baseInput);
      expect(polarOverbet.decision).toBe('bet');
      expect(polarOverbet.betPotFrac).toBeCloseTo(1.25, 6);

      // Opponent gave up IP with missed draw (no nut blocker) => sizes down to 0.75x
      const oppGaveUp = holdemRiverBluffPricedVerdict({
        ...baseInput,
        line: 'opponentGaveUp',
        selection: 'missedDraw',
        nutBlocker: false,
        scareCard: false,
        riverHelpsHero: false,
      });
      expect(oppGaveUp.decision).toBe('bet');
      expect(oppGaveUp.betPotFrac).toBeCloseTo(0.75, 6);

      // Sticky HUD opponent (`r.fBet`: 38% fold) with nut blocker + scare => sizes down to 0.55x
      const sticky = holdemRiverBluffPricedVerdict({
        ...baseInput,
        selection: 'blocker',
        missedDraw: false,
        riverHelpsHero: false,
        hudOpp: { eff: { 'r.fBet': [40, 14] } },
      });
      expect(sticky.decision).toBe('bet');
      expect(sticky.betPotFrac!).toBeLessThanOrEqual(0.75);

      // Pure junk on a barrel without unblocker/blocker/draw => deterministic CHECK
      const pureJunk = holdemRiverBluffPricedVerdict({
        ...baseInput,
        selection: 'junk',
        nutBlocker: false,
        missedDraw: false,
        scareCard: false,
        riverHelpsHero: false,
      });
      expect(pureJunk.decision).toBe('check');

      // Verified over-folder HUD (`r.fb.bg.hu` 85% fold) makes even junk a profitable priced bluff!
      const overFolderJunk = holdemRiverBluffPricedVerdict({
        ...baseInput,
        selection: 'junk',
        nutBlocker: false,
        missedDraw: false,
        scareCard: false,
        riverHelpsHero: false,
        hudOpp: { eff: { 'r.fb.bg.hu': [30, 26], 'r.fb.sm.hu': [30, 22] } },
      });
      expect(overFolderJunk.decision).toBe('bet');

      // High showdown equity (strong Ace-high at 0.23) => CHECK instead of turning showdown value into bluff
      const strongAceHigh = holdemRiverBluffPricedVerdict({
        ...baseInput,
        showdownEquity: 0.23,
        selection: 'missedDraw',
        nutBlocker: false,
        scareCard: false,
        riverHelpsHero: false,
      });
      expect(strongAceHigh.decision).toBe('check');

      // OOP donk lead on blank river into uncapped turn bettor => CHECK
      const blankLead = holdemRiverBluffPricedVerdict({
        ...baseInput,
        line: 'leadBlank',
        scareCard: false,
        riverHelpsHero: false,
      });
      expect(blankLead.decision).toBe('check');

      // Ranges favor opponent => CHECK
      const oppFavored = holdemRiverBluffPricedVerdict({
        ...baseInput,
        selection: 'missedDraw',
        nutBlocker: false,
        scareCard: false,
        riverHelpsHero: false,
        rangesFavorOpponent: true,
      });
      expect(oppFavored.decision).toBe('check');

      // Confirmed calling station => foldProb capped <= 0.24 and deterministic CHECK even with nut blocker + scare
      const stationCond = conditionHoldemRiverBluffFoldProb(1.0, {
        ...baseInput,
        station: true,
      });
      expect(stationCond.foldProb).toBeLessThanOrEqual(HOLDEM_RIVER_BLUFF_STATION_FOLD_CAP + 1e-9);
      const stationVerdict = holdemRiverBluffPricedVerdict({
        ...baseInput,
        station: true,
      });
      expect(stationVerdict.decision).toBe('check');
    });

    it('withholds all-in bluff shoves under severe tournament ICM survival pressure', () => {
      const cashShallow = holdemRiverBluffPricedVerdict({
        ...baseInput,
        heroStack: 60,
        villainStack: 200,
        icmRisk: 0,
      });
      expect(cashShallow.decision).toBe('bet');
      expect(cashShallow.isAllIn).toBe(true);

      const icmShallow = holdemRiverBluffPricedVerdict({
        ...baseInput,
        heroStack: 60,
        villainStack: 200,
        icmRisk: 0.08,
      });
      // Either sizes down to non-all-in (0.33x / 0.55x) or checks — never shoves all-in!
      expect(icmShallow.isAllIn).toBe(false);
    });
  });

  describe('(d) End-to-end HorseLogic.decide integration, determinism, and independence from riverBluffBaseline', () => {
    it('emits priced bet receipts deterministically across arbitrary PRNG seeds and works identically with riverBluffBaseline false', () => {
      // Hero holds As2c (nut flush blocker + air, equity < 0.25) on KsQsTs9d4c after barrelling flop & turn.
      const { hero, gs } = buildUnopenedRiverSpot({
        variant: 'nlh',
        hole: 'As2c',
        board: 'KsQsTs9d4c',
        line: 'barrel',
        inPosition: true,
      });

      const runWithSeed = (seed: number, opts: HorseDecideOpts) => {
        HorseMind.reset();
        seedFastRandom(seed);
        drainFires();
        const decision = stripWallClock(decideWithOpts(hero, gs, opts));
        const fires = fireCounts();
        return { decision, fires };
      };

      const r1 = runWithSeed(11111, { riverBluffBaseline: true, holdemRiverBluffIsPriced: true });
      const r2 = runWithSeed(99999, { riverBluffBaseline: true, holdemRiverBluffIsPriced: true });
      const r3 = runWithSeed(55555, { riverBluffBaseline: false, holdemRiverBluffIsPriced: true });

      expect(r1.decision.action).toBe('bet');
      // 100% deterministic action and amount across completely different PRNG seeds!
      expect(r2.decision.action).toBe(r1.decision.action);
      expect(r2.decision.amount).toBe(r1.decision.amount);
      // 100% independent of parent blanket flag `riverBluffBaseline: false`!
      expect(r3.decision.action).toBe(r1.decision.action);
      expect(r3.decision.amount).toBe(r1.decision.amount);

      expect(r1.fires[HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS.bet]).toBe(1);
      // Zero legacy river_bluff_baseline_* fires when priced option owns the spot.
      expect(r1.fires['river_bluff_baseline_check'] ?? 0).toBe(0);
      expect(r1.fires['river_bluff_baseline_blocker'] ?? 0).toBe(0);
      expect(r1.fires['river_bluff_baseline_blockerAndDraw'] ?? 0).toBe(0);
    });

    it('deterministically checks pure junk and calling stations, emitting priced check / station_check receipts', () => {
      // Pure junk on a checked-through dry river with no blocker/draw (4c3d on KhQd9s7c5h).
      const junkSpot = buildUnopenedRiverSpot({
        variant: 'nlh',
        hole: '4c3d',
        board: 'KhQd9s7c5h',
        line: 'checkedThrough',
        inPosition: true,
      });
      HorseMind.reset();
      seedFastRandom(20261122);
      drainFires();
      const junkDec = decideWithOpts(junkSpot.hero, junkSpot.gs, {
        riverBluffBaseline: true,
        holdemRiverBluffIsPriced: true,
      });
      const junkFires = fireCounts();
      expect(junkDec.action).toBe('check');
      expect(junkFires[HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS.check]).toBe(1);
      expect(junkFires[HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS.bet] ?? 0).toBe(0);

      // Same nut-blocker barrel spot against a seeded calling station => deterministic CHECK + station_check receipt
      const stationSpot = buildUnopenedRiverSpot({
        variant: 'nlh',
        hole: 'As2c',
        board: 'KsQsTs9d4c',
        line: 'barrel',
        inPosition: true,
        villainId: 'station-villain-rb',
      });
      HorseMind.reset();
      seedStationOpponent('station-villain-rb');
      seedFastRandom(20261122);
      drainFires();
      const stationDec = decideWithOpts(stationSpot.hero, stationSpot.gs, {
        riverBluffBaseline: true,
        holdemRiverBluffIsPriced: true,
      });
      const stationFires = fireCounts();
      expect(stationDec.action).toBe('check');
      expect(stationFires[HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS.check]).toBe(1);
      expect(stationFires[HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS.stationCheck]).toBe(1);
      expect(stationFires[HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS.bet] ?? 0).toBe(0);
    });

    it('never hijacks NLH river value hands (equity >= 0.25) or facing-bet river spots', () => {
      // River nut flush (AsQs on Ks9s4s7d2h): strong value hand, must NOT emit priced river bluff receipts!
      const valueSpot = buildUnopenedRiverSpot({
        variant: 'nlh',
        hole: 'AsQs',
        board: 'Ks9s4s7d2h',
        line: 'barrel',
        inPosition: true,
      });
      const run = (opts: HorseDecideOpts) => {
        HorseMind.reset();
        seedFastRandom(424242);
        drainFires();
        const decision = stripWallClock(decideWithOpts(valueSpot.hero, valueSpot.gs, opts));
        const fires = fireCounts();
        return { decision, fires };
      };
      const off = run({ holdemRiverBluffIsPriced: false });
      const on = run({ holdemRiverBluffIsPriced: true });
      expect(on).toEqual(off);
      for (const receiptKey of Object.values(HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS)) {
        expect(on.fires[receiptKey] ?? 0).toBe(0);
      }

      // Facing a river bet (toCall = 50): must NEVER emit priced river bluff receipts!
      const facingSpot = buildUnopenedRiverSpot({
        variant: 'nlh',
        hole: 'As6c',
        board: 'Ks9s4s7d2h',
        line: 'barrel',
        inPosition: true,
      });
      facingSpot.gs.toCall = 50;
      facingSpot.gs.currentBet = 50;
      facingSpot.gs.pot = 150;
      facingSpot.gs.legalActions = ['fold', 'call', 'raise', 'all_in'];
      facingSpot.gs.actionHistory = [
        ...(facingSpot.gs.actionHistory ?? []).filter((a) => a.stage !== 'river'),
        {
          stage: 'river',
          seat: 2,
          userId: 'villain-rb-priced',
          action: 'bet',
          amount: 50,
          timestamp: 10,
        },
      ];
      HorseMind.reset();
      seedFastRandom(424242);
      drainFires();
      const facingOff = stripWallClock(
        decideWithOpts(facingSpot.hero, facingSpot.gs, { holdemRiverBluffIsPriced: false })
      );
      const facingOffFires = fireCounts();

      HorseMind.reset();
      seedFastRandom(424242);
      drainFires();
      const facingOn = stripWallClock(
        decideWithOpts(facingSpot.hero, facingSpot.gs, { holdemRiverBluffIsPriced: true })
      );
      const facingOnFires = fireCounts();

      expect(facingOn).toEqual(facingOff);
      expect(facingOnFires).toEqual(facingOffFires);
    });
  });

  describe('(e) Dark registration, dev league cards, and zero opponentHud/ import coupling', () => {
    it('is dark in OPTION_SWITCH_REFUSED, mirrored in postgres CI proof, registered in ledger & reference sources, and has dev-only league cards', () => {
      expect(Object.hasOwn(OPTION_SWITCH_REFUSED, 'holdemRiverBluffIsPriced')).toBe(true);
      expect(OPTION_SWITCH_REFUSED.holdemRiverBluffIsPriced).toMatch(/pending registration/i);

      const pgScript = readFileSync(
        resolve(REPO_ROOT, 'scripts/ci/test-horse-option-switch-evidence-postgres.sh'),
        'utf8'
      );
      const refusedLine = pgScript.split('\n').find((line) => line.startsWith("refused='"));
      expect(refusedLine).toBeDefined();
      expect(refusedLine).toContain('holdemRiverBluffIsPriced');

      const ledgerFlag = HORSE_DATA_LEDGER.find(
        (e) => e.kind === 'flag' && e.key === 'holdemRiverBluffIsPriced'
      );
      expect(ledgerFlag).toBeDefined();
      expect(ledgerFlag!.note).toMatch(/default OFF/i);

      for (const key of Object.values(HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS)) {
        const entry = HORSE_DATA_LEDGER.find((e) => e.kind === 'receipt' && e.key === key);
        expect(entry, `missing ledger receipt ${key}`).toBeDefined();
      }

      expect(
        Object.hasOwn(
          HORSE_REFERENCE_DECISION_SOURCE_REASONS,
          'src/engine/HorseHoldemRiverBluffIsPriced.ts'
        )
      ).toBe(true);

      // Dev-only league cards in DEVELOPMENT_LEAGUE_CARDS, never LEAGUE_MATCHUPS.
      const devCardNames = [
        'cash6_holdem_river_bluff_is_priced',
        'hu_holdem_river_bluff_is_priced',
      ];
      for (const name of devCardNames) {
        const devCard = DEVELOPMENT_LEAGUE_CARDS.find((c) => c.name === name);
        expect(devCard, `missing dev card ${name}`).toBeDefined();
        expect(devCard!.a).toEqual({ riverBluffBaseline: true, holdemRiverBluffIsPriced: true });
        expect(devCard!.b).toEqual({ riverBluffBaseline: true });
        expect(LEAGUE_MATCHUPS.some((c) => c.name === name)).toBe(false);
      }

      // Zero import dependency on opponentHud/ and zero fastRandom/Math.random in executable code.
      const modSrc = readFileSync(resolve(THIS_DIR, 'HorseHoldemRiverBluffIsPriced.ts'), 'utf8');
      const codeOnly = modSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*opponentHud/i);
      expect(codeOnly).not.toMatch(/\bfastRandom\b|\bMath\.random\b/);
    });
  });
});
