import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TournamentBreakScreen from '../../src/components/table/TournamentBreakScreen';

const state = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    user_id: string;
    username: string;
    chips: number;
    status: string;
    add_on?: boolean;
  }>,
  total: 73,
  level: 2,
  snapshot: null as unknown,
  structure: [] as unknown,
  error: false,
  queries: 0,
  hold: null as Promise<void> | null,
  metadataHold: null as Promise<void> | null,
  listeners: new Map<string, () => void>(),
  purchaseSignal: null as null | (() => void),
  purchaseStatus: null as null | ((status: string) => void),
  subscribers: new Map<string, Set<() => void>>(),
}));
vi.mock('../../src/hooks/useMasterBusBroadcastChannel', () => ({
  useMasterBusBroadcastChannel: (options: any) => {
    state.purchaseSignal = options.onPayload;
    state.purchaseStatus = options.onSubscriptionStatus;
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  // Several readers share one event feed (the card and its VPIP row), so the
  // fake fans each event out to every subscriber exactly like the real one.
  subscribeTournamentStandings: (id: string, listener: () => void) => {
    const subscribers = (state.subscribers.get(id) ?? new Set<() => void>()).add(listener);
    state.subscribers.set(id, subscribers);
    state.listeners.set(id, () => subscribers.forEach((fn) => fn()));
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) {
        state.subscribers.delete(id);
        state.listeners.delete(id);
      }
    };
  },
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let cursor = '';
      let limit = 1000;
      let statuses: string[] | null = null;
      const query: any = {
        select: () => query,
        abortSignal: () => query,
        eq: () => query,
        order: () => query,
        gt: (_: string, id: string) => {
          cursor = id;
          return query;
        },
        in: (_: string, values: string[]) => {
          statuses = values;
          return query;
        },
        limit: (value: number) => {
          limit = value;
          return query;
        },
        maybeSingle: async () => {
          await state.metadataHold;
          return {
            data: {
              current_level: state.level,
              blind_level_state: state.snapshot,
              blind_structure: state.structure,
              prize_pool: 1700,
              current_players: state.total,
            },
            error: null,
          };
        },
        then: (resolve: any, reject: any) => {
          state.queries++;
          const rows = state.rows.filter(
            (r) => (!statuses || statuses.includes(r.status)) && r.id > cursor
          );
          const result = state.error
            ? { data: null, error: new Error('Unavailable') }
            : { data: rows.slice(0, limit), count: rows.length, error: null };
          const hold = state.hold;
          return Promise.resolve(hold)
            .then(() => result)
            .then(resolve, reject);
        },
      };
      return query;
    },
  },
}));
const props = {
  isVisible: true,
  tournamentId: 'event',
  heroUserId: '72',
  tournamentName: 'Afternoon Deep Stack',
  breakTimeRemaining: 300,
  nextLevel: { level: 3, smallBlind: 50, bigBlind: 100 },
};
const players = () => document.querySelector('.break-screen__stat-value')?.textContent;
const hero = () => document.querySelector('.break-screen__my-rank')?.textContent;
const flush = async () => {
  await act(async () => {});
};
beforeEach(() => {
  state.total = 73;
  state.level = 2;
  state.snapshot = null;
  state.structure = [
    { smallBlind: 25, bigBlind: 50 },
    { smallBlind: 50, bigBlind: 100 },
    { smallBlind: 100, bigBlind: 200, ante: 20 },
  ];
  state.error = false;
  state.hold = null;
  state.metadataHold = null;
  state.queries = 0;
  state.listeners.clear();
  state.subscribers.clear();
  state.rows = Array.from({ length: 73 }, (_, i) => ({
    id: String(i).padStart(4, '0'),
    user_id: String(i),
    username: `Player ${i}`,
    chips: i === 72 ? 9500 : 25000,
    status: 'playing',
  }));
});

describe('live break standings', () => {
  it('counts confirmed add-ons across all tables and refreshes on purchase and reconnect', async () => {
    state.rows[0].add_on = true;
    render(<TournamentBreakScreen {...props} addOnNotice={{ cost: 35, chips: 20000 }} />);
    await flush();
    expect(screen.getByLabelText('Players Who Took Add-On')).toHaveTextContent('1');
    state.rows[72].add_on = true;
    await act(async () => state.purchaseSignal?.());
    expect(screen.getByLabelText('Players Who Took Add-On')).toHaveTextContent('2');
    // Replayed delivery reads the same committed rows, never increments twice.
    await act(async () => state.purchaseSignal?.());
    expect(screen.getByLabelText('Players Who Took Add-On')).toHaveTextContent('2');
    state.rows[71].add_on = true;
    await act(async () => state.purchaseStatus?.('SUBSCRIBED'));
    expect(screen.getByLabelText('Players Who Took Add-On')).toHaveTextContent('3');
    state.error = true;
    await act(async () => state.purchaseSignal?.());
    expect(screen.getByLabelText('Players Who Took Add-On')).toHaveTextContent('N/A');
  });

  it('shows Your VPIP only to an entrant of this event, never to a rail watcher', async () => {
    const view = render(<TournamentBreakScreen {...props} heroUserId="spectator" />);
    await flush();
    expect(players()).toBe('73');
    expect(screen.queryByLabelText('Your VPIP (Last Hour)')).toBeNull();
    view.rerender(<TournamentBreakScreen {...props} />);
    await flush();
    expect(screen.getByLabelText('Your VPIP (Last Hour)')).toBeTruthy();
    state.rows = state.rows.map((r) => (r.user_id === '72' ? { ...r, status: 'moving' } : r));
    await act(async () => state.listeners.get('event')!());
    expect(screen.getByLabelText('Your VPIP (Last Hour)')).toBeTruthy();
  });

  it('updates 73 to 72 during the open break, including rank, average and leaders', async () => {
    render(<TournamentBreakScreen {...props} />);
    await flush();
    expect(players()).toBe('73');
    expect(hero()).toContain('#73');
    state.total = 72; // This legacy counter drains; it is not the entrant total.
    state.rows = state.rows.map((r, i) =>
      i === 0 ? { ...r, status: 'eliminated', chips: 0 } : i === 1 ? { ...r, chips: 50000 } : r
    );
    await act(async () => state.listeners.get('event')!());
    expect(players()).toBe('72');
    expect(hero()).toContain('#72');
    expect(screen.getByText('Of 73')).toBeVisible();
    expect(document.querySelector('.break-screen__stat-value[title]')).toHaveAttribute(
      'title',
      '25,131'
    );
    expect(document.querySelector('.break-screen__leader-name')).toHaveTextContent('Player 1');
  });

  it('reads the complete field beyond both 500 and the API page size', async () => {
    state.total = 1201;
    state.rows = Array.from({ length: 1201 }, (_, i) => ({
      id: String(i).padStart(4, '0'),
      user_id: String(i),
      username: `Player ${i}`,
      chips: i === 1200 ? 90000 : 1000,
      status: 'playing',
    }));
    render(<TournamentBreakScreen {...props} heroUserId="1200" />);
    await flush();
    expect(players()).toBe('1201');
    expect(hero()).toContain('#1');
    expect(document.querySelector('.break-screen__leader-name')).toHaveTextContent('Player 1200');
    expect(state.queries).toBe(2);
  });

  it('coalesces events during a read and finishes with the fresh trailing answer', async () => {
    let release!: () => void;
    state.hold = new Promise<void>((r) => {
      release = r;
    });
    render(<TournamentBreakScreen {...props} />);
    await flush();
    state.rows = state.rows.slice(1);
    state.hold = null;
    await act(async () => {
      state.listeners.get('event')!();
      state.listeners.get('event')!();
      release();
    });
    expect(players()).toBe('72');
    expect(state.queries).toBe(2);
  });

  it('paints each successful add-on count during a continuous event burst', async () => {
    let release!: () => void;
    state.rows[0].add_on = true;
    state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<TournamentBreakScreen {...props} addOnNotice={{ cost: 35, chips: 20000 }} />);
    await flush();
    for (let count = 1; count <= 3; count++) {
      const finish = release;
      state.hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      await act(async () => {
        state.purchaseSignal?.();
        state.purchaseSignal?.();
        finish();
      });
      expect(screen.getByLabelText('Players Who Took Add-On')).toHaveTextContent(String(count));
      state.rows[count].add_on = true;
    }
    state.hold = null;
    await act(async () => {
      state.purchaseSignal?.();
      release();
    });
    expect(screen.getByLabelText('Players Who Took Add-On')).toHaveTextContent('4');
  });

  it('refreshes at the last-hand/countdown transition and drops old-owner responses', async () => {
    const view = render(<TournamentBreakScreen {...props} phase="last_hand" />);
    await flush();
    state.rows = state.rows.slice(1);
    view.rerender(<TournamentBreakScreen {...props} phase="counting_down" />);
    await flush();
    expect(players()).toBe('72');
    let release!: () => void;
    state.hold = new Promise<void>((r) => {
      release = r;
    });
    await act(async () => state.listeners.get('event')!());
    state.hold = null;
    state.rows = [];
    view.rerender(<TournamentBreakScreen {...props} tournamentId="other" />);
    await flush();
    await act(async () => release());
    expect(players()).toBe('0');
    expect(screen.queryByText('Your Status')).toBeNull();
    expect(state.listeners.has('event')).toBe(false);
    view.unmount();
    expect(state.listeners.size).toBe(0);
  });

  it('shows unavailable after a failed refresh, then recovers on the next event', async () => {
    render(<TournamentBreakScreen {...props} />);
    await flush();
    state.error = true;
    await act(async () => state.listeners.get('event')!());
    expect(players()).toBe('N/A');
    expect(screen.queryByText('Your Status')).toBeNull();
    expect(screen.getByText('Standings Unavailable')).toBeVisible();
    state.error = false;
    state.rows = state.rows.slice(1);
    await act(async () => state.listeners.get('event')!());
    expect(players()).toBe('72');
    expect(screen.queryByText('Standings Unavailable')).toBeNull();
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('releases unreadable metadata and can refresh on a later committed event', async () => {
  vi.useFakeTimers();
  state.metadataHold = new Promise(() => {});
  render(<TournamentBreakScreen {...props} />);
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(screen.getByText('Standings Unavailable')).toBeVisible();
  state.metadataHold = null;
  await act(async () => {
    state.listeners.get('event')!();
  });
  expect(players()).toBe('73');
});

it('performs the pending committed-event read after metadata times out', async () => {
  vi.useFakeTimers();
  state.metadataHold = new Promise(() => {});
  const view = render(<TournamentBreakScreen {...props} />);
  await flush();
  state.metadataHold = null;
  state.rows = state.rows.slice(1);
  await act(async () => {
    state.listeners.get('event')!();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(players()).toBe('72');
  expect(screen.queryByText('Loading Standings')).toBeNull();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it('retires a hung metadata deadline when the break closes', async () => {
  vi.useFakeTimers();
  state.metadataHold = new Promise(() => {});
  const view = render(<TournamentBreakScreen {...props} />);
  await flush();
  view.unmount();
  await flush();
  expect(vi.getTimerCount()).toBe(0);
  expect(state.listeners.size).toBe(0);
});

describe('authoritative paused tournament blinds', () => {
  it('shows committed add-on blinds instead of stale hourly payload and refreshes on recovery', async () => {
    state.snapshot = { index: 2, small_blind: 150, big_blind: 300, ante: 30 };
    render(<TournamentBreakScreen {...props} addOnNotice={{ cost: 15, chips: 20000 }} />);
    await flush();
    expect(document.querySelector('.break-screen__blind-value')).toHaveTextContent('150 / 300');
    expect(document.querySelector('.break-screen__ante')).toHaveTextContent('30');
    state.level = 3;
    state.snapshot = { index: 3, small_blind: 200, big_blind: 400, ante: 40 };
    await act(async () => state.listeners.get('event')!());
    expect(document.querySelector('.break-screen__blind-value')).toHaveTextContent('200 / 400');
    expect(screen.getByText('Coming Next: Level 4')).toBeVisible();
  });
  it('uses the exact legacy schedule index but refuses mismatched snapshots and invented overflow', async () => {
    state.structure = JSON.stringify(state.structure);
    render(<TournamentBreakScreen {...props} />);
    await flush();
    expect(document.querySelector('.break-screen__blind-value')).toHaveTextContent('100 / 200');
    state.snapshot = { index: 1, small_blind: 50, big_blind: 100, ante: 0 };
    await act(async () => state.listeners.get('event')!());
    expect(document.querySelector('.break-screen__blind-value')).toHaveTextContent('N/A');
    expect(document.querySelector('.break-screen__my-stack small')).toHaveTextContent('N/A');
    state.snapshot = null;
    state.level = 30;
    await act(async () => state.listeners.get('event')!());
    expect(document.querySelector('.break-screen__blind-value')).toHaveTextContent('N/A');
    state.error = true;
    await act(async () => state.listeners.get('event')!());
    expect(document.querySelector('.break-screen__blind-value')).toHaveTextContent('N/A');
  });
});
