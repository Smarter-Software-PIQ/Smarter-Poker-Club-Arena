/**
 * A SHARED REPLAY NAMES THE SENDER (2026-11-06).
 *
 * A link carries the sender's own unshown cards, marked private, and the
 * replayer draws them face-up. On a link the person watching is NOT the
 * sender (or is signed out), so tagging those cards "Yours" told a recipient
 * that somebody else's folded King-Four was his. The felt and the rundown name
 * the sender instead; a player replaying their own hand still reads "Yours".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { encodeHand } from '@/components/table/ShareHand';
import { shareableFromModel } from '@/lib/shareHandModel';
import { buildReplay, replayInputFromRow } from '@/utils/handReplay';
import { HandDetailView } from '@/components/handdetail/HandDetailView';

vi.mock('@/services/SoundService', () => ({
  soundService: new Proxy({}, { get: () => vi.fn() }),
  haptic: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock('@/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: null }) }));
vi.mock('@/services/HandHistoryService', () => ({ handHistoryService: { getHand: vi.fn() } }));

const SENDER = 'sender-uuid';
const VILLAIN = 'villain-uuid';
const ROW = {
  id: 'hand-uuid',
  hand_number: 56019216,
  game_variant: 'nlh',
  small_blind: 0.25,
  big_blind: 0.5,
  pot_size: 1.75,
  button_seat: 2,
  started_at: '2026-11-06T19:56:52.000Z',
  community_cards: [],
  players: [
    { userId: SENDER, username: 'Mongo', seat: 1, stack: 160, cards: [] },
    { userId: VILLAIN, username: 'Vegas_Owen', seat: 2, stack: 54, cards: [] },
  ],
  actions: [
    { seat: 1, userId: SENDER, action: 'sb', amount: 0.25, stage: 'preflop' },
    { seat: 2, userId: VILLAIN, action: 'bb', amount: 0.5, stage: 'preflop' },
    { seat: 1, userId: SENDER, action: 'fold', amount: 0, stage: 'preflop' },
  ],
  winners: [{ userId: VILLAIN, amount: 0.75, potIndex: 0 }],
  hole_cards: null,
  showdown: null,
};
const model = () =>
  buildReplay(
    replayInputFromRow(ROW as never, {
      privateHoleCards: { [SENDER]: [{ rank: 'K', suit: 'hearts' }, { rank: '4', suit: 'clubs' }] as never },
    })
  );

afterEach(cleanup);

describe('a shared replay', () => {
  it("tags the sender's own unshown cards with the sender's name, never Yours", async () => {
    const hand = shareableFromModel(model(), { id: ROW.id, tableName: 'NLH', heroUserId: SENDER });
    expect(hand.players.find((p) => p.seat === 1)?.privateCards).toBe(true);
    const { default: SharedHandReplayPage } = await import('@/pages/share/SharedHandReplayPage');
    render(
      <MemoryRouter initialEntries={[`/replay?h=${encodeHand(hand)}`]}>
        <SharedHandReplayPage />
      </MemoryRouter>
    );
    await screen.findByText('Hand #56019216');
    expect(document.querySelector('.hr-seat__private')?.textContent).toBe("Mongo's");
    fireEvent.click(screen.getByRole('tab', { name: /rundown/i }));
    const tags = [...document.querySelectorAll('.hdv__private-tag')].map((n) => n.textContent);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t?.startsWith("Mongo's"))).toBe(true);
    expect(document.body.textContent).not.toContain('Yours');
  });

  it('still reads Yours for a player looking at their own hand', () => {
    render(<HandDetailView model={model()} currentUserId={SENDER} />);
    const tags = [...document.querySelectorAll('.hdv__private-tag')].map((n) => n.textContent);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t?.startsWith('Yours'))).toBe(true);
  });
});
