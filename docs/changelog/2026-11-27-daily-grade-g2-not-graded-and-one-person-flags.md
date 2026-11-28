# 2026-11-27 - Daily grade: a failed range group is stated plainly and never flags; a one-person class is not a Horse flag

Two changes to the read-only daily Horse decision grade
(`server/src/benchmark/HorseDailyDecisionGrade.ts`, run by
`server/scripts/horse-daily-decision-grade.ts`). No engine code, option,
registry or migration changes, and no validation bar or flag threshold moves.

## 1. Why G2 (preflop realisation 1) failed, and what the report now says

G2 prices preflop Horse decisions against people that do not close the action,
against ranges built from public actions only. Its validation compares that
price with the same function run on the real cards, wherever every live
opponent's real cards are known. The bar is declared in
`hd-01Gw7aDs/range-grade/CRITERIA.md`: n >= 60, sign agreement >= 70%, mean
gap within 2 SE and within 25% of mean abs real, and the same again with the
most frequent person excluded.

Daily results: G2 passed on Nov 23, 24, 25 and 26. On Nov 27 it failed one
check only: with WooWoo excluded (86 decisions in 37 hands) the gap was
+0.22 bb per decision against a bar of 0.21 bb (2 SE = 0.208; 25% of mean abs
real = 0.71).

What was checked (aggregates only, the Nov 27 window):

- It is not Monte Carlo noise. The same 86 decisions re-priced with four other
  seed sets gave gaps of +0.15, +0.21, +0.25 and +0.21 bb (average of the five:
  +0.21, z = 2.0). The Monte Carlo part of the SE is 0.05 bb of the 0.10.
- It sits in NLH preflop folds and calls against people other than WooWoo
  (NLH +0.30 bb, z = 2.3; PLO4 -0.08, PLO5 -0.03). The range grade rates the
  person's holding weaker than the cards that were shown.
- It has the sign the validation sample's selection predicts. A person's real
  cards exist only when that person reached showdown: folded cards and mucked
  cards are never stored (owner rule, 2026-11-13). So every validation decision
  is one where the person kept going, and those holdings are stronger than the
  public range at the decision. The criteria declared this bias before the
  first run.
- Pricing the validation decisions on each opponent's whole public line
  (actions after the decision included) did not close the gap (it grew on the
  Nov 26 to 27 UTC day: +0.25 against -0.05 bb). So the selection is not in the
  betting line. It is in reaching showdown and showing, which the range model
  has no input for.

So with the cards that exist, the grade cannot tell the selection apart from
real range error. There is no unselected ground truth for a person's preflop
holding to test against. G2 can pass on a day only because its sample is small
enough. Loosening the bar, or re-tuning the weights after seeing the result,
would not be honest (the criteria forbid it), so neither was done.

What changed: when a group does not pass, the report says so plainly under the
validation table: "**G2 preflop_r1 is NOT GRADED in this report (FAIL).**",
how many range-graded decisions that leaves without a grade, which check
missed and by how much (gap, bar, 2 SE, 25% of mean abs real, n), and why.
None of that group's rows carries a flag: the mark column reads "not graded".
Before this change the rows were printed with their FLAGGED marks under a "NOT
TRUSTED" heading, and you could only find the miss by working through the
table. A group that passes is reported exactly as before.

## 2. A class that is one person is not flagged as a Horse leak

The PLO5 "preflop facing open call" classes flagged four days running, but 92%
of those calls were against one person (WooWoo). A 7-day measurement found no
leak: +0.98 +/- 1.28 bb per call overall, and +1.10 +/- 3.56 with the two
dominant players excluded.

New rule (`ONE_PERSON_SHARE = 0.8`): a class whose own most frequent person
makes up more than 80% of it is flagged only if the same class still flags with
that person excluded. Otherwise it shows as "one person" instead of "YES". The
summary line counts these classes. The 1 SE / n >= 10 test is unchanged. The
exclusion uses the class's own most frequent person, not only the report's, so
a class dominated by someone else is not let through. The range grade's G1/G2
roll-up marks use the same flag test and the same rule.

Tests (they fail on the previous code):
`HorseDailyDecisionGrade.test.ts` "a class over 80% against one person flags
only if it still flags without that person" (and the existing ranking test,
whose 100% one-person class no longer flags), and
`HorseDailyDecisionRangeGrade.test.ts` "a group that fails is NOT GRADED".

Side note, not changed here: `dailygrade-auto.sh` passes `--since
<day>T05:00` with no offset, and the CLI reads a bare time as Chicago time. So
each daily window runs 5:00 AM to 5:00 AM Chicago, not from the 11 PM Chicago
(05:00Z) boundary its comment describes.
