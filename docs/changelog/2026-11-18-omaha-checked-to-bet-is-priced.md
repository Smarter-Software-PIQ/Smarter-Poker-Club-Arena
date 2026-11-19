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

## v2 (2026-11-18, lane OFFENCE; REDESIGN-PLAN section 2)

The v1 arithmetic FAILED its declared efficacy bar (repairs/CHECKED-TO-BET/LANE-REPORT.md). v2 changes two inputs and the scope, nothing keyed to a hand class, position, size or account:

- River only. The turn is priced as a whole line by the street plan, which this arithmetic lacks; on the turn the option now returns the decision it was given.
- The showdown share in EV(check) is the card-impact share against the checking range with the opponent's KIND prior read, mapped through a logistic calibration fitted by maximum likelihood on production river spots (2026-11-01..2026-11-15, read-only export, 814 spots where a Horse acted heads-up after the check; persons n 414, Horses n 400): archive repairs/CHECKED-TO-BET/v2/FIT-TABLE.md. The slope is about 0.35: the raw model was about three times too confident in logit at both ends (model 0.0-0.1 won 25% against persons; 0.9-1.0 won 86%).
- The equity against the hands that continue (the bet's called branch) is calibrated the same way on the 144 called river bets of the same export (v2/FIT-CE.md, pooled: each kind under 100). The value flag is "calibrated continue equity above one half".
- Both fits' errors (delta method) and the model's sample error through the map join the standard error the bet must clear.
- Precedence unchanged: omahaOwnerRuledFinal still re-checks a priced bet where an owner-ruled check, the made-hand defence or the street plan checks (REDESIGN-PLAN asks for an integrator ruling; this lane made none).
- No option-switch migration on this branch (the integrator regenerates one whitelist follow-up for the batch); the v1 text above that names migration 20261118015651 is superseded.
  Evaluation: declared v2 (repairs/CHECKED-TO-BET/EVAL-DECLARATION-v2.md, sha256 4be1edb155f1...; amendment 1 sha256 734ae2dbd3df..., both before any run). Result: see the section added after the run.

v2 evaluation: FAIL (adverse cell 6 non-value bets; reach 35 of 72, bar 36). Calibration, value, scope, identity and preserve bars pass. The option stays OFF.
