# The post-deploy cashier contract follows the installed successors (2026-11-15)

## What failed

Post-Deploy E2E 43643304336 (engine release a7965514) failed "Certify the live cashier database contract":
`cashier function drift: public.fn_cashier_history_feed(...) expected dad4d92ef739f520d0c512c9950d5c62, got a26c9b5097203fdc0b3109bd649ddec1`.
The contract stops at its first drift. Read against production on 2026-11-15, five pinned functions had moved (the feed moved twice):

| Function                                  | Pinned   | Installed | Changed by                                                                                                                                                                          |
| ----------------------------------------- | -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fn_cashier_history_feed                   | dad4d92e | 553be2e8  | World Hub 20261114174518 (PR #2841), then 20261114171135 (#10834, #10849) to a26c9b50, then 20261115001816 (#10883, about 01:05Z) to 5fb4cd6e, then 20261115011401 (#10894, 01:44Z) |
| fn_cashier_history_page                   | 25db8024 | 9b7963ce  | World Hub 20261114174518                                                                                                                                                            |
| fn_cashier_transaction_history            | 3919f3ef | 0aa3eec4  | World Hub 20261114174518                                                                                                                                                            |
| fn_club_cashier_members_page_v3           | 69233cd4 | b072ac22  | 20261114163238 (#10832)                                                                                                                                                             |
| fn_promo_wallet_send_core_20261004 (body) | 7087a67e | be708b91  | World Hub 20261114174204 (PR #2841)                                                                                                                                                 |

## Cause

Every change is a merged migration that production recorded. GitHub records no review on #2841, #10832, #10834, #10849 or #10883. None of them updated
`scripts/verification-harness/cashier-release-contract.sql`, so the contract kept naming bodies that no longer existed.
Two of the five came from World Hub, which shares the database; its migrations are recorded in that repository.
The implementation and the deployment are correct; the expectation was stale.

## Change

- The five pins name the installed bodies. Each pin keeps its earlier hash in a comment and names the installing migrations.
- The contract now requires the six successor migrations in `supabase_migrations.schema_migrations`, under their recorded names, each with the md5 of the statement production recorded.
- `scripts/ci/fixtures/world-hub-cashier-migrations-20261114.json` keeps World Hub's two migrations byte for byte (commit c085545f, sha256 per file).
- `tests/cashier-authority-exact-intent.test.ts` derives the promo core body from source: the 20261016024912 body, the four 20261112050118 replacements (the earlier pin, still asserted), then World Hub's downline-limit anchor patch. The result is be708b91, the installed body.
- New law `tests/config/cashierContractNamesItsSuccessors.test.ts`: from 2026-11-14 on, a migration here or a recorded World Hub migration that creates, replaces or patches a contract-pinned function must be named in the contract. Removing or commenting out any version check fails it. It sees schema-qualified, unqualified and quoted names, ALTER FUNCTION and pg_get_functiondef patches; it ignores GRANT, REVOKE and COMMENT ON. It counts only real `WHERE version = '<v>'` lines, and every read-only exception must name a real migration with its reason.
- Each World Hub fixture entry records the md5 of the statement production recorded for that version, and of its non-comment lines. The law checks that the fixture's own non-comment lines hash the same, and that the contract pins that recorded statement. The repository bytes and the recorded statement differ only in comments.

No function, grant, policy or record changes. Read-only.

## Verified

- The contract file at this change runs against production (read-only transaction, rolled back) to its final line at 2026-11-15T01:21:25Z: "versions, hashes, ACLs, RLS, triggers and indexes verified". The same run on main stops at the history feed drift.
- The first head (66d31601) was already stale when it was reviewed: #10883 merged five minutes after it was written and moved the feed again. The new law failed on it in PR CI, which is the law working. The independent review (Phase 1 overwatch, fresh-context reviewer) asked for this re-pin.
- `tests/cashier-authority-exact-intent.test.ts`, `tests/config/cashierInstalledWalletContract.test.ts`, `tests/the-cashier-transaction-history.law.test.ts` and the new law pass.

## Limits

This repository cannot see a World Hub migration until it is recorded in a fixture here, and the law cannot see a function name built at run time (format(), concatenation). The post-deploy contract remains the check for both. Only the promo core is derived from source in this repository. The feed, page, transaction-history and members pins are production reads; the reviewer re-derived each one independently from its predecessor pin and migration patches.

The feed moved three times in one evening (#10834/#10849, #10883, #10894), each time without the contract. Until this law is on main, nothing stops the next one; once it is, such a PR fails its own checks.
