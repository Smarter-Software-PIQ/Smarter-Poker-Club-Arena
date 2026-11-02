import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type BusHandler = (event: { payload: any }) => void;
const handlers = new Map<string, BusHandler[]>();
const emitted: Array<{ event: string; payload: any }> = [];

vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    subscribe: (event: string, handler: BusHandler) => {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
      return () => {
        const current = handlers.get(event) ?? [];
        const index = current.indexOf(handler);
        if (index >= 0) current.splice(index, 1);
      };
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
      for (const handler of [...(handlers.get(event) ?? [])]) handler({ payload });
    },
  },
}));

const rows: Record<string, unknown>[] = [];
const writeResults: Array<Promise<{ error: unknown }>> = [];
const durableRows = new Map<string, Record<string, unknown>>();

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ error: null }),
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: () =>
            Promise.resolve({ data: durableRows.get(userId) ?? null, error: null }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        rows.push(row);
        return (writeResults.shift() ?? Promise.resolve({ error: null })).then((result) => {
          if (!result.error) {
            const userId = String(row.user_id);
            durableRows.set(userId, { ...durableRows.get(userId), ...row });
          }
          return result;
        });
      },
    }),
  },
}));

vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { useUserTableSettings } from '../../src/hooks/useUserTableSettings';

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
  rows.length = 0;
  writeResults.length = 0;
  durableRows.clear();
  localStorage.clear();
});

describe('useUserTableSettings live mutation ordering', () => {
  it('ignores the legacy global cache instead of leaking another account settings', async () => {
    localStorage.setItem(
      'user_table_settings_cache',
      JSON.stringify({ blue_buttons_enabled: true })
    );
    const { result } = renderHook(() => useUserTableSettings('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings.blue_buttons_enabled).toBe(false);
  });

  it('two rapid visual toggles are calculated and persisted in tap order', async () => {
    const { result } = renderHook(() => useUserTableSettings('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveFirst: ((value: { error: null }) => void) | undefined;
    writeResults.push(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
      Promise.resolve({ error: null })
    );

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.toggleSetting('blue_buttons_enabled');
      second = result.current.toggleSetting('blue_buttons_enabled');
    });

    expect(result.current.settings.blue_buttons_enabled).toBe(false);
    expect(
      emitted
        .filter(({ event }) => event === 'SETTINGS_CHANGED')
        .slice(0, 2)
        .map(({ payload }) => payload.value)
    ).toEqual([true, false]);
    await Promise.resolve();
    expect(rows.map((row) => row.blue_buttons_enabled)).toEqual([true]);

    resolveFirst?.({ error: null });
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(rows.map((row) => row.blue_buttons_enabled)).toEqual([true, false]);
    expect(result.current.settings.blue_buttons_enabled).toBe(false);
  });

  /* ── INVERTED 2026-08-29 ──────────────────────────────────────────────────
     Two specs here used to pin the rollback: "a rejected optimistic toggle
     rolls back every mounted table" and "two rejected rapid toggles return to
     the last durable value". Both described real behaviour and both described
     a bug. Dan, binding: "NEVER REGRESS OR AUTO CHANGE BACK UNLESS THE USER
     CHANGES THEM MANUALLY." A dropped request is not the user changing
     anything, and the sister hook `useTableSettings` had already been fixed
     the other way, so the two hooks disagreed about the same table.

     What is pinned now is the replacement: retry quietly, then HOLD the value
     and say so once. The old expectations are kept above in words so nobody
     reads the new ones as a weakening. */

  const valuesOf = (event: string) =>
    emitted.filter((e) => e.event === event).map(({ payload }) => payload.value);
  const toasts = () => emitted.filter((e) => e.event === 'SHOW_TOAST');
  const mutationStates = () =>
    emitted.filter((e) => e.event === 'CUSTOMIZATION_MUTATION_STATE').map((e) => e.payload.state);

  it('a save that fails every attempt holds the value on every mounted table', async () => {
    // Three, because the write is retried twice before anyone is told.
    writeResults.push(
      Promise.resolve({ error: { message: 'denied' } }),
      Promise.resolve({ error: { message: 'denied' } }),
      Promise.resolve({ error: { message: 'denied' } })
    );
    const { result } = renderHook(() => {
      const first = useUserTableSettings('user-1');
      const second = useUserTableSettings('user-1');
      return { first, second };
    });
    await waitFor(() => {
      expect(result.current.first.loading).toBe(false);
      expect(result.current.second.loading).toBe(false);
    });

    await act(async () => {
      await result.current.first.toggleSetting('blue_buttons_enabled');
    });

    // THE SWITCH STAYS WHERE THE USER PUT IT — here and on the other table.
    expect(result.current.first.settings.blue_buttons_enabled).toBe(true);
    expect(result.current.second.settings.blue_buttons_enabled).toBe(true);
    // One broadcast, the user's. No second one undoing it.
    expect(valuesOf('SETTINGS_CHANGED')).toEqual([true]);
    // And the user is told, rather than left believing it synced.
    expect(toasts()).toHaveLength(1);
    expect(mutationStates()).toContain('save-failed');
    expect(mutationStates()).not.toContain('rolled-back');
  });

  it('a write that succeeds on retry never bothers the user', async () => {
    // One failure, then the shared default success from the supabase mock.
    writeResults.push(Promise.resolve({ error: { message: 'blip' } }));
    const { result } = renderHook(() => useUserTableSettings('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleSetting('blue_buttons_enabled');
    });

    expect(result.current.settings.blue_buttons_enabled).toBe(true);
    expect(toasts(), 'a blip that recovered is not news').toHaveLength(0);
    expect(mutationStates()).toContain('confirmed');
  });

  it('two rapid failed toggles keep the SECOND tap, and the first stops retrying', async () => {
    /* The first toggle is superseded while it waits to retry, so it abandons
       without a word — re-writing its older value is exactly the auto-change-
       back this whole change removes. Four results: one for the first attempt
       of tap 1, three for tap 2. */
    writeResults.push(
      Promise.resolve({ error: { message: 'first denied' } }),
      Promise.resolve({ error: { message: 'second denied' } }),
      Promise.resolve({ error: { message: 'second denied' } }),
      Promise.resolve({ error: { message: 'second denied' } })
    );
    const { result } = renderHook(() => useUserTableSettings('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.toggleSetting('blue_buttons_enabled');
      second = result.current.toggleSetting('blue_buttons_enabled');
    });
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(result.current.settings.blue_buttons_enabled).toBe(false);
    expect(valuesOf('SETTINGS_CHANGED')).toEqual([true, false]);
    // The superseded tap is silent; only the tap that owns the column speaks.
    expect(toasts()).toHaveLength(1);
  });

  it('does not let an old account failed write roll back the newly signed-in account', async () => {
    let resolveOldWrite: ((value: { error: unknown }) => void) | undefined;
    writeResults.push(
      new Promise((resolve) => {
        resolveOldWrite = resolve;
      })
    );
    localStorage.setItem(
      'user_table_settings_cache:user-2',
      JSON.stringify({ blue_buttons_enabled: true })
    );

    const { result, rerender } = renderHook(({ userId }) => useUserTableSettings(userId), {
      initialProps: { userId: 'user-1' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let oldWrite!: Promise<void>;
    act(() => {
      oldWrite = result.current.toggleSetting('blue_buttons_enabled');
    });
    expect(result.current.settings.blue_buttons_enabled).toBe(true);

    rerender({ userId: 'user-2' });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.settings.blue_buttons_enabled).toBe(true);
    });

    resolveOldWrite?.({ error: { message: 'old account denied' } });
    await act(async () => oldWrite);

    expect(result.current.settings.blue_buttons_enabled).toBe(true);
  });
});

it('every mounted BB control follows the latest user tap, even after its own earlier tap', async () => {
  const { result } = renderHook(() => ({
    table: useUserTableSettings('bb-user'),
    settings: useUserTableSettings('bb-user'),
  }));
  await waitFor(() =>
    expect(result.current.table.loading || result.current.settings.loading).toBe(false)
  );
  await act(async () => result.current.table.toggleSetting('show_stack_in_bb'));
  expect(result.current.settings.settings.show_stack_in_bb).toBe(true);
  await act(async () => result.current.settings.toggleSetting('show_stack_in_bb'));
  expect(result.current.table.settings.show_stack_in_bb).toBe(false);
  await act(async () => result.current.table.toggleSetting('show_stack_in_bb'));
  expect(result.current.settings.settings.show_stack_in_bb).toBe(true);
  act(() => {
    for (const handler of handlers.get('SETTINGS_CHANGED') ?? []) {
      handler({
        payload: {
          userId: 'bb-user',
          setting: 'show_stack_in_bb',
          value: false,
          origin: 'postgres-sync:stale',
        },
      });
    }
  });
  expect(result.current.table.settings.show_stack_in_bb).toBe(true);
  expect(result.current.settings.settings.show_stack_in_bb).toBe(true);
});

it.each(['show_stack_in_bb', 'table_alias'] as const)(
  '%s preserves gesture order across controls behind a deferred save and after remount',
  async (column) => {
    const userId = `deferred-${column}`;
    const hooks = renderHook(() => ({
      table: useUserTableSettings(userId),
      settings: useUserTableSettings(userId),
    }));
    await waitFor(() =>
      expect(hooks.result.current.table.loading || hooks.result.current.settings.loading).toBe(
        false
      )
    );
    let releaseFirst!: (value: { error: null }) => void;
    writeResults.push(
      new Promise((resolve) => {
        releaseFirst = resolve;
      })
    );
    const choose = (control: ReturnType<typeof useUserTableSettings>, alias: string) =>
      column === 'table_alias' ? control.setAlias(alias) : control.toggleSetting(column);
    let first!: Promise<void>;
    let second!: Promise<void>;
    let newest!: Promise<void>;
    act(() => {
      first = choose(hooks.result.current.table, 'first');
    });
    await waitFor(() => expect(rows.filter((row) => column in row)).toHaveLength(1));
    act(() => {
      second = choose(hooks.result.current.table, 'second');
      newest = choose(hooks.result.current.settings, 'newest');
    });
    expect(rows.filter((row) => column in row)).toHaveLength(1);
    releaseFirst({ error: null });
    await act(async () => {
      await Promise.all([first, second, newest]);
    });
    const expected = column === 'table_alias' ? 'newest' : true;
    expect(durableRows.get(userId)?.[column]).toBe(expected);
    expect(rows.filter((row) => column in row).map((row) => row[column])).toEqual(
      column === 'table_alias' ? ['first', 'second', 'newest'] : [true, false, true]
    );
    expect(localStorage.getItem(`ca_table_setting_intent:${userId}:${column}`)).toBeNull();
    hooks.unmount();
    // A fresh mount must hydrate the durable row, with neither cache nor an
    // unconfirmed intent concealing a stale last write.
    localStorage.clear();
    const reloaded = renderHook(() => useUserTableSettings(userId));
    await waitFor(() => expect(reloaded.result.current.loading).toBe(false));
    expect(reloaded.result.current.settings[column]).toBe(expected);
    reloaded.unmount();
  }
);
