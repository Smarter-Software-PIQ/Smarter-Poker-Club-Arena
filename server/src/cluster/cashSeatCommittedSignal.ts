/**
 * A CASH CHAIR WAS TAKEN AND ITS TABLE IS FULL (2026-11-22). In-process,
 * synchronous, never awaited, like seatBoundarySignals.
 *
 * Raised by a cash table engine at the two moments it already learns a chair
 * was taken: the player's client reporting its committed buy-in
 * (ServerTableEngine.noteSeatArrival, state `seated`) and the hand boundary
 * adopting a roster that gained a player (ServerTableEngineBase.adoptSeatRoster).
 * The fleet listens and asks for the game's line at once when the game is full
 * with nobody waiting (HorseLineOnArrival). One listener: the fleet of this
 * process. A listener that throws never reaches the table engine.
 */
type CashSeatCommittedListener = (tableId: string) => void;

let listener: CashSeatCommittedListener | null = null;

/** The fleet registers itself on start and clears itself on stop. */
export function onCashSeatCommitted(fn: CashSeatCommittedListener | null): void {
  listener = fn;
}

/** A cash table this engine deals just filled a chair. */
export function noteCashSeatCommitted(tableId: string | null | undefined): void {
  if (!tableId || !listener) return;
  try {
    listener(tableId);
  } catch {
    /* The table engine never pays for the fleet's answer. */
  }
}
