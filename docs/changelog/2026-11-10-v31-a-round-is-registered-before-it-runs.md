# A V31 round is registered before it runs, and its composition is enforced

2026-11-10. Dan approved R8 on 2026-11-06 with a density pre-flight of
100 cells: 70 flop, 23 turn, 7 river. The dataset that was solved, trained and
sealed had 0 flop, 67 turn and 33 river cells. The change happened when the
plan was frozen on 2026-11-07: 58 of the 76 flop contexts could not supply the
57 training boards and 8 holdout candidates the board recipe needs, and the
cells were re-selected without the approval being revisited. The approval
existed only as a sentence in `gto_v31_program_state.evidence`, so no check
could compare anything with it. The first check that noticed was the v3
breadth rule at the final seal call, after every solver hour had been spent.

Three changes close that gap.

1. **Registration** (migration 20261110213931). `gto_v31_round_registrations`
   holds one row per round, written before the round's dataset exists: the
   owner's authorization (who, when, source, quote), the candidate (summary,
   changes, diagnosis), the exact cell list, its street composition and
   cell-set checksum, the dataset provenance (plan, board-capacity census,
   pipeline commit, board recipe, ranges), the acceptance criteria and a
   bounded evaluation plan that consumes the held-out set once. The quality
   gates may be tightened, never loosened. A registration is immutable; only
   its dataset link and held-out consumption are stamped, once each.
2. **Dataset insert and seal** (same migration). A dataset is refused unless
   its `dataset_key` is registered, unused, and its declared cells are exactly
   the registered cells (one substituted cell of the same street is enough to
   refuse it) with the registered gates. At the seal, the runtime cells
   actually built must again be the registered cells; a match stamps
   `heldout_consumed_at`, a mismatch consumes nothing, and a sealed dataset
   cannot be sealed again. Errors name both compositions.
3. **Plan and training.** The density pre-flight report now carries the
   registration block (composition, the 13-key cells, the cell-set checksum)
   and marks a plan made without a board-capacity census as not registrable.
   The World Hub trainer (`final_public215_training.py --registration`) checks
   the manifest against the registration before any partition, label or fit.

The cell-set checksum is the same bytes in SQL (`fn_gto_v31_cell_set_checksum`),
Python (`public_hist215.digest` of the canonically ordered cells) and
TypeScript (`gtoV31PlanRegistrationBlock`), fixed by one shared vector
(70a3e422...) computed against the live database function.

Proof: `scripts/ci/test-v31-round-registration.py --mutations` (throwaway
PostgreSQL 17; the R8 deviation, a substitution, a missing cell, wrong gates,
an unregistered dataset, a second dataset, a mismatched seal, a second seal and
an unregistered seal are each refused; seven weakened copies of the migration
are each detected). R8 itself is untouched: it was created before this
migration and stays rejected.
