/**
 * A SOLVER STORE IS LOADED COMPLETELY BEFORE A WORKER SAYS READY (2026-11-19).
 *
 * Each live Horse decision worker loads the solver stores on boot, and the
 * lane refuses readiness when two workers report different corpora
 * (lane.ts awaitAllReady). The loaders answer a failed read with
 * `{ ok: false, count: 0 }` and keep the last good store, which is right for a
 * periodic refresh but wrong for the first load: a worker whose one boot read
 * timed out reported 0 cells beside seven workers with 7,747, and the whole
 * engine refused to start. Measured on 2026-11-19 at 14:17 UTC: certified
 * candidate 7add8b42c83b was swapped in, worker 2's `gto_postflop` read hit
 * `supabase_timeout`, the lane failed "worker 2 loaded a different solver
 * corpus than worker 0", and the cutover was rolled back.
 *
 * The first load therefore retries a failed attempt a bounded number of times
 * and refuses with a named error if it never completes. It never reports a
 * partial or empty store as loaded, and it changes nothing about refreshes.
 */

export interface SolverLoadOutcome {
  ok: boolean;
  count: number;
}

/** Three complete attempts with 1.5 s and 3 s between them fit well inside
 * the restart certificate's 150 s candidate proof even at the slowest
 * measured single load (26 s). */
export const SOLVER_BOOT_LOAD_ATTEMPTS = 3;
export const SOLVER_BOOT_LOAD_RETRY_MS = 1_500;

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

export async function loadSolverStoreForBoot(
  name: string,
  attempt: () => Promise<SolverLoadOutcome>,
  attempts: number = SOLVER_BOOT_LOAD_ATTEMPTS,
  retryMs: number = SOLVER_BOOT_LOAD_RETRY_MS,
  wait: (ms: number) => Promise<void> = pause
): Promise<number> {
  let lastError: unknown = null;
  for (let tried = 1; ; tried += 1) {
    try {
      const outcome = await attempt();
      if (outcome.ok) return outcome.count;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    if (tried >= attempts) {
      const cause = lastError instanceof Error ? `: ${lastError.message}` : '';
      throw new Error(`${name}_boot_load_incomplete_after_${attempts}_attempts${cause}`);
    }
    console.warn(
      `[SolverBootLoad] ${name} attempt ${tried} of ${attempts} did not complete; retrying`
    );
    await wait(retryMs * tried);
  }
}
