# Preflop default-ON options: real-hand audited Replay rows

Docs only. `nashCallVsJam` and `v72DefenceByOpener` (both default ON in source, previously `Replay: NOT RUN` in `docs/horse-option-authority.d/`) now carry scorer-written Replay rows on real human-vs-Horse audited Hold'em hands using the corrected replay history (#11556, no forced posts in `actionHistory`) and ledger-attributed receipt keeping (#11622) at checkout `dce4d6d6a44`, scorer `5302af2ab3e`.

## What was measured

- Audit sets:
  - `HVH48-D` Hold'em cash vs people 48h (`decisions.csv` sha256 `0e36700096a0906d07a5e1ecd0829c35f1ad6abe423f16543103541899c521f0`): `3891` audited decisions, `3891` placed, `2734` replayable (own Horse cards known) in `394` hands.
  - `HVH48-E` Hold'em tournaments vs people 48h (`decisions.csv` sha256 `b3e7f1ac105268462fb8c5e30d8f58c1ba6261256dd445f61249a035531144b3`): `10937` audited decisions, `10937` placed, `5356` replayable in `1478` hands.
  - `HU30D` Hold'em 2-player tournaments 30d (`nodes_30d/E.nodes.jsonl`): `2576` audited decisions, all `2576` placed and replayed (scored for `nashCallVsJam` only; `v72DefenceByOpener` returns before two-handed tables).
- Switch baseline: the `66`-row archived production switch baseline (`switch-20261120T2115Z-plus3.json`) plus an explicit `"off"` row for the option under test so `off` passes `<option>: false` and `--arms on=<option>` passes `<option>: true`, keeping all other default-ON options at release default `on`. Seeds `1,7,42`, opponent memory OFF (`mind: false`), `0` arm errors across all runs.

## Scorer Replay rows (copied unedited)

`nashCallVsJam`:

- Replay: fixed 1; newlyWrong 1; changed 194; unchanged 5162; unjudged 192; set HVH48-E Hold'em tournaments vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937
- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2575; unjudged 1; set HU30D Hold'em 2-player tournaments 30d; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2576 of 2576

(`HVH48-D` cash: `0` of `2734` rows differed for `nashCallVsJam`; inert on cash because there were no <=20bb lone open-jams.)

`v72DefenceByOpener`:

- Replay: fixed 0; newlyWrong 0; changed 219; unchanged 2515; unjudged 219; set HVH48-D Hold'em cash vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2734 of 3891
- Replay: fixed 0; newlyWrong 54; changed 132; unchanged 5224; unjudged 78; set HVH48-E Hold'em tournaments vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937

## Summary and flags

| Option               | Set                    | Canonical (`on vs off`)                            | Reverse (`off vs on`, vs live ON)                                   | Status                                                                                                               |
| -------------------- | ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `nashCallVsJam`      | `HVH48-E` tournaments  | `changed 194, fixed 1, newlyWrong 1, unjudged 192` | `changed 194, fixed 1, newlyWrong 175, unjudged 17`                 | `Evidence NOT MET` (human-field card missing; replay bar met at equality, reverse strongly supports ON)              |
| `nashCallVsJam`      | `HU30D` HU tournaments | `changed 1, fixed 0, newlyWrong 0, unjudged 1`     | `changed 1, fixed 0, newlyWrong 1, unjudged 0`                      | `Evidence NOT MET`                                                                                                   |
| `v72DefenceByOpener` | `HVH48-D` cash         | `changed 219, fixed 0, newlyWrong 0, unjudged 219` | `changed 219, fixed 54, newlyWrong 53, still wrong 15, unjudged 97` | `Evidence NOT MET` (reverse shows 54 CLEAR/LIKELY loose-call mistakes fixed when OFF, mostly with VPIP floor active) |
| `v72DefenceByOpener` | `HVH48-E` tournaments  | `changed 132, fixed 0, newlyWrong 54, unjudged 78` | `changed 132, fixed 0, newlyWrong 48, unjudged 84`                  | `Evidence NOT MET` (FAILS replay bar: `newlyWrong 54 > fixed 0`)                                                     |

Two findings flagged for coordinator follow-up:

1. `v72DefenceByOpener` fails the replay bar on `HVH48-E` (`newlyWrong 54 > fixed 0` in `on vs off`; `newlyWrong 48 > fixed 0` in `off vs on`), and on `HVH48-D` cash its live-baseline reverse check (`off vs on`) fixes `54` Auditor-D `CLEAR`/`LIKELY` loose-call mistakes (heavily overlapping `[vpip floor active]`) plus `15` `still wrong` loose calls against `53` `OK` decisions changed.
2. `HorseDataLedger.ts` registers `v72_defend_vs_opener` with source `'HorsePreflop (V72)'` rather than naming `(v72DefenceByOpener)`, so `ReplayArmReceipts.ts` (#11622) drops `v72_defend_vs_opener` during node replay and the scorer prints `(no receipt)` for `v72DefenceByOpener`.

## Privacy and limits

The scratch replay files containing Horse hole cards were deleted after scoring. The switch baseline is the archived `2026-11-20T21:15Z` + 3 rows snapshot (no database read), opponent memory is off (`mind: false`), and both HVH48 audits are verdict-only (no bb).
