import { isPlo4HoldoutSeed } from './Plo4StrengthContract.js';
import { isOmahaVariantHoldoutSeed } from './OmahaVariantStrengthContract.js';
import { isRemainingVariantHoldoutSeed } from './RemainingVariantStrengthContract.js';
import { isJointHoldoutSeed } from './JointStrengthContract.js';
import { PLO6_V24_DEVELOPMENT_DESIGN } from './Plo6V24Qualification.js';
import { V53_PRESSURE_RESERVED_HOLDOUT_SEEDS } from './PressureQualificationContract.js';
/** Preregistered finite DEVELOPMENT design only. No heldout or activation route.
 * A deliberately excessive river-stab stress workload, not a human calibration. */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from '../engine/HorseLogic.js';
import type { Plo4AblationBrain, Plo4AblationPopulation } from './Plo4PolicyLeague.js';
import type { FeatureAblationSpec } from './FeatureAblationLeague.js';
import { pressureDevelopmentProfiles } from './PressureQualificationContract.js';
import { buildFeatureWarmRecords, type FeatureAblationWarmHand } from './FeatureAblationHistory.js';
import {
  riverPositionIncrements,
  riverTripleCheckRaiseIncrements,
} from '../engine/HorseRiverPositionRead.js';
import { omahaQuickCategory, scoreHoldem } from '../engine/HorseEval.js';

export const INCREMENTAL_FLAGS = Object.freeze({
  combo_draw_pressure: 'comboDrawPressure',
  targeted_river_bluff: 'v54RiverBluff',
  river_position_defense: 'riverPositionDefense',
  river_bluff_checkraise: 'riverBluffCheckRaise',
  barrel_continuation_outlook: 'barrelContinuationOutlook',
} as const);
export const SEPARATE_RIVER_FLAGS = Object.freeze({
  small_pot_near_nut_value_raise: 'smallPotNearNutRiverValue',
  multiway_river_bluff_checkraise: 'multiwayRiverBluffCheckRaise',
} as const);
export type SeparateRiverTarget = keyof typeof SEPARATE_RIVER_FLAGS;
export type IncrementalTarget =
  | keyof typeof INCREMENTAL_FLAGS
  | SeparateRiverTarget
  | 'pressure_package';
export const isSeparateRiverTarget = (value: unknown): value is SeparateRiverTarget =>
  typeof value === 'string' && Object.hasOwn(SEPARATE_RIVER_FLAGS, value);
/** Fresh prospective DEVELOPMENT coordinates; never reuse conditional near-nut results.
 * Reserved seeds are declarations only, not authority to execute a heldout. */
export const SEPARATE_RIVER_DESIGNS = Object.freeze({
  small_pot_near_nut_value_raise: Object.freeze({
    version: 'near-nut-physical-development-v2',
    developmentSeeds: Object.freeze([27701101, 27702203, 27703307]),
    reservedHoldoutSeeds: Object.freeze([28701109, 28702231, 28703347]),
    warmSeed: 27707777,
  }),
  multiway_river_bluff_checkraise: Object.freeze({
    version: 'multiway-river-physical-development-v1',
    developmentSeeds: Object.freeze([27801101, 27802203, 27803307]),
    reservedHoldoutSeeds: Object.freeze([28801109, 28802231, 28803347]),
    warmSeed: 27807777,
  }),
});
export const INCREMENTAL_DEVELOPMENT_SEEDS = Object.freeze([27301101, 27302203, 27303307]);
/** Reserved before development, never authorized to deal by this module. */
export const INCREMENTAL_RESERVED_HOLDOUT_SEEDS = Object.freeze([28301109, 28302231, 28303347]);
export const INCREMENTAL_WARM_SEED = 27307777;
export const INCREMENTAL_HISTORY_VERSION = 'incremental-public-overstab-warm-v1';
export function isIncrementalTarget(value: unknown): value is IncrementalTarget {
  return (
    typeof value === 'string' &&
    (value === 'pressure_package' ||
      Object.hasOwn(INCREMENTAL_FLAGS, value) ||
      isSeparateRiverTarget(value))
  );
}
export function incrementalPressureDecision(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  rng: () => number,
  /** River opening bet as a pot fraction. Omitted: the original 0.75 with no
   * extra draw, so every existing population keeps its exact RNG sequence. */
  riverOpenFraction?: (rng: () => number) => number
): HorseDecision {
  if (!['nlh', 'plo4', 'plo5', 'plo6'].includes(gs.gameVariant))
    throw new Error('Incremental stress variant refused');
  const legal = gs.legalActions ?? [];
  const toCall = gs.toCall ?? Math.max(0, gs.currentBet - player.bet);
  const action = (a: HorseDecision['action'], amount?: number): HorseDecision => ({
    action: a,
    ...(amount === undefined ? {} : { amount }),
    thinkTime: 0,
  });
  const passive = () => action(legal.includes('check') ? 'check' : 'fold');
  const call = () => (legal.includes('call') ? action('call') : passive());
  const sized = (fraction: number) => {
    const kind = legal.includes('raise') ? 'raise' : legal.includes('bet') ? 'bet' : null;
    if (!kind || gs.minRaiseTo == null || gs.maxRaiseTo == null || gs.maxRaiseTo < gs.minRaiseTo)
      return null;
    const target =
      kind === 'bet' ? gs.pot * fraction : gs.currentBet + (gs.pot + toCall) * fraction;
    return action(
      kind,
      Math.round(Math.max(gs.minRaiseTo, Math.min(gs.maxRaiseTo, target)) * 100) / 100
    );
  };
  const history = gs.actionHistory ?? [];
  if (gs.stage === 'preflop') {
    const raised = history.some(
      (a) =>
        a.stage === 'preflop' && (a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise))
    );
    // Wide entrance, one opening raise; no forced preflop raise war.
    return !raised ? (sized(0.6) ?? call()) : call();
  }
  if (toCall <= 0) {
    const activeOthers = gs.players.filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_all_in
    );
    const checked = new Set(
      history.filter((a) => a.stage === gs.stage && a.action === 'check').map((a) => a.userId)
    );
    const lastToAct = activeOthers.length > 0 && activeOthers.every((p) => checked.has(p.user_id));
    if (!lastToAct) return passive();
    const probability = gs.stage === 'river' ? 0.95 : gs.stage === 'flop' ? 0.75 : 0.65;
    return rng() < probability
      ? (sized(gs.stage === 'river' ? (riverOpenFraction ? riverOpenFraction(rng) : 0.75) : 0.5) ??
          passive())
      : passive();
  }
  // Deliberately wide flop/turn continuations preserve observable river opportunities.
  // River responses use only this seat's holding, never another player's cards.
  if (gs.stage !== 'river') return call();
  const category =
    gs.gameVariant === 'nlh'
      ? Math.floor(
          scoreHoldem(
            [...player.cards, ...gs.communityCards],
            player.cards.length + gs.communityCards.length,
            false
          ) / 0x100000
        )
      : omahaQuickCategory(player.cards, gs.communityCards);
  return category >= 4 || rng() < 0.12 ? call() : passive();
}
export const INCREMENTAL_PRESSURE_POPULATION: Plo4AblationPopulation = Object.freeze({
  id: 'incremental_public_overstab_stress_v1',
  decide: incrementalPressureDecision,
});
/** Separately identified check-raise/response workload. Actual controller
 * actions, never preloaded counters; every non-fold response remains observed. */
export const INCREMENTAL_CHECKRAISE_POPULATION: Plo4AblationPopulation = Object.freeze({
  id: 'incremental_public_triple_checkraise_stress_v1',
  decide(player: SeatPlayer, gs: HorseGameStateV2, rng: () => number): HorseDecision {
    if (gs.stage === 'river') {
      const river = (gs.actionHistory ?? []).filter(
        (a) =>
          a.stage === 'river' &&
          ['check', 'bet', 'raise', 'call', 'fold', 'all_in'].includes(a.action)
      );
      if (
        river.length === 2 &&
        river[0].action === 'check' &&
        river[0].userId === player.user_id &&
        river[1].action === 'bet' &&
        gs.legalActions?.includes('raise')
      ) {
        const target = 3 * (river[1].amount ?? 0);
        if (
          target > 0 &&
          gs.minRaiseTo != null &&
          gs.maxRaiseTo != null &&
          target >= gs.minRaiseTo &&
          target <= gs.maxRaiseTo &&
          target < player.bet + player.stack - 0.005
        )
          return { action: 'raise', amount: Math.round(target * 100) / 100, thinkTime: 0 };
      }
      if (
        river.length === 3 &&
        river[0].action === 'check' &&
        river[1].action === 'bet' &&
        river[1].userId === player.user_id &&
        river[2].action === 'raise' &&
        Math.abs((river[2].amount ?? 0) - 3 * (river[1].amount ?? 0)) < 0.000001
      )
        return {
          action: rng() < 0.9 || !gs.legalActions?.includes('call') ? 'fold' : 'call',
          thinkTime: 0,
        };
    }
    return incrementalPressureDecision(player, gs, rng);
  },
});
/** The near-nut candidate's declared domain is an opening river bet of at most
 * half the pot before it (HorseNearNutRiverValue.ts). The shared overstab
 * population always opens the river at 0.75 pot, so in 8,640 development pairs
 * its own workload never produced one in-domain spot: the candidate was
 * evaluated at every heads-up boat facing a bet and refused each on size. This
 * near-nut population is identical except that the river opening bet is drawn
 * from one third, 0.45 and 0.75 pot, keeping out-of-domain sizes as controls. */
export const NEAR_NUT_RIVER_OPEN_FRACTIONS = Object.freeze([0.33, 0.45, 0.75]);
export const NEAR_NUT_RIVER_POPULATION: Plo4AblationPopulation = Object.freeze({
  id: 'near_nut_mixed_river_open_stress_v1',
  decide: (player: SeatPlayer, gs: HorseGameStateV2, rng: () => number) =>
    incrementalPressureDecision(
      player,
      gs,
      rng,
      (r) => NEAR_NUT_RIVER_OPEN_FRACTIONS[Math.min(2, Math.floor(r() * 3))]
    ),
});
export const PRESSURE_PACKAGE_FLAGS = Object.freeze([
  'comboDrawPressure',
  'v54RiverBluff',
  'riverPositionDefense',
  'riverBluffCheckRaise',
  'barrelContinuationOutlook',
] as const);
export const BARREL_CONTINUATION_POPULATION: Plo4AblationPopulation = Object.freeze({
  id: 'barrel_continuation_overstab_stress_v1',
  decide: incrementalPressureDecision,
});
export const PRESSURE_PACKAGE_POPULATION: Plo4AblationPopulation = Object.freeze({
  id: 'incremental_five_flag_pressure_package_stress_v1',
  decide: INCREMENTAL_CHECKRAISE_POPULATION.decide,
});
export const ADDITIONAL_DEVELOPMENT_SEEDS = Object.freeze([27401101, 27402203, 27403307]);
export const ADDITIONAL_RESERVED_HOLDOUT_SEEDS = Object.freeze([28401109, 28402231, 28403347]);
export const INCREMENTAL_DEVELOPMENT_DESIGN = Object.freeze({
  version: 'incremental-pressure-development-v1',
  state: 'development_only',
  promotionEligible: false,
  targets: INCREMENTAL_FLAGS,
  developmentSeeds: INCREMENTAL_DEVELOPMENT_SEEDS,
  reservedHoldoutSeeds: INCREMENTAL_RESERVED_HOLDOUT_SEEDS,
  warmSeed: INCREMENTAL_WARM_SEED,
  population: INCREMENTAL_PRESSURE_POPULATION.id,
  checkRaisePopulation: INCREMENTAL_CHECKRAISE_POPULATION.id,
  warmPublicHands: 48,
  pilotPairsPerProfile: 576,
  rotationBlock: 576,
  contrasts: 'One flag true versus false on the same current brain; all other options identical',
  coverage:
    'Report actual original conditional opportunities and accepted hero action contrasts; zero is inconclusive',
  excluded: [
    'heldout_deals',
    'activation',
    'human_market_profitability',
    'tournament',
    'bomb_multiboard',
    'other_stakes',
  ],
});
export function incrementalDevelopmentDesign(target: IncrementalTarget) {
  if (isSeparateRiverTarget(target))
    return {
      ...INCREMENTAL_DEVELOPMENT_DESIGN,
      ...SEPARATE_RIVER_DESIGNS[target],
      targets: { [target]: SEPARATE_RIVER_FLAGS[target] },
      population:
        target === 'multiway_river_bluff_checkraise'
          ? MULTIWAY_RIVER_POPULATION.id
          : NEAR_NUT_RIVER_POPULATION.id,
      contrasts:
        target === 'multiway_river_bluff_checkraise'
          ? 'riverBluffCheckRaise held true in both arms; only multiwayRiverBluffCheckRaise differs'
          : 'Only smallPotNearNutRiverValue differs; NLH unsupported',
    };
  if (target !== 'pressure_package' && target !== 'barrel_continuation_outlook')
    return INCREMENTAL_DEVELOPMENT_DESIGN;
  return {
    ...INCREMENTAL_DEVELOPMENT_DESIGN,
    version:
      target === 'pressure_package'
        ? 'five-flag-pressure-package-development-v1'
        : 'barrel-continuation-development-v1',
    developmentSeeds: ADDITIONAL_DEVELOPMENT_SEEDS,
    reservedHoldoutSeeds: ADDITIONAL_RESERVED_HOLDOUT_SEEDS,
    warmSeed: 27407777,
    population:
      target === 'pressure_package'
        ? PRESSURE_PACKAGE_POPULATION.id
        : BARREL_CONTINUATION_POPULATION.id,
    contrasts:
      target === 'pressure_package'
        ? 'Exactly all five flags true versus all five false; current brain otherwise identical'
        : 'Only barrelContinuationOutlook true versus false',
  };
}
export function incrementalHistoryVersion(target?: IncrementalTarget) {
  if (target === 'small_pot_near_nut_value_raise')
    return `${target}-physical-public-node-warm-v3-${NEAR_NUT_WARM_PUBLIC_HANDS}`;
  if (isSeparateRiverTarget(target)) return `${target}-physical-public-node-warm-v1`;
  return target === 'pressure_package'
    ? 'five-flag-pressure-package-warm-v1'
    : target === 'barrel_continuation_outlook'
      ? 'barrel-continuation-warm-v1'
      : target === 'river_bluff_checkraise'
        ? 'incremental-public-triple-checkraise-warm-v1'
        : INCREMENTAL_HISTORY_VERSION;
}
export function incrementalDevelopmentProfiles(
  target: IncrementalTarget,
  variant: 'nlh' | 'plo4' | 'plo5' | 'plo6'
) {
  if (!isIncrementalTarget(target)) throw new Error('Unknown incremental development target');
  if (target === 'small_pot_near_nut_value_raise' && variant === 'nlh')
    throw Error('Near-nut Omaha only');
  return pressureDevelopmentProfiles(variant)
    .filter(
      (p) => target !== 'multiway_river_bluff_checkraise' || (p.seats > 2 && p.stackBB === 100)
    )
    .map((p) => ({
      ...p,
      id: p.id.replace(/^v53-/, target + '-'),
    }));
}
export function incrementalDevelopmentSpec(
  target: IncrementalTarget,
  variant: 'nlh' | 'plo4' | 'plo5' | 'plo6',
  profileId: string,
  brain: Plo4AblationBrain
): FeatureAblationSpec {
  const profile = incrementalDevelopmentProfiles(target, variant).find((p) => p.id === profileId);
  if (!profile || !brain.id) throw new Error('Undeclared incremental profile/brain');
  const packageArm = (value: boolean) =>
    Object.fromEntries(PRESSURE_PACKAGE_FLAGS.map((flag) => [flag, value]));
  const candidate =
    target === 'pressure_package'
      ? packageArm(true)
      : target === 'multiway_river_bluff_checkraise'
        ? { riverBluffCheckRaise: true, multiwayRiverBluffCheckRaise: true }
        : {
            [isSeparateRiverTarget(target)
              ? SEPARATE_RIVER_FLAGS[target]
              : INCREMENTAL_FLAGS[target]]: true,
          };
  const reference =
    target === 'pressure_package'
      ? packageArm(false)
      : target === 'multiway_river_bluff_checkraise'
        ? { riverBluffCheckRaise: true, multiwayRiverBluffCheckRaise: false }
        : {
            [isSeparateRiverTarget(target)
              ? SEPARATE_RIVER_FLAGS[target]
              : INCREMENTAL_FLAGS[target]]: false,
          };
  return {
    id: `${target}-development-v1`,
    profile,
    brain,
    candidate,
    reference,
    population:
      target === 'multiway_river_bluff_checkraise'
        ? MULTIWAY_RIVER_POPULATION
        : target === 'pressure_package'
          ? PRESSURE_PACKAGE_POPULATION
          : target === 'barrel_continuation_outlook'
            ? BARREL_CONTINUATION_POPULATION
            : target === 'river_bluff_checkraise'
              ? INCREMENTAL_CHECKRAISE_POPULATION
              : target === 'small_pot_near_nut_value_raise'
                ? NEAR_NUT_RIVER_POPULATION
                : INCREMENTAL_PRESSURE_POPULATION,
  };
}
/** Near-nut warm hands retain their public river nodes. Measured on the declared
 * PLO4/5/6 development profiles, 48 of them serialize to about 272 KB at four dealt
 * and 367 KB at six dealt, over the original 256 KiB public-history window, so the
 * original worker validator refused every multiway near-nut pilot before a pair
 * was dealt. 32 is the largest uniform count whose six-dealt history fits with
 * margin (about 240 KB). Multiway check-raise histories fit at 48 and are unchanged. */
export const NEAR_NUT_WARM_PUBLIC_HANDS = 32;
export function buildIncrementalWarmRecords(
  variant: 'nlh' | 'plo4' | 'plo5' | 'plo6',
  seats: number,
  target?: IncrementalTarget
) {
  if (isSeparateRiverTarget(target)) assertSeparateRiverSeedSeparation();
  return buildFeatureWarmRecords({
    variant,
    seats,
    seed: target ? incrementalDevelopmentDesign(target).warmSeed : INCREMENTAL_WARM_SEED,
    hands: target === 'small_pot_near_nut_value_raise' ? NEAR_NUT_WARM_PUBLIC_HANDS : 48,
    historyVersion: incrementalHistoryVersion(target),
    retainPublicNodes: isSeparateRiverTarget(target),
    population:
      target === 'multiway_river_bluff_checkraise'
        ? MULTIWAY_RIVER_POPULATION
        : target === 'pressure_package'
          ? PRESSURE_PACKAGE_POPULATION
          : target === 'barrel_continuation_outlook'
            ? BARREL_CONTINUATION_POPULATION
            : target === 'river_bluff_checkraise'
              ? INCREMENTAL_CHECKRAISE_POPULATION
              : target === 'small_pot_near_nut_value_raise'
                ? NEAR_NUT_RIVER_POPULATION
                : INCREMENTAL_PRESSURE_POPULATION,
  });
}
export function incrementalWarmCoverage(records: readonly FeatureAblationWarmHand[]) {
  const checkRaiseResponsesByPlayer: Record<string, { opportunities: number; folds: number }> = {};
  for (const hand of records)
    for (const [id, delta] of riverTripleCheckRaiseIncrements(hand.actions, hand.playersDealt)) {
      const row = (checkRaiseResponsesByPlayer[id] ??= { opportunities: 0, folds: 0 });
      row.opportunities += delta.opportunities;
      row.folds += delta.folds;
    }
  const byPlayer: Record<string, { opportunities: number; bets: number; lower99: number }> = {};
  for (const hand of records)
    for (const [id, delta] of riverPositionIncrements(hand.actions, hand.playersDealt)) {
      const row = (byPlayer[id] ??= { opportunities: 0, bets: 0, lower99: 0 });
      row.opportunities += delta.opportunities;
      row.bets += delta.bets;
    }
  const z2 = 2.326347874 ** 2;
  for (const row of Object.values(byPlayer)) {
    const n = row.opportunities,
      p = row.bets / n;
    row.lower99 =
      (p + z2 / (2 * n) - Math.sqrt(z2 * ((p * (1 - p)) / n + z2 / (4 * n * n)))) / (1 + z2 / n);
  }
  return {
    publicHands: records.length,
    checkRaiseResponsesByPlayer,
    byPlayer,
    opportunityDenominator: 'actual_original_last_to_act_river_actions',
    promotionEligible: false,
  };
}

/** A declared synthetic stress population. Original seats first enter, then all
 * but the first two public seats fold on the flop. No hole cards are consulted.
 * River checks and bets both remain observable; this is not human calibration. */
export const MULTIWAY_RIVER_POPULATION: Plo4AblationPopulation = Object.freeze({
  id: 'multiway_original_fold_to_hu_public_stress_v1',
  decide(player: SeatPlayer, gs: HorseGameStateV2, rng: () => number): HorseDecision {
    const seats = gs.players.map((p) => p.seat).sort((a, b) => a - b);
    if (gs.stage === 'flop' && !seats.slice(0, 2).includes(player.seat))
      return { action: 'fold', thinkTime: 0 };
    return INCREMENTAL_CHECKRAISE_POPULATION.decide(player, gs, rng);
  },
});

/** Run before physical warm/evaluation execution, never after observing outcomes. */
export function assertSeparateRiverSeedSeparation(): void {
  const oldReserved = [
    ...INCREMENTAL_RESERVED_HOLDOUT_SEEDS,
    ...ADDITIONAL_RESERVED_HOLDOUT_SEEDS,
    ...V53_PRESSURE_RESERVED_HOLDOUT_SEEDS,
    ...PLO6_V24_DEVELOPMENT_DESIGN.reservedHeldoutSeeds,
    53901101,
    53902203,
    53903307,
  ];
  const all = Object.values(SEPARATE_RIVER_DESIGNS).flatMap((d) => [
    ...d.developmentSeeds,
    d.warmSeed,
    ...d.reservedHoldoutSeeds,
  ]);
  if (
    new Set(all).size !== all.length ||
    all.some(
      (seed) =>
        isPlo4HoldoutSeed(seed) ||
        isOmahaVariantHoldoutSeed(seed) ||
        isRemainingVariantHoldoutSeed(seed) ||
        isJointHoldoutSeed(seed) ||
        oldReserved.includes(seed)
    )
  )
    throw Error('Separate river seed collides with an existing reserved family');
}
