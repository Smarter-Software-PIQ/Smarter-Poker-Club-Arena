/**
 * A TOURNAMENT CHAIR IS SHOWN THE MOMENT IT IS TAKEN (Dan 2026-11-18): the
 * manager's half. See committedSeatShow.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CommittedSeatShow,
  wakeCommitsASeat,
  type CommittedSeatRow,
  type SeatShowingEngine,
} from './committedSeatShow.js';

function engine(needs: (rows: ReadonlyArray<CommittedSeatRow>) => boolean) {
  return {
    asked: [] as CommittedSeatRow[][],
    shows: 0,
    tournamentSeatsNeedShowing(rows: ReadonlyArray<CommittedSeatRow>) {
      this.asked.push([...rows]);
      return needs(rows);
    },
    async showCommittedTournamentSeats() {
      this.shows++;
    },
  };
}
const row = (table: string, user: string, seat: number, stack: number): CommittedSeatRow => ({
  table_id: table,
  user_id: user,
  occupancy_id: `occ-${user}`,
  seat_number: seat,
  stack,
});

function field(seats: CommittedSeatRow[] | null) {
  const a = engine((rows) => rows.some((r) => r.user_id === 'late'));
  const b = engine(() => false);
  const tables = new Map<string, SeatShowingEngine>([
    ['table-a', a],
    ['table-b', b],
  ]);
  const state = { active: true, seats };
  const readSeats = vi.fn(async (_ids: string[]) => state.seats);
  const report = vi.fn();
  const show = new CommittedSeatShow({
    tables: () => [...tables],
    readSeats,
    active: () => state.active,
    report,
  });
  return { a, b, tables, state, readSeats, report, show };
}

describe('CommittedSeatShow', () => {
  it('reads the field once and has only the table whose rows changed read its roster', async () => {
    const f = field([row('table-a', 'late', 4, 10_000), row('table-b', 'old', 1, 500)]);
    await f.show.request();
    expect(f.readSeats).toHaveBeenCalledTimes(1);
    expect(f.readSeats).toHaveBeenCalledWith(['table-a', 'table-b']);
    expect(f.a.asked).toEqual([[row('table-a', 'late', 4, 10_000)]]);
    expect(f.b.asked).toEqual([[row('table-b', 'old', 1, 500)]]);
    expect(f.a.shows).toBe(1);
    expect(f.b.shows).toBe(0);
  });

  it('treats an incomplete read as unknown and asks no table anything', async () => {
    const f = field(null);
    await f.show.request();
    expect(f.a.asked).toEqual([]);
    expect(f.a.shows + f.b.shows).toBe(0);
  });

  it('answers requests made during a pass with exactly one more pass', async () => {
    const f = field([]);
    let open!: () => void;
    f.readSeats.mockImplementationOnce(
      () =>
        new Promise<CommittedSeatRow[]>((resolve) => {
          open = () => resolve([]);
        })
    );
    const first = f.show.request();
    const second = f.show.request();
    const third = f.show.request();
    f.state.seats = [row('table-a', 'late', 4, 10_000)];
    open();
    await Promise.all([first, second, third]);
    expect(f.readSeats).toHaveBeenCalledTimes(2);
    expect(f.a.shows).toBe(1);
  });

  it('does nothing once the manager is no longer active, before or after the read', async () => {
    const f = field([row('table-a', 'late', 4, 10_000)]);
    f.state.active = false;
    await f.show.request();
    f.show.moved('table-a');
    expect(f.readSeats).not.toHaveBeenCalled();
    expect(f.a.shows).toBe(0);

    const g = field([row('table-a', 'late', 4, 10_000)]);
    g.readSeats.mockImplementationOnce(async () => {
      g.state.active = false;
      return g.state.seats;
    });
    await g.show.request();
    expect(g.a.shows).toBe(0);
  });

  it('skips a table whose engine was replaced during the read', async () => {
    const f = field([row('table-a', 'late', 4, 10_000)]);
    f.readSeats.mockImplementationOnce(async () => {
      f.tables.set(
        'table-a',
        engine(() => true)
      );
      return f.state.seats;
    });
    await f.show.request();
    expect(f.a.shows).toBe(0);
  });

  it('shows a certified move at its destination only, with no field read', () => {
    const f = field([]);
    f.show.moved('table-b');
    f.show.moved('table-not-ours');
    expect(f.b.shows).toBe(1);
    expect(f.a.shows).toBe(0);
    expect(f.readSeats).not.toHaveBeenCalled();
  });

  it('never throws into the move path that calls it', () => {
    const report = vi.fn();
    const broken = new CommittedSeatShow({
      tables: () => {
        throw new Error('registry unavailable');
      },
      readSeats: async () => [],
      active: () => true,
      report,
    });
    expect(() => broken.moved('table-a')).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1);
    // An engine double that predates the show method is simply skipped.
    const old = new CommittedSeatShow({
      tables: () => [['table-a', {} as SeatShowingEngine]],
      readSeats: async () => [],
      active: () => true,
      report,
    });
    expect(() => old.moved('table-a')).not.toThrow();
  });

  it('reports a failed read and stays usable', async () => {
    const f = field([row('table-a', 'late', 4, 10_000)]);
    f.readSeats.mockRejectedValueOnce(new Error('boom'));
    await f.show.request();
    expect(f.report).toHaveBeenCalledTimes(1);
    await f.show.request();
    expect(f.a.shows).toBe(1);
  });

  it('knows which manager wakes commit a seat row or its stack', () => {
    expect(['late_registration', 'rebuy', 'reentry'].every(wakeCommitsASeat)).toBe(true);
    expect(['addon', 'deal_vote', 'bounty_settled', '', undefined].some(wakeCommitsASeat)).toBe(
      false
    );
  });
});
