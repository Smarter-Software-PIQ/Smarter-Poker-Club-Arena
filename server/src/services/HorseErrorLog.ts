/**
 * THE HORSE ERROR LOG IS WRITTEN (2026-11-24).
 *
 * Every live switch change reads `public.horse_error_log` as a rollback
 * trigger (scripts/ops/shadow-read-report-lib.mjs: any row in the window is a
 * rollback reason; the switch handoffs check "horse_error_log 24h = 0"). The
 * table has never held a row: nothing in the engine wrote it. A Horse decision
 * that failed went to the engine log (reportError, console only, rotated
 * within hours), to an in-memory Prometheus counter and, at best, to a daily
 * fleet total in horse_brain_telemetry with no table, game, option or build.
 * On 2026-11-24 the fleet took 39 worker-fallback liveness actions
 * (phase15_worker_fallback_execution_fallback) while horse_error_log read 0,
 * so "0 errors" was a statement about an unwritten table, not about the Horses.
 *
 * This module is the one writer. The engine records here, at the place each
 * one happens:
 *   decision_fallback   a FAST decision was rejected (expired, refused,
 *                       capacity, shard failed, ...) and the seat took the
 *                       liveness action (ServerTableEngineTurns)
 *   action_corrected    the legalizer replaced or refused the Horse's chosen
 *                       action (illegal shove, controller rejection, capped
 *                       street, wager above the cap, feature authority
 *                       withdrawn, brain exception fallback)
 *   lightning_fallback  the same rejection on a Lightning turn (LightningHorse)
 *   worker_failed       a decision worker shard died (lane.ts), replaced alone
 *                       or process-fatal
 *
 * PUBLIC CONTEXT ONLY. A row carries the closed-set reason, table, hand number,
 * game, mode, street, the action the seat took instead, the options on for
 * that decision and the build. It never carries a card: no field is read from
 * a holding, and the error message and stack are passed through
 * redactCardTokens so a message that printed one cannot store it. The deciding
 * seat's own cards are not stored either (no rule allows it here).
 *
 * BOUNDED, NEVER IN THE WAY. Rows are coalesced per (type, reason, game, mode)
 * per minute: the first event of a quiet minute is written at once, so a new
 * episode is a row the moment it starts; the rest of that minute is one more
 * row carrying `occurrences`, written when the minute closes. A storm is a few
 * rows a minute, never one per decision. Recording never throws, never awaits
 * on the turn path, and a failed write is counted
 * (horse_error_log_write_exception_seen, a horse_brain_telemetry feature the
 * shadow-read report already classes as a safety exception) and logged, so a
 * dead writer can never again read as "0 errors".
 *
 * Until startHorseErrorLog() runs (engine boot, index.ts) rows are held in
 * memory (at most MAX_PENDING_ROWS) and sent on start; nothing is written from
 * a test that never starts it. GameServer's shutdown closes the open minutes
 * and waits a bounded time for the last writes (stopHorseErrorLog).
 */
import { supabase } from './supabase/client.js';
import { reportWarning } from './errorReporter.js';
import { resolveReleaseIdentity } from '../releaseIdentity.js';
import { noteFire } from '../engine/BrainTelemetry.js';
import { OPTION_SWITCH_PLAIN_NAMES } from '../engine/HorseOptionSwitch.js';

export const HORSE_ERROR_TYPES = [
  'decision_fallback',
  'action_corrected',
  'lightning_fallback',
  'worker_failed',
] as const;
export type HorseErrorType = (typeof HORSE_ERROR_TYPES)[number];

export interface HorseErrorEvent {
  type: HorseErrorType;
  /** A closed-set reason (fallback reason, refusal reason, legalizer reason). */
  reason: string;
  error?: unknown;
  horseId?: string | null;
  tableId?: string | null;
  handNumber?: number | null;
  variant?: string | null;
  mode?: 'cash' | 'tournament' | null;
  street?: string | null;
  /** The action the seat took instead (public: it is in the hand's action log). */
  action?: string | null;
  /** The registered options that were on for this decision. */
  optionsOn?: readonly string[];
  /** Small public extras (a shard index, a fatal flag). */
  extra?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface HorseErrorLogRow {
  horse_id: string | null;
  error_type: HorseErrorType;
  error_message: string | null;
  stack_trace: string | null;
  context: Record<string, unknown>;
}

export const HORSE_ERROR_LOG_WINDOW_MS = 60_000;
export const MAX_PENDING_ROWS = 500;
const WRITE_TIMEOUT_MS = 5_000;
export const HORSE_ERROR_LOG_STOP_BUDGET_MS = 5_000;
const MAX_MESSAGE = 500;
const MAX_STACK = 4_000;
const MAX_OPTIONS = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPTION_NAMES: ReadonlySet<string> = new Set(OPTION_SWITCH_PLAIN_NAMES);

/**
 * Card-shaped text out of free text: rank-suit tokens (As, Td, 10h, A♠), and
 * rank/suit fields of a serialized card object. Over-redacting a word such as
 * "As" costs nothing; storing a card is not allowed.
 */
export function redactCardTokens(text: string): string {
  return text
    .replace(/(^|[^A-Za-z0-9])(?:10|[2-9TJQKA])[shdc♠♥♦♣](?![A-Za-z0-9])/g, '$1[card]')
    .replace(/"(rank|suit)"\s*:\s*"[^"]*"/gi, '"$1":"[card]"');
}

/** The registered option names a decision's opts turn on, sorted. */
export function horseOptionsOn(opts: unknown): string[] {
  if (!opts || typeof opts !== 'object') return [];
  const out: string[] = [];
  for (const [name, value] of Object.entries(opts as Record<string, unknown>))
    if (value === true && OPTION_NAMES.has(name)) out.push(name);
  return out.sort().slice(0, MAX_OPTIONS);
}

function describe(error: unknown): { message: string | null; stack: string | null } {
  if (error === undefined) return { message: null, stack: null };
  let message: string;
  let stack: string | null = null;
  if (error instanceof Error) {
    message = error.message;
    stack = typeof error.stack === 'string' ? error.stack : null;
  } else if (typeof error === 'string') message = error;
  else {
    try {
      message = JSON.stringify(error) ?? String(error);
    } catch {
      message = Object.prototype.toString.call(error);
    }
  }
  return {
    message: redactCardTokens(message).slice(0, MAX_MESSAGE),
    stack: stack === null ? null : redactCardTokens(stack).slice(0, MAX_STACK),
  };
}

function buildOf(): string {
  const identity = resolveReleaseIdentity();
  return identity.releaseSha ?? identity.version;
}

function rowOf(
  ev: HorseErrorEvent,
  occurrences: number,
  firstAt: number,
  lastAt: number
): HorseErrorLogRow {
  const { message, stack } = describe(ev.error);
  return {
    horse_id: typeof ev.horseId === 'string' && UUID.test(ev.horseId) ? ev.horseId : null,
    error_type: ev.type,
    error_message: message,
    stack_trace: stack,
    context: {
      reason: ev.reason,
      table_id: ev.tableId ?? null,
      hand_number: Number.isFinite(ev.handNumber) ? ev.handNumber : null,
      variant: ev.variant ?? null,
      mode: ev.mode ?? null,
      street: ev.street ?? null,
      action: ev.action ?? null,
      options_on: ev.optionsOn ? [...ev.optionsOn].slice(0, MAX_OPTIONS) : [],
      build: buildOf(),
      occurrences,
      first_at: new Date(firstAt).toISOString(),
      last_at: new Date(lastAt).toISOString(),
      window_ms: HORSE_ERROR_LOG_WINDOW_MS,
      ...(ev.extra ?? {}),
    },
  };
}

interface OpenWindow {
  openedAt: number;
  held: number;
  firstHeldAt: number;
  lastHeldAt: number;
  last: HorseErrorEvent;
  timer: ReturnType<typeof setTimeout> | null;
}

const windows = new Map<string, OpenWindow>();
const pending: HorseErrorLogRow[] = [];
const inFlight = new Set<Promise<void>>();
let started = false;
let droppedBeforeStart = 0;

function send(row: HorseErrorLogRow): void {
  const write = (async () => {
    try {
      const { error } = await supabase
        .from('horse_error_log')
        .insert(row)
        .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS));
      if (error) throw error;
    } catch (error) {
      try {
        noteFire('horse_error_log_write_exception_seen');
        reportWarning(
          `horse_error_log row not written (${row.error_type}/${String(row.context.reason)}): ${describe(error).message}`,
          'HorseErrorLog.write_failed'
        );
      } catch {
        /* reporting a lost row never throws */
      }
    }
  })();
  inFlight.add(write);
  void write.finally(() => inFlight.delete(write));
}

function emit(row: HorseErrorLogRow): void {
  if (started) return send(row);
  if (pending.length < MAX_PENDING_ROWS) pending.push(row);
  else droppedBeforeStart++;
}

function closeWindow(key: string): void {
  const w = windows.get(key);
  if (!w) return;
  windows.delete(key);
  if (w.timer) clearTimeout(w.timer);
  if (w.held > 0) emit(rowOf(w.last, w.held, w.firstHeldAt, w.lastHeldAt));
}

/**
 * Record one Horse error. Synchronous, never throws, never awaits: safe in a
 * catch handler on the turn path.
 */
export function recordHorseError(ev: HorseErrorEvent, now: number = Date.now()): void {
  try {
    const key = `${ev.type}|${ev.reason}|${ev.variant ?? ''}|${ev.mode ?? ''}`;
    const open = windows.get(key);
    if (open && now - open.openedAt < HORSE_ERROR_LOG_WINDOW_MS) {
      if (open.held === 0) open.firstHeldAt = now;
      open.held++;
      open.lastHeldAt = now;
      open.last = ev;
      if (!open.timer) {
        // One deferred write of what this minute held: not a loop, it fires once.
        open.timer = setTimeout(
          () => closeWindow(key),
          Math.max(0, HORSE_ERROR_LOG_WINDOW_MS - (now - open.openedAt))
        );
        (open.timer as { unref?: () => void }).unref?.();
      }
      return;
    }
    if (open) closeWindow(key);
    windows.set(key, {
      openedAt: now,
      held: 0,
      firstHeldAt: now,
      lastHeldAt: now,
      last: ev,
      timer: null,
    });
    emit(rowOf(ev, 1, now, now));
  } catch {
    /* an error record must never become the error */
  }
}

/** Engine boot: send what was held and write every later row at once. */
export function startHorseErrorLog(): void {
  started = true;
  for (const row of pending.splice(0)) send(row);
  if (droppedBeforeStart > 0) {
    reportWarning(
      `${droppedBeforeStart} Horse error rows were dropped before the error log started`,
      'HorseErrorLog.dropped_before_start'
    );
    droppedBeforeStart = 0;
  }
}

/**
 * Shutdown: close every open minute (its held occurrences become a row) and
 * wait at most budgetMs for the writes in flight. Never rejects.
 */
export async function stopHorseErrorLog(
  budgetMs: number = HORSE_ERROR_LOG_STOP_BUDGET_MS
): Promise<void> {
  try {
    for (const key of [...windows.keys()]) closeWindow(key);
    if (inFlight.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
  } catch {
    /* shutdown evidence never holds a lease */
  }
}

/** Tests only: forget every window, pending row and the started flag. */
export function _resetHorseErrorLogForTests(): void {
  for (const w of windows.values()) if (w.timer) clearTimeout(w.timer);
  windows.clear();
  pending.length = 0;
  inFlight.clear();
  started = false;
  droppedBeforeStart = 0;
}
