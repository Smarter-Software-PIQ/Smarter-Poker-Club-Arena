/**
 * THE ROOM FOLLOWS THE CLOCK (owner request 2026-11-07).
 *
 * The shape mix, the length of a full game's line and the share of games
 * running a second table follow the Chicago hour. secondTablePicked must agree
 * with the tick's public.fn_cash_game_second_table_picked (20261107070717)
 * exactly, or the fleet would seat a table the tick never opens. The fixture
 * below was read from production's own md5, AT TIME ZONE and day-of-week
 * arithmetic on 2026-11-07 for real games of every variant across five bands
 * (20261107124911 weights the rate by stakes and variant and adds a weekend).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CASH_SHAPE_MIX,
  SECOND_TABLE_RATE,
  secondTableRateFor,
  occupancyTargetFor,
  roomBandAt,
  secondTablePicked,
} from './HorseBehavior.js';

// Chicago times: Thu 06:10 (dawn), Fri 19:30 (peak), Sat 14:45 (day),
// Sun 06:10 (early), Tue 02:30 (late).
const DAWN = Date.parse('2026-11-05T12:10:00Z');
const PEAK = Date.parse('2026-11-07T01:30:00Z');
const DAY = Date.parse('2026-11-07T20:45:00Z');
const EARLY = Date.parse('2026-11-08T12:10:00Z');
const LATE = Date.parse('2026-11-10T08:30:00Z');
const TIMES = [DAWN, PEAK, DAY, EARLY, LATE];

/* Read from production on 2026-11-07 with 20261107124911's exact arithmetic,
   for one real game of every variant (and the big-blind-5+ ones). */
const FIXTURE: Array<[string, number, string, [boolean, boolean, boolean, boolean, boolean]]> = [
  ['009016ed-24cb-4eb7-a9e3-04590c67fcce', 0.25, 'flh', [false, false, false, false, false]],
  ['580989b9-f245-45b8-9e82-e035b10b85cb', 10, 'flh', [false, false, false, false, false]],
  ['0a9040ca-1c0a-41c8-b3eb-60bb4ec1462a', 2, 'flo8', [false, false, true, false, false]],
  ['002f43c6-c07a-49d1-a20a-d75dff93a386', 1, 'nlh', [false, true, true, false, true]],
  ['06d44953-37f8-4adf-997d-227158afbd19', 1, 'pineapple', [true, true, false, true, false]],
  ['2ba1c0a6-5b5e-4d0d-bf0b-effebd63b1c5', 0.25, 'plo4', [false, true, true, true, false]],
  ['050f0735-1eac-45b3-90f8-3e50ab72dc04', 2, 'plo5', [false, true, false, false, true]],
  ['d1286f95-e1b1-4e74-88c0-db6833c469d5', 5, 'plo5', [false, false, false, false, false]],
  ['0914a283-1834-405a-9a2e-d20620e70333', 1, 'plo6', [true, true, true, true, false]],
  ['0689dd93-1dcb-4d1b-a950-6d9232a57695', 1, 'plo8', [false, true, false, false, false]],
  ['118dcafd-d93a-4e60-930f-730226c78232', 1, 'short_deck', [false, false, false, false, false]],
];

describe('the room follows the clock', () => {
  it('reads the Chicago clock into six bands, weekend included', () => {
    expect(TIMES.map(roomBandAt)).toEqual(['dawn', 'peak', 'day', 'early', 'late']);
    expect(roomBandAt(Date.parse('2026-11-08T08:30:00Z'))).toBe('peak'); // Sun 02:30, Saturday night
    expect(roomBandAt(Date.parse('2026-11-11T01:30:00Z'))).toBe('evening'); // Tue 19:30
  });

  it('weights the rate by the game, in the same integers as the database', () => {
    expect(secondTableRateFor('peak', 1, 'nlh')).toBe(90);
    expect(secondTableRateFor('day', 0.5, 'plo5')).toBe(65);
    expect(secondTableRateFor('dawn', 1, 'nlh')).toBe(20);
    expect(secondTableRateFor('peak', 1, 'short_deck')).toBe(18);
    expect(secondTableRateFor('day', 5, 'plo5')).toBe(13);
    expect(secondTableRateFor('late', 0.1, 'nlh')).toBe(30);
  });

  it('picks second tables exactly as the database does', () => {
    for (const [id, bb, variant, want] of FIXTURE)
      TIMES.forEach((at, i) =>
        expect(secondTablePicked(id, at, bb, variant), `${id} ${variant} ${roomBandAt(at)}`).toBe(
          want[i]
        )
      );
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../supabase/migrations/20261107124911_second_tables_where_the_demand_is_and_the_room_has_a_weekend.sql'
      ),
      'utf8'
    );
    expect(sql).toContain('THEN 70');
    expect(sql).toContain('THEN 15');
    expect(sql).toContain('(base.rate + 2) / 4');
    expect(sql).toContain('least(90, (base.rate * 13 + 5) / 10)');
  });

  it('evenings are busier than early mornings, and every band seats 75%', () => {
    expect(CASH_SHAPE_MIX.peak.full).toBeGreaterThan(CASH_SHAPE_MIX.evening.full);
    expect(CASH_SHAPE_MIX.evening.full).toBeGreaterThan(CASH_SHAPE_MIX.dawn.full);
    expect(SECOND_TABLE_RATE.peak).toBeGreaterThan(SECOND_TABLE_RATE.dawn);
    const ids = Array.from({ length: 400 }, (_, i) => `t-${i}-${i * 7919}`);
    for (const at of TIMES)
      for (const max of [9, 6]) {
        let seats = 0;
        for (const id of ids) seats += occupancyTargetFor(id, max, false, at).seatTarget;
        expect(seats / (ids.length * max), `${roomBandAt(at)} ${max}-max`).toBeGreaterThanOrEqual(
          0.75
        );
      }
  });

  it('popular stakes carry the longer lines', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `q-${i}-${i * 104729}`);
    const avg = (bb: number, at: number) => {
      const w = ids
        .map((id) => occupancyTargetFor(id, 9, false, at, 0, bb))
        .filter((t) => t.fill === 'full')
        .map((t) => t.waitTarget);
      for (const x of w) expect(x).toBeGreaterThanOrEqual(1);
      return w.reduce((a, b) => a + b, 0) / Math.max(1, w.length);
    };
    expect(avg(0.5, PEAK)).toBeGreaterThan(avg(10, PEAK));
    expect(avg(0.5, PEAK)).toBeGreaterThan(avg(0.5, DAWN));
  });
});
