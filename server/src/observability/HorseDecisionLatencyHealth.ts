/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PER-WORKER >100 ms STARVATION LATENCY BREAKDOWN (/health, read-only)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure read-only observability over live Horse FAST decision compute times
 * and policy-graph node timings. Exposed on GET /health under
 * `horseDecisionLatency` so operators can spot >100 ms worker starvation and
 * the dominant `phase15_node_*` hot node in real time without waiting for the
 * minute flush or a SQL query.
 *
 * DESIGN INVARIANTS
 * - Bounded O(1) memory: fixed 30-slot ring buffer (10 s buckets over a 5 min
 *   rolling window), capped worker slots (0..15), closed canonical variant
 *   set (10 keys), and closed `phase15_node_*` hot-node set (11 keys).
 * - Zero Horse decision impact: recorded after `decideFast` resolves inside
 *   `horseDecision/lane.ts` (outside `horseDecisionClosure()`), never read on
 *   the decision path, never throws, never alters routing readiness (HTTP 200).
 * - Threshold matches RELEASE-VERIFY's exact 1% bin alert threshold:
 *   `starvationAlert` is true when any variant has >= 100 samples in the
 *   rolling window and strictly > 1.0% of those samples exceeded 100 ms.
 */

export const HORSE_DECISION_LATENCY_WINDOW_MS = 5 * 60_000;
export const HORSE_DECISION_LATENCY_BUCKET_MS = 10_000;
export const HORSE_DECISION_LATENCY_BUCKET_COUNT =
  HORSE_DECISION_LATENCY_WINDOW_MS / HORSE_DECISION_LATENCY_BUCKET_MS;
export const HORSE_DECISION_LATENCY_THRESHOLD_MS = 100;
export const HORSE_DECISION_STARVATION_MIN_SAMPLES = 100;
export const HORSE_DECISION_STARVATION_ALERT_PCT = 1.0;
export const HORSE_DECISION_LATENCY_MAX_WORKERS = 16;

export const HORSE_DECISION_LATENCY_VARIANTS = Object.freeze([
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flo8',
  'flh',
  'short_deck',
  'pineapple',
  'other',
] as const);

export type HorseDecisionLatencyVariant = (typeof HORSE_DECISION_LATENCY_VARIANTS)[number];

export const HORSE_DECISION_POLICY_NODES = Object.freeze([
  'reference',
  'reference_legality',
  'variant_policy',
  'tournament_utility',
  'tournament_continuation',
  'variant_utility_guard',
  'joint_policy',
  'corrective_policy',
  'wager_rules',
  'timing',
] as const);

const VARIANT_SET: ReadonlySet<string> = new Set(HORSE_DECISION_LATENCY_VARIANTS);
const POLICY_NODE_SET: ReadonlySet<string> = new Set(HORSE_DECISION_POLICY_NODES);

export interface HorseDecisionPolicyTransitionTiming {
  readonly node: string;
  readonly elapsedMs: number;
}

export interface HorseDecisionLatencySampleInput {
  workerIndex: number;
  variant?: string;
  computeMs: number;
  transitions?: ReadonlyArray<HorseDecisionPolicyTransitionTiming>;
  hotNode?: string | null;
  nowMs?: number;
}

export interface HorseDecisionLatencyVariantSummary {
  readonly totalDecisions: number;
  readonly over100msCount: number;
  readonly over100msPct: number;
  readonly maxMs: number;
  readonly topHotNode: string | null;
  readonly starvationAlert: boolean;
}

export interface HorseDecisionLatencyWorkerSummary {
  readonly workerIndex: number;
  readonly totalDecisions: number;
  readonly over100msCount: number;
  readonly over100msPct: number;
  readonly maxMs: number;
  readonly topHotNode: string | null;
  readonly starvationAlert: boolean;
  readonly byVariant: Readonly<Record<string, HorseDecisionLatencyVariantSummary>>;
}

export interface HorseDecisionLatencyHealthSnapshot {
  readonly windowMs: number;
  readonly thresholdMs: number;
  readonly alertMinSamples: number;
  readonly alertThresholdPct: number;
  readonly totalDecisions: number;
  readonly over100msCount: number;
  readonly over100msPct: number;
  readonly maxMs: number;
  readonly topHotNode: string | null;
  readonly starvationAlert: boolean;
  readonly alertedVariants: readonly string[];
  readonly byVariant: Readonly<Record<string, HorseDecisionLatencyVariantSummary>>;
  readonly workers: readonly HorseDecisionLatencyWorkerSummary[];
}

interface HotNodeAcc {
  over100msCount: number;
  totalMs: number;
  maxMs: number;
}

interface VariantAcc {
  totalDecisions: number;
  over100msCount: number;
  maxMs: number;
  hotNodes: Map<string, HotNodeAcc>;
}

interface WorkerAcc {
  totalDecisions: number;
  over100msCount: number;
  maxMs: number;
  variants: Map<HorseDecisionLatencyVariant, VariantAcc>;
  hotNodes: Map<string, HotNodeAcc>;
}

interface TimeSlot {
  bucketId: number;
  workers: Map<number, WorkerAcc>;
}

export function normalizeLatencyVariant(raw: string | undefined): HorseDecisionLatencyVariant {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!v) return 'nlh';
  if (VARIANT_SET.has(v)) return v as HorseDecisionLatencyVariant;
  if (v === 'holdem' || v === 'nlhe' || v === 'texas_holdem') return 'nlh';
  if (v === 'omaha' || v === 'plo') return 'plo4';
  if (v === 'plo_5' || v === 'omaha5') return 'plo5';
  if (v === 'plo_6' || v === 'omaha6') return 'plo6';
  if (v === 'plo_8' || v === 'omaha_hi_lo' || v === 'omaha8') return 'plo8';
  if (v === 'flo_8' || v === 'limit_omaha_hi_lo') return 'flo8';
  if (v === 'shortdeck' || v === '6+' || v === 'six_plus') return 'short_deck';
  if (v === 'crazy_pineapple') return 'pineapple';
  if (v === 'limit_holdem') return 'flh';
  return 'other';
}

export function normalizeHotNode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const bare = trimmed.startsWith('phase15_node_')
    ? trimmed.slice('phase15_node_'.length)
    : trimmed;
  if (POLICY_NODE_SET.has(bare)) return `phase15_node_${bare}`;
  return 'phase15_node_other';
}

export function selectHotNodeFromTransitions(
  transitions: ReadonlyArray<HorseDecisionPolicyTransitionTiming> | undefined
): { hotNode: string; elapsedMs: number } | null {
  if (!Array.isArray(transitions) || transitions.length === 0) return null;
  let bestNode: string | null = null;
  let bestMs = -1;
  for (const t of transitions) {
    if (!t || typeof t.node !== 'string') continue;
    const ms = t.elapsedMs;
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) continue;
    if (ms > bestMs) {
      const normalized = normalizeHotNode(t.node);
      if (normalized) {
        bestMs = ms;
        bestNode = normalized;
      }
    }
  }
  return bestNode !== null && bestMs >= 0 ? { hotNode: bestNode, elapsedMs: bestMs } : null;
}

/** Exact integer-safe check for >= 100 samples and strictly > 1.0% over 100 ms. */
export function isStarvationAlert(totalDecisions: number, over100msCount: number): boolean {
  if (totalDecisions < HORSE_DECISION_STARVATION_MIN_SAMPLES) return false;
  return over100msCount * 100 > totalDecisions * HORSE_DECISION_STARVATION_ALERT_PCT;
}

function roundMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

function roundPct(over100msCount: number, totalDecisions: number): number {
  if (totalDecisions <= 0 || over100msCount <= 0) return 0;
  return Math.round((over100msCount / totalDecisions) * 100_000) / 1000;
}

function addHotNode(map: Map<string, HotNodeAcc>, hotNode: string, elapsedMs: number): void {
  const cur = map.get(hotNode);
  if (cur) {
    cur.over100msCount += 1;
    cur.totalMs += elapsedMs;
    if (elapsedMs > cur.maxMs) cur.maxMs = elapsedMs;
  } else {
    map.set(hotNode, {
      over100msCount: 1,
      totalMs: elapsedMs,
      maxMs: elapsedMs,
    });
  }
}

function mergeHotNodes(target: Map<string, HotNodeAcc>, source: Map<string, HotNodeAcc>): void {
  for (const [node, src] of source) {
    const cur = target.get(node);
    if (cur) {
      cur.over100msCount += src.over100msCount;
      cur.totalMs += src.totalMs;
      if (src.maxMs > cur.maxMs) cur.maxMs = src.maxMs;
    } else {
      target.set(node, {
        over100msCount: src.over100msCount,
        totalMs: src.totalMs,
        maxMs: src.maxMs,
      });
    }
  }
}

function pickTopHotNode(map: Map<string, HotNodeAcc>): string | null {
  let bestNode: string | null = null;
  let bestCount = -1;
  let bestTotalMs = -1;
  let bestMaxMs = -1;
  for (const [node, acc] of map) {
    if (acc.over100msCount <= 0) continue;
    if (
      acc.over100msCount > bestCount ||
      (acc.over100msCount === bestCount && acc.totalMs > bestTotalMs) ||
      (acc.over100msCount === bestCount && acc.totalMs === bestTotalMs && acc.maxMs > bestMaxMs) ||
      (acc.over100msCount === bestCount &&
        acc.totalMs === bestTotalMs &&
        acc.maxMs === bestMaxMs &&
        (bestNode === null || node < bestNode))
    ) {
      bestNode = node;
      bestCount = acc.over100msCount;
      bestTotalMs = acc.totalMs;
      bestMaxMs = acc.maxMs;
    }
  }
  return bestNode;
}

function normalizeWorkerIndex(raw: number): number | null {
  if (!Number.isInteger(raw) || raw < 0) return null;
  if (raw >= HORSE_DECISION_LATENCY_MAX_WORKERS) {
    return HORSE_DECISION_LATENCY_MAX_WORKERS - 1;
  }
  return raw;
}

export class HorseDecisionLatencyTracker {
  private readonly slots: TimeSlot[];

  constructor() {
    this.slots = Array.from({ length: HORSE_DECISION_LATENCY_BUCKET_COUNT }, () => ({
      bucketId: -1,
      workers: new Map<number, WorkerAcc>(),
    }));
  }

  record(input: HorseDecisionLatencySampleInput): void {
    const computeMs = input.computeMs;
    if (typeof computeMs !== 'number' || !Number.isFinite(computeMs) || computeMs < 0) return;
    const workerIndex = normalizeWorkerIndex(input.workerIndex);
    if (workerIndex === null) return;
    const nowMs =
      typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) && input.nowMs >= 0
        ? input.nowMs
        : Date.now();
    const bucketId = Math.floor(nowMs / HORSE_DECISION_LATENCY_BUCKET_MS);
    const slotIndex =
      ((bucketId % HORSE_DECISION_LATENCY_BUCKET_COUNT) + HORSE_DECISION_LATENCY_BUCKET_COUNT) %
      HORSE_DECISION_LATENCY_BUCKET_COUNT;
    const slot = this.slots[slotIndex]!;
    if (bucketId < slot.bucketId) {
      // Never let a late/out-of-order timestamp clobber a newer bucket.
      return;
    }
    if (slot.bucketId !== bucketId) {
      slot.bucketId = bucketId;
      slot.workers.clear();
    }

    let worker = slot.workers.get(workerIndex);
    if (!worker) {
      worker = {
        totalDecisions: 0,
        over100msCount: 0,
        maxMs: 0,
        variants: new Map(),
        hotNodes: new Map(),
      };
      slot.workers.set(workerIndex, worker);
    }

    const variant = normalizeLatencyVariant(input.variant);
    let variantAcc = worker.variants.get(variant);
    if (!variantAcc) {
      variantAcc = {
        totalDecisions: 0,
        over100msCount: 0,
        maxMs: 0,
        hotNodes: new Map(),
      };
      worker.variants.set(variant, variantAcc);
    }

    const isOver100 = computeMs > HORSE_DECISION_LATENCY_THRESHOLD_MS;

    worker.totalDecisions += 1;
    variantAcc.totalDecisions += 1;
    if (computeMs > worker.maxMs) worker.maxMs = computeMs;
    if (computeMs > variantAcc.maxMs) variantAcc.maxMs = computeMs;

    if (isOver100) {
      worker.over100msCount += 1;
      variantAcc.over100msCount += 1;
      const fromTransitions = selectHotNodeFromTransitions(input.transitions);
      const hotNode = fromTransitions?.hotNode ?? normalizeHotNode(input.hotNode);
      const hotMs = fromTransitions?.elapsedMs ?? computeMs;
      if (hotNode) {
        addHotNode(worker.hotNodes, hotNode, hotMs);
        addHotNode(variantAcc.hotNodes, hotNode, hotMs);
      }
    }
  }

  snapshot(nowMs: number = Date.now()): HorseDecisionLatencyHealthSnapshot {
    const safeNow = Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : Date.now();
    const currentBucketId = Math.floor(safeNow / HORSE_DECISION_LATENCY_BUCKET_MS);
    const oldestValidBucketId = currentBucketId - (HORSE_DECISION_LATENCY_BUCKET_COUNT - 1);

    let totalDecisions = 0;
    let over100msCount = 0;
    let maxMs = 0;
    const totalHotNodes = new Map<string, HotNodeAcc>();
    const totalByVariant = new Map<HorseDecisionLatencyVariant, VariantAcc>();
    const mergedWorkers = new Map<number, WorkerAcc>();

    for (const slot of this.slots) {
      if (slot.bucketId < oldestValidBucketId || slot.bucketId > currentBucketId) continue;
      for (const [workerIndex, srcWorker] of slot.workers) {
        totalDecisions += srcWorker.totalDecisions;
        over100msCount += srcWorker.over100msCount;
        if (srcWorker.maxMs > maxMs) maxMs = srcWorker.maxMs;
        mergeHotNodes(totalHotNodes, srcWorker.hotNodes);

        let dstWorker = mergedWorkers.get(workerIndex);
        if (!dstWorker) {
          dstWorker = {
            totalDecisions: 0,
            over100msCount: 0,
            maxMs: 0,
            variants: new Map(),
            hotNodes: new Map(),
          };
          mergedWorkers.set(workerIndex, dstWorker);
        }
        dstWorker.totalDecisions += srcWorker.totalDecisions;
        dstWorker.over100msCount += srcWorker.over100msCount;
        if (srcWorker.maxMs > dstWorker.maxMs) dstWorker.maxMs = srcWorker.maxMs;
        mergeHotNodes(dstWorker.hotNodes, srcWorker.hotNodes);

        for (const [variant, srcVar] of srcWorker.variants) {
          let dstVar = dstWorker.variants.get(variant);
          if (!dstVar) {
            dstVar = {
              totalDecisions: 0,
              over100msCount: 0,
              maxMs: 0,
              hotNodes: new Map(),
            };
            dstWorker.variants.set(variant, dstVar);
          }
          dstVar.totalDecisions += srcVar.totalDecisions;
          dstVar.over100msCount += srcVar.over100msCount;
          if (srcVar.maxMs > dstVar.maxMs) dstVar.maxMs = srcVar.maxMs;
          mergeHotNodes(dstVar.hotNodes, srcVar.hotNodes);

          let fleetVar = totalByVariant.get(variant);
          if (!fleetVar) {
            fleetVar = {
              totalDecisions: 0,
              over100msCount: 0,
              maxMs: 0,
              hotNodes: new Map(),
            };
            totalByVariant.set(variant, fleetVar);
          }
          fleetVar.totalDecisions += srcVar.totalDecisions;
          fleetVar.over100msCount += srcVar.over100msCount;
          if (srcVar.maxMs > fleetVar.maxMs) fleetVar.maxMs = srcVar.maxMs;
          mergeHotNodes(fleetVar.hotNodes, srcVar.hotNodes);
        }
      }
    }

    const alertedVariants: string[] = [];
    const byVariant: Record<string, HorseDecisionLatencyVariantSummary> = {};
    for (const variant of [...totalByVariant.keys()].sort()) {
      const acc = totalByVariant.get(variant)!;
      const alert = isStarvationAlert(acc.totalDecisions, acc.over100msCount);
      if (alert) alertedVariants.push(variant);
      byVariant[variant] = Object.freeze({
        totalDecisions: acc.totalDecisions,
        over100msCount: acc.over100msCount,
        over100msPct: roundPct(acc.over100msCount, acc.totalDecisions),
        maxMs: roundMs(acc.maxMs),
        topHotNode: pickTopHotNode(acc.hotNodes),
        starvationAlert: alert,
      });
    }

    const workers: HorseDecisionLatencyWorkerSummary[] = [];
    for (const workerIndex of [...mergedWorkers.keys()].sort((a, b) => a - b)) {
      const acc = mergedWorkers.get(workerIndex)!;
      const workerByVariant: Record<string, HorseDecisionLatencyVariantSummary> = {};
      let workerAlert = false;
      for (const variant of [...acc.variants.keys()].sort()) {
        const vAcc = acc.variants.get(variant)!;
        const vAlert = isStarvationAlert(vAcc.totalDecisions, vAcc.over100msCount);
        if (vAlert) workerAlert = true;
        workerByVariant[variant] = Object.freeze({
          totalDecisions: vAcc.totalDecisions,
          over100msCount: vAcc.over100msCount,
          over100msPct: roundPct(vAcc.over100msCount, vAcc.totalDecisions),
          maxMs: roundMs(vAcc.maxMs),
          topHotNode: pickTopHotNode(vAcc.hotNodes),
          starvationAlert: vAlert,
        });
      }
      workers.push(
        Object.freeze({
          workerIndex,
          totalDecisions: acc.totalDecisions,
          over100msCount: acc.over100msCount,
          over100msPct: roundPct(acc.over100msCount, acc.totalDecisions),
          maxMs: roundMs(acc.maxMs),
          topHotNode: pickTopHotNode(acc.hotNodes),
          starvationAlert: workerAlert,
          byVariant: Object.freeze(workerByVariant),
        })
      );
    }

    return Object.freeze({
      windowMs: HORSE_DECISION_LATENCY_WINDOW_MS,
      thresholdMs: HORSE_DECISION_LATENCY_THRESHOLD_MS,
      alertMinSamples: HORSE_DECISION_STARVATION_MIN_SAMPLES,
      alertThresholdPct: HORSE_DECISION_STARVATION_ALERT_PCT,
      totalDecisions,
      over100msCount,
      over100msPct: roundPct(over100msCount, totalDecisions),
      maxMs: roundMs(maxMs),
      topHotNode: pickTopHotNode(totalHotNodes),
      starvationAlert: alertedVariants.length > 0,
      alertedVariants: Object.freeze(alertedVariants),
      byVariant: Object.freeze(byVariant),
      workers: Object.freeze(workers),
    });
  }

  reset(): void {
    for (const slot of this.slots) {
      slot.bucketId = -1;
      slot.workers.clear();
    }
  }

  /** Test inspection helper: active ring-buffer slot count (always fixed). */
  slotCapacity(): number {
    return this.slots.length;
  }
}

const processTracker = new HorseDecisionLatencyTracker();

/** Record one completed live Horse FAST decision into the 5-minute rolling window. Never throws. */
export function recordHorseDecisionLatencySample(input: HorseDecisionLatencySampleInput): void {
  try {
    processTracker.record(input);
  } catch {
    /* read-only latency observability must never interrupt a decision */
  }
}

/** Synchronous, immutable, read-only /health snapshot of per-worker >100 ms starvation. */
export function horseDecisionLatencyHealth(
  nowMs: number = Date.now()
): HorseDecisionLatencyHealthSnapshot {
  return processTracker.snapshot(nowMs);
}

/** Tests only: clear process-wide rolling latency buckets. */
export function resetHorseDecisionLatencyForTest(): void {
  processTracker.reset();
}
