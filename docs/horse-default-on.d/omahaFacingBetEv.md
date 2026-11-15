# omahaFacingBetEv (owner instruction 2026-11-15 11:39 America/Chicago; branch agent/plo-facingbet-01BbZPDi/feat/omaha-facing-bet-ev, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Owner: the fold-or-call decision facing a bet must depend on the hand, the player and the pot size to value, not on "always fold to a big bet". Today a PLO4/PLO5 turn or river decision facing a bet is an equity estimate with class caps and a stack of rules that veto its answer (the 20 big blind "big bet" mark and the aggressor tier, the committed-call bar and its margins, the river and turn call verdicts, the paired-board fold, the big-bet and bluff-catcher cells). None counts the holdings that beat the Horse's actual hand; the full list with lines is in the lane archive `plo-handoff-review-01a1cbbd/facingbet-rewrite-20261115/DESIGN.md`.

With the option on, `omahaFacingBetEvRule` (`HorseLogic.ts`, outermost call-discipline rule on both decision paths) replaces a fold or a call in that spot with one verdict from `server/src/engine/HorseOmahaFacingBetEv.ts`: the exact count of opponent holdings that beat, tie and lose to the Horse's hand (its own cards removed; every river card on the turn), weighted by a value region sized by the bet's share of the pot and the bettor's line and by a bluff share (the measured population figure, moved by the bettor's measured tendencies and by his shown-down results at that bet size when the memory has them), priced as EV(call) on the actual pot and call against one margin of 2 percent of the final pot. Every other player in the hand must be beaten too. A raise is never made and never changed.

## Input fidelity

Status: MET

Public state, the Horse's own cards, known dead cards and the opponent memory's decayed counters of the bettor (`HorseMind.omahaFacingBetEvReadOf`). The count is exact and draws no random number: it agrees with listing every holding one by one (tests). The shown-down read by bet size has no store of its own: it is an optional field (`best`, optionally `second`) on the existing river size-bucket tallies of the opponent memory (`styleSizeShown`), read by `HorseMind.omahaFacingBetEvReadOf`. No learner writes that field today, so the population prior decides; adding it is the opponent-memory owner's change (first-hand opponent learning: one learner, one profile).

## Value

Status: NOT MET

Not measured. No league evaluation has been declared or run. On 22 recorded decisions (tests) the verdicts are stated against an unknown bettor and two measured reads; that is a mechanism check, not a result.

## Continuation

Status: NOT MET

A turn call with chips behind is priced with the engine's realization factor, not with a model of the river bet; later streets are not measured.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the `omaha_facing_bet_ev_call` / `_fold` / `_changed` receipt counts per cell.

## Scope

Status: MET

PLO4 and PLO5 cash, high only, one board, not a bomb pot, not an all-in-or-fold table, turn and river, facing a bet or a raise, today's answer a fold or a call. Everything else is unchanged; unset, false and a truthy non-boolean are byte-identical to today on every recorded node (tests).

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_facing_bet_ev_call`, `omaha_facing_bet_ev_fold`, `omaha_facing_bet_ev_changed`. The legacy rule a changed verdict replaced is the legacy receipt fired in the same decision (for example `plo_paired_board_fold`, `v38_river_fold`).

## Limits

Status: MET

- The value shares, the line factors, the field shares and the bluff share of a raise are stated constants, not fitted; the bluff-share prior is measured on one population over five days (4,573 hands).
- Against an unmeasured bettor a hand that beats none of his value region folds to a river bet at every size, because that population bets the best hand 80 to 87 percent of the time; the calls of the recorded best-hand folds need the shown-down read by bet size, a field the opponent memory does not write yet.
- With the option on it reopens the owner's binding paired-board fold (2026-10-25) and the big-bet cells in this spot: turning it on needs the owner's word as well as a passed evaluation.
- The PLO5 turn count costs about 180 ms per decision on the development machine under load (every river card); the river about 10 to 15 ms.
- The opt-in one-pair discipline runs after it and can still fold its call.
- Live behaviour is unverified: the option is off.
