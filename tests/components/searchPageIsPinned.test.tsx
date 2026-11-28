/**
 * COMMUNITY SEARCH IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign player pages batch P6, 2026-11-28)
 *
 * /search is moving from the Community page bar and its own painted module to
 * the arena workspace. The condition: no figure, word, data hook, named region
 * or control (with its pressed, selected and disabled state) may change, and
 * every key keeps its behaviour. This renders the real page with synthetic
 * index reads and pins it (tests/helpers/surfacePin.ts) in each state it
 * shows: before a search with and without history, a search in flight, the
 * whole network, one category, no matches, a partial index and an index that
 * did not answer. The page head's title and "?" are the one part the pass
 * replaces; surfacePin leaves them out and reads everything else, the live
 * Results figure included.
 */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const backend = vi.hoisted(() => ({
  community: vi.fn(),
  players: vi.fn(),
  recent: [] as string[],
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'viewer' } }),
}));
vi.mock('../../src/hooks/useDebounce', () => ({ useDebounce: <T,>(value: T) => value }));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: <T,>(key: string, initial: T) =>
    useState<T>(key === 'SearchPage:recentSearches' ? (backend.recent as T) : initial),
}));
vi.mock('../../src/hooks/useKingsClubDisplayTotals', () => ({
  useKingsClubDisplayTotals: () => null,
}));
vi.mock('../../src/components/common/Toast', () => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  return { useToast: () => toast };
});
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribeDebounced: vi.fn(() => () => {}) },
}));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));
vi.mock('../../src/services/PlayerSearchService', () => ({
  PlayerSearchService: {
    search: (args: unknown) => backend.players(args),
    getTableWatchAccess: vi.fn(async () => ({ allowed: true })),
  },
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (_name: string, args: { p_query: string }) => backend.community(args),
    from: () => ({ insert: async () => ({ error: null }) }),
  },
}));

import SearchPage from '../../src/pages/SearchPage';

const HEALTH = { clubs: 412, players: 18250, tables: 96, tournaments: 37 };

const CLUBS = [
  {
    id: 'c1',
    slug: 'kings-club',
    club_number: 4102,
    name: 'Kings Club',
    tagline: 'High Stakes Every Night',
    description: null,
    image_url: null,
    card_image_url: null,
    is_union: false,
    union_id: 'u1',
    union_name: 'Midway Union',
    member_count: 1177,
    online_count: 61,
    table_count: 14,
    seated_count: 48,
    tournament_count: 4,
    level: 7,
    is_public: true,
    requires_approval: true,
    viewer_status: 'active',
    match_score: 1,
  },
  {
    id: 'u1',
    slug: null,
    club_number: null,
    name: 'Midway Union',
    tagline: null,
    description: null,
    image_url: null,
    card_image_url: null,
    is_union: true,
    union_id: null,
    union_name: null,
    member_count: 3120,
    online_count: 200,
    table_count: 40,
    seated_count: 130,
    tournament_count: 9,
    level: null,
    is_public: true,
    requires_approval: false,
    viewer_status: null,
    match_score: 0.8,
  },
];

const TABLES = [
  {
    id: 't1',
    name: 'Kings Main 1',
    game_variant: 'plo',
    game_type: 'cash',
    stakes: '1/2',
    small_blind: 1,
    big_blind: 2,
    current_players: 6,
    max_players: 9,
    status: 'running',
    is_featured: true,
    is_new: false,
    club_id: 'c1',
    club_name: 'Kings Club',
    club_slug: 'kings-club',
    club_is_union: false,
    match_score: 1,
  },
];

const TOURNAMENTS = [
  {
    id: 'm1',
    name: 'sunday major',
    status: 'REGISTERING',
    tournament_type: 'MTT',
    variant: 'nlh',
    buy_in_amount: 100,
    buy_in_fee: 10,
    guaranteed_prize: 25000,
    prize_pool: 0,
    current_players: 212,
    max_players: 500,
    start_time: '2027-01-10T20:00:00Z',
    is_bounty: true,
    is_turbo: false,
    club_id: 'c1',
    club_name: 'Kings Club',
    club_slug: 'kings-club',
    is_registered: false,
    match_score: 1,
  },
];

const PLAYERS = [
  {
    id: 'p1',
    username: 'kingfish',
    display_name: 'KingFish',
    avatar_url: null,
    presence_status: 'playing',
    relationship: 'friend',
    tables: [{ id: 't1', name: 'Kings Main 1' }],
  },
  {
    id: 'p2',
    username: 'kingpin',
    display_name: null,
    avatar_url: null,
    presence_status: 'offline',
    relationship: 'public',
    tables: [],
  },
];

function payload(query: string) {
  if (!query) {
    return {
      clubs: [],
      tables: [],
      tournaments: [],
      totals: { clubs: 0, tables: 0, tournaments: 0 },
      index_health: HEALTH,
      fuzzy: false,
    };
  }
  return {
    clubs: CLUBS,
    tables: TABLES,
    tournaments: TOURNAMENTS,
    totals: { clubs: 9, tables: 1, tournaments: 1 },
    index_health: HEALTH,
    fuzzy: true,
  };
}

function pinFile(name: string) {
  return `./__pins__/search-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

function mount(route = '/search') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SearchPage />
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  backend.recent = [];
  backend.community.mockReset().mockImplementation(async (args: { p_query: string }) => ({
    data: payload(args.p_query),
    error: null,
  }));
  backend.players.mockReset().mockResolvedValue({ items: PLAYERS, total: 2 });
});

afterEach(cleanup);

describe('Community Search prints the same figures, words and controls', () => {
  it('before a search, with no history', async () => {
    const { container } = mount();
    await screen.findByText('Your Submitted Searches Will Appear Here.');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('idle'));
  });

  it('before a search, with history', async () => {
    backend.recent = ['kings', 'sunday major'];
    const { container } = mount();
    await screen.findByRole('button', { name: 'Clear History' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('history'));
  });

  it('a search in flight', async () => {
    backend.community.mockImplementation(async (args: { p_query: string }) =>
      args.p_query ? new Promise(() => {}) : { data: payload(''), error: null }
    );
    const { container } = mount('/search?q=kings');
    await screen.findByRole('status', { name: 'Scanning Community Index' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('scanning'));
  });

  it('the whole network', async () => {
    const { container } = mount('/search?q=kings');
    await screen.findByRole('button', { name: 'Open Kings Club' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('results'));
  });

  it('one category', async () => {
    const { container } = mount('/search?q=kings&type=clubs');
    await screen.findByRole('button', { name: 'Open Midway Union' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('clubs'));
  });

  it('no matches', async () => {
    backend.community.mockImplementation(async () => ({ data: payload(''), error: null }));
    backend.players.mockResolvedValue({ items: [], total: 0 });
    const { container } = mount('/search?q=zzqx');
    await screen.findByText(/No Matches For/);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });

  it('a partial index', async () => {
    backend.players.mockRejectedValue(new Error('players down'));
    const { container } = mount('/search?q=kings');
    await screen.findByRole('alert');
    await screen.findByRole('button', { name: 'Open Kings Club' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('partial'));
  });

  it('an index that did not answer', async () => {
    backend.community.mockImplementation(async (args: { p_query: string }) =>
      args.p_query ? { data: null, error: { message: 'down' } } : { data: payload(''), error: null }
    );
    backend.players.mockRejectedValue(new Error('players down'));
    const { container } = mount('/search?q=kings');
    await screen.findByRole('alert');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });

  it('the scope keys still scope, and Clear still clears', async () => {
    mount('/search?q=kings');
    await screen.findByRole('button', { name: 'Open Kings Club' });
    fireEvent.click(screen.getByRole('tab', { name: /Clubs/ }));
    await settle();
    expect(screen.getByRole('tab', { name: /Clubs/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
    await settle();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });
});
