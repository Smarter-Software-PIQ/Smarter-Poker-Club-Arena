# omahaFlopFacingBetEv: where each constant comes from

Written 2026-11-18 by the PLO Strategy lane (session 013U37bXeyipeVLdczYpsQG1) with the follow-up that added the joint field and the measured realization. This file is not an authority file for a switch: it records the measurements behind the constants in `server/src/engine/HorseOmahaFlopFacingBetEv.ts`. Scripts, inputs and outputs: archive `plo-handoff-review-01a1cbbd/flopev2-013U37/` (`fit/`, `replay/`, `timing/`).

## Source of every measurement here

Production hand history, read with read-only SELECTs (the Supabase read-only query endpoint; nothing was written): PLO4 and PLO5 cash hands with at least one person seated, created 2026-11-06 00:00Z to 2026-11-18 00:20Z, 9,974 hands (5,379 of them the priced lane's set of 2026-11-13 19:40Z to 2026-11-17 19:40Z). Bomb pots and run-it-twice hands are left out (223).

Limits that apply to all of it: twelve days; the Horses' own later-street play in those days is in every money figure (it changed on 2026-11-16, see "Realization", cut by date); the calls measured are the calls the brain of those days chose to make, not the calls this option would add.

## Realization by hand class and position (`OMAHA_FLOP_EV_REALIZATION_FIT`)

Sample: the first flop call of a bet by a Horse, with no flop wager after the call and the hole cards of every player left at the end of the flop on record: 2,045 calls; the verdict answers 1,992 (the rest are outside its spot); 69 of those have no later decision (whole stack or nobody left who can bet) and take no factor. Fitted on 1,923 calls (PLO4 and PLO5 together).

For each call: X = chips the caller got back from the pot after the flop (its hand result plus everything it had put in through the flop call); S = the verdict's own share of the pot against everybody together, before any factor; P = the pot at the end of the flop less the hand's rake share; m = the runout model's factor; L = the share of the later streets left to play (0 to 1). The cell's `ratio` M solves, over its calls, sum X = sum S x P x (1 + (m x M - 1) x L). Intervals are bootstrap 95% over calls (4,000 resamples).

| cell                              | n     | ratio M | 95% interval  | returned / (S x P) | model factor (mean) | net of the calls, bb |
| --------------------------------- | ----- | ------- | ------------- | ------------------ | ------------------- | -------------------- |
| made hand, in position            | 281   | 1.13    | 0.61 to 1.64  | 1.03               | 0.92                | +4,250               |
| made hand, out of position        | 515   | 0.84    | 0.55 to 1.13  | 0.77               | 0.91                | +3,846               |
| draw, in position                 | 262   | 0.86    | 0.36 to 1.36  | 0.79               | 0.88                | +1,519               |
| draw, out of position             | 380   | 1.08    | 0.69 to 1.49  | 0.94               | 0.86                | +3,524               |
| one pair or less, in position     | 168   | 0.44    | -0.18 to 1.08 | 0.46               | 0.84                | -373                 |
| one pair or less, out of position | 317   | 0.69    | 0.28 to 1.10  | 0.62               | 0.80                | +146                 |
| all                               | 1,923 | 0.90    | 0.72 to 1.09  | 0.81               | 0.88                | +12,911              |

Classes (`omahaFlopHandClass`): made = two pair or better under the two-card rule; draw = below that with a flush draw or eight or more straight outs; otherwise one pair or less.

What the table says and does not say:

- No single cell is separated from 1 at 95%. One pair or less as a class (both positions, n 485) is: ratio 0.59, interval 0.24 to 0.94. Those calls made nothing (-228 bb over 485 calls) while their share of the pot was worth +3,457 bb.
- The base is the verdict's own share, so the ratio carries the error of its ranges too. Against the hands that were really left in, the callers' exact share averaged 0.400 where the verdict said 0.465 (heads-up 0.447 against 0.496; with a caller in 0.279 against 0.331). On exact equity instead of the verdict's share the same fit gives 1.27 / 1.02 / 0.95 / 1.19 / 0.49 / 0.87 (file `fit/FIT-OUTPUT-exact-basis.txt`); the code uses the verdict's own share because that is the number it multiplies.
- The one-opponent measurement of 2026-11-17 (84 calls of one winning player's bets: draws out of position -0.39, one pair or less -0.03, made hands 1.12) is not reproduced by the wider sample: draws out of position return as much as the verdict expects here. Against that one player the verdict still calls draws and pairs his numbers say to fold; there is no per-opponent realization read.
- Cuts not used by the code (same file): from 2026-11-16 the ratio is 0.82 (0.56 to 1.09, n 633) against 0.94 before; with only Horses left in 0.73 (0.46 to 0.99, n 880) against 1.00 with a person left in; bets under half the pot 0.70 (0.40 to 0.99) against 0.98 for larger ones. Sets and trips alone: 0.67 (0.18 to 1.12, n 215); straights and better 1.63 (0.96 to 2.33, n 116). None is in the code: each would be a further cell with a wider interval.

### Shrinkage (`OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS` = 180)

The factor applied is the model's factor times 1 + (M - 1) x n / (n + 180). The 180 is (spread of the ratio per call / uncertainty of the model's factor) squared: the spread per call is measured (bootstrap standard error times the square root of n: 3.4 to 4.4 by cell, 4.1 over all; 4.0 used); the uncertainty of the model's factor, 0.3, is stated, not measured. Multipliers that result: made 1.08 in position, 0.88 out; draw 0.92 in, 1.05 out; one pair or less 0.73 in, 0.80 out.

### Check on the same calls (not an independent test)

With the fitted cells, the verdict would have kept 1,618 of the 1,992 recorded calls and folded 374. The kept calls returned +11.0 bb per call (standard error 2.2) where the verdict's EV averaged +12.9; the folded ones returned +2.7 bb per call (standard error 3.2) where the verdict's EV averaged -1.9 (file `fit/VALIDATE-OUTPUT.txt`). The folds give up nothing that can be told from zero.

## Later streets by what is left to bet (`OMAHA_FLOP_EV_REALIZATION_FULL_BEHIND` = 1)

Stated, not measured: nothing behind after the call is no later decision (factor 1); a pot or more behind is the whole factor; a straight line between. It replaces a step (no factor at or under a tenth of the pot behind, the whole factor above it). The fit above was made with this line in place.

## Continue rate of a player still to act (`OMAHA_FLOP_EV_BEHIND_CONTINUE`)

Every decision facing the first flop bet of a hand (before any raise), any player: 8,875 decisions, 46.7% continued (95% 45.6 to 47.7), 6.8% raised.

| bet as a share of the pot | n     | continued | 95% (Wilson) | point used (share, rate) |
| ------------------------- | ----- | --------- | ------------ | ------------------------ |
| under 0.25                | 576   | 79.2%     | 75.7 to 82.3 | 0.125, 0.792             |
| 0.25 to 0.5               | 2,882 | 60.7%     | 58.9 to 62.4 | 0.375, 0.607             |
| 0.5 to 0.8                | 2,860 | 40.7%     | 38.9 to 42.5 | 0.65, 0.407              |
| 0.8 and over              | 2,557 | 30.3%     | 28.5 to 32.1 | 1.0, 0.303               |

Straight lines between the points, flat outside them. Horses and people are pooled (Horses continued less than people in these days: 37.6% against 66.8% on the first 5,662 hands). A player behind who continues is priced as a caller (his call in the pot, a holding from the caller's range); that he may raise instead is not priced.

## Line (`OMAHA_FLOP_EV_STAB` = 0.9; `OMAHA_FLOP_EV_LEAD` = 0.8 unchanged)

How often the first flop bet was made, by who could make it:

| who                                                   | opportunities | bet   | rate  | 95% (Wilson) |
| ----------------------------------------------------- | ------------- | ----- | ----- | ------------ |
| the preflop raiser (continuation bet)                 | 6,332         | 3,777 | 59.6% | 58.4 to 60.9 |
| a player acting before the live preflop raiser (lead) | 6,686         | 339   | 5.1%  | 4.6 to 5.6   |
| a player the preflop raiser had checked to (stab)     | 2,249         | 695   | 30.9% | 29.0 to 32.8 |

The lead factor 0.8 is the first cut's (stated). The stab factor is placed between it and 1 by where the stab rate sits between the lead rate and the continuation-bet rate: 0.8 + 0.2 x (0.309 - 0.051) / (0.596 - 0.051) = 0.89, used as 0.9. The frequencies are measured; that the factor moves in a straight line with them is stated.

## Sampling (`OMAHA_FLOP_EV_POOL`, `_RIVERS`, `_VALUE_PER_RUNOUT`, `_OTHER_PER_RUNOUT`)

Pool 1,280 holdings (the first cut drew 320: a raise's or a lead's value region was 46 to 58 holdings, now 184 to 230). Runouts: a balanced design, every unseen card the turn card of 12 runouts heads-up (8 with one other player, 6 with two, 4 with three or more) and the river card of as many; on each runout two holdings of the bettor's value region and one of his others, each with one holding for every other player on disjoint cards. PLO5 heads-up: 528 runouts, 1,584 showdowns of the bettor.

Sampling error, measured: the 357 flop decisions of the 2026-11-17 audit replay that the verdict answers, each drawn again on eight other seeds (the decision itself always uses the one seed its cards give). Standard deviation of EV across seeds as a share of the pot, against the margin of 0.02:

| field              | decisions | median | 90th percentile | largest |
| ------------------ | --------- | ------ | --------------- | ------- |
| all                | 357       | 0.0126 | 0.0218          | 0.0376  |
| heads-up           | 166       | 0.0110 | 0.0182          | 0.0348  |
| one other player   | 114       | 0.0140 | 0.0220          | 0.0255  |
| two or more others | 77        | 0.0146 | 0.0266          | 0.0376  |

The median is under the margin in every row; the 90th percentile is under it heads-up and just over it with others in. 23 of the 357 decisions change their answer on at least one of the eight other seeds: they are within that error of the margin. A layout at the first cut's cost in the same sampler (4 rivers, 6 holdings per runout) measured 0.0178 median and 0.0283 at the 90th percentile; brute force buys precision slowly (twice the showdowns: 0.0135), which is why the count stops here.

Time, measured with the wave-two timing harness (the same generated states, 400 decisions per cell, the 2026-11-16 production option list with and without the option, machine load 12 to 14; archive `flopev2-013U37/timing/TIMING-flop.txt`), against the engine's mark of 80 ms per decision:

| game | flop decisions | production list p50 / p99 | with the option p50 / p99 | over 80 ms with the option |
| ---- | -------------- | ------------------------- | ------------------------- | -------------------------- |
| PLO4 | 800            | 3.2 / 16.3 ms             | 16.7 / 23.3 ms            | 0 of 800                   |
| PLO5 | 800            | 3.1 / 22.6 ms             | 25.8 / 34.8 ms            | 2 of 800                   |

The two PLO5 decisions over the mark: 132.2 ms on the generated state that takes 102.0 ms without the option (the same state the first cut's table reported), and one of 82.2 ms. Decisions the verdict answered: PLO4 398, p50 20.6, p99 23.5 ms; PLO5 403, p50 31.0, p99 34.9 ms. The first cut measured 27.4 and 36.7 ms at p99 under a load of 45 to 50; the two tables were not taken under the same load.

## Still stated, not measured

The flop value shares and non-value shares by bet size and for a raise (`OMAHA_FLOP_EV_VALUE_SHARE`, `OMAHA_FLOP_EV_PRIOR_OTHER`); the caller's range share 0.55 and the all-in share; the bounds and check-down shares of the runout model; the 0.3 in the shrinkage; the straight line of the stab factor; the full-behind point. The measured share error above (0.465 against 0.400) says the ranges are too weak on average; they were not refitted here.
