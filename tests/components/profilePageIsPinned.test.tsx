/**
 * THE PROFILE PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign player pages batch P5, 2026-11-28)
 *
 * The player credential is moving from its #SmarterCasinoRealism plates to
 * the arena workspace. The condition: no figure, word, data hook, named
 * region or control (with its selected and disabled state) may change, and the
 * portrait keeps its size (the global header and its portrait frame are not
 * touched: CLAUDE.md 10.7b). This renders the real page with synthetic reads
 * and pins all of it (tests/helpers/surfacePin.ts) in each state the page
 * shows: loading, not found, a Lifetime VIP with recorded stats on every tab,
 * and a non-member with no hands. The page head is the one part the pass
 * replaces; surfacePin leaves out its title and "?". The snapshots were
 * recorded against the old page on main 65a64d1f6 and are unchanged by the
 * pass.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

type ProfileResult = { data: Record<string, unknown> | null; error: null };

function profile(id: string, alias: string, lifetime: boolean): ProfileResult {
  return {
    data: {
      id,
      username: alias,
      alias,
      display_name: alias,
      first_name: null,
      last_name: null,
      full_name: null,
      display_name_preference: 'alias',
      use_real_name: false,
      player_number: 101,
      avatar_url: 'https://example.test/portrait.png',
      arena_avatar_url: '',
      use_avatar_as_profile_pic: false,
      created_at: '2026-01-01T00:00:00.000Z',
      diamonds: 1234,
      is_vip: lifetime,
      vip_tier: lifetime ? 'lifetime' : null,
      vip_expires_at: null,
      login_streak: 4,
      bio: lifetime ? 'River Rat Since 2019' : '',
      player_tags: lifetime ? ['Grinder', 'Bluffer'] : [],
    },
    error: null,
  };
}

const STATS = {
  contract_version: 2,
  overall: {
    total_hands: 1520,
    hands_won: 410,
    showdowns_total: 120,
    showdowns_won: 66,
    vpip: 0.2345,
    pfr: 0.1812,
    three_bet_percent: 0.071,
    aggression_factor: 2.456,
    bb_per_100: 7.891,
    biggest_pot_won: 2540.75,
    biggest_hand_loss: -980.5,
    total_profit: 3321.25,
    wtsd: 0.2711,
    hours_played: 41.5,
    cash_hands: 1200,
    tourney_hands: 320,
  },
  tournaments: {
    entries: 18,
    wins: 2,
    cashes: 5,
    itm_percent: 0.2777,
    best_finish: 1,
    net_profit: 412.5,
    total_bounties: 7,
    roi: 0.165,
  },
  lifetime: { hands: 1520 },
  coverage: { first_hand_at: '2026-02-01T00:00:00Z', last_hand_at: '2026-11-27T20:00:00Z' },
  quality: {
    metric_availability: {
      three_bet_percent: true,
      aggression_factor: true,
      wtsd: true,
      hours_played: true,
    },
  },
  daily: [{ date: '2026-11-26', hands: 120, profit: 45.5 }],
  sessions: [
    {
      id: 's-1',
      date: '2026-11-26',
      buy_in: 200,
      cash_out: 345.5,
      profit_loss: 145.5,
      hands_played: 120,
      duration_minutes: 95,
    },
  ],
  variants: [{ variant: 'nlh', hands: 1200, profit: 3000.25, bb100: 8.12 }],
};

const mocks = vi.hoisted(() => ({
  currentStoreUser: { id: 'account-a' } as { id: string } | null,
  currentAuthUser: { id: 'account-a' } as { id: string } | null,
  profileReads: new Map<string, Promise<ProfileResult>>(),
  requestedProfileIds: [] as string[],
  mountedRef: { current: true },
  stats: null as unknown,
  transactions: [] as unknown[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: mocks.currentStoreUser }),
}));

vi.mock('../../src/lib/supabase', () => {
  const from = (table: string) => {
    let requestedUserId = '';
    const builder: Record<string, any> = {};
    builder.select = () => builder;
    builder.eq = (_column: string, value: string) => {
      requestedUserId = value;
      return builder;
    };
    builder.order = () => builder;
    builder.limit = () =>
      Promise.resolve({
        data: table === 'wallet_transactions' ? mocks.transactions : [],
        error: null,
      });
    builder.maybeSingle = () => {
      if (table !== 'profiles') return Promise.resolve({ data: null, error: null });
      mocks.requestedProfileIds.push(requestedUserId);
      return (
        mocks.profileReads.get(requestedUserId) ?? Promise.resolve({ data: null, error: null })
      );
    };
    return builder;
  };

  return {
    getAuthUser: () => Promise.resolve({ data: { user: mocks.currentAuthUser } }),
    supabase: {
      from,
      // The page reads the player's own row through the owner door (ruling
      // 22), filtered by id like the profiles read was.
      rpc: (name: string) =>
        name === 'get_my_full_profile'
          ? from('profiles')
          : Promise.resolve({ data: null, error: null }),
      auth: {
        getUser: () => Promise.resolve({ data: { user: mocks.currentAuthUser } }),
      },
    },
  };
});

vi.mock('../../src/utils/retryFetch', () => ({
  retryFetch: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('../../src/services/AchievementService', () => ({
  achievementService: { getUserAchievements: () => Promise.resolve([]), getById: () => null },
}));
vi.mock('../../src/services/DiamondService', () => ({
  DiamondService: { getBalance: () => Promise.resolve({ balance: 0 }) },
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribeDebounced: () => () => {} },
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: vi.fn() }));
vi.mock('../../src/hooks/useIsMounted', () => ({ useIsMounted: () => mocks.mountedRef }));
vi.mock('../../src/hooks/useSwipeTabs', () => ({ useSwipeTabs: () => ({}) }));
vi.mock('../../src/utils/lazyWithRetry', () => ({ lazyWithRetry: () => () => null }));
vi.mock('../../src/components/common/EmptyState', () => ({
  LoadingState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock('../../src/components/layouts/StandardContentLayout', () => ({
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <main data-testid="profile-root" className={className}>
      {children}
    </main>
  ),
}));
vi.mock('../../src/services/ProfileStatsRead', () => ({
  readSeparatedProfileStats: () => Promise.resolve({ data: mocks.stats, error: null }),
}));

vi.mock('../../src/components/social/FriendListPanel', () => ({ default: () => null }));
vi.mock('../../src/components/social/UserProfileEdit', () => ({ default: () => null }));
vi.mock('../../src/components/customization/AvatarGallery', () => ({ AvatarGallery: () => null }));
vi.mock('../../src/components/gamification/StreakFire', () => ({ StreakFire: () => null }));
vi.mock('../../src/components/gamification/StreakMultiplier', () => ({ default: () => null }));
vi.mock('../../src/components/common/CircularGauge', () => ({ default: () => null }));
vi.mock('../../src/components/effects/DiamondRainEffect', () => ({ default: () => null }));
vi.mock('../../src/components/social/PlayerActivityFeed', () => ({ default: () => null }));
vi.mock('../../src/components/social/ReferralDashboard', () => ({ default: () => null }));

import ProfilePage from '../../src/pages/ProfilePage';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

async function mount() {
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <ProfilePage />
    </MemoryRouter>
  );
  await flush();
}

function pin() {
  const root = screen.queryByTestId('profile-root') ?? document.body;
  return surfacePin(root as HTMLElement);
}

async function openTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T13:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  mocks.profileReads.clear();
  mocks.stats = null;
  mocks.transactions = [];
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('the Profile page prints the same surface after its frames move', () => {
  it('loading', async () => {
    mocks.profileReads.set('account-a', new Promise(() => {}));
    await mount();
    expect(screen.getByText('Loading profile...')).toBeTruthy();
  });

  it('not found', async () => {
    mocks.profileReads.set('account-a', Promise.resolve({ data: null, error: null }));
    await mount();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Profile Not Found",
      }
    `);
  });

  it('a Lifetime VIP with recorded stats, on every tab', async () => {
    mocks.profileReads.set('account-a', Promise.resolve(profile('account-a', 'AlphaAce', true)));
    mocks.stats = STATS;
    mocks.transactions = [
      {
        id: 'tx-1',
        type: 'deposit',
        amount: 500.75,
        created_at: '2026-11-20T10:00:00Z',
        description: 'Chips Added',
      },
      {
        id: 'tx-2',
        type: 'withdrawal',
        amount: -120.25,
        created_at: '2026-11-21T10:00:00Z',
        description: 'Cash Out',
      },
    ];
    await mount();
    expect(screen.getByRole('heading', { name: 'AlphaAce' })).toBeTruthy();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|1,234 Diamonds. Open VIP Status|",
          "button|button|Achievements|aria-selected=false",
          "button|button|Activity|aria-selected=false",
          "button|button|Bonus CenterDaily And Special Claims↗|",
          "button|button|ChallengesMissions And Progress↗|",
          "button|button|Change Avatar|",
          "button|button|Edit Profile|",
          "button|button|LeaderboardsCircuit Rankings↗|",
          "button|button|Network|aria-selected=false",
          "button|button|NotificationsSeat Calls And Signals↗|",
          "button|button|Open Full Player Analytics →|",
          "button|button|Open VIP Ledger →|",
          "button|button|Player AnalyticsDeep Stats And Leak Analysis↗|",
          "button|button|PromotionsLive Offers And Eligibility↗|",
          "button|button|SettingsTable, Alerts And Security↗|",
          "button|button|Snapshot|aria-selected=true",
          "button|button|VIP StatusMembership And Benefits↗|",
          "button|button|WalletBalances And Cashier Access↗|",
        ],
        "money": {
          "figures": [
            "Last Hand 17h Ago",
            "101",
            "River Rat Since 2019",
            "1,234",
            "<date>25",
            "1,520",
            "23.4%",
            "+16.5%",
            "4D",
            "20-Second Time Bank Activations",
            "1,520",
            "1,200",
            "320",
            "7.1%",
            "3-Bet",
            "2.45",
            "27.1%",
            "55.0%",
            "41.5h",
            "+7.89",
            "BB/100",
            "2,540.75",
            "+3,321.25",
            "-980.50",
            "18",
            "2",
            "7",
            "11.1%",
            "27.7%",
            "1st",
            "5",
            "+412.50",
            "1,200",
            "+3,000.25",
            "+8.1",
            "BB/100",
          ],
          "hooks": [
            "data-tone=default",
          ],
        },
        "regions": [
          "span|status|",
          "button||1,234 Diamonds. Open VIP Status",
          "dl||Player Telemetry",
          "section||VIP Status",
          "ul||Lifetime VIP Digital Benefits",
          "nav||Player Workspaces",
          "nav|tablist|Profile Details",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "section|tabpanel|",
        ],
        "text": "Last Hand 17h Ago | LIFETIME VIP | AlphaAce | Player # | 101 | River Rat Since 2019 | Grinder | Bluffer | Member | <date>25 | Cash Hands | 1,520 | VPIP | 23.4% | ROI | +16.5% | Streak | 4D | Table Avatar | Not Set | Membership | Lifetime VIP | Never Expires | Unlimited | Rabbit Hunts | Unlimited | 20-Second Time Bank Activations | All | Digital Emoji Packs | All | Digital Player Tag Packs | Unlimited | Throwables | All | Table Skins, Card Backs, And Buttons | VIP | Avatars, Frames, And Auras | Core Stats | 1,520 | Cash Hands Played | 1,200 | Cash Hands | 320 | Tourney Hands | 7.1% | 3-Bet | 2.45 | Aggression | 27.1% | WTSD | 55.0% | Won At SD | 41.5h | On Felt | Financial | +7.89 | BB/100 | 2,540.75 | Biggest Pot | +3,321.25 | Total Profit | -980.50 | Worst Hand | Tournaments | 18 | Played | 2 | Won | 7 | Bounty KOs | 11.1% | Win Rate | 27.7% | ITM | 1st | Best Finish | 5 | Cashes | +412.50 | Net Result | By Variant | Hold'em | 1,200 | Hands | +3,000.25 | +8.1 | BB/100",
      }
    `);
    await openTab('Achievements');
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|1,234 Diamonds. Open VIP Status|",
          "button|button|Achievements|aria-selected=true",
          "button|button|Activity|aria-selected=false",
          "button|button|Bonus CenterDaily And Special Claims↗|",
          "button|button|ChallengesMissions And Progress↗|",
          "button|button|Change Avatar|",
          "button|button|Edit Profile|",
          "button|button|LeaderboardsCircuit Rankings↗|",
          "button|button|Network|aria-selected=false",
          "button|button|NotificationsSeat Calls And Signals↗|",
          "button|button|Open Achievement Vault →|",
          "button|button|Open VIP Ledger →|",
          "button|button|Player AnalyticsDeep Stats And Leak Analysis↗|",
          "button|button|PromotionsLive Offers And Eligibility↗|",
          "button|button|SettingsTable, Alerts And Security↗|",
          "button|button|Snapshot|aria-selected=false",
          "button|button|VIP StatusMembership And Benefits↗|",
          "button|button|WalletBalances And Cashier Access↗|",
        ],
        "money": {
          "figures": [
            "Last Hand 17h Ago",
            "101",
            "River Rat Since 2019",
            "1,234",
            "<date>25",
            "1,520",
            "23.4%",
            "+16.5%",
            "4D",
            "20-Second Time Bank Activations",
          ],
          "hooks": [
            "data-tone=default",
          ],
        },
        "regions": [
          "span|status|",
          "button||1,234 Diamonds. Open VIP Status",
          "dl||Player Telemetry",
          "section||VIP Status",
          "ul||Lifetime VIP Digital Benefits",
          "nav||Player Workspaces",
          "nav|tablist|Profile Details",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "section|tabpanel|",
        ],
        "text": "Last Hand 17h Ago | LIFETIME VIP | AlphaAce | Player # | 101 | River Rat Since 2019 | Grinder | Bluffer | Member | <date>25 | Cash Hands | 1,520 | VPIP | 23.4% | ROI | +16.5% | Streak | 4D | Table Avatar | Not Set | Membership | Lifetime VIP | Never Expires | Unlimited | Rabbit Hunts | Unlimited | 20-Second Time Bank Activations | All | Digital Emoji Packs | All | Digital Player Tag Packs | Unlimited | Throwables | All | Table Skins, Card Backs, And Buttons | VIP | Avatars, Frames, And Auras | No Achievements Yet. Start Playing To Unlock Achievements!",
      }
    `);
    await openTab('Activity');
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|1,234 Diamonds. Open VIP Status|",
          "button|button|Achievements|aria-selected=false",
          "button|button|Activity|aria-selected=true",
          "button|button|Bonus CenterDaily And Special Claims↗|",
          "button|button|ChallengesMissions And Progress↗|",
          "button|button|Change Avatar|",
          "button|button|Edit Profile|",
          "button|button|LeaderboardsCircuit Rankings↗|",
          "button|button|Network|aria-selected=false",
          "button|button|NotificationsSeat Calls And Signals↗|",
          "button|button|Open Complete Transaction History →|",
          "button|button|Open VIP Ledger →|",
          "button|button|Player AnalyticsDeep Stats And Leak Analysis↗|",
          "button|button|PromotionsLive Offers And Eligibility↗|",
          "button|button|SettingsTable, Alerts And Security↗|",
          "button|button|Snapshot|aria-selected=false",
          "button|button|VIP StatusMembership And Benefits↗|",
          "button|button|WalletBalances And Cashier Access↗|",
        ],
        "money": {
          "figures": [
            "Last Hand 17h Ago",
            "101",
            "River Rat Since 2019",
            "1,234",
            "<date>25",
            "1,520",
            "23.4%",
            "+16.5%",
            "4D",
            "20-Second Time Bank Activations",
            "120",
            "95",
            "200.00",
            "345.50",
            "+145.50",
            "500.75",
            "120.25",
          ],
          "hooks": [
            "data-tone=default",
          ],
        },
        "regions": [
          "span|status|",
          "button||1,234 Diamonds. Open VIP Status",
          "dl||Player Telemetry",
          "section||VIP Status",
          "ul||Lifetime VIP Digital Benefits",
          "nav||Player Workspaces",
          "nav|tablist|Profile Details",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "section|tabpanel|",
        ],
        "text": "Last Hand 17h Ago | LIFETIME VIP | AlphaAce | Player # | 101 | River Rat Since 2019 | Grinder | Bluffer | Member | <date>25 | Cash Hands | 1,520 | VPIP | 23.4% | ROI | +16.5% | Streak | 4D | Table Avatar | Not Set | Membership | Lifetime VIP | Never Expires | Unlimited | Rabbit Hunts | Unlimited | 20-Second Time Bank Activations | All | Digital Emoji Packs | All | Digital Player Tag Packs | Unlimited | Throwables | All | Table Skins, Card Backs, And Buttons | VIP | Avatars, Frames, And Auras | Cumulative P/L | Settled Hand Results By Day | Recent Sessions | <date> | 120 | Hands // | 95 | Min // In | 200.00 | Out | 345.50 | +145.50 | Recent Transactions | Chips Added | <date>, <time> | - | 500.75 | Cash Out | <date>, <time> | - | 120.25",
      }
    `);
    await openTab('Network');
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|1,234 Diamonds. Open VIP Status|",
          "button|button|Achievements|aria-selected=false",
          "button|button|Activity|aria-selected=false",
          "button|button|Bonus CenterDaily And Special Claims↗|",
          "button|button|ChallengesMissions And Progress↗|",
          "button|button|Change Avatar|",
          "button|button|Edit Profile|",
          "button|button|LeaderboardsCircuit Rankings↗|",
          "button|button|Network|aria-selected=true",
          "button|button|NotificationsSeat Calls And Signals↗|",
          "button|button|Open VIP Ledger →|",
          "button|button|Player AnalyticsDeep Stats And Leak Analysis↗|",
          "button|button|PromotionsLive Offers And Eligibility↗|",
          "button|button|SettingsTable, Alerts And Security↗|",
          "button|button|Snapshot|aria-selected=false",
          "button|button|VIP StatusMembership And Benefits↗|",
          "button|button|WalletBalances And Cashier Access↗|",
        ],
        "money": {
          "figures": [
            "Last Hand 17h Ago",
            "101",
            "River Rat Since 2019",
            "1,234",
            "<date>25",
            "1,520",
            "23.4%",
            "+16.5%",
            "4D",
            "20-Second Time Bank Activations",
          ],
          "hooks": [
            "data-tone=default",
          ],
        },
        "regions": [
          "span|status|",
          "button||1,234 Diamonds. Open VIP Status",
          "dl||Player Telemetry",
          "section||VIP Status",
          "ul||Lifetime VIP Digital Benefits",
          "nav||Player Workspaces",
          "nav|tablist|Profile Details",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "section|tabpanel|",
        ],
        "text": "Last Hand 17h Ago | LIFETIME VIP | AlphaAce | Player # | 101 | River Rat Since 2019 | Grinder | Bluffer | Member | <date>25 | Cash Hands | 1,520 | VPIP | 23.4% | ROI | +16.5% | Streak | 4D | Table Avatar | Not Set | Membership | Lifetime VIP | Never Expires | Unlimited | Rabbit Hunts | Unlimited | 20-Second Time Bank Activations | All | Digital Emoji Packs | All | Digital Player Tag Packs | Unlimited | Throwables | All | Table Skins, Card Backs, And Buttons | VIP | Avatars, Frames, And Auras",
      }
    `);
  });

  it('a non-member with no hands', async () => {
    mocks.profileReads.set('account-a', Promise.resolve(profile('account-a', 'BetaBluff', false)));
    await mount();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|1,234 Diamonds. Open VIP Status|",
          "button|button|Achievements|aria-selected=false",
          "button|button|Activity|aria-selected=false",
          "button|button|Bonus CenterDaily And Special Claims↗|",
          "button|button|ChallengesMissions And Progress↗|",
          "button|button|Change Avatar|",
          "button|button|Edit Profile|",
          "button|button|Get VIP Membership →|",
          "button|button|LeaderboardsCircuit Rankings↗|",
          "button|button|Network|aria-selected=false",
          "button|button|NotificationsSeat Calls And Signals↗|",
          "button|button|Open Full Player Analytics →|",
          "button|button|Player AnalyticsDeep Stats And Leak Analysis↗|",
          "button|button|PromotionsLive Offers And Eligibility↗|",
          "button|button|SettingsTable, Alerts And Security↗|",
          "button|button|Snapshot|aria-selected=true",
          "button|button|VIP StatusMembership And Benefits↗|",
          "button|button|WalletBalances And Cashier Access↗|",
        ],
        "money": {
          "figures": [
            "101",
            "1,234",
            "<date>25",
            "4D",
          ],
          "hooks": [
            "data-tone=default",
          ],
        },
        "regions": [
          "span|status|",
          "button||1,234 Diamonds. Open VIP Status",
          "dl||Player Telemetry",
          "section||VIP Status",
          "nav||Player Workspaces",
          "nav|tablist|Profile Details",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "section|tabpanel|",
          "div|status|",
        ],
        "text": "No Hands Recorded Yet | BetaBluff | Player # | 101 | Member | <date>25 | Cash Hands | - | VPIP | - | ROI | - | Streak | 4D | Table Avatar | Not Set | Membership | Not VIP | Membership Benefits Are Open On The VIP Page | Stats Snapshot Unavailable | No Verified Player Analytics Payload Is Available Yet. Open The Full Workspace To Retry Or Review The Current Coverage Status.",
      }
    `);
    await openTab('Activity');
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|1,234 Diamonds. Open VIP Status|",
          "button|button|Achievements|aria-selected=false",
          "button|button|Activity|aria-selected=true",
          "button|button|Bonus CenterDaily And Special Claims↗|",
          "button|button|ChallengesMissions And Progress↗|",
          "button|button|Change Avatar|",
          "button|button|Edit Profile|",
          "button|button|Get VIP Membership →|",
          "button|button|LeaderboardsCircuit Rankings↗|",
          "button|button|Network|aria-selected=false",
          "button|button|NotificationsSeat Calls And Signals↗|",
          "button|button|Player AnalyticsDeep Stats And Leak Analysis↗|",
          "button|button|PromotionsLive Offers And Eligibility↗|",
          "button|button|SettingsTable, Alerts And Security↗|",
          "button|button|Snapshot|aria-selected=false",
          "button|button|Start Playing|",
          "button|button|VIP StatusMembership And Benefits↗|",
          "button|button|WalletBalances And Cashier Access↗|",
        ],
        "money": {
          "figures": [
            "101",
            "1,234",
            "<date>25",
            "4D",
          ],
          "hooks": [
            "data-tone=default",
          ],
        },
        "regions": [
          "span|status|",
          "button||1,234 Diamonds. Open VIP Status",
          "dl||Player Telemetry",
          "section||VIP Status",
          "nav||Player Workspaces",
          "nav|tablist|Profile Details",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "section|tabpanel|",
        ],
        "text": "No Hands Recorded Yet | BetaBluff | Player # | 101 | Member | <date>25 | Cash Hands | - | VPIP | - | ROI | - | Streak | 4D | Table Avatar | Not Set | Membership | Not VIP | Membership Benefits Are Open On The VIP Page | Cumulative P/L | Settled Hand Results By Day | No Recent Transactions To Display.",
      }
    `);
  });
});
