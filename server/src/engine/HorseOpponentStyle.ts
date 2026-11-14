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
  exploitHandIncrements,
  type ExploitCounters,
  type ExploitHandAction,
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
/** The telemetry label for the neutral, no-evidence read (a machine value, not page copy). */
export const STYLE_LABEL_UNKNOWN: StyleLabel = 'unknown';

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
export function styleFamilyOf(
  variant: string | null | undefined,
  scope: ReadScope | null
): StyleFamily {
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
    /** #4 per-street raise per raise opportunity: the exploit layer's envelope margin (0.03, HOE) */
    streetRaise: 0.03,
  }),
  minHalfBand: 0.04,
  /**
   * #4 HORSE REFERENCE (M2, 2026-11-13; review L-d): the Horse population's own raise-per-opportunity rate on that
   * street, in that variant, format and table size, is used only when its standard error is at most half the street
   * raise margin (the family-scaled margin.streetRaise): n >= p(1 - p) / (margin / 2)^2. Reason: the posterior treats the
   * reference as a point, so the reference's own noise must sit well inside the margin the opponent has to clear, at
   * every reference rate (0.1 needs about 400 opportunities at margin 0.03, 0.3 about 930). This floor is an absolute
   * minimum under that rule.
   */
  streetRaiseReferenceMinOpps: 200,

  /** Participation axis weights (sum 1) and the score a credible side needs. */
  participationWeights: Object.freeze({ vpip: 0.65, callShare: 0.35 }),
  participationSideScore: 0.2,
  /** Aggression axis weights (sum 1) and the score a credible side needs. */
  aggressionWeights: Object.freeze({
    pfr: 0.3,
    threeBet: 0.2,
    betCheckedTo: 0.25,
    aggressionShare: 0.25,
  }),
  aggressionSideScore: 0.2,

  /** Betting-range evidence: weight of each frequency source, noisy-or combined per side. */
  rangeWeights: Object.freeze({
    aggressionShare: 0.6,
    threeBet: 0.4,
    betCheckedTo: 0.4,
    preflopRaise: 0.3,
  }),
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
  /**
   * VALUE EXTRACTION (A4): against a credible caller whose shown holdings are not value-weighted. Value size up to
   * +valueSizeMax, value bar thinner by up to valueThinShiftMax equity, slow-play frequency cut by up to
   * valueSlowplayCut only when he rarely bets himself (traps stay when he bets for us). Scaled by the calling
   * signal's confidence, the confidence cap and (1 - calling release); calling release ramps as his fast-window
   * fold-to-bet rises credibly above the Horse mean (a falling call rate).
   */
  valueSizeMax: 0.25,
  valueThinShiftMax: 0.03,
  valueSlowplayCut: 0.5,
  /**
   * POSTFLOP-FOLD BLUFFING (item 3): bluff frequency follows fold-to-bet BY STREET (river: 1 - river call; flop and
   * turn: postflop fold-to-bet), never the all-street rate. Up to +foldBluffUpMax against a credible folder, down to
   * -foldBluffDownMax against a credible caller. The increase is withheld (multiplier capped at 1) against anyone
   * whose aggression or bet-when-checked-to is credibly high, or whose shown big bets are bluff-weighted: a player who
   * folds to bets but attacks when checked to can be faking folds to trap.
   */
  foldBluffUpMax: 0.25,
  foldBluffDownMax: 0.3,
  /** #4: DECISION-TIME stack-to-pot ratio (effective stack behind before the decision over the
   *  pot including his bet). Stands down at or below, full at or above. DEVELOPMENT-derived. */
  raiseSprStandDown: 2,
  raiseSprFull: 6,
  /** #4: the evidence (magnitude times confidence) at which raise respect reaches full weight; also the least
   *  confidence the passive read needs before the value-raise arm (#4b) acts at all. */
  raiseRespectFullEvidence: 0.5,
  /**
   * #4b VALUE RAISE (2026-11-14): a turn or river raise over the Horse's own wager from a credibly passive player
   * is read through a value-heavier raise stratum. Evidence bar: at least this many of his own raise opportunities
   * on the turn and river together (streets with a Horse reference), on top of the per-street minimum. Weight: 1
   * while his raise rate on the street is at or below the Horse rate, falling linearly to 0 at twice that rate; and
   * by raise size, full from valueRaiseFullSize times the bet, half at valueRaiseHalfSize, linear between and below.
   * CALIBRATE: no league or expected-value validation yet.
   */
  valueRaiseMinStreetOpps: 20,
  valueRaiseFullSize: 3,
  valueRaiseHalfSize: 2,
  /**
   * #4b COMMITMENT PRICE: when a call would leave the raiser at most this share of the pot after the call, the river
   * wager is already priced in, so the continue decision is taken at the whole-commitment price and a continue puts
   * the rest in at once.
   */
  raiseCommitRemainderMaxPot: 0.25,
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
  valueRaise: Object.freeze({
    unit: 'weight of the value-heavy raise stratum in the blended equity (0 to 1)',
    max: 1,
    note: 'turn and river, cash, two pair or worse facing a raise over its own wager; scaled by his street raise rate and by the raise size; decides only when the blended equity is under the price laid; never against an unknown, neutral or aggressive read',
  }),
  valueExtraction: Object.freeze({
    unit: 'value size multiplier / value equity bar / slow-play multiplier',
    max: STYLE_THRESHOLDS.valueSizeMax,
    note: 'size up to +0.25, bar up to 0.03 thinner, slow-play cut up to 50% only against a non-bettor',
  }),
  postflopFoldBluff: Object.freeze({
    unit: 'bluff frequency multiplier',
    max: STYLE_THRESHOLDS.foldBluffUpMax,
    note: 'per street; down to 0.3 against callers; increase withheld against possible fold-faking trappers',
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
  /** river first bets of the sizes behind bigBetSD, shown or not (the opportunity count of the availability discount);
   *  when absent, postAggr stands in */
  shownOpportunities?: number;
}

/**
 * H1 (review 2026-11-13): the shown-strength tallies of ONE format and variant, from that context's river size
 * buckets: river first bets of half the pot or more (medium, large, overbet), how many were shown down and how many
 * of those were strong. The style read takes shown strength from here, never from pooled lifetime tallies.
 */
export function inFormatShownTallies(buckets: SizeBucketTallies | null | undefined): StyleTallies {
  let bets = 0;
  let shown = 0;
  let strong = 0;
  for (const b of ['medium', 'large', 'overbet'] as const) {
    bets += Math.max(0, num(buckets?.[b]?.bets));
    shown += Math.max(0, num(buckets?.[b]?.shown));
    strong += Math.max(0, num(buckets?.[b]?.strong));
  }
  return {
    bigBetSD: shown,
    bigBetSDStrong: Math.min(strong, shown),
    shownOpportunities: Math.max(bets, shown),
  };
}

/**
 * Where the counters came from and whether they are complete. A profile built
 * before complete observations (before the memory repair, without its public
 * domain, with its back-fill pending) is DISCOUNTED: its confidence is capped
 * and no consumer may rely on it.
 */
/** The four statistics whose stored counts depend on which hands reached showdown. */
export const PRE_REPAIR_STATS = Object.freeze([
  'foldToBet',
  'riverCall',
  'foldTo3Bet',
  'betCheckedTo',
] as const);
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
export function preRepairKeyed(
  mode: string | null | undefined,
  publicDomain: unknown
): boolean | null {
  if (mode !== 'cash') return false;
  const speed =
    publicDomain && typeof publicDomain === 'object'
      ? (publicDomain as { speed?: unknown }).speed
      : undefined;
  if (speed === 'table') return true;
  if (speed === 'lightning') return false;
  return null;
}

export function preRepairStateOf(prov: StyleProvenance | null | undefined): PreRepairState {
  const v = prov?.preRepair;
  return v === true
    ? 'affected'
    : v === false
      ? 'not_affected'
      : v === null
        ? 'unknown_domain'
        : 'not_supplied';
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
export function preRepairDiscount(
  prov: StyleProvenance | null | undefined,
  stat: PreRepairStat
): PreRepairDiscount {
  const state = preRepairStateOf(prov);
  if (state !== 'affected' && state !== 'unknown_domain')
    return { applies: false, bound: 1, weight: 1, excluded: false };
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
  /** A2: river first bets by size bucket, with how many were shown down and how many of those were strong */
  sizeBuckets?: SizeBucketTallies | null;
  /** #4 (M2): this opponent's in-format postflop aggression and raise opportunities by street */
  streetAggression?: StreetAggression | null;
  /** #4 (M2): the Horse population's counts in the same variant, format and table size (its reference) */
  horseStreetReference?: StreetAggression | null;
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
  readonly availability: {
    shown: number;
    opportunities: number;
    revealedShare: number;
    discount: number;
  };
  /** side:mean:n of every statistic, rounded for telemetry */
  readonly signals: Readonly<Record<string, string>>;
  /** features the decision-time counters cannot carry; consumers condition on them at the decision */
  readonly notAvailable: readonly string[];
}

/** River first-bet size buckets, as a share of the pot before the bet. */
export const SIZE_BUCKETS = Object.freeze(['small', 'medium', 'large', 'overbet'] as const);
export type SizeBucket = (typeof SIZE_BUCKETS)[number];
/** under 0.5 pot small; 0.5 to under 0.66 medium; 0.66 to 1.0 large; above 1.0 overbet */
export function sizeBucketOf(potFraction: number): SizeBucket {
  const f = num(potFraction);
  return f < 0.5 ? 'small' : f < 0.66 ? 'medium' : f <= 1 ? 'large' : 'overbet';
}
/** Per bucket: river first bets made (shown or not), of them called and shown down, of those strong. */
export type SizeBucketTallies = Partial<
  Record<SizeBucket, { bets: number; shown: number; strong: number }>
>;
export interface SizedShownSignal {
  bets: number;
  shown: number;
  strong: number;
  /** shrunk share of shown hands that were strong */
  share: number;
  side: 'value' | 'bluff' | null;
  magnitude: number;
  /** the shown-versus-unshown discount: availabilityFloor + (1 - floor) x min(1, shown / bets / availabilityFullShare) */
  discount: number;
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
  /** revealed strength split by the size of the river bet that was called (A2) */
  shownBySize: Readonly<Record<SizeBucket, SizedShownSignal>>;
  /** share of his first wagers into an unbet street that were probes (the sizing bucket), or null */
  probeShare: number | null;
  /** #4 (M2): raises per raise opportunity by street against the in-format Horse reference (neutral without one) */
  streetRaise?: Readonly<Record<'flop' | 'turn' | 'river', StyleSignal>>;
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
  /** 0..1: how far his recent (fast window) fold-to-bet has risen above the Horse mean; releases value extraction */
  readonly callingRelease: number;
  /** multiplier in (0,1] every confidence carries: provenance and release */
  readonly confidenceCap: number;
  readonly signals: OpponentStyleSignals;
  readonly receipt: StyleReceipt;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const noisyOr = (xs: readonly number[]): number =>
  1 - xs.reduce((p, x) => p * (1 - clamp(x, 0, 1)), 1);

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
    callable && p.n >= minOpps
      ? p.pAbove >= credibility
        ? 'high'
        : p.pBelow >= credibility
          ? 'low'
          : null
      : null;
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
export const STYLE_POPULATION_PRIOR: Readonly<
  Record<
    StyleFamily,
    Omit<PopulationPrior, 'weight' | 'measuredIndividualTrait' | 'mayDisableProtection'>
  >
> = Object.freeze(
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
  ) as Record<
    StyleFamily,
    Omit<PopulationPrior, 'weight' | 'measuredIndividualTrait' | 'mayDisableProtection'>
  >
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
    callingRelease?: number;
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
    release: Object.freeze({
      fraction: round4(parts.release.fraction),
      source: parts.release.source,
    }),
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
    callingRelease: round4(parts.callingRelease ?? 0),
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
    shownBySize: sizedShown(null),
    probeShare: null,
  });

function sizedShown(
  t: SizeBucketTallies | null | undefined
): Readonly<Record<SizeBucket, SizedShownSignal>> {
  const T = STYLE_THRESHOLDS;
  const mid = (T.bigBetValueShare + T.bigBetBluffShare) / 2;
  const out = {} as Record<SizeBucket, SizedShownSignal>;
  for (const b of SIZE_BUCKETS) {
    const r = t?.[b];
    const shown = Math.max(0, num(r?.shown));
    const bets = Math.max(shown, num(r?.bets));
    const strong = clamp(num(r?.strong), 0, shown);
    const share =
      (strong + T.bigBetPriorStrength * T.bigBetPriorShare) / (shown + T.bigBetPriorStrength);
    let side: SizedShownSignal['side'] = null;
    let magnitude = 0;
    if (shown >= STYLE_FAMILY_PARAMS.holdem.bigBetMinShown) {
      if (share >= T.bigBetValueShare)
        ((side = 'value'), (magnitude = clamp((share - mid) / (T.bigBetValueShare - mid), 0, 1)));
      else if (share <= T.bigBetBluffShare)
        ((side = 'bluff'), (magnitude = clamp((mid - share) / (mid - T.bigBetBluffShare), 0, 1)));
    }
    const revealed = bets > 0 ? shown / bets : 0;
    const discount =
      T.availabilityFloor +
      (1 - T.availabilityFloor) * clamp(revealed / T.availabilityFullShare, 0, 1);
    out[b] = Object.freeze({ bets, shown, strong, share, side, magnitude, discount });
  }
  return Object.freeze(out);
}

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
  return buildRead(
    family,
    prior.available && prior.weight > 0 ? 'population_prior' : 'no_reliable_individual_evidence',
    hands,
    {
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
      label: STYLE_LABEL_UNKNOWN,
    }
  );
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
  const provCap =
    complete === false ? T.incompleteProfileCap : complete === null ? T.unqualifiedProfileCap : 1;
  const discounts = PRE_REPAIR_STATS.map((stat) => [stat, preRepairDiscount(prov, stat)] as const);
  const provenance: StyleProvenanceReceipt = {
    source: prov.source ?? 'unknown',
    complete,
    cap: provCap,
    preRepair: preRepairStateOf(prov),
    discounted: Object.freeze(discounts.filter(([, d]) => d.excluded).map(([stat]) => stat)),
  };
  const repairOf = (stat: PreRepairStat): PreRepairDiscount =>
    discounts.find(([name]) => name === stat)![1];
  if (!scope) return unknownStyle('no_scope', scope, variant, domain, 0, provenance);
  const envelope = exploitEnvelopeFor(scope, variant);
  if (!envelope) return unknownStyle('no_population_cell', scope, variant, domain, 0, provenance);

  const merged = carryOverCounters(input.counters, input.carry, input.carryWeight ?? T.carryWeight);
  const c = merged.counters;
  const tallies = input.tallies ?? {};
  const counterHands = Math.max(0, num(c?.hands));
  // H2 (review 2026-11-13): only in-scope counter hands (this format and variant, plus any explicit carry-over)
  // make a read supported. Lifetime pooled hands in the tallies never do.
  const hands = counterHands;
  // (a): unknown is neutral until 15 hands have passed, whatever else is on file.
  if (!(hands >= T.preflopMinHands))
    return unknownStyle(
      hands > 0 ? 'fewer_than_15_hands' : 'no_evidence',
      scope,
      variant,
      domain,
      hands,
      provenance
    );

  const ms = params.marginScale;
  const callable = true; // hands >= 15 holds here
  const vpipCell = envelope.vpip;
  const pfrCell = envelope.pfr;
  const callHorse = Math.max(0.01, vpipCell.mean - pfrCell.mean);
  const prefMin = T.preflopMinHands;
  const vpip = signal(
    num(c?.vpip),
    counterHands,
    vpipCell.mean,
    halfBandOf(vpipCell),
    T.margin.vpip * ms,
    prefMin,
    T.preflopCredibility,
    callable
  );
  const pfr = signal(
    num(c?.pfr),
    counterHands,
    pfrCell.mean,
    halfBandOf(pfrCell),
    T.margin.pfr * ms,
    prefMin,
    T.preflopCredibility,
    callable
  );
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
  const threeBet = signal(
    num(c?.threeBet),
    num(c?.threeBetOpp),
    threeCell.mean,
    halfBandOf(threeCell),
    T.margin.threeBet * ms,
    T.conditionedMinOpps,
    T.conditionedCredibility,
    callable
  );
  // The four showdown-dependent statistics are weighted (and held out of engagement) by the pre-repair discount.
  const dBet = repairOf('betCheckedTo');
  const betCheckedTo = dBet.excluded
    ? NEUTRAL_SIGNAL()
    : signal(
        num(c?.betCheckedTo) * dBet.weight,
        num(c?.betCheckedToOpp) * dBet.weight,
        betCell.mean,
        halfBandOf(betCell),
        T.margin.betCheckedTo * ms,
        T.conditionedMinOpps,
        T.conditionedCredibility,
        callable
      );
  const foldCell = envelope.foldToBet;
  const riverCell = envelope.riverCall;
  const dFold = repairOf('foldToBet');
  const dRiver = repairOf('riverCall');
  const foldToBet = dFold.excluded
    ? NEUTRAL_SIGNAL()
    : signal(
        num(c?.foldToBet) * dFold.weight,
        num(c?.foldToBetOpp) * dFold.weight,
        foldCell.mean,
        halfBandOf(foldCell),
        T.margin.foldToBet * ms,
        T.conditionedMinOpps,
        T.conditionedCredibility,
        callable
      );
  const riverCall = dRiver.excluded
    ? NEUTRAL_SIGNAL()
    : signal(
        num(c?.riverCall) * dRiver.weight,
        num(c?.riverCallOpp) * dRiver.weight,
        riverCell.mean,
        halfBandOf(riverCell),
        T.margin.riverCall * ms,
        T.conditionedMinOpps,
        T.conditionedCredibility,
        callable
      );
  const afN = Math.max(0, num(tallies.postAggr)) + Math.max(0, num(tallies.postPassive));
  const horseShare = params.horsePostflopAggressionShare;
  // Not measured for this family: the statistic is not read at all (neutral), never borrowed from hold'em.
  const aggressionShare =
    horseShare === null
      ? NEUTRAL_SIGNAL()
      : signal(
          Math.max(0, num(tallies.postAggr)),
          afN,
          horseShare,
          0.15,
          T.margin.aggressionShare * ms,
          T.aggressionMinActions,
          T.aggressionCredibility,
          callable
        );

  // ── SHOWN STRENGTH, with its availability discount ────────────────────
  const bigShown = Math.max(0, num(tallies.bigBetSD));
  const bigStrong = clamp(num(tallies.bigBetSDStrong), 0, bigShown);
  const share =
    (bigStrong + T.bigBetPriorStrength * T.bigBetPriorShare) / (bigShown + T.bigBetPriorStrength);
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
    // Confidence counts only the shown hands that SUPPORT the side read (strong for value, weak for bluff), so one more
    // shown bluff can never raise value evidence (fixture F065: a total-count confidence grew faster than the share fell).
    confidence: (() => {
      const support =
        shownSide === 'value' ? bigStrong : shownSide === 'bluff' ? bigShown - bigStrong : bigShown;
      return support > 0 ? support / (support + T.bigBetConfidenceHalf) : 0;
    })(),
  };
  const opportunities = Math.max(0, num(tallies.shownOpportunities ?? tallies.postAggr));
  const revealedShare = opportunities > 0 ? Math.min(1, bigShown / opportunities) : 0;
  const discount =
    T.availabilityFloor +
    (1 - T.availabilityFloor) * clamp(revealedShare / T.availabilityFullShare, 0, 1);
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
  const ramp = (p: number): number =>
    clamp(
      (p - T.releaseStartCredibility) / (T.releaseFullCredibility - T.releaseStartCredibility),
      0,
      1
    );
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
    consider(
      fastAbove(num(c.fThreeBet), num(c.fThreeBetOpp), threeCell.mean, T.margin.threeBet * ms),
      'fast_three_bet'
    );
    consider(
      fastAbove(
        num(c.fBetCheckedTo),
        num(c.fBetCheckedToOpp),
        betCell.mean,
        T.margin.betCheckedTo * ms
      ),
      'fast_bet_checked_to'
    );
  }
  const callingRelease =
    c && num(c.fFoldToBetOpp) >= EXPLOIT_FAST_MIN_N
      ? ramp(
          posterior(num(c.fFoldToBet), num(c.fFoldToBetOpp), foldCell.mean, T.margin.foldToBet * ms)
            .pAbove
        )
      : 0;
  const rn = Math.max(0, num(tallies.rAggr)) + Math.max(0, num(tallies.rPassive));
  if (horseShare !== null && rn >= T.releaseRecentActions)
    consider(
      ramp(posterior(num(tallies.rAggr), rn, horseShare, T.releaseRecentShareMargin).pAbove),
      'recent_aggression'
    );
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
  if (
    participationScore >= T.participationSideScore &&
    (vpip.side === 'high' || callShare.side === 'high')
  )
    participationSide = 'loose';
  else if (
    participationScore <= -T.participationSideScore &&
    (vpip.side === 'low' || callShare.side === 'low')
  )
    participationSide = 'tight';
  const participation: StyleAxis<'tight' | 'loose'> = {
    score: participationScore,
    side: participationSide,
    credible: participationSide !== 'neutral',
    confidence:
      participationSide === 'neutral'
        ? 0
        : Math.max(vpip.confidence, callShare.confidence) *
          (participationSide === 'tight' ? capLow : capHigh),
  };

  // ── AGGRESSION ───────────────────────────────────────────────────────
  const aw = T.aggressionWeights;
  const weighted = (sig: StyleSignal): number => sig.shift * sig.confidence;
  const aggressionScore = clamp(
    aw.pfr * weighted(pfr) +
      aw.threeBet * weighted(threeBet) +
      aw.betCheckedTo * weighted(betCheckedTo) +
      aw.aggressionShare * weighted(aggressionShare),
    -1,
    1
  );
  const aggSigs = [pfr, threeBet, betCheckedTo, aggressionShare];
  let aggressionSide: 'passive' | 'aggressive' | 'neutral' = 'neutral';
  if (aggressionScore >= T.aggressionSideScore && aggSigs.some((s) => s.side === 'high'))
    aggressionSide = 'aggressive';
  else if (aggressionScore <= -T.aggressionSideScore && aggSigs.some((s) => s.side === 'low'))
    aggressionSide = 'passive';
  const aggression: StyleAxis<'passive' | 'aggressive'> = {
    score: aggressionScore,
    side: aggressionSide,
    credible: aggressionSide !== 'neutral',
    confidence:
      aggressionSide === 'neutral'
        ? 0
        : Math.max(...aggSigs.map((s) => s.confidence)) *
          (aggressionSide === 'passive' ? capLow : capHigh),
  };

  // ── BETTING-RANGE EVIDENCE ───────────────────────────────────────────
  const rw = T.rangeWeights;
  const ev = (sig: StyleSignal, side: 'high' | 'low', w: number): number =>
    sig.side === side ? w * sig.magnitude * sig.confidence : 0;
  const shownEv = (side: 'value' | 'bluff'): number =>
    shownSide === side
      ? Math.min(T.showdownEvidenceCap, shownMag * shownStrength.confidence * discount)
      : 0;
  const frequencyValue = noisyOr([
    ev(aggressionShare, 'low', rw.aggressionShare),
    ev(threeBet, 'low', rw.threeBet),
    ev(betCheckedTo, 'low', rw.betCheckedTo),
  ]);
  const frequencyBluff = noisyOr([
    ev(aggressionShare, 'high', rw.aggressionShare),
    ev(threeBet, 'high', rw.threeBet),
    ev(betCheckedTo, 'high', rw.betCheckedTo),
    ev(pfr, 'high', rw.preflopRaise),
  ]);
  // Release is proportional: value evidence shrinks with it, bluff evidence rises with it.
  const keep = (1 - releaseFraction) * provCap;
  const evidence: BettingRangeEvidence = {
    shownValue: shownEv('value') * keep,
    shownBluff: shownEv('bluff') * capHigh,
    frequencyValue: frequencyValue * keep,
    frequencyBluff: Math.max(
      frequencyBluff * capHigh,
      T.releasedBluffEvidence * releaseFraction * capHigh
    ),
    availabilityDiscount: discount,
  };
  const valueEv = noisyOr([evidence.shownValue, evidence.frequencyValue]);
  const bluffEv = noisyOr([evidence.shownBluff, evidence.frequencyBluff]);
  const rangeScore = clamp(valueEv - bluffEv, -1, 1);
  const rangeSide: 'value-weighted' | 'bluff-weighted' | 'neutral' =
    rangeScore >= T.rangeSideScore
      ? 'value-weighted'
      : rangeScore <= -T.rangeSideScore
        ? 'bluff-weighted'
        : 'neutral';
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
  const aggressiveEnough =
    aggressionSide === 'aggressive' || (aggressionSide === 'neutral' && raiseRatio >= 0.7);
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
  else if (
    rangeSide === 'value-weighted' &&
    aggressionSide !== 'aggressive' &&
    participationSide !== 'loose'
  )
    label = 'value-heavy-passive';
  else if (participationSide === 'loose')
    label = aggressiveEnough ? 'loose-aggressive' : 'loose-passive';
  else if (participationSide === 'tight')
    label = aggressiveEnough ? 'tight-aggressive' : 'tight-passive';
  else if (aggressionSide === 'aggressive')
    label = participationScore >= 0 ? 'loose-aggressive' : 'tight-aggressive';
  else if (aggressionSide === 'passive')
    label = participationScore >= 0 ? 'loose-passive' : 'tight-passive';
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
    shownBySize: sizedShown(input.sizeBuckets),
    probeShare,
    streetRaise: streetRaiseSignals(
      input.streetAggression,
      input.horseStreetReference,
      callable,
      ms
    ),
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
    callingRelease,
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
export function profileQualification(
  p: ProfileQualificationInput | null | undefined
): ProfileQualification {
  const reasons: string[] = [];
  if (!p) return Object.freeze({ complete: false, reasons: Object.freeze(['no_profile']) });
  if (p.initialized !== true) reasons.push('backfill_pending');
  if (p.public_memory_domain === undefined || p.public_memory_domain === null)
    reasons.push('no_public_memory_domain');
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
    if (!q.complete)
      out.push({
        key: `${r.variant ?? '?'}:${r.mode ?? '?'}:${r.size ?? '?'}|${r.user_id ?? '?'}`,
        reasons: q.reasons,
      });
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
export function bigBetRespect(
  style: OpponentStyleRead | null | undefined,
  spot: BigBetSpot
): number {
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
  // A2 SIZING: on the river, what his called bets of THIS size showed decides first. Bluff-weighted at this size:
  // no respect; value-weighted at this size: that evidence (shown-vs-unshown discounted) joins the basis.
  if (spot.street === 'river') {
    const sized = style.signals.shownBySize[sizeBucketOf(num(spot.potFraction))];
    if (sized.side === 'bluff') return 0;
    if (sized.side === 'value')
      basis = noisyOr([basis, sized.magnitude * sized.discount * style.confidenceCap]);
  }
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
  spot: { decisionSpr: number; street?: 'flop' | 'turn' }
): number {
  if (!actionable(style)) return 0;
  // M2: the raise-frequency axis is THIS street's raises per raise opportunity against the in-format Horse rate,
  // never the overall postflop aggression share (bets into unbet pots are not raises).
  const s = style.signals.streetRaise?.[spot.street ?? 'flop'];
  if (!s || s.side !== 'low') return 0;
  const T = STYLE_THRESHOLDS;
  const depth = clamp(
    (num(spot.decisionSpr) - T.raiseSprStandDown) / (T.raiseSprFull - T.raiseSprStandDown),
    0,
    1
  );
  return (
    T.raiseShadeCap *
    clamp((s.magnitude * s.confidence) / T.raiseRespectFullEvidence, 0, 1) *
    depth *
    (1 - style.release.fraction) *
    style.confidenceCap
  );
}

/**
 * OPTION #4b - VALUE RAISE (same switch as #4, styleRaiseRespect).
 *  mechanism   the weight (0 to 1) with which a raise over the Horse's own wager is read as value: the caller blends
 *              the equity against a value-heavy raise stratum with the plain equity by this weight (times its own
 *              raise-size weight) and, in a cash pot where the call leaves him almost nothing behind, prices the
 *              continue at the whole commitment
 *  applies     hold'em family, cash, heads-up, TURN and RIVER only (never the flop); hero holds two pair or worse
 *  evidence    all of: (a) the aggression axis credibly passive at confidence >= raiseRespectFullEvidence. That axis
 *              mixes preflop raising with postflop betting, so (b) its postflop half must carry the read on its own:
 *              the postflop bet-and-raise share credibly low; (c) the street-raise axis itself: at least
 *              conditionedMinOpps of his raise opportunities on this street against an in-format Horse reference
 *              (no reference, no engagement) and at least valueRaiseMinStreetOpps on turn and river together.
 *              None of it needs showdown memory or a pre-repair statistic.
 *  magnitude   1 while his raise rate on this street is at or below the Horse rate, linear to 0 at twice the Horse
 *              rate; times (1 - release) and the confidence cap
 *  stand-down  unknown, unsupported, neutral or aggressive read (unknown is not tight); a bluff-weighted betting
 *              range; a high street-raise signal; release >= 0.5 (shrinks proportionally before that)
 */
export function valueRaiseWeight(
  style: OpponentStyleRead | null | undefined,
  street: 'turn' | 'river'
): number {
  if (!actionable(style)) return 0;
  const T = STYLE_THRESHOLDS;
  const a = style.aggression;
  if (a.side !== 'passive' || !a.credible || !(a.confidence >= T.raiseRespectFullEvidence))
    return 0;
  if (style.signals.aggressionShare.side !== 'low') return 0;
  if (style.bettingRange.side === 'bluff-weighted') return 0;
  const raise = style.signals.streetRaise;
  const sr = raise?.[street];
  if (
    !raise ||
    !sr ||
    !(num(sr.n) >= T.conditionedMinOpps) ||
    !(num(sr.horse) > 0) ||
    sr.side === 'high'
  )
    return 0;
  if (!(num(raise.turn?.n) + num(raise.river?.n) >= T.valueRaiseMinStreetOpps)) return 0;
  const ramp = 1 - clamp((num(sr.mean) - num(sr.horse)) / num(sr.horse), 0, 1);
  return ramp * (1 - style.release.fraction) * style.confidenceCap;
}

/** #4b: the raise-size weight. `sizeRatio` is the raise-to amount over the wager it raised. */
export function valueRaiseSizeWeight(sizeRatio: number): number {
  const T = STYLE_THRESHOLDS;
  return clamp(
    0.5 +
      (0.5 * (num(sizeRatio) - T.valueRaiseHalfSize)) /
        (T.valueRaiseFullSize - T.valueRaiseHalfSize),
    0,
    1
  );
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
export function tightOpenerRespect(
  style: OpponentStyleRead | null | undefined
): TightRaiserOpen | null {
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
export function tightReRaiserRespect(
  style: OpponentStyleRead | null | undefined
): TightReRaiser | null {
  if (!actionable(style) || style.signals.threeBet.side === 'high') return null;
  const viaThreeBet = style.signals.threeBet.side === 'low';
  const viaEntry = style.participation.side === 'tight' && style.signals.pfr.side === 'low';
  if (!viaThreeBet && !viaEntry) return null;
  const T = STYLE_THRESHOLDS;
  const k =
    clamp(viaThreeBet ? style.signals.threeBet.confidence : style.participation.confidence, 0, 1) *
    style.confidenceCap *
    (1 - style.release.fraction);
  return { fourBetBump: T.tightReRaiserFourBetBump * k, callBump: T.tightReRaiserCallBump * k };
}

/**
 * A4 VALUE EXTRACTION.
 *  mechanism   value sizing x(1 + up to 0.25), value bar thinner by up to 0.03 equity, slow-play cut by up to 50%
 *  applies     hold'em family, cash and tournament, postflop value spots; never on the Nash/push-fold path
 *  evidence    a credible calling tendency (fold-to-bet credibly LOW or river call credibly HIGH) and shown big-bet
 *              holdings not value-weighted; slow-play cut only when he rarely bets (bet-when-checked-to credibly low
 *              or aggression passive): traps stay available when he bets for us
 *  confidence  the calling signal's confidence x confidenceCap; pre-repair rows have these signals excluded
 *  magnitude   bounded above; never 'always value-bet': only sizes and bars move, no action is forced
 *  stand-down  release >= 0.5; scaled by (1 - callingRelease), a falling call rate in the fast window
 */
export interface ValueExtraction {
  sizeMul: number;
  thinShift: number;
  slowplayMul: number;
}
export function valueExtraction(
  style: OpponentStyleRead | null | undefined
): ValueExtraction | null {
  if (!actionable(style)) return null;
  const T = STYLE_THRESHOLDS;
  const sg = style.signals;
  const calls = [
    sg.foldToBet.side === 'low' ? sg.foldToBet.confidence : 0,
    sg.riverCall.side === 'high' ? sg.riverCall.confidence : 0,
  ];
  const conf = Math.max(...calls);
  // 'weak shown holdings': what his CALLED big bets showed, never the frequency-based range estimate (a passive
  // caller's low bet frequency reads value-weighted by frequency and says nothing about what he calls with).
  if (!(conf > 0) || sg.shownStrength.side === 'value') return null;
  const k = clamp(
    conf * style.confidenceCap * (1 - style.callingRelease) * (1 - style.release.fraction),
    0,
    1
  );
  if (!(k > 0)) return null;
  const rarelyBets = sg.betCheckedTo.side === 'low' || style.aggression.side === 'passive';
  return {
    sizeMul: 1 + T.valueSizeMax * k,
    thinShift: T.valueThinShiftMax * k,
    slowplayMul: rarelyBets ? 1 - T.valueSlowplayCut * k : 1,
  };
}

/**
 * ITEM 3 POSTFLOP-FOLD BLUFFING. Returns the bluff-frequency multiplier for this street, or null (no adjustment).
 *  evidence    river: river call credibly low (folds) or high (calls); flop/turn: fold-to-bet credibly high or low
 *  confidence  that signal's confidence x confidenceCap x (1 - release); pre-repair rows: signal excluded, null
 *  magnitude   1 + up to 0.25 against a folder, 1 - up to 0.3 against a caller
 *  trap guard  the increase is withheld against credibly high aggression / bet-when-checked-to or bluff-weighted
 *              shown big bets (folds to bets, attacks when checked to: can be faking folds)
 */
export function postflopFoldBluffScale(
  style: OpponentStyleRead | null | undefined,
  street: 'flop' | 'turn' | 'river'
): number | null {
  if (!actionable(style)) return null;
  const T = STYLE_THRESHOLDS;
  const sg = style.signals;
  let folds: 'more' | 'less' | null = null;
  let conf = 0;
  if (street === 'river') {
    if (sg.riverCall.side === 'low') ((folds = 'more'), (conf = sg.riverCall.confidence));
    else if (sg.riverCall.side === 'high') ((folds = 'less'), (conf = sg.riverCall.confidence));
  } else if (sg.foldToBet.side === 'high') ((folds = 'more'), (conf = sg.foldToBet.confidence));
  else if (sg.foldToBet.side === 'low') ((folds = 'less'), (conf = sg.foldToBet.confidence));
  if (!folds) return null;
  const k = clamp(conf * style.confidenceCap * (1 - style.release.fraction), 0, 1);
  if (!(k > 0)) return null;
  if (folds === 'less') return 1 - T.foldBluffDownMax * k;
  const trap =
    style.aggression.side === 'aggressive' ||
    sg.betCheckedTo.side === 'high' ||
    sg.shownStrength.side === 'bluff';
  return trap ? 1 : 1 + T.foldBluffUpMax * k;
}

/**
 * A2: each player's FIRST river wager of a hand as a share of the pot before it, replayed from the public action
 * log (bet/raise/all-in amounts are street totals, calls and posts are increments). Pure. Approximate where a log
 * omits forced posts; the bucket edges are coarse enough for that.
 */
export function riverFirstBetFractions(
  actions: ReadonlyArray<{ userId?: string; action: string; amount?: number; stage: string }>
): Map<string, number> {
  const out = new Map<string, number>();
  const street = new Map<string, number>();
  let pot = 0;
  let stage = '';
  for (const a of actions) {
    if (a.stage !== stage) {
      stage = a.stage;
      street.clear();
    }
    const id = a.userId ?? '';
    const prev = street.get(id) ?? 0;
    const amt = Math.max(0, num(a.amount));
    const wager = a.action === 'bet' || a.action === 'raise' || a.action === 'all_in';
    const inc =
      a.action === 'fold' || a.action === 'check' ? 0 : wager ? Math.max(0, amt - prev) : amt;
    if (a.stage === 'river' && a.userId && wager && inc > 0 && pot > 0 && !out.has(a.userId))
      out.set(a.userId, inc / pot);
    pot += inc;
    street.set(id, prev + inc);
  }
  return out;
}

/** One persisted hand of the exact context (hand_history row, read-only), as the supplier loads it. */
export interface PersistedHandForProvenance {
  /** completion time, epoch ms or an ISO string */
  createdAt: number | string;
  actions: readonly ExploitHandAction[];
}

/**
 * A3 PERSISTED m: the post-release opportunity count of each showdown-dependent statistic for one player,
 * RECOUNTED from data that already persists (hand_history rows of the exact context completed at or after
 * releaseStartMs) with the live learner's own increment function (exploitHandIncrements). Pure and deterministic:
 * the same history gives the same m after every daily restart, so the pre-repair discount lifts on schedule. Writes
 * nothing and keeps no counter. foldTo3Bet counts the opener's 3-bet-faced opportunities (foldTo3BetOpp).
 */
export function postReleaseOpportunitiesFromHistory(
  hands: readonly PersistedHandForProvenance[],
  userId: string,
  releaseStartMs: number
): Required<PostReleaseOpportunities> {
  const m = { foldToBet: 0, riverCall: 0, foldTo3Bet: 0, betCheckedTo: 0 };
  if (!Number.isFinite(releaseStartMs)) return m;
  for (const h of hands) {
    const t = typeof h.createdAt === 'number' ? h.createdAt : Date.parse(h.createdAt);
    if (!Number.isFinite(t) || t < releaseStartMs) continue;
    const inc = exploitHandIncrements(h.actions).get(userId);
    if (!inc) continue;
    m.foldToBet += num(inc.foldToBetOpp);
    m.riverCall += num(inc.riverCallOpp);
    m.foldTo3Bet += num(inc.foldTo3BetOpp);
    m.betCheckedTo += num(inc.betCheckedToOpp);
  }
  return m;
}

/**
 * #3 RIVER BLUFF-CATCH EQUITY CAP (2026-11-13 revision, the units fix). A bluff-catcher (one pair, or two pair that
 * shares the board's pair) beats only the bluffs in the range that bet. If his CALLED river bets have shown strong at
 * share s, the share of bluffs in that range is at most 1 - s, so the bluff-catcher's equity is at most about 1 - s.
 * The respect scalar (+0.15 at most) moves river equity by only 0.15 x 0.08 = 1.2 points, inside the 1.5-point mixing
 * band of the call: in those units the read could never change a call however strong the evidence was. This helper
 * states the read in equity units instead.
 *  evidence    s is the 10th percentile (90% one-sided, the module's credibility) of the Beta posterior of his strong
 *              share with the module's shown-strength prior (strength 3 at 0.55); the bucket of THIS bet's size decides
 *              when it has enough shown, else all his shown river bets. No availability discount: the hand being decided
 *              is a CALLED bet, the same population the showdown sample is drawn from (a Horse calls without seeing his
 *              cards), so the selection that limits generalising to all his betting does not apply here.
 *  confidence  k = confidenceCap x (1 - release). confidenceCap already carries (1 - 0.5 x release), so release counts
 *              twice here on purpose (a released read caps less, the conservative side). A shown bluff acts through s.
 *  inputs      in-format only (H1): this format's size buckets, never pooled lifetime tallies
 *  magnitude   the cap is 1 - s x k, never below 1 - s; with fewer than bigBetMinShown shown, no cap
 *  applies     hold'em river, one-pair class only (the caller checks), any size: the evidence is about his river bets
 *  stand-down  release >= 0.5; unknown or unsupported read
 */
export function bluffCatchEquityCap(
  style: OpponentStyleRead | null | undefined,
  spot: { potFraction: number }
): number | null {
  if (!actionable(style)) return null;
  const T = STYLE_THRESHOLDS;
  const min = STYLE_FAMILY_PARAMS[style.family].bigBetMinShown;
  const sized = style.signals.shownBySize[sizeBucketOf(num(spot.potFraction))];
  const all = style.signals.shownStrength;
  const src =
    sized.shown >= min
      ? { shown: sized.shown, strong: sized.strong }
      : { shown: all.shown, strong: all.strong };
  if (!(src.shown >= min)) return null;
  const a = src.strong + T.bigBetPriorStrength * T.bigBetPriorShare;
  const b = src.shown - src.strong + T.bigBetPriorStrength * (1 - T.bigBetPriorShare);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < 1 - T.conditionedCredibility) lo = mid;
    else hi = mid;
  }
  const k = clamp(style.confidenceCap * (1 - style.release.fraction), 0, 1);
  const cap = 1 - lo * k;
  return cap < 1 ? cap : null;
}

/** Showdown hand names that count as a strong (value) holding: the same list the live learner uses. */
export const STYLE_STRONG_HAND_NAMES: ReadonlySet<string> = new Set([
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
  'royal flush',
]);

/** A persisted hand with whatever showdown the row carries (absent: bets count, strength unknown). */
export interface PersistedHandForStyle extends PersistedHandForProvenance {
  showdown?: ReadonlyArray<{ user_id: string; mucked: boolean; hand_name?: string }> | null;
}

/**
 * A2 PERSISTED SIZE BUCKETS: rebuild one player's river first-bet buckets from persisted hand_history rows (read-only),
 * with the same replay the live learner uses (riverFirstBetFractions, STYLE_STRONG_HAND_NAMES). Pure and deterministic:
 * the same rows give the same buckets after every restart. A row without showdown names adds the bet but no shown hand,
 * which only lowers the revealed share (never invents strength).
 */
export function sizeBucketsFromHistory(
  hands: readonly PersistedHandForStyle[],
  userId: string
): SizeBucketTallies {
  const out: SizeBucketTallies = {};
  for (const h of hands) {
    const frac = riverFirstBetFractions(h.actions as never).get(userId);
    if (frac === undefined) continue;
    const b = sizeBucketOf(frac);
    const cell = (out[b] ??= { bets: 0, shown: 0, strong: 0 });
    cell.bets++;
    const sd = h.showdown?.find((x) => x?.user_id === userId);
    if (sd) {
      cell.shown++;
      if (!sd.mucked && STYLE_STRONG_HAND_NAMES.has((sd.hand_name ?? '').toLowerCase()))
        cell.strong++;
    }
  }
  return out;
}

/** Per street: postflop bets and raises, calls, spots facing a wager (raise opportunities) and raises made there. */
export type StreetAggression = Record<
  'flop' | 'turn' | 'river',
  { aggr: number; passive: number; raiseOpps: number; raises: number }
>;
export const emptyStreetAggression = (): StreetAggression => ({
  flop: { aggr: 0, passive: 0, raiseOpps: 0, raises: 0 },
  turn: { aggr: 0, passive: 0, raiseOpps: 0, raises: 0 },
  river: { aggr: 0, passive: 0, raiseOpps: 0, raises: 0 },
});

/**
 * #4 IN-FORMAT RAISE FREQUENCY (2026-11-13): one hand's postflop aggression per player and street, replayed from the
 * public action log. A bet, raise or raising all-in is aggression; a call (or a non-raising all-in) is passive; every
 * action taken facing a wager on the street is a raise opportunity, and a raise there is a raise. Forced actions are
 * skipped. Pure. The live learner (per format and variant) and the boot rebuild both use it, so the raise-frequency
 * axis stands on in-scope counts only.
 */
export function postflopAggressionIncrements(
  actions: ReadonlyArray<{
    userId?: string;
    action: string;
    amount?: number;
    stage: string;
    origin?: string;
    isFullRaise?: boolean;
  }>
): Map<string, StreetAggression> {
  const out = new Map<string, StreetAggression>();
  let stage = '';
  let wager = 0;
  for (const a of actions) {
    if (a.stage !== stage) {
      stage = a.stage;
      wager = 0;
    }
    if (a.stage !== 'flop' && a.stage !== 'turn' && a.stage !== 'river') continue;
    if (!a.userId || a.origin === 'forced') continue;
    const amt = Math.max(0, num(a.amount));
    const raising =
      a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && amt > wager);
    const row = out.get(a.userId) ?? emptyStreetAggression();
    const st = row[a.stage as 'flop' | 'turn' | 'river'];
    const facing = wager > 0;
    if (facing && (a.action === 'fold' || a.action === 'call' || raising || a.action === 'all_in'))
      st.raiseOpps++;
    if (raising) {
      st.aggr++;
      if (facing) st.raises++;
      wager = Math.max(wager, amt);
    } else if (a.action === 'call' || a.action === 'all_in') st.passive++;
    out.set(a.userId, row);
  }
  return out;
}

export function addStreetAggression(
  base: StreetAggression | undefined,
  inc: StreetAggression
): StreetAggression {
  const out = emptyStreetAggression();
  for (const st of ['flop', 'turn', 'river'] as const)
    for (const k of ['aggr', 'passive', 'raiseOpps', 'raises'] as const)
      out[st][k] = (base?.[st][k] ?? 0) + inc[st][k];
  return out;
}

/** #4: the in-format postflop aggression tallies (summed over streets) the classifier reads as postAggr / postPassive. */
export function inFormatAggressionTallies(a: StreetAggression | null | undefined): StyleTallies {
  if (!a) return {};
  let aggr = 0;
  let passive = 0;
  for (const st of ['flop', 'turn', 'river'] as const) {
    aggr += a[st].aggr;
    passive += a[st].passive;
  }
  return { postAggr: aggr, postPassive: passive };
}

/**
 * #4 (M2): per-street raise-per-opportunity signals. The reference is the Horse population's rate on that street in the
 * same variant, format and table size; without at least streetRaiseReferenceMinOpps Horse opportunities there is no
 * reference and the signal is neutral. Posterior and credibility as every conditioned statistic of this module.
 */
function streetRaiseSignals(
  opp: StreetAggression | null | undefined,
  ref: StreetAggression | null | undefined,
  callable: boolean,
  marginScale: number
): Readonly<Record<'flop' | 'turn' | 'river', StyleSignal>> {
  const T = STYLE_THRESHOLDS;
  const out = {} as Record<'flop' | 'turn' | 'river', StyleSignal>;
  for (const st of ['flop', 'turn', 'river'] as const) {
    const r = ref?.[st];
    const o = opp?.[st];
    const opps = num(r?.raiseOpps);
    if (!r || !o || !(opps >= T.streetRaiseReferenceMinOpps) || !Number.isFinite(num(r.raises))) {
      out[st] = Object.freeze(NEUTRAL_SIGNAL());
      continue;
    }
    const horse = clamp(num(r.raises) / opps, 0.001, 0.999);
    const margin = T.margin.streetRaise * marginScale;
    const se = Math.sqrt((horse * (1 - horse)) / opps);
    if (se > margin / 2) {
      out[st] = Object.freeze(NEUTRAL_SIGNAL());
      continue;
    }
    const half = Math.max(T.minHalfBand, se * 2);
    out[st] = Object.freeze(
      signal(
        num(o.raises),
        num(o.raiseOpps),
        horse,
        half,
        margin,
        T.conditionedMinOpps,
        T.conditionedCredibility,
        callable
      )
    );
  }
  return Object.freeze(out);
}

/** The players whose actions in this hand were made by the Horse policy (origin 'horse_policy'). */
export function horseSeatsOf(
  actions: ReadonlyArray<{ userId?: string; origin?: string }>
): Set<string> {
  const out = new Set<string>();
  for (const a of actions) if (a?.userId && a.origin === 'horse_policy') out.add(a.userId);
  return out;
}
