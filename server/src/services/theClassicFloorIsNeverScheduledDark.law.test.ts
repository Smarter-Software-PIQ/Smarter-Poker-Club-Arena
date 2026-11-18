import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HORSE_UNION_CASH_PLAN,
  LIGHTNING_HORSE_SEEDED,
  scheduledHorseCashGames,
} from './HorseUnionCashPlan.js';

/**
 * ClassicCashFloorDark (#10509) pages when nobody has acted at a Classic cash
 * table for 15 minutes outside the break or an owner floor park. That is a
 * genuine stall only while the owner's cash plan keeps at least one Classic
 * game scheduled. The plan withholds most Classic games by the hour, but three
 * run in the `always` window (NLH .10/.25, NLH .25/.50, PLO4 .10/.25), so on
 * 2026-11-11 no hour of any day is scheduled dark.
 *
 * If a plan edit ever schedules the whole Classic floor off for an hour, the
 * alarm would page on intended withholding. This law fails the build first,
 * so that change has to make the alarm schedule-aware in the same PR.
 */
const RULES = readFileSync(
  fileURLToPath(new URL('../../../infra/monitoring/alert-rules.yml', import.meta.url)),
  'utf8'
);

describe('the Classic floor is never scheduled dark', () => {
  it('every Chicago hour of a weekday and a weekend day schedules a Classic game', () => {
    const classic = HORSE_UNION_CASH_PLAN.games
      .map((g: { id: string }) => g.id)
      .filter((id: string) => !LIGHTNING_HORSE_SEEDED.has(id));
    expect(classic.length).toBeGreaterThan(0);
    // Wednesday 2026-11-11 and Saturday 2026-11-14, every hour, America/Chicago (UTC-6).
    for (const day of [11, 14]) {
      for (let hour = 0; hour < 24; hour++) {
        const nowMs = Date.UTC(2026, 10, day, hour + 6, 30);
        const scheduled = [...scheduledHorseCashGames(nowMs)].filter((id) => classic.includes(id));
        expect(scheduled.length, `2026-11-${day} ${hour}:30 Chicago`).toBeGreaterThan(0);
      }
    }
  });

  it('ClassicCashFloorDark still stands down for the break and an owner park only', () => {
    const start = RULES.indexOf('- alert: ClassicCashFloorDark');
    expect(start).toBeGreaterThan(0);
    const body = RULES.slice(start, RULES.indexOf('\n      - ', start + 10));
    expect(body).toContain('sum(rate(poker_actions_fleet_total{format="cash"}[10m])) == 0');
    expect(body).toContain('max_over_time(poker_maintenance_break_active[6m]) == 1');
    expect(body).toContain('max_over_time(poker_operator_floor_park_share[6m]) >= 0.5');
  });
});
