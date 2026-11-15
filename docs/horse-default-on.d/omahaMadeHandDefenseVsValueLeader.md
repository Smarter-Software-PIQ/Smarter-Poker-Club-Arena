# omahaMadeHandDefenseVsValueLeader (owner instruction 2026-11-15 01:03 America/Chicago; branch agent/plo-readcond-01Gw7aDt/feat/omaha-read-conditional-defence, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

`omahaBeatenMadeHandDefense` (`server/src/engine/HorseOmahaMadeHandDefense.ts`, unchanged) makes a made hand that a possible straight or flush beats call instead of raising a turn wager, check the turn or river card that made the straight or flush possible out of position, and check the river into an earlier street's bettor. Its declared evaluation failed: Horses against one loose-aggressive value seat lost 23.73 bb/100 in PLO4 (z -2.89) and 16.17 in PLO5 (z -2.42). The owner's instruction is to play a maniac and a tight player differently and to fix the problem rather than order particular calls.

This option runs the same two rules in the same place (`omahaMadeHandDefenseRules` in `HorseLogic.ts`, wager_rules node) and keeps a change only when every live opponent is a measured postflop value leader (`server/src/engine/HorseOmahaReadConditional.ts`, read through `HorseMind.omahaReadConditionalOf`): at least 15 decayed hands of his own and the Omaha presumption evidenced or disproved on his counters (a presumed read never counts); at least 8 decayed opportunities both checked to and facing a bet postflop; not over-bluffing (bet-when-checked-to read not engaged high, not a postflop maniac, bet rate when checked to not credibly (0.9) above the Horse mean, no recent betting burst in the fast window); value-heavy (folds to a postflop bet at least, and calls river bets at most, as often as the average Horse). Preflop width is not part of the read: the lane owner's production measurement of the top PLO5 winner against the Horses (maniac-wide preflop; bet when checked to 0.34, fold to a bet 0.47, river call 0.20) is a value leader. Otherwise the decision is today's. It stands aside while `omahaBeatenMadeHandDefense` is on, and with the mind off.

## Input fidelity

Status: MET

Public state, the Horse's own cards and the opponent memory's decayed counters of every live opponent (exact context, probe-adjusted). In the league the memory learns during each session (league default); the evaluation protocol states how many hands the reads need to engage.

## Value

Status: NOT MET

Not yet measured. The declared paired evaluation (archive `plo-handoff-review-01a1cbbd/readcond-20261115/PROTOCOL-omahaMadeHandDefenseVsValueLeader.md`; pass rule: pooled human-field gain more than 2 SE above zero, no cell more than 2 SE below zero, no illegal action or fallback) records its verdict in `docs/changelog/2026-11-15-omaha-read-conditional-defence.md`.

## Continuation

Status: NOT MET

Not measured separately; the paired evaluation's arms include every later street.

## Reach

Status: NOT MET

Not counted in production. The reach in the simulator is the applied / withheld receipt counts per evaluation cell.

## Scope

Status: MET

The made-hand defence's own scope: PLO4, PLO5 and PLO6 high, one board, pot limit, turn and river (the turn raise; the fresh-card and river checks). Decision-level cases in `HorseOmahaReadConditional.test.ts` on the anonymised complaint nodes (top two pair facing the turn bet on the straight card; the set out of position on the straight card): off byte-identical; an unknown, presumed, over-bluffing or station read gives today's decision; a measured value leader gives the defence with its receipts; the call and the check it makes are admitted by the worker receipt validator.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_value_leader_defense_applied` and `omaha_value_leader_defense_withheld`, beside the defence's own cell receipts (`omaha_turn_beaten_raise_flatted`, `omaha_turn_beaten_raise_fold_restored`, `omaha_beaten_fresh_card_check`, `omaha_beaten_river_no_value_bet`). League cards `plo4_omaha_made_hand_defense_vs_value_leader` and `plo5_omaha_made_hand_defense_vs_value_leader`.

## Limits

Status: MET

- "Value-heavy" is read from frequencies (bet when checked to, fold to a bet, river call); the counters hold no showdown strength, and the V83 showdown tally counts only river bets of 20 big blinds or more, so it is not used.
- The loose-aggressive value seat on which `omahaBeatenMadeHandDefense` failed is postflop value-heavy by construction, so this read engages against it too; whether the defence then wins or loses there is what the evaluation measures.
- Every live opponent must be a value leader: multiway pots with any unknown player keep today's play.
- Live behaviour is unverified: the option is off.
