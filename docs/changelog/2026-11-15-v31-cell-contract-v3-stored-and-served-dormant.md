# V31 Cell Contract v3: Stored, Read, Served, Built, Sealed And Ingested At 200 bb, All Dormant (FLOP-5 D6)

## What Changed

- Database (migration 20261115143957): `gto_v31_runtime_cells` gains nullable `cell_contract_version` and `line_class`. A v3 row may use depth 200 and the role `donk` (open node), must carry a line valid for its street, and may not declare `holdem-public-hist215-v1` or `-v2`. The unique key now includes the contract and the line (NULLS NOT DISTINCT, same constraint name), so two lines of one spot are two cells; for every v2 row the key is unchanged. Both new columns are immutable.
- The v2 readers `fn_gto_v31_active_cells` and `fn_gto_v31_evaluation_cells` never return a v3 cell; for every existing row they answer byte for byte as before. New readers `fn_gto_v31_active_cells_v3` and `fn_gto_v31_evaluation_cells_v3` return the same rows plus the two columns. New `fn_gto_v31_registration_cell_contract(dataset_key)` tells the World Hub solver gateway whether a round registration declares cell contract v3. All service_role only.
- Engine: the v3 serving switch is the registered live option `gtoV31CellContractV3Serving` (off-only today; see Switch In The Live Registry below). With it on, the loader reads the v3 readers, and `HorseV31CertifiedPolicy` consults a store that declares cell contract v3 through `classifyGtoDecisionContextV3` and `gtoStreetAdviceV31V3` (line class, donk, 200 bb). With it off or unset, or with any v2 store, nothing changes.

## Why

Cell contract v3 (#10710) could be registered but not stored or served: the table had no line column and refused depth 200, and the live consult only spoke v2, so a v3 dataset would have missed every decision with `no_line_class`.

## Built, Sealed And Storable (Migration 20261115162745, Same Day)

The three layers that still spoke v2 only now learn v3, each reached only by an input that declares it:

- `holdem-public-hist215-v3` model cells are storable: the dataset, input bundle and runtime cell feature-contract and representation constraints admit it, a hist215-v3 runtime cell must be a cell contract v3 cell, and every validator and dispatcher of the public215 path knows it (feature identity, request, key, hand and compact matrices, schema, schema-of, model width 248, template, cell model, bundle, bundle checksum). The SQL encoding chain gains a v3 branch: `fn_gto_v31_public215_v3_appended` (the overbet bucket and the donk role, indices 246..247), `fn_gto_v31_public215_features_v3` (v2's 246 unchanged, then the two), and the audit chain generated from the installed v2 chain under its own identity `fn_gto_v31_public215_encoding_implementation_v3` (27 functions). The sealed v1 and v2 identities are asserted unchanged.
- The cell builders write v3 cells, only when asked: `fn_gto_v31_build_cell` sends a context that declares `cell_contract` to the generated siblings `fn_gto_v31_build_cell_matrix_v3` and `fn_gto_v31_public215_build_cell_v3`, which take a whole v3 cell of the dataset's declared coverage, use only source nodes of that cell's line, and write `cell_contract_version` and `line_class`. A v3 cell's key and payload checksums bind its contract and line (`fn_gto_v31_cell_contract_identity`, empty for every other cell), so two lines of one spot are two keys.
- The seal compares v3 cells with the registration: `fn_gto_v31_runtime_cell_context` returns a v3 cell's contract and line, so both seal triggers and both seal steps compare the built v3 cell with the registered one; range evidence keys a v3 source node by its v3 cell.

Every function changed in place returns, for every input without `cell_contract`, a line or hist215-v3, what it returned before (exact-count anchors on the installed text, md5 pins before and after, ACLs unchanged, an in-transaction re-derivation of every existing cell's key and seal context).

## Sources Ingested Up To 200 bb (Migration 20261115183033, Same Day)

The builders above take source nodes that carry their v3 cell, but no such node could be ingested: the source-node validators took exactly the 16 v2 node_context keys, depth 10..150 and the v2 roles, and both ingest functions and `gto_v31_source_artifacts` admitted stack depth 10..150 only. Now a dataset whose declared coverage is all cell contract v3 (`fn_gto_v31_cell_contract_of_coverage`, the same rule as the round registration's) ingests v3 sources up to the v3 depth bucket, 200 bb; every other dataset ingests exactly as before:

- `fn_gto_v31_node_line_class_v3` is the SQL port of World Hub `pio_upi.line_class_v3`, and `fn_gto_v31_node_line_proof_v3` names a lead into the previous street's aggressor `donk` (the v2 proof refuses it, as before).
- Generated v3 siblings of the installed source-node chain (scalar types, fields, v3 and v4 node validators, complete public state, the dispatcher and the policy-contract assertion) take the 18-key v3 node context, depth 200 and the donk role, and require the node's `line_class` to be the line its own path proves.
- `fn_gto_v31_ingest_source_artifact_matrix_v2` and `fn_gto_v31_public215_ingest_m2` (in place, md5-pinned) admit a 200 bb artifact and check every node with the v3 chain for a v3 dataset only; for any other dataset they make the same calls as before.
- `gto_v31_source_artifacts_stack_depth_check` admits 200, and the trigger `gto_v31_source_artifacts_v3_depth_guard` (on INSERT and on an UPDATE of the depth or the dataset) refuses a 200 bb row of any other dataset with that check's own error (SQLSTATE 23514, same message, constraint name and Failing row detail).
- Declared coverage now decides v3 ingest, so the trigger `gto_v31_datasets_cell_contract_immutable` keeps it from changing once either side of an UPDATE declares cell contract v3: no dataset becomes, stops being or changes as a v3 dataset after insert. An UPDATE between two v2 coverages is answered as before.
- The World Hub gateway (#2850) admits the v3 worker ingest, the seal operations and the dataset registration for a hist215-v3 dataset only while its round registration says v3 and is linked to it.

Real 200 bb solver ranges do not exist yet (FLOP-4 C2, an external dependency), so the 200 bb path is proven on fixtures only.

## Switch In The Live Registry (Migration 20261115212414, Same Day)

The v3 serving switch was the environment variable `GTO_V31_CELL_CONTRACT_V3_SERVING`: outside the live switch registry (#10999) and the replay digest, and changed only by an engine restart. It is now the registered option `gtoV31CellContractV3Serving`, built in with no separate cutover. The environment variable is retired and nothing reads it (a test sets it to `on` and sees the v2 path); the comment in migration 20261115143957 that still names it is superseded by this section.

- One `HorseDataLedger` flag and one `HorseDecideOpts` field; the decision reads `opts.gtoV31CellContractV3Serving` and serves v3 only when it is exactly `true`.
- Off-only. V31 names fall under the owner hold on the R7/R8 solver rounds (`HELD_PATTERNS` in `HorseOptionSwitch.ts`), which refuses them as options. This one exact name is exempt from that refusal only so that it can be registered off-only under the same hold (`OPTION_SWITCH_OFF_ONLY`, source "owner hold: the V31 solver store (R7/R8) is registration-gated"): the registry offers `off` alone, the set function and the table refuse `on` with any note, `off` and clear work, and the worker never passes it `true`. It can be switched on only after the owner lifts the hold by name in a reviewed source change, and v3 also needs a sealed, promoted and bound v3 dataset. Every other V31, R7 and R8 name stays refused.
- Live: workers pass the option to the decision like every registered option (`optionSwitchDecisionOpts`, read every 30 s, journaled in the replay state), and report it to the V31 loader (`noteGtoV31CellContractV3ServingSwitch`), which reloads at once when the reading changes, so the loader moves between the v2 and v3 readers without a restart.
- Replay: the option is in `V31_REPLAY_OPTS`, so the V31 replay digest records it.
- Migration 20261115212414 is a registry follow-up written by `server/scripts/gen-horse-option-switch-sql.ts --follow-up` (the full lists with one new off-only name; 20261114072215 is not edited). It was generated against main at da0c64e3. Per the registry's sequencing rule it is deleted and regenerated, with a version newer than every list migration then on main, after every earlier flag-adding head has merged (Hold'em #11008 has since merged with 20261115185244; PLO's follow-up is pending).

## Decision And Demand Records Follow The v3 Cell (Same Day)

With the option on and a v3 store, the decision record (`onGtoV31Decision`) takes facing kind and size bucket from the v3 context and carries `cellContract: 'v3'` and `lineClass`; a donk decision is recorded as one (it was skipped before). The demand record (`onV31Demand`) names the v3 cell the consult asked for, with the same two fields, and `gtoV31DemandCell` keys it by the v3 cell (line validated for its street, v3 depth bucket up to 200 bb). With a v2 store, or with the option off or unset, both records are exactly as before and carry neither field. Both hooks feed offline tools only (league, replay, density preflight, solver agreement); the live path writes no such record.

## A v3 Dataset Made Active While v3 Serving Is Off Raises An Alarm (Same Day)

The v2 readers never return a v3 cell, so a v3 dataset made active and bound while the option is off would leave V31 serving empty fleet-wide with no error. Now, when a bound live loader with an admitted active dataset reads no v2 cell and serving v3 is off, it reads one row of the v3 reader; if that row is a cell contract v3 cell of the same dataset it raises `V31_V3_DATASET_ACTIVE_WHILE_V3_SERVING_OFF` (console error and the error reporter, `GtoPostflopV31Loader.cellContract`), once per dataset until a load serves rows again. A v2 row, a read error, an empty answer, another dataset, serving on, or no bound dataset raises nothing. It refuses nothing and changes no answer: the decision still finds no V31 cell, exactly as before. `gtoPostflopV31CellContractV3Alarm()` returns the alarmed dataset for health reads.

## Recorded For Review (Hand Analysis 20:08:54Z And 20:46:19Z)

Open items, not fixed, to be weighed before any v3 activation:

- N-C3: the ban on 200 bb sources for a dataset that is not all-v3 is a trigger (`gto_v31_source_artifacts_v3_depth_guard`) because the depth check itself now admits 200. A privileged session that skips ordinary triggers (`session_replication_role = replica`, or the table owner disabling the trigger) can write a 200 bb source row for a v2 dataset directly. The ingest functions still refuse it for such a dataset, because they check the dataset's coverage themselves.
- D4: the same session can also skip `gto_v31_datasets_cell_contract_immutable` and change a dataset's declared coverage to all-v3; the ingest functions would then accept 200 bb v3 sources for it. So "the ingest functions still refuse" does not hold once coverage itself was changed that way. Read on production at 21:41Z (read only): service_role, authenticated, anon and postgres can not set `session_replication_role` (no SET privilege, not superuser); both tables are owned by postgres, which could disable a trigger.
- D1: the depth guard's "Failing row contains" detail clips a value when it is over 64 bytes, but then keeps its first 64 characters (`left(v, 64)`), where PostgreSQL clips at 64 bytes on a character boundary; the two differ only for a value with multibyte characters.
- D2: the guard prints each value with a `::text` cast, where PostgreSQL prints the type's output function; they differ for some types (boolean prints `true`, not `t`). No column of `gto_v31_source_artifacts` is such a type today, and the proof compares the detail with PostgreSQL's own.
- D3: `fn_gto_v31_cell_contract_of_coverage` says `v3` only when every declared cell is v3, so a dataset whose coverage mixes v2 and v3 cells counts as v2: it gets no 200 bb ingest and its sources are checked by the v2 node rules.
- D5: migration 20261115183033 takes a brief lock on `gto_v31_datasets` to create its trigger, within the 3 s lock timeout; if the table stays busy for 3 s the install fails rather than waits longer.
- Depth error first (20:08:54Z minor): the guard runs before the table's checks, so a 200 bb row of a v2 dataset that also breaks another check reports the depth error first.
- D6 and D7: listed in REVIEW-DELTA-10724d20-e11a7f92.md (sha256 d04a36181894516a), whose text the writer could not read from the Mac; to be added here in the reviewer's words.
- For the custodian (N5, N7): migrations 20261115143957, 20261115162745 and 20261115183033 change the seal qualification fingerprint, and the TypeScript changes all four Horse phase digests and the V31 execution fingerprint, so this head is treated like any decision-file change for qualification and admission records; the in-migration self-tests hold ACCESS EXCLUSIVE locks for seconds.

## Not Yet Built

- Real 200 bb solver sources (FLOP-4 C2). The 200 bb ingest and build path is proven on fixtures only.
- The M2 public215 ingest's blind selection receipt (`fn_gto_v31_public215_selection_receipt`, unchanged) was not exercised with a v3 selection; `fn_gto_v31_public215_ingest_m2` itself was.
- The public215 v3 build was proven through its routing and refusals only; a full hist215-v3 build needs a real v3 input bundle and physics, which no round has yet.
- No v3 replay corpus exists; the replay digest now records the option, and a v3 certification needs such a corpus first.
- The v3 depth ceiling is still the v2 one (`beyondGtoDepthCeiling`, V33 default OFF).

## Proof

- `scripts/ci/test-v31-runtime-cells-v3.py --mutations` (workflow `v31-runtime-cells-v3.yml`, PostgreSQL 17, production shapes): v2 readers identical before and after, v3 storage and refusals, registration answers, preimage pin, 10 of 10 mutations detected.
- `scripts/ci/test-v31-cell-contract-v3-build-seal.py --mutations` (same workflow, a second step): migration 20261115162745 on top of 20261115143957 on full production shapes (ten relations, 146 live functions byte for byte), every v2 answer compared with a database that has only the first migration, the v3 storage, encoding, build and seal scenarios, and mutation checks.
- `scripts/ci/test-v31-cell-contract-v3-ingest.py --mutations` (same workflow, a third step): migration 20261115183033 on top of both, on those shapes plus `scripts/ci/fixtures/v31-cell-contract-v3-ingest`: a v1/v2 ingest corpus through both ingest functions answers and writes byte for byte as before; the SQL line functions equal World Hub `pio_upi` on 1,704 nodes (`01-line-vectors.json`, generated by `make-line-vectors.py` from World Hub's own code at a pinned commit); a v3 dataset ingests 200 bb M1 and M2 artifacts (pio-policy v3 and v4) and builds each v3 cell from them; mutation checks.
- `server/src/engine/GtoV31CellContractV3Serving.test.ts` (registry entry, off-only hold, retired environment variable, decision opts, replay opts, ledger flag, loader reload, v3 decision and demand records), `server/src/services/GtoPostflopV31LoaderCellContractV3.test.ts` (v3 readers, the alarm and its six silent cases), `server/src/engine/GtoPublicHist215TemplateCellContractV3.test.ts` (a hist215-v3 template is authored over the 15-key v3 cell; v1 and v2 templates keep the 13-key shape).
- Default path unchanged: 2,880 decisions on main da0c64e3 and on this head, the same sha256; the registry laws (`everyUpgradeHasALiveSwitch.law.test.ts`, `HorseOptionSwitchMigrationLists.test.ts`, `HorseDataLedger.test.ts`, `ADefaultOffFlagHasALeagueCard.law.test.ts`) and `scripts/ci/test-horse-option-switch-evidence-postgres.sh` (the new name is refused `on` at the set function and the table).
