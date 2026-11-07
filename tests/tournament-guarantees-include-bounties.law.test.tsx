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

const state = vi.hoisted(() => ({
  collected: 3420,
  overlay: 1580,
  error: false,
  gross: null as number | null,
  houseRequired: null as number | null,
  housePosted: null as number | null,
  houseDue: null as number | null,
}));
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
                gross_coverage: state.gross,
                house_required: state.houseRequired,
                house_posted: state.housePosted,
                house_due: state.houseDue,
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
  state.gross = null;
  state.houseRequired = null;
  state.housePosted = null;
  state.houseDue = null;
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
    expect(effectivePrizePool(2470, 5000, 950)).toBe(2470);
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
    ).toBe(2470);
  });
  it('preserves larger collected pools, non-bounty guarantees and finalized awards', () => {
    expect(effectivePrizePool(6000, 5000, 950)).toBe(6000);
    expect(effectivePrizePool(2470, 5000)).toBe(2470);
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
  // Dan 2026-11-06, the 2.5K GTD 40 Chip Bounty Freezeout: 46 entries of
  // 26 prize / 10 bounty / 4 rake, still in late registration.
  it('an open pool shows 1,656 collected net of rake, 660 overlay, 1,196 places - never 2,316', async () => {
    state.collected = 1656;
    state.overlay = 660;
    state.gross = 1840;
    state.houseRequired = 660;
    const fixture = props(46 * 26);
    Object.assign(fixture.tournament as unknown as Record<string, unknown>, {
      guaranteed_prize: 2500,
      bounty_pool: 460,
      total_rake: 184,
      prize_pool_finalized: false,
    });
    fixture.entries = fixture.entries.slice(0, 46);
    const { container } = render(<RewardsTab {...fixture} />);
    await waitFor(() => expect(container.textContent).toContain('660 Overlay'));
    expect(container.querySelector('.rw-pool__value')?.textContent).toBe('1,656');
    expect(container.textContent).toContain('Still Growing');
    expect(container.textContent).toContain('1,840 Of 2,500');
    expect(container.textContent).toContain('Place Prizes1,196');
    expect(container.textContent).toContain('Bounty Pool460');
    expect(container.textContent).not.toContain('2,316');
    expect(container.textContent).not.toContain('Club Overlay');
  });
  // Each place is also shown at the floor the house guarantees if the field
  // closes now: places + what the house still adds, through the same ladder.
  it('shows each place at its guaranteed minimum while the overlay is pending', async () => {
    state.collected = 1656;
    state.overlay = 660;
    state.gross = 1840;
    state.houseRequired = 660;
    state.housePosted = 0;
    state.houseDue = 660;
    const fixture = props(46 * 26);
    Object.assign(fixture.tournament as unknown as Record<string, unknown>, {
      guaranteed_prize: 2500,
      bounty_pool: 460,
      total_rake: 184,
      prize_pool_finalized: false,
    });
    fixture.entries = fixture.entries.slice(0, 46);
    const { container } = render(<RewardsTab {...fixture} />);
    await waitFor(() => expect(container.textContent).toContain('Guaranteed 1,856'));
    expect(container.querySelector('.rw-prize')?.textContent).toBe('1,196');
    expect(container.textContent).toContain('Include The 660 The House Adds');
  });
  it('a Free Buy adds only what the house has not yet posted (250, never 405)', async () => {
    state.collected = 155;
    state.overlay = 0;
    state.gross = 0;
    state.houseRequired = 250;
    state.housePosted = 155;
    state.houseDue = 95;
    const fixture = props(155);
    Object.assign(fixture.tournament as unknown as Record<string, unknown>, {
      is_bounty: false,
      buy_in_amount: 0,
      buy_in_fee: 0,
      bounty_amount: 0,
      guaranteed_prize: 250,
      bounty_pool: 0,
      total_rake: 0,
      prize_pool_finalized: false,
    });
    const { container } = render(<RewardsTab {...fixture} />);
    await waitFor(() => expect(container.textContent).toContain('Guaranteed 250'));
    expect(container.textContent).not.toContain('Guaranteed 405');
    // The headline and the note tell one story: the whole house share, what
    // it already put in, and what it still adds.
    expect(container.textContent).toContain('250 House Funded');
    expect(container.textContent).toContain('Already Put In 155 And Adds 95 More');
    expect(container.textContent).not.toContain('250 Overlay');
  });
  it('shows no guaranteed figure once the pool is finalized', async () => {
    state.housePosted = 1580;
    state.houseRequired = 1580;
    state.houseDue = 0;
    const { container } = render(<RewardsTab {...props()} />);
    await waitFor(() => expect(container.textContent).toContain('Overlay'));
    expect(container.textContent).not.toMatch(/Guaranteed \d/);
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
