// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClubApplicantsPage from '../../src/pages/ClubApplicantsPage';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  confirm: vi.fn(),
  emit: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  user: { id: 'operator' },
  access: { canControlClub: true, loading: false, error: null as string | null, reload: vi.fn() },
}));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: mocks.user }) }));
vi.mock('../../src/hooks/useClubNavigationAccess', () => ({
  useClubNavigationAccess: () => mocks.access,
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ error: mocks.error, success: mocks.success }),
}));
vi.mock('../../src/components/common/confirmDialog', () => ({ confirmDialog: mocks.confirm }));
vi.mock('../../src/utils/clubIdResolver', () => ({
  resolveClubUUIDStrict: async () => 'club-uuid',
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: mocks.emit, subscribeDebounced: () => () => undefined },
}));
const player = {
  user_id: 'applicant',
  display_name: 'Arena Player',
  created_at: '2026-10-11T00:00:00Z',
};
function route() {
  return (
    <MemoryRouter initialEntries={['/clubs/jaqk/applicants']}>
      <Routes>
        <Route path="/clubs/:clubId/applicants" element={<ClubApplicantsPage />} />
      </Routes>
    </MemoryRouter>
  );
}
function open() {
  return render(route());
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.canControlClub = true;
  mocks.access.error = null;
  mocks.confirm.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: [player], error: null });
});
describe('applicant review uses the existing authorized transaction', () => {
  it('offers a safe return, retries a failed access check and reloads a refused queue on demand', async () => {
    mocks.access.error = 'Access Unavailable';
    const view = open();
    expect(screen.getByRole('link', { name: 'Back To Players' }).getAttribute('href')).toBe(
      '/clubs/jaqk/members'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry Access' }));
    expect(mocks.access.reload).toHaveBeenCalledOnce();
    mocks.access.error = null;
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('Queue Unavailable') });
    view.rerender(route());
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Applicant Queue' }));
    await screen.findByRole('button', { name: 'Approve' });
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Applicants' }));
    expect(await screen.findByText(/No Pending Applicants/)).toBeTruthy();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(
      Array(3).fill('fn_list_pending_members')
    );
  });

  it('reads the pending queue with the resolved club identity', async () => {
    open();
    await screen.findByRole('button', { name: 'Approve' });
    expect(mocks.rpc).toHaveBeenCalledWith('fn_list_pending_members', { p_club_id: 'club-uuid' });
  });
  it('refuses to read or act without club-control access', async () => {
    mocks.access.canControlClub = false;
    open();
    expect(screen.getByRole('note').textContent).toContain('Access Is Required');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not treat a failed queue read as no applicants', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('Queue Unavailable') });
    open();
    await screen.findByRole('alert');
    expect(screen.queryByText(/No Pending Applicants/)).toBeNull();
  });
  it('cancellation leaves the pending membership untouched', async () => {
    mocks.confirm.mockResolvedValue(false);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(
      mocks.rpc.mock.calls.filter((call) => call[0] === 'fn_review_join_request')
    ).toHaveLength(0);
  });
  it('confirms a decision, refreshes the queue and emits the resolved club identity', async () => {
    mocks.rpc.mockImplementation(async (name) =>
      name === 'fn_review_join_request'
        ? { data: { success: true }, error: null }
        : { data: mocks.emit.mock.calls.length ? [] : [player], error: null }
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await screen.findByText(/No Pending Applicants/);
    expect(mocks.rpc).toHaveBeenCalledWith('fn_review_join_request', {
      p_club_id: 'club-uuid',
      p_user_id: 'applicant',
      p_approve: true,
    });
    expect(mocks.emit).toHaveBeenCalledWith('CLUB_UPDATED', { clubId: 'club-uuid' });
    expect(mocks.success).toHaveBeenCalledOnce();
  });
  it('shows the server admission refusal and never claims approval', async () => {
    mocks.rpc.mockImplementation(async (name) =>
      name === 'fn_review_join_request'
        ? { data: { success: false, error: 'Club Capacity Reached' }, error: null }
        : { data: [player], error: null }
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Club Capacity Reached'));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it('allows only one decision while confirmation or the write is in flight', async () => {
    let resolve!: (value: boolean) => void;
    mocks.confirm.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    open();
    const button = await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    resolve(false);
  });
  it.each([false, true])(
    'retires an unanswered confirmation when access is withdrawn, even after regrant: %s',
    async (regrant) => {
      let answer!: (confirmed: boolean) => void;
      mocks.confirm.mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          answer = resolve;
        })
      );
      const view = open();
      fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
      mocks.access.canControlClub = false;
      view.rerender(route());
      expect(screen.getByRole('note').textContent).toContain('Access Is Required');
      if (regrant) {
        mocks.access.canControlClub = true;
        view.rerender(route());
        await screen.findByRole('button', { name: 'Decline' });
      }
      await act(async () => answer(true));
      expect(
        mocks.rpc.mock.calls.filter(([name]) => name === 'fn_review_join_request')
      ).toHaveLength(0);
      expect(mocks.success).not.toHaveBeenCalled();
    }
  );

  it('marks the selected Decline decision pending and refreshes after its receipt', async () => {
    let deliver!: (receipt: unknown) => void;
    mocks.rpc.mockImplementation((name) =>
      name === 'fn_review_join_request'
        ? new Promise((resolve) => {
            deliver = resolve;
          })
        : Promise.resolve({ data: mocks.emit.mock.calls.length ? [] : [player], error: null })
    );
    open();
    const decline = await screen.findByRole('button', { name: 'Decline' });
    const approve = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(decline);
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('fn_review_join_request', {
        p_club_id: 'club-uuid',
        p_user_id: 'applicant',
        p_approve: false,
      })
    );
    expect(decline.textContent).toBe('Processing...');
    expect(approve.textContent).toBe('Approve');
    await act(async () => deliver({ data: { success: true }, error: null }));
    expect(screen.getByText(/No Pending Applicants/)).toBeTruthy();
    expect(mocks.success).toHaveBeenCalledWith('Applicant Declined');
  });

  it('does not submit after the operator leaves during confirmation', async () => {
    let resolve!: (value: boolean) => void;
    mocks.confirm.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    const view = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    view.unmount();
    resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      mocks.rpc.mock.calls.filter((call) => call[0] === 'fn_review_join_request')
    ).toHaveLength(0);
  });
});
