import { describe, expect, it } from 'vitest';
import { autoTopUpRequest, quietAutoTopUpRefusal } from '../../src/utils/autoTopUpRequest';

describe('background top-up notifications', () => {
  it('does not interrupt a feeder game for an unavailable Lightning session', () => {
    expect(quietAutoTopUpRefusal('auto', 'Lightning Session Is Unavailable')).toBe(true);
  });
  it('keeps explicit purchases and other failures visible', () => {
    expect(quietAutoTopUpRefusal('manual', 'Lightning Session Is Unavailable')).toBe(false);
    expect(quietAutoTopUpRefusal(undefined, 'Lightning Session Is Unavailable')).toBe(false);
    expect(quietAutoTopUpRefusal('auto', 'Unable To Verify This Top Up')).toBe(false);
    expect(quietAutoTopUpRefusal('auto', 'Insufficient Balance')).toBe(false);
  });
});

describe('an automatic top-up retries its original purchase', () => {
  it('retains amount and key after a committed debit changes the observed wallet balance', () => {
    const first = autoTopUpRequest(null, 4, 66.67, () => 'first');
    expect(autoTopUpRequest(first, 4, 16.67, () => 'second')).toBe(first);
    expect(first).toEqual({ hand: 4, amount: 66.67, key: 'first' });
  });
  it('creates a different purchase for the next hand', () => {
    const first = autoTopUpRequest(null, 4, 66.67, () => 'first');
    expect(autoTopUpRequest(first, 5, 16.67, () => 'second')).toEqual({
      hand: 5,
      amount: 16.67,
      key: 'second',
    });
  });
  it.each([NaN, Infinity, -Infinity, 0, -1])(
    'does not create a purchase for amount %s',
    (amount) => {
      expect(autoTopUpRequest(null, 4, amount)).toBeNull();
    }
  );
  it.each([NaN, Infinity, -1, 0.5])('does not create a purchase for hand %s', (hand) => {
    expect(autoTopUpRequest(null, hand, 10)).toBeNull();
  });
});

// The effect must send the retained payload, rather than recomputing the amount
// beside a retained key. This connection is what the isolated arithmetic cannot prove.
