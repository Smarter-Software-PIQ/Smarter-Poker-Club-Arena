import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({
  summary: {
    locked: 50,
    open_grants: 1,
    fee_target: 200,
    fee_progress: 100,
    fee_remaining: 100,
    percent: 50,
    wallet: 80,
    cashable: 30,
    next_expiry_at: null,
  },
}));
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: { id: 'player' } }) }));
vi.mock('../../src/hooks/usePromoPlayThrough', () => ({
  usePromoPlayThrough: () => ({
    summary: state.summary,
    loading: false,
    error: false,
    reload: vi.fn(),
  }),
}));
vi.mock('../../src/hooks/useMemberPromoPlayThrough', () => ({
  useMemberPromoPlayThrough: () => ({ members: { player: state.summary }, reload: vi.fn() }),
}));
import {
  PromoPlayThroughFigure,
  PromoPlayThroughInline,
  PromoPlayThroughProgress,
} from '../../src/components/wallet/PromoPlayThroughProgress';
import { MemberPromoPlayThrough } from '../../src/components/club/MemberPromoPlayThrough';
const active = { ...state.summary };
afterEach(() => {
  cleanup();
  state.summary = { ...active };
});
it.each(['completed', 'refunded', 'busted'])(
  'shared figure disappears for a %s grant and returns for a new grant',
  (kind) => {
    const view = render(<PromoPlayThroughFigure summary={active} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    view.rerender(
      <PromoPlayThroughFigure
        summary={{
          ...active,
          locked: 0,
          open_grants: 0,
          fee_target: 0,
          fee_progress: 0,
          fee_remaining: 0,
          percent: kind === 'completed' ? 100 : 0,
        }}
      />
    );
    expect(view.container.textContent).toBe('');
    view.rerender(<PromoPlayThroughFigure summary={active} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  }
);
it('shared figure keeps a genuinely unfinished grant visible below rounded 100 percent', () => {
  render(
    <PromoPlayThroughFigure
      summary={{ ...active, percent: 100, fee_progress: 199.999, fee_remaining: 0.001 }}
    />
  );
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('99.99');
  expect(screen.queryByText('100%')).toBeNull();
});
it('shows expired return and independent source review without a completed promo meter', () => {
  render(
    <PromoPlayThroughFigure
      summary={{
        ...active,
        locked: 50,
        expired_locked: 50,
        fee_target: 0,
        fee_progress: 0,
        fee_remaining: 0,
        percent: 100,
        integrity_held: 12,
      }}
    />
  );
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByText('Promo Play Through')).toBeNull();
  expect(screen.getByText('50.00 Expired Promo Awaiting Return To Its Original Fund')).toBeTruthy();
  expect(screen.getByText('12.00 Held For Source Review')).toBeTruthy();
});
it('hides completed progress and the empty promo card in wallet, cashout, member and roster consumers', () => {
  const content = () => (
    <>
      <div data-testid="wallet">
        <PromoPlayThroughProgress clubId="club" />
      </div>
      <div data-testid="cashout">
        <PromoPlayThroughProgress clubId="club" />
      </div>
      <MemberPromoPlayThrough clubId="club" userId="player" revision={1} />
      <PromoPlayThroughInline summary={state.summary} />
    </>
  );
  const view = render(content());
  expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  expect(screen.getByText(/Promo Locked/)).toBeTruthy();
  state.summary = {
    ...active,
    locked: 0,
    fee_remaining: 0,
    fee_progress: 200,
    percent: 100,
    open_grants: 0,
  };
  view.rerender(content());
  expect(view.container.textContent).toBe('');
  expect(screen.queryByLabelText('Promo Play Through')).toBeNull();
  state.summary = { ...active, locked: 25 };
  view.rerender(content());
  expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  expect(screen.getByText(/Promo Locked 25.00/)).toBeTruthy();
});
it('a refunded unfinished fee still shows the real remaining requirement', () => {
  render(
    <PromoPlayThroughFigure
      summary={{ ...active, fee_progress: 20, fee_remaining: 180, percent: 10 }}
    />
  );
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('10');
  expect(screen.getByText('180.00 To Go · 50.00 Locked')).toBeTruthy();
});

it('shows a second balance only for wallet principal or restricted promo profits, never a review-only difference', () => {
  const view = render(
    <PromoPlayThroughFigure summary={{ ...active, wallet_locked: 0, locked: 50 }} />
  );
  expect(screen.queryByText(/Withdrawable Balance/)).toBeNull();
  view.rerender(
    <PromoPlayThroughFigure
      summary={{ ...active, wallet_locked: 0, locked: 0, integrity_held: 20 }}
    />
  );
  expect(screen.queryByText(/Withdrawable Balance/)).toBeNull();
  view.rerender(<PromoPlayThroughFigure summary={{ ...active, wallet_locked: 20 }} />);
  expect(screen.getByText('Withdrawable Balance: 30.00')).toBeTruthy();
  view.rerender(
    <PromoPlayThroughFigure
      summary={{
        ...active,
        locked: 0,
        wallet_locked: 0,
        wallet_profit_locked: 10,
        profit_locked: 10,
        profit_fee_target: 100,
        profit_fee_progress: 99.999,
        profit_fee_remaining: 0.001,
      }}
    />
  );
  expect(screen.getByText('Withdrawable Balance: 30.00')).toBeTruthy();
  expect(screen.getByText(/Promo Profit Fee Progress: 99.99%/)).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  view.rerender(
    <PromoPlayThroughFigure
      summary={{
        ...active,
        locked: 0,
        wallet_locked: 0,
        wallet_profit_locked: 0,
        profit_locked: 0,
        profit_fee_target: 100,
        profit_fee_progress: 100,
        profit_fee_remaining: 0,
      }}
    />
  );
  expect(view.container.textContent).toBe('');
});
