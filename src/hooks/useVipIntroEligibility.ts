/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  useVipIntroEligibility: the first-month price, asked once per account
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-26: "the first month should be $1 and then $20 a month after
 * that, they can cancel anytime." The membership tab shows that price; this is
 * the same server answer for every OTHER surface that asks a non-member to go
 * VIP (the VIP page, the benefits sheet, the profile, the premium avatar and
 * Table Studio locks, the All In Squeeze and previous-hand Rabbit Hunt notes).
 *
 * Three answers, and they stay three:
 *
 *   true   the server says this account qualifies    -> the 1 USD line
 *   false  the server says it does not               -> the regular 20 USD line
 *   null   nobody could say (signed out, the read
 *          failed, the terms did not match)          -> NO price at all
 *
 * A wrong price is worse than no price, so unknown prints nothing. Inside the
 * native app the answer is always unknown and nothing is fetched: App Store
 * and Play subscriptions are priced by the store, not by this offer.
 *
 * ONE REQUEST PER ACCOUNT PER SESSION. Every surface shares one cache keyed by
 * the signed-in user id, and callers that arrive while the read is in flight
 * share that read, so opening a table does not fire a request per component.
 * An unknown answer is retried after a short wait rather than kept. The cache
 * is emptied the moment the signed-in account changes or signs out.
 *
 * The storefront module is imported on demand: it is large, and the table must
 * not carry it just to print one sentence.
 */

import { useEffect, useState } from 'react';
import { useUserStore } from '../stores/useUserStore';
import { usesInAppStorefront } from '../utils/hubMarketplace';

/** The 1 USD first month and the 20 USD renewal, in whole USD. */
export const VIP_INTRO_FIRST_MONTH_USD = 1;
export const VIP_INTRO_REGULAR_USD = 20;

/** Club Arena prints no currency symbol: the amounts are worded in USD. */
export const VIP_INTRO_PRICE_LINE = `First Month ${VIP_INTRO_FIRST_MONTH_USD} USD, Then ${VIP_INTRO_REGULAR_USD} USD Per Month. Cancel Anytime.`;
export const VIP_REGULAR_PRICE_LINE = `${VIP_INTRO_REGULAR_USD} USD Per Month. Cancel Anytime.`;
export const VIP_INTRO_VERIFY_CONTACT_LINE = `Verify Your Email Or Phone To Unlock The ${VIP_INTRO_FIRST_MONTH_USD} USD First Month`;

/**
 * Where every upgrade prompt sends the player: the marketplace membership tab
 * with the Monthly plan in view. On the web MarketplaceRoute hands this to the
 * World Hub membership page with the same plan selected; the native app keeps
 * its own membership tab. Nothing but that tab ever starts a checkout.
 */
export const VIP_MEMBERSHIP_PURCHASE_PATH = '/marketplace?tab=membership&plan=vip-monthly';

/** The same address as an href, for a text link that also routes in-app. */
export function vipMembershipPurchaseHref(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}${VIP_MEMBERSHIP_PURCHASE_PATH}`;
}

export interface VipIntroAnswer {
  /** true = qualifies, false = does not, null = unknown. */
  eligible: boolean | null;
  /** The server's reason code when it sent one (for example 'verify_contact'). */
  reason: string | null;
}

export interface VipIntroEligibility extends VipIntroAnswer {
  /** The sentence to print, or null when no price may be shown. */
  priceLine: string | null;
  /** A second sentence the reason calls for, or null. */
  reasonLine: string | null;
}

const UNKNOWN: VipIntroAnswer = Object.freeze({ eligible: null, reason: null });

/** How long an unknown answer stands before the next surface may ask again. */
export const VIP_INTRO_UNKNOWN_RETRY_MS = 60_000;

/**
 * The price sentence for an answer. Native never prints one; unknown never
 * prints one.
 */
export function vipUpgradePriceLine(
  eligible: boolean | null,
  native: boolean = usesInAppStorefront()
): string | null {
  if (native || eligible === null) return null;
  return eligible ? VIP_INTRO_PRICE_LINE : VIP_REGULAR_PRICE_LINE;
}

/**
 * The extra sentence a reason calls for. Only an account the server marked
 * not-yet-eligible for a reason it named gets one, and never inside the app.
 */
export function vipUpgradeReasonLine(
  answer: VipIntroAnswer,
  native: boolean = usesInAppStorefront()
): string | null {
  if (native || answer.eligible !== false) return null;
  return answer.reason === 'verify_contact' ? VIP_INTRO_VERIFY_CONTACT_LINE : null;
}

/** `text` followed by the price sentence when there is one to print. */
export function withVipUpgradePrice(text: string, priceLine: string | null): string {
  return priceLine ? `${text} ${priceLine}` : text;
}

interface CacheEntry {
  answer: VipIntroAnswer | null;
  pending: Promise<VipIntroAnswer> | null;
  /** When an unknown answer was recorded; 0 for a definite one. */
  unknownAt: number;
}

const cache = new Map<string, CacheEntry>();
let generation = 0;
let watchingAccount = false;

/** Empties the shared cache. Called on every account change and sign-out. */
export function clearVipIntroEligibilityCache(): void {
  generation += 1;
  cache.clear();
}

function watchAccount(): void {
  if (watchingAccount) return;
  // A store stand-in without the vanilla API (a component test's mock) has no
  // account to change; the per-user cache key still keeps answers apart.
  if (typeof useUserStore.getState !== 'function' || typeof useUserStore.subscribe !== 'function') {
    return;
  }
  watchingAccount = true;
  let lastUserId = useUserStore.getState().user?.id ?? null;
  useUserStore.subscribe((state) => {
    const nextUserId = state.user?.id ?? null;
    if (nextUserId === lastUserId) return;
    lastUserId = nextUserId;
    clearVipIntroEligibilityCache();
  });
}

/** The answer already held for this account, without asking. */
export function peekVipIntroEligibility(userId: string | null | undefined): VipIntroAnswer {
  if (!userId || usesInAppStorefront()) return UNKNOWN;
  return cache.get(userId)?.answer ?? UNKNOWN;
}

/**
 * The server's answer for this account: from the cache, from the read already
 * in flight, or from one new read. Never rejects; a failure is unknown.
 */
export function readVipIntroEligibility(
  userId: string | null | undefined
): Promise<VipIntroAnswer> {
  if (!userId || usesInAppStorefront()) return Promise.resolve(UNKNOWN);
  watchAccount();
  const held = cache.get(userId);
  if (held?.pending) return held.pending;
  if (held?.answer) {
    const stale =
      held.answer.eligible === null && Date.now() - held.unknownAt >= VIP_INTRO_UNKNOWN_RETRY_MS;
    if (!stale) return Promise.resolve(held.answer);
  }

  const startedIn = generation;
  const entry: CacheEntry = { answer: null, pending: null, unknownAt: 0 };
  entry.pending = import('../pages/marketplace/marketplaceShared')
    .then((shared) => shared.fetchVipIntroOfferStatus(userId))
    .then(
      (status): VipIntroAnswer => ({
        eligible: typeof status?.eligible === 'boolean' ? status.eligible : null,
        reason: typeof status?.reason === 'string' ? status.reason : null,
      }),
      (): VipIntroAnswer => UNKNOWN
    )
    .then((answer) => {
      // An answer that arrives after the account changed belongs to nobody.
      if (startedIn !== generation) return UNKNOWN;
      entry.answer = answer;
      entry.pending = null;
      entry.unknownAt = answer.eligible === null ? Date.now() : 0;
      return answer;
    });
  cache.set(userId, entry);
  return entry.pending;
}

/**
 * The first-month price for the signed-in account. Pass `enabled: false` where
 * the surface has nothing to offer (the player is already VIP, the prompt is
 * closed): nothing is fetched and no price is returned.
 */
export function useVipIntroEligibility(enabled: boolean = true): VipIntroEligibility {
  const userId = useUserStore((state) => state.user?.id ?? null);
  const native = usesInAppStorefront();
  const active = enabled && !native && !!userId;
  const [held, setHeld] = useState<{ userId: string | null; answer: VipIntroAnswer }>(() => ({
    userId,
    answer: active ? peekVipIntroEligibility(userId) : UNKNOWN,
  }));

  useEffect(() => {
    if (!active) {
      setHeld({ userId, answer: UNKNOWN });
      return;
    }
    let cancelled = false;
    setHeld({ userId, answer: peekVipIntroEligibility(userId) });
    void readVipIntroEligibility(userId).then((answer) => {
      if (!cancelled) setHeld({ userId, answer });
    });
    return () => {
      cancelled = true;
    };
  }, [active, userId]);

  // An answer held for a previous account is never shown to the next one.
  const answer = active && held.userId === userId ? held.answer : UNKNOWN;
  return {
    eligible: answer.eligible,
    reason: answer.reason,
    priceLine: vipUpgradePriceLine(answer.eligible, native),
    reasonLine: vipUpgradeReasonLine(answer, native),
  };
}
