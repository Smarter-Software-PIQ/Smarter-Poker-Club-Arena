# Typed promo-wallet legs remain visible to the ledger replay

Both critical handoffs dd614cd2 and db2d4189 report drift incident 7b5937ca.
Its agent promo wallet correctly holds 100 chips. Since the zero baseline of
October 16, ten journal legs net to 100: 270 - 30 - 50 - 100 + 30 - 25 + 35 +
50 - 40 - 40. All three ledger readers dropped the eight unlabelled sides,
including a promo-to-player send, because they required the opposite label to
contain `promo`. Only two labelled ticket debits remained, producing expected
-80 and a fictitious discrepancy of 180.

The source migration resolves a typed `promo_wallet` from its owner without
requiring an unrelated opposite label. Explicit labels still win. A bare
`union_wallet` remains ambiguous and unknown owners remain unkeyable. Snapshot
visibility, account aggregation, permissions and journal rows are unchanged.

The same transaction independently replays the original account window and
requires the observed baseline, incident, erroneous reading, current balance
and corrected journal total to agree exactly. It appends an explained corrected
reading and resolves the source incident through `fn_ca_incident_action`.
It preserves the original reading and moves no chips. Changed evidence aborts
the whole transaction, including the function replacements.

`tests/unit/promoLedgerReaders.pg.test.ts` runs real disposable PostgreSQL. It
reproduces -80 before and 100 after on all three readers, verifies refusal and
rollback on changed function/balance evidence, preserves the original reading,
and checks explicit labels, unknown owners, union ambiguity and function
security metadata. The existing unit-test workflow runs this regression.

Delivery requires protected merge, Apply Merged Migration and actual installed
function hashes, corrected replay and incident readback. Local qualification
alone is not production completion.

Qualification also exposed a test-clock defect in the existing pre-repair
worker regression. Its explicit `Date.now() + 60_000` request overrode the
suite mood-hour pin, passing at 06 UTC and failing at 07 UTC with identical
engine source. The fixture now pins observation and decision clocks to the
existing suite constant. All three real worker cases pass, and every existing
assertion remains. This changes test determinism only, not production strategy.
