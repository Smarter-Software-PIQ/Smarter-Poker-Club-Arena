/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BOT DETECTOR — action-timing entropy / decision-latency variance heuristics
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * FOUNDATION MODULE — pure, deterministic, unit-tested. Consumes NormalizedHand[]
 * and emits a per-user suspicion IntegrityFlag.
 *
 * Intuition: human decision latency is noisy and context-dependent; scripted
 * bots tend to act with (a) LOW entropy — clustered around a few fixed cadences,
 * (b) LOW coefficient of variation — very consistent timing, and (c) a high
 * fraction of near-identical inter-action gaps. We combine three normalized
 * sub-scores into a 0..1 suspicion score.
 *
 * These are heuristics, not proof — output feeds human review via the AntiCheat
 * seam (see types.ts toAntiCheatEvent). Tune thresholds against production data.
 */

import { type IntegrityFlag, type NormalizedHand, severityFromScore } from './types.js';

export interface BotDetectorOptions {
  /** Minimum voluntary decisions required before scoring a user. */
  minSamples?: number;
  /** Histogram bin width (ms) for entropy computation. */
  binWidthMs?: number;
  /** Score threshold above which a flag is emitted. */
  flagThreshold?: number;
  /** Tolerance (ms) for counting two latencies as "the same cadence". */
  cadenceToleranceMs?: number;
}

const DEFAULTS: Required<BotDetectorOptions> = {
  minSamples: 15,
  binWidthMs: 250,
  flagThreshold: 0.6,
  cadenceToleranceMs: 120,
};

export interface BotTimingStats {
  userId: string;
  sampleSize: number;
  meanMs: number;
  stdDevMs: number;
  /** Coefficient of variation = stdDev / mean (dimensionless). */
  cv: number;
  /** Shannon entropy of the binned latency distribution, in bits. */
  entropyBits: number;
  /** Max entropy achievable given the number of occupied bins, in bits. */
  maxEntropyBits: number;
  /** entropyBits / maxEntropyBits, 0..1 (1 = perfectly uniform/human-like spread). */
  normalizedEntropy: number;
  /** Fraction of latencies within cadenceToleranceMs of the modal cadence. */
  modalCadenceFraction: number;
}

/** Population standard deviation. */
export function stdDev(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(variance);
}

/** Shannon entropy (bits) of a value list after binning by `binWidth`. */
export function binnedEntropyBits(
  values: number[],
  binWidth: number,
  offset = 0
): { entropy: number; occupiedBins: number } {
  if (values.length === 0 || binWidth <= 0) return { entropy: 0, occupiedBins: 0 };
  const counts = new Map<number, number>();
  for (const v of values) {
    const bin = Math.floor((v + offset) / binWidth);
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  const n = values.length;
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / n;
    entropy -= p * Math.log2(p);
  }
  return { entropy, occupiedBins: counts.size };
}

/**
 * Phase-invariant normalized entropy in [0,1]. Bin-boundary alignment can
 * artificially split a tight cluster across two bins; we evaluate at two bin
 * origins (offset 0 and binWidth/2) and take the LOWER normalized entropy, so a
 * near-constant series reads as regular regardless of where the bin edges fall.
 */
export function normalizedTimingEntropy(values: number[], binWidth: number): number {
  const offsets = [0, binWidth / 2];
  let best = 1;
  for (const off of offsets) {
    const { entropy, occupiedBins } = binnedEntropyBits(values, binWidth, off);
    const maxEntropy = occupiedBins > 1 ? Math.log2(occupiedBins) : 0;
    const norm = maxEntropy > 0 ? entropy / maxEntropy : 0;
    if (norm < best) best = norm;
  }
  return best;
}

/** Fraction of values within `tolerance` of the most common (modal) bin center. */
function modalCadenceFraction(values: number[], tolerance: number): number {
  if (values.length === 0) return 0;
  // Bin by tolerance to find the dominant cadence, then count near it.
  const counts = new Map<number, number>();
  for (const v of values) {
    const bin = Math.round(v / Math.max(1, tolerance));
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  let modalBin = 0;
  let modalCount = -1;
  for (const [bin, c] of counts) {
    if (c > modalCount) {
      modalCount = c;
      modalBin = bin;
    }
  }
  const center = modalBin * tolerance;
  const near = values.filter((v) => Math.abs(v - center) <= tolerance).length;
  return near / values.length;
}

/** Compute timing stats for a single user's voluntary decision latencies. */
export function computeTimingStats(
  userId: string,
  latencies: number[],
  opts: BotDetectorOptions = {}
): BotTimingStats {
  const o = { ...DEFAULTS, ...opts };
  const n = latencies.length;
  const mean = n > 0 ? latencies.reduce((s, v) => s + v, 0) / n : 0;
  const sd = stdDev(latencies);
  const cv = mean > 0 ? sd / mean : 0;
  const { entropy, occupiedBins } = binnedEntropyBits(latencies, o.binWidthMs);
  const maxEntropy = occupiedBins > 1 ? Math.log2(occupiedBins) : 0;
  const normalizedEntropy = normalizedTimingEntropy(latencies, o.binWidthMs);
  return {
    userId,
    sampleSize: n,
    meanMs: mean,
    stdDevMs: sd,
    cv,
    entropyBits: entropy,
    maxEntropyBits: maxEntropy,
    normalizedEntropy,
    modalCadenceFraction: modalCadenceFraction(latencies, o.cadenceToleranceMs),
  };
}

export interface BotAccum {
  latenciesByUser: Map<string, number[]>;
  handsPerUser: Map<string, Set<string>>;
}

export function createBotAccum(): BotAccum {
  return {
    latenciesByUser: new Map<string, number[]>(),
    handsPerUser: new Map<string, Set<string>>(),
  };
}

/** Accumulate per-user decision latencies and hand participation from one hand. */
export function accumulateBotHand(accum: BotAccum, hand: NormalizedHand): void {
  for (const a of hand.actions) {
    if (a.forced || !a.userId) continue;
    // latencyMs is 0 for the first action in a hand — skip those (no clock signal).
    if (a.latencyMs <= 0) continue;
    let arr = accum.latenciesByUser.get(a.userId);
    if (!arr) {
      arr = [];
      accum.latenciesByUser.set(a.userId, arr);
    }
    arr.push(a.latencyMs);
  }
  for (const p of hand.players) {
    let set = accum.handsPerUser.get(p.userId);
    if (!set) {
      set = new Set<string>();
      accum.handsPerUser.set(p.userId, set);
    }
    set.add(hand.handId);
  }
}

/** Extract per-user voluntary decision latencies from a batch of hands. */
export function extractDecisionLatencies(hands: NormalizedHand[]): Map<string, number[]> {
  const accum = createBotAccum();
  for (const hand of hands) {
    accumulateBotHand(accum, hand);
  }
  return accum.latenciesByUser;
}

/**
 * Turn timing stats into a 0..1 suspicion score with weighted reasons.
 *   - lowEntropy:  1 - normalizedEntropy   (regular cadence => low entropy => suspicious)
 *   - lowVariance: clamp(1 - cv / 0.6)     (CV below ~0.6 is unusually consistent)
 *   - fixedCadence: modalCadenceFraction   (many gaps at one cadence)
 */
export function scoreFromStats(
  stats: BotTimingStats
): IntegrityFlag['reasons'] & { score: number } {
  const lowEntropy = 1 - Math.min(1, Math.max(0, stats.normalizedEntropy));
  const lowVariance = Math.min(1, Math.max(0, 1 - stats.cv / 0.6));
  const fixedCadence = Math.min(1, Math.max(0, stats.modalCadenceFraction));

  const weights = { lowEntropy: 0.4, lowVariance: 0.35, fixedCadence: 0.25 };
  const score =
    lowEntropy * weights.lowEntropy +
    lowVariance * weights.lowVariance +
    fixedCadence * weights.fixedCadence;

  const reasons = [
    {
      code: 'low_timing_entropy',
      detail: `normalized latency entropy ${stats.normalizedEntropy.toFixed(2)} (lower = more bot-like)`,
      weight: lowEntropy * weights.lowEntropy,
    },
    {
      code: 'low_latency_variance',
      detail: `coefficient of variation ${stats.cv.toFixed(2)} (human ~>0.6)`,
      weight: lowVariance * weights.lowVariance,
    },
    {
      code: 'fixed_cadence',
      detail: `${(stats.modalCadenceFraction * 100).toFixed(0)}% of decisions share one cadence`,
      weight: fixedCadence * weights.fixedCadence,
    },
  ];
  return Object.assign(reasons, { score: Math.min(1, score) });
}

/** Score an already-accumulated per-user latency table and emit flags above threshold. */
export function scoreBotAccum(accum: BotAccum, opts: BotDetectorOptions = {}): IntegrityFlag[] {
  const o = { ...DEFAULTS, ...opts };
  const flags: IntegrityFlag[] = [];
  for (const [userId, latencies] of accum.latenciesByUser) {
    if (latencies.length < o.minSamples) continue;
    const stats = computeTimingStats(userId, latencies, o);
    const scored = scoreFromStats(stats);
    if (scored.score < o.flagThreshold) continue;
    const reasons = (scored as unknown as IntegrityFlag['reasons']).filter((r) => r.weight > 0);
    flags.push({
      type: 'bot',
      userIds: [userId],
      score: scored.score,
      severity: severityFromScore(scored.score),
      reasons,
      handsAnalyzed: accum.handsPerUser.get(userId)?.size ?? 0,
      evidence: {
        sampleSize: stats.sampleSize,
        meanMs: Math.round(stats.meanMs),
        stdDevMs: Math.round(stats.stdDevMs),
        cv: Number(stats.cv.toFixed(3)),
        normalizedEntropy: Number(stats.normalizedEntropy.toFixed(3)),
        modalCadenceFraction: Number(stats.modalCadenceFraction.toFixed(3)),
      },
    });
  }
  return flags.sort((a, b) => b.score - a.score);
}

/** Main entry: score every user in the batch and emit flags above threshold. */
export function detectBots(
  hands: NormalizedHand[],
  opts: BotDetectorOptions = {}
): IntegrityFlag[] {
  const accum = createBotAccum();
  for (const hand of hands) {
    accumulateBotHand(accum, hand);
  }
  return scoreBotAccum(accum, opts);
}
