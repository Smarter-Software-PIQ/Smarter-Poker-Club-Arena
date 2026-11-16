# Tight at the observation line (option styleTightMethodLine, default off)

**Date:** 2026-11-16
**Area:** Horse brain, no-limit hold'em opponent style read

## Why

On four builds the human-vs-Horse observation graded the tight criterion NOT MET for the same reason. The observation method classes a hold'em player tight at 50 or more hands with VPIP at or below 0.18 at a full table (0.30 short-handed). The people it found sat at VPIP 0.157 to 0.171 with PFR near 0.09. The style read left every one of them neutral: its own tight side needs VPIP credibly below the Horse mean minus a margin (about 0.156 on the long window), and the multi-signal route added on 2026-11-15 needs a corroborating raise share or fold to 3-bet, which a tight player who mostly calls does not have.

## CLASS-DEFINITIONS (declared before measurement, 2026-11-16)

Participation is unchanged when an earlier route calls it tight or loose. When every earlier route leaves it neutral, a no-limit hold'em player is TIGHT by the observation-line route iff all of:

1. At least 50 hands in the window read: the 120-hand long participation window when it holds more hands than the decayed counters, else the decayed counters.
2. VPIP of that window at or below the method line of the table size: 0.18 full, 0.30 short. Heads-up has no line and never qualifies.
3. VPIP credibly below the Horse VPIP mean of the cell: P(rate < mean) >= 0.90.
4. PFR of the window at or below the Horse PFR mean (the player does not raise more than the average Horse).
5. No contrary evidence: VPIP and call share not high.

Confidence is n / (n + 50), under the same low-side cap as every tight read.

Why condition 3 stays: the method line is a point estimate. At 50 hands, a player whose true VPIP equals the Horse mean (0.2133 full) shows 0.18 or less about one time in three (exact binomial: 0.355). The observation works on lifetime counts (the graded people had more than 1,000 hands); the engine reads a 120-hand window, so it keeps a credibility test. The margin below the mean is what is dropped.

Why no corroboration: a tight player who raises about half of what he plays is exactly who the observation kept finding. Condition 4 keeps out players who raise more than the average Horse; the existing routes already read those.

## What was measured

Synthetic counters only (aTightPlayerAtTheObservationLine.test.ts): the two graded people's rates (VPIP 0.1567 / PFR 0.0823 and VPIP 0.1669 / PFR 0.0914) read neutral with the option off and tight with it on, on a saturated long window; average and loose players read the same on and off; 0.18 on 60 hands stays neutral; the 50-hand minimum decides on a player every other condition admits (VPIP 0.13 / PFR 0.065: neutral at 48 long-window hands, tight at 52; the pure read refuses 49.9 and admits 50); the short-table line decides at VPIP 0.285 / PFR 0.15 (neutral off, tight on, and the full-table line would refuse it); fixed-limit hold'em is gated off; heads-up has no line.

## Limits

- Not measured against people or in the league yet; the league card `nlh_style_tight_method_line` is a harm check against a Horse field, where the route is expected to be near inert.
- On a window that is not saturated, a 0.167 player can fall short of the 90% test and stay neutral.
- The consumers are unchanged. Tight opener and tight re-raiser respect still need PFR credibly low on their own tests.
- The source default is OFF. Nothing changes until a switch row turns it on.
