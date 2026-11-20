# omahaTurnStabLightningRow: authority for the live switch

Owner order of 2026-11-19 6:44 PM America/Chicago (AUDIT-48: every Horse decision against persons in the past 48 hours, every mistake found and fixed) and owner order of 2026-11-17 11:49 America/Chicago (no blanket rules). Evidence NOT MET: the option stays OFF.

## What it does

Only with `omahaTurnStabDefenceIsPriced` and `omahaPricedInLightning` both on, inside `omahaFacingBetEv` (HorseLogic.omahaFacingBetEvCount), in the Lightning pools only: when a PERSON makes the first wager of the turn after a checked-through flop, heads-up, PLO4/PLO5 cash (the line of HorseOmahaTurnStabDefence.omahaTurnStabLine), the spot's non-value prior is read from the Lightning-measured row (HorseOmahaTurnStabDefence.OMAHA_TURN_STAB_PERSON_BLUFF_LIGHTNING: 0.536 / 0.740 / 0.532 / 0.532 at the under-40 / 40-70 / 70-110 / over-110 percent centres) instead of the pooled row (0.532 / 0.626 / 0.336 / 0.336). The value region, price, rake, realization, margin and the bettor's own read are the facing-bet EV's own.

What it does NOT do: table play, Horse or unknown bettors, raises, multiway pots, tournaments, PLO6, the river and every other line are untouched; it makes no bet and no raise. Off or unset, or with either of the two options it needs off: byte-identical (tested). On live only by an option-switch row whose note cites this file and its sha256. Rollback: switch row off (about 30 s).

## The finding it answers

AUDIT-48 turn lane (archive woowoo-48h-audit-01BNteGYgf/repairs/AUDIT48/TURN.md; criteria declared and hashed before grading in TURN-CRITERIA.md): over 2026-11-18 00:44Z to 2026-11-20 00:49Z the Horses folded 77 times to a person's turn stab after a checked-through flop in PLO5 Lightning; against the persons' real cards the call was worth +0.25 pot per fold on average (bootstrap 95% +0.07 to +0.44), about +795 bb in all. Every journaled one of those folds carries `omaha_facing_bet_ev_fold`; the pooled row of omahaTurnStabDefenceIsPriced flips 1 of the 20 priced folds in the replay.

## Constants

Re-fit 2026-11-20 (EMERG lane MODE-READ): OMAHA_TURN_STAB_PERSON_BLUFF_LIGHTNING is now [0.156, 0.428, 0.385, 0.385], provenance population_all_cards_capped, shrunk toward the re-fitted pooled row; top player share after the cap .08 / .20 / .20 (before: .08 / .30 / .51; the old .532 big row was one bettor's). Offline 5-week grade in Lightning, rows fitted to Nov 14: fit n 0 changes, holdout +16.8 +/- 12.9 bb (n 2): INSUFFICIENT. Archive repairs/EMERG/MODE-READ.md.

Same method and data as OMAHA_TURN_STAB_PERSON_BLUFF (every player's cards from the hand facts, no showdown selection; q makes the predicted win share from the engine's omahaEvHandCounts equal the Horse's share against the bettor's real cards), PLO4/PLO5, 2026-11-05 22:00Z to 2026-11-19 22:00Z, split by pool: Lightning under 40: 0.539 +/- 0.209 (n 11); 40-70: 0.800 +/- 0.162 (n 15); 70-110: 0.566 +/- 0.114 (n 47); table for comparison 0.465 (n 8), 0.556 (n 21), 0.334 +/- 0.071 (n 69). Each Lightning row shrunk with 8 pseudo-bets toward the pooled row. Fit-window-only Lightning (before 2026-11-18): 0.413 +/- 0.138 at 70-110 (n 30); held-out Lightning 70-110 0.82 (n 17): the Lightning stab range widened over the window.

## Receipts

`omaha_turn_stab_lightning_row_seen` (HorseDataLedger.ts), beside the `omaha_turn_stab_defence_*` receipts.

## Tests

HorseOmahaTurnStabLightningRow.test.ts: the row is the stated measurement shrunk as stated; in the Lightning line the spot differs only in its prior and reads the Lightning row; with the row off the pooled row; with Lightning closed the very same spot; at the table identical either way; decisions at the table byte-identical with the row on; without the stab option byte-identical in Lightning; in the Lightning line the receipt fires and no hand the pooled row continues with becomes a fold.

## League

The league seats no person and deals no Lightning: refused matchup `plo5_omaha_turn_stab_lightning_row` (HorseLeague.ts UNMEASURABLE_MATCHUPS).

## Replay

- Replay: NOT RUN (no scorer run on audited decisions; the held-out verdict replay below is INSUFFICIENT)

- Journaled production decisions (TURN-STAB held-out journal, 2026-11-18 13:34Z to 2026-11-19 01:18Z, 564 Lightning turn decisions, this branch's working tree, one process): 27 priced in the line, row receipt on all 27; against the pooled arm 3 changed, all fold -> call, all inside the line with the receipt; against the Lightning-only arm 4 changed (fold -> call); 0 errors. Judged against the persons' real cards the 4 flips gain +1.09, +0.43, +0.80, +0.04 pot (+117 bb). These hands lie inside the constants' window: in-sample, not a value verdict.
- Held-out verdict replay (declared archive repairs/AUDIT48/TURN-LTROW-EVAL-DECLARATION.md before the run; results TURN-LTROW-EVAL-RESULTS.md): 26 Lightning stabs of 2026-11-19 00:00Z to 2026-11-20 00:49Z, 15 Horse folds (10 measure positive vs real cards). This row: 8 fold -> call, 0 call -> fold, flips +0.461 pot (bootstrap 95% +0.037 to +0.896); 4 of the 10 positive folds become calls, 5 of 5 negative folds stay folds. INSUFFICIENT (fewer than 10 flips). A refit on 2026-11-18 alone ([0.421, 0.633, 0.513, 0.513]) flipped 5 and was not adopted.
- Value: NOT MET (INSUFFICIENT). Needs a larger held-out window of Lightning stabs.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests, byte-identical off: MET (above).
- Value: NOT MET until a held-out evaluation passes. Do not switch on without its PASS.
