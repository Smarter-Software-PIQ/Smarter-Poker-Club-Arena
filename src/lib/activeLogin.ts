/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE ACTIVE DEVICE PER ACCOUNT: a new login signs out every other device
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-01: "Every other poker app and site in the world kicks you out
 * of one device when you log into your account from another device...
 * regardless if its desktop, mobile or ipad, it needs to log out of all
 * previous sessions. You can have multiple desktop windows and login's open,
 * just not different devices."
 *
 * This is the CLIENT half: after a sign-in it tells the database "this login
 * is now the account's active one" through `ca_claim_active_login`, sending
 * the same per-install id the multi-account detector reads (deviceSighting).
 * The database does the enforcement: a claim from a NEW GoTrue session
 * deletes every other auth session for the account and raises the existing
 * ca_player_session_revocations event, so the engine closes the kicked
 * device's table sockets and the kicked client bounces to sign-in through
 * sessionRevoked.ts - the exact machinery the operator force logout uses.
 *
 * WHY IT CLAIMS ON INITIAL_SESSION TOO. On the web the login happens on the
 * World Hub's page, so by the time this SPA boots the session already exists
 * and supabase-js announces INITIAL_SESSION, never SIGNED_IN. A claim is
 * deduplicated per GoTrue session_id (localStorage, memory as fallback), so a
 * restored tab or a re-emitted SIGNED_IN on tab focus claims nothing new -
 * only a session this install has not claimed before reaches the database,
 * and the database itself treats a re-claim of the active session as a no-op.
 *
 * Never throws, never blocks rendering or login. A claim that cannot reach
 * the database is retried on the next auth event for that session.
 */
import { supabase } from './supabase';
import { getDeviceId } from './deviceSighting';
import { parseJwtPayload } from './authUtils';

export const CLAIMED_LOGIN_STORAGE_KEY = 'ca_claimed_login_session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let started = false;
let memoryClaimed: string | null = null;
let inFlight: string | null = null;

/** The GoTrue session id inside an access token, or null. */
export function sessionIdOf(token: string | null | undefined): string | null {
  if (!token) return null;
  const sid = parseJwtPayload(token)?.session_id;
  return typeof sid === 'string' && UUID_RE.test(sid.toLowerCase()) ? sid.toLowerCase() : null;
}

function alreadyClaimed(sid: string): boolean {
  if (memoryClaimed === sid) return true;
  try {
    return localStorage.getItem(CLAIMED_LOGIN_STORAGE_KEY) === sid;
  } catch {
    return false;
  }
}

function rememberClaimed(sid: string): void {
  memoryClaimed = sid;
  try {
    localStorage.setItem(CLAIMED_LOGIN_STORAGE_KEY, sid);
  } catch {
    /* private mode: memory carries it for the life of the tab */
  }
}

/**
 * Claim this login as the account's single active one. Deduplicated per
 * session id; a definitive database answer settles that session for good
 * (the database re-claim is a no-op anyway), a transport failure does not.
 */
export async function claimActiveLogin(token: string | null | undefined): Promise<void> {
  const sid = sessionIdOf(token);
  if (!sid || alreadyClaimed(sid) || inFlight === sid) return;
  inFlight = sid;
  try {
    const { error } = await supabase.rpc('ca_claim_active_login', {
      p_device_id: getDeviceId(),
    });
    if (!error) rememberClaimed(sid);
  } catch {
    /* unreachable database: the next auth event for this session retries */
  } finally {
    if (inFlight === sid) inFlight = null;
  }
}

/** Wire the claim to sign-in and session restore. Idempotent. */
export function startSingleActiveLogin(): void {
  if (started) return;
  started = true;
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
      const token = session?.access_token;
      // Avoid calling SDK methods inside the SDK's held auth-state lock.
      queueMicrotask(() => void claimActiveLogin(token));
    });
  } catch {
    /* auth unavailable: nothing to claim */
  }
}

/** Test seam. */
export function __resetActiveLoginForTests(): void {
  started = false;
  memoryClaimed = null;
  inFlight = null;
}
