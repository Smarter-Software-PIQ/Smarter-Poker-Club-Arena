/**
 * THE CURVE GOVERNS SEATS, NOT ONLY BODIES (Dan, 2026-11-13 11:43).
 *
 * "WE SHOULDN'T HAVE 250 PLAYERS ON HOLDEM AT 10AM. WE HAVE THE PLAYER CURVE
 * TO FOLLOW, LOWER AMOUNTS OF PLAYERS IN THE AM... STEADY CLIMB THROUGH OUT
 * THE DAY, WITH PEAK TRAFFIC AROUND 6-11 AND THEN DIES BACK DOWN AT NIGHT...
 * MAKE SURE THAT IS FOLLOWED AS WE DESIGNED IT."
 *
 * Measured 11:44 Chicago: 234 bodies held 823 seats (3.52 each) against a body
 * cap of 185; 249 seats at Hold'em. The lobby shows seats, so the designed
 * seats-per-horse band (1.6-2.2 by day, 1.0-1.3 at night) is now a ceiling:
 * the seeder stops at it, and the Stable Hand winds the room down to it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hostSeatCeiling, occupancyTargetForHost, seatsPerHorseBand } from './StableHand.js';
import {
  hostAllowsNewBody,
  planFloor,
  seatsOnHostFrom,
  stableHandHostSeatCeilings,
  type FloorSnapshot,
  type TableSnapshot,
} from './StableHandController.js';
import { RELAUNCHED_CASH_ACTIVITY_SCALE } from './HorseCashSchedule.js';

const HOST = 'host-1';
const N = 1140; // the Midway cash population on 2026-11-13

const ceilingAt = (hour: number) =>
  hostSeatCeiling(occupancyTargetForHost(N, hour, 0, RELAUNCHED_CASH_ACTIVITY_SCALE).max, hour);

function table(id: string, horses: string[], humans = 0): TableSnapshot {
  return {
    tableId: id,
    hostId: HOST,
    variant: 'nlh',
    sb: 0.5,
    bb: 1,
    maxPlayers: 6,
    occupied: horses.length + humans,
    humansSeated: humans,
    humansWaiting: 0,
    seatedHorses: horses.map((horseId, i) => ({
      horseId,
      sittingOut: false,
      minutesAtTable: 30 + i,
      isRed: false,
      stack: 100,
    })),
    status: 'running',
    clusterId: null,
  } as TableSnapshot;
}

function snapshot(tables: TableSnapshot[], hour: number, n: number): FloorSnapshot {
  const bodies = new Set(tables.flatMap((t) => t.seatedHorses.map((c) => c.horseId)));
  return {
    chicagoHour: hour,
    chicagoMinute: 0,
    cashActivityScale: RELAUNCHED_CASH_ACTIVITY_SCALE,
    killed: false,
    hosts: [{ hostId: HOST, n, uniqueLive: bodies.size, tables }],
  } as unknown as FloorSnapshot;
}

describe('the seat ceiling follows the designed curve', () => {
  it('is the body cap times the band ceiling, day and night', () => {
    expect(seatsPerHorseBand(11).max).toBe(2.2);
    expect(seatsPerHorseBand(4).max).toBe(1.3);
    expect(hostSeatCeiling(185, 11)).toBe(407);
    expect(hostSeatCeiling(29, 4)).toBe(37);
    expect(hostSeatCeiling(0, 11)).toBe(0);
  });

  it('low in the morning, climbing all day, peaking in the evening, falling at night', () => {
    const at = (h: number) => ceilingAt(h);
    expect(at(5)).toBeLessThan(at(10));
    expect(at(10)).toBeLessThan(at(14));
    expect(at(14)).toBeLessThan(at(19));
    expect(at(19)).toBeGreaterThanOrEqual(at(22));
    expect(at(22)).toBeGreaterThan(at(2));
    // The whole floor at 10 AM is far under the 823 seats measured at 11:44.
    expect(at(10)).toBeLessThan(400);
    expect(at(19)).toBeGreaterThan(1.8 * at(10));
  });

  it('one ceiling per host, from the body caps', () => {
    expect([...stableHandHostSeatCeilings(new Map([[HOST, 185]]), 11)]).toEqual([[HOST, 407]]);
  });

  it('counts every seat on each host, human and horse', () => {
    const hostOf = new Map([
      ['t1', HOST],
      ['t2', HOST],
    ]);
    const seats = [
      { user_id: 'a', table_id: 't1' },
      { user_id: 'a', table_id: 't2' },
      { user_id: 'person', table_id: 't2' },
      { user_id: 'b', table_id: 'elsewhere' },
    ];
    expect(seatsOnHostFrom(seats, hostOf).get(HOST)).toBe(3);
  });
});

describe('the seeder stops at the ceiling', () => {
  const base = {
    hostId: HOST,
    caps: new Map([[HOST, 10]]),
    bodiesOnHost: new Map([[HOST, new Set(['already-here'])]]),
    seatCeilings: new Map([[HOST, 22]]),
  };
  it('a body already counted may not take another table once the host is at its seats', () => {
    expect(
      hostAllowsNewBody({
        ...base,
        horseId: 'already-here',
        humanNeedsRescue: false,
        seatsOnHost: new Map([[HOST, 22]]),
      })
    ).toBe(false);
    expect(
      hostAllowsNewBody({
        ...base,
        horseId: 'already-here',
        humanNeedsRescue: false,
        seatsOnHost: new Map([[HOST, 21]]),
      })
    ).toBe(true);
  });
  it('a person who needs the game rescued still outranks the ceiling', () => {
    expect(
      hostAllowsNewBody({
        ...base,
        horseId: 'new',
        humanNeedsRescue: true,
        seatsOnHost: new Map([[HOST, 99]]),
      })
    ).toBe(true);
  });
  it('the fleet passes the seats it holds and counts every seat it buys this cycle', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    expect(fleet).toMatch(/const seatsOnHost = seatsOnHostFrom\(allActiveSeats, hostOfTable\);/);
    expect(fleet).toMatch(
      /const ceilingClock = chicagoNow\(\);\s*const stableHandCaps = stableHandHostCaps\(eligibleByHost, ceilingClock\);[\s\S]*?const seatCeilings = stableHandHostSeatCeilings\(\s*stableHandCaps,\s*ceilingClock\.hour,\s*ceilingClock\.minute\s*\);/
    );
    expect(fleet).toMatch(/humanNeedsRescue,\s*seatsOnHost,\s*seatCeilings,\s*\}\)/);
    expect(fleet).toMatch(
      /seatsOnHost\.set\(seatedHost, \(seatsOnHost\.get\(seatedHost\) \?\? 0\) \+ 1\);/
    );
    expect(fleet).toMatch(
      /openPlannedTables\(tables, bodiesOnHost, stableHandCaps, seatsOnHost, seatCeilings\)/
    );
  });
  it('a table is seated only up to the room left, and each seat checks again', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    expect(fleet).toMatch(
      /const room = Math\.max\(0, ceilingHere - \(seatsOnHost\.get\(ceilingHost\) \?\? 0\)\);/
    );
    expect(fleet).toMatch(/cleared\.splice\(room\);/);
    expect(fleet).toMatch(
      /!humanNeedsRescue &&\s*ceilingHere !== undefined &&\s*\(seatsOnHost\.get\(ceilingHost\) \?\? 0\) >= ceilingHere\s*\)\s*return false;/
    );
  });
  it('a seat call is a new seat: refused at the ceiling unless a person is there, and counted', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    expect(fleet).toMatch(/readIsCurrent,\s*book,\s*\{ seatsOnHost, seatCeilings \}\s*\);/);
    expect(fleet).toMatch(
      /\(seatGate\.seatsOnHost\.get\(offerHost\) \?\? 0\) >= offerCeiling &&\s*!\(seatsByTable\.get\(table\.id\) \?\? \[\]\)\.some\(\(x\) => !horseIdSet\.has\(x\.user_id\)\)/
    );
    expect(fleet).toMatch(
      /claimed\+\+;\s*seatGate\?\.seatsOnHost\.set\(offerHost, \(seatGate\.seatsOnHost\.get\(offerHost\) \?\? 0\) \+ 1\);/
    );
  });
});

describe('the Stable Hand winds the room down to the ceiling', () => {
  // n=100 at 11:00: body max is 15, the seat ceiling 33. Twelve bodies (under
  // the body cap) hold 40 seats across ten tables: 7 over the ceiling.
  const horses = Array.from({ length: 12 }, (_, i) => `h${i}`);
  const tables = Array.from({ length: 10 }, (_, k) =>
    table(
      `t${k}`,
      Array.from({ length: 4 }, (_, j) => horses[(k * 4 + j) % 12])
    )
  );

  it('stands up the excess, one per table, multi-tabled horses first', () => {
    const snap = snapshot(tables, 11, 100);
    const ceiling = hostSeatCeiling(
      occupancyTargetForHost(100, 11, 0, RELAUNCHED_CASH_ACTIVITY_SCALE).max,
      11
    );
    const plan = planFloor(snap);
    const downs = plan.stand.filter((o) => o.reason === 'occupancy_wind_down');
    const otherStands = plan.stand.length - downs.length;
    expect(downs.length).toBe(40 - otherStands - ceiling);
    const perTable = new Map<string, number>();
    for (const o of plan.stand) perTable.set(o.tableId, (perTable.get(o.tableId) ?? 0) + 1);
    expect(Math.max(...perTable.values())).toBe(1);
    expect(plan.alerts.some((a) => a.startsWith(`seats_over host=${HOST}`))).toBe(true);
  });

  it('plans nothing for seats when the room is within the ceiling', () => {
    const snap = snapshot(tables.slice(0, 2), 11, 100);
    const plan = planFloor(snap);
    expect(plan.alerts.some((a) => a.startsWith('seats_over'))).toBe(false);
  });

  it('never thins a table with a person on it below a real game', () => {
    const withPerson = [table('p', ['h0', 'h1', 'h2'], 1), ...tables];
    const plan = planFloor(snapshot(withPerson, 11, 100));
    expect(plan.stand.some((o) => o.tableId === 'p')).toBe(false);
  });

  it('a killed snapshot winds nothing down', () => {
    const snap = { ...snapshot(tables, 11, 100), killed: true } as FloorSnapshot;
    expect(planFloor(snap).stand.filter((o) => o.reason === 'occupancy_wind_down')).toHaveLength(0);
  });
});
