# holdemOopReraiseRangeReadsOpenerRecord: Authority For The Live Switch

Built 2026-11-24 by PLO-LEAD-6 as the companion of `holdemOopReraiseRangeHoldsVsReraise` (#11917). Evidence NOT MET for switching on: the audited-decision scorer was not run and the record (`horse_exact_profiles.opener_response`, migration 20261124195144) starts empty at install. The league probes below are the grade. This file does not authorize switching the option on.

## What It Does

NLH cash. It applies only with `holdemOopReraiseRangeHoldsVsReraise` on, when the Horse is out of position facing one open with no caller.

The rule reads this opener's own record of answering a 3-bet in position (`HorseOpenerAnswersThreeBet`). Public actions only.

- His call : 4-bet split is his own: the 4-bet share is his posterior, and the rest of what does not fold is a call.
- The guard weight is w = min(1, his 4-bet share / 0.10).
  - A 3-bet the rule rejected stands at the seeded frequency 1 - w. This covers both a planned fold to the 4-bet and a price below the call.
  - The keep unit is a hash of the Horse's id, the pot and its own cards.
  - The receipt records it: `openerRecord`, with reasons `opener_record_planned_fold` and `opener_record_price`.
- With no record, w = 1 and the verdict is exactly that of `holdemOopReraiseRangeHoldsVsReraise` alone.
- It never adds a call or a 3-bet. Default OFF (read `=== true`). Off: byte-identical.

## Prior anchor

- Baseline: a 0.10 4-bet share of an opener's answers to a 3-bet. This is equilibrium-scale: a 100 bb opener facing an out-of-position 3-bet 4-bets roughly a tenth of the time. With no record the reader returns it, so the guard binds in full.
- Population weight: 0. The cash population of 2026-11-17..24, people and Horses pooled, 4-bets 2-9% in NLH and PLO4, on the exploitable side of the baseline. Letting it pull the anchor down would relax the guard against unmeasured openers.
- Own record: his decayed answers against the baseline worth 6 answers. At 30 answers his own record carries 83% of the rate. It is kept per player, game, format and table size, with a half-life of 30 opportunities.
- No unshown cards: the record is learned from the public action log only (fold, call or raise after his open was 3-bet; position from the blind posts). No hole card or showdown is read.

## League (chips), 2026-11-24

Harness: `server/scripts/oop-reraise-range/league.ts --record`. Both arms run the production options of 2026-11-24. ON adds `holdemOopReraiseRangeHoldsVsReraise` and this option. Every sandbox learns the record from its own hands, as the accepted-hand learner does for a live table. Heads-up exploit probes play 12,000 hands per arm on the same deals, and ON - OFF is differenced hand by hand. The probes:

- **a** 4-bets every out-of-position 3-bet.
- **b** 4-bets only with aces or kings.
- **c** calls every 3-bet.

| cell        | a             | b            | c           | fold to 4-bet vs a, OFF -> ON |
| ----------- | ------------- | ------------ | ----------- | ----------------------------- |
| NLH 100 bb  | +68.8 ± 8.2   | +1.9 ± 5.9   | -5.1 ± 7.7  | 76% -> 0%                     |
| NLH 300 bb  | +109.0 ± 13.2 | +16.8 ± 11.1 | +6.3 ± 12.5 | 82% -> 0%                     |
| PLO4 300 bb | +7.4 ± 5.9    | -7.1 ± 6.3   | -2.3 ± 4.5  | 75% -> 53% (n 83)             |

NLH 6-max mirror at 100 bb, 12,000 hands: ON -1.1 ± 2.2.

For comparison, `holdemOopReraiseRangeHoldsVsReraise` alone (#11917) graded NLH 100 bb at +62.1 / -25.4 / -14.4 and NLH 300 bb at +98.4 / -26.1 / -15.3.

A variant that scaled only the planned-fold guard by w (not the price) graded NLH 100 bb at +68.8 / -7.7 / **-20.6 ± 8.4** and NLH 300 bb at +109.0 / +5.1 / -14.4. NLH borrows the Omaha realization fit, and the price applied in full rejects 3-bets that win against a calling opener. Scaling the price by w as well met the bar, so no NLH realization was fitted.

Reading:

- No probe shows a significant loss. The always-4-bet opener is beaten clearly, and the mirror is within one standard error of 0.
- PLO4 at 300 bb heads-up still folds over the 0.45 cap against the always-4-bet script. That opener's record gives w = 1, so the guard is #11917's, and the keep table was fitted on six-max positions. Stated, not tuned.

## Replay

- Replay: NOT RUN (the audited-decision scorer was not run; the league probes above are the grade)
