import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mock = vi.hoisted(() => ({
  override: vi.fn(),
  reload: vi.fn(),
  summary: {
    override_available: true,
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
vi.mock('../../src/components/club/MemberIntegrityReview', () => ({
  MemberIntegrityReview: () => <div>Source Review Controls</div>,
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { MemberPromoPlayThrough } from '../../src/components/club/MemberPromoPlayThrough';
const props = {
  clubId: 'c0000000-0000-0000-0000-000000000001',
  userId: 'a0000000-0000-0000-0000-000000000001',
  revision: 1,
};
const originalSummary = { ...mock.summary };
afterEach(() => {
  Object.assign(mock.summary, originalSummary);
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
  it.each(['success', 'unknown'])(
    'ignores the previous member pending %s override',
    async (outcome) => {
      let finish!: (value?: unknown) => void;
      mock.override
        .mockReturnValueOnce(
          new Promise((resolve, reject) => {
            finish =
              outcome === 'success' ? resolve : () => reject(new Error('Old Unknown Result'));
          })
        )
        .mockResolvedValue({ success: true });
      const view = render(<MemberPromoPlayThrough {...props} canOverride />);
      fireEvent.change(screen.getByLabelText('Reason For Promo Unlock'), {
        target: { value: 'Old Reason' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Unlock Promo With Reason' }));
      view.rerender(<MemberPromoPlayThrough {...props} userId={props.clubId} canOverride />);
      const input = screen.getByLabelText('Reason For Promo Unlock') as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.value).toBe('');
      fireEvent.change(input, { target: { value: 'New Member Reason' } });
      await act(async () => {
        finish({ success: true });
      });
      expect(mock.reload).not.toHaveBeenCalled();
      expect(input.value).toBe('New Member Reason');
      expect(screen.queryByRole('status')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Unlock Promo With Reason' }));
      await waitFor(() => expect(mock.reload).toHaveBeenCalledTimes(1));
      expect(mock.override).toHaveBeenLastCalledWith(
        props.clubId,
        props.clubId,
        'New Member Reason'
      );
      expect(mock.override).toHaveBeenCalledTimes(2);
    }
  );
});

describe('support authority follows the original grant club', () => {
  it('keeps the source-club support action reachable without inventing a local balance or meter', () => {
    Object.assign(mock.summary, {
      locked: 0,
      open_grants: 0,
      fee_target: 0,
      fee_progress: 0,
      fee_remaining: 0,
      percent: 100,
      wallet: 0,
      cashable: 0,
      override_available: true,
    });
    render(<MemberPromoPlayThrough {...props} canOverride />);
    expect(screen.getByRole('button', { name: 'Unlock Promo With Reason' })).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/Withdrawable Balance/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Promo Play Through' })).toBeNull();
  });
  it('honors authoritative lack of an overridable original gift even when aggregate promo is visible', () => {
    mock.summary.override_available = false;
    render(<MemberPromoPlayThrough {...props} canOverride />);
    expect(screen.queryByRole('button', { name: 'Unlock Promo With Reason' })).toBeNull();
  });
});

it('hides completed owner cards when review support exists but there is no pending case', () => {
  Object.assign(mock.summary, {
    locked: 0,
    open_grants: 0,
    fee_target: 0,
    fee_progress: 0,
    fee_remaining: 0,
    percent: 100,
    wallet: 0,
    cashable: 0,
    override_available: false,
    integrity_available: true,
    integrity_review_available: false,
  });
  const view = render(<MemberPromoPlayThrough {...props} canOverride />);
  expect(view.container.textContent).toBe('');
});

it('keeps a real evidence-only review reachable without a promo percentage', () => {
  Object.assign(mock.summary, {
    locked: 0,
    open_grants: 0,
    fee_target: 0,
    fee_progress: 0,
    fee_remaining: 0,
    percent: 100,
    wallet: 0,
    cashable: 0,
    override_available: false,
    integrity_available: true,
    integrity_review_available: true,
  });
  render(<MemberPromoPlayThrough {...props} canOverride />);
  expect(screen.getByText('Source Review Controls')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Unlock Promo With Reason' })).toBeNull();
});
