/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LOG THIS HAND CONTROL — Previous Hands -> Log This Hand -> Review My Play
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Lets a seated player save a completed Club Arena hand to World Hub Personal
 * Assistant without leaving the table, and open the review in a new tab.
 */

import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { IS_NATIVE_BUILD, isNativePlatform } from '../../lib/appBase';
import { openInBrowser } from '../../lib/openExternal';
import { useLogHandToAssistant } from '../../hooks/useLogHandToAssistant';
import { isCanonicalUuid } from '../../services/SavedHandsService';
import './LogThisHandControl.css';

export type LogThisHandVariant = 'default' | 'compact' | 'hud';

export interface LogThisHandControlProps {
  handId: string | null | undefined;
  accountId: string | null | undefined;
  compact?: boolean;
  variant?: LogThisHandVariant;
  /** Optional pre-hydrated saved row ID (e.g. from batch saved-status lookup). */
  initialSavedHandId?: string | null;
  /**
   * Register the Shift+L hotkey trigger with the table's central keyboard hook
   * (`useTableKeyboard`), keeping one keyboard owner across multi-table instances.
   */
  registerHotkey?: (handler: (() => void) | null) => void;
  /**
   * Enable a standalone desktop `Shift+L` listener when mounted outside
   * `useTableKeyboard`. Ignored whenever `registerHotkey` is supplied; defaults
   * to `true` for `variant="hud"` without `registerHotkey`.
   */
  enableShortcut?: boolean;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as HTMLElement;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (typeof el.getAttribute === 'function') {
    const attr = el.getAttribute('contenteditable');
    if (attr === '' || attr === 'true') return true;
  }
  if (
    typeof el.closest === 'function' &&
    el.closest('[contenteditable="true"], [contenteditable=""]')
  ) {
    return true;
  }
  return false;
}

function BookmarkIcon() {
  return (
    <svg
      className="lth__icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.5h8a.5.5 0 0 1 .5.5v10.5L8 10.6 3.5 13.5V3a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}

function BookmarkCheckIcon() {
  return (
    <svg
      className="lth__icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

export default function LogThisHandControl({
  handId,
  accountId,
  compact = false,
  variant,
  initialSavedHandId = null,
  registerHotkey,
  enableShortcut,
}: LogThisHandControlProps) {
  const resolvedVariant: LogThisHandVariant = variant ?? (compact ? 'compact' : 'default');
  const isHud = resolvedVariant === 'hud';

  const { status, errorMessage, reviewUrl, canLog, logThisHand, retry } = useLogHandToAssistant({
    handId,
    accountId,
    initialSavedHandId,
  });

  const validHand = isCanonicalUuid(handId) && canLog;
  const canTriggerHotkey = validHand && (status === 'idle' || status === 'error');

  const triggerRef = useRef<() => void>(() => {});
  triggerRef.current = () => {
    if (!validHand) return;
    if (status === 'error') {
      void retry();
    } else if (status === 'idle') {
      void logThisHand();
    }
  };

  useEffect(() => {
    if (!registerHotkey) return;
    if (!canTriggerHotkey) {
      registerHotkey(null);
      return;
    }
    registerHotkey(() => triggerRef.current());
    return () => registerHotkey(null);
  }, [registerHotkey, canTriggerHotkey]);

  const shouldBindStandaloneShortcut =
    !registerHotkey && (enableShortcut ?? isHud) && canTriggerHotkey;

  useEffect(() => {
    if (!shouldBindStandaloneShortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        event.isComposing
      ) {
        return;
      }
      if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'l') return;
      if (
        isEditableShortcutTarget(event.target) ||
        isEditableShortcutTarget(typeof document !== 'undefined' ? document.activeElement : null)
      ) {
        return;
      }
      event.preventDefault();
      triggerRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shouldBindStandaloneShortcut]);

  const handleOpenReview = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!reviewUrl) return;
      if (IS_NATIVE_BUILD && isNativePlatform()) {
        event.preventDefault();
        openInBrowser(reviewUrl);
      }
    },
    [reviewUrl]
  );

  // Only render for completed hands with a canonical UUID and an authenticated player.
  if (!validHand) {
    return null;
  }

  if (isHud) {
    return (
      <div className="lth lth--hud">
        {status === 'idle' && (
          <button
            type="button"
            className="lth__btn lth__btn--hud"
            aria-keyshortcuts="Shift+L"
            title="Log Last Hand (Shift+L)"
            onClick={() => void logThisHand()}
          >
            <BookmarkIcon />
            <span>Log Last Hand</span>
          </button>
        )}

        {status === 'saving' && (
          <button
            type="button"
            className="lth__btn lth__btn--hud lth__btn--saving"
            disabled
            aria-busy="true"
          >
            <BookmarkIcon />
            <span>Saving</span>
          </button>
        )}

        {(status === 'saved' || status === 'already_saved') && (
          <div className="lth__saved lth__saved--hud" role="status">
            <span
              className={`lth__badge lth__badge--hud${status === 'already_saved' ? ' lth__badge--existing' : ''}`}
            >
              <BookmarkCheckIcon />
              <span>Saved</span>
            </span>
            {reviewUrl && (
              <a
                className="lth__link lth__link--hud"
                href={reviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open In Assistant"
                onClick={handleOpenReview}
              >
                Open
              </a>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="lth__error-row lth__error-row--hud">
            <span className="lth__sr-only" role="alert">
              Error: {errorMessage || 'Could Not Save Hand'}
            </span>
            <button
              type="button"
              className="lth__retry lth__retry--hud"
              title={errorMessage || 'Could Not Save Hand'}
              onClick={() => void retry()}
            >
              <BookmarkIcon />
              <span>Retry</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`lth${resolvedVariant === 'compact' ? ' lth--compact' : ''}`}>
      {status === 'idle' && (
        <button type="button" className="lth__btn" onClick={() => void logThisHand()}>
          Log This Hand
        </button>
      )}

      {status === 'saving' && (
        <button type="button" className="lth__btn lth__btn--saving" disabled aria-busy="true">
          Saving
        </button>
      )}

      {(status === 'saved' || status === 'already_saved') && (
        <div className="lth__saved" role="status">
          <span
            className={`lth__badge${status === 'already_saved' ? ' lth__badge--existing' : ''}`}
          >
            {status === 'already_saved' ? 'Already Saved' : 'Hand Saved'}
          </span>
          {reviewUrl && (
            <a
              className="lth__link"
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenReview}
            >
              Open In Assistant
            </a>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="lth__error-row">
          <span className="lth__error" role="alert">
            Error: {errorMessage || 'Could Not Save Hand'}
          </span>
          <button type="button" className="lth__retry" onClick={() => void retry()}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
