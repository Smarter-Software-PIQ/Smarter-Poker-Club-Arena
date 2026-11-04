import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  RETIRED_TABLE_IDS,
  isRetiredTableId,
  RETIRED_TOURNAMENT_IDS,
  isRetiredTournament,
  isRetiredTournamentTable,
} from '../../src/lib/retiredTournamentVisibility';

describe('owner-retired exact tournament cohort', () => {
  const read = (name: string) =>
    JSON.parse(fs.readFileSync(`scripts/ci/fixtures/tournament-abort/${name}`, 'utf8'));
  const original = read('owner-retirement-nov2-manifest.json');
  const additional = read('owner-closeout-nov3-additional.json');
  it('contains all and only the original140 plus additional5 immutable event IDs', () => {
    const expected = [...original.targets, ...additional.targets].map((row) => row.tournament_id);
    expect(expected).toHaveLength(145);
    expect(new Set(RETIRED_TOURNAMENT_IDS).size).toBe(145);
    expect([...RETIRED_TOURNAMENT_IDS].sort()).toEqual(expected.sort());
    expect(Object.isFrozen(RETIRED_TOURNAMENT_IDS)).toBe(true);
  });
  it('retires exactly456 unique known children belonging only to the145 events', () => {
    const rows = JSON.parse(fs.readFileSync('src/lib/retiredTournamentTables.json', 'utf8'));
    expect(rows).toHaveLength(456);
    expect(new Set(RETIRED_TABLE_IDS).size).toBe(456);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['id', 'tournament_id']);
      expect(isRetiredTournament(row.tournament_id)).toBe(true);
      expect(isRetiredTableId(row.id)).toBe(true);
      expect(isRetiredTournamentTable({ id: row.id })).toBe(true);
    }
    expect(isRetiredTableId('new-cash-table')).toBe(false);
    expect(isRetiredTableId(undefined)).toBe(false);
  });
  it('preserves other events, cash tables, empty input and explicitly preserved events', () => {
    for (const id of original.preserved_outside_diamond_event_ids)
      expect(isRetiredTournament(id)).toBe(false);
    for (const id of [undefined, null, '', 'new-event', '00000000-0000-4000-8000-000000000000'])
      expect(isRetiredTournament(id)).toBe(false);
    expect(isRetiredTournamentTable({ tournament_id: null })).toBe(false);
    expect(isRetiredTournamentTable(undefined)).toBe(false);
  });
  it('recognizes both table relationship shapes and uppercase UUIDs without changing rows', () => {
    const id = RETIRED_TOURNAMENT_IDS[0];
    const row = Object.freeze({ tournament_id: id, status: 'RUNNING' });
    expect(isRetiredTournamentTable(row)).toBe(true);
    expect(isRetiredTournamentTable({ tournamentId: id })).toBe(true);
    expect(isRetiredTournament(id.toUpperCase())).toBe(true);
    expect(row.status).toBe('RUNNING');
  });
  it('gates restoration, live admissions, deep links and rendering with the shared policy', () => {
    const source = fs.readFileSync('src/pages/MultiTablePage.tsx', 'utf8');
    const contains = (text: string) =>
      expect(source.replace(/\s/g, '')).toContain(text.replace(/\s/g, ''));
    contains('anchorRows.filter((row) => !isRetiredTournamentTable(row))');
    contains('if (isRetiredTournamentTable(newRow)) { requestSeatResync(); return; }');
    contains('if (isRetiredTournament(target.tournamentId)) return true;');
    contains(
      "if (isRetiredTournament(tournamentId)) { navigate('/clubs', { replace: true }); return; }"
    );
    contains('routeTableId && !isRetiredTableId(routeTableId)');
    contains('const visible = proposed.filter(visibleRetirementTab)');
    contains('return visible.length === proposed.length ? proposed : visible');
    contains('storedTables.filter(visibleRetirementTab)');
    const tablePage = fs.readFileSync('src/pages/TablePage.tsx', 'utf8');
    expect(tablePage).toContain('if (isRetiredTournamentTable(table) && isMounted)');
    expect(tablePage).toContain(
      "masterBus.emit('TABLE_MENU_ACTION', { tableId, action: 'CLOSE_TABLE_TAB' })"
    );
  });
});
