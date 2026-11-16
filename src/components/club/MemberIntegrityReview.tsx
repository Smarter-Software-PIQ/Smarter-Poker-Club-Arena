import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readPromoIntegrityReview,
  releasePromoIntegrityCase,
  type PromoIntegrityReview,
} from '../../services/PromoIntegrityService';
import { formatWalletChips } from '../../utils/format';
import { formatPopupText } from '../../utils/popupStyle';
import { reportError } from '../../utils/errorReporter';
import '../../pages/MemberManagementPage.css';
import '../wallet/PromoPlayThroughProgress.css';
import './MemberIntegrityReview.css';

export function MemberIntegrityReview({
  clubId,
  userId,
  revision,
  onChanged,
}: {
  clubId: string;
  userId: string;
  revision: number;
  onChanged: () => void;
}) {
  const scope = `${clubId}:${userId}`;
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const [review, setReview] = useState<PromoIntegrityReview | null>(null);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setReview(null);
    setError(false);
    try {
      const current = await readPromoIntegrityReview(clubId, userId, request.signal);
      if (!request.signal.aborted && alive.current) setReview(current);
    } catch (failure) {
      if (!request.signal.aborted && alive.current) {
        reportError(failure, 'MemberIntegrityReview.read');
        setError(true);
      }
    }
  }, [clubId, userId]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, [load, revision]);
  const release = async (caseId: string) => {
    const requestScope = scope;
    const reason = reasons[caseId]?.trim();
    if (
      inFlight.current ||
      !reason ||
      !review?.cases.some((item) => item.case_id === caseId && item.can_release)
    )
      return;
    inFlight.current = true;
    setPending(caseId);
    setMessage(null);
    try {
      await releasePromoIntegrityCase(caseId, reason);
      if (!alive.current || liveScope.current !== requestScope) return;
      setMessage(
        'Source Review Recorded. The Separate Promo Play Through Requirement Still Applies.'
      );
      setReasons({});
      onChanged();
      await load();
    } catch (failure) {
      reportError(failure, 'MemberIntegrityReview.release');
      if (!alive.current || liveScope.current !== requestScope) return;
      setMessage(
        failure instanceof Error ? failure.message : 'Source Review Could Not Be Confirmed'
      );
      setReasons({});
      await load();
    } finally {
      inFlight.current = false;
      if (alive.current && liveScope.current === requestScope) setPending(null);
    }
  };
  return (
    <div className="promo-review" aria-label="Source Review Cases">
      <h3 className="mm-card__title">Source Review</h3>
      <p>Review Holds Are Separate From The Promo Fee Requirement.</p>
      {message && <p role="status">{formatPopupText(message)}</p>}
      {error ? (
        <p role="status">
          Source Review Is Unavailable.{' '}
          <button
            className="promo-progress__retry"
            type="button"
            onClick={() => {
              void load();
            }}
          >
            Retry Source Review
          </button>
        </p>
      ) : !review ? (
        <p role="status">Reading Source Review...</p>
      ) : review.cases.length === 0 ? (
        <p>No Pending Source Reviews.</p>
      ) : (
        review.cases.map((item) => (
          <article className="promo-review__case" key={item.case_id}>
            <h4 className="sc-label sc-ink--blue">{formatPopupText(item.reason)}</h4>
            <p>
              {formatWalletChips(item.held)} Held · {new Date(item.created_at).toLocaleString()}
            </p>
            {item.held === 0 && <p>Evidence Only. No Chips Are Held For This Case.</p>}
            {item.original_amount !== undefined && (
              <p>{formatWalletChips(item.original_amount)} Originally Held</p>
            )}
            <p>Case: {item.case_id}</p>
            {item.evidence && (
              <dl>
                {(['source_principal_lost', 'bank_fee', 'recipient_net_gain'] as const).map(
                  (key) => {
                    const value = item.evidence?.[key];
                    if (
                      (typeof value !== 'number' && typeof value !== 'string') ||
                      !Number.isFinite(Number(value))
                    )
                      return null;
                    const label = {
                      source_principal_lost: 'Source Promo Lost',
                      bank_fee: 'Hand Bank Fees',
                      recipient_net_gain: 'Recipient Net Gain',
                    }[key];
                    return (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{formatWalletChips(Number(value))}</dd>
                      </div>
                    );
                  }
                )}
              </dl>
            )}
            {item.can_release ? (
              <div className="mm-field">
                <label className="mm-field__label" htmlFor={`source-review-${item.case_id}`}>
                  Reason For Source Review
                </label>
                <input
                  id={`source-review-${item.case_id}`}
                  value={reasons[item.case_id] ?? ''}
                  maxLength={500}
                  disabled={pending !== null}
                  autoComplete="off"
                  onChange={(event) =>
                    setReasons((current) => ({ ...current, [item.case_id]: event.target.value }))
                  }
                />
                <button
                  className="promo-progress__retry"
                  type="button"
                  disabled={pending !== null || !reasons[item.case_id]?.trim()}
                  onClick={() => {
                    void release(item.case_id);
                  }}
                >
                  {pending === item.case_id
                    ? 'Recording Source Review...'
                    : 'Mark Reviewed And Release Hold'}
                </button>
              </div>
            ) : (
              <p>The Original Case Club Must Review This Hold.</p>
            )}
          </article>
        ))
      )}
    </div>
  );
}
