/**
 * THE REPLAYER SAYS WHAT IS ACTUALLY TRUE ABOUT A PREVIOUS HAND (2026-11-02)
 *
 * Before: availability was inferred from age alone, so while the engine that
 * saves run-outs was not serving, a VIP got a live button whose only answer
 * was "No Longer Available" - reading as "this hand expired" when the truth
 * was "not live yet". And past one day the block silently vanished, so the
 * one-day limit was never stated. These pin every state the block can show.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { HandDetailModal } from '@/components/table/HandDetailModal';
import { adaptServiceHandToPanel } from '@/lib/handHistoryAdapter';
import { replayRabbitOffer } from '@/components/table/replayRabbitOffer';

vi.mock('@/components/common/Toast', () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
const fetchStatus = vi.fn();
vi.mock('@/services/rabbitHuntReplayStatus', () => ({
  fetchReplayRabbitStatus: (...a: unknown[]) => fetchStatus(...a),
}));

const HERO = '11111111-2222-4333-8444-555555555555';
const VILLAIN = '22222222-3333-4444-8555-666666666666';
const row = (playedAt: string) =>
  adaptServiceHandToPanel(
    {
      id: 'h-9',
      table_id: 't-9',
      table_name: 'Midway 1/2',
      played_at: playedAt,
      hand_number: 777,
      main_pot: 100,
      side_pots: [],
      community_cards: ['7clubs', '2clubs', '9hearts'],
      players: [
        {
          seat: 1,
          user_id: HERO,
          username: 'hero',
          position: 'BTN',
          hole_cards: [],
          result: 50,
          is_winner: true,
        },
        {
          seat: 2,
          user_id: VILLAIN,
          username: 'v',
          position: 'BB',
          hole_cards: [],
          result: -50,
          is_winner: false,
        },
      ],
      actions: [
        { player_id: HERO, action: 'raise', amount: 6, street: 'preflop', timestamp: 1 },
        { player_id: VILLAIN, action: 'fold', amount: 0, street: 'flop', timestamp: 2 },
      ],
      winners: [{ user_id: HERO, amount: 100, pot_index: 0 }],
      winners_by_board: [],
      rake: 0,
      bbj_fee: 0,
      game_type: 'NLH',
      stakes: '1/2',
    } as unknown as Parameters<typeof adaptServiceHandToPanel>[0],
    HERO
  );
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const view = (playedAt: string, vip = true) =>
  render(
    <HandDetailModal
      isOpen
      onClose={() => {}}
      hands={[row(playedAt)]}
      heroId={HERO}
      onRabbitHunt={vi.fn()}
      rabbitUserId={HERO}
      rabbitIsVIP={vip}
      rabbitTableId="t-9"
    />
  );
const BUTTON = { name: /Show What Would Have Come/i };

beforeEach(() => fetchStatus.mockReset());
afterEach(cleanup);

describe("past the felt window the block reports the hand's real state", () => {
  it('not live yet: says so, and offers no button', async () => {
    fetchStatus.mockResolvedValue({ status: 'unavailable' });
    const { findByText, queryByRole } = view(ago(5 * 60_000));
    expect(await findByText('Previous Hand Rabbit Hunt Is Not Live Yet')).toBeTruthy();
    expect(queryByRole('button', BUTTON)).toBeNull();
    expect(fetchStatus).toHaveBeenCalledWith('t-9', 777);
  });

  it('saved: offers the button and says until when', async () => {
    fetchStatus.mockResolvedValue({ status: 'saved', expiresAt: Date.now() + 3_600_000 });
    const { findByRole, getByText } = view(ago(5 * 60_000));
    expect(await findByRole('button', BUTTON)).toBeTruthy();
    expect(getByText(/^Available Until /)).toBeTruthy();
  });

  it('not saved, not dealt in, or expired: a sentence, never a dead button', async () => {
    for (const [status, text] of [
      ['not_saved', 'This Hand Was Not Saved For Rabbit Hunt'],
      ['not_eligible', 'You Were Not Dealt Into This Hand'],
      ['expired', 'Expired After 24 Hours'],
    ] as const) {
      fetchStatus.mockResolvedValue({ status });
      const { findByText, queryByRole, unmount } = view(ago(5 * 60_000));
      expect(await findByText(text)).toBeTruthy();
      expect(queryByRole('button', BUTTON)).toBeNull();
      unmount();
    }
  });

  it('a lookup failure leaves the engine to answer (button shown)', async () => {
    fetchStatus.mockResolvedValue({ status: 'error' });
    const { findByRole } = view(ago(5 * 60_000));
    expect(await findByRole('button', BUTTON)).toBeTruthy();
  });
});

describe('the one-day limit is stated, not inferred', () => {
  it('a hand older than one day says the limit instead of vanishing', () => {
    const { getByText, queryByRole } = view(ago(25 * 60 * 60_000));
    expect(getByText('Expired After 24 Hours')).toBeTruthy();
    expect(queryByRole('button', BUTTON)).toBeNull();
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('an eligible hand states the 1 day availability', () => {
    fetchStatus.mockResolvedValue({ status: 'saved', expiresAt: Date.now() + 3_600_000 });
    const { getByText } = view(ago(10_000));
    expect(getByText('VIP Access · 24 Hours')).toBeTruthy();
  });

  it('inside the felt window nothing is looked up: the original purchase is unchanged', () => {
    const { getByRole } = view(ago(10_000), false);
    expect(getByRole('button', BUTTON)).toBeTruthy();
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('the offer model names a past-retention hand', () => {
    const o = replayRabbitOffer(
      { handNumber: 1, timestamp: 0, boards: [[1, 2, 3]] },
      25 * 60 * 60_000
    );
    expect(o).toMatchObject({ show: false, pastRetention: true, cardsUnseen: 2 });
  });
});
