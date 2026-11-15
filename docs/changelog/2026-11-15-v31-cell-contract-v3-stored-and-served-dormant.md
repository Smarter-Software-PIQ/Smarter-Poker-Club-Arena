# V31 Cell Contract v3: Stored, Read And Served, All Dormant (FLOP-5 D6)

## What Changed

- Database (migration 20261115143957): `gto_v31_runtime_cells` gains nullable `cell_contract_version` and `line_class`. A v3 row may use depth 200 and the role `donk` (open node), must carry a line valid for its street, and may not declare `holdem-public-hist215-v1` or `-v2`. The unique key now includes the contract and the line (NULLS NOT DISTINCT, same constraint name), so two lines of one spot are two cells; for every v2 row the key is unchanged. Both new columns are immutable.
- The v2 readers `fn_gto_v31_active_cells` and `fn_gto_v31_evaluation_cells` never return a v3 cell; for every existing row they answer byte for byte as before. New readers `fn_gto_v31_active_cells_v3` and `fn_gto_v31_evaluation_cells_v3` return the same rows plus the two columns. New `fn_gto_v31_registration_cell_contract(dataset_key)` tells the World Hub solver gateway whether a round registration declares cell contract v3. All service_role only.
- Engine: new switch `GTO_V31_CELL_CONTRACT_V3_SERVING` (environment, exactly `on`; default OFF; not a fleet option). With it on, the loader reads the v3 readers, and `HorseV31CertifiedPolicy` consults a store that declares cell contract v3 through `classifyGtoDecisionContextV3` and `gtoStreetAdviceV31V3` (line class, donk, 200 bb). With it off, or with any v2 store, nothing changes.

## Why

Cell contract v3 (#10710) could be registered but not stored or served: the table had no line column and refused depth 200, and the live consult only spoke v2, so a v3 dataset would have missed every decision with `no_line_class`.

## Not Yet Built

- `holdem-public-hist215-v3` model cells: the feature-contract checks and the SQL public215 encoding chain stay v1/v2, so a v3 cell is a matrix cell until that change exists.
- The cell builders (`fn_gto_v31_build_cell_matrix_v2`, `fn_gto_v31_public215_build_cell`) do not yet write v3 cells from v3 contexts, and the seal does not yet compare v3 cells with their registration.
- The replay digest does not record the switch; a v3 replay corpus needs it before any v3 certification.
- The v3 depth ceiling is still the v2 one (`beyondGtoDepthCeiling`, V33 default OFF).

## Proof

- `scripts/ci/test-v31-runtime-cells-v3.py --mutations` (workflow `v31-runtime-cells-v3.yml`, PostgreSQL 17, production shapes): v2 readers identical before and after, v3 storage and refusals, registration answers, preimage pin, 10 of 10 mutations detected.
- `server/src/engine/GtoV31CellContractV3Serving.test.ts`, `server/src/services/GtoPostflopV31LoaderCellContractV3.test.ts`.
