/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A SEAT NEVER SAYS ZERO FOR A BALANCE IT DOES NOT KNOW (Dan 2026-11-18)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "WHEN A PLAYER JOINS A TABLE IN BETWEEN THE BLINDS OR ANY OTHER REASON,
 * THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO."
 *
 * A player who holds a chair but is not in the hand being played (waiting for
 * the big blind, waiting for the button, just bought in, just moved tables)
 * is drawn from a stand-in until the engine's roster carries them. The
 * stand-in fell back to the number 0 whenever it had no balance to hand yet:
 * before the first seat read answered, after a buy-in recovered from its
 * receipt, on every tournament seat, and for another player first seen through
 * presence. The seat then read 0 over real chips. The same defect was fixed
 * once for one source (2026-10-12, a seat holding 3,632 read 0.00) and every
 * other source kept the fallback.
 *
 * One rule for every stand-in: the best CONFIRMED balance is shown, and an
 * unknown balance is marked pending (the seat draws its loading mark) and is
 * never printed as a number. A confirmed zero is still a zero.
 */
export interface StandInStack {
  stack: number;
  stackPending: boolean;
}

function confirmed(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function standInStack(sources: {
  /** A Lightning seat between hands: a number, null while unknown, undefined off Lightning. */
  lightningStack?: number | null;
  /** `table_seats.stack` as last read for this occupant, or null before a read. */
  rowStack: number | null | undefined;
  /** The buy-in this device just had confirmed; 0 when there is none. */
  paidBuyIn?: number | null;
}): StandInStack {
  if (sources.lightningStack !== undefined) {
    return confirmed(sources.lightningStack)
      ? { stack: sources.lightningStack, stackPending: false }
      : { stack: 0, stackPending: true };
  }
  if (confirmed(sources.rowStack)) return { stack: sources.rowStack, stackPending: false };
  if (confirmed(sources.paidBuyIn) && sources.paidBuyIn > 0) {
    return { stack: sources.paidBuyIn, stackPending: false };
  }
  return { stack: 0, stackPending: true };
}
