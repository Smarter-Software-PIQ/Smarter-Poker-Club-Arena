/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  usePlayerNoteMarkers - Which Opponents At The Table Do I Have A Note On?
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-11-04: "add a post it note style icon any time a user adds a note
 * about another player, they should be able to see that they added a note
 * about a player."
 *
 * The seat needs one fact per opponent: noted or not, and in which colour.
 * This hook loads the signed-in player's noted opponents ONCE per sign-in
 * (one narrow query: ids and colour labels, never note text), and then keeps
 * the map current from two feeds:
 *
 *   1. the PlayerNotesService change feed, which every save and delete on
 *      THIS device goes through, so the marker moves the instant the player
 *      presses Save;
 *   2. a realtime subscription on the player's own `player_notes` rows, so a
 *      note written on the phone shows up on the desktop table without a
 *      reload (migration 20261104193818 put the table on the publication).
 *
 * A table never re-reads the whole set because a note was written; it flips
 * the one opponent that changed.
 *
 * Notes are private, so the map is always the viewer's own: it is keyed on
 * the signed-in user and emptied the moment that user changes or signs out.
 * Returns a map of opponent id -> colour label ('none', 'red', ...).
 */

import { useEffect, useState } from 'react';
import { masterBus } from '../core/MasterBus';
import { subscribeRealtime } from '../lib/subscribeRealtime';
import { playerNotesService } from '../services/PlayerNotesService';
import { reportError } from '../utils/errorReporter';

const EMPTY: ReadonlyMap<string, string> = new Map<string, string>();

export function usePlayerNoteMarkers(
  userId: string | null | undefined
): ReadonlyMap<string, string> {
  const [noted, setNoted] = useState<ReadonlyMap<string, string>>(EMPTY);

  useEffect(() => {
    if (!userId || userId === 'guest') {
      setNoted(EMPTY);
      return;
    }
    let cancelled = false;
    setNoted(EMPTY);

    const apply = (targetUserId: string, hasNote: boolean, colorLabel: string) => {
      setNoted((prev) => {
        const current = prev.get(targetUserId);
        if (!hasNote && current === undefined) return prev;
        if (hasNote && current === colorLabel) return prev;
        const next = new Map(prev);
        if (hasNote) next.set(targetUserId, colorLabel);
        else next.delete(targetUserId);
        return next;
      });
    };

    const load = () =>
      playerNotesService
        .getNotedTargets(userId)
        .then((targets) => {
          if (!cancelled) setNoted(targets);
        })
        .catch((error) => {
          // A marker is decoration on the felt; a failed read leaves the seats
          // unmarked and is reported, never surfaced as a table error.
          if (!cancelled) reportError(error, 'usePlayerNoteMarkers.load');
        });
    void load();

    const unsubscribe = playerNotesService.subscribe((change) => {
      if (cancelled || change.userId !== userId) return;
      apply(change.targetUserId, change.hasNote, change.colorLabel ?? 'none');
    });

    // Other devices: the player's own rows, over the shared socket.
    const channelKey = `player-notes:${userId}`;
    const admission = new AbortController();
    const channel = masterBus.getOrCreateChannel(channelKey);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'player_notes', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (cancelled) return;
        const row = (payload?.eventType === 'DELETE' ? payload?.old : payload?.new) as
          | Record<string, unknown>
          | null
          | undefined;
        const target = row?.target_user_id;
        if (typeof target !== 'string' || !target) return;
        const color = typeof row?.color_label === 'string' ? (row.color_label as string) : 'none';
        apply(target, payload?.eventType !== 'DELETE', color);
      }
    );
    let subscribedOnce = false;
    void subscribeRealtime(
      channel,
      (status) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          // A rejoin after a socket drop may have missed changes: re-read once.
          if (subscribedOnce) void load();
          subscribedOnce = true;
        }
      },
      admission.signal
    );

    return () => {
      cancelled = true;
      unsubscribe();
      admission.abort();
      masterBus.removeRegisteredChannel(channelKey, channel);
    };
  }, [userId]);

  return noted;
}

export default usePlayerNoteMarkers;
