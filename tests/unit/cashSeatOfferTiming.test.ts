import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../../src/lib/analytics', () => state);
import { recordCashSeatOfferStage } from '../../src/lib/cashSeatOfferTiming';
const offer = {
  id: 'timing-offer',
  userId: 'player',
  tableId: 'table',
  notifiedAt: '2026-11-06T04:00:00Z',
  holdExpiresAt: '2026-11-06T04:01:00Z',
};
beforeEach(() => {
  state.capture.mockReset();
});
describe('cash offer timing observes each explicit stage once', () => {
  it('retains bounded first-party timing when analytics is unavailable', () => {
    const mark = vi.fn();
    const original = globalThis.performance;
    vi.stubGlobal('performance', {
      mark,
      getEntriesByName: () => Array(256).fill({}),
      clearMarks: vi.fn(),
    });
    try {
      recordCashSeatOfferStage(
        { ...offer, id: 'local-performance' },
        'received',
        Date.parse(offer.notifiedAt) + 123
      );
      expect(mark).toHaveBeenCalledWith('cash_seat_offer_stage', {
        detail: expect.objectContaining({ reservation_to_stage_ms: 123 }),
      });
      expect(performance.clearMarks).toHaveBeenCalledExactlyOnceWith('cash_seat_offer_stage');
    } finally {
      vi.stubGlobal('performance', original);
    }
  });
  it('measures delivery and actual buy-in independently and ignores deadline thaw duplicates', () => {
    const now = Date.parse(offer.notifiedAt);
    recordCashSeatOfferStage(offer, 'received', now + 250);
    recordCashSeatOfferStage(
      { ...offer, holdExpiresAt: '2026-11-06T04:06:00Z' },
      'received',
      now + 500
    );
    recordCashSeatOfferStage(offer, 'buy_in_opened', now + 850);
    expect(state.capture.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        stage: 'received',
        reservation_to_stage_ms: 250,
        remaining_hold_ms: 59750,
      }),
      expect.objectContaining({ stage: 'buy_in_opened', reservation_to_stage_ms: 850 }),
    ]);
  });
  it('never lets optional telemetry failures break admission and clamps clock skew', () => {
    state.capture.mockImplementation(() => {
      throw new Error('offline');
    });
    expect(() =>
      recordCashSeatOfferStage({ ...offer, id: 'clock-offer' }, 'received', 0)
    ).not.toThrow();
    expect(state.capture).toHaveBeenCalledWith(
      'cash_seat_offer_stage',
      expect.objectContaining({ clock_ahead: true, reservation_to_stage_ms: 0 })
    );
  });
});
