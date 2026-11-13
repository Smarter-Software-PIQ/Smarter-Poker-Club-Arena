import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LIGHTNING_HORSE_SEEDED,
  LIGHTNING_STARTER_PLAYERS,
  lightningStarterTables,
  type CashPlanTable,
} from './HorseUnionCashPlan.js';
import plan from './horseUnionCashPlan.json' with { type: 'json' };

/* Dan 2026-11-13 14:56 Chicago: "THE 1/2 HORSES NEED TO BE PLAYING THE 1/2
   LIGHTNING FOR HOLDEM AND PLO AND WE NEED TO GET THE .50/1.00 LIGHTNING
   RUNNING FOR HOLDEM AND PLO." */

const NLH_HALF = '57ca90e4-815e-4081-a5d2-1f10522d95c7';
const PLO4_HALF = 'f26f6efa-2470-49e7-8e96-6128f4d0cdb5';
const NLH_ONE_TWO = '563279fc-c09a-48a6-b487-c4f34f289095';
const PLO4_ONE_TWO = 'c79d8ec2-2281-411d-b4e1-42b5610849e2';
const PLO5_ONE_TWO = 'f67a1436-e842-4b49-8644-3e184bd77ba6';

const table = (id: string, game: string, extra: Partial<CashPlanTable> = {}): CashPlanTable => ({
  id,
  cluster_id: game,
  role: 'main',
  main_index: 1,
  lifecycle: 'live',
  ...extra,
});
const seats = (counts: Record<string, number>) => (id: string) => counts[id] ?? 0;

describe('a seeded Lightning game starts first', () => {
  it('seeds the 1/2 and .50/1 Lightning games for Holdem and PLO', () => {
    for (const id of [NLH_HALF, PLO4_HALF, NLH_ONE_TWO, PLO4_ONE_TWO, PLO5_ONE_TWO]) {
      expect(LIGHTNING_HORSE_SEEDED.has(id)).toBe(true);
    }
    const names = (plan as { lightningHorseSeeded: Array<{ name: string }> }).lightningHorseSeeded
      .map((g) => g.name)
      .sort();
    expect(names).toEqual(
      [
        'Lightning NLH .25/.50',
        'Lightning NLH .50/1',
        'Lightning NLH 1/2',
        'Lightning PLO4 .25/.50',
        'Lightning PLO4 .50/1',
        'Lightning PLO4 1/2',
        'Lightning PLO5 1/2',
      ].sort()
    );
  });

  it('starts an empty seeded game at its only table, even when that table is a feeder', () => {
    const tables = [
      table('a-main', NLH_ONE_TWO),
      table('b-feeder', PLO4_HALF, { role: 'feeder', main_index: null }),
    ];
    expect([...lightningStarterTables(tables, seats({}))].sort()).toEqual(['a-main', 'b-feeder']);
  });

  it('picks one table per game: the fullest, then a Main before a feeder, then the lowest id', () => {
    const tables = [
      table('f1', NLH_HALF, { role: 'feeder', main_index: null }),
      table('m1', NLH_HALF),
      table('f2', PLO5_ONE_TWO, { role: 'feeder', main_index: null }),
      table('m2', PLO5_ONE_TWO),
      table('z', PLO4_ONE_TWO),
      table('y', PLO4_ONE_TWO),
    ];
    const starters = lightningStarterTables(tables, seats({ f2: 3, m2: 2 }));
    expect([...starters].sort()).toEqual(['f2', 'm1', 'y']);
  });

  it('stops once the game holds a full ring across its tables', () => {
    const tables = [table('m', NLH_ONE_TWO), table('f', NLH_ONE_TWO, { role: 'feeder' })];
    expect(lightningStarterTables(tables, seats({ m: 4, f: 1 })).size).toBe(1);
    expect(
      lightningStarterTables(tables, seats({ m: 4, f: LIGHTNING_STARTER_PLAYERS - 4 })).size
    ).toBe(0);
    expect(lightningStarterTables(tables, seats({ m: 6 })).size).toBe(0);
  });

  it('never names a closed or breaking table, an unseeded game or a table outside a game', () => {
    const tables = [
      table('closed', NLH_ONE_TWO, { lifecycle: 'closed' }),
      table('breaking', NLH_ONE_TWO, { lifecycle: 'breaking' }),
      table('classic', 'bc1a347f-2b85-49df-b3b3-40a498a6e51b'),
      { id: 'fleet', cluster_id: null },
    ];
    expect(lightningStarterTables(tables, seats({})).size).toBe(0);
  });

  it('reads an unreadable seat count as empty', () => {
    const tables = [table('m', NLH_ONE_TWO)];
    expect(lightningStarterTables(tables, () => Number.NaN).has('m')).toBe(true);
  });

  it('is what the seeding walk orders by, after a short-handed person and before the rest', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'HorseFleetManager.ts'),
      'utf8'
    );
    const sort = src.slice(src.indexOf('const orderedTables = [...tables, ...diamondTables].sort('));
    const human = sort.indexOf('Number(humanShort(b)) - Number(humanShort(a))');
    const starter = sort.indexOf('Number(lightningStarters.has(String(b.id)))');
    const cluster = sort.indexOf('Number(!!b.cluster_id) - Number(!!a.cluster_id)');
    expect(human).toBeGreaterThanOrEqual(0);
    expect(starter).toBeGreaterThan(human);
    expect(cluster).toBeGreaterThan(starter);
  });
});
