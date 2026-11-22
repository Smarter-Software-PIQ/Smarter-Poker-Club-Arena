# Hold'em post-#11556 replays, 3-seed tournament all-in league run, and river full-house switch reconciliation

Docs only. Updates three Hold'em authority files under `docs/horse-option-authority.d/` after re-running replays on the corrected post-#11556 replay history (no forced posts in `actionHistory`) and #11622 receipt attribution at checkout `09986930d3db` (scorer `5302af2ab3e`, base switch `prod-switch-20261121T1500Z.json`), running the declared 3-seed paired league card for `holdemTournamentAllInCallIsPriced`, and reconciling `holdemRiverFullHouseValueIsPriced` against its live production switch row.

## Scorer Replay rows (copied unedited)

`holdemTournamentAllInCallIsPriced` (`HVH48-D` cash: `0` of `2734` rows differed, inert):

- Replay: fixed 86; newlyWrong 83; changed 302; unchanged 5054; unjudged 112; set HVH48-E Hold'em tournaments vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937

`holdemValueAndCallsArePriced` (`HVH48-E` tournaments: `0` of `5356` rows differed, inert):

- Replay: fixed 47; newlyWrong 44; changed 188; unchanged 2546; unjudged 96; set HVH48-D Hold'em cash vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2734 of 3891

`holdemRiverFullHouseValueIsPriced` (`2` of `2734` rows differed: `2` resizes, `0` action changes):

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2734; unjudged 0; set HVH48-D Hold'em cash vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2734 of 3891

## League run: `mtt6_holdem_tournament_all_in_call_is_priced_12bb`

Single-threaded (`EQUITY_GOVERNOR=off`, solver stores empty, mirror field, 6,000 pairs per seed, engine `09986930d3db5e08817a3d5183fc1eb707df3536`):

- Seed `20261121`: `+3.93 +/- 0.89 bb/100` (block stderr `0.71`, `z = 4.42`, SIGNIFICANT, `539` divergent pairs, `0` illegal)
- Seed `20261122`: `+2.63 +/- 0.89 bb/100` (block stderr `0.91`, `z = 2.95`, SIGNIFICANT, `574` divergent pairs, `0` illegal)
- Seed `20261123`: `+2.65 +/- 0.86 bb/100` (block stderr `0.93`, `z = 3.07`, SIGNIFICANT, `568` divergent pairs, `0` illegal)
- Pooled (3 seeds, 18,000 pairs / 36,000 hands): `+3.07 +/- 0.51 bb/100`, `z = 6.03`, SIGNIFICANT.

## Key findings

1. `holdemTournamentAllInCallIsPriced` remains `Evidence NOT MET` (default OFF): although its 3-seed mirror league card is `+3.07 +/- 0.51 bb/100` (`z = 6.03`) and #11556 improved HVH48-E base fidelity (`4381 -> 4420`) and trimmed spurious changes (`367 -> 302`), it still fails the REPLAY-6 2:1 bar (`fixed 86 < 2 x 83`). Receipt attribution (#11622) isolates the cause: the call receipt (`holdem_tournament_all_in_call_priced_call_seen`) is `84` fixed / `39` newly wrong (`fold -> call`: `84` fixed / `8` newly wrong), whereas the fold receipt (`holdem_tournament_all_in_call_priced_fold_seen`) is `2` fixed / `44` newly wrong.
2. `holdemValueAndCallsArePriced` remains `Evidence NOT MET` (default OFF): #11556 raised HVH48-D base fidelity (`2139 -> 2214`) while leaving the verdict unchanged (`fixed 47`, `newlyWrong 44`, `changed 188`; fails the 2:1 bar; `holdem_priced_call` is `2` fixed / `19` newly wrong).
3. `holdemRiverFullHouseValueIsPriced` is reconciled from stale "no switch row" wording to reflect its live `on` switch row since `2026-11-21 01:19Z` (`prod-switch-20261121T1500Z.json` and `horse-decisions-01UxDLnM/HANDOFF-2026-11-21.md:94`), while honestly keeping `Evidence NOT MET` because no standalone VERIFIER evidence file, league run, or scored `RIVER-FULL-HOUSE-REPLAY-20261115` run exists in the repository or `COORDINATION-INBOX.md`.

## Privacy

All scratch replay files containing Horse hole cards were deleted immediately after scoring.
