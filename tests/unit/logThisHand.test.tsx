import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  renderHook,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  act,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import HandHistoryPanel, { type HandRecord } from '@/components/table/HandHistoryPanel';
import { HandDetailModal } from '@/components/table/HandDetailModal';
import LogThisHandControl from '@/components/handdetail/LogThisHandControl';
import { useTableKeyboard } from '@/hooks/useTableKeyboard';
import { adaptServiceHandToPanel } from '@/lib/handHistoryAdapter';
import {
  SAVED_HANDS_BROADCAST_CHANNEL,
  buildPersonalAssistantReviewUrl,
  checkSavedHandsBatch,
  clearSavedHandsCache,
  findSavedClubArenaHand,
  getCachedSavedHand,
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
    exp: 1_900_000_000,
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
    clearSavedHandsCache();
    authMocks.getFreshAccessToken.mockReset();
    authMocks.getFreshAccessToken.mockResolvedValue(makeJwt(HERO_A));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    clearSavedHandsCache();
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
    // 1. Initial batch hydration GET reports hand not yet saved
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, savedByHandId: {} }, 200));
    // 2. Click Log This Hand -> POST returns 200 Already Saved
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

    // Wait for batch hydration GET to settle
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/poker/saved-hands?source=club-arena&handIds=${HAND_ID_2}`
    );

    // Collapsed initially
    expect(screen.queryByRole('button', { name: 'Log This Hand' })).toBeNull();

    // Expand row
    fireEvent.click(document.querySelector('.hh-entry__summary') as Element);
    const logBtn = screen.getByRole('button', { name: 'Log This Hand' });
    fireEvent.click(logBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
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

  it('checkSavedHandsBatch filters invalid UUIDs, caps at 50 IDs, sends Bearer auth, and degrades fail-open', async () => {
    const validUuids = Array.from({ length: 62 }, (_, i) => {
      const hex = (i + 1).toString(16).padStart(12, '0');
      return `10000000-0000-4000-8000-${hex}`;
    });
    const noisyInput = [
      null,
      undefined,
      '',
      'not-a-uuid',
      'h-legacy-99',
      validUuids[0],
      validUuids[0].toUpperCase(), // duplicate
      ...validUuids.slice(1),
    ];

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          savedByHandId: {
            [validUuids[0]]: {
              id: SAVED_ROW_ID_1,
              savedAt: '2026-11-27T11:00:00.000Z',
              status: 'unreviewed',
              reviewUrl: `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`,
            },
          },
        },
        200
      )
    );

    const map = await checkSavedHandsBatch(noisyInput, {
      accessToken: makeJwt(HERO_A),
      userId: HERO_A,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url, 'https://smarter.poker');
    expect(parsedUrl.pathname).toBe('/api/poker/saved-hands');
    expect(parsedUrl.searchParams.get('source')).toBe('club-arena');
    const sentIds = (parsedUrl.searchParams.get('handIds') || '').split(',');
    expect(sentIds).toHaveLength(50);
    expect(sentIds[0]).toBe(validUuids[0]);
    expect(sentIds[49]).toBe(validUuids[49]);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${makeJwt(HERO_A)}`
    );
    expect(map[validUuids[0]]).toEqual({
      id: SAVED_ROW_ID_1,
      savedAt: '2026-11-27T11:00:00.000Z',
      status: 'unreviewed',
      reviewUrl: `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`,
    });

    // Empty / invalid-only input never touches fetch
    expect(await checkSavedHandsBatch(['bad', '', null], { accessToken: makeJwt(HERO_A) })).toEqual(
      {}
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Graceful fail-open on 401, 500, and offline network error
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));
    expect(
      await checkSavedHandsBatch([HAND_ID_1], { accessToken: makeJwt(HERO_A), userId: HERO_A })
    ).toEqual({});

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Internal Server Error' }, 500));
    expect(
      await checkSavedHandsBatch([HAND_ID_1], { accessToken: makeJwt(HERO_A), userId: HERO_A })
    ).toEqual({});

    fetchMock.mockRejectedValueOnce(new TypeError('Offline'));
    expect(
      await checkSavedHandsBatch([HAND_ID_1], { accessToken: makeJwt(HERO_A), userId: HERO_A })
    ).toEqual({});
  });

  it('isolates per-user saved-hand cache and clears prior user entries on account switch', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          savedByHandId: {
            [HAND_ID_1]: {
              id: SAVED_ROW_ID_1,
              savedAt: '2026-11-27T11:05:00.000Z',
              status: 'unreviewed',
              reviewUrl: `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`,
            },
          },
        },
        200
      )
    );

    await checkSavedHandsBatch([HAND_ID_1], {
      accessToken: makeJwt(HERO_A),
      userId: HERO_A,
    });
    expect(getCachedSavedHand(HERO_A, HAND_ID_1)?.savedHandId).toBe(SAVED_ROW_ID_1);

    // Account switches to HERO_B -> HERO_A's cached entries are wiped immediately
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, savedByHandId: {} }, 200));
    await checkSavedHandsBatch([HAND_ID_1], {
      accessToken: makeJwt(HERO_B),
      userId: HERO_B,
    });

    expect(getCachedSavedHand(HERO_B, HAND_ID_1)).toBeNull();
    expect(getCachedSavedHand(HERO_A, HAND_ID_1)).toBeNull();

    // Mismatched token subject vs userId fails open without hitting network
    const callsBefore = fetchMock.mock.calls.length;
    const mismatched = await checkSavedHandsBatch([HAND_ID_1], {
      accessToken: makeJwt(HERO_A),
      userId: HERO_B,
    });
    expect(mismatched).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(callsBefore);
  });

  it('emits BroadcastChannel saved-hand-updated on 201 Created and 200 Already Saved and never throws in restricted contexts', async () => {
    const posted: Array<{ channel: string; payload: unknown }> = [];
    const closeSpy = vi.fn();

    class FakeBroadcastChannel {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      postMessage(payload: unknown) {
        posted.push({ channel: this.name, payload });
      }
      close() {
        closeSpy();
      }
    }

    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201)
    );
    const created = await logClubArenaHand(HAND_ID_1, { accessToken: makeJwt(HERO_A) });
    expect(created.ok).toBe(true);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, alreadySaved: true, hand: { id: SAVED_ROW_ID_2 } }, 200)
    );
    const existing = await logClubArenaHand(HAND_ID_2, { accessToken: makeJwt(HERO_A) });
    expect(existing.ok).toBe(true);

    expect(posted).toHaveLength(2);
    expect(posted[0].channel).toBe(SAVED_HANDS_BROADCAST_CHANNEL);
    expect(posted[0].payload).toEqual({
      type: 'saved-hand-updated',
      source: 'club-arena',
      handId: HAND_ID_1,
      savedRowId: SAVED_ROW_ID_1,
      reviewUrl: `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`,
      at: expect.any(Number),
    });
    expect(posted[1].channel).toBe(SAVED_HANDS_BROADCAST_CHANNEL);
    expect(posted[1].payload).toEqual({
      type: 'saved-hand-updated',
      source: 'club-arena',
      handId: HAND_ID_2,
      savedRowId: SAVED_ROW_ID_2,
      reviewUrl: `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_2}`,
      at: expect.any(Number),
    });
    expect(closeSpy).toHaveBeenCalledTimes(2);

    // Restricted context where BroadcastChannel constructor throws must never break save
    vi.stubGlobal(
      'BroadcastChannel',
      class ThrowingChannel {
        constructor() {
          throw new DOMException('SecurityError');
        }
      }
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201)
    );
    const safeResult = await logClubArenaHand(HAND_ID_1, { accessToken: makeJwt(HERO_A) });
    expect(safeResult.ok).toBe(true);
  });

  it('HandHistoryPanel pre-hydrates already-logged hands as Hand Saved + Open In Assistant and stays in sync with HandDetailModal', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          savedByHandId: {
            [HAND_ID_1]: {
              id: SAVED_ROW_ID_1,
              savedAt: '2026-11-27T11:10:00.000Z',
              status: 'unreviewed',
              reviewUrl: `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`,
            },
          },
        },
        200
      )
    );

    const hand = makeHandRecord(HAND_ID_1, 601, HERO_A);
    render(<HandHistoryPanel isOpen onClose={() => {}} hands={[hand]} heroId={HERO_A} />);

    // Wait for batch hydration GET
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Expand row -> immediately shows "Hand Saved" + "Open In Assistant" without any click or POST
    fireEvent.click(document.querySelector('.hh-entry__summary') as Element);
    expect(await screen.findByText('Hand Saved')).toBeTruthy();
    const reviewLink = screen.getByRole('link', { name: 'Open In Assistant' });
    expect(reviewLink.getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`
    );
    expect(screen.queryByRole('button', { name: 'Log This Hand' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // HandDetailModal reads the same per-user cache and immediately shows saved state
    cleanup();
    render(<HandDetailModal isOpen onClose={() => {}} hands={[hand]} heroId={HERO_A} />);
    expect(screen.getByText('Hand Saved')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open In Assistant' }).getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('LogThisHandControl variant="hud" renders compact HUD states, syncs across same-tab surfaces, and reconciles Retry', async () => {
    const postDeferred = deferred<Response>();
    fetchMock.mockReturnValueOnce(postDeferred.promise);

    // Mount HUD control and HandDetailModal side-by-side in the same tab
    render(
      <>
        <LogThisHandControl variant="hud" handId={HAND_ID_1} accountId={HERO_A} />
        <HandDetailModal
          isOpen
          onClose={() => {}}
          hands={[makeHandRecord(HAND_ID_1, 701, HERO_A)]}
          heroId={HERO_A}
        />
      </>
    );

    const hudBtn = screen.getByRole('button', { name: 'Log Last Hand' });
    expect(hudBtn.getAttribute('aria-keyshortcuts')).toBe('Shift+L');
    fireEvent.click(hudBtn);

    const savingBtn = await screen.findByRole('button', { name: 'Saving' });
    expect((savingBtn as HTMLButtonElement).disabled).toBe(true);
    expect(savingBtn.getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      postDeferred.resolve(jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201));
    });

    // HUD transitions to compact Saved + Open
    expect(await screen.findByText('Saved')).toBeTruthy();
    const openLink = screen.getByRole('link', { name: 'Open' });
    expect(openLink.getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`
    );
    expect(openLink.getAttribute('target')).toBe('_blank');

    // HandDetailModal in the same tab updated instantaneously via per-user cache sync
    expect(await screen.findByText('Hand Saved')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open In Assistant' }).getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`
    );

    // Test Retry flow on HUD variant after 503 failure
    cleanup();
    clearSavedHandsCache();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Temporary Outage' }, 503));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, hands: [{ id: SAVED_ROW_ID_2, source_hand_id: HAND_ID_2 }] })
    );

    render(<LogThisHandControl variant="hud" handId={HAND_ID_2} accountId={HERO_A} />);
    fireEvent.click(screen.getByRole('button', { name: 'Log Last Hand' }));
    const retryBtn = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('alert').textContent).toContain('Temporary Outage');
    fireEvent.click(retryBtn);
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_2}`
    );
  });

  it('Shift+L triggers logging on a completed hand, ignores inputs/modifiers, and stays disabled with no completed hand', async () => {
    // 1. Disabled when no completed hand exists (null or synthetic non-UUID)
    const { rerender } = render(
      <LogThisHandControl variant="hud" handId={null} accountId={HERO_A} />
    );
    expect(screen.queryByRole('button', { name: 'Log Last Hand' })).toBeNull();
    fireEvent.keyDown(window, { key: 'L', shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <LogThisHandControl variant="hud" handId="synthetic-mid-hand-42" accountId={HERO_A} />
    );
    expect(screen.queryByRole('button', { name: 'Log Last Hand' })).toBeNull();
    fireEvent.keyDown(window, { key: 'L', shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    // 2. Active completed canonical UUID: ignored inside input, textarea, select, contenteditable, or with Ctrl/Meta/Alt
    rerender(
      <>
        <input aria-label="Chat Input" />
        <textarea aria-label="Note Area" />
        <select aria-label="Filter Select">
          <option value="all">All</option>
        </select>
        <div data-testid="editable-div" contentEditable="true" suppressContentEditableWarning />
        <LogThisHandControl variant="hud" handId={HAND_ID_1} accountId={HERO_A} />
      </>
    );

    const input = screen.getByLabelText('Chat Input');
    const textarea = screen.getByLabelText('Note Area');
    const select = screen.getByLabelText('Filter Select');
    const editable = screen.getByTestId('editable-div');

    fireEvent.keyDown(input, { key: 'L', shiftKey: true });
    fireEvent.keyDown(textarea, { key: 'L', shiftKey: true });
    fireEvent.keyDown(select, { key: 'L', shiftKey: true });
    fireEvent.keyDown(editable, { key: 'L', shiftKey: true });
    fireEvent.keyDown(window, { key: 'L', shiftKey: true, ctrlKey: true });
    fireEvent.keyDown(window, { key: 'L', shiftKey: true, metaKey: true });
    fireEvent.keyDown(window, { key: 'L', shiftKey: true, altKey: true });
    fireEvent.keyDown(window, { key: 'l', shiftKey: false });
    expect(fetchMock).not.toHaveBeenCalled();

    // 3. Valid Shift+L on the table triggers POST and transitions to Saved + Open
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, hand: { id: SAVED_ROW_ID_1 } }, 201)
    );
    fireEvent.keyDown(window, { key: 'L', shiftKey: true });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      `/hub/personal-assistant/review?hand=${SAVED_ROW_ID_1}`
    );

    // Subsequent Shift+L after save does not send duplicate POST
    fireEvent.keyDown(window, { key: 'L', shiftKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('useTableKeyboard routes Shift+L only on the active non-modal table and TablePage wires HUD bookmark cleanly', () => {
    const onLogLastHand = vi.fn();
    const baseOpts = {
      isActive: true,
      isHeroTurn: false,
      isSpectator: false,
      isModalOpen: false,
      isSizingOpen: false,
      onLogLastHand,
    };

    const { rerender } = renderHook(
      (opts: Parameters<typeof useTableKeyboard>[0]) => useTableKeyboard(opts),
      { initialProps: baseOpts }
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', shiftKey: true, bubbles: true }));
    expect(onLogLastHand).toHaveBeenCalledTimes(1);

    // Ignored with Ctrl/Meta/Alt
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'L', shiftKey: true, ctrlKey: true, bubbles: true })
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'L', shiftKey: true, metaKey: true, bubbles: true })
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'L', shiftKey: true, altKey: true, bubbles: true })
    );
    expect(onLogLastHand).toHaveBeenCalledTimes(1);

    // Ignored on inactive table, spectator, or open modal
    rerender({ ...baseOpts, isActive: false });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', shiftKey: true, bubbles: true }));
    rerender({ ...baseOpts, isSpectator: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', shiftKey: true, bubbles: true }));
    rerender({ ...baseOpts, isModalOpen: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', shiftKey: true, bubbles: true }));
    expect(onLogLastHand).toHaveBeenCalledTimes(1);

    // TablePage wires HUD LogThisHandControl via useTableKeyboard (zero duplicate keydown listener)
    const tablePage = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    expect(tablePage).toContain('variant="hud"');
    expect(tablePage).toContain('handId={lastCompletedHandId}');
    expect(tablePage).toContain('registerHotkey={registerLogLastHandHotkey}');
    expect(tablePage).toContain('onLogLastHand: () => logLastHandHotkeyRef.current?.()');
    expect(tablePage.match(/^\s*window\.addEventListener\('keydown'/gm) ?? []).toHaveLength(0);
  });
});
