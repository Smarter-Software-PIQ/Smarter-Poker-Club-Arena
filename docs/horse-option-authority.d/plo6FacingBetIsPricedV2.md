# plo6FacingBetIsPricedV2: authority for the live switch

Status: built, OFF, Evidence NOT MET (2026-11-22, default OFF in source, read `=== true`, no switch row; registered in `HorseDataLedger.ts`, `HorseOptionSwitch.ts` owner `PLO6`, states `off / shadow / on_shadow / on`, Turn 5 list migration pending). Full declared 400-session F6 / 100-session M6 evaluation PASSED (`WIN` on both cells, `0/0/0/0` safety across `500,000` hands: F6 `+5.430 +/- 1.512 bb/100`, `z = +3.59`, `1,358` div; M6 `+3.197 +/- 0.873 bb/100`, `z = +3.66`, `3,947` div; `+20.94 bb/100` turnaround over V1 `-15.510 +/- 2.655`, `z = -5.84`), alongside pre-registration HVH48 Auditor C 3-seed confirmation (`32/27`, `31/27`, `31/26`, `+1,979.5 bb` true-card EV); stays `Evidence NOT MET` and OFF solely pending post-registration `audited-decision-replay.ts --row` scorer rows right after Turn 5 merges. **Do not write an `on` switch row until the post-registration `--row` replay rows are recorded and switch-on eligibility is declared.** Nothing in this file switches anything on its own.

## What it does

Six-card native facing-bet pricing model (`server/src/engine/HorsePlo6FacingBetPricedV2.ts`) for PLO6 cash (table and Lightning; never tournaments, bomb pots, All-In-Or-Fold, hi-lo or multi-board), addressing the V1 (`plo6FacingBetIsPriced`) failure modes that produced `-15.510 +/- 2.655 bb/100` (`z = -5.84`) on F6:

- Fixes six-card `valueShare` blowup, low-SPR all-in jam bucketing, and six-card bluff priors natively on six-card holdings.
- Preserves paired-board fold discipline while upgrading `fold -> call` across streets when `evCall > margin`.
- Restricts `call -> fold` to the river (never folding standing flop/turn calls).
- Receipt validator (`server/src/engine/horseDecision/responseValidation.ts`, `plo6FacingBetIsPricedV2GateCandidates` wired through `server/src/engine/horseDecision/client.ts`) admits V2 transitions strictly under the decision's own `plo6FacingBetIsPricedV2` gate and registered switch config.

Default OFF in source (read `=== true`). Off (unset, `false`, or non-boolean truthy): every decision is byte-identical to the base brain (`HorsePlo6FacingBetPricedV2.test.ts`).

## Pre-registration confirmation (2026-11-21)

- **HVH48 Auditor C PLO6 3-seed confirmation (`11,558` decisions):** `32/27` (seed 1), `31/27` (seed 7), `31/26` (seed 42), **`+1,979.5 bb`** true-card EV vs OFF.
- **40k-pair F6 human-calibrated PLO6 field:** `-0.93 +/- 4.18 bb/100` (`z = -0.22`, vs V1 `-15.51 +/- 2.66 bb/100`, `z = -5.84`).
- **30k-pair M6 Horse mirror:** `+1.64 +/- 1.19 bb/100` (`z = +1.38`).
- **Declared 3-seed `plo6_facing_bet_is_priced_v2` mirror card (`2026-11-22`, seeds `20261120, 20261121, 20261122`, `6,000` pairs/seed = `18,000` pairs / `36,000` hands):** `+2.54 +/- 3.19`, `+4.87 +/- 3.01`, `+3.16 +/- 2.82`, **pooled `+3.52 +/- 1.74 bb/100`, `z = +2.03` SIGNIFICANT**, `1,624` divergent pairs, `0/0/0/0` safety (illegal/truncated/error/inert), bit-for-bit identical on both clean baseline and live 67-row prod switch `prod-switch-20261122T0336Z.json`.
- **3-seed F6 human-calibrated PLO6 field on live 67-row prod switch (`2026-11-22`, `HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID`, `hybridBaseline: true`, `moodClock: 'deal_seed'`, seeds `20261120, 20261121, 20261122`, `6,000` pairs/seed = `18,000` pairs / `36,000` hands, `prod-switch-20261122T0336Z.json`):** `+1.64 +/- 9.99` (`z = +0.16`, `39` div), `+0.15 +/- 8.01` (`z = +0.02`, `36` div), `-3.95 +/- 8.73` (`z = -0.45`, `42` div), **pooled `-0.72 +/- 5.17 bb/100` (`blockSE = 5.29`, `z = -0.14`, dead-flat zero harm)**, `117` divergent pairs (`0.65%`), `0/0/0/0` safety (illegal/truncated/corrected/brainFallback).
- **Pending for `Evidence MET`:** post-registration `audited-decision-replay.ts --row` scorer rows on HVH48 Auditor C right after Turn 5 merges (the full declared 400-session F6 / 100-session M6 evaluation below is now COMPLETE and PASSED).

## Declared 400-session F6 + 100-session M6 evaluation (2026-11-22): VALID PASS / WIN

Run strictly single-threaded (`EQUITY_GOVERNOR=off nice -n 19`, 1 worker / sequential) on clean detached checkout `2f91bd88aa733def12e902832c66918d067af292` against the live 67-row production switch snapshot (`prod-switch-20261122T0336Z.json`, 7 style keys + 60 plain keys, `0` sanitized; arm B = base, arm A = base + `plo6FacingBetIsPricedV2: true`; solver stores empty; zero hole cards written; launched `2026-11-22T05:16:57.104Z`, finished `2026-11-22T06:34:53.270Z`, `77.8` min total).

| Cell                                                                                                                       | Sessions | Pairs (hands)     | Mean A - B (bb/100) | Session SE (`z`)    | Pooled pair SE (`z`) | Pooled block SE (`z`) | Divergent pairs | Safety (`ill/trc/cor/fb`) | Wall     |
| -------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- | ------------------- | ------------------- | -------------------- | --------------------- | --------------- | ------------------------- | -------- |
| F6 (`HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID`, `hybridBaseline`, `moodClock: deal_seed`, seeds `mix32(6370000..6370399)`) | 400/400  | 200,000 (400,000) | +5.430              | 1.512 (`z = +3.59`) | 1.604 (`z = +3.39`)  | 1.604 (`z = +3.39`)   | 1,358           | 0 / 0 / 0 / 0             | 39.0 min |
| M6 (Horse mirror `productionStyles: true`, seeds `mix32(6375000..6375099)`)                                                | 100/100  | 50,000 (100,000)  | +3.197              | 0.873 (`z = +3.66`) | 0.938 (`z = +3.41`)  | 0.980 (`z = +3.26`)   | 3,947           | 0 / 0 / 0 / 0             | 38.8 min |

- **F6 shape:** arm A `+52.21` vs arm B `+46.78 bb/100`, `200` positive / `184` negative / `16` inert sessions, Q1 `-12.29`, median `+0.02`, Q3 `+22.91`, `+8.00 bb` gained per divergent pair (`+20.94 bb/100` turnaround over V1 `-15.510 +/- 2.655 bb/100`, `z = -5.84`).
- **M6 shape:** `59` positive / `41` negative / `0` inert sessions, Q1 `-3.03`, median `+2.67`, Q3 `+9.55`.
- **Archive:** `/Volumes/SmarterArchives/agent-evidence/extreme-archive/antigravity-coordinator-20261121/plo6-v2-declared-400f6-100m6/`
  - `DECLARATION.sha256`:
    - `DECLARATION-PLO6-FACING-BET-IS-PRICED-V2.md`: `e0e171d49df0fd558c1cd9e6610ff113661c0d04a4daacff32d35779933ada16`
    - `eval_plo6_v2_field.ts`: `92dc0fcd2fd138d31b6cd56760431a6f8295073769f35e43cb23cd0072e1e631`
  - `RESULT.sha256`:
    - `RESULT.json`: `fe7a95da8fbbf7e65813a4ef998b4f61e9f7f504d71a51dbcab6ae2578220c88`
    - `arms.json`: `6f23c02beed19417c9bfa3668af4adf738ba3432dedf1dbcdb00be3122c8e63c`
    - `rows/field-plo6-v2.jsonl`: `c52c86d9acb84aa017fbca44154181bc72574f17b37f6532ee6546b8050c782b`
    - `rows/mirror-plo6-v2.jsonl`: `ea0fb4022579d087d08567a90ea8f2cafde193a7da3292c7d814c7bdc7faa438`

## Activation and rollback

- Default OFF in source (`opts.plo6FacingBetIsPricedV2 === true`); no switch row is written by this file or its migration.
- Instant rollback without redeploy: calling `fn_ca_horse_option_switch_set('plo6FacingBetIsPricedV2', 'off', ...)` restores the base brain byte-for-byte across all live workers within ~30s (one switch poll cycle).

## League card

`plo6_facing_bet_is_priced_v2` in `server/src/benchmark/HorseLeague.ts` (PLO6, 6 seats, 6,000 pairs, `productionStyles: true`, arm A `{ plo6FacingBetIsPricedV2: true }`, arm B `{}`).

## Tests

- `server/src/engine/HorsePlo6FacingBetPricedV2.test.ts`: six-card native pricing invariants, river-only `call -> fold`, off byte-identity, receipt validator admission, and registered live switch gate-candidate tests (`plo6FacingBetIsPricedV2GateCandidates`).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (pre-registration HVH48 Auditor C 3-seed confirmation 32/27, 31/27, 31/26, +1,979.5 bb true-card EV ran prior to switch registration; post-registration server/scripts/audited-decision-replay.ts --row run is pending before any Evidence MET claim)
