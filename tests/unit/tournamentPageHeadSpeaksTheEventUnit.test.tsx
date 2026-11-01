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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  broadcasts: new Map<string, (payload: any) => void>(),
}));

/** Any supabase chain, awaited, answers "nothing": this page's side reads are not under test. */
vi.mock('../../src/lib/supabase', () => {
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_target, prop) =>
        prop === 'then'
          ? (resolve: (value: unknown) => void) => resolve({ data: null, error: null })
          : () => chain(),
      apply: () => chain(),
    });
  return { supabase: chain() };
});
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: {
    getTournaments: vi.fn(async () => state.rows),
    getTournament: vi.fn(async () => null),
    getCurrentLevelState: vi.fn(() => null),
    canRebuy: vi.fn(() => false),
    canAddOn: vi.fn(() => false),
    quoteFromTournament: vi.fn(() => null),
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
  useTournamentRegistration: () => ({ register: vi.fn(), isRegistering: false }),
}));
vi.mock('../../src/components/club/CreateTournamentModal', () => ({ default: () => null }));
vi.mock('../../src/utils/observeTable', () => ({ openTableAsObserver: vi.fn() }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import TournamentPage from '../../src/pages/TournamentPage';
import { tournamentService } from '../../src/services/TournamentService';

afterEach(() => {
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
