import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  HORSE_HYBRID_PROFILES,
  horseHybridDecisionMatches,
  resolveHorseHybridExecutionProfile,
  resolveHorseHybridProfile,
  resolveHorseHybridSolverAdherence,
} from './HorseHybridProfile.js';
import {
  HORSE_INDIFFERENCE_EV_BAND_BB,
  defaultPersonaFor,
  followsSolver,
  indifferenceStyleSeedsFor,
  prefersRunItTwice,
  resolveIndifferenceTieBreak,
} from './HorsePersona.js';
import {
  HORSE_FEATURE_FLAGS,
  admitHorseFeatureReleaseAuthority,
  featureDomainMatches,
  horseFeatureDomainVerdict,
  liveHorseFeatureAuthority,
  type HorseFeatureDomain,
} from './HorseFeatureAuthority.js';
import {
  HORSE_TOURNAMENT_FLAG_CARD_NAMES,
  admitHorseTournamentFlagReleaseAuthority,
  admittedTournamentFlag,
  tournamentFlagCardFor,
} from './HorseTournamentFlagAuthority.js';
import { HorsePhase8Safety, liveHorsePhase8Safety } from './HorsePhase8Safety.js';
import { evaluatePlo4LivePolicy, plo4InputBindingIsValid } from './plo4/Plo4LivePolicy.js';
import {
  evaluateOmahaVariantPolicy,
  omahaVariantInputBindingIsValid,
} from './omaha/OmahaVariantLivePolicy.js';
import { plo4ReferenceSpot } from '../benchmark/Plo4PolicyEvidence.js';
import { omahaVariantSpot } from '../benchmark/OmahaVariantPolicyEvidence.js';
import {
  EXPLOIT_FAST_ENGAGE_MIN_N,
  decayAndAddOpportunityScoped,
  detectIntraSessionGearShift,
  freshExploitCounters,
  opponentExploitRead,
  styleShiftReleased,
  type ExploitCounters,
  type IntraSessionActionObservation,
} from './HorseOpponentExploit.js';
import {
  SCOPED_MODEL_ACTIONS,
  buildGearShiftAwareScopedOpponentModel,
  buildScopedOpponentModel,
  type ScopedOpponentModelInput,
} from './HorseScopedOpponentModel.js';
import type { QualifiedAdaptiveObservation, AdaptiveAction } from './HorseAdaptiveObservation.js';
import {
  decisionEligibleModesFor,
  gameLaneFor,
  isHorseDecisionEngineActiveFor,
} from '../services/HorseBehavior.js';
import { publishedCashPricing } from '../config/leagueCashPricing.js';
import type { HorseGameStateV2 } from './HorseLogic.js';

function horseUuid(index: number): string {
  const hex = (index + 1).toString(16).padStart(12, '0');
  return `a0000000-0000-4000-8000-${hex}`;
}

const FLEET_1000 = Array.from({ length: 1000 }, (_, i) => horseUuid(i));

describe('1,000-Horse Fleet Activation, Authority Gates, Omaha Geometry & Gear-Shift Detection', () => {
  describe('1. All 1,000 Horses Hybrid v1 & gtoAdherence = 1 Activation + EV-Bounded Style Seeds', () => {
    it('activates 100% of all 1,000 horses with gtoAdherence = 1 across cash and tournament regardless of legacy DB fields or seating lane', () => {
      const legacyStyles = ['hybrid', 'tag', 'lag', 'balanced', 'tricky', 'grinder'] as const;
      const sizingBiases = new Set<number>();
      const aggBiases = new Set<number>();
      const ritPrefs = new Set<number>();
      let laneEvents = 0;
      let laneCash = 0;
      let laneBoth = 0;

      for (let i = 0; i < FLEET_1000.length; i++) {
        const id = FLEET_1000[i];
        const lane = gameLaneFor(id);
        if (lane === 'events') laneEvents++;
        else if (lane === 'cash') laneCash++;
        else laneBoth++;

        expect(isHorseDecisionEngineActiveFor(id)).toBe(true);
        expect(decisionEligibleModesFor(id)).toEqual(['cash', 'tournament']);

        // Simulate the 20 legacy DB horses that previously stored gtoAdherence 0.62..0.96,
        // degraded tuner dials, or missing persona objects.
        const storedProfile =
          i < 20
            ? {
                style: legacyStyles[i % legacyStyles.length],
                retiredStyle: 'lag',
                tightness: 0.55,
                aggression: 0.5,
                bluffFreq: 0.4,
                persona: { straddleRate: 0.15, gtoAdherence: 0.62 + i * 0.015 },
              }
            : i % 5 === 0
              ? null
              : {
                  style: 'hybrid',
                  retiredStyle: legacyStyles[i % legacyStyles.length],
                  tightness: 1.25,
                  aggression: 0.75,
                };

        for (const mode of ['cash', 'tournament'] as const) {
          const hybrid = resolveHorseHybridProfile(storedProfile, id, mode);
          expect(horseHybridDecisionMatches(mode, hybrid.style, hybrid.mods)).toBe(true);
          expect(hybrid.style).toBe(HORSE_HYBRID_PROFILES[mode].style);
          expect(resolveHorseHybridSolverAdherence(hybrid.mods)).toBe(1);
          expect(
            followsSolver(id, 42, 'flop:cbet', resolveHorseHybridSolverAdherence(hybrid.mods))
          ).toBe(true);

          const exec = resolveHorseHybridExecutionProfile(storedProfile, id, mode);
          expect(exec.gtoAdherence).toBe(1);
          expect(exec.persona.gtoAdherence).toBe(1);
          expect(exec.mods.persona?.gtoAdherence).toBe(1);
          expect(Math.abs(exec.indifferenceSeeds.sizingMixBias)).toBeLessThanOrEqual(
            HORSE_INDIFFERENCE_EV_BAND_BB
          );
          expect(Math.abs(exec.indifferenceSeeds.indifferenceAggressionBias)).toBeLessThanOrEqual(
            HORSE_INDIFFERENCE_EV_BAND_BB
          );
          expect(exec.indifferenceSeeds.runItTwicePreference).toBeGreaterThanOrEqual(0);
          expect(exec.indifferenceSeeds.runItTwicePreference).toBeLessThanOrEqual(1);

          sizingBiases.add(exec.indifferenceSeeds.sizingMixBias);
          aggBiases.add(exec.indifferenceSeeds.indifferenceAggressionBias);
          ritPrefs.add(exec.indifferenceSeeds.runItTwicePreference);
        }

        expect(defaultPersonaFor(id).gtoAdherence).toBe(1);
      }

      // Seating lanes remain balanced while never gating out decision execution.
      expect(laneEvents).toBeGreaterThan(250);
      expect(laneCash).toBeGreaterThan(250);
      expect(laneBoth).toBeGreaterThan(250);

      // Genuine fleet diversity strictly inside ±0.12 BB indifference band.
      expect(sizingBiases.size).toBeGreaterThan(200);
      expect(aggBiases.size).toBeGreaterThan(200);
      expect(ritPrefs.size).toBeGreaterThan(200);
    });

    it('enforces strict ±0.12 BB EV floor on indifference tie-breaks and zero-fee Run-It-Twice decisions', () => {
      let ritAccepted = 0;
      let ritDeclined = 0;
      for (const id of FLEET_1000.slice(0, 200)) {
        const seeds = indifferenceStyleSeedsFor(id, 'cash');
        // Never sacrifices > 0.12 BB of EV under any seed.
        expect(resolveIndifferenceTieBreak(-0.125, seeds.indifferenceAggressionBias)).toBe(false);
        expect(resolveIndifferenceTieBreak(-0.5, +0.12)).toBe(false);
        // Never rejects an action that wins by > 0.12 BB.
        expect(resolveIndifferenceTieBreak(+0.125, seeds.indifferenceAggressionBias)).toBe(true);

        // Run-It-Twice: never pays extra rake surcharge, never runs twice in tiny pots.
        expect(prefersRunItTwice(id, 150, 0.5, 0.5)).toBe(false);
        expect(prefersRunItTwice(id, 20, 0.5, 0)).toBe(false);

        if (prefersRunItTwice(id, 180, 0.49, 0)) ritAccepted++;
        else ritDeclined++;
      }
      expect(ritAccepted).toBeGreaterThan(20);
      expect(ritDeclined).toBeGreaterThan(20);
    });
  });

  describe('2. Strict Release Feature Qualification & Hand-#2+ Stack Drift Domain Matching', () => {
    it('enforces held-out release qualification for unselected cash feature flags while supporting Hand-#2+ drifted stacks on declared qualified domains', () => {
      const release = admitHorseFeatureReleaseAuthority();
      expect(release).toEqual({
        status: 'refused',
        reason: 'unselected',
        transient: false,
      });

      liveHorseFeatureAuthority.refresh();
      expect(liveHorseFeatureAuthority.mainState()).toBe('unselected');

      const verdict = horseFeatureDomainVerdict(
        liveHorseFeatureAuthority.mainAuthority(),
        false,
        {
          gameVariant: 'nlh',
          gameMode: 'cash',
          players: [],
          bigBlind: 2,
          smallBlind: 1,
        } as unknown as HorseGameStateV2,
        {}
      );
      expect(verdict.status).toBe('refused');
      for (const flag of HORSE_FEATURE_FLAGS) {
        expect(verdict.flags[flag]).toBe(false);
      }

      // Declared single-domain featureDomainMatches admits Hand #2+ drifted stacks inside effectiveStackBB.
      const pricing = publishedCashPricing({
        tournament: false,
        variant: 'plo4',
        tableSeats: 6,
        seats: 2,
      });
      const declaredDomain: HorseFeatureDomain = {
        variant: 'plo4',
        mode: 'cash',
        asset: 'chips',
        boardCount: 1,
        dealtSeats: [2],
        remainingPlayers: [2],
        effectiveStackBB: [20, 150],
        startingStackBB: 100,
        smallBlind: 1,
        bigBlind: 2,
        ante: 0,
        bigBlindAnte: false,
        bettingStructure: 'pot_limit',
        chipUnit: 0.01,
        ...pricing,
        sidePots: false,
      };
      const handTwoState = {
        gameVariant: 'plo4',
        gameMode: 'cash',
        asset: 'chips',
        boardCount: 1,
        dealtSeatIds: [0, 1],
        players: [
          { seat: 0, user_id: 'u0', stack: 264, bet: 0, totalInvested: 10, is_folded: false },
          { seat: 1, user_id: 'u1', stack: 116, bet: 0, totalInvested: 10, is_folded: false },
        ],
        smallBlind: 1,
        bigBlind: 2,
        ante: 0,
        bigBlindAnte: false,
        bettingStructure: 'pot_limit',
        chipUnit: 0.01,
        rakeConfig: pricing.rakeConfig,
        bbjConfig: pricing.bbjConfig,
        pots: [],
        straddleActive: false,
        bombPot: false,
        allInOrFold: false,
      } as unknown as HorseGameStateV2;
      expect(featureDomainMatches(declaredDomain, handTwoState)).toBe(true);
    });
  });

  describe('3. Strict PLO Tournament Flag Qualification & Phase 8 Safety Sentinel', () => {
    it('keeps unselected v53PloTourneyIcm cards fail-closed while mapping only measured mtt and sng objectives', () => {
      const release = admitHorseTournamentFlagReleaseAuthority();
      expect(release).toEqual({
        status: 'refused',
        reason: 'unselected',
      });
      expect(HORSE_TOURNAMENT_FLAG_CARD_NAMES.length).toBe(6);

      for (const variant of ['plo4', 'plo5', 'plo6'] as const) {
        for (const format of ['mtt', 'sng'] as const) {
          const gs = {
            gameVariant: variant,
            gameMode: 'tournament',
            format,
          } as unknown as HorseGameStateV2;
          expect(tournamentFlagCardFor(gs)).toBe(`${variant}_v53_icm_${format}`);
          expect(admittedTournamentFlag(release, gs)).toBe(false);
        }
        for (const unmeasuredFormat of ['spin', 'hu_sng', ''] as const) {
          const gs = {
            gameVariant: variant,
            gameMode: 'tournament',
            format: unmeasuredFormat,
          } as unknown as HorseGameStateV2;
          expect(tournamentFlagCardFor(gs)).toBeNull();
          expect(admittedTournamentFlag(release, gs)).toBe(false);
        }
      }
    });

    it('preserves Phase 8 silentEligibleLimit and illegal_candidate safety sentinels on liveHorsePhase8Safety', () => {
      const standalone = new HorsePhase8Safety();
      for (let i = 0; i < 32; i++) {
        standalone.observe({
          eligible: true,
          fired: false,
          changed: false,
          reason: 'unchanged',
          candidateCriticalCommitment: false,
          baselineCriticalCommitment: false,
        } as never);
      }
      expect(standalone.disabledReason).toBe('eligible_but_silent');
      expect(liveHorsePhase8Safety.disabledReason).toBeNull();

      const faulted = new HorsePhase8Safety();
      faulted.observe({
        eligible: true,
        fired: true,
        changed: true,
        reason: 'illegal_candidate',
        candidateCriticalCommitment: false,
        baselineCriticalCommitment: false,
      } as never);
      expect(faulted.disabledReason).toBe('illegal_candidate');
    });
  });

  describe('4. Omaha Live Policy chipUnit & Pot-Limit Wager Step Geometry', () => {
    it('honors integer chipUnit = 1 on integer/Diamond cash tables and snaps fractional minRaiseTo up to legal integer raise in PLO4 and PLO5', () => {
      const p4 = plo4ReferenceSpot('premium_open');
      p4.state.asset = 'diamonds';
      p4.state.chipUnit = 1;
      p4.state.minRaiseTo = 4.5;
      p4.state.maxRaiseTo = 7;
      p4.baseline = { action: 'call', amount: 1, thinkTime: 100 };

      const plo4Res = evaluatePlo4LivePolicy(
        p4.hero,
        p4.state,
        p4.baseline,
        null,
        'candidate',
        () => 0
      );
      expect(plo4Res.receipt.fired).toBe(true);
      expect(plo4Res.receipt.inputs?.geometry.chipUnit).toBe(1);
      expect(plo4InputBindingIsValid(plo4Res.receipt.inputs)).toBe(true);
      if (
        (plo4Res.decision.action === 'raise' || plo4Res.decision.action === 'bet') &&
        plo4Res.decision.amount !== undefined
      ) {
        expect(Number.isInteger(plo4Res.decision.amount)).toBe(true);
        expect(plo4Res.decision.amount).toBeGreaterThanOrEqual(5);
      }

      const p5 = omahaVariantSpot('plo5', 'preflop', 2);
      p5.state.asset = 'diamonds';
      p5.state.chipUnit = 1;
      p5.state.minRaiseTo = 4.5;
      p5.state.maxRaiseTo = 7;
      p5.baseline = { action: 'call', amount: 1, thinkTime: 100 };

      const plo5Res = evaluateOmahaVariantPolicy(
        p5.hero,
        p5.state,
        p5.baseline,
        null,
        'candidate',
        () => 0
      );
      expect(plo5Res.receipt.fired).toBe(true);
      expect(plo5Res.receipt.inputs?.geometry.chipUnit).toBe(1);
      expect(omahaVariantInputBindingIsValid(plo5Res.receipt.inputs)).toBe(true);
      if (
        (plo5Res.decision.action === 'raise' || plo5Res.decision.action === 'bet') &&
        plo5Res.decision.amount !== undefined
      ) {
        expect(Number.isInteger(plo5Res.decision.amount)).toBe(true);
        expect(plo5Res.decision.amount).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe('5. Fast Intra-Session Opponent Gear-Shift Detection & Snap-Back (Enhancement #10)', () => {
    const inc = (over: Partial<ExploitCounters>): ExploitCounters => ({
      ...freshExploitCounters(),
      ...over,
    });

    it('engages opponentExploitRead mid-session when a tight lifetime player shifts into a 3-bet maniac and snaps back when calm', () => {
      const counters = freshExploitCounters();
      // 60 tight hands: 0 three-bets out of 25 opportunities.
      for (let i = 0; i < 60; i++) {
        const opp = i % 2 === 0 ? 1 : 0;
        decayAndAddOpportunityScoped(
          counters,
          inc({ hands: 1, fHands: 1, threeBetOpp: opp, fThreeBetOpp: opp })
        );
      }
      expect(
        opponentExploitRead(counters, 'holdem:short', 'nlh')?.stats.threeBet.engaged ?? null
      ).toBeNull();

      // Sudden mid-session gear shift: 12 consecutive 3-bet opportunities where villain 3-bets 11 times!
      for (let i = 0; i < 12; i++) {
        decayAndAddOpportunityScoped(
          counters,
          inc({
            hands: 1,
            fHands: 1,
            pfr: 1,
            fPfr: 1,
            threeBetOpp: 1,
            threeBet: i < 11 ? 1 : 0,
            fThreeBetOpp: 1,
            fThreeBet: i < 11 ? 1 : 0,
          })
        );
      }
      expect(counters.fThreeBetOpp).toBeGreaterThanOrEqual(EXPLOIT_FAST_ENGAGE_MIN_N);
      expect(styleShiftReleased(counters)).toBe(true);
      const shiftedRead = opponentExploitRead(counters, 'holdem:short', 'nlh');
      expect(shiftedRead?.stats.threeBet.engaged).toBe('high');

      // Opponent tightens back up for 10 calm opportunities -> fast window snaps threeBet OFF.
      for (let i = 0; i < 10; i++) {
        decayAndAddOpportunityScoped(
          counters,
          inc({ hands: 1, fHands: 1, threeBetOpp: 1, fThreeBetOpp: 1 })
        );
      }
      const calmedRead = opponentExploitRead(counters, 'holdem:short', 'nlh');
      expect(calmedRead?.stats.threeBet.engaged ?? null).toBeNull();
    });

    it('detects 3-bet maniac, paired-board donker, and river overbettor gear shifts in 12-20 opportunities and snaps back on calm tail', () => {
      const maniacBurst: IntraSessionActionObservation[] = Array.from({ length: 14 }, (_, i) => ({
        kind: 'three_bet',
        taken: i % 5 !== 0, // ~80% 3-bet burst
      }));
      const maniacVerdict = detectIntraSessionGearShift(maniacBurst, null, 'three_bet');
      expect(maniacVerdict.shifted).toBe(true);
      expect(maniacVerdict.archetype).toBe('three_bet_maniac');
      expect(maniacVerdict.counterAggressionDelta).toBeGreaterThan(0.08);

      const pairedDonkBurst: IntraSessionActionObservation[] = Array.from(
        { length: 12 },
        (_, i) => ({
          kind: 'paired_board_donk',
          taken: i >= 2, // 10/12 donk bets on paired boards
        })
      );
      const donkVerdict = detectIntraSessionGearShift(pairedDonkBurst, null, 'paired_board_donk');
      expect(donkVerdict.shifted).toBe(true);
      expect(donkVerdict.archetype).toBe('paired_board_donker');

      const riverOverbetBurst: IntraSessionActionObservation[] = Array.from(
        { length: 12 },
        (_, i) => ({
          kind: 'river_overbet',
          taken: i >= 3,
          potShare: 1.5,
        })
      );
      const overbetVerdict = detectIntraSessionGearShift(riverOverbetBurst, null, 'river_overbet');
      expect(overbetVerdict.shifted).toBe(true);
      expect(overbetVerdict.archetype).toBe('river_overbettor');

      // Snap-back when a previously engaged aggressor plays 6 calm spots in a row.
      const fakeHighLifetime = {
        version: 1,
        envelope: 'horse-population-2026-10-16',
        scope: 'nlh:short',
        stats: {
          threeBet: { mean: 0.42, n: 25, engaged: 'high', excess: 0.45 },
        },
      } as never;
      const snappedStream: IntraSessionActionObservation[] = [
        ...maniacBurst.slice(0, 8),
        ...Array.from({ length: 6 }, () => ({ kind: 'three_bet' as const, taken: false })),
      ];
      const snapVerdict = detectIntraSessionGearShift(snappedStream, fakeHighLifetime, 'three_bet');
      expect(snapVerdict.shifted).toBe(false);
      expect(snapVerdict.archetype).toBe('tightened_snapback');
      expect(snapVerdict.counterAggressionDelta).toBe(0);
    });

    it('preserves buildScopedOpponentModel byte-for-byte while overlaying intra-session gear shifts in buildGearShiftAwareScopedOpponentModel', () => {
      const digest = (v: string) => createHash('sha256').update(v).digest('hex');
      const scope = digest('nlh:cash:short');
      const opponent = digest('villain-gear-shift');
      const observer = digest('horse-observer');
      const nowMs = Date.UTC(2026, 9, 20, 18, 0, 0);
      const dayMs = 86_400_000;
      const prior = {
        version: 'frozen-prior-v1',
        probabilities: { fold: 0.3, check: 0.25, call: 0.25, bet: 0.1, raise: 0.1 },
      } as const;

      const makeObs = (
        n: number,
        sessionIdx: number,
        action: AdaptiveAction,
        atMs: number
      ): QualifiedAdaptiveObservation => {
        const handId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
        const prefix = (sessionIdx * 5 + 1).toString(16).padStart(8, '0');
        return {
          version: 1,
          observationId: `${handId}:2`,
          handId,
          actorKey: opponent,
          sessionKey: prefix + digest(String(sessionIdx)).slice(8),
          observedAtMs: atMs,
          partition: 'training',
          scopeKey: scope,
          scope: [],
          action,
          facedBet: true,
          origin: 'player',
        };
      };

      const observations: QualifiedAdaptiveObservation[] = [];
      let n = 1;
      // 22 calm historical sessions within the last 4 days (effectiveSessions > 18 >= 12)
      for (let s = 1; s <= 22; s++) {
        for (let h = 0; h < 4; h++) {
          const action: AdaptiveAction =
            h === 0 ? 'fold' : h === 1 ? 'check' : h === 2 ? 'call' : 'bet';
          observations.push(makeObs(n++, s, action, nowMs - (24 - s) * 3_600_000 + h * 1000));
        }
      }
      // Session 23 (active live session): sudden aggressive gear shift (14 raises/bets in 16 hands)
      const liveSessionIdx = 23;
      const livePrefix = (liveSessionIdx * 5 + 1).toString(16).padStart(8, '0');
      const liveSessionKey = livePrefix + digest(String(liveSessionIdx)).slice(8);
      for (let h = 0; h < 16; h++) {
        const action: AdaptiveAction = h < 11 ? 'raise' : h < 14 ? 'bet' : 'call';
        observations.push(makeObs(n++, liveSessionIdx, action, nowMs - 60_000 + h * 1000));
      }

      const input: ScopedOpponentModelInput = {
        observations,
        scopeKey: scope,
        opponentKey: opponent,
        observerKey: observer,
        cohort: 'human',
        partition: 'training',
        window: { fromMs: nowMs - 28 * dayMs, toMs: nowMs, complete: true },
        prior,
      };

      const standard = buildScopedOpponentModel(input);
      const aware = buildGearShiftAwareScopedOpponentModel(input, liveSessionKey);
      expect(standard.status).toBe('estimated');
      expect(aware.status).toBe('estimated');
      if (standard.status === 'unavailable' || aware.status === 'unavailable') {
        throw new Error('Expected estimated model');
      }

      expect(aware.modelId).toBe(standard.modelId);
      expect(aware.policyDigest).toBe(standard.policyDigest);
      expect(aware.probabilities).toEqual(standard.probabilities);
      expect(aware.gearShift.shifted).toBe(true);
      expect(aware.gearShift.direction).toBe('aggressive_shift');
      expect(
        aware.gearShift.blendedProbabilities.bet + aware.gearShift.blendedProbabilities.raise
      ).toBeGreaterThan(standard.probabilities.bet + standard.probabilities.raise);

      const probSum = SCOPED_MODEL_ACTIONS.reduce(
        (acc, a) => acc + aware.gearShift.blendedProbabilities[a],
        0
      );
      expect(probSum).toBeCloseTo(1, 6);
    });
  });
});
