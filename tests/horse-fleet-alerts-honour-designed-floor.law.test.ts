/**
 * LAW: every `horse-fleet` alert rule in alert-rules.yml honours the designed
 *      overnight floor in StableHand.ts, retains its break/park guards, and
 *      GameServer counts Lightning horses in `poker_horses_seated`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Incident 9d01a4c9 (2026-11-21): `HorseFleetNotSeated` carried a stale
 * September `< 40` horse floor long after `HorseFleetCollapsed` dropped its
 * stale September `< 20` table floor and `StableHand.ts` reduced the overnight
 * cash schedule (`NIGHT_MIN_OPEN_TABLES`, `NIGHT_MIN_PLAYERS`,
 * `occupancyTargetForHost`, `hostSeatCeiling`). At the same time,
 * `GameServer.ts` computed `poker_horses_seated` from `this.tableEngines`
 * alone, omitting horses seated in Lightning pools.
 *
 * This cross-file law audits ALL six `horse-fleet` fleet/floor/heartbeat alert
 * rules (`HorseFleetCollapsed`, `HorseFleetNotSeated`,
 * `HorseCashActionsStopped`, `ClassicCashFloorDark`,
 * `HorseFleetThroughputRelativeDrop`, `HorseFleetHeartbeatStale`) together so
 * no rule can drift back to a stale September floor, lose its maintenance-break
 * or owner-floor-park guard, or drop Lightning seats from `poker_horses_seated`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import {
  NIGHT_MIN_OPEN_TABLES,
  NIGHT_MIN_PLAYERS,
  hostSeatCeiling,
  occupancyTargetForHost,
} from '../server/src/services/StableHand.js';
import { RELAUNCHED_CASH_ACTIVITY_SCALE } from '../server/src/services/HorseCashSchedule.js';

const ROOT = join(__dirname, '..');
const RULES_PATH = join(ROOT, 'infra/monitoring/alert-rules.yml');
const GAME_SERVER_PATH = join(ROOT, 'server/src/GameServer.ts');
const SEAT_COUNTER_PATH = join(ROOT, 'server/src/engine/HorseSeatCounter.ts');

const BREAK_GUARD = /unless on\(\) max_over_time\(poker_maintenance_break_active\[6m\]\) == 1/;
const PARK_GUARD = /unless on\(\) max_over_time\(poker_operator_floor_park_share\[6m\]\) >= 0\.5/;

type Rule = { alert?: string; expr?: string };
type Group = { name?: string; rules?: Rule[] };

function horseFleetAlerts(): Map<string, Rule> {
  const doc = YAML.parse(readFileSync(RULES_PATH, 'utf8')) as { groups?: Group[] };
  const group = (doc.groups ?? []).find((g) => g.name === 'horse-fleet');
  expect(group, 'horse-fleet group must exist in alert-rules.yml').toBeTruthy();
  const map = new Map<string, Rule>();
  for (const r of group!.rules ?? []) {
    if (r.alert) map.set(r.alert, r);
  }
  return map;
}

const AUDITED_ALERTS = [
  'HorseFleetCollapsed',
  'HorseFleetNotSeated',
  'HorseCashActionsStopped',
  'ClassicCashFloorDark',
  'HorseFleetThroughputRelativeDrop',
  'HorseFleetHeartbeatStale',
] as const;

const FLOOR_LEVEL_ALERTS = [
  'HorseFleetCollapsed',
  'HorseFleetNotSeated',
  'HorseCashActionsStopped',
  'ClassicCashFloorDark',
  'HorseFleetThroughputRelativeDrop',
] as const;

describe('horse-fleet alert rules honour the designed StableHand floor', () => {
  const alerts = horseFleetAlerts();

  it('all six audited horse-fleet rules exist in the horse-fleet group', () => {
    for (const name of AUDITED_ALERTS) {
      expect(alerts.has(name), `${name} must exist in horse-fleet`).toBe(true);
      expect(
        alerts.get(name)?.expr?.trim().length ?? 0,
        `${name} expr must be non-empty`
      ).toBeGreaterThan(0);
    }
  });

  it('no horse-fleet rule carries stale September table (< 20) or horse (< 40) floors', () => {
    const designedNightSeats = NIGHT_MIN_OPEN_TABLES * NIGHT_MIN_PLAYERS;
    const nightHours = [3, 4, 5, 6, 7];
    const populations = [1000, 1140, 1166];

    // Compute the tightest healthy overnight operating band across populations & night hours.
    let minOvernightBandMin = Infinity;
    let minOvernightSeatCeiling = Infinity;
    for (const n of populations) {
      for (const hour of nightHours) {
        const occ = occupancyTargetForHost(n, hour, 0, RELAUNCHED_CASH_ACTIVITY_SCALE);
        const ceiling = hostSeatCeiling(occ.max, hour, 0);
        if (occ.min < minOvernightBandMin) minOvernightBandMin = occ.min;
        if (ceiling < minOvernightSeatCeiling) minOvernightSeatCeiling = ceiling;
      }
    }

    for (const name of AUDITED_ALERTS) {
      const expr = alerts.get(name)!.expr ?? '';

      // No stale hardcoded September table floor (`poker_dealable_tables < 20` or >= NIGHT_MIN_OPEN_TABLES).
      const tableMatch = expr.match(/poker_dealable_tables\s*<\s*(\d+)/);
      if (tableMatch) {
        const tableFloor = Number(tableMatch[1]);
        expect(tableFloor, `${name} table floor must not regress to September < 20`).toBeLessThan(
          20
        );
        expect(
          tableFloor,
          `${name} table floor must sit strictly below NIGHT_MIN_OPEN_TABLES (${NIGHT_MIN_OPEN_TABLES})`
        ).toBeLessThan(NIGHT_MIN_OPEN_TABLES);
      }

      // No stale hardcoded September seat floor (`poker_horses_seated < 40` or inside the night curve).
      const seatMatch = expr.match(/poker_horses_seated\s*<\s*(\d+)/);
      if (seatMatch) {
        const seatFloor = Number(seatMatch[1]);
        expect(seatFloor, `${name} seat floor must not regress to September < 40`).toBeLessThan(40);
        expect(
          seatFloor,
          `${name} seat floor must not exceed designed night floor (${designedNightSeats})`
        ).toBeLessThanOrEqual(designedNightSeats);
        expect(seatFloor, `${name} seat floor must sit below overnight band min`).toBeLessThan(
          minOvernightBandMin
        );
        expect(seatFloor, `${name} seat floor must sit below overnight seat ceiling`).toBeLessThan(
          minOvernightSeatCeiling
        );
      }
    }
  });

  it('every floor-level horse-fleet rule retains both maintenance-break and owner-floor-park guards', () => {
    for (const name of FLOOR_LEVEL_ALERTS) {
      const expr = alerts.get(name)!.expr ?? '';
      expect(expr, `${name} must carry the maintenance-break guard`).toMatch(BREAK_GUARD);
      expect(expr, `${name} must carry the owner-floor-park guard`).toMatch(PARK_GUARD);
    }

    // HorseFleetHeartbeatStale is a loop-liveness rule (keeps break guard; a floor park does not stop heartbeats).
    const hbExpr = alerts.get('HorseFleetHeartbeatStale')!.expr ?? '';
    expect(hbExpr, 'HorseFleetHeartbeatStale must carry the maintenance-break guard').toMatch(
      BREAK_GUARD
    );
  });

  it('GameServer.ts includes Lightning seated horses in poker_horses_seated', () => {
    const gs = readFileSync(GAME_SERVER_PATH, 'utf8');
    expect(gs).toContain("from './engine/HorseSeatCounter.js'");
    expect(gs).toMatch(
      /const horseSeatCounts = countHorseSeats\(this\.tableEngines\.values\(\),\s*this\.lightningRooms\);/
    );
    expect(gs).toContain('`poker_horses_seated ${horseSeatCounts.horses}`');

    const counter = readFileSync(SEAT_COUNTER_PATH, 'utf8');
    expect(counter).toContain('lightning.seatedHorseEntries()');
    expect(counter).toContain('countedAnchorHorses');
  });
});
