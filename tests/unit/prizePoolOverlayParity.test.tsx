/**
 * THE CLIENT'S POOL AND OVERLAY MATCH THE DATABASE AUTHORITY (2026-11-06).
 *
 * Owner ruling: the Total Prize Pool is what the field paid net of rake
 * (36 x 46 = 1,656, never 1,656 + overlay) and the overlay is shown on its
 * own. fn_ca_tournament_prize_funding is the authority; screens that hold
 * only the tournament row use displayTotalPool / guaranteeShortfall. The net expectation supersedes gross coverage on November 7. These
 * row inputs were read from production fn_ca_tournament_prize_funding on
 * 2026-11-06 - if either side drifts, the two would print different money.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/context/InTabLobbyContext', () => ({ useAppNavigate: () => vi.fn() }));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: null }) }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { displayTotalPool, guaranteeShortfall } from '../../src/utils/tournamentPrizeFunding';
import TournamentLobbyCard from '../../src/components/tournament/TournamentLobbyCard';
import { mapSatelliteRowToCard } from '../../src/components/tournament/details/useSatellites';

afterEach(cleanup);

const PRODUCTION_ROWS = [
  // name, guarantee, prize_pool, bounty_pool, total_rake -> collected, house_due
  {
    name: '40 Chip Bounty Freezeout 2.5K (46 entries)',
    g: 2500,
    p: 1196,
    b: 460,
    r: 184,
    collected: 1656,
    due: 844,
  },
  {
    name: '40 Chip Bounty Freezeout 2.5K (56 entries)',
    g: 2500,
    p: 1456,
    b: 560,
    r: 224,
    collected: 2016,
    due: 484,
  },
  { name: 'Friday Fight Night PKO', g: 1500, p: 312, b: 390, r: 78, collected: 702, due: 798 },
  { name: 'Night Owl Special (NLH)', g: 750, p: 104, b: 130, r: 26, collected: 234, due: 516 },
  {
    name: 'Covered: 73 entries of 40 against 2.5K',
    g: 2500,
    p: 1898,
    b: 730,
    r: 292,
    collected: 2628,
    due: 0,
  },
];

describe('pool and overlay parity with fn_ca_tournament_prize_funding', () => {
  it.each(PRODUCTION_ROWS)('$name', ({ g, p, b, r, collected, due }) => {
    expect(displayTotalPool(p, g, b, r)).toBe(collected);
    expect(guaranteeShortfall(g, p, b, r)).toBe(due);
  });
});

describe('the lobby card shows the overlay beside the pool, never inside it', () => {
  const base = mapSatelliteRowToCard({
    format_contract: 'mtt-v2',
    id: 'overlay-card',
    name: 'Friday Fight Night PKO',
    status: 'REGISTERING',
    tournament_type: 'MTT',
    starting_chips: 10000,
    blind_structure: [],
    current_players: 26,
    max_players: 1000,
    start_time: '2099-10-23T13:00:00Z',
  });
  const card = (overrides: Record<string, unknown>) => ({
    ...base,
    type: 'pko' as const,
    buyIn: 30,
    guaranteedPrize: 1500,
    prizePool: 312,
    bountyPool: 390,
    totalRake: 78,
    ...overrides,
  });

  it('a paid event: 702 pool, 798 overlay', () => {
    render(<TournamentLobbyCard tournament={card({})} knownRegistration={false} />);
    expect(screen.getByText('798 Overlay')).toBeTruthy();
    expect(screen.getByText('Total Pool').parentElement!.textContent).toContain('702');
    expect(screen.queryByText('1,422')).toBeNull();
  });

  it('no overlay once entries cover the guarantee', () => {
    render(
      <TournamentLobbyCard
        tournament={card({
          prizePool: 1898,
          bountyPool: 730,
          totalRake: 292,
          guaranteedPrize: 2500,
        })}
        knownRegistration={false}
      />
    );
    expect(screen.queryByText(/Overlay$/)).toBeNull();
  });

  it('no overlay once the pool is finalized (the stored pool holds the funding)', () => {
    render(
      <TournamentLobbyCard
        tournament={card({ prize_pool_finalized: true, prizePool: 1032 })}
        knownRegistration={false}
      />
    );
    expect(screen.queryByText(/Overlay$/)).toBeNull();
  });

  it('a ticket-funded Free Buy leaves the overlay to the database authority', () => {
    render(
      <TournamentLobbyCard
        tournament={card({
          type: 'mtt',
          buyIn: 0,
          guaranteedPrize: 250,
          prizePool: 155,
          bountyPool: 0,
          totalRake: 0,
        })}
        knownRegistration={false}
      />
    );
    expect(screen.queryByText(/Overlay$/)).toBeNull();
  });
});

describe('a guaranteed satellite prints the field, not its guarantee (2026-11-07)', () => {
  // The production 2.5K GTD 40 Chip Bounty Freezeout row at 46 entries, read
  // as a satellite feeding a Main Event. Until today useSatellites mapped
  // `prizePool: guaranteed_prize || prize_pool`, so this card said "2,500"
  // and never showed the 844 the house still owed.
  const row = {
    format_contract: 'mtt-v2',
    id: 'sat-gtd',
    name: '40 Chip Bounty Freezeout 2.5K',
    status: 'REGISTERING',
    tournament_type: 'MTT',
    satellite_target_id: 'main-event',
    buy_in_amount: 36,
    buy_in_fee: 4,
    guaranteed_prize: 2500,
    prize_pool: 1196,
    bounty_pool: 460,
    total_rake: 184,
    prize_pool_finalized: false,
    is_bounty: true,
    bounty_amount: 10,
    starting_chips: 10000,
    blind_structure: [],
    current_players: 46,
    max_players: 1000,
    start_time: '2099-10-23T13:00:00Z',
  };

  it('maps the places pool, bounty pool and rake separately from the guarantee', () => {
    const card = mapSatelliteRowToCard(row);
    expect(card.prizePool).toBe(1196);
    expect(card.bountyPool).toBe(460);
    expect(card.totalRake).toBe(184);
    expect(card.guaranteedPrize).toBe(2500);
    expect(displayTotalPool(card.prizePool, card.guaranteedPrize, card.bountyPool)).toBe(1656);
    expect(
      guaranteeShortfall(card.guaranteedPrize, card.prizePool, card.bountyPool, card.totalRake)
    ).toBe(844);
  });

  it('the satellite card reads the 1,656 total pool (compact 1.6K), GTD, and 844 overlay; never 2.5K as the pool', () => {
    render(
      <TournamentLobbyCard tournament={mapSatelliteRowToCard(row)} knownRegistration={false} />
    );
    const pool = screen.getByText('Total Pool').parentElement!.textContent!;
    // The card compacts chips; 1,656 prints as 1.6K and 2,500 would print as 2.5K.
    expect(pool).toContain('1,656');
    expect(pool).toContain('GTD');
    expect(screen.getByText('844 Overlay')).toBeTruthy();
    expect(pool).not.toContain('2.5K');
  });

  it('a satellite with no guarantee prints the pool it collected', () => {
    const card = mapSatelliteRowToCard({ ...row, guaranteed_prize: null, bounty_pool: 0 });
    expect(card.prizePool).toBe(1196);
    expect(card.guaranteedPrize).toBeUndefined();
  });
});
