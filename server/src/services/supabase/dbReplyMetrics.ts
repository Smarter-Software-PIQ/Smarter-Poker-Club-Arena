/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LOST DATABASE REPLIES, COUNTED WHERE AN ALARM CAN SEE THEM (2026-11-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * On 2026-11-05 at 12:21, 14:29 and 14:43 UTC the engine stopped getting
 * answers from PostgREST. fn_f06_retain_hand_continuation logged
 * `Hand Continuation Write Is Unproven [transport_error sqlstate=unknown]`,
 * and nine or ten tables froze each time before anybody noticed. The only
 * evidence was a log line per failed call, and a log line needs log access.
 *
 * Two counter families, both bounded, both present at zero from the first
 * scrape so a rule can tell "nothing lost" from "nothing reported":
 *
 *   poker_db_lost_replies_total{kind}
 *     Every HTTP attempt to Supabase, from any engine client, that ended
 *     without a database answer. Counted once per attempt in the shared fetch
 *     wrapper (client.ts), so every RPC and table read is covered, not just
 *     the hand-continuation path.
 *       deadline - our own client deadline or the caller's AbortSignal.timeout
 *                  fired first (the 8 s hand-continuation abort is this one)
 *       network  - the socket failed: reset, refused, DNS, body cut off
 *       gateway  - PostgREST or its proxy answered 502/503/504 instead of
 *                  the database (PGRST001-003 included)
 *     A caller that cancels on purpose is not counted; nor is a request this
 *     process refused to send.
 *
 *   poker_db_rpc_retries_total{rpc, outcome}
 *     The writes that retry a transient failure themselves (PR #9528).
 *       retry     - a transient failure was answered with another attempt
 *       recovered - a later attempt got the receipt
 *       exhausted - the last allowed attempt also failed transiently; the
 *                   table is about to stop dealing on this hand
 *
 * Module-level, like seatFirstPrecheckMetrics.ts: the counters belong to the
 * process. Read by DatabaseRepliesLost and DatabaseWriteRetriesExhausted in
 * infra/monitoring/alert-rules.yml (shipped after this engine build is live,
 * so the rules never read a series the running engine cannot produce).
 * Nothing here may throw into a request.
 */

export const DB_LOST_REPLY_KINDS = ['deadline', 'network', 'gateway'] as const;
export type DbLostReplyKind = (typeof DB_LOST_REPLY_KINDS)[number];

/** Closed list: a label value outside it is never emitted. */
export const DB_RETRYING_RPCS = ['fn_f06_retain_hand_continuation'] as const;
export type DbRetryingRpc = (typeof DB_RETRYING_RPCS)[number];

export const DB_RPC_RETRY_OUTCOMES = ['retry', 'recovered', 'exhausted'] as const;
export type DbRpcRetryOutcome = (typeof DB_RPC_RETRY_OUTCOMES)[number];

const lost = new Map<DbLostReplyKind, number>(DB_LOST_REPLY_KINDS.map((k) => [k, 0] as const));
const retries = new Map<string, number>();
function retryKey(rpc: DbRetryingRpc, outcome: DbRpcRetryOutcome): string {
  return `${rpc}|${outcome}`;
}
for (const rpc of DB_RETRYING_RPCS)
  for (const outcome of DB_RPC_RETRY_OUTCOMES) retries.set(retryKey(rpc, outcome), 0);

const NETWORK_CODE =
  /^(UND_ERR_|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN)/;

/**
 * Which kind of lost reply a thrown attempt was, or null when it was not one
 * (a deliberate cancellation, or a request this process refused to send).
 */
export function classifyLostReply(error: unknown): DbLostReplyKind | null {
  if (error instanceof Error && error.message === 'supabase_timeout') return 'deadline';
  const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  if (e && typeof e === 'object' && e.name === 'TimeoutError') return 'deadline';
  // undici: TypeError('fetch failed', { cause }) for a socket that failed,
  // TypeError('terminated') for a body cut off mid-stream.
  if (
    error instanceof TypeError &&
    (error.message === 'fetch failed' || error.message === 'terminated' || error.cause != null)
  )
    return 'network';
  const code = e && typeof e === 'object' ? (e.code ?? e.cause?.code) : undefined;
  if (typeof code === 'string' && NETWORK_CODE.test(code)) return 'network';
  return null;
}

/** Count one thrown attempt, if it was a lost reply. Never throws. */
export function recordDbAttemptFailure(error: unknown): void {
  try {
    const kind = classifyLostReply(error);
    if (kind) lost.set(kind, (lost.get(kind) ?? 0) + 1);
  } catch {
    /* counting must never disturb the request */
  }
}

/** Count one HTTP answer that came from the gateway instead of the database. */
export function recordDbResponseStatus(status: number): void {
  if (status === 502 || status === 503 || status === 504)
    lost.set('gateway', (lost.get('gateway') ?? 0) + 1);
}

export function recordDbRpcRetry(rpc: DbRetryingRpc, outcome: DbRpcRetryOutcome): void {
  const key = retryKey(rpc, outcome);
  if (!retries.has(key)) return;
  retries.set(key, (retries.get(key) ?? 0) + 1);
}

/** Running totals, for tests and anything that wants them without parsing text. */
export function dbReplyTotals(): {
  lost: Record<DbLostReplyKind, number>;
  retries: Record<DbRetryingRpc, Record<DbRpcRetryOutcome, number>>;
} {
  const l = {} as Record<DbLostReplyKind, number>;
  for (const k of DB_LOST_REPLY_KINDS) l[k] = lost.get(k) ?? 0;
  const r = {} as Record<DbRetryingRpc, Record<DbRpcRetryOutcome, number>>;
  for (const rpc of DB_RETRYING_RPCS) {
    r[rpc] = {} as Record<DbRpcRetryOutcome, number>;
    for (const o of DB_RPC_RETRY_OUTCOMES) r[rpc][o] = retries.get(retryKey(rpc, o)) ?? 0;
  }
  return { lost: l, retries: r };
}

/** Tests only: a fresh process has no history. */
export function resetDbReplyTotalsForTests(): void {
  for (const k of DB_LOST_REPLY_KINDS) lost.set(k, 0);
  for (const key of retries.keys()) retries.set(key, 0);
}

/** Prometheus exposition lines (always present, every series, even at zero). */
export function dbReplyPrometheusLines(): string[] {
  const lines = [
    '# HELP poker_db_lost_replies_total Engine HTTP attempts to Supabase that ended without a database answer (label: kind). deadline = a client or caller deadline fired first; network = the socket failed; gateway = PostgREST or its proxy answered 502/503/504',
    '# TYPE poker_db_lost_replies_total counter',
  ];
  for (const k of DB_LOST_REPLY_KINDS)
    lines.push(`poker_db_lost_replies_total{kind="${k}"} ${lost.get(k) ?? 0}`);
  lines.push(
    '# HELP poker_db_rpc_retries_total Self-retrying database writes (labels: rpc, outcome). retry = a transient failure was tried again; recovered = a later attempt got the receipt; exhausted = every allowed attempt failed transiently',
    '# TYPE poker_db_rpc_retries_total counter'
  );
  for (const rpc of DB_RETRYING_RPCS)
    for (const o of DB_RPC_RETRY_OUTCOMES)
      lines.push(
        `poker_db_rpc_retries_total{rpc="${rpc}",outcome="${o}"} ${retries.get(retryKey(rpc, o)) ?? 0}`
      );
  return lines;
}
