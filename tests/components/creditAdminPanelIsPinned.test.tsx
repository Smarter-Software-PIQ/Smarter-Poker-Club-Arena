/**
 * CREDIT ADMIN IS PINNED BEFORE ITS FRAME MOVES (#SmarterDesign batch O2, 2026-11-28)
 *
 * `/credit-admin` moves off the painted spade console onto the arena
 * workspace. The condition on every page that prints money: no figure, credit
 * limit, word, data hook, named region or control may change. This renders the
 * real page and the real Credit Requests inbox with synthetic reads in every
 * state the page shows, and reads it with tests/helpers/surfacePin.ts.
 *
 * The frame is the part the pass replaces, so it is left out of the reading:
 * the painted console head (title and pill), the PageBar and the chrome mast
 * are removed and the console's wrappers unwrapped, so their skin hook is not
 * read as page data. The page heading must be named "Credit Admin" alone, and
 * the pill's word must still be printed once. The scope states print the
 * shared FinancialAdminScopeState, which this pass does not change, so they
 * are pinned whole. Recorded against main 65a64d1f6 before the change.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancialAdminScope } from '../../src/hooks/useFinancialAdminScope';
import { surfacePin } from '../helpers/surfacePin';

const CLUB = 'c1000000-0000-4000-8000-000000000001';
const VIEWER = 'a1000000-0000-4000-8000-000000000001';
const AGENT_A = 'b1000000-0000-4000-8000-000000000001';
const AGENT_B = 'b2000000-0000-4000-8000-000000000002';

type Reply = { data: unknown; error: unknown };

const m = vi.hoisted(() => ({
  scope: null as unknown as FinancialAdminScope,
  agents: null as null | (() => Promise<{ data: unknown; error: unknown }>),
  audit: null as null | (() => Promise<{ data: unknown; error: unknown }>),
  pending: [] as unknown[],
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../src/hooks/useFinancialAdminScope', async (original) => {
  const real = await original<typeof import('../../src/hooks/useFinancialAdminScope')>();
  return { ...real, useFinancialAdminScope: () => m.scope };
});
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: VIEWER }, isHydrating: false }),
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: vi.fn() }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => m.toast }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/utils/safeErrorMessage', () => ({
  safeErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock('../../src/lib/export', () => ({ exportToCSV: vi.fn() }));
vi.mock('../../src/services/AgentService', () => ({
  AgentService: { setCreditLimit: vi.fn() },
}));
vi.mock('../../src/services/CreditRequestService', () => ({
  creditRequestService: {
    getMyRequests: () => Promise.resolve([]),
    getPendingForClub: () => Promise.resolve(m.pending),
  },
}));
vi.mock('../../src/core/MasterBus', () => {
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
  return {
    masterBus: {
      subscribeDebounced: vi.fn(() => vi.fn()),
      getOrCreateChannel: vi.fn(() => channel),
      removeRegisteredChannel: vi.fn(),
      emit: vi.fn(),
    },
  };
});
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const filters = new Map<string, unknown>();
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'limit']) query[method] = () => query;
      query.eq = (key: string, value: unknown) => (filters.set(key, value), query);
      query.in = query.eq;
      const reply = (): Promise<Reply> => {
        if (table === 'agents') return m.agents ? m.agents() : new Promise(() => {});
        if (table === 'credit_assignments')
          return m.audit ? m.audit() : Promise.resolve({ data: [], error: null });
        if (table === 'profiles')
          return Promise.resolve({
            data: ((filters.get('id') as string[]) || []).map((id) => ({
              id,
              username: id === 'u1' ? 'donk bettor' : 'river rat',
            })),
            error: null,
          });
        if (table === 'clubs')
          return Promise.resolve({ data: [{ id: CLUB, name: 'kings club' }], error: null });
        return Promise.resolve({ data: null, error: null });
      };
      query.maybeSingle = () =>
        table === 'clubs'
          ? Promise.resolve({ data: { owner_id: VIEWER }, error: null })
          : Promise.resolve({ data: { role: 'owner', status: 'active' }, error: null });
      query.then = (done: (value: unknown) => unknown, fail: (error: unknown) => unknown) =>
        reply().then(done, fail);
      return query;
    }),
  },
}));

import CreditAdminPanel from '../../src/pages/CreditAdminPanel';

const scope = (over: Partial<FinancialAdminScope> = {}): FinancialAdminScope => ({
  status: 'ready',
  clubId: CLUB,
  platformWide: false,
  clubRole: 'owner',
  isPlatformStaff: false,
  userId: VIEWER,
  message: null,
  reload: vi.fn(),
  ...over,
});

const AGENTS = [
  {
    id: AGENT_A,
    user_id: 'u1',
    club_id: CLUB,
    agent_wallet_balance: '-250.50',
    credit_limit: '1234567.89',
    status: 'active',
  },
  {
    id: AGENT_B,
    user_id: 'u2',
    club_id: CLUB,
    agent_wallet_balance: '403.38',
    credit_limit: '500.00',
    status: 'suspended',
  },
];
const AUDIT = [
  {
    id: 'd1000000-0000-4000-8000-000000000001',
    agent_id: AGENT_A,
    old_limit: '1000.00',
    new_limit: '1234567.89',
    created_at: '2026-11-20T12:00:00Z',
  },
  {
    id: 'd2000000-0000-4000-8000-000000000002',
    agent_id: AGENT_B,
    old_limit: '750.00',
    new_limit: '500.00',
    created_at: '2026-11-18T12:00:00Z',
  },
];
const PENDING = [
  {
    id: 'r1000000-0000-4000-8000-000000000001',
    requesterId: 'u1',
    requesterName: 'donk bettor',
    approverId: VIEWER,
    clubId: CLUB,
    requestedAmount: 2500,
    reason: 'friday game',
    status: 'pending',
    createdAt: '2026-11-27T12:00:00Z',
  },
];

/** The page body with the frame the pass replaces taken out. */
function body(root: HTMLElement) {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll('.sc__head, .ca-page-bar, .arena-workspace-mast'))
    el.remove();
  for (const el of [...copy.querySelectorAll('.sc, .sc__body, .sc__foot')].reverse())
    el.replaceWith(...el.childNodes);
  return surfacePin(copy);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/credit-admin?club=${CLUB}`]}>
      <CreditAdminPanel />
    </MemoryRouter>
  ).container;
}

/** The Credit Requests inbox reads on its own; the pin waits for it to settle. */
async function inboxSettled() {
  await screen.findByText('No Pending Credit Requests Are Visible For This Club.');
}

function headingIsTitleOnly() {
  expect(screen.getByRole('heading', { name: 'Credit Admin', exact: true })).toBeTruthy();
}

beforeEach(() => {
  m.scope = scope();
  m.agents = null;
  m.audit = null;
  m.pending = [];
  m.toast.error.mockReset();
});
afterEach(cleanup);

describe('Credit Admin keeps every figure, limit, word, region and control', () => {
  it('ready, with two agents, their recent changes and a pending request', async () => {
    m.agents = () => Promise.resolve({ data: AGENTS, error: null });
    m.audit = () => Promise.resolve({ data: AUDIT, error: null });
    m.pending = PENDING;
    const root = renderPage();
    await screen.findByText('Recent Credit Changes For Agents In View');
    await screen.findByText('Friday Game');
    headingIsTitleOnly();
    expect(screen.getAllByText('Club')).toHaveLength(1);
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Edit|",
          "button|button|Edit|disabled",
          "button|button|Export Shown Rows|",
          "button||Approve donk bettor|",
          "button||Deny donk bettor|",
        ],
        "money": {
          "figures": [
            "100",
            "1",
            "200",
            "2,500",
            "1,235,067.89",
            "2",
            "1,234,567.89",
            "403.38",
            "96.62",
            "500",
            "5",
            "1,000",
            "1,234,567.89",
            "750",
            "500",
          ],
          "hooks": [
            "data-player-name=true",
            "data-player-name=true",
            "data-player-name=true",
            "data-player-name=true",
            "data-player-name=true",
          ],
        },
        "regions": [
          "section||Credit Requests",
          "button||Approve donk bettor",
          "button||Deny donk bettor",
          "dl||Credit Exposure Summary",
        ],
        "text": "Showing Up To | 100 | Agents, Ordered By Credit Limit. Totals And CSV Cover The Shown Rows Only. | Credit Requests | Pending Credit Requests Shown ( | 1 | ) | Showing Up To | 200 | Requests. | Donk Bettor | 2,500 | Friday Game | Credit Limits In View | 1,235,067.89 | Wallet Shortfall In View | Unavailable | Agents In View | 2 | Agents | Donk Bettor | Kings Club | Active | Balance | Unavailable | Wallet Shortfall | Unavailable | 1,234,567.89 | River Rat | Kings Club | Suspended | Balance | 403.38 | Wallet Shortfall | 96.62 | 500 | Recent Credit Changes For Agents In View | Up To | 5 | Recent Changes Available To Your Account. | Donk Bettor | Kings Club | / | <date> | From | 1,000 | To | 1,234,567.89 | River Rat | Kings Club | / | <date> | From | 750 | To | 500",
      }
    `);
  });

  it('editing one agent limit', async () => {
    m.agents = () => Promise.resolve({ data: AGENTS, error: null });
    m.audit = () => Promise.resolve({ data: AUDIT, error: null });
    const root = renderPage();
    await screen.findByText('Recent Credit Changes For Agents In View');
    const enabled = () =>
      screen.getAllByRole('button', { name: 'Edit' }).filter((b) => !b.hasAttribute('disabled'));
    await waitFor(() => expect(enabled()).toHaveLength(1));
    fireEvent.click(enabled()[0]);
    await screen.findByText('New Limit');
    await inboxSettled();
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Cancel|",
          "button|button|Edit|disabled",
          "button|button|Export Shown Rows|",
          "button|button|Save|",
          "input|number||value=500",
        ],
        "money": {
          "figures": [
            "100",
            "1,235,067.89",
            "2",
            "1,234,567.89",
            "403.38",
            "96.62",
            "5",
            "1,000",
            "1,234,567.89",
            "750",
            "500",
          ],
          "hooks": [
            "data-player-name=true",
            "data-player-name=true",
            "data-player-name=true",
            "data-player-name=true",
          ],
        },
        "regions": [
          "section||Credit Requests",
          "dl||Credit Exposure Summary",
        ],
        "text": "Showing Up To | 100 | Agents, Ordered By Credit Limit. Totals And CSV Cover The Shown Rows Only. | Credit Requests | No Pending Credit Requests Are Visible For This Club. | Credit Limits In View | 1,235,067.89 | Wallet Shortfall In View | Unavailable | Agents In View | 2 | Agents | Donk Bettor | Kings Club | Active | Balance | Unavailable | Wallet Shortfall | Unavailable | 1,234,567.89 | River Rat | Kings Club | Suspended | Balance | 403.38 | Wallet Shortfall | 96.62 | New Limit | Recent Credit Changes For Agents In View | Up To | 5 | Recent Changes Available To Your Account. | Donk Bettor | Kings Club | / | <date> | From | 1,000 | To | 1,234,567.89 | River Rat | Kings Club | / | <date> | From | 750 | To | 500",
      }
    `);
  });

  it('empty', async () => {
    m.agents = () => Promise.resolve({ data: [], error: null });
    const root = renderPage();
    await screen.findByText('No Agents Found');
    await inboxSettled();
    headingIsTitleOnly();
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [
            "100",
            "0",
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "section||Credit Requests",
          "dl||Credit Exposure Summary",
        ],
        "text": "Showing Up To | 100 | Agents, Ordered By Credit Limit. Totals And CSV Cover The Shown Rows Only. | Credit Requests | No Pending Credit Requests Are Visible For This Club. | Credit Limits In View | 0 | Wallet Shortfall In View | 0 | Agents In View | 0 | Agents | No Agents Found",
      }
    `);
  });

  it('error', { timeout: 15000 }, async () => {
    m.agents = () => Promise.resolve({ data: null, error: { message: 'refused' } });
    const root = renderPage();
    await screen.findByText('The Agent Credit Lines Could Not Be Loaded.', undefined, {
      timeout: 8000,
    });
    await inboxSettled();
    headingIsTitleOnly();
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Retry|",
        ],
        "money": {
          "figures": [
            "100",
          ],
          "hooks": [],
        },
        "regions": [
          "section||Credit Requests",
          "dl||Credit Exposure Summary",
          "div|alert|",
        ],
        "text": "Showing Up To | 100 | Agents, Ordered By Credit Limit. Totals And CSV Cover The Shown Rows Only. | Credit Requests | No Pending Credit Requests Are Visible For This Club. | Credit Limits In View | Unavailable | Wallet Shortfall In View | Unavailable | Agents In View | Unavailable | Agents | The Agent Credit Lines Could Not Be Loaded.",
      }
    `);
  });

  it('recent changes unavailable', { timeout: 15000 }, async () => {
    m.agents = () => Promise.resolve({ data: AGENTS, error: null });
    m.audit = () => Promise.resolve({ data: null, error: { message: 'refused' } });
    const root = renderPage();
    await screen.findByText('Recent Credit Changes Are Unavailable.', undefined, { timeout: 8000 });
    await inboxSettled();
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Edit|",
          "button|button|Edit|disabled",
          "button|button|Export Shown Rows|",
        ],
        "money": {
          "figures": [
            "100",
            "1,235,067.89",
            "2",
            "1,234,567.89",
            "403.38",
            "96.62",
            "500",
          ],
          "hooks": [
            "data-player-name=true",
            "data-player-name=true",
          ],
        },
        "regions": [
          "section||Credit Requests",
          "dl||Credit Exposure Summary",
          "p|status|",
        ],
        "text": "Showing Up To | 100 | Agents, Ordered By Credit Limit. Totals And CSV Cover The Shown Rows Only. | Credit Requests | No Pending Credit Requests Are Visible For This Club. | Credit Limits In View | 1,235,067.89 | Wallet Shortfall In View | Unavailable | Agents In View | 2 | Agents | Donk Bettor | Kings Club | Active | Balance | Unavailable | Wallet Shortfall | Unavailable | 1,234,567.89 | River Rat | Kings Club | Suspended | Balance | 403.38 | Wallet Shortfall | 96.62 | 500 | Recent Credit Changes Are Unavailable.",
      }
    `);
  });

  it('loading', async () => {
    const root = renderPage();
    await screen.findByText('Loading Agent Credit Lines.');
    await inboxSettled();
    headingIsTitleOnly();
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [
            "100",
          ],
          "hooks": [],
        },
        "regions": [
          "section||Credit Requests",
          "dl||Credit Exposure Summary",
          "p|status|",
        ],
        "text": "Showing Up To | 100 | Agents, Ordered By Credit Limit. Totals And CSV Cover The Shown Rows Only. | Credit Requests | No Pending Credit Requests Are Visible For This Club. | Credit Limits In View | Unavailable | Wallet Shortfall In View | Unavailable | Agents In View | Unavailable | Agents | Loading Agent Credit Lines.",
      }
    `);
  });

  it('verifying credit access', async () => {
    m.scope = scope({ userId: 'a9000000-0000-4000-8000-000000000009' });
    const root = renderPage();
    await screen.findByText('Verifying Credit Access.');
    headingIsTitleOnly();
    expect(screen.getAllByText('Verifying')).toHaveLength(1);
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "p|status|",
        ],
        "text": "Verifying Credit Access.",
      }
    `);
  });

  it('scope denied, scope loading and a role without credit authority', async () => {
    m.scope = scope({ status: 'denied', clubId: null });
    const denied = renderPage();
    await screen.findByText('Financial Access Restricted');
    expect(surfacePin(denied)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "p|alert|",
        ],
        "text": "Club Arena Data | Financial Access Restricted | Your Role Does Not Include Finance Access. | Restricted | Your Role Does Not Include Finance Access.",
      }
    `);
    cleanup();
    m.scope = scope({ status: 'loading', clubId: null });
    const loading = renderPage();
    await screen.findAllByText('Checking Your Club Finance Access.');
    expect(surfacePin(loading)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "p|status|",
        ],
        "text": "Club Arena Data | Financial Access | Checking Your Club Finance Access. | Checking | Checking Your Club Finance Access.",
      }
    `);
    cleanup();
    m.scope = scope({ clubRole: 'agent' });
    const role = renderPage();
    await screen.findAllByText(/Credit Admin Requires An Authorized Club/);
    expect(surfacePin(role)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "p|alert|",
        ],
        "text": "Club Arena Data | Financial Access Restricted | Credit Admin Requires An Authorized Club. Select A Club Where You Are An Owner, Co Owner Or Admin. No Credit Data Has Been Loaded. | Restricted | Credit Admin Requires An Authorized Club. Select A Club Where You Are An Owner, Co Owner Or Admin. No Credit Data Has Been Loaded.",
      }
    `);
  });
});
