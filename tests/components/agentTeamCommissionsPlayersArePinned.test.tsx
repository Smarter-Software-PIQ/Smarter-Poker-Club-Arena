/**
 * THE AGENT TEAM COMMISSIONS AND PLAYERS BODIES ARE PINNED BEFORE THEIR FRAMES
 * MOVE (#SmarterDesign batch 7, 2026-11-28)
 *
 * The Commissions tab (AgentCommissionDashboard) and the Players tab
 * (PlayerSearch, DistributionHistory, AgentAnalyticsDashboard) of Agent Team
 * move from their old rounded cards and gold buttons to the arena workspace,
 * and the player record's "Cash Out Requested" panel opts into the arena case.
 * The condition on every money screen: no figure, word, data hook, named
 * region or control may change. This renders the real components with
 * synthetic reads and pins every printed figure (tests/helpers/moneyFigures.ts),
 * the full printed text, every named region and every control with its
 * disabled state, in every state the tabs show. The snapshots were recorded
 * against the old components on main 585373a71 and are unchanged by the pass.
 */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

type Answer = { data: unknown; error: unknown };
type Query = { table: string; filters: Record<string, unknown>; single: boolean };

const state = vi.hoisted(() => ({
  user: { id: 'agent-a' } as { id: string } | null,
  rpc: vi.fn(),
  query: vi.fn(),
  owed: vi.fn(),
  downline: vi.fn(),
  cashouts: vi.fn(),
}));

vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: state.user }) }));
vi.mock('../../src/hooks/useStaggerAnimation', () => ({
  useStaggerAnimation: () => ({ style: () => ({}) }),
}));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: (_key: string, fallback: unknown) => useState(fallback),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('../../src/lib/openExternal', () => ({ leaveForHub: vi.fn() }));
vi.mock('../../src/utils/clubIdResolver', () => ({
  resolveClubUUID: async (id: string) => id,
  resolveClubUUIDStrict: async (id: string) => id,
}));
vi.mock('../../src/services/CommissionService', () => ({
  CommissionService: { unsettledCommission: state.owed, downlineCommission: state.downline },
}));
vi.mock('../../src/stores/useUserStore', () => {
  const userState = { user: { id: 'agent-a' } };
  return {
    useUserStore: Object.assign((select: (s: unknown) => unknown) => select(userState), {
      getState: () => userState,
    }),
  };
});
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    subscribe: () => () => {},
    subscribeDebounced: () => () => {},
    removeRegisteredChannel: vi.fn(),
    getOrCreateChannel: () => {
      const c = { on: () => c, subscribe: vi.fn() };
      return c;
    },
  },
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      const result = Promise.resolve(state.rpc(...args));
      return Object.assign(result, { abortSignal: () => result });
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query: Record<string, unknown> = {};
      const chain = () => query;
      for (const method of ['select', 'abortSignal', 'order', 'limit', 'gte', 'ilike']) {
        query[method] = chain;
      }
      query.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return query;
      };
      query.in = (column: string, value: unknown) => {
        filters[column] = value;
        return query;
      };
      query.maybeSingle = () => Promise.resolve(state.query({ table, filters, single: true }));
      query.then = (resolve: (value: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(state.query({ table, filters, single: false })).then(resolve, reject);
      return query;
    },
  },
}));
vi.mock('../../src/services/CashoutService', () => ({
  captureCashoutAccountGuard: () => () => true,
  cashoutService: {
    getAgentPendingCashouts: (...args: unknown[]) => state.cashouts(...args),
  },
}));
vi.mock('../../src/services/CashoutOperation', () => ({
  prepareCashoutOperation: async (intent: unknown) => intent,
  captureCashoutStart: (intent: unknown) => intent,
  assertCashoutStartCurrent: () => {},
  captureCashoutReceiptCheck: (original: unknown) => original,
  recoverCashoutOperation: async () => ({ found: false }),
  runCashoutOperation: async () => true,
}));
vi.mock('../../src/utils/settlementLock', () => ({
  checkSettlementLock: async () => ({ locked: false }),
}));
vi.mock('../../src/lib/date', () => ({ formatRelativeShort: () => '8h ago' }));

import { AgentCommissionDashboard } from '../../src/components/agent/AgentCommissionDashboard';
import { PlayerSearch } from '../../src/components/admin/PlayerSearch';
import DistributionHistory from '../../src/components/agent/DistributionHistory';
import AgentAnalyticsDashboard from '../../src/components/agent/AgentAnalyticsDashboard';
import AgentCashoutPanel from '../../src/components/agent/AgentCashoutPanel';

/** Every element a test, a screen reader or an e2e spec can name. */
function regions(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll('[aria-label], [role], label, h2, h3, h4, summary, table, th'),
  ].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}`
  );
}

/** Every control, with its label, its placeholder and whether it can be pressed. */
function controls(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button, input, select, a')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const placeholder = el.getAttribute('placeholder');
    const name = el.getAttribute('aria-label') ?? (placeholder ? `[${placeholder}]` : '') ?? '';
    return `${el.tagName.toLowerCase()}|${name || el.textContent?.trim() || ''}${disabled}`;
  });
}

const MONTH =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:, \d{4})?/g;

/** The printed words in order, joined with a space, so a frame that moves a
 *  word into another element cannot pass as a changed word. */
function text(root: HTMLElement): string {
  const words: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '');
  return words
    .join(' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
    .replace(MONTH, '<date>')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<date>')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?/gi, '<time>')
    .replace(/\s+/g, ' ')
    .trim();
}

function pin(root: HTMLElement) {
  return {
    money: moneyFigures(root),
    text: text(root),
    regions: regions(root),
    controls: controls(root),
  };
}

const CLUB = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-28T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

let tables: Record<string, (q: Query) => Answer | Promise<Answer>>;
const rows =
  (data: unknown): (() => Answer) =>
  () => ({ data, error: null });
const refused = (): Answer => ({ data: null, error: { message: 'Permission Denied' } });

const summary = (total = 12500.5) => ({
  data: {
    total_earned: total,
    this_week: 1250.25,
    this_month: 4000.75,
    pending_payout: 9999.99,
    last_payout: null,
  },
  error: null,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  state.user = { id: 'agent-a' };
  tables = {};
  state.query.mockImplementation((q: Query) => (tables[q.table] ?? rows([]))(q));
  state.rpc.mockResolvedValue(summary());
  state.owed.mockResolvedValue(845.67);
  state.downline.mockResolvedValue([]);
  state.cashouts.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Commissions tab ──────────────────────────────────────────────────────

const RECORDS = [
  {
    id: 'one',
    club_id: CLUB,
    user_id: 'agent-a',
    amount: 12.34,
    source_type: 'cash_rake',
    created_at: daysAgo(1),
    settled_at: null,
  },
  {
    id: 'two',
    club_id: CLUB,
    user_id: 'agent-a',
    amount: 23456.5,
    source_type: 'tournament_fee',
    created_at: daysAgo(3),
    settled_at: daysAgo(2),
    settled_via: 'round2',
  },
];

const SUB_AGENTS = () => {
  tables.agents = (q) =>
    q.single
      ? { data: { id: 'me-a' }, error: null }
      : {
          data: [
            {
              id: 'down-a',
              user_id: 'user-a',
              total_players: 14,
              commission_rate: 0.25,
              created_at: daysAgo(40),
            },
            {
              id: 'down-b',
              user_id: 'user-b',
              total_players: 0,
              commission_rate: 0.1,
              created_at: daysAgo(4),
            },
          ],
          error: null,
        };
  tables.profiles = rows([
    { id: 'user-a', alias: 'Alpha Agent' },
    { id: 'user-b', alias: 'Beta Agent' },
  ]);
};

describe('the Commissions tab keeps every figure, word, region and control', () => {
  it('signed out', () => {
    state.user = null;
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Sign In To View Your Commission",
      }
    `);
  });

  it('loading', async () => {
    state.rpc.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await waitFor(() => expect(state.rpc).toHaveBeenCalled());
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "",
      }
    `);
  });

  it('the summary, with its flow and weekly average', async () => {
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Commission Flow');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
          "button|View Invoices",
        ],
        "money": {
          "figures": [
            "12,500.5",
            "1,250.25",
            "4,000.75",
            "845.67",
            "12,500.5",
            "4,000.75",
            "1,250.25",
            "845.67",
            "1,000",
          ],
          "hooks": [],
        },
        "regions": [
          "section||Automatic Weekly Settlement",
          "h3||",
          "h4||",
        ],
        "text": "Summary Records Sub-Agents Automatic Weekly Settlement Scheduled Every Monday At <time> Central Time. Unpaid Commission Remains Outstanding Until A Verified Transfer Is Recorded. View Invoices Total Earned 12,500.5 This Week 1,250.25 This Month 4,000.75 Unpaid Commission 845.67 Commission Flow Total Earned 12,500.5 This Month 4,000.75 This Week 1,250.25 Pending 845.67 Weekly Avg 1,000 / Week",
      }
    `);
  });

  it('the summary with nothing earned and the unpaid read unavailable', async () => {
    state.rpc.mockResolvedValue(summary(0));
    state.owed.mockRejectedValue(new Error('boom'));
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Total Earned');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
          "button|View Invoices",
        ],
        "money": {
          "figures": [
            "0",
            "1,250.25",
            "4,000.75",
          ],
          "hooks": [],
        },
        "regions": [
          "section||Automatic Weekly Settlement",
          "h3||",
        ],
        "text": "Summary Records Sub-Agents Automatic Weekly Settlement Scheduled Every Monday At <time> Central Time. Unpaid Commission Remains Outstanding Until A Verified Transfer Is Recorded. View Invoices Total Earned 0 This Week 1,250.25 This Month 4,000.75 Unpaid Commission Unavailable",
      }
    `);
  });

  it('the summary when its read is incomplete', async () => {
    state.rpc.mockResolvedValue({ data: { total_earned: 1 }, error: null });
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Your Commission Summary Could Not Be Loaded.');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
          "button|View Invoices",
          "button|Try Again",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "section||Automatic Weekly Settlement",
          "h3||",
        ],
        "text": "Summary Records Sub-Agents Automatic Weekly Settlement Scheduled Every Monday At <time> Central Time. Unpaid Commission Remains Outstanding Until A Verified Transfer Is Recorded. View Invoices Your Commission Summary Could Not Be Loaded. Try Again",
      }
    `);
  });

  it('the whole read failed', async () => {
    state.rpc.mockRejectedValue(new Error('boom'));
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Your Commission Data Could Not Be Loaded.');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Try Again",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|alert|",
        ],
        "text": "Your Commission Data Could Not Be Loaded. Try Again",
      }
    `);
  });

  it('records', async () => {
    tables.v_agent_commissions = rows(RECORDS);
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Automatic Weekly Settlement');
    fireEvent.click(screen.getByText('Records'));
    await screen.findByText('unpaid');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
        ],
        "money": {
          "figures": [
            "12.34",
            "23,456.5",
          ],
          "hooks": [],
        },
        "regions": [
          "table||",
          "th||",
          "th||",
          "th||",
          "th||",
        ],
        "text": "Summary Records Sub-Agents Status Source Commission Date unpaid cash rake 12.34 <date> paid tournament fee 23,456.5 <date>",
      }
    `);
  });

  it('no records', async () => {
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Automatic Weekly Settlement');
    fireEvent.click(screen.getByText('Records'));
    await screen.findByText('No Commission Records Yet');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Summary Records Sub-Agents No Commission Records Yet",
      }
    `);
  });

  it('records refused', async () => {
    tables.v_agent_commissions = refused;
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Automatic Weekly Settlement');
    fireEvent.click(screen.getByText('Records'));
    await screen.findByText('Your Commission Records Could Not Be Loaded.');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
          "button|Try Again",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|alert|",
        ],
        "text": "Summary Records Sub-Agents Your Commission Records Could Not Be Loaded. Try Again",
      }
    `);
  });

  it('sub-agents', async () => {
    SUB_AGENTS();
    state.downline.mockResolvedValue([
      { agentId: 'down-a', userId: 'user-a', unclaimed: 1234.5 },
      { agentId: 'down-b', userId: 'user-b', unclaimed: 0 },
    ]);
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Automatic Weekly Settlement');
    fireEvent.click(screen.getByText('Sub-Agents'));
    await screen.findByText('Alpha Agent');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
        ],
        "money": {
          "figures": [
            "14",
            "25",
            "1,234.5",
            "0",
            "10",
            "0",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Summary Records Sub-Agents Alpha Agent 14 Players • 25 % Rate 1,234.5 Beta Agent 0 Players • 10 % Rate 0",
      }
    `);
  });

  it('sub-agents with their balances unavailable', async () => {
    SUB_AGENTS();
    state.downline.mockRejectedValue(new Error('boom'));
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Automatic Weekly Settlement');
    fireEvent.click(screen.getByText('Sub-Agents'));
    await screen.findByText('Alpha Agent');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
          "button|Try Again",
        ],
        "money": {
          "figures": [
            "14",
            "25",
            "0",
            "10",
          ],
          "hooks": [],
        },
        "regions": [
          "div|alert|",
        ],
        "text": "Summary Records Sub-Agents Sub-Agent Commission Balances Could Not Be Loaded. Try Again Alpha Agent 14 Players • 25 % Rate Unavailable Beta Agent 0 Players • 10 % Rate Unavailable",
      }
    `);
  });

  it('no sub-agents', async () => {
    tables.agents = () => ({ data: { id: 'me-a' }, error: null });
    tables.agents = (q) => (q.single ? { data: { id: 'me-a' }, error: null } : rows([])());
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Automatic Weekly Settlement');
    fireEvent.click(screen.getByText('Sub-Agents'));
    await screen.findByText('No Sub-Agents Yet');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Summary Records Sub-Agents No Sub-Agents Yet",
      }
    `);
  });

  it('sub-agents refused', async () => {
    tables.agents = (q) => (q.single ? refused() : rows([])());
    const { container } = render(<AgentCommissionDashboard clubId={CLUB} />);
    await screen.findByText('Automatic Weekly Settlement');
    fireEvent.click(screen.getByText('Sub-Agents'));
    await screen.findByText('Your Sub-Agents Could Not Be Loaded.');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Summary",
          "button|Records",
          "button|Sub-Agents",
          "button|Try Again",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|alert|",
        ],
        "text": "Summary Records Sub-Agents Your Sub-Agents Could Not Be Loaded. Try Again",
      }
    `);
  });
});

// ── Players tab: Player Search ───────────────────────────────────────────

const PROFILES = [
  { id: 'p-1', username: 'kingfish', avatar_url: null, status: 'active', created_at: daysAgo(300) },
  { id: 'p-2', username: 'nightowl', avatar_url: null, status: 'banned', created_at: daysAgo(90) },
  {
    id: 'p-3',
    username: 'quietone',
    avatar_url: null,
    status: 'suspended',
    created_at: daysAgo(9),
  },
];

async function search(term: string) {
  const input = screen.getByPlaceholderText(/Search By/);
  fireEvent.change(input, { target: { value: term } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Player Search keeps every figure, word, region and control', () => {
  it('before a search', () => {
    const { container } = render(<PlayerSearch clubId={CLUB} />);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Username",
          "button|Id",
          "input|[Search By username...]",
          "button|⌕",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Player Search Username Id ⌕ ◉ Search For Players To Manage",
      }
    `);
  });

  it('searching', async () => {
    tables.profiles = () => new Promise(() => {});
    const { container } = render(<PlayerSearch clubId={CLUB} />);
    await search('king');
    await screen.findByText('Searching...');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Username",
          "button|Id",
          "input|[Search By username...]",
          "button|... (disabled)",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Player Search Username Id ... ◷ Searching...",
      }
    `);
  });

  it('results, active, banned and suspended', async () => {
    tables.profiles = rows(PROFILES);
    tables.club_members = rows([
      { user_id: 'p-1', club_id: CLUB, chip_balance: 18400.5 },
      { user_id: 'p-1', club_id: 'other', chip_balance: 1000 },
      { user_id: 'p-2', club_id: CLUB, chip_balance: 0 },
      { user_id: 'p-3', club_id: CLUB, chip_balance: 1234567.891 },
    ]);
    const { container } = render(<PlayerSearch clubId={CLUB} />);
    await search('o');
    await screen.findByText('kingfish');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Username",
          "button|Id",
          "input|[Search By username...]",
          "button|⌕",
          "button|◉",
          "button|⊘",
          "button|◉",
          "button|◉",
          "button|⊘",
        ],
        "money": {
          "figures": [
            "2",
            "19,400.50",
            "1",
            "0.00",
            "1",
            "1,234,567.89",
          ],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Player Search Username Id ⌕ K kingfish Active Joined: <date> Clubs: 2 Balance: 19,400.50 ◉ ⊘ N nightowl Banned Joined: <date> Clubs: 1 Balance: 0.00 ◉ Q quietone Suspended Joined: <date> Clubs: 1 Balance: 1,234,567.89 ◉ ⊘",
      }
    `);
  });

  it('no match', async () => {
    const { container } = render(<PlayerSearch clubId={CLUB} />);
    await search('zzz');
    await screen.findByText('No Players Found Matching "zzz"');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Username",
          "button|Id",
          "input|[Search By username...]",
          "button|⌕",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Player Search Username Id ⌕ ⌕ No Players Found Matching " zzz "",
      }
    `);
  });

  it('the search refused', async () => {
    tables.profiles = refused;
    const { container } = render(<PlayerSearch clubId={CLUB} />);
    await search('king');
    await screen.findByText('The Search Could Not Run. Please Try Again.');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Username",
          "button|Id",
          "input|[Search By username...]",
          "button|⌕",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Player Search Username Id ⌕ ! The Search Could Not Run. Please Try Again.",
      }
    `);
  });

  it('an invalid player id, on the ID key', async () => {
    const { container } = render(<PlayerSearch clubId={CLUB} />);
    fireEvent.click(screen.getByText('Id'));
    await search('not-a-uuid');
    await screen.findByText(/That Is Not A Valid Player ID/);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Username",
          "button|Id",
          "input|[Search By id...]",
          "button|⌕",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Player Search Username Id ⌕ ! That Is Not A Valid Player ID. Search By Username Or Email Instead.",
      }
    `);
  });
});

// ── Players tab: Distribution History ────────────────────────────────────

const TRANSACTIONS = [
  {
    id: 't-1',
    to_user_id: 'p-1',
    amount: 2500,
    created_at: daysAgo(1),
    transaction_type: 'agent_to_player',
    notes: null,
    clawed_back: false,
  },
  {
    id: 't-2',
    to_user_id: 'p-2',
    amount: 1250.5,
    created_at: daysAgo(4),
    transaction_type: 'promo_agent_to_player',
    notes: null,
    clawed_back: false,
  },
  {
    id: 't-3',
    to_user_id: 'p-1',
    amount: 400,
    created_at: daysAgo(12),
    transaction_type: 'send',
    notes: null,
    clawed_back: true,
  },
];

describe('Distribution History keeps every figure, word, region and control', () => {
  it('loading', async () => {
    tables.chip_transactions = () => new Promise(() => {});
    const { container } = render(<DistributionHistory userId="agent-a" clubId={CLUB} />);
    await waitFor(() => expect(state.query).toHaveBeenCalled());
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|7d",
          "button|30d",
          "button|90d",
          "button|All",
          "input|[Search By Player Name...]",
        ],
        "money": {
          "figures": [
            "7d",
            "30d",
            "90d",
            "0",
            "0",
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "h3||",
        ],
        "text": "Distribution History 7d 30d 90d All Total 0 Clawed Back 0 Net Out 0 Recipients 0",
      }
    `);
  });

  it('loaded, with a clawback and a promo', async () => {
    tables.chip_transactions = rows(TRANSACTIONS);
    tables.profiles = rows([
      { id: 'p-1', alias: 'King Fish' },
      { id: 'p-2', alias: 'Night Owl' },
    ]);
    const { container } = render(<DistributionHistory userId="agent-a" clubId={CLUB} />);
    await screen.findByText('Night Owl');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|7d",
          "button|30d",
          "button|90d",
          "button|All",
          "input|[Search By Player Name...]",
        ],
        "money": {
          "figures": [
            "7d",
            "30d",
            "90d",
            "4,150.5",
            "400",
            "3,750.5",
            "2",
            "2,500",
            "1,250.5",
            "400",
          ],
          "hooks": [],
        },
        "regions": [
          "h3||",
        ],
        "text": "Distribution History 7d 30d 90d All Total 4,150.5 Clawed Back 400 Net Out 3,750.5 Recipients 2 King Fish <date>, <time> 2,500 Night Owl <date>, <time> 1,250.5 Promo King Fish <date>, <time> 400 ↩ Clawed Back",
      }
    `);
  });

  it('empty', async () => {
    const { container } = render(<DistributionHistory userId="agent-a" clubId={CLUB} />);
    await screen.findByText('No Distributions Found For This Period');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|7d",
          "button|30d",
          "button|90d",
          "button|All",
          "input|[Search By Player Name...]",
        ],
        "money": {
          "figures": [
            "7d",
            "30d",
            "90d",
            "0",
            "0",
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "h3||",
        ],
        "text": "Distribution History 7d 30d 90d All Total 0 Clawed Back 0 Net Out 0 Recipients 0 No Distributions Found For This Period",
      }
    `);
  });

  it('the read refused reads as empty', async () => {
    tables.chip_transactions = refused;
    const { container } = render(<DistributionHistory userId="agent-a" clubId={CLUB} />);
    await screen.findByText('No Distributions Found For This Period');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|7d",
          "button|30d",
          "button|90d",
          "button|All",
          "input|[Search By Player Name...]",
        ],
        "money": {
          "figures": [
            "7d",
            "30d",
            "90d",
            "0",
            "0",
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "h3||",
        ],
        "text": "Distribution History 7d 30d 90d All Total 0 Clawed Back 0 Net Out 0 Recipients 0 No Distributions Found For This Period",
      }
    `);
  });
});

// ── Players tab: Agent Analytics ─────────────────────────────────────────

describe('Agent Analytics keeps every figure, word, region and control', () => {
  it('loading', async () => {
    tables.chip_transactions = () => new Promise(() => {});
    const { container } = render(<AgentAnalyticsDashboard userId="agent-a" clubId={CLUB} />);
    await waitFor(() => expect(state.query).toHaveBeenCalled());
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "h3||",
        ],
        "text": "Agent Analytics",
      }
    `);
  });

  it('loaded', async () => {
    tables.chip_transactions = rows(TRANSACTIONS);
    const { container } = render(<AgentAnalyticsDashboard userId="agent-a" clubId={CLUB} />);
    await screen.findByText('Top Recipients');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [
            "4,150.5",
            "3,750.5",
            "33.3",
            "1,384",
            "Distributions/Day (30D)",
            "0.1",
            "1",
            "1",
            "3",
            "Weekly Volume (8 Weeks)",
            "10/3",
            "10/10",
            "10/17",
            "10/24",
            "10/31",
            "11/7",
            "11/14",
            "11/21",
            "1",
            "p-1",
            "2,900",
            "2",
            "1",
            "2",
            "p-2",
            "1,250.5",
            "1",
          ],
          "hooks": [],
        },
        "regions": [
          "h3||",
          "h4||",
          "h4||",
        ],
        "text": "Agent Analytics 4,150.5 Total Distributed 3,750.5 Net Out 33.3 % Clawback Rate 1,384 Avg Per Txn Distributions/Day (30D) 0.1 Promo Distributions 1 Regular Distributions 1 Total Transactions 3 Weekly Volume (8 Weeks) 10/3 10/10 10/17 10/24 10/31 11/7 11/14 11/21 Top Recipients # 1 p-1 … 2,900 2 Txns 1 ↩ # 2 p-2 … 1,250.5 1 Txns",
      }
    `);
  });

  it('empty', async () => {
    const { container } = render(<AgentAnalyticsDashboard userId="agent-a" clubId={CLUB} />);
    await screen.findByText('Total Distributed');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [
            "0",
            "0",
            "0.0",
            "0",
            "Distributions/Day (30D)",
            "0.0",
            "0",
            "0",
            "0",
            "Weekly Volume (8 Weeks)",
            "10/3",
            "10/10",
            "10/17",
            "10/24",
            "10/31",
            "11/7",
            "11/14",
            "11/21",
          ],
          "hooks": [],
        },
        "regions": [
          "h3||",
          "h4||",
        ],
        "text": "Agent Analytics 0 Total Distributed 0 Net Out 0.0 % Clawback Rate 0 Avg Per Txn Distributions/Day (30D) 0.0 Promo Distributions 0 Regular Distributions 0 Total Transactions 0 Weekly Volume (8 Weeks) 10/3 10/10 10/17 10/24 10/31 11/7 11/14 11/21",
      }
    `);
  });
});

// ── The player record: Cash Out Requested ────────────────────────────────

const request = {
  id: 'req-1',
  playerId: 'member-1',
  agentId: 'agent-a',
  clubId: CLUB,
  amount: 18400.5,
  status: 'pending' as const,
  canDecide: true,
  canEscalate: true,
  isEscalated: false,
  playerName: 'King Fish',
  createdAt: '2026-11-28T04:00:00Z',
};

describe("the player record's Cash Out Requested panel", () => {
  it('prints the request', async () => {
    state.cashouts.mockResolvedValue([request]);
    const { container } = render(
      <AgentCashoutPanel clubId={CLUB} playerId="member-1" eyebrow="Cash Out Requested" />
    );
    await screen.findByText('King Fish');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Refresh",
          "button|Approve Cashout (disabled)",
          "button|Reject (disabled)",
          "button|Send To Notice Board",
        ],
        "money": {
          "figures": [
            "1",
            "8h Ago",
            "18,400.50",
          ],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Cash Out Requested Pending Cashouts 1 Refresh King Fish 8h Ago 18,400.50 Chips Approve Cashout Reject Send To Notice Board Approval Transfers The Verified Hold Into Your Agent Wallet. Rejection Returns The Verified Hold To The Player.",
      }
    `);
  });

  it('reads the same word for word on the arena case as on the console', async () => {
    state.cashouts.mockResolvedValue([request]);
    const consoleView = render(
      <AgentCashoutPanel clubId={CLUB} playerId="member-1" eyebrow="Cash Out Requested" />
    );
    await screen.findByText('King Fish');
    const before = pin(consoleView.container);
    cleanup();
    const arenaView = render(
      <AgentCashoutPanel clubId={CLUB} playerId="member-1" eyebrow="Cash Out Requested" arena />
    );
    await screen.findByText('King Fish');
    const after = pin(arenaView.container);
    expect(after.money).toEqual(before.money);
    expect(after.text).toEqual(before.text);
    expect(after.controls).toEqual(before.controls);
  });
});
