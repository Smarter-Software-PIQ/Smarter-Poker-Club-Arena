/**
 * THE TOURNAMENT PAGE AND MYSTERY BOUNTY PANEL ARE PINNED BEFORE THEIR FRAME MOVES
 * (#SmarterDesign Batch T2, 2026-11-28)
 *
 * /clubs/:clubId/tournaments is moving from six painted SpadeConsoles (plus two
 * inside MysteryBountyPanel when hosted here) onto the arena workspace language.
 * Every figure, word, test hook, named region and control state is pinned against
 * origin/main and held unchanged after.
 */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';
import {
  parseAwards,
  parseInventory,
  parseLeaderboard,
} from '../../src/services/MysteryBountyService';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  owner: false,
  isRegistered: false,
  rebuy: false,
  addon: false,
  playing: false,
  tables: [] as Array<Record<string, unknown>>,
  mysteryLoading: false,
  mysteryUnavailable: false,
  mysteryActive: false,
  register: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (relation: string) => {
      let projection = '';
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not', 'is', 'abortSignal']) {
        chain[m] = (...args: unknown[]) => {
          if (m === 'select') projection = String(args[0] ?? '');
          return chain;
        };
      }
      chain.maybeSingle = () => {
        if (relation === 'club_members' && projection === 'role') {
          return Promise.resolve({ data: state.owner ? { role: 'owner' } : null, error: null });
        }
        if (relation === 'union_clubs') {
          return Promise.resolve({ data: null, error: null });
        }
        if (relation === 'tournament_players') {
          if (projection === 'id') {
            return Promise.resolve({
              data: state.isRegistered ? { id: 'entry-1' } : null,
              error: null,
            });
          }
          if (projection === 'status') {
            return Promise.resolve({
              data: state.playing ? { status: 'playing' } : null,
              error: null,
            });
          }
        }
        return Promise.resolve({ data: null, error: null });
      };
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (relation === 'tables') {
          return Promise.resolve({ data: state.tables, error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return chain;
    },
  },
}));

vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: {
    getTournaments: vi.fn(async () => state.rows),
    getTournament: vi.fn(async () => null),
    getCurrentLevelState: vi.fn(() => ({
      levelIndex: 2,
      timeRemainingSeconds: 420,
      currentLevel: { isBreak: false },
    })),
    canRebuy: vi.fn(async () => ({ allowed: state.rebuy })),
    canAddOn: vi.fn(async () => ({ allowed: state.addon })),
    quoteFromTournament: vi.fn(() => ({ totalCost: 110 })),
    startTournament: vi.fn(),
    processRebuy: vi.fn(),
    processAddOn: vi.fn(),
    unregisterPlayer: vi.fn(),
  },
  tournamentUnregisterSuccessText: () => 'Unregistered',
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
      registerChannelFactory: vi.fn(),
      removeChannelFactory: vi.fn(),
    },
  };
});

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'user-1', username: 'Hero' } }),
}));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: <T,>(_key: string, initial: T) => useState<T>(initial),
}));
vi.mock('../../src/services/TableService', () => ({ tableService: {} }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('../../src/utils/clubIdResolver', () => ({ resolveClubUUID: async (id: string) => id }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('../../src/components/tournament/TournamentClock', () => ({
  TournamentClock: () => <div data-testid="mock-clock">Clock</div>,
}));
vi.mock('../../src/components/tournament/details/RankingTab', () => ({
  default: () => <div data-testid="mock-ranking">Ranking Board</div>,
}));
vi.mock('../../src/hooks/useTournamentEntries', () => ({
  useTournamentEntries: () => ({
    entries: [{ user_id: 'u-1', position: 1, prize: 2000 }],
    entryCount: 18,
    loading: false,
    loadFailed: false,
    refresh: vi.fn(),
  }),
}));

const MYSTERY_INV = parseInventory({
  pool_cents: 1300000,
  stage: 'active',
  profile: 'balanced',
  activation: 'player_count',
  activation_value: 27,
  activated_players: 27,
  tiers: [
    { tier: 'jackpot', amount_cents: 500000, original: 1, awarded: 1, remaining: 0 },
    { tier: 'mega', amount_cents: 200000, original: 1, awarded: 0, remaining: 1 },
  ],
});
const MYSTERY_AWARDS = parseAwards({
  total: 1,
  rows: [
    {
      award_id: 'a1',
      amount_cents: 500000,
      tier: 'jackpot',
      is_jackpot: true,
      revealed_at: '2026-11-28T21:05:00Z',
      hand_id: 'h-202',
      table_id: 't-1',
      eliminated: { user_id: 'u-e1', username: 'Dan' },
      recipients: [{ user_id: 'u-2', username: 'Bob', amount_cents: 500000 }],
    },
  ],
});
const MYSTERY_LB = parseLeaderboard({
  rows: [{ user_id: 'u-2', username: 'Bob', bounties_won: 1, earnings_cents: 500000 }],
});

vi.mock('../../src/hooks/useMysteryBounty', () => ({
  useMysteryBounty: () => ({
    inventory: state.mysteryActive ? MYSTERY_INV : null,
    awards: state.mysteryActive ? MYSTERY_AWARDS.rows : [],
    awardsTotal: state.mysteryActive ? MYSTERY_AWARDS.total : 0,
    leaderboard: state.mysteryActive ? MYSTERY_LB : [],
    isLoading: state.mysteryLoading,
    isUnavailable: state.mysteryUnavailable,
    pendingReveals: 0,
    refresh: vi.fn(),
  }),
}));
vi.mock('../../src/hooks/useMysteryBountyPoolSoFar', () => ({
  useMysteryBountyPoolSoFar: () => null,
}));
vi.mock('../../src/components/tournament/MysteryBountyChest', () => ({ default: () => null }));
vi.mock('../../src/services/tournamentEventBridge', () => ({ relayTournamentEvent: vi.fn() }));
vi.mock('../../src/hooks/useTournamentRegistration', () => ({
  useTournamentRegistration: () => ({ register: state.register, isRegistering: false }),
}));
vi.mock('../../src/hooks/useSenderInviteCode', () => ({
  useTournamentSenderInviteCode: () => 'INV2345',
}));
vi.mock('../../src/components/club/CreateTournamentModal', () => ({ default: () => null }));
vi.mock('../../src/utils/observeTable', () => ({ openTableAsObserver: vi.fn() }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import TournamentPage from '../../src/pages/TournamentPage';
import { tournamentService } from '../../src/services/TournamentService';

const CHIP_CLUB = { id: 'club-1', asset: 'chips', is_platform: false, union_id: null };

const REGISTERING_EVENT = {
  id: 't-reg',
  club_id: 'club-1',
  name: 'Kings Nightly MTT',
  status: 'REGISTERING',
  game_type: 'NLH',
  buy_in_amount: 100,
  buy_in_fee: 10,
  starting_chips: 10000,
  current_players: 12,
  max_players: 90,
  prize_pool: 1200,
  is_bounty: true,
  is_pko: false,
  is_mystery_bounty: false,
  bounty_amount: 25,
  blind_structure: [
    { level: 1, smallBlind: 25, bigBlind: 50, ante: 5, durationMinutes: 12 },
    { level: 2, smallBlind: 50, bigBlind: 100, ante: 10, durationMinutes: 12 },
  ],
  payout_structure: [
    { place: 1, percentage: 60 },
    { place: 2, percentage: 40 },
  ],
  start_time: '2030-01-01T20:00:00.000Z',
  arena: CHIP_CLUB,
};

const RUNNING_MYSTERY = {
  ...REGISTERING_EVENT,
  id: 't-run',
  name: 'Mystery Bounty Live',
  status: 'RUNNING',
  is_bounty: false,
  is_mystery_bounty: true,
  is_rebuy: true,
  add_on_available: true,
  current_players: 27,
  prize_pool: 26000,
};

function pinFile(name: string) {
  return `./__pins__/tournament-page-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clubs/:clubId/tournaments" element={<TournamentPage />} />
        <Route path="/clubs/:clubId/tournaments/:tournamentId" element={<TournamentPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  state.rows = [REGISTERING_EVENT, RUNNING_MYSTERY];
  state.owner = true;
  state.isRegistered = false;
  state.rebuy = false;
  state.addon = false;
  state.playing = false;
  state.tables = [
    {
      id: 'tb-1',
      name: 'Table 1',
      status: 'active',
      current_players: 8,
      max_players: 9,
      small_blind: 100,
      big_blind: 200,
    },
  ];
  state.mysteryLoading = false;
  state.mysteryUnavailable = false;
  state.mysteryActive = true;
  vi.mocked(tournamentService.getTournaments).mockImplementation(async () => state.rows as never);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('TournamentPage prints the same figures, words, hooks and controls', () => {
  it('loading state', async () => {
    vi.mocked(tournamentService.getTournaments).mockReturnValueOnce(new Promise(() => {}));
    const { container } = renderAt('/clubs/club-1/tournaments');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loading'));
  });

  it('ready list with owner controls and empty selection prompt', async () => {
    const { container } = renderAt('/clubs/club-1/tournaments');
    await screen.findByText('Kings Nightly MTT');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('list'));
  });

  it('selected registering tournament detail', async () => {
    const { container } = renderAt('/clubs/club-1/tournaments/t-reg');
    await waitFor(() => expect(container.querySelector('.tourn-detail')).not.toBeNull());
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('detail-registering'));
  });

  it('selected running mystery bounty tournament with rebuy, add-on, live tables and MysteryBountyPanel', async () => {
    state.rebuy = true;
    state.addon = true;
    state.playing = true;
    const { container } = renderAt('/clubs/club-1/tournaments/t-run');
    await waitFor(() => expect(container.querySelector('.tourn-detail')).not.toBeNull());
    await screen.findAllByText('Top Mystery Bounty');
    await screen.findByText('Table 1');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('detail-running-mystery'));
  });

  it('empty state when no tournaments match filters', async () => {
    state.rows = [];
    const { container } = renderAt('/clubs/club-1/tournaments');
    await screen.findByText('No Tournaments Match Your Filters');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });
});
