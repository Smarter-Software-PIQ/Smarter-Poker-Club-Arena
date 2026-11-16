# omahaOopTurnCheckAfterFlopCall (owner ruling 2026-11-15 12:09 America/Chicago, hands 59517323, 59521326, 59526261; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Owner, on the turn bets of hands 59517323 (aces with the nut flush draw) and 59521326 (the straight on the paired turn), and attached to hand 59526261 (top set check-raising a four-straight turn): "THIS SHOULD BE A CHECK CALL 100% OF THE TIME WHEN THE OPPONENT IS ONE OUT OF POSITION, AND TWO THEY OPPONENT ALREADY CALLED A FLOP BET. CHECK CALL WHEN DRAWING TO THE NUTS, CHECK FOLD WHEN YOU CAN'T IMPROVE WITH ANY TURN CARDS" (the Horse is out of position and the flop bet was called).

`omahaOopCheckRules` in `HorseLogic.ts` with two predicates in `server/src/engine/HorseOmahaOopChecks.ts`, PLO4/PLO5 cash, heads-up, one board, high only, the turn, no opponent read:

- The check (`omahaOopTurnCheckAfterFlopCallSpot`): the opponent acts behind and called the Horse's flop bet or raise, and the Horse does not hold a nut-class hand for the street (`omahaNutClassNow`): a bet becomes a check. Nut-class hands keep betting, with the full-pot sizing where that option is on.
- Facing the turn bet after the check (`omahaOopTurnFacingBetVerdict`): the Horse checked, the opponent bet, chips went in from both on the flop (the Horse's bet or raise was called, or the Horse called his), not nut class. Nut outs are the unseen river cards that make the nut flush or the nut straight on the board that card makes, or a full house or better (`omahaTurnRedrawShare`, Omaha's two-card rule). The price is the call over the pot after it.
  - Four or more nut outs and a price within the outs' share plus 0.15: the Horse calls, whatever the decision was.
  - No nut out, one pair or less or a hand a possible straight or flush already beats, and a price of 0.15 or more: the Horse folds.
  - Otherwise today's call or fold stands and a raise becomes a call.

It runs before `omahaOverpairNoOopBarrelVsValueLeader` and `omahaPairedTurnNoBarrelWithoutBoatVsValueLeader`, which remain as narrower fallbacks.

## Input fidelity

Status: MET

Public state and the Horse's own cards only. Exact enumeration of the river cards; no Monte Carlo, no random number.

## Value

Status: NOT MET

Not measured. No league or production evaluation has been run.

## Continuation

Status: NOT MET

Not measured. Pinned on the anonymised hands: 59517323 checks and calls a turn bet of a third to two thirds of the pot; 59526261 calls the 162 bet instead of raising to 522; 59521326 checks, and facing a bet keeps today's call or fold with the raise flatted; aces with no nut out fold to two thirds of the pot.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the four receipts' counts per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, the turn, heads-up, the Horse out of position. In position, multiway, PLO6, Hi-Lo and tournaments are unchanged. Decision-level cases in `HorseOmahaOopTurnCheckAfterFlopCall.test.ts`.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_oop_turn_check_after_flop_call`, `omaha_oop_turn_check_call_nut_draw`, `omaha_oop_turn_check_fold_no_outs`, `omaha_oop_turn_check_raise_flatted`. League cards `plo4_omaha_oop_turn_check_after_flop_call`, `plo5_omaha_oop_turn_check_after_flop_call`.

## Limits

Status: MET

- The 0.15 showdown credit is a stated allowance, not a measured equity; the four-out minimum and the 0.15 token price are stated, not fitted.
- "Nut outs" for the 4-out call threshold are GRADED in PLO4/PLO5 (2026-11-16, review note H9): a river card counts 1 when it makes the nuts (nut flush or nut straight on an unpaired river, quads or better, a full house no bigger full house beats) and, when it makes a non-nut full house, the share of the opponent's full-house holdings it beats (1 - boatsAbove/total, floored at 0; `omahaGradedTurnOuts`). The price test and the no-out fold keep the whole-card count. The grading and its denominator are stated, not measured. Over the 3,000-hand H9 turn sample (two pair, trips or a set), the hands at or over the threshold fall from 2,393 to 686 in PLO4 (1,707 lose the forced call) and from 2,568 to 941 in PLO5 (1,627 lose it); a hand that loses it keeps today's call or fold (a fold where today's decision folds), its raise still a call. PLO6 keeps its own out class.
- A made hand that is neither one pair nor beaten by a possible straight or flush (two pair or a set on a dry board, a straight on a paired board) with no nut out keeps today's call or fold.
- Every non-nut-class turn bet in the spot becomes a check, a bluff included; no stack-depth exception.
- The receipt validator re-runs both predicates on the request.
- Live behaviour is unverified: the option is off.
