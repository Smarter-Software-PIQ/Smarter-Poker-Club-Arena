import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLEET_POLICY_DEFAULTS, withheldReason, type FleetPolicy } from './HorseFleetPolicy.js';
import { isFullClassicQueueTable, queuePolicyWithheldReason } from './HorseQueueAdmission.js';
import { planHorseQueues } from './HorseGameQueue.js';
const table = { cluster_id: 'g', max_players: 9 };
const capped = { ...FLEET_POLICY_DEFAULTS, maxHorses: 9, maxPerTable: 9 };
const context = {
  seatedHorses: 9,
  seatedAtTable: 9,
  humansAtTable: 0,
  nowUTCHour: 12,
  stakeBand: 'low',
  variant: 'nlh',
};
const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
describe('Classic queue admission without an immediate seat', () => {
  it('joins a physically full game when seating capacity is exhausted', () => {
    expect(withheldReason(capped, context)).toBe('max_horses_reached');
    expect(queuePolicyWithheldReason(capped, context)).toBeNull();
    expect(isFullClassicQueueTable(table, 9, new Set())).toBe(true);
    expect(
      planHorseQueues({
        asks: [{ gameId: 'g', waitTarget: 4, pool: ['idle-horse'] }],
        tables: [{ gameId: 'g', maxPlayers: 9, seated: 9 }],
        rows: [],
        excludedGameIds: new Set(),
        humanWaitingGameIds: new Set(),
        seatedByGame: new Map(),
        nowMs: 123456,
      }).add
    ).toEqual([{ game_id: 'g', user_id: 'idle-horse' }]);
  });
  it('never treats a capped target with open seats or Lightning as full Classic', () => {
    expect(withheldReason({ ...capped, maxPerTable: 6 }, { seatedAtTable: 6 })).toBe(
      'max_per_table_reached'
    );
    expect(isFullClassicQueueTable(table, 6, new Set())).toBe(false);
    expect(isFullClassicQueueTable(table, 9, new Set(['g']))).toBe(false);
    expect(isFullClassicQueueTable(table, 9, null)).toBe(false);
    expect(isFullClassicQueueTable({ max_players: 9 }, 9, new Set())).toBe(false);
  });
  it('retains restrictions masked by the occupancy ceiling', () => {
    const cases: [Partial<FleetPolicy>, string][] = [
      [{ enabled: false }, 'fleet_disabled'],
      [{ pauseNewSeatings: true }, 'seating_paused'],
      [{ minHumansToSeat: 1 }, 'below_min_humans'],
      [{ stakeBands: ['high'] }, 'stake_band_excluded'],
      [{ variants: ['plo'] }, 'variant_excluded'],
      [{ schedule: [{ startHourUTC: 0, endHourUTC: 1 }] }, 'outside_schedule'],
    ];
    for (const [overrides, expected] of cases) {
      expect(queuePolicyWithheldReason({ ...capped, ...overrides }, context)).toBe(expected);
    }
    expect(queuePolicyWithheldReason(capped, { ...context, decisionLanePhase: 'starting' })).toBe(
      'brain_behind'
    );
  });
  it('wires queue-only through seat, time and host limits while retaining financial admission', () => {
    expect(fleet).toMatch(
      /const queueOnly = isFullClassicQueueTable\(\s+table,\s+occupiedNumbers.size,\s+cashPlanLightningGames\s+\)/
    );
    expect(fleet).toContain('if (!queueOnly && seatBudget <= 0)');
    expect(fleet).toMatch(
      /!queueOnly &&\s+tablesConsidered > 0 &&\s+Date.now\(\) - seatingStartedAt/
    );
    expect(fleet).toMatch(/!queueOnly &&\s+!hostAllowsNewBody\(/);
    expect(fleet).toContain('seatsNeeded = queueOnly ? 0 : Math.min(seatsNeeded, seatBudget)');
    expect(fleet).toContain('let countOnly = queueOnly');
    expect(fleet.indexOf('if (countOnly) continue;')).toBeLessThan(
      fleet.indexOf('const verdict = sitVerdictFor(horse.id, table, sitCtx)')
    );
    expect(fleet).toContain('const v = sitVerdictFor(h.id, table, sitCtx)');
    expect(fleet).toContain('if (!queueOnly) clusterPools.push(clusterPool)');
  });
});
