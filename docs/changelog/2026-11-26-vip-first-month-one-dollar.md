# VIP first month for one dollar (2026-11-26)

Dan: "When people are not VIP and they want to sign up for VIP, or they are told
to pay with Diamonds or upgrade to VIP, the first month should be $1 and then
$20 a month after that, they can cancel anytime, but all first month
subscriptions are just a dollar to start and sign up. Implement this globally."

## What changed here

The World Hub owns the terms and charges them (`src/lib/store/vipIntroOffer.mjs`
there). Club Arena mirrors the amounts and sends the reviewed offer.

- `marketplaceShared.ts`: `VIP_INTRO_OFFER`, `fetchVipIntroEligibility` (reads
  `introOffer.eligible` from `/api/store/vip-membership-status`), and an
  optional `introCents` on the subscription offer confirmation. With the
  offer, `totalCents` is the 100 due today and `unitCents` stays the 2000 every
  renewal bills.
- `MembershipTab.tsx`: the Monthly card reads "1 USD / First Month, Then 20 USD
  Per Month. Cancel Anytime." and the button "Subscribe With Card: 1 USD First
  Month" when the server says the account has never held a Card subscription.
  Unknown shows and confirms the regular price.

## Decisions

- Monthly Card subscription only. Yearly (200), Lifetime (500) and a
  Diamond-funded month (2,000 Diamonds) are unchanged: a Diamond month is one
  prepaid term with nothing to renew or cancel, and Diamonds can be earned free.
- Once per account. An account that has ever held a Card VIP subscription pays
  the regular price, so cancel-and-resubscribe does not buy a dollar month
  every month.
- Web only. Inside the app-store build a subscription is priced by StoreKit or
  Play; an introductory price there is configured in the store consoles.
- The server refuses a checkout whose amount due today differs from its own
  decision, in both directions, so a member is never shown one price and
  charged another.

Tests: `tests/unit/vipFirstMonthOffer.test.ts`.
