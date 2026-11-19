export interface AdaptiveRefreshOutcome {
  ok: boolean;
}

/**
 * Boot-time retry schedule (2026-11-19). The first authoritative load of a
 * live decision worker used to be ONE attempt: a single transient
 * supabase_timeout left that worker on an empty corpus while its siblings
 * loaded the full one, and the lane's corpus-equality gate (correctly) failed
 * the whole engine boot. The boot load now retries inside its readiness
 * budget: 4 attempts, waits of ~1s, ~2s, ~4s (+/-25% jitter, at most ~8.75s
 * of added wait). The steady-state refresh cadence is unchanged.
 */
export const BOOT_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];
const BOOT_RETRY_JITTER = 0.25;

export interface BootRetryOptions {
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface AdaptiveRefreshLoopOptions<T extends AdaptiveRefreshOutcome> {
  load: () => Promise<T>;
  refreshMs: number;
  retryMs: number;
  maxRetryMs: number;
}

/**
 * Owns one non-overlapping refresh timer.
 *
 * Successful loads keep their slow normal cadence. A failed load switches the
 * same timer to bounded exponential retries until a complete load succeeds.
 * This is intentionally one interval rather than a chain of timeouts: callers
 * can stop it deterministically, and a slow request can never overlap itself.
 */
export function createAdaptiveRefreshLoop<T extends AdaptiveRefreshOutcome>({
  load,
  refreshMs,
  retryMs,
  maxRetryMs,
}: AdaptiveRefreshLoopOptions<T>): {
  runNow: () => Promise<T>;
  runBoot: (options?: BootRetryOptions) => Promise<T>;
  start: () => void;
  stop: () => void;
} {
  if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
    throw new Error('adaptive_refresh_invalid_refresh_ms');
  }
  if (!Number.isFinite(retryMs) || retryMs <= 0 || retryMs > refreshMs) {
    throw new Error('adaptive_refresh_invalid_retry_ms');
  }
  if (!Number.isFinite(maxRetryMs) || maxRetryMs < retryMs || maxRetryMs > refreshMs) {
    throw new Error('adaptive_refresh_invalid_max_retry_ms');
  }

  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<T> | null = null;
  let lastSuccessfulAt: number | null = null;
  let retryRequired = false;
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;

  const refreshIsDue = (): boolean => {
    const now = Date.now();
    if (now < nextAttemptAt) return false;
    return retryRequired || lastSuccessfulAt === null || now - lastSuccessfulAt >= refreshMs;
  };

  const markFailure = (): void => {
    retryRequired = true;
    consecutiveFailures += 1;
    const exponent = Math.min(consecutiveFailures - 1, 20);
    nextAttemptAt = Date.now() + Math.min(retryMs * 2 ** exponent, maxRetryMs);
  };

  const runNow = (): Promise<T> => {
    if (inFlight) return inFlight;

    const attempt: Promise<T> = Promise.resolve()
      .then(load)
      .then((outcome) => {
        if (outcome.ok) {
          lastSuccessfulAt = Date.now();
          retryRequired = false;
          consecutiveFailures = 0;
          nextAttemptAt = 0;
        } else {
          markFailure();
        }
        return outcome;
      })
      .catch((err) => {
        markFailure();
        throw err;
      })
      .finally(() => {
        if (inFlight === attempt) inFlight = null;
      });
    inFlight = attempt;
    return attempt;
  };

  /**
   * The first authoritative load: runNow, retried with short jittered backoff
   * until a complete load succeeds or the schedule is spent. Resolves with the
   * last outcome (ok:false when every attempt failed) and rethrows only if the
   * final attempt threw, so callers keep the exact runNow contract.
   */
  const runBoot = async ({
    delaysMs = BOOT_RETRY_DELAYS_MS,
    sleep = defaultSleep,
    random = Math.random,
  }: BootRetryOptions = {}): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      const last = attempt >= delaysMs.length;
      try {
        const outcome = await runNow();
        if (outcome.ok || last) return outcome;
      } catch (err) {
        if (last) throw err;
      }
      const base = delaysMs[attempt];
      const jitter = 1 - BOOT_RETRY_JITTER + random() * 2 * BOOT_RETRY_JITTER;
      await sleep(Math.max(0, Math.round(base * jitter)));
    }
  };

  const start = (): void => {
    if (timer) return;
    timer = setInterval(() => {
      if (!refreshIsDue() || inFlight) return;
      // Loaders report their own errors. This catch prevents a future loader
      // implementation from turning a timer callback into an unhandled reject.
      void runNow().catch(() => undefined);
    }, retryMs);
    timer.unref?.();
  };

  const stop = (): void => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  return { runNow, runBoot, start, stop };
}
