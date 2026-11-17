# omahaTurnCallRealizationByRunout: authority for the live switch

Built 2026-11-17 on the owner's instruction of 2026-11-17 10:56 America/Chicago. Evidence NOT MET: no evaluation has been run. This file does not authorize switching the option on; it records what the option is and what must pass first.

## What it does

Inside `omahaFacingBetEv` only (PLO4/PLO5, one board, high only), for a turn call with chips behind: the realization factor of the call is read from the hand's own exact per-river counts against the bettor's value region and his other holdings (`HorseOmahaRunoutRealization.ts`), instead of the flat 0.85 out of position and 0.92 in position.

- On a river where the hand beats at least half of his value region, that river's equity is realized in full.
- On a river where it beats under a fifth, its wins against his value region are not realized, and its wins against his other holdings are realized at the share a non-value holding checks down (0.6 in position, 0.45 out of position), rising to full as this bettor's bluff share goes from 0.35 to 0.6.
- Linear in between. The factor stays within 0.35 and 1.

The three reviewed hand-specific caps of the facing-bet rule (paired turn with no boat out, big barrel against one or two pair with no real draw, a player behind) still apply after it as upper bounds. No term is the size of the bet. Six-card hands, the river and a final call are untouched.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaTurnCallRealizationByRunout docs/horse-option-authority.d/omahaTurnCallRealizationByRunout.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-16: "THE SIZE OF THE BET SHOULD NOT MAKE OR BREAK THE DECISION, THE DECISION NEEDS TO BE MADE ON THE HAND, AND THE MATH AND THE OPPONENTS RANGE AND OTHER FACTORS NOT JUST "IF ITS A BIG BET" ITS ALMOST ALWAYS A BIG BET!"
- 2026-11-17 10:56: "THIS NEEDS A FULL AUDIT AND ENHANCEMENT ROUND INDIVIDUALLY ... Phase 2 PLO4/PLO5 Logic: Texture-based equity realization and block-betting logic."

## The measurement it answers

Read-only production read, PLO4/PLO5 cash hands with a person seated, 2026-11-16T23:42Z (seal of 28372c9a) to 2026-11-17T17:00Z, Horse decisions facing a bet, whole-hand result of the Horse when it called (archive `plo-handoff-review-01a1cbbd/phase2-texture-01BNteGZ/MEASUREMENT-20261117.md`):

- PLO5 turn calls on three-suited boards: 16 calls, -812 bb. On connected boards: 14 calls, -591 bb. On dry boards: 73 calls, +167 bb. On paired boards: 29 calls, +517 bb.

The samples are small and the result is the whole hand, not the call alone. They locate the question; they are not the evaluation.

## Receipts

The verdict carries `runoutRealization` when the factor was read from the runout (HorseOmahaFacingBetEv.ts, OmahaFacingBetEvVerdict). No new receipt name.

## Tests

HorseOmahaRunoutRealization.test.ts (12 tests).

## Evidence rows

- Mechanism, scope, tests: MET.
- Option unset or false: the verdict is identical key for key (HorseOmahaRunoutRealization.test.ts, "off: the verdict is the one it was").
- Value, continuation, reach: NOT MET. The constants (0.5, 0.2, 0.6 / 0.45, 0.35 to 0.6) are stated, not measured. Evaluation NOT RUN: league cards `plo4_omaha_turn_call_realization_by_runout` and `plo5_omaha_turn_call_realization_by_runout` (a: the facing-bet rule with the option; b: the facing-bet rule as it serves). The bar is the lane's fixed rule: the option ships on only if a is above b by two standard errors against the human-calibrated field and not below b at Horse-only tables.
