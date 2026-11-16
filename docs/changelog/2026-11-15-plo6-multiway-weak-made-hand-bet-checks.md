# PLO6: a multiway bet with a weak made hand and no draw becomes a check (opt-in, default off)

Date: 2026-11-15. Lane: PLO6 audit. New option `plo6NoMultiwayBetWithWeakMadeHand`, off by default (read `=== true`), registered in the option switch and switchable live. Nothing changes for any table until it is switched on.

## Why

The PLO6 human-table sweep (five days, 912 cash hands with a person seated) ranked one family first: the Horse bets the flop or turn into two or more opponents with an underpair or bottom two pair and no real draw (family D2: 45 bets, hand net -1,005.5 bb). None of the PLO4/PLO5 options addresses it, and those options do not act in PLO6.

## What changed

- `server/src/engine/HorsePlo6MultiwayWeakBet.ts` (the rule and its measurement) and `HorsePlo6StrategyCalibration.ts` (six-card constants; nothing reads it yet) were built earlier today; this change wires the first into the brain.
- `HorseLogic.ts`: `plo6MultiwayWeakBetRule` runs first in `omahaOwnBetRules`, with the owner-ruled own-bet checks, on both decision paths. PLO6 high, one board, no bomb pot, not all-in-or-fold, cash and tournaments, flop or turn, nothing to call, two or more live opponents, a pair below the top card of the board, two pair without the top card (bottom two pair on the flop) or the board's pair with such a pair, no nut flush draw, under eight straight outs, under four nut-straight outs and no flush draw with four or more straight outs, not nut class: the bet becomes a check. `omahaOwnerRuledFinal` keeps that check when a later rule proposes a bet (receipt `omaha_owner_ruled_check_kept`).
- Receipt `plo6_multiway_weak_made_hand_bet_checked`; flag and receipt in `HorseDataLedger.ts` (V94); `HorseReferenceDecisionSources.ts` entry for the module.
- `responseValidation.ts`: a `wager_rules` bet, raise or all-in that became a check is admitted in PLO6, and with the request only where the spot re-run on it holds.
- Option switch whitelist follow-up `supabase/migrations/20261116010600_horse_option_switch_omaha_strategy_in_plo6.sql` (generated; it re-asserts the lists and switches nothing) and the proof script lists.
- League card `plo6_no_multiway_bet_with_weak_made_hand` (six seats, production personas, 6,000 pairs): it only measures. A 600-pair reach check (seed 20261115) diverged in 14 pairs (14 again after the pre-review fixes); with the Hybrid baseline it diverged in none, so the card uses the production personas.
- Authority file `docs/horse-option-authority.d/plo6NoMultiwayBetWithWeakMadeHand.md`: built, OFF, unevaluated; switching ON needs recorded authority.

No PLO4 or PLO5 decision changes: the rule returns the decision it was given outside PLO6. With the option unset or false the brain plays exactly as before.

## Evidence

Development evidence only, not an evaluation: the option would have removed 62 bets in 59 hands, hand net -1,706.9 bb (lost 43 hands -2,089.9 bb, won 16 hands +383.0 bb, 5.46 to 1; flop 42 bets -1,259.6 bb, turn 20 bets -493.5 bb), in 912 hands over five days with 7 persons, one of them in 667 of the hands. Whole-hand results, no counterfactual, and the conditions were chosen on the same hands. The full table and its limits are in the authority file and in the evidence archive (`plo6-audit-01TLQer9Hdf/phase1-play/plo-port-20261115/MULTIWAY-WEAK-BET-WIRING.md`).

## Pre-review fixes (same day, before any push)

An independent review of the branch found two poker faults in the rule and several notes; all are fixed here and the evidence is re-measured on the same 912 hands.

- A combo draw keeps the bet: a flush draw of any rank together with four or more straight outs now counts as a qualifying draw. The engine's straight-out count leaves out a straight card that also makes a flush, so an underpair with an open-ended straight draw and a second-nut flush draw read six straight outs and was checked. In the window this keeps 3 bets (+15.6 bb).
- Two pair is one class on both streets: on the turn any two pair that does not hold the board's top rank is weak, so a flop bottom two pair is not spared by a blank turn card. The flop definition is unchanged. In the window this removes 3 more turn bets (-305.1 bb, all three hands lost).
- Before the fixes the numbers were 62 bets in 58 hands, -1,403.7 bb (4.33 to 1). The fixes were decided on the poker, not chosen on these numbers; 3 bets a side is too few to judge them.
- Notes: the `omaha_owner_ruled_check_kept` ledger description names the PLO6 rule; three calibration entries (`OMAHA_OOP_TURN_TOKEN_PRICE`, `omahaStrongHandNow`, `OMAHA_WIDE_RERAISE_MIN_RATE`) are labelled `kept_plo5_unmeasured` because no PLO6 measurement file backs them; a unit case tests the rule's own game-name check alone; the authority file states that an all-in opponent counts as live.

## The overpair class (same day, measured before it was built)

The sweep work had also found, and not built, bare overpair bets multiway. They were measured on the same 912 hands with the same method and the module's own functions, against a bar stated before the cells were read: build only if the removed set loses at least 2.0 to 1 on at least 20 bets, and no cell of 8 or more bets known at the decision has a ratio under 1.0.

- Measured: a multiway flop or turn bet with a pocket pair above the top card of an unpaired board and no qualifying draw: 28 bets in 26 hands, hand net -1,008.2 bb (lost 15 hands -1,406.3 bb, won 11 hands +398.1 bb, 3.53 to 1). Aces 11 bets -419.5 bb, kings 10 bets -466.6 bb, queens or lower 7 bets -122.0 bb; two opponents 16 bets -891.3 bb, three or more 12 bets -116.9 bb. The bar is met with no exclusion.
- The same overpairs with a qualifying draw won (16 bets, +276.3 bb): the draw test keeps them.
- Built: `plo6WeakMadeHand` returns a sixth class, `overpair`. Same spot, same draw exemptions, same nut-class exclusion. An overpair on a paired board is not in the class (4 bets, +257.1 bb), and heads-up stays out (27 bets, +213.3 bb).
- The option now removes 90 bets in 85 hands, hand net -2,715.1 bb (lost 58 hands -3,496.2 bb, won 27 hands +781.1 bb, 4.48 to 1; flop 68 bets -2,267.8 bb, turn 22 bets -722.9 bb). The Evidence section above gives the five classes without the overpair.
- This is not PLO Strategy's `omahaBareOverpairOopFlopCheck`: that option is PLO4 and PLO5 cash, the flop only, the Horse the last preflop aggressor and out of position. This class is PLO6, flop and turn, two or more opponents, any position.
- With the option off nothing changes; no PLO4 or PLO5 decision changes. The league reach count was not re-run. 25 of the 28 bets were against the same one person: a screen, not an evaluation.

## Tests

`HorsePlo6MultiwayWeakBetWiring.test.ts` (through `HorseLogic.decide`, invented cards): unset equals false at every seed and no receipt; on, every bet in the spot becomes a check and the receipt fires once per bet; unchanged heads-up, in PLO5, facing a bet, with the nut flush draw and with a nut-class hand; a later rule's bet does not stand. `responseValidation.test.ts`: the admitted and refused transitions. `HorsePlo6MultiwayWeakBet.test.ts`: the overpair checked three-way with no draw on the flop and the turn, kept heads-up, kept with each qualifying draw, not in the class on a paired board; a set, top pair and top two pair untouched.

## Not done

No evaluation, no league run, no production read. The value, continuation and reach rows are NOT MET.
