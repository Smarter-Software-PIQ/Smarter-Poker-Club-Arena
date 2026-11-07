# V31 certification tests the playbook's own tables (evaluation contract v3)

Approved by Dan 2026-11-06 19:13 CST ("R8 option A, new evaluation set,
strict re-check rule, keep the 100,000-hand test"). Applies to datasets
registered after the migration installs; every existing dataset, R7
(187815b1) included, keeps contract v2 and its receipts byte for byte.

## Why

Contract v2 certified a playbook on one fixed table per utility context and
required it to cover every family, street, pot type, utility context, table
size 2-10 and node role before it could seal. R7 therefore spread 107 cells
thinly, and the fixed tables reached 9 of them: its cash cells sat at
ten-handed 80bb (9), heads-up 10bb (8), nine-handed 40bb (9) and heads-up
80bb (1), and the cash certification played exactly one cell. The cash-only
R8 Dan approved could not have sealed at all. And the verdict came from one
learning-on league run, while R7's loss existed only with horse memory
learning on (the exploit-read defect fixed as V83).

## What changes

Migration `20261107024448_v31_evaluation_contract_v3_tests_the_playbooks_own_tables`:

- `gto_v31_datasets.evaluation_contract`: existing rows `gto_v31_candidate.v2`,
  new rows `gto_v31_candidate.v3` (an insert trigger refuses v2), immutable.
- **Scope.** A v3 dataset seals when each family/objective it carries covers
  flop, turn and river; heldout quality is required per family it carries.
  Out-of-scope spots miss and play exactly as with no playbook loaded.
- **Tables from cells** (`fn_gto_v31_v3_tables`, mirrored by
  `server/src/benchmark/GtoV31EvaluationContractV3.ts`): one per distinct
  utility context x table size x depth bucket, named
  `${utility}_${size}max_${depth}bb` in byte order, plus a human-calibrated
  six-max cash table at the deepest six-max cash depth. The evaluator refuses
  to deal a hand unless its list equals the database's
  (`fn_gto_v31_evaluation_plan`).
- **Size.** Each table plays max(10,000, ceil(50,000 / tables)) duplicate
  pairs, so a family keeps at least 100,000 hands and no table is thinned.
- **Floors.** Each table executes at least 300 playbook decisions; zero
  illegal actions, truncations and execution mismatches.
- **Memory off.** Every league table also runs with memory learning off
  (`LeagueMatchup.memoryLearning: 'off'`: the full brain plays, nothing is
  observed) on the same deals; it must meet the same floors and is stored in
  the component. The verdict still comes from the learning-on run.
- **Every cell reached.** Components list the `cell_key_checksum` of each
  sealed cell they executed; every sealed cell of the family must be
  executed by a learning-on table of each kind.
- **Families.** Only families with cells are certified: 2 receipts per
  family, promotion needs 1 + 2 x families, required node roles are the
  dataset's own, and a candidate may not drop a family an active incumbent
  plays. The qualification workflow reads `required_families` from
  `ca_gto_v31_certification_status`.
- Mirror tables play the production Hybrid style (`hybridBaseline`).

Six live functions get a minimal textual patch on their exact live
definition (md5 preimage guard, md5 postimage check, each anchor exactly
once), so their v2 paths are unchanged.

## Measured (offline, R7's 107 sealed cells, 500 pairs per table, paired replay)

The v3 derivation gives R7 19 tables; in 500 pairs per table they executed
26 distinct cells (cash 6, spin 6, tourney_ev 1, tourney_icm 13), against 9
for the v2 tables at 10x the pairs. Several of R7's tables (heads-up 10bb,
five-handed 20bb bubble, six-handed 150bb satellite) executed none, so R7
could not certify under v3: thin, unreachable cells now fail instead of
passing untested.

## Proof

`scripts/ci/test-v31-evaluation-contract-v3.py` (PostgreSQL 17, fixtures are
byte-exact live definitions): the v2 path end to end (eight receipts, mark,
promote), the v3 plan equal to the TypeScript derivation, a complete v3 set
recorded, marked and promoted, 25 single-rule violations refused, the
incumbent-family rule, the scoped breadth, grants unchanged; `--mutations`
detects all 10 weakened copies. Workflow `v31-evaluation-contract-v3.yml`.
TypeScript: `GtoV31EvaluationContractV3.test.ts` (13),
`gto-v31-qualification.test.mjs` (13).
