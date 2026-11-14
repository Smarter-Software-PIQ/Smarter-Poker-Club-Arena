/**
 * Dan 2026-11-12: Lightning "Leave Next Hand", end to end through the real
 * button and the real queue: it waits for the hand, survives a reload mid-hand,
 * and can be cancelled. The harness plays the page's part (the hand's state
 * and the leave owner) exactly as TablePage wires it.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

const mocks = vi.hoisted(() => ({ stop: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('../../src/lightning/lightningSessionApi', () => ({ stopLightningPlaying: mocks.stop }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ warning: mocks.warning, info: mocks.info }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { LightningLeaveControl } from '../../src/components/lightning/LightningLeaveControl';
import {
  lightningLeaveQueueKey,
  lightningLeaveWaitsForHand,
  useLightningLeaveAfterHand,
} from '../../src/lightning/lightningLeaveNextHand';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

type Hand = { handInProgress: boolean; handSettling: boolean; heroStatus: string; ready: boolean };

let setHand!: (h: Hand) => void;
function Page(props: {
  storage: ReturnType<typeof memoryStorage>;
  leave: () => Promise<void>;
  resume: () => Promise<{ ok: boolean; reason?: string }>;
  initial: Hand;
}) {
  const [hand, set] = useState(props.initial);
  setHand = set;
  const waits = lightningLeaveWaitsForHand(
    hand.ready
      ? {
          stage: hand.handInProgress ? 'flop' : 'waiting',
          hand_id: 'current',
          players: [{ user_id: 'u1', is_folded: hand.heroStatus === 'folded' }],
        }
      : null,
    hand.handSettling ? 'current' : null,
    'u1'
  );
  const queue = useLightningLeaveAfterHand({
    userId: 'u1',
    poolSessionId: 'pool-1',
    ready: hand.ready,
    waits,
    leave: props.leave,
    performCommand: async (command) => {
      if (command === 'resuming') return !(await props.resume()).ok;
      const stop = await mocks.stop();
      return stop.inHand && !waits ? 'awaiting-hand' : true;
    },
    storage: props.storage,
  });
  return (
    <>
      <span data-testid="acting">{waits ? 'acting' : 'idle'}</span>
      <LightningLeaveControl
        pending={false}
        onLeave={() => queue.request('stopping')}
        queued={queue.queued}
        onCancel={() => queue.request('resuming')}
      />
    </>
  );
}

const live: Hand = { handInProgress: true, handSettling: false, heroStatus: 'active', ready: true };
const KEY = lightningLeaveQueueKey('u1', 'pool-1');

beforeEach(() => {
  mocks.stop.mockResolvedValue({
    ok: true,
    stopping: true,
    exited: false,
    inHand: true,
    reason: null,
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Lightning Leave Next Hand, the whole lifecycle', () => {
  it('mid-hand: stops matchmaking, keeps the player in the hand, leaves once at the end', async () => {
    const storage = memoryStorage();
    const leave = vi.fn(async () => {});
    render(<Page storage={storage} leave={leave} resume={vi.fn()} initial={live} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' }));
    });
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole('button').textContent).toBe('Leaving After This Hand');
    expect(screen.getByTestId('acting').textContent).toBe('acting');
    expect(storage.map.get(KEY)).toBe('1');
    // The player keeps acting: turns pass, the hand is still live.
    await act(async () => setHand({ ...live }));
    expect(leave).not.toHaveBeenCalled();
    // The hand settles: the leave runs exactly once and the saved intent clears.
    await act(async () => setHand({ ...live, handSettling: true }));
    await act(async () => setHand({ ...live, handInProgress: false }));
    expect(leave).toHaveBeenCalledOnce();
    expect(storage.map.has(KEY)).toBe(false);
  });

  it('between hands it leaves at once, nothing queued', async () => {
    mocks.stop.mockResolvedValue({ ok: true, exited: true, inHand: false });
    const storage = memoryStorage();
    const leave = vi.fn(async () => {});
    render(
      <Page
        storage={storage}
        leave={leave}
        resume={vi.fn()}
        initial={{ ...live, handInProgress: false }}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' }));
    });
    expect(leave).toHaveBeenCalledOnce();
    expect(storage.map.has(KEY)).toBe(false);
  });

  it('retains an in-hand stop across stale idle snapshots and reload until the reserved deal completes', async () => {
    const storage = memoryStorage();
    const leave = vi.fn(async () => {});
    const props = { storage, leave, resume: vi.fn(), initial: { ...live, handInProgress: false } };
    const before = render(<Page {...props} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' })));
    expect(storage.map.get(KEY)).toBe('awaiting-hand');
    before.unmount();
    render(<Page {...props} />);
    await act(async () => setHand({ ...props.initial }));
    expect(leave).not.toHaveBeenCalled();
    await act(async () => setHand(live));
    expect(leave).not.toHaveBeenCalled();
    await act(async () => setHand({ ...live, handSettling: true }));
    expect(leave).toHaveBeenCalledOnce();
  });

  it('a reload mid-hand keeps the queued leave and still leaves when that hand ends', async () => {
    const storage = memoryStorage();
    const leave = vi.fn(async () => {});
    const first = render(<Page storage={storage} leave={leave} resume={vi.fn()} initial={live} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' }));
    });
    first.unmount();
    // The reloaded page hydrates: not ready yet, then the live hand arrives.
    render(
      <Page
        storage={storage}
        leave={leave}
        resume={vi.fn()}
        initial={{ ...live, handInProgress: false, ready: false }}
      />
    );
    expect(screen.getByRole('button').textContent).toBe('Leaving After This Hand');
    expect(leave).not.toHaveBeenCalled();
    await act(async () => setHand(live));
    expect(leave).not.toHaveBeenCalled();
    await act(async () => setHand({ ...live, handSettling: true }));
    expect(leave).toHaveBeenCalledOnce();
  });

  it('tapping Leaving After This Hand cancels: play resumes, no leave, and the next press stops again', async () => {
    const storage = memoryStorage();
    const leave = vi.fn(async () => {});
    const resume = vi.fn(async () => ({ ok: true }));
    render(<Page storage={storage} leave={leave} resume={resume} initial={live} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leaving After This Hand' }));
    });
    expect(resume).toHaveBeenCalledOnce();
    expect(storage.map.has(KEY)).toBe(false);
    await act(async () => setHand({ ...live, handSettling: true }));
    expect(leave).not.toHaveBeenCalled();
    // Re-arming sends the stop again (the earlier one was withdrawn).
    await act(async () => setHand(live));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' }));
    });
    expect(mocks.stop).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button').textContent).toBe('Leaving After This Hand');
  });

  it('a refused cancel (the hand already ended) keeps the leave', async () => {
    const storage = memoryStorage();
    const leave = vi.fn(async () => {});
    const resume = vi.fn(async () => ({ ok: false, reason: 'EXITED' }));
    render(<Page storage={storage} leave={leave} resume={resume} initial={live} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leaving After This Hand' }));
    });
    expect(storage.map.get(KEY)).toBe('1');
    await act(async () => setHand({ ...live, handInProgress: false }));
    expect(leave).toHaveBeenCalledOnce();
  });
});

it.each(['stopping', 'resuming'] as const)(
  'recovers an unknown %s receipt after reload',
  async (command) => {
    const storage = memoryStorage();
    const leave = vi.fn();
    const perform = vi
      .fn()
      .mockResolvedValueOnce('unknown')
      .mockResolvedValueOnce(command === 'stopping');
    const mount = () =>
      renderHook(() =>
        useLightningLeaveAfterHand({
          userId: 'u1',
          poolSessionId: 'pool-1',
          ready: true,
          waits: false,
          leave,
          storage,
          performCommand: perform,
        })
      );
    const first = mount();
    act(() => first.result.current.request(command));
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1));
    expect(storage.getItem(KEY)).toBe(command);
    expect(leave).not.toHaveBeenCalled();
    first.unmount();
    mount();
    await waitFor(() => expect(storage.getItem(KEY)).toBeNull());
    expect(perform).toHaveBeenNthCalledWith(2, command);
    expect(leave).toHaveBeenCalledTimes(command === 'stopping' ? 1 : 0);
  }
);

it('a delayed Stop reply in tab A cannot resurrect a leave cancelled in tab B', async () => {
  const storage = memoryStorage();
  const leave = vi.fn();
  let accept!: (value: boolean) => void;
  const perform = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        accept = resolve;
      })
  );
  const view = renderHook(() =>
    useLightningLeaveAfterHand({
      userId: 'u1',
      poolSessionId: 'pool-1',
      ready: true,
      waits: false,
      leave,
      storage,
      performCommand: perform,
    })
  );
  act(() => view.result.current.request('stopping'));
  await waitFor(() => expect(perform).toHaveBeenCalledOnce());
  storage.removeItem(KEY);
  // A suspended tab can receive the HTTP reply before its storage event.
  await act(async () => accept(true));
  expect(storage.getItem(KEY)).toBeNull();
  expect(view.result.current.queued).toBe(false);
  expect(leave).not.toHaveBeenCalled();
});
it('a second tab observes Stay before it reaches its hand boundary', async () => {
  const storage = memoryStorage();
  storage.setItem(KEY, '1');
  const leave = vi.fn();
  const props = { userId: 'u1', poolSessionId: 'pool-1', ready: true, waits: true, leave, storage };
  const view = renderHook(useLightningLeaveAfterHand, { initialProps: props });
  expect(view.result.current.queued).toBe(true);
  storage.removeItem(KEY);
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: KEY })));
  await act(async () => view.rerender({ ...props, waits: false }));
  expect(view.result.current.queued).toBe(false);
  expect(leave).not.toHaveBeenCalled();
});

it.each([false, true])(
  'a reloaded final-hand choice persists until the player chooses Leave=%s',
  async (confirm) => {
    const storage = memoryStorage();
    storage.setItem(KEY, '1');
    let firstRead!: (value: number) => void;
    const finish = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            firstRead = resolve;
          })
      )
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce('accepted');
    const resume = vi.fn().mockResolvedValue(false);
    const directLeave = vi.fn();
    const mount = () =>
      renderHook(() =>
        useLightningLeaveAfterHand({
          userId: 'u1',
          poolSessionId: 'pool-1',
          ready: true,
          waits: false,
          storage,
          leave: directLeave,
          finish,
          performCommand: resume,
        })
      );
    const first = mount();
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(storage.getItem(KEY)).toBe('finishing');
    first.unmount();
    const reloaded = mount();
    await act(async () => firstRead(8));
    await waitFor(() => expect(reloaded.result.current.owed).toBe(4));
    expect(storage.getItem(KEY)).toBe('owed:4');
    reloaded.unmount();
    const atPrompt = mount();
    expect(atPrompt.result.current.owed).toBe(4);
    expect(finish).toHaveBeenCalledTimes(2);
    act(() => atPrompt.result.current.decide(confirm));
    await waitFor(() => expect(storage.getItem(KEY)).toBeNull());
    if (confirm) {
      expect(finish).toHaveBeenLastCalledWith(true, expect.any(Function));
      expect(resume).not.toHaveBeenCalled();
    } else {
      expect(resume).toHaveBeenCalledExactlyOnceWith('resuming');
      expect(finish).toHaveBeenCalledTimes(2);
    }
    expect(directLeave).not.toHaveBeenCalled();
  }
);

it('a stale modal cannot overwrite a choice from another window', () => {
  const storage = memoryStorage();
  storage.setItem(KEY, 'owed:3');
  const view = renderHook(() =>
    useLightningLeaveAfterHand({
      userId: 'u1',
      poolSessionId: 'pool-1',
      ready: true,
      waits: false,
      connected: false,
      storage,
      leave: vi.fn(),
    })
  );
  storage.setItem(KEY, 'confirmed');
  act(() => view.result.current.decide(false));
  expect(storage.getItem(KEY)).toBe('confirmed');
  expect(view.result.current.owed).toBeNull();
});
