/**
 * THE REPLAYER SHOWS THE PRICE BEFORE THE TAP, AND KEEPS WHAT YOU BOUGHT (2026-11-02).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { HandDetailModal } from '@/components/table/HandDetailModal';
import { adaptServiceHandToPanel } from '@/lib/handHistoryAdapter';

vi.mock('@/components/common/Toast', () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
const fetchStatus = vi.fn();
vi.mock('@/services/rabbitHuntReplayStatus', () => ({
  fetchReplayRabbitStatus: (...a: unknown[]) => fetchStatus(...a),
}));
const fetchPreview = vi.fn();
const fetchOwned = vi.fn();
vi.mock('@/services/rabbitHuntPricing', async (orig) => ({
  ...(await orig<typeof import('@/services/rabbitHuntPricing')>()),
  fetchRabbitHuntChargePreview: (...a: unknown[]) => fetchPreview(...a),
  fetchOwnedRunout: (...a: unknown[]) => fetchOwned(...a),
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
const onRabbitHunt = vi.fn();
const view = (playedAt: string, vip = true) =>
  render(
    <HandDetailModal
      isOpen
      onClose={() => {}}
      hands={[row(playedAt)]}
      heroId={HERO}
      onRabbitHunt={onRabbitHunt}
      rabbitUserId={HERO}
      rabbitIsVIP={vip}
      rabbitTableId="t-9"
    />
  );
const BUTTON = { name: /Show What Would Have Come/i };

beforeEach(() => {
  fetchStatus.mockReset();
  fetchPreview.mockReset();
  fetchOwned.mockReset();
  onRabbitHunt.mockReset();
  fetchOwned.mockResolvedValue(null);
});
afterEach(cleanup);

describe('the price before the tap', () => {
  it('a VIP sees what this reveal will use, under the button', async () => {
    fetchStatus.mockResolvedValue({ status: 'saved', expiresAt: Date.now() + 3_600_000 });
    fetchPreview.mockResolvedValue({ source: 'vip_allowance', vipRemaining: 97, creditsLeft: 0 });
    const { findByRole, findByText } = view(ago(5 * 60_000));
    expect(await findByRole('button', BUTTON)).toBeTruthy();
    expect(await findByText('Uses 1 VIP Rabbit Hunt (97 Left This Month)')).toBeTruthy();
    expect(onRabbitHunt).not.toHaveBeenCalled();
  });

  it('the felt window shows the price too (diamonds for a non-VIP)', async () => {
    fetchPreview.mockResolvedValue({
      source: 'diamonds',
      cost: 5,
      balance: 40,
      affordable: true,
      isVip: false,
      vipRemaining: null,
      creditsLeft: 0,
    });
    const { findByText, getByRole } = view(ago(10_000), false);
    expect(getByRole('button', BUTTON)).toBeTruthy();
    expect(await findByText('Costs 5 Diamonds')).toBeTruthy();
  });

  it('no button, no price lookup', async () => {
    fetchStatus.mockResolvedValue({ status: 'unavailable' });
    const { findByText } = view(ago(5 * 60_000));
    expect(await findByText('Previous Hand Rabbit Hunt Is Not Live Yet')).toBeTruthy();
    expect(fetchPreview).not.toHaveBeenCalled();
  });
});

describe('a run-out you bought is yours to keep', () => {
  const OWNED = {
    cards: [
      { rank: 'K', suit: 'hearts' },
      { rank: '4', suit: 'clubs' },
    ],
    boardLen: 3,
    ownedAt: Date.now() - 90_000_000,
  };

  it('past the 1 day limit, the bought cards still show, free, with no button', async () => {
    fetchOwned.mockResolvedValue(OWNED);
    const { findByText, queryByRole, queryByText } = view(ago(25 * 60 * 60_000));
    expect(await findByText('You Bought This Run Out. It Stays In Your Hand History')).toBeTruthy();
    expect(queryByRole('button', BUTTON)).toBeNull();
    expect(queryByText('Expired after 24 hours')).toBeNull();
    expect(fetchOwned).toHaveBeenCalledWith('t-9', 777);
    expect(onRabbitHunt).not.toHaveBeenCalled();
    expect(fetchPreview).not.toHaveBeenCalled();
  });

  it('within the day an owned hand also re-shows without a purchase', async () => {
    fetchStatus.mockResolvedValue({ status: 'saved', expiresAt: Date.now() + 3_600_000 });
    fetchOwned.mockResolvedValue(OWNED);
    const { findByText, queryByRole } = view(ago(5 * 60_000));
    expect(await findByText('You Bought This Run Out. It Stays In Your Hand History')).toBeTruthy();
    expect(queryByRole('button', BUTTON)).toBeNull();
  });

  it('nothing owned: the limit is still stated', async () => {
    const { findByText } = view(ago(25 * 60 * 60_000));
    expect(await findByText('Expired after 24 hours')).toBeTruthy();
  });
});
