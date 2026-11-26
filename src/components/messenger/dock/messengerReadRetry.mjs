// A read receipt is idempotent on the server (fn_mark_messages_read_through
// inserts with ON CONFLICT DO NOTHING and only ever raises last_read_at), so a
// transient failure is retried quietly before anybody is told. Only a failure
// that survives every attempt reaches the player. A refusal (4xx) is final at
// once: retrying a 403 or a 400 cannot change the answer.
export const READ_RETRY_DELAYS_MS = Object.freeze([800, 2500]);

export function isRetryableReadFailure(error) {
  const status = Number(error?.status);
  if (!Number.isFinite(status) || status === 0) return true; // network or unreadable response
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Runs `attempt` until it succeeds, a non-retryable failure occurs, or the
 * retry budget is spent. `stillWanted()` is checked before every retry so a
 * receipt for a conversation the player has left is abandoned, not replayed.
 */
export async function persistReadWithRetry(
  attempt,
  {
    delays = READ_RETRY_DELAYS_MS,
    stillWanted = () => true,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}
) {
  let lastError;
  for (let index = 0; index <= delays.length; index++) {
    if (index > 0) {
      await wait(delays[index - 1]);
      if (!stillWanted()) return { ok: false, abandoned: true, error: lastError };
    }
    try {
      return { ok: true, value: await attempt(), attempts: index + 1 };
    } catch (error) {
      lastError = error;
      if (!isRetryableReadFailure(error)) break;
    }
  }
  return { ok: false, abandoned: false, error: lastError };
}

/**
 * The one sentence a player sees when a read receipt finally fails.
 */
export function readFailureMessage(error) {
  const status = Number(error?.status);
  if (!Number.isFinite(status) || status === 0 || status === 408)
    return 'Read Status Could Not Be Saved. Check Your Connection.';
  if (status === 401) return 'Your Session Has Expired. Sign In Again To Save Read Status.';
  if (status === 403) return 'You No Longer Have Access To This Conversation.';
  if (status === 404) return 'This Conversation Is No Longer Available.';
  if (status === 429) return 'Read Status Is Busy Right Now. It Will Save Shortly.';
  if (status >= 500)
    return 'Read Status Could Not Be Saved. The Server Is Not Responding, Please Try Again Shortly.';
  return 'Read Status Could Not Be Saved.';
}
