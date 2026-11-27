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

## Follow-up the same day: the membership tab's offer text

Rendered at 393px and 1280px, two things in the tab were wrong:

- the offer sentence reused `planPeriod` (9px) and was close to unreadable. It
  now has its own class, `planOffer` (12.5px, line height 1.35, the store's
  light ink); `planPeriod` is unchanged for Per Month, Per Year and One Payment;
- the card button label wrapped inside the 174px painted button. It is now
  "Subscribe For 1 USD" on one line, with a non-breaking space so the amount
  never leaves its unit. The sentence above the button carries the rest of the
  terms.

Not published: the owner asked for the membership surfaces to be redesigned
before anything ships, so this branch stays unmerged until he approves pictures.

## Second follow-up: the plan cards print inside their painted glass

Dan rejected the 393px render of the membership tab. Judged against
#ClubArenaConsole, the plan card was already on approved masters (the
shark-panel-v1 top, mid and bottom slices, the painted primary and secondary
plates, and the immutable gold VIP card art); what failed was the zones:

- the shared chassis inset, `clamp(14px, 3vw, 42px)`, is 14px on a phone, and
  the master's side rail runs x 21-57 of 900 (23px on a 360px card), so the
  plan name, price, offer, features, the gold VIP art and "Most Popular" all
  sat on the chrome. `.planCard` now measures every zone in master pixels of
  its own painted width: content from x 88 of 900, the first line below the
  143-row top cap, the last plate above the 139-row bottom cap;
- "Most Popular" prints into the top cap's plain brushed glass, x 78-318 and
  y 90-136 of the master, in brand gold;
- every line is centred over the centred plates, and "Cancel Anytime." is its
  own line so the offer never breaks mid-phrase;
- the footer note began a line with a stray full stop after its inline link.
  The sentences now come first and the link closes the note (web and native).

The VIP benefits sheet (`SpadeConsole`, VIP crest): the price line is its own
line instead of being run on from "Or Join Club Arena For A Membership", the
"Diamond Cost" header that touched the right rail reads "Diamonds", and the lit
purchase word that ran into both rails reads "Get VIP Membership" (the same
words as the VIP page and profile row). The VIP page's Buy Features section
prints the price on its own line in the schema's brass.

Found, not fixed (art): the `top-vip` head carries a ghost of old text under
the title, visible on every render of the sheet before and after this change;
it needs the head repainted from the master, not CSS.

Still not published: nothing merges until Dan approves the pictures.
