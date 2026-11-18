/**
 * THE ENVELOPE'S QUEUED ANSWERS (incident 075013fd, 2026-11-18).
 *
 * fn_ca_process_hand_post_commit_obligations answers each of these when the
 * hand cannot run yet and nothing was written: an earlier envelope of the
 * table is still open (predecessor_pending), another session holds the
 * table's mutex past its bounded wait (table_busy), or a row the envelope
 * needs is held past its bounded lock wait (obligation_lock_busy; the body
 * rolled back). A caller retries them; none is a failure.
 *
 * Dependency-free on purpose: the Lightning host classifies with it without
 * importing the database client.
 */
export const POST_COMMIT_QUEUED_REASONS: ReadonlySet<string> = new Set([
  'predecessor_pending',
  'table_busy',
  'obligation_lock_busy',
]);

export function isQueuedPostCommitReason(reason: string | undefined | null): boolean {
  return typeof reason === 'string' && POST_COMMIT_QUEUED_REASONS.has(reason);
}
