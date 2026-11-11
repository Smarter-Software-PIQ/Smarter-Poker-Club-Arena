/**
 * V86 ALL-HANDS HUMAN-VS-HORSE DEEP-DIVE DISCIPLINE - UNIT & REGRESSION SUITE
 *
 * Verifies every V86 pillar end-to-end and in unit isolation:
 *  1. Omaha preflop multiway & 5/6-card discipline (presumed opener read
 *     sanitization, V24 price-relief caps & floors, multiway cold-call
 *     tightening, V34 BB multiway/5-6c floor, and 5/6-card V46 hand-class
 *     trips rescue + 4-suit / unsuited-ace adjustments).
 *  2. Heads-up Omaha turn/river position-stab suppression for medium showdown
 *     value and unblocked air, while preserving nutted value, nutty draws,
 *     and dry nut-flush-blocker bluffs with valid signed worker receipts.
 *  3. Postflop PLO6 >= 0.90-pot call-fold cells, V40 drawless bare-pair flop
 *     cap tightening, and Omaha bet-then-raised commitment exclusion + shade.
 *  4. Tournament / non-HiLo Omaha `pricedIn` trash floor (with Cash NLH and
 *     all-in calls untouched) and NLH turn cold-raise / multiway barrel shade.
 *  5. Strict exclusions & off-arm parity: PLO8 / Hi-Lo untouched, label-flip
 *     neutrality, and `v86DeepDiveDiscipline: false` restores pre-V86 output.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { omahaVariantSpot } from '../benchmark/OmahaVariantPolicyEvidence.js';
import { calculateContestablePot, calculatePots } from './PokerEngine.js';
import {
  v86AdjustFiveSixCardHandClass,
  v86NlhTurnMultiwayOrColdRaiseShade,
  v86OmahaBetRaisedShade,
  v86OmahaCallBarBounds,
  v86OmahaColdCallTighten,
  v86Plo6BigBetCell,
  v86PricedInMinStrength,
  v86SanitizeOmahaOpenerExploit,
  v86ShouldSuppressOmahaPositionStab,
  type V86Plo6BigBetInput,
} from './HorseDeepDiveDiscipline.js';
import { handClassRead } from './HorseHandClasses.js';
import { decidePreflopV7, type PreflopCtx } from './HorsePreflop.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptIsValid } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  }
  return out;
}

describe('V86 All-Hands Deep-Dive Discipline', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    seedFastRandom(20261110);
    HorseMind.reset();
    drainFires();
  });

  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  describe('Pillar 1: Omaha preflop multiway & 5/6-card discipline', () => {
    it('strips flatBar and bbFlatBar from presumed unknown Omaha reads while keeping threeBetBar and observed reads intact', () => {
      const opener = {
        threeBetBar: 0.56,
        flatBar: 0.28,
        bbFlatBar: 0.22,
        wide: true,
        noBluffThreeBet: false,
      };
      // Presumed Omaha high-only in 5/6-card or multiway: flat overrides stripped, value 3-bet bar preserved.
      const sanitized = v86SanitizeOmahaOpenerExploit(opener, true, true, false);
      expect(sanitized).toEqual({
        ...opener,
        flatBar: null,
        bbFlatBar: null,
      });
      expect(v86SanitizeOmahaOpenerExploit(opener, true, true, false, 4, 1)).toEqual({
        ...opener,
        flatBar: null,
        bbFlatBar: null,
      });
      expect(v86SanitizeOmahaOpenerExploit(opener, true, true, false, 5, 0)).toEqual({
        ...opener,
        flatBar: null,
        bbFlatBar: null,
      });
      // 4-card PLO4 single-open (`omahaHoleCount = 4, callers = 0`): untouched.
      expect(v86SanitizeOmahaOpenerExploit(opener, true, true, false, 4, 0)).toBe(opener);
      // Observed human read (`presumed = false`): untouched.
      expect(v86SanitizeOmahaOpenerExploit(opener, false, true, false)).toBe(opener);
      // Hold'em (`isOmaha = false`): untouched.
      expect(v86SanitizeOmahaOpenerExploit(opener, true, false, false)).toBe(opener);
      // PLO8 / Hi-Lo (`isHiLo = true`): untouched.
      expect(v86SanitizeOmahaOpenerExploit(opener, true, true, true)).toBe(opener);
    });

    it('scales V24 Omaha continue floors and cold-call bumps strictly with hole-card count and callers', () => {
      const plo4Co = v86OmahaCallBarBounds(4, 'late', 0);
      const plo5Co = v86OmahaCallBarBounds(5, 'late', 0);
      const plo6Co = v86OmahaCallBarBounds(6, 'late', 0);
      const plo6Multi = v86OmahaCallBarBounds(6, 'late', 2);
      expect(plo6Co.callFloor).toBeGreaterThan(plo5Co.callFloor);
      expect(plo5Co.callFloor).toBeGreaterThan(plo4Co.callFloor);
      expect(plo6Multi.callFloor).toBeGreaterThan(plo6Co.callFloor);
      expect(plo6Multi.maxPriceRelief).toBeLessThan(plo6Co.maxPriceRelief);

      expect(v86OmahaColdCallTighten(6, 'middle', 2, 100)).toBeGreaterThan(
        v86OmahaColdCallTighten(4, 'late', 0, 100)
      );
    });

    it('rescues coordinated 5/6-card trips (AAAKsQs) from force-fold while keeping uncoordinated trips (AAA723) force-folded', () => {
      const rescueHand = cards('AsAhAdKsQh'); // drops Ad -> AsAhKsQh = aa_ds
      const baseRescue = handClassRead(rescueHand, true, false);
      expect(baseRescue.cls).toBe('trips');
      expect(baseRescue.foldAlways).toBe(true);
      const adjustedRescue = v86AdjustFiveSixCardHandClass(rescueHand, baseRescue);
      expect(adjustedRescue.changed).toBe(true);
      expect(adjustedRescue.read.foldAlways).toBe(false);
      expect(adjustedRescue.read.cls).toBe('aa_ds');

      const junkTrips = cards('AsAhAd7c2d3h');
      const baseJunk = handClassRead(junkTrips, true, false);
      expect(baseJunk.foldAlways).toBe(true);
      const adjustedJunk = v86AdjustFiveSixCardHandClass(junkTrips, baseJunk);
      expect(adjustedJunk.changed).toBe(false);
      expect(adjustedJunk.read.foldAlways).toBe(true);

      // 4-of-one-suit self-blocked hand in PLO5 gets tightened and marked neverThreeBet.
      const selfBlocked = cards('KsQsJs9s4h');
      const baseSelf = handClassRead(selfBlocked, true, false);
      const adjustedSelf = v86AdjustFiveSixCardHandClass(selfBlocked, baseSelf);
      expect(adjustedSelf.changed).toBe(true);
      expect(adjustedSelf.read.neverThreeBet).toBe(true);
      expect(adjustedSelf.read.shift.coldCall).toBeGreaterThan(baseSelf.shift.coldCall);
    });

    it('tightens PLO6 multiway cold-calls and BB multiway defense vs pre-V86 while keeping PLO8 untouched', () => {
      const baseCtx: PreflopCtx = {
        strength: 0.37,
        position: 'bb',
        raiserPosition: 'late',
        raises: 1,
        limpers: 0,
        callers: 3,
        oppsLeft: 4,
        toCall: 5,
        currentBet: 7,
        pot: 24.5,
        bigBlind: 2,
        stack: 200,
        stackBB: 100,
        aggression: 1,
        tightness: 1,
        bluffFreq: 0.12,
        slowplayFreq: 0.08,
        sizingMultiplier: 1,
        isOmaha: true,
        isPotLimit: true,
        riskAdd: 0,
        ploPriceDefense: true,
        mode: 'cash',
        rand: () => 0.5,
      };
      const preV86 = decidePreflopV7({ ...baseCtx, v86DeepDiveDiscipline: false });
      const withV86 = decidePreflopV7({
        ...baseCtx,
        v86DeepDiveDiscipline: true,
        omahaHoleCount: 6,
        omahaHiLo: false,
      });
      const plo8WithV86 = decidePreflopV7({
        ...baseCtx,
        v86DeepDiveDiscipline: true,
        omahaHoleCount: 4,
        omahaHiLo: true,
      });
      expect(preV86.a).toBe('call');
      expect(withV86.a).toBe('fold');
      expect(plo8WithV86.a).toBe(preV86.a);
    });
  });

  describe('Pillar 2: Heads-up Omaha turn/river position-stab selectivity', () => {
    function huRiverSpot(heroHole: string, board: string, stage: 'turn' | 'river' = 'river') {
      const input = omahaVariantSpot('plo5', stage, 2, 'cash');
      input.hero.cards = cards(heroHole);
      input.state.players[0].cards = [];
      input.state.players[1].bet = 0;
      input.state.players[1].totalInvested = 20;
      input.state.communityCards = cards(board);
      input.state.pot = 40;
      input.state.pots = calculatePots(input.state.players);
      input.state.contestablePot = calculateContestablePot(
        input.state.players,
        input.hero.user_id,
        0
      );
      input.state.currentBet = 0;
      input.state.toCall = 0;
      input.state.minRaise = 2;
      input.state.lastRaise = 0;
      input.state.minRaiseTo = 2;
      input.state.maxRaiseTo = input.state.pot;
      input.state.legalActions = ['check', 'bet'];
      input.state.actionHistory = [
        {
          stage,
          seat: 2,
          userId: 'v2',
          action: 'check',
          amount: 0,
          timestamp: 1,
        },
      ];
      return { hero: input.hero, gs: input.state };
    }

    it('suppresses unconditional HU river pot-stab with medium one pair while keeping nut value and dry nut-flush-blocker bluffs', () => {
      // Medium one pair on paired/flush board: checks back instead of 100%-pot stab.
      const mediumPair = huRiverSpot('Kd9c5s4d2c', 'Kh9h4h7c7s', 'river');
      expect(
        v86ShouldSuppressOmahaPositionStab(mediumPair.hero, mediumPair.gs, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(true);

      // The turn stab is retained: the HU street ablation measured turn
      // suppression at -8.96 +/- 3.34 bb/100, so the same medium pair on the
      // turn is never suppressed.
      const mediumPairTurn = huRiverSpot('Kd9c5s4d2c', 'Kh9h4h7c', 'turn');
      expect(
        v86ShouldSuppressOmahaPositionStab(mediumPairTurn.hero, mediumPairTurn.gs, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(false);

      seedFastRandom(100101);
      const dOff = HorseLogic.decide(mediumPair.hero, mediumPair.gs as never, 'balanced', {}, {
        telemetry: false,
        mind: false,
        decisionTimeMs: 0,
        phase11Omaha: 'candidate',
        phase11EvidenceMode: true,
        v86DeepDiveDiscipline: false,
      } as never);
      expect(dOff.action).toBe('bet');
      expect(dOff.amount).toBeGreaterThan(0);
      expect(dOff.omahaVariantPolicy).toMatchObject({ applied: true, selection: 'selected' });

      seedFastRandom(100101);
      const dOn = HorseLogic.decide(mediumPair.hero, mediumPair.gs as never, 'balanced', {}, {
        telemetry: false,
        mind: false,
        decisionTimeMs: 0,
        phase11Omaha: 'candidate',
        phase11EvidenceMode: true,
        v86DeepDiveDiscipline: true,
      } as never);
      expect(dOn.action).toBe('check');
      expect(dOn.omahaVariantPolicy).toMatchObject({
        applied: false,
        selection: 'none',
      });
      const workerBacked = {
        ...dOn,
        omahaVariantPolicy: {
          ...dOn.omahaVariantPolicy!,
          authority: {
            version: 'horse-qualified-authority-receipt-v1' as const,
            epoch: 'e',
            generation: 1,
            state: 'usable' as const,
            reason: 'admitted',
            continuationVersion: dOn.omahaVariantPolicy!.version,
            approvalGeneration: 1,
            authorityKey: 'k',
            evidenceSha256: null,
            sourceSha: null,
            expiresAt: null,
            mainGeneration: null,
          },
        },
      };
      expect(
        horseDecisionReceiptIsValid(workerBacked, 'plo5', {
          player: mediumPair.hero,
          gameState: mediumPair.gs as never,
        })
      ).toBe(true);

      const dShadow = HorseLogic.decide(mediumPair.hero, mediumPair.gs as never, 'balanced', {}, {
        mind: false,
        phase11Omaha: 'shadow',
        v86DeepDiveDiscipline: true,
      } as never);
      expect(dShadow.action).toBe('check');
      expect(
        horseDecisionReceiptIsValid(dShadow, 'plo5', {
          player: mediumPair.hero,
          gameState: mediumPair.gs as never,
        })
      ).toBe(true);

      // Nut flush on unpaired river: NOT suppressed (value bet allowed).
      const nutFlush = huRiverSpot('AhQh8s7d2c', 'Kh9h4h7c2s', 'river');
      expect(
        v86ShouldSuppressOmahaPositionStab(nutFlush.hero, nutFlush.gs, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(false);

      // Tiny bottom pair (2c pairing 2d) holding dry Ace of the 3-flush suit on unpaired river:
      // negligible HU Omaha showdown value -> NOT suppressed (blocker bluff allowed).
      const nutBlockerBluff = huRiverSpot('Ah6c5d3s2c', 'Kh9h4h8c2d', 'river');
      expect(
        v86ShouldSuppressOmahaPositionStab(nutBlockerBluff.hero, nutBlockerBluff.gs, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(false);

      // Pure high-card air (cat === 1) holding dry Ace of the 3-flush suit on unpaired river:
      // NOT suppressed (blocker bluff allowed).
      const nutBlockerPureAir = huRiverSpot('AhJcTd7s3c', 'Kh9h4h8c2d', 'river');
      expect(
        v86ShouldSuppressOmahaPositionStab(nutBlockerPureAir.hero, nutBlockerPureAir.gs, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(false);

      // Top pair or second pair on unpaired river EVEN WITH dry Ace flush blocker:
      // suppressed so real HU showdown value checks back instead of 100%-pot over-bluffing.
      const topPairWithBlocker = huRiverSpot('AhKd6c5d3s', 'Kh9h4h8c2d', 'river');
      expect(
        v86ShouldSuppressOmahaPositionStab(topPairWithBlocker.hero, topPairWithBlocker.gs, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(true);
      const secondPairWithBlocker = huRiverSpot('Ah9d6c5d3s', 'Kh9h4h8c2d', 'river');
      expect(
        v86ShouldSuppressOmahaPositionStab(secondPairWithBlocker.hero, secondPairWithBlocker.gs, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(true);

      // Pure high-card air WITHOUT nut-flush blocker on unpaired river: suppressed (checks back).
      const unblockedAir = huRiverSpot('AcJcTd7s3c', 'Kh9h4h8c2d', 'river');
      expect(
        v86ShouldSuppressOmahaPositionStab(unblockedAir.hero, unblockedAir.gs, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(true);
    });
  });

  describe('Pillar 3: Postflop PLO6 big-bet call-fold & Omaha bet-raised discipline', () => {
    const basePlo6: V86Plo6BigBetInput = {
      variant: 'plo6',
      street: 'river',
      hole: cards('6s5hKdKc2h3d'),
      board: cards('9h8c7d2s3c'),
      potFrac: 1,
      effectiveBB: 120,
      tournament: false,
      headsUpTable: false,
      bountyEvent: false,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      bettorOverBluffs: false,
      heroHasStreetChips: false,
    };

    it('folds non-nut straights, non-nut flushes, two pair, and dead-bottom boats in PLO6 >= 0.90-pot multiway spots while keeping nuts and exclusions', () => {
      expect(v86Plo6BigBetCell(basePlo6)).toBe('plo6_river_vulnerable_straight');
      // Nut straight on dry unpaired board: never folded.
      expect(v86Plo6BigBetCell({ ...basePlo6, hole: cards('JsTh4d4c2h3d') })).toBeNull();
      // Dominated flush on 3-flush river: folded.
      expect(
        v86Plo6BigBetCell({
          ...basePlo6,
          hole: cards('Jh8hTsTd2c3d'),
          board: cards('Kh9h4h7c2s'),
        })
      ).toBe('plo6_river_non_nut_or_paired_flush');
      // Unpaired nut flush: never folded.
      expect(
        v86Plo6BigBetCell({
          ...basePlo6,
          hole: cards('Ah5hTsTd2c3d'),
          board: cards('Kh9h4h7c2s'),
        })
      ).toBeNull();
      // Dead-bottom boat (2s full of Ks on KsKdQh8c2d -> KKKQQ, KKK88, QQQKK, 888KK all beat 222KK, 0 lower boats).
      expect(
        v86Plo6BigBetCell({
          ...basePlo6,
          hole: cards('2s2hAcJc7c6d'),
          board: cards('KsKdQh8c2d'),
        })
      ).toBe('plo6_river_dead_bottom_boat');
      // Exclusions: heads-up, < 0.90 pot, <= 20bb, PLO8.
      expect(v86Plo6BigBetCell({ ...basePlo6, headsUpTable: true })).toBeNull();
      expect(v86Plo6BigBetCell({ ...basePlo6, potFrac: 0.75 })).toBeNull();
      expect(v86Plo6BigBetCell({ ...basePlo6, effectiveBB: 20 })).toBeNull();
      expect(v86Plo6BigBetCell({ ...basePlo6, hiLo: true })).toBeNull();
    });

    it('produces signed PLO6 river fold decisions end-to-end and restores pre-V86 calls when v86DeepDiveDiscipline is false', () => {
      const hero: SeatPlayer = {
        seat: 1,
        user_id: 'hero-plo6',
        username: 'Hero6',
        stack: 300,
        bet: 0,
        totalInvested: 18,
        cards: cards('QhJhTsTd9c8d'),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      } as SeatPlayer;
      const villain: SeatPlayer = {
        seat: 2,
        user_id: 'villain-plo6',
        username: 'Villain6',
        stack: 264,
        bet: 36,
        totalInvested: 54,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: false,
      } as SeatPlayer;
      const folder: SeatPlayer = {
        seat: 3,
        user_id: 'folder-plo6',
        username: 'Folder6',
        stack: 300,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: true,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      } as SeatPlayer;
      const gs = {
        players: [hero, villain, folder],
        communityCards: cards('Kh9h4h7c2s'),
        pot: 72,
        currentBet: 36,
        toCall: 36,
        minRaiseTo: 72,
        maxRaiseTo: 300,
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        stage: 'river',
        gameVariant: 'plo6',
        bettingStructure: 'pot_limit',
        gameMode: 'cash',
        bigBlind: 2,
        dealerSeat: 1,
        actionHistory: [
          { stage: 'preflop', seat: 3, userId: 'folder-plo6', action: 'fold', amount: 0 },
          { stage: 'preflop', seat: 2, userId: 'villain-plo6', action: 'raise', amount: 6 },
          { stage: 'preflop', seat: 1, userId: 'hero-plo6', action: 'call', amount: 4 },
          { stage: 'flop', seat: 1, userId: 'hero-plo6', action: 'check', amount: 0 },
          { stage: 'flop', seat: 2, userId: 'villain-plo6', action: 'bet', amount: 6 },
          { stage: 'flop', seat: 1, userId: 'hero-plo6', action: 'call', amount: 6 },
          { stage: 'turn', seat: 1, userId: 'hero-plo6', action: 'check', amount: 0 },
          { stage: 'turn', seat: 2, userId: 'villain-plo6', action: 'check', amount: 0 },
          { stage: 'river', seat: 1, userId: 'hero-plo6', action: 'check', amount: 0 },
          { stage: 'river', seat: 2, userId: 'villain-plo6', action: 'bet', amount: 36 },
        ],
      };

      let offCalls = 0;
      for (let seed = 1; seed <= 15; seed++) {
        seedFastRandom(seed * 997);
        const on = HorseLogic.decide(hero, gs as never, 'balanced', {}, {
          mind: false,
          telemetry: true,
          v86DeepDiveDiscipline: true,
        } as never);
        expect(on.action).toBe('fold');
        expect(
          horseDecisionReceiptIsValid(on, 'plo6', { player: hero, gameState: gs as never })
        ).toBe(true);

        seedFastRandom(seed * 997);
        const off = HorseLogic.decide(hero, gs as never, 'balanced', {}, {
          mind: false,
          v86DeepDiveDiscipline: false,
        } as never);
        if (off.action === 'call') offCalls++;
      }
      expect(offCalls).toBeGreaterThan(0);
    });

    it('scales Omaha bet-then-raised shade monotonically with raise-to-pot ratio', () => {
      expect(v86OmahaBetRaisedShade(0, 100, true)).toBe(0);
      expect(v86OmahaBetRaisedShade(80, 100, true)).toBeGreaterThan(
        v86OmahaBetRaisedShade(20, 100, true)
      );
      expect(v86OmahaBetRaisedShade(80, 100, true)).toBeGreaterThan(
        v86OmahaBetRaisedShade(80, 100, false)
      );
    });
  });

  describe('Pillar 4: Ante/Omaha pricedIn trash floor & NLH turn cold-raise shade', () => {
    it('prevents tournament pricedIn override on bottom-decile trash facing a raise while keeping Cash NLH and all-in calls untouched', () => {
      expect(
        v86PricedInMinStrength({
          isTourney: false,
          isOmaha: false,
          isHiLo: false,
          omahaHoleCount: undefined,
          callers: 3,
        })
      ).toBe(0);
      expect(
        v86PricedInMinStrength({
          isTourney: true,
          isOmaha: false,
          isHiLo: false,
          omahaHoleCount: undefined,
          callers: 2,
        })
      ).toBeGreaterThanOrEqual(0.26);

      const tourneyTrashCtx: PreflopCtx = {
        strength: 0.08, // 72o-level bottom trash
        position: 'bb',
        raiserPosition: 'early',
        raises: 1,
        limpers: 0,
        callers: 3,
        oppsLeft: 4,
        toCall: 150, // min-raise with big blind ante in pot -> guardOdds <= 0.15
        currentBet: 300,
        pot: 1500,
        bigBlind: 150,
        stack: 4500,
        stackBB: 30,
        aggression: 1,
        tightness: 1,
        bluffFreq: 0.12,
        slowplayFreq: 0.08,
        sizingMultiplier: 1,
        isOmaha: false,
        isPotLimit: false,
        riskAdd: 0.03,
        mode: 'tournament',
        rand: () => 0.5,
      };
      expect(decidePreflopV7({ ...tourneyTrashCtx, v86DeepDiveDiscipline: false }).a).toBe('call');
      expect(decidePreflopV7({ ...tourneyTrashCtx, v86DeepDiveDiscipline: true }).a).toBe('fold');

      // All-in <= 2bb call with same trash stays a call even with V86 ON.
      const desperateAllIn: PreflopCtx = {
        ...tourneyTrashCtx,
        stack: 150,
        stackBB: 1,
      };
      expect(decidePreflopV7({ ...desperateAllIn, v86DeepDiveDiscipline: true }).a).toBe('call');

      // Cash NLH with same pot odds stays completely untouched by V86.
      const cashNlhCtx: PreflopCtx = {
        ...tourneyTrashCtx,
        mode: 'cash',
      };
      expect(decidePreflopV7({ ...cashNlhCtx, v86DeepDiveDiscipline: true }).a).toBe(
        decidePreflopV7({ ...cashNlhCtx, v86DeepDiveDiscipline: false }).a
      );

      // Extreme pot odds (~21:1 / 22:1 min-click, guardOdds <= 0.065) or an
      // evidenced maniac raiser still call via V13 pricedIn with any holding.
      const hugePricePlo6Ctx: PreflopCtx = {
        ...tourneyTrashCtx,
        mode: 'cash',
        isOmaha: true,
        isPotLimit: true,
        omahaHoleCount: 6,
        omahaHiLo: false,
        raises: 2,
        callers: 0,
        toCall: 2,
        currentBet: 22,
        pot: 42,
        bigBlind: 2,
        stack: 400,
        stackBB: 200,
      };
      expect(decidePreflopV7({ ...hugePricePlo6Ctx, v86DeepDiveDiscipline: true }).a).toBe('call');
      expect(
        decidePreflopV7({
          ...tourneyTrashCtx,
          v86DeepDiveDiscipline: true,
          evidencedWideRaiser: true,
        }).a
      ).toBe('call');
    });

    it('adds NLH turn shade only on cold raises (pressure >= 2) or multiway >= 0.75-pot barrels', () => {
      expect(v86NlhTurnMultiwayOrColdRaiseShade(1, 1, 0.8)).toBe(0);
      expect(v86NlhTurnMultiwayOrColdRaiseShade(1, 2, 0.5)).toBe(0);
      expect(v86NlhTurnMultiwayOrColdRaiseShade(1, 2, 0.8)).toBe(0.05);
      expect(v86NlhTurnMultiwayOrColdRaiseShade(2, 1, 0.6)).toBe(0.07);
    });
  });

  describe('Pillar 5: Label-flip neutrality, board-ranked nut-blocker, and PLO8 parity', () => {
    it('recognizes dry Qh as nut-flush blocker when Ah and Kh of the 3-flush suit are on board', () => {
      const input = omahaVariantSpot('plo5', 'river', 2, 'cash');
      input.hero.cards = cards('QhJc9d7s2c');
      input.state.players[0].cards = [];
      input.state.players[1].bet = 0;
      input.state.communityCards = cards('AhKh6h8c2d');
      input.state.currentBet = 0;
      input.state.toCall = 0;
      input.state.actionHistory = [
        { stage: 'river', seat: 2, userId: 'v2', action: 'check', amount: 0, timestamp: 1 },
      ];
      expect(
        v86ShouldSuppressOmahaPositionStab(input.hero, input.state, {
          action: 'check',
          thinkTime: 0,
        })
      ).toBe(false);
    });

    it('preserves strict human-vs-Horse label-flip neutrality and postflop PLO8 parity with v86DeepDiveDiscipline enabled', () => {
      const hero: SeatPlayer = {
        seat: 1,
        user_id: 'hero-neutral',
        username: 'HeroHorse',
        stack: 240,
        bet: 0,
        totalInvested: 16,
        cards: cards('QhJhTsTd9c8d'),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      } as SeatPlayer;
      const makeGs = (
        oppIsHorse: boolean,
        oppId: string,
        oppName: string,
        gameVariant: string
      ) => ({
        players: [
          hero,
          {
            seat: 2,
            user_id: oppId,
            username: oppName,
            stack: 208,
            bet: 32,
            totalInvested: 48,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
            is_horse: oppIsHorse,
          } as SeatPlayer,
          {
            seat: 3,
            user_id: 'folded-seat',
            username: 'FoldedSeat',
            stack: 240,
            bet: 0,
            totalInvested: 0,
            cards: [],
            is_folded: true,
            is_all_in: false,
            is_sitting_out: false,
            is_horse: true,
          } as SeatPlayer,
        ],
        communityCards: cards('Kh9h4h7c2s'),
        pot: 64,
        currentBet: 32,
        toCall: 32,
        minRaiseTo: 64,
        maxRaiseTo: 240,
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        stage: 'river',
        gameVariant,
        bettingStructure: 'pot_limit',
        gameMode: 'cash',
        bigBlind: 2,
        dealerSeat: 1,
        actionHistory: [
          { stage: 'preflop', seat: 3, userId: 'folded-seat', action: 'fold', amount: 0 },
          { stage: 'preflop', seat: 2, userId: oppId, action: 'raise', amount: 6 },
          { stage: 'preflop', seat: 1, userId: 'hero-neutral', action: 'call', amount: 4 },
          { stage: 'flop', seat: 1, userId: 'hero-neutral', action: 'check', amount: 0 },
          { stage: 'flop', seat: 2, userId: oppId, action: 'check', amount: 0 },
          { stage: 'turn', seat: 1, userId: 'hero-neutral', action: 'check', amount: 0 },
          { stage: 'turn', seat: 2, userId: oppId, action: 'check', amount: 0 },
          { stage: 'river', seat: 1, userId: 'hero-neutral', action: 'check', amount: 0 },
          { stage: 'river', seat: 2, userId: oppId, action: 'bet', amount: 32 },
        ],
      });

      seedFastRandom(424242);
      const vsHuman = HorseLogic.decide(
        hero,
        makeGs(false, 'human-player-1', 'HumanPlayer', 'plo6') as never,
        'balanced',
        {},
        { mind: false, v86DeepDiveDiscipline: true } as never
      );
      seedFastRandom(424242);
      const vsHorse = HorseLogic.decide(
        hero,
        makeGs(true, 'horse-peer-99', 'PeerHorse', 'plo6') as never,
        'balanced',
        {},
        { mind: false, v86DeepDiveDiscipline: true } as never
      );
      expect(vsHuman.action).toBe(vsHorse.action);
      expect(vsHuman.amount).toBe(vsHorse.amount);

      const plo8Hero: SeatPlayer = { ...hero, cards: cards('As2sKhQd') };
      const plo8Gs = {
        ...makeGs(false, 'plo8-villain', 'Plo8Villain', 'plo8'),
        players: [
          plo8Hero,
          makeGs(false, 'plo8-villain', 'Plo8Villain', 'plo8').players[1],
          makeGs(false, 'plo8-villain', 'Plo8Villain', 'plo8').players[2],
        ],
      };
      seedFastRandom(515151);
      const plo8On = HorseLogic.decide(plo8Hero, plo8Gs as never, 'balanced', {}, {
        mind: false,
        v86DeepDiveDiscipline: true,
      } as never);
      seedFastRandom(515151);
      const plo8Off = HorseLogic.decide(plo8Hero, plo8Gs as never, 'balanced', {}, {
        mind: false,
        v86DeepDiveDiscipline: false,
      } as never);
      expect(plo8On.action).toBe(plo8Off.action);
      expect(plo8On.amount).toBe(plo8Off.amount);
    });
  });
});
