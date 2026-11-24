/** Deadline for the club workspace's authorization reads. */
export const CLUB_WORKSPACE_READ_TIMEOUT_MS = 10_000;

export async function withClubWorkspaceReadTimeout<T>(
  read: (signal: AbortSignal) => PromiseLike<T>,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLUB_WORKSPACE_READ_TIMEOUT_MS);
  const timedOut = () => {
    const timeoutError = new Error(`${label} timed out after ${CLUB_WORKSPACE_READ_TIMEOUT_MS}ms.`);
    timeoutError.name = 'TimeoutError';
    return timeoutError;
  };

  try {
    const result = await read(controller.signal);
    // supabase-js does not throw when its signal aborts: it RETURNS
    // { error: AbortError }. Name our own deadline here too, or it reaches the
    // error sink as an anonymous "signal is aborted without reason" that cannot
    // be told apart from an auth lock timeout (2026-11-24).
    if (controller.signal.aborted) throw timedOut();
    return result;
  } catch (readError) {
    if (controller.signal.aborted) throw timedOut();
    throw readError;
  } finally {
    clearTimeout(timer);
  }
}
