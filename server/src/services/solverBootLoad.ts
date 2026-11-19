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
 * The first load therefore retries a failed attempt at once, a bounded
 * number of times. A failed read already took its own timeout, so no timer is
 * added. If every attempt fails, the worker keeps the loader's own answer, as
 * before, and lane.ts still refuses a genuinely divergent corpus.
 */

export interface SolverLoadOutcome {
  ok: boolean;
  count: number;
}

/** Three complete attempts; the slowest measured single load is 26 s, well
 * inside the restart certificate's 150 s candidate proof. */
export const SOLVER_BOOT_LOAD_ATTEMPTS = 3;

export async function loadSolverStoreForBoot(
  name: string,
  attempt: () => Promise<SolverLoadOutcome>,
  attempts: number = SOLVER_BOOT_LOAD_ATTEMPTS
): Promise<number> {
  for (let tried = 1; ; tried += 1) {
    let outcome: SolverLoadOutcome;
    try {
      outcome = await attempt();
    } catch (error) {
      if (tried >= attempts) throw error;
      console.warn(`[SolverBootLoad] ${name} attempt ${tried} of ${attempts} threw; retrying`);
      continue;
    }
    if (outcome.ok || tried >= attempts) return outcome.count;
    console.warn(
      `[SolverBootLoad] ${name} attempt ${tried} of ${attempts} did not complete; retrying`
    );
  }
}
