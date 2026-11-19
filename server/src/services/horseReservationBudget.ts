/**
 * A HORSE AT ITS TOURNAMENT RESERVATION BUDGET IS NEVER OFFERED A SEAT
 * (incident eaafbbfb, SpinFleetProducingNothing, 2026-11-19).
 *
 * The seat door fn_seat_horse_in_seat_first_game refuses a horse that already
 * holds four unresolved tournament promises (`horse_tournament_reservation_budget`,
 * migration 20261027062132). The free-horse picker counted only live seats
 * and registrations inside a short horizon, so a horse booked into four future
 * MTTs read as free here and was refused there - pass after pass. On the night
 * of 2026-11-18/19 six horse-only Spins waited 8,049-9,407 s against an
 * 8,400 s ladder envelope while the log said, every pass:
 *
 *   seat-first fill a059fedf: the seat RPC answered ok:false -
 *     horse_tournament_reservation_budget x3
 *
 * This is the one read both sides share: fn_horses_at_tournament_reservation_budget
 * computes the door's own predicate (migration 20261119181143). The picker
 * reads it once per pass and leaves those horses out, and a refusal the read
 * did not yet know about (a horse that bought a fourth entry between the read
 * and the call) is remembered for a short while so the same horse is not
 * offered again on the next pass.
 *
 * The door stays the authority. An unreadable answer is not "nobody is at the
 * budget" in the sense of a fault: it is reported and the picker behaves
 * exactly as it did before this read existed - the door still refuses, and
 * the remembered refusals still apply.
 */
import { supabase } from './supabase.js';
import { reportError } from './errorReporter.js';

/** How long a door refusal keeps a horse out of the picker without a fresh read saying so. */
export const HORSE_RESERVATION_REFUSAL_MEMORY_MS = 2 * 60_000;

/** The door's refusal reason this read mirrors. */
export const HORSE_RESERVATION_BUDGET_REASON = 'horse_tournament_reservation_budget';

/** The read the picker shares with the door. */
export const HORSE_RESERVATION_BUDGET_RPC = 'fn_horses_at_tournament_reservation_budget';

export type ReservationBudgetRpc = () => PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;

export class HorseReservationBudget {
  private readonly refused = new Map<string, number>();
  private unreadableReported = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly rpc: ReservationBudgetRpc = () =>
      supabase.rpc(HORSE_RESERVATION_BUDGET_RPC) as unknown as PromiseLike<{
        data: unknown;
        error: { message: string; code?: string } | null;
      }>
  ) {}

  /** The seat door just refused this horse for its reservation budget. */
  noteRefused(horseId: string): void {
    if (horseId) this.refused.set(horseId, this.now());
  }

  /** Horses the door would refuse for the reservation budget, right now. */
  async atBudget(): Promise<Set<string>> {
    const out = new Set<string>();
    const t = this.now();
    for (const [id, at] of this.refused) {
      if (t - at < HORSE_RESERVATION_REFUSAL_MEMORY_MS) out.add(id);
      else this.refused.delete(id);
    }
    let answer: Awaited<ReturnType<ReservationBudgetRpc>> | undefined;
    try {
      answer = await this.rpc();
    } catch (error) {
      this.reportUnreadable(error instanceof Error ? error.message : String(error));
      return out;
    }
    if (!answer || answer.error || !Array.isArray(answer.data)) {
      this.reportUnreadable(answer?.error?.message ?? 'no array returned');
      return out;
    }
    this.unreadableReported = false;
    for (const id of answer.data) if (typeof id === 'string' && id) out.add(id);
    return out;
  }

  private reportUnreadable(why: string): void {
    if (this.unreadableReported) return;
    this.unreadableReported = true;
    reportError(
      new Error(
        `[HorseReservationBudget] ${HORSE_RESERVATION_BUDGET_RPC} unreadable (${why}); ` +
          'the picker offers as before and the seat door decides'
      ),
      'HorseReservationBudget.read_failed'
    );
  }
}
