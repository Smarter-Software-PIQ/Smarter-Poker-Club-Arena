# Omaha: the flop facing-bet verdict counts the field together and takes its realization from production calls (default OFF)

Date: 2026-11-18. Lane: PLO Strategy. Option `omahaFlopFacingBetEv` (PR #11210, default OFF, read `=== true`). Nothing is switched on by this change, and with the option unset or false every decision is byte-identical. No new option and no migration.

## What was there

The first cut of the flop verdict merged with an unfavourable cross-check against one winning player's audited decisions. Looked at node by node (archive `plo-handoff-review-01a1cbbd/flopev-01BNteGZ/FLOPEV-AUDIT-DISAGREEMENT-RESOLUTION-20261117.md`), two causes stood out:

- the field: a caller, or a player still to act, multiplied the win share by a separate "must also beat him" share (0.41 to 0.89), a player behind added none of his call to the pot, and the realization was capped at 0.85. Sets were folded;
- the realization of hands that are not made hands was carried from the turn's rows (0.72 to 0.88), unmeasured.

## What changed (`server/src/engine/HorseOmahaFlopFacingBetEv.ts`)

- THE FIELD is counted on the same runouts as the bettor: a caller's hand must be beaten together with the bettor's; a player still to act folds, or continues with his call in the pot and his hand to beat, at the continue rate measured for a bet of that share of the pot. The 0.85 cap is gone.
- REALIZATION is the runout model corrected by what production flop calls returned, by hand class (two pair or better, a draw, one pair or less) and position: 1,923 calls from 9,974 PLO4/PLO5 cash hands with a person seated, read-only. Each cell is shrunk toward the model by its sample size. One pair or less is cut most (multipliers 0.73 in position, 0.80 out); made hands out of position 0.88.
- THE SAMPLE: a pool four times larger and a balanced set of runouts; the sampling error of EV is measured (median 1.3% of the pot against a margin of 2%).
- A bet after the preflop raiser checked is a stab (factor 0.9), told from a lead into him (0.8).
- The step at a tenth of the pot left behind is a straight line from nothing behind to a pot behind.
- `horseDecision/responseValidation.ts`: the flop admission no longer lists a `bet` that became a call (it cannot face a wager).

Every constant with its source, sample size and interval: `docs/horse-option-authority.d/omahaFlopFacingBetEv.CONSTANTS.md`. Results (the replay of the 53 audited decisions, the five RC-02a hands, speed, the declared evaluation): `docs/horse-option-authority.d/omahaFlopFacingBetEv.md`.

## Files

- `server/src/engine/HorseOmahaFlopFacingBetEv.ts`, `HorseOmahaFlopFacingBetEv.test.ts`, `HorseOmahaFlopFacingBetEv.test-support.ts` (six recorded nodes added).
- `server/src/engine/horseDecision/responseValidation.ts`: one line.
- `server/src/engine/HorseDataLedger.ts`: the wording of the option's card.
- `docs/horse-option-authority.d/omahaFlopFacingBetEv.md`, `omahaFlopFacingBetEv.CONSTANTS.md` (new).
- Not touched: `HorseLogic.ts`, `HorseOmahaFacingBetEv.ts`, `HorseOmahaFlopFacingBetEvRule.ts`, `HorseOptionSwitch.ts`.
