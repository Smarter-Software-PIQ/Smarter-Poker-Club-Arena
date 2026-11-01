import { afterEach, expect, it, vi } from 'vitest';
import type { Page, WebSocketRoute } from '@playwright/test';
import { ReplayEngine, type Recording } from '../live-turn/replay-engine';

afterEach(() => vi.useRealTimers());

async function fixture() {
  let attach!: (socket: WebSocketRoute) => void;
  let receive!: (data: string) => void;
  const frames: Array<{ type: string }> = [];
  const page = {
    routeWebSocket: async (_url: unknown, handler: typeof attach) => {
      attach = handler;
    },
    route: async () => {},
  } as unknown as Page;
  const recording: Recording = {
    t0: 1_700_000_000_000,
    table: 'lease-table',
    hero: 'hero',
    villain: 'villain',
    out: [
      { at: 0, kind: 'JOINED' },
      {
        at: 0,
        kind: 'WIRE',
        frame: {
          type: 'SNAPSHOT',
          tableId: 'lease-table',
          seq: 1,
          state: { pot: 10, action_context: 'original-decision' },
        },
      },
    ],
  };
  const engine = await ReplayEngine.install(page, recording);
  attach({
    onMessage: (handler: typeof receive) => {
      receive = handler;
    },
    onClose: () => {},
    send: (data: string) => {
      frames.push(JSON.parse(data));
    },
  } as unknown as WebSocketRoute);
  receive(JSON.stringify({ type: 'SUBSCRIBE', tableId: recording.table }));
  await vi.advanceTimersByTimeAsync(0);
  const snapshots = () => frames.filter((frame) => frame.type === 'SNAPSHOT').length;
  return { engine, receive, snapshots };
}

it('bounds actual delayed RESYNC replies from the first blocked request, not click setup', async () => {
  vi.useFakeTimers();
  const { engine, receive, snapshots } = await fixture();
  try {
    engine.holdResyncReplies(5_000);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(engine.resyncRepliesHeld).toBe(true);
    receive(JSON.stringify({ type: 'RESYNC' }));
    expect(snapshots()).toBe(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(engine.resyncRepliesHeld).toBe(true);
    expect(snapshots()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.resyncRepliesHeld).toBe(false);
    expect(snapshots()).toBe(2);
  } finally {
    engine.dispose();
  }
});

it('later RESYNC requests cannot extend the five-second response lease', async () => {
  vi.useFakeTimers();
  const { engine, receive, snapshots } = await fixture();
  try {
    engine.holdResyncReplies(5_000);
    receive(JSON.stringify({ type: 'RESYNC' }));
    await vi.advanceTimersByTimeAsync(4_000);
    receive(JSON.stringify({ type: 'RESYNC' }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.resyncRepliesHeld).toBe(false);
    expect(snapshots()).toBe(2);
  } finally {
    engine.dispose();
  }
});

it('manual release and disposal cancel the response timer without duplicate recovery', async () => {
  vi.useFakeTimers();
  const { engine, receive, snapshots } = await fixture();
  try {
    const release = engine.holdResyncReplies(5_000);
    receive(JSON.stringify({ type: 'RESYNC' }));
    release();
    release();
    expect(snapshots()).toBe(2);
    engine.holdResyncReplies(5_000);
    receive(JSON.stringify({ type: 'RESYNC' }));
    engine.dispose();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(snapshots()).toBe(2);
    expect(engine.resyncRepliesHeld).toBe(false);
  } finally {
    engine.dispose();
  }
});
