# PLO6: the gate for the Omaha strategy options is registered, off-only, and the six-card constants are hooked to it

Date: 2026-11-16. Lane: PLO6 audit. Option `omahaStrategyInPlo6`, off by default (read `=== true`) and OFF-ONLY in the option switch. No decision changes in any game.

## Why

PLO Strategy built one gate for its 2026-11-15 options (`omahaStrategyGameInScope`) and one accessor for their hand-size dependent constants (`omahaStrategyConstant`), and left the option and the six-card values to the PLO6 lane. Until now the option was read through a cast and was in no ledger, no switch list and no authority file, and the PLO6 calibration was read by nothing.

## What changed

- `HorseLogic.ts`: `omahaStrategyInPlo6` is a typed field of `HorseDecideOpts` with its doc comment (what it does and the gaps that keep it off). `HorseLogic.decide` calls `applyPlo6OmahaStrategyCalibration` with the decision's gate before anything else of the decision (one import, one call).
- `HorsePlo6StrategyCalibration.ts`: `PLO6_OMAHA_STRATEGY_ACCESSOR_VALUES` maps each of the accessor's 17 keys to the calibration entry its PLO6 value comes from; `registerPlo6OmahaStrategyCalibration()` registers the keys that differ from the default: `turnRedrawNutFullHouseOnly` 1, `cardImpactDistinctDrawOuts` 1, `bigDrawContinueStraightOuts` 13. `applyPlo6OmahaStrategyCalibration(gateOn)` registers them only for a decision whose gate is on and takes them back otherwise.
- `HorseDataLedger.ts`: the flag row (V94), default off. `HorseOptionSwitch.ts`: off-only (a hold of the PLO6 lane) and release default off. `HorseReferenceDecisionSources.ts`: the calibration file is a reference source now that `HorseLogic` imports it.
- `HorseLeague.ts`: the refused matchup `plo6_omaha_strategy_in_plo6`. The gate alone switches no rule on (seed 20261116, 300 pairs, 0 diverged); a card with the ported options on is owed once the port is complete.
- Option switch whitelist follow-up `supabase/migrations/20261116010600_horse_option_switch_omaha_strategy_in_plo6.sql` (generated; it re-asserts the lists, the option among the off-only names, and switches nothing) and the proof script lists.
- Authority file `docs/horse-option-authority.d/omahaStrategyInPlo6.md`: OFF-ONLY, evidence NOT MET, the gap list.
- `HorseOmahaStrategyGame.ts` (PLO Strategy's file) is not changed.

## Why nothing changes while the option is off

With the option unset or false, `omahaStrategyGameInScope` keeps PLO6 out of every PLO4/PLO5 scope, as before. The six-card constants are not in the accessor during such a decision: `HorseLogic.decide` clears them first. So no reader of `omahaStrategyConstant` can see a PLO6 value with the gate off, and a process in which the option is never on never registers one. This does not rest on each reader's own game gate. One reader does run for a PLO6 hand with the gate off (the bluff-catcher argument in `HorseLogic` computes `omahaTurnRedrawShareOf` before `omahaBluffCatcherCell` refuses the game); it reads the default.

## Why it is off-only

The port is incomplete: no six-card row in `COORDINATED_MAX_GAPS`; `omahaReraisedPremium` too wide for six cards; literal four/five hole-count checks in five modules; the `HorseOmahaReraisedPot` scope not routed through the gate; the four skipped options not excluded; the PLO6 adaptations not hooked; no PLO6 receipt admission. The authority file lists each with its place in the source.

## Tests

`HorsePlo6StrategyRegistration.test.ts` (new): the 17 keys against the calibration; the registered keys; PLO4/PLO5 defaults after the registration; off-only in the registry; unset equals false through `HorseLogic.decide` on five PLO6, two PLO5 and one PLO4 state at eight seeds, with and without the strategy options on; the same decisions before the registration, after it and with the six-card values held through the decision; the accessor inside a gate-off and a gate-on decision; the gate shown live on two PLO6 turn nodes. `LeagueInertMatchupsAreRetiredOrRepointed.test.ts` lists the refused matchup.

## Not done

The port itself: every gap above is open. No evaluation, no league card, no production read.
