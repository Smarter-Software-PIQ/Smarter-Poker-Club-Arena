/**
 * A READ THE PAGE'S OWN NAVIGATION CANCELLED IS NOT A FAILURE (2026-11-27).
 *
 * When the document reloads or navigates away, the browser cancels every
 * fetch still in flight, and supabase-js hands the caller an ordinary error:
 * "TypeError: Failed to fetch" (Chrome), "Load failed" (Safari),
 * "NetworkError when attempting to fetch resource" (Firefox), or an
 * AbortError. React never unmounts on a reload, so a component's own
 * unmount/version guard cannot see it, and the catch block reports the
 * cancellation as an error. Post-deploy run 46063424139 failed on exactly
 * that: the Player Record reloaded while MemberAssignAgent was still reading,
 * and `[MemberAssignAgent.load] TypeError: Failed to fetch` was logged.
 *
 * This module records that the document is leaving (beforeunload, then
 * pagehide) so a loader can tell its own page's cancellation from a genuine
 * transport failure. Only a transport-shaped error that arrives while the
 * document is leaving is the page's own doing; every other failure, and every
 * error carrying a server code, is still reported as before.
 */

/** A beforeunload prompt can be cancelled; without a pagehide it lapses. */
const PROVISIONAL_MS = 10_000;

let leaving = false;
let provisionalTimer: ReturnType<typeof setTimeout> | null = null;

function clearProvisional(): void {
  if (provisionalTimer !== null) clearTimeout(provisionalTimer);
  provisionalTimer = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    leaving = true;
    clearProvisional();
    provisionalTimer = setTimeout(() => {
      provisionalTimer = null;
      leaving = false;
    }, PROVISIONAL_MS);
  });
  window.addEventListener('pagehide', () => {
    leaving = true;
    clearProvisional();
  });
  // A page restored from the back/forward cache is live again.
  window.addEventListener('pageshow', () => {
    leaving = false;
    clearProvisional();
  });
}

/** True while this document is reloading or navigating away. */
export function isDocumentLeaving(): boolean {
  return leaving;
}

/** A failure that never reached the server: no code, only the browser's transport text. */
export function isTransportFailure(error: unknown): boolean {
  try {
    if (!error || typeof error !== 'object') return false;
    const e = error as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof e.code === 'string' && e.code !== '' && e.code !== '20') return false;
    if (e.name === 'AbortError') return true;
    const message = typeof e.message === 'string' ? e.message : '';
    return /failed to fetch|load failed|networkerror when attempting|network connection was lost|fetch is aborted|signal is aborted|aborterror/i.test(
      message
    );
  } catch {
    return false;
  }
}

/** The read was cancelled by this page's own reload or navigation. */
export function wasCancelledByLeavingPage(error: unknown): boolean {
  return leaving && isTransportFailure(error);
}
