import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  actor: { user: { id: 'viewer-a' } },
  toast: { success: vi.fn(), error: vi.fn() },
  page: vi.fn(),
  summary: vi.fn(),
  export: vi.fn(),
  csv: vi.fn(),
  report: vi.fn(),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => f.actor }));
vi.mock('../../src/hooks/useProfilePresence', () => ({ useOnlineNow: () => false }));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({
  useMasterBusSubscriptions: () => {},
}));
vi.mock('../../src/hooks/useMasterBusChannel', () => ({ useMasterBusChannel: () => {} }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => f.toast }));
vi.mock('../../src/utils/strictClubIdResolver', () => ({
  resolveClubUUIDStrict: async (club: string) =>
    club === 'club-a'
      ? '00000000-0000-0000-0000-000000000043'
      : '00000000-0000-0000-0000-000000000044',
  ClubNotFoundError: class extends Error {},
}));
vi.mock('../../src/services/ClubRosterService', () => ({
  default: { getRosterPage: f.page, getSummary: f.summary, exportRoster: f.export },
  mapRosterRow: (row: unknown) => row,
  MemberAccessDeniedError: class MemberAccessDeniedError extends Error {},
}));
vi.mock('../../src/lib/export', () => ({ exportToCSV: f.csv }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: f.report, reportWarning: vi.fn() }));
import ClubMembersPage from '../../src/pages/ClubMembersPage';

function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/clubs/club-a/members')}>Club A</button>
      <button onClick={() => navigate('/clubs/club-b/members')}>Club B</button>
      <Routes>
        <Route path="/clubs/:clubId/members" element={<ClubMembersPage />} />
      </Routes>
    </>
  );
}
const tree = () => (
  <MemoryRouter initialEntries={['/clubs/club-a/members']}>
    <Harness />
  </MemoryRouter>
);
const receipt = {
  rows: [{ alias: 'Off Page', role: 'player', total_fees: '12.34', downline_fees: '56.78' }],
  row_count: 1,
  audit_id: 'audit-proof',
};
function deferred() {
  let resolve!: (value: typeof receipt) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<typeof receipt>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function ready() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
}
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  vi.clearAllMocks();
  f.actor.user = { id: 'viewer-a' };
  f.page.mockResolvedValue({
    items: [
      {
        user_id: 'loaded-player',
        alias: 'Loaded Player',
        role: 'player',
        player_wallet: 1,
        agent_wallet: 2,
        total_fees: 12,
        downline_fees: 56,
        downline_total: 3,
        can_view_financials: true,
      },
    ],
    next_cursor: { activity: null, id: 'loaded-player' },
    has_more: true,
    filtered_total: 100,
  });
  f.summary.mockResolvedValue({
    viewer_role: 'owner',
    capabilities: {
      can_view_financials: true,
      can_export: true,
      can_manage_members: false,
      can_view_notes: false,
    },
    counts: { total: 0, online: 0, seated: 0, agents: 0, admins: 0 },
    data_version: null,
    page_size: 80,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* EXPORT ALL MATCHING (2026-11-27). One player is loaded of 100 matching.
   The full export is the same authorized, audited server read the page
   already uses for an unselected export (no user ids), so the CSV carries
   every matching row the server returns, not the loaded page. */
const allMatching = {
  rows: Array.from({ length: 100 }, (_, i) => ({
    user_id: `player-${i}`,
    alias: `Player ${i}`,
    role: 'player',
  })),
  row_count: 100,
  audit_id: 'audit-all',
};
const operation = () => screen.getByRole('status', { name: 'Export Operation' });

it('exports every matching player in one server read even with a selection and one loaded page', async () => {
  f.export.mockResolvedValue(allMatching);
  render(tree());
  await ready();
  expect(screen.queryByRole('button', { name: /Export All Matching/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Select Loaded' }));
  expect(screen.getByRole('note', { name: 'Export Scope' })).toHaveTextContent(
    'Export All Matching Ignores The Selection And Reads All 100 Matching Players Across Every Page.'
  );
  const pageReadsBefore = f.page.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Export All Matching (100)' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(f.export).toHaveBeenCalledTimes(1);
  expect(f.export).toHaveBeenCalledWith(
    '00000000-0000-0000-0000-000000000043',
    { search: '', filter: 'all', sort: 'activity' },
    null,
    expect.any(AbortSignal)
  );
  // The export reads no directory pages of its own.
  expect(f.page.mock.calls.length).toBe(pageReadsBefore);
  const rows = f.csv.mock.calls[0][0];
  expect(rows).toHaveLength(100);
  expect(rows[99]).toMatchObject({
    user_id: 'player-99',
    export_scope: 'all_matching',
    export_selected_count: 0,
    export_row_count: 100,
    export_audit_id: 'audit-all',
  });
  expect(operation()).toHaveAttribute('data-operation-state', 'success');
  expect(operation()).toHaveTextContent('100 Players Exported');
  expect(operation()).toHaveTextContent(
    'Export All Matching: Every Matching Player Across Every Page'
  );
  // The selection is kept: Export Selected still exports only it.
  expect(screen.getByRole('button', { name: 'Export Selected (1)' })).toBeEnabled();
});

it('shows progress in the receipt and cancels before any download starts', async () => {
  const pending = deferred();
  f.export.mockReturnValue(pending.promise);
  render(tree());
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Select Loaded' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export All Matching (100)' }));
  expect(operation()).toHaveAttribute('data-operation-state', 'preparing');
  expect(operation()).toHaveTextContent('Preparing Export Of All 100 Matching Players.');
  const signal = f.export.mock.calls[0][3] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Export' }));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve(allMatching as never);
  });
  expect(f.csv).not.toHaveBeenCalled();
  expect(f.toast.success).not.toHaveBeenCalled();
  expect(operation()).toHaveAttribute('data-operation-state', 'cancelled');
  expect(operation()).toHaveTextContent('Export Cancelled. No CSV Download Started.');
  expect(screen.queryByRole('button', { name: 'Cancel Export' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export All Matching (100)' })).toBeEnabled();
});

it('reports a refused full export without a file', async () => {
  f.export.mockRejectedValue(new Error('Roster Export Requires Club Staff Access'));
  render(tree());
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Select Loaded' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export All Matching (100)' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(f.csv).not.toHaveBeenCalled();
  expect(f.toast.error).toHaveBeenCalledTimes(1);
  expect(operation()).toHaveAttribute('data-operation-state', 'error');
  expect(operation()).toHaveTextContent('Roster Export Requires Club Staff Access');
});

it('never offers Export All Matching without export permission', async () => {
  f.summary.mockResolvedValue({
    viewer_role: 'agent',
    capabilities: {
      can_view_financials: false,
      can_export: false,
      can_manage_members: false,
      can_view_notes: false,
    },
    counts: { total: 1, online: 0, seated: 0, agents: 0, admins: 0 },
    data_version: null,
    page_size: 80,
  });
  render(tree());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.queryByRole('button', { name: /Export All Matching/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel Export' })).not.toBeInTheDocument();
  expect(f.export).not.toHaveBeenCalled();
});
