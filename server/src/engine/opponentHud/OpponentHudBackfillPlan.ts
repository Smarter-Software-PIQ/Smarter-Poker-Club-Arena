/**
 * OPPONENT HUD BACKFILL PLAN (2026-11-21, PLO-OWNER lane OPPONENT-HUD-FIX-1; AUDIT-C items 6 and 10; lead ruling
 * 18:38Z: history starts at the first PLO4/PLO5 hand). Pure: which rows scripts/opponent-hud-build.ts --apply may
 * write, decided from the ACTUAL retained hand_history rows, never from a retention assumption.
 *
 * - The backfill starts at the first PLO4/PLO5 hand hand_history holds (`firstRetainedMs`, read from the database).
 *   An --apply whose window starts later would store partial lifetimes over the stored rows: refused.
 * - A stored row with MORE hands than the rebuild holds hands the rebuild did not read (rows no longer retained, or
 *   hands the live engine counted after the rebuild's end): it is KEPT, always. There is no override: a rebuild can
 *   never wipe stored history (the old --force did, on the premise that hands with no person are purged after 7
 *   days; production keeps them, AUDIT-C item 10).
 */
export interface BackfillProfileLike {
  user: string;
  family: string;
  hands: number;
}

export interface BackfillPlan<P extends BackfillProfileLike> {
  ok: boolean;
  /** why nothing may be written (ok false) */
  refusal?: string;
  write: P[];
  kept: P[];
}

export function planOpponentHudBackfill<P extends BackfillProfileLike>(input: {
  profiles: Iterable<P>;
  /** stored hands per 'family|user' */
  storedHands: ReadonlyMap<string, number>;
  /** the window's start the rebuild read from */
  sinceMs: number;
  /** created_at of the first PLO4/PLO5 hand hand_history holds (null: none) */
  firstRetainedMs: number | null;
  /** an operator flag that asked to override (the removed --force): refused, never honoured */
  forceRequested?: boolean;
}): BackfillPlan<P> {
  const refuse = (refusal: string): BackfillPlan<P> => ({
    ok: false,
    refusal,
    write: [],
    kept: [],
  });
  if (input.forceRequested)
    return refuse(
      '--force is removed: a rebuild never replaces a stored row that holds more hands than it read (AUDIT-C item 10)'
    );
  if (!Number.isFinite(input.sinceMs)) return refuse('--since is not a time');
  if (input.firstRetainedMs !== null && input.sinceMs > input.firstRetainedMs)
    return refuse(
      `--since ${new Date(input.sinceMs).toISOString()} is after the first retained PLO4/PLO5 hand ` +
        `${new Date(input.firstRetainedMs).toISOString()}: the lifetime starts at hand one (omit --since)`
    );
  const write: P[] = [];
  const kept: P[] = [];
  for (const p of input.profiles) {
    const stored = input.storedHands.get(`${p.family}|${p.user}`);
    (stored !== undefined && stored > p.hands ? kept : write).push(p);
  }
  return { ok: true, write, kept };
}

/**
 * Default page size requested from fn_opponent_hud_hands_page over PostgREST.
 * Supabase PostgREST enforces a server-side max_rows cap of 1,000 AND an 8-second
 * statement_timeout (dry-run 45026021393 drained 2.20M hands at 1,000/page before
 * one heavy page crossed the 8s timeout). 500 keeps page DB time around 1-2s,
 * and transient timeouts adaptively halve down to HUD_BACKFILL_MIN_PAGE_LIMIT.
 */
export const HUD_BACKFILL_PAGE_LIMIT = 500;
export const HUD_BACKFILL_MIN_PAGE_LIMIT = 25;

export interface BackfillPageRow {
  id: string;
  created_at: string;
}

const TRANSIENT_BACKFILL_ERR_RE =
  /statement timeout|canceling statement|502|503|504|bad gateway|service unavailable|gateway timeout|fetch failed|econnreset|etimedout|socket hang up|temporarily unavailable|connection terminated/i;

export function isTransientBackfillError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return TRANSIENT_BACKFILL_ERR_RE.test(msg);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a single idempotent backfill RPC with bounded exponential backoff on
 * transient PostgREST / network / statement-timeout errors. Non-transient
 * errors fail closed immediately on attempt 1.
 */
export async function withTransientBackfillRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;
    retryBaseMs?: number;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (info: { attempt: number; delayMs: number; message: string }) => void;
  }
): Promise<T> {
  const maxRetries = Math.max(0, opts?.maxRetries ?? 4);
  const retryBaseMs = Math.max(0, opts?.retryBaseMs ?? 1000);
  const sleep = opts?.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isTransientBackfillError(err)) throw err;
      const delayMs = retryBaseMs * Math.pow(2, attempt);
      const message = err instanceof Error ? err.message : String(err);
      opts?.onRetry?.({ attempt: attempt + 1, delayMs, message });
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}

/**
 * Drains every keyset-paginated hand_history page in (since, until] until true EOF
 * (`rows.length === 0`), regardless of any server-side PostgREST max_rows cap.
 * On transient statement-timeout or 5xx/network errors, performs bounded retries
 * with exponential backoff while halving the page limit (down to
 * HUD_BACKFILL_MIN_PAGE_LIMIT) and recovering after 5 consecutive clean pages.
 * Fails closed immediately on non-transient errors, exhausted retries, or a
 * non-advancing (created_at, id) cursor.
 */
export async function pageAllOpponentHudHands<R extends BackfillPageRow>(input: {
  since: string;
  until: string;
  limit?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchPage: (cursor: {
    afterAt: string;
    afterId: string;
    until: string;
    limit: number;
  }) => Promise<readonly R[]>;
  onRow: (row: R) => void;
  onPage?: (info: {
    page: number;
    rows: number;
    limit: number;
    afterAt: string;
    afterId: string;
  }) => void;
  onRetry?: (info: {
    attempt: number;
    prevLimit: number;
    nextLimit: number;
    delayMs: number;
    afterAt: string;
    message: string;
  }) => void;
}): Promise<{ pages: number; rows: number; retries: number; afterAt: string; afterId: string }> {
  const baseLimit = Math.min(
    HUD_BACKFILL_PAGE_LIMIT,
    Math.max(1, input.limit ?? HUD_BACKFILL_PAGE_LIMIT)
  );
  const maxRetries = Math.max(0, input.maxRetries ?? 4);
  const retryBaseMs = Math.max(0, input.retryBaseMs ?? 1000);
  const sleep = input.sleep ?? defaultSleep;
  let pageLimit = baseLimit;
  let cleanStreak = 0;
  let afterAt = input.since;
  let afterId = '00000000-0000-0000-0000-000000000000';
  let pages = 0;
  let totalRows = 0;
  let retries = 0;
  for (;;) {
    let rows: readonly R[];
    for (let attempt = 0; ; attempt++) {
      try {
        rows = await input.fetchPage({ afterAt, afterId, until: input.until, limit: pageLimit });
        break;
      } catch (err) {
        if (attempt >= maxRetries || !isTransientBackfillError(err)) throw err;
        const prevLimit = pageLimit;
        const nextLimit = Math.max(
          Math.min(HUD_BACKFILL_MIN_PAGE_LIMIT, baseLimit),
          Math.floor(pageLimit / 2)
        );
        const delayMs = retryBaseMs * Math.pow(2, attempt);
        const message = err instanceof Error ? err.message : String(err);
        retries += 1;
        cleanStreak = 0;
        pageLimit = nextLimit;
        input.onRetry?.({
          attempt: attempt + 1,
          prevLimit,
          nextLimit,
          delayMs,
          afterAt,
          message,
        });
        if (delayMs > 0) await sleep(delayMs);
      }
    }
    if (rows.length === 0) break;
    const last = rows[rows.length - 1];
    const prevMs = Date.parse(afterAt);
    const lastMs = Date.parse(last.created_at);
    const movedBackwards = Number.isFinite(prevMs) && Number.isFinite(lastMs) && lastMs < prevMs;
    const stalled =
      (last.created_at === afterAt && last.id <= afterId) ||
      (pages > 0 && lastMs === prevMs && last.created_at === afterAt && last.id === afterId);
    if (movedBackwards || stalled) {
      throw new Error(
        `backfill cursor did not advance: prev=(${afterAt}, ${afterId}) last=(${last.created_at}, ${last.id})`
      );
    }
    for (const r of rows) input.onRow(r);
    afterAt = last.created_at;
    afterId = last.id;
    pages += 1;
    totalRows += rows.length;
    const usedLimit = pageLimit;
    if (pageLimit < baseLimit) {
      cleanStreak += 1;
      if (cleanStreak >= 5) {
        pageLimit = Math.min(baseLimit, pageLimit * 2);
        cleanStreak = 0;
      }
    }
    input.onPage?.({ page: pages, rows: rows.length, limit: usedLimit, afterAt, afterId });
  }
  return { pages, rows: totalRows, retries, afterAt, afterId };
}
