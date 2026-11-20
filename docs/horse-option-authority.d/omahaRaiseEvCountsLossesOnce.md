# omahaRaiseEvCountsLossesOnce: authority for the live switch (OFF-ONLY)

Built by the PLO Strategy lane (priced2-013U37, review N1 of 9f803db63df); split behind this option in the 2026-11-18 option batch by the lead's ruling on review R2 (B2). **OFF-ONLY (ploFailed): it cannot be switched on.**

## What it does

PLO4/PLO5 cash; default off (read `=== true`). The value of a priced raise (`HorseOmahaPricedRules.omahaPricedRaise`) counts the strongest part of his range that raises again ONCE (`omahaPricedRaiseAloneEv`), with that part's region in the continuing part's units (the `(1 - q)` divisor). It serves the three consumers of the raise verdict: omahaTurnRiverRaiseIsPriced, omahaPressureIsPriced and omahaBigBetCallsArePriced. Off: the #11212 formula verbatim (the called result averaged over the whole continuing part, the re-raisers' losses then charged again). Test: HorseOmahaPricedKindOptions.test.ts (both off: the three consumers on every recorded decision are #11212's; both on: priced2's recorded answers).

## Evidence (PROVISIONAL)

priced2 league, configuration 0 (base + omahaTurnRiverRaiseIsPriced vs base), source fad0d304ffd, with the opponent-kind priors AND this correction on: human-like field F4 +1.80 +/- 2.45 bb/100, F5 -1.29 +/- 2.17, pooled +0.25 +/- 1.64; Horse-only M4 -1.84 +/- 0.88, M5 +0.17 +/- 1.29, pooled -0.83 +/- 0.78; 0 illegal. VERDICT FAIL (M4 below minus two standard errors). Provisional: the per-session rows were on SSD1 when it dropped off the Mac (priced2-013U37/eval/RUN1-LOST-SSD1.md holds the aggregates as printed), and the run did not separate this correction from the kind priors.

Overall: FAILED. Off-only until a new build passes a new bar.

League cards (HorseLeague.ts, declared, not run): plo4_omaha_raise_ev_counts_losses_once and plo5_omaha_raise_ev_counts_losses_once: the live options of 2026-11-16 in both arms, arm A adds omahaRaiseEvCountsLossesOnce (both arms carry every priced family on).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
