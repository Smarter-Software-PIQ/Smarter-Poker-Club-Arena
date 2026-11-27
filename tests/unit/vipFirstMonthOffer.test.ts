import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VIP_INTRO_OFFER,
  subscriptionCheckoutOfferConfirmation,
  type VipPlan,
} from '../../src/pages/marketplace/marketplaceShared';

/* Dan, 2026-11-26: "the first month should be $1 and then $20 a month after
   that, they can cancel anytime, but all first month subscriptions are just a
   dollar." The World Hub owns and charges the terms; these pin the Club Arena
   mirror and the reviewed offer it sends. */

const USER = '11111111-1111-4111-8111-111111111111';
const plan = (overrides: Partial<VipPlan> = {}): VipPlan =>
  ({
    id: 'vip-monthly',
    planKey: 'monthly',
    checkoutPlan: 'vip-monthly',
    cardCheckoutReady: true,
    diamondCheckoutReady: true,
    name: 'Monthly VIP',
    period: 'Per Month',
    priceUsd: 20,
    priceDiamonds: 2000,
    features: [],
    ...overrides,
  }) as VipPlan;

describe('VIP first month for one dollar', () => {
  it('mirrors the World Hub amounts', () => {
    expect(VIP_INTRO_OFFER).toEqual({
      planKey: 'monthly',
      firstPeriodCents: 100,
      regularCents: 2000,
    });
  });

  it('confirms the regular price unless the first-month offer is asked for', () => {
    const regular = subscriptionCheckoutOfferConfirmation(USER, plan());
    expect(regular).toMatchObject({ unitCents: 2000, totalCents: 2000 });
    expect(regular && 'introCents' in regular).toBe(false);
  });

  it('confirms one dollar due today and twenty for every renewal', () => {
    expect(subscriptionCheckoutOfferConfirmation(USER, plan(), true)).toEqual({
      version: 1,
      accountId: USER,
      type: 'subscription',
      currency: 'usd',
      plan: 'monthly',
      interval: 'month',
      quantity: 1,
      unitCents: 2000,
      totalCents: 100,
      introCents: 100,
    });
  });

  it('never attaches the offer to another plan or another regular price', () => {
    const yearly = plan({
      id: 'vip-yearly',
      planKey: 'yearly',
      checkoutPlan: 'vip-yearly',
      priceUsd: 200,
      priceDiamonds: 20000,
    });
    expect(subscriptionCheckoutOfferConfirmation(USER, yearly, true)).toBeNull();
    expect(subscriptionCheckoutOfferConfirmation(USER, plan({ priceUsd: 25 }), true)).toBeNull();
  });

  it('the membership tab shows and confirms the offer only on the server say-so', () => {
    const tab = readFileSync(
      resolve(__dirname, '../../src/pages/marketplace/MembershipTab.tsx'),
      'utf8'
    );
    expect(tab).toContain('const eligible = await fetchVipIntroEligibility(owner);');
    expect(tab).toMatch(/!native &&\s*introEligible === true &&\s*!wallet\.isVip &&/);
    expect(tab).toContain(
      'subscriptionCheckoutOfferConfirmation(\n        userId,\n        currentPlan,\n        firstMonthOffer\n      )'
    );
    expect(tab).toContain(
      'firstMonthOffer ? { introCents: VIP_INTRO_OFFER.firstPeriodCents } : {}'
    );
    expect(tab).toContain('First Month, Then ');
    // A readable sentence in its own class, never the 9px term label, and
    // the amount never breaks away from its unit on the painted button.
    expect(tab).toContain('<div className={styles.planOffer}>');
    expect(tab).toContain("'Subscribe For 1\\u00a0USD'");
    expect(tab).not.toContain('Subscribe With Card: 1 USD First Month');
    const css = readFileSync(
      resolve(__dirname, '../../src/pages/MarketplacePage.module.css'),
      'utf8'
    );
    expect(css).toMatch(/\.planOffer \{[^}]*700 12\.5px\/1\.35 Inter/);
    expect(css).toMatch(/\.planPeriod,\n\.pkgLabel \{[^}]*800 9px\/1/);
    // The Club Arena shows no dollar sign: the offer is worded in USD.
    expect(tab).not.toMatch(/\$1 First Month/);
  });
});
