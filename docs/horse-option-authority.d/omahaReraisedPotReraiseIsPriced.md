# omahaReraisedPotReraiseIsPriced: Authority For The Live Switch

Built 2026-11-24 by the PLO lead-6 re-raised-pot lane with `omahaReraisedPotCallIsPriced` (the full evidence, realization fit and grading are in docs/horse-option-authority.d/omahaReraisedPotCallIsPriced.md). Evidence NOT MET: it stays OFF until it has been shadowed. Default off (read `=== true`), switchable live, PLO4/PLO5 cash only. This file does not authorize switching it on.

## What It Does

PLO4/PLO5 cash, preflop, facing a 3-bet or more (the same spot and the same price, `HorseOmahaReraisedPotPricedRule.ts`):

- a standing RE-RAISE (a 4-bet or more, an all-in that raises) stands only when EV(re-raise) >= max(EV(call), 0) - 1% of the pot after the call; otherwise it becomes the priced call (EV(call) >= 0) or the fold. Its size is never changed. (Audit leaks 6 and 9: 4-bets without the price.)
- a standing CALL becomes the pot-size re-raise (the whole stack when that is all the chips) only when EV(re-raise) > max(EV(call), 0) + 1% of the pot after the call. No fold is ever turned into a re-raise.

EV(re-raise) = F x pot + (1 - F) x [R_aggressor x equity2 x (pot2 - rake) - risk], with F = the re-raiser's fold to the re-raise times every other player's cold fold, equity2 against the re-raiser's range narrowed to the share that continues, R_aggressor from the self-play fit by position and depth.

## Prior anchor

- Baseline: the 3-bettor facing a 4-bet folds 0.45 (self-play PLO5 6-max 100 bb: 0.493 of 1,688; at 300 bb the self-play 0.739 is the Horses' documented over-fold of the 3-bet range deep, not a baseline); the 4-bettor facing a 5-bet 0.2; a player who must call a 4-bet cold folds 0.768 (self-play, 898).
- Population weight: the pooled live answer of all players to a Horse re-raise (0.187 of 284 facing a 4-bet; 0.043 of 23 facing a 5-bet) carries 2 pseudo-opportunities against the baseline's 6: reduced, because the live population is on the exploitable side (persons folded 0 of 196 4-bets).
- Own record: the re-raiser's own decayed answers at that node (HorseMind.omahaReraiseResponseOf) are added to the 8 prior pseudo-opportunities and dominate from about ten; a player who never folds to a 4-bet is priced with almost no fold equity (the audit's most frequent 3-bettor: 0 folds in 36 decayed answers, F about 0.07).
- No unshown cards: fitted on league self-play only; production supplies public counters only.

## Replay

- Replay: NOT RUN (built 2026-11-24; graded with omahaReraisedPotCallIsPriced, see that file)
