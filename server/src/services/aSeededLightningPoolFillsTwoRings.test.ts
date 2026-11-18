import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LIGHTNING_SEEDED_POOL_PLAYERS,
  lightningStarterGameSeats,
  lightningStarterSeatTarget,
  type CashPlanTable,
} from './HorseUnionCashPlan.js';

/* Dan 2026-11-17, answering "should horse-seeded Lightning games be filled
   past one ring?": "Fill each to 10-12". A pool of one six-max ring cannot
   fast fold: on Lightning PLO4 .25/.50 (705270cd) idle_to_match p95 was 20.9 s
   with 6 in the pool, 4.6 s with 17 and 2.6 s with 41. */

const NLH_ONE_TWO = '563279fc-c09a-48a6-b487-c4f34f289095';
const table = (id: string, extra: Partial<CashPlanTable> = {}): CashPlanTable => ({
  id,
  cluster_id: NLH_ONE_TWO,
  role: 'main',
  main_index: 1,
  lifecycle: 'live',
  max_players: 6,
  ...extra,
});
const seats = (counts: Record<string, number>) => (id: string) => counts[id] ?? 0;
const feeder = (id: string, lifecycle = 'live') =>
  table(id, { role: 'feeder', main_index: null, lifecycle });

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

describe('a seeded Lightning pool fills to two rings, not one', () => {
  it('targets the owner range of 10-12 and more than one six-max ring', () => {
    expect(LIGHTNING_SEEDED_POOL_PLAYERS).toBeGreaterThanOrEqual(10);
    expect(LIGHTNING_SEEDED_POOL_PLAYERS).toBeLessThanOrEqual(12);
    expect(LIGHTNING_SEEDED_POOL_PLAYERS).toBeGreaterThan(6);
  });

  it('does not stop at one full ring: a full Main hands the start to its feeder', () => {
    const starters = lightningStarterGameSeats(
      [table('m'), feeder('f', 'opening')],
      seats({ m: 6 })
    );
    expect([...starters.entries()]).toEqual([['f', 6]]);
  });

  it('never names a full table as the starter', () => {
    expect(lightningStarterGameSeats([table('m')], seats({ m: 6 })).size).toBe(0);
  });

  it('stops at the pool target, counted across the game tables', () => {
    expect(lightningStarterGameSeats([table('m'), feeder('f')], seats({ m: 6, f: 5 })).size).toBe(
      1
    );
    expect(lightningStarterGameSeats([table('m'), feeder('f')], seats({ m: 6, f: 6 })).size).toBe(
      0
    );
  });

  it("raises a starter table's target to the missing players, bounded by its chairs", () => {
    expect(lightningStarterSeatTarget(0, 6, 6)).toBe(6);
    expect(lightningStarterSeatTarget(2, 6, 8)).toBe(6);
    expect(lightningStarterSeatTarget(5, 6, 11)).toBe(6);
    expect(lightningStarterSeatTarget(6, 6, 12)).toBe(6);
    expect(lightningStarterSeatTarget(3, 9, 3)).toBe(9);
  });

  it('the seeding walk only raises the target, before the fleet seat budget', () => {
    const src = readFileSync(join(here, 'HorseFleetManager.ts'), 'utf8');
    expect(src).toContain('lightningStarters.get(String(table.id))');
    expect(src).toMatch(
      /seatTarget = Math\.max\(\s*seatTarget,\s*lightningStarterSeatTarget\(currentCount, table\.max_players, lightningGameTotal\)/
    );
    const raise = src.indexOf('lightningStarterSeatTarget(currentCount');
    const budget = src.indexOf('seatsNeeded = queueOnly ? 0 : Math.min(seatsNeeded, seatBudget);');
    expect(raise).toBeGreaterThan(0);
    expect(budget).toBeGreaterThan(raise);
  });

  it('keeps the 70-90 second individual arrival pace (Dan 2026-11-11)', () => {
    const dir = join(root, 'supabase', 'migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    // Every horse seat passes the database seat guard, which takes the paced
    // Lightning door (wired by 20261111214248): a raised engine target cannot
    // outrun it.
    const wiring = readFileSync(
      join(dir, '20261111214248_every_lightning_game_joins_horses_one_at_a_time.sql'),
      'utf8'
    );
    expect(wiring).toContain('fn_ca_horse_roster_seat_guard');
    expect(wiring).toContain('fn_lightning_horse_admit_paced');
    // The newest definition of that door, searched newest first: 70 + 0..20
    // whole seconds after EACH admission, at any pool size (no division by
    // streams, no busy-pool speed-up).
    const marker = 'CREATE OR REPLACE FUNCTION public.fn_lightning_horse_admit_paced';
    let body = '';
    for (const f of [...files].reverse()) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const at = sql.indexOf(marker);
      if (at < 0) continue;
      const rest = sql.slice(at);
      const close = rest.search(/\$(function)?\$\s*;/);
      body = close > 0 ? rest.slice(0, close) : rest;
      break;
    }
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('make_interval(secs => 70 + floor(random() * 21)::integer)');
    expect(body).not.toContain('v_streams');
  });
});
