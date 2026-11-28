/**
 * THE WEEKLY ACCOUNTING FIGURES ARE PINNED BEFORE ITS FRAME MOVES (2026-11-28)
 *
 * The Settlement page's interior (WeeklyAccountingWorkspace, the automatic run
 * status and the Club Weekly Summaries) is moving to #SmarterDesign. The
 * condition on every money screen: no figure, word, data hook or region may
 * change. This renders the real components with synthetic reads and pins every
 * printed figure (tests/helpers/moneyFigures.ts), the full printed text and
 * every named region, written against the old look and unchanged after it.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WEEKLY_ID as ID, weeklyStatementRow } from '../helpers/clubWeeklyStatement';
import { moneyFigures } from '../helpers/moneyFigures';

const fixture = vi.hoisted(() => ({
  userId: 'ab000000-0000-4000-8000-000000000001' as string | null,
  auth: undefined as
    | undefined
    | ((event: { payload: { isAuthenticated: boolean; userId?: string } }) => void),
  rows: [] as Record<string, unknown>[],
  observation: null as null | Record<string, unknown>,
  periods: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({
    user: fixture.userId ? { id: fixture.userId } : null,
    isHydrating: false,
  }),
}));
vi.mock('../../src/core/IdentityDNA', () => ({
  getIdentityDNAStatus: () => ({
    loaded: !!fixture.userId,
    authenticated: !!fixture.userId,
    userId: fixture.userId,
  }),
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    emit: vi.fn(),
    subscribe: vi.fn((event, callback) => {
      if (event === 'AUTH_STATE_CHANGED') fixture.auth = callback;
      return vi.fn();
    }),
  },
}));
vi.mock('../../src/utils/clubIdResolver', () => ({ resolveClubUUID: vi.fn(async (id) => id) }));
vi.mock('../../src/utils/unionIdResolver', () => ({ resolveUnionUUID: vi.fn(async (id) => id) }));
vi.mock('../../src/hooks/useAccountingRunObservation', () => ({
  useAccountingRunObservation: () => ({
    observation: fixture.observation,
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock('../../src/services/SettlementService', () => ({
  SettlementService: { getPeriodHistory: vi.fn(async () => fixture.periods) },
}));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { supabase } from '../../src/lib/supabase';
import WeeklyAccountingWorkspace from '../../src/components/accounting/WeeklyAccountingWorkspace';

beforeEach(() => {
  vi.clearAllMocks();
  fixture.rows = [];
  fixture.periods = [];
  fixture.observation = null;
  fixture.auth?.({ payload: { isAuthenticated: true, userId: ID.actor } });
  vi.mocked(supabase.from).mockImplementation(() => {
    const filters: Array<[string, unknown]> = [];
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'gte', 'lte', 'limit'])
      query[method] = vi.fn(() => query);
    query.eq = vi.fn((key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    });
    query.then = (done: (value: unknown) => unknown, fail: (error: unknown) => unknown) =>
      Promise.resolve({
        data: fixture.rows.filter((row) => filters.every(([key, value]) => row[key] === value)),
        error: null,
      }).then(done, fail);
    return query as never;
  });
});

function regions(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[aria-label], [role]')].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}`
  );
}

function text(root: HTMLElement): string {
  return (root.textContent ?? '')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<date>')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?/gi, '<time>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function renderScope(kind: 'club' | 'union', ready: string) {
  const view = render(
    <MemoryRouter>
      <WeeklyAccountingWorkspace
        scopeKind={kind}
        scopeRef={kind === 'club' ? ID.club : ID.period}
      />
    </MemoryRouter>
  );
  await screen.findByText(ready);
  return view.container;
}

describe('the weekly accounting interior keeps every figure, word and region', () => {
  it('club scope, posted week with issued summaries', async () => {
    fixture.observation = {
      state: 'posted',
      record_found: true,
      expected_run_at: '2026-09-14T09:00:00Z',
      finished_at: '2026-09-14T09:02:00Z',
    };
    fixture.rows = [
      weeklyStatementRow(),
      weeklyStatementRow({
        id: 'ab000000-0000-4000-8000-000000000007',
        period_id: 'ab000000-0000-4000-8000-000000000008',
        summary_period_id: 'ab000000-0000-4000-8000-000000000008',
        created_at: '2026-09-07T08:00:00.000001+00:00',
        period_start: '2026-08-31T07:00:00+00:00',
        period_end: '2026-09-07T07:00:00+00:00',
        gross_amount: '1234567.89',
        deductions: '0.01',
        net_amount: '1234567.88',
        total_rake_funding: '1234567.89',
        total_paid_by_club: '0.01',
        retained_by_club: '1234567.88',
      }),
    ];
    const root = await renderScope('club', 'Rake Retained');
    expect(moneyFigures(root)).toEqual(CLUB_POSTED.money);
    expect(text(root)).toBe(CLUB_POSTED.text);
    expect(regions(root)).toEqual(CLUB_POSTED.regions);
  });

  it('club scope, incomplete week with no standalone record and no summaries', async () => {
    fixture.observation = {
      state: 'incomplete',
      record_found: false,
      expected_run_at: '2026-09-14T09:00:00Z',
      finished_at: null,
    };
    const root = await renderScope('club', 'No Issued Weekly Summaries Were Found For This Club.');
    expect(moneyFigures(root)).toEqual(CLUB_INCOMPLETE.money);
    expect(text(root)).toBe(CLUB_INCOMPLETE.text);
    expect(regions(root)).toEqual(CLUB_INCOMPLETE.regions);
  });

  it('union scope, recorded periods', async () => {
    fixture.observation = {
      state: 'no_recorded_run',
      record_found: false,
      expected_run_at: '2026-09-14T09:00:00Z',
      finished_at: null,
    };
    fixture.periods = [
      { id: 'p1', startAt: '2026-09-07T07:00:00Z', endAt: '2026-09-14T07:00:00Z', status: 'paid' },
      {
        id: 'p2',
        startAt: '2026-08-31T07:00:00Z',
        endAt: '2026-09-07T07:00:00Z',
        status: 'pending_review',
      },
    ];
    const root = await renderScope('union', 'Refresh Period Records');
    await screen.findByText(/Paid/);
    expect(moneyFigures(root)).toEqual(UNION.money);
    expect(text(root)).toBe(UNION.text);
    expect(regions(root)).toEqual(UNION.regions);
  });
});

/* Recorded from the old components on main e11255d73, before the #SmarterDesign pass. */
const CLUB_POSTED = {
  money: {
    figures: [
      '50',
      '100.25 Chips',
      '60.20 Chips',
      '40.05 Chips',
      '1,234,567.89 Chips',
      '0.01 Chips',
      '1,234,567.88 Chips',
    ],
    hooks: ['data-discover=true'],
  },
  text: 'Club Weekly AccountingWeekly Accounting Runs Automatically. Select A Week To Read Its Recorded Status.Week Ending MondayAutomatic Weekly Accounting PostedAccounting Weeks End At Midnight Pacific. The Automatic Run Rule Is Monday At <time> Chicago Time.Rule Time For This Week: <date>, <time> CDT. Chicago Time. This Is A Schedule Rule, Not Confirmation That A Job Ran.Recorded Attempt Finished: <date>, <time>The Canonical Weekly Run Is Recorded As Posted. Recipient Device Delivery Is Tracked Separately.Refresh StatusClub Weekly SummariesWeekly Totals For Rake Received, Rakeback Paid And Rake Retained.Latest Up To 50 Issued Weekly Summaries.Refresh Weekly SummariesExport Weekly SummariesWeek StartingRake ReceivedRakeback PaidRake RetainedSep 7, 2026100.25 Chips60.20 Chips40.05 ChipsAug 31, 20261,234,567.89 Chips0.01 Chips1,234,567.88 ChipsOpen Club Cashier And RecordsInvoices And Individual Receipts Remain In Messenger’s Club Arena Accounting Area.',
  regions: [
    'input||Week Ending Monday',
    'section|status|Automatic Weekly Accounting',
    'section||Club Weekly Summaries',
    'div|region|Weekly Summaries Table',
  ],
};
const CLUB_INCOMPLETE = {
  money: {
    figures: ['50'],
    hooks: ['data-discover=true'],
  },
  text: 'Club Weekly AccountingWeekly Accounting Runs Automatically. Select A Week To Read Its Recorded Status.Week Ending MondayAutomatic Weekly Accounting IncompleteAccounting Review Is Required Before This Week Can Be Treated As Complete.A Standalone Club Run Could Not Be Established For This Week. Check The Club Weekly Statements Below.Accounting Weeks End At Midnight Pacific. The Automatic Run Rule Is Monday At <time> Chicago Time.Rule Time For This Week: <date>, <time> CDT. Chicago Time. This Is A Schedule Rule, Not Confirmation That A Job Ran.Refresh StatusClub Weekly SummariesWeekly Totals For Rake Received, Rakeback Paid And Rake Retained.Latest Up To 50 Issued Weekly Summaries.Refresh Weekly SummariesExport Weekly SummariesNo Issued Weekly Summaries Were Found For This Club.Open Club Cashier And RecordsInvoices And Individual Receipts Remain In Messenger’s Club Arena Accounting Area.',
  regions: [
    'input||Week Ending Monday',
    'section|alert|Automatic Weekly Accounting',
    'section||Club Weekly Summaries',
  ],
};
const UNION = {
  money: {
    figures: [
      'Latest Up To 12 Records. Recorded Period Status Alone Does Not Prove Payment Or Complete Weekly Accounting.',
    ],
    hooks: ['data-discover=true'],
  },
  text: 'Union Weekly AccountingWeekly Accounting Runs Automatically. Select A Week To Read Its Recorded Status.Week Ending MondayNo Accounting Run Recorded For This Union WeekAccounting Weeks End At Midnight Pacific. The Automatic Run Rule Is Monday At <time> Chicago Time.Rule Time For This Week: <date>, <time> CDT. Chicago Time. This Is A Schedule Rule, Not Confirmation That A Job Ran.Refresh StatusRecorded Union PeriodsLatest Up To 12 Records. Recorded Period Status Alone Does Not Prove Payment Or Complete Weekly Accounting.Refresh Period Records9/7/2026 to <date>: Paid8/31/2026 to <date>: pending_reviewOpen Union Weekly StatementsInvoices And Individual Receipts Remain In Messenger’s Club Arena Accounting Area.',
  regions: [
    'input||Week Ending Monday',
    'section|status|Automatic Weekly Accounting',
    'section||Union Period Records',
  ],
};
