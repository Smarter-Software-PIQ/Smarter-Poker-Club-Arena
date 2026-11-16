# omahaStrategyInPlo6: authority for the live switch

Status: OFF-ONLY. Registered, default OFF, and it cannot be switched on: the six-card port of the Omaha strategy options is not complete and not reviewed. Evidence NOT MET. No owner order to switch this option on is recorded in this file.

## What it does

It is the game gate of the 2026-11-15 Omaha strategy options, not a rule of its own. On, each PLO4/PLO5 strategy option that is itself ON also acts in PLO6 (six-hole-card Omaha):

- every game-scope gate of those options asks `omahaStrategyGameInScope` (`server/src/engine/HorseOmahaStrategyGame.ts`, PLO Strategy's interface), which admits `plo6` to a PLO4/PLO5 set only when this option is `true`; `HorseLogic.decide` sets that scope from its options for the one decision;
- the six-card constants are registered with `omahaStrategyConstant` for that decision only (`applyPlo6OmahaStrategyCalibration` in `server/src/engine/HorsePlo6StrategyCalibration.ts`, called first in `HorseLogic.decide`): `turnRedrawNutFullHouseOnly` 1, `cardImpactDistinctDrawOuts` 1, `bigDrawContinueStraightOuts` 13. The other fourteen accessor keys read the PLO4/PLO5 value in PLO6 too: the calibration holds the same number for eleven of them and no single number for three (`riverMediumBetRangeFactor`, `eliteContinueMaxPotOdds`, `tournamentPushFoldMaxBB`).

Alone it changes nothing: it switches no option on. Unset or false, PLO6 is outside every one of those scopes, no six-card constant is in the accessor during the decision, and PLO4, PLO5 and PLO6 play exactly as before.

Default OFF in source (read `=== true`). OFF-ONLY in the switch registry (`OPTION_SWITCH_OFF_ONLY` in `server/src/engine/HorseOptionSwitch.ts`): an `on` row is refused by the database list, by the parser (the whole switched set is invalid) and by the decision options. Lifting the hold is a reviewed source change to that map, after the gaps below are closed. Only then can an option-switch row whose note cites this file and its sha256 (`authority: omahaStrategyInPlo6 docs/horse-option-authority.d/omahaStrategyInPlo6.md sha256 <digest>`) switch it on.

## Why it is held: the known gaps (2026-11-16)

Each of these would make a rule wrong or silent for six cards if the gate were opened today.

- `COORDINATED_MAX_GAPS` (`HorseOmahaOopReraisedPot.ts`) has rows for four and five cards only; a six-card hand reads 0 gaps allowed.
- `omahaReraisedPremium` is too wide for six cards (the calibration's `plo6ReraisedPremium` is built and not hooked).
- Literal four/five hole-count checks, which switch the rule off for six cards: `HorseOmahaUnderpair.ts` :189, `HorseOmahaReraisedPot.ts` :229, `HorseOmahaOopReraisedPot.ts` :258, :353 and :415, `HorseOmahaFacingBetEv.ts` :669, `HorseOmahaRiverMediumBetCalls.ts` :99 (lines as of the registering commit).
- The `inScope` of `HorseOmahaReraisedPot.ts` reads its own variant set and is not routed through `omahaStrategyGameInScope`.
- The four options the PLO6 port skips (`plo6StrategyOptionVerdict`: `omahaRiverNutBlockerBluffReachable`, `omahaReraisedFoldVsTight`, `omahaEliteContinuesVsMeasuredWideThreeBettor`, `omahaSmallBlindSteal`) are not yet excluded from PLO6 under this gate.
- The PLO6 adaptations (the fourteen `adapt` verdicts of `plo6StrategyOptionVerdict`, among them the M1 river fold test, the M1 medium-bet bars, the nut-class-only strong hand and the straight-or-better arm of the paired-board fold) are built as functions in the calibration file and not hooked to the rules.
- The receipt validator does not admit PLO6 to the day's admissions (`OMAHA_STRATEGY_GAME_SCOPE_ADMISSION.plo6` is `false`), so a worker decision changed by a ported rule would not be admitted.

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
