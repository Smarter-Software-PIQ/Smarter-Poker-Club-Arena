# A refunded entry notifies the player and successor grants stay clean

## What was still open after #11797, #11831 and #11838

1. **No on-screen refund notification**: When a tournament entry was refunded
   (wallet or ticket), the player received no notification explaining the
   refund total or how much of it remained promo chips under play-through.
2. **Misleading "Promo Chips Received" push on refund successors**: When
   `20261123071237` (#11838) locked a refunded used-up (`spent`) grant under a
   successor grant (`source_ref LIKE 'refund_successor:%'`), `ca_promo_grant_notice`
   fired `"Promo Chips Received"` as though the sponsor had sent fresh promo.
3. **Daily promo digest double-counting**: `fn_ca_promo_daily_digest` summed
   every newly inserted grant row into `given`, so a refund successor re-lock
   would inflate sponsor giveaway totals even though zero new chips moved.
4. **Cash-table refund test proof**: Cash-table pending add-on refunds and
   closed-table cash-outs had been verified by code inspection only, not by an
   explicit full-refund test case in the PostgreSQL 17 custody suite.

## What changed (`20261123083752`)

- Added `public.ca_promo_refund_notices` (lock-free, no foreign keys, RLS
  enabled, `service_role` SELECT only) and private
  `public.fn_ca_promo_emit_refund_notice(...)`.
- Updated `public.fn_ca_promo_return_refunded_principal(uuid)` (wallet refunds)
  and `public.fn_ca_promo_returned_ticket_principal_fee(uuid, uuid, uuid)`
  (ticket refunds) to emit one idempotent refund notice per refund ledger leg
  with the exact refunded amount, tournament name when known, promo kept under
  play-through, promo already unlocked, and promo returned to sponsor if the
  grant had ended.
- Updated `public.fn_ca_promo_grant_notice()` so `refund_successor:%` inserts
  do not emit `"Promo Chips Received"` while preserving `met` completion and
  `override` notices.
- Updated `public.fn_ca_promo_daily_digest(date)` to exclude
  `refund_successor:%` rows from `given` while keeping them in `locked_now`,
  `unlocked` and `expired`.
- Added explicit full pending add-on refund (`applied=0, refunded=20`) and
  closed-table full cash-out checks to `scripts/ci/test-promo-custody.py`.

## Proof

- `scripts/ci/test-promo-principal-returns.py` (PG17, wallet refunds + replay + ACL)
- `scripts/ci/test-promo-ticket-principal-returns.py` (PG17, all 5 ticket refund modes + replay)
- `scripts/ci/test-promo-notices.py` (PG17, successor notice suppression, digest `given`/`locked_now`, refund notification copy + push outbox + replay + deleted profile)
- `scripts/ci/test-promo-custody.py` (PG17, 133 checks including full pending add-on refund and closed-table cash-out)
- `tests/a-refunded-entry-notifies-the-player-and-successor-grants-stay-clean.law.test.ts`
