/**
 * V86 HORSE PLO4 / PLO5 / PLO6 / PLO8 & CROSS-VARIANT ELITE OVERHAUL SUITE
 *
 * End-to-end deterministic verification covering:
 *  1. HorseHandClasses.omahaEliteClassRead, HorseEval.omahaElitePreflopStrength,
 *     and shortDeckElitePreflopStrength across 4/5/6-card Omaha, PLO8, and 6+.
 *  2. HorsePreflop, HorseLogic.decide, and live HorseDecisionWorkerRuntime
 *     (admitted candidate authority) across PLO 3-bets, squeezes, shallow 4-bets,
 *     limp isolation, 3-bettor continuation, PLO MTT aggression, NLH straddles,
 *     and polarized Ace-blocker 3-bet bluffs.
 *  3. Postflop & HorseOmahaBigBetCalls.v86OmahaUnderboatOrDominatedFold:
 *     underboat river folds, PLO6 big-bet river folds, multiway river folds,
 *     street-bet commitment exclusion, turn no-room-to-be-paid guard, OOP river
 *     block-bet nut traps, IP dry-flop nut check-backs, combo-draw Pump & Jam,
 *     PLO8 freeroll leads/raises, Double-Board dead-half folds & strong+redraw
 *     raises, 160bb+ NLH pot control, Short Deck / Pineapple shades, and
 *     computeThinkTime Hollywood tank with zero extra fastRandom() draws.
 *  4. Bully-Breaker Anti-LAG counter-system (HorseWinnerRead, HorseMind,
 *     maniacCallDown, HorseExploitHydrator, HorsePersona, HorseSessionRotator,
 *     HorseHandReview, HorseSelfTuner, HorseDataLedger).
 *  5. Multi-hand Horses vs WooWoo-archetype LAG (80% VPIP / 46% PFR / 66% Stab /
 *     48% Turn Barrel) simulation benchmark across PLO4, PLO5, PLO6, PLO8, and
 *     Double-Board Bomb Pots.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handClassRead, omahaEliteClassRead } from './HorseHandClasses.js';
import {
  fastRandom,
  holdemPreflopScore,
  omahaBoatPosition,
  omahaElitePreflopStrength,
  omahaPreflopStrength,
  restoreFastRandom,
  saveFastRandom,
  seedFastRandom,
  shortDeckElitePreflopStrength,
} from './HorseEval.js';
import { decidePreflopV7, type PreflopCtx } from './HorsePreflop.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { v86OmahaUnderboatOrDominatedFold } from './HorseOmahaBigBetCalls.js';
import {
  WINNER_BLUFF_MOD,
  WINNER_LAG_VALUE_THIN_FLOOR,
  WINNER_VALUE_THIN_MOD,
  isProvenWinner,
  observeHandResults,
  resetWinnerReads,
  respectWinner,
  winnerReadScopeOf,
  winnerReadout,
} from './HorseWinnerRead.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { aggressiveBettorPressure, aggressiveOpenerPressure } from './HorseOpponentExploit.js';
import { defaultPersonaFor, ploPersonaFor } from './HorsePersona.js';
import { HORSE_DATA_LEDGER, TAG_CONSUMERS } from './HorseDataLedger.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  defaultHorseDecisionWorkerDependencies,
  HorseDecisionWorkerRuntime,
} from './horseDecision/workerRuntime.js';
import { HorseObserverReads } from './horseDecision/observerReads.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  buildHorseDecisionKey,
  type FastHorseDecisionRequest,
  type HorseDecisionWorkerResponse,
  type ObserveCompletedHandRequest,
} from './horseDecision/protocol.js';
import { liveHorsePhase8Authority } from './HorseQualifiedAuthority.js';
import { liveHorsePhase8GuardAuthority } from './HorseTournamentCatastropheGuardAuthority.js';
import { liveHorsePhase10Authority } from './HorsePhase10Authority.js';
import { liveHorsePhase11Authorities } from './HorsePhase11Authority.js';
import { liveHorsePhase12Authorities } from './HorsePhase12Authority.js';
import { liveHorsePhase13Authorities } from './HorsePhase13Authority.js';
import { liveHorsePhase14Authorities } from './HorsePhase14Authority.js';
import { liveHorseFeatureAuthority } from './HorseFeatureAuthority.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { HandController } from './HandController.js';
import { controllerDecisionState } from './remainingVariants/RemainingVariantControllerSpots.test-support.js';
import { applyTableCommitmentCap } from './ServerTableEngineTurns.js';
import { captureHorseHandJournalContext } from './HorseDecisionHandBinding.js';
import { hydrateHorseExploitReads } from '../services/HorseExploitHydrator.js';
import { buildReviewRows, detectLeaks } from '../services/HorseHandReview.js';
import { freshPlay, type PlayStats } from '../services/HorsePlayStats.js';
import {
  OMAHA_CASH_VPIP_HI,
  computeCashOmahaShare,
  diagnoseAndNudge,
  subtractTournamentLeaks,
} from '../services/HorseSelfTuner.js';
import { bankrollPolicyFor, referenceBuyIn, topUpAllowance } from '../services/HorseBankroll.js';
import { HorseSessionRotator, type RotatorEngine } from '../services/HorseSessionRotator.js';
import { supabase } from '../services/supabase.js';
import { mulberry32 } from './HandFuzzer.js';
import type { ActionRecord, Card, CardRank, CardSuit, HandConfig, SeatPlayer } from '../types.js';

const SUIT_MAP: Record<string, CardSuit> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};

function cards(spec: string): Card[] {
  const clean = spec.replace(/\s+/g, '');
  const out: Card[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const r = clean[i] as CardRank;
    const s = SUIT_MAP[clean[i + 1]];
    if (!s) throw new Error(`Invalid card suit in ${spec}`);
    out.push({ rank: r, suit: s });
  }
  return out;
}

function makeSeat(
  seat: number,
  userId: string,
  hole: string,
  over: Partial<SeatPlayer> = {}
): SeatPlayer {
  return {
    seat,
    user_id: userId,
    username: `P${seat}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
    ...over,
  } as SeatPlayer;
}

function findHorseWithArchetype(
  target: 'lag_shark' | 'tricky_trap' | 'tag_crusher' | 'nit_hunter'
): string {
  for (let i = 1; i <= 500; i++) {
    const id = `86000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    if (ploPersonaFor(id).archetype === target) return id;
  }
  throw new Error(`No Horse found for archetype ${target}`);
}

const LAG_SHARK_HORSE = findHorseWithArchetype('lag_shark');
const TRICKY_TRAP_HORSE = findHorseWithArchetype('tricky_trap');
const TAG_CRUSHER_HORSE = findHorseWithArchetype('tag_crusher');
const NIT_HUNTER_HORSE = findHorseWithArchetype('nit_hunter');
const WOOWOO_ID = '99000000-0000-4000-8000-000000000086';
const TAG_WINNER_ID = '99000000-0000-4000-8000-000000000087';

/**
 * Feeds realistic multi-street completed hands into HorseMind so `userId`
 * acquires a verified WooWoo-archetype LAG profile:
 * ~80% VPIP, ~46% PFR, ~66% flop stab when checked to, ~48% turn barrel.
 */
function trainWooWooProfile(userId: string, variant = 'plo4', tableSeats = 6, hands = 60): void {
  const scope = readScopeOf(variant, tableSeats);
  const peers = Array.from(
    { length: tableSeats - 1 },
    (_, i) => `77000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
  );
  for (let h = 0; h < hands; h++) {
    const acts: ActionRecord[] = [];
    const roll = h % 50;
    if (roll < 23) {
      // 46% PFR
      acts.push(
        {
          stage: 'preflop',
          seat: 3,
          userId,
          action: 'raise',
          amount: 7,
          isFullRaise: true,
          origin: 'player',
          timestamp: h * 20 + 3,
        },
        {
          stage: 'preflop',
          seat: 2,
          userId: peers[1],
          action: 'call',
          amount: 5,
          origin: 'horse_policy',
          timestamp: h * 20 + 4,
        }
      );
    } else if (roll < 40) {
      // +34% call/limp -> 80% total VPIP
      acts.push(
        {
          stage: 'preflop',
          seat: 3,
          userId,
          action: 'call',
          amount: 2,
          origin: 'player',
          timestamp: h * 20 + 3,
        },
        {
          stage: 'preflop',
          seat: 2,
          userId: peers[1],
          action: 'check',
          amount: 0,
          origin: 'horse_policy',
          timestamp: h * 20 + 4,
        }
      );
    } else {
      acts.push({
        stage: 'preflop',
        seat: 3,
        userId,
        action: 'fold',
        amount: 0,
        origin: 'player',
        timestamp: h * 20 + 3,
      });
      HorseMind.observeHandComplete(`woowoo-train:${variant}:${h}`, acts, 2, null, scope);
      continue;
    }

    // Postflop: BB checks to WooWoo -> 66% flop stab (2 out of every 3 flops)
    acts.push({
      stage: 'flop',
      seat: 2,
      userId: peers[1],
      action: 'check',
      amount: 0,
      origin: 'horse_policy',
      timestamp: h * 20 + 5,
    });
    const stabsFlop = h % 3 !== 0;
    if (stabsFlop) {
      acts.push(
        {
          stage: 'flop',
          seat: 3,
          userId,
          action: 'bet',
          amount: 9,
          origin: 'player',
          timestamp: h * 20 + 6,
        },
        {
          stage: 'flop',
          seat: 2,
          userId: peers[1],
          action: 'call',
          amount: 9,
          origin: 'horse_policy',
          timestamp: h * 20 + 7,
        },
        {
          stage: 'turn',
          seat: 2,
          userId: peers[1],
          action: 'check',
          amount: 0,
          origin: 'horse_policy',
          timestamp: h * 20 + 8,
        }
      );
      // 48% turn barrel -> ~half the time barrels turn, half checks back (give-up)
      if (h % 2 === 0) {
        acts.push(
          {
            stage: 'turn',
            seat: 3,
            userId,
            action: 'bet',
            amount: 20,
            origin: 'player',
            timestamp: h * 20 + 9,
          },
          {
            stage: 'turn',
            seat: 2,
            userId: peers[1],
            action: 'fold',
            amount: 0,
            origin: 'horse_policy',
            timestamp: h * 20 + 10,
          }
        );
      } else {
        acts.push(
          {
            stage: 'turn',
            seat: 3,
            userId,
            action: 'check',
            amount: 0,
            origin: 'player',
            timestamp: h * 20 + 9,
          },
          {
            stage: 'river',
            seat: 2,
            userId: peers[1],
            action: 'bet',
            amount: 18,
            origin: 'horse_policy',
            timestamp: h * 20 + 10,
          },
          {
            stage: 'river',
            seat: 3,
            userId,
            action: 'fold',
            amount: 0,
            origin: 'player',
            timestamp: h * 20 + 11,
          }
        );
      }
    } else {
      acts.push({
        stage: 'flop',
        seat: 3,
        userId,
        action: 'check',
        amount: 0,
        origin: 'player',
        timestamp: h * 20 + 6,
      });
    }
    HorseMind.observeHandComplete(`woowoo-train:${variant}:${h}`, acts, 2, null, scope);
  }
  HorseMind.setDecisionScope(scope);
}

function trainProvenWinner(userId: string, hands = 1600, netPerHandBB = 1.5, bb = 2): void {
  for (let h = 0; h < hands; h++) {
    observeHandResults(`win:${userId}:${h}`, [{ user_id: userId, net: netPerHandBB * bb }], bb);
  }
}

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
  resetWinnerReads();
  HorseMind.reset();
  seedFastRandom(86_2026);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetWinnerReads();
  HorseMind.reset();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. HAND CLASSES & PREFLOP EVALUATION
// ═══════════════════════════════════════════════════════════════════════════
describe('V86 1. Omaha 4/5/6-card, PLO8, and Short Deck elite preflop classification & strength', () => {
  it('classifies 4/5/6-card double-suited rundowns and connected broadways as 3-bet / 4-bet / squeeze eligible', () => {
    const jt98ds = omahaEliteClassRead(cards('JcTc9h8h'));
    expect(jt98ds.cls).toBe('rundown_ds');
    expect(jt98ds.cleanSuits).toBe(2);
    expect(jt98ds.selfBlockedSuits).toBe(0);
    expect(jt98ds.canThreeBet).toBe(true);
    expect(jt98ds.canFourBetShallow).toBe(true);
    expect(jt98ds.canSqueeze).toBe(true);
    expect(jt98ds.shift.threeBet).toBeLessThan(0);

    const kqjtds = omahaEliteClassRead(cards('KsQsJdTd'));
    expect(kqjtds.cls).toBe('broadway_conn_ds');
    expect(kqjtds.hasKingSuit).toBe(true);
    expect(kqjtds.canThreeBet).toBe(true);
    expect(kqjtds.canFourBetShallow).toBe(true);
    expect(kqjtds.canSqueeze).toBe(true);

    const aqjtds = omahaEliteClassRead(cards('AsQsJdTd'));
    expect(aqjtds.cls).toBe('broadway_conn_ds');
    expect(aqjtds.hasNutAceSuit).toBe(true);
    expect(aqjtds.canThreeBet).toBe(true);
    expect(aqjtds.canFourBetShallow).toBe(true);

    // 5-card and 6-card double-suited rundowns
    const plo5Rundown = omahaEliteClassRead(cards('JcTc9h8h7d'));
    expect(plo5Rundown.cls).toBe('rundown_ds');
    expect(plo5Rundown.canThreeBet).toBe(true);
    expect(plo5Rundown.canFourBetShallow).toBe(true);

    const plo6Rundown = omahaEliteClassRead(cards('KsQsJdTd9c8c'));
    expect(plo6Rundown.cls).toBe('broadway_conn_ds');
    expect(plo6Rundown.cleanSuits).toBe(3);
    expect(plo6Rundown.canThreeBet).toBe(true);
    expect(plo6Rundown.canSqueeze).toBe(true);

    // Boosts elite strength relative to legacy percentile while keeping legacy untouched
    expect(omahaElitePreflopStrength(cards('JcTc9h8h'), false)).toBeGreaterThan(
      omahaPreflopStrength(cards('JcTc9h8h'), false) + 0.07
    );
  });

  it('classifies suited-Ax nut bridges and KKQQds while penalizing 3+-suit self-blockers and 5/6-card danglers', () => {
    const axBridge = omahaEliteClassRead(cards('As8sTd9c'));
    expect(axBridge.cls).toBe('ax_nut_suited');
    expect(axBridge.hasNutAceSuit).toBe(true);
    expect(axBridge.canThreeBet).toBe(true);
    expect(axBridge.canSqueeze).toBe(true);

    const kkqqds = omahaEliteClassRead(cards('KsQsKdQd'));
    expect(kkqqds.cls).toBe('kk_ds');
    expect(kkqqds.cleanSuits).toBe(2);
    expect(kkqqds.canThreeBet).toBe(true);
    expect(kkqqds.canFourBetShallow).toBe(true);
    expect(kkqqds.canSqueeze).toBe(true);

    // 3-of-a-suit and 4-of-a-suit self-blocker penalty vs clean double-suited equivalent
    const clean5 = cards('AsTsJd9d8c');
    const threeSuit5 = cards('AsTsJs9d8c');
    const fourSuit5 = cards('AsTsJs9s8d');
    expect(omahaEliteClassRead(threeSuit5).selfBlockedSuits).toBe(1);
    expect(omahaElitePreflopStrength(clean5, false)).toBeGreaterThan(
      omahaElitePreflopStrength(threeSuit5, false)
    );
    expect(omahaElitePreflopStrength(threeSuit5, false)).toBeGreaterThan(
      omahaElitePreflopStrength(fourSuit5, false)
    );

    // 5-card and 6-card disconnected dangler de-clustering
    const ragged5 = cards('KhJd8c4s2d');
    const ragged6 = cards('KhQd9c6s3c2c');
    expect(omahaElitePreflopStrength(ragged5, false)).toBeLessThan(
      omahaPreflopStrength(ragged5, false) - 0.03
    );
    expect(omahaElitePreflopStrength(ragged6, false)).toBeLessThan(
      omahaPreflopStrength(ragged6, false) - 0.04
    );
  });

  it('classifies PLO8 AA23ds / A2KQds two-way scoop monsters and Short Deck 6+ shape adjustments', () => {
    const aa23ds = omahaEliteClassRead(cards('As2sAh3h'), true);
    expect(aa23ds.cls).toBe('aa_ds');
    expect(aa23ds.canThreeBet).toBe(true);
    expect(aa23ds.canFourBetShallow).toBe(true);
    expect(aa23ds.canSqueeze).toBe(true);

    const a2kqds = omahaEliteClassRead(cards('As2sKdQd'), true);
    expect(a2kqds.cls).toBe('plo8_scoop');
    expect(a2kqds.canThreeBet).toBe(true);
    expect(a2kqds.canFourBetShallow).toBe(true);
    expect(a2kqds.canSqueeze).toBe(true);

    expect(omahaElitePreflopStrength(cards('As2sKdQd'), true)).toBe(1);
    expect(omahaElitePreflopStrength(cards('As2s8d7c'), true)).toBeGreaterThan(
      omahaPreflopStrength(cards('As2s8d7c'), true) + 0.04
    );
    const middlePlo8 = cards('JhTc8d5s');
    expect(omahaElitePreflopStrength(middlePlo8, true)).toBeLessThan(
      omahaPreflopStrength(middlePlo8, true) - 0.04
    );

    // Short Deck (6+): suited Aces & suited connectors boosted; small pocket pairs shaded
    expect(shortDeckElitePreflopStrength(cards('As9s'))).toBeGreaterThan(
      holdemPreflopScore(cards('As')[0], cards('9s')[0], true) + 0.05
    );
    expect(shortDeckElitePreflopStrength(cards('JsTs'))).toBeGreaterThan(
      holdemPreflopScore(cards('Js')[0], cards('Ts')[0], true) + 0.05
    );
    expect(shortDeckElitePreflopStrength(cards('7s7h'))).toBeLessThan(
      holdemPreflopScore(cards('7s')[0], cards('7h')[0], true) - 0.05
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PREFLOP ENGINE, HORSELOGIC, & LIVE DECISION WORKER RUNTIME
// ═══════════════════════════════════════════════════════════════════════════
describe('V86 2. Preflop 3-bets, squeezes, shallow 4-bets, iso-raises, 4-bet defense, & Worker Runtime', () => {
  function basePloPreflopCtx(over: Partial<PreflopCtx> = {}): PreflopCtx {
    const hole = cards('JcTc9h8h');
    const elite = omahaEliteClassRead(hole, false);
    return {
      strength: omahaElitePreflopStrength(hole, false),
      position: 'late',
      raiserPosition: 'middle',
      raises: 1,
      limpers: 0,
      callers: 0,
      oppsLeft: 2,
      toCall: 6,
      pot: 9,
      currentBet: 6,
      bigBlind: 2,
      stack: 200,
      stackBB: 100,
      effectiveStackBB: 100,
      mode: 'cash',
      isOmaha: true,
      isPotLimit: true,
      isFixedLimit: false,
      isHiLo: false,
      tightness: 1,
      aggression: 1,
      bluffFreq: 1,
      slowplayFreq: 0.1,
      sizingMultiplier: 1,
      riskAdd: 0,
      rand: () => 0.35,
      classShift: elite.shift,
      classNeverThreeBet: false,
      classFoldAlways: false,
      v86PloOverhaul: true,
      omahaElite: elite,
      ploPersona3BetMix: 0.6,
      plo3BetRoll: 0.25,
      ...over,
    } as PreflopCtx;
  }

  it('3-bets PLO4/PLO5/PLO6 rundowns & suited Ax, pot-squeezes callers, shallow 4-bets <=130bb, and continues vs 4-bet', () => {
    // 1. 3-betting JT98ds IP vs open
    const threeBet = decidePreflopV7(basePloPreflopCtx());
    expect(threeBet.a).toBe('raiseTo');
    expect(threeBet.receipt).toBe('v86_plo_elite_three_bet');

    // Ablation check: with v86 off and V46 classNeverThreeBet=true, JT98ds flats
    const preV86Flat = decidePreflopV7(
      basePloPreflopCtx({
        v86PloOverhaul: false,
        classNeverThreeBet: true,
        omahaElite: undefined,
      })
    );
    expect(preV86Flat.a).toBe('call');

    // 2. Suited-Ax nut bridge 3-bet in PLO5
    const ax5 = cards('As8sKdTd7c');
    const ax5Elite = omahaEliteClassRead(ax5, false);
    expect(ax5Elite.cls).toBe('ax_nut_suited');
    const ax5ThreeBet = decidePreflopV7(
      basePloPreflopCtx({
        raiserPosition: 'late',
        strength: omahaElitePreflopStrength(ax5, false),
        omahaElite: ax5Elite,
        classShift: ax5Elite.shift,
      })
    );
    expect(ax5ThreeBet.a).toBe('raiseTo');
    expect(ax5ThreeBet.receipt).toBe('v86_plo_elite_three_bet');

    // 3. Pot-squeeze over open + cold-caller in PLO6
    const sqz6 = cards('As9sKdJdTc8h');
    const sqz6Elite = omahaEliteClassRead(sqz6, false);
    const squeeze = decidePreflopV7(
      basePloPreflopCtx({
        position: 'bb',
        callers: 2,
        pot: 21,
        toCall: 4,
        strength: 0.58,
        omahaElite: sqz6Elite,
        classShift: sqz6Elite.shift,
        plo3BetRoll: 0.88, // above 3-bet value mix when OOP, triggers dedicated squeeze branch
        ploPersona3BetMix: 0.85,
      })
    );
    expect(squeeze.a).toBe('raiseTo');
    expect(['v86_plo_squeeze', 'v86_plo_elite_three_bet']).toContain(squeeze.receipt);

    // Explicitly hit dedicated v86_plo_squeeze branch (strength below effThreeBetThresh, >= 0.54 squeeze bar)
    const pureSqueeze = decidePreflopV7(
      basePloPreflopCtx({
        position: 'sb',
        raiserPosition: 'early',
        callers: 2,
        pot: 21,
        toCall: 5,
        strength: 0.56,
        omahaElite: sqz6Elite,
        classShift: { open: 0, threeBet: 0.05, fourBet: 0.05, coldCall: 0, bbDefend: 0 },
        ploPersona3BetMix: 0.65,
        plo3BetRoll: 0.3,
      })
    );
    expect(pureSqueeze.a).toBe('raiseTo');
    expect(pureSqueeze.receipt).toBe('v86_plo_squeeze');

    // 4. Shallow/medium (<=130bb) non-AA 4-betting with KQJTds (canFourBetShallow)
    const kqjtds = cards('KsQsJdTd');
    const kqjtElite = omahaEliteClassRead(kqjtds, false);
    const shallow4Bet = decidePreflopV7(
      basePloPreflopCtx({
        raises: 2,
        pot: 30,
        currentBet: 21,
        toCall: 15,
        stack: 194,
        effectiveStackBB: 100,
        strength: 0.78,
        omahaElite: kqjtElite,
        classShift: kqjtElite.shift,
        ploPersona3BetMix: 0.6,
        plo3BetRoll: 0.25,
      })
    );
    expect(shallow4Bet.a).toBe('raiseTo');
    expect(shallow4Bet.receipt).toBe('v86_plo_shallow_four_bet');

    // Above 130bb effective, shallow 4-bet disables cleanly
    const deepNoShallow4Bet = decidePreflopV7(
      basePloPreflopCtx({
        raises: 2,
        pot: 30,
        currentBet: 21,
        toCall: 15,
        stack: 380,
        effectiveStackBB: 190,
        strength: 0.78,
        omahaElite: kqjtElite,
        classShift: kqjtElite.shift,
        ploPersona3BetMix: 0.6,
        plo3BetRoll: 0.25,
      })
    );
    expect(deepNoShallow4Bet.receipt).not.toBe('v86_plo_shallow_four_bet');

    // 5. 3-bettor continues vs 4-bet at <= 0.45 pot odds without raise-folding
    const continueVs4Bet = decidePreflopV7(
      basePloPreflopCtx({
        raises: 3,
        pot: 96,
        currentBet: 66,
        toCall: 44,
        stack: 178,
        effectiveStackBB: 100,
        strength: 0.64,
        omahaElite: jt98dsRead(),
      })
    );
    expect(continueVs4Bet.a).toBe('call');
    expect(continueVs4Bet.receipt).toBe('v86_plo_three_bettor_continues');
  });

  function jt98dsRead() {
    return omahaEliteClassRead(cards('JcTc9h8h'), false);
  }

  it('enables PLO limper isolation, PLO MTT steal/re-steal, NLH straddle stack normalization, & A5s 3-bet bluffs', () => {
    // 1. PLO limper isolation from early/middle/late with elite rundown
    const isoGs: HorseGameStateV2 = {
      players: [
        makeSeat(1, 's1', '', { bet: 1, totalInvested: 1, stack: 199 }),
        makeSeat(2, 's2', '', { bet: 2, totalInvested: 2, stack: 198 }),
        makeSeat(3, 'limper-1', '', { bet: 2, totalInvested: 2, stack: 198 }),
        makeSeat(4, 'limper-2', '', { bet: 2, totalInvested: 2, stack: 198 }),
        makeSeat(5, LAG_SHARK_HORSE, 'JcTc9h8h', { bet: 0, totalInvested: 0, stack: 200 }),
        makeSeat(6, 's6', '', { bet: 0, totalInvested: 0, stack: 200, is_folded: true }),
      ],
      communityCards: [],
      pot: 7,
      currentBet: 2,
      toCall: 2,
      minRaise: 2,
      minRaiseTo: 4,
      maxRaiseTo: 9,
      legalActions: ['fold', 'call', 'raise'],
      stage: 'preflop',
      gameVariant: 'plo4',
      bettingStructure: 'pot_limit',
      bigBlind: 2,
      dealerSeat: 6,
      gameMode: 'cash',
      actionHistory: [
        { stage: 'preflop', seat: 3, userId: 'limper-1', action: 'call', amount: 2, timestamp: 3 },
        { stage: 'preflop', seat: 4, userId: 'limper-2', action: 'call', amount: 2, timestamp: 4 },
      ],
    } as unknown as HorseGameStateV2;
    seedFastRandom(42);
    const isoDec = HorseLogic.decide(isoGs.players[4], isoGs, 'lag', {});
    expect(isoDec.action).toBe('raise');

    // 2. PLO MTT steal & re-steal (tAggroPlo widens late steal by 0.03: 0.40 -> 0.37)
    const mttStealOn = decidePreflopV7(
      basePloPreflopCtx({
        mode: 'tournament',
        raises: 0,
        raiserPosition: null,
        oppsLeft: 2,
        tableSize: 6,
        position: 'late',
        toCall: 2,
        pot: 3,
        currentBet: 2,
        strength: 0.385,
        classShift: { open: 0, threeBet: 0, fourBet: 0, coldCall: 0, bbDefend: 0 },
        v86PloOverhaul: true,
      })
    );
    const mttStealOff = decidePreflopV7(
      basePloPreflopCtx({
        mode: 'tournament',
        raises: 0,
        raiserPosition: null,
        oppsLeft: 2,
        tableSize: 6,
        position: 'late',
        toCall: 2,
        pot: 3,
        currentBet: 2,
        strength: 0.385,
        classShift: { open: 0, threeBet: 0, fourBet: 0, coldCall: 0, bbDefend: 0 },
        v86PloOverhaul: false,
      })
    );
    expect(mttStealOn.a).toBe('raiseTo');
    expect(mttStealOff.a).not.toBe('raiseTo');

    // 3. NLH straddle effectiveStackBB normalization (200 chips at 1/2/4 straddle = 50 straddles, not 100bb)
    // Verify via HorseLogic.decide facing a shallow-straddle jam/4-bet spot and polarized A5s IP 3-bet bluff
    const a5sCtxBase: PreflopCtx = {
      strength: 0.52, // between 0.51 (V86 Ace-blocker floor) and 0.55 (legacy floor)
      position: 'late',
      raiserPosition: 'late',
      raises: 1,
      limpers: 0,
      callers: 0,
      oppsLeft: 2,
      toCall: 6,
      pot: 9,
      currentBet: 6,
      bigBlind: 2,
      stack: 200,
      stackBB: 100,
      effectiveStackBB: 100,
      mode: 'cash',
      isOmaha: false,
      isPotLimit: false,
      isFixedLimit: false,
      tightness: 1,
      aggression: 1.2,
      bluffFreq: 1.4,
      slowplayFreq: 0.1,
      sizingMultiplier: 1,
      riskAdd: 0,
      rand: () => 0.01,
      holdsAce: true,
      v86PloOverhaul: true,
    };
    expect(decidePreflopV7(a5sCtxBase).a).toBe('raiseTo');
    expect(decidePreflopV7({ ...a5sCtxBase, v86PloOverhaul: false }).a).not.toBe('raiseTo');

    // Straddle effectiveStackBB normalization: at $1/$2 with $4 straddle and 36 chips (18bb nominal, 9 straddles true),
    // V86 normalizes effectiveStackBB to 9 so short-stack straddle push/fold discipline engages.
    const straddlePlayers = [
      makeSeat(1, 'sb', '', { bet: 1, totalInvested: 1, stack: 35 }),
      makeSeat(2, 'bb', '', { bet: 2, totalInvested: 2, stack: 34 }),
      makeSeat(3, 'straddler', '', { bet: 4, totalInvested: 4, stack: 32 }),
      makeSeat(4, LAG_SHARK_HORSE, 'As5s', { bet: 0, totalInvested: 0, stack: 36 }),
    ];
    const straddleGs: HorseGameStateV2 = {
      players: straddlePlayers,
      communityCards: [],
      pot: 7,
      currentBet: 4,
      toCall: 4,
      minRaise: 4,
      minRaiseTo: 8,
      maxRaiseTo: 36,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'preflop',
      gameVariant: 'nlh',
      bettingStructure: 'no_limit',
      bigBlind: 2,
      dealerSeat: 4,
      straddleActive: true,
      gameMode: 'cash',
      actionHistory: [],
    } as unknown as HorseGameStateV2;
    seedFastRandom(7);
    const straddleOn = HorseLogic.decide(
      straddlePlayers[3],
      straddleGs,
      'lag',
      {},
      { v86PloOverhaul: true }
    );
    expect(['raise', 'all_in']).toContain(straddleOn.action);
  });

  it('passes V86 PLO rundown 3-bets through live HorseDecisionWorkerRuntime in admitted candidate mode', async () => {
    const tableId = '10000000-0000-4000-8000-000000000086';
    const messages: HorseDecisionWorkerResponse[] = [];
    const worker = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
      ...defaultHorseDecisionWorkerDependencies,
      startServices: async () => defaultHorseDecisionWorkerDependencies.workerReadiness(),
      stopServices: async () => {},
      journalEnabled: () => false,
      journalAcceptedHand: () => {},
      journalLifecycle: () => {},
      decide: (...args: Parameters<typeof HorseLogic.decide>) => {
        seedFastRandom(19);
        return HorseLogic.decide(...args);
      },
      noteDecision: () => {},
      noteFeature: () => {},
    });
    await worker.start();

    const config: HandConfig = {
      tableId,
      handNumber: 86001,
      gameVariant: 'plo4',
      smallBlind: 1,
      bigBlind: 2,
      isTournament: false,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig;
    const players = [WOOWOO_ID, LAG_SHARK_HORSE].map((user_id, i) => ({
      seat: i + 1,
      user_id,
      username: `P${i + 1}`,
      stack: 200,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    })) as SeatPlayer[];
    const controller = new HandController(config, players, 1);
    controller.start();
    expect(controller.performAction(1, 'raise', 6)).toBe(true);
    const spot = controllerDecisionState(controller, 'plo4' as never, 'cash', config)!;
    expect(spot.hero.user_id).toBe(LAG_SHARK_HORSE);
    spot.hero.cards = cards('AsQsJdTd');
    spot.state.commitmentCapRemaining = applyTableCommitmentCap(
      controller.getAuthoritativeActionState(LAG_SHARK_HORSE)!,
      spot.hero,
      false,
      0,
      2
    ).commitmentCapRemaining;

    const request: FastHorseDecisionRequest = {
      type: 'DECIDE_FAST',
      requestId: 8601,
      generation: 1,
      fence: `${tableId}:86001:2:9:1`,
      decisionTimeMs: Date.now() + 10_000,
      decisionKey: '',
      player: spot.hero,
      gameState: spot.state,
      style: 'lag',
      mods: {},
      handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
    };
    request.decisionKey = buildHorseDecisionKey(request);
    worker.receive(request);
    await worker.drain();

    const fast = messages.find((m) => m.type === 'FAST_RESULT');
    expect(fast?.type).toBe('FAST_RESULT');
    if (fast?.type === 'FAST_RESULT') {
      expect(fast.decision.action).toBe('raise');
      expect(fast.decision.plo4Policy?.mode).toBe('candidate');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. POSTFLOP, UNDERBOAT / PLO6 RIVER FOLDS, MULTI-BOARD, & HOLLYWOOD TIMING
// ═══════════════════════════════════════════════════════════════════════════
describe('V86 3. Postflop commitment, river underboat/PLO6 folds, combo draws, multi-board, & PRNG-neutral timing', () => {
  function makeRiverSpot(
    variant: 'plo4' | 'plo5' | 'plo6',
    hole: string,
    board: string,
    bet: number,
    opts: {
      liveThirdPlayer?: boolean;
      heroStack?: number;
      potBefore?: number;
    } = {}
  ): { hero: SeatPlayer; gs: HorseGameStateV2 } {
    const potBefore = opts.potBefore ?? 40;
    const heroStack = opts.heroStack ?? 240;
    const hero = makeSeat(1, TAG_CRUSHER_HORSE, hole, {
      stack: heroStack,
      bet: 0,
      totalInvested: 20,
    });
    const villain = makeSeat(2, '40000000-0000-4000-8000-000000000099', '', {
      stack: 240 - bet,
      bet,
      totalInvested: 20 + bet,
      is_horse: false,
    });
    const third = makeSeat(3, '40000000-0000-4000-8000-000000000098', '', {
      stack: 240,
      bet: 0,
      totalInvested: opts.liveThirdPlayer ? 20 : 0,
      is_folded: !opts.liveThirdPlayer,
    });
    const gs: HorseGameStateV2 = {
      players: [hero, villain, third],
      communityCards: cards(board),
      pot: potBefore + bet,
      currentBet: bet,
      toCall: bet,
      minRaise: bet,
      minRaiseTo: bet * 2,
      maxRaiseTo: heroStack,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'river',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      boardCount: 1,
      bigBlind: 2,
      dealerSeat: 2,
      gameMode: 'cash',
      actionHistory: [
        ...(opts.liveThirdPlayer
          ? [
              {
                stage: 'preflop',
                seat: 3,
                userId: third.user_id,
                action: 'call',
                amount: 6,
                timestamp: 1,
              },
            ]
          : [
              {
                stage: 'preflop',
                seat: 3,
                userId: third.user_id,
                action: 'fold',
                amount: 0,
                timestamp: 1,
              },
            ]),
        {
          stage: 'preflop',
          seat: 2,
          userId: villain.user_id,
          action: 'raise',
          amount: 6,
          timestamp: 2,
        },
        {
          stage: 'preflop',
          seat: 1,
          userId: hero.user_id,
          action: 'call',
          amount: 6,
          timestamp: 3,
        },
        { stage: 'river', seat: 1, userId: hero.user_id, action: 'check', amount: 0, timestamp: 4 },
        {
          stage: 'river',
          seat: 2,
          userId: villain.user_id,
          action: 'bet',
          amount: bet,
          timestamp: 5,
        },
      ],
    } as unknown as HorseGameStateV2;
    return { hero, gs };
  }

  it('folds lowest underboats (lowerBoats === 0 && boats >= 2), PLO6 dominated rivers, and 3-way bare two pair', () => {
    // 1. Underboat on Ks Kd Qh 7c 2d: hero holds 2s 2c Ah Td (222KK: lowerBoats === 0, beaten by KKx, QQ, 77, KQ, K7, K2)
    const pos = omahaBoatPosition(cards('2s2cAhTd'), cards('KsKdQh7c2d'));
    expect(pos).not.toBeNull();
    expect(pos!.lowerBoats).toBe(0);
    expect(pos!.boats).toBeGreaterThanOrEqual(2);

    const underboatSpot = makeRiverSpot('plo4', '2s2cAhTd', 'KsKdQh7c2d', 36, { potBefore: 40 });
    const foldedBoat = v86OmahaUnderboatOrDominatedFold(
      { action: 'call', amount: 36, thinkTime: 0 },
      underboatSpot.hero,
      underboatSpot.gs,
      true,
      false
    );
    expect(foldedBoat.decision.action).toBe('fold');
    expect(foldedBoat.reason).toBe('v86_plo_underboat_fold');

    // Over-bluffer exception keeps the call intact
    const vsOverBluffer = v86OmahaUnderboatOrDominatedFold(
      { action: 'call', amount: 36, thinkTime: 0 },
      underboatSpot.hero,
      underboatSpot.gs,
      true,
      true
    );
    expect(vsOverBluffer.decision.action).toBe('call');
    expect(vsOverBluffer.reason).toBeNull();

    // End-to-end through HorseLogic.decide
    drainFires();
    seedFastRandom(123);
    const e2eUnderboat = HorseLogic.decide(underboatSpot.hero, underboatSpot.gs, 'balanced', {});
    expect(e2eUnderboat.action).toBe('fold');

    // 2. PLO6 dominated river big-bet fold (second-nut flush K-high flush on spades board facing pot bet)
    const plo6Spot = makeRiverSpot('plo6', 'Ks9s7d6c4h2d', 'QsJs4s8h2c', 40, { potBefore: 40 });
    const plo6Fold = v86OmahaUnderboatOrDominatedFold(
      { action: 'call', amount: 40, thinkTime: 0 },
      plo6Spot.hero,
      plo6Spot.gs,
      true,
      false
    );
    expect(plo6Fold.decision.action).toBe('fold');
    expect(plo6Fold.reason).toBe('v86_plo6_big_bet_fold');

    // 3. Multiway (3 live players) 0.75-pot river fold with bare two pair
    const mwTwoPair = makeRiverSpot('plo4', 'KsQd7h2c', 'KhQc9s5d3c', 30, {
      potBefore: 40,
      liveThirdPlayer: true,
    });
    const mwFold = v86OmahaUnderboatOrDominatedFold(
      { action: 'call', amount: 30, thinkTime: 0 },
      mwTwoPair.hero,
      mwTwoPair.gs,
      true,
      false
    );
    expect(mwFold.decision.action).toBe('fold');
    expect(mwFold.reason).toBe('v86_plo_multiway_dominated_fold');
  });

  it('excludes current-street bet when bet-then-raised in Omaha and zeroes turn V68 no-room-to-be-paid implied credit', () => {
    // 1. Omaha bet-then-raised deep spot: hero invested 4 preflop, bet 60 into 60 on turn, villain raised to 180;
    //    hero has 140 left (total commitmentStack + investedNow = 204). Including hero's 60 turn bet as prior
    //    investment would cross 30% (64/204 = 31.3%) and falsely mark hero committed with bare one pair!
    const hero = makeSeat(1, TAG_CRUSHER_HORSE, 'AsKd7h2c', {
      stack: 140,
      bet: 60,
      totalInvested: 64,
    });
    const villain = makeSeat(2, '40000000-0000-4000-8000-000000000055', '', {
      stack: 100,
      bet: 180,
      totalInvested: 184,
      is_horse: false,
    });
    const betRaisedGs: HorseGameStateV2 = {
      players: [hero, villain],
      communityCards: cards('Ah9s8s4d'),
      pot: 248,
      currentBet: 180,
      toCall: 120,
      minRaise: 120,
      minRaiseTo: 300,
      maxRaiseTo: 200,
      legalActions: ['fold', 'call', 'all_in'],
      stage: 'turn',
      gameVariant: 'plo4',
      bettingStructure: 'pot_limit',
      bigBlind: 2,
      dealerSeat: 2,
      gameMode: 'cash',
      actionHistory: [
        {
          stage: 'preflop',
          seat: 2,
          userId: villain.user_id,
          action: 'raise',
          amount: 4,
          timestamp: 1,
        },
        {
          stage: 'preflop',
          seat: 1,
          userId: hero.user_id,
          action: 'call',
          amount: 4,
          timestamp: 2,
        },
        { stage: 'turn', seat: 1, userId: hero.user_id, action: 'bet', amount: 60, timestamp: 3 },
        {
          stage: 'turn',
          seat: 2,
          userId: villain.user_id,
          action: 'raise',
          amount: 180,
          isFullRaise: true,
          timestamp: 4,
        },
      ],
    } as unknown as HorseGameStateV2;
    seedFastRandom(77);
    const betRaisedDec = HorseLogic.decide(hero, betRaisedGs, 'tag', {});
    expect(betRaisedDec.action).toBe('fold');

    // 2. Omaha turn V68 no-room-to-be-paid implied-odds guard with non-nutty draw and shallow stack behind
    const turnHero = makeSeat(1, TAG_CRUSHER_HORSE, '9h8h6c2d', {
      stack: 34,
      bet: 0,
      totalInvested: 20,
    });
    const turnVillain = makeSeat(2, '40000000-0000-4000-8000-000000000056', '', {
      stack: 10,
      bet: 24,
      totalInvested: 44,
      is_horse: false,
    });
    const noRoomGs: HorseGameStateV2 = {
      players: [turnHero, turnVillain],
      communityCards: cards('KsQh7d2s'),
      pot: 64,
      currentBet: 24,
      toCall: 24,
      minRaise: 24,
      minRaiseTo: 48,
      maxRaiseTo: 34,
      legalActions: ['fold', 'call', 'all_in'],
      stage: 'turn',
      gameVariant: 'plo4',
      bettingStructure: 'pot_limit',
      bigBlind: 2,
      dealerSeat: 2,
      gameMode: 'cash',
      actionHistory: [
        {
          stage: 'turn',
          seat: 1,
          userId: turnHero.user_id,
          action: 'check',
          amount: 0,
          timestamp: 1,
        },
        {
          stage: 'turn',
          seat: 2,
          userId: turnVillain.user_id,
          action: 'bet',
          amount: 24,
          timestamp: 2,
        },
      ],
    } as unknown as HorseGameStateV2;
    drainFires();
    seedFastRandom(88);
    const noRoomDec = HorseLogic.decide(turnHero, noRoomGs, 'tag', {});
    expect(noRoomDec.action).toBe('fold');
  });

  it('activates OOP river nut block-bet traps (and suppresses weak block-bets vs LAGs), IP dry-flop nut check-back traps, nut combo-draw Pump & Jam, & PLO8 freerolls', () => {
    // 1. OOP river nut block-bet trap (~22% deterministic mix by pot/hand seed)
    let sawRiverNutBlockTrap = false;
    for (let pot = 12; pot <= 120; pot++) {
      drainFires();
      seedFastRandom(101);
      const hero = makeSeat(1, TRICKY_TRAP_HORSE, 'AsKs4d3c', { stack: 200 });
      const villain = makeSeat(2, '40000000-0000-4000-8000-000000000060', '', { stack: 200 });
      const folded = makeSeat(3, '40000000-0000-4000-8000-000000000069', '', { is_folded: true });
      const gs: HorseGameStateV2 = {
        players: [hero, villain, folded],
        communityCards: cards('Qs9s2s7d4h'),
        pot,
        currentBet: 0,
        toCall: 0,
        minRaise: 2,
        minRaiseTo: 2,
        maxRaiseTo: pot,
        legalActions: ['check', 'bet'],
        stage: 'river',
        gameVariant: 'plo4',
        bettingStructure: 'pot_limit',
        bigBlind: 2,
        dealerSeat: 2,
        gameMode: 'cash',
        actionHistory: [
          {
            stage: 'preflop',
            seat: 3,
            userId: folded.user_id,
            action: 'fold',
            amount: 0,
            timestamp: 1,
          },
          {
            stage: 'preflop',
            seat: 1,
            userId: hero.user_id,
            action: 'raise',
            amount: 6,
            timestamp: 2,
          },
          {
            stage: 'preflop',
            seat: 2,
            userId: villain.user_id,
            action: 'call',
            amount: 6,
            timestamp: 3,
          },
        ],
      } as unknown as HorseGameStateV2;
      const dec = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true });
      const fires = drainFires().map((f) => f.feature);
      if (fires.includes('v86_river_block_trap')) {
        sawRiverNutBlockTrap = true;
        expect(dec.action).toBe('bet');
        expect(dec.amount!).toBeLessThanOrEqual(pot * 0.42);
        break;
      }
    }
    expect(sawRiverNutBlockTrap).toBe(true);

    // Suppresses unprotected medium river OOP block-bets vs verified LAG bully
    trainWooWooProfile(WOOWOO_ID, 'nlh', 2, 50);
    let blockBetsVsLag = 0;
    let blockBetsPreV86 = 0;
    for (let s = 1; s <= 30; s++) {
      const hero = makeSeat(1, TAG_CRUSHER_HORSE, 'KdTs', { stack: 200 });
      const bully = makeSeat(2, WOOWOO_ID, '', { stack: 200, is_horse: false });
      const gs: HorseGameStateV2 = {
        players: [hero, bully],
        communityCards: cards('AhTc6s3d2c'),
        pot: 30,
        currentBet: 0,
        toCall: 0,
        minRaise: 2,
        minRaiseTo: 2,
        maxRaiseTo: 200,
        legalActions: ['check', 'bet'],
        stage: 'river',
        gameVariant: 'nlh',
        bettingStructure: 'no_limit',
        bigBlind: 2,
        dealerSeat: 2,
        gameMode: 'cash',
        actionHistory: [
          {
            stage: 'preflop',
            seat: 1,
            userId: hero.user_id,
            action: 'raise',
            amount: 6,
            timestamp: 1,
          },
          {
            stage: 'preflop',
            seat: 2,
            userId: bully.user_id,
            action: 'call',
            amount: 6,
            timestamp: 2,
          },
        ],
      } as unknown as HorseGameStateV2;
      seedFastRandom(500 + s);
      const dOn = HorseLogic.decide(hero, gs, 'tag', {}, { v86PloOverhaul: true });
      if (dOn.action === 'bet' && (dOn.amount ?? 0) <= 12) blockBetsVsLag++;
      seedFastRandom(500 + s);
      const dOff = HorseLogic.decide(hero, gs, 'tag', {}, { v86PloOverhaul: false });
      if (dOff.action === 'bet' && (dOff.amount ?? 0) <= 12) blockBetsPreV86++;
    }
    expect(blockBetsVsLag).toBeLessThanOrEqual(blockBetsPreV86);

    // 2. IP flop nut check-back trap on dry static Omaha board (~25% deterministic mix)
    let sawIpNutCheckback = false;
    for (let pot = 12; pot <= 120; pot++) {
      drainFires();
      seedFastRandom(202);
      const villain = makeSeat(1, '40000000-0000-4000-8000-000000000061', '', { stack: 200 });
      const hero = makeSeat(2, TRICKY_TRAP_HORSE, 'AsAhKdQc', { stack: 200 });
      const gs: HorseGameStateV2 = {
        players: [villain, hero],
        communityCards: cards('Ac7d7h'), // top boat Aces full: cat=7, nutClass15=true, static dry flop
        pot,
        currentBet: 0,
        toCall: 0,
        minRaise: 2,
        minRaiseTo: 2,
        maxRaiseTo: pot,
        legalActions: ['check', 'bet'],
        stage: 'flop',
        gameVariant: 'plo4',
        bettingStructure: 'pot_limit',
        bigBlind: 2,
        dealerSeat: 2,
        gameMode: 'cash',
        actionHistory: [
          {
            stage: 'flop',
            seat: 1,
            userId: villain.user_id,
            action: 'check',
            amount: 0,
            timestamp: 1,
          },
        ],
      } as unknown as HorseGameStateV2;
      const dec = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true });
      if (drainFires().some((f) => f.feature === 'v86_ip_nut_checkback_trap')) {
        sawIpNutCheckback = true;
        expect(dec.action).toBe('check');
        break;
      }
    }
    expect(sawIpNutCheckback).toBe(true);

    // 3. Omaha nut combo-draw (nutFlushDraw + wrap) Pump & Jam facing a flop bet
    let sawComboPump = false;
    for (let potBase = 16; potBase <= 48; potBase += 4) {
      drainFires();
      seedFastRandom(303);
      const bet = Math.round(potBase * 0.65);
      const villain = makeSeat(1, '40000000-0000-4000-8000-000000000062', '', {
        stack: 250 - bet,
        bet,
        totalInvested: 8 + bet,
      });
      const hero = makeSeat(2, LAG_SHARK_HORSE, 'AsKsJdTc', {
        stack: 250,
        bet: 0,
        totalInvested: 8,
      });
      const gs: HorseGameStateV2 = {
        players: [villain, hero],
        communityCards: cards('Qs9s2d'), // nut spade flush draw + K-J-T wrap around Q-9
        pot: potBase + bet,
        currentBet: bet,
        toCall: bet,
        minRaise: bet,
        minRaiseTo: bet * 2,
        maxRaiseTo: bet + potBase + bet * 2,
        legalActions: ['fold', 'call', 'raise'],
        stage: 'flop',
        gameVariant: 'plo4',
        bettingStructure: 'pot_limit',
        bigBlind: 2,
        dealerSeat: 2,
        gameMode: 'cash',
        actionHistory: [
          {
            stage: 'flop',
            seat: 1,
            userId: villain.user_id,
            action: 'bet',
            amount: bet,
            timestamp: 1,
          },
        ],
      } as unknown as HorseGameStateV2;
      const dec = HorseLogic.decide(hero, gs, 'lag', {}, { telemetry: true });
      const fires = drainFires().map((f) => f.feature);
      if (fires.includes('v86_plo_combo_draw_pump') || dec.action === 'raise') {
        sawComboPump = true;
        expect(dec.action).toBe('raise');
        break;
      }
    }
    expect(sawComboPump).toBe(true);

    // 4. PLO8 nut-low + high-redraw scoop freeroll raise/lead
    let sawPlo8Aggro = false;
    for (let potBase = 16; potBase <= 48; potBase += 4) {
      drainFires();
      seedFastRandom(404);
      const bet = Math.round(potBase * 0.5);
      const villain = makeSeat(1, '40000000-0000-4000-8000-000000000063', '', {
        stack: 250 - bet,
        bet,
        totalInvested: 8 + bet,
      });
      const hero = makeSeat(2, LAG_SHARK_HORSE, 'As2s3hKd', {
        stack: 250,
        bet: 0,
        totalInvested: 8,
      });
      const gs: HorseGameStateV2 = {
        players: [villain, hero],
        communityCards: cards('4s5c8s'), // nut A2 low made + nut spade flush draw + wheel/straight redraw
        pot: potBase + bet,
        currentBet: bet,
        toCall: bet,
        minRaise: bet,
        minRaiseTo: bet * 2,
        maxRaiseTo: bet + potBase + bet * 2,
        legalActions: ['fold', 'call', 'raise'],
        stage: 'flop',
        gameVariant: 'plo8',
        bettingStructure: 'pot_limit',
        variantRules: horseVariantRulesFor('plo8'),
        bigBlind: 2,
        dealerSeat: 2,
        gameMode: 'cash',
        actionHistory: [
          {
            stage: 'flop',
            seat: 1,
            userId: villain.user_id,
            action: 'bet',
            amount: bet,
            timestamp: 1,
          },
        ],
      } as unknown as HorseGameStateV2;
      const dec = HorseLogic.decide(hero, gs, 'lag', {});
      if (dec.action === 'raise') {
        sawPlo8Aggro = true;
        break;
      }
    }
    expect(sawPlo8Aggro).toBe(true);
  });

  it('enforces Double-Board dead-half folds (dominated_commitment_floor), strong+redraw pot-raises, 160bb+ NLH pot control, & Short Deck/Pineapple shades', () => {
    // 1. Double-board dead-half fold: Board 1 hero has vulnerable two pair (< 0.88),
    //    Board 2 hero holds zero spades / zero pairs / zero broadways (< 0.10 eq) facing a 0.75-pot bet
    const mbHero = makeSeat(1, TAG_CRUSHER_HORSE, '9d8c3h2c', { stack: 260 });
    const mbVillain = makeSeat(2, WOOWOO_ID, '', {
      stack: 230,
      bet: 30,
      totalInvested: 50,
      is_horse: false,
    });
    const deadHalfGs: HorseGameStateV2 = {
      players: [mbHero, mbVillain],
      communityCards: cards('9s8h6d4cKs'), // Board 1: middle two pair 98 (< 0.88)
      communityCards2: cards('AsKsQsQdJd'), // Board 2: paired monotone broadway board, hero has 98-high (< 0.05)
      boardCount: 2,
      bombPot: true,
      pot: 70, // 40 before + 30 bet => potFrac = 0.75 >= 0.60
      currentBet: 30,
      toCall: 30,
      minRaise: 30,
      minRaiseTo: 60,
      maxRaiseTo: 130,
      legalActions: ['fold', 'call', 'raise'],
      stage: 'river',
      gameVariant: 'plo4',
      bettingStructure: 'pot_limit',
      bigBlind: 2,
      dealerSeat: 2,
      gameMode: 'cash',
      actionHistory: [
        {
          stage: 'river',
          seat: 1,
          userId: mbHero.user_id,
          action: 'check',
          amount: 0,
          timestamp: 1,
        },
        {
          stage: 'river',
          seat: 2,
          userId: mbVillain.user_id,
          action: 'bet',
          amount: 30,
          timestamp: 2,
        },
      ],
    } as unknown as HorseGameStateV2;
    drainFires();
    seedFastRandom(515);
    const deadHalfDec = HorseLogic.decide(mbHero, deadHalfGs, 'tag', {}, { telemetry: true });
    expect(deadHalfDec.action).toBe('fold');
    expect(deadHalfDec.continuationGuard).toBe('dominated_commitment_floor');
    expect(drainFires().some((f) => f.feature === 'v86_multiboard_dead_half_fold')).toBe(true);

    // 2. Double-board strong board (>= 0.80) + second-board redraw (>= 0.32) pot-raise on flop
    let sawMbRaise = false;
    for (let potBase = 20; potBase <= 48; potBase += 4) {
      drainFires();
      seedFastRandom(616);
      const bet = Math.round(potBase * 0.5);
      const h = makeSeat(2, LAG_SHARK_HORSE, 'AsAhKsJs', { stack: 300 });
      const v = makeSeat(1, '40000000-0000-4000-8000-000000000070', '', {
        stack: 300 - bet,
        bet,
        totalInvested: 10 + bet,
      });
      const mbStrongGs: HorseGameStateV2 = {
        players: [v, h],
        communityCards: cards('AcAd2c'), // Board 1: quad Aces locked (> 0.98)
        communityCards2: cards('QsTs4d'), // Board 2: nut flush draw + royal/broadway wrap (>= 0.45)
        boardCount: 2,
        bombPot: true,
        pot: potBase + bet,
        currentBet: bet,
        toCall: bet,
        minRaise: bet,
        minRaiseTo: bet * 2,
        maxRaiseTo: bet + potBase + bet * 2,
        legalActions: ['fold', 'call', 'raise'],
        stage: 'flop',
        gameVariant: 'plo4',
        bettingStructure: 'pot_limit',
        bigBlind: 2,
        dealerSeat: 2,
        gameMode: 'cash',
        actionHistory: [
          { stage: 'flop', seat: 1, userId: v.user_id, action: 'bet', amount: bet, timestamp: 1 },
        ],
      } as unknown as HorseGameStateV2;
      const d = HorseLogic.decide(h, mbStrongGs, 'lag', {});
      if (d.action === 'raise') {
        sawMbRaise = true;
        break;
      }
    }
    expect(sawMbRaise).toBe(true);

    // 3. 160bb+ NLH deep-stack pot control (shadeDeep86 = 0.08 fires v86_nlh_deep_pot_control)
    const deepHero = makeSeat(1, TAG_CRUSHER_HORSE, 'AhJd', {
      stack: 340,
      bet: 0,
      totalInvested: 12,
    });
    const deepVillain = makeSeat(2, '40000000-0000-4000-8000-000000000071', '', {
      stack: 300,
      bet: 40,
      totalInvested: 52,
    });
    const deepNlhGs: HorseGameStateV2 = {
      players: [deepHero, deepVillain],
      communityCards: cards('AsTc8c4d2s'),
      pot: 84, // 44 before + 40 bet => potFrac = 0.91 >= 0.85, commitmentStack = 340 (170bb)
      currentBet: 40,
      toCall: 40,
      minRaise: 40,
      minRaiseTo: 80,
      maxRaiseTo: 340,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'river',
      gameVariant: 'nlh',
      bettingStructure: 'no_limit',
      bigBlind: 2,
      dealerSeat: 2,
      gameMode: 'cash',
      actionHistory: [
        {
          stage: 'river',
          seat: 1,
          userId: deepHero.user_id,
          action: 'check',
          amount: 0,
          timestamp: 1,
        },
        {
          stage: 'river',
          seat: 2,
          userId: deepVillain.user_id,
          action: 'bet',
          amount: 40,
          timestamp: 2,
        },
      ],
    } as unknown as HorseGameStateV2;
    drainFires();
    seedFastRandom(717);
    HorseLogic.decide(deepHero, deepNlhGs, 'tag', {}, { telemetry: true });
    expect(drainFires().some((f) => f.feature === 'v86_nlh_deep_pot_control')).toBe(true);

    // 4. Short Deck & post-discard Pineapple turn/river one-pair bluff-catch shades
    for (const variant of ['short_deck', 'pineapple'] as const) {
      const sdHero = makeSeat(1, TAG_CRUSHER_HORSE, '9h8c', { stack: 200 }); // 2 cards post-discard in pineapple too (third pair 9s)
      const sdVillain = makeSeat(2, '40000000-0000-4000-8000-000000000072', '', {
        stack: 160,
        bet: 40,
        totalInvested: 60,
      });
      const sdGs: HorseGameStateV2 = {
        players: [sdHero, sdVillain],
        communityCards: cards('AdKsQh9c6d'),
        pot: 80, // 40 before + 40 pot bet
        currentBet: 40,
        toCall: 40,
        minRaise: 40,
        minRaiseTo: 80,
        maxRaiseTo: 200,
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        stage: 'river',
        gameVariant: variant,
        bettingStructure: 'no_limit',
        variantRules: horseVariantRulesFor(variant),
        bigBlind: 2,
        dealerSeat: 2,
        gameMode: 'cash',
        actionHistory: [
          {
            stage: 'river',
            seat: 1,
            userId: sdHero.user_id,
            action: 'check',
            amount: 0,
            timestamp: 1,
          },
          {
            stage: 'river',
            seat: 2,
            userId: sdVillain.user_id,
            action: 'bet',
            amount: 40,
            timestamp: 2,
          },
        ],
      } as unknown as HorseGameStateV2;
      seedFastRandom(818);
      const decOn = HorseLogic.decide(sdHero, sdGs, 'tag', {}, { v86PloOverhaul: true });
      expect(decOn.action).toBe('fold');
    }
  });

  it('adds 25%-35% Hollywood tank on postflop raises and >=25bb river bets with ZERO extra fastRandom() draws', () => {
    const gsRiverBig: HorseGameStateV2 = {
      players: [
        makeSeat(1, LAG_SHARK_HORSE, 'AsKsQsJs', { stack: 300 }),
        makeSeat(2, WOOWOO_ID, '', { stack: 300 }),
      ],
      communityCards: cards('Ts9s2d4c7h'),
      pot: 80, // 40bb >= 25bb
      currentBet: 0,
      toCall: 0,
      stage: 'river',
      gameVariant: 'plo4',
      bigBlind: 2,
      gameMode: 'cash',
    } as unknown as HorseGameStateV2;

    const computeThink = (
      HorseLogic as unknown as {
        computeThinkTime: (
          d: { action: string; amount?: number; thinkTime: number },
          gs: HorseGameStateV2,
          params: Record<string, unknown>,
          toCall: number,
          useTiming: boolean,
          tempoSeed: string,
          useGravity: boolean,
          v86Hollywood: boolean
        ) => number;
      }
    ).computeThinkTime.bind(HorseLogic);
    const timingParams = {
      tightness: 1,
      aggression: 1,
      bluffFreq: 1,
      slowplayFreq: 0.1,
      sizingMultiplier: 1,
      thinkRange: [1200, 3500],
    };

    let hollywoodHits = 0;
    const totalSamples = 200;
    for (let i = 0; i < totalSamples; i++) {
      const seedId = `hw-horse-${i}`;
      const gsSample: HorseGameStateV2 = {
        ...gsRiverBig,
        players: [
          makeSeat(1, seedId, 'AsKsQsJs', { stack: 300 }),
          makeSeat(2, WOOWOO_ID, '', { stack: 300 }),
        ],
      };
      seedFastRandom(9000 + i);
      const tOn = computeThink(
        { action: 'bet', amount: 60, thinkTime: 0 },
        gsSample,
        timingParams,
        0,
        true,
        seedId,
        true,
        true
      );
      const rngAfterOn = saveFastRandom();

      seedFastRandom(9000 + i);
      const tOff = computeThink(
        { action: 'bet', amount: 60, thinkTime: 0 },
        gsSample,
        timingParams,
        0,
        true,
        seedId,
        true,
        false
      );
      const rngAfterOff = saveFastRandom();

      // Exact PRNG state parity: Hollywood tank NEVER draws from fastRandom()!
      expect(rngAfterOn).toBe(rngAfterOff);
      // Verify downstream fastRandom() draw is bit-identical
      seedFastRandom(0);
      restoreFastRandom(rngAfterOn);
      const nextOn = fastRandom();
      restoreFastRandom(rngAfterOff);
      const nextOff = fastRandom();
      expect(nextOn).toBe(nextOff);

      if (tOn > tOff) {
        hollywoodHits++;
        expect(tOn - tOff).toBeGreaterThanOrEqual(1800);
      }
    }
    // Target is 28% (allow tight deterministic band [0.18, 0.38] over 200 Horse IDs)
    expect(hollywoodHits / totalSamples).toBeGreaterThanOrEqual(0.18);
    expect(hollywoodHits / totalSamples).toBeLessThanOrEqual(0.38);

    // Also verify postflop raise facingBet triggers Hollywood tank with zero PRNG drift
    const gsFlopRaise: HorseGameStateV2 = {
      ...gsRiverBig,
      stage: 'flop',
      pot: 40,
      currentBet: 15,
      toCall: 15,
    };
    let raiseTanks = 0;
    for (let i = 0; i < 80; i++) {
      const seedId = `hw-raise-${i}`;
      seedFastRandom(7000 + i);
      const tOn = computeThink(
        { action: 'raise', amount: 45, thinkTime: 0 },
        gsFlopRaise,
        timingParams,
        15,
        true,
        seedId,
        true,
        true
      );
      const stateOn = saveFastRandom();
      seedFastRandom(7000 + i);
      const tOff = computeThink(
        { action: 'raise', amount: 45, thinkTime: 0 },
        gsFlopRaise,
        timingParams,
        15,
        true,
        seedId,
        true,
        false
      );
      expect(stateOn).toBe(saveFastRandom());
      if (tOn > tOff) raiseTanks++;
    }
    expect(raiseTanks).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ANTI-LAG ("BULLY-BREAKER") SYSTEM & ECOSYSTEM SERVICES
// ═══════════════════════════════════════════════════════════════════════════
describe('V86 4. Bully-Breaker Anti-LAG counter-system, Hydrator, Personas, Top-Up, Review, & Self-Tuner', () => {
  it('keeps 1.0x bluff & >=1.12 thin value against LAG bully winners while respecting TAG winners at 0.60x / 0.85x', () => {
    trainProvenWinner(TAG_WINNER_ID);
    trainProvenWinner(WOOWOO_ID);
    trainWooWooProfile(WOOWOO_ID, 'plo4', 6, 60);

    expect(isProvenWinner(TAG_WINNER_ID)).toBe(true);
    expect(isProvenWinner(WOOWOO_ID)).toBe(true);
    expect(HorseMind.isLagBully(TAG_WINNER_ID)).toBe(false);
    expect(HorseMind.isLagBully(WOOWOO_ID)).toBe(true);

    const baseProfile = { bluffMod: 1.0, callDownMod: 1.15, valueThinMod: 1.0 };
    const vsTag = respectWinner(baseProfile, TAG_WINNER_ID, false);
    expect(vsTag.bluffMod).toBeCloseTo(WINNER_BLUFF_MOD, 6);
    expect(vsTag.valueThinMod).toBeCloseTo(WINNER_VALUE_THIN_MOD, 6);

    const vsLag = respectWinner(baseProfile, WOOWOO_ID, true);
    expect(vsLag.bluffMod).toBeCloseTo(1.0, 6);
    expect(vsLag.valueThinMod).toBeGreaterThanOrEqual(WINNER_LAG_VALUE_THIN_FLOOR);

    // End-to-end through HorseMind.exploit()
    const mindTag = HorseMind.exploit(TAG_WINNER_ID);
    const mindLag = HorseMind.exploit(WOOWOO_ID);
    expect(mindTag.bluffMod).toBeCloseTo(WINNER_BLUFF_MOD, 4);
    expect(mindLag.bluffMod).toBeGreaterThan(mindTag.bluffMod * 1.4);
    expect(mindLag.valueThinMod).toBeGreaterThanOrEqual(WINNER_LAG_VALUE_THIN_FLOOR);
  });

  it('detects streetBullyRead (highFlopStab & turn check-back give-up) and narrows multi-street LAG barrels in maniacCallDown', () => {
    trainWooWooProfile(WOOWOO_ID, 'plo4', 6, 60);
    const read = HorseMind.opponentRead(WOOWOO_ID);
    expect(read).not.toBeNull();
    expect(aggressiveOpenerPressure(read, true, true)!.ipThreeBetBar).toBeLessThan(
      aggressiveOpenerPressure(read, true, false)!.ipThreeBetBar
    );
    expect(aggressiveBettorPressure(read, true)!.valueBarDrop).toBeGreaterThan(
      aggressiveBettorPressure(read, false)!.valueBarDrop
    );

    const stabThenCheckHistory: ActionRecord[] = [
      { stage: 'flop', seat: 1, userId: LAG_SHARK_HORSE, action: 'check', amount: 0, timestamp: 1 },
      { stage: 'flop', seat: 2, userId: WOOWOO_ID, action: 'bet', amount: 12, timestamp: 2 },
      { stage: 'flop', seat: 1, userId: LAG_SHARK_HORSE, action: 'call', amount: 12, timestamp: 3 },
      { stage: 'turn', seat: 1, userId: LAG_SHARK_HORSE, action: 'check', amount: 0, timestamp: 4 },
      { stage: 'turn', seat: 2, userId: WOOWOO_ID, action: 'check', amount: 0, timestamp: 5 },
    ];
    const bullyRead = HorseMind.streetBullyRead(WOOWOO_ID, stabThenCheckHistory);
    expect(bullyRead.highFlopStab).toBe(true);
    expect(bullyRead.stabRate).toBeGreaterThan(0.52);
    expect(bullyRead.checkedTurnAfterFlopStab).toBe(true);
    expect(bullyRead.turnGiveUp).toBe(true);

    // Multi-street barrel narrowing in maniacCallDown:
    // Train BARREL_LAG with ~58% PFR (0.47 < width < 0.62, evidenced) and ~80% betCheckedTo (engaged='high', 0.55 <= betRate < 0.85)
    const BARREL_LAG = '99000000-0000-4000-8000-000000000088';
    const barrelScope = readScopeOf('plo4', 6);
    for (let h = 0; h < 150; h++) {
      const acts: ActionRecord[] = [];
      if ((h * 7) % 12 < 7) {
        acts.push(
          {
            stage: 'preflop',
            seat: 3,
            userId: BARREL_LAG,
            action: 'raise',
            amount: 6,
            isFullRaise: true,
            origin: 'player',
            timestamp: 3,
          },
          {
            stage: 'preflop',
            seat: 2,
            userId: 'bp2',
            action: 'call',
            amount: 4,
            origin: 'horse_policy',
            timestamp: 4,
          },
          {
            stage: 'flop',
            seat: 2,
            userId: 'bp2',
            action: 'check',
            amount: 0,
            origin: 'horse_policy',
            timestamp: 5,
          },
          {
            stage: 'flop',
            seat: 3,
            userId: BARREL_LAG,
            action: h % 5 === 0 ? 'check' : 'bet',
            amount: h % 5 === 0 ? 0 : 8,
            origin: 'player',
            timestamp: 6,
          }
        );
      } else {
        acts.push({
          stage: 'preflop',
          seat: 3,
          userId: BARREL_LAG,
          action: 'fold',
          amount: 0,
          origin: 'player',
          timestamp: 3,
        });
      }
      HorseMind.observeHandComplete(`barrel-lag:${h}`, acts, 2, null, barrelScope);
    }
    HorseMind.setDecisionScope(barrelScope);

    // Triple-barrel spot (flop bet + turn bet + river bet) where hero has fragile bottom pair
    const hero = makeSeat(1, TAG_CRUSHER_HORSE, 'As4d3h2c', { stack: 200 });
    const lagSeat = makeSeat(2, BARREL_LAG, '', {
      stack: 150,
      bet: 48,
      totalInvested: 92,
      is_horse: false,
    });
    const barrelGs: HorseGameStateV2 = {
      players: [
        hero,
        lagSeat,
        makeSeat(3, 'f1', '', { is_folded: true }),
        makeSeat(4, 'f2', '', { is_folded: true }),
        makeSeat(5, 'f3', '', { is_folded: true }),
        makeSeat(6, 'f4', '', { is_folded: true }),
      ],
      communityCards: cards('KsQd9c7s4c'),
      pot: 136,
      currentBet: 48,
      toCall: 48,
      minRaise: 48,
      minRaiseTo: 96,
      maxRaiseTo: 200,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'river',
      gameVariant: 'plo4',
      bettingStructure: 'pot_limit',
      bigBlind: 2,
      dealerSeat: 2,
      gameMode: 'cash',
      actionHistory: [
        {
          stage: 'preflop',
          seat: 2,
          userId: BARREL_LAG,
          action: 'raise',
          amount: 6,
          isFullRaise: true,
          timestamp: 1,
        },
        {
          stage: 'preflop',
          seat: 1,
          userId: hero.user_id,
          action: 'call',
          amount: 6,
          timestamp: 2,
        },
        { stage: 'flop', seat: 1, userId: hero.user_id, action: 'check', amount: 0, timestamp: 3 },
        { stage: 'flop', seat: 2, userId: BARREL_LAG, action: 'bet', amount: 12, timestamp: 4 },
        { stage: 'flop', seat: 1, userId: hero.user_id, action: 'call', amount: 12, timestamp: 5 },
        { stage: 'turn', seat: 1, userId: hero.user_id, action: 'check', amount: 0, timestamp: 6 },
        { stage: 'turn', seat: 2, userId: BARREL_LAG, action: 'bet', amount: 26, timestamp: 7 },
        { stage: 'turn', seat: 1, userId: hero.user_id, action: 'call', amount: 26, timestamp: 8 },
        { stage: 'river', seat: 1, userId: hero.user_id, action: 'check', amount: 0, timestamp: 9 },
        { stage: 'river', seat: 2, userId: BARREL_LAG, action: 'bet', amount: 48, timestamp: 10 },
      ],
    } as unknown as HorseGameStateV2;
    drainFires();
    seedFastRandom(919);
    const narrowDec = HorseLogic.decide(hero, barrelGs, 'tag', {}, { telemetry: true });
    expect(narrowDec.action).toBe('fold');
    expect(drainFires().some((f) => f.feature === 'v86_lag_bully_barrel_narrow')).toBe(true);
  });

  it('hydrates HorseWinnerRead from durable hand_history rows on boot via HorseExploitHydrator', async () => {
    const now = Date.UTC(2026, 10, 10, 22, 0, 0);
    const bootRows = Array.from({ length: 1400 }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, '0')}`,
      created_at: new Date(now - (1500 - i) * 30_000).toISOString(),
      game_variant: 'plo4',
      big_blind: 2,
      players: [
        { userId: TAG_WINNER_ID, seat: 1, net: 6 },
        { userId: LAG_SHARK_HORSE, seat: 2, net: -6 },
      ],
      actions: [
        {
          userId: TAG_WINNER_ID,
          action: 'small_blind',
          amount: 1,
          stage: 'preflop',
          origin: 'player',
        },
        {
          userId: LAG_SHARK_HORSE,
          action: 'big_blind',
          amount: 2,
          stage: 'preflop',
          origin: 'horse_policy',
        },
        {
          userId: TAG_WINNER_ID,
          action: 'raise',
          amount: 6,
          isFullRaise: true,
          stage: 'preflop',
          origin: 'player',
        },
        {
          userId: LAG_SHARK_HORSE,
          action: 'fold',
          amount: 0,
          stage: 'preflop',
          origin: 'horse_policy',
        },
      ],
    })).sort((a, b) => b.created_at.localeCompare(a.created_at));

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      expect(table).toBe('hand_history');
      let cursorAt: string | null = null;
      let lim = 1000;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        gt: () => b,
        lte: () => b,
        order: () => b,
        limit: (n: number) => {
          lim = n;
          return b;
        },
        or: (expr: string) => {
          const m = /created_at\.lt\.([^,]+),/.exec(expr);
          cursorAt = m ? m[1] : null;
          return b;
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          const start = cursorAt ? bootRows.findIndex((r) => r.created_at < cursorAt!) : 0;
          const slice = start < 0 ? [] : bootRows.slice(start, start + lim);
          return Promise.resolve({ data: slice, error: null }).then(resolve, reject);
        },
      };
      return b;
    }) as never);

    resetWinnerReads();
    HorseMind.reset();
    expect(isProvenWinner(TAG_WINNER_ID)).toBe(false);

    const hydrated = await hydrateHorseExploitReads(now);
    expect(hydrated.hands).toBe(1400);
    expect(isProvenWinner(TAG_WINNER_ID)).toBe(true);
  });

  it('assigns deterministic tuner-immune ploPersonaFor styles and reloads at 80% buy-in on $2/$5+ PLO cash tables', async () => {
    // 1. Determinism and full 4-archetype coverage + tuner immunity
    expect(ploPersonaFor(LAG_SHARK_HORSE)).toEqual(ploPersonaFor(LAG_SHARK_HORSE));
    expect(ploPersonaFor(LAG_SHARK_HORSE).archetype).toBe('lag_shark');
    expect(ploPersonaFor(TRICKY_TRAP_HORSE).archetype).toBe('tricky_trap');
    expect(ploPersonaFor(TAG_CRUSHER_HORSE).archetype).toBe('tag_crusher');
    expect(ploPersonaFor(NIT_HUNTER_HORSE).archetype).toBe('nit_hunter');

    const basePersona = defaultPersonaFor(LAG_SHARK_HORSE);
    const tuned = diagnoseAndNudge(
      {
        ...freshPlay(),
        hands: 500,
        vpip: 200,
        pfr: 130,
        threeBets: 30,
        threeBetOpps: 180,
        openRaises: 100,
        foldTo3Bets: 12,
        faced3Bets: 25,
        sawFlop: 150,
        wonWhenSawFlop: 69,
        postAggr: 120,
        postPassive: 60,
        netBB: -20,
      },
      { tightness: 1, aggression: 1, bluffFreq: 1 },
      null,
      0,
      {},
      { leaksHands: 200, omahaShare: 1 }
    );
    expect(tuned.mods).not.toHaveProperty('persona');
    expect(ploPersonaFor(LAG_SHARK_HORSE)).toEqual(ploPersonaFor(LAG_SHARK_HORSE));
    expect(defaultPersonaFor(LAG_SHARK_HORSE)).toEqual(basePersona);

    // 2. HorseSessionRotator $2/$5+ (bb = 5) PLO top-up at 70% buy-in (< 0.80 threshold, > 0.45 legacy threshold)
    const now = Date.parse('2026-11-10T20:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < TOPUP_PROB

    const tablePlo25 = {
      id: 'table-plo-25',
      game_variant: 'plo4',
      big_blind: 5,
      small_blind: 2.5,
      min_buy_in: 200,
      max_buy_in: 500, // referenceBuyIn(5, 200, 500) = 500; 70% stack = 350 (< 400 = 0.80 * 500, > 225 = 0.45 * 500)
      tournament_id: null,
      status: 'running',
      settings: {},
      cluster_id: null,
      lifecycle: 'live',
      created_at: new Date(now - 3600_000).toISOString(),
      max_players: 6,
      is_deleted: false,
    };
    const tableNlh25 = {
      ...tablePlo25,
      id: 'table-nlh-25',
      game_variant: 'nlh',
    };
    const tablePlo12 = {
      ...tablePlo25,
      id: 'table-plo-12',
      big_blind: 2,
      small_blind: 1,
      min_buy_in: 80,
      max_buy_in: 200, // 70% stack = 140 (< 0.80 * 200, > 0.45 * 200), bb < 5 -> does NOT reload!
    };

    const clubId = '00000000-0000-0000-0000-000000000000';
    const seatRows = [
      {
        id: 'seat-plo-lag',
        table_id: tablePlo25.id,
        user_id: LAG_SHARK_HORSE,
        seat_number: 1,
        stack: 350, // 70bb: reloads under 0.80 PLO $2/$5+ rule!
        joined_at: new Date(now - 45 * 60_000).toISOString(),
        club_id: clubId,
        leave_pending: false,
        is_sitting_out: false,
        left_at: null,
        auto_rebuy: false,
        tables: tablePlo25,
      },
      {
        id: 'seat-plo-nit',
        table_id: tablePlo25.id,
        user_id: NIT_HUNTER_HORSE,
        seat_number: 2,
        stack: 350, // 70bb with nit_hunter archetype -> stays on 0.45 threshold, does NOT reload!
        joined_at: new Date(now - 45 * 60_000).toISOString(),
        club_id: clubId,
        leave_pending: false,
        is_sitting_out: false,
        left_at: null,
        auto_rebuy: false,
        tables: tablePlo25,
      },
      {
        id: 'seat-nlh-lag',
        table_id: tableNlh25.id,
        user_id: TAG_CRUSHER_HORSE,
        seat_number: 1,
        stack: 350, // 70bb at NLH $2/$5 (V87): active deep style also reloads to 100bb!
        joined_at: new Date(now - 45 * 60_000).toISOString(),
        club_id: clubId,
        leave_pending: false,
        is_sitting_out: false,
        left_at: null,
        auto_rebuy: false,
        tables: tableNlh25,
      },
      {
        id: 'seat-plo-12-lag',
        table_id: tablePlo12.id,
        user_id: TRICKY_TRAP_HORSE,
        seat_number: 1,
        stack: 140, // 70bb at $1/$2 (bb < 5): above 0.45 threshold -> does NOT reload!
        joined_at: new Date(now - 45 * 60_000).toISOString(),
        club_id: clubId,
        leave_pending: false,
        is_sitting_out: false,
        left_at: null,
        auto_rebuy: false,
        tables: tablePlo12,
      },
    ];
    const dbTables: Record<string, Record<string, unknown>[]> = {
      table_seats: seatRows,
      profiles: [
        { id: LAG_SHARK_HORSE, is_horse: true, diamonds: 200_000 },
        { id: NIT_HUNTER_HORSE, is_horse: true, diamonds: 200_000 },
        { id: TAG_CRUSHER_HORSE, is_horse: true, diamonds: 200_000 },
        { id: TRICKY_TRAP_HORSE, is_horse: true, diamonds: 200_000 },
      ],
      club_members: [
        { club_id: clubId, user_id: LAG_SHARK_HORSE, chip_balance: 200_000 },
        { club_id: clubId, user_id: NIT_HUNTER_HORSE, chip_balance: 200_000 },
        { club_id: clubId, user_id: TAG_CRUSHER_HORSE, chip_balance: 200_000 },
        { club_id: clubId, user_id: TRICKY_TRAP_HORSE, chip_balance: 200_000 },
      ],
      chip_ledger: [],
      table_waitlist: [],
      cash_game_waitlist: [],
      cash_games: [],
      cash_seat_moves: [],
      hand_history: [],
      tournament_players: [],
      tables: [tablePlo25, tableNlh25, tablePlo12],
    };

    vi.spyOn(supabase, 'from').mockImplementation(((name: string) => {
      let rows = [...(dbTables[name] ?? [])];
      let lim = Infinity;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
        in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), b),
        is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b),
        gt: () => b,
        gte: () => b,
        lte: () => b,
        not: () => b,
        order: () => b,
        limit: (n: number) => ((lim = n), b),
        range: () => b,
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows.slice(0, lim), error: null }).then(ok, bad),
      };
      return b;
    }) as never);
    vi.spyOn(supabase, 'rpc').mockImplementation((() =>
      Promise.resolve({ data: null, error: { message: 'none' } })) as never);

    const addChipsPlo = vi.fn(async () => ({ success: true }));
    const addChipsNlh = vi.fn(async () => ({ success: true }));
    const addChipsPlo12 = vi.fn(async () => ({ success: true }));
    const engines: Record<string, RotatorEngine> = {
      [tablePlo25.id]: {
        leaveTable: vi.fn(() => ({ success: true })),
        sitOut: vi.fn(() => ({ success: true })),
        addChips: addChipsPlo,
        hitRunHandsOwed: () => 5,
        isClientSitOut: () => false,
      },
      [tableNlh25.id]: {
        leaveTable: vi.fn(() => ({ success: true })),
        sitOut: vi.fn(() => ({ success: true })),
        addChips: addChipsNlh,
        hitRunHandsOwed: () => 5,
        isClientSitOut: () => false,
      },
      [tablePlo12.id]: {
        leaveTable: vi.fn(() => ({ success: true })),
        sitOut: vi.fn(() => ({ success: true })),
        addChips: addChipsPlo12,
        hitRunHandsOwed: () => 5,
        isClientSitOut: () => false,
      },
    };

    const rotator = new HorseSessionRotator((tid) => engines[tid]) as unknown as {
      isRunning: boolean;
      lifecycleGeneration: number;
      rotate(gen: number): Promise<void>;
    };
    rotator.isRunning = true;
    rotator.lifecycleGeneration = 1;
    await rotator.rotate(1);
    vi.useRealTimers();

    expect(addChipsPlo).toHaveBeenCalledTimes(1);
    expect(addChipsPlo).toHaveBeenCalledWith(LAG_SHARK_HORSE, 150);
    expect(addChipsNlh).toHaveBeenCalledWith(TAG_CRUSHER_HORSE, 150);
    expect(addChipsPlo12).not.toHaveBeenCalled();
  });

  it('emits & registers all 3 V86 PLO leak tags in HorseHandReview / HorseDataLedger and isolates OMAHA_CASH_VPIP_HI = 0.44 in HorseSelfTuner', () => {
    // 1. Ledger registrations
    const consumerKeys = new Set(TAG_CONSUMERS.map((t) => t.key));
    expect(consumerKeys.has('plo_underboat_stackoff')).toBe(true);
    expect(consumerKeys.has('plo_multiboard_dead_half_call')).toBe(true);
    expect(consumerKeys.has('plo_passive_rundown_oop')).toBe(true);
    expect(HORSE_DATA_LEDGER.some((e) => e.key === 'v86PloOverhaul')).toBe(true);

    // 2. Detect plo_underboat_stackoff (100bb+ bottom full house beaten by >=2 higher boats)
    const underboatLeaks = detectLeaks({
      variant: 'plo4',
      bigBlind: 2,
      netBB: -110,
      invested: 220,
      holeCards: cards('2s2cAhTd'),
      board: cards('KsKdQh7c2d'),
      heroActions: [
        { stage: 'preflop', action: 'call', amount: 6 },
        { stage: 'river', action: 'call', amount: 214 },
      ],
      wentToShowdown: true,
    });
    expect(underboatLeaks).toContain('plo_underboat_stackoff');

    // 3. Detect plo_multiboard_dead_half_call via buildReviewRows (double-board passive calldown >= 40bb with <= 1 pair on Board 2)
    const reviewRows = buildReviewRows({
      handId: 'mb-review-1',
      tableId: 'table-mb-1',
      gameVariant: 'plo4',
      bigBlind: 2,
      playedAt: '2026-11-10T22:00:00Z',
      boards: [
        cards('Qs9s2s4d8c'), // Board 1: nut flush
        cards('9s8d4c3h2d'), // Board 2: high card AK <= CAT_ONE_PAIR
      ],
      holeCardsAll: new Map([
        [TAG_CRUSHER_HORSE, { seat: 1, cards: cards('AsKsJdTc') }],
        [WOOWOO_ID, { seat: 2, cards: cards('9h9d8h8c') }],
      ]),
      contributions: new Map([
        [TAG_CRUSHER_HORSE, 120],
        [WOOWOO_ID, 120],
      ]),
      winners: [{ userId: WOOWOO_ID, amount: 240 }],
      roster: [
        { userId: TAG_CRUSHER_HORSE, isHorse: true },
        { userId: WOOWOO_ID, isHorse: false },
      ],
      actions: [
        { seat: 2, userId: WOOWOO_ID, stage: 'flop', action: 'bet', amount: 20 },
        { seat: 1, userId: TAG_CRUSHER_HORSE, stage: 'flop', action: 'call', amount: 20 },
        { seat: 2, userId: WOOWOO_ID, stage: 'turn', action: 'bet', amount: 40 },
        { seat: 1, userId: TAG_CRUSHER_HORSE, stage: 'turn', action: 'call', amount: 40 },
        { seat: 2, userId: WOOWOO_ID, stage: 'river', action: 'bet', amount: 60 },
        { seat: 1, userId: TAG_CRUSHER_HORSE, stage: 'river', action: 'call', amount: 60 },
      ],
    });
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0].leak_tags).toContain('plo_multiboard_dead_half_call');

    // 4. Detect plo_passive_rundown_oop (JT98ds cold-called preflop + zero postflop raises in >=20bb pot)
    const passiveRundownLeaks = detectLeaks({
      variant: 'plo4',
      bigBlind: 2,
      netBB: -30,
      invested: 60,
      holeCards: cards('JcTc9h8h'),
      board: cards('KsQd4c2s7d'),
      heroActions: [
        { stage: 'preflop', action: 'call', amount: 6 },
        { stage: 'flop', action: 'call', amount: 18 },
        { stage: 'turn', action: 'call', amount: 36 },
      ],
      wentToShowdown: true,
    });
    expect(passiveRundownLeaks).toContain('plo_passive_rundown_oop');

    // 5. HorseSelfTuner OMAHA_CASH_VPIP_HI = 0.44 isolation & new tag responses
    expect(OMAHA_CASH_VPIP_HI).toBe(0.44);
    const ploStats: PlayStats = {
      ...freshPlay(),
      hands: 400,
      vpip: 160, // 40% VPIP: healthy in 6-max PLO (< 0.44), too loose in NLH (> 0.32)
      pfr: 104,
      threeBets: 24,
      threeBetOpps: 160,
      openRaises: 80,
      foldTo3Bets: 12,
      faced3Bets: 25,
      sawFlop: 120,
      wonWhenSawFlop: 55,
      postAggr: 100,
      postPassive: 50,
      netBB: -20, // -5 bb/100 (above -15 regression floor, isolates pure VPIP ceiling test)
    };
    const asNlh = diagnoseAndNudge(
      ploStats,
      { tightness: 1, aggression: 1, bluffFreq: 1 },
      null,
      0,
      null,
      { omahaShare: 0 }
    );
    const asPlo = diagnoseAndNudge(
      ploStats,
      { tightness: 1, aggression: 1, bluffFreq: 1 },
      null,
      0,
      null,
      { omahaShare: 1 }
    );
    expect(asNlh.mods.tightness).toBeGreaterThan(1);
    expect(asPlo.mods.tightness).toBe(1); // 40% VPIP is NOT tightened when omahaShare === 1!

    // New PLO leak tags nudge tightness / aggression appropriately
    const nudgedLeaks = diagnoseAndNudge(
      ploStats,
      { tightness: 1, aggression: 1, bluffFreq: 1 },
      null,
      0,
      {
        plo_underboat_stackoff: 5,
        plo_multiboard_dead_half_call: 4,
        plo_passive_rundown_oop: 8,
      },
      { leaksHands: 100, omahaShare: 1 }
    );
    expect(nudgedLeaks.mods.tightness).toBeGreaterThan(1);
    expect(nudgedLeaks.mods.aggression).toBeGreaterThan(0.95);
    expect(nudgedLeaks.reasons.some((r) => r.includes('passive PLO rundowns'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. MULTI-HAND HORSES VS WOOWOO-ARCHETYPE LAG SIMULATION BENCHMARK
// ═══════════════════════════════════════════════════════════════════════════
describe('V86 5. Multi-hand Horses vs WooWoo-archetype LAG (80/46/66%/48%) simulation benchmark across PLO4, PLO5, PLO6, PLO8, & Double-Board Bomb Pots', () => {
  const DECK_RANKS: CardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const DECK_SUITS: CardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

  function dealShuffledDeck(rng: () => number): Card[] {
    const deck: Card[] = [];
    for (const rank of DECK_RANKS) {
      for (const suit of DECK_SUITS) deck.push({ rank, suit });
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  it('actively 3-bets, squeezes, check-raise traps, turn-probes give-ups, and folds dominated rivers across all 5 Omaha formats', () => {
    const rng = mulberry32(2026_11_10);
    const variants = ['plo4', 'plo5', 'plo6', 'plo8', 'double_board_bomb'] as const;

    let threeBets = 0;
    let squeezes = 0;
    let checkRaiseTraps = 0;
    let turnProbeTakeaways = 0;
    let disciplinedRiverFolds = 0;
    const activeVariants = new Set<string>();

    for (const v of variants) {
      const gameVariant = v === 'double_board_bomb' ? 'plo4' : v;
      const holeCount = gameVariant === 'plo6' ? 6 : gameVariant === 'plo5' ? 5 : 4;
      HorseMind.reset();
      resetWinnerReads();
      trainWooWooProfile(WOOWOO_ID, gameVariant, 6, 60);
      trainProvenWinner(WOOWOO_ID, 1500, 1.4, 2);

      for (let hand = 0; hand < 36; hand++) {
        seedFastRandom(50_000 + hand * 31 + variants.indexOf(v) * 1000);
        const deck = dealShuffledDeck(rng);
        let ptr = 0;
        const draw = (n: number) => {
          const slice = deck.slice(ptr, ptr + n);
          ptr += n;
          return slice;
        };

        const horseId = hand % 2 === 0 ? LAG_SHARK_HORSE : TRICKY_TRAP_HORSE;
        const heroCards = draw(holeCount);
        const board1 = draw(5);
        const board2 = draw(5);

        if (v === 'double_board_bomb') {
          // Double-Board Bomb Pot spot: WooWoo stabs flop or pots river when hero has one weak board
          const isRiver = hand % 2 === 1;
          const bet = isRiver ? 32 : 12;
          const potBefore = isRiver ? 40 : 16;
          const hero = {
            ...makeSeat(2, horseId, ''),
            cards: heroCards,
            stack: 240,
          };
          const woowoo = makeSeat(1, WOOWOO_ID, '', {
            stack: 240 - bet,
            bet,
            totalInvested: 8 + bet,
            is_horse: false,
          });
          const gs: HorseGameStateV2 = {
            players: [woowoo, hero],
            communityCards: isRiver ? board1 : board1.slice(0, 3),
            communityCards2: isRiver ? board2 : board2.slice(0, 3),
            boardCount: 2,
            bombPot: true,
            pot: potBefore + bet,
            currentBet: bet,
            toCall: bet,
            minRaise: bet,
            minRaiseTo: bet * 2,
            maxRaiseTo: bet + potBefore + bet * 2,
            legalActions: ['fold', 'call', 'raise'],
            stage: isRiver ? 'river' : 'flop',
            gameVariant: 'plo4',
            bettingStructure: 'pot_limit',
            bigBlind: 2,
            dealerSeat: 2,
            gameMode: 'cash',
            actionHistory: [
              {
                stage: isRiver ? 'river' : 'flop',
                seat: 1,
                userId: WOOWOO_ID,
                action: 'bet',
                amount: bet,
                timestamp: 1,
              },
            ],
          } as unknown as HorseGameStateV2;
          const dec = HorseLogic.decide(hero, gs, 'lag', {});
          if (isRiver && dec.action === 'fold') disciplinedRiverFolds++;
          if (!isRiver && dec.action === 'raise') checkRaiseTraps++;
          activeVariants.add(v);
          continue;
        }

        // Phase A: Preflop vs WooWoo 46% PFR open (and every 3rd hand + loose caller for squeeze opportunity)
        const hasCaller = hand % 3 === 0;
        const heroPre = { ...makeSeat(3, horseId, ''), cards: heroCards, stack: 200 };
        const wooPre = makeSeat(1, WOOWOO_ID, '', {
          stack: 194,
          bet: 6,
          totalInvested: 6,
          is_horse: false,
        });
        const callerSeat = makeSeat(2, '66000000-0000-4000-8000-000000000002', '', {
          stack: hasCaller ? 194 : 200,
          bet: hasCaller ? 6 : 0,
          totalInvested: hasCaller ? 6 : 0,
          is_folded: !hasCaller,
        });
        const preGs: HorseGameStateV2 = {
          players: [
            wooPre,
            callerSeat,
            heroPre,
            makeSeat(4, 'sb', '', { bet: 1, totalInvested: 1, is_folded: true }),
            makeSeat(5, 'bb', '', { bet: 2, totalInvested: 2, is_folded: true }),
            makeSeat(6, 'utg', '', { is_folded: true }),
          ],
          communityCards: [],
          pot: hasCaller ? 15 : 9,
          currentBet: 6,
          toCall: 6,
          minRaise: 6,
          minRaiseTo: 12,
          maxRaiseTo: hasCaller ? 27 : 21,
          legalActions: ['fold', 'call', 'raise'],
          stage: 'preflop',
          gameVariant,
          bettingStructure: 'pot_limit',
          variantRules: horseVariantRulesFor(gameVariant),
          bigBlind: 2,
          dealerSeat: 3,
          gameMode: 'cash',
          actionHistory: [
            {
              stage: 'preflop',
              seat: 1,
              userId: WOOWOO_ID,
              action: 'raise',
              amount: 6,
              isFullRaise: true,
              timestamp: 3,
            },
            ...(hasCaller
              ? [
                  {
                    stage: 'preflop',
                    seat: 2,
                    userId: callerSeat.user_id,
                    action: 'call',
                    amount: 6,
                    timestamp: 4,
                  } satisfies ActionRecord,
                ]
              : []),
          ],
        } as unknown as HorseGameStateV2;

        const preDec = HorseLogic.decide(heroPre, preGs, 'lag', {});
        if (preDec.action === 'raise') {
          if (hasCaller) squeezes++;
          else threeBets++;
          activeVariants.add(v);
        }

        // Phase B: Postflop OOP check-to-trap vs WooWoo 66% flop stab -> check-raise
        if (hand % 3 === 1) {
          const heroFlop = { ...makeSeat(1, TRICKY_TRAP_HORSE, ''), cards: heroCards, stack: 185 };
          const wooFlop = makeSeat(2, WOOWOO_ID, '', {
            stack: 173,
            bet: 12,
            totalInvested: 27,
            is_horse: false,
          });
          const flopGs: HorseGameStateV2 = {
            players: [heroFlop, wooFlop],
            communityCards: board1.slice(0, 3),
            pot: 30,
            currentBet: 12,
            toCall: 12,
            minRaise: 12,
            minRaiseTo: 24,
            maxRaiseTo: 66,
            legalActions: ['fold', 'call', 'raise'],
            stage: 'flop',
            gameVariant,
            bettingStructure: 'pot_limit',
            variantRules: horseVariantRulesFor(gameVariant),
            bigBlind: 2,
            dealerSeat: 2,
            gameMode: 'cash',
            actionHistory: [
              {
                stage: 'flop',
                seat: 1,
                userId: heroFlop.user_id,
                action: 'check',
                amount: 0,
                timestamp: 1,
              },
              {
                stage: 'flop',
                seat: 2,
                userId: WOOWOO_ID,
                action: 'bet',
                amount: 12,
                timestamp: 2,
              },
            ],
          } as unknown as HorseGameStateV2;
          const flopDec = HorseLogic.decide(heroFlop, flopGs, 'lag', {});
          if (flopDec.action === 'raise') checkRaiseTraps++;
        }

        // Phase C: Turn probe takeaway after WooWoo stabs flop (66%) and checks back turn (52% give-up)
        if (hand % 3 === 2) {
          const heroTurn = { ...makeSeat(1, LAG_SHARK_HORSE, ''), cards: heroCards, stack: 170 };
          const wooTurn = makeSeat(2, WOOWOO_ID, '', { stack: 170, is_horse: false });
          const turnGs: HorseGameStateV2 = {
            players: [heroTurn, wooTurn],
            communityCards: board1.slice(0, 4),
            pot: 36,
            currentBet: 0,
            toCall: 0,
            minRaise: 2,
            minRaiseTo: 2,
            maxRaiseTo: 36,
            legalActions: ['check', 'bet'],
            stage: 'turn',
            gameVariant,
            bettingStructure: 'pot_limit',
            variantRules: horseVariantRulesFor(gameVariant),
            bigBlind: 2,
            dealerSeat: 2,
            gameMode: 'cash',
            actionHistory: [
              {
                stage: 'flop',
                seat: 1,
                userId: heroTurn.user_id,
                action: 'check',
                amount: 0,
                timestamp: 1,
              },
              {
                stage: 'flop',
                seat: 2,
                userId: WOOWOO_ID,
                action: 'bet',
                amount: 10,
                timestamp: 2,
              },
              {
                stage: 'flop',
                seat: 1,
                userId: heroTurn.user_id,
                action: 'call',
                amount: 10,
                timestamp: 3,
              },
              {
                stage: 'turn',
                seat: 1,
                userId: heroTurn.user_id,
                action: 'check',
                amount: 0,
                timestamp: 4,
              },
              {
                stage: 'turn',
                seat: 2,
                userId: WOOWOO_ID,
                action: 'check',
                amount: 0,
                timestamp: 5,
              },
            ],
          } as unknown as HorseGameStateV2;
          // Next street or OOP probe after turn check-through / IP turn stab when checked to
          const turnProbeGs: HorseGameStateV2 = {
            ...turnGs,
            dealerSeat: 1, // Hero acts after WooWoo's check or probes after give-up history
          };
          const turnDec = HorseLogic.decide(heroTurn, turnProbeGs, 'lag', {});
          if (turnDec.action === 'bet') turnProbeTakeaways++;
        }

        // Phase D: River pot-bet defense discipline
        const heroRiv = { ...makeSeat(1, TAG_CRUSHER_HORSE, ''), cards: heroCards, stack: 200 };
        const wooRiv = makeSeat(2, WOOWOO_ID, '', {
          stack: 160,
          bet: 40,
          totalInvested: 60,
          is_horse: false,
        });
        const rivGs: HorseGameStateV2 = {
          players: [heroRiv, wooRiv, makeSeat(3, 'folder-seat', '', { is_folded: true })],
          communityCards: board1,
          pot: 80,
          currentBet: 40,
          toCall: 40,
          minRaise: 40,
          minRaiseTo: 80,
          maxRaiseTo: 160,
          legalActions: ['fold', 'call', 'raise'],
          stage: 'river',
          gameVariant,
          bettingStructure: 'pot_limit',
          variantRules: horseVariantRulesFor(gameVariant),
          bigBlind: 2,
          dealerSeat: 2,
          gameMode: 'cash',
          actionHistory: [
            {
              stage: 'preflop',
              seat: 3,
              userId: 'folder-seat',
              action: 'fold',
              amount: 0,
              timestamp: 1,
            },
            { stage: 'flop', seat: 2, userId: WOOWOO_ID, action: 'bet', amount: 10, timestamp: 2 },
            {
              stage: 'flop',
              seat: 1,
              userId: heroRiv.user_id,
              action: 'call',
              amount: 10,
              timestamp: 3,
            },
            { stage: 'turn', seat: 2, userId: WOOWOO_ID, action: 'bet', amount: 20, timestamp: 4 },
            {
              stage: 'turn',
              seat: 1,
              userId: heroRiv.user_id,
              action: 'call',
              amount: 20,
              timestamp: 5,
            },
            {
              stage: 'river',
              seat: 1,
              userId: heroRiv.user_id,
              action: 'check',
              amount: 0,
              timestamp: 6,
            },
            { stage: 'river', seat: 2, userId: WOOWOO_ID, action: 'bet', amount: 40, timestamp: 7 },
          ],
        } as unknown as HorseGameStateV2;
        const rivDec = HorseLogic.decide(heroRiv, rivGs, 'tag', {});
        if (rivDec.action === 'fold') disciplinedRiverFolds++;
      }
    }

    expect(activeVariants.size).toBe(5);
    expect(threeBets).toBeGreaterThanOrEqual(8);
    expect(squeezes).toBeGreaterThanOrEqual(4);
    expect(checkRaiseTraps).toBeGreaterThanOrEqual(3);
    expect(turnProbeTakeaways).toBeGreaterThanOrEqual(5);
    expect(disciplinedRiverFolds).toBeGreaterThanOrEqual(40);

    // Ensure legacy handClassRead stays intact for direct callers
    expect(handClassRead(cards('JcTc9h8h'), true, false).cls).toBe('rundown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ROUND-2 AUDIT REGRESSIONS: STICKY-LAG 3-BETS, POSTFLOP COMPLETENESS,
//    MEMORY/HYDRATION/TOP-UP BOUNDARIES, & LIVE WORKER -> HANDCONTROLLER PROOF
// ═══════════════════════════════════════════════════════════════════════════
describe('V86 6. Round-2 Hardening, Boundary Safety, & End-to-End Live Worker -> HandController Regressions', () => {
  it('3-bets and pot-squeezes sticky low-fold-to-3-bet openers (noBluff3 === true) with linear double-suited rundowns and suited-Ace nut hands while gating single-suit rundowns', () => {
    // 5-card 3+2 suit rundown classifies as rundown_ds (Audit E4)
    const plo5ThreePlusTwo = omahaEliteClassRead(cards('JhTh9s8s7h'), false);
    expect(plo5ThreePlusTwo.cls).toBe('rundown_ds');
    expect(plo5ThreePlusTwo.canThreeBet).toBe(true);

    // Sticky opener: foldToThreeBet = 0.003 -> exploitOpener.noBluffThreeBet === true, plus maniacNoBluff = true
    const stickyBase = {
      position: 'late' as const,
      raiserPosition: 'middle' as const,
      raises: 1,
      limpers: 0,
      callers: 0,
      oppsLeft: 2,
      toCall: 6,
      pot: 9,
      currentBet: 6,
      bigBlind: 2,
      stack: 200,
      stackBB: 100,
      effectiveStackBB: 100,
      mode: 'cash' as const,
      isOmaha: true,
      isPotLimit: true,
      isFixedLimit: false,
      isHiLo: false,
      tightness: 1,
      aggression: 1,
      bluffFreq: 1,
      slowplayFreq: 0.1,
      sizingMultiplier: 1,
      riskAdd: 0,
      rand: () => 0.35,
      classNeverThreeBet: false,
      classFoldAlways: false,
      v86PloOverhaul: true,
      ploPersona3BetMix: 0.6,
      plo3BetRoll: 0.25,
      exploitOpener: {
        threeBetBar: 0.62,
        flatBar: 0.38,
        bbFlatBar: 0.32,
        wide: true,
        noBluffThreeBet: true,
      },
      maniacNoBluff: true,
    };

    for (const spec of ['JcTc9h8h', 'KsQsJdTd', 'As8sTd9c']) {
      const hole = cards(spec);
      const elite = omahaEliteClassRead(hole, false);
      const threeBetDec = decidePreflopV7({
        ...stickyBase,
        strength: omahaElitePreflopStrength(hole, false),
        omahaElite: elite,
        classShift: elite.shift,
      } as PreflopCtx);
      expect(threeBetDec.a).toBe('raiseTo');
      expect(threeBetDec.receipt).toBe('v86_plo_elite_three_bet');

      const squeezeDec = decidePreflopV7({
        ...stickyBase,
        position: 'sb',
        raiserPosition: 'early',
        callers: 2,
        pot: 21,
        toCall: 5,
        strength: 0.57,
        omahaElite: elite,
        classShift: { open: 0, threeBet: 0.01, fourBet: 0.02, coldCall: 0, bbDefend: 0 },
        plo3BetRoll: 0.98,
      } as PreflopCtx);
      expect(squeezeDec.a).toBe('raiseTo');
      expect(squeezeDec.receipt).toBe('v86_plo_squeeze');
    }

    // Thinner single-suited rundown (rundown_ss) stays gated behind !noBluff3
    const singleSuit = cards('JcTc9d8s');
    const ssElite = omahaEliteClassRead(singleSuit, false);
    expect(ssElite.cls).toBe('rundown_ss');
    const ssVsSticky = decidePreflopV7({
      ...stickyBase,
      strength: 0.56,
      omahaElite: ssElite,
      classShift: ssElite.shift,
    } as PreflopCtx);
    expect(ssVsSticky.a).toBe('call');
    expect(ssVsSticky.receipt).not.toBe('v86_plo_elite_three_bet');
  });

  it('tightens marginal single-suited EP/MP Omaha opens when a confirmed IP LAG bully sits behind while preserving double-suited opens', () => {
    trainWooWooProfile(WOOWOO_ID, 'plo4', 6, 60);
    expect(HorseMind.isLagBully(WOOWOO_ID)).toBe(true);

    // 6-max table: dealerSeat = 6 (BTN = WOOWOO_ID), SB = 1, BB = 2, UTG = 3 (Hero)
    const marginalSingleSuit = 'JdTd8c5h';
    const doubleSuitedRundown = 'JcTc9h8h';
    const buildEpOpenGs = (heroHole: string, btnUserId: string): HorseGameStateV2 =>
      ({
        players: [
          makeSeat(1, 'sb-seat', '', { bet: 1, totalInvested: 1, stack: 199 }),
          makeSeat(2, 'bb-seat', '', { bet: 2, totalInvested: 2, stack: 198 }),
          makeSeat(3, TAG_CRUSHER_HORSE, heroHole, { bet: 0, totalInvested: 0, stack: 200 }),
          makeSeat(4, 'mp-seat', '', { bet: 0, totalInvested: 0, stack: 200 }),
          makeSeat(5, 'co-seat', '', { bet: 0, totalInvested: 0, stack: 200 }),
          makeSeat(6, btnUserId, '', { bet: 0, totalInvested: 0, stack: 200, is_horse: false }),
        ],
        communityCards: [],
        pot: 3,
        currentBet: 2,
        toCall: 2,
        minRaise: 2,
        minRaiseTo: 4,
        maxRaiseTo: 7,
        legalActions: ['fold', 'call', 'raise'],
        stage: 'preflop',
        gameVariant: 'plo4',
        bettingStructure: 'pot_limit',
        bigBlind: 2,
        dealerSeat: 6,
        gameMode: 'cash',
        actionHistory: [],
      }) as unknown as HorseGameStateV2;

    // Direct PreflopCtx proof: lagBullyIpBehind raises EP single-suit open bar to >= 0.66
    const ssCards = cards(marginalSingleSuit);
    const ssRead = omahaEliteClassRead(ssCards, false);
    const openWithoutBully = decidePreflopV7({
      strength: 0.56,
      position: 'early',
      raiserPosition: null,
      raises: 0,
      limpers: 0,
      callers: 0,
      oppsLeft: 5,
      toCall: 2,
      pot: 3,
      currentBet: 2,
      bigBlind: 2,
      stack: 200,
      stackBB: 100,
      effectiveStackBB: 100,
      mode: 'cash',
      isOmaha: true,
      isPotLimit: true,
      isFixedLimit: false,
      tightness: 1,
      aggression: 1,
      bluffFreq: 1,
      slowplayFreq: 0.1,
      sizingMultiplier: 1,
      riskAdd: 0,
      rand: () => 0.4,
      v86PloOverhaul: true,
      omahaElite: ssRead,
      lagBullyIpBehind: false,
    });
    const foldWithBully = decidePreflopV7({
      strength: 0.56,
      position: 'early',
      raiserPosition: null,
      raises: 0,
      limpers: 0,
      callers: 0,
      oppsLeft: 5,
      toCall: 2,
      pot: 3,
      currentBet: 2,
      bigBlind: 2,
      stack: 200,
      stackBB: 100,
      effectiveStackBB: 100,
      mode: 'cash',
      isOmaha: true,
      isPotLimit: true,
      isFixedLimit: false,
      tightness: 1,
      aggression: 1,
      bluffFreq: 1,
      slowplayFreq: 0.1,
      sizingMultiplier: 1,
      riskAdd: 0,
      rand: () => 0.4,
      v86PloOverhaul: true,
      omahaElite: ssRead,
      lagBullyIpBehind: true,
    });
    expect(openWithoutBully.a).toBe('raiseTo');
    expect(foldWithBully.a).toBe('fold');

    // End-to-end HorseLogic.decide: marginal single-suit folds with IP LAG bully behind, JT98ds still opens
    seedFastRandom(311);
    const epMarginalVsBully = buildEpOpenGs(marginalSingleSuit, WOOWOO_ID);
    expect(
      HorseLogic.decide(epMarginalVsBully.players[2], epMarginalVsBully, 'tag', {}).action
    ).toBe('fold');
    seedFastRandom(311);
    const epDsVsBully = buildEpOpenGs(doubleSuitedRundown, WOOWOO_ID);
    expect(HorseLogic.decide(epDsVsBully.players[2], epDsVsBully, 'tag', {}).action).toBe('raise');
  });

  it('fires turn scare-card nut-blocker probes, native V86 nut-blocker river bluffs (zero PRNG drift, suppressed vs stations), small-pot near-nut river value, v46ShortDeck default, & turnDeadlineMs Hollywood clamp', () => {
    // 1. Turn scare-card nut-blocker probe in 3-way checked turn pot (flush-completing 3rd spade on turn, hero holds As nut spade blocker)
    let sawScareProbe = false;
    for (let s = 400; s < 430; s++) {
      drainFires();
      seedFastRandom(s);
      const villain1 = makeSeat(1, '51000000-0000-4000-8000-000000000001', '', { stack: 200 });
      const villain2 = makeSeat(2, '51000000-0000-4000-8000-000000000002', '', { stack: 200 });
      const hero = makeSeat(3, LAG_SHARK_HORSE, 'AsKd8h3c', { stack: 200 });
      const turnScareGs: HorseGameStateV2 = {
        players: [villain1, villain2, hero],
        communityCards: cards('Qs9s4d2s'), // 3rd spade arrives on turn -> scare.flush
        pot: 24,
        currentBet: 0,
        toCall: 0,
        minRaise: 2,
        minRaiseTo: 2,
        maxRaiseTo: 24,
        legalActions: ['check', 'bet'],
        stage: 'turn',
        gameVariant: 'plo4',
        bettingStructure: 'pot_limit',
        bigBlind: 2,
        dealerSeat: 3,
        gameMode: 'cash',
        actionHistory: [
          {
            stage: 'flop',
            seat: 1,
            userId: villain1.user_id,
            action: 'check',
            amount: 0,
            timestamp: 1,
          },
          {
            stage: 'flop',
            seat: 2,
            userId: villain2.user_id,
            action: 'check',
            amount: 0,
            timestamp: 2,
          },
          {
            stage: 'flop',
            seat: 3,
            userId: hero.user_id,
            action: 'check',
            amount: 0,
            timestamp: 3,
          },
          {
            stage: 'turn',
            seat: 1,
            userId: villain1.user_id,
            action: 'check',
            amount: 0,
            timestamp: 4,
          },
          {
            stage: 'turn',
            seat: 2,
            userId: villain2.user_id,
            action: 'check',
            amount: 0,
            timestamp: 5,
          },
        ],
      } as unknown as HorseGameStateV2;
      const dec = HorseLogic.decide(hero, turnScareGs, 'lag', {}, { telemetry: true });
      const fires = drainFires().map((f) => f.feature);
      if (fires.includes('v86_scare_blocker_probe')) {
        sawScareProbe = true;
        expect(dec.action).toBe('bet');
        break;
      }
    }
    expect(sawScareProbe).toBe(true);

    // 2. Native V86 Omaha nut-blocker river bluff (v86_river_nut_blocker_bluff) + zero PRNG drift + station suppression
    const STATION_ID = '52000000-0000-4000-8000-000000000002';
    const stationScope = readScopeOf('plo4', 2);
    for (let h = 0; h < 40; h++) {
      HorseMind.observeHandComplete(
        `station-train:${h}`,
        [
          {
            stage: 'preflop',
            userId: LAG_SHARK_HORSE,
            action: 'raise',
            amount: 6,
            isFullRaise: true,
            timestamp: 1,
          },
          { stage: 'preflop', userId: STATION_ID, action: 'call', amount: 4, timestamp: 2 },
          { stage: 'flop', userId: LAG_SHARK_HORSE, action: 'bet', amount: 8, timestamp: 3 },
          { stage: 'flop', userId: STATION_ID, action: 'call', amount: 8, timestamp: 4 },
          { stage: 'turn', userId: LAG_SHARK_HORSE, action: 'bet', amount: 16, timestamp: 5 },
          { stage: 'turn', userId: STATION_ID, action: 'call', amount: 16, timestamp: 6 },
          { stage: 'river', userId: LAG_SHARK_HORSE, action: 'bet', amount: 30, timestamp: 7 },
          { stage: 'river', userId: STATION_ID, action: 'call', amount: 30, timestamp: 8 },
        ],
        2,
        null,
        stationScope
      );
    }

    let sawNativeRiverBluff = false;
    for (let pot = 20; pot <= 120; pot += 4) {
      HorseMind.setDecisionScope(stationScope);
      drainFires();
      const oppUnknown = makeSeat(1, '52000000-0000-4000-8000-000000000099', '', { stack: 200 });
      const hero = makeSeat(2, LAG_SHARK_HORSE, 'As4d3h7c', { stack: 200 }); // bare As nut-spade blocker, zero pair (< 0.28 eq)
      const rivBluffGs: HorseGameStateV2 = {
        players: [oppUnknown, hero],
        communityCards: cards('KsJs8s6d2c'), // monotone-flop 3-spade board + blank river -> riverBluffLine === 'none' ('no_story')
        pot,
        currentBet: 0,
        toCall: 0,
        minRaise: 2,
        minRaiseTo: 2,
        maxRaiseTo: pot,
        legalActions: ['check', 'bet'],
        stage: 'river',
        gameVariant: 'plo4',
        bettingStructure: 'pot_limit',
        bigBlind: 2,
        dealerSeat: 2,
        gameMode: 'cash',
        actionHistory: [
          {
            stage: 'preflop',
            seat: 1,
            userId: oppUnknown.user_id,
            action: 'call',
            amount: 2,
            timestamp: 1,
          },
          {
            stage: 'preflop',
            seat: 2,
            userId: hero.user_id,
            action: 'check',
            amount: 0,
            timestamp: 2,
          },
        ],
      } as unknown as HorseGameStateV2;

      seedFastRandom(777);
      const decBluff = HorseLogic.decide(hero, rivBluffGs, 'lag', {}, { telemetry: true });
      const fires = drainFires().map((f) => f.feature);
      if (fires.includes('v86_river_nut_blocker_bluff')) {
        sawNativeRiverBluff = true;
        expect(decBluff.action).toBe('bet');

        // Against calling station (foldToBet.engaged === 'low'), native V86 river bluff is strictly suppressed!
        drainFires();
        seedFastRandom(777);
        const vsStationGs: HorseGameStateV2 = {
          ...rivBluffGs,
          players: [makeSeat(1, STATION_ID, '', { stack: 200 }), hero],
          actionHistory: rivBluffGs.actionHistory!.map((a) =>
            a.seat === 1 ? { ...a, userId: STATION_ID } : a
          ),
        };
        HorseLogic.decide(hero, vsStationGs, 'lag', {}, { telemetry: true });
        expect(drainFires().some((f) => f.feature === 'v86_river_nut_blocker_bluff')).toBe(false);
        break;
      }
    }
    expect(sawNativeRiverBluff).toBe(true);

    // 3. Small-pot (pot <= 10bb) near-nut river value lead (bypasses V11 donk-lead check) & facing-bet raise (v86_small_pot_near_nut_raise)
    const spHero = makeSeat(1, TAG_CRUSHER_HORSE, 'Ks9s4d3c', { stack: 200 }); // K-high second-nut flush on unpaired board
    const spVillain = makeSeat(2, '53000000-0000-4000-8000-000000000003', '', { stack: 200 });
    const smallPotRiverGs: HorseGameStateV2 = {
      players: [spHero, spVillain],
      communityCards: cards('QsJs2s8d5c'),
      pot: 12, // 6bb <= 10bb
      currentBet: 0,
      toCall: 0,
      minRaise: 2,
      minRaiseTo: 2,
      maxRaiseTo: 12,
      legalActions: ['check', 'bet'],
      stage: 'river',
      gameVariant: 'plo4',
      bettingStructure: 'pot_limit',
      bigBlind: 2,
      dealerSeat: 2,
      gameMode: 'cash',
      actionHistory: [
        {
          stage: 'preflop',
          seat: 2,
          userId: spVillain.user_id,
          action: 'raise',
          amount: 4,
          timestamp: 1,
        },
        {
          stage: 'preflop',
          seat: 1,
          userId: spHero.user_id,
          action: 'call',
          amount: 4,
          timestamp: 2,
        },
      ],
    } as unknown as HorseGameStateV2;
    seedFastRandom(612);
    const spDec = HorseLogic.decide(spHero, smallPotRiverGs, 'tag', {}, { telemetry: true });
    expect(spDec.action).toBe('bet');

    // Facing a tiny 2bb bet in a small pot (pot = 16 <= 20 = 10bb): v86_small_pot_near_nut_raise converts passive calls into value raises
    let sawSmallPotNearNutRaise = false;
    for (let s = 600; s < 640; s++) {
      drainFires();
      seedFastRandom(s);
      const spFacingBetGs: HorseGameStateV2 = {
        ...smallPotRiverGs,
        players: [
          spHero,
          makeSeat(2, spVillain.user_id, '', { stack: 196, bet: 4, totalInvested: 8 }),
        ],
        pot: 16,
        currentBet: 4,
        toCall: 4,
        minRaise: 4,
        minRaiseTo: 8,
        maxRaiseTo: 24,
        legalActions: ['fold', 'call', 'raise'],
        actionHistory: [
          ...smallPotRiverGs.actionHistory!,
          {
            stage: 'river',
            seat: 1,
            userId: spHero.user_id,
            action: 'check',
            amount: 0,
            timestamp: 3,
          },
          {
            stage: 'river',
            seat: 2,
            userId: spVillain.user_id,
            action: 'bet',
            amount: 4,
            timestamp: 4,
          },
        ],
      };
      const spRaiseDec = HorseLogic.decide(
        spHero,
        spFacingBetGs,
        'balanced',
        { aggression: 0.4 },
        { telemetry: true }
      );
      if (drainFires().some((f) => f.feature === 'v86_small_pot_near_nut_raise')) {
        sawSmallPotNearNutRaise = true;
        expect(spRaiseDec.action).toBe('raise');
        break;
      }
    }
    expect(sawSmallPotNearNutRaise).toBe(true);

    // 4. Short Deck chart active by default under v86PloOverhaul (unless v46ShortDeck: false)
    const sdHero = makeSeat(2, LAG_SHARK_HORSE, 'JsTs', { stack: 200 });
    const sdPreGs: HorseGameStateV2 = {
      players: [makeSeat(1, 'sd-opp', '', { bet: 2, totalInvested: 2, stack: 198 }), sdHero],
      communityCards: [],
      pot: 4,
      currentBet: 2,
      toCall: 2,
      minRaise: 2,
      minRaiseTo: 4,
      maxRaiseTo: 200,
      legalActions: ['fold', 'call', 'raise'],
      stage: 'preflop',
      gameVariant: 'short_deck',
      bettingStructure: 'no_limit',
      variantRules: horseVariantRulesFor('short_deck'),
      bigBlind: 2,
      dealerSeat: 2,
      gameMode: 'cash',
      actionHistory: [],
    } as unknown as HorseGameStateV2;
    drainFires();
    seedFastRandom(55);
    HorseLogic.decide(sdHero, sdPreGs, 'lag', {}, { telemetry: true });
    expect(drainFires().some((f) => f.feature === 'v86_short_deck_class')).toBe(true);

    drainFires();
    seedFastRandom(55);
    HorseLogic.decide(sdHero, sdPreGs, 'lag', {}, { telemetry: true, v46ShortDeck: false });
    expect(drainFires().some((f) => f.feature === 'v86_short_deck_class')).toBe(false);

    // 5. turnDeadlineMs Hollywood ceiling clamp (never exceeds Math.max(floor, deadlineRemainingMs - 1500), zero PRNG draws)
    const deadlineGs: HorseGameStateV2 = {
      ...smallPotRiverGs,
      pot: 80, // 40bb >= 25bb triggers Hollywood tank eligibility
    };
    let clampedCount = 0;
    for (let i = 0; i < 60; i++) {
      const hSeat = makeSeat(1, `deadline-horse-${i}`, 'AsKs9s4d', { stack: 200 });
      const gsRun: HorseGameStateV2 = { ...deadlineGs, players: [hSeat, spVillain] };
      seedFastRandom(8200 + i);
      const decUnclamped = HorseLogic.decide(hSeat, gsRun, 'lag', {}, { decisionTimeMs: 100_000 });
      const rngUnclamped = saveFastRandom();

      seedFastRandom(8200 + i);
      const decClamped = HorseLogic.decide(
        hSeat,
        gsRun,
        'lag',
        {},
        { decisionTimeMs: 100_000, turnDeadlineMs: 103_800 } // 3800ms remaining -> ceiling = max(350, 2300) = 2300ms
      );
      const rngClamped = saveFastRandom();
      expect(rngClamped).toBe(rngUnclamped);
      expect(decClamped.thinkTime).toBeLessThanOrEqual(2300);
      if (decUnclamped.thinkTime > 2300) clampedCount++;
    }
    expect(clampedCount).toBeGreaterThan(5);
  });

  it('guarantees hydrateHorseExploitReads idempotency, observerReads winnerReads persistence across dealtCount churn, & flop-only highFlopStab', async () => {
    // 1. hydrateHorseExploitReads 100% idempotency + cash vs tournament separation
    const now = Date.UTC(2026, 10, 10, 23, 0, 0);
    const tableUuid = '11111111-2222-4333-8444-555555555555';
    const TOURNEY_WINNER = '99000000-0000-4000-8000-000000000091';
    const rows = [
      ...Array.from({ length: 340 }, (_, i) => ({
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}`,
        table_id: tableUuid,
        hand_number: i + 1,
        tournament_id: null,
        created_at: new Date(now - (800 - i) * 10_000).toISOString(),
        game_variant: 'plo4',
        big_blind: 2,
        players: [
          { userId: TAG_WINNER_ID, seat: 1, net: 8 },
          { userId: LAG_SHARK_HORSE, seat: 2, net: -8 },
        ],
        actions: [
          {
            userId: TAG_WINNER_ID,
            action: 'raise',
            amount: 6,
            isFullRaise: true,
            stage: 'preflop',
            origin: 'player',
          },
          {
            userId: LAG_SHARK_HORSE,
            action: 'fold',
            amount: 0,
            stage: 'preflop',
            origin: 'horse_policy',
          },
        ],
      })),
      ...Array.from({ length: 340 }, (_, i) => ({
        id: `cccccccc-cccc-4ccc-8ccc-${String(i + 1).padStart(12, '0')}`,
        table_id: tableUuid,
        hand_number: 5000 + i,
        tournament_id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
        created_at: new Date(now - (400 - i) * 10_000).toISOString(),
        game_variant: 'plo4',
        big_blind: 100,
        players: [
          { userId: TOURNEY_WINNER, seat: 1, net: 400 },
          { userId: LAG_SHARK_HORSE, seat: 2, net: -400 },
        ],
        actions: [
          {
            userId: TOURNEY_WINNER,
            action: 'raise',
            amount: 250,
            isFullRaise: true,
            stage: 'preflop',
            origin: 'player',
          },
          {
            userId: LAG_SHARK_HORSE,
            action: 'fold',
            amount: 0,
            stage: 'preflop',
            origin: 'horse_policy',
          },
        ],
      })),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      expect(table).toBe('hand_history');
      let cursorAt: string | null = null;
      let lim = 1000;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        gt: () => b,
        lte: () => b,
        order: () => b,
        limit: (n: number) => ((lim = n), b),
        or: (expr: string) => {
          const m = /created_at\.lt\.([^,]+),/.exec(expr);
          cursorAt = m ? m[1] : null;
          return b;
        },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
          const start = cursorAt ? rows.findIndex((r) => r.created_at < cursorAt!) : 0;
          const slice = start < 0 ? [] : rows.slice(start, start + lim);
          return Promise.resolve({ data: slice, error: null }).then(ok, bad);
        },
      };
      return b;
    }) as never);

    resetWinnerReads();
    HorseMind.reset();
    const firstHydrate = await hydrateHorseExploitReads(now);
    expect(firstHydrate.hands).toBe(340); // cash hands merged into exploitCounters; tournament hands excluded
    const countersAfterFirst = structuredClone(
      HorseMind.getExploitCounters(TAG_WINNER_ID, readScopeOf('plo4', 2))
    );
    const readoutAfterFirst = winnerReadout(TAG_WINNER_ID, winnerReadScopeOf('plo4', 'cash'));
    expect(isProvenWinner(TAG_WINNER_ID, winnerReadScopeOf('plo4', 'cash'))).toBe(true);
    // Tournament hands must NOT pollute cash or unscoped winner reads
    expect(isProvenWinner(TOURNEY_WINNER, winnerReadScopeOf('plo4', 'cash'))).toBe(false);
    expect(isProvenWinner(TOURNEY_WINNER)).toBe(false);
    expect(isProvenWinner(TOURNEY_WINNER, winnerReadScopeOf('plo4', 'tournament'))).toBe(true);

    // Calling hydrateHorseExploitReads a second time is a 100% idempotent no-op
    const secondHydrate = await hydrateHorseExploitReads(now);
    expect(secondHydrate.hands).toBe(0);
    expect(HorseMind.getExploitCounters(TAG_WINNER_ID, readScopeOf('plo4', 2))).toEqual(
      countersAfterFirst
    );
    expect(winnerReadout(TAG_WINNER_ID, winnerReadScopeOf('plo4', 'cash'))).toEqual(
      readoutAfterFirst
    );
    vi.restoreAllMocks();

    // 2. observerReads shares winnerReads across dealtCount changes (2 -> 4 -> 6) while isolating other observers
    const clock = { t: 1_000 };
    const obsBank = new HorseObserverReads(32, 1024, () => clock.t);
    const OBS_HORSE_A = LAG_SHARK_HORSE;
    const OBS_HORSE_B = TRICKY_TRAP_HORSE;
    const CRUSHER_OPP = '61000000-0000-4000-8000-000000000001';
    const leaseId = '50000000-0000-4000-8000-000000000086';

    const makeObsReq = (
      observerId: string,
      dealtCount: number,
      handNum: number
    ): FastHorseDecisionRequest => {
      const dealtSeatIds = Array.from({ length: dealtCount }, (_, idx) => idx + 1);
      const seatPlayers = dealtSeatIds.map((s) => ({
        seat: s,
        user_id: s === 1 ? observerId : s === 2 ? CRUSHER_OPP : `seat-filler-${s}`,
      }));
      return {
        type: 'DECIDE_FAST',
        requestId: handNum,
        generation: 1,
        fence: `${tableUuid}:${handNum}:1:${leaseId}:1`,
        decisionKey: '',
        decisionTimeMs: clock.t + 10,
        handJournalContext: captureHorseHandJournalContext([]),
        player: seatPlayers[0],
        gameState: {
          gameVariant: 'plo4',
          format: 'cash',
          gameMode: 'cash',
          dealtSeatIds,
          players: seatPlayers,
        },
      } as never;
    };

    // Touch dealtCount = 2, then stream 310 winning hands across dealtCount = 2, 4, and 6
    obsBank.run(makeObsReq(OBS_HORSE_A, 2, 1), () => undefined);
    for (let h = 1; h <= 310; h++) {
      const dc = h <= 110 ? 2 : h <= 210 ? 4 : 6;
      clock.t += 50;
      obsBank.run(makeObsReq(OBS_HORSE_A, dc, h), () => undefined);
      const done: ObserveCompletedHandRequest = {
        type: 'OBSERVE_COMPLETED_HAND',
        requestId: 10_000 + h,
        generation: h,
        fence: `${tableUuid}:${h}:${leaseId}:observe`,
        handKey: `${tableUuid}:${h}`,
        committedHandId: `eeeeeeee-eeee-4eee-8eee-${String(h).padStart(12, '0')}`,
        actions: [],
        bigBlind: 2,
        results: [
          { user_id: CRUSHER_OPP, net: 10 },
          { user_id: OBS_HORSE_A, net: -10 },
        ],
      };
      obsBank.complete(done, () => undefined);
    }

    clock.t += 50;
    // Despite seat-count churn (2 -> 4 -> 6 -> 3), OBS_HORSE_A retains all 310 hands in sharedWinnerBanks!
    obsBank.run(makeObsReq(OBS_HORSE_A, 3, 999), () => {
      expect(isProvenWinner(CRUSHER_OPP, winnerReadScopeOf('plo4', 'cash'))).toBe(true);
    });
    // OBS_HORSE_B never observed those hands -> isolated sandbox remains empty!
    obsBank.run(makeObsReq(OBS_HORSE_B, 3, 999), () => {
      expect(isProvenWinner(CRUSHER_OPP, winnerReadScopeOf('plo4', 'cash'))).toBe(false);
    });

    // 3. Flop-only highFlopStab (not inflated by turn/river delayed stabs, not diluted by turn/river check-backs) & guarded turnGiveUp
    HorseMind.reset();
    const DELAYED_STABBER = '62000000-0000-4000-8000-000000000001';
    const FLOP_STABBER = '62000000-0000-4000-8000-000000000002';
    const scope6 = readScopeOf('plo4', 6);

    for (let h = 0; h < 20; h++) {
      // DELAYED_STABBER: checks back 100% of flops (0/20 flop stabs), then bets 100% of turns & rivers when checked to
      HorseMind.observeHandComplete(
        `delayed:${h}`,
        [
          { stage: 'preflop', userId: DELAYED_STABBER, action: 'call', amount: 2, timestamp: 1 },
          { stage: 'preflop', userId: 'bb-p', action: 'check', amount: 0, timestamp: 2 },
          { stage: 'flop', userId: 'bb-p', action: 'check', amount: 0, timestamp: 3 },
          { stage: 'flop', userId: DELAYED_STABBER, action: 'check', amount: 0, timestamp: 4 },
          { stage: 'turn', userId: 'bb-p', action: 'check', amount: 0, timestamp: 5 },
          { stage: 'turn', userId: DELAYED_STABBER, action: 'bet', amount: 4, timestamp: 6 },
          { stage: 'turn', userId: 'bb-p', action: 'call', amount: 4, timestamp: 7 },
          { stage: 'river', userId: 'bb-p', action: 'check', amount: 0, timestamp: 8 },
          { stage: 'river', userId: DELAYED_STABBER, action: 'bet', amount: 10, timestamp: 9 },
        ],
        2,
        null,
        scope6
      );

      // FLOP_STABBER: stabs 75% of flops (15/20), then checks back 100% of turns & rivers (which previously diluted pooled betCheckedTo below 0.30!)
      const stabs = h % 4 !== 0;
      HorseMind.observeHandComplete(
        `flop-only:${h}`,
        [
          { stage: 'preflop', userId: FLOP_STABBER, action: 'call', amount: 2, timestamp: 1 },
          { stage: 'preflop', userId: 'bb-p', action: 'check', amount: 0, timestamp: 2 },
          { stage: 'flop', userId: 'bb-p', action: 'check', amount: 0, timestamp: 3 },
          {
            stage: 'flop',
            userId: FLOP_STABBER,
            action: stabs ? 'bet' : 'check',
            amount: stabs ? 4 : 0,
            timestamp: 4,
          },
          ...(stabs
            ? [
                { stage: 'flop', userId: 'bb-p', action: 'call', amount: 4, timestamp: 5 },
                { stage: 'turn', userId: 'bb-p', action: 'check', amount: 0, timestamp: 6 },
                { stage: 'turn', userId: FLOP_STABBER, action: 'check', amount: 0, timestamp: 7 },
                { stage: 'river', userId: 'bb-p', action: 'check', amount: 0, timestamp: 8 },
                { stage: 'river', userId: FLOP_STABBER, action: 'check', amount: 0, timestamp: 9 },
              ]
            : []),
        ],
        2,
        null,
        scope6
      );
    }
    HorseMind.setDecisionScope(scope6);

    const singleStabThenCheck: ActionRecord[] = [
      { stage: 'flop', seat: 1, userId: 'bb-p', action: 'check', amount: 0, timestamp: 1 },
      { stage: 'flop', seat: 2, userId: DELAYED_STABBER, action: 'bet', amount: 4, timestamp: 2 },
      { stage: 'flop', seat: 1, userId: 'bb-p', action: 'call', amount: 4, timestamp: 3 },
      { stage: 'turn', seat: 1, userId: 'bb-p', action: 'check', amount: 0, timestamp: 4 },
      { stage: 'turn', seat: 2, userId: DELAYED_STABBER, action: 'check', amount: 0, timestamp: 5 },
    ];
    const delayedRead = HorseMind.streetBullyRead(DELAYED_STABBER, singleStabThenCheck);
    expect(delayedRead.highFlopStab).toBe(false);
    // Guarded turnGiveUp: 0% historical flop stabber is NOT flagged turnGiveUp on a single hand!
    expect(delayedRead.checkedTurnAfterFlopStab).toBe(true);
    expect(delayedRead.turnGiveUp).toBe(false);

    const flopStabberRead = HorseMind.streetBullyRead(FLOP_STABBER, []);
    expect(flopStabberRead.highFlopStab).toBe(true);
    expect(flopStabberRead.stabRate).toBeGreaterThan(0.55);
  });

  it('enforces position-checked plo_passive_rundown_oop, flop/turn-committed plo_underboat_stackoff, tournament-deducted omahaShare, fail-closed !ledgerComplete top-ups, stop-loss clamp, & 200bb $2/$5 PLO partial reloads', async () => {
    // 1. Position-checked plo_passive_rundown_oop: OOP cold-call fires, IP BTN cold-call does NOT fire
    const oopRundownLeaks = detectLeaks({
      variant: 'plo4',
      bigBlind: 2,
      netBB: -30,
      invested: 60,
      holeCards: cards('JcTc9h8h'),
      board: cards('KsQd4c2s7d'),
      heroSeat: 2,
      buttonSeat: 6,
      occupiedSeats: [1, 2, 4, 6],
      heroActions: [
        { stage: 'preflop', action: 'call', amount: 6 },
        { stage: 'flop', action: 'call', amount: 18 },
        { stage: 'turn', action: 'call', amount: 36 },
      ],
      wentToShowdown: true,
    });
    expect(oopRundownLeaks).toContain('plo_passive_rundown_oop');

    const ipButtonRundownLeaks = detectLeaks({
      variant: 'plo4',
      bigBlind: 2,
      netBB: -30,
      invested: 60,
      holeCards: cards('JcTc9h8h'),
      board: cards('KsQd4c2s7d'),
      heroSeat: 6,
      buttonSeat: 6,
      occupiedSeats: [1, 2, 4, 6],
      heroActions: [
        { stage: 'preflop', action: 'call', amount: 6 },
        { stage: 'flop', action: 'call', amount: 18 },
        { stage: 'turn', action: 'call', amount: 36 },
      ],
      wentToShowdown: true,
    });
    expect(ipButtonRundownLeaks).not.toContain('plo_passive_rundown_oop');

    // 2. Flop/turn-committed plo_underboat_stackoff (all-in on paired flop Ks Kd 2d with 22, river Ks Kd 2d Qh 7c)
    const flopCommittedUnderboat = detectLeaks({
      variant: 'plo4',
      bigBlind: 2,
      netBB: -105,
      invested: 210,
      holeCards: cards('2s2cAhTd'),
      board: cards('KsKd2dQh7c'),
      heroActions: [
        { stage: 'preflop', action: 'call', amount: 6 },
        { stage: 'flop', action: 'all_in', amount: 204, isFullRaise: true },
      ],
      wentToShowdown: true,
    });
    expect(flopCommittedUnderboat).toContain('plo_underboat_stackoff');

    // 2b. Counterfeited flop nut-boat commit (Td5d5sAc = TTT55 nut boat on TsTc5h flop, counterfeited by KsQd)
    // must evaluate decision-time boardAt and NEVER false-fire plo_underboat_stackoff or plo_underfull_stackoff.
    const counterfeitedFlopNutBoat = detectLeaks({
      variant: 'plo4',
      bigBlind: 2,
      netBB: -110,
      invested: 220,
      holeCards: cards('Td5d5sAc'),
      board: cards('TsTc5hKsQd'),
      heroActions: [
        { stage: 'preflop', action: 'call', amount: 6 },
        { stage: 'flop', action: 'all_in', amount: 214, isFullRaise: true },
      ],
      wentToShowdown: true,
    });
    expect(counterfeitedFlopNutBoat).not.toContain('plo_underboat_stackoff');
    expect(counterfeitedFlopNutBoat).not.toContain('plo_underfull_stackoff');

    // 2c. Nut full house KKK22 on low-paired flop 2s2dKs (beaten only by 22 quads, beats K2 boat) must NOT flag underboat or underfull.
    const flopOverfullVsQuads = detectLeaks({
      variant: 'plo4',
      bigBlind: 2,
      netBB: -105,
      invested: 210,
      holeCards: cards('KhKcAhTd'),
      board: cards('2s2dKsQhJc'),
      heroActions: [
        { stage: 'preflop', action: 'call', amount: 6 },
        { stage: 'flop', action: 'all_in', amount: 204, isFullRaise: true },
      ],
      wentToShowdown: true,
    });
    expect(flopOverfullVsQuads).not.toContain('plo_underboat_stackoff');
    expect(flopOverfullVsQuads).not.toContain('plo_underfull_stackoff');

    // 2d. Turn middle boat QQQKK on KsKdQh2c (beaten by KQ/K2 boats, beats 22 boat -> lowerBoats === 1) flags underfull but NOT underboat.
    const turnMiddleBoat = detectLeaks({
      variant: 'plo4',
      bigBlind: 2,
      netBB: -105,
      invested: 210,
      holeCards: cards('QsQcAhTd'),
      board: cards('KsKdQh2c7s'),
      heroActions: [
        { stage: 'preflop', action: 'call', amount: 6 },
        { stage: 'flop', action: 'call', amount: 18 },
        { stage: 'turn', action: 'all_in', amount: 186, isFullRaise: true },
      ],
      wentToShowdown: true,
    });
    expect(turnMiddleBoat).toContain('plo_underfull_stackoff');
    expect(turnMiddleBoat).not.toContain('plo_underboat_stackoff');

    // 3. Tournament leak subtraction & cash omahaShare isolation in HorseSelfTuner
    expect(
      subtractTournamentLeaks(
        { plo_underboat_stackoff: 7, plo_passive_rundown_oop: 5 },
        { reviewed: 40, counts: { plo_underboat_stackoff: 5, plo_passive_rundown_oop: 5 } }
      )
    ).toEqual({ plo_underboat_stackoff: 2 });
    // Pure NLH cash Horse (100 NLH cash hands, 0 PLO cash hands) that played 30 PLO MTT reviewed pots keeps omahaShare = 0
    expect(
      computeCashOmahaShare(
        { holdem: 100, omaha: 0 },
        { holdem: 10, omaha: 30 },
        { reviewed: 30, counts: { plo_underboat_stackoff: 4 } }
      )
    ).toBe(0);

    // 4. HorseBankroll.topUpAllowance stop-loss clamp (investedThisTable + allowed <= stopLossCeiling)
    const stdPolicy = {
      ...bankrollPolicyFor(LAG_SHARK_HORSE),
      buyInsToSit: 25,
      stopLossBuyIns: 3,
      maxBankrollFraction: 0.1,
    };
    const clampedByStopLoss = topUpAllowance({
      bankroll: 100_000,
      investedThisTable: 1300, // refBuyIn = 500, maxBuyIn = 500 -> stopLossCeiling = 1500 -> stopLossHeadroom = 200
      desired: 500,
      refBuyIn: 500,
      minBuyIn: 200,
      maxBuyIn: 500,
      policy: stdPolicy,
    });
    expect(clampedByStopLoss).toBe(200);

    // 5. HorseSessionRotator: (a) fails closed when chip_ledger pagination is incomplete (!ledgerComplete),
    //    and (b) executes partial permitted reload (>= 0.5 * buyIn) on 200bb-max $2/$5 PLO tables!
    const now = Date.parse('2026-11-10T21:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    // Find a Horse UUID with active PLO persona AND 'standard' bankroll policy (maxBankrollFraction = 0.05, stopLossBuyIns = 3)
    let standardActivePloHorse = LAG_SHARK_HORSE;
    for (let i = 1; i <= 500; i++) {
      const candidate = `86110000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const arch = ploPersonaFor(candidate).archetype;
      const pol = bankrollPolicyFor(candidate);
      if (arch !== 'nit_hunter' && pol.maxBankrollFraction === 0.05 && pol.stopLossBuyIns === 3) {
        standardActivePloHorse = candidate;
        break;
      }
    }

    const clubId = '00000000-0000-0000-0000-000000000000';
    // 200bb-max $2/$5 PLO table: min_buy_in = 200, max_buy_in = 1000, referenceBuyIn = 500
    // Initial buy-in = 1000; current stack = 300 (< 400 = 0.80 * 500), desiredTopUp = 700.
    // With bankroll = 28,000 and standard policy (0.05 -> exposureCap = 1400):
    // headroom = 1400 - 1000 = 400 (< desiredTopUp 700, >= 250 = 0.5 * buyIn) -> partial reload of 400!
    const table200bbPlo = {
      id: 'table-plo-25-200bb',
      game_variant: 'plo4',
      big_blind: 5,
      small_blind: 2.5,
      min_buy_in: 200,
      max_buy_in: 1000,
      tournament_id: null,
      status: 'running',
      settings: {},
      cluster_id: null,
      lifecycle: 'live',
      created_at: new Date(now - 3600_000).toISOString(),
      max_players: 6,
      is_deleted: false,
    };
    expect(referenceBuyIn(5, 200, 1000)).toBe(500);

    const seatRow = {
      id: 'seat-200bb-plo',
      table_id: table200bbPlo.id,
      user_id: standardActivePloHorse,
      seat_number: 1,
      stack: 300,
      joined_at: new Date(now - 40 * 60_000).toISOString(),
      club_id: clubId,
      leave_pending: false,
      is_sitting_out: false,
      left_at: null,
      auto_rebuy: false,
      tables: table200bbPlo,
    };

    let failChipLedger = true;
    const dbTables: Record<string, Record<string, unknown>[]> = {
      table_seats: [seatRow],
      profiles: [{ id: standardActivePloHorse, is_horse: true, diamonds: 28_000 }],
      club_members: [{ club_id: clubId, user_id: standardActivePloHorse, chip_balance: 28_000 }],
      chip_ledger: [
        {
          id: 'ledger-buyin-1',
          from_entity_id: standardActivePloHorse,
          table_id: table200bbPlo.id,
          amount: 1000,
          to_type: 'table_stack',
          created_at: new Date(now - 40 * 60_000).toISOString(),
        },
      ],
      cash_player_session: [],
      table_waitlist: [],
      cash_game_waitlist: [],
      cash_games: [],
      cash_seat_moves: [],
      hand_history: [],
      tournament_players: [],
      tables: [table200bbPlo],
    };

    vi.spyOn(supabase, 'from').mockImplementation(((name: string) => {
      let rows = [...(dbTables[name] ?? [])];
      let lim = Infinity;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
        in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), b),
        is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b),
        gt: () => b,
        gte: () => b,
        lte: () => b,
        not: () => b,
        order: () => b,
        limit: (n: number) => ((lim = n), b),
        range: () => b,
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
          if (name === 'chip_ledger' && failChipLedger) {
            return Promise.resolve({ data: null, error: { message: 'ledger timeout' } }).then(
              ok,
              bad
            );
          }
          return Promise.resolve({ data: rows.slice(0, lim), error: null }).then(ok, bad);
        },
      };
      return b;
    }) as never);
    vi.spyOn(supabase, 'rpc').mockImplementation((() =>
      Promise.resolve({ data: null, error: { message: 'none' } })) as never);

    const addChips200 = vi.fn(async () => ({ success: true }));
    const engines: Record<string, RotatorEngine> = {
      [table200bbPlo.id]: {
        leaveTable: vi.fn(() => ({ success: true })),
        sitOut: vi.fn(() => ({ success: true })),
        addChips: addChips200,
        hitRunHandsOwed: () => 5,
        isClientSitOut: () => false,
      },
    };
    const rotator = new HorseSessionRotator((tid) => engines[tid]) as unknown as {
      isRunning: boolean;
      lifecycleGeneration: number;
      rotate(gen: number): Promise<void>;
    };
    rotator.isRunning = true;
    rotator.lifecycleGeneration = 1;

    // (a) Incomplete chip_ledger -> fail closed (zero addChips calls!)
    await rotator.rotate(1);
    expect(addChips200).not.toHaveBeenCalled();

    // (b) Healthy chip_ledger -> 200bb $2/$5 PLO partial permitted reload of 400 executes cleanly!
    failChipLedger = false;
    await rotator.rotate(1);
    vi.useRealTimers();
    expect(addChips200).toHaveBeenCalledWith(standardActivePloHorse, 400);
  });

  it('proves end-to-end live HorseDecisionWorkerRuntime (DECIDE_FAST) -> receipt validation -> HandController.performAction commit across PLO4/5/6 preflop & river underboat 75% pot folds', async () => {
    liveHorsePhase8Authority.refresh();
    liveHorsePhase8GuardAuthority.refresh();
    liveHorsePhase10Authority.refresh();
    for (const auth of Object.values(liveHorsePhase11Authorities)) auth.refresh();
    for (const auth of Object.values(liveHorsePhase12Authorities)) auth.refresh();
    for (const auth of Object.values(liveHorsePhase13Authorities)) auth.refresh();
    for (const auth of Object.values(liveHorsePhase14Authorities)) auth.refresh();
    liveHorseFeatureAuthority.refresh();

    const messages: HorseDecisionWorkerResponse[] = [];
    const worker = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
      ...defaultHorseDecisionWorkerDependencies,
      startServices: async () => defaultHorseDecisionWorkerDependencies.workerReadiness(),
      stopServices: async () => {},
      journalEnabled: () => false,
      journalAcceptedHand: () => {},
      journalLifecycle: () => {},
      noteDecision: () => {},
      noteFeature: () => {},
    });
    await worker.start();

    const tableId = '22222222-3333-4444-8555-666666666666';

    const executeAndCommitSpot = async (
      handNumber: number,
      variant: 'plo4' | 'plo5' | 'plo6',
      setup: (hc: HandController) => void
    ) => {
      const config: HandConfig = {
        tableId,
        handNumber,
        gameVariant: variant,
        smallBlind: 1,
        bigBlind: 2,
        isTournament: false,
        rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
      } as HandConfig;
      const players: SeatPlayer[] = [
        makeSeat(1, WOOWOO_ID, '', { stack: 200, is_horse: false }),
        makeSeat(2, LAG_SHARK_HORSE, '', { stack: 200, is_horse: true }),
        makeSeat(3, '71000000-0000-4000-8000-000000000003', '', { stack: 200, is_horse: false }),
      ];
      const hc = new HandController(config, players, 3);
      hc.start();
      setup(hc);

      const spot = controllerDecisionState(hc, variant as never, 'cash', config)!;
      expect(spot.hero.user_id).toBe(LAG_SHARK_HORSE);
      spot.state.commitmentCapRemaining = applyTableCommitmentCap(
        hc.getAuthoritativeActionState(LAG_SHARK_HORSE)!,
        spot.hero,
        false,
        0,
        2
      ).commitmentCapRemaining;

      const reqId = 9000 + handNumber;
      const req: FastHorseDecisionRequest = {
        type: 'DECIDE_FAST',
        requestId: reqId,
        generation: 1,
        fence: `${tableId}:${handNumber}:2:11:1`,
        decisionTimeMs: Date.now() + 5000,
        decisionKey: '',
        player: spot.hero,
        gameState: spot.state,
        style: 'grinder',
        mods: { tightness: 0.98, aggression: 1.18, bluffFreq: 0.91, sizingMultiplier: 0.94 },
        handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
      };
      req.decisionKey = buildHorseDecisionKey(req);
      seedFastRandom(42 + handNumber);
      worker.receive(req);
      await worker.drain();

      const resp = messages.find((m) => m.type === 'FAST_RESULT' && m.requestId === reqId);
      expect(resp?.type).toBe('FAST_RESULT');
      if (resp?.type !== 'FAST_RESULT') throw new Error('Expected FAST_RESULT');
      expect(horseDecisionReceiptRefusal(resp.decision, variant)).toBeNull();

      // Normalize worker action to HandController legal action just like ServerTableEngineTurns.commitDecision
      const rawAct = resp.decision.action;
      const toCall = spot.state.toCall ?? 0;
      const curBet = spot.state.currentBet ?? 0;
      const normAct =
        (rawAct as string) === 'allin'
          ? 'all_in'
          : rawAct === 'raise' && curBet === 0
            ? 'bet'
            : rawAct === 'bet' && curBet > 0
              ? 'raise'
              : rawAct === 'call' && toCall === 0
                ? 'check'
                : rawAct === 'fold' && toCall === 0
                  ? 'check'
                  : rawAct;
      const committed = hc.performAction(
        spot.hero.seat,
        normAct as never,
        resp.decision.amount ?? undefined,
        'horse_policy'
      );
      expect(committed).toBe(true);
      return { decision: resp.decision, stateAfter: hc.getState() };
    };

    // (a) PLO5 cash preflop 3+2 double-suited rundown JT987ds 3-bets CO open and commits cleanly into HandController
    const plo5Pre = await executeAndCommitSpot(1, 'plo5', (hc) => {
      // dealer=3 (BTN), seat 1=SB, seat 2=BB (Hero), seat 3=BTN opens to 6, seat 1 folds -> Hero acts in BB
      expect(hc.performAction(3, 'raise', 6)).toBe(true);
      expect(hc.performAction(1, 'fold')).toBe(true);
      const internal = (hc as unknown as { state: { players: SeatPlayer[] } }).state;
      internal.players.find((p) => p.seat === 2)!.cards = cards('JhTh9s8s7h');
    });
    expect(plo5Pre.decision.action).toBe('raise');
    expect(plo5Pre.decision.omahaVariantPolicy?.mode).toBe('candidate');
    expect(plo5Pre.stateAfter.actionHistory.at(-1)?.action).toBe('raise');

    // (b) PLO4, PLO5, and PLO6 river bottom underboat facing exact 75% pot bet (30 into 40) folds (never value-raises!) and commits into HandController
    const holeByVariant: Record<'plo4' | 'plo5' | 'plo6', string> = {
      plo4: '2s2dAh7c',
      plo5: '2s2dAh7c6d',
      plo6: '2s2dAh7c6d5s',
    };
    let hNum = 10;
    for (const v of ['plo4', 'plo5', 'plo6'] as const) {
      const res = await executeAndCommitSpot(hNum++, v, (hc) => {
        // Pot-limit legal path to an exact 40-chip river pot:
        // Preflop: Seat 3 limps (2), Seat 1 (SB) pot-raises to 8, Seat 2 (BB Hero) calls 8, Seat 3 folds -> pot = 18
        expect(hc.performAction(3, 'call')).toBe(true);
        expect(hc.performAction(1, 'raise', 8)).toBe(true);
        expect(hc.performAction(2, 'call')).toBe(true);
        expect(hc.performAction(3, 'fold')).toBe(true);
        // Flop: Seat 1 bets 11 into 18, Seat 2 calls -> pot = 40
        expect(hc.performAction(1, 'bet', 11)).toBe(true);
        expect(hc.performAction(2, 'call')).toBe(true);
        // Turn: check / check -> pot = 40
        expect(hc.performAction(1, 'check')).toBe(true);
        expect(hc.performAction(2, 'check')).toBe(true);
        // River: Force board Ks Qs Jc Jd 2h and hero bottom underboat 22 before Seat 1 bets 30 into 40 (75% pot)
        const internal = (
          hc as unknown as { state: { communityCards: Card[]; players: SeatPlayer[] } }
        ).state;
        internal.communityCards = cards('KsQsJcJd2h');
        internal.players.find((p) => p.seat === 2)!.cards = cards(holeByVariant[v]);
        expect(hc.performAction(1, 'bet', 30)).toBe(true);
      });
      expect(res.decision.action).toBe('fold');
      expect(res.stateAfter.actionHistory.at(-1)?.action).toBe('fold');
    }
  });
});
