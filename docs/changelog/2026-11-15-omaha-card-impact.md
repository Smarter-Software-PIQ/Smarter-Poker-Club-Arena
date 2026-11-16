# Omaha card impact: what the turn or river card did to the hand and to the opponent's range decides the bet

Date: 2026-11-15. Lane: PLO Strategy. Owner instruction 2026-11-15 11:41 America/Chicago. One new option, off by default (read `=== true`): `omahaCardImpact`.

## What happened

Owner: when a bad card comes the Horses have to realise it is a bad card for their hand or range, and when a turn or river card is bad for the opponent's range; they must play defence on bad turn and river cards and take full advantage of good ones that offer freerolls or more nut outs; no blanket rule may force a Horse off a correct decision. Hands 59517323 (aces bet into a river that paired the board, called twice before) and 59521326 (the nut straight bet into the turn card that paired the board).

## Root cause

The brain read a new card as a change of board texture, as a category test against a possible straight or flush, and heads-up as a change in the made-hand share of two public ranges. Those reads steered bluffs and automatic initiative only. The value branches (river block bet, thin and strong value, the pair-plus-draw barrel, the low stack-to-pot shift) are equity bars: none asks how many holdings beat the hand after the card that did not before, or what the hands that called this hand's bets now hold.

## What changed

- `server/src/engine/HorseOmahaCardImpact.ts`: the own-hand shift (holdings that beat the hand before and after, the nuts, river cards to the nuts, the freeroll), the opponent-range shift (a sample weighted by his line and measured tendencies: ahead before and after, improved past the Horse, left behind, missed draws) and the value in chips of a check and each bet size against that range.
- `omahaCardImpactRule` in `HorseLogic.ts` (wager_rules node, both decision paths): PLO4/PLO5 cash, heads-up, turn and river, nothing to call. The best candidate replaces the chosen action when worth more than 4% of the pot; a river bet that better hands call more than worse ones becomes the best candidate regardless.
- Ledger flag and four receipts, reference-decision source, league cards `plo4_omaha_card_impact` / `plo5_omaha_card_impact`, validator admission of the bet-to-check transition, evidence file `docs/horse-default-on.d/omahaCardImpact.md`, the two anonymised hands as fixtures with decision tests.

## Verification

`HorseOmahaCardImpact.test.ts`; server typecheck; related tests and ledger laws. With the option unset or false the brain decides as before (byte-identical decisions and random draws in the tests; league decision digest equal to the base commit's, in the evidence archive).

## Not done

No league evaluation and no declared protocol; the option stays off. The model disagrees with the owner's ruling on two recorded turn decisions (it keeps the turn bet in 59517323 and bets a third of the pot in 59521326 where the ruling is a check); the answers are not forced. Multiway pots, the flop and decisions facing a bet are outside. The bluff paths do not yet read the missed-draw share.
