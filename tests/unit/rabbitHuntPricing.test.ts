/**
 * THE PRICE IS SHOWN IN THE ENGINE'S OWN CHARGE ORDER (2026-11-02).
 */
import { describe, it, expect } from 'vitest';
import {
  describeAutoRunAllowance,
  describeRabbitHuntCharge,
  parseOwnedRunout,
  parseRabbitHuntChargePreview,
} from '@/services/rabbitHuntPricing';

describe('the price line under a rabbit hunt button', () => {
  it('lifetime VIP is free', () => {
    const p = parseRabbitHuntChargePreview({ source: 'lifetime_vip', credits_left: 0 });
    expect(describeRabbitHuntCharge(p)).toBe('Free With Lifetime VIP');
    expect(describeAutoRunAllowance(p)).toBe('Lifetime VIP: Unlimited Reveals');
  });
  it('an expiring credit is named with its date', () => {
    const p = parseRabbitHuntChargePreview({
      source: 'credit',
      credit_source: 'daily_bonus',
      credit_expires_at: '2026-11-04T12:00:00Z',
      credits_left: 3,
      is_vip: true,
      vip_remaining: 97,
    });
    expect(describeRabbitHuntCharge(p)).toMatch(/^Uses 1 Rabbit Hunt Credit \(Expires /);
    expect(describeAutoRunAllowance(p)).toBe('97 VIP Rabbit Hunts Left This Month · 3 Credits');
  });
  it('the VIP allowance says how many are left', () => {
    const p = parseRabbitHuntChargePreview({
      source: 'vip_allowance',
      vip_remaining: 3,
      credits_left: 0,
    });
    expect(describeRabbitHuntCharge(p)).toBe('Uses 1 VIP Rabbit Hunt (3 Left This Month)');
    expect(describeAutoRunAllowance(p)).toBe('3 VIP Rabbit Hunts Left This Month');
  });
  it('diamonds say the cost, and the balance when it is short', () => {
    expect(
      describeRabbitHuntCharge(
        parseRabbitHuntChargePreview({
          source: 'diamonds',
          cost_diamonds: 5,
          diamonds_balance: 40,
          affordable: true,
        })
      )
    ).toBe('Costs 5 Diamonds');
    const short = parseRabbitHuntChargePreview({
      source: 'diamonds',
      cost_diamonds: 7,
      diamonds_balance: 3,
      affordable: false,
      is_vip: true,
      vip_remaining: 0,
    });
    expect(describeRabbitHuntCharge(short)).toBe('Costs 7 Diamonds (You Have 3)');
    expect(describeAutoRunAllowance(short)).toBe(
      'VIP Rabbit Hunts Used Up This Month. Next Reveals Cost 7 Diamonds'
    );
  });
  it('anything unreadable shows nothing rather than a wrong price', () => {
    for (const d of [
      null,
      'x',
      {},
      { source: 'diamonds' },
      { source: 'vip_allowance' },
      { source: 'weird' },
    ]) {
      const p = parseRabbitHuntChargePreview(d);
      expect(p.source).toBe('error');
      expect(describeRabbitHuntCharge(p)).toBeNull();
    }
    expect(
      describeRabbitHuntCharge(parseRabbitHuntChargePreview({ source: 'signed_out' }))
    ).toBeNull();
  });
});

describe('an owned run-out is read strictly', () => {
  it("accepts only the caller's owned cards", () => {
    const o = parseOwnedRunout({
      owned: true,
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: '2', suit: 'clubs' },
      ],
      board_len: 3,
      owned_at: '2026-11-02T10:00:00Z',
    });
    expect(o).toMatchObject({
      boardLen: 3,
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: '2', suit: 'clubs' },
      ],
    });
    expect(parseOwnedRunout({ owned: false })).toBeNull();
    expect(parseOwnedRunout({ owned: true, cards: [] })).toBeNull();
    expect(parseOwnedRunout({ owned: true, cards: [{ rank: 'A' }] })).toBeNull();
    expect(parseOwnedRunout(null)).toBeNull();
  });
});
