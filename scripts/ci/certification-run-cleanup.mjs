/**
 * A CERTIFICATION RUN RETIRES ITS FIXTURE ON EVERY EXIT (2026-11-20).
 *
 * The certification scripts (certify-club-create, certify-rabbit-hunt,
 * certify-heads-up-rematch) create real clubs through the normal create-club
 * path and retire them in a `finally`. A `finally` runs when the run throws.
 * It does NOT run when the process is killed: a cancelled or timed-out GitHub
 * Actions job sends SIGINT, then SIGTERM about 7.5 s later, then SIGKILL, and
 * Node's default action for the first two is to exit at once. The fixture then
 * stays lifecycle_status='active' and its welcome schedule keeps spawning
 * boards (Crest Cert 1794950026440-vqxq6, 2026-11-17 to 2026-11-20).
 *
 * This module gives each script one cleanup that runs exactly once, whichever
 * way the run ends:
 *
 *   const cleanup = cleanupOnce(async () => { ...the existing finally body... });
 *   const releaseSignals = retireOnSignal(cleanup);
 *   try { ...the run... } finally {
 *     try { await cleanup(); } finally { releaseSignals(); }
 *   }
 *
 * The handlers stay installed while the finally retires the fixture: a signal
 * that lands then joins the same cleanup (never a second one) and only exits
 * once it has finished.
 *
 * The cleanup itself is unchanged: it goes through the same guarded retirement
 * doors (fn_ca_retire_welcome_certification_club / the retirement coordinator,
 * settleRabbitHuntClub -> fn_retire_settled_club). Nothing here deletes a row.
 *
 * The database is the backstop for a run that is SIGKILLed before even this
 * can finish: a certification fixture's schedule materializes no occurrence
 * once the club is older than the 162-minute certification floor
 * (20261121000812_certification_fixture_schedule_spawns_only_during_its_run.sql).
 */

/** Exit status a shell reports for a process ended by each signal (128 + n). */
export const SIGNAL_EXIT_CODES = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });

/**
 * Wrap a cleanup so every caller shares ONE execution and ONE outcome. A
 * second call (the finally after a signal began it, or a second signal)
 * returns the same promise instead of retiring the fixture twice.
 */
export function cleanupOnce(cleanup) {
  if (typeof cleanup !== 'function') throw new TypeError('cleanupOnce needs a function.');
  let running = null;
  return () => {
    if (!running) running = Promise.resolve().then(() => cleanup());
    return running;
  };
}

/**
 * Run `cleanup` when the process is asked to stop, then exit with the signal's
 * status. Returns a function that removes the handlers; call it after the
 * normal path's cleanup has settled.
 */
export function retireOnSignal(
  cleanup,
  {
    signals = Object.keys(SIGNAL_EXIT_CODES),
    proc = process,
    exit = (code) => process.exit(code),
    log = (message) => console.error(message),
  } = {}
) {
  if (typeof cleanup !== 'function') throw new TypeError('retireOnSignal needs a cleanup.');
  let stopping = false;
  const handlers = new Map();
  for (const signal of signals) {
    const handler = () => {
      if (stopping) {
        // Already retiring the fixture. Staying alive for that is the point;
        // the runner's SIGKILL is the only thing that may end it sooner.
        log(`[certification-cleanup] ${signal} received while the fixture is being retired.`);
        return;
      }
      stopping = true;
      log(`[certification-cleanup] ${signal} received: retiring this run's fixture before exit.`);
      Promise.resolve()
        .then(() => cleanup())
        .then(
          () => log('[certification-cleanup] fixture cleanup finished after the signal.'),
          (error) =>
            log(
              `[certification-cleanup] fixture cleanup after the signal FAILED: ${error?.message || error}`
            )
        )
        .finally(() => exit(SIGNAL_EXIT_CODES[signal] ?? 1));
    };
    handlers.set(signal, handler);
    proc.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) proc.off(signal, handler);
    handlers.clear();
  };
}
