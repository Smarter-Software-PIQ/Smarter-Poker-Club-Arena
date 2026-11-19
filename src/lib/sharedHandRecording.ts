/**
 * A SHARED HAND IS RECORDED ONCE.
 *
 * The table records how a hand LOOKED (chip flights, seat paints, throws,
 * board timing) in journals that keep growing after `hand_complete`: the
 * engine sends `pot_win` about three seconds later, and the pot push and the
 * winner's seat paint are journalled then. The Share sheet used to be handed
 * the hand at `hand_complete` and then handed it AGAIN each time the journals
 * were re-read (when the sheet opened, when the next hand started, on a
 * repeated completion event). Every re-read was a different encoded payload,
 * and the short link is keyed by the payload, so one hand reserved several
 * links. Production, 2026-11-18: three reservations for one hand inside ten
 * seconds, payload lengths 1,056, 3,030 and 3,540.
 *
 * This is the one place that decides when a hand's recording is FINAL.
 *
 *   begin(hand, facts)  the hand ended; its facts are known, its presentation
 *                       is still being painted. Nothing is offered yet.
 *   seal(journal)       the presentation is over (the post-hand reset ran, or
 *                       the next hand started). The journal is read ONE time
 *                       and the result never changes again.
 *
 * Only a sealed hand may be given to the Share sheet or to a link
 * reservation. A journal that belongs to another hand is never merged, so a
 * later hand's paints cannot reach an earlier hand.
 *
 * Presentation and sharing only. Nothing here reads or moves money.
 */

/** What the page's journals hold right now, and the hand they belong to. */
export interface PresentationJournal<P extends object> {
  hand: number;
  parts: P;
}

interface Shareable<A extends object> {
  appearance?: A;
}

export interface SharedHandRecording<A extends object, H extends Shareable<A>> {
  /**
   * The hand ended. Returns false, and changes nothing, when this hand is
   * already sealed: a repeated completion event cannot reopen a recording.
   * While the hand is still open, a repeat replaces its facts (still unoffered).
   */
  begin(hand: number, facts: H): boolean;
  /** The hand whose presentation is still being painted, or null. */
  pendingHand(): number | null;
  /** The open hand as it would read now. Never seals; for the local archive only. */
  preview(journal: PresentationJournal<Partial<A>>): H | null;
  /**
   * Close the open recording. Returns the final hand the first time and null
   * on every later call, so the journal cannot be merged twice.
   */
  seal(journal: PresentationJournal<Partial<A>>): H | null;
  /** The last sealed hand: the only value a sheet or a reservation may be given. */
  sealed(): H | null;
  /** The number of the last sealed hand, or null. */
  sealedHand(): number | null;
  /**
   * Run `offer` once the recording it needs is final. `hand` is the hand the
   * caller wants to share, or null for "the hand that just finished". Runs it
   * now and returns true unless that hand is still being painted; otherwise
   * keeps it (the latest request wins) and seal() runs it. A request is never
   * answered with a recording that can still change.
   */
  whenSealed(hand: number | null, offer: () => void): boolean;
  /** Drop a waiting request (the page is going away). */
  forgetRequest(): void;
}

function withJournal<A extends object, H extends Shareable<A>>(
  hand: number,
  facts: H,
  journal: PresentationJournal<Partial<A>>
): H {
  /* Another hand's journal (the next deal already reset it, or a reconnect
     moved the felt on) says nothing about this hand. Keep what was recorded
     at completion rather than borrow paints from a different hand. */
  if (journal.hand !== hand || !facts.appearance) return facts;
  return { ...facts, appearance: { ...facts.appearance, ...journal.parts } };
}

export function createSharedHandRecording<
  A extends object,
  H extends Shareable<A>,
>(): SharedHandRecording<A, H> {
  let open: { hand: number; facts: H } | null = null;
  let done: { hand: number; value: H } | null = null;
  let waiting: (() => void) | null = null;
  return {
    begin(hand, facts) {
      if (done && done.hand === hand) return false;
      open = { hand, facts };
      return true;
    },
    pendingHand: () => (open ? open.hand : null),
    preview: (journal) => (open ? withJournal(open.hand, open.facts, journal) : null),
    seal(journal) {
      if (!open) return null;
      const value = Object.freeze(withJournal(open.hand, open.facts, journal));
      done = { hand: open.hand, value };
      open = null;
      const offer = waiting;
      waiting = null;
      offer?.();
      return value;
    },
    sealed: () => (done ? done.value : null),
    sealedHand: () => (done ? done.hand : null),
    whenSealed(hand, offer) {
      if (!open || (hand != null && hand !== open.hand)) {
        offer();
        return true;
      }
      waiting = offer;
      return false;
    },
    forgetRequest() {
      waiting = null;
    },
  };
}
