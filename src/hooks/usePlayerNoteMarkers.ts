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
 * ONE feed per signed-in player serves every table on the screen (the
 * multi-table page mounts several TablePages at once, and a Supabase channel
 * refuses to be subscribed twice), so the work lives in a module-level
 * registry keyed by user id, reference-counted by the hooks that read it:
 *
 *   1. one narrow load per sign-in (ids and colour labels, never note text);
 *   2. the PlayerNotesService change feed, which every save and delete on
 *      THIS device goes through, so the marker moves the instant the player
 *      presses Save;
 *   3. one realtime subscription on the player's own `player_notes` inserts
 *      and updates, so a note written on the phone shows up on the desktop
 *      table without a reload (migration 20261104193818 put the table on the
 *      publication); deletes are not subscribed, for privacy (see below).
 *
 * Nothing re-reads the whole set because a note was written; it flips the one
 * opponent that changed. Notes are private, so the map is always the
 * viewer's own: keyed on the signed-in user and emptied for anyone else.
 * Returns a map of opponent id -> colour label ('none', 'red', ...).
 */

import { useEffect, useState } from 'react';
import { masterBus } from '../core/MasterBus';
import { subscribeRealtime } from '../lib/subscribeRealtime';
import { playerNotesService } from '../services/PlayerNotesService';
import { reportError } from '../utils/errorReporter';

const EMPTY: ReadonlyMap<string, string> = new Map<string, string>();

type Listener = (next: ReadonlyMap<string, string>) => void;

interface Feed {
  current: ReadonlyMap<string, string>;
  listeners: Set<Listener>;
  stop: () => void;
}

const feeds = new Map<string, Feed>();

function openFeed(userId: string): Feed {
  const existing = feeds.get(userId);
  if (existing) return existing;

  const feed: Feed = { current: EMPTY, listeners: new Set(), stop: () => {} };
  feeds.set(userId, feed);
  let cancelled = false;

  const publish = (next: ReadonlyMap<string, string>) => {
    feed.current = next;
    for (const listener of feed.listeners) listener(next);
  };
  const apply = (targetUserId: string, hasNote: boolean, colorLabel: string) => {
    const prev = feed.current;
    const current = prev.get(targetUserId);
    if (!hasNote && current === undefined) return;
    if (hasNote && current === colorLabel) return;
    const next = new Map(prev);
    if (hasNote) next.set(targetUserId, colorLabel);
    else next.delete(targetUserId);
    publish(next);
  };
  const load = () =>
    playerNotesService
      .getNotedTargets(userId)
      .then((targets) => {
        if (!cancelled) publish(targets);
      })
      .catch((error) => {
        // A marker is decoration on the felt; a failed read leaves the seats
        // unmarked and is reported, never surfaced as a table error.
        if (!cancelled) reportError(error, 'usePlayerNoteMarkers.load');
      });
  void load();

  const unsubscribeService = playerNotesService.subscribe((change) => {
    if (cancelled || change.userId !== userId) return;
    apply(change.targetUserId, change.hasNote, change.colorLabel ?? 'none');
  });

  // Other devices: the player's own rows, over the shared socket. One channel
  // per player, subscribed once. INSERT and UPDATE only: Supabase applies RLS
  // to those two and not to DELETE, and the only way to filter deletes would
  // widen the replica identity until a deleted note's text was broadcast to
  // every subscriber. A note deleted elsewhere leaves the seat on the next
  // table open or socket rejoin instead (the re-read below).
  const channelKey = `player-notes:${userId}`;
  const admission = new AbortController();
  const channel = masterBus.getOrCreateChannel(channelKey);
  const onRow = (payload: { new?: unknown }) => {
    if (cancelled) return;
    const row = payload?.new as Record<string, unknown> | null | undefined;
    const target = row?.target_user_id;
    if (typeof target !== 'string' || !target) return;
    const color = typeof row?.color_label === 'string' ? (row.color_label as string) : 'none';
    apply(target, true, color);
  };
  const scope = { schema: 'public', table: 'player_notes', filter: `user_id=eq.${userId}` };
  channel.on('postgres_changes', { event: 'INSERT', ...scope }, onRow);
  channel.on('postgres_changes', { event: 'UPDATE', ...scope }, onRow);
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

  feed.stop = () => {
    cancelled = true;
    unsubscribeService();
    admission.abort();
    masterBus.removeRegisteredChannel(channelKey, channel);
    feeds.delete(userId);
  };
  return feed;
}

export function usePlayerNoteMarkers(
  userId: string | null | undefined
): ReadonlyMap<string, string> {
  const [noted, setNoted] = useState<ReadonlyMap<string, string>>(EMPTY);

  useEffect(() => {
    if (!userId || userId === 'guest') {
      setNoted(EMPTY);
      return;
    }
    const feed = openFeed(userId);
    const listener: Listener = (next) => setNoted(next);
    feed.listeners.add(listener);
    setNoted(feed.current);
    return () => {
      feed.listeners.delete(listener);
      // The last table off the screen closes the feed; the next one reopens it.
      if (feed.listeners.size === 0) feed.stop();
    };
  }, [userId]);

  return noted;
}

export default usePlayerNoteMarkers;
