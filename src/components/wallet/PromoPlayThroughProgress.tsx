import { useAuthUser } from '../../hooks/useAuthUser';
import { usePromoPlayThrough } from '../../hooks/usePromoPlayThrough';
import { formatWalletChips } from '../../utils/format';
import type { PromoPlayThroughSummary } from '../../services/PromoPlayThroughService';
import './PromoPlayThroughProgress.css';

export function PromoPlayThroughFigure({ summary }: { summary: PromoPlayThroughSummary }) {
  const percent = Math.min(100, Math.max(0, summary.percent));
  return (
    <section className="promo-progress" aria-label="Promo Play Through">
      <div
        className="promo-progress__ring"
        role="progressbar"
        aria-label="Promo Fee Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <circle className="promo-progress__track" cx="22" cy="22" r="18" />
          <circle
            className="promo-progress__value"
            cx="22"
            cy="22"
            r="18"
            pathLength="100"
            strokeDasharray={`${percent} 100`}
          />
        </svg>
        <strong>{percent}%</strong>
      </div>
      <div className="promo-progress__copy">
        <span className="sc-label sc-ink--blue">Promo Play Through</span>
        <span>
          {formatWalletChips(summary.fee_progress)} Of {formatWalletChips(summary.fee_target)} In
          Fees
        </span>
        <span>
          {formatWalletChips(summary.fee_remaining)} To Go · {formatWalletChips(summary.locked)}{' '}
          Locked
        </span>
        <span>{formatWalletChips(summary.cashable)} Cashable</span>
        {(summary.integrity_held ?? 0) > 0 && (
          <span>{formatWalletChips(summary.integrity_held ?? 0)} Held For Source Review</span>
        )}
        {(summary.agent_integrity_held ?? 0) > 0 && (
          <span>
            {formatWalletChips(summary.agent_integrity_held ?? 0)} Agent Chips Held For Source
            Review
          </span>
        )}
        {(summary.integrity_total_held ?? 0) >
          (summary.integrity_held ?? 0) + (summary.agent_integrity_held ?? 0) && (
          <span>
            {formatWalletChips(summary.integrity_total_held ?? 0)} Total Held For Source Review
          </span>
        )}
        {(summary.expired_locked ?? 0) > 0 && (
          <span>
            {formatWalletChips(summary.expired_locked ?? 0)} Expired Promo Awaiting Return To Its
            Original Fund
          </span>
        )}
        {summary.next_expiry_at && (
          <span>Next Expiry: {new Date(summary.next_expiry_at).toLocaleDateString()}</span>
        )}
      </div>
    </section>
  );
}

export function PromoPlayThroughProgress({ clubId }: { clubId: string | null | undefined }) {
  const { user } = useAuthUser();
  const { summary, loading, error, reload } = usePromoPlayThrough(clubId, user?.id);
  if (!clubId || !user?.id) return null;
  if (loading)
    return (
      <p className="sc-copy" role="status">
        Reading Promo Progress...
      </p>
    );
  if (error || !summary)
    return (
      <p className="sc-copy" role="status">
        Promo Progress Is Unavailable.{' '}
        <button
          className="promo-progress__retry"
          type="button"
          onClick={() => {
            void reload();
          }}
        >
          Retry
        </button>
      </p>
    );
  return <PromoPlayThroughFigure summary={summary} />;
}
