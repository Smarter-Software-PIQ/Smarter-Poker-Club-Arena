# Omaha: a flop decision facing a bet gets the priced verdict the turn and river have (default OFF)

Date: 2026-11-17. Lane: PLO Strategy. Owner ruling 2026-11-16 (a decision rests on the hand, the equity, the opponent's range and the price, never on the size of the bet alone; no blanket rule may block a correct decision). One new option, off by default (read `=== true`): `omahaFlopFacingBetEv`. Nothing is switched on by this change.

## What was there

In PLO4/PLO5 cash a Horse facing a bet on the turn or the river is decided by `omahaFacingBetEv`: exact equity against the bettor's range for that action, against the price. The flop had no such rule. Two rules with no equity term decided there instead:

- the paired-board fold (`HorsePloPairedBoardFold.ts`): on a paired flop, below a full house, a call of a quarter of the stack or more folds, whatever the hand and whoever bet;
- the range read's 20 big blind "big bet" mark (`HorseMind.ts`): a wager of 20 big blinds or more tiers the bettor's range as strong by chip count. `omahaBigBetIsPotShare` corrects that on the turn and river only.

Measured against one winning player (721 PLO5 hands, archive `plo-handoff-review-01a1cbbd/audit2-01BNteGZ`): Horses folded to 71% of his flop bets and folded the best hand on 21% of those folds.

## What changed

New `server/src/engine/HorseOmahaFlopFacingBetEv.ts` (pure: the spot, the sampled count, the realization factor, the verdict) and `HorseOmahaFlopFacingBetEvRule.ts` (the rule that applies it). With the option on, on the PLO4/PLO5 cash flop facing a bet or a raise, a fold or a call becomes one expected-value verdict:

- HAND: the hand's showdown result on two-card runouts against opponent holdings. The turn rule walks every river card and counts every holding exactly; the flop has 946 to 990 runouts and the same count would take seconds, so the flop is sampled with a seed taken from the cards: every unseen card is the turn card once, three river cards each, eight holdings per runout (five of the bettor's value region, three of his other holdings). The same cards always give the same numbers, and the brain's random stream is not touched.
- PLAYER: the bettor's range is the strongest share of holdings on the flop (set by the bet's share of the pot, whether it is a raise, and whether he bets into the preflop raiser) and a share of every other holding, moved by his measured read (the turn and river function). The size sets the range; it never decides.
- LATER STREETS: a call with chips behind is multiplied by a realization factor read from the hand's own runouts: equity on runouts where the hand can call the turn and the river is realized, bluff-catcher equity only on streets he checks. No flat factor and no bet-size term.
- PRICE: EV(call) on the actual pot and call, against the one margin of the turn and river rule.

Precedence in the spot it covers: the verdict replaces a fold or a call, so the paired-board fold, its price exception, the brain's own fold or call (which reads the 20 big blind mark) and the flop call-discipline folds are inputs there and no longer decide. A raise is left alone. It stands aside for the bare-overpair continuation (`omahaBareOverpairOopFlopCheck`), which has its own priced verdict. Tournaments, PLO6, hi-lo, bomb pots, all-in-or-fold and capped wagers are outside it. With the option unset or false every decision is byte-identical.

The constants (value shares, non-value shares, realization shares) are stated, not measured. Authority file and evaluation result: `docs/horse-option-authority.d/omahaFlopFacingBetEv.md`.

## Files

- `server/src/engine/HorseOmahaFlopFacingBetEv.ts`, `HorseOmahaFlopFacingBetEvRule.ts`, `HorseOmahaFlopFacingBetEv.test.ts`, `HorseOmahaFlopFacingBetEv.test-support.ts` (new).
- `server/src/engine/HorseLogic.ts`: the import, the option, and the hand-off at the top of `omahaFacingBetEvRule` (26 added lines, none changed). `HorseOmahaFacingBetEv.ts` is not touched.
- `server/src/engine/horseDecision/responseValidation.ts`: the receipt validator admits the flop call in the rule's spot for the exact chips.
- `server/src/engine/HorseDataLedger.ts`, `HorseReferenceDecisionSources.ts`, `server/src/benchmark/HorseLeague.ts`: the ledger entry and three receipts, the decision sources, the two league cards.
- The generated option-switch follow-up migration and `scripts/ci/test-horse-option-switch-evidence-postgres.sh`: the registered names. Registering enables nothing.
