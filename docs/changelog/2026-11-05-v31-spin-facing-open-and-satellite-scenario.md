# Short-Handed Facing Opens Leave Jam-or-Fold, and the Satellite Scenario Deals Flops

The V31 R7 candidate (dataset 187815b1, checksum afad6a66...) failed its evaluation in epoch 2. The failing component was paired_replay/spin: 10,000 hands, 0 candidate hits. An offline replay of all 18 evaluation components (paired replay and league, in a worker thread, with the R7 cell keys installed) found three with zero hits: spin chip_ev, spin spin_ladder and tourney_icm satellite. They have two independent causes.

## V82 `v70FacingOpenZone` (engine, default on)

V70 (#8995) gave two- and three-handed tables their own jam-or-fold zone: at most 15bb, or 12bb without the M layer. The table-size-scaled M read had put every heads-up and spin stack under 22bb into jam-or-fold. Only the unopened open used the new zone. Facing a raise, `decidePreflopV7Core` still read `legacyPushFold`, so a 20bb spin or heads-up stack could only jam or fold.

In the evaluator's spin context (3-handed, 20bb), the big blind facing a button min-raise never called. Every postflop decision the candidate saw was in a limped SB-vs-BB pot, so the button-vs-big-blind single-raised cells (cbet, barrel, delayed_cbet, probe, open and the rest) could never be reached.

Facing action now reads the short-handed zone for two- and three-handed no-limit hold'em. Short deck, fixed limit and Omaha keep the legacy gate, as they do for the open. Four or more dealt in is unchanged. `HorseDecideOpts.v70FacingOpenZone === false` keeps the old answer. The flag is registered in HorseDataLedger.

Measured with the league simulator (`runMatchup`: duplicate deals, both mirrors, mind on in sandboxes). Arm a is the default; arm b is `{ v70FacingOpenZone: false }`. Each row is 50,000 pairs (100,000 hands), seed 82001.

| context | a minus b, bb/100 |
|---|---|
| spin, 3 seats, 20bb, chip EV (evaluator context) | +6.34 +/- 0.59 (seed 82002: +6.02 +/- 0.61) |
| spin, 3 seats, 18bb | +6.35 +/- 0.56 |
| spin, 3 seats, 25bb | +0.08 +/- 0.11 (inert: the legacy gate stops at 22bb) |
| heads-up tournament, 20bb | +5.02 +/- 0.80 |
| pooled, equal weight | +4.45 +/- 0.29 (+5.90 +/- 0.38 without the inert 25bb row) |

Zero illegal actions and zero truncated streets in every row.

Big blind facing a button min-raise, spin 20bb, seed 82001:

| arm | fold | call | jam | 3-bet |
|---|---|---|---|---|
| off | 18,490 | 112 | 2,847 | 0 |
| on | 5,122 | 12,764 | 3,032 | 1,093 |

The off arm reproduces the pre-change behaviour.

Limit: these are horse-vs-horse mirrors. They are not measured against the human-calibrated field. The EquityGovernor scaled Monte Carlo samples under load equally for both arms.

## Satellite evaluation scenario (benchmark only)

The tourney_icm satellite scenario put nine players left on six seats with stacks [160 .. 32] chips. Every seat had 40bb (80 chips), ranked 4th, was three busts from a seat, and had a 12bb blind runway. So `satelliteRead` marked every seat locked, and a locked seat folds every pot by design (V37). No flop was ever dealt: 0 postflop decisions in 2,000 hands.

The scenario now has twelve players left for six seats. The utility is still `satellite`, but no seat is near enough the seat line to be locked.

## Result

With both changes, every component reaches the candidate (stand-in models, R7 cell keys). Paired replay / league hits:

| component | paired replay | league |
|---|---|---|
| cash | 130 | 132 |
| spin chip_ev | 116 | 109 |
| spin spin_ladder | 47 | 52 |
| tourney_ev | 47 | 58 |
| satellite | 9 | 9 |
| bubble | 4 | 3 |
| final_table | 6 | 5 |
| in_money | 8 | 5 |
| ladder | 6 | 4 |

Every component has 0 execution mismatches, 0 illegal actions and 0 truncated streets. Spin counts move by a few hits between identical runs, because the EquityGovernor scales Monte Carlo samples with event-loop load.
