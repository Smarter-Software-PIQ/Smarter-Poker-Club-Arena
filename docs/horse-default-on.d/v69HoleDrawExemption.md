# v69HoleDrawExemption (#8902)

Originally shipped on by default on 2026-10-31 in #8902 under `v69TurnCallGaps` (`docs/changelog/2026-10-31-v69-turn-call-gaps.md`), and split onto its own independent default-ON option `v69HoleDrawExemption` with zero default-ON behavior change so disabling `v69TurnCallGaps` (one-pair turn implied odds) no longer re-enables the board-only draw exemption defect for V65 turn one-pair shade or Pillar 2 `v87DeepDiveDiscipline`.

## Mechanism

Status: MET

When evaluating the draw exemption on Hold'em turn one-pair calls (`turnOnePairShadeEligible65` for V65 `shade65` and Pillar 2 `extra87Turn`, and `shade87NlhTurnCommit` on the committed turn branch in `HorseLogic.ts`), `holdemDrawPresent(hole, board)` previously treated a four-to-a-suit or four-rank straight window made by the board alone (with neither hole card participating) as hero's draw. When `opts.v69HoleDrawExemption !== false`, both gates use `holdemHoleDrawPresent(hole, board)` so only a draw a hole card actually participates in exempts the hand (`HorseTurnCallGaps.test.ts`, `HorseHoldemBlanketDecouplingV69V73.law.test.ts`).

## Input fidelity

Status: MET

Reads only hero's two hole cards and the four turn community cards via pure card predicate `holdemHoleDrawPresent` plus the boolean option `opts.v69HoleDrawExemption !== false`. No opponent read or hidden state is consulted.

## Value

Status: MET

Eliminates a pure input-classification defect measured in #8902: a board-only four-flush or four-straight is shared by every player at the table and gives hero zero flush/straight draw equity. Splitting the defect guard out of `v69TurnCallGaps` preserves 100% identical default-ON behavior while ensuring that turning `v69TurnCallGaps` OFF for single-rule grading never weakens V65, Pillar 2 (`v87DeepDiveDiscipline`), or any priced V65 successor.

## Continuation

Status: MET

Hands that actually hold a hole-card draw stay exempt from the turn one-pair shade and continue on the draw call/raise pricing line. Drawless one-pair hands on a board-only four-flush or four-straight receive the normal V65 / Pillar 2 turn one-pair shade and fall through to the existing V38 / committed call bar unchanged.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): `v69_turn_call_gaps` fires ~394 times/day across NLH formats on Hold'em turn spots where hero faces a wager on a board-only four-flush or four-straight with one pair or short-behind implied odds. Hands with a real hole-card draw and all flop/river spots are untouched.

## Scope

Status: MET

Single-board Hold'em turn one-pair calls (non-Omaha, non-bomb-pot, non-multi-board, not raised after hero's own aggression). PLO4, PLO5, PLO6, and all other Omaha variants are completely excluded by `!vi.isOmaha` and are byte-identical regardless of flag state.

## Visibility

Status: MET

Emits telemetry receipt `v69_turn_call_gaps` (`HorseDataLedger.ts`) when `shade65 > 0` fires on a board-only draw shape that `holdemDrawPresent` would have exempted. Registered in `HORSE_DATA_LEDGER` as flag `v69HoleDrawExemption` and held in `OPTION_SWITCH_REFUSED` as a defect guard (never switched off via the live DB option switch without a dedicated registration migration).

## Limits

Status: MET

This split does not change default-ON behavior or alter V69 (1) one-pair implied odds (`v69TurnCallGaps`) or V69 (3) V32 turn draw pass-through no-room (`v69V32DrawNoRoom`). Explicit `v69HoleDrawExemption: false` remains available in `HorseDecideOpts` for isolated unit testing and counterfactual evaluation.
