/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PREVIOUS HAND CARD — Bottom-Left HUD Widget
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Compact card showing the result of the last completed hand.
 * Turned into a pure icon button to match the time bank and chat buttons.
 */

import React, { useEffect, useRef, useState } from 'react';
import { handHistoryService } from '../../services/HandHistoryService';
import { adaptServiceHandToPanel } from '../../lib/handHistoryAdapter';
import { reportError } from '../../utils/errorReporter';
import type { PreviousLightningDeal } from '../../lightning/usePreviousLightningDeal';
import './PreviousHandCard.css';
import type { HandRecord } from './HandHistoryPanel';
import { useButtonImage } from '../../hooks/useButtonImage';

/**
 * AUDIT 2026-08-25 — FIVE OF THESE SEVEN PROPS ARE ACCEPTED AND IGNORED.
 *
 * The widget was a summary card once; it is a single icon button now, and the
 * rewrite left the old props on the interface. TablePage still computes and
 * passes every one of them.
 *
 * Four of them are only wasted work. `onShareHand` is not: TablePage passes a
 * real handler that toasts when there is no captured hand and otherwise opens
 * the share modal, and NOTHING in here ever calls it. It was a feature with an
 * implementation at both ends and no connection in the middle.
 *
 * It is not re-wired here, because there is nowhere honest to put it: the card
 * is one icon whose one tap opens the hand history, and inventing a long-press
 * would be inventing UX nobody asked for. Sharing is already reachable from the
 * table menu (TablePage.tsx also calls `setShowShareHand(true)` from there), so
 * nothing is actually lost — the dead wire is. Delete the five props from the
 * `<PreviousHandCard>` call site and they can come off this interface too.
 */
export interface PreviousHandCardProps {
  handNumber: number | null;
  /** Signed-in viewers can review saved hands before a hand completes in this session. */
  canReviewHistory?: boolean;
  /** @deprecated Accepted and ignored — the card shows an icon, not a result. */
  result?: number;
  /** @deprecated Accepted and ignored. */
  didWin?: boolean;
  /** @deprecated Accepted and ignored. */
  didFold?: boolean;
  /** @deprecated Accepted and ignored. */
  handDescription?: string;
  onTap?: () => void;
  /** @deprecated Accepted and ignored. Share is reachable from the table menu. */
  onShareHand?: () => void;
}

export function PreviousHandCard({
  handNumber,
  canReviewHistory = false,
  onTap,
}: PreviousHandCardProps) {
  const prevHandIcon = useButtonImage('icon-prevhand');
  // A refresh clears the in-session number, not the viewer's saved hands.
  if (handNumber == null && !canReviewHistory) return null;

  return (
    <div className="prev-hand-card-wrapper">
      <div
        className="prev-hand-card"
        onClick={() => onTap?.()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTap?.();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={
          handNumber == null
            ? 'Previous Hand - Open Hand History'
            : `Previous Hand #${handNumber} - Open Hand History`
        }
        title="Open Hand History"
      >
        <div className="prev-hand-card__icon">
          {/* Custom playing-cards icon image */}
          <img src={prevHandIcon} className="prev-hand-card__icon-img" alt="" draggable={false} />
        </div>
      </div>
    </div>
  );
}

export function LightningPreviousHandReview({
  deal,
  room,
  viewer,
  connected,
  receipt,
  onClose,
}: {
  deal: PreviousLightningDeal;
  room: string;
  viewer: string;
  connected: boolean;
  receipt?: { archiveId: string | null };
  onClose: () => void;
}) {
  const [result, setResult] = useState<{
    status: 'pending' | 'unavailable' | 'failed' | 'ready';
    hand?: HandRecord;
  }>({ status: 'pending' });
  const [reconnect, setReconnect] = useState(0);
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) setReconnect((count) => count + 1);
    wasConnected.current = connected;
  }, [connected]);
  useEffect(() => {
    let active = true;
    void handHistoryService
      .getPreviousLightningHand(viewer, room, deal, receipt)
      .then((read) => {
        if (active)
          setResult(
            read.state === 'ready'
              ? { status: 'ready', hand: adaptServiceHandToPanel(read.hand, viewer) }
              : { status: read.state }
          );
      })
      .catch((error) => {
        if (!active) return;
        reportError(error, 'LightningPreviousHandReview');
        setResult({ status: 'failed' });
      });
    return () => {
      active = false;
    };
  }, [viewer, room, deal, receipt, reconnect]);
  return (
    <LightningPreviousHandResult
      handNumber={deal.number}
      hand={result.hand}
      historyFailed={result.status === 'failed'}
      archiveUnavailable={result.status === 'unavailable'}
      onClose={onClose}
    />
  );
}

export function LightningPreviousHandResult({
  handNumber,
  hand,
  historyFailed,
  archiveUnavailable = false,
  onClose,
}: {
  handNumber: number;
  hand?: Pick<HandRecord, 'handNumber' | 'streets' | 'potTotal' | 'heroResult'>;
  historyFailed: boolean;
  archiveUnavailable?: boolean;
  onClose: () => void;
}) {
  return (
    <aside className="lightning-previous-result" aria-label="Previous Lightning Hand">
      <button type="button" aria-label="Close Previous Hand" onClick={onClose}>
        ×
      </button>
      <strong>Hand #{handNumber}</strong>
      <div role="status">
        {hand?.handNumber === handNumber ? (
          <>
            <div>
              {hand.streets.flatMap((street) => street.cards ?? []).join(' ') || 'No Board Dealt'}
            </div>
            <div>
              Pot {hand.potTotal} · Your Result {hand.heroResult > 0 ? '+' : ''}
              {hand.heroResult}
            </div>
          </>
        ) : archiveUnavailable ? (
          'Hand Settled · History Unavailable'
        ) : historyFailed ? (
          'Hand History Unavailable'
        ) : (
          'Awaiting Final Result'
        )}
      </div>
    </aside>
  );
}

export default PreviousHandCard;
