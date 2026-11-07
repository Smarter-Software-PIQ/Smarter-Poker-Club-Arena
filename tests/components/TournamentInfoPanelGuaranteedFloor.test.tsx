/**
 * THE TABLE-SIDE PRIZES TAB SHOWS EACH PLACE'S GUARANTEED MINIMUM (2026-11-07).
 *
 * The owner's worked example: places 1,196, bounties 460, rake 184, GTD
 * 2,500, house share 660. The shared funding hook and pending-house helper
 * price the floor on the same ladder RewardsTab uses, so first place reads
 * the same number here as on the Rewards tab for the same structure.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { placePrize } from '../../src/components/tournament/details/types';
import { CHIP_UNIT_CENTS } from '../../server/src/tournament/tournamentUnit';

const STRUCTURE = [
  { place: 1, percentage: 50 },
  { place: 2, percentage: 30 },
  { place: 3, percentage: 20 },
];
const state = vi.hoisted(() => ({
  houseDue: 660 as number | null,
  finalized: false,
  rpcCalls: [] as string[],
}));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: () => () => {},
}));
vi.mock('../../src/services/readTournamentStandings', () => ({
  readTournamentStandings: async () => ({
    data: Array.from({ length: 46 }, (_, i) => ({
      user_id: `u${i}`,
      username: `Player ${i}`,
      chips: 1000,
      status: 'playing',
    })),
    count: 46,
    error: null,
  }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        abortSignal: () => q,
        maybeSingle: async () => ({
          data: {
            id: 'gtd',
            name: '40 Chip Bounty Freezeout 2.5K',
            status: 'REGISTERING',
            current_level: 0,
            buy_in_amount: 36,
            buy_in_fee: 4,
            prize_pool: state.finalized ? 1856 : 1196,
            bounty_pool: 460,
            total_rake: 184,
            guaranteed_prize: 2500,
            prize_pool_finalized: state.finalized,
            current_players: 46,
            is_bounty: true,
            payout_structure: JSON.stringify(STRUCTURE),
          },
          error: null,
        }),
      };
      return q;
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
vi.mock('../../src/components/console/SpadeConsole', () => ({
  SpadeConsole: ({ children }: any) => <div>{children}</div>,
}));
import TournamentInfoPanel from '../../src/components/tournament/TournamentInfoPanel';

afterEach(() => {
  cleanup();
  state.houseDue = 660;
  state.finalized = false;
  state.rpcCalls = [];
});

async function openPrizes() {
  await act(async () => {
    render(<TournamentInfoPanel tournamentId="gtd" heroUserId="u0" onClose={() => {}} />);
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Prizes' }));
}

const rewardsFirstPlace = placePrize(1196 + 660, STRUCTURE, 1, CHIP_UNIT_CENTS);

describe('the table-side Prizes tab carries the guaranteed minimum', () => {
  it('prints the worked example at the same floor Rewards prints', async () => {
    await openPrizes();
    await waitFor(() => expect(screen.getByText('Guaranteed 928')).toBeTruthy());
    expect(rewardsFirstPlace).toBe(928);
    const firstRow = screen.getByText('Guaranteed 928').closest('tr')!;
    expect(firstRow.querySelector('.tip__prize')?.textContent).toBe('598');
    expect(state.rpcCalls).toContain('fn_ca_tournament_prize_funding');
  });

  it('shows no floor once the house owes nothing', async () => {
    state.houseDue = 0;
    await openPrizes();
    await waitFor(() => expect(screen.getByText('598')).toBeTruthy());
    expect(screen.queryByText(/Guaranteed \d/)).toBeNull();
  });

  it('shows no floor once the pool is finalized', async () => {
    state.finalized = true;
    await openPrizes();
    await waitFor(() => expect(screen.getByText('928')).toBeTruthy());
    expect(screen.queryByText(/Guaranteed \d/)).toBeNull();
  });
});
