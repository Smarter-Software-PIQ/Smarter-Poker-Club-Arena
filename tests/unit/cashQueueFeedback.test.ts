import { describe, expect, it } from 'vitest';
import { cashQueueFeedback } from '../../src/components/table/cashQueueFeedback';
describe('cash queue feedback uses the authoritative reason', () => {
  it.each([
    'offer_limit',
    'insufficient_funds',
    'expired',
    'seat_reserved',
    'seat_available',
    'table_opening',
    'game_closed',
    'barred',
    'waiting_for_seat',
  ])('explains %s without exposing a database error', (reason) => {
    const text = cashQueueFeedback(reason);
    expect(text).toBeTruthy();
    expect(text).not.toContain(reason);
  });
  it('never invents eligibility for an old server or unknown state', () => {
    expect(cashQueueFeedback(undefined)).toBeNull();
    expect(cashQueueFeedback('unknown')).toBeNull();
  });
});
