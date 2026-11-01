# Hold'em horse V63-V69 PRE-DEPLOY baseline, 2026-10-31 (read-only)

This is the "before" side of the post-deploy comparison for the decision classes V63-V69 change.
It was taken while engine `eed06fe5` was serving (`curl -s https://engine.smarter.poker/health` ->
`version` = `eed06fe5`, read 2026-10-31 17:11 UTC). That revision (2026-10-29, #8523) has no
V6x `noteFire` stamps at all, V61 included, so every hand here was played without V61-V69.

- Source: `public.horse_hand_reviews`, `game_variant = 'nlh'`, cash = `tournament_id IS NULL`,
  MTT = `tournament_id IS NOT NULL`.
- Window: `played_at >= '2026-10-30 17:15:00+00' AND played_at < '2026-10-31 17:15:00+00'`
  (24 hours, fixed bounds so it can be reproduced). Every row was used (no hash sample):
  cash 8,503 hands, MTT 5,675 hands.
- SELECT only. Each call also ran `CREATE OR REPLACE FUNCTION pg_temp.cls` (session temp schema) and
  `SET LOCAL enable_nestloop = off`. Nothing was written. Each pipeline call took 5-7 s. The DB
  function call and the telemetry read were sub-second.
- Script: `scripts/horse-measure/horse-v63-v69-measure.py`. Raw outputs:
  `docs/horse-measure/2026-10-31/results/v63-v69-baseline-2026-10-31/{cash,mtt,fn,telemetry}.json`.

## How to re-run (post-deploy)

Pick a window that starts after the containing revision serves, for example
`[2026-11-01 10:05+00, 2026-11-02 10:05+00)` (04:05 Chicago, which is CST from 2026-11-01, so 10:05 UTC;
confirm the actual activation time in the release record). Use the same 24-hour length, or divide by it.

- With a connection string in `$DATABASE_URL` (psql; every statement runs inside `BEGIN ... ROLLBACK`):
  `python3 horse-v63-v69-measure.py run '<since>' '<until>' > horse-v63-v69-after.md`
- Through the Supabase MCP `execute_sql`, run one call per printed statement, save each JSON result, then render:
  ```
  python3 horse-v63-v69-measure.py sql cash '<since>' '<until>'     # add --chunks 2 --chunk 0|1 if a call nears 20 s
  python3 horse-v63-v69-measure.py sql mtt  '<since>' '<until>'
  python3 horse-v63-v69-measure.py fn-sql '<since>'                  # fn_horse_river_one_pair_calls(since, 20000)
  python3 horse-v63-v69-measure.py telemetry-sql <first-day> <last-day>
  python3 horse-v63-v69-measure.py render --window '<since>, <until>' --engine <version> \
      --cells cash.json mtt.json --fn fn.json --telemetry telemetry.json
  ```

## Definitions (the leak report's pipeline, `leak_pipeline.py`, postflop part)

Hand classes are hero against the board: `one_pair:top` (overpair or top-board pair), `one_pair:under`,
`two_pair_plus` (includes board-made straights and flushes), `draw` (flop/turn only), `air`. Size =
toCall / (pot before the wager), read from the decision's `publicNode`. A decision is the horse's FIRST
voluntary action on that street facing toCall > 0. "Not after own bet" means the horse had not
bet earlier on that street. `won` = net_bb > 0. `net` = the whole hand's net_bb (leak-report convention).
"Calls" = `call` plus `call_allin` (an all-in with no `isFullRaise`). An all-in that is a full raise
is `raise_allin` and is never counted as a call.

1. River one-pair call, facing a wager the horse did not make. `vs_raise` (two or more river aggressions
   before the call) is split out. `fn_horse_river_one_pair_calls` is recorded verbatim beside it. That
   function differs on purpose: it has no until bound and no cash/MTT split, it drops paired boards,
   it includes calls made after the horse's own bet was raised, and it buckets `large` = >= 0.7 pot or
   facing a raise.
2. River raise: the horse's first river raise of a wager (including a re-raise after its own bet), by
   its river class and by the size of the wager it raised.
3. Turn one-pair call, facing a wager the horse did not make, by size. The V69 gap 1 split covers
   wagers >= 0.7 pot. `short` = V68 effective stack behind after the call, which is
   min(hero stack - toCall, max over unfolded opponents of stack + street bet - currentBet), below
   1.5 x (pot + toCall). Stacks and statuses come from `publicNode.seats` tuples
   `[seat, stack, streetBet, total, ante, _, status]`, where status 0 = active, 1 = folded and 2 = all-in.
4. Flop/turn bet-raised-call: the horse bet the street, faced a raise, and called (`call` only, the
   leak report's convention). Call-all-in is shown on its own line.
5. River bet-raised: the horse's first river bet with no earlier river aggression, then raised. Call,
   call-all-in or all-in re-raise, by raise size. Bets, raised and raised% give the raise frequency.
6. Turn high card (air / draw) call, facing a wager the horse did not make, by size and depth.

## Caveats

- **|net| >= 20bb selection.** `horse_hand_reviews` keeps only hands with |net_bb| >= 20. A call that
  wins a small pot is missing and a call that loses 20bb+ is included, so call cells lean negative.
  Folds appear only when the horse had already put 20bb+ in. Compare before and after on this same
  subset only. The win rates are big-pot win rates, not EV.
- 24 hours of full data, not the leak report's 12% x 7-day sample. Rates can be compared with the
  report; raw n and net are about 1/7 of a week at 100%, not the report's sampled counts. Cells under
  n = 50 are noise (for example, every MTT V64 cell).
- Cash cells 1, 2, 4 and 5 come from the first full-cash run. Cells 0, 3 and 6 come from a second
  identical run with the corrected stack read (below). The SQL is otherwise the same and the 8,503-hand
  totals match. The first run's cell 3/6 totals (before depth was readable) equal the second run's deep + short sums on every cell checked.
- **Side finding about the original pipeline.** `leak_pipeline.py` read the hero stack with a lax jsonpath
  (`'$.seats[*] ? (@[0] == $s)'`). Lax mode unwraps the seat tuples before the filter, so `hstack` was
  always NULL. The leak report's other cells do not use it, but its preflop all-in section (2.5) never
  detected "call for the stack" (`act = 'call' AND hstack <= tocall`), and `pf_stack_bb` was NULL. This
  script uses `strict`.
- **Telemetry.** `horse_brain_telemetry` (`day, feature, fires, updated_at`; written each minute by
  `fn_horse_brain_flush_receipt` from `services/BrainTelemetryFlush.ts`) is live: about 880 features on
  2026-10-31, last updated 17:24 UTC. It has no `v6*` feature on 2026-10-28 through 10-31. All ten
  requested receipts (plus `v66_raise_stratum`) are 0 on both days, as expected for `eed06fe5`.

Window: `[2026-10-30 17:15:00+00, 2026-10-31 17:15:00+00)` (played_at, UTC). Serving engine at measurement: `eed06fe5`.

- cash: 8,503 parsed nlh review hands, 4,106 won, net -9,644 bb (chunk elapsed: 00:00:06.96 (cells 1,2,4,5) + 00:00:04.85 (cells 0,3,6, strict hstack))
- mtt: 5,675 parsed nlh review hands, 3,004 won, net +14,546 bb (chunk elapsed: 00:00:05.97)

### Key table (calls = call + call-all-in unless noted)

| cell | cash n | won | win% | net bb | MTT n | won | win% | net bb |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 River one-pair call vs a bet (not after own bet), <0.4 pot | 109 | 24 | 22.0% | -4,788 | 86 | 26 | 30.2% | -2,022 |
| 1   same, 0.4-0.7 pot | 331 | 77 | 23.3% | -13,170 | 133 | 22 | 16.5% | -5,222 |
| 1   same, 0.7-1.05 pot | 267 | 46 | 17.2% | -15,155 | 89 | 23 | 25.8% | -2,820 |
| 1   same, >=1.05 pot | 165 | 12 | 7.3% | -12,246 | 42 | 5 | 11.9% | -2,351 |
| 2 River RAISE holding one pair (V64) | 71 | 25 | 35.2% | -2,840 | 22 | 8 | 36.4% | -660 |
| 2 River RAISE holding air (V64) | 28 | 3 | 10.7% | -984 | 13 | 2 | 15.4% | -382 |
| 3 Turn one-pair call vs a bet, <0.4 pot (V65) | 204 | 83 | 40.7% | -1,813 | 59 | 32 | 54.2% | +213 |
| 3   same, 0.4-0.7 pot | 564 | 189 | 33.5% | -11,370 | 343 | 141 | 41.1% | -2,307 |
| 3   same, 0.7-1.05 pot | 336 | 66 | 19.6% | -15,730 | 235 | 80 | 34.0% | -5,506 |
| 3   same, >=1.05 pot | 184 | 21 | 11.4% | -9,745 | 95 | 27 | 28.4% | -2,987 |
| 3   >=0.7 pot, SHORT behind (V69 gap 1) | 148 | 16 | 10.8% | -13,153 | 204 | 70 | 34.3% | -5,224 |
| 3   >=0.7 pot, deep behind | 372 | 71 | 19.1% | -12,322 | 126 | 37 | 29.4% | -3,268 |
| 4 Flop bet-raised-CALL, one pair/air (V66) | 799 | 244 | 30.5% | -32,346 | 391 | 134 | 34.3% | -10,064 |
| 4 Turn bet-raised-CALL, one pair/air (V66) | 549 | 169 | 30.8% | -19,588 | 261 | 96 | 36.8% | -5,026 |
| 5 River one-pair bet-raised-call/jam (V67) | 167 | 25 | 15.0% | -10,476 | 55 | 6 | 10.9% | -2,658 |
| 6 Turn high-card call vs a bet, air (V68) | 132 | 24 | 18.2% | -3,010 | 102 | 24 | 23.5% | -1,746 |
| 6 Turn high-card call vs a bet, draw (V68) | 237 | 87 | 36.7% | -1,597 | 125 | 51 | 40.8% | -921 |

Columns: n = decisions in the class, won = hands with net_bb > 0, net = whole-hand net_bb summed (leak-report convention), avg frac = wager / pot before the wager, avg call = toCall in bb. "folds" = folds at the same decision point (fold share of all call+fold decisions).

### 1. River one-pair CALLS facing a wager the horse did not make (V61/V63), call + call-all-in

| seg | class | size | n | won | win% | net bb | avg frac | avg call bb | folds |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| cash | one pair (all) | a<0.4 | 109 | 24 | 22.0% | -4,788 | 0.26 | 21.9 | 21 (16.2%) |
| cash | one pair (all) | b0.4-0.7 | 331 | 77 | 23.3% | -13,170 | 0.56 | 37.1 | 116 (26.0%) |
| cash | one pair (all) | c0.7-1.05 | 267 | 46 | 17.2% | -15,155 | 0.87 | 49.3 | 105 (28.2%) |
| cash | one pair (all) | d>=1.05 | 165 | 12 | 7.3% | -12,246 | 1.23 | 60.8 | 98 (37.3%) |
| cash | one pair (all) | all | 872 | 159 | 18.2% | -45,360 | 0.75 | 43.4 | 340 (28.1%) |
| cash | one_pair:top | a<0.4 | 59 | 16 | 27.1% | -2,955 | 0.28 | 28.8 | 10 (14.5%) |
| cash | one_pair:top | b0.4-0.7 | 182 | 49 | 26.9% | -6,612 | 0.57 | 42.1 | 44 (19.5%) |
| cash | one_pair:top | c0.7-1.05 | 179 | 33 | 18.4% | -11,559 | 0.89 | 55.5 | 36 (16.7%) |
| cash | one_pair:top | d>=1.05 | 129 | 10 | 7.8% | -10,068 | 1.23 | 62.5 | 26 (16.8%) |
| cash | one_pair:top | all | 549 | 108 | 19.7% | -31,194 | 0.80 | 49.8 | 116 (17.4%) |
| cash | one_pair:under | a<0.4 | 50 | 8 | 16.0% | -1,833 | 0.24 | 13.9 | 11 (18.0%) |
| cash | one_pair:under | b0.4-0.7 | 149 | 28 | 18.8% | -6,558 | 0.55 | 31.0 | 72 (32.6%) |
| cash | one_pair:under | c0.7-1.05 | 88 | 13 | 14.8% | -3,596 | 0.83 | 36.7 | 69 (43.9%) |
| cash | one_pair:under | d>=1.05 | 36 | 2 | 5.6% | -2,178 | 1.26 | 54.9 | 72 (66.7%) |
| cash | one_pair:under | all | 323 | 51 | 15.8% | -14,166 | 0.66 | 32.6 | 224 (41.0%) |
| mtt | one pair (all) | a<0.4 | 86 | 26 | 30.2% | -2,022 | 0.26 | 16.1 | 12 (12.2%) |
| mtt | one pair (all) | b0.4-0.7 | 133 | 22 | 16.5% | -5,222 | 0.56 | 32.7 | 51 (27.7%) |
| mtt | one pair (all) | c0.7-1.05 | 89 | 23 | 25.8% | -2,820 | 0.86 | 42.5 | 29 (24.6%) |
| mtt | one pair (all) | d>=1.05 | 42 | 5 | 11.9% | -2,351 | 1.63 | 50.6 | 20 (32.3%) |
| mtt | one pair (all) | all | 350 | 76 | 21.7% | -12,415 | 0.69 | 33.3 | 112 (24.2%) |
| mtt | one_pair:top | a<0.4 | 46 | 16 | 34.8% | -1,088 | 0.26 | 18.8 | 3 (6.1%) |
| mtt | one_pair:top | b0.4-0.7 | 75 | 17 | 22.7% | -2,800 | 0.57 | 36.4 | 11 (12.8%) |
| mtt | one_pair:top | c0.7-1.05 | 57 | 18 | 31.6% | -1,743 | 0.86 | 48.8 | 12 (17.4%) |
| mtt | one_pair:top | d>=1.05 | 31 | 5 | 16.1% | -1,756 | 1.62 | 51.2 | 6 (16.2%) |
| mtt | one_pair:top | all | 209 | 56 | 26.8% | -7,387 | 0.74 | 38.1 | 32 (13.3%) |
| mtt | one_pair:under | a<0.4 | 40 | 10 | 25.0% | -934 | 0.26 | 13.1 | 9 (18.4%) |
| mtt | one_pair:under | b0.4-0.7 | 58 | 5 | 8.6% | -2,422 | 0.56 | 28.0 | 40 (40.8%) |
| mtt | one_pair:under | c0.7-1.05 | 32 | 5 | 15.6% | -1,077 | 0.86 | 31.2 | 17 (34.7%) |
| mtt | one_pair:under | d>=1.05 | 11 | 0 | 0.0% | -595 | 1.65 | 49.1 | 14 (56.0%) |
| mtt | one_pair:under | all | 141 | 20 | 14.2% | -5,028 | 0.63 | 26.1 | 80 (36.2%) |

Same cell, facing a raise (st_aggr >= 2, counted "large" by the DB function) vs a single bet, all sizes:

| seg | class | size | n | won | win% | net bb | avg frac | avg call bb | folds |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| cash | one pair vs_bet | all | 871 | 159 | 18.3% | -44,970 | 0.75 | 43.2 | 340 (28.1%) |
| cash | one pair vs_raise | all | 1 | 0 | 0.0% | -390 | 0.34 | 233.8 | 0 (0.0%) |
| mtt | one pair vs_bet | all | 350 | 76 | 21.7% | -12,415 | 0.69 | 33.3 | 112 (24.2%) |
| mtt | one pair vs_raise | all | 0 | 0 | - | +0 | - | - | - |

`fn_horse_river_one_pair_calls` (verbatim; no until bound, no cash/MTT split, unpaired boards only, latest 20,000 rows):

```json
{
 "cells": [
  {
   "won": 41,
   "calls": 145,
   "sizeClass": "small"
  },
  {
   "won": 76,
   "calls": 373,
   "sizeClass": "medium"
  },
  {
   "won": 99,
   "calls": 630,
   "sizeClass": "large"
  }
 ],
 "limit": 20000,
 "since": "2026-10-30T17:24:21.946183+00:00",
 "caveat": "horse_hand_reviews holds only hands with |net| >= 20bb, so these are big-pot river calls; compare before/after on the same subset",
 "schema": "horse-river-one-pair-calls/v1",
 "consideredRows": 14180,
 "unreadableRows": 38
}
```

### 2. River RAISES by hero class (V64)

| seg | class | size | n | won | win% | net bb | avg frac | avg call bb |
|---|---|---|---:|---:|---:|---:|---:|---:|
| cash | one pair (all) | all | 71 | 25 | 35.2% | -2,840 | 0.78 | 19.8 |
| cash | one pair (all) | a<0.4 | 8 | 6 | 75.0% | +188 | 0.32 | 9.3 |
| cash | one pair (all) | b0.4-0.85 | 33 | 15 | 45.5% | -832 | 0.57 | 13.8 |
| cash | one pair (all) | c>=0.85 | 30 | 4 | 13.3% | -2,196 | 1.13 | 29.2 |
| cash | one_pair:top | all | 46 | 18 | 39.1% | -1,853 | 0.83 | 21.4 |
| cash | one_pair:top | a<0.4 | 5 | 4 | 80.0% | +189 | 0.31 | 10.0 |
| cash | one_pair:top | b0.4-0.85 | 17 | 12 | 70.6% | +46 | 0.58 | 10.8 |
| cash | one_pair:top | c>=0.85 | 24 | 2 | 8.3% | -2,088 | 1.11 | 31.4 |
| cash | one_pair:under | all | 25 | 7 | 28.0% | -986 | 0.69 | 16.8 |
| cash | one_pair:under | a<0.4 | 3 | 2 | 66.7% | -1 | 0.32 | 8.2 |
| cash | one_pair:under | b0.4-0.85 | 16 | 3 | 18.8% | -878 | 0.57 | 17.0 |
| cash | one_pair:under | c>=0.85 | 6 | 2 | 33.3% | -108 | 1.21 | 20.5 |
| cash | air | all | 28 | 3 | 10.7% | -984 | 0.57 | 9.5 |
| cash | air | a<0.4 | 1 | 0 | 0.0% | -22 | 0.32 | 3.0 |
| cash | air | b0.4-0.85 | 27 | 3 | 11.1% | -962 | 0.58 | 9.8 |
| cash | air | c>=0.85 | 0 | 0 | - | +0 | - | - |
| cash | ref: two_pair_plus | all | 524 | 371 | 70.8% | +17,564 | 0.77 | 36.7 |
| cash | ref: two_pair_plus | a<0.4 | 55 | 45 | 81.8% | +2,075 | 0.27 | 17.2 |
| cash | ref: two_pair_plus | b0.4-0.85 | 260 | 187 | 71.9% | +10,493 | 0.60 | 33.1 |
| cash | ref: two_pair_plus | c>=0.85 | 209 | 139 | 66.5% | +4,996 | 1.11 | 46.3 |
| mtt | one pair (all) | all | 22 | 8 | 36.4% | -660 | 0.61 | 13.1 |
| mtt | one pair (all) | a<0.4 | 3 | 2 | 66.7% | +60 | 0.27 | 9.1 |
| mtt | one pair (all) | b0.4-0.85 | 16 | 4 | 25.0% | -734 | 0.57 | 13.9 |
| mtt | one pair (all) | c>=0.85 | 3 | 2 | 66.7% | +15 | 1.15 | 13.0 |
| mtt | one_pair:top | all | 5 | 4 | 80.0% | +69 | 0.73 | 12.0 |
| mtt | one_pair:top | a<0.4 | 1 | 1 | 100.0% | +22 | 0.29 | 3.4 |
| mtt | one_pair:top | b0.4-0.85 | 2 | 2 | 100.0% | +80 | 0.54 | 15.2 |
| mtt | one_pair:top | c>=0.85 | 2 | 1 | 50.0% | -33 | 1.15 | 12.9 |
| mtt | one_pair:under | all | 17 | 4 | 23.5% | -729 | 0.57 | 13.4 |
| mtt | one_pair:under | a<0.4 | 2 | 1 | 50.0% | +38 | 0.27 | 12.0 |
| mtt | one_pair:under | b0.4-0.85 | 14 | 2 | 14.3% | -814 | 0.57 | 13.7 |
| mtt | one_pair:under | c>=0.85 | 1 | 1 | 100.0% | +48 | 1.17 | 13.1 |
| mtt | air | all | 13 | 2 | 15.4% | -382 | 0.39 | 6.9 |
| mtt | air | a<0.4 | 6 | 1 | 16.7% | -158 | 0.25 | 4.2 |
| mtt | air | b0.4-0.85 | 7 | 1 | 14.3% | -223 | 0.52 | 9.3 |
| mtt | air | c>=0.85 | 0 | 0 | - | +0 | - | - |
| mtt | ref: two_pair_plus | all | 200 | 137 | 68.5% | +4,852 | 0.74 | 24.6 |
| mtt | ref: two_pair_plus | a<0.4 | 44 | 34 | 77.3% | +1,686 | 0.27 | 14.5 |
| mtt | ref: two_pair_plus | b0.4-0.85 | 106 | 72 | 67.9% | +1,685 | 0.59 | 23.4 |
| mtt | ref: two_pair_plus | c>=0.85 | 50 | 31 | 62.0% | +1,481 | 1.46 | 35.9 |

### 3. TURN one-pair CALLS facing a wager the horse did not make, by size (V65), call + call-all-in

| seg | class | size | n | won | win% | net bb | avg frac | avg call bb | folds |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| cash | one pair (all) | a<0.4 | 204 | 83 | 40.7% | -1,813 | 0.28 | 7.6 | 2 (1.0%) |
| cash | one pair (all) | b0.4-0.7 | 564 | 189 | 33.5% | -11,370 | 0.57 | 16.6 | 39 (6.5%) |
| cash | one pair (all) | c0.7-1.05 | 336 | 66 | 19.6% | -15,730 | 0.87 | 22.0 | 33 (8.9%) |
| cash | one pair (all) | d>=1.05 | 184 | 21 | 11.4% | -9,745 | 1.21 | 21.1 | 6 (3.2%) |
| cash | one pair (all) | all | 1,288 | 359 | 27.9% | -38,657 | 0.70 | 17.2 | 80 (5.8%) |
| cash | one_pair:top | a<0.4 | 91 | 41 | 45.1% | -460 | 0.28 | 6.8 | 0 (0.0%) |
| cash | one_pair:top | b0.4-0.7 | 321 | 109 | 34.0% | -7,140 | 0.58 | 16.8 | 9 (2.7%) |
| cash | one_pair:top | c0.7-1.05 | 220 | 46 | 20.9% | -11,875 | 0.89 | 22.6 | 6 (2.7%) |
| cash | one_pair:top | d>=1.05 | 153 | 20 | 13.1% | -8,500 | 1.21 | 21.8 | 1 (0.6%) |
| cash | one_pair:top | all | 785 | 216 | 27.5% | -27,975 | 0.75 | 18.2 | 16 (2.0%) |
| cash | one_pair:under | a<0.4 | 113 | 42 | 37.2% | -1,353 | 0.28 | 8.2 | 2 (1.7%) |
| cash | one_pair:under | b0.4-0.7 | 243 | 80 | 32.9% | -4,230 | 0.57 | 16.3 | 30 (11.0%) |
| cash | one_pair:under | c0.7-1.05 | 116 | 20 | 17.2% | -3,855 | 0.85 | 20.7 | 27 (18.9%) |
| cash | one_pair:under | d>=1.05 | 31 | 1 | 3.2% | -1,244 | 1.20 | 17.8 | 5 (13.9%) |
| cash | one_pair:under | all | 503 | 143 | 28.4% | -10,682 | 0.61 | 15.6 | 64 (11.3%) |
| mtt | one pair (all) | a<0.4 | 59 | 32 | 54.2% | +213 | 0.29 | 11.2 | 3 (4.8%) |
| mtt | one pair (all) | b0.4-0.7 | 343 | 141 | 41.1% | -2,307 | 0.57 | 13.4 | 22 (6.0%) |
| mtt | one pair (all) | c0.7-1.05 | 235 | 80 | 34.0% | -5,506 | 0.83 | 20.5 | 34 (12.6%) |
| mtt | one pair (all) | d>=1.05 | 95 | 27 | 28.4% | -2,987 | 1.82 | 41.2 | 12 (11.2%) |
| mtt | one pair (all) | all | 732 | 280 | 38.3% | -10,586 | 0.79 | 19.1 | 71 (8.8%) |
| mtt | one_pair:top | a<0.4 | 24 | 17 | 70.8% | +621 | 0.30 | 12.8 | 0 (0.0%) |
| mtt | one_pair:top | b0.4-0.7 | 144 | 66 | 45.8% | -401 | 0.57 | 14.3 | 8 (5.3%) |
| mtt | one_pair:top | c0.7-1.05 | 148 | 47 | 31.8% | -4,313 | 0.85 | 22.7 | 6 (3.9%) |
| mtt | one_pair:top | d>=1.05 | 77 | 24 | 31.2% | -2,490 | 1.65 | 39.0 | 4 (4.9%) |
| mtt | one_pair:top | all | 393 | 154 | 39.2% | -6,584 | 0.87 | 22.2 | 18 (4.4%) |
| mtt | one_pair:under | a<0.4 | 35 | 15 | 42.9% | -408 | 0.29 | 10.1 | 3 (7.9%) |
| mtt | one_pair:under | b0.4-0.7 | 199 | 75 | 37.7% | -1,905 | 0.57 | 12.7 | 14 (6.6%) |
| mtt | one_pair:under | c0.7-1.05 | 87 | 33 | 37.9% | -1,192 | 0.81 | 16.6 | 28 (24.3%) |
| mtt | one_pair:under | d>=1.05 | 18 | 3 | 16.7% | -497 | 2.53 | 50.2 | 8 (30.8%) |
| mtt | one_pair:under | all | 339 | 126 | 37.2% | -4,003 | 0.71 | 15.4 | 53 (13.5%) |

V69 gap 1 split (wager >= 0.7 pot; short = V68 effective stack behind after the call < 1.5 x pot after the call):

| seg | class | size | n | won | win% | net bb | avg frac | avg call bb | folds |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| cash | one pair, short | >=0.7 | 148 | 16 | 10.8% | -13,153 | 0.96 | 36.4 | 37 (20.0%) |
| cash | one pair, deep | >=0.7 | 372 | 71 | 19.1% | -12,322 | 1.01 | 15.8 | 2 (0.5%) |
| mtt | one pair, short | >=0.7 | 204 | 70 | 34.3% | -5,224 | 1.23 | 32.2 | 39 (16.0%) |
| mtt | one pair, deep | >=0.7 | 126 | 37 | 29.4% | -3,268 | 0.93 | 17.0 | 7 (5.3%) |

### 4. FLOP / TURN: horse bet, was raised, then CALLED (V66)

| seg | class | size | n | won | win% | net bb | avg frac | avg call bb | folds |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| cash | flop: one pair / air (all) | all | 799 | 244 | 30.5% | -32,346 | 0.84 | 15.4 | 12 (1.5%) |
| cash | flop: one_pair:top | all | 483 | 183 | 37.9% | -19,898 | 0.86 | 16.9 | 1 (0.2%) |
| cash | flop: one_pair:under | all | 178 | 38 | 21.3% | -6,232 | 0.82 | 12.8 | 4 (2.2%) |
| cash | flop: air | all | 138 | 23 | 16.7% | -6,216 | 0.85 | 13.8 | 7 (4.8%) |
| cash | flop: one pair / air, call-all-in | all | 5 | 2 | 40.0% | +96 | 0.61 | 37.1 | - |
| cash | flop: ref: draw | all | 126 | 52 | 41.3% | +618 | 0.91 | 13.1 | 1 (0.8%) |
| cash | flop: ref: two_pair_plus | all | 121 | 62 | 51.2% | -453 | 0.83 | 15.6 | 0 (0.0%) |
| cash | turn: one pair / air (all) | all | 549 | 169 | 30.8% | -19,588 | 0.81 | 29.9 | 20 (3.5%) |
| cash | turn: one_pair:top | all | 349 | 130 | 37.2% | -11,494 | 0.81 | 33.9 | 2 (0.6%) |
| cash | turn: one_pair:under | all | 181 | 38 | 21.0% | -7,098 | 0.81 | 22.7 | 11 (5.7%) |
| cash | turn: air | all | 19 | 1 | 5.3% | -996 | 0.77 | 25.8 | 7 (26.9%) |
| cash | turn: one pair / air, call-all-in | all | 35 | 14 | 40.0% | -683 | 0.49 | 61.7 | - |
| cash | turn: ref: draw | all | 48 | 12 | 25.0% | -1,034 | 0.84 | 24.7 | 7 (12.7%) |
| cash | turn: ref: two_pair_plus | all | 345 | 178 | 51.6% | +3,608 | 0.79 | 35.3 | 1 (0.3%) |
| mtt | flop: one pair / air (all) | all | 391 | 134 | 34.3% | -10,064 | 0.90 | 16.2 | 7 (1.8%) |
| mtt | flop: one_pair:top | all | 226 | 94 | 41.6% | -6,185 | 0.88 | 17.6 | 1 (0.4%) |
| mtt | flop: one_pair:under | all | 94 | 25 | 26.6% | -1,988 | 0.95 | 14.0 | 2 (2.1%) |
| mtt | flop: air | all | 71 | 15 | 21.1% | -1,891 | 0.88 | 14.7 | 4 (5.3%) |
| mtt | flop: one pair / air, call-all-in | all | 30 | 10 | 33.3% | -333 | 0.66 | 23.9 | - |
| mtt | flop: ref: draw | all | 57 | 20 | 35.1% | -37 | 0.85 | 13.9 | 0 (0.0%) |
| mtt | flop: ref: two_pair_plus | all | 64 | 36 | 56.2% | +108 | 0.89 | 15.0 | 0 (0.0%) |
| mtt | turn: one pair / air (all) | all | 261 | 96 | 36.8% | -5,026 | 0.76 | 24.3 | 16 (5.8%) |
| mtt | turn: one_pair:top | all | 147 | 70 | 47.6% | -2,012 | 0.73 | 28.4 | 1 (0.7%) |
| mtt | turn: one_pair:under | all | 97 | 21 | 21.6% | -2,652 | 0.78 | 19.1 | 9 (8.5%) |
| mtt | turn: air | all | 17 | 5 | 29.4% | -361 | 0.82 | 18.4 | 6 (26.1%) |
| mtt | turn: one pair / air, call-all-in | all | 57 | 24 | 42.1% | -851 | 0.68 | 29.7 | - |
| mtt | turn: ref: draw | all | 37 | 11 | 29.7% | -657 | 0.70 | 18.0 | 9 (19.6%) |
| mtt | turn: ref: two_pair_plus | all | 170 | 81 | 47.6% | -1,109 | 0.75 | 23.0 | 2 (1.2%) |

### 5. RIVER: horse bet one pair, was raised, then called / jammed (V67)

| seg | class | raise size | bets | raised | raised% | n call+jam | won | win% | net bb | avg frac | avg call bb | folds |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| cash | one pair (all) | all | 986 | 192 | 19.5% | 167 | 25 | 15.0% | -10,476 | 0.72 | 44.7 | 24 (12.6%) |
| cash | one pair (all) | raise<0.7 | | | | 72 | 3 | 4.2% | -6,979 | 0.45 | 43.1 | 9 (11.1%) |
| cash | one pair (all) | raise0.7-1.5 | | | | 95 | 22 | 23.2% | -3,497 | 0.93 | 45.9 | 13 (12.0%) |
| cash | one pair (all) | raise>=1.5 | | | | 0 | 0 | - | +0 | - | - | 2 (100.0%) |
| cash | one_pair:top | all | 682 | 103 | 15.1% | 94 | 15 | 16.0% | -7,890 | 0.66 | 54.1 | 9 (8.7%) |
| cash | one_pair:top | raise<0.7 | | | | 44 | 3 | 6.8% | -5,477 | 0.37 | 51.7 | 5 (10.2%) |
| cash | one_pair:top | raise0.7-1.5 | | | | 50 | 12 | 24.0% | -2,414 | 0.92 | 56.2 | 3 (5.7%) |
| cash | one_pair:top | raise>=1.5 | | | | 0 | 0 | - | +0 | - | - | 1 (100.0%) |
| cash | one_pair:under | all | 304 | 89 | 29.3% | 73 | 10 | 13.7% | -2,586 | 0.80 | 32.5 | 15 (17.0%) |
| cash | one_pair:under | raise<0.7 | | | | 28 | 0 | 0.0% | -1,503 | 0.57 | 29.4 | 4 (12.5%) |
| cash | one_pair:under | raise0.7-1.5 | | | | 45 | 10 | 22.2% | -1,083 | 0.93 | 34.4 | 10 (18.2%) |
| cash | one_pair:under | raise>=1.5 | | | | 0 | 0 | - | +0 | - | - | 1 (100.0%) |
| cash | ref: two_pair_plus | all | 2,003 | 348 | 17.4% | 323 | 156 | 48.3% | +531 | 0.74 | 50.0 | 8 (2.4%) |
| cash | ref: two_pair_plus | raise<0.7 | | | | 139 | 75 | 54.0% | +2,885 | 0.41 | 46.1 | 4 (2.8%) |
| cash | ref: two_pair_plus | raise0.7-1.5 | | | | 181 | 80 | 44.2% | -1,783 | 0.91 | 49.6 | 4 (2.2%) |
| cash | ref: two_pair_plus | raise>=1.5 | | | | 3 | 1 | 33.3% | -571 | 5.93 | 258.1 | 0 (0.0%) |
| mtt | one pair (all) | all | 367 | 60 | 16.3% | 55 | 6 | 10.9% | -2,658 | 0.60 | 34.2 | 5 (8.3%) |
| mtt | one pair (all) | raise<0.7 | | | | 31 | 0 | 0.0% | -2,506 | 0.35 | 29.8 | 2 (6.1%) |
| mtt | one pair (all) | raise0.7-1.5 | | | | 24 | 6 | 25.0% | -153 | 0.92 | 39.8 | 3 (11.1%) |
| mtt | one pair (all) | raise>=1.5 | | | | 0 | 0 | - | +0 | - | - | - |
| mtt | one_pair:top | all | 243 | 29 | 11.9% | 28 | 3 | 10.7% | -1,784 | 0.57 | 42.1 | 1 (3.4%) |
| mtt | one_pair:top | raise<0.7 | | | | 18 | 0 | 0.0% | -1,914 | 0.35 | 37.9 | 1 (5.3%) |
| mtt | one_pair:top | raise0.7-1.5 | | | | 10 | 3 | 30.0% | +130 | 0.97 | 49.6 | 0 (0.0%) |
| mtt | one_pair:top | raise>=1.5 | | | | 0 | 0 | - | +0 | - | - | - |
| mtt | one_pair:under | all | 124 | 31 | 25.0% | 27 | 3 | 11.1% | -875 | 0.62 | 26.0 | 4 (12.9%) |
| mtt | one_pair:under | raise<0.7 | | | | 13 | 0 | 0.0% | -592 | 0.34 | 18.7 | 1 (7.1%) |
| mtt | one_pair:under | raise0.7-1.5 | | | | 14 | 3 | 21.4% | -282 | 0.89 | 32.9 | 3 (17.6%) |
| mtt | one_pair:under | raise>=1.5 | | | | 0 | 0 | - | +0 | - | - | - |
| mtt | ref: two_pair_plus | all | 819 | 111 | 13.6% | 108 | 58 | 53.7% | +635 | 0.66 | 36.4 | 3 (2.7%) |
| mtt | ref: two_pair_plus | raise<0.7 | | | | 54 | 27 | 50.0% | +679 | 0.37 | 25.5 | 1 (1.8%) |
| mtt | ref: two_pair_plus | raise0.7-1.5 | | | | 54 | 31 | 57.4% | -44 | 0.95 | 47.2 | 2 (3.6%) |
| mtt | ref: two_pair_plus | raise>=1.5 | | | | 0 | 0 | - | +0 | - | - | - |

"raised" = river bets that faced a raise; call+jam = call, call-all-in or all-in re-raise after the raise.

### 6. TURN high-card (air / draw) CALLS facing a wager the horse did not make (V68), call + call-all-in

| seg | class | size | n | won | win% | net bb | avg frac | avg call bb | folds |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| cash | air + draw (all) | a<0.4 | 84 | 22 | 26.2% | -1,393 | 0.28 | 9.0 | 8 (8.7%) |
| cash | air + draw (all) | b0.4-0.7 | 147 | 51 | 34.7% | -929 | 0.55 | 14.3 | 43 (22.6%) |
| cash | air + draw (all) | c0.7-1.05 | 94 | 29 | 30.9% | -1,537 | 0.87 | 18.1 | 29 (23.6%) |
| cash | air + draw (all) | d>=1.05 | 44 | 9 | 20.5% | -749 | 1.18 | 19.5 | 1 (2.2%) |
| cash | air + draw (all) | all | 369 | 111 | 30.1% | -4,607 | 0.65 | 14.7 | 81 (18.0%) |
| cash | air | a<0.4 | 28 | 5 | 17.9% | -611 | 0.29 | 8.4 | 5 (15.2%) |
| cash | air | b0.4-0.7 | 55 | 14 | 25.5% | -837 | 0.55 | 14.1 | 23 (29.5%) |
| cash | air | c0.7-1.05 | 31 | 5 | 16.1% | -751 | 0.87 | 15.3 | 13 (29.5%) |
| cash | air | d>=1.05 | 18 | 0 | 0.0% | -811 | 1.17 | 19.4 | 0 (0.0%) |
| cash | air | all | 132 | 24 | 18.2% | -3,010 | 0.65 | 13.9 | 41 (23.7%) |
| cash | draw | a<0.4 | 56 | 17 | 30.4% | -781 | 0.28 | 9.2 | 3 (5.1%) |
| cash | draw | b0.4-0.7 | 92 | 37 | 40.2% | -92 | 0.56 | 14.4 | 20 (17.9%) |
| cash | draw | c0.7-1.05 | 63 | 24 | 38.1% | -786 | 0.87 | 19.4 | 16 (20.3%) |
| cash | draw | d>=1.05 | 26 | 9 | 34.6% | +62 | 1.18 | 19.5 | 1 (3.7%) |
| cash | draw | all | 237 | 87 | 36.7% | -1,597 | 0.64 | 15.1 | 40 (14.4%) |
| mtt | air + draw (all) | a<0.4 | 28 | 11 | 39.3% | -353 | 0.30 | 11.2 | 4 (12.5%) |
| mtt | air + draw (all) | b0.4-0.7 | 120 | 45 | 37.5% | -870 | 0.55 | 13.2 | 25 (17.2%) |
| mtt | air + draw (all) | c0.7-1.05 | 54 | 14 | 25.9% | -873 | 0.86 | 15.0 | 30 (35.7%) |
| mtt | air + draw (all) | d>=1.05 | 25 | 5 | 20.0% | -571 | 1.72 | 36.9 | 16 (39.0%) |
| mtt | air + draw (all) | all | 227 | 75 | 33.0% | -2,668 | 0.72 | 16.0 | 75 (24.8%) |
| mtt | air | a<0.4 | 12 | 5 | 41.7% | -97 | 0.32 | 11.2 | 2 (14.3%) |
| mtt | air | b0.4-0.7 | 58 | 15 | 25.9% | -860 | 0.56 | 14.1 | 15 (20.5%) |
| mtt | air | c0.7-1.05 | 21 | 3 | 14.3% | -523 | 0.89 | 15.6 | 17 (44.7%) |
| mtt | air | d>=1.05 | 11 | 1 | 9.1% | -267 | 1.40 | 39.6 | 6 (35.3%) |
| mtt | air | all | 102 | 24 | 23.5% | -1,746 | 0.69 | 16.8 | 40 (28.2%) |
| mtt | draw | a<0.4 | 16 | 6 | 37.5% | -256 | 0.29 | 11.1 | 2 (11.1%) |
| mtt | draw | b0.4-0.7 | 62 | 30 | 48.4% | -10 | 0.54 | 12.5 | 10 (13.9%) |
| mtt | draw | c0.7-1.05 | 33 | 11 | 33.3% | -350 | 0.83 | 14.6 | 13 (28.3%) |
| mtt | draw | d>=1.05 | 14 | 4 | 28.6% | -305 | 1.98 | 34.7 | 10 (41.7%) |
| mtt | draw | all | 125 | 51 | 40.8% | -921 | 0.75 | 15.3 | 35 (21.9%) |

V68 / V69 depth split (wager >= 0.7 pot; short = effective behind after call < 1.5 x pot after call):

| seg | class | size | n | won | win% | net bb | avg frac | avg call bb | folds |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| cash | air, short | >=0.7 | 11 | 0 | 0.0% | -672 | 0.95 | 26.5 | 12 (52.2%) |
| cash | air, deep | >=0.7 | 38 | 5 | 13.2% | -890 | 0.99 | 14.0 | 1 (2.6%) |
| cash | draw, short | >=0.7 | 20 | 5 | 25.0% | -790 | 0.93 | 36.6 | 14 (41.2%) |
| cash | draw, deep | >=0.7 | 69 | 28 | 40.6% | +66 | 0.97 | 14.5 | 3 (4.2%) |
| mtt | air, short | >=0.7 | 19 | 4 | 21.1% | -432 | 1.07 | 32.3 | 21 (52.5%) |
| mtt | air, deep | >=0.7 | 13 | 0 | 0.0% | -357 | 1.06 | 11.6 | 2 (13.3%) |
| mtt | draw, short | >=0.7 | 31 | 11 | 35.5% | -313 | 1.29 | 23.5 | 22 (41.5%) |
| mtt | draw, deep | >=0.7 | 16 | 4 | 25.0% | -342 | 0.96 | 15.0 | 1 (5.9%) |

### Telemetry receipts (`public.horse_brain_telemetry`, daily fires)

| feature | 2026-10-30 | 2026-10-31 | last updated_at |
|---|---:|---:|---|
| v61_river_one_pair_shade | 0 | 0 | - |
| v63_large_river_bet_shade | 0 | 0 | - |
| v64_river_raise_needs_two_pair | 0 | 0 | - |
| v65_turn_one_pair_shade | 0 | 0 | - |
| v66_bet_raised_one_pair | 0 | 0 | - |
| v66_raise_stratum | 0 | 0 | - |
| v67_river_bet_raised_one_pair | 0 | 0 | - |
| v67_river_raise_stratum | 0 | 0 | - |
| v68_turn_air_draw_calls | 0 | 0 | - |
| v69_turn_call_gaps | 0 | 0 | - |

Caveat: `horse_hand_reviews` keeps only hands with |net_bb| >= 20. Call cells are biased negative (a call that wins a small pot is invisible) and fold cells only contain hands where the horse had already put 20bb+ in; compare before/after only on this same subset, and treat cells under n=50 as noise.
