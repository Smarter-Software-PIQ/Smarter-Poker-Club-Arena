import type { PromoPlayThroughSummary } from '../services/PromoPlayThroughService';

type VisibilitySummary = Pick<
  PromoPlayThroughSummary,
  'locked' | 'fee_target' | 'fee_progress' | 'fee_remaining'
> & {
  expired_locked?: number;
  wallet_locked?: number;
  wallet_profit_locked?: number;
  profit_locked?: number;
  profit_fee_target?: number;
  profit_fee_progress?: number;
  profit_fee_remaining?: number;
  integrity_held?: number;
  agent_integrity_held?: number;
  integrity_total_held?: number;
};

/** A completed or exhausted grant never leaves a progress meter behind. */
export function hasActivePromoPlayThrough(summary: VisibilitySummary): boolean {
  return (
    summary.locked > (summary.expired_locked ?? 0) &&
    summary.fee_target > 0 &&
    summary.fee_remaining > 0
  );
}

export function activePromoPercent(summary: VisibilitySummary): number {
  if (!hasActivePromoPlayThrough(summary)) return 0;
  // Rounded database percentages can reach 100 before the final fraction is earned.
  return Math.min(
    99.99,
    Math.max(0, Math.floor((summary.fee_progress / summary.fee_target) * 10000) / 100)
  );
}

/** Only the authoritative restrictions in this wallet justify a second balance. */
export function hasPromoWithdrawalRestriction(summary: VisibilitySummary): boolean {
  return (summary.wallet_locked ?? summary.locked) > 0 || (summary.wallet_profit_locked ?? 0) > 0;
}

export function hasActivePromoProfit(summary: VisibilitySummary): boolean {
  return (
    (summary.profit_locked ?? 0) > 0 &&
    (summary.profit_fee_target ?? 0) > 0 &&
    (summary.profit_fee_remaining ?? 0) > 0
  );
}

export function activePromoProfitPercent(summary: VisibilitySummary): number {
  if (!hasActivePromoProfit(summary)) return 0;
  return Math.min(
    99.99,
    Math.max(
      0,
      Math.floor(((summary.profit_fee_progress ?? 0) / (summary.profit_fee_target ?? 1)) * 10000) /
        100
    )
  );
}

export function sourceReviewHeld(summary: VisibilitySummary): number {
  return Math.max(
    summary.integrity_total_held ?? 0,
    (summary.integrity_held ?? 0) + (summary.agent_integrity_held ?? 0)
  );
}

export function hasPromoRestrictionDetails(summary: VisibilitySummary): boolean {
  return (
    hasActivePromoPlayThrough(summary) ||
    hasActivePromoProfit(summary) ||
    hasPromoWithdrawalRestriction(summary) ||
    (summary.expired_locked ?? 0) > 0 ||
    sourceReviewHeld(summary) > 0
  );
}
