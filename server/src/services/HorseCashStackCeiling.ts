/**
 * HORSE CASH STACK CEILING (2026-11-19, runtime setting `horse.cashStackCeilingBB`, compiled default 0 = OFF).
 *
 * MEASURED (5 weeks, Oct 15 to Nov 19 2026, PLO4/PLO5 cash, 102,362 Horse hands dealt with a person at the table):
 * a Horse whose own stack is above 250 big blinds loses 66.9 bb/100 (43% of its hands, 82% of its losses); at or
 * under 250 it loses 10.7 bb/100, and the same whether the deepest person at the table is deep or not. The table
 * maximum is 200 big blinds, so a Horse only gets deeper by winning up or by returning with a carried stack, and
 * the one rule that made it leave was the bank-the-win line at 4-6x its starting stack (800-1,200 big blinds).
 *
 * WHAT THE SETTING DOES, PLO4 AND PLO5 CASH ONLY (table and Lightning; never PLO6, PLO8, hold'em or a tournament):
 *  1. A Horse whose stack is ABOVE the ceiling books its win through the existing bank-the-win exit: it finishes
 *     the hand, plays the orbit it owes after a big pot and every hand of the hit-and-run count, and gets up at the
 *     boundary before its next big blind through the ordinary voluntary door, exactly as a person would.
 *  2. It only gets up when the game keeps running without it (ceilingExitKeepsTheGame): the fleet refills the
 *     seat at the normal buy-in on its next cycle, and nobody else's seat is touched.
 *  3. No rathole: the door records the stack it left with as its floor in that game. A Horse whose floor is above
 *     the ceiling is not a buyer in that game until the floor lapses (rejoinFloorIsAboveCeiling), so it never
 *     comes back short and never comes back deep.
 *
 * The ceiling is never below the table's maximum buy-in: a Horse sitting on a normal buy-in is never over it.
 * Pure arithmetic, no IO, no clock.
 */

export const HORSE_CASH_STACK_CEILING_KEY = 'horse.cashStackCeilingBB';
/** The compiled default: no ceiling. */
export const HORSE_CASH_STACK_CEILING_COMPILED_BB = 0;

const CEILING_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/** Exactly PLO4 or PLO5 high ('plo6', 'plo8', hi-lo and every hold'em game are out). */
export function isStackCeilingVariant(variant: unknown): boolean {
  return typeof variant === 'string' && CEILING_VARIANTS.has(variant.toLowerCase());
}

/**
 * The ceiling in chips for this table, or null when there is none: the setting is 0, the game is not PLO4/PLO5
 * cash, or the blinds are unknown. Never below the table's maximum buy-in.
 */
export function horseCashStackCeilingChips(input: {
  ceilingBB: number | undefined | null;
  variant: unknown;
  bigBlind: unknown;
  maxBuyIn?: unknown;
  isTournament?: boolean;
}): number | null {
  const ceilingBB = Number(input.ceilingBB);
  if (!Number.isFinite(ceilingBB) || ceilingBB <= 0) return null;
  if (input.isTournament === true || !isStackCeilingVariant(input.variant)) return null;
  const bb = Number(input.bigBlind);
  if (!Number.isFinite(bb) || bb <= 0) return null;
  const max = Number(input.maxBuyIn);
  const chips = ceilingBB * bb;
  return Number.isFinite(max) && max > chips ? max : chips;
}

/** Is this stack above the ceiling? False when there is no ceiling. */
export function stackIsAboveCeiling(
  stack: unknown,
  ceilingChips: number | null | undefined
): boolean {
  if (ceilingChips === null || ceilingChips === undefined || !(ceilingChips > 0)) return false;
  const s = Number(stack);
  return Number.isFinite(s) && s > ceilingChips;
}

/**
 * A ceiling exit never thins a game: after it, at least max(3, seats - 2) players are still seated (four at a
 * six-max table, five at a seven-max), so a person is never left alone or heads-up by this rule and the exit waits
 * for the fleet's refill when the table is already short.
 */
export function ceilingExitKeepsTheGame(playersNow: number, seatsAtTable: number): boolean {
  const now = Math.floor(Number(playersNow) || 0);
  const seats = Math.floor(Number(seatsAtTable) || 0);
  const floor = Math.max(3, seats - 2);
  return now - 1 >= floor;
}

/** No rathole, both ways: a floor above the ceiling keeps the Horse out of that game until it lapses. */
export function rejoinFloorIsAboveCeiling(
  rejoinFloor: number | undefined,
  ceilingChips: number | null | undefined
): boolean {
  return rejoinFloor !== undefined && stackIsAboveCeiling(rejoinFloor, ceilingChips);
}
