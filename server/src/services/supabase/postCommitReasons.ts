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

/**
 * THE ANSWER CONTRACT THIS ENGINE SPEAKS (20261118073646).
 *
 * The envelope answers table_busy and obligation_lock_busy only to a request
 * that carries this header; any other caller (an older engine build, a SQL
 * caller) gets predecessor_pending in their place with the real reason in
 * `queued_reason`. Every call site that can receive the envelope's answer
 * sends it: processHandPostCommitObligations and the projection worker's
 * fn_project_hand_side_effects call (which calls the envelope inside the same
 * request).
 */
export const POST_COMMIT_CONTRACT_HEADER = 'x-ca-post-commit-contract';
export const POST_COMMIT_CONTRACT_VERSION = '2';

/** Sends the contract header on a PostgREST builder. */
export function speakPostCommitContract<T extends { setHeader(name: string, value: string): T }>(
  builder: T
): T {
  return builder.setHeader(POST_COMMIT_CONTRACT_HEADER, POST_COMMIT_CONTRACT_VERSION);
}

/**
 * The answer as this engine reads it: a contract-1 answer (the header was not
 * honoured) that names a queued_reason is read as that reason.
 */
export function readPostCommitAnswer<T extends { reason?: string; queued_reason?: string }>(
  answer: T
): T {
  if (
    answer?.reason === 'predecessor_pending' &&
    typeof answer.queued_reason === 'string' &&
    isQueuedPostCommitReason(answer.queued_reason)
  )
    return { ...answer, reason: answer.queued_reason };
  return answer;
}
