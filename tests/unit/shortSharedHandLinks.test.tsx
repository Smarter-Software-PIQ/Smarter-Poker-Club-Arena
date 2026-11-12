/**
 * SHORT SHARED-HAND LINKS (2026-11-06): smarter.poker/.../h/<token> maps to the
 * same payload as /replay?h= (migration 20261107021555; native proof
 * scripts/dev/test-shared-hands-postgres.sh). Pinned here:
 *  - the service: tokens, the preview carries public facts only, and open()
 *    keeps "unreachable" apart from "missing";
 *  - the /h/:token page renders the same replay, or says revoked / missing /
 *    could not load;
 *  - Link sends the short link once reserved, marks it sent, and the sender can
 *    see views and Stop Sharing; the long link stands in until then;
 *  - the Share sheet sends the short link and records the send;
 *  - the route is registered and shares the replay's quiet chrome.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => {
  const chain = () => {
    const q: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) q[k] = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    return q;
  };
  return { supabase: { rpc, from: vi.fn(() => chain()) } };
});
vi.mock('@/services/SoundService', () => ({
  soundService: new Proxy({}, { get: () => vi.fn() }),
  haptic: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock('@/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: null }) }));
vi.mock('@/lib/authUtils', async (orig) => ({
  ...(await orig<typeof import('@/lib/authUtils')>()),
  hasLocalSession: () => false,
}));

import {
  normalizeSharedHandToken,
  openSharedHand,
  previewFromShareable,
  shortHandUrl,
} from '@/services/SharedHandLinkService';
import { encodeHand, ShareHand, type ShareableHand } from '@/components/table/ShareHand';
import { shareableFromModel } from '@/lib/shareHandModel';
import { buildReplay, replayInputFromRow } from '@/utils/handReplay';
import { HandDetailModal } from '@/components/table/HandDetailModal';
import { adaptServiceHandToPanel } from '@/lib/handHistoryAdapter';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const SENDER = 'sender-uuid';
const ROW = {
  id: 'hand-uuid',
  hand_number: 56019216,
  game_variant: 'nlh',
  small_blind: 0.25,
  big_blind: 0.5,
  pot_size: 3.43,
  button_seat: 2,
  started_at: '2026-11-06T19:56:52.000Z',
  community_cards: ['9hearts', 'Jhearts', '3clubs', 'Ahearts', '6spades'],
  players: [
    { userId: SENDER, username: 'Mongo', seat: 1, stack: 160, cards: [] },
    { userId: 'v', username: 'Vegas_Owen', seat: 2, stack: 54, cards: [] },
  ],
  actions: [
    { seat: 1, userId: SENDER, action: 'sb', amount: 0.25, stage: 'preflop' },
    { seat: 2, userId: 'v', action: 'bb', amount: 0.5, stage: 'preflop' },
    { seat: 1, userId: SENDER, action: 'call', amount: 0.25, stage: 'preflop' },
    { seat: 2, userId: 'v', action: 'check', amount: 0, stage: 'preflop' },
  ],
  winners: [{ userId: 'v', amount: 1, potIndex: 0 }],
  hole_cards: null,
  showdown: null,
};
const hand = (): ShareableHand =>
  shareableFromModel(
    buildReplay(
      replayInputFromRow(ROW as never, {
        privateHoleCards: {
          [SENDER]: [
            { rank: 'K', suit: 'hearts' },
            { rank: '4', suit: 'clubs' },
          ] as never,
        },
      })
    ),
    { id: ROW.id, tableName: 'NLH 0.25/0.50', heroUserId: SENDER }
  );

beforeEach(() => rpc.mockReset());
afterEach(cleanup);

describe('the service', () => {
  it('accepts only the 8-character token alphabet', () => {
    expect(normalizeSharedHandToken('AbCd2345')).toBe('AbCd2345');
    expect(normalizeSharedHandToken('AbCd234l')).toBeNull(); // l is excluded
    expect(normalizeSharedHandToken('../etc')).toBeNull();
    // The World Hub preview page, which sends a person on to /hub/club-arena/h/.
    expect(shortHandUrl('AbCd2345', 'https://smarter.poker')).toBe(
      'https://smarter.poker/h/AbCd2345'
    );
  });

  it('a preview carries the board, pot, stakes and sender, never hole cards', () => {
    const p = previewFromShareable(hand());
    expect(p).toMatchObject({
      handNumber: '56019216',
      tableName: 'NLH 0.25/0.50',
      senderName: 'Mongo',
    });
    expect(p.board).toBe('9h Jh 3c Ah 6s');
    expect(JSON.stringify(p)).not.toMatch(/Kh|4c/);
  });

  it('open keeps an unreachable server apart from a missing link', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'fetch failed' } });
    expect(await openSharedHand('AbCd2345')).toEqual({ status: 'unreachable' });
    rpc.mockResolvedValueOnce({ data: { found: false }, error: null });
    expect(await openSharedHand('AbCd2345')).toEqual({ status: 'missing' });
    rpc.mockResolvedValueOnce({ data: { found: true, revoked: true }, error: null });
    expect(await openSharedHand('AbCd2345')).toEqual({ status: 'revoked' });
    rpc.mockResolvedValueOnce({
      data: { found: true, revoked: false, payload: 'v4~x', invite: 'hstaaaa' },
      error: null,
    });
    expect(await openSharedHand('AbCd2345')).toEqual({
      status: 'open',
      payload: 'v4~x',
      invite: 'HSTAAAA',
    });
    rpc.mockClear();
    expect(await openSharedHand('nope')).toEqual({ status: 'missing' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('the /h/:token page', () => {
  const open = async () => {
    const { default: Page } = await import('@/pages/share/ShortHandReplayPage');
    render(
      <MemoryRouter initialEntries={['/h/AbCd2345']}>
        <Routes>
          <Route path="/h/:token" element={<Page />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders the same replay, with the sender’s invite door', async () => {
    rpc.mockResolvedValue({
      data: { found: true, revoked: false, payload: encodeHand(hand()), invite: 'HSTAAAA' },
      error: null,
    });
    await open();
    await screen.findByText('Hand #56019216');
    expect(rpc).toHaveBeenCalledWith('fn_ca_shared_hand_open', {
      p_token: 'AbCd2345',
      p_count: true,
    });
    expect(screen.getByRole('link', { name: 'Create Account' }).getAttribute('href')).toBe(
      '/i/HSTAAAA'
    );
  });

  it.each([
    [{ data: { found: true, revoked: true }, error: null }, 'This Hand Is No Longer Shared'],
    [{ data: { found: false }, error: null }, 'This Hand Link Does Not Exist'],
    [{ data: null, error: { message: 'down' } }, 'Could Not Load This Hand'],
  ])('says so plainly (%#)', async (answer, title) => {
    rpc.mockResolvedValue(answer);
    await open();
    await screen.findByText(title);
  });
});

describe('the Share sheet', () => {
  it('sends the short link once reserved and records the send', async () => {
    const onShared = vi.fn();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <ShareHand
        isOpen
        onClose={() => {}}
        hand={hand()}
        shortUrl="https://smarter.poker/hub/club-arena/h/AbCd2345"
        onShared={onShared}
      />
    );
    expect(
      (
        screen.getByDisplayValue(
          'https://smarter.poker/hub/club-arena/h/AbCd2345'
        ) as HTMLInputElement
      ).value
    ).toBeTruthy();
    const copyButton = screen.getByRole('button', { name: 'Copy Link' });
    expect(copyButton.textContent).toBe('Copy');
    fireEvent.click(copyButton);
    await waitFor(() => expect(onShared).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('https://smarter.poker/hub/club-arena/h/AbCd2345');
    expect(screen.getByRole('button', { name: 'Link Copied' }).textContent).toBe('Copied');
  });

  it('a short link embeds with ?embed=true, a long one with &embed=true', () => {
    const share = src('src/components/table/ShareHand.tsx');
    expect(share).toContain("const sep = shareUrl.includes('?') ? '&' : '?';");
  });
});

describe('Link and the sender’s controls, on the real popup', () => {
  const HERO = 'hero-1';
  const record = () =>
    adaptServiceHandToPanel(
      {
        id: 'h-1',
        serial_number: '7',
        table_id: 't-1',
        table_name: 'Midway 1/2',
        played_at: '2026-09-05T01:00:00.000Z',
        hand_number: 7,
        total_hands: 0,
        main_pot: 3,
        side_pots: [],
        community_cards: [],
        players: [
          {
            seat: 1,
            user_id: HERO,
            username: 'Hero',
            avatar_url: null,
            position: 'SB',
            hole_cards: [],
            result: 2,
            is_winner: true,
          },
          {
            seat: 2,
            user_id: 'v',
            username: 'Villain',
            avatar_url: null,
            position: 'BB',
            hole_cards: [],
            result: -2,
            is_winner: false,
          },
        ],
        actions: [{ player_id: 'v', action: 'fold', amount: 0, street: 'preflop', timestamp: 1 }],
        winners: [{ user_id: HERO, amount: 3, pot_index: 0 }],
        winners_by_board: [],
        rake: 0,
        bbj_fee: 0,
        game_type: 'NLH',
        stakes: '1/2',
      } as never,
      HERO
    );

  it('sends the reserved short link, marks it sent, shows views and stops sharing', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'fn_ca_shared_hand_reserve')
        return { data: { success: true, token: 'AbCd2345', sent: false, views: 0 }, error: null };
      if (fn === 'fn_ca_shared_hand_revoke') return { data: { success: true }, error: null };
      return { data: { success: true }, error: null };
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<HandDetailModal isOpen onClose={() => {}} hands={[record()]} heroId={HERO} />);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        'fn_ca_shared_hand_reserve',
        expect.objectContaining({ p_payload: expect.any(String) })
      )
    );
    const reserve = rpc.mock.calls.find(([fn]) => fn === 'fn_ca_shared_hand_reserve')![1] as {
      p_preview: Record<string, string>;
    };
    expect(reserve.p_preview).toMatchObject({ handNumber: '7', senderName: 'Hero' });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByLabelText('Copy Link To This Hand'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toMatch(/\/h\/AbCd2345$/);
    expect(rpc).toHaveBeenCalledWith('fn_ca_shared_hand_mark_sent', { p_token: 'AbCd2345' });
    await screen.findByText(/Shared . 0 Views/);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Sharing' }));
    await screen.findByText('Sharing Stopped. The Old Link No Longer Opens This Hand.');
    expect(rpc).toHaveBeenCalledWith('fn_ca_shared_hand_revoke', { p_token: 'AbCd2345' });
  });

  it('without a reservation, Link sends the long link that always works', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<HandDetailModal isOpen onClose={() => {}} hands={[record()]} heroId={HERO} />);
    fireEvent.click(screen.getByLabelText('Copy Link To This Hand'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain(
      '/hub/club-arena/replay?h='
    );
    expect(screen.queryByText('Stop Sharing')).toBeNull();
  });
});

describe('Link and the sender’s controls', () => {
  it('Link prefers the reserved short link, marks it sent only once it went, and shows views with Stop Sharing', () => {
    const modal = src('src/components/table/HandDetailModal.tsx');
    expect(modal).toContain('if (h.id === hand?.id && shortLink.url) return shortLink.url;');
    expect(modal).toContain('if (sent && short) shortLink.markSent();');
    expect(modal).toContain('Stop Sharing');
    expect(modal).toContain('Sharing Stopped. The Old Link No Longer Opens This Hand.');
    for (const caller of [
      'src/pages/HandHistoryPage.tsx',
      'src/components/table/TableModalsLayer.tsx',
    ]) {
      const s = src(caller);
      expect(s).toContain('shortUrl={shareShort.url}');
      expect(s).toContain('onShared={shareShort.markSent}');
    }
  });
});

describe('the route', () => {
  it('is registered beside /replay and shares its quiet chrome', () => {
    expect(src('src/App.tsx')).toContain(
      '<Route path="/h/:token" element={<ShortHandReplayPage />} />'
    );
    expect(src('src/components/club/clubFooterVisibility.ts')).toContain('/^\\/h(?:\\/|$)/');
    expect(src('src/components/notifications/FirstRunPushPrompt.tsx')).toContain(
      "'/h', // a short shared-hand link"
    );
  });
});
