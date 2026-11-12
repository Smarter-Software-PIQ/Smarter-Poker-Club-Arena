import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cashTableFill, fullGameWaitTarget } from './HorseBehavior.js';
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
  // ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN (Dan 2026-11-11): the
  // one/two/three-table picks were the retired rake throttle.
  it('a Classic game is never limited to a hash-picked one, two or three tables', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    const plan = readFileSync(new URL('./HorseUnionCashPlan.ts', import.meta.url), 'utf8');
    const migration = readFileSync(
      new URL(
        '../../../supabase/migrations/20261112154904_classic_games_open_tables_without_the_supply_throttle.sql',
        import.meta.url
      ),
      'utf8'
    );
    // The fleet withholds a secondary table on the pick only while the
    // Lightning set is unknown; a Classic game's tables are all seatable.
    expect(fleet).toContain('cashPlanLightningGames === null;');
    expect(plan).not.toContain('thirdTablePicked');
    expect(plan).toContain('for (const table of candidates) out.add(String(table.id));');
    // The tick's twin: the supply cut and the picks apply to Lightning only.
    expect(migration).toContain('-- @install-window: daily-maintenance');
    expect(migration).toContain(
      '  IF coalesce(g.lightning_enabled, false) THEN\n    v_table_cap := greatest(1'
    );
    expect(migration).toContain("RAISE EXCEPTION 'classic_table_supply_throttle_preimage_changed'");
  });
});
