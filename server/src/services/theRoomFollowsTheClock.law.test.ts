/**
 * THE ROOM FOLLOWS THE CLOCK (owner request 2026-11-07).
 *
 * The shape mix, the length of a full game's line and the share of games
 * running a second table follow the Chicago hour. secondTablePicked must agree
 * with the tick's public.fn_cash_game_second_table_picked (20261107070717)
 * exactly, or the fleet would seat a table the tick never opens. The fixture
 * below was read from production's own md5 and AT TIME ZONE arithmetic on
 * 2026-11-07 for real game ids at an evening, an early-morning and a daytime
 * instant.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CASH_SHAPE_MIX,
  SECOND_TABLE_RATE,
  occupancyTargetFor,
  roomBandAt,
  secondTablePicked,
} from './HorseBehavior.js';

const EVENING = Date.parse('2026-11-07T01:30:00Z'); // 19:30 CST
const EARLY = Date.parse('2026-11-07T12:10:00Z'); // 06:10 CST
const DAY = Date.parse('2026-11-07T20:45:00Z'); // 14:45 CST

const FIXTURE: Array<[string, boolean, boolean, boolean]> = [
  ['002f43c6-c07a-49d1-a20a-d75dff93a386', true, false, true],
  ['009016ed-24cb-4eb7-a9e3-04590c67fcce', true, false, false],
  ['050f0735-1eac-45b3-90f8-3e50ab72dc04', false, false, false],
  ['0736e5db-79fe-48cf-a316-c887b5667634', true, true, false],
  ['0e15bca8-3415-4730-84f9-dcbf136583bc', false, false, true],
  ['154a8669-c5a2-4e2a-b5af-e9960e2e7f66', true, true, true],
  ['1c4e71d4-08a7-4318-9fcc-2c6a2782c91e', true, true, false],
];

describe('the room follows the clock', () => {
  it('reads the Chicago hour into four bands', () => {
    expect(roomBandAt(EVENING)).toBe('evening');
    expect(roomBandAt(EARLY)).toBe('early');
    expect(roomBandAt(DAY)).toBe('day');
    expect(roomBandAt(Date.parse('2026-11-07T08:30:00Z'))).toBe('late'); // 02:30 CST
  });

  it('picks second tables exactly as the database does', () => {
    for (const [id, evening, early, day] of FIXTURE) {
      expect(secondTablePicked(id, EVENING), `${id} evening`).toBe(evening);
      expect(secondTablePicked(id, EARLY), `${id} early`).toBe(early);
      expect(secondTablePicked(id, DAY), `${id} day`).toBe(day);
    }
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../supabase/migrations/20261107070717_every_game_is_a_must_move_game_and_second_tables_follow_the_.sql'
      ),
      'utf8'
    );
    for (const [band, h] of [
      ['evening', 18],
      ['day', 10],
      ['early', 4],
    ] as const)
      expect(sql).toContain(`>= ${h} THEN ${SECOND_TABLE_RATE[band]}`);
    expect(sql).toContain(`ELSE ${SECOND_TABLE_RATE.late}`);
  });

  it('evenings are busier than early mornings, and every band seats 75%', () => {
    expect(CASH_SHAPE_MIX.evening.full).toBeGreaterThan(CASH_SHAPE_MIX.early.full);
    expect(SECOND_TABLE_RATE.evening).toBeGreaterThan(SECOND_TABLE_RATE.early);
    const ids = Array.from({ length: 400 }, (_, i) => `t-${i}-${i * 7919}`);
    for (const at of [EVENING, EARLY, DAY, Date.parse('2026-11-07T08:30:00Z')])
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
    expect(avg(0.5, EVENING)).toBeGreaterThan(avg(10, EVENING));
    expect(avg(0.5, EVENING)).toBeGreaterThan(avg(0.5, EARLY));
  });
});
