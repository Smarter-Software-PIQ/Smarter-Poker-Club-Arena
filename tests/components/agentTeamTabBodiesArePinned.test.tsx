/**
 * THE AGENT TEAM HIERARCHY AND PAYOUTS BODIES ARE PINNED BEFORE THEIR FRAMES
 * MOVE (#SmarterDesign batch 6, 2026-11-28)
 *
 * The Hierarchy tab (AgentAssignmentPanel, AgentAssignmentHistory, AgentTree)
 * and the Payouts tab (AgentCashoutPanel) of Agent Team are moving from their
 * old dress to the arena workspace. The condition on every money screen: no
 * figure, word, data hook or named region may change. This renders the real
 * components with synthetic reads and pins every printed figure
 * (tests/helpers/moneyFigures.ts), the full printed text and every named
 * region, in every state the tabs show. The snapshots were recorded against
 * the old components on main c6ec86b51 and are unchanged by the pass.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

const state = vi.hoisted(() => ({
  agents: [] as Array<Record<string, unknown>>,
  agentsError: null as Error | null,
  rpc: vi.fn(),
  from: vi.fn(),
  preview: vi.fn(),
  history: vi.fn(),
  cashouts: vi.fn(),
}));

vi.mock('../../src/services/AgentService', () => ({
  AgentService: {
    getAgents: async () => {
      if (state.agentsError) throw state.agentsError;
      return state.agents;
    },
  },
}));
vi.mock('../../src/stores/useUserStore', () => {
  const userState = { user: { id: 'viewer' } };
  return {
    useUserStore: Object.assign((select: (s: unknown) => unknown) => select(userState), {
      getState: () => userState,
    }),
  };
});
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: state.rpc, from: state.from } }));
vi.mock('../../src/services/UnionOpsService', () => ({
  UnionOpsService: { reassignClubMembers: vi.fn() },
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/utils/fetchAllRows', () => ({
  fetchAllRows: async () => [
    { user_id: 'player', role: 'player', agent_id: 'source' },
    { user_id: 'source', role: 'agent', agent_id: null },
    { user_id: 'target', role: 'super_agent', agent_id: null },
  ],
}));
vi.mock('../../src/services/AgentAssignmentService', () => ({
  AgentAssignmentService: { preview: state.preview, history: state.history },
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'cashier-a' } }),
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
vi.mock('../../src/utils/clubIdResolver', () => ({ resolveClubUUID: async (id: string) => id }));
vi.mock('../../src/lib/date', () => ({ formatRelativeShort: () => '8h ago' }));
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

import AgentTree from '../../src/components/agent/AgentTree';
import AgentAssignmentPanel from '../../src/components/agent/AgentAssignmentPanel';
import AgentCashoutPanel from '../../src/components/agent/AgentCashoutPanel';

/** Every element a test, a screen reader or an e2e spec can name. */
function regions(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[aria-label], [role], label, h2, h3, h4, summary')].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}`
  );
}

/** Every control, with its label and whether it can be pressed. */
function controls(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button, input, select, a')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    return `${el.tagName.toLowerCase()}|${name}${disabled}`;
  });
}

/** The printed words in order. Text nodes are joined with a space, so a frame
 *  that moves a word into another element cannot pass as a changed word, and a
 *  changed word cannot hide in a moved frame. */
function text(root: HTMLElement): string {
  const words: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '');
  return words
    .join(' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
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

const AGENTS = [
  {
    id: 'agent-super',
    userId: 'user-super',
    role: 'super_agent',
    status: 'active',
    displayName: 'Super One',
    businessBalance: 18400.5,
    activePlayerCount: 12,
    subAgentCount: 1,
    commissionRate: 35,
  },
  {
    id: 'agent-child',
    userId: 'user-child',
    parentAgentId: 'agent-super',
    role: 'agent',
    status: 'active',
    displayName: 'Child Two',
    businessBalance: 1000,
    activePlayerCount: 3,
    subAgentCount: 0,
    commissionRate: 20,
  },
  {
    id: 'agent-held',
    userId: 'user-held',
    role: 'sub_agent',
    status: 'suspended',
    displayName: 'Held Three',
    businessBalance: 1234567.89,
    activePlayerCount: 0,
    subAgentCount: 0,
    commissionRate: 12.5,
  },
];

const cashout = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id,
  playerId: `player-${id}`,
  agentId: 'cashier-a',
  clubId: 'club-a',
  amount,
  status: 'pending' as const,
  canDecide: true,
  canEscalate: true,
  isEscalated: false,
  playerName: id,
  createdAt: '2026-09-15T00:00:00Z',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  state.agents = AGENTS;
  state.agentsError = null;
  state.rpc.mockImplementation(async () => ({ data: true, error: null }));
  state.from.mockReturnValue({
    select: () => ({
      in: async () => ({
        data: [
          { id: 'player', alias: 'Player One' },
          { id: 'source', alias: 'Source Agent' },
          { id: 'target', alias: 'Target Agent' },
        ],
        error: null,
      }),
    }),
  });
  state.preview.mockImplementation(async (club: string, ids: string[], target: string) => ({
    club_id: club,
    review_token: 'a'.repeat(32),
    destination: { user_id: target, name: 'Target Agent', role: 'super_agent' },
    members: ids.map((id: string) => ({
      user_id: id,
      name: 'Player One',
      role: 'player',
      source_user_id: 'source',
      source_name: 'Source Agent',
    })),
    selected_count: ids.length,
    affected_count: 1234,
  }));
  state.history.mockResolvedValue({
    rows: [
      {
        operation_id: 'op-0001',
        created_at: '2026-11-20T12:00:00Z',
        actor_name: 'owner name',
        source_name: 'source agent',
        destination_name: 'target agent',
        moved: 1250,
        review: {
          club_id: 'club',
          review_token: 'b'.repeat(32),
          destination: { user_id: 'target', name: 'Target Agent', role: 'super_agent' },
          members: [
            {
              user_id: 'player',
              name: 'player one',
              role: 'player',
              source_user_id: 'source',
              source_name: 'source agent',
            },
          ],
          selected_count: 1,
          affected_count: 1250,
        },
      },
    ],
    hasMore: true,
  });
  state.cashouts.mockResolvedValue([]);
});
afterEach(cleanup);

describe('the Hierarchy tab keeps every figure, word, region and control', () => {
  it('the tree, expanded', async () => {
    const { container } = render(
      <AgentTree clubId="club-a" onAgentClick={() => {}} onTransferClick={() => {}} />
    );
    await screen.findByText('Super One');
    fireEvent.click(screen.getByText('Expand All'));
    await screen.findByText('Child Two');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "input|",
          "button|Expand All",
          "button|Collapse All",
          "button|Refresh",
          "button|▼",
          "button|Send Chips",
          "button|Send Chips",
        ],
        "money": {
          "figures": [
            "3",
            "12",
            "1",
            "18,400.50",
            "35",
            "3",
            "0",
            "1,000.00",
            "20",
            "0",
            "0",
            "1,234,567.89",
            "12.5",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "3 Agents Expand All Collapse All Refresh ▼ S Super One Super Agent 12 Players 1 Sub-Agents 18,400.50 Balance 35 % Commission active Send Chips C Child Two Agent 3 Players 0 Sub-Agents 1,000.00 Balance 20 % Commission active Send Chips H Held Three Sub-Agent 0 Players 0 Sub-Agents 1,234,567.89 Balance 12.5 % Commission suspended ● Super Agent ● Agent ● Sub-Agent",
      }
    `);
  });

  it('the tree with no agents', async () => {
    state.agents = [];
    const { container } = render(<AgentTree clubId="club-a" />);
    await screen.findByText('No Agents Yet');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "h4||",
        ],
        "text": "▲ No Agents Yet Create Your First Agent To Start Building Your Hierarchy",
      }
    `);
  });

  it('the tree when the read fails', async () => {
    state.agentsError = new Error('boom');
    const { container } = render(<AgentTree clubId="club-a" />);
    await waitFor(() => expect(screen.queryByText('Loading Agent Hierarchy...')).toBeNull());
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Failed to load agent hierarchy",
      }
    `);
  });

  it('assign and transfer, with history', async () => {
    const { container } = render(<AgentAssignmentPanel clubId="club" />);
    await screen.findByLabelText('Current Agent');
    await screen.findByText('Load More Transfers');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "select|Current Agent",
          "select|Members To Move",
          "button|Select All Shown",
          "select|Destination Agent",
          "button|Review Assignment Or Transfer (disabled)",
          "input|Search Transfers",
          "button|Search History",
          "button|Refresh History",
          "button|Load More Transfers",
        ],
        "money": {
          "figures": [
            "0",
            "1,250",
            "op-0001",
            "1,250",
          ],
          "hooks": [],
        },
        "regions": [
          "h2||",
          "label||",
          "select||Current Agent",
          "label||",
          "select||Members To Move",
          "label||",
          "select||Destination Agent",
          "section||Assignment History",
          "h3||",
          "label||",
          "input||Search Transfers",
          "summary||",
        ],
        "text": "Club Management Assign And Transfer Staff Assign Or Reassign Players. Moving An Agent Keeps Their Existing Downline Together. Current Agent All Active Members Source Agent Target Agent Members To Move Player One / Player / Source Agent Source Agent / Agent / Unassigned Target Agent / Super Agent / Unassigned Select All Shown Destination Agent Select Destination Agent Source Agent / Agent Target Agent / Super Agent 0 Members Selected. The Complete Transfer Succeeds Or No Members Move. Review Assignment Or Transfer Assignment History Search Transfers Search History Source Agent To Target Agent 1,250 Members / Owner Name <date>, <time> Transfer Details op-0001 1,250 Members In The Reviewed Subtrees. Player One / Source Agent Refresh History Load More Transfers",
      }
    `);
  });

  it('assign and transfer, reviewing a transfer', async () => {
    const { container } = render(<AgentAssignmentPanel clubId="club" />);
    await screen.findByLabelText('Current Agent');
    await screen.findByText('Load More Transfers');
    fireEvent.change(screen.getByLabelText('Current Agent'), { target: { value: 'source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select All Shown' }));
    fireEvent.change(screen.getByLabelText('Destination Agent'), { target: { value: 'target' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review Assignment Or Transfer' }));
    await screen.findByRole('button', { name: 'Confirm Transfer' });
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "select|Current Agent (disabled)",
          "select|Members To Move (disabled)",
          "button|Select All Shown (disabled)",
          "select|Destination Agent (disabled)",
          "button|Edit Selection",
          "button|Confirm Transfer",
          "input|Search Transfers",
          "button|Search History",
          "button|Refresh History",
          "button|Load More Transfers",
        ],
        "money": {
          "figures": [
            "1",
            "1",
            "1,234",
            "1,250",
            "op-0001",
            "1,250",
          ],
          "hooks": [],
        },
        "regions": [
          "h2||",
          "label||",
          "select||Current Agent",
          "label||",
          "select||Members To Move",
          "label||",
          "select||Destination Agent",
          "section||Transfer Preview",
          "h3||",
          "section||Assignment History",
          "h3||",
          "label||",
          "input||Search Transfers",
          "summary||",
        ],
        "text": "Club Management Assign And Transfer Staff Assign Or Reassign Players. Moving An Agent Keeps Their Existing Downline Together. Current Agent All Active Members Source Agent Target Agent Members To Move Player One / Player / Source Agent Select All Shown Destination Agent Select Destination Agent Target Agent / Super Agent 1 Members Selected. The Complete Transfer Succeeds Or No Members Move. Review Transfer Destination: Target Agent 1 Selected / 1,234 Total Members Including Attached Downlines Player One / Source Agent To Target Agent Confirm The Complete Transfer. Changed Hierarchies Require A New Review. Edit Selection Confirm Transfer Assignment History Search Transfers Search History Source Agent To Target Agent 1,250 Members / Owner Name <date>, <time> Transfer Details op-0001 1,250 Members In The Reviewed Subtrees. Player One / Source Agent Refresh History Load More Transfers",
      }
    `);
  });
});

describe('the Payouts tab keeps every figure, word, region and control', () => {
  it('pending requests: decidable, with a note, and sent to the notice board', async () => {
    state.cashouts.mockResolvedValue([
      cashout('Fractional', 18400.5, { playerNote: 'Please send tonight' }),
      cashout('Whole', 1234567),
      cashout('Escalated', 250.25, { canDecide: false, canEscalate: false, isEscalated: true }),
    ]);
    const { container } = render(<AgentCashoutPanel clubId="club-a" />);
    await screen.findByText('Escalated');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Refresh",
          "button|Approve Cashout (disabled)",
          "button|Reject (disabled)",
          "button|Send To Notice Board",
          "button|Approve Cashout (disabled)",
          "button|Reject (disabled)",
          "button|Send To Notice Board",
        ],
        "money": {
          "figures": [
            "3",
            "8h Ago",
            "18,400.50",
            "8h Ago",
            "1,234,567",
            "8h Ago",
            "250.25",
          ],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Agent Desk Pending Cashouts 3 Refresh Fractional 8h Ago 18,400.50 Chips Note For Agent Please send tonight Approve Cashout Reject Send To Notice Board Approval Transfers The Verified Hold Into Your Agent Wallet. Rejection Returns The Verified Hold To The Player. Whole 8h Ago 1,234,567 Chips Approve Cashout Reject Send To Notice Board Approval Transfers The Verified Hold Into Your Agent Wallet. Rejection Returns The Verified Hold To The Player. Escalated 8h Ago 250.25 Chips Sent To Notice Board. Only The Owner, CO-Owner Or Admin Can Decide This Request. Approval Transfers The Held Chips To The Club Bank.",
      }
    `);
  });

  it('no pending requests', async () => {
    const { container } = render(<AgentCashoutPanel clubId="club-a" />);
    await screen.findByText('No Pending Cashout Requests');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Refresh",
        ],
        "money": {
          "figures": [
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Agent Desk Pending Cashouts 0 Refresh No Pending Cashout Requests",
      }
    `);
  });

  it('the read fails', async () => {
    state.cashouts.mockRejectedValue(new Error('boom'));
    const { container } = render(<AgentCashoutPanel clubId="club-a" />);
    await screen.findByText('Retry');
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Retry",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "h2||",
        ],
        "text": "Agent Desk Pending Cashouts Failed To Load Cashout Requests Retry",
      }
    `);
  });
});

/* Agent Team passes `arena`; the Cashier's dialog and the player record do
   not. The arena case must print exactly what the console printed above. */
describe('the Payouts tab on the arena case prints what the console printed', () => {
  const STATES: Array<[string, () => void, string]> = [
    [
      'pending requests',
      () =>
        state.cashouts.mockResolvedValue([
          cashout('Fractional', 18400.5, { playerNote: 'Please send tonight' }),
          cashout('Whole', 1234567),
          cashout('Escalated', 250.25, { canDecide: false, canEscalate: false, isEscalated: true }),
        ]),
      'Escalated',
    ],
    ['no pending requests', () => {}, 'No Pending Cashout Requests'],
    ['the read fails', () => state.cashouts.mockRejectedValue(new Error('boom')), 'Retry'],
  ];

  it.each(STATES)('%s', async (_name, arrange, ready) => {
    arrange();
    const painted = render(<AgentCashoutPanel clubId="club-a" />);
    await screen.findByText(ready);
    const expected = pin(painted.container);
    cleanup();
    arrange();
    const arena = render(<AgentCashoutPanel clubId="club-a" arena />);
    await screen.findByText(ready);
    expect(pin(arena.container)).toEqual(expected);
    expect(arena.container.querySelector('.acp--arena.arena-case')).not.toBeNull();
    expect(arena.container.querySelector('.sc-copy, .sc-ink--silver, .acp-word')).toBeNull();
  });
});
