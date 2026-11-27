/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  useLogHandToAssistant — Safe state machine for Previous Hands -> Personal Assistant
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Keyed strictly by `(accountId, handId)` with:
 *   1. Double-click single-flight guard (synchronous ref + status check).
 *   2. Account-change guard (captures account before auth, before fetch, before
 *      state commit; aborts and clears cached state on any account switch).
 *   3. Stale hand selection guard (monotonic generation + active hand match; late
 *      responses for an older hand never bleed into the currently selected hand).
 *   4. Late authentication response guard (aborts cleanly without issuing POST if
 *      unmounted, hand/account changed, or resolved JWT `sub` belongs to another user).
 *   5. Uncertain-write reconciliation before retry (calls GET durable readback first
 *      after network/timeout/5xx/408/429/malformed 2xx failures; if already saved,
 *      transitions directly to `already_saved` without sending a duplicate POST).
 *   6. Strict malformed-receipt rejection (never fabricates success).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFreshAccessToken } from '../lib/authToken';
import { parseJwtPayload } from '../lib/authUtils';
import {
  buildPersonalAssistantReviewUrl,
  findSavedClubArenaHand,
  getCachedSavedHand,
  logClubArenaHand,
  normalizeCanonicalUuid,
  normalizeSavedHandId,
  setActiveSavedHandsUser,
  subscribeSavedHandsUpdates,
} from '../services/SavedHandsService';

export type LogHandStatus = 'idle' | 'saving' | 'saved' | 'already_saved' | 'error';

export interface LogHandEntryState {
  status: LogHandStatus;
  savedHandId: string | null;
  errorMessage: string | null;
  needsReconcile: boolean;
}

const IDLE_ENTRY: LogHandEntryState = {
  status: 'idle',
  savedHandId: null,
  errorMessage: null,
  needsReconcile: false,
};

export interface UseLogHandToAssistantOptions {
  handId: string | null | undefined;
  accountId: string | null | undefined;
  /** Optional pre-hydrated saved row ID (e.g. from batch lookup). */
  initialSavedHandId?: string | null;
  /** Optional initial status when `initialSavedHandId` is supplied; defaults to `'saved'`. */
  initialSavedStatus?: 'saved' | 'already_saved';
  /** Override token retrieval in tests; defaults to Club Arena canonical authToken helper. */
  getAccessToken?: () => Promise<string | null>;
  /** Override POST helper in tests; defaults to `logClubArenaHand`. */
  logHand?: typeof logClubArenaHand;
  /** Override GET readback helper in tests; defaults to `findSavedClubArenaHand`. */
  findSavedHand?: typeof findSavedClubArenaHand;
  /** Optional network timeout override in milliseconds. */
  timeoutMs?: number;
}

export interface UseLogHandToAssistantReturn extends LogHandEntryState {
  canLog: boolean;
  reviewUrl: string | null;
  logThisHand: () => Promise<void>;
  retry: () => Promise<void>;
}

function makeKey(accountId: string | null, handId: string | null): string | null {
  if (!accountId || !handId) return null;
  return `${accountId}::${handId.toLowerCase()}`;
}

export function useLogHandToAssistant({
  handId,
  accountId,
  initialSavedHandId = null,
  initialSavedStatus = 'saved',
  getAccessToken = getFreshAccessToken,
  logHand = logClubArenaHand,
  findSavedHand = findSavedClubArenaHand,
  timeoutMs,
}: UseLogHandToAssistantOptions): UseLogHandToAssistantReturn {
  const normalizedAccountId =
    typeof accountId === 'string' && accountId.trim().length > 0 ? accountId.trim() : null;
  const normalizedHandId = normalizeCanonicalUuid(handId);
  const normalizedInitialSavedId = normalizeSavedHandId(initialSavedHandId);
  const activeKey = makeKey(normalizedAccountId, normalizedHandId);

  const [entriesByKey, setEntriesByKey] = useState<Record<string, LogHandEntryState>>({});
  const entriesByKeyRef = useRef<Record<string, LogHandEntryState>>(entriesByKey);
  entriesByKeyRef.current = entriesByKey;

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const activeAccountRef = useRef<string | null>(normalizedAccountId);
  const activeHandRef = useRef<string | null>(normalizedHandId);
  const activeKeyRef = useRef<string | null>(activeKey);
  const prevAccountRef = useRef<string | null>(normalizedAccountId);
  const prevHandRef = useRef<string | null>(normalizedHandId);
  const initialSavedIdRef = useRef<string | null>(normalizedInitialSavedId);
  const initialSavedStatusRef = useRef<'saved' | 'already_saved'>(initialSavedStatus);

  const inFlightKeyRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const logHandRef = useRef(logHand);
  logHandRef.current = logHand;
  const findSavedHandRef = useRef(findSavedHand);
  findSavedHandRef.current = findSavedHand;
  const timeoutMsRef = useRef(timeoutMs);
  timeoutMsRef.current = timeoutMs;

  // Keep active identity refs synchronously up to date during render so any
  // microtask settling between render and effect sees the new identity immediately.
  activeAccountRef.current = normalizedAccountId;
  activeHandRef.current = normalizedHandId;
  activeKeyRef.current = activeKey;
  initialSavedIdRef.current = normalizedInitialSavedId;
  initialSavedStatusRef.current = initialSavedStatus;

  // Reset and abort on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      inFlightKeyRef.current = null;
    };
  }, []);

  // Keep same-tab surfaces (Table HUD, HandDetailModal, HandHistoryPanel) in sync
  // whenever any surface saves or hydrates a hand for the active account.
  useEffect(() => {
    return subscribeSavedHandsUpdates((event) => {
      if (!mountedRef.current) return;
      const currentAccount = activeAccountRef.current;
      if (!currentAccount || event.userId !== currentAccount) return;
      const key = makeKey(event.userId, event.handId);
      if (!key) return;
      setEntriesByKey((prev) => {
        const existing = prev[key];
        if (
          existing &&
          (existing.status === 'saved' || existing.status === 'already_saved') &&
          existing.savedHandId === event.entry.savedHandId &&
          existing.status === event.entry.status
        ) {
          return prev;
        }
        const next: Record<string, LogHandEntryState> = {
          ...prev,
          [key]: {
            status: event.entry.status,
            savedHandId: event.entry.savedHandId,
            errorMessage: null,
            needsReconcile: false,
          },
        };
        entriesByKeyRef.current = next;
        return next;
      });
    });
  }, []);

  // Account-change and hand-selection guards: bump generation, abort stale
  // in-flight operations, wipe cache on account change, and clear transient
  // saving state on hand change.
  useEffect(() => {
    const accountChanged = prevAccountRef.current !== normalizedAccountId;
    const handChanged = prevHandRef.current !== normalizedHandId;
    if (!accountChanged && !handChanged) return;

    const previousKey = makeKey(prevAccountRef.current, prevHandRef.current);
    prevAccountRef.current = normalizedAccountId;
    prevHandRef.current = normalizedHandId;

    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    inFlightKeyRef.current = null;

    if (accountChanged) {
      setActiveSavedHandsUser(normalizedAccountId);
      entriesByKeyRef.current = {};
      setEntriesByKey({});
      return;
    }

    if (handChanged && previousKey && entriesByKeyRef.current[previousKey]?.status === 'saving') {
      setEntriesByKey((prev) => {
        if (prev[previousKey]?.status !== 'saving') return prev;
        const next = { ...prev };
        delete next[previousKey];
        entriesByKeyRef.current = next;
        return next;
      });
    }
  }, [normalizedAccountId, normalizedHandId]);

  const setEntryForKey = useCallback((key: string, entry: LogHandEntryState) => {
    setEntriesByKey((prev) => {
      const next = { ...prev, [key]: entry };
      entriesByKeyRef.current = next;
      return next;
    });
  }, []);

  const execute = useCallback(
    async (isRetry: boolean) => {
      const capturedAccountId = activeAccountRef.current;
      const capturedHandId = activeHandRef.current;
      const capturedKey = activeKeyRef.current;
      if (!capturedAccountId || !capturedHandId || !capturedKey) return;

      // Double-click single-flight guard (synchronous before any await or state flush).
      if (inFlightKeyRef.current === capturedKey) return;

      const localEntry = entriesByKeyRef.current[capturedKey];
      const cached = getCachedSavedHand(capturedAccountId, capturedHandId);
      const hydratedEntry: LogHandEntryState | null = cached
        ? {
            status: cached.status,
            savedHandId: cached.savedHandId,
            errorMessage: null,
            needsReconcile: false,
          }
        : initialSavedIdRef.current
          ? {
              status: initialSavedStatusRef.current,
              savedHandId: initialSavedIdRef.current,
              errorMessage: null,
              needsReconcile: false,
            }
          : null;
      const currentEntry =
        localEntry && localEntry.status !== 'idle' ? localEntry : (hydratedEntry ?? IDLE_ENTRY);
      if (currentEntry.status === 'saving') return;
      if (
        !isRetry &&
        (currentEntry.status === 'saved' || currentEntry.status === 'already_saved')
      ) {
        return;
      }

      const capturedGeneration = generationRef.current;
      const shouldReconcileFirst = isRetry && currentEntry.needsReconcile;
      const controller = new AbortController();

      inFlightKeyRef.current = capturedKey;
      abortControllerRef.current = controller;

      setEntryForKey(capturedKey, {
        status: 'saving',
        savedHandId: null,
        errorMessage: null,
        needsReconcile: currentEntry.needsReconcile,
      });

      const isStillCurrent = () =>
        mountedRef.current &&
        !controller.signal.aborted &&
        generationRef.current === capturedGeneration &&
        activeAccountRef.current === capturedAccountId &&
        activeHandRef.current === capturedHandId &&
        activeKeyRef.current === capturedKey;

      try {
        // 1. Resolve authentication token and guard against late/mismatched auth responses.
        let token: string | null = null;
        try {
          token = await getAccessTokenRef.current();
        } catch {
          token = null;
        }

        if (!isStillCurrent()) return;

        const trimmedToken = typeof token === 'string' ? token.trim() : '';
        if (!trimmedToken) {
          setEntryForKey(capturedKey, {
            status: 'error',
            savedHandId: null,
            errorMessage: 'Sign In Required To Save Hand',
            needsReconcile: shouldReconcileFirst,
          });
          return;
        }

        // If the resolved token is a JWT with a `sub` claim, ensure it matches the
        // expected account captured before awaiting auth.
        const jwtPayload = parseJwtPayload(trimmedToken);
        const tokenSubject =
          typeof jwtPayload?.sub === 'string' && jwtPayload.sub.trim()
            ? jwtPayload.sub.trim()
            : null;
        if (tokenSubject && tokenSubject !== capturedAccountId) {
          // Different user's session resolved late — abort cleanly without issuing POST.
          setEntryForKey(capturedKey, IDLE_ENTRY);
          return;
        }

        // Re-verify account & hand right before network call.
        if (!isStillCurrent()) return;

        // 2. Uncertain write reconciliation: verify via durable GET readback before retrying POST.
        if (shouldReconcileFirst) {
          try {
            const readback = await findSavedHandRef.current(capturedHandId, {
              signal: controller.signal,
              accessToken: trimmedToken,
              timeoutMs: timeoutMsRef.current,
              userId: capturedAccountId,
            });

            if (!isStillCurrent()) return;

            if (readback.found) {
              setEntryForKey(capturedKey, {
                status: 'already_saved',
                savedHandId: readback.savedHandId,
                errorMessage: null,
                needsReconcile: false,
              });
              return;
            }
          } catch (err) {
            if (!isStillCurrent()) return;
            const message =
              err instanceof Error && err.message.trim()
                ? err.message.trim()
                : 'Could Not Verify Hand Status';
            setEntryForKey(capturedKey, {
              status: 'error',
              savedHandId: null,
              errorMessage: message,
              needsReconcile: true,
            });
            return;
          }
        }

        if (!isStillCurrent()) return;

        // 3. Persist the hand via POST /api/poker/saved-hands.
        const result = await logHandRef.current(capturedHandId, {
          signal: controller.signal,
          accessToken: trimmedToken,
          timeoutMs: timeoutMsRef.current,
          userId: capturedAccountId,
        });

        if (!isStillCurrent()) return;

        if (result.ok) {
          setEntryForKey(capturedKey, {
            status: result.status,
            savedHandId: result.savedHandId,
            errorMessage: null,
            needsReconcile: false,
          });
          return;
        }

        setEntryForKey(capturedKey, {
          status: 'error',
          savedHandId: null,
          errorMessage: result.message || 'Could Not Save Hand',
          needsReconcile: result.possiblyCommitted,
        });
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (inFlightKeyRef.current === capturedKey) {
          inFlightKeyRef.current = null;
        }
      }
    },
    [setEntryForKey]
  );

  const logThisHand = useCallback(() => execute(false), [execute]);
  const retry = useCallback(() => execute(true), [execute]);

  const localEntry = activeKey ? entriesByKey[activeKey] : undefined;
  const cachedEntry =
    activeKey && normalizedAccountId && normalizedHandId
      ? getCachedSavedHand(normalizedAccountId, normalizedHandId)
      : null;

  let activeEntry: LogHandEntryState = IDLE_ENTRY;
  if (localEntry && localEntry.status !== 'idle') {
    activeEntry = localEntry;
  } else if (cachedEntry) {
    activeEntry = {
      status: cachedEntry.status,
      savedHandId: cachedEntry.savedHandId,
      errorMessage: null,
      needsReconcile: false,
    };
  } else if (activeKey && normalizedInitialSavedId) {
    activeEntry = {
      status: initialSavedStatus,
      savedHandId: normalizedInitialSavedId,
      errorMessage: null,
      needsReconcile: false,
    };
  }

  const reviewUrl =
    (activeEntry.status === 'saved' || activeEntry.status === 'already_saved') &&
    activeEntry.savedHandId
      ? buildPersonalAssistantReviewUrl(activeEntry.savedHandId)
      : null;

  return {
    ...activeEntry,
    canLog: activeKey !== null,
    reviewUrl,
    logThisHand,
    retry,
  };
}
