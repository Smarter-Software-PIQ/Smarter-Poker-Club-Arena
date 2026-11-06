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
