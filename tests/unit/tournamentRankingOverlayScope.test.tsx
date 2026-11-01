import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TournamentTabProps } from '../../src/components/tournament/details/types';
const m = vi.hoisted(() => ({
  callbacks: new Map<string, (event: unknown) => void>(),
  watch: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    getOrCreateChannel: (key: string) => {
      const q = {
        on: (_kind: string, filter: { filter: string }, callback: (event: unknown) => void) => {
          m.callbacks.set(filter.filter.split('eq.')[1], callback);
          return q;
        },
        subscribe: () => q,
      };
      return q;
    },
    removeRegisteredChannel: vi.fn(),
  },
}));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({ useMasterBusSubscription: () => {} }));
vi.mock('../../src/components/tournament/details/useDownlineIds', () => ({
  useDownlineIds: () => ({ downlineIds: new Set(), carriesDownline: false }),
}));
vi.mock('../../src/components/tournament/details/useSatelliteAwards', () => ({
  useSatelliteAwards: () => ({ kindFor: () => null }),
  satelliteAwardLabel: () => '',
  satelliteAwardNotice: () => null,
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => ({ warning: m.warning }) }));
import RankingTab from '../../src/components/tournament/details/RankingTab';
const props = (id: string, chips = 100, table = 'one') =>
  ({
    tournament: { id, name: id, status: 'RUNNING', current_level: 0, prize_pool: 0 },
    entries: [
      {
        id: 'entry-' + id,
        user_id: 'same-player',
        username: 'Hero',
        chips,
        status: 'playing',
        table_id: table,
      },
    ],
    tables: ['one', 'two', 'three'].map((id, i) => ({
      id,
      name: 'Table ' + (i + 1),
      status: 'running',
      big_blind: 10,
    })),
    blindLevels: [],
    currentUserId: null,
    onWatchPlayer: m.watch,
  }) as unknown as TournamentTabProps;
const patch = (id: string, value: Record<string, unknown>) =>
  act(() =>
    m.callbacks.get(id)!({ eventType: 'UPDATE', new: { user_id: 'same-player', ...value } })
  );
beforeEach(() => {
  vi.useFakeTimers();
  m.callbacks.clear();
  m.watch.mockClear();
  m.warning.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('does not carry an applied overlay into another event with the same player', () => {
  const view = render(<RankingTab {...props('a')} />);
  patch('a', { chips: 200 });
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByRole('button', { name: 'Watch Hero, 200 Chips' })).toBeTruthy();
  view.rerender(<RankingTab {...props('b', 50)} />);
  expect(screen.getByRole('button', { name: 'Watch Hero, 50 Chips' })).toBeTruthy();
});
it('retires pending patches and pulses when the event changes', () => {
  const view = render(<RankingTab {...props('a')} />);
  patch('a', { chips: 200 });
  view.rerender(<RankingTab {...props('b', 50)} />);
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByRole('button', { name: 'Watch Hero, 50 Chips' })).toBeTruthy();
  expect(document.querySelector('.rk-row--moved')).toBeNull();
});
it('keeps a table-only patch until the parent table agrees', () => {
  const view = render(<RankingTab {...props('a')} />);
  patch('a', { table_id: 'two' });
  act(() => vi.advanceTimersByTime(250));
  view.rerender(<RankingTab {...props('a')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Watch Hero, 100 Chips' }));
  fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
  expect(m.watch).toHaveBeenCalledWith('two', 'Table 2', {
    tournamentId: 'a',
    userId: 'same-player',
    username: 'Hero',
  });
});

it('retires a table patch once props catch up, then accepts the next parent table', () => {
  const view = render(<RankingTab {...props('a')} />);
  patch('a', { table_id: 'two' });
  act(() => vi.advanceTimersByTime(250));
  view.rerender(<RankingTab {...props('a', 100, 'two')} />);
  view.rerender(<RankingTab {...props('a', 100, 'three')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Watch Hero, 100 Chips' }));
  fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
  expect(m.watch).toHaveBeenCalledWith('three', 'Table 3', {
    tournamentId: 'a',
    userId: 'same-player',
    username: 'Hero',
  });
});
it('cannot apply a retired channel callback to the new event', () => {
  const view = render(<RankingTab {...props('a')} />);
  const retired = m.callbacks.get('a')!;
  view.rerender(<RankingTab {...props('b', 50)} />);
  act(() =>
    retired({
      eventType: 'UPDATE',
      new: { user_id: 'same-player', chips: 900, status: 'eliminated', position: 9 },
    })
  );
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByRole('button', { name: 'Watch Hero, 50 Chips' })).toBeTruthy();
  expect(screen.queryByText('Busted 9th')).toBeNull();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
