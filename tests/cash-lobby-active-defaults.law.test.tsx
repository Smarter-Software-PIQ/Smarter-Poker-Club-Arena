import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alwaysShownEmptyCashGame,
  cashBoardVisible,
} from '../src/components/lobby/cashBoardVisibility';
import { cashEntry, type LobbyTableRow } from '../src/components/lobby/lobbyEntries';
import LobbyTable from '../src/components/lobby/LobbyTable';
import { FILTER_SPECS } from '../src/components/lobby/advancedFilterSpec';
import { cashBoardComparator } from '../src/components/lobby/cashBoardOrder';
import { parseLightningLobbyState } from '../src/lightning/lightningLobby';

vi.mock('../src/hooks/useSpinTierAvailability', () => ({
  useSpinTierAvailability: () => null,
}));
vi.mock('../src/services/tableWarmup', () => ({
  observeLobbyTableWarmups: () => () => {},
  warmTable: vi.fn(),
}));
beforeEach(() => localStorage.clear());
afterEach(cleanup);
const row = (extra: Partial<LobbyTableRow> = {}): LobbyTableRow => ({
  id: 'cash',
  name: 'Cash',
  game_variant: 'plo4',
  small_blind: 0.5,
  big_blind: 1,
  min_buy_in: 40,
  max_buy_in: 200,
  max_players: 6,
  current_players: 2,
  status: 'running',
  ...extra,
});

describe('cash lobby shows open occupied games unless the player asks for empties', () => {
  it('hides zero or unknown occupancy on every normal status, then allows explicit opt-in', () => {
    for (const status of ['running', 'active', 'waiting', 'RUNNING']) {
      for (const current_players of [0, null, undefined]) {
        const table = row({ status, current_players } as Partial<LobbyTableRow>);
        expect(cashBoardVisible(table)).toBe(false);
        expect(cashBoardVisible(table, true)).toBe(true);
      }
      expect(cashBoardVisible(row({ status }))).toBe(true);
    }
  });
  it('always shows empty 1/2 No Limit and 1/2 PLO so a human can sit down (owner 2026-11-05)', () => {
    for (const game_variant of ['nlh', 'plo4', 'plo5', 'plo6', 'PLO4']) {
      const empty = row({ game_variant, small_blind: 1, big_blind: 2, current_players: 0 });
      expect(alwaysShownEmptyCashGame(empty)).toBe(true);
      expect(cashBoardVisible(empty)).toBe(true);
      const emptyCluster = row({
        game_variant,
        small_blind: 1,
        big_blind: 2,
        cluster_id: 'one-two',
        lifecycle: 'live',
        cluster_enabled: true,
        cluster_front: true,
        cluster_players: 0,
        cluster_tables: 1,
        current_players: 0,
      });
      expect(cashEntry(emptyCluster).players).toBe(0);
      expect(cashBoardVisible(emptyCluster)).toBe(true);
    }
    // Only 1/2 No Limit and PLO: other stakes and other games keep the hide-empty default.
    for (const extra of [
      { game_variant: 'nlh', small_blind: 0.5, big_blind: 1 },
      { game_variant: 'plo4', small_blind: 2, big_blind: 5 },
      { game_variant: 'flh', small_blind: 1, big_blind: 2 },
      { game_variant: 'short_deck', small_blind: 1, big_blind: 2 },
      { game_variant: 'plo8', small_blind: 1, big_blind: 2 },
    ]) {
      expect(cashBoardVisible(row({ ...extra, current_players: 0 }))).toBe(false);
    }
    // Always shown never reopens a closed, deleted or disabled game.
    for (const extra of [
      { status: 'closed' },
      { is_deleted: true },
      { lifecycle: 'closed' },
      {
        cluster_id: 'one-two',
        lifecycle: 'live',
        cluster_enabled: false,
        cluster_front: true,
        cluster_players: 0,
        cluster_tables: 1,
      },
    ])
      expect(
        cashBoardVisible(
          row({ game_variant: 'nlh', small_blind: 1, big_blind: 2, current_players: 0, ...extra })
        )
      ).toBe(false);
  });
  it('never offers closed, deleted, paused, disabled or unknown games, even with opt-in', () => {
    const rows = [
      ...['closed', 'deleted', 'paused', 'archived', ''].map((status) => row({ status })),
      row({ is_deleted: true }),
      row({ lifecycle: 'closed' }),
      row({
        cluster_id: 'cluster',
        lifecycle: 'live',
        cluster_enabled: false,
        cluster_front: true,
        cluster_players: 3,
        cluster_tables: 1,
      }),
    ];
    for (const table of rows) expect(cashBoardVisible(table, true)).toBe(false);
  });
  it('judges a cluster by the players its card shows rather than an empty front table', () => {
    const table = row({
      cluster_id: 'cluster',
      lifecycle: 'live',
      cluster_enabled: true,
      cluster_front: true,
      cluster_players: 4,
      cluster_tables: 2,
      current_players: 0,
    });
    expect(cashEntry(table).players).toBe(4);
    expect(cashBoardVisible(table)).toBe(true);
    expect(cashBoardVisible({ ...table, cluster_players: 0 })).toBe(false);
  });
  it('uses Lightning live eligibility rather than a stale physical-table count', () => {
    const table = row({
      cluster_id: 'lightning',
      lifecycle: 'live',
      cluster_enabled: true,
      cluster_front: true,
      cluster_template: 'madness',
      cluster_handedness: 6,
      cluster_mode: 'lightning',
      cluster_players: 0,
      cluster_tables: 1,
      current_players: 0,
      cluster_lightning: parseLightningLobbyState({
        cluster_mode: 'lightning',
        thresholds: { on: 18, off: 12 },
        verdict: { live_eligible: 20 },
      }),
    });
    expect(cashEntry(table).players).toBe(20);
    expect(cashBoardVisible(table)).toBe(true);
    const empty = {
      ...table,
      current_players: 6,
      cluster_players: 6,
      cluster_lightning: parseLightningLobbyState({
        cluster_mode: 'lightning',
        thresholds: { on: 18, off: 12 },
        verdict: { live_eligible: 0 },
      }),
    };
    expect(cashEntry(empty).players).toBe(0);
    expect(cashBoardVisible(empty)).toBe(false);
  });
  it('saved cash seat chips cannot opt into empties; seat-first tournament filters retain them', () => {
    for (const tab of ['HOLDEM', 'OMAHA', 'LIMIT'] as const)
      expect(FILTER_SPECS[tab].statuses.map((s) => s.key)).not.toContain('empty');
    expect(FILTER_SPECS.SPIN.statuses.map((s) => s.key)).toContain('empty');
    const source = readFileSync('src/pages/ClubHomePage.tsx', 'utf8');
    expect(source).toContain('const [showEmptyTables, setShowEmptyTables] = useState(false)');
    expect(source).toContain(
      'if (!cashBoardVisible(table as unknown as LobbyTableRow, showEmptyTables)) return false'
    );
    expect(source.indexOf('if (!cashBoardVisible(')).toBeLessThan(
      source.indexOf('if (advSpec && advValue && table.id !== linkedGameId)')
    );
    expect(source.match(/\{showEmptyTablesButton\}/g)).toHaveLength(2);
    expect(source).toContain('<LobbyFilterLabel>Show Empty Tables</LobbyFilterLabel>');
    expect(source).toContain('setShowEmptyTables(false)');
  });
  it.each(['ALL', 'HOLDEM', 'OMAHA', 'LIMIT'] as const)(
    '%s renders highest stakes first on mobile and desktop, including featured games',
    (category) => {
      const rows = [
        row({ id: 'low', big_blind: 1, is_featured: true }),
        row({ id: 'high', big_blind: 10 }),
        row({ id: 'middle', big_blind: 5 }),
      ];
      rows.sort(cashBoardComparator('stakes_high', category));
      render(
        <MemoryRouter>
          <LobbyTable
            entries={rows.filter((t) => cashBoardVisible(t)).map((t) => cashEntry(t))}
            category={category}
            selectedId={null}
            onSelect={vi.fn()}
            onActivate={vi.fn()}
            ctx={{
              waitlistedIds: new Set(),
              seatedIds: new Set(),
              registeredIds: new Set(),
              favoriteIds: new Set(),
            }}
          />
        </MemoryRouter>
      );
      for (const selector of [
        '.compact-lobby tbody tr[data-id]',
        '.lobby-table-wrap tbody tr[data-id]',
      ])
        expect(
          [...document.querySelectorAll(selector)].map((r) => r.getAttribute('data-id'))
        ).toEqual(['high', 'middle', 'low']);
    }
  );
});
