# A registered V31 cell declares its range provenance, and the data must agree

2026-11-12. At least 61 of the 100 cells of dataset R8 were solved with the
pipeline model `conditional_history` ("authored_range_preserving_response"):
every earlier bet, check and call is forced and both players keep their full
authored root ranges at the target node, although in real play those earlier
decisions narrow the ranges. Nothing recorded or checked that assumption. The
database had no field for it, the cell key names only a node role, and no gate
tests it, so the round passed every check up to its seal. R8 stays rejected
and is not touched by this change.

Migration `20261112185251` extends the round registration of `20261110213931`
with `cell_provenance`: one entry per registered cell.

| field                     | content                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `range_construction`      | `root`, `natural` or `subgame`. `forced` and anything else is refused.                                                                                                                      |
| `public_history`          | the exact ordered public actions before the node (street, position, solver seat, family, target chips) and, per step, how many actions the betting tree offered there (`available_actions`) |
| `upstream_solve_checksum` | for a `subgame`, the solve whose natural ranges are its inputs; `null` otherwise                                                                                                            |
| `game`                    | variant `nlh`, two players to the flop, pot type, depth bucket, chips per big blind, effective stack, root pot, rake `[fraction, cap]`, betting-tree checksum                               |
| `runtime_mapping`         | the cell key the engine may serve it for, and the acting solver seat                                                                                                                        |

Four checks bind it. None of them trusts the declaration.

1. **Registration** (`gto_v31_round_registration_provenance`). Missing,
   malformed, unknown or `forced` provenance is refused. `root` is refused when
   any earlier step had more than one available action. A bet, call, raise or
   all-in can never be declared a one-action step. `natural` and `subgame` may
   follow any history: a correctly built subgame is not refused because its
   history contains decisions.
2. **Dataset insert** (`gto_v31_dataset_matches_range_provenance`). The
   declared betting tree must be the dataset's manifest checksum.
3. **Source ingest** (`gto_v31_source_artifact_records_range_evidence`, on
   `gto_v31_source_artifacts`, which both ingest functions write after the
   `solved_spots_gold` row). Each source node of a registered cell must have
   been solved after exactly the declared public history, with the declared
   rake, tree, stack, root pot and acting seat, and must carry exact node
   ranges (policy export v4). Each player's range is compared with the same
   player's range on the cell's first source board; the result is kept in
   `gto_v31_range_evidence`.
4. **Seal** (`gto_v31_seal_matches_range_provenance`). For `natural` and
   `subgame`, a player who made a real earlier decision must not hold a
   constant rescale of one range on every source board. That pattern is the
   forced-line signature the pipeline's own `validate_conditional_support`
   enforces, and it is what R8 was. For `root`, both players must hold it. A
   cell needs two source boards to be verifiable, every ingested node must have
   its evidence, and a refusal consumes no held-out set.

The comparison is between source boards, not against a declared root vector. A
forced line leaves `range(board) = c(board) x root` on every board, so any two
boards agree up to a constant wherever neither board blocks the hand. A
declared vector could be wrong; the boards cannot.

## What does not change

No quality threshold, seal metric or gate. No existing dataset, registration
or source row is modified, relabelled or re-validated: R6, R7 (evaluating) and
R8 (rejected) keep their rows and states, and the migration asserts that it
wrote no provenance and no evidence for them. A dataset without a registration
could already not be sealed; a registration without provenance can no longer
be created.

## What is deliberately left to its owner

- **Engine loader.** RANGE-DESIGN.md section 3 names a third enforcement
  point: the engine loader refusing a cell whose `range_construction` is absent
  or `forced`. It is not in this change (`server/**` is under another owner's
  release custody). It needs `range_construction` and the tree line in the
  cell payload the engine loads.
- **Which checks are step-level tree facts.** `available_actions` is declared
  by the round writer from the manifest's betting tree; SQL cannot read the
  tree. A check declared as a one-action step where the tree offered a bet is
  caught at the seal when the solve was natural (the range is narrowed, so
  `root` is refused). It is the World Hub pipeline that refuses to prepare a
  registration from a forced-line scenario.
- **The density pre-flight** (`server/src/scripts/gtoV31DensityPreflight.ts`)
  still emits the registration block of 2026-11-10, without `cell_provenance`.
  That block is no longer registrable as it stands; the round writer adds the
  provenance from the manifest.

Native proof: `scripts/ci/test-v31-range-provenance.py --mutations`
(workflow `v31-range-provenance.yml`).
