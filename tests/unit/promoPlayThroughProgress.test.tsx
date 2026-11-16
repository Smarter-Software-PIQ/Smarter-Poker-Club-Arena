import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
import { parsePromoPlayThrough } from '../../src/services/PromoPlayThroughService';
import { PromoPlayThroughFigure } from '../../src/components/wallet/PromoPlayThroughProgress';
const progress = {
  success: true,
  locked: 50,
  open_grants: 1,
  fee_target: 200,
  fee_progress: 124,
  fee_remaining: 76,
  percent: 62,
  wallet: 80,
  cashable: 30,
  next_expiry_at: null,
};
afterEach(cleanup);
describe('promo play-through progress', () => {
  it('shows the actual fee target, locked principal, profit and percentage', () => {
    render(<PromoPlayThroughFigure summary={parsePromoPlayThrough(progress)} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62');
    expect(screen.getByText('124.00 Of 200.00 In Fees')).toBeTruthy();
    expect(screen.getByText('76.00 To Go · 50.00 Locked')).toBeTruthy();
    expect(screen.getByText('30.00 Cashable')).toBeTruthy();
  });
  it('accepts numeric database values without rounding money', () => {
    expect(parsePromoPlayThrough({ ...progress, locked: '50.25' }).locked).toBe(50.25);
  });
  it.each([
    null,
    {},
    { ...progress, success: false },
    { ...progress, locked: null },
    { ...progress, cashable: 81 },
    { ...progress, percent: 101 },
    { ...progress, wallet: -1 },
    { ...progress, fee_progress: 201 },
    { ...progress, open_grants: 1.2 },
    { ...progress, next_expiry_at: 'not a date' },
  ])('refuses missing or malformed money: %j', (row) => {
    expect(() => parsePromoPlayThrough(row)).toThrow();
  });
});
