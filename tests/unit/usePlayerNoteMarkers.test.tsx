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
  rows: [] as Array<{ target_user_id: string | null }>,
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
});

describe('usePlayerNoteMarkers', () => {
  it("loads the viewer's noted opponents once and empties on sign-out", async () => {
    mocks.rows = [
      { target_user_id: 'villain-1' },
      { target_user_id: 'villain-2' },
      { target_user_id: null },
    ];
    const hook = renderHook(({ userId }) => usePlayerNoteMarkers(userId), {
      initialProps: { userId: 'hero' as string | null },
    });
    await waitFor(() => expect(hook.result.current.has('villain-1')).toBe(true));
    expect(hook.result.current.has('villain-2')).toBe(true);
    expect(hook.result.current.size).toBe(2);
    expect(mocks.reads).toBe(1);

    hook.rerender({ userId: null });
    expect(hook.result.current.size).toBe(0);
    expect(mocks.reads).toBe(1);
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
      });
    });
    expect(hook.result.current.has('villain-3')).toBe(true);

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
});
