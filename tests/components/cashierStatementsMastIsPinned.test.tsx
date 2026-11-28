/**
 * THE CASHIER STATEMENT IS PINNED BEFORE ITS MAST IS ADDED (2026-11-28)
 *
 * The Full Statement already prints in the Cashier's arena dress; it lacks the
 * chrome mast, and its Back To Cashier key belongs above the mast. Adding the
 * mast and moving that key must not move a figure, a word, a data hook, a
 * named region or a control's state. Recorded against main f6ba3b40c before
 * the change (tests/helpers/surfacePin.ts reads everything but the page head).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import CashierStatementsPage from '../../src/pages/CashierStatementsPage';
import { surfacePin } from '../helpers/surfacePin';

const CLUB = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: USER }, isHydrating: false }),
}));
vi.mock('../../src/services/CashoutService', () => ({
  captureCashoutAccountGuard: () => () => true,
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

const rpc = vi.mocked(supabase.rpc);
const ok = (data: unknown) => Promise.resolve({ data, error: null } as never);

const reference = (id: string, source: string) => ({
  id,
  source,
  op_id: null,
  idempotency_key: null,
  correlation_id: null,
  ledger_id: null,
  cashout_id: null,
  ticket_id: null,
});

const ROWS = [
  {
    source: 'receipt',
    id: 'bbbbbbbb-0001-4000-8000-000000000001',
    at: '2026-09-20T11:56:00Z',
    kind: 'agent_wallet_send',
    wallet: 'agent',
    direction: 'out',
    amount: '2500.00',
    from: { type: 'agent_wallet', id: USER, label: 'kingfish' },
    to: { type: 'player_wallet', id: 'aaaaaaaa-0006-4000-8000-000000000006', label: 'donk bettor' },
    counterparty: 'donk bettor',
    notes: 'cashier send out',
    state: 'reversible',
    reference: reference('bbbbbbbb-0001-4000-8000-000000000001', 'receipt'),
    balance_after: null,
    table_id: null,
    tournament_id: null,
    hand_id: null,
  },
  {
    source: 'movement',
    id: 'cccccccc-0002-4000-8000-000000000002',
    at: '2026-09-20T09:00:00Z',
    kind: 'tournament_prize',
    wallet: 'player',
    direction: 'in',
    amount: '1234567.89',
    from: { type: 'prize_liability', id: null, label: null },
    to: { type: 'player_wallet', id: USER, label: 'kingfish' },
    counterparty: null,
    notes: null,
    state: 'posted',
    reference: reference('cccccccc-0002-4000-8000-000000000002', 'movement'),
    balance_after: '510000.58',
    table_id: null,
    tournament_id: 'dddddddd-0003-4000-8000-000000000003',
    hand_id: null,
  },
];

const PAGE = {
  authorized: true,
  scope: 'downline',
  viewer: USER,
  range: { from: '2026-09-14T07:00:00Z', to: '2026-09-21T07:00:00Z' },
  filters: {},
  rows: ROWS,
  next_cursor: { at: ROWS[1].at, source: 'movement', id: ROWS[1].id, fp: 'fp' },
  generated_at: '2026-09-20T12:00:00Z',
};
const TOTALS = {
  authorized: true,
  scope: 'downline',
  range: PAGE.range,
  filters: {},
  totals: { in: '1234567.89', out: '2500.00', managed: '0.00', count: 1432 },
  generated_at: '2026-09-20T12:00:00Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/clubs/${CLUB}/cashier/statements`]}>
      <Routes>
        <Route path="/clubs/:clubId/cashier/statements" element={<CashierStatementsPage />} />
      </Routes>
    </MemoryRouter>
  ).container;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(cleanup);

describe('the cashier statement keeps every figure, word, region and control', () => {
  it('a ready statement with entries and server totals', async () => {
    rpc.mockImplementation(((name: string) =>
      name === 'fn_cashier_statement_page'
        ? ok(PAGE)
        : name === 'fn_cashier_statement_totals'
          ? ok(TOTALS)
          : ok(null)) as never);
    const root = renderPage();
    await screen.findByText('To Donk Bettor');
    await within(screen.getByLabelText('Statement Totals')).findByText('1,432');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back To Cashier|",
          "button|button|Copy Reference|",
          "button|button|Copy Reference|",
          "button|button|Custom|aria-pressed=false",
          "button|button|Export CSV|",
          "button|button|From Prize LiabilityTournament Prize · Player · Posted · <date>, <time>+1,234,567.89|aria-expanded=false",
          "button|button|Last 30 Days|aria-pressed=false",
          "button|button|Last 7 Days|aria-pressed=true",
          "button|button|Load More|",
          "button|button|Show Filters|aria-expanded=false",
          "button|button|This Week|aria-pressed=false",
          "button|button|To Donk BettorAgent Wallet Send · Agent · Reversible · <date>, <time>-2,500|aria-expanded=false",
          "button|button|Today|aria-pressed=false",
        ],
        "money": {
          "figures": [
            "1,432 Entries",
            "Last 7 Days",
            "Last 30 Days",
            "+1,234,567.89",
            "-2,500",
            "0",
            "1,432",
            "Exports The Whole Range As A CSV File, Up To 20,000 Entries.",
            "2,500",
            "1,234,567.89",
          ],
          "hooks": [
            "data-cashier-surface=statements",
            "data-cashier-layout=directory",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "section||What You Can See",
          "strong|status|",
          "div||Choose A Date Range",
          "div||Statement Totals",
          "p|status|",
          "button||Copy Reference",
          "button||Copy Reference",
        ],
        "text": "1,432 Entries | Pacific Accounting Days | What You Can See | Your Entries And Your Downline | Date Range | <date> | To | <date> | Filters | In | +1,234,567.89 | Out | -2,500 | Managed | 0 | Entries | 1,432 | Export | Exports The Whole Range As A CSV File, Up To 20,000 Entries. | Entries | Newest First | Ref | BBBBBBBB | Ref | CCCCCCCC",
      }
    `);
  });

  it('an empty range', async () => {
    rpc.mockImplementation(((name: string) =>
      name === 'fn_cashier_statement_totals'
        ? ok({ ...TOTALS, totals: { in: '0.00', out: '0.00', managed: '0.00', count: 0 } })
        : ok({ ...PAGE, rows: [], next_cursor: null })) as never);
    const root = renderPage();
    await screen.findByText('No Entries In This Range.');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back To Cashier|",
          "button|button|Custom|aria-pressed=false",
          "button|button|Export CSV|disabled",
          "button|button|Last 30 Days|aria-pressed=false",
          "button|button|Last 7 Days|aria-pressed=true",
          "button|button|Show Filters|aria-expanded=false",
          "button|button|This Week|aria-pressed=false",
          "button|button|Today|aria-pressed=false",
        ],
        "money": {
          "figures": [
            "0 Entries",
            "Last 7 Days",
            "Last 30 Days",
            "0",
            "0",
            "0",
            "0",
            "Exports The Whole Range As A CSV File, Up To 20,000 Entries.",
          ],
          "hooks": [
            "data-cashier-surface=statements",
            "data-cashier-layout=directory",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "section||What You Can See",
          "strong|status|",
          "div||Choose A Date Range",
          "div||Statement Totals",
          "p|status|",
        ],
        "text": "0 Entries | Pacific Accounting Days | What You Can See | Your Entries And Your Downline | Date Range | <date> | To | <date> | Filters | In | 0 | Out | 0 | Managed | 0 | Entries | 0 | Export | Exports The Whole Range As A CSV File, Up To 20,000 Entries. | Entries | Newest First | No Entries In This Range.",
      }
    `);
  });

  it('a failed read', async () => {
    rpc.mockImplementation((() =>
      Promise.resolve({
        data: null,
        error: { code: 'PGRST500', message: 'x' },
      } as never)) as never);
    const root = renderPage();
    await screen.findByText('Retry');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back To Cashier|",
          "button|button|Custom|aria-pressed=false",
          "button|button|Export CSV|disabled",
          "button|button|Last 30 Days|aria-pressed=false",
          "button|button|Last 7 Days|aria-pressed=true",
          "button|button|Retry|",
          "button|button|Show Filters|aria-expanded=false",
          "button|button|This Week|aria-pressed=false",
          "button|button|Today|aria-pressed=false",
        ],
        "money": {
          "figures": [
            "Last 7 Days",
            "Last 30 Days",
            "Exports The Whole Range As A CSV File, Up To 20,000 Entries.",
          ],
          "hooks": [
            "data-cashier-surface=statements",
            "data-cashier-layout=directory",
            "data-tone=danger",
          ],
        },
        "regions": [
          "span|status|",
          "section||What You Can See",
          "strong|status|",
          "div||Choose A Date Range",
          "div||Statement Totals",
          "p|status|",
          "p|alert|",
        ],
        "text": "Unverified | Pacific Accounting Days | What You Can See | Not Verified | Date Range | <date> | To | <date> | Filters | In | - | Out | - | Managed | - | Entries | - | Export | Exports The Whole Range As A CSV File, Up To 20,000 Entries. | Entries | Newest First | Could Not Load This Statement. Check Your Connection And Try Again.",
      }
    `);
  });

  it('a refusal', async () => {
    rpc.mockImplementation((() => ok({ authorized: false, reason: 'not_member' })) as never);
    const root = renderPage();
    await screen.findByText('Statement Unavailable');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back To Cashier|",
          "button|button|Check Again|",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-cashier-surface=statements",
            "data-cashier-layout=directory",
            "data-tone=danger",
          ],
        },
        "regions": [
          "span|status|",
          "section|alert|",
        ],
        "text": "Refused | Pacific Accounting Days | Access Refused | Statement Unavailable | Your Role In This Club Does Not Include This Statement.",
      }
    `);
  });
});
