# Horse Decisions Regression Method

Owner rule (Dan, November 2026): after any set of fixes, check everywhere for regressions, stubs and wiring gaps, explain why each fixed defect broke, harden it so it cannot come back, and keep this method in the repository and in every handoff.

This is the method the Horse Decisions lane runs after every merge and after every engine seal. Every check is read-only.

## The Eleven Checks

| #   | Check                                                                                                                                                | Pass                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | CI on main                                                                                                                                           | Green on the merge commit                                                                                                                                 |
| R2  | Option laws, `SecondLookIsNotLive`, `HoldemEmpiricalRaisePriors`, `phase10StrengthAssemble` (on a committed tree), registry, ledger and league laws  | All pass                                                                                                                                                  |
| R3  | `npx tsx scripts/gen-horse-option-switch-sql.ts --check`                                                                                             | The whitelist equals the registry                                                                                                                         |
| R4  | OFF parity cases for every dark option                                                                                                               | No action, amount, think time or receipt differs while the option is off                                                                                  |
| R5  | Engine `/health` and release ancestry                                                                                                                | Liveness ok and the merge commit is an ancestor of the serving build                                                                                      |
| R6  | Receipts of every dark option in `horse_brain_telemetry`                                                                                             | Zero while the option is off                                                                                                                              |
| R7  | `ca_horse_style_switch` rows for this lane's options                                                                                                 | None (switching is never this lane's job)                                                                                                                 |
| R8  | `horse_error_log`                                                                                                                                    | Zero new rows                                                                                                                                             |
| R9  | `decide_nlh`, `v17_pos_behind`, `v78` and `v86` receipts, day over day                                                                               | Not collapsed                                                                                                                                             |
| R10 | Daily real-card grade                                                                                                                                | No new Hold'em cash flag                                                                                                                                  |
| R11 | Cash floor and variety drain: run `scripts/sql/variety-drain-live-check.sql` (one read-only statement, every check since the newest shipped release) | Every row PASS or INFO: heartbeats published, no person at a released table, no Horse re-joining a released table, tables within the cap, no Horse errors |

## For Every Fixed Defect

1. State why it broke in one sentence that names the mechanism, not the symptom.
2. Fix it at the root. Never a cron, a watcher or a repair loop that compensates for it.
3. Pin it with a law or test that fails on the old code, and say which one.
4. Look for the state the fix does not reach (rows, tables or processes created before it served) and release that state through an existing door.
5. Record all of the above in the change's own file under `docs/changelog/`.

## Defects This Lane Fixed, And How Each Is Pinned

| Defect                                                                     | Why It Broke                                                                                                                                                    | Hardening                                                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Games with no table never started at a full hourly cap                     | Waiting-list feeders took every freed slot, and the hold that protects owed starts was inactive at a full cap                                                   | `anOwedMainStartsBeforeAnExtraTable.law.test.ts` and the PostgreSQL proof `scripts/ci/test-an-owed-main-starts-before-an-extra-table-postgres.py` |
| Extra tables opened before that fix kept their slots                       | The fleet refilled every seat that emptied; nothing knew an extra table held a slot an owed game needed                                                         | `anExtraTableYieldsToAnOwedMain.law.test.ts`; a failed or partial read releases nothing                                                           |
| Two pull requests that each registered a Horse option overwrote each other | The whitelist was one re-asserted list inside a CHECK constraint, so the later install replaced the earlier one                                                 | The whitelist is rows (`ca_horse_option_whitelist`); `aSwitchListIsNeverStale` and `switchListFreshAtMerge` refuse a new full list                |
| A priced bluff-raise rule priced spots the old rule never covered          | The priced version was applied to every bluff-raise, including all-in shoves and small raises, instead of only the committing non-jam raise the old rule covers | `AV78CommittingBluffRaiseIsPriced.law.test.ts` (reverting the scope fails exactly the new cases)                                                  |
| A zero Short Deck shift was counted as looser                              | The receipt label had two cases, so a shift of zero fell into looser                                                                                            | `AV17ShortDeckIsPriced.law.test.ts`                                                                                                               |
| The priced slowplay used hand-picked numbers                               | A free-card penalty and a bet size were constants, not measurements                                                                                             | `AHorseSlowplayIsPriced.law.test.ts`; the inputs are measured from production bets and documented in the option's authority file                  |

## Two Traps Found While Publishing

- A change that adds a literal `.rpc()` or `.from()` name can pass the local pre-push run and fail on GitHub. The local run has database credentials and asks the live schema; the hosted run on a pull request judges the committed snapshot alone. Run `env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY node scripts/ci/check-phantom-tables.mjs` before pushing, and declare an installed object the snapshot lacks in your own file under `scripts/ci/schema-manifest.d/`.
- A work tree whose `node_modules` is a link into another tree fails the pre-push run the moment that tree is cleaned. Link to a dependency folder the lane owns, installed with `npm ci --ignore-scripts` from main's lockfile.

## The Live Read After Every Seal

Run `scripts/sql/variety-drain-live-check.sql` right after a seal and read it as a whole window, not one row. The 2026-11-26 churn (a released table named, un-named, and re-filled) showed only across heartbeats; the script's `no_rejoin_while_named` and `fresh_releases_in_window` rows catch exactly that. Its first run, on the 7:00 AM CST build of 2026-11-26 (before #12084 served), reported `no_rejoin_while_named` FAIL with 2 re-joins and 6 fresh releases of one table: the defect #12084 fixes.
