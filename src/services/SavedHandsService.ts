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
import { parseJwtPayload } from '../lib/authUtils';

export const SAVED_HANDS_ENDPOINT = '/api/poker/saved-hands';
export const PERSONAL_ASSISTANT_REVIEW_PATH = '/hub/personal-assistant/review';
export const SAVED_HANDS_BROADCAST_CHANNEL = 'smarter-poker-saved-hands';
export const DEFAULT_SAVED_HANDS_TIMEOUT_MS = 15_000;
export const MAX_SAVED_HANDS_BATCH_SIZE = 50;
export const MAX_SAVED_HANDS_BATCH_TOTAL = 250;

export const SAVED_HANDS_TAB_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `ca-${crypto.randomUUID()}`
    : `ca-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

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
  userId?: string | null;
}

export interface SavedHandBatchEntry {
  id: string;
  savedAt: string | null;
  status: string | null;
  reviewUrl: string;
}

export type SavedHandsBatchMap = Record<string, SavedHandBatchEntry>;

export interface SavedHandBroadcastMessage {
  type: 'saved-hand-updated';
  source: 'club-arena';
  handId: string;
  savedRowId: string;
  reviewUrl: string;
  tabId: string;
  at: number;
}

export interface CachedSavedHandEntry {
  savedHandId: string;
  status: 'saved' | 'already_saved';
  reviewUrl: string;
  savedAt?: string | null;
}

export type SavedHandCacheUpdateEvent =
  | {
      type: 'updated';
      userId: string;
      handId: string;
      entry: CachedSavedHandEntry;
    }
  | {
      type: 'deleted';
      userId: string | null;
      handId: string | null;
      savedHandId: string | null;
    };

type SavedHandUpdateListener = (event: SavedHandCacheUpdateEvent) => void;

let activeCacheUserId: string | null = null;
const savedHandCache = new Map<string, CachedSavedHandEntry>();
const savedHandUpdateListeners = new Set<SavedHandUpdateListener>();
let sharedBroadcastChannel: BroadcastChannel | null = null;

function notifySavedHandListeners(event: SavedHandCacheUpdateEvent): void {
  for (const listener of savedHandUpdateListeners) {
    try {
      listener(event);
    } catch {
      /* isolate subscriber failures */
    }
  }
}

function closeSharedBroadcastChannel(): void {
  if (!sharedBroadcastChannel) return;
  try {
    sharedBroadcastChannel.close();
  } catch {
    /* ignore close failures */
  } finally {
    sharedBroadcastChannel = null;
  }
}

function handleIncomingBroadcastMessage(rawData: unknown): void {
  if (!isPlainObject(rawData)) return;
  if (typeof rawData.tabId === 'string' && rawData.tabId === SAVED_HANDS_TAB_ID) {
    return;
  }

  const msgType = typeof rawData.type === 'string' ? rawData.type : '';
  const msgUserId = normalizeUserId(rawData.userId);

  if (msgUserId && activeCacheUserId && msgUserId !== activeCacheUserId) {
    return;
  }

  if (msgType === 'saved-hand-updated') {
    const sourceHandId =
      normalizeCanonicalUuid(rawData.sourceHandId) ?? normalizeCanonicalUuid(rawData.handId);
    const savedRowId =
      normalizeSavedHandId(rawData.savedRowId) ??
      normalizeSavedHandId(rawData.savedHandId) ??
      normalizeSavedHandId(rawData.id);
    const targetUserId = activeCacheUserId ?? msgUserId;
    if (!targetUserId || !sourceHandId || !savedRowId) return;

    const reviewUrl =
      typeof rawData.reviewUrl === 'string' &&
      rawData.reviewUrl.startsWith(`${PERSONAL_ASSISTANT_REVIEW_PATH}?`)
        ? rawData.reviewUrl
        : buildPersonalAssistantReviewUrl(savedRowId);
    const savedAt = typeof rawData.savedAt === 'string' ? rawData.savedAt : null;

    setCachedSavedHand(targetUserId, sourceHandId, {
      savedHandId: savedRowId,
      status: rawData.status === 'already_saved' ? 'already_saved' : 'saved',
      reviewUrl,
      savedAt,
    });
    return;
  }

  if (msgType === 'saved-hand-deleted') {
    const sourceHandId =
      normalizeCanonicalUuid(rawData.sourceHandId) ?? normalizeCanonicalUuid(rawData.handId);
    const savedRowId =
      normalizeSavedHandId(rawData.savedRowId) ??
      normalizeSavedHandId(rawData.savedHandId) ??
      normalizeSavedHandId(rawData.id);
    if (!sourceHandId && !savedRowId) return;

    const lowerSourceHandId = sourceHandId ? sourceHandId.toLowerCase() : null;
    const evicted: Array<{ userId: string; handId: string; savedHandId: string }> = [];

    for (const [cacheKey, entry] of Array.from(savedHandCache.entries())) {
      const sep = cacheKey.indexOf(':');
      if (sep <= 0) continue;
      const entryUserId = cacheKey.slice(0, sep);
      const entryHandId = cacheKey.slice(sep + 1);
      if (msgUserId && entryUserId !== msgUserId) continue;

      const matchesHand = lowerSourceHandId !== null && entryHandId === lowerSourceHandId;
      const matchesRow = savedRowId !== null && entry.savedHandId === savedRowId;
      if (matchesHand || matchesRow) {
        savedHandCache.delete(cacheKey);
        evicted.push({
          userId: entryUserId,
          handId: entryHandId,
          savedHandId: entry.savedHandId,
        });
      }
    }

    if (evicted.length > 0) {
      for (const item of evicted) {
        notifySavedHandListeners({
          type: 'deleted',
          userId: item.userId,
          handId: item.handId,
          savedHandId: item.savedHandId,
        });
      }
    } else {
      notifySavedHandListeners({
        type: 'deleted',
        userId: msgUserId ?? activeCacheUserId,
        handId: sourceHandId,
        savedHandId: savedRowId,
      });
    }
  }
}

/**
 * Lazily initialize the persistent singleton BroadcastChannel listener so
 * cross-tab saves and World Hub deletions propagate into Club Arena immediately.
 */
export function ensureSavedHandsBroadcastListener(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (sharedBroadcastChannel) return sharedBroadcastChannel;
  try {
    const channel = new BroadcastChannel(SAVED_HANDS_BROADCAST_CHANNEL);
    const onMessage = (event: MessageEvent) => {
      handleIncomingBroadcastMessage(event?.data);
    };
    if (typeof channel.addEventListener === 'function') {
      channel.addEventListener('message', onMessage);
    } else {
      channel.onmessage = onMessage;
    }
    sharedBroadcastChannel = channel;
    return channel;
  } catch {
    /* Safari / restricted browsing contexts may disallow BroadcastChannel */
    return null;
  }
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function makeCacheKey(userId: string, handId: string): string {
  return `${userId}:${handId.toLowerCase()}`;
}

function extractJwtSub(token: string): string | null {
  const payload = parseJwtPayload(token);
  return normalizeUserId(payload?.sub);
}

/**
 * Align the in-memory cache with the active authenticated account.
 * Clears all cached saved-hand entries immediately on any user switch.
 */
export function setActiveSavedHandsUser(userId: string | null | undefined): void {
  const normalized = normalizeUserId(userId);
  if (activeCacheUserId === normalized) return;
  savedHandCache.clear();
  activeCacheUserId = normalized;
}

/**
 * Clear the in-memory saved-hand cache (all entries, or only a specific user's entries).
 */
export function clearSavedHandsCache(userId?: string | null): void {
  const normalized = normalizeUserId(userId);
  if (!normalized) {
    savedHandCache.clear();
    activeCacheUserId = null;
    closeSharedBroadcastChannel();
    return;
  }
  const prefix = `${normalized}:`;
  for (const key of savedHandCache.keys()) {
    if (key.startsWith(prefix)) {
      savedHandCache.delete(key);
    }
  }
  if (activeCacheUserId === normalized) {
    activeCacheUserId = null;
  }
}

/**
 * Read a cached saved-hand entry for `(userId, handId)`.
 * Enforces strict per-user isolation and clears stale entries if the user changed.
 */
export function getCachedSavedHand(
  userId: string | null | undefined,
  handId: string | null | undefined
): CachedSavedHandEntry | null {
  const normalizedUser = normalizeUserId(userId);
  const normalizedHand = normalizeCanonicalUuid(handId);
  if (!normalizedUser || !normalizedHand) return null;
  if (activeCacheUserId !== null && activeCacheUserId !== normalizedUser) {
    savedHandCache.clear();
    activeCacheUserId = normalizedUser;
    return null;
  }
  return savedHandCache.get(makeCacheKey(normalizedUser, normalizedHand)) ?? null;
}

/**
 * Write a cached saved-hand entry for `(userId, handId)` and notify in-tab listeners.
 */
export function setCachedSavedHand(
  userId: string | null | undefined,
  handId: string | null | undefined,
  entry: Omit<CachedSavedHandEntry, 'reviewUrl'> & { reviewUrl?: string }
): void {
  const normalizedUser = normalizeUserId(userId);
  const normalizedHand = normalizeCanonicalUuid(handId);
  const normalizedSavedId = normalizeSavedHandId(entry.savedHandId);
  if (!normalizedUser || !normalizedHand || !normalizedSavedId) return;

  if (activeCacheUserId !== null && activeCacheUserId !== normalizedUser) {
    savedHandCache.clear();
  }
  activeCacheUserId = normalizedUser;

  const cacheKey = makeCacheKey(normalizedUser, normalizedHand);
  const existing = savedHandCache.get(cacheKey);
  const resolvedStatus: 'saved' | 'already_saved' =
    entry.status === 'already_saved' ||
    (existing?.savedHandId === normalizedSavedId && existing.status === 'already_saved')
      ? 'already_saved'
      : 'saved';

  const normalizedEntry: CachedSavedHandEntry = {
    savedHandId: normalizedSavedId,
    status: resolvedStatus,
    reviewUrl:
      typeof entry.reviewUrl === 'string' &&
      entry.reviewUrl.startsWith(`${PERSONAL_ASSISTANT_REVIEW_PATH}?`)
        ? entry.reviewUrl
        : buildPersonalAssistantReviewUrl(normalizedSavedId),
    savedAt: entry.savedAt ?? existing?.savedAt ?? null,
  };

  savedHandCache.set(cacheKey, normalizedEntry);

  notifySavedHandListeners({
    type: 'updated',
    userId: normalizedUser,
    handId: normalizedHand,
    entry: normalizedEntry,
  });
}

/**
 * Subscribe to in-tab and cross-tab saved-hand cache updates so HandDetailModal,
 * HandHistoryPanel, and the Table HUD stay instantaneously in sync.
 */
export function subscribeSavedHandsUpdates(listener: SavedHandUpdateListener): () => void {
  ensureSavedHandsBroadcastListener();
  savedHandUpdateListeners.add(listener);
  return () => {
    savedHandUpdateListeners.delete(listener);
  };
}

function broadcastSavedHandUpdate(handId: string, savedRowId: string, reviewUrl: string): void {
  const channel = ensureSavedHandsBroadcastListener();
  if (!channel) return;
  try {
    const message: SavedHandBroadcastMessage = {
      type: 'saved-hand-updated',
      source: 'club-arena',
      handId,
      savedRowId,
      reviewUrl,
      tabId: SAVED_HANDS_TAB_ID,
      at: Date.now(),
    };
    channel.postMessage(message);
  } catch {
    /* Safari / restricted browsing contexts may disallow BroadcastChannel */
  }
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
  const resolvedStatus = alreadySaved ? 'already_saved' : 'saved';
  const reviewUrl = buildPersonalAssistantReviewUrl(savedHandId);
  const resolvedUserId = normalizeUserId(options.userId) ?? extractJwtSub(token);

  if (!options.signal?.aborted) {
    if (resolvedUserId) {
      setCachedSavedHand(resolvedUserId, canonicalHandId, {
        savedHandId,
        status: resolvedStatus,
        reviewUrl,
      });
    }
    broadcastSavedHandUpdate(canonicalHandId, savedHandId, reviewUrl);
  }

  return {
    ok: true,
    status: resolvedStatus,
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
    if (!options.signal?.aborted) {
      const reviewUrl = buildPersonalAssistantReviewUrl(savedHandId);
      const resolvedUserId = normalizeUserId(options.userId) ?? extractJwtSub(token);
      if (resolvedUserId) {
        setCachedSavedHand(resolvedUserId, canonicalHandId, {
          savedHandId,
          status: 'already_saved',
          reviewUrl,
        });
      }
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
    if (!options.signal?.aborted) {
      const reviewUrl = buildPersonalAssistantReviewUrl(savedHandId);
      const resolvedUserId = normalizeUserId(options.userId) ?? extractJwtSub(token);
      if (resolvedUserId) {
        setCachedSavedHand(resolvedUserId, canonicalHandId, {
          savedHandId,
          status: 'already_saved',
          reviewUrl,
        });
      }
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

/**
 * Batch saved-status lookup for Club Arena hand history rows.
 *
 * Calls `GET /api/poker/saved-hands?source=club-arena&handIds=<csv up to 50 valid UUIDs>`
 * with the current Supabase Bearer token, caller abort signal, and request deadline.
 *
 * Always degrades fail-open: offline/network errors, timeouts, 401/5xx responses,
 * or malformed payloads return `{}` without blocking the history UI.
 */
export async function checkSavedHandsBatch(
  handIds: readonly (string | null | undefined)[],
  options: SavedHandsRequestOptions = {}
): Promise<SavedHandsBatchMap> {
  if (!Array.isArray(handIds) || handIds.length === 0) {
    return {};
  }

  // Filter to valid canonical UUIDs, deduplicate case-insensitively, cap safely at 250 total.
  const validIds: string[] = [];
  const requestedByLower = new Map<string, string>();
  for (const rawId of handIds) {
    const canonical = normalizeCanonicalUuid(rawId);
    if (!canonical) continue;
    const lower = canonical.toLowerCase();
    if (requestedByLower.has(lower)) continue;
    requestedByLower.set(lower, canonical);
    validIds.push(canonical);
    if (validIds.length >= MAX_SAVED_HANDS_BATCH_TOTAL) break;
  }

  if (validIds.length === 0) {
    return {};
  }

  const expectedUserId = normalizeUserId(options.userId);
  if (expectedUserId) {
    setActiveSavedHandsUser(expectedUserId);
  }

  let token: string | null = null;
  let aborted = false;
  try {
    const resolved = await resolveBearerToken(options.accessToken, options.signal);
    token = resolved.token;
    aborted = resolved.aborted;
  } catch {
    return {};
  }

  if (aborted || !token) {
    return {};
  }

  const tokenUserId = extractJwtSub(token);
  if (expectedUserId && tokenUserId && tokenUserId !== expectedUserId) {
    // Late or mismatched account token — degrade cleanly without crossing accounts.
    return {};
  }

  const resolvedUserId = expectedUserId ?? tokenUserId;
  if (resolvedUserId) {
    setActiveSavedHandsUser(resolvedUserId);
  }

  const result: SavedHandsBatchMap = {};

  for (let offset = 0; offset < validIds.length; offset += MAX_SAVED_HANDS_BATCH_SIZE) {
    if (options.signal?.aborted) {
      return result;
    }
    if (resolvedUserId && activeCacheUserId !== null && activeCacheUserId !== resolvedUserId) {
      return {};
    }

    const chunk = validIds.slice(offset, offset + MAX_SAVED_HANDS_BATCH_SIZE);
    const url = `${SAVED_HANDS_ENDPOINT}?source=club-arena&handIds=${chunk.join(',')}`;
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
      continue;
    } finally {
      reqSignal.cleanup();
    }

    if (options.signal?.aborted) {
      return result;
    }
    if (!response) {
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      return result;
    }
    if (!response.ok) {
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      continue;
    }

    if (
      options.signal?.aborted ||
      !isPlainObject(payload) ||
      payload.success !== true ||
      !isPlainObject(payload.savedByHandId)
    ) {
      continue;
    }

    // If the active account switched while this batch request was in flight,
    // discard the stale user's results so they cannot bleed into the new account.
    if (resolvedUserId && activeCacheUserId !== null && activeCacheUserId !== resolvedUserId) {
      return {};
    }

    for (const [rawHandId, rawEntry] of Object.entries(payload.savedByHandId)) {
      const canonicalKey = normalizeCanonicalUuid(rawHandId);
      if (!canonicalKey) continue;
      const requestedKey = requestedByLower.get(canonicalKey.toLowerCase());
      if (!requestedKey || !isPlainObject(rawEntry)) continue;

      const savedRowId = normalizeSavedHandId(rawEntry.id);
      if (!savedRowId) continue;

      const reviewUrl =
        typeof rawEntry.reviewUrl === 'string' &&
        rawEntry.reviewUrl.startsWith(`${PERSONAL_ASSISTANT_REVIEW_PATH}?`)
          ? rawEntry.reviewUrl
          : buildPersonalAssistantReviewUrl(savedRowId);
      const savedAt = typeof rawEntry.savedAt === 'string' ? rawEntry.savedAt : null;
      const status = typeof rawEntry.status === 'string' ? rawEntry.status : null;

      result[requestedKey] = {
        id: savedRowId,
        savedAt,
        status,
        reviewUrl,
      };

      if (resolvedUserId) {
        const existing = getCachedSavedHand(resolvedUserId, requestedKey);
        setCachedSavedHand(resolvedUserId, requestedKey, {
          savedHandId: savedRowId,
          status:
            existing?.savedHandId === savedRowId && existing.status === 'already_saved'
              ? 'already_saved'
              : 'saved',
          reviewUrl,
          savedAt,
        });
      }
    }
  }

  return result;
}
