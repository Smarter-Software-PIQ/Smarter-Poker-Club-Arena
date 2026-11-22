# omahaBandFallbackInBandUnit: Authority For The Live Switch

**State: OFF in source (read `=== true`), no switch row, Evidence NOT MET (unevaluated).** CORE-LAND, 2026-11-20 (lead order 12:23 AM Chicago, after lane DEPTH-GRADE).

## What It Does

simulateEquity's Omaha band fallback (the rejection path used when the reservoir cannot place an opponent hand in its read band) measures the drawn hand in the band's own percentile unit for PLO4/PLO5 high (HorseEval.omahaBandFallbackScore; AUDIT-FILES-B 5d700d07db9). Off (default) it measures the raw preflop score, exactly as every live decision was made. PLO6, hi-lo and every other game measure the raw score at any value. HorseLogic.decide sets the flag for the length of one decision and restores it.

## Why A Switch

The unit change went into the batch as a plain fix. On exact journal replay it moves 5 of 56 recorded PLO5 decisions with production options alone, and it takes the value raise from two very strong hands that raised live (hand 60178985 turn: live raise 199, batch call 64; hand 60167078 flop: live raise 130, batch call 34; replay by CORE-LAND on the batch + core tree with the unit change disabled returns both raises). No real-card grade exists for it yet, so it ships switchable, default OFF.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-20 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; the two-hand exact replay is in repairs/EMERG/CORE-LAND.md)
