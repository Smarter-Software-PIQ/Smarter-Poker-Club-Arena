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
