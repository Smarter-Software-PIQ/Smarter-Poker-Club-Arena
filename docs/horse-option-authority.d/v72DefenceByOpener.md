# v72DefenceByOpener: authority for the live switch

Programme option V72 (2026-10-31, #9041, merge `1a1e26fbaa`), default ON in source (`OPTION_SWITCH_RELEASE_DEFAULT_ON`), read as `opts.v72DefenceByOpener === false` stands aside (server/src/engine/HorseLogic.ts). It is not in `OPTION_SWITCH_OFF_ONLY` and is not an owner preflop range hold entry: it shipped on before that hold, and is registered with states `off`, `shadow`, `on_shadow`, `on` (release default `on`). Unlike the other files in this directory it describes an option that is on unless a switch row turns it off. Evidence NOT MET: the league evidence it shipped on is recorded below (mirror positive, human field not significant), and real-hand audited decision replays on the corrected history (#11556 + #11622) were scored on 2026-11-21 (`HVH48-D` cash: `fixed 0`, `newlyWrong 0`, `changed 219`, `unjudged 219`; `HVH48-E` tournaments: `fixed 0`, `newlyWrong 54`, `changed 132`, `unjudged 78`). `HVH48-E` fails the replay bar (`newlyWrong 54 > fixed 0`), and on `HVH48-D` cash the reverse live-baseline check (`off vs on`) shows turning `v72DefenceByOpener` off fixes `54` Auditor-D `CLEAR`/`LIKELY` loose-call mistakes (mostly with VPIP floor active) against `53` `OK` decisions changed. Missing: a passing replay (`newlyWrong <= fixed` on all sets) and a significant human-field result.

## What it does

Code: server/src/engine/HorseGtoDefenceRanges.ts, consulted from server/src/engine/HorseLogic.ts and server/src/engine/HorsePreflop.ts.

Hold'em facing exactly one open with nobody calling, no limper, hero not yet in, two-card no-limit hold'em (not pot or fixed limit, not short deck, not All-In-Or-Fold, not straddled), three or more dealt in, opener not all in, open up to 6bb: the call and 3-bet base is set per defender (big blind, small blind, in-position seat) and opener seat by dealt-in players behind (the V70 index, SB 1 to nine-handed UTG 8) instead of five position buckets. The continue range reads a reference order blended between late- and early-open charts mapped onto the preflop score scale; value 3-bets use the legacy ladder; bluff 3-bets come from a reference chart scaled to half the bluff width (`V72_BLUFF_TRIM = 0.5`). Widths by opener seat (cash big blind vs BTN 60, CO 49, HJ 42, LJ 36, nine-handed UTG 29; big-blind ante vs BTN 72 down to UTG 44), scaled gently by open size. Style, ICM premium, depth, exploit reads, V53 and V57/V60 flat and re-steal volume move it as before; the V60 and non-steal V57 per-bucket 3-bet bars are superseded. Explicit `false` is the old five-bucket defence, byte for byte. Two-handed tables return before it (the heads-up options above it in this directory exist for that reason).

## Receipts

v72_defend_vs_opener (server/src/engine/HorseDataLedger.ts, consumer `'HorsePreflop (V72, v72DefenceByOpener)'` as of PR #11684 / `756498773cc9`): Hold'em facing one open with nobody in, defended on the (defender, opener seat) reference base.

## Tests

- server/src/engine/HorseDefenceByOpener.test.ts.

## Evidence rows

Rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md. League rows below are copied from the record named beside them; Replay rows were measured on 2026-11-21 on the corrected history (#11556 + #11622).

- Mechanism, scope, receipt, tests: recorded (docs/changelog/2026-10-31-v72-defence-by-opener-position.md; docs/HANDOFF-2026-11-01-horse-preflop-and-engine-release.md item B3: "League: no card below -2 stderr").
- Value: paired deals, 6,000 pairs, a = on, b = off. Mirror (seed 2026103172): nlh 100bb `+4.02 +/- 2.43`, 40bb `+3.18 +/- 1.49`, 200bb `+2.25 +/- 3.76`, mtt 40bb `+0.83 +/- 1.24`, mtt 25bb `-0.18 +/- 0.76`. Human field, mean of four seeds: nlh 100bb `-1.98 +/- 3.60`, 40bb `+1.29 +/- 1.96`, 200bb `-5.94 +/- 5.50`, mtt 40bb `+2.14 +/- 1.73`, mtt 25bb `-1.41 +/- 1.11`. No card below -2 stderr in the shipped configuration; no human-field card is significant either way (docs/changelog/2026-10-31-v72-defence-by-opener-position.md). The league's tournament context has no ante, so the big-blind-ante widths are pinned by the audit and tests only.
- Replay on real audited decisions (2026-11-21, corrected history without forced posts #11556): NOT MET. `HVH48-D` cash gives `fixed 0`, `newlyWrong 0`, `changed 219`, `unjudged 219` (`on vs off`), while `HVH48-E` tournaments fails the bar with `fixed 0`, `newlyWrong 54`, `changed 132`, `unjudged 78` (`newlyWrong 54 > fixed 0`). See Replay for the reverse (`off vs on`) live-baseline breakdown on both sets.

## Replay

Machine-read (README.md, "The Replay row"); each run row is written by the scorer (`--row on`) and copied unedited.

- Replay: fixed 0; newlyWrong 0; changed 219; unchanged 2515; unjudged 219; set HVH48-D Hold'em cash vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2734 of 3891
- Replay: fixed 0; newlyWrong 54; changed 132; unchanged 5224; unjudged 78; set HVH48-E Hold'em tournaments vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937

Unedited scorer lines (`server/scripts/audited-decision-replay.ts --placed ... --line on --row on`):

- `HVH48-D`: `placed (verdict-only; 3891 audited decisions, 372 judged bad; joined by node: 2734 replayed, 1157 not replayed, base reproduces the recorded action on 2030): arm on changed 219 (219 more aggressive, 0 more passive), resized 11, illegal 0, refused 0, errors 0; fixed 0, newly wrong 0, still wrong 0, ok to ok 0, unjudged 219; judged bad left unchanged 157; no bb (the audit declares no EV model); per receipt: (no receipt) 219 changed / 0 fixed / 0 newly wrong.`
- `HVH48-E`: `placed (verdict-only; 10937 audited decisions, 244 judged bad; joined by node: 5356 replayed, 5581 not replayed, base reproduces the recorded action on 4434): arm on changed 132 (85 more aggressive, 47 more passive), resized 3, illegal 0, refused 0, errors 0; fixed 0, newly wrong 54, still wrong 0, ok to ok 0, unjudged 78; judged bad left unchanged 185; no bb (the audit declares no EV model); per receipt: (no receipt) 132 changed / 0 fixed / 54 newly wrong.`

Why `(no receipt)` appears above: at checkout `dce4d6d6a44`, `HorseDataLedger.ts` registered `v72_defend_vs_opener` with source `'HorsePreflop (V72)'` rather than naming `(v72DefenceByOpener)`, so `ReplayArmReceipts.ts` (#11622) reported `note: the ledger names no receipt for v72DefenceByOpener; its rows keep only the receipt families`. Fixed in PR #11684 (`756498773cc9`): `HorseDataLedger.ts` now attributes `v72_defend_vs_opener` to `'HorsePreflop (V72, v72DefenceByOpener)'` (pinned by regression test in `server/src/benchmark/ReplayArmReceipts.test.ts`), so future replays attribute `v72DefenceByOpener` decisions to `v72_defend_vs_opener` instead of `(no receipt)`. Recorded replay numbers and `Evidence NOT MET` status remain unchanged.

Default-ON direction check (reverse `--base on --line off`, measuring what switching `v72DefenceByOpener` OFF from the live ON state would do): because `v72DefenceByOpener` was already default ON in production during the audited 48h window, verdict-only scoring only judges nodes where the base arm matches the recorded action.

- `HVH48-D` cash (`off vs on`, base reproduces recorded `2214` vs `2030` when off): `changed 219 (0 more aggressive, 219 more passive), resized 11, illegal 0, refused 0, errors 0; fixed 54, newly wrong 53, still wrong 15, ok to ok 0, unjudged 97`. On `191` of the `219` changed nodes `on` matched the live recorded action. Turning `v72DefenceByOpener` off fixed `54` Auditor-D `CLEAR`/`LIKELY` mistakes (`33` `CLEAR PF loose cold-call vs open (should fold) [vpip floor active]`, `7` `CLEAR PF loose cold-call vs open (should fold)`, `5` `CLEAR PF loose BB defend vs open (should fold) [vpip floor active]`, `3` `LIKELY PF loose BB defend vs open (should fold)`, plus `6` other `CLEAR`/`LIKELY` loose defends/re-raises) and turned `15` more `CLEAR` loose calls (where Auditor D marked `better = raise`) into folds (`still wrong 15`), while changing `53` `OK` recorded decisions (`33` `raise -> call`, `14` `call -> fold`, `6` `raise -> fold`).
- `HVH48-E` tournaments (`off vs on`, base reproduces recorded `4420` vs `4434` when off): `changed 132 (47 more aggressive, 85 more passive), resized 3, illegal 0, refused 0, errors 0; fixed 0, newly wrong 48, still wrong 0, ok to ok 0, unjudged 84`. In `HVH48-E`, neither direction fixes any `CLEAR`/`LIKELY` decision: `off` matches the recorded action on `71` of the `132` changed nodes (`54` `OK`, `17` `DEBATABLE`; on `33` of those `54` `OK` nodes the `on` arm itself mixes across seeds `1,7,42`), while `on` matches recorded on `57` (`48` `OK`, `9` `DEBATABLE`). Because verdict-only scoring treats any change away from an `OK` recorded action as `newlyWrong`, both `on vs off` (`newlyWrong 54`, `fixed 0`) and `off vs on` (`newlyWrong 48`, `fixed 0`) show heavy `OK`-action churn.

How the rows were produced (2026-11-21, on the operations Mac, checkout `dce4d6d6a44`, run from `server/`; scratch replay files held Horse hole cards and were deleted after scoring):

1. Audit sets: `HVH48-D` (`shared-capacity/hvh48-audit-01TLQer7J/D/decisions.csv`, sha256 `0e36700096a0906d07a5e1ecd0829c35f1ad6abe423f16543103541899c521f0`, `3891` placed, `0` not placed, `2734` replayable in `394` hands) and `HVH48-E` (`shared-capacity/hvh48-audit-01TLQer7J/E/decisions.csv`, sha256 `b3e7f1ac105268462fb8c5e30d8f58c1ba6261256dd445f61249a035531144b3`, `10937` placed, `0` not placed, `5356` replayable in `1478` hands), placed with `python3 server/scripts/hvh48-audit-nodes.py`. Two-player tournament sets (`HU30D`, `HU14D`) were not replayed: V72 requires three or more dealt in and returns before acting heads-up.
2. Switch baseline: the `66`-row archived production switch baseline (`antigravity-coordinator-20261121/holdem-replay-01Gw7aDt/switch-20261120T2115Z-plus3.json`: the `63` production switch rows of `2026-11-20T21:15Z` plus `huBbDefendsUnreadToPrice`, `holdemRiverFullHouseValueIsPriced`, and `omahaRiverCurrentNutsCallFloor`) plus an explicit `{"option": "v72DefenceByOpener", "state": "off"}` row so base arm `off` passes `v72DefenceByOpener: false` while `--arms on=v72DefenceByOpener` passes `v72DefenceByOpener: true` (other default-ON options stay at their release default `on`; `0` rows sanitized, `0` refused).
3. `npx tsx scripts/audited-node-option-replay.ts --job <set>.job.json --switch switch-v72-off.json --arms on=v72DefenceByOpener --out <set>.v72.replay.jsonl` (seeds `1,7,42`, opponent memory OFF `mind: false`; `0` arm errors on both sets).
4. `npx tsx scripts/audited-decision-replay.ts --placed <set>.nodes.jsonl --replay <set>.v72.replay.jsonl --line on --row on --set "<set name>"`, the `- Replay:` rows above copied unedited.

Limits: the database was not read for the switch baseline (uses the archived `2026-11-20T21:15Z` + 3 rows snapshot); opponent memory is off in replay (`mind: false`); the audits are verdict-only (no bb); `1157` `HVH48-D` and `5581` `HVH48-E` decisions have unknown Horse cards and are not replayed.

## Rollback

Set `v72DefenceByOpener` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('v72DefenceByOpener', 'off', '<actor>', '<reason>')`) to override the release default within ~30s; zero data migration needed.
