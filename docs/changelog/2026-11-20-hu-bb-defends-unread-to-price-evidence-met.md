# huBbDefendsUnreadToPrice: Evidence MET and real-hand Replay rows (2026-11-20)

Documents only. No option, no migration, no code, no switch row. No database was written.

## What changed

`docs/horse-option-authority.d/huBbDefendsUnreadToPrice.md` records the verified declared-evaluation, paired-league, and real-hand audited-decision Replay evidence for `huBbDefendsUnreadToPrice` (Heads Up option HU-NLH-001d, hold lifted by name in PR #11538 `5c58d3c12a927989ba9384319f445fac303e3e4b`) and moves its status paragraph from `Evidence NOT MET` to `Evidence MET`:

1. **Declared evaluation (`HU-NLH-001d`)**: `DECLARATION-HU-NLH-001d.md` (`sha256: 62a0d3f56ed99c5f6ad906dae732cd00c707ec8b73e3e4da86a349504853a443`, pre-run witness `DECLARATION-HU-NLH-001d.sha256` `sha256: e85f74842c5617178110c8582fcac99bce2a827e701752535b1d5da4602613bc`) and `RESULTS-HU-NLH-001d.md` (`sha256: 3cbf1bae94c83496a77b3f0505698eaba5347f8c9e09af5647316e11694811b7`): cash no-read human field `+2.58 +/- 0.26 bb/100` (36,000 hands, 0 illegal actions), two-left non-satellite tournament `+7.44 +/- 0.79 bb/100` (12,000 hands), cash read-learning-on `+0.21 +/- 0.24 bb/100`, Horse mirror `-0.08 +/- 0.29 bb/100`, and 80bb out-of-scope `0.00 +/- 0.00 bb/100`.
2. **Paired league (`human_hu_bb_defends_unread_vs_minraise_40bb`)**: production `horse_league_results` row `9233` (`2026-11-17`, `+15.28 +/- 3.38 bb/100`, 24,000 hands, 0 illegal) beside the two 2026-11-20 runs (`+16.48 +/- 3.71` and `+17.95 +/- 3.76 bb/100`).
3. **Real-hand audited-decision Replay (`HU30D` and `HU14D`)**: re-decided on merged `main` (`#11556` `f90f60b7c9b0` voluntary-only `HorseComplaintReplay.stateAt` + `#11563` `d6b032d3204` `--placed` scorer and `audited-node-option-replay.ts`), audited by Auditor E's unmodified `analyze.mjs`, and scored with `--placed --line on --row on`:
   - `HU30D` (3,390 hands, 106 two-player human NLH tournaments, 2,576 Horse decisions): `fixed 0; newlyWrong 0; changed 14; unchanged 2562; unjudged 14; scorer d6b032d3204; replayed 2576 of 2576` (`hu_bb_defends_unread_to_price` 14 changed / 0 fixed / 0 newly wrong; 0 illegal, 0 refused, 0 errors; 14/14 priced `best = call` by Auditor E saving `+1.36 bb` across the 9 recorded folds and restoring the `OK` call on the remaining 5 nodes).
   - `HU14D` (2,298 hands, 58 two-player human NLH tournaments, 998 Horse decisions): `fixed 0; newlyWrong 0; changed 2; unchanged 996; unjudged 2; scorer d6b032d3204; replayed 998 of 998` (`hu_bb_defends_unread_to_price` 2 changed / 0 fixed / 0 newly wrong; 0 illegal, 0 refused, 0 errors).

## Activation boundary

This document change switches nothing on. Production switch-on runs separately through `fn_ca_horse_option_switch_record_evidence` and `fn_ca_horse_option_switch_set` once merged on `main`.
