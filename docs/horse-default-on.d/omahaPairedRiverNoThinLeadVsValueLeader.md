# omahaPairedRiverNoThinLeadVsValueLeader (owner ruling 2026-11-15 America/Chicago, hand 59517323; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

In hand 59517323 (PLO5 cash) a Horse out of position bet 256 into 1,021 on the river that paired the board, holding aces up, into the one player who had called its flop and turn bets; that player moved all in with a full house and the Horse called. The bet is the river block bet of the out-of-position value ladder (`HorseLogic.ts`, the `V12 RIVER BLOCK BET` branch: heads-up, equity between 0.45 and 0.62, 40% of the time, 0.27 to 0.33 of the pot before sizing). The 2026-11-06 paired-board river check (`ploPairedBoardRiverMustCheck`) needs the board paired by the turn; the made-hand defence's river check needs an opponent who bet or raised on an earlier street, not one who called. The unconditional widening (`ploPairedRiverCheckAfterCalled`, commit e853b893, 2026-11-14) failed its declared evaluation (PLO4 -1.78, PLO5 -0.96 bb/100) because the development field calls river bets whatever the board, so thin bets profit against it.

This option (`omahaOopCheckRules` in `HorseLogic.ts`, wager_rules node, after the paired-board river check; spot `omahaPairedRiverThinLeadSpot` in `server/src/engine/HorseOmahaOopChecks.ts`) turns the bet into a check when the final board is paired, the Horse holds less than a full house, a live opponent called the Horse's own flop or turn bet, and every live opponent is a measured postflop value leader (`HorseOmahaReadConditional.ts`, the predicate `omahaMadeHandDefenseVsValueLeader` uses; a presumed read never counts).

## Input fidelity

Status: MET

Public state, the Horse's own cards and the opponent memory's decayed counters of every live opponent (exact context, probe-adjusted), read through `HorseMind.omahaReadConditionalOf`.

## Value

Status: NOT MET

Not measured. No league or production evaluation has been run for this option. The evaluation is to be declared in the evidence archive (`plo-handoff-review-01a1cbbd/pairedriver-20261115/`) before any graded run, and its verdict recorded in `docs/changelog/2026-11-15-omaha-oop-bets-that-become-checks.md`.

## Continuation

Status: NOT MET

Not measured. On the anonymised hand, after the check the Horse folds aces up to the all-in of 417.9 into 1,021 at every tested seed (pinned in the test); whether that fold is right against this player is not measured.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, river, nothing to call, check legal. Hi-Lo, PLO6, tournaments, two boards and all-in-or-fold tables are outside. Decision-level cases in `HorseOmahaOopChecks.test.ts` on the anonymised hand: off byte-identical; an unknown, presumed or measured non-leader opponent gives today's decision; a full house and an unpaired river are unchanged; no decision facing a bet changes.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_paired_river_thin_lead_checked` and `omaha_paired_river_thin_lead_withheld`. League cards `plo4_omaha_paired_river_no_thin_lead_vs_value_leader` and `plo5_omaha_paired_river_no_thin_lead_vs_value_leader`.

## Limits

Status: MET

- A paired board gives every hand at least a pair, so the rule cannot tell a thin value bet from a bluff by hand class: every river bet below a full house in the spot becomes a check, a bluff included.
- "Value-heavy" is read from frequencies (bet when checked to, fold to a bet, river call); the counters hold no showdown strength.
- Every live opponent must be a measured value leader; a pot with any unknown player keeps today's play.
- Live behaviour is unverified: the option is off.
