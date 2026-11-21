# v72DefenceByOpener: authority for the live switch

Programme option V72 (2026-10-31, #9041, merge `1a1e26fbaa`), default ON in source (`OPTION_SWITCH_RELEASE_DEFAULT_ON`), read as `opts.v72DefenceByOpener === false` stands aside (server/src/engine/HorseLogic.ts). It is not in `OPTION_SWITCH_OFF_ONLY` and is not an owner preflop range hold entry: it shipped on before that hold, and is registered with states `off`, `shadow`, `on_shadow`, `on` (release default `on`). Unlike the other files in this directory it describes an option that is on unless a switch row turns it off. Evidence NOT MET for this file's replay bar: the league evidence it shipped on is recorded below (mirror positive, human field not significant), but no replay on real audited decisions has been scored, and the replay history it would be scored on was corrected after it shipped (#11556). Missing: scorer-written Replay rows on the corrected history; a significant human-field result.

## What it does

Code: server/src/engine/HorseGtoDefenceRanges.ts, consulted from server/src/engine/HorseLogic.ts and server/src/engine/HorsePreflop.ts.

Hold'em facing exactly one open with nobody calling, no limper, hero not yet in, two-card no-limit hold'em (not pot or fixed limit, not short deck, not All-In-Or-Fold, not straddled), three or more dealt in, opener not all in, open up to 6bb: the call and 3-bet base is set per defender (big blind, small blind, in-position seat) and opener seat by dealt-in players behind (the V70 index, SB 1 to nine-handed UTG 8) instead of five position buckets. The continue range reads a reference order blended between late- and early-open charts mapped onto the preflop score scale; value 3-bets use the legacy ladder; bluff 3-bets come from a reference chart scaled to half the bluff width (`V72_BLUFF_TRIM = 0.5`). Widths by opener seat (cash big blind vs BTN 60, CO 49, HJ 42, LJ 36, nine-handed UTG 29; big-blind ante vs BTN 72 down to UTG 44), scaled gently by open size. Style, ICM premium, depth, exploit reads, V53 and V57/V60 flat and re-steal volume move it as before; the V60 and non-steal V57 per-bucket 3-bet bars are superseded. Explicit `false` is the old five-bucket defence, byte for byte. Two-handed tables return before it (the heads-up options above it in this directory exist for that reason).

## Receipts

v72_defend_vs_opener (server/src/engine/HorseDataLedger.ts): Hold'em facing one open with nobody in, defended on the (defender, opener seat) reference base.

## Tests

- server/src/engine/HorseDefenceByOpener.test.ts.

## Evidence rows

Rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md. Nothing was run for this file; every number below is copied from the record named beside it.

- Mechanism, scope, receipt, tests: recorded (docs/changelog/2026-10-31-v72-defence-by-opener-position.md; docs/HANDOFF-2026-11-01-horse-preflop-and-engine-release.md item B3: "League: no card below -2 stderr").
- Value: paired deals, 6,000 pairs, a = on, b = off. Mirror (seed 2026103172): nlh 100bb `+4.02 +/- 2.43`, 40bb `+3.18 +/- 1.49`, 200bb `+2.25 +/- 3.76`, mtt 40bb `+0.83 +/- 1.24`, mtt 25bb `-0.18 +/- 0.76`. Human field, mean of four seeds: nlh 100bb `-1.98 +/- 3.60`, 40bb `+1.29 +/- 1.96`, 200bb `-5.94 +/- 5.50`, mtt 40bb `+2.14 +/- 1.73`, mtt 25bb `-1.41 +/- 1.11`. No card below -2 stderr in the shipped configuration; no human-field card is significant either way (docs/changelog/2026-10-31-v72-defence-by-opener-position.md). The league's tournament context has no ante, so the big-blind-ante widths are pinned by the audit and tests only.
- Replay on real audited decisions: NOT MET (see Replay). docs/changelog/2026-11-20-a-replayed-hand-has-no-forced-posts-in-its-history.md names this option among those whose replay evidence must be re-run on the corrected history.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (default ON in source since 2026-10-31 on its league cards; no audited-decision replay was scored, and #11556 lists it among the preflop options whose replay must be run on the corrected history without forced posts)
