/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PERSON IN THE ARENA HAS A HEARTBEAT (2026-10-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Online" has one definition (src/lib/profilePresence.ts): profiles.is_online
 * AND a last_seen heartbeat under five minutes old, answered by
 * fn_profile_presence. Horses keep that heartbeat from pg_cron (migration
 * 20261005174041). Until today only the World Hub's messenger wrote it for
 * people - Club Arena wrote neither column - so a person who used only the
 * arena read "offline" everywhere while a horse could read "online". That
 * difference alone told a person from a house player.
 *
 * So the signed-in player now beats through the same door the messenger
 * uses, fn_update_presence(own id, online), which stamps is_online and
 * last_seen together. This is the ONLY place in src that writes presence
 * (tests/presence-has-one-definition.law.test.ts); nothing writes
 * profiles.is_online directly, because a flag without a fresh last_seen is
 * exactly the stale-true row the one definition exists to ignore.
 */
import { supabase } from './supabase';
import { reportError } from '../utils/errorReporter';

/** How often a visible arena tab beats. Well inside the five-minute window. */
export const PRESENCE_HEARTBEAT_MS = 120_000;

/*
 * SIGN-OUT IS THE LAST BEAT (2026-10-05 audit). signalOffline runs while the
 * session still exists, and the signed-in tab keeps its interval until the
 * auth listener clears the user, which can be seconds later. A beat that fired
 * in that gap - or one already in flight that landed after the offline beat -
 * stamped the player online again, and they read online for five more minutes
 * after signing out. So signing out silences that account's beats until it
 * signs in again (resumePresence, called when the heartbeat starts for a
 * user), and the offline beat waits for any beat already sent.
 */
let silenced: string | null = null;
let inFlight: Promise<unknown> | null = null;

/** A heartbeat is starting for this user: a fresh sign-in may beat again. */
export function resumePresence(userId: string): void {
  if (silenced === userId) silenced = null;
}

/*
 * MESSENGER ACTIVE STATUS IS HONOURED HERE TOO (2026-11-11). The World Hub
 * Messenger "Active Status" toggle is saved per device under this
 * localStorage key, and the arena runs on the same smarter.poker origin. With
 * it off, the World Hub heartbeat beats offline, but this heartbeat kept
 * writing is_online = true every two minutes, so a person who chose to hide
 * read Online in Messenger again (and the send route then stamped their
 * messages as activity). While the toggle is off this device beats offline.
 */
export const ACTIVE_STATUS_KEY = 'messenger-active-status';

/** False only when this device turned Messenger Active Status off. */
export function activeStatusEnabled(
  storage: Pick<Storage, 'getItem'> | null | undefined = safeLocalStorage()
): boolean {
  try {
    return storage?.getItem(ACTIVE_STATUS_KEY) !== 'false';
  } catch {
    return true;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** One beat: the signed-in player is (or is no longer) here. */
export async function sendPresence(userId: string, online: boolean): Promise<void> {
  if (online && !activeStatusEnabled()) online = false;
  if (online && silenced === userId) return;
  /* Promise.resolve runs the request exactly once; the Supabase builder would
     send it again for every `then`, and the offline beat awaits this one. */
  const request = Promise.resolve(
    supabase.rpc('fn_update_presence', {
      p_user_id: userId,
      p_is_online: online,
    })
  );
  if (online) {
    inFlight = request;
    void request.then(
      () => {
        if (inFlight === request) inFlight = null;
      },
      () => {
        if (inFlight === request) inFlight = null;
      }
    );
  }
  const { error } = await request;
  if (error) throw error;
  if (online) stampTabLease(userId);
}

/**
 * Sign-out's last beat: online false, while the session still exists to send
 * it. Bounded, and it never blocks or fails a sign-out - if it does not land,
 * the heartbeat simply goes stale and the player reads offline within five
 * minutes anyway.
 */
export async function signalOffline(userId: string, timeoutMs = 2_000): Promise<void> {
  silenced = userId;
  const pending = inFlight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        if (pending) await pending.catch(() => undefined);
        await sendPresence(userId, false);
      })(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch (e) {
    reportError(e, 'presenceHeartbeat.signalOffline');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  LEAVING IS THE LAST BEAT TOO (Dan, 2026-11-12)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The one definition says online = the flag AND a heartbeat under five
 * minutes old. Nothing is written when a person simply closes the app, so
 * they read Online for up to five minutes after they left, and Player
 * Management's Active Now kept them in the "online watching" band that long.
 * Dan: "Online" should mean watching now.
 *
 * The definition is not narrowed (it is shared with the World Hub messenger
 * and the horses' cron heartbeat); instead the tab that leaves says so. On
 * pagehide, and on a native pause, the LAST visible tab of this account sends
 * one offline beat through the same door, as a keepalive fetch so it outlives
 * the document (the pattern GameServerAPI.sendAwayBeacon documents: a
 * keepalive fetch carries the Bearer header a beacon cannot). The next beat
 * (pageshow, visibility, native resume) marks them online again at once.
 *
 * "Last visible tab" is a lease: every beat stamps this tab's key in
 * localStorage, a leaving tab drops its own key, and it beats offline only
 * when no other tab of this account has stamped within the heartbeat window.
 * Several desktop windows are allowed (Dan, 2026-11); closing one of them
 * must not mark a player offline while another is open.
 */
const TAB_LEASE_PREFIX = 'presence-tab:';
/** A sibling tab is alive if it beat inside this window (one beat plus slack). */
const TAB_LEASE_FRESH_MS = PRESENCE_HEARTBEAT_MS + 30_000;
const tabId = Math.random().toString(36).slice(2, 10);

function leaseKey(userId: string, tab = tabId): string {
  return `${TAB_LEASE_PREFIX}${userId}:${tab}`;
}

/** This tab beat for the account just now. */
export function stampTabLease(userId: string, storage = safeLocalStorage(), now = Date.now()): void {
  try {
    storage?.setItem(leaseKey(userId), String(now));
  } catch {
    /* storage unavailable: the lease is a courtesy, the beat already landed */
  }
}

/** Drop this tab's lease and say whether another tab of the account is still fresh. */
export function releaseTabLease(
  userId: string,
  storage: Storage | null = safeLocalStorage(),
  now = Date.now()
): { othersAlive: boolean } {
  if (!storage) return { othersAlive: false };
  let othersAlive = false;
  try {
    storage.removeItem(leaseKey(userId));
    const prefix = `${TAB_LEASE_PREFIX}${userId}:`;
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const at = Number(storage.getItem(key));
      if (Number.isFinite(at) && now - at <= TAB_LEASE_FRESH_MS) othersAlive = true;
      else stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    /* unreadable storage: assume alone, the offline beat is the safe answer */
  }
  return { othersAlive };
}

function readAccessToken(storage = safeLocalStorage()): string | null {
  try {
    const raw = storage?.getItem('smarter-poker-auth');
    return raw ? ((JSON.parse(raw) as { access_token?: string })?.access_token ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * The leaving tab's offline beat. Synchronous by necessity (pagehide cannot
 * await): the request is handed to the browser's network stack with
 * keepalive and outlives the document. Nothing is sent when the account is
 * silenced (signed out), when another tab of the account is still beating,
 * or when the session or the Supabase origin cannot be read.
 */
export function signalLeave(userId: string, storage: Storage | null = safeLocalStorage()): boolean {
  if (!userId) return false;
  const { othersAlive } = releaseTabLease(userId, storage);
  if (othersAlive || silenced === userId) return false;
  const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;
  const token = readAccessToken(storage);
  if (!url || !key || !token || typeof fetch !== 'function') return false;
  try {
    void fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/fn_update_presence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ p_user_id: userId, p_is_online: false }),
      keepalive: true,
    }).catch(() => {
      /* the page is going away; the heartbeat goes stale within five minutes anyway */
    });
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget any sign-out and in-flight beat. */
export function resetPresenceHeartbeatForTests(): void {
  silenced = null;
  inFlight = null;
}
