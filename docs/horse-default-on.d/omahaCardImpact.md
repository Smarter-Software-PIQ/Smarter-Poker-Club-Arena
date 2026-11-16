# omahaCardImpact (owner instruction 2026-11-15 11:41 America/Chicago; branch agent/plo-cardimpact-01BbZPDi/feat/omaha-card-impact, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

The owner's instruction: a Horse must recognise a turn or river card that is bad for its hand or its range, and one that is bad for the opponent's range; it must play defence on bad cards and take full advantage of good ones (freerolls, more nut outs), with no blanket rule forcing it off the correct decision. Before this change the brain read the new card as a board-texture change (`scareShift`), as a category test against a possible straight or flush, and, heads-up, as a change in the made-hand share of two public ranges (`madeRangeChange`); those reads steered bluffs and automatic initiative only. No value bet, block bet or bet size asked how many holdings beat the hand before and after the card or what the hands that called this hand's bets now hold.

`server/src/engine/HorseOmahaCardImpact.ts` computes, at a turn or river decision with nothing to call: the holdings that beat the Horse before and after the card (exact, blockers included), the nuts before and after, river cards to the nuts, the freeroll; a sample of 800 opponent hands weighted by his line this hand (pot odds laid at each call, scaled by his measured fold rate when he is measured) and the shares of it ahead before and after the card, improved past the Horse, left behind, and missed; and the value in chips of a check and of each bet size against a response model of that range. `omahaCardImpactRule` (HorseLogic, wager_rules node, both decision paths) replaces the chosen check or bet with the best candidate when it is worth more than 4% of the pot. Candidates are the check, every value bet, and on the turn a bet no larger than the chosen one; a river bet that better hands call more than worse ones is replaced whatever its modelled fold equity.

## Input fidelity

Status: MET

The Horse's own cards, the board, known dead cards, the pot, the two stacks, the action history of the hand, and the opponent memory's measured read (`HorseMind.omahaReadConditionalOf`; a presumed read never counts and the population priors are used). The sample is drawn from a private stream seeded by the cards and seats; the brain's random stream is not read (tested). No opponent card is read.

## Value

Status: NOT MET

Not measured. No league evaluation has been run and no protocol is declared. The response model's constants (continue share by pot odds, 10% raise share, 45% bet when checked to, 30% bluff share) are priors, not fitted to play.

## Continuation

Status: NOT MET

Not measured. A turn decision is priced with the river dealt out and no river betting; what the Horse does on the river after a changed turn decision has not been measured.

## Reach

Status: NOT MET

Not counted in production or in the simulator.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, turn and river, nothing to call, exactly one live opponent with chips. The flop, PLO6, Hi-Lo, tournaments, all-in-or-fold tables, multiway pots and every decision facing a bet are outside. A bluff candidate (wins under 30% of the pot against the range and beats under 35% of all hands) is left to the bluff paths; a nut-class bet is never checked or made smaller. Decision-level cases in `HorseOmahaCardImpact.test.ts` on the recorded hands 59517323 and 59521326 and on spots built from them: off byte-identical with the same random draws; the paired river bet becomes a check; the bet into the turn card that pairs the board becomes a third of the pot; a freeroll becomes the full pot; a river that misses his draws is bet; a river that completes them is checked.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_card_impact_defence_check`, `omaha_card_impact_press_bet`, `omaha_card_impact_freeroll_pot`, `omaha_card_impact_changed`. League cards `plo4_omaha_card_impact` and `plo5_omaha_card_impact`. The worker receipt validator admits the bet-to-check transition inside the option's public scope.

## Limits

Status: MET

- Heads-up only; the opponent's preflop range is every hand.
- Draw strength in the line weights is an outs count, not an equity.
- On the turn the river is dealt out exactly but no river betting is modelled; after a check the Horse only calls or folds; his raise is always the pot.
- In hand 59517323 the model prices the turn bet above a check (the owner's ruling is a check) and keeps it; in hand 59521326 it prices a third-pot bet above both the recorded bet and a check (the owner's ruling is a check). Neither answer is forced.
- A turn decision costs 35 to 50 ms on the loaded development machine, a river decision 4 to 8 ms.
- Live behaviour is unverified: the option is off.
