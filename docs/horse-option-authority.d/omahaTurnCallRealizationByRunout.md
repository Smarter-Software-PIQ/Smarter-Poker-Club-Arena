# omahaTurnCallRealizationByRunout: authority for the live switch

Built 2026-11-17 on the owner's instruction of 2026-11-17 10:56 America/Chicago. Evidence NOT MET: the paired evaluation of 2026-11-17 was INCONCLUSIVE (below). This file does not authorize switching the option on; it records what the option is and what must pass first.

## What it does

Inside `omahaFacingBetEv` only (PLO4/PLO5, one board, high only), for a turn call with chips behind: the realization factor of the call is read from the hand's own exact per-river counts against the bettor's value region and his other holdings (`HorseOmahaRunoutRealization.ts`), instead of the flat 0.85 out of position and 0.92 in position.

- On a river where the hand beats at least half of his value region, that river's equity is realized in full.
- On a river where it beats under a fifth, its wins against his value region are not realized, and its wins against his other holdings are realized at the share a non-value holding checks down (0.6 in position, 0.45 out of position), rising to full as this bettor's bluff share goes from 0.35 to 0.6. Only that check-down term rises with the bluff share; the factor as a whole is not monotone in it (a higher share moves weight from wins against his value region, often on rivers realized in full, to wins against his other holdings on rivers realized at the check-down share, so out of position rows [10,10,2,10] / [0,10,9,10] give 0.975 at a share of 0.05 and 0.856 at 0.30).
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

Measured since (2026-11-18, read-only, plo-handoff-review-01a1cbbd/realfit-013U37/REALIZATION-FIT-20261118.md; production calls, exact equity against the hands really left): Horse turn callers realize 0.87 overall (IP 0.92, OOP 0.82), two pair or better out of position 0.77 (0.63-0.91), PLO4 below PLO5 (0.75 vs 0.91). The flat 0.92 / 0.85 this option replaces are consistent with those figures. This option's check-down shares (0.6 / 0.45) and bluff-catch range (0.35-0.6) are stated, not fitted: a further reason it stays off until a fitted version passes an evaluation.

## Receipts

The verdict carries `runoutRealization` when the factor was read from the runout (HorseOmahaFacingBetEv.ts, OmahaFacingBetEvVerdict). No new receipt name.

## Tests

HorseOmahaRunoutRealization.test.ts (12 tests).

## Evaluation (run 2026-11-17, bar written before the run)

Protocol, rows and results: archive `plo-handoff-review-01a1cbbd/phase2-texture-01BNteGZ/eval/` (PROTOCOL.md with amendments E1 and E2, RESULTS.md, pooled.txt). Option on versus off, both arms carrying the 32-option live package; 4,000 duplicate pairs per seed, five seeds per card; paired bb/100, pooled as the mean of seed means with SE = sqrt(sum SE^2) / 5. The Omaha human field v1 with fixed seat identity and the league decision state are not on main, so the run used a throwaway tree: this change's brain with the benchmark side of `b83e730c7ba`.

| Card              | Pooled A - B bb/100 | SE   | z     | Divergent pairs |
| ----------------- | ------------------- | ---- | ----- | --------------- |
| PLO4, human field | -1.68               | 2.08 | -0.81 | 36 / 20,000     |
| PLO5, human field | -7.67               | 8.81 | -0.87 | 60 / 20,000     |
| PLO4, Horse-only  | +1.19               | 0.53 | +2.23 | 993 / 20,000    |
| PLO5, Horse-only  | +0.79               | 0.46 | +1.70 | 792 / 20,000    |

Every run: illegal actions 0, truncated streets 0, brain fallbacks 0.

Verdict under the declared rule: not FAIL (no card below -2 SE), not WIN (no human-field card above +2 SE). The rule had no line for a Horse-only card above +2 SE without a human-field win; none was added afterwards. Recorded as INCONCLUSIVE. Against the human field the option is close to inert. The constants were not tuned and the seeds were not changed.

Constants against the live audit CSVs (`phase2-texture-01BNteGZ/CONSTANTS-GROUNDING-20261117.md`): one player's river check rate after a called turn bet, Horse in position, is 11 of 21 (stated constant 0.60 for his non-value holdings: not contradicted); the other four constants are not grounded by that source.

## Evidence rows

- Mechanism, scope, tests: MET.
- Option unset or false: the verdict is identical key for key (HorseOmahaRunoutRealization.test.ts, "off: the verdict is the one it was").
- Value, continuation, reach: NOT MET. Evaluation run 2026-11-17: INCONCLUSIVE (above). The bar for switching on is a human-field card above +2 SE with no card below -2 SE; it was not reached. The option stays off. A live read cannot substitute for it while the option is off.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

The component's own follow-up migration 20261118014131 was deleted; the option is in the batch's one regenerated follow-up, 20261118070047_horse_option_switch_omaha_option_batch.
