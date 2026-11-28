import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { varietyDrainDecision, varietyDrainTables, type DrainTable } from './HorseVarietyFirst.js';

/**
 * THE DRAIN SAYS WHY (2026-11-27). On the 1 AM CST seal f2b854319ea9 the drain
 * released nothing for ten hours while up to 29 games were owed a start, and
 * the heartbeat could not say why. It took hand history per hour to show that
 * no game ever had a second occupied table (overnight the cap also had free
 * slots). Every owed cycle now publishes the decision's own reason as
 * detail.variety_drain_why, and the live check counts them.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

type T = DrainTable & { seated: number; person?: boolean };
const t = (
  id: string,
  game: string,
  role: 'main' | 'feeder',
  index: number | null,
  seated: number,
  createdMin: number
): T => ({
  id,
  cluster_id: game,
  role,
  main_index: index,
  lifecycle: 'live',
  seated,
  created_at: new Date(Date.UTC(2026, 10, 27, 13, createdMin)).toISOString(),
});

/** Game A has a Horse-only extra table (its feeder); game S is one table only. */
const floor: T[] = [
  t('a-m1', 'A', 'main', 1, 6, 0),
  t('a-f', 'A', 'feeder', null, 3, 30),
  t('s-m1', 'S', 'main', 1, 6, 0),
];
const decide = (over: Partial<Parameters<typeof varietyDrainDecision<T>>[0]> = {}) =>
  varietyDrainDecision<T>({
    tables: floor,
    seatedAt: (id) => floor.find((x) => x.id === id)?.seated ?? 0,
    personSeatedAt: () => false,
    personWaitingGames: new Set(),
    neverHeldGames: new Set(),
    owedGames: ['owed-1', 'owed-2'],
    shortfall: 2,
    current: [],
    mayAddNew: true,
    ...over,
  });

describe('the drain says why it released what it did', () => {
  it('names each outcome of a decided cycle', () => {
    expect(decide()).toEqual({ tables: ['a-f'], why: 'released' });
    expect(decide({ owedGames: [] })).toEqual({ tables: [], why: 'nothing_owed' });
    expect(decide({ shortfall: 0 })).toEqual({ tables: [], why: 'room_free' });
    expect(decide({ shortfall: 0, current: ['a-f'] })).toEqual({ tables: ['a-f'], why: 'kept' });
    expect(decide({ mayAddNew: false })).toEqual({ tables: [], why: 'paced' });
    expect(decide({ shortfall: 1, current: ['a-f'] })).toEqual({
      tables: ['a-f'],
      why: 'covered',
    });
    /* the 2026-11-27 floor: every game is one table, so there is nothing to release */
    const single = [t('s-m1', 'S', 'main', 1, 6, 0), t('u-m1', 'U', 'main', 1, 5, 0)];
    expect(
      varietyDrainDecision<T>({
        tables: single,
        seatedAt: (id) => single.find((x) => x.id === id)?.seated ?? 0,
        personSeatedAt: () => false,
        personWaitingGames: new Set(),
        neverHeldGames: new Set(),
        owedGames: ['owed-1'],
        shortfall: 1,
        current: [],
        mayAddNew: true,
      })
    ).toEqual({ tables: [], why: 'no_extra_table' });
    /* a person at the only extra table leaves no extra table to release */
    expect(decide({ personSeatedAt: (id) => id === 'a-f' })).toEqual({
      tables: [],
      why: 'no_extra_table',
    });
  });

  it('varietyDrainTables is the same decision, unchanged', () => {
    for (const over of [{}, { shortfall: 0 }, { mayAddNew: false }, { current: ['a-f'] }]) {
      const input = {
        tables: floor,
        seatedAt: (id: string) => floor.find((x) => x.id === id)?.seated ?? 0,
        personSeatedAt: () => false,
        personWaitingGames: new Set<string>(),
        neverHeldGames: new Set<string>(),
        owedGames: ['owed-1', 'owed-2'],
        shortfall: 2,
        current: [] as string[],
        mayAddNew: true,
        ...over,
      };
      expect(varietyDrainTables<T>(input)).toEqual(varietyDrainDecision<T>(input).tables);
    }
  });

  it('the fleet publishes the reason on every beat, and never calls an unread room free', () => {
    const fleet = read('./HorseFleetManager.ts');
    expect(fleet).toContain('const decision = varietyDrainDecision({');
    expect(fleet).toContain('varietyDrain = decision.tables;');
    expect(fleet).toContain(
      "decision.why === 'room_free' && (room?.cap == null || room?.counted == null)"
    );
    expect(fleet).toMatch(
      /beat\.varietyDrainWhy = cycleWithheld\s*\? 'withheld'\s*: beat\.varietyOwedGames\.length === 0\s*\? 'nothing_owed'\s*: drainDecided && varietyWhy\s*\? varietyWhy\s*: 'undecided';/
    );
    expect(fleet).toContain('variety_drain_why: beat.varietyDrainWhy,');
    expect(fleet).toContain('varietyDrainWhy: null,');
  });
});
