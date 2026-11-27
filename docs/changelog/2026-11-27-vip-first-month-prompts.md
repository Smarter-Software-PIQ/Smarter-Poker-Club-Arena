# 2026-11-27: the first-month VIP price on every Club Arena upgrade prompt

Dan, 2026-11-26: "the first month should be $1 and then $20 a month after
that, they can cancel anytime." The membership tab has shown that since
#12193. Every other place that asks a non-member to go VIP said nothing about
price, and several led somewhere other than the purchase.

## What changed

One shared answer, `src/hooks/useVipIntroEligibility.ts`:

- asks `/api/store/vip-membership-status` once per signed-in account per
  session (callers that arrive mid-read share the read), through a new
  `fetchVipIntroOfferStatus` in `marketplaceShared.ts` that also passes the
  server's `introOffer.reason` through when it sends one;
- eligible prints "First Month 1 USD, Then 20 USD Per Month. Cancel Anytime.",
  not eligible prints "20 USD Per Month. Cancel Anytime.", and unknown prints
  nothing. An unknown answer is asked again after 60 seconds rather than kept;
- inside the native app it never asks and never prints a price (the stores
  price subscriptions themselves);
- the cache is emptied when the signed-in account changes or signs out, and an
  answer that lands after that is dropped;
- the storefront module is imported on demand so the table does not carry it.

Surfaces that now print the price, in text zones that already existed:

| Surface                                             | Where the line goes                     | One tap to the purchase                          |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| VIP benefits sheet (`VIPCardsModal`)                | the status copy under "Pay Per Feature" | its "Join Club Arena For A Membership" link      |
| VIP page, "Buy Features" for a non-member           | the section description                 | a "Get VIP Membership" text link in the sentence |
| Profile, membership row                             | the meta line                           | the row's button, now "Get VIP Membership"       |
| All In Squeeze upsell toast                         | appended to the toast                   | none (at the table)                              |
| Hand detail, previous-hand Rabbit Hunt VIP note     | a second line in the same class         | none (at the table)                              |
| Premium avatar, frame and aura "requires VIP" notes | appended to the notice                  | none                                             |
| Table Studio unlock prompt                          | appended to the prompt copy             | none (at the table)                              |
| `Shell` VIP badge                                   | no price (a tooltip)                    | was the Diamond tab, now the membership tab      |

"The purchase" is `/marketplace?tab=membership&plan=vip-monthly`: on the web
`MarketplaceRoute` hands it to `/hub/vip-membership?plan=vip-monthly`, and the
native app keeps its own membership tab. Nothing outside `MembershipTab`
starts a checkout. The benefits sheet used to link to `/hub/vip-membership`
directly, which skipped the in-app route the native build depends on.

At-the-table surfaces print the price but do not navigate: a link there would
take a seated player off a live table.

## Not changed

Prices, plan data, the offer confirmation, the engine, the database.

## Tests

`tests/unit/vipFirstMonthPrompts.test.tsx` (hook: eligible, ineligible,
unknown, native, signed out, shared request, account change, sign-out; and a
source contract per surface). `tests/unit/VIPCardsModal.test.tsx` and
`tests/unit/vipAllInSqueeze.test.ts` updated for the new link target and the
upsell's price argument.
