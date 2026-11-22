import { describe, expect, it } from 'vitest';
import {
  HORSE_DECISION_LATENCY_BUCKET_COUNT,
  HORSE_DECISION_LATENCY_BUCKET_MS,
  HORSE_DECISION_LATENCY_MAX_WORKERS,
  HORSE_DECISION_LATENCY_THRESHOLD_MS,
  HORSE_DECISION_LATENCY_WINDOW_MS,
  HORSE_DECISION_STARVATION_ALERT_PCT,
  HORSE_DECISION_STARVATION_MIN_SAMPLES,
  HorseDecisionLatencyTracker,
  isStarvationAlert,
  normalizeHotNode,
  normalizeLatencyVariant,
  selectHotNodeFromTransitions,
} from './HorseDecisionLatencyHealth.js';

describe('HorseDecisionLatencyHealth', () => {
  it('returns an immutable empty snapshot with exact threshold metadata when no samples exist', () => {
    const tracker = new HorseDecisionLatencyTracker();
    const snap = tracker.snapshot(1_700_000_000_000);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.byVariant)).toBe(true);
    expect(Object.isFrozen(snap.workers)).toBe(true);
    expect(Object.isFrozen(snap.alertedVariants)).toBe(true);
    expect(snap).toEqual({
      windowMs: HORSE_DECISION_LATENCY_WINDOW_MS,
      thresholdMs: HORSE_DECISION_LATENCY_THRESHOLD_MS,
      alertMinSamples: HORSE_DECISION_STARVATION_MIN_SAMPLES,
      alertThresholdPct: HORSE_DECISION_STARVATION_ALERT_PCT,
      totalDecisions: 0,
      over100msCount: 0,
      over100msPct: 0,
      maxMs: 0,
      topHotNode: null,
      starvationAlert: false,
      alertedVariants: [],
      byVariant: {},
      workers: [],
    });
  });

  it('enforces the exact >= 100 samples and strictly > 1.0% >100 ms starvationAlert threshold', () => {
    // Below minimum sample floor (99 samples, even at 50% over 100 ms -> no alert)
    expect(isStarvationAlert(99, 50)).toBe(false);
    // Exactly 1.000% (1/100) is NOT strictly > 1.0%
    expect(isStarvationAlert(100, 1)).toBe(false);
    // 2/100 (2.0%) IS strictly > 1.0%
    expect(isStarvationAlert(100, 2)).toBe(true);
    // 10/1000 (1.0%) is NOT strictly > 1.0%; 11/1000 (1.1%) IS
    expect(isStarvationAlert(1000, 10)).toBe(false);
    expect(isStarvationAlert(1000, 11)).toBe(true);

    const t0 = 1_700_000_000_000;
    const tracker = new HorseDecisionLatencyTracker();
    // 100.0 ms is NOT strictly > 100 ms; 100.01 ms IS > 100 ms
    for (let i = 0; i < 99; i++) {
      tracker.record({ workerIndex: 0, variant: 'nlh', computeMs: 100, nowMs: t0 });
    }
    tracker.record({
      workerIndex: 0,
      variant: 'nlh',
      computeMs: 100.01,
      hotNode: 'tournament_utility',
      nowMs: t0,
    });
    const atOnePct = tracker.snapshot(t0);
    expect(atOnePct.totalDecisions).toBe(100);
    expect(atOnePct.over100msCount).toBe(1);
    expect(atOnePct.over100msPct).toBe(1);
    expect(atOnePct.starvationAlert).toBe(false);
    expect(atOnePct.alertedVariants).toEqual([]);
    expect(atOnePct.topHotNode).toBe('phase15_node_tournament_utility');

    // One more >100 ms sample pushes nlh to 2/101 = 1.98% -> alert fires!
    tracker.record({
      workerIndex: 0,
      variant: 'nlh',
      computeMs: 215.4,
      transitions: [
        { node: 'reference', elapsedMs: 5 },
        { node: 'tournament_utility', elapsedMs: 190 },
        { node: 'wager_rules', elapsedMs: 2 },
      ],
      nowMs: t0 + 1_000,
    });
    const alerted = tracker.snapshot(t0 + 1_000);
    expect(alerted.starvationAlert).toBe(true);
    expect(alerted.alertedVariants).toEqual(['nlh']);
    expect(alerted.byVariant.nlh?.starvationAlert).toBe(true);
    expect(alerted.byVariant.nlh?.over100msCount).toBe(2);
    expect(alerted.byVariant.nlh?.maxMs).toBe(215.4);
    expect(alerted.byVariant.nlh?.topHotNode).toBe('phase15_node_tournament_utility');
  });

  it('expires samples cleanly outside the 5-minute rolling window', () => {
    const t0 = 1_700_000_000_000;
    const tracker = new HorseDecisionLatencyTracker();

    // Burst of starvation at t0
    for (let i = 0; i < 95; i++) {
      tracker.record({ workerIndex: 0, variant: 'plo5', computeMs: 25, nowMs: t0 });
    }
    for (let i = 0; i < 5; i++) {
      tracker.record({
        workerIndex: 0,
        variant: 'plo5',
        computeMs: 180,
        hotNode: 'joint_policy',
        nowMs: t0,
      });
    }
    expect(tracker.snapshot(t0).starvationAlert).toBe(true);

    // 4m50s later: still inside the 5-minute rolling window (30 buckets of 10s)
    const almostExpired = t0 + HORSE_DECISION_LATENCY_WINDOW_MS - HORSE_DECISION_LATENCY_BUCKET_MS;
    expect(tracker.snapshot(almostExpired).totalDecisions).toBe(100);
    expect(tracker.snapshot(almostExpired).starvationAlert).toBe(true);

    // 5m00s later: t0's bucket has rolled out of the 30-bucket window
    const expired = t0 + HORSE_DECISION_LATENCY_WINDOW_MS;
    const snap = tracker.snapshot(expired);
    expect(snap.totalDecisions).toBe(0);
    expect(snap.over100msCount).toBe(0);
    expect(snap.starvationAlert).toBe(false);
    expect(snap.topHotNode).toBeNull();
    expect(snap.workers).toEqual([]);
  });

  it('breaks down latency per worker and per variant with accurate topHotNode selection', () => {
    const t0 = 1_700_000_000_000;
    const tracker = new HorseDecisionLatencyTracker();

    // Worker 0: healthy PLO4, slow NLH on tournament_utility
    for (let i = 0; i < 120; i++) {
      tracker.record({ workerIndex: 0, variant: 'plo4', computeMs: 18, nowMs: t0 });
    }
    for (let i = 0; i < 97; i++) {
      tracker.record({ workerIndex: 0, variant: 'nlh', computeMs: 12, nowMs: t0 });
    }
    for (let i = 0; i < 3; i++) {
      tracker.record({
        workerIndex: 0,
        variant: 'nlh',
        computeMs: 150 + i * 20,
        transitions: [
          { node: 'reference', elapsedMs: 10 },
          { node: 'tournament_utility', elapsedMs: 130 + i * 20 },
        ],
        nowMs: t0,
      });
    }

    // Worker 1: slow PLO6 on joint_policy (below 100 samples so worker 1 does not alert)
    for (let i = 0; i < 10; i++) {
      tracker.record({ workerIndex: 1, variant: 'plo6', computeMs: 30, nowMs: t0 });
    }
    tracker.record({
      workerIndex: 1,
      variant: 'plo6',
      computeMs: 240,
      transitions: [
        { node: 'reference', elapsedMs: 15 },
        { node: 'joint_policy', elapsedMs: 210 },
      ],
      nowMs: t0,
    });

    const snap = tracker.snapshot(t0);
    expect(snap.totalDecisions).toBe(231);
    expect(snap.over100msCount).toBe(4);
    expect(snap.maxMs).toBe(240);
    expect(snap.topHotNode).toBe('phase15_node_tournament_utility');
    expect(snap.starvationAlert).toBe(true);
    expect(snap.alertedVariants).toEqual(['nlh']);

    expect(snap.workers).toHaveLength(2);
    expect(snap.workers[0]).toMatchObject({
      workerIndex: 0,
      totalDecisions: 220,
      over100msCount: 3,
      maxMs: 190,
      topHotNode: 'phase15_node_tournament_utility',
      starvationAlert: true,
    });
    expect(snap.workers[0]!.byVariant.plo4).toMatchObject({
      totalDecisions: 120,
      over100msCount: 0,
      topHotNode: null,
      starvationAlert: false,
    });
    expect(snap.workers[1]).toMatchObject({
      workerIndex: 1,
      totalDecisions: 11,
      over100msCount: 1,
      maxMs: 240,
      topHotNode: 'phase15_node_joint_policy',
      starvationAlert: false,
    });
  });

  it('maintains strictly bounded O(1) memory under high-cardinality arbitrary inputs', () => {
    const tracker = new HorseDecisionLatencyTracker();
    const base = 1_700_000_000_000;
    // Pump 5,000 arbitrary variants, worker indices, hotNodes across 125 monotonic buckets (~20.8 min)
    for (let i = 0; i < 5_000; i++) {
      tracker.record({
        workerIndex: i % 200,
        variant: `unknown_variant_${i}`,
        computeMs: 120 + (i % 50),
        hotNode: `custom_unbounded_node_${i}`,
        nowMs: base + Math.floor(i / 40) * HORSE_DECISION_LATENCY_BUCKET_MS,
      });
    }
    const finalNow = base + Math.floor(4_999 / 40) * HORSE_DECISION_LATENCY_BUCKET_MS;
    // Out-of-order stale sample from 10 minutes earlier must never clobber the newer bucket
    tracker.record({
      workerIndex: 0,
      variant: 'nlh',
      computeMs: 999,
      nowMs: finalNow - 2 * HORSE_DECISION_LATENCY_WINDOW_MS,
    });
    expect(tracker.slotCapacity()).toBe(HORSE_DECISION_LATENCY_BUCKET_COUNT);
    const snap = tracker.snapshot(finalNow);
    expect(snap.workers.length).toBeLessThanOrEqual(HORSE_DECISION_LATENCY_MAX_WORKERS);
    expect(Object.keys(snap.byVariant)).toEqual(['other']);
    expect(snap.topHotNode).toBe('phase15_node_other');
    expect(snap.maxMs).toBeLessThan(200);
  });

  it('ignores non-finite, negative, or invalid inputs without throwing', () => {
    const tracker = new HorseDecisionLatencyTracker();
    const now = 1_700_000_000_000;
    tracker.record({ workerIndex: 0, variant: 'nlh', computeMs: Number.NaN, nowMs: now });
    tracker.record({ workerIndex: 0, variant: 'nlh', computeMs: -5, nowMs: now });
    tracker.record({
      workerIndex: 0,
      variant: 'nlh',
      computeMs: Number.POSITIVE_INFINITY,
      nowMs: now,
    });
    tracker.record({ workerIndex: -1, variant: 'nlh', computeMs: 200, nowMs: now });
    tracker.record({ workerIndex: 1.5, variant: 'nlh', computeMs: 200, nowMs: now });
    expect(tracker.snapshot(now).totalDecisions).toBe(0);

    expect(normalizeLatencyVariant('TEXAS_HOLDEM')).toBe('nlh');
    expect(normalizeLatencyVariant('omaha5')).toBe('plo5');
    expect(normalizeLatencyVariant('6+')).toBe('short_deck');
    expect(normalizeLatencyVariant('mystery')).toBe('other');
    expect(normalizeHotNode('phase15_node_tournament_utility')).toBe(
      'phase15_node_tournament_utility'
    );
    expect(normalizeHotNode('tournament_utility')).toBe('phase15_node_tournament_utility');
    expect(normalizeHotNode('unknown_node')).toBe('phase15_node_other');
    expect(normalizeHotNode('')).toBeNull();
    expect(selectHotNodeFromTransitions([])).toBeNull();
  });
});
