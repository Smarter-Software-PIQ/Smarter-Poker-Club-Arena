/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  usePlayerNoteMarkers - Which Opponents At The Table Do I Have A Note On?
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-11-04: "add a post it note style icon any time a user adds a note
 * about another player, they should be able to see that they added a note
 * about a player."
 *
 * The seat needs one bit per opponent: noted or not. This hook loads the
 * signed-in player's noted opponent ids ONCE per sign-in (one narrow query,
 * ids only, never note text), and then keeps the set current from the
 * PlayerNotesService change feed, which every note save and delete on this
 * device goes through. A table never re-reads the whole set because a note
 * was written; it flips the one id that changed.
 *
 * Notes are private, so the set is always the viewer's own: it is keyed on
 * the signed-in user and emptied the moment that user changes or signs out.
 */

import { useEffect, useState } from 'react';
import { playerNotesService } from '../services/PlayerNotesService';
import { reportError } from '../utils/errorReporter';

const EMPTY: ReadonlySet<string> = new Set<string>();

export function usePlayerNoteMarkers(userId: string | null | undefined): ReadonlySet<string> {
  const [noted, setNoted] = useState<ReadonlySet<string>>(EMPTY);

  useEffect(() => {
    if (!userId || userId === 'guest') {
      setNoted(EMPTY);
      return;
    }
    let cancelled = false;
    setNoted(EMPTY);

    playerNotesService
      .getNotedTargetIds(userId)
      .then((ids) => {
        if (!cancelled) setNoted(ids);
      })
      .catch((error) => {
        // A marker is decoration on the felt; a failed read leaves the seats
        // unmarked and is reported, never surfaced as a table error.
        if (!cancelled) reportError(error, 'usePlayerNoteMarkers.load');
      });

    const unsubscribe = playerNotesService.subscribe((change) => {
      if (cancelled || change.userId !== userId) return;
      setNoted((prev) => {
        if (prev.has(change.targetUserId) === change.hasNote) return prev;
        const next = new Set(prev);
        if (change.hasNote) next.add(change.targetUserId);
        else next.delete(change.targetUserId);
        return next;
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  return noted;
}

export default usePlayerNoteMarkers;
