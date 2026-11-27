import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';
import HandHistoryPanel, { type HandRecord } from '@/components/table/HandHistoryPanel';
import { HandDetailModal } from '@/components/table/HandDetailModal';
import { adaptServiceHandToPanel } from '@/lib/handHistoryAdapter';
import {
  buildPersonalAssistantReviewUrl,
  findSavedClubArenaHand,
  logClubArenaHand,
} from '@/services/SavedHandsService';

const authMocks = vi.hoisted(() => ({
  getFreshAccessToken: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('@/lib/authToken', () => ({
  getFreshAccessToken: () => authMocks.getFreshAccessToken(),
}));

vi.mock('@/services/HandNotesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/HandNotesService')>();
  return {
    ...actual,
    handNotesService: {
      listFor: vi.fn().mockResolvedValue(new Map()),
      getOne: vi.fn().mockResolvedValue({ ok: true, note: null }),
      save: vi.fn().mockResolvedValue({ ok: true }),
      remove: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
});

vi.mock('@/services/HandFlagService', () => ({
  FLAG_NOTE_MAX: 500,
  FLAG_NOTE_MIN: 10,
  FLAG_STATUS_LABEL: {
    open: 'Open',
    under_review: 'Under Review',
    resolved: 'Resolved',
    dismissed: 'Dismissed',
  },
  handFlagService: {
    mineFor: vi.fn().mockResolvedValue(new Map()),
    flag: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock('@/services/SoundService', () => ({
  soundService: new Proxy({}, { get: () => vi.fn() }),
  haptic: new Proxy({}, { get: () => vi.fn() }),
}));

vi.mock('@/hooks/useSenderInviteCode', () => ({
  useSenderInviteCode: () => null,
}));

vi.mock('@/hooks/useSharedHandShortLink', () => ({
  useSharedHandShortLink: () => ({
    url: null,
    token: null,
    pending: false,
    sent: false,
    views: 0,
    ready: async () => null,
    markSent: () => {},
    revoke: async () => true,
  }),
}));

vi.mock('@/hooks/useHandReviewDetails', () => ({
  useHandReviewDetails: (hand: HandRecord | undefined) => ({
    hand,
    privateState: 'ready',
    refresh: vi.fn(),
  }),
}));

const HERO_A = '11111111-1111-4111-8111-111111111111';
const HERO_B = '22222222-2222-4222-8222-222222222222';
const VILLAIN = '33333333-3333-4333-8333-333333333333';

const HAND_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const HAND_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const SAVED_ROW_ID_1 = '99999999-9999-4999-8999-999999999991';
const SAVED_ROW_ID_2 = '88888888-8888-4888-8888-888888888882';

function makeJwt(sub: string): string {
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`;
}

function makeHandRecord(id: string, handNumber: number, heroId = HERO_A): HandRecord {
  return adaptServiceHandToPanel(
    {
      id,
      serial_number: String(handNumber),
      table_id: '44444444-4444-4444-8444-444444444444',
      table_name: 'Midway 1/2',
      played_at: '2026-11-27T10:00:00.000Z',
      hand_number: handNumber,
      total_hands: 0,
      main_pot: 120,
      side_pots: [],
      community_cards: ['Ah', 'Kd', '7c', '2s', '9h'],
      players: [
        {
          seat: 1,
          user_id: heroId,
          username: 'HeroPlayer',
          avatar_url: null,
          position: 'BTN',
          hole_cards: [
            { rank: 'A', suit: 'spades' },
            { rank: 'Q', suit: 'spades' },
          ],
          result: 60,
          is_winner: true,
          showdown_reveal: { reveal_order: 1, mucked: false, hand_name: 'Pair' },
        },
        {
          seat: 2,
          user_id: VILLAIN,
          username: 'VillainPlayer',
          avatar_url: null,
          position: 'BB',
          hole_cards: [
            { rank: 'K', suit: 'clubs' },
            { rank: 'J', suit: 'clubs' },
          ],
          result: -60,
          is_winner: false,
          showdown_reveal: { reveal_order: 2, mucked: false, hand_name: 'Pair' },
        },
      ],
      actions: [
        { player_id: heroId, action: 'raise', amount: 6, street: 'preflop', timestamp: 1 },
        { player_id: VILLAIN, action: 'call', amount: 4, street: 'preflop', timestamp: 2 },
      ],
      winners: [{ user_id: heroId, amount: 120, pot_index: 0, hand_name: 'Pair' }],
      winners_by_board: [],
      rake: 0,
      bbj_fee: 0,
      game_type: 'NLH',
      stakes: '1/2',
    } as unknown as Parameters<typeof adaptServiceHandToPanel>[0],
    heroId
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Previous Hands -> Log This Hand -> Review My Play', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    authMocks.getFreshAccessToken.mockReset();
    authMocks.getFreshAccessToken.mockResolvedValue(makeJwt(HERO_A));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('HandDetailModal logs a hand via POST /api/poker/saved-hands, stays at the table, and links to Personal Assistant Review', async () => {
    const postDeferred = deferred<Response>();
    fetchMock.mockReturnValueOnce(postDeferred.promise);
    const onClose = vi.fn();

    render(
      <HandDetailModal
        isOpen
        onClose={onClose}
        hands={[makeHandRecord(HAND_ID_1, 101)]}
        heroId={HERO_A}
      />
    );

    const logBtn = screen.getByRole('button', { name: 'Log This Hand' });
    fireEvent.click(logBtn);

    const savingBtn = await screen.findByRole('button', { name: 'Saving' });
    expect((savingBtn as HTMLButtonElement).disabled).toBe(true);
    expect(savingBtn.getAttribute('aria-busy')).toBe('true');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/poker/saved-hands');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${makeJwt(HERO_A)}`
    );
    expect(JSON.parse(String(init.body))).toEqual({
      source: 'club-arena',
      handId: HAND_ID_1,
    });

    await act(async () => {
      postDeferred.resolve(jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201));
    });

    expect(await screen.findByText('Hand Saved')).toBeTruthy();
    const reviewLink = screen.getByRole('link', { name: 'Open In Assistant' });
    expect(reviewLink.getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`
    );
    expect(reviewLink.getAttribute('target')).toBe('_blank');
    expect(reviewLink.getAttribute('rel')).toContain('noopener');
    expect(reviewLink.getAttribute('rel')).toContain('noreferrer');
    // Stays at the table: modal/table never closes on save.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('HandHistoryPanel expanded row renders Log This Hand, handles Already Saved (200), and links to review', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, alreadySaved: true, hand: { id: SAVED_ROW_ID_2 } }, 200)
    );
    const onClose = vi.fn();

    render(
      <HandHistoryPanel
        isOpen
        onClose={onClose}
        hands={[makeHandRecord(HAND_ID_2, 102)]}
        heroId={HERO_A}
      />
    );

    // Collapsed initially
    expect(screen.queryByRole('button', { name: 'Log This Hand' })).toBeNull();

    // Expand row
    fireEvent.click(document.querySelector('.hh-entry__summary') as Element);
    const logBtn = screen.getByRole('button', { name: 'Log This Hand' });
    fireEvent.click(logBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/poker/saved-hands');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      source: 'club-arena',
      handId: HAND_ID_2,
    });

    expect(await screen.findByText('Already Saved')).toBeTruthy();
    const reviewLink = screen.getByRole('link', { name: 'Open In Assistant' });
    expect(reviewLink.getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_2}`
    );
    expect(reviewLink.getAttribute('target')).toBe('_blank');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('prevents double-click duplicate POSTs with a single-flight guard', async () => {
    const postDeferred = deferred<Response>();
    fetchMock.mockReturnValue(postDeferred.promise);

    render(
      <HandDetailModal
        isOpen
        onClose={() => {}}
        hands={[makeHandRecord(HAND_ID_1, 101)]}
        heroId={HERO_A}
      />
    );

    const logBtn = screen.getByRole('button', { name: 'Log This Hand' });
    fireEvent.click(logBtn);
    fireEvent.click(logBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      postDeferred.resolve(jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201));
    });

    expect(await screen.findByText('Hand Saved')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('discards stale in-flight response and resets state when the active account changes mid-flight', async () => {
    const postDeferred = deferred<Response>();
    fetchMock.mockReturnValueOnce(postDeferred.promise);

    const hand = makeHandRecord(HAND_ID_1, 101, HERO_A);
    const { rerender } = render(
      <HandDetailModal isOpen onClose={() => {}} hands={[hand]} heroId={HERO_A} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Log This Hand' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Switch account mid-flight
    rerender(<HandDetailModal isOpen onClose={() => {}} hands={[hand]} heroId={HERO_B} />);

    // State immediately resets for Account B
    expect(screen.getByRole('button', { name: 'Log This Hand' })).toBeTruthy();
    expect(screen.queryByText('Hand Saved')).toBeNull();

    // Now the stale response for Account A arrives
    await act(async () => {
      postDeferred.resolve(jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201));
    });

    // Account B MUST NOT see Account A's saved badge or review link
    expect(screen.getByRole('button', { name: 'Log This Hand' })).toBeTruthy();
    expect(screen.queryByText('Hand Saved')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open In Assistant' })).toBeNull();
  });

  it('discards stale in-flight response when paging to another hand in HandDetailModal', async () => {
    const postDeferred = deferred<Response>();
    fetchMock.mockReturnValueOnce(postDeferred.promise);

    const newest = makeHandRecord(HAND_ID_1, 202, HERO_A);
    const older = makeHandRecord(HAND_ID_2, 201, HERO_A);

    render(<HandDetailModal isOpen onClose={() => {}} hands={[newest, older]} heroId={HERO_A} />);

    // Start saving Hand #202
    fireEvent.click(screen.getByRole('button', { name: 'Log This Hand' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Page to older Hand #201 mid-flight
    fireEvent.click(screen.getByRole('button', { name: 'Older Hand' }));
    expect(screen.getByRole('button', { name: 'Log This Hand' })).toBeTruthy();

    // Hand #202's POST resolves late
    await act(async () => {
      postDeferred.resolve(jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201));
    });

    // Hand #201 must stay idle and never inherit Hand #202's receipt
    expect(screen.getByRole('button', { name: 'Log This Hand' })).toBeTruthy();
    expect(screen.queryByText('Hand Saved')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open In Assistant' })).toBeNull();
  });

  it('aborts cleanly without issuing POST when auth resolves late after hand change', async () => {
    const authDeferred = deferred<string | null>();
    authMocks.getFreshAccessToken.mockReturnValueOnce(authDeferred.promise);

    const newest = makeHandRecord(HAND_ID_1, 302, HERO_A);
    const older = makeHandRecord(HAND_ID_2, 301, HERO_A);

    render(<HandDetailModal isOpen onClose={() => {}} hands={[newest, older]} heroId={HERO_A} />);

    fireEvent.click(screen.getByRole('button', { name: 'Log This Hand' }));
    expect(await screen.findByRole('button', { name: 'Saving' })).toBeTruthy();

    // Switch hands BEFORE auth resolves
    fireEvent.click(screen.getByRole('button', { name: 'Older Hand' }));
    expect(screen.getByRole('button', { name: 'Log This Hand' })).toBeTruthy();

    // Late auth resolution arrives
    await act(async () => {
      authDeferred.resolve(makeJwt(HERO_A));
    });

    // No POST was ever sent
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Log This Hand' })).toBeTruthy();
  });

  it('aborts cleanly without issuing POST when auth resolves with a different user JWT subject', async () => {
    const authDeferred = deferred<string | null>();
    authMocks.getFreshAccessToken.mockReturnValueOnce(authDeferred.promise);

    render(
      <HandDetailModal
        isOpen
        onClose={() => {}}
        hands={[makeHandRecord(HAND_ID_1, 305, HERO_A)]}
        heroId={HERO_A}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Log This Hand' }));
    expect(await screen.findByRole('button', { name: 'Saving' })).toBeTruthy();

    // Auth resolves with HERO_B's JWT instead of HERO_A
    await act(async () => {
      authDeferred.resolve(makeJwt(HERO_B));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    // Resets cleanly back to idle (not stuck in Saving, not falsely Saved)
    expect(await screen.findByRole('button', { name: 'Log This Hand' })).toBeTruthy();
    expect(screen.queryByText('Hand Saved')).toBeNull();
  });

  it('reconciles uncertain POST failures via GET readback on Retry and avoids duplicate POST if already persisted', async () => {
    // 1. Initial POST fails with HTTP 503 (uncertain / possibly committed)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Upstream Gateway Timeout' }, 503)
    );
    // 2. Retry first issues GET readback which finds the saved row
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          hands: [{ id: SAVED_ROW_ID_1, source_hand_id: HAND_ID_1 }],
        },
        200
      )
    );

    render(
      <HandDetailModal
        isOpen
        onClose={() => {}}
        hands={[makeHandRecord(HAND_ID_1, 401, HERO_A)]}
        heroId={HERO_A}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Log This Hand' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Error');
    const retryBtn = screen.getByRole('button', { name: 'Retry' });

    fireEvent.click(retryBtn);

    expect(await screen.findByText('Already Saved')).toBeTruthy();
    const reviewLink = screen.getByRole('link', { name: 'Open In Assistant' });
    expect(reviewLink.getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`
    );

    // Exactly 2 calls total: 1st POST, 2nd GET readback — NO duplicate POST!
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(fetchMock.mock.calls[1][0]).toBe(
      `/api/poker/saved-hands?sourceHandId=${encodeURIComponent(HAND_ID_1)}`
    );
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('GET');
  });

  it('re-issues POST on Retry only after GET readback confirms the hand was not persisted', async () => {
    // 1. Initial POST rejects with network error (uncertain)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    // 2. Retry calls GET readback -> confirms not saved
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, hands: [] }, 200));
    // 3. Retry then sends a fresh POST -> 201 Created
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201)
    );

    render(
      <HandDetailModal
        isOpen
        onClose={() => {}}
        hands={[makeHandRecord(HAND_ID_1, 402, HERO_A)]}
        heroId={HERO_A}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Log This Hand' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Error');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Hand Saved')).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('GET');
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe('POST');
  });

  it('rejects malformed 201 receipts (missing hand.id) into Error state and never fabricates success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, hand: {} }, 201));

    render(
      <HandDetailModal
        isOpen
        onClose={() => {}}
        hands={[makeHandRecord(HAND_ID_1, 501, HERO_A)]}
        heroId={HERO_A}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Log This Hand' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Error');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('Hand Saved')).toBeNull();
    expect(screen.queryByText('Already Saved')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open In Assistant' })).toBeNull();
  });

  it('rejects invalid UUIDs client-side and omits the control on spectator empty states or non-UUID fixtures', async () => {
    const result = await logClubArenaHand('not-a-uuid', { accessToken: makeJwt(HERO_A) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_hand_id');
      expect(result.possiblyCommitted).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    // Non-UUID hand id renders nothing
    const { rerender } = render(
      <HandDetailModal
        isOpen
        onClose={() => {}}
        hands={[makeHandRecord('h-legacy-1', 12, HERO_A)]}
        heroId={HERO_A}
      />
    );
    expect(screen.queryByRole('button', { name: 'Log This Hand' })).toBeNull();

    // Spectator empty state renders nothing
    rerender(
      <HandDetailModal isOpen onClose={() => {}} hands={[]} heroId={HERO_A} viewerSeated={false} />
    );
    expect(screen.queryByRole('button', { name: 'Log This Hand' })).toBeNull();
  });

  it('SavedHandsService validates review URLs and strict readback responses', async () => {
    expect(buildPersonalAssistantReviewUrl(SAVED_ROW_ID_1)).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_2, source_hand_id: HAND_ID_2 } }, 200)
    );
    const found = await findSavedClubArenaHand(HAND_ID_2, { accessToken: makeJwt(HERO_A) });
    expect(found).toEqual({ found: true, savedHandId: SAVED_ROW_ID_2 });

    // Non-boolean success on POST -> malformed_receipt with possiblyCommitted: true
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: 'true', hand: { id: SAVED_ROW_ID_1 } }, 201)
    );
    const badPost = await logClubArenaHand(HAND_ID_1, { accessToken: makeJwt(HERO_A) });
    expect(badPost.ok).toBe(false);
    if (!badPost.ok) {
      expect(badPost.code).toBe('malformed_receipt');
      expect(badPost.possiblyCommitted).toBe(true);
    }
  });
});
