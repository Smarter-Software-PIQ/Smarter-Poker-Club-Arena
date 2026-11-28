/**
 * SETTLEMENT HISTORY IS PINNED BEFORE ITS FRAME MOVES (#SmarterDesign batch O2, 2026-11-28)
 *
 * `/settlement-history` moves off the painted shark console onto the arena
 * workspace. The condition on every page that prints money: no figure, word,
 * data hook, named region or control may change. This renders the real page
 * with synthetic reads in every state it shows and reads it with
 * tests/helpers/surfacePin.ts.
 *
 * The frame is the part the pass replaces, so it is left out of the reading:
 * the painted console head (its title and pill), the PageBar and the chrome
 * mast are removed, and the console's own wrappers are unwrapped so their
 * skin hook is not read as page data. The title and the live pill are held
 * separately: the page heading must be named "Settlement History" and nothing
 * else, and the pill's word must still be printed once. The pins were recorded
 * against main 65a64d1f6 before the change and are unchanged by it.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancialAdminScope } from '../../src/hooks/useFinancialAdminScope';
import { surfacePin } from '../helpers/surfacePin';

const CLUB = 'c1000000-0000-4000-8000-000000000001';
const VIEWER = 'a1000000-0000-4000-8000-000000000001';

const m = vi.hoisted(() => ({
  scope: null as unknown as FinancialAdminScope,
  read: null as null | (() => Promise<{ data: unknown; error: unknown }>),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../src/hooks/useFinancialAdminScope', () => ({
  useFinancialAdminScope: () => m.scope,
  clubScoped: (query: { eq: (column: string, value: string) => unknown }) =>
    query.eq('club_id', m.scope.clubId ?? ''),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: VIEWER }, isHydrating: false }),
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: vi.fn() }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => m.toast }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/utils/safeErrorMessage', () => ({
  safeErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock('../../src/core/MasterBus', () => {
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
  return {
    masterBus: {
      getOrCreateChannel: vi.fn(() => channel),
      removeRegisteredChannel: vi.fn(),
    },
  };
});
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'order', 'limit']) query[method] = () => query;
      query.then = (done: (value: unknown) => unknown, fail: (error: unknown) => unknown) =>
        (m.read ? m.read() : new Promise(() => {})).then(done, fail);
      return query;
    }),
  },
}));

import SettlementHistoryPage from '../../src/pages/SettlementHistoryPage';

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

const invoice = (
  n: number,
  gross: string,
  hold: string,
  retained: string,
  status: string,
  created: string,
  period: number | null
) => ({
  id: `e${n}000000-0000-4000-8000-00000000000${n}`,
  club_id: CLUB,
  period_id: `f${n}000000-0000-4000-8000-00000000000${n}`,
  invoice_type: 'union_to_club',
  gross_amount: gross,
  net_amount: hold,
  breakdown: {
    union_hold_amount: hold,
    club_retained: retained,
    ...(period === null ? {} : { period_number: period }),
  },
  status,
  created_at: created,
});

const CYCLES = [
  invoice(1, '1234567.89', '123456.79', '1111111.10', 'paid', '2026-11-23T12:00:00Z', 47),
  invoice(2, '403.38', '0', '403.38', 'pending', '2026-11-16T12:00:00Z', 46),
  invoice(3, '88.50', '8.85', '79.65', 'generated', '2026-11-09T12:00:00Z', null),
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
    <MemoryRouter>
      <SettlementHistoryPage />
    </MemoryRouter>
  ).container;
}

function headingIsTitleOnly() {
  expect(screen.getByRole('heading', { name: 'Settlement History', exact: true })).toBeTruthy();
}

beforeEach(() => {
  m.scope = scope();
  m.read = null;
  m.toast.error.mockReset();
});
afterEach(cleanup);

describe('Settlement History keeps every figure, word, region and control', () => {
  it('ready, with three cycles', async () => {
    m.read = () => Promise.resolve({ data: CYCLES, error: null });
    const root = renderPage();
    await screen.findByText('Period 47');
    await waitFor(() =>
      expect(root.querySelectorAll('[data-visible="true"]').length).toBe(CYCLES.length)
    );
    headingIsTitleOnly();
    expect(screen.getAllByText('3 Cycles')).toHaveLength(1);
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [
            "1,235,059.77",
            "1,111,594.13",
            "3",
            "Period 47",
            "1,234,567.89",
            "123,456.79",
            "1,111,111.10",
            "Period 46",
            "403.38",
            "403.38",
            "88.50",
            "8.85",
            "79.65",
          ],
          "hooks": [
            "data-complete=false",
            "data-complete=false",
            "data-complete=true",
            "data-visible=true",
            "data-visible=true",
            "data-visible=true",
          ],
        },
        "regions": [
          "section||Settlement Summary",
          "section||Revenue Timeline",
        ],
        "text": "Total Rake | 1,235,059.77 | Net Settled | 1,111,594.13 | Cycles | 3 | Revenue Timeline | Oldest | Most Recent | Settlement Cycles | Period 47 | <date> | Completed | Rake | 1,234,567.89 | Fee | - | 123,456.79 | Net | 1,111,111.10 | Period 46 | <date> | Pending | Rake | 403.38 | Net | 403.38 | Settlement Cycle | <date> | Generated | Rake | 88.50 | Fee | - | 8.85 | Net | 79.65",
      }
    `);
  });

  it('empty', async () => {
    m.read = () => Promise.resolve({ data: [], error: null });
    const root = renderPage();
    await screen.findByText('No Settlement Cycles Yet');
    headingIsTitleOnly();
    expect(screen.getAllByText('0 Cycles')).toHaveLength(1);
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [
            "0",
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "section||Settlement Summary",
        ],
        "text": "Total Rake | 0 | Net Settled | 0 | Cycles | 0 | Settlement Cycles | No Settlement Cycles Yet",
      }
    `);
  });

  it('error', async () => {
    m.read = () => Promise.resolve({ data: null, error: { message: 'refused' } });
    const root = renderPage();
    await screen.findByRole('button', { name: 'Retry' });
    headingIsTitleOnly();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Retry|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "section||Settlement Summary",
          "div|alert|",
        ],
        "text": "Total Rake | Unavailable | Net Settled | Unavailable | Cycles | Unavailable | Settlement Cycles | The Settlement History Could Not Be Loaded. Nothing Has Been Changed.",
      }
    `);
  });

  it('loading', async () => {
    const root = renderPage();
    await screen.findByText('Loading Settlement Cycles...');
    headingIsTitleOnly();
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(body(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [
            "0",
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "section||Settlement Summary",
          "div|status|",
        ],
        "text": "Total Rake | 0 | Net Settled | 0 | Cycles | 0 | Settlement Cycles | Loading Settlement Cycles...",
      }
    `);
  });

  it('a platform-wide scope needs a club', async () => {
    m.scope = scope({ clubId: null, platformWide: true, isPlatformStaff: true });
    const root = renderPage();
    await screen.findByText(/Platform-Wide Rows Are Never Combined/);
    expect(
      screen.getByRole('heading', { name: 'Settlement History Needs A Club', exact: true })
    ).toBeTruthy();
    expect(screen.getAllByText('Club Required')).toHaveLength(1);
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
        "text": "Platform-Wide Rows Are Never Combined Into One Club Settlement History.",
      }
    `);
  });

  it('scope denied and scope loading', async () => {
    m.scope = scope({ status: 'denied', clubId: null, message: null });
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
  });
});
