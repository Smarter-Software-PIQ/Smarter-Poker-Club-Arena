/**
 * OMAHA PREFLOP ADJUSTMENT AGAINST PROVEN TIGHT OPPONENTS (owner order
 * 2026-11-13, "Make tight-vs-maniac adjustments mandatory for Phase 1").
 * Default OFF: HorseDecideOpts.omahaTightOpponent === true turns it on (its
 * declared league evaluation passed on 2026-11-14; default-on still needs the
 * docs/HORSE-DECISION-CHANGE-EVIDENCE.md rows that need production hands).
 *
 * The exploit read (HorseOpponentExploit) engages the preflop raise and
 * participation statistics on the HIGH side only, and in Omaha a player whose
 * own hands disprove the shared aggressive presumption is then read on
 * evidence alone, which for a tight player means no preflop adjustment at
 * all. This module is the low side for exactly two preflop consumers, and
 * nothing else reads it (EXPLOIT_SIDES and every Hold'em path are untouched):
 *
 *  RESPECT  facing an open or a re-raise from a proven tight RAISER, the value
 *           3-bet bar moves toward the top of what that player actually raises
 *           and the call bar rises; facing his re-raise the 4-bet and call
 *           bars rise. Bluff 3-bets and squeezes against him stop. Only ever
 *           continues less. ("pressing a player who only raises premiums pays
 *           them": the presumption block's own reasoning.)
 *  STEAL    first in from late position or the small blind when EVERY player
 *           left to act is a proven tight FOLDER, the open bar comes down by
 *           the fold equity in excess of what a pot-sized open needs to break
 *           even on folds alone. Only ever opens more.
 *
 * EVIDENCE (at least as strict as the disproof of the presumption):
 *  - at least PRESUMPTION_PROOF_MIN_OPPS (15) decayed hands of the player's
 *    own public play in this game and table size;
 *  - the presumption is disproved (raises credibly no more than the average
 *    Horse, PRESUMPTION_PROOF_CREDIBILITY one-sided);
 *  - the statistic is credibly at or below a fixed share of the Horse MEAN for
 *    this game and table size, at EXPLOIT_CREDIBILITY (0.9) one-sided, on the
 *    same Beta posterior statRead uses (prior EXPLOIT_PRIOR_STRENGTH
 *    pseudo-observations of the mean): a raiser's raise rate (pfr over hands,
 *    or raise-first-in over at least 15 first-in opportunities) at or below
 *    OMAHA_TIGHT_RAISE_SHARE (half) of the mean; a folder's VPIP at or below
 *    OMAHA_TIGHT_VPIP_SHARE (0.6) of the mean. Owner amendment 2026-11-14:
 *    the envelope's low edge (the 1st-percentile Horse) was unreachable at
 *    six-handed tables on the ~44-hand decayed window; the mean-anchored bar
 *    is still stricter than the disproof (credibly no more than the mean);
 *  - a raiser must not also play more hands than the average Horse (posterior
 *    VPIP at most the envelope mean: a loose-passive player is not tight);
 *  - no preflop statistic engaged on the high side, and the recent (fast
 *    window) raise rate not credibly back above the raiser bar
 *    (EXPLOIT_FAST_OFF_CREDIBILITY), so a player who has started raising
 *    loses the read at once.
 * Unknown, sparse, presumed and "merely not a maniac" opponents fail one of
 * these and get the baseline. Pure: no state, no random draws.
 */
import type { ReadScope } from './HorseMind.js';
import {
  EXPLOIT_CREDIBILITY,
  EXPLOIT_FAST_MIN_N,
  EXPLOIT_FAST_OFF_CREDIBILITY,
  EXPLOIT_PRIOR_STRENGTH,
  PRESUMPTION_PROOF_CREDIBILITY,
  PRESUMPTION_PROOF_MIN_OPPS,
  betaCdf,
  exploitEnvelopeFor,
  maniacRaiseWidth,
  strengthBarForTopShare,
  type ExploitCounters,
  type ExploitStatRead,
  type OpponentExploitRead,
} from './HorseOpponentExploit.js';

/** Decayed hands before a tight read can exist (the disproof's own floor). */
export const OMAHA_TIGHT_MIN_HANDS = PRESUMPTION_PROOF_MIN_OPPS;
/** One-sided credibility below the envelope's low edge. */
export const OMAHA_TIGHT_CREDIBILITY = EXPLOIT_CREDIBILITY;
/** A proven tight raiser raises credibly at most this share of the Horse mean. */
export const OMAHA_TIGHT_RAISE_SHARE = 0.5;
/** A proven tight folder plays credibly at most this share of the Horse mean VPIP. */
export const OMAHA_TIGHT_VPIP_SHARE = 0.6;
/** The consumers stand down at or under this effective depth (push/fold play). */
export const OMAHA_TIGHT_MIN_EFFECTIVE_BB = 25;
/** RESPECT magnitudes: the Hold'em tight-raiser bounds (HorseOpponentStyle
 *  STYLE_THRESHOLDS), and the Omaha value share preflopVsOpener uses. */
export const OMAHA_TIGHT_OPENER_VALUE_SHARE = 0.3;
export const OMAHA_TIGHT_OPENER_MAX_BAR_MOVE = 0.1;
export const OMAHA_TIGHT_OPENER_CALL_BUMP = 0.04;
export const OMAHA_TIGHT_RERAISER_FOUR_BET_BUMP = 0.03;
export const OMAHA_TIGHT_RERAISER_CALL_BUMP = 0.06;
/** A tight raiser's range is never read narrower than this share of hands. */
export const OMAHA_TIGHT_RANGE_FLOOR = 0.03;
/** STEAL: the open bar moves by this share of the fold-equity surplus, at most the cap. */
export const OMAHA_TIGHT_STEAL_SCALE = 0.5;
export const OMAHA_TIGHT_STEAL_MAX_WIDEN = 0.1;

export interface OmahaTightRead {
  /** decayed hands behind the read */
  hands: number;
  /** proven tight raiser (RESPECT) */
  raiser: boolean;
  /** proven tight folder (STEAL) */
  folder: boolean;
  /** share of hands this player raises (posterior), floored */
  raiseWidth: number;
  /** posterior VPIP */
  vpip: number;
  pfr: ExploitStatRead;
  rfi: ExploitStatRead;
  vpipRead: ExploitStatRead;
}

const PREFLOP_STATS = ['vpip', 'pfr', 'rfi', 'threeBet'] as const;

/**
 * The posterior of (successes, opportunities) with EXPLOIT_PRIOR_STRENGTH
 * pseudo-observations of the population mean (statRead's posterior), engaged
 * 'low' when P(rate <= bar) >= credibility.
 */
export function credibleAtOrBelow(
  successes: number,
  opportunities: number,
  populationMean: number,
  bar: number,
  credibility: number = OMAHA_TIGHT_CREDIBILITY
): ExploitStatRead {
  const n = Math.max(0, Number(opportunities) || 0);
  const s = Math.max(0, Math.min(n, Number(successes) || 0));
  const k = EXPLOIT_PRIOR_STRENGTH;
  const alpha = populationMean * k + s;
  const beta = (1 - populationMean) * k + (n - s);
  const mean = alpha / (alpha + beta);
  const engaged = bar > 0 && betaCdf(bar, alpha, beta) >= credibility ? 'low' : null;
  return {
    mean,
    n,
    engaged,
    excess: engaged ? Math.min(1, Math.max(0, (bar - mean) / Math.max(1e-9, bar))) : 0,
  };
}

/**
 * The tight read of one Omaha opponent from their decayed counters in this
 * scope, or null when there is no evidence to judge. `exploit` is the same
 * player's high-side exploit read (null when nothing engaged).
 */
export function omahaTightRead(
  counters: ExploitCounters | undefined,
  scope: ReadScope | null,
  variant: string | null | undefined,
  exploit: OpponentExploitRead | null
): OmahaTightRead | null {
  if (!counters || !scope || !scope.startsWith('omaha:')) return null;
  const hands = Math.max(0, Number(counters.hands ?? 0));
  if (!(hands >= OMAHA_TIGHT_MIN_HANDS)) return null;
  const envelope = exploitEnvelopeFor(scope, variant);
  if (!envelope) return null;
  const raiseBar = OMAHA_TIGHT_RAISE_SHARE * envelope.pfr.mean;
  const pfr = credibleAtOrBelow(counters.pfr, hands, envelope.pfr.mean, raiseBar);
  const rfiOpp = Math.max(0, Number(counters.rfiOpp ?? 0));
  const rfiRaw = credibleAtOrBelow(
    counters.rfi,
    rfiOpp,
    envelope.rfi.mean,
    OMAHA_TIGHT_RAISE_SHARE * envelope.rfi.mean
  );
  const rfi: ExploitStatRead =
    rfiOpp >= OMAHA_TIGHT_MIN_HANDS ? rfiRaw : { ...rfiRaw, engaged: null, excess: 0 };
  const vpipRead = credibleAtOrBelow(
    counters.vpip,
    hands,
    envelope.vpip.mean,
    OMAHA_TIGHT_VPIP_SHARE * envelope.vpip.mean
  );
  // The presumption must be disproved on the same counters (raises credibly
  // no more than the average Horse).
  const s = Math.max(0, Math.min(hands, Number(counters.pfr ?? 0)));
  const k = EXPLOIT_PRIOR_STRENGTH;
  const disproved =
    betaCdf(
      envelope.pfr.mean,
      envelope.pfr.mean * k + s,
      (1 - envelope.pfr.mean) * k + (hands - s)
    ) >= PRESUMPTION_PROOF_CREDIBILITY;
  // Never a player any preflop statistic reads as wide.
  const wide =
    maniacRaiseWidth(exploit) !== null ||
    PREFLOP_STATS.some((st) => exploit?.stats[st]?.engaged === 'high');
  // Recent raising credibly back above the raiser bar withdraws the read.
  const fHands = Math.max(0, Number(counters.fHands ?? 0));
  let raisingAgain = false;
  if (fHands >= EXPLOIT_FAST_MIN_N) {
    const fs = Math.max(0, Math.min(fHands, Number(counters.fPfr ?? 0)));
    raisingAgain =
      1 -
        betaCdf(
          Math.max(1e-9, raiseBar),
          envelope.pfr.mean * k + fs,
          (1 - envelope.pfr.mean) * k + (fHands - fs)
        ) >=
      EXPLOIT_FAST_OFF_CREDIBILITY;
  }
  const eligible = disproved && !wide && !raisingAgain;
  // A passive player who limps or calls more than the average Horse is not
  // tight: a low raise rate alone does not make a raiser respected.
  const loose = vpipRead.mean > envelope.vpip.mean;
  return {
    hands,
    raiser: eligible && !loose && (pfr.engaged === 'low' || rfi.engaged === 'low'),
    folder: eligible && vpipRead.engaged === 'low',
    raiseWidth: Math.max(
      OMAHA_TIGHT_RANGE_FLOOR,
      pfr.mean,
      rfiOpp >= OMAHA_TIGHT_MIN_HANDS ? rfi.mean : 0
    ),
    vpip: vpipRead.mean,
    pfr,
    rfi,
    vpipRead,
  };
}

export interface OmahaTightOpener {
  /** the value 3-bet bar: the top OMAHA_TIGHT_OPENER_VALUE_SHARE of his raises */
  threeBetBar: number;
  /** the 3-bet bar never rises by more than this */
  maxBarMove: number;
  /** the call bar rises by this */
  callBump: number;
}
export interface OmahaTightReRaiser {
  fourBetBump: number;
  callBump: number;
}
export interface OmahaTightSteal {
  /** the open bar comes down by this (strength units) */
  openWiden: number;
  /** probability every player left to act folds (posterior VPIP means) */
  pAllFold: number;
  /** fold share a pot-sized open needs to break even on folds alone */
  breakEven: number;
}

/** RESPECT facing a single raise from this player, or null. */
export function omahaTightOpenerRespect(read: OmahaTightRead | null): OmahaTightOpener | null {
  if (!read?.raiser) return null;
  return {
    threeBetBar: strengthBarForTopShare(OMAHA_TIGHT_OPENER_VALUE_SHARE * read.raiseWidth),
    maxBarMove: OMAHA_TIGHT_OPENER_MAX_BAR_MOVE,
    callBump: OMAHA_TIGHT_OPENER_CALL_BUMP,
  };
}

/** RESPECT facing a re-raise (3-bet or more) from this player, or null. */
export function omahaTightReRaiserRespect(read: OmahaTightRead | null): OmahaTightReRaiser | null {
  if (!read?.raiser) return null;
  return {
    fourBetBump: OMAHA_TIGHT_RERAISER_FOUR_BET_BUMP,
    callBump: OMAHA_TIGHT_RERAISER_CALL_BUMP,
  };
}

/**
 * STEAL first in: every read is a player left to act, and every one must be a
 * proven tight folder. `risk` is what the open costs hero from here, `dead`
 * the money already in the pot (blinds and antes). Null when any player is
 * not proven, when there is no one left to act, or when the fold equity does
 * not clear break-even.
 */
export function omahaTightSteal(
  reads: ReadonlyArray<OmahaTightRead | null>,
  risk: number,
  dead: number
): OmahaTightSteal | null {
  if (reads.length === 0 || !(risk > 0) || !(dead > 0)) return null;
  let pAllFold = 1;
  for (const r of reads) {
    if (!r?.folder) return null;
    pAllFold *= Math.max(0, Math.min(1, 1 - r.vpip));
  }
  const breakEven = risk / (risk + dead);
  const openWiden = Math.min(
    OMAHA_TIGHT_STEAL_MAX_WIDEN,
    OMAHA_TIGHT_STEAL_SCALE * Math.max(0, pAllFold - breakEven)
  );
  if (!(openWiden > 0)) return null;
  return { openWiden, pAllFold, breakEven };
}
