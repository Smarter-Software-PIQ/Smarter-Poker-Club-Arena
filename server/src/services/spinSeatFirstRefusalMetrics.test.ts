/**
 * FAST-FAIL SPIN SEAT-FIRST BOOKING REFUSAL OBSERVABILITY
 * (2026-11-24, incident 3c817b04-bc3a-4bc5-aa43-b2eee257584d)
 *
 * Verifies that unexpected Spin seat-first booking RPC refusals are:
 *   1. classified into a bounded, low-cardinality reason set (never leaking
 *      board UUIDs or arbitrary error text into Prometheus labels),
 *   2. emitted at zero from boot via SpinMetrics.toPrometheus() so Prometheus
 *      alert SpinSeatFirstBookingRefusedRepeatedly never evaluates an absent
 *      vector, and
 *   3. wired in TournamentRecurringService.ts strictly inside the unexpected
 *      refusal branch (after isExpectedSeatRefusal), so ordinary four-table
 *      horse-capacity refusals never inflate the counter.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase.js', () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: { message: 'unit fixture: no db' } })),
  },
}));

import {
  SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS,
  classifySpinSeatFirstBookingRefusalReason,
  recordSpinSeatFirstBookingRefusal,
  resetSpinSeatFirstBookingRefusalTotalsForTests,
  spinSeatFirstBookingRefusalPrometheusLines,
  spinSeatFirstBookingRefusalTotals,
} from './seatFirstPrecheckMetrics.js';
import { SpinMetrics } from './SpinMetrics.js';

describe('Spin seat-first booking refusal observability', () => {
  beforeEach(() => {
    resetSpinSeatFirstBookingRefusalTotalsForTests();
  });

  it('classifies known deterministic Spin SQL booking refusals and bounds unknown text to other', () => {
    expect(
      classifySpinSeatFirstBookingRefusalReason(
        'paid third seat could not book Spin 3b4c6299-ab1a-4297-b36a-891c980c8ff2: {"ok": false, "reason": "three_paid_seats_required"}'
      )
    ).toBe('three_paid_seats_required');
    expect(
      classifySpinSeatFirstBookingRefusalReason('{"ok": false, "reason": "invalid_spin_contract"}')
    ).toBe('invalid_spin_contract');
    expect(classifySpinSeatFirstBookingRefusalReason('{"reason": "not_a_spin"}')).toBe(
      'not_a_spin'
    );
    expect(
      classifySpinSeatFirstBookingRefusalReason('spin_entry_escrow_unproven on board abc')
    ).toBe('spin_reserve_unproven');
    expect(
      classifySpinSeatFirstBookingRefusalReason('unexpected custom error with uuid 91f388d4')
    ).toBe('other');
    expect(classifySpinSeatFirstBookingRefusalReason(null)).toBe('other');
  });

  it('emits every bounded reason series at zero from boot on SpinMetrics.toPrometheus()', () => {
    const lines = new SpinMetrics().toPrometheus().join('\n');
    expect(lines).toContain('# HELP poker_spin_seat_first_booking_refused_total');
    expect(lines).toContain('# TYPE poker_spin_seat_first_booking_refused_total counter');
    for (const reason of SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS) {
      expect(lines).toContain(`poker_spin_seat_first_booking_refused_total{reason="${reason}"} 0`);
    }
  });

  it('increments the matching bounded reason counter and never creates dynamic labels', () => {
    recordSpinSeatFirstBookingRefusal(
      'paid third seat could not book Spin 91f388d4-e4cd-4154-b8f2-e1112b922b7a: {"reason":"three_paid_seats_required"}'
    );
    recordSpinSeatFirstBookingRefusal('three_paid_seats_required');
    recordSpinSeatFirstBookingRefusal('random unhandled postgres failure 55000');

    const totals = spinSeatFirstBookingRefusalTotals();
    expect(totals.three_paid_seats_required).toBe(2);
    expect(totals.other).toBe(1);
    expect(totals.invalid_spin_contract).toBe(0);

    const rendered = spinSeatFirstBookingRefusalPrometheusLines().join('\n');
    expect(rendered).toContain(
      'poker_spin_seat_first_booking_refused_total{reason="three_paid_seats_required"} 2'
    );
    expect(rendered).toContain('poker_spin_seat_first_booking_refused_total{reason="other"} 1');
    expect(rendered).not.toContain('91f388d4');
  });

  it('wires recordSpinSeatFirstBookingRefusal at every fn_seat_horse_in_seat_first_game call site inside the unexpected refusal branch', () => {
    const src = readFileSync(join(__dirname, 'TournamentRecurringService.ts'), 'utf8');
    const rpcCallMatches = [
      ...src.matchAll(/supabase\.rpc\(\s*'fn_seat_horse_in_seat_first_game'/g),
    ];
    expect(rpcCallMatches.length).toBeGreaterThanOrEqual(2);
    for (const match of rpcCallMatches) {
      const windowSrc = src.slice(match.index!, match.index! + 1600);
      expect(windowSrc).toContain('if (!isExpectedSeatRefusal(seatRpcErr.message))');
      expect(windowSrc).toContain('recordSpinSeatFirstBookingRefusal(seatRpcErr.message)');
      expect(windowSrc.indexOf('if (!isExpectedSeatRefusal(seatRpcErr.message))')).toBeLessThan(
        windowSrc.indexOf('recordSpinSeatFirstBookingRefusal(seatRpcErr.message)')
      );
    }
    for (const tag of [
      'TournamentRecurring.opening_seat_rpc_failed',
      'TournamentRecurring.seat_first_seat_rpc_failed',
    ]) {
      expect(src).toContain(tag);
    }
  });

  it('documents SpinSeatFirstBookingRefusedRepeatedly and its metric in the Spin unfilled backlog runbook', () => {
    const runbook = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'runbooks', 'spin-unfilled-backlog.md'),
      'utf8'
    );
    expect(runbook).toContain('SpinSeatFirstBookingRefusedRepeatedly');
    expect(runbook).toContain('poker_spin_seat_first_booking_refused_total');
    for (const reason of SPIN_SEAT_FIRST_BOOKING_REFUSAL_REASONS) {
      expect(runbook).toContain(reason);
    }
  });
});
