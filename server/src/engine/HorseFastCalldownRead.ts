/**
 * ═══ THE FAST CALL-DOWN READ (2026-11-07) ═══
 *
 * The river bluff layers (HorseRiverBluffRange heads-up baseline and its
 * out-of-position leads, HorseMultiwayRiverBluff) bluff more against a river
 * folder and keep a fifth (multiway: a twentieth; leads: none) against a
 * credible station. Both reads were slow to see a player ADAPT:
 *
 *  - the station read (isStation) is the long exploit window, credibly past
 *    the P99 horse at 0.9 credibility. Measured with
 *    HorseFastCalldownRead.test-support.ts (heads-up hold'em, a player who
 *    folded 30 river bets and then called every one): it never engaged in
 *    40 straight calls when every hand was a river spot, and took 28 calls
 *    with three blank hands between river spots (23 after only 12 folds);
 *  - the lifetime V23 river fold rate (HorseMind.riverFoldRate) never decays,
 *    so it held the 1.6x folder boost for 6 calls and stayed above neutral
 *    for 10: the end-to-end bluff rate against the reformed folder was still
 *    above the unknown-player rate (0.455 against 0.405) after 8 calls. The
 *    other way, a lifetime station who starts folding kept the station cut
 *    for 10 folds.
 *
 * This read answers from RECENT river play only, from two windows:
 *  1. the river-specific recency window (OpponentStats.rvOpps / rvCalls,
 *     HorseMind.observe): it ages once per RIVER OPPORTUNITY with a
 *     FAST_CALLDOWN_RIVER_HALF_LIFE-opportunity half-life, so blank hands
 *     between river spots do not dilute it;
 *  2. the exploit fast window (fRiverCall / fRiverCallOpp, 8-hand half-life,
 *     present in live, sandboxed and durable rows alike).
 * Either window may carry the call-down read. The shift (callingMore and
 * the fold-rate input) compares the river window with the player's long river
 * call rate (lifetime V23 when it has a sample, else the long exploit window,
 * else the population mean), shrunk with the same prior and evidence.
 *
 * Outputs:
 *  - callingDown: the recent call rate of either window is credibly
 *    (FAST_CALLDOWN_CREDIBILITY) above FAST_CALLDOWN_EDGE. The bluff
 *    layers treat it exactly as a credible station: a fifth of the heads-up
 *    baseline, no bluff lead, and the multiway station factor.
 *  - callingMore: the recent rate has risen that far, credible or not yet;
 *    the heads-up baseline then drops the long window's over-folder floor
 *    and folder bluffMod, which describe the style the player has left.
 *  - riverFoldRate: the fold-rate input the layers price with. A recent fold
 *    rate at least FAST_CALLDOWN_SHIFT below the lifetime one replaces it
 *    (less folder boost at once); one at least that far above it lifts the
 *    lifetime rate only up to the neutral point FAST_CALLDOWN_NEUTRAL_FOLD,
 *    which releases a lifetime station read without granting a short window
 *    a folder boost.
 *
 * It never switches a bluff off on absence of data: without
 * FAST_CALLDOWN_MIN_OPPS recent opportunities it returns null and the layers
 * run their exact pre-existing code. Pure; no random draws.
 */
import { betaCdf } from './HorseOpponentExploit.js';

/** River opportunities for the recency window to lose half its weight. */
export const FAST_CALLDOWN_RIVER_HALF_LIFE = 2.5;
export const FAST_CALLDOWN_RIVER_DECAY = Math.pow(0.5, 1 / FAST_CALLDOWN_RIVER_HALF_LIFE);
/** Decayed recent opportunities before the read says anything. */
export const FAST_CALLDOWN_MIN_OPPS = 2.5;
/** The recent posterior's prior: even odds, FAST_CALLDOWN_PRIOR_STRENGTH
 *  pseudo-observations. Not the population mean: the question is whether
 *  this player now calls more than he folds, and the population's river call
 *  rate differs by game and table size (envelope means: 0.42 PLO4 heads-up,
 *  0.43 short-handed hold'em, 0.51 heads-up hold'em) while the price of a
 *  bluff does not. Read against those means, six straight calls after thirty
 *  folds were credible in heads-up hold'em and not yet in PLO4 heads-up or
 *  in a three-way hold'em pot. */
export const FAST_CALLDOWN_PRIOR = 0.5;
/** Pseudo-observations of the prior in the recent posterior. */
export const FAST_CALLDOWN_PRIOR_STRENGTH = 4;
/** A river call rate credibly above this is calling down. */
export const FAST_CALLDOWN_EDGE = 0.55;
/** One-sided credibility of "above the edge". */
export const FAST_CALLDOWN_CREDIBILITY = 0.8;
/** The recent rate must have moved this far from the long one. */
export const FAST_CALLDOWN_SHIFT = 0.25;
/** riverBluffReadFactor's neutral fold rate (factor 1). */
export const FAST_CALLDOWN_NEUTRAL_FOLD = 0.45;
/** Lifetime V23 river opportunities before it is the long rate (riverFoldRate). */
export const FAST_CALLDOWN_LIFETIME_MIN_OPPS = 8;

export interface FastCalldownInput {
  /** river-specific recency window (decayed per river opportunity) */
  recentRiverOpps: number;
  recentRiverCalls: number;
  /** exploit fast window (fRiverCallOpp / fRiverCall) */
  fastOpps: number;
  fastCalls: number;
  /** exploit long window (riverCallOpp / riverCall) */
  longOpps: number;
  longCalls: number;
  /** lifetime V23 counters (riverBetOpps / riverBetFolds) */
  lifetimeOpps: number;
  lifetimeFolds: number;
}

export interface FastCalldownRead {
  callingDown: boolean;
  /** recent river calling has risen FAST_CALLDOWN_SHIFT over the long rate
   *  (true whenever callingDown is): a stale over-folder read is not priced */
  callingMore: boolean;
  /** the river fold rate the bluff layers should price with, or null for
   *  "no lifetime sample and nothing to replace it" */
  riverFoldRate: number | null;
  /** posterior mean of the recent call rate behind the read */
  recentCallRate: number;
  /** decayed recent opportunities behind it */
  recentOpps: number;
  /** the long call rate it was compared with */
  longCallRate: number;
}

const finite = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/** Advance the river recency window by one river opportunity. */
export function observeFastCalldownRiver(
  window: { rvOpps?: number; rvCalls?: number },
  called: boolean
): void {
  window.rvOpps = finite(window.rvOpps ?? 0) * FAST_CALLDOWN_RIVER_DECAY + 1;
  window.rvCalls = finite(window.rvCalls ?? 0) * FAST_CALLDOWN_RIVER_DECAY + (called ? 1 : 0);
}

interface WindowJudgement {
  mean: number;
  n: number;
  above: boolean;
}

function judge(calls: number, opps: number, prior: number): WindowJudgement | null {
  const n = finite(opps);
  if (n < FAST_CALLDOWN_MIN_OPPS) return null;
  const c = Math.min(n, finite(calls));
  const k = FAST_CALLDOWN_PRIOR_STRENGTH;
  const a = prior * k + c;
  const b = (1 - prior) * k + (n - c);
  return {
    mean: a / (a + b),
    n,
    above: 1 - betaCdf(FAST_CALLDOWN_EDGE, a, b) >= FAST_CALLDOWN_CREDIBILITY,
  };
}

/** The fast call-down read, or null without recent river evidence. Pure. */
export function fastCalldownRead(input: FastCalldownInput): FastCalldownRead | null {
  const prior = FAST_CALLDOWN_PRIOR;
  const windows = [
    judge(input.recentRiverCalls, input.recentRiverOpps, prior),
    judge(input.fastCalls, input.fastOpps, prior),
  ].filter((w): w is WindowJudgement => w !== null);
  if (windows.length === 0) return null;
  const lifeOpps = finite(input.lifetimeOpps);
  const lifetimeFold =
    lifeOpps >= FAST_CALLDOWN_LIFETIME_MIN_OPPS
      ? Math.min(1, finite(input.lifetimeFolds) / lifeOpps)
      : null;
  const longOpps = finite(input.longOpps);
  const longCallRate =
    lifetimeFold !== null
      ? 1 - lifetimeFold
      : longOpps > 0
        ? (prior * 6 + Math.min(longOpps, finite(input.longCalls))) / (6 + longOpps)
        : prior;
  // A shift is measured against the long rate shrunk exactly as the window
  // was (the same prior, the window's own evidence), so the shrinkage of a
  // short window is never itself read as a change of style.
  const shift = (w: WindowJudgement): number => {
    const k = FAST_CALLDOWN_PRIOR_STRENGTH;
    return w.mean - (prior * k + longCallRate * w.n) / (k + w.n);
  };
  // The call-down side: either window credibly calling past the edge. No
  // separate "risen from the long rate" test: measured on simulated stable
  // callers it removed almost no false reads (a 50% caller read as calling
  // down 2.8% of the time without it, 2.4% with it), and it switched the read
  // off and on for a player still calling every river once his lifetime
  // rate caught up (the rise shrinks while the credibility holds).
  const callingDown = windows.some((w) => w.above);
  // The river-specific window answers first when it holds enough evidence:
  // it is the one blank hands do not dilute.
  const recent = windows[0];
  const s = shift(recent);
  const recentFold = 1 - recent.mean;
  let riverFoldRate = lifetimeFold;
  let callingMore = callingDown;
  if (s >= FAST_CALLDOWN_SHIFT) {
    callingMore = true;
    if (lifetimeFold !== null) riverFoldRate = Math.min(lifetimeFold, recentFold);
  } else if (-s >= FAST_CALLDOWN_SHIFT && lifetimeFold !== null)
    riverFoldRate = Math.max(lifetimeFold, Math.min(recentFold, FAST_CALLDOWN_NEUTRAL_FOLD));
  return {
    callingDown,
    callingMore,
    riverFoldRate,
    recentCallRate: recent.mean,
    recentOpps: Math.max(...windows.map((w) => w.n)),
    longCallRate,
  };
}
