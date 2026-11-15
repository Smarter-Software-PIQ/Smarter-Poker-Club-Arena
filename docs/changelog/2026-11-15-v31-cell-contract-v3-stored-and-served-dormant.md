# V31 Cell Contract v3: Stored, Read, Served, Built And Sealed, All Dormant (FLOP-5 D6)

## What Changed

- Database (migration 20261115143957): `gto_v31_runtime_cells` gains nullable `cell_contract_version` and `line_class`. A v3 row may use depth 200 and the role `donk` (open node), must carry a line valid for its street, and may not declare `holdem-public-hist215-v1` or `-v2`. The unique key now includes the contract and the line (NULLS NOT DISTINCT, same constraint name), so two lines of one spot are two cells; for every v2 row the key is unchanged. Both new columns are immutable.
- The v2 readers `fn_gto_v31_active_cells` and `fn_gto_v31_evaluation_cells` never return a v3 cell; for every existing row they answer byte for byte as before. New readers `fn_gto_v31_active_cells_v3` and `fn_gto_v31_evaluation_cells_v3` return the same rows plus the two columns. New `fn_gto_v31_registration_cell_contract(dataset_key)` tells the World Hub solver gateway whether a round registration declares cell contract v3. All service_role only.
- Engine: new switch `GTO_V31_CELL_CONTRACT_V3_SERVING` (environment, exactly `on`; default OFF; not a fleet option). With it on, the loader reads the v3 readers, and `HorseV31CertifiedPolicy` consults a store that declares cell contract v3 through `classifyGtoDecisionContextV3` and `gtoStreetAdviceV31V3` (line class, donk, 200 bb). With it off, or with any v2 store, nothing changes.

## Why

Cell contract v3 (#10710) could be registered but not stored or served: the table had no line column and refused depth 200, and the live consult only spoke v2, so a v3 dataset would have missed every decision with `no_line_class`.

## Built, Sealed And Storable (Migration 20261115162745, Same Day)

The three layers that still spoke v2 only now learn v3, each reached only by an input that declares it:

- `holdem-public-hist215-v3` model cells are storable: the dataset, input bundle and runtime cell feature-contract and representation constraints admit it, a hist215-v3 runtime cell must be a cell contract v3 cell, and every validator and dispatcher of the public215 path knows it (feature identity, request, key, hand and compact matrices, schema, schema-of, model width 248, template, cell model, bundle, bundle checksum). The SQL encoding chain gains a v3 branch: `fn_gto_v31_public215_v3_appended` (the overbet bucket and the donk role, indices 246..247), `fn_gto_v31_public215_features_v3` (v2's 246 unchanged, then the two), and the audit chain generated from the installed v2 chain under its own identity `fn_gto_v31_public215_encoding_implementation_v3` (27 functions). The sealed v1 and v2 identities are asserted unchanged.
- The cell builders write v3 cells, only when asked: `fn_gto_v31_build_cell` sends a context that declares `cell_contract` to the generated siblings `fn_gto_v31_build_cell_matrix_v3` and `fn_gto_v31_public215_build_cell_v3`, which take a whole v3 cell of the dataset's declared coverage, use only source nodes of that cell's line, and write `cell_contract_version` and `line_class`. A v3 cell's key and payload checksums bind its contract and line (`fn_gto_v31_cell_contract_identity`, empty for every other cell), so two lines of one spot are two keys.
- The seal compares v3 cells with the registration: `fn_gto_v31_runtime_cell_context` returns a v3 cell's contract and line, so both seal triggers and both seal steps compare the built v3 cell with the registered one; range evidence keys a v3 source node by its v3 cell.

Every function changed in place returns, for every input without `cell_contract`, a line or hist215-v3, what it returned before (exact-count anchors on the installed text, md5 pins before and after, ACLs unchanged, an in-transaction re-derivation of every existing cell's key and seal context).

## Not Yet Built

- 200 bb v3 sources: `gto_v31_source_artifacts.stack_depth` still admits 10..150, and real 200 bb ranges are an external dependency. A v3 cell at 10..150 can be built.
- The public215 v3 build was proven through its routing and refusals only; a full hist215-v3 build needs a real v3 input bundle and physics, which no round has yet.
- The replay digest does not record the switch; a v3 replay corpus needs it before any v3 certification.
- The v3 depth ceiling is still the v2 one (`beyondGtoDepthCeiling`, V33 default OFF).

## Proof

- `scripts/ci/test-v31-runtime-cells-v3.py --mutations` (workflow `v31-runtime-cells-v3.yml`, PostgreSQL 17, production shapes): v2 readers identical before and after, v3 storage and refusals, registration answers, preimage pin, 10 of 10 mutations detected.
- `scripts/ci/test-v31-cell-contract-v3-build-seal.py --mutations` (same workflow, a second step): migration 20261115162745 on top of 20261115143957 on full production shapes (ten relations, 146 live functions byte for byte), every v2 answer compared with a database that has only the first migration, the v3 storage, encoding, build and seal scenarios, and mutation checks.
- `server/src/engine/GtoV31CellContractV3Serving.test.ts`, `server/src/services/GtoPostflopV31LoaderCellContractV3.test.ts`, `server/src/engine/GtoPublicHist215TemplateCellContractV3.test.ts` (a hist215-v3 template is authored over the 15-key v3 cell; v1 and v2 templates keep the 13-key shape).
