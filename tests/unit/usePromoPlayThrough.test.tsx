import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PromoPlayThroughProgress } from '../../src/components/wallet/PromoPlayThroughProgress';
import { MemberPromoPlayThrough } from '../../src/components/club/MemberPromoPlayThrough';
import { useMemberPromoPlayThrough } from '../../src/hooks/useMemberPromoPlayThrough';
import { usePromoPlayThrough } from '../../src/hooks/usePromoPlayThrough';

const state = vi.hoisted(() => ({
  read: vi.fn(),
  readMember: vi.fn(),
  readReview: vi.fn(),
  subscriptions: vi.fn<(events: string[], callback: (payload: unknown) => void) => void>(),
  user: { id: 'viewer' },
}));
vi.mock('../../src/services/PromoPlayThroughService', () => ({
  readMyPromoPlayThrough: state.read,
  readMemberPromoPlayThrough: state.readMember,
}));
vi.mock('../../src/services/PromoIntegrityService', () => ({
  readPromoIntegrityReview: state.readReview,
}));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: state.user }) }));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({
  useMasterBusSubscriptions: state.subscriptions,
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

const figure = (locked: number) => ({
  locked,
  wallet_locked: locked,
  open_grants: locked ? 1 : 0,
  fee_target: locked ? 200 : 0,
  fee_progress: 0,
  fee_remaining: locked ? 200 : 0,
  percent: 0,
  wallet: 80,
  cashable: 80 - locked,
  next_expiry_at: null,
});

function passiveEvents(milestone = 'source_review_released') {
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  for (const [events, callback] of state.subscriptions.mock.calls) {
    for (const event of [
      'HAND_COMPLETED',
      'BALANCE_UPDATED',
      'WALLET_REFRESHED',
      'TOURNAMENT_REGISTERED',
      'REALTIME_CONNECTED',
      'NOTIFICATION_RECEIVED',
    ]) {
      if (events.includes(event))
        callback(
          event === 'NOTIFICATION_RECEIVED'
            ? {
                notification: {
                  type: 'promo_play_through',
                  data: { milestone, source_club_id: 'club-a' },
                },
              }
            : {}
        );
    }
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  state.user = { id: 'viewer' };
});
afterEach(cleanup);

it('ordinary wallet stays idle through hand, wallet, notification, focus and reconnect events', async () => {
  state.read.mockResolvedValueOnce(figure(0)).mockResolvedValueOnce(figure(25));
  const view = render(<PromoPlayThroughProgress clubId="club-a" />);
  act(() => passiveEvents());
  expect(state.read).not.toHaveBeenCalled();
  expect(state.subscriptions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check Promo Progress' }));
  expect(await screen.findByText('No Current Promo Restrictions.')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  view.rerender(<PromoPlayThroughProgress clubId="club-a" />);
  act(() => passiveEvents());
  expect(state.read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Promo Progress' }));
  expect(await screen.findByRole('progressbar')).toBeTruthy();
  expect(state.read).toHaveBeenCalledTimes(2);
});

it.each([
  ['club-b', 'user-a'],
  ['club-a', 'user-b'],
])(
  'never paints an older club or account response after switching to %s, %s',
  async (club, user) => {
    let older!: (value: unknown) => void;
    state.read
      .mockReturnValueOnce(
        new Promise((resolve) => {
          older = resolve;
        })
      )
      .mockResolvedValueOnce(figure(25));
    const hook = renderHook(({ club, user }) => usePromoPlayThrough(club, user), {
      initialProps: { club: 'club-a', user: 'user-a' },
    });
    act(() => {
      void hook.result.current.reload();
    });
    expect(hook.result.current.loading).toBe(true);
    hook.rerender({ club, user });
    expect(hook.result.current).toMatchObject({ requested: false, loading: false, summary: null });
    expect(state.read.mock.calls[0][1].aborted).toBe(true);
    await act(async () => {
      await hook.result.current.reload();
    });
    await act(async () => {
      older(figure(50));
    });
    expect(hook.result.current.summary?.locked).toBe(25);
    expect(state.read).toHaveBeenCalledTimes(2);
  }
);

it('recovers a failed read only on an explicit retry', async () => {
  state.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(figure(50));
  render(<PromoPlayThroughProgress clubId="club-a" />);
  fireEvent.click(screen.getByRole('button', { name: 'Check Promo Progress' }));
  expect(await screen.findByText(/Promo Progress Is Unavailable/)).toBeTruthy();
  act(() => passiveEvents());
  expect(state.read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('progressbar')).toBeTruthy();
  expect(state.read).toHaveBeenCalledTimes(2);
});

it('an older response cannot resurrect a completed grant after an explicit refresh', async () => {
  let older!: (value: unknown) => void;
  state.read
    .mockReturnValueOnce(
      new Promise((resolve) => {
        older = resolve;
      })
    )
    .mockResolvedValueOnce(figure(0));
  const hook = renderHook(() => usePromoPlayThrough('club-a', 'viewer'));
  act(() => {
    void hook.result.current.reload();
  });
  await act(async () => {
    await hook.result.current.reload();
  });
  await act(async () => {
    older(figure(50));
  });
  expect(hook.result.current.summary?.locked).toBe(0);
});

it.each(['source_review_released', 'profit_unlocked', 'support_override'])(
  'keeps the checked grant snapshot across a %s notice until the player refreshes it',
  async (milestone) => {
    state.read
      .mockResolvedValueOnce({
        ...figure(50),
        integrity_held: 5,
        cashable: 15,
        agent_wallet: 70,
        agent_cashable: 53,
      })
      .mockResolvedValueOnce({
        ...figure(50),
        integrity_held: milestone === 'source_review_released' ? 0 : 5,
        cashable: 25,
        agent_wallet: 70,
        agent_cashable: 58,
      });
    const hook = renderHook(() => usePromoPlayThrough('club-a', 'viewer'));
    await act(async () => {
      await hook.result.current.reload();
    });
    act(() => passiveEvents(milestone));
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(hook.result.current.summary).toMatchObject({
      integrity_held: 5,
      cashable: 15,
      agent_cashable: 53,
    });
    await act(async () => {
      await hook.result.current.reload();
    });
    expect(hook.result.current.summary).toMatchObject({
      locked: 50,
      fee_target: 200,
      cashable: 25,
      agent_cashable: 58,
      integrity_held: milestone === 'source_review_released' ? 0 : 5,
    });
  }
);

it('member detail reads the selected member only after a click and ignores roster revisions', async () => {
  state.readMember.mockResolvedValue({
    member: { ...figure(25), integrity_review_available: true },
  });
  state.readReview.mockResolvedValue({ cases: [] });
  const member = (revision: number) => (
    <MemberPromoPlayThrough clubId="club-a" userId="member" revision={revision} canOverride />
  );
  const view = render(member(1));
  view.rerender(member(2));
  act(() => passiveEvents());
  expect(state.readMember).not.toHaveBeenCalled();
  expect(state.readReview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check Promo Progress' }));
  expect(await screen.findByRole('progressbar')).toBeTruthy();
  await waitFor(() => expect(state.readReview).toHaveBeenCalledTimes(1));
  expect(state.readMember).toHaveBeenCalledWith('club-a', ['member'], expect.any(AbortSignal));
  view.rerender(member(3));
  act(() => passiveEvents());
  expect(state.readMember).toHaveBeenCalledTimes(1);
  expect(state.readReview).toHaveBeenCalledTimes(1);
});

it('discards a late roster read after the authorized member list or viewer changes', async () => {
  let older!: (value: unknown) => void;
  state.readMember.mockReturnValueOnce(
    new Promise((resolve) => {
      older = resolve;
    })
  );
  const hook = renderHook(({ ids }) => useMemberPromoPlayThrough('club-a', ids), {
    initialProps: { ids: ['first', 'second'] },
  });
  act(() => {
    void hook.result.current.checkMember('private');
  });
  expect(state.readMember).not.toHaveBeenCalled();
  act(() => {
    void hook.result.current.checkMember('first');
  });
  expect(hook.result.current.requestedIds).toEqual(['first']);
  hook.rerender({ ids: ['second'] });
  await act(async () => {
    older({ first: figure(25) });
  });
  expect(hook.result.current).toMatchObject({
    requested: false,
    requestedIds: [],
    members: undefined,
  });
  state.readMember.mockResolvedValueOnce({ second: figure(50) });
  await act(async () => {
    await hook.result.current.checkMember('second');
  });
  state.user = { id: 'different-viewer' };
  hook.rerender({ ids: ['second'] });
  expect(hook.result.current).toMatchObject({
    requested: false,
    requestedIds: [],
    members: undefined,
  });
  expect(state.readMember).toHaveBeenCalledTimes(2);
});
