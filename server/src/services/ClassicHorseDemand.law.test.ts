import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cashTableFill,
  fullGameWaitTarget,
  secondTablePicked,
  thirdTablePicked,
} from './HorseBehavior.js';
import { planHorseQueues } from './HorseGameQueue.js';

const now = Date.parse('2026-11-10T18:00:00-06:00');
describe('actual full Classic games queue and expand', () => {
  it('queues for every occupancy shape when the actual game is full', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = `table-${i}`;
      seen.add(cashTableFill(id, now));
      const target = fullGameWaitTarget(id, 9, now);
      expect(target).toBeGreaterThanOrEqual(4);
      expect(target).toBeLessThanOrEqual(5);
      const input = {
        asks: [{ gameId: 'g', waitTarget: target, pool: ['a', 'b', 'c', 'd', 'e'] }],
        tables: [{ gameId: 'g', maxPlayers: 9, seated: 9 }],
        rows: [],
        excludedGameIds: new Set<string>(),
        humanWaitingGameIds: new Set<string>(),
        seatedByGame: new Map<string, Set<string>>(),
        nowMs: now,
      };
      expect(planHorseQueues(input).add).toHaveLength(1);
      expect(
        planHorseQueues({ ...input, tables: [{ gameId: 'g', maxPlayers: 9, seated: 8 }] }).add
      ).toEqual([]);
      expect(planHorseQueues({ ...input, excludedGameIds: new Set(['g']) }).add).toEqual([]);
    }
    expect(seen.size).toBe(3);
  });
  it('uses actual empty seats for the fleet ask, never the random target shape', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    expect(fleet).toContain('if (queueOnly) {\n              horseQueueAsks.push(');
    expect(fleet).toContain(
      'waitTarget: fullGameWaitTarget(table.id, table.max_players, Date.now())'
    );
    expect(fleet).not.toContain('emptySeats.length === 0 && target.waitTarget > 0');
  });
  it('varies between one, two and three tables and never selects three without two', () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      const id = `game-${i}`;
      const second = secondTablePicked(id, now, 0.5, 'nlh');
      const third = thirdTablePicked(id, now, 0.5, 'nlh');
      expect(third && !second).toBe(false);
      counts[third ? 3 : second ? 2 : 1]++;
    }
    for (const n of counts.slice(1)) expect(n).toBeGreaterThan(100);
  });
});
