/**
 * PUBLIC PROFILE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign player pages batch P7, 2026-11-28)
 *
 * /profile/:userId is moving from its obsidian module plate onto the arena
 * workspace (visual twin of ProfilePage). The condition: no figure, word,
 * named region or control (with its disabled state) may change, and every
 * action keeps its behaviour. This renders the real page with synthetic
 * service reads and pins it (tests/helpers/surfacePin.ts) in each state it
 * shows: loading, player not found, ready with full arena record / mutuals /
 * playing-at / QR, pending received friend request, friends, and blocked
 * (where Report stays reachable).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const backend = vi.hoisted(() => ({
  getPublicProfile: vi.fn(),
  getMutualFriends: vi.fn(),
  isBlocked: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  getPlayerStatus: vi.fn(),
  readRecord: vi.fn(),
  friendshipRows: [] as Array<{ status: string; user_id: string }>,
  insertFriendship: vi.fn(),
  rpc: vi.fn(),
  shareLink: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'viewer-1' } }),
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({
  useVisibilityRefresh: () => {},
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => backend.toast,
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribeDebounced: vi.fn(() => () => {}) },
}));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));
vi.mock('../../src/services/ProfileService', () => ({
  profileService: {
    getPublicProfile: (...args: unknown[]) => backend.getPublicProfile(...args),
  },
}));
vi.mock('../../src/services/FriendSuggestionService', () => ({
  friendSuggestionService: {
    getMutualFriends: (...args: unknown[]) => backend.getMutualFriends(...args),
  },
}));
vi.mock('../../src/services/BlockService', () => ({
  blockService: {
    isBlocked: (...args: unknown[]) => backend.isBlocked(...args),
    blockUser: (...args: unknown[]) => backend.blockUser(...args),
    unblockUser: (...args: unknown[]) => backend.unblockUser(...args),
  },
}));
vi.mock('../../src/services/PlayerStatusService', () => ({
  playerStatusService: {
    getPlayerStatus: (...args: unknown[]) => backend.getPlayerStatus(...args),
    generateProfileLink: (id: string) => `https://smarter.poker/hub/club-arena/profile/${id}`,
  },
}));
vi.mock('../../src/services/PublicArenaRecordRead', () => ({
  readSeparatedPublicArenaRecord: (...args: unknown[]) => backend.readRecord(...args),
}));
vi.mock('../../src/lib/share', () => ({
  shareButtonLabel: () => 'Copy Profile Link',
  shareLink: (...args: unknown[]) => backend.shareLink(...args),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        or: () => ({
          limit: async () => ({ data: backend.friendshipRows, error: null }),
        }),
        eq: () => ({
          eq: () => ({
            eq: () => ({
              limit: async () => ({ data: [{ id: 'fr-1' }], error: null }),
            }),
          }),
        }),
      }),
      insert: (...args: unknown[]) => backend.insertFriendship(...args),
    }),
    rpc: (...args: unknown[]) => backend.rpc(...args),
  },
}));

import PublicProfilePage from '../../src/pages/PublicProfilePage';

const PROFILE = {
  id: 'target-1',
  username: 'riverrat',
  displayName: 'RiverRat',
  avatarUrl: null,
  bio: 'Deep Stack PLO Regular.',
  vipStatus: 'lifetime' as const,
  level: 1,
  playerNumber: '48219',
  createdAt: '2025-10-03T00:00:00Z',
};

const RECORD = {
  hands: 1412,
  clubs: 2,
  vpip: 32.93,
  pfr: 24.1,
  tournamentsPlayed: 21,
  tournamentsWon: 7,
};

const MUTUALS = [
  { id: 'm1', arenaName: 'AceHigh', avatarUrl: undefined },
  { id: 'm2', arenaName: 'NutFlush', avatarUrl: undefined },
];

const STATUS = {
  playingAt: 'Kings Main 1',
  playingAtTableId: 'table-1',
  statusText: 'Running Deep In The Sunday Major',
};

function pinFile(name: string) {
  return `./__pins__/public-profile-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

function mount(route = '/profile/target-1') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/profile/:userId" element={<PublicProfilePage />} />
        <Route path="/search" element={<div data-testid="search-route">Search</div>} />
        <Route path="/report/:playerId" element={<div data-testid="report-route">Report</div>} />
        <Route path="/messages" element={<div data-testid="messages-route">Messages</div>} />
        <Route path="/table/:tableId" element={<div data-testid="table-route">Table</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.friendshipRows = [];
  backend.getPublicProfile.mockResolvedValue(PROFILE);
  backend.getMutualFriends.mockResolvedValue(MUTUALS);
  backend.isBlocked.mockResolvedValue(false);
  backend.blockUser.mockResolvedValue(true);
  backend.unblockUser.mockResolvedValue(true);
  backend.getPlayerStatus.mockResolvedValue(STATUS);
  backend.readRecord.mockResolvedValue(RECORD);
  backend.insertFriendship.mockResolvedValue({ error: null });
  backend.rpc.mockResolvedValue({ data: { success: true }, error: null });
  backend.shareLink.mockResolvedValue('copied');
});

afterEach(cleanup);

describe('Public Profile prints the same figures, words and controls', () => {
  it('while loading', async () => {
    backend.getPublicProfile.mockImplementation(() => new Promise(() => {}));
    const { container } = mount();
    await screen.findByText('Loading Profile...');
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loading'));
  });

  it('when the player is not found', async () => {
    backend.getPublicProfile.mockResolvedValue(null);
    const { container } = mount();
    await screen.findByText('Player Not Found');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });

  it('when ready with record, mutuals, playing-at and QR', async () => {
    const { container } = mount();
    await screen.findByText('RiverRat');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('ready'));
  });

  it('when a friend request is waiting for acceptance', async () => {
    backend.friendshipRows = [{ status: 'pending', user_id: 'target-1' }];
    const { container } = mount();
    await screen.findByRole('button', { name: '✓ Accept Request' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('pending-received'));
  });

  it('when already friends', async () => {
    backend.friendshipRows = [{ status: 'accepted', user_id: 'viewer-1' }];
    const { container } = mount();
    await screen.findByRole('button', { name: '✓ Friends' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('friends'));
  });

  it('when blocked, keeping Report reachable', async () => {
    backend.isBlocked.mockResolvedValue(true);
    const { container } = mount();
    await screen.findByRole('button', { name: 'Unblock' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('blocked'));
  });

  it('keeps Add Friend, Share and Report wired', async () => {
    mount();
    await screen.findByRole('button', { name: 'Add Friend' });
    fireEvent.click(screen.getByRole('button', { name: 'Add Friend' }));
    await screen.findByRole('button', { name: 'Request Sent' });
    expect(backend.insertFriendship).toHaveBeenCalledWith({
      user_id: 'viewer-1',
      friend_id: 'target-1',
      status: 'pending',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy Profile Link' }));
    await settle();
    expect(backend.shareLink).toHaveBeenCalledWith({
      source: 'PublicProfilePage.share',
      title: 'Smarter Poker Player',
      url: 'https://smarter.poker/hub/club-arena/profile/target-1',
    });
    expect(backend.toast.success).toHaveBeenCalledWith('Profile Link Copied');

    fireEvent.click(screen.getByRole('button', { name: 'Report RiverRat' }));
    await screen.findByTestId('report-route');
  });
});
