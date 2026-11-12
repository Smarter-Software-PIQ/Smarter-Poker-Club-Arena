/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRAIN TELEMETRY — proof of receipt (Dan 2026-08-26)
 * ═══════════════════════════════════════════════════════════════════════════
 * "Verify that all changes we make to the brain ACTUALLY MAKE IT to the
 *  horses — that they receive, utilize and improve on the new logic."
 *
 * A deploy proves the code is in the container. It does not prove a layer
 * ever FIRES at a live table — the house failure mode is precisely the
 * feature that looks deployed and never executes (the league that never ran,
 * the c-bet upgrade gated off by a stale flag, the conditioning branch dead
 * for 17% of flops). This module is the instrument: every live decision
 * stamps the layers that actually executed, a flush service aggregates them
 * per day into horse_brain_telemetry, the daily audit raises a CRITICAL
 * layer_silent finding when a deployed layer stops firing, and the admin
 * panel shows the fire counts next to the hand reviews.
 *
 * DESIGN CONSTRAINTS
 * - Live decisions only: the gate is opts.telemetry === true, set solely by
 *   scheduleHorseAction. League/benchmark/test decisions never count — a
 *   nightly self-play burst would otherwise fake "the fleet uses layer X".
 * - Zero overhead when off, O(1) map increment when on. No IO here; the
 *   flush lives in services/BrainTelemetryFlush.ts.
 * - Decisions are synchronous and single-threaded; a plain Map is safe.
 */

const fires = new Map<string, number>();
let enabled = false;

/** Armed once by the flush service at engine boot. */
export function enableBrainTelemetry(): void {
  enabled = true;
}

/** Count one execution of a brain feature for today. No-op until enabled. */
export function noteFire(feature: string): void {
  if (!enabled) return;
  fires.set(feature, (fires.get(feature) ?? 0) + 1);
}

/** True when the caller opted this decision into telemetry. */
export function telemetryOn(opts: { telemetry?: boolean } | undefined): boolean {
  return enabled && opts?.telemetry === true;
}

/** Drain the accumulated counters (flush service + tests). */
export function drainFires(): Array<{ feature: string; fires: number }> {
  const out: Array<{ feature: string; fires: number }> = [];
  for (const [feature, n] of fires) out.push({ feature, fires: n });
  fires.clear();
  return out;
}

/** Merge rows back after a failed flush so nothing is lost. */
export function restoreFires(rows: Array<{ feature: string; fires: number }>): void {
  for (const r of rows) fires.set(r.feature, (fires.get(r.feature) ?? 0) + r.fires);
}

// ═══════════════════════════════════════════════════════════════════════════
// DECISION LATENCY (Dan 2026-08-29)
// ═══════════════════════════════════════════════════════════════════════════
// "I WANT TO KNOW HOW LONG IT TAKES THEM TO IDENTIFY THEIR HAND, KNOW THE
//  BOARD, KNOW WHO THEY'RE PLAYING AGAINST ... HOW LONG IT TAKES FOR THEM TO
//  ACTUALLY COLLECT AND ANALYZE THAT INFORMATION IN REAL TIME."
//
// It could not be answered. The decision path carried a documented budget
// ("<15ms even for 6-card PLO", HorseLogic.ts) and NOTHING MEASURED IT. There
// was no timer, no deadline, no telemetry of duration anywhere in the engine —
// `performance.now()` appeared in exactly four places, all of them in an
// offline unit test. The only cost control was a fixed Monte Carlo iteration
// count per variant, which is an iteration budget, not a time budget: it never
// reads a clock, so a slow box simply takes longer and nobody learns.
//
// A budget nobody measures is a comment. This is the instrument.
//
// WHY A HISTOGRAM AND NOT A MEAN. The mean is the least interesting number
// here: every decision is fast until the one that is not, and a tail is what a
// player would actually feel. Fixed buckets keep it O(1) per decision with no
// allocation and no sorting — the measurement must not become the cost.

/** Upper edges in milliseconds. The last bucket is everything above 200ms. */
const LATENCY_BUCKET_MS = [1, 2, 5, 10, 15, 25, 50, 100, 200] as const;

interface LatencyAccumulator {
  samples: number;
  totalMs: number;
  maxMs: number;
  /** One counter per bucket, plus a final overflow slot. */
  buckets: number[];
}

const latency = new Map<string, LatencyAccumulator>();

function accumulatorFor(scope: string): LatencyAccumulator {
  let acc = latency.get(scope);
  if (!acc) {
    acc = {
      samples: 0,
      totalMs: 0,
      maxMs: 0,
      buckets: new Array(LATENCY_BUCKET_MS.length + 1).fill(0),
    };
    latency.set(scope, acc);
  }
  return acc;
}

/**
 * Record how long one live decision took, end to end.
 *
 * `scope` is the variant family, so a 6-card PLO decision (which runs the most
 * expensive Monte Carlo) is never averaged into a heads-up NLH one.
 */
export function noteDecisionMs(scope: string, ms: number): void {
  if (!enabled) return;
  if (!Number.isFinite(ms) || ms < 0) return;
  const acc = accumulatorFor(scope);
  acc.samples++;
  acc.totalMs += ms;
  if (ms > acc.maxMs) acc.maxMs = ms;
  let i = 0;
  while (i < LATENCY_BUCKET_MS.length && ms > LATENCY_BUCKET_MS[i]) i++;
  acc.buckets[i]++;
}

export interface LatencyRow {
  scope: string;
  samples: number;
  totalMs: number;
  maxMs: number;
  buckets: number[];
}

/**
 * A percentile read off the histogram.
 *
 * It returns the UPPER EDGE of the bucket the percentile falls in, so it is an
 * over-estimate by construction and never flatters the engine. `null` when
 * there is nothing to report, because a fabricated zero would read as "very
 * fast" — which is exactly the kind of confident wrong number this whole
 * module exists to stop.
 */
export function percentileMs(row: LatencyRow, p: number): number | null {
  if (!row || row.samples <= 0) return null;
  const target = row.samples * p;
  let seen = 0;
  for (let i = 0; i < row.buckets.length; i++) {
    seen += row.buckets[i];
    if (seen >= target) {
      return i < LATENCY_BUCKET_MS.length ? LATENCY_BUCKET_MS[i] : row.maxMs;
    }
  }
  return row.maxMs;
}

/** The bucket edges, so a reader can interpret the histogram. */
export function latencyBucketEdges(): readonly number[] {
  return LATENCY_BUCKET_MS;
}

/** Drain the accumulated latency (flush service + tests). */
export function drainDecisionLatency(): LatencyRow[] {
  const out: LatencyRow[] = [];
  for (const [scope, acc] of latency) {
    out.push({
      scope,
      samples: acc.samples,
      totalMs: acc.totalMs,
      maxMs: acc.maxMs,
      buckets: [...acc.buckets],
    });
  }
  latency.clear();
  return out;
}

/** Merge rows back after a failed flush so nothing is lost. */
export function restoreDecisionLatency(rows: LatencyRow[]): void {
  for (const r of rows) {
    const acc = accumulatorFor(r.scope);
    acc.samples += r.samples;
    acc.totalMs += r.totalMs;
    if (r.maxMs > acc.maxMs) acc.maxMs = r.maxMs;
    for (let i = 0; i < acc.buckets.length && i < r.buckets.length; i++) {
      acc.buckets[i] += r.buckets[i];
    }
  }
}

/** Read the live accumulator without draining it — for /health. */
export function peekDecisionLatency(): LatencyRow[] {
  const out: LatencyRow[] = [];
  for (const [scope, acc] of latency) {
    out.push({
      scope,
      samples: acc.samples,
      totalMs: acc.totalMs,
      maxMs: acc.maxMs,
      buckets: [...acc.buckets],
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE REAL-TIME WATCHCOUNTERS (/metrics + /health, Wave 2 #13B)
// ═══════════════════════════════════════════════════════════════════════════
// Pure in-memory counters with zero external runtime imports so BrainTelemetry
// remains pure inside HORSE_REFERENCE_DECISION_SOURCE_FILES closure checks.
// Worker isolates relay deltas to the main thread via drainBrainWatchcounterDeltas()
// -> mergeBrainWatchcounterDeltas(), and GameServer renders them once per scrape.

export type HorseWatchcounterMetric =
  | 'poker_horse_action_clamped_total'
  | 'poker_horse_plan_reevaluated_total'
  | 'poker_horse_legalizer_degraded_total'
  | 'poker_horse_street_prewarm_total'
  | 'poker_horse_telemetry_opportunities_total';

export const HORSE_WATCHCOUNTER_VARIANTS = [
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
] as const;

export type HorseWatchcounterVariant = (typeof HORSE_WATCHCOUNTER_VARIANTS)[number];

export const HORSE_WATCHCOUNTER_MODES = ['cash', 'tournament'] as const;
export type HorseWatchcounterMode = (typeof HORSE_WATCHCOUNTER_MODES)[number];

export const HORSE_ACTION_CLAMPED_REASONS = [
  'above_max_bet',
  'below_min_bet',
  'above_max_raise',
  'below_min_raise',
  'all_in_to_max_raise',
  'all_in_to_max_bet',
  'pot_limit_cap',
  'chip_unit_snap',
  'commit_wager_rules',
  'fixed_limit_capped_street',
  'v58_plo6_river_fold',
  'v58_plo6_river_raise_to_call',
  'v59_plo6_river_unpaired_fold',
  'v59_plo6_river_unpaired_raise_to_call',
  'plo_paired_board_fold',
  'v81_omaha_big_bet_call_fold',
  'v84_omaha_river_reraise_call_fold',
  'v87_deep_dive_discipline',
  'holdem_dominated_3bet_fold',
  'holdem_premium_preflop_raise',
  'holdem_no_four_bet_bluff',
  'holdem_four_bettor_continues',
  'holdem_premium_flat_deep_three_bet',
  'holdem_premium_postflop_bet',
  'default',
  'other',
] as const;

export const HORSE_PLAN_REEVALUATED_REASONS = [
  'flop_carry_forward',
  'turn_carry_forward',
  'river_carry_forward',
  'flop_float_takeaway',
  'turn_float_takeaway',
  'river_float_takeaway',
  'flop_scare_card_pivot',
  'turn_scare_card_pivot',
  'river_scare_card_pivot',
  'flop_multiway_shift',
  'turn_multiway_shift',
  'river_multiway_shift',
  'flop_unexpected_donk',
  'turn_unexpected_donk',
  'river_unexpected_donk',
  'flop_unexpected_raise',
  'turn_unexpected_raise',
  'river_unexpected_raise',
  'flop_raise_plan_overridden_by_equity',
  'turn_raise_plan_overridden_by_equity',
  'river_raise_plan_overridden_by_equity',
  'unexpected_donk_bet',
  'sizing_diverged',
  'invalidation_replan',
  'default',
  'other',
] as const;

export const HORSE_LEGALIZER_DEGRADED_REASONS = [
  'pot_or_cap_max_bet',
  'pot_or_cap_max_raise',
  'all_in_to_max_raise',
  'all_in_to_max_bet',
  'fixed_limit_capped_street',
  'promoted_shove_illegal',
  'controller_rejected',
  'feature_authority_refused',
  'brain_exception',
  'lightning_timeout',
  'min_raise_step',
  'default',
  'other',
] as const;

export const HORSE_STREET_PREWARM_REASONS = [
  'flop',
  'turn',
  'river',
  'flop_deal',
  'hit_flop',
  'hit_turn',
  'hit_river',
  'default',
  'other',
] as const;

/**
 * Denominators, each counted at one boundary and once per event:
 * - `decision_started`: the host asked the lane for a decision on the seat's
 *   own turn (a table turn, or a Lightning turn; never a Lightning early look).
 * - `decision_evaluated`: a decision worker finished one telemetry-on brain
 *   evaluation (DECIDE_FAST: table turns, Lightning turns and Lightning early
 *   looks). It is the denominator of the brain-stage clamps the same
 *   evaluation counts. A deep second look replays with telemetry off and is
 *   not counted. An evaluation whose answer is later fenced out still counts.
 * - `commit_evaluated`: a decision counted by `decision_started` reached the
 *   host's commit stage for its seat (the turn was still its own and the
 *   answer was about to be submitted). A turn that moved on first never
 *   counts, so started minus committed is the abandoned and superseded turns.
 */
export const HORSE_TELEMETRY_OPPORTUNITY_REASONS = [
  'decision_started',
  'decision_evaluated',
  'commit_evaluated',
  'continuation_plan_checked',
  'street_dealt',
  'default',
  'other',
] as const;

export interface HorseWatchcounterLabels {
  variant?: string;
  mode?: string;
  reason?: string;
}

export interface HorseWatchcounterEntry {
  metric: HorseWatchcounterMetric;
  variant: HorseWatchcounterVariant;
  mode: HorseWatchcounterMode;
  reason: string;
  value: number;
}

const WATCHCOUNTER_SPECS: ReadonlyArray<{
  metric: HorseWatchcounterMetric;
  help: string;
  seedReason: string;
  allowedReasons: ReadonlySet<string>;
}> = [
  {
    metric: 'poker_horse_action_clamped_total',
    help: 'Horse brain or commit-stage wager normalizations and rule clamps (closed lowercase labels: variant, mode, reason)',
    seedReason: 'above_max_raise',
    allowedReasons: new Set<string>(HORSE_ACTION_CLAMPED_REASONS),
  },
  {
    metric: 'poker_horse_plan_reevaluated_total',
    help: 'Horse multi-street continuation plans re-evaluated when live turn geometry or runout diverged (closed lowercase labels: variant, mode, reason)',
    seedReason: 'turn_scare_card_pivot',
    allowedReasons: new Set<string>(HORSE_PLAN_REEVALUATED_REASONS),
  },
  {
    metric: 'poker_horse_legalizer_degraded_total',
    help: 'Horse out-of-bounds wagers, capped streets, or rejected intents degraded to legal actions (closed lowercase labels: variant, mode, reason)',
    seedReason: 'pot_or_cap_max_raise',
    allowedReasons: new Set<string>(HORSE_LEGALIZER_DEGRADED_REASONS),
  },
  {
    metric: 'poker_horse_street_prewarm_total',
    help: 'Horse idle-time street board/texture/solver prewarm executions and cache hits (closed lowercase labels: variant, mode, reason)',
    seedReason: 'flop',
    allowedReasons: new Set<string>(HORSE_STREET_PREWARM_REASONS),
  },
  {
    metric: 'poker_horse_telemetry_opportunities_total',
    help: 'Horse decision, brain-evaluation, commit, continuation-plan, and street-deal opportunity denominators (closed lowercase labels: variant, mode, reason)',
    seedReason: 'decision_evaluated',
    allowedReasons: new Set<string>(HORSE_TELEMETRY_OPPORTUNITY_REASONS),
  },
];

const METRIC_BY_NAME = new Map(WATCHCOUNTER_SPECS.map((s) => [s.metric, s]));
const VARIANT_SET = new Set<string>(HORSE_WATCHCOUNTER_VARIANTS);

const watchcounters = new Map<string, HorseWatchcounterEntry>();
const watchcounterDeltas = new Map<string, HorseWatchcounterEntry>();
/**
 * Main-thread vs worker-isolate delta guard:
 * On the main thread, increments land directly in `watchcounters` and nothing drains
 * `watchcounterDeltas`. Only worker isolates (or explicit relay tests) arm delta buffering,
 * bounding delta memory strictly to drained worker cycles.
 */
let workerWatchcounterRelayArmed = false;
const MAX_WATCHCOUNTER_DELTA_SERIES = 512;

export function armWorkerWatchcounterRelay(armed = true): void {
  workerWatchcounterRelayArmed = armed;
  if (!armed) watchcounterDeltas.clear();
}

export function normalizeWatchcounterVariant(raw: string | undefined): HorseWatchcounterVariant {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!v) return 'nlh';
  if (VARIANT_SET.has(v)) return v as HorseWatchcounterVariant;
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

export function normalizeWatchcounterMode(raw: string | undefined): HorseWatchcounterMode {
  const m = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (m === 'tournament' || m === 'mtt' || m === 'sng' || m === 'spin' || m === 'hu_sng') {
    return 'tournament';
  }
  return 'cash';
}

export function normalizeWatchcounterReason(
  metric: HorseWatchcounterMetric,
  raw: string | undefined
): string {
  const spec = METRIC_BY_NAME.get(metric);
  if (!spec) return 'other';
  const r =
    typeof raw === 'string'
      ? raw
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
      : '';
  if (!r) return 'default';
  if (spec.allowedReasons.has(r)) return r;
  // Map dynamic street-prefixed continuation reasons into closed canonical buckets
  if (metric === 'poker_horse_plan_reevaluated_total') {
    const prefix = r.startsWith('flop_')
      ? 'flop_'
      : r.startsWith('turn_')
        ? 'turn_'
        : r.startsWith('river_')
          ? 'river_'
          : '';
    if (prefix) {
      if (r.includes('scare')) return `${prefix}scare_card_pivot`;
      if (r.includes('multiway')) return `${prefix}multiway_shift`;
      if (r.includes('donk')) return `${prefix}unexpected_donk`;
      if (r.includes('raise_plan_overridden')) return `${prefix}raise_plan_overridden_by_equity`;
      if (r.includes('raise')) return `${prefix}unexpected_raise`;
      if (r.includes('float')) return `${prefix}float_takeaway`;
      if (r.includes('carry') || r.includes('retained')) return `${prefix}carry_forward`;
    }
    return 'invalidation_replan';
  }
  return 'other';
}

export function seedBrainWatchcounters(): void {
  const seedVariants: readonly HorseWatchcounterVariant[] = [
    'nlh',
    'plo4',
    'plo5',
    'plo6',
    'plo8',
    'flo8',
    'short_deck',
    'pineapple',
  ];
  for (const spec of WATCHCOUNTER_SPECS) {
    for (const variant of seedVariants) {
      for (const mode of HORSE_WATCHCOUNTER_MODES) {
        const key = `${spec.metric}|${variant}|${mode}|${spec.seedReason}`;
        if (!watchcounters.has(key)) {
          watchcounters.set(key, {
            metric: spec.metric,
            variant,
            mode,
            reason: spec.seedReason,
            value: 0,
          });
        }
      }
    }
  }
}

function recordWatchcounter(
  metric: HorseWatchcounterMetric,
  variantOrLabels: string | HorseWatchcounterLabels,
  modeArg?: string | number,
  reasonArg?: string,
  countArg?: number,
  recordDelta = workerWatchcounterRelayArmed
): void {
  let variant: HorseWatchcounterVariant;
  let mode: HorseWatchcounterMode;
  let reason: string;
  let count: number;
  if (typeof variantOrLabels === 'object' && variantOrLabels !== null) {
    variant = normalizeWatchcounterVariant(variantOrLabels.variant);
    mode = normalizeWatchcounterMode(variantOrLabels.mode);
    reason = normalizeWatchcounterReason(metric, variantOrLabels.reason);
    count = typeof modeArg === 'number' ? modeArg : 1;
  } else {
    variant = normalizeWatchcounterVariant(variantOrLabels);
    mode = typeof modeArg === 'string' ? normalizeWatchcounterMode(modeArg) : 'cash';
    reason = normalizeWatchcounterReason(metric, reasonArg);
    count = typeof modeArg === 'number' ? modeArg : (countArg ?? 1);
  }
  if (!Number.isFinite(count) || count <= 0) return;
  const key = `${metric}|${variant}|${mode}|${reason}`;
  const cur = watchcounters.get(key);
  if (cur) {
    cur.value += count;
  } else {
    watchcounters.set(key, { metric, variant, mode, reason, value: count });
  }
  if (recordDelta) {
    const delta = watchcounterDeltas.get(key);
    if (delta) {
      delta.value += count;
    } else if (watchcounterDeltas.size < MAX_WATCHCOUNTER_DELTA_SERIES) {
      watchcounterDeltas.set(key, { metric, variant, mode, reason, value: count });
    }
  }
}

export function noteHorseActionClamped(
  variantOrLabels: string | HorseWatchcounterLabels,
  mode?: string | number,
  reason?: string,
  count?: number
): void {
  recordWatchcounter('poker_horse_action_clamped_total', variantOrLabels, mode, reason, count);
}

export function noteHorsePlanReevaluated(
  variantOrLabels: string | HorseWatchcounterLabels,
  mode?: string | number,
  reason?: string,
  count?: number
): void {
  recordWatchcounter('poker_horse_plan_reevaluated_total', variantOrLabels, mode, reason, count);
}

export function noteHorseLegalizerDegraded(
  variantOrLabels: string | HorseWatchcounterLabels,
  mode?: string | number,
  reason?: string,
  count?: number
): void {
  recordWatchcounter('poker_horse_legalizer_degraded_total', variantOrLabels, mode, reason, count);
}

export function noteHorseStreetPrewarm(
  variantOrLabels: string | HorseWatchcounterLabels,
  mode?: string | number,
  reason?: string,
  count?: number
): void {
  recordWatchcounter('poker_horse_street_prewarm_total', variantOrLabels, mode, reason, count);
}

export function noteHorseTelemetryOpportunity(
  variantOrLabels: string | HorseWatchcounterLabels,
  mode?: string | number,
  stage?: string,
  count?: number
): void {
  recordWatchcounter(
    'poker_horse_telemetry_opportunities_total',
    variantOrLabels,
    mode,
    stage,
    count
  );
}

/** Drain worker-side increments since the previous relay message. */
export function drainBrainWatchcounterDeltas(): HorseWatchcounterEntry[] {
  if (watchcounterDeltas.size === 0) return [];
  const out: HorseWatchcounterEntry[] = [];
  for (const entry of watchcounterDeltas.values()) {
    out.push({ ...entry });
  }
  watchcounterDeltas.clear();
  return out;
}

/** Merge worker-relayed increments into the main-thread process counters. */
export function mergeBrainWatchcounterDeltas(
  entries: ReadonlyArray<HorseWatchcounterEntry> | undefined | null
): void {
  if (!Array.isArray(entries) || entries.length === 0) return;
  for (const raw of entries) {
    if (!raw || typeof raw.metric !== 'string' || typeof raw.value !== 'number') continue;
    if (!METRIC_BY_NAME.has(raw.metric as HorseWatchcounterMetric)) continue;
    if (!Number.isFinite(raw.value) || raw.value <= 0) continue;
    const metric = raw.metric as HorseWatchcounterMetric;
    const variant = normalizeWatchcounterVariant(raw.variant);
    const mode = normalizeWatchcounterMode(raw.mode);
    const reason = normalizeWatchcounterReason(metric, raw.reason);
    const key = `${metric}|${variant}|${mode}|${reason}`;
    const cur = watchcounters.get(key);
    if (cur) {
      cur.value += raw.value;
    } else {
      watchcounters.set(key, {
        metric,
        variant,
        mode,
        reason,
        value: raw.value,
      });
    }
  }
}

/** Non-destructive snapshot for /health and tests. */
export function peekBrainWatchcounters(): Record<
  HorseWatchcounterMetric,
  { total: number; series: Array<{ variant: string; mode: string; reason: string; value: number }> }
> {
  const snapshot: Record<
    HorseWatchcounterMetric,
    {
      total: number;
      series: Array<{ variant: string; mode: string; reason: string; value: number }>;
    }
  > = {
    poker_horse_action_clamped_total: { total: 0, series: [] },
    poker_horse_plan_reevaluated_total: { total: 0, series: [] },
    poker_horse_legalizer_degraded_total: { total: 0, series: [] },
    poker_horse_street_prewarm_total: { total: 0, series: [] },
    poker_horse_telemetry_opportunities_total: { total: 0, series: [] },
  };
  for (const entry of watchcounters.values()) {
    const bucket = snapshot[entry.metric];
    bucket.total += entry.value;
    bucket.series.push({
      variant: entry.variant,
      mode: entry.mode,
      reason: entry.reason,
      value: entry.value,
    });
  }
  return snapshot;
}

/** Render Prometheus text-exposition blocks once per /metrics scrape. */
export function renderBrainWatchcountersPrometheus(): string[] {
  if (watchcounters.size === 0) {
    seedBrainWatchcounters();
  }
  const lines: string[] = [];
  for (const spec of WATCHCOUNTER_SPECS) {
    lines.push(`# HELP ${spec.metric} ${spec.help}`);
    lines.push(`# TYPE ${spec.metric} counter`);
    for (const entry of watchcounters.values()) {
      if (entry.metric !== spec.metric) continue;
      lines.push(
        `${spec.metric}{variant="${entry.variant}",mode="${entry.mode}",reason="${entry.reason}"} ${entry.value}`
      );
    }
  }
  return lines;
}

/** Reset live watchcounters in unit tests (arms relay for single-process delta tests and re-seeds zero series). */
export function resetBrainWatchcountersForTest(options?: { armRelay?: boolean }): void {
  watchcounters.clear();
  watchcounterDeltas.clear();
  workerWatchcounterRelayArmed = options?.armRelay ?? true;
  seedBrainWatchcounters();
}

seedBrainWatchcounters();
