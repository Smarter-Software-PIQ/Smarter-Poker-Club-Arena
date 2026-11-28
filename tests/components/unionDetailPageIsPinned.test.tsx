/**
 * THE UNION COMMAND PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch U1, 2026-11-28)
 *
 * /unions/:unionId moves from its own gradient dress to the arena workspace.
 * The condition: no printed figure, word, data hook, named region or control
 * state may change. This renders the real page with synthetic reads and pins
 * all five (tests/helpers/surfacePin.ts), plus the words inside every link, in
 * each state the page shows: every tab with a full union, every tab with an
 * empty one (no clubs, tables, tournaments or statements, the statement read
 * failed), and the first load, a failed resolution, a failed read, Union Not
 * Found and the management check. The page head is left out of the reading:
 * it is the one part the pass replaces. The snapshots were recorded against
 * the old page on main 65a64d1f6 and are unchanged by the pass.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const fixture = vi.hoisted(() => ({
  status: 'ready' as 'loading' | 'ready' | 'not_found' | 'error',
  union: null as unknown,
  clubs: [] as unknown[],
  tables: [] as unknown[],
  tournaments: [] as unknown[],
  schedules: [] as unknown[],
  report: null as unknown,
  admin: true as boolean | null,
  getUnion: vi.fn(),
  getUnionClubs: vi.fn(),
  getUnionTables: vi.fn(),
  getSettlementReport: vi.fn(),
  isUnionAdmin: vi.fn(),
  toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
}));

vi.mock('../../src/hooks/useUnionRouteId', () => ({
  useUnionRouteId: () => ({
    unionId: fixture.status === 'ready' ? 'union-1' : undefined,
    unionRef: 'midway-union',
    resolutionStatus: fixture.status,
    retryResolution: () => {},
  }),
}));
vi.mock('../../src/services/UnionService', () => ({
  unionService: {
    getUnion: fixture.getUnion,
    getUnionClubs: fixture.getUnionClubs,
    getSettlementReport: fixture.getSettlementReport,
    getOnlineCount: async () => 87,
    isUnionAdmin: fixture.isUnionAdmin,
    updateUnion: vi.fn(),
    addClub: vi.fn(),
  },
}));
vi.mock('../../src/services/UnionApiService', () => ({ unionApi: { requestLeave: vi.fn() } }));
vi.mock('../../src/services/TableService', () => ({
  tableService: { getUnionTables: fixture.getUnionTables },
}));
vi.mock('../../src/services/ClubsService', () => ({ getUserMemberships: async () => [] }));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'owner-a' } }),
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('../../src/hooks/useKingsClubDisplayTotals', () => ({
  useKingsClubDisplayTotals: () => null,
}));
vi.mock('../../src/hooks/useTournamentScheduleList', () => ({
  useTournamentScheduleList: () => ({
    schedules: fixture.schedules,
    loading: false,
    error: null,
    updateActive: () => {},
  }),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => fixture.toast,
  useOptionalToast: () => null,
}));
vi.mock('../../src/components/club/GameCreationActions', () => ({
  default: () => <button type="button">Create Game</button>,
}));
vi.mock('../../src/components/union/UnionClubGovernance', () => ({
  default: ({ clubName }: { clubName: string }) => (
    <button type="button">Governance For {clubName}</button>
  ),
}));
vi.mock('../../src/components/club/CreateTournamentModal', () => ({ default: () => null }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/lib/supabase', () => {
  const query = () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => Promise.resolve({ data: [], error: null }),
      then: (ok: (r: unknown) => unknown) =>
        Promise.resolve({ data: fixture.tournaments, error: null }).then(ok),
    };
    return q;
  };
  return { supabase: { from: query, rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() } };
});
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    getOrCreateChannel: () => {
      const channel: any = {};
      channel.on = () => channel;
      channel.subscribe = () => channel;
      return channel;
    },
    subscribeDebounced: () => () => {},
    removeRegisteredChannel: vi.fn(),
    emit: vi.fn(),
  },
}));

import UnionDetailPage from '../../src/pages/UnionDetailPage';

const UNION = {
  id: 'union-1',
  slug: 'midway-union',
  name: 'Midway Union',
  description: 'Every Midway Club Under One Network.',
  ownerId: 'owner-a',
  isPublic: true,
  memberCount: 1284,
  clubCount: 3,
  totalRake: 0,
  level: 7,
  playerLevel: 7,
  hierarchyLevel: 3,
  totalPlayers: 1284,
  hierarchyUnits: 3,
  hierarchyUnitsRoundedUp: 3,
  playerThresholdCurrent: 1000,
  playerThresholdNext: 1500,
  hierarchyThresholdCurrent: 3,
  hierarchyThresholdNext: 4,
  ecoTermsEffectiveFrom: '2026-11-16',
  settings: {
    revenueSharePercent: 12,
    sharedPlayerPool: true,
    crossClubTournaments: true,
    eco_cash_enabled: true,
    eco_cash_rate: 0.1,
    eco_tournament_enabled: false,
    eco_tournament_rate: undefined,
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const CLUBS = [
  {
    id: 'uc-1',
    unionId: 'union-1',
    clubId: 'club-a',
    clubName: 'Aces Club',
    ownerId: 'o1',
    ownerName: 'Ace Owner',
    memberCount: 410,
    weeklyRake: 0,
    joinedAt: '2026-01-01',
  },
  {
    id: 'uc-2',
    unionId: 'union-1',
    clubId: 'club-b',
    clubName: 'Bravo Club',
    ownerId: 'o2',
    memberCount: 1,
    weeklyRake: 0,
    joinedAt: '2026-01-01',
  },
  {
    id: 'uc-3',
    unionId: 'union-1',
    clubId: 'club-c',
    clubName: 'Charlie Club',
    ownerId: 'o3',
    ownerName: 'Charlie Owner',
    memberCount: 873,
    weeklyRake: 0,
    joinedAt: '2026-01-01',
  },
];

const table = (id: string, club: string, seated: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `Table ${id}`,
  club_id: club,
  small_blind: 1,
  big_blind: 2,
  current_players: seated,
  max_players: 9,
  status: seated > 0 ? 'running' : 'waiting',
  game_variant: 'PLO',
  ...over,
});

const TABLES = [
  table('t1', 'club-a', 6),
  table('t2', 'club-a', 2, { game_variant: undefined, small_blind: 5, big_blind: 10 }),
  table('t3', 'club-c', 0),
];

const TOURNAMENTS = [
  {
    id: 'mtt-1',
    name: 'Midway Sunday Major',
    status: 'REGISTERING',
    buy_in_amount: 100,
    buy_in_fee: 10,
    current_players: 42,
    max_players: 200,
    start_time: '2026-11-30T19:00:00Z',
    clubs: { name: 'Aces Club' },
  },
];

const SCHEDULES = [
  {
    id: 's1',
    union_id: 'union-1',
    club_id: 'club-a',
    name: 'Nightly Turbo',
    description: null,
    active: true,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    start_times_utc: ['01:00'],
    interval_minutes: null,
    config: {},
    time_zone: 'America/Chicago',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  {
    id: 's2',
    union_id: 'union-1',
    club_id: 'club-a',
    name: 'Daily Board',
    description: null,
    active: false,
    days_of_week: [1],
    start_times_utc: ['18:00'],
    interval_minutes: null,
    config: { type: 'fixed_board' },
    time_zone: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
];

const REPORT = {
  totalRakeCollected: 4210.5,
  netUnionRevenue: 505.26,
  pendingSettlements: 2,
  overdueAmount: 1250,
  periodStart: '2026-11-16',
  periodEnd: '2026-11-22',
  issuedClubs: 2,
  totalClubs: 3,
  clubBreakdowns: [
    {
      invoiceId: 'inv-1',
      clubId: 'club-a',
      clubName: 'Aces Club',
      rakeCollected: 3000,
      unionShare: 360,
      status: 'paid',
    },
    {
      invoiceId: 'inv-2',
      clubId: 'club-c',
      clubName: 'Charlie Club',
      rakeCollected: 1210.5,
      unionShare: 145.26,
      status: 'unverified',
    },
    {
      invoiceId: null,
      clubId: 'club-b',
      clubName: 'Bravo Club',
      rakeCollected: null,
      unionShare: null,
      status: 'missing',
    },
  ],
};

function mount() {
  return render(
    <MemoryRouter>
      <UnionDetailPage />
    </MemoryRouter>
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

function linkWords(root: HTMLElement): string[] {
  return [...root.querySelectorAll('a[href]')].map((a) => {
    const words: string[] = [];
    const walker = a.ownerDocument.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const piece = (walker.currentNode.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (piece) words.push(piece);
    }
    return `${a.getAttribute('href')} :: ${words.join(' | ')}`;
  });
}

function pin(container: HTMLElement) {
  const root = container.firstElementChild as HTMLElement;
  return { ...surfacePin(root), links: linkWords(root) };
}

async function open(tab: string) {
  fireEvent.click(screen.getByRole('button', { name: tab, exact: true }));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  fixture.status = 'ready';
  fixture.union = UNION;
  fixture.clubs = CLUBS;
  fixture.tables = TABLES;
  fixture.tournaments = TOURNAMENTS;
  fixture.schedules = SCHEDULES;
  fixture.report = REPORT;
  fixture.admin = true;
  fixture.getUnion.mockImplementation(async () =>
    fixture.union ? structuredClone(fixture.union) : null
  );
  fixture.getUnionClubs.mockImplementation(async () => fixture.clubs);
  fixture.getUnionTables.mockImplementation(async () => structuredClone(fixture.tables));
  fixture.getSettlementReport.mockImplementation(async () => {
    if (!fixture.report) throw new Error('refused');
    return fixture.report;
  });
  fixture.isUnionAdmin.mockImplementation(() =>
    fixture.admin === null ? new Promise(() => {}) : Promise.resolve(fixture.admin)
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Union Command page prints the same figures, words and controls', () => {
  it('overview', async () => {
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a||AAces ClubLv.26410 Members|",
          "a||BBravo ClubLv.11 Member|",
          "a||CCharlie ClubLv.31873 Members|",
          "a||Table Management|",
          "a||Table t11/26/9|",
          "a||Table t25/102/9|",
          "button|button|Create Game|",
          "button||Clubs|",
          "button||Financials|",
          "button||Overview|",
          "button||Settings|",
          "button||Tables|",
          "button||Tournaments|",
        ],
        "links": [
          "/unions/midway-union/table-management :: Table Management",
          "/table/t1 :: Table t1 | 1 | / | 2 | 6 | / | 9",
          "/table/t2 :: Table t2 | 5 | / | 10 | 2 | / | 9",
          "/clubs/club-a :: A | Aces Club | Lv. | 26 | 410 Members",
          "/clubs/club-b :: B | Bravo Club | Lv. | 1 | 1 Member",
          "/clubs/club-c :: C | Charlie Club | Lv. | 31 | 873 Members",
        ],
        "money": {
          "figures": [
            "3",
            "1,284",
            "87",
            "3",
            "34",
            "1,284",
            "87",
            "505.26",
            "42",
            "35",
            "2",
            "8",
            "1",
            "2",
            "Table t1",
            "1",
            "2",
            "6",
            "9",
            "Table t2",
            "5",
            "10",
            "2",
            "9",
            "26",
            "410 Members",
            "1",
            "1 Member",
            "31",
            "873 Members",
            "2 Of 3 Clubs Have Active Statements. Totals Cover Issued Statements Only.",
            "4,210.50",
            "505.26",
            "2",
            "1,250",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
          ],
        },
        "regions": [
          "dl||Midway Union Live Summary",
        ],
        "text": "Clubs | 3 | Players | 1,284 | Online | 87 | M | Midway Union | Every Midway Club Under One Network. | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 505.26 | Latest Statement Share | 42 | % To Lv. | 35 | Union Activity | 2 | Active Tables | 8 | Seated Players | 1 | Tournaments | Live Tables ( | 2 | Active) | Top Clubs | Latest Issued Statements | <date> To <date> | 2 Of 3 Clubs Have Active Statements. Totals Cover Issued Statements Only. | Recorded Rake | 4,210.50 | Recorded Union Share | 505.26 | Pending | 2 | Settlement | s | Overdue | 1,250",
      }
    `);
  });

  it('clubs', async () => {
    const { container } = mount();
    await flush();
    await open('Clubs');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a||AAces ClubLv.26Owner: Ace Owner410 Members2 TablesGovernance For Aces Club|",
          "a||BBravo ClubLv.1Owner: Unknown1 MemberGovernance For Bravo Club|",
          "a||CCharlie ClubLv.31Owner: Charlie Owner873 MembersGovernance For Charlie Club|",
          "a||Table Management|",
          "button|button|Create Game|",
          "button|button|Governance For Aces Club|",
          "button|button|Governance For Bravo Club|",
          "button|button|Governance For Charlie Club|",
          "button||Clubs|",
          "button||Financials|",
          "button||Overview|",
          "button||Settings|",
          "button||Tables|",
          "button||Tournaments|",
        ],
        "links": [
          "/unions/midway-union/table-management :: Table Management",
          "/clubs/club-a :: A | Aces Club | Lv. | 26 | Owner: | Ace Owner | 410 Members | 2 | Tables | Governance For | Aces Club",
          "/clubs/club-b :: B | Bravo Club | Lv. | 1 | Owner: | Unknown | 1 Member | Governance For | Bravo Club",
          "/clubs/club-c :: C | Charlie Club | Lv. | 31 | Owner: | Charlie Owner | 873 Members | Governance For | Charlie Club",
        ],
        "money": {
          "figures": [
            "3",
            "1,284",
            "87",
            "3",
            "34",
            "1,284",
            "87",
            "505.26",
            "42",
            "35",
            "26",
            "410 Members",
            "2",
            "1",
            "1 Member",
            "31",
            "873 Members",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
          ],
        },
        "regions": [
          "dl||Midway Union Live Summary",
        ],
        "text": "Clubs | 3 | Players | 1,284 | Online | 87 | M | Midway Union | Every Midway Club Under One Network. | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 505.26 | Latest Statement Share | 42 | % To Lv. | 35",
      }
    `);
  });

  it('tables', async () => {
    const { container } = mount();
    await flush();
    await open('Tables');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a||Table Management|",
          "a||View Table|",
          "a||View Table|",
          "a||View Table|",
          "button|button|Create Game|",
          "button||Clubs|",
          "button||Financials|",
          "button||Overview|",
          "button||Settings|",
          "button||Tables|",
          "button||Tournaments|",
        ],
        "links": [
          "/unions/midway-union/table-management :: Table Management",
          "/table/t1 :: View Table",
          "/table/t2 :: View Table",
          "/table/t3 :: View Table",
        ],
        "money": {
          "figures": [
            "3",
            "1,284",
            "87",
            "3",
            "34",
            "1,284",
            "87",
            "505.26",
            "42",
            "35",
            "2",
            "Table t1",
            "1",
            "2",
            "6",
            "9",
            "Table t2",
            "5",
            "10",
            "2",
            "9",
            "1",
            "Table t3",
            "1",
            "2",
            "0/",
            "9",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
          ],
        },
        "regions": [
          "dl||Midway Union Live Summary",
        ],
        "text": "Clubs | 3 | Players | 1,284 | Online | 87 | M | Midway Union | Every Midway Club Under One Network. | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 505.26 | Latest Statement Share | 42 | % To Lv. | 35 | Active Tables ( | 2 | ) | Table t1 | 1 | / | 2 | PLO | 6 | / | 9 | Table t2 | 5 | / | 10 | NLH | 2 | / | 9 | Empty Tables ( | 1 | ) | Table t3 | 1 | / | 2 | PLO | 0/ | 9",
      }
    `);
  });

  it('tournaments', async () => {
    const { container } = mount();
    await flush();
    await open('Tournaments');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a||Table Management|",
          "a||View Details|",
          "button|button|Create Game|",
          "button||+ Create XMTT|",
          "button||Clubs|",
          "button||Deactivate|",
          "button||Financials|",
          "button||Overview|",
          "button||Settings|",
          "button||Tables|",
          "button||Tournaments|",
        ],
        "links": [
          "/unions/midway-union/table-management :: Table Management",
          "/tournaments/mtt-1 :: View Details",
        ],
        "money": {
          "figures": [
            "3",
            "1,284",
            "87",
            "3",
            "34",
            "1,284",
            "87",
            "505.26",
            "42",
            "35",
            "110",
            "42",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
            "data-discover=true",
            "data-discover=true",
          ],
        },
        "regions": [
          "dl||Midway Union Live Summary",
        ],
        "text": "Clubs | 3 | Players | 1,284 | Online | 87 | M | Midway Union | Every Midway Club Under One Network. | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 505.26 | Latest Statement Share | 42 | % To Lv. | 35 | Union Tournaments (XMTT) | Tournaments Open To All Member Clubs | Midway Sunday Major | REGISTERING | Midway Union | 110 | 42 | <date> | Recurring Schedules | Nightly Turbo | ACTIVE | Every Day At <time>erica/Chicago | Daily Board | OFF | Mon At <time> UTC | Fixed Daily Board",
      }
    `);
  });

  it('financials', async () => {
    const { container } = mount();
    await flush();
    await open('Financials');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a||Table Management|",
          "a||Union Dashboard|",
          "button|button|Create Game|",
          "button|button|Union Rake And Production Data|",
          "button|button|Weekly Statements And Square-Up|",
          "button||Clubs|",
          "button||Financials|",
          "button||Overview|",
          "button||Settings|",
          "button||Tables|",
          "button||Tournaments|",
        ],
        "links": [
          "/unions/midway-union/table-management :: Table Management",
          "/unions/midway-union/operations :: Union Dashboard",
        ],
        "money": {
          "figures": [
            "3",
            "1,284",
            "87",
            "3",
            "34",
            "1,284",
            "87",
            "505.26",
            "42",
            "35",
            "2 Of 3 Clubs Have Active Statements. Totals Cover Issued Statements Only.",
            "4,210.50",
            "505.26",
            "2",
            "1,250",
            "3,000.00",
            "360.00",
            "1,210.50",
            "145.26",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
            "data-discover=true",
            "data-discover=true",
          ],
        },
        "regions": [
          "dl||Midway Union Live Summary",
        ],
        "text": "Clubs | 3 | Players | 1,284 | Online | 87 | M | Midway Union | Every Midway Club Under One Network. | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 505.26 | Latest Statement Share | 42 | % To Lv. | 35 | <date> To <date> | 2 Of 3 Clubs Have Active Statements. Totals Cover Issued Statements Only. | % | 4,210.50 | Recorded Statement Rake | ◉ | 505.26 | Recorded Union Share | ◷ | 2 | Pending Settlements | ! | 1,250 | Overdue | Statements For Selected Period | Weekly Player Win/Loss Settlement, Wallet And Treasury Live On The | . | Period | Club | Rake | Union Share | Status | <date> To <date> | Aces Club | 3,000.00 | 360.00 | paid | <date> To <date> | Charlie Club | 1,210.50 | 145.26 | Payment Details Unavailable | <date> To <date> | Bravo Club | Unavailable | Unavailable | missing",
      }
    `);
  });

  it('settings', async () => {
    const { container } = mount();
    await flush();
    await open('Settings');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a||Table Management|",
          "button|button|Create Game|",
          "button||Clubs|",
          "button||Financials|",
          "button||Overview|",
          "button||Save Settings|",
          "button||Settings|",
          "button||Tables|",
          "button||Tournaments|",
          "input|checkbox||checked,value=on",
          "input|checkbox||checked,value=on",
          "input|checkbox||checked,value=on",
          "input|checkbox||unchecked,value=on",
          "input|number|Cash ECO Rate|value=10",
          "input|number|Tournament ECO Rate|value=",
          "input|range||value=12",
        ],
        "links": [
          "/unions/midway-union/table-management :: Table Management",
        ],
        "money": {
          "figures": [
            "3",
            "1,284",
            "87",
            "3",
            "34",
            "1,284",
            "87",
            "505.26",
            "42",
            "35",
            "12",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
            "data-discover=true",
          ],
        },
        "regions": [
          "dl||Midway Union Live Summary",
          "input||Cash ECO Rate",
          "input||Tournament ECO Rate",
        ],
        "text": "Clubs | 3 | Players | 1,284 | Online | 87 | M | Midway Union | Every Midway Club Under One Network. | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 505.26 | Latest Statement Share | 42 | % To Lv. | 35 | Revenue Configuration | Configure How Revenue Is Split Between The Union And Clubs | Revenue Share % | 12 | % | Percentage Of Club Rake That Goes To The Union | Shared Player Pool | Allow Players To Sit At Any Club’s Tables | Cross-Club Tournaments | Enable Union-Wide Tournament Scheduling | Cash ECO | Cash ECO | Configured Rate % | Separate Club Profit / Loss. Horses And All Players Included. | Tournament ECO | Tournament ECO | Configured Rate % | Separate Club Profit / Loss. Horses And All Players Included. | ECO Changes Apply At The Server-Confirmed Accounting Boundary. | ECO Terms Effective From | <date>",
      }
    `);
  });

  describe('an empty union whose statement read failed', () => {
    beforeEach(() => {
      fixture.clubs = [];
      fixture.tables = [];
      fixture.tournaments = [];
      fixture.schedules = [];
      fixture.report = null;
      fixture.union = {
        ...UNION,
        description: undefined,
        avatarUrl: 'https://example.test/u.png',
        ecoTermsEffectiveFrom: undefined,
      };
    });

    it('Overview', async () => {
      const { container } = mount();
      await flush();
      expect(pin(container)).toMatchInlineSnapshot(`
        {
          "controls": [
            "a||Table Management|",
            "button|button|Create Game|",
            "button||Clubs|",
            "button||Financials|",
            "button||Overview|",
            "button||Settings|",
            "button||Tables|",
            "button||Tournaments|",
          ],
          "links": [
            "/unions/midway-union/table-management :: Table Management",
          ],
          "money": {
            "figures": [
              "3",
              "1,284",
              "87",
              "3",
              "34",
              "1,284",
              "87",
              "42",
              "35",
              "0",
              "0",
              "0",
              "0",
            ],
            "hooks": [
              "data-tone=default",
              "data-tone=live",
              "data-tone=attention",
              "data-discover=true",
            ],
          },
          "regions": [
            "dl||Midway Union Live Summary",
          ],
          "text": "Clubs | 3 | Players | 1,284 | Online | 87 | Midway Union | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 42 | % To Lv. | 35 | Union Activity | 0 | Active Tables | 0 | Seated Players | 0 | Tournaments | Live Tables ( | 0 | Active) | ◆ | No Active Tables - Games Will Appear Here When Clubs Start Playing | Top Clubs",
        }
      `);
    });

    it('Clubs', async () => {
      const { container } = mount();
      await flush();
      await open('Clubs');
      expect(pin(container)).toMatchInlineSnapshot(`
        {
          "controls": [
            "a||Table Management|",
            "button|button|Create Game|",
            "button||Clubs|",
            "button||Financials|",
            "button||Overview|",
            "button||Settings|",
            "button||Tables|",
            "button||Tournaments|",
          ],
          "links": [
            "/unions/midway-union/table-management :: Table Management",
          ],
          "money": {
            "figures": [
              "3",
              "1,284",
              "87",
              "3",
              "34",
              "1,284",
              "87",
              "42",
              "35",
            ],
            "hooks": [
              "data-tone=default",
              "data-tone=live",
              "data-tone=attention",
              "data-discover=true",
            ],
          },
          "regions": [
            "dl||Midway Union Live Summary",
          ],
          "text": "Clubs | 3 | Players | 1,284 | Online | 87 | Midway Union | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 42 | % To Lv. | 35 | ⌂ | No Clubs Yet | Invite Clubs To Join Your Union To Get Started",
        }
      `);
    });

    it('Tables', async () => {
      const { container } = mount();
      await flush();
      await open('Tables');
      expect(pin(container)).toMatchInlineSnapshot(`
        {
          "controls": [
            "a||Table Management|",
            "button|button|Create Game|",
            "button||Clubs|",
            "button||Financials|",
            "button||Overview|",
            "button||Settings|",
            "button||Tables|",
            "button||Tournaments|",
          ],
          "links": [
            "/unions/midway-union/table-management :: Table Management",
          ],
          "money": {
            "figures": [
              "3",
              "1,284",
              "87",
              "3",
              "34",
              "1,284",
              "87",
              "42",
              "35",
            ],
            "hooks": [
              "data-tone=default",
              "data-tone=live",
              "data-tone=attention",
              "data-discover=true",
            ],
          },
          "regions": [
            "dl||Midway Union Live Summary",
          ],
          "text": "Clubs | 3 | Players | 1,284 | Online | 87 | Midway Union | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 42 | % To Lv. | 35 | ▦ | No Tables Active | Your Clubs' Tables Will Appear Here When Games Start",
        }
      `);
    });

    it('Tournaments', async () => {
      const { container } = mount();
      await flush();
      await open('Tournaments');
      expect(pin(container)).toMatchInlineSnapshot(`
        {
          "controls": [
            "a||Table Management|",
            "button|button|Create Game|",
            "button||+ Create First XMTT|",
            "button||Clubs|",
            "button||Financials|",
            "button||Overview|",
            "button||Settings|",
            "button||Tables|",
            "button||Tournaments|",
          ],
          "links": [
            "/unions/midway-union/table-management :: Table Management",
          ],
          "money": {
            "figures": [
              "3",
              "1,284",
              "87",
              "3",
              "34",
              "1,284",
              "87",
              "42",
              "35",
            ],
            "hooks": [
              "data-tone=default",
              "data-tone=live",
              "data-tone=attention",
              "data-discover=true",
            ],
          },
          "regions": [
            "dl||Midway Union Live Summary",
          ],
          "text": "Clubs | 3 | Players | 1,284 | Online | 87 | Midway Union | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 42 | % To Lv. | 35 | Union Tournaments (XMTT) | Tournaments Open To All Member Clubs | No Union Wide Tournaments Scheduled",
        }
      `);
    });

    it('Financials', async () => {
      const { container } = mount();
      await flush();
      await open('Financials');
      expect(pin(container)).toMatchInlineSnapshot(`
        {
          "controls": [
            "a||Table Management|",
            "button|button|Create Game|",
            "button|button|Union Rake And Production Data|",
            "button|button|Weekly Statements And Square-Up|",
            "button||Clubs|",
            "button||Financials|",
            "button||Overview|",
            "button||Settings|",
            "button||Tables|",
            "button||Tournaments|",
          ],
          "links": [
            "/unions/midway-union/table-management :: Table Management",
          ],
          "money": {
            "figures": [
              "3",
              "1,284",
              "87",
              "3",
              "34",
              "1,284",
              "87",
              "42",
              "35",
            ],
            "hooks": [
              "data-tone=default",
              "data-tone=live",
              "data-tone=attention",
              "data-discover=true",
            ],
          },
          "regions": [
            "dl||Midway Union Live Summary",
            "p|alert|",
          ],
          "text": "Clubs | 3 | Players | 1,284 | Online | 87 | Midway Union | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 42 | % To Lv. | 35 | Statement Data Is Unavailable. Open Weekly Statements To Check Access Or Try Again.",
        }
      `);
    });

    it('Settings', async () => {
      const { container } = mount();
      await flush();
      await open('Settings');
      expect(pin(container)).toMatchInlineSnapshot(`
        {
          "controls": [
            "a||Table Management|",
            "button|button|Create Game|",
            "button||Clubs|",
            "button||Financials|",
            "button||Overview|",
            "button||Save Settings|",
            "button||Settings|",
            "button||Tables|",
            "button||Tournaments|",
            "input|checkbox||checked,value=on",
            "input|checkbox||checked,value=on",
            "input|checkbox||checked,value=on",
            "input|checkbox||unchecked,value=on",
            "input|number|Cash ECO Rate|value=10",
            "input|number|Tournament ECO Rate|value=",
            "input|range||value=12",
          ],
          "links": [
            "/unions/midway-union/table-management :: Table Management",
          ],
          "money": {
            "figures": [
              "3",
              "1,284",
              "87",
              "3",
              "34",
              "1,284",
              "87",
              "42",
              "35",
              "12",
            ],
            "hooks": [
              "data-tone=default",
              "data-tone=live",
              "data-tone=attention",
              "data-discover=true",
            ],
          },
          "regions": [
            "dl||Midway Union Live Summary",
            "input||Cash ECO Rate",
            "input||Tournament ECO Rate",
          ],
          "text": "Clubs | 3 | Players | 1,284 | Online | 87 | Midway Union | 3 | Member Clubs | Lv. | 34 | Major Operator | 1,284 | Total Players | 87 | Online Now | 42 | % To Lv. | 35 | Revenue Configuration | Configure How Revenue Is Split Between The Union And Clubs | Revenue Share % | 12 | % | Percentage Of Club Rake That Goes To The Union | Shared Player Pool | Allow Players To Sit At Any Club’s Tables | Cross-Club Tournaments | Enable Union-Wide Tournament Scheduling | Cash ECO | Cash ECO | Configured Rate % | Separate Club Profit / Loss. Horses And All Players Included. | Tournament ECO | Tournament ECO | Configured Rate % | Separate Club Profit / Loss. Horses And All Players Included. | ECO Changes Apply At The Server-Confirmed Accounting Boundary. | ECO Effective Accounting Boundary Unavailable.",
        }
      `);
    });
  });

  it('first load', async () => {
    fixture.getUnion.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|status|",
        ],
        "text": "Opening Union Command",
      }
    `);
  });

  it('the union could not be resolved', async () => {
    fixture.status = 'error';
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Try Again|",
        ],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "section|alert|",
        ],
        "text": "FAULT | Recovery Required | This Surface Could Not Load | Could Not Load This Union. Please Try Again.",
      }
    `);
  });

  it('the read failed', async () => {
    fixture.getUnion.mockRejectedValue(new Error('offline'));
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Try Again|",
        ],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "section|alert|",
        ],
        "text": "FAULT | Recovery Required | This Surface Could Not Load | Club Arena Could Not Load This Union Workspace.",
      }
    `);
  });

  it('not found', async () => {
    fixture.status = 'not_found';
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back To Community|",
          "button|button|Return To Arena|",
        ],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "section|status|",
        ],
        "text": "UNION | Network Unavailable | Union Not Found | This Union May Have Been Removed, Or The Link May Use An Outdated Identifier.",
      }
    `);
  });

  it('checking management access', async () => {
    fixture.admin = null;
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|status|",
        ],
        "text": "Checking Union Management Access",
      }
    `);
  });
});
