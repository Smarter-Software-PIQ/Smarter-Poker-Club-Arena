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
  const requestInFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const unlock = async () => {
    if (!canOverride || requestInFlight.current || !reason.trim()) return;
    requestInFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      await overrideMemberPromoPlayThrough(clubId, userId, reason);
      if (!active.current) return;
      setReason('');
      setMessage('Promo Override Recorded. Source Review Holds Require Their Own Review.');
      reload();
    } catch (error) {
      reportError(error, 'MemberPromoPlayThrough.unlock');
      if (!active.current) return;
      // Re-read after an unknown outcome; do not replay a financial action.
      reload();
      setReason('');
      setMessage(error instanceof Error ? error.message : 'Promo Unlock Could Not Be Confirmed');
    } finally {
      requestInFlight.current = false;
      if (active.current) setPending(false);
    }
  };
  return (
    <section className="mm-card mm-stats" aria-label="Promo Play Through">
      <h2 className="mm-card__title">Promo Play Through</h2>
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
      {canOverride && summary && summary.open_grants > 0 && (
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
      {canOverride && summary?.integrity_available && (
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
