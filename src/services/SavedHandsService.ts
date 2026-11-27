/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SAVED HANDS SERVICE — Log a Club Arena hand into World Hub Personal Assistant
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bridges Club Arena's Previous Hands surfaces (HandDetailModal & HandHistoryPanel)
 * to World Hub's authenticated `/api/poker/saved-hands` endpoint so players can log
 * a hand without leaving the table and jump straight into Personal Assistant Review.
 *
 * On web, `/api/poker/saved-hands` is same-origin (`smarter.poker`).
 * On native Capacitor, `installHubFetchShim()` rewrites relative `/api/*` paths to
 * `https://smarter.poker/api/*`.
 */

import { getFreshAccessToken } from '../lib/authToken';

export const SAVED_HANDS_ENDPOINT = '/api/poker/saved-hands';
export const PERSONAL_ASSISTANT_REVIEW_PATH = '/hub/personal-assistant/review';
export const DEFAULT_SAVED_HANDS_TIMEOUT_MS = 15_000;

export const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAVED_ROW_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_RE.test(value.trim());
}

export function normalizeCanonicalUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return CANONICAL_UUID_RE.test(trimmed) ? trimmed : null;
}

export function normalizeSavedHandId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !SAVED_ROW_ID_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Canonical World Hub Personal Assistant review link for a saved hand row.
 */
export function buildPersonalAssistantReviewUrl(savedHandId: string): string {
  const canonicalId = normalizeSavedHandId(savedHandId);
  if (!canonicalId) {
    throw new Error('Invalid saved hand ID');
  }
  return `${PERSONAL_ASSISTANT_REVIEW_PATH}?hand=${encodeURIComponent(canonicalId)}`;
}

export interface SavedHandsRequestOptions {
  signal?: AbortSignal;
  accessToken?: string;
  timeoutMs?: number;
}

export type LogClubArenaHandErrorCode =
  | 'invalid_hand_id'
  | 'auth_required'
  | 'aborted'
  | 'timeout'
  | 'network_error'
  | 'malformed_receipt'
  | 'http_error';

export type LogClubArenaHandResult =
  | {
      ok: true;
      status: 'saved' | 'already_saved';
      savedHandId: string;
      alreadySaved: boolean;
    }
  | {
      ok: false;
      code: LogClubArenaHandErrorCode;
      httpStatus?: number;
      message: string;
      possiblyCommitted: boolean;
    };

export type FindSavedClubArenaHandResult = { found: true; savedHandId: string } | { found: false };

export class SavedHandsError extends Error {
  readonly code: LogClubArenaHandErrorCode;
  readonly httpStatus?: number;
  readonly possiblyCommitted: boolean;

  constructor(
    code: LogClubArenaHandErrorCode,
    message: string,
    options?: { httpStatus?: number; possiblyCommitted?: boolean }
  ) {
    super(message);
    this.name = 'SavedHandsError';
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.possiblyCommitted = options?.possiblyCommitted ?? false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractServerErrorMessage(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
  return null;
}

function extractSourceHandId(row: Record<string, unknown>): string | null {
  const candidates: unknown[] = [row.source_hand_id, row.sourceHandId];
  if (isPlainObject(row.hand_data)) {
    candidates.push(row.hand_data.sourceHandId, row.hand_data.source_hand_id);
  }
  for (const candidate of candidates) {
    const normalized = normalizeCanonicalUuid(candidate);
    if (normalized) return normalized;
  }
  return null;
}

interface CombinedRequestSignal {
  signal: AbortSignal;
  wasTimedOut: () => boolean;
  wasAbortedByCaller: () => boolean;
  cleanup: () => void;
}

function createRequestSignal(
  externalSignal?: AbortSignal,
  timeoutMs = DEFAULT_SAVED_HANDS_TIMEOUT_MS
): CombinedRequestSignal {
  const controller = new AbortController();
  let timedOut = false;
  let abortedByCaller = false;

  const onExternalAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortedByCaller = true;
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (
    !controller.signal.aborted &&
    typeof timeoutMs === 'number' &&
    timeoutMs > 0 &&
    Number.isFinite(timeoutMs)
  ) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    wasAbortedByCaller: () => abortedByCaller,
    cleanup: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

async function resolveBearerToken(
  explicitToken?: string,
  signal?: AbortSignal
): Promise<{ token: string | null; aborted: boolean }> {
  if (signal?.aborted) return { token: null, aborted: true };
  if (typeof explicitToken === 'string' && explicitToken.trim()) {
    return { token: explicitToken.trim(), aborted: false };
  }
  const fresh = await getFreshAccessToken();
  if (signal?.aborted) return { token: null, aborted: true };
  const trimmed = typeof fresh === 'string' ? fresh.trim() : '';
  return { token: trimmed || null, aborted: false };
}

/**
 * Persist a Club Arena hand into the player's World Hub Saved Hands library.
 *
 * Strictly validates both the outgoing canonical UUID and the server's JSON
 * receipt (`success === true` and non-empty canonical `hand.id`).
 */
export async function logClubArenaHand(
  handId: string,
  options: SavedHandsRequestOptions = {}
): Promise<LogClubArenaHandResult> {
  const canonicalHandId = normalizeCanonicalUuid(handId);
  if (!canonicalHandId) {
    return {
      ok: false,
      code: 'invalid_hand_id',
      message: 'Invalid Hand ID',
      possiblyCommitted: false,
    };
  }

  const { token, aborted } = await resolveBearerToken(options.accessToken, options.signal);
  if (aborted) {
    return {
      ok: false,
      code: 'aborted',
      message: 'Request Cancelled',
      possiblyCommitted: false,
    };
  }
  if (!token) {
    return {
      ok: false,
      code: 'auth_required',
      message: 'Sign In Required To Save Hand',
      possiblyCommitted: false,
    };
  }

  const reqSignal = createRequestSignal(options.signal, options.timeoutMs);
  let response: Response;
  try {
    response = await fetch(SAVED_HANDS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'club-arena',
        handId: canonicalHandId,
      }),
      signal: reqSignal.signal,
    });
  } catch {
    const timedOut = reqSignal.wasTimedOut();
    const callerAborted = reqSignal.wasAbortedByCaller();
    reqSignal.cleanup();
    if (timedOut) {
      return {
        ok: false,
        code: 'timeout',
        message: 'Save Request Timed Out',
        possiblyCommitted: true,
      };
    }
    if (callerAborted) {
      return {
        ok: false,
        code: 'aborted',
        message: 'Request Cancelled',
        possiblyCommitted: true,
      };
    }
    return {
      ok: false,
      code: 'network_error',
      message: 'Network Error Saving Hand',
      possiblyCommitted: true,
    };
  } finally {
    reqSignal.cleanup();
  }

  if (!response.ok) {
    let serverMessage: string | null = null;
    try {
      serverMessage = extractServerErrorMessage(await response.json());
    } catch {
      /* non-JSON error body */
    }
    const possiblyCommitted =
      response.status >= 500 || response.status === 408 || response.status === 429;
    return {
      ok: false,
      code: 'http_error',
      httpStatus: response.status,
      message: serverMessage || `Could Not Save Hand (${response.status})`,
      possiblyCommitted,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      code: 'malformed_receipt',
      httpStatus: response.status,
      message: 'Invalid Server Response',
      possiblyCommitted: true,
    };
  }

  if (!isPlainObject(payload) || payload.success !== true || !isPlainObject(payload.hand)) {
    return {
      ok: false,
      code: 'malformed_receipt',
      httpStatus: response.status,
      message: 'Invalid Save Receipt',
      possiblyCommitted: true,
    };
  }

  const savedHandId = normalizeSavedHandId(payload.hand.id);
  if (!savedHandId) {
    return {
      ok: false,
      code: 'malformed_receipt',
      httpStatus: response.status,
      message: 'Missing Saved Hand ID In Receipt',
      possiblyCommitted: true,
    };
  }

  const alreadySaved = response.status === 200 && payload.alreadySaved === true;
  return {
    ok: true,
    status: alreadySaved ? 'already_saved' : 'saved',
    savedHandId,
    alreadySaved,
  };
}

/**
 * Durable readback check before retrying an uncertain save.
 * Queries `GET /api/poker/saved-hands?sourceHandId=<handId>` and strictly
 * validates the returned receipt. Throws `SavedHandsError` if the readback
 * itself fails or returns a malformed payload.
 */
export async function findSavedClubArenaHand(
  handId: string,
  options: SavedHandsRequestOptions = {}
): Promise<FindSavedClubArenaHandResult> {
  const canonicalHandId = normalizeCanonicalUuid(handId);
  if (!canonicalHandId) {
    throw new SavedHandsError('invalid_hand_id', 'Invalid Hand ID');
  }

  const { token, aborted } = await resolveBearerToken(options.accessToken, options.signal);
  if (aborted) {
    throw new SavedHandsError('aborted', 'Request Cancelled');
  }
  if (!token) {
    throw new SavedHandsError('auth_required', 'Sign In Required To Verify Saved Hand');
  }

  const url = `${SAVED_HANDS_ENDPOINT}?sourceHandId=${encodeURIComponent(canonicalHandId)}`;
  const reqSignal = createRequestSignal(options.signal, options.timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: reqSignal.signal,
    });
  } catch {
    const timedOut = reqSignal.wasTimedOut();
    const callerAborted = reqSignal.wasAbortedByCaller();
    reqSignal.cleanup();
    if (timedOut) {
      throw new SavedHandsError('timeout', 'Verification Request Timed Out', {
        possiblyCommitted: true,
      });
    }
    if (callerAborted) {
      throw new SavedHandsError('aborted', 'Request Cancelled', { possiblyCommitted: true });
    }
    throw new SavedHandsError('network_error', 'Network Error Verifying Saved Hand', {
      possiblyCommitted: true,
    });
  } finally {
    reqSignal.cleanup();
  }

  if (!response.ok) {
    let serverMessage: string | null = null;
    try {
      serverMessage = extractServerErrorMessage(await response.json());
    } catch {
      /* non-JSON error body */
    }
    throw new SavedHandsError(
      'http_error',
      serverMessage || `Could Not Verify Saved Hand (${response.status})`,
      {
        httpStatus: response.status,
        possiblyCommitted: true,
      }
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SavedHandsError('malformed_receipt', 'Invalid Verification Response', {
      httpStatus: response.status,
      possiblyCommitted: true,
    });
  }

  if (!isPlainObject(payload) || payload.success !== true) {
    throw new SavedHandsError('malformed_receipt', 'Invalid Verification Receipt', {
      httpStatus: response.status,
      possiblyCommitted: true,
    });
  }

  if (Array.isArray(payload.hands)) {
    if (payload.hands.length === 0) {
      return { found: false };
    }
    const objects = payload.hands.filter(isPlainObject);
    if (objects.length !== payload.hands.length) {
      throw new SavedHandsError('malformed_receipt', 'Invalid Saved Hands List', {
        httpStatus: response.status,
        possiblyCommitted: true,
      });
    }

    const withSource = objects.filter((row) => extractSourceHandId(row) !== null);
    let matched: Record<string, unknown> | undefined;
    if (withSource.length > 0) {
      matched = withSource.find(
        (row) => extractSourceHandId(row)?.toLowerCase() === canonicalHandId.toLowerCase()
      );
      if (!matched) {
        return { found: false };
      }
    } else {
      matched = objects[0];
    }

    const savedHandId = normalizeSavedHandId(matched.id);
    if (!savedHandId) {
      throw new SavedHandsError('malformed_receipt', 'Missing Saved Hand ID In Readback', {
        httpStatus: response.status,
        possiblyCommitted: true,
      });
    }
    return { found: true, savedHandId };
  }

  if ('hand' in payload) {
    if (payload.hand === null) {
      return { found: false };
    }
    if (!isPlainObject(payload.hand)) {
      throw new SavedHandsError('malformed_receipt', 'Invalid Saved Hand Entry In Readback', {
        httpStatus: response.status,
        possiblyCommitted: true,
      });
    }
    const rowSource = extractSourceHandId(payload.hand);
    if (rowSource && rowSource.toLowerCase() !== canonicalHandId.toLowerCase()) {
      return { found: false };
    }
    const savedHandId = normalizeSavedHandId(payload.hand.id);
    if (!savedHandId) {
      throw new SavedHandsError('malformed_receipt', 'Missing Saved Hand ID In Readback', {
        httpStatus: response.status,
        possiblyCommitted: true,
      });
    }
    return { found: true, savedHandId };
  }

  if (payload.found === false) {
    return { found: false };
  }

  throw new SavedHandsError('malformed_receipt', 'Unexpected Verification Receipt Shape', {
    httpStatus: response.status,
    possiblyCommitted: true,
  });
}
