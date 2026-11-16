# omahaRiverMediumBetStrongHandCalls (PLO Strategy lane 2026-11-15; branch agent/plo-rivercall-01BbZPDi/fix/omaha-river-medium-bet-strong-hand-calls, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Evidence (archive `plo-handoff-review-01a1cbbd/winner-exploit-20261115`): against one PLO5 cash player, on the river, facing a bet of 40 to 70 percent of the pot, heads-up or closing the action, Horses holding two pair or better folded 11 of 15 times; five of those folds were the best hand, and all four folded sets, trips or better were. His bets of that size were behind 7 times in 16; his bets of 70 percent or more were ahead 19 times in 24 and the folds to them were right; his bets under 40 percent were ahead 6 times in 6.

The eleven folds were rebuilt from their public records and replayed through `HorseLogic.decide` (archive `rivercall-20261115/SPOT-TABLE.md`). With the opponent memory off the brain calls eight of the eleven and folds only the three on paired boards. With it on, with or without a row for the bettor, it folds all eleven, because:

1. The range read marks any wager of 20 big blinds or more on the newest street as a "big bet", whatever share of the pot it is (`HorseMind.ts`, the band read, `newestStreetBigBet`). Every one of these bets was 30 to 290 big blinds and 50 to 58 percent of the pot.
2. `omahaAggressorTier` (`HorseEval.ts`) adds a tier for that mark exactly as it does for a bet of 70 percent of the pot or more, and `omahaTierRequirement` then samples the river bettor as 81 to 88 percent value of at least two pair, trips, a straight or (PLO5, paired board, tier 3) a full house. V56 (`v56OmahaPressureRange`) holds weak trips to the strict form.
3. The equity used for the decision is then 6 to 7 percent for a set, 13 for trips and 6 to 26 for two pair, against a price of 25 to 27 percent. The committed-call bar (`HorseLogic.ts` decidePostflop, `eq15 >= required`, the fold at lines 17364-17368 of commit 9610fa8640c) or the river call verdict (`riverCallVerdict`, receipt `v38_river_fold`, lines 18736-18738) folds.
4. On a paired board the paired-board fold (`HorsePloPairedBoardFold.ts`, receipt `plo_paired_board_fold`) folds a flush or trips whose call is a quarter of the stack, at any price.

None of the four looks at the bet as a share of the pot. With the 20 big blind mark removed (`v16SizeCond: false`) the same replay prices the hands at 25 to 39 percent.

The option does not change the range model. It runs outermost of the call-discipline rules in the wager_rules node (and on the path outside the graph): in PLO4 / PLO5 cash, high only, one board, on the river, facing the street's opening bet (no raise, none of the Horse's own chips in on the street) of 40 to 70 percent of the pot, heads-up or with nobody left to act, a FOLD of two pair or better (the engine's classes; two pair on a paired board is the one-pair class, as V51 / V61 read it) becomes a CALL when the exact share of all the holdings the bettor could have that do not beat the Horse's hand is at least 1.5 times the price of the call (`HorseOmahaRiverMediumBetCalls.ts`). It is withheld when the bettor is a measured postflop value leader (`HorseMind.omahaReadConditionalOf(...).valueLeader`) and for a fold that carries a continuation guard.

## Input fidelity

Status: NOT MET

The replay used the hands' recorded public nodes (seats, stacks, bets, pot, board, legal actions, VPIP floor, rake rules) and the Horses' own cards. Supplied by hand: the opponent memory. It was read from production about one hour after the session (pooled row, Omaha scoped rows, the PLO5 exact profiles), not as it stood at each decision; the pair counters, size buckets, style imports and the hand's earlier-street plans were not supplied. The folds reproduce with that memory and with no row for the bettor alike, so the mechanism does not depend on it; the value-leader gate does (see Limits).

## Value

Status: NOT MET

Not measured out of sample. On the eleven recorded folds the rule calls eight (five best hands won 3,872 chips of pots, three calls lost 505: +1,684 big blinds before rake) and keeps three folds that were right. The 1.5 factor was chosen with those eleven hands in view. The declared paired evaluation is league cards `plo4_omaha_river_medium_bet_strong_hand_calls` and `plo5_omaha_river_medium_bet_strong_hand_calls`; no verdict yet.

## Continuation

Status: MET

The river call ends the hand: the Horse closes the action and nothing follows it.

## Reach

Status: NOT MET

Not counted in production. In the one session measured: 9 of the 11 folds are in the spot, 8 meet the price.

## Scope

Status: MET

PLO4 and PLO5, cash, high only, one board, pot limit or any structure whose bet is 40 to 70 percent of the pot, the river only, a fold only. Gates in `omahaRiverMediumBetSpot`; decision-level cases in `HorseOmahaRiverMediumBetCalls.test.ts` on the recorded nodes: unset, false and a non-boolean truthy value are byte-identical to today at all thirteen nodes with the memory on and off; the five best-hand folds call; one pair, two pair on a paired board, a bet of 75 or 85 percent or of 30 percent, a player still to act, a raise, PLO6, PLO8, hold'em, a tournament and a second board are out; the call is admitted by the worker receipt validator with the request that produces it and refused against another.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_river_medium_bet_strong_hand_call`, `omaha_river_medium_bet_strong_hand_call_withheld`, `omaha_river_medium_bet_strong_hand_call_unpriced`.

## Limits

Status: MET

- One player, one session, fifteen spots. Nothing here shows the rule wins against the field.
- When on, the option reopens the owner's binding paired-board fold (Dan 2026-10-25, "a fold 100% of the time") for trips or better facing a 40 to 70 percent river bet heads-up. Two of the five best-hand folds were that rule. Turning the option on is therefore an owner decision, not only an evaluation result.
- The price test compares the hand with every holding the bettor could have, not with a betting range; the 1.5 factor stands in for the difference and is fitted loosely to eleven hands.
- Bets under 40 percent of the pot are excluded because the same evidence shows them as value (6 of 6 ahead).
- The opponent memory has no river-bluff rate by bet size. The gate is the postflop value-leader read. With the memory read an hour after the session this same player is a measured value leader at tables of five or fewer and not measured at six: on the three recorded folds dealt five-handed the call would have been withheld (one best hand, two beaten).
- The range model that causes the folds (the 20 big blind "big bet" mark and the river tier requirement) is unchanged and still misprices every other decision that reads that equity.
- Live behaviour is unverified: the option is off.
