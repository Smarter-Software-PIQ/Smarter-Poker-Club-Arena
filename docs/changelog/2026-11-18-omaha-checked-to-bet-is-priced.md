# Omaha: a river or heads-up turn every opponent checked is priced, check beside bet (default OFF)

Date: 2026-11-18. Lane: WooWoo audit repair programme, CHECKED-TO-BET. One new option, off by default (read `=== true`): `omahaCheckedToBetIsPriced`. Nothing changes with it off.

## What was there

When every opponent checked and a Horse closed the action in PLO4/PLO5 cash, a medium, weak or empty hand was almost never bet. Measured in the audit of one winning player: he folded to 140 of 177 heads-up river bets after checking; the Horses checked back air or a weak pair in 35 of 43 such spots; with several opponents they bet such hands 0 of 93 times.

## What changed

New `server/src/engine/HorseOmahaCheckedToBet.ts` (pure) and one site in `HorseLogic.ts` wager_rules, after the strong-hand rule. With the option on, the node's final check on the river (any number of opponents) or the heads-up turn, when every opponent has checked and nobody is all in, is priced beside every bet size: each opponent's checking range from his line, the share that continues from his measured continue rate (the priced read, shrunk to the population by its opportunities), the Horse's exact equity against the hands that continue, the raise priced, the rake taken; with several opponents everyone folds with the product of their fold rates. The bet replaces the check when it is worth more by more than the standard error of the comparison. No hand-class, position or size rule. The owner-ruled checks, the one-pair rules and the draw rules still judge the bet. The flop is not priced here.

Authority file: `docs/horse-option-authority.d/omahaCheckedToBetIsPriced.md`.

## Files

- `server/src/engine/HorseOmahaCheckedToBet.ts`, `HorseOmahaCheckedToBet.test.ts`, `HorseOmahaCheckedToBet.fixture.json` (new).
- `server/src/engine/HorseLogic.ts`: the import, the option, the rule function, its call after `omahaStrongHandValueRule`, the option in `omahaPricingOptionOn`.
- `server/src/engine/HorseDataLedger.ts` (the flag and two receipts), `HorseOmahaRuleSites.ts` (one class row), `HorseReferenceDecisionSources.ts` (one source row), `server/src/benchmark/HorseLeague.ts` (two cards).
- `supabase/migrations/20261118015651_horse_option_switch_omaha_checked_to_bet_is_priced.sql` and the lists of `scripts/ci/test-horse-option-switch-evidence-postgres.sh` (generated; not installed by this lane).
- `docs/OMAHA-RULE-PRECEDENCE.md` (row 16), `docs/horse-option-authority.d/omahaCheckedToBetIsPriced.md`.
