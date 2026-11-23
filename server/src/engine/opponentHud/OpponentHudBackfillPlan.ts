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
export const HUD_BACKFILL_ZERO_UUID = '00000000-0000-0000-0000-000000000000';
export const HUD_BACKFILL_MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
export const HUD_BACKFILL_DEFAULT_CONCURRENCY = 4;
export const HUD_BACKFILL_MAX_CONCURRENCY = 6;
export const HUD_BACKFILL_DEFAULT_WINDOW_HOURS = 4;

export interface BackfillPageRow {
  id: string;
  created_at: string;
}

export interface BackfillTimeWindow {
  index: number;
  afterAt: string;
  afterId: string;
  until: string;
}

/**
 * Partitions [since, until] into contiguous, non-overlapping keyset windows for
 * fn_opponent_hud_hands_page(p_after_at, p_after_id, p_until, p_limit):
 *  - Window 0 uses (since, ZERO_UUID) -> includes all rows with since <= created_at <= b_1.
 *  - Window k >= 1 uses (b_k, MAX_UUID) -> includes all rows with b_k < created_at <= b_{k+1}
 *    (even when created_at has microsecond precision at or just past b_k).
 * Every row in [since, until] belongs to exactly one window in strict chronological order.
 */
export function buildBackfillTimeWindows(
  since: string,
  until: string,
  windowMs: number
): BackfillTimeWindow[] {
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    throw new Error(`invalid backfill time range: since=${since} until=${until}`);
  }
  if (untilMs < sinceMs) return [];
  if (untilMs === sinceMs || !Number.isFinite(windowMs) || windowMs <= 0) {
    return [{ index: 0, afterAt: since, afterId: HUD_BACKFILL_ZERO_UUID, until }];
  }
  const stepMs = Math.max(1, Math.floor(windowMs));
  if (untilMs - sinceMs <= stepMs) {
    return [{ index: 0, afterAt: since, afterId: HUD_BACKFILL_ZERO_UUID, until }];
  }
  const windows: BackfillTimeWindow[] = [];
  let cursorMs = sinceMs;
  let index = 0;
  while (cursorMs < untilMs) {
    const nextMs = Math.min(untilMs, cursorMs + stepMs);
    windows.push({
      index,
      afterAt: index === 0 ? since : new Date(cursorMs).toISOString(),
      afterId: index === 0 ? HUD_BACKFILL_ZERO_UUID : HUD_BACKFILL_MAX_UUID,
      until: nextMs === untilMs ? until : new Date(nextMs).toISOString(),
    });
    cursorMs = nextMs;
    index += 1;
  }
  return windows;
}

/**
 * Shared DB-friendly pacer & adaptive concurrency gate across concurrent backfill
 * reader workers. Slow responses (> slowMs) or transient timeout/5xx errors double
 * the inter-page pause (capped at maxPauseMs) and step effective concurrency down
 * toward 1 until consecutive fast clean pages recover it back to maxConcurrency.
 */
export class SharedBackfillPacer {
  readonly maxConcurrency: number;
  readonly basePauseMs: number;
  readonly slowMs: number;
  readonly maxPauseMs: number;
  readonly recoverCleanPages: number;
  private effectiveConcurrency: number;
  private pauseMs: number;
  private cleanStreak = 0;
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(opts?: {
    maxConcurrency?: number;
    basePauseMs?: number;
    slowMs?: number;
    maxPauseMs?: number;
    recoverCleanPages?: number;
  }) {
    this.maxConcurrency = Math.min(
      HUD_BACKFILL_MAX_CONCURRENCY,
      Math.max(1, Math.floor(opts?.maxConcurrency ?? HUD_BACKFILL_DEFAULT_CONCURRENCY))
    );
    this.basePauseMs = Math.max(0, Math.floor(opts?.basePauseMs ?? 200));
    this.slowMs = Math.max(1, Math.floor(opts?.slowMs ?? 1000));
    this.maxPauseMs = Math.max(this.basePauseMs, Math.floor(opts?.maxPauseMs ?? 10_000));
    this.recoverCleanPages = Math.max(1, Math.floor(opts?.recoverCleanPages ?? 10));
    this.effectiveConcurrency = this.maxConcurrency;
    this.pauseMs = this.basePauseMs;
  }

  getEffectiveConcurrency(): number {
    return this.effectiveConcurrency;
  }

  getPauseMs(): number {
    return this.pauseMs;
  }

  getActive(): number {
    return this.active;
  }

  async acquireSlot(): Promise<void> {
    while (this.active >= this.effectiveConcurrency) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.active += 1;
  }

  releaseSlot(): void {
    if (this.active > 0) this.active -= 1;
    this.drainWaiters();
  }

  recordSuccess(elapsedMs: number): void {
    if (elapsedMs > this.slowMs) {
      this.pauseMs = Math.min(this.maxPauseMs, Math.max(this.pauseMs, 100) * 2);
      this.cleanStreak = 0;
      if (this.pauseMs >= 2000 && this.effectiveConcurrency > 1) {
        this.effectiveConcurrency -= 1;
      }
      return;
    }
    this.pauseMs = Math.max(this.basePauseMs, Math.floor(this.pauseMs / 2));
    if (this.effectiveConcurrency < this.maxConcurrency) {
      this.cleanStreak += 1;
      if (this.cleanStreak >= this.recoverCleanPages) {
        this.effectiveConcurrency += 1;
        this.cleanStreak = 0;
        this.drainWaiters();
      }
    }
  }

  recordTransientError(): void {
    this.pauseMs = Math.min(this.maxPauseMs, Math.max(this.pauseMs, 100) * 2);
    this.cleanStreak = 0;
    if (this.effectiveConcurrency > 1) {
      this.effectiveConcurrency -= 1;
    }
  }

  private drainWaiters(): void {
    while (this.active < this.effectiveConcurrency && this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
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
  initialAfterId?: string;
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
  let afterId = input.initialAfterId ?? HUD_BACKFILL_ZERO_UUID;
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

class BackfillAbortedError extends Error {
  constructor() {
    super('backfill aborted after sibling window failure');
  }
}

/**
 * Concurrent bounded-lookahead windowed reader over fn_opponent_hud_hands_page.
 * Partitions [since, until] into non-overlapping chronological time windows,
 * fetches up to `concurrency` windows in parallel through SharedBackfillPacer
 * (bounded lookahead = concurrency so memory stays strictly bounded), transforms
 * each row immediately via `mapRow`, and invokes `onItem` in EXACT chronological
 * window + (created_at, id) order — producing byte-for-byte identical profiles to
 * sequential single-stream execution while staying gentle on production Postgres.
 */
export async function pageAllOpponentHudHandsConcurrent<R extends BackfillPageRow, T = R>(input: {
  since: string;
  until: string;
  concurrency?: number;
  windowMs?: number;
  limit?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  pacer?: SharedBackfillPacer;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchPage: (cursor: {
    afterAt: string;
    afterId: string;
    until: string;
    limit: number;
  }) => Promise<readonly R[]>;
  mapRow?: (row: R) => T;
  onItem: (item: T) => void;
  onWindowComplete?: (info: {
    windowIndex: number;
    totalWindows: number;
    pages: number;
    rows: number;
    retries: number;
    until: string;
    afterAt: string;
    effectiveConcurrency: number;
    pauseMs: number;
  }) => void;
  onRetry?: (info: {
    windowIndex: number;
    attempt: number;
    prevLimit: number;
    nextLimit: number;
    delayMs: number;
    afterAt: string;
    message: string;
  }) => void;
}): Promise<{
  windows: number;
  pages: number;
  rows: number;
  retries: number;
  afterAt: string;
  afterId: string;
}> {
  const maxConcurrency = Math.min(
    HUD_BACKFILL_MAX_CONCURRENCY,
    Math.max(1, Math.floor(input.concurrency ?? HUD_BACKFILL_DEFAULT_CONCURRENCY))
  );
  const windowMs = input.windowMs ?? HUD_BACKFILL_DEFAULT_WINDOW_HOURS * 3600 * 1000;
  const pacer = input.pacer ?? new SharedBackfillPacer({ maxConcurrency });
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const mapRow = input.mapRow ?? ((r: R) => r as unknown as T);

  const windows = buildBackfillTimeWindows(input.since, input.until, windowMs);
  if (windows.length === 0) {
    return {
      windows: 0,
      pages: 0,
      rows: 0,
      retries: 0,
      afterAt: input.since,
      afterId: HUD_BACKFILL_ZERO_UUID,
    };
  }

  // Single-stream path (concurrency === 1 or 1 window): stream directly with zero buffering.
  if (maxConcurrency <= 1 || windows.length === 1) {
    const res = await pageAllOpponentHudHands<R>({
      since: input.since,
      until: input.until,
      limit: input.limit,
      maxRetries: input.maxRetries,
      retryBaseMs: input.retryBaseMs,
      sleep,
      fetchPage: async (cursor) => {
        const t0 = now();
        let rows: readonly R[];
        try {
          rows = await input.fetchPage(cursor);
        } catch (err) {
          if (isTransientBackfillError(err)) pacer.recordTransientError();
          throw err;
        }
        pacer.recordSuccess(now() - t0);
        if (rows.length > 0) {
          const pause = pacer.getPauseMs();
          if (pause > 0) await sleep(pause);
        }
        return rows;
      },
      onRow: (r) => input.onItem(mapRow(r)),
      onRetry: (info) => input.onRetry?.({ windowIndex: 0, ...info }),
    });
    input.onWindowComplete?.({
      windowIndex: 0,
      totalWindows: 1,
      pages: res.pages,
      rows: res.rows,
      retries: res.retries,
      until: input.until,
      afterAt: res.afterAt,
      effectiveConcurrency: pacer.getEffectiveConcurrency(),
      pauseMs: pacer.getPauseMs(),
    });
    return { windows: 1, ...res };
  }

  interface CompletedWindow {
    items: T[];
    pages: number;
    rows: number;
    retries: number;
    afterAt: string;
    afterId: string;
  }

  const maxLookahead = maxConcurrency;
  const completed = new Map<number, CompletedWindow>();
  let nextDispatch = 0;
  let nextCommit = 0;
  let totalPages = 0;
  let totalRows = 0;
  let totalRetries = 0;
  let lastAfterAt = input.since;
  let lastAfterId = HUD_BACKFILL_ZERO_UUID;
  let firstError: unknown = null;
  const lookaheadWaiters: (() => void)[] = [];

  const wakeLookahead = () => {
    while (lookaheadWaiters.length > 0) {
      const w = lookaheadWaiters.shift();
      w?.();
    }
  };

  const drainCompleted = () => {
    while (firstError === null && completed.has(nextCommit)) {
      const idx = nextCommit;
      const entry = completed.get(idx)!;
      completed.delete(idx);
      for (const item of entry.items) input.onItem(item);
      totalPages += entry.pages;
      totalRows += entry.rows;
      totalRetries += entry.retries;
      if (entry.rows > 0) {
        lastAfterAt = entry.afterAt;
        lastAfterId = entry.afterId;
      }
      nextCommit += 1;
      input.onWindowComplete?.({
        windowIndex: idx,
        totalWindows: windows.length,
        pages: entry.pages,
        rows: entry.rows,
        retries: entry.retries,
        until: windows[idx].until,
        afterAt: lastAfterAt,
        effectiveConcurrency: pacer.getEffectiveConcurrency(),
        pauseMs: pacer.getPauseMs(),
      });
      wakeLookahead();
    }
  };

  const workerCount = Math.min(maxConcurrency, windows.length);
  const runWorker = async () => {
    for (;;) {
      while (
        firstError === null &&
        nextDispatch < windows.length &&
        nextDispatch >= nextCommit + maxLookahead
      ) {
        await new Promise<void>((resolve) => {
          lookaheadWaiters.push(resolve);
        });
      }
      if (firstError !== null || nextDispatch >= windows.length) return;
      const win = windows[nextDispatch++];
      const items: T[] = [];
      try {
        const res = await pageAllOpponentHudHands<R>({
          since: win.afterAt,
          until: win.until,
          initialAfterId: win.afterId,
          limit: input.limit,
          maxRetries: input.maxRetries,
          retryBaseMs: input.retryBaseMs,
          sleep,
          fetchPage: async (cursor) => {
            if (firstError !== null) throw new BackfillAbortedError();
            await pacer.acquireSlot();
            let rows: readonly R[];
            try {
              if (firstError !== null) throw new BackfillAbortedError();
              const t0 = now();
              try {
                rows = await input.fetchPage(cursor);
              } catch (err) {
                if (isTransientBackfillError(err)) pacer.recordTransientError();
                throw err;
              }
              pacer.recordSuccess(now() - t0);
            } finally {
              pacer.releaseSlot();
            }
            if (firstError !== null) throw new BackfillAbortedError();
            if (rows.length > 0) {
              const pause = pacer.getPauseMs();
              if (pause > 0) await sleep(pause);
            }
            return rows;
          },
          onRow: (r) => {
            items.push(mapRow(r));
          },
          onRetry: (info) => input.onRetry?.({ windowIndex: win.index, ...info }),
        });
        if (firstError !== null) return;
        completed.set(win.index, {
          items,
          pages: res.pages,
          rows: res.rows,
          retries: res.retries,
          afterAt: res.afterAt,
          afterId: res.afterId,
        });
        drainCompleted();
      } catch (err) {
        if (err instanceof BackfillAbortedError) return;
        if (firstError === null) {
          firstError = err;
          completed.clear();
          wakeLookahead();
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  if (firstError !== null) throw firstError;
  return {
    windows: windows.length,
    pages: totalPages,
    rows: totalRows,
    retries: totalRetries,
    afterAt: lastAfterAt,
    afterId: lastAfterId,
  };
}
