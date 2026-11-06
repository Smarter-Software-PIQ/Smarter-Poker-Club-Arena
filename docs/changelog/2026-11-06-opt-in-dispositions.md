# Opt-In Horse Layers: Dispositions Against The Hybrid Baseline (2026-11-06)

## Scope

Dan's lane: for V62, PLO6 cash V24, `tournamentFlatBump` and the nine league
arms (`v15Boats`, `v16Hu`, `v16Ratio`, `v17RiverProbe`, `v23ShortDeck`,
`v32FacingDefense`, `v33DepthCeiling`, `v46ShortDeck`,
`v55OmahaRiverTripsFlat`), tell apart an implementation defect, a negative
measured result, insufficient evidence, a calibration experiment and a
superseded design; repair intended capabilities; rerun against the current
baseline. One production default changes: V15 boats in PLO5 cash.

## What Changed In Code

1. **V62 stratum defect, repaired.** `v62ValueClass` reads "two pair or
   better made by the hole cards" off the made category. On a paired board
   (K K 9 7 2) every hand that pairs one hole card makes "two pair" (kings
   and nines), so the river bettor's top-pair and weaker-pair strata were
   empty there and every V62 value draw sampled the whole one-private-pair
   population as two pair or better. The V67 hero gate already treats a
   paired-board two pair as one pair; the opponent stratum did not. The new
   `v62RiverBettorClass` takes the board's own pair out (one private pair is
   classed as top pair / overpair or weaker pair; trips, two private pairs,
   a boat and anything on an unpaired board are unchanged), and only the V62
   river-bettor index uses it. V66 and V67 keep `v62ValueClass` unchanged
   (they are live layers outside this lane; the same reading applies to
   them and is reported for their owner, not changed here). V62 stays opt-in,
   so live play is unaffected.
   1b. **V15 boats default ON in PLO5 cash.** `v15BoatsOn` (HorseLogic) scopes
   the default to the one variant and mode the league measured; the
   `plo5_v15_boats` card keeps its name and sign with arm B off, and
   `full_vs_v2_legacy` turns it off with the other live layers.
2. **`hybridBaseline` league option.** A mirror card can now seat every
   horse on the style and four dials production serves for the card's game
   mode (`HORSE_HYBRID_PROFILES`: cash Grinder/Pebbles, tournament
   Tricky/Flint). Arms still differ only in their flags; `modsA`/`modsB`
   apply on top. It refuses `productionStyles` and human-field cards rather
   than silently ignoring itself. The nightly card is unchanged.
3. `server/scratch/league-opt-in-dispositions.ts`: the rerun harness. It
   hydrates the chart and V29/V30 postflop stores through the production
   store modules (`setGtoCharts`, `replaceGtoPostflop`, same validation)
   from a SELECT-only snapshot (240 chart rows, 7,747 postflop cells, built
   2026-09-03T18:18:13Z), with `EQUITY_GOVERNOR=off` (the live engine's
   `/health` reports the governor disabled). Without the stores the brain
   plays its heuristic fallback, which is not the production baseline: the
   first, store-less pass is kept below as a separate column.

## Method

Duplicate-deal mirror, Hybrid baseline, seed 2026110601 unless noted, 60,000
pairs (120,000 hands) unless noted. Seeds are development seeds; no reserved
held-out seed was dealt. bb/100 is arm A (layer on) minus arm B (today's
brain).

| Capability              | Card                           | Rerun (n hands) | bb/100                   | Stderr             | Divergent pairs  |
| ----------------------- | ------------------------------ | --------------- | ------------------------ | ------------------ | ---------------- |
| V62 (repaired)          | 200bb six-max                  | 120,000         | -0.02                    | 0.42               | 739              |
| V62 (repaired)          | 100bb six-max                  | 120,000         | -0.19                    | 0.23               | 613              |
| V62 (repaired)          | 40bb six-max                   | 120,000         | -0.06                    | 0.10               | 501              |
| PLO6 cash V24           | plo6_v24_price, 8 seeds        | 96,000          | -0.52                    | 0.75               | 9,722            |
| tournamentFlatBump 0.06 | MTT 180 left, 100bb            | 120,000         | -0.10                    | 0.19               | 1,110            |
| tournamentFlatBump 0.06 | MTT 180 left, 40bb             | 120,000         | -0.13                    | 0.12               | 859              |
| v15Boats                | plo5_v15_boats, 6 seeds        | 72,000          | +0.21                    | 0.18               | 266              |
| v16Hu                   | hu_v16_overlay                 | 120,000         | -0.43                    | 0.43               | 1,662            |
| v16Hu                   | v16_hu_overlay_6max            | 120,000         | -0.33                    | 0.15               | 905              |
| v16Ratio                | v16_ratio_rescale              | 12,000          | 0.00                     | 0.00               | 0 (inert)        |
| v17RiverProbe           | v17_river_probe                | 120,000         | +0.05                    | 0.07               | 180              |
| v23ShortDeck            | shortdeck_v23                  | 120,000         | -0.30                    | 0.19               | 950              |
| v32FacingDefense        | v32_facing_defense             | 120,000         | -0.40                    | 0.57               | 4,063            |
| v33DepthCeiling         | 400bb heads-up, seeds 01/02/03 | 3 x 120,000     | +11.60 / +12.27 / +11.68 | 1.98 / 2.12 / 1.69 | about 7,500 each |
| v46ShortDeck            | shortdeck_v46_classes          | 120,000         | +0.10                    | 0.31               | 3,413            |
| v55OmahaRiverTripsFlat  | PLO4 / PLO5 / PLO6, 400bb      | 20,000 each     | inert                    |                    | 2 / 0 / 0        |

Store-less first pass (heuristic fallback, not the production baseline), kept
for comparison: V62 200bb -1.27 +/- 0.47, 100bb -0.58 +/- 0.26, 40bb
-0.20 +/- 0.12; flat bump 100bb -0.23 +/- 0.22, 40bb -0.02 +/- 0.13; v33
inert (no solver consult to decline).

## Dispositions

| Capability             | Classification                                                                                         | Action                                                                                                                     | Status                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| V62                    | Implementation defect (paired-board stratum), repaired; rerun no longer negative, not positive         | Classifier repaired with tests; stays opt-in                                                                               | Unresolved: not shown positive in the mirror or the human-field twin |
| PLO6 cash V24          | Insufficient evidence (nightly flipped from -2.50 to +1.10 +/- 1.33 since 11-01; rerun -0.52 +/- 0.75) | Stays off in PLO6 cash; qualification is `Plo6V24Qualification` (held-out contract not yet locked; no held-out seed dealt) | Unresolved                                                           |
| tournamentFlatBump     | Calibration experiment, measured no benefit                                                            | League-only option, no production default                                                                                  | Closed                                                               |
| v15Boats               | Passer: nightly pool +0.128 +/- 0.050 (38 runs), rerun same sign                                       | Default ON in PLO5 cash (`v15BoatsOn`), card flipped to arm B off, receipts in activation.sql                              | Enabled for PLO5 cash; PLO4/6/8 and tournaments unmeasured           |
| v16Hu                  | Negative measured result                                                                               | Stays off                                                                                                                  | Closed                                                               |
| v16Ratio               | Superseded design (V38 returns first)                                                                  | Stays off; refused row stands                                                                                              | Closed                                                               |
| v17RiverProbe          | Negative measured result (no edge in 876,000 hands)                                                    | Stays off                                                                                                                  | Closed                                                               |
| v23ShortDeck           | Negative measured result                                                                               | Stays off                                                                                                                  | Closed                                                               |
| v32FacingDefense       | Negative measured result                                                                               | Stays off                                                                                                                  | Closed                                                               |
| v33DepthCeiling        | Conflicting evidence: local positive, nightly negative                                                 | Stays off (see below)                                                                                                      | Unresolved                                                           |
| v46ShortDeck           | Negative measured result (nightly), rerun inconclusive                                                 | Stays off                                                                                                                  | Closed                                                               |
| v55OmahaRiverTripsFlat | Insufficient evidence: unreachable in self-play                                                        | Stays opt-in; pinned by its scenario test                                                                                  | Unresolved                                                           |

## V33: Why It Is Not Switched On

The ceiling wins by eleven to fifteen bb/100 in every local run (three
Hybrid seeds, the legacy balanced field, and with the equity governor on),
while the nightly card pools it -2.10 +/- 0.67 over 61 runs (-3.10 +/- 1.88
over the five runs since 2026-11-01). The documented activation path is a
pooled significant positive league result, and the nightly pool says the
opposite, so this PR does not flip it. The two do not execute the same
workload: on identical code the nightly worker plays the heads-up cards
(v33, hu_v16, v32) in about 4 seconds per 12,000 hands, ten to fifty times
faster per hand than this harness, while its six-max and Omaha cards run
at about this harness's speed. Ruled out so far: the V31 store (no V31
dataset is active, `gto_v31_serving_bindings` is empty), the equity
governor (live `/health` reports it disabled; a governor-on local run is
+15.24 +/- 2.87) and the Hybrid dials (the legacy balanced field is
+13.41 +/- 2.56). Until that difference is explained, neither figure can
authorize a default change. Unresolved.

## Related Open PRs

- #8791 (V62 calibration arms): its evidence is consistent with the defect
  (the loss sat in V62 calling more than the contact read). Not merged: its
  arms tune shares on the pre-repair stratum and pre-Hybrid baseline.
- #8797 (c-bet size arm): no significant result in any arm; not in this
  lane's list; not merged.
