import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => io.rpc(...args),
    channel: () => {
      const c = { on: () => c, subscribe: () => c };
      return c;
    },
    removeChannel: vi.fn(),
  },
}));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../src/components/table/CardImage', () => ({
  default: ({ card }: { card: { rank: string; suit: string } }) => (
    <span data-testid="card">
      {card.rank}
      {card.suit}
    </span>
  ),
}));
import { BBJRecentHits } from '../src/components/bbj/BBJRecentHits';
const hit = {
  payout_id: 'payout',
  awarded_at: '2026-11-01T09:09:29Z',
  hand_number: 53396743,
  total_payout: '4636.78',
  bad_beat_amount: '2318.38',
  bad_beat_name: 'ramen',
  bad_beat_user_id: 'player',
  bad_beat_hand: 'Straight Flush',
  hand_winner_name: 'MKEPam',
  hand_winner_hand: 'Royal Flush',
  game_variant: 'plo5',
  recipients: [],
};
beforeEach(() => io.rpc.mockResolvedValue({ data: [hit], error: null }));
afterEach(cleanup);
describe('BBJ history full payout', () => {
  it.each(['main', 'mini'] as const)(
    'shows the recorded total for %s, not a personal share',
    async (kind) => {
      const open = vi.fn();
      const { container } = render(<BBJRecentHits poolId="pool" kind={kind} onOpenHand={open} />);
      await screen.findByText('Total Paid Out');
      expect(container.querySelector('.bbj-hits__amt')).toHaveTextContent('4.6K');
      const row = screen.getByRole('button', { name: /Total Paid Out 4.6K/ });
      expect(row).not.toHaveAccessibleName(/ramen Won 4.6K/);
      expect(screen.getByText('MKEPam')).toBeInTheDocument();
      expect(container.querySelector('.bbj-hits__name')).toHaveTextContent('ramen+2.3K');
      expect(
        within(screen.getByRole('group', { name: 'ramen Hole Cards' })).getByText('Unavailable')
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('group', { name: 'MKEPam Hole Cards' })).getByText('Unavailable')
      ).toBeInTheDocument();
      fireEvent.keyDown(row, { key: 'Enter' });
      expect(open).toHaveBeenCalledWith('payout');
    }
  );
  it.each([null, '', 'not-a-number', -1])(
    'keeps invalid total %s unknown even when a personal amount exists',
    async (total) => {
      io.rpc.mockResolvedValue({ data: [{ ...hit, total_payout: total }], error: null });
      const { container } = render(<BBJRecentHits poolId="pool" />);
      await waitFor(() =>
        expect(container.querySelector('.bbj-hits__amt')).toHaveTextContent('Unavailable')
      );
      expect(container.querySelector('.bbj-hits__amt')).not.toHaveTextContent('2.3K');
    }
  );
  it('shows zero as recorded and does not substitute the player share', async () => {
    io.rpc.mockResolvedValue({ data: [{ ...hit, total_payout: 0 }], error: null });
    const { container } = render(<BBJRecentHits poolId="pool" />);
    await waitFor(() => expect(container.querySelector('.bbj-hits__amt')).toHaveTextContent('0'));
  });
});

describe('BBJ dealt hole cards and personal award', () => {
  it.each([2, 4, 5, 6])(
    'shows all %i dealt cards for both players, separately from made hands',
    async (count) => {
      const bad = ['9c', '8c', 'As', 'Ad', '2c', '6h'].slice(0, count);
      const winner = ['Kc', 'Ac', '3s', 'Td', '5d', '7h'].slice(0, count);
      io.rpc.mockResolvedValue({
        data: [
          {
            ...hit,
            game_variant: count === 2 ? 'nlh' : `plo${count}`,
            bad_beat_cards: bad,
            hand_winner_cards: winner,
            board: ['5s', '4d', 'Tc', 'Qc', 'Jc'],
          },
        ],
        error: null,
      });
      render(<BBJRecentHits poolId="pool" />);
      const losingCards = await screen.findByRole('group', { name: 'ramen Hole Cards' });
      const winningCards = screen.getByRole('group', { name: 'MKEPam Hole Cards' });
      expect(
        within(losingCards)
          .getAllByTestId('card')
          .map((c) => c.textContent)
      ).toEqual(bad);
      expect(
        within(winningCards)
          .getAllByTestId('card')
          .map((c) => c.textContent)
      ).toEqual(winner);
      expect(screen.getByText('Straight Flush')).toBeInTheDocument();
      expect(screen.getByText('Royal Flush')).toBeInTheDocument();
    }
  );
  it.each([null, '', 'not-a-number', -1])(
    'never derives an absent or invalid personal award (%s) from the event total',
    async (share) => {
      io.rpc.mockResolvedValue({ data: [{ ...hit, bad_beat_amount: share }], error: null });
      const { container } = render(<BBJRecentHits poolId="pool" />);
      await screen.findByText('Payout Unavailable');
      expect(container.querySelector('.bbj-hits__amt')).toHaveTextContent('4.6K');
      expect(container.querySelector('.bbj-hits__share')).toBeNull();
    }
  );
  it('preserves a recorded zero personal award', async () => {
    io.rpc.mockResolvedValue({ data: [{ ...hit, bad_beat_amount: 0 }], error: null });
    render(<BBJRecentHits poolId="pool" />);
    expect(await screen.findByLabelText('Jackpot Winner Received +0')).toBeInTheDocument();
  });
});
