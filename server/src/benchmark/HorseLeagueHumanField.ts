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
/**
 * THE HEADS-UP TIGHT BIG BLINDS (2026-11-15, D6, huSmallBlindStealsVsTightBigBlind).
 * Every heads-up persona above defends its big blind wide; none folds it, so a
 * small blind that never steals from a nit could not be seen. Each is the
 * calibrated NLH profile (not the wide one) with its preflop entry replaced:
 *  - hu_nit_big_blind_v1: a heads-up nit. First in it raises the top 10% and
 *    never limps; facing a raise it continues with the top 9% (calls 8%,
 *    re-raises the top 1%), so it folds its big blind about 91% of the time;
 *    over a limp it raises 3% of big blinds.
 *  - hu_fold_sb_defend_bb_v1: the case the steal's fold-share estimate is built
 *    for: it opens only the top 3% of small blinds but defends 45% of big
 *    blinds (re-raises 8%), so its VPIP looks tight while its big blind does
 *    not fold. A steal that misreads it as a folder pays here.
 * Postflop nodes keep the calibrated cutoffs. Development personas, not
 * calibrated populations. Heads-up NLH only.
 */
export const HU_NIT_BIG_BLIND_PERSONA = 'hu_nit_big_blind_v1' as const;
export const HU_FOLD_SB_DEFEND_BB_PERSONA = 'hu_fold_sb_defend_bb_v1' as const;
/**
 * THE OMAHA TIGHT FIELD (2026-11-13, the omahaTightOpponent evaluation). The
 * Omaha development field's own profile (HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID)
 * with its preflop entry pushed to a proven nit: first in it raises the top 2%
 * of hands and limps the next 0.5%, facing a raise it re-raises the top 1% and
 * calls the next 2%, and over a limp it raises 2% of big blinds (calibrated:
 * fold < 0.63 / raise >= 0.72 first in, < 0.63 / >= 0.83 facing a raise, 25%
 * free raises). Postflop nodes keep the calibrated cutoffs. It exists so a
 * Horse can meet players whose public history PROVES tight preflop play at
 * six-handed tables, where the Horse envelope's low edge is very low; a
 * development persona, not a calibrated population. Omaha development field
 * only (HorseLeague refuses it anywhere else).
 */
export const OMAHA_TIGHT_FIELD_PERSONA = 'omaha_tight_field_v1' as const;
/**
 * THE SCRIPTED FIXED-LIMIT FIELD (2026-11-20, docs/horse-league-fixed-limit.md
 * section 1). No population is calibrated for fixed limit, and a Horse mirror
 * almost never moves the fixed-limit options built for opponents unlike
 * Horses. This field seats scripted players instead, each a pure function of
 * its own cards and the public state (FixedLimitScriptedField.ts), offered the
 * controller's own fixed-limit menu (LeagueDecisionState.leagueActionState)
 * and validated like a Horse. Fixed-limit hold'em only; the league refuses
 * any other variant for it, and refuses a fixed-limit hand for every other
 * field. Personas (LeagueMatchup.humanPersona):
 *  - flh_maniac_v1: bets or raises whenever a wager is legal, otherwise calls,
 *    never folds (the lane's "sustained maniac (every hand, every bet)").
 *  - flh_tight_value_v1: the value-only player the lane used as the harm
 *    control: tight preflop entry, bets and raises only made hands, never
 *    bluffs. Its thresholds are stated in FixedLimitScriptedField.ts with
 *    their sources, and the ones no record gives are labelled design values.
 *  - flh_passive_caller_v1 (2026-11-21): the calling station of
 *    ExploiterLeague.ts (calls wide preflop, never folds after the flop, bets
 *    only strong hands, rarely raises), with its equity bars replaced by made
 *    classes (design values) so the script stays a pure function.
 *  - flh_over_folding_blinds_v1 (2026-11-21): never raises; enters and
 *    defends on the tight-value bars (a six-max blind folds to one raise 82%
 *    of the time) and after the flop checks or folds to every wager (design
 *    value: the extreme over-folder).
 *  - flh_value_only_blinds_v1 (2026-11-21, steal harm control): the
 *    tight-value preflop (raise or fold), and after the flop it continues
 *    only with two pair or better (raising it) and folds everything else to a
 *    wager (design value). Folds postflop often, but its preflop entries and
 *    re-raises are value only.
 *  - flh_preflop_defending_blinds_v1 (2026-11-21, steal harm control): never
 *    raises; defends a single raise at the published blind defence widths
 *    (80% six-max, 88% heads-up) and after the flop checks or folds to every
 *    wager (design value).
 *  - flh_defending_postflop_blinds_v1 (2026-11-21, steal harm control): same
 *    never-raise preflop defence as flh_preflop_defending_blinds_v1 (80%
 *    six-max, 88% heads-up), and after the flop continues with top pair or
 *    better (bets/raises two pair+, calls one wager with top pair/overpair,
 *    folds weaker pairs and air; design value).
 * Development personas, not calibrated populations.
 */
export const FIXED_LIMIT_SCRIPTED_POPULATION_ID = 'flh_scripted_field_v1' as const;
// 'nlh' only for the no-limit probe history a card may play into its
// sandboxes before its fixed-limit pairs (LeagueMatchup.probeHistoryHands);
// runHumanFieldMatchup refuses a scripted card that deals anything but flh.
export const FIXED_LIMIT_SCRIPTED_FIELD_VARIANTS: readonly string[] = Object.freeze(['flh', 'nlh']);
export const FLH_MANIAC_PERSONA = 'flh_maniac_v1' as const;
export const FLH_TIGHT_VALUE_PERSONA = 'flh_tight_value_v1' as const;
export const FLH_PASSIVE_CALLER_PERSONA = 'flh_passive_caller_v1' as const;
export const FLH_OVER_FOLDING_BLINDS_PERSONA = 'flh_over_folding_blinds_v1' as const;
export const FLH_VALUE_ONLY_BLINDS_PERSONA = 'flh_value_only_blinds_v1' as const;
export const FLH_PREFLOP_DEFENDING_BLINDS_PERSONA = 'flh_preflop_defending_blinds_v1' as const;
export const FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA = 'flh_defending_postflop_blinds_v1' as const;
export type FixedLimitScriptedPersona =
  | typeof FLH_MANIAC_PERSONA
  | typeof FLH_TIGHT_VALUE_PERSONA
  | typeof FLH_PASSIVE_CALLER_PERSONA
  | typeof FLH_OVER_FOLDING_BLINDS_PERSONA
  | typeof FLH_VALUE_ONLY_BLINDS_PERSONA
  | typeof FLH_PREFLOP_DEFENDING_BLINDS_PERSONA
  | typeof FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA;
export const FIXED_LIMIT_SCRIPTED_PERSONAS: readonly FixedLimitScriptedPersona[] = Object.freeze([
  FLH_MANIAC_PERSONA,
  FLH_TIGHT_VALUE_PERSONA,
  FLH_PASSIVE_CALLER_PERSONA,
  FLH_OVER_FOLDING_BLINDS_PERSONA,
  FLH_VALUE_ONLY_BLINDS_PERSONA,
  FLH_PREFLOP_DEFENDING_BLINDS_PERSONA,
  FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA,
]);
/**
 * THE SCRIPTED NO-LIMIT FIELD (2026-11-21, Hold'em Strategy lane). Two
 * default-off hold'em options (holdemCommittedNoPairIsPriced and
 * holdemDangerBoardEquityIsPriced) are priced for opponents a Horse mirror
 * barely plays: their mirror cards diverged on 20 to 132 of 6,000 pairs per
 * seed and never resolved. This field seats scripted no-limit players instead,
 * each a pure function of its own cards and the public state
 * (NlhScriptedField.ts), offered the same legal no-limit menu a calibrated seat
 * gets and validated like a Horse. No-limit hold'em only. Personas
 * (LeagueMatchup.humanPersona):
 *  - nlh_pot_barreler_v1: enters wide and bets the pot on every street with
 *    any two cards; dealt 40bb deep, a Horse that floats its flop bet faces a
 *    turn pot bet at a stack-to-pot ratio near 1 (the committed branch).
 *  - nlh_value_barreler_v1: its harm control: the same entry and depth, but it
 *    bets only two pair or better and never bluffs, so its bets are strong.
 *  - nlh_danger_board_bettor_v1: enters wide and never folds before the
 *    river, then on a four-flush or four-straight turn or river bets half the
 *    pot with a straight or better (value) and with no pair (bluff), and
 *    checks everything between.
 *  - nlh_danger_board_value_v1: its harm control: the same, value only.
 *  - nlh_nash_open_jammer_v1 (2026-11-21, nashCallVsJam): short-stack (<=20bb)
 *    open-jammer using the HorseNashPushFoldV2 chip-EV equilibrium jam and
 *    call thresholds (deterministic cutoff, design value) across UTG/HJ/CO/BTN/SB
 *    in cash and BBA MTT so nashCallVsJam acts against a non-mirror field.
 *  - nlh_tight_jammer_v1 (2026-11-21, nashCallVsJam harm control): short-stack
 *    open-jammer that open-jams and continues only with the top ~9% of hands
 *    (calibrated preflop percentile >= 0.91, design value) at <=20bb.
 * Development personas, not calibrated populations.
 */
export const NLH_SCRIPTED_POPULATION_ID = 'nlh_scripted_field_v1' as const;
export const NLH_SCRIPTED_FIELD_VARIANTS: readonly string[] = Object.freeze(['nlh']);
export const NLH_POT_BARRELER_PERSONA = 'nlh_pot_barreler_v1' as const;
export const NLH_VALUE_BARRELER_PERSONA = 'nlh_value_barreler_v1' as const;
export const NLH_DANGER_BOARD_BETTOR_PERSONA = 'nlh_danger_board_bettor_v1' as const;
export const NLH_DANGER_BOARD_VALUE_PERSONA = 'nlh_danger_board_value_v1' as const;
export const NLH_NASH_OPEN_JAMMER_PERSONA = 'nlh_nash_open_jammer_v1' as const;
export const NLH_TIGHT_JAMMER_PERSONA = 'nlh_tight_jammer_v1' as const;
export type NlhScriptedPersona =
  | typeof NLH_POT_BARRELER_PERSONA
  | typeof NLH_VALUE_BARRELER_PERSONA
  | typeof NLH_DANGER_BOARD_BETTOR_PERSONA
  | typeof NLH_DANGER_BOARD_VALUE_PERSONA
  | typeof NLH_NASH_OPEN_JAMMER_PERSONA
  | typeof NLH_TIGHT_JAMMER_PERSONA;
export const NLH_SCRIPTED_PERSONAS: readonly NlhScriptedPersona[] = Object.freeze([
  NLH_POT_BARRELER_PERSONA,
  NLH_VALUE_BARRELER_PERSONA,
  NLH_DANGER_BOARD_BETTOR_PERSONA,
  NLH_DANGER_BOARD_VALUE_PERSONA,
  NLH_NASH_OPEN_JAMMER_PERSONA,
  NLH_TIGHT_JAMMER_PERSONA,
]);
/**
 * THE SCRIPTED FIXED-LIMIT OMAHA HI-LO FIELD (2026-11-21, Flo8ScriptedField.ts).
 *
 * Pure deterministic fixed-limit Omaha hi-lo (flo8) seat policies seated
 * through the league's human-field mechanism for fixedLimitHiLoLowHalfFloor,
 * fixedLimitHiLoNutLowRiverBet, and fixedLimitOmahaNoPresumption. Restricted
 * to flo8 only; FIXED_LIMIT_SCRIPTED_POPULATION_ID stays flh-only.
 */
export const FLO8_SCRIPTED_POPULATION_ID = 'flo8_scripted_field_v1' as const;
export const FLO8_SCRIPTED_FIELD_VARIANTS: readonly string[] = Object.freeze(['flo8']);
export const FLO8_HIGH_BARRELER_PERSONA = 'flo8_high_barreler_v1' as const;
export const FLO8_MANIAC_PERSONA = 'flo8_maniac_v1' as const;
export const FLO8_TIGHT_VALUE_PERSONA = 'flo8_tight_value_v1' as const;
export const FLO8_RIVER_FOLDER_PERSONA = 'flo8_river_folder_v1' as const;
export const FLO8_PASSIVE_CALLER_PERSONA = 'flo8_passive_caller_v1' as const;
export type Flo8ScriptedPersona =
  | typeof FLO8_HIGH_BARRELER_PERSONA
  | typeof FLO8_MANIAC_PERSONA
  | typeof FLO8_TIGHT_VALUE_PERSONA
  | typeof FLO8_RIVER_FOLDER_PERSONA
  | typeof FLO8_PASSIVE_CALLER_PERSONA;
export const FLO8_SCRIPTED_PERSONAS: readonly Flo8ScriptedPersona[] = Object.freeze([
  FLO8_HIGH_BARRELER_PERSONA,
  FLO8_MANIAC_PERSONA,
  FLO8_TIGHT_VALUE_PERSONA,
  FLO8_RIVER_FOLDER_PERSONA,
  FLO8_PASSIVE_CALLER_PERSONA,
]);
/**
 * THE SCRIPTED PLO8 HEADS-UP FIELD (2026-11-21, Heads Up lane). No population
 * is calibrated for pot-limit Omaha hi-lo (HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID
 * covers plo4/plo5/plo6 only), so omahaHiLoTournamentFirstIn had only a Horse
 * mirror card. This field seats scripted PLO8 heads-up players instead, each a
 * pure function of its own cards and the public state (Plo8HuScriptedField.ts),
 * offered the same pot-limit legal menu a Horse gets and validated like a Horse.
 * PLO8 heads-up only. Personas (LeagueMatchup.humanPersona):
 *  - plo8_hu_rec_caller_v1: short-stack recreational caller/defender (wide SB
 *    entry with limps and pot opens, wide 70% BB defence, sticky postflop with
 *    any pair, made low or low draw).
 *  - plo8_hu_tight_blind_v1: short-stack tight-blind / nit harm control (tight
 *    top 25% SB opens, tight top 25% BB defence, value-heavy postflop).
 *  - plo8_hu_aggro_3bettor_v1: aggressive short-stack 3-betting / jamming
 *    harm control (opens top 70% SB, 3-bets pot / jams top 45% BB facing a
 *    raise, pot-barrels postflop with any pair, made low or low draw).
 * Development personas, not calibrated populations.
 */
export const PLO8_HU_SCRIPTED_POPULATION_ID = 'plo8_hu_scripted_field_v1' as const;
export const PLO8_HU_SCRIPTED_FIELD_VARIANTS: readonly string[] = Object.freeze(['plo8']);
export const PLO8_HU_REC_CALLER_PERSONA = 'plo8_hu_rec_caller_v1' as const;
export const PLO8_HU_TIGHT_BLIND_PERSONA = 'plo8_hu_tight_blind_v1' as const;
export const PLO8_HU_AGGRO_3BETTOR_PERSONA = 'plo8_hu_aggro_3bettor_v1' as const;
export type Plo8HuScriptedPersona =
  | typeof PLO8_HU_REC_CALLER_PERSONA
  | typeof PLO8_HU_TIGHT_BLIND_PERSONA
  | typeof PLO8_HU_AGGRO_3BETTOR_PERSONA;
export const PLO8_HU_SCRIPTED_PERSONAS: readonly Plo8HuScriptedPersona[] = Object.freeze([
  PLO8_HU_REC_CALLER_PERSONA,
  PLO8_HU_TIGHT_BLIND_PERSONA,
  PLO8_HU_AGGRO_3BETTOR_PERSONA,
]);
/**
 * THE OMAHA VALUE-LEADER FIELD (2026-11-20, Horse SWITCH lane, task #6). The
 * Omaha development field's own profile with its POSTFLOP play pushed to the
 * player HorseOmahaReadConditional labels a value leader: checked to it bets
 * only its top hands (flop 15%, turn 14%, river 12% of holdings, no bluffs),
 * facing a bet it folds more than the calibrated field (below 0.66 / 0.70 /
 * 0.78 strength against 0.52 / 0.55 / 0.52) and raises only its best, so it
 * rarely calls a river. Preflop it enters at the calibrated rate but raises
 * only its top 7% first in (4% of big blinds over a limp), so its own raising
 * disproves the maniac presumption and the read is measured. The label
 * is earned by the read on the seat's measured play; nothing here sets it.
 * It exists because the *VsValueLeader rules (all live) act only against a
 * measured value leader and Horse self-play never produces one, so no card
 * could grade them. A development persona, not a calibrated population.
 * Omaha development field only (HorseLeague refuses it anywhere else).
 */
export const OMAHA_VALUE_LEADER_FIELD_PERSONA = 'omaha_value_leader_field_v1' as const;
export type HumanFieldPersona =
  | typeof OMAHA_TIGHT_FIELD_PERSONA
  | typeof OMAHA_VALUE_LEADER_FIELD_PERSONA
  | FixedLimitScriptedPersona
  | NlhScriptedPersona
  | Flo8ScriptedPersona
  | Plo8HuScriptedPersona
  | typeof HU_WIDE_SB_AGGRESSOR_PERSONA
  | typeof HU_MINRAISE_EVERY_BUTTON_PERSONA
  | typeof HU_LIMP_EVERY_BUTTON_PERSONA
  | typeof HU_THREE_BET_EVERY_HAND_PERSONA
  | typeof HU_SMALL_STAB_EVERY_STREET_PERSONA
  | typeof HU_NIT_BIG_BLIND_PERSONA
  | typeof HU_FOLD_SB_DEFEND_BB_PERSONA;
export const HUMAN_FIELD_PERSONAS: readonly HumanFieldPersona[] = Object.freeze([
  HU_WIDE_SB_AGGRESSOR_PERSONA,
  HU_MINRAISE_EVERY_BUTTON_PERSONA,
  HU_LIMP_EVERY_BUTTON_PERSONA,
  HU_THREE_BET_EVERY_HAND_PERSONA,
  HU_SMALL_STAB_EVERY_STREET_PERSONA,
  HU_NIT_BIG_BLIND_PERSONA,
  HU_FOLD_SB_DEFEND_BB_PERSONA,
  OMAHA_TIGHT_FIELD_PERSONA,
  OMAHA_VALUE_LEADER_FIELD_PERSONA,
  FLH_MANIAC_PERSONA,
  FLH_TIGHT_VALUE_PERSONA,
  FLH_PASSIVE_CALLER_PERSONA,
  FLH_OVER_FOLDING_BLINDS_PERSONA,
  FLH_VALUE_ONLY_BLINDS_PERSONA,
  FLH_PREFLOP_DEFENDING_BLINDS_PERSONA,
  FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA,
  NLH_POT_BARRELER_PERSONA,
  NLH_VALUE_BARRELER_PERSONA,
  NLH_DANGER_BOARD_BETTOR_PERSONA,
  NLH_DANGER_BOARD_VALUE_PERSONA,
  NLH_NASH_OPEN_JAMMER_PERSONA,
  NLH_TIGHT_JAMMER_PERSONA,
  FLO8_HIGH_BARRELER_PERSONA,
  FLO8_MANIAC_PERSONA,
  FLO8_TIGHT_VALUE_PERSONA,
  FLO8_RIVER_FOLDER_PERSONA,
  FLO8_PASSIVE_CALLER_PERSONA,
  PLO8_HU_REC_CALLER_PERSONA,
  PLO8_HU_TIGHT_BLIND_PERSONA,
  PLO8_HU_AGGRO_3BETTOR_PERSONA,
]);
