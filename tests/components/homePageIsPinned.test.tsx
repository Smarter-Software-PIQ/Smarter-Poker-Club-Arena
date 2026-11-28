/**
 * HOME PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch H1, 2026-11-28)
 *
 * / (authenticated HomePage) moves onto the arena workspace root and chrome
 * mast, and replaces its three non-dialog SpadeConsole sections (error
 * boundary, load failed, empty onboarding) with arena cases while keeping its
 * two modals (Keyboard Shortcuts, Leave Club?) and ClubEntryActionBar intact.
 * The h1 title ("Poker Arena") moves into ArenaWorkspaceHeader, which
 * surfacePin excludes; everything else is pinned unchanged.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const h = vi.hoisted(() => ({
  userId: 'viewer-a',
  memberships: vi.fn(),
  ownedUnions: vi.fn(),
  navigate: vi.fn(),
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  bus: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  carouselError: null as string | null,
}));

vi.mock('../../src/lib/supabase', () => ({
  getAuthUser: async () => ({ data: { user: { id: h.userId } }, error: null }),
  supabase: {
    rpc: vi.fn(async () => ({ data: [], error: null })),
    from: vi.fn(() => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) })),
  },
}));
vi.mock('../../src/services/ClubsService', () => ({
  ClubsService: { getUserMemberships: h.memberships },
}));
vi.mock('../../src/services/UnionService', () => ({
  UnionService: { getOwnedUnions: h.ownedUnions },
}));
vi.mock('../../src/services/ClubJoinService', () => ({
  ClubJoinService: { resumePending: async () => null },
}));
vi.mock('../../src/services/ClubEntryTrustService', () => ({
  ClubEntryTrustService: {
    getFlags: async () => ({ create_club: true, find_player: true, join_club: true }),
    track: vi.fn(),
  },
}));
vi.mock('../../src/services/ClubCardBackfill', () => ({ backfillClubCards: vi.fn() }));
vi.mock('../../src/context/InTabLobbyContext', () => ({
  useAppNavigate: () => h.navigate,
  useInTabLobby: () => null,
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: h.userId }, isHydrating: false }),
}));
vi.mock('../../src/core/MasterBus', () => {
  const subscribe = (key: string, callback: (event: { payload: unknown }) => void) => {
    const handlers = h.bus.get(key) ?? new Set();
    handlers.add(callback);
    h.bus.set(key, handlers);
    return () => handlers.delete(callback);
  };
  return { masterBus: { subscribe, subscribeDebounced: subscribe, emit: vi.fn() } };
});
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => h.toast }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/utils/ChunkPreloader', () => ({ preloadRoute: vi.fn() }));
vi.mock('../../src/services/HapticService', () => ({
  default: { light: vi.fn(), medium: vi.fn() },
}));
vi.mock('../../src/utils/playPremiumSfx', () => ({ playPremiumSfx: vi.fn() }));
vi.mock('../../src/components/navigation/GlobalHeader', () => ({ default: () => null }));
vi.mock('../../src/components/home/FloatingOrbs', () => ({ default: () => null }));
vi.mock('../../src/components/home/CarouselSection', () => ({
  default: ({ displayClubs }: { displayClubs: Array<{ id: string; name: string }> }) => {
    if (h.carouselError) throw new Error(h.carouselError);
    return (
      <div data-testid="carousel-stub">
        {displayClubs.map((c) => (
          <span key={c.id}>{c.name}</span>
        ))}
      </div>
    );
  },
}));
vi.mock('../../src/components/home/ClubContextMenu', () => ({ default: () => null }));
vi.mock('../../src/components/modals/CreateClubModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Create A Club" /> : null,
}));
vi.mock('../../src/components/modals/FindPlayerModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Find A Player" /> : null,
}));
vi.mock('../../src/components/modals/JoinClubModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Join A Club" /> : null,
}));
vi.mock('../../src/components/daily-bonus/DailyBonusEntry', () => ({ default: () => null }));
vi.mock('../../src/components/home/PendingInviteForward', () => ({ default: () => null }));

import HomePage from '../../src/pages/HomePage';

function homePin(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  // The lone h1 ("Poker Arena") moves into ArenaWorkspaceHeader, which
  // surfacePin already strips via .arena-workspace-mast.
  for (const el of clone.querySelectorAll('h1')) el.remove();
  return surfacePin(clone);
}

function mount() {
  return render(
    <MemoryRouter>
      <HomePage />
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
  localStorage.clear();
  h.bus.clear();
  h.carouselError = null;
  h.userId = 'viewer-a';
  h.memberships.mockResolvedValue([
    {
      role: 'owner',
      club: {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'alpha-club',
        name: 'Alpha Club',
        member_count: 15,
        is_union: false,
      },
    },
  ]);
  h.ownedUnions.mockResolvedValue([]);
});

afterEach(cleanup);

describe('HomePage prints the same figures, words, regions and controls', () => {
  it('ready state with user clubs and action bar', async () => {
    const { container } = mount();
    await screen.findByText('Alpha Club');
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Poker Arena' })).toBeInTheDocument();
    expect(homePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create A Club|",
          "button|button|Find A Player|",
          "button|button|Join A Club|",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-testid=carousel-stub",
          ],
        },
        "regions": [
          "div|main|Poker Arena Home",
          "nav||Poker Arena Actions",
          "button||Create A Club",
          "button||Find A Player",
          "button||Join A Club",
        ],
        "text": "Alpha Club | Kings Club",
      }
    `);
  });

  it('load failed state with retry control', async () => {
    h.memberships.mockRejectedValue(new Error('db down'));
    const { container } = mount();
    await screen.findByText('Could Not Load Your Clubs');
    await settle();
    expect(homePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create A Club|",
          "button|button|Find A Player|",
          "button|button|Join A Club|",
          "button|button|Try Again|",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-testid=carousel-stub",
          ],
        },
        "regions": [
          "div|main|Poker Arena Home",
          "nav||Poker Arena Actions",
          "button||Create A Club",
          "button||Find A Player",
          "button||Join A Club",
          "section|status|",
        ],
        "text": "Could Not Load Your Clubs | Error | Your Clubs Are Still There - We Just Could Not Reach Them Right Now. This Is Usually Brief. Try Again In A Moment.",
      }
    `);

    h.memberships.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    await settle();
    expect(h.memberships).toHaveBeenCalledTimes(2);
  });

  it('carousel error boundary fallback renders and retries', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.carouselError = 'carousel render failed';
    const { container } = mount();
    await screen.findByText('Something Went Wrong');
    await settle();
    expect(homePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create A Club|",
          "button|button|Find A Player|",
          "button|button|Join A Club|",
          "button|button|Retry|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|main|Poker Arena Home",
          "nav||Poker Arena Actions",
          "button||Create A Club",
          "button||Find A Player",
          "button||Join A Club",
          "section|alert|",
        ],
        "text": "Something Went Wrong | Error | Carousel Render Failed",
      }
    `);

    h.carouselError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Alpha Club');
    spy.mockRestore();
  });

  it('keyboard shortcuts dialog opens on ? and closes on button click', async () => {
    mount();
    await screen.findByText('Alpha Club');
    fireEvent.keyDown(window, { key: '?' });
    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument();
  });

  it('action bar opens Create, Find and Join modals', async () => {
    mount();
    await screen.findByText('Alpha Club');
    fireEvent.click(screen.getByRole('button', { name: 'Create A Club' }));
    expect(await screen.findByRole('dialog', { name: 'Create A Club' })).toBeInTheDocument();
  });
});
