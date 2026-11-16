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
  it('prints integrity review holds separately from the promo fee target', () => {
    render(
      <PromoPlayThroughFigure
        summary={parsePromoPlayThrough({
          ...progress,
          integrity_held: 12,
          agent_integrity_held: '7',
        })}
      />
    );
    expect(screen.getByText('12.00 Held For Source Review')).toBeTruthy();
    expect(screen.getByText('7.00 Agent Chips Held For Source Review')).toBeTruthy();
    expect(screen.getByText('124.00 Of 200.00 In Fees')).toBeTruthy();
  });
  it('shows expired principal awaiting return separately from fee progress', () => {
    render(
      <PromoPlayThroughFigure
        summary={parsePromoPlayThrough({ ...progress, expired_locked: 10 })}
      />
    );
    expect(
      screen.getByText('10.00 Expired Promo Awaiting Return To Its Original Fund')
    ).toBeTruthy();
    expect(screen.getByText('124.00 Of 200.00 In Fees')).toBeTruthy();
    expect(parsePromoPlayThrough(progress).expired_locked).toBe(0);
    expect(() => parsePromoPlayThrough({ ...progress, expired_locked: null })).toThrow();
  });
  it('refuses a malformed review hold instead of dropping it', () => {
    expect(() => parsePromoPlayThrough({ ...progress, integrity_held: null })).toThrow();
    expect(() => parsePromoPlayThrough({ ...progress, agent_integrity_held: -1 })).toThrow();
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
