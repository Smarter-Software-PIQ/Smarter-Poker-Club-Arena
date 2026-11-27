import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetGapBalanceMetricsForTests,
  gapBalancePrometheusLines,
  recordBoundaryPlanOutcome,
  recordGapBalanceParkDwell,
} from './gapBalanceMetrics.js';

describe('gap-balance park dwell and boundary-plan Prometheus telemetry (1e532243)', () => {
  beforeEach(() => {
    __resetGapBalanceMetricsForTests();
  });

  it('zero-seeds every gauge, histogram bucket, and counter on cold start with zero per-table cardinality', () => {
    const out = gapBalancePrometheusLines({ parked: 0, oldestMs: 0 }).join('\n');
    expect(out).toContain('poker_tournament_gap_balance_parked_sources 0');
    expect(out).toContain('poker_tournament_gap_balance_parked_oldest_ms 0');
    for (const outcome of ['moved', 'released', 'deferred']) {
      expect(out).toContain(
        `poker_tournament_gap_balance_park_dwell_ms_bucket{outcome="${outcome}",le="100"} 0`
      );
      expect(out).toContain(
        `poker_tournament_gap_balance_park_dwell_ms_count{outcome="${outcome}"} 0`
      );
      expect(out).toContain(
        `poker_tournament_gap_balance_park_dwell_ms_sum{outcome="${outcome}"} 0`
      );
    }
    for (const outcome of ['hit', 'miss_absent', 'miss_epoch', 'miss_age', 'miss_source_missing']) {
      expect(out).toContain(
        `poker_tournament_boundary_plan_outcomes_total{outcome="${outcome}"} 0`
      );
    }
  });

  it('records cumulative park dwell histograms and boundary-plan hit/miss counts accurately', () => {
    recordGapBalanceParkDwell('moved', 45);
    recordGapBalanceParkDwell('moved', 600);
    recordGapBalanceParkDwell('released', 15);
    recordBoundaryPlanOutcome('hit');
    recordBoundaryPlanOutcome('hit');
    recordBoundaryPlanOutcome('miss_epoch');

    const out = gapBalancePrometheusLines({ parked: 2, oldestMs: 312.7 }).join('\n');
    expect(out).toContain('poker_tournament_gap_balance_parked_sources 2');
    expect(out).toContain('poker_tournament_gap_balance_parked_oldest_ms 313');
    expect(out).toContain(
      'poker_tournament_gap_balance_park_dwell_ms_bucket{outcome="moved",le="50"} 1'
    );
    expect(out).toContain(
      'poker_tournament_gap_balance_park_dwell_ms_bucket{outcome="moved",le="1000"} 2'
    );
    expect(out).toContain('poker_tournament_gap_balance_park_dwell_ms_sum{outcome="moved"} 645');
    expect(out).toContain('poker_tournament_gap_balance_park_dwell_ms_count{outcome="moved"} 2');
    expect(out).toContain('poker_tournament_gap_balance_park_dwell_ms_count{outcome="released"} 1');
    expect(out).toContain('poker_tournament_boundary_plan_outcomes_total{outcome="hit"} 2');
    expect(out).toContain('poker_tournament_boundary_plan_outcomes_total{outcome="miss_epoch"} 1');
  });
});
