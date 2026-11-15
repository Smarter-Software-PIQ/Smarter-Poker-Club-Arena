# Omaha river: a strong made hand calls a medium bet (option, off by default)

Date: 2026-11-15. Lane: PLO Strategy. One new option, off by default (read `=== true`): `omahaRiverMediumBetStrongHandCalls`.

## What happened

Against one PLO5 cash player, on the river, facing a bet of 40 to 70 percent of the pot, heads-up or closing the action, Horses holding two pair or better folded 11 of 15 times. Five of those folds were the best hand (every folded set, trips or better was). His bets of that size were behind 7 times in 16. The folds to his bets of 70 percent of the pot or more were right.

## Root cause

The Horses' estimate of their chance to win treats every river bet of 20 big blinds or more as a big bet, whatever share of the pot it is, and then assumes the bettor holds trips, a straight or a full house four times in five or more. A set was priced at 6 to 7 percent, trips at 13, two pair at 6 to 26, against a call that needed 25 to 27. On paired boards the paired-board fold then folds a flush or trips whose call is a quarter of the stack at any price. None of these looks at the size of the bet against the pot.

## What changed

New `server/src/engine/HorseOmahaRiverMediumBetCalls.ts`. With the option on, in PLO4 / PLO5 cash (high only, one board), on the river, facing the street's opening bet of 40 to 70 percent of the pot, heads-up or closing the action, a fold of two pair or better becomes a call when the hand holds up against the exact share of all the holdings the bettor could have at least 1.5 times as often as the price of the call asks. Two pair on a paired board counts as one pair and stays a fold. The call is withheld against a measured postflop value leader and for a guarded fold. Never a raise, never a bet above 70 percent or under 40 percent of the pot. Receipts `omaha_river_medium_bet_strong_hand_call`, `_withheld`, `_unpriced`. League cards plo4/plo5 `_omaha_river_medium_bet_strong_hand_calls`. The worker receipt validator admits the call only with the request that produces it.

With the option unset or false the brain decides exactly as before. The range estimate itself is not changed.

## Not done

- No declared evaluation has been run.
- When on, the option reopens the owner's paired-board fold for trips or better in this one spot; that needs the owner's word.
- The estimate that prices every bet of 20 big blinds as a big bet is still in place.

## Follow-up the same day: the root cause as its own option

`omahaBigBetIsPotShare` (off by default, read `=== true`), separate from the option above. In PLO4 / PLO5 cash (high only) the Omaha aggressor tier no longer counts the 20 big blind big-bet mark for a turn or river wager under 70 percent of the pot it went into; 70 percent is the tier's own existing pot-share line, used on both streets. The flop, a wager of 70 percent or more, every other game and every other reader of the mark are unchanged; the weak-trips rule (V56) follows the tier. Receipt `omaha_big_bet_by_pot_share` when the tier differs from the old one. League cards plo4/plo5 `_omaha_big_bet_is_pot_share`. Evidence file `docs/horse-default-on.d/omahaBigBetIsPotShare.md`.

With only this option on, of the eleven recorded folds: against an unknown bettor four become calls on every seed (one best hand, three beaten two pairs); with the bettor's memory rows loaded five do (two best hands). The two sets facing a second or third barrel, the trips facing a third barrel and the flush on the paired board still fold: a second and third betting street raise the tier on their own, and the paired-board fold is a separate rule.
