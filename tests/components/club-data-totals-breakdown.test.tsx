import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/common/Modal', () => ({
  Modal: ({ children }: any) => <div role="dialog">{children}</div>,
}));
vi.mock('../../src/components/console/SpadeConsole', () => ({
  SpadeConsole: ({ children }: any) => <div>{children}</div>,
}));
import Breakdown, { validBreakdown } from '../../src/pages/club/ClubDataTotalsBreakdown';
const props = {
  clubId: 'club',
  start: '2026-11-01',
  end: '2026-11-05',
  game: 'ALL',
  stakes: 'ALL',
  search: null,
};
const data = {
  contract: 'ca_club_data_player_totals.v1',
  club_id: 'club',
  range: { start: props.start, end: props.end },
  filters: { game: 'ALL', stakes: 'ALL', search: null },
  scope: 'club',
  players: [
    { user_id: 'a', name: 'Alice', total_winnings: 150, mtt_winnings: 50, fee: 3.25 },
    { user_id: 'b', name: 'Bob', total_winnings: -75, mtt_winnings: -25, fee: 2.25 },
  ],
};
afterEach(cleanup);
describe('Player Total Drilldowns', () => {
  it('rejects mismatched scope receipts, duplicates and incomplete amounts', () => {
    expect(validBreakdown(data, props)).toBe(true);
    expect(validBreakdown({ ...data, club_id: 'other' }, props)).toBe(false);
    expect(
      validBreakdown({ ...data, range: { start: props.start, end: '2026-11-04' } }, props)
    ).toBe(false);
    expect(validBreakdown({ ...data, players: [data.players[0], data.players[0]] }, props)).toBe(
      false
    );
    expect(validBreakdown({ ...data, players: [{ ...data.players[0], fee: null }] }, props)).toBe(
      false
    );
  });
  it('shows winning and losing players and keeps all-player totals while searching', async () => {
    rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data, error: null }) });
    render(<Breakdown {...props} metric="total_winnings" onClose={() => {}} />);
    await screen.findByText('Alice');
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('75.00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Find Player In Breakdown'), {
      target: { value: 'Alice' },
    });
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(screen.getByText('75.00')).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('ca_club_data_player_totals', {
      p_club_id: 'club',
      p_start: props.start,
      p_end: props.end,
      p_game: 'ALL',
      p_stakes: 'ALL',
      p_search: null,
    });
  });
  it('shows read failures rather than zero totals, then allows retry', async () => {
    rpc.mockReturnValueOnce({
      abortSignal: () => Promise.resolve({ data: null, error: new Error('denied') }),
    });
    rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data, error: null }) });
    render(<Breakdown {...props} metric="fee" onClose={() => {}} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    await screen.findByText('Alice');
    expect(screen.getByText('5.50')).toBeInTheDocument();
  });
});
