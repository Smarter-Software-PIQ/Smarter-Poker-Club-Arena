# V31 Public215 v2 SQL Encoding Chain (2026-11-08)

**Why.** Feature contract v2 (`holdem-public-hist215-v2`, #9975, migration `20261107224538`) let the engine, the pipeline and the validators carry R8's 246-feature models, but the database's independent audit encoder stayed v1 on purpose: its 13 functions are hashed by `fn_gto_v31_public215_encoding_implementation()` (`1121d3ff...`), R7's sealed encoding identity. A v2 dataset could therefore not build cells, prepare heldout audits or seal.

**What.** Migration `20261108011659_v31_public215_v2_sql_encoding_chain` adds a NEW chain selected by the cell's / dataset's declared `feature_contract_version`; the v1 chain is not edited.

- Pure: `fn_gto_v31_public215_v2_appended(template)` (indices 215..245; same rule and order as `encodePublic215V2Appended`), `fn_gto_v31_public215_features_v2` = v1 `features` || v2 block (246), `fn_gto_v31_public215_compiled_raw_v2` (246-wide inference).
- Chain: `audit_key_v2`, `prepare_audit_v2`, `audit_prediction_v2`, `required_audit_v2` (v1 texts, version-guarded), `encoding_implementation_v2()` = digest of the v1 13 plus the 7 v2 functions.
- Dispatch: `encoding_for(version)`, `audit_key_for`, `prepare_audit_for`, `audit_prediction_for`, `required_audit_for` (v2 to the v2 chain, anything else to exactly the v1 function).
- Callers patched md5-pinned to dispatch: prepare_model, prepare_seal_cell, assert_prepared_seal, build_cell, dataset_models_valid, frozen_map, build_receipt, prepare_public_physics, heldout_metrics, cell_metric_raw, seal_cell_binding, horse_solver_agreement_v31_public215_decision. Seal/heldout census literals (107 contexts, 6,955 / 6,099 / 856 sources) now come from the dataset's declared coverage (65/57/8 per context); identical for R7.
- `gto_v31_public_model_audit_combos_features_check` admits 215 or 246.

**Proof.**

- TS/SQL parity: `scripts/ci/test-v31-public215-v2-sql-parity.py` (PG17, byte-exact production v1 closure, `--mutations`): `features_v2` equals Club Arena's v2 `encodePublic215Features` bit for bit on 320 fixed R8 states (120 seeded over 20 contexts + the 200 build-receipt cases of all 100 contexts; masses from production `prepare_math`). The same comparison ran on production inside rolled-back transactions.
- v1 unchanged: the migration asserts `encoding_implementation()` = `1121d3ff...` before and after; the self-test recomputes live R7 audited vectors through `features_v2` (first 215 equal the stored v1 audit features, v2 block zero) and checks every v1 dispatcher returns the v1 result. Production dry run (BEGIN ... ROLLBACK) passed.
