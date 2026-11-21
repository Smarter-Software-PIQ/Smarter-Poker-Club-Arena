import { HORSE_FEATURE_FLAGS } from '../HorseFeatureAuthority.js';
import { CATASTROPHE_GUARD_VERSION } from '../HorseTournamentCatastropheGuard.js';
import { correctiveKernelReceiptIsValid } from '../../services/horseCorrectiveReview/kernelReceipt.js';
import { plo4LiveReceiptBindingIsValid } from '../plo4/Plo4LivePolicy.js';
import { omahaVariantReceiptBindingIsValid } from '../omaha/OmahaVariantLivePolicy.js';
import { remainingVariantReceiptBindingIsValid } from '../remainingVariants/RemainingVariantLivePolicy.js';
import { jointReceiptBindingIsValid } from '../multiway/JointLivePolicy.js';
import { horsePhase6AttributionIsValid } from '../HorsePhase6Attribution.js';
import { horseTournamentUtilityEvidenceIsValid } from '../HorseTournamentUtilityEvidence.js';
import type { HorseDecision, HorseTournamentUtilityLedger, SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';
import { MAX_UTILITY_OUTCOMES } from '../HorseTournamentUtility.js';
import { jointStateKey } from '../multiway/JointRangeSampler.js';
import {
  horsePolicyOrderForVersion,
  type HorsePolicyAction,
  type HorsePolicyGraphReceipt,
} from '../HorsePolicyGraph.js';
import { horsePolicyOwnershipMatches } from '../HorsePolicyRegistry.js';
import type { GovernorSnapshot } from '../EquityLoadGovernor.js';
import { PHASE8_POLICY } from '../HorseTournamentPostflop.js';
import { horseAuthorityReceiptIsWellFormed } from '../HorseQualifiedAuthority.js';
import { PLO4_POLICY_PACK } from '../plo4/Plo4PolicyPack.js';
import { isOmahaPolicyVariant, OMAHA_VARIANT_PACKS } from '../omaha/OmahaVariantPolicyPack.js';
import {
  isRemainingPolicyVariant,
  REMAINING_VARIANT_PACKS,
} from '../remainingVariants/RemainingVariantPolicyPack.js';
import { isJointVariant } from '../multiway/JointInputBinding.js';
import { JOINT_LIVE_DOMAIN } from '../multiway/JointLivePolicy.js';
import { horsePhase13ContinuationVersion } from '../HorsePhase13Authority.js';
import {
  PLO_PAIRED_BOARD_VARIANTS,
  ploPairedBoardMustFold,
  ploPairedBoardRiverMustCheck,
} from '../HorsePloPairedBoardFold.js';
import { callLargeRiverBoatWager } from '../HorseOmahaBigBetCalls.js';
import {
  OMAHA_RIVER_NUT_RAISE_VARIANTS,
  omahaRiverNutRaiseOnly,
} from '../HorseOmahaRiverNutRaise.js';
import { omahaBeatenMustCheck, omahaBeatenNoRaise } from '../HorseOmahaMadeHandDefense.js';
import {
  OMAHA_STREET_PLAN_VARIANTS,
  omahaStreetPlanAdmitsCheck,
  omahaStreetPlanFlopAdmitsCheck,
  omahaStreetPlanThreeWayAdmitsCheck,
} from '../HorseOmahaStreetPlan.js';
import { omahaPricedSitesFlopBetSpot } from '../HorseOmahaPricedSites.js';
import { omahaOnePairDiscipline } from '../HorseOmahaOnePair.js';
import { huBalanceSpot } from '../HorseHeadsUpPostflopBalance.js';
import {
  OMAHA_RIVER_MEDIUM_BET_VARIANTS,
  omahaRiverMediumBetCall,
} from '../HorseOmahaRiverMediumBetCalls.js';
import {
  OMAHA_OOP_CHECK_VARIANTS,
  omahaBareOverpairContAdmitsCall,
  omahaOopCheckSpot,
  omahaOopTurnFacingBetVerdict,
} from '../HorseOmahaOopChecks.js';
import { plo6MultiwayWeakBetSpot } from '../HorsePlo6MultiwayWeakBet.js';
import {
  omahaBluffPricedAdmitsCheck,
  omahaBluffPricedAdmitsRaiseToCall,
} from '../HorseOmahaBluffPricedAgainstTheTarget.js';
import {
  omahaPricedAdmitsRaiseToCall,
  omahaPricedSampledAdmitsResize,
} from '../HorseOmahaPricedWiring.js';
import {
  OMAHA_CARD_IMPACT_VARIANTS,
  omahaCardImpactCheckAdmissible,
} from '../HorseOmahaCardImpact.js';
import { omahaReraiseRuleProducesCall } from '../HorseOmahaOopReraisedPot.js';
import {
  OMAHA_RUNDOWN_RERAISE_VARIANTS,
  omahaRundownMeasuredAdmitsCall,
} from '../HorseOmahaRundownReraiseMeasured.js';
import { omahaPreflopReraiseDefenceAdmitsCall } from '../HorseOmahaPreflopReraiseDefenceRule.js';
import { omahaDrawRaiseBarOf } from '../HorseOmahaBigDrawAggression.js';
import { shortAllInSpot } from '../HorseShortAllInCallFloor.js';
import {
  OMAHA_MATH_CORE_VARIANTS,
  omahaMathCoreInScope,
} from '../omahaMathCore/OmahaMathCoreRule.js';
import {
  OMAHA_FACING_BET_EV_VARIANTS,
  omahaFacingBetEvSpot,
  omahaPlo6FacingBetEvFoldStands,
} from '../HorseOmahaFacingBetEv.js';
import {
  OMAHA_FLOP_FACING_BET_EV_VARIANTS,
  omahaFlopFacingBetEvAdmitsCall,
} from '../HorseOmahaFlopFacingBetEv.js';
import {
  OMAHA_FACING_EQUITY_VARIANTS,
  omahaFacingEquityAdmitsCall,
} from '../HorseOmahaFacingBetEquity.js';
import { omahaRiverCurrentNutsCallFloorAdmitsCall } from '../HorseOmahaRiverCurrentNutsCallFloor.js';
import { omahaFourBetFoldPricedCallAdmitsCall } from '../HorseOmahaFourBetFoldPricedCall.js';
import {
  OMAHA_MULTIWAY_DISCIPLINE_VARIANTS,
  omahaMultiwayWeakHandSpot,
  omahaRiverBluffIntoValueLeaderSpot,
} from '../HorseOmahaMultiwayDiscipline.js';
import {
  OMAHA_RAISE_NEEDS_NUTS_VARIANTS,
  omahaRaiseNeedsNutsAdmitsCall,
} from '../HorseOmahaTurnRiverRaiseNeedsNuts.js';
import {
  OMAHA_SLOWPLAY_VARIANTS,
  omahaSlowplayAdmitsCall,
  omahaSlowplayAdmitsCheckWithRequest,
} from '../HorseOmahaStrongHandSlowplayMix.js';
import { holdemFourBetSpot } from '../HorseHoldemPremiumAggression.js';
import { tournamentShoveDiscipline } from '../HorseTournamentShoveDiscipline.js';
import { plo6FacingBetPricedAdmitsCall } from '../HorsePlo6FacingBetIsPriced.js';
import {
  OMAHA_MW_TOURNEY_VARIANTS,
  omahaMwTourneyAdmits,
} from '../HorseOmahaMultiwayPricedInTournaments.js';
import {
  OMAHA_TOURNAMENT_SCOPE_ADMISSION,
  withOmahaTournamentScope,
} from '../HorseOmahaTournamentScope.js';
import {
  OMAHA_STRATEGY_GAME_SCOPE_ADMISSION,
  OMAHA_STRATEGY_PLO45,
  omahaStrategyConstant,
  omahaStrategyGameInScope,
  omahaStrategyGameScopeOf,
  withOmahaStrategyGameScope,
} from '../HorseOmahaStrategyGame.js';
import {
  applyPlo6OmahaStrategyCalibration,
  plo6OmahaStrategyCalibrationHeld,
} from '../HorsePlo6StrategyCalibration.js';
import { plo6RiverLiveFoldTest } from '../HorsePlo6PricingPort.js';
import { STYLE_SWITCH_POLL_MS } from '../HorseStyleSwitch.js';
import { optionSwitchDecisionOpts, parseOptionSwitchConfig } from '../HorseOptionSwitch.js';

const ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'all_in'] as const;
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: RecordValue, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function horseGovernorScaleIsValid(value: unknown): value is number {
  return nonnegative(value) && value > 0 && value <= 1;
}

/** Only finite, complete worker-owned readings may enter readiness or health.
 * A stale but well-formed reading stays explicitly stale; no replacement value
 * is inferred here. The governor itself continues to own load adaptation. */
export function horseGovernorSnapshotIsValid(value: unknown): value is GovernorSnapshot {
  return (
    record(value) &&
    exact(value, [
      'enabled',
      'scale',
      'p50Ms',
      'p99Ms',
      'sampledAt',
      'throttledForS',
      'stale',
      'timerLateMs',
    ]) &&
    typeof value.enabled === 'boolean' &&
    typeof value.stale === 'boolean' &&
    horseGovernorScaleIsValid(value.scale) &&
    ['p50Ms', 'p99Ms', 'sampledAt', 'throttledForS', 'timerLateMs'].every((key) =>
      nonnegative(value[key])
    )
  );
}

export function horseSamplingStateIsValid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

export function horseComputeMetadataIsValid(value: {
  computeMs: unknown;
  governorScale: unknown;
}): boolean {
  return nonnegative(value.computeMs) && horseGovernorScaleIsValid(value.governorScale);
}
function action(value: unknown): value is HorsePolicyAction {
  return (
    record(value) &&
    exact(value, ['action', 'amount']) &&
    ACTIONS.includes(value.action as (typeof ACTIONS)[number]) &&
    (value.amount === null || nonnegative(value.amount))
  );
}
function same(a: HorsePolicyAction, b: HorsePolicyAction): boolean {
  return a.action === b.action && a.amount === b.amount;
}

/** Legacy receipts can be read without being promoted to input provenance.
 * New evidence-bearing receipts must be bounded and internally consistent
 * before their immutable copy enters the execution witness. This validates
 * structure and reconciliation; it does not establish response calibration. */
export function horseTournamentUtilityReceiptIsValid(
  value: unknown,
  decision: Pick<HorseDecision, 'action' | 'amount'>
): value is HorseTournamentUtilityLedger {
  if (!record(value)) return false;
  if (value.evidence === undefined) return true;
  const nullableAmount = (n: unknown) => n === null || nonnegative(n);
  const uint = (n: unknown) => nonnegative(n) && Number.isSafeInteger(n);
  const probability = (n: unknown) => nonnegative(n) && n <= 1;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const actions = (n: unknown) => ACTIONS.includes(n as (typeof ACTIONS)[number]);
  const ids = (n: unknown): n is string[] =>
    Array.isArray(n) &&
    n.length <= 9 &&
    new Set(n).size === n.length &&
    n.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256);
  if (
    !exact(value, [
      'schemaVersion',
      'model',
      'outcomeModel',
      'objective',
      'utilityUnit',
      'chipEvUnit',
      'baselineAction',
      'baselineAmount',
      'selectedAction',
      'selectedAmount',
      'executedAction',
      'executedAmount',
      'executionStatus',
      'overrodeBaseline',
      'baselineRetainedForUncertainty',
      'baselineRetainedForContinuation',
      'sidePotCount',
      'playersBehind',
      'coveringPlayers',
      'conditionedOpponentRanges',
      'equitySampleSize',
      'utilityOutcomeSamples',
      'equityStandardError',
      'equityCalibrationError',
      'effectiveOutcomeSamples',
      'fieldPlayersActual',
      'fieldPlayersModeled',
      'fieldReconciliationErrorChips',
      'icmMethod',
      'icmErrorBound',
      'componentReconciliationError',
      'candidates',
      'evidence',
      ...(Object.hasOwn(value, 'readFrameSha256') ? ['readFrameSha256'] : []),
    ]) ||
    value.schemaVersion !== 1 ||
    !['horse-tournament-utility-phase7-round1', 'horse-tournament-utility-phase8-round1'].includes(
      value.model as string
    ) ||
    value.outcomeModel !==
      (value.model === 'horse-tournament-utility-phase7-round1'
        ? 'conditioned_showdown_samples'
        : 'conditioned_public_street_continuation') ||
    ![
      'mtt_payout',
      'satellite_seat_equity',
      'pko',
      'mystery_bounty',
      'sng',
      'spin_chip_ev',
      'spin_payout',
    ].includes(value.objective as string) ||
    value.utilityUnit !== 'total_funded_pool_pct' ||
    value.chipEvUnit !== 'tournament_chips' ||
    !actions(value.baselineAction) ||
    !nullableAmount(value.baselineAmount) ||
    value.selectedAction !== decision.action ||
    value.selectedAmount !== (decision.amount ?? null) ||
    !actions(value.selectedAction) ||
    !nullableAmount(value.selectedAmount) ||
    (value.executedAction !== null && !actions(value.executedAction)) ||
    !nullableAmount(value.executedAmount) ||
    !['pending', 'intended', 'coerced', 'fallback', 'not_executed'].includes(
      value.executionStatus as string
    ) ||
    ![
      'overrodeBaseline',
      'baselineRetainedForUncertainty',
      'baselineRetainedForContinuation',
    ].every((key) => typeof value[key] === 'boolean') ||
    !ids(value.playersBehind) ||
    !ids(value.coveringPlayers) ||
    ![
      'sidePotCount',
      'conditionedOpponentRanges',
      'equitySampleSize',
      'utilityOutcomeSamples',
      'fieldPlayersActual',
      'fieldPlayersModeled',
    ].every((key) => uint(value[key])) ||
    ![
      'equityStandardError',
      'equityCalibrationError',
      'effectiveOutcomeSamples',
      'fieldReconciliationErrorChips',
      'icmErrorBound',
      'componentReconciliationError',
    ].every((key) => nonnegative(value[key])) ||
    !['exact_mh', 'plackett_luce_mc'].includes(value.icmMethod as string) ||
    !horseTournamentUtilityEvidenceIsValid(value.evidence) ||
    (Object.hasOwn(value, 'readFrameSha256') &&
      value.readFrameSha256 !== null &&
      (typeof value.readFrameSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.readFrameSha256))) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length < 1 ||
    value.candidates.length > 16
  )
    return false;
  const opponentIds = new Set(value.evidence.opponents.map((row) => row.userId));
  if (
    (value.evidence.sampler !== undefined &&
      (value.evidence.sampler.completedSamples !== value.utilityOutcomeSamples ||
        value.evidence.sampler.completedSamples !== value.equitySampleSize)) ||
    (value.conditionedOpponentRanges as number) !==
      value.evidence.opponents.filter((row) => row.range !== null).length ||
    (value.playersBehind as string[]).some((id) => !opponentIds.has(id)) ||
    (value.coveringPlayers as string[]).some((id) => !opponentIds.has(id)) ||
    (value.playersBehind as string[]).length !==
      value.evidence.opponents.filter((row) => row.actsAfterHero).length ||
    value.evidence.opponents.some(
      (row) => row.actsAfterHero && !(value.playersBehind as string[]).includes(row.userId)
    ) ||
    value.fieldPlayersActual !== value.fieldPlayersModeled ||
    (value.fieldPlayersActual as number) < 2 ||
    (value.utilityOutcomeSamples as number) < 1 ||
    (value.utilityOutcomeSamples as number) > MAX_UTILITY_OUTCOMES ||
    (value.effectiveOutcomeSamples as number) > (value.utilityOutcomeSamples as number) + 1e-9 ||
    (value.sidePotCount as number) > 10 ||
    (value.componentReconciliationError as number) > 0.005 ||
    ((value.executionStatus === 'pending' || value.executionStatus === 'not_executed') &&
      (value.executedAction !== null || value.executedAmount !== null)) ||
    (value.executionStatus === 'intended' &&
      (value.executedAction !== value.selectedAction ||
        value.executedAmount !== value.selectedAmount))
  )
    return false;
  const candidateIds = new Set<string>();
  let matchingSelected = 0;
  for (const candidate of value.candidates) {
    if (
      !record(candidate) ||
      !exact(candidate, [
        'id',
        'action',
        'amount',
        'investment',
        'chipEv',
        'payoutEv',
        'bountyEv',
        'optionEv',
        'combinedUtility',
        'utilityStandardError',
        'utilityConfidenceHalfWidth',
        'winProbability',
        'allFoldProbability',
        'bustProbability',
        'bountyWinProbability',
        'outcomeCount',
        'resultingStackVectors',
        'terminalForHero',
        'sidePotCount',
        'stackConservationError',
        ...(Object.hasOwn(candidate, 'continuation') ? ['continuation'] : []),
      ]) ||
      typeof candidate.id !== 'string' ||
      candidate.id.length < 1 ||
      candidate.id.length > 64 ||
      candidateIds.has(candidate.id) ||
      !actions(candidate.action) ||
      !nullableAmount(candidate.amount) ||
      (['bet', 'raise'].includes(candidate.action as string)
        ? !nonnegative(candidate.amount)
        : candidate.amount !== null) ||
      ![
        'investment',
        'payoutEv',
        'utilityStandardError',
        'utilityConfidenceHalfWidth',
        'stackConservationError',
      ].every((key) => nonnegative(candidate[key])) ||
      !['chipEv', 'bountyEv', 'optionEv', 'combinedUtility'].every((key) =>
        finite(candidate[key])
      ) ||
      !['winProbability', 'allFoldProbability', 'bustProbability', 'bountyWinProbability'].every(
        (key) => probability(candidate[key])
      ) ||
      !['outcomeCount', 'resultingStackVectors', 'sidePotCount'].every((key) =>
        uint(candidate[key])
      ) ||
      typeof candidate.terminalForHero !== 'boolean' ||
      candidate.outcomeCount !== value.utilityOutcomeSamples ||
      (candidate.resultingStackVectors as number) > (candidate.outcomeCount as number) ||
      (candidate.sidePotCount as number) > (value.sidePotCount as number) ||
      (candidate.stackConservationError as number) > 0.005 ||
      Math.abs(
        (candidate.combinedUtility as number) -
          ((candidate.payoutEv as number) +
            (candidate.bountyEv as number) +
            (candidate.optionEv as number))
      ) > 1e-7
    )
      return false;
    candidateIds.add(candidate.id);
    const selectedAmount = candidate.action === 'call' ? candidate.investment : candidate.amount;
    if (candidate.action === decision.action && selectedAmount === (decision.amount ?? null))
      matchingSelected++;
    if (candidate.continuation !== undefined) {
      const c = candidate.continuation;
      if (
        !record(c) ||
        !exact(c, [
          'shortStackCollisionProbability',
          'expectedRetainedStackBb',
          'expectedCoveredStacks',
          'noFullBlindRaiseProbability',
          ...['futureHands', 'futureForcedPaid', 'futureLevelUtilityEnvelope'].filter((key) =>
            Object.hasOwn(c, key)
          ),
        ]) ||
        !probability(c.shortStackCollisionProbability) ||
        !probability(c.noFullBlindRaiseProbability) ||
        !nonnegative(c.expectedRetainedStackBb) ||
        !nonnegative(c.expectedCoveredStacks) ||
        ['futureHands', 'futureForcedPaid', 'futureLevelUtilityEnvelope'].some(
          (key) => Object.hasOwn(c, key) && !nonnegative(c[key])
        )
      )
        return false;
    }
  }
  return matchingSelected === 1;
}

export type HorsePhase7EvidenceMismatch =
  | 'phase7_foreign_opponent'
  | 'phase7_marginal_multi_board'
  | 'phase7_sampler_single_board'
  | 'phase7_sampler_board_count'
  | 'phase7_sampler_state';

/** Request binding for an evidence-bearing Phase 7 receipt. The structural
 * validator above cannot see the request, so a well-formed sampler for another
 * state or board layout, or a multi-board receipt with no physical joint
 * acquisition (marginal draws), was admissible. Recompute each binding from the
 * request the worker actually received and return the first named mismatch.
 * Legacy receipts without evidence keep no new authority and are not refused. */
export function horsePhase7EvidenceMismatch(
  decision: Pick<HorseDecision, 'tournamentUtility'>,
  request: { player: SeatPlayer; gameState: HorseGameStateV2 }
): HorsePhase7EvidenceMismatch | null {
  const evidence = decision.tournamentUtility?.evidence;
  if (!evidence) return null;
  const state = request.gameState;
  const hero = request.player;
  const opponents = new Set(
    (Array.isArray(state?.players) ? state.players : [])
      .filter((player) => player.user_id !== hero?.user_id)
      .map((player) => player.user_id)
  );
  if (evidence.opponents.some((row) => !opponents.has(row.userId)))
    return 'phase7_foreign_opponent';
  // Same multi-board test as the ordinary Phase 7 caller in HorseLogic.
  const boardCount = state.boardCount ?? 1;
  const multiBoard =
    (state.communityCards2?.length ?? 0) > 0 ||
    (state.communityCards3?.length ?? 0) > 0 ||
    boardCount > 1;
  const sampler = evidence.sampler;
  if (!sampler) return multiBoard ? 'phase7_marginal_multi_board' : null;
  if (!multiBoard) return 'phase7_sampler_single_board';
  if (sampler.boardCount !== boardCount) return 'phase7_sampler_board_count';
  try {
    if (sampler.stateKey !== jointStateKey(hero, state)) return 'phase7_sampler_state';
  } catch {
    return 'phase7_sampler_state';
  }
  return null;
}

/** Bounded structured-clone validation before witness construction. A graph
 * may be absent on legacy or caught-failure decisions; absence is not proof
 * of graph execution. A supplied graph must be complete, continuous and
 * action-only, and its final action must match the returned decision. */
/**
 * The Phase 8 receipt as the worker returns it. A changed action is legitimate
 * only as an authority-backed selection: candidate mode, a usable worker
 * authority receipt for the running continuation, and the final action equal
 * to the ledger's candidate. Acceptance-time fields stay unset in the worker.
 */
/** Distinct guard family; never admits a continuation receipt or unqualified candidate. */
export function horsePhase8GuardLedgerIsValid(value: unknown, decision: RecordValue): boolean {
  if (value === undefined) return true;
  if (
    !record(value) ||
    !exact(value, [
      'version',
      'policyFamily',
      'workKind',
      'mode',
      'eligible',
      'fired',
      'completed',
      'changed',
      'applied',
      'selection',
      'authority',
      'authorityVerdict',
      'reason',
      'reasons',
      'baselineAction',
      'baselineAmount',
      'candidateAction',
      'candidateAmount',
      'objective',
      'confidence',
      'futureGame',
      'baselineFutureGame',
      'guardPolicy',
      'guardWork',
      'baselineCriticalCommitment',
      'candidateCriticalCommitment',
      'before',
      'after',
      'latencyMs',
      'simulationMs',
      'policyMs',
      'work',
      'executionStatus',
      'executedAction',
      'executedAmount',
      ...('selectionRefusal' in value ? ['selectionRefusal'] : []),
    ])
  )
    return false;
  if (
    !record(value.guardPolicy) ||
    !exact(value.guardPolicy, ['version', 'maxCandidates', 'deepStackBB', 'deepCommitFraction']) ||
    !record(value.guardWork) ||
    !exact(value.guardWork, ['assessmentCompleted', 'candidateCount']) ||
    !record(value.work) ||
    !exact(value.work, [
      'attempts',
      'candidateCount',
      'candidatesCompleted',
      'outcomeSamples',
      'samplesVisited',
      'rollouts',
      'rolloutCacheHits',
      'estimates',
      'estimateCacheHits',
      'icmMethod',
      'levelBounds',
      'budgetStop',
    ]) ||
    ![
      'not_postflop',
      'unsupported_variant',
      'context_incomplete',
      'multiple_boards',
      'private_state_rejected',
      'utility_unavailable',
      'phase7_choice_retained',
      'candidate_budget',
      'baseline_not_legal',
      'baseline_not_modeled',
      'guard_baseline_retained',
      'guard_safe_candidate_unavailable',
      'guard_candidate_changed',
    ].includes(String(value.reason)) ||
    !Array.isArray(value.reasons) ||
    value.reasons.some((r) => r !== 'deep_one_pair_commitment') ||
    typeof value.baselineCriticalCommitment !== 'boolean' ||
    typeof value.candidateCriticalCommitment !== 'boolean' ||
    !ACTIONS.includes(value.baselineAction as never) ||
    !ACTIONS.includes(value.candidateAction as never) ||
    !(value.baselineAmount === null || nonnegative(value.baselineAmount)) ||
    !(value.candidateAmount === null || nonnegative(value.candidateAmount))
  )
    return false;
  if (
    !record(value) ||
    value.version !== CATASTROPHE_GUARD_VERSION ||
    value.policyFamily !== 'catastrophe_guard_v1' ||
    value.workKind !== 'phase7_candidate_guard' ||
    !['shadow', 'candidate'].includes(String(value.mode)) ||
    typeof value.eligible !== 'boolean' ||
    value.fired !== value.eligible ||
    value.completed !== value.eligible ||
    typeof value.changed !== 'boolean' ||
    typeof value.applied !== 'boolean' ||
    value.authorityVerdict !== null ||
    value.futureGame !== null ||
    value.baselineFutureGame !== null ||
    value.simulationMs !== 0 ||
    !record(value.guardPolicy) ||
    value.guardPolicy.version !== CATASTROPHE_GUARD_VERSION ||
    value.guardPolicy.maxCandidates !== 16 ||
    value.guardPolicy.deepStackBB !== PHASE8_POLICY.deepStackBB ||
    value.guardPolicy.deepCommitFraction !== PHASE8_POLICY.deepCommitFraction ||
    !record(value.guardWork) ||
    value.guardWork.assessmentCompleted !== value.completed ||
    !Number.isSafeInteger(value.guardWork.candidateCount) ||
    Number(value.guardWork.candidateCount) < 0 ||
    Number(value.guardWork.candidateCount) > 16 ||
    (value.completed === true && Number(value.guardWork.candidateCount) < 1) ||
    !record(value.work) ||
    Object.entries(value.work).some(([key, v]) =>
      key === 'icmMethod' ? v !== 'unavailable' : key === 'budgetStop' ? v !== 'none' : v !== 0
    ) ||
    !Array.isArray(value.before) ||
    value.before.length > 16 ||
    !Array.isArray(value.after) ||
    value.after.length > 16 ||
    !nonnegative(value.latencyMs) ||
    !nonnegative(value.policyMs) ||
    !['none', 'shadow_change', 'selected'].includes(String(value.selection)) ||
    (value.selectionRefusal !== undefined &&
      !['downstream_owner', 'illegal_candidate'].includes(String(value.selectionRefusal)))
  )
    return false;
  const authority = value.authority;
  if (
    authority !== null &&
    (!horseAuthorityReceiptIsWellFormed(authority) ||
      authority.continuationVersion !== CATASTROPHE_GUARD_VERSION)
  )
    return false;
  if (value.mode === 'candidate' && (!record(authority) || authority.state !== 'usable'))
    return false;
  if (!value.applied) return value.selection !== 'selected';
  return (
    value.mode === 'candidate' &&
    value.changed === true &&
    value.completed === true &&
    value.selection === 'selected' &&
    ['check', 'fold'].includes(String(value.candidateAction)) &&
    value.candidateAmount === null &&
    decision.action === value.candidateAction &&
    (decision.amount ?? null) === null
  );
}

export function horsePhase8LedgerIsValid(value: unknown, decision: RecordValue): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  const wager = (action: unknown) => action === 'bet' || action === 'raise';
  const authority = value.authority;
  const authorityState = record(authority) ? authority.state : undefined;
  const authorityVersion = record(authority) ? authority.continuationVersion : undefined;
  if (
    value.version !== PHASE8_POLICY.version ||
    !['shadow', 'candidate'].includes(value.mode as string) ||
    typeof value.applied !== 'boolean' ||
    typeof value.changed !== 'boolean' ||
    !['none', 'shadow_change', 'selected'].includes(value.selection as string) ||
    value.authorityVerdict !== null ||
    (authority !== null && !horseAuthorityReceiptIsWellFormed(authority)) ||
    (authority !== null && authorityVersion !== PHASE8_POLICY.version)
  )
    return false;
  if (value.mode === 'candidate' && authorityState !== 'usable') return false;
  if (!value.applied) return value.selection !== 'selected';
  return (
    value.mode === 'candidate' &&
    value.changed === true &&
    value.selection === 'selected' &&
    decision.action === value.candidateAction &&
    (!wager(decision.action) || (decision.amount ?? null) === value.candidateAmount)
  );
}

/**
 * P10.3: the PLO4 receipt's selection as the worker returns it. A changed
 * action is legitimate only as an authority-backed cash selection: candidate
 * mode, a usable worker Phase 10 authority receipt for the running pack
 * version, cash utility ownership (never a tournament objective decision) and
 * the final action equal to the proposal. Acceptance-time fields stay unset.
 * A receipt retained before P10.3 carries no selection and claims no
 * authority, so it may not carry an applied candidate either.
 * `verifiedGraph` must already have passed the full validator: see
 * `variantSelectionWasSuperseded`.
 */
export function horsePhase10SelectionIsValid(
  value: unknown,
  decision: RecordValue,
  verifiedGraph?: HorsePolicyGraphReceipt
): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  const wager = (action: unknown) => action === 'bet' || action === 'raise';
  if (!Object.hasOwn(value, 'selection'))
    return (
      value.applied !== true &&
      !Object.hasOwn(value, 'authority') &&
      !Object.hasOwn(value, 'authorityVerdict')
    );
  const authority = value.authority;
  if (
    !['none', 'shadow_change', 'selected'].includes(value.selection as string) ||
    typeof value.applied !== 'boolean' ||
    typeof value.changed !== 'boolean' ||
    !['shadow', 'candidate'].includes(value.mode as string) ||
    (value.authorityVerdict !== undefined && value.authorityVerdict !== null) ||
    (value.selectionRefusal !== undefined &&
      value.selectionRefusal !== null &&
      value.selectionRefusal !== 'illegal_candidate') ||
    (authority !== undefined &&
      authority !== null &&
      (!horseAuthorityReceiptIsWellFormed(authority) ||
        authority.continuationVersion !== PLO4_POLICY_PACK.version))
  )
    return false;
  if (value.mode === 'candidate' && (!record(authority) || authority.state !== 'usable'))
    return false;
  if (!value.applied) return value.selection !== 'selected';
  return (
    value.mode === 'candidate' &&
    value.changed === true &&
    value.utilityOwner === 'cash' &&
    decision.action === value.proposalAction &&
    (!wager(decision.action) || (decision.amount ?? null) === value.proposalAmount) &&
    ((value.selection === 'selected' &&
      decision.action === value.finalAction &&
      (!wager(decision.action) || (decision.amount ?? null) === value.finalAmount)) ||
      variantSelectionWasSuperseded(value, verifiedGraph))
  );
}

/**
 * PRECONDITION: `verifiedGraph` has already passed `policyGraphIsValid` inside
 * `horseDecisionReceiptRefusal` (node order, contiguity, recomputed changed
 * flags, final action bound to the executed action). This helper and the
 * exported selection checks that call it do not validate the graph and are
 * not a receipt judgment on their own.
 */
function variantSelectionWasSuperseded(
  value: RecordValue,
  verifiedGraph: HorsePolicyGraphReceipt | undefined
): boolean {
  if (!record(value) || value.selection !== 'shadow_change' || !verifiedGraph) return false;
  const variant = verifiedGraph.transitions.find((t) => t.node === 'variant_policy');
  if (
    !variant?.before ||
    variant.changed !== true ||
    variant.before.action !== value.baselineAction ||
    variant.before.amount !== value.baselineAmount ||
    variant.after.action !== value.proposalAction ||
    variant.after.amount !== value.proposalAmount ||
    verifiedGraph.finalAction.action !== value.finalAction ||
    verifiedGraph.finalAction.amount !== value.finalAmount
  ) {
    return false;
  }
  // The proposal must reach the final rule exactly as the variant stage left
  // it, amount included. A call or check carries no sizing choice, so the
  // caller compares its amount only for a bet or raise; without this an
  // intermediate stage could rewrite a call's recorded price between the
  // variant stage and the final rule and the selection would still be credited.
  const finalRuleInput = (
    verifiedGraph.transitions.find((t) => t.node === 'corrective_policy') ??
    verifiedGraph.transitions.find((t) => t.node === 'wager_rules')
  )?.before;
  if (
    !finalRuleInput ||
    finalRuleInput.action !== variant.after.action ||
    finalRuleInput.amount !== variant.after.amount
  )
    return false;
  return verifiedGraph.transitions.some(
    ({ node, changed, before, after }) =>
      (node === 'corrective_policy' || node === 'wager_rules') &&
      changed === true &&
      before !== null &&
      (before.action !== after.action || before.amount !== after.amount)
  );
}

/**
 * P11.3: a PLO5/PLO6/PLO8 receipt's selection as the worker returns it, by
 * the P10.3 law. A changed action is legitimate only as an authority-backed
 * cash selection: candidate mode, a usable worker authority receipt for the
 * running version of the receipt's own pack (a PLO5 authority never backs a
 * PLO6 receipt), cash utility ownership (never a tournament objective
 * decision) and the final action equal to the proposal. Acceptance-time fields
 * stay unset. A receipt retained before P11.3 carries no selection and claims
 * no authority, so it may not carry an applied candidate either.
 * `verifiedGraph` must already have passed the full validator: see
 * `variantSelectionWasSuperseded`.
 */
export function horsePhase11SelectionIsValid(
  value: unknown,
  decision: RecordValue,
  verifiedGraph?: HorsePolicyGraphReceipt
): boolean {
  return packSelectionIsValid(
    value,
    decision,
    (variant) => (isOmahaPolicyVariant(variant) ? OMAHA_VARIANT_PACKS[variant].version : null),
    {
      superseded:
        record(value) &&
        isOmahaPolicyVariant(value.variant) &&
        variantSelectionWasSuperseded(value, verifiedGraph),
    }
  );
}

/**
 * P12.3: a Short Deck, Crazy Pineapple, FLH or FLO8 receipt's selection as the
 * worker returns it, by the same law: a changed action only as an
 * authority-backed cash selection under usable worker authority for the
 * running version of the receipt's own pack (a Short Deck authority never
 * backs a Pineapple receipt, and no Phase 11 authority backs any), with the
 * final action equal to the proposal; acceptance-time fields unset; a
 * retained receipt claims nothing.
 * `verifiedGraph` must already have passed the full validator: see
 * `variantSelectionWasSuperseded`.
 */
export function horsePhase12SelectionIsValid(
  value: unknown,
  decision: RecordValue,
  verifiedGraph?: HorsePolicyGraphReceipt
): boolean {
  return packSelectionIsValid(
    value,
    decision,
    (variant) =>
      isRemainingPolicyVariant(variant) ? REMAINING_VARIANT_PACKS[variant].version : null,
    {
      superseded:
        record(value) &&
        isRemainingPolicyVariant(value.variant) &&
        variantSelectionWasSuperseded(value, verifiedGraph),
    }
  );
}

/**
 * P13.3: a joint receipt's selection as the worker returns it, by the same
 * law: a changed action only as an authority-backed cash selection under
 * usable worker Phase 13 authority for the receipt's own variant (an NLH
 * authority never backs a PLO4 receipt, and no Phase 10, 11 or 12 authority
 * backs any), at the running joint domain version, with the proposal either
 * retained or superseded by a later owner in the verified policy graph.
 * Acceptance-time fields unset; the two named selection
 * refusals only on an unapplied receipt; and never an applied joint candidate
 * on top of an applied Phase 10/11/12 candidate (`earlier_phase_applied`). A
 * P13.1 receipt (a selection refusal, no selection) claims no authority and
 * may not carry an applied candidate either.
 */
export function horsePhase13SelectionIsValid(
  value: unknown,
  decision: RecordValue,
  verifiedGraph?: HorsePolicyGraphReceipt
): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  if (!Object.hasOwn(value, 'selection'))
    return (
      value.applied !== true &&
      !Object.hasOwn(value, 'authority') &&
      !Object.hasOwn(value, 'authorityVerdict')
    );
  if (
    !packSelectionIsValid(
      value,
      decision,
      (variant) => (isJointVariant(variant) ? JOINT_LIVE_DOMAIN.version : null),
      {
        authorityVersionOf: (variant) =>
          isJointVariant(variant) ? horsePhase13ContinuationVersion(variant) : null,
        refusals: ['illegal_candidate', 'earlier_phase_applied'],
        superseded: jointSelectionWasSuperseded(value, verifiedGraph),
      }
    )
  )
    return false;
  // Chip cash only (audit 2026-10-06): no Phase 13 qualified domain covers a
  // Diamond decision, so the worker never runs one as candidate, and an
  // applied candidate must carry its bound chip objective.
  const inputs = value.inputs;
  const objective = record(inputs) && record(inputs.objective) ? inputs.objective : null;
  if (value.mode === 'candidate' && objective !== null && objective.asset !== 'chips') return false;
  if (value.applied === true && objective?.asset !== 'chips') return false;
  return (
    value.applied !== true ||
    // A named refusal means the candidate did not act (the P13.1 binding check
    // refuses the same pair; this validator holds it on its own as well).
    ((value.selectionRefusal === undefined || value.selectionRefusal === null) &&
      ![decision.plo4Policy, decision.omahaVariantPolicy, decision.remainingVariantPolicy].some(
        (prior) => record(prior) && prior.applied === true
      ))
  );
}

/** Only the boundary which has checked the whole graph may supply this witness. */
function jointSelectionWasSuperseded(
  receipt: RecordValue,
  graph: HorsePolicyGraphReceipt | undefined
): boolean {
  if (receipt.selection !== 'shadow_change' || !graph) return false;
  const joint = graph.transitions.find((transition) => transition.node === 'joint_policy');
  if (
    !joint?.before ||
    !joint.changed ||
    joint.before.action !== receipt.baselineAction ||
    joint.before.amount !== receipt.baselineAmount ||
    joint.after.action !== receipt.proposalAction ||
    joint.after.amount !== receipt.proposalAmount ||
    graph.finalAction.action !== receipt.finalAction ||
    graph.finalAction.amount !== receipt.finalAmount
  )
    return false;

  return graph.transitions.some(
    ({ node, before, after }) =>
      (node === 'corrective_policy' || node === 'wager_rules') &&
      before !== null &&
      (before.action !== after.action ||
        ((after.action === 'bet' || after.action === 'raise') && before.amount !== after.amount))
  );
}

function packSelectionIsValid(
  value: unknown,
  decision: RecordValue,
  packVersionOf: (variant: unknown) => string | null,
  options: {
    /** The authority continuation the receipt's holder runs (default: the pack version). */
    authorityVersionOf?: (variant: unknown) => string | null;
    /** The named selection refusals an unapplied receipt may carry. */
    refusals?: readonly string[];
    /** A verified later owner replaced the applied selection. */
    superseded?: boolean;
  } = {}
): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  const wager = (action: unknown) => action === 'bet' || action === 'raise';
  if (!Object.hasOwn(value, 'selection'))
    return (
      value.applied !== true &&
      !Object.hasOwn(value, 'authority') &&
      !Object.hasOwn(value, 'authorityVerdict') &&
      !Object.hasOwn(value, 'selectionRefusal')
    );
  const packVersion = packVersionOf(value.variant);
  const authorityVersion = (options.authorityVersionOf ?? packVersionOf)(value.variant);
  const refusals = options.refusals ?? ['illegal_candidate'];
  const authority = value.authority;
  if (
    // Audit 2026-10-05: every receipt that carries a selection is newer than
    // its phase's input binding (P11.1, P12.1), so it carries the binding
    // field (null when nothing was bound); a selection without it is forged.
    !Object.hasOwn(value, 'inputs') ||
    packVersion === null ||
    value.version !== packVersion ||
    !['none', 'shadow_change', 'selected'].includes(value.selection as string) ||
    typeof value.applied !== 'boolean' ||
    typeof value.changed !== 'boolean' ||
    !['shadow', 'candidate'].includes(value.mode as string) ||
    (value.authorityVerdict !== undefined && value.authorityVerdict !== null) ||
    (value.selectionRefusal !== undefined &&
      value.selectionRefusal !== null &&
      !refusals.includes(value.selectionRefusal as string)) ||
    (authority !== undefined &&
      authority !== null &&
      (!horseAuthorityReceiptIsWellFormed(authority) ||
        authority.continuationVersion !== authorityVersion))
  )
    return false;
  if (value.mode === 'candidate' && (!record(authority) || authority.state !== 'usable'))
    return false;
  if (!value.applied) return value.selection !== 'selected';
  return (
    value.mode === 'candidate' &&
    value.changed === true &&
    value.utilityOwner === 'cash' &&
    decision.action === value.proposalAction &&
    (!wager(decision.action) || (decision.amount ?? null) === value.proposalAmount) &&
    (options.superseded === true ||
      (value.selection === 'selected' &&
        decision.action === value.finalAction &&
        (!wager(decision.action) || (decision.amount ?? null) === value.finalAmount)))
  );
}

/** Phase 7 owns the action Phase 8 received; an applied candidate replaces it. */
function phase7Selection(value: RecordValue): Pick<HorseDecision, 'action' | 'amount'> {
  const guard = value.tournamentCatastropheGuard;
  if (record(guard) && guard.changed === true)
    return {
      action: guard.baselineAction as HorseDecision['action'],
      amount: (guard.baselineAmount as number | null) ?? undefined,
    };
  const phase8 = value.tournamentPostflop;
  if (record(phase8) && phase8.applied === true)
    return {
      action: phase8.baselineAction as HorseDecision['action'],
      amount: (phase8.baselineAmount as number | null) ?? undefined,
    };
  return value as unknown as Pick<HorseDecision, 'action' | 'amount'>;
}

/** The decision's own request, when the caller has it. */
export interface HorseDecisionReceiptContext {
  player: SeatPlayer;
  gameState: HorseGameStateV2;
  /**
   * PLO6 lane 2026-11-16: the decision's own omahaStrategyInPlo6 gate, read
   * `=== true`. Only then is PLO6 admitted to the day's PLO4/PLO5 Omaha
   * strategy admissions (each still re-run on the request), with the
   * six-card constants in the accessor for the re-run. Absent or false (every
   * caller that does not know the decision's options, and every decision
   * today: the option is off-only), the validator is exactly as before.
   */
  omahaStrategyInPlo6?: boolean;
  /**
   * Owner 2026-11-17 11:49 (HorseOmahaPricedWiring): the decision's own
   * omahaTurnRiverRaiseIsPriced or omahaBigBetCallsArePriced, read
   * `=== true`. Only then is a PLO4/PLO5 cash turn or river raise that became
   * the call (the priced comparison put the raise below it) admitted.
   * Absent or false (every caller that does not know the decision's options,
   * and every decision while both options are off), the validator is exactly
   * as before.
   */
  omahaPricedRaise?: boolean;
  /**
   * omahaMathCore (lane MATHCORE 2026-11-19): true when the worker may have run
   * this decision with omahaMathCore on (the request's option, or the switch
   * row last delivered, or the one before it while it still counts). Absent
   * or false, the validator is exactly as before.
   */
  omahaMathCore?: boolean;
  /**
   * PLO Strategy lane 2026-11-18: the decision's own omahaPricedInLightning, read `=== true`. Only then is the
   * priced raise -> call above admitted in a Lightning pool (the priced scope includes Lightning only under that
   * option). Absent or false, the validator is exactly as before.
   */
  omahaPricedInLightning?: boolean;
  /**
   * HORSE DECISIONS lane 2026-11-19: the decision's own omahaBluffIsPricedAgainstTheTarget, read `=== true`.
   * Only then are its two conversions admitted (a heads-up wager facing no bet -> the check; a flop or turn
   * raise facing a bet -> the call, for the exact chips), in its own spot re-derived from the request. Absent
   * or false (every caller that does not know the decision's options, and every decision while the option is
   * off), the validator is exactly as before.
   */
  omahaBluffPricedAgainstTheTarget?: boolean;
  /**
   * PLO Strategy lane 2026-11-19: the decision's own omahaSlowplayMixInLightning, read `=== true`. Only then are
   * the two conversions of omahaStrongHandSlowplayMix (raise -> call, flop bet -> check) admitted in a Lightning
   * pool, in the mix's own spot as at a table (the mix's game includes Lightning only under that option). Absent
   * or false, the validator is exactly as before.
   */
  omahaSlowplayMixInLightning?: boolean;
  /**
   * HORSE DECISIONS lane 2026-11-19 (review N4): the decision's own plo6FacingBetIsPriced, read `=== true`.
   * Only then is its PLO6 fold -> call admitted (re-run on the request, for the exact chips of the call).
   * Absent or false, the validator is exactly as before that option existed.
   */
  plo6FacingBetIsPriced?: boolean;
  /**
   * HORSE DECISIONS lane 2026-11-19 (review N1): the decision's own omahaMultiwayIsPricedInTournaments, read
   * `=== true`. Only then are its two conversions admitted in Omaha pot-limit tournaments (PLO4/5/6/8): a
   * preflop call -> the fold and a postflop bet, raise or all-in facing no bet -> the check, each in the rule's
   * own spot re-derived from the request (omahaMwTourneyAdmits). Absent or false, the validator is exactly
   * as before.
   */
  omahaMultiwayPricedInTournaments?: boolean;
}

/** V58/V59 may cap a PLO6 river raise/jam at the call. When the original
 * request is available, bind that de-escalation to its single board, legal
 * call menu and exact additional-chip price. This does not re-run or relax
 * the owner's equity rule, and never admits a new wager or another game. */
function plo6RiverCallIsPriced(
  selected: HorsePolicyAction,
  context?: HorseDecisionReceiptContext
): boolean {
  if (selected.amount === null || selected.amount <= 0) return false;
  // Retained context-free receipts cannot establish input provenance; they
  // still have to carry the priced call and the PLO6 transition below.
  if (context === undefined) return true;
  const { player, gameState: gs } = context;
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (player.bet || 0));
  return (
    String(gs.gameVariant).toLowerCase() === 'plo6' &&
    gs.stage === 'river' &&
    gs.communityCards?.length === 5 &&
    (gs.boardCount ?? 1) === 1 &&
    player.cards?.length === 6 &&
    gs.legalActions?.includes('call') === true &&
    Number.isFinite(player.stack) &&
    toCall > 0.005 &&
    toCall < player.stack - 0.005 &&
    selected.amount === Math.round(toCall * 100) / 100
  );
}

// The boat owner may replace a fold or aggressive wager with a priced call.
// Recompute its exact output from the original worker request.
function boatRuleProducesCall(
  before: HorsePolicyAction,
  after: HorsePolicyAction,
  context: HorseDecisionReceiptContext
): boolean {
  const result = callLargeRiverBoatWager(
    { action: before.action, amount: before.amount ?? undefined, thinkTime: 0 },
    context.player,
    context.gameState
  );
  return result.action === 'call' && result.amount === after.amount;
}

// PLO Strategy lane 2026-11-15 (HorseOmahaRiverMediumBetCalls, option
// omahaRiverMediumBetStrongHandCalls): a PLO4/PLO5 cash river fold of two pair
// or better facing a 40 to 70 percent pot opening bet becomes the call when
// the price-based requirement is met. Re-run the pure rule on the original
// worker request; the value-leader read only withholds the call (keeps chips
// out), so the rule is re-run without it.
function mediumBetRuleProducesCall(
  after: HorsePolicyAction,
  context: HorseDecisionReceiptContext
): boolean {
  const result = omahaRiverMediumBetCall(
    { action: 'fold', thinkTime: 0 },
    context.player,
    context.gameState,
    true
  );
  return (
    result.changed === 'called' &&
    result.decision.action === 'call' &&
    result.decision.amount === after.amount
  );
}

// Dan 2026-11-14 (HorseOmahaRiverNutRaise): a PLO4/PLO5/PLO6 high river raise
// or jam over a wager without the nuts becomes a call of that wager.
// Recompute the rule's exact output from the original worker request.
function riverNutRuleProducesCall(
  before: HorsePolicyAction,
  after: HorsePolicyAction,
  context: HorseDecisionReceiptContext
): boolean {
  const start = { action: before.action, amount: before.amount ?? undefined, thinkTime: 0 };
  const river = omahaRiverNutRaiseOnly(start, context.player, context.gameState, true);
  // Dan 2026-11-14 (HorseOmahaMadeHandDefense rule 1): the turn half, a hand
  // a possible straight or flush beats. The two rules never share a street.
  const result =
    river.changed !== null
      ? river
      : omahaBeatenNoRaise(start, context.player, context.gameState, true);
  return (
    result.changed === 'flatted' &&
    result.decision.action === 'call' &&
    result.decision.amount === after.amount
  );
}

// Dan 2026-11-14 (HorseOmahaOnePair, option omahaOnePairDiscipline): a
// PLO4/PLO5 one-pair river value bet becomes a check, and a one-pair raise
// becomes a call. Re-run the rule on the original worker request; the
// declared-bluff and over-bluffer exceptions only keep chips in, so the rule
// is re-run without them (no bluff declared, every bettor read as an
// over-bluffer, which leaves the river call standing).
function onePairRuleProduces(
  before: HorsePolicyAction,
  after: HorsePolicyAction,
  context: HorseDecisionReceiptContext
): boolean {
  const start = { action: before.action, amount: before.amount ?? undefined, thinkTime: 0 };
  const result = omahaOnePairDiscipline(start, context.player, context.gameState, true, {
    declaredBluff: false,
    bettorOverBluffs: () => true,
  });
  if (result.changed === null) return false;
  if (after.action === 'check')
    return result.changed === 'river_value_bet_checked' && result.decision.action === 'check';
  return (
    (result.changed === 'river_value_raise_flatted' ||
      result.changed === 'one_pair_raise_flatted') &&
    result.decision.action === 'call' &&
    result.decision.amount === after.amount
  );
}

/**
 * omahaStrategyInTournaments: the request carries neither the options nor the
 * ICM inputs, so the admissions below re-run the day's Omaha spots with their
 * public tournament scope admitted and no survival premium
 * (OMAHA_TOURNAMENT_SCOPE_ADMISSION). The premium only removes chip-adding
 * answers, so this admits every answer the rules can produce; in cash and
 * outside the public scope every spot reads exactly as before.
 */
function policyGraphIsValid(
  value: RecordValue,
  expectedVariant?: string,
  context?: HorseDecisionReceiptContext
): boolean {
  // PLO6 joins the day's admissions only for a decision whose own gate was
  // on, known from the request (context.omahaStrategyInPlo6 === true). The
  // rules are then re-run with the six-card constants the decision read. In
  // both cases the accessor is set for this validation alone (gate off: no
  // six-card value, whatever an earlier decision or validation left) and what
  // it held before is put back afterwards (pre-review finding 6).
  const plo6Gate = context?.omahaStrategyInPlo6 === true;
  const heldBefore = plo6OmahaStrategyCalibrationHeld();
  applyPlo6OmahaStrategyCalibration(plo6Gate);
  try {
    return withOmahaStrategyGameScope(
      plo6Gate
        ? omahaStrategyGameScopeOf({ omahaStrategyInPlo6: true })
        : OMAHA_STRATEGY_GAME_SCOPE_ADMISSION,
      () =>
        withOmahaTournamentScope(OMAHA_TOURNAMENT_SCOPE_ADMISSION, () =>
          policyGraphIsValidInScope(value, expectedVariant, context)
        )
    );
  } finally {
    applyPlo6OmahaStrategyCalibration(heldBefore);
  }
}

function policyGraphIsValidInScope(
  value: RecordValue,
  expectedVariant?: string,
  context?: HorseDecisionReceiptContext
): boolean {
  if (value.policyGraph === undefined) return true;
  const graph = value.policyGraph;
  const order = record(graph) ? horsePolicyOrderForVersion(graph.version) : null;
  if (
    !record(graph) ||
    !exact(graph, ['version', 'transitions', 'finalAction']) ||
    order === null ||
    !Array.isArray(graph.transitions) ||
    graph.transitions.length !== order.length ||
    !action(graph.finalAction)
  )
    return false;
  let previous: HorsePolicyAction | null = null;
  for (let i = 0; i < order.length; i++) {
    const transition = graph.transitions[i];
    if (
      !record(transition) ||
      !exact(transition, ['node', 'before', 'after', 'changed', 'elapsedMs']) ||
      transition.node !== order[i] ||
      !action(transition.after) ||
      !nonnegative(transition.elapsedMs)
    )
      return false;
    if (
      previous === null
        ? transition.before !== null
        : !action(transition.before) || !same(previous, transition.before)
    )
      return false;
    const changed = previous !== null && !same(previous, transition.after);
    if (transition.changed !== changed || (transition.node === 'timing' && changed)) return false;
    // omahaMathCore (lane MATHCORE 2026-11-19, default OFF): the math-first
    // core is the outermost owner of wager_rules; its EV choice may be any
    // legal action. Admitted only under the option the worker may have run
    // (context.omahaMathCore), in the core's scope on the request, with the
    // decision's own applied core receipt naming exactly this action, and only
    // when the action is legal on the request.
    if (
      transition.node === 'wager_rules' &&
      changed &&
      omahaMathCoreAdmits(value, transition.after, expectedVariant, context)
    ) {
      previous = transition.after;
      continue;
    }
    // Wager rules add aggression or apply a named owner discipline. Two rules of
    // 2026-10-25 turn a call, raise or jam into a fold. The PLO4/5/6
    // paired-board fold (HorsePloPairedBoardFold) and the no-limit hold'em
    // dominated-hand fold to a big 3-bet (HorseHoldemPremiumAggression). A
    // fold is the one action that can never put a chip in, and it is
    // admitted only in those games. V81 (2026-11-02, HorseOmahaBigBetCalls)
    // folds PLO4/PLO5 big-bet calls in the same node and relies on this
    // same admission.
    const variant = String(expectedVariant ?? '').toLowerCase();
    const pairedBoardFold =
      transition.after.action === 'fold' &&
      // `previous` is the validated predecessor, equal to transition.before.
      previous !== null &&
      ['call', 'raise', 'all_in'].includes(previous.action) &&
      (PLO_PAIRED_BOARD_VARIANTS.has(variant) || variant === 'nlh');
    // The short all-in call floor (Dan 2026-10-26, HorseShortAllInCallFloor)
    // turns a fold into a call; its all-in form is already a wager action.
    // When the request is known, only in the spot that rule covers.
    const shortAllInCall =
      transition.after.action === 'call' &&
      previous !== null &&
      previous.action === 'fold' &&
      (context === undefined || shortAllInSpot(context.player, context.gameState) !== null);
    // Dan 2026-10-31 (HorseHoldemPremiumAggression rule 4): no hold'em 4-bet
    // is made to fold. A sized re-raise over a 3-bet with a hand below QQ+/AK
    // becomes a call, and a fold after the horse's own 4-bet was re-raised
    // becomes a call. When the request is known, only in those two spots.
    // The same node first runs the tournament shove discipline (Dan
    // 2026-10-25), which rewrites a deep or covering preflop jam into a sized
    // raise; rule 4 then makes that raise a call, so the node's one recorded
    // transition is jam -> call. That form is admitted only with the request,
    // only facing a 3-bet, and only when the shove discipline re-run on that
    // request really turns the jam into a raise (2026-11-05: 41 live refusals
    // on release 71087373, every one this chain).
    const fourBetSpot =
      context === undefined
        ? null
        : holdemFourBetSpot({
            gameVariant: context.gameState.gameVariant,
            bettingStructure: context.gameState.bettingStructure,
            stage: context.gameState.stage,
            hero: context.player,
            currentBet: context.gameState.currentBet,
            bigBlind: context.gameState.bigBlind,
            actionHistory: context.gameState.actionHistory,
          });
    const noFourBetFold =
      transition.node === 'wager_rules' &&
      variant === 'nlh' &&
      transition.after.action === 'call' &&
      previous !== null &&
      (previous.action === 'all_in'
        ? context !== undefined &&
          fourBetSpot === 'facing_three_bet' &&
          tournamentShoveDiscipline(
            { action: 'all_in', thinkTime: 0 },
            context.player,
            context.gameState
          ).action === 'raise'
        : (previous.action === 'fold' || previous.action === 'raise') &&
          (context === undefined ||
            fourBetSpot ===
              (previous.action === 'fold' ? 'reraised_four_bet' : 'facing_three_bet')));
    const plo6RiverRaiseToCall =
      transition.node === 'wager_rules' &&
      variant === 'plo6' &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['raise', 'all_in'].includes(previous.action) &&
      plo6RiverCallIsPriced(transition.after, context);
    // PLO6 lane 2026-11-15 (HorsePlo6MultiwayWeakBet, default-off option
    // plo6NoMultiwayBetWithWeakMadeHand): a PLO6 flop or turn bet facing no
    // wager against two or more live opponents with a weak made hand and no
    // qualifying draw becomes a check. A check puts no chip in; when the
    // request is known, only where the public spot, re-run on it, holds (the
    // spot reads neither the option nor an opponent).
    const plo6MultiwayWeakBetToCheck =
      transition.node === 'wager_rules' &&
      variant === 'plo6' &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'raise', 'all_in'].includes(previous.action) &&
      (context === undefined ||
        (String(context.gameState.gameVariant).toLowerCase() === variant &&
          plo6MultiwayWeakBetSpot(context.player, context.gameState) !== null));
    // Dan 2026-11-06 (HorsePloPairedBoardFold.ploPairedBoardRiverMustCheck):
    // a PLO4/5/6 river bet or raise without a full house, on a board paired
    // by the turn after the horse's own turn bet was called, becomes a check.
    // A check puts no chip in; when the request is known, only in that spot.
    const pairedBoardRiverCheck =
      transition.node === 'wager_rules' &&
      PLO_PAIRED_BOARD_VARIANTS.has(variant) &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'raise', 'all_in'].includes(previous.action) &&
      (context === undefined ||
        ploPairedBoardRiverMustCheck({
          gameVariant: context.gameState.gameVariant,
          hiLo: context.gameState.variantRules?.splitLow8OrBetter === true,
          multiBoard: !!(
            context.gameState.communityCards2?.length || context.gameState.communityCards3?.length
          ),
          board: context.gameState.communityCards ?? [],
          hero: context.player,
          toCall: context.gameState.toCall,
          actionHistory: context.gameState.actionHistory,
        }));
    // Like the boat rule below, it is admitted only with the request: the
    // rule is re-run on it and must make the same call.
    const omahaRiverNutRaiseToCall =
      transition.node === 'wager_rules' &&
      OMAHA_RIVER_NUT_RAISE_VARIANTS.has(variant) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      riverNutRuleProducesCall(previous, transition.after, context);
    // Dan 2026-11-14 (HorseOmahaMadeHandDefense rule 2): a bet with a hand a
    // possible straight or flush beats becomes a check on the fresh card out
    // of position, and on the river into an earlier street's bettor. A check
    // puts no chip in; when the request is known, only where the rule's own
    // test, re-run on it, says so (the paired-board river check's form).
    const omahaBeatenBetToCheck =
      transition.node === 'wager_rules' &&
      OMAHA_RIVER_NUT_RAISE_VARIANTS.has(variant) &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'raise', 'all_in'].includes(previous.action) &&
      (context === undefined ||
        (String(context.gameState.gameVariant).toLowerCase() === variant &&
          omahaBeatenMustCheck(context.player, context.gameState) !== null));
    // Dan 2026-11-14 (HorseOmahaOnePair): bet -> check and raise -> call,
    // admitted only with the request, where the rule re-run on it agrees.
    const omahaOnePairReduction =
      transition.node === 'wager_rules' &&
      (variant === 'plo4' || variant === 'plo5') &&
      (transition.after.action === 'check' || transition.after.action === 'call') &&
      previous !== null &&
      ['bet', 'raise', 'all_in'].includes(previous.action) &&
      // A check puts no chip in: without the request it is admitted like the
      // paired-board river check; a call needs the request.
      (context === undefined
        ? transition.after.action === 'check'
        : String(context.gameState.gameVariant).toLowerCase() === variant &&
          onePairRuleProduces(previous, transition.after, context));
    // HV31 FLOP-5 D1 (HorseHeadsUpPostflopBalance, option
    // holdemHeadsUpPostflopBalance, default OFF): a heads-up in-position NLH
    // cash bet becomes a check on a flop or turn checked to hero (its river
    // part was removed after the solver score). Admit it only with the
    // original request, where the rule's own public spot test agrees. A
    // request-less receipt cannot establish the heads-up cash scope.
    // Its flop fold to a check-raise that becomes a call is admitted only
    // with the request, in that spot (the short all-in call floor's form).
    const huBalanceSpotOfRequest =
      context === undefined ? null : huBalanceSpot(context.player, context.gameState);
    const huBalanceBetToCheck =
      transition.node === 'wager_rules' &&
      variant === 'nlh' &&
      transition.after.action === 'check' &&
      previous !== null &&
      previous.action === 'bet' &&
      context !== undefined &&
      (huBalanceSpotOfRequest === 'flop_cbet' || huBalanceSpotOfRequest === 'turn_checked_to');
    const huBalanceFoldToCall =
      transition.node === 'wager_rules' &&
      variant === 'nlh' &&
      transition.after.action === 'call' &&
      previous !== null &&
      previous.action === 'fold' &&
      huBalanceSpotOfRequest === 'flop_vs_check_raise';
    // PLO Strategy lane 2026-11-15 (HorseOmahaRiverMediumBetCalls): fold ->
    // call, admitted only with the request, where the rule re-run on it makes
    // the same call. Its whole-stack form is an all-in, a wager action.
    const omahaRiverMediumBetCalled =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_RIVER_MEDIUM_BET_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'call' &&
      previous !== null &&
      previous.action === 'fold' &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      mediumBetRuleProducesCall(transition.after, context) &&
      // PLO6: the rule never calls a hand the live river fold rule folds; the
      // same seeded test is re-run on the request (both board tests on: the
      // request does not carry V58/V59).
      !(variant === 'plo6' && plo6RiverLiveFoldTest(context.player, context.gameState));
    // omahaFlopBetIsPriced (sites-013U37, default off): a bare big pair's flop
    // bet with the betting lead becomes a check, in either position, when the
    // check is priced above it. A check puts no chip in; when the request is
    // known, only where the option's public spot, re-run on it, holds (the
    // receipt context carries neither the options nor the opponent read).
    const omahaPricedSiteFlopBetToCheck =
      transition.node === 'wager_rules' &&
      (variant === 'plo4' || variant === 'plo5') &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'all_in'].includes(previous.action) &&
      (context === undefined ||
        (String(context.gameState.gameVariant).toLowerCase() === variant &&
          omahaPricedSitesFlopBetSpot(context.player, context.gameState)));
    // Owner 2026-11-15 (HorseOmahaOopChecks, default-off options): a bet
    // facing no wager becomes a check on the flop out of position with a bare
    // pair, on the turn after the flop bet was called, and on a paired river
    // into a caller. A check puts no chip in; when the request is known, only
    // where one of the public spots, re-run on it, holds (the receipt
    // context carries neither the options nor the opponent read).
    const omahaOopBetToCheck =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_OOP_CHECK_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'raise', 'all_in'].includes(previous.action) &&
      (context === undefined ||
        (String(context.gameState.gameVariant).toLowerCase() === variant &&
          omahaOopCheckSpot(
            context.player,
            context.gameState,
            previous.action === 'bet' ? (previous.amount ?? undefined) : undefined
          )));
    // Owner 2026-11-15 12:09 (omahaOopTurnCheckAfterFlopCall, default off): out
    // of position on the turn, having checked and facing a bet, a raise or a
    // fold becomes a call. Admitted only with the request, where the rule's
    // own verdict, re-run on it, allows that call: a fold becomes a call only
    // on the nut-draw verdict, a raise on either non-fold verdict. (Its fold
    // is admitted by the paired-board fold's form above.)
    const oopTurnVerdict =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_OOP_CHECK_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['fold', 'raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant
        ? omahaOopTurnFacingBetVerdict(context.player, context.gameState)
        : null;
    const omahaOopTurnToCall =
      oopTurnVerdict === 'call_nut_draw' ||
      (oopTurnVerdict === 'no_raise' && previous !== null && previous.action !== 'fold');
    // omahaBareOverpairOopFlopCheck, the continuation (2026-11-15, default
    // off): heads-up on the flop, having checked the bare pair out of
    // position and facing a bet, a fold or a raise becomes a call when the
    // expected value of the call clears its margin. The verdict reads the
    // opponent memory, which the request does not carry, so the call is
    // admitted only with the request, only in the spot the rule covers and
    // only for the exact chips of the call (the whole-stack call is outside
    // the rule). Its fold is the paired-board fold's form above.
    const omahaBareOverpairContToCall =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_OOP_CHECK_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['fold', 'raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaBareOverpairContAdmitsCall(context.player, context.gameState, transition.after.amount);
    // Owner 2026-11-15 11:41 (HorseOmahaCardImpact, default-off option): a
    // heads-up turn or river bet facing no wager becomes a check when the
    // check is worth more against the opponent's range. A check puts no chip
    // in; when the request is known, only inside the option's public scope
    // and with a hand that is not nut class (the receipt context carries
    // neither the options nor the opponent read).
    const omahaCardImpactBetToCheck =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_CARD_IMPACT_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'all_in'].includes(previous.action) &&
      (context === undefined ||
        (String(context.gameState.gameVariant).toLowerCase() === variant &&
          omahaCardImpactCheckAdmissible(context.player, context.gameState)));
    // Owner 2026-11-15 (HorseOmahaFacingBetEv, option omahaFacingBetEv): in
    // PLO4/PLO5 cash on the turn and the river a fold facing a bet becomes the
    // call when the expected value of the call clears its margin (the reverse,
    // call to fold, is the fold admission above). The verdict reads the
    // opponent memory, which the request does not carry, so the fold -> call
    // is admitted only with the request, only in the spot the rule covers and
    // only for the exact chips the call puts in. Its whole-stack form is an
    // all-in, a wager action.
    // The composed chain inside wager_rules (journal debcf579..., 2026-11-18
    // 23:00:11Z, Lightning PLO5): a raise or an all-in raise that the PLO
    // paired-board fold turned into a fold, then omahaFacingBetEv turned into
    // the call. The node records raise -> call; the fold in between is not
    // recorded. At a table the same transition was admitted only because the
    // nut-rule admission happens to cover it (omahaRaiseNeedsNutsScope), which
    // refuses Lightning, so the Horse got a fallback action there. It is
    // admitted where both rules hold on the request: the paired-board fold
    // spot (re-run, with and without V86 multi-street, which the request does
    // not carry) and the facing-bet EV spot for the exact chips below.
    const pairedFoldThenEvCall =
      previous !== null &&
      (previous.action === 'raise' || previous.action === 'all_in') &&
      context !== undefined &&
      PLO_PAIRED_BOARD_VARIANTS.has(variant) &&
      (() => {
        const gs = context.gameState;
        // plo4/plo5/plo6 only (PLO_PAIRED_BOARD_VARIANTS): high-only unless the table's rules say split
        const hiLo = gs.variantRules?.splitLow8OrBetter === true;
        const input = {
          gameVariant: gs.gameVariant,
          hiLo,
          multiBoard: !!(gs.communityCards2?.length || gs.communityCards3?.length),
          board: gs.communityCards ?? [],
          hero: context.player,
          players: gs.players ?? [],
          currentBet: gs.currentBet,
          toCall: gs.toCall,
          pot: gs.pot,
        };
        try {
          return (
            ploPairedBoardMustFold({ ...input, v86MultiStreetUnblocked: true }) ||
            ploPairedBoardMustFold({ ...input, v86MultiStreetUnblocked: false })
          );
        } catch {
          return false;
        }
      })();
    const omahaFacingBetEvCalled =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_FACING_BET_EV_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'call' &&
      previous !== null &&
      (previous.action === 'fold' || pairedFoldThenEvCall) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      (() => {
        const spot = omahaFacingBetEvSpot(context.player, context.gameState);
        if (spot === null || spot.allIn || spot.paid !== transition.after.amount) return false;
        // PLO6 (six cards): the rule's own guard is pure, so it is re-run on
        // the request: where the river fold test stands the rule cannot have
        // called, and an uncountable six-card hand is not admitted either.
        // (Both tests on: the request does not carry V58/V59.) The rule also
        // never calls a hand the live river fold rule folds: that seeded
        // test is re-run on the request too.
        if (variant === 'plo6')
          return (
            omahaPlo6FacingBetEvFoldStands(
              spot,
              context.player.cards ?? [],
              context.gameState.communityCards ?? [],
              context.player.knownDeadCards ?? []
            ) === false && !plo6RiverLiveFoldTest(context.player, context.gameState)
          );
        return true;
      })();
    // PLO Strategy lane 2026-11-17 (HorseOmahaFlopFacingBetEv, option
    // omahaFlopFacingBetEv): on the PLO4/PLO5 cash flop a fold facing a bet
    // becomes the call when the expected value of the call clears its margin;
    // the fold may be the paired-board fold of a raise, so the node may have
    // entered as a raise (the reverse, call to fold, is the fold admission
    // above). The verdict reads the opponent memory, which the request does
    // not carry, so the call is admitted only with the request, only in the
    // flop spot the rule covers and only for the exact chips the call puts
    // in. Its whole-stack form is an all-in, a wager action.
    const omahaFlopFacingBetEvCalled =
      transition.node === 'wager_rules' &&
      OMAHA_FLOP_FACING_BET_EV_VARIANTS.has(variant) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['fold', 'raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaFlopFacingBetEvAdmitsCall(context.player, context.gameState, transition.after.amount);
    // EMERG lane FACING 2026-11-19 (HorseOmahaFacingBetEquity, option
    // omahaFacingBetIsPricedByEquity): in PLO4/PLO5 cash postflop (table and
    // Lightning) the node's final fold facing a person's wager becomes the
    // call when the calibrated equity times the measured realization beats
    // the price. The verdict is a pure function of the request (cards, board,
    // pot, chips to call, live opponents, street; card-seeded sampling), so
    // it is re-run here: fold -> call is admitted only with the request, only
    // where the verdict re-run on it calls, and only for the exact chips the
    // call puts in. Its whole-stack form is an all-in, a wager action.
    const omahaFacingEquityCalled =
      transition.node === 'wager_rules' &&
      OMAHA_FACING_EQUITY_VARIANTS.has(variant) &&
      transition.after.action === 'call' &&
      previous !== null &&
      previous.action === 'fold' &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaFacingEquityAdmitsCall(context.player, context.gameState, transition.after.amount);
    // EMERG lane RANGE-MODEL-2 2026-11-20 (HorseOmahaRiverCurrentNutsCallFloor, option
    // omahaRiverCurrentNutsCallFloor): in PLO4/PLO5 cash on the river facing a wager, the node's
    // final fold becomes the call when hero holds the exact current nuts and a full chop with every
    // live opponent still returns the call. The floor is a pure function of the request (cards,
    // board, dead cards, pot, chips owed, live opponents), so it is re-run here: fold -> call is
    // admitted only where it holds, for the exact chips the call puts in. Its whole-stack form is an
    // all-in, a wager action.
    const omahaRiverNutsFloorCalled =
      transition.node === 'wager_rules' &&
      (variant === 'plo4' || variant === 'plo5') &&
      transition.after.action === 'call' &&
      previous !== null &&
      previous.action === 'fold' &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaRiverCurrentNutsCallFloorAdmitsCall(
        context.player,
        context.gameState,
        transition.after.amount
      );
    // EMERG lane PREFLOP-UNCONTESTED 2026-11-20 (HorseOmahaFourBetFoldPricedCall, option
    // omahaFourBetFoldPricedCall): in PLO4/PLO5 cash preflop, after hero's own raise, facing a 4-bet or
    // more heads-up, the node's final fold becomes the call where the engine's priced call of a re-raise
    // is positive. The spot and the price are re-run here from the request (and the same registered
    // pricing inputs): fold -> call is admitted only where it holds, for the exact chips the call puts in.
    const omahaFourBetFoldCalled =
      transition.node === 'wager_rules' &&
      (variant === 'plo4' || variant === 'plo5') &&
      (transition.after.action === 'call' || transition.after.action === 'all_in') &&
      previous !== null &&
      previous.action === 'fold' &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaFourBetFoldPricedCallAdmitsCall(
        context.player,
        context.gameState,
        transition.after.amount
      );
    // HORSE DECISIONS lane 2026-11-19 (HorsePlo6FacingBetIsPriced, option
    // plo6FacingBetIsPriced, default off): in PLO6 cash facing a bet on the
    // flop, the turn or the river, a fold (or a raise the paired-board fold
    // folded) becomes the call where the call is priced on the exact six cards
    // against the bettor's line range. The verdict reads no option and no
    // opponent memory, so it is re-run on the request (no rake, either
    // position: a superset of what the rule can call) and admitted only for
    // the exact chips the call puts in. Its whole-stack form is an all-in, a
    // wager action. The river raise -> call is plo6RiverRaiseToCall above.
    // Review N4: admitted only under the decision's own option (context.plo6FacingBetIsPriced, its gate
    // candidates), so a PLO6 fold -> call from any other cause is not admitted by this verdict's superset.
    const plo6FacingBetPricedCalled =
      context?.plo6FacingBetIsPriced === true &&
      transition.node === 'wager_rules' &&
      variant === 'plo6' &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['fold', 'raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      plo6FacingBetPricedAdmitsCall(context.player, context.gameState, transition.after.amount);
    // Owner 2026-11-15 12:52 / 12:53 (HorseOmahaTurnRiverRaiseNeedsNuts,
    // option omahaTurnRiverRaiseNeedsNuts): on the PLO4/PLO5 cash turn and
    // river a raise facing a wager with a hand that is not nut class becomes
    // a call or a fold (the fold is the paired-board fold's form above). The
    // call is priced on the opponent memory, which the request does not
    // carry, so raise -> call is admitted only with the request, only where
    // the rule, re-run on it, would not keep the raise, and only for the
    // exact chips the call puts in (the whole-stack call is an all-in).
    const omahaRaiseNeedsNutsCalled =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_RAISE_NEEDS_NUTS_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'call' &&
      previous !== null &&
      // the node entered as a fold when an owner inside it raised from a fold
      ['raise', 'bet', 'all_in', 'fold'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaRaiseNeedsNutsAdmitsCall(context.player, context.gameState, transition.after.amount);
    // Owner 2026-11-17 11:49 (HorseOmahaPricedWiring, options
    // omahaTurnRiverRaiseIsPriced and omahaBigBetCallsArePriced): on the
    // PLO4/PLO5 cash turn and river a raise that is not priced above the call
    // becomes the call. The price is taken on the opponent memory, which the
    // request does not carry, so raise -> call is admitted only with the
    // request, only in that scope with a hand that is not nut class (the
    // rule keeps a nut-class raise), only for the exact chips of the call,
    // and only for a decision whose own priced-raise option was on
    // (context.omahaPricedRaise, omahaPricedRaiseGateCandidates).
    const omahaPricedRaiseCalled =
      context?.omahaPricedRaise === true &&
      transition.node === 'wager_rules' &&
      OMAHA_STRATEGY_PLO45.has(variant) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['raise', 'bet', 'all_in', 'fold'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaPricedAdmitsRaiseToCall(
        context.player,
        context.gameState,
        transition.after.amount,
        context.omahaPricedInLightning === true
      );
    // Lane HORSE DECISIONS 2026-11-19 (HorseOmahaPricedWiring, option
    // omahaSampledRaiseIsPricedAtEverySize with omahaDrawRaiseIsPriced or
    // omahaPressureIsPriced): on the PLO4/PLO5 cash flop and turn a raise
    // facing a wager is made at the priced size of highest value. The size is
    // priced on the opponent memory, which the request does not carry, so
    // raise -> raise is admitted only with the request, only in the sampled
    // spot, and only for the exact chips of one of the sizes the comparison
    // prices there (an all-in where the whole stack is one of them). The
    // generic wager clause below admits it too and is left as it is.
    const omahaSampledRaiseResized =
      transition.node === 'wager_rules' &&
      OMAHA_STRATEGY_PLO45.has(variant) &&
      ['raise', 'all_in'].includes(transition.after.action) &&
      previous !== null &&
      ['raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaPricedSampledAdmitsResize(
        context.player,
        context.gameState,
        transition.after.action,
        transition.after.amount,
        context.omahaPricedInLightning === true
      );
    // HORSE DECISIONS lane 2026-11-19 (HorseOmahaBluffPricedAgainstTheTarget, option
    // omahaBluffIsPricedAgainstTheTarget): in PLO4/PLO5 cash (table and Lightning) a heads-up wager
    // facing no bet that is not priced above the check becomes the check. The price reads the
    // opponent memory, which the request does not carry, so both are admitted only under the
    // decision's own option (context.omahaBluffPricedAgainstTheTarget, its gate candidates): the
    // check in the bet-or-check spot re-derived from the request. A flop or turn
    // raise facing a bet with no raise priced above the call becomes the call: only with the
    // request, only in the sampled spot, only for the exact chips of the call. (Its call -> raise is
    // a wager action, admitted below; its raise -> fold is the PLO fold admission above.)
    const omahaBluffPricedBetToCheck =
      context?.omahaBluffPricedAgainstTheTarget === true &&
      transition.node === 'wager_rules' &&
      OMAHA_STRATEGY_PLO45.has(variant) &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'raise', 'all_in'].includes(previous.action) &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaBluffPricedAdmitsCheck(context.player, context.gameState);
    const omahaBluffPricedRaiseCalled =
      context?.omahaBluffPricedAgainstTheTarget === true &&
      transition.node === 'wager_rules' &&
      OMAHA_STRATEGY_PLO45.has(variant) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['raise', 'bet', 'all_in', 'fold'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaBluffPricedAdmitsRaiseToCall(context.player, context.gameState, transition.after.amount);
    // Owner 2026-11-15 14:13 (HorseOmahaStrongHandSlowplayMix, option
    // omahaStrongHandSlowplayMix): in PLO4/PLO5 cash a raise facing a bet
    // with a nut-class hand becomes a call at a mixed frequency. The draw and
    // the opponent read are not in the request, so raise -> call is admitted
    // only with the request, only in the mix's public spot with a hand that
    // is nut class there, and only for the exact chips of the call.
    const omahaSlowplayCalled =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_SLOWPLAY_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaSlowplayAdmitsCall(
        context.player,
        context.gameState,
        transition.after.amount,
        context.omahaSlowplayMixInLightning === true
      );
    // The same option, the flop: a bet with a set on a very dry flop becomes
    // a check at a mixed frequency. Admitted only with the request, only in
    // the mix's spot re-run on it (the flop, nothing to call, one or two
    // opponents, a set, three suits and three ranks at least five apart).
    // With no request this admission admits nothing (review note N2,
    // 2026-11-16); the older bet -> check admissions above keep their own
    // no-request form (a check puts no chip in), unchanged here.
    const omahaSlowplayBetToCheck =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_SLOWPLAY_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'check' &&
      previous !== null &&
      previous.action === 'bet' &&
      omahaSlowplayAdmitsCheckWithRequest(
        variant,
        context,
        context?.omahaSlowplayMixInLightning === true
      );
    // Owner 2026-11-15 11:43 (HorseOmahaStreetPlan, default-off option): a
    // heads-up turn bet facing no wager becomes a check when the plan prices
    // the check line higher. A check puts no chip in; when the request is
    // known, only where the plan, re-run on it with the tendency multipliers
    // the decision records and the facing-bet veto at its strongest, prices
    // the check above the bet (the receipt context carries neither the
    // option nor the opponent read).
    const omahaStreetPlanBetToCheck =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_STREET_PLAN_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'all_in'].includes(previous.action) &&
      (context === undefined ||
        (String(context.gameState.gameVariant).toLowerCase() === variant &&
          omahaStreetPlanAdmitsCheck(
            context.player,
            context.gameState,
            previous.action === 'all_in' ? context.player.stack : (previous.amount ?? undefined),
            value.streetPlan
          )));
    // Owner 2026-11-15 11:43 (HorseOmahaStreetPlan, options omahaStreetPlanFlop
    // and omahaStreetPlanThreeWay, default off): a heads-up flop bet, or a
    // turn bet with exactly two live opponents, facing no wager becomes a
    // check under the plan. Admitted only with the request, only where the
    // plan re-run on it with the multipliers the decision records gives the
    // check (neither layer has a facing-bet seam, so the re-run is the
    // decision's own verdict). With no request it admits nothing.
    const omahaStreetPlanLayerBetToCheck =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_STREET_PLAN_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      (omahaStreetPlanFlopAdmitsCheck(
        context.player,
        context.gameState,
        previous.action === 'all_in' ? context.player.stack : (previous.amount ?? undefined),
        value.streetPlan
      ) ||
        omahaStreetPlanThreeWayAdmitsCheck(
          context.player,
          context.gameState,
          previous.action === 'all_in' ? context.player.stack : (previous.amount ?? undefined),
          value.streetPlan
        ));
    // Owner 2026-11-15 12:18 (HorseOmahaOopReraisedPot, options
    // omahaReraiseRangeOutOfPosition and omahaReraiseRangeEarlyPosition): a PLO4/PLO5 preflop 3-bet or 4-bet out of
    // position or from early position with a hand outside the capped range
    // becomes a call. Admitted only with the request, where the rule re-run
    // on it turns the raise into a call of the same amount.
    const omahaReraiseToCall =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_STRATEGY_PLO45, { gameVariant: variant }) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaReraiseRuleProducesCall(context.player, context.gameState, transition.after.amount);
    // EMERG lane RUNDOWNS 2026-11-20 (HorseOmahaRundownReraiseMeasured, option
    // omahaRundownReraiseRangeIsMeasured): in PLO4/PLO5 cash preflop a re-raise
    // in a measured cell where the call earned more real chips (the squeeze
    // from a blind with a high rundown above 250 bb) becomes the call. The
    // cell is a pure function of the request (own cards, public actions,
    // chips, seats), so it is re-run here: raise -> call is admitted only with
    // the request, only in that cell and only for the exact chips of the call.
    const omahaRundownMeasuredCalled =
      transition.node === 'wager_rules' &&
      OMAHA_RUNDOWN_RERAISE_VARIANTS.has(variant) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaRundownMeasuredAdmitsCall(context.player, context.gameState, transition.after.amount);
    // PLO Strategy lane 2026-11-17 (HorseOmahaPreflopReraiseDefence, option
    // omahaPreflopReraiseDefencePriced): in PLO4/PLO5 cash facing a 3-bet or
    // more preflop, a fold or a re-raise becomes a call when the expected
    // value of the call is the largest. The verdict reads the opponent
    // memory, which the request does not carry, so the call is admitted only
    // with the request, only in the preflop spot the rule covers and only for
    // the exact chips the call puts in. (Its fold is the fold admission
    // above; the whole-stack call is an all-in, a wager action.)
    const omahaPreflopReraiseDefenceCalled =
      transition.node === 'wager_rules' &&
      OMAHA_STRATEGY_PLO45.has(variant) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['fold', 'raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaPreflopReraiseDefenceAdmitsCall(
        context.player,
        context.gameState,
        transition.after.amount
      );
    // Owner 2026-11-15 12:30 (omahaNoDrawRaiseOutOfPosition): a raise with a
    // draw out of position, or in position with a bare flush draw, becomes a
    // call. Admitted only with the request, where the bar re-run on it agrees.
    const omahaDrawRaiseToCall =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_STRATEGY_PLO45, { gameVariant: variant }) &&
      transition.after.action === 'call' &&
      previous !== null &&
      ['raise', 'all_in'].includes(previous.action) &&
      context !== undefined &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaDrawRaiseBarOf(context.player, context.gameState) !== null;
    // 2026-11-16 (HorseOmahaMultiwayDiscipline, options
    // omahaNoRiverBluffIntoValueLeader and omahaMultiwayWeakHandNoBet, default
    // off): a turn or river bet facing no wager becomes a check. A check puts
    // no chip in; when the request is known, only where one of the two public
    // spots, re-run on it, holds (the receipt context carries neither the
    // options nor the opponent read).
    const omahaDisciplineBetToCheck =
      transition.node === 'wager_rules' &&
      omahaStrategyGameInScope(OMAHA_MULTIWAY_DISCIPLINE_VARIANTS, { gameVariant: variant }) &&
      transition.after.action === 'check' &&
      previous !== null &&
      ['bet', 'raise', 'all_in'].includes(previous.action) &&
      (context === undefined ||
        (String(context.gameState.gameVariant).toLowerCase() === variant &&
          (omahaRiverBluffIntoValueLeaderSpot(context.player, context.gameState) !== null ||
            omahaMultiwayWeakHandSpot(context.player, context.gameState) !== null)));
    // HORSE DECISIONS lane 2026-11-19 (HorseOmahaMultiwayPricedInTournaments, option
    // omahaMultiwayIsPricedInTournaments, review N1): in Omaha pot-limit tournaments (PLO4/5/6/8) a preflop
    // multiway call-off priced below zero becomes the fold, and a postflop multiway own bet priced below the
    // check becomes the check. Neither puts a chip in; both are admitted only under the decision's own option
    // (context.omahaMultiwayPricedInTournaments, its gate candidates) and only in the rule's own spot
    // re-derived from the request (PLO8's fold is outside the paired-board fold admission above).
    const omahaMwTourneyPriced =
      context?.omahaMultiwayPricedInTournaments === true &&
      transition.node === 'wager_rules' &&
      OMAHA_MW_TOURNEY_VARIANTS.has(variant) &&
      (transition.after.action === 'fold' || transition.after.action === 'check') &&
      previous !== null &&
      String(context.gameState.gameVariant).toLowerCase() === variant &&
      omahaMwTourneyAdmits(context.player, context.gameState, previous, transition.after.action);
    if (
      transition.node === 'wager_rules' &&
      changed &&
      !omahaMwTourneyPriced &&
      !omahaDisciplineBetToCheck &&
      !omahaDrawRaiseToCall &&
      !pairedBoardFold &&
      !huBalanceBetToCheck &&
      !huBalanceFoldToCall &&
      !omahaRiverMediumBetCalled &&
      !omahaCardImpactBetToCheck &&
      !omahaFacingBetEvCalled &&
      !omahaFlopFacingBetEvCalled &&
      !omahaFacingEquityCalled &&
      !omahaRiverNutsFloorCalled &&
      !omahaFourBetFoldCalled &&
      !plo6FacingBetPricedCalled &&
      !omahaRaiseNeedsNutsCalled &&
      !omahaPricedRaiseCalled &&
      !omahaSampledRaiseResized &&
      !omahaBluffPricedBetToCheck &&
      !omahaBluffPricedRaiseCalled &&
      !omahaSlowplayCalled &&
      !omahaSlowplayBetToCheck &&
      !pairedBoardRiverCheck &&
      !omahaBeatenBetToCheck &&
      !omahaOopBetToCheck &&
      !omahaPricedSiteFlopBetToCheck &&
      !omahaOopTurnToCall &&
      !omahaBareOverpairContToCall &&
      !omahaStreetPlanBetToCheck &&
      !omahaStreetPlanLayerBetToCheck &&
      !omahaOnePairReduction &&
      !shortAllInCall &&
      !noFourBetFold &&
      !plo6RiverRaiseToCall &&
      !plo6MultiwayWeakBetToCheck &&
      !omahaRiverNutRaiseToCall &&
      !omahaReraiseToCall &&
      !omahaRundownMeasuredCalled &&
      !omahaPreflopReraiseDefenceCalled &&
      !(
        transition.after.action === 'call' &&
        previous !== null &&
        previous.action !== 'call' &&
        context !== undefined &&
        context.gameState.gameVariant === variant &&
        PLO_PAIRED_BOARD_VARIANTS.has(variant) &&
        boatRuleProducesCall(previous, transition.after, context)
      ) &&
      !['bet', 'raise', 'all_in'].includes(transition.after.action)
    )
      return false;
    previous = transition.after;
  }
  return (
    previous !== null &&
    same(previous, graph.finalAction) &&
    same(graph.finalAction, {
      action: value.action as HorseDecision['action'],
      amount: (value.amount as number | undefined) ?? null,
    })
  );
}

/**
 * omahaMathCore admission: the wager_rules result is the core's applied
 * choice. The core reads only the request and its measured tables, so the
 * choice is checked against the request: scope, the receipt naming exactly
 * this action, and legality (a listed legal action; a call of exactly the
 * chips owed; a bet or raise inside the request's bounds).
 */
export function omahaMathCoreAdmits(
  value: RecordValue,
  after: HorsePolicyAction,
  expectedVariant: string | undefined,
  context: HorseDecisionReceiptContext | undefined
): boolean {
  try {
    if (context === undefined || context.omahaMathCore !== true) return false;
    const variant = String(expectedVariant ?? '').toLowerCase();
    if (!OMAHA_MATH_CORE_VARIANTS.has(variant)) return false;
    const gs = context.gameState;
    if (String(gs.gameVariant).toLowerCase() !== variant) return false;
    if (!omahaMathCoreInScope(context.player, gs)) return false;
    const receipt = value.omahaMathCore;
    if (!record(receipt) || receipt.applied !== true || receipt.switch !== 'omahaMathCore')
      return false;
    if (receipt.action !== after.action || (receipt.amount ?? null) !== (after.amount ?? null))
      return false;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes(after.action)) return false;
    const player = context.player;
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - (player.bet || 0));
    const eps = 0.005;
    if (after.action === 'call')
      return (
        after.amount !== null && Math.abs(after.amount - Math.min(toCall, player.stack)) <= eps
      );
    if (after.action === 'check') return toCall <= eps;
    if (after.action === 'fold') return toCall > eps;
    if (after.action === 'bet' || after.action === 'raise') {
      if (after.amount === null || !Number.isFinite(after.amount)) return false;
      const lo = Number.isFinite(gs.minRaiseTo) ? (gs.minRaiseTo as number) : 0;
      const hi = Number.isFinite(gs.maxRaiseTo) ? (gs.maxRaiseTo as number) : Infinity;
      return after.amount >= lo - eps && after.amount <= hi + eps;
    }
    return after.action === 'all_in';
  } catch {
    return false;
  }
}

/** Finite refusal names only: no player identity, cards or raw receipt data. */
/**
 * The omahaStrategyInPlo6 values the worker may have run this decision with
 * (PLO6 lane 2026-11-16). The live option switch delivers its value inside
 * the worker, after the request was built, so the request's own option is not
 * always the effective one. `switchConfig` is the configuration the main
 * thread last delivered to that worker (the database answer as read; null or
 * undefined when none was delivered or the read failed).
 *  - No valid row for the option: the request's own value, alone.
 *  - A row: the row's value first (on is never returned for an off-only
 *    option: optionSwitchDecisionOpts), then the request's own value when it
 *    differs, because a worker whose delivered configuration has aged out
 *    runs the release default, which is the request's value.
 * The validator admits the decision when it is valid under one of them
 * (horseDecisionReceiptRefusalForPlo6Gates).
 */
export function omahaStrategyInPlo6GateCandidates(
  requestOpts: { omahaStrategyInPlo6?: unknown } | null | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean[] {
  const own = requestOpts?.omahaStrategyInPlo6 === true;
  const switchedOf = (config: unknown): boolean | undefined => {
    try {
      const parsed = parseOptionSwitchConfig(config);
      return parsed.ok ? optionSwitchDecisionOpts(parsed.states).omahaStrategyInPlo6 : undefined;
    } catch {
      return undefined;
    }
  };
  const out: boolean[] = [];
  const add = (v: boolean | undefined) => {
    if (v !== undefined && !out.includes(v)) out.push(v);
  };
  // The effective value first: the row last delivered, else the request's own.
  add(switchedOf(switchConfig));
  add(own);
  // The configuration delivered before the last change, while the worker may
  // still be deciding under it (deliveredSwitchConfigsNote / InForce).
  if (previousSwitchConfig !== undefined) add(switchedOf(previousSwitchConfig));
  return out;
}

/**
 * What a worker was handed, with the configuration it held before the last
 * change (pre-review 2 finding 1). The worker reads its inbox at most once
 * per STYLE_SWITCH_POLL_MS, so for one poll interval after a changed
 * delivery it may still decide under the previous configuration; a decision
 * made then is validated under that one as well. `previousUntilMs` is the
 * clock time until which `previous` counts.
 */
export interface DeliveredSwitchConfigs {
  current: unknown;
  previous: unknown;
  previousUntilMs: number;
}

export const DELIVERED_SWITCH_CONFIGS_NONE: DeliveredSwitchConfigs = Object.freeze({
  current: null,
  previous: undefined,
  previousUntilMs: 0,
});

const sameSwitchConfig = (a: unknown, b: unknown): boolean => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/** A delivery: an unchanged configuration keeps the state; a changed one keeps the old as previous for one poll interval. */
export function deliveredSwitchConfigsNote(
  state: DeliveredSwitchConfigs,
  config: unknown,
  nowMs: number,
  pollMs: number = STYLE_SWITCH_POLL_MS
): DeliveredSwitchConfigs {
  if (sameSwitchConfig(state.current, config)) return state;
  return { current: config, previous: state.current, previousUntilMs: nowMs + pollMs };
}

/** The previous configuration while it still counts, else undefined. */
export function deliveredSwitchConfigsPrevious(
  state: DeliveredSwitchConfigs,
  nowMs: number
): unknown {
  return nowMs <= state.previousUntilMs ? state.previous : undefined;
}

/**
 * horseDecisionReceiptRefusal under each candidate gate: null as soon as one
 * admits the decision, else the refusal under the first (the effective one).
 */
export function horseDecisionReceiptRefusalForPlo6Gates(
  value: unknown,
  expectedVariant: string | undefined,
  context: Omit<HorseDecisionReceiptContext, 'omahaStrategyInPlo6'>,
  gates: readonly boolean[]
): string | null {
  let first: string | null = null;
  let seen = false;
  for (const gate of gates.length > 0 ? gates : [false]) {
    const refusal = horseDecisionReceiptRefusal(value, expectedVariant, {
      ...context,
      ...(gate ? { omahaStrategyInPlo6: true } : {}),
    });
    if (refusal === null) return null;
    if (!seen) {
      first = refusal;
      seen = true;
    }
  }
  return first;
}

/** The two options whose raise -> call the validator admits (context.omahaPricedRaise). */
/**
 * THE GAME SCOPE OF AN OMAHA OPTION (lane PLO4-FIX 2026-11-20, HorseOmahaOptionGameScope.ts): when the request's own
 * omahaOptionGameScope confines one of `names` to a game, the worker ran a decision of the other game with that
 * option off, whatever the switch row says. So `false` is one of the values the worker may have run with. With no
 * scope in the request (the compiled defaults) this is false and the candidates are exactly what they were.
 */
function omahaOptionGameScoped(
  requestOpts: { omahaOptionGameScope?: unknown } | null | undefined,
  names: readonly string[]
): boolean {
  const scope = requestOpts?.omahaOptionGameScope;
  if (!scope || typeof scope !== 'object') return false;
  return names.some((name) => {
    const only = (scope as Readonly<Record<string, unknown>>)[name];
    return only === 4 || only === 5;
  });
}

export const OMAHA_PRICED_RAISE_GATE_OPTIONS = Object.freeze([
  'omahaTurnRiverRaiseIsPriced',
  'omahaBigBetCallsArePriced',
] as const);
const omahaPricedRaiseGateOf = (
  opts: Readonly<Record<string, unknown>> | null | undefined
): boolean => OMAHA_PRICED_RAISE_GATE_OPTIONS.some((name) => opts?.[name] === true);

/**
 * The omahaPricedRaise values the worker may have run this decision with,
 * built exactly as omahaStrategyInPlo6GateCandidates: the live switch row
 * this client last delivered (either option on), then the request's own
 * options when they differ, then the configuration delivered before the last
 * change while it still counts. A switch row that does not name the options
 * leaves the request's own value.
 */
export function omahaPricedRaiseGateCandidates(
  requestOpts: Readonly<Record<string, unknown>> | null | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean[] {
  const own = omahaPricedRaiseGateOf(requestOpts);
  const switchedOf = (config: unknown): boolean | undefined => {
    try {
      const parsed = parseOptionSwitchConfig(config);
      if (!parsed.ok) return undefined;
      const switched = optionSwitchDecisionOpts(parsed.states);
      if (OMAHA_PRICED_RAISE_GATE_OPTIONS.every((name) => switched[name] === undefined))
        return undefined;
      // A row names one option; the other keeps the request's own value.
      return OMAHA_PRICED_RAISE_GATE_OPTIONS.some((name) =>
        switched[name] === undefined ? requestOpts?.[name] === true : switched[name] === true
      );
    } catch {
      return undefined;
    }
  };
  const out: boolean[] = [];
  const add = (v: boolean | undefined) => {
    if (v !== undefined && !out.includes(v)) out.push(v);
  };
  add(switchedOf(switchConfig));
  add(own);
  if (previousSwitchConfig !== undefined) add(switchedOf(previousSwitchConfig));
  if (omahaOptionGameScoped(requestOpts, OMAHA_PRICED_RAISE_GATE_OPTIONS)) add(false);
  return out;
}

/**
 * The omahaPricedInLightning values the worker may have run this decision
 * with, built exactly as omahaStrategyInPlo6GateCandidates: the live switch
 * row this client last delivered, then the request's own option when it
 * differs, then the configuration delivered before the last change while it
 * still counts.
 */
export function omahaPricedInLightningGateCandidates(
  requestOpts:
    | { omahaPricedInLightning?: unknown; omahaOptionGameScope?: unknown }
    | null
    | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean[] {
  const own = requestOpts?.omahaPricedInLightning === true;
  const switchedOf = (config: unknown): boolean | undefined => {
    try {
      const parsed = parseOptionSwitchConfig(config);
      return parsed.ok ? optionSwitchDecisionOpts(parsed.states).omahaPricedInLightning : undefined;
    } catch {
      return undefined;
    }
  };
  const out: boolean[] = [];
  const add = (v: boolean | undefined) => {
    if (v !== undefined && !out.includes(v)) out.push(v);
  };
  add(switchedOf(switchConfig));
  add(own);
  if (previousSwitchConfig !== undefined) add(switchedOf(previousSwitchConfig));
  if (omahaOptionGameScoped(requestOpts, ['omahaPricedInLightning'])) add(false);
  return out;
}

/**
 * The omahaSlowplayMixInLightning values the worker may have run this
 * decision with, built exactly as omahaPricedInLightningGateCandidates: the
 * live switch row this client last delivered, then the request's own option
 * when it differs, then the configuration delivered before the last change
 * while it still counts.
 */
export function omahaSlowplayMixInLightningGateCandidates(
  requestOpts:
    | { omahaSlowplayMixInLightning?: unknown; omahaOptionGameScope?: unknown }
    | null
    | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean[] {
  const own = requestOpts?.omahaSlowplayMixInLightning === true;
  const switchedOf = (config: unknown): boolean | undefined => {
    try {
      const parsed = parseOptionSwitchConfig(config);
      return parsed.ok
        ? optionSwitchDecisionOpts(parsed.states).omahaSlowplayMixInLightning
        : undefined;
    } catch {
      return undefined;
    }
  };
  const out: boolean[] = [];
  const add = (v: boolean | undefined) => {
    if (v !== undefined && !out.includes(v)) out.push(v);
  };
  add(switchedOf(switchConfig));
  add(own);
  if (previousSwitchConfig !== undefined) add(switchedOf(previousSwitchConfig));
  if (omahaOptionGameScoped(requestOpts, ['omahaSlowplayMixInLightning'])) add(false);
  return out;
}

/**
 * omahaMathCore (lane MATHCORE 2026-11-19): whether the worker may have run
 * this decision with omahaMathCore on: the request's own option, the switch
 * row this client last delivered, or the configuration before the last change
 * while it still counts. Any of them on admits the core's choice (the choice
 * is still checked against its own receipt and the request).
 */
export function omahaMathCoreGate(
  requestOpts: Readonly<Record<string, unknown>> | null | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean {
  if (requestOpts?.omahaMathCore === true) return true;
  const on = (config: unknown): boolean => {
    try {
      const parsed = parseOptionSwitchConfig(config);
      return parsed.ok && optionSwitchDecisionOpts(parsed.states).omahaMathCore === true;
    } catch {
      return false;
    }
  };
  return on(switchConfig) || (previousSwitchConfig !== undefined && on(previousSwitchConfig));
}

/**
 * The math core's admission flags the worker may have run this decision with (lane CORE-AUDIT, Nov 21): each of
 * omahaMathCorePreflop and the six street flags is on when the request's own option is on or the delivered switch
 * row (or the one before it while it still counts) turns it on, exactly as omahaMathCoreGate reads omahaMathCore.
 * The worker-failure doors use it so the core's recovery acts only on a street the core owns.
 */
export const OMAHA_MATH_CORE_ADMISSION_FLAGS = [
  'omahaMathCorePreflop',
  'omahaMathCorePlo4Flop',
  'omahaMathCorePlo4Turn',
  'omahaMathCorePlo4River',
  'omahaMathCorePlo5Flop',
  'omahaMathCorePlo5Turn',
  'omahaMathCorePlo5River',
] as const;
export function omahaMathCoreAdmissionGate(
  requestOpts: Readonly<Record<string, unknown>> | null | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): Record<(typeof OMAHA_MATH_CORE_ADMISSION_FLAGS)[number], boolean> {
  const fromConfig = (config: unknown): Readonly<Record<string, boolean>> => {
    try {
      const parsed = parseOptionSwitchConfig(config);
      return parsed.ok ? optionSwitchDecisionOpts(parsed.states) : {};
    } catch {
      return {};
    }
  };
  const current = fromConfig(switchConfig);
  const previous = previousSwitchConfig !== undefined ? fromConfig(previousSwitchConfig) : {};
  const out = {} as Record<(typeof OMAHA_MATH_CORE_ADMISSION_FLAGS)[number], boolean>;
  for (const flag of OMAHA_MATH_CORE_ADMISSION_FLAGS)
    out[flag] = requestOpts?.[flag] === true || current[flag] === true || previous[flag] === true;
  return out;
}

/**
 * The omahaBluffIsPricedAgainstTheTarget values the worker may have run this decision with, built
 * exactly as omahaPricedInLightningGateCandidates: the live switch row this client last delivered,
 * then the request's own option when it differs, then the configuration delivered before the last
 * change while it still counts.
 */
export function omahaBluffPricedAgainstTheTargetGateCandidates(
  requestOpts: { omahaBluffIsPricedAgainstTheTarget?: unknown } | null | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean[] {
  const own = requestOpts?.omahaBluffIsPricedAgainstTheTarget === true;
  const switchedOf = (config: unknown): boolean | undefined => {
    try {
      const parsed = parseOptionSwitchConfig(config);
      return parsed.ok
        ? optionSwitchDecisionOpts(parsed.states).omahaBluffIsPricedAgainstTheTarget
        : undefined;
    } catch {
      return undefined;
    }
  };
  const out: boolean[] = [];
  const add = (v: boolean | undefined) => {
    if (v !== undefined && !out.includes(v)) out.push(v);
  };
  add(switchedOf(switchConfig));
  add(own);
  if (previousSwitchConfig !== undefined) add(switchedOf(previousSwitchConfig));
  return out;
}

/**
 * The values one decision option may have had in the worker for this decision, built exactly as
 * omahaPricedInLightningGateCandidates: the live switch row this client last delivered, then the request's
 * own option when it differs, then the configuration delivered before the last change while it still counts.
 */
function decisionOptionGateCandidates(
  option: string,
  requestOpts: Readonly<Record<string, unknown>> | null | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean[] {
  const own = requestOpts?.[option] === true;
  const switchedOf = (config: unknown): boolean | undefined => {
    try {
      const parsed = parseOptionSwitchConfig(config);
      if (!parsed.ok) return undefined;
      const v = (optionSwitchDecisionOpts(parsed.states) as Record<string, unknown>)[option];
      return v === undefined ? undefined : v === true;
    } catch {
      return undefined;
    }
  };
  const out: boolean[] = [];
  const add = (v: boolean | undefined) => {
    if (v !== undefined && !out.includes(v)) out.push(v);
  };
  add(switchedOf(switchConfig));
  add(own);
  if (previousSwitchConfig !== undefined) add(switchedOf(previousSwitchConfig));
  return out;
}

/** The plo6FacingBetIsPriced values the worker may have run this decision with (review N4). */
export function plo6FacingBetIsPricedGateCandidates(
  requestOpts: { plo6FacingBetIsPriced?: unknown } | null | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean[] {
  return decisionOptionGateCandidates(
    'plo6FacingBetIsPriced',
    requestOpts as Readonly<Record<string, unknown>> | null | undefined,
    switchConfig,
    previousSwitchConfig
  );
}

/** The omahaMultiwayIsPricedInTournaments values the worker may have run this decision with (review N1). */
export function omahaMultiwayIsPricedInTournamentsGateCandidates(
  requestOpts: { omahaMultiwayIsPricedInTournaments?: unknown } | null | undefined,
  switchConfig: unknown,
  previousSwitchConfig?: unknown
): boolean[] {
  return decisionOptionGateCandidates(
    'omahaMultiwayIsPricedInTournaments',
    requestOpts as Readonly<Record<string, unknown>> | null | undefined,
    switchConfig,
    previousSwitchConfig
  );
}

/**
 * horseDecisionReceiptRefusalForPlo6Gates under each candidate priced-raise
 * gate (and, when given, each candidate omahaPricedInLightning gate and each
 * candidate omahaSlowplayMixInLightning gate, and each candidate
 * omahaBluffIsPricedAgainstTheTarget gate, each candidate plo6FacingBetIsPriced gate and each candidate
 * omahaMultiwayIsPricedInTournaments gate) as well: null as soon as one
 * set of gates admits the decision, else the refusal under the first (the
 * effective one). Without `pricedInLightningGates` / `slowplayMixInLightningGates`
 * only the false gate of each is tried: exactly as before.
 */
export function horseDecisionReceiptRefusalForGates(
  value: unknown,
  expectedVariant: string | undefined,
  context: Omit<
    HorseDecisionReceiptContext,
    | 'omahaStrategyInPlo6'
    | 'omahaPricedRaise'
    | 'omahaPricedInLightning'
    | 'omahaSlowplayMixInLightning'
    | 'omahaBluffPricedAgainstTheTarget'
    | 'plo6FacingBetIsPriced'
    | 'omahaMultiwayPricedInTournaments'
  >,
  plo6Gates: readonly boolean[],
  pricedRaiseGates: readonly boolean[],
  pricedInLightningGates: readonly boolean[] = [false],
  slowplayMixInLightningGates: readonly boolean[] = [false],
  bluffPricedGates: readonly boolean[] = [false],
  plo6FacingBetPricedGates: readonly boolean[] = [false],
  multiwayTourneyGates: readonly boolean[] = [false]
): string | null {
  let first: string | null = null;
  let seen = false;
  for (const mwGate of multiwayTourneyGates.length > 0 ? multiwayTourneyGates : [false])
    for (const plo6PricedGate of plo6FacingBetPricedGates.length > 0
      ? plo6FacingBetPricedGates
      : [false])
      for (const bluffGate of bluffPricedGates.length > 0 ? bluffPricedGates : [false])
        for (const slowplayGate of slowplayMixInLightningGates.length > 0
          ? slowplayMixInLightningGates
          : [false]) {
          for (const lightningGate of pricedInLightningGates.length > 0
            ? pricedInLightningGates
            : [false]) {
            for (const gate of pricedRaiseGates.length > 0 ? pricedRaiseGates : [false]) {
              const refusal = horseDecisionReceiptRefusalForPlo6Gates(
                value,
                expectedVariant,
                {
                  ...context,
                  ...(gate ? { omahaPricedRaise: true } : {}),
                  ...(lightningGate ? { omahaPricedInLightning: true } : {}),
                  ...(slowplayGate ? { omahaSlowplayMixInLightning: true } : {}),
                  ...(bluffGate ? { omahaBluffPricedAgainstTheTarget: true } : {}),
                  ...(plo6PricedGate ? { plo6FacingBetIsPriced: true } : {}),
                  ...(mwGate ? { omahaMultiwayPricedInTournaments: true } : {}),
                },
                plo6Gates
              );
              if (refusal === null) return null;
              if (!seen) {
                first = refusal;
                seen = true;
              }
            }
          }
        }
  return first;
}

export function horseDecisionReceiptRefusal(
  value: unknown,
  expectedVariant?: string,
  context?: HorseDecisionReceiptContext
): string | null {
  if (
    !record(value) ||
    !ACTIONS.includes(value.action as (typeof ACTIONS)[number]) ||
    !nonnegative(value.thinkTime) ||
    (value.amount !== undefined && !nonnegative(value.amount)) ||
    (value.policyFallback !== undefined && value.policyFallback !== 'brain_exception')
  )
    return 'decision_shape';
  if (
    value.policyFallback === 'brain_exception' &&
    (!['check', 'fold'].includes(value.action as string) ||
      value.amount !== undefined ||
      value.policyGraph !== undefined ||
      value.policyOwnership !== undefined ||
      value.tournamentPreflopAttribution !== undefined ||
      value.tournamentUtility !== undefined ||
      value.tournamentUtilityRefusal !== undefined)
  )
    return 'exception_fallback';
  if (value.featureAuthority !== undefined) {
    const f = value.featureAuthority;
    if (
      !record(f) ||
      !exact(f, ['version', 'authority', 'compositionDigest', 'flags', 'domain']) ||
      f.version !== 'horse-feature-decision-v1' ||
      !horseAuthorityReceiptIsWellFormed(f.authority) ||
      f.authority.state !== 'usable' ||
      typeof f.compositionDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(f.compositionDigest) ||
      !record(f.flags) ||
      !exact(f.flags, HORSE_FEATURE_FLAGS) ||
      !Object.values(f.flags).every((v) => typeof v === 'boolean') ||
      !Object.values(f.flags).some(Boolean) ||
      !record(f.domain) ||
      f.domain.variant !== expectedVariant
    )
      return 'feature_authority';
  }
  if (!policyGraphIsValid(value, expectedVariant, context)) return 'policy_graph';
  if (!correctiveKernelReceiptIsValid(value as unknown as HorseDecision))
    return 'corrective_kernel';
  // The final nuts rule can supersede an owner without rewriting what that
  // owner actually selected. Bind its receipt to the graph's verified input
  // to the final rule; the graph itself still binds the executed output.
  const graph = value.policyGraph as HorseDecision['policyGraph'];
  const beforeNuts =
    graph?.transitions.find((t) => t.node === 'corrective_policy')?.before ??
    graph?.transitions.find((t) => t.node === 'wager_rules')?.before;
  const selected: RecordValue = beforeNuts
    ? { ...value, action: beforeNuts.action, amount: beforeNuts.amount ?? undefined }
    : value;
  // A Phase 7 refusal is a finite name, never beside the ledger it says is absent.
  if (
    value.tournamentUtilityRefusal !== undefined &&
    (typeof value.tournamentUtilityRefusal !== 'string' ||
      !/^[a-z0-9_]{1,64}$/.test(value.tournamentUtilityRefusal) ||
      value.tournamentUtility !== undefined)
  )
    return 'phase7_refusal';
  if (
    value.tournamentUtility !== undefined &&
    !horseTournamentUtilityReceiptIsValid(value.tournamentUtility, phase7Selection(selected))
  )
    return 'phase7_utility';
  if (!horsePhase8LedgerIsValid(value.tournamentPostflop, selected)) return 'phase8_ledger';
  if (
    record(value.tournamentCatastropheGuard) &&
    value.tournamentCatastropheGuard.eligible === true &&
    context &&
    !(
      context.gameState.gameMode === 'tournament' &&
      context.gameState.gameVariant === 'nlh' &&
      ['flop', 'turn', 'river'].includes(context.gameState.stage) &&
      (context.gameState.boardCount ?? 1) === 1 &&
      !context.gameState.communityCards2?.length &&
      !context.gameState.communityCards3?.length
    )
  )
    return 'phase8_guard_domain';
  if (!horsePhase8GuardLedgerIsValid(value.tournamentCatastropheGuard, selected))
    return 'phase8_guard_ledger';
  if (value.plo4Policy !== undefined && !plo4LiveReceiptBindingIsValid(value.plo4Policy))
    return 'phase10_binding';
  if (!horsePhase10SelectionIsValid(value.plo4Policy, selected, graph)) return 'phase10_selection';
  // P11.1: a Phase 11 receipt's input binding is shape-checked at the boundary.
  if (
    value.omahaVariantPolicy !== undefined &&
    !omahaVariantReceiptBindingIsValid(value.omahaVariantPolicy)
  )
    return 'phase11_binding';
  if (!horsePhase11SelectionIsValid(value.omahaVariantPolicy, selected, graph))
    return 'phase11_selection';
  // P12.1: a Phase 12 receipt's bindings (inputs, and the P12-B net-action
  // economics) are re-checked at the boundary.
  if (
    value.remainingVariantPolicy !== undefined &&
    !remainingVariantReceiptBindingIsValid(value.remainingVariantPolicy)
  )
    return 'phase12_binding';
  if (!horsePhase12SelectionIsValid(value.remainingVariantPolicy, selected, graph))
    return 'phase12_selection';
  // P13.1: a Phase 13 receipt's input binding, pack versions and selection
  // refusal are re-checked at the boundary.
  if (value.jointPolicy !== undefined && !jointReceiptBindingIsValid(value.jointPolicy))
    return 'phase13_binding';
  // P13.3: and its selection, by the Phase 10/11/12 law.
  if (!horsePhase13SelectionIsValid(value.jointPolicy, selected, graph)) return 'phase13_selection';
  if (
    value.tournamentPreflopAttribution !== undefined &&
    !horsePhase6AttributionIsValid(value.tournamentPreflopAttribution)
  )
    return 'phase6_attribution';
  if (!horsePolicyOwnershipMatches(value as unknown as HorseDecision)) return 'policy_ownership';
  if (
    value.policyOwnership !== undefined &&
    expectedVariant !== undefined &&
    (value.policyOwnership as HorseDecision['policyOwnership'])?.variant !== expectedVariant
  )
    return 'owner_variant';
  return null;
}

export function horseDecisionReceiptIsValid(
  value: unknown,
  expectedVariant?: string,
  context?: HorseDecisionReceiptContext
): value is HorseDecision {
  return horseDecisionReceiptRefusal(value, expectedVariant, context) === null;
}
