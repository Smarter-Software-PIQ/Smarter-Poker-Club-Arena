/**
 * Lane CORE-FIX-1 (PLO-OWNER lead-3, AUDIT-A item 13; owner order Nov 21): the checked range of the UNTRACKED
 * fallback. When the range tracker returns null (no history, or any tracker failure: trackRanges catches every
 * exception), OmahaMathCore.ts prices a player who checked from the pooled public bet rate b alone. Before this
 * seam the update stripped the whole top b (a checker never holds a strong hand), the same over-strip the
 * tracked path's measured trap-rate repair corrects (lane CORE-POOLED-8/9, OmahaMathCoreTrapRate.ts: "a check
 * keeps the measured trap share tau of the value region").
 *
 * This module is the one typed place both paths meet: OMAHA_MATH_CORE_UNTRACKED_TRAP_RATE is null until the
 * trap-rate repair lands (CORE-POOLED-9 sets it to `omahaTrapRate`, one line), so today the result is the old
 * strip exactly (law: OmahaMathCoreUntrackedCheck.law.test.ts). With a rate tau the top b keeps tau of its
 * weight instead of none: the same likelihood the tracked update uses (checkKeep with pb = 0: 1 - (1 - tau)).
 * Public information only: the bet rate and the trap rate are pooled public cells; no player is named.
 */
import type { Pool, RangeSpec } from './OmahaMathCoreEquity.js';

/** A checked-to node as the trap-rate table keys it (the tracked path's TrapRateFn, with the game). */
export interface UntrackedCheckNode {
  game: string;
  street: 'flop' | 'turn' | 'river';
  /** no earlier action on this street by any seat */
  first: boolean;
  /** players in the hand at the node (2 = heads-up) */
  players: number;
}
/** The measured trap rate of a checked-to node, or undefined when the cell is absent. */
export type UntrackedTrapRate = (
  game: string,
  street: 'flop' | 'turn' | 'river',
  first: boolean,
  players: number
) => number | undefined;

/** The seam: null until the trap-rate repair is merged (then: omahaTrapRate from OmahaMathCoreTrapRate.ts). */
export const OMAHA_MATH_CORE_UNTRACKED_TRAP_RATE: UntrackedTrapRate | null = null;

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The untracked checked range: below the top b of the pool, and (with a measured trap rate tau) the top b at
 * tau of its weight. `rate` defaults to the seam; tests pass their own.
 */
export function omahaMathCoreUntrackedCheckedRange(
  pool: Pool,
  b: number,
  source: string,
  node: UntrackedCheckNode,
  rate: UntrackedTrapRate | null = OMAHA_MATH_CORE_UNTRACKED_TRAP_RATE
): RangeSpec {
  const size = pool.size;
  const a = Math.max(0, Math.min(size - 1, Math.floor(b * size)));
  const below = { idx: pool.order.slice(a, size), weight: 1 };
  const raw = rate ? rate(node.game, node.street, node.first, node.players) : undefined;
  const tau = raw !== undefined && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : undefined;
  if (tau === undefined || !(tau > 0) || a === 0) {
    // the old update, exactly: OmahaMathCore.ts band(pool, b, 1, ...)
    const lo = a;
    const hi = Math.max(lo + 1, Math.min(size, Math.round(1 * size)));
    const old = `checked: below the top ${r2(b)} [${source}]`;
    return { parts: [{ idx: pool.order.slice(lo, hi), weight: 1 }], label: old };
  }
  // part weight is the part's mass (OmahaMathCoreEquity sampler): per holding the top keeps tau, the rest 1
  const top = { idx: pool.order.slice(0, a), weight: tau * a };
  below.weight = size - a;
  const trapped = `checked: below the top ${r2(b)}, the top at trap ${r3(tau)} [${source}]`;
  return { parts: [top, below], label: trapped };
}
