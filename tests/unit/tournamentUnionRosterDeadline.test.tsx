import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ read: vi.fn(), report: vi.fn(), signals: [] as AbortSignal[] }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const result = api.read(table);
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        range: () => q,
        maybeSingle: () => q,
        abortSignal: (s: AbortSignal) => {
          api.signals.push(s);
          return q;
        },
        then: result.then.bind(result),
      };
      return q;
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: api.report,
  reportWarning: vi.fn(),
}));
import UnionsTab from '../../src/components/tournament/details/UnionsTab';
const props = (id = 'event-a', viewer = 'viewer') =>
  ({
    tournament: { id, club_id: 'club', union_id: 'union', is_xmtt: true },
    entries: [
      { id: 'entry', user_id: 'player', username: 'Player', status: 'playing', chips: 100 },
    ],
    currentUserId: viewer,
  }) as any;
const good = (table: string) => ({
  data:
    table === 'tournament_players'
      ? [{ user_id: 'player', club_id: 'club' }]
      : table === 'clubs'
        ? [{ id: 'club', name: 'Original Club', level: 1, union_id: 'union' }]
        : table === 'unions'
          ? { name: 'Original Union' }
          : [],
  error: null,
});
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  api.signals.length = 0;
  api.read.mockImplementation((table) => Promise.resolve(good(table)));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it.each(['tournament_players', 'clubs', 'unions'])(
  'finishes an unanswered %s read',
  async (table) => {
    api.read.mockImplementation((t) =>
      t === table ? new Promise(() => {}) : Promise.resolve(good(t))
    );
    render(<UnionsTab {...props()} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(screen.queryByText('Loading Participating Clubs')).toBeNull();
    expect(screen.getByText('Could Not Load The Participating Clubs')).toBeTruthy();
    expect(api.signals.some((s) => s.aborted)).toBe(true);
  }
);
it.each(['event', 'viewer'])(
  'does not reuse the prior roster after changing %s',
  async (change) => {
    const mounted = render(<UnionsTab {...props()} />);
    await flush();
    expect(screen.getByText('Original Union')).toBeTruthy();
    api.read.mockImplementation(() => new Promise(() => {}));
    mounted.rerender(
      <UnionsTab
        {...props(
          change === 'event' ? 'event-b' : 'event-a',
          change === 'viewer' ? 'new-viewer' : 'viewer'
        )}
      />
    );
    expect(screen.queryByText('Original Union')).toBeNull();
    expect(screen.getByText('Loading Participating Clubs')).toBeTruthy();
  }
);
it('aborts an unmounted request without reporting an error', async () => {
  api.read.mockImplementation(() => new Promise(() => {}));
  const mounted = render(<UnionsTab {...props()} />);
  await flush();
  mounted.unmount();
  await flush();
  expect(api.signals.some((s) => s.aborted)).toBe(true);
  expect(api.report).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps the existing roster when a newcomer read stalls', async () => {
  const mounted = render(<UnionsTab {...props()} />);
  await flush();
  api.read.mockImplementation(() => new Promise(() => {}));
  const next = props();
  next.entries = [
    ...next.entries,
    {
      id: 'new-entry',
      user_id: 'new-player',
      username: 'New Player',
      status: 'playing',
      chips: 50,
    },
  ];
  mounted.rerender(<UnionsTab {...next} />);
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(screen.getByText('Original Union')).toBeTruthy();
  expect(screen.queryByText('Could Not Load The Participating Clubs')).toBeNull();
});
it('does not publish a late timed-out roster', async () => {
  let resolve!: (value: unknown) => void;
  api.read.mockImplementation((t) =>
    t === 'unions'
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(good(t))
  );
  render(<UnionsTab {...props()} />);
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  await act(async () => {
    resolve({ data: { name: 'Late Union' }, error: null });
  });
  expect(screen.queryByText('Late Union')).toBeNull();
  expect(screen.getByText('Could Not Load The Participating Clubs')).toBeTruthy();
});
it('bounds the fallback membership read', async () => {
  api.read.mockImplementation((t) =>
    t === 'tournament_players'
      ? Promise.resolve({ data: [], error: null })
      : t === 'club_members'
        ? new Promise(() => {})
        : Promise.resolve(good(t))
  );
  render(<UnionsTab {...props()} />);
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(screen.getByText('Could Not Load The Participating Clubs')).toBeTruthy();
});
