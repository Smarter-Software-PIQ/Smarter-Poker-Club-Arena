import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import ActionPanel from '../../src/components/table/ActionPanel';
import PreActionBar from '../../src/components/table/PreActionBar';
import { performOrdinaryTurn } from '../../scripts/ci/verify-plo-lightning-lifecycle.mjs';
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
  return {
    locator: (selector: string) => ({
      getByRole: (role: any, options: any) => {
        const find = () => {
          const root = container.querySelector(selector);
          return root
            ? (within(root as HTMLElement).queryByRole(role, options) as HTMLButtonElement | null)
            : null;
        };
        const button = {
          first: () => button,
          isVisible: async () => !!find(),
          isEnabled: async () => !!find() && !find()!.disabled,
          click: async () => {
            if (clickOverride) return clickOverride();
            await act(async () => {
              fireEvent.click(find()!);
            });
          },
        };
        return button;
      },
    }),
  };
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
