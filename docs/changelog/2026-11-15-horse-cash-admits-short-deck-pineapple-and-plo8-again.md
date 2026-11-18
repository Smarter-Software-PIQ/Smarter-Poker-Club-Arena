# Horse cash admits short deck, pineapple and PLO8 again, at .50/1 or below

## Decision

Owner direction of 2026-11-14 (19:07, 19:10 and 20:42 America/Chicago) requires short deck, pineapple and PLO8 cash, approved variants, to be made operational through the normal game-supply paths, respecting schedules, eligibility and bankroll rules. At 19:22 Chicago the owner delegated every decision to the Phase 1 overwatch ("THERE ARE NO DECISIONS FOR ME, THEY ARE 100% ON YOU TO FIGURE OUT AND HANDLE"). Overwatch decided that this supersedes, for these three variants only, the cash exclusion of the owner order of November 1 (PR #9258, migration `20261102015546_restrict_horse_cash_games_and_cut_schedule_at_midnight`). Everything else in #9258 and its successors stays: the 40 percent cash schedule reduction (and the November 11 tripling of it), the midnight cut, the stake ceiling (NLH and PLO4/5/6 through 1/2, fixed limit through 5/10 blinds, every other variant through .50/1, so these three stay at .50/1 or below), and every human admission, tournament and settlement path. A bounded overwatch builder implemented it.

## What was wrong

The November 1 exclusion was enforced in four places, and any one of them alone kept these games undealt (overwatch diagnosis `CASH-VARIANTS-CAUSE-20261115.md`, read-only, 2026-11-15 03:00Z):

1. `horseCashGameAllowed` (`server/src/services/HorseCashSchedule.ts`) returned false for pineapple, short deck and PLO8 cash.
2. `HorseFleetManager` withheld those tables as `owner_cash_game_restriction` through the same helper, so each game reported 0 eligible Horses and `fn_cash_cluster_tick` kept it dormant.
3. `horseUnionCashTableAllowed` refused them, and `horseUnionCashPlan.json` scheduled none of them.
4. `fn_horse_cash_game_allowed` refused the seat in the database (`fn_ca_horse_roster_seat_guard`, 42501 `horse_cash_game_restricted`).

Result: 0 Horse cash seats and 0 hands in 72 hours for all three variants, while 214 of the 217 Horses on duty in Midway cash carry all three variant tags.

## What changed

- `HorseCashSchedule.ts`: `CASH_VARIANTS_RESTORED_START_MS` (2026-11-15T01:07Z, 19:07 Chicago November 14). The exclusion applies only before it, so November 2 to 14 answers stay what they were. The date is in the past on purpose: Horses are seated only once the engine release carrying this serves. The ceiling is unchanged.
- Migration `20261115032204_horse_cash_admits_short_deck_pineapple_and_plo8_again`: `fn_horse_cash_game_allowed` is rebuilt from production's own definition (md5 `f77febff99f314bdf878f5acc9b18dee`) with the same dated branch, so the server and the database agree at every instant. It refuses any other pre-image (a re-run included), checks owner, ACL, SECURITY INVOKER, IMMUTABLE and search_path before and after, and proves the new answers inside its own transaction.
- `horseUnionCashPlan.json`: one entry per variant on the existing `always` window, the enabled Midway Classic .50/1 games `a7067b2e` (Short Deck), `be58fe80` (Pineapple) and `c1094914` (PLO8), each verified read-only (Midway Union, enabled, Classic, .50/1, not Lightning, one Main 1 table live/waiting).

Horse work hours, daily caps, days off, the curve's seat ceiling, bankroll and buy-in rules, minimum players, must-move and VPIP floors apply unchanged. No forced seating, schedule override, new users or watcher: a game wakes through its own cluster tick once the fleet reports eligible Horses.

## Proof

- `HorseCashSchedule.law.test.ts` and `HorseUnionCashPlan.law.test.ts` pin the new rule (the three variants allowed at or below .50/1 from the owner direction, refused above it and before it, tournaments unchanged, the human exception never lifts them past .50/1, the plan's three Main 1 tables seat Horses around the clock). 11 of the new cases fail against the old source.
- `scripts/qualification/test-cash-half-top-horses.py` (native PostgreSQL 17) installs production's exact pre-image, proves a forced rollback leaves it, installs the migration, drives the real seat trigger in Club and Diamond cash with `fixtures/horse-cash-november/cash-variants-restored-proof.sql`, and proves a re-run is refused. The proof fails against the pre-image (`horse_cash_game_restricted`) and passes after.

## Delivery order

The migration installs on merge (Apply Merged Migration) and must be installed first; hosted checks must be green and the merge is timed by the release custodian (an ordinary migration of an included head merges and installs before the freeze; nothing installs after the freeze until the post-seal Backup copy). The engine release that carries the server and plan change follows through the normal certified engine route. Dealing, legal actions and settlement per variant stay unverified until observed on the serving release. The historical November 2 qualification fixtures (`all-cash-ceiling-proof.sql`, `classic-demand/second-table-before.sql`) are unchanged: they pin what the November 2 and November 10 migrations installed, and the second is the pre-image of `fn_cash_game_second_table_picked`, where these variants are only a rate group.
