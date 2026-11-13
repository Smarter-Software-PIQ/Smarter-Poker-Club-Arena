/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HORSE OPPONENT STYLE (2026-11-13, v2) - how an opponent plays, from what was
 * measured at decision time, for every game and both formats.
 * ═══════════════════════════════════════════════════════════════════════════
 * Owner, 2026-11-12 23:36 to 2026-11-13 00:23 Chicago: Horses must never treat
 * every human as overly aggressive; they read the player in front of them in
 * real time and adjust against tight and value-heavy players as well as against
 * maniacs, in cash and in tournaments, in every variant; all humans get a style
 * label. 'Raises more than Horses' is not 'maniac'; a passive group losing does
 * not prove passive play is defective; unknown is neutral AND explicitly
 * uncertain. The shared contract is STYLE-READ-CONTRACT.md (beside the plan).
 *
 * ONE PURE FUNCTION. classifyOpponentStyle takes the decayed per-domain exploit
 * counters (HorseOpponentExploit.ExploitCounters: one row per player x game x
 * cash-or-tournament x table size, with the fast window) and the lifetime
 * tallies the legacy read keeps, and returns:
 *
 *   PARTICIPATION  loose (+1) to tight (-1): VPIP and the limp / cold-call share
 *                  (VPIP minus PFR), against the Horse mean of this game and
 *                  table size. How often he ENTERS a pot.
 *   AGGRESSION     aggressive (+1) to passive (-1): PFR, three-bets PER
 *                  OPPORTUNITY (never over all hands), bet frequency when
 *                  checked to, and the postflop bet-and-raise share of actions.
 *                  How often he BETS or RAISES once in. A player can enter many
 *                  pots and bet selectively; the two are separate.
 *   BETTING-RANGE EVIDENCE  value-weighted (+1) to bluff-weighted (-1): built
 *                  from MEASURABLE features only (raise and bet frequency per
 *                  opportunity, revealed hand strength at showdown, probe share
 *                  as the sizing bucket) with an OBSERVATION AVAILABILITY
 *                  discount for showdown selection bias. It is evidence about
 *                  what his bets have turned out to be, never a trait called
 *                  'honesty'.
 *
 * and a label (maniac, loose-aggressive, loose-passive, tight-aggressive,
 * tight-passive, value-heavy-passive, balanced, unknown) for TELEMETRY ONLY.
 * Decisions consume the axes, confidences and the release fraction, never the
 * label.
 *
 * THE STATES OF "I DO NOT KNOW" ARE FOUR, AND ARE NEVER COLLAPSED:
 *   (a) evidence.state 'no_reliable_individual_evidence': fewer than 15 decayed
 *       hands (or nothing at all). Neutral: every axis 0, every side null,
 *       adjustment 0, uncertain true, protective logic stays armed. The read is
 *       never "aggressive until proven otherwise" and never "passive until
 *       proven otherwise".
 *   (b) evidence.populationPrior: a population prior with its own stated
 *       uncertainty, a SEPARATE field, weight bounded to a small fraction of
 *       any consumer's maximum adjustment, shrinking to zero as individual
 *       evidence accrues, never reported as a measured individual trait, never
 *       able to disable protective logic or switch a layer off. No measured
 *       human prior exists yet: the shipped prior is 'none_measured' (shifts 0).
 *   (c) evidence.state 'supported_individual_read': 15+ decayed hands in THIS
 *       format; sides are called only where the posterior credibly clears the
 *       Horse mean plus a margin (90% one-sided).
 *   (d) TACTICAL aggression (describeTactical): a feature of the SITUATION (a
 *       river raise, a short stack-to-pot ratio), never a trait of the player.
 *       It is never folded into the axes.
 *
 * FORMAT-SPECIFIC BY DEFAULT. A player who is tighter in tournaments tells us
 * nothing about everyone else. Cross-format carry-over exists as an option whose
 * weight defaults to ZERO (STYLE_THRESHOLDS.carryWeight); any non-zero weight
 * needs validation (and carries the uncertainty) before it is switched on.
 *
 * DECISION-TIME INPUTS ONLY. The classifier reads counters and tallies that
 * existed at the decision (what had been observed in earlier hands). It imports
 * no hand evaluator and never sees a hole card of the hand in flight; a law test
 * pins both. Retrospective hole-card analysis (the audit fixtures) is test
 * evidence, not classifier input.
 *
 * PROPORTIONAL RELEASE, NEVER A RESET. A low-side read is weakened in
 * proportion to how credibly the fast window (8-hand half-life) or the recent
 * aggression window shows him raising or betting above the Horse mean: the
 * value-weighted evidence is multiplied by (1 - release.fraction), bluff
 * evidence rises with it, confidence falls, and consumers stand down entirely
 * from release.standDownFraction. One observed bluff does not erase the earlier
 * evidence (the showdown tallies keep it in proportion); a hundred do.
 *
 * SHOWDOWN SELECTION BIAS. Called bets reveal strength; bets that won the pot
 * or folded the field do not. The shown strength of his big river bets is
 * therefore NEVER generalised to all his betting: it is discounted by an
 * availability factor (revealed big river bets against all his postflop
 * bets and raises), capped below full weight, and consumers use it only for the
 * class it was measured on (large river bets). Raises and turn bets read the
 * frequency evidence only, at half weight.
 *
 * PURE. No random draws, no clock, no telemetry, no writes, no import of the
 * decision engine. Same inputs, same output, frozen. Every output carries a
 * receipt for telemetry. EXPLOIT_SIDES and OpponentExploitRead are untouched:
 * the Omaha presumption and about twenty Omaha call sites read those; the low
 * side lives HERE and arrives as a separate field or function.
 *
 * VARIANT PARAMETER SETS. Hold'em, Short Deck, PLO4, PLO5, PLO6 and the other
 * Omaha games have separate parameter sets (STYLE_FAMILY_PARAMS). Only the
 * hold'em family has consumers here; Omaha reads classify but every consumer
 * helper returns "no adjustment" (the PLO lane owns the Omaha consumers).
 *
 * ALL THRESHOLDS ARE IN STYLE_THRESHOLDS / STYLE_FAMILY_PARAMS so they can be
 * calibrated against HUMAN-STYLE-LABELS.md (absent when this was written) and
 * validated on held-out evidence without touching logic.
 */
import {
  EXPLOIT_COUNTER_FIELDS,
  EXPLOIT_FAST_MIN_N,
  EXPLOIT_PRIOR_STRENGTH,
  OPPONENT_EXPLOIT_ENVELOPE_VERSION,
  betaCdf,
  exploitEnvelopeFor,
  type ExploitCounters,
  type ExploitEnvelopeCell,
} from './HorseOpponentExploit.js';
import type { ReadScope } from './HorseMind.js';

export const OPPONENT_STYLE_VERSION = 'opponent-style-v2' as const;

export type StyleDomain = 'cash' | 'tournament';

export const STYLE_LABELS = [
  'maniac',
  'loose-aggressive',
  'loose-passive',
  'tight-aggressive',
  'tight-passive',
  'value-heavy-passive',
  'balanced',
  'unknown',
] as const;
export type StyleLabel = (typeof STYLE_LABELS)[number];

// ─────────────────────────────────────────────────────────────────────────
// VARIANT PARAMETER SETS
// ─────────────────────────────────────────────────────────────────────────

export type StyleFamily = 'holdem' | 'sixplus' | 'plo4' | 'plo5' | 'plo6' | 'omaha_other';

export interface StyleFamilyParams {
  readonly family: StyleFamily;
  /** the consumers in this module may act on this family (hold'em lane only) */
  readonly consumers: boolean;
  /** true when the numbers below were measured for this family */
  readonly calibrated: boolean;
  /** Horse postflop bet-and-raise share of actions, or null when not measured for the family
   *  (the aggression-share statistic is then not read at all) */
  readonly horsePostflopAggressionShare: number | null;
  /** multiplies every margin a side must clear (wider margin = harder to call a side) */
  readonly marginScale: number;
  /** shown big river bets before the shown-strength read engages */
  readonly bigBetMinShown: number;
  readonly note: string;
}

/**
 * Hold'em: the Horse postflop aggression factor sits at ~2.43 (HorseMind
 * legacyExploit, V83), a bet-and-raise share of 2.43 / 3.43. The Omaha and Short
 * Deck numbers are PLACEHOLDERS ordered by hole-card count (wider margins,
 * later engagement, no aggression-share statistic) until the PLO lane measures
 * them; they are deliberately NOT the hold'em values.
 */
export const STYLE_FAMILY_PARAMS: Readonly<Record<StyleFamily, StyleFamilyParams>> = Object.freeze({
  holdem: Object.freeze({
    family: 'holdem',
    consumers: true,
    calibrated: true,
    horsePostflopAggressionShare: 2.43 / (1 + 2.43),
    marginScale: 1,
    bigBetMinShown: 3,
    note: 'AF 2.43 from HorseMind.legacyExploit; margins CALIBRATE against HUMAN-STYLE-LABELS.md',
  }),
  sixplus: Object.freeze({
    family: 'sixplus',
    consumers: false,
    calibrated: false,
    horsePostflopAggressionShare: null,
    marginScale: 1.5,
    bigBetMinShown: 4,
    note: 'placeholder, not measured; no consumer',
  }),
  plo4: Object.freeze({
    family: 'plo4',
    consumers: false,
    calibrated: false,
    horsePostflopAggressionShare: null,
    marginScale: 1.5,
    bigBetMinShown: 5,
    note: 'placeholder for the PLO lane to calibrate; classifier only',
  }),
  plo5: Object.freeze({
    family: 'plo5',
    consumers: false,
    calibrated: false,
    horsePostflopAggressionShare: null,
    marginScale: 1.75,
    bigBetMinShown: 5,
    note: 'placeholder for the PLO lane to calibrate; classifier only',
  }),
  plo6: Object.freeze({
    family: 'plo6',
    consumers: false,
    calibrated: false,
    horsePostflopAggressionShare: null,
    marginScale: 2,
    bigBetMinShown: 6,
    note: 'placeholder for the PLO lane to calibrate; classifier only',
  }),
  omaha_other: Object.freeze({
    family: 'omaha_other',
    consumers: false,
    calibrated: false,
    horsePostflopAggressionShare: null,
    marginScale: 1.75,
    bigBetMinShown: 5,
    note: 'PLO8 / FLO8 placeholder for the PLO lane; classifier only',
  }),
});

/** The parameter set a game is read with. */
export function styleFamilyOf(variant: string | null | undefined, scope: ReadScope | null): StyleFamily {
  const v = (variant ?? '').toLowerCase();
  if (v === 'plo4') return 'plo4';
  if (v === 'plo5') return 'plo5';
  if (v === 'plo6') return 'plo6';
  if (v === 'plo8' || v === 'flo8') return 'omaha_other';
  if (v === 'short_deck' || v.includes('short')) return 'sixplus';
  if (v === '' && scope) {
    const fam = scope.slice(0, scope.indexOf(':'));
    if (fam === 'omaha') return 'omaha_other';
    if (fam === 'sixplus') return 'sixplus';
  }
  return 'holdem';
}

// ─────────────────────────────────────────────────────────────────────────
// THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every threshold of the style read and of its consumers. One object, frozen.
 * Values marked CALIBRATE are chosen from the audit numbers and are meant to be
 * tuned on DEVELOPMENT evidence and validated on separate held-out evidence.
 */
export const STYLE_THRESHOLDS = Object.freeze({
  /** Decayed hands before ANY side is called: unknown is neutral until then. */
  preflopMinHands: 15,
  /** One-sided credibility that the true rate is beyond the Horse mean plus margin. */
  preflopCredibility: 0.9,
  /** Opportunity-conditioned statistics (3-bet per opportunity, bet when checked to). */
  conditionedMinOpps: 8,
  conditionedCredibility: 0.9,
  /** Postflop bet-and-raise share: decayed actions. */
  aggressionMinActions: 12,
  aggressionCredibility: 0.9,

  /** Shown strength of big river bets (OpponentStats.bigBetSD / bigBetSDStrong). */
  bigBetPriorShare: 0.55,
  bigBetPriorStrength: 3,
  bigBetValueShare: 0.75,
  bigBetBluffShare: 0.4,
  bigBetConfidenceHalf: 6,
  /** Availability: revealed big river bets over all his postflop bets and raises. */
  availabilityFullShare: 0.02,
  /** The least weight shown strength carries however thinly revealed (the class is specific). */
  availabilityFloor: 0.4,
  /** The most evidence shown strength alone may carry: called bets are a selected sample. */
  showdownEvidenceCap: 0.7,

  /** Margin beyond the Horse mean a side must clear, per statistic (times the family scale). CALIBRATE. */
  margin: Object.freeze({
    vpip: 0.02,
    pfr: 0.02,
    callShare: 0.02,
    threeBet: 0.01,
    betCheckedTo: 0.04,
    aggressionShare: 0.05,
    foldToBet: 0.04,
    riverCall: 0.04,
  }),
  minHalfBand: 0.04,

  /** Participation axis weights (sum 1) and the score a credible side needs. */
  participationWeights: Object.freeze({ vpip: 0.65, callShare: 0.35 }),
  participationSideScore: 0.2,
  /** Aggression axis weights (sum 1) and the score a credible side needs. */
  aggressionWeights: Object.freeze({ pfr: 0.3, threeBet: 0.2, betCheckedTo: 0.25, aggressionShare: 0.25 }),
  aggressionSideScore: 0.2,

  /** Betting-range evidence: weight of each frequency source, noisy-or combined per side. */
  rangeWeights: Object.freeze({ aggressionShare: 0.6, threeBet: 0.4, betCheckedTo: 0.4, preflopRaise: 0.3 }),
  rangeSideScore: 0.15,
  rangeFullScore: 0.6,
  /** Bluff-weighted evidence a fully released read is credited with. */
  releasedBluffEvidence: 0.3,

  /** Proportional release: posterior credibility at which release starts and is full. */
  releaseStartCredibility: 0.6,
  releaseFullCredibility: 0.95,
  /** Release fraction from which consumers stand down entirely. */
  releaseStandDownFraction: 0.5,
  /** Recent-window release: actions and share margin over the Horse share. */
  releaseRecentActions: 8,
  releaseRecentShareMargin: 0.1,
  /** Confidence multiplier at full release. */
  releaseConfidenceLoss: 0.5,

  /** Provenance: confidence cap of a profile built before complete observations, and of an unqualified one. */
  incompleteProfileCap: 0.4,
  unqualifiedProfileCap: 0.7,
  /**
   * PRE-REPAIR DISCOUNT (stat level, never a profile-wide cap). A cash, table-speed profile built before the
   * release carrying 346570fa learned its showdown-dependent counts (fold-to-bet, river call, fold-to-3-bet,
   * bet-when-checked-to) from a sample selected by showdown outcome. The share of a stored count that can still be
   * pre-release is bounded by w = 0.5^(m / preRepairWeightHalfLife), m = post-release opportunities OF THAT
   * STATISTIC. While w exceeds preRepairEngageMaxWeight (m < 60) the statistic is EXCLUDED from engagement; after that
   * its counts are scaled by (1 - w), the post-release share, so it never returns at full weight. The two rules do not
   * compound: exclusion is the gate, (1 - w) is the weight once through it. VPIP and PFR are not discounted
   * (measured 2.1 and 0.3 points off the truth set).
   */
  preRepairWeightHalfLife: 30,
  preRepairEngageMaxWeight: 0.25,

  /** Label cuts (telemetry only). A maniac raises far more than any Horse: the exploit read's width line. */
  maniacMinRaiseShare: 0.35,
  /**
   * The observable pattern 'enters wide, bets selectively' (28 of 83 wide-entry human cells in the 2026-11-13
   * label study, none of them maniacs): entry credibly wide, no aggression statistic credibly high, with at least
   * this many decayed bet-when-checked-to opportunities behind the selectivity claim.
   */
  patternMinBetOpportunities: 25,
  maniacParticipationScore: 0.5,
  maniacAggressionScore: 0.5,

  /** Population prior: the most of any consumer's maximum adjustment it may supply, shrinking to 0 at preflopMinHands. */
  populationPriorMaxFraction: 0.2,

  /** Carry-over between formats: weight of the other format's counters. DEFAULT 0 = off; needs validation. */
  carryWeight: 0,

  // ── consumers ────────────────────────────────────────────────────────
  /** Minimum axis confidence for the value-bettor guard (a capped profile cannot reach it). */
  valueBettorMinConfidence: 0.5,
  /** #2: callDownMod the legacy aggression rule would have set, and the neutral it keeps. */
  legacyManiacCallDownMod: 1.2,
  /** #3: the most extra respect, the existing callDownRespectShift ceiling (TOTAL with the V16 tell). */
  bigBetRespectCap: 0.15,
  bigBetMinPotFraction: 0.66,
  /** #3: the share of respect a turn bet or a river raise gets (frequency evidence only). */
  bigBetNonRiverBetShare: 0.5,
  /** #3: respect share when hero holds a blocker to the value hands. */
  bigBetBlockerShare: 0.5,
  /** #4: the most equity a one-pair-or-worse call of a raise is shaded by. CALIBRATE. */
  raiseShadeCap: 0.06,
  /** #4: DECISION-TIME stack-to-pot ratio (effective stack behind before the decision over the
   *  pot including his bet). Stands down at or below, full at or above. DEVELOPMENT-derived. */
  raiseSprStandDown: 2,
  raiseSprFull: 6,
  /** #6: tight opener / re-raiser, bounded bar moves. CALIBRATE. */
  tightOpenerMaxBarMove: 0.1,
  tightOpenerCallBump: 0.04,
  tightReRaiserFourBetBump: 0.03,
  tightReRaiserCallBump: 0.06,
  tightRangeFloor: 0.03,
  /** Preflop consumers stand down at or below this effective stack (push/fold depths: the existing tables decide). */
  pushFoldStandDownBB: 25,
});

/** Maximum adjustment of each consumer, for the contract and for diagnostics. */
export const STYLE_CONSUMER_BOUNDS = Object.freeze({
  valueBettorNotManiac: Object.freeze({
    unit: 'callDownMod',
    max: STYLE_THRESHOLDS.legacyManiacCallDownMod - 1,
    note: 'keeps neutral 1.0 instead of 1.2; never lowers it below neutral',
  }),
  bigBetHonesty: Object.freeze({
    unit: 'respect (callDownRespectShift scale)',
    max: STYLE_THRESHOLDS.bigBetRespectCap,
    note: 'total with the V16 tell; river large bets full, turn bets and river raises half; never a small bet',
  }),
  raiseRespect: Object.freeze({
    unit: 'equity shaded off a one-pair-or-worse call',
    max: STYLE_THRESHOLDS.raiseShadeCap,
    note: 'ramps with decision-time SPR; zero at or below raiseSprStandDown',
  }),
  tightOpener: Object.freeze({
    unit: 'preflop strength bar',
    max: STYLE_THRESHOLDS.tightOpenerMaxBarMove,
    note: '3-bet bar move; call bar +0.04; stands down at push/fold depths',
  }),
  tightReRaiser: Object.freeze({
    unit: 'preflop strength bar',
    max: STYLE_THRESHOLDS.tightReRaiserCallBump,
    note: '4-bet bar +0.03, call bar +0.06; stands down at push/fold depths',
  }),
});

// ─────────────────────────────────────────────────────────────────────────
// INPUT
// ─────────────────────────────────────────────────────────────────────────

/** The lifetime tallies of the legacy read (OpponentStats) the style read consults. */
export interface StyleTallies {
  /** distinct hands observed (lifetime) */
  hands?: number;
  /** big river bets (20bb+) that reached showdown, and those shown as two pair or better */
  bigBetSD?: number;
  bigBetSDStrong?: number;
  /** postflop bets and raises, and postflop calls (lifetime) */
  postAggr?: number;
  postPassive?: number;
  /** the same, decayed over the recent window (all streets) */
  rAggr?: number;
  rPassive?: number;
  /** first postflop wagers into an unbet street, and those that were probes (the sizing bucket) */
  ctBets?: number;
  ctProbes?: number;
}

/**
 * Where the counters came from and whether they are complete. A profile built
 * before complete observations (before the memory repair, without its public
 * domain, with its back-fill pending) is DISCOUNTED: its confidence is capped
 * and no consumer may rely on it.
 */
/** The four statistics whose stored counts depend on which hands reached showdown. */
export const PRE_REPAIR_STATS = Object.freeze(['foldToBet', 'riverCall', 'foldTo3Bet', 'betCheckedTo'] as const);
export type PreRepairStat = (typeof PRE_REPAIR_STATS)[number];
/**
 * Post-release opportunities of each showdown-dependent statistic (m). It is a PERSISTED OR RECOMPUTED input,
 * never an in-memory tally: the engine resets daily, so a counter held only in process memory would never reach
 * 60 and the discount would never lift. The supplier recomputes it at boot (read-only, per player, hand history
 * at or after the release time) or reads a persisted snapshot; this module writes nothing and keeps no count.
 * null / missing: not supplied, treated as 0 (the pre-release weight stays 1).
 */
export type PostReleaseOpportunities = Partial<Record<PreRepairStat, number | null>>;
export type PreRepairState = 'affected' | 'not_affected' | 'unknown_domain' | 'not_supplied';

export interface StyleProvenance {
  source?: 'live' | 'durable' | 'unknown';
  /** true complete, false built before complete observations, null/undefined not known */
  complete?: boolean | null;
  /**
   * Keyed from the row's own mode and speed (preRepairKeyed): true = cash and table speed, a row the learner
   * built before the release carrying 346570fa unless post-release weight says otherwise; false = unaffected
   * (tournament, lightning, built live by a process running the repaired learner); null = cash row with no
   * public domain on file, cannot tell, treated as affected; undefined = not supplied, no discount.
   */
  preRepair?: boolean | null;
  /** post-release opportunity counts per statistic; see PostReleaseOpportunities */
  postRelease?: PostReleaseOpportunities | null;
  /** the interval the counters cover, epoch ms, when known */
  observedFrom?: number | null;
  observedTo?: number | null;
}

/** Weight of the pre-release part of a counter after m post-release opportunities: 0.5^(m/30). Unknown m is 0 observed: weight 1. */
export function preRepairWeight(m: number | null | undefined): number {
  if (typeof m !== 'number' || !Number.isFinite(m) || m <= 0) return 1;
  return Math.pow(0.5, m / STYLE_THRESHOLDS.preRepairWeightHalfLife);
}

/**
 * The structural rule: a row keyed mode 'cash' AND speed 'table' (any variant) is affected; tournament and
 * lightning rows are not. A cash row with no public domain on file cannot be told apart: null, treated as affected.
 */
export function preRepairKeyed(mode: string | null | undefined, publicDomain: unknown): boolean | null {
  if (mode !== 'cash') return false;
  const speed = publicDomain && typeof publicDomain === 'object' ? (publicDomain as { speed?: unknown }).speed : undefined;
  if (speed === 'table') return true;
  if (speed === 'lightning') return false;
  return null;
}

export function preRepairStateOf(prov: StyleProvenance | null | undefined): PreRepairState {
  const v = prov?.preRepair;
  return v === true ? 'affected' : v === false ? 'not_affected' : v === null ? 'unknown_domain' : 'not_supplied';
}

export interface PreRepairDiscount {
  applies: boolean;
  /** the bound on the pre-release share of the stored count, 0.5^(m/30); 1 when m is unknown */
  bound: number;
  /** the share of the stored count that counts: 0 while excluded, 1 - bound after the lift, 1 when not affected */
  weight: number;
  /** true: the statistic does not engage anything yet (bound above preRepairEngageMaxWeight) */
  excluded: boolean;
}

/**
 * The discount for one showdown-dependent statistic of one row. Pure. Also the helper the legacy per-Horse
 * store read (HorseMind legacyExploit) is to call for the same flag; that hunk is not edited here.
 */
export function preRepairDiscount(prov: StyleProvenance | null | undefined, stat: PreRepairStat): PreRepairDiscount {
  const state = preRepairStateOf(prov);
  if (state !== 'affected' && state !== 'unknown_domain') return { applies: false, bound: 1, weight: 1, excluded: false };
  const bound = preRepairWeight(prov?.postRelease?.[stat]);
  const excluded = bound > STYLE_THRESHOLDS.preRepairEngageMaxWeight;
  return { applies: true, bound, weight: excluded ? 0 : 1 - bound, excluded };
}

/** What a receipt records of provenance, including the statistics currently excluded by the pre-repair discount. */
export interface StyleProvenanceReceipt {
  source: string;
  complete: boolean | null;
  cap: number;
  preRepair: PreRepairState;
  discounted: readonly PreRepairStat[];
}

export interface OpponentStyleInput {
  scope: ReadScope | null;
  variant?: string | null;
  /** the format the counters belong to */
  domain?: StyleDomain;
  /** decayed counters of this domain: the ONLY per-opponent evidence besides the tallies */
  counters?: ExploitCounters | null;
  /** the same player's counters in the OTHER format; ignored at the default weight 0 */
  carry?: ExploitCounters | null;
  carryWeight?: number;
  tallies?: StyleTallies | null;
  provenance?: StyleProvenance | null;
}

// ─────────────────────────────────────────────────────────────────────────
// OUTPUT
// ─────────────────────────────────────────────────────────────────────────

export type StyleSide = 'high' | 'low' | null;

/**
 * First-class observable patterns: descriptions of what was observed, never labels and never instructions.
 *  wide_entry_selective_betting  entry axis high (credibly wide), raise frequency, three-bet frequency and
 *                                bet-when-checked-to all not credibly high. By construction never a maniac.
 */
export const STYLE_PATTERNS = Object.freeze(['wide_entry_selective_betting'] as const);
export type StylePattern = (typeof STYLE_PATTERNS)[number];

export interface StyleSignal {
  /** posterior mean, shrunk toward the Horse mean */
  mean: number;
  /** the Horse population mean it is judged against */
  horse: number;
  /** decayed opportunities behind it */
  n: number;
  /** credibly beyond the Horse mean plus margin (one-sided), or null */
  side: StyleSide;
  /** (mean - horse) over the half-band of the Horse envelope, clamped to -1..1 */
  shift: number;
  magnitude: number;
  /** n / (n + minimum): how much evidence stands behind it, 0..1 */
  confidence: number;
}

export interface ShownStrengthSignal {
  shown: number;
  strong: number;
  /** strong share shrunk toward the prior */
  share: number;
  side: 'value' | 'bluff' | null;
  magnitude: number;
  confidence: number;
}

/** Showdown selection bias, carried explicitly: what could have been revealed against what was. */
export interface ObservationAvailability {
  /** big river bets revealed at showdown (what the shown strength is about) */
  shown: number;
  /** all his postflop bets and raises, revealed or not (the opportunities strength could have been shown) */
  opportunities: number;
  /** opportunities that were never revealed (a lower bound: not every one was a big river bet) */
  unrevealed: number;
  revealedShare: number;
  /** the weight shown strength is given, in [availabilityFloor, 1] */
  discount: number;
}

export interface StyleAxis<S extends string> {
  /** -1..1 */
  score: number;
  side: S | 'neutral';
  credible: boolean;
  /** 0..1, after the provenance cap and the release loss */
  confidence: number;
}

export interface BettingRangeEvidence {
  /** evidence his bets are value, from shown strength (discounted, capped) */
  shownValue: number;
  shownBluff: number;
  /** evidence from how often he raises and bets per opportunity */
  frequencyValue: number;
  frequencyBluff: number;
  /** the weight shown strength carried */
  availabilityDiscount: number;
}

export type EvidenceState =
  | 'no_reliable_individual_evidence'
  | 'population_prior'
  | 'supported_individual_read';

/** (b) A population prior: separate, uncertain, bounded, shrinking, never a measured trait. */
export interface PopulationPrior {
  readonly available: boolean;
  readonly source: string;
  /** 0..populationPriorMaxFraction, shrinking with individual hands */
  readonly weight: number;
  /** stated uncertainty, 0..1 (1 = nothing known) */
  readonly uncertainty: number;
  /** the ONLY axis a population prior may move: entry width (humans measured loose, not more aggressive) */
  readonly participationShift: number;
  /** literal 0: no prior is ever put on aggression or on the betting range */
  readonly aggressionShift: 0;
  readonly bettingRangeShift: 0;
  readonly measuredIndividualTrait: false;
  readonly mayDisableProtection: false;
}

export interface StyleEvidence {
  readonly state: EvidenceState;
  /** decayed hands behind the read (this format only unless carry is on) */
  readonly individualHands: number;
  /** false in state (a) and (b): the read is neutral and says so */
  readonly supported: boolean;
  /** true unless supported */
  readonly uncertain: boolean;
  /** a style read never disarms protective logic: literal true */
  readonly protectiveLogicArmed: true;
  readonly populationPrior: PopulationPrior;
}

export interface StyleRelease {
  /** 0..1: how credibly the fast or recent window shows him betting or raising above the Horse mean */
  readonly fraction: number;
  /** fraction >= releaseStandDownFraction: every consumer stands down */
  readonly standDown: boolean;
  readonly source: string | null;
}

export interface StyleReceipt {
  readonly version: typeof OPPONENT_STYLE_VERSION;
  readonly envelope: string;
  readonly scope: string | null;
  readonly variant: string | null;
  readonly family: StyleFamily;
  readonly domain: StyleDomain | null;
  readonly label: StyleLabel;
  readonly pattern: StylePattern | null;
  readonly evidenceState: EvidenceState;
  readonly unknownReason: string | null;
  readonly hands: number;
  readonly carried: number | null;
  readonly release: { fraction: number; source: string | null };
  /** provenance and completeness of the counters, and the confidence cap they imposed */
  readonly provenance: StyleProvenanceReceipt;
  readonly observationInterval: { from: number | null; to: number | null };
  readonly participation: string;
  readonly aggression: string;
  readonly bettingRange: string;
  readonly evidence: BettingRangeEvidence;
  readonly availability: { shown: number; opportunities: number; revealedShare: number; discount: number };
  /** side:mean:n of every statistic, rounded for telemetry */
  readonly signals: Readonly<Record<string, string>>;
  /** features the decision-time counters cannot carry; consumers condition on them at the decision */
  readonly notAvailable: readonly string[];
}

export interface OpponentStyleSignals {
  vpip: StyleSignal;
  pfr: StyleSignal;
  callShare: StyleSignal;
  /** three-bets per OPPORTUNITY (a single raise faced), never over all hands */
  threeBet: StyleSignal;
  betCheckedTo: StyleSignal;
  /** Postflop bets and raises over bets, raises and calls: the raise-frequency PROXY. The stored
   * tallies do not separate a raise from a bet, so a postflop raise-per-opportunity count is not read. */
  aggressionShare: StyleSignal;
  /** POSTFLOP fold-to-bet and river call-or-raise: exposed so bluff pricing uses postflop fold stats */
  foldToBet: StyleSignal;
  riverCall: StyleSignal;
  shownStrength: ShownStrengthSignal;
  /** share of his first wagers into an unbet street that were probes (the sizing bucket), or null */
  probeShare: number | null;
}

export interface OpponentStyleRead {
  readonly version: typeof OPPONENT_STYLE_VERSION;
  readonly family: StyleFamily;
  /** the hold'em lane's consumers may act on this family (false for Omaha and Short Deck) */
  readonly consumersMayAct: boolean;
  /** TELEMETRY ONLY: no consumer may read it; consumers engage per axis on credible counts */
  readonly label: StyleLabel;
  /** an observed pattern, beside the label and never a label; null when none */
  readonly pattern: StylePattern | null;
  readonly evidence: StyleEvidence;
  readonly participation: StyleAxis<'tight' | 'loose'>;
  readonly aggression: StyleAxis<'passive' | 'aggressive'>;
  readonly bettingRange: StyleAxis<'value-weighted' | 'bluff-weighted'> & {
    readonly evidence: BettingRangeEvidence;
    readonly availability: ObservationAvailability;
  };
  readonly release: StyleRelease;
  /** multiplier in (0,1] every confidence carries: provenance and release */
  readonly confidenceCap: number;
  readonly signals: OpponentStyleSignals;
  readonly receipt: StyleReceipt;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const noisyOr = (xs: readonly number[]): number => 1 - xs.reduce((p, x) => p * (1 - clamp(x, 0, 1)), 1);

const NOT_AVAILABLE: readonly string[] = Object.freeze([
  'position',
  'stack_depth',
  'heads_up_versus_multiway',
  'street_specific_bet_frequency',
  'sizing_buckets_beyond_probe_share',
  'postflop_raise_per_opportunity',
  'board_and_blocker_context',
  'action_context',
]);

interface Posterior {
  mean: number;
  n: number;
  pAbove: number;
  pBelow: number;
}

/** Beta posterior shrunk toward the Horse mean (EXPLOIT_PRIOR_STRENGTH pseudo-observations). */
function posterior(successes: number, opps: number, horse: number, margin: number): Posterior {
  const prior = clamp(horse, 0.01, 0.99);
  const n = Math.max(0, num(opps));
  const s = clamp(num(successes), 0, n);
  const a = prior * EXPLOIT_PRIOR_STRENGTH + s;
  const b = (1 - prior) * EXPLOIT_PRIOR_STRENGTH + (n - s);
  return {
    mean: a / (a + b),
    n,
    pAbove: 1 - betaCdf(Math.min(0.999, prior + margin), a, b),
    pBelow: betaCdf(Math.max(0.001, prior - margin), a, b),
  };
}

function signal(
  successes: number,
  opps: number,
  horse: number,
  halfBand: number,
  margin: number,
  minOpps: number,
  credibility: number,
  callable: boolean
): StyleSignal {
  const p = posterior(successes, opps, horse, margin);
  const side: StyleSide =
    callable && p.n >= minOpps ? (p.pAbove >= credibility ? 'high' : p.pBelow >= credibility ? 'low' : null) : null;
  const shift = clamp((p.mean - horse) / Math.max(STYLE_THRESHOLDS.minHalfBand, halfBand), -1, 1);
  return {
    mean: p.mean,
    horse,
    n: p.n,
    side,
    shift,
    magnitude: Math.abs(shift),
    confidence: p.n > 0 ? p.n / (p.n + minOpps) : 0,
  };
}

const halfBandOf = (cell: ExploitEnvelopeCell): number => (cell.hi - cell.lo) / 2;

/**
 * The counters a read starts from. With the DEFAULT weight 0 this is this
 * domain's own counters, untouched: format-specific evidence only. With a
 * non-zero weight (an option that needs validation) the other format's
 * counters are added at that weight, tapering to zero as this domain's own
 * hands reach preflopMinHands. Pure.
 */
export function carryOverCounters(
  own: ExploitCounters | null | undefined,
  other: ExploitCounters | null | undefined,
  weight: number = STYLE_THRESHOLDS.carryWeight
): { counters: ExploitCounters | undefined; weight: number } {
  const ownRow = own ?? undefined;
  if (!other || !(weight > 0)) return { counters: ownRow, weight: 0 };
  const taper = Math.max(0, 1 - num(ownRow?.hands) / STYLE_THRESHOLDS.preflopMinHands);
  const w = clamp(weight, 0, 1) * taper;
  if (!(w > 1e-6)) return { counters: ownRow, weight: 0 };
  const out = {} as ExploitCounters;
  for (const f of EXPLOIT_COUNTER_FIELDS) out[f] = num(ownRow?.[f]) + w * num(other[f]);
  return { counters: out, weight: w };
}

const NEUTRAL_SIGNAL = (horse = 0): StyleSignal =>
  Object.freeze({ mean: horse, horse, n: 0, side: null, shift: 0, magnitude: 0, confidence: 0 });

const NEUTRAL_SHOWN: ShownStrengthSignal = Object.freeze({
  shown: 0,
  strong: 0,
  share: STYLE_THRESHOLDS.bigBetPriorShare,
  side: null,
  magnitude: 0,
  confidence: 0,
});

const NO_EVIDENCE: BettingRangeEvidence = Object.freeze({
  shownValue: 0,
  shownBluff: 0,
  frequencyValue: 0,
  frequencyBluff: 0,
  availabilityDiscount: STYLE_THRESHOLDS.availabilityFloor,
});

const neutralAxis = <S extends string>(): StyleAxis<S> =>
  Object.freeze({ score: 0, side: 'neutral' as const, credible: false, confidence: 0 });

/** The shipped population prior: none measured. Parameterised so a measured prior can be dropped in and validated. */
export const STYLE_POPULATION_PRIOR: Readonly<Record<StyleFamily, Omit<PopulationPrior, 'weight' | 'measuredIndividualTrait' | 'mayDisableProtection'>>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(STYLE_FAMILY_PARAMS) as StyleFamily[]).map((f) => [
        f,
        Object.freeze({
          available: false,
          source: 'none_measured',
          uncertainty: 1,
          participationShift: 0,
          aggressionShift: 0,
          bettingRangeShift: 0,
        }),
      ])
    ) as Record<StyleFamily, Omit<PopulationPrior, 'weight' | 'measuredIndividualTrait' | 'mayDisableProtection'>>
  );

/** (b) the prior for a family at a given amount of individual evidence: bounded, shrinking, never a trait. */
export function populationPriorFor(family: StyleFamily, individualHands: number): PopulationPrior {
  const base = STYLE_POPULATION_PRIOR[family];
  const shrink = Math.max(0, 1 - num(individualHands) / STYLE_THRESHOLDS.preflopMinHands);
  return Object.freeze({
    ...base,
    weight: base.available ? STYLE_THRESHOLDS.populationPriorMaxFraction * shrink : 0,
    measuredIndividualTrait: false as const,
    mayDisableProtection: false as const,
  });
}

function buildRead(
  family: StyleFamily,
  state: EvidenceState,
  hands: number,
  parts: {
    scope: ReadScope | null;
    variant: string | null;
    domain: StyleDomain | null;
    unknownReason: string | null;
    provenance: StyleProvenanceReceipt;
    interval: { from: number | null; to: number | null };
    carried: number | null;
    participation: StyleAxis<'tight' | 'loose'>;
    aggression: StyleAxis<'passive' | 'aggressive'>;
    range: StyleAxis<'value-weighted' | 'bluff-weighted'>;
    evidence: BettingRangeEvidence;
    availability: ObservationAvailability;
    release: StyleRelease;
    cap: number;
    signals: OpponentStyleSignals;
    label: StyleLabel;
    pattern?: StylePattern | null;
  }
): OpponentStyleRead {
  const prior = populationPriorFor(family, hands);
  const supported = state === 'supported_individual_read';
  const brief = (s: StyleSignal): string => `${s.side ?? 'none'}:${round4(s.mean)}:${round4(s.n)}`;
  const sg = parts.signals;
  const receipt: StyleReceipt = Object.freeze({
    version: OPPONENT_STYLE_VERSION,
    envelope: OPPONENT_EXPLOIT_ENVELOPE_VERSION,
    scope: parts.scope,
    variant: parts.variant,
    family,
    domain: parts.domain,
    label: parts.label,
    pattern: parts.pattern ?? null,
    evidenceState: state,
    unknownReason: parts.unknownReason,
    hands: round4(hands),
    carried: parts.carried,
    release: Object.freeze({ fraction: round4(parts.release.fraction), source: parts.release.source }),
    provenance: Object.freeze({ ...parts.provenance }),
    observationInterval: Object.freeze({ ...parts.interval }),
    participation: `${parts.participation.side}:${round4(parts.participation.score)}`,
    aggression: `${parts.aggression.side}:${round4(parts.aggression.score)}`,
    bettingRange: `${parts.range.side}:${round4(parts.range.score)}`,
    evidence: parts.evidence,
    availability: Object.freeze({
      shown: parts.availability.shown,
      opportunities: parts.availability.opportunities,
      revealedShare: round4(parts.availability.revealedShare),
      discount: round4(parts.availability.discount),
    }),
    signals: Object.freeze({
      vpip: brief(sg.vpip),
      pfr: brief(sg.pfr),
      callShare: brief(sg.callShare),
      threeBet: brief(sg.threeBet),
      betCheckedTo: brief(sg.betCheckedTo),
      aggressionShare: brief(sg.aggressionShare),
      foldToBet: brief(sg.foldToBet),
      riverCall: brief(sg.riverCall),
      shownStrength: `${sg.shownStrength.side ?? 'none'}:${round4(sg.shownStrength.share)}:${sg.shownStrength.shown}`,
    }),
    notAvailable: NOT_AVAILABLE,
  });
  return Object.freeze({
    version: OPPONENT_STYLE_VERSION,
    family,
    consumersMayAct: STYLE_FAMILY_PARAMS[family].consumers,
    label: parts.label,
    pattern: parts.pattern ?? null,
    evidence: Object.freeze({
      state,
      individualHands: round4(hands),
      supported,
      uncertain: !supported,
      protectiveLogicArmed: true as const,
      populationPrior: prior,
    }),
    participation: Object.freeze(parts.participation),
    aggression: Object.freeze(parts.aggression),
    bettingRange: Object.freeze({
      ...parts.range,
      evidence: parts.evidence,
      availability: parts.availability,
    }),
    release: Object.freeze(parts.release),
    confidenceCap: parts.cap,
    signals: parts.signals,
    receipt,
  });
}

const NEUTRAL_SIGNALS = (): OpponentStyleSignals =>
  Object.freeze({
    vpip: NEUTRAL_SIGNAL(),
    pfr: NEUTRAL_SIGNAL(),
    callShare: NEUTRAL_SIGNAL(),
    threeBet: NEUTRAL_SIGNAL(),
    betCheckedTo: NEUTRAL_SIGNAL(),
    aggressionShare: NEUTRAL_SIGNAL(),
    foldToBet: NEUTRAL_SIGNAL(),
    riverCall: NEUTRAL_SIGNAL(),
    shownStrength: NEUTRAL_SHOWN,
    probeShare: null,
  });

const NEUTRAL_AVAILABILITY: ObservationAvailability = Object.freeze({
  shown: 0,
  opportunities: 0,
  unrevealed: 0,
  revealedShare: 0,
  discount: STYLE_THRESHOLDS.availabilityFloor,
});

/**
 * State (a): no reliable individual evidence. Neutral on every axis, every
 * side null, adjustment 0, uncertain, protective logic armed. Used for no scope,
 * no population cell, no counters and fewer than preflopMinHands hands.
 */
export function unknownStyle(
  reason: string,
  scope: ReadScope | null = null,
  variant: string | null = null,
  domain: StyleDomain | null = null,
  hands = 0,
  provenance: StyleProvenanceReceipt = {
    source: 'unknown',
    complete: null,
    cap: 1,
    preRepair: 'not_supplied',
    discounted: [],
  }
): OpponentStyleRead {
  const family = styleFamilyOf(variant, scope);
  const prior = populationPriorFor(family, hands);
  return buildRead(family, prior.available && prior.weight > 0 ? 'population_prior' : 'no_reliable_individual_evidence', hands, {
    scope,
    variant,
    domain,
    unknownReason: reason,
    provenance,
    interval: { from: null, to: null },
    carried: null,
    participation: neutralAxis(),
    aggression: neutralAxis(),
    range: neutralAxis(),
    evidence: NO_EVIDENCE,
    availability: NEUTRAL_AVAILABILITY,
    release: Object.freeze({ fraction: 0, standDown: false, source: null }),
    cap: 1,
    signals: NEUTRAL_SIGNALS(),
    label: 'unknown',
  });
}

/**
 * Classify one opponent from DECISION-TIME evidence. Total: never throws, never
 * returns null; a player nothing reliable is known about is the neutral,
 * explicitly uncertain unknownStyle.
 */
export function classifyOpponentStyle(input: OpponentStyleInput): OpponentStyleRead {
  const T = STYLE_THRESHOLDS;
  const scope = input.scope;
  const variant = input.variant ?? null;
  const domain = input.domain ?? null;
  const family = styleFamilyOf(variant, scope);
  const params = STYLE_FAMILY_PARAMS[family];
  const prov = input.provenance ?? {};
  const complete = prov.complete === undefined ? null : prov.complete;
  const provCap = complete === false ? T.incompleteProfileCap : complete === null ? T.unqualifiedProfileCap : 1;
  const discounts = PRE_REPAIR_STATS.map((stat) => [stat, preRepairDiscount(prov, stat)] as const);
  const provenance: StyleProvenanceReceipt = {
    source: prov.source ?? 'unknown',
    complete,
    cap: provCap,
    preRepair: preRepairStateOf(prov),
    discounted: Object.freeze(discounts.filter(([, d]) => d.excluded).map(([stat]) => stat)),
  };
  const repairOf = (stat: PreRepairStat): PreRepairDiscount => discounts.find(([name]) => name === stat)![1];
  if (!scope) return unknownStyle('no_scope', scope, variant, domain, 0, provenance);
  const envelope = exploitEnvelopeFor(scope, variant);
  if (!envelope) return unknownStyle('no_population_cell', scope, variant, domain, 0, provenance);

  const merged = carryOverCounters(input.counters, input.carry, input.carryWeight ?? T.carryWeight);
  const c = merged.counters;
  const tallies = input.tallies ?? {};
  const counterHands = Math.max(0, num(c?.hands));
  const hands = Math.max(counterHands, Math.max(0, num(tallies.hands)));
  // (a): unknown is neutral until 15 hands have passed, whatever else is on file.
  if (!(hands >= T.preflopMinHands)) return unknownStyle(hands > 0 ? 'fewer_than_15_hands' : 'no_evidence', scope, variant, domain, hands, provenance);

  const ms = params.marginScale;
  const callable = true; // hands >= 15 holds here
  const vpipCell = envelope.vpip;
  const pfrCell = envelope.pfr;
  const callHorse = Math.max(0.01, vpipCell.mean - pfrCell.mean);
  const prefMin = T.preflopMinHands;
  const vpip = signal(num(c?.vpip), counterHands, vpipCell.mean, halfBandOf(vpipCell), T.margin.vpip * ms, prefMin, T.preflopCredibility, callable);
  const pfr = signal(num(c?.pfr), counterHands, pfrCell.mean, halfBandOf(pfrCell), T.margin.pfr * ms, prefMin, T.preflopCredibility, callable);
  const callShare = signal(
    Math.max(0, num(c?.vpip) - num(c?.pfr)),
    counterHands,
    callHorse,
    (halfBandOf(vpipCell) + halfBandOf(pfrCell)) / 2,
    T.margin.callShare * ms,
    prefMin,
    T.preflopCredibility,
    callable
  );
  const threeCell = envelope.threeBet;
  const betCell = envelope.betCheckedTo;
  // three-bets PER OPPORTUNITY: a single raise faced, never over all hands
  const threeBet = signal(num(c?.threeBet), num(c?.threeBetOpp), threeCell.mean, halfBandOf(threeCell), T.margin.threeBet * ms, T.conditionedMinOpps, T.conditionedCredibility, callable);
  // The four showdown-dependent statistics are weighted (and held out of engagement) by the pre-repair discount.
  const dBet = repairOf('betCheckedTo');
  const betCheckedTo = dBet.excluded
    ? NEUTRAL_SIGNAL()
    : signal(num(c?.betCheckedTo) * dBet.weight, num(c?.betCheckedToOpp) * dBet.weight, betCell.mean, halfBandOf(betCell), T.margin.betCheckedTo * ms, T.conditionedMinOpps, T.conditionedCredibility, callable);
  const foldCell = envelope.foldToBet;
  const riverCell = envelope.riverCall;
  const dFold = repairOf('foldToBet');
  const dRiver = repairOf('riverCall');
  const foldToBet = dFold.excluded
    ? NEUTRAL_SIGNAL()
    : signal(num(c?.foldToBet) * dFold.weight, num(c?.foldToBetOpp) * dFold.weight, foldCell.mean, halfBandOf(foldCell), T.margin.foldToBet * ms, T.conditionedMinOpps, T.conditionedCredibility, callable);
  const riverCall = dRiver.excluded
    ? NEUTRAL_SIGNAL()
    : signal(num(c?.riverCall) * dRiver.weight, num(c?.riverCallOpp) * dRiver.weight, riverCell.mean, halfBandOf(riverCell), T.margin.riverCall * ms, T.conditionedMinOpps, T.conditionedCredibility, callable);
  const afN = Math.max(0, num(tallies.postAggr)) + Math.max(0, num(tallies.postPassive));
  const horseShare = params.horsePostflopAggressionShare;
  // Not measured for this family: the statistic is not read at all (neutral), never borrowed from hold'em.
  const aggressionShare =
    horseShare === null
      ? NEUTRAL_SIGNAL()
      : signal(Math.max(0, num(tallies.postAggr)), afN, horseShare, 0.15, T.margin.aggressionShare * ms, T.aggressionMinActions, T.aggressionCredibility, callable);

  // ── SHOWN STRENGTH, with its availability discount ────────────────────
  const bigShown = Math.max(0, num(tallies.bigBetSD));
  const bigStrong = clamp(num(tallies.bigBetSDStrong), 0, bigShown);
  const share = (bigStrong + T.bigBetPriorStrength * T.bigBetPriorShare) / (bigShown + T.bigBetPriorStrength);
  const mid = (T.bigBetValueShare + T.bigBetBluffShare) / 2;
  let shownSide: ShownStrengthSignal['side'] = null;
  let shownMag = 0;
  if (callable && bigShown >= params.bigBetMinShown) {
    if (share >= T.bigBetValueShare) {
      shownSide = 'value';
      shownMag = clamp((share - mid) / (T.bigBetValueShare - mid), 0, 1);
    } else if (share <= T.bigBetBluffShare) {
      shownSide = 'bluff';
      shownMag = clamp((mid - share) / (mid - T.bigBetBluffShare), 0, 1);
    }
  }
  const shownStrength: ShownStrengthSignal = {
    shown: bigShown,
    strong: bigStrong,
    share,
    side: shownSide,
    magnitude: shownMag,
    confidence: bigShown > 0 ? bigShown / (bigShown + T.bigBetConfidenceHalf) : 0,
  };
  const opportunities = Math.max(0, num(tallies.postAggr));
  const revealedShare = opportunities > 0 ? Math.min(1, bigShown / opportunities) : 0;
  const discount = T.availabilityFloor + (1 - T.availabilityFloor) * clamp(revealedShare / T.availabilityFullShare, 0, 1);
  const availability: ObservationAvailability = {
    shown: bigShown,
    opportunities,
    unrevealed: Math.max(0, opportunities - bigShown),
    revealedShare,
    discount,
  };
  const ctBets = Math.max(0, num(tallies.ctBets));
  const probeShare = ctBets >= 8 ? clamp(num(tallies.ctProbes) / ctBets, 0, 1) : null;

  // ── PROPORTIONAL RELEASE (never a reset) ──────────────────────────────
  const ramp = (p: number): number => clamp((p - T.releaseStartCredibility) / (T.releaseFullCredibility - T.releaseStartCredibility), 0, 1);
  let releaseFraction = 0;
  let releaseSource: string | null = null;
  const consider = (f: number, source: string): void => {
    if (f > releaseFraction) {
      releaseFraction = f;
      releaseSource = source;
    }
  };
  if (c) {
    const fastAbove = (succ: number, opp: number, horse: number, margin: number): number =>
      opp >= EXPLOIT_FAST_MIN_N ? ramp(posterior(succ, opp, horse, margin).pAbove) : 0;
    consider(fastAbove(num(c.fPfr), num(c.fHands), pfrCell.mean, T.margin.pfr * ms), 'fast_pfr');
    consider(fastAbove(num(c.fThreeBet), num(c.fThreeBetOpp), threeCell.mean, T.margin.threeBet * ms), 'fast_three_bet');
    consider(fastAbove(num(c.fBetCheckedTo), num(c.fBetCheckedToOpp), betCell.mean, T.margin.betCheckedTo * ms), 'fast_bet_checked_to');
  }
  const rn = Math.max(0, num(tallies.rAggr)) + Math.max(0, num(tallies.rPassive));
  if (horseShare !== null && rn >= T.releaseRecentActions)
    consider(ramp(posterior(num(tallies.rAggr), rn, horseShare, T.releaseRecentShareMargin).pAbove), 'recent_aggression');
  const release: StyleRelease = {
    fraction: releaseFraction,
    standDown: releaseFraction >= T.releaseStandDownFraction,
    source: releaseFraction > 0 ? releaseSource : null,
  };
  // Provenance caps every confidence. Release also lowers the confidence of the LOW-side reads
  // (tight, passive, value-weighted): it is evidence AGAINST them, never against a high-side read.
  const capHigh = provCap;
  const capLow = provCap * (1 - T.releaseConfidenceLoss * releaseFraction);

  // ── PARTICIPATION ────────────────────────────────────────────────────
  const pw = T.participationWeights;
  const participationScore = clamp(pw.vpip * vpip.shift + pw.callShare * callShare.shift, -1, 1);
  let participationSide: 'tight' | 'loose' | 'neutral' = 'neutral';
  if (participationScore >= T.participationSideScore && (vpip.side === 'high' || callShare.side === 'high')) participationSide = 'loose';
  else if (participationScore <= -T.participationSideScore && (vpip.side === 'low' || callShare.side === 'low')) participationSide = 'tight';
  const participation: StyleAxis<'tight' | 'loose'> = {
    score: participationScore,
    side: participationSide,
    credible: participationSide !== 'neutral',
    confidence:
      participationSide === 'neutral'
        ? 0
        : Math.max(vpip.confidence, callShare.confidence) * (participationSide === 'tight' ? capLow : capHigh),
  };

  // ── AGGRESSION ───────────────────────────────────────────────────────
  const aw = T.aggressionWeights;
  const weighted = (sig: StyleSignal): number => sig.shift * sig.confidence;
  const aggressionScore = clamp(
    aw.pfr * weighted(pfr) + aw.threeBet * weighted(threeBet) + aw.betCheckedTo * weighted(betCheckedTo) + aw.aggressionShare * weighted(aggressionShare),
    -1,
    1
  );
  const aggSigs = [pfr, threeBet, betCheckedTo, aggressionShare];
  let aggressionSide: 'passive' | 'aggressive' | 'neutral' = 'neutral';
  if (aggressionScore >= T.aggressionSideScore && aggSigs.some((s) => s.side === 'high')) aggressionSide = 'aggressive';
  else if (aggressionScore <= -T.aggressionSideScore && aggSigs.some((s) => s.side === 'low')) aggressionSide = 'passive';
  const aggression: StyleAxis<'passive' | 'aggressive'> = {
    score: aggressionScore,
    side: aggressionSide,
    credible: aggressionSide !== 'neutral',
    confidence:
      aggressionSide === 'neutral'
        ? 0
        : Math.max(...aggSigs.map((s) => s.confidence)) * (aggressionSide === 'passive' ? capLow : capHigh),
  };

  // ── BETTING-RANGE EVIDENCE ───────────────────────────────────────────
  const rw = T.rangeWeights;
  const ev = (sig: StyleSignal, side: 'high' | 'low', w: number): number =>
    sig.side === side ? w * sig.magnitude * sig.confidence : 0;
  const shownEv = (side: 'value' | 'bluff'): number =>
    shownSide === side ? Math.min(T.showdownEvidenceCap, shownMag * shownStrength.confidence * discount) : 0;
  const frequencyValue = noisyOr([ev(aggressionShare, 'low', rw.aggressionShare), ev(threeBet, 'low', rw.threeBet), ev(betCheckedTo, 'low', rw.betCheckedTo)]);
  const frequencyBluff = noisyOr([ev(aggressionShare, 'high', rw.aggressionShare), ev(threeBet, 'high', rw.threeBet), ev(betCheckedTo, 'high', rw.betCheckedTo), ev(pfr, 'high', rw.preflopRaise)]);
  // Release is proportional: value evidence shrinks with it, bluff evidence rises with it.
  const keep = (1 - releaseFraction) * provCap;
  const evidence: BettingRangeEvidence = {
    shownValue: shownEv('value') * keep,
    shownBluff: shownEv('bluff') * capHigh,
    frequencyValue: frequencyValue * keep,
    frequencyBluff: Math.max(frequencyBluff * capHigh, T.releasedBluffEvidence * releaseFraction * capHigh),
    availabilityDiscount: discount,
  };
  const valueEv = noisyOr([evidence.shownValue, evidence.frequencyValue]);
  const bluffEv = noisyOr([evidence.shownBluff, evidence.frequencyBluff]);
  const rangeScore = clamp(valueEv - bluffEv, -1, 1);
  const rangeSide: 'value-weighted' | 'bluff-weighted' | 'neutral' =
    rangeScore >= T.rangeSideScore ? 'value-weighted' : rangeScore <= -T.rangeSideScore ? 'bluff-weighted' : 'neutral';
  const range: StyleAxis<'value-weighted' | 'bluff-weighted'> = {
    score: rangeScore,
    side: rangeSide,
    credible: rangeSide !== 'neutral',
    confidence: rangeSide === 'neutral' ? 0 : clamp(Math.abs(rangeScore) / T.rangeFullScore, 0, 1),
  };

  // ── LABEL (telemetry only) ───────────────────────────────────────────
  // Entry and aggression are separate; with aggression not credibly called, the share of his
  // voluntary hands he raises (PFR over VPIP) places him.
  const raiseRatio = vpip.mean > 0 ? pfr.mean / vpip.mean : 0;
  const aggressiveEnough = aggressionSide === 'aggressive' || (aggressionSide === 'neutral' && raiseRatio >= 0.7);
  const maniac =
    participationSide === 'loose' &&
    participationScore >= T.maniacParticipationScore &&
    aggressionSide === 'aggressive' &&
    aggressionScore >= T.maniacAggressionScore &&
    pfr.side === 'high' &&
    pfr.mean >= T.maniacMinRaiseShare;
  const betOpportunities = dBet.excluded ? 0 : num(c?.betCheckedToOpp) * dBet.weight;
  const pattern: StylePattern | null =
    participationSide === 'loose' &&
    pfr.side !== 'high' &&
    threeBet.side !== 'high' &&
    betCheckedTo.side !== 'high' &&
    aggressionSide !== 'aggressive' &&
    betOpportunities >= T.patternMinBetOpportunities
      ? 'wide_entry_selective_betting'
      : null;
  let label: StyleLabel;
  if (maniac) label = 'maniac';
  else if (rangeSide === 'value-weighted' && aggressionSide !== 'aggressive' && participationSide !== 'loose') label = 'value-heavy-passive';
  else if (participationSide === 'loose') label = aggressiveEnough ? 'loose-aggressive' : 'loose-passive';
  else if (participationSide === 'tight') label = aggressiveEnough ? 'tight-aggressive' : 'tight-passive';
  else if (aggressionSide === 'aggressive') label = participationScore >= 0 ? 'loose-aggressive' : 'tight-aggressive';
  else if (aggressionSide === 'passive') label = participationScore >= 0 ? 'loose-passive' : 'tight-passive';
  else label = 'balanced';

  const signals: OpponentStyleSignals = Object.freeze({
    vpip: Object.freeze(vpip),
    pfr: Object.freeze(pfr),
    callShare: Object.freeze(callShare),
    threeBet: Object.freeze(threeBet),
    betCheckedTo: Object.freeze(betCheckedTo),
    aggressionShare: Object.freeze(aggressionShare),
    foldToBet: Object.freeze(foldToBet),
    riverCall: Object.freeze(riverCall),
    shownStrength: Object.freeze(shownStrength),
    probeShare,
  });
  return buildRead(family, 'supported_individual_read', hands, {
    scope,
    variant,
    domain,
    unknownReason: null,
    provenance,
    interval: { from: prov.observedFrom ?? null, to: prov.observedTo ?? null },
    carried: merged.weight > 0 ? round4(merged.weight) : null,
    participation,
    aggression,
    range,
    evidence,
    availability,
    release: Object.freeze(release),
    cap: capLow,
    signals,
    label,
    pattern,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// (d) TACTICAL: a feature of the situation, never of the player
// ─────────────────────────────────────────────────────────────────────────

export interface TacticalSpot {
  street: 'flop' | 'turn' | 'river';
  /** the wager as a share of the pot before it */
  potFraction: number;
  /** the wager is a raise over a bet */
  isRaise: boolean;
  /** decision-time SPR: effective stack behind before the decision over the pot including his bet */
  decisionSpr: number;
}

export interface TacticalFeatures {
  readonly kind: 'situation';
  /** literal false: this is not a trait of the opponent */
  readonly trait: false;
  readonly street: TacticalSpot['street'];
  readonly isRaise: boolean;
  readonly isLargeWager: boolean;
  readonly isRiverRaise: boolean;
  readonly isShortSpr: boolean;
}

export function describeTactical(spot: TacticalSpot): TacticalFeatures {
  const T = STYLE_THRESHOLDS;
  return Object.freeze({
    kind: 'situation' as const,
    trait: false as const,
    street: spot.street,
    isRaise: spot.isRaise,
    isLargeWager: num(spot.potFraction) >= T.bigBetMinPotFraction,
    isRiverRaise: spot.street === 'river' && spot.isRaise,
    isShortSpr: num(spot.decisionSpr) <= T.raiseSprStandDown,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// PROVENANCE: which stored profiles were built before complete observations
// ─────────────────────────────────────────────────────────────────────────

export interface ProfileQualificationInput {
  user_id?: string;
  variant?: string;
  mode?: string;
  size?: string;
  /** the one-time legacy back-fill has been folded in */
  initialized?: boolean;
  /** the public rules domain the row was built under (absent on rows built before the memory repair) */
  public_memory_domain?: unknown;
}

export interface ProfileQualification {
  complete: boolean;
  reasons: readonly string[];
}

/**
 * A stored profile is COMPLETE only when its legacy back-fill has been folded
 * in and it carries the public domain it was built under. Anything else was
 * built before complete observations and is discounted (confidence cap
 * incompleteProfileCap, no consumer reliance). A conservative marker: the
 * memory owner confirms it. Pure; reads nothing, writes nothing.
 */
export function profileQualification(p: ProfileQualificationInput | null | undefined): ProfileQualification {
  const reasons: string[] = [];
  if (!p) return Object.freeze({ complete: false, reasons: Object.freeze(['no_profile']) });
  if (p.initialized !== true) reasons.push('backfill_pending');
  if (p.public_memory_domain === undefined || p.public_memory_domain === null) reasons.push('no_public_memory_domain');
  return Object.freeze({ complete: reasons.length === 0, reasons: Object.freeze(reasons) });
}

/**
 * HOW AFFECTED READS ARE IDENTIFIED AND REBUILT. Identify: run every stored
 * durable profile through profileQualification; the incomplete ones are the
 * affected reads (this helper lists them). Rebuild: the owner of the memory
 * pipeline replays the accepted hand history for those (user, variant, mode,
 * size) keys through the same exploitHandIncrements the live learner uses, with
 * the public domain stamped, and re-imports the row (which supersedes the old
 * version). THIS MODULE DOES NOT BACKFILL OR REPLAY ANYTHING; until a profile is
 * rebuilt it is discounted, never trusted at full weight.
 */
export function identifyAffectedProfiles(
  rows: readonly ProfileQualificationInput[]
): ReadonlyArray<{ key: string; reasons: readonly string[] }> {
  const out: Array<{ key: string; reasons: readonly string[] }> = [];
  for (const r of rows) {
    const q = profileQualification(r);
    if (!q.complete) out.push({ key: `${r.variant ?? '?'}:${r.mode ?? '?'}:${r.size ?? '?'}|${r.user_id ?? '?'}`, reasons: q.reasons });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// CONSUMER HELPERS. Each returns "no adjustment" (false, 0, null) for an
// unknown, neutral, released, discounted or non-hold'em read, and every one
// only ever moves a Horse toward folding: the style read never widens a call.
// Each documents mechanism, applicability, evidence, confidence requirement,
// magnitude and stand-down (STYLE-READ-CONTRACT.md repeats them).
// ─────────────────────────────────────────────────────────────────────────

/** A read a consumer may act on at all: supported, hold'em family, not released to stand-down. */
function actionable(style: OpponentStyleRead | null | undefined): style is OpponentStyleRead {
  return (
    !!style &&
    style.consumersMayAct &&
    style.evidence.state === 'supported_individual_read' &&
    !style.release.standDown
  );
}

/**
 * OPTION #2 - A VALUE BETTOR IS NOT A MANIAC.
 *  mechanism   the legacy rule (postflop AF > 2.5 sets callDownMod 1.2) keeps neutral 1.0
 *  applies     hold'em family, cash and tournament, when AF > 2.5 on the ratio alone
 *  evidence    betting-range evidence value-weighted at confidence >= valueBettorMinConfidence, OR
 *              credibly tight with aggression not credibly aggressive, not bluff-weighted, bet
 *              frequency when checked to not credibly high
 *  confidence  supported read; a profile capped by provenance or release cannot reach the line
 *  magnitude   at most 0.2 of callDownMod (1.2 -> 1.0); never below neutral
 *  stand-down  release fraction >= 0.5 (fast or recent window shows him betting above the Horse mean)
 *  note        'raises more than Horses' alone is not a maniac and is not an excuse to switch layers off
 */
export function isValueBettor(style: OpponentStyleRead | null | undefined): boolean {
  if (!actionable(style)) return false;
  const T = STYLE_THRESHOLDS;
  const r = style.bettingRange;
  if (style.confidenceCap < T.valueBettorMinConfidence) return false;
  if (r.side === 'value-weighted') return true;
  return (
    style.participation.side === 'tight' &&
    style.aggression.side !== 'aggressive' &&
    r.side !== 'bluff-weighted' &&
    style.signals.betCheckedTo.side !== 'high'
  );
}

export interface BigBetSpot {
  street: 'flop' | 'turn' | 'river';
  /** the wager as a share of the pot before it */
  potFraction: number;
  /** the wager is a raise over a bet */
  isRaise: boolean;
  /** hero holds a blocker to the value hands (blocker context at the decision) */
  heroHasBlocker?: boolean;
}

/**
 * OPTION #3 - BIG-BET RESPECT (extra fold weight).
 *  mechanism   extra respect added to the call-down scalar, capped at the existing +0.15 INCLUDING the V16 tell
 *  applies     hold'em family; a large RIVER bet (>= 0.66 pot): shown strength (discounted, capped) plus
 *              frequency evidence; a large TURN bet and any RIVER RAISE: frequency evidence only, half weight
 *              (shown strength was measured on big river BETS and is not generalised); never a small bet,
 *              never the flop
 *  evidence    betting-range evidence value-weighted
 *  confidence  supported read; scaled by confidenceCap (provenance, release)
 *  magnitude   <= bigBetRespectCap (0.15); halved when hero holds a blocker
 *  stand-down  release fraction >= 0.5; shrinks proportionally before that
 */
export function bigBetRespect(style: OpponentStyleRead | null | undefined, spot: BigBetSpot): number {
  if (!actionable(style) || style.bettingRange.side !== 'value-weighted') return 0;
  const T = STYLE_THRESHOLDS;
  const e = style.bettingRange.evidence;
  const large = num(spot.potFraction) >= T.bigBetMinPotFraction;
  let share: number;
  let basis: number;
  if (spot.street === 'river' && spot.isRaise) {
    share = T.bigBetNonRiverBetShare;
    basis = e.frequencyValue;
  } else if (spot.street === 'river' && large) {
    share = 1;
    basis = noisyOr([e.shownValue, e.frequencyValue]);
  } else if (spot.street === 'turn' && !spot.isRaise && large) {
    share = T.bigBetNonRiverBetShare;
    basis = e.frequencyValue;
  } else return 0;
  const blocker = spot.heroHasBlocker === true ? T.bigBetBlockerShare : 1;
  return T.bigBetRespectCap * share * clamp(basis / T.rangeFullScore, 0, 1) * blocker;
}

/**
 * OPTION #4 - RAISE RESPECT (flop and turn, one pair and worse).
 *  mechanism   equity shaded off a one-pair-or-worse call of a raise
 *  applies     hold'em family, heads-up, flop and turn; same hand class as V66; the caller stands down
 *              with side pots, bounty events and a maniac read
 *  evidence    postflop bet-and-raise share credibly below the Horse mean (the raise-frequency PROXY)
 *  confidence  supported read; magnitude and confidence scaled, confidenceCap applied
 *  magnitude   <= raiseShadeCap (0.06 equity); ramps with DECISION-TIME SPR (effective stack behind before
 *              the decision over the pot including his bet) from 0 at raiseSprStandDown to full at raiseSprFull
 *  stand-down  SPR at or below raiseSprStandDown (one pair is a correct stack-off); release >= 0.5
 */
export function raiseRespectShade(
  style: OpponentStyleRead | null | undefined,
  spot: { decisionSpr: number }
): number {
  if (!actionable(style)) return 0;
  const s = style.signals.aggressionShare;
  if (s.side !== 'low') return 0;
  const T = STYLE_THRESHOLDS;
  const depth = clamp((num(spot.decisionSpr) - T.raiseSprStandDown) / (T.raiseSprFull - T.raiseSprStandDown), 0, 1);
  return T.raiseShadeCap * clamp((s.magnitude * s.confidence) / 0.5, 0, 1) * depth * (1 - style.release.fraction) * style.confidenceCap;
}

export interface TightRaiserOpen {
  /** the share of all hands he raises, shrunk (read as the opener range width) */
  rangeWidth: number;
  maxBarMove: number;
  callBump: number;
}

/**
 * OPTION #6a - TIGHT OPENER (preflop, facing one raise).
 *  applies     hold'em family; the consumer stands down at push/fold depths (<= pushFoldStandDownBB)
 *  evidence    participation tight with PFR credibly below the Horse mean
 *  magnitude   3-bet bar move <= 0.1, call bar +0.04, scaled by confidence and (1 - release)
 *  stand-down  release >= 0.5
 */
export function tightOpenerRespect(style: OpponentStyleRead | null | undefined): TightRaiserOpen | null {
  if (!actionable(style)) return null;
  if (style.participation.side !== 'tight' || style.signals.pfr.side !== 'low') return null;
  const T = STYLE_THRESHOLDS;
  const k = clamp(style.participation.confidence, 0, 1) * (1 - style.release.fraction);
  return {
    rangeWidth: Math.max(T.tightRangeFloor, style.signals.pfr.mean),
    maxBarMove: T.tightOpenerMaxBarMove * k,
    callBump: T.tightOpenerCallBump * k,
  };
}

export interface TightReRaiser {
  fourBetBump: number;
  callBump: number;
}

/**
 * OPTION #6b - TIGHT RE-RAISER (preflop, facing a 3-bet or more).
 *  evidence    three-bets PER OPPORTUNITY credibly below the Horse mean (>= 8 opportunities), or, with fewer,
 *              tight with a credibly low PFR; withdrawn when his 3-bet signal turns high
 *  magnitude   4-bet bar +0.03, call bar +0.06, scaled by confidence and (1 - release)
 *  stand-down  push/fold depths; release >= 0.5
 */
export function tightReRaiserRespect(style: OpponentStyleRead | null | undefined): TightReRaiser | null {
  if (!actionable(style) || style.signals.threeBet.side === 'high') return null;
  const viaThreeBet = style.signals.threeBet.side === 'low';
  const viaEntry = style.participation.side === 'tight' && style.signals.pfr.side === 'low';
  if (!viaThreeBet && !viaEntry) return null;
  const T = STYLE_THRESHOLDS;
  const k = clamp(viaThreeBet ? style.signals.threeBet.confidence : style.participation.confidence, 0, 1) * style.confidenceCap * (1 - style.release.fraction);
  return { fourBetBump: T.tightReRaiserFourBetBump * k, callBump: T.tightReRaiserCallBump * k };
}
