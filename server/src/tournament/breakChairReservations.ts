import type { BalancerTable } from '../engine/TableBalancer.js';
import type { TableBreakMember } from './tournamentTableBreakRpc.js';

/**
 * A BREAK'S OWN UNLANDED MEMBERS HOLD THEIR CHAIRS (2026-11-27).
 *
 * A begun break owns one active attempt per member, and each attempt names an
 * exact destination chair. Until that member lands, the chair is promised to
 * them in f06_attempts but nothing in `table_seats` or `tournament_players`
 * says so, so a board read from those tables shows it free.
 *
 * `repairTournamentBreakDestinations` replaced each member whose chair had
 * been taken by reading that board again and asking the balancer for the best
 * free chair. Every member it replaced in the same pass was therefore offered
 * the SAME chair: production 2026-11-27 07:22 to 07:27 UTC, breaks of tables
 * 32756123, 64f30f03 and 58f82b7f amended three members each to one chair
 * (0ec2f753#8, 0c9285f3#1, 0c9285f3#8), the first landed and every other was
 * refused "tournament move destination seat is occupied", then all the losers
 * were amended to one chair again on the next pass.
 *
 * These helpers make the chairs a break's other unlanded members hold visible
 * to the board the replacement is chosen from, so the engine never offers a
 * member a chair the door is certain to refuse.
 */

/** Chairs held by unlanded members of this break, excluding `exceptUserId`. */
export function chairsHeldByUnlandedBreakMembers(
  members: readonly TableBreakMember[],
  exceptUserId: string | null
): Map<string, Set<number>> {
  const held = new Map<string, Set<number>>();
  for (const member of members) {
    if (member.user_id === exceptUserId) continue;
    if (member.winner_request_id || !member.active_request_id) continue;
    if (!member.destination_table_id || member.destination_seat_number === null) continue;
    const chairs = held.get(member.destination_table_id) ?? new Set<number>();
    chairs.add(member.destination_seat_number);
    held.set(member.destination_table_id, chairs);
  }
  return held;
}

/**
 * Does an unlanded member listed BEFORE `userId` already hold this chair?
 * The first holder keeps a shared chair; each later one is replaced.
 */
export function chairHeldByEarlierUnlandedMember(
  members: readonly TableBreakMember[],
  userId: string,
  tableId: string | null,
  seat: number | null
): boolean {
  if (!tableId || seat === null) return false;
  for (const member of members) {
    if (member.user_id === userId) return false;
    if (member.winner_request_id || !member.active_request_id) continue;
    if (member.destination_table_id === tableId && member.destination_seat_number === seat)
      return true;
  }
  return false;
}

/**
 * A copy of `board` whose tables also reserve the given chairs. Players are
 * copied too: the balancer records its placements on the tables it is given,
 * and a board read for one member must not carry another member's simulation.
 */
export function boardWithHeldChairs(
  board: readonly BalancerTable[],
  held: ReadonlyMap<string, ReadonlySet<number>>
): BalancerTable[] {
  return board.map((table) => {
    const extra = held.get(table.tableId);
    const reserved = new Set<number>(table.reservedSeats ?? []);
    for (const seat of extra ?? []) {
      if (!table.players.some((player) => player.seat === seat)) reserved.add(seat);
    }
    return {
      ...table,
      players: table.players.map((player) => ({ ...player })),
      reservedSeats: [...reserved].sort((a, b) => a - b),
    };
  });
}
