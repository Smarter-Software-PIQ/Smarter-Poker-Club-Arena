# PLO6: a multiway bet with a weak made hand and no draw becomes a check (opt-in, default off)

Date: 2026-11-15. Lane: PLO6 audit. New option `plo6NoMultiwayBetWithWeakMadeHand`, off by default (read `=== true`), registered in the option switch and switchable live. Nothing changes for any table until it is switched on.

## Why

The PLO6 human-table sweep (five days, 912 cash hands with a person seated) ranked one family first: the Horse bets the flop or turn into two or more opponents with an underpair or bottom two pair and no real draw (family D2: 45 bets, hand net -1,005.5 bb). None of the PLO4/PLO5 options addresses it, and those options do not act in PLO6.

## What changed

- `server/src/engine/HorsePlo6MultiwayWeakBet.ts` (the rule and its measurement) and `HorsePlo6StrategyCalibration.ts` (six-card constants; nothing reads it yet) were built earlier today; this change wires the first into the brain.
- `HorseLogic.ts`: `plo6MultiwayWeakBetRule` runs first in `omahaOwnBetRules`, with the owner-ruled own-bet checks, on both decision paths. PLO6 high, one board, no bomb pot, not all-in-or-fold, cash and tournaments, flop or turn, nothing to call, two or more live opponents, a pair below the top card of the board, bottom two pair or the board's pair with such a pair, no nut flush draw, under eight straight outs and under four nut-straight outs, not nut class: the bet becomes a check. `omahaOwnerRuledFinal` keeps that check when a later rule proposes a bet (receipt `omaha_owner_ruled_check_kept`).
- Receipt `plo6_multiway_weak_made_hand_bet_checked`; flag and receipt in `HorseDataLedger.ts` (V94); `HorseReferenceDecisionSources.ts` entry for the module.
- `responseValidation.ts`: a `wager_rules` bet, raise or all-in that became a check is admitted in PLO6, and with the request only where the spot re-run on it holds.
- Option switch whitelist follow-up `supabase/migrations/20261115221700_horse_option_switch_plo6_multiway_weak_bet.sql` (generated; it re-asserts the lists and switches nothing) and the proof script lists.
- League card `plo6_no_multiway_bet_with_weak_made_hand` (six seats, production personas, 6,000 pairs): it only measures. A 600-pair reach check (seed 20261115) diverged in 14 pairs; with the Hybrid baseline it diverged in none, so the card uses the production personas.
- Authority file `docs/horse-option-authority.d/plo6NoMultiwayBetWithWeakMadeHand.md`: built, OFF, unevaluated; switching ON needs recorded authority.

No PLO4 or PLO5 decision changes: the rule returns the decision it was given outside PLO6. With the option unset or false the brain plays exactly as before.

## Evidence

Development evidence only, not an evaluation: the option would have removed 62 bets in 58 hands, hand net -1,403.7 bb (lost 41 hands -1,825.9 bb, won 17 hands +422.2 bb, 4.33 to 1), in 912 hands over five days with 7 persons, one of them in 667 of the hands. Whole-hand results, no counterfactual, and the conditions were chosen on the same hands. The full table and its limits are in the authority file and in the evidence archive (`plo6-audit-01TLQer9Hdf/phase1-play/plo-port-20261115/MULTIWAY-WEAK-BET-WIRING.md`).

## Tests

`HorsePlo6MultiwayWeakBetWiring.test.ts` (through `HorseLogic.decide`, invented cards): unset equals false at every seed and no receipt; on, every bet in the spot becomes a check and the receipt fires once per bet; unchanged heads-up, in PLO5, facing a bet, with the nut flush draw and with a nut-class hand; a later rule's bet does not stand. `responseValidation.test.ts`: the admitted and refused transitions.

## Not done

No evaluation, no league run, no production read. The value, continuation and reach rows are NOT MET.
