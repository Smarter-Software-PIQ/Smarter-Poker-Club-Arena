import { describe, expect, it } from 'vitest';
import {
  HORSE_PHASE_KEYS,
  HORSE_PHASE_STATUS_ORDER,
  HORSE_FLEET_ADMISSION_BOUND,
  HorseFleetPhaseInterpreter,
  type HorsePhaseProof,
  type HorsePhaseProofs,
} from '../services/horseDecisionJournal/phaseProof.js';
import {
  evaluateTournamentUtility,
  evaluateTournamentUtilityDetailed,
  buildTournamentActionCandidates,
  type TournamentUtilityInput,
  type TournamentUtilityContext,
} from './HorseTournamentUtility.js';
import { exactIcmEquity, icmEquityEstimate } from './IcmModel.js';
import type { SeatPlayer } from '../types.js';
import {
  HORSE_POLICY_ORDER,
  HORSE_POLICY_GRAPH_VERSION,
  HorsePolicyGraph,
} from './HorsePolicyGraph.js';

export interface Phase24SkillActivationSummary {
  readonly totalPhaseCount: number;
  readonly activeAcceptedPhases: readonly string[];
  readonly activeNotSelectedPhases: readonly string[];
  readonly shadowPhases: readonly string[];
  readonly outsideDomainPhases: readonly string[];
  readonly refusedPhases: readonly string[];
  readonly unknownOrUnobservedPhases: readonly string[];
  /** True ONLY when every eligible phase is applicable-active and zero phases are refused/unknown. */
  readonly allEligiblePhasesVerifiedActive: boolean;
}

/**
 * Summarizes a 15-phase `HorsePhaseProofs` map from `HorseFleetPhaseInterpreter`
 * without collapsing `outside-domain`, `shadow`, `not-selected`, or `unknown`
 * into active execution proof (Item 24).
 */
export function summarizePhase24SkillActivation(
  proofs: HorsePhaseProofs
): Phase24SkillActivationSummary {
  const activeAcceptedPhases: string[] = [];
  const activeNotSelectedPhases: string[] = [];
  const shadowPhases: string[] = [];
  const outsideDomainPhases: string[] = [];
  const refusedPhases: string[] = [];
  const unknownOrUnobservedPhases: string[] = [];

  for (const key of HORSE_PHASE_KEYS) {
    const p: HorsePhaseProof | undefined = proofs[key];
    if (!p) {
      unknownOrUnobservedPhases.push(key);
      continue;
    }
    if (p.status === 'applicable-active') {
      if (p.application === 'accepted') {
        activeAcceptedPhases.push(key);
      } else {
        activeNotSelectedPhases.push(key);
      }
    } else if (p.status === 'shadow') {
      shadowPhases.push(key);
    } else if (p.status === 'outside-domain') {
      outsideDomainPhases.push(key);
    } else if (p.status === 'refused') {
      refusedPhases.push(key);
    } else {
      unknownOrUnobservedPhases.push(key);
    }
  }

  const eligibleCount =
    activeAcceptedPhases.length +
    activeNotSelectedPhases.length +
    shadowPhases.length +
    refusedPhases.length +
    unknownOrUnobservedPhases.length;

  const allEligiblePhasesVerifiedActive =
    eligibleCount > 0 &&
    refusedPhases.length === 0 &&
    unknownOrUnobservedPhases.length === 0 &&
    shadowPhases.length === 0 &&
    activeAcceptedPhases.length + activeNotSelectedPhases.length === eligibleCount;

  return {
    totalPhaseCount: HORSE_PHASE_KEYS.length,
    activeAcceptedPhases,
    activeNotSelectedPhases,
    shadowPhases,
    outsideDomainPhases,
    refusedPhases,
    unknownOrUnobservedPhases,
    allEligiblePhasesVerifiedActive,
  };
}

function makeBaseTournamentContext(
  overrides: Partial<TournamentUtilityContext> = {}
): TournamentUtilityContext {
  return {
    format: 'mtt',
    playersLeft: 4,
    spotsPaid: 3,
    payoutPct: [50, 30, 20],
    prizePoolCents: 100_000,
    bountyPoolCents: 0,
    bountyFactor: 0,
    bountyByUser: {},
    isBounty: false,
    isPko: false,
    isMysteryBounty: false,
    mysteryBountyStage: 'none',
    mysteryMeanCents: 0,
    meanBountyCents: 0,
    satellite: false,
    satelliteSeats: 0,
    fieldStacks: [3000, 1200, 1800, 400],
    fieldStackByUser: {
      'hero-mid': 1200,
      'villain-cov': 1800,
    },
    reentryOpen: false,
    rebuyOpen: false,
    maxReentries: 0,
    maxRebuys: 0,
    addOnPeriodOpen: false,
    buyInCents: 10_000,
    startingStackChips: 1500,
    rebuyCostCents: null,
    rebuyChips: null,
    rebuyPrizeContributionCents: null,
    rebuyBountyContributionCents: null,
    addOnCostCents: null,
    addOnChips: null,
    reloadsUsed: 0,
    addOnTaken: false,
    rebuyAffordable: false,
    addOnAffordable: false,
    ...overrides,
  };
}

function makeBubbleUtilityInput(
  overrides: Partial<TournamentUtilityInput> = {}
): TournamentUtilityInput {
  const hero: SeatPlayer = {
    user_id: 'hero-mid',
    username: 'hero-mid',
    seat: 1,
    stack: 1100,
    bet: 100,
    totalInvested: 100,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const villain: SeatPlayer = {
    user_id: 'villain-cov',
    username: 'villain-cov',
    seat: 2,
    stack: 600,
    bet: 1200,
    totalInvested: 1200,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const showdowns = Array.from({ length: 160 }, (_, i) => ({
    boards: [
      {
        // Hero wins 84 of 160 (52.5% raw chip equity)
        heroHigh: i < 84 ? 100 : 10,
        opponentHigh: [i < 84 ? 10 : 100],
        opponentDecisionStrength: [0.85],
        heroLow: null,
        opponentLow: [null],
      },
    ],
  }));

  return {
    street: 'preflop',
    pot: 1300,
    currentBet: 1200,
    toCall: 1100,
    minRaiseTo: null,
    maxRaiseTo: null,
    legalActions: ['fold', 'all_in'],
    bettingStructure: 'no_limit',
    baseline: { action: 'all_in', thinkTime: 0 },
    hero,
    players: [hero, villain],
    pots: [{ amount: 1300, eligiblePlayers: ['hero-mid', 'villain-cov'] }],
    opponents: [
      {
        userId: 'villain-cov',
        range: [0.05, 0.25],
        foldMul: 1,
        actsAfterHero: false,
      },
    ],
    sampledOpponentIds: ['villain-cov'],
    heroEquity: 0.525,
    equitySampleSize: 320,
    equityStandardError: 0.015,
    showdownSamples: showdowns,
    context: makeBaseTournamentContext(),
    settlement: {
      chipUnit: 1,
      dealerSeat: 2,
      splitLow: false,
    },
    ...overrides,
  };
}

describe('HorsePhase24And26Readiness (Items 24, 26 & 30)', () => {
  it('pins the 15-phase keys, status order, and closed admission bound (Item 24)', () => {
    expect(HORSE_PHASE_KEYS).toHaveLength(15);
    expect(HORSE_PHASE_KEYS[0]).toBe('phase1');
    expect(HORSE_PHASE_KEYS[14]).toBe('phase15');
    expect(HORSE_PHASE_STATUS_ORDER).toEqual([
      'applicable-active',
      'shadow',
      'refused',
      'outside-domain',
      'unobserved',
      'unknown',
    ]);
    expect(HORSE_FLEET_ADMISSION_BOUND).toBeGreaterThanOrEqual(20);
    expect(HORSE_POLICY_GRAPH_VERSION).toBe('horse-policy-order-v3');
    expect(HORSE_POLICY_ORDER).toHaveLength(10);
  });

  it('distinguishes applicable-active (accepted vs not-selected), shadow, outside-domain, refused, and unknown phases without false completion (Item 24)', () => {
    const interpreter = new HorseFleetPhaseInterpreter(() => {});
    const invalidProofs = interpreter.interpret(
      {
        snapshot: {
          type: 'DECIDE_FAST',
          gameState: { gameVariant: 'nlh', gameMode: 'cash', stage: 'flop' },
        } as any,
        decision: { action: 'invalid_action' as any, thinkTime: 0 },
        readFrame: { sha256: '0'.repeat(64) } as any,
      },
      { executionStatus: 'coerced' } as any,
      { applicationVerified: false } as any
    );
    const summaryInvalid = summarizePhase24SkillActivation(invalidProofs);
    expect(summaryInvalid.unknownOrUnobservedPhases).toHaveLength(15);
    expect(summaryInvalid.allEligiblePhasesVerifiedActive).toBe(false);

    const syntheticComplete: HorsePhaseProofs = Object.fromEntries(
      HORSE_PHASE_KEYS.map((key, idx) => [
        key,
        idx < 3
          ? {
              status: 'outside-domain',
              capability: 'captured',
              eligibility: 'outside-domain',
              qualification: 'unknown',
              application: 'not-applicable',
              reason: 'outside_declared_runtime_domain',
            }
          : {
              status: 'applicable-active',
              capability: 'captured',
              eligibility: 'eligible',
              qualification: 'verified',
              application: idx % 2 === 0 ? 'accepted' : 'not-selected',
              reason: 'protected_owner_independently_qualified',
            },
      ])
    );
    const summaryComplete = summarizePhase24SkillActivation(syntheticComplete);
    expect(summaryComplete.outsideDomainPhases).toHaveLength(3);
    expect(summaryComplete.activeAcceptedPhases.length).toBeGreaterThan(0);
    expect(summaryComplete.activeNotSelectedPhases.length).toBeGreaterThan(0);
    expect(summaryComplete.allEligiblePhasesVerifiedActive).toBe(true);
  });

  it('verifies exact Malmuth-Harville ICM conservation and bubble risk aversion overriding a marginal +cEV all-in call when a micro-stack is at the table (Items 26 & 30)', () => {
    // 4 players left, 3 spots paid [50, 30, 20]. Stacks: [3000, 1200 (Hero), 1800 (Villain), 400 (Short)].
    // If Hero folds (1100 chips left while Short has 400), Hero's ICM equity is ~24.87%.
    // If Hero calls all-in (1100 to win 1300 -> 2400 on win, 0 on loss):
    //   - On win (2400 chips): Hero has ~33.9% ICM equity.
    //   - On loss (0 chips): Hero busts 4th (bubble = 0% payout!).
    //   - Required bubble equity to call is ~24.87 / 33.9 = ~73.3%, whereas chip-EV only requires 1100/2400 = 45.8%!
    //   - With 52.5% showdown equity (21/40 wins), calling is +cEV (+160 chips) but heavily -ICM (-7.1% prize pool).
    const bubbleInput = makeBubbleUtilityInput();
    const result = evaluateTournamentUtility(bubbleInput);
    expect(result).not.toBeNull();
    expect(result!.ledger.objective).toBe('mtt_payout');
    expect(result!.ledger.icmMethod).toBe('exact_mh');

    const foldCand = result!.ledger.candidates.find((c) => c.id === 'fold')!;
    const callCand = result!.ledger.candidates.find((c) => c.id === 'call:all-in')!;
    expect(foldCand).toBeDefined();
    expect(callCand).toBeDefined();

    // Call is positive chip EV (+160 chips over fold) but negative tournament payout EV due to bubble death risk
    expect(callCand.chipEv).toBeGreaterThan(foldCand.chipEv);
    expect(foldCand.payoutEv).toBeGreaterThan(callCand.payoutEv + 4.0);
    expect(result!.decision.action).toBe('fold');
    expect(result!.ledger.overrodeBaseline).toBe(true);
  });

  it('shifts candidate utility upward in PKO / bounty mode when Hero covers a short all-in opponent (Items 26 & 30)', () => {
    // Hero (1800) covers Villain (500 all-in). Pot = 600, toCall = 400.
    const hero: SeatPlayer = {
      user_id: 'hero-cov',
      username: 'hero-cov',
      seat: 1,
      stack: 1700,
      bet: 100,
      totalInvested: 100,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const shortVillain: SeatPlayer = {
      user_id: 'villain-short',
      username: 'villain-short',
      seat: 2,
      stack: 0,
      bet: 500,
      totalInvested: 500,
      cards: [],
      is_folded: false,
      is_all_in: true,
      is_sitting_out: false,
    };
    const showdowns = Array.from({ length: 40 }, (_, i) => ({
      boards: [
        {
          heroHigh: i < 18 ? 100 : 10,
          opponentHigh: [i < 18 ? 10 : 100],
          opponentDecisionStrength: [0.8],
          heroLow: null,
          opponentLow: [null],
        },
      ],
    }));

    const baseInput: TournamentUtilityInput = {
      street: 'preflop',
      pot: 600,
      currentBet: 500,
      toCall: 400,
      minRaiseTo: null,
      maxRaiseTo: null,
      legalActions: ['fold', 'call'],
      bettingStructure: 'no_limit',
      baseline: { action: 'fold', thinkTime: 0 },
      hero,
      players: [hero, shortVillain],
      pots: [{ amount: 600, eligiblePlayers: ['hero-cov', 'villain-short'] }],
      opponents: [
        {
          userId: 'villain-short',
          range: [0.1, 0.3],
          foldMul: 1,
          actsAfterHero: false,
        },
      ],
      sampledOpponentIds: ['villain-short'],
      heroEquity: 0.45,
      equitySampleSize: 40,
      equityStandardError: 0.02,
      showdownSamples: showdowns,
      context: makeBaseTournamentContext({
        playersLeft: 3,
        spotsPaid: 2,
        payoutPct: [65, 35],
        fieldStacks: [1800, 500, 1700],
        fieldStackByUser: {
          'hero-cov': 1800,
          'villain-short': 500,
        },
      }),
      settlement: {
        chipUnit: 1,
        dealerSeat: 2,
        splitLow: false,
      },
    };

    const nonBountyRes = evaluateTournamentUtility(baseInput)!;
    const pkoRes = evaluateTournamentUtility({
      ...baseInput,
      context: {
        ...baseInput.context,
        isBounty: true,
        isPko: true,
        bountyPoolCents: 100_000,
        bountyFactor: 0.5,
        bountyByUser: {
          'hero-cov': 10_000,
          'villain-short': 25_000,
        },
        meanBountyCents: 25_000,
      },
    })!;

    const nonBountyCall = nonBountyRes.ledger.candidates.find((c) => c.id === 'call')!;
    const pkoCall = pkoRes.ledger.candidates.find((c) => c.id === 'call')!;
    expect(nonBountyCall.bountyEv).toBe(0);
    expect(pkoCall.bountyEv).toBeGreaterThan(0);
    expect(pkoRes.ledger.objective).toBe('pko');
  });

  it('enforces strict input validation and returns explicit unavailableReason on field reconciliation drift (Item 26)', () => {
    const drifted = evaluateTournamentUtilityDetailed(
      makeBubbleUtilityInput({
        context: makeBaseTournamentContext({
          // Sum of fieldStacks does not match local stacks + pot
          fieldStacks: [5000, 5000, 5000, 5000],
        }),
      })
    );
    expect(drifted.result).toBeNull();
    expect(drifted.unavailableReason).toBe('field_reconciliation');
  });
});
