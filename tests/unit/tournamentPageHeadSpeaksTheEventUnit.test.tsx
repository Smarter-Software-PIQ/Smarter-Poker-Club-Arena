/**
 * THE TOURNAMENT PAGE'S BOUNTY AND PKO ROWS SPEAK THE EVENT'S UNIT (2026-09-21).
 *
 * Both rows printed `money(...)` followed by the word "Chips" whatever the
 * event was, so a Diamond bounty event advertised a Chip head on the arena's
 * own tournaments page. A chip event reads exactly as it did; a Diamond event
 * reads whole Diamonds and says so. The unit comes off the row's own arena
 * embed through `tournamentRowUnitCents`, the reading the rest of this page
 * already prices its ladders through.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  register: vi.fn(),
  owner: false,
  rebuy: false,
  addon: false,
  playing: false,
  readMembership: null as null | (() => any),
  tableReads: [] as Array<{ id: string; signal?: AbortSignal }>,
  readTables: (_id: string, _signal?: AbortSignal): any => ({ data: [], error: null }),
  broadcasts: new Map<string, (payload: any) => void>(),
}));

/** Any supabase chain, awaited, answers "nothing": this page's side reads are not under test. */
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (relation: string) => {
      let id = '';
      let signal: AbortSignal | undefined;
      let projection = '';
      const chain: any = new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'then')
              return (resolve: any, reject: any) => {
                let result: any = { data: null, error: null };
                if (relation === 'club_members' && projection === 'role')
                  result.data = state.owner ? { role: 'owner' } : null;
                if (relation === 'tournament_players') {
                  result.data = state.playing ? { status: 'playing' } : null;
                  if (projection === 'id' && state.readMembership) result = state.readMembership();
                }
                if (relation === 'tables') {
                  state.tableReads.push({ id, signal });
                  result = state.readTables(id, signal);
                }
                return Promise.resolve(result).then(resolve, reject);
              };
            return (...args: any[]) => {
              if (prop === 'select') projection = args[0];
              if (prop === 'eq' && args[0] === 'tournament_id') id = args[1];
              if (prop === 'abortSignal') signal = args[0];
              return chain;
            };
          },
        }
      );
      return chain;
    },
  },
}));
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: {
    getTournaments: vi.fn(async () => state.rows),
    getTournament: vi.fn(async () => null),
    getCurrentLevelState: vi.fn(() => null),
    canRebuy: vi.fn(async () => ({ allowed: state.rebuy })),
    canAddOn: vi.fn(async () => ({ allowed: state.addon })),
    quoteFromTournament: vi.fn(() => ({ totalCost: 10 })),
    startTournament: vi.fn(),
    processRebuy: vi.fn(),
    processAddOn: vi.fn(),
    unregisterPlayer: vi.fn(),
  },
  tournamentUnregisterSuccessText: () => '',
}));
vi.mock('../../src/core/MasterBus', () => {
  const channel = {
    state: 'joined',
    on: () => channel,
    subscribe: () => channel,
  };
  return {
    masterBus: {
      emit: vi.fn(),
      subscribe: () => () => {},
      subscribeDebounced: () => () => {},
      getOrCreateChannel: (key: string) => ({
        ...channel,
        on: (kind: string, _filter: unknown, callback: (payload: any) => void) => {
          if (kind === 'broadcast') state.broadcasts.set(key, callback);
          return channel;
        },
      }),
      removeRegisteredChannel: vi.fn(),
    },
  };
});
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'user-1', username: 'Player' } }),
}));
vi.mock('../../src/services/TableService', () => ({ tableService: {} }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('../../src/utils/clubIdResolver', () => ({ resolveClubUUID: async (id: string) => id }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('../../src/components/tournament/TournamentClock', () => ({ TournamentClock: () => null }));
vi.mock('../../src/components/tournament/details/RankingTab', () => ({ default: () => null }));
vi.mock('../../src/hooks/useTournamentEntries', () => ({
  useTournamentEntries: () => ({
    entries: [],
    entryCount: 0,
    loading: false,
    loadFailed: false,
    refresh: vi.fn(),
  }),
}));
vi.mock('../../src/hooks/useMysteryBounty', () => ({
  useMysteryBounty: () => ({
    inventory: null,
    awards: [],
    awardsTotal: 0,
    leaderboard: [],
    isLoading: false,
    pendingReveals: 0,
    refresh: vi.fn(),
  }),
}));
vi.mock('../../src/components/tournament/MysteryBountyPanel', () => ({ default: () => null }));
vi.mock('../../src/components/tournament/MysteryBountyChest', () => ({ default: () => null }));
vi.mock('../../src/services/tournamentEventBridge', () => ({ relayTournamentEvent: vi.fn() }));
vi.mock('../../src/hooks/useTournamentRegistration', () => ({
  useTournamentRegistration: () => ({ register: state.register, isRegistering: false }),
}));
vi.mock('../../src/components/club/CreateTournamentModal', () => ({ default: () => null }));
vi.mock('../../src/utils/observeTable', () => ({ openTableAsObserver: vi.fn() }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import TournamentPage from '../../src/pages/TournamentPage';
import { tournamentService } from '../../src/services/TournamentService';

beforeEach(() => {
  vi.mocked(tournamentService.unregisterPlayer).mockReset();
  vi.mocked(tournamentService.processRebuy).mockReset();
  vi.mocked(tournamentService.processAddOn).mockReset();
  vi.mocked(tournamentService.startTournament).mockReset();
  state.owner = false;
  state.rebuy = false;
  state.addon = false;
  state.playing = false;
  state.readMembership = null;
  state.tableReads = [];
  state.readTables = () => ({ data: [], error: null });
  state.register.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  sessionStorage.clear();
  state.broadcasts.clear();
  vi.mocked(tournamentService.getTournament).mockReset();
});

const CHIP_CLUB = { id: 'club-1', asset: 'chips', is_platform: false, union_id: null };
const DIAMOND_ARENA = { id: 'club-1', asset: 'diamonds', is_platform: true, union_id: null };

function bountyEvent(arena: typeof CHIP_CLUB, pko: boolean) {
  return {
    id: 't-1',
    club_id: 'club-1',
    name: 'Head Hunter',
    status: 'REGISTERING',
    game_type: 'nlh',
    buy_in_amount: 100,
    buy_in_fee: 10,
    starting_chips: 10000,
    current_players: 4,
    max_players: 90,
    prize_pool: 400,
    is_bounty: true,
    is_pko: pko,
    is_mystery_bounty: false,
    bounty_amount: 25,
    payout_structure: [{ place: 1, percentage: 100 }],
    start_time: '2030-01-01T20:00:00.000Z',
    arena,
  };
}

/** Open the page on this event and return the value printed beside `label`. */
async function rowValue(row: ReturnType<typeof bountyEvent>, label: string) {
  state.rows = [row];
  render(
    <MemoryRouter initialEntries={['/clubs/club-1/tournaments/t-1']}>
      <Routes>
        <Route path="/clubs/:clubId/tournaments/:tournamentId" element={<TournamentPage />} />
      </Routes>
    </MemoryRouter>
  );
  const detail = await waitFor(() => {
    const section = document.querySelector('.tourn-detail');
    expect(section, 'the selected event must be on screen').not.toBeNull();
    return section as HTMLElement;
  });
  const labelEl = [...detail.querySelectorAll('.sc-label')].find((el) => el.textContent === label);
  expect(labelEl, `the ${label} row must be on screen`).toBeDefined();
  return labelEl!.parentElement!.querySelector('.tourn-value')!.textContent;
}

describe('the tournament page names the head in the event unit', () => {
  it('a chip bounty event prints its head exactly as before', async () => {
    expect(await rowValue(bountyEvent(CHIP_CLUB, false), 'Bounty')).toBe('25 Chips');
  });

  it('a chip PKO event prints its starting head exactly as before', async () => {
    expect(await rowValue(bountyEvent(CHIP_CLUB, true), 'PKO')).toBe('25 Chips Starting Bounty');
  });

  it('a Diamond bounty event prints whole Diamonds', async () => {
    expect(await rowValue(bountyEvent(DIAMOND_ARENA, false), 'Bounty')).toBe('25 Diamonds');
  });

  it('a Diamond PKO event prints its starting head in Diamonds', async () => {
    expect(await rowValue(bountyEvent(DIAMOND_ARENA, true), 'PKO')).toBe(
      '25 Diamonds Starting Bounty'
    );
    expect(screen.queryByText(/Chips Starting Bounty/)).toBeNull();
  });
});

describe('tournament detail refresh belongs to the selected event', () => {
  it.each(['level_up', 'player_eliminated', 'late_reg_closed', 'table_rebalance'])(
    'does not restore the previous event after a delayed %s refresh',
    async (type) => {
      const first = bountyEvent(CHIP_CLUB, false);
      const second = { ...first, id: 't-2', name: 'Second Event' };
      state.rows = [first, second];
      let finish!: (row: any) => void;
      vi.mocked(tournamentService.getTournament).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      render(
        <MemoryRouter initialEntries={['/clubs/club-1/tournaments/t-1']}>
          <Routes>
            <Route path="/clubs/:clubId/tournaments/:tournamentId" element={<TournamentPage />} />
          </Routes>
        </MemoryRouter>
      );
      await waitFor(() => expect(state.broadcasts.has('t-break-t-1')).toBe(true));
      act(() => state.broadcasts.get('t-break-t-1')!({ payload: { type, payload: {} } }));
      const cards = document.querySelectorAll('.tournament-card');
      fireEvent.click(cards[1]);
      await waitFor(() =>
        expect(document.querySelector('.tourn-detail')?.textContent).toContain('Second Event')
      );
      await act(async () => finish({ ...first, name: 'Old Event Refreshed' }));
      expect(document.querySelector('.tourn-detail')?.textContent).toContain('Second Event');
      expect(document.querySelector('.tourn-detail')?.textContent).not.toContain(
        'Old Event Refreshed'
      );
    }
  );
});

it.each(['same event', 'back to list', 'return to original event'])(
  'keeps broadcast refresh authority for %s',
  async (transition) => {
    const first = bountyEvent(CHIP_CLUB, false);
    state.rows = [first, { ...first, id: 't-2', name: 'Second Event' }];
    let finish!: (row: any) => void;
    vi.mocked(tournamentService.getTournament).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(
      <MemoryRouter initialEntries={['/clubs/club-1/tournaments/t-1']}>
        <Routes>
          <Route path="/clubs/:clubId/tournaments/:tournamentId" element={<TournamentPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(state.broadcasts.has('t-break-t-1')).toBe(true));
    act(() => state.broadcasts.get('t-break-t-1')!({ payload: { type: 'level_up', payload: {} } }));
    if (transition === 'back to list') {
      fireEvent.click(screen.getByRole('button', { name: 'Back To The Tournament List' }));
    } else if (transition === 'return to original event') {
      fireEvent.click(document.querySelectorAll('.tournament-card')[1]);
      await waitFor(() =>
        expect(document.querySelector('.tourn-detail')?.textContent).toContain('Second Event')
      );
      fireEvent.click(document.querySelectorAll('.tournament-card')[0]);
      await waitFor(() =>
        expect(document.querySelector('.tourn-detail')?.textContent).toContain('Head Hunter')
      );
    }
    await act(async () => finish({ ...first, name: 'Refreshed Original' }));
    if (transition === 'same event') {
      expect(document.querySelector('.tourn-detail')?.textContent).toContain('Refreshed Original');
    } else if (transition === 'back to list') {
      expect(document.querySelector('.tourn-detail')).toBeNull();
    } else {
      expect(document.querySelector('.tourn-detail')?.textContent).toContain('Head Hunter');
      expect(document.querySelector('.tourn-detail')?.textContent).not.toContain(
        'Refreshed Original'
      );
    }
  }
);

function mountActions(status = 'REGISTERING') {
  const first = {
    ...bountyEvent(CHIP_CLUB, false),
    status,
    format_contract: 'mtt-v1',
    is_rebuy: true,
    add_on_available: true,
  };
  state.rows = [first, { ...first, id: 't-2', name: 'Second Event' }];
  const view = render(
    <MemoryRouter initialEntries={['/clubs/club-1/tournaments/t-1']}>
      <Routes>
        <Route path="/clubs/:clubId/tournaments/:tournamentId" element={<TournamentPage />} />
      </Routes>
    </MemoryRouter>
  );
  return { first, view };
}
async function selectSecond() {
  fireEvent.click(document.querySelectorAll('.tournament-card')[1]);
  await waitFor(() =>
    expect(document.querySelector('.tourn-detail')?.textContent).toContain('Second Event')
  );
}

it.each(['register', 'start', 'rebuy', 'addon'])(
  'a completed %s action cannot restore a retired selection',
  async (action) => {
    state.owner = true;
    state.rebuy = true;
    state.addon = true;
    state.playing = action === 'rebuy' || action === 'addon';
    let finish!: (value: any) => void;
    const method =
      action === 'start' ? 'startTournament' : action === 'rebuy' ? 'processRebuy' : 'processAddOn';
    if (action !== 'register')
      vi.mocked(tournamentService[method]).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }) as any
      );
    const { first } = mountActions(state.playing ? 'RUNNING' : 'REGISTERING');
    vi.mocked(tournamentService.getTournament).mockResolvedValue({
      ...first,
      name: 'Retired Action Answer',
    } as any);
    const button = await screen.findByRole('button', {
      name:
        action === 'register'
          ? /^Register/
          : action === 'start'
            ? 'Start Tournament'
            : action === 'rebuy'
              ? /^Rebuy/
              : /^Add-On/,
    });
    fireEvent.click(button);
    await selectSecond();
    await act(async () => {
      if (action === 'register') await state.register.mock.calls[0][1]();
      else finish({ success: true, newStack: 100 });
    });
    expect(document.querySelector('.tourn-detail')?.textContent).toContain('Second Event');
    expect(document.querySelector('.tourn-detail')?.textContent).not.toContain(
      'Retired Action Answer'
    );
  }
);

it('does not invent a second entrant when realtime already advanced before registration completion', async () => {
  const { first } = mountActions();
  fireEvent.click(await screen.findByRole('button', { name: /^Register/ }));
  const committed = { ...first, current_players: 5, prize_pool: 500, name: 'Authoritative Event' };
  vi.mocked(tournamentService.getTournament).mockResolvedValue(committed as any);
  // The registration button can paint before the selected event's effect subscribes.
  // Admit the event only after this real component installs its broadcast consumer.
  await waitFor(() => expect(state.broadcasts.get('t-break-t-1')).toEqual(expect.any(Function)));
  await act(async () =>
    state.broadcasts.get('t-break-t-1')!({ payload: { type: 'level_up', payload: {} } })
  );
  await waitFor(() =>
    expect(document.querySelector('.tourn-detail')?.textContent).toContain('Authoritative Event')
  );
  await act(async () => {
    await state.register.mock.calls[0][1]();
  });
  expect(document.querySelector('.tourn-detail')?.textContent).toContain('Authoritative Event');
  expect(vi.mocked(tournamentService.getTournament)).toHaveBeenCalledTimes(2);
  const entryRow = Array.from(document.querySelectorAll('.tourn-detail .tourn-row')).find((row) =>
    row.textContent?.startsWith('Entries')
  );
  expect(entryRow?.querySelector('.tourn-value')?.textContent).toBe('5');
});

it('masks the previous table roster while the next event read is pending', async () => {
  state.readTables = (id) =>
    id === 't-1'
      ? { data: [{ id: 'table-a', name: 'First Event Table' }], error: null }
      : new Promise(() => {});
  mountActions('RUNNING');
  await screen.findByText('First Event Table');
  await selectSecond();
  expect(screen.queryByText('First Event Table')).toBeNull();
  expect(screen.queryByText('Waiting For The First Deal.')).toBeNull();
  expect(screen.getByText('Loading The Tables.')).toBeInTheDocument();
});

it.each(['return', 'unmount'])('retires registration ownership on %s', async (destination) => {
  const { first, view } = mountActions();
  fireEvent.click(await screen.findByRole('button', { name: /^Register/ }));
  const completed = state.register.mock.calls[0][1];
  await selectSecond();
  if (destination === 'return') fireEvent.click(document.querySelectorAll('.tournament-card')[0]);
  else view.unmount();
  vi.mocked(tournamentService.getTournament).mockClear();
  vi.mocked(tournamentService.getTournament).mockResolvedValue({
    ...first,
    name: 'Retired Registration',
  } as any);
  await act(async () => {
    await completed();
  });
  expect(tournamentService.getTournament).not.toHaveBeenCalled();
  expect(screen.queryByText('Retired Registration')).toBeNull();
});

it('bounds the read after a committed rebuy without repeating the purchase', async () => {
  state.rebuy = true;
  state.playing = true;
  vi.mocked(tournamentService.processRebuy).mockResolvedValue({
    success: true,
    newStack: 100,
  } as any);
  let signal: AbortSignal | undefined;
  vi.mocked(tournamentService.getTournament).mockImplementation((_id, options) => {
    signal = options?.signal;
    return new Promise(() => {});
  });
  mountActions('RUNNING');
  const button = await screen.findByRole('button', { name: /^Rebuy/ });
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(button);
  });
  expect(tournamentService.processRebuy).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000);
  });
  expect(signal?.aborted).toBe(true);
  expect(tournamentService.processRebuy).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.tourn-detail')?.textContent).toContain('Head Hunter');
  expect(screen.queryByRole('button', { name: 'Processing...' })).toBeNull();
});

it('ends an unanswered table read as unknown and aborts retired event reads', async () => {
  state.readTables = () => new Promise(() => {});
  vi.useFakeTimers();
  const { view } = mountActions('RUNNING');
  await act(async () => {});
  expect(screen.getByText('Loading The Tables.')).toBeInTheDocument();
  expect(state.tableReads).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000);
  });
  expect(state.tableReads[0].signal?.aborted).toBe(true);
  expect(screen.getByText('Table Availability Is Unknown.')).toBeInTheDocument();
  expect(screen.queryByText('No Tables Running Yet.')).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8_000);
  });
  expect(state.tableReads).toHaveLength(2);
  view.unmount();
  expect(state.tableReads[1].signal?.aborted).toBe(true);
});

it('a retired rebuy cannot clear the next offer token or its processing owner', async () => {
  state.rebuy = true;
  state.playing = true;
  const finish: Array<(value: any) => void> = [];
  vi.mocked(tournamentService.processRebuy).mockImplementation(
    () => new Promise((resolve) => finish.push(resolve)) as any
  );
  mountActions('RUNNING');
  fireEvent.click(await screen.findByRole('button', { name: /^Rebuy/ }));
  await selectSecond();
  fireEvent.click(await screen.findByRole('button', { name: /^Rebuy/ }));
  expect(tournamentService.processRebuy).toHaveBeenCalledTimes(2);
  const secondToken = vi.mocked(tournamentService.processRebuy).mock.calls[1][2];
  await act(async () => {
    finish[0]({ success: true, newStack: 100 });
  });
  expect(screen.getByRole('button', { name: /Processing/i })).toBeDisabled();
  await act(async () => {
    finish[1]({ success: false });
  });
  fireEvent.click(screen.getByRole('button', { name: /^Rebuy/ }));
  expect(vi.mocked(tournamentService.processRebuy).mock.calls[2][2]).toBe(secondToken);
  expect(secondToken).not.toBe(vi.mocked(tournamentService.processRebuy).mock.calls[0][2]);
  await act(async () => {
    finish[2]({ success: false });
  });
});

it('keeps known same-event tables on failed refresh without restarting the read on each event update', async () => {
  vi.useFakeTimers();
  let reads = 0;
  state.readTables = () =>
    ++reads === 1
      ? { data: [{ id: 'table-a', name: 'Known Table' }], error: null }
      : { data: null, error: new Error('offline') };
  const { first } = mountActions('RUNNING');
  await act(async () => {});
  expect(screen.getByText('Known Table')).toBeInTheDocument();
  vi.mocked(tournamentService.getTournament).mockResolvedValue({
    ...first,
    current_level: 2,
  } as any);
  await act(async () =>
    state.broadcasts.get('t-break-t-1')!({ payload: { type: 'level_up', payload: {} } })
  );
  expect(reads).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(reads).toBe(2);
  expect(screen.getByText('Known Table')).toBeInTheDocument();
  expect(screen.getByText('Tables Could Not Be Refreshed.')).toBeInTheDocument();
});

it('a delayed unregister cannot clear another event registration', async () => {
  state.playing = true;
  let finish!: (value: any) => void;
  vi.mocked(tournamentService.unregisterPlayer).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as any
  );
  mountActions();
  fireEvent.click(await screen.findByRole('button', { name: 'Unregister' }));
  await selectSecond();
  await screen.findByRole('button', { name: 'Unregister' });
  await act(async () => {
    finish({ success: true });
  });
  expect(screen.getByRole('button', { name: 'Unregister' })).toBeInTheDocument();
  expect(tournamentService.unregisterPlayer).toHaveBeenCalledTimes(1);
});

it('an add-on period broadcast cannot sell an add-on to a spectator', async () => {
  state.addon = true;
  mountActions('RUNNING');
  await waitFor(() => expect(state.broadcasts.has('t-break-t-1')).toBe(true));
  expect(screen.queryByRole('button', { name: /^Add-On/ })).toBeNull();
  await act(async () =>
    state.broadcasts.get('t-break-t-1')!({ payload: { type: 'ADDON_PERIOD_START', payload: {} } })
  );
  expect(screen.queryByRole('button', { name: /^Add-On/ })).toBeNull();
});

it('an add-on period broadcast admits a confirmed playing entrant', async () => {
  state.playing = true;
  mountActions('RUNNING');
  await act(async () => {});
  expect(screen.queryByRole('button', { name: /^Add-On/ })).toBeNull();
  state.addon = true;
  await act(async () =>
    state.broadcasts.get('t-break-t-1')!({ payload: { type: 'ADDON_PERIOD_START', payload: {} } })
  );
  expect(screen.getByRole('button', { name: /^Add-On/ })).toBeInTheDocument();
});

it.each(['end', 'selection'])(
  'a delayed add-on entitlement is retired by %s',
  async (destination) => {
    state.playing = true;
    mountActions('RUNNING');
    await act(async () => {});
    let finish!: (value: any) => void;
    vi.mocked(tournamentService.canAddOn).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await act(async () =>
      state.broadcasts.get('t-break-t-1')!({ payload: { type: 'ADDON_PERIOD_START', payload: {} } })
    );
    if (destination === 'end')
      await act(async () =>
        state.broadcasts.get('t-break-t-1')!({ payload: { type: 'ADDON_PERIOD_END', payload: {} } })
      );
    else await selectSecond();
    await act(async () => {
      finish({ allowed: true });
    });
    expect(screen.queryByRole('button', { name: /^Add-On/ })).toBeNull();
  }
);

it('an add-on end does not discard a pending rebuy eligibility answer', async () => {
  state.playing = true;
  let finish!: (value: any) => void;
  vi.mocked(tournamentService.canRebuy).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mountActions('RUNNING');
  await act(async () => {});
  await act(async () =>
    state.broadcasts.get('t-break-t-1')!({ payload: { type: 'ADDON_PERIOD_END', payload: {} } })
  );
  await act(async () => {
    finish({ allowed: true });
  });
  expect(screen.getByRole('button', { name: /^Rebuy/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Add-On/ })).toBeNull();
});

it.each(['register', 'unregister'])(
  'a stale membership read cannot reverse confirmed %s',
  async (action) => {
    let finish!: (value: any) => void;
    const pendingMembership = new Promise((resolve) => {
      finish = resolve;
    });
    const readMembership = vi.fn(() => pendingMembership);
    state.readMembership = readMembership;
    const { first } = mountActions();
    await waitFor(() => expect(readMembership).toHaveBeenCalledTimes(1));
    vi.mocked(tournamentService.getTournament).mockResolvedValue(first as any);
    fireEvent.click(await screen.findByRole('button', { name: /^Register/ }));
    await act(async () => {
      await state.register.mock.calls[0][1]();
    });
    expect(screen.getByRole('button', { name: 'Unregister' })).toBeInTheDocument();
    if (action === 'unregister') {
      vi.mocked(tournamentService.unregisterPlayer).mockResolvedValue({ success: true } as any);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Unregister' }));
      });
    }
    expect(readMembership).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ data: action === 'register' ? null : { id: 'old-entry' }, error: null });
    });
    expect(
      screen.getByRole('button', { name: action === 'register' ? 'Unregister' : /^Register/ })
    ).toBeInTheDocument();
  }
);
