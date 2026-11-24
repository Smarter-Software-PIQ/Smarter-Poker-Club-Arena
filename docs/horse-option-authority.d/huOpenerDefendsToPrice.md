# huOpenerDefendsToPrice: authority for the live switch

Heads Up lane option (2026-11-14, HU-NLH-010), default OFF in source, read once as `opts.huOpenerDefendsToPrice === true` (server/src/engine/HorseLogic.ts). It widens a preflop calling range facing a 3-bet, so it is registered off-only under the owner preflop range hold (`OPTION_SWITCH_OFF_ONLY.huOpenerDefendsToPrice`, status `hold`, source `owner preflop range hold`; allowed states `off` only). The hold stands: the 2026-11-20 lift (PR #11538) was for huBbDefendsUnreadToPrice alone, and its source comment names this option as staying off-only. Evidence NOT MET: the owner preflop range hold holds it off, no lift by name exists, its earlier 12-cell evaluation passed non-harm without a pooled significant gain (pooled mirror `-0.08 +/- 0.25` bb/100, pooled personas `+0.34 +/- 0.36` bb/100; wide small-blind aggressor 40bb `+4.75 +/- 1.29`), and although the 2026-11-22 hosted solver-hydrated Tier 1 run (`44994577333`, `human_hu_opener_defends_vs_wide_40bb`) measured a SIGNIFICANT gain (`+6.74 +/- 2.23 bb/100`, `z = +3.02`, 3/3 positive seeds, `0/0/0/0`), no replay on real audited decisions has been run. Missing, in order: the owner preflop range hold lifted for this name; scorer-written Replay rows on the corrected replay history (#11556).

## What it does

Code: server/src/engine/HorseHuBbDefence.ts (`HU_BB_EQUITY`, `HU_DEFENCE_REFERENCE_WIDTH_PCT` 20, `HU_OPENER_REALIZATION` 0.85, `huDefenceWidthPct`, `huOpenerRequiredEquity`), server/src/engine/HorseLogic.ts (`huOpenerPrice`, the one read), server/src/engine/HorsePreflop.ts (the call branch, "HU OPENER DEFENDS TO ITS PRICE").

Heads-up no-limit hold'em cash, exactly two dealt in, the small blind that made the only open and faces exactly one 3-bet of 1.8x-7x that is not all in, 20-150bb effective: a hand the bars fold is called when its all-in equity against the 3-bettor's range (`HU_BB_EQUITY` read as a linear range: the opponent read's re-raise share when engaged and 20% or wider, else the 20% narrowest reference column; a read narrower than 20% has no column and the fold stays), times a 0.85 in-position realisation assumption, covers the rake-aware pot odds under the same stack cap as the existing call. Widen-only and call-only (a fold becomes a call; no 4-bet, jam or sizing changes); three or more dealt, tournaments, Omaha, short deck, pot and fixed limit, straddles, bomb pots and All-In-Or-Fold unchanged. Ledger: server/src/engine/HorseDataLedger.ts flag `huOpenerDefendsToPrice` (tag HuDefence).

## Receipts

hu_opener_defends_to_price (server/src/engine/HorseDataLedger.ts): counted only for a call that is still the final decision, where the heads-up opener facing one 3-bet called a hand its bars folded because its realised equity against the 3-bettor range covered the price.

## Tests

- server/src/engine/HorseHeadsUpOpenerAndLimperDefendToPrice.law.test.ts (docs/laws.d/server-src-engine-HorseHeadsUpOpenerAndLimperDefendToPrice.md): widen-only fold to call, scope guards, receipt equals changed final decisions, explicit false identical to unset, single `=== true` read.
- server/src/engine/HorseOptionSwitchPreflopHoldLift.test.ts: still off-only beside the huBbDefendsUnreadToPrice lift (docs/changelog/2026-11-20-heads-up-big-blind-hold-lifted-by-name.md).
- server/src/benchmark/ADefaultOffFlagHasALeagueCard.law.test.ts and server/src/benchmark/HorseLeagueHumanField.test.ts: active league card `human_hu_opener_defends_vs_wide_40bb` diverges; retired inert card `human_hu_opener_defends_vs_threebet_40bb` is refused.

## Evidence rows

Rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md. Nothing was run for this file; every number below is copied from the record named beside it.

- Mechanism, scope, receipt, tests: recorded (docs/changelog/2026-11-14-heads-up-opener-and-limper-defend-to-price.md and the tests above).
- Value: NOT MET.
  - Declared 12-cell evaluation (`evaluation/RESULTS-HU-DEFENCE.md`, run on `2017e96d`, 96 jobs, 0 failed): PASS on the non-harm rule (12 of 12 cells, lowest z `-1.31`), pooled mirror `-0.08 +/- 0.25` bb/100, pooled personas `+0.34 +/- 0.36` bb/100, one positive cell (wide small-blind aggressor 40bb `+4.75 +/- 1.29` bb/100) (docs/changelog/2026-11-14-heads-up-opener-and-limper-defend-to-price.md).
  - Divergence probes on `human_hu_opener_defends_vs_wide_40bb` (`b262fd3e0`, replacing inert retired `human_hu_opener_defends_vs_threebet_40bb`): 12,000 pairs `-2.26 +/- 2.71` (303 divergent), 3,000 pairs `+6.13 +/- 6.25` (83 divergent), 1,500 pairs `-8.91 +/- 10.26` (40 divergent), 0 illegal actions (docs/changelog/2026-11-15-heads-up-opener-defence-card-faces-a-realistic-three-bettor.md).
  - Hosted solver-hydrated Tier 1 league (`horse-league-card-hydrated.yml`, Run `44994577333`, `2026-11-22T06:37:44Z` to `06:40:46Z`, engine `6336dcf6c90d3c02b38e5cb803ae264bd0b13e0d`, `charts=240`, `postflop=7,747`, `postflopV31=0`, `EQUITY_GOVERNOR=off`; archive `HYDRATED-TIER1-RESULTS-20261122.md`) on `human_hu_opener_defends_vs_wide_40bb` (`huOpenerDefendsToPrice: true` vs `{}`, `human-calibrated-v1-20261008`, `hu_wide_sb_aggressor_v1`, 3 seeds x 6,000 pairs = 36,000 hands):
    - `20261120`: A `+29.21`, B `+23.15`, A - B `+6.06 +/- 4.22 bb/100` (`blockSE 5.38`, `z = +1.44`, not resolved, `178` div, `45.4 s`, `0/0/0/0`)
    - `20261121`: A `+32.34`, B `+21.71`, A - B `+10.63 +/- 3.61 bb/100` (`blockSE 3.10`, `z = +2.94`, SIGNIFICANT, `138` div, `43.9 s`, `0/0/0/0`)
    - `20261122`: A `+28.98`, B `+25.47`, A - B `+3.51 +/- 3.73 bb/100` (`blockSE 3.39`, `z = +0.94`, not resolved, `156` div, `45.0 s`, `0/0/0/0`)
    - **Pooled (`18,000` pairs / `36,000` hands):** A `+30.18`, B `+23.44`, **A - B `+6.74 +/- 2.23 bb/100` (`z = +3.02`, SIGNIFICANT, 3/3 positive seeds, `472` divergent pairs, `0/0/0/0` safety)**.
  - Stated limits: `HU_BB_EQUITY` is read as a linear 20-100% range (narrowest column 20%, wider than the Horses' ~9% big-blind 3-bet rate against unread opponents), and the 0.85 realisation share is an assumption rather than a measurement.
- Owner authority: NOT MET. Off-only under the owner preflop range hold; no lift by name exists (`OPTION_SWITCH_PREFLOP_HOLD_LIFTED` does not list it).
- Replay on real audited decisions: NOT MET (see Replay).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (off-only under the owner preflop range hold; no audited-decision replay was scored, and any replay must use the corrected history of #11556, which removed forced posts from replayed preflop actionHistory)

## Rollback

Locked `off`-only under the owner preflop range hold (`OPTION_SWITCH_OFF_ONLY.huOpenerDefendsToPrice`, source default OFF). If the hold is ever lifted and the option enabled, immediately roll back to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('huOpenerDefendsToPrice', 'off', '<actor>', '<reason>')`), restoring the base brain within ~30s with zero data migration needed.

## Evidence check, 2026-11-24

Checked 2026-11-24: `HYDRATED-TIER1-RESULTS-20261122.md` is present at `/Volumes/SmarterArchives/agent-evidence/extreme-archive/antigravity-coordinator-20261121/HYDRATED-TIER1-RESULTS-20261122.md` (sha256 `9afabb5a6a86bd160d087fddf8c3a4d2059545e3a46297152286a7b52d46533a`).
