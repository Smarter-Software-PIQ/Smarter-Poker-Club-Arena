# huLimpDefendsToPrice: authority for the live switch

Heads Up lane option (2026-11-14, HU-NLH-011), default OFF in source, read once as `opts.huLimpDefendsToPrice === true` (server/src/engine/HorseLogic.ts). It widens a preflop calling range after a small-blind limp facing a raise, so it is registered off-only under the owner preflop range hold (`OPTION_SWITCH_OFF_ONLY.huLimpDefendsToPrice`, status `hold`, source `owner preflop range hold`; allowed states `off` only). The hold stands: the 2026-11-20 lift (PR #11538) was for huBbDefendsUnreadToPrice alone, and its source comment names this option as staying off-only. Evidence NOT MET: the owner preflop range hold holds it off, no lift by name exists, its declared 12-cell evaluation was inert in 10 of 12 cells with no significant positive cell (`+2.07 +/- 1.68` at 25bb and `+3.51 +/- 2.50` at 40bb vs min-raise persona; nightly card `+4.66 +/- 5.47`, not significant), and no replay on real audited decisions has been run. Missing, in order: the owner preflop range hold lifted for this name; a significant positive evaluation on the declared bar; scorer-written Replay rows on the corrected replay history (#11556).

## What it does

Code: server/src/engine/HorseHuBbDefence.ts (`HU_BB_EQUITY`, `HU_DEFENCE_REFERENCE_WIDTH_PCT` 20, `HU_LIMP_REALIZATION` 0.8, `HU_LIMP_MAX_RAISE_BB` 6, `huDefenceWidthPct`, `huLimpRequiredEquity`), server/src/engine/HorseLogic.ts (`huLimpPrice`, the one read), server/src/engine/HorsePreflop.ts (the call branch, "HU LIMPER DEFENDS TO ITS PRICE").

Heads-up no-limit hold'em cash, exactly two dealt in, the small blind that limped and faces exactly one raise to 6bb or less that is not all in, 20-150bb effective: a limp the bars fold is called when its all-in equity against the raiser's range (`HU_BB_EQUITY` read as a linear range at the 20% narrowest reference column, never widened by a read because no read measures a raise over a limp; an engaged raise read narrower than 20% has no column and the fold stays), times a 0.8 realisation assumption, covers the rake-aware pot odds. Widen-only and call-only (the limp itself, limp-raises and existing calls unchanged); three or more dealt, tournaments, Omaha, short deck, pot and fixed limit, straddles, bomb pots and All-In-Or-Fold unchanged. Ledger: server/src/engine/HorseDataLedger.ts flag `huLimpDefendsToPrice` (tag HuDefence).

## Receipts

hu_limp_defends_to_price (server/src/engine/HorseDataLedger.ts): counted only for a call that is still the final decision, where the heads-up small blind that limped and faced one raise called a hand its bars folded because its realised equity against the raiser range covered the price.

## Tests

- server/src/engine/HorseHeadsUpOpenerAndLimperDefendToPrice.law.test.ts (docs/laws.d/server-src-engine-HorseHeadsUpOpenerAndLimperDefendToPrice.md): widen-only fold to call, price thinning as raise size grows (109 call min-raise, 38 to 2.5bb, 21 to 3bb, 3 to 4bb, 0 above 6bb at 40bb), scope guards, receipt equals changed final decisions, explicit false identical to unset, single `=== true` read.
- server/src/engine/HorseOptionSwitchPreflopHoldLift.test.ts: still off-only beside the huBbDefendsUnreadToPrice lift (docs/changelog/2026-11-20-heads-up-big-blind-hold-lifted-by-name.md).
- server/src/benchmark/ADefaultOffFlagHasALeagueCard.law.test.ts and server/src/benchmark/HorseLeagueHumanField.test.ts: active league card `human_hu_limp_defends_vs_minraise_40bb` diverges.

## Evidence rows

Rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md. Nothing was run for this file; every number below is copied from the record named beside it.

- Mechanism, scope, receipt, tests: recorded (docs/changelog/2026-11-14-heads-up-opener-and-limper-defend-to-price.md and the tests above).
- Value: NOT MET.
  - Declared 12-cell evaluation (`evaluation/RESULTS-HU-DEFENCE.md`, run on `2017e96d`, 96 jobs, 0 failed): PASS under the non-harm rule, but inert in 10 of 12 cells; only the min-raise persona cells moved (`+2.07 +/- 1.68` bb/100 at 25bb and `+3.51 +/- 2.50` bb/100 at 40bb, neither significant) (docs/changelog/2026-11-14-heads-up-opener-and-limper-defend-to-price.md).
  - Nightly league card `human_hu_limp_defends_vs_minraise_40bb` on 2026-11-15: `+4.66 +/- 5.47` bb/100 (not significant); divergence probe (`b262fd3e0`, seed 4242, 1,500 pairs): `+28.90 +/- 16.66` bb/100 (209 divergent, 0 illegal actions) (docs/changelog/2026-11-15-heads-up-opener-defence-card-faces-a-realistic-three-bettor.md).
  - Stated limits: `HU_BB_EQUITY` is read as a linear 20% range with no narrower column and no raise-over-limp opponent read, and the 0.8 realisation share is an assumption rather than a measurement.
- Owner authority: NOT MET. Off-only under the owner preflop range hold; no lift by name exists (`OPTION_SWITCH_PREFLOP_HOLD_LIFTED` does not list it).
- Replay on real audited decisions: NOT MET (see Replay).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (off-only under the owner preflop range hold; no audited-decision replay was scored, and any replay must use the corrected history of #11556, which removed forced posts from replayed preflop actionHistory)

## Rollback

If enabled, run `horse-option-switch.mjs set huLimpDefendsToPrice off --rollback` (`fn_ca_horse_option_switch_set('huLimpDefendsToPrice', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
