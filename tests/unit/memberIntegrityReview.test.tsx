import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mock = vi.hoisted(() => ({ read: vi.fn(), release: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/PromoIntegrityService', async (original) => ({
  ...(await original<typeof import('../../src/services/PromoIntegrityService')>()),
  readPromoIntegrityReview: mock.read,
  releasePromoIntegrityCase: mock.release,
}));
import { parsePromoIntegrityReview } from '../../src/services/PromoIntegrityService';
import { MemberIntegrityReview } from '../../src/components/club/MemberIntegrityReview';
const clubId = 'c0000000-0000-0000-0000-000000000001';
const userId = 'a0000000-0000-0000-0000-000000000001';
const caseId = 'f0000000-0000-0000-0000-000000000001';
const item = {
  case_id: caseId,
  created_at: '2026-11-16T12:00:00Z',
  held: 20,
  original_amount: 30,
  can_release: true,
  review_club_id: clubId,
  reason: 'Promo Source Review',
  evidence: { source_principal_lost: 40, bank_fee: 2, recipient_net_gain: 45 },
};
const review = { cases: [item], wallet_held: 20, agent_held: 0 };
const raw = {
  ...review,
  success: true,
  club_id: clubId,
  user_id: userId,
  cases: [{ ...item, status: 'pending_review' }],
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('source review in the member record', () => {
  it('parses only a correctly scoped report and preserves zero-held evidence cases', () => {
    expect(parsePromoIntegrityReview(raw, clubId, userId).cases[0].held).toBe(20);
    expect(
      parsePromoIntegrityReview({ ...raw, cases: [{ ...raw.cases[0], held: 0 }] }, clubId, userId)
        .cases[0].held
    ).toBe(0);
    expect(() => parsePromoIntegrityReview({ ...raw, user_id: clubId }, clubId, userId)).toThrow();
    expect(() =>
      parsePromoIntegrityReview({ ...raw, wallet_held: null }, clubId, userId)
    ).toThrow();
    expect(() =>
      parsePromoIntegrityReview(
        { ...raw, cases: [{ ...raw.cases[0], can_release: undefined }] },
        clubId,
        userId
      )
    ).toThrow();
  });
  it('shows source evidence and leaves a foreign case club to its actual reviewer', async () => {
    mock.read.mockResolvedValue({ ...review, cases: [{ ...item, held: 0, can_release: false }] });
    render(
      <MemberIntegrityReview clubId={clubId} userId={userId} revision={1} onChanged={() => {}} />
    );
    expect(await screen.findByText('Evidence Only. No Chips Are Held For This Case.')).toBeTruthy();
    expect(screen.getByText('Source Promo Lost')).toBeTruthy();
    expect(screen.getByText('The Original Case Club Must Review This Hold.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark Reviewed And Release Hold' })).toBeNull();
  });
  it('requires a reason and releases the exact case once while pending', async () => {
    mock.read.mockResolvedValueOnce(review).mockResolvedValue({ ...review, cases: [] });
    let resolve!: (value: unknown) => void;
    mock.release.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const changed = vi.fn();
    render(
      <MemberIntegrityReview clubId={clubId} userId={userId} revision={1} onChanged={changed} />
    );
    const button = await screen.findByRole('button', { name: 'Mark Reviewed And Release Hold' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason For Source Review'), {
      target: { value: 'Reviewed The Original Hand Evidence' },
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(mock.release).toHaveBeenCalledWith(caseId, 'Reviewed The Original Hand Evidence');
    resolve({ success: true, case_id: caseId });
    expect(await screen.findByText('No Pending Source Reviews.')).toBeTruthy();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain(
      'Separate Promo Play Through Requirement Still Applies'
    );
  });
  it('re-reads an uncertain release without an automatic retry', async () => {
    mock.read.mockResolvedValue(review);
    mock.release.mockRejectedValue(new Error('Source Review Could Not Be Confirmed'));
    render(
      <MemberIntegrityReview clubId={clubId} userId={userId} revision={1} onChanged={() => {}} />
    );
    const button = await screen.findByRole('button', { name: 'Mark Reviewed And Release Hold' });
    fireEvent.change(screen.getByLabelText('Reason For Source Review'), {
      target: { value: 'Reviewed' },
    });
    fireEvent.click(button);
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
    expect(mock.release).toHaveBeenCalledTimes(1);
    expect(
      ((await screen.findByLabelText('Reason For Source Review')) as HTMLInputElement).value
    ).toBe('');
  });
  it('rejects an old member read after the record scope changes', async () => {
    let resolve!: (value: unknown) => void;
    mock.read
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      )
      .mockResolvedValueOnce({ ...review, cases: [] });
    const view = render(
      <MemberIntegrityReview clubId={clubId} userId={userId} revision={1} onChanged={() => {}} />
    );
    view.rerender(
      <MemberIntegrityReview clubId={clubId} userId={clubId} revision={1} onChanged={() => {}} />
    );
    expect(await screen.findByText('No Pending Source Reviews.')).toBeTruthy();
    resolve(review);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByLabelText('Reason For Source Review')).toBeNull();
  });
  it.each(['success', 'unknown'])(
    'keeps the next member usable after a pending %s release',
    async (outcome) => {
      let finish!: (value?: unknown) => void;
      mock.read.mockResolvedValue(review);
      mock.release
        .mockReturnValueOnce(
          new Promise((resolve, reject) => {
            finish =
              outcome === 'success' ? resolve : () => reject(new Error('Old Unknown Result'));
          })
        )
        .mockResolvedValue({ success: true });
      const changed = vi.fn();
      const view = render(
        <MemberIntegrityReview clubId={clubId} userId={userId} revision={1} onChanged={changed} />
      );
      await screen.findByLabelText('Reason For Source Review');
      fireEvent.change(screen.getByLabelText('Reason For Source Review'), {
        target: { value: 'Old Reason' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Mark Reviewed And Release Hold' }));
      view.rerender(
        <MemberIntegrityReview clubId={clubId} userId={clubId} revision={1} onChanged={changed} />
      );
      const input = (await screen.findByLabelText('Reason For Source Review')) as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.value).toBe('');
      fireEvent.change(input, { target: { value: 'New Member Reason' } });
      await act(async () => {
        finish({ success: true });
      });
      expect(changed).not.toHaveBeenCalled();
      expect(mock.read).toHaveBeenCalledTimes(2);
      expect(input.value).toBe('New Member Reason');
      fireEvent.click(screen.getByRole('button', { name: 'Mark Reviewed And Release Hold' }));
      await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(mock.release).toHaveBeenCalledTimes(2);
    }
  );
});
