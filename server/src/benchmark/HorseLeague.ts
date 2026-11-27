/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * HORSE LEAGUE — Nightly Duplicate-Deal Self-Play (V12 — 2026-08-22)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Dan: "constantly improving and optimizing their play." Improvements must be
 * MEASURED, not argued. The engine's layers were historically tuned with
 * ad-hoc duplicate-deal ablations run by hand; this module makes that a
 * permanent instrument:
 *
 *  - DUPLICATE DEALS: config A and config B play the exact same cards twice,
 *    with the seat assignments swapped between passes, so card luck cancels
 *    and the remaining chip difference is pure strategy.
 *  - LIGHTWEIGHT TABLE: a self-contained NLH hand loop (blinds, streets,
 *    betting, side pots, showdown) driving HorseLogic.decide directly — no
 *    timers, no DB, no sockets. Thousands of hands per second of CPU.
 *  - NIGHTLY RUN: a bounded league fires at 04:30 UTC on the engine host and
 *    writes bb/100 per matchup to horse_league_results. A regression in any
 *    strategy layer shows up as a sign flip within days, with a standard
 *    error attached so noise cannot be mistaken for signal.
 *
 * The simulator trusts HorseLogic's own legalization (every decision is
 * validated against the same rules the real engine enforces) and uses
 * synthetic `league-*` user ids so HorseMind's live opponent memory is never
 * polluted with reads about real players.
 *
 * NEVER refer to the horses as "bots" — they are HORSES only.
 */

import {
  HorseLeagueComputeWorkerClient,
  type HorseLeagueCompute,
} from './HorseLeagueComputeWorkerClient.js';
import type {
  AcceptedActionOrigin,
  Card,
  Pot,
  SeatPlayer,
  HandStage,
  ActionRecord,
  HorseStyle,
} from '../types.js';
import { plo4StrengthSeatStyle } from './Plo4StrengthContract.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import {
  HorseLogic,
  type HorseDecideOpts,
  type HorseGameStateV2,
  type HorseProfileMods,
} from '../engine/HorseLogic.js';
import { HorseMind, readScopeOf, type HorseMindSandbox } from '../engine/HorseMind.js';
import { seedHorseTimingRandom } from '../engine/horsePublicActionTime.js';
import { seedHorseBetSizeRandom } from '../engine/horsePublicBetSize.js';
import {
  seedFastRandom,
  saveFastRandom,
  restoreFastRandom,
  fastRandom,
  scoreHoldem,
  scoreOmahaHi,
  variantInfo,
} from '../engine/HorseEval.js';
import { buildTournamentMState } from '../engine/HorseTournamentPreflop.js';

// V16 DEEP-READS HARNESS: hand-category names matching the engine's showdown
// vocabulary, so sandboxed league play can feed observeHandComplete and the
// v16_deep_reads matchup measures a layer that otherwise only learns in
// production.
const CAT_NAMES = [
  '',
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
  'Royal Flush',
];
import {
  SUITS,
  RANKS,
  validateAction,
  calculateBettingState,
  determineWinners,
} from '../engine/PokerEngine.js';
import {
  HUMAN_CALIBRATED_POPULATION_ID,
  humanCalibratedDecide,
  humanCalibratedProfileFor,
  type HumanCalibratedProfile,
  type HumanCalibratedSpot,
} from './HumanCalibratedPopulation.js';
import {
  HUMAN_FIELD_COMPONENT_SCENARIOS,
  HUMAN_FIELD_NAME_PREFIX,
  HUMAN_FIELD_VARIANTS,
  HUMAN_CALIBRATED_OMAHA_DEV_FIELD_VARIANTS,
  HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
  V53_PRESSURE_FIELD_VARIANTS,
  V53_PRESSURE_POPULATION_ID,
  HU_WIDE_SB_AGGRESSOR_PERSONA,
  HU_MINRAISE_EVERY_BUTTON_PERSONA,
  HU_LIMP_EVERY_BUTTON_PERSONA,
  HU_THREE_BET_EVERY_HAND_PERSONA,
  HU_SMALL_STAB_EVERY_STREET_PERSONA,
  HU_NIT_BIG_BLIND_PERSONA,
  HU_FOLD_SB_DEFEND_BB_PERSONA,
  OMAHA_TIGHT_FIELD_PERSONA,
  OMAHA_VALUE_LEADER_FIELD_PERSONA,
  HUMAN_FIELD_PERSONAS,
  FIXED_LIMIT_SCRIPTED_POPULATION_ID,
  FIXED_LIMIT_SCRIPTED_FIELD_VARIANTS,
  FIXED_LIMIT_SCRIPTED_PERSONAS,
  FLH_MANIAC_PERSONA,
  FLH_TIGHT_VALUE_PERSONA,
  FLH_PASSIVE_CALLER_PERSONA,
  FLH_OVER_FOLDING_BLINDS_PERSONA,
  FLH_VALUE_ONLY_BLINDS_PERSONA,
  FLH_PREFLOP_DEFENDING_BLINDS_PERSONA,
  FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA,
  NLH_SCRIPTED_POPULATION_ID,
  NLH_SCRIPTED_FIELD_VARIANTS,
  NLH_SCRIPTED_PERSONAS,
  NLH_POT_BARRELER_PERSONA,
  NLH_VALUE_BARRELER_PERSONA,
  NLH_DANGER_BOARD_BETTOR_PERSONA,
  NLH_DANGER_BOARD_VALUE_PERSONA,
  NLH_NASH_OPEN_JAMMER_PERSONA,
  NLH_TIGHT_JAMMER_PERSONA,
  FLO8_SCRIPTED_POPULATION_ID,
  FLO8_SCRIPTED_FIELD_VARIANTS,
  FLO8_SCRIPTED_PERSONAS,
  FLO8_HIGH_BARRELER_PERSONA,
  FLO8_MANIAC_PERSONA,
  FLO8_TIGHT_VALUE_PERSONA,
  FLO8_RIVER_FOLDER_PERSONA,
  FLO8_PASSIVE_CALLER_PERSONA,
  PLO8_HU_SCRIPTED_POPULATION_ID,
  PLO8_HU_SCRIPTED_FIELD_VARIANTS,
  PLO8_HU_SCRIPTED_PERSONAS,
  PLO8_HU_REC_CALLER_PERSONA,
  PLO8_HU_TIGHT_BLIND_PERSONA,
  PLO8_HU_AGGRO_3BETTOR_PERSONA,
  type FixedLimitScriptedPersona,
  type Flo8ScriptedPersona,
  type HumanFieldPersona,
  type NlhScriptedPersona,
  type Plo8HuScriptedPersona,
} from './HorseLeagueHumanField.js';
import { NLH_SCRIPTED_COMMITTED_STACK_BB, nlhScriptedPolicy } from './NlhScriptedField.js';
import { flo8ScriptedPolicy } from './Flo8ScriptedField.js';
import { PLO8_HU_SCRIPTED_STACK_BB, plo8HuScriptedPolicy } from './Plo8HuScriptedField.js';
import {
  fixedLimitScriptedNode,
  fixedLimitScriptedPolicy,
  nlhProbeWarmupPolicy,
} from './FixedLimitScriptedField.js';
import { leagueLearnStreetRead } from './HorseLeagueStreetRead.js';
import {
  leagueSpotProbe,
  leagueSpotSelectionRecord,
  selectLeagueSpotDeals,
  type LeagueSpotPassObservation,
  type LeagueSpotProbeHand,
  type LeagueSpotSelection,
  type LeagueSpotSelectionRecord,
} from './HorseLeagueSpotSelection.js';
import { pressureOpponentDecision } from './V53PressurePopulation.js';
import {
  leagueActionState,
  leagueDealsFixedLimit,
  leagueFixedLimitBounds,
  leagueFixedLimitRefusal,
  leagueHorseDecisionInput,
} from './LeagueDecisionState.js';
import {
  bettingStructureFor,
  fixedLimitBetSize,
  substituteOnCappedStreet,
} from '../engine/BettingStructure.js';

export {
  HUMAN_FIELD_COMPONENT_SCENARIOS,
  HUMAN_FIELD_NAME_PREFIX,
  HUMAN_FIELD_VARIANTS,
  HUMAN_CALIBRATED_OMAHA_DEV_FIELD_VARIANTS,
  HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
  V53_PRESSURE_FIELD_VARIANTS,
  V53_PRESSURE_POPULATION_ID,
  HU_WIDE_SB_AGGRESSOR_PERSONA,
  HU_MINRAISE_EVERY_BUTTON_PERSONA,
  HU_LIMP_EVERY_BUTTON_PERSONA,
  HU_THREE_BET_EVERY_HAND_PERSONA,
  HU_SMALL_STAB_EVERY_STREET_PERSONA,
  HU_NIT_BIG_BLIND_PERSONA,
  HU_FOLD_SB_DEFEND_BB_PERSONA,
  OMAHA_TIGHT_FIELD_PERSONA,
  OMAHA_VALUE_LEADER_FIELD_PERSONA,
  HUMAN_FIELD_PERSONAS,
  FIXED_LIMIT_SCRIPTED_POPULATION_ID,
  FIXED_LIMIT_SCRIPTED_FIELD_VARIANTS,
  FIXED_LIMIT_SCRIPTED_PERSONAS,
  FLH_MANIAC_PERSONA,
  FLH_TIGHT_VALUE_PERSONA,
  FLH_PASSIVE_CALLER_PERSONA,
  FLH_OVER_FOLDING_BLINDS_PERSONA,
  FLH_VALUE_ONLY_BLINDS_PERSONA,
  FLH_PREFLOP_DEFENDING_BLINDS_PERSONA,
  FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA,
  FLO8_SCRIPTED_POPULATION_ID,
  FLO8_SCRIPTED_FIELD_VARIANTS,
  FLO8_SCRIPTED_PERSONAS,
  FLO8_HIGH_BARRELER_PERSONA,
  FLO8_MANIAC_PERSONA,
  FLO8_TIGHT_VALUE_PERSONA,
  FLO8_RIVER_FOLDER_PERSONA,
  FLO8_PASSIVE_CALLER_PERSONA,
  type FixedLimitScriptedPersona,
  type Flo8ScriptedPersona,
  type HumanFieldPersona,
} from './HorseLeagueHumanField.js';

/** The opponent fields a league card may seat around one hero horse (see
 *  LeagueMatchup.opponentPopulation). */
export type LeagueOpponentPopulation =
  | typeof HUMAN_CALIBRATED_POPULATION_ID
  | typeof V53_PRESSURE_POPULATION_ID
  | typeof HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID
  | typeof FIXED_LIMIT_SCRIPTED_POPULATION_ID
  | typeof NLH_SCRIPTED_POPULATION_ID
  | typeof FLO8_SCRIPTED_POPULATION_ID
  | typeof PLO8_HU_SCRIPTED_POPULATION_ID;

/** Variants each field may be dealt, or null for an unknown field. */
export function leagueFieldVariants(population: unknown): readonly string[] | null {
  if (population === HUMAN_CALIBRATED_POPULATION_ID) return HUMAN_FIELD_VARIANTS;
  if (population === V53_PRESSURE_POPULATION_ID) return V53_PRESSURE_FIELD_VARIANTS;
  if (population === HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID)
    return HUMAN_CALIBRATED_OMAHA_DEV_FIELD_VARIANTS;
  if (population === FIXED_LIMIT_SCRIPTED_POPULATION_ID) return FIXED_LIMIT_SCRIPTED_FIELD_VARIANTS;
  if (population === NLH_SCRIPTED_POPULATION_ID) return NLH_SCRIPTED_FIELD_VARIANTS;
  if (population === FLO8_SCRIPTED_POPULATION_ID) return FLO8_SCRIPTED_FIELD_VARIANTS;
  if (population === PLO8_HU_SCRIPTED_POPULATION_ID) return PLO8_HU_SCRIPTED_FIELD_VARIANTS;
  return null;
}
import { supabase } from '../services/supabase.js';
import { reportError } from '../services/errorReporter.js';
import {
  liveHorseDecisionWorkerStatus,
  type LiveHorseDecisionLaneStatus,
} from '../engine/horseDecision/lane.js';

/** Per-matchup legality counters. corrected/brainFallback are optional so older callers keep compiling. */
type LeagueCounters = {
  illegal: number;
  truncated: number;
  corrected?: number;
  brainFallback?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LeagueResult {
  matchup: string;
  hands: number;
  /** chips won by config A per 100 hands, in big blinds (duplicate-adjusted) */
  bb100: number;
  /** standard error of bb100 across per-pair samples */
  stderr: number;
  durationMs: number;
  illegalActions: number;
  /** streets cut short by the action cap (must be 0; see runStreet) */
  truncatedStreets: number;
  /** Actions the harness coerced (check facing a bet, call with nothing to call, bet/raise swaps). */
  correctedActions?: number;
  /** Decisions where HorseLogic.decide caught an exception and returned its check/fold fallback. */
  brainExceptionFallbacks?: number;
  /** Candidate-policy decisions actually consumed during an offline gate. */
  candidatePolicyHits: number;
  /** Solver samples that legalization changed into a different action family. */
  candidateExecutionMismatches: number;
  /** Exact solver node roles reached by those decisions. */
  candidateNodeRoles: string[];
  /** 2026-11-06: cell_key_checksum of every distinct sealed cell those
   *  decisions executed (V31 evaluation contract v3 coverage proof). */
  candidateCells?: string[];
  /** Per-scenario evidence retained when several utility contexts are gated. */
  benchmarkComponents: LeagueBenchmarkComponent[];
  /** Duplicate pairs whose two passes settled differently (A's edge != 0).
   *  Set by runMatchup; absent on results assembled from components. */
  divergentPairs?: number;
  /** THE MATCHUP MEASURED NOTHING (2026-09-21). True when pairs were played
   *  and either none settled differently under the two configs (the arms
   *  played byte-identical poker) or the per-pair differences have zero
   *  variance. bb100 = 0.00 with stderr = 0.00 is then not "no edge", it is
   *  "no experiment". v16_deep_reads reported exactly
   *  that every night from 2026-09-13 through 2026-09-21 while the daily
   *  audit read it as a resolved zero. An inert matchup is a harness defect and is reported as
   *  one; it is never a measurement. */
  inert?: boolean;
  /** HUMAN FIELD (2026-10-24): present only on a result whose opponents were
   *  the human-calibrated population (LeagueMatchup.opponentPopulation). Then
   *  bb100/stderr are the hero horse's per-hand edge of arm A over arm B
   *  against that field, and benchmarkComponents carries each arm's own
   *  absolute bb/100 against it. Absent: the mirror (horse vs horse) card. */
  opponentPopulation?: LeagueOpponentPopulation;
  /** Human-field results only: the calibrated opponents' responses per
   *  decision node, both arms, counts only. Proof the field actually played. */
  humanResponses?: Record<string, Record<string, number>>;
  /** 2026-11-13 (HU-EVAL-006): the standard error of bb100 from contiguous
   *  blocks of pairs (blockStandardError), next to the per-pair `stderr`,
   *  whose meaning is unchanged. Absent under two blocks and on results
   *  assembled from components. */
  blockStderr?: number;
  /** The number of blocks blockStderr was computed from. */
  stderrBlocks?: number;
  /** SPOT-SEEDED (2026-11-19): present only when the matchup selected deals
   *  (LeagueMatchup.spot). The result then measures that spot, not overall
   *  win rate (HorseLeagueSpotSelection.ts). */
  spotSelection?: LeagueSpotSelectionRecord;
}

export interface LeagueBenchmarkComponent {
  scenario: string;
  hands: number;
  bb100: number;
  stderr: number;
  durationMs: number;
  illegalActions: number;
  truncatedStreets: number;
  candidatePolicyHits: number;
  candidateExecutionMismatches: number;
  candidateNodeRoles: string[];
}

export interface LeagueMatchup {
  name: string;
  /** game variant the matchup deals (default 'nlh'). V15: the plo6 matchup
   *  exists because the Omaha discipline layer cannot be measured by an NLH
   *  deal at all. */
  variant?: string;
  /** V16: seats at the table (default 6). 2 = heads-up. */
  seats?: number;
  /** V16: starting stack in big blinds (default 100). 40 exercises the
   *  short-stack push/fold and reshove tiers the 100bb card never touches. */
  stackBB?: number;
  /** Exact format/utility context used by Phase 4 promotion matchups. */
  context?: LeagueGameContext;
  /** V16: duplicate pairs for this matchup (default PAIRS_PER_MATCHUP).
   *  Newer exploratory matchups run fewer pairs so the whole card still
   *  fits the wall-clock budget; stderr scales as 1/sqrt(pairs). */
  pairs?: number;
  a: HorseDecideOpts;
  b: HorseDecideOpts;
  /** 2026-10-19: per-arm profile dials (tightness, aggression, bluffFreq) for
   *  the league-gated self-tuner. Default {} for both arms - every matchup
   *  that does not set them plays exactly as before. */
  modsA?: HorseProfileMods;
  modsB?: HorseProfileMods;
  /** V12.3: RETIRED as an opt-in — EVERY matchup is now sandboxed. It was
   *  never safe to run a league hand against live HorseMind state: `mind:false`
   *  suppresses stats and pair writes but NOT barrel plans, so the four
   *  unsandboxed matchups were writing thousands of synthetic plan keys into
   *  the live map and tripping its 8000-key wipe — clearing the barrel plan of
   *  every hand in progress on every live table. Kept only so an existing
   *  config object still type-checks. */
  mind?: 'sandbox';
  /**
   * THE MOOD HOUR IS PART OF THE DEAL (2026-11-06). The V9 hourly mood reads
   * the wall clock unless a decision passes decisionTimeMs, so a mind-on card
   * measured whatever hour it happened to run in: the R7 certification
   * (dataset 187815b1, epoch 4, league/cash) recorded -3.575 bb/100 at 19:40Z,
   * and the same seed, model and engine re-run with the mood clock pinned to
   * other hours gives other verdicts. 'deal_seed' stamps every decision of a
   * pair, in both passes and both arms, with dealMoodClockMs(handSeed): a
   * reproducible hour drawn uniformly from the day, like production play.
   * Unset keeps the old behaviour for every existing card.
   */
  moodClock?: 'deal_seed';
  /**
   * HAND IDENTITY (2026-11-14). The live worker gives every decision the
   * hand it belongs to (opts.mindPlanContext.hand: table id and allocated
   * hand number); the league gave none, so an option that keys on the hand
   * had only its offline fallback to run. 'deal_seed' stamps every decision
   * of a pair, in both passes and both arms, with one hand derived from the
   * pair's deal seed. Both arms, although only an arm with such an option
   * reads it for its units: the brain's existing plan reader also keys on
   * this context, so stamping one arm alone would make the arms differ by
   * more than the option under test. A card that sets this therefore has no
   * arm on the plain league baseline. Unset keeps the old behaviour for every
   * existing card.
   */
  handIdentity?: 'deal_seed';
  /**
   * HUMAN FIELD (2026-10-24). Absent: the MIRROR card every matchup has
   * always been - every seat a horse, half the seats on config A and half on
   * B, swapped between the two passes of a duplicate pair. A mirror measures
   * what a layer is worth against OTHER HORSES, and live data says the fleet
   * is roughly break-even against humans before rake, so horse-vs-horse value
   * is not the number that pays.
   *
   * Set to HUMAN_CALIBRATED_POPULATION_ID: ONE seat is the hero horse and
   * every other seat plays the human-calibrated population
   * (HumanCalibratedPopulation.ts), seated as a human (`is_horse: false`).
   * Pass 1 of each duplicate pair seats arm A as the hero, pass 2 replays the
   * SAME deal, dealer and hero seat with arm B, against the same field. The
   * arms differ only in the flag under test, card luck cancels in the
   * difference, and bb100 is the hero's per-hand edge of A over B against
   * that field. Only variants in HUMAN_FIELD_VARIANTS are accepted.
   *
   * Set to V53_PRESSURE_POPULATION_ID (2026-10-31): the same duplicate deal,
   * with the V53 aggressor workload in every other seat instead
   * (HorseLeagueHumanField.ts says why it exists and what it is not). NLH only.
   */
  opponentPopulation?: LeagueOpponentPopulation;
  /**
   * HUMAN PERSONA (2026-11-07). Absent: every field seat plays the
   * population's own calibrated profile, as every human-field card before.
   * Set (human-calibrated field only): every field seat plays that persona's
   * profile instead (humanFieldPersonaProfile; HorseLeagueHumanField.ts says
   * what each persona is and is not). The stored config carries it next to
   * opponentPopulation, so a row says which persona it was measured against.
   */
  humanPersona?: HumanFieldPersona;
  /**
   * PRODUCTION PERSONAS (2026-10-31). Absent: every horse plays the
   * 'balanced' style, as every mirror card always has. True: each seat plays
   * the production persona Plo4StrengthContract assigns from the deal seed and
   * seat (plo4StrengthSeatStyle over PRODUCTION_HORSE_STYLES), the same seat
   * keeping the same persona in both passes while the arms swap. For layers
   * that read a horse's own or an opponent's TABLE IMAGE: a field of
   * 'balanced' horses never leaves the middle band those reads act outside of,
   * so v18_self_image and v23_river_reads diverged in 1-3 of 2,000 pairs and
   * read exactly zero on some nights while production fired them 100k-1.2M
   * times a day against a fleet of mixed personas.
   */
  productionStyles?: boolean;
  /**
   * HYBRID BASELINE (2026-11-06). Absent: the 'balanced' style with {} dials
   * (or productionStyles / modsA / modsB), as every card before the Hybrid
   * assignment (#9595) ran. True: every horse seat plays the style and the
   * four decision dials production now serves for this card's game mode
   * (HORSE_HYBRID_PROFILES: cash Grinder/Pebbles, tournament Tricky/Flint),
   * the same at every seat and in both passes, so the arms still differ
   * only in their flags; modsA / modsB, when set, are applied over the
   * Hybrid dials. On a human-field card (2026-11-07) it is the hero horse's
   * persona and dials in both passes; the field is unchanged.
   */
  hybridBaseline?: boolean;
  /**
   * MEMORY LEARNING OFF (2026-11-06, V31 evaluation contract v3). Absent: the
   * sandboxed brain learns from every decision and every settled hand, as
   * every card always has. 'off': the full brain still plays (barrel plans,
   * self-image, every read layer), but nothing is ever observed: decisions
   * run with observeMind false and settlement skips observe and
   * observeHandComplete, so every opponent read stays at its empty prior.
   * R7's league/cash loss existed only with learning on; a v3 league table
   * reports both runs so a loss that only appears through memory is visible.
   */
  memoryLearning?: 'off';
  /**
   * SPOT-SEEDED SESSIONS (2026-11-19, HorseLeagueSpotSelection.ts). Absent:
   * every deal is played, as every card before. Set: only deals whose public
   * state reaches the declared spot under a probe of arm B (or either arm) are
   * played, each as a normal duplicate pair (both arms see the same deal). The
   * selection rule and its counts are recorded in LeagueResult.spotSelection.
   * A selected result measures the spot, not overall win rate.
   */
  spot?: LeagueSpotSelection;
  /**
   * NO-LIMIT PROBE HISTORY (2026-11-20, docs/horse-league-fixed-limit.md
   * section 2; scripted fixed-limit field only). Absent: each pass sandbox
   * starts empty, as every card before. Set to N: before the first pair, each
   * pass sandbox plays N no-limit hold'em hands at the same seats, the hero on
   * its own arm and every field seat on the no-limit probe script
   * (FixedLimitScriptedField.nlhProbeWarmupPolicy), learning on, so the
   * field's pooled no-limit probe share is non-zero when the fixed-limit pairs
   * start (fixedLimitReadIgnoresProbes acts only against such a player). The
   * warm-up hands are not scored.
   */
  probeHistoryHands?: number;
}

/** The human field inside one dealt hand (see LeagueMatchup.opponentPopulation). */
export interface LeagueHumanField {
  population: LeagueOpponentPopulation;
  /** True for every seat index dealt to the human-calibrated population. */
  isHuman: (seatIdx: number) => boolean;
  /** Accumulates the population's responses per decision node. */
  responses?: Record<string, Record<string, number>>;
  /** 2026-11-07 (RiverBluffBaselineLeague): the calibrated profile a field
   *  seat plays, for a field that seats more than one tendency (a station, an
   *  over-folder). Absent, or undefined for a seat: the population's own
   *  calibrated profile for the variant, as every card before it. Calibrated
   *  (non-V53) fields only. */
  profileOf?: (seatIdx: number) => Readonly<HumanCalibratedProfile> | undefined;
  /** 2026-11-08 (ExploiterLeague): a scripted seat policy that plays a field
   *  seat in place of the population's decision (a calling station, a river
   *  over-bettor). It reads only its own cards and the public state, is
   *  offered the same legal menu a calibrated seat gets, and its answer goes
   *  through the same validation. Absent, or undefined for a seat: the
   *  population decides, as every card before it. */
  seatPolicyOf?: (seatIdx: number) => LeagueSeatPolicy | undefined;
}

/** What a scripted seat policy is shown: its own cards and the public state. */
export interface LeagueSeatSpot {
  variant: string;
  isPotLimit: boolean;
  stage: HandStage;
  seatIdx: number;
  numSeats: number;
  dealerSeat: number;
  bigBlind: number;
  cards: Card[];
  board: Card[];
  pot: number;
  toCall: number;
  currentBet: number;
  myBet: number;
  stack: number;
  /** Players still in the hand, the actor included. */
  liveCount: number;
  legalActions: string[];
  /** Legal bet/raise-to range, or null when no wager is legal. */
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  history: readonly ActionRecord[];
  userId: string;
  /** The production horse brain's decision for this seat, on this exact
   *  state (the same HorseLogic.decide a horse seat runs, inside the hand's
   *  sandbox). For policies that play like a horse except at the spot they
   *  exploit; calling it consumes the deal's strategy randomness exactly as
   *  a horse seat would. */
  horseDecide: (
    style: HorseStyle,
    mods: HorseProfileMods,
    opts: HorseDecideOpts
  ) => { action: string; amount?: number };
}

export type LeagueSeatPolicy = (spot: LeagueSeatSpot) => { action: string; amount?: number };

/**
 * 2026-11-07: a read-only observer of one dealt hand (RiverBluffBaselineLeague).
 * It sees every action the street engine applied, after validation, and the
 * settlement; it never changes a decision, consumes no randomness and is
 * absent on every pre-existing path.
 */
export interface LeagueHandObserver {
  /** Called right before a seat is asked for its decision (2026-11-21, sparring's HUD provider: the bench installs
   *  the acting seat's opponent packet here, the way the decision worker installs it around the decide call). */
  beforeDecision?: (e: { seatIdx: number; stage: HandStage }) => void;
  onAction?: (e: {
    seatIdx: number;
    stage: HandStage;
    action: string;
    /** bet/raise/all-in: the street total wagered to; call: chips added */
    amount: number;
    /** pot before the action */
    pot: number;
    toCall: number;
    /** live (unfolded) players before the action, the actor included */
    liveBefore: number;
  }) => void;
  onEnd?: (e: {
    endedByFolds: boolean;
    folded: boolean[];
    cards: Card[][];
    board: Card[];
    net: number[];
    /** PUBLIC end of the hand (2026-11-21): every seat's chips won, and the hand NAME of each seat still in at a
     *  showdown (empty when the hand ended by folds). A category name only: no card of a player is in it. */
    winnings: number[];
    shown: Array<{ seatIdx: number; handName: string }>;
  }) => void;
}

/**
 * What the nightly runner stores in config_a / config_b for a matchup. A
 * mirror card stores its arm unchanged (every row ever written keeps its
 * meaning). A human-field card adds `opponentPopulation`, so a row can say
 * which field it was measured against without a schema change; the name
 * (`human_*`) says it too.
 */
export function leagueResultConfig(
  matchup: Pick<LeagueMatchup, 'a' | 'b' | 'opponentPopulation'> &
    Partial<Pick<LeagueMatchup, 'humanPersona' | 'memoryLearning'>>,
  arm: 'a' | 'b'
): Record<string, unknown> {
  const opts = matchup[arm] as Record<string, unknown>;
  // 2026-11-13: a card dealt with memory learning off says so in its row. No
  // card had the option before the reads-off cards, so no existing row changes.
  const reads = matchup.memoryLearning ? { memoryLearning: matchup.memoryLearning } : {};
  return matchup.opponentPopulation
    ? {
        ...opts,
        opponentPopulation: matchup.opponentPopulation,
        ...(matchup.humanPersona ? { humanPersona: matchup.humanPersona } : {}),
        ...reads,
      }
    : matchup.memoryLearning
      ? { ...opts, ...reads }
      : opts;
}

/** The scenario name of the block standard error component a nightly row stores. */
export const LEAGUE_BLOCK_STDERR_SCENARIO = 'paired_difference_block_stderr';

/**
 * What the nightly runner stores in candidate_benchmark_components
 * (2026-11-13, HU-EVAL-006): the result's own components, then, when the run
 * was long enough to have one, the block standard error as one more entry.
 * `stderr` (the column the pooled verdict, the audit and the tuner read)
 * keeps its per-pair meaning; the block figure sits beside it in a column no
 * consumer of a nightly card reads. bb100 and hands repeat the row's own.
 */
export function leagueStoredComponents(r: LeagueResult): unknown[] {
  if (r.blockStderr === undefined || r.stderrBlocks === undefined) return r.benchmarkComponents;
  return [
    ...r.benchmarkComponents,
    {
      scenario: LEAGUE_BLOCK_STDERR_SCENARIO,
      hands: r.hands,
      bb100: r.bb100,
      stderr: r.blockStderr,
      blocks: r.stderrBlocks,
      perPairStderr: r.stderr,
    },
  ];
}

export interface LeagueGameContext {
  gameMode: 'cash' | 'tournament';
  format: 'cash' | 'mtt' | 'sng' | 'spin' | 'hu_sng';
  ante?: number;
  /** V71 (2026-10-31): the ante is a big-blind ante - the big blind posts
   *  `ante` chips of dead money once per hand (not into its bet), and the
   *  decision state carries `bigBlindAnte`. Absent = no ante is posted, as
   *  every card before V71 ran. */
  bigBlindAnte?: boolean;
  tournament?: HorseGameStateV2['tournament'];
}

const CASH_LEAGUE_CONTEXT: LeagueGameContext = {
  gameMode: 'cash',
  format: 'cash',
  ante: 0,
};

/**
 * 2026-11-07: a mid-field MTT (180 left, 30 paid, not near the bubble) with a
 * 1bb big-blind ante, for the short-stack push/fold cards. BB = 2 chips.
 */
function bigBlindAnteMttContext(seats: number, stackBB: number): LeagueGameContext {
  return {
    gameMode: 'tournament',
    format: 'mtt',
    ante: BB,
    bigBlindAnte: true,
    tournament: {
      schemaVersion: 1,
      contextStatus: 'complete',
      contextIssues: [],
      playersLeft: 180,
      spotsPaid: 30,
      entrants: 300,
      avgStackChips: stackBB * BB,
      medianStackChips: stackBB * BB,
      seatsPerTable: seats,
      nearBubble: false,
      inMoney: false,
      payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
      currentSmallBlind: SB,
      currentBigBlind: BB,
      currentAnte: BB,
      anteType: 'big_blind',
      nextSmallBlind: SB * 2,
      nextBigBlind: BB * 2,
      nextAnte: BB * 2,
      nextBlindInMin: 10,
    },
  };
}

/**
 * 2026-11-24: a six-handed Sit & Go (six entrants, two paid 65 / 35, no ante), for the hold'em tournament raise
 * defence card in the Sit & Go format.
 */
function sixMaxSngContext(seats: number, stackBB: number): LeagueGameContext {
  return {
    gameMode: 'tournament',
    format: 'sng',
    ante: 0,
    tournament: {
      schemaVersion: 1,
      contextStatus: 'complete',
      contextIssues: [],
      playersLeft: seats,
      spotsPaid: 2,
      entrants: seats,
      avgStackChips: stackBB * BB,
      medianStackChips: stackBB * BB,
      seatsPerTable: seats,
      nearBubble: false,
      inMoney: false,
      payoutPct: [65, 35],
      currentSmallBlind: SB,
      currentBigBlind: BB,
      currentAnte: 0,
      nextSmallBlind: SB * 2,
      nextBigBlind: BB * 2,
      nextAnte: 0,
      nextBlindInMin: 10,
    },
  };
}

/**
 * 2026-11-13: the same MTT at its final table (every remaining player seated
 * here, all in the money), for the Omaha first-in cards: the rule acts only
 * when the whole field is at this table (HorseOmahaTournamentFirstIn.ts).
 */
function winnerTakeAllSpinContext(seats: number, stackBB: number): LeagueGameContext {
  // A three-player spin paying one place: the only three-handed payout the
  // Omaha first-in rule acts on (pay jumps three-handed lost in ICM, R4).
  const ctx = finalTableMttContext(seats, stackBB);
  return {
    ...ctx,
    format: 'spin',
    tournament: { ...ctx.tournament!, spotsPaid: 1, payoutPct: [100] },
  };
}

/**
 * 2026-11-13: the big-blind-ante MTT with the M state the live engine sends
 * on every tournament decision (ServerTableEngineTurns builds `tournament.m`).
 * Without `m` HorseLogic skips the Phase 6 coordinate, so no spot is ever
 * classed `multiway_all_in` and a rule that lives in that branch cannot be
 * reached (the committed-stack card below). Every seat starts the hand with
 * the same stack, so the M is the starting stack's M at this table.
 */
function bigBlindAnteMttWithMContext(seats: number, stackBB: number): LeagueGameContext {
  const ctx = bigBlindAnteMttContext(seats, stackBB);
  const t = ctx.tournament!;
  return {
    ...ctx,
    tournament: {
      ...t,
      m: buildTournamentMState({
        stackChips: stackBB * BB,
        smallBlind: SB,
        bigBlind: BB,
        ante: BB,
        anteType: 'big_blind',
        playersAtTable: seats,
        nextSmallBlind: SB * 2,
        nextBigBlind: BB * 2,
        nextAnte: BB * 2,
        minutesToNextLevel: 10,
        opponentStacks: Array.from({ length: seats - 1 }, (_, i) => ({
          userId: `league-seat-${i + 1}`,
          stackChips: stackBB * BB,
        })),
        previousZone: null,
      }),
    },
  };
}

function finalTableMttContext(seats: number, stackBB: number): LeagueGameContext {
  const ctx = bigBlindAnteMttContext(seats, stackBB);
  const payoutPct = [30, 20, 14, 10, 8, 6, 4, 3, 3, 2].slice(0, seats);
  return {
    ...ctx,
    tournament: {
      ...ctx.tournament!,
      playersLeft: seats,
      spotsPaid: seats,
      nearBubble: false,
      inMoney: true,
      payoutPct,
    },
  };
}

/**
 * 2026-11-15: the final-table MTT with the stack list and the seat identities
 * the live feed sends (TournamentBrainContext stacks / stackByUser), for the
 * payout-aware push/fold card (nashPushFoldIcm, hand 59441335; default OFF).
 * Without them heroBubbleFactor has nothing to price and both arms play chip
 * EV. Every seat
 * starts each hand with stackBB big blinds, so the start-of-hand list is the
 * same every hand; the deciding seat's own slot is replaced by its live stack
 * (HorseLogic realIcmInputs).
 */
export function finalTableMttWithStacksContext(seats: number, stackBB: number): LeagueGameContext {
  const ctx = finalTableMttContext(seats, stackBB);
  const start = stackBB * BB;
  return {
    ...ctx,
    tournament: {
      ...ctx.tournament!,
      stacks: Array.from({ length: seats }, () => start),
      stackByUser: Object.fromEntries(
        Array.from({ length: seats }, (_, s) => [`league-${s + 1}`, start])
      ),
    },
  };
}

/**
 * 2026-11-26 (tourney-postflop): a Sit & Go on the bubble: `seats` left, one fewer paid (65 / 35 at three left), with
 * the stack list and seat identities the live feed sends, so the pay-jump bubble factor is priced (heroBubbleFactor).
 */
function sngBubbleWithStacksContext(seats: number, stackBB: number): LeagueGameContext {
  const ctx = sixMaxSngContext(seats, stackBB);
  const start = stackBB * BB;
  return {
    ...ctx,
    tournament: {
      ...ctx.tournament!,
      spotsPaid: seats - 1,
      payoutPct: [65, 35, 0, 0, 0, 0].slice(0, seats - 1),
      entrants: 6,
      nearBubble: true,
      stacks: Array.from({ length: seats }, () => start),
      stackByUser: Object.fromEntries(
        Array.from({ length: seats }, (_, s) => [`league-${s + 1}`, start])
      ),
    },
  };
}

const DEFAULT_SEATS = 6;
const BB = 2;
const SB = 1;
// START_STACK is per-matchup now (stackBB * BB); 100bb was the only depth
// the league ever measured before V16.
// V12.3: raised from 24. A six-way preflop raise war can legitimately exceed
// 24 actions, and hitting the cap now folds the debtors (see runStreet)
// rather than silently forgiving their unpaid bets.
const MAX_ACTIONS_PER_STREET = 48;

/** V12.3: process-wide monotonic base for synthetic action timestamps. Two
 *  hands must never share a HorseMind hand key (see playHand). */
let handTsCounter = 1;
const TS_STRIDE = 4096; // room for every action in a hand
function nextHandTsBase(): number {
  handTsCounter += TS_STRIDE;
  return handTsCounter;
}

/**
 * THE HAND CLOCK OF ONE DUPLICATE PAIR (2026-11-13, HU-EVAL-003/004). The
 * timestamp base both passes of pair `pairIndex` of a run are dealt on: a
 * function of the run seed and the pair, and of nothing else. The brain keys
 * per-hand draws on the hand's first action timestamp (the persona
 * indifference band and V48 chart adherence hash `timestamp:userId`), and the
 * process-wide counter above handed every playHand call the next number in
 * the process. So (a) the second card a worker ran was dealt on other
 * timestamps than the same card run first, and gave another answer for the
 * same seed (80bb heads-up mirror, 3,000 pairs, seed 20261112: -4.86 first,
 * -8.10 second), and (b) the two passes of one pair never shared a
 * timestamp, so two IDENTICAL arms drew different persona mixes and diverged
 * (2 of 6,000 pairs against the limp persona).
 *
 * The run seed is folded in (its value modulo LEAGUE_HAND_CLOCK_SEED_SLOTS
 * picks one of 4,096 disjoint bands) so the draws are not the same sample
 * every night and on every card: the nightly seed carries the date and the
 * card name, and a draw sample frozen across nights would be an error that
 * pooling nights could never shrink. Same card and same seed: same clocks,
 * whatever ran before. Inside a band the base is TS_STRIDE * (2p + 1), odd
 * slots TS_STRIDE apart, so no two pairs of a run share a timestamp; the
 * largest value is under 2^42. Each pass plays in its own HorseMind sandbox
 * for the whole matchup, so the two passes sharing a hand key share no plan,
 * outlook or seen-action state.
 */
export const LEAGUE_HAND_CLOCK_SEED_SLOTS = 4096;
export const LEAGUE_HAND_CLOCK_MAX_PAIRS = 65_536;
export function leaguePairHandClock(pairIndex: number, runSeed: number): number {
  if (
    !Number.isSafeInteger(pairIndex) ||
    pairIndex < 0 ||
    pairIndex >= LEAGUE_HAND_CLOCK_MAX_PAIRS
  ) {
    throw new Error(
      `leaguePairHandClock: pair ${pairIndex} is outside 0..${LEAGUE_HAND_CLOCK_MAX_PAIRS - 1}`
    );
  }
  const band = (runSeed >>> 0) % LEAGUE_HAND_CLOCK_SEED_SLOTS;
  return 1 + TS_STRIDE * (band * 2 * LEAGUE_HAND_CLOCK_MAX_PAIRS + 2 * pairIndex + 1);
}

/** The blocks the block standard error (LeagueResult.blockStderr) aims for. */
export const LEAGUE_STDERR_BLOCK_TARGET = 40;
/** The fewest pairs a block may hold; a shorter run gets fewer blocks. */
export const LEAGUE_STDERR_BLOCK_MIN_PAIRS = 25;

/**
 * BLOCK STANDARD ERROR (2026-11-13, HU-EVAL-006). The per-pair differences
 * cut into equal contiguous blocks (LEAGUE_STDERR_BLOCK_TARGET of them when
 * each can hold LEAGUE_STDERR_BLOCK_MIN_PAIRS pairs, fewer otherwise, a
 * remainder of pairs at the end left out); the value is the sample standard
 * deviation of the block means over sqrt(blocks), in the units of `values`.
 * It does not assume neighbouring pairs are independent, which the per-pair
 * figure does while each arm's memory persists across the matchup. It is an
 * estimate from few blocks (about 11% relative noise at 40), and it cannot
 * see a difference between whole runs. Null under two blocks.
 */
export function blockStandardError(
  values: readonly number[]
): { stderr: number; blocks: number; pairsPerBlock: number } | null {
  const blocks = Math.min(
    LEAGUE_STDERR_BLOCK_TARGET,
    Math.floor(values.length / LEAGUE_STDERR_BLOCK_MIN_PAIRS)
  );
  if (blocks < 2) return null;
  const pairsPerBlock = Math.floor(values.length / blocks);
  const means: number[] = [];
  for (let b = 0; b < blocks; b++) {
    let sum = 0;
    for (let k = 0; k < pairsPerBlock; k++) sum += values[b * pairsPerBlock + k];
    means.push(sum / pairsPerBlock);
  }
  const mean = means.reduce((a, x) => a + x, 0) / blocks;
  const variance = means.reduce((a, x) => a + (x - mean) * (x - mean), 0) / (blocks - 1);
  return { stderr: Math.sqrt(variance / blocks), blocks, pairsPerBlock };
}

const FULL_DECK: Card[] = [];
for (const suit of SUITS) for (const rank of RANKS) FULL_DECK.push({ rank, suit });

/**
 * THE BRAIN'S TWO PUBLIC STREAMS ARE PINNED PER DECISION (2026-11-19).
 * horsePublicBetSize (every public bet size, with omahaBetSizeByPublicState)
 * and horsePublicActionTime draw from streams production seeds from the
 * operating system at load, never from a deal. Unpinned, the two passes of a
 * duplicate pair drew different sizes: IDENTICAL arms with the option on
 * diverged in 38 and 39 of 300 pairs (seed 20261119), and 0 of 300 with the
 * stream held. playHand seeds both before every seat's decision from the
 * deal, the seat and the decision's place in the hand, so the two passes of a
 * pair draw the same numbers at the same node and an arm that draws more
 * does not shift a later decision. Benchmark only: production never calls it.
 */
export function leaguePinPublicStreams(
  handSeed: number,
  seatIdx: number,
  decisionIndex: number
): void {
  let h = (handSeed ^ 0x9e3779b9) >>> 0;
  for (const x of [seatIdx + 1, decisionIndex + 1]) {
    h = Math.imul(h ^ (x >>> 0), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
  }
  seedHorseBetSizeRandom(h);
  seedHorseTimingRandom(h ^ 0x5bd1e995);
}

/** The deck playHand deals for `handSeed`: seeds fastRandom, then Fisher-Yates on it.
 *  The stream is left where playHand continues from it. */
function leagueShuffledDeck(handSeed: number): Card[] {
  seedFastRandom(handSeed);
  const deck = [...FULL_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(fastRandom() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

/** The hole cards (by seat index) and the five-card board playHand deals for a
 *  seed, without playing it. The ambient fastRandom stream is restored. */
export function leagueDealtCards(
  handSeed: number,
  gameVariant: string,
  numSeats: number
): { holes: Card[][]; board: Card[] } {
  const saved = saveFastRandom();
  try {
    const deck = leagueShuffledDeck(handSeed);
    const hc = variantInfo(gameVariant).holeCount;
    return {
      holes: Array.from({ length: numSeats }, (_, s) => deck.slice(s * hc, s * hc + hc)),
      board: deck.slice(numSeats * hc, numSeats * hc + 5),
    };
  } finally {
    restoreFastRandom(saved);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One hand
// ─────────────────────────────────────────────────────────────────────────────

interface Seat {
  player: SeatPlayer;
  contributed: number;
  /** The part of `contributed` that is shared dead money (the big-blind ante). */
  dead: number;
  opts: HorseDecideOpts;
  mods: HorseProfileMods;
  style: HorseStyle;
}

/**
 * The league's showdown settlement: what each seat is paid from the pot.
 *
 * HI-LO (2026-11-21): a hi-lo hand (plo8, flo8; VariantRules.isHiLoVariant)
 * is paid by the live engine's own determineWinners (PokerEngine.ts), the
 * function HandController.completeHand pays every real pot with: the same
 * Omaha high and eight-or-better low evaluators, half of each layer to the
 * best qualifying low, the odd unit to the high half, ties within a half
 * split with the odd unit clockwise of the button, a scoop when no hand
 * qualifies low. Before this, every hi-lo pot went to the high hand alone,
 * so every PLO8 league card measured a high-only game. The cent unit is the
 * league's (BB = 2 chips): the tournament whole-chip unit would be half a big
 * blind here, a rounding no real tournament pot sees.
 *
 * Every other variant keeps the league's exact-fraction high settlement,
 * unchanged, so no non-hi-lo card moves.
 */
export function settleLeagueShowdown(
  seats: ReadonlyArray<{ player: SeatPlayer; contributed: number }>,
  board: Card[],
  gameVariant: string,
  dealerSeat: number,
  pot: number
): number[] {
  const SEATS = seats.length;
  const vi = variantInfo(gameVariant);
  const live = () => seats.filter((s) => !s.player.is_folded).map((s) => s.player);
  const contenders = seats
    .map((s, i) => ({ i, folded: s.player.is_folded, contributed: s.contributed }))
    .filter((c) => c.contributed > 0 || !c.folded);
  const winnings = new Array(SEATS).fill(0);

  if (live().length === 1) {
    winnings[seats.findIndex((s) => s.player === live()[0])] = pot;
  } else if (vi.isHiLo) {
    // The same layers as below, merged by identical eligible set (matching
    // PokerEngine.calculatePots so an odd cent on a split or quartered pot
    // never differs from HandController.completeHand when a folded seat
    // contributed below the live players), then handed to determineWinners.
    const levels = [...new Set(contenders.map((c) => c.contributed))].sort((a, b) => a - b);
    const rawPots: Pot[] = [];
    let orphaned = 0;
    let prev = 0;
    for (const lvl of levels) {
      if (lvl - prev <= 0) continue;
      let amount = 0;
      const eligiblePlayers: string[] = [];
      for (let i = 0; i < SEATS; i++) {
        amount += Math.min(seats[i].contributed, lvl) - Math.min(seats[i].contributed, prev);
        if (!seats[i].player.is_folded && seats[i].contributed >= lvl)
          eligiblePlayers.push(seats[i].player.user_id);
      }
      if (eligiblePlayers.length > 0) {
        rawPots.push({ amount, eligiblePlayers });
      } else if (amount > 0) {
        orphaned += amount;
      }
      prev = lvl;
    }
    if (orphaned > 0 && rawPots.length > 0) {
      rawPots[0].amount += orphaned;
    }
    const pots: Pot[] = [];
    for (const layer of rawPots) {
      const last = pots[pots.length - 1];
      if (
        last &&
        last.eligiblePlayers.length === layer.eligiblePlayers.length &&
        last.eligiblePlayers.every((id, idx) => id === layer.eligiblePlayers[idx])
      ) {
        last.amount += layer.amount;
      } else {
        pots.push(layer);
      }
    }
    const awards = determineWinners(
      seats.map((s) => s.player),
      board,
      pots,
      gameVariant,
      dealerSeat,
      undefined,
      undefined,
      0.01
    );
    let paid = 0;
    for (const w of awards) {
      const i = seats.findIndex((s) => s.player.user_id === w.userId);
      winnings[i] += w.amount;
      paid += w.amount;
    }
    // Chips never evaporate: a sub-cent float residue rides with the first
    // award, as distributePot rides its sub-unit residue with the first winner.
    const residue = pot - paid;
    if (residue !== 0 && awards.length > 0)
      winnings[seats.findIndex((s) => s.player.user_id === awards[0].userId)] += residue;
  } else {
    const scores = seats.map((s) =>
      s.player.is_folded
        ? -1
        : vi.isOmaha
          ? scoreOmahaHi(s.player.cards, board)
          : scoreHoldem(s.player.cards.concat(board), s.player.cards.length + 5, vi.isShortDeck)
    );
    // Layered side pots by contribution level.
    const levels = [...new Set(contenders.map((c) => c.contributed))].sort((a, b) => a - b);
    let prev = 0;
    for (const lvl of levels) {
      const layer = lvl - prev;
      if (layer <= 0) continue;
      let layerPot = 0;
      const eligible: number[] = [];
      for (let i = 0; i < SEATS; i++) {
        const contrib = Math.min(seats[i].contributed, lvl) - Math.min(seats[i].contributed, prev);
        layerPot += contrib;
        if (!seats[i].player.is_folded && seats[i].contributed >= lvl) eligible.push(i);
      }
      if (eligible.length > 0) {
        let best = -1;
        for (const i of eligible) if (scores[i] > best) best = scores[i];
        const winners = eligible.filter((i) => scores[i] === best);
        for (const w of winners) winnings[w] += layerPot / winners.length;
      } else {
        // Cannot happen in a legal sequence (a live player always matches the
        // top contribution), but chips must NEVER evaporate: hand the layer
        // to the best live hand overall.
        let bestI = -1;
        for (let i = 0; i < SEATS; i++) {
          if (!seats[i].player.is_folded && (bestI === -1 || scores[i] > scores[bestI])) bestI = i;
        }
        if (bestI >= 0) winnings[bestI] += layerPot;
      }
      prev = lvl;
    }
  }
  return winnings;
}

/**
 * Play one full NLH hand. `configOf(seatIdx)` maps a seat to its engine
 * config. Returns net chips per seat (sum is always 0) — verified by the
 * conservation test.
 */
export function playHand(
  handSeed: number,
  dealerSeat: number,
  configOf: (seatIdx: number) => HorseDecideOpts,
  counters?: { illegal: number; truncated: number },
  /** V12.2: when present, decisions run against this sandboxed HorseMind and
   *  the per-seat `mind` flag is honored (default on) instead of forced off. */
  sandbox?: HorseMindSandbox,
  /** V15: game variant to deal (default 'nlh'). Omaha variants deal the full
   *  hole count, enforce pot-limit sizing in validation, and score showdowns
   *  with the Omaha evaluator. */
  gameVariant: string = 'nlh',
  /** V16: seats at the table (default 6; 2 = heads-up). */
  numSeats: number = 6,
  /** V16: starting stack in big blinds (default 100). */
  stackBB: number = 100,
  /** Phase 4: exact cash/tournament utility family. */
  gameContext: LeagueGameContext = CASH_LEAGUE_CONTEXT,
  /** 2026-10-19: per-seat profile dials; absent = {} (the pre-existing path). */
  modsOf?: (seatIdx: number) => HorseProfileMods,
  /** 2026-10-24: seats dealt to the human-calibrated population, seated as
   *  humans. Absent: every seat is a horse (the pre-existing path). */
  humanField?: LeagueHumanField,
  /** 2026-10-31: per-seat persona (LeagueMatchup.productionStyles). Absent:
   *  every horse plays 'balanced' (the pre-existing path). */
  styleOf?: (seatIdx: number) => HorseStyle,
  /** 2026-11-06: false skips the settlement observation (observe +
   *  observeHandComplete) into the sandbox, so memory never learns
   *  (LeagueMatchup.memoryLearning). Default true: the pre-existing path. */
  learn: boolean = true,
  /** 2026-11-07: read-only hand observer; absent on every existing path. */
  observer?: LeagueHandObserver,
  /** 2026-11-13: the timestamp base this hand is dealt on (leaguePairHandClock).
   *  Absent: the next slot of the process-wide counter, as every direct caller. */
  handClock?: number
): number[] {
  const SEATS = numSeats;
  if (humanField && !(leagueFieldVariants(humanField.population) ?? []).includes(gameVariant)) {
    throw new Error(
      `A ${humanField.population} field hand cannot deal ${gameVariant}: that population is ` +
        `qualified for ${(leagueFieldVariants(humanField.population) ?? []).join(', ') || 'nothing'} only`
    );
  }
  const START_STACK = stackBB * BB;
  const vi = variantInfo(gameVariant);
  // FIXED LIMIT (2026-11-20; flo8 added 2026-11-21, LeagueDecisionState.ts):
  // fixed-limit hold'em (flh) and fixed-limit Omaha hi-lo (flo8) are dealt with
  // the engine's own structure rules - the street unit, the four-wager cap and
  // the single legal amount, from BettingStructure.ts and calculateBettingState,
  // the functions HandController.buildBettingState calls - at stacks no hand
  // can exhaust. Any fixed-limit table outside that domain is refused loudly.
  const fixedLimit = leagueDealsFixedLimit(gameVariant);
  if (fixedLimit) {
    const refusal = leagueFixedLimitRefusal({
      gameVariant,
      stackBB,
      gameMode: gameContext.gameMode,
      ante: gameContext.ante ?? 0,
      humanField: humanField !== undefined,
      ...(humanField ? { fieldPopulation: humanField.population } : {}),
    });
    if (refusal) throw new Error(refusal);
  }
  const holeCount = vi.holeCount;
  const deck = leagueShuffledDeck(handSeed);

  const tally: LeagueCounters = counters ?? { illegal: 0, truncated: 0 };

  const seats: Seat[] = [];
  for (let s = 0; s < SEATS; s++) {
    const human = humanField?.isHuman(s) === true;
    seats.push({
      contributed: 0,
      dead: 0,
      // Without a sandbox, league hands are memory-free (mind:false) — they
      // must never write synthetic reads into the live opponent memory. With
      // one, the mind runs for real against the sandbox's isolated state.
      // A human-field seat never reaches HorseLogic, so its opts are unused.
      opts: human ? {} : sandbox ? { ...configOf(s) } : { ...configOf(s), mind: false },
      mods: !human && modsOf ? { ...modsOf(s) } : {},
      style: !human && styleOf ? styleOf(s) : 'balanced',
      player: {
        seat: s + 1,
        user_id: human ? `league-human-${s + 1}` : `league-${s + 1}`,
        username: human ? `Human${s + 1}` : `League${s + 1}`,
        stack: START_STACK,
        bet: 0,
        totalInvested: 0,
        cards: deck.slice(s * holeCount, s * holeCount + holeCount),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: !human,
      } as SeatPlayer,
    });
  }
  const board = deck.slice(SEATS * holeCount, SEATS * holeCount + 5);

  const idx = (seatNo: number) => (seatNo - 1 + SEATS) % SEATS;
  // Heads-up the button posts the small blind and acts first preflop, exactly
  // as the live engine does (engine/headsUpButton.ts) and as every V31 cell
  // labels it (gtoV31Position: dealer = SB). With 3+ seats the blinds follow
  // the button clockwise.
  const sbIdx = SEATS === 2 ? idx(dealerSeat) : idx(dealerSeat + 1);
  const bbIdx = SEATS === 2 ? idx(dealerSeat + 1) : idx(dealerSeat + 2);

  const post = (i: number, amt: number) => {
    const p = seats[i].player;
    const real = Math.min(amt, p.stack);
    p.stack -= real;
    p.bet += real;
    seats[i].contributed += real;
    if (p.stack === 0) p.is_all_in = true;
    return real;
  };
  let pot = post(sbIdx, SB) + post(bbIdx, BB);
  if (gameContext.bigBlindAnte === true && (gameContext.ante ?? 0) > 0) {
    // Dead money: out of the big blind's stack and into the pot, never its bet.
    const p = seats[bbIdx].player;
    const real = Math.min(gameContext.ante ?? 0, p.stack);
    p.stack -= real;
    seats[bbIdx].contributed += real;
    seats[bbIdx].dead += real;
    pot += real;
    if (p.stack === 0) p.is_all_in = true;
  }
  let currentBet = BB;
  let minRaise = BB;
  let lastRaise = BB;
  const history: ActionRecord[] = [];
  // The hand's timestamp base, which is also its HorseMind hand key. V12.3
  // took it from a process-wide counter because `handSeed >>> 1` gave both
  // passes of a duplicate pair one key while they shared HorseMind state, and
  // config B read config A's barrel plan. 2026-11-13: the league runners now
  // give both passes of a pair ONE key on purpose (leaguePairHandClock), so
  // identical arms draw identical persona mixes; what keeps the arms apart is
  // the per-pass sandbox (sb1 / sb2), which holds every plan, outlook and
  // seen-action key. Do not "fix" the sharing. A direct caller that passes no
  // clock still gets the counter.
  let ts = handClock ?? nextHandTsBase();

  const live = () => seats.filter((s) => !s.player.is_folded);
  const canAct = () => seats.filter((s) => !s.player.is_folded && !s.player.is_all_in);

  const runStreet = (stage: HandStage, firstIdx: number): boolean => {
    // returns true when the hand ended by folds
    if (fixedLimit) {
      // HandController resets both to the incoming street's wager (advanceStage:
      // streetReset), and a fixed-limit raise never moves them.
      minRaise = fixedLimitBetSize(BB, stage);
      lastRaise = minRaise;
    }
    let toActQueue: number[] = [];
    for (let k = 0; k < SEATS; k++) {
      const i = (firstIdx + k) % SEATS;
      const p = seats[i].player;
      if (!p.is_folded && !p.is_all_in) toActQueue.push(i);
    }
    let actions = 0;
    let lastAggressor = -1;
    // V12.3: who has already acted on this street. A short all-in reopens
    // nothing for them (TDA 44); a full raise reopens for everyone.
    const acted = new Set<number>();
    const rebuildQueue = (raiserIdx: number, reopens: boolean, actedSet: Set<number>): number[] => {
      const q: number[] = [];
      for (let k = 1; k < SEATS; k++) {
        const j = (raiserIdx + k) % SEATS;
        const other = seats[j].player;
        if (other.is_folded || other.is_all_in) continue;
        if (!reopens && actedSet.has(j)) continue; // owes the difference only
        q.push(j);
      }
      return q;
    };
    while (toActQueue.length > 0 && actions < MAX_ACTIONS_PER_STREET) {
      const i = toActQueue.shift()!;
      const seat = seats[i];
      const p = seat.player;
      if (p.is_folded || p.is_all_in) continue;
      if (live().length < 2) break;

      const boardCards =
        stage === 'preflop'
          ? []
          : stage === 'flop'
            ? board.slice(0, 3)
            : stage === 'turn'
              ? board.slice(0, 4)
              : board.slice(0, 5);
      const gs: HorseGameStateV2 = {
        players: seats.map((s) => s.player),
        communityCards: boardCards,
        pot,
        currentBet,
        minRaise,
        lastRaise,
        stage,
        gameVariant,
        bigBlind: BB,
        dealerSeat,
        actionHistory: history,
        gameMode: gameContext.gameMode,
        ante: gameContext.ante ?? 0,
        ...(gameContext.bigBlindAnte === true ? { bigBlindAnte: true } : {}),
        format: gameContext.format,
        ...(gameContext.tournament ? { tournament: structuredClone(gameContext.tournament) } : {}),
      } as HorseGameStateV2;
      // 2026-11-15 (LeagueDecisionState.ts): every HorseLogic.decide gets the
      // state production builds for this node - the legal menu, toCall, the
      // wager bounds, the betting structure, the public seats with their real
      // investment - so the league plays the brain production fields. `gs`
      // above stays the input of the non-Horse pressure seats only.
      const brainInput = (): { player: SeatPlayer; gameState: HorseGameStateV2 } =>
        leagueHorseDecisionInput({
          seats,
          heroIdx: i,
          stage,
          board: boardCards,
          pot,
          currentBet,
          minRaise,
          lastRaise,
          gameVariant,
          smallBlind: SB,
          bigBlind: BB,
          dealerSeat,
          blindSeats: { smallBlind: sbIdx + 1, bigBlind: bbIdx + 1 },
          history,
          gameMode: gameContext.gameMode,
          format: gameContext.format,
          ante: gameContext.ante ?? 0,
          bigBlindAnte: gameContext.bigBlindAnte === true,
          ...(gameContext.tournament ? { tournament: gameContext.tournament } : {}),
        }) ?? { player: p, gameState: gs };

      const toCall = Math.max(0, currentBet - p.bet);
      // A fixed-limit field seat is played only by a scripted policy offered the
      // controller's fixed-limit menu (seatPolicyDecision); the calibrated and
      // pressure decisions build a no-limit menu, so they never reach this hand.
      if (
        (fixedLimit ||
          humanField?.population === FIXED_LIMIT_SCRIPTED_POPULATION_ID ||
          humanField?.population === FLO8_SCRIPTED_POPULATION_ID) &&
        humanField?.isHuman(i) === true &&
        humanField.seatPolicyOf?.(i) === undefined
      ) {
        throw new Error(
          `A fixed-limit league hand, or a ${FIXED_LIMIT_SCRIPTED_POPULATION_ID} / ${FLO8_SCRIPTED_POPULATION_ID} hand, seats a field player only ` +
            `through a scripted seat policy (seat ${i + 1})`
        );
      }
      leaguePinPublicStreams(handSeed, i, history.length);
      observer?.beforeDecision?.({ seatIdx: i, stage });
      const d: { action: string; amount?: number } =
        // Routed by the field's own seat assignment (the same predicate that
        // seated this player), so a seat's input device is chosen where the
        // seat was dealt, never re-derived from a flag on the player.
        humanField?.isHuman(i) === true && humanField.seatPolicyOf?.(i) !== undefined
          ? seatPolicyDecision(humanField.seatPolicyOf(i)!, {
              i,
              p,
              stage,
              board: boardCards,
              gameVariant,
              pot,
              currentBet,
              lastRaise,
              toCall,
              numSeats: SEATS,
              dealerSeat,
              liveCount: live().length,
              history,
              horseDecide: (style, mods, opts) => {
                const input = brainInput();
                return sandbox
                  ? HorseMind.runInSandbox(sandbox, () =>
                      HorseLogic.decide(input.player, input.gameState, style, mods, opts)
                    )
                  : HorseLogic.decide(input.player, input.gameState, style, mods, {
                      ...opts,
                      mind: false,
                    });
              },
            })
          : humanField?.isHuman(i) === true && humanField.population === V53_PRESSURE_POPULATION_ID
            ? pressureFieldDecision(humanField, p, gs, currentBet, lastRaise, toCall)
            : humanField?.isHuman(i) === true
              ? humanFieldDecision(humanField, i, p, stage, boardCards, gameVariant, {
                  pot,
                  currentBet,
                  lastRaise,
                  toCall,
                  aggressionThisStreet: history.some(
                    (a) =>
                      a.stage === stage &&
                      (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in')
                  ),
                })
              : (() => {
                  const input = brainInput();
                  return sandbox
                    ? HorseMind.runInSandbox(sandbox, () =>
                        HorseLogic.decide(
                          input.player,
                          input.gameState,
                          seat.style,
                          seat.mods,
                          seat.opts
                        )
                      )
                    : HorseLogic.decide(
                        input.player,
                        input.gameState,
                        seat.style,
                        seat.mods,
                        seat.opts
                      );
                })();

      // Validate against the engine's own rules; downgrade an illegal action
      // to the safe fallback and count it (the conservation test asserts 0).
      let action = d.action as string;
      // 2026-11-05: what reaches the validator is already the brain's
      // legalized output plus these harness coercions. A zero illegal count
      // proved nothing while the coercions and the brain's own exception
      // fallback went uncounted, so both are now counted separately.
      if ((d as { policyFallback?: string }).policyFallback === 'brain_exception') {
        tally.brainFallback = (tally.brainFallback ?? 0) + 1;
      }
      const recommended = action;
      // Fixed limit: one legal wager amount, so the brain's size is replaced by
      // it, as the live table does (ServerTableEngineTurns: horseIsFixedLimit
      // snaps a wager to minRaiseTo, substituteOnCappedStreet turns a wager on
      // a capped street into a call or check, and HandController
      // .clampToStructure executes a deep stack's all_in as the street's one
      // bet or raise). The amount is not a correction; a changed action is.
      const fl = fixedLimit ? leagueFixedLimitBounds(history, stage, BB, currentBet) : null;
      let amount = d.amount ?? 0;
      if (fl) {
        if (action === 'all_in') action = currentBet > 0 ? 'raise' : 'bet';
        if (fl.capped) action = substituteOnCappedStreet(action as never, toCall);
        if (action === 'bet' || action === 'raise') amount = currentBet + fl.raiseSize;
      }
      if (action === 'check' && toCall > 0) action = 'fold';
      if (action === 'call' && toCall === 0) action = 'check';
      if (action === 'bet' && currentBet > 0) action = 'raise';
      if (action === 'raise' && currentBet === 0) action = 'bet';
      if (action !== recommended) tally.corrected = (tally.corrected ?? 0) + 1;
      // V12.3: validation is UNCONDITIONAL. It used to be gated on `counters`
      // being passed, so the chip-conservation tests — which pass none — ran a
      // different code path from production and could never catch an illegal
      // sizing. `tally` keeps the counting optional without changing the path.
      if (action === 'bet' || action === 'raise') {
        const bs = fl
          ? calculateBettingState(pot, currentBet, p.bet, BB, lastRaise, false, fl)
          : calculateBettingState(pot, currentBet, p.bet, BB, lastRaise, vi.isPotLimit);
        if (!validateAction(action as never, amount, p.stack, bs).valid) {
          tally.illegal++;
          action = toCall > 0 ? 'fold' : 'check';
        }
      }
      // 2026-11-15: production stamps who chose a fold on its record
      // (HandController.performAction's accepted origin: a Horse's own answer
      // is horse_policy, a fallback or a refused answer horse_fallback, a
      // person player), and the opponent models read it.
      const foldOrigin: AcceptedActionOrigin =
        humanField?.isHuman(i) === true
          ? 'player'
          : (d as { policyFallback?: string }).policyFallback === 'brain_exception' ||
              action !== d.action
            ? 'horse_fallback'
            : 'horse_policy';

      ts++;
      acted.add(i);
      if (observer?.onAction) {
        const liveBefore = live().length;
        const potBefore = pot;
        const amt =
          action === 'call'
            ? Math.min(toCall, p.stack)
            : action === 'all_in'
              ? p.bet + p.stack
              : amount;
        observer.onAction({
          seatIdx: i,
          stage,
          action,
          amount: amt,
          pot: potBefore,
          toCall,
          liveBefore,
        });
      }
      if (action === 'fold') {
        p.is_folded = true;
        history.push({
          seat: p.seat,
          userId: p.user_id,
          action: 'fold',
          amount: 0,
          timestamp: ts,
          stage,
          origin: foldOrigin,
        } as ActionRecord);
      } else if (action === 'check') {
        history.push({
          seat: p.seat,
          userId: p.user_id,
          action: 'check',
          amount: 0,
          timestamp: ts,
          stage,
        } as ActionRecord);
      } else if (action === 'call') {
        const inc = post(i, toCall);
        pot += inc;
        history.push({
          seat: p.seat,
          userId: p.user_id,
          action: 'call',
          amount: inc,
          timestamp: ts,
          stage,
        } as ActionRecord);
      } else if (action === 'all_in') {
        const target = p.bet + p.stack;
        const inc = post(i, p.stack);
        pot += inc;
        const isFullRaise = target >= currentBet + lastRaise - 1e-9 && target > currentBet;
        // As HandController records it: only an all-in that raises carries
        // isFullRaise; an all-in that only calls carries none.
        const raises = target > currentBet;
        if (target > currentBet) {
          if (isFullRaise) {
            lastRaise = target - currentBet;
            minRaise = lastRaise;
          }
          currentBet = target;
          lastAggressor = i;
          // V12.3 (TDA Rule 44, as HandController.canReopenBetting enforces):
          // a SHORT all-in does not reopen the betting. Players who already
          // acted owe the difference and may call or fold, but may not
          // re-raise. Rebuilding the full queue on any all-in let the
          // simulator model a more permissive game than the engine it tunes,
          // biasing every matchup toward whichever config raises more.
          toActQueue = rebuildQueue(i, isFullRaise, acted);
        }
        history.push({
          seat: p.seat,
          userId: p.user_id,
          action: 'all_in',
          amount: target,
          timestamp: ts,
          stage,
          ...(raises ? { isFullRaise } : {}),
        } as ActionRecord);
      } else {
        // bet / raise to `amount`
        const target = Math.min(amount, p.bet + p.stack);
        // V12.3: floor at 0. `target - p.bet` could go negative on a
        // raise-to below the actor's own street bet, and post() would then
        // ADD chips to the stack and drive `contributed` negative — silent
        // chip creation that chip conservation cannot see.
        const inc = post(i, Math.max(0, target - p.bet));
        pot += inc;
        // V12.3: the real reopening test, not a hard-coded true.
        const reopens = target >= currentBet + lastRaise - 1e-9 && target > currentBet;
        // As HandController records it: every wager that raises the level
        // carries isFullRaise, all-in or not.
        const raises = target > currentBet;
        if (target > currentBet) {
          // A fixed-limit raise leaves lastRaise and minRaise at the street's
          // wager (HandController.performAction: raisedTheBet && !fixed limit).
          if (reopens && !fixedLimit) {
            lastRaise = target - currentBet;
            minRaise = lastRaise;
          }
          currentBet = target;
          lastAggressor = i;
          toActQueue = rebuildQueue(i, reopens, acted);
        }
        history.push({
          seat: p.seat,
          userId: p.user_id,
          action: p.is_all_in ? 'all_in' : action,
          amount: target,
          timestamp: ts,
          stage,
          ...(raises ? { isFullRaise: reopens } : {}),
        } as ActionRecord);
      }
      actions++;
      void lastAggressor;
      if (live().length < 2) return true;
    }
    // V12.3: if we left the loop with players still owing chips, the street
    // was TRUNCATED by MAX_ACTIONS_PER_STREET. Resetting bets here would
    // treat their unpaid debt as matched and let them reach a showdown they
    // never paid for — chip conservation still holds (settlement uses
    // `contributed`), so no test could see it. Fold the debtors and count it.
    if (toActQueue.length > 0) {
      let truncated = false;
      for (const j of toActQueue) {
        const q = seats[j].player;
        if (q.is_folded || q.is_all_in) continue;
        if (currentBet - q.bet > 1e-9) {
          q.is_folded = true;
          truncated = true;
        }
      }
      if (truncated) tally.truncated++;
    }
    // Street over: reset per-street bets.
    for (const s of seats) {
      s.player.bet = 0;
    }
    currentBet = 0;
    minRaise = BB;
    lastRaise = BB;
    return live().length < 2;
  };

  // First live seat left of the dealer — evaluated per street, AFTER folds.
  const firstPostflop = (): number => {
    for (let k = 1; k <= SEATS; k++) {
      const i = idx(dealerSeat + k);
      if (!seats[i].player.is_folded) return i;
    }
    return sbIdx;
  };

  let endedByFolds = runStreet('preflop', SEATS === 2 ? sbIdx : idx(dealerSeat + 3));
  if (!endedByFolds && canAct().length >= 2) endedByFolds = runStreet('flop', firstPostflop());
  if (!endedByFolds && canAct().length >= 2) endedByFolds = runStreet('turn', firstPostflop());
  if (!endedByFolds && canAct().length >= 2) endedByFolds = runStreet('river', firstPostflop());

  // ── Settlement with proper side pots ──
  const winnings = settleLeagueShowdown(
    seats.map((s) => ({ player: s.player, contributed: s.contributed })),
    board,
    gameVariant,
    dealerSeat,
    pot
  );

  // ═══ V16 DEEP-READS HARNESS (2026-08-26) ═══
  // Production learns fold-to-c-bet / fold-to-3-bet / sizing tells from
  // COMPLETED hands at settlement. The league sandbox never ran settlement,
  // so those reads stayed empty and the layer was unmeasurable (stated
  // plainly in the deep-reads PR). Feed the same observation here, inside
  // the SANDBOX so nothing synthetic touches live memory. Showdown identity
  // comes from the same evaluators that settled the pot.
  if (sandbox && learn) {
    try {
      const showdown: Array<{ user_id: string; mucked: boolean; hand_name?: string }> = [];
      const liveSeats = seats.filter((s) => !s.player.is_folded);
      if (liveSeats.length >= 2) {
        for (const s of liveSeats) {
          const score = vi.isOmaha
            ? scoreOmahaHi(s.player.cards, board)
            : scoreHoldem(s.player.cards.concat(board), s.player.cards.length + 5, vi.isShortDeck);
          const cat = Math.floor(score / 0x100000);
          showdown.push({
            user_id: s.player.user_id,
            mucked: false,
            hand_name: CAT_NAMES[cat] ?? '',
          });
        }
      }
      // V45 SCOPED READS: production settles a hand WITH its ReadScope
      // (workerRuntime.ts passes request.scope), so the c-bet, 3-bet and
      // big-bet counters land in the scoped bucket that HorseMind.readStats
      // prefers once that bucket holds SCOPE_MIN_HANDS. This call passed no
      // scope, so in the sandbox the scoped bucket filled with hands (every
      // decision observes under a scope) while its deep-read counters stayed
      // at zero, every read returned null, and v16_deep_reads reported
      // 0.00 +/- 0.00 every night from 2026-09-13 to 09-21: the two arms played
      // byte-identical poker because neither could see a read. Same scope
      // derivation as HorseLogic.decide: variant x dealt count.
      // 2026-10-17: complete the action stream the way production does
      // (workerRuntime observeCompletedHand). observe() only ever saw the
      // prefix each decision was taken on, so the action that ENDS a hand
      // (a river call, a fold to a bet) never reached league memory: every
      // fold/call counter missed its last entry and riverBetOpps stayed 0 for
      // every seat (riverFoldRate null on all 159 reads of a 400-pair probe).
      // With this, 641 of 818 reads in a 2,000-pair probe return a rate.
      // v23_river_reads still changes no decision in self-play: league horses
      // fold rivers 43-88%, so the read only raises bluffScale, which every
      // consumer clamps at 1.2-1.3 where it already sits. Same scope as the
      // decisions; no identity, so the per-action keys equal the ones the
      // decisions recorded and nothing is counted twice.
      const handScope = readScopeOf(gameVariant, seats.length);
      HorseMind.runInSandbox(sandbox, () => {
        const previousScope = HorseMind.currentScope();
        HorseMind.setDecisionScope(handScope);
        try {
          // 2026-11-20: with the hand's betting structure, as production's
          // accepted-hand learner passes it (workerRuntime
          // observeCompletedHandInMind: bettingStructureFor(variant)). Without
          // it every fixed-limit bet a league hand completed was tallied as a
          // probe (FIXED-LIMIT BETS ARE NEVER PROBES is on in production), so
          // league memory held a fixed-limit probe share production never has.
          HorseMind.observe(
            history,
            [],
            undefined,
            undefined,
            BB,
            bettingStructureFor(gameVariant)
          );
        } finally {
          HorseMind.setDecisionScope(previousScope);
        }
        HorseMind.observeHandComplete(
          `league:${ts}`,
          history,
          BB,
          showdown,
          handScope,
          false,
          { variant: gameVariant, boardCount: 1 },
          undefined,
          // the league is cash; the style learner records only when a harness enables it
          'cash',
          // a league hand seats non-Horse policies, the population the Horse reference is built from
          true
        );
      });
      // omahaReadIsByStreetAndTexture (2026-11-18): the street read the option uses, learned the way the
      // accepted-hand learner keeps it, only for a hand a seat's configuration reads it in.
      // omahaFlopVerdictReadsTheBettor (2026-11-19) reads the same record.
      if (
        seats.some(
          (_, i) =>
            configOf(i).omahaReadIsByStreetAndTexture === true ||
            configOf(i).omahaFlopVerdictReadsTheBettor === true ||
            configOf(i).omahaFacingBetValueShareIsMeasured === true
        )
      )
        leagueLearnStreetRead(sandbox, history, board, gameVariant, handScope);
    } catch {
      /* the harness is measurement plumbing — never let it break a deal */
    }
  }

  const net = seats.map((s, i) => winnings[i] - s.contributed);
  if (observer?.onEnd) {
    const shown: Array<{ seatIdx: number; handName: string }> = [];
    if (live().length >= 2)
      seats.forEach((s, seatIdx) => {
        if (s.player.is_folded) return;
        const score = vi.isOmaha
          ? scoreOmahaHi(s.player.cards, board)
          : scoreHoldem(s.player.cards.concat(board), s.player.cards.length + 5, vi.isShortDeck);
        shown.push({ seatIdx, handName: CAT_NAMES[Math.floor(score / 0x100000)] ?? '' });
      });
    observer.onEnd({
      endedByFolds: live().length === 1,
      folded: seats.map((s) => s.player.is_folded),
      cards: seats.map((s) => s.player.cards),
      board,
      net,
      winnings: [...winnings],
      shown,
    });
  }
  return net;
}

/**
 * A human-calibrated seat's decision, read from the same public state and the
 * same no-limit legal menu the simulator enforces on every horse decision
 * (calculateBettingState / validateAction below it in runStreet). The answer
 * still goes through that validation, so a human seat can never take an
 * action the horses could not.
 */
function humanFieldDecision(
  field: LeagueHumanField,
  seatIdx: number,
  p: SeatPlayer,
  stage: HandStage,
  board: Card[],
  gameVariant: string,
  table: {
    pot: number;
    currentBet: number;
    lastRaise: number;
    toCall: number;
    aggressionThisStreet: boolean;
  }
): { action: string; amount?: number } {
  const { pot, currentBet, lastRaise, toCall } = table;
  const legalActions: string[] = [];
  if (toCall > 0) legalActions.push('fold');
  else legalActions.push('check');
  if (toCall > 0 && p.stack > toCall) legalActions.push('call');
  // Pot-limit variants (the Omaha development field only; the calibrated
  // NLH field is never dealt one): a wager may raise to at most the pot
  // after calling (calculateBettingState), and a stack deeper than that cap
  // is not a legal all-in.
  const stackTo = p.bet + p.stack;
  const potCapTo = variantInfo(gameVariant).isPotLimit
    ? currentBet + pot + toCall
    : Number.POSITIVE_INFINITY;
  const maxTo = Math.min(stackTo, potCapTo);
  const minTo = currentBet > 0 ? currentBet + Math.max(BB, lastRaise) : BB;
  const wager = currentBet > 0 ? 'raise' : 'bet';
  const canWager = maxTo > currentBet && maxTo >= minTo;
  if (canWager) legalActions.push(wager);
  if (p.stack > 0 && stackTo <= potCapTo) legalActions.push('all_in');
  const spot: HumanCalibratedSpot = {
    variant: gameVariant,
    stage,
    cards: p.cards,
    board,
    pot,
    toCall,
    currentBet,
    aggressionThisStreet: table.aggressionThisStreet,
    legalActions,
    minRaiseTo: canWager ? minTo : null,
    maxRaiseTo: canWager ? maxTo : null,
    wholeChips: false,
  };
  const profile = field.profileOf?.(seatIdx);
  const d = profile ? humanCalibratedDecide(spot, profile) : humanCalibratedDecide(spot);
  if (field.responses) {
    const tally = (field.responses[d.node] ??= {});
    tally[d.action] = (tally[d.action] ?? 0) + 1;
  }
  return d.amount !== undefined ? { action: d.action, amount: d.amount } : { action: d.action };
}

/**
 * A scripted seat policy's decision (LeagueHumanField.seatPolicyOf): the same
 * legal menu humanFieldDecision offers, pot-limit aware, and the answer goes
 * through the same validation in runStreet.
 */
function seatPolicyDecision(
  policy: LeagueSeatPolicy,
  t: {
    i: number;
    p: SeatPlayer;
    stage: HandStage;
    board: Card[];
    gameVariant: string;
    pot: number;
    currentBet: number;
    lastRaise: number;
    toCall: number;
    numSeats: number;
    dealerSeat: number;
    liveCount: number;
    history: readonly ActionRecord[];
    horseDecide: LeagueSeatSpot['horseDecide'];
  }
): { action: string; amount?: number } {
  const { p, pot, currentBet, lastRaise, toCall } = t;
  const isPotLimit = variantInfo(t.gameVariant).isPotLimit;
  // FIXED LIMIT (2026-11-20, FixedLimitScriptedField.ts): the seat is offered
  // the controller's own fixed-limit menu (the street unit, the cap and the one
  // legal wager), the same menu leagueHorseDecisionInput hands a Horse.
  const fixedMenu = leagueDealsFixedLimit(t.gameVariant)
    ? leagueActionState({
        player: p,
        gameVariant: t.gameVariant,
        pot,
        currentBet,
        lastRaise,
        bigBlind: BB,
        wholeChip: false,
        stage: t.stage,
        history: t.history,
      })
    : null;
  const legalActions: string[] = [];
  if (toCall > 0) legalActions.push('fold');
  else legalActions.push('check');
  if (toCall > 0 && p.stack > toCall) legalActions.push('call');
  const stackTo = p.bet + p.stack;
  const potCapTo = isPotLimit ? currentBet + pot + toCall : Number.POSITIVE_INFINITY;
  const maxTo = Math.min(stackTo, potCapTo);
  const minTo = currentBet > 0 ? currentBet + Math.max(BB, lastRaise) : BB;
  const canWager = maxTo > currentBet && maxTo >= minTo;
  if (canWager) legalActions.push(currentBet > 0 ? 'raise' : 'bet');
  if (p.stack > 0 && stackTo <= potCapTo) legalActions.push('all_in');
  if (fixedMenu) legalActions.splice(0, legalActions.length, ...fixedMenu.legalActions);
  return policy({
    variant: t.gameVariant,
    isPotLimit,
    stage: t.stage,
    seatIdx: t.i,
    numSeats: t.numSeats,
    dealerSeat: t.dealerSeat,
    bigBlind: BB,
    cards: p.cards,
    board: t.board,
    pot,
    toCall,
    currentBet,
    myBet: p.bet,
    stack: p.stack,
    liveCount: t.liveCount,
    legalActions,
    minRaiseTo: fixedMenu ? fixedMenu.minRaiseTo : canWager ? minTo : null,
    maxRaiseTo: fixedMenu ? fixedMenu.maxRaiseTo : canWager ? maxTo : null,
    history: t.history,
    userId: p.user_id,
    horseDecide: t.horseDecide,
  });
}

/**
 * An aggressor-field seat's decision (V53_PRESSURE_POPULATION_ID): the V53
 * workload reads only its own cards and the public state, offered the same
 * no-limit legal menu a calibrated seat gets, and its answer goes through the
 * same validation below. Its randomness comes from the deal's own seeded
 * stream, so both passes of a pair replay it identically until the arms
 * differ. Response counts are kept per street, counts only.
 */
function pressureFieldDecision(
  field: LeagueHumanField,
  p: SeatPlayer,
  gs: HorseGameStateV2,
  currentBet: number,
  lastRaise: number,
  toCall: number
): { action: string; amount?: number } {
  const legalActions: string[] = [];
  if (toCall > 0) legalActions.push('fold');
  else legalActions.push('check');
  if (toCall > 0 && p.stack > toCall) legalActions.push('call');
  const maxTo = p.bet + p.stack;
  const minTo = currentBet > 0 ? currentBet + Math.max(BB, lastRaise) : BB;
  const canWager = maxTo > currentBet && maxTo >= minTo;
  if (canWager) legalActions.push(currentBet > 0 ? 'raise' : 'bet');
  if (p.stack > 0) legalActions.push('all_in');
  const d = pressureOpponentDecision(
    p,
    {
      ...gs,
      legalActions,
      toCall,
      minRaiseTo: canWager ? minTo : null,
      maxRaiseTo: canWager ? maxTo : null,
    } as HorseGameStateV2,
    fastRandom
  );
  if (field.responses) {
    const tally = (field.responses[`v53_field_${gs.stage}`] ??= {});
    tally[d.action] = (tally[d.action] ?? 0) + 1;
  }
  return d.amount !== undefined ? { action: d.action, amount: d.amount } : { action: d.action };
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate-deal matchup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run `pairs` duplicate deals of config A vs config B. Each pair plays the
 * same seed twice with the seat->config assignment inverted, so identical
 * cards flow to both configs and luck cancels in the difference.
 */
/** The mood clock a 'deal_seed' matchup stamps on every decision of one pair:
 *  seconds 0..86,399 of a fixed day, so the hour (moodOf keys on the hour)
 *  is uniform over 0..23 and identical in both passes and both arms. Same
 *  formula as JointStrengthContract.jointMoodClockMs. */
export function dealMoodClockMs(handSeed: number): number {
  return (handSeed % 86_400) * 1000;
}

function withDealMood(opts: HorseDecideOpts, moodClockMs: number | null): HorseDecideOpts {
  return moodClockMs === null ? opts : { ...opts, decisionTimeMs: moodClockMs };
}

/** The league's table for a 'deal_seed' hand identity (a fixed synthetic id). */
const LEAGUE_HAND_TABLE_ID = '1ea90e00-0000-4000-8000-000000000001';

/** The hand a 'deal_seed' matchup stamps on every decision of one pair. */
function withDealHand(opts: HorseDecideOpts, handSeed: number | null): HorseDecideOpts {
  return handSeed === null
    ? opts
    : {
        ...opts,
        mindPlanContext: {
          version: 1,
          hand: {
            version: 1,
            tableId: LEAGUE_HAND_TABLE_ID,
            handNumber: 1_000_000 + (handSeed >>> 0),
          },
        },
      };
}

/** LeagueMatchup.memoryLearning 'off': the decision observes nothing. */
function withLearning(opts: HorseDecideOpts, learn: boolean): HorseDecideOpts {
  return learn ? opts : { ...opts, observeMind: false };
}

/**
 * 2026-11-21: a read-only observer of a human-field card's pairs, for the
 * per-node table of changed decisions the Value row of
 * docs/HORSE-DECISION-CHANGE-EVIDENCE.md asks for (fixedLimitNodeTable.ts).
 * `hand` returns the observer of one pass of pair `pair`; `pair` receives the
 * hero's net of both passes in big blinds. Like LeagueHandObserver it never
 * changes a decision and consumes no randomness, and it is absent on every
 * card the nightly worker deals, so no result changes.
 */
export interface LeagueFieldPairObserver {
  hand(pair: number, pass: 'pass1' | 'pass2'): LeagueHandObserver;
  pair(pair: number, heroNetA: number, heroNetB: number): void;
}

export async function runMatchup(
  matchup: LeagueMatchup,
  pairs: number,
  runSeed: number,
  shouldContinue: () => boolean = () => true,
  /** 2026-11-21: human-field cards only; refused for a mirror card. Absent on every existing caller. */
  pairObserver?: LeagueFieldPairObserver
): Promise<LeagueResult> {
  if (matchup.humanPersona !== undefined && matchup.opponentPopulation === undefined) {
    throw new Error(`${matchup.name}: humanPersona needs a human field (opponentPopulation)`);
  }
  if (matchup.opponentPopulation !== undefined) {
    return runHumanFieldMatchup(matchup, pairs, runSeed, shouldContinue, pairObserver);
  }
  if (pairObserver) {
    throw new Error(`${matchup.name}: a pair observer is for human-field cards only`);
  }
  if (matchup.hybridBaseline === true && matchup.productionStyles === true) {
    throw new Error(
      `${matchup.name}: hybridBaseline and productionStyles both choose the persona; set one`
    );
  }
  const hybrid =
    matchup.hybridBaseline === true
      ? HORSE_HYBRID_PROFILES[
          (matchup.context ?? CASH_LEAGUE_CONTEXT).gameMode === 'tournament' ? 'tournament' : 'cash'
        ]
      : undefined;
  refuseMirrorProcessSwitchSplit(matchup);
  const SEATS = matchup.seats ?? DEFAULT_SEATS;
  const learn = matchup.memoryLearning !== 'off';
  const t0 = Date.now();
  const counters: LeagueCounters = { illegal: 0, truncated: 0 };
  let candidatePolicyHits = 0;
  let candidateExecutionMismatches = 0;
  const candidateNodeRoles = new Set<string>();
  const candidateCells = new Set<string>();
  const perPairDiff: number[] = [];
  // Pairs where the two passes did not settle identically. Zero across a
  // whole matchup means the flag under test changed no decision (see
  // LeagueResult.inert); it is counted on the raw chip figure, before the
  // bb normalisation, so a rounding artefact can never manufacture a difference.
  let divergentPairs = 0;
  // V12.3: before compute isolation this ran inside the dealer process, where
  // HorseEval's module-global RNG was shared with every live decision.
  // Production now calls this only in its worker; the bracket remains part of
  // the simulator's deterministic contract and protects direct test callers.
  const rngBefore = saveFastRandom();
  // V12.2: one sandbox PER PASS, alive for the whole matchup. Pass 1 always
  // plays sandbox 1 and pass 2 always plays sandbox 2, so each accumulates a
  // coherent memory of its own seat assignment; identical configs therefore
  // produce identical evolutions in both sandboxes and the mirror invariant
  // survives mind-on play.
  const sb1 = HorseMind.createSandbox();
  const sb2 = HorseMind.createSandbox();
  // SPOT-SEEDED: probe candidate deals with arm B (or either arm) at every
  // seat, each on a fresh sandbox with learning off, and keep the deals that
  // reach the spot (HorseLeagueSpotSelection.ts); the pass sandboxes never see it.
  const spot = matchup.spot;
  const spotDeals = spot
    ? await selectLeagueSpotDeals(
        spot,
        pairs,
        (c, arm): LeagueSpotProbeHand => {
          const handSeed = (runSeed ^ (c * 2654435761)) >>> 0 || 1;
          const dealerSeat = (c % SEATS) + 1;
          const moodMs = matchup.moodClock === 'deal_seed' ? dealMoodClockMs(handSeed) : null;
          const handId = matchup.handIdentity === 'deal_seed' ? handSeed : null;
          const opts = withLearning(
            withDealHand(withDealMood(arm === 'a' ? matchup.a : matchup.b, moodMs), handId),
            false
          );
          const mods = hybrid
            ? { ...hybrid.mods, ...((arm === 'a' ? matchup.modsA : matchup.modsB) ?? {}) }
            : ((arm === 'a' ? matchup.modsA : matchup.modsB) ?? {});
          const hasMods =
            matchup.modsA !== undefined || matchup.modsB !== undefined || hybrid !== undefined;
          const styleOf = matchup.productionStyles
            ? (s: number) => plo4StrengthSeatStyle(handSeed, s + 1)
            : hybrid
              ? () => hybrid.style
              : undefined;
          const dealt = leagueDealtCards(handSeed, matchup.variant ?? 'nlh', SEATS);
          const hand = leagueSpotProbe(
            spot.predicate,
            dealt,
            () => true,
            false,
            (observer) =>
              playHand(
                handSeed,
                dealerSeat,
                () => opts,
                { illegal: 0, truncated: 0 },
                HorseMind.createSandbox(),
                matchup.variant ?? 'nlh',
                SEATS,
                matchup.stackBB ?? 100,
                matchup.context ?? CASH_LEAGUE_CONTEXT,
                hasMods ? () => mods : undefined,
                undefined,
                styleOf,
                false,
                observer as LeagueHandObserver,
                leaguePairHandClock(c, runSeed)
              )
          );
          spot.observe?.({
            candidate: c,
            pass: arm === 'a' ? 'probe_a' : 'probe_b',
            handSeed,
            dealerSeat,
            cards: hand.cards,
            board: hand.board,
          });
          return hand;
        },
        () => true,
        shouldContinue
      )
    : null;
  const passObserver = (
    candidate: number,
    pass: LeagueSpotPassObservation['pass'],
    handSeed: number,
    dealerSeat: number
  ): LeagueHandObserver | undefined =>
    spot?.observe
      ? {
          onEnd: (e) =>
            spot.observe!({
              candidate,
              pass,
              handSeed,
              dealerSeat,
              cards: e.cards.map((c) => [...c]),
              board: [...e.board],
            }),
        }
      : undefined;
  const pairCount = spotDeals ? spotDeals.kept.length : pairs;

  for (let k = 0; k < pairCount; k++) {
    if (!shouldContinue()) break;
    // V12.3: retain a worker yield every 16 pairs. Production no longer shares
    // this event loop with live poker, but the yield is where CANCEL messages
    // are observed and where the worker sends its liveness heartbeat.
    if (k > 0 && (k & 0x0f) === 0) await new Promise((res) => setImmediate(res));
    // Unselected: pair k is deal k. Spot-seeded: the k-th kept candidate deal.
    const p = spotDeals ? spotDeals.kept[k]! : k;
    const handSeed = (runSeed ^ (p * 2654435761)) >>> 0 || 1;
    const dealerSeat = (p % SEATS) + 1;
    // Both passes of the pair are dealt on one hand clock (leaguePairHandClock).
    const handClock = leaguePairHandClock(p, runSeed);
    const withEvidence = (opts: HorseDecideOpts): HorseDecideOpts => {
      if (!opts.gtoV31DatasetChecksum && !opts.onGtoV31Decision) return opts;
      return {
        ...opts,
        onGtoV31Decision: (receipt) => {
          if (opts.gtoV31DatasetChecksum) {
            if (receipt.executedAsIntended) {
              candidatePolicyHits++;
              candidateNodeRoles.add(receipt.nodeRole);
              candidateCells.add(receipt.sourceSeal.cell_key_checksum);
            } else {
              candidateExecutionMismatches++;
            }
          }
          opts.onGtoV31Decision?.(receipt);
        },
      };
    };
    const moodMs = matchup.moodClock === 'deal_seed' ? dealMoodClockMs(handSeed) : null;
    const handId = matchup.handIdentity === 'deal_seed' ? handSeed : null;
    const evenIsA = (s: number) =>
      withLearning(
        withDealHand(
          withDealMood(withEvidence(s % 2 === 0 ? matchup.a : matchup.b), moodMs),
          handId
        ),
        learn
      );
    const evenIsB = (s: number) =>
      withLearning(
        withDealHand(
          withDealMood(withEvidence(s % 2 === 0 ? matchup.b : matchup.a), moodMs),
          handId
        ),
        learn
      );
    const hasMods =
      matchup.modsA !== undefined || matchup.modsB !== undefined || hybrid !== undefined;
    // Same persona at the same seat in both passes; only the arm swaps.
    const styleOf = matchup.productionStyles
      ? (s: number) => plo4StrengthSeatStyle(handSeed, s + 1)
      : hybrid
        ? () => hybrid.style
        : undefined;
    const modsA = hybrid ? { ...hybrid.mods, ...(matchup.modsA ?? {}) } : (matchup.modsA ?? {});
    const modsB = hybrid ? { ...hybrid.mods, ...(matchup.modsB ?? {}) } : (matchup.modsB ?? {});
    const modsEvenIsA = hasMods ? (s: number) => (s % 2 === 0 ? modsA : modsB) : undefined;
    const modsEvenIsB = hasMods ? (s: number) => (s % 2 === 0 ? modsB : modsA) : undefined;

    const net1 = playHand(
      handSeed,
      dealerSeat,
      evenIsA,
      counters,
      sb1,
      matchup.variant ?? 'nlh',
      SEATS,
      matchup.stackBB ?? 100,
      matchup.context ?? CASH_LEAGUE_CONTEXT,
      modsEvenIsA,
      undefined,
      styleOf,
      learn,
      passObserver(p, 'pass1', handSeed, dealerSeat),
      handClock
    );
    const net2 = playHand(
      handSeed,
      dealerSeat,
      evenIsB,
      counters,
      sb2,
      matchup.variant ?? 'nlh',
      SEATS,
      matchup.stackBB ?? 100,
      matchup.context ?? CASH_LEAGUE_CONTEXT,
      modsEvenIsB,
      undefined,
      styleOf,
      learn,
      passObserver(p, 'pass2', handSeed, dealerSeat),
      handClock
    );

    let aNet = 0;
    for (let s = 0; s < SEATS; s++) {
      aNet += s % 2 === 0 ? net1[s] : -net1[s]; // pass 1: even seats are A
      aNet += s % 2 === 0 ? -net2[s] : net2[s]; // pass 2: odd seats are A
    }
    // aNet counts A-minus-B chips over 2 hands x (SEATS/2) A-seats;
    // normalize to "A's edge in bb per hand pair".
    perPairDiff.push(aNet / 2 / BB);
    if (aNet !== 0) divergentPairs++;
  }

  restoreFastRandom(rngBefore);

  const n = perPairDiff.length;
  const mean = perPairDiff.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const varsum = perPairDiff.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  const sd = Math.sqrt(varsum / Math.max(1, n - 1));
  // V12.3: `perPairDiff[p]` is A's edge in bb summed over SEATS/2 A-seats x 2
  // passes = 6 player-hands. Dividing by that is what makes the number an
  // actual bb/100; without it every figure ever written to
  // horse_league_results was inflated 6x. Ratios and signs are unchanged, so
  // historical comparisons still hold — only the scale was wrong.
  const A_HANDS_PER_PAIR = (SEATS / 2) * 2;
  const stderr = (sd / Math.sqrt(Math.max(1, n)) / A_HANDS_PER_PAIR) * 100;
  const block = blockStandardError(perPairDiff);
  return {
    matchup: matchup.name,
    hands: n * 2,
    bb100: (mean / A_HANDS_PER_PAIR) * 100,
    stderr,
    durationMs: Date.now() - t0,
    illegalActions: counters.illegal,
    truncatedStreets: counters.truncated,
    correctedActions: counters.corrected ?? 0,
    brainExceptionFallbacks: counters.brainFallback ?? 0,
    candidatePolicyHits,
    candidateExecutionMismatches,
    candidateNodeRoles: [...candidateNodeRoles].sort(),
    // Present only when a candidate executed, so every other card keeps its exact shape.
    ...(candidateCells.size > 0 ? { candidateCells: [...candidateCells].sort() } : {}),
    benchmarkComponents: [],
    divergentPairs,
    inert: n > 0 && (divergentPairs === 0 || stderr === 0),
    ...(block
      ? { blockStderr: (block.stderr / A_HANDS_PER_PAIR) * 100, stderrBlocks: block.blocks }
      : {}),
    ...(spot && spotDeals
      ? { spotSelection: leagueSpotSelectionRecord(spot, spotDeals, 'any_horse_seat') }
      : {}),
  };
}

/**
 * The profile a human-field persona plays (LeagueMatchup.humanPersona). Each
 * persona is the population's calibrated NLH profile with named nodes
 * replaced; every other node keeps its calibrated cutoffs. Refuses a persona
 * outside the table it was written for instead of playing it somewhere else.
 *
 * hu_wide_sb_aggressor_v1 (strength is the calibrated preflop percentile, or
 * the postflop equity against one random hand, higher is stronger):
 *   preflop/unopened      fold < 0.20, raise >= 0.30: the small blind plays
 *                         80% of hands, 70% as an open (calibrated: fold
 *                         < 0.61, raise >= 0.81)
 *   preflop/facing_raise  fold < 0.40, raise >= 0.85: defends 60% of big
 *                         blinds and three-bets 15% (calibrated: < 0.65 /
 *                         >= 0.92); the same node answers a three-bet
 *   preflop/free          raises 35% of big blinds over a limp (calibrated 18%)
 *   {flop,turn,river}/checked_to  bets at >= 0.35 / 0.42 / 0.50: stabs when
 *                         checked to (calibrated 0.72 / 0.66 / 0.78)
 *   {flop,turn,river}/facing_bet  calibrated, unchanged
 */
export function humanFieldPersonaProfile(
  persona: HumanFieldPersona,
  table: { population: LeagueOpponentPopulation; variant: string; seats: number }
): Readonly<HumanCalibratedProfile> {
  if (!HUMAN_FIELD_PERSONAS.includes(persona)) {
    throw new Error(`Unknown human-field persona: ${String(persona)}`);
  }
  if (
    persona === FLH_MANIAC_PERSONA ||
    persona === FLH_TIGHT_VALUE_PERSONA ||
    persona === FLH_PASSIVE_CALLER_PERSONA ||
    persona === FLH_OVER_FOLDING_BLINDS_PERSONA ||
    persona === FLH_VALUE_ONLY_BLINDS_PERSONA ||
    persona === FLH_PREFLOP_DEFENDING_BLINDS_PERSONA ||
    persona === FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA
  ) {
    throw new Error(
      `${persona} is a scripted persona of the ${FIXED_LIMIT_SCRIPTED_POPULATION_ID} field ` +
        `(FixedLimitScriptedField.ts), not a calibrated profile; refused for ${table.population} ` +
        `${table.variant} at ${table.seats} seats`
    );
  }
  if (
    persona === NLH_POT_BARRELER_PERSONA ||
    persona === NLH_VALUE_BARRELER_PERSONA ||
    persona === NLH_DANGER_BOARD_BETTOR_PERSONA ||
    persona === NLH_DANGER_BOARD_VALUE_PERSONA ||
    persona === NLH_NASH_OPEN_JAMMER_PERSONA ||
    persona === NLH_TIGHT_JAMMER_PERSONA
  ) {
    throw new Error(
      `${persona} is a scripted persona of the ${NLH_SCRIPTED_POPULATION_ID} field ` +
        `(NlhScriptedField.ts), not a calibrated profile; refused for ${table.population} ` +
        `${table.variant} at ${table.seats} seats`
    );
  }
  if (
    persona === FLO8_HIGH_BARRELER_PERSONA ||
    persona === FLO8_MANIAC_PERSONA ||
    persona === FLO8_TIGHT_VALUE_PERSONA ||
    persona === FLO8_RIVER_FOLDER_PERSONA ||
    persona === FLO8_PASSIVE_CALLER_PERSONA
  ) {
    throw new Error(
      `${persona} is a scripted persona of the ${FLO8_SCRIPTED_POPULATION_ID} field ` +
        `(Flo8ScriptedField.ts), not a calibrated profile; refused for ${table.population} ` +
        `${table.variant} at ${table.seats} seats`
    );
  }
  if (
    persona === PLO8_HU_REC_CALLER_PERSONA ||
    persona === PLO8_HU_TIGHT_BLIND_PERSONA ||
    persona === PLO8_HU_AGGRO_3BETTOR_PERSONA
  ) {
    throw new Error(
      `${persona} is a scripted persona of the ${PLO8_HU_SCRIPTED_POPULATION_ID} field ` +
        `(Plo8HuScriptedField.ts), not a calibrated profile; refused for ${table.population} ` +
        `${table.variant} at ${table.seats} seats`
    );
  }
  if (persona === OMAHA_VALUE_LEADER_FIELD_PERSONA) {
    if (
      table.population !== HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID ||
      !HUMAN_CALIBRATED_OMAHA_DEV_FIELD_VARIANTS.includes(table.variant)
    ) {
      throw new Error(
        `${persona} is a persona of the ${HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID} field; ` +
          `refused for ${table.population} ${table.variant} at ${table.seats} seats`
      );
    }
    const omaha = humanCalibratedProfileFor(table.variant);
    // It sees flops at the calibrated rate (the Horse gets postflop
    // opportunities to measure) but raises only top hands. Postflop it is the value
    // leader HorseOmahaReadConditional reads: checked to it bets only its top
    // hands (no bluffs, so its bet-when-checked-to never reads high), facing a
    // bet it folds more than the calibrated field and raises only its best, and
    // on the river it calls rarely. Every number is a strength cutoff on the
    // seat's own holding; nothing reads the Horse's label.
    return Object.freeze({
      ...omaha,
      id: `${omaha.id}-${persona}`,
      preflop: Object.freeze({ ...omaha.preflop, freeRaise: 0.04 }),
      cutoffs: Object.freeze({
        ...(omaha.cutoffs ?? {}),
        // Passive before the flop: it enters at the calibrated rate (same fold
        // cutoffs) but limps or calls instead of raising unless it holds a top
        // hand, so its own raising disproves the maniac presumption and the
        // read becomes measured (presumedAggressorRead, then
        // omahaReadConditional's `measured`).
        'preflop/unopened': { fold: 0.628469, raise: 0.93 },
        'preflop/facing_raise': { fold: 0.626802, raise: 0.96 },
        'flop/checked_to': { bet: 0.85 },
        'turn/checked_to': { bet: 0.86 },
        'river/checked_to': { bet: 0.88 },
        'flop/facing_bet': { fold: 0.66, raise: 0.88 },
        'turn/facing_bet': { fold: 0.7, raise: 0.9 },
        'river/facing_bet': { fold: 0.78, raise: 0.94 },
      }),
    });
  }
  if (persona === OMAHA_TIGHT_FIELD_PERSONA) {
    if (
      table.population !== HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID ||
      !HUMAN_CALIBRATED_OMAHA_DEV_FIELD_VARIANTS.includes(table.variant)
    ) {
      throw new Error(
        `${persona} is a persona of the ${HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID} field; ` +
          `refused for ${table.population} ${table.variant} at ${table.seats} seats`
      );
    }
    const omaha = humanCalibratedProfileFor(table.variant);
    return Object.freeze({
      ...omaha,
      id: `${omaha.id}-${persona}`,
      preflop: Object.freeze({ ...omaha.preflop, freeRaise: 0.02 }),
      cutoffs: Object.freeze({
        ...(omaha.cutoffs ?? {}),
        'preflop/unopened': { fold: 0.975, raise: 0.98 },
        'preflop/facing_raise': { fold: 0.97, raise: 0.99 },
      }),
    });
  }
  if (
    table.population !== HUMAN_CALIBRATED_POPULATION_ID ||
    table.variant !== 'nlh' ||
    table.seats !== 2
  ) {
    throw new Error(
      `${persona} is a heads-up NLH persona of the ${HUMAN_CALIBRATED_POPULATION_ID} field; ` +
        `refused for ${table.population} ${table.variant} at ${table.seats} seats`
    );
  }
  const base = humanCalibratedProfileFor('nlh');
  const wideCutoffs = {
    ...(base.cutoffs ?? {}),
    'preflop/unopened': { fold: 0.2, raise: 0.3 },
    'preflop/facing_raise': { fold: 0.4, raise: 0.85 },
    'flop/checked_to': { bet: 0.35 },
    'turn/checked_to': { bet: 0.42 },
    'river/checked_to': { bet: 0.5 },
  };
  const wide = {
    ...base,
    id: `${base.id}-${persona}`,
    preflop: Object.freeze({ ...base.preflop, freeRaise: 0.35 }),
  };
  // Strength is a percentile in [0, 1): a cutoff of 0 always passes and a
  // cutoff above 1 never does, so "every hand" and "never" are exact.
  switch (persona) {
    case HU_NIT_BIG_BLIND_PERSONA:
      return Object.freeze({
        ...base,
        id: `${base.id}-${persona}`,
        preflop: Object.freeze({ ...base.preflop, freeRaise: 0.03 }),
        cutoffs: Object.freeze({
          ...(base.cutoffs ?? {}),
          'preflop/unopened': { fold: 0.9, raise: 0.9 },
          'preflop/facing_raise': { fold: 0.91, raise: 0.99 },
        }),
      });
    case HU_FOLD_SB_DEFEND_BB_PERSONA:
      return Object.freeze({
        ...base,
        id: `${base.id}-${persona}`,
        cutoffs: Object.freeze({
          ...(base.cutoffs ?? {}),
          'preflop/unopened': { fold: 0.97, raise: 0.97 },
          'preflop/facing_raise': { fold: 0.55, raise: 0.92 },
        }),
      });
    case HU_WIDE_SB_AGGRESSOR_PERSONA:
      return Object.freeze({ ...wide, cutoffs: Object.freeze(wideCutoffs) });
    case HU_MINRAISE_EVERY_BUTTON_PERSONA:
      return Object.freeze({
        ...wide,
        cutoffs: Object.freeze({ ...wideCutoffs, 'preflop/unopened': { fold: 0, raise: 0 } }),
        sizing: Object.freeze({ preflopRaiseToMultiple: 2 }),
      });
    case HU_LIMP_EVERY_BUTTON_PERSONA:
      return Object.freeze({
        ...wide,
        cutoffs: Object.freeze({ ...wideCutoffs, 'preflop/unopened': { fold: 0, raise: 2 } }),
      });
    case HU_THREE_BET_EVERY_HAND_PERSONA:
      return Object.freeze({
        ...wide,
        cutoffs: Object.freeze({
          ...wideCutoffs,
          'preflop/facing_raise': { fold: 0, raise: 0 },
        }),
      });
    case HU_SMALL_STAB_EVERY_STREET_PERSONA:
      return Object.freeze({
        ...wide,
        cutoffs: Object.freeze({
          ...wideCutoffs,
          'flop/checked_to': { bet: 0 },
          'turn/checked_to': { bet: 0 },
          'river/checked_to': { bet: 0 },
        }),
        sizing: Object.freeze({
          betPotFraction: Object.freeze({ flop: 0.33, turn: 0.33, river: 0.33 }),
        }),
      });
  }
}

/**
 * THE NO-LIMIT PROBE HISTORY (2026-11-20, LeagueMatchup.probeHistoryHands).
 * Plays `hands` no-limit hold'em hands into `sandbox` with learning on: the
 * hero Horse at HUMAN_FIELD_HERO_SEAT on the given options, every other seat
 * on the no-limit probe script, the same seat identities the fixed-limit
 * pairs use, so the field's pooled probe tallies (OpponentStats.ctBets /
 * ctProbes) are what the Horse's memory holds when the fixed-limit hands
 * start. Deals are their own: seeded from the run seed with a separate salt,
 * and dealt on even hand-clock slots, which no pair uses
 * (leaguePairHandClock). Unscored; returns nothing.
 */
export function leagueProbeHistoryWarmup(
  sandbox: HorseMindSandbox,
  hands: number,
  runSeed: number,
  seats: number,
  stackBB: number,
  configOf: (seatIdx: number) => HorseDecideOpts,
  modsOf?: (seatIdx: number) => HorseProfileMods,
  styleOf?: (seatIdx: number) => HorseStyle
): void {
  const field: LeagueHumanField = {
    population: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
    isHuman: (s) => s !== HUMAN_FIELD_HERO_SEAT,
    seatPolicyOf: () => nlhProbeWarmupPolicy,
  };
  for (let w = 0; w < hands; w++) {
    const handSeed = (runSeed ^ 0x5eed9b0b ^ (w * 2654435761)) >>> 0 || 1;
    playHand(
      handSeed,
      (w % seats) + 1,
      configOf,
      { illegal: 0, truncated: 0 },
      sandbox,
      'nlh',
      seats,
      stackBB,
      CASH_LEAGUE_CONTEXT,
      modsOf,
      field,
      styleOf,
      true,
      undefined,
      leaguePairHandClock(w, runSeed) - TS_STRIDE
    );
  }
}

/**
 * STYLE SHIFT RELEASE IS NOISE-AWARE (2026-11-21, option styleShiftReleaseIsNoiseAware): a PROCESS switch (the opponent
 * memory every seat of a sandbox learns), not a decision option. A human-field card has one Horse arm per pass and
 * pass sandbox, so the pass runs with the switch set from its own arm and the previous value is put back; a mirror
 * card seats both arms in one sandbox, so it cannot split the switch and refuses a card whose arms differ on it.
 */
export function withLeagueProcessSwitches<T>(opts: HorseDecideOpts, fn: () => T): T {
  const before = HorseMind.styleShiftReleaseIsNoiseAwareOn();
  HorseMind.setStyleShiftReleaseIsNoiseAware(opts.styleShiftReleaseIsNoiseAware === true);
  try {
    return fn();
  } finally {
    HorseMind.setStyleShiftReleaseIsNoiseAware(before);
  }
}
export function refuseMirrorProcessSwitchSplit(matchup: LeagueMatchup): void {
  if (
    (matchup.a.styleShiftReleaseIsNoiseAware === true) !==
    (matchup.b.styleShiftReleaseIsNoiseAware === true)
  )
    throw new Error(
      `${matchup.name}: styleShiftReleaseIsNoiseAware is a process switch (one opponent memory per sandbox); ` +
        'a mirror card seats both arms in one sandbox, so measure it on a human-field card'
    );
}

/** Seat index the hero horse takes on a human-field card. The dealer button
 *  rotates every pair, so the hero plays every position once per SEATS pairs. */
export const HUMAN_FIELD_HERO_SEAT = 0;

/**
 * HUMAN-FIELD DUPLICATE DEALS (2026-10-24). See LeagueMatchup.opponentPopulation.
 *
 * Everything that makes the mirror card trustworthy is kept, unchanged in
 * kind: the same per-pair deal seed and dealer rotation, the save/restore
 * bracket around the shared strategy RNG, one HorseMind sandbox PER PASS for
 * the whole matchup (pass 1 always arm A, pass 2 always arm B, so each arm's
 * memory of the field is its own and identical arms evolve identical
 * memories), the same street engine, validation and settlement, and the same
 * divergence count, so a flag that changes no decision is reported INERT.
 *
 * What changes is who sits around the hero. Each pass seats the arm under
 * test at HUMAN_FIELD_HERO_SEAT and the human-calibrated population in every
 * other seat; the two passes replay the same seed, so the hero holds the
 * same cards in the same position against the same opponents' cards. The
 * pair difference is (arm A's net) - (arm B's net) on one deal, which is
 * where card luck cancels. bb100 is that difference per 100 hero hands:
 * positive means the layer earns against the field. Each arm's own
 * absolute bb/100 against the field rides along as a benchmark component.
 */
async function runHumanFieldMatchup(
  matchup: LeagueMatchup,
  pairs: number,
  runSeed: number,
  shouldContinue: () => boolean,
  pairObserver?: LeagueFieldPairObserver
): Promise<LeagueResult> {
  const population = matchup.opponentPopulation;
  const fieldVariants = leagueFieldVariants(population);
  if (population === undefined || fieldVariants === null) {
    throw new Error(`Unknown league opponent population: ${String(population)}`);
  }
  const variant = matchup.variant ?? 'nlh';
  if (!fieldVariants.includes(variant)) {
    throw new Error(
      `${matchup.name}: a ${population} card cannot deal ${variant}; that ` +
        `population is qualified for ${fieldVariants.join(', ')} only`
    );
  }
  const SEATS = matchup.seats ?? DEFAULT_SEATS;
  const learn = matchup.memoryLearning !== 'off';
  const HERO = HUMAN_FIELD_HERO_SEAT;
  if (matchup.productionStyles === true) {
    throw new Error(`${matchup.name}: productionStyles is a mirror-card option`);
  }
  // SCRIPTED FIXED-LIMIT FIELD (2026-11-20): every field seat plays the
  // named script (FixedLimitScriptedField.ts) through seatPolicyOf instead of a
  // calibrated profile; the persona is required and must be one of its scripts.
  const scriptedFixedLimit = population === FIXED_LIMIT_SCRIPTED_POPULATION_ID;
  if (
    scriptedFixedLimit &&
    (variant !== 'flh' ||
      !FIXED_LIMIT_SCRIPTED_PERSONAS.includes(matchup.humanPersona as FixedLimitScriptedPersona))
  ) {
    throw new Error(
      `${matchup.name}: a ${population} card deals flh and names one of its scripted personas ` +
        `(${FIXED_LIMIT_SCRIPTED_PERSONAS.join(', ')}); got ${String(matchup.humanPersona)}`
    );
  }
  // SCRIPTED NO-LIMIT FIELD (2026-11-21, NlhScriptedField.ts): the same seating
  // for no-limit hold'em; the persona is required and must be one of its scripts.
  const scriptedNoLimit = population === NLH_SCRIPTED_POPULATION_ID;
  if (
    scriptedNoLimit &&
    (variant !== 'nlh' ||
      !NLH_SCRIPTED_PERSONAS.includes(matchup.humanPersona as NlhScriptedPersona))
  ) {
    throw new Error(
      `${matchup.name}: a ${population} card deals nlh and names one of its scripted personas ` +
        `(${NLH_SCRIPTED_PERSONAS.join(', ')}); got ${String(matchup.humanPersona)}`
    );
  }
  // SCRIPTED FIXED-LIMIT OMAHA HI-LO FIELD (2026-11-21, Flo8ScriptedField.ts):
  // the same seating for fixed-limit Omaha hi-lo; the persona is required.
  const scriptedFlo8 = population === FLO8_SCRIPTED_POPULATION_ID;
  if (
    scriptedFlo8 &&
    (variant !== 'flo8' ||
      !FLO8_SCRIPTED_PERSONAS.includes(matchup.humanPersona as Flo8ScriptedPersona))
  ) {
    throw new Error(
      `${matchup.name}: a ${population} card deals flo8 and names one of its scripted personas ` +
        `(${FLO8_SCRIPTED_PERSONAS.join(', ')}); got ${String(matchup.humanPersona)}`
    );
  }
  // SCRIPTED PLO8 HEADS-UP FIELD (2026-11-21, Plo8HuScriptedField.ts): seats a
  // pure deterministic PLO8 heads-up opponent; requires variant plo8, 2 seats,
  // and one of its scripted personas.
  const scriptedPlo8Hu = population === PLO8_HU_SCRIPTED_POPULATION_ID;
  if (
    scriptedPlo8Hu &&
    (variant !== 'plo8' ||
      SEATS !== 2 ||
      !PLO8_HU_SCRIPTED_PERSONAS.includes(matchup.humanPersona as Plo8HuScriptedPersona))
  ) {
    throw new Error(
      `${matchup.name}: a ${population} card deals plo8 heads-up (2 seats) and names one of its ` +
        `scripted personas (${PLO8_HU_SCRIPTED_PERSONAS.join(', ')}); got variant=${variant} ` +
        `seats=${SEATS} persona=${String(matchup.humanPersona)}`
    );
  }
  const warmupHands = matchup.probeHistoryHands ?? 0;
  if (warmupHands !== 0) {
    if (
      !scriptedFixedLimit ||
      !Number.isSafeInteger(warmupHands) ||
      warmupHands < 0 ||
      warmupHands > LEAGUE_HAND_CLOCK_MAX_PAIRS ||
      matchup.memoryLearning === 'off' ||
      matchup.spot !== undefined
    ) {
      throw new Error(
        `${matchup.name}: probeHistoryHands is a whole number of no-limit hands for a ${FIXED_LIMIT_SCRIPTED_POPULATION_ID} ` +
          'card with learning on and no spot selection'
      );
    }
  }
  const persona =
    matchup.humanPersona === undefined ||
    scriptedFixedLimit ||
    scriptedNoLimit ||
    scriptedFlo8 ||
    scriptedPlo8Hu
      ? undefined
      : humanFieldPersonaProfile(matchup.humanPersona, {
          population,
          variant,
          seats: SEATS,
        });
  // The hero horse's persona and dials (LeagueMatchup.hybridBaseline); the
  // field never reaches HorseLogic, so it is unchanged by them.
  const hybrid =
    matchup.hybridBaseline === true
      ? HORSE_HYBRID_PROFILES[
          (matchup.context ?? CASH_LEAGUE_CONTEXT).gameMode === 'tournament' ? 'tournament' : 'cash'
        ]
      : undefined;
  const t0 = Date.now();
  const counters: LeagueCounters = { illegal: 0, truncated: 0 };
  let candidatePolicyHits = 0;
  let candidateExecutionMismatches = 0;
  const candidateNodeRoles = new Set<string>();
  const candidateCells = new Set<string>();
  const perPairDiff: number[] = [];
  const netA: number[] = [];
  const netB: number[] = [];
  let divergentPairs = 0;
  const responses: Record<string, Record<string, number>> = {};
  const script = scriptedFixedLimit
    ? fixedLimitScriptedPolicy(matchup.humanPersona as FixedLimitScriptedPersona)
    : scriptedNoLimit
      ? nlhScriptedPolicy(matchup.humanPersona as NlhScriptedPersona)
      : scriptedFlo8
        ? flo8ScriptedPolicy(matchup.humanPersona as Flo8ScriptedPersona)
        : scriptedPlo8Hu
          ? plo8HuScriptedPolicy(matchup.humanPersona as Plo8HuScriptedPersona)
          : undefined;
  // The script's answers are tallied per node like a calibrated seat's (counts
  // only), so the result proves the field played. Probe passes get their own tally.
  const scriptedSeat =
    (tally: Record<string, Record<string, number>>): LeagueSeatPolicy =>
    (spot) => {
      const d = script!(spot);
      const node = (tally[fixedLimitScriptedNode(spot)] ??= {});
      node[d.action] = (node[d.action] ?? 0) + 1;
      return d;
    };
  const field: LeagueHumanField = {
    population,
    isHuman: (s) => s !== HERO,
    responses,
    ...(persona ? { profileOf: () => persona } : {}),
    ...(script
      ? {
          seatPolicyOf: (() => {
            const pol = scriptedSeat(responses);
            return () => pol;
          })(),
        }
      : {}),
  };
  const rngBefore = saveFastRandom();
  const sb1 = HorseMind.createSandbox();
  const sb2 = HorseMind.createSandbox();
  let spotRecord: LeagueSpotSelectionRecord | null = null;
  const withEvidence = (opts: HorseDecideOpts): HorseDecideOpts => {
    if (!opts.gtoV31DatasetChecksum && !opts.onGtoV31Decision) return opts;
    return {
      ...opts,
      onGtoV31Decision: (receipt) => {
        if (opts.gtoV31DatasetChecksum) {
          if (receipt.executedAsIntended) {
            candidatePolicyHits++;
            candidateNodeRoles.add(receipt.nodeRole);
            candidateCells.add(receipt.sourceSeal.cell_key_checksum);
          } else {
            candidateExecutionMismatches++;
          }
        }
        opts.onGtoV31Decision?.(receipt);
      },
    };
  };
  const optsA = withLearning(withEvidence(matchup.a), learn);
  const optsB = withLearning(withEvidence(matchup.b), learn);
  const modsA = hybrid ? { ...hybrid.mods, ...(matchup.modsA ?? {}) } : (matchup.modsA ?? {});
  const modsB = hybrid ? { ...hybrid.mods, ...(matchup.modsB ?? {}) } : (matchup.modsB ?? {});
  const styleOf = hybrid ? () => hybrid.style : undefined;
  const spot = matchup.spot;

  try {
    // NO-LIMIT PROBE HISTORY: each pass sandbox learns the field's no-limit
    // probes first, the hero on that pass's own arm (LeagueMatchup.probeHistoryHands).
    if (warmupHands > 0) {
      withLeagueProcessSwitches(matchup.a, () =>
        leagueProbeHistoryWarmup(
          sb1,
          warmupHands,
          runSeed,
          SEATS,
          matchup.stackBB ?? 100,
          () => optsA,
          () => modsA,
          styleOf
        )
      );
      withLeagueProcessSwitches(matchup.b, () =>
        leagueProbeHistoryWarmup(
          sb2,
          warmupHands,
          runSeed,
          SEATS,
          matchup.stackBB ?? 100,
          () => optsB,
          () => modsB,
          styleOf
        )
      );
    }
    // SPOT-SEEDED: the probe plays the hero on arm B (or either arm) against
    // the same field, on a fresh sandbox with learning off and its own response
    // tally (HorseLeagueSpotSelection.ts); the pass sandboxes never see it.
    const probeResponses: Record<string, Record<string, number>> = {};
    const probeField: LeagueHumanField = {
      ...field,
      responses: probeResponses,
      ...(script
        ? {
            seatPolicyOf: (() => {
              const pol = scriptedSeat(probeResponses);
              return () => pol;
            })(),
          }
        : {}),
    };
    const spotDeals = spot
      ? await selectLeagueSpotDeals(
          spot,
          pairs,
          (c, arm): LeagueSpotProbeHand => {
            const handSeed = (runSeed ^ (c * 2654435761)) >>> 0 || 1;
            const dealerSeat = (c % SEATS) + 1;
            const moodMs = matchup.moodClock === 'deal_seed' ? dealMoodClockMs(handSeed) : null;
            const opts = withDealHand(
              withDealMood(withLearning(arm === 'a' ? matchup.a : matchup.b, false), moodMs),
              matchup.handIdentity === 'deal_seed' ? handSeed : null
            );
            const mods = arm === 'a' ? modsA : modsB;
            const dealt = leagueDealtCards(handSeed, variant, SEATS);
            const hand = leagueSpotProbe(
              spot.predicate,
              dealt,
              (s) => s === HERO,
              true,
              (observer) =>
                withLeagueProcessSwitches(arm === 'a' ? matchup.a : matchup.b, () =>
                  playHand(
                    handSeed,
                    dealerSeat,
                    () => opts,
                    { illegal: 0, truncated: 0 },
                    HorseMind.createSandbox(),
                    variant,
                    SEATS,
                    matchup.stackBB ?? 100,
                    matchup.context ?? CASH_LEAGUE_CONTEXT,
                    () => mods,
                    probeField,
                    styleOf,
                    false,
                    observer as LeagueHandObserver,
                    leaguePairHandClock(c, runSeed)
                  )
                )
            );
            spot.observe?.({
              candidate: c,
              pass: arm === 'a' ? 'probe_a' : 'probe_b',
              handSeed,
              dealerSeat,
              cards: hand.cards,
              board: hand.board,
            });
            return hand;
          },
          (s) => s === HERO,
          shouldContinue
        )
      : null;
    spotRecord = spot && spotDeals ? leagueSpotSelectionRecord(spot, spotDeals, 'hero') : null;
    const pairCount = spotDeals ? spotDeals.kept.length : pairs;
    for (let k = 0; k < pairCount; k++) {
      if (!shouldContinue()) break;
      if (k > 0 && (k & 0x0f) === 0) await new Promise((res) => setImmediate(res));
      // Unselected: pair k is deal k. Spot-seeded: the k-th kept candidate deal.
      const p = spotDeals ? spotDeals.kept[k]! : k;
      const handSeed = (runSeed ^ (p * 2654435761)) >>> 0 || 1;
      const dealerSeat = (p % SEATS) + 1;
      const moodMs = matchup.moodClock === 'deal_seed' ? dealMoodClockMs(handSeed) : null;
      const spotObserver = (pass: 'pass1' | 'pass2'): LeagueHandObserver | undefined =>
        spot?.observe
          ? {
              onEnd: (e) =>
                spot.observe!({
                  candidate: p,
                  pass,
                  handSeed,
                  dealerSeat,
                  cards: e.cards.map((c) => [...c]),
                  board: [...e.board],
                }),
            }
          : undefined;
      // 2026-11-21: the pair observer, when one is passed, sees the same pass beside the spot observer.
      const observer = (pass: 'pass1' | 'pass2'): LeagueHandObserver | undefined => {
        const own = spotObserver(pass);
        if (!pairObserver) return own;
        const extra = pairObserver.hand(p, pass);
        if (!own) return extra;
        return {
          onAction: (e) => {
            own.onAction?.(e);
            extra.onAction?.(e);
          },
          onEnd: (e) => {
            own.onEnd?.(e);
            extra.onEnd?.(e);
          },
        };
      };
      const play = (
        opts: HorseDecideOpts,
        mods: HorseProfileMods,
        sb: HorseMindSandbox,
        pass: 'pass1' | 'pass2'
      ) =>
        playHand(
          handSeed,
          dealerSeat,
          () =>
            withDealHand(
              withDealMood(opts, moodMs),
              matchup.handIdentity === 'deal_seed' ? handSeed : null
            ),
          counters,
          sb,
          variant,
          SEATS,
          matchup.stackBB ?? 100,
          matchup.context ?? CASH_LEAGUE_CONTEXT,
          () => mods,
          field,
          styleOf,
          learn,
          observer(pass),
          // Both passes of the pair are dealt on one hand clock.
          leaguePairHandClock(p, runSeed)
        );
      const a = withLeagueProcessSwitches(matchup.a, () => play(optsA, modsA, sb1, 'pass1'))[HERO];
      const b = withLeagueProcessSwitches(matchup.b, () => play(optsB, modsB, sb2, 'pass2'))[HERO];
      netA.push(a / BB);
      netB.push(b / BB);
      perPairDiff.push((a - b) / BB);
      if (a !== b) divergentPairs++;
      pairObserver?.pair(p, a / BB, b / BB);
    }
  } finally {
    restoreFastRandom(rngBefore);
  }

  const n = perPairDiff.length;
  const meanSe = (xs: number[]): { mean: number; se: number } => {
    const m = xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, xs.length - 1);
    return { mean: m, se: Math.sqrt(v) / Math.sqrt(Math.max(1, xs.length)) };
  };
  const diff = meanSe(perPairDiff);
  const durationMs = Date.now() - t0;
  const stderr = diff.se * 100;
  const block = blockStandardError(perPairDiff);
  const component = (scenario: string, xs: number[]): LeagueBenchmarkComponent => {
    const s = meanSe(xs);
    return {
      scenario,
      hands: xs.length,
      bb100: s.mean * 100,
      stderr: s.se * 100,
      durationMs,
      illegalActions: counters.illegal,
      truncatedStreets: counters.truncated,
      candidatePolicyHits,
      candidateExecutionMismatches,
      candidateNodeRoles: [...candidateNodeRoles].sort(),
    };
  };
  return {
    matchup: matchup.name,
    hands: n * 2,
    bb100: diff.mean * 100,
    stderr,
    durationMs,
    illegalActions: counters.illegal,
    truncatedStreets: counters.truncated,
    correctedActions: counters.corrected ?? 0,
    brainExceptionFallbacks: counters.brainFallback ?? 0,
    candidatePolicyHits,
    candidateExecutionMismatches,
    candidateNodeRoles: [...candidateNodeRoles].sort(),
    // Present only when a candidate executed, so every other card keeps its exact shape.
    ...(candidateCells.size > 0 ? { candidateCells: [...candidateCells].sort() } : {}),
    benchmarkComponents: [
      component(HUMAN_FIELD_COMPONENT_SCENARIOS[0], netA),
      component(HUMAN_FIELD_COMPONENT_SCENARIOS[1], netB),
    ],
    divergentPairs,
    inert: n > 0 && (divergentPairs === 0 || stderr === 0),
    opponentPopulation: population,
    humanResponses: responses,
    ...(block ? { blockStderr: block.stderr * 100, stderrBlocks: block.blocks } : {}),
    ...(spotRecord ? { spotSelection: spotRecord } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nightly league
// ─────────────────────────────────────────────────────────────────────────────

/** The standing card: every strategy layer vs the engine without it. */
// V12.2: the two `mind: 'sandbox'` matchups run with the full HorseMind live
// against isolated state (see runInSandbox) — the gap that used to force v12
// to be validated only by seeded equity-shift tests in HorseEval is closed.
/**
 * The Horse options production switched on on 2026-11-16 (archive
 * plo-handoff-review-01a1cbbd/activation-0106z/ON-LIST.txt): the base of both
 * arms of the Omaha priced-rule cards, whose options act where these are on.
 */
export const OMAHA_LIVE_OPTIONS_20261116: HorseDecideOpts = Object.freeze({
  horseActionTimeIsPublicOnly: true,
  omahaBareOverpairOopFlopCheck: true,
  omahaBigBetIsPotShare: true,
  omahaBigDrawAggression: true,
  omahaBluffCatcherFoldVsValueLeader: true,
  omahaCardImpact: true,
  omahaEliteContinuesVsMeasuredWideThreeBettor: true,
  omahaFacingBetEv: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaManiacReRaiseWidthMeasured: true,
  omahaNoCallColdFourBetWithoutPremium: true,
  omahaNoDrawRaiseOutOfPosition: true,
  omahaOopReraisedPotStrongRange: true,
  omahaOopTurnCheckAfterFlopCall: true,
  omahaOverpairNoOopBarrelVsValueLeader: true,
  omahaPairedBoardFoldRespectsPrice: true,
  omahaPairedRiverNoThinLeadVsValueLeader: true,
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
  omahaPressureNeedsPostflopAggression: true,
  omahaReraiseRangeEarlyPosition: true,
  omahaReraiseRangeOutOfPosition: true,
  omahaReraisedPotFlopContinueNeedsEquityShape: true,
  omahaRiverMediumBetStrongHandCalls: true,
  omahaRiverNutBlockerBluffReachable: true,
  omahaStrategyInTournaments: true,
  omahaStreetPlan: true,
  omahaStrongHandSlowplayMix: true,
  omahaStrongHandValue: true,
  omahaTurnBetNeedsRiverPlan: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaUnderpairNoMultiwayFlopContinue: true,
  omahaVpipFloorByLimp: true,
});
/** The priced rule families (option, card name) and all of them on. */
export const OMAHA_PRICED_FAMILY_CARDS: ReadonlyArray<
  readonly [keyof HorseDecideOpts & string, string]
> = [
  ['omahaTurnRiverRaiseIsPriced', 'turn_river_raise_is_priced'],
  ['omahaDrawRaiseIsPriced', 'draw_raise_is_priced'],
  ['omahaOopTurnBarrelIsPriced', 'oop_turn_barrel_is_priced'],
  ['omahaPairedBoardBetIsPriced', 'paired_board_bet_is_priced'],
  ['omahaBluffShareFromBetRate', 'bluff_share_from_bet_rate'],
  ['omahaFacingBetRangeIsContinuous', 'facing_bet_range_is_continuous'],
  ['omahaPressureIsPriced', 'pressure_is_priced'],
  ['omahaBigBetCallsArePriced', 'big_bet_calls_are_priced'],
  ['omahaUnderpairMultiwayIsPriced', 'underpair_multiway_is_priced'],
];
/** The priced sites of the 2026-11-18 option batch (option, card name). */
export const OMAHA_PRICED_SITE_CARDS: ReadonlyArray<
  readonly [keyof HorseDecideOpts & string, string]
> = [
  ['omahaFlopBetIsPriced', 'flop_bet_is_priced'],
  ['omahaMadeHandBetIsPriced', 'made_hand_bet_is_priced'],
  ['omahaTurnSetSizeIsPriced', 'turn_set_size_is_priced'],
  ['omahaBlockerBluffIsPriced', 'blocker_bluff_is_priced'],
];
/** The priced2 inputs of the 2026-11-18 option batch (option, card name); both arms carry every family on. */
export const OMAHA_PRICED_INPUT_CARDS: ReadonlyArray<
  readonly [keyof HorseDecideOpts & string, string]
> = [
  ['omahaPricedPriorsByOpponentKind', 'priced_priors_by_opponent_kind'],
  ['omahaRaiseEvCountsLossesOnce', 'raise_ev_counts_losses_once'],
  // 2026-11-19: the sampled raise (omahaDrawRaiseIsPriced, omahaPressureIsPriced) priced at every legal size
  ['omahaSampledRaiseIsPricedAtEverySize', 'sampled_raise_is_priced_at_every_size'],
];
export const OMAHA_PRICED_FAMILIES_ON: HorseDecideOpts = Object.freeze(
  Object.fromEntries(OMAHA_PRICED_FAMILY_CARDS.map(([option]) => [option, true]))
) as HorseDecideOpts;
/**
 * Production's live Omaha set on 2026-11-18: the 2026-11-16 list plus
 * omahaTurnRiverRaiseIsPriced (switched on 2026-11-18 11:54Z, inbox). The base
 * of both arms of the 2026-11-18 batch cards whose option acts inside, or
 * reads through, the live rules; arm A adds the one option.
 */
export const OMAHA_LIVE_OPTIONS_20261118: HorseDecideOpts = Object.freeze({
  ...OMAHA_LIVE_OPTIONS_20261116,
  omahaTurnRiverRaiseIsPriced: true,
});

/**
 * Production's live Omaha set on 2026-11-20 at 7 PM Chicago: every Omaha row ON in
 * public.ca_horse_style_switch then (read-only read by the Horse SWITCH lane), after
 * the day's rows: omahaRiverCurrentNutsCallFloor ON 16:38, omahaBluffCatcherFoldVsValueLeader
 * OFF 17:31, omahaTurnBetNeedsRiverPlan OFF 18:08 (Chicago). Options whose row is OFF
 * are absent (their release default, off).
 */
export const OMAHA_LIVE_OPTIONS_20261120: HorseDecideOpts = Object.freeze({
  horseActionTimeIsPublicOnly: true,
  omahaBareOverpairOopFlopCheck: true,
  omahaBigBetIsPotShare: true,
  omahaBigDrawAggression: true,
  omahaCardImpact: true,
  omahaEliteContinuesVsMeasuredWideThreeBettor: true,
  omahaFacingBetEv: true,
  omahaFlopFacingBetEv: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaManiacReRaiseWidthMeasured: true,
  omahaNoCallColdFourBetWithoutPremium: true,
  omahaNoDrawRaiseOutOfPosition: true,
  omahaOopReraisedPotStrongRange: true,
  omahaOverpairNoOopBarrelVsValueLeader: true,
  omahaPairedBoardFoldRespectsPrice: true,
  omahaPairedRiverNoThinLeadVsValueLeader: true,
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
  omahaPreflopReraiseDefencePricedInPosition: true,
  omahaReraiseRangeEarlyPosition: true,
  omahaRiverCurrentNutsCallFloor: true,
  omahaRiverMediumBetStrongHandCalls: true,
  omahaStrategyInTournaments: true,
  omahaStreetPlan: true,
  omahaStrongHandValue: true,
  omahaTurnRiverRaiseIsPriced: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaUnderpairNoMultiwayFlopContinue: true,
  omahaValueSizeIsUnreadable: true,
  omahaVpipFloorByLimp: true,
});
/**
 * 2026-11-20 (Horse SWITCH lane, task #6) THE VALUE-LEADER RULES: they act only
 * against a measured postflop value leader (HorseOmahaReadConditional), which Horse
 * self-play never produces, so before OMAHA_VALUE_LEADER_FIELD_PERSONA no card could
 * grade them.
 */
export const VALUE_LEADER_FIELD_RULES: ReadonlyArray<keyof HorseDecideOpts & string> =
  Object.freeze([
    'omahaMadeHandDefenseVsValueLeader',
    'omahaBluffCatcherFoldVsValueLeader',
    'omahaOverpairNoOopBarrelVsValueLeader',
    'omahaPairedRiverNoThinLeadVsValueLeader',
    'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
  ]);
/**
 * One card per value-leader rule and Omaha variant: both arms play production's live
 * set against the value-leader field; arm A has the rule ON, arm B has it OFF (the
 * only difference). A rule whose live row is OFF (omahaBluffCatcherFoldVsValueLeader
 * since 17:31) is measured as "switch it back on" (A adds it); a live rule as
 * "switch it off" (B removes it). Measurement only: no row follows from a card.
 * They seat the Omaha DEVELOPMENT field, which is never on the nightly card
 * (HorseLeagueSpotConditioned.test.ts), so they are DEVELOPMENT_LEAGUE_CARDS, not
 * LEAGUE_MATCHUPS.
 */
export const VALUE_LEADER_FIELD_CARDS: LeagueMatchup[] = (['plo4', 'plo5'] as const).flatMap(
  (variant) =>
    VALUE_LEADER_FIELD_RULES.map((rule) => {
      const live = OMAHA_LIVE_OPTIONS_20261120 as Record<string, unknown>;
      const base = Object.fromEntries(
        Object.entries(live).filter(([k]) => k !== rule)
      ) as HorseDecideOpts;
      return {
        name: `${variant}_value_leader_field_${rule}`,
        variant,
        pairs: 6000,
        opponentPopulation: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
        humanPersona: OMAHA_VALUE_LEADER_FIELD_PERSONA,
        a: { ...base, [rule]: true } as HorseDecideOpts,
        b: base,
      };
    })
);

/**
 * HOLD'EM BLANKET-OFF CANDIDATE CARDS (2026-11-21, Horse Switch lane):
 * The three clean Hold'em blanket-off candidates from
 * REVIEW-HOLDEM-OFFLIST-20261121.md whose OFF path routes directly to V38
 * priced logic without coupling a second rule or reinstating another fixed rule:
 *   1. v80TopPairStrongKicker  (35/day; Burls/owner top-pair cell A, strong kicker)
 *   2. v79TopPairWeakKicker    (82/day; Burls/owner top-pair cell A/B, weak kicker)
 *   3. v68TurnAirDrawCalls     (706/day; turn high-card air shade + stack implied-odds veto)
 *
 * Each candidate gets a cash6 primary card (6 seats, 100bb NLH cash) and a hu
 * guard card (2 seats, 100bb NLH cash). Arm A switches the single blanket rule
 * OFF (`false`); arm B is `{}` (release default, rule ON). Note that v79 and v80
 * exclude heads-up tables (`headsUpTable: true`) in v79InMeasuredCell /
 * v80InMeasuredCell, so their hu cards are inert guards proving HU tables stay
 * untouched, while v68 is active in both cash6 and hu.
 *
 * These are DEVELOPMENT_LEAGUE_CARDS, never LEAGUE_MATCHUPS: the nightly worker
 * never deals them, they take no part in rotation, and they are run by exact
 * name via `src/scripts/horseLeagueCard.ts --card=<name> --seed=<n>`.
 */
export const HOLDEM_BLANKET_OFF_CANDIDATE_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: 'cash6_v80_top_pair_strong_kicker_off',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v80TopPairStrongKicker: false },
    b: {},
  },
  {
    name: 'hu_v80_top_pair_strong_kicker_off',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v80TopPairStrongKicker: false },
    b: {},
  },
  {
    name: 'cash6_v79_top_pair_weak_kicker_off',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v79TopPairWeakKicker: false },
    b: {},
  },
  {
    name: 'hu_v79_top_pair_weak_kicker_off',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v79TopPairWeakKicker: false },
    b: {},
  },
  {
    name: 'cash6_v68_turn_air_draw_calls_off',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v68TurnAirDrawCalls: false },
    b: {},
  },
  {
    name: 'hu_v68_turn_air_draw_calls_off',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v68TurnAirDrawCalls: false },
    b: {},
  },
]);

/**
 * 2026-11-22 Horse Switch lane (Wave 10.1): dark dev-only NLH tournament cards
 * grading `holdemTournamentAggressionIsPriced` (EV + ICM priced postflop
 * replacement for `v57TournamentAggression`) across 6-max BBA MTT, 6-max Final
 * Table ICM MTT, and 2-max HU MTT. Arm A switches the priced postflop layer ON
 * alongside v57TournamentAggression; Arm B keeps legacy v57TournamentAggression.
 * Strictly in DEVELOPMENT_LEAGUE_CARDS, never LEAGUE_MATCHUPS.
 */
export const HOLDEM_TOURNAMENT_AGGRESSION_PRICED_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: 'mtt6_holdem_tournament_aggression_is_priced',
    variant: 'nlh',
    seats: 6,
    stackBB: 30,
    context: bigBlindAnteMttContext(6, 30),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v57TournamentAggression: true, holdemTournamentAggressionIsPriced: true },
    b: { v57TournamentAggression: true },
  },
  {
    name: 'mtt6_ft_holdem_tournament_aggression_is_priced',
    variant: 'nlh',
    seats: 6,
    stackBB: 25,
    context: finalTableMttWithStacksContext(6, 25),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v57TournamentAggression: true, holdemTournamentAggressionIsPriced: true },
    b: { v57TournamentAggression: true },
  },
  {
    name: 'mtt_hu_holdem_tournament_aggression_is_priced',
    variant: 'nlh',
    seats: 2,
    stackBB: 25,
    context: finalTableMttContext(2, 25),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v57TournamentAggression: true, holdemTournamentAggressionIsPriced: true },
    b: { v57TournamentAggression: true },
  },
]);

/**
 * DEVELOPMENT CARDS: declared like a nightly card and dealt by the same
 * runMatchup, but by name only, for a declared grade run
 * (src/scripts/horseLeagueCard.ts --card=<name>). They are NOT in LEAGUE_MATCHUPS:
 * the nightly worker never deals them, they take no part in the rotation, and no
 * row of horse_league_results comes from one. A card belongs here when its field
 * is a development field (HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID), which the
 * nightly card may not seat, or when it is a development candidate card graded by
 * name only.
 */
/**
 * 2026-11-24 PLO-OWNER lead-6 grade cards (development: dealt by name only, never nightly). The corrected PLO4/PLO5
 * facing-bet price as a set and in its three parts, at heads-up, 6-max and 9-max: b is today's live facing-bet
 * verdicts (omahaFacingBetEv, omahaFlopFacingBetEv), a adds the options. Same seeds both sides (duplicate pairs).
 */
const PLO_FACING_BET_PRICED_GRADE_PARTS: ReadonlyArray<readonly [string, HorseDecideOpts]> = [
  [
    'all',
    {
      omahaFacingBetRangeIsMeasuredByLine: true,
      omahaFacingBetIndifferenceCalls: true,
      omahaFlopRealizationIsPriced: true,
      omahaFacingBetMinimumDefencePrior: true,
      omahaFacingBetFieldIsJoint: true,
      omahaMultiwayCallNeedsNutShare: true,
      omahaMultiwayValueBetIsPriced: true,
    },
  ],
  ['f3', { omahaFlopRealizationIsPriced: true }],
  [
    'f1f2f6',
    {
      omahaFacingBetRangeIsMeasuredByLine: true,
      omahaFacingBetIndifferenceCalls: true,
      omahaFacingBetMinimumDefencePrior: true,
    },
  ],
  [
    'm1m2m3',
    {
      omahaFacingBetFieldIsJoint: true,
      omahaMultiwayCallNeedsNutShare: true,
      omahaMultiwayValueBetIsPriced: true,
    },
  ],
  ['m3', { omahaMultiwayValueBetIsPriced: true }],
];
const PLO_FACING_BET_PRICED_GRADE_CARDS: LeagueMatchup[] = (['plo4', 'plo5'] as const).flatMap(
  (variant) =>
    PLO_FACING_BET_PRICED_GRADE_PARTS.flatMap(([part, on]) =>
      ([2, 6, 9] as const).map((seats) => ({
        name: `${variant}_omaha_facing_bet_priced_grade_${part}_${seats === 2 ? 'hu' : seats + 'max'}`,
        variant,
        seats,
        pairs: 6000,
        productionStyles: true,
        a: { omahaFacingBetEv: true, omahaFlopFacingBetEv: true, ...on },
        b: { omahaFacingBetEv: true, omahaFlopFacingBetEv: true },
      }))
    )
);
/**
 * The flop call tree against the live switches of 2026-11-24 after 07:08Z (omahaFacingBetEv on, omahaFlopFacingBetEv
 * off): b is that live set, a adds omahaFlopRealizationIsPriced alone. Development cards, dealt by name only.
 */
const PLO_FLOP_CALL_TREE_VS_LIVE_CARDS: LeagueMatchup[] = (['plo4', 'plo5'] as const).flatMap(
  (variant) =>
    ([2, 6, 9] as const).map((seats) => ({
      name: `${variant}_omaha_facing_bet_priced_grade_f3live_${seats === 2 ? 'hu' : seats + 'max'}`,
      variant,
      seats,
      pairs: 6000,
      productionStyles: true,
      a: { omahaFacingBetEv: true, omahaFlopRealizationIsPriced: true },
      b: { omahaFacingBetEv: true },
    }))
);
/**
 * 2026-11-26 PLO-OWNER lead-7 lane plo-postflop: the live PLO4/PLO5 option rows of 2026-11-26 05:45Z as decide options
 * (the omaha* rows on, and horseActionTimeIsPublicOnly), the b arm of the river opening cards below.
 */
export const OMAHA_LIVE_OPTIONS_20261126: HorseDecideOpts = Object.freeze({
  horseActionTimeIsPublicOnly: true,
  omahaBareOverpairOopFlopCheck: true,
  omahaBigBetIsPotShare: true,
  omahaBigDrawAggression: true,
  omahaBlanketRowsOffInPlo45Cash: true,
  omahaCardImpact: true,
  omahaEliteContinuesVsMeasuredWideThreeBettor: true,
  omahaFacingBetEv: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaManiacReRaiseWidthMeasured: true,
  omahaMathCorePlo5Flop: true,
  omahaNoCallColdFourBetWithoutPremium: true,
  omahaNoDrawRaiseOutOfPosition: true,
  omahaOopReraisedPotStrongRange: true,
  omahaOpponentLifetimeHud: true,
  omahaOverpairNoOopBarrelVsValueLeader: true,
  omahaPairedBoardFoldRespectsPrice: true,
  omahaPairedRiverNoThinLeadVsValueLeader: true,
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
  omahaPreflopReraiseDefencePricedInPosition: true,
  omahaPricedRaiseNeverMakesNonNutRaise: true,
  omahaReraiseRangeEarlyPosition: true,
  omahaRiverCurrentNutsCallFloor: true,
  omahaRiverMediumBetStrongHandCalls: true,
  omahaStrategyInTournaments: true,
  omahaStrongHandValue: true,
  omahaTurnRiverRaiseIsPriced: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaValueSizeIsUnreadable: true,
  omahaVpipFloorByLimp: true,
} as HorseDecideOpts);
/**
 * 2026-11-26 PLO-OWNER lead-7 lane plo-postflop grade cards (development: dealt by name only, never nightly): the
 * heads-up river opening bet (omahaRiverValueBetInPositionIsPriced, omahaRiverBluffIsPricedOnBlockers), each alone,
 * heads-up and 6-max: b is the live set of 2026-11-26, a adds the option. Same seeds both sides (duplicate pairs).
 */
const PLO_RIVER_OPENING_GRADE_PARTS: ReadonlyArray<readonly [string, HorseDecideOpts]> = [
  ['value', { omahaRiverValueBetInPositionIsPriced: true }],
  ['bluff', { omahaRiverBluffIsPricedOnBlockers: true }],
  ['tripsboat', { omahaRiverTripsBoardBoatIsNotNutClass: true }],
  ['flopraise', { omahaFlopRaiseIsPriced: true }],
];
const PLO_RIVER_OPENING_GRADE_CARDS: LeagueMatchup[] = (['plo4', 'plo5'] as const).flatMap(
  (variant) =>
    PLO_RIVER_OPENING_GRADE_PARTS.flatMap(([part, on]) =>
      ([2, 6] as const).map((seats) => ({
        name: `${variant}_${part === 'flopraise' ? 'omaha_flop_raise_priced' : 'omaha_river_opening_' + part}_${seats === 2 ? 'hu' : '6max'}`,
        variant,
        seats,
        pairs: 6000,
        productionStyles: true,
        a: { ...OMAHA_LIVE_OPTIONS_20261126, ...on },
        b: { ...OMAHA_LIVE_OPTIONS_20261126 },
      }))
    )
);
/**
 * 2026-11-26 PLO-OWNER lead-7 lane plo-bluffs grade cards (development: dealt by name only, never nightly): the
 * heads-up turn and river opening bluff (omahaTurnBluffIsPricedOnBlockers, omahaTurnBluffIsPricedOnRangeAdvantage,
 * omahaRiverBluffIsPricedOnRangeAdvantage, and omahaRiverBluffIsPricedOnBlockers with people's fold prior), each alone, heads-up and 6-max: b is the live set of 2026-11-26, a adds
 * the option. Same seeds both sides (duplicate pairs).
 */
const PLO_OPENING_BLUFF_GRADE_PARTS: ReadonlyArray<readonly [string, HorseDecideOpts]> = [
  ['turn_blockers', { omahaTurnBluffIsPricedOnBlockers: true }],
  ['turn_range', { omahaTurnBluffIsPricedOnRangeAdvantage: true }],
  ['river_blockers', { omahaRiverBluffIsPricedOnBlockers: true }],
  ['river_range', { omahaRiverBluffIsPricedOnRangeAdvantage: true }],
];
const PLO_OPENING_BLUFF_GRADE_CARDS: LeagueMatchup[] = (['plo4', 'plo5'] as const).flatMap(
  (variant) =>
    PLO_OPENING_BLUFF_GRADE_PARTS.flatMap(([part, on]) =>
      ([2, 6] as const).map((seats) => ({
        name: `${variant}_omaha_opening_bluff_${part}_${seats === 2 ? 'hu' : '6max'}`,
        variant,
        seats,
        pairs: 6000,
        productionStyles: true,
        a: { ...OMAHA_LIVE_OPTIONS_20261126, ...on },
        b: { ...OMAHA_LIVE_OPTIONS_20261126 },
      }))
    )
);
export const DEVELOPMENT_LEAGUE_CARDS: readonly LeagueMatchup[] = Object.freeze([
  ...PLO_RIVER_OPENING_GRADE_CARDS,
  ...PLO_OPENING_BLUFF_GRADE_CARDS,
  ...VALUE_LEADER_FIELD_CARDS,
  ...HOLDEM_BLANKET_OFF_CANDIDATE_CARDS,
  ...PLO_FACING_BET_PRICED_GRADE_CARDS,
  ...PLO_FLOP_CALL_TREE_VS_LIVE_CARDS,
  // 2026-11-21 Horse Switch lane (holdemPersonaPostflopIsPriced V2 empirical priors, default OFF, dark):
  // both arms carry holdemPersonaPostflop on (its production row); a prices the four V87 spots it scales
  // (range c-bet, turn takeaway, OOP check-trap, check-raise into a stabber) by EV against the line range
  // and measured live NLH empirical priors (holdemEmpiricalPriors.ts), b keeps the persona frequencies.
  // Declared in DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS); graded by name via horseLeagueCard.ts.
  {
    name: 'cash6_holdem_persona_postflop_is_priced',
    seats: 6,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { holdemPersonaPostflop: true, holdemPersonaPostflopIsPriced: true },
    b: { holdemPersonaPostflop: true },
  },
  // The same question heads-up, where every postflop pot is heads-up and all four spots are reachable.
  {
    name: 'hu_holdem_persona_postflop_is_priced',
    seats: 2,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { holdemPersonaPostflop: true, holdemPersonaPostflopIsPriced: true },
    b: { holdemPersonaPostflop: true },
  },
  // 2026-11-22 Horse Switch lane (v87RiverBlockBetTrapIsPriced, default OFF, dark):
  // arm B keeps production v87RiverBlockBetTrap on; arm A switches on its EV-priced replacement
  // (HorseHoldemV87RiverBlockBetTrapIsPriced.ts) at both the OOP river lead and facing-raise sites.
  // Declared in DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS); graded by name via horseLeagueCard.ts.
  {
    name: 'cash6_v87_river_block_bet_trap_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v87RiverBlockBetTrap: true, v87RiverBlockBetTrapIsPriced: true },
    b: { v87RiverBlockBetTrap: true },
  },
  // The same question heads-up, where OOP heads-up river block-bet trap spots are frequent.
  {
    name: 'hu_v87_river_block_bet_trap_is_priced',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v87RiverBlockBetTrap: true, v87RiverBlockBetTrapIsPriced: true },
    b: { v87RiverBlockBetTrap: true },
  },
  // 2026-11-22 Horse Switch lane (holdemCommittedNoPairIsPriced, default OFF, locked off-only
  // pending re-grade after EV pricing repair): dedicated cash6 PRIMARY + HU GUARD cards in
  // DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS) for unified grade-holdem-option.mjs runs.
  {
    name: 'cash6_holdem_committed_no_pair_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { holdemCommittedNoPairIsPriced: true },
    b: {},
  },
  {
    name: 'hu_holdem_committed_no_pair_is_priced',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { holdemCommittedNoPairIsPriced: true },
    b: {},
  },
  // 2026-11-22 Horse Switch lane (holdemRiverBluffIsPriced, default OFF, dark):
  // arm B keeps production riverBluffBaseline on; arm A switches on its EV-priced replacement
  // (HorseHoldemRiverBluffIsPriced.ts) on unopened / checked-to heads-up NLH rivers.
  // Declared in DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS); graded by name via horseLeagueCard.ts.
  {
    name: 'cash6_holdem_river_bluff_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { riverBluffBaseline: true, holdemRiverBluffIsPriced: true },
    b: { riverBluffBaseline: true },
  },
  // The same question heads-up, where unopened / checked-to heads-up NLH rivers are frequent.
  {
    name: 'hu_holdem_river_bluff_is_priced',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { riverBluffBaseline: true, holdemRiverBluffIsPriced: true },
    b: { riverBluffBaseline: true },
  },
  // 2026-11-22 Horse Switch lane (holdemFlopTurnBluffIsPriced, default OFF, dark):
  // arm B keeps production flopTurnBluffBaseline on; arm A switches on its EV-priced replacement
  // (HorseHoldemFlopTurnBluffIsPriced.ts) on unopened / checked-to single-board 2-card NLH flops
  // and turns. Declared in DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS); graded by name via
  // horseLeagueCard.ts.
  {
    name: 'cash6_holdem_flop_turn_bluff_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { flopTurnBluffBaseline: true, holdemFlopTurnBluffIsPriced: true },
    b: { flopTurnBluffBaseline: true },
  },
  // The same question heads-up, where unopened / checked-to NLH flop and turn spots are frequent.
  {
    name: 'hu_holdem_flop_turn_bluff_is_priced',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { flopTurnBluffBaseline: true, holdemFlopTurnBluffIsPriced: true },
    b: { flopTurnBluffBaseline: true },
  },
  // 2026-11-22 Horse Switch lane (holdemRiverBluffMultiwayIsPriced, default OFF, dark):
  // arm B keeps production riverBluffMultiway on; arm A switches on its EV-priced replacement
  // (HorseHoldemRiverBluffMultiwayIsPriced.ts) on unopened / checked-to single-board 2-card NLH
  // multiway rivers (opponents >= 2). Declared in DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS);
  // graded by name via horseLeagueCard.ts.
  {
    name: 'cash6_holdem_river_bluff_multiway_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { riverBluffMultiway: true, holdemRiverBluffMultiwayIsPriced: true },
    b: { riverBluffMultiway: true },
  },
  // Full-ring 9-max guard card: highest multiway river frequency (3-way and 4-way+ rivers).
  {
    name: 'cash9_holdem_river_bluff_multiway_is_priced',
    variant: 'nlh',
    seats: 9,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { riverBluffMultiway: true, holdemRiverBluffMultiwayIsPriced: true },
    b: { riverBluffMultiway: true },
  },
  // Heads-up inert guard card: proves 0 divergent pairs heads-up (strict opponents >= 2 isolation).
  {
    name: 'hu_holdem_river_bluff_multiway_is_priced',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { riverBluffMultiway: true, holdemRiverBluffMultiwayIsPriced: true },
    b: { riverBluffMultiway: true },
  },
  ...HOLDEM_TOURNAMENT_AGGRESSION_PRICED_CARDS,
  // 2026-11-21 Horse Switch lane (v66BetRaisedOnePairIsPriced, default OFF, dark):
  // arm B keeps production V66 on; arm A switches on its EV-priced replacement
  // (HorseHoldemV66RaisedOnePairIsPriced.ts) at the flop/turn bet-then-raised one-pair site.
  // Declared in DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS); graded by name via horseLeagueCard.ts.
  {
    name: 'cash6_v66_bet_raised_one_pair_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v66BetRaisedOnePair: true, v66BetRaisedOnePairIsPriced: true },
    b: { v66BetRaisedOnePair: true },
  },
  // The same question heads-up, where flop/turn bet-then-raised one-pair spots are frequent.
  {
    name: 'hu_v66_bet_raised_one_pair_is_priced',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v66BetRaisedOnePair: true, v66BetRaisedOnePairIsPriced: true },
    b: { v66BetRaisedOnePair: true },
  },
  // 2026-11-22 Horse Switch lane (holdemRiverLeadRangeIsPriced, default OFF, dark):
  // arm B keeps production riverLeadRange on; arm A switches on its EV-priced OOP river lead
  // replacement (HorseHoldemRiverLeadRangeIsPriced.ts) at both the bluff-lead and value-lead sites.
  // Declared in DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS); graded by name via horseLeagueCard.ts.
  {
    name: 'cash6_holdem_river_lead_range_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { riverLeadRange: true, holdemRiverLeadRangeIsPriced: true },
    b: { riverLeadRange: true },
  },
  // The same question heads-up, where OOP river lead spots into the turn aggressor are frequent.
  {
    name: 'hu_holdem_river_lead_range_is_priced',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { riverLeadRange: true, holdemRiverLeadRangeIsPriced: true },
    b: { riverLeadRange: true },
  },
  // 2026-11-22 Horse Switch lane (v67RiverBetRaisedOnePairIsPriced, default OFF, dark):
  // arm B keeps production v67RiverBetRaisedOnePair on; arm A switches on its EV-priced NLH
  // river replacement (HorseV67RiverBetRaisedOnePairPriced.ts) across all three V67 sites
  // (river raise stratum, block-bet raised fold, and v67Class/shade67 committed & V38 overrides).
  // Declared in DEVELOPMENT_LEAGUE_CARDS (never LEAGUE_MATCHUPS); graded by name via horseLeagueCard.ts.
  {
    name: 'cash6_v67_river_bet_raised_one_pair_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v67RiverBetRaisedOnePair: true, v67RiverBetRaisedOnePairIsPriced: true },
    b: { v67RiverBetRaisedOnePair: true },
  },
  // Full-ring 9-max guard card: multiway river raised-bet bluff-catch density.
  {
    name: 'cash9_v67_river_bet_raised_one_pair_is_priced',
    variant: 'nlh',
    seats: 9,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v67RiverBetRaisedOnePair: true, v67RiverBetRaisedOnePairIsPriced: true },
    b: { v67RiverBetRaisedOnePair: true },
  },
  // Heads-up guard card: active HU river bet-then-raised one-pair & block-bet spots.
  {
    name: 'hu_v67_river_bet_raised_one_pair_is_priced',
    variant: 'nlh',
    seats: 2,
    pairs: 6000,
    stackBB: 100,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { v67RiverBetRaisedOnePair: true, v67RiverBetRaisedOnePairIsPriced: true },
    b: { v67RiverBetRaisedOnePair: true },
  },
]);
export const LEAGUE_MATCHUPS: LeagueMatchup[] = [
  { name: 'v11_leak_fixes', a: {}, b: { v11: false } },
  { name: 'v10_strategy', a: {}, b: { v10: false } },
  { name: 'v7_preflop', a: {}, b: { v7Preflop: false } },
  // Full V12 (board-conditioned ranges + river polish) vs the engine without
  // it, both sides with the mind on — the matchup the 2026-08-22 handoff
  // deferred for lack of a pollution-free mind mode.
  { name: 'v12_ranges_river', a: {}, b: { v12: false } },
  // V15 Omaha nut discipline, measured where it lives: a plo6 deal. The
  // other matchups deal NLH, where v15 changes nothing by construction.
  { name: 'plo6_v15_discipline', variant: 'plo6', a: {}, b: { v15: false } },
  // ── V16 (2026-08-26): measure the variants and depths the fleet actually
  // plays. Exploratory pairs counts keep the whole card inside the budget;
  // stderr ~4.6 bb/100 at 6000 pairs — enough to catch layer-scale edges. ──
  { name: 'plo4_v15_discipline', variant: 'plo4', pairs: 6000, a: {}, b: { v15: false } },
  // 2026-11-13 OMAHA NEUTRAL UNKNOWN (omahaNeutralUnknown, default OFF): a
  // reads an unknown Omaha opponent from their own hands only, b presumes an
  // aggressive raiser as today. Promotion needs this card to resolve
  // (docs/changelog/2026-11-13-omaha-neutral-unknown.md).
  ...(['plo4', 'plo5', 'plo6'] as const).map((variant) => ({
    name: `${variant}_omaha_neutral_unknown`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaNeutralUnknown: true },
    b: {},
  })),
  // 2026-11-13 OMAHA TIGHT OPPONENT (omahaTightOpponent, default OFF): a
  // respects a proven tight raiser and steals wider from proven tight
  // folders, b is today's brain. Against a Horse field the evidence standard
  // is rarely met (Horses play inside their own envelope), so this card is
  // expected to be near inert; the declared evaluation is in
  // docs/changelog/2026-11-14-omaha-tight-opponent.md. Against a Horse field the evidence standard
  // is almost never met (Horses play inside their own envelope), so this card
  // is expected to be near inert; the declared evaluation is
  // docs/changelog/2026-11-14-omaha-tight-opponent.md.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_tight_opponent`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaTightOpponent: true },
    b: {},
  })),
  // 2026-11-15 OMAHA BLUFF-CATCHER FOLD (omahaBluffCatcherRaiseFold, default
  // OFF): a folds two pair, sets and non-nut straights and flushes to a raise
  // or a flop-bettor's turn bet of 0.9 pot or more with chips behind; b is
  // today's brain. It ships off because it folds on bet size alone and has no
  // value or continuation measurement (owner 2026-11-14 23:10: no blanket
  // fold); it goes on only after a declared paired evaluation that includes a
  // field raising for value only and a field that bluff-raises.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_bluff_catcher_raise_fold`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaBluffCatcherRaiseFold: true },
    b: {},
  })),
  // 2026-11-15 RESPONSES TO TIGHT PLAYERS (styleTightPlayerExploit, default
  // OFF): a bluffs more when a credibly tight-passive player checks to it on
  // the turn or river and isolates tight limpers wider; b is today's brain.
  // League seats decide with mind off, so no style read engages and this card
  // is expected to be inert; the declared evaluation is the paired synthetic
  // measurement in docs/horse-default-on.d/styleTightPlayerExploit.md.
  // 2026-11-15 STEAL FROM TIGHT BLINDS (styleStealTightBlinds, default OFF and
  // off-only in the switch): a opens wider first in when everyone left to act
  // is credibly tight; b is today's brain. League seats decide with mind off,
  // so no style read engages and this card is expected to be inert.
  {
    name: 'nlh_style_steal_tight_blinds',
    variant: 'nlh',
    pairs: 6000,
    productionStyles: true,
    a: { styleStealTightBlinds: true },
    b: {},
  },
  {
    name: 'nlh_style_tight_player_exploit',
    variant: 'nlh',
    pairs: 6000,
    productionStyles: true,
    a: { styleTightPlayerExploit: true },
    b: {},
  },
  // 2026-11-15 C7 F1 (holdemCallDownExcludesCurrentHand, default OFF): a takes
  // the hand being decided out of the legacy aggression ratio; b is today's.
  // Production observes the hand before the read; a run without learning does
  // not, and there the subtraction is clamped at zero.
  {
    name: 'nlh_call_down_excludes_current_hand',
    pairs: 6000,
    a: { holdemCallDownExcludesCurrentHand: true },
    b: {},
  },
  // 2026-11-15 C7 F2 (holdemCallDownNeedsStyleEvidence, default OFF): a keeps
  // the legacy maniac multiplier neutral when the pooled tallies answer and the
  // style read has no evidence; b is today's. Expected near inert Horse vs Horse.
  {
    name: 'nlh_call_down_needs_style_evidence',
    pairs: 6000,
    a: { holdemCallDownNeedsStyleEvidence: true },
    b: {},
  },
  // 2026-11-15 A GEAR SHIFT IS REACHABLE (holdemGearShiftReach, default OFF): a
  // reads a confirmed regime break on the fast window at the ordinary
  // credibility; b is today's read. Horses do not change gear, so the card is
  // expected to be near inert; its value question is against humans.
  {
    name: 'nlh_gear_shift_reach',
    pairs: 6000,
    a: { holdemGearShiftReach: true },
    b: {},
  },
  // 2026-11-15 SHORT-HANDED MANIAC REACH (holdemManiacShortHandedReach, default
  // OFF): a gives a short-handed or heads-up opponent the maniac width from
  // postflop evidence (bet-when-checked-to high, fold-to-bet low); b is today's
  // read. Six-handed Horse field: expected near inert; its value is against people.
  {
    name: 'nlh_maniac_short_handed_reach',
    pairs: 6000,
    a: { holdemManiacShortHandedReach: true },
    b: {},
  },
  // 2026-11-15 A REGULAR IS NOT A MANIAC (holdemManiacSampleGate, default OFF):
  // a gates the preflop maniac width (15 decayed hands, PFR credibly beyond the
  // size's regular line, 8 decayed 3-bet opportunities); b is today's read.
  // Against a Horse field the maniac width rarely engages, so the card is
  // expected to be near inert; its value question is against humans.
  {
    name: 'nlh_maniac_sample_gate',
    pairs: 6000,
    a: { holdemManiacSampleGate: true },
    b: {},
  },
  // 2026-11-15 TIGHT BEYOND VPIP (styleTightMultiSignal, default OFF): a reads
  // a neutral player tight when VPIP is credibly below the Horse mean and fold
  // to 3-bet or raise share corroborates; b is today's read. The style read is
  // taken only by a style consumer, so both arms switch on the two consumers
  // that see the tight side (#2 and #6); the card measures the read alone.
  // Against a Horse field the route is expected to be near inert.
  {
    name: 'nlh_style_tight_multi_signal',
    pairs: 6000,
    productionStyles: true,
    a: {
      styleTightMultiSignal: true,
      styleValueBettorNotManiac: true,
      styleTightReRaiserRespect: true,
    },
    b: { styleValueBettorNotManiac: true, styleTightReRaiserRespect: true },
  },
  // 2026-11-16 TIGHT AT THE OBSERVATION LINE (styleTightMethodLine, default
  // OFF): a reads a neutral player tight at the observation method's VPIP
  // line (50 or more hands, credibly below the Horse mean, PFR not above the
  // mean); b is today's read. Both arms switch on the two consumers that see
  // the tight side, as the multi-signal card does. Against a Horse field the
  // route is expected to be near inert: the card is a harm check.
  {
    name: 'nlh_style_tight_method_line',
    pairs: 6000,
    productionStyles: true,
    a: {
      styleTightMethodLine: true,
      styleValueBettorNotManiac: true,
      styleTightReRaiserRespect: true,
    },
    b: { styleValueBettorNotManiac: true, styleTightReRaiserRespect: true },
  },
  // 2026-11-15 HOLD'EM RIVER FULL HOUSE VALUE (holdemRiverFullHouseValue,
  // default OFF): a leads a qualifying river full house out of position into
  // the prior aggressor (70%); b checks it, as today. Full houses in that seat
  // are rare, so the card is expected to move little; its evidence is the
  // replay of the audited hands in docs/horse-default-on.d.
  {
    name: 'nlh_river_full_house_value',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemRiverFullHouseValue: true },
    b: {},
  },
  // 2026-11-18 ROWFIX (holdemRiverFullHouseValueIsPriced, default OFF, unevaluated): both arms lead
  // qualifying river boats (holdemRiverFullHouseValue, live); a prices the lead against the check by EV from
  // the aggressor's measured river call and checked-to bet shares, b keeps the fixed 70%. Declared, not run.
  {
    name: 'nlh_river_full_house_value_is_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemRiverFullHouseValue: true, holdemRiverFullHouseValueIsPriced: true },
    b: { holdemRiverFullHouseValue: true },
  },
  // 2026-11-19 NLH price lane (holdemValueAndCallsArePriced, default OFF, unevaluated): a prices the heads-up
  // postflop value raise, the facing-bet call, the strong made hand's bet or check and the river bet against the
  // bettor's line range by EV; b keeps the brain's lines (the random value-raise gate, the V11 gate, the slowplay
  // mix, the block bets). Declared, not run.
  {
    name: 'nlh_holdem_value_and_calls_are_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemValueAndCallsArePriced: true },
    b: {},
  },
  {
    name: 'nlh9_holdem_value_and_calls_are_priced',
    variant: 'nlh',
    seats: 9,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { holdemValueAndCallsArePriced: true },
    b: {},
  },
  // 2026-11-20 Hold'em Strategy lane (holdemCommittedNoPairIsPriced and holdemDangerBoardEquityIsPriced, default OFF,
  // unevaluated): the priced rebuilds of the Antigravity ace-high jam gate and board discipline. a prices, b is the
  // live line. Declared, not run; a Horse field is not the people the measured constants describe.
  {
    name: 'nlh_committed_no_pair_is_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemCommittedNoPairIsPriced: true },
    b: {},
  },
  {
    name: 'nlh_danger_board_equity_is_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemDangerBoardEquityIsPriced: true },
    b: {},
  },
  // 2026-11-22 HORSE DECISIONS lane (horseSlowplayIsPriced, default OFF, Evidence NOT MET on HVH48 D+E n=13 < 20):
  // replaces the H4 monster slowplay coin flip with deterministic EV pricing against empirical fold/stab priors,
  // continuous free-card erosion, and heroBubbleFactor. Declared dark card; OPTION_SWITCH_REFUSED (0 migrations).
  {
    name: 'nlh_horse_slowplay_is_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { horseSlowplayIsPriced: true },
    b: {},
  },
  // 2026-11-22 HORSE DECISIONS lane (v78NoCommittingBluffRaiseIsPriced, default OFF, Evidence NOT MET on HVH48 D+E):
  // replaces the v78 40%-stack committing bluff-raise veto with deterministic EV pricing against empirical fold-to-raise
  // priors and heroBubbleFactor. Declared dark card; OPTION_SWITCH_REFUSED (0 migrations).
  {
    name: 'nlh_v78_committing_bluff_raise_is_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { v78NoCommittingBluffRaiseIsPriced: true },
    b: {},
  },
  // 2026-11-22 HORSE DECISIONS lane (v17PosIsPriced, default OFF, OPTION_SWITCH_REFUSED, 0 migrations):
  // the V17 players-behind bluff table priced from the measured field fold-through. Cash and MTT cards.
  {
    name: 'nlh_v17_pos_is_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { v17PosIsPriced: true },
    b: {},
  },
  {
    name: 'nlh_mtt_v17_pos_is_priced',
    variant: 'nlh',
    pairs: 6000,
    stackBB: 40,
    context: bigBlindAnteMttContext(6, 40),
    a: { v17PosIsPriced: true },
    b: {},
  },
  // 2026-11-21 Hold'em Strategy lane (cashDefenceTrimColdCalls, default OFF):
  // trims V85+V87 non-BTN IP cold-call and multiway double-stacking flatting
  // bloat on NLH cash tables while preserving 3-bet widths, single-raised
  // HU/BB/SB/BTN defends, V85 opens, and tournaments.
  {
    name: 'nlh_cash_9max_trim_cold_calls_mirror',
    variant: 'nlh',
    seats: 9,
    stackBB: 100,
    pairs: 6000,
    productionStyles: true,
    moodClock: 'deal_seed',
    a: { cashDefenceTrimColdCalls: true },
    b: {},
  },
  // 2026-11-14 OMAHA TIGHT STEAL (omahaTightOpponentSteal, default OFF): the
  // steal half of omahaTightOpponent alone, in OMAHA_TIGHT_STEAL_VARIANTS
  // (six-card only). Against a Horse field the evidence standard is rarely
  // met, so this card is expected to be near inert; the declared evaluation
  // is in the PLO6 audit archive (phase1-play/tight-plo6-league).
  {
    name: 'plo6_omaha_tight_opponent_steal',
    variant: 'plo6',
    pairs: 6000,
    productionStyles: true,
    a: { omahaTightOpponentSteal: true },
    b: {},
  },
  // 2026-11-15 OMAHA RE-RAISED POT STACK-OFF, REALISTIC RANGE
  // (omahaReraisedPotStackOffRealistic, default OFF): a prices the re-raised-
  // pot one-pair / low two-pair stack-off against a realistic range and lets a
  // measured over-bluffer keep the call; b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraised_pot_stack_off_realistic`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaReraisedPotStackOffRealistic: true },
    b: {},
  })),
  // 2026-11-15 OMAHA NUT-CLASS VALUE SIZE (omahaNutClassValueSize, default
  // OFF after its evaluation failed): a switches it on, b is today's brain.
  // NOTE: the league's Horse state lacks stateSchemaVersion, legalActions,
  // minRaiseTo and maxRaiseTo, without which this rule returns unchanged
  // (eval3-20261115/AUDIT-SCHEMA-GUARD.md); this card measures nothing until
  // the league supplies them.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_nut_class_value_size`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaNutClassValueSize: true },
    b: {},
  })),
  // 2026-11-19 (WooWoo audit NUT-SIZE): omahaValueSizeIsUnreadable, default OFF: a nut-class full-pot
  // wager stays the full pot at the measured street share, else is sized in the owner's 80-95% band.
  // Both arms carry omahaNutClassValueSize; arm a adds the option. omahaNutClassValueSize is NOT on in
  // production: it is default OFF in source (#10989) and off-only since its failed evaluation (ploFailed,
  // 2026-11-18), so this card's base is not the production base.
  // Same league state caveat as the card above. Declared; not run.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_value_size_is_unreadable`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaNutClassValueSize: true, omahaValueSizeIsUnreadable: true },
    b: { omahaNutClassValueSize: true },
  })),
  // 2026-11-15 HV31 FLOP-5 D1 HEADS-UP POSTFLOP BALANCE
  // (holdemHeadsUpPostflopBalance, default OFF): a switches on the heads-up
  // in-position hold'em c-bet, check-raise defence and turn balance
  // (HorseHeadsUpPostflopBalance.ts; its river part was removed after the
  // solver score); b is today's brain. The solver-side before/after measure
  // is the HV31 B1 tool (flop) and its turn/river bank.
  {
    name: 'nlh_hu_postflop_balance',
    variant: 'nlh',
    pairs: 6000,
    productionStyles: true,
    a: { holdemHeadsUpPostflopBalance: true },
    b: {},
  },
  // 2026-11-15 OMAHA MADE-HAND DEFENCE (omahaBeatenMadeHandDefense) and
  // ONE-PAIR DISCIPLINE (omahaOnePairDiscipline), default OFF after their
  // declared evaluations failed: a switches the rule on, b is today's brain.
  ...(['plo4', 'plo5'] as const).flatMap((variant) => [
    {
      name: `${variant}_omaha_beaten_made_hand_defense`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaBeatenMadeHandDefense: true },
      b: {},
    },
    {
      name: `${variant}_omaha_one_pair_discipline`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaOnePairDiscipline: true },
      b: {},
    },
  ]),
  // 2026-11-15 OMAHA RE-RAISED POT DISCIPLINE, preflop cell
  // (omahaReraisedPotDiscipline, default OFF after its evaluation failed):
  // a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraised_pot_discipline`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaReraisedPotDiscipline: true },
    b: {},
  })),
  // 2026-11-15 OMAHA RE-RAISED POT STACK-OFF FOLD (omahaReraisedPotStackOffFold,
  // default OFF): the postflop half of omahaReraisedPotDiscipline; a turns it
  // on, b is today's brain (the preflop half on in both).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraised_pot_stack_off_fold`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaReraisedPotStackOffFold: true },
    b: {},
  })),
  // 2026-11-15 OMAHA READ-CONDITIONAL DEFENCE (HorseOmahaReadConditional,
  // default OFF): the re-raised-pot preflop fold only against a measured tight
  // re-raiser (omahaReraisedFoldVsTight) and the made-hand turn no-raise and
  // scare-card checks only against measured postflop value leaders
  // (omahaMadeHandDefenseVsValueLeader); a switches one on, b is today's brain.
  // The mirror's memory learning is on (the league default), so the reads
  // engage on the Horses' own measured play.
  ...(['plo4', 'plo5'] as const).flatMap((variant) => [
    {
      name: `${variant}_omaha_reraised_fold_vs_tight`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaReraisedFoldVsTight: true },
      b: {},
    },
    {
      name: `${variant}_omaha_made_hand_defense_vs_value_leader`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaMadeHandDefenseVsValueLeader: true },
      b: {},
    },
  ]),
  // 2026-11-15 OMAHA BLUFF-CATCHER FOLD VS A VALUE LEADER
  // (omahaBluffCatcherFoldVsValueLeader, default OFF, unmeasured): a makes the
  // bluff-catcher folds of omahaBluffCatcherRaiseFold only when the player
  // whose bet or raise is faced is a measured postflop value leader
  // (HorseOmahaReadConditional); b is today's brain. Memory learning on (the
  // league default), so the read engages on measured play.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_bluff_catcher_fold_vs_value_leader`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaBluffCatcherFoldVsValueLeader: true },
    b: {},
  })),
  // 2026-11-15 OMAHA RIVER MEDIUM-BET CALL (HorseOmahaRiverMediumBetCalls,
  // default OFF): a river fold of two pair or better facing the opening bet
  // of 40 to 70 percent of the pot, heads-up or closing the action, becomes a
  // call when the price-based requirement is met; a switches it on, b is
  // today's brain. The mirror's memory learning is on (the league default),
  // so the value-leader read withholds on the Horses' own measured play.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_river_medium_bet_strong_hand_calls`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaRiverMediumBetStrongHandCalls: true },
    b: {},
  })),
  // 2026-11-15 OMAHA BIG BET IS A POT SHARE (default OFF): the Omaha aggressor
  // tier does not count the 20 big blind big-bet mark for a turn or river
  // wager under 70 percent of the pot; a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_big_bet_is_pot_share`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaBigBetIsPotShare: true },
    b: {},
  })),
  // 2026-11-17 OMAHA FLOP FACING-BET EV (HorseOmahaFlopFacingBetEv, default
  // OFF): on the flop facing a bet or a raise, a fold or a call becomes the
  // priced verdict (sampled two-card runouts with a seed from the cards, the
  // bettor's range by pot share and read, realization from the runouts), so
  // the stack-share paired-board fold and the 20 big blind mark no longer
  // decide that spot; a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_facing_bet_ev`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFlopFacingBetEv: true },
    b: {},
  })),
  // 2026-11-18 OMAHA FLOP DEFENCE (HorseOmahaFlopDefenceTree, default OFF): the
  // heads-up first-bet flop call priced as a two-street tree. The live
  // options of 2026-11-16 in both arms; arm A adds the option alone, and on
  // top of the flop verdict.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_defence_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261116, omahaFlopDefenceIsPriced: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261116 },
  })),
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_defence_is_priced_on_flop_ev`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      ...OMAHA_LIVE_OPTIONS_20261116,
      omahaFlopFacingBetEv: true,
      omahaFlopDefenceIsPriced: true,
    },
    b: { ...OMAHA_LIVE_OPTIONS_20261116, omahaFlopFacingBetEv: true },
  })),
  // 2026-11-18 OMAHA FLOP BET PRICES THE RAISE (HorseOmahaFlopBetRaiseBranch,
  // default OFF; WooWoo audit FLOPBET-RAISE, finding FOURBET F1): every v38
  // flop bet size priced with his raise as a third branch. The live options
  // of 2026-11-16 in both arms; arm A adds the option alone.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_bet_prices_the_raise`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261116, omahaFlopBetPricesTheRaise: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261116 },
  })),
  // 2026-11-19 OMAHA BLUFF IS PRICED AGAINST THE TARGET (HorseOmahaBluffPricedAgainstTheTarget,
  // default OFF; audit hvh48 A classes 2 and 4): every heads-up wager facing no bet priced beside the
  // check against his measured fold, the flop call and the flop / turn raise against a priced raise.
  // The live options of 2026-11-18 in both arms; arm A adds the option alone. Declared, not run.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_bluff_is_priced_against_the_target`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaBluffIsPricedAgainstTheTarget: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-18 OMAHA FLOP BET USES THE MEASURED FOLD SHARE
  // (HorseOmahaFlopBetMeasuredFoldShare, default OFF; WooWoo audit FOLD-SHARE):
  // a person's fold share to every v38 flop bet size is the fitted person model.
  // The live options of 2026-11-16 in both arms; arm A adds the option alone.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_bet_uses_measured_fold_share`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261116, omahaFlopBetUsesMeasuredFoldShare: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261116 },
  })),
  // 2026-11-18 OMAHA READ BY STREET AND TEXTURE (HorseOmahaReadByStreet, default
  // OFF): the value-leader label, the bettor's bet rate and the fold to a bet /
  // raise are read from the decision's own street and flop texture, blended
  // with the pooled read by the cell's opportunities; the league learns the
  // street read in the card's sandbox (HorseLeagueStreetRead).
  // The option changes no decision by itself: it only re-routes reads that
  // OTHER options consume (the *VsValueLeader rules' label, omahaFacingBetEv's
  // bettor read, the priced families' street cells). On a bare base every
  // consumer is off and the card is inert (2026-11-18 evaluation of the {} /
  // {} card: 1,000 sessions, 0 divergent pairs). So both arms carry the live
  // production set (the 2026-11-16 list plus omahaTurnRiverRaiseIsPriced, on
  // since 2026-11-18 11:54Z; the base the option's replay and its first league
  // used) and arm A adds the option. Guarded by
  // ADefaultOffFlagHasALeagueCard.law.test.ts (a read-only option's card
  // carries a consumer in both arms).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_read_is_by_street_and_texture`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaReadIsByStreetAndTexture: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-19 OMAHA MULTIWAY CHECK PRICED AGAINST THE BET (lane MULTIWAY-BET,
  // HorseOmahaMultiwayDiscipline section 4, default OFF): a multiway check with
  // nothing to call in a pot not re-raised before the flop is priced against the
  // candidate bets. Both arms carry production's live set; a adds the option.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_multiway_checked_to_bet_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaMultiwayCheckedToBetIsPriced: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-19 THE FLOP VERDICT READS THE BETTOR (HorseOmahaFlopBettorRead,
  // default OFF): the flop facing-bet verdict's value share, non-value share
  // and later-street realization take this bettor's own street record beside
  // his kind. It changes nothing by itself: it is an input of
  // omahaFlopFacingBetEv, so that option is on in BOTH arms (over
  // production's live set, OMAHA_LIVE_OPTIONS_20261118) and arm A adds the
  // read. The street record is learned inside the card
  // (HorseLeagueStreetRead). Guarded by ADefaultOffFlagHasALeagueCard.law.test.ts.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_verdict_reads_the_bettor`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaFlopFacingBetEv: true,
      omahaFlopVerdictReadsTheBettor: true,
    },
    b: { ...OMAHA_LIVE_OPTIONS_20261118, omahaFlopFacingBetEv: true },
  })),
  // 2026-11-19 THE FACING-BET VALUE SHARE IS MEASURED (HorseOmahaFacingBetValueShareMeasured,
  // default OFF): the facing-bet verdicts' bettor range from his street record and, for a person's
  // heads-up turn or river bet, his line-conditioned measured range; the priced verdicts decide where
  // they price. It decides by itself, so arm B is production's live set (OMAHA_LIVE_OPTIONS_20261118)
  // and arm A adds the option. The street record is learned inside the card (HorseLeagueStreetRead).
  // The league seats no person, so part (2) is not dealt here; the card measures parts (1), (3), (4).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_value_share_is_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaFacingBetValueShareIsMeasured: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-18 OMAHA SMALL BETS PRICED (HorseOmahaSmallBet, default OFF): on a
  // heads-up turn or river with nothing to call, the owner's check or bet is
  // priced beside bets of 10/20/25% of the pot with the opponent's measured
  // response by pot share. It runs after the street plan and the card-impact
  // rule (both live), so both arms carry production's live set
  // (OMAHA_LIVE_OPTIONS_20261118, lead decision 2026-11-18) and a adds the
  // option.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_small_bet_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaSmallBetIsPriced: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-18 OMAHA CHECKED-TO BET IS PRICED (HorseOmahaCheckedToBet, default
  // OFF): on the river (v2: the turn is out), when every opponent has checked
  // and the answer is a check, the check is priced beside every bet size
  // against each opponent's checking range and measured continue rate; a
  // switches it on, b is today's brain. The mirror's memory learning is on
  // (the league default), so the reads it prices from exist.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_checked_to_bet_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaCheckedToBetIsPriced: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane OPEN-ITEMS-3: omahaCheckedToBetResponseIsMeasured (default OFF), an input of the rule
  // above: heads-up on the river the checker's answer to each bet size is the measured one. Both arms carry the
  // parent; a adds the input.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_checked_to_bet_response_is_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaCheckedToBetIsPriced: true, omahaCheckedToBetResponseIsMeasured: true },
    b: { omahaCheckedToBetIsPriced: true },
  })),
  // 2026-11-19 lane RIVER-BLOCK (owner order 16:47 Chicago: "REMOVE BLOCKER BETS ON THE RIVER FOR HORSES"):
  // horseRiverNoBlockerBet, default OFF. PLO: both arms carry production's live Omaha set with the priced small
  // bets on (live since 2026-11-18 19:18Z), a adds the option. Hold'em: the bare base, a adds the option.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_horse_river_no_blocker_bet`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaSmallBetIsPriced: true,
      horseRiverNoBlockerBet: true,
    },
    b: { ...OMAHA_LIVE_OPTIONS_20261118, omahaSmallBetIsPriced: true },
  })),
  {
    name: 'nlh_horse_river_no_blocker_bet',
    variant: 'nlh',
    pairs: 6000,
    productionStyles: true,
    a: { horseRiverNoBlockerBet: true },
    b: {},
  },
  // 2026-11-15 OMAHA BETS THAT BECOME CHECKS (HorseOmahaOopChecks, hand
  // 59517323, default OFF): the paired-river lead and the unimproved turn
  // barrel only against measured postflop value leaders, and the bare overpair
  // out of position on the flop against anyone; a switches one on, b is
  // today's brain. The mirror's memory learning is on (the league default).
  ...(['plo4', 'plo5'] as const).flatMap((variant) => [
    {
      name: `${variant}_omaha_paired_river_no_thin_lead_vs_value_leader`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaPairedRiverNoThinLeadVsValueLeader: true },
      b: {},
    },
    {
      name: `${variant}_omaha_overpair_no_oop_barrel_vs_value_leader`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaOverpairNoOopBarrelVsValueLeader: true },
      b: {},
    },
    {
      name: `${variant}_omaha_paired_turn_no_barrel_without_boat_vs_value_leader`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true },
      b: {},
    },
    {
      name: `${variant}_omaha_paired_board_fold_respects_price`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaPairedBoardFoldRespectsPrice: true },
      b: {},
    },
    {
      name: `${variant}_omaha_turn_bet_needs_river_plan`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaTurnBetNeedsRiverPlan: true },
      b: {},
    },
    {
      name: `${variant}_omaha_pressure_needs_postflop_aggression`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaPressureNeedsPostflopAggression: true },
      b: {},
    },
    {
      name: `${variant}_omaha_oop_turn_check_after_flop_call`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaOopTurnCheckAfterFlopCall: true },
      b: {},
    },
    {
      name: `${variant}_omaha_bare_overpair_oop_flop_check`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaBareOverpairOopFlopCheck: true },
      b: {},
    },
  ]),
  // 2026-11-15 OMAHA UNDERPAIR RULES (HorseOmahaUnderpair, default OFF; owner
  // complaint, hand 59518335): the fold of a hand without aces or a premium
  // structure when the Horse's own re-raise is re-raised cold
  // (omahaNoCallColdFourBetWithoutPremium) and the fold of an underpair with
  // no real draw to a flop bet and a call
  // (omahaUnderpairNoMultiwayFlopContinue); a switches one on, b is today's
  // brain.
  ...(['plo4', 'plo5'] as const).flatMap((variant) => [
    {
      name: `${variant}_omaha_no_call_cold_four_bet`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaNoCallColdFourBetWithoutPremium: true },
      b: {},
    },
    {
      name: `${variant}_omaha_underpair_no_multiway_flop_continue`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaUnderpairNoMultiwayFlopContinue: true },
      b: {},
    },
  ]),
  // 2026-11-15 OMAHA MANIAC RE-RAISE WIDTH (HorseMind.bandFor, default OFF;
  // full sweep, the biggest winner): a measured maniac's 3-bet and 4-bet are
  // read at his own counted re-raise rate instead of his whole raising width
  // (omahaManiacReRaiseWidthMeasured); a switches it on, b is today's brain.
  // The mirror's memory learning is on (the league default); the read engages
  // only on a seat measured as a maniac with 12+ re-raise opportunities.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_maniac_reraise_width_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaManiacReRaiseWidthMeasured: true },
    b: {},
  })),
  // 2026-11-15 OMAHA ELITE CONTINUES VS A MEASURED WIDE 3-BETTOR (default
  // OFF): a Horse that opened does not fold an elite-class hand to the
  // maniac-price arithmetic facing one re-raise from a measured wide
  // re-raiser; the fold becomes a call. a switches it on, b is today's brain.
  // The mirror's memory learning is on (the league default).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_elite_continues_vs_measured_wide_three_bettor`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaEliteContinuesVsMeasuredWideThreeBettor: true },
    b: {},
  })),
  // 2026-11-17 OMAHA PREFLOP RE-RAISE DEFENCE, PRICED (HorseOmahaPreflopReraiseDefence,
  // default OFF): facing a 3-bet or more preflop the fold, call or proposed
  // re-raise is chosen by expected value (exact-hand equity against the
  // re-raiser's measured width, measured realization, price and rake) in
  // place of the re-raise range rules and the strong-range rule. Those rules
  // and the re-raised-pot call cell it defers to are live, so both arms carry
  // production's live set (OMAHA_LIVE_OPTIONS_20261118, lead decision
  // 2026-11-18) and a adds the option.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_preflop_reraise_defence_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaPreflopReraiseDefencePriced: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-19 (THREEBET-2): omahaPreflopReraiseDefencePricedInPosition, default OFF: the same priced
  // decision, only for a Horse that opened and is heads-up in position against one 3-bet. Both arms carry
  // production's live set, arm a adds the option. Declared; not run.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_preflop_reraise_defence_priced_in_position`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaPreflopReraiseDefencePricedInPosition: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-24 (PLO lead-6): omahaReraisedPotCallIsPriced and omahaReraisedPotReraiseIsPriced, default OFF: facing a
  // 3-bet or more the call, fold and re-raise priced against the whole field by position, depth and players. Both arms
  // carry production's live set; a adds the two options. Graded ON vs OFF at 100 and 300 bb, 6-max and heads-up, and
  // against scripted probes (docs/horse-option-authority.d/omahaReraisedPotCallIsPriced.md).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraised_pot_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaReraisedPotCallIsPriced: true,
      omahaReraisedPotReraiseIsPriced: true,
    },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-27 (lead-8 lane preflop): omahaReraisedPotFoldReraiseIsPriced, default OFF: facing a 3-bet or more
  // heads-up against the re-raiser, a standing fold priced against the pot-size re-raise. Both arms carry
  // production's live set; a adds the option (docs/horse-option-authority.d/omahaReraisedPotFoldReraiseIsPriced.md).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraised_pot_fold_reraise_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaReraisedPotFoldReraiseIsPriced: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-15 OMAHA OUT-OF-POSITION RE-RAISED POT STRONG RANGE (default OFF):
  // a preflop call of a 3-bet or more out of position against the last raiser
  // stands only with suited aces, as a priced commitment, or with a
  // coordinated hand clearing the price plus the out-of-position margin.
  // a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_oop_reraised_pot_strong_range`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaOopReraisedPotStrongRange: true },
    b: {},
  })),
  // 2026-11-15 (default OFF): the caller of a re-raised pot continues on the
  // flop only with two pair or better, a pair with a nut-leaning draw or a
  // strong draw. a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraised_pot_flop_continue_needs_equity_shape`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaReraisedPotFlopContinueNeedsEquityShape: true },
    b: {},
  })),
  // 2026-11-15 OMAHA NUT-BLOCKER RIVER BLUFF REACHABLE
  // (omahaRiverNutBlockerBluffReachable, default OFF): the v86 nut-blocker
  // river bluff admits one pair (0.25-0.28 equity) instead of no pair only;
  // a switches it on, b is today's brain, where the rule never fires.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_river_nut_blocker_bluff_reachable`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaRiverNutBlockerBluffReachable: true },
    b: {},
  })),
  // 2026-11-15 OMAHA CARD IMPACT (HorseOmahaCardImpact, default OFF): the
  // turn and river check-or-bet decision priced against the opponent range as
  // the last card left it; a switches it on, b is today's brain. The mirror's
  // memory learning is on (the league default).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_card_impact`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaCardImpact: true },
    b: {},
  })),
  // 2026-11-15 OMAHA FACING-BET EV (HorseOmahaFacingBetEv, default OFF): the
  // PLO4/PLO5 cash turn and river fold-or-call decision facing a bet or a
  // raise is one expected-value decision on the exact holdings count, the
  // bettor's range and the price; a switches it on, b is today's brain. The
  // mirror's memory learning is on (the league default), so the measured
  // bet-when-checked-to read moves the bluff share on the Horses' own play.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_ev`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true },
    b: {},
  })),
  // 2026-11-17 OMAHA TURN CALL REALIZATION BY RUNOUT
  // (HorseOmahaRunoutRealization, default OFF): inside the facing-bet EV rule,
  // a non-final turn call's realization factor is read from the hand's own
  // per-river counts against the bettor's value region and his other holdings
  // instead of the flat 0.85 / 0.92. Both arms carry production's live set
  // (OMAHA_LIVE_OPTIONS_20261118, which runs the facing-bet EV rule; lead
  // decision 2026-11-18); a adds the option, b is the brain as it serves.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_turn_call_realization_by_runout`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaTurnCallRealizationByRunout: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-18 WooWoo F-04/F-11 C3 (HorseOmahaFacingBetEvShownField, default
  // OFF): inside the facing-bet EV rule, a turn or river call with another
  // player in the hand is priced on the joint field, the measured turn
  // realization and the close-call mix. a adds the option, b is the rule as it serves.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_ev_shown_field`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaFacingBetEvShownField: true },
    b: { omahaFacingBetEv: true },
  })),
  // 2026-11-18 WooWoo RIVER-FACING (HorseOmahaRiverBluffCatch, default OFF):
  // inside the facing-bet EV rule, a heads-up first river bet is priced as a
  // bluff-catch on the bettor's measured range with the Horse's blockers.
  // a adds the option, b is the rule as it serves.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_river_bluff_catch_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaRiverBluffCatchIsPriced: true },
    b: { omahaFacingBetEv: true },
  })),
  // 2026-11-18 OMAHA FACING-BET VALUE REGION FROM HIS RANGE (lane VALUE-REGION,
  // hand 59993188, default OFF): the river facing-bet verdict, heads-up against
  // a person's first bet, is priced on his measured betting range on this
  // board. Both arms carry production's live set; a adds the option.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_value_is_range_relative`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaFacingBetValueIsRangeRelative: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-18 OMAHA PAIRED-BOARD RIVER IS PRICED (lane PAIRED-RIVER, hand
  // 59993188, default OFF): a nut-class straight or flush on a paired river,
  // heads-up against the first bet, is priced on the bettor's line-conditioned
  // range. Both arms carry production's live set; a adds the option.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_paired_board_river_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaPairedBoardRiverIsPriced: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-15 OMAHA TURN/RIVER RAISE NEEDS NUTS (owner 12:52 / 12:53, hand
  // 59534208, default OFF): facing a bet or a raise on the turn or the river a
  // raise stands only nut class (or the in-position turn combo draw of 12:30);
  // every other raise is the priced call or fold. a switches it on, b is
  // today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_turn_river_raise_needs_nuts`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaTurnRiverRaiseNeedsNuts: true },
    b: {},
  })),
  // 2026-11-16 OMAHA MULTIWAY AND BLUFF DISCIPLINE (HorseOmahaMultiwayDiscipline,
  // three options, each default OFF, one card per game each): the multiway
  // river call priced against every continuing range, no river bluff into a
  // measured value leader who showed strength, and no multiway turn or river
  // bet with one pair or less and no nut-class draw. Six-max (the spots are
  // multiway), the live cash Hybrid persona (hybridBaseline) and the
  // deal-seeded mood clock; a switches the option on, b is today's brain.
  // The mirror's memory learning is on (the league default), so the value
  // leader read and the measured fold rates can engage. The cards only
  // measure; no evaluation has been run.
  ...(['plo4', 'plo5'] as const).flatMap((variant) =>
    [
      {
        slug: 'multiway_river_call_needs_strength',
        a: { omahaMultiwayRiverCallNeedsStrength: true },
      },
      { slug: 'no_river_bluff_into_value_leader', a: { omahaNoRiverBluffIntoValueLeader: true } },
      { slug: 'multiway_weak_hand_no_bet', a: { omahaMultiwayWeakHandNoBet: true } },
    ].map(({ slug, a }) => ({
      name: `${variant}_omaha_${slug}`,
      variant,
      seats: 6,
      pairs: 6000,
      hybridBaseline: true,
      moodClock: 'deal_seed' as const,
      a,
      b: {},
    }))
  ),
  // 2026-11-17 THE OMAHA PRICED RULES (owner 11:49: "there should not be any
  // blanket rules ... they must all be done by math"; HorseOmahaPricedRules,
  // ten default-OFF options). Each option replaces one family of categorical
  // PLO4/PLO5 cash rules with a priced comparison, and acts where the rule it
  // replaces is on: so BOTH arms carry the options production switched on on
  // 2026-11-16 (OMAHA_LIVE_OPTIONS_20261116), and arm A adds the one priced
  // option. The mixing card has every priced family on in both arms and
  // omahaPricedMix in arm A. The mirror's memory learning is on (the league
  // default), so the reads the comparisons price on are each opponent's own.
  // The cards only measure; every default is unchanged.
  ...(['plo4', 'plo5'] as const).flatMap((variant) => [
    ...OMAHA_PRICED_FAMILY_CARDS.map(([option, name]) => ({
      name: `${variant}_omaha_${name}`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { ...OMAHA_LIVE_OPTIONS_20261116, [option]: true },
      b: { ...OMAHA_LIVE_OPTIONS_20261116 },
    })),
    {
      name: `${variant}_omaha_priced_mix`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { ...OMAHA_LIVE_OPTIONS_20261116, ...OMAHA_PRICED_FAMILIES_ON, omahaPricedMix: true },
      b: { ...OMAHA_LIVE_OPTIONS_20261116, ...OMAHA_PRICED_FAMILIES_ON },
    },
    // 2026-11-18 option batch: the priced sites (HorseOmahaPricedSites, each default OFF; two off-only)
    // act where the rule they replace is on, so both arms carry the live options and arm A adds one.
    ...OMAHA_PRICED_SITE_CARDS.map(([option, name]) => ({
      name: `${variant}_omaha_${name}`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { ...OMAHA_LIVE_OPTIONS_20261116, [option]: true },
      b: { ...OMAHA_LIVE_OPTIONS_20261116 },
    })),
    // 2026-11-18 option batch: the priced2 inputs (omahaPricedPriorsByOpponentKind default OFF,
    // omahaRaiseEvCountsLossesOnce off-only) change only what the priced families compute, so both arms
    // carry every priced family on (OMAHA_PRICED_FAMILIES_ON) and arm A adds the one input.
    ...OMAHA_PRICED_INPUT_CARDS.map(([option, name]) => ({
      name: `${variant}_omaha_${name}`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { ...OMAHA_LIVE_OPTIONS_20261116, ...OMAHA_PRICED_FAMILIES_ON, [option]: true },
      b: { ...OMAHA_LIVE_OPTIONS_20261116, ...OMAHA_PRICED_FAMILIES_ON },
    })),
  ]),
  // 2026-11-18 OMAHA FOLD MODEL FITTED ON PEOPLE (HorseOmahaFoldModelFittedOnPeople, default OFF;
  // WooWoo audit FOLD-MODEL): a person's fold share to every v38 flop / turn bet size is the fold model
  // fitted on people. The live options of 2026-11-16 in both arms; arm A adds the option alone.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_fold_model_fitted_on_people`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261116, omahaFoldModelFittedOnPeople: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261116 },
  })),
  // 2026-11-15 OMAHA STREET PLAN (HorseOmahaStreetPlan, owner 11:43, default
  // OFF), first layer: the heads-up turn bet priced against the check with
  // the river planned, and the river following the plan. a switches it on,
  // b is today's brain. The mirror's memory learning is on (the league
  // default), so measured tendencies move the plan's shares.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_street_plan`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaStreetPlan: true },
    b: {},
  })),
  // 2026-11-15 OMAHA STREET PLAN, the flop, the turn three-way and the
  // preflop stack-to-pot layers (HorseOmahaStreetPlan, owner 11:43, each
  // default OFF, switched separately). a switches one on, b is today's brain;
  // the live cash Hybrid persona on both arms (hybridBaseline). Declared, not
  // run: the constants are unmeasured.
  ...(['plo4', 'plo5'] as const).flatMap((variant) =>
    (
      [
        ['omaha_street_plan_flop', { omahaStreetPlanFlop: true }],
        ['omaha_street_plan_three_way', { omahaStreetPlanThreeWay: true }],
        ['omaha_preflop_stack_plan', { omahaPreflopStackPlan: true }],
      ] as const
    ).map(([card, a]) => ({
      name: `${variant}_${card}`,
      variant,
      pairs: 6000,
      hybridBaseline: true,
      a: { ...a },
      b: {},
    }))
  ),
  // 2026-11-15 (default OFF, switched separately): a 3-bet or 4-bet out of
  // position (omahaReraiseRangeOutOfPosition) or from early position
  // (omahaReraiseRangeEarlyPosition) needs suited aces, committed aces or a
  // declared premium structure; every other hand calls or folds by the calling
  // rule. a switches one on, b is today's brain.
  ...(['plo4', 'plo5'] as const).flatMap((variant) => [
    {
      name: `${variant}_omaha_reraise_range_out_of_position`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaReraiseRangeOutOfPosition: true },
      b: {},
    },
    {
      name: `${variant}_omaha_reraise_range_early_position`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaReraiseRangeEarlyPosition: true },
      b: {},
    },
  ]),
  // 2026-11-18 (WooWoo audit, CALL-VS-RAISE, default OFF): the priced
  // call-or-raise facing a re-raise. Both sides run the re-raised-pot rules it
  // sits on (it acts on their standing call and on the raises they lower); a
  // adds the pricing, b is those rules alone.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraised_call_vs_raise_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      omahaOopReraisedPotStrongRange: true,
      omahaReraiseRangeOutOfPosition: true,
      omahaReraiseRangeEarlyPosition: true,
      omahaReraisedCallVsRaisePriced: true,
    },
    b: {
      omahaOopReraisedPotStrongRange: true,
      omahaReraiseRangeOutOfPosition: true,
      omahaReraiseRangeEarlyPosition: true,
    },
  })),
  // 2026-11-19 (hand #60156608, owner 15:34 Chicago; lane CALL-OR-RAISE-2, default OFF): facing two or more
  // preflop raises heads-up, fold, call and raise (a 4-bet, a 5-bet, a jam) are each priced against the measured
  // ranges; a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_preflop_jam_facing_reraise_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaPreflopJamFacingReraiseIsPriced: true },
    b: {},
  })),
  // 2026-11-24 PLO-OWNER lead-6 (default OFF, PLO4/PLO5 cash): the corrected facing-bet price on measured ranges
  // (F1-F3, F6, multiway M1-M3); each card's a adds one option to the b that carries what it acts inside.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_range_is_measured_by_line`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaFacingBetRangeIsMeasuredByLine: true },
    b: { omahaFacingBetEv: true },
  })),
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_indifference_calls`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaFacingBetIndifferenceCalls: true },
    b: { omahaFacingBetEv: true },
  })),
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_realization_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaFlopRealizationIsPriced: true },
    b: { omahaFacingBetEv: true },
  })),
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_minimum_defence_prior`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      omahaFacingBetEv: true,
      omahaFacingBetRangeIsMeasuredByLine: true,
      omahaFlopRealizationIsPriced: true,
      omahaFacingBetMinimumDefencePrior: true,
    },
    b: {
      omahaFacingBetEv: true,
      omahaFacingBetRangeIsMeasuredByLine: true,
      omahaFlopRealizationIsPriced: true,
    },
  })),
  // 2026-11-26 PLO-OWNER lead-7 (default OFF, PLO4/PLO5 cash): heads-up on the flop facing one bet, the V40 class cap
  // in the reference call-or-fold check priced against the bettor's range on people-only flop shares
  // (HorseOmahaFlopPressureCapPriced).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_pressure_cap_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFlopPressureCapIsPriced: true },
    b: {},
  })),
  // 2026-11-26 PLO-OWNER lead-7 (default OFF, PLO4/PLO5 cash): the bettor's non-value share anchored to the balanced
  // share for the price, moved only by his own shown bets (HorseOmahaEquilibriumAnchor).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_prior_is_people_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaFacingBetPriorIsPeopleMeasured: true },
    b: { omahaFacingBetEv: true },
  })),
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_field_is_joint`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaFacingBetFieldIsJoint: true },
    b: { omahaFacingBetEv: true },
  })),
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_multiway_call_needs_nut_share`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      omahaFacingBetEv: true,
      omahaFacingBetFieldIsJoint: true,
      omahaMultiwayCallNeedsNutShare: true,
    },
    b: { omahaFacingBetEv: true, omahaFacingBetFieldIsJoint: true },
  })),
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_multiway_value_bet_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaMultiwayValueBetIsPriced: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane STAB-DEFENCE (default OFF, PLO4/PLO5 cash): omahaStabDefenceIsPriced; a on, b today. The
  // option reads a lifetime record: without a provider fed by the harness both arms decide alike.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_stab_defence_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaStabDefenceIsPriced: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane STAB-DEFENCE (default OFF, held): omahaStrongHandCheckIsPriced; a on, b today.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_strong_hand_check_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaStrongHandCheckIsPriced: true },
    b: {},
  })),
  // 2026-11-21 EMERG lane STAB-DEFENCE-5 (default OFF, PLO4/PLO5 cash): omahaRiverBetFoldIsHisRecord over the two
  // river bet rules; a on, b the two rules without it. The option reads a lifetime record: without a provider fed
  // by the harness both arms decide alike.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_river_bet_fold_his_record`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      omahaRiverFirstToActBetIsPriced: true,
      omahaRiverCheckedToBetIsMeasured: true,
      omahaRiverBetFoldIsHisRecord: true,
    },
    b: { omahaRiverFirstToActBetIsPriced: true, omahaRiverCheckedToBetIsMeasured: true },
  })),
  // 2026-11-26 PLO-OWNER lead-7 (default OFF, PLO4/PLO5 cash): omahaRiverBetFoldIsPeopleMeasured over the two river bet
  // rules with his record; a on, b the same set without it (the answer curve re-measured on people's answers).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_river_bet_fold_people_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      omahaRiverFirstToActBetIsPriced: true,
      omahaRiverCheckedToBetIsMeasured: true,
      omahaRiverBetFoldIsHisRecord: true,
      omahaRiverBetFoldIsPeopleMeasured: true,
    },
    b: {
      omahaRiverFirstToActBetIsPriced: true,
      omahaRiverCheckedToBetIsMeasured: true,
      omahaRiverBetFoldIsHisRecord: true,
    },
  })),
  // 2026-11-21 PLO-OWNER lead-4 lane LEAKS-RULES (default OFF, PLO4/PLO5 cash): #18 omahaBigBetSizeIsPriced
  // (replaces #18 omahaBigBetIsPotShare with continuous pot-share/HUD aggressor range + priced limped-pot bet sizing).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_big_bet_size_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaBigBetIsPotShare: false, omahaBigBetSizeIsPriced: true },
    b: { omahaBigBetIsPotShare: true },
  })),
  // 2026-11-22 PLO-OWNER lead-5 (default OFF, PLO4/PLO5 cash): omahaPricedRaiseNeverMakesNonNutRaise. Both arms run
  // the two live turn and river raise rules it limits; a adds the option, b is today.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_priced_raise_never_makes_non_nut_raise`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      omahaTurnRiverRaiseIsPriced: true,
      omahaTurnRiverRaiseNeedsNuts: true,
      omahaPricedRaiseNeverMakesNonNutRaise: true,
    },
    b: { omahaTurnRiverRaiseIsPriced: true, omahaTurnRiverRaiseNeedsNuts: true },
  })),
  // 2026-11-22 PLO-OWNER lead-5 (default OFF, PLO4/PLO5 cash): omahaLateFlattenedCallIsPriced. Both arms run the
  // facing-bet verdict that prices the late-flattened river call; a adds the option, b is today. The spot is rare
  // (once in 14,614 replayed states), so this card can show no difference.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_late_flattened_call_is_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaLateFlattenedCallIsPriced: true },
    b: { omahaFacingBetEv: true },
  })),
  // 2026-11-21 PLO-OWNER lane REPLACEMENTS-5 (default OFF, PLO4/PLO5 cash): R2 omahaFlopBetIsPricedOnHisResponse
  // (replaces #13 omahaBareOverpairOopFlopCheck + HUD flop raiser/stabber range); a on, b today.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_flop_bet_priced_on_his_response`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaBareOverpairOopFlopCheck: false, omahaFlopBetIsPricedOnHisResponse: true },
    b: { omahaBareOverpairOopFlopCheck: true },
  })),
  // 2026-11-21 EMERG lane CBET-DEFENCE (default OFF, PLO4/PLO5 cash): omahaCbetRaiseIsPriced; a on, b today. Without a
  // lifetime provider fed by the harness the raise share is the population's.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_cbet_raise_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaCbetRaiseIsPriced: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane OFFENCE-BUILD (default OFF, PLO4/PLO5 cash): omahaRiverCheckedToBetIsMeasured; a on, b today.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_river_checked_to_bet_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaRiverCheckedToBetIsMeasured: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane OFFENCE-BUILD (default OFF, PLO4/PLO5 cash): omahaRiverFirstToActBetIsPriced (the river
  // first-to-act heads-up check priced beside the bets on the measured response); a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_river_first_to_act_bet_priced`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaRiverFirstToActBetIsPriced: true },
    b: {},
  })),
  // 2026-11-21 EMERG lane BLANKET-AUDIT (default OFF, PLO4/PLO5 cash): omahaBlanketRowsOffInPlo45Cash with the first
  // declared members (v74OmahaSemiBluffNeedsDraw and the hidden four); a switches it on with that list, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_blanket_rows_off_in_plo45_cash`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: {
      omahaBlanketRowsOffInPlo45Cash: true,
      omahaBlanketRowsOffList: [
        'v74OmahaSemiBluffNeedsDraw',
        'ploPairedBoardFold',
        'ploPairedBoardRiverCheck',
        'omahaRiverNutRaiseOnly',
        'omahaTurnSetPound',
      ],
    },
    b: {},
  })),
  // 2026-11-20 EMERG lane RANGE-MODEL-2 (default OFF, PLO4/PLO5 cash): omahaRiverCurrentNutsCallFloor (a final river
  // fold facing a wager with the exact current nuts becomes the call where a full chop still returns it); a switches it
  // on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_river_current_nuts_call_floor`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaRiverCurrentNutsCallFloor: true },
    b: {},
  })),
  // 2026-11-24 PLO-LEAD-6 (default OFF): omahaOopReraiseRangeHoldsVsReraise (PLO4/PLO5 cash) and
  // holdemOopReraiseRangeHoldsVsReraise (NLH cash): the out-of-position 3-bet stands only when priced against the call
  // and the Horse's own answer to the 4-bet; a switches it on, b is today's brain. Declared, not run.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_oop_reraise_range_holds_vs_reraise`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaOopReraiseRangeHoldsVsReraise: true },
    b: {},
  })),
  {
    name: 'nlh_holdem_oop_reraise_range_holds_vs_reraise',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemOopReraiseRangeHoldsVsReraise: true },
    b: {},
  },
  // 2026-11-25 plo-lead7 (default OFF): the Hold'em opening side priced, each option alone; a switches it on, b is
  // today's brain. Graded by the lane's own mirror and probes (docs/horse-option-authority.d).
  {
    name: 'nlh_holdem_opening_value_bet_is_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemOpeningValueBetIsPriced: true },
    b: {},
  },
  {
    name: 'nlh_holdem_opening_bluff_is_priced',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemOpeningBluffIsPriced: true },
    b: {},
  },
  // 2026-11-26 plo-lead7 (default OFF): the first bet of the turn or river against two or more opponents priced,
  // each option alone at a six-handed table (heads-up they never act); a switches it on, b is today's brain. Graded
  // by the lane's own mirror, probes and replay (docs/horse-option-authority.d).
  {
    name: 'nlh6_holdem_multiway_opening_bluff_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    a: { holdemMultiwayOpeningBluffIsPriced: true },
    b: {},
  },
  {
    name: 'nlh6_holdem_multiway_opening_value_bet_is_priced',
    variant: 'nlh',
    seats: 6,
    pairs: 6000,
    a: { holdemMultiwayOpeningValueBetIsPriced: true },
    b: {},
  },
  // 2026-11-27 lead-8 (default OFF): the NLH cash heads-up river bluff priced on people's river fold; a switches it
  // on, b is today's brain. Graded by the lane's own mirror, probes and replay (docs/horse-option-authority.d).
  {
    name: 'nlh_holdem_river_bluff_is_priced_on_people',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemRiverBluffIsPricedOnPeople: true },
    b: {},
  },
  // 2026-11-26 plo-lead7 tourney-postflop (default OFF): the Hold'em tournament bluff after the flop, each option
  // alone, in the format it moves most (six-max MTT far from the money, 30bb) and on the three-left Sit & Go bubble
  // (bubble factor priced from the stacks); a switches it on, b is today's brain. Graded by the lane's own mirror,
  // probes and replay (docs/horse-option-authority.d).
  ...(['holdemTournamentRiverBluffIsPriced', 'holdemTournamentTurnBluffIsPriced'] as const).flatMap(
    (opt) => [
      {
        name: `mtt6_${opt === 'holdemTournamentRiverBluffIsPriced' ? 'river' : 'turn'}_bluff_is_priced_30bb`,
        seats: 6,
        stackBB: 30,
        context: bigBlindAnteMttContext(6, 30),
        pairs: 6000,
        hybridBaseline: true,
        moodClock: 'deal_seed' as const,
        a: { [opt]: true },
        b: {},
      },
      {
        name: `sng3_bubble_${opt === 'holdemTournamentRiverBluffIsPriced' ? 'river' : 'turn'}_bluff_is_priced_20bb`,
        seats: 3,
        stackBB: 20,
        context: sngBubbleWithStacksContext(3, 20),
        pairs: 6000,
        hybridBaseline: true,
        moodClock: 'deal_seed' as const,
        a: { [opt]: true },
        b: {},
      },
    ]
  ),
  // 2026-11-24 PLO-LEAD-6 (default OFF): the same rules reading the opener's own record of answering a 3-bet
  // (omaha/holdemOopReraiseRangeReadsOpenerRecord); a switches both on, b is today's brain. Declared, not run.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_oop_reraise_range_reads_opener_record`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaOopReraiseRangeHoldsVsReraise: true, omahaOopReraiseRangeReadsOpenerRecord: true },
    b: {},
  })),
  {
    name: 'nlh_holdem_oop_reraise_range_reads_opener_record',
    variant: 'nlh',
    pairs: 6000,
    a: { holdemOopReraiseRangeHoldsVsReraise: true, holdemOopReraiseRangeReadsOpenerRecord: true },
    b: {},
  },
  // 2026-11-26 PLO lead-7 plo-preflop (default OFF, PLO4/PLO5 cash): omahaReraisedPositionVsEveryoneToAct (the priced
  // call of a re-raise holds position against every live player still to see the flop, not the re-raiser alone). Both
  // arms carry production's live set (omahaOopReraisedPotStrongRange on, whose priced call reads the position); a adds
  // the option. Graded 6-max, 3-handed and heads-up at 100 and 300 bb (authority file).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraised_position_vs_everyone_to_act`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaReraisedPositionVsEveryoneToAct: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-20 EMERG lane PREFLOP-UNCONTESTED (default OFF, PLO4/PLO5 cash): omahaFourBetFoldPricedCall (a final
  // preflop fold after the Horse's own raise, facing a 4-bet or more heads-up, becomes the call where the priced call of
  // a re-raise is positive); a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_four_bet_fold_priced_call`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFourBetFoldPricedCall: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane RAKE (default OFF, PLO4/PLO5 cash): omahaFacingBetPaysTheWholeDeduction (the facing-bet
  // call verdicts deduct the whole projected deduction of the pot after the call instead of the marginal rake
  // rate); both arms carry omahaFacingBetEv, a adds the option.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_facing_bet_pays_the_whole_deduction`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaFacingBetEv: true, omahaFacingBetPaysTheWholeDeduction: true },
    b: { omahaFacingBetEv: true },
  })),
  // 2026-11-20 EMERG lane RAKE (default OFF, PLO4/PLO5 cash): omahaMathCoreNetsTheWholeDeduction (the math core nets
  // the dealt-player cap, the jackpot drop and preflop lines that reach a flop); both arms carry the core on every
  // street and preflop, a adds the option.
  ...(['plo4', 'plo5'] as const).map((variant) => {
    const street = variant === 'plo4' ? 'Plo4' : 'Plo5';
    const core = {
      omahaMathCore: true,
      omahaMathCorePreflop: true,
      [`omahaMathCore${street}Flop`]: true,
      [`omahaMathCore${street}Turn`]: true,
      [`omahaMathCore${street}River`]: true,
    };
    return {
      name: `${variant}_omaha_math_core_nets_the_whole_deduction`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { ...core, omahaMathCoreNetsTheWholeDeduction: true },
      b: core,
    };
  }),
  // 2026-11-20 EMERG lane PREFLOP-AUDIT (default OFF, PLO4/PLO5 cash tables only): omahaColdCallOutsideBigBlindIsMeasured
  // (a final cold call of one open from a seat without a big blind posted becomes a fold for the hand classes measured
  // to lose against folding); a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_cold_call_outside_big_blind_is_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaColdCallOutsideBigBlindIsMeasured: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane PREFLOP-AUDIT (default OFF, PLO4/PLO5 cash only): omahaOpenNeedsMeasuredStrength (a final
  // first-in raise from a seat that is not the button with a hand below the measured strength cut becomes a fold);
  // a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_open_needs_measured_strength`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaOpenNeedsMeasuredStrength: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane PREFLOP-2 (default OFF, PLO4/PLO5 cash only): omahaAcesReraiseIsMeasured (a final call
  // or fold of a pair of aces facing a 3-bet at 250 bb or less becomes the pot-size re-raise); a switches it on,
  // b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_aces_reraise_is_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaAcesReraiseIsMeasured: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane PREFLOP-2 (default OFF, PLO4/PLO5 cash only): omahaReraiseRangeIsMeasured (a final call
  // of kings facing a 3-bet in position becomes the pot-size 4-bet, the one cell of the measured re-raise range);
  // a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_reraise_range_is_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaReraiseRangeIsMeasured: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane RUNDOWNS (default OFF, PLO4/PLO5 cash only): omahaRundownReraiseRangeIsMeasured (a final
  // squeeze from a blind with a high rundown above 250 bb becomes the call, the one measured cell of the rundown
  // re-raise range); a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_rundown_reraise_range_is_measured`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaRundownReraiseRangeIsMeasured: true },
    b: {},
  })),
  // 2026-11-20 EMERG lane RUNDOWNS (default OFF, PLO4/PLO5 cash only): omahaRundownReraiseRangeTrial (a final call
  // with a rundown in a trial cell becomes the pot-size re-raise: the 3-bet in position with a double-suited no-gap
  // rundown, the PLO5 4-bet in position with five connected cards, a tier A or B rundown in position with 250 bb or
  // less); a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_rundown_reraise_range_trial`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaRundownReraiseRangeTrial: true },
    b: {},
  })),
  // 2026-11-19 EMERG lanes FACING and V40CAP (default OFF, PLO4/PLO5 cash only): omahaFacingBetIsPricedByEquity (a
  // final fold facing a person's wager priced by calibrated equity) and omahaClassCapsRespectEquity (the V15 and V40
  // class caps never push equity below the measured equity); a switches each on, b is today's brain.
  ...(['plo4', 'plo5'] as const).flatMap((variant) => [
    {
      name: `${variant}_omaha_facing_bet_is_priced_by_equity`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaFacingBetIsPricedByEquity: true },
      b: {},
    },
    {
      name: `${variant}_omaha_turn_strong_hand_realization_is_measured`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaFacingBetIsPricedByEquity: true, omahaTurnStrongHandRealizationIsMeasured: true },
      b: { omahaFacingBetIsPricedByEquity: true },
    },
    {
      name: `${variant}_omaha_bet_read_is_per_opponent`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaFacingBetEv: true, omahaBetReadIsPerOpponent: true },
      b: { omahaFacingBetEv: true },
    },
    {
      name: `${variant}_omaha_bet_read_is_mode_split`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaFacingBetEv: true, omahaBetReadIsPerOpponent: true, omahaBetReadIsModeSplit: true },
      b: { omahaFacingBetEv: true, omahaBetReadIsPerOpponent: true },
    },
    {
      name: `${variant}_omaha_class_caps_respect_equity`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaClassCapsRespectEquity: true },
      b: {},
    },
    // 2026-11-20 EMERG lane HIDDEN-ON (default OFF, PLO4/PLO5 cash only): omahaNoMadeClassCap, the V40
    // made-hand class cap on equity does not run; a switches it on, b is today's brain.
    {
      name: `${variant}_omaha_no_made_class_cap`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: { omahaNoMadeClassCap: true },
      b: {},
    },
  ]),
  // 2026-11-15 OMAHA BIG-DRAW AGGRESSION (HorseOmahaBigDrawAggression, default
  // OFF): a check or call with a declared big draw on a PLO4/PLO5 flop or turn
  // becomes a pot-sized bet or raise when its expected value is the higher
  // one; a switches it on, b is today's brain. The mirror's memory learning is
  // on (the league default), so the fold equity is each opponent's measured one.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_big_draw_aggression`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaBigDrawAggression: true },
    b: {},
  })),
  // 2026-11-21 R4 (omahaBigDrawBetIsPricedOnHisResponse, default OFF): replaces the
  // checked-to bet half of omahaBigDrawAggression on flop/turn in PLO4/PLO5 cash using
  // ONE lifetime HUD source (fb.bg, rBet, stab) with prove-it-to-bet bar; a switches it on.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_big_draw_bet_is_priced_on_his_response`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaBigDrawBetIsPricedOnHisResponse: true },
    b: {},
  })),
  // 2026-11-15 12:30 owner ruling (no draw raise out of position, no bare
  // flush draw raise in position), applied to the existing draw raises;
  // default OFF. a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_no_draw_raise_out_of_position`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaNoDrawRaiseOutOfPosition: true },
    b: {},
  })),
  // 2026-11-15 HORSE PLAYING STYLES (HorsePlayStyle, HorseOmahaPlayStyle;
  // owner 16:40 / 16:42; default OFF): each non-current style against a field
  // of the current style. League seat ids are league-N, so the a seats are
  // given their style by the league lever horsePlayStyleForce; b is today's
  // brain (the current style is byte-identical to it). Every seat plays the
  // live Hybrid profile (hybridBaseline, 2026-11-16), as the recent cards do.
  ...(['plo4', 'plo5'] as const).flatMap((variant) =>
    (['tight', 'pressure'] as const).map((style) => ({
      name: `${variant}_horse_play_style_${style}`,
      variant,
      pairs: 6000,
      hybridBaseline: true,
      a: { horsePlayStyles: true, horsePlayStyleForce: style },
      b: {},
    }))
  ),
  // 2026-11-15 OMAHA STRONG HAND VALUE (HorseOmahaStrongHandValue, default
  // OFF): the PLO4/PLO5 cash river check with a full house or better (or a
  // nut-class hand) priced against every value bet, and the river call facing
  // one bettor priced against every value raise; a switches it on, b is
  // today's brain. The mirror's memory learning is on (the league default).
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_strong_hand_value`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaStrongHandValue: true },
    b: {},
  })),
  // 2026-11-15 OMAHA STRONG HAND SLOWPLAY MIX (HorseOmahaStrongHandSlowplayMix,
  // default OFF; owner 14:13): a nut-class raise facing a bet becomes a call,
  // and a flop bet with a set on a very dry flop becomes a check, each at the
  // mixed frequency of the spot; a switches it on, b is today's brain.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_strong_hand_slowplay_mix`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { omahaStrongHandSlowplayMix: true },
    b: {},
  })),
  // 2026-11-16 OMAHA BET SIZE BY PUBLIC STATE (horsePublicBetSize, default
  // OFF): the size of an own postflop bet or raise comes from public
  // information only; a switches it on, b is today's brain. The league's
  // opponents do not read sizes, so this card asks only whether the public
  // sizes cost chips, not whether they close the tell.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_bet_size_by_public_state`,
    variant,
    pairs: 6000,
    hybridBaseline: true,
    a: { omahaBetSizeByPublicState: true },
    b: {},
  })),
  // V15 BOATS (2026-09-28): default OFF. a turns it on, b is today's brain.
  // Ship it default ON only after this resolves significant positive.
  // 2026-11-06: V15 boats is default ON in PLO5 cash (v15BoatsOn), so the
  // card keeps its name and sign with arm B turning it off.
  { name: 'plo5_v15_boats', variant: 'plo5', pairs: 6000, a: {}, b: { v15Boats: false } },
  // V58 (2026-10-25): PLO6 paired-board river nut discipline. a is today's
  // brain with it (default ON), b is the brain without it.
  {
    name: 'plo6_v58_river_nuts',
    variant: 'plo6',
    pairs: 6000,
    a: {},
    b: { v58Plo6RiverNuts: false },
  },
  // V59 (2026-10-25): the same discipline on a PLO6 board with no pair.
  {
    name: 'plo6_v59_river_unpaired',
    variant: 'plo6',
    pairs: 6000,
    a: {},
    b: { v59Plo6RiverUnpaired: false },
  },
  // V74 (2026-10-31): an Omaha semi-bluff raise needs a draw. Default ON:
  // a is today's brain, b is the brain without the gate.
  {
    name: 'plo4_v74_semibluff_needs_draw',
    variant: 'plo4',
    pairs: 6000,
    a: {},
    b: { v74OmahaSemiBluffNeedsDraw: false },
  },
  {
    name: 'plo5_v74_semibluff_needs_draw',
    variant: 'plo5',
    pairs: 6000,
    a: {},
    b: { v74OmahaSemiBluffNeedsDraw: false },
  },
  /*
   * LEAGUE-GATED SELF-TUNER (Dan 2026-10-19: "League-gated nudges"). The
   * nightly tuner proposes +/-0.02 moves on three dials. A move reaches a live
   * horse only when the matching matchup below pools significant positive
   * (runs >= 3, pooled bb/100 > 2 x pooled stderr over the last 30 days;
   * fn_horse_tuner_admitted_classes) AND HORSE_TUNER_LEAGUE_GATED_APPLY=1.
   * Arm a carries the dial moved 0.10 (five nights of steps) so the edge is
   * measurable; arm b is today's brain.
   */
  { name: 'tuner_tightness_up', pairs: 6000, a: {}, b: {}, modsA: { tightness: 1.1 } },
  { name: 'tuner_tightness_down', pairs: 6000, a: {}, b: {}, modsA: { tightness: 0.9 } },
  { name: 'tuner_aggression_up', pairs: 6000, a: {}, b: {}, modsA: { aggression: 1.1 } },
  { name: 'tuner_aggression_down', pairs: 6000, a: {}, b: {}, modsA: { aggression: 0.9 } },
  { name: 'tuner_bluff_up', pairs: 6000, a: {}, b: {}, modsA: { bluffFreq: 1.1 } },
  { name: 'tuner_bluff_down', pairs: 6000, a: {}, b: {}, modsA: { bluffFreq: 0.9 } },
  { name: 'plo8_hilo_layer', variant: 'plo8', pairs: 6000, a: {}, b: { v8HiLo: false } },
  { name: 'shortdeck_v8_layer', variant: 'short_deck', pairs: 6000, a: {}, b: { v8: false } },
  { name: 'nlh_40bb_preflop', stackBB: 40, pairs: 6000, a: {}, b: { v7Preflop: false } },
  { name: 'hu_mind_layer', seats: 2, pairs: 6000, a: {}, b: { mind: false } },
  // ── V16 strategy matchups (2026-08-26) ──
  // 2026-10-05: the overlay resolved NEGATIVE here (-0.26 +/- 0.10 pooled
  // over 31 nights) and is default OFF. Same matchup, same sign: arm A is
  // still "overlay on". The 6-max card measures it where it mostly fires, in
  // ring pots that have come down to two players.
  { name: 'hu_v16_overlay', seats: 2, pairs: 6000, a: { v16Hu: true }, b: {} },
  { name: 'v16_hu_overlay_6max', pairs: 6000, a: { v16Hu: true }, b: {} },
  // 2026-11-07 HU BB DEFENDS TO ITS PRICE (HorseHuBbDefence), default OFF,
  // so arm A turns it on (the v16Hu pattern). Heads-up 80bb with the live
  // cash Hybrid persona and the deal-seeded mood clock: the measured spot
  // (the big blind folded 57.4% to a 71.3% small-blind open). Both seats play
  // both arms across the duplicate pair. Six-max never reaches the flag
  // (two dealt in only), so no six-max card is added. Promoted only after
  // the nightly league confirms it across runs.
  {
    name: 'hu_bb_defends_to_price',
    seats: 2,
    stackBB: 80,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { huBbDefendsToPrice: true },
    b: {},
  },
  // 2026-11-12 (HU-NLH-001) THE SAME FLAG WHERE THE FOLD IS STILL MADE. V85
  // (2026-11-10) widened the heads-up cash big blind above V85_DEPTH_NONE_BB
  // (50bb) only, so the 80bb card above now measures the flag on top of V85.
  // At 50bb or less the V11 bars still decide and the big blind folds 58.7%
  // to a 2bb, 2.5bb or 3bb open alike (real HorseLogic.decide, live cash
  // Hybrid persona, a3f42a08). 50bb is the cash minimum buy-in. This card
  // deals 40bb so the nightly league measures the flag in that band. Same
  // arms, persona and mood clock as the 80bb card; the default is unchanged.
  {
    name: 'hu_bb_defends_to_price_40bb',
    seats: 2,
    stackBB: 40,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { huBbDefendsToPrice: true },
    b: {},
  },
  // 2026-11-12 (HU-AUDIT-002) COMMIT UNDER THE POT (commitUnderPotCall),
  // default OFF since 2026-11-07 and never dealt by any card, so the rule
  // that promotes a flag after the nightly league confirms it could not
  // reach it. Heads-up no-limit hold'em, flop or turn, facing a bet with a
  // stack smaller than the pot: arm A calls where today's brain folds. 40bb,
  // the depth the exploiter suite found it at. The default is unchanged.
  {
    name: 'hu_commit_under_pot',
    seats: 2,
    stackBB: 40,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { commitUnderPot: true },
    b: {},
  },
  // 2026-11-14 (PLO6-AUDIT P6-4) PLO6 TOP SET THAT IS THE CURRENT NUTS
  // (plo6TopSetNutRealization, HorsePlo6TopSetNut.ts), default OFF: arm A
  // prices such a top set at full realization in the V38 flop/turn call
  // menu, arm B is today's brain. The card exists so the nightly league can
  // measure it before anyone proposes a default; the default is unchanged.
  {
    name: 'plo6_top_set_nut_realization',
    variant: 'plo6',
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { plo6TopSetNutRealization: true },
    b: {},
  },
  // 2026-11-15 (PLO6 lane, SWEEP-PLO6 family D2) PLO6 MULTIWAY BET WITH A
  // WEAK MADE HAND (plo6NoMultiwayBetWithWeakMadeHand,
  // HorsePlo6MultiwayWeakBet.ts), default OFF: arm A turns a flop or turn bet
  // facing nothing against two or more live opponents, with a pair below the
  // top card, two pair without it or (added the same day) a pocket pair above
  // the top card of an unpaired board and no qualifying draw, into a check; arm B
  // is today's brain. Six seats, so the pot is multiway, and the production
  // personas: measured 2026-11-15 (seed 20261115, 600 pairs) the arms diverged
  // in 14 pairs with productionStyles and in 0 with the Hybrid baseline, whose
  // one persona does not make this bet in the league (productionStyles
  // re-measured after the pre-review fixes of the same day: 14 pairs again;
  // the Hybrid count was measured before them; neither count was re-run
  // after the overpair class was added, which can only add divergent pairs).
  // The card only measures; the default is unchanged.
  {
    name: 'plo6_no_multiway_bet_with_weak_made_hand',
    variant: 'plo6',
    seats: 6,
    pairs: 6000,
    productionStyles: true,
    a: { plo6NoMultiwayBetWithWeakMadeHand: true },
    b: {},
  },
  // 2026-11-19 (HORSE DECISIONS lane, audit HVH48 auditor C) PLO6 FACING A BET
  // IS PRICED (plo6FacingBetIsPriced, HorsePlo6FacingBetIsPriced.ts), default
  // OFF: arm A answers every PLO6 cash facing-bet spot by price on the exact six
  // cards against the bettor's line range (the random-hand river fold does not
  // run, the paired-board fold and the paired-river check are price tests, a
  // fold stands only where the call is not priced, the river raise is priced);
  // arm B is today's brain. Six seats and the production personas, as the
  // other PLO6 cash cards. The card only measures; the default is unchanged.
  {
    name: 'plo6_facing_bet_is_priced',
    variant: 'plo6',
    seats: 6,
    pairs: 6000,
    productionStyles: true,
    a: { plo6FacingBetIsPriced: true },
    b: {},
  },
  // 2026-11-21 (PLO6 root-cause V2) PLO6 FACING A BET IS PRICED V2
  // (plo6FacingBetIsPricedV2, HorsePlo6FacingBetPricedV2.ts), default OFF:
  // six-card native facing-bet pricing model fixing V1 valueShare blowup,
  // low-SPR jam bucketing, six-card bluff priors, paired-board guard, and
  // river-only call->fold. Six seats and production personas; default unchanged.
  {
    name: 'plo6_facing_bet_is_priced_v2',
    variant: 'plo6',
    seats: 6,
    pairs: 6000,
    productionStyles: true,
    a: { plo6FacingBetIsPricedV2: true },
    b: {},
  },
  // 2026-11-16 (PLO6-AUDIT-013) PLO6 MANIAC PRICE REFUSAL TO THE RANGE PLAY
  // (plo6ManiacPriceRefusalToRangePlay), opt-in since 2026-11-16 because its
  // production reach row was not met by the deadline Hand Analysis set: arm A
  // hands a price refused against an observed maniac to the range play, arm
  // B is today's brain (the fold). The arm needs an observed-maniac read on
  // the raiser faced, so whether self-play reaches it is not measured here;
  // the card exists so the nightly league can report it before anyone
  // proposes the default again. The default is unchanged by this card.
  {
    name: 'plo6_maniac_price_refusal_to_range_play',
    variant: 'plo6',
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { plo6ManiacPriceRefusalToRangePlay: true },
    b: {},
  },
  // 2026-11-16 (PLO6 lane) THE SIX-CARD PORT OF THE OMAHA STRATEGY OPTIONS
  // (omahaStrategyInPlo6, default OFF and OFF-ONLY). Both arms switch on the
  // 27 catalogue options the PLO6 port takes or adapts (plo6StrategyOptionVerdict;
  // the four it skips stay off); arm A also opens the PLO6 gate, so the card
  // measures the port alone: in arm B those options are outside PLO6 and the
  // arm is today's six-card brain. Six seats, production personas, cash.
  // Smoke run measured 2026-11-16 (150 pairs / 300 hands, seed 20261116,
  // 9.088 s at nice 19): 38 of 150 pairs diverged (inert false), bb100
  // -7.42 +/- 15.26 (blockStderr 11.02 over 6 blocks), 0 illegalActions,
  // 0 truncatedStreets, 0 correctedActions, 0 brainExceptionFallbacks. Not
  // yet measured at the full 6,000-pair card size.
  // The card only measures; the gate stays off-only and no evidence row is
  // claimed from it.
  ...(() => {
    const ported = {
      omahaOopTurnCheckAfterFlopCall: true,
      omahaTurnRiverRaiseNeedsNuts: true,
      omahaNoDrawRaiseOutOfPosition: true,
      omahaBigDrawAggression: true,
      omahaBareOverpairOopFlopCheck: true,
      omahaOverpairNoOopBarrelVsValueLeader: true,
      omahaPairedRiverNoThinLeadVsValueLeader: true,
      omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
      omahaTurnBetNeedsRiverPlan: true,
      omahaStreetPlan: true,
      omahaCardImpact: true,
      omahaFacingBetEv: true,
      omahaRiverMediumBetStrongHandCalls: true,
      omahaBigBetIsPotShare: true,
      omahaPairedBoardFoldRespectsPrice: true,
      omahaBluffCatcherFoldVsValueLeader: true,
      omahaMadeHandDefenseVsValueLeader: true,
      omahaPressureNeedsPostflopAggression: true,
      omahaStrongHandValue: true,
      omahaUnderpairNoMultiwayFlopContinue: true,
      omahaReraiseRangeOutOfPosition: true,
      omahaReraiseRangeEarlyPosition: true,
      omahaOopReraisedPotStrongRange: true,
      omahaReraisedPotFlopContinueNeedsEquityShape: true,
      omahaNoCallColdFourBetWithoutPremium: true,
      omahaManiacReRaiseWidthMeasured: true,
      omahaVpipFloorByLimp: true,
    };
    return [
      {
        name: 'plo6_omaha_strategy_six_card_port',
        variant: 'plo6',
        seats: 6,
        pairs: 6000,
        productionStyles: true,
        a: { ...ported, omahaStrategyInPlo6: true },
        b: ported,
      },
    ];
  })(),
  // 2026-11-13 OMAHA TOURNAMENT FIRST-IN (HorseOmahaTournamentFirstIn),
  // default ON: a is today's brain, b the engine fold it replaces. The small
  // blind against the big blind alone plays every hand as the pot-limit
  // maximum raise and the heads-up big blind defends its top 75 percent,
  // three or fewer dealt, 20 BB or less (docs/changelog/2026-11-13-omaha-
  // tournament-first-in.md). Standing cards so a later change that brings
  // the walk back shows on the nightly league.
  ...(['plo4', 'plo6'] as const).map((variant) => ({
    name: `${variant}_mtt_hu_omaha_tournament_first_in_12bb`,
    variant,
    seats: 2,
    stackBB: 12,
    context: finalTableMttContext(2, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed' as const,
    a: {},
    b: { omahaTournamentFirstIn: false },
  })),
  // 2026-11-15 OMAHA SMALL BLIND STEAL (omahaSmallBlindSteal, default OFF,
  // off-only in the live switch while the blind-steal hold stands): four to
  // eight dealt, PLO4/PLO5, the small blind folded to plays its top 40 percent
  // at 20 BB or less. a switches it on, b is today's brain. The card only measures.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_mtt_6max_omaha_small_blind_steal_12bb`,
    variant,
    seats: 6,
    stackBB: 12,
    context: bigBlindAnteMttContext(6, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed' as const,
    a: { omahaSmallBlindSteal: true },
    b: {},
  })),
  // 2026-11-15 OMAHA STRATEGY IN TOURNAMENTS (omahaStrategyInTournaments,
  // owner 13:16, default OFF): the day's PLO4/PLO5 options also run in a
  // tournament hand, chip-adding conversions paying the survival premium.
  // Both arms switch the day's options on; a also switches the extension on,
  // so the card measures the tournament extension alone. 6-max MTT, 40 BB
  // (deeper than the 14 BB push/fold line the extension stands aside at).
  ...(['plo4', 'plo5'] as const).map((variant) => {
    const day = {
      omahaBareOverpairOopFlopCheck: true,
      omahaOopTurnCheckAfterFlopCall: true,
      omahaTurnRiverRaiseNeedsNuts: true,
      omahaNoDrawRaiseOutOfPosition: true,
      omahaFacingBetEv: true,
      omahaCardImpact: true,
      omahaStreetPlan: true,
      omahaReraiseRangeOutOfPosition: true,
      omahaReraiseRangeEarlyPosition: true,
      omahaOopReraisedPotStrongRange: true,
      omahaNoCallColdFourBetWithoutPremium: true,
      omahaUnderpairNoMultiwayFlopContinue: true,
    };
    return {
      name: `${variant}_mtt_6max_omaha_strategy_in_tournaments_40bb`,
      variant,
      seats: 6,
      stackBB: 40,
      context: bigBlindAnteMttContext(6, 40),
      pairs: 6000,
      hybridBaseline: true,
      moodClock: 'deal_seed' as const,
      a: { ...day, omahaStrategyInTournaments: true },
      b: day,
    };
  }),
  // 2026-11-20 lane NOV8 / HIDDEN-ON (omahaEvFoldModelSkipsPlo45, default OFF; HIDDEN-ON grade PASS, fit +130.2 +- 44.3
  // bb, holdout +124.2 +- 80.5): both arms carry production's live Omaha set; a also skips the EV fold model for
  // PLO4/PLO5. 100 bb cash. Declared, not run.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_ev_fold_model_skips_plo45`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaEvFoldModel: true, omahaEvFoldModelSkipsPlo45: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118, omahaEvFoldModel: true },
  })),
  // 2026-11-20 CORE-LAND (omahaBandFallbackInBandUnit, default OFF, unevaluated): both arms carry production's live
  // Omaha set; a also measures the equity sampler's band fallback in the band's percentile unit. 100 bb cash.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_band_fallback_in_band_unit`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaBandFallbackInBandUnit: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-19 lane MATHCORE / COREWIRE (omahaMathCore, default OFF, graded by lane PROVE): both arms carry
  // production's live Omaha set; a also switches the math-first core on (every street admitted). 100 bb cash.
  ...(['plo4', 'plo5'] as const).map((variant) => {
    const street = variant === 'plo4' ? 'Plo4' : 'Plo5';
    return {
      name: `${variant}_omaha_math_core`,
      variant,
      pairs: 6000,
      productionStyles: true,
      a: {
        ...OMAHA_LIVE_OPTIONS_20261118,
        omahaMathCore: true,
        [`omahaMathCore${street}Flop`]: true,
        [`omahaMathCore${street}Turn`]: true,
        [`omahaMathCore${street}River`]: true,
      },
      b: { ...OMAHA_LIVE_OPTIONS_20261118 },
    };
  }),
  // 2026-11-19 lane UNBLOCK (omahaNoCategoricalRules, default OFF, unevaluated): both arms carry production's
  // live Omaha set; a also switches every categorical PLO4/PLO5 cash rule off. 100 bb cash. Declared, not run.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_no_categorical_rules`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaNoCategoricalRules: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-18 ROWFIX (omahaTournamentsExcludeCategoricalRules, default OFF, unevaluated): both arms carry
  // production's live Omaha set (OMAHA_LIVE_OPTIONS_20261118, the tournament extension on); a also keeps the
  // categorical rules cash-only, so the card measures the categorical rules' tournament reach alone. 6-max
  // MTT, 40 BB (deeper than the 14 BB push/fold line). Declared, not run.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_mtt_6max_omaha_tournaments_exclude_categorical_rules_40bb`,
    variant,
    seats: 6,
    stackBB: 40,
    context: bigBlindAnteMttContext(6, 40),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed' as const,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaTournamentsExcludeCategoricalRules: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-19 HORSE DECISIONS lane builder F-FIX (omahaMultiwayIsPricedInTournaments, default OFF,
  // unevaluated): both arms carry production's live Omaha set (OMAHA_LIVE_OPTIONS_20261118); a also prices the
  // multiway preflop call-off and the multiway own bet. 6-max big-blind-ante MTT at 15 BB, where the auditor's
  // call-offs sat (7 to 24 BB); PLO4 and PLO8 (five of its nine call-offs were hi-lo). Declared, not run.
  ...(['plo4', 'plo8'] as const).map((variant) => ({
    name: `${variant}_mtt_6max_omaha_multiway_is_priced_in_tournaments_15bb`,
    variant,
    seats: 6,
    stackBB: 15,
    context: bigBlindAnteMttContext(6, 15),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed' as const,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaMultiwayIsPricedInTournaments: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
  })),
  // 2026-11-14 OMAHA HI-LO HEADS-UP TOURNAMENT FIRST-IN (HU-HILO-002),
  // default OFF: a is the option on, b today's brain. PLO8 heads-up final
  // table at 12 BB, where the small blind folds 83-85 percent first in and
  // the big blind 81-91 percent to one raise. The card only measures.
  {
    name: 'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb',
    variant: 'plo8',
    seats: 2,
    stackBB: 12,
    context: finalTableMttContext(2, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { omahaHiLoTournamentFirstIn: true },
    b: {},
  },
  {
    name: 'plo4_spin_3max_omaha_tournament_first_in_12bb',
    variant: 'plo4',
    seats: 3,
    stackBB: 12,
    context: winnerTakeAllSpinContext(3, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: {},
    b: { omahaTournamentFirstIn: false },
  },
  // 2026-11-07 NASH CALL VS JAM (HorseNashPushFoldV2), default ON: a is
  // today's brain, b the strength bar it replaced. MTT 12bb with a 1bb
  // big-blind ante, six-max and heads-up, the measured spots
  // (docs/changelog/2026-11-07-nash-push-fold-v2.md: +1.8 to +4.9 bb/100 on
  // 20,000 pairs, two seeds). The human-calibrated field never open-jams, so
  // no human-field twin can measure it.
  {
    name: 'mtt6_nash_call_vs_jam_12bb',
    seats: 6,
    stackBB: 12,
    context: bigBlindAnteMttContext(6, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: {},
    b: { nashCallVsJam: false },
  },
  {
    name: 'mtt_hu_nash_call_vs_jam_12bb',
    seats: 2,
    stackBB: 12,
    context: bigBlindAnteMttContext(2, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: {},
    b: { nashCallVsJam: false },
  },
  // 2026-11-15 PAYOUT-AWARE SHORT-STACK PUSH/FOLD (nashPushFoldIcm, hand
  // 59441335; default OFF, owner preflop range hold). With the option on, a
  // short stack with a pay jump live and the stacks, payouts and its identity
  // in the context prices the V71 jam and the nashCallVsJam call at its own
  // bubble factor; unset is chip EV. A six-handed in-the-money final table at
  // 12bb with a 1bb big-blind ante and the stack list (the only league
  // context where the option can act). The league scores chips, not payouts:
  // the payout-aware arm gives up chips by design, so this card measures what
  // the option costs in chips, not its value.
  // 2026-11-15 PAID BUST (icmBustPaysPlace, default OFF, Hand Analysis B3):
  // the same in-the-money final table; a values a bust at the place it pays,
  // b at 0 as before. Chips, not payouts, are scored, so this card measures
  // what the corrected bubble factor costs or gains in chips.
  // 2026-11-15 STACK-SCALED UTILITY MARGIN (tournamentUtilityStackScaledMargin,
  // default OFF): the same in-the-money final table; a measures the utility's
  // equity margin against the candidate's own sensitivity, b against the whole
  // pool as before. Chips, not payouts, are scored: the card measures what the
  // narrower margin costs or gains in chips, not its payout value.
  {
    name: 'mtt6_ft_utility_stack_scaled_margin_12bb',
    seats: 6,
    stackBB: 12,
    context: finalTableMttWithStacksContext(6, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { tournamentUtilityStackScaledMargin: true },
    b: {},
  },
  {
    name: 'mtt6_ft_icm_bust_pays_place_12bb',
    seats: 6,
    stackBB: 12,
    context: finalTableMttWithStacksContext(6, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { icmBustPaysPlace: true },
    b: {},
  },
  {
    name: 'mtt6_ft_pay_jump_push_fold_12bb',
    seats: 6,
    stackBB: 12,
    context: finalTableMttWithStacksContext(6, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { nashPushFoldIcm: true },
    b: {},
  },
  // 2026-11-13 A COMMITTED STACK IS NOT FOLDED AT A PRICE
  // (committedStackPricedIn, default OFF; study HVH2D-NLH-M-COMMIT and
  // HVH2D-NLH-007a). Tournament multiway all-in only: arm A lets the priced-in
  // guard decide again at a token price, at 2bb or less behind, or with half
  // the starting stack in. The context carries the live M state, without
  // which the branch never exists. Every seat starts each hand with the same
  // stack, so the half-the-stack case almost never arises here: measured
  // 2026-11-13 at seed 1107, the same card at 10bb and at 6bb diverged in 0
  // of 6,000 and 0 of 2,000 pairs. At 4bb the big blind's ante leaves it 2bb
  // behind, which is the rule's crumbs case: 788 of 2,000 pairs diverged. This
  // card measures that case; the study spots themselves are the law test's.
  // The default is unchanged.
  {
    name: 'mtt6_committed_stack_priced_in_4bb',
    seats: 6,
    stackBB: 4,
    context: bigBlindAnteMttWithMContext(6, 4),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { committedStackPricedIn: true },
    b: {},
  },
  // 2026-11-19 A HOLD'EM TOURNAMENT ALL-IN CALL IS PRICED
  // (holdemTournamentAllInCallIsPriced, default OFF, off-only under the owner
  // preflop range hold; Horse Decisions audit E). A 12bb six-handed
  // big-blind-ante MTT with the live M state: open-jams, re-jams and calls of
  // jams are the common decision at this depth, so arm A prices every all-in
  // call and lets no arbiter reverse it beyond 5 equity points. Declared, not
  // run: the audit fixtures are the law test's
  // (AHoldemTournamentAllInCallIsPriced.law.test.ts). The default is unchanged.
  {
    name: 'mtt6_holdem_tournament_all_in_call_is_priced_12bb',
    seats: 6,
    stackBB: 12,
    context: bigBlindAnteMttWithMContext(6, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { holdemTournamentAllInCallIsPriced: true },
    b: {},
  },
  // 2026-11-24 HOLD'EM TOURNAMENT RAISE DEFENCE (three options, default OFF;
  // NLH-TOURNAMENT-SWEEP L1/L2/L4, HorseHoldemTournamentRaiseDefence.ts). Each
  // card isolates one option, arm A on, arm B today's brain, with the live
  // M state and the deal-seeded mood clock. Heads-up 18bb (a Spin endgame /
  // heads-up SNG: winner-take-all, chip EV), six-handed 17bb big-blind-ante
  // MTT (blinds facing steals), six-handed 22bb big-blind-ante MTT (re-raises
  // after an open, the depth the sweep measured). Declared at 12bb first: the
  // mirror league's openers jam or fold at 12bb, so nobody faced a non-all-in
  // open and both cards were inert there (2026-11-24, v2 run). The options
  // stay default OFF until their evidence is met.
  {
    name: 'hu_holdem_tournament_heads_up_big_blind_defence_is_priced_18bb',
    seats: 2,
    stackBB: 18,
    context: winnerTakeAllSpinContext(2, 18),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { holdemTournamentHeadsUpBigBlindDefenceIsPriced: true },
    b: {},
  },
  {
    name: 'mtt6_holdem_tournament_blind_defence_is_priced_17bb',
    seats: 6,
    stackBB: 17,
    context: bigBlindAnteMttWithMContext(6, 17),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { holdemTournamentBlindDefenceIsPriced: true },
    b: {},
  },
  // The six-handed Sit & Go format (2026-11-24): all three options together, 17bb, no ante, two paid.
  {
    name: 'sng6_holdem_tournament_raise_defence_is_priced_17bb',
    seats: 6,
    stackBB: 17,
    context: sixMaxSngContext(6, 17),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: {
      holdemTournamentHeadsUpBigBlindDefenceIsPriced: true,
      holdemTournamentBlindDefenceIsPriced: true,
      holdemTournamentCommittedRaiseIsPriced: true,
    },
    b: {},
  },
  {
    name: 'mtt6_holdem_tournament_committed_raise_is_priced_22bb',
    seats: 6,
    stackBB: 22,
    context: bigBlindAnteMttWithMContext(6, 22),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { holdemTournamentCommittedRaiseIsPriced: true },
    b: {},
  },
  // 2026-11-14 PLO6 COMMITMENT-ZONE RE-RAISE PRICE RELIEF
  // (omahaCommitZoneThreeBetPriceRelief, default OFF; PLO6 tournament-folds
  // study, docs/changelog/2026-11-14-plo6-commit-zone-price-relief.md). Six-
  // card Omaha high in the commitment zone facing a re-raise: arm A takes the
  // wider price relief. A 40bb six-handed big-blind-ante MTT with the live M
  // state, the depth the study measured (development human field, chips only:
  // +6.83 +/- 3.78 and +7.62 +/- 3.77 bb/100 on two seeds). Payout is not
  // measured. The default is unchanged.
  {
    name: 'plo6_mtt6_commit_zone_three_bet_price_relief_40bb',
    variant: 'plo6',
    seats: 6,
    stackBB: 40,
    context: bigBlindAnteMttWithMContext(6, 40),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { omahaCommitZoneThreeBetPriceRelief: true },
    b: {},
  },
  // 2026-11-07 PREFLOP DEFENCE LEAKS, both default OFF, so arm A turns each
  // on (docs/changelog/2026-11-07-horse-preflop-defence-leaks.md). A 20bb
  // four-handed big-blind-ante big blind facing a min-raise (jam-or-fold
  // today; mirror +1.38 / +2.82 bb/100, human six-handed field -3.13 / -1.54,
  // unresolved) and a 20bb six-handed cash opener facing a 3-bet (folds 97%
  // of its open today; mirror +0.30 / +0.70, one human seed -2.98 +/- 1.31).
  // Promoted only after the nightly league confirms them across runs.
  {
    name: 'mtt4_facing_open_full_ring_20bb',
    seats: 4,
    stackBB: 20,
    context: bigBlindAnteMttContext(4, 20),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { facingOpenFullRingZone: true },
    b: {},
  },
  // 2026-11-15 HOLD'EM PERSONA POSTFLOP (holdemPersonaPostflop, default OFF):
  // a reads the persona on three V87 postflop mixes (check-trap, turn
  // takeaway, range continuation bet); b is today's fleet mix. Not yet run.
  {
    name: 'cash6_holdem_persona_postflop',
    seats: 6,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { holdemPersonaPostflop: true },
    b: {},
  },
  // 2026-11-14 PERSONA RE-RAISE MIX (D3 option C), default OFF, so arm A
  // turns it on: six-handed 100bb no-limit hold'em cash, where the 3-bet
  // bluff and the squeeze bluff are met every orbit. The card's seats are the
  // league's own ids, not the fleet's 25/20/40/15 archetype mix (the
  // opportunity-weighted harness HoldemPersonaReRaiseProbe measures that).
  // Not yet run.
  {
    name: 'cash6_holdem_persona_reraise_mix',
    seats: 6,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { holdemPersonaReRaiseMix: true },
    b: {},
  },
  // 2026-11-15 HOLD'EM PERSONA PREFLOP (plan lines 85 and 152), default OFF,
  // so arm A turns it on: nine-handed 100bb no-limit hold'em cash, where the
  // archetype range shifts and the persona re-raise mix all act. The card's
  // seats are the league's own ids, not the fleet's 25/20/40/15 mix (the
  // opportunity-weighted HoldemPersonaPreflopProbe measures that). Not yet run.
  {
    name: 'cash9_holdem_persona_preflop',
    seats: 9,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    handIdentity: 'deal_seed',
    a: { holdemPersonaPreflop: true },
    b: {},
  },
  {
    name: 'nlh_20bb_vs3bet_short_stack',
    stackBB: 20,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { vs3BetShortStack: true },
    b: {},
  },
  /*
   * v16_ratio_rescale is NOT on the card (2026-09-05). Measured 2026-09-04:
   * 0.00 bb100 with 0.00 stderr over 12,000 hands - the flag changed no
   * decision at all (08-31, before V38, it read +0.35 +/- 0.24, unresolved).
   * The flag rescales two thresholds in HorseLogic: the OOP check-raise
   * bluff gate (betRatio <= 0.6 vs 1.5, which on the bet/(pot+bet) scale is
   * "bet at most 1.5x pot" either way and never binds) and the heads-up river
   * bluff-catch gate (0.4 vs 0.667). V38 - opts.v38Ev, default ON since
   * 2026-09-03 - returns a call or a fold for EVERY river spot and every
   * solverless flop/turn spot before that second gate is reached, so no hand
   * can differ between the arms. Same shape as v18_exploit_size and
   * v31_gto_suit_aware below: a matchup that always reports 0.00 +/- 0.00
   * spends 12,000 hands a night measuring nothing. The default stays OFF;
   * the promotion rule (three significant positive runs) cannot be met by a
   * flag that no longer reaches code.
   * Re-measured 2026-09-21 with runMatchup's divergence count: 0 of 1,000 and
   * 0 of 6,000 pairs diverged at seeds 4242 and 20260921. INERT; still off.
   */
  // v16_ratio_rescale now reports through UNMEASURABLE_MATCHUPS (2026-10-31).
  // V55 is opt-in. Freeze the deep cash domain before examining results:
  // the audit's leaking river re-shoves occurred above 100bb.
  ...(['plo4', 'plo5', 'plo6'] as const).map((variant) => ({
    name: `${variant}_v56_pressure_range`,
    variant,
    stackBB: 400,
    pairs: 6000,
    a: { v56OmahaPressureRange: true },
    b: { v56OmahaPressureRange: false },
  })),
  // plo4/plo5/plo6_v55_river_trips_flat are in UNMEASURABLE_MATCHUPS
  // (2026-10-31): the paired-board fold and V56 decide every spot V55 was
  // built for, so the arms played identical poker from 2026-10-27. They
  // report a refused row every run instead of a nightly 0.00 +/- 0.00.
  { name: 'v16_sizecond', pairs: 6000, a: {}, b: { v16SizeCond: false } },
  { name: 'plo4_v16_polarity', variant: 'plo4', pairs: 6000, a: {}, b: { v16PloPolar: false } },
  // Measurable because playHand's sandbox settlement now feeds
  // observeHandComplete — the reads accumulate inside each pass's sandbox.
  { name: 'v16_deep_reads', pairs: 6000, a: {}, b: { v16Reads: false } },
  // ── V17 (2026-08-26) ──
  { name: 'v17_positional', pairs: 6000, a: {}, b: { v17Pos: false } },
  // 2026-10-16: the river probe resolved NEGATIVE pooled over the audit's
  // 7-day window (-0.11 +/- 0.04) and is default OFF. Same matchup, same
  // sign: arm A is still "probe on".
  { name: 'v17_river_probe', pairs: 6000, a: { v17RiverProbe: true }, b: {} },
  { name: 'shortdeck_v17', variant: 'short_deck', pairs: 6000, a: {}, b: { v17ShortDeck: false } },
  // 2026-11-22 HORSE DECISIONS lane (v17ShortDeckIsPriced, default OFF, OPTION_SWITCH_REFUSED, 0 migrations):
  // the priced Short Deck multiway shift against the fixed V17 overlay. Horse-vs-Horse: informational only.
  {
    name: 'shortdeck_v17_priced',
    variant: 'short_deck',
    pairs: 6000,
    a: { v17ShortDeckIsPriced: true },
    b: {},
  },
  // ── V18 (2026-08-26) ──
  { name: 'v18_squeeze_response', pairs: 6000, a: {}, b: { v18Squeeze: false } },
  // ── V29-V33 (2026-09-01) ── THE SOLVER STACK HAD NO ABLATION MATCHUP AT
  // ALL. V29/V30/V31/V32 shipped between 08-29 and 08-30, they short-circuit
  // the mature V15-V23 layers on every spot they answer, and nothing on the
  // card could say whether that trade was positive. Their gates need heads-up
  // hold'em with the betting lead, so they are dealt at seats: 2 - the same
  // shape hu_mind_layer uses.
  { name: 'v29_gto_flop', seats: 2, pairs: 6000, a: {}, b: { v29GtoFlop: false } },
  { name: 'v30_gto_turn_river', seats: 2, pairs: 6000, a: {}, b: { v30GtoTurnRiver: false } },
  /*
   * v31_gto_suit_aware is NOT on the card. Measured 2026-09-01: it returned
   * 0.00 bb100 with 0.00 stderr over 12,000 hands, which is not "no edge" -
   * an exact zero with zero variance means the flag changed no decision at
   * all. Live telemetry says why: v31_gto_open fired 195 times against
   * 924,871 decides on the same day, so at 6,000 pairs the matchup expects
   * roughly TWO firings, and observing zero difference is the likely
   * outcome rather than a surprising one. The league cannot resolve a layer
   * this rare at any sample size it can afford, and a matchup that always
   * reports 0.00 +/- 0.00 spends 12,000 hands teaching us nothing while the
   * card is only completing one matchup a night. Ablate it deliberately with
   * a temporary pairs bump if it ever needs a verdict.
   * Re-measured 2026-09-21: 0 of 1,000 and 0 of 6,000 pairs diverged at seeds
   * 4242 and 20260921 (INERT); a heads-up v11 control diverged in 7 and 2 of 1,000.
   */
  // v31_gto_suit_aware now reports through UNMEASURABLE_MATCHUPS (2026-10-31).
  // 2026-10-16: the facing-bet defence resolved NEGATIVE heads-up (-0.31 +/-
  // 0.15 over 41 nightly runs) and is default OFF. Same matchup, same sign:
  // arm A is still "defence on".
  {
    name: 'v32_facing_defense',
    seats: 2,
    pairs: 6000,
    a: { v32FacingDefense: true },
    b: {},
  },
  // The depth ceiling only changes a decision ABOVE it, so dealing this at
  // the standard 100bb would measure exactly nothing and report 0.00 +/- 0.00
  // forever - the inert-matchup shape the audit now flags. 400bb is past
  // GTO_MAX_DEPTH_BB (300), which is the only place the flag has an effect.
  {
    name: 'v33_depth_ceiling_400bb',
    seats: 2,
    stackBB: 400,
    pairs: 6000,
    // Default OFF since 2026-09-28 (23 runs pooled: -2.97 +/- 1.09 with it
    // on), so a turns it on and b is today's brain. A negative result here
    // now confirms the default.
    a: { v33DepthCeiling: true },
    b: {},
  },
  // 2026-10-31: LIVE, REACHED, RARELY DECISIVE. The layer fires inside the
  // league sandbox (154 v18_self_image fires per 8,640 decides in a 500-pair
  // probe) but only moves bluffScale by x0.85 / x1.1, which flips a decision in
  // about 1.5 pairs per 1,000. At 6,000 pairs that is ~9 expected divergent
  // pairs, and 2026-10-30 drew zero: an INERT night by chance, not a dead flag
  // (53 of its 58 nightly rows since 2026-08-28 carry a stderr). Neither the
  // human field (3 of 3,000), production personas (1 of 1,500), persona dials
  // (0-1 of 1,500) nor heads-up (0 of 2,000) reaches it more often, so the
  // card buys the sample instead: 24,000 pairs expect ~36 divergent pairs and
  // cost ~4 minutes (production ran 6,000 in ~59 s), paid for by the two V55
  // cards that left for UNMEASURABLE_MATCHUPS (~9 minutes a night).
  { name: 'v18_self_image', pairs: 24_000, a: {}, b: { v18SelfImage: false } },
  /*
   * v18_exploit_size is NOT on the card, and this one is impossible by
   * CONSTRUCTION rather than merely underpowered - it reported 0.00 +/- 0.00
   * on 2026-08-28 and 2026-09-01 (the 2026-08-31 row read -0.04 +/- 0.15).
   * Re-measured 2026-09-21: 0 of 1,000 and 0 of 6,000 pairs diverged at seeds
   * 4242 and 20260921. INERT.
   *
   * The layer multiplies its river raise by (exploit.valueThinMod - 1), and
   * only counts a firing when abs(valueThinMod - 1) > 0.03. HorseMind.exploit
   * moves valueThinMod off 1 ONLY when the opponent's fold-vs-aggression rate
   * leaves the middle band - above 0.62 (a folder) or below 0.35 (a station).
   * A league matchup is a MIRROR: both arms are the same brain, differing
   * only in the flag under test, so each arm's opponent folds at the brain's
   * own middling rate and valueThinMod stays exactly 1. The multiplier is
   * then exactly 1, the telemetry gate never opens, and the two arms play
   * byte-identical poker. 0.00 +/- 0.00 is the correct answer to the question
   * this matchup was asking; the question was just unanswerable.
   *
   * Measuring it needs an exploitable opponent, which self-play cannot
   * produce. It is pinned deterministically instead, where the effect is
   * exact and costs no hands at all:
   * server/src/engine/V18ExploitSizingIsMeasurable.test.ts
   */
  // v18_exploit_size now reports through UNMEASURABLE_MATCHUPS (2026-10-31).
  // 2026-08-27: the bet-ratio scale repair. There is no "off" for a fixed
  // arithmetic bug, so this measures the sizing-read layer as a whole
  // against playing without size reads at all - if the repair helps, this
  // matchup should grow relative to its own history.
  { name: 'v19_size_reads', pairs: 6000, a: {}, b: { v7SizeReads: false } },
  // ── V20 (2026-08-27) ──
  // Multiway discipline lives postflop in every variant; measure it on the
  // standard NLH card where multiway all-in chains actually occur. The
  // M-zone layer only fires in tournament mode, which the league does not
  // deal (gameMode: 'cash'), so it is validated by scenario tests instead —
  // same position V16 real ICM shipped from.
  { name: 'v20_multiway', pairs: 6000, a: {}, b: { v20Multiway: false } },
  // ── V21 (2026-08-27, Phase 2) ── river endgame: NLH nut status, dominated
  // caps, the raise-war governor. Measured on the standard NLH card where
  // the -500bb river wars actually happened.
  { name: 'v21_river_endgame', pairs: 6000, a: {}, b: { v21River: false } },
  // Deep-stack discipline only differs past 120bb — deal it at 250bb.
  { name: 'v21_deep_250bb', stackBB: 250, pairs: 6000, a: {}, b: { v21Deep: false } },
  // ── V23 (2026-08-28) ── the cash-measurable slices. The endgame and spin
  // layers only fire in tournament/spin modes the league does not deal;
  // they ship scenario-tested with telemetry, the way V16 real ICM did.
  { name: 'v23_raise_plans', pairs: 6000, a: {}, b: { v23Plan: false } },
  // 2026-10-31: the same shape as v18_self_image above. The reads fire in the
  // sandbox (58 v23_river_read per 8,640 decides) and diverge about 0.5-1.3
  // pairs per 1,000; 2026-10-30 rounded to 0.00 +/- 0.00. 24,000 pairs expect
  // 12-30 divergent pairs, so a night cannot come up empty by chance.
  { name: 'v23_river_reads', pairs: 24_000, a: {}, b: { v23Reads: false } },
  // 2026-10-16: the short-deck half of V23 resolved NEGATIVE (-0.36 +/- 0.14
  // over 44 nightly runs) and is default OFF behind v23ShortDeck; the plo8
  // low-draw half wins (+1.63 +/- 0.18) and stays on under v23Variants. Same
  // matchup, same sign: arm A is still "short-deck polish on".
  { name: 'shortdeck_v23', variant: 'short_deck', pairs: 6000, a: { v23ShortDeck: true }, b: {} },
  { name: 'plo8_v23_lowdraw', variant: 'plo8', pairs: 6000, a: {}, b: { v23Variants: false } },
  // ── V24 (2026-08-28) ── Dan full-potted 8 PLO hands in a PKO and was never
  // called once. The price defense is measurable on a PLO card; the bounty
  // layer and the tempo floors only exist in tournament/live conditions the
  // league cannot deal, so those ship scenario-tested with telemetry.
  { name: 'plo4_v24_price', variant: 'plo4', pairs: 6000, a: {}, b: { v24PloDefense: false } },
  // 2026-10-31: the PLO6 cash half resolved NEGATIVE pooled over the audit's 7-run
  // window (-2.34 +/- 1.12 to 2026-10-30; -2.41 +/- 0.98 over the 9 runs since
  // 2026-10-23, against -0.20 +/- 0.42 over the 42 runs before 2026-10-17) and
  // is default OFF in PLO6 cash (HorseLogic v24PloDefenseOn). Same matchup, same
  // sign: arm A is still "price defense on"; arm B is today's brain.
  { name: 'plo6_v24_price', variant: 'plo6', pairs: 6000, a: { v24PloDefense: true }, b: {} },
  // ── V40 (2026-09-04) ── "horses are playing PLO like it's hold'em". The
  // tiered aggressor sampler, the pair/two-pair/trips pressure cap and the
  // small-ball betting law, measured where the naked-aces call-down
  // happened (plo6) and on the widest-played Omaha card (plo4).
  // V46 (2026-09-05): the hand-class chart. The league seats horses with the
  // cards it deals, so this is one of the few layers self-play measures
  // honestly: both arms see the same shapes, only one reads them.
  { name: 'plo4_v46_classes', variant: 'plo4', pairs: 6000, a: {}, b: { v46Charts: false } },
  { name: 'plo6_v46_classes', variant: 'plo6', pairs: 6000, a: {}, b: { v46Charts: false } },
  // 2026-10-05: the short-deck chart resolved NEGATIVE (-0.51 +/- 0.15 over
  // 960k hands) and is default OFF behind v46ShortDeck. Same matchup, same
  // sign: arm A is still "chart on", so the nightly series stays continuous.
  {
    name: 'shortdeck_v46_classes',
    variant: 'short_deck',
    pairs: 6000,
    a: { v46ShortDeck: true },
    b: {},
  },
  // V51 (2026-10-05): a committed river one-pair hand calls instead of
  // jamming. Measured on the standard NLH card, where the committed river
  // spot arises from ordinary 100bb raise wars.
  { name: 'v51_river_flat', pairs: 6000, a: {}, b: { v51RiverFlat: false } },
  // V52 (2026-10-24): the public-range advantage read behind the continuation
  // work. Same-hour live reviews showed NLH big-bet-then-fold rising 9.5% ->
  // 13.3% after it shipped; outcome tags cannot say whether the extra
  // initiative earns, so each variant where it fires is measured on/off.
  // Arm A is "range advantage on" (production default).
  { name: 'v52_range_advantage', pairs: 6000, a: {}, b: { v52RangeAdvantage: false } },
  {
    name: 'plo4_v52_range_advantage',
    variant: 'plo4',
    pairs: 6000,
    a: {},
    b: { v52RangeAdvantage: false },
  },
  {
    name: 'plo5_v52_range_advantage',
    variant: 'plo5',
    pairs: 6000,
    a: {},
    b: { v52RangeAdvantage: false },
  },
  {
    name: 'plo6_v52_range_advantage',
    variant: 'plo6',
    pairs: 6000,
    a: {},
    b: { v52RangeAdvantage: false },
  },
  // V53 (2026-10-24): pressure on a credibly aggressive human. Read-gated,
  // so a horse-only league arm engages it only where a horse's own play reads
  // outside the envelope; arm A is production (on).
  // 2026-10-31: in hold'em that never happens - every v53_pressure row from
  // 2026-10-25 read 0.00 +/- 0.00 (0 of 6,000 pairs), while production fires
  // V53 tens of thousands of times a day against real aggressors. Hold'em has
  // no aggressive-raiser prior (the Omaha cards below engage through it), and
  // probes found no mirror that reaches it: the human-calibrated field 0 of
  // 3,000, maxed aggression dials 1 of 1,500, heads-up 0 of 2,000. It is now
  // dealt against the opponent it is built for - one hero horse in the V53
  // aggressor field (V53_PRESSURE_POPULATION_ID): 48 and 63 of 2,000 pairs
  // diverged at seeds 20261031 and 4242. Same name and sign (arm A on).
  {
    name: 'v53_pressure',
    pairs: 12_000,
    a: {},
    b: { v53Pressure: false },
    opponentPopulation: V53_PRESSURE_POPULATION_ID,
  },
  { name: 'plo4_v53_pressure', variant: 'plo4', pairs: 6000, a: {}, b: { v53Pressure: false } },
  { name: 'plo5_v53_pressure', variant: 'plo5', pairs: 6000, a: {}, b: { v53Pressure: false } },
  { name: 'plo6_v53_pressure', variant: 'plo6', pairs: 6000, a: {}, b: { v53Pressure: false } },
  // V54 (2026-10-24): the targeted river bluff. Dan: "the bluff shove or
  // big bet bluff needed to be implemented ONLY WHEN IT MAKES SENSE." Default
  // OFF, so arm A turns it on (the v16Hu pattern); it is promoted to every
  // horse only after qualification and an explicit protected default change.
  { name: 'v54_river_bluff', pairs: 6000, a: { v54RiverBluff: true }, b: {} },
  // READ CALIBRATION (2026-11-07, HorseMind DecisionReadOptions): both
  // default OFF, so arm A turns each on. readPostflopFoldRate prices the
  // legacy exploit's bluffs with postflop fold-to-bet instead of folds over
  // every street (which read preflop tightness); readShrinkResponse shrinks
  // riverFoldRate / foldToCbetOf toward the family population rate. A
  // horse mirror misreads horses as folders on the all-street rate (68%
  // all-street, 52.5% postflop), so the mirror measures the first directly.
  { name: 'read_postflop_fold_rate', pairs: 6000, a: { readPostflopFoldRate: true }, b: {} },
  {
    name: 'plo4_read_postflop_fold_rate',
    variant: 'plo4',
    pairs: 6000,
    a: { readPostflopFoldRate: true },
    b: {},
  },
  { name: 'read_shrink_response', pairs: 24_000, a: { readShrinkResponse: true }, b: {} },
  // BREAK-EVEN BLUFFING (2026-11-08, read calibration follow-up; HorseMind
  // BREAK_EVEN_FOLD_CURVE): the postflop bluff multiplier re-derived from the
  // corrected postflop fold read against each bet size's break-even fold
  // share. Default OFF, so arm A turns it on. The mirror cards are the ones
  // readPostflopFoldRate lost (the read alone against the old 0.62 / 0.35
  // lines), at two, six and nine seats and in a tournament.
  { name: 'break_even_bluff', pairs: 6000, a: { readBreakEvenBluff: true }, b: {} },
  {
    name: 'plo4_break_even_bluff',
    variant: 'plo4',
    pairs: 6000,
    a: { readBreakEvenBluff: true },
    b: {},
  },
  // hu_break_even_bluff now reports through UNMEASURABLE_MATCHUPS (2026-11-12).
  {
    name: 'full_break_even_bluff',
    seats: 9,
    pairs: 12_000,
    a: { readBreakEvenBluff: true },
    b: {},
  },
  {
    name: 'mtt_break_even_bluff',
    context: bigBlindAnteMttContext(6, 40),
    stackBB: 40,
    pairs: 12_000,
    a: { readBreakEvenBluff: true },
    b: {},
  },
  {
    name: 'plo4_mtt_break_even_bluff',
    variant: 'plo4',
    context: bigBlindAnteMttContext(6, 40),
    stackBB: 40,
    // Rarely changes a decision (3 of 6,000 pairs): sized so a night
    // cannot come up inert by chance.
    pairs: 24_000,
    a: { readBreakEvenBluff: true },
    b: {},
  },
  // OMAHA EV FOLD MODEL (2026-11-08, Omaha threshold calibration; HorseMind
  // OMAHA_EV_FOLD_MODEL): the EV bet engine's fold multiplier in PLO4/5/6
  // is the game's measured fold share over MDF scaled by the opponent's
  // shrunk postflop fold read. Default ON; both arms are explicit, so arm A
  // is the model and arm B the old multiplier whatever the default.
  ...(['plo4', 'plo5', 'plo6'] as const).map((variant) => ({
    name: `${variant}_omaha_ev_fold`,
    variant,
    pairs: 6000,
    a: { omahaEvFoldModel: true },
    b: { omahaEvFoldModel: false },
  })),
  // OMAHA EV FOLD MODEL, HEADS-UP POT (2026-11-19, lane HU-OMAHA; HorseMind
  // OMAHA_EV_FOLD_MODEL_HEADS_UP, default OFF): a flop or turn EV bet into one
  // opponent is priced on the heads-up cell. Both arms carry production's live
  // Omaha set (the pooled model on), a adds the option.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_ev_fold_model_heads_up`,
    variant,
    pairs: 6000,
    productionStyles: true,
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaEvFoldModel: true, omahaEvFoldModelHeadsUp: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118, omahaEvFoldModel: true },
  })),
  // No tournament card: the model is cash only (tournament Omaha players fold
  // about MDF), so a tournament table is inert by construction (0 of 12,000
  // plo4 40bb tournament pairs diverged).
  // The calibrated-human twins of these cards (the same arms against
  // HUMAN_CALIBRATED_POPULATION_ID) were measured for the flag's evidence but
  // are not standing cards: the flag changes about one human-field pair in
  // 400, too rarely for the standing human-twin divergence check.
  // readScopedShrink (2026-11-08) has no card: a league table deals one game,
  // so the scoped and pooled buckets hold the same hands and the flag is
  // inert by construction (0 of 12,000 pairs diverged). Its effect is across
  // games, measured by the read calibration replay (HorseReadCalibration
  // scoped:* reads).
  {
    name: 'plo4_v54_river_bluff',
    variant: 'plo4',
    pairs: 6000,
    a: { v54RiverBluff: true },
    b: {},
  },
  {
    name: 'plo5_v54_river_bluff',
    variant: 'plo5',
    pairs: 6000,
    a: { v54RiverBluff: true },
    b: {},
  },
  {
    name: 'plo6_v54_river_bluff',
    variant: 'plo6',
    pairs: 6000,
    a: { v54RiverBluff: true },
    b: {},
  },
  { name: 'plo6_v40_omaha', variant: 'plo6', pairs: 6000, a: {}, b: { v40Omaha: false } },
  { name: 'plo4_v40_omaha', variant: 'plo4', pairs: 6000, a: {}, b: { v40Omaha: false } },
  // The whole opponent-intelligence layer vs playing blind. B-seats skip
  // both reads and writes; A-seats read a memory that includes B's actions.
  { name: 'mind_layer', a: {}, b: { mind: false } },
  {
    name: 'full_vs_v2_legacy',
    a: {},
    b: {
      v7: false,
      v8: false,
      v9: false,
      v10: false,
      v11: false,
      // V12.3: v12 was missing, so "vs v2 legacy" kept board-conditioned
      // sampling and the river polish and measured the wrong thing.
      // LeagueAblationCompleteness.test.ts now fails if a future layer
      // drifts out of this list the same way.
      v12: false,
      v15: false,
      v15Boats: false,
      v16Reads: false,
      v16Icm: false,
      v16Hu: false,
      v16Blockers: false,
      v16SizeCond: false,
      v16PloPolar: false,
      v17Pos: false,
      v17RiverProbe: false,
      v17CatchBlock: false,
      v17ShortDeck: false,
      v18Straddle: false,
      v18Squeeze: false,
      v18SelfImage: false,
      v18ExploitSize: false,
      v18Families: false,
      v20Multiway: false,
      v20Mzone: false,
      v21River: false,
      v21Deep: false,
      v23Endgame: false,
      v23Plan: false,
      v23Reads: false,
      v23Variants: false,
      v23ShortDeck: false,
      v23Spin: false,
      v24Bounty: false,
      v24PloDefense: false,
      v25PloTourney: false,
      v40Omaha: false,
      v41Leaks: false,
      v43Tempo: false,
      v46Charts: false,
      v46ShortDeck: false,
      v51RiverFlat: false,
      v55OmahaRiverTripsFlat: false,
      v52RangeAdvantage: false,
      v53Pressure: false,
      v54RiverBluff: false,
      mind: false,
      streetIQ: false,
      handReading: false,
    },
  },
];

/**
 * HUMAN-FIELD TWINS (2026-10-24). Every card above is a mirror: it says what a
 * layer is worth against other horses. Each name below gets a twin card,
 * `human_<name>`, with the SAME two arms, dealt to one hero horse against the
 * human-calibrated field (LeagueMatchup.opponentPopulation). The twin is
 * derived from the mirror card, so its arms cannot drift from it.
 *
 * Chosen by a divergence probe against the field (3,000 pairs, seed 20261024,
 * 2026-10-24; pairs whose two passes settled differently): full_vs_v2_legacy
 * 500, mind_layer 283, v7_preflop 282, v12_ranges_river 185, v11_leak_fixes 50,
 * v10_strategy 47, v20_multiway 8. Left off, because against this field the
 * flag almost never changes a hand and a nightly row would be noise or INERT:
 * v19_size_reads 11, v21_river_endgame 10, v16_sizecond 9, v51_river_flat 4,
 * v16_deep_reads 3, v52_range_advantage 2, v23_raise_plans 1, and 0 for
 * v23_river_reads, v18_squeeze_response and v18_exploit_size (the calibrated
 * field folds rivers inside the middle band, so the exploit read stays
 * neutral - the same reason the mirror cannot measure it). The mirror cards
 * for all of those stay on the card; re-probe before adding a twin.
 *
 * COST. A human-field pair asks HorseLogic for one seat instead of six:
 * measured at ~6 ms against ~19 ms for a mirror pair on the same box. At
 * HUMAN_FIELD_PAIRS = 12,000 a twin therefore costs about what one default
 * 4,000-pair mirror matchup does (~9 minutes in production), and its stderr is
 * ~1/sqrt(4) of the 3,000-pair probe's. The seven twins add roughly an hour of
 * worker time to a full rotation of a card that already spans more than one
 * day; nightly cost itself is unchanged, because it is bounded by the run
 * windows and MAX_RUN_MS, not by the card's length. The staleness-first order
 * runs the never-measured twins first, then they rotate like every other card.
 */
export const HUMAN_FIELD_PAIRS = 12_000;
export const HUMAN_FIELD_TWINS: readonly string[] = Object.freeze([
  'mind_layer',
  'v12_ranges_river',
  'v7_preflop',
  'v11_leak_fixes',
  'v10_strategy',
  'v20_multiway',
  'full_vs_v2_legacy',
]);

/** The human-field twin of a mirror card: same arms and dials, NLH six-max,
 *  one hero horse against the human-calibrated field. */
export function humanFieldTwin(mirror: LeagueMatchup): LeagueMatchup {
  if (mirror.opponentPopulation !== undefined) {
    throw new Error(`${mirror.name} is already a human-field card`);
  }
  if ((mirror.variant ?? 'nlh') !== 'nlh' || (mirror.seats ?? DEFAULT_SEATS) !== DEFAULT_SEATS) {
    throw new Error(`${mirror.name}: human-field twins are NLH six-max only`);
  }
  return {
    name: `${HUMAN_FIELD_NAME_PREFIX}${mirror.name}`,
    ...(mirror.stackBB !== undefined ? { stackBB: mirror.stackBB } : {}),
    ...(mirror.context !== undefined ? { context: mirror.context } : {}),
    pairs: HUMAN_FIELD_PAIRS,
    a: { ...mirror.a },
    b: { ...mirror.b },
    ...(mirror.modsA !== undefined ? { modsA: { ...mirror.modsA } } : {}),
    ...(mirror.modsB !== undefined ? { modsB: { ...mirror.modsB } } : {}),
    opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
  };
}

for (const name of HUMAN_FIELD_TWINS) {
  const mirror = LEAGUE_MATCHUPS.find((m) => m.name === name);
  if (!mirror) throw new Error(`HUMAN_FIELD_TWINS names ${name}, which is not on the card`);
  LEAGUE_MATCHUPS.push(humanFieldTwin(mirror));
}

/**
 * HEADS-UP HUMAN-FIELD CARD (2026-11-07). hu_bb_defends_to_price read
 * +0.37 +/- 0.31 bb/100 horse-vs-horse: unresolved, and against a small
 * blind that opens what horses open. The flag exists because a human who
 * opens every button wins the blinds, so it is measured here against that
 * human: the same two arms, heads-up 80bb, the hero on the live cash Hybrid
 * persona with the deal-seeded mood clock (as on the mirror), against the
 * hu_wide_sb_aggressor_v1 persona of the calibrated field. The dealer
 * rotates every pair, so the hero plays the small blind and the big blind
 * equally often. The flag stays default OFF until the nightly league
 * confirms it across runs on both cards.
 */
export const HUMAN_HU_BB_DEFENDS_TO_PRICE = `${HUMAN_FIELD_NAME_PREFIX}hu_bb_defends_to_price`;
/** The 40bb twin (HU-NLH-001, 2026-11-12): the band V85 leaves on the V11 bars. */
export const HUMAN_HU_BB_DEFENDS_TO_PRICE_40BB = `${HUMAN_FIELD_NAME_PREFIX}hu_bb_defends_to_price_40bb`;
/** The human-field twin of hu_commit_under_pot (HU-AUDIT-002, 2026-11-12). */
export const HUMAN_HU_COMMIT_UNDER_POT = `${HUMAN_FIELD_NAME_PREFIX}hu_commit_under_pot`;
for (const [mirrorName, twinName] of [
  ['hu_bb_defends_to_price', HUMAN_HU_BB_DEFENDS_TO_PRICE],
  ['hu_bb_defends_to_price_40bb', HUMAN_HU_BB_DEFENDS_TO_PRICE_40BB],
  ['hu_commit_under_pot', HUMAN_HU_COMMIT_UNDER_POT],
] as const) {
  const mirror = LEAGUE_MATCHUPS.find((m) => m.name === mirrorName);
  if (!mirror) throw new Error(`${mirrorName} left the card; its human twin has no mirror`);
  LEAGUE_MATCHUPS.push({
    name: twinName,
    seats: 2,
    stackBB: mirror.stackBB,
    pairs: HUMAN_FIELD_PAIRS,
    hybridBaseline: mirror.hybridBaseline,
    moodClock: mirror.moodClock,
    a: { ...mirror.a },
    b: { ...mirror.b },
    opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
    humanPersona: HU_WIDE_SB_AGGRESSOR_PERSONA,
  });
}

/** The human-field twin of mtt6_holdem_tournament_all_in_call_is_priced_12bb (2026-11-21). */
export const HUMAN_MTT6_HOLDEM_TOURNAMENT_ALL_IN_CALL_IS_PRICED_12BB = `${HUMAN_FIELD_NAME_PREFIX}mtt6_holdem_tournament_all_in_call_is_priced_12bb`;
{
  const mirror = LEAGUE_MATCHUPS.find(
    (m) => m.name === 'mtt6_holdem_tournament_all_in_call_is_priced_12bb'
  );
  if (!mirror) {
    throw new Error(
      'mtt6_holdem_tournament_all_in_call_is_priced_12bb left the card; its human twin has no mirror'
    );
  }
  LEAGUE_MATCHUPS.push({
    ...humanFieldTwin(mirror),
    hybridBaseline: mirror.hybridBaseline,
    moodClock: mirror.moodClock,
  });
}

/**
 * HUMAN-FIELD CASH CARDS FOR holdemValueAndCallsArePriced (2026-11-22).
 * 6-max and 9-max NLH 100bb cash human-calibrated twins (one live cash Hybrid
 * hero Horse with deal-seeded mood clock vs HUMAN_CALIBRATED_POPULATION_ID).
 */
export const HUMAN_NLH_HOLDEM_VALUE_AND_CALLS_ARE_PRICED = `${HUMAN_FIELD_NAME_PREFIX}nlh_holdem_value_and_calls_are_priced`;
export const HUMAN_NLH9_HOLDEM_VALUE_AND_CALLS_ARE_PRICED = `${HUMAN_FIELD_NAME_PREFIX}nlh9_holdem_value_and_calls_are_priced`;
for (const [mirrorName, twinName] of [
  ['nlh_holdem_value_and_calls_are_priced', HUMAN_NLH_HOLDEM_VALUE_AND_CALLS_ARE_PRICED],
  ['nlh9_holdem_value_and_calls_are_priced', HUMAN_NLH9_HOLDEM_VALUE_AND_CALLS_ARE_PRICED],
] as const) {
  const mirror = LEAGUE_MATCHUPS.find((m) => m.name === mirrorName);
  if (!mirror) throw new Error(`${mirrorName} left the card; its human twin has no mirror`);
  LEAGUE_MATCHUPS.push({
    name: twinName,
    variant: 'nlh',
    ...(mirror.seats !== undefined ? { seats: mirror.seats } : {}),
    ...(mirror.stackBB !== undefined ? { stackBB: mirror.stackBB } : {}),
    pairs: HUMAN_FIELD_PAIRS,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { ...mirror.a },
    b: { ...mirror.b },
    opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
  });
}

/**
 * THE HEADS-UP EXPLOITER CARDS (2026-11-12, HU-NLH-001). The live brain at
 * 40bb (the band V85 leaves on the V11 bars) against each exploiter persona.
 * They are not twins of a mirror card: no Horse plays these lines. Against an
 * opener the arms are huBbDefendsToPrice on and off. Against the limper the
 * flag never engages (no open to defend), so that card measures the V7
 * preflop layer against the legacy one, which is what answers a limp.
 */
export const HU_EXPLOITER_CARDS: readonly LeagueMatchup[] = Object.freeze(
  (
    [
      ['minraise', HU_MINRAISE_EVERY_BUTTON_PERSONA, { huBbDefendsToPrice: true }, {}],
      ['threebet', HU_THREE_BET_EVERY_HAND_PERSONA, { huBbDefendsToPrice: true }, {}],
      ['small_stab', HU_SMALL_STAB_EVERY_STREET_PERSONA, { huBbDefendsToPrice: true }, {}],
    ] as const
  )
    .map(
      ([short, persona, a, b]): LeagueMatchup => ({
        name: `${HUMAN_FIELD_NAME_PREFIX}hu_bb_defends_vs_${short}_40bb`,
        seats: 2,
        stackBB: 40,
        pairs: HUMAN_FIELD_PAIRS,
        hybridBaseline: true,
        moodClock: 'deal_seed',
        a: { ...a },
        b: { ...b },
        opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
        humanPersona: persona,
      })
    )
    .concat([
      {
        name: `${HUMAN_FIELD_NAME_PREFIX}hu_v7_preflop_vs_limper_40bb`,
        seats: 2,
        stackBB: 40,
        pairs: HUMAN_FIELD_PAIRS,
        hybridBaseline: true,
        moodClock: 'deal_seed',
        a: {},
        b: { v7Preflop: false },
        opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
        humanPersona: HU_LIMP_EVERY_BUTTON_PERSONA,
      },
    ])
);
LEAGUE_MATCHUPS.push(...HU_EXPLOITER_CARDS);

/**
 * THE READS-OFF HEADS-UP CARDS (2026-11-13, HU-EVAL-014). Every heads-up card
 * above plays one long session against one opponent with memory learning on,
 * so it measures the steady state, where the live brain has already read an
 * every-button min-raiser and the big blind folds 2.2% of the time; there
 * huBbDefendsToPrice changes almost nothing. The 58.7% fold the flag was
 * written for is the answer to an opponent the Horse has no read on: a new
 * opponent, the first hands. No card measured that case.
 *
 * These two do: the same arms, 40bb, the live cash Hybrid persona and the
 * deal-seeded mood clock, with memoryLearning 'off', so every opponent read
 * stays at its empty prior for the whole card (the full brain still plays).
 * One against the hu_minraise_every_button_v1 persona of the calibrated
 * field, one horse against horse. Exploratory local runs read about +16 to
 * +19 bb/100 against the min-raiser. The cards only measure: the flag stays
 * default OFF, and no other card's arms, seed or deals change. Their stored
 * config carries memoryLearning, so a row says its reads were off.
 */
export const HUMAN_HU_BB_DEFENDS_VS_MINRAISE_40BB_READS_OFF = `${HUMAN_FIELD_NAME_PREFIX}hu_bb_defends_vs_minraise_40bb_reads_off`;
export const HU_BB_DEFENDS_TO_PRICE_40BB_READS_OFF = 'hu_bb_defends_to_price_40bb_reads_off';
export const HU_READS_OFF_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: HUMAN_HU_BB_DEFENDS_VS_MINRAISE_40BB_READS_OFF,
    seats: 2,
    stackBB: 40,
    pairs: HUMAN_FIELD_PAIRS,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    memoryLearning: 'off',
    a: { huBbDefendsToPrice: true },
    b: {},
    opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
    humanPersona: HU_MINRAISE_EVERY_BUTTON_PERSONA,
  },
  {
    name: HU_BB_DEFENDS_TO_PRICE_40BB_READS_OFF,
    seats: 2,
    stackBB: 40,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    memoryLearning: 'off',
    a: { huBbDefendsToPrice: true },
    b: {},
  },
] satisfies LeagueMatchup[]);
LEAGUE_MATCHUPS.push(...HU_READS_OFF_CARDS);

/**
 * THE HEADS-UP DEFENCE CARDS (2026-11-14, HU-NLH-010 and HU-NLH-011). Two
 * default-OFF options, one card each, heads-up 40bb with the live cash Hybrid
 * persona and the deal-seeded mood clock, arm A the option on and arm B the
 * live default:
 *  - huOpenerDefendsToPrice against hu_wide_sb_aggressor_v1, the persona
 *    whose big blind 3-bets light but not every hand. Until 2026-11-15 this
 *    card faced hu_three_bet_every_hand_v1 and was INERT on the nightly (0 of
 *    12,000 pairs diverged on 2026-11-15, engine 54c9aac8): against a player
 *    who re-raises every open the engaged read already decides the opener's
 *    answer, so the option never changed one. That question is retired into
 *    UNMEASURABLE_MATCHUPS with its measurements; this card asks the one the
 *    option exists for, a 3-bettor inside the realistic band.
 *  - huLimpDefendsToPrice against hu_minraise_every_button_v1. No heads-up
 *    persona raises every limp; each raises a limp with the wide profile's
 *    top 35%, and this is the one whose raise is the minimum (to 2bb), the
 *    raise a limp-folder gives the most to. The others raise to 3.75bb and
 *    the horses to 3.5-4.5bb, where the price leaves almost nothing to call.
 * The cards only measure. Both options stay default OFF and neither is
 * proposed for activation: the owner's preflop range hold governs.
 */
export const HUMAN_HU_OPENER_DEFENDS_VS_WIDE_40BB = `${HUMAN_FIELD_NAME_PREFIX}hu_opener_defends_vs_wide_40bb`;
/** Retired 2026-11-15 (inert): see its UNMEASURABLE_MATCHUPS entry. */
export const HUMAN_HU_OPENER_DEFENDS_VS_THREEBET_40BB = `${HUMAN_FIELD_NAME_PREFIX}hu_opener_defends_vs_threebet_40bb`;
export const HUMAN_HU_LIMP_DEFENDS_VS_MINRAISE_40BB = `${HUMAN_FIELD_NAME_PREFIX}hu_limp_defends_vs_minraise_40bb`;
export const HU_DEFENCE_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: HUMAN_HU_OPENER_DEFENDS_VS_WIDE_40BB,
    seats: 2,
    stackBB: 40,
    pairs: HUMAN_FIELD_PAIRS,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { huOpenerDefendsToPrice: true },
    b: {},
    opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
    humanPersona: HU_WIDE_SB_AGGRESSOR_PERSONA,
  },
  {
    name: HUMAN_HU_LIMP_DEFENDS_VS_MINRAISE_40BB,
    seats: 2,
    stackBB: 40,
    pairs: HUMAN_FIELD_PAIRS,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { huLimpDefendsToPrice: true },
    b: {},
    opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
    humanPersona: HU_MINRAISE_EVERY_BUTTON_PERSONA,
  },
] satisfies LeagueMatchup[]);
LEAGUE_MATCHUPS.push(...HU_DEFENCE_CARDS);

/**
 * THE UNREAD BIG BLIND CARD (2026-11-15, HU-NLH-001d). huBbDefendsUnreadToPrice
 * (default OFF) acts only while the opener has no engaged read, so the card
 * that measures it keeps every read at its empty prior (memoryLearning 'off')
 * for the whole card: heads-up 40bb against the hu_minraise_every_button_v1
 * persona of the calibrated field (the near min-raise is the open heads-up
 * players make in production), the live cash Hybrid persona and the
 * deal-seeded mood clock, arm A the option on and arm B the live default.
 * The card only measures; the option stays default OFF.
 */
export const HUMAN_HU_BB_DEFENDS_UNREAD_VS_MINRAISE_40BB = `${HUMAN_FIELD_NAME_PREFIX}hu_bb_defends_unread_vs_minraise_40bb`;
export const HU_BB_UNREAD_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: HUMAN_HU_BB_DEFENDS_UNREAD_VS_MINRAISE_40BB,
    seats: 2,
    stackBB: 40,
    pairs: HUMAN_FIELD_PAIRS,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    memoryLearning: 'off',
    a: { huBbDefendsUnreadToPrice: true },
    b: {},
    opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
    humanPersona: HU_MINRAISE_EVERY_BUTTON_PERSONA,
  },
] satisfies LeagueMatchup[]);
LEAGUE_MATCHUPS.push(...HU_BB_UNREAD_CARDS);

/**
 * THE HEADS-UP STEAL CARD (2026-11-15, D6). huSmallBlindStealsVsTightBigBlind,
 * default OFF, heads-up 40bb with the live cash Hybrid persona and the
 * deal-seeded mood clock, arm A the option on and arm B the live default,
 * against hu_nit_big_blind_v1, the big blind that folds about 91% of the time:
 * the one opponent the option exists for. Memory learning on (the league
 * default): the steal needs the read. The card only measures; the option stays
 * default OFF and is not proposed for activation.
 */
export const HUMAN_HU_SB_STEALS_VS_NIT_40BB = `${HUMAN_FIELD_NAME_PREFIX}hu_sb_steals_vs_nit_40bb`;
export const HU_STEAL_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: HUMAN_HU_SB_STEALS_VS_NIT_40BB,
    seats: 2,
    stackBB: 40,
    pairs: HUMAN_FIELD_PAIRS,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { huSmallBlindStealsVsTightBigBlind: true },
    b: {},
    opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
    humanPersona: HU_NIT_BIG_BLIND_PERSONA,
  },
] satisfies LeagueMatchup[]);
LEAGUE_MATCHUPS.push(...HU_STEAL_CARDS);

/**
 * THE FIXED-LIMIT HOLD'EM CARDS (2026-11-20).
 *
 * Until this date playHand dealt every variant with no-limit or pot-limit
 * betting, so a fixed-limit card measured a game nobody plays and every one
 * was refused (UNMEASURABLE_MATCHUPS). playHand now deals fixed-limit hold'em
 * with the engine's own structure rules (LeagueDecisionState.ts: the street
 * unit, the four-wager cap and the controller's menu), and
 * HorseLeagueFixedLimit.test.ts replays league hands through a real
 * HandController to prove the nodes, menus, accepted actions and settlement
 * are the same. The domain is fixed-limit hold'em, cash, no ante, Horse seats
 * only, stacks above 24 big blinds (leagueFixedLimitRefusal).
 *
 * Every fixed-limit hold'em arm was re-measured on that legal game. The two
 * that change decisions in a Horse mirror leave the refused list for the
 * card, with the arms the refusals named, on the live cash Hybrid persona and
 * the deal-seeded mood clock. Measured 2026-11-20 as defined here (seed
 * 20261115, 300 pairs):
 *   flh_priced_preflop       30 of 300 pairs diverged, +1.11 +/- 1.24 bb/100
 *   flh_river_full_bet_read   9 of 300 pairs diverged, +1.33 +/- 1.15 bb/100
 * Neither figure is a result; they say the arms no longer play identical
 * poker. bb/100 is in big blinds, and a fixed-limit big blind is the SMALL
 * bet (half a big bet).
 *
 * The cards only measure. Both options stay default OFF and neither is
 * proposed for activation: fixedLimitPricedPreflop is under the owner's
 * preflop range hold, and fixedLimitRiverFullBetRead is an opt-in arm
 * production never sets. The other fixed-limit hold'em arms stay refused,
 * each with its own count on the legal game: a Horse mirror changes them in
 * none or almost none of the pairs.
 */
export const FIXED_LIMIT_HOLDEM_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: 'flh_priced_preflop',
    variant: 'flh',
    seats: 6,
    pairs: 2000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { fixedLimitPricedPreflop: true },
    b: {},
  },
  {
    name: 'flh_river_full_bet_read',
    variant: 'flh',
    seats: 2,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { fixedLimitRiverFullBetRead: true },
    b: {},
  },
] satisfies LeagueMatchup[]);
LEAGUE_MATCHUPS.push(...FIXED_LIMIT_HOLDEM_CARDS);

/**
 * THE FIXED-LIMIT OMAHA HI-LO CARDS (2026-11-21).
 *
 * playHand now deals fixed-limit Omaha hi-lo (flo8) with both the engine's
 * fixed-limit betting structure (LeagueDecisionState.ts: small bet preflop
 * and flop, big bet turn and river, four-wager street cap, controller menu)
 * and its hi-lo split showdown (settleLeagueShowdown -> determineWinners),
 * proven node by node against a real HandController in
 * HorseLeagueFixedLimit.test.ts. Domain: flo8 cash, no ante, Horse seats
 * only, stacks above 24 big blinds (leagueFixedLimitRefusal).
 *
 * Every flo8 arm was re-measured on that legal game (seed 20261115, 300 pairs,
 * EQUITY_GOVERNOR=off, 0 illegal / 0 truncated / 0 corrected / 0 fallbacks).
 * The three that change decisions in a Horse mirror leave UNMEASURABLE_MATCHUPS
 * for the card on the live cash Hybrid persona with the deal-seeded mood clock:
 *   flo8_no_omaha_presumption  59 of 300 pairs diverged, +11.42 +/- 4.07 bb/100
 *   flo8_priced_preflop        68 of 300 pairs diverged,  -0.44 +/- 1.88 bb/100
 *   flo8_river_full_bet_read    5 of 300 pairs diverged,  +0.33 +/- 1.20 bb/100
 * These cards only measure; every option stays default OFF. The remaining flo8
 * arms diverged in 0 of 300 pairs on the legal game and stay refused with
 * their exact counts in UNMEASURABLE_MATCHUPS.
 */
export const FIXED_LIMIT_OMAHA_HILO_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: 'flo8_no_omaha_presumption',
    variant: 'flo8',
    seats: 2,
    pairs: 2000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { fixedLimitOmahaNoPresumption: true },
    b: {},
  },
  {
    name: 'flo8_priced_preflop',
    variant: 'flo8',
    seats: 6,
    pairs: 2000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { fixedLimitPricedPreflop: true },
    b: {},
  },
  {
    name: 'flo8_river_full_bet_read',
    variant: 'flo8',
    seats: 2,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    a: { fixedLimitRiverFullBetRead: true },
    b: {},
  },
] satisfies LeagueMatchup[]);
LEAGUE_MATCHUPS.push(...FIXED_LIMIT_OMAHA_HILO_CARDS);

/**
 * THE SCRIPTED FIXED-LIMIT FIELD CARDS (2026-11-20, docs/horse-league-fixed-limit.md).
 *
 * One hero Horse (live cash Hybrid persona, deal-seeded mood clock) against
 * the scripted fixed-limit field in every other seat
 * (FIXED_LIMIT_SCRIPTED_POPULATION_ID, FixedLimitScriptedField.ts), arm A
 * with the option on, arm B off, on the same deals (runHumanFieldMatchup).
 * Each value card against the maniac has its harm control against the
 * tight-value player beside it, with the same arms and table size. The
 * fixedLimitReadIgnoresProbes pair first plays 300 no-limit hands into each
 * pass sandbox (LeagueMatchup.probeHistoryHands): without them the option is
 * inert by construction (measured: 0 of 1,000 pairs against the maniac).
 * Measured 2026-11-20 as defined here (seed 20261115):
 *   flh_call_is_not_a_commitment_vs_maniac        16 of 200 pairs diverged, -86.00 +/- 21.43 bb/100
 *   flh_call_is_not_a_commitment_vs_tight_value    1 of 3,000 pairs diverged, -1.28 +/- 1.28 bb/100
 *   flh_river_one_bet_value_raise_vs_maniac       15 of 3,000 pairs diverged, +1.00 +/- 0.55 bb/100
 *   flh_river_one_bet_value_raise_vs_tight_value   5 of 3,000 pairs diverged, +0.07 +/- 0.22 bb/100
 *   flh_read_ignores_probes_vs_maniac            333 of 1,000 pairs diverged, +163.00 +/- 72.36 bb/100
 *   flh_read_ignores_probes_vs_tight_value         0 of 3,000 pairs diverged
 * Added 2026-11-21, measured as defined here (seeds 20261120 and 20261121
 * together; docs/horse-league-fixed-limit.md):
 *   flh_river_one_bet_value_raise_vs_passive_caller    120 of 90,000 pairs diverged, +0.07 +/- 0.03 bb/100
 *   flh_steal_vs_tight_blinds_vs_over_folding_blinds   741 of 20,000 pairs diverged, +6.84 +/- 0.28 bb/100
 * The over-folding blinds are the steal's single most favourable range (they
 * fold to every postflop wager, a design value), so that card is a
 * favourable-range measurement with no harm control beside it yet.
 * Probes, not results. A harm control that changes almost nothing is the
 * expected reading (the lane recorded its tight-value cells at +0.00 to
 * +0.11 big bets per 100 hands, docs/horse-default-on.d/
 * fixedLimitCallIsNotACommitment.md) and may read inert on a night: that
 * says the arms played identical poker against a value-only field, which is
 * the harm question answered, not a harness defect.
 *
 * The cards only measure. Every option stays default OFF; nothing here
 * switches one on. bb/100 is in big blinds (a fixed-limit big blind is the
 * small bet).
 */
function fixedLimitScriptedCard(
  name: string,
  seats: number,
  pairs: number,
  humanPersona: FixedLimitScriptedPersona,
  a: HorseDecideOpts,
  probeHistoryHands?: number,
  /** 2026-11-21: arm B's options (default {}), for a card that measures one option on top of another. */
  b: HorseDecideOpts = {}
): LeagueMatchup {
  return {
    name,
    variant: 'flh',
    seats,
    pairs,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
    humanPersona,
    a,
    b,
    ...(probeHistoryHands ? { probeHistoryHands } : {}),
  };
}
/** No-limit hands each pass sandbox plays before a probe-read card's pairs. */
export const FIXED_LIMIT_PROBE_HISTORY_HANDS = 300;
export const FIXED_LIMIT_SCRIPTED_FIELD_CARDS: readonly LeagueMatchup[] = Object.freeze([
  fixedLimitScriptedCard('flh_call_is_not_a_commitment_vs_maniac', 6, 2000, FLH_MANIAC_PERSONA, {
    fixedLimitCallIsNotACommitment: true,
  }),
  fixedLimitScriptedCard(
    'flh_call_is_not_a_commitment_vs_tight_value',
    6,
    3000,
    FLH_TIGHT_VALUE_PERSONA,
    {
      fixedLimitCallIsNotACommitment: true,
    }
  ),
  fixedLimitScriptedCard('flh_river_one_bet_value_raise_vs_maniac', 2, 3000, FLH_MANIAC_PERSONA, {
    fixedLimitRiverOneBetValueRaise: true,
  }),
  fixedLimitScriptedCard(
    'flh_river_one_bet_value_raise_vs_tight_value',
    2,
    3000,
    FLH_TIGHT_VALUE_PERSONA,
    {
      fixedLimitRiverOneBetValueRaise: true,
    }
  ),
  fixedLimitScriptedCard(
    'flh_read_ignores_probes_vs_maniac',
    6,
    1000,
    FLH_MANIAC_PERSONA,
    { fixedLimitReadIgnoresProbes: true },
    FIXED_LIMIT_PROBE_HISTORY_HANDS
  ),
  fixedLimitScriptedCard(
    'flh_read_ignores_probes_vs_tight_value',
    6,
    3000,
    FLH_TIGHT_VALUE_PERSONA,
    { fixedLimitReadIgnoresProbes: true },
    FIXED_LIMIT_PROBE_HISTORY_HANDS
  ),
  // 2026-11-21: the passive caller (a third river-betting range for the one-bet value raise) and the
  // over-folding blinds (the steal). A passive-caller card for fixedLimitRiverStrongHandLeads was measured and is
  // not kept: 1 of 20,000 pairs diverged (UNMEASURABLE_MATCHUPS, flh_river_strong_hand_leads).
  fixedLimitScriptedCard(
    'flh_river_one_bet_value_raise_vs_passive_caller',
    2,
    3000,
    FLH_PASSIVE_CALLER_PERSONA,
    { fixedLimitRiverOneBetValueRaise: true }
  ),
  fixedLimitScriptedCard(
    'flh_steal_vs_tight_blinds_vs_over_folding_blinds',
    6,
    3000,
    FLH_OVER_FOLDING_BLINDS_PERSONA,
    { fixedLimitStealVsTightBlinds: true }
  ),
  // 2026-11-21: the steal's harm control with blinds that defend preflop and fold postflop. The value-only
  // blinds (flh_value_only_blinds_v1) were measured and are not kept on the card: 2 of 20,000 pairs diverged at
  // each of seeds 20261120 and 20261121 (UNMEASURABLE_MATCHUPS, flh_steal_vs_tight_blinds).
  fixedLimitScriptedCard(
    'flh_steal_vs_tight_blinds_vs_preflop_defending_blinds',
    6,
    3000,
    FLH_PREFLOP_DEFENDING_BLINDS_PERSONA,
    { fixedLimitStealVsTightBlinds: true }
  ),
  // 2026-11-21: the steal's harm control with blinds that defend preflop AND continue postflop
  // with top pair or better (value-betting/raising two pair+, calling one wager with top pair/overpair).
  fixedLimitScriptedCard(
    'flh_steal_vs_tight_blinds_vs_defending_postflop_blinds',
    6,
    3000,
    FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA,
    { fixedLimitStealVsTightBlinds: true }
  ),
  // 2026-11-21 STYLE SHIFT RELEASE IS NOISE-AWARE (styleShiftReleaseIsNoiseAware, default OFF, a process switch:
  // human-field cards only, withLeagueProcessSwitches). The steal is on in BOTH arms; a adds the noise-aware
  // release. The value-only blinds raise some first-in hands and fold every other (a mixed preflop frequency) and
  // fold one pair to a postflop wager: the over-folder whose fold sample the 2026-11-06 release drains, which is
  // why the steal alone diverged on 2 of 20,000 pairs against them (docs/horse-league-fixed-limit.md).
  fixedLimitScriptedCard(
    'flh_style_release_noise_aware_steal_vs_value_only_blinds',
    6,
    3000,
    FLH_VALUE_ONLY_BLINDS_PERSONA,
    { fixedLimitStealVsTightBlinds: true, styleShiftReleaseIsNoiseAware: true },
    undefined,
    { fixedLimitStealVsTightBlinds: true }
  ),
]);
LEAGUE_MATCHUPS.push(...FIXED_LIMIT_SCRIPTED_FIELD_CARDS);

/**
 * STYLE SHIFT RELEASE IS NOISE-AWARE on the calibrated no-limit hold'em field (2026-11-21): six seats, the hero on
 * the live cash Hybrid persona with the deal-seeded mood clock, a with the noise-aware release, b the 2026-11-06
 * rule. Every opponent read the brain takes from the decayed exploit counters is in play; the calibrated field's
 * frequencies are mixed, which is what trips the 2026-11-06 rule. A human-field card (the switch is per sandbox).
 */
LEAGUE_MATCHUPS.push({
  name: 'human_nlh_style_release_noise_aware',
  variant: 'nlh',
  seats: 6,
  pairs: HUMAN_FIELD_PAIRS,
  hybridBaseline: true,
  moodClock: 'deal_seed',
  a: { styleShiftReleaseIsNoiseAware: true },
  b: {},
  opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
});

/**
 * HORSE RIVER NO BLOCKER BET on the calibrated no-limit hold'em field (2026-11-22): six seats, the hero on the
 * live cash Hybrid persona with the deal-seeded mood clock, a with horseRiverNoBlockerBet on, b off. Human-field
 * twin of nlh_horse_river_no_blocker_bet (the mirror uses productionStyles; balanced alone is near-inert on
 * sub-25% NLH river bets, while the live Hybrid persona reaches them).
 */
LEAGUE_MATCHUPS.push({
  name: 'human_nlh_horse_river_no_blocker_bet',
  variant: 'nlh',
  seats: 6,
  pairs: HUMAN_FIELD_PAIRS,
  hybridBaseline: true,
  moodClock: 'deal_seed',
  a: { horseRiverNoBlockerBet: true },
  b: {},
  opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
});

/**
 * THE SCRIPTED FIXED-LIMIT OMAHA HI-LO FIELD CARDS (2026-11-21,
 * Flo8ScriptedField.ts).
 *
 * One hero Horse (live cash Hybrid persona, deal-seeded mood clock) against
 * scripted fixed-limit Omaha hi-lo seats (FLO8_SCRIPTED_POPULATION_ID), three
 * opponent fields per option (favourable, high-heat / station stress, and
 * tight-value harm control) covering fixedLimitHiLoLowHalfFloor,
 * fixedLimitHiLoNutLowRiverBet, and fixedLimitOmahaNoPresumption. The cards
 * only measure; every option stays default OFF.
 */
function flo8ScriptedCard(
  name: string,
  seats: number,
  pairs: number,
  humanPersona: Flo8ScriptedPersona,
  a: HorseDecideOpts
): LeagueMatchup {
  return {
    name,
    variant: 'flo8',
    seats,
    pairs,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: FLO8_SCRIPTED_POPULATION_ID,
    humanPersona,
    a,
    b: {},
  };
}
export const FLO8_SCRIPTED_FIELD_CARDS: readonly LeagueMatchup[] = Object.freeze([
  // F3: fixedLimitHiLoLowHalfFloor (6-max: high-barreler, maniac, tight-value harm control)
  flo8ScriptedCard(
    'flo8_hilo_low_half_floor_vs_high_barreler',
    6,
    3000,
    FLO8_HIGH_BARRELER_PERSONA,
    { fixedLimitHiLoLowHalfFloor: true }
  ),
  flo8ScriptedCard('flo8_hilo_low_half_floor_vs_maniac', 6, 3000, FLO8_MANIAC_PERSONA, {
    fixedLimitHiLoLowHalfFloor: true,
  }),
  flo8ScriptedCard('flo8_hilo_low_half_floor_vs_tight_value', 6, 3000, FLO8_TIGHT_VALUE_PERSONA, {
    fixedLimitHiLoLowHalfFloor: true,
  }),
  // SPEC-FL-02: fixedLimitHiLoNutLowRiverBet (HU: river-folder, passive-caller station stress, tight-value)
  flo8ScriptedCard('flo8_nut_low_river_bet_vs_river_folder', 2, 3000, FLO8_RIVER_FOLDER_PERSONA, {
    fixedLimitHiLoNutLowRiverBet: true,
  }),
  flo8ScriptedCard(
    'flo8_nut_low_river_bet_vs_passive_caller',
    2,
    3000,
    FLO8_PASSIVE_CALLER_PERSONA,
    { fixedLimitHiLoNutLowRiverBet: true }
  ),
  flo8ScriptedCard('flo8_nut_low_river_bet_vs_tight_value', 2, 3000, FLO8_TIGHT_VALUE_PERSONA, {
    fixedLimitHiLoNutLowRiverBet: true,
  }),
  // T1: fixedLimitOmahaNoPresumption (6-max: tight-value, high-barreler, maniac harm control)
  flo8ScriptedCard('flo8_no_omaha_presumption_vs_tight_value', 6, 3000, FLO8_TIGHT_VALUE_PERSONA, {
    fixedLimitOmahaNoPresumption: true,
  }),
  flo8ScriptedCard(
    'flo8_no_omaha_presumption_vs_high_barreler',
    6,
    3000,
    FLO8_HIGH_BARRELER_PERSONA,
    { fixedLimitOmahaNoPresumption: true }
  ),
  flo8ScriptedCard('flo8_no_omaha_presumption_vs_maniac', 6, 3000, FLO8_MANIAC_PERSONA, {
    fixedLimitOmahaNoPresumption: true,
  }),
]);
LEAGUE_MATCHUPS.push(...FLO8_SCRIPTED_FIELD_CARDS);

/**
 * THE SCRIPTED NO-LIMIT FIELD CARDS (2026-11-21, Hold'em Strategy lane;
 * NlhScriptedField.ts).
 *
 * One hero Horse (live cash Hybrid persona, deal-seeded mood clock) heads-up
 * against one scripted no-limit player (NLH_SCRIPTED_POPULATION_ID),
 * arm A with the option on, arm B off, on the same deals
 * (runHumanFieldMatchup). Each value card has its harm control beside it, with
 * the same arms and table. Heads-up because both options act heads-up only.
 * The committed-spot cards are dealt 40bb deep (NLH_SCRIPTED_COMMITTED_STACK_BB),
 * where two pot-sized bets commit a Horse; the danger-board cards 100bb.
 * Each card declares 6,000 pairs (the nightly size of the mirror cards it
 * complements). The measurement runs were dealt at 60,000 pairs per seed, a
 * size declared from a 3,000-pair probe on seed 20261115 before seeds 20261120
 * and 20261121 were dealt (docs/changelog/2026-11-21-holdem-scripted-no-limit-field.md);
 * results are in the two authority files. The cards only measure. Both options
 * stay default OFF; nothing here switches one on.
 */
function nlhScriptedCard(
  name: string,
  pairs: number,
  humanPersona: NlhScriptedPersona,
  a: HorseDecideOpts,
  stackBB?: number
): LeagueMatchup {
  return {
    name,
    variant: 'nlh',
    seats: 2,
    ...(stackBB ? { stackBB } : {}),
    pairs,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
    humanPersona,
    a,
    b: {},
  };
}
export const NLH_SCRIPTED_FIELD_CARDS: readonly LeagueMatchup[] = Object.freeze([
  nlhScriptedCard(
    'nlh_committed_no_pair_is_priced_vs_pot_barreler',
    6000,
    NLH_POT_BARRELER_PERSONA,
    {
      holdemCommittedNoPairIsPriced: true,
    },
    NLH_SCRIPTED_COMMITTED_STACK_BB
  ),
  nlhScriptedCard(
    'nlh_committed_no_pair_is_priced_vs_value_barreler',
    6000,
    NLH_VALUE_BARRELER_PERSONA,
    {
      holdemCommittedNoPairIsPriced: true,
    },
    NLH_SCRIPTED_COMMITTED_STACK_BB
  ),
  nlhScriptedCard(
    'nlh_danger_board_equity_is_priced_vs_danger_bettor',
    6000,
    NLH_DANGER_BOARD_BETTOR_PERSONA,
    { holdemDangerBoardEquityIsPriced: true }
  ),
  nlhScriptedCard(
    'nlh_danger_board_equity_is_priced_vs_danger_value',
    6000,
    NLH_DANGER_BOARD_VALUE_PERSONA,
    { holdemDangerBoardEquityIsPriced: true }
  ),
]);
LEAGUE_MATCHUPS.push(...NLH_SCRIPTED_FIELD_CARDS);

/**
 * THE SCRIPTED OPEN-JAMMER FIELD CARDS (2026-11-21, nashCallVsJam;
 * NlhScriptedField.ts).
 *
 * nashCallVsJam is default ON in source (a = default on, b = { nashCallVsJam:
 * false }, same arms as mtt6_nash_call_vs_jam_12bb). The human-calibrated
 * field sizes every raise and never open-jams, so it had 0 divergent pairs.
 * These six-max cards seat one hero Horse (live Hybrid persona, deal-seeded
 * mood clock) against five scripted short-stack (<=20bb) open-jammers:
 *  - nlh_scripted_nash_open_jammer_cash_12bb: 12bb cash (no ante) vs Nash
 *    equilibrium open-jammer;
 *  - nlh_scripted_nash_open_jammer_12bb: 12bb MTT (1bb BBA) vs Nash
 *    equilibrium open-jammer;
 *  - nlh_scripted_nash_open_jammer_15bb: 15bb MTT (1bb BBA) vs Nash
 *    equilibrium open-jammer;
 *  - nlh_scripted_tight_jammer_15bb: 15bb MTT (1bb BBA) harm control vs
 *    tight/nut-only open-jammer (top ~9% hands only).
 */
export const NLH_SCRIPTED_OPEN_JAMMER_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: 'nlh_scripted_nash_open_jammer_cash_12bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 12,
    context: CASH_LEAGUE_CONTEXT,
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
    humanPersona: NLH_NASH_OPEN_JAMMER_PERSONA,
    a: {},
    b: { nashCallVsJam: false },
  },
  {
    name: 'nlh_scripted_nash_open_jammer_12bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 12,
    context: bigBlindAnteMttContext(6, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
    humanPersona: NLH_NASH_OPEN_JAMMER_PERSONA,
    a: {},
    b: { nashCallVsJam: false },
  },
  {
    name: 'nlh_scripted_nash_open_jammer_15bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 15,
    context: bigBlindAnteMttContext(6, 15),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
    humanPersona: NLH_NASH_OPEN_JAMMER_PERSONA,
    a: {},
    b: { nashCallVsJam: false },
  },
  {
    name: 'nlh_scripted_tight_jammer_15bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 15,
    context: bigBlindAnteMttContext(6, 15),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
    humanPersona: NLH_TIGHT_JAMMER_PERSONA,
    a: {},
    b: { nashCallVsJam: false },
  },
]);
LEAGUE_MATCHUPS.push(...NLH_SCRIPTED_OPEN_JAMMER_CARDS);

/**
 * NASH CALL VS TIGHT JAMMER RESPECT CARDS (2026-11-21, default OFF prototype).
 *
 * Isolates nashCallVsTightJammerRespect (arm A: true, arm B: unset/false, both
 * with default-ON nashCallVsJam) against the 15bb tight/nut-only open-jammer
 * harm control and against the 12bb/15bb realistic Nash open-jammer fields.
 */
export const NLH_SCRIPTED_TIGHT_JAMMER_RESPECT_CARDS: readonly LeagueMatchup[] = Object.freeze([
  {
    name: 'nlh_nash_call_vs_tight_jammer_respect_vs_tight_15bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 15,
    context: bigBlindAnteMttContext(6, 15),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
    humanPersona: NLH_TIGHT_JAMMER_PERSONA,
    a: { nashCallVsTightJammerRespect: true },
    b: {},
  },
  {
    name: 'nlh_nash_call_vs_tight_jammer_respect_vs_nash_12bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 12,
    context: bigBlindAnteMttContext(6, 12),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
    humanPersona: NLH_NASH_OPEN_JAMMER_PERSONA,
    a: { nashCallVsTightJammerRespect: true },
    b: {},
  },
  {
    name: 'nlh_nash_call_vs_tight_jammer_respect_vs_nash_15bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 15,
    context: bigBlindAnteMttContext(6, 15),
    pairs: 6000,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
    humanPersona: NLH_NASH_OPEN_JAMMER_PERSONA,
    a: { nashCallVsTightJammerRespect: true },
    b: {},
  },
]);
LEAGUE_MATCHUPS.push(...NLH_SCRIPTED_TIGHT_JAMMER_RESPECT_CARDS);

/**
 * THE SCRIPTED PLO8 HEADS-UP FIELD CARDS (2026-11-21, Heads Up lane).
 *
 * Non-mirror short-stack (12bb) PLO8 final-table heads-up cards for
 * omahaHiLoTournamentFirstIn (HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID covers
 * plo4/plo5/plo6 only). Each card seats one hero Horse (tournament Hybrid
 * persona, deal-seeded mood clock) heads-up against one scripted PLO8 opponent
 * (PLO8_HU_SCRIPTED_POPULATION_ID, Plo8HuScriptedField.ts):
 *  - plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller: loose
 *    short-stack recreational caller/defender.
 *  - plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind: tight
 *    short-stack blind (harm control for 75% BB defence + steal test for 100%
 *    SB pot open).
 *  - plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor:
 *    aggressive short-stack 3-betting / jamming blind defender (harm control
 *    that punishes wide first-in SB opens and pressures BB defence).
 * The cards only measure; omahaHiLoTournamentFirstIn stays default OFF.
 */
function plo8HuScriptedCard(
  name: string,
  pairs: number,
  humanPersona: Plo8HuScriptedPersona,
  a: HorseDecideOpts
): LeagueMatchup {
  return {
    name,
    variant: 'plo8',
    seats: 2,
    stackBB: PLO8_HU_SCRIPTED_STACK_BB,
    context: finalTableMttContext(2, PLO8_HU_SCRIPTED_STACK_BB),
    pairs,
    hybridBaseline: true,
    moodClock: 'deal_seed',
    opponentPopulation: PLO8_HU_SCRIPTED_POPULATION_ID,
    humanPersona,
    a,
    b: {},
  };
}
export const PLO8_HU_SCRIPTED_FIELD_CARDS: readonly LeagueMatchup[] = Object.freeze([
  plo8HuScriptedCard(
    'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller',
    6000,
    PLO8_HU_REC_CALLER_PERSONA,
    { omahaHiLoTournamentFirstIn: true }
  ),
  plo8HuScriptedCard(
    'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind',
    6000,
    PLO8_HU_TIGHT_BLIND_PERSONA,
    { omahaHiLoTournamentFirstIn: true }
  ),
  plo8HuScriptedCard(
    'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor',
    6000,
    PLO8_HU_AGGRO_3BETTOR_PERSONA,
    { omahaHiLoTournamentFirstIn: true }
  ),
]);
LEAGUE_MATCHUPS.push(...PLO8_HU_SCRIPTED_FIELD_CARDS);

/**
 * Why a fixed-limit arm is still refused (2026-11-20). Hold'em: the league
 * deals the legal game and the count is the arm's own count on it. Hi-lo: the
 * league still has no hand to deal.
 */
const FIXED_LIMIT_FIELD_DESIGN = 'docs/horse-league-fixed-limit.md';
function fixedLimitHoldemRefusal(o: {
  /** What the option acts on, in the words of its own gate. */
  gate: string;
  /** Pairs that diverged of 300 on the legal game (seed 20261115, the arms as listed). */
  diverged: number;
  /** Further measurements and what the Horse mirror lacks. */
  why: string;
  /** The field that would make it a card. */
  needs: string;
  /** The law whose fixtures are the evidence until then. */
  law: string;
}): string {
  return (
    "Refused, though the league deals this game: since 2026-11-20 playHand deals legal fixed-limit hold'em " +
    '(the street unit, the four-wager cap and the controller menu, LeagueDecisionState.ts; proven against a ' +
    'real HandController by HorseLeagueFixedLimit.test.ts), Horse seats only, cash, stacks above 24 big blinds. ' +
    `${o.gate} The option is DEFAULT OFF (read as === true). ` +
    'Measured 2026-11-20 on that legal game by running this refused matchup through runMatchup ' +
    `(seed 20261115, 300 pairs): ${o.diverged} of 300 pairs diverged. ${o.why} ` +
    'A card that changes no decision, or one in hundreds of pairs, reads inert on most nights and measures nothing. ' +
    `What would change this: ${o.needs} seated on the league's fixed-limit hold'em hand ` +
    `(${FIXED_LIMIT_FIELD_DESIGN} states the field, its invariants and its tests); until it is built, the fixtures in ` +
    `${o.law}.law.test.ts and the Fixed-Limit lane diagnostic-harness measurements are the only evidence.`
  );
}
function fixedLimitHiLoRefusal(o: {
  gate: string;
  /** Pairs that diverged of 300 on 2026-11-21 (seed 20261115) on the legal fixed-limit flo8 game. */
  diverged: number;
  why: string;
  needs: string;
  law: string;
}): string {
  return (
    'Refused, though the league deals this game: since 2026-11-21 playHand deals legal fixed-limit Omaha hi-lo ' +
    '(the street unit, the four-wager cap and the controller menu, LeagueDecisionState.ts, and hi-lo split ' +
    "settlement through the engine's determineWinners, settleLeagueShowdown; proven against a real " +
    'HandController by HorseLeagueFixedLimit.test.ts), Horse seats only, cash, stacks above 24 big blinds. ' +
    `${o.gate} The option is DEFAULT OFF (read as === true). ` +
    'Measured 2026-11-21 on that legal game by running this refused matchup through runMatchup ' +
    `(seed 20261115, 300 pairs, EQUITY_GOVERNOR=off): ${o.diverged} of 300 pairs diverged. ${o.why} ` +
    'A card that changes no decision, or one in hundreds of pairs, reads inert on most nights and measures nothing. ' +
    `What would change this: ${o.needs} seated on the league's fixed-limit Omaha hi-lo hand ` +
    `(${FIXED_LIMIT_FIELD_DESIGN} states the domain, invariants and tests); until it is built, the fixtures in ` +
    `${o.law}.law.test.ts and the Fixed-Limit lane diagnostic-harness measurements are the only evidence.`
  );
}

/**
 * UNMEASURABLE MATCHUPS (2026-10-31). A matchup the league deliberately does
 * not deal, with the reason. Every run writes one `status = 'refused'` row per
 * entry (hands = 0) BEFORE the first hand, so the daily audit reads the
 * judgement where it reads every measurement (fn_audit_nightly_job_health:
 * league_matchup_refused, and league_refusal_went_silent if a row stops
 * arriving). Retire a matchup by MOVING it here, never by deleting or
 * commenting it out: a matchup with no row is invisible to every detector,
 * which is how v16_ratio_rescale, v18_exploit_size and v31_gto_suit_aware
 * went 34 nights with one hand-written refusal row (2026-09-27) and the audit
 * reported v16_ratio_rescale as "not on the card, default rule unevaluable".
 *
 * The arms are the ones the matchup would deal, so the refused row carries
 * the exact question that cannot be answered. `reason` says why, when it was
 * last measured, the divergence probes, and what would change the verdict.
 */
export interface UnmeasurableMatchup extends Pick<
  LeagueMatchup,
  'name' | 'variant' | 'seats' | 'stackBB' | 'a' | 'b'
> {
  reason: string;
}

export const UNMEASURABLE_MATCHUPS: readonly UnmeasurableMatchup[] = Object.freeze([
  // 2026-11-19 (EMERG lane PACK): omahaPackEffectiveDepth and
  // omahaPackClampDeepDepth, default off. Refused, not dealt: they move only
  // the depth the PLO4/PLO5 pack gates read, and league stacks never reach it.
  ...(
    [
      ['omahaPackEffectiveDepth', 'effective_depth'],
      ['omahaPackClampDeepDepth', 'clamp_deep_depth'],
    ] as const
  ).flatMap(([option, tag]) =>
    (['plo4', 'plo5'] as const).map((variant) => ({
      name: `${variant}_omaha_pack_${tag}`,
      variant,
      seats: 6,
      a: { [option]: true },
      b: {},
      reason:
        'Unanswerable by this league: the option changes only the depth at which the Omaha strategy pack ' +
        '(Phase 10 PLO4, Phase 11 PLO5) admits a decision (omaha/OmahaPackDepth.ts); league stacks sit inside ' +
        'the pack band (at most 250 bb) with one depth for every seat, so the gate never refuses a league ' +
        'decision and the two arms play the same hands. The pack itself deviates from the reference only ' +
        'heads-up at a two-seat table (plo4ReferenceDeviation). Measured instead on the 48-hour production ' +
        'dataset (EMERG/PACK.md, 2026-11-19); in this league 0 of 0 pairs were dealt for it (not run: no seat can reach the gate). The option is DEFAULT OFF (read as === true). What would change ' +
        'this: league stacks above 250 bb, or different stacks per seat.',
    }))
  ),
  // 2026-11-21 (PLO-OWNER lane RELEASE-13, list train): omahaOpponentLifetimeHud,
  // default off. Refused, not dealt: league opponents have no stored lifetime history.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_opponent_lifetime_hud`,
    variant,
    seats: 6,
    a: { omahaOpponentLifetimeHud: true },
    b: {},
    reason:
      "Unanswerable by this league: the option only builds and serves each opponent's lifetime public profile " +
      'from production hand history (engine/opponentHud/), and league opponents have no stored history, so both ' +
      'arms read nothing and play the same hands; the provider by itself changes no decision ' +
      '(TheLifetimeHudConsumerIsTheOnlyDecisionReader.law). Measured instead on the learning bench with SPARRING_HUD=1 and ' +
      'seeded priors (OPPONENT-HUD criteria, EMERG); in this league 0 of 0 pairs were dealt for it (not run: no ' +
      'seat has a lifetime history). The option is DEFAULT OFF (read as === true). What would ' +
      'change this: a league that seeds each opponent with a lifetime history.',
  })),
  // 2026-11-21 (PLO-OWNER lane OPPONENT-HUD-9): omahaOpponentLifetimeHudDecides (the consumer),
  // default off. Refused, not dealt: league opponents have no stored lifetime history.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_opponent_lifetime_hud_decides`,
    variant,
    seats: 6,
    a: { omahaOpponentLifetimeHud: true, omahaOpponentLifetimeHudDecides: true },
    b: {},
    reason:
      "Unanswerable by this league: the option reads each opponent's lifetime public profile, which the store builds " +
      'from production hand history (engine/opponentHud/), and league opponents have no stored history, so both ' +
      'arms read nothing and play the same hands. Measured instead on the learning bench with SPARRING_HUD=1 and ' +
      'seeded priors (OPPONENT-HUD criteria, EMERG); in this league 0 of 0 pairs were dealt for it (not run: no ' +
      'seat has a lifetime history). The option is DEFAULT OFF (read as === true). What would ' +
      'change this: a league that seeds each opponent with a lifetime history.',
  })),
  // 2026-11-21 (PLO-OWNER lane B4): omahaPreflopReadIsPricedFromLifetime, default off.
  // Refused, not dealt: requires seeded lifetime HUD profiles, which league opponents do not have.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_preflop_read_is_priced_from_lifetime`,
    variant,
    seats: 6,
    a: {
      omahaOpponentLifetimeHud: true,
      omahaOpponentLifetimeHudDecides: true,
      omahaPreflopReadIsPricedFromLifetime: true,
    },
    b: { omahaOpponentLifetimeHud: true, omahaOpponentLifetimeHudDecides: true },
    reason:
      'Unanswerable by this league: the option prices 3-to-6-handed Omaha preflop reads directly from each ' +
      "opponent's lifetime public HUD profile (engine/opponentHud/), and league opponents have no stored lifetime " +
      'history, so both arms see an absent HUD packet and play the same hands. Measured instead on the learning ' +
      'bench with SPARRING_HUD=1 and seeded priors (CRITERIA-HUD-B4-V3-SIXMAX-PREFLOP, V303 PASS); in this league ' +
      '0 of 0 pairs were dealt for it (not run: no seat has a lifetime history). The option is DEFAULT OFF ' +
      '(read as === true). Measured 2026-11-27 by running this refused matchup through runMatchup (seed ' +
      '20261127, 300 pairs): 0 of 300 pairs diverged. What would change this: a league that seeds each opponent with a lifetime history.',
  })),
  // 2026-11-15 (PLO Strategy, owner 12:16): horseActionTimeIsPublicOnly,
  // default off. Refused, not dealt: this league has no clock.
  {
    name: 'nlh_horse_action_time_is_public_only',
    variant: 'nlh',
    seats: 6,
    a: { horseActionTimeIsPublicOnly: true },
    b: {},
    reason:
      'Unanswerable by this league: the option changes only the think time attached to a decision ' +
      '(horsePublicActionTime), never the action or the amount, and playHand has no clock and no opponent ' +
      'that reads a delay, so the two arms win and lose the same chips. The option is DEFAULT OFF (read as === true). ' +
      'Measured 2026-11-15 by running this refused matchup through runMatchup (seed 20261115, 300 pairs): ' +
      '0 of 300 pairs diverged (inert, as the structure says). The think-time claim itself rests on the source ' +
      'law and the property test (200 private hands on three public states give one think-time distribution). ' +
      'What would change this: a league opponent that conditions its play on the recorded think time.',
  },
  // 2026-11-16 (PLO6 lane): omahaStrategyInPlo6, default off and off-only.
  // Refused, not dealt: alone the gate switches no option on, and the port
  // it would open is not finished.
  {
    name: 'plo6_omaha_strategy_in_plo6',
    variant: 'plo6',
    seats: 6,
    a: { omahaStrategyInPlo6: true },
    b: {},
    reason:
      'Unanswerable as a one-option card: omahaStrategyInPlo6 is a game gate, not a rule. On, it lets each ' +
      'PLO4/PLO5 strategy option of 2026-11-15 that is itself on also act in PLO6 (omahaStrategyGameInScope) ' +
      'and registers the six-card constants for that decision; every one of those options is default off, so ' +
      'with only the gate on no rule is in scope and the two arms play the same poker. ' +
      'The option is DEFAULT OFF (read as === true) and OFF-ONLY in the live switch. ' +
      'Measured 2026-11-16 by running this refused matchup through runMatchup (seed 20261116, 300 pairs): ' +
      '0 of 300 pairs diverged (inert, as the structure says). ' +
      'The port itself is measured by the card plo6_omaha_strategy_six_card_port (the ported options on in ' +
      'both arms, the gate on in one); this refusal stands for the gate alone. ' +
      'What would change this: nothing for the one-option question; the card answers the port.',
  },
  // 2026-11-15 (PLO Strategy, hand 59518335): omahaVpipFloorByLimp,
  // default off. Refused, not dealt: this league seats no VPIP-floor table.
  ...(['plo4', 'plo5'] as const).map((variant) => ({
    name: `${variant}_omaha_vpip_floor_by_limp`,
    variant,
    a: { omahaVpipFloorByLimp: true },
    b: {},
    reason:
      'Unanswerable by this league: the option only acts while a table VPIP floor is lowering the ' +
      'preflop bars (HorseLogic.vpipFloorMul below 1), and playHand builds its decision state with ' +
      'no vpipFloor, vpipWindowHands or ownVpip, so the multiplier is 1 at every decision and the ' +
      'two arms play identical poker. The option is DEFAULT OFF (read as === true). ' +
      'Measured 2026-11-15 by running this refused matchup through runMatchup (seed 20261115, 300 pairs): ' +
      '0 of 300 pairs diverged. ' +
      "What would change this: a league table that carries a VPIP floor and each seat's judged " +
      'VPIP window (as the live Madness tables do); until it is built, the recorded-hand cases in ' +
      'HorseOmahaVpipFloorByLimp.test.ts are the only evidence.',
  })),
  // 2026-11-18 (Lightning parity lane): lightningVpipFloorLimpOnly and
  // omahaReraisedPositionInLightning, default off. Refused, not dealt: this league
  // deals no Lightning hand (no Lightning public memory domain in playHand).
  ...(['plo4', 'plo5'] as const).flatMap((variant) => [
    {
      name: `${variant}_lightning_vpip_floor_limp_only`,
      variant,
      a: { lightningVpipFloorLimpOnly: true },
      b: {},
      reason:
        'Unanswerable by this league: the option acts only on a Lightning cash decision whose ' +
        'state carries lightningVpipFloor (HorseLogic.lightningVpipFloorLimpOnlyInputs), and ' +
        'playHand builds neither a Lightning public memory domain nor that field, so the two arms ' +
        'play identical poker. The option is DEFAULT OFF (read as === true). ' +
        'Measured 2026-11-18 by running this refused matchup through runMatchup (seed 20261118, 300 pairs): ' +
        '0 of 300 pairs diverged. ' +
        'What would change this: a league pool that deals Lightning hands with a floor and a ' +
        'per-sitting count of dealt and entered hands; until it is built, ' +
        'HorseLightningVpipFloorLimpOnly.test.ts is the evidence.',
    },
    {
      name: `${variant}_omaha_reraised_position_in_lightning`,
      variant,
      a: { omahaReraisedPositionInLightning: true },
      b: {},
      reason:
        'Unanswerable by this league: the option only lifts the Lightning branch of ' +
        'omahaReraisedLaneUntouched (HorseLogic), and playHand deals no Lightning hand, so the two ' +
        'arms play identical poker. The option is DEFAULT OFF (read as === true). ' +
        'Measured 2026-11-18 by running this refused matchup through runMatchup (seed 20261118, 300 pairs): ' +
        '0 of 300 pairs diverged. ' +
        'What would change this: a league pool that deals Lightning hands (a Lightning public ' +
        'memory domain on the decision state); until it is built, the recorded Lightning lines of ' +
        'HorseOmahaReraisedPositionInLightning.test.ts are the evidence.',
    },
  ]),
  // 2026-11-17 (F-10, owner ruling 14:34 Chicago): vpipFloorLimpOnly, default off.
  // Refused, not dealt: this league seats no VPIP-floor table.
  ...(['nlh', 'plo4', 'plo5', 'plo6'] as const).map((variant) => ({
    name: `${variant}_vpip_floor_limp_only`,
    variant,
    a: { vpipFloorLimpOnly: true },
    b: {},
    reason:
      'Unanswerable by this league: the option only acts on a table that carries a VPIP floor ' +
      '(vpipFloorLimpOnlyApplies needs vpipFloor > 0), and playHand builds its decision state with ' +
      'no vpipFloor, vpipWindowHands or ownVpip, so the two arms play identical poker. The option is ' +
      'DEFAULT OFF (read as === true). ' +
      'Measured 2026-11-17 by running this refused matchup through runMatchup (seed 20261117, 300 pairs): ' +
      '0 of 300 pairs diverged. ' +
      "What would change this: a league table that carries a VPIP floor and each seat's judged VPIP " +
      'window; until it is built, HorseVpipFloorLimpOnly.test.ts and the sitting evaluation of ' +
      'HorseVpipFloorLimpOnly.test-support.ts are the evidence.',
  })),
  // 2026-11-19: vpipFloorLimpOnlyTenHandWindow, default off. Refused, not dealt:
  // this league seats no VPIP-floor table, and none judged at ten hands.
  ...(['nlh', 'plo4', 'plo5', 'plo6'] as const).map((variant) => ({
    name: `${variant}_vpip_floor_limp_only_ten_hand_window`,
    variant,
    a: { vpipFloorLimpOnly: true, vpipFloorLimpOnlyTenHandWindow: true },
    b: { vpipFloorLimpOnly: true },
    reason:
      'Unanswerable by this league: the option only brings a table KNOWN to be judged at ten hands ' +
      'under vpipFloorLimpOnly (vpipFloorLimpOnlyGovernsTenHandTable needs vpipFloor > 0, a window ' +
      "of ten or fewer and the Horse's own judged row), and playHand builds its decision state with " +
      'no vpipFloor, vpipWindowHands or ownVpip, so the two arms play identical poker. The option is ' +
      'DEFAULT OFF (read as === true). ' +
      'Measured 2026-11-19 by running this refused matchup through runMatchup (seed 20261119, 300 pairs): ' +
      '0 of 300 pairs diverged. ' +
      'What would change this: a league table that carries a VPIP floor, the ten-hand sitting window ' +
      "and each seat's judged VPIP; until it is built, HorseVpipFloorLimpOnlyTenHandWindow.test.ts " +
      'and the sitting evaluation of HorseVpipFloorLimpOnly.test-support.ts (audit archive ' +
      'repairs/TENHAND) are the evidence.',
  })),
  // 2026-11-27 (lead-8 lane preflop): vpipFloorLimpFoldsToARaise, default off. Refused, not dealt:
  // this league seats no VPIP-floor table, so no floor limp is ever made or remembered.
  ...(['nlh', 'plo4', 'plo5', 'plo6'] as const).map((variant) => ({
    name: `${variant}_vpip_floor_limp_folds_to_a_raise`,
    variant,
    a: { vpipFloorLimpOnly: true, vpipFloorLimpFoldsToARaise: true },
    b: { vpipFloorLimpOnly: true },
    reason:
      'Unanswerable by this league: the option acts only on a Horse whose own accepted limp of the hand was ' +
      "the VPIP floor's (gs.ownVpipFloorLimpThisHand, remembered by the table engine from the mark the " +
      'limp-only step sets), and playHand builds its decision state with no vpipFloor, vpipWindowHands, ' +
      'ownVpip or ownVpipFloorLimpThisHand, so the two arms play identical poker. The option is DEFAULT OFF ' +
      '(read as === true). Measured 2026-11-27 by running this refused matchup through runMatchup (seed ' +
      '20261127, 300 pairs): 0 of 300 pairs diverged. ' +
      "What would change this: a league table that carries a VPIP floor, each seat's " +
      'judged VPIP and the per-hand memory of a floor limp; until it is built, ' +
      'aVpipFloorLimpFoldsToARaise.law.test.ts (real replayed nodes) and the floored mirror recorded in ' +
      'docs/horse-option-authority.d/vpipFloorLimpFoldsToARaise.md are the evidence.',
  })),
  // 2026-11-15 (Hold'em Strategy lane): the long shown river memory. Refused, not
  // dealt: the evidence it reads does not exist in a league hand.
  {
    name: 'nlh_long_shown_river_memory',
    variant: 'nlh',
    seats: 6,
    a: { styleLongShownMemory: true },
    b: {},
    reason:
      'Unanswerable by this league: the option reads one thing, the durable shown river record ' +
      '(horse_exact_profiles.shown_river) that a pooled public row carries into a live worker decision ' +
      '(horseDecision/observerReads -> HorseMindSandbox.pooledShownRiver). playHand calls HorseLogic.decide ' +
      'directly, with no pooled public rows, no accepted-hand database learner and no worker, so the record is ' +
      'never present and both arms read the same in-process size buckets. The option is DEFAULT OFF (read as === true). ' +
      'Measured 2026-11-15 by running this refused matchup through runMatchup (seed 20261115, 300 pairs): ' +
      '0 of 300 pairs diverged (inert, as the structure says). ' +
      'What would change this: a league that replays accepted hands into the pooled public profiles across a ' +
      'simulated restart; until it exists, aShownRiverBettorIsRememberedAcrossARestart.law.test.ts and its worker ' +
      'test (FAST, DEEP and exact replay) are the evidence.',
  },
  // 2026-11-15 (Hold'em Strategy lane): the profile completeness cap. Refused, not
  // dealt: the rows it reads do not exist in a league hand.
  {
    name: 'nlh_profile_completeness_cap',
    variant: 'nlh',
    seats: 6,
    a: { holdemProfileCompletenessCap: true },
    b: {},
    reason:
      'Unanswerable by this league: the option reads one thing, the qualification of the pooled public rows ' +
      '(initialized, public_memory_domain) that a live worker decision carries ' +
      '(horseDecision/observerReads -> HorseMindSandbox.pooledProfileIncomplete). playHand calls HorseLogic.decide ' +
      'directly, with no pooled public rows and no worker, so no row is ever named and both arms read the same ' +
      'style confidence. MEASURED 2026-11-15 (runMatchup, seed 20261115): 0 of 300 pairs diverged, 0.00 bb/100, ' +
      'stderr 0. The option is DEFAULT OFF (read as === true). ' +
      'What would change this: a league that seats opponents from stored pooled profiles with mixed ' +
      'qualification; until it exists, anIncompleteProfileIsCappedThroughTheWorker.test.ts (FAST, DEEP and exact ' +
      'replay) is the evidence.',
  },
  // FIXED LIMIT (Fixed-Limit lane, 2026-11-14 to 2026-11-16; re-measured
  // 2026-11-20 on legal flh and 2026-11-21 on legal flo8).
  // flh_priced_preflop and flh_river_full_bet_read left for FIXED_LIMIT_HOLDEM_CARDS;
  // flo8_no_omaha_presumption, flo8_priced_preflop and flo8_river_full_bet_read left
  // for FIXED_LIMIT_OMAHA_HILO_CARDS; flo8_hilo_low_half_floor and
  // flo8_nut_low_river_bet left for FLO8_SCRIPTED_FIELD_CARDS. Every arm below is
  // default off and refused with its own count on the legal game.
  // SPEC-FL-01..03.
  {
    name: 'flh_river_one_bet_value_raise',
    variant: 'flh',
    seats: 2,
    a: { fixedLimitRiverOneBetValueRaise: true },
    b: {},
    reason: fixedLimitHoldemRefusal({
      gate: 'Every gate of this option requires a fixed-limit state (HorseLogic: vi.isFixedLimit): a strong hand facing exactly one river bet.',
      diverged: 0,
      why:
        'With production personas at both seats (seed 20261120) 0 of 300 pairs diverged too: ' +
        'no league hand reached a decision the option changes. Since 2026-11-20 the scripted river-betting field ' +
        'is built and this option is on the card against it: flh_river_one_bet_value_raise_vs_maniac (15 of 3,000 ' +
        'pairs diverged, seed 20261115) with its harm control flh_river_one_bet_value_raise_vs_tight_value ' +
        '(5 of 3,000); this Horse-mirror arm stays refused as the mirror reading.',
      needs:
        'a Horse that bets every river it is checked to (the scripted field that measures the option instead is ' +
        'built, FixedLimitScriptedField.ts)',
      law: 'AFixedLimitStrongHandRaisesOneRiverBet',
    }),
  },
  // Adaptation fix F2, the call price. 2026-11-16: the option is scoped to
  // fixed-limit hold'em cash, so the flo8 arm is inert by scope.
  {
    name: 'flo8_call_is_not_a_commitment',
    variant: 'flo8',
    seats: 6,
    a: { fixedLimitCallIsNotACommitment: true },
    b: {},
    reason: fixedLimitHiLoRefusal({
      gate: "The option acts only on fixed-limit hold'em at a cash table (HorseLogic fixedLimitCallIsNotACommitmentInScope).",
      diverged: 0,
      why:
        'Inert by scope: since 2026-11-16 fixedLimitCallIsNotACommitmentInScope excludes flo8, so at flo8 both arms ' +
        'play identical poker (0 of 300 pairs plain and 0 of 300 on the Hybrid cash persona, 0 illegal, 0 truncated).',
      needs: 'a scope change admitting flo8 and an aggressive flo8 field',
      law: 'AFixedLimitCallIsNotACommitment',
    }),
  },
  {
    name: 'flh_call_is_not_a_commitment',
    variant: 'flh',
    seats: 6,
    a: { fixedLimitCallIsNotACommitment: true },
    b: {},
    reason: fixedLimitHoldemRefusal({
      gate: "The option acts on a fixed-limit hold'em cash call facing a bet (HorseLogic fixedLimitCallIsNotACommitmentInScope).",
      diverged: 1,
      why:
        'On the live cash Hybrid persona with the deal-seeded mood clock (seed 20261120) 1 of 2,000 pairs diverged ' +
        '(+0.0375 +/- 0.0375 bb/100); with production personas at every seat (seed 20261120) 2 of 600 pairs; heads-up ' +
        '(seed 20261115) 0 of 300 pairs, where a call facing a bet closes the action and carries no price for a raise behind. ' +
        'The option prices the chance that a player behind raises, and on recorded Horse-only hands a player behind raised ' +
        '4 times in 254 (docs/horse-default-on.d/fixedLimitCallIsNotACommitment.md), so a Horse mirror almost never moves it; ' +
        'the lane measured its value against a scripted maniac. Since 2026-11-20 that field is built and this ' +
        'option is on the card against it: flh_call_is_not_a_commitment_vs_maniac (16 of 200 pairs diverged, seed ' +
        '20261115) with its harm control flh_call_is_not_a_commitment_vs_tight_value (1 of 3,000); this Horse-mirror ' +
        'arm stays refused as the mirror reading.',
      needs:
        'Horses that raise behind a call far more often than the recorded 4 in 254 (the scripted field that ' +
        'measures the option instead is built, FixedLimitScriptedField.ts)',
      law: 'AFixedLimitCallIsNotACommitment',
    }),
  },
  // W8, a strong river hand leads.
  {
    name: 'flh_river_strong_hand_leads',
    variant: 'flh',
    seats: 6,
    a: { fixedLimitRiverStrongHandLeads: true },
    b: {},
    reason: fixedLimitHoldemRefusal({
      gate: 'Every gate of this option requires a fixed-limit state (HorseLogic: vi.isFixedLimit): a strong river hand first to act.',
      diverged: 0,
      why:
        'Heads-up (seed 20261115) 0 of 300 pairs diverged, and with production personas at every seat ' +
        '(seed 20261120) 1 of 300 pairs. Against the scripted fixed-limit field built 2026-11-20 ' +
        '(FixedLimitScriptedField.ts, seed 20261115, the hero on the cash Hybrid persona): 0 of 3,000 pairs against ' +
        'the maniac at six seats, 0 of 3,000 against it heads-up, and 0 of 3,000 against the tight-value player at ' +
        'six seats. Not measured, only read from the scripts: a maniac bets behind every check, so a lead may gain ' +
        'nothing over a check-call, and a value-only player behind folds what a lead would be paid by. ' +
        'Against the passive caller built 2026-11-21 (flh_passive_caller_v1: never folds after the flop, checks ' +
        'behind anything under two pair), heads-up, the hero on the cash Hybrid persona: 1 of 20,000 pairs diverged ' +
        'at seed 20261120 (-0.01 +/- 0.01 bb/100) and 0 of 20,000 pairs at seed 20261121; development probes at seed ' +
        '20261115 read 2 of 10,000 pairs heads-up and 0 of 4,000 pairs at six seats. So the field this refusal ' +
        'asked for is built and the option still changes almost no decision; why the Horse so rarely reaches the ' +
        'gate with the reference checking was not measured.',
      needs:
        'a field in which a first-to-act Horse checks a full house or better on the river at a measurable rate ' +
        '(none of the four scripts built is one)',
      law: 'AFixedLimitStrongRiverHandLeads',
    }),
  },
  {
    name: 'flo8_river_strong_hand_leads',
    variant: 'flo8',
    seats: 6,
    a: { fixedLimitRiverStrongHandLeads: true },
    b: {},
    reason: fixedLimitHiLoRefusal({
      gate: 'Every gate of this option requires a fixed-limit state (HorseLogic: vi.isFixedLimit): a strong river hand first to act.',
      diverged: 0,
      why:
        'On the live cash Hybrid persona with the deal-seeded mood clock (seed 20261115) 0 of 300 pairs diverged too ' +
        '(0 illegal, 0 truncated, 0 corrected, 0 fallbacks): no Horse mirror hand reached a first-to-act strong river ' +
        'check that the option flips to a lead.',
      needs:
        'a scripted flo8 field in which a first-to-act Horse checks a full house or better on the river',
      law: 'AFixedLimitStrongRiverHandLeads',
    }),
  },
  // W5, priced preflop (flo8_priced_preflop left for FIXED_LIMIT_OMAHA_HILO_CARDS)
  // and the steal against over-folding blinds.
  {
    name: 'flh_steal_vs_tight_blinds',
    variant: 'flh',
    seats: 6,
    a: { fixedLimitStealVsTightBlinds: true },
    b: {},
    reason: fixedLimitHoldemRefusal({
      gate:
        'The option widens a first-in open only when every player still to act has an own adequate over-folder read ' +
        '(HorseFixedLimitPreflop.fixedLimitStealWiden).',
      diverged: 0,
      why:
        'The steal needs over-folder reads the self-play field does not build. Since 2026-11-21 the scripted ' +
        'over-folding blinds are built and this option is on the card against them: ' +
        'flh_steal_vs_tight_blinds_vs_over_folding_blinds (388 of 10,000 pairs diverged at seed 20261120, 353 of ' +
        '10,000 pairs at seed 20261121), with its harm control flh_steal_vs_tight_blinds_vs_preflop_defending_blinds ' +
        '(427 and 382 of 10,000). Against the value-only blinds (flh_value_only_blinds_v1, 2026-11-21) 2 of 20,000 ' +
        'pairs diverged at each seed, so that card is not kept: the over-folder read almost never engages against ' +
        'a player whose folds are mixed by his cards (docs/horse-league-fixed-limit.md, "The over-folder read and ' +
        'mixed frequencies"). With production personas at every seat (seed 20261120) 0 of 600 pairs diverged. ' +
        'This Horse-mirror arm stays refused as the mirror reading.',
      needs:
        'Horses whose own postflop fold-to-bet read engages high (the scripted field that measures the option ' +
        'instead is built, FixedLimitScriptedField.ts)',
      law: 'AFixedLimitStealsFromOverFoldingBlinds',
    }),
  },
  {
    name: 'flo8_steal_vs_tight_blinds',
    variant: 'flo8',
    seats: 6,
    a: { fixedLimitStealVsTightBlinds: true },
    b: {},
    reason: fixedLimitHiLoRefusal({
      gate:
        'The option widens a first-in open only when every player still to act has an own adequate over-folder read ' +
        '(HorseFixedLimitPreflop.fixedLimitStealWiden).',
      diverged: 0,
      why:
        'On the live cash Hybrid persona with the deal-seeded mood clock (seed 20261115) 0 of 300 pairs diverged too ' +
        '(0 illegal, 0 truncated, 0 corrected, 0 fallbacks): the steal needs over-folder reads a Horse mirror does ' +
        'not build.',
      needs: 'a scripted flo8 over-folding blinds field with harm controls',
      law: 'AFixedLimitStealsFromOverFoldingBlinds',
    }),
  },
  // W4, "F1b", the read-time probe guard, its own option.
  {
    name: 'flh_read_ignores_probes',
    variant: 'flh',
    seats: 6,
    a: { fixedLimitReadIgnoresProbes: true },
    b: {},
    reason: fixedLimitHoldemRefusal({
      gate:
        'The option acts only on a fixed-limit decision (HorseMind.fixedLimitReadIgnoresProbes: ' +
        "decisionBettingStructure() === 'fixed_limit', with the F1 process switch on) and only against a player whose " +
        'pooled no-limit/pot-limit probe share is non-zero.',
      diverged: 0,
      why:
        'Heads-up (seed 20261115) 0 of 300 pairs diverged, and with production personas at every seat (seed 20261120) ' +
        '0 of 300 pairs: a league card deals one variant, so no opponent in its sandbox carries a no-limit probe history. ' +
        'Since 2026-11-20 a scripted-field card can seed that history (LeagueMatchup.probeHistoryHands) and this option ' +
        'is on the card that way: flh_read_ignores_probes_vs_maniac (333 of 1,000 pairs diverged, seed 20261115; 0 of ' +
        '1,000 without the history) with its harm control flh_read_ignores_probes_vs_tight_value (0 of 3,000); this ' +
        'Horse-mirror arm stays refused as the mirror reading.',
      needs:
        'Horse opponents carrying a no-limit probe history (the lane measured 1 of 4,011 flh deals changed even then, ' +
        'docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md, Reach)',
      law: 'AFixedLimitReadIsNeverProbeDiscounted',
    }),
  },
  {
    name: 'flo8_read_ignores_probes',
    variant: 'flo8',
    seats: 6,
    a: { fixedLimitReadIgnoresProbes: true },
    b: {},
    reason: fixedLimitHiLoRefusal({
      gate:
        'The option acts only on a fixed-limit decision (HorseMind.fixedLimitReadIgnoresProbes) against a player whose ' +
        'pooled no-limit/pot-limit probe share is non-zero.',
      diverged: 0,
      why:
        'On the live cash Hybrid persona with the deal-seeded mood clock (seed 20261115) 0 of 300 pairs diverged too ' +
        '(0 illegal, 0 truncated, 0 corrected, 0 fallbacks): a mirror card deals one variant, so no opponent in its ' +
        'sandbox carries a no-limit or pot-limit probe history.',
      needs: 'a scripted flo8 field seeded with a no-limit or pot-limit probe history',
      law: 'AFixedLimitReadIsNeverProbeDiscounted',
    }),
  },
  {
    name: 'plo4_lightning_participation_omaha',
    variant: 'plo4',
    a: { lightningParticipationOmaha: true },
    b: {},
    reason:
      'No Lightning domain in the league table. lightningParticipationOmaha is DEFAULT OFF (HorseLogic: ' +
      'opts.lightningParticipationOmaha === true) and its one predicate (HorseLightningParticipation) ' +
      'requires gs.publicMemoryDomain.speed === "lightning" with a big-blind ante, four to six ' +
      'dealt, cash. The league deals its own tables and no league context carries a public ' +
      'memory domain, so both arms would play identical poker (the option refuses with ' +
      'lightning_participation_refused_not_lightning_seen) and the card would report 0.00 +/- ' +
      '0.00 every night. Measured 2026-11-15 on this matchup as written: 0 of 2,000 pairs ' +
      'diverged (run seed 20261114). It is measured where the domain exists: the paired Lightning harness ' +
      '(lightning/LightningPairedEval.test.ts, LIGHTNING_EVAL_CANDIDATE) under the declared ' +
      'protocol (development, selection and final seed classes). What would change this: a ' +
      'league context that deals the Lightning contract (fast-fold pool, big-blind ante of one ' +
      'big blind, a new table every hand) and sets the domain.',
  },
  {
    // PLO Strategy lane 2026-11-19 (lead 01TLQer7J): omahaStrongHandSlowplayMix on in BOTH arms; the one-arm
    // question is its Lightning scope.
    name: 'plo5_omaha_slowplay_mix_in_lightning',
    variant: 'plo5',
    a: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaStrongHandSlowplayMix: true,
      omahaSlowplayMixInLightning: true,
    },
    b: { ...OMAHA_LIVE_OPTIONS_20261118, omahaStrongHandSlowplayMix: true },
    reason:
      'No Lightning domain in the league table. omahaSlowplayMixInLightning is DEFAULT OFF (HorseLogic ' +
      'omahaStrongHandSlowplayMixRule: opts.omahaSlowplayMixInLightning === true) and it changes one thing: the ' +
      'game of omahaStrongHandSlowplayMix (HorseOmahaStrongHandSlowplayMix inGame) no longer refuses a decision ' +
      'whose gs.publicMemoryDomain.speed is "lightning". The league deals its own tables and no league context ' +
      'carries a public memory domain, so every league decision is already inside the mix in both arms, both arms ' +
      'play identical poker (omaha_slowplay_mix_in_lightning_scope_seen never fires) and the card would report ' +
      '0.00 +/- 0.00 every night. Inert by construction (the one read of the option is behind the speed test). ' +
      'Measured 2026-11-19 by running this refused matchup through runMatchup: 0 of 300 pairs diverged ' +
      '(run seed 20261119, status inert, 0.00 bb/100). ' +
      'It is measured where the domain exists: the paired Lightning harness (lightning/LightningPairedEval.test.ts, ' +
      'switch card on the live base, E1) under the pre-written bar (PLO lane evidence, ' +
      'plo-handoff-review-01a1cbbd/ltgscopes-01TLQer7J/PASS-BAR.md). What would change this: a league context that ' +
      'deals the Lightning contract (fast-fold pool, big-blind ante of one big blind, a new table every hand) and ' +
      'sets the domain.',
  },
  {
    // EMERG lane OPEN-ITEMS-3 2026-11-20: omahaCheckedToBetIsPriced on in BOTH arms; the one-arm question is its
    // own Lightning scope.
    name: 'plo5_omaha_checked_to_bet_in_lightning',
    variant: 'plo5',
    a: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaCheckedToBetIsPriced: true,
      omahaCheckedToBetInLightning: true,
    },
    b: { ...OMAHA_LIVE_OPTIONS_20261118, omahaCheckedToBetIsPriced: true },
    reason:
      'No Lightning domain in the league table. omahaCheckedToBetInLightning is DEFAULT OFF (HorseLogic ' +
      'omahaCheckedToBetIsPricedRule: opts.omahaCheckedToBetInLightning === true) and it changes one thing: the ' +
      'scope of omahaCheckedToBetIsPriced no longer refuses a decision whose gs.publicMemoryDomain.speed is ' +
      '"lightning". The league deals its own tables and no league context carries a public memory domain, so every ' +
      'league decision is already inside that rule in both arms and both arms play identical poker ' +
      '(omaha_checked_to_bet_in_lightning never fires): inert by construction (the one read of the option only ' +
      'opens the speed test). Measured 2026-11-20 by running this refused matchup through runMatchup: 0 of 300 ' +
      'pairs diverged (run seed 20261120, status inert, 0.00 bb/100). It is measured where the ' +
      'domain exists: the exact journal replay of the production Lightning pools of 2026-11-18..19, graded against ' +
      'the real cards (archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/OPEN-ITEMS-3.md). What would change this: ' +
      'a league context that deals the Lightning contract (fast-fold pool, big-blind ante of one big blind, a new ' +
      'table every hand) and sets the domain.',
  },
  {
    // PLO Strategy lane 2026-11-19 (lead 01TLQer7J): omahaBetSizeByPublicState on in BOTH arms; the one-arm
    // question is its Lightning scope.
    name: 'plo5_omaha_public_bet_size_in_lightning',
    variant: 'plo5',
    a: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaBetSizeByPublicState: true,
      omahaPublicBetSizeInLightning: true,
    },
    b: { ...OMAHA_LIVE_OPTIONS_20261118, omahaBetSizeByPublicState: true },
    reason:
      'No Lightning domain in the league table. omahaPublicBetSizeInLightning is DEFAULT OFF ' +
      '(HorseLogic.publicBetSizeInGame: opts.omahaPublicBetSizeInLightning !== true) and it changes one thing: the ' +
      'game of omahaBetSizeByPublicState no longer refuses a decision whose gs.publicMemoryDomain.speed is ' +
      '"lightning". The league deals its own tables and no league context carries a public memory domain, so every ' +
      'league decision is already inside the public size in both arms, both arms play identical poker ' +
      '(omaha_public_bet_size_in_lightning_scope_seen never fires): the option is inert by construction (its one ' +
      'read is behind the speed test). ' +
      'Measured 2026-11-19 by running this refused matchup through runMatchup (run seed 20261119): 49 of 300 pairs ' +
      'diverged (-9.69 +/- 7.28 bb/100), and NONE of that is the option: with IDENTICAL arms 38 of 300 pairs ' +
      'diverged (both arms the b set, +11.65 +/- 6.25 bb/100) and 39 of 300 (both arms the a set, -7.47 +/- 6.98). ' +
      'The divergence is the size stream of omahaBetSizeByPublicState, which is on in both arms: ' +
      'horsePublicBetSize.horseBetSizeRandom is seeded from the operating system at load, never from the run seed ' +
      'or the deal, so the two deals of a duplicate pair draw different sizes. With that stream held constant ' +
      '(horseBetSizeRandom mocked to 0.5; 1,676 size draws taken) the same matchup diverged in 0 of 300 pairs, as ' +
      'did its identical-arm control. That noise is closed: playHand now pins the size and timing streams per ' +
      'decision from the deal, the seat and the decision index (leaguePinPublicStreams, law ' +
      'aPairedLeagueEvaluationRepeatsItself). Re-measured 2026-11-19 on the pinned league (300 pairs, run seed ' +
      '20261119, one niced process): 0 of 300 pairs diverged (status inert, 0.00 +/- 0.00 bb/100), and its ' +
      'identical-arm controls (both arms the b set; both arms the a set) 0 of 300 each. The matchup is inert as ' +
      'constructed, which is the reason it stays refused. ' +
      'It is measured where the domain exists: the paired Lightning harness (lightning/LightningPairedEval.test.ts, ' +
      'switch card on the live base, E1) under the pre-written bar (PLO lane evidence, ' +
      'plo-handoff-review-01a1cbbd/ltgscopes-01TLQer7J/PASS-BAR.md). What would change this: a league context that ' +
      'deals the Lightning contract (fast-fold pool, big-blind ante of one big blind, a new table every hand) and ' +
      'sets the domain.',
  },
  {
    // PLO Strategy lane 2026-11-18 (HORSE SWITCH lane finding 20:08:21Z): the live Omaha set (with the priced
    // turn/river raise and the priced small bets on) in BOTH arms; the one-arm question is the Lightning scope.
    name: 'plo5_omaha_priced_in_lightning',
    variant: 'plo5',
    a: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaSmallBetIsPriced: true,
      omahaPricedInLightning: true,
    },
    b: { ...OMAHA_LIVE_OPTIONS_20261118, omahaSmallBetIsPriced: true },
    reason:
      'No Lightning domain in the league table. omahaPricedInLightning is DEFAULT OFF (HorseOmahaPricedWiring: ' +
      'opts.omahaPricedInLightning === true) and it changes one thing: omahaPricedInScope (and, for the two priced ' +
      'raise owners, omahaRaiseNeedsNutsScope) no longer refuses a decision whose gs.publicMemoryDomain.speed is ' +
      '"lightning". The league deals its own tables and no league context carries a public memory domain, so every ' +
      'league decision is already inside the priced scope in both arms, both arms play identical poker ' +
      '(omaha_priced_in_lightning_scope_seen never fires) and the card would report 0.00 +/- 0.00 every night. ' +
      'Measured 2026-11-18 by running this refused matchup through runMatchup: 0 of 300 pairs diverged ' +
      '(run seed 20261118, status inert). ' +
      'It is measured where the domain exists: the paired Lightning harness (lightning/LightningPairedEval.test.ts, ' +
      'LIGHTNING_EVAL_CANDIDATE) on a live-base baseline (PASS-BAR in the PLO lane evidence, ' +
      'plo-handoff-review-01a1cbbd/lightning-013U37). What would change this: a league context that deals the ' +
      'Lightning contract (fast-fold pool, big-blind ante of one big blind, a new table every hand) and sets the domain.',
  },
  {
    // TURN-STAB lane 2026-11-19: the live Omaha set (which runs omahaFacingBetEv) in BOTH arms; the one-arm
    // question is the turn-stab prior.
    name: 'plo5_omaha_turn_stab_defence_is_priced',
    variant: 'plo5',
    a: { ...OMAHA_LIVE_OPTIONS_20261118, omahaTurnStabDefenceIsPriced: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261118 },
    reason:
      'No person in the league table. omahaTurnStabDefenceIsPriced is DEFAULT OFF (HorseLogic.omahaFacingBetEvCount: ' +
      'opts.omahaTurnStabDefenceIsPriced === true) and it changes one input: the non-value prior of the facing-bet ' +
      'EV when the bettor is a PERSON (HorseOmahaPricedMode.omahaOpponentKindOf) making the first wager of the turn ' +
      'after a checked-through flop. Every league seat is a Horse, so the line never holds in either arm, both arms ' +
      'play identical poker (omaha_turn_stab_defence_priced_seen never fires) and the card would report 0.00 +/- 0.00. ' +
      'Measured 2026-11-19 by running this refused matchup through runMatchup: 0 of 300 pairs diverged ' +
      '(run seed 20261119, status inert). ' +
      'It is measured where persons play: the declared replay of journaled production decisions ' +
      '(woowoo-48h-audit-01BNteGYgf/repairs/TURN-STAB/EVAL-DECLARATION.md). What would change this: a league field ' +
      'that seats a person model with a measured turn-stab line.',
  },
  {
    // AUDIT48-TURN lane 2026-11-19: the live Omaha set plus the turn-stab option and the Lightning opening in BOTH
    // arms; the one-arm question is the Lightning-measured stab row.
    name: 'plo5_omaha_turn_stab_lightning_row',
    variant: 'plo5',
    a: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaTurnStabDefenceIsPriced: true,
      omahaPricedInLightning: true,
      omahaTurnStabLightningRow: true,
    },
    b: {
      ...OMAHA_LIVE_OPTIONS_20261118,
      omahaTurnStabDefenceIsPriced: true,
      omahaPricedInLightning: true,
    },
    reason:
      'No person and no Lightning domain in the league table. omahaTurnStabLightningRow is DEFAULT OFF ' +
      '(HorseLogic.omahaFacingBetEvCount: opts.omahaTurnStabLightningRow === true, only with ' +
      'omahaTurnStabDefenceIsPriced and omahaPricedInLightning on) and it changes one input in the Lightning pools ' +
      "only: the non-value prior of a PERSON's first turn wager after a checked-through flop. Every league seat is a " +
      'Horse and the league deals no Lightning, so the line never holds in either arm and the card would report ' +
      '0.00 +/- 0.00. Measured 2026-11-19 by running this refused matchup through runMatchup: 0 of 300 pairs ' +
      'diverged (run seed 20261119, status inert). It is measured where persons play Lightning: the replay of journaled production decisions ' +
      '(docs/horse-option-authority.d/omahaTurnStabLightningRow.md, archive woowoo-48h-audit-01BNteGYgf/repairs/' +
      'AUDIT48/TURN.md). What would change this: a league field that seats a person model in a Lightning domain.',
  },
  {
    // L-016 (2026-11-15, Lightning lane): the style consumers are on in BOTH arms, so the one-arm question is the
    // Lightning-separate style read itself.
    name: 'nlh_style_lightning_separate',
    a: {
      lightningStyleReadSeparate: true,
      styleRaiseRespect: true,
      styleBigBetHonesty: true,
      styleValueBettorNotManiac: true,
    },
    b: { styleRaiseRespect: true, styleBigBetHonesty: true, styleValueBettorNotManiac: true },
    reason:
      'No Lightning domain in the league table. lightningStyleReadSeparate is DEFAULT OFF (HorseLogic: ' +
      'opts.lightningStyleReadSeparate === true) and it reaches the style read only on a decision whose ' +
      'gs.publicMemoryDomain.speed is "lightning" (HorseLogic.prepareOriginalReads); the style read then takes ' +
      'postflop aggression, river size buckets and the Horse reference from the Lightning-only maps, which the ' +
      'learner fills only from hands it is given with speed "lightning". The league deals its own tables, sets ' +
      'no public memory domain and learns its hands without a speed, so both arms read the pooled maps and play ' +
      'identical poker (style_lightning_separate_read_seen never fires) and the card would report 0.00 +/- 0.00 ' +
      'every night. Measured 2026-11-15 on this matchup as written (style consumers on in both arms): 0 of ' +
      '2,000 pairs diverged six-handed and 0 of 2,000 pairs diverged heads-up (run seed 20261115). It is ' +
      'pinned where the domain exists: lightning/aLightningStyleReadKeepsItsOwnEvidence.law.test.ts (constructed ' +
      'Lightning and Classic evidence of one player: the Lightning 4x turn check-raise is called 24/24 pooled, ' +
      'folded 24/24 with the option). What would change this: a league context that deals the Lightning ' +
      'contract and sets the domain, with a field whose Lightning and Classic play differ, learned with the ' +
      'speed; the paired Lightning harness (lightning/LightningPairedEval.test.ts) is the place to measure it.',
  },
  {
    name: 'nlh_lightning_early_fold_needs_fold_through',
    a: { lightningEarlyFoldNeedsFoldThrough: true },
    b: {},
    reason:
      'No Lightning domain and no early look in the league table. lightningEarlyFoldNeedsFoldThrough is ' +
      'DEFAULT OFF (HorseLogic.decide: opts.lightningEarlyFoldNeedsFoldThrough === true) and acts only on a ' +
      'Lightning cash decision (gs.publicMemoryDomain.speed === "lightning") asked while live seats before the ' +
      'Horse still have to act, which only the Lightning host asks (its early look, off the turn). The league ' +
      'asks every decision on its own turn with no public memory domain, so both arms would play identical ' +
      'poker and the card would report 0.00 +/- 0.00 every night. Measured 2026-11-15 on this matchup as ' +
      'written: 0 of 2,000 pairs diverged (run seed 20261114). It is measured where the early look exists: ' +
      'the beyond-big-blind Lightning probe (all-Horse LightningHandHost tables, development seeds, ' +
      'counterfactual re-asks of the real turn, and a hero-scope paired arm). What would change this: a league ' +
      'context that runs the Lightning host (early looks off the turn) and sets the domain.',
  },
  {
    name: 'nlh_lightning_participation_holdem',
    a: { lightningParticipationHoldem: true },
    b: {},
    reason:
      'No Lightning domain in the league table. lightningParticipationHoldem is DEFAULT OFF (HorseLogic: ' +
      'opts.lightningParticipationHoldem === true) and its one predicate (HorseLightningParticipation) ' +
      'requires gs.publicMemoryDomain.speed === "lightning" with a big-blind ante, four to six ' +
      'dealt, cash. The league deals its own tables and no league context carries a public ' +
      'memory domain, so both arms would play identical poker (the option refuses with ' +
      'lightning_participation_refused_not_lightning_seen) and the card would report 0.00 +/- ' +
      '0.00 every night. Measured 2026-11-15 on this matchup as written: 0 of 2,000 pairs ' +
      'diverged (run seed 20261114). It is measured where the domain exists: the paired Lightning harness ' +
      '(lightning/LightningPairedEval.test.ts, LIGHTNING_EVAL_CANDIDATE) under the declared ' +
      'protocol (development, selection and final seed classes). What would change this: a ' +
      'league context that deals the Lightning contract (fast-fold pool, big-blind ante of one ' +
      'big blind, a new table every hand) and sets the domain.',
  },
  // 2026-11-15 (Hold'em Strategy, parked item built default off): a
  // tournament-table option this league cannot deal.
  {
    name: 'aof_closing_seat_nash_call',
    seats: 6,
    a: { aofClosingSeatNashCall: true },
    b: {},
    reason:
      'No All-In-Or-Fold table in the league. aofClosingSeatNashCall is DEFAULT OFF (HorseLogic: ' +
      'opts.aofClosingSeatNashCall === true) and acts only when gs.allInOrFold is true, the hero ' +
      'faces a lone all-in at 12 big blinds or less and every other player still in the hand is ' +
      'all in. The league deals open no-limit betting and never sets the All-In-Or-Fold flag, so ' +
      'both arms would play identical poker and the card would report 0.00 +/- 0.00 every night. ' +
      'Measured 2026-11-15 on this matchup as written: 0 of 2,000 pairs diverged (run seed ' +
      '20261115). It is measured where the spot exists: the fixed-input replay of ten anonymised ' +
      'production All-In-Or-Fold tournament requests in AnAofClosingSeatCallsFromTheNashTable.test.ts ' +
      'and the HVH2D-NLH-005 equity rows. What would change this: a league context that deals ' +
      'All-In-Or-Fold tables (legal actions fold or all in, tournament stacks of 12 big blinds or less).',
  },
  {
    // 2026-11-15 (heads-up lane, round 2): retired from HU_DEFENCE_CARDS.
    name: HUMAN_HU_OPENER_DEFENDS_VS_THREEBET_40BB,
    seats: 2,
    stackBB: 40,
    a: { huOpenerDefendsToPrice: true },
    b: {},
    reason:
      'Inert against this opponent. huOpenerDefendsToPrice is DEFAULT OFF (HorseLogic: ' +
      'opts.huOpenerDefendsToPrice === true). This card dealt it heads-up at 40bb against the ' +
      'human field with the hu_three_bet_every_hand_v1 persona, which re-raises every open. ' +
      "Against that player the engaged opponent read already decides the opener's answer, so " +
      'the option never changes a decision: the nightly of 2026-11-15 (engine 54c9aac8) ' +
      'reported status inert, 0 of 12,000 pairs diverged, both arms +123.90 bb/100. ' +
      'Divergence probes 2026-11-15 on b262fd3e0 (heads-up lane, round 2): 0 of 2,000 pairs ' +
      "at that night's seed and 1 of 4,000 pairs at seed 20261115 with reads on; with memory " +
      'learning off (no read, the 20% reference) the same card diverged in 88 of 4,000 pairs ' +
      "at seed 20261115 and 94 of 4,000 at that night's seed (raw outputs in the heads-up " +
      'evidence folder hu-audit-01UxDLnM/round2/cards/probes), so the read, not the spot, is ' +
      'what stands the option aside. The option is measured ' +
      'where it acts: human_hu_opener_defends_vs_wide_40bb (hu_wide_sb_aggressor_v1, a big ' +
      'blind that 3-bets light but not every hand). What would change this: a change to the ' +
      'opener read or to the option that lets the price, not the read, answer an every-hand ' +
      '3-bettor; re-probe this matchup before moving it back to the card.',
  },
  {
    name: 'plo4_lightning_cheap_entry_omaha',
    variant: 'plo4',
    a: { lightningCheapEntryOmaha: true },
    b: {},
    reason:
      'No Lightning domain in the league table. lightningCheapEntryOmaha is DEFAULT OFF (HorseLogic: ' +
      'opts.lightningCheapEntryOmaha === true) and it reads the one Lightning predicate ' +
      '(HorseLightningParticipation.lightningParticipationEligibility, through HorseLightningCheapEntry): ' +
      'gs.publicMemoryDomain.speed === "lightning" with a big-blind ante, four to six dealt, cash. ' +
      'The league deals its own tables and no league context carries a public memory domain, so ' +
      'both arms would play identical poker (the option refuses with ' +
      'lightning_cheap_entry_refused_not_lightning_seen) and the card would report 0.00 +/- 0.00 ' +
      'every night. Measured 2026-11-15 by running this refused matchup through runMatchup: 0 of 300 pairs diverged ' +
      '(run seed 20261115). It is measured where the domain exists: the paired Lightning harness ' +
      '(lightning/LightningPairedEval.test.ts, LIGHTNING_EVAL_CANDIDATE) under the declared ' +
      'protocol (development, selection and final seed classes). What would change this: a ' +
      'league context that deals the Lightning contract (fast-fold pool, big-blind ante of one ' +
      'big blind, a new table every hand) and sets the domain.',
  },
  {
    name: 'nlh_lightning_cheap_entry_holdem',
    a: { lightningCheapEntryHoldem: true },
    b: {},
    reason:
      'No Lightning domain in the league table. lightningCheapEntryHoldem is DEFAULT OFF (HorseLogic: ' +
      'opts.lightningCheapEntryHoldem === true) and it reads the one Lightning predicate ' +
      '(HorseLightningParticipation.lightningParticipationEligibility, through HorseLightningCheapEntry): ' +
      'gs.publicMemoryDomain.speed === "lightning" with a big-blind ante, four to six dealt, cash. ' +
      'The league deals its own tables and no league context carries a public memory domain, so ' +
      'both arms would play identical poker (the option refuses with ' +
      'lightning_cheap_entry_refused_not_lightning_seen) and the card would report 0.00 +/- 0.00 ' +
      'every night. Measured 2026-11-15 by running this refused matchup through runMatchup: 0 of 300 pairs diverged ' +
      '(run seed 20261115). It is measured where the domain exists: the paired Lightning harness ' +
      '(lightning/LightningPairedEval.test.ts, LIGHTNING_EVAL_CANDIDATE) under the declared ' +
      'protocol (development, selection and final seed classes). What would change this: a ' +
      'league context that deals the Lightning contract (fast-fold pool, big-blind ante of one ' +
      'big blind, a new table every hand) and sets the domain.',
  },
  {
    name: 'hu_break_even_bluff',
    seats: 2,
    a: { readBreakEvenBluff: true },
    b: {},
    reason:
      'Unanswerable by the fields the league seats. readBreakEvenBluff is DEFAULT OFF ' +
      '(HorseLogic: opts.readBreakEvenBluff === true). HorseMind.breakEvenBluffOf returns ' +
      'null, and the flag-off bluff scale answers, unless the opponent has an engaged ' +
      'postflop bluff read (postflopBluffMod non-null): a stranger, a horse-like regular ' +
      'or a field inside the population fold band never qualifies. On the card heads-up it ' +
      'measured 0.00 +/- 0.00 on each of 2026-11-10, 2026-11-11 and 2026-11-12 (0 of 6,000 ' +
      'pairs diverged each night). Divergence probes 2026-11-12 on b6db68d45 (heads-up ' +
      'lane, HU-NLH-001): the horse mirror 0 of 2,000 pairs at seed 20261112; the human ' +
      'field with the hu_wide_sb_aggressor_v1 persona 0 of 2,000 pairs at seeds 20261112 ' +
      'and 4242. What would change this: a field whose postflop fold-to-bet read leaves ' +
      'the population band (a persona that over-folds or never folds to postflop bets), ' +
      'dealt long enough for the read to engage. The six-max, nine-seat, tournament and ' +
      'PLO4 break_even_bluff cards are not affected by this entry.',
  },
  {
    name: 'v16_ratio_rescale',
    a: { v16Ratio: true },
    b: {},
    reason:
      'Dead by precedence, not for want of an edge. v16Ratio is DEFAULT OFF ' +
      '(HorseLogic: opts.v16Ratio === true). It rescales two HorseLogic thresholds: the ' +
      'OOP check-raise bluff gate (betRatio <= 0.6 vs 1.5, which on the bet/(pot+bet) ' +
      'scale is "at most 1.5x pot" either way and never binds) and the heads-up river ' +
      'bluff-catch gate (0.4 vs 0.667). V38 (opts.v38Ev, default ON since 2026-09-03) ' +
      'returns a call or a fold for every river spot, and for every solverless flop/turn ' +
      'spot, before the second gate is reached, so no hand can differ. Last measured on ' +
      'the card 2026-09-04: 0.00 +/- 0.00 over 12,000 hands (2026-08-31, before V38 ' +
      'defaulted on: +0.35 +/- 0.24, never resolved). Divergence probes: 0 of 1,000 ' +
      'pairs at seeds 4242 and 20260921 (2026-09-21) and 4242 / 20260927 (2026-09-27); ' +
      'and 0 of 2,000 at seed 20261031 on main 18dd7c6ab (2026-10-31). The default-ON rule (three significant positive runs) ' +
      'therefore cannot be evaluated and the default stays OFF. What would change this: ' +
      'turn opts.v38Ev off on both arms, or lift the rescaled gates above the V38 return. ' +
      'Read this row, not the absence of one, when deciding v16Ratio.',
  },
  {
    name: 'v18_exploit_size',
    a: {},
    b: { v18ExploitSize: false },
    reason:
      'Unanswerable by self-play. A league matchup is a MIRROR - both arms are the same ' +
      "brain differing only in the flag under test - so each arm's opponent folds at the " +
      "brain's own middling rate. The layer multiplies its river raise by " +
      '(exploit.valueThinMod - 1) and only counts a firing when abs(valueThinMod - 1) > ' +
      "0.03, and HorseMind.exploit moves valueThinMod off 1 only when the opponent's " +
      'fold-vs-aggression rate leaves the middle band (above 0.62, or below 0.35). In ' +
      'self-play it stays at 1 and the gate never opens; the human-calibrated field folds ' +
      'rivers inside the same band (0 divergent pairs of 3,000, 2026-10-24). Last measured ' +
      'on the card 2026-09-01: 0.00 +/- 0.00 over 12,000 hands. Divergence probes: 0 of ' +
      '1,000 pairs at seeds 4242 and 20260921 (2026-09-21); 0 and 1 of 1,000 at seeds 4242 ' +
      'and 20260927 (2026-09-27) - one pair in a thousand is bb100 = stderr, noise wearing ' +
      'the shape of a measurement. What would change this: an exploitable opponent, which ' +
      'self-play cannot produce. The effect is pinned deterministically instead: ' +
      'server/src/engine/V18ExploitSizingIsMeasurable.test.ts',
  },
  {
    name: 'v31_gto_suit_aware',
    seats: 2,
    a: {},
    b: { v31GtoSuitAware: false },
    reason:
      'Too rare for any sample the league can afford. Live telemetry on 2026-09-01: ' +
      'v31_gto_open fired 195 times against 924,871 decides, so at 6,000 pairs this ' +
      'matchup expects roughly TWO firings - observing no difference is the likely ' +
      'outcome. Last measured on the card 2026-09-01: 0.00 +/- 0.00 over 12,000 hands. ' +
      'Divergence probes: 0 of 1,000 pairs at seeds 4242 and 20260921 (2026-09-21) and ' +
      '4242 / 20260927 (2026-09-27), while a heads-up v11 control on the same harness ' +
      'diverged in 7 and 6 of 1,000. What would change this: a deliberate one-off with a ' +
      'large temporary pairs bump, or a seeded scenario matrix that forces suit-aware ' +
      'nodes. V31 is certified through fn_audit_gto_v31_certified and ' +
      'benchmark/GtoV31CandidateEvaluation.ts, which is where its verdict lives.',
  },
  ...(['plo4', 'plo5', 'plo6'] as const).map(
    (variant): UnmeasurableMatchup => ({
      name: `${variant}_v55_river_trips_flat`,
      variant,
      stackBB: 400,
      a: { v55OmahaRiverTripsFlat: true },
      b: {},
      reason:
        'Unreachable in self-play, not dead. v55OmahaRiverTripsFlat is DEFAULT OFF ' +
        '(HorseLogic: opts.v55OmahaRiverTripsFlat === true) and only changes a river ' +
        'Omaha decision holding weak trips (trips through a board pair) or a set on a ' +
        'straight/flush-possible board, facing a raise with the money committed. The flag ' +
        'still reaches code: HorseOmahaRiverTripsFlat.test.ts pins the recorded re-shove ' +
        'turning into a call. But the league stopped dealing that spot when the ' +
        '2026-10-26 river changes went in - the paired-board fold (#8088 PLO5/PLO6, #8104 ' +
        'PLO4: trips without a full house fold on a paired turn or river) and V56 ' +
        '(v56OmahaPressureRange, default ON, #8067: the vulnerable river set is priced ' +
        'against the strict pressure range) - so neither arm ever reaches the raise-war ' +
        'branch V55 changes. ' +
        (variant === 'plo6'
          ? 'Never on the standing card: the declared 6000-pair probe at seed 20261024 had ' +
            'zero divergent pairs. '
          : `Nightly at 400bb: ${
              variant === 'plo4' ? '+0.07 +/- 0.17 on 2026-10-26, then' : ''
            } 0 of 6,000 pairs diverged on every run from 2026-10-27 to 2026-10-30 ` +
            `(${variant === 'plo5' ? 'and 2026-10-31 read 0.48 +/- 0.48: one divergent pair, bb100 = stderr' : 'and again 2026-10-31'}). `) +
        'Re-probed 2026-10-31 on main 18dd7c6ab: 0 of 2,000 pairs at seed 20261031 ' +
        '(PLO4 and PLO5, 400bb). The layer stays opt-in with no measured edge and no ' +
        'promotion claim. What would change this: switching the paired-board fold and ' +
        'V56 off on both arms, which would measure a brain production does not play.',
    })
  ),
  {
    name: 'multiboard_freeroll_is_priced',
    variant: 'nlh',
    a: { multiBoardFreerollIsPriced: true },
    b: {},
    reason:
      'HorseLeague deals single-board hands only (boardCount: 1; no communityCards2 / ' +
      'communityCards3 or bomb-pot multi-board runouts), whereas multiBoardFreerollIsPriced ' +
      '(DEFAULT OFF, OPTION_SWITCH_REFUSED) is strictly scoped to multiBoard36 hands ' +
      '(nBoards36 >= 2) with at least one locked board (lockShare36 >= 1 / N) and is ' +
      'byte-identical on every single-board hand, so 0 of 6,000 pairs can ever diverge in ' +
      'this single-board league harness. Verified deterministically in ' +
      'server/src/engine/AMultiBoardFreerollIsPriced.law.test.ts and via dedicated paired ' +
      'multi-board NLH/PLO4 bomb-pot evaluation. What would change this: extending HorseLeague ' +
      'to deal double-board bomb-pot hands.',
  },
  {
    name: 'multiboard_non_freeroll_is_priced',
    variant: 'nlh',
    a: { multiBoardNonFreerollIsPriced: true },
    b: {},
    reason:
      'HorseLeague deals single-board hands only (boardCount: 1; no communityCards2 / ' +
      'communityCards3 or bomb-pot multi-board runouts), whereas multiBoardNonFreerollIsPriced ' +
      '(DEFAULT OFF, OPTION_SWITCH_REFUSED) is strictly scoped to multiBoard36 non-freeroll ' +
      'hands (v86 && nBoards36 >= 2 && lockShare36 < 1 / N) and is byte-identical on every ' +
      'single-board hand, so 0 of 6,000 pairs can ever diverge in this single-board league ' +
      'harness. Verified deterministically in ' +
      'server/src/engine/AMultiBoardNonFreerollIsPriced.law.test.ts and via dedicated paired ' +
      'multi-board NLH/PLO4 bomb-pot evaluation. What would change this: extending HorseLeague ' +
      'to deal double-board bomb-pot hands.',
  },
  {
    name: 'multiboard_bluff_trim_is_priced',
    variant: 'nlh',
    a: { multiBoardBluffTrimIsPriced: true },
    b: {},
    reason:
      'HorseLeague deals single-board hands only (boardCount: 1; no communityCards2 / ' +
      'communityCards3 or bomb-pot multi-board runouts), whereas multiBoardBluffTrimIsPriced ' +
      '(DEFAULT OFF, OPTION_SWITCH_REFUSED) is strictly scoped to multiBoard36 hands ' +
      '(nBoards36 >= 2) and is 100% byte-identical on every single-board hand, so 0 of 6,000 ' +
      'pairs can ever diverge in this single-board league harness. Verified deterministically in ' +
      'server/src/engine/AMultiBoardBluffTrimIsPriced.law.test.ts and via dedicated paired ' +
      'multi-board NLH/PLO4 bomb-pot evaluation. What would change this: extending HorseLeague ' +
      'to deal multi-board bomb-pot hands.',
  },
  {
    name: 'horse_run_it_twice_is_priced',
    variant: 'nlh',
    a: { horseRunItTwiceIsPriced: true },
    b: {},
    reason:
      'HorseLeague exercises HorseLogic.decide only and never runs all-in Run-It-Twice offers ' +
      'or ServerTableEngineRunout.horseRitRuns (nor does it change chip EV, which is identical ' +
      'across 1/2/3 runs because rake and BBJ are deducted once), whereas horseRunItTwiceIsPriced ' +
      '(DEFAULT OFF, OPTION_SWITCH_REFUSED) acts exclusively on main-thread all-in RIT offers via ' +
      'HorseRunItTwiceSwitch, so 0 of 6,000 pairs can ever diverge in this league harness. ' +
      'Verified deterministically in server/src/engine/HorseRunItTwicePriced.test.ts and via ' +
      'declared 20,431-decision replay in docs/horse-option-authority.d/horseRunItTwiceIsPriced.UNREGISTERED.md. ' +
      'What would change this: extending HorseLeague to run ServerTableEngineRunout RIT offers.',
  },
] as UnmeasurableMatchup[]);

for (const u of UNMEASURABLE_MATCHUPS) {
  if (LEAGUE_MATCHUPS.some((m) => m.name === u.name)) {
    throw new Error(`${u.name} is both on the card and in UNMEASURABLE_MATCHUPS`);
  }
}

/** The refused rows one league run writes before it deals (see
 *  UNMEASURABLE_MATCHUPS). Pure, so the shape the audit reads is pinned. */
export function refusedLeagueRows(runDate: string): Array<{
  run_date: string;
  matchup: string;
  hands: 0;
  bb100: 0;
  stderr: 0;
  status: 'refused';
  refusal_reason: string;
  config_a: Record<string, unknown>;
  config_b: Record<string, unknown>;
  duration_ms: 0;
  illegal_actions: 0;
  truncated_streets: 0;
}> {
  return UNMEASURABLE_MATCHUPS.map((u) => ({
    run_date: runDate,
    matchup: u.name,
    hands: 0,
    bb100: 0,
    stderr: 0,
    status: 'refused',
    refusal_reason: u.reason,
    config_a: leagueResultConfig(u, 'a'),
    config_b: leagueResultConfig(u, 'b'),
    duration_ms: 0,
    illegal_actions: 0,
    truncated_streets: 0,
  }));
}

// V12.3: the old comment here claimed hour 4 was "the quietest hour on the
// engine host". Measured over 24h of hand_history it is the SECOND BUSIEST
// (5354 hands vs 6239 at hour 3) — the fleet plays around the clock and there
// is no quiet hour. The league is safe here only because production dispatches
// every matchup and solver-agreement scan to HorseLeagueComputeWorker. The
// yield inside runMatchup remains the worker's cancellation/heartbeat edge;
// it is not permission to put this CPU loop back on the dealer thread.
//
// 2026-10-16: MOVED FROM 04:00 TO 13:00 UTC. Seven days of hand_history
// (2026-10-09 to 10-16, read-only) put the six quietest hours of the floor at
// 13:00-18:59 UTC (28,796-37,267 hands an hour, against 40,006-42,614 at
// 04:00-07:59 and 45,458 at the 23:00 peak). With every horse now deciding at
// the full sample (horseDecision/workerRuntime.ts), the league's one core of
// Monte Carlo competes with the decision workers for the same four physical
// cores, so both windows now sit in that quiet stretch (13:00 and 16:00, each
// with its three-hour catch-up), and every matchup also waits for the
// decision lane to be calm before it starts (decisionLaneHasHeadroom).
const LEAGUE_HOUR_UTC = 13;
// V13: was 30 minutes against a ONE-HOUR window, so any engine restart in the
// back half of the window pushed the next tick past it and the league silently
// did not run that day at all. This repo deploys many times a day; on
// 2026-08-23 a 04:32 restart moved the next tick to ~05:02 and the first
// nightly run was skipped with nothing reporting it. Ten minutes, plus the
// catch-up window below, closes that hole.
const LEAGUE_CHECK_MS = 10 * 60 * 1000;
/** Hours after LEAGUE_HOUR_UTC during which a missed run is still picked up. */
const LEAGUE_CATCHUP_HOURS = 3;
/** V23 (2026-08-28): a SECOND daily window. One 90-minute budget covers 4-6
 *  matchups against a ~30-matchup card — even staleness-first, a matchup got
 *  measured every ~5 nights and a new layer waited most of a week for its
 *  first read. The afternoon window doubles throughput: the staleness-first
 *  ordering naturally hands it the matchups the night window did not reach
 *  (their run_date is older), and (run_date, matchup) upserts make any
 *  overlap harmless. Claimed under its own job name so leader/standby pairs
 *  cannot both run it. */
const LEAGUE_PM_HOUR_UTC = 16;
/** Settle time before the boot check, so it never competes with table startup. */
const LEAGUE_BOOT_DELAY_MS = 90 * 1000;
// V12.3: raised 1500 -> 10000. At 1500 pairs the standard error was ~7 bb/100
// while real strategy-layer edges are single-digit bb/100 — the instrument
// could only ever detect catastrophic regressions, and its own header claimed
// it would catch a sign flip "within days". 10000 pairs puts the error near
// 2.8 bb/100. The cost is worker wall clock, not dealer responsiveness:
// production never executes runMatchup on the live engine event loop.
// 2026-08-27 (measured, not guessed): the 23-matchup card completed FOUR
// matchups in its 90-minute budget - roughly 22 minutes each at 10,000 pairs -
// so every V15/V16/V17/V18 layer went unmeasured while the four oldest
// matchups were re-measured for the fourth time. A card whose tail never runs
// is not a card. Two changes: a smaller default (stderr ~4.5 bb/100, still
// well inside layer-scale edges), and DAILY ROTATION so the starting index
// walks the list - every matchup is measured every few nights instead of the
// same head forever.
const PAIRS_PER_MATCHUP = 4000;
/** Wall-clock ceiling for a whole run. See the note in runLeague. */
const MAX_RUN_MS = 90 * 60 * 1000;
/**
 * Milliseconds left in the run window that `date`'s attempt belongs to.
 *
 * 2026-09-04: a partial card is resumable again (see alreadyRanToday), so the
 * per-ATTEMPT budget is no longer the only thing bounding a night. Each new
 * attempt would otherwise start a fresh 90 minutes, and with an engine that
 * restarts hourly that is an unbounded amount of league work on a host whose
 * event loop is the reason a matchup is slow in the first place. Clipping to
 * the window makes the night's total cost the window itself, which is what a
 * window is for.
 */
export function msLeftInRunWindow(now: Date = new Date()): number {
  const hour = now.getUTCHours();
  const startHour =
    hour >= LEAGUE_PM_HOUR_UTC && hour < LEAGUE_PM_HOUR_UTC + LEAGUE_CATCHUP_HOURS
      ? LEAGUE_PM_HOUR_UTC
      : LEAGUE_HOUR_UTC;
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    startHour + LEAGUE_CATCHUP_HOURS
  );
  return Math.max(0, end - now.getTime());
}

let leagueTimer: NodeJS.Timeout | null = null;
let leagueBootTimer: NodeJS.Timeout | null = null;
let lastLeagueDate: string | null = null;
let leagueRunning = false;
let lifecycleGeneration = 0;
let lifecycleActive = false;
let stopOperation: Promise<void> | null = null;
const inFlightRuns = new Set<Promise<void>>();

const lifecycleIsCurrent = (generation: number): boolean =>
  lifecycleActive && lifecycleGeneration === generation;

/**
 * V13.1 — WHY THIS CHECKS AT BOOT, NOT ONLY ON A TIMER.
 *
 * A setInterval is reset by every process restart, so a job whose interval is
 * longer than the gap between deploys NEVER FIRES. On 2026-08-23 the engine
 * restarted roughly every ten to twenty minutes all night (an active repo, and
 * every merge touching server/** redeploys), and the league's check simply
 * never survived to its first tick: 90 minutes after its window opened the
 * container logs contained not one league line. Widening the window did not
 * help, because the clock kept going back to zero.
 *
 * So the check now runs shortly AFTER BOOT as well. That makes a restart the
 * thing that triggers the run rather than the thing that prevents it.
 *
 * The in-memory `lastLeagueDate` cannot guard that on its own — it is empty
 * again after every restart — so the guard asks the DATABASE whether today's
 * run already happened. `horse_league_results` is keyed (run_date, matchup),
 * which makes it the authoritative record of what has been done.
 */

/**
 * V13.1: claim a night's work for exactly one engine instance. Returns true
 * when THIS process won the claim. The INSERT is the lock — a duplicate-key
 * violation means another instance got there first.
 *
 * Fails CLOSED on an unexpected error: if we cannot tell whether someone else
 * owns tonight, not running is the safe answer, because the other instance
 * almost certainly is. (The date guard below fails OPEN, deliberately — there,
 * nobody is holding the work and both writers upsert.)
 */
/**
 * A DEAD CLAIM MUST NOT BURN THE DAY (2026-08-28).
 *
 * MEASURED, on the day the PM window shipped. The 04:04 UTC league run
 * claimed 2026-08-28 and wrote ZERO rows: the engine container was recreated
 * at 04:06, two minutes in. The claim is the lock, so nothing retried, and
 * the AM slot was simply gone - the only reason that day has any measurement
 * at all is that the new 16:00 window happened to exist.
 *
 * Every ingredient of that failure is routine here. `server/**` merges deploy
 * automatically, the engine restarts several times a day, and a league run
 * takes ~20 minutes; a restart landing inside one is expected, not exotic.
 *
 * So a claim now carries a LIVENESS test: it owns the day only while it is
 * either fresh or has something to show for itself. A claim older than
 * CLAIM_STALE_MS whose job wrote no rows for that date is a crashed run, and
 * the next instance takes the work over by stamping its own name on the row.
 *
 * The takeover is a CONDITIONAL update - `.eq('claimed_by', dead.claimed_by)`
 * - so when two instances notice the same corpse simultaneously, exactly one
 * UPDATE matches and the loser stands down. That is the same
 * one-winner property the INSERT gives, applied to the second attempt.
 */
/*
 * 2026-09-01: was 60 minutes against a 3-hour window. The threshold only ever
 * bites when the claim wrote NOTHING (see claimNightlyJob: age AND no rows),
 * and at PAIRS_PER_MATCHUP=4000 a matchup completes in roughly nine minutes -
 * so a live run proves itself long before this. An hour of grace bought no
 * safety and cost most of the window: it left only two chances to notice a
 * corpse. Thirty minutes is still triple the measured first-row time, and a
 * mistaken takeover is harmless anyway - the (run_date, matchup) upsert makes
 * a duplicated matchup idempotent.
 */
const CLAIM_STALE_MS = 30 * 60 * 1000;

/**
 * Where each nightly job leaves its evidence.
 *
 * ── 2026-08-30, found by the daily analysis it was supposed to enable ──
 * This map used to hold only the two league jobs, with every other job
 * "asked to prove nothing". That sounds conservative. It is the opposite:
 * `claimNightlyJob` treats a null answer as "cannot be judged" and DECLINES
 * the takeover, so the liveness test above - the whole point of this block -
 * was switched off for exactly the jobs that had no other retry.
 *
 * What that cost, measured: 'daily_audit' claimed 2026-08-29 at 06:09 UTC and
 * the container was replaced mid-run. Nothing took it over, the orphaned claim
 * permanently satisfied the INSERT lock, and the day's audit did not exist
 * until an agent generated it by hand ~28 hours later. 'self_tuner' lost
 * 2026-08-26 the same way. The engine restarts several times a day
 * (RestartCount 7, six boots in 30h as this was written), so a restart inside
 * a job window is routine, not exotic - which is precisely the reasoning in
 * the comment above that this map failed to apply.
 *
 * A job belongs here the moment it writes a row somewhere. Anything genuinely
 * unjudgeable still returns null and keeps the old all-or-nothing claim.
 */
const CLAIM_EVIDENCE: Record<string, { table: string; column: string; dateColumn: string }> = {
  league: { table: 'horse_league_results', column: 'matchup', dateColumn: 'run_date' },
  league_pm: { table: 'horse_league_results', column: 'matchup', dateColumn: 'run_date' },
  daily_audit: { table: 'horse_daily_audit', column: 'day', dateColumn: 'day' },
  reference_agreement: {
    table: 'horse_reference_agreement_daily',
    column: 'day',
    dateColumn: 'day',
  },
  self_tuner: {
    table: 'horse_tuner_study_completions',
    column: 'run_date',
    dateColumn: 'run_date',
  },
};

/**
 * Jobs whose output row is PARTIAL progress rather than proof of completion.
 *
 * ── 2026-09-04, found by the daily audit three days running ──
 * Daily audit has one whole-output row. Self-tuner uses a separate completion
 * receipt after every eligible horse is recorded; an individual tune log is
 * partial progress and cannot close the night. A league row is ONE
 * MATCHUP out of 38. Treating it as delivery meant that the moment the first
 * matchup landed, the claim became permanently untakeable and the night was
 * over - which stopped mattering only in theory until the hourly maintenance
 * break landed on 2026-09-01 and started killing the engine at :55 of every
 * hour. A run that opens at 04:04 now has 51 minutes against a 90-minute
 * budget, so it is ALWAYS killed mid-card, and every night since has recorded
 * exactly one matchup, a stale card and a `nightly_job_lost` finding.
 *
 * For these jobs the honest question is not "did anything land" but "is this
 * claim still producing". A live run writes a matchup every 9-22 minutes; a
 * corpse writes nothing. So freshness, not existence, is the evidence - which
 * keeps the anti-duplicate protection the existence check was really giving
 * us (two league runs at once would double the load on an engine that is
 * already the reason a matchup takes 22 minutes).
 */
const CLAIM_EVIDENCE_IS_PARTIAL: Record<string, { timeColumn: string }> = {
  league: { timeColumn: 'created_at' },
  league_pm: { timeColumn: 'created_at' },
};

/**
 * ═══ A CLAIM FROM BEFORE THIS PROCESS BOOTED IS A CORPSE (2026-09-06) ═══
 *
 * MEASURED, from horse_job_runs and horse_league_results, by the 2026-09-05
 * daily analysis:
 *
 *   2026-09-05  league     claimed 06:56:50 (last takeover)  ZERO matchups
 *   2026-09-05  league_pm  claimed 18:56:38 (last takeover)  ZERO matchups
 *   2026-09-06  league     first matchup written 04:51, second 06:48 -
 *               117 minutes between two matchups that take 9-16 minutes.
 *
 * The engine restarts at :55 of every hour (CLAUDE.md 13), so the run that
 * opens at ~04:00 is killed at 04:55 with a matchup in flight. Its
 * replacement boots at ~04:58 and arrives here at ~05:00, where the thirty-
 * minute clock refuses it TWICE: the claim is still under CLAIM_STALE_MS, and
 * once it is not, the newest row (written at ~04:50 by the dead process) is
 * still "fresh". So every restart costs the league the in-flight matchup PLUS
 * up to thirty minutes of standing down in front of a corpse - roughly half
 * of every hour, and the whole of a window when a matchup is slow. That is
 * how a three-hour window produced nothing at all on 2026-09-05, twice.
 *
 * A clock was the wrong instrument. The calendar already answers: this engine
 * is ONE container, recreated on every deploy and every :55, and nothing
 * survives that recreation. A claim stamped before THIS process booted was
 * made by a process that no longer exists, and a row written before this
 * process booted proves nothing about anyone being alive now. So a claim that
 * predates the boot is taken over at the boot check, ninety seconds after the
 * restart, instead of thirty minutes later.
 *
 * The grace below is for the one shape that could be alive: a leader/standby
 * sibling that booted a little before this one and claimed at ITS boot check.
 * Two minutes covers any stagger a paired deploy has ever shown; the hourly
 * corpse is fifty-plus minutes older than that. A mistaken takeover is still
 * harmless - the (run_date, matchup) upsert makes a duplicated matchup
 * idempotent - so the grace is a courtesy to the sibling's CPU, not a lock.
 */
const PROCESS_BOOT_MS = Date.now() - Math.floor(process.uptime() * 1000);
const BOOT_CORPSE_GRACE_MS = 2 * 60 * 1000;
let bootMsOverride: number | null = null;
/** Tests only: pretend this process booted at `ms` (null restores the truth). */
export function __setProcessBootMsForTest(ms: number | null): void {
  bootMsOverride = ms;
}
const processBootMs = (): number => bootMsOverride ?? PROCESS_BOOT_MS;

/** Was this timestamp written by a process that cannot be alive any more? */
function predatesThisProcess(ms: number): boolean {
  return isFinite(ms) && ms < processBootMs() - BOOT_CORPSE_GRACE_MS;
}

/** Rows already written for this job+date - the proof a claim did work. */
async function claimProducedRows(job: string, date: string): Promise<boolean | null> {
  const evidence = CLAIM_EVIDENCE[job];
  if (evidence === undefined) return null;
  const partial = CLAIM_EVIDENCE_IS_PARTIAL[job];
  if (partial !== undefined) {
    // Still producing? Only the NEWEST row can answer that.
    const { data, error } = await supabase
      .from(evidence.table)
      .select(partial.timeColumn)
      .eq(evidence.dateColumn, date)
      .order(partial.timeColumn, { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const rows = data as unknown as Array<Record<string, string>> | null;
    const newest = rows?.[0]?.[partial.timeColumn];
    if (newest === undefined) return false; // nothing at all - a plain corpse
    const newestMs = Date.parse(newest);
    const ageMs = Date.now() - newestMs;
    if (!isFinite(ageMs)) return true; // unreadable stamp - do not take it over
    // A row from before this process booted was written by a process that is
    // gone. It is history, not a heartbeat - see the boot note above.
    if (predatesThisProcess(newestMs)) return false;
    return ageMs < CLAIM_STALE_MS; // fresh row = alive; stale row = abandoned
  }
  const { data, error } = await supabase
    .from(evidence.table)
    .select(evidence.column)
    .eq(evidence.dateColumn, date)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

export async function claimNightlyJob(job: string, date: string): Promise<boolean> {
  const me = process.env.HOSTNAME ?? 'engine';
  try {
    // THE CLAIM ASKS, IT DOES NOT COLLIDE (2026-11-26). A plain INSERT made
    // every losing claim a Postgres unique_violation: five ERROR lines and five
    // PostgREST 409s on horse_job_runs_pkey in the 24 hours to 2026-11-26
    // 21:45 UTC, each one the designed "somebody owns it" answer. ON CONFLICT
    // DO NOTHING keeps the primary key as the lock (exactly one INSERT wins)
    // and reports the loss as zero returned rows instead of an error.
    const { data: claimed, error } = await supabase
      .from('horse_job_runs')
      .upsert(
        { job, run_date: date, claimed_by: me },
        { onConflict: 'job,run_date', ignoreDuplicates: true }
      )
      .select('job');
    if (error) {
      const code = (error as { code?: string }).code;
      if (code !== '23505') throw new Error(error.message);
    } else if ((claimed?.length ?? 0) > 0) {
      return true;
    }

    // Somebody owns it. Is that owner alive?
    const { data: existing, error: readErr } = await supabase
      .from('horse_job_runs')
      .select('claimed_at, claimed_by')
      .eq('job', job)
      .eq('run_date', date)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) return false; // vanished under us - let the next tick retry

    const claimedAtMs = Date.parse(String(existing.claimed_at));
    const ageMs = isFinite(claimedAtMs) ? Date.now() - claimedAtMs : 0;
    // A claim stamped before this process booted belongs to a process that
    // no longer exists (the boot note above claimProducedRows). Its age on the
    // clock is irrelevant; only its evidence can still speak for it.
    const claimIsFromBeforeBoot = predatesThisProcess(claimedAtMs);
    if (ageMs < CLAIM_STALE_MS && !claimIsFromBeforeBoot) return false; // still plausibly working

    const produced = await claimProducedRows(job, date);
    if (produced !== false) return false; // it delivered, or cannot be judged

    // Snapshot the owner BEFORE the update: the row object may be a live
    // reference (a test double, a future client that returns the same
    // object), and reading it afterwards would report OUR name as the
    // corpse's - which is exactly the confusing message this line exists to
    // avoid emitting.
    const prevOwner = String(existing.claimed_by);
    const { data: taken, error: takeErr } = await supabase
      .from('horse_job_runs')
      .update({ claimed_by: me, claimed_at: new Date().toISOString() })
      .eq('job', job)
      .eq('run_date', date)
      .eq('claimed_by', prevOwner) // the race-loser matches nothing
      .select('job');
    if (takeErr) throw new Error(takeErr.message);
    if (!taken || taken.length === 0) return false;

    console.warn(
      `[HorseLeague] ${job} ${date} was claimed by ${prevOwner} ` +
        `${Math.round(ageMs / 60000)} min ago without completed output or fresh progress - taking it over. ` +
        (claimIsFromBeforeBoot
          ? `The claim predates this process's boot, so its owner is gone (a restart inside a run).`
          : `A restart inside a run is the usual cause.`)
    );
    return true;
  } catch (err) {
    reportError(err, 'HorseLeague.claimNightlyJob');
    return false;
  }
}

async function alreadyRanToday(date: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('horse_league_results')
      .select('matchup')
      .eq('run_date', date)
      .limit(LEAGUE_MATCHUPS.length * 2);
    if (error) throw new Error(error.message);
    /*
     * ── 2026-09-04: "any rows = done" is retired, and this comment with it ──
     *
     * The 2026-08-27 note below was right for the platform it was written on.
     * It said: with a rotating card the budget legitimately leaves the tail
     * unrun, so a run counts as done once ANY rows exist, and the ROTATION
     * (not a same-night retry) covers the rest. That reasoning depends on a
     * run getting its full 90-minute budget, which stopped being true on
     * 2026-09-01 when the engine began restarting at :55 of every hour. The
     * 04:00 window now yields at most 51 minutes before the process dies, and
     * this line then told the replacement the night was finished. Measured
     * result: 2026-09-02 and 2026-09-03 each recorded ONE matchup, the card
     * went stale, and the audit raised `nightly_job_lost` for 'league' both
     * days. Rotation cannot cover a tail when every night is one matchup long.
     *
     * So a partial card is resumable again. Runaway work is bounded by the
     * WINDOW rather than by this flag - see the budget clip in runLeague,
     * which stops a resumed attempt at the window edge.
     */
    const distinct = new Set((data ?? []).map((r) => (r as { matchup: string }).matchup));
    if (distinct.size < LEAGUE_MATCHUPS.length) return false;

    // A complete matchup card is not complete Phase 4 evidence when a
    // certified corpus is active. Require a same-day decision receipt bound
    // to that exact dataset; otherwise the catch-up window must retry the
    // agreement probe instead of latching the day as done.
    const { data: activeRows, error: activeError } = await supabase
      .from('gto_v31_datasets')
      .select('dataset_id,dataset_checksum')
      .eq('state', 'active')
      .limit(1);
    if (activeError) throw new Error(activeError.message);
    const active = (activeRows?.[0] ?? null) as {
      dataset_id: string;
      dataset_checksum: string;
    } | null;
    if (!active) return true;
    const { data: receipts, error: receiptError } = await supabase
      .from('horse_solver_agreement_v31_decisions')
      .select('source_seal')
      .eq('run_date', date)
      .eq('reference', 'gto_v31_certified')
      .limit(1);
    if (receiptError) throw new Error(receiptError.message);
    return (receipts ?? []).some((row) => {
      const seal = (row as { source_seal?: unknown }).source_seal;
      return (
        !!seal &&
        typeof seal === 'object' &&
        !Array.isArray(seal) &&
        (seal as Record<string, unknown>).dataset_id === active.dataset_id &&
        (seal as Record<string, unknown>).dataset_checksum === active.dataset_checksum
      );
    });
  } catch (err) {
    // Never let a failed lookup silently skip the night; the upsert on
    // (run_date, matchup) makes a duplicate run harmless.
    reportError(err, 'HorseLeague.alreadyRanToday');
    return false;
  }
}

let lastLeaguePmDate: string | null = null;

async function maybeRunLeague(generation: number): Promise<void> {
  if (!lifecycleIsCurrent(generation)) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours();
  const inWindow = hour >= LEAGUE_HOUR_UTC && hour < LEAGUE_HOUR_UTC + LEAGUE_CATCHUP_HOURS;
  const inPmWindow = hour >= LEAGUE_PM_HOUR_UTC && hour < LEAGUE_PM_HOUR_UTC + LEAGUE_CATCHUP_HOURS;
  if (leagueRunning) return;

  if (inWindow && lastLeagueDate !== today) {
    const alreadyRan = await alreadyRanToday(today);
    if (!lifecycleIsCurrent(generation)) return;
    if (alreadyRan) {
      lastLeagueDate = today; // remember for the rest of this process's life
      return;
    }
    // NOTE: lastLeagueDate is per-process, so a RESTARTED instance arrives
    // here with it empty and reaches the claim - which is exactly how a
    // crashed run gets taken over by its own replacement.

    // V13.1: leader/standby means TWO containers boot the full engine path and
    // both reach this line within seconds. Claim the night before working it.
    const claimed = await claimNightlyJob('league', today);
    if (!lifecycleIsCurrent(generation)) return;
    if (!claimed) {
      /*
       * DO NOT LATCH lastLeagueDate HERE (2026-09-01, measured).
       *
       * Standing down is not the same as settling the day. This line used to
       * latch the per-process "settled today" flag, and that single
       * assignment defeated the whole takeover mechanism below it:
       *
       *   04:04  instance A claims 'league' and starts the run.
       *   04:10  the container is replaced (server/** merges deploy, so this
       *          is routine). The run dies having written ZERO rows - the
       *          first matchup had not finished yet.
       *   04:12  the replacement boots, finds no rows, tries to claim, and is
       *          refused because the dead claim is only EIGHT MINUTES old and
       *          therefore judged "still plausibly working". It then latched
       *          lastLeagueDate = today and every 10-minute tick for the rest
       *          of the process's life returned immediately - including every
       *          tick after the claim went stale and became reclaimable.
       *
       * The window is three hours precisely so a corpse can be taken over
       * inside it. Latching on stand-down threw that away and cost the league
       * 2026-08-29, 2026-08-30 and 2026-09-01 - three days in four with a
       * claim row and no results, while nothing said so.
       *
       * Leaving the flag unset costs one extra claim probe per ten minutes
       * per standby, and buys a retry every ten minutes until either the run
       * lands rows (alreadyRanToday short-circuits above) or the stale claim
       * is taken over.
       */
      console.log(
        `[HorseLeague] run ${today} claimed by another instance - standing down, ` +
          `will re-check in ${Math.round(LEAGUE_CHECK_MS / 60000)} min in case that claim dies`
      );
      return;
    }
    /*
     * 2026-09-04: latch only when the day is genuinely FINISHED. This used to
     * be set before the run, which is the same defect PR #2628 fixed in
     * HorseDailyAudit and HorseSelfTuner: a run that dies leaves the flag
     * saying the day is settled, so no later tick inside the window can
     * resume it. With a partial card now resumable, latching here would undo
     * the entire fix above.
     */
    await runLeague(today, () => lifecycleIsCurrent(generation));
    if (!lifecycleIsCurrent(generation)) return;
    const completed = await alreadyRanToday(today);
    if (!lifecycleIsCurrent(generation)) return;
    if (completed) lastLeagueDate = today;
    return;
  }

  // V23 PM WINDOW: no alreadyRanToday here — the night run's rows exist by
  // design. The claim itself is the dedup (unique on job + run_date), and
  // the staleness-first card ordering serves the matchups the night window
  // left unmeasured.
  if (inPmWindow && lastLeaguePmDate !== today) {
    const claimed = await claimNightlyJob('league_pm', today);
    if (!lifecycleIsCurrent(generation)) return;
    if (!claimed) {
      // Same reasoning as the AM window above: standing down is not settling
      // the day, so the flag stays unset and the next tick re-checks.
      console.log(
        `[HorseLeague] pm run ${today} claimed by another instance - standing down, ` +
          `will re-check in ${Math.round(LEAGUE_CHECK_MS / 60000)} min in case that claim dies`
      );
      return;
    }
    /*
     * 2026-09-04: latch AFTER the run, not before it - the same defect PR
     * #2628 fixed in HorseDailyAudit and HorseSelfTuner. It is deliberately
     * NOT gated on alreadyRanToday: LeaguePmAndStraddle.test.ts pins that the
     * PM window never consults it, because the night run's rows exist by
     * design and the claim is the dedup here. Reaching this line at all means
     * runLeague returned rather than dying mid-card, and rows mean it did
     * real work; a run that produced nothing leaves the day open to retry.
     */
    const pmResults = await runLeague(today, () => lifecycleIsCurrent(generation));
    if (!lifecycleIsCurrent(generation)) return;
    if (pmResults.length > 0) lastLeaguePmDate = today;
  }
}

function launchMaybeRunLeague(): void {
  const generation = lifecycleGeneration;
  if (!lifecycleIsCurrent(generation) || inFlightRuns.size > 0) return;
  const tracked = maybeRunLeague(generation)
    .catch((err) => reportError(err, 'HorseLeague.tick'))
    .finally(() => inFlightRuns.delete(tracked));
  inFlightRuns.add(tracked);
}

async function drainRuns(): Promise<void> {
  while (inFlightRuns.size > 0) await Promise.allSettled([...inFlightRuns]);
}

export function startHorseLeague(): void {
  if (leagueTimer) return;
  lifecycleActive = true;
  lifecycleGeneration += 1;
  stopOperation = null;
  leagueTimer = setInterval(launchMaybeRunLeague, LEAGUE_CHECK_MS);
  leagueTimer.unref?.();
  // Boot check, after a short settle so it never competes with table startup.
  leagueBootTimer = setTimeout(() => {
    leagueBootTimer = null;
    launchMaybeRunLeague();
  }, LEAGUE_BOOT_DELAY_MS);
  leagueBootTimer.unref?.();
}

export function stopHorseLeague(): Promise<void> {
  if (stopOperation) return stopOperation;
  lifecycleActive = false;
  lifecycleGeneration += 1;
  if (leagueTimer) {
    clearInterval(leagueTimer);
    leagueTimer = null;
  }
  if (leagueBootTimer) clearTimeout(leagueBootTimer);
  leagueBootTimer = null;
  stopOperation = drainRuns();
  return stopOperation;
}

class RequiredV31AgreementError extends Error {
  override readonly name = 'RequiredV31AgreementError';
}

/**
 * THE LEAGUE NEVER TAKES A CORE FROM A HORSE THAT IS WAITING (2026-10-16).
 *
 * The league's compute process runs at nice 19 inside the engine container,
 * so the kernel preempts it whenever a live thread wants its core. That is not
 * enough on this host: four physical cores carry eight hyperthreads, and a
 * league matchup on one thread slows the decision worker on its sibling. On
 * 2026-10-16 at 17:20Z (the PM window) the lane's oldest queued decision was
 * six seconds old while the league process held 99% of a core for 72 minutes.
 *
 * So a matchup starts only while the decision lane is calm: its oldest queued
 * DECISION job (DECIDE_FAST, DECIDE_DEEP, DECIDE_DISCARD) is at most
 * LEAGUE_LANE_MAX_QUEUED_AGE_MS old. Observation, effect and mirrored-hand
 * jobs are not a horse waiting: every completed hand is mirrored to every
 * shard (horseDecision/mindMirror.ts), and gating on the age of THAT traffic
 * would starve the league on a busy floor while no horse was waiting at all. Otherwise the run stands
 * down with what it has (a partial card is resumable, see alreadyRanToday)
 * and the next ten-minute tick inside the window tries again. A process with
 * no live lane (tests, offline tools) has nothing to protect; a lane that is
 * starting, failing or stopping is never a calm one.
 */
export const LEAGUE_LANE_MAX_QUEUED_AGE_MS = 1_000;

export function decisionLaneHasHeadroom(
  status: Pick<
    LiveHorseDecisionLaneStatus,
    'phase' | 'oldestQueuedDecisionAgeMs'
  > = liveHorseDecisionWorkerStatus()
): boolean {
  if (status.phase === 'stopped') return true;
  if (status.phase !== 'ready') return false;
  return (status.oldestQueuedDecisionAgeMs ?? 0) <= LEAGUE_LANE_MAX_QUEUED_AGE_MS;
}

export async function runLeague(
  runDate?: string,
  shouldContinue: () => boolean = () => true,
  computeFactory: () => HorseLeagueCompute = () => new HorseLeagueComputeWorkerClient(),
  laneHasHeadroom: () => boolean = () => decisionLaneHasHeadroom()
): Promise<LeagueResult[]> {
  if (leagueRunning) return [];
  leagueRunning = true;
  let compute: HorseLeagueCompute | null = null;
  const date = runDate ?? new Date().toISOString().slice(0, 10);
  const results: LeagueResult[] = [];
  const startedAt = Date.now();
  // Whichever runs out first: this attempt's own budget, or the window.
  const runBudgetMs = Math.min(MAX_RUN_MS, msLeftInRunWindow());
  let requiresV31Agreement = false;
  // V13: SAY THAT IT STARTED. Rows are only written as each worker matchup
  // finishes, so a run in progress and a run that never began would otherwise
  // remain indistinguishable from outside.
  // DAILY ROTATION (2026-08-27): start the card at a different index each
  // day so the budget cannot permanently starve the tail. Deterministic from
  // the run date, so a re-run of the same date repeats the same order.
  const dayIndex = Math.floor(Date.parse(date) / 86_400_000);
  const rotateBy =
    ((dayIndex % LEAGUE_MATCHUPS.length) + LEAGUE_MATCHUPS.length) % LEAGUE_MATCHUPS.length;
  let card = LEAGUE_MATCHUPS.slice(rotateBy).concat(LEAGUE_MATCHUPS.slice(0, rotateBy));
  // STALENESS-FIRST (2026-08-27, Phase 2): rotation alone walks the start
  // index by ONE per night while the budget covers ~4-6 matchups, so a new
  // layer's matchup could wait a week for its first measurement — and the
  // v16_ratio decision needs THREE significant runs. Order the card by how
  // long each matchup has gone unmeasured (never-run first, then oldest),
  // with the rotation order as the deterministic tie-break. The DB is the
  // authority on what has been measured; if it cannot answer, rotation alone
  // still runs the night.
  try {
    const { data, error } = await supabase
      .from('horse_league_results')
      .select('matchup, run_date')
      .order('run_date', { ascending: false })
      .limit(2000);
    if (!error && data) {
      const lastRun = new Map<string, string>();
      for (const r of data as Array<{ matchup: string; run_date: string }>) {
        if (!lastRun.has(r.matchup)) lastRun.set(r.matchup, r.run_date);
      }
      const pos = new Map(card.map((m, i) => [m.name, i]));
      card = card
        .slice()
        .sort(
          (a, b) =>
            (lastRun.get(a.name) ?? '0000').localeCompare(lastRun.get(b.name) ?? '0000') ||
            pos.get(a.name)! - pos.get(b.name)!
        );
    }
  } catch {
    /* staleness ordering is best-effort — rotation already covers the night */
  }
  console.log(
    `[HorseLeague] run ${date} starting: ${card.length} matchups x ` +
      `${PAIRS_PER_MATCHUP} pairs (budget ${Math.round(runBudgetMs / 60000)} min ` +
      `of a possible ${Math.round(MAX_RUN_MS / 60000)}, clipped to the window), ` +
      `rotation offset ${rotateBy} -> first up ${card[0]?.name}`
  );
  try {
    if (!shouldContinue()) return results;
    // UNMEASURABLE MATCHUPS SAY SO EVERY RUN (2026-10-31). Written before the
    // first hand and before the lane check: a refusal costs no compute, and it
    // is the row the audit reads when it decides a layer the card cannot
    // measure. Idempotent on (run_date, matchup), so the pm run and a resumed
    // card rewrite the same rows.
    try {
      const { error } = await supabase
        .from('horse_league_results')
        .upsert(refusedLeagueRows(date) as never, { onConflict: 'run_date,matchup' });
      if (error) throw new Error(error.message);
    } catch (err) {
      reportError(err, 'HorseLeague.refused');
    }
    if (!shouldContinue()) return results;
    // CAPACITY ROOT FIX (2026-09-08): this is the only compute lane the
    // production league may use. The old path executed 32 complete synthetic
    // hands between yields on the same event loop as table clocks, WebSockets
    // and lease heartbeats. At the first 10-minute tick after the 03:55 engine
    // restart, production moved from scale=1 / p50=20ms to scale=0.2 /
    // p50=640ms while ~300 tables were live. The tick and the cliff were the
    // same second. A dedicated worker keeps the exact seeded simulator and
    // its HorseMind sandbox intact on another core. There is deliberately no
    // sync fallback: failed analysis is retried from its durable claim;
    // delaying live poker to finish a benchmark is never an allowed fallback.
    // Booting the compute process hydrates a whole solver corpus: not while
    // a horse is waiting for its decision either.
    if (!laneHasHeadroom()) {
      console.log(
        `[HorseLeague] run ${date} not starting: the live decision lane has a decision waiting ` +
          `more than ${LEAGUE_LANE_MAX_QUEUED_AGE_MS} ms; the next tick in the window tries again`
      );
      return results;
    }
    compute = computeFactory();
    const solverStores = await compute.ready();
    requiresV31Agreement = solverStores.postflopV31 > 0;
    if (!shouldContinue()) return results;
    // ═══ V47 SOLVER AGREEMENT (2026-09-05) ═══════════════════════════════
    // The matchups below measure a DIFFERENCE between two configs. This is
    // the absolute score, against the only reference in the building: the
    // hold'em push/fold charts. It costs a few hundred worker decisions once a
    // night, and it is the one number that can say the brain got WORSE without
    // another config to compare it to.
    //
    // IT RUNS FIRST (2026-09-06). It used to run after the card, and the
    // card never ends: the engine restarts at :55 of every hour, a matchup
    // in flight dies with it, and the loop below is killed before it returns
    // on every attempt that does not run out of budget first. Measured by
    // the 2026-09-05 daily analysis: horse_solver_agreement had ZERO rows,
    // ever - the audit's `data_stale` and `solver_agreement_missing` findings
    // were both this ordering. Putting them before the hours-long part means
    // the one number
    // that needs no second config exists on every night the league is even
    // attempted. fn_horse_solver_agreement_add upserts on (run_date,
    // reference), so a resumed card re-scores the same day harmlessly.
    try {
      const agreement = await compute.scoreSolverAgreement();
      if (agreement.reference) {
        const { error } = await supabase.rpc('fn_horse_solver_agreement_add', {
          p_rows: [
            {
              run_date: date,
              reference: agreement.reference,
              spots: agreement.spots,
              agreement: round4(agreement.agreement),
              pure_misses: agreement.pureMisses,
              eligible_spots: agreement.eligibleSpots,
              reconciled_spots: agreement.reconciledSpots,
              action_regret_bb: agreement.actionRegretBb,
              regret_eligible_spots: agreement.regretEligibleSpots,
              decision_checksum: agreement.decisionChecksum,
              decisions: agreement.decisions.map((decision) => ({
                state_key: decision.stateKey,
                decision_state: {
                  schema_version: decision.decisionState.schemaVersion,
                  stage: decision.decisionState.stage,
                  game_variant: decision.decisionState.gameVariant,
                  game_type: decision.decisionState.gameType,
                  format: decision.decisionState.format,
                  kind: decision.decisionState.kind,
                  position: decision.decisionState.position,
                  stack_bb: decision.decisionState.stackBb,
                  hand: decision.decisionState.hand,
                  chart: decision.decisionState.chart,
                  villain_action: decision.decisionState.villainAction,
                  legal_actions: decision.decisionState.legalActions,
                },
                kind: decision.kind,
                game_type: decision.gameType,
                position: decision.position,
                stack_bb: decision.stackBb,
                hand: decision.hand,
                final_action: decision.finalAction,
                reference_distribution: decision.referenceDistribution,
                chosen_probability: decision.chosenProbability,
                action_regret_bb: decision.actionRegretBb,
                regret_eligible: decision.regretEligible,
                pure_miss: decision.pureMiss,
                source_seal: {
                  quality_seal: decision.sourceSeal.qualitySeal,
                  policy_version: decision.sourceSeal.policyVersion,
                  policy_checksum: decision.sourceSeal.policyChecksum,
                  system: decision.sourceSeal.system,
                  artifact_id: decision.sourceSeal.artifactId,
                  scenario_hash: decision.sourceSeal.scenarioHash,
                  source_artifact_checksum: decision.sourceSeal.sourceArtifactChecksum,
                  provenance_complete: decision.sourceSeal.provenanceComplete,
                  audited_at: decision.sourceSeal.auditedAt,
                },
              })),
            },
          ],
        });
        if (!shouldContinue()) return results;
        if (error) throw new Error(error.message);
        console.log(
          `[HorseLeague] solver agreement ${round4(agreement.agreement)} over ${agreement.spots} ` +
            `spots (${agreement.pureMisses} pure misses)`
        );
      } else {
        console.log('[HorseLeague] solver agreement skipped - the chart store is empty here');
      }
    } catch (err) {
      reportError(err, 'HorseLeague.agreement');
    }

    if (!shouldContinue()) return results;
    // PHASE 4 CERTIFIED V31 AGREEMENT. The chart score above is preflop-only
    // and cannot prove that the promoted postflop corpus is being selected,
    // legalized, or reconciled. This second probe drives deterministic hands
    // through the ordinary active V31 path and persists its own reference row
    // plus every regret/source-seal decision receipt.
    try {
      const agreement = await compute.scoreGtoV31Agreement(undefined, shouldContinue);
      if (!shouldContinue()) return results;
      if (agreement.reference) {
        const { error } = await supabase.rpc('fn_horse_solver_agreement_add', {
          p_rows: [
            {
              run_date: date,
              reference: agreement.reference,
              spots: agreement.spots,
              agreement: round4(agreement.agreement),
              pure_misses: agreement.pureMisses,
              eligible_spots: agreement.eligibleSpots,
              reconciled_spots: agreement.reconciledSpots,
              action_regret_bb: agreement.actionRegretBb,
              regret_eligible_spots: agreement.regretEligibleSpots,
              decision_checksum: agreement.decisionChecksum,
              decisions: agreement.decisions.map((decision) => ({
                state_key: decision.stateKey,
                decision_state: {
                  schema_version: decision.decisionState.schemaVersion,
                  street: decision.decisionState.street,
                  game_variant: decision.decisionState.gameVariant,
                  game_family: decision.decisionState.gameFamily,
                  objective: decision.decisionState.objective,
                  utility_context: decision.decisionState.utilityContext,
                  format: decision.decisionState.format,
                  table_size: decision.decisionState.tableSize,
                  pot_type: decision.decisionState.potType,
                  hero_position: decision.decisionState.heroPosition,
                  opponent_position: decision.decisionState.opponentPosition,
                  stack_bb: decision.decisionState.stackBb,
                  depth_bucket: decision.decisionState.depthBucket,
                  texture_class: decision.decisionState.textureClass,
                  node_role: decision.decisionState.nodeRole,
                  facing_kind: decision.decisionState.facingKind,
                  facing_size_bucket: decision.decisionState.facingSizeBucket,
                  hand: decision.decisionState.hand,
                  hand_key: decision.decisionState.handKey,
                  cell: decision.decisionState.cell,
                  board: decision.decisionState.board,
                  hole_cards: decision.decisionState.holeCards,
                  pot: decision.decisionState.pot,
                  current_bet: decision.decisionState.currentBet,
                  to_call: decision.decisionState.toCall,
                  big_blind: decision.decisionState.bigBlind,
                  probe_scenario: decision.decisionState.probeScenario,
                  probe_ordinal: decision.decisionState.probeOrdinal,
                  sampled_action_id: decision.decisionState.sampledActionId,
                  sampled_action_family: decision.decisionState.sampledActionFamily,
                  sampled_amount: decision.decisionState.sampledAmount,
                  final_action: decision.decisionState.finalAction,
                  final_amount: decision.decisionState.finalAmount,
                  executed_as_intended: decision.decisionState.executedAsIntended,
                },
                stage: decision.stage,
                game_family: decision.gameFamily,
                objective: decision.objective,
                utility_context: decision.utilityContext,
                table_size: decision.tableSize,
                pot_type: decision.potType,
                hero_position: decision.heroPosition,
                opponent_position: decision.opponentPosition,
                depth_bucket: decision.depthBucket,
                texture_class: decision.textureClass,
                node_role: decision.nodeRole,
                facing_kind: decision.facingKind,
                facing_size_bucket: decision.facingSizeBucket,
                cell: decision.cell,
                hand_key: decision.handKey,
                sampled_action_id: decision.sampledActionId,
                sampled_action_family: decision.sampledActionFamily,
                final_action: decision.finalAction,
                executed_as_intended: decision.executedAsIntended,
                reference_distribution: decision.referenceDistribution,
                chosen_probability: decision.chosenProbability,
                action_regret_bb: decision.actionRegretBb,
                regret_eligible: decision.regretEligible,
                pure_miss: decision.pureMiss,
                source_seal: decision.sourceSeal,
              })),
            },
          ],
        });
        if (!shouldContinue()) return results;
        if (error) throw new Error(error.message);
        console.log(
          `[HorseLeague] certified V31 agreement ${round4(agreement.agreement)} over ` +
            `${agreement.spots} spots (${agreement.pureMisses} pure misses, ` +
            `${agreement.regretEligibleSpots} regret-eligible)`
        );
      } else {
        if (requiresV31Agreement) {
          throw new Error('the active certified V31 store returned no agreement reference');
        }
        console.log('[HorseLeague] certified V31 agreement skipped - the active store is empty');
      }
    } catch (err) {
      reportError(err, 'HorseLeague.agreement.v31');
      if (requiresV31Agreement) {
        throw new RequiredV31AgreementError(
          err instanceof Error ? err.message : 'certified V31 agreement failed'
        );
      }
    }

    const runSeed = (Date.parse(date) / 86_400_000) >>> 0;
    for (const m of card) {
      if (!shouldContinue()) break;
      if (!laneHasHeadroom()) {
        console.log(
          `[HorseLeague] run ${date} standing down after ${results.length}/${card.length} ` +
            `matchups: the live decision lane has a decision waiting more than ` +
            `${LEAGUE_LANE_MAX_QUEUED_AGE_MS} ms; the next tick in the window resumes the card`
        );
        break;
      }
      // V13: a wall-clock budget. Even isolated analysis must not consume a
      // host core across the next run window. Stop cleanly and keep what
      // completed; partial results are still valid measurements.
      if (Date.now() - startedAt > runBudgetMs) {
        console.warn(
          `[HorseLeague] run ${date} hit its ${Math.round(runBudgetMs / 60000)}-minute budget ` +
            `after ${results.length}/${card.length} matchups - stopping cleanly. ` +
            `Unrun tonight: ${card
              .slice(results.length)
              .map((x) => x.name)
              .join(', ')} (they lead tomorrow's rotation)`
        );
        break;
      }
      const r = await compute.runMatchup(
        m,
        m.pairs ?? PAIRS_PER_MATCHUP,
        runSeed ^ hash32(m.name),
        shouldContinue
      );
      if (!shouldContinue()) break;
      results.push(r);
      try {
        const { error } = await supabase.from('horse_league_results').upsert(
          {
            run_date: date,
            matchup: r.matchup,
            hands: r.hands,
            bb100: round2(r.bb100),
            stderr: round2(r.stderr),
            // Persist the worker verdict before storage rounding: an inert
            // experiment is not a measured zero. Clear stale reasons on rerun.
            status: r.inert === true ? 'inert' : 'measured',
            refusal_reason:
              r.inert === true
                ? `Inert experiment: ${r.divergentPairs ?? 'unknown'} of ${r.hands / 2} ` +
                  `pairs diverged; paired stderr ${r.stderr}. Zero divergence or ` +
                  `zero variance is not a measurement.`
                : null,
            // A human-field card records its field here (leagueResultConfig);
            // a mirror card's configs are written exactly as before.
            config_a: leagueResultConfig(m, 'a') as never,
            config_b: leagueResultConfig(m, 'b') as never,
            duration_ms: r.durationMs,
            // Illegal sizings only. Truncated streets have their own column
            // and the audit judges them on their own (2026-11-05).
            illegal_actions: r.illegalActions,
            truncated_streets: r.truncatedStreets,
            harness_corrected_actions: r.correctedActions ?? null,
            brain_exception_fallbacks: r.brainExceptionFallbacks ?? null,
            engine_sha:
              process.env.GIT_COMMIT_SHA?.trim() || process.env.ENGINE_VERSION?.trim() || null,
            candidate_policy_hits: r.candidatePolicyHits,
            candidate_execution_mismatches: r.candidateExecutionMismatches,
            candidate_node_roles: r.candidateNodeRoles,
            candidate_benchmark_components: leagueStoredComponents(r) as never,
          },
          { onConflict: 'run_date,matchup' }
        );
        if (!shouldContinue()) break;
        if (error) throw new Error(error.message);
      } catch (err) {
        reportError(err, 'HorseLeague.write');
      }
      if (r.inert === true) {
        // The row is still written above so the audit can see the shape, but
        // it is a harness FAILURE, not a resolved zero, and it is reported
        // through the same channel every other league fault uses.
        reportError(
          new Error(
            `[HorseLeague] ${r.matchup} is INERT: ${r.hands} hands, ${r.divergentPairs} of ` +
              `${r.hands / 2} pairs diverged between config A and config B, stderr ` +
              `${round2(r.stderr)}. The flag under test changed no measurable decision; ` +
              `0.00 +/- 0.00 is not a measurement.`
          ),
          'HorseLeague.inert',
          {
            matchup: r.matchup,
            hands: r.hands,
            config_a: leagueResultConfig(m, 'a'),
            config_b: leagueResultConfig(m, 'b'),
          }
        );
      }
      console.log(
        `[HorseLeague] ${r.matchup}: ${round2(r.bb100)} bb/100 (se ${round2(r.stderr)}) ` +
          `${
            r.inert === true
              ? 'INERT'
              : Math.abs(r.bb100) > 2 * r.stderr
                ? 'SIGNIFICANT'
                : 'not resolved'
          } over ` +
          `${r.hands} hands in ${r.durationMs}ms, illegal=${r.illegalActions}, ` +
          `truncated=${r.truncatedStreets}, divergent=${r.divergentPairs ?? 'n/a'}`
      );
      // Yield the event loop between matchups — production tables come first.
      await new Promise((res) => setTimeout(res, 250));
    }

    console.log(
      `[HorseLeague] run ${date} finished: ${results.length}/${LEAGUE_MATCHUPS.length} matchups ` +
        `in ${Math.round((Date.now() - startedAt) / 1000)}s`
    );
  } catch (err) {
    reportError(err, 'HorseLeague.run');
    lastLeagueDate = null;
    if (err instanceof RequiredV31AgreementError) throw err;
  } finally {
    if (compute) {
      try {
        await compute.shutdown();
      } catch (err) {
        reportError(err, 'HorseLeague.compute_worker_shutdown');
      }
    }
    leagueRunning = false;
  }
  return results;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function hash32(s: string): number {
  let h = 17;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
