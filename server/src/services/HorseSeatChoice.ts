/**
 * WHERE A HORSE SITS (2026-11-07).
 *
 * Both horse seating paths (the fleet's seeding loop and a horse answering a
 * waiting-list seat offer) took the LOWEST open seat number, so an empty table
 * filled 1, 2, 3, ... in arrival order: the horses clumped on one side of the
 * table, every newcomer sat right next to the last one, and a person watching
 * the lobby could tell a horse by where it sat. A person looks at the table
 * and picks a chair: away from the crowd, rarely right beside whoever sat down
 * a moment ago, and, when a hand is running, a little more often on the
 * button's side (late position) than straight into the blinds.
 *
 * This module only chooses WHICH of the open chairs. It never decides WHETHER
 * a horse sits, never offers a chair that is not open, and so leaves every
 * gate above it (the sit verdict, the seat budget, waiting-list holds, a
 * person's offered or held seat, the database's unique seat constraint) as it
 * was. The choice is deterministic per (horse, table, moment): md5 of the key,
 * like every other horse habit in HorseBehavior, so a test can reproduce it.
 */
import { createHash } from 'node:crypto';

/** A [0, 1) unit from the first 32 bits of md5(key). */
export function seatChoiceUnit(key: string): number {
  const hex = createHash('md5').update(key).digest('hex');
  return parseInt(hex.slice(0, 8), 16) / 0x1_0000_0000;
}

/** Steps between two chairs around a table of `maxSeats` (seats are 1-based). */
export function seatDistance(a: number, b: number, maxSeats: number): number {
  const d = Math.abs(a - b) % maxSeats;
  return Math.min(d, maxSeats - d);
}

export interface SeatWeightContext {
  maxSeats: number;
  /** Chairs already taken (people, horses, and chairs given out this cycle). */
  occupied: ReadonlySet<number>;
  /** The chair the previous arrival took, if one sat down this cycle. */
  lastArrivalSeat?: number | null;
  /** The button of the hand in progress (0 / null when unknown). */
  buttonSeat?: number | null;
}

/** How much a person would like this chair. Always > 0. */
export function seatWeight(seat: number, ctx: SeatWeightContext): number {
  const n = ctx.maxSeats;
  // SPREAD OUT: distance to the nearest taken chair, capped at 3.
  let nearest = n;
  for (const o of ctx.occupied) nearest = Math.min(nearest, seatDistance(seat, o, n));
  let w = 1 + Math.min(nearest, 3);
  // NOT RIGHT BESIDE THE LAST ARRIVAL (rarely, not never).
  const last = ctx.lastArrivalSeat ?? null;
  if (last !== null && last > 0 && seatDistance(seat, last, n) === 1) w *= 0.4;
  // POSITION: the button and the cutoff are a little favoured, the two
  // chairs the blinds reach next a little less (nothing is forbidden).
  const button = ctx.buttonSeat ?? 0;
  if (button > 0 && button <= n) {
    const offset = (((seat - button) % n) + n) % n; // 0 button, 1 SB, 2 BB, n-1 cutoff
    if (offset === 0 || offset === n - 1) w *= 1.3;
    else if (offset === 1 || offset === 2) w *= 0.85;
  }
  return w;
}

export interface SeatChoiceInput extends SeatWeightContext {
  horseId: string;
  tableId: string;
  /** The deciding moment (a cycle bucket); same moment, same chair. */
  moment: number | string;
  /** The open chairs this horse may take. The answer is always one of them. */
  open: readonly number[];
}

/** One chair among `open`, weighted like a person; null only when none is open. */
export function chooseHorseSeat(input: SeatChoiceInput): number | null {
  const open = [...new Set(input.open)]
    .filter((s) => Number.isInteger(s) && s >= 1 && !input.occupied.has(s))
    .sort((a, b) => a - b);
  if (open.length === 0) return null;
  if (open.length === 1) return open[0];
  const weights = open.map((s) => seatWeight(s, input));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = seatChoiceUnit(`${input.horseId}:${input.tableId}:seat:${input.moment}`) * total;
  for (let i = 0; i < open.length; i++) {
    r -= weights[i];
    if (r < 0) return open[i];
  }
  return open[open.length - 1];
}

/** A cycle's chair book for one table, in arrival order. */
export interface HorseSeatPicker {
  /** The chairs still open, ascending. */
  open(): number[];
  /** Give this horse a chair (and mark it taken), or null if none is open. */
  take(horseId: string): number | null;
  /** A chair whose buy-in failed is open again. */
  release(seat: number): void;
}

/** The chair book both seating paths use. Chairs are 1..maxSeats. */
export function horseSeatPicker(args: {
  tableId: string;
  moment: number | string;
  maxSeats: number;
  occupied: Iterable<number>;
  buttonSeat?: number | null;
}): HorseSeatPicker {
  const n = Math.max(0, Math.floor(Number(args.maxSeats) || 0));
  const taken = new Set<number>();
  for (const s of args.occupied) taken.add(Number(s));
  let last: number | null = null;
  const open = () => {
    const out: number[] = [];
    for (let s = 1; s <= n; s++) if (!taken.has(s)) out.push(s);
    return out;
  };
  return {
    open,
    take(horseId) {
      const seat = chooseHorseSeat({
        horseId,
        tableId: args.tableId,
        moment: args.moment,
        maxSeats: n,
        open: open(),
        occupied: taken,
        lastArrivalSeat: last,
        buttonSeat: args.buttonSeat ?? null,
      });
      if (seat === null) return null;
      taken.add(seat);
      last = seat;
      return seat;
    },
    release(seat) {
      taken.delete(seat);
    },
  };
}

/** The deciding moment for a seating pass: the minute it runs in. */
export function seatChoiceMoment(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 60_000);
}
