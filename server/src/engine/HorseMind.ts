import {
  multiwayRiverIncrements,
  multiwayRiverPressure,
  mergeMultiwayRiverStates,
  type MultiwayRiverReadState,
} from './HorseMultiwayRiverRead.js';
import {
  riverPositionIncrements,
  riverTripleCheckRaiseIncrements,
} from './HorseRiverPositionRead.js';
import {
  MEMORY_VARIANTS,
  memoryVariant,
  opponentMemoryKey,
  validOpponentProfile,
  type DurableOpponentProfile,
  blendOpponentMemoryWithExpiry,
  computeDonorHandClockStaleness,
  OPPONENT_MEMORY_THIN_HANDS,
  opponentMemoryDonors,
  opponentProfileVersion,
  type MemoryMode,
  type MemorySize,
  type MemoryVariant,
} from './HorseOpponentMemory.js';
import {
  respectWinner,
  isProvenWinner,
  WINNER_BLUFF_MOD,
  createWinnerReadState,
  snapshotWinnerReads,
  runWithWinnerReadState,
  resetWinnerReads,
  type HorseWinnerReadState,
} from './HorseWinnerRead.js';
import { noteFire } from './BrainTelemetry.js';
import {
  riverCallCategoryIsUsable,
  riverCallConfidenceAboveBaseline,
  type RiverCallContext,
  type RiverCallSample,
  shownRiverCallSamples,
  finalRiverCallers,
} from './HorseRiverCallEvidence.js';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * HORSE MIND — Real-Time Opponent Intelligence (V3 — 2026-07-23)
 * ═══════════════════════════════════════════════════════════════════════════════
 * The V3 upgrade layer on top of the V2 decision engine. HorseLogic computes
 * WHAT the hand is worth; HorseMind computes WHO it is worth it against.
 *
 * Capabilities (all real-time, all inside the millisecond decision budget):
 *  1. LIVE OPPONENT STATS — VPIP / PFR / 3-bet / aggression factor /
 *     fold-vs-aggression per player, accumulated from the action stream the
 *     engine already passes to every decision. No DB reads, no async, bounded
 *     memory. Works identically for horses and real players at the table.
 *  2. RANGE READING — each live opponent's preflop line THIS hand (limp /
 *     open / call / 3-bet / blind-check) maps to a hand-strength band,
 *     tightened or loosened by that specific player's observed PFR & 3-bet
 *     tendencies. A nit's open means a different range than a maniac's.
 *     V5 (2026-07-24): the band keeps narrowing street by street — every
 *     postflop bet or raise raises the floor of the read.
 *  3. RANGE-CONDITIONED SAMPLING — the Monte Carlo equity loop deals opponent
 *     hole cards FROM their read range instead of uniformly at random. Top
 *     pair vs a 3-bettor is finally priced like top pair vs a 3-bettor.
 *  4. EXPLOIT ADJUSTMENTS — bluff more into players who fold too much, value
 *     bet thinner and bluff less into stations, call down lighter vs maniacs,
 *     respect the raises of passive players. Confidence-weighted so small
 *     samples do not cause wild adjustments.
 *  5. BOARD TEXTURE — wetness scoring (flush/straight coordination, pairing)
 *     drives bet sizing (small on dry, big on wet) and bluff discipline.
 *  6. BLOCKER AWARENESS — nut-flush-blocker and top-straight-blocker checks
 *     upgrade bluff candidate selection on coordinated boards.
 *
 * ZERO external dependencies beyond engine types. All state is in-process,
 * bounded, and shared across tables (stats are per-player, table-agnostic).
 * NEVER refer to the horses as "bots" — they are HORSES only.
 */

import type { Card, SeatPlayer, ActionRecord } from '../types.js';
import { RANK_VALUES } from './PokerEngine.js';
import type { OppPostflopRead } from './HorseEval.js';
import { horseDecisionEffectsAreValid, horseMindHandKey } from './HorseDecisionEffects.js';
import {
  computeContinuationContenderFingerprint,
  type ContinuationContenderFingerprint,
} from './HorseContinuationPlanInvalidation.js';
import { horseMindHandIdentityKey, type HorseMindHandIdentity } from './HorseMindHandIdentity.js';
import {
  mergeHorseObservationWindows,
  normalizeHorseObservationWindow,
  observeHorseObservationWindow,
  type HorseObservationWindow,
} from './HorseObservationWindow.js';
import {
  barrelNarrowingScale,
  callDownRespectShift,
  exploitEnvelopeFor,
  exploitFlopStabIncrements,
  flopStabStatRead,
  statRead,
  exploitHandIncrements,
  probeAdjustedCounters,
  probeBetIndexes,
  freshExploitCounters,
  isPostflopManiac,
  looseCallerWidth,
  maniacRaiseWidth,
  mergeExploitRows,
  mergeFlopStabRows,
  observeExploitRow,
  observeFlopStabRow,
  openerRangeWidth,
  opponentExploitRead,
  presumedAggressorRead,
  neutralUnknownRead,
  postflopBluffMod,
  reRaiseLineWidth,
  reRaiseWidth,
  shortDeckStrengthBarForTopShare,
  strengthBarForTopShare,
  valueThinMod as readValueThinMod,
  type ExploitCounters,
  type FlopStabCounters,
  type OpponentExploitRead,
} from './HorseOpponentExploit.js';
import {
  fastCalldownRead,
  observeFastCalldownRiver,
  type FastCalldownRead,
} from './HorseFastCalldownRead.js';
import {
  classifyOpponentStyle,
  isValueBettor,
  postReleaseOpportunitiesFromHistory,
  sizeBucketsFromHistory,
  type PersistedHandForStyle,
  preRepairDiscount,
  type PersistedHandForProvenance,
  riverFirstBetFractions,
  inFormatShownTallies,
  inFormatAggressionTallies,
  postflopAggressionIncrements,
  horseSeatsOf,
  addStreetAggression,
  type StreetAggression,
  type StyleTallies,
  sizeBucketOf,
  type SizeBucketTallies,
  preRepairKeyed,
  profileQualification,
  unknownStyle,
  PRE_REPAIR_STATS,
  type OpponentStyleRead,
  type PostReleaseOpportunities,
  type StyleProvenance,
} from './HorseOpponentStyle.js';
import { addStyleReadMs, noteStyleShadowEngaged } from './HorseStyleShadow.js';

/** Match the controller's full-raise marker: an all-in button can be a call
 * or a short raise and must not invent an aggressive read. */
function isMindAggression(action: { action: string; isFullRaise?: boolean }): boolean {
  return (
    action.action === 'bet' ||
    action.action === 'raise' ||
    (action.action === 'all_in' && action.isFullRaise === true)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OPPONENT STATS
// ─────────────────────────────────────────────────────────────────────────────

export interface OpponentStats {
  /** Exact public cash/stake/original-population context, never legacy pooled hydration. */
  riverHu?: MultiwayRiverReadState;
  /** Original contributing timestamps, not flush/read time. Absent on legacy rows. */
  sourceWindow?: HorseObservationWindow;
  /** distinct hands this player has been observed in */
  hands: number;
  /** hands where they voluntarily put money in preflop */
  vpip: number;
  /** hands where their first voluntary preflop action was a raise */
  pfr: number;
  /** hands where they re-raised preflop */
  threeBet: number;
  /** aggressive actions (bet / raise / full-raise all-in), all streets */
  aggr: number;
  /** passive actions (calls), all streets */
  passive: number;
  /** folds observed (folds face aggression by definition of a legal fold) */
  folds: number;
  /** times they faced aggression (called, raised over, or folded to a bet) */
  facedAggr: number;
  // ── V16 DEEP READS (2026-08-26) — observed once per COMPLETED hand ──
  /** times they called preflop then faced the aggressor's flop c-bet */
  cbetOpps: number;
  /** ... and folded to it */
  cbetFolds: number;
  /** times their open raise got 3-bet */
  f3bOpps: number;
  /** ... and they folded to the 3-bet */
  f3bFolds: number;
  /** showdowns reached after they made a BIG river bet (>= 20bb) */
  bigBetSD: number;
  /** ... where the shown hand was two pair or better (value, not air) */
  bigBetSDStrong: number;
  // ── V23 RIVER READS (2026-08-28). The most profitable read in the game:
  // does this player fold rivers? Memory-only until V34 (2026-09-02), when
  // it was found that every deploy forgot the answer for exactly the players
  // the read is for; persisted now, GREATEST-merged like every counter.
  /** times they faced a river bet or raise */
  riverBetOpps: number;
  /** ... and folded to it */
  riverBetFolds: number;
  /** Public observer-window river opportunities when all remaining actors checked.
   * Rebuilt from the horse own accepted history, never a pooled donor. */
  riverLastToActOpps: number;
  riverLastToActBets: number;
  riverTripleCheckRaiseOpps: number;
  riverTripleCheckRaiseFolds: number;
  /** V7 recency window (exponentially decayed) — detects counter-adaptation */
  rHands: number;
  rFolds: number;
  rFacedAggr: number;
  rAggr: number;
  rPassive: number;
  /** V28: checks, lifetime + recent — the missing denominator of the V18
   *  self-image (aggression / actions the table SAW, not aggr / (aggr+calls),
   *  which inverted the read for both the nit and the station). */
  checks: number;
  /** POSTFLOP-ONLY aggression counters (2026-08-31). The classic Aggression
   *  Factor is a postflop statistic: preflop calling is structurally normal
   *  (blinds, position, price), so folding it into the same ratio drags a
   *  loose-preflop / hyper-aggressive-postflop player below the "passive"
   *  bar — and then the horses give that player's POT BETS more respect. */
  postAggr: number;
  postPassive: number;
  rChecks: number;
  // ── V43 TEMPO READS (2026-09-05). The action log carries a timestamp on
  // every record and nothing read it. A river bet of 20bb+ that reached
  // showdown is classed by how fast it was made: snap (under 1.5 s since the
  // previous action) or tank (8 s or more), and whether it was value.
  /** river big bets made snap that reached showdown */
  snapBetSD: number;
  /** ... where the shown hand was two pair or better */
  snapBetSDStrong: number;
  /** river big bets made after a tank that reached showdown */
  tankBetSD: number;
  /** ... where the shown hand was two pair or better */
  tankBetSDStrong: number;
  // ── RIVER CALL READS (2026-10-25). Dan ruled that a hand whose last river
  // decision was a call is shown at showdown, so every player at the table
  // now sees what an opponent called the river with. Horses learn it too
  // (CLAUDE.md 10.5): the caller-side mirror of bigBetSD.
  /** showdowns where their LAST river action was a call and the hand was shown */
  riverCallSD: number;
  /** ... where the shown hand was one pair or worse (a light call) */
  riverCallSDWeak: number;
  // ── FAST CALL-DOWN READ (2026-11-07, HorseFastCalldownRead.ts). River-
  // specific recency: decayed once per river opportunity, not per hand, so
  // blank hands do not dilute it. Pooled and memory only (never persisted;
  // HorseMindHydrator's boot replay through observe() rebuilds it).
  /** decayed river-bet opportunities */
  rvOpps?: number;
  /** ... and calls or raises of them */
  rvCalls?: number;
  // ── PROBE BETS (2026-11-08, HorseOpponentExploit probeBetIndexes). How
  // many of this player's postflop bets into an unbet street were probes (a
  // big blind, or a fifth of the pot or less). Counted only when the
  // observation knows the big blind. Pooled and memory only, like rvOpps:
  // never persisted, carried in read frames (v11) and by the mind mirror.
  /** first wagers on a postflop street, observed with a known big blind */
  ctBets?: number;
  /** ... of which probes */
  ctProbes?: number;
  // ── LIMP-RERAISE (2026-11-07, HorseLimpReraiseRead.ts). Pooled and memory
  // only, like the probe tallies.
  /** times their preflop limp met a raise behind it and they acted again */
  lrOpps?: number;
  /** ... and re-raised */
  lrRaises?: number;
}

/** V43: a bet within this many ms of the previous action is a snap. */
export const SNAP_MS = 1500;
/** V43: a bet this many ms or more after the previous action is a tank. */
export const TANK_MS = 8000;

const freshStats = (): OpponentStats => ({
  hands: 0,
  vpip: 0,
  pfr: 0,
  threeBet: 0,
  aggr: 0,
  passive: 0,
  folds: 0,
  facedAggr: 0,
  cbetOpps: 0,
  cbetFolds: 0,
  f3bOpps: 0,
  f3bFolds: 0,
  bigBetSD: 0,
  bigBetSDStrong: 0,
  riverBetOpps: 0,
  riverBetFolds: 0,
  riverLastToActOpps: 0,
  riverLastToActBets: 0,
  riverTripleCheckRaiseOpps: 0,
  riverTripleCheckRaiseFolds: 0,
  rHands: 0,
  rFolds: 0,
  rFacedAggr: 0,
  rAggr: 0,
  rPassive: 0,
  checks: 0,
  rChecks: 0,
  postAggr: 0,
  postPassive: 0,
  snapBetSD: 0,
  snapBetSDStrong: 0,
  tankBetSD: 0,
  tankBetSDStrong: 0,
  riverCallSD: 0,
  riverCallSDWeak: 0,
});

/** V83 (2026-11-06): an aggression read needs bluffs behind it. */
export interface ExploitReadOptions {
  /**
   * Default on. A postflop aggression factor above 2.5 used to read as a
   * maniac (callDownMod 1.2) on the ratio alone. With this on, an opponent
   * whose big river bets have shown down mostly as value
   * (aggressionShownAsValue) keeps neutral respect instead. False is the
   * pre-V83 read.
   */
  aggressionNeedsBluffs?: boolean;
  /**
   * STYLE READ #2 (2026-11-13, HorseOpponentStyle), default off. A value
   * bettor is not a maniac: when the postflop aggression factor is above 2.5
   * but the style read says this player's bets are credibly value (shown
   * strength of his big bets, or credibly tight with low frequencies, not
   * released by the fast window), respect stays neutral instead of callDownMod
   * 1.2, so the one-pair fold layers stay on. Only an explicit true engages.
   */
  styleValueBettor?: boolean;
  /**
   * STYLE READ pre-repair (item 10, 2026-11-13): the legacy over-folder branch (postflop fold rate above 0.62:
   * bluffMod 1.45, valueThinMod 0.85) stands down when this decision's exact profile is a pre-repair cash
   * table-speed row whose fold-to-bet is still excluded by HorseOpponentStyle.preRepairDiscount (fewer than 60
   * post-release opportunities). Hold'em scopes only. Receipt style_pre_repair_fold_rate_discounted_seen.
   * Only an explicit true engages.
   */
  styleFoldRatePreRepair?: boolean;
  /** 2026-11-13 SHADOW: compute #2 and record whether it would have changed the read; apply nothing */
  styleValueBettorShadow?: boolean;
  /** 2026-11-13 SHADOW: compute the pre-repair fold-rate stand-down and record it; apply nothing */
  styleFoldRatePreRepairShadow?: boolean;
}

/** V83: big river bets that reached showdown before the value share counts. */
export const V83_MIN_BIG_BET_SHOWDOWNS = 20;
/** V83: share of those shown as a strong hand at which aggression is value. */
export const V83_VALUE_SHARE = 0.75;

/**
 * V83: true when an opponent's big river bets (>= 20bb, called, shown down)
 * number at least V83_MIN_BIG_BET_SHOWDOWNS and at least V83_VALUE_SHARE of
 * them were a strong hand. Such a player bets a lot because they hold it,
 * so their bets earn ordinary respect even at a high aggression factor.
 */
export function aggressionShownAsValue(
  s: Pick<OpponentStats, 'bigBetSD' | 'bigBetSDStrong'> | null | undefined
): boolean {
  if (!s || !(s.bigBetSD >= V83_MIN_BIG_BET_SHOWDOWNS)) return false;
  return s.bigBetSDStrong / s.bigBetSD >= V83_VALUE_SHARE;
}

/**
 * READ CALIBRATION (2026-11-07, benchmark/HorseReadCalibration.ts).
 * A walk-forward replay of 41,013 accepted hands with humans seated
 * (2026-07-22 .. 2026-11-07, HorseReadCalibration.ts) scored every opponent
 * read against what the player did next. Two systematic errors, both read
 * the same way for every opponent:
 *
 *  - postflopFoldRate: legacyExploit's fold rate is folds / faced
 *    aggression over ALL streets, but its bluffMod prices POSTFLOP bluffs.
 *    Preflop folds to a raise dominate the ratio, so it measures preflop
 *    tightness: on 12,117 human postflop spots it predicted 38.1% folds
 *    against 45.4% actual (Brier 0.259, worse than the population prior
 *    0.247), and it filed 56% of those spots under "station, bluff x0.55"
 *    where the players actually folded 41.5%. Horses are misread the other
 *    way (68% all-street folds, 52.5% postflop). On: the rate is the
 *    postflop fold-to-bet posterior of the decision context's exploit
 *    counters (the shared-memory profile when one is loaded), Brier 0.240
 *    on the same spots; below FOLD_READ_MIN_OPPS postflop opportunities the
 *    fold-rate exploit stays neutral instead of reading preflop folds.
 *  - shrinkResponseReads: riverFoldRate and foldToCbetOf are raw k / n from
 *    8 and 10 opportunities. Below about 40 opportunities the raw rate
 *    predicted worse than the population rate; shrunk with
 *    RESPONSE_READ_PRIOR_STRENGTH pseudo-observations of the family's
 *    population rate it beats both at every sample size (out of sample:
 *    river fold 0.2193 -> 0.2159, fold to c-bet 0.2237 -> 0.2216). The
 *    sample gates and null semantics are unchanged.
 *
 * Both default off; each is a HorseDecideOpts flag measured in the league.
 */
export interface DecisionReadOptions {
  postflopFoldRate?: boolean;
  shrinkResponseReads?: boolean;
  /** Break-even postflop bluffing (see BREAK_EVEN_BLUFF below). */
  breakEvenBluff?: boolean;
  /** A thin scoped bucket is shrunk toward its own game's population
   *  instead of falling back to the pooled bucket (see readStats). */
  scopedShrink?: boolean;
  /** STYLE READ (2026-11-13): weight of the other format's counters in the style read.
   *  Absent / 0 = format-specific evidence only (the default). Needs validation to be non-zero. */
  styleCarryWeight?: number;
  /** Omaha EV fold model: the bet engine's per-opponent fold multiplier is
   *  the measured Omaha fold-over-MDF ratio scaled by the opponent's shrunk
   *  postflop fold-to-bet read (see OMAHA_EV_FOLD_MODEL below). */
  omahaEvFoldModel?: boolean;
  /** Owner directive 2026-11-13: an unknown Omaha opponent receives a neutral,
   *  explicitly uncertain read instead of the shared aggressive raise
   *  presumption. Default off until its league comparison is accepted. */
  omahaNeutralUnknown?: boolean;
}
/** Decayed postflop facing-bet opportunities before the postflop fold rate reads. */
export const FOLD_READ_MIN_OPPS = 8;
/** Pseudo-observations of the population rate in a shrunk response read. */
export const RESPONSE_READ_PRIOR_STRENGTH = 16;
/**
 * Population response rates per card family, every opponent pooled (horses
 * and humans alike, 1,620,362 scored read events in the replay above): the
 * label-free prior a shrunk read starts from.
 */
export const RESPONSE_READ_PRIOR: Readonly<
  Record<'riverFold' | 'foldToCbet', Readonly<Record<'holdem' | 'omaha' | 'sixplus', number>>>
> = Object.freeze({
  riverFold: Object.freeze({ holdem: 0.55, omaha: 0.66, sixplus: 0.52 }),
  foldToCbet: Object.freeze({ holdem: 0.46, omaha: 0.46, sixplus: 0.46 }),
});

/**
 * BREAK-EVEN POSTFLOP BLUFFING (2026-11-08, follow-up to the read
 * calibration above). An air bet of `s` times the pot risks s to win 1, so it
 * breaks even when the opponent folds s / (1 + s) of the time, and its value
 * per pot is (1 + s) x (fold - s / (1 + s)): proportional to the fold share
 * ABOVE break-even at that size. The legacy multiplier compared an all-street
 * fold rate with fixed 0.62 / 0.35 lines and no bet size; the corrected
 * postflop read alone, against those same lines, lost the horse mirror
 * (-2.32 +/- 1.09 bb/100), because the lines had been tuned against the
 * inflated read. Here the multiplier is re-derived instead:
 *
 *   fold(s)  = BREAK_EVEN_FOLD_CURVE[family](s) + (read - population)
 *   mod(s)   = BREAK_EVEN_REFERENCE_MOD x (fold(s) - s / (1 + s))
 *                                       / (curve(s_ref) - s_ref / (1 + s_ref))
 *
 * clamped to [BREAK_EVEN_MOD_MIN, BREAK_EVEN_MOD_MAX]. It replaces the
 * exploit bluff multiplier only where bluff frequency is set (HorseLogic's
 * bluff scale: bets, barrels and bluff raises); the scalar bluffMod that
 * other consumers read as a folder / station classification is unchanged.
 *  - read: the decision context's postflop fold-to-bet counters (the same
 *    counters readPostflopFoldRate and the shared memory read), shrunk toward
 *    the game's population mean (the exploit envelope cell) with
 *    BREAK_EVEN_PRIOR_STRENGTH pseudo-observations, so a short sample sits
 *    near the population and a long one speaks for itself.
 *  - curve: how often players fold to the first bet of a postflop street, by
 *    its size, measured on the accepted hands of the read calibration
 *    (2026-07-22 .. 2026-11-07, every seat pooled, no labels): players fold
 *    more to bigger bets, but not in proportion, so small bets keep the most
 *    surplus in hold'em and Omaha players barely fold to small bets.
 *  - a semi-bluff with a live draw keeps its equity when called, so its
 *    break-even fold share is lower (breakEvenFoldShare); the other bluff
 *    bets are priced as air, because their equity is mostly against the
 *    part of the range that folds.
 *  - the scale: at the reference size the population keeps the volume the
 *    ladder has been played and tuned at against that population
 *    (x1.45: horses read as folders on the legacy rate); every other read
 *    and size moves with its own surplus over break-even. Below break-even
 *    the multiplier sits at the floor (a semi-bluff still has equity).
 *
 * Read for every opponent the same way; null outside nlh / plo4-6 (no curve
 * measured) and outside a decision scope, where the legacy profile answers.
 *
 * ONLY AGAINST AN OPPONENT WHOSE BLUFF PRICE IS ALREADY READ (2026-11-08).
 * The standing law "a horse that has read nobody plays exactly as it did
 * before it could" (HorseOpponentExploitNeutrality.law) lets the exploit layer
 * move bluff frequency only against an opponent whose postflop fold-to-bet or
 * river-call read is credibly outside the measured envelope (postflopBluffMod
 * not null). The break-even multiplier is a re-pricing of that same bluff
 * read, so it follows the same gate: against any other opponent, a stranger
 * included, breakEvenBluffOf is null and the existing price answers exactly
 * as with the flag off. The first version answered for everyone, and an
 * opponent with no postflop sample got the population's x1.45 where every
 * other read gives no adjustment. The gate reads opponentRead, so a decision
 * whose reads are switched off has no break-even read either.
 */
export const BREAK_EVEN_FOLD_CURVE: Readonly<
  Record<'holdem' | 'omaha', ReadonlyArray<readonly [size: number, fold: number]>>
> = Object.freeze({
  // NLH, 18,560 first-bet responses
  holdem: Object.freeze([
    [0.24, 0.347],
    [0.34, 0.388],
    [0.44, 0.446],
    [0.55, 0.463],
    [0.67, 0.501],
    [0.81, 0.588],
    [0.99, 0.658],
    [1.22, 0.679],
    [2.43, 0.716],
  ] as const),
  // PLO4/5/6, 23,652 first-bet responses; pot-limit sizes stop at the pot
  omaha: Object.freeze([
    [0.22, 0.26],
    [0.35, 0.388],
    [0.45, 0.423],
    [0.53, 0.471],
    [0.69, 0.574],
    [0.81, 0.641],
    [0.99, 0.688],
  ] as const),
});
/** Pot fraction at which the population keeps the ladder's tuned volume. */
export const BREAK_EVEN_REFERENCE_SIZE = 0.67;
/** The ladder's tuned volume against the population at the reference size. */
export const BREAK_EVEN_REFERENCE_MOD = 1.45;
export const BREAK_EVEN_MOD_MIN = 0.3;
/** The ceiling is the legacy folder multiplier: the ladder was never tuned
 *  above it, and against the population it is already reached. */
export const BREAK_EVEN_MOD_MAX = 1.45;
/** Pseudo-observations of the population mean in the postflop fold read. */
export const BREAK_EVEN_PRIOR_STRENGTH = 16;
/** Games the fold curve was measured on. */
const BREAK_EVEN_VARIANTS = new Set(['nlh', 'plo4', 'plo5', 'plo6']);

export type BreakEvenFamily = keyof typeof BREAK_EVEN_FOLD_CURVE;

/** The population's fold share against a first bet of `size` pots. */
export function breakEvenCurveFold(family: BreakEvenFamily, size: number): number {
  const pts = BREAK_EVEN_FOLD_CURVE[family];
  const x = Math.max(pts[0][0], Math.min(pts[pts.length - 1][0], size));
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/**
 * The fold share at which a bet of `size` pots does as well as CHECKING, when
 * a call leaves it `equity` of the pot it built. Betting is worth
 * fold + (1 - fold)(equity (1 + 2s) - s) pots; checking keeps equity of the
 * pot already there. They are equal at
 *
 *   fold = s (1 - 2 equity) / (1 + s - equity (1 + 2s)),
 *
 * which is s / (1 + s) for air (equity 0) and zero from equity 0.5 (a value
 * bet). 2026-11-08 correction: the first version compared the bet with
 * giving the pot up (EV 0) rather than with checking, so any hand with about
 * a third of the equity "needed no folds" and bet at the ceiling multiplier
 * even into a calling station.
 */
export function breakEvenFoldShare(size: number, equity = 0): number {
  const e = Number.isFinite(equity) ? Math.max(0, Math.min(1, equity)) : 0;
  const s = Number.isFinite(size) && size > 0 ? size : 0;
  const gain = s * (1 - 2 * e);
  if (gain <= 0) return 0;
  return gain / (1 + s - e * (1 + 2 * s));
}

/**
 * The bluff multiplier for a bet of `size` pots into an opponent whose
 * shrunk postflop fold read sits `foldShift` above (+) or below (-) the
 * game's population mean. `equity` is what a call leaves the bet (0 for
 * air; a live draw's equity for a semi-bluff).
 */
export function breakEvenBluffMod(
  foldShift: number,
  family: BreakEvenFamily,
  size: number,
  equity = 0
): number {
  const s = Number.isFinite(size) && size > 0 ? size : BREAK_EVEN_REFERENCE_SIZE;
  const ref = BREAK_EVEN_REFERENCE_SIZE;
  const refSurplus = breakEvenCurveFold(family, ref) - breakEvenFoldShare(ref);
  const fold = Math.max(0, Math.min(1, breakEvenCurveFold(family, s) + foldShift));
  const mod = (BREAK_EVEN_REFERENCE_MOD * (fold - breakEvenFoldShare(s, equity))) / refSurplus;
  return Math.max(BREAK_EVEN_MOD_MIN, Math.min(BREAK_EVEN_MOD_MAX, mod));
}

/**
 * OMAHA EV FOLD MODEL (2026-11-08, Omaha threshold calibration). Omaha,
 * short deck, pineapple and fixed limit bet from the EV engine
 * (HorseEvEngine.evaluateSpot), which prices each opponent's fold as MDF,
 * s / (1 + s), times a fold multiplier. That multiplier was the exploit bluff
 * multiplier: x1.45 above a 0.62 all-street fold rate, x0.55 below 0.35,
 * else 1. Measured walk-forward on the 13,667 accepted PLO4/5/6 hands of the
 * read calibration (2026-07-22 .. 2026-11-07, every player's read taken
 * before the hand), fit on the first half of the timeline, scored on the
 * second: against a first postflop bet the engine predicted 37.8% folds and
 * players folded 52.0% (flop and turn, 9,268 responses; Brier 0.2471 against
 * 0.2218 for this model). Against people it predicted 20.9% and they folded
 * 35.7%, because the all-street rate counts preflop calls of raises, which
 * Omaha players make constantly: 85% of human Omaha postflop spots read as a
 * station (x0.55) and those players folded 40%.
 *
 *   foldMul = foldOverMdf x shrunk(fold to a postflop bet) / population
 *
 * foldOverMdf: every first postflop flop or turn bet's responses at cash
 * tables, every seat pooled, no labels: the fold share over the mean MDF of
 * the sizes faced. population: the same game's cash postflop fold-to-bet
 * counter rate (the exploit counters' own definition, every player), and
 * the shrink uses OMAHA_EV_FOLD_PRIOR_STRENGTH pseudo-observations of it, so
 * a stranger is the population and a long sample speaks for itself.
 * Full-sample cash constants: flop/turn responses PLO4 5,125, PLO5 12,104,
 * PLO6 1,031; counter opportunities 6,909 / 16,002 / 1,528. mdfFold clamps
 * the multiplier to 0.4 .. 1.8.
 *
 * CASH ONLY. Tournament Omaha players fold about MDF to a flop or turn bet
 * (fold over MDF PLO4 1.09, PLO5 1.04, PLO6 1.05 on 693 tournament
 * responses), and the first league run that priced tournaments with the cash
 * ratio lost the PLO4 40bb tournament mirror (-3.25 +/- 1.16 and -5.26 +/-
 * 1.18 bb/100), so a tournament decision keeps the exploit multiplier.
 * Only the EV engine reads it (HorseMind.evFoldMul); the scalar bluffMod
 * every other consumer classifies by is unchanged.
 */
export type OmahaEvFoldVariant = 'plo4' | 'plo5' | 'plo6';
export const OMAHA_EV_FOLD_MODEL: Readonly<
  Record<OmahaEvFoldVariant, Readonly<{ foldOverMdf: number; population: number }>>
> = Object.freeze({
  plo4: Object.freeze({ foldOverMdf: 1.289, population: 0.49 }),
  plo5: Object.freeze({ foldOverMdf: 1.458, population: 0.536 }),
  plo6: Object.freeze({ foldOverMdf: 1.409, population: 0.497 }),
});
/** Pseudo-observations of the population fold rate in the Omaha EV fold read. */
export const OMAHA_EV_FOLD_PRIOR_STRENGTH = 16;

/** Exploit multipliers derived from a specific opponent's tendencies. */
export interface ExploitProfile {
  /** multiply bluff/semi-bluff frequency by this (1 = neutral) */
  bluffMod: number;
  /** >1 = call their aggression lighter; <1 = respect it more */
  callDownMod: number;
  /** >1 = value bet thinner into this player */
  valueThinMod: number;
  /** Break-even bluffing only (tableExploit, readBreakEvenBluff): the
   *  postflop bluff multiplier at BREAK_EVEN_REFERENCE_SIZE for the weakest
   *  responder. HorseLogic's bluff scale reads it in place of bluffMod;
   *  bluffMod itself, and every consumer that classifies an opponent by it,
   *  is unchanged. Absent = flag off or no measured fold curve. */
  breakEvenBluff?: number;
  /** That responder's shrunk postflop fold read minus the population mean,
   *  so a bet prices its own size (breakEvenBluffMod). */
  foldShift?: number;
}

const NEUTRAL_EXPLOIT: ExploitProfile = { bluffMod: 1, callDownMod: 1, valueThinMod: 1 };

/** V16: hand names that count as VALUE behind a big river bet. */
const STRONG_HAND_NAMES = new Set([
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
  'royal flush',
]);

// ─────────────────────────────────────────────────────────────────────────────
// BOARD TEXTURE
// ─────────────────────────────────────────────────────────────────────────────

export interface BoardTexture {
  /** 0 = bone dry, 1 = maximally coordinated */
  wetness: number;
  /** 3+ cards of one suit on board */
  monotone: boolean;
  /** exactly 2 of one suit (flush draw possible) */
  twoTone: boolean;
  paired: boolean;
  /** 3+ ranks within a 5-rank window (straights live) */
  straighty: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// HORSE MIND
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TRACKED_PLAYERS = 4000;
/** 2026-10-16: the exploit store holds (scope, player) rows, up to four
 *  scopes a player on average; evicted least recently updated first. */
const EXPLOIT_ROW_CAP = MAX_TRACKED_PLAYERS * 4;
/** STYLE READ A2 / H1: river size buckets are kept per (player, variant, format, table size). */
const styleSizeKey = (userId: string, variant: string, mode: string, size: string): string =>
  `${variant}|${mode}|${size}|${userId.toLowerCase()}`;
const EMPTY_EXPLOIT_ROWS: ReadonlyMap<string, ExploitCounters> = new Map();
const MAX_SEEN_ACTIONS = 60_000;
const MAX_HAND_FLAGS = 20_000;

/**
 * V12.3: drop the oldest entries until `size` is back under `cap` (a quarter
 * of the cap is reclaimed, so this amortizes to O(1) per observe call).
 * Returns the evicted keys so a parallel dirty-set can be pruned with them.
 * Map and Set iterate in insertion order, which is what makes "oldest" here
 * mean "least recently first seen" — and what keeps hands in flight, always
 * among the newest entries, safe from eviction.
 */
function evictOldest<K>(store: Map<K, unknown> | Set<K>, cap: number): K[] {
  if (store.size <= cap) return [];
  const target = Math.max(0, Math.floor(cap * 0.75));
  const evicted: K[] = [];
  for (const key of store.keys() as IterableIterator<K>) {
    if (store.size - evicted.length <= target) break;
    evicted.push(key);
  }
  for (const key of evicted) (store as Map<K, unknown>).delete(key);
  return evicted;
}

/** A spare, isolated set of HorseMind's state containers (V12.2). Opaque to
 *  callers — create with HorseMind.createSandbox(), use via runInSandbox(). */
export interface HorseMindSandbox {
  /** Absent only on predecessor snapshots; never falls through to live reads. */
  winnerReads?: HorseWinnerReadState;
  stats: Map<string, OpponentStats>;
  seenActions: Set<string>;
  handFlags: Set<string>;
  dirty: Set<string>;
  pairs: Map<string, { n3: number; opp3: number; nR: number; oppR: number }>;
  dirtyPairs: Set<string>;
  plans: Map<string, boolean>;
  /** V23: raise-response plans — see noteRaisePlan. Sandboxed like plans. */
  raisePlans: Map<string, RaiseResponsePlan>;
  /** V39: next-street outlooks — see noteOutlook. Sandboxed like plans. */
  outlooks: Map<string, { good: Set<string>; scare: Set<string> }>;
  /** V45: the scoped overlay - sandboxed like stats, or a league run's
   *  scoped counters would leak into the live fleet and into the next run. */
  scoped: Map<string, OpponentStats>;
  dirtyScoped: Set<string>;
  /** 2026-10-16 opponent exploit: decayed per-(scope, player) counters,
   *  keyed `${scope}|${userId}`. Memory only, never flushed to the DB. */
  exploit: Map<string, ExploitCounters>;
  /** V86 flop-only checked-to stab counters, keyed `${scope}|${userId}`. */
  flopStab?: Map<string, FlopStabCounters>;
  /** Items 21 and 23 (2026-11-05): the contender and stack-exposure
   *  fingerprint a planned barrel expects to meet on the next street, keyed
   *  like outlooks. Absent only on predecessor snapshots. */
  planFingerprints?: Map<string, ContinuationContenderFingerprint>;
  /** Item 12 on the pooled public path (2026-11-08): for each sibling
   *  table-size donor row in `exploit` (opponentMemoryKey), the hands the
   *  player has played since that row was last refreshed, on the player's own
   *  hand clock (PooledPublicProfiles). Absent when the read carried no donor. */
  donorStaleness?: Map<string, number>;
}

/** V23: what hero decided AT BET TIME it would do about a raise. */
export type RaiseResponsePlan = 'commit' | 'callOnce' | 'foldToRaise';

/**
 * Plan writes produced by one speculative HorseLogic decision. Opponent
 * observations are not speculative: they describe action-history that was
 * already authoritative when the request was fenced. These three writes are
 * different because they describe what the horse intends to do after an
 * action that may never reach the table.
 */
export type HorseMindDecisionEffect =
  | {
      type: 'plan';
      handKey: string;
      userId: string;
      barrelIntent: boolean;
    }
  | {
      type: 'outlook';
      handKey: string;
      userId: string;
      street: string;
      good: string[];
      scare: string[];
    }
  | {
      type: 'raise_plan';
      handKey: string;
      userId: string;
      street: string;
      plan: RaiseResponsePlan;
    }
  | {
      /** Items 21 and 23: the next-street state the planned barrel expects
       * (every live contender including hero, effective stack and pot in
       * chips after the planned wager is matched once). Public information
       * only: seat occupancy and chip counts. */
      type: 'plan_fingerprint';
      handKey: string;
      userId: string;
      street: string;
      contenderIds: string[];
      effectiveStackChips: number;
      potChips: number;
      bigBlindChips: number;
    };

export interface CapturedHorseMindDecision<T> {
  value: T;
  effects: HorseMindDecisionEffect[];
}

/**
 * ═══ V45 SCOPED READS (2026-09-05) ═══════════════════════════════════════
 * A player's stats were one bucket across every game they played. A PLO6
 * VPIP (structurally ~60%) polluted the same player's NLH read; heads-up
 * stats polluted their 6-max read. The scope is the two things that change
 * what a frequency MEANS: the card family (hold em or Omaha) and the table
 * size (heads-up, short, full). Reads prefer the scoped bucket once it has
 * SCOPE_MIN_HANDS; below that the pooled bucket answers, as it always did.
 * The recency window (r*) stays pooled: it is a "did they just change
 * gears" read and gears are not per-scope.
 */
export type ReadScope = `${'holdem' | 'omaha' | 'sixplus'}:${'hu' | 'short' | 'full'}`;

/** Scoped hands before the scoped bucket outranks the pooled one. */
export const SCOPE_MIN_HANDS = 40;

export function readScopeOf(variant: string | null | undefined, dealtCount: number): ReadScope {
  const v = (variant || 'nlh').toLowerCase();
  // SHORT DECK IS ITS OWN FAMILY, not hold'em with two cards. Strip the
  // deuces through fives and every frequency moves: VPIP runs near 50% where
  // full-deck hold'em sits at 25%, because everyone connects with everything.
  // Filing it under `holdem` let 205,562 short-deck seat-hands a week pollute
  // the same player's NLH read, which is the exact defect this scope exists
  // to remove - just with a different pair of games than the one the audit
  // named. `sixplus` rather than `short` so the family can never be confused
  // with the table-size token in the key.
  const fam =
    v.includes('short') || v === '6+' || v.includes('sixplus')
      ? 'sixplus'
      : v.startsWith('plo') || v === 'flo8' || v.includes('omaha')
        ? 'omaha'
        : 'holdem';
  const size = dealtCount <= 2 ? 'hu' : dealtCount <= 5 ? 'short' : 'full';
  return `${fam}:${size}`;
}

/**
 * SCOPED SHRINK (2026-11-08, read calibration follow-up; DecisionReadOptions
 * scopedShrink). Below SCOPE_MIN_HANDS the pooled bucket answers, and the
 * pooled bucket mixes every game the player has played: about 8% of read
 * spots in the calibration replay, where the river-fold read scored Brier
 * 0.262 against 0.217 when the scoped bucket answered. With the option on,
 * a thin scoped bucket answers for itself instead, each rate shrunk toward
 * the same scope's population rate (SCOPED_SHRINK_PRIOR) with
 * SCOPED_SHRINK_STRENGTH pseudo-observations. Opportunity counts are the
 * player's own, so every accessor's sample gate still measures evidence from
 * this game: a player never seen in this game has no read here, not their
 * other game's read.
 */
export const SCOPED_SHRINK_STRENGTH = 16;
/** [successes, opportunities] pairs a scoped read divides and shrinks. */
const SCOPED_SHRINK_RATES = [
  ['vpip', 'hands'],
  ['pfr', 'hands'],
  ['threeBet', 'hands'],
  ['folds', 'facedAggr'],
  ['cbetFolds', 'cbetOpps'],
  ['f3bFolds', 'f3bOpps'],
  ['riverBetFolds', 'riverBetOpps'],
  ['riverLastToActBets', 'riverLastToActOpps'],
] as const satisfies ReadonlyArray<readonly [keyof OpponentStats, keyof OpponentStats]>;
/** [a, b] pairs read as the ratio a / b (aggression factors): the share
 *  a / (a + b) is shrunk and the total kept. */
const SCOPED_SHRINK_SHARES = [
  ['aggr', 'passive'],
  ['postAggr', 'postPassive'],
] as const satisfies ReadonlyArray<readonly [keyof OpponentStats, keyof OpponentStats]>;
type ScopedShrinkKey =
  | (typeof SCOPED_SHRINK_RATES)[number][0]
  | (typeof SCOPED_SHRINK_SHARES)[number][0];

/**
 * Each scope's population rate: every player's scoped bucket summed (no
 * labels) at the end of the walk-forward replay of the 41,013 accepted hands
 * of the read calibration (2026-07-22 .. 2026-11-07), for the pairs with 200+
 * opportunities in the scope, else in the card family. The big-bet,
 * tempo, river-call and triple-check-raise reads are left unshrunk: the
 * replay holds no informative population rate for them (one-sided or empty).
 */
export const SCOPED_SHRINK_PRIOR: Readonly<
  Record<ReadScope, Readonly<Partial<Record<ScopedShrinkKey, number>>>>
> = Object.freeze({
  'holdem:hu': {
    vpip: 0.4769,
    pfr: 0.2753,
    threeBet: 0.0263,
    folds: 0.5033,
    cbetFolds: 0.4628,
    f3bFolds: 0.5508,
    riverBetFolds: 0.5473,
    riverLastToActBets: 0.3931,
    aggr: 0.6228,
    postAggr: 0.6949,
  },
  'holdem:short': {
    vpip: 0.3633,
    pfr: 0.2029,
    threeBet: 0.0271,
    folds: 0.5942,
    cbetFolds: 0.4687,
    f3bFolds: 0.6415,
    riverBetFolds: 0.5358,
    riverLastToActBets: 0.4263,
    aggr: 0.5831,
    postAggr: 0.6487,
  },
  'holdem:full': {
    vpip: 0.2238,
    pfr: 0.1414,
    threeBet: 0.0247,
    folds: 0.7371,
    cbetFolds: 0.4628,
    f3bFolds: 0.5438,
    riverBetFolds: 0.5494,
    riverLastToActBets: 0.3901,
    aggr: 0.6286,
    postAggr: 0.656,
  },
  'omaha:hu': {
    vpip: 0.5152,
    pfr: 0.3283,
    threeBet: 0.0644,
    folds: 0.4201,
    cbetFolds: 0.4563,
    f3bFolds: 0.2311,
    riverBetFolds: 0.6567,
    riverLastToActBets: 0.3763,
    aggr: 0.6493,
    postAggr: 0.7252,
  },
  'omaha:short': {
    vpip: 0.5368,
    pfr: 0.2515,
    threeBet: 0.0604,
    folds: 0.4572,
    cbetFolds: 0.4593,
    f3bFolds: 0.2394,
    riverBetFolds: 0.6605,
    riverLastToActBets: 0.3845,
    aggr: 0.5084,
    postAggr: 0.6368,
  },
  'omaha:full': {
    vpip: 0.4076,
    pfr: 0.1797,
    threeBet: 0.0441,
    folds: 0.5182,
    cbetFolds: 0.4546,
    f3bFolds: 0.2199,
    riverBetFolds: 0.6552,
    riverLastToActBets: 0.3711,
    aggr: 0.4841,
    postAggr: 0.6212,
  },
  'sixplus:hu': {
    vpip: 0.5194,
    pfr: 0.1889,
    threeBet: 0.025,
    folds: 0.5061,
    aggr: 0.4419,
    postAggr: 0.5801,
  },
  'sixplus:short': {
    vpip: 0.5194,
    pfr: 0.1889,
    threeBet: 0.025,
    folds: 0.383,
    aggr: 0.4587,
    postAggr: 0.5801,
  },
  'sixplus:full': {
    vpip: 0.4595,
    pfr: 0.1638,
    threeBet: 0.0226,
    folds: 0.5643,
    aggr: 0.4298,
    postAggr: 0.5842,
  },
});

/**
 * A thin scoped bucket with every covered rate shrunk toward the scope's
 * population rate; opportunity counts unchanged. Pure; exported for tests.
 */
export function shrinkScopedStats(
  own: OpponentStats,
  prior: Readonly<Partial<Record<ScopedShrinkKey, number>>> | undefined,
  strength: number = SCOPED_SHRINK_STRENGTH
): OpponentStats {
  const out: OpponentStats = { ...own };
  const num = (f: keyof OpponentStats): number => {
    const v = Number(own[f] ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const set = (f: keyof OpponentStats, v: number) => {
    (out as unknown as Record<string, number>)[f as string] = v;
  };
  for (const [k, n] of SCOPED_SHRINK_RATES) {
    const p = prior?.[k];
    const ok = num(k);
    const on = num(n);
    if (p === undefined || !(on > 0)) continue;
    set(k, (on * (Math.min(ok, on) + strength * p)) / (on + strength));
  }
  for (const [a, b] of SCOPED_SHRINK_SHARES) {
    const p = prior?.[a];
    const total = num(a) + num(b);
    if (p === undefined || !(total > 0)) continue;
    const share = (num(a) + strength * p) / (total + strength);
    set(a, total * share);
    set(b, total * (1 - share));
  }
  return out;
}

/** The lifetime counters a scope carries; recency and hands-dedupe stay pooled. */
const SCOPED_FIELDS = [
  'hands',
  'vpip',
  'pfr',
  'threeBet',
  'aggr',
  'passive',
  'folds',
  'facedAggr',
  'cbetOpps',
  'cbetFolds',
  'f3bOpps',
  'f3bFolds',
  'bigBetSD',
  'bigBetSDStrong',
  'riverBetOpps',
  'riverBetFolds',
  'riverLastToActOpps',
  'riverLastToActBets',
  'riverTripleCheckRaiseOpps',
  'riverTripleCheckRaiseFolds',
  'checks',
  'postAggr',
  'postPassive',
  'snapBetSD',
  'snapBetSDStrong',
  'tankBetSD',
  'tankBetSDStrong',
  'riverCallSD',
  'riverCallSDWeak',
] as const;

const COUNTER_FIELDS = [
  ...SCOPED_FIELDS,
  'rHands',
  'rFolds',
  'rFacedAggr',
  'rAggr',
  'rPassive',
  'rChecks',
] as const;
const hasContributions = (row: Partial<OpponentStats> | undefined): boolean =>
  !!row && COUNTER_FIELDS.some((field) => Number.isFinite(row[field]) && row[field]! > 0);
const countersChanged = (before: OpponentStats, after: OpponentStats): boolean =>
  COUNTER_FIELDS.some((field) => before[field] !== after[field]);

/** Imports may mix independently merged fields. Unknown contributing history
 * stays unknown even when another input has a recent valid timestamp. */
function importedWindow(
  incoming: Partial<OpponentStats>,
  existing?: OpponentStats
): HorseObservationWindow {
  const sources: unknown[] = [];
  if (hasContributions(incoming)) sources.push(incoming.sourceWindow);
  if (hasContributions(existing)) sources.push(existing!.sourceWindow);
  return mergeHorseObservationWindows(...sources);
}

export class HorseMind {
  private static stats = new Map<string, OpponentStats>();
  /** V45: the scoped overlay, keyed `${scope}|${userId}`. */
  private static scoped = new Map<string, OpponentStats>();
  /** V45: scoped keys changed since the last flush. */
  private static dirtyScoped = new Set<string>();
  /** V45: the scope of the decision in flight (set by HorseLogic.decide). */
  private static decisionScope: ReadScope | null = null;
  /** 2026-10-16: decayed opponent-exploit counters, `${scope}|${userId}`. */
  private static exploitCounters = new Map<string, ExploitCounters>();
  /** V86: decayed flop-only checked-to stab counters, `${scope}|${userId}`. */
  private static flopStabCounters = new Map<string, FlopStabCounters>();
  /** Boot-hydrated hand keys so repeated hydration calls are 100% idempotent. */
  private static hydratedHandKeys = new Set<string>();
  private static readonly MAX_HYDRATED_HAND_KEYS = 50_000;

  /**
   * (c) 2026-11-13: the hand keys (`tableId:handNumber`) the last style boot rebuild counted. A hand settled while the
   * boot was reading can be in those rows and then reach the live style learner too; the learner skips such a hand
   * once (the key is removed on that hit). Replaced by every boot rebuild. Bounded at STYLE_BOOT_HAND_KEY_CAP, which
   * covers the whole boot window (EXPLOIT_HYDRATION_MAX_HANDS = 12,000 rows, one key each).
   */
  private static styleBootHandKeys = new Set<string>();
  static readonly STYLE_BOOT_HAND_KEY_CAP = 16_384;

  static replaceStyleBootHandKeys(keys: Iterable<string>): void {
    this.styleBootHandKeys.clear();
    for (const k of keys) {
      if (!k) continue;
      this.styleBootHandKeys.add(k);
      while (this.styleBootHandKeys.size > this.STYLE_BOOT_HAND_KEY_CAP)
        this.styleBootHandKeys.delete(this.styleBootHandKeys.values().next().value!);
    }
  }

  static styleBootHandKeyCount(): number {
    return this.styleBootHandKeys.size;
  }

  static hasHydratedHand(key: string): boolean {
    return !!key && this.hydratedHandKeys.has(key);
  }

  static markHydratedHand(key: string): void {
    if (!key) return;
    this.hydratedHandKeys.add(key);
    while (this.hydratedHandKeys.size > this.MAX_HYDRATED_HAND_KEYS) {
      this.hydratedHandKeys.delete(this.hydratedHandKeys.values().next().value!);
    }
  }
  /** 2026-10-16: the game variant of the decision in flight; it picks the
   *  population envelope the exploit read is judged against. */
  private static decisionMode: MemoryMode = 'cash';
  private static durableOpponentMemory = false;
  private static durableOpponentVersions = new Map<string, number>();
  /** STYLE READ provenance (2026-11-13): whether each imported durable profile was built with
   *  complete observations (HorseOpponentStyle.profileQualification). Bookkeeping only: it
   *  changes no read; deleted with the version entry and cleared by reset. */
  private static durableProfileComplete = new Map<string, boolean>();
  /** STYLE READ pre-repair provenance (item 10): keyed from each imported durable profile's own mode and
   *  public domain (HorseOpponentStyle.preRepairKeyed). Bookkeeping only; cleared with the row. */
  private static durableProfilePreRepair = new Map<string, boolean | null>();
  /** Post-release opportunity counts per row (the m of the pre-repair discount), SUPPLIED by importPostReleaseObservations
   *  from a persisted or recomputed source. Never incremented here: a process-memory counter would reset with the daily
   *  engine restart and never lift the discount. */
  private static postReleaseObservations = new Map<string, PostReleaseOpportunities>();
  /** STYLE READ A2: river first bets by size bucket per player (memory only, live only, LRU-capped). */
  private static styleSizeShown = new Map<string, SizeBucketTallies>();
  /** STYLE READ #4: postflop aggression and raise opportunities per street, per (variant, format, table size, player). */
  private static styleAggression = new Map<string, StreetAggression>();
  /** #4 (M2): the Horse population's postflop aggression and raise opportunities per (variant, format, table size). */
  private static styleHorseReference = new Map<string, StreetAggression>();
  /** TEST-HARNESS ONLY (league and tournament simulations): let the style learner record inside a sandbox, into the
   *  process maps. Never set by a production path; a live engine keeps the default false. */
  private static harnessStyleLearning = false;
  static enableHarnessStyleLearning(on = true): void {
    this.harnessStyleLearning = on;
  }
  /** TEST-HARNESS ONLY: forget the style learner's per-context rows (one cell or tournament per arm pairing). */
  static clearHarnessStyleMemory(): void {
    if (!this.harnessStyleLearning)
      throw new Error('clearHarnessStyleMemory is for test harnesses only');
    this.styleSizeShown.clear();
    this.styleAggression.clear();
    this.styleHorseReference.clear();
    this.styleBootHandKeys.clear();
  }
  /** Item 12 (2026-11-05): the player's pooled hand clock (OpponentStats.hands
   *  in this process) at the moment each durable row was last imported. A
   *  donor bucket's staleness is the distance from this mark to the player's
   *  current clock, never `exact.observed_hands - donor.observed_hands`. */
  private static durableOpponentImportClock = new Map<string, number>();
  /** The sandbox's donor staleness (HorseMindSandbox.donorStaleness) while one
   *  runs; null outside a sandbox or for a read that carried no donor. */
  private static donorStaleness: Map<string, number> | null = null;
  private static decisionVariant: string | null = null;
  /** Read calibration options of the decision in flight (DecisionReadOptions). */
  private static decisionReadOptions: DecisionReadOptions = {};
  /** dedupe of processed ActionRecords across repeated decide() calls */
  private static seenActions = new Set<string>();
  /** per (handKey|userId) preflop-participation flags already counted */
  private static handFlags = new Set<string>();
  /** V12 persistence: userIds whose stats changed since the last DB flush. */
  private static dirty = new Set<string>();
  /** V12 ANTI-EXPLOIT: per-(attacker|victim) aggression targeting counters. */
  private static pairs = new Map<string, { n3: number; opp3: number; nR: number; oppR: number }>();
  private static readonly MAX_PAIRS = 20_000;
  /** V12 persistence: pair keys whose counters changed since the last flush. */
  private static dirtyPairs = new Set<string>();

  // ───────────────────────────────────────────────────────────────────────
  // OBSERVATION — ingest the action stream (idempotent, bounded)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Ingest the complete controller history or its growing prefix. A qualified
   * table/hand coordinate separates interleaved tables while its dedup keys
   * remain retained. This volatile bounded cache is not durable exactly-once
   * delivery; callers without an identity keep the unqualified legacy keys.
   */
  static observe(
    history: ActionRecord[] | undefined,
    _players: SeatPlayer[],
    identity?: HorseMindHandIdentity | null,
    originalDealtCount?: number,
    /** 2026-11-08: the hand's big blind, so a probe bet can be told from a
     *  bet (OpponentStats.ctBets / ctProbes). Absent: neither is counted. */
    bigBlind?: number
  ): void {
    if (!history || history.length === 0) return;
    const probes =
      typeof bigBlind === 'number' && bigBlind > 0 ? probeBetIndexes(history, bigBlind) : null;

    // Explicit null/invalid identity refuses the new mutation. Only legacy
    // direct/offline callers that omit the argument retain the old namespace.
    const identifiedHand = identity === undefined ? undefined : horseMindHandIdentityKey(identity);
    if (identity !== undefined && !identifiedHand) return;
    const handKey = identifiedHand ?? `${history[0].timestamp}:${history[0].userId}`;

    // ── BOUNDED-MEMORY GUARDS (V12.3: evict oldest, never clear) ───────────
    // observe() runs at the TOP OF EVERY DECISION and many tables interleave,
    // so a wholesale .clear() could land in the middle of any hand in flight.
    // Every one of them corrupts data when it does, permanently, because the
    // DB merge is GREATEST-monotonic — an inflated counter never comes back:
    //   - clearing seenActions mid-hand makes this hand's already-counted
    //     actions look new again, double-counting aggr/passive/folds/facedAggr,
    //     the recency window, AND the pair counters;
    //   - clearing handFlags mid-hand lets `hands` and `vpip` fire twice for
    //     one hand, so VPIP can exceed hands;
    //   - clearing stats mid-hand leaves the hand flag set, so the wiped
    //     player accumulates actions against hands = 0.
    // A hand-boundary check cannot fix this (with N tables interleaved the
    // "current" hand changes on nearly every call). Evicting the OLDEST
    // entries does: Map and Set both iterate in insertion order, and a hand in
    // flight is by definition among the most recently inserted. Dropping the
    // oldest quarter keeps the caps honest and cannot touch live hands.
    evictOldest(this.seenActions, MAX_SEEN_ACTIONS);
    evictOldest(this.handFlags, MAX_HAND_FLAGS);
    if (this.stats.size > MAX_TRACKED_PLAYERS) {
      // Stats are keyed by player, not by hand, so eviction drops the
      // least-recently-first-seen opponents. Their dirty entries go too — the
      // DB already holds what was flushed, and the merge is monotonic.
      for (const id of evictOldest(this.stats, MAX_TRACKED_PLAYERS)) this.dirty.delete(id);
    }
    if (this.pairs.size > this.MAX_PAIRS) {
      for (const k of evictOldest(this.pairs, this.MAX_PAIRS)) this.dirtyPairs.delete(k);
    }

    let preflopRaises = 0;
    // V12 anti-exploit: who opened this hand, and who bet each street —
    // needed to attribute 3-bets and bet-raises to (attacker, victim) pairs.
    let openerId: string | null = null;
    let streetBettor: string | null = null;
    let curStage: string = 'preflop';
    const pairOf = (attacker: string, victim: string) => {
      const k = `${attacker}|${victim}`;
      let p = this.pairs.get(k);
      if (!p) {
        p = { n3: 0, opp3: 0, nR: 0, oppR: 0 };
        this.pairs.set(k, p);
      }
      // V12 persistence: every pairOf() call site mutates a counter, so the
      // key is dirty by construction.
      this.dirtyPairs.add(k);
      return p;
    };

    // Limp-reraise read: players who limped and have not yet answered a raise.
    const limpedPending = new Set<string>();
    for (let controllerOrdinal = 0; controllerOrdinal < history.length; controllerOrdinal++) {
      const a = history[controllerOrdinal];
      // Preserve compatibility of individual legacy reads. The shared exploit
      // reducer separately requires positive source provenance for every fold.
      if (a.origin === 'forced') continue;
      const preflop = a.stage === 'preflop';
      // V28: the street change must be observed BEFORE the stat update reads
      // streetBettor, or the first action of a new street is judged against
      // the previous street's bettor. Moving the reset here is semantically
      // identical for the attribution block below (which used to do it).
      if (a.stage !== curStage) {
        curStage = a.stage;
        streetBettor = null;
      }
      const isAggr = isMindAggression(a);
      // V28 AUDIT FIX: "faced aggression" now means FACED AGGRESSION. The old
      // counters incremented facedAggr on every call and every fold — a limp
      // of the big blind counted as "faced aggression and did not fold", and
      // a raise-OVER a bet (the most aggressive answer there is) was excluded
      // from the denominator entirely. A player who folded 5, called 3 and
      // raised-over 10 read as a 62.5% folder and was classified a nit. Both
      // error directions fed exploit() and through tableExploit every
      // postflop bluff decision on the platform.
      const facingAggr = preflop
        ? preflopRaises >= 1
        : streetBettor != null && streetBettor !== a.userId;
      // This is the controller sequence position, not the canonical ordinal
      // in the full accepted list. Projection must preserve the whole prefix.
      const actKey = identifiedHand
        ? `${identifiedHand}|controller:${controllerOrdinal}`
        : `${a.timestamp}:${a.userId}:${a.action}:${a.amount}`;
      const isNew = !this.seenActions.has(actKey);
      if (isNew) this.seenActions.add(actKey);

      let s = this.stats.get(a.userId);
      if (!s) {
        s = freshStats();
        this.stats.set(a.userId, s);
      }
      // V45: the scoped bucket receives exactly what the pooled one does
      // for this action, as a delta taken at the end of the iteration.
      const beforeObservation = isNew ? { ...s } : null;

      if (isNew) {
        this.dirty.add(a.userId); // V12: schedule for the next DB flush
        // Hand participation (once per hand per player)
        const seenKey = `${handKey}|${a.userId}|seen`;
        if (!this.handFlags.has(seenKey)) {
          this.handFlags.add(seenKey);
          s.hands++;
          // V7 counter-adaptation: exponentially-decayed recency window
          // (half-life ~24 hands). Recent behavior shifts — an opponent who
          // STOPPED folding to our bluffs — show up here within ~20 hands
          // while the lifetime stats would take hundreds to move.
          s.rHands++;
          if (s.rHands >= 24) {
            s.rHands /= 2;
            s.rFolds /= 2;
            s.rFacedAggr /= 2;
            s.rAggr /= 2;
            s.rPassive /= 2;
            s.rChecks /= 2;
          }
        }

        // VPIP and PFR are separate once-per-hand observations. A caller
        // can raise later in the same preflop round (a limp-reraise).
        if (preflop) {
          const voluntary =
            a.action === 'call' ||
            a.action === 'bet' ||
            a.action === 'raise' ||
            a.action === 'all_in';
          if (voluntary) {
            const vKey = `${handKey}|${a.userId}|vpip`;
            if (!this.handFlags.has(vKey)) {
              this.handFlags.add(vKey);
              s.vpip++;
            }
          }
          if (isAggr) {
            const rKey = `${handKey}|${a.userId}|pfr`;
            if (!this.handFlags.has(rKey)) {
              this.handFlags.add(rKey);
              s.pfr++;
              if (preflopRaises >= 1) s.threeBet++;
            }
          }
        }

        // Aggression factor + fold-vs-aggression, all streets (V28: faced-
        // aggression counters gated on facingAggr, raises-over included in
        // the denominator, and checks counted for the V18 self-image).
        if (isAggr) {
          s.aggr++;
          s.rAggr++;
          if (!preflop) s.postAggr++;
          if (probes && !preflop && !facingAggr && a.action === 'bet') {
            s.ctBets = (s.ctBets ?? 0) + 1;
            s.ctProbes = (s.ctProbes ?? 0) + (probes.has(controllerOrdinal) ? 1 : 0);
          }
          if (facingAggr) {
            s.facedAggr++;
            s.rFacedAggr++;
          }
        } else if (a.action === 'call') {
          s.passive++;
          s.rPassive++;
          if (!preflop) s.postPassive++;
          if (facingAggr) {
            s.facedAggr++;
            s.rFacedAggr++;
          }
        } else if (a.action === 'check') {
          s.checks++;
          s.rChecks++;
        } else if (a.action === 'fold') {
          // A fold with no aggression to face is a blind surrender (SB fold
          // to limps, and the like) — it says nothing about fold-vs-
          // aggression, so it stays out of BOTH sides of that ratio.
          if (facingAggr) {
            s.folds++;
            s.facedAggr++;
            s.rFolds++;
            s.rFacedAggr++;
          }
        }
      }

      // V12 ANTI-EXPLOIT ATTRIBUTION — who attacks whom. isNew-gated so a
      // replayed history never double-counts a pair event. (Street reset
      // moved to the top of the loop — V28.)
      if (preflop) {
        if (isNew && openerId && a.userId !== openerId && preflopRaises === 1) {
          if (isAggr) {
            const p = pairOf(a.userId, openerId);
            p.n3++;
            p.opp3++;
          } else if (a.action === 'call' || a.action === 'fold') {
            pairOf(a.userId, openerId).opp3++;
          }
        }
        if (isAggr && preflopRaises === 0) openerId = a.userId;
      } else {
        if (isNew && streetBettor && a.userId !== streetBettor) {
          // V12.3: classify FIRST. pairOf() creates the entry and marks it
          // dirty, so calling it before the branch minted {0,0,0,0} rows for
          // every non-matching action (a short all-in, a check after a stale
          // bettor). Those rows were flushed to horse_mind_pairs and consumed
          // the MAX_PAIRS budget, whose overflow does a FULL clear() —
          // evicting genuine hunter profiles to make room for empty ones.
          const isRaiseOver =
            a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);
          const isPassiveResponse = a.action === 'call' || a.action === 'fold';
          if (isRaiseOver) {
            const p = pairOf(a.userId, streetBettor);
            p.nR++;
            p.oppR++;
          } else if (isPassiveResponse) {
            pairOf(a.userId, streetBettor).oppR++;
          }
          // ═══ V23 RIVER READS (2026-08-28) ═══ the same street-bettor
          // attribution, read for one more thing: how this player answers
          // RIVER aggression. Fold-to-river-bet is the read that prices both
          // river bluffs and thin value against them.
          if (curStage === 'river' && (isRaiseOver || isPassiveResponse)) {
            s.riverBetOpps++;
            if (a.action === 'fold') s.riverBetFolds++;
            observeFastCalldownRiver(s, a.action !== 'fold');
          }
        }
        if (isAggr) streetBettor = a.userId;
      }
      if (beforeObservation && countersChanged(beforeObservation, s)) {
        s.sourceWindow = observeHorseObservationWindow(
          beforeObservation.sourceWindow,
          a.timestamp,
          hasContributions(beforeObservation)
        );
        this.applyScopedDelta(
          a.userId,
          beforeObservation,
          s,
          observeHorseObservationWindow(undefined, a.timestamp, false)
        );
      }

      if (preflop && a.userId) {
        if (preflopRaises >= 1 && limpedPending.has(a.userId)) {
          // The limper's next action after a raise came in behind the limp.
          limpedPending.delete(a.userId);
          if (isNew) {
            s.lrOpps = (s.lrOpps ?? 0) + 1;
            s.lrRaises = (s.lrRaises ?? 0) + (isAggr ? 1 : 0);
          }
        } else if (preflopRaises === 0 && a.action === 'call') {
          limpedPending.add(a.userId);
        }
      }
      if (preflop && isAggr) preflopRaises++;
    }
    // Separate original-hand dedupe: a legacy observer may already have seen
    // the action prefix without the original participant-count metadata.
    const riverKey = identifiedHand ? `${identifiedHand}|river-last-to-act` : null;
    if (riverKey && !this.handFlags.has(riverKey)) {
      const increments = riverPositionIncrements(history, originalDealtCount);
      if (increments.size) {
        for (const [id, inc] of increments) {
          const row = this.stats.get(id);
          const action = history.find((a) => a.stage === 'river' && a.userId === id);
          if (!row || !action) continue;
          const before = { ...row };
          row.riverLastToActOpps = (row.riverLastToActOpps ?? 0) + inc.opportunities;
          row.riverLastToActBets = (row.riverLastToActBets ?? 0) + inc.bets;
          // Receipt (#8386): a last-to-act river opportunity was counted.
          noteFire('river_last_to_act_counted');
          row.sourceWindow = observeHorseObservationWindow(
            before.sourceWindow,
            action.timestamp,
            hasContributions(before)
          );
          this.dirty.add(id);
          this.applyScopedDelta(
            id,
            before,
            row,
            observeHorseObservationWindow(undefined, action.timestamp, false)
          );
        }
        this.handFlags.add(riverKey);
      }
    }
    const pressureKey = identifiedHand ? `${identifiedHand}|multiway-hu-pressure-v1` : null;
    if (pressureKey && !this.handFlags.has(pressureKey) && originalDealtCount !== undefined) {
      const inc = multiwayRiverPressure(history, originalDealtCount);
      const row = inc ? this.stats.get(inc.id) : undefined;
      if (inc && row) {
        const delta: MultiwayRiverReadState = {
          entries: [[inc.context, 0, 0, inc.opportunities, inc.bets]],
          overflow: false,
        };
        row.riverHu = mergeMultiwayRiverStates(row.riverHu, delta);
        if (this.decisionScope) {
          const scoped = this.scopedFor(inc.id, this.decisionScope);
          scoped.riverHu = mergeMultiwayRiverStates(scoped.riverHu, delta);
        }
        this.dirty.add(inc.id);
        this.handFlags.add(pressureKey);
      }
    }
    const huKey = identifiedHand ? `${identifiedHand}|multiway-hu-river-v1` : null;
    if (huKey && !this.handFlags.has(huKey) && originalDealtCount !== undefined) {
      const inc = multiwayRiverIncrements(history, originalDealtCount);
      if (inc) {
        const row = this.stats.get(inc.id);
        if (row) {
          const delta: MultiwayRiverReadState = {
            entries: [[inc.context, inc.opportunities, inc.folds, 0, 0]],
            overflow: false,
          };
          row.riverHu = mergeMultiwayRiverStates(row.riverHu, delta);
          if (this.decisionScope) {
            const scoped = this.scopedFor(inc.id, this.decisionScope);
            scoped.riverHu = mergeMultiwayRiverStates(scoped.riverHu, delta);
          }
          this.dirty.add(inc.id);
          this.handFlags.add(huKey);
        }
      }
    }
    const raiseKey = identifiedHand ? `${identifiedHand}|river-triple-check-raise` : null;
    if (raiseKey && !this.handFlags.has(raiseKey)) {
      const increments = riverTripleCheckRaiseIncrements(history, originalDealtCount);
      for (const [id, inc] of increments) {
        const row = this.stats.get(id);
        const action = history.filter((a) => a.stage === 'river' && a.userId === id).at(-1);
        if (!row || !action) continue;
        const before = { ...row };
        row.riverTripleCheckRaiseOpps = (row.riverTripleCheckRaiseOpps ?? 0) + inc.opportunities;
        row.riverTripleCheckRaiseFolds = (row.riverTripleCheckRaiseFolds ?? 0) + inc.folds;
        row.sourceWindow = observeHorseObservationWindow(
          before.sourceWindow,
          action.timestamp,
          hasContributions(before)
        );
        this.dirty.add(id);
        this.applyScopedDelta(
          id,
          before,
          row,
          observeHorseObservationWindow(undefined, action.timestamp, false)
        );
      }
      if (increments.size) this.handFlags.add(raiseKey);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // V12 ANTI-EXPLOIT — is this opponent HUNTING this horse?
  // ───────────────────────────────────────────────────────────────────────

  /**
   * 0..1 score of how hard `oppId` is targeting `heroId` specifically,
   * relative to that opponent's own global aggression rates. 0 = no evidence
   * (small sample, or their aggression toward hero matches how they play
   * everyone). Positive scores mean hero's opens are being 3-bet, and hero's
   * bets raised, at rates their global profile cannot explain — the
   * signature of a player who has singled this horse out.
   */
  // ───────────────────────────────────────────────────────────────────────
  // 2026-10-16 OPPONENT EXPLOIT - decayed reads, gate and accessors
  // ───────────────────────────────────────────────────────────────────────

  private static observeExploitHand(
    actions: ReadonlyArray<{
      userId?: string;
      action: string;
      amount?: number;
      stage: string;
      isFullRaise?: boolean;
    }>,
    scope: ReadScope
  ): void {
    // Item 12 opportunity-scoped decay (decayAndAddOpportunityScoped), live
    // since 2026-11-06 by Dan's ruling: a long-window gated statistic keeps
    // its weight on a hand that offered no such spot, the fast window ages
    // every hand, and a visible style shift (styleShiftReleased) ages the old
    // style's evidence at the fast rate so HorseManiacPressure.law.test.ts
    // still holds. See
    // docs/changelog/2026-11-06-opportunity-scoped-decay-with-style-shift-release.md.
    for (const [userId, increments] of exploitHandIncrements(actions, true))
      observeExploitRow(
        this.exploitCounters,
        `${scope}|${userId}`,
        increments,
        EXPLOIT_ROW_CAP,
        true
      );
    for (const [userId, fInc] of exploitFlopStabIncrements(actions, true))
      observeFlopStabRow(this.flopStabCounters, `${scope}|${userId}`, fInc, EXPLOIT_ROW_CAP);
  }

  /** The decayed exploit counters for (scope, player), for tests and the read frame. */
  static getExploitCounters(userId: string, scope: ReadScope): ExploitCounters | undefined {
    return this.exploitCounters.get(`${scope}|${userId}`);
  }

  /** The decayed flop-only checked-to stab counters for (scope, player). */
  static getFlopStabCounters(userId: string, scope: ReadScope): FlopStabCounters | undefined {
    return this.flopStabCounters.get(`${scope}|${userId}`);
  }

  /**
   * The exploit rows a sandbox learned, keyed `${scope}|${userId}` (empty for
   * a sandbox built before the exploit layer). Read only: callers must not
   * write through it.
   */
  static sandboxExploitRows(sandbox: HorseMindSandbox): ReadonlyMap<string, ExploitCounters> {
    return sandbox.exploit ?? EMPTY_EXPLOIT_ROWS;
  }

  /**
   * Add the exploit rows a sandbox learned from ONE completed hand to the live
   * memory, exactly as if the live mind had observed that hand
   * (`mergeExploitRows`: decay-and-add per key, a copy when absent, the same
   * least-recently-used cap). This is the entry point the worker mirror
   * (horseDecision/mindMirror.ts) uses to carry another shard's hands into the
   * read. Refused inside a sandbox or an effect capture: it writes live state.
   */
  static mergeSandboxExploit(sandbox: HorseMindSandbox): void {
    if (this.sandboxDepth > 0) throw new Error('HorseMind.mergeSandboxExploit: inside a sandbox');
    if (this.decisionEffectSink)
      throw new Error('HorseMind.mergeSandboxExploit: inside an effect capture');
    mergeExploitRows(this.exploitCounters, this.sandboxExploitRows(sandbox), EXPLOIT_ROW_CAP, true);
    if (sandbox.flopStab && sandbox.flopStab.size > 0) {
      mergeFlopStabRows(this.flopStabCounters, sandbox.flopStab, EXPLOIT_ROW_CAP);
    }
  }

  /** Detached copy of boot-hydrated flop-stab counters for worker pooled floor views. */
  static exportFlopStabSnapshot(): Map<string, FlopStabCounters> {
    const out = new Map<string, FlopStabCounters>();
    for (const [k, v] of this.flopStabCounters) {
      out.set(k, { ...v });
    }
    return out;
  }

  /**
   * The opponent-exploit read for the decision in flight (its scope), or NULL
   * when none of this player's statistics is credibly outside the horse
   * envelope. Null is the neutrality contract: callers run their exact
   * pre-existing code. Pure: no random draws, no writes.
   */
  static enableDurableOpponentMemory(): void {
    this.durableOpponentMemory = true;
  }

  static hasDurableOpponentProfile(
    userId: string,
    variant: string,
    mode: MemoryMode,
    size: MemorySize
  ): boolean {
    const v = memoryVariant(variant);
    return !!v && this.exploitCounters.has(opponentMemoryKey(userId, v, mode, size));
  }

  static importDurableOpponentProfiles(rows: readonly DurableOpponentProfile[]): number {
    if (this.sandboxDepth > 0 || this.decisionEffectSink)
      throw new Error('durable profile import outside live boundary');
    if (!Array.isArray(rows) || rows.length > 10 || rows.some((p) => !validOpponentProfile(p)))
      throw new Error('invalid durable opponent profile');
    // A later validated request can activate a worker whose startup probe
    // preceded installation or the PostgREST cache reload.
    if (rows.length > 0) this.enableDurableOpponentMemory();
    let applied = 0;
    for (const p of rows) {
      const key = opponentMemoryKey(p.user_id, p.variant, p.mode, p.size);
      const known = this.durableOpponentVersions.get(key);
      const version = opponentProfileVersion(p);
      if (this.exploitCounters.has(key) && known !== undefined && known >= version) continue;
      this.exploitCounters.delete(key);
      this.exploitCounters.set(key, { ...p.counters });
      this.durableOpponentVersions.set(key, version);
      this.durableProfileComplete.set(key, profileQualification(p).complete);
      this.durableProfilePreRepair.set(key, preRepairKeyed(p.mode, p.public_memory_domain));
      this.durableOpponentImportClock.set(key, this.stats.get(p.user_id)?.hands ?? 0);
      applied++;
    }
    while (this.exploitCounters.size > EXPLOIT_ROW_CAP) {
      const key = this.exploitCounters.keys().next().value!;
      this.exploitCounters.delete(key);
      this.durableOpponentVersions.delete(key);
      this.durableProfileComplete.delete(key);
      this.durableProfilePreRepair.delete(key);
      this.postReleaseObservations.delete(key);
      this.durableOpponentImportClock.delete(key);
    }
    if (this.durableOpponentVersions.size > EXPLOIT_ROW_CAP)
      for (const key of this.durableOpponentVersions.keys()) {
        if (!this.exploitCounters.has(key)) {
          this.durableOpponentVersions.delete(key);
          this.durableProfileComplete.delete(key);
          this.durableProfilePreRepair.delete(key);
          this.postReleaseObservations.delete(key);
          this.durableOpponentImportClock.delete(key);
        }
        if (this.durableOpponentVersions.size <= EXPLOIT_ROW_CAP) break;
      }
    return applied;
  }

  /**
   * STYLE READ pre-repair discount input (item 10). Supply, per (player, variant, mode, size), the number of
   * opportunities of each showdown-dependent statistic observed AT OR AFTER the release carrying the repaired learner
   * (the m of 0.5^(m/30)). The supplier recomputes it at boot from hand history (read-only) or reads a persisted
   * snapshot; this method writes nothing anywhere and counts nothing itself. Without it m is 0 and an affected row's
   * showdown-dependent statistics stay out of the style read (never full weight). Refused inside a sandbox or an effect
   * capture, like the profile import; a malformed row refuses the whole call.
   */
  static importPostReleaseObservations(
    rows: ReadonlyArray<{
      user_id: string;
      variant: string;
      mode: MemoryMode;
      size: MemorySize;
      opportunities: PostReleaseOpportunities;
    }>
  ): number {
    if (this.sandboxDepth > 0 || this.decisionEffectSink)
      throw new Error('post-release observation import outside live boundary');
    this.assertPostReleaseRows(rows);
    for (const r of rows) {
      const key = opponentMemoryKey(r.user_id, r.variant as MemoryVariant, r.mode, r.size);
      this.postReleaseObservations.delete(key);
      this.postReleaseObservations.set(key, { ...r.opportunities });
    }
    while (this.postReleaseObservations.size > EXPLOIT_ROW_CAP)
      this.postReleaseObservations.delete(this.postReleaseObservations.keys().next().value!);
    return rows.length;
  }

  /** The row rule of importPostReleaseObservations, with no effect: at most 50 rows, each one valid, or it throws. */
  private static assertPostReleaseRows(
    rows: ReadonlyArray<{
      user_id: string;
      variant: string;
      mode: MemoryMode;
      size: MemorySize;
      opportunities: PostReleaseOpportunities;
    }>
  ): void {
    const valid = (r: (typeof rows)[number]): boolean =>
      !!r &&
      typeof r.user_id === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.user_id) &&
      memoryVariant(r.variant) !== null &&
      ['cash', 'tournament'].includes(r.mode) &&
      ['hu', 'short', 'full'].includes(r.size) &&
      !!r.opportunities &&
      typeof r.opportunities === 'object' &&
      Object.entries(r.opportunities).every(
        ([stat, m]) =>
          (PRE_REPAIR_STATS as readonly string[]).includes(stat) &&
          (m === null || m === undefined || (Number.isFinite(m) && m >= 0))
      );
    if (!Array.isArray(rows) || rows.length > 50 || !rows.every(valid))
      throw new Error('invalid post-release observation row');
  }

  /** True when this decision's Hold'em exact profile is pre-repair and its fold-to-bet is still excluded. */
  private static foldToBetPreRepairExcluded(userId: string): boolean {
    const scope = this.decisionScope;
    if (!scope || !scope.startsWith('holdem:')) return false;
    const variant = memoryVariant(this.decisionVariant);
    if (!variant) return false;
    const prov = this.styleProvenanceOf(
      userId,
      variant,
      this.decisionMode,
      scope.split(':')[1] as MemorySize
    );
    return preRepairDiscount(prov, 'foldToBet').excluded;
  }

  /**
   * A2: rebuild size buckets from persisted hand history (read-only rows) at boot. Replaces the player's in-memory
   * buckets, so a restart that re-imports the same rows rebuilds them exactly. Live boundary only.
   */
  static importSizeBucketsFromHistory(
    rows: ReadonlyArray<{
      user_id: string;
      variant: string;
      mode: MemoryMode;
      size: MemorySize;
      hands: readonly PersistedHandForStyle[];
    }>
  ): number {
    return this.importSizeBuckets(
      rows.map((r) => ({
        user_id: r.user_id,
        variant: r.variant,
        mode: r.mode,
        size: r.size,
        buckets: sizeBucketsFromHistory(r.hands, r.user_id),
      }))
    );
  }

  /** #4: supply in-format postflop aggression for one context (boot rebuild from hand history); replaces that row. */
  static importStyleAggression(
    rows: ReadonlyArray<{
      user_id: string;
      variant: string;
      mode: MemoryMode;
      size: MemorySize;
      aggression: StreetAggression;
    }>
  ): number {
    if ((this.sandboxDepth > 0 || this.decisionEffectSink) && !this.harnessStyleLearning)
      throw new Error('style aggression import outside live boundary');
    let applied = 0;
    for (const r of rows) {
      const v = memoryVariant(r?.variant);
      if (
        !r ||
        typeof r.user_id !== 'string' ||
        !v ||
        !['cash', 'tournament'].includes(r.mode) ||
        !['hu', 'short', 'full'].includes(r.size) ||
        !r.aggression
      )
        continue;
      const key = styleSizeKey(r.user_id, v, r.mode, r.size);
      this.styleAggression.delete(key);
      this.styleAggression.set(key, addStreetAggression(undefined, r.aggression));
      applied++;
    }
    while (this.styleAggression.size > MAX_TRACKED_PLAYERS)
      this.styleAggression.delete(this.styleAggression.keys().next().value!);
    return applied;
  }

  /** #4: the Horse population reference held for one (variant, format, table size), a copy (diagnostics and tests). */
  static styleHorseReferenceOf(
    variant: string,
    mode: MemoryMode,
    size: MemorySize
  ): StreetAggression | null {
    const v = memoryVariant(variant);
    const row = v ? this.styleHorseReference.get(`${v}|${mode}|${size}`) : undefined;
    return row ? addStreetAggression(undefined, row) : null;
  }

  /** #4 (M2): supply the Horse population reference for one (variant, format, table size); replaces that row. */
  static importStyleHorseReference(
    rows: ReadonlyArray<{
      variant: string;
      mode: MemoryMode;
      size: MemorySize;
      reference: StreetAggression;
    }>
  ): number {
    if ((this.sandboxDepth > 0 || this.decisionEffectSink) && !this.harnessStyleLearning)
      throw new Error('style reference import outside live boundary');
    let applied = 0;
    for (const r of rows) {
      const v = memoryVariant(r?.variant);
      if (
        !r ||
        !v ||
        !['cash', 'tournament'].includes(r.mode) ||
        !['hu', 'short', 'full'].includes(r.size) ||
        !r.reference
      )
        continue;
      // L-e: counts must be finite and non-negative
      const ok = (['flop', 'turn', 'river'] as const).every((st) =>
        (['aggr', 'passive', 'raiseOpps', 'raises'] as const).every(
          (k) => Number.isFinite(r.reference[st]?.[k]) && r.reference[st][k] >= 0
        )
      );
      if (!ok) continue;
      const key = `${v}|${r.mode}|${r.size}`;
      this.styleHorseReference.delete(key);
      this.styleHorseReference.set(key, addStreetAggression(undefined, r.reference));
      applied++;
    }
    while (this.styleHorseReference.size > MAX_TRACKED_PLAYERS)
      this.styleHorseReference.delete(this.styleHorseReference.keys().next().value!);
    return applied;
  }

  /** A2: supply river size buckets for one (player, variant, format, table size) context; replaces that context's row. */
  static importSizeBuckets(
    rows: ReadonlyArray<{
      user_id: string;
      variant: string;
      mode: MemoryMode;
      size: MemorySize;
      buckets: SizeBucketTallies;
    }>
  ): number {
    // L8: the same boundary rule as the other style imports (live, or a harness that switched learning on)
    if ((this.sandboxDepth > 0 || this.decisionEffectSink) && !this.harnessStyleLearning)
      throw new Error('size bucket import outside live boundary');
    let applied = 0;
    for (const r of rows) {
      const v = memoryVariant(r?.variant);
      if (
        !r ||
        typeof r.user_id !== 'string' ||
        !v ||
        !['cash', 'tournament'].includes(r.mode) ||
        !['hu', 'short', 'full'].includes(r.size)
      )
        continue;
      if (!r.buckets || Object.keys(r.buckets).length === 0) continue;
      const key = styleSizeKey(r.user_id, v, r.mode, r.size);
      this.styleSizeShown.delete(key);
      this.styleSizeShown.set(key, { ...r.buckets });
      applied++;
    }
    while (this.styleSizeShown.size > MAX_TRACKED_PLAYERS)
      this.styleSizeShown.delete(this.styleSizeShown.keys().next().value!);
    return applied;
  }

  /**
   * A3: supply m by RECOUNTING it from persisted hand history (read-only rows of each exact context, completed at or
   * after releaseStartMs) with the learner's own increment function. Same history, same m, after every restart.
   */
  static importPostReleaseFromHistory(
    rows: ReadonlyArray<{
      user_id: string;
      variant: string;
      mode: MemoryMode;
      size: MemorySize;
      hands: readonly PersistedHandForProvenance[];
    }>,
    releaseStartMs: number
  ): number {
    return this.importPostReleaseObservations(
      this.postReleaseRowsFromHistory(rows, releaseStartMs)
    );
  }

  /**
   * (b) 2026-11-13: one batch of m recounted and checked against the import rule, with no effect. The boot stages
   * every batch this way and imports only when none failed, so the discount lifts on complete data only.
   */
  static postReleaseRowsFromHistory(
    rows: ReadonlyArray<{
      user_id: string;
      variant: string;
      mode: MemoryMode;
      size: MemorySize;
      hands: readonly PersistedHandForProvenance[];
    }>,
    releaseStartMs: number
  ): Array<{
    user_id: string;
    variant: string;
    mode: MemoryMode;
    size: MemorySize;
    opportunities: PostReleaseOpportunities;
  }> {
    const out = rows.map((r) => ({
      user_id: r.user_id,
      variant: r.variant,
      mode: r.mode,
      size: r.size,
      opportunities: postReleaseOpportunitiesFromHistory(r.hands, r.user_id, releaseStartMs),
    }));
    this.assertPostReleaseRows(out);
    return out;
  }

  /**
   * The provenance of the counters a style read of this opponent in this context stands on: the exact row and the donor
   * row a thin read may borrow. A row is affected when ANY row consulted is (a cash, table-speed profile, or a cash
   * profile with no domain on file); its post-release weight is the LEAST discounted (smallest m) among them.
   */
  private static styleProvenanceOf(
    userId: string,
    variant: MemoryVariant | null,
    mode: MemoryMode,
    size: MemorySize
  ): StyleProvenance {
    const durableMemoryOn = this.durableOpponentMemory && variant !== null;
    const keys = variant
      ? [
          opponentMemoryKey(userId, variant, mode, size),
          ...opponentMemoryDonors(mode, size).map(([m, sz]) =>
            opponentMemoryKey(userId, variant, m, sz)
          ),
        ]
      : [];
    const known = keys.filter((k) => this.durableProfileComplete.has(k));
    const exactKey = keys[0];
    const complete: boolean | null =
      exactKey !== undefined && this.durableProfileComplete.has(exactKey)
        ? (this.durableProfileComplete.get(exactKey) as boolean)
        : durableMemoryOn
          ? null
          : true;
    // Rows this process learned itself carry the repaired learner: not affected. Imported durable rows are keyed.
    let preRepair: boolean | null = false;
    for (const k of known) {
      const f = this.durableProfilePreRepair.get(k);
      if (f === true) preRepair = true;
      else if (f === null && preRepair !== true) preRepair = null;
    }
    const postRelease: PostReleaseOpportunities = {};
    for (const stat of PRE_REPAIR_STATS) {
      let m: number | null = null;
      for (const k of known) {
        if (this.durableProfilePreRepair.get(k) === false) continue;
        const v = this.postReleaseObservations.get(k)?.[stat];
        const mm = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
        m = m === null ? mm : Math.min(m, mm);
      }
      postRelease[stat] = m;
    }
    return {
      source: durableMemoryOn ? 'durable' : 'live',
      complete,
      preRepair,
      postRelease,
    };
  }

  private static blendDurableRead(
    userId: string,
    variant: MemoryVariant,
    size: MemorySize,
    receipt = true
  ): ExploitCounters | undefined {
    const donorKeys = opponentMemoryDonors(this.decisionMode, size).map(([mode, donorSize]) =>
      opponentMemoryKey(userId, variant, mode, donorSize)
    );
    let donors = donorKeys.map((key) => this.exploitCounters.get(key));
    const pooledStaleness = this.donorStaleness;
    // The exact evidence a donor is blended with is only the exact
    // (variant, mode, size, speed/ante domain) row. This horse's individual
    // row is keyed by card family and table size alone, so it mixes cash and
    // tournament, the variants of a family and every speed/ante domain, and
    // is never blended with a domain-exact donor. On the pooled public path,
    // when no pooled exact row exists but that individual row does, the read
    // stays what it was before donors reached this path: the individual row
    // answers alone (the callers' fallback) and no donor is consulted.
    const exact = this.exploitCounters.get(
      opponentMemoryKey(userId, variant, this.decisionMode, size)
    );
    if (
      pooledStaleness &&
      !exact &&
      this.decisionScope &&
      this.exploitCounters.has(`${this.decisionScope}|${userId}`)
    )
      return undefined;
    let staleness = 0;
    let stalenessUnknown = false;
    if (pooledStaleness) {
      // The oldest donor sets the staleness, as the import-clock path does.
      // A donor with no staleness entry could not be dated on the player's
      // clock. "Could not tell" is never "fresh": it is not borrowed.
      donors = donors.map((row, i) => {
        if (!row) return row;
        const age = pooledStaleness.get(donorKeys[i]!);
        if (age === undefined) {
          stalenessUnknown = true;
          return undefined;
        }
        staleness = Math.max(staleness, age);
        return row;
      });
    } else {
      const handClock = this.stats.get(userId)?.hands ?? 0;
      let donorClock = handClock;
      for (const key of donorKeys) {
        const mark = this.durableOpponentImportClock.get(key);
        if (mark !== undefined && mark < donorClock) donorClock = mark;
      }
      staleness = computeDonorHandClockStaleness(donorClock, handClock);
    }
    const blended = blendOpponentMemoryWithExpiry(exact, donors, staleness);
    const thinExact = !(exact && exact.hands >= OPPONENT_MEMORY_THIN_HANDS);
    const consultedDonor = thinExact && donors.some((row) => !!row);
    if (thinExact && stalenessUnknown && receipt)
      noteFire('opponent_memory_donor_staleness_unknown');
    if (consultedDonor && receipt) {
      if (blended === exact) noteFire('opponent_memory_donor_expired');
      else if (staleness > 0) noteFire('opponent_memory_donor_stale');
      else noteFire('opponent_memory_donor_fresh');
    }
    return blended;
  }

  /**
   * The fast call-down read (HorseFastCalldownRead.ts) of this opponent for
   * the decision in flight: the river recency window, the same exploit
   * counters opponentRead is built from (fast and long river windows), and
   * the lifetime V23 river counters. Null without recent river evidence.
   * Pure: no random draws, no writes.
   */
  static fastCalldownRead(userId: string): FastCalldownRead | null {
    const scope = this.decisionScope;
    if (!scope) return null;
    const variant = memoryVariant(this.decisionVariant);
    const size = scope.split(':')[1] as MemorySize;
    const counters = variant
      ? (this.blendDurableRead(userId, variant, size) ??
        (this.durableOpponentMemory ? undefined : this.exploitCounters.get(`${scope}|${userId}`)))
      : this.exploitCounters.get(`${scope}|${userId}`);
    // The recency window is pooled (like the V7 window); the lifetime
    // counters are what riverFoldRate reads.
    const pooled = this.stats.get(userId);
    const life = this.readStats(userId);
    return fastCalldownRead({
      recentRiverOpps: pooled?.rvOpps ?? 0,
      recentRiverCalls: pooled?.rvCalls ?? 0,
      fastOpps: Number(counters?.fRiverCallOpp ?? 0),
      fastCalls: Number(counters?.fRiverCall ?? 0),
      longOpps: Number(counters?.riverCallOpp ?? 0),
      longCalls: Number(counters?.riverCall ?? 0),
      lifetimeOpps: life?.riverBetOpps ?? 0,
      lifetimeFolds: life?.riverBetFolds ?? 0,
    });
  }

  /**
   * PROBE BETS ARE NOT AGGRESSION (2026-11-08): while on, a read takes the
   * share of this player's checked-to bets that were probes back out of
   * betCheckedTo (HorseOpponentExploit probeAdjustedCounters). HorseLogic.decide
   * sets it from HorseDecideOpts.probeAwareAggression for each decision and
   * restores the default after; every read outside a decision uses the default.
   */
  private static probeAwareAggression = true;
  static setProbeAwareAggression(on: boolean): void {
    this.probeAwareAggression = on;
  }

  private static probeAdjusted<T extends Partial<ExploitCounters>>(
    userId: string,
    counters: T | undefined
  ): T | undefined {
    if (!counters || !this.probeAwareAggression) return counters;
    const pooled = this.stats.get(userId);
    const adjusted = probeAdjustedCounters(counters, pooled?.ctBets, pooled?.ctProbes);
    if (adjusted !== counters) noteFire('opponent_read_probe_bets_discounted');
    return adjusted;
  }

  static opponentRead(userId: string): OpponentExploitRead | null {
    const scope = this.decisionScope;
    if (!scope) return null;
    const variant = memoryVariant(this.decisionVariant);
    const size = scope.split(':')[1] as MemorySize;
    // A NEW TABLE IS NOT A NEW PLAYER (2026-10-24): a thin or missing exact
    // context borrows the nearest one this worker knows (blendOpponentMemory).
    // Item 12 (2026-11-05): the borrowed bucket is weighed by how long ago it
    // was last refreshed on this player's own hand clock
    // (blendOpponentMemoryWithExpiry: 120-hand half-life, and a taper to zero
    // as the exact row reaches its own thin line, so there is no step at 12).
    const durable = variant ? this.blendDurableRead(userId, variant, size) : undefined;
    // A KNOWN MANIAC IS A MANIAC AT EVERY TABLE SIZE (2026-10-25): the same
    // game's sibling table size, read against ITS own envelope, may
    // corroborate a statistic this size already places past every horse.
    const family = scope.split(':')[0];
    const siblings =
      durable && variant
        ? opponentMemoryDonors(this.decisionMode, size).map(([mode, donorSize]) =>
            opponentExploitRead(
              this.exploitCounters.get(opponentMemoryKey(userId, variant, mode, donorSize)),
              `${family}:${donorSize}` as ReadScope,
              this.decisionVariant
            )
          )
        : [];
    const read = opponentExploitRead(
      this.probeAdjusted(
        userId,
        durable ??
          (this.durableOpponentMemory && variant
            ? undefined
            : this.exploitCounters.get(`${scope}|${userId}`))
      ),
      scope,
      this.decisionVariant,
      siblings
    );
    if (read?.corroborated) noteFire('opponent_exploit_corroborated');
    // Owner update 2026-10-27: the same public-information policy applies
    // against people and horses. Every unknown Omaha opponent receives the
    // same presumption, withdrawn by that opponent's actual evidence.
    if (family === 'omaha' && this.decisionReadOptions.omahaNeutralUnknown === true) {
      // Neutral: identical to the presumption path in every outcome except the
      // one where the presumption would apply; there the opponent's own
      // measured statistics with nothing engaged (see neutralUnknownRead).
      const neutral = neutralUnknownRead(
        read,
        this.probeAdjusted(userId, durable ?? this.exploitCounters.get(`${scope}|${userId}`)),
        scope,
        this.decisionVariant
      );
      if (neutral.outcome === 'presumed') noteFire('plo_opponent_neutral_unknown');
      else if (neutral.outcome === 'disproved') noteFire('plo_opponent_presumption_disproved');
      return neutral.read;
    }
    if (family === 'omaha') {
      const presumed = presumedAggressorRead(
        read,
        this.probeAdjusted(userId, durable ?? this.exploitCounters.get(`${scope}|${userId}`)),
        scope,
        this.decisionVariant
      );
      if (presumed.outcome === 'presumed') noteFire('plo_opponent_presumed_aggressive');
      else if (presumed.outcome === 'disproved') noteFire('plo_opponent_presumption_disproved');
      return presumed.read;
    }
    return read;
  }

  /**
   * STYLE READ (2026-11-13, HorseOpponentStyle): how this opponent plays, on
   * two axes (entry: loose to tight; honesty: bluff-heavy to value-heavy) with
   * confidence and a telemetry-only label, for the decision in flight. It reads
   * the same decayed counters opponentRead is built from (the exact context's
   * durable row with its donors) plus the same player's counters from the OTHER
   * format (carried at a shrunk weight by the classifier) and the lifetime
   * tallies legacyExploit reads. A SEPARATE function: OpponentExploitRead and
   * opponentRead are unchanged, so the Omaha presumption and every other
   * consumer of them are untouched. Unknown (no scope, no evidence) is the
   * neutral read. Pure: no random draws, no writes. Only the consumers behind
   * the default-off style flags call it, so with every flag off nothing here
   * runs.
   */
  static styleRead(userId: string): OpponentStyleRead {
    // LATENCY (2026-11-13): the style read's own time per decision, against the pre-registered budget
    const t0 = performance.now();
    try {
      return this.styleReadUntimed(userId);
    } finally {
      addStyleReadMs(performance.now() - t0);
    }
  }

  private static styleReadUntimed(userId: string): OpponentStyleRead {
    const scope = this.decisionScope;
    if (!scope) return unknownStyle('no_decision_scope');
    const variant = memoryVariant(this.decisionVariant);
    const mode = this.decisionMode;
    const size = scope.split(':')[1] as MemorySize;
    const own = this.decisionExploitCounters(userId);
    const pooled = this.stats.get(userId);
    const counters =
      own && this.probeAwareAggression
        ? probeAdjustedCounters(own, pooled?.ctBets, pooled?.ctProbes)
        : own;
    const carryWeight = this.decisionReadOptions.styleCarryWeight ?? 0;
    const carry =
      variant && carryWeight > 0
        ? this.exploitCounters.get(
            opponentMemoryKey(userId, variant, mode === 'cash' ? 'tournament' : 'cash', size)
          )
        : undefined;
    // Provenance: a durable profile imported without complete observations is
    // discounted; a counter row built live by this process is complete; a
    // durable context nobody qualified is "not known" (capped, not trusted).
    const provenance = this.styleProvenanceOf(userId, variant, mode, size);
    // H1 (review 2026-11-13): evidence of THIS format and variant only. Shown strength comes from this context's
    // river size buckets. The scoped lifetime tallies (variant and table size, but cash and tournament mixed) enter
    // only as an explicit carry-over at styleCarryWeight (default 0); the all-variant pooled fallback never does.
    const sizeBuckets = variant
      ? (this.styleSizeShown.get(styleSizeKey(userId, variant, mode, size)) ?? null)
      : null;
    const s = carryWeight > 0 ? this.scoped.get(`${scope}|${userId}`) : undefined;
    const w = carryWeight;
    const agg = variant
      ? this.styleAggression.get(styleSizeKey(userId, variant, mode, size))
      : undefined;
    // Notes (review 15961b66): with carry 0 the recent-aggression window (rAggr/rPassive) is 0, so release comes from the
    // in-format fast-window counters only (L/M2). At carry > 0 the scoped tallies include this format too, so in-format
    // evidence is counted again at weight w (L4; default 0). The probe-aware adjustment of the counters still uses the
    // pooled ctBets/ctProbes of the existing exploit read (L1, pre-existing mechanism).
    const inFormat: StyleTallies = {
      ...inFormatShownTallies(sizeBuckets),
      ...inFormatAggressionTallies(agg),
    };
    const style = classifyOpponentStyle({
      scope,
      variant: this.decisionVariant,
      domain: mode,
      counters,
      carry,
      carryWeight,
      provenance,
      sizeBuckets,
      streetAggression: agg ?? null,
      horseStreetReference: variant
        ? (this.styleHorseReference.get(`${variant}|${mode}|${size}`) ?? null)
        : null,
      tallies: s
        ? {
            bigBetSD: (inFormat.bigBetSD ?? 0) + w * s.bigBetSD,
            bigBetSDStrong: (inFormat.bigBetSDStrong ?? 0) + w * s.bigBetSDStrong,
            shownOpportunities: (inFormat.shownOpportunities ?? 0) + w * s.postAggr,
            postAggr: (inFormat.postAggr ?? 0) + w * s.postAggr,
            postPassive: (inFormat.postPassive ?? 0) + w * s.postPassive,
            rAggr: w * s.rAggr,
            rPassive: w * s.rPassive,
            ctBets: w * (s.ctBets ?? 0),
            ctProbes: w * (s.ctProbes ?? 0),
          }
        : inFormat,
    });
    noteFire(`style_label_${style.label}_seen`);
    if (style.release.standDown) noteFire('style_read_released_seen');
    return style;
  }

  static targetingOf(heroId: string, oppId: string): number {
    const p = this.pairs.get(`${oppId}|${heroId}`);
    if (!p) return 0;
    const g = this.stats.get(oppId);
    let score = 0;

    if (p.opp3 >= 6) {
      const pairRate = p.n3 / p.opp3;
      const globalRate = g && g.hands >= 10 ? Math.min(0.5, (g.threeBet / g.hands) * 3) : 0.12;
      const excess = pairRate - Math.max(globalRate * 1.5, 0.18);
      if (excess > 0) score += Math.min(0.6, excess * 1.6);
    }
    if (p.oppR >= 6) {
      const pairRate = p.nR / p.oppR;
      const excess = pairRate - 0.18; // baseline bet-raise rate
      if (excess > 0) score += Math.min(0.5, excess * 1.4);
    }
    return Math.min(1, score);
  }

  /** Test hook: read a pair's raw counters. */
  static getPair(
    attackerId: string,
    victimId: string
  ): { n3: number; opp3: number; nR: number; oppR: number } | undefined {
    return this.pairs.get(`${attackerId}|${victimId}`);
  }

  /** Stable per-hand key shared by observe(), plans, and callers. */
  static handKeyOf(history: ActionRecord[] | undefined): string | null {
    return horseMindHandKey(history);
  }

  /** Read-only access for diagnostics/tests. */
  static getStats(userId: string): OpponentStats | undefined {
    return this.stats.get(userId);
  }

  // ── V45 SCOPED READS ────────────────────────────────────────────────────

  /** Set by HorseLogic.decide for the decision in flight; null outside one. */
  static setDecisionScope(
    scope: ReadScope | null,
    variant: string | null = null,
    mode: MemoryMode = 'cash',
    _legacyHumanRoster: readonly string[] | null = null
  ): void {
    this.decisionMode = mode;
    this.decisionScope = scope;
    this.decisionVariant = scope ? variant : null;
    if (!scope) this.decisionReadOptions = {};
  }

  /** Set by HorseLogic beside the decision scope; cleared with it. */
  static setDecisionReadOptions(options: DecisionReadOptions): void {
    this.decisionReadOptions = this.decisionScope ? { ...options } : {};
  }

  static currentDecisionReadOptions(): Readonly<DecisionReadOptions> {
    return this.decisionReadOptions;
  }

  static currentScope(): ReadScope | null {
    return this.decisionScope;
  }

  /** The scoped bucket for (scope, user), for tests and the persistence layer. */
  static getScopedStats(userId: string, scope: ReadScope): OpponentStats | undefined {
    return this.scoped.get(`${scope}|${userId}`);
  }

  /**
   * What a READ sees: the scoped bucket when a scope is set and it has
   * SCOPE_MIN_HANDS, else the pooled bucket. Every accessor below that
   * prices a decision goes through here.
   */
  private static readStats(userId: string, shrink = true): OpponentStats | undefined {
    if (this.decisionScope) {
      const sc = this.scoped.get(`${this.decisionScope}|${userId}`);
      if (sc && sc.hands >= SCOPE_MIN_HANDS) return sc;
      // Scoped shrink: this game's own thin read, never another game's.
      if (shrink && this.decisionReadOptions.scopedShrink)
        return sc ? shrinkScopedStats(sc, SCOPED_SHRINK_PRIOR[this.decisionScope]) : undefined;
    }
    return this.stats.get(userId);
  }

  private static scopedFor(userId: string, scope: ReadScope): OpponentStats {
    const key = `${scope}|${userId}`;
    let sc = this.scoped.get(key);
    if (!sc) {
      if (this.scoped.size >= MAX_TRACKED_PLAYERS * 4)
        for (const evicted of evictOldest(this.scoped, MAX_TRACKED_PLAYERS * 4))
          this.dirtyScoped.delete(evicted);
      sc = freshStats();
      this.scoped.set(key, sc);
    }
    this.dirtyScoped.add(key);
    return sc;
  }

  private static applyScopedDelta(
    userId: string,
    before: OpponentStats,
    after: OpponentStats,
    contributionWindow: HorseObservationWindow
  ): void {
    const scope = this.decisionScope;
    if (!scope) return;
    let touched = false;
    let sc: OpponentStats | null = null;
    let hadContributions = false;
    for (const f of SCOPED_FIELDS) {
      const d = after[f] - before[f];
      if (d === 0) continue;
      if (!sc) {
        sc = this.scopedFor(userId, scope);
        hadContributions = hasContributions(sc);
      }
      sc[f] += d;
      touched = true;
    }
    if (touched && sc)
      sc.sourceWindow = hadContributions
        ? mergeHorseObservationWindows(sc.sourceWindow, contributionWindow)
        : normalizeHorseObservationWindow(contributionWindow);
  }

  /** V45 persistence: scoped rows changed since the last flush. */
  static exportDirtyScoped(): Array<{ user_id: string; scope: ReadScope } & OpponentStats> {
    const out: Array<{ user_id: string; scope: ReadScope } & OpponentStats> = [];
    for (const key of this.dirtyScoped) {
      const sc = this.scoped.get(key);
      if (!sc) continue;
      const bar = key.indexOf('|');
      out.push({ user_id: key.slice(bar + 1), scope: key.slice(0, bar) as ReadScope, ...sc });
    }
    this.dirtyScoped.clear();
    return out;
  }

  static requeueDirtyScoped(keys: Array<{ user_id: string; scope: ReadScope }>): void {
    for (const k of keys) {
      const key = `${k.scope}|${k.user_id}`;
      if (this.scoped.has(key)) this.dirtyScoped.add(key);
    }
  }

  static dirtyScopedCount(): number {
    return this.dirtyScoped.size;
  }

  /** V45 boot hydration; a row applies only when it knows more than memory. */
  static importScoped(
    rows: Array<{ user_id: string; scope: string } & Partial<OpponentStats>>
  ): number {
    let applied = 0;
    const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
    for (const r of rows) {
      if (!r || typeof r.user_id !== 'string' || typeof r.scope !== 'string') continue;
      const key = `${r.scope}|${r.user_id}`;
      const existing = this.scoped.get(key);
      const incoming = num(r.hands);
      if (existing && existing.hands >= incoming) continue;
      if (this.scoped.size >= MAX_TRACKED_PLAYERS * 4 && !existing) continue;
      const next = freshStats();
      for (const f of SCOPED_FIELDS) {
        next[f] = Math.max(
          existing ? (existing[f] ?? 0) : 0,
          num((r as Record<string, unknown>)[f])
        );
      }
      next.sourceWindow = importedWindow(r, existing);
      const hu = mergeMultiwayRiverStates(existing?.riverHu, r.riverHu, true);
      if (hu) next.riverHu = hu;
      this.scoped.set(key, next);
      applied++;
    }
    return applied;
  }

  /** Test hook: wipe all memory. */
  static reset(): void {
    resetWinnerReads();
    this.stats.clear();
    this.seenActions.clear();
    this.handFlags.clear();
    this.plans.clear();
    this.raisePlans.clear();
    this.outlooks.clear();
    this.dirty.clear();
    this.pairs.clear();
    this.dirtyPairs.clear();
    this.scoped.clear();
    this.dirtyScoped.clear();
    this.exploitCounters.clear();
    this.flopStabCounters.clear();
    this.hydratedHandKeys.clear();
    this.styleBootHandKeys.clear();
    this.durableOpponentVersions.clear();
    this.durableProfileComplete.clear();
    this.durableProfilePreRepair.clear();
    this.postReleaseObservations.clear();
    this.styleSizeShown.clear();
    this.styleAggression.clear();
    this.styleHorseReference.clear();
    this.durableOpponentImportClock.clear();
    this.planFingerprints.clear();
    this.durableOpponentMemory = false;
    this.decisionMode = 'cash';
    this.decisionScope = null;
    this.decisionVariant = null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // V12 PERSISTENCE (2026-08-22) — unlimited learning horizon
  // ───────────────────────────────────────────────────────────────────────

  /** Rows changed since the last flush. Snapshots AND clears the dirty set —
   *  the caller owns delivery; on failure it should re-mark via requeue(). */
  static exportDirty(): Array<{ user_id: string } & OpponentStats> {
    const out: Array<{ user_id: string } & OpponentStats> = [];
    for (const id of this.dirty) {
      const s = this.readStats(id, false);
      if (s) out.push({ user_id: id, ...s });
    }
    this.dirty.clear();
    return out;
  }

  /** Put ids back on the dirty list after a failed flush. */
  static requeueDirty(ids: string[]): void {
    for (const id of ids) if (this.stats.has(id)) this.dirty.add(id);
  }

  static dirtyCount(): number {
    return this.dirty.size;
  }

  /**
   * Boot-time hydration from the DB. A row is applied only when it knows MORE
   * than memory does (more observed hands) — a late hydrate must never
   * downgrade stats the engine has already been accumulating live.
   * Returns the number of rows applied.
   */
  static importStats(rows: Array<{ user_id: string } & Partial<OpponentStats>>): number {
    let applied = 0;
    for (const r of rows) {
      if (!r || typeof r.user_id !== 'string' || r.user_id.length === 0) continue;
      const existing = this.stats.get(r.user_id);
      const incomingHands = typeof r.hands === 'number' && isFinite(r.hands) ? r.hands : 0;
      if (existing && existing.hands >= incomingHands) continue;
      if (this.stats.size >= MAX_TRACKED_PLAYERS && !existing) continue;
      const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
      // V28 AUDIT FIX: the import REPLACED the whole object, and the fields
      // that were unpersisted at the time (riverBet*, checks, the recency
      // window) came in as 0 — any live sample accumulated before the hydrate
      // was destroyed. Those fields keep the larger of live and incoming, so
      // a hydrate can only add information (V34 persists them, and a
      // snapshot older than that migration still reads them as 0).
      const keep = (live: number | undefined, incoming: number): number =>
        Math.max(existing ? (live ?? 0) : 0, incoming);
      this.stats.set(r.user_id, {
        sourceWindow: importedWindow(r, existing),
        ...(mergeMultiwayRiverStates(existing?.riverHu, r.riverHu, true)
          ? { riverHu: mergeMultiwayRiverStates(existing?.riverHu, r.riverHu, true) }
          : {}),
        hands: num(r.hands),
        vpip: num(r.vpip),
        pfr: num(r.pfr),
        threeBet: num(r.threeBet),
        aggr: num(r.aggr),
        passive: num(r.passive),
        folds: num(r.folds),
        facedAggr: num(r.facedAggr),
        cbetOpps: num(r.cbetOpps),
        cbetFolds: num(r.cbetFolds),
        f3bOpps: num(r.f3bOpps),
        f3bFolds: num(r.f3bFolds),
        bigBetSD: num(r.bigBetSD),
        bigBetSDStrong: num(r.bigBetSDStrong),
        riverBetOpps: keep(existing?.riverBetOpps, num(r.riverBetOpps)),
        riverBetFolds: keep(existing?.riverBetFolds, num(r.riverBetFolds)),
        riverLastToActOpps: keep(existing?.riverLastToActOpps, num(r.riverLastToActOpps)),
        riverLastToActBets: keep(existing?.riverLastToActBets, num(r.riverLastToActBets)),
        riverTripleCheckRaiseOpps: keep(
          existing?.riverTripleCheckRaiseOpps,
          num(r.riverTripleCheckRaiseOpps)
        ),
        riverTripleCheckRaiseFolds: keep(
          existing?.riverTripleCheckRaiseFolds,
          num(r.riverTripleCheckRaiseFolds)
        ),
        rHands: keep(existing?.rHands, num(r.rHands)),
        rFolds: keep(existing?.rFolds, num(r.rFolds)),
        rFacedAggr: keep(existing?.rFacedAggr, num(r.rFacedAggr)),
        rAggr: keep(existing?.rAggr, num(r.rAggr)),
        rPassive: keep(existing?.rPassive, num(r.rPassive)),
        checks: keep(existing?.checks, num(r.checks)),
        postAggr: keep(existing?.postAggr, num((r as { postAggr?: number }).postAggr)),
        postPassive: keep(existing?.postPassive, num((r as { postPassive?: number }).postPassive)),
        rChecks: keep(existing?.rChecks, num(r.rChecks)),
        snapBetSD: keep(existing?.snapBetSD, num(r.snapBetSD)),
        snapBetSDStrong: keep(existing?.snapBetSDStrong, num(r.snapBetSDStrong)),
        tankBetSD: keep(existing?.tankBetSD, num(r.tankBetSD)),
        tankBetSDStrong: keep(existing?.tankBetSDStrong, num(r.tankBetSDStrong)),
        // 2026-10-25: persisted from the river-call migration on; a snapshot
        // older than it reads 0, so keep the larger like the V43 reads.
        riverCallSD: keep(existing?.riverCallSD, num(r.riverCallSD)),
        riverCallSDWeak: keep(existing?.riverCallSDWeak, num(r.riverCallSDWeak)),
        // Memory only: a hydrate never carries it, and never erases it. A
        // mirrored shard's import (mindMirror) carries it for a new row.
        ...(existing?.rvOpps !== undefined
          ? { rvOpps: existing.rvOpps, rvCalls: existing.rvCalls ?? 0 }
          : r.rvOpps !== undefined
            ? { rvOpps: num(r.rvOpps), rvCalls: Math.min(num(r.rvCalls), num(r.rvOpps)) }
            : {}),
        // Probe tallies: memory only, the same rule as the river window.
        ...(existing?.ctBets !== undefined
          ? { ctBets: existing.ctBets, ctProbes: existing.ctProbes ?? 0 }
          : r.ctBets !== undefined
            ? { ctBets: num(r.ctBets), ctProbes: Math.min(num(r.ctProbes), num(r.ctBets)) }
            : {}),
        // Limp-reraise tallies: memory only, the same rule.
        ...(existing?.lrOpps !== undefined
          ? { lrOpps: existing.lrOpps, lrRaises: existing.lrRaises ?? 0 }
          : r.lrOpps !== undefined
            ? { lrOpps: num(r.lrOpps), lrRaises: Math.min(num(r.lrRaises), num(r.lrOpps)) }
            : {}),
      });
      applied++;
    }
    return applied;
  }

  /**
   * Pair rows changed since the last flush. Snapshots AND clears the dirty
   * set — the caller owns delivery; on failure it should re-mark via
   * requeueDirtyPairs().
   */
  static exportDirtyPairs(): Array<{
    attacker_id: string;
    victim_id: string;
    n3: number;
    opp3: number;
    nR: number;
    oppR: number;
  }> {
    const out: Array<{
      attacker_id: string;
      victim_id: string;
      n3: number;
      opp3: number;
      nR: number;
      oppR: number;
    }> = [];
    for (const k of this.dirtyPairs) {
      const p = this.pairs.get(k);
      if (!p) continue;
      const sep = k.indexOf('|');
      if (sep <= 0 || sep >= k.length - 1) continue;
      out.push({ attacker_id: k.slice(0, sep), victim_id: k.slice(sep + 1), ...p });
    }
    this.dirtyPairs.clear();
    return out;
  }

  /** Put pair keys back on the dirty list after a failed flush. */
  static requeueDirtyPairs(keys: Array<{ attacker_id: string; victim_id: string }>): void {
    for (const k of keys) {
      const key = `${k.attacker_id}|${k.victim_id}`;
      if (this.pairs.has(key)) this.dirtyPairs.add(key);
    }
  }

  /** V12.3: drop hydrated pair memory (used when a failed stats hydrate forces
   *  a full-window replay, which would otherwise double-count them). The DB
   *  copy is untouched — the next boot restores it. */
  static clearPairs(): void {
    this.pairs.clear();
    this.dirtyPairs.clear();
  }

  static dirtyPairsCount(): number {
    return this.dirtyPairs.size;
  }

  /**
   * Boot-time pair hydration from the DB. A row is applied only when it has
   * seen MORE opportunities (opp3 + oppR) than memory has — a late hydrate
   * must never downgrade counters the engine has been accumulating live.
   * Returns the number of rows applied.
   */
  static importPairs(
    rows: Array<{
      attacker_id: string;
      victim_id: string;
      n3?: number;
      opp3?: number;
      nR?: number;
      oppR?: number;
    }>
  ): number {
    let applied = 0;
    const num = (v: unknown): number =>
      typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    for (const r of rows) {
      if (!r || typeof r.attacker_id !== 'string' || r.attacker_id.length === 0) continue;
      if (typeof r.victim_id !== 'string' || r.victim_id.length === 0) continue;
      const key = `${r.attacker_id}|${r.victim_id}`;
      const incoming = { n3: num(r.n3), opp3: num(r.opp3), nR: num(r.nR), oppR: num(r.oppR) };
      const existing = this.pairs.get(key);
      if (existing && existing.opp3 + existing.oppR >= incoming.opp3 + incoming.oppR) continue;
      if (!existing && this.pairs.size >= this.MAX_PAIRS) continue;
      this.pairs.set(key, incoming);
      applied++;
    }
    return applied;
  }

  // ───────────────────────────────────────────────────────────────────────
  // V12.2 SANDBOX (2026-08-22) — a pollution-free mind for self-play
  // ───────────────────────────────────────────────────────────────────────

  /**
   * The league runs thousands of synthetic hands inside the production
   * process. Until V12.2 it had to pass `mind:false`, because HorseMind's
   * state is static and shared — observing a synthetic hand would write
   * `league-*` reads into the live opponent memory (and into the DB via the
   * persistence flush). That meant the one layer the league could never
   * measure was the mind itself.
   *
   * A sandbox is a complete spare set of the seven state containers.
   * `runInSandbox` swaps them in, runs the callback, and swaps the live set
   * back in a finally — the callback is SYNCHRONOUS by contract, and every
   * HorseLogic.decide call is synchronous, so nothing else in the process
   * can observe the swapped state: timers and flushes only run when the
   * event loop yields, which it cannot do mid-callback. The sandbox's dirty
   * sets are never exported, so nothing synthetic can reach the DB.
   */
  private static sandboxDepth = 0;
  /**
   * The live worker may compute an answer that becomes stale before its think
   * timer fires. Keep intent writes out of the durable mind until the exact
   * action is accepted by HandController. This is synchronous and deliberately
   * non-nestable: HorseLogic and every writer it calls are synchronous.
   */
  private static decisionEffectSink: HorseMindDecisionEffect[] | null = null;

  static captureDecisionEffects<T>(fn: () => T): CapturedHorseMindDecision<T> {
    if (this.decisionEffectSink) {
      throw new Error('HorseMind.captureDecisionEffects: capture already active');
    }
    const effects: HorseMindDecisionEffect[] = [];
    this.decisionEffectSink = effects;
    try {
      return { value: fn(), effects };
    } finally {
      this.decisionEffectSink = null;
    }
  }

  /** Apply one accepted decision's idempotent intent writes in FIFO order. */
  static applyDecisionEffects(effects: readonly HorseMindDecisionEffect[]): void {
    if (!horseDecisionEffectsAreValid(effects)) {
      throw new Error('HorseMind.applyDecisionEffects: invalid decision effects');
    }
    if (this.decisionEffectSink) {
      throw new Error('HorseMind.applyDecisionEffects: cannot commit during capture');
    }
    for (const effect of effects) {
      if (effect.type === 'plan') {
        this.notePlan(effect.handKey, effect.userId, effect.barrelIntent);
      } else if (effect.type === 'outlook') {
        this.noteOutlook(
          effect.handKey,
          effect.userId,
          effect.street,
          [...effect.good],
          [...effect.scare]
        );
      } else if (effect.type === 'raise_plan') {
        this.noteRaisePlan(effect.handKey, effect.userId, effect.street, effect.plan);
      } else if (effect.type === 'plan_fingerprint') {
        this.notePlanFingerprint(effect.handKey, effect.userId, effect.street, {
          contenderIds: [...effect.contenderIds],
          effectiveStackChips: effect.effectiveStackChips,
          potChips: effect.potChips,
          bigBlindChips: effect.bigBlindChips,
        });
      } else {
        const neverEffect: never = effect;
        throw new Error(`HorseMind.applyDecisionEffects: unknown effect ${String(neverEffect)}`);
      }
    }
  }

  static createSandbox(): HorseMindSandbox {
    return {
      stats: new Map(),
      seenActions: new Set(),
      handFlags: new Set(),
      dirty: new Set(),
      pairs: new Map(),
      dirtyPairs: new Set(),
      plans: new Map(),
      raisePlans: new Map(),
      outlooks: new Map(),
      scoped: new Map(),
      dirtyScoped: new Set(),
      exploit: new Map(),
      flopStab: new Map(),
      planFingerprints: new Map(),
    };
  }

  /** Private read view for a second look at the same hand. Copy only the
   * table's at-most-ten players, their scoped rows, pair reads and hand plans.
   * No global-map scan, observation dedupe, dirty rows or pending writes enter
   * this view. It is valid only with observation disabled and intent captured;
   * it is not a full restart checkpoint or a persistence input.
   */
  static snapshotDecisionReads(
    players: readonly SeatPlayer[],
    handKey: string | null,
    memoryContext?: { variant: string; mode: MemoryMode; size: MemorySize }
  ): HorseMindSandbox {
    const ids = players.map((player) => player.user_id);
    if (
      ids.length < 1 ||
      ids.length > 10 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 256) ||
      (handKey !== null && (typeof handKey !== 'string' || handKey.length > 512)) ||
      this.decisionEffectSink
    )
      throw new Error('HorseMind.snapshotDecisionReads: invalid boundary');
    const view = this.createSandbox();
    const snapshotScope = memoryContext
      ? `${readScopeOf(memoryContext.variant, 6).split(':')[0]}:${memoryContext.mode}`
      : this.activeWinnerScope();
    view.winnerReads = snapshotWinnerReads(ids, snapshotScope);
    for (const id of ids) {
      const stats = this.stats.get(id);
      if (stats) view.stats.set(id, { ...stats });
      for (const family of ['holdem', 'omaha', 'sixplus']) {
        for (const size of ['hu', 'short', 'full']) {
          const key = `${family}:${size}|${id}`;
          const scoped = this.scoped.get(key);
          if (scoped) view.scoped.set(key, { ...scoped });
          const exploit = this.exploitCounters.get(key);
          if (exploit) view.exploit.set(key, { ...exploit });
          const flop = this.flopStabCounters.get(key);
          if (flop) (view.flopStab ??= new Map()).set(key, { ...flop });
        }
      }
      const game = memoryContext ? memoryVariant(memoryContext.variant) : null;
      const variants = memoryContext ? (game ? [game] : []) : MEMORY_VARIANTS;
      const modes: readonly MemoryMode[] = memoryContext
        ? [memoryContext.mode]
        : ['cash', 'tournament'];
      const sizes: readonly MemorySize[] = memoryContext
        ? [memoryContext.size]
        : ['hu', 'short', 'full'];
      for (const variant of variants)
        for (const mode of modes)
          for (const size of sizes) {
            const key = opponentMemoryKey(id, variant, mode, size);
            const row = this.exploitCounters.get(key);
            if (row) view.exploit.set(key, { ...row });
            else if (this.durableOpponentMemory) view.exploit.set(key, freshExploitCounters());
            // The second look reads exactly what the first did, so the donor
            // contexts opponentRead may borrow travel with the exact one.
            if (!memoryContext) continue;
            for (const [donorMode, donorSize] of opponentMemoryDonors(mode, size)) {
              const donorKey = opponentMemoryKey(id, variant, donorMode, donorSize);
              const donor = this.exploitCounters.get(donorKey);
              if (donor) view.exploit.set(donorKey, { ...donor });
              const donorAge = this.donorStaleness?.get(donorKey);
              if (donor && donorAge !== undefined)
                (view.donorStaleness ??= new Map()).set(donorKey, donorAge);
            }
          }
      for (const other of ids) {
        const key = `${id}|${other}`;
        const pair = this.pairs.get(key);
        if (pair) view.pairs.set(key, { ...pair });
      }
      if (handKey === null) continue;
      const key = `${handKey}|${id}`;
      if (this.plans.has(key)) view.plans.set(key, this.plans.get(key)!);
      for (const street of ['preflop', 'flop', 'turn', 'river']) {
        const streetKey = `${key}|${street}`;
        const plan = this.raisePlans.get(streetKey);
        if (plan !== undefined) view.raisePlans.set(streetKey, plan);
        const outlook = this.outlooks.get(streetKey);
        if (outlook)
          view.outlooks.set(streetKey, {
            good: new Set(outlook.good),
            scare: new Set(outlook.scare),
          });
        const fingerprint = this.planFingerprints.get(streetKey);
        if (fingerprint)
          (view.planFingerprints ??= new Map()).set(streetKey, {
            ...fingerprint,
            activeContenderIds: [...fingerprint.activeContenderIds],
          });
      }
    }
    return view;
  }

  static runInSandbox<T>(sandbox: HorseMindSandbox, fn: () => T): T {
    if (this.sandboxDepth > 0) {
      // Nested sandboxes have no use case; refusing beats silently mixing
      // two sandboxes' state.
      throw new Error('HorseMind.runInSandbox: already inside a sandbox');
    }
    if (this.decisionEffectSink) {
      throw new Error('HorseMind.runInSandbox: cannot cross an active effect capture');
    }
    const liveScope = this.decisionScope;
    const liveVariant = this.decisionVariant;
    const liveMode = this.decisionMode;
    const liveDurable = this.durableOpponentMemory;
    this.durableOpponentMemory = false;
    const live = {
      stats: this.stats,
      seenActions: this.seenActions,
      handFlags: this.handFlags,
      dirty: this.dirty,
      pairs: this.pairs,
      dirtyPairs: this.dirtyPairs,
      plans: this.plans,
      raisePlans: this.raisePlans,
      outlooks: this.outlooks,
      scoped: this.scoped,
      dirtyScoped: this.dirtyScoped,
      exploit: this.exploitCounters,
      flopStab: this.flopStabCounters,
      planFingerprints: this.planFingerprints,
      donorStaleness: this.donorStaleness,
    };
    this.stats = sandbox.stats;
    this.donorStaleness = sandbox.donorStaleness ?? null;
    // A sandbox built before the exploit layer (or by a caller that only
    // knows the older fields) reads as "no exploit memory", never as live.
    this.exploitCounters = sandbox.exploit ?? new Map();
    this.flopStabCounters = sandbox.flopStab ?? new Map();
    this.scoped = sandbox.scoped;
    this.dirtyScoped = sandbox.dirtyScoped;
    this.seenActions = sandbox.seenActions;
    this.handFlags = sandbox.handFlags;
    this.dirty = sandbox.dirty;
    this.pairs = sandbox.pairs;
    this.dirtyPairs = sandbox.dirtyPairs;
    this.plans = sandbox.plans;
    this.raisePlans = sandbox.raisePlans;
    this.outlooks = sandbox.outlooks;
    // A snapshot taken before the fingerprint layer reads as "no plan
    // fingerprint", never as the live map.
    this.planFingerprints = sandbox.planFingerprints ?? new Map();
    this.sandboxDepth = 1;
    this.decisionScope = null;
    this.decisionVariant = null;
    try {
      return runWithWinnerReadState((sandbox.winnerReads ??= createWinnerReadState()), fn);
    } finally {
      this.stats = live.stats;
      this.seenActions = live.seenActions;
      this.handFlags = live.handFlags;
      this.dirty = live.dirty;
      this.pairs = live.pairs;
      this.dirtyPairs = live.dirtyPairs;
      this.plans = live.plans;
      this.raisePlans = live.raisePlans;
      this.outlooks = live.outlooks;
      this.planFingerprints = live.planFingerprints;
      this.donorStaleness = live.donorStaleness;
      this.scoped = live.scoped;
      this.dirtyScoped = live.dirtyScoped;
      this.exploitCounters = live.exploit;
      this.flopStabCounters = live.flopStab;
      this.sandboxDepth = 0;
      this.decisionScope = liveScope;
      this.decisionVariant = liveVariant;
      this.decisionMode = liveMode;
      this.durableOpponentMemory = liveDurable;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // RANGE READING — preflop line THIS hand -> strength band, stat-adjusted
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Returns the [lo, hi] preflop-strength band this opponent's current-hand
   * line represents, or null when nothing is known (sample uniformly).
   * Bands are in the same 0..1 percentile space as the preflop classifiers.
   */
  static bandFor(
    userId: string,
    history: ActionRecord[] | undefined,
    bigBlind: number,
    sizedReads: boolean = true,
    board: Card[] | null = null,
    /** V12 out-param: postflop aggression weight + checked-street count for
     *  board-contact conditioning (see HorseEval.simulateEquity). */
    readOut?: OppPostflopRead,
    /** Exact initial forced-money state for live controller histories, which
     * omit FORCED_BETS_POSTED from actionHistory. Never contains hole cards. */
    initialPublicMoney?: { pot: number; streetBets: ReadonlyArray<readonly [string, number]> }
  ): [number, number] | null {
    if (!history || history.length === 0) return null;
    const postStagesActed = new Set<string>();

    let raisesBefore = 0;
    let line: 'none' | 'limp' | 'call' | 'open' | 'threebet' | 'fourbet' | 'check' = 'none';
    // V36 (2026-09-02): a BOMB POT has no preflop street. Every hand at the
    // table is a random deal, which is the right BASE — but the postflop
    // narrowing below still applies, and it never did: `line` stayed 'none'
    // and the function returned null, so a player who bet the flop, barrelled
    // the turn and bombed the river of a bomb pot was still sampled from all
    // 1,326 combos. sawPreflop tells the two cases apart.
    let sawPreflop = false;
    let actedPostflop = false;
    // V5 (2026-07-24): dynamic hand reading — postflop actions keep narrowing
    // the band. V7: the narrowing is BET-SIZE AWARE via an exact pot replay —
    // a pot-sized turn barrel narrows far more than a min-bet. Per-street the
    // strongest sizing signal wins.
    const streetWeight = new Map<string, number>();
    // V40: the newest aggressive street's shape - bet/pot fraction and
    // whether it was a raise - for the Omaha sampler tier.
    let lastAggrStage: string | null = null;
    let lastAggrFrac = 0;
    let lastAggrRaised = false;
    // Live controller history omits forced posts; persisted public history
    // includes explicit blind/ante records. Prefer captured public nodes when
    // present, otherwise replay call/post deltas and wager street totals;
    // never double-count forced money.
    const forced = history.some((a) =>
      ['sb', 'bb', 'blind', 'ante', 'straddle', 'post', 'kill_blind'].includes(a.action as string)
    );
    const initial =
      !forced &&
      initialPublicMoney &&
      Number.isFinite(initialPublicMoney.pot) &&
      initialPublicMoney.pot >= 0 &&
      initialPublicMoney.streetBets.every(
        ([id, amount]) => typeof id === 'string' && Number.isFinite(amount) && amount >= 0
      )
        ? initialPublicMoney
        : undefined;
    let pot = forced ? 0 : (initial?.pot ?? (bigBlind > 0 ? bigBlind * 1.5 : 3));
    let curStreet: string = 'preflop';
    let newestStreetBigBet = false;
    // Receipt only (#8563): a capped all-in call of 20bb or more on the
    // newest street, which the range read refuses to count as a big bet.
    let newestStreetCappedAllIn = false;
    let streetBets = new Map<string, number>(initial?.streetBets);
    let price = Math.max(bigBlind > 0 ? bigBlind : 0, ...streetBets.values());
    const userBySeat = new Map(history.map((entry) => [entry.seat, entry.userId]));
    for (const a of history) {
      if (a.stage === 'preflop') sawPreflop = true;
      if (a.stage !== curStreet) {
        curStreet = a.stage;
        newestStreetBigBet = false;
        newestStreetCappedAllIn = false;
        streetBets = new Map();
        price = 0;
      }
      const node = a.publicNode;
      if (node?.status === 'captured' && node.street === a.stage) {
        pot = node.pot;
        price = node.currentBet;
        for (const [seat, , bet] of node.seats) {
          const uid = userBySeat.get(seat);
          if (uid) streetBets.set(uid, bet);
        }
      }
      const kind = a.action as string;
      const forcedPost = ['sb', 'bb', 'blind', 'ante', 'straddle', 'post', 'kill_blind'].includes(
        kind
      );
      const anyChips = forcedPost || ['bet', 'raise', 'call', 'all_in'].includes(kind);
      const prevBet = streetBets.get(a.userId) || 0;
      if (anyChips && (!Number.isFinite(a.amount) || a.amount < 0)) return null;
      // Controller calls/posts are paid deltas; bets, raises and all-ins are
      // absolute street totals (including chips this actor already paid).
      const targetWager = ['bet', 'raise', 'all_in'].includes(kind);
      const increment = anyChips ? (targetWager ? a.amount - prevBet : a.amount) : 0;
      if (increment < -1e-8) return null;
      const total = prevBet + increment;
      const isAggr =
        kind === 'bet' || kind === 'raise' || (kind === 'all_in' && total > price + 1e-8);
      // Dead forced posts contribute to pot but never raise the live price.
      const dead = kind === 'ante' || (a as ActionRecord & { dead?: boolean }).dead === true;
      const priceBefore = price;
      const liveTotal = dead ? prevBet : total;
      price = Math.max(price, liveTotal);
      if (forcedPost) {
        pot += increment;
        if (!dead) streetBets.set(a.userId, liveTotal);
        continue;
      }

      // Reuse the controller/public-node wager replay: an all-in call is
      // not a bet, while a short all-in raise still is aggression. Keep the
      // existing 20bb street-total threshold and newest-street scope.
      if (a.userId === userId && isAggr && a.amount >= 20 * (bigBlind > 0 ? bigBlind : 1)) {
        newestStreetBigBet = true;
      } else if (
        a.userId === userId &&
        kind === 'all_in' &&
        a.amount >= 20 * (bigBlind > 0 ? bigBlind : 1)
      ) {
        newestStreetCappedAllIn = true;
      }

      if (a.stage !== 'preflop') {
        if (a.userId === userId) {
          if (a.action === 'fold') return null;
          actedPostflop = true;
          // V28 AUDIT FIX: this used to add on ANY action, including CALL —
          // and readOut.checked below counts "acted with no aggression
          // weight" as a checked street. A player who CALLED two barrels —
          // the strongest passive range in poker — read as checked=2, and
          // the sampler then discarded their trips-or-better at 79%. Hero's
          // equity against a two-street caller was inflated by exactly the
          // top of their range, driving thin value and river bluffs into a
          // range that is calling. A CHECK is capped; a CALL is not.
          if (a.action === 'check') postStagesActed.add(a.stage);
          else if (a.action === 'call' || anyChips) postStagesActed.delete(a.stage);
          if (isAggr) {
            const potBefore = Math.max(bigBlind || 1, pot);
            const frac = increment / potBefore;
            if (a.stage !== lastAggrStage) {
              lastAggrStage = a.stage;
              lastAggrFrac = frac;
              lastAggrRaised = a.action === 'raise' || (a.action === 'all_in' && priceBefore > 0);
            } else {
              lastAggrFrac = Math.max(lastAggrFrac, frac);
              lastAggrRaised = true;
            }
            // Size class -> narrowing weight. RETUNED (duplicate-deal
            // ablation): absolute size is a FALSE signal against texture-led
            // sizers — good players (and this engine) size UP on wet boards
            // with their whole range, so "big = strong" misreads a wet-board
            // semi-bluff as value and a dry-board value bet as weak. The real
            // signal is the DEVIATION from the texture-expected size: bigger
            // than the board warrants leans value; smaller leans weak.
            // Overbets stay polarized (nuts + bluffs) and narrow least.
            let w = 0.07;
            if (sizedReads) {
              const prefix =
                board && board.length >= 3
                  ? a.stage === 'flop'
                    ? board.slice(0, 3)
                    : a.stage === 'turn'
                      ? board.slice(0, 4)
                      : board.slice(0, 5)
                  : null;
              const expected = prefix ? 0.34 + 0.38 * this.texture(prefix).wetness : 0.55;
              const dev = frac - expected;
              if (frac > 1.3) w = 0.065;
              else if (dev > 0.35) w = 0.085;
              else if (dev < -0.2) w = 0.055;
            }
            streetWeight.set(a.stage, Math.max(streetWeight.get(a.stage) || 0, w));
          }
        }
        if (anyChips) {
          pot += increment;
          streetBets.set(a.userId, prevBet + increment);
        }
        continue;
      }
      if (anyChips) {
        pot += increment;
        streetBets.set(a.userId, prevBet + increment);
      }
      if (a.userId === userId) {
        if (isAggr) {
          // V28 AUDIT FIX: there was no 4-bet tier — any raise with a raise
          // in front read as 'threebet' [0.62, 1.0], the top ~11%. Real
          // 4-bet ranges are the top 2-3%, and this priced hero's hand
          // against a range four times too wide in the BIGGEST preflop pots
          // on the site. raisesBefore >= 2 is a 4-bet (or worse).
          line = raisesBefore >= 2 ? 'fourbet' : raisesBefore >= 1 ? 'threebet' : 'open';
        } else if (a.action === 'call') {
          // Only upgrade a limp to call-of-raise; never downgrade a raise line
          if (line === 'none' || line === 'limp' || line === 'check') {
            line = raisesBefore >= 1 ? 'call' : 'limp';
          }
        } else if (a.action === 'check' && line === 'none') {
          line = 'check';
        } else if (a.action === 'fold') {
          return null; // folded players are not sampled anyway
        }
      }
      if (isAggr) raisesBefore++;
    }
    void bigBlind;

    // V36: no preflop street (a bomb pot) and this player has acted postflop
    // — a random starting hand, narrowed by what they did with it.
    const anteOnly = !sawPreflop && actedPostflop;
    if (line === 'none' && !anteOnly) return null;

    let lo: number;
    let hi: number;
    if (line === 'none') {
      lo = 0;
      hi = 1;
    } else
      switch (line) {
        case 'limp':
          lo = 0.15;
          hi = 0.72; // speculative + traps; excludes pure junk & most premiums
          break;
        case 'call':
          lo = 0.3;
          hi = 0.86; // calling a raise: playables, minus junk, minus most 4-bet hands
          break;
        case 'open':
          lo = 0.4;
          hi = 1.0;
          break;
        case 'threebet':
          lo = 0.62;
          hi = 1.0;
          break;
        case 'fourbet':
          // V28: the 4-bet/5-bet tier — premiums plus the occasional bluff.
          lo = 0.86;
          hi = 1.0;
          break;
        case 'check':
        default:
          lo = 0.0;
          hi = 0.8; // BB free check: capped range
          break;
      }

    // Adjust by observed tendencies (confidence-weighted).
    // In Omaha with scopedShrink enabled, separate PLO4 / PLO5 / PLO6 / PLO8
    // baseline VPIP and RFI envelopes via decisionExploitCounters + exploitEnvelopeFor
    // so PLO6's natural ~60% VPIP never misclassifies normal regulars as loose callers.
    const omahaEnv =
      this.decisionReadOptions.scopedShrink && this.decisionScope?.startsWith('omaha:')
        ? exploitEnvelopeFor(this.decisionScope, this.decisionVariant)
        : null;
    const omahaExact = omahaEnv ? this.decisionExploitCounters(userId) : undefined;
    const s = this.readStats(userId);
    if (omahaEnv && omahaExact && omahaExact.hands >= 8) {
      const conf = Math.min(1, omahaExact.hands / 25);
      const rfiOpp = Math.max(1, Number(omahaExact.rfiOpp ?? omahaExact.hands));
      const pfrRate = Number(omahaExact.rfi ?? 0) / rfiOpp;
      if (line === 'open' || line === 'threebet' || line === 'fourbet') {
        if (pfrRate < Math.max(0.08, omahaEnv.rfi.mean - 0.12)) lo += 0.12 * conf;
        else if (pfrRate > Math.min(0.65, omahaEnv.rfi.mean + 0.14)) lo -= 0.1 * conf;
      }
      const vpipRate = Number(omahaExact.vpip ?? 0) / omahaExact.hands;
      if (line === 'limp' || line === 'call') {
        if (vpipRate > Math.min(0.82, omahaEnv.vpip.mean + 0.15)) lo -= 0.08 * conf;
        else if (vpipRate < Math.max(0.18, omahaEnv.vpip.mean - 0.15)) lo += 0.08 * conf;
      }
    } else if (s && s.hands >= 8) {
      const conf = Math.min(1, s.hands / 25);
      const pfrRate = s.pfr / s.hands;
      const looseVpipFloor = omahaEnv ? Math.min(0.82, omahaEnv.vpip.mean + 0.15) : 0.5;
      const tightVpipCeil = omahaEnv ? Math.max(0.18, omahaEnv.vpip.mean - 0.15) : 0.18;
      if (line === 'open' || line === 'threebet' || line === 'fourbet') {
        if (pfrRate < 0.1)
          lo += 0.12 * conf; // a nit raised: tighten the read
        else if (pfrRate > (omahaEnv ? Math.min(0.6, omahaEnv.rfi.mean + 0.14) : 0.3))
          lo -= 0.1 * conf; // a maniac raised: widen it
      }
      const vpipRate = s.vpip / s.hands;
      if (line === 'limp' || line === 'call') {
        if (vpipRate > looseVpipFloor)
          lo -= 0.08 * conf; // loose caller: more junk in range
        else if (vpipRate < tightVpipCeil) lo += 0.08 * conf; // tight caller: real hand
      }
    }

    // 2026-10-16 OPPONENT EXPLOIT: a credibly non-horse opener's range is
    // the share of hands THEY raise, not the seat's. A 100% raiser's open is
    // nearly any hand; a nit's is the top of the deck. Null read = no change.
    const read = this.opponentRead(userId);
    if (read) {
      // 2026-10-22 MANIAC PRESSURE: a seat that shoves or pots every hand
      // re-raises with the same range it opens with. Its 3-bet is read at its
      // whole raising width (a jammer seldom faces a raise, so its 3-bet
      // statistic alone never engages), and its 4-bet keeps that width
      // instead of halving it (reRaiseLineWidth).
      const maniac = maniacRaiseWidth(read);
      const width =
        line === 'open'
          ? openerRangeWidth(read)
          : line === 'threebet'
            ? (maniac ?? reRaiseWidth(read))
            : line === 'fourbet'
              ? maniac !== null
                ? reRaiseLineWidth(maniac, 3)
                : (() => {
                    const w = reRaiseWidth(read);
                    return w === null ? null : w * 0.5;
                  })()
              : line === 'limp' || line === 'call'
                ? looseCallerWidth(read)
                : null;
      // 2026-10-22: a width is a SHARE of hands. The two-card sampler matches
      // a band against hold'em score VALUES (HorseEval placeBandCombo), and
      // the score scale is not a percentile: score 0.19 is the top ~60%, not
      // the top 81%, so `1 - width` read a 100% shover as a top-60% range and
      // priced every call against it far too tight. Hold'em-family bands take
      // the score bar for that share (Short Deck its own combo scale); the
      // Omaha reservoir maps a band through its own percentile CDF, where
      // `1 - width` is already the share.
      if (width !== null)
        lo =
          this.decisionScope === null || this.decisionScope.startsWith('holdem:')
            ? strengthBarForTopShare(width)
            : this.decisionScope.startsWith('sixplus:')
              ? shortDeckStrengthBarForTopShare(width)
              : 1 - width;
    }

    // V5/V7: every postflop street they bet or raised narrows the read
    // upward, weighted by bet size. A flop-and-turn pot-barreller is priced
    // as strong; a pair of min-bets barely moves the read. Capped so even a
    // triple barrel leaves bluffs in the range.
    // 2026-10-16: a credible over-aggressor's barrels say less about their
    // hand; their bets narrow the read by a fraction of the usual weight.
    const narrowing = read ? barrelNarrowingScale(read) : 1;
    if (narrowing !== 1)
      for (const [stage, w] of streetWeight) streetWeight.set(stage, w * narrowing);
    if (streetWeight.size > 0) {
      let total = 0;
      for (const w of streetWeight.values()) total += w;
      lo += Math.min(0.22, total);
      hi = Math.min(1, hi + 0.05); // aggression uncaps the top of the range
    }
    // V12: expose the postflop line shape for board-contact conditioning.
    if (readOut) {
      let total = 0;
      for (const w of streetWeight.values()) total += w;
      readOut.aggrW = Math.min(0.3, total);
      // V40: uncapped street count and newest-street shape.
      readOut.streets = streetWeight.size;
      if (lastAggrStage != null) {
        readOut.lastFrac = lastAggrFrac;
        readOut.raised = lastAggrRaised;
        // V62: which street the newest wager was on, for the river model.
        if (lastAggrStage === 'flop' || lastAggrStage === 'turn' || lastAggrStage === 'river')
          readOut.lastStage = lastAggrStage;
      }
      let checked = 0;
      for (const st of postStagesActed) if (!streetWeight.has(st)) checked++;
      readOut.checked = checked;
      // V16: the newest street's large AGGRESSIVE wager, classified above
      // against its actual price rather than the all_in action label alone.
      if (newestStreetBigBet) readOut.bigBet = true;
      // Receipt (#8563): the big-bet read classified the newest street's
      // wager against its price, or refused a capped all-in call as one.
      if (newestStreetBigBet) noteFire('range_read_big_bet_counted');
      else if (newestStreetCappedAllIn) noteFire('range_read_capped_all_in_not_big_bet');
    }

    lo = Math.max(0, Math.min(0.9, lo));
    hi = Math.max(lo + 0.1, Math.min(1, hi));
    return [lo, hi];
  }

  /**
   * V5: true when the previous street checked through — nobody bet or raised
   * on it. A missed c-bet / checked-through street caps the field's ranges
   * and invites a probe.
   */
  static streetCheckedThrough(
    history: ActionRecord[] | undefined,
    prevStage: 'flop' | 'turn'
  ): boolean {
    if (!history || history.length === 0) return false;
    let sawStreet = false;
    for (const a of history) {
      if (a.stage !== prevStage) continue;
      sawStreet = true;
      if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') return false;
    }
    return sawStreet;
  }

  // ───────────────────────────────────────────────────────────────────────
  // EXPLOIT PROFILE — how to deviate vs this specific player
  // ───────────────────────────────────────────────────────────────────────

  static isLagBully(userId: string): boolean {
    const read = this.opponentRead(userId);
    if (this.decisionScope && !read) return false;
    if (read && read.presumed !== true) {
      if (
        (read.stats.vpip.engaged === 'high' &&
          (read.stats.pfr.engaged === 'high' ||
            read.stats.threeBet.engaged === 'high' ||
            read.stats.betCheckedTo.engaged === 'high' ||
            maniacRaiseWidth(read) !== null)) ||
        isPostflopManiac(read)
      ) {
        return true;
      }
    }
    const s = this.readStats(userId);
    if (s && s.hands >= 20) {
      const vpipRate = s.vpip / s.hands;
      const pfrRate = s.pfr / s.hands;
      const postActs = s.postAggr + s.postPassive;
      const postAf = postActs >= 10 ? s.postAggr / Math.max(1, s.postPassive) : 0;
      const vpipFloor = this.decisionScope?.startsWith('holdem:') ? 0.48 : 0.52;
      if (vpipRate >= vpipFloor && (pfrRate >= 0.28 || postAf >= 2.2)) return true;
    }
    return false;
  }

  /** Active winner-read scope (`${family}:${mode}`) for the decision in flight, or null. */
  static activeWinnerScope(): string | null {
    return this.decisionScope ? `${this.decisionScope.split(':')[0]}:${this.decisionMode}` : null;
  }

  /**
   * Street-specific bully detector ("Bully-Breaker"): identifies high-frequency
   * flop stabbers (e.g. 66% flop stab -> 48% turn barrel) whose aggression
   * drops off on later streets or who check back the turn after stabbing the flop.
   * Uses flop-only checked-to stab counters (`flopStabCounters`) when present
   * and public `history`.
   */
  static streetBullyRead(
    userId: string,
    history?: ActionRecord[]
  ): {
    highFlopStab: boolean;
    stabRate: number;
    turnGiveUp: boolean;
    checkedTurnAfterFlopStab: boolean;
    foldToRaiseRate?: number;
  } {
    const flopRow = this.decisionScope
      ? this.flopStabCounters.get(`${this.decisionScope}|${userId}`)
      : undefined;
    const flopBct =
      flopRow && this.decisionScope
        ? flopStabStatRead(flopRow, this.decisionScope, this.decisionVariant)
        : null;
    const read = this.opponentRead(userId);
    if (this.decisionScope && !read && !flopBct) {
      return {
        highFlopStab: false,
        stabRate: 0,
        turnGiveUp: false,
        checkedTurnAfterFlopStab: false,
      };
    }
    const evidenced = read && read.presumed !== true ? read : null;
    let bct = flopRow !== undefined ? flopBct : (evidenced?.stats.betCheckedTo ?? null);
    if (!bct && flopRow === undefined && this.decisionScope && read) {
      const counters = this.decisionExploitCounters(userId);
      const env = counters
        ? exploitEnvelopeFor(this.decisionScope, this.decisionVariant)
        : undefined;
      if (counters && env && counters.betCheckedToOpp > 0) {
        const pooled = this.stats.get(userId);
        const adjusted = probeAdjustedCounters(counters, pooled?.ctBets, pooled?.ctProbes);
        bct = statRead(adjusted.betCheckedTo, adjusted.betCheckedToOpp, env.betCheckedTo, ['high']);
      }
    }
    const stabRate = bct ? bct.mean : 0;
    const stabFloor = this.decisionScope?.startsWith('holdem:') ? 0.46 : 0.52;
    const highFlopStab = !!(
      bct &&
      (bct.engaged === 'high' || (bct.n >= 8 && bct.mean >= stabFloor))
    );

    let flopBetCheckedTo = false;
    let checkedTurnAfterFlopStab = false;
    if (history && history.length > 0) {
      let flopWagerSeen = false;
      for (const a of history) {
        if (a.stage === 'flop') {
          const aggr = isMindAggression(a);
          if (!flopWagerSeen && a.userId === userId && aggr) {
            flopBetCheckedTo = true;
          }
          if (aggr) flopWagerSeen = true;
        } else if (a.stage === 'turn' && flopBetCheckedTo && a.userId === userId) {
          if (a.action === 'check') checkedTurnAfterFlopStab = true;
          else if (isMindAggression(a)) checkedTurnAfterFlopStab = false;
        }
      }
    }

    const riverLast = this.riverLastToActRead(userId);
    const foldRead = evidenced?.stats.foldToBet ?? null;
    const foldToRaiseRate = foldRead !== null && foldRead.n >= 6 ? foldRead.mean : undefined;
    const canFlagSingleHandGiveUp = this.isLagBully(userId) || highFlopStab || stabRate >= 0.4;
    const turnGiveUp =
      (checkedTurnAfterFlopStab && canFlagSingleHandGiveUp) ||
      (highFlopStab &&
        ((riverLast !== null && stabRate - riverLast.rate >= 0.14) ||
          (foldRead !== null && foldRead.n >= 8 && foldRead.mean >= 0.44)));

    return {
      highFlopStab,
      stabRate,
      turnGiveUp,
      checkedTurnAfterFlopStab,
      ...(foldToRaiseRate !== undefined ? { foldToRaiseRate } : {}),
    };
  }

  static exploit(
    userId: string,
    recencyBlend: boolean = true,
    options: ExploitReadOptions = {}
  ): ExploitProfile {
    // A PROVEN WINNER IS RESPECTED (2026-10-24, HorseWinnerRead): fewer
    // bluffs and no thin value against a disciplined winner; against a high-VPIP
    // LAG bully (e.g. 65/38/68% stab), keep bluff playback and expand thin value.
    return respectWinner(
      this.readExploit(userId, recencyBlend, options),
      userId,
      this.isLagBully(userId),
      this.activeWinnerScope()
    );
  }

  private static readExploit(
    userId: string,
    recencyBlend: boolean,
    options: ExploitReadOptions
  ): ExploitProfile {
    const legacy = this.legacyExploit(userId, recencyBlend, options);
    // 2026-10-16 OPPONENT EXPLOIT: a credible read replaces the lifetime
    // profile on the statistics it covers. The bluff read is POSTFLOP-ONLY
    // fold-to-bet (the lifetime fold rate mixes preflop folds and bluffed a
    // tight-preflop maniac more). Null read = the legacy profile, unchanged.
    const read = this.opponentRead(userId);
    if (!read) return legacy;
    const bluff = postflopBluffMod(read);
    const thin = readValueThinMod(read);
    const shift = callDownRespectShift(read);
    if (bluff === null && thin === null && shift === 0) return legacy;
    return {
      bluffMod: bluff ?? legacy.bluffMod,
      callDownMod: shift !== 0 ? 1 - shift : legacy.callDownMod,
      valueThinMod: thin ?? legacy.valueThinMod,
    };
  }

  private static legacyExploit(
    userId: string,
    recencyBlend: boolean,
    options: ExploitReadOptions = {}
  ): ExploitProfile {
    const s = this.readStats(userId);
    if (!s || s.hands < 10) return NEUTRAL_EXPLOIT;
    // V45: the recency window is pooled (gears are not per-scope).
    const rec = this.stats.get(userId) ?? s;

    const conf = Math.min(1, s.hands / 30);
    const blend = (target: number) => 1 + (target - 1) * conf;

    let bluffMod = 1;
    let callDownMod = 1;
    let valueThinMod = 1;

    // Fold-vs-aggression: bluff the folders, hammer value into the stations.
    // V7 COUNTER-ADAPTATION: blend the lifetime rate with the exponentially
    // decayed recent window. An opponent who ADAPTS — starts calling down the
    // horse that was bluffing them — shifts the blended rate within ~20 hands
    // instead of hundreds, so the exploit backs off before it becomes a leak.
    // RETUNED (duplicate-deal ablation): the recent window only enters the
    // blend when it is STATISTICALLY INCOMPATIBLE with the lifetime rate
    // (change-point gate, ~2 standard errors). Against a stable opponent the
    // gate almost never opens, so the exploit keeps the low-variance lifetime
    // estimate; when an opponent genuinely changes gears the discrepancy is
    // large and persistent, the gate opens, and the blend adapts within ~20
    // hands. Unconditional blending paid a measurable noise tax for a benefit
    // that only exists when opponents actually adapt.
    const foldRate = this.foldVsAggressionRate(userId, recencyBlend);
    if (foldRate !== null) {
      if (foldRate > 0.62) {
        noteFire('legacy_fold_rate_branch_seen');
        if (options.styleFoldRatePreRepair === true && this.foldToBetPreRepairExcluded(userId)) {
          noteFire('style_pre_repair_fold_rate_discounted_seen');
        } else {
          if (
            options.styleFoldRatePreRepairShadow === true &&
            this.foldToBetPreRepairExcluded(userId)
          )
            noteStyleShadowEngaged('styleFoldRatePreRepair', 1);
          bluffMod = blend(1.45);
          // V28 AUDIT FIX: valueThinMod was only ever RAISED (stations), so the
          // documented "a nit calls only what a smaller bet asks" half of V18
          // exploit sizing was dead — the consumer multiplies by
          // (valueThinMod - 1) and the term could never be negative. A folder
          // now thins the value bar downward too.
          valueThinMod = blend(0.85);
        }
      } else if (foldRate < 0.35) {
        bluffMod = blend(0.55);
        valueThinMod = blend(1.25);
      }
    }

    // Aggression factor: maniacs get called down lighter; passives get respect.
    // Same change-point gate as the fold-rate blend.
    // POSTFLOP-ONLY AF when there is enough of it (2026-08-31). Measured on
    // 58 live players with real samples: the all-streets ratio misclassified
    // TEN of them across a decision threshold — 2 genuine maniacs read as
    // normal, 8 more mis-bucketed — and the population average moved 1.87 ->
    // 1.37 when preflop calls came out. This ratio decides how much respect
    // an opponent's BETS get, so it must be measured where the bets are.
    // Falls back to the all-streets ratio until the postflop sample exists,
    // so a fresh opponent is never read from three hands of noise.
    const hasPostflopSample = s.postPassive + s.postAggr >= 10;
    const afLifetime = hasPostflopSample
      ? s.postAggr / Math.max(1, s.postPassive)
      : s.aggr / Math.max(1, s.passive);
    let af = afLifetime;
    const rN = rec.rAggr + rec.rPassive;
    // Recent counters include preflop actions. Blend them only with the
    // all-street fallback; otherwise preflop style can invert a postflop read.
    if (recencyBlend && !hasPostflopSample && rN >= 8) {
      const recentAf = rec.rAggr / Math.max(1, rec.rPassive);
      if (Math.abs(recentAf - afLifetime) > Math.max(0.6, 0.5 * afLifetime)) {
        const wa = Math.min(0.5, rN / 40);
        af = (1 - wa) * afLifetime + wa * recentAf;
      }
    }
    if (s.aggr + s.passive >= 12) {
      if (af > 2.5) {
        noteFire('legacy_aggression_factor_branch_seen');
        // V83 (2026-11-06): the ratio alone is not a maniac. Horse-vs-horse
        // play sits at AF ~2.43, just under this line, so a small change in
        // how often a player is checked to pushed a value-heavy bettor over
        // it, and the whole bluff-catching stack switched on (callDownMod
        // above 1 also disables every one-pair fold and shade layer: V61,
        // V63, V65, V66, V79, V80). R7's certification league lost -5.54
        // bb/100 that way: its checks lifted the opponent from 2.43 to 2.66
        // while 85% of that opponent's big river bets showed down strong.
        // A bettor whose big bets measurably show down as value keeps
        // neutral respect.
        if (options.aggressionNeedsBluffs !== false && aggressionShownAsValue(s)) {
          noteFire('v83_aggression_shown_as_value');
        } else if (options.styleValueBettor === true && isValueBettor(this.styleRead(userId))) {
          // STYLE READ #2: a credibly low-raise-frequency or high
          // shown-strength bettor is not a maniac on the ratio alone.
          noteFire('style_value_bettor_not_maniac_seen');
        } else {
          if (options.styleValueBettorShadow === true) {
            const vbStyle = this.styleRead(userId);
            if (isValueBettor(vbStyle))
              noteStyleShadowEngaged('styleValueBettorNotManiac', vbStyle.confidenceCap);
          }
          callDownMod = blend(1.2);
        }
      } else if (af < 0.7) callDownMod = blend(0.85);
    }

    return { bluffMod, callDownMod, valueThinMod };
  }

  // ───────────────────────────────────────────────────────────────────────
  // V7 BARREL PLANS — per-hand multi-street bluff intent
  // ───────────────────────────────────────────────────────────────────────

  /**
   * When a horse fires a bluff/semi-bluff bet, it decides THEN whether this is
   * a one-and-done stab or a planned multi-street line. The plan is stored per
   * (hand, player) so the next street's decision tells a coherent story
   * instead of re-rolling the dice.
   */
  private static plans = new Map<string, boolean>();
  private static readonly MAX_PLANS = 8000;

  static notePlan(handKey: string | null, userId: string, barrelIntent: boolean): void {
    if (!handKey) return;
    if (this.decisionEffectSink) {
      this.decisionEffectSink.push({ type: 'plan', handKey, userId, barrelIntent });
      return;
    }
    // V28: evict the oldest quarter, never .clear() — see noteRaisePlan.
    if (this.plans.size > this.MAX_PLANS) evictOldest(this.plans, this.MAX_PLANS);
    this.plans.set(`${handKey}|${userId}`, barrelIntent);
  }

  static getPlan(handKey: string | null, userId: string): boolean | undefined {
    if (!handKey) return undefined;
    return this.plans.get(`${handKey}|${userId}`);
  }

  /**
   * ═══ V39 STREET OUTLOOK (2026-09-03) ═══ what the bet was thinking about
   * the next card: the cards that improve hero, the cards that scare hero.
   * Written beside the barrel plan when a bluff / semi-bluff fires; read on
   * the next street against the card that actually arrived. Same bounded
   * map discipline as every plan here.
   */
  private static outlooks = new Map<string, { good: Set<string>; scare: Set<string> }>();

  static noteOutlook(
    handKey: string | null,
    userId: string,
    street: string,
    good: string[],
    scare: string[]
  ): void {
    if (!handKey) return;
    if (this.decisionEffectSink) {
      this.decisionEffectSink.push({
        type: 'outlook',
        handKey,
        userId,
        street,
        good: [...good],
        scare: [...scare],
      });
      return;
    }
    if (this.outlooks.size > this.MAX_PLANS) evictOldest(this.outlooks, this.MAX_PLANS);
    this.outlooks.set(`${handKey}|${userId}|${street}`, {
      good: new Set(good),
      scare: new Set(scare),
    });
  }

  /** How the bet on `street` had classified `cardKey` before it came. */
  static outlookOf(
    handKey: string | null,
    userId: string,
    street: string,
    cardKey: string
  ): 'good' | 'scare' | 'blank' | undefined {
    if (!handKey) return undefined;
    const o = this.outlooks.get(`${handKey}|${userId}|${street}`);
    if (!o) return undefined;
    if (o.good.has(cardKey)) return 'good';
    if (o.scare.has(cardKey)) return 'scare';
    return 'blank';
  }

  /** The full outlook the bet on `street` recorded (copies), for the
   *  multi-street plan evaluation; undefined when none was recorded. */
  static outlookCards(
    handKey: string | null,
    userId: string,
    street: string
  ): { good: string[]; scare: string[] } | undefined {
    if (!handKey) return undefined;
    const o = this.outlooks.get(`${handKey}|${userId}|${street}`);
    if (!o) return undefined;
    return { good: [...o.good], scare: [...o.scare] };
  }

  /**
   * ═══ ITEMS 21 AND 23 PLAN FINGERPRINT (2026-11-05) ═══
   * Beside the barrel plan and its outlook, the bet records the next-street
   * state it expects: which players are still contending (hero included),
   * and the effective stack and pot once the wager is matched once. The next
   * street compares what actually arrived against it
   * (evaluateMultiStreetBarrelContinuation): a contender the plan never
   * expected, or a stack-to-pot exposure far from the planned one, withdraws
   * the plan before it fires. Written through the effect sink like every
   * other intent, so it lands only for the accepted wager. Bounded like the
   * other plan maps.
   */
  private static planFingerprints = new Map<string, ContinuationContenderFingerprint>();

  static notePlanFingerprint(
    handKey: string | null,
    userId: string,
    street: string,
    expected: {
      contenderIds: readonly string[];
      effectiveStackChips: number;
      potChips: number;
      bigBlindChips: number;
    }
  ): void {
    if (!handKey) return;
    if (this.decisionEffectSink) {
      this.decisionEffectSink.push({
        type: 'plan_fingerprint',
        handKey,
        userId,
        street,
        contenderIds: [...expected.contenderIds],
        effectiveStackChips: expected.effectiveStackChips,
        potChips: expected.potChips,
        bigBlindChips: expected.bigBlindChips,
      });
      return;
    }
    if (this.planFingerprints.size > this.MAX_PLANS)
      evictOldest(this.planFingerprints, this.MAX_PLANS);
    this.planFingerprints.set(
      `${handKey}|${userId}|${street}`,
      computeContinuationContenderFingerprint(
        expected.contenderIds,
        expected.effectiveStackChips,
        expected.potChips,
        expected.bigBlindChips
      )
    );
  }

  /** The fingerprint the wager on `street` recorded, or undefined. */
  static planFingerprintOf(
    handKey: string | null,
    userId: string,
    street: string
  ): ContinuationContenderFingerprint | undefined {
    if (!handKey) return undefined;
    return this.planFingerprints.get(`${handKey}|${userId}|${street}`);
  }

  /**
   * ═══ V23 RAISE-RESPONSE PLANS (2026-08-28) ═══
   * When a horse bets or raises postflop, it decides THEN what a raise back
   * would mean: commit (range top), call once (medium/draws — see a card,
   * never escalate), or fold (this was a stab). Stored per (hand, player,
   * street) so the answer to a check-raise is the one the bet already gave —
   * the big_fold_river/bet_fold_line reviews are full of lines where the bet
   * and the response to the raise were decided by two different dice rolls.
   */
  private static raisePlans = new Map<string, RaiseResponsePlan>();

  static noteRaisePlan(
    handKey: string | null,
    userId: string,
    street: string,
    plan: RaiseResponsePlan
  ): void {
    if (!handKey) return;
    if (this.decisionEffectSink) {
      this.decisionEffectSink.push({ type: 'raise_plan', handKey, userId, street, plan });
      return;
    }
    // V28 AUDIT FIX: .clear() wiped EVERY hand in flight when the cap
    // tripped — the exact wholesale-clear failure mode the V12.3 doctrine at
    // the top of this file forbids for every other container. A cleared plan
    // meant the answer to a check-raise reverted to an independent dice roll:
    // the bet_fold_line reviews this feature exists to eliminate. Evict the
    // oldest quarter instead, like everything else here.
    if (this.raisePlans.size > this.MAX_PLANS) {
      evictOldest(this.raisePlans, this.MAX_PLANS);
    }
    this.raisePlans.set(`${handKey}|${userId}|${street}`, plan);
  }

  static getRaisePlan(
    handKey: string | null,
    userId: string,
    street: string
  ): RaiseResponsePlan | undefined {
    if (!handKey) return undefined;
    return this.raisePlans.get(`${handKey}|${userId}|${street}`);
  }

  /** V23: fold-to-river-bet frequency (0..1), or null below an
   *  8-opportunity sample. Memory-only — see the OpponentStats note. */
  /** Conditional public frequency; unknown stays unknown. A high rate alone
   * is not proof of a bluff and never forces a call. The consumer must price
   * the acting holding against a qualified public-range model. */
  static riverLastToActRead(
    id: string
  ): { opportunities: number; bets: number; rate: number; lower99: number } | null {
    const s = this.readStats(id),
      n = s?.riverLastToActOpps ?? 0,
      bets = s?.riverLastToActBets ?? 0;
    if (!Number.isSafeInteger(n) || n < 8 || !Number.isSafeInteger(bets) || bets < 0 || bets > n)
      return null;
    const rate = bets / n,
      z = 2.3263478740408408,
      z2 = z * z;
    const lower99 =
      (rate + z2 / (2 * n) - z * Math.sqrt((rate * (1 - rate)) / n + z2 / (4 * n * n))) /
      (1 + z2 / n);
    return { opportunities: n, bets, rate, lower99: Math.max(0, lower99) };
  }

  /** Same-size check-raise responses, never ordinary river bet responses. */
  static riverTripleCheckRaiseRead(
    id: string
  ): { opportunities: number; folds: number; lower99: number } | null {
    const s = this.readStats(id),
      n = s?.riverTripleCheckRaiseOpps ?? 0,
      folds = s?.riverTripleCheckRaiseFolds ?? 0;
    if (!Number.isSafeInteger(n) || n < 8 || !Number.isSafeInteger(folds) || folds < 0 || folds > n)
      return null;
    const p = folds / n,
      z = 2.3263478740408408,
      z2 = z * z;
    return {
      opportunities: n,
      folds,
      lower99: Math.max(
        0,
        (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
      ),
    };
  }

  static multiwayRiverPressureRead(
    id: string,
    context: string
  ): { opportunities: number; bets: number; lower99: number } | null {
    const row = this.readStats(id)?.riverHu?.entries.find((e) => e[0] === context);
    if (
      !row ||
      row[3] < 8 ||
      !Number.isSafeInteger(row[3]) ||
      !Number.isSafeInteger(row[4]) ||
      row[4] < 0 ||
      row[4] > row[3]
    )
      return null;
    const n = row[3],
      bets = row[4],
      p = bets / n,
      z = 2.3263478740408408,
      z2 = z * z;
    return {
      opportunities: n,
      bets,
      lower99: Math.max(
        0,
        (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
      ),
    };
  }

  static multiwayRiverRead(
    id: string,
    context: string
  ): { opportunities: number; folds: number; lower99: number } | null {
    const row = this.readStats(id)?.riverHu?.entries.find((e) => e[0] === context);
    if (
      !row ||
      row[1] < 8 ||
      !Number.isSafeInteger(row[1]) ||
      !Number.isSafeInteger(row[2]) ||
      row[2] < 0 ||
      row[2] > row[1]
    )
      return null;
    const [, n, folds] = row,
      p = folds / n,
      z = 2.3263478740408408,
      z2 = z * z;
    return {
      opportunities: n,
      folds,
      lower99: Math.max(
        0,
        (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
      ),
    };
  }

  static riverFoldRate(id: string): number | null {
    const s = this.readStats(id);
    if (!s || s.riverBetOpps < 8) return null;
    return this.shrunkResponseRate('riverFold', s.riverBetFolds, s.riverBetOpps);
  }

  /**
   * Read calibration: a gated raw response rate, shrunk toward the decision
   * family's population rate when shrinkResponseReads is on. Off, or outside
   * a decision scope, it is the raw rate exactly.
   */
  private static shrunkResponseRate(
    read: keyof typeof RESPONSE_READ_PRIOR,
    successes: number,
    opportunities: number
  ): number {
    const raw = successes / opportunities;
    if (!this.decisionReadOptions.shrinkResponseReads || !this.decisionScope) return raw;
    const family = this.decisionScope.split(':')[0] as 'holdem' | 'omaha' | 'sixplus';
    const prior = RESPONSE_READ_PRIOR[read][family];
    if (prior === undefined) return raw;
    const m = RESPONSE_READ_PRIOR_STRENGTH;
    return (successes + m * prior) / (opportunities + m);
  }

  /** The exploit counters a decision reads for this opponent, as opponentRead
   *  selects them, without its telemetry receipts. */
  private static decisionExploitCounters(userId: string): ExploitCounters | undefined {
    const scope = this.decisionScope;
    if (!scope) return undefined;
    const variant = memoryVariant(this.decisionVariant);
    const size = scope.split(':')[1] as MemorySize;
    const durable = variant ? this.blendDurableRead(userId, variant, size, false) : undefined;
    return (
      durable ??
      (this.durableOpponentMemory && variant
        ? undefined
        : this.exploitCounters.get(`${scope}|${userId}`))
    );
  }

  /** The fold curve this decision's game was measured on, or null. */
  static breakEvenFamily(): BreakEvenFamily | null {
    const scope = this.decisionScope;
    const v = (this.decisionVariant ?? '').toLowerCase();
    if (!scope || !BREAK_EVEN_VARIANTS.has(v)) return null;
    const fam = scope.split(':')[0];
    return fam === 'holdem' || fam === 'omaha' ? fam : null;
  }

  /**
   * Break-even bluffing: the postflop bluff multiplier at the reference size
   * against this opponent, with the fold read it came from. A credible
   * river-call station (river calls are not in the fold read) and a proven
   * winner still take bluffs down, as they do for bluffMod. Null when the
   * decision has no measured fold curve, and null for an opponent whose
   * postflop bluff read is not engaged (postflopBluffMod null: a stranger, a
   * horse-like regular, or any opponent while reads are off), so the existing
   * price answers for them exactly as with the flag off.
   */
  static breakEvenBluffOf(userId: string): { mod: number; foldShift: number } | null {
    const family = this.breakEvenFamily();
    if (!family) return null;
    const read = this.opponentRead(userId);
    const layer = postflopBluffMod(read);
    if (layer === null || !read) return null;
    const foldShift = this.postflopFoldShift(userId);
    if (foldShift === null) return null;
    let mod = breakEvenBluffMod(foldShift, family, BREAK_EVEN_REFERENCE_SIZE);
    if (read.stats.riverCall.engaged === 'high') mod = Math.min(mod, layer);
    if (isProvenWinner(userId, this.activeWinnerScope()) && !this.isLagBully(userId))
      mod *= WINNER_BLUFF_MOD;
    return { mod, foldShift };
  }

  /**
   * Break-even bluffing: this opponent's postflop fold-to-bet read in the
   * decision context, shrunk toward the game's population mean with
   * BREAK_EVEN_PRIOR_STRENGTH pseudo-observations, minus that mean. Zero for
   * an opponent with no postflop sample (the population). Null when the
   * decision has no measured fold curve or no population cell.
   */
  static postflopFoldShift(userId: string): number | null {
    const family = this.breakEvenFamily();
    if (!family || !this.decisionScope) return null;
    const env = exploitEnvelopeFor(this.decisionScope, this.decisionVariant);
    if (!env) return null;
    const pop = env.foldToBet.mean;
    const c = this.decisionExploitCounters(userId);
    const n = Math.max(0, Number(c?.foldToBetOpp ?? 0));
    const k = Math.max(0, Math.min(n, Number(c?.foldToBet ?? 0)));
    if (!Number.isFinite(n) || !Number.isFinite(k)) return 0;
    const m = BREAK_EVEN_PRIOR_STRENGTH;
    return (k + m * pop) / (n + m) - pop;
  }

  /**
   * The fold multiplier the EV bet engine (HorseEvEngine.mdfFold) prices this
   * opponent's response with. Default: the exploit bluff multiplier, exactly
   * as before. With omahaEvFoldModel on in PLO4 / PLO5 / PLO6 it is the
   * Omaha EV fold model (OMAHA_EV_FOLD_MODEL) at cash tables: the game's
   * measured fold share over MDF, scaled by this opponent's postflop
   * fold-to-bet read shrunk toward the game's population. A proven winner
   * keeps its bluff respect.
   */
  static evFoldMul(userId: string, recencyBlend: boolean = true): number {
    const model = this.omahaEvFoldMulOf(userId);
    if (model !== null) return model;
    return this.exploit(userId, recencyBlend).bluffMod;
  }

  /** The Omaha EV fold model's multiplier, or null when the option is off,
   *  outside a decision, at a tournament table, or in a game it was not
   *  measured on. */
  static omahaEvFoldMulOf(userId: string): number | null {
    if (this.decisionReadOptions.omahaEvFoldModel !== true || !this.decisionScope) return null;
    // Cash only: tournament Omaha players fold about MDF (see the model note).
    if (this.decisionMode !== 'cash') return null;
    const v = (this.decisionVariant ?? '').toLowerCase() as OmahaEvFoldVariant;
    const cell = OMAHA_EV_FOLD_MODEL[v];
    if (!cell) return null;
    const c = this.decisionExploitCounters(userId);
    const n = Math.max(0, Number(c?.foldToBetOpp ?? 0));
    const k = Math.max(0, Math.min(n, Number(c?.foldToBet ?? 0)));
    const m = OMAHA_EV_FOLD_PRIOR_STRENGTH;
    const fold =
      Number.isFinite(n) && Number.isFinite(k)
        ? (k + m * cell.population) / (n + m)
        : cell.population;
    let mul = (cell.foldOverMdf * fold) / cell.population;
    if (isProvenWinner(userId, this.activeWinnerScope()) && !this.isLagBully(userId))
      mul *= WINNER_BLUFF_MOD;
    // Receipt: live proof the model priced an opponent (one count per
    // opponent pricing, not per decision). Counting never decides.
    noteFire('omaha_ev_fold_model_priced');
    return mul;
  }

  /**
   * The fold-vs-aggression rate legacyExploit prices bluffs with, or null
   * when it has no read (the exploit stays neutral on this statistic).
   * Default: lifetime folds / faced aggression over every street, with the
   * V7 change-point recency blend. postflopFoldRate: the postflop
   * fold-to-bet posterior of the decision context (see DecisionReadOptions).
   */
  static foldVsAggressionRate(userId: string, recencyBlend: boolean = true): number | null {
    if (this.decisionReadOptions.postflopFoldRate && this.decisionScope) {
      const c = this.decisionExploitCounters(userId);
      const n = Number(c?.foldToBetOpp ?? 0);
      if (!c || !(n >= FOLD_READ_MIN_OPPS)) return null;
      const k = Number(c.foldToBet ?? 0);
      const env = exploitEnvelopeFor(this.decisionScope, this.decisionVariant);
      return env ? statRead(k, n, env.foldToBet).mean : Math.max(0, Math.min(1, k / n));
    }
    const s = this.readStats(userId);
    if (!s || s.hands < 10 || s.facedAggr < 8) return null;
    // V45: the recency window is pooled (gears are not per-scope).
    const rec = this.stats.get(userId) ?? s;
    const lifetime = s.folds / s.facedAggr;
    if (recencyBlend && rec.rFacedAggr >= 6) {
      const recent = rec.rFolds / rec.rFacedAggr;
      const se = Math.sqrt(Math.max(0.04, lifetime * (1 - lifetime)) / rec.rFacedAggr);
      if (Math.abs(recent - lifetime) > 2 * se) {
        const wr = Math.min(0.5, rec.rFacedAggr / 32);
        return (1 - wr) * lifetime + wr * recent;
      }
    }
    return lifetime;
  }

  // ───────────────────────────────────────────────────────────────────────
  // BOARD TEXTURE
  // ───────────────────────────────────────────────────────────────────────

  static texture(board: Card[]): BoardTexture {
    if (!board || board.length < 3) {
      return { wetness: 0.3, monotone: false, twoTone: false, paired: false, straighty: false };
    }

    const suitCount = new Map<string, number>();
    const rankCount = new Map<number, number>();
    const ranks: number[] = [];
    for (const c of board) {
      suitCount.set(c.suit, (suitCount.get(c.suit) || 0) + 1);
      const r = RANK_VALUES[c.rank];
      rankCount.set(r, (rankCount.get(r) || 0) + 1);
      ranks.push(r);
    }
    const maxSuit = Math.max(...suitCount.values());
    const monotone = maxSuit >= 3;
    const twoTone = maxSuit === 2;
    const paired = [...rankCount.values()].some((c) => c >= 2);

    // Straight coordination: 3+ distinct ranks inside any 5-rank window
    const unique = [...new Set(ranks)].sort((a, b) => a - b);
    let straighty = false;
    for (let i = 0; i < unique.length; i++) {
      let inWindow = 1;
      for (let j = i + 1; j < unique.length; j++) {
        if (unique[j] - unique[i] <= 4) inWindow++;
      }
      if (inWindow >= 3) {
        straighty = true;
        break;
      }
    }
    // Ace-low wheel window
    if (!straighty && unique.includes(14)) {
      const lows = unique.filter((r) => r <= 5).length;
      if (lows >= 2) straighty = true;
    }

    let wetness = 0;
    if (monotone) wetness += 0.4;
    else if (twoTone) wetness += 0.18;
    if (straighty) wetness += 0.3;
    // Mid-card boards connect with more ranges than ace-high dry boards
    const high = Math.max(...ranks);
    if (high <= 11) wetness += 0.12;
    if (paired) wetness -= 0.08; // paired boards kill draw combos
    wetness = Math.max(0, Math.min(1, wetness));

    return { wetness, monotone, twoTone, paired, straighty };
  }

  // ───────────────────────────────────────────────────────────────────────
  // BLOCKERS — is this hand a GOOD bluff candidate on this board?
  // ───────────────────────────────────────────────────────────────────────

  /**
   * True when hero holds a card that meaningfully blocks the nuts:
   * the ace (or king) of a 2-3 flush-suit board without the flush itself,
   * or a card completing the board's top straight.
   */
  static hasBlocker(hole: Card[], board: Card[]): boolean {
    if (!board || board.length < 3 || !hole || hole.length === 0) return false;

    // Flush blockers
    const suitCount = new Map<string, number>();
    for (const c of board) suitCount.set(c.suit, (suitCount.get(c.suit) || 0) + 1);
    for (const [suit, count] of suitCount) {
      if (count >= 2) {
        const heroSuited = hole.filter((c) => c.suit === suit);
        const hasAceBlocker = heroSuited.some((c) => c.rank === 'A' || c.rank === 'K');
        // Holding A/K of the suit WITHOUT a made flush = prime bluff blocker
        if (hasAceBlocker && heroSuited.length + count < 5) return true;
      }
    }

    // Top-straight blockers: hero holds a rank that completes the highest
    // straight the board allows.
    //
    // V28 AUDIT FIX: two provable misses. (1) No ace-low mapping — on
    // 2-3-4-9-K the nut straight is A-5 and a hero holding the ACE computed
    // |14-2| = 12, so the single best blocker on the board was invisible
    // (texture() next door handles the wheel; the two disagreed). (2) The
    // hr >= 10 floor — on 5-6-7-K-2 the nut straight is 9-8 and a hero
    // holding the NINE was rejected by rank. Blockers below the ten block
    // real straights. The consumer boosts blocker bluffs 1.5x on scare
    // cards, so each miss was a straight loss of bluff frequency exactly
    // where blockers matter most.
    const boardRanks = [...new Set(board.map((c) => RANK_VALUES[c.rank]))].sort((a, b) => b - a);
    const hasWheelWindow = boardRanks.filter((r) => r >= 2 && r <= 5).length >= 3;
    for (const hc of hole) {
      const hr = RANK_VALUES[hc.rank];
      // The ace blocks the wheel when the board carries the low window.
      if (hr === 14 && hasWheelWindow) return true;
      let within = 0;
      for (const br of boardRanks) {
        if (Math.abs(hr - br) <= 4 && hr !== br) within++;
      }
      if (within >= 3 && hr >= 6) return true;
    }
    return false;
  }

  // ───────────────────────────────────────────────────────────────────────
  // RANGE-BAND SAMPLING SUPPORT
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Build the per-opponent band list for an equity simulation: live (unfolded,
   * not-hero) opponents in table order, each mapped through bandFor().
   */
  /** Recover the exact initial public posts from the first accepted action's
   * immutable pre-action node, then replay the controller's mixed amount ABI.
   * Missing nodes or an incomplete/inconsistent money ledger are unknown;
   * a blind raiser's initial post cannot be inferred from its final target. */
  static initialPublicMoney(
    players: SeatPlayer[],
    history: ActionRecord[] | undefined,
    pot: number
  ): { pot: number; streetBets: Array<[string, number]> } | null {
    if (!history?.length || !players.length || !Number.isFinite(pot) || pot < 0) return null;
    if (
      history.some((a) =>
        ['sb', 'bb', 'blind', 'ante', 'straddle', 'post', 'kill_blind'].includes(a.action as string)
      )
    )
      return null; // Explicit posting histories replay themselves in bandFor.
    const cents = (v: number) =>
      Number.isFinite(v) && v >= 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-5
        ? Math.round(v * 100)
        : null;
    const first = history[0].publicNode;
    if (
      first?.status !== 'captured' ||
      first.street !== history[0].stage ||
      first.actorSeat !== history[0].seat ||
      first.seats.length !== players.length
    )
      return null;
    if (first.street !== 'preflop' && !(first.street === 'flop' && first.bombPot)) return null;
    const ids = new Map(players.map((p) => [p.seat, p.user_id]));
    if (ids.size !== players.length || new Set(ids.values()).size !== players.length) return null;
    const initialPot = cents(first.pot);
    if (initialPot === null) return null;
    const invested = new Map<string, number>(),
      deadMoney = new Map<string, number>();
    let bets = new Map<string, number>();
    const initialBets: Array<[string, number]> = [];
    for (const [seat, , bet, total, dead] of first.seats) {
      const uid = ids.get(seat),
        b = cents(bet),
        t = cents(total),
        d = cents(dead);
      if (!uid || invested.has(uid) || b === null || t === null || d === null || t < b + d)
        return null;
      invested.set(uid, t);
      deadMoney.set(uid, d);
      bets.set(uid, b);
      initialBets.push([uid, b / 100]);
    }
    if ([...invested.values()].reduce((a, b) => a + b, 0) !== initialPot) return null;
    let runningPot = initialPot;
    let street: ActionRecord['stage'] = first.street;
    for (const action of history) {
      if (!invested.has(action.userId) || ids.get(action.seat) !== action.userId) return null;
      if (action.stage !== street) {
        street = action.stage;
        bets = new Map();
      }
      const node = action.publicNode;
      if (node?.status === 'captured') {
        if (
          node.street !== street ||
          node.actorSeat !== action.seat ||
          cents(node.pot) !== runningPot ||
          node.seats.length !== players.length
        )
          return null;
        const seen = new Set<number>();
        for (const [seat, , bet, total, dead] of node.seats) {
          const uid = ids.get(seat);
          if (
            !uid ||
            seen.has(seat) ||
            cents(bet) !== (bets.get(uid) ?? 0) ||
            cents(total) !== invested.get(uid) ||
            cents(dead) !== deadMoney.get(uid)
          )
            return null;
          seen.add(seat);
        }
      }
      if (!['call', 'bet', 'raise', 'all_in'].includes(action.action)) {
        if (!['check', 'fold', 'discard', 'show', 'muck'].includes(action.action)) return null;
        continue;
      }
      const amount = cents(action.amount),
        before = bets.get(action.userId) ?? 0;
      if (amount === null) return null;
      const delta = action.action === 'call' ? amount : amount - before;
      if (delta < 0) return null;
      bets.set(action.userId, before + delta);
      invested.set(action.userId, invested.get(action.userId)! + delta);
      runningPot += delta;
    }
    if (cents(pot) !== runningPot) return null;
    for (const player of players) {
      if (
        cents(player.returnedUncalled ?? 0) !== 0 ||
        cents(player.totalInvested) !== invested.get(player.user_id) ||
        cents(player.deadInvested ?? 0) !== deadMoney.get(player.user_id)
      )
        return null;
    }
    return { pot: initialPot / 100, streetBets: initialBets };
  }

  static bandsForOpponents(
    heroSeat: number,
    players: SeatPlayer[],
    history: ActionRecord[] | undefined,
    bigBlind: number,
    sizedReads: boolean = true,
    board: Card[] | null = null,
    /** V12 out-param: parallel per-opponent postflop reads (same order as
     *  the returned bands) for board-contact conditioning. */
    readsOut?: Array<OppPostflopRead | null>,
    initialPublicMoney?: { pot: number; streetBets: ReadonlyArray<readonly [string, number]> }
  ): Array<[number, number] | null> {
    const bands: Array<[number, number] | null> = [];
    for (const p of players) {
      if (p.seat === heroSeat || p.is_folded || (p.is_sitting_out && !p.is_all_in)) continue;
      const readOut: OppPostflopRead | undefined = readsOut ? { aggrW: 0, checked: 0 } : undefined;
      bands.push(
        this.bandFor(p.user_id, history, bigBlind, sizedReads, board, readOut, initialPublicMoney)
      );
      if (readsOut)
        readsOut.push(readOut && (readOut.aggrW > 0 || readOut.checked > 0) ? readOut : null);
    }
    return bands;
  }

  /**
   * Aggregate exploit profile of the live opposition. When heads-up this is
   * simply that player's profile; multiway it is the confidence-weighted blend
   * (bluffs must get through EVERYONE, so the blend leans conservative).
   */
  // ───────────────────────────────────────────────────────────────────────
  // V16 DEEP READS (2026-08-26) — full-hand observation at settlement
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Ingest one COMPLETED hand: fold-to-c-bet, fold-to-3-bet, and big-river-
   * bet sizing tells need the whole hand (and the showdown), which the
   * per-decision observe() stream never has. Called once per hand from the
   * settlement path; idempotent per handKey. Best-effort by contract — a
   * malformed history must never throw into settlement.
   */
  static observeHandComplete(
    handKey: string,
    actions:
      | Array<{
          userId?: string;
          action: string;
          origin?: string;
          amount?: number;
          stage: string;
          /** V43: the engine stamps Date.now() on every record; the tempo
           *  read needs it. Optional so older callers and fixtures still type. */
          timestamp?: number;
          isFullRaise?: boolean;
        }>
      | undefined,
    bigBlind: number,
    showdown?: Array<{ user_id: string; mucked: boolean; hand_name?: string }> | null,
    /** V45: the hand's scope (variant family x dealt count), so the deep
     *  reads land in the scoped bucket too. Absent = pooled only. */
    scope?: ReadScope | null,
    durableExploit = false,
    riverCallContext?: RiverCallContext,
    retainedRiverCalls?: readonly RiverCallSample[],
    /** STYLE READ A2: the hand's format, so river size buckets are kept per format; absent = not recorded */
    styleMode?: MemoryMode,
    /** STYLE READ F2: a human was dealt in (the row's has_human); only such hands build the Horse reference, the
     *  same population the boot rebuild reads */
    styleHasHuman = false
  ): void {
    // V45: settlement runs outside any decision; the scope travels with the
    // hand and is cleared on the way out.
    const prevScope = this.decisionScope;
    if (scope) this.decisionScope = scope;
    try {
      if (!actions || actions.length === 0 || !handKey) return;
      const flag = `fh|${handKey}`;
      if (this.handFlags.has(flag)) return;
      this.handFlags.add(flag);
      evictOldest(this.handFlags, MAX_HAND_FLAGS);

      const bb = bigBlind > 0 ? bigBlind : 1;
      // V45: every increment on a touched player is mirrored into the
      // scoped bucket at the end (delta of the snapshot taken on first
      // touch), so the deep reads are scoped like the action counters.
      const touchedBefore = new Map<string, OpponentStats>();
      const touch = (id: string): OpponentStats => {
        let s = this.stats.get(id);
        if (!s) {
          if (this.stats.size >= MAX_TRACKED_PLAYERS) return freshStats(); // discard
          s = freshStats();
          this.stats.set(id, s);
        }
        this.dirty.add(id);
        if (!touchedBefore.has(id)) touchedBefore.set(id, { ...s });
        return s;
      };
      const mirror = (): void => {
        if (touchedBefore.size === 0) return;
        // Deep counters use the completed hand's source action timestamps.
        // Missing legacy timestamps make this envelope partial/unknown; the
        // later completion/read clock must never fill their place.
        const contributionWindow = mergeHorseObservationWindows(
          ...actions.map((action) =>
            observeHorseObservationWindow(undefined, action.timestamp, false)
          )
        );
        for (const [id, before] of touchedBefore) {
          const after = this.stats.get(id);
          if (after && countersChanged(before, after)) {
            after.sourceWindow = hasContributions(before)
              ? mergeHorseObservationWindows(before.sourceWindow, contributionWindow)
              : contributionWindow;
            this.applyScopedDelta(id, before, after, contributionWindow);
          }
        }
      };

      // ── Preflop: opener vs 3-bettor ──
      const pre = actions.filter((a) => a.stage === 'preflop' && a.userId);
      let openerId: string | null = null;
      let openerIdx = -1;
      let threeBetIdx = -1;
      for (let i = 0; i < pre.length; i++) {
        const a = pre[i];
        if (isMindAggression(a)) {
          if (openerId === null) {
            openerId = a.userId!;
            openerIdx = i;
          } else if (threeBetIdx === -1 && a.userId !== openerId) {
            threeBetIdx = i;
          }
        }
      }
      if (openerId && threeBetIdx > openerIdx) {
        const reply = pre.slice(threeBetIdx + 1).find((a) => a.userId === openerId);
        if (!(reply?.action === 'fold' && reply.origin === 'forced')) {
          const s = touch(openerId);
          s.f3bOpps++;
          if (reply?.action === 'fold') s.f3bFolds++;
        }
      }

      // ── Flop: the aggressor's c-bet and who folded to it ──
      // Preflop aggressor = last preflop raiser.
      let preAggr: string | null = null;
      for (const a of pre) {
        if (isMindAggression(a)) {
          preAggr = a.userId!;
        }
      }
      const flop = actions.filter((a) => a.stage === 'flop' && a.userId);
      if (preAggr) {
        let cbetIdx = -1;
        for (let i = 0; i < flop.length; i++) {
          if (
            flop[i].action === 'bet' ||
            (flop[i].action === 'all_in' && flop[i].isFullRaise === true)
          ) {
            if (flop[i].userId === preAggr) cbetIdx = i;
            break; // only the FIRST flop bet can be a c-bet
          }
        }
        if (cbetIdx >= 0) {
          const responded = new Set<string>();
          for (let i = cbetIdx + 1; i < flop.length; i++) {
            const a = flop[i];
            if (a.userId === preAggr || responded.has(a.userId!)) continue;
            responded.add(a.userId!);
            if (a.origin === 'forced') continue;
            const s = touch(a.userId!);
            s.cbetOpps++;
            if (a.action === 'fold') s.cbetFolds++;
          }
        }
      }

      // STYLE READ A2 (2026-11-13): river first bets by size bucket, with
      // the shown-versus-unshown split. Memory only (does not survive a
      // restart) and live only: a sandbox or an effect capture records nothing.
      const styleVariant = memoryVariant(riverCallContext?.variant ?? null);
      // L7: the hand's own scope only, never a previous decision's
      const styleScope = scope ?? null;
      const styleLearn =
        (this.sandboxDepth === 0 && !this.decisionEffectSink) || this.harnessStyleLearning;
      // (c): a hand the boot rebuild already counted is not counted again (one skip per key)
      const styleBootCounted = styleLearn && this.styleBootHandKeys.delete(handKey);
      if (styleLearn && !styleBootCounted && styleMode && styleVariant && styleScope) {
        const styleSize = styleScope.split(':')[1] as MemorySize;
        const horses = horseSeatsOf(actions);
        const refKey = `${styleVariant}|${styleMode}|${styleSize}`;
        for (const [uid, inc] of postflopAggressionIncrements(actions)) {
          if (styleHasHuman && horses.has(uid)) {
            const ref = addStreetAggression(this.styleHorseReference.get(refKey), inc);
            this.styleHorseReference.delete(refKey);
            this.styleHorseReference.set(refKey, ref);
          }
          const key = styleSizeKey(uid, styleVariant, styleMode, styleSize);
          const next = addStreetAggression(this.styleAggression.get(key), inc);
          this.styleAggression.delete(key);
          this.styleAggression.set(key, next);
          while (this.styleAggression.size > MAX_TRACKED_PLAYERS)
            this.styleAggression.delete(this.styleAggression.keys().next().value!);
        }
        const shownBy = new Map<string, { mucked: boolean; hand_name?: string }>();
        for (const sd of showdown ?? []) if (sd?.user_id) shownBy.set(sd.user_id, sd);
        for (const [uid, frac] of riverFirstBetFractions(actions)) {
          const key = styleSizeKey(uid, styleVariant, styleMode, styleSize);
          const row = this.styleSizeShown.get(key) ?? {};
          const b = sizeBucketOf(frac);
          const cell = { ...(row[b] ?? { bets: 0, shown: 0, strong: 0 }) };
          cell.bets++;
          const sd = shownBy.get(uid);
          if (sd) {
            cell.shown++;
            if (!sd.mucked && STRONG_HAND_NAMES.has((sd.hand_name ?? '').toLowerCase()))
              cell.strong++;
          }
          this.styleSizeShown.delete(key);
          this.styleSizeShown.set(key, { ...row, [b]: cell });
          while (this.styleSizeShown.size > MAX_TRACKED_PLAYERS)
            this.styleSizeShown.delete(this.styleSizeShown.keys().next().value!);
        }
      }

      // ── River: big bets that reached showdown — did they mean it? ──
      if (showdown && showdown.length > 0) {
        const shown = new Map<string, { mucked: boolean; hand_name?: string }>();
        for (const sd of showdown) {
          if (sd?.user_id) shown.set(sd.user_id, sd);
        }
        const counted = new Set<string>();
        let prevTs: number | null = null;
        for (const a of actions) {
          // V43: the gap since the previous action, whatever it was. The
          // first record of the hand has no gap.
          const ts = typeof a.timestamp === 'number' && isFinite(a.timestamp) ? a.timestamp : null;
          const gap = ts !== null && prevTs !== null ? ts - prevTs : null;
          // Preserve adjacency: a missing clock breaks this pair instead of
          // turning the time since an older action into a fabricated tell.
          prevTs = ts;
          if (a.stage !== 'river' || !a.userId || counted.has(a.userId)) continue;
          if (!isMindAggression(a)) continue;
          if ((a.amount ?? 0) < 20 * bb) continue;
          const sd = shown.get(a.userId);
          if (!sd) continue; // bet took it down — no showdown information
          counted.add(a.userId);
          const s = touch(a.userId);
          s.bigBetSD++;
          // A mucked hand after betting big and being called LOST — that is
          // not value. Revealed hands are classified by name.
          const strong = !sd.mucked && STRONG_HAND_NAMES.has((sd.hand_name ?? '').toLowerCase());
          if (strong) s.bigBetSDStrong++;
          if (gap !== null && gap >= 0 && gap <= SNAP_MS) {
            s.snapBetSD++;
            if (strong) s.snapBetSDStrong++;
          } else if (gap !== null && gap >= TANK_MS) {
            s.tankBetSD++;
            if (strong) s.tankBetSDStrong++;
          }
        }
      }
      // Live public categories and retained per-hand evidence share one
      // idempotent completion boundary and the same last-river-call rule.
      if (riverCallCategoryIsUsable(riverCallContext)) {
        const callers = finalRiverCallers(actions);
        const samples =
          retainedRiverCalls ?? shownRiverCallSamples(actions, showdown, riverCallContext!);
        const counted = new Set<string>();
        for (const sample of samples) {
          if (
            !callers.has(sample.userId) ||
            counted.has(sample.userId) ||
            typeof sample.weak !== 'boolean'
          )
            continue;
          counted.add(sample.userId);
          const s = touch(sample.userId);
          s.riverCallSD++;
          if (sample.weak) s.riverCallSDWeak++;
          // Receipt (#8160, #8214): a shown river call taught the caller read.
          noteFire('river_call_showdown_learned');
        }
      }
      mirror();
      // 2026-10-16 OPPONENT EXPLOIT: one completed hand decays and feeds the
      // per-(scope, player) counters the exploit read is built from. Scoped
      // hands only: a read is always for the game it was learned in.
      if (scope && !durableExploit) this.observeExploitHand(actions, scope);
    } catch {
      /* full-hand observation is best-effort by contract */
    } finally {
      this.decisionScope = prevScope;
    }
  }

  /** V18 SELF-IMAGE: hero's own recent aggression ratio as the table sees
   *  it - rAggr/(rAggr+rPassive) over the decayed recency window. Null
   *  below a real sample. High = the fleet just watched hero bet a lot. */
  static selfImageOf(id: string): number | null {
    const s = this.stats.get(id); // pooled: the image the whole table saw
    if (!s || s.rHands < 8) return null;
    // V28 AUDIT FIX: the denominator was rAggr + rPassive — bets and CALLS
    // only. Checks were counted nowhere, so a tight horse that bet 12 times
    // and checked 40 read as 0.86 "aggressive image" and had its bluffs
    // THROTTLED, while a station's many calls diluted it below 0.35 and got a
    // bluff BOOST — the V18 adjustment fired with the wrong sign for exactly
    // the two profiles it exists to separate. The image the table sees is
    // aggression over every action it watched.
    const acts = s.rAggr + s.rPassive + (s.rChecks ?? 0);
    if (acts < 10) return null;
    return s.rAggr / acts;
  }

  /** Fold-to-c-bet frequency (0..1), or null below a 10-opportunity sample. */
  static foldToCbetOf(id: string): number | null {
    const s = this.readStats(id);
    if (!s || s.cbetOpps < 10) return null;
    return this.shrunkResponseRate('foldToCbet', s.cbetFolds, s.cbetOpps);
  }

  /** Limp-reraise tallies (HorseLimpReraiseRead), pooled: the chances a
   *  limp met a raise behind it and the re-raises. Null when never seen. */
  static limpReraiseOf(id: string): { opps: number; raises: number } | null {
    const s = this.stats.get(id);
    if (!s || !(s.lrOpps! > 0)) return null;
    return { opps: s.lrOpps!, raises: Math.min(s.lrRaises ?? 0, s.lrOpps!) };
  }

  /** Fold-to-3-bet frequency (0..1), or null below an 8-opportunity sample. */
  static foldTo3BetOf(id: string): number | null {
    const s = this.readStats(id);
    if (!s || s.f3bOpps < 8) return null;
    return s.f3bFolds / s.f3bOpps;
  }

  /** Of their big river bets that reached showdown, the fraction that were
   *  real hands (two pair+). Null below a 5-showdown sample. High = their
   *  big bets mean it; low = they bomb with air. */
  /** V43 TEMPO: how often this player's SNAP river big bets showed down as
   *  value. Null below five observations - a tempo read on a handful of
   *  hands is superstition, and superstition must not price a call. */
  static snapBetValueTendency(id: string): number | null {
    const s = this.readStats(id);
    if (!s || s.snapBetSD < 5) return null;
    return s.snapBetSDStrong / s.snapBetSD;
  }

  /** V43 TEMPO: the same for river big bets made after a long tank. */
  static tankBetValueTendency(id: string): number | null {
    const s = this.readStats(id);
    if (!s || s.tankBetSD < 5) return null;
    return s.tankBetSDStrong / s.tankBetSD;
  }

  static bigBetValueTendency(id: string): number | null {
    const s = this.readStats(id);
    if (!s || s.bigBetSD < 5) return null;
    return s.bigBetSDStrong / s.bigBetSD;
  }

  /** 2026-10-25 RIVER CALL READ: of this player's shown river calls, the
   *  fraction that were one pair or worse. Null below twelve shown calls. High =
   *  they call rivers light (bluff them less, value-bet them thinner). Read
   *  identically for every player, human or horse. A row decoded from a frame
   *  that predates the counters reads as no sample. */
  static riverCallLightTendency(id: string, baseline = 0): number | null {
    // These categories differ greatly by family. Never fall back to pooled
    // hold'em/Omaha counters while a decision has an explicit scope.
    const s = this.decisionScope
      ? this.scoped.get(`${this.decisionScope}|${id}`)
      : this.stats.get(id);
    const n = s?.riverCallSD ?? 0;
    const weak = s?.riverCallSDWeak ?? 0;
    if (
      !Number.isFinite(n) ||
      !Number.isFinite(weak) ||
      n < 12 ||
      weak < 0 ||
      weak > n ||
      !Number.isFinite(baseline) ||
      baseline < 0 ||
      baseline >= 1
    )
      return null;
    // The default is a raw frequency read, including strong-only samples.
    if (baseline > 0 && !riverCallConfidenceAboveBaseline(n, weak, baseline)) return null;
    return weak / n;
  }

  static tableExploit(
    heroSeat: number,
    players: SeatPlayer[],
    recencyBlend: boolean = true,
    options: ExploitReadOptions = {}
  ): ExploitProfile {
    const opps = players.filter(
      (p) => p.seat !== heroSeat && !p.is_folded && (!p.is_sitting_out || p.is_all_in)
    );
    if (opps.length === 0) return NEUTRAL_EXPLOIT;

    // V28 AUDIT FIX: bluffMod was seeded at the NEUTRAL 1 and only ever
    // min'd down — three 70% folders each returning 1.45 produced
    // min(1, 1.45, ...) = 1, so the upward half of the exploit was
    // unreachable in every multiway pot. "Weakest link gates bluffs" means
    // the min of the PROFILES, not the min of the profiles and an arbitrary
    // constant.
    let bluffMod = Infinity;
    let callDownMod = 0;
    let valueThinMod = 0;
    let responders = 0;
    const breakEven = this.decisionReadOptions.breakEvenBluff === true;
    let beBluff = Infinity;
    let beShift = 0;
    // The weakest responder still gates a multiway bluff when that responder
    // has no break-even read: its existing price stays in the minimum.
    let unreadBluff = Infinity;
    for (const o of opps) {
      const e = this.exploit(o.user_id, recencyBlend, options);
      // An all-in wager still carries the aggressor's observed tendencies;
      // their old fold/call response cannot price a new bluff or value bet.
      callDownMod += e.callDownMod;
      if (!o.is_all_in && !o.is_sitting_out) {
        responders++;
        bluffMod = Math.min(bluffMod, e.bluffMod); // weakest responder gates bluffs
        const be = breakEven ? this.breakEvenBluffOf(o.user_id) : null;
        if (!be) unreadBluff = Math.min(unreadBluff, e.bluffMod);
        else if (be.mod < beBluff) {
          beBluff = be.mod;
          beShift = be.foldShift;
        }
        valueThinMod += e.valueThinMod;
      }
    }
    if (!isFinite(bluffMod)) bluffMod = 1;
    return {
      bluffMod,
      callDownMod: callDownMod / opps.length,
      valueThinMod: responders > 0 ? valueThinMod / responders : 1,
      // Break-even bluffing: the weakest responder's multiplier and fold read
      // travel with the profile so each bluff bet prices its own size. When
      // an unread responder prices lower (or nobody has a break-even read),
      // nothing is attached and the bluff scale is the flag-off one.
      ...(isFinite(beBluff) && beBluff < unreadBluff
        ? (noteFire('break_even_bluff_priced'), { breakEvenBluff: beBluff, foldShift: beShift })
        : {}),
    };
  }
}
