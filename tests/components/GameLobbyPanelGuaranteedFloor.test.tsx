/**
 * EVERY PROJECTED PLACE SHOWS ITS GUARANTEED MINIMUM (2026-11-07).
 *
 * The owner's worked example: 46 entries x (36 buy-in = 26 places + 10
 * bounty, 4 fee), 2,500 GTD. Places 1,196, bounties 460, rake 184, house
 * share 660, guaranteed ladder pool 1,856. RewardsTab prints "Guaranteed
 * 1,856" under first place; the lobby panel's Projected column priced the
 * same place at 1,196 and said nothing about the guarantee. Now it reads
 * the same funding RPC through the shared hook and prints the same floor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { placePrize } from '../../src/components/tournament/details/types';
import { CHIP_UNIT_CENTS } from '../../server/src/tournament/tournamentUnit';

const state = vi.hoisted(() => ({
  houseDue: 660 as number | null,
  rpcCalls: [] as string[],
}));
const getTournament = vi.fn();
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: { getTournament: (...args: unknown[]) => getTournament(...args) },
}));
vi.mock('../../src/services/TableService', () => ({
  tableService: { getAveragePot: vi.fn(async () => null) },
}));
vi.mock('../../src/services/WaitlistService', () => ({
  waitlistService: { getTableWaitlist: vi.fn(async () => []) },
}));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: () => () => {},
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => {
          const result = Promise.resolve({ data: [], count: 46, error: null });
          return { is: () => result, then: result.then.bind(result) };
        },
      }),
    }),
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
import GameLobbyPanel from '../../src/components/lobby/GameLobbyPanel';
import { tournamentEntry, type LobbyTournamentRow } from '../../src/components/lobby/lobbyEntries';

afterEach(() => {
  cleanup();
  getTournament.mockReset();
  state.houseDue = 660;
  state.rpcCalls = [];
});

const STRUCTURE = [
  { place: 1, percentage: 50 },
  { place: 2, percentage: 30 },
  { place: 3, percentage: 20 },
];

function workedExample(over: Record<string, unknown> = {}) {
  const raw = {
    id: 'gtd-2500',
    format_contract: 'mtt-v2',
    name: '40 Chip Bounty Freezeout 2.5K',
    status: 'REGISTERING',
    start_time: '2099-11-07T01:00:00Z',
    variant: 'nlh',
    game_type: 'NLH',
    current_players: 46,
    max_players: null,
    buy_in_amount: 36,
    buy_in_fee: 4,
    is_bounty: true,
    bounty_amount: 10,
    prize_pool: 1196,
    bounty_pool: 460,
    total_rake: 184,
    guaranteed_prize: 2500,
    prize_pool_finalized: false,
    starting_chips: 10000,
    payout_structure: JSON.stringify(STRUCTURE),
    ...over,
  } as LobbyTournamentRow;
  getTournament.mockResolvedValue(raw);
  render(
    <MemoryRouter>
      <GameLobbyPanel
        entry={tournamentEntry(raw, 'mtt')}
        clubId="club"
        currentUserId="viewer"
        waitlisted={false}
        seated={false}
        registered={false}
        busy={false}
        onClose={vi.fn()}
        onJoinTable={vi.fn()}
        onWaitlistToggle={vi.fn()}
        onRegister={vi.fn()}
        onUnregister={vi.fn()}
        onSpinJoin={vi.fn()}
      />
    </MemoryRouter>
  );
}

/** What RewardsTab prints for the same structure: the one ladder rule on places + house share. */
const rewardsFirstPlace = placePrize(1196 + 660, STRUCTURE, 1, CHIP_UNIT_CENTS);

describe('the lobby panel Projected column carries the guaranteed minimum', () => {
  it('prints the worked example at the same floor Rewards prints', async () => {
    workedExample();
    fireEvent.click(await screen.findByRole('tab', { name: 'Payouts' }));
    await waitFor(() => expect(screen.getByText('Guaranteed 928')).toBeTruthy());
    expect(rewardsFirstPlace).toBe(928);
    const firstRow = screen.getByText('Guaranteed 928').closest('tr')!;
    expect(firstRow.querySelector('.glp__projected')?.textContent).toBe('598');
    expect(state.rpcCalls).toContain('fn_ca_tournament_prize_funding');
    expect(screen.getByText(/Guaranteed Figures Include The 660 The House Adds/)).toBeTruthy();
  });

  it('shows no floor once the house owes nothing', async () => {
    state.houseDue = 0;
    workedExample();
    fireEvent.click(await screen.findByRole('tab', { name: 'Payouts' }));
    await waitFor(() => expect(screen.getByText('598')).toBeTruthy());
    expect(screen.queryByText(/Guaranteed \d/)).toBeNull();
  });

  it('shows no floor once the pool is finalized', async () => {
    workedExample({ prize_pool_finalized: true, prize_pool: 1856 });
    fireEvent.click(await screen.findByRole('tab', { name: 'Payouts' }));
    await waitFor(() => expect(screen.getByText('928')).toBeTruthy());
    expect(screen.queryByText(/Guaranteed \d/)).toBeNull();
  });

  it('does not read funding for an event without a guarantee', async () => {
    workedExample({ guaranteed_prize: 0 });
    fireEvent.click(await screen.findByRole('tab', { name: 'Payouts' }));
    await waitFor(() => expect(screen.getByText('598')).toBeTruthy());
    expect(state.rpcCalls).toEqual([]);
  });
});
