/**
 * Constants for the Horse League's human-field cards (2026-10-24), kept in a
 * module with no runtime dependencies so both the simulator (HorseLeague.ts)
 * and the compute boundary (HorseLeagueComputeWorkerClient.ts, which may only
 * TYPE-import HorseLeague, because HorseLeague imports it) share one source.
 *
 * See LeagueMatchup.opponentPopulation in HorseLeague.ts for the design.
 */

/**
 * Variants a human-field card may deal. NLH only, deliberately. The
 * human-calibrated population has an Omaha profile, but
 * docs/horse-brain-human-population-2026-10-08.md records it as missing the
 * 5-point fidelity criterion at the flop facing-bet node (5.6 points): it is
 * the one family whose fit is marked defective, so no nightly Omaha verdict is
 * built on it. The "other" profile (short deck, Pineapple, fixed limit) rests
 * on 85 human seat-hands. The NLH profile is the only one both fitted within
 * tolerance and backed by a four-figure sample (1,718 seat-hands). Every
 * family, NLH included, is still below the adequacy minimums of the winning
 * contract (humanCalibrationAdequacy), so a human-field row is a development
 * measurement, never a qualification.
 */
export const HUMAN_FIELD_VARIANTS: readonly string[] = Object.freeze(['nlh']);

/** Scenario names of the two absolute per-arm components on a human-field result. */
export const HUMAN_FIELD_COMPONENT_SCENARIOS = Object.freeze([
  'human_field_arm_a',
  'human_field_arm_b',
] as const);

/** Prefix every human-field card's name carries, so a row says what it measured. */
export const HUMAN_FIELD_NAME_PREFIX = 'human_';

/**
 * THE AGGRESSOR FIELD (2026-10-31). The second opponent population a league
 * card may seat: the versioned V53 adversarial workload
 * (V53PressurePopulation.ts), which raises, barrels and bluffs the way a
 * credibly aggressive player does. It exists for one question the mirror and
 * the human-calibrated field cannot ask: what V53 pressure is worth against
 * the opponent it is built for. In hold'em V53 engages only on a read
 * credibly outside the horse envelope (HorseOpponentExploit
 * pressureTargetFoldMul), so a horse mirror is unchanged by construction and
 * the calibrated field stays inside the envelope; v53_pressure dealt either
 * way measured 0 divergent pairs. NOT a calibrated human population and not a
 * market-profit estimate. NLH only here: the field's raise sizes follow the
 * no-limit legal menu this harness builds for a non-horse seat.
 */
export const V53_PRESSURE_POPULATION_ID = 'v53_pressure_stress_v1' as const;
export const V53_PRESSURE_FIELD_VARIANTS: readonly string[] = Object.freeze(['nlh']);

/**
 * THE OMAHA DEVELOPMENT FIELD (2026-11-06). The human-calibrated population's
 * own Omaha profile (the same profile row humanCalibratedProfileFor('plo4')
 * returns), offered under its own id so no card can reach it by accident.
 * It exists for one question: targeted, spot-conditioned measurement of an
 * Omaha layer self-play never reaches (V55, HorseLeagueSpotConditioned.ts).
 * The profile misses the 5-point fidelity criterion at the flop facing-bet
 * node (5.6 points, docs/horse-brain-human-population-2026-10-08.md), so a
 * result against it is a DEVELOPMENT measurement, never a promotion. The
 * nightly worker refuses it (HorseLeagueComputeWorkerClient accepts only the
 * NLH human field and the V53 field), and HUMAN_FIELD_VARIANTS stays NLH.
 * Pot-limit variants only: the field's raise menu is capped at the pot.
 */
export const HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID =
  'human-calibrated-v1-20261008-omaha-dev' as const;
export const HUMAN_CALIBRATED_OMAHA_DEV_FIELD_VARIANTS: readonly string[] = Object.freeze([
  'plo4',
  'plo5',
  'plo6',
]);

/**
 * THE HEADS-UP HUMAN PERSONA (2026-11-07). Every human-field card before this
 * one is six-max, and the calibrated NLH profile was fitted on six-max tables:
 * dealt heads-up it folds 61% of its small blinds, which no heads-up human
 * does. A heads-up flag measured only horse-vs-horse (hu_bb_defends_to_price)
 * has no human opponent to be checked against. This persona is the calibrated
 * NLH profile with the heads-up human tendencies the flag is about: the small
 * blind opens wide (80% of hands, 70% as a raise), the big blind defends and
 * three-bets light, and checked-to seats stab most flops, so a horse that
 * over-folds pays for it. Facing-bet postflop nodes keep the calibrated cutoffs
 * (the only part of the profile backed by human data at this table size). A
 * development persona, not a calibrated population: the row keeps the
 * calibrated population id and adds `humanPersona`, so it says both.
 * Heads-up NLH only (HorseLeague refuses it anywhere else).
 */
export const HU_WIDE_SB_AGGRESSOR_PERSONA = 'hu_wide_sb_aggressor_v1' as const;
/**
 * THE HEADS-UP EXPLOITERS (2026-11-12, HU-NLH-001). The wide small blind opens
 * about 2.5bb to 3.75x and stabs; it does not play the lines a real opponent
 * uses to grind a Horse heads-up, and nothing on the nightly set did, which is
 * how a heads-up big blind folding 58.7% to a min-raise at 50bb or less went
 * unseen. Each persona is the wide small blind with one exploit pushed to the
 * limit, so a card against it shows the Horse's answer to that line:
 *  - hu_minraise_every_button_v1: the small blind raises every hand first in,
 *    to 2x (the minimum).
 *  - hu_limp_every_button_v1: the small blind limps every hand first in and
 *    never raises first in.
 *  - hu_three_bet_every_hand_v1: facing a raise it re-raises every hand.
 *  - hu_small_stab_every_street_v1: checked to, it bets every street at a
 *    third of the pot.
 * Development personas, not calibrated populations. Heads-up NLH only.
 */
export const HU_MINRAISE_EVERY_BUTTON_PERSONA = 'hu_minraise_every_button_v1' as const;
export const HU_LIMP_EVERY_BUTTON_PERSONA = 'hu_limp_every_button_v1' as const;
export const HU_THREE_BET_EVERY_HAND_PERSONA = 'hu_three_bet_every_hand_v1' as const;
export const HU_SMALL_STAB_EVERY_STREET_PERSONA = 'hu_small_stab_every_street_v1' as const;
export type HumanFieldPersona =
  | typeof HU_WIDE_SB_AGGRESSOR_PERSONA
  | typeof HU_MINRAISE_EVERY_BUTTON_PERSONA
  | typeof HU_LIMP_EVERY_BUTTON_PERSONA
  | typeof HU_THREE_BET_EVERY_HAND_PERSONA
  | typeof HU_SMALL_STAB_EVERY_STREET_PERSONA;
export const HUMAN_FIELD_PERSONAS: readonly HumanFieldPersona[] = Object.freeze([
  HU_WIDE_SB_AGGRESSOR_PERSONA,
  HU_MINRAISE_EVERY_BUTTON_PERSONA,
  HU_LIMP_EVERY_BUTTON_PERSONA,
  HU_THREE_BET_EVERY_HAND_PERSONA,
  HU_SMALL_STAB_EVERY_STREET_PERSONA,
]);
