import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mock = vi.hoisted(() => ({
  override: vi.fn(),
  reload: vi.fn(),
  summary: {
    locked: 50,
    open_grants: 1,
    fee_target: 200,
    fee_progress: 100,
    fee_remaining: 100,
    percent: 50,
    wallet: 80,
    cashable: 30,
    next_expiry_at: null,
  },
}));
vi.mock('../../src/services/PromoPlayThroughService', () => ({
  overrideMemberPromoPlayThrough: mock.override,
}));
vi.mock('../../src/hooks/useMemberPromoPlayThrough', () => ({
  useMemberPromoPlayThrough: (_club: string, users: string[]) => ({
    members: { [users[0]]: mock.summary },
    reload: mock.reload,
  }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { MemberPromoPlayThrough } from '../../src/components/club/MemberPromoPlayThrough';
const props = {
  clubId: 'c0000000-0000-0000-0000-000000000001',
  userId: 'a0000000-0000-0000-0000-000000000001',
  revision: 1,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('existing owner promo override', () => {
  it('shows no action without current owner/admin authority', () => {
    render(<MemberPromoPlayThrough {...props} />);
    expect(screen.queryByRole('button', { name: 'Unlock Promo With Reason' })).toBeNull();
  });
  it('requires a reason and submits the exact scoped member once while pending', async () => {
    let resolve!: (result: unknown) => void;
    mock.override.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<MemberPromoPlayThrough {...props} canOverride />);
    const button = screen.getByRole('button', { name: 'Unlock Promo With Reason' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason For Promo Unlock'), {
      target: { value: 'Reviewed Original Promo Grant' },
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock.override).toHaveBeenCalledTimes(1);
    expect(mock.override).toHaveBeenCalledWith(
      props.clubId,
      props.userId,
      'Reviewed Original Promo Grant'
    );
    resolve({ success: true });
    await waitFor(() => expect(mock.reload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toContain('Promo Override Recorded');
  });
  it('re-reads an unknown result, clears the reason and does not automatically retry', async () => {
    mock.override.mockRejectedValue(new Error('Request Could Not Be Confirmed'));
    render(<MemberPromoPlayThrough {...props} canOverride />);
    fireEvent.change(screen.getByLabelText('Reason For Promo Unlock'), {
      target: { value: 'Original Reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Promo With Reason' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Request Could Not Be Confirmed')
    );
    expect(mock.override).toHaveBeenCalledTimes(1);
    expect(mock.reload).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Reason For Promo Unlock') as HTMLInputElement).value).toBe('');
  });
  it('does not apply an old member response after the record unmounts', async () => {
    let resolve!: (result: unknown) => void;
    mock.override.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const view = render(<MemberPromoPlayThrough {...props} canOverride />);
    fireEvent.change(screen.getByLabelText('Reason For Promo Unlock'), {
      target: { value: 'Reviewed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Promo With Reason' }));
    view.unmount();
    resolve({ success: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(mock.reload).not.toHaveBeenCalled();
  });
});
