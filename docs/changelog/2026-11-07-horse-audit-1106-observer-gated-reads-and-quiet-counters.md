# Daily horse audit 2026-11-06: observer-gated reads, quiet counters, tuner sentinel

Every number below was re-read from production (read-only) on 2026-11-07.

## 1. "Dead" read layers are observer-gated (ledger + audit fixed, no brain change)

`v16_reads_f3b`, `v16_reads_cbet`, `v23_river_read` and `v16_reads_tell` all
stepped down on 2026-10-26, the day observer-independent memory (#8075) went
live: each horse now reads only what it observed itself, per variant, format
and dealt-size scope. Public-history rehydration is card-free, and the
owner-approved herd notes (#8235) feed the exploit read, not these counters.

| read           | per decide, pooled mind (10-18..10-25) | per decide, 11-01..11-07     |
| -------------- | -------------------------------------- | ---------------------------- |
| v16_reads_f3b  | 17.2-22.4%                             | 0.026-0.147% (median 0.083%) |
| v16_reads_cbet | 1.32-1.46%                             | 0.011-0.050% (median 0.030%) |
| v23_river_read | 3.56-4.42%                             | 0.033-0.242% (median 0.116%) |
| v16_reads_tell | 23,562 fires on 10-25                  | 0 every day from 11-01       |

The tell needs five big river bets by one player that reached showdown, seen
by one horse in one scope, so it is now effectively silent. That is the
design (no horse reads another horse's observations), not a wiring fault:
`HorseObserverDeepReads.test.ts` drives the real observer sandbox and shows
the horse that saw the sample reads it while every other horse reads null.

`v62_river_bettor_polarity` is opt-in since 2026-10-30 (#8781) and no live
caller sets it; its 0.1% floor reported the default as `data_unread`.

Changes: `HorseDataLedger.ts` re-floors f3b 0.1 -> 0.0002, cbet 0.005 ->
0.00005, v23 0.01 -> 0.0002 (each under the post-change week's minimum),
drops the floors on `v16_reads_tell` and `v62_river_bettor_polarity`, and
migration `20261107233449` makes a zero `v16_reads_tell` a
`layer_observer_gated` note instead of a `layer_silent` warn.

## 2. v29_gto_flop and v51_river_flat: not significantly negative, both stay on

The audit's figures were single nightly rows: v29 -8.25 +/- 3.66 bb/100 and
v51 -0.80 +/- 0.38 on 2026-11-06 (12,000 hands each). Pooled nightly rows
2026-10-08..11-04: v29 +0.63 +/- 0.28, v51 +0.23 +/- 0.05 (28 runs, 336,000
hands); 11-05..11-07: v29 -2.87 +/- 1.83, v51 -0.64 +/- 0.22 (36,000 hands).

Offline ablation 2026-11-07, `server/scratch/league-opt-in-dispositions.ts`,
arm A = layer on (default) vs arm B = layer off, frozen 2026-10-27 chart and
postflop stores (240 / 7,747 entries), 12 seeds (2026110701-04 x 15,000
pairs, 2026110711-18 x 30,000 pairs), 600,000 hands per row, 0 illegal actions:

| card           | baseline              | bb/100 (on - off) | stderr | divergent pairs |
| -------------- | --------------------- | ----------------- | ------ | --------------- |
| v29_gto_flop   | hybrid (production)   | -0.31             | 0.40   | 25,180          |
| v29_gto_flop   | legacy (nightly card) | -0.31             | 0.50   | 27,168          |
| v51_river_flat | hybrid (production)   | +0.14             | 0.06   | 808             |
| v51_river_flat | legacy (nightly card) | -0.16             | 0.09   | 1,439           |

v29: unresolved (|bb/100| < 2 stderr on both baselines; the -8.25 row is
not reproduced). v51: non-negative on the production baseline (+0.14 +/-
0.06) and not significant on the legacy card. Neither meets the bar for
turning a layer off, so both defaults are unchanged; the nightly matchups
keep measuring them.

## 3. Silent phase8-15 counters and v19_overbet_polarity: play mix and governance, not emission

No telemetry name or writer changed. One engine release shipped in the
window (92e26a9fbf, 2026-11-06 14:02 UTC).

- Cash play collapsed while tournaments grew. Cash hands: 246,159 on 11-04,
  125,992 on 11-05, 56,272 on 11-06 (FLH 25,011 -> 1,208, PLO5 59,373 ->
  1,128, PLO6 43,631 -> 1,564). Cash decisions (`phase13_utility_cash`)
  2.60M -> 1.33M -> 0.62M. Short deck and Pineapple dealt no hands after
  11-02. The phase10-15 lanes are cash lanes (phase12 = FLH/FLO8 cash,
  phase11 = PLO5/6/8 cash), so their populations fell 78-95%.
- The applied/selected counters went to zero because the lanes held no
  activation authority on 11-06: `phase12_authority_verdict_usable` 10,009
  (11-04) -> 783 -> 0, workers reported `authority_worker_*_unselected`
  (80 on 11-05, 16 on 11-06), and the lane ran in shadow
  (`phase12_shadow_changed` 1,198, `phase12_applied` 0). Fail-closed by
  design (`HorseFeatureAuthority.ts`: missing selection = unselected). The
  11-07 release restored it (`phase12_applied` 1,037, verdict usable 1,039).
- `v19_overbet_polarity` fires only facing a river overbet over 1.2x pot.
  Hybrid v1 (#9488, one Grinder/Tricky profile, sizing x0.94) took effect
  11-05/06, and the fleet stopped making them: cash NLH river wagers over
  1.2x pot were 1,699 of 11,126 (15.3%) on 11-04, 629 of 4,927 (12.8%) on
  11-05 and 150 of 3,849 (3.9%) on 11-06. Its ledger floor moves 0.0005 ->
  0.00005 (11-06 0.0135%, 11-07 0.0141% per decide).

## 4. Self-tuner real_bb100 = -9999 is the documented sentinel

247 rows on 11-06/11-07 (6,864 all time). Every one has
`real_hands` <= 1,499 (all-time max 1,499); every non-sentinel row since
11-01 has `real_hands` >= 1,504. `HorseSelfTuner.ts` writes -9999 exactly
when the real-money sample is under `MIN_REAL_HANDS_FOR_BB100` (1,500). The
one 11-06/07 row with `hands` >= 1,500 counts all observed hands; its
real-money sample is under the bar. No defect.
