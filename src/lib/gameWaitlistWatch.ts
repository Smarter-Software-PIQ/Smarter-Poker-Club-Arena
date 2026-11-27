import { supabase } from './supabase';
import { isRealtimeLive, startRealtimeAwarePoll } from './realtimeAwarePoll';
import { reportError } from '../utils/errorReporter';

/**
 * LIVE (2026-11-07). Every change to a game's list sends one broadcast,
 * {game_id} only, on 'cash-game-waitlist' (trg_cash_game_waitlist_broadcast,
 * 20261107140215). A change to a game on the board re-reads the counts,
 * coalesced over 750 ms, so "Waitlist 2" becomes 3 as the name goes down.
 *
 * The poll stays as the net, on the shared rule (src/lib/realtimeAwarePoll.ts):
 * the old 20 s while the channel is not subscribed, a minute while it is, 20 s
 * again the moment it drops. A client with no realtime (a stub, an old SDK)
 * never reports SUBSCRIBED, so it keeps the poll alone at 20 s; the
 * subscription is a speed-up, never a dependency.
 *
 * `load` re-reads the counts; the caller has already read once. Returns the
 * stop function.
 */
export const GAME_WAITLIST_POLL_MS = 20_000;
export const GAME_WAITLIST_SAFETY_POLL_MS = 60_000;

export function watchGameWaitlistCounts(gameIds: readonly string[], load: () => void): () => void {
  const watched = new Set(gameIds);
  let stopped = false;
  let pending: number | null = null;
  const poll = startRealtimeAwarePoll(load, {
    fastMs: GAME_WAITLIST_POLL_MS,
    slowMs: GAME_WAITLIST_SAFETY_POLL_MS,
  });
  let channel: ReturnType<typeof supabase.channel> | null = null;
  try {
    if (typeof supabase.channel === 'function') {
      channel = supabase
        .channel('cash-game-waitlist')
        .on('broadcast', { event: 'changed' }, (message: { payload?: { game_id?: unknown } }) => {
          const gameId = message?.payload?.game_id;
          if (typeof gameId !== 'string' || !watched.has(gameId) || pending !== null) return;
          pending = window.setTimeout(() => {
            pending = null;
            load();
          }, 750);
        })
        .subscribe((status: string) => {
          if (stopped) return;
          const live = isRealtimeLive(status);
          /* Joining closes the gap: a change made before the join was heard
             by nobody, so read once now rather than a minute on. */
          if (live && !poll.isLive()) load();
          poll.setLive(live);
        });
    }
  } catch (e) {
    reportError(e, 'ClubHomePage.gameWaitlistChannel');
    channel = null;
  }
  return () => {
    stopped = true;
    poll.stop();
    if (pending !== null) window.clearTimeout(pending);
    if (channel) void supabase.removeChannel(channel);
  };
}
