import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  userId: 'cashier-a',
  read: vi.fn(),
  prepare: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  escalate: vi.fn(),
  lock: vi.fn(),
  recover: vi.fn(),
  listeners: [] as Array<() => void>,
  realtime: new Map<string, (payload: any) => void>(),
  realtimeEvents: new Map<string, string>(),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: state.userId } }),
}));
vi.mock('../../src/services/CashoutService', () => ({
  captureCashoutAccountGuard: () => () => true,
  cashoutService: {
    escalateCashout: (...args: unknown[]) => state.escalate(...args),
    getAgentPendingCashouts: (...args: unknown[]) => state.read(...args),
    approveCashout: (...args: unknown[]) => state.approve(...args),
    rejectCashout: (...args: unknown[]) => state.reject(...args),
  },
}));
// This mounted scope unit uses the actual preparation hook; separate wrapper
// tests own UUID storage and strict canonical service receipts.
vi.mock('../../src/services/CashoutOperation', () => ({
  prepareCashoutOperation: (intent: any) => state.prepare(intent),
  captureCashoutStart: (intent: any) => {
    if (!intent.isCurrent()) throw new Error('Cashout Changed');
    return intent;
  },
  assertCashoutStartCurrent: (intent: any) => {
    if (!intent.isCurrent()) throw new Error('Cashout Changed');
  },
  captureCashoutReceiptCheck: (original: any, isCurrent: () => boolean) => ({
    ...original,
    isCurrent,
  }),
  recoverCashoutOperation: async (intent: any) => {
    if (!intent.isCurrent()) throw new Error('Cashout Changed');
    return state.recover(intent);
  },
  runCashoutOperation: async (intent: any) => {
    if (!intent.isCurrent()) throw new Error('Cashout Changed');
    const context = {
      clubId: intent.clubId,
      amount: intent.amount,
      playerId: intent.playerId,
      isCurrent: intent.isCurrent,
    };
    const result =
      intent.kind === 'cashout_approve'
        ? await state.approve(
            intent.targetId,
            intent.userId,
            intent.note,
            'saved-operation',
            context
          )
        : await state.reject(
            intent.targetId,
            intent.userId,
            intent.note,
            'saved-operation',
            context
          );
    if (!intent.isCurrent()) throw new Error('Cashout Changed');
    return result;
  },
}));
vi.mock('../../src/utils/settlementLock', () => ({
  checkSettlementLock: (...args: unknown[]) => state.lock(...args),
}));
vi.mock('../../src/utils/clubIdResolver', () => ({ resolveClubUUID: async (id: string) => id }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/utils/avatarGenerator', () => ({ generateDefaultAvatar: () => '' }));
vi.mock('../../src/lib/date', () => ({ formatRelativeShort: () => 'Recently' }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    subscribe: () => () => {},
    subscribeDebounced: (_event: string, callback: () => void) => {
      state.listeners.push(callback);
      return () => {};
    },
    removeRegisteredChannel: vi.fn(),
    getOrCreateChannel: () => {
      const c = { on: (_event: string, filter: { table: string; event: string }, callback: (payload: any) => void) => { state.realtime.set(filter.table, callback); state.realtimeEvents.set(filter.table, filter.event); return c; }, subscribe: vi.fn() };
      return c;
    },
  },
}));
import AgentCashoutPanel from '../../src/components/agent/AgentCashoutPanel';
const row = (id = 'request-a', clubId = 'club-a') => ({
  id,
  playerId: 'player-a',
  agentId: 'cashier-a',
  clubId,
  amount: 12.34,
  status: 'pending' as const,
  canDecide: true,
  canEscalate: true,
  isEscalated: false,
  playerName: id,
  createdAt: '2026-09-15T00:00:00Z',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  state.userId = 'cashier-a';
  state.listeners.length = 0;
  state.realtime.clear();
  state.read.mockReset().mockResolvedValue([row()]);
  state.prepare.mockReset().mockImplementation(async (intent) => intent);
  state.approve.mockReset().mockResolvedValue(true);
  state.reject.mockReset().mockResolvedValue(true);
  state.escalate.mockReset().mockResolvedValue('notice-a');
  state.lock.mockReset().mockResolvedValue({ locked: true });
  state.recover.mockReset().mockResolvedValue({ found: false });
});
afterEach(cleanup);
async function readyApprove() {
  const button = await screen.findByRole('button', { name: 'Approve Cashout' });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
}

it('binds the actual camelCase request tuple and refuses a same-frame duplicate action', async () => {
  const response = deferred<boolean>();
  state.approve.mockReturnValue(response.promise);
  const done = vi.fn();
  render(<AgentCashoutPanel clubId="club-a" onCashoutProcessed={done} />);
  const button = await readyApprove();
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  await waitFor(() => expect(state.approve).toHaveBeenCalledTimes(1));
  expect(state.approve).toHaveBeenCalledWith(
    'request-a',
    'cashier-a',
    undefined,
    'saved-operation',
    {
      clubId: 'club-a',
      amount: 12.34,
      playerId: 'player-a',
      isCurrent: expect.any(Function),
    }
  );
  await act(async () => {
    response.resolve(true);
    await response.promise;
  });
  expect(done).toHaveBeenCalledTimes(1);
});

it('retire old rows and callbacks immediately when a reused panel changes club', async () => {
  const response = deferred<boolean>();
  state.approve.mockReturnValue(response.promise);
  const nextRows = deferred<ReturnType<typeof row>[]>();
  const done = vi.fn();
  const view = render(<AgentCashoutPanel clubId="club-a" onCashoutProcessed={done} />);
  fireEvent.click(await readyApprove());
  await waitFor(() => expect(state.approve).toHaveBeenCalledOnce());
  const oldScope = state.approve.mock.calls[0][4].isCurrent;
  state.read.mockReturnValue(nextRows.promise);
  view.rerender(<AgentCashoutPanel clubId="club-b" onCashoutProcessed={done} />);
  expect(screen.queryByText('request-a')).toBeNull();
  expect(oldScope()).toBe(false);
  await act(async () => {
    response.resolve(true);
    await response.promise;
  });
  expect(done).not.toHaveBeenCalled();
  await act(async () => {
    nextRows.resolve([row('request-b', 'club-b')]);
    await nextRows.promise;
  });
  expect(await readyApprove()).not.toBeDisabled();
});

it('does not dispatch after an account change while receipt recovery is pending', async () => {
  const gate = deferred<{ found: false }>();
  state.recover.mockReturnValue(gate.promise);
  const view = render(<AgentCashoutPanel clubId="club-a" />);
  fireEvent.click(await readyApprove());
  state.userId = 'cashier-b';
  state.read.mockResolvedValue([]);
  view.rerender(<AgentCashoutPanel clubId="club-a" />);
  await act(async () => {
    gate.resolve({ found: false });
    await gate.promise;
  });
  expect(state.approve).not.toHaveBeenCalled();
});

it('keeps the newer pending read when an earlier same-club response arrives last', async () => {
  const first = deferred<ReturnType<typeof row>[]>();
  state.read.mockReturnValueOnce(first.promise).mockResolvedValue([row('newer-request')]);
  render(<AgentCashoutPanel clubId="club-a" />);
  await waitFor(() => expect(state.listeners.length).toBeGreaterThan(0));
  act(() => state.listeners[0]());
  await screen.findByText('newer-request');
  await act(async () => {
    first.resolve([row('older-request')]);
    await first.promise;
  });
  expect(screen.queryByText('older-request')).toBeNull();
  expect(screen.getByText('newer-request')).toBeTruthy();
});

it('a refresh started before acceptance retires the prior prepared row immediately', async () => {
  const nextRead = deferred<ReturnType<typeof row>[]>();
  render(<AgentCashoutPanel clubId="club-a" />);
  const oldButton = await readyApprove();
  const oldIntent = state.prepare.mock.calls[0][0];
  state.read.mockReturnValueOnce(nextRead.promise);
  act(() => state.listeners[0]());
  expect(oldIntent.isCurrent()).toBe(false);
  fireEvent.click(oldButton);
  expect(state.lock).not.toHaveBeenCalled();
  expect(state.approve).not.toHaveBeenCalled();
  await act(async () => nextRead.resolve([row()]));
  expect(await readyApprove()).not.toBeDisabled();
  expect(oldIntent.isCurrent()).toBe(false);
});

it('defers ordinary refreshes during the accepted action and drains one after its receipt', async () => {
  const gate = deferred<{ found: false }>();
  state.recover.mockReturnValueOnce(gate.promise);
  const done = vi.fn();
  render(<AgentCashoutPanel clubId="club-a" onCashoutProcessed={done} />);
  fireEvent.click(await readyApprove());
  await waitFor(() => expect(state.recover).toHaveBeenCalledOnce());
  const oldIntent = state.prepare.mock.calls[0][0];
  act(() => {
    state.listeners[0]();
    state.listeners[0]();
  });
  expect(oldIntent.isCurrent()).toBe(true);
  expect(state.read).toHaveBeenCalledOnce();
  await act(async () => gate.resolve({ found: false }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(state.approve).toHaveBeenCalledOnce();
  expect(state.read).toHaveBeenCalledTimes(2);
});

it.each(['approve', 'reject'] as const)('processes %s immediately despite an unrelated settlement lock', async (action) => {
  render(<AgentCashoutPanel clubId="club-a" />);
  await readyApprove();
  fireEvent.click(screen.getByRole('button', { name: action === 'approve' ? 'Approve Cashout' : 'Reject' }));
  await waitFor(() => expect(action === 'approve' ? state.approve : state.reject).toHaveBeenCalledOnce());
  expect(state.lock).not.toHaveBeenCalled();
});

it('shares the original request once and removes agent decisions after escalation', async () => {
  render(<AgentCashoutPanel clubId="club-a" />);
  await readyApprove();
  const response = deferred<string>();
  state.escalate.mockReturnValue(response.promise);
  const button = screen.getByRole('button', { name: 'Send To Notice Board' });
  act(() => { button.click(); button.click(); });
  expect(state.escalate).toHaveBeenCalledTimes(1);
  expect(state.escalate.mock.calls[0][0]).toMatchObject({ id: 'request-a', amount: 12.34 });
  state.read.mockResolvedValue([{ ...row(), isEscalated: true, canDecide: false, canEscalate: false }]);
  await act(async () => response.resolve('notice-a'));
  await screen.findByText(/Sent To Notice Board/);
  expect(screen.queryByRole('button', { name: 'Approve Cashout' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  expect(state.approve).not.toHaveBeenCalled();
});
it('renders an escalated request read only for agents and retains the original player note', async () => {
  state.read.mockResolvedValue([{ ...row(), isEscalated: true, canDecide: false, canEscalate: false,
    playerNote: 'Please Call Me\nBefore Payment' }]);
  render(<AgentCashoutPanel clubId="club-a" />);
  await screen.findByText('Note For Agent');
  expect(screen.getByText(/Please Call Me/).textContent).toContain('Before Payment');
  expect(screen.queryByRole('button', { name: 'Approve Cashout' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send To Notice Board' })).toBeNull();
});

it('revokes visible queue and decisions on an UPDATE to the private access event', async () => {
  render(<AgentCashoutPanel clubId="club-a" />);
  await readyApprove();
  expect(state.realtimeEvents.get('club_notice_access_events')).toBe('*');
  act(() => state.realtime.get('club_notice_access_events')?.({ eventType: 'UPDATE', new: { club_id: 'club-a', can_access: false } }));
  expect(screen.queryByRole('button', { name: 'Approve Cashout' })).not.toBeInTheDocument();
  expect(screen.queryByText('request-a')).not.toBeInTheDocument();
  expect(state.approve).not.toHaveBeenCalled();
});
it('refreshes capabilities after another session sends the request to Notice Board', async () => {
  render(<AgentCashoutPanel clubId="club-a" />);
  await readyApprove();
  state.read.mockResolvedValue([{ ...row(), isEscalated: true, canDecide: false, canEscalate: false }]);
  act(() => state.realtime.get('club_notice_board')?.({ new: { club_id: 'club-a' } }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve Cashout' })).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Send To Notice Board' })).not.toBeInTheDocument();
});

it('retires another request immediately while preserving the accepted request receipt', async () => {
  const acknowledgment = deferred<boolean>();
  state.read.mockResolvedValue([row('request-a'), row('request-b')]);
  state.approve.mockReturnValue(acknowledgment.promise);
  render(<AgentCashoutPanel clubId="club-a" />);
  const buttons = await screen.findAllByRole('button', { name: 'Approve Cashout' });
  await waitFor(() => expect(buttons[0]).not.toBeDisabled());
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(state.approve).toHaveBeenCalledTimes(1));
  act(() => state.realtime.get('club_notice_board')?.({ new: { club_id: 'club-a', cashout_id: 'request-b' } }));
  expect(screen.getAllByRole('button', { name: /Approve Cashout|Approving/ })).toHaveLength(1);
  state.read.mockResolvedValue([{ ...row('request-b'), isEscalated: true, canDecide: false, canEscalate: false }]);
  await act(async () => acknowledgment.resolve(true));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve Cashout' })).not.toBeInTheDocument());
  expect(state.approve).toHaveBeenCalledTimes(1);
});
