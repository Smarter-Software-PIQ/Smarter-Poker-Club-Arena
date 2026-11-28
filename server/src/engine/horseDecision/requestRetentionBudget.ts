import type { HorseDecisionJobRequest } from './protocol.js';

// Includes posted requests until their actual terminal response, not merely
// caller timeout. Limits are allocation allowances, not measurements of V8 RSS.
// 4 MiB / 65,536 nodes leaves headroom for a full 9-max DECIDE_FAST carrying
// both a near-256 KiB ownPublicHistory packet (~1.85 MiB allowance, ~13.4k nodes)
// and a full OpponentHudPacket (~1.15 MiB allowance, ~13.5k nodes on 9-max).
export const HORSE_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
export const HORSE_REQUEST_MAX_NODES = 65536;
export const HORSE_REQUEST_MAX_PENDING = 2048;
export const HORSE_REQUEST_RETAINED_BYTES = 96 * 1024 * 1024;
export const HORSE_REQUEST_MAX_PLANS = 128;
// Maximum sixteen validated outlook records charge 179,534 allowance bytes
// before binding/acceptance. Keep 256 KiB for the complete control payload.
const EFFECT_BYTES = 256 * 1024;
const PLAN_RESERVE = 2 * EFFECT_BYTES; // one commit and its possible unknown-outcome retirement

export class HorseRequestCapacityError extends Error {
  override readonly name = 'HorseRequestCapacityError';
  constructor() {
    super('Horse request retention capacity unavailable');
  }
}

export interface HorseRequestAllowanceMetrics {
  readonly bytes: number;
  readonly nodes: number;
}

/** Bounded traversal before retaining/copying a request. String escaping and
 * per-property overhead are charged conservatively; no getter is executed.
 * Repeated references are charged on each path; depth/node bounds refuse cycles.
 * Parallel value/depth stacks avoid per-node wrapper object allocations on the
 * hot main-thread dispatch path (incident 1e532243). */
export function horseRequestAllowanceMetrics(
  value: unknown,
  maximum = HORSE_REQUEST_MAX_BYTES
): HorseRequestAllowanceMetrics {
  const pendingValues: unknown[] = [value];
  const pendingDepths: number[] = [0];
  let bytes = 256;
  let nodes = 0;
  while (pendingValues.length) {
    if (++nodes > HORSE_REQUEST_MAX_NODES || bytes > maximum) throw new HorseRequestCapacityError();
    const item = pendingValues.pop()!;
    const depth = pendingDepths.pop()!;
    if (depth > 64) throw new HorseRequestCapacityError();
    if (typeof item === 'string') bytes += 6 * item.length + 16;
    else if (item === null || typeof item !== 'object') {
      if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint')
        throw new HorseRequestCapacityError();
      bytes += 16;
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
        throw new HorseRequestCapacityError();
      bytes += 64;
      if (Array.isArray(item) && item.length > HORSE_REQUEST_MAX_NODES)
        throw new HorseRequestCapacityError();
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        bytes += 6 * key.length + 32;
        if (bytes > maximum || pendingValues.length >= HORSE_REQUEST_MAX_NODES)
          throw new HorseRequestCapacityError();
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) throw new HorseRequestCapacityError();
        pendingValues.push(descriptor.value);
        pendingDepths.push(depth + 1);
      }
    }
  }
  if (bytes > maximum) throw new HorseRequestCapacityError();
  return { bytes, nodes };
}

/**
 * Combine allowance metrics for two disjoint top-level plain-object spreads
 * `{ ...base, ...overlay }` without re-walking the already-validated `base`
 * tree. Subtracting 320 bytes (256 base + 64 root object) and 1 root node
 * produces the exact allowance when keys are disjoint, and a conservative
 * upper bound if any top-level key overlaps (incident 1e532243).
 */
export function combineHorseRequestAllowanceMetrics(
  base: HorseRequestAllowanceMetrics,
  overlay: HorseRequestAllowanceMetrics
): HorseRequestAllowanceMetrics {
  return {
    bytes: base.bytes + overlay.bytes - 320,
    nodes: base.nodes + overlay.nodes - 1,
  };
}

export function horseRequestAllowance(value: unknown, maximum = HORSE_REQUEST_MAX_BYTES): number {
  return horseRequestAllowanceMetrics(value, maximum).bytes;
}

type Plan = { pending: number; admitted: number; terminal: boolean };
type Claim = { bytes: number; type: HorseDecisionJobRequest['type']; fastId?: number };

/** One client owns this ledger. Every admitted FAST reserves both effect slots
 * before it can issue a plan, so an ordinary backlog cannot evict accepted work. */
export class HorseRequestRetentionBudget {
  private readonly claims = new Map<number, Claim>();
  private readonly plans = new Map<number, Plan>();
  private bytes = 0;
  private ordinary = 0;
  private refused = 0;

  reserve(request: HorseDecisionJobRequest, prevalidated?: HorseRequestAllowanceMetrics): void {
    try {
      const effect =
        request.type === 'COMMIT_DECISION_EFFECTS' || request.type === 'RETIRE_DECISION_EFFECTS';
      const limit = effect ? EFFECT_BYTES : HORSE_REQUEST_MAX_BYTES;
      let bytes: number;
      if (prevalidated !== undefined) {
        if (
          !Number.isSafeInteger(prevalidated.bytes) ||
          !Number.isSafeInteger(prevalidated.nodes) ||
          prevalidated.bytes < 256 ||
          prevalidated.bytes > limit ||
          prevalidated.nodes < 1 ||
          prevalidated.nodes > HORSE_REQUEST_MAX_NODES
        ) {
          throw new HorseRequestCapacityError();
        }
        bytes = prevalidated.bytes;
      } else {
        bytes = horseRequestAllowance(request, limit);
      }
      if (this.claims.has(request.requestId)) throw new HorseRequestCapacityError();
      if (effect) {
        const fastId = request.planBinding.fastRequestId;
        const plan = this.plans.get(fastId);
        if (!plan || plan.terminal || plan.admitted >= 2) throw new HorseRequestCapacityError();
        plan.pending++;
        plan.admitted++;
        this.claims.set(request.requestId, { bytes: 0, type: request.type, fastId });
        return;
      }
      const fast = request.type === 'DECIDE_FAST';
      const reserved = fast ? PLAN_RESERVE : 0;
      if (
        this.ordinary >= HORSE_REQUEST_MAX_PENDING ||
        this.bytes + bytes + reserved > HORSE_REQUEST_RETAINED_BYTES ||
        (fast && this.plans.size >= HORSE_REQUEST_MAX_PLANS)
      )
        throw new HorseRequestCapacityError();
      this.claims.set(request.requestId, { bytes, type: request.type });
      this.ordinary++;
      this.bytes += bytes + reserved;
      if (fast) this.plans.set(request.requestId, { pending: 0, admitted: 0, terminal: false });
    } catch (error) {
      this.refused++;
      throw error;
    }
  }

  release(requestId: number, keepIssuedPlan = false, terminalEffect = false): void {
    const claim = this.claims.get(requestId);
    if (!claim) return;
    this.claims.delete(requestId);
    this.bytes -= claim.bytes;
    if (claim.fastId !== undefined) {
      const plan = this.plans.get(claim.fastId);
      if (plan) {
        plan.pending--;
        if (terminalEffect) plan.terminal = true;
        if (plan.terminal && plan.pending === 0) this.releasePlan(claim.fastId);
      }
    } else {
      this.ordinary--;
      if (claim.type === 'DECIDE_FAST' && !keepIssuedPlan) this.releasePlan(requestId);
    }
  }

  private releasePlan(id: number): void {
    if (this.plans.delete(id)) this.bytes -= PLAN_RESERVE;
  }

  releaseTerminatedWorker(): void {
    this.claims.clear();
    this.plans.clear();
    this.bytes = 0;
    this.ordinary = 0;
  }

  status() {
    return {
      retainedRequestBytes: this.bytes,
      retainedRequestLimitBytes: HORSE_REQUEST_RETAINED_BYTES,
      pendingPlanReservations: this.plans.size,
      requestCapacityRefusals: this.refused,
    };
  }
}
