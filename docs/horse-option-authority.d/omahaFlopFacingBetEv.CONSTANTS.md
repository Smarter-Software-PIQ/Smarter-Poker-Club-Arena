# omahaFlopFacingBetEv: where each constant comes from

Written 2026-11-18 by the PLO Strategy lane (session 013U37bXeyipeVLdczYpsQG1) with the follow-up that added the joint field and the measured realization; the realization cells re-derived from the lane's shared realization table the same day. This file is not an authority file for a switch: it records the measurements behind the constants in `server/src/engine/HorseOmahaFlopFacingBetEv.ts`. Scripts, inputs and outputs: archive `plo-handoff-review-01a1cbbd/flopev2-013U37/` (`fit/`, `replay/`, `timing/`).

## Source of every measurement here

Production hand history, read with read-only SELECTs (the Supabase read-only query endpoint; nothing was written): PLO4 and PLO5 cash hands with at least one person seated, created 2026-11-06 00:00Z to 2026-11-18 00:20Z, 9,974 hands (5,379 of them the priced lane's set of 2026-11-13 19:40Z to 2026-11-17 19:40Z). Bomb pots and run-it-twice hands are left out (223).

Limits that apply to all of it: twelve days; the Horses' own later-street play in those days is in every money figure (it changed on 2026-11-16, see "Realization", cut by date); the calls measured are the calls the brain of those days chose to make, not the calls this option would add.

## Realization by hand class and position (`OMAHA_FLOP_EV_REALIZATION_FIT`)

Source: the lane's shared realization table, archive `plo-handoff-review-01a1cbbd/realfit-013U37/REALIZATION-FIT-20261118.md` and `realization-fit.json` (sha256 0cd708ff5f5e15c6b4180362caef5c0cabfc4e4fab5382f0ddd45cbac889ad13): 21,024 PLO4/PLO5 cash hands with a person seated (2026-10-15 to 2026-11-18), read-only; realization = chips realized / (EXACT equity against the hands really left in x the pot at stake, net of rake), clustered standard errors, hierarchical continuous shrinkage (street, class, position, field, SPR, variant). Table used: Horse callers, all bettors, flop (4,059 calls). Method check of that table: calls with no later decision realize 0.975 +- 0.019.

Its classes pooled into the verdict's by equity mass (sum of E x P), shrunk values:

| verdict cell                      | table cells                | n     | realization (shrunk) | SE    |
| --------------------------------- | -------------------------- | ----- | -------------------- | ----- |
| made, in position                 | two pair+                  | 504   | 0.900                | 0.058 |
| made, out of position             | two pair+                  | 829   | 0.810                | 0.056 |
| draw, in position                 | nut/combo draw + weak draw | 333   | 0.891                | 0.055 |
| draw, out of position             | nut/combo draw + weak draw | 510   | 0.950                | 0.054 |
| one pair or less, in position     | one pair + air             | 747   | 0.639                | 0.052 |
| one pair or less, out of position | one pair + air             | 1,136 | 0.657                | 0.052 |

FROM EXACT EQUITY TO THIS VERDICT. The table's realization is on exact equity; the verdict multiplies its own share of the pot against MODELLED ranges, which runs high. On the lane's 2,010 first flop calls by a Horse with every remaining hand known (9,974 hands, 2026-11-06 to 2026-11-18; starting stacks corrected, see below), exact share over the verdict's share is 0.94 / 0.82 (made IP / OOP), 0.91 / 0.94 (draw), 0.92 / 0.78 (one pair or less); over all calls the verdict's share is 0.457 where the exact one is 0.403 (n 2,045). So each cell's `ratio` is solved on those calls: the multiplier M on the model's factor for which

    sum S x P x (1 + (m x M - 1) x L)  =  R x sum E x P

(S the verdict's share, E the exact share, P the pot at the end of the flop net of rake, m the model's factor, L the share of later streets left to play, R the table's realization). Script `flopev2-013U37` SSD1 `fit/fit2.py`, output `fit/FIT2-OUTPUT.txt`:

| cell                              | exact / verdict share | model factor (mean) | ratio M | 95% (from the table's SE) | multiplier applied |
| --------------------------------- | --------------------- | ------------------- | ------- | ------------------------- | ------------------ |
| made, in position                 | 0.937                 | 0.919               | 0.892   | 0.76 to 1.02              | 0.909              |
| made, out of position             | 0.824                 | 0.915               | 0.688   | 0.58 to 0.80              | 0.720              |
| draw, in position                 | 0.910                 | 0.874               | 0.900   | 0.77 to 1.03              | 0.922              |
| draw, out of position             | 0.943                 | 0.860               | 1.027   | 0.90 to 1.15              | 1.023              |
| one pair or less, in position     | 0.916                 | 0.813               | 0.576   | 0.43 to 0.72              | 0.624              |
| one pair or less, out of position | 0.781                 | 0.798               | 0.518   | 0.40 to 0.64              | 0.555              |

Classes (`omahaFlopHandClass`): made = two pair or better under the two-card rule; draw = below that with a flush draw or eight or more straight outs; otherwise one pair or less. The table's classes are not drawn on exactly the same line (a one-pair hand with a nut draw is its "nut/combo draw" and the verdict's "draw"; a non-nut flush draw is its "weak draw" and the verdict's "draw").

Not used, stated so nobody reads them in: the table's raw (unshrunk) values give 1.01 / 0.75 / 0.79 / 1.15 / 0.57 / 0.64 and ratios 1.02 / 0.63 / 0.78 / 1.26 / 0.48 / 0.49 (`fit/FIT2-OUTPUT-raw.txt`; the weak-draw out-of-position cell, 1.86 on n 117, is what moves the draw row). PLO4 realizes less than PLO5 on the flop in the table (0.66 against 0.85, 1.9 SE): the cells are pooled over both games, so the verdict credits PLO4 calls more than PLO4 measured and PLO5 less. The table's selection (only hands the Horses called; one person is 35% of person-caller records) is in its own file.

THE FIRST FIT IS WITHDRAWN. The cells of 2026-11-18 01:15Z came from this lane's own fit of those calls, whose input read `players[].stack` (the stack AFTER the hand) as the starting stack (found by the realfit agent; hand 55663602 seat 5: stack 0, net -110.1 bb). That made the chips left behind, and so L, wrong on every record (67 records had no chips behind that do). Corrected (start = stack after - net), the lane's own fit gives ratios 0.95 / 0.56 / 0.58 / 1.06 / 0.47 / 0.59 (`fit/FIT-OUTPUT-v2.txt`), in the same direction as the table; the code uses the table.

### Shrinkage (`OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS` = 95)

The factor applied is the model's factor times 1 + (M - 1) x n / (n + 95), n the table's calls in the cell. The 95 is (spread of the realization per call / uncertainty of the model's factor) squared: the spread per call is measured in the table (flop SE 0.046 x sqrt(4,059) = 2.92); the uncertainty of the model's factor, 0.3, is stated, not measured. The table's values are already shrunk toward their parents; this second, continuous pull is toward the runout model.

### Check on the same calls (not an independent test)

With these cells the verdict keeps 1,473 of the 2,045 recorded calls and folds 572. The kept calls returned +7.1 bb per call (standard error 2.5) where the verdict's EV averaged +12.4; the folded ones returned -1.0 bb per call (standard error 3.0) where the verdict's EV averaged -2.8 (`fit/VALIDATE-OUTPUT-v2.txt`). The folds give up nothing that can be told from zero.

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

With the realization cells of the shared table (the cells above; a smaller factor makes EV less sensitive to the count) the same 357 decisions measure 0.0101 median, 0.0197 at the 90th percentile and 0.0307 at most; 19 change their answer on at least one of the eight other seeds (`replay/SD-c.txt`). The time table was measured on the build with the withdrawn cells; the cells are constants and change no work done per decision.

## Still stated, not measured

The flop value shares and non-value shares by bet size and for a raise (`OMAHA_FLOP_EV_VALUE_SHARE`, `OMAHA_FLOP_EV_PRIOR_OTHER`); the caller's range share 0.55 and the all-in share; the bounds and check-down shares of the runout model; the 0.3 in the shrinkage; the pooling of the table's classes into the verdict's three; the straight line of the stab factor; the full-behind point. The measured share error above (0.465 against 0.400) says the ranges are too weak on average; they were not refitted here.
