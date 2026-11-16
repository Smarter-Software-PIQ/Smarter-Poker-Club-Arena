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

- Re-raised pots (`HorseOmahaOopReraisedPot.ts`, `HorseOmahaReraisedPot.ts`): six cards read the calibration's premium class (`plo6ReraisedPremium`) and coordination (`plo6OopCoordinated`, three gaps: the calibration entry `COORDINATED_MAX_GAPS`); the hole-count checks admit exactly six cards for PLO6; the preflop cell's scope goes through `omahaStrategyGameInScope`. The postflop stack-off cell stays PLO4/PLO5 (its options are not in the catalogue).
- Pricing (`HorseOmahaUnderpair.ts`, `HorseOmahaFacingBetEv.ts`, `HorseOmahaRiverMediumBetCalls.ts`, glue in `HorsePlo6PricingPort.ts`): the underpair rule admits six cards at the PLO5 constants (unmeasured for six cards); the facing-bet EV rule admits six cards on the river only, cash only, no bomb pot, and the measured river fold test (`plo6FacingBetEvFoldStands`) stands over an EV call; the river medium-bet call uses the six-card beaten-share bars (`plo6RiverMediumBetCalls`), cash only, no bomb pot.
- Skipped options never act in PLO6, gate on or off: `omahaRiverNutBlockerBluffReachable`, `omahaEliteContinuesVsMeasuredWideThreeBettor`, `omahaReraisedFoldVsTight`, `omahaSmallBlindSteal`, and `omahaReraisedPotDiscipline` (not a catalogue option).
- Adaptations hooked: the paired-board fold and the measured river fold test in the river-plan look-ahead (`omahaRiverShoveFoldVerdict`, verdict `plo6_river_m1`) and in the street-plan call veto; the paired-board price exception is arm (a) only; a strong hand for value is nut class only (`plo6StrongHandForValue`); the out-of-position re-raised strong range stands aside against a measured (not presumed) maniac raiser.
- PLO6 tournaments stay out (SPEC-A 3.15 item 6), also with `omahaStrategyInTournaments` on: the tournament extension never holds for six cards (`omahaTournamentExtensionSpot`), so every cash-scoped rule stands aside there and no survival premium is priced. PLO4/PLO5 tournaments are unchanged.
- The facing-bet EV guard is off where the live river fold rule is off: the paired-board test with `v58Plo6RiverNuts` false, the unpaired-board test with `v59Plo6RiverUnpaired` false, as the two plan hooks read them.
- Validator (`horseDecision/responseValidation.ts`): PLO6 is admitted to the day's admissions only when the receipt context carries `omahaStrategyInPlo6 === true`; without it the path is the old one. A PLO6 fold-to-call by the facing-bet EV rule is admitted only when the rule's six-card guard, re-run on the request, does not stand. `HorseOmahaStrategyGame.ts` is not changed.
- The five catalogue options with no new six-card branch are shown by test to behave as the specification says with the gate on (`HorsePlo6StrategyPortRemaining.test.ts`): 3.4 `omahaBigDrawAggression` (a 13+ out wrap continues, accessor key registered 13), 3.11 `omahaCardImpact` (distinct live draw outs, key registered 1), 3.16 `omahaBluffCatcherFoldVsValueLeader` (a six-card hand reaches the cell, only with the gate), 3.17 `omahaMadeHandDefenseVsValueLeader` (PLO4/PLO5 scope through the gate, cash only, never a bomb pot), 3.31 `omahaSmallBlindSteal` (four and five cards only).
- No six-card rule turns into a call a hand the live river fold rule folds: the medium-bet call and the facing-bet EV rule run after that rule and price on the exact count, so both also ask the live rule's own test (`plo6RiverLiveFoldStands` in `HorseLogic.ts`: its switches, its seeded 20,000-sample share, its price) before a call stands. The river-plan look-ahead and the street-plan veto read that same sampled share on purpose: they predict what the river decision will do.
- The six-card constants are in the accessor only inside a gate-on decision or validation: `HorseLogic.decide` and the validator put back what the accessor held before (safe for a decide entered inside another decide).
- Validator and the live switch: the switch delivers its value inside the worker, so the client validates under the gate values the worker may have run (`omahaStrategyInPlo6GateCandidates`): the row in the configuration the client last delivered to that worker, then the request's own option when it differs (a worker whose configuration aged out runs the release default). While the option is off-only an `on` row makes the whole switched set invalid and nothing is switched.
- Lightning: a Lightning PLO6 cash table is a PLO6 cash table for the multiway weak-bet rule and for the port (tested; no port module reads the table speed, and the Lightning participation rules are preflop and Hold'em / PLO4 / PLO5 only).
- League card `plo6_omaha_strategy_six_card_port`: the 27 ported options on in both arms, the gate on in arm A, six seats, production personas. Not yet measured: a first run (seed 20261116, 150 pairs) had not finished after 22 minutes at machine load 22; the diverged-pair count and the bb/100 difference are owed.

Still owed before the hold may be lifted:

- PLO Strategy's acceptance of the lines in its modules and Hand Analysis's review.
- Whole-decision timing is measured, and two paths are slow enough to need a decision before the hold is lifted. Measured 2026-11-16 on the recorded PLO6 nodes of `HorsePlo6StrategyPortHooks.test.ts` (one recorded hand dealt as PLO6), 24 seeded random six-card hands per node, each decided once per arm with the gate-on arm first (cold caches), one process, 28 cores at load average 22 to 24 (other lanes' gates running), so the figures are upper bounds for this machine state. Median / 95th percentile / maximum per decision in milliseconds; base = no option, off = the 27 ported options on with the gate off, on = the same with the gate on:

  | node | base | off | on | actions changed by the gate |
  | --- | --- | --- | --- | --- |
  | flop, checked to | 1.5 / 2.3 / 2.3 | 1.6 / 2.8 / 3.4 | 2.1 / 2.9 / 64.8 | 0 of 24 |
  | flop, facing a bet | 2.2 / 2.7 / 3.0 | 2.4 / 3.1 / 3.1 | 2.6 / 4.1 / 10.2 | 2 of 24 |
  | turn, first to act, paired board | 1.9 / 2.3 / 2.6 | 2.1 / 2.6 / 2.7 | 2.3 / 3.7 / 8.6 | 24 of 24 |
  | turn, first to act, unpaired board | 2.1 / 2.7 / 2.8 | 2.3 / 3.0 / 4.4 | 3.6 / 322.9 / 371.8 | 18 of 24 |
  | river, checked to | 1.8 / 2.7 / 4.5 | 2.2 / 3.4 / 3.4 | 9.1 / 22.9 / 25.0 | 2 of 24 |
  | river, facing an all-in | 1.8 / 4.2 / 4.4 | 2.6 / 5.1 / 5.3 | 71.8 / 139.4 / 146.7 | 0 of 24 |

  The two slow paths: the exact six-card count facing a river wager (about 70 ms, up to about 150 ms) and the turn plan's river look-ahead when it runs (up to about 370 ms). Not measured: an idle machine, a worker under live load, the validator's replay of the same rules on the main thread.
- The validator's replay takes the PLO6 river fold options (V58, V59) as on; a decision made with either off would replay differently (the same limit the existing fields have).
- The value, continuation and reach rows: NOT MET. The league card above only measures; a full-size run and a human-table sample are owed.
- From the independent pre-review of the port (archive `followup/review-plo6-six-card-port/PRE-REVIEW.md`, ACCEPT WITH NOTES, nothing blocking), open with the gate on only:
  - the validator re-runs the EV rule's six-card guard with both river fold tests on (the request does not carry V58/V59): an EV call made with one of them off, on a board whose test would stand, is refused;
  - the validator's replay cost for six cards on the main thread is not measured;

## Measured 2026-11-16 (archive `phase1-play/plo-port-20261115/FRESH-SAMPLE-20261116.md`)

- The six-card turn stays closed for the facing-bet EV rule (`PLO6_FACING_BET_EV_TURN = false`) because SPEC-A 3.12 defines the six-card rule and its fold guard for the river only, not because of cost: on this head a six-card turn count takes about 3 ms (median; p95 about 4 to 6 ms at machine load 20 or more), with the exact count of `HorsePlo6FastCount.ts`. The 0.8 to 1.1 s of `TIMING-PLO6.md` was measured before the counter was rewritten. Opening the turn needs a measured turn guard.
- Constants carried from PLO5: of the 54 flagged unmeasured, the few that persons' own play can measure sit inside their 95% interval, except the big-draw prior fold-to-bet (0.42 kept; measured 0.376, interval 0.339 to 0.415) and the assumed bet size (0.66 pot kept; persons' median 0.95 / 0.80 / 0.75 flop / turn / river). One person is about 40% of that sample, so no value is changed on it.
- No evidence supports pricing a presumed (not measured) maniac: 20 decisions in 8 hands against one person, result of a call not computable.

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
