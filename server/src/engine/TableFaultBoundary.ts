/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TableFaultBoundary: one table's error is that table's, not the process's
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * server/src/index.ts sends every uncaughtException and unhandledRejection to
 * `fatal()`, which drains and exits the whole engine. That is right for an
 * error nobody can place (2026-08-15 note above `fatal`), and wrong for an
 * error that came out of one table's own work: one stray throw in one table's
 * timer, or one rejected promise in one table's hand pipeline, restarted every
 * table on the box and voided every hand in play.
 *
 * This module is the boundary between the two. Every per-table entry point
 * (the engine's own timers, the shared DeadlineScheduler's callbacks for that
 * table, and the engine's detached promises) runs through it, so an error that
 * starts there is attributed to that table and handed to the table's own sink.
 * The engine's sink is `ServerTableEngineBase.containTableFault`, which kills
 * only that generation through the existing `killForRestart` path; its owner
 * then rebuilds the table and crash recovery replays the in-flight hand from
 * its snapshot, exactly as for every other watchdog kill.
 *
 * Three rules:
 *
 *   1. ONLY EXPLICIT ATTRIBUTION. Nothing here guesses a table from async
 *      context. A lazily started process-wide timer inherits whatever context
 *      started it (see bindToProcessRoot in services/supabase/dataActorContext),
 *      so a context-derived guess could quietly blame one table for a broken
 *      shared resource and keep the process up on top of it. An error is a
 *      table's only when that table's own wrapper saw it.
 *
 *   2. CONTAINMENT THAT FAILS IS NOT CONTAINMENT. If a sink throws, the error is
 *      rethrown from the wrapper, where it reaches the process handlers
 *      unattributed and stays fatal.
 *
 *   3. UNATTRIBUTED STAYS FATAL. `routeProcessFault` contains only an error a
 *      table wrapper has already branded. Anything else still goes to fatal().
 */

/** The owner of one table's work: kills that table, and only that table. */
export interface TableFaultSink {
  readonly tableId: string;
  /** Must contain the fault (normally: fence and restart this table). */
  containTableFault(label: string, error: unknown): void;
}

interface Attribution {
  sink: TableFaultSink;
  label: string;
}

/* Error objects a table wrapper has seen. A promise chain derived from a
   contained table promise carries the same reason object, so if a derived
   chain is left unobserved its process-level rejection is still recognised as
   that table's (rule 3 in routeProcessFault). Primitives cannot be branded and
   are therefore always unattributed. */
const attributed = new WeakMap<object, Attribution>();

function brand(error: unknown, attribution: Attribution): void {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    if (!attributed.has(error as object)) attributed.set(error as object, attribution);
  }
}

/** The table a wrapper attributed this error to, if any. */
export function tableFaultAttribution(error: unknown): Readonly<Attribution> | undefined {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    return attributed.get(error as object);
  }
  return undefined;
}

/** Brand and hand to the sink. A sink that throws escapes (rule 2). */
export function containTableFault(sink: TableFaultSink, label: string, error: unknown): void {
  brand(error, { sink, label });
  sink.containTableFault(label, error);
}

/**
 * Wrap a per-table callback (timer, scheduler deadline, microtask) so a sync
 * throw or a rejection of a returned promise is contained to `sink`'s table.
 */
export function tableCallback<Args extends unknown[]>(
  sink: TableFaultSink,
  label: string,
  work: (...args: Args) => unknown
): (...args: Args) => void {
  return (...args: Args): void => {
    let result: unknown;
    try {
      result = work(...args);
    } catch (error) {
      containTableFault(sink, label, error);
      return;
    }
    if (result instanceof Promise) detachTableWork(sink, label, result);
  };
}

/**
 * Observe a promise that one table started and nobody awaits. A rejection is
 * contained to that table instead of becoming a process-wide
 * unhandledRejection. A sink that throws produces a new, unbranded rejection,
 * which the process handlers treat as fatal (rule 2).
 */
export function detachTableWork(
  sink: TableFaultSink,
  label: string,
  work: PromiseLike<unknown>
): void {
  // Only a native promise can raise an unhandledRejection. A lazy PromiseLike
  // (a PostgREST builder) starts its request when `.then` is consumed, which
  // `void builder` never did, so attaching to one would start work that the
  // replaced code never ran. Leave every other thenable exactly as `void` did.
  if (!(work instanceof Promise)) return;
  void work.catch((error: unknown) => {
    containTableFault(sink, label, error);
  });
}

// ─── Sinks keyed by tableId, for process-wide schedulers ───────────────────────

const sinks = new Map<string, TableFaultSink>();

/**
 * Publish the sink that owns `tableId`'s shared-scheduler callbacks. The
 * engine registers exactly while it holds process ownership of the table.
 * Returns an unregister function that only removes this exact sink.
 */
export function registerTableFaultSink(sink: TableFaultSink): () => void {
  sinks.set(sink.tableId, sink);
  return () => {
    if (sinks.get(sink.tableId) === sink) sinks.delete(sink.tableId);
  };
}

export function tableFaultSinkFor(tableId: string): TableFaultSink | undefined {
  return sinks.get(tableId);
}

/** Test seam. */
export function _resetTableFaultSinksForTests(): void {
  sinks.clear();
}

// ─── Process-level routing ─────────────────────────────────────────────────────

export type ProcessFaultKind = 'uncaughtException' | 'unhandledRejection';
export type FatalHandler = (error: unknown, kind: string) => void;

/**
 * Decide what a process-level fault does. Only an error a table wrapper has
 * already branded is contained (to that table, idempotently: its generation is
 * normally already fenced). Everything else, and any branded error whose
 * containment throws, goes to `fatal` exactly as before.
 */
export function routeProcessFault(
  error: unknown,
  kind: ProcessFaultKind,
  fatal: FatalHandler
): 'contained' | 'fatal' {
  const fatalKind =
    kind === 'uncaughtException'
      ? 'GameServer.Uncaught_exception'
      : 'GameServer.Unhandled_rejection';
  const attribution = tableFaultAttribution(error);
  if (!attribution) {
    fatal(error, fatalKind);
    return 'fatal';
  }
  try {
    attribution.sink.containTableFault(`${attribution.label}:escaped_${kind}`, error);
    return 'contained';
  } catch {
    fatal(error, fatalKind);
    return 'fatal';
  }
}

/** Install the two process handlers. index.ts is the only production caller. */
export function installProcessFaultHandlers(
  target: { on(event: ProcessFaultKind, listener: (error: unknown) => void): unknown },
  fatal: FatalHandler
): void {
  target.on('uncaughtException', (error) => {
    routeProcessFault(error, 'uncaughtException', fatal);
  });
  target.on('unhandledRejection', (error) => {
    routeProcessFault(error, 'unhandledRejection', fatal);
  });
}
