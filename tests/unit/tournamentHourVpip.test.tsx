import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentHourVpip } from '../../src/components/table/TournamentHourVpip';
import {
  readTournamentHourVpip,
  tournamentHourVpip,
} from '../../src/services/readTournamentHourVpip';

const state = vi.hoisted(() => ({
  now: Date.parse('2026-11-01T02:00:00Z'),
  user: 'hero',
  response: {
    data: [] as Array<{ played_at: string; vpip: boolean }>,
    count: 0,
    error: null as Error | null,
  },
  calls: [] as unknown[][],
  listener: () => {},
  stop: vi.fn(),
  hold: null as Promise<void> | null,
}));
vi.mock('../../src/utils/serverClock', () => ({ serverNow: () => state.now }));
vi.mock('../../src/lib/authUtils', () => ({ readLocalSession: () => ({ userId: state.user }) }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: (_: string, listener: () => void) => {
    state.listener = listener;
    return state.stop;
  },
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      state.calls.push(['from', table]);
      const query: any = {};
      for (const method of ['select', 'eq', 'gte', 'lte', 'gt', 'limit', 'abortSignal']) {
        query[method] = (...args: unknown[]) => {
          state.calls.push([method, ...args]);
          return query;
        };
      }
      query.then = (
        resolve: (value: typeof state.response) => unknown,
        reject: (error: unknown) => unknown
      ) => {
        const response = state.response;
        return Promise.resolve(state.hold)
          .then(() => response)
          .then(resolve, reject);
      };
      return query;
    },
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  state.now = Date.parse('2026-11-01T02:00:00Z');
  state.user = 'hero';
  state.calls = [];
  state.response = { data: [], count: 0, error: null };
  state.stop.mockClear();
  state.hold = null;
});
afterEach(() => vi.useRealTimers());

describe('own tournament last-hour VPIP', () => {
  it('ends a hung initial read and accepts the next real standings event', async () => {
    state.hold = new Promise<void>(() => {});
    render(<TournamentHourVpip tournamentId="event" userId="hero" />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(12000));
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(
      (state.calls.find((call) => call[0] === 'abortSignal')?.[1] as AbortSignal).aborted
    ).toBe(true);
    expect(state.calls.filter((call) => call[0] === 'from')).toHaveLength(1);
    state.hold = null;
    await act(async () => state.listener());
    expect(screen.getByText('No Recorded Hands')).toBeTruthy();
  });
  it('retires a hung refresh and never publishes its late reply', async () => {
    render(<TournamentHourVpip tournamentId="event" userId="hero" />);
    await act(async () => {});
    let release!: () => void;
    state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.response = {
      data: [{ played_at: '2026-11-01T01:30:00Z', vpip: true }],
      count: 1,
      error: null,
    };
    await act(async () => state.listener());
    await act(async () => vi.advanceTimersByTimeAsync(12000));
    expect(screen.getByText('Unavailable')).toBeTruthy();
    await act(async () => release());
    expect(screen.queryByText('100.0%')).toBeNull();
  });

  it('rejects late replies after changing tournament and rereads invalidations during a read', async () => {
    let release!: () => void;
    state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.response = {
      data: [{ played_at: '2026-11-01T01:30:00Z', vpip: true }],
      count: 1,
      error: null,
    };
    const view = render(<TournamentHourVpip tournamentId="old" userId="hero" />);
    state.hold = null;
    state.response = { data: [], count: 0, error: null };
    view.rerender(<TournamentHourVpip tournamentId="new" userId="hero" />);
    await act(async () => {});
    await act(async () => release());
    expect(screen.getByText('No Recorded Hands')).toBeTruthy();
    expect(screen.queryByText('100.0%')).toBeNull();

    state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await act(async () => state.listener());
    state.response = {
      data: [{ played_at: '2026-11-01T01:30:00Z', vpip: false }],
      count: 1,
      error: null,
    };
    await act(async () => state.listener());
    state.hold = null;
    await act(async () => release());
    expect(screen.getByText('0.0%')).toBeTruthy();
    expect(screen.getByText('1 Settled Hand')).toBeTruthy();
  });
  it('uses exact timestamp boundaries, own identity, dealt hands and complete sample', async () => {
    expect(await readTournamentHourVpip('event', 'other', state.now)).toBeNull();
    expect(state.calls).toEqual([]);
    expect(await readTournamentHourVpip('event', 'hero', state.now)).toEqual([]);
    expect(state.calls).toEqual(
      expect.arrayContaining([
        ['from', 'ca_hand_facts'],
        ['eq', 'user_id', 'hero'],
        ['eq', 'tournament_id', 'event'],
        ['gte', 'seat', 1],
        ['lte', 'seat', 10],
        ['gte', 'players_dealt', 2],
        ['gt', 'played_at', '2026-11-01T01:00:00.000Z'],
        ['lte', 'played_at', '2026-11-01T02:00:00.000Z'],
      ])
    );
    state.response.count = 1001;
    expect(await readTournamentHourVpip('event', 'hero', state.now)).toBeNull();
  });

  it('excludes expired and future hands without rounding the denominator', () => {
    const result = tournamentHourVpip(
      [
        { played_at: '2026-11-01T01:00:00Z', vpip: true },
        { played_at: '2026-11-01T01:00:01Z', vpip: true },
        { played_at: '2026-11-01T01:30:00Z', vpip: false },
        { played_at: '2026-11-01T02:00:00Z', vpip: false },
        { played_at: '2026-11-01T02:00:01Z', vpip: true },
      ],
      state.now
    );
    expect(result.hands).toBe(3);
    expect(result.percent?.toFixed(1)).toBe('33.3');
    expect(result.expiresAt).toBe(state.now + 1000);
  });

  it('expires hands during the break and refreshes from the shared recovery feed', async () => {
    state.response = {
      data: [
        { played_at: '2026-11-01T01:00:01Z', vpip: true },
        { played_at: '2026-11-01T01:30:00Z', vpip: false },
      ],
      count: 2,
      error: null,
    };
    const view = render(<TournamentHourVpip tournamentId="event" userId="hero" />);
    expect(screen.getByText('Loading...')).toBeTruthy();
    await act(async () => {});
    expect(screen.getByText('50.0%')).toBeTruthy();
    expect(screen.getByText('2 Settled Hands')).toBeTruthy();
    state.now += 1000;
    await act(async () => vi.advanceTimersByTime(1000));
    expect(screen.getByText('0.0%')).toBeTruthy();
    state.response = { data: [], count: 0, error: new Error('Offline') };
    await act(async () => state.listener());
    expect(screen.getByText('Unavailable')).toBeTruthy();
    state.response.error = null;
    await act(async () => state.listener());
    expect(screen.getByText('No Recorded Hands')).toBeTruthy();
    view.unmount();
    expect(state.stop).toHaveBeenCalledOnce();
  });
});
