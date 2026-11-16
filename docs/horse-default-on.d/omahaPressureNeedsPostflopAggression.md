# omahaPressureNeedsPostflopAggression (lane owner 2026-11-15, hand 59526261; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

In hand 59526261 (PLO5 cash) a Horse with top set check-raised the pot on the turn of an A-2-3-5 board into a made straight. The raise is the V53 pressure play in the facing-bet value-raise branch of `HorseLogic.ts` (receipt `v53_pressure_value_raise`): against a bettor read as aggressive (`aggressiveBettorPressure`, `HorseOpponentExploit.ts`) the value-raise bar drops by 0.10 and the raise frequency rises to 0.90. The read is satisfied by preflop raising width or by the PLO presumption that every person is aggressive; the bettor's postflop play is not asked. The branch's only board guard is a FRESH scare card (`dangered`), and A-2-5 already allowed a straight on the flop.

With this option, in PLO4/PLO5 cash after the flop:

1. The pressure play (`pressure53`: the value-raise bar, the raise frequency, the wider semi-bluff raise) and the maniac call-down priced on preflop raising width (`maniacCallDown`) apply only when the bettor's own postflop betting is measured high: `isPostflopManiac` on his read, or `postflopAggressor` of `HorseMind.omahaReadConditionalOf` (bet when checked to engaged high or credibly above the Horse mean, or a recent burst, on his own postflop opportunities). A measured value leader, an unmeasured player and a presumed read get none (`omahaPostflopPressureWithheld`). Receipt `omaha_pressure_withheld_value_leader`.
2. A facing-bet value raise on the turn or river with a hand a possible straight or flush already beats (`omahaBeatenByBoard`), not nut class, becomes a call, with no fresh scare card needed. Receipt `omaha_value_raise_beaten_by_board_flatted`. No raise-versus-call EV is computed (it would need a range model per raise size); the call is the answer.

## Input fidelity

Status: MET

Public state, the Horse's own cards and the opponent memory's decayed counters of the bettor, the counters every exploit read uses.

## Value

Status: NOT MET

Not measured. No league or production evaluation has been run. Replay of 20 of the 38 sweep hands flagged "turn/river raise without nuts" (archive `pairedriver-20261115/sweepF-sample20-replay.txt`, empty memory, 16 seeds): today's brain still raises in 8, 4 of them through the V53 pressure receipt; with the option on against a value-leader read 2 of those 4 never raise and the other 2 raise less often or as often on their own equity.

## Continuation

Status: NOT MET

Not measured. The call it leaves is today's call; later streets are unchanged.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the two receipts' counts per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, flop to river, facing a bet. PLO6, Hi-Lo, tournaments, hold'em and every preflop pressure play (`v53_pressure_three_bet_priced`, `v53_pressure_four_bet`, `v53_pressure_preflop`) are unchanged. Decision-level cases in `HorseOmahaPressureNeedsPostflopAggression.test.ts`.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_pressure_withheld_value_leader`, `omaha_value_raise_beaten_by_board_flatted`. League cards `plo4_omaha_pressure_needs_postflop_aggression`, `plo5_omaha_pressure_needs_postflop_aggression`.

## Limits

Status: MET

- Gated: the facing-bet pressure play and the preflop-width maniac call-down. NOT gated (they also read the aggressive or maniac read after the flop): the per-bettor call-down modifier (`opponent_exploit_calldown`), the maniac exemptions inside the big-bet call folds and the re-raised-pot rules, the range-read stripping for a measured maniac, and the betting-side fold-rate pricing (`v53_pressure_barrel`, a fold-rate read, not an aggression read). The archive lists them with line numbers.
- The beaten-by-board call applies whatever the read, also against a measured postflop aggressor.
- The receipt name says "value leader"; it also fires for an unmeasured or presumed bettor.
- The tests supply the read-conditional read by mock; the opponent memory's own path to `postflopAggressor` is covered only by the read unit (`omahaReadConditional`).
- Live behaviour is unverified: the option is off.
