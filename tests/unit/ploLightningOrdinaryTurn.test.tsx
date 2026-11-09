import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import ActionPanel from '../../src/components/table/ActionPanel';
import PreActionBar from '../../src/components/table/PreActionBar';
import {
  createParticipationGuard,
  ordinaryTurnContext,
  performOrdinaryTurn,
} from '../../scripts/ci/verify-plo-lightning-lifecycle.mjs';
afterEach(cleanup);
const base = {
  canFold: true,
  canCheck: true,
  canCall: false,
  canRaise: true,
  canAllIn: true,
  currentBet: 0,
  callAmount: 0,
  minRaise: 2,
  maxRaise: 200,
  pot: 4,
  bigBlind: 2,
  isMyTurn: true,
};
function browser(container: HTMLElement, clickOverride?: () => Promise<void>) {
  const locate = (find: () => HTMLElement | null): any => {
    const locator: any = {
      first: () => locator,
      locator: (selector: string) =>
        locate(() => (find()?.querySelector(selector) as HTMLElement) ?? null),
      getByRole: (role: any, options: any) =>
        locate(() => {
          const root = find();
          return root ? within(root).queryByRole(role, options) : null;
        }),
      isVisible: async () => !!find(),
      isEnabled: async () => !!find() && !(find() as HTMLButtonElement).disabled,
      getAttribute: async (name: string) => find()?.getAttribute(name) ?? null,
      press: async (key: string) => {
        expect(key).toBe('Home');
        await act(async () =>
          fireEvent.change(find()!, { target: { value: find()!.getAttribute('min') } })
        );
      },
      click: async () => {
        if (clickOverride) return clickOverride();
        await act(async () => {
          fireEvent.click(find()!);
        });
      },
    };
    return locator;
  };
  return locate(() => container);
}
it('uses the real live ActionPanel instead of the earlier real pre-action Check toggle', async () => {
  const onAction = vi.fn(),
    pre = vi.fn();
  const { container } = render(
    <>
      <PreActionBar canCheck isMyTurn={false} preAction={null} onPreActionChange={pre} />
      <ActionPanel {...base} onAction={onAction} />
    </>
  );
  // The original global role selector reaches the pre-action, not a turn.
  fireEvent.click(within(container).getAllByRole('button', { name: 'Check', exact: true })[0]);
  expect(pre).toHaveBeenCalledOnce();
  expect(onAction).not.toHaveBeenCalled();
  pre.mockClear();
  await performOrdinaryTurn(browser(container));
  expect(onAction).toHaveBeenCalledExactlyOnceWith('check');
  expect(pre).not.toHaveBeenCalled();
});
it('folds only through the actual live turn panel when facing a bet', async () => {
  const onAction = vi.fn();
  const { container } = render(
    <ActionPanel
      {...base}
      canCheck={false}
      canCall
      currentBet={10}
      callAmount={10}
      onAction={onAction}
    />
  );
  await performOrdinaryTurn(browser(container));
  expect(onAction).toHaveBeenCalledExactlyOnceWith('fold');
});
it.each([{ isMyTurn: false }, { connectionStale: true }])(
  'does not act on an inactive or disconnected panel: %j',
  async (override) => {
    const onAction = vi.fn();
    const { container } = render(<ActionPanel {...base} {...override} onAction={onAction} />);
    await performOrdinaryTurn(browser(container));
    expect(onAction).not.toHaveBeenCalled();
  }
);
it('does not replay a turn that disappeared while the ordinary click was waiting', async () => {
  const onAction = vi.fn();
  const { container, unmount } = render(<ActionPanel {...base} onAction={onAction} />);
  const click = vi.fn(async () => {
    unmount();
    const e = new Error('detached during turn change');
    e.name = 'TimeoutError';
    throw e;
  });
  await performOrdinaryTurn(browser(container, click));
  expect(click).toHaveBeenCalledOnce();
  expect(onAction).not.toHaveBeenCalled();
});
it('does not swallow a timeout while the actual control is still visible and enabled', async () => {
  const { container } = render(<ActionPanel {...base} onAction={vi.fn()} />);
  const e = new Error('real overlay');
  e.name = 'TimeoutError';
  await expect(
    performOrdinaryTurn(
      browser(container, async () => {
        throw e;
      })
    )
  ).rejects.toBe(e);
});

it('calls through the real preflop control within the finite participation budget', async () => {
  const onAction = vi.fn();
  const { container } = render(
    <ActionPanel
      {...base}
      canCheck={false}
      canCall
      callAmount={2}
      currentBet={2}
      onAction={onAction}
    />
  );
  await performOrdinaryTurn(browser(container), {
    stage: 'preflop',
    callAmount: 2,
    bet: 0,
    budget: 8,
  });
  expect(onAction).toHaveBeenCalledExactlyOnceWith('call');
});
it('uses the ordinary minimum raise sheet when checking would never enter the pot voluntarily', async () => {
  const onAction = vi.fn();
  const { container } = render(
    <ActionPanel {...base} currentBet={2} minRaise={4} onAction={onAction} />
  );
  await performOrdinaryTurn(browser(container), {
    stage: 'preflop',
    callAmount: 0,
    bet: 2,
    budget: 4,
  });
  expect(onAction).toHaveBeenCalledExactlyOnceWith('raise', 4);
});
it('folds an over-budget preflop call and never submits an all-in instead', async () => {
  const onAction = vi.fn();
  const { container } = render(
    <ActionPanel
      {...base}
      canCheck={false}
      canCall
      callAmount={20}
      currentBet={20}
      onAction={onAction}
    />
  );
  await performOrdinaryTurn(browser(container), {
    stage: 'preflop',
    callAmount: 20,
    bet: 0,
    budget: 8,
  });
  expect(onAction).toHaveBeenCalledExactlyOnceWith('fold');
});
it('backs out of an over-budget minimum raise without betting', async () => {
  const onAction = vi.fn();
  const { container } = render(
    <ActionPanel {...base} currentBet={2} minRaise={10} onAction={onAction} />
  );
  await performOrdinaryTurn(browser(container), {
    stage: 'preflop',
    callAmount: 0,
    bet: 2,
    budget: 4,
  });
  expect(onAction).toHaveBeenCalledExactlyOnceWith('check');
  expect(within(container).getByRole('button', { name: 'Open Raise Panel' })).toBeTruthy();
});
it('keeps postflop decisions check/fold even when a cheap call is available', async () => {
  const onAction = vi.fn();
  const { container } = render(
    <ActionPanel
      {...base}
      canCheck={false}
      canCall
      callAmount={2}
      currentBet={2}
      onAction={onAction}
    />
  );
  await performOrdinaryTurn(browser(container), {
    stage: 'flop',
    callAmount: 2,
    bet: 0,
    budget: 8,
  });
  expect(onAction).toHaveBeenCalledExactlyOnceWith('fold');
});
it('binds participation to the requesting player and subtracts actual hand investment from its eight-chip budget', () => {
  const snapshot = {
    table_id: 'table',
    action_context: 'decision1',
    current_player: 'owned',
    stage: 'preflop',
    current_bet: 4,
    players: [{ user_id: 'owned', bet: 2, totalInvested: 6, stack: 100 }],
  };
  expect(ordinaryTurnContext(snapshot, 'owned')).toEqual({
    tableId: 'table',
    context: 'decision1',
    stage: 'preflop',
    callAmount: 2,
    bet: 2,
    budget: 2,
  });
  expect(ordinaryTurnContext(snapshot, 'another')).toBeNull();
  expect(() => ordinaryTurnContext({ ...snapshot, current_bet: NaN }, 'owned')).toThrow();
  snapshot.players[0].stack = 1;
  expect(ordinaryTurnContext(snapshot, 'owned')?.budget).toBeCloseTo(0.99);
});

it('refuses a successor call or raise at the actual request boundary even when the UI changed after snapshot approval', () => {
  const g = createParticipationGuard();
  g.approve({
    tableId: 'table',
    context: 'original',
    stage: 'preflop',
    callAmount: 2,
    bet: 2,
    budget: 4,
  });
  const body = {
    tableId: 'table',
    actionContext: 'successor',
    idempotencyKey: 'new',
    action: 'call',
  };
  expect(g.allows(body)).toBe(false);
  expect(g.allows({ ...body, action: 'raise', amount: 100 })).toBe(false);
  expect(g.allows({ ...body, actionContext: 'original', action: 'allin' })).toBe(false);
  expect(g.allows({ ...body, actionContext: 'original', action: 'raise', amount: 10 })).toBe(false);
  expect(g.allows({ ...body, tableId: 'other', actionContext: 'original' })).toBe(false);
});
it('allows only the exact budgeted decision intent and its same-key transport retries', () => {
  const g = createParticipationGuard();
  g.approve({
    tableId: 'table',
    context: 'original',
    stage: 'preflop',
    callAmount: 2,
    bet: 2,
    budget: 4,
  });
  const body = {
    tableId: 'table',
    actionContext: 'original',
    idempotencyKey: 'one',
    action: 'raise',
    amount: 4,
  };
  expect(g.allows(body)).toBe(true);
  expect(g.allows({ ...body })).toBe(true);
  expect(g.allows({ ...body, idempotencyKey: 'another' })).toBe(false);
  expect(g.allows({ ...body, amount: 6 })).toBe(false);
});
