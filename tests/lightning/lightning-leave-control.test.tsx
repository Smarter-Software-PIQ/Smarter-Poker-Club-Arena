import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ stop: vi.fn(), warning: vi.fn(), report: vi.fn() }));
vi.mock('../../src/lightning/lightningSessionApi', () => ({ stopLightningPlaying: mocks.stop }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ warning: mocks.warning }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: mocks.report }));
import { LightningLeaveControl } from '../../src/components/lightning/LightningLeaveControl';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const accepted = { ok: true, stopping: true, exited: false, inHand: true, reason: null };

describe('Lightning stand up stops re-entry before leaving', () => {
  it('persists stop first and collapses repeated presses while it waits', async () => {
    let answer!: (r: typeof accepted) => void;
    mocks.stop.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const leave = vi.fn(async () => {});
    const intent = vi.fn();
    render(
      <LightningLeaveControl clusterId="cluster" onLeave={leave} onLeaveIntentChange={intent} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' }));
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith('cluster');
    expect(leave).not.toHaveBeenCalled();
    expect(intent).toHaveBeenCalledExactlyOnceWith(true);
    expect(intent.mock.invocationCallOrder[0]).toBeLessThan(mocks.stop.mock.invocationCallOrder[0]);
    await act(async () => {
      answer(accepted);
    });
    expect(leave).toHaveBeenCalledOnce();
  });
  it.each([null, { ...accepted, ok: false }])(
    'keeps the leave open when stop is unconfirmed: %s',
    async (result) => {
      mocks.stop.mockResolvedValue(result);
      const leave = vi.fn(async () => {});
      const intent = vi.fn();
      render(
        <LightningLeaveControl clusterId="cluster" onLeave={leave} onLeaveIntentChange={intent} />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button'));
      });
      expect(leave).not.toHaveBeenCalled();
      expect(intent.mock.calls).toEqual([[true], [false]]);
      expect(mocks.warning).toHaveBeenCalledOnce();
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    }
  );
  it('does not navigate a different room after unmounting while stop is in flight', async () => {
    let answer!: (r: typeof accepted) => void;
    mocks.stop.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const leave = vi.fn(async () => {});
    const view = render(<LightningLeaveControl clusterId="cluster" onLeave={leave} />);
    fireEvent.click(screen.getByRole('button'));
    view.unmount();
    await act(async () => {
      answer(accepted);
    });
    expect(leave).not.toHaveBeenCalled();
  });
  it('retains the accepted stop when cash-out needs another explicit attempt', async () => {
    mocks.stop.mockResolvedValue(accepted);
    const leave = vi
      .fn()
      .mockRejectedValueOnce(new Error('Cash-out unavailable'))
      .mockResolvedValueOnce(undefined);
    render(<LightningLeaveControl clusterId="cluster" onLeave={leave} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledTimes(2);
    expect(mocks.report).toHaveBeenCalledOnce();
  });
  it('shows Leaving After Hand and refuses another press while the leave waits for the hand', () => {
    render(<LightningLeaveControl clusterId="cluster" onLeave={vi.fn()} queued />);
    const button = screen.getByRole('button', { name: 'Leaving After Hand' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('a queued leave with a cancel door is tappable and cancels instead of leaving', async () => {
    const onCancel = vi.fn(async () => true);
    const leave = vi.fn();
    render(
      <LightningLeaveControl clusterId="cluster" onLeave={leave} queued onCancel={onCancel} />
    );
    const button = screen.getByRole('button', { name: 'Leaving After Hand' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.title).toBe('Tap To Keep Playing');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });
});
