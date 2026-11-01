import { DEFAULT_REQUEST_DEADLINE_MS, runWithRequestDeadline } from './requestDeadline';

export interface RosterReadRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  random?: () => number;
}

export type RosterConnectionState = 'connecting' | 'live' | 'reconnecting' | 'stale' | 'offline';

export class RosterReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Roster read timed out after ${timeoutMs}ms`);
    this.name = 'RosterReadTimeoutError';
  }
}

function abortError(): DOMException {
  return new DOMException('The roster request was superseded.', 'AbortError');
}

const TRANSIENT_SQLSTATE_CODES = new Set([
  '57014', // query_canceled / statement_timeout
  '55p03', // lock_not_available / lock_timeout
  '40001', // serialization_failure
  '40p01', // deadlock_detected
  '53300', // too_many_connections
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
]);

const NON_TRANSIENT_SQLSTATE_CODES = new Set([
  '42501', // insufficient_privilege
  '22023', // invalid_parameter_value
  '22p02', // invalid_text_representation
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
  'p0001', // raise_exception
]);

function errorDetails(error: unknown): {
  message: string;
  status: number | null;
  code: string;
  name: string;
} {
  if (!error || typeof error !== 'object') {
    return { message: String(error ?? ''), status: null, code: '', name: '' };
  }
  const value = error as { message?: unknown; status?: unknown; code?: unknown; name?: unknown };
  const rawStatus = Number(value.status ?? value.code);
  const status =
    Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null;
  return {
    message: typeof value.message === 'string' ? value.message.toLowerCase() : '',
    status,
    code: typeof value.code === 'string' ? value.code.trim().toLowerCase() : '',
    name: typeof value.name === 'string' ? value.name : '',
  };
}

export function isTransientRosterReadError(error: unknown): boolean {
  if (error instanceof RosterReadTimeoutError) return true;
  const { message, status, code, name } = errorDetails(error);
  if (name === 'AbortError') return false;
  if (code) {
    if (NON_TRANSIENT_SQLSTATE_CODES.has(code) || code.startsWith('pgrst')) return false;
    if (TRANSIENT_SQLSTATE_CODES.has(code)) return true;
  }
  if (status !== null) {
    if ([401, 403, 404, 409, 422].includes(status)) return false;
    if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  }
  return [
    'failed to fetch',
    'network',
    'timeout',
    'timed out',
    'canceling statement due to statement timeout',
    'socket',
    'econnrefused',
    'econnreset',
    'load failed',
  ].some((token) => message.includes(token));
}

export function isServerTerminatedRosterTimeout(error: unknown): boolean {
  const { message, code, name } = errorDetails(error);
  if (name === 'AbortError') return false;
  return (
    code === '57014' ||
    code === '55p03' ||
    message.includes('canceling statement due to statement timeout') ||
    message.includes('canceling statement due to lock timeout')
  );
}

export function computeRosterRetryDelay(
  retryIndex: number,
  baseDelayMs: number = 400,
  maxDelayMs: number = 4_000,
  random: () => number = Math.random
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, retryIndex));
  const jitter = 0.8 + Math.max(0, Math.min(1, random())) * 0.4;
  return Math.min(maxDelayMs, Math.round(exponential * jitter));
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs an idempotent roster read with a bounded per-attempt deadline and
 * abort-aware exponential jitter. Authentication, authorization and validation
 * failures are returned immediately; only transient transport failures retry.
 */
export async function runRosterReadWithRetry<T>(
  read: (signal: AbortSignal) => Promise<T>,
  options: RosterReadRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 400);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 4_000);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_REQUEST_DEADLINE_MS);
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await runWithRequestDeadline(read, {
        timeoutMs,
        signal: options.signal,
        timeoutError: (ms) => new RosterReadTimeoutError(ms),
        abortError,
      });
    } catch (error) {
      lastError = error;
      if (
        options.signal?.aborted ||
        !isTransientRosterReadError(error) ||
        attempt === attempts - 1
      ) {
        throw error;
      }
      await abortableDelay(
        computeRosterRetryDelay(attempt, baseDelayMs, maxDelayMs, random),
        options.signal
      );
    }
  }

  throw lastError;
}
