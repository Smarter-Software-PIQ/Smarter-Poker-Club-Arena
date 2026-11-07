/**
 * Solver-layer execution helpers shared by HorseLogic (V29-V32) and the V31
 * certified consult (HorseV31CertifiedPolicy). Moved verbatim from
 * HorseLogic.ts (2026-11-06) so the V31 execution fingerprint can name them
 * as a file of their own.
 */
import { noteFire } from './BrainTelemetry.js';
import { GTO_MAX_DEPTH_BB, snapDepthBucket } from './GtoPostflop.js';
import type { GtoV31ActionFamily } from './GtoPostflopV31.js';
import type { HorseDecision } from '../types.js';
import { chipStepFor } from './HorseNlhOpenSize.js';

const chipStep = chipStepFor;

/**
 * Reconcile a sampled certified action with the decision that reached the
 * engine. A call that consumes the remaining stack is still the sampled call;
 * wagers must retain both their family and their size (apart from one legal
 * chip-step of deterministic rounding). This helper is exported so the
 * release gate's exact semantics have direct unit coverage.
 */
export function gtoV31ExecutionMatches(args: {
  sampledFamily: GtoV31ActionFamily;
  sampledAmount: number | null;
  finalAction: HorseDecision['action'];
  finalAmount: number | null;
  bigBlind?: number;
}): boolean {
  const amountPreserved =
    args.sampledAmount !== null &&
    args.finalAmount !== null &&
    Number.isFinite(args.sampledAmount) &&
    Number.isFinite(args.finalAmount) &&
    Math.abs(args.sampledAmount - args.finalAmount) <= chipStep(args.bigBlind) + 0.005;
  if (args.sampledFamily === 'call') {
    return args.finalAction === 'all_in' || (args.finalAction === 'call' && amountPreserved);
  }
  if (args.sampledFamily === 'bet' || args.sampledFamily === 'raise') {
    return args.finalAction === args.sampledFamily && amountPreserved;
  }
  return args.finalAction === args.sampledFamily;
}

/**
 * NAME THE MISS (2026-09-01).
 *
 * On 2026-08-31 the solver layers missed far more than they hit: V32 recorded
 * v32_defend_no_range 9,693 times against 7,202 usable answers (a 57% miss),
 * and V31 answered 165 consults against gto_miss_no_cell 12,193 - a 1.3% hit
 * rate. The counters proved there was a hole and could not say WHERE, so the
 * only available response was to guess at the export or to widen the gate.
 *
 * These two axes make the hole addressable. Cardinality is deliberately tiny
 * - five depth buckets and four streets per layer, not the full
 * street x family x position x depth product, which would be ~432 rows a day
 * and unreadable. Depth and street are the two that were actually suspected,
 * and either can be split further once the coarse answer points somewhere.
 */
export function missDepthBand(stackBB: number): string {
  if (!(stackBB > 0) || !isFinite(stackBB)) return 'unknown';
  if (stackBB <= 20) return 'le20';
  if (stackBB <= 50) return 'le50';
  if (stackBB <= 110) return 'le110';
  if (stackBB <= GTO_MAX_DEPTH_BB) return 'le' + GTO_MAX_DEPTH_BB;
  return 'gt' + GTO_MAX_DEPTH_BB;
}

/** Record one miss against both axes. `layer` is 'v31' or 'v32'. */
export function noteGtoMiss(layer: string, street: string, stackBB: number): void {
  noteFire(layer + '_miss_depth_' + missDepthBand(stackBB));
  noteFire(layer + '_miss_street_' + street);
}

export function cellDepthIsPrimary(
  cell: string,
  stackBB: number,
  certifiedDepth?: number
): boolean {
  if (certifiedDepth !== undefined) return certifiedDepth === snapDepthBucket(stackBB);
  const parts = cell.split('|');
  if (parts.length < 5) return true; // unknown shape: do not invent a miss
  // V29/V30 keys place depth at 3. Certified V31 keys place it at 8, after
  // objective, utility context, table size, pot type, and both positions.
  const d = Number(parts[parts.length >= 13 ? 8 : 3]);
  if (!isFinite(d)) return true;
  return d === snapDepthBucket(stackBB);
}
