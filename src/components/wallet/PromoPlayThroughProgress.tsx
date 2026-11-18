import PromoPlayThroughHelp from './PromoPlayThroughHelp';
import { useAuthUser } from '../../hooks/useAuthUser';
import { usePromoPlayThrough } from '../../hooks/usePromoPlayThrough';
import { formatWalletChips } from '../../utils/format';
import type { PromoPlayThroughSummary } from '../../services/PromoPlayThroughService';
import {
  activePromoPercent,
  activePromoProfitPercent,
  hasActivePromoProfit,
  hasPromoWithdrawalRestriction,
  hasAgentPromoWithdrawalRestriction,
  hasActivePromoPlayThrough,
  hasPromoRestrictionDetails,
} from '../../utils/promoPlayThroughVisibility';
import './PromoPlayThroughProgress.css';

export function PromoPlayThroughFigure({ summary }: { summary: PromoPlayThroughSummary }) {
  if (!hasPromoRestrictionDetails(summary)) return null;
  const active = hasActivePromoPlayThrough(summary);
  const percent = activePromoPercent(summary);
  return (
    <section
      className="promo-progress"
      aria-label={active ? 'Promo Play Through' : 'Chip Restrictions'}
    >
      {active && (
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
      )}
      <PromoPlayThroughHelp>
        <PromoPlayThroughDetails summary={summary} />
      </PromoPlayThroughHelp>
    </section>
  );
}

function PromoPlayThroughDetails({ summary }: { summary: PromoPlayThroughSummary }) {
  const active = hasActivePromoPlayThrough(summary);
  return (
    <div className="promo-progress__copy">
      <p>
        Promo Principal Unlocks After 4× Its Original Amount In Fees. Promo Profits Unlock After 2×.
        The Same Fees Count Toward Both Requirements.
      </p>
      <p>
        Your Own Funds And Rakeback Remain Withdrawable. A Fully Lost Promo Balance Ends Its Play
        Through; Later Credits Do Not Restart It.
      </p>
      {active && (
        <>
          <span className="sc-label sc-ink--blue">Promo Play Through</span>
          <span>
            {formatWalletChips(summary.fee_progress)} Of {formatWalletChips(summary.fee_target)} In
            Fees
          </span>
          <span>
            {formatWalletChips(summary.fee_remaining)} To Go · {formatWalletChips(summary.locked)}{' '}
            Locked
          </span>
        </>
      )}
      {hasActivePromoProfit(summary) && (
        <span>
          Promo Profit Fee Progress: {activePromoProfitPercent(summary)}% ·{' '}
          {formatWalletChips(summary.profit_fee_progress ?? 0)} Of{' '}
          {formatWalletChips(summary.profit_fee_target ?? 0)} In Fees ·{' '}
          {formatWalletChips(summary.profit_fee_remaining ?? 0)} To Go
        </span>
      )}
      {hasPromoWithdrawalRestriction(summary) && (
        <span>Withdrawable Balance: {formatWalletChips(summary.cashable)}</span>
      )}
      {hasAgentPromoWithdrawalRestriction(summary) &&
        summary.agent_wallet != null &&
        summary.agent_cashable != null && (
          <div aria-label="Agent Wallet Restrictions">
            <span>Agent Wallet: {formatWalletChips(summary.agent_wallet)}</span>
            <br />
            <span>Withdrawable Balance: {formatWalletChips(summary.agent_cashable)}</span>
          </div>
        )}
      {(summary.integrity_held ?? 0) > 0 && (
        <span>{formatWalletChips(summary.integrity_held ?? 0)} Held For Source Review</span>
      )}
      {(summary.agent_integrity_held ?? 0) > 0 && (
        <span>
          {formatWalletChips(summary.agent_integrity_held ?? 0)} Agent Chips Held For Source Review
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
      {active && summary.next_expiry_at && (
        <span>Next Expiry: {new Date(summary.next_expiry_at).toLocaleDateString()}</span>
      )}
    </div>
  );
}

/** The roster shares the same active-principal rule as wallet and cashout. */
export function PromoPlayThroughInline({
  summary,
}: {
  summary: PromoPlayThroughSummary | null | undefined;
}) {
  if (!summary)
    return (
      <span className="member-promo">
        {summary === undefined ? 'Reading Promo...' : 'Promo Unavailable'}
      </span>
    );
  if (!hasPromoRestrictionDetails(summary)) return null;
  return (
    <span className="promo-progress__inline">
      {hasActivePromoPlayThrough(summary) && (
        <span
          role="progressbar"
          aria-label="Promo Fee Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={activePromoPercent(summary)}
        >
          {activePromoPercent(summary)}%
        </span>
      )}
      <PromoPlayThroughHelp>
        <PromoPlayThroughDetails summary={summary} />
      </PromoPlayThroughHelp>
    </span>
  );
}

export function PromoPlayThroughProgress({
  clubId,
  cashoutRequested = false,
}: {
  clubId: string | null | undefined;
  cashoutRequested?: boolean;
}) {
  const { user } = useAuthUser();
  const { summary, requested, loading, error, reload } = usePromoPlayThrough(
    clubId,
    user?.id,
    cashoutRequested
  );
  if (!clubId || !user?.id) return null;
  if (!requested && !cashoutRequested)
    return (
      <button className="promo-progress__retry" type="button" onClick={() => void reload()}>
        Check Promo Progress
      </button>
    );
  if (loading || !requested)
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
  if (cashoutRequested) return <PromoPlayThroughFigure summary={summary} />;
  return (
    <div>
      {hasPromoRestrictionDetails(summary) ? (
        <PromoPlayThroughFigure summary={summary} />
      ) : (
        <p role="status">No Current Promo Restrictions.</p>
      )}
      <button className="promo-progress__retry" type="button" onClick={() => void reload()}>
        Refresh Promo Progress
      </button>
    </div>
  );
}
