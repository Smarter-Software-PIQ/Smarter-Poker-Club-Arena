# V31 Database Reads Pio Bet Tokens As Totals Since The Root (2026-11-07)

## Problem

PioSOLVER 3.8 names a wager `bN` by the acting player's total chips committed since the root (the flop), across streets. Confirmed on the approved Pio 3.8.0 binary on M1: a 250-chip turn bet after a 250-chip flop call is `r:0:c:b250:c:7d:c:b500` and `show_node` reports spent 250 / 500. World Hub PR #2705 corrected the Python exporter. The database's own V31 derivations still read the token as a street amount: `fn_gto_v31_node_line_proof`, `fn_gto_v31_complete_public_state`, and the facing-target equality in `fn_gto_v31_source_node_v3_fields_valid`. So any source node with a wager after earlier-street money derived the wrong street target, pot, facing bucket and public state, and ingest refused or mis-derived it. A cumulative turn or river jam was refused as exceeding the stack.

## Change

- Migration `20261107210122_v31_db_reads_pio_bet_tokens_as_root_totals`: an exact-count textual patch of the three live definitions, each pinned by its production md5 preimage and its reviewed postimage md5. Street target = N minus the actor's earlier-street spend (`spent - contribution`), the same rule as `pio_upi.py`. The v3 validator requires `facing_target_chips = N - (effective_stack - facing_actor_total_chips)`. The live ACLs (`postgres`, `service_role`), IMMUTABLE and SECURITY INVOKER are restated and asserted. An in-transaction self-test covers the Pio-verified line, a cumulative jam, a bucket change, a refused non-advancing total, single-street controls, the v3 validator and the complete public state.
- Paths with no wager after earlier-street money are unchanged.

## Stored rows

Production was checked read-only and dry-run inside BEGIN/ROLLBACK on 2026-11-07. Every stored node of R7 (6,955) and R6 (382) re-derives a byte-identical line proof and complete public state under the new reading: none has a wager after earlier-street money, because the old reading refused those nodes. 715 R7 rows do carry later-street bet children whose `size_value` the old exporter computed from the cumulative token (for example, the turn barrel `b500` was recorded as 0.50 pot where Pio solved 0.25). The database does not recompute child pot fractions, so this change neither detects nor rewrites them. R7 is closed, and R8 comes from the corrected exporter.

## Proof

- `scripts/ci/test-v31-pio-bet-totals.py --mutations` (PostgreSQL 17, byte-exact production preimages in `scripts/ci/fixtures/v31-pio-bet-totals`): fails before the migration and passes after it. The derived state matches an independent simulation of a tree of legal Pio lines across three stack/pot configurations. Control nodes stay byte-identical. The migration refuses a replay and a drifted preimage. 7/7 mutations are killed. Workflow `.github/workflows/v31-pio-bet-totals.yml`.
- Production dry run (BEGIN/ROLLBACK): the self-test passed, the postimage md5s matched, 0 of 7,337 stored nodes changed, and the functions were unchanged after the rollback.
