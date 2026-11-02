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
 * deletes every other auth session for the account - EXCEPT sessions whose
 * claims came from the same device address and platform, which the database
 * reads from the request itself, so every browser and window on one computer
 * stays signed in together (Dan, 2026-11-01) - and raises the existing
 * ca_player_session_revocations event, so the engine closes the kicked
 * device's table sockets and the kicked client bounces to sign-in through
 * sessionRevoked.ts - the exact machinery the operator force logout uses.
 *
 * WHY IT CLAIMS ON INITIAL_SESSION TOO. On the web the login happens on the
 * World Hub's page, so by the time this SPA boots the session already exists
 * and supabase-js announces INITIAL_SESSION, never SIGNED_IN. A NEW claim is
 * deduplicated per GoTrue session_id (localStorage, memory as fallback), so a
 * re-emitted SIGNED_IN on tab focus claims nothing new - and the database
 * treats a re-claim of the active session as a no-op anyway.
 *
 * WHY EVERY BOOT RE-VERIFIES (2026-11-01, second half). A device that is
 * OFFLINE when another device's login kicks it misses the realtime
 * revocation event, and its signature-valid JWT keeps every PostgREST read
 * working for days (the 2026-09-04 outage lesson), so on resume it LOOKS
 * signed in until it touches the engine. So INITIAL_SESSION always calls the
 * claim function, even for a session this install already claimed: the
 * database answers `same` in one cheap read when all is well, and
 * `session_gone` when the session was revoked while this device slept. On
 * `session_gone` the client hands the verdict to handleEngineAuthRejection,
 * which asks GoTrue directly (the one authority) and only then signs out -
 * with "Your Account Was Signed In On Another Device" when the database says
 * another login superseded this one.
 *
 * Never throws, never blocks rendering or login. A claim that cannot reach
 * the database is retried on the next auth event for that session, and a
 * network error never signs anyone out.
 */
import { supabase } from './supabase';
import { getDeviceId } from './deviceSighting';
import { parseJwtPayload } from './authUtils';

export const CLAIMED_LOGIN_STORAGE_KEY = 'ca_claimed_login_session';

/** The source handed to handleEngineAuthRejection by a dead resume whose
 * account was NOT taken over by another login (operator force logout, ban). */
export const RESUME_SESSION_GONE_SOURCE = 'resume:session_gone';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let started = false;
let memoryClaimed: string | null = null;
let inFlight: string | null = null;
const verifiedThisBoot = new Set<string>();
const bounced = new Set<string>();

interface ClaimAnswer {
  ok?: boolean;
  why?: string;
  superseded?: boolean;
}

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

/** A dead resumed session: let the revoked-session machinery decide. It asks
 * GoTrue directly and never signs anyone out on a network error. */
async function bounceDeadSession(sid: string, superseded: boolean): Promise<void> {
  if (bounced.has(sid)) return;
  bounced.add(sid);
  try {
    const { handleEngineAuthRejection, ANOTHER_DEVICE_SOURCE } = await import('./sessionRevoked');
    await handleEngineAuthRejection(
      superseded ? ANOTHER_DEVICE_SOURCE : RESUME_SESSION_GONE_SOURCE,
      true
    );
  } catch {
    /* the engine's own 4401 path remains the backstop */
  }
}

/**
 * Claim this login as the account's single active one. A NEW session claims
 * (and the database kicks the others); a session this install already claimed
 * claims again only when `verify` is set - the boot re-check that catches a
 * kick this device slept through. A definitive `session_gone` answer is
 * handed to the revoked-session machinery; a transport failure changes
 * nothing and the next auth event retries.
 */
export async function claimActiveLogin(
  token: string | null | undefined,
  verify = false
): Promise<void> {
  const sid = sessionIdOf(token);
  if (!sid || inFlight === sid || bounced.has(sid)) return;
  const isReclaim = alreadyClaimed(sid);
  if (isReclaim && (!verify || verifiedThisBoot.has(sid))) return;
  inFlight = sid;
  try {
    const { data, error } = await supabase.rpc('ca_claim_active_login', {
      p_device_id: getDeviceId(),
    });
    if (!error) {
      const answer = (data ?? {}) as ClaimAnswer;
      verifiedThisBoot.add(sid);
      if (answer.ok === false && answer.why === 'session_gone') {
        void bounceDeadSession(sid, answer.superseded === true);
      } else if (answer.ok !== false) {
        rememberClaimed(sid);
      }
    }
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
      const verify = event === 'INITIAL_SESSION';
      // Avoid calling SDK methods inside the SDK's held auth-state lock.
      queueMicrotask(() => void claimActiveLogin(token, verify));
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
  verifiedThisBoot.clear();
  bounced.clear();
}
