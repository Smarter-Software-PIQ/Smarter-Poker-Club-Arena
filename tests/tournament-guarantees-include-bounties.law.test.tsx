import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  tournamentEntryDescription,
  placeGuarantee,
  payoutSharePercent,
} from '../src/utils/tournamentPrizeFunding';
import {
  effectivePrizePool,
  effectivePlaceLadderPool,
  type TournamentTabProps,
} from '../src/components/tournament/details/types';

const state = vi.hoisted(() => ({ collected: 3420, overlay: 1580, error: false }));
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      throw new Error('No ledger fixture');
    }),
    rpc: vi.fn((_name, args) => ({
      abortSignal: () =>
        Promise.resolve({
          data: state.error
            ? null
            : {
                tournament_id: args.p_tournament_id,
                collected: state.collected,
                overlay: state.overlay,
              },
          error: state.error ? new Error('Funding unavailable') : null,
        }),
    })),
  },
}));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: () => () => {},
}));
import RewardsTab from '../src/components/tournament/details/RewardsTab';

afterEach(() => {
  cleanup();
  state.collected = 3420;
  state.overlay = 1580;
  state.error = false;
});

function props(pool = 4050): TournamentTabProps {
  return {
    tournament: {
      id: 'bounty-fixture',
      status: 'RUNNING',
      format_contract: 'mtt-v2',
      is_bounty: true,
      buy_in_amount: 36,
      buy_in_fee: 4,
      bounty_amount: 10,
      bounty_pool: 950,
      prize_pool: pool,
      guaranteed_prize: 5000,
      prize_pool_finalized: true,
      payout_structure: JSON.stringify([{ place: 1, percentage: 100 }]),
    },
    entries: Array.from({ length: 95 }, (_, i) => ({
      id: `p${i}`,
      user_id: `u${i}`,
      username: `Player ${i}`,
      status: 'playing',
      chips: 100,
    })),
    tables: [],
    blindLevels: [],
    currentUserId: 'viewer',
    isRegistered: false,
  } as unknown as TournamentTabProps;
}

describe('The guarantee includes bounties, never rake', () => {
  it('displays the normalized share without repricing exact paid award weights', async () => {
    const structure = [
      { place: 1, percentage: 3914 },
      { place: 2, percentage: 136 },
    ];
    expect(payoutSharePercent(136, structure)).toBe(3.36);
    const fixture = props();
    fixture.tournament.payout_structure = JSON.stringify(structure);
    const view = render(<RewardsTab {...fixture} />);
    await waitFor(() => expect(view.getByText('3.36%')).toBeTruthy());
    expect(view.queryByText('136%')).toBeNull();
  });

  it('prices the exact owner example from the charged entry terms', () => {
    expect(
      tournamentEntryDescription({
        is_bounty: true,
        buy_in_amount: 36,
        buy_in_fee: 4,
        bounty_amount: 10,
        short_description:
          'Fixed Knockout Bounty: 10 Chips. Entry: 21.5 Prize Pool + 10 Bounty + 3.5 Fee.',
      })
    ).toBe('Fixed Knockout Bounty: 10 Chips. Entry: 26 Prize Pool + 10 Bounty + 4 Rake.');
    expect(
      tournamentEntryDescription(
        { is_bounty: true, buy_in_amount: 36, buy_in_fee: 4, bounty_amount: 10 },
        100
      )
    ).toBe('Fixed Knockout Bounty: 10 Diamonds. Entry: 26 Prize Pool + 10 Bounty + 4 Rake.');
    expect(95 * 26 + 95 * 10 + 95 * 4).toBe(95 * 40);
    expect(placeGuarantee(5000, 950)).toBe(4050);
    expect(effectivePrizePool(2470, 5000, 950)).toBe(4050);
    expect(
      effectivePlaceLadderPool(
        2470,
        5000,
        [{ place: 1, percentage: 100 }],
        95,
        false,
        36,
        false,
        950
      )
    ).toBe(4050);
  });
  it('preserves larger collected pools, non-bounty guarantees and finalized awards', () => {
    expect(effectivePrizePool(6000, 5000, 950)).toBe(6000);
    expect(effectivePrizePool(2470, 5000)).toBe(5000);
    expect(effectivePrizePool(5000, 5000, 950)).toBe(5000);
    expect(placeGuarantee(500, 950)).toBe(0);
    expect(placeGuarantee(null, null)).toBe(0);
  });
  it('renders 5000 total with 4050 places, 950 bounties and the 1580 overlay', async () => {
    const { container } = render(<RewardsTab {...props()} />);
    await waitFor(() => expect(container.textContent).toContain('1,580 Overlay'));
    expect(container.querySelector('.rw-pool__value')?.textContent).toBe('5,000');
    expect(container.textContent).toContain('Place Prizes4,050');
    expect(container.textContent).toContain('Bounty Pool950');
    expect(container.textContent).toContain('3,420 Of 5,000');
    expect(container.textContent).not.toContain('Guarantee Met');
  });
  it('reports the actual larger legacy overlay without reducing a committed award', async () => {
    state.overlay = 2530;
    const { container } = render(<RewardsTab {...props(5000)} />);
    await waitFor(() => expect(container.textContent).toContain('2,530 Overlay'));
    expect(container.querySelector('.rw-pool__value')?.textContent).toBe('5,950');
    expect(container.textContent).toContain('3,420 Of 5,000');
  });
  it('does not turn a failed funding read into a guarantee-met claim', async () => {
    state.error = true;
    const { container } = render(<RewardsTab {...props()} />);
    await act(async () => {});
    expect(container.textContent).toContain('Funding Not Available');
    expect(container.textContent).not.toContain('Covered By Entries');
  });
  it('patches funding and settlement guards together and is exercised in required CI', () => {
    const sql = readFileSync(
      'supabase/migrations/20261102051957_tournament_guarantees_include_funded_bounties.sql',
      'utf8'
    );
    for (const name of [
      'fn_ca_fund_overlay_on_lock',
      'fn_ca_apply_prize_guarantee_core',
      'fn_ca_return_excess_start_overlay_locked',
      'fn_settle_tournament_places_atomic',
      'fn_settle_final_table_deal_atomic',
      'trg_tournament_atomic_place_completion_guard',
    ])
      expect(sql).toContain(name);
    expect(sql).not.toContain('DISABLE TRIGGER');
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain(
      'scripts/ci/test-bounty-guarantee-postgres.py'
    );
  });
});
