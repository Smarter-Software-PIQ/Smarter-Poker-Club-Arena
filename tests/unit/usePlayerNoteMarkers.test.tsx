/**
 * THE POST-IT ON THE SEAT (Dan 2026-11-04): "add a post it note style icon
 * any time a user adds a note about another player, they should be able to
 * see that they added a note about a player."
 *
 * Pins the three things that make the marker trustworthy:
 *  - it is loaded from the viewer's own notes (ids only) and keyed on the
 *    signed-in user, so a sign-out or account switch empties it;
 *  - a save or delete flips exactly that opponent's bit without a re-read;
 *  - a change announced for another account is ignored (notes are private).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ target_user_id: string | null; color_label?: string }>,
  error: null as null | { message: string },
  reads: 0,
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.not = () => builder;
      builder.limit = () => {
        mocks.reads += 1;
        return Promise.resolve({ data: mocks.rows, error: mocks.error });
      };
      return builder;
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
/* The realtime leg (2026-11-04): a channel on the player's own rows. The bus
   hands out one channel per key; the test drives its handler directly. */
const realtime = vi.hoisted(() => ({
  handlers: [] as Array<(payload: any) => void>,
  released: [] as string[],
  subscribed: [] as Array<(status: string) => void>,
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    getOrCreateChannel: () => ({
      on: (_type: string, _filter: unknown, handler: (payload: any) => void) => {
        realtime.handlers.push(handler);
      },
    }),
    removeRegisteredChannel: (key: string) => {
      realtime.released.push(key);
    },
  },
}));
vi.mock('../../src/lib/subscribeRealtime', () => ({
  subscribeRealtime: (_channel: unknown, callback: (status: string) => void) => {
    realtime.subscribed.push(callback);
    return Promise.resolve();
  },
}));
vi.mock('../../src/utils/retryAsync', () => ({
  retryAsync: <T,>(fn: () => Promise<T>) => fn(),
}));

import { usePlayerNoteMarkers } from '../../src/hooks/usePlayerNoteMarkers';
import { playerNotesService } from '../../src/services/PlayerNotesService';

afterEach(() => {
  cleanup();
  mocks.rows = [];
  mocks.error = null;
  mocks.reads = 0;
  realtime.handlers = [];
  realtime.released = [];
  realtime.subscribed = [];
});

describe('usePlayerNoteMarkers', () => {
  it("loads the viewer's noted opponents once and empties on sign-out", async () => {
    mocks.rows = [
      { target_user_id: 'villain-1', color_label: 'red' },
      { target_user_id: 'villain-2' },
      { target_user_id: null },
    ];
    const hook = renderHook(({ userId }) => usePlayerNoteMarkers(userId), {
      initialProps: { userId: 'hero' as string | null },
    });
    await waitFor(() => expect(hook.result.current.has('villain-1')).toBe(true));
    expect(hook.result.current.get('villain-1')).toBe('red');
    expect(hook.result.current.get('villain-2')).toBe('none');
    expect(hook.result.current.size).toBe(2);
    expect(mocks.reads).toBe(1);

    hook.rerender({ userId: null });
    expect(hook.result.current.size).toBe(0);
    expect(mocks.reads).toBe(1);
    expect(realtime.released).toEqual(['player-notes:hero']);
  });

  it('flips one opponent on a save or delete without re-reading', async () => {
    mocks.rows = [{ target_user_id: 'villain-1' }];
    const hook = renderHook(() => usePlayerNoteMarkers('hero'));
    await waitFor(() => expect(hook.result.current.has('villain-1')).toBe(true));

    act(() => {
      playerNotesService.notifyChanged({
        userId: 'hero',
        targetUserId: 'villain-3',
        hasNote: true,
        colorLabel: 'green',
      });
    });
    expect(hook.result.current.get('villain-3')).toBe('green');

    act(() => {
      playerNotesService.notifyChanged({
        userId: 'hero',
        targetUserId: 'villain-1',
        hasNote: false,
      });
    });
    expect(hook.result.current.has('villain-1')).toBe(false);
    expect(mocks.reads).toBe(1);
  });

  it('ignores a change announced for another account', async () => {
    const hook = renderHook(() => usePlayerNoteMarkers('hero'));
    await waitFor(() => expect(mocks.reads).toBe(1));
    act(() => {
      playerNotesService.notifyChanged({
        userId: 'someone-else',
        targetUserId: 'v',
        hasNote: true,
      });
    });
    expect(hook.result.current.size).toBe(0);
  });

  it('leaves every seat unmarked when the read fails, rather than guessing', async () => {
    mocks.error = { message: 'offline' };
    const hook = renderHook(() => usePlayerNoteMarkers('hero'));
    await waitFor(() => expect(mocks.reads).toBe(1));
    expect(hook.result.current.size).toBe(0);
  });

  it('never reads for a guest', () => {
    const hook = renderHook(() => usePlayerNoteMarkers('guest'));
    expect(hook.result.current.size).toBe(0);
    expect(mocks.reads).toBe(0);
  });

  it('a note written on another device arrives over realtime, and a rejoin re-reads once', async () => {
    const hook = renderHook(() => usePlayerNoteMarkers('hero'));
    await waitFor(() => expect(mocks.reads).toBe(1));
    expect(realtime.handlers).toHaveLength(1);

    act(() => {
      realtime.handlers[0]({
        eventType: 'INSERT',
        new: { user_id: 'hero', target_user_id: 'villain-9', color_label: 'blue' },
      });
    });
    expect(hook.result.current.get('villain-9')).toBe('blue');

    act(() => {
      realtime.handlers[0]({
        eventType: 'DELETE',
        old: { user_id: 'hero', target_user_id: 'villain-9', color_label: 'blue' },
      });
    });
    expect(hook.result.current.has('villain-9')).toBe(false);

    // First SUBSCRIBED is the initial join (no extra read); the second is a
    // rejoin after a drop, which may have missed changes.
    await act(async () => {
      realtime.subscribed[0]('SUBSCRIBED');
    });
    expect(mocks.reads).toBe(1);
    await act(async () => {
      realtime.subscribed[0]('SUBSCRIBED');
    });
    await waitFor(() => expect(mocks.reads).toBe(2));
  });
});
