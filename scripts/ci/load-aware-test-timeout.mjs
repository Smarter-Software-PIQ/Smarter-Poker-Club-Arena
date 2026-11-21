// LOAD-AWARE TEST HARNESS TIMEOUT (Horse SWITCH lane, 2026-11-20).
//
// WHY. On 2026-11-20 the PLO math-core pre-push gate failed three runs in a
// row, each on a DIFFERENT test that only scans files and never touched the
// branch: tests/law-registry.law.test.ts (64.4 s against the 30 s harness
// timeout), tests/a-revoke-from-anon-must-name-public.law.test.ts (48.3 s) and
// tests/unit/postDeployE2eHonestyLaw.test.ts (its own 20 s). The 1-minute load
// on the 28-core Mac was 23-53 with four gates admitted by the heavy-job queue.
// The checks were right; the harness clock was measuring the machine.
//
// WHAT. The rule HorseHoldemEliteOverhaul.test.ts applies to its benchmark
// limit, made shared and fitted to these tests: hosted CI (GITHUB_ACTIONS=true,
// its own VM) keeps the stated timeout exactly; anywhere else the timeout is
// multiplied by SLOPE x load per core, never below 1x and never above LOAD_CAP.
// The load is the larger of the 1- and 5-minute averages, because the config
// is read once when the run starts and the gates that follow raise it.
// SLOPE = 2.5 is measured, not chosen: these scans are disk-bound (fseventsd
// sat at ~180% CPU), so they stretch faster than the CPU load says. At load
// ~30 on 28 cores (1.07 per core) law-registry took 64.4 s, about 3x its idle
// time; 2.5 x 1.07 = 2.7x gives 80 s there. An idle machine (load under 0.4
// per core, about 11 here) keeps the stated number, so a hang still fails fast.
//
// WHAT IT NEVER DOES. It changes only how long the HARNESS waits before it
// kills a test. No assertion, product deadline, child-process deadline or
// benchmark limit is touched by it.
import { availableParallelism, cpus, loadavg } from 'node:os';

export const LOAD_CAP = 4;
export const SLOPE = 2.5;

function coreCount() {
  try {
    const n = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

/**
 * @param {number} baseMs the stated timeout
 * @param {{ env?: Record<string, string | undefined>, load?: number, cores?: number, cap?: number }} [opts]
 *   load: override the measured load (default max of the 1- and 5-minute averages)
 * @returns {number} milliseconds, an integer >= baseMs
 */
export function loadAwareTestTimeout(baseMs, opts = {}) {
  const env = opts.env ?? process.env;
  if (!Number.isFinite(baseMs) || baseMs <= 0) throw new RangeError(`baseMs must be a positive number, got ${baseMs}`);
  if (env.GITHUB_ACTIONS === 'true') return Math.round(baseMs);
  const [l1, l5] = loadavg();
  const load = opts.load ?? Math.max(l1, l5);
  const cores = opts.cores ?? coreCount();
  const cap = opts.cap ?? LOAD_CAP;
  const perCore = cores > 0 && Number.isFinite(load) && load > 0 ? load / cores : 0;
  const factor = Math.min(cap, Math.max(1, SLOPE * perCore));
  return Math.round(baseMs * factor);
}
