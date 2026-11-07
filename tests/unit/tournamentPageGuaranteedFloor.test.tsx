/**
 * THE ARENA TOURNAMENTS PAGE SHOWS EACH PROJECTED PLACE'S GUARANTEED MINIMUM
 * (2026-11-07).
 *
 * The owner's worked example: places 1,196, bounties 460, rake 184, GTD
 * 2,500, house share 660, guaranteed ladder pool 1,856. The Payouts ladder
 * on the selected event reads the same funding RPC through the shared hook
 * and prints the same floor RewardsTab prints for the same structure.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { placePrize } from '../../src/components/tournament/details/types';
import { CHIP_UNIT_CENTS } from '../../server/src/tournament/tournamentUnit';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  houseDue: 660 as number | null,
  rpcCalls: [] as string[],
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: any = new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'then')
              return (resolve: any, reject: any) =>
                Promise.resolve({ data: null, error: null }).then(resolve, reject);
            return () => chain;
          },
        }
      );
      return chain;
    },
    rpc: vi.fn((name: string, args: { p_tournament_id: string }) => {
      state.rpcCalls.push(name);
      return {
        abortSignal: () =>
          Promise.resolve({
            data: {
              tournament_id: args.p_tournament_id,
              collected: 1656,
              overlay: 660,
              gross_coverage: 1840,
              house_required: 660,
              house_posted: 0,
              house_due: state.houseDue,
            },
            error: null,
          }),
      };
    }),
  },
}));
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: {
    getTournaments: vi.fn(async () => state.rows),
    getTournament: vi.fn(async () => null),
    getCurrentLevelState: vi.fn(() => null),
    canRebuy: vi.fn(async () => ({ allowed: false })),
    canAddOn: vi.fn(async () => ({ allowed: false })),
    quoteFromTournament: vi.fn(() => ({ totalCost: 10 })),
    startTournament: vi.fn(),
    processRebuy: vi.fn(),
    processAddOn: vi.fn(),
    unregisterPlayer: vi.fn(),
  },
  tournamentUnregisterSuccessText: () => '',
}));
vi.mock('../../src/core/MasterBus', () => {
  const channel = { state: 'joined', on: () => channel, subscribe: () => channel };
  return {
    masterBus: {
      emit: vi.fn(),
      subscribe: () => () => {},
      subscribeDebounced: () => () => {},
      getOrCreateChannel: () => channel,
      removeRegisteredChannel: vi.fn(),
    },
  };
});
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: () => () => {},
}));
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
    entryCount: 46,
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

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  state.houseDue = 660;
  state.rpcCalls = [];
});

const STRUCTURE = [
  { place: 1, percentage: 50 },
  { place: 2, percentage: 30 },
  { place: 3, percentage: 20 },
];

function workedExample(over: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    club_id: 'club-1',
    name: '40 Chip Bounty Freezeout 2.5K',
    status: 'REGISTERING',
    game_type: 'nlh',
    buy_in_amount: 36,
    buy_in_fee: 4,
    starting_chips: 10000,
    current_players: 46,
    max_players: 200,
    prize_pool: 1196,
    bounty_pool: 460,
    total_rake: 184,
    guaranteed_prize: 2500,
    prize_pool_finalized: false,
    is_bounty: true,
    is_pko: false,
    is_mystery_bounty: false,
    bounty_amount: 10,
    payout_structure: STRUCTURE,
    start_time: '2030-01-01T20:00:00.000Z',
    arena: { id: 'club-1', asset: 'chips', is_platform: false, union_id: null },
    ...over,
  };
}

async function openPayouts(row: ReturnType<typeof workedExample>) {
  state.rows = [row];
  render(
    <MemoryRouter initialEntries={['/clubs/club-1/tournaments/t-1']}>
      <Routes>
        <Route path="/clubs/:clubId/tournaments/:tournamentId" element={<TournamentPage />} />
      </Routes>
    </MemoryRouter>
  );
  return waitFor(() => {
    const section = document.querySelector('.tourn-detail');
    expect(section, 'the selected event must be on screen').not.toBeNull();
    return section as HTMLElement;
  });
}

const rewardsFirstPlace = placePrize(1196 + 660, STRUCTURE, 1, CHIP_UNIT_CENTS);

describe('the tournament page Payouts ladder carries the guaranteed minimum', () => {
  it('prints the worked example at the same floor Rewards prints', async () => {
    const detail = await openPayouts(workedExample());
    await waitFor(() => expect(detail.textContent).toContain('Guaranteed 928'));
    expect(rewardsFirstPlace).toBe(928);
    const first = [...detail.querySelectorAll('.sc-label')].find((el) => el.textContent === '1st')!;
    expect(first.parentElement!.querySelector('.tourn-value__main')?.textContent).toBe('598');
    expect(first.parentElement!.querySelector('.tourn-value__gtd')?.textContent).toBe(
      'Guaranteed 928'
    );
    expect(state.rpcCalls).toContain('fn_ca_tournament_prize_funding');
  });

  it('shows no floor once the house owes nothing', async () => {
    state.houseDue = 0;
    const detail = await openPayouts(workedExample());
    await waitFor(() => expect(detail.textContent).toContain('598'));
    expect(detail.textContent).not.toMatch(/Guaranteed \d/);
  });

  it('shows no floor once the pool is finalized', async () => {
    const detail = await openPayouts(
      workedExample({ prize_pool_finalized: true, prize_pool: 1856 })
    );
    await waitFor(() => expect(detail.textContent).toContain('928'));
    expect(detail.textContent).not.toMatch(/Guaranteed \d/);
  });
});
