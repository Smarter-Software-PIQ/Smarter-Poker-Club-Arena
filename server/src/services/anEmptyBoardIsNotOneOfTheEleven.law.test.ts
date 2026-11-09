/**
 * AN EMPTY BOARD IS NOT ONE OF THE ELEVEN (2026-11-09).
 *
 * Dan: "SIT ONE HORSE AT LIKE 11 DIFFERENT SPINS AND LIKE 6 SIT N GO'S".
 *
 * Measured on the activated ladder engine (bff6eed3) at 21:03Z, ninety
 * minutes after it went live: 32 Spin and 16 heads-up boards REGISTERING,
 * every one with no entrant and no live seat, so the room count read 11-32
 * and 6-16, the launcher opened nothing and no horse sat anywhere. Under the
 * ladder an empty board never leaves REGISTERING: the fill lane tops up only
 * `paid > 0`, a held-empty board opens with nobody, and an unused board is
 * parked rather than cancelled at 3 AM. So it held its slot for good.
 *
 * These pins keep the three halves of the fix together: the count takes only
 * opened boards, an empty board is reopened before anything is created, and a
 * reopened board gets its opening rung before its horse.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(resolve(__dirname, 'TournamentRecurringService.ts'), 'utf8');

function method(signature: string): string {
  const start = SRC.indexOf(signature);
  expect(start, signature).toBeGreaterThan(0);
  const next = SRC.slice(start + signature.length).search(
    /\n {2}(private |async |public |static )/
  );
  return SRC.slice(start, next < 0 ? undefined : start + signature.length + next);
}

describe('1. the eleven and the six count opened boards only', () => {
  const room = method('private async seatFirstBoardRoom(');

  it('counts boards with a live seat, not every REGISTERING row', () => {
    expect(room).not.toContain("{ count: 'exact', head: true }");
    expect(room).toContain('await this.openedSeatFirstBoards(');
    expect(room).toMatch(/boardOpenTarget\(variant\) - count/);
  });

  it("a live seat is the fill lane's `paid`: an open seat on a table that is not closed", () => {
    const seats = method('private async seatFirstBoardsWithALiveSeat(');
    expect(seats).toContain(".neq('status', 'closed')");
    expect(seats).toContain(".from('table_seats')");
    expect(seats).toContain(".is('left_at', null)");
  });

  it('either read failing is "could not tell", never zero', () => {
    const seats = method('private async seatFirstBoardsWithALiveSeat(');
    expect(seats.match(/return null;/g)?.length).toBe(2);
    expect(method('private async openedSeatFirstBoards(')).toContain('?? null');
  });
});

describe('2. an empty board is reopened before another is created', () => {
  const open = method('private async ensureBoardOpen<');

  it('reopens before the create loop, and creates nothing while an empty board remains', () => {
    const reopen = open.indexOf('await this.reopenEmptySeatFirstBoard(');
    const create = open.indexOf('const result = await create(config, owner);');
    expect(reopen).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(reopen);
    // The reopen block ends the pass: even a refused reopen spends the budget.
    const block = open.slice(open.indexOf('if (empty.length > 0) {'), create);
    expect(block).toMatch(/budget\.left--;\s*await this\.reopenEmptySeatFirstBoard/);
    expect(block).toMatch(/\}\s*return;\s*\}/);
  });

  it('takes exactly the rows the count takes: own type, never a satellite feeder, joinable', () => {
    expect(open).toContain("const ownType = variant === 'spin' ? 'SPIN' : 'SNG';");
    expect(open).toContain('r.tournament_type === ownType');
    expect(open).toContain('r.satellite_target_id == null');
    expect(open).toContain('r.satellite_target == null');
    expect(open).toContain('withJoinableTable.has(r.id)');
  });

  it('an unreadable seat read opens and creates nothing', () => {
    expect(open).toMatch(/if \(withSeat === null\) return;/);
  });
});

describe('3. a reopened board gets its opening rung before its horse', () => {
  const reopen = method('private async reopenEmptySeatFirstBoard(');

  it('writes start_time first, only on a still-REGISTERING row, and seats nobody if that fails', () => {
    const write = reopen.indexOf('.update({ start_time: startTime })');
    const seat = reopen.indexOf('await this.seedOpenSeatTable(');
    expect(write).toBeGreaterThan(0);
    expect(seat).toBeGreaterThan(write);
    expect(reopen).toContain(".eq('status', 'REGISTERING')");
    expect(reopen).toMatch(/moved\.length !== 1\)[\s\S]*?return;/);
    expect(reopen).toContain('seatFirstOpeningWindowMs(seats)');
  });

  it('opens with exactly one horse, whatever the held-empty roll says', () => {
    expect(reopen).toContain("this.seedOpenSeatTable(row, seats, '', true)");
    const seed = method('private async seedOpenSeatTable(');
    expect(seed).toMatch(
      /const opening =\s*!seatFirstHeldEmpty\(tournament\.id, seats\) \|\| reopening\s*\?\s*openingHorsesForSeatFirst\(seats\)/
    );
  });
});
