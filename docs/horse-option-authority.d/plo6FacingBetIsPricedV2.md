# plo6FacingBetIsPricedV2: authority for the live switch

Status: built, OFF, Evidence NOT MET (2026-11-21, default OFF in source, read `=== true`, no switch row; registered in `HorseDataLedger.ts`, `HorseOptionSwitch.ts` owner `PLO6`, states `off / shadow / on_shadow / on`, Turn 4 follow-up list migration pending). Pre-registration confirmation cleared its 40k-pair F6 human-calibrated PLO6 field (`-0.93 +/- 4.18 bb/100`, `z = -0.22`, vs V1 `-15.51 +/- 2.66`, `z = -5.84`), 30k-pair M6 Horse mirror (`+1.64 +/- 1.19 bb/100`, `z = +1.38`), and HVH48 Auditor C 3-seed confirmation (`32/27`, `31/27`, `31/26`, `+1,979.5 bb` true-card EV); stays `Evidence NOT MET` and OFF pending the full declared 400-session F6 / 100-session M6 evaluation and post-registration `audited-decision-replay.ts --row` run. **Do not write an `on` switch row until the full declared evaluation and post-registration `--row` replay pass.** Nothing in this file switches anything on its own.

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
- **Pending for `Evidence MET`:** full declared 400-session F6 / 100-session M6 evaluation (`> +2 SE` gain without harm) plus post-registration `audited-decision-replay.ts --row` scorer rows.

## League card

`plo6_facing_bet_is_priced_v2` in `server/src/benchmark/HorseLeague.ts` (PLO6, 6 seats, 6,000 pairs, `productionStyles: true`, arm A `{ plo6FacingBetIsPricedV2: true }`, arm B `{}`).

## Tests

- `server/src/engine/HorsePlo6FacingBetPricedV2.test.ts`: six-card native pricing invariants, river-only `call -> fold`, off byte-identity, receipt validator admission, and registered live switch gate-candidate tests (`plo6FacingBetIsPricedV2GateCandidates`).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (pre-registration HVH48 Auditor C 3-seed confirmation 32/27, 31/27, 31/26, +1,979.5 bb true-card EV ran prior to switch registration; post-registration server/scripts/audited-decision-replay.ts --row run is pending before any Evidence MET claim)
