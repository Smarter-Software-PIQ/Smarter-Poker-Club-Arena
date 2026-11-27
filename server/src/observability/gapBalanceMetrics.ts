/**
 * Bounded, always-on Prometheus telemetry for tournament gap-balance parked
 * source dwell time and hold-time boundary-plan hit/miss outcomes (1e532243).
 *
 * Every label is a closed enum with zero per-table or per-tournament
 * cardinality, and every series is zero-seeded on cold start so dashboards and
 * alert queries see stable series from process boot.
 */

export type GapBalanceParkOutcome = 'moved' | 'released' | 'deferred';

export type BoundaryPlanOutcome =
  | 'hit'
  | 'miss_absent'
  | 'miss_epoch'
  | 'miss_age'
  | 'miss_source_missing';

const PARK_DWELL_OUTCOMES: readonly GapBalanceParkOutcome[] = ['moved', 'released', 'deferred'];

const BOUNDARY_PLAN_OUTCOMES: readonly BoundaryPlanOutcome[] = [
  'hit',
  'miss_absent',
  'miss_epoch',
  'miss_age',
  'miss_source_missing',
];

export const GAP_BALANCE_PARK_DWELL_BUCKETS_MS: readonly number[] = [
  10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
];

interface HistogramState {
  readonly buckets: number[];
  count: number;
  sum: number;
}

const makeHistogram = (): HistogramState => ({
  buckets: new Array(GAP_BALANCE_PARK_DWELL_BUCKETS_MS.length).fill(0),
  count: 0,
  sum: 0,
});

const parkDwellByOutcome: Record<GapBalanceParkOutcome, HistogramState> = {
  moved: makeHistogram(),
  released: makeHistogram(),
  deferred: makeHistogram(),
};

const boundaryPlanOutcomes: Record<BoundaryPlanOutcome, number> = {
  hit: 0,
  miss_absent: 0,
  miss_epoch: 0,
  miss_age: 0,
  miss_source_missing: 0,
};

export function recordGapBalanceParkDwell(outcome: GapBalanceParkOutcome, dwellMs: number): void {
  const safeMs = Number.isFinite(dwellMs) && dwellMs > 0 ? dwellMs : 0;
  const h = parkDwellByOutcome[outcome];
  h.count++;
  h.sum += safeMs;
  for (let i = 0; i < GAP_BALANCE_PARK_DWELL_BUCKETS_MS.length; i++) {
    if (safeMs <= GAP_BALANCE_PARK_DWELL_BUCKETS_MS[i]) h.buckets[i]++;
  }
}

export function recordBoundaryPlanOutcome(outcome: BoundaryPlanOutcome): void {
  boundaryPlanOutcomes[outcome]++;
}

export function gapBalancePrometheusLines(summary: { parked: number; oldestMs: number }): string[] {
  const lines: string[] = [
    '# HELP poker_tournament_gap_balance_parked_sources Tournament tables currently parked between hands waiting for gap-balance move or release',
    '# TYPE poker_tournament_gap_balance_parked_sources gauge',
    `poker_tournament_gap_balance_parked_sources ${Math.max(0, summary.parked)}`,
    '# HELP poker_tournament_gap_balance_parked_oldest_ms Milliseconds the longest currently parked gap-balance source table has been waiting; 0 when none',
    '# TYPE poker_tournament_gap_balance_parked_oldest_ms gauge',
    `poker_tournament_gap_balance_parked_oldest_ms ${Math.max(0, Math.round(summary.oldestMs))}`,
    '# HELP poker_tournament_gap_balance_park_dwell_ms Milliseconds a fenced gap-balance source table spent parked before moving, releasing, or deferring',
    '# TYPE poker_tournament_gap_balance_park_dwell_ms histogram',
  ];

  for (const outcome of PARK_DWELL_OUTCOMES) {
    const h = parkDwellByOutcome[outcome];
    for (let i = 0; i < GAP_BALANCE_PARK_DWELL_BUCKETS_MS.length; i++) {
      lines.push(
        `poker_tournament_gap_balance_park_dwell_ms_bucket{outcome="${outcome}",le="${GAP_BALANCE_PARK_DWELL_BUCKETS_MS[i]}"} ${h.buckets[i]}`
      );
    }
    lines.push(
      `poker_tournament_gap_balance_park_dwell_ms_bucket{outcome="${outcome}",le="+Inf"} ${h.count}`
    );
    lines.push(`poker_tournament_gap_balance_park_dwell_ms_sum{outcome="${outcome}"} ${h.sum}`);
    lines.push(`poker_tournament_gap_balance_park_dwell_ms_count{outcome="${outcome}"} ${h.count}`);
  }

  lines.push(
    '# HELP poker_tournament_boundary_plan_outcomes_total Outcomes of hold-time prepared boundary balance plan lookups at gap-balance park edges',
    '# TYPE poker_tournament_boundary_plan_outcomes_total counter'
  );
  for (const outcome of BOUNDARY_PLAN_OUTCOMES) {
    lines.push(
      `poker_tournament_boundary_plan_outcomes_total{outcome="${outcome}"} ${boundaryPlanOutcomes[outcome]}`
    );
  }
  return lines;
}

/** Test-only reset for isolated assertions. */
export function __resetGapBalanceMetricsForTests(): void {
  for (const outcome of PARK_DWELL_OUTCOMES) {
    parkDwellByOutcome[outcome].buckets.fill(0);
    parkDwellByOutcome[outcome].count = 0;
    parkDwellByOutcome[outcome].sum = 0;
  }
  for (const outcome of BOUNDARY_PLAN_OUTCOMES) {
    boundaryPlanOutcomes[outcome] = 0;
  }
}
