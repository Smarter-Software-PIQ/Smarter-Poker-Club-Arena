# Heads-up hold'em: the opener and the limper defend to their price (two default-off options)

Date: 2026-11-14. Lane: heads-up (HU-NLH-010, HU-NLH-011; HU-NLH-013 not built). Status: two new Horse options, both
default OFF. No live decision changes, no schema change, no migration. Neither option is proposed for activation: the
owner's preflop range hold governs.

## Why

The heads-up audit measured three places where a Horse folds more than the price of the bet allows, and the Hold'em
lane passed them to this lane on 2026-11-14.

1. HU-NLH-010. The button (the small blind, heads-up) that opened folds 81.0 to 92.2% of its opens to a 3-bet across
   17 to 150bb and four sizings, 90.2% of 6,107 in play at 40bb. The 3-bettor breaks even at 62.5 to 66.7%. Pairs 22
   to 66, A2s to A9s, AJo, ATo, T9s and 98s folded in 20 of 20 seeds. Cause: two-handed tables never reach the V73
   per-seat read (it needs three or more dealt in), so the general bar decides, and it continues about the top tenth
   of all hands.
2. HU-NLH-011. The small blind limps 14 to 15% of cash deals to 50bb and folds 100% of those limps to a raise to 3bb,
   4bb, 6bb or all in, 98.8% of 2,672 in play at 40bb. A min-raise laying three to one is folded too. Cause: the limp
   band sits below every call bar of the single-raise branch.
3. HU-NLH-013. Turn and river folds run 4 to 34 points over break-even heads-up.

## What changed

Two options on `HorseDecideOpts`, read in one place each, on only when explicitly `true`:

- `huOpenerDefendsToPrice`. Heads-up no-limit hold'em cash, exactly two dealt in, hero made the only open and faces
  exactly one 3-bet of 1.8x to 7x that is not all in, 20 to 150bb effective. A hand the bars fold calls when its
  all-in equity against the 3-bettor's range, times 0.85, covers the rake-aware pot odds, under the same stack cap as
  the existing call.
- `huLimpDefendsToPrice`. Same table, hero limped the small blind and faces exactly one raise to 6bb or less that is
  not all in. The limp the bars fold calls when its all-in equity against the raiser's range, times 0.8, covers the
  rake-aware pot odds.

Both are the big blind rule (`huBbDefendsToPrice`, 2026-11-07) seen from the other seat, and reuse its equity table
(`HorseHuBbDefence.HU_BB_EQUITY`). Stated limits of that reuse, also written in the source:

- The table is written against the top W% of the heads-up open order, W from 20 to 100. It is read as a linear raising
  range of that width.
- With no read on the raiser the width is 20%, the narrowest column. The Horses' own big blind 3-bets about 9% of
  opens, so against an unread Horse the opener's reference is wider than the truth. The table has no narrower column.
- For the opener an engaged read of the raiser's re-raise share replaces the reference. For the limper no read
  measures a raise over a limp, so the reference is never widened. A read narrower than 20% stands either rule aside.
- The realisation shares (0.85 and 0.8) are assumptions set below one, not measurements.

Neither option adds a raise, changes a size or removes a call. Three or more dealt in, tournaments, Omaha, short deck,
pot limit, fixed limit, straddled pots, bomb pots and all-in-or-fold tables are untouched.

What the options do, over all 169 hand classes at 40bb through the real `HorseLogic.decide` (reads off):

- Opener, 2.5bb open, 3-bet to 8bb: 16 classes change, each from fold to call (22 to 77, A2s to A9s, K9s, QTs). To
  10bb: 13. To 20bb (8x, outside the band): none.
- Limper: 109 classes call a min-raise, 38 a raise to 2.5bb, 21 to 3bb, 3 to 4bb, none above 6bb. The Horses raise a
  limp to 3.5 to 4.5bb, so against a Horse this option does very little, which is what the price says.

## HU-NLH-013 was not built

The turn and river folds are made by the equity verdicts (`riverCallVerdict`, `evaluateSpot`) on an equity that has
already passed through the range read, six structural caps and the measured one-pair shades. The audit found the
over-fold shrinks sharply with the mind layer off and does not move with learning off, and that removing the river and
turn one-pair shades did not close it, but it did not isolate which of the mind layer's terms is responsible, and more
than forty places in the postflop path read that layer. A priced rule on the equity the brain already holds would
change nothing (the fold is made because that equity is under the price), and a rule on any other equity would be a
blanket call-more rule, which gives back the edge the Horse holds over every bet-everything style. No option was
written. The next step is the isolation run the audit names.

## Tests

- `server/src/engine/HorseHeadsUpOpenerAndLimperDefendToPrice.law.test.ts` (44 tests, new law): failing before
  the rule (6 fail with the two rule lines disabled), passing after. Every change is a fold that became a call; every
  called class has the equity the price asks for; a larger raise is called by fewer hands; eleven out-of-scope spots
  per option (three dealt, tournament, Omaha, short deck, fixed limit, pot-limit hold'em, all-in raise,
  all-in-or-fold, straddle, bomb pot, under 20bb, over 150bb) change nothing; explicit false equals unset for every
  class; each option leaves the other's spot alone; each option's receipt fires exactly on the classes whose final
  decision it changed (40bb and 25bb opener spots, 40bb min-raise limper spot), with telemetry leaving every
  decision as it is.
- `HorseDataLedger`: a flag row and a receipt row per option.
- League: `human_hu_opener_defends_vs_threebet_40bb` (against hu_three_bet_every_hand_v1) and
  `human_hu_limp_defends_vs_minraise_40bb` (against hu_minraise_every_button_v1, the one persona whose raise over a
  limp is the minimum). Both 40bb, option on against off.

## Review changes (independent review of 2017e96d)

- R1, receipt only. The opener receipt fired at the preflop intent stage, before the final dominated-offsuit layer
  (`HorseHoldemPremiumAggression` rule 1, `dominated_3bet_fold`), which folds offsuit unpaired non-AK hands facing a
  3-bet of 2.5x or more above 20bb effective (`PUSH_FOLD_EFFECTIVE_BB`, strict). At 40bb, 2bb open 3-bet to 6bb, it
  fired on 31 classes while 19 decisions changed. Both receipts are now deferred: `HorseLogic.decideInternal` emits
  them after every later owner, only when the final action is still the call (or a call for the whole stack). No
  decision can change: the rule, its gates and every layer are untouched; only where the counter is incremented moved.
- The 20bb versus 40bb difference in what the opener calls (31 against 19 classes at 2bb to 6bb) is that same layer,
  not the price: at 20bb effective it stands aside, at 21bb and deeper it folds those hands back.
- Added the pot-limit hold'em scope negative to the law test.

## Evaluation

Declared before any result in the heads-up lane's evidence folder (`evaluation/DECLARATION-HU-DEFENCE.md`); results
in `evaluation/RESULTS-HU-DEFENCE.md`, adverse cells kept. Heads-up NLH cash, 25bb and 40bb, against the horse mirror
and five heads-up human-field personas, 100,000 hands per cell, option on against off, run on 2017e96d (96 jobs, 0
failed, no deviation). Rule: an option passes when none of its 12 cells is below -2 standard errors.

- `huOpenerDefendsToPrice`: PASS, 12 of 12 cells, lowest z -1.31. Pooled mirror -0.08 +/- 0.25 bb/100, pooled
  personas +0.34 +/- 0.36; one clearly positive cell (wide small-blind aggressor, 40bb, +4.75 +/- 1.29).
- `huLimpDefendsToPrice`: PASS under the rule, but inert in 10 of 12 cells (it never acted). Only the min-raise
  persona cells move: +2.07 +/- 1.68 at 25bb and +3.51 +/- 2.50 at 40bb, neither significant. Against this field the
  option barely acts.

Both options stay default OFF. Neither is proposed for activation: the owner's preflop range hold governs.
