// @vitest-environment happy-dom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyTable from '../../src/components/lobby/LobbyTable';
import {
  cashEntry,
  tournamentEntry,
  type LobbyTableRow,
  type LobbyTournamentRow,
} from '../../src/components/lobby/lobbyEntries';

const shareMock = vi.hoisted(() => ({
  shareLink: vi.fn(),
}));

vi.mock('../../src/lib/share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/share')>();
  return {
    ...actual,
    shareLink: shareMock.shareLink,
  };
});

vi.mock('../../src/hooks/useMttLobbyEntryCounts', () => ({
  useMttLobbyEntryCounts: (rows: unknown[]) => rows,
}));
vi.mock('../../src/services/tableWarmup', () => ({
  warmTable: vi.fn(),
  observeLobbyTableWarmups: () => () => {},
}));
vi.mock('../../src/hooks/useSpinTierAvailability', () => ({
  useSpinTierAvailability: () => ({ can_draw_100x: false }),
}));

const baseCtx = {
  waitlistedIds: new Set<string>(),
  seatedIds: new Set<string>(),
  registeredIds: new Set<string>(),
  favoriteIds: new Set<string>(),
  inviteCode: 'ABC2345',
};

function makeTournament(overrides: Partial<LobbyTournamentRow> = {}): LobbyTournamentRow {
  return {
    id: 't-1',
    name: 'Test Tournament',
    game_type: 'NLH',
    buy_in_amount: 25,
    buy_in_fee: 0,
    guaranteed_prize: 0,
    start_time: new Date(Date.now() + 300_000).toISOString(),
    status: 'REGISTERING',
    current_players: 1,
    max_players: 2,
    starting_chips: 1500,
    ...overrides,
  };
}

describe('Lobby card Invite placement & layout contracts (SNG, Spin, MTT, Cash)', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    shareMock.shareLink.mockResolvedValue('copied');
  });

  afterEach(() => {
    cleanup();
  });

  it('SNG cards (Heads-Up & Satellites) place clickable Invite in the top-right metallic plaque instead of N Seats and render no duplicate Invite in COL_STATUS', async () => {
    const onSelect = vi.fn();
    const sat = {
      ...tournamentEntry(
        makeTournament({
          id: 'sng-sat-9',
          name: 'Satellite Into Sunday 200 Deep Stack',
          variant: 'sng',
          tournament_type: 'SATELLITE',
          format_contract: 'seat-first-satellite-v1',
          is_satellite: true,
          satellite_target: 'Sunday 200 Deep Stack',
          max_players: 9,
          current_players: 0,
          buy_in_amount: 57,
        }),
        'sng'
      ),
      status: 'starting_soon' as const,
      statusLabel: 'Starting Soon',
    };
    const hu = tournamentEntry(
      makeTournament({
        id: 'sng-hu-2',
        name: '50 Chip Heads-Up NLH',
        variant: 'sng',
        format_contract: 'sng-v1',
        max_players: 2,
        current_players: 1,
        buy_in_amount: 50,
      }),
      'sng'
    );

    render(
      <MemoryRouter>
        <LobbyTable
          entries={[sat, hu]}
          category="SNG"
          selectedId={null}
          onSelect={onSelect}
          onActivate={onSelect}
          ctx={baseCtx}
        />
      </MemoryRouter>
    );

    for (const scope of ['.compact-lobby', '.lobby-table']) {
      const table = document.querySelector(scope)!;
      for (const [id, expectedStatus] of [
        ['sng-sat-9', 'Starting Soon'],
        ['sng-hu-2', 'Seats Available'],
      ] as const) {
        const heading = table.querySelector(`tr[data-game-heading="${id}"]`) as HTMLElement;
        const body = table.querySelector(`tr[data-id="${id}"]`) as HTMLElement;
        const plaque = heading.querySelector('.lt-tournament-heading__guarantee') as HTMLElement;
        const statusCell = body.querySelector('td[data-label="Status"]') as HTMLElement;

        // Top-right metallic plaque shows clickable Invite, NEVER "9 Seats" / "2 Seats".
        expect(plaque.textContent).not.toMatch(/\d+\s+Seats/);
        const plaqueBtn = within(plaque).getByTestId('lobby-invite-btn');
        expect(plaqueBtn.textContent).toContain('Invite');

        // Bottom-right status bay holds ONLY status, NO duplicate Invite button.
        expect(within(statusCell).queryByTestId('lobby-invite-btn')).toBeNull();
        expect(statusCell.querySelector('.lt-status')?.textContent?.trim()).toBe(expectedStatus);
      }
    }

    // Clicking the plaque Invite shares the canonical /t/:id URL without opening the row.
    const compactPlaqueBtn = document.querySelector(
      '.compact-lobby tr[data-game-heading="sng-hu-2"] .lt-tournament-heading__guarantee [data-testid="lobby-invite-btn"]'
    ) as HTMLElement;
    fireEvent.click(compactPlaqueBtn);

    await waitFor(() => {
      expect(shareMock.shareLink).toHaveBeenCalledTimes(1);
    });
    expect(shareMock.shareLink.mock.calls[0][0].url).toMatch(/\/t\/sng-hu-2$/);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('completed/closed SNG keeps N Seats fallback in the plaque and renders no Invite button', () => {
    const completedSng = tournamentEntry(
      makeTournament({
        id: 'sng-done',
        name: '25 Chip Heads-Up NLH',
        variant: 'sng',
        format_contract: 'sng-v1',
        status: 'COMPLETED',
        max_players: 2,
        current_players: 2,
      }),
      'sng'
    );

    render(
      <MemoryRouter>
        <LobbyTable
          entries={[completedSng]}
          category="SNG"
          selectedId={null}
          onSelect={() => {}}
          onActivate={() => {}}
          ctx={baseCtx}
        />
      </MemoryRouter>
    );

    const heading = document.querySelector(
      '.compact-lobby tr[data-game-heading="sng-done"]'
    ) as HTMLElement;
    const body = document.querySelector('.compact-lobby tr[data-id="sng-done"]') as HTMLElement;
    expect(heading.querySelector('.lt-tournament-heading__guarantee')?.textContent).toBe('2 Seats');
    expect(heading.querySelector('[data-testid="lobby-invite-btn"]')).toBeNull();
    expect(body.querySelector('[data-testid="lobby-invite-btn"]')).toBeNull();
  });

  it('open/registering Spin cards keep Win Up To 100x plaque and render ONLY the Share/Invite button in COL_STATUS without Seats Available', () => {
    const regSpin = tournamentEntry(
      makeTournament({
        id: 'spin-reg',
        name: '100 Chip Spin PLO4',
        game_type: 'PLO4',
        variant: 'spin',
        format_contract: 'spin-v1',
        buy_in_amount: 100,
        max_players: 3,
        current_players: 2,
        status: 'REGISTERING',
      }),
      'spin'
    );
    const openSpin = {
      ...tournamentEntry(
        makeTournament({
          id: 'spin-open',
          name: '5 Chip Spin NLH',
          game_type: 'NLH',
          variant: 'spin',
          format_contract: 'spin-v1',
          buy_in_amount: 5,
          max_players: 3,
          current_players: 0,
          status: 'REGISTERING',
        }),
        'spin'
      ),
      status: 'open' as const,
      statusLabel: 'Seats Available',
    };
    const runningSpin = tournamentEntry(
      makeTournament({
        id: 'spin-run',
        name: '25 Chip Spin NLH',
        game_type: 'NLH',
        variant: 'spin',
        format_contract: 'spin-v1',
        buy_in_amount: 25,
        max_players: 3,
        current_players: 3,
        status: 'RUNNING',
      }),
      'spin'
    );

    render(
      <MemoryRouter>
        <LobbyTable
          entries={[regSpin, openSpin, runningSpin]}
          category="SPIN"
          selectedId={null}
          onSelect={() => {}}
          onActivate={() => {}}
          ctx={baseCtx}
        />
      </MemoryRouter>
    );

    for (const scope of ['.compact-lobby', '.lobby-table']) {
      const table = document.querySelector(scope)!;

      for (const id of ['spin-reg', 'spin-open']) {
        const heading = table.querySelector(`tr[data-game-heading="${id}"]`) as HTMLElement;
        const body = table.querySelector(`tr[data-id="${id}"]`) as HTMLElement;
        const plaque = heading.querySelector('.lt-tournament-heading__guarantee') as HTMLElement;
        const statusCell = body.querySelector('td[data-label="Status"]') as HTMLElement;

        // Top-right metallic plaque keeps Spin top prize intact.
        expect(plaque.textContent).toContain('Win Up To 100x');
        expect(plaque.querySelector('[data-testid="lobby-invite-btn"]')).toBeNull();

        // Bottom-right glass bay is Invite-only (no redundant Seats Available).
        expect(statusCell.querySelector('.lt-statuscell--invite-only')).not.toBeNull();
        expect(statusCell.querySelector('.lt-status')).toBeNull();
        expect(statusCell.textContent).not.toContain('Seats Available');
        expect(within(statusCell).getByTestId('lobby-invite-btn')).toBeTruthy();
      }

      // Running Spin retains its Running status label.
      const runBody = table.querySelector('tr[data-id="spin-run"]') as HTMLElement;
      const runStatusCell = runBody.querySelector('td[data-label="Status"]') as HTMLElement;
      expect(runStatusCell.querySelector('.lt-statuscell--invite-only')).toBeNull();
      expect(runStatusCell.querySelector('.lt-status')?.textContent?.trim()).toBe('Running');
    }
  });

  it('Cash and MTT cards retain their top-right plaques and status + invite controls', () => {
    const cash = cashEntry({
      id: 'cash-1',
      name: 'NLH 1/2 Classic',
      game_variant: 'nlh',
      small_blind: 1,
      big_blind: 2,
      min_buy_in: 80,
      max_buy_in: 400,
      current_players: 4,
      max_players: 6,
      status: 'open',
      cluster_id: 'c-1',
      cluster_template: 'classic',
    } as LobbyTableRow);

    render(
      <MemoryRouter>
        <LobbyTable
          entries={[cash]}
          category="HOLDEM"
          selectedId={null}
          onSelect={() => {}}
          onActivate={() => {}}
          ctx={baseCtx}
        />
      </MemoryRouter>
    );

    const statusCell = document.querySelector(
      '.compact-lobby tr[data-id="cash-1"] td[data-label="Status"]'
    ) as HTMLElement;
    expect(statusCell.querySelector('.lt-status')?.textContent?.trim()).toBe('Seats Available');
    expect(statusCell.querySelector('[data-testid="lobby-invite-btn"]')).not.toBeNull();
  });

  it('PremiumMttRows.css enforces horizontal/vertical glass bay clearance, elevates .lt-invite-btn, and introduces zero :hover rules', () => {
    const css = readFileSync(
      resolve(__dirname, '../../src/components/lobby/PremiumMttRows.css'),
      'utf8'
    );
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(stripped).not.toMatch(/:hover\b/);
    expect(stripped).toContain('.lt-tournament-heading__guarantee .lt-invite-btn');
    expect(stripped).toContain('.lt-statuscell--invite-only');
    expect(stripped).toContain('position: relative');
    expect(stripped).toContain('z-index: 2');
    expect(stripped).toContain('padding-right: 1.1cqw !important');
    expect(stripped).toContain('padding-left: 6.5cqw !important');
  });
});
