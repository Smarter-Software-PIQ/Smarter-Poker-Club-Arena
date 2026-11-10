/**
 * REAL ARRIVALS WHILE WAITING (Dan 2026-11-10).
 *
 * Dan, verbatim: "THE TRANSITION TO THE NEXT GAME FEELS FAKE, YOU ARE JUST
 * SITTING THERE, AND THEN ALL AT ONCE ALL THE PLAYERS APPEAR AND CARDS ARE
 * DEALT, INSTEAD OF SHOWING ALL PLAYERS AS THEY ARRIVE."
 *
 * WHAT IS REAL, AND WHAT IS NOT KNOWABLE. The matcher forms a table in one
 * step: until it forms, nobody (not the engine, not the database) knows WHO
 * will sit at the player's next table. What the database does know, every
 * forming pass, is how many legal players it left waiting for the next table
 * (legal_count less the players it placed). The engine sends that count to
 * every waiting room of the Cluster, privately, when it changes
 * (USER_EVENT 'lightning_pool_waiting'; LightningRegistry.setPoolWaiting).
 *
 * So the felt shows exactly that: the hero's new table at once, with one
 * anonymous arriving chair for each OTHER player actually waiting, filling as
 * real players free up and join the wait. No name, no avatar, no stack: a
 * chair is a real player whose identity is not known yet, never an invented
 * one. When the table forms, the real players take those chairs through the
 * hand's arrival window (#10370), then the deal.
 *
 * Inert until the engine sends the frame: no frame, no arriving chair.
 */

// The store lives beside the decision queue (the socket client feeds both);
// this module, read only by the table page, keeps the seat rule.
import type { LightningPoolWaitingEntry } from './lightningDecisionQueue';
export {
  lightningPoolWaitingFor,
  noteLightningPoolWaiting,
  resetLightningPoolWaitingForTests,
  subscribeLightningPoolWaiting,
  type LightningPoolWaitingEntry,
} from './lightningDecisionQueue';

/**
 * Which open chairs draw an arriving player. Empty unless the hero is waiting
 * (no hand on the felt, not sitting out) and a count arrived during THIS wait:
 * `staleEntry` is the entry already held when the wait began (it described
 * the wait before the last hand), and is never used again. One chair per
 * other waiting player, clockwise from the hero's chair, never more than the
 * open chairs.
 */
export function lightningArrivingSeats(input: {
  entry: LightningPoolWaitingEntry | null;
  staleEntry: LightningPoolWaitingEntry | null;
  heroWaiting: boolean;
  sittingOut: boolean;
  heroSeat: number;
  seatCount: number;
  occupied: (seat: number) => boolean;
}): ReadonlySet<number> {
  const out = new Set<number>();
  const { entry, heroSeat, seatCount } = input;
  if (!input.heroWaiting || input.sittingOut || !entry || entry === input.staleEntry) return out;
  if (!Number.isInteger(heroSeat) || heroSeat < 1 || heroSeat > seatCount) return out;
  let others = Math.min(entry.waiting - 1, seatCount - 1);
  for (let step = 1; step < seatCount && others > 0; step++) {
    const seat = ((heroSeat - 1 + step) % seatCount) + 1;
    if (input.occupied(seat)) continue;
    out.add(seat);
    others--;
  }
  return out;
}
