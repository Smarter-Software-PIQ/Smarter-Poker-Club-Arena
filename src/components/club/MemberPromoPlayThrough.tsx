import {
  hasActivePromoPlayThrough,
  hasPromoRestrictionDetails,
} from '../../utils/promoPlayThroughVisibility';
import { MemberIntegrityReview } from './MemberIntegrityReview';
import { useEffect, useRef, useState } from 'react';
import { overrideMemberPromoPlayThrough } from '../../services/PromoPlayThroughService';
import { reportError } from '../../utils/errorReporter';
import { formatPopupText } from '../../utils/popupStyle';
import '../../pages/MemberManagementPage.css';
import '../wallet/PromoPlayThroughProgress.css';
import { useMemberPromoPlayThrough } from '../../hooks/useMemberPromoPlayThrough';
import { PromoPlayThroughFigure } from '../wallet/PromoPlayThroughProgress';
export function MemberPromoPlayThrough({
  clubId,
  userId,
  revision,
  canOverride = false,
}: {
  clubId: string;
  userId: string;
  revision: number;
  canOverride?: boolean;
}) {
  const { members, reload } = useMemberPromoPlayThrough(clubId, [userId], revision);
  const summary = members?.[userId];
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);
  const scope = `${clubId}:${userId}`;
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const requestInFlight = useRef<symbol | null>(null);
  useEffect(() => {
    requestInFlight.current = null;
    setPending(false);
    setReason('');
    setMessage(null);
  }, [scope]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const unlock = async () => {
    if (!canOverride || requestInFlight.current || !reason.trim()) return;
    const requestScope = scope;
    const operation = Symbol();
    requestInFlight.current = operation;
    setPending(true);
    setMessage(null);
    try {
      await overrideMemberPromoPlayThrough(clubId, userId, reason);
      if (
        !active.current ||
        liveScope.current !== requestScope ||
        requestInFlight.current !== operation
      )
        return;
      setReason('');
      setMessage('Promo Override Recorded. Source Review Holds Require Their Own Review.');
      reload();
    } catch (error) {
      reportError(error, 'MemberPromoPlayThrough.unlock');
      if (
        !active.current ||
        liveScope.current !== requestScope ||
        requestInFlight.current !== operation
      )
        return;
      // Re-read after an unknown outcome; do not replay a financial action.
      reload();
      setReason('');
      setMessage(error instanceof Error ? error.message : 'Promo Unlock Could Not Be Confirmed');
    } finally {
      if (requestInFlight.current === operation) {
        requestInFlight.current = null;
        if (active.current && liveScope.current === requestScope) setPending(false);
      }
    }
  };
  const activePromo = summary ? hasActivePromoPlayThrough(summary) : false;
  const showReview = canOverride && summary?.integrity_available;
  if (summary && !hasPromoRestrictionDetails(summary) && !showReview) return null;
  return (
    <section
      className="mm-card mm-stats"
      aria-label={activePromo || !summary ? 'Promo Play Through' : 'Chip Restrictions'}
    >
      {(activePromo || !summary) && <h2 className="mm-card__title">Promo Play Through</h2>}
      {members === undefined ? (
        <p role="status">Reading Promo Progress...</p>
      ) : summary ? (
        <PromoPlayThroughFigure summary={summary} />
      ) : (
        <p role="status">
          Promo Progress Is Unavailable.{' '}
          <button type="button" onClick={reload}>
            Retry
          </button>
        </p>
      )}
      {canOverride && summary && activePromo && (
        <div className="mm-field">
          <label className="mm-field__label" htmlFor="promo-override-reason">
            Reason For Promo Unlock
          </label>
          <input
            id="promo-override-reason"
            value={reason}
            maxLength={500}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            autoComplete="off"
          />
          <button
            className="promo-progress__retry"
            type="button"
            disabled={pending || !reason.trim()}
            onClick={() => {
              void unlock();
            }}
          >
            {pending ? 'Recording Promo Unlock...' : 'Unlock Promo With Reason'}
          </button>
        </div>
      )}
      {message && <p role="status">{formatPopupText(message)}</p>}
      {showReview && (
        <MemberIntegrityReview
          clubId={clubId}
          userId={userId}
          revision={revision}
          onChanged={reload}
        />
      )}
    </section>
  );
}
