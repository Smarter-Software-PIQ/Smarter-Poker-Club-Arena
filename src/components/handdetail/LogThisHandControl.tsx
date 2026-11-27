/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LOG THIS HAND CONTROL — Previous Hands -> Log This Hand -> Review My Play
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Lets a seated player save a completed Club Arena hand to World Hub Personal
 * Assistant without leaving the table, and open the review in a new tab.
 */

import type React from 'react';
import { useCallback } from 'react';
import { IS_NATIVE_BUILD, isNativePlatform } from '../../lib/appBase';
import { openInBrowser } from '../../lib/openExternal';
import { useLogHandToAssistant } from '../../hooks/useLogHandToAssistant';
import { isCanonicalUuid } from '../../services/SavedHandsService';
import './LogThisHandControl.css';

export interface LogThisHandControlProps {
  handId: string | null | undefined;
  accountId: string | null | undefined;
  compact?: boolean;
}

export default function LogThisHandControl({
  handId,
  accountId,
  compact = false,
}: LogThisHandControlProps) {
  const { status, errorMessage, reviewUrl, canLog, logThisHand, retry } = useLogHandToAssistant({
    handId,
    accountId,
  });

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
  if (!isCanonicalUuid(handId) || !canLog) {
    return null;
  }

  return (
    <div className={`lth${compact ? ' lth--compact' : ''}`}>
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
