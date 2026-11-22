// @vitest-environment happy-dom
/**
 * LAW: Spins and Sit & Go's ALWAYS start "When Full" - never "Starts In" or a
 * wall-clock start timestamp. Scheduled MTTs preserve their scheduled countdowns.
 *
 * Root cause locked down here (2026-11-22):
 * The engine stamps an internal ladder / fill-window `start_time` on Spin and
 * SNG rows. Previously only `satelliteStartsWhenFull` (fixed 2-seat SNG
 * satellites) suppressed start clocks on tournament details / sign-up dialogs,
 * while GameLobbyPanel, DetailOverviewTab, BlindsTab, TournamentLobbyCard,
 * TournamentLobbyPage, TournamentPage, UnionGamesPage, XMTTPage, SearchPage,
 * ClubHomePage, and TournamentDetails leaked a ticking "Starts In" countdown
 * or formatted clock timestamp for Spins and SNGs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { tournamentStartsWhenFull } from '../src/utils/tournamentPresentation';
import type { TournamentTabProps } from '../src/components/tournament/details/types';

const getTournamentMock = vi.fn();

vi.mock('../src/services/TournamentService', () => ({
  tournamentService: {
    getTournament: (...args: unknown[]) => getTournamentMock(...args),
  },
}));
vi.mock('../src/services/GameServerAPI', () => ({ getServerStatus: vi.fn(async () => null) }));
vi.mock('../src/services/EngineStateClient', () => ({
  engineChannelClient: { onStatusChange: () => () => {} },
}));
vi.mock('../src/services/RealtimeChannelService', () => ({
  realtimeChannelService: {
    subscribeToTournament: () => () => {},
    subscribeToLobby: () => () => {},
  },
}));
vi.mock('../src/utils/serverClock', () => ({ serverNow: () => Date.now() }));
vi.mock('../src/components/tournament/details/useSatellites', () => ({
  useSatellites: () => ({
    cards: [],
    registration: {},
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock('../src/hooks/useMasterBusSubscription', () => ({
  useMasterBusSubscription: () => {},
}));
vi.mock('../src/components/tournament/details/useDownlineIds', () => ({
  useDownlineIds: () => ({ downlineIds: new Set(), carriesDownline: false }),
}));
vi.mock('../src/components/common/Toast', () => ({ useToast: () => ({ info: vi.fn() }) }));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../src/services/MysteryBountyService', () => ({
  activationStatusLine: () => '',
  formatCents: String,
  topBountyCents: () => 0,
}));
vi.mock('../src/components/tournament/RegistrationApprovalsPanel', () => ({
  default: () => null,
}));
vi.mock('../src/components/tournament/TournamentDealReview', () => ({ default: () => null }));
vi.mock('../src/components/tournament/HandForHandBanner', () => ({
  HandForHandBanner: () => null,
}));
vi.mock('../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ id: 'viewer-1' }),
}));
vi.mock('../src/hooks/useMttLobbyEntryCounts', () => ({
  useMttLobbyEntryCounts: (rows: unknown[]) => rows,
}));
vi.mock('../src/services/tableWarmup', () => ({
  warmTable: vi.fn(),
  observeLobbyTableWarmups: () => () => {},
}));
vi.mock('../src/hooks/useSpinTierAvailability', () => ({
  useSpinTierAvailability: () => ({ can_draw_100x: false }),
}));

import GameLobbyPanel from '../src/components/lobby/GameLobbyPanel';
import LobbyTable from '../src/components/lobby/LobbyTable';
import { tournamentEntry, type LobbyTournamentRow } from '../src/components/lobby/lobbyEntries';
import DetailOverviewTab from '../src/components/tournament/details/DetailOverviewTab';
import BlindsTab from '../src/components/tournament/details/BlindsTab';
import TournamentLobbyCard from '../src/components/tournament/TournamentLobbyCard';

const ROOT = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const NOW_ISO = '2026-11-22T18:00:00.000Z';
const FUTURE_START_ISO = '2026-11-22T19:30:00.000Z';

function makeRawRow(
  overrides: Partial<LobbyTournamentRow> & Record<string, unknown>
): LobbyTournamentRow {
  return {
    id: 'evt-1',
    name: 'Test Event',
    game_type: 'NLH',
    buy_in_amount: 25,
    buy_in_fee: 0,
    guaranteed_prize: 0,
    start_time: FUTURE_START_ISO,
    status: 'REGISTERING',
    current_players: 1,
    max_players: 3,
    starting_chips: 500,
    ...overrides,
  } as LobbyTournamentRow;
}

function makeTabProps(overrides: Record<string, unknown>): TournamentTabProps {
  return {
    tournament: {
      id: 'evt-detail',
      name: 'Test Tournament',
      status: 'REGISTERING',
      start_time: FUTURE_START_ISO,
      starting_chips: 1500,
      game_type: 'nlh',
      current_players: 1,
      prize_pool: 0,
      buy_in_amount: 25,
      buy_in_fee: 0,
      arena: { id: 'club-1', asset: 'chips', is_platform: false, union_id: null },
      ...overrides,
    } as unknown as TournamentTabProps['tournament'],
    entries: [],
    tables: [],
    blindLevels: [
      { level: 1, smallBlind: 10, bigBlind: 20, ante: 0, duration: 3, isBreak: false },
      { level: 2, smallBlind: 15, bigBlind: 30, ante: 0, duration: 3, isBreak: false },
    ],
    isRegistered: false,
  };
}

describe('tournamentStartsWhenFull authoritative predicate', () => {
  it('returns true for Spins, Heads-Up SNGs, 6/9-max SNGs, and SNG satellites', () => {
    expect(tournamentStartsWhenFull({ format_contract: 'spin-v1', max_players: 3 })).toBe(true);
    expect(tournamentStartsWhenFull({ format_contract: 'sng-v1', max_players: 2 })).toBe(true);
    expect(tournamentStartsWhenFull({ format_contract: 'sng-v1', max_players: 6 })).toBe(true);
    expect(tournamentStartsWhenFull({ format_contract: 'sng-v1', max_players: 9 })).toBe(true);
    expect(
      tournamentStartsWhenFull({ format_contract: 'seat-first-satellite-v1', max_players: 9 })
    ).toBe(true);
    expect(
      tournamentStartsWhenFull({
        format_contract: 'sng-v1',
        tournament_type: 'SNG',
        variant: 'sng',
        max_players: 6,
        min_players: 6,
        table_size: 6,
        satellite_seats: 2,
        satellite_target_id: 'target-1',
      })
    ).toBe(true);

    // Mapped client objects without persisted format_contract
    expect(tournamentStartsWhenFull({ kind: 'spin' })).toBe(true);
    expect(tournamentStartsWhenFull({ kind: 'sng' })).toBe(true);
    expect(tournamentStartsWhenFull({ type: 'spin' })).toBe(true);
    expect(tournamentStartsWhenFull({ type: 'sng' })).toBe(true);
    expect(tournamentStartsWhenFull({ variant: 'spin' })).toBe(true);
    expect(tournamentStartsWhenFull({ variant: 'sng' })).toBe(true);
    expect(tournamentStartsWhenFull({ tournament_type: 'SPIN' })).toBe(true);
    expect(tournamentStartsWhenFull({ tournament_type: 'SNG' })).toBe(true);
    expect(tournamentStartsWhenFull({ tournamentType: 'SNG' })).toBe(true);
  });

  it('returns false for scheduled MTTs, scheduled MTT satellites, cash, and empty inputs', () => {
    expect(
      tournamentStartsWhenFull({
        format_contract: 'mtt-v1',
        tournament_type: 'MTT',
        variant: 'nlh',
      })
    ).toBe(false);
    expect(
      tournamentStartsWhenFull({
        format_contract: 'mtt-v2',
        tournament_type: 'SATELLITE',
        variant: 'satellite',
        satellite_target_id: 'target-1',
      })
    ).toBe(false);
    // Persisted mtt-v2 format contract always overrides noisy client labels.
    expect(
      tournamentStartsWhenFull({
        format_contract: 'mtt-v2',
        variant: 'sng',
        tournament_type: 'SNG',
      })
    ).toBe(false);
    expect(tournamentStartsWhenFull({ kind: 'mtt' })).toBe(false);
    expect(tournamentStartsWhenFull({ kind: 'cash' })).toBe(false);
    expect(tournamentStartsWhenFull({ type: 'mtt' })).toBe(false);
    expect(tournamentStartsWhenFull({ type: 'pko' })).toBe(false);
    expect(tournamentStartsWhenFull({ type: 'bounty' })).toBe(false);
    expect(tournamentStartsWhenFull({ type: 'mystery' })).toBe(false);
    expect(tournamentStartsWhenFull({ tournament_type: 'MTT', variant: 'sng' })).toBe(false);
    expect(tournamentStartsWhenFull({})).toBe(false);
    expect(tournamentStartsWhenFull(null)).toBe(false);
    expect(tournamentStartsWhenFull(undefined)).toBe(false);
  });
});

describe('Rendered Club Arena surfaces never leak start clocks for Spins or SNGs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    getTournamentMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('GameLobbyPanel shows When Full (never AM/PM clock time) for Spin and SNG, and keeps clock time for MTT', () => {
    const cases: Array<{
      label: string;
      kind: 'spin' | 'sng' | 'mtt';
      raw: LobbyTournamentRow;
      expectWhenFull: boolean;
    }> = [
      {
        label: 'Spin',
        kind: 'spin',
        raw: makeRawRow({
          id: 'spin-glp',
          name: '25 Chip Spin & Go',
          format_contract: 'spin-v1',
          tournament_type: 'SPIN',
          variant: 'spin',
          max_players: 3,
        }),
        expectWhenFull: true,
      },
      {
        label: 'SNG',
        kind: 'sng',
        raw: makeRawRow({
          id: 'sng-glp',
          name: '50 Chip Heads-Up',
          format_contract: 'sng-v1',
          tournament_type: 'SNG',
          variant: 'sng',
          max_players: 2,
        }),
        expectWhenFull: true,
      },
      {
        label: 'MTT',
        kind: 'mtt',
        raw: makeRawRow({
          id: 'mtt-glp',
          name: 'Nightly 10K NLH',
          format_contract: 'mtt-v2',
          tournament_type: 'MTT',
          variant: 'nlh',
          max_players: null,
        }),
        expectWhenFull: false,
      },
    ];

    for (const c of cases) {
      cleanup();
      getTournamentMock.mockResolvedValue(c.raw);
      render(
        <MemoryRouter>
          <GameLobbyPanel
            entry={tournamentEntry(c.raw, c.kind)}
            clubId="club-1"
            currentUserId="viewer-1"
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
      const startsTerm = [...document.querySelectorAll('dt')].find(
        (dt) => dt.textContent?.trim() === 'Starts'
      );
      const ddText = startsTerm?.parentElement?.querySelector('dd')?.textContent?.trim() ?? '';
      if (c.expectWhenFull) {
        expect(ddText, `${c.label} Starts dd`).toBe('When Full');
        expect(ddText, `${c.label} must not show AM/PM`).not.toMatch(/\b(?:AM|PM)\b/i);
      } else {
        expect(ddText, 'MTT Starts dd').not.toBe('When Full');
        expect(ddText, 'MTT Starts dd should show clock time').toMatch(/\b(?:AM|PM)\b/i);
      }
    }
  });

  it('DetailOverviewTab shows When Full for Spin and SNG and keeps Starts In countdown for MTT', () => {
    const spin = render(
      <MemoryRouter>
        <DetailOverviewTab
          {...makeTabProps({
            id: 'spin-dov',
            format_contract: 'spin-v1',
            tournament_type: 'SPIN',
            variant: 'spin',
            max_players: 3,
          })}
        />
      </MemoryRouter>
    );
    expect(spin.container.querySelector('.dov-hero__eyebrow')?.textContent).toBe('Starts');
    expect(spin.container.querySelector('.dov-hero__time')?.textContent).toBe('When Full');
    expect(spin.container.textContent).not.toContain('Starts In');
    expect(spin.container.textContent).not.toMatch(/\b(?:AM|PM)\b/i);
    cleanup();

    const sng = render(
      <MemoryRouter>
        <DetailOverviewTab
          {...makeTabProps({
            id: 'sng-dov',
            format_contract: 'sng-v1',
            tournament_type: 'SNG',
            variant: 'sng',
            max_players: 2,
          })}
        />
      </MemoryRouter>
    );
    expect(sng.container.querySelector('.dov-hero__eyebrow')?.textContent).toBe('Starts');
    expect(sng.container.querySelector('.dov-hero__time')?.textContent).toBe('When Full');
    expect(sng.container.textContent).not.toContain('Starts In');
    expect(sng.container.textContent).not.toMatch(/\b(?:AM|PM)\b/i);
    cleanup();

    const mtt = render(
      <MemoryRouter>
        <DetailOverviewTab
          {...makeTabProps({
            id: 'mtt-dov',
            format_contract: 'mtt-v2',
            tournament_type: 'MTT',
            variant: 'nlh',
            max_players: null,
          })}
        />
      </MemoryRouter>
    );
    expect(mtt.container.querySelector('.dov-hero__eyebrow')?.textContent).toBe('Starts In');
    expect(mtt.container.querySelector('.dov-hero__time')?.textContent).toBe('1:30:00');
  });

  it('BlindsTab shows --:-- and Starts When Full for Spin and SNG, and keeps Starts In countdown for MTT', () => {
    for (const overrides of [
      { format_contract: 'spin-v1', tournament_type: 'SPIN', variant: 'spin', max_players: 3 },
      { format_contract: 'sng-v1', tournament_type: 'SNG', variant: 'sng', max_players: 6 },
    ]) {
      cleanup();
      const { container } = render(<BlindsTab {...makeTabProps(overrides)} />);
      expect(container.querySelector('.blinds-tab__clock')?.textContent?.trim()).toBe('--:--');
      expect(container.textContent).toContain('Starts When Full');
      expect(container.textContent).not.toContain('Starts In');
    }

    cleanup();
    const mtt = render(
      <BlindsTab
        {...makeTabProps({
          format_contract: 'mtt-v2',
          tournament_type: 'MTT',
          variant: 'nlh',
          max_players: null,
        })}
      />
    );
    expect(mtt.container.textContent).toContain('Starts In');
    expect(mtt.container.textContent).not.toContain('Starts When Full');
  });

  it('TournamentLobbyCard shows When Full (never Starts In) for Spin and SNG even without explicit startsWhenFull prop, and keeps Starts In for MTT', () => {
    for (const card of [
      {
        id: 'spin-card',
        name: '25 Spin',
        format_contract: 'spin-v1' as const,
        type: 'spin' as const,
        buyIn: 25,
        prizePool: 0,
        maxPlayers: 3,
        registeredPlayers: 1,
        startsAt: FUTURE_START_ISO,
        status: 'registering' as const,
        blindStructure: 'Hyper',
      },
      {
        id: 'sng-card',
        name: '50 Heads-Up',
        format_contract: 'sng-v1' as const,
        type: 'sng' as const,
        buyIn: 50,
        prizePool: 0,
        maxPlayers: 2,
        registeredPlayers: 1,
        startsAt: FUTURE_START_ISO,
        status: 'registering' as const,
        blindStructure: 'Turbo',
      },
    ]) {
      cleanup();
      const { container } = render(
        <MemoryRouter>
          <TournamentLobbyCard tournament={card} knownRegistration={false} unframed />
        </MemoryRouter>
      );
      expect(container.textContent).toContain('When Full');
      expect(container.textContent).not.toContain('Starts In');
    }

    cleanup();
    const mtt = render(
      <MemoryRouter>
        <TournamentLobbyCard
          tournament={{
            id: 'mtt-card',
            name: 'Nightly 10K',
            format_contract: 'mtt-v2',
            type: 'mtt',
            buyIn: 100,
            prizePool: 10000,
            maxPlayers: null,
            registeredPlayers: 42,
            startsAt: FUTURE_START_ISO,
            status: 'registering',
            blindStructure: 'Regular',
          }}
          knownRegistration={false}
          unframed
        />
      </MemoryRouter>
    );
    expect(mtt.container.textContent).toContain('Starts In');
    expect(mtt.container.textContent).not.toContain('When Full');
  });

  it('LobbyTable keeps open Spin status bay invite-only even if status arrives as starting_soon', () => {
    const spinSoon = {
      ...tournamentEntry(
        makeRawRow({
          id: 'spin-soon-1',
          name: '25 Chip Spin & Go',
          format_contract: 'spin-v1',
          tournament_type: 'SPIN',
          variant: 'spin',
          max_players: 3,
          current_players: 2,
        }),
        'spin'
      ),
      status: 'starting_soon' as const,
      statusLabel: 'Starting Soon',
    };

    const { container } = render(
      <MemoryRouter>
        <LobbyTable
          entries={[spinSoon]}
          category="SPIN"
          selectedId={null}
          onSelect={vi.fn()}
          onActivate={vi.fn()}
          ctx={{
            waitlistedIds: new Set(),
            seatedIds: new Set(),
            registeredIds: new Set(),
            favoriteIds: new Set(),
            inviteCode: 'ABC2345',
          }}
        />
      </MemoryRouter>
    );

    const statusCell = container.querySelector('.lt-statuscell');
    expect(statusCell).toBeTruthy();
    expect(statusCell?.classList.contains('lt-statuscell--invite-only')).toBe(true);
    expect(statusCell?.querySelector('.lt-badge')).toBeNull();
    expect(within(statusCell as HTMLElement).getByRole('button', { name: /Invite/i })).toBeTruthy();
  });
});

describe('Source contract: every Club Arena tournament surface wires tournamentStartsWhenFull', () => {
  const wiredSurfaces = [
    'src/components/lobby/GameLobbyPanel.tsx',
    'src/components/lobby/LobbyTable.tsx',
    'src/components/tournament/details/DetailOverviewTab.tsx',
    'src/components/tournament/details/BlindsTab.tsx',
    'src/components/tournament/details/useSatellites.ts',
    'src/components/tournament/TournamentLobbyCard.tsx',
    'src/pages/tournament/TournamentLobbyPage.tsx',
    'src/pages/TournamentPage.tsx',
    'src/pages/ClubHomePage.tsx',
    'src/pages/UnionGamesPage.tsx',
    'src/pages/XMTTPage.tsx',
    'src/pages/tournament/TournamentDetails.tsx',
    'src/pages/SearchPage.tsx',
  ];

  it.each(wiredSurfaces)('%s imports and calls tournamentStartsWhenFull', (file) => {
    const src = readSrc(file);
    expect(src).toContain('tournamentStartsWhenFull');
    expect(src).toMatch(/tournamentStartsWhenFull\(/);
  });

  it('LobbyTable spinInviteOnlyStatus covers registering, open, and starting_soon', () => {
    const src = readSrc('src/components/lobby/LobbyTable.tsx');
    const block = src.slice(
      src.indexOf('function spinInviteOnlyStatus'),
      src.indexOf('function TournamentHeadingRow')
    );
    expect(block).toContain("entry.status === 'registering'");
    expect(block).toContain("entry.status === 'open'");
    expect(block).toContain("entry.status === 'starting_soon'");
  });
});
