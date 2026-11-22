/**
 * LAW: HorseFleetNotSeated honours the designed overnight cash floor.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Incident 9d01a4c9 (2026-11-21 09:34 UTC / 03:34 America/Chicago):
 * HorseFleetNotSeated paged critical ("Only 35 horses are seated anywhere on
 * the platform") while Classic cash was dealing normally at 1.3 actions/s.
 *
 * Root cause: the alert carried a provisional `< 40` threshold written on
 * 2026-09-11 as the twin of HorseFleetCollapsed's old `< 20` table floor.
 * HorseFleetCollapsed was re-derived on 2026-11-11 for the reduced overnight
 * cash schedule, while HorseFleetNotSeated stayed at `< 40` — strictly inside
 * the healthy overnight band (nightCap = 34 bodies, band min = 20, seatCeiling
 * = 44 under RELAUNCHED_CASH_ACTIVITY_SCALE = 0.6).
 *
 * This law binds the alert threshold in infra/monitoring/alert-rules.yml to
 * the exact overnight floor constants in server/src/services/StableHand.ts
 * (NIGHT_MIN_OPEN_TABLES * NIGHT_MIN_PLAYERS = 12), so any future change to
 * the night curve or alert threshold that puts the alarm back inside the
 * designed overnight band fails CI before merge.
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

type Rule = { alert?: string; expr?: string };

function findAlert(name: string): Rule {
  const doc = YAML.parse(readFileSync(RULES_PATH, 'utf8')) as {
    groups?: { rules?: Rule[] }[];
  };
  const rule = (doc.groups ?? []).flatMap((g) => g.rules ?? []).find((r) => r.alert === name);
  expect(rule, `alert ${name} must exist in alert-rules.yml`).toBeTruthy();
  return rule!;
}

describe('HorseFleetNotSeated honours the designed overnight cash floor', () => {
  const rule = findAlert('HorseFleetNotSeated');
  const expr = rule.expr ?? '';
  const match = expr.match(/poker_horses_seated\s*<\s*(\d+)/);

  it('has an explicit positive numeric threshold equal to NIGHT_MIN_OPEN_TABLES * NIGHT_MIN_PLAYERS', () => {
    expect(match, 'HorseFleetNotSeated expr must compare poker_horses_seated < N').toBeTruthy();
    const threshold = Number(match![1]);
    const designedNightFloor = NIGHT_MIN_OPEN_TABLES * NIGHT_MIN_PLAYERS;
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBe(designedNightFloor);
  });

  it('sits strictly below the healthy overnight operating band and seat ceiling for every night hour', () => {
    const threshold = Number(match![1]);
    const nightHours = [3, 4, 5, 6, 7];
    const populations = [1000, 1140, 1166];

    for (const n of populations) {
      for (const hour of nightHours) {
        const occ = occupancyTargetForHost(n, hour, 0, RELAUNCHED_CASH_ACTIVITY_SCALE);
        const ceiling = hostSeatCeiling(occ.max, hour, 0);
        expect(threshold, `n=${n} hour=${hour} min=${occ.min}`).toBeLessThan(occ.min);
        expect(threshold, `n=${n} hour=${hour} target=${occ.target}`).toBeLessThan(occ.target);
        expect(threshold, `n=${n} hour=${hour} seatCeiling=${ceiling}`).toBeLessThan(ceiling);
      }
    }
  });

  it('keeps both the maintenance-break guard and the owner-floor-park guard', () => {
    expect(expr).toMatch(/unless on\(\) max_over_time\(poker_maintenance_break_active\[6m\]\) == 1/);
    expect(expr).toMatch(
      /unless on\(\) max_over_time\(poker_operator_floor_park_share\[6m\]\) >= 0\.5/
    );
  });
});
