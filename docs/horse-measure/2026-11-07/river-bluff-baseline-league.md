# Baseline river bluff range: duplicate-deal league measurement (2026-11-07)

`riverBluffBaseline` (HorseRiverBluffRange.ts, #9803) shipped default on with
no league evidence. This is that evidence: the production brain (arm A) against
the same brain with `riverBluffBaseline: false` (arm B), one hero horse per
table, duplicate-dealt.

## Design

- Runner: `server/src/benchmark/RiverBluffBaselineLeague.ts`, CLI
  `server/src/scripts/riverBluffBaselineLeague.ts`; tables rendered by
  `scripts/horse-measure/river-bluff-baseline-report.py results/river-bluff-baseline`.
- Each pair replays one deal seed twice (same cards, dealer, hero seat and
  field); only the hero's flag differs, so card luck cancels in A - B. The
  error is the standard error of the per-pair difference; CI = +/- 1.96 se.
  One HorseMind sandbox per arm for the whole cell, so reads (the station
  read, river fold rate) form as at a live table.
- Hero and field horses: the production Hybrid profile for the game mode,
  default brain. Field pools: `standard` = five production horses;
  `stations` = the human-calibrated population with facing-bet fold cutoffs
  0.25 / 0.25 / 0.12 (flop / turn / river equity vs a random hand);
  `folders` = 0.60 / 0.70 / 0.80; `mixed` = horse, calibrated, station,
  over-folder, horse (heads-up: the one opponent rotates through those four
  by deal). Omaha fields use the Omaha calibrated profile (development
  population).
- Formats: cash 100bb; tournament chip EV 40bb, MTT, big-blind ante 1bb,
  60 left / 12 paid (outside the bubble).
- Six-handed (production shape) and heads-up (every river heads-up, which
  concentrates the one spot the baseline owns) are reported separately.
- Engine: main `e8c2ded4d` (#9803's baseline plus #9826).
- Seed 20261107. Pairs per cell: 6-max NLH 6,000 (standard/mixed 3,000), PLO4
  2,000 (1,000), PLO5 1,500 (800), PLO6 1,200 (600); heads-up NLH 4,000, PLO4
  1,500, PLO5 800, PLO6 600. 119,600 pairs, 239,200 hands. This is the reduced
  run the 75-minute compute budget allowed on a shared two-core box; the PLO
  cells carry few baseline spots and their CIs are wide.
- Mood hour: the CLI ran under tsx, so the V9 mood hour was the wall clock of
  the run (2026-11-07 08:31-09:45 UTC); both arms of a pair play milliseconds
  apart in the same hour.
- Columns: `baseline bluffs` = river bets carrying a `river_bluff_baseline_*`
  receipt; `folded` = the opponent folded to it; `fold needed` = mean
  break-even fold share s/(1+s) of those bets; `river bets / weak` = hero river
  bets with nothing to call, and how many were weak (Hold'em high card or a
  board-only pair, Omaha one pair or less); `WTSD` = hero showdowns per hand;
  `weak-bet SD` = weak river bets shown down / all river bets shown down (the
  production metric of #9803).

## Verdict

The baseline wins where it acts and loses nothing material anywhere:

- Pooled, six-handed: +0.75 +/- 0.39 bb/100 (CI -0.00 to +1.51); heads-up:
  +1.29 +/- 0.57 (CI +0.16 to +2.41). Hold'em is significant in both
  (+0.73 +/- 0.31 six-handed, +1.50 +/- 0.64 heads-up); against production
  horses +6.27 +/- 2.14 (6-max cash), +5.49 +/- 2.60 and +5.60 +/- 2.78
  (heads-up cash and tournament).
- Baseline bluffs succeeded 69% (130 bets, six-handed) and 73% (365,
  heads-up) against a 43% break-even fold share.
- Stations: the read works. 11 bluffs in 21,400 six-handed pairs and 22 in
  13,800 heads-up; they fold 18% of the time, so each is a loss, but the read
  (x0.2) keeps them rare: pooled -0.58 +/- 0.62 heads-up, +0.44 +/- 0.51
  six-handed. No cell's CI lies below zero.
- PLO: 19-38 baseline bluffs per variant, 58-80% folded; every PLO slice's
  CI includes zero (PLO4 -0.44 +/- 1.13 heads-up, +0.97 +/- 0.97 six-handed).
- Showdown: arm A shows down a few more weak river bets (heads-up NLH vs
  horses 8 of 55 river bets shown down were weak, against 1 of 49 without the
  baseline); hero WTSD moves by at most 1.5 points in any cell (the baseline
  bets some rivers that used to check down; a bluff that is called is a
  showdown either way).
- Legality: 0 illegal actions, 0 truncated streets, 0 brain exception
  fallbacks in 64 cells.

No constant was tuned: there is no material EV loss to tune against.

## Results

### 6-handed

| variant | format     | pool     | pairs | A-B bb/100       | 95% CI           | div | A bb/100 | B bb/100 | baseline bluffs (A) | folded   | fold needed | avg size | A river bets / weak | B river bets / weak | A WTSD | B WTSD | A weak-bet SD | B weak-bet SD |
| ------- | ---------- | -------- | ----- | ---------------- | ---------------- | --- | -------- | -------- | ------------------- | -------- | ----------- | -------- | ------------------- | ------------------- | ------ | ------ | ------------- | ------------- |
| nlh     | cash       | standard | 3000  | +6.27 +/- 2.14   | [+2.07, +10.46]  | 21  | -3.4     | -9.6     | 17                  | 15 (88%) | 44%         | 0.80     | 59/17               | 45/7                | 4%     | 4%     | 2/14          | 1/12          |
| nlh     | cash       | stations | 6000  | -0.17 +/- 0.31   | [-0.77, +0.44]   | 3   | +430.3   | +430.4   | 2                   | 0 (0%)   | 48%         | 0.93     | 316/20              | 315/20              | 11%    | 11%    | 19/310        | 19/309        |
| nlh     | cash       | folders  | 6000  | -0.11 +/- 0.52   | [-1.14, +0.92]   | 10  | +48.6    | +48.7    | 10                  | 8 (80%)  | 42%         | 0.73     | 86/12               | 81/6                | 5%     | 5%     | 1/16          | 1/16          |
| nlh     | cash       | mixed    | 3000  | -0.07 +/- 0.07   | [-0.20, +0.06]   | 1   | +69.5    | +69.5    | 1                   | 0 (0%)   | 44%         | 0.80     | 103/6               | 103/6               | 7%     | 7%     | 3/72          | 3/72          |
| nlh     | tournament | standard | 3000  | +0.22 +/- 1.94   | [-3.58, +4.03]   | 25  | +22.4    | +22.2    | 19                  | 12 (63%) | 44%         | 0.79     | 91/16               | 83/13               | 7%     | 8%     | 5/29          | 3/26          |
| nlh     | tournament | stations | 6000  | -0.04 +/- 0.61   | [-1.24, +1.16]   | 12  | +171.8   | +171.8   | 3                   | 0 (0%)   | 46%         | 0.86     | 267/14              | 273/20              | 12%    | 13%    | 14/260        | 20/266        |
| nlh     | tournament | folders  | 6000  | +0.08 +/- 0.41   | [-0.72, +0.89]   | 7   | +17.7    | +17.7    | 9                   | 7 (78%)  | 43%         | 0.76     | 69/11               | 68/10               | 6%     | 6%     | 1/12          | 1/12          |
| nlh     | tournament | mixed    | 3000  | +2.77 +/- 1.30   | [+0.23, +5.31]   | 9   | +34.3    | +31.5    | 11                  | 8 (73%)  | 45%         | 0.81     | 91/16               | 88/13               | 8%     | 9%     | 5/53          | 5/54          |
| plo4    | cash       | standard | 1000  | -2.10 +/- 3.99   | [-9.92, +5.72]   | 6   | -24.7    | -22.6    | 5                   | 2 (40%)  | 41%         | 0.70     | 31/7                | 27/3                | 9%     | 9%     | 3/9           | 1/7           |
| plo4    | cash       | stations | 2000  | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +88.2    | +88.2    | 0                   | 0        | -           | -        | 39/1                | 39/1                | 12%    | 12%    | 1/34          | 1/34          |
| plo4    | cash       | folders  | 2000  | +5.13 +/- 4.14   | [-2.99, +13.26]  | 4   | -105.7   | -110.9   | 5                   | 4 (80%)  | 43%         | 0.77     | 15/5                | 10/0                | 8%     | 8%     | 0/1           | 0/1           |
| plo4    | cash       | mixed    | 1000  | +1.25 +/- 0.90   | [-0.52, +3.02]   | 2   | +24.3    | +23.1    | 2                   | 2 (100%) | 45%         | 0.82     | 22/2                | 19/1                | 7%     | 7%     | 1/12          | 1/11          |
| plo4    | tournament | standard | 1000  | -1.15 +/- 2.61   | [-6.27, +3.97]   | 4   | -37.9    | -36.7    | 2                   | 1 (50%)  | 42%         | 0.72     | 9/2                 | 7/0                 | 6%     | 6%     | 1/3           | 0/2           |
| plo4    | tournament | stations | 2000  | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +70.7    | +70.7    | 0                   | 0        | -           | -        | 32/0                | 32/0                | 12%    | 12%    | 0/28          | 0/28          |
| plo4    | tournament | folders  | 2000  | -0.01 +/- 2.99   | [-5.88, +5.85]   | 4   | +27.1    | +27.1    | 3                   | 2 (67%)  | 38%         | 0.63     | 10/1                | 7/0                 | 9%     | 9%     | 1/1           | 0/0           |
| plo4    | tournament | mixed    | 1000  | +3.45 +/- 2.70   | [-1.85, +8.75]   | 2   | -5.1     | -8.6     | 2                   | 2 (100%) | 41%         | 0.71     | 17/2                | 15/1                | 9%     | 9%     | 1/9           | 1/9           |
| plo5    | cash       | standard | 800   | -11.44 +/- 12.15 | [-35.26, +12.39] | 4   | +0.1     | +11.6    | 3                   | 2 (67%)  | 41%         | 0.72     | 21/2                | 21/3                | 9%     | 9%     | 0/9           | 0/9           |
| plo5    | cash       | stations | 1500  | +7.95 +/- 6.76   | [-5.30, +21.20]  | 3   | +287.7   | +279.8   | 2                   | 1 (50%)  | 46%         | 0.87     | 41/0                | 39/0                | 12%    | 12%    | 0/32          | 0/31          |
| plo5    | cash       | folders  | 1500  | +2.29 +/- 1.84   | [-1.31, +5.89]   | 2   | +97.7    | +95.4    | 3                   | 3 (100%) | 45%         | 0.83     | 6/0                 | 3/0                 | 8%     | 8%     | 0/0           | 0/0           |
| plo5    | cash       | mixed    | 800   | +3.06 +/- 3.06   | [-2.94, +9.06]   | 1   | +36.9    | +33.9    | 2                   | 2 (100%) | 44%         | 0.79     | 11/2                | 10/1                | 9%     | 9%     | 0/8           | 0/8           |
| plo5    | tournament | standard | 800   | +6.38 +/- 4.18   | [-1.82, +14.57]  | 3   | +27.2    | +20.8    | 3                   | 3 (100%) | 46%         | 0.85     | 8/1                 | 6/1                 | 5%     | 6%     | 0/0           | 1/1           |
| plo5    | tournament | stations | 1500  | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +22.6    | +22.6    | 1                   | 1 (100%) | 44%         | 0.78     | 25/0                | 24/0                | 13%    | 13%    | 0/23          | 0/23          |
| plo5    | tournament | folders  | 1500  | -0.11 +/- 1.03   | [-2.14, +1.91]   | 3   | -29.1    | -29.0    | 4                   | 3 (75%)  | 39%         | 0.71     | 6/2                 | 3/1                 | 9%     | 9%     | 0/1           | 0/0           |
| plo5    | tournament | mixed    | 800   | -3.19 +/- 3.19   | [-9.44, +3.06]   | 1   | +29.2    | +32.4    | 2                   | 1 (50%)  | 41%         | 0.70     | 6/1                 | 5/1                 | 8%     | 8%     | 0/4           | 0/3           |
| plo6    | cash       | standard | 600   | -2.17 +/- 6.39   | [-14.69, +10.36] | 8   | +6.0     | +8.1     | 4                   | 3 (75%)  | 45%         | 0.83     | 13/0                | 11/0                | 6%     | 7%     | 0/1           | 0/1           |
| plo6    | cash       | stations | 1200  | -0.29 +/- 0.29   | [-0.86, +0.28]   | 1   | +222.1   | +222.4   | 1                   | 0 (0%)   | 47%         | 0.89     | 38/0                | 38/0                | 11%    | 11%    | 0/34          | 0/34          |
| plo6    | cash       | folders  | 1200  | -1.50 +/- 2.27   | [-5.95, +2.95]   | 4   | +41.9    | +43.4    | 3                   | 2 (67%)  | 45%         | 0.83     | 8/1                 | 6/1                 | 5%     | 6%     | 0/0           | 0/0           |
| plo6    | cash       | mixed    | 600   | +16.82 +/- 12.86 | [-8.38, +42.03]  | 4   | +116.1   | +99.3    | 3                   | 3 (100%) | 44%         | 0.78     | 13/1                | 10/0                | 6%     | 7%     | 0/5           | 0/5           |
| plo6    | tournament | standard | 600   | -11.75 +/- 7.64  | [-26.72, +3.22]  | 8   | +15.1    | +26.8    | 2                   | 1 (50%)  | 44%         | 0.78     | 11/1                | 9/0                 | 6%     | 6%     | 0/2           | 0/2           |
| plo6    | tournament | stations | 1200  | -0.83 +/- 0.61   | [-2.04, +0.37]   | 2   | +62.0    | +62.8    | 2                   | 0 (0%)   | 45%         | 0.81     | 36/0                | 35/0                | 12%    | 12%    | 0/32          | 0/31          |
| plo6    | tournament | folders  | 1200  | +0.87 +/- 3.98   | [-6.93, +8.66]   | 5   | +40.3    | +39.4    | 4                   | 2 (50%)  | 42%         | 0.74     | 6/2                 | 3/1                 | 7%     | 7%     | 0/0           | 0/0           |
| plo6    | tournament | mixed    | 600   | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +109.8   | +109.8   | 0                   | 0        | -           | -        | 10/0                | 10/0                | 9%     | 9%     | 0/4           | 0/4           |

Pooled (6-handed, hand-weighted):

| slice      | pairs | A-B bb/100     | 95% CI         | baseline bluffs | folded   | fold needed |
| ---------- | ----- | -------------- | -------------- | --------------- | -------- | ----------- |
| nlh        | 36000 | +0.73 +/- 0.31 | [+0.12, +1.33] | 72              | 50 (69%) | 44%         |
| plo4       | 12000 | +0.97 +/- 0.97 | [-0.93, +2.87] | 19              | 13 (68%) | 42%         |
| plo5       | 9200  | +1.20 +/- 1.65 | [-2.04, +4.44] | 20              | 16 (80%) | 43%         |
| plo6       | 7200  | -0.05 +/- 1.56 | [-3.11, +3.01] | 19              | 11 (58%) | 44%         |
| standard   | 10800 | +0.35 +/- 1.43 | [-2.45, +3.16] | 55              | 39 (71%) | 44%         |
| stations   | 21400 | +0.44 +/- 0.51 | [-0.57, +1.44] | 11              | 2 (18%)  | 46%         |
| folders    | 21400 | +0.59 +/- 0.59 | [-0.57, +1.75] | 41              | 31 (76%) | 42%         |
| mixed      | 10800 | +2.11 +/- 0.90 | [+0.34, +3.88] | 23              | 18 (78%) | 44%         |
| cash       | 32200 | +1.29 +/- 0.65 | [+0.03, +2.56] | 63              | 47 (75%) | 44%         |
| tournament | 32200 | +0.21 +/- 0.42 | [-0.61, +1.04] | 67              | 43 (64%) | 43%         |
| all        | 64400 | +0.75 +/- 0.39 | [-0.00, +1.51] | 130             | 90 (69%) | 43%         |

### 2-handed

| variant | format     | pool     | pairs | A-B bb/100       | 95% CI           | div | A bb/100 | B bb/100 | baseline bluffs (A) | folded   | fold needed | avg size | A river bets / weak | B river bets / weak | A WTSD | B WTSD | A weak-bet SD | B weak-bet SD |
| ------- | ---------- | -------- | ----- | ---------------- | ---------------- | --- | -------- | -------- | ------------------- | -------- | ----------- | -------- | ------------------- | ------------------- | ------ | ------ | ------------- | ------------- |
| nlh     | cash       | standard | 4000  | +5.49 +/- 2.60   | [+0.40, +10.58]  | 68  | -14.2    | -19.7    | 52                  | 40 (77%) | 43%         | 0.77     | 192/56              | 153/19              | 11%    | 12%    | 8/55          | 1/49          |
| nlh     | cash       | stations | 4000  | -0.14 +/- 1.47   | [-3.01, +2.73]   | 21  | +221.5   | +221.6   | 9                   | 2 (22%)  | 44%         | 0.78     | 379/26              | 374/22              | 19%    | 19%    | 20/351        | 17/347        |
| nlh     | cash       | folders  | 4000  | +1.58 +/- 1.21   | [-0.79, +3.95]   | 49  | +39.4    | +37.8    | 54                  | 49 (91%) | 41%         | 0.71     | 120/57              | 97/37               | 6%     | 6%     | 4/11          | 2/9           |
| nlh     | cash       | mixed    | 4000  | +0.34 +/- 1.04   | [-1.71, +2.38]   | 26  | +58.1    | +57.8    | 21                  | 9 (43%)  | 44%         | 0.79     | 208/22              | 198/14              | 13%    | 13%    | 11/119        | 9/117         |
| nlh     | tournament | standard | 4000  | +5.60 +/- 2.78   | [+0.15, +11.05]  | 280 | -5.0     | -10.6    | 83                  | 67 (81%) | 43%         | 0.75     | 399/99              | 383/88              | 21%    | 22%    | 18/133        | 24/136        |
| nlh     | tournament | stations | 4000  | -1.46 +/- 1.55   | [-4.49, +1.57]   | 45  | +154.8   | +156.2   | 8                   | 2 (25%)  | 44%         | 0.78     | 350/25              | 351/23              | 20%    | 20%    | 20/328        | 18/330        |
| nlh     | tournament | folders  | 4000  | -0.64 +/- 1.55   | [-3.68, +2.40]   | 39  | +53.6    | +54.3    | 42                  | 37 (88%) | 42%         | 0.75     | 103/45              | 102/44              | 6%     | 6%     | 5/11          | 4/9           |
| nlh     | tournament | mixed    | 4000  | +1.20 +/- 1.43   | [-1.59, +3.99]   | 47  | +48.4    | +47.2    | 18                  | 7 (39%)  | 45%         | 0.82     | 268/31              | 282/43              | 16%    | 16%    | 16/143        | 22/150        |
| plo4    | cash       | standard | 1500  | -0.60 +/- 4.77   | [-9.94, +8.74]   | 50  | +16.0    | +16.6    | 8                   | 7 (88%)  | 41%         | 0.71     | 38/10               | 31/3                | 9%     | 8%     | 3/17          | 3/17          |
| plo4    | cash       | stations | 1500  | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +90.4    | +90.4    | 0                   | 0        | -           | -        | 48/2                | 48/2                | 11%    | 11%    | 1/44          | 1/44          |
| plo4    | cash       | folders  | 1500  | -1.62 +/- 3.72   | [-8.90, +5.67]   | 4   | +21.3    | +22.9    | 2                   | 2 (100%) | 46%         | 0.86     | 13/2                | 13/1                | 2%     | 2%     | 0/1           | 0/1           |
| plo4    | cash       | mixed    | 1500  | +0.17 +/- 0.73   | [-1.27, +1.61]   | 8   | +12.5    | +12.3    | 2                   | 1 (50%)  | 43%         | 0.75     | 28/2                | 27/1                | 7%     | 7%     | 0/13          | 1/14          |
| plo4    | tournament | standard | 1500  | +2.20 +/- 5.73   | [-9.02, +13.42]  | 70  | +0.1     | -2.1     | 14                  | 12 (86%) | 41%         | 0.71     | 47/11               | 41/8                | 10%    | 11%    | 2/16          | 3/15          |
| plo4    | tournament | stations | 1500  | -0.72 +/- 0.55   | [-1.80, +0.35]   | 2   | +34.0    | +34.7    | 1                   | 0 (0%)   | 47%         | 0.88     | 41/3                | 40/3                | 12%    | 12%    | 3/39          | 3/38          |
| plo4    | tournament | folders  | 1500  | +0.37 +/- 2.46   | [-4.44, +5.19]   | 12  | +9.7     | +9.4     | 3                   | 1 (33%)  | 42%         | 0.76     | 8/1                 | 5/0                 | 3%     | 4%     | 1/2           | 0/0           |
| plo4    | tournament | mixed    | 1500  | -3.34 +/- 2.36   | [-7.97, +1.28]   | 24  | +1.7     | +5.0     | 8                   | 4 (50%)  | 43%         | 0.74     | 29/7                | 24/3                | 8%     | 9%     | 2/9           | 1/8           |
| plo5    | cash       | standard | 800   | +11.62 +/- 17.51 | [-22.70, +45.95] | 87  | -25.1    | -36.7    | 7                   | 5 (71%)  | 45%         | 0.82     | 38/4                | 35/2                | 10%    | 10%    | 0/12          | 0/10          |
| plo5    | cash       | stations | 800   | -0.56 +/- 0.56   | [-1.67, +0.54]   | 1   | -8.4     | -7.9     | 3                   | 0 (0%)   | 40%         | 0.67     | 38/2                | 37/1                | 14%    | 14%    | 1/30          | 1/30          |
| plo5    | cash       | folders  | 800   | +1.01 +/- 0.74   | [-0.43, +2.46]   | 2   | +26.4    | +25.4    | 1                   | 1 (100%) | 44%         | 0.80     | 6/1                 | 4/0                 | 2%     | 2%     | 0/1           | 0/1           |
| plo5    | cash       | mixed    | 800   | +1.06 +/- 6.42   | [-11.53, +13.65] | 29  | -59.6    | -60.7    | 3                   | 1 (33%)  | 42%         | 0.73     | 20/2                | 16/0                | 9%     | 9%     | 0/8           | 0/7           |
| plo5    | tournament | standard | 800   | -2.62 +/- 8.52   | [-19.32, +14.07] | 48  | -37.6    | -34.9    | 9                   | 7 (78%)  | 41%         | 0.71     | 45/4                | 42/1                | 13%    | 13%    | 0/12          | 1/16          |
| plo5    | tournament | stations | 800   | -0.06 +/- 0.06   | [-0.19, +0.06]   | 1   | -15.1    | -15.0    | 1                   | 0 (0%)   | 40%         | 0.67     | 39/1                | 39/1                | 13%    | 13%    | 1/34          | 1/34          |
| plo5    | tournament | folders  | 800   | -0.73 +/- 2.00   | [-4.65, +3.19]   | 2   | -11.4    | -10.7    | 1                   | 1 (100%) | 47%         | 0.88     | 7/1                 | 6/0                 | 3%     | 3%     | 0/1           | 0/1           |
| plo5    | tournament | mixed    | 800   | +2.62 +/- 4.70   | [-6.58, +11.83]  | 19  | -37.1    | -39.8    | 2                   | 2 (100%) | 44%         | 0.78     | 24/2                | 24/0                | 10%    | 11%    | 0/8           | 0/8           |
| plo6    | cash       | standard | 600   | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +34.2    | +34.2    | 0                   | 0        | -           | -        | 20/0                | 20/0                | 10%    | 10%    | 0/5           | 0/5           |
| plo6    | cash       | stations | 600   | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +135.8   | +135.8   | 0                   | 0        | -           | -        | 28/0                | 28/0                | 10%    | 10%    | 0/23          | 0/23          |
| plo6    | cash       | folders  | 600   | -8.25 +/- 5.00   | [-18.05, +1.55]  | 4   | +72.5    | +80.8    | 2                   | 1 (50%)  | 46%         | 0.85     | 3/2                 | 1/1                 | 2%     | 2%     | 0/0           | 0/0           |
| plo6    | cash       | mixed    | 600   | -3.75 +/- 5.82   | [-15.16, +7.66]  | 22  | +42.4    | +46.2    | 3                   | 1 (33%)  | 45%         | 0.81     | 20/3                | 16/0                | 6%     | 7%     | 1/7           | 0/6           |
| plo6    | tournament | standard | 600   | +27.17 +/- 14.06 | [-0.39, +54.72]  | 60  | +28.9    | +1.8     | 6                   | 6 (100%) | 40%         | 0.68     | 26/4                | 24/0                | 9%     | 10%    | 0/4           | 0/4           |
| plo6    | tournament | stations | 600   | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +76.5    | +76.5    | 0                   | 0        | -           | -        | 23/0                | 23/0                | 10%    | 10%    | 0/20          | 0/20          |
| plo6    | tournament | folders  | 600   | +0.00 +/- 0.00   | [+0.00, +0.00]   | 0   | +33.1    | +33.1    | 0                   | 0        | -           | -        | 2/0                 | 2/0                 | 3%     | 3%     | 0/1           | 0/1           |
| plo6    | tournament | mixed    | 600   | +15.82 +/- 8.57  | [-0.99, +32.63]  | 19  | +39.6    | +23.8    | 2                   | 2 (100%) | 41%         | 0.68     | 15/1                | 16/0                | 8%     | 8%     | 0/4           | 0/5           |

Pooled (2-handed, hand-weighted):

| slice      | pairs | A-B bb/100     | 95% CI         | baseline bluffs | folded    | fold needed |
| ---------- | ----- | -------------- | -------------- | --------------- | --------- | ----------- |
| nlh        | 32000 | +1.50 +/- 0.64 | [+0.25, +2.75] | 287             | 213 (74%) | 43%         |
| plo4       | 12000 | -0.44 +/- 1.13 | [-2.66, +1.77] | 38              | 27 (71%)  | 42%         |
| plo5       | 6400  | +1.54 +/- 2.64 | [-3.64, +6.73] | 27              | 17 (63%)  | 43%         |
| plo6       | 4800  | +3.87 +/- 2.27 | [-0.58, +8.32] | 13              | 10 (77%)  | 42%         |
| standard   | 13800 | +5.09 +/- 1.88 | [+1.41, +8.77] | 179             | 144 (80%) | 43%         |
| stations   | 13800 | -0.58 +/- 0.62 | [-1.80, +0.64] | 22              | 4 (18%)   | 43%         |
| folders    | 13800 | -0.20 +/- 0.79 | [-1.75, +1.34] | 105             | 92 (88%)  | 42%         |
| mixed      | 13800 | +0.84 +/- 0.87 | [-0.86, +2.54] | 59              | 27 (46%)  | 44%         |
| cash       | 27600 | +1.06 +/- 0.82 | [-0.54, +2.67] | 167             | 119 (71%) | 43%         |
| tournament | 27600 | +1.51 +/- 0.81 | [-0.07, +3.09] | 198             | 148 (75%) | 43%         |
| all        | 55200 | +1.29 +/- 0.57 | [+0.16, +2.41] | 365             | 267 (73%) | 43%         |

Illegal actions 0, truncated streets 0, brain exception fallbacks 0 across 64 cells.
