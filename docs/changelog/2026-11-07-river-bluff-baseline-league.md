# 2026-11-07 - The baseline river bluff range, measured in the league

#9803 shipped `riverBluffBaseline` (server/src/engine/HorseRiverBluffRange.ts)
default on with no league measurement and no duplicate-deal ablation. This
change is that measurement. Full tables:
`docs/horse-measure/2026-11-07/river-bluff-baseline-league.md`; per-cell
results: `docs/horse-measure/2026-11-07/results/river-bluff-baseline/*.json`.

## What was run

Arm A = production brain, arm B = `riverBluffBaseline: false`, one hero horse
per table, every other seat identical in both passes of a duplicate pair (same
deal seed, dealer, hero seat and field), so card luck cancels in A - B. One
HorseMind sandbox per arm for the whole cell, so the station and river-fold
reads form as at a live table. Variants nlh, plo4, plo5, plo6; cash (100bb)
and tournament chip EV (40bb, MTT, big-blind ante); fields: five production
horses (`standard`), calibrated stations, calibrated over-folders, and a mixed
field. Six-handed and heads-up, reported separately. Measured on main `e8c2ded4d`
(the brain #9803 shipped plus #9826). Seed 20261107; 119,600
pairs (239,200 hands) in 64 cells. This is a reduced run sized to the
75-minute compute budget on a shared two-core box; PLO cells hold few baseline
spots and their CIs are wide.

## Numbers (A - B, bb/100, +/- 1 standard error; CI = +/- 1.96 se)

| slice                    | six-handed               | heads-up                  |
| ------------------------ | ------------------------ | ------------------------- |
| all                      | +0.75 +/- 0.39           | +1.29 +/- 0.57            |
| nlh                      | +0.73 +/- 0.31           | +1.50 +/- 0.64            |
| plo4                     | +0.97 +/- 0.97           | -0.44 +/- 1.13            |
| plo5                     | +1.20 +/- 1.65           | +1.54 +/- 2.64            |
| plo6                     | -0.05 +/- 1.56           | +3.87 +/- 2.27            |
| vs production horses     | +0.35 +/- 1.43           | +5.09 +/- 1.88            |
| vs stations              | +0.44 +/- 0.51           | -0.58 +/- 0.62            |
| vs over-folders          | +0.59 +/- 0.59           | -0.20 +/- 0.79            |
| vs mixed field           | +2.11 +/- 0.90           | +0.84 +/- 0.87            |
| cash                     | +1.29 +/- 0.65           | +1.06 +/- 0.82            |
| tournament               | +0.21 +/- 0.42           | +1.51 +/- 0.81            |
| baseline bluffs / folded | 130 / 90 (69%), need 43% | 365 / 267 (73%), need 43% |

NLH against production horses: +6.27 +/- 2.14 (6-max cash, CI +2.07 to
+10.46), +5.49 +/- 2.60 and +5.60 +/- 2.78 (heads-up cash and tournament).
Stations fold to 18% of baseline bluffs, but the station read (x0.2) keeps them
to 11 in 21,400 six-handed pairs and 22 in 13,800 heads-up; no cell's 95% CI
lies below zero. Hero WTSD moves by at most 1.5 points in any cell. Legality:
0 illegal actions, 0 truncated streets, 0 brain exception fallbacks.

## Decision

The baseline wins where it acts and loses no material EV anywhere, so no
constant was tuned and the HorseRiverBluffRange law is untouched. This file and
the report are the league evidence #9803 lacked.

## What changed in code

- `server/src/benchmark/RiverBluffBaselineLeague.ts`: the cell definitions
  (pools, formats, arms) and the duplicate-deal hero-versus-field runner.
- `server/src/scripts/riverBluffBaselineLeague.ts`: offline CLI; no database,
  no scheduler, no writer beyond its output folder.
- `server/src/benchmark/HorseLeague.ts`: two optional, read-only hooks - a
  per-seat calibrated profile on `LeagueHumanField` (`profileOf`) and a hand
  observer as `playHand`'s last argument. Absent on every existing path; the
  new test pins that an observed hand settles identically to an unobserved
  one.
- `scripts/horse-measure/river-bluff-baseline-report.py` renders the tables.
- No change to HorseLogic or any production decision path.

## Not covered

- Mood hour followed the wall clock of the run (08:31-09:45 UTC); both arms of
  a pair share it.
- The standing nightly card (`LEAGUE_MATCHUPS`) gains no river-bluff-baseline
  card: a horse-versus-horse mirror probe (`hybridBaseline`, 50 pairs each of
  NLH, PLO4 and PLO6 at seed 4242) diverged in 1 of 150 pairs, so a nightly
  mirror card would mostly report inert nights. This hero-versus-field runner
  is the instrument.
- #9803's remaining gaps (multiway rivers, out-of-position leads into the turn
  bettor, fixed limit / short deck / multi-board / bomb pots, hi-lo with a low
  possible) are untouched.
