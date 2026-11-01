import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  getState: vi.fn(),
  activate: vi.fn(),
  deactivate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  viewer: 'viewer-a',
}));
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/services/SpinActivationService', async (original) => ({
  ...(await original<typeof import('../../src/services/SpinActivationService')>()),
  spinActivationApi: { getState: m.getState, activate: m.activate, deactivate: m.deactivate },
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ success: m.success, error: m.error }),
}));
vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (select: any) => select({ user: { id: m.viewer } }),
}));
import SpinActivationPanel from '../../src/components/club/SpinActivationPanel';
import { SpinCommandRefusedError } from '../../src/services/SpinActivationService';
const answer = (owner: string, canManage: unknown = true) => ({
  canManage,
  state: {
    ok: true,
    owner_id: owner,
    owner_kind: 'club',
    is_active: false,
    balance: 0,
    offered_max_stake: 10,
    seeded_amount: 0,
    seed_returned_amount: 0,
    seed_is_repayable: true,
  },
});
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  for (const mock of [m.getState, m.activate, m.deactivate, m.success, m.error]) mock.mockReset();
  m.viewer = 'viewer-a';
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, run: () => unknown) => run() },
  });
});
it.each(['activate', 'deactivate'] as const)(
  'retires only a definite %s refusal key and preserves an uncertain one',
  async (action) => {
    const state = answer('club-a');
    state.state.is_active = action === 'deactivate';
    m.getState.mockResolvedValue(state);
    m[action]
      .mockRejectedValueOnce(new Error('unknown transport'))
      .mockRejectedValueOnce(new SpinCommandRefusedError('canonical refusal'))
      .mockRejectedValueOnce(new Error('unknown again'));
    render(<SpinActivationPanel clubId="club-a" />);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', {
      name: action === 'activate' ? /Activate Spins/ : /Turn Spins Off/,
    });
    await user.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    await user.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    await user.click(button);
    await waitFor(() => expect(m[action]).toHaveBeenCalledTimes(3));
    const keys = m[action].mock.calls.map((args) => args[action === 'activate' ? 4 : 1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  }
);
it('reloads current active state after an old successful deactivation receipt', async () => {
  const current = answer('club-a');
  current.state.is_active = true;
  m.getState.mockResolvedValue(current);
  m.deactivate.mockResolvedValue({ result: { ok: true, seed_returned: 0 } });
  render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Turn Spins Off/ }));
  await waitFor(() => expect(m.getState).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('button', { name: /Turn Spins Off/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Activate Spins/ })).not.toBeInTheDocument();
});
it.each(['club', 'viewer'])(
  'removes the old permission and controls immediately on a %s change',
  async (change) => {
    m.getState
      .mockResolvedValueOnce(answer('club-a'))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { rerender } = render(<SpinActivationPanel clubId="club-a" />);
    await screen.findByRole('button', { name: /Activate Spins/ });
    if (change === 'viewer') m.viewer = 'viewer-b';
    rerender(<SpinActivationPanel clubId={change === 'club' ? 'club-b' : 'club-a'} />);
    expect(screen.queryByRole('button', { name: /Activate Spins/ })).not.toBeInTheDocument();
    expect(screen.getByText('Loading')).toBeInTheDocument();
  }
);
it('ignores a late previous-club read that would restore management rights', async () => {
  const old = deferred();
  m.getState.mockReturnValueOnce(old.promise).mockResolvedValueOnce(answer('club-b', false));
  const { rerender } = render(<SpinActivationPanel clubId="club-a" />);
  rerender(<SpinActivationPanel clubId="club-b" />);
  await screen.findByText('Spins Are Off');
  await act(async () => old.resolve(answer('club-a')));
  expect(screen.queryByRole('button', { name: /Activate Spins/ })).not.toBeInTheDocument();
});
it('does not treat a string false as management permission', async () => {
  m.getState.mockResolvedValue(answer('club-a', 'false'));
  render(<SpinActivationPanel clubId="club-a" />);
  await screen.findByText('Spins Are Off');
  expect(screen.queryByRole('button', { name: /Activate Spins/ })).not.toBeInTheDocument();
});
it.each(['success', 'error'])(
  'ignores an old activation %s after navigating to another club',
  async (outcome) => {
    const old = deferred();
    m.getState
      .mockResolvedValueOnce(answer('club-a'))
      .mockResolvedValueOnce(answer('club-b', false));
    m.activate.mockReturnValueOnce(old.promise);
    const { rerender } = render(<SpinActivationPanel clubId="club-a" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Activate Spins/ }));
    await waitFor(() => expect(m.activate).toHaveBeenCalledTimes(1));
    rerender(<SpinActivationPanel clubId="club-b" />);
    await screen.findByText('Spins Are Off');
    await act(async () =>
      outcome === 'success'
        ? old.resolve({ result: { ok: true } })
        : old.reject(new Error('old club refusal'))
    );
    expect(m.success).not.toHaveBeenCalled();
    expect(m.error).not.toHaveBeenCalled();
    expect(m.getState).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }
);
it('retains an unknown payload and prevents changing its funding wallet', async () => {
  m.getState.mockResolvedValue(answer('club-a'));
  m.activate.mockRejectedValue(new Error('ambiguous response'));
  render(<SpinActivationPanel clubId="club-a" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Activate Spins/ }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: /Check Pending/ }));
  await waitFor(() => expect(m.activate).toHaveBeenCalledTimes(2));
  expect(m.activate.mock.calls[1][4]).toBe(m.activate.mock.calls[0][4]);
  expect(screen.getByLabelText('Seed From')).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Seed From'), 'promo_balance');
  await user.click(screen.getByRole('button', { name: /Check Pending/ }));
  await waitFor(() => expect(m.activate).toHaveBeenCalledTimes(3));
  expect(m.activate.mock.calls[2][3]).toBe('chip_treasury');
  expect(m.activate.mock.calls[2][4]).toBe(m.activate.mock.calls[0][4]);
});

it.each(['success', 'error'])(
  'ignores an old deactivation %s after changing the viewer',
  async (outcome) => {
    const old = deferred();
    const active = answer('club-a');
    active.state.is_active = true;
    m.getState.mockResolvedValueOnce(active).mockResolvedValueOnce(answer('club-a', false));
    m.deactivate.mockReturnValueOnce(old.promise);
    const { rerender } = render(<SpinActivationPanel clubId="club-a" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Turn Spins Off' }));
    await waitFor(() => expect(m.deactivate).toHaveBeenCalledTimes(1));
    m.viewer = 'viewer-b';
    rerender(<SpinActivationPanel clubId="club-a" />);
    await screen.findByText('Spins Are Off');
    await act(async () =>
      outcome === 'success'
        ? old.resolve({ result: { seed_returned: 100 } })
        : old.reject(new Error('old viewer refusal'))
    );
    expect(m.success).not.toHaveBeenCalled();
    expect(m.error).not.toHaveBeenCalled();
    expect(m.getState).toHaveBeenCalledTimes(2);
  }
);

it('does not announce a completed request after the panel unmounts', async () => {
  const old = deferred();
  m.getState.mockResolvedValue(answer('club-a'));
  m.activate.mockReturnValue(old.promise);
  const { unmount } = render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Activate Spins/ }));
  unmount();
  await act(async () => old.resolve({ result: { ok: true } }));
  expect(m.success).not.toHaveBeenCalled();
  expect(m.getState).toHaveBeenCalledTimes(1);
});

it('keeps a retired effect read from restoring permissions during StrictMode remount', async () => {
  const old = deferred();
  m.getState.mockReturnValueOnce(old.promise).mockResolvedValueOnce(answer('club-a', false));
  render(
    <StrictMode>
      <SpinActivationPanel clubId="club-a" />
    </StrictMode>
  );
  await screen.findByText('Spins Are Off');
  await act(async () => old.resolve(answer('club-a')));
  expect(screen.queryByRole('button', { name: /Activate Spins/ })).not.toBeInTheDocument();
});

it('submits one activation for a repeated click while the original request is pending', async () => {
  const pending = deferred();
  m.getState.mockResolvedValue(answer('club-a'));
  m.activate.mockReturnValue(pending.promise);
  render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().dblClick(await screen.findByRole('button', { name: /Activate Spins/ }));
  expect(m.activate).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error('unknown response')));
  expect(screen.getByRole('alert')).toHaveTextContent('unknown response');
});

it('retains the exact unknown activation through unmount and reload', async () => {
  m.getState.mockResolvedValue(answer('club-a'));
  m.activate.mockRejectedValue(new Error('unknown response'));
  const first = render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Activate Spins/ }));
  await screen.findByRole('alert');
  const original = m.activate.mock.calls[0];
  first.unmount();
  render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Check Pending/ }));
  await waitFor(() => expect(m.activate).toHaveBeenCalledTimes(2));
  expect(m.activate.mock.calls[1]).toEqual(original);
});
it('checks the old activation instead of deactivating newer authoritative state after reload', async () => {
  m.getState.mockResolvedValue(answer('club-a'));
  m.activate
    .mockRejectedValueOnce(new Error('unknown response'))
    .mockResolvedValueOnce({ result: { ok: true } });
  const first = render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Activate Spins/ }));
  await screen.findByRole('alert');
  first.unmount();
  const current = answer('club-a');
  current.state.is_active = true;
  m.getState.mockResolvedValue(current);
  render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Check Pending/ }));
  await screen.findByRole('button', { name: /Turn Spins Off/ });
  expect(m.deactivate).not.toHaveBeenCalled();
  expect(m.activate.mock.calls[1]).toEqual(m.activate.mock.calls[0]);
});

it('does not attach another viewer to the saved request after reload', async () => {
  m.getState.mockResolvedValue(answer('club-a'));
  m.activate.mockRejectedValue(new Error('unknown response'));
  const first = render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Activate Spins/ }));
  await screen.findByRole('alert');
  const original = m.activate.mock.calls[0];
  first.unmount();
  m.viewer = 'viewer-b';
  const second = render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Activate Spins/ }));
  await screen.findByRole('alert');
  expect(m.activate.mock.calls[1][4]).not.toBe(original[4]);
  expect(m.activate.mock.calls[1][5].actorId).toBe('viewer-b');
  second.unmount();
  m.viewer = 'viewer-a';
  render(<SpinActivationPanel clubId="club-a" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Check Pending/ }));
  await waitFor(() => expect(m.activate).toHaveBeenCalledTimes(3));
  expect(m.activate.mock.calls[2]).toEqual(original);
});
