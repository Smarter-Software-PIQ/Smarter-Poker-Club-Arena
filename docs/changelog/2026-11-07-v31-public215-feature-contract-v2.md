# V31 Public215 Feature Contract v2 (2026-11-07)

**Why.** R8's 100 cash cells use ROOT ranges, positions (UTG, HJ, CO) and the facing bucket `mid` that feature contract v1 (`holdem-public-hist215-v1`, 215 features, descriptor `0ca054f9...`) cannot represent. v1 encodes such a category as all-zero, so it is refused.

**What.** A new contract `holdem-public-hist215-v2` keeps every v1 feature at its index with its meaning and APPENDS 31 sorted one-hots (indices 215..245): the 24 distinct ROOT range checksums of R8 range bundle `7de4856b` (11 `iprange=`, 13 `ooprange=`), `hero_position` and `opponent_position` UTG/HJ/CO, and `facing_size_bucket=mid`. 246 features, descriptor `c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4` (`GtoPublicHist215FeatureDescriptorV2.json`, `predecessor_schema_sha256` = v1).

- The engine selects the contract from the dataset's declared `feature_contract_version` (live consult) or the model's `feature_schema_sha256` (model width); it never infers one from a template. v1 stays the default.
- `encodePublic215Features` returns `public215ContractVector(v1Features, template)`: the v1 vector unchanged for v1, the v1 vector plus the appended block for v2.
- Feature-request, input-draft and model-index scripts pin and carry the contract version; the Linux preflight selects the closed 12-file graph for v2.
- Migration `20261107224538_v31_public215_feature_contract_v2` admits v2 wherever the database admits v1 (14 md5-pinned function patches, a v2 template validator, 7 md5-pinned constraint supersets, in-transaction self-test). The SQL audit encoder is deliberately unchanged: its definitions are hashed into R7's sealed encoding identity. A v2 dataset needs a v2 SQL encoding chain before its cell-build stage; registration and capture do not use it.

**v1 is byte-identical (proof).** R7's 107 sealed cells (`fn_gto_v31_evaluation_cells`) were loaded into the live store and replayed over a fixed set of 4,280 public states (40 per cell; 593 cell hits) on this branch and on `origin/main` `25711e49`: store checksum `afad6a66...`, advice digest `307478ee62e4a785ecd4bd0eb1e9a2ed8e39cce4cf571a9c03bc5784478e7680`, feature digest `90de61897450c32ce00ee5fa16d9f68f50f7368bf537f05cfd5bfa78f1c8ffe7` on both. The production dry run (BEGIN ... ROLLBACK) passed the self-test against all 107 live v1 cells and left `model_valid` timing unchanged.

**Certification note.** The serving engine must contain this commit before R8 (contract v2) can be evaluated.
