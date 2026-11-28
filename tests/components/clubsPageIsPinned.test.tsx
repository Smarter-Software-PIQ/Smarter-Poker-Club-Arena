/**
 * CLUBS PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch H1, 2026-11-28)
 *
 * /clubs-list (ClubsPage + ClubDiscovery) moves from six painted SpadeConsole
 * frames to the arena workspace. The condition: no printed figure, word, data
 * hook, named region or control state may change, and every tab and action
 * keeps its behaviour. The page head console's `.sc__head` and redundant
 * `.sc__eyebrow` labels are the one part the pass replaces with
 * ArenaWorkspaceHeader and arena-section-title; everything else is pinned
 * unchanged via tests/helpers/surfacePin.ts.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const fixture = vi.hoisted(() => ({
  user: { id: 'owner-1' } as { id: string } | null,
  memberships: vi.fn(),
  unions: vi.fn(),
  join: vi.fn(),
  search: vi.fn(),
  discoveryRows: [] as Array<Record<string, unknown>>,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'limit', 'order']) query[method] = () => query;
  query.then = (onFulfilled: (value: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: fixture.discoveryRows, error: null }).then(onFulfilled);
  return {
    getAuthUser: async () => ({ data: { user: fixture.user }, error: null }),
    supabase: { from: () => query },
  };
});
vi.mock('../../src/services/ClubsService', () => ({
  ClubsService: {
    getUserMemberships: fixture.memberships,
    search: fixture.search,
  },
}));
vi.mock('../../src/services/ClubJoinService', () => ({
  ClubJoinService: { join: fixture.join },
}));
vi.mock('../../src/services/UnionService', () => ({
  unionService: { getMyUnions: fixture.unions },
}));
vi.mock('../../src/services/KingsClubDisplayService', () => ({
  readKingsClubDisplayTotals: vi.fn(async () => ({ member_total: 1200 })),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => fixture.toast,
}));
vi.mock('../../src/services/HapticService', () => ({
  default: { selection: vi.fn(), success: vi.fn(), light: vi.fn(), medium: vi.fn() },
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    subscribe: vi.fn(() => () => {}),
    subscribeDebounced: vi.fn(() => () => {}),
    emit: vi.fn(),
  },
}));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({
  useMasterBusSubscription: vi.fn(),
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({
  useVisibilityRefresh: vi.fn(),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/IntroVideo', () => ({ default: () => null }));
vi.mock('../../src/components/modals/CreateClubModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Create A Club" /> : null,
}));
vi.mock('../../src/components/modals/JoinClubModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Join A Club" /> : null,
}));

import ClubsPage from '../../src/pages/ClubsPage';

const CLUB_ROWS = [
  {
    id: 'm1',
    club_id: 'club-1',
    role: 'owner',
    club: {
      id: 'club-1',
      slug: 'alpha-room',
      club_id: 25451,
      name: 'Alpha Room',
      member_count: 84,
      level: 3,
      owner_id: 'owner-1',
    },
  },
  {
    id: 'm2',
    club_id: 'club-2',
    role: 'player',
    club: {
      id: 'club-2',
      slug: 'river-room',
      club_id: 77777,
      name: 'River Room',
      member_count: 420,
      level: 5,
      owner_id: 'owner-2',
    },
  },
];

const UNION_ROWS = [
  {
    id: 'union-1',
    slug: 'midway-union',
    name: 'Midway Union',
    ownerId: 'owner-1',
    clubCount: 6,
    memberCount: 1500,
    totalRake: 25000,
  },
];

const DISCOVERY_ROWS = [
  {
    id: 'disc-1',
    club_id: 99100,
    slug: 'open-felt',
    name: 'Open Felt',
    description: 'nightly cash and mtt action',
    member_count: 250,
    table_count: 4,
    requires_approval: false,
    is_public: true,
    tags: ['nlh', 'plo'],
    game_type: null,
    average_rating: 4.8,
    level: 4,
  },
  {
    id: 'disc-2',
    club_id: 99101,
    slug: 'vault-club',
    name: 'Vault Club',
    description: null,
    member_count: 40,
    table_count: 0,
    requires_approval: true,
    is_public: true,
    tags: [],
    game_type: null,
    average_rating: 0,
    level: 2,
  },
];

function clubsPin(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  // The header console's head (title + pill) moves into ArenaWorkspaceHeader,
  // and each console's redundant eyebrow is retired with SpadeConsole.
  const firstConsoleHead = clone.querySelector('.sc > .sc__head');
  if (firstConsoleHead && firstConsoleHead.textContent?.includes('Clubs')) {
    firstConsoleHead.remove();
  }
  for (const el of clone.querySelectorAll('.sc__eyebrow')) el.remove();
  return surfacePin(clone);
}

function mount(route = '/clubs-list') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ClubsPage />
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
  fixture.user = { id: 'owner-1' };
  fixture.memberships.mockResolvedValue(CLUB_ROWS);
  fixture.unions.mockResolvedValue(UNION_ROWS);
  fixture.join.mockResolvedValue({ success: true, status: 'active' });
  fixture.search.mockResolvedValue([]);
  fixture.discoveryRows = DISCOVERY_ROWS;
});

afterEach(cleanup);

describe('ClubsPage prints the same figures, words, regions and controls', () => {
  it('loading state', async () => {
    fixture.memberships.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await settle();
    expect(clubsPin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create Club|",
          "button|button|Discover|aria-selected=false",
          "button|button|Join With Code|",
          "button|button|My Clubs|aria-selected=true",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|tablist|Club Views",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "div|status|Loading content",
        ],
        "text": "My Clubs",
      }
    `);
  });

  it('populated my clubs and unions', async () => {
    const { container } = mount();
    await screen.findByText('Alpha Room');
    await screen.findByText('Midway Union');
    await settle();
    expect(screen.getByRole('heading', { name: 'Clubs' })).toBeInTheDocument();
    expect(clubsPin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create Club|",
          "button|button|Discover|aria-selected=false",
          "button|button|Enter Alpha Room|",
          "button|button|Enter River Room|",
          "button|button|Join With Code|",
          "button|button|Manage Midway Union|",
          "button|button|My Clubs|aria-selected=true",
        ],
        "money": {
          "figures": [
            "84",
            "Lv.14 Growing Club",
            "25451",
            "420",
            "Lv.27 Regional Operator",
            "77777",
            "1 Union",
            "6",
            "1,500",
            "25,000",
          ],
          "hooks": [],
        },
        "regions": [
          "div|tablist|Club Views",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "button||Enter Alpha Room",
          "button||Enter River Room",
          "button||Manage Midway Union",
        ],
        "text": "My Clubs | Alpha Room | Owner | Members | 84 | Role | Owner | Level | Lv.14 Growing Club | Club ID | 25451 | River Room | Members | 420 | Role | Player | Level | Lv.27 Regional Operator | Club ID | 77777 | Unions | 1 Union | Midway Union | Union | Owner | Clubs | 6 | Members | 1,500 | Total Rake | 25,000",
      }
    `);
  });

  it('empty state with no clubs and no unions', async () => {
    fixture.memberships.mockResolvedValue([]);
    fixture.unions.mockResolvedValue([]);
    const { container } = mount();
    await screen.findByText('No Clubs Yet');
    await settle();
    expect(clubsPin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create Club|",
          "button|button|Create Club|",
          "button|button|Discover|aria-selected=false",
          "button|button|Join With Code|",
          "button|button|My Clubs|aria-selected=true",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|tablist|Club Views",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "section|status|",
        ],
        "text": "CLUB | Club Network | No Clubs Yet | Create Your First Club Or Join An Existing One To Start Playing.",
      }
    `);

    fireEvent.click(screen.getAllByRole('button', { name: 'Create Club' })[0]);
    expect(screen.getByRole('dialog', { name: 'Create A Club' })).toBeInTheDocument();
  });

  it('unions-only state', async () => {
    fixture.memberships.mockResolvedValue([]);
    fixture.unions.mockResolvedValue(UNION_ROWS);
    const { container } = mount();
    await screen.findByText('Your Clubs Are Nested Under Your Unions Below.');
    await settle();
    expect(clubsPin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create Club|",
          "button|button|Discover|aria-selected=false",
          "button|button|Join With Code|",
          "button|button|Manage Midway Union|",
          "button|button|My Clubs|aria-selected=true",
        ],
        "money": {
          "figures": [
            "1 Union",
            "6",
            "1,500",
            "25,000",
          ],
          "hooks": [],
        },
        "regions": [
          "div|tablist|Club Views",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "button||Manage Midway Union",
        ],
        "text": "My Clubs | Your Clubs Are Nested Under Your Unions Below. | Unions | 1 Union | Midway Union | Union | Owner | Clubs | 6 | Members | 1,500 | Total Rake | 25,000",
      }
    `);
  });

  it('discover tab with ClubDiscovery rows and actions', async () => {
    const { container } = mount();
    await screen.findByText('Alpha Room');
    fireEvent.click(screen.getByRole('tab', { name: 'Discover' }));
    await screen.findByText('Open Felt');
    await settle();
    expect(clubsPin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Active|aria-pressed=false",
          "button|button|All|aria-pressed=false",
          "button|button|Create Club|",
          "button|button|Discover|aria-selected=true",
          "button|button|Join Open Felt|",
          "button|button|Join With Code|",
          "button|button|My Clubs|aria-selected=false",
          "button|button|New|aria-pressed=false",
          "button|button|Popular|aria-pressed=true",
          "button|button|Request To Join Vault Club|",
          "button|button|View Open Felt|",
          "button|button|View Vault Club|",
          "input|search||value=",
        ],
        "money": {
          "figures": [
            "2 Clubs",
            "250",
            "4 Live",
            "Lv.23 Large Club",
            "4 / 5",
            "40",
            "0",
            "Lv.9 Small Club",
          ],
          "hooks": [],
        },
        "regions": [
          "div|tablist|Club Views",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "div|group|Club Views",
          "button||View Open Felt",
          "button||Join Open Felt",
          "button||View Vault Club",
          "button||Request To Join Vault Club",
        ],
        "text": "Discover Clubs | 2 Clubs | Search | Open Felt | Nightly Cash And MTT Action | Members | 250 | Tables | 4 Live | Level | Lv.23 Large Club | Games | NLH, PLO | Rating | 4 / 5 | Vault Club | Private | Members | 40 | Tables | 0 | Level | Lv.9 Small Club",
      }
    `);

    fireEvent.click(screen.getByRole('button', { name: 'Join Open Felt' }));
    await waitFor(() => expect(fixture.join).toHaveBeenCalledWith({ identifier: 'disc-1' }));
  });
});
