# Satellite cash remainders retain their original promo earning source

Satellite b4b67135 reached five qualifiers, then every original terminal request
rolled back with P0002. Production logs place the exception in
fn_ca_promo_profit_bind_earning_ledger, reached from the cohort cash-remainder
credit. Prospective promo activation required a source that this direct payout
had never prepared; only the ordinary obligation payer had that handoff.

The function-only migration prepares the original remainder obligation source
before its existing wallet credit and restores the caller context afterward.
The two source identity validators accept the existing satellite key only for
the complete unpaid satellite_remainder obligation, its exact place and original
source. Ordinary tranche keys, amount/user/tournament identity, credit receipts,
source-slice conservation, missing-source refusals and all financial owners remain
in force. There is no second payer or recurring repair.

The existing PostgreSQL generation proof reproduces the old refusal, verifies the
new exact source and ledger linkage, duplicate/replay behavior, invalid/partial
keys, missing-source failure, context wiring and migration replay. Its existing
full financial companion also installs this migration before running public PKO
and mystery payouts through 31 actual financial triggers. Typed metadata openings
are not a full satellite launch proof; the original production terminal request
must independently complete after protected-main installation, with exact award,
remainder, escrow, source linkage and alert readback before closure.
