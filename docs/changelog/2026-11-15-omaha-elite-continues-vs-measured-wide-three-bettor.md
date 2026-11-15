# Omaha: an elite hand continues against a measured wide 3-bettor (option, default off)

Date: 2026-11-15. Lane: PLO Strategy. One new option, off by default (read `=== true`): `omahaEliteContinuesVsMeasuredWideThreeBettor`.

## What happened

A decisions census (no outcomes) against the production PLO5 winner's measured rates (raises about 55% of hands, re-raises about 33%) showed that when a Horse opens and he 3-bets, elite-class hands fold 7-10% of the time in PLO4 and 31-34% in PLO5, and top-15% double-suited rundowns in the cutoff against his button 3-bet fold 53-64% in PLO5.

## Root cause

Against an observed maniac raiser every re-raise of the Horse's raise is decided by the maniac-price arithmetic in `HorseLogic.ts` (V38, with the V53 realization charge), before the range play. The range it samples is already wide (his whole raise width, about 70%). The fold comes from the price: on top of pot odds of 0.333 it adds the rake drag (to 0.370), a domination margin (0.04 PLO4, 0.06 PLO5) and a realization charge of 0.10 out of position, so a call priced at 33% needs 51% (PLO4) or 53% (PLO5) raw equity, estimated on 160-176 samples. A double-suited rundown has about 51%. PLO5 folds more because its bar is 2 points higher while its equities are no higher, and because its elite classes reach below the top 15% of hands.

## What changed

`HorseOmahaReadConditional.ts` gains a measured WIDE RE-RAISER read (15+ decayed hands, the presumption evidenced or disproved; 12+ decayed re-raise opportunities; re-raise rate credibly above the Horse mean at 0.9 with a shrunk mean of 0.15 or more; withdrawn by a recent window without re-raises; a presumed read never counts). With the option on, a fold the maniac-price arithmetic produces becomes a call when a PLO4/PLO5 cash Horse opened, faces exactly one re-raise heads-up against the price from a measured wide re-raiser, will be in position against him after the flop (owner 2026-11-15 11:49: out of position the fold stands), holds an elite-class hand the class read marks as a shallow 4-bet hand, and the call is under 40% of the stack at raw pot odds of 0.34 or less. It never creates a raise; the 4-bet logic is untouched. Receipts `omaha_elite_continues_vs_measured_wide_three_bettor` and `_withheld`. League cards plo4/plo5. Evidence file `docs/horse-default-on.d/omahaEliteContinuesVsMeasuredWideThreeBettor.md`. With the option unset or false the brain decides exactly as before.

## Decisions census

Only the in-position scenario (button open against a big-blind 3-bet) changes; there every fold of these hands becomes a call. The out-of-position scenarios, the unknown and tight arms and every open and squeeze cell are identical. Per-cell fold shares before and after: archive `plo-handoff-review-01a1cbbd/3betdef-20261115/census-diff.txt`.

## Evaluation

Not yet declared or run. The option stays off until it is.
