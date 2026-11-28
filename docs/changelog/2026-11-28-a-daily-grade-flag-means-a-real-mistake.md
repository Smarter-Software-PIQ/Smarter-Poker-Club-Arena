# 2026-11-28 - Daily grade: a flag means a real Horse mistake (false-discovery control and repeat days)

The read-only daily Horse decision grade
(`server/src/benchmark/HorseDailyDecisionGrade.ts`, run by
`server/scripts/horse-daily-decision-grade.ts`) has a new rule for what it calls
a flag. No engine code, option, registry or migration changes. The range
grade's validation bar is not touched.

## Why it broke

A row was flagged when its mean loss was beyond 1 standard error with n >= 10.
A row with no leak at all clears that bar about 16% of the time. A daily report
tests many rows at once: of about 400 to 1,250 spot classes a day (257 to 912
of them in cash games), 12 to 39 reach n >= 10, and the roll-up tables and the
range grade's roll-up tables add 18 to 62 and 16 to 88 more. Nothing in the rule accounted for the number of rows
tested. So every day carried several flags that were chance alone, the owners
who receive the flags could not tell a leak from luck, and on Nov 27 four days
of one "flag" turned out to be one player's results (#12290 handled that case
only).

The p-value the bar implied was also wrong for poker results. A call loses a
little on most hands and wins a pot now and then. In the six re-run reports the
per-hand results of the tested rows are skewed that way in 50% to 100% of the
rows of each table, most often about two thirds.
On 10 to 60 hands a plain test calls that shape a leak two to five times too
often.

## The rule now

Declared in one place, as named constants at the top of the statistics section
of `HorseDailyDecisionGrade.ts`, and printed in every report header under
"What a flag means":

- **Tested**: a row with n >= 10 (`FLAG_MIN_N`) and a standard error above 0.
  Its one-sided p-value is Student's t on mean / SE with (hands - 1) degrees of
  freedom, with Hall's correction for skew applied only where it makes the row
  less significant, and never taking more than half of the plain t
  (`SKEW_CORRECTION_MAX = 0.5`).
- **Flagged** when either:
  - it clears a Benjamini-Hochberg false-discovery rate of 5% (`FLAG_FDR_Q =
0.05`) across every row tested in its family that day, and its mean is at
    least 0.5 bb per decision (`FLAG_MIN_EFFECT_BB = 0.5`); or
  - **repeat day**: p <= 0.025 (`FLAG_REPEAT_P`, about 2 SE) and at least
    0.5 bb per decision in this report and in one of the two reports before it
    (`FLAG_REPEAT_LOOKBACK_REPORTS = 2`), where the earlier window ended at or
    before this one starts and no more than 48 hours earlier
    (`FLAG_REPEAT_MAX_GAP_HOURS = 48`). The earlier reports are read from their
    stored JSON, the same files the "Changed since the previous report" table
    reads. A report written before this change confirms a repeat too (its
    stored n, mean and SE are enough).
- **One person** (#12290, kept): when more than 80% of a row is against one
  person (`ONE_PERSON_SHARE`), the row must clear the same bar with that person
  excluded: the family's false-discovery bar for the first way in, p <= 0.025 on
  both days for a repeat day. Otherwise it shows "one person". The
  person-excluded numbers are now stored with the row (`withoutTopPerson`) so
  the next report can apply this to yesterday's row.
- **Watch**: a row beyond the earlier bar (mean > 1 SE at n >= 10, `WATCH_SE`)
  that is not flagged and not "one person". It is shown, it is never a flag, and
  it is never dropped. Each section has a new table, "Every flagged, one-person
  and watch row", so a row outside the top 15 by total loss is listed too.
- **Not graded** (#12290, kept): rows of a range-grade group that did not pass
  validation are not tested, carry no mark, and do not confirm a repeat day in
  a later report.

Families (each tested as one set): the spot classes of cash and tournaments
together; their roll-up rows; the range grade's roll-up rows of the groups that
passed validation; and the person-excluded view of each of those three.

Half a big blind was chosen as the minimum effect because it sits above the
range grade's own measured pricing error (validation gaps of -0.02 to +0.40 bb
on Nov 23 to 27).

### Expected false flags

With no leak anywhere, Benjamini-Hochberg rejects anything in a family on at
most 5% of days, and the repeat rule adds 0.025 squared per row and earlier
report. Simulated at 257 classes a day of which 30 are tested, 1,000 days
each, false flags per family per day:

| shape of the results                                     | earlier rule | this rule |
| -------------------------------------------------------- | ------------ | --------- |
| bell-shaped                                              | 4.9          | 0.07      |
| heavy-tailed                                             | 5.9          | 0.01      |
| call-shaped, winning one hand in three                   | 5.4          | 0.04      |
| call-shaped, winning one hand in four                    | 5.8          | 0.14      |
| lopsided, one hand in ten wins nine times the usual loss | 7.3          | 2.2       |

So, in simulation, about 0.2 false flags a day over the three families a
reader acts on, against about 15 under the earlier rule.

## What the rule can miss

- A small real leak. One day of 10 to 60 decisions cannot separate a 2 SE loss
  from luck across 30 rows. Such a row is "watch" on its first day and becomes
  a flag when one of the next two reports repeats it. A leak that shows one day
  in three stays "watch". It needs several days to confirm.
- A real loss under 0.5 bb per decision stays "watch" however certain it is.
- The skew correction costs power on real call-shaped leaks: a leak of 1.2 bb
  per call on 10 to 60 calls clears the repeat bar on about one day in four
  (one in two without the correction).
- It can still be fooled by a row far more lopsided than a call (the last line
  of the table above). A day without the rare big win looks like a certain
  loss and no statistic on that day's rows can know better. The report's Limits
  section says to read a flagged row's hands before acting on a single day.
- A row whose hands all lost exactly the same amount has no spread to test
  against. It is not tested and shows as "watch".
- Rows are not independent of each other (one hand feeds several classes).
  Benjamini-Hochberg holds under the positive dependence this creates, but the
  5% is a design level, not a measurement.

Nothing beyond the earlier bar disappears: every such row is flagged, "one
person" or "watch".

## Evidence: Nov 23 to Nov 27, before and after

Each window (5:00 AM to 5:00 AM Chicago) was graded again with this branch,
reading the same hands (reports under the lane's work folder, not the archive;
the archive's reports were only read). "Before" is the rule on main (#12290: 1
SE at n >= 10, with the one-person re-test at 1 SE) applied to the same rows.
"After" is this rule, each day confirmed against the two re-run reports before
it (Nov 23 had only Nov 22 before it). Tables counted: spot classes and
roll-ups of cash and tournaments, and the range grade's G1 and G2 roll-ups. The
Nov 28 report did not exist when this was written.

### Summary

| day        | before: flagged | before: one person | after: flagged | of which repeat day | after: one person | after: watch |
| ---------- | --------------- | ------------------ | -------------- | ------------------- | ----------------- | ------------ |
| 2026-11-23 | 2               | 2                  | 0              | 0                   | 0                 | 4            |
| 2026-11-24 | 6               | 5                  | 0              | 0                   | 0                 | 11           |
| 2026-11-25 | 6               | 7                  | 0              | 0                   | 2                 | 11           |
| 2026-11-26 | 9               | 3                  | 1              | 1                   | 1                 | 10           |
| 2026-11-27 | 0               | 2                  | 0              | 0                   | 0                 | 2            |

### Day by day

Rows that were flagged or "one person" before, or are flagged, "one person" or watch after. p is the one-sided p-value of this rule.

#### 2026-11-23 (1577 hands)

Range validation: G1 PASS, G2 PASS.

- spot classes: 19 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 1
- roll-up rows: 29 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 2
- range grade roll-up rows (groups that passed validation): 40 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 1
- repeat days confirmed against: the report for Nov 21, 2026, 5:00 AM Chicago to Nov 22, 2026, 5:00 AM Chicago

| table              | row             | n       | hands        | mean bb | SE             | p      | top person | before (main) | after |
| ------------------ | --------------- | ------- | ------------ | ------- | -------------- | ------ | ---------- | ------------- | ----- | ---------- | ----- | ---------- | ----- |
| cash spot class    | plo5 table      | preflop | facing open  | call    | preflop 70-90% | 58     | 47         | +7.23         | 4.27  | 0.0486     | 100%  | one person | watch |
| cash roll-up       | plo5 table      | flop    | bet vs check | 15      | 15             | +22.02 | 14.80      | 0.0795        | 100%  | one person | watch |
| tournament roll-up | nlh tournament  | turn    | call         | 15      | 15             | +2.40  | 2.08       | 0.1340        | 73%   | FLAGGED    | watch |
| range G1 roll-up   | plo4 tournament | flop    | fold         | 13      | 11             | +0.99  | 0.89       | 0.1461        | 77%   | FLAGGED    | watch |

Counts, before: FLAGGED 2, one person 2. After: watch 4.

#### 2026-11-24 (3137 hands)

Range validation: G1 PASS, G2 PASS.

- spot classes: 36 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 6
- roll-up rows: 61 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 4
- range grade roll-up rows (groups that passed validation): 78 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 1
- repeat days confirmed against: the report for Nov 22, 2026, 5:00 AM Chicago to Nov 23, 2026, 5:00 AM Chicago; the report for Nov 21, 2026, 5:00 AM Chicago to Nov 22, 2026, 5:00 AM Chicago

| table                 | row             | n       | hands                | mean bb        | SE                 | p      | top person | before (main) | after |
| --------------------- | --------------- | ------- | -------------------- | -------------- | ------------------ | ------ | ---------- | ------------- | ----- | ---------- | ----- | ---------- | ----- |
| cash spot class       | plo5 table      | turn    | unopened <=33% pot   | bet vs give up | pair               | 12     | 12         | +8.23         | 3.87  | 0.0286     | 92%   | one person | watch |
| cash spot class       | plo5 table      | flop    | facing 67-100% pot   | call           | pair + draw        | 22     | 20         | +23.32        | 13.04 | 0.0449     | 77%   | FLAGGED    | watch |
| cash spot class       | plo6 table      | preflop | unopened 67-100% pot | bet vs give up | preflop 70-90%     | 10     | 10         | +19.69        | 14.27 | 0.1005     | 100%  | one person | watch |
| cash spot class       | plo5 table      | preflop | facing open          | call           | preflop 70-90%     | 112    | 87         | +4.16         | 3.41  | 0.1126     | 91%   | one person | watch |
| cash spot class       | plo5 table      | preflop | facing open          | call           | preflop bottom 40% | 48     | 47         | +5.49         | 4.69  | 0.1236     | 83%   | one person | watch |
| cash roll-up          | plo4 table      | preflop | bet vs give up       | 16             | 16                 | +5.10  | 3.04       | 0.0569        | 44%   | FLAGGED    | watch |
| cash roll-up          | nlh table       | flop    | bet vs give up       | 27             | 27                 | +16.48 | 14.48      | 0.1327        | 67%   | FLAGGED    | watch |
| tournament spot class | nlh tournament  | preflop | facing open          | call           | preflop bottom 40% | 13     | 12         | +2.45         | 1.44  | 0.0702     | 38%   | FLAGGED    | watch |
| tournament roll-up    | plo4 tournament | flop    | bet vs check         | 14             | 14                 | +3.85  | 2.62       | 0.0830        | 79%   | FLAGGED    | watch |
| tournament roll-up    | plo4 tournament | turn    | bet vs check         | 13             | 13                 | +3.40  | 2.40       | 0.1059        | 92%   | one person | watch |
| range G2 roll-up      | plo4 tournament | preflop | fold                 | 33             | 27                 | +0.60  | 0.18       | 0.0055        | 39%   | FLAGGED    | watch |

Counts, before: FLAGGED 6, one person 5. After: watch 11.

#### 2026-11-25 (2230 hands)

Range validation: G1 FAIL, G2 PASS.

- spot classes: 21 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 7
- roll-up rows: 37 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 4
- range grade roll-up rows (groups that passed validation): 16 tested, bar p <= 0.0063, flagged 0 (repeat only 0), one person 2, watch 0
- repeat days confirmed against: the report for Nov 23, 2026, 5:00 AM Chicago to Nov 24, 2026, 5:00 AM Chicago; the report for Nov 22, 2026, 5:00 AM Chicago to Nov 23, 2026, 5:00 AM Chicago

| table                 | row             | n       | hands          | mean bb | SE                 | p      | top person | before (main) | after |
| --------------------- | --------------- | ------- | -------------- | ------- | ------------------ | ------ | ---------- | ------------- | ----- | ---------- | ---------- | ---------- | ----- |
| cash spot class       | plo5 table      | preflop | facing open    | raise   | preflop top 10%    | 25     | 25         | +36.77        | 18.75 | 0.0308     | 100%       | one person | watch |
| cash spot class       | plo4 table      | preflop | facing open    | call    | preflop 40-70%     | 12     | 12         | +2.50         | 1.12  | 0.0499     | 42%        | FLAGGED    | watch |
| cash spot class       | plo5 table      | preflop | facing open    | call    | preflop bottom 40% | 21     | 20         | +5.01         | 3.56  | 0.0878     | 90%        | one person | watch |
| cash spot class       | plo5 table      | preflop | facing open    | call    | preflop 40-70%     | 38     | 32         | +5.28         | 3.86  | 0.0907     | 92%        | one person | watch |
| cash spot class       | plo4 table      | preflop | facing open    | call    | preflop bottom 40% | 10     | 8          | +6.03         | 4.66  | 0.1183     | 70%        | FLAGGED    | watch |
| cash spot class       | plo4 table      | preflop | facing open    | call    | preflop 70-90%     | 14     | 13         | +11.17        | 10.49 | 0.1540     | 36%        | FLAGGED    | watch |
| cash roll-up          | plo5 table      | preflop | raise          | 57      | 57                 | +17.61 | 11.98      | 0.0736        | 100%  | one person | watch      |
| cash roll-up          | plo4 table      | preflop | bet vs give up | 17      | 17                 | +5.71  | 3.83       | 0.0777        | 59%   | FLAGGED    | watch      |
| cash roll-up          | plo5 table      | turn    | call           | 16      | 16                 | +18.46 | 16.09      | 0.1552        | 88%   | one person | watch      |
| tournament spot class | nlh tournament  | preflop | facing open    | call    | preflop 40-70%     | 12     | 10         | +1.73         | 1.44  | 0.1494     | 33%        | FLAGGED    | watch |
| tournament roll-up    | nlh tournament  | turn    | call           | 20      | 20                 | +9.11  | 7.13       | 0.1084        | 80%   | FLAGGED    | watch      |
| range G2 roll-up      | plo4 tournament | preflop | fold           | 21      | 19                 | +0.80  | 0.17       | 0.0001        | 95%   | one person | one person |
| range G2 roll-up      | plo6 tournament | preflop | fold           | 14      | 14                 | +0.81  | 0.24       | 0.0027        | 100%  | one person | one person |

Counts, before: FLAGGED 6, one person 7. After: one person 2, watch 11.

#### 2026-11-26 (3659 hands)

Range validation: G1 PASS, G2 PASS.

- spot classes: 39 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 3
- roll-up rows: 62 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 5
- range grade roll-up rows (groups that passed validation): 88 tested, bar p <= 0.0006, flagged 1 (repeat only 1), one person 1, watch 2
- repeat days confirmed against: the report for Nov 24, 2026, 5:00 AM Chicago to Nov 25, 2026, 5:00 AM Chicago; the report for Nov 23, 2026, 5:00 AM Chicago to Nov 24, 2026, 5:00 AM Chicago

| table                 | row             | n       | hands          | mean bb | SE                 | p      | top person | before (main) | after |
| --------------------- | --------------- | ------- | -------------- | ------- | ------------------ | ------ | ---------- | ------------- | ----- | ---------- | -------------------- | ---------- | ----- |
| cash spot class       | plo5 table      | preflop | facing open    | call    | preflop bottom 40% | 40     | 40         | +4.86         | 3.70  | 0.0984     | 90%                  | one person | watch |
| cash roll-up          | plo4 table      | flop    | bet vs check   | 13      | 13                 | +13.47 | 9.17       | 0.0838        | 31%   | FLAGGED    | watch                |
| cash roll-up          | nlh table       | flop    | bet vs check   | 16      | 16                 | +12.43 | 10.16      | 0.1199        | 38%   | FLAGGED    | watch                |
| cash roll-up          | plo6 table      | flop    | call           | 25      | 22                 | +11.02 | 9.96       | 0.1405        | 92%   | one person | watch                |
| cash roll-up          | nlh table       | preflop | bet vs give up | 10      | 10                 | +4.09  | 3.81       | 0.1559        | 50%   | FLAGGED    | watch                |
| cash roll-up          | plo4 table      | turn    | bet vs check   | 15      | 15                 | +6.71  | 6.51       | 0.1601        | 27%   | FLAGGED    | watch                |
| tournament spot class | nlh tournament  | preflop | facing open    | call    | preflop bottom 40% | 18     | 18         | +4.04         | 1.38  | 0.0046     | 33%                  | FLAGGED    | watch |
| tournament spot class | nlh tournament  | preflop | facing 3-bet+  | call    | preflop 40-70%     | 10     | 10         | +6.04         | 4.72  | 0.1166     | 30%                  | FLAGGED    | watch |
| range G1 roll-up      | plo4 tournament | flop    | fold           | 14      | 14                 | +0.94  | 0.61       | 0.0741        | 57%   | FLAGGED    | watch                |
| range G1 roll-up      | plo4 table      | flop    | fold           | 49      | 42                 | +1.16  | 1.11       | 0.1517        | 35%   | FLAGGED    | watch                |
| range G2 roll-up      | plo5 tournament | preflop | fold           | 13      | 13                 | +0.66  | 0.12       | 0.0001        | 100%  | one person | one person           |
| range G2 roll-up      | plo4 tournament | preflop | fold           | 15      | 14                 | +0.70  | 0.24       | 0.0092        | 53%   | FLAGGED    | FLAGGED (repeat day) |

Counts, before: FLAGGED 9, one person 3. After: FLAGGED (repeat day) 1, one person 1, watch 10.

#### 2026-11-27 (1453 hands)

Range validation: G1 PASS, G2 FAIL.

- spot classes: 12 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 2
- roll-up rows: 18 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 0
- range grade roll-up rows (groups that passed validation): 19 tested, bar none, flagged 0 (repeat only 0), one person 0, watch 0
- repeat days confirmed against: the report for Nov 25, 2026, 5:00 AM Chicago to Nov 26, 2026, 5:00 AM Chicago; the report for Nov 24, 2026, 5:00 AM Chicago to Nov 25, 2026, 5:00 AM Chicago

| table           | row        | n       | hands       | mean bb | SE                 | p   | top person | before (main) | after |
| --------------- | ---------- | ------- | ----------- | ------- | ------------------ | --- | ---------- | ------------- | ----- | ------ | ---- | ---------- | ----- |
| cash spot class | plo5 table | preflop | facing open | call    | preflop 70-90%     | 65  | 53         | +6.88         | 4.41  | 0.0624 | 100% | one person | watch |
| cash spot class | plo5 table | preflop | facing open | call    | preflop bottom 40% | 28  | 28         | +5.02         | 4.04  | 0.1122 | 100% | one person | watch |

Counts, before: one person 2. After: watch 2.

### What stays, what becomes watch, what becomes a repeat flag

- **Stay flagged: 1 of 23.** Range grade G2, `plo4 tournament | preflop |
fold`, Nov 26: +0.70 bb per fold (n 15, p 0.009). It flags as a repeat day
  against Nov 24 (+0.60 bb, n 33, p 0.006, 39% one person). On Nov 25 the same
  row was +0.80 bb at 95% one person and shows "one person" under both rules.
  This is the only repeat-day flag in the five days.
- **Become watch: 22 of 23**, listed in the tables above. None of them reaches
  p <= 0.025 on two of three days running. The closest is `nlh tournament |
preflop | facing open | call | preflop bottom 40%`: +2.45 bb on Nov 24 (n 13,
  p 0.07), absent on Nov 25, +4.04 bb on Nov 26 (n 18, p 0.005). It needed
  p <= 0.0013 to clear the false-discovery bar among 39 tested classes on its
  own day. It is the row to watch.
- **"One person" rows**: 19 before. 16 become watch (they no longer reach the
  bar a flag needs even with the person included) and 3 stay "one person" (the
  three range-grade tournament preflop fold rows of Nov 25 and Nov 26 at 95% to
  100% one person).
- No false-discovery flag on any of the five days: no single day held a row
  strong enough to stand out among the 12 to 88 rows tested with it.

## Tests

`server/src/benchmark/HorseDailyDecisionGradeFlagRule.test.ts` (new, 20
tests): the declared constants and the printed rule; the p-value, its skew
correction and Benjamini-Hochberg; a no-leak simulation at 257 classes a day
for bell-shaped, heavy-tailed and call-shaped results (under 0.1 flags per
family per day where the earlier rule gives over 3, and nothing beyond the
earlier bar hidden); a planted leak flags on its first day; a certain but tiny
loss is watch; a 2 SE loss is watch on day one and a flag when repeated,
including against a report written before the rule; a quiet day between two
losing days does not break the repeat; an overlapping or stale report confirms
nothing; the one-person re-test on the same bar for both ways in; the watch
table; the range grade's marks and NOT GRADED groups. All 20 fail on the code
before this change. In `HorseDailyDecisionGrade.test.ts` the test of the old
flag function now pins the same bar as the watch bar (it fails on the old code
too).

## Side notes, not changed here

- The reports in the archive for Nov 23 to Nov 27 were written before #12290
  and before this rule. Their "flagged" marks are the earliest rule's. The
  first report written with this rule says so above its "Changed since the
  previous report" table.
- The daily run needs no change: the CLI already reads the newest earlier
  `REPORT-*.json` next to `--out`, and now reads the one before it as well.
