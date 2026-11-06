import { capture } from './analytics';
import {
  cashSeatOfferKey,
  type CashSeatOfferArrival,
} from '../components/common/waitlistSeatOffer';

const recorded = new Map<string, Set<string>>();
/** Observes explicit offer/visible buy-in events only; never retries admission. */
export function recordCashSeatOfferStage(
  offer: CashSeatOfferArrival,
  stage: 'received' | 'buy_in_opened',
  now = Date.now()
): void {
  const reservedAt = Date.parse(offer.notifiedAt);
  const expiresAt = Date.parse(offer.holdExpiresAt);
  if (!Number.isFinite(reservedAt) || !Number.isFinite(expiresAt)) return;
  const key = cashSeatOfferKey(offer);
  let stages = recorded.get(key);
  if (stages?.has(stage)) return;
  if (!stages) {
    if (recorded.size >= 128) recorded.delete(recorded.keys().next().value!);
    stages = new Set();
    recorded.set(key, stages);
  }
  stages.add(stage);
  const timing = {
    stage,
    table_id: offer.tableId,
    offer_id: offer.id,
    reservation_to_stage_ms: Math.max(0, now - reservedAt),
    remaining_hold_ms: Math.max(0, expiresAt - now),
    clock_ahead: reservedAt > now,
  };
  try {
    // First-party browser evidence remains inspectable when optional analytics
    // is disabled. Bound this feature's marks without touching other traces.
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      if (performance.getEntriesByName('cash_seat_offer_stage').length >= 256)
        performance.clearMarks('cash_seat_offer_stage');
      performance.mark('cash_seat_offer_stage', { detail: timing });
    }
  } catch {
    /* A diagnostic cannot refuse a seat. */
  }
  try {
    capture('cash_seat_offer_stage', timing);
  } catch {
    /* Optional timing never changes a player's admission. */
  }
}
