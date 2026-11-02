# Finish guarantees created during the engine deployment delay

The serving old engine continued creating tournaments after the November 2
06:00 UTC policy cutoff while the replacement was blocked. Seven captured
instances still carry their original guarantee: five at 500 and two at 250.
The permanent fresh-instance policy is already merged in
`server/src/services/TournamentGuaranteePolicy.ts`; existing captures cannot
cover rows that did not yet exist.

Apply the already authorized 50% reduction only to these exact instance IDs,
schedule identities and original amounts. Preserve entered, locked, finalized,
running and pre-cutoff contracts. Existing nightly 10K, rounded 1.5K,
Six-Card 500 and 200-entry/25K guarantees and every unrelated row remain intact.
The migration cannot halve an already reduced value or affect later instances.
No wallet, payout, tournament participation or schedule is modified.

Extend the existing native PostgreSQL qualification in
`scripts/qualification/test-cash-half-top-horses.py` with live-proof false before
installation, true afterward, accurate text, repeat application, complete
unchanged-board comparison, and entered/locked/finalized/running/cutoff/schedule
mismatch preservation under the actual registered-contract trigger.

Validation: native PostgreSQL 17 qualification passed for the exact migration,
including all prior cash/guarantee assertions. Root TypeScript passed. The
final cutover capture and protected delivery remain pending; no production
installation is claimed by this source change.
