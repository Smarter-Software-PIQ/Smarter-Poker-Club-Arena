/**
 * THE WALLET PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign player pages batch P3, 2026-11-28)
 *
 * The Wallet (/wallet) is moving from its painted Cashier desk dress to the
 * arena workspace. The condition on every money screen: no figure, word, data
 * hook, named region or control may change. This renders the real page with
 * synthetic reads and pins every printed figure (tests/helpers/moneyFigures.ts),
 * the full printed text, every named region and every control (with its
 * selected, pressed and disabled state) on each of the five panes in each
 * state they show: loaded, empty, failed, offline and busy (a send in flight,
 * a claim in flight, and the first reads).
 *
 * The page header is the one part the pass replaces, so the body is pinned
 * with the header taken out, and the header is pinned by its one heading and
 * the controls of the whole page in order. The child statements the Ledger
 * pane mounts (TransactionHistory, ChipStatement, the Diamond Arena statement
 * and the flow panel) are their own surfaces and stand in as named markers.
 * The snapshots were recorded against the old page on main a3873e77f and are
 * unchanged by the pass.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

const FRIEND = '33333333-3333-4333-8333-333333333333';

const fx = vi.hoisted(() => ({
  online: true,
  clubId: null as string | null,
  balances: {} as Record<string, { total: number; available: number; locked: number }>,
  diamonds: 0,
  summary: undefined as unknown,
  ledger: {} as Record<string, unknown>,
  progress: vi.fn(),
  transfer: vi.fn(),
  confirm: vi.fn(),
  lifetime: vi.fn(),
  friends: [] as unknown[],
  friendsFail: false,
}));

vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }),
}));
vi.mock('@/stores/useUserStore', () => ({
  useUserStore: Object.assign(
    (selector: any) =>
      selector({
        user: { id: '11111111-1111-4111-8111-111111111111', player_number: 1042 },
        currentClubId: fx.clubId,
      }),
    { getState: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }) }
  ),
}));
vi.mock('@/stores/useWalletStore', () => {
  const store = () => ({
    balances: fx.balances,
    diamonds: fx.diamonds,
    loadBalances: async () => {},
    loadDiamonds: async () => {},
  });
  return {
    WALLET_STORE_FRESH_MS: 5000,
    useWalletStore: Object.assign(() => store(), {
      getState: () => ({
        ...store(),
        _balancesAt: 1,
        _balancesUserId: '11111111-1111-4111-8111-111111111111',
      }),
    }),
  };
});
vi.mock('@/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('@/hooks/useRealtimeFinancials', () => ({ useRealtimeFinancials: () => {} }));
vi.mock('@/hooks/useDiamondWalletSummary', () => ({
  useDiamondWalletSummary: () => ({ summary: fx.summary, load: async () => {} }),
}));
vi.mock('@/hooks/useDiamondLedger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useDiamondLedger')>()),
  useDiamondLedger: (_user: string, direction: string) => fx.ledger[direction],
}));
vi.mock('@/hooks/useNextDiamondFreeroll', () => ({
  useDiamondFreerollCountdown: () => ({ startsAt: null, text: '' }),
}));
vi.mock('@/hooks/useMasterBusSubscription', () => ({ useMasterBusSubscriptions: () => {} }));
vi.mock('@/core/MasterBus', () => ({
  masterBus: {
    subscribeDebounced: () => () => {},
    subscribe: () => () => {},
    emit: vi.fn(),
    removeRegisteredChannel: vi.fn(),
    getOrCreateChannel: () => {
      const c: any = { on: () => c, subscribe: () => c };
      return c;
    },
  },
}));
vi.mock('@/components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/components/common/confirmDialog', () => ({ confirmDialog: fx.confirm }));
vi.mock('@/services/DiamondService', () => ({
  DiamondService: { getLifetimeStats: fx.lifetime },
}));
vi.mock('@/pages/marketplace/marketplaceShared', () => ({
  storeFetch: (path: string, opts: any) =>
    path === '/api/rewards/progress' ? fx.progress(opts) : fx.transfer(path, opts),
}));
vi.mock('@/services/CashierResilience', () => ({ readCashierOnlineState: () => fx.online }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/clubIdResolver', () => ({ resolveClubUUID: async (v: string) => v }));
vi.mock('@/utils/resolvePageClubId', () => ({ resolvePageClubId: async () => null }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        in: () => chain,
        or: () => chain,
        limit: () => chain,
        range: () => chain,
        maybeSingle: async () => ({ data: { player_number: 1042 }, error: null }),
        then: (resolve: any, reject: any) =>
          (fx.friendsFail && (table === 'friendships' || table === 'profiles')
            ? Promise.resolve({ data: null, error: { message: 'down' } })
            : Promise.resolve({
                data:
                  table === 'friendships'
                    ? fx.friends.length
                      ? [{ friend_id: '33333333-3333-4333-8333-333333333333' }]
                      : []
                    : table === 'profiles'
                      ? fx.friends
                      : [],
                error: null,
              })
          ).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('@/components/games/DiamondsToChipsButton', () => ({
  default: () => <span data-stand-in="diamonds-to-chips" />,
}));
vi.mock('@/components/wallet/PromoPlayThroughProgress', () => ({
  PromoPlayThroughProgress: () => <span data-stand-in="promo-play-through" />,
}));
vi.mock('@/components/wallet/TransactionHistory', () => ({
  TransactionHistory: () => <span data-stand-in="transaction-history" />,
}));
vi.mock('@/components/wallet/ChipStatement', () => ({
  default: () => <span data-stand-in="chip-statement" />,
}));
vi.mock('@/components/wallet/DiamondArenaStatement', () => ({
  default: () => <span data-stand-in="diamond-arena-statement" />,
}));
vi.mock('@/components/wallet/DiamondFlowPanel', () => ({
  default: () => <span data-stand-in="diamond-flow" />,
}));
vi.mock('@/components/wallet/DepositWithdrawModal', () => ({ default: () => null }));
vi.mock('@/components/wallet/DisputeSubmitModal', () => ({ default: () => null }));

import PlayerWalletPage from '@/pages/PlayerWalletPage';

const LOADED_BALANCES = {
  BUSINESS: { total: 40000.5, available: 40000.5, locked: 0 },
  PLAYER: { total: 1234567.89, available: 1234167.89, locked: 400 },
  PROMO: { total: 25.25, available: 25.25, locked: 0 },
};
const ZERO = { total: 0, available: 0, locked: 0 };

const SUMMARY = {
  onHand: 1200,
  collateral: 200,
  sendable: 1000,
  inArena: 80,
  arenaSeats: 1,
  arenaEntries: 0,
  arena: {
    clubId: '002c2d27-9584-4e52-835a-bb2be148fc81',
    name: 'Diamond Arena',
    slug: 'diamond-arena',
    cashGamesEnabled: true,
    tournamentsEnabled: false,
    openCashTables: 17,
    minCashBuyIn: 80,
    cheapestTable: { id: 't-1', name: 'NLH 1/2', smallBlind: 1, bigBlind: 2 },
  },
  lifetimeEarned: 0,
  lifetimeSpent: 0,
};

const ledger = (rows: unknown[] | null, over: Record<string, unknown> = {}) => ({
  rows,
  error: false,
  hasMore: false,
  loadingMore: false,
  load: vi.fn(async () => {}),
  ...over,
});

const IN_ROWS = [
  {
    id: 'in-1',
    kind: 'diamond_gift_received',
    label: 'gift received',
    line: '',
    amount: 250,
    createdAt: '2026-11-20T15:00:00Z',
    counterpartyId: FRIEND,
  },
  {
    id: 'in-2',
    kind: 'daily_login',
    label: 'daily login',
    line: 'Daily Login Day 4',
    amount: 15,
    createdAt: '2026-11-19T15:00:00Z',
    counterpartyId: null,
  },
];
const OUT_ROWS = [
  {
    id: 'out-1',
    kind: 'diamond_gift_sent',
    label: 'gift sent',
    line: '',
    amount: -1000,
    createdAt: '2026-11-21T15:00:00Z',
    counterpartyId: FRIEND,
  },
  {
    id: 'out-2',
    kind: 'diamond_gift_refund',
    label: 'gift refund',
    line: '',
    amount: 40,
    createdAt: '2026-11-18T15:00:00Z',
    counterpartyId: FRIEND,
  },
];

const PROGRESS = {
  earnedToday: 35,
  dailyCap: 100,
  dailyRemaining: 65,
  loginStreak: 4,
  loginClaimedToday: false,
  nextLoginReward: 15,
  multiplier: 2,
  isVip: true,
  partial: false,
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function mount(tab?: string) {
  const view = render(
    <MemoryRouter>
      <PlayerWalletPage />
    </MemoryRouter>
  );
  await flush();
  if (tab) {
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    await flush();
  }
  return view;
}

/** Every element a test, a screen reader or an e2e spec can name. */
function regions(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll(
      '[aria-label], [role], [aria-busy], [aria-live], label, h2, h3, section, dl, ul, time'
    ),
  ].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-busy') ?? ''}|${el.getAttribute('aria-live') ?? ''}|${el.getAttribute('aria-valuenow') ?? ''}`
  );
}

/** Every control, with its label, value, state and whether it can be pressed. */
function controls(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button, input, select, a')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const pressed = el.getAttribute('aria-pressed');
    const selected = el.getAttribute('aria-selected');
    const value =
      el.tagName === 'INPUT' || el.tagName === 'SELECT'
        ? ` =${(el as HTMLInputElement).value}`
        : '';
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    const title = el.getAttribute('title');
    return `${el.tagName.toLowerCase()}|${name}${value}${pressed ? ` [pressed=${pressed}]` : ''}${selected ? ` [selected=${selected}]` : ''}${title ? ` [title=${title}]` : ''}${disabled}`;
  });
}

function text(root: HTMLElement): string {
  const words: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '');
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/** The page below its header. The header is what the pass replaces. */
function body(container: HTMLElement): HTMLElement {
  const page = container.querySelector('.wallet-page') as HTMLElement;
  const copy = page.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('header').forEach((el) => el.remove());
  return copy;
}

function pin(container: HTMLElement) {
  const page = container.querySelector('.wallet-page') as HTMLElement;
  const root = body(container);
  return {
    page: {
      surface: page.getAttribute('data-arena-surface'),
      heading: [...page.querySelectorAll('h1')].map((h) => h.textContent),
      controls: controls(page),
    },
    money: moneyFigures(root),
    text: text(root),
    regions: regions(root),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fx.online = true;
  fx.clubId = null;
  fx.balances = LOADED_BALANCES;
  fx.diamonds = 1200;
  fx.summary = SUMMARY;
  fx.ledger = { in: ledger(IN_ROWS, { hasMore: true }), out: ledger(OUT_ROWS) };
  fx.progress.mockResolvedValue(PROGRESS);
  fx.lifetime.mockResolvedValue({ lifetimeEarned: 9876, lifetimeSpent: 8676 });
  fx.friends = [{ id: FRIEND, poker_alias: 'River Rat' }];
  fx.friendsFail = false;
  // The figures count up unless the player asked for reduced motion; the pin
  // reads the settled figure.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }))
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Wallet prints the same figures, words and controls', () => {
  it('overview, loaded with escrow, arena custody and a club in context', async () => {
    fx.clubId = '44444444-4444-4444-8444-444444444444';
    const { container } = await mount();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "1,200",
            "1,000",
            "80",
            "200 Bought Recently Are Held Until The Refund Window Closes And Cannot Be Sent.",
            "1,234,567.89",
            "1,234,167.89",
            "400",
            "25.25",
            "25.25",
            "0",
            "40,000.50",
            "40,000.50",
            "0",
          ],
          "hooks": [
            "data-cashier-layout=directory",
            "data-stand-in=diamonds-to-chips",
            "data-stand-in=promo-play-through",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Raise A Dispute]",
            "button|Wallets [selected=true]",
            "button|Send [selected=false]",
            "button|Receive [selected=false]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "button|Buy Diamonds",
            "button|Return To The Diamond Arena",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "article||Diamonds: 1,200 On Hand, 1,000 Sendable, 80 In The Arena|||",
          "dl|||||",
          "article||Player Wallet: 1,234,167.89 Available, 400 Locked, 1,234,567.89 Total|||",
          "dl|||||",
          "article||Promo Wallet: 25.25 Available, 0 Locked, 25.25 Total|||",
          "dl|||||",
          "article||Business Wallet: 40,000.50 Available, 0 Locked, 40,000.50 Total|||",
          "dl|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Diamonds Seats, VIP, Perks And Gifts 1,200 Diamonds On Hand Sendable 1,000 In The Arena 80 Buy Diamonds Return To The Diamond Arena 200 Bought Recently Are Held Until The Refund Window Closes And Cannot Be Sent. Diamonds Buy Your Seat In The Diamond Arena And Spend On VIP, Table Perks, Throwables And Club Shop Items. Send To Friends From The Send Tab. Player Wallet Table Buy-Ins And Gameplay 1,234,567.89 Balance Available 1,234,167.89 Locked 400 Promo Wallet Bonuses And Rewards 25.25 Balance Available 25.25 Locked 0 Agent Wallet Commissions And Settlements 40,000.50 Balance Available 40,000.50 Locked 0",
      }
    `);
  });

  it('overview, empty and offline with no club', async () => {
    fx.online = false;
    fx.balances = { BUSINESS: ZERO, PLAYER: ZERO, PROMO: ZERO };
    fx.diamonds = 0;
    fx.summary = null;
    const { container } = await mount();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "0.00",
            "0.00",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
          ],
          "hooks": [
            "data-cashier-layout=directory",
            "data-stand-in=promo-play-through",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=true]",
            "button|Send [selected=false]",
            "button|Receive [selected=false]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "button|Buy Diamonds",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||0 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "article||Diamonds: 0 On Hand, Unavailable Sendable, Unavailable In The Arena|||",
          "dl|||||",
          "article||Player Wallet: 0 Available, 0 Locked, 0 Total|||",
          "dl|||||",
          "article||Promo Wallet: 0 Available, 0 Locked, 0 Total|||",
          "dl|||||",
          "article||Business Wallet: 0 Available, 0 Locked, 0 Total|||",
          "dl|||||",
        ],
        "text": "All Wallets Combined 0.00 Playable Now 0.00 Diamonds 0 Wallet Ledger Offline Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Diamonds Seats, VIP, Perks And Gifts 0 Diamonds On Hand Sendable Unavailable In The Arena Unavailable Buy Diamonds Diamonds Buy Your Seat In The Diamond Arena And Spend On VIP, Table Perks, Throwables And Club Shop Items. Send To Friends From The Send Tab. Player Wallet Table Buy-Ins And Gameplay 0 Balance Available 0 Locked 0 Promo Wallet Bonuses And Rewards 0 Balance Available 0 Locked 0 Agent Wallet Commissions And Settlements 0 Balance Available 0 Locked 0",
      }
    `);
  });

  it('send, loaded', async () => {
    const { container } = await mount('Send');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "Sendable: 1,000 Diamonds",
            ". 200 Bought Recently Are Held Until The Refund Window Closes",
            "1,000",
            "40",
          ],
          "hooks": [
            "data-cashier-layout=directory",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=true]",
            "button|Receive [selected=false]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "select|Choose A FriendPlayer =",
            "input| =",
            "button|Send Diamonds (disabled)",
            "button|Open Club Cashier",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "label|||||",
          "label|||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
          "ul|||||",
          "time|||||",
          "time|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Send Diamonds To A Friend Diamonds Move Instantly To Any Accepted Friend. Gifts Cannot Be Reversed. Recipient Choose A Friend Player Amount (Diamonds) Sendable: 1,000 Diamonds . 200 Bought Recently Are Held Until The Refund Window Closes Send Diamonds Manage Club Chips Chips Belong To Their Club. Open The Club Cashier To View Your Balance And Available Transfers. Open Club Cashier Diamonds You Have Sent Every Gift You Have Sent, Newest First. A Refund Appears Here Too, Because A Returned Gift Is Part Of The Same Story. Gift Sent Sent To Player - 1,000 Nov 21 Gift Refund Sent To Player + 40 Nov 18",
      }
    `);
  });

  it('send, no friends and nothing sent', async () => {
    fx.friends = [];
    fx.ledger = { in: ledger([]), out: ledger([]) };
    const { container } = await mount('Send');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "Sendable: 1,000 Diamonds",
            ". 200 Bought Recently Are Held Until The Refund Window Closes",
          ],
          "hooks": [
            "data-cashier-layout=directory",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=true]",
            "button|Receive [selected=false]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "select|No Accepted Friends Yet = (disabled)",
            "input| =",
            "button|Send Diamonds (disabled)",
            "button|Friends Page",
            "button|Open Club Cashier",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "label|||||",
          "label|||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Send Diamonds To A Friend Diamonds Move Instantly To Any Accepted Friend. Gifts Cannot Be Reversed. Recipient No Accepted Friends Yet Amount (Diamonds) Sendable: 1,000 Diamonds . 200 Bought Recently Are Held Until The Refund Window Closes Send Diamonds Add Friends From The Friends Page To Send Them Diamonds. Manage Club Chips Chips Belong To Their Club. Open The Club Cashier To View Your Balance And Available Transfers. Open Club Cashier Diamonds You Have Sent Every Gift You Have Sent, Newest First. A Refund Appears Here Too, Because A Returned Gift Is Part Of The Same Story. You Have Not Sent Any Diamonds Yet. Pick A Friend Above.",
      }
    `);
  });

  it('send, every read failed', async () => {
    fx.friendsFail = true;
    fx.ledger = { in: ledger([]), out: ledger([], { error: true }) };
    const { container } = await mount('Send');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "Sendable: 1,000 Diamonds",
            ". 200 Bought Recently Are Held Until The Refund Window Closes",
          ],
          "hooks": [
            "data-cashier-layout=directory",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=true]",
            "button|Receive [selected=false]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "select|Could Not Load Friends = (disabled)",
            "input| =",
            "button|Send Diamonds (disabled)",
            "button|Retry",
            "button|Open Club Cashier",
            "button|Retry",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "label|||||",
          "label|||||",
          "p|alert||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
          "div|alert||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Send Diamonds To A Friend Diamonds Move Instantly To Any Accepted Friend. Gifts Cannot Be Reversed. Recipient Could Not Load Friends Amount (Diamonds) Sendable: 1,000 Diamonds . 200 Bought Recently Are Held Until The Refund Window Closes Send Diamonds Your Friend List Could Not Be Loaded. Retry Manage Club Chips Chips Belong To Their Club. Open The Club Cashier To View Your Balance And Available Transfers. Open Club Cashier Diamonds You Have Sent Every Gift You Have Sent, Newest First. A Refund Appears Here Too, Because A Returned Gift Is Part Of The Same Story. Could Not Load Your Sends. Retry",
      }
    `);
  });

  it('send, a send in flight and the sends still reading', async () => {
    fx.ledger = { in: ledger(null), out: ledger(null) };
    fx.confirm.mockResolvedValue(true);
    fx.transfer.mockImplementation(() => new Promise(() => {}));
    const { container } = await mount('Send');
    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: FRIEND } });
    fireEvent.change(screen.getByLabelText('Amount (Diamonds)'), { target: { value: '5' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send Diamonds' })));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "Sendable: 1,000 Diamonds",
            ". 200 Bought Recently Are Held Until The Refund Window Closes",
          ],
          "hooks": [
            "data-cashier-layout=directory",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=true]",
            "button|Receive [selected=false]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "select|Choose A FriendPlayer =33333333-3333-4333-8333-333333333333",
            "input| =5",
            "button|Sending... (disabled)",
            "button|Open Club Cashier",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "label|||||",
          "label|||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Send Diamonds To A Friend Diamonds Move Instantly To Any Accepted Friend. Gifts Cannot Be Reversed. Recipient Choose A Friend Player Amount (Diamonds) Sendable: 1,000 Diamonds . 200 Bought Recently Are Held Until The Refund Window Closes Sending... Manage Club Chips Chips Belong To Their Club. Open The Club Cashier To View Your Balance And Available Transfers. Open Club Cashier Diamonds You Have Sent Every Gift You Have Sent, Newest First. A Refund Appears Here Too, Because A Returned Gift Is Part Of The Same Story. Loading Your Sends...",
      }
    `);
  });

  it('receive, loaded with more to read', async () => {
    const { container } = await mount('Receive');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "#1042",
            "11111111-1111-4111-8111-111111111111",
            "http://localhost:3000/hub/club-arena/profile/11111111-1111-4111-8111-111111111111",
            "250",
            "Daily Login Day 4",
            "15",
          ],
          "hooks": [
            "data-cashier-layout=directory",
            "data-testid=ledger-prefetch-sentinel",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=false]",
            "button|Receive [selected=true]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "button|Copy Player ID",
            "button|Copy Profile Link",
            "button|Manage Friends",
            "button|Load Older Diamonds",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "button||Copy Player ID|||",
          "button||Copy Profile Link|||",
          "section|||||",
          "h3|||||",
          "ul|||||",
          "time|||||",
          "time|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Receive Diamonds And Chips Friends Send Diamonds From Their Wallet. Chips Arrive From Your Club Cashier Or Agent. Player Number #1042 Player ID 11111111-1111-4111-8111-111111111111 Copy Profile Link http://localhost:3000/hub/club-arena/profile/11111111-1111-4111-8111-111111111111 Copy Share Your Profile So Friends Can Add You, Then Send. Manage Friends Diamonds Received Every Credit That Landed In Your Diamond Ledger, Newest First. Gift Received Received From Player + 250 Nov 20 Daily Login Daily Login Day 4 + 15 Nov 19 Load Older Diamonds",
      }
    `);
  });

  it('receive, a later page failed', async () => {
    fx.ledger = { in: ledger(IN_ROWS, { error: true, hasMore: true }), out: ledger([]) };
    const { container } = await mount('Receive');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "#1042",
            "11111111-1111-4111-8111-111111111111",
            "http://localhost:3000/hub/club-arena/profile/11111111-1111-4111-8111-111111111111",
            "250",
            "Daily Login Day 4",
            "15",
          ],
          "hooks": [
            "data-cashier-layout=directory",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=false]",
            "button|Receive [selected=true]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "button|Copy Player ID",
            "button|Copy Profile Link",
            "button|Manage Friends",
            "button|Retry",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "button||Copy Player ID|||",
          "button||Copy Profile Link|||",
          "section|||||",
          "h3|||||",
          "ul|||||",
          "time|||||",
          "time|||||",
          "div|alert||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Receive Diamonds And Chips Friends Send Diamonds From Their Wallet. Chips Arrive From Your Club Cashier Or Agent. Player Number #1042 Player ID 11111111-1111-4111-8111-111111111111 Copy Profile Link http://localhost:3000/hub/club-arena/profile/11111111-1111-4111-8111-111111111111 Copy Share Your Profile So Friends Can Add You, Then Send. Manage Friends Diamonds Received Every Credit That Landed In Your Diamond Ledger, Newest First. Gift Received Received From Player + 250 Nov 20 Daily Login Daily Login Day 4 + 15 Nov 19 Could Not Load Older Diamonds. Retry",
      }
    `);
  });

  it('receive, empty', async () => {
    fx.ledger = { in: ledger([]), out: ledger([]) };
    const { container } = await mount('Receive');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "#1042",
            "11111111-1111-4111-8111-111111111111",
            "http://localhost:3000/hub/club-arena/profile/11111111-1111-4111-8111-111111111111",
          ],
          "hooks": [
            "data-cashier-layout=directory",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=false]",
            "button|Receive [selected=true]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=false]",
            "button|Copy Player ID",
            "button|Copy Profile Link",
            "button|Manage Friends",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "button||Copy Player ID|||",
          "button||Copy Profile Link|||",
          "section|||||",
          "h3|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Receive Diamonds And Chips Friends Send Diamonds From Their Wallet. Chips Arrive From Your Club Cashier Or Agent. Player Number #1042 Player ID 11111111-1111-4111-8111-111111111111 Copy Profile Link http://localhost:3000/hub/club-arena/profile/11111111-1111-4111-8111-111111111111 Copy Share Your Profile So Friends Can Add You, Then Send. Manage Friends Diamonds Received Every Credit That Landed In Your Diamond Ledger, Newest First. No Diamonds Received Yet. Claim Your Daily Login From The Earn Tab.",
      }
    `);
  });

  it('earn, loaded', async () => {
    const { container } = await mount('Earn');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "Claim Once A Day. The Payout Climbs With Your Streak, Up To 25 Diamonds.",
            "Your Next Claim Pays 15.",
            "4 Days",
            "35 / 100",
            "2x VIP",
            "9,876",
            "8,676",
            "1,200",
          ],
          "hooks": [
            "data-cashier-layout=directory",
            "data-stand-in=diamond-flow",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=false]",
            "button|Receive [selected=false]",
            "button|Earn [selected=true]",
            "button|Ledger [selected=false]",
            "button|Claim Daily Diamonds",
            "button|RakebackChips Back On Every Raked Hand You Play.",
            "button|Daily ChallengesComplete Missions For Diamond Payouts.",
            "button|BonusesYour Daily Club Arena Bonus And Club Promotions.",
            "button|PromotionsClub Promos, Leaderboards And Prize Pools.",
            "button|AchievementsMilestones, Badges, And Unlock Progress.",
            "button|VIP StatusMembership And Included Benefits.",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "div|progressbar|Diamonds Earned Today|||35",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Daily Login Reward Claim Once A Day. The Payout Climbs With Your Streak, Up To 25 Diamonds. Your Next Claim Pays 15. Streak 4 Days Earned Today 35 / 100 Multiplier 2x VIP Diamonds Land In Your Wallet Instantly. Claim Daily Diamonds Lifetime Diamonds From Your Diamond Ledger. Earned Is Every Credit; Spent Is Every Debit. Earned 9,876 Spent 8,676 On Hand 1,200 Where Your Diamonds Go Every Diamond You Spent, By What It Bought. Every Diamond You Earned, By Where It Came From. Summed From Your Whole Ledger. More Ways To Earn Rakeback Chips Back On Every Raked Hand You Play. Daily Challenges Complete Missions For Diamond Payouts. Bonuses Your Daily Club Arena Bonus And Club Promotions. Promotions Club Promos, Leaderboards And Prize Pools. Achievements Milestones, Badges, And Unlock Progress. VIP Status Membership And Included Benefits.",
      }
    `);
  });

  it('earn, every read failed', async () => {
    fx.progress.mockRejectedValue(new Error('down'));
    fx.lifetime.mockResolvedValue(null);
    const { container } = await mount('Earn');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "Claim Once A Day. The Payout Climbs With Your Streak, Up To 25 Diamonds.",
            "1,200",
          ],
          "hooks": [
            "data-cashier-layout=directory",
            "data-stand-in=diamond-flow",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=false]",
            "button|Receive [selected=false]",
            "button|Earn [selected=true]",
            "button|Ledger [selected=false]",
            "button|Retry",
            "button|Claim Daily Diamonds",
            "button|Retry",
            "button|RakebackChips Back On Every Raked Hand You Play.",
            "button|Daily ChallengesComplete Missions For Diamond Payouts.",
            "button|BonusesYour Daily Club Arena Bonus And Club Promotions.",
            "button|PromotionsClub Promos, Leaderboards And Prize Pools.",
            "button|AchievementsMilestones, Badges, And Unlock Progress.",
            "button|VIP StatusMembership And Included Benefits.",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "p|alert||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Daily Login Reward Claim Once A Day. The Payout Climbs With Your Streak, Up To 25 Diamonds. Streak Unavailable Earned Today Unavailable Multiplier Unavailable Reward Status Is Unavailable. Retry Claim Daily Diamonds Lifetime Diamonds From Your Diamond Ledger. Earned Is Every Credit; Spent Is Every Debit. Earned Unavailable Spent Unavailable On Hand 1,200 Your Lifetime Totals Could Not Be Read. Retry Where Your Diamonds Go Every Diamond You Spent, By What It Bought. Every Diamond You Earned, By Where It Came From. Summed From Your Whole Ledger. More Ways To Earn Rakeback Chips Back On Every Raked Hand You Play. Daily Challenges Complete Missions For Diamond Payouts. Bonuses Your Daily Club Arena Bonus And Club Promotions. Promotions Club Promos, Leaderboards And Prize Pools. Achievements Milestones, Badges, And Unlock Progress. VIP Status Membership And Included Benefits.",
      }
    `);
  });

  it('earn, still reading and a claim in flight', async () => {
    fx.lifetime.mockImplementation(() => new Promise(() => {}));
    fx.progress.mockResolvedValueOnce(PROGRESS);
    const { container } = await mount('Earn');
    fx.transfer.mockImplementation(() => new Promise(() => {}));
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Claim Daily Diamonds' }))
    );
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
            "Claim Once A Day. The Payout Climbs With Your Streak, Up To 25 Diamonds.",
            "Your Next Claim Pays 15.",
            "4 Days",
            "35 / 100",
            "2x VIP",
            "1,200",
          ],
          "hooks": [
            "data-cashier-layout=directory",
            "data-stand-in=diamond-flow",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=false]",
            "button|Receive [selected=false]",
            "button|Earn [selected=true]",
            "button|Ledger [selected=false]",
            "button|Claiming... (disabled)",
            "button|RakebackChips Back On Every Raked Hand You Play.",
            "button|Daily ChallengesComplete Missions For Diamond Payouts.",
            "button|BonusesYour Daily Club Arena Bonus And Club Promotions.",
            "button|PromotionsClub Promos, Leaderboards And Prize Pools.",
            "button|AchievementsMilestones, Badges, And Unlock Progress.",
            "button|VIP StatusMembership And Included Benefits.",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "div|progressbar|Diamonds Earned Today|||35",
          "section|||||",
          "h3|||||",
          "dl|||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Daily Login Reward Claim Once A Day. The Payout Climbs With Your Streak, Up To 25 Diamonds. Your Next Claim Pays 15. Streak 4 Days Earned Today 35 / 100 Multiplier 2x VIP Diamonds Land In Your Wallet Instantly. Claiming... Lifetime Diamonds From Your Diamond Ledger. Earned Is Every Credit; Spent Is Every Debit. Earned Checking Spent Checking On Hand 1,200 Where Your Diamonds Go Every Diamond You Spent, By What It Bought. Every Diamond You Earned, By Where It Came From. Summed From Your Whole Ledger. More Ways To Earn Rakeback Chips Back On Every Raked Hand You Play. Daily Challenges Complete Missions For Diamond Payouts. Bonuses Your Daily Club Arena Bonus And Club Promotions. Promotions Club Promos, Leaderboards And Prize Pools. Achievements Milestones, Badges, And Unlock Progress. VIP Status Membership And Included Benefits.",
      }
    `);
  });

  it('ledger', async () => {
    const { container } = await mount('Ledger');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "1,274,593.64",
            "1,234,167.89",
            "1,200",
            "400.00",
            "80",
          ],
          "hooks": [
            "data-cashier-layout=directory",
            "data-stand-in=transaction-history",
            "data-stand-in=chip-statement",
            "data-stand-in=diamond-arena-statement",
          ],
        },
        "page": {
          "controls": [
            "button|Page Help",
            "button|Add Chips",
            "button|Cash Out",
            "button|Full History",
            "button|Dispute [title=Enter A Club First To Raise A Dispute There] (disabled)",
            "button|Wallets [selected=false]",
            "button|Send [selected=false]",
            "button|Receive [selected=false]",
            "button|Earn [selected=false]",
            "button|Ledger [selected=true]",
          ],
          "heading": [
            "Wallet",
          ],
          "surface": "wallet",
        },
        "regions": [
          "section|||||",
          "h2|||||",
          "div||||polite|",
          "dl|||||",
          "span||1,200 Diamonds|||",
          "div|status||||",
          "div|group|Wallet Actions|||",
          "button||Full History|||",
          "div|tablist|Wallet Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
          "section|||||",
          "h3|||||",
        ],
        "text": "All Wallets Combined 1,274,593.64 Playable Now 1,234,167.89 Diamonds 1,200 In Escrow 400.00 Chips Secured At The Table In The Arena 80 Diamonds At Your Diamond Arena Seat Wallet Ledger Unavailable Add Chips Cash Out History Dispute Wallets Send Receive Earn Ledger Wallet Ledger Chip Statement Diamond Arena Statement Every Buy-In And Cash-Out At Your Diamond Arena Seats, And Whether Each One Reconciles With Your Wallet.",
      }
    `);
  });
});
