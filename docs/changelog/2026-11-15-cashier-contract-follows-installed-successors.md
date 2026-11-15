# The post-deploy cashier contract follows the installed successors (2026-11-15)

## What failed

Post-Deploy E2E 43643304336 (engine release a7965514) failed "Certify the live cashier database contract":
`cashier function drift: public.fn_cashier_history_feed(...) expected dad4d92ef739f520d0c512c9950d5c62, got a26c9b5097203fdc0b3109bd649ddec1`.
The contract stops at its first drift. Read against production on 2026-11-15, five pinned functions had moved:

| Function                                  | Pinned   | Installed | Changed by                                                                |
| ----------------------------------------- | -------- | --------- | ------------------------------------------------------------------------- |
| fn_cashier_history_feed                   | dad4d92e | a26c9b50  | World Hub 20261114174518 (PR #2841), then 20261114171135 (#10834, #10849) |
| fn_cashier_history_page                   | 25db8024 | 9b7963ce  | World Hub 20261114174518                                                  |
| fn_cashier_transaction_history            | 3919f3ef | 0aa3eec4  | World Hub 20261114174518                                                  |
| fn_club_cashier_members_page_v3           | 69233cd4 | b072ac22  | 20261114163238 (#10832)                                                   |
| fn_promo_wallet_send_core_20261004 (body) | 7087a67e | be708b91  | World Hub 20261114174204 (PR #2841)                                       |

## Cause

Every change is a reviewed migration that production recorded. None of them updated
`scripts/verification-harness/cashier-release-contract.sql`, so the contract kept naming bodies that no longer existed.
Two of the five came from World Hub, which shares the database; its migrations are recorded in that repository.
The implementation and the deployment are correct; the expectation was stale.

## Change

- The five pins name the installed bodies. Each pin keeps its earlier hash in a comment and names the installing migrations.
- The contract now requires the four successor migrations in `supabase_migrations.schema_migrations`, under their recorded names, each with the md5 of the statement production recorded.
- `scripts/ci/fixtures/world-hub-cashier-migrations-20261114.json` keeps World Hub's two migrations byte for byte (commit c085545f, sha256 per file).
- `tests/cashier-authority-exact-intent.test.ts` derives the promo core body from source: the 20261016024912 body, the four 20261112050118 replacements (the earlier pin, still asserted), then World Hub's downline-limit anchor patch. The result is be708b91, the installed body.
- New law `tests/config/cashierContractNamesItsSuccessors.test.ts`: from 2026-11-14 on, a migration here or a recorded World Hub migration that creates, replaces or patches a contract-pinned function must be named in the contract. Removing any one of the four version checks fails it.

No function, grant, policy or record changes. Read-only.

## Verified

- The contract file at this change runs against production (read-only transaction, rolled back) to its final line: "versions, hashes, ACLs, RLS, triggers and indexes verified". The same run on main stops at the history feed drift.
- `tests/cashier-authority-exact-intent.test.ts`, `tests/config/cashierInstalledWalletContract.test.ts`, `tests/the-cashier-transaction-history.law.test.ts` and the new law pass.

## Limits

This repository cannot see a World Hub migration until it is recorded in a fixture here. The post-deploy contract remains the check for anything installed before that.
