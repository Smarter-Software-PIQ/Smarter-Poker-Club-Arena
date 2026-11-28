/**
 * TOURNAMENT RESULTS PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch G1, 2026-11-28)
 *
 * TournamentResultsPage (`/tournament-results`) moves from RewardsSurfaceHeader
 * and inline slate cards to the arena workspace. Every prize pool, buy-in,
 * placement prize, knockout count, bounty award, mystery chest breakout,
 * Diamond-unit figure, satellite award, spin hit, spin leaderboard, hand
 * history pot, empty and error state is pinned before conversion and must
 * remain unchanged.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  rpc: vi.fn(),
  leaderboard: vi.fn(),
  awards: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

type Reply = { data: unknown; error: unknown };
function chain(table: string) {
  const args: Record<string, unknown> = {};
  const q: Record<string, unknown> = {
    then: (ok: (v: Reply) => unknown, fail: (e: unknown) => unknown) =>
      Promise.resolve(mocks.query(table, args)).then(ok, fail),
  };
  for (const m of [
    'select',
    'eq',
    'in',
    'gte',
    'gt',
    'order',
    'limit',
    'maybeSingle',
    'abortSignal',
  ]) {
    q[m] = (...values: unknown[]) => {
      if (m === 'eq' || m === 'gte') args[String(values[0])] = values[1];
      else if (m === 'gt') args.gt = values[1];
      else args[m] = values[0];
      return q;
    };
  }
  return q;
}

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: chain,
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    getOrCreateChannel: vi.fn(() => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    }),
    removeRegisteredChannel: vi.fn(),
  },
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'hero' } }),
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/tournament/TournamentPaymentStatus', () => ({
  default: ({ tournamentId }: { tournamentId: string }) => (
    <div data-testid="payment-status-stub">Payment Status {tournamentId}</div>
  ),
}));
vi.mock('../../src/services/MysteryBountyService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/MysteryBountyService')>();
  return {
    ...actual,
    MysteryBountyService: {
      getLeaderboard: (...args: unknown[]) => mocks.leaderboard(...args),
      getAllAwards: (...args: unknown[]) => mocks.awards(...args),
    },
  };
});

import TournamentResultsPage from '../../src/pages/tournament/TournamentResultsPage';

const MYSTERY_EVENT = {
  id: 'mtt-mystery',
  name: 'Sunday Mystery Major',
  variant: 'mystery_bounty',
  tournament_type: 'mtt',
  game_type: 'NLH',
  buy_in_amount: 100,
  buy_in_fee: 10,
  prize_pool: 1196,
  bounty_pool: 460,
  current_players: 48,
  max_players: 100,
  status: 'COMPLETED',
  started_at: '2026-11-27T18:00:00Z',
  ended_at: '2026-11-27T21:15:00Z',
  is_xmtt: false,
  is_bounty: true,
  is_pko: false,
  is_mystery_bounty: true,
  spin_multiplier: null,
  arena: { id: 'club-1', asset: 'chips', is_platform: false },
};

const DIAMOND_EVENT = {
  id: 'mtt-diamond',
  name: 'Diamond Grand Classic',
  variant: 'freezeout',
  tournament_type: 'mtt',
  game_type: 'PLO4',
  buy_in_amount: 50,
  buy_in_fee: 5,
  prize_pool: 500,
  bounty_pool: null,
  current_players: 10,
  max_players: 20,
  status: 'COMPLETED',
  started_at: '2026-11-27T15:00:00Z',
  ended_at: '2026-11-27T16:30:00Z',
  is_xmtt: false,
  is_bounty: false,
  is_pko: false,
  is_mystery_bounty: false,
  spin_multiplier: null,
  arena: { id: 'diamond-1', asset: 'diamonds', is_platform: true },
};

const MYSTERY_STANDINGS = [
  {
    id: 'p1',
    user_id: 'champ',
    username: 'ChampionOne',
    position: 1,
    prize: 400,
    bounty_winnings: 100,
    bounties_collected: 2,
    status: 'winner',
    chips: 100000,
  },
  {
    id: 'p2',
    user_id: 'hero',
    username: 'HeroHunter',
    position: 4,
    prize: 120,
    bounty_winnings: 500,
    bounties_collected: 3,
    status: 'eliminated',
    chips: 0,
  },
];

const DIAMOND_STANDINGS = [
  {
    id: 'd1',
    user_id: 'hero',
    username: 'DiamondChamp',
    position: 1,
    prize: 300,
    bounty_winnings: 0,
    bounties_collected: 0,
    status: 'winner',
    chips: 50000,
  },
  {
    id: 'd2',
    user_id: 'runner',
    username: 'SecondPlace',
    position: 2,
    prize: 200,
    bounty_winnings: 0,
    bounties_collected: 0,
    status: 'eliminated',
    chips: 0,
  },
];

const HANDS = [
  {
    id: 'h-42',
    hand_number: 42,
    small_blind: 100,
    big_blind: 200,
    pot_size: 1250,
    game_variant: 'NLH',
    community_cards: ['As', 'Kd', 'Qh'],
    winners: [{ userId: 'hero', amount: 1250 }],
    players: [],
    created_at: '2026-11-27T20:45:00Z',
  },
];

function mount(path = '/tournament-results') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TournamentResultsPage />
    </MemoryRouter>
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

function pin(container: HTMLElement) {
  return surfacePin(container.firstElementChild as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  mocks.query.mockImplementation((table, args) => {
    if (table === 'tournaments') {
      if (args.spin_multiplier) {
        return {
          data: [
            {
              id: 'spin-hit',
              buy_in_amount: 50,
              spin_multiplier: 50,
              ended_at: '2026-11-27T20:00:00Z',
            },
          ],
          error: null,
        };
      }
      return { data: [MYSTERY_EVENT, DIAMOND_EVENT], error: null };
    }
    if (table === 'tournament_players_public') {
      if (args.in) {
        return {
          data: [{ tournament_id: 'spin-hit', username: 'SpinAce', prize: 2500 }],
          error: null,
        };
      }
      if (args.tournament_id === 'mtt-mystery') return { data: MYSTERY_STANDINGS, error: null };
      if (args.tournament_id === 'mtt-diamond') return { data: DIAMOND_STANDINGS, error: null };
      return { data: [], error: null };
    }
    if (table === 'hand_history') return { data: HANDS, error: null };
    return { data: [], error: null };
  });
  mocks.rpc.mockResolvedValue({
    data: {
      best_net: [{ username: 'SpinAce', net: 4200, spins: 85 }],
      most_spins: [{ username: 'GrinderPro', spins: 140 }],
    },
    error: null,
  });
  mocks.leaderboard.mockResolvedValue([
    { userId: 'hero', username: 'HeroHunter', bountiesWon: 2, earningsCents: 50000 },
  ]);
  mocks.awards.mockResolvedValue({
    total: 2,
    rows: [
      {
        awardId: 'a1',
        amountCents: 35000,
        tier: 'gold',
        isJackpot: true,
        revealedAt: '2026-11-27T20:00:00Z',
        handId: null,
        tableId: null,
        eliminated: { userId: 'elim-1', username: 'BustedOne' },
        recipients: [{ userId: 'hero', username: 'HeroHunter', amountCents: 35000 }],
      },
      {
        awardId: 'a2',
        amountCents: 15000,
        tier: 'silver',
        isJackpot: false,
        revealedAt: '2026-11-27T20:10:00Z',
        handId: null,
        tableId: null,
        eliminated: { userId: 'elim-2', username: 'BustedTwo' },
        recipients: [{ userId: 'hero', username: 'HeroHunter', amountCents: 15000 }],
      },
    ],
  });
});

afterEach(cleanup);

describe('Tournament Archive prints the same prizes, bounties, hands and controls', () => {
  it('loaded list of completed tournaments', async () => {
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button||All Types|",
          "button||All|",
          "button||Bounty|",
          "button||Freezeout|",
          "button||My Results|",
          "button||Mystery|",
          "button||PKO|",
          "button||Sng|",
          "button||Spin|",
          "button||Xmtt|",
        ],
        "money": {
          "figures": [
            "1,656",
            "48",
            "3h 15m",
            "100",
            "10",
            "48",
            "3h 15m",
            "PLO4",
            "500",
            "10",
            "1h 30m",
            "50",
            "5",
            "10",
            "1h 30m",
          ],
          "hooks": [],
        },
        "regions": [
          "button||Back",
        ],
        "text": "Sunday Mystery Major | Mystery Bounty | NLH | 1,656 | Prize Pool | 48 | Entries · | 3h 15m | Buy-In: | 100 | + | 10 | · Entries: | 48 | · Duration: | 3h 15m | · Ended: | <date> | Diamond Grand Classic | Freezeout | PLO4 | 500 | Prize Pool | 10 | Entries · | 1h 30m | Buy-In: | 50 | + | 5 | · Entries: | 10 | · Duration: | 1h 30m | · Ended: | <date>",
      }
    `);
  });

  it('expanded Mystery Bounty standings with out-earned champion callout and chest breakout', async () => {
    const { container } = mount();
    await flush();
    fireEvent.click(screen.getByText('Sunday Mystery Major'));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button||All Types|",
          "button||All|",
          "button||Bounty|",
          "button||By Finish|",
          "button||By Total Payout|",
          "button||Freezeout|",
          "button||Hand History (1)|",
          "button||My Results|",
          "button||Mystery|",
          "button||PKO|",
          "button||Sng|",
          "button||Spin|",
          "button||Standings|",
          "button||Xmtt|",
        ],
        "money": {
          "figures": [
            "1,656",
            "48",
            "3h 15m",
            "100",
            "10",
            "48",
            "3h 15m",
            "1",
            "4th",
            "620",
            "1st",
            "400",
            "2",
            "100",
            "500",
            "4th",
            "2",
            "500",
            "350",
            "120",
            "3",
            "500",
            "620",
            "PLO4",
            "500",
            "10",
            "1h 30m",
            "50",
            "5",
            "10",
            "1h 30m",
          ],
          "hooks": [
            "data-testid=payment-status-stub",
          ],
        },
        "regions": [
          "button||Back",
        ],
        "text": "Sunday Mystery Major | Mystery Bounty | NLH | 1,656 | Prize Pool | 48 | Entries · | 3h 15m | Buy-In: | 100 | + | 10 | · Entries: | 48 | · Duration: | 3h 15m | · Ended: | <date> | Payment Status | mtt-mystery | Final Standings | Biggest Total Payout: | HeroHunter | ( | 4th | ) With | 620 | , More Than The Champion | Finish And Player | Prize | KOs | Bounty | Total | 1st | ChampionOne | 400 | 2 | 100 | 500 | 4th | HeroHunter | (You) | 2 | Mystery ( | 500 | ), Largest | 350 | 120 | 3 | 500 | 620 | Diamond Grand Classic | Freezeout | PLO4 | 500 | Prize Pool | 10 | Entries · | 1h 30m | Buy-In: | 50 | + | 5 | · Entries: | 10 | · Duration: | 1h 30m | · Ended: | <date>",
      }
    `);
  });

  it('expanded Diamond-unit tournament standings', async () => {
    const { container } = mount();
    await flush();
    fireEvent.click(screen.getByText('Diamond Grand Classic'));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button||All Types|",
          "button||All|",
          "button||Bounty|",
          "button||By Finish|",
          "button||By Total Payout|",
          "button||Freezeout|",
          "button||Hand History (1)|",
          "button||My Results|",
          "button||Mystery|",
          "button||PKO|",
          "button||Sng|",
          "button||Spin|",
          "button||Standings|",
          "button||Xmtt|",
        ],
        "money": {
          "figures": [
            "1,656",
            "48",
            "3h 15m",
            "100",
            "10",
            "48",
            "3h 15m",
            "PLO4",
            "500",
            "10",
            "1h 30m",
            "50",
            "5",
            "10",
            "1h 30m",
            "1",
            "1st",
            "300",
            "300",
            "2nd",
            "200",
            "200",
          ],
          "hooks": [
            "data-testid=payment-status-stub",
          ],
        },
        "regions": [
          "button||Back",
        ],
        "text": "Sunday Mystery Major | Mystery Bounty | NLH | 1,656 | Prize Pool | 48 | Entries · | 3h 15m | Buy-In: | 100 | + | 10 | · Entries: | 48 | · Duration: | 3h 15m | · Ended: | <date> | Diamond Grand Classic | Freezeout | PLO4 | 500 | Prize Pool | 10 | Entries · | 1h 30m | Buy-In: | 50 | + | 5 | · Entries: | 10 | · Duration: | 1h 30m | · Ended: | <date> | Payment Status | mtt-diamond | Final Standings | Finish And Player | Prize | KOs | Bounty | Total | 1st | DiamondChamp | (You) | 300 | - | - | 300 | 2nd | SecondPlace | 200 | - | - | 200",
      }
    `);
  });

  it('expanded Hand History tab', async () => {
    const { container } = mount();
    await flush();
    fireEvent.click(screen.getByText('Sunday Mystery Major'));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Hand History (1)' }));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button||All Types|",
          "button||All|",
          "button||Bounty|",
          "button||Freezeout|",
          "button||Hand History (1)|",
          "button||My Results|",
          "button||Mystery|",
          "button||PKO|",
          "button||Sng|",
          "button||Spin|",
          "button||Standings|",
          "button||Xmtt|",
        ],
        "money": {
          "figures": [
            "1,656",
            "48",
            "3h 15m",
            "100",
            "10",
            "48",
            "3h 15m",
            "1",
            "42",
            "100",
            "200",
            "1,250",
            "1250",
            "PLO4",
            "500",
            "10",
            "1h 30m",
            "50",
            "5",
            "10",
            "1h 30m",
          ],
          "hooks": [],
        },
        "regions": [
          "button||Back",
        ],
        "text": "Sunday Mystery Major | Mystery Bounty | NLH | 1,656 | Prize Pool | 48 | Entries · | 3h 15m | Buy-In: | 100 | + | 10 | · Entries: | 48 | · Duration: | 3h 15m | · Ended: | <date> | Hand # | 42 | <time> | NLH | · | 100 | / | 200 | · Pot: | 1,250 | Winners: | 1250 | Diamond Grand Classic | Freezeout | PLO4 | 500 | Prize Pool | 10 | Entries · | 1h 30m | Buy-In: | 50 | + | 5 | · Entries: | 10 | · Duration: | 1h 30m | · Ended: | <date>",
      }
    `);
  });

  it('Spin filter view with Biggest Hits and Spin Leaders', async () => {
    const { container } = mount('/tournament-results?type=spin');
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button||All Types|",
          "button||All|",
          "button||Best Net|",
          "button||Bounty|",
          "button||Freezeout|",
          "button||Most Spins|",
          "button||My Results|",
          "button||Mystery|",
          "button||PKO|",
          "button||Sng|",
          "button||Spin|",
          "button||Xmtt|",
        ],
        "money": {
          "figures": [
            "50",
            "Won 2,500",
            "50",
            "Last 7 Days",
            "1",
            "85",
            "4,200",
            "1,656",
            "48",
            "3h 15m",
            "100",
            "10",
            "48",
            "3h 15m",
            "PLO4",
            "500",
            "10",
            "1h 30m",
            "50",
            "5",
            "10",
            "1h 30m",
          ],
          "hooks": [],
        },
        "regions": [
          "button||Back",
        ],
        "text": "Biggest Hits | 50 | x | SpinAce | Won 2,500 | On A | 50 | Spin | Spin Leaders | Last 7 Days | 1 | SpinAce | 85 | Spins | + | 4,200 | Sunday Mystery Major | Mystery Bounty | NLH | 1,656 | Prize Pool | 48 | Entries · | 3h 15m | Buy-In: | 100 | + | 10 | · Entries: | 48 | · Duration: | 3h 15m | · Ended: | <date> | Diamond Grand Classic | Freezeout | PLO4 | 500 | Prize Pool | 10 | Entries · | 1h 30m | Buy-In: | 50 | + | 5 | · Entries: | 10 | · Duration: | 1h 30m | · Ended: | <date>",
      }
    `);
  });

  it('empty archive state', async () => {
    mocks.query.mockResolvedValue({ data: [], error: null });
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button||All Types|",
          "button||All|",
          "button||Bounty|",
          "button||Freezeout|",
          "button||My Results|",
          "button||Mystery|",
          "button||PKO|",
          "button||Sng|",
          "button||Spin|",
          "button||Xmtt|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "button||Back",
        ],
        "text": "No Completed Tournaments Found",
      }
    `);
  });

  it('failed archive read state', async () => {
    mocks.query.mockResolvedValue({ data: null, error: { message: 'offline' } });
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button||All Types|",
          "button||All|",
          "button||Bounty|",
          "button||Freezeout|",
          "button||My Results|",
          "button||Mystery|",
          "button||PKO|",
          "button||Retry Results|",
          "button||Sng|",
          "button||Spin|",
          "button||Xmtt|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "button||Back",
          "div|alert|",
        ],
        "text": "Could Not Load Tournament Results. Please Retry.",
      }
    `);
  });
});
