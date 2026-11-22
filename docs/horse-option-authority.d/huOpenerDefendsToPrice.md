# huOpenerDefendsToPrice: authority for the live switch

Heads Up lane option (2026-11-14, HU-NLH-010), default OFF in source, read once as `opts.huOpenerDefendsToPrice === true` (server/src/engine/HorseLogic.ts). It widens a preflop calling range facing a 3-bet, so it is registered off-only under the owner preflop range hold (`OPTION_SWITCH_OFF_ONLY.huOpenerDefendsToPrice`, status `hold`, source `owner preflop range hold`; allowed states `off` only). The hold stands: the 2026-11-20 lift (PR #11538) was for huBbDefendsUnreadToPrice alone, and its source comment names this option as staying off-only. Evidence NOT MET: the owner preflop range hold holds it off, no lift by name exists, its declared 12-cell evaluation passed the non-harm bar without a pooled significant gain (pooled mirror `-0.08 +/- 0.25` bb/100, pooled personas `+0.34 +/- 0.36` bb/100; wide small-blind aggressor 40bb `+4.75 +/- 1.29`), and no replay on real audited decisions has been run. Missing, in order: the owner preflop range hold lifted for this name; a significant positive evaluation on the declared bar; scorer-written Replay rows on the corrected replay history (#11556).

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
  - Stated limits: `HU_BB_EQUITY` is read as a linear 20-100% range (narrowest column 20%, wider than the Horses' ~9% big-blind 3-bet rate against unread opponents), and the 0.85 realisation share is an assumption rather than a measurement.
- Owner authority: NOT MET. Off-only under the owner preflop range hold; no lift by name exists (`OPTION_SWITCH_PREFLOP_HOLD_LIFTED` does not list it).
- Replay on real audited decisions: NOT MET (see Replay).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (off-only under the owner preflop range hold; no audited-decision replay was scored, and any replay must use the corrected history of #11556, which removed forced posts from replayed preflop actionHistory)
