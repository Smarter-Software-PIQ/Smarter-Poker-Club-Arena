# The house returns Mongo the blind he posted without seeing his cards (2026-11-09)

Owner approval, Dan, in chat 2026-11-09 14:58 America/Chicago: "Approved to
reimburse Mongo's verified 0.25-chip blind loss through the existing audited
adjustment route. Recheck for an earlier reimbursement, pay once and reconcile
its debit, credit and receipt. Preserve the settled hand."

## What is paid

0.25 chips to Mongo (`d55730d2-da5a-45fc-8478-82e49f97cd7e`), into his KINGS
CLUB wallet, from the Midway Union bank, for Lightning NLH 0.25/0.50 hand
58167350 (`lightning_hand` 858bcb15). He was dealt into the small blind, his
phone never drew his hole cards, and the clock folded him 31 seconds later.
`lightning_hand_player` records `fold_type = normal`, `net_result = -0.25`.

The engine dealt and settled the hand correctly. The cards were lost in the
table client; see
`2026-11-09-the-hero-always-holds-the-cards-they-were-dealt.md` (#10215).

## Route

Migration `20261109212039_the_house_returns_mongo_the_blind_he_posted_without_seeing_h`,
the same door as `20261106213809` and `20261109010752`: a 10.9 manual
adjustment, a declared union bank debit, `fn_credit_and_log` under the key
`lightning-unseen-hole-cards-make-good:<hand>:<player>`, one `chip_ledger`
leg, the adjustment settled, and a resolved `financial_alerts` row.

## Checked before writing

- No earlier reimbursement: no `ca_manual_adjustments` row,
  `wallet_transactions` row or `wallet_credit_idempotency` key names this hand
  for this player (read 2026-11-09 21:15 UTC). The migration refuses to run if
  the key, a ledger leg or its own adjustment already exists.
- Probed on production in one self-aborting call (CLAUDE.md 11.5),
  2026-11-09 about 21:25 UTC: `PROBE OK (rolled back): wallet 115.17 ->
115.42, bank 146706042.23 -> 146706041.98`. Read back afterwards: no key, no
  adjustment, no ledger leg, wallet 115.17.

## Preserved

The pot winner keeps the pot; rake and jackpot drop stand. The migration
compares `lightning_hand` and `lightning_hand_player` for the hand before and
after and aborts if either changed.
