# omahaStrategyInPlo6: authority for the live switch

Status: OFF-ONLY. Registered, default OFF, and it cannot be switched on: the six-card port of the Omaha strategy options is not complete and not reviewed. Evidence NOT MET. No owner order to switch this option on is recorded in this file.

## What it does

It is the game gate of the 2026-11-15 Omaha strategy options, not a rule of its own. On, each PLO4/PLO5 strategy option that is itself ON also acts in PLO6 (six-hole-card Omaha):

- every game-scope gate of those options asks `omahaStrategyGameInScope` (`server/src/engine/HorseOmahaStrategyGame.ts`, PLO Strategy's interface), which admits `plo6` to a PLO4/PLO5 set only when this option is `true`; `HorseLogic.decide` sets that scope from its options for the one decision;
- the six-card constants are registered with `omahaStrategyConstant` for that decision only (`applyPlo6OmahaStrategyCalibration` in `server/src/engine/HorsePlo6StrategyCalibration.ts`, called first in `HorseLogic.decide`): `turnRedrawNutFullHouseOnly` 1, `cardImpactDistinctDrawOuts` 1, `bigDrawContinueStraightOuts` 13. The other fourteen accessor keys read the PLO4/PLO5 value in PLO6 too: the calibration holds the same number for eleven of them and no single number for three (`riverMediumBetRangeFactor`, `eliteContinueMaxPotOdds`, `tournamentPushFoldMaxBB`).

Alone it changes nothing: it switches no option on. Unset or false, PLO6 is outside every one of those scopes, no six-card constant is in the accessor during the decision, and PLO4, PLO5 and PLO6 play exactly as before.

Default OFF in source (read `=== true`). OFF-ONLY in the switch registry (`OPTION_SWITCH_OFF_ONLY` in `server/src/engine/HorseOptionSwitch.ts`): an `on` row is refused by the database list, by the parser (the whole switched set is invalid) and by the decision options. Lifting the hold is a reviewed source change to that map, after the gaps below are closed. Only then can an option-switch row whose note cites this file and its sha256 (`authority: omahaStrategyInPlo6 docs/horse-option-authority.d/omahaStrategyInPlo6.md sha256 <digest>`) switch it on.

## Why it is held (2026-11-16, after the six-card port was written)

The six-card port is written on this branch and is NOT yet reviewed by PLO Strategy (the owner of the modules it touches) or by Hand Analysis. The hold stays until both accept it and the items under "Still owed" are closed.

Written, each a PLO6-only branch reached only with this gate on (gate off, PLO4 and PLO5 are unchanged):

- Re-raised pots (`HorseOmahaOopReraisedPot.ts`, `HorseOmahaReraisedPot.ts`): six cards read the calibration's premium class (`plo6ReraisedPremium`) and coordination (`plo6OopCoordinated`, three gaps: `COORDINATED_MAX_GAPS_PLO6`); the hole-count checks admit exactly six cards for PLO6; the preflop cell's scope goes through `omahaStrategyGameInScope`. The postflop stack-off cell stays PLO4/PLO5 (its options are not in the catalogue).
- Pricing (`HorseOmahaUnderpair.ts`, `HorseOmahaFacingBetEv.ts`, `HorseOmahaRiverMediumBetCalls.ts`, glue in `HorsePlo6PricingPort.ts`): the underpair rule admits six cards at the PLO5 constants (unmeasured for six cards); the facing-bet EV rule admits six cards on the river only, cash only, no bomb pot, and the measured river fold test (`plo6FacingBetEvFoldStands`) stands over an EV call; the river medium-bet call uses the six-card beaten-share bars (`plo6RiverMediumBetCalls`), cash only, no bomb pot.
- Skipped options never act in PLO6, gate on or off: `omahaRiverNutBlockerBluffReachable`, `omahaEliteContinuesVsMeasuredWideThreeBettor`, `omahaReraisedFoldVsTight`, `omahaSmallBlindSteal`, and `omahaReraisedPotDiscipline` (not a catalogue option).
- Adaptations hooked: the paired-board fold and the measured river fold test in the river-plan look-ahead (`omahaRiverShoveFoldVerdict`, verdict `plo6_river_m1`) and in the street-plan call veto; the paired-board price exception is arm (a) only; a strong hand for value is nut class only (`plo6StrongHandForValue`); the out-of-position re-raised strong range stands aside against a measured (not presumed) maniac raiser.
- Validator (`horseDecision/responseValidation.ts`): PLO6 is admitted to the day's admissions only when the receipt context carries `omahaStrategyInPlo6 === true`; without it the path is the old one. `HorseOmahaStrategyGame.ts` is not changed.

Still owed before the hold may be lifted:

- PLO Strategy's acceptance of the lines in its modules and Hand Analysis's review.
- Behavioural tests for the three preflop changes (the two skipped re-raise callers and the maniac stand-aside): today they are pinned by source only, because the recorded PLO6 fixture has no preflop node.
- Whole-decision timing for six cards with the options on. Measured on one recorded node, four seeds, not a benchmark: the river plan about 60 to 95 ms per decision (2 to 3 ms when it does not run), the street plan about 150 to 195 ms with the river fold test in the veto (about 95 ms without).
- The validator client knows the gate from the request options only. If the gate is ever driven by a live switch row, the client must pass the switched value; that belongs to the change that lifts the hold.
- The validator's replay takes the PLO6 river fold options (V58, V59) as on; a decision made with either off would replay differently (the same limit the existing fields have).
- A league card with the ported options on in both arms, and the value, continuation and reach rows.

## The specifications

In the PLO6 evidence archive, `agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/phase1-play/plo-port-20261115/`:

- SPEC-A (options 3.1 to 3.16, helpers H1 to H26, measured inputs M1 to M5);
- SPEC-B (options 3.17 to 3.31, helpers H27 to H39, counts N1 to N3);
- `SWEEP-PLO6.md` (the PLO6 human-table sweep);
- `TIMING-PLO6.md` (the six-card timing).

## The owner's orders it rests on (cited by file, not quoted)

- The owner's order of 2026-11-15 13:16 America/Chicago to share the day's Omaha strategy work with PLO6: recorded in the header of `server/src/engine/HorseOmahaStrategyGame.ts`.
- Owner orders to the PLO6 lane, 2026-11-15 13:37 and 15:42 America/Chicago (bring the PLO Strategy work to PLO6; build what is unfinished): recorded in the PLO6 archive checkpoint, `agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/CHECKPOINT.md`.
- The owner's principles of 2026-11-15 for the Omaha strategy work: `agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md`.

None of these is an order to switch this option on. That order, when given, is recorded here with its time before the hold is lifted.

## Receipts

None of its own. The rules it would admit to PLO6 fire their own receipts.

## Tests

`HorsePlo6StrategyRegistration.test.ts`: the seventeen accessor keys against the calibration entries; what is registered is exactly the three keys that differ; PLO4, PLO5 and other games read the defaults after the registration; the option is off-only (an `on` row refused by the registry, the parser and the decision options); through `HorseLogic.decide`, unset equals false byte for byte on five PLO6, two PLO5 and one PLO4 state at eight seeds, with and without the strategy options on; the same states decide the same before the registration, after it and with the six-card values held in the accessor through the decision; inside a gate-off decision the accessor holds no PLO6 value; on two PLO6 turn nodes the gate is shown live (on, with the strategy options on, the decision changes; alone it changes nothing). `LeagueInertMatchupsAreRetiredOrRepointed.test.ts` lists the refused matchup. `HorseOmahaStrategyGame.test.ts` and `HorseOmahaSixCardHelpers.test.ts` (PLO Strategy's interface tests) pass unchanged.

## Evidence rows

- Mechanism, scope, visibility (flag in `HorseDataLedger.ts`): MET for the gate and the registration; NOT MET for the port (the gaps above).
- Option unset or false: the decision is identical to the base on the test's states at every seed. The lane's decision-digest pin on PLO6 cells is not recorded here.
- Value: NOT MET. Nothing was evaluated.
- Continuation: NOT MET.
- Reach: NOT MET. League: the refused matchup `plo6_omaha_strategy_in_plo6` (the gate alone; seed 20261116, 300 pairs, 0 diverged). A card with the ported options on in both arms is owed once the port is complete.

## Limits

- The three registered values are closed-form or class changes from the specifications; none has been measured as strategy in PLO6.
- The test's states are three synthetic flop nodes and two recorded turn nodes dealt a sixth card; they do not reach every reader of the accessor. The off-identity does not rest on them: with the gate off nothing is registered during the decision.
- The specification files are cited from the archive by the names the calibration file uses; they were not re-read for this change.
