import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('../src/components/table/CardImage', () => ({ default: () => <span>Card</span> }));
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
