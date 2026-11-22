# 2026-11-21: a node replay keeps the receipts the ledger gives the option under test

## What was wrong

`server/scripts/audited-node-option-replay.ts` kept a replayed arm's receipt keys only when a hand-kept pattern matched them (`priced`, `value_share`, `multiway`, `plo6_facing`, `holdem_`, `^hu_`). `omahaHiLoTournamentFirstIn` fires `omaha_hilo_tournament_first_in`, which no part of the pattern matched, so its replay rows carried no receipt and the scorer's per-receipt split (src/benchmark/AuditedDecisionReplay.ts) read "(no receipt)" for every changed decision. Any option whose receipt key falls outside those prefixes had the same gap, and a receipt-only difference between arms was invisible to the changed-row count.

## The fix

`server/src/benchmark/ReplayArmReceipts.ts` (new): an option's receipts are read from `HORSE_DATA_LEDGER`, every receipt entry whose consumer names the option in its parentheses (for example `HorsePreflop (omahaHiLoTournamentFirstIn)`), `prefix_*` family entries included. The replay keeps, on every arm, the receipts of every option an arm turns on, plus the earlier families so rows already scored with them score the same. An arm option the ledger names no receipt for is printed as a note, never guessed.

The script now filters through `replayReceiptKeep(...)`; the inline pattern is gone.

## Tests

`server/src/benchmark/ReplayArmReceipts.test.ts`: the earlier pattern misses `omaha_hilo_tournament_first_in` and the new filter keeps it for `omahaHiLoTournamentFirstIn`; the earlier families stay kept; consumer parsing; a family entry and an unattributed option; and the script uses the filter, not a hand-kept pattern (fails on the old script).

## Delivery

Touches `server/scripts/`, so it waits for the current owner-window cutover to seal before merging (no auto-merge armed).
