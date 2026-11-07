/**
 * A TABLE IS FILLED FROM ITS LIST, IN ORDER (owner 2026-11-07). The seeding
 * loop sits no horse straight into a game whose list has anyone on it, or
 * whose breaking table still holds players; the tick calls the list one name
 * at a time (20261107195847) and must-move draws the breaking table first.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gamesFedByTheirList, listFeedsTable } from './HorseListFeedsTable.js';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: `p${i}` }));

describe('a table is filled from its list, in order', () => {
  it('a game with anyone waiting is fed by its list alone', () => {
    const fed = gamesFedByTheirList({
      waitingGameIds: new Set(['g1']),
      tables: [
        { id: 't1', cluster_id: 'g1', lifecycle: 'live' },
        { id: 't2', cluster_id: 'g2', lifecycle: 'live' },
      ],
      seatsByTable: new Map(),
    });
    expect(listFeedsTable({ cluster_id: 'g1' }, fed)).toBe(true);
    expect(listFeedsTable({ cluster_id: 'g2' }, fed)).toBe(false);
    expect(listFeedsTable({ cluster_id: null }, fed)).toBe(false);
  });

  it('a breaking table with players on it holds every chair of its game for them', () => {
    const fed = gamesFedByTheirList({
      waitingGameIds: new Set(),
      tables: [
        { id: 'main', cluster_id: 'g1', lifecycle: 'live' },
        { id: 'closing', cluster_id: 'g1', lifecycle: 'breaking' },
        { id: 'empty', cluster_id: 'g2', lifecycle: 'breaking' },
      ],
      seatsByTable: new Map([['closing', seats(3)]]),
    });
    expect([...fed]).toEqual(['g1']);
  });

  it('Lightning has no list, and an unread list seats as before', () => {
    const fed = gamesFedByTheirList({
      waitingGameIds: null,
      tables: [{ id: 'x', cluster_id: 'gL', lifecycle: 'breaking' }],
      seatsByTable: new Map([['x', seats(2)]]),
      lightningGames: new Set(['gL']),
    });
    expect(fed.size).toBe(0);
  });

  it('is wired into the seeding loop after the line ask, before any horse is chosen', () => {
    const src = readFileSync(join(__dirname, 'HorseFleetManager.ts'), 'utf8');
    const read = src.indexOf('waitingGameIds: await this.gamesWithWaitingList(readIsCurrent)');
    const ask = src.indexOf('horseQueueAsks.push({');
    const gate = src.indexOf('if (listFeedsTable(table, listFedGames)) {');
    const choose = src.indexOf('const selectedHorses = weighted.slice(0, emptySeats.length)');
    expect(read).toBeGreaterThan(0);
    expect(ask).toBeGreaterThan(read);
    expect(gate).toBeGreaterThan(ask);
    expect(choose).toBeGreaterThan(gate);
    expect(src.slice(gate, src.indexOf('continue;', gate))).toContain(
      "diag.withheld = 'list_feeds_table'"
    );
  });
});
