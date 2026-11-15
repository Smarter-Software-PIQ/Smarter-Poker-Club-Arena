# The final-table deal doors resolve their manager scope; the version-2 place branch refuses without a missing call

**Found by** the function-call guard (`smarter_private.fn_ca_unresolved_function_calls`, 20261115020406). Of the six installed functions in `public`/`smarter_private` with a latent unresolved call, four are fixed here. The other two (`pgmigrate(text)`, `fn_gto_v31_promote_dataset_epoch`) belong to another lane.

## 1. Three deal doors called a scope check that was never installed

`fn_begin_tournament_deal_review` (line 5), `fn_close_tournament_deal_review` (line 4) and `fn_complete_tournament_terminal_proposal` (line 7) open with `PERFORM public.fn_assert_tournament_manager_write_scope(uuid)`. The callers came from `20260910125453_phase_three_versioned_final_deal_expansion.sql`; the callee existed only in `20260910055955_stage_b_current_postimage_contraction.sql.pending` and `supabase/retired-unapplied/20260910002530_...`, neither ever installed. A rolled-back production probe with a manager context raised `42883` at all three doors.

**Reachable today?** No player or operator can reach them yet. Read end to end:

- Client (`src/services/TournamentDealService.ts`): the Deal button first calls `fn_get_tournament_deal_review`; production answers `proposal_authority_not_active`, so the client casts the legacy vote (`fn_cast_tournament_deal_vote(uuid)`, a `tournament_deal_votes` row). `fn_request_tournament_deal_review` returns the same refusal, so no review can be created (0 ever).
- Engine (`server/src/tournament/TournamentManagerEliminations.ts`, `checkFinalTableDeal`): `fn_get_tournament_deal_consensus` answers `proposal_authority_not_active`, so it runs `checkLegacyFinalTableDeal`, which settles through `fn_execute_tournament_terminal_request` kind `legacy_deal` -> `fn_complete_tournament_terminal(..., 'final_table_deal')`. That path never reaches the missing call. `fn_begin_...` runs only after a consensus that returned a review, and `fn_close_...` only when a review is held.
- The authority is inactive because `fn_ca_tournament_deal_proposals_active()` is false: the `require_exact_final_deal_proposal` trigger is not on `tournament_obligations`.

The day it is activated (`scripts/deploy/phase-three-activate-versioned-final-deal.sql`), the engine parks the final table, calls `fn_begin_tournament_deal_review` (42883), then `fn_close_tournament_deal_review` to release the dealer (42883 again), and the parked table cannot resume.

**Why the rehearsal was green.** `scripts/ci/terminal_original_request_native.py` drove a proposal deal through the real doors, but it installed the Stage-B body from the `.pending` file and emulated a request hook that sets `app.smarter_manager_request_fenced = 'protocol-2'`. Production's hook (`smarter_private.fn_smarter_data_api_pre_request`, Stage A) never sets that marker. Installing the Stage-B body verbatim would therefore refuse every manager ("request lease proof is absent"): a second way to break the same doors.

**Fix (20261115052022).** Install `public.fn_assert_tournament_manager_write_scope(uuid)` with the authority production runs. It reads the generation the Stage-A hook admitted (`app.smarter_tournament_lease_generation`) and calls `smarter_private.assert_terminal_request_generation(tournament, generation)`. That is the assertion the working durable terminal door, `fn_execute_tournament_terminal_request`, already uses for places, satellites and legacy deals: actor `tournament-manager`, this tournament, this generation, and the exact fresh, unaborted protocol-2 `engine_tournament_leases` row held `FOR KEY SHARE` until COMMIT. The three callers are not edited. EXECUTE is revoked from PUBLIC, anon, authenticated and service_role. The unfinished Stage-B programme is not installed; its contraction would replace this body together with its own hook.

## 2. Readiness called a version-2 place verifier that exists nowhere

`fn_tournament_finish_readiness` line 169 calls `fn_ca_verify_terminal_place_batch(uuid, boolean)` when a place batch has `contract_version = 2`. Only unapplied `scripts/deploy` phase-three files define it. Nothing can write a version-2 place batch: `tournament_place_settlement_batches` has no `contract_version` column, so `to_jsonb(b)->>'contract_version'` is NULL for all 5,618 rows. No installed function writes one, and the engine never touches the table. The branch was dead and already fail-closed (a caught 42883 produced `canonical_place_batch_not_proven`).

**Fix.** The branch keeps its detection and stays fail-closed under the same code, with the detail `version-2 place batch verifier is not installed`. It no longer calls the missing function, and no verifier is invented. The edit is pinned to preimage md5 `3209cfadeb8a36eccf0f75d7d58cabd9`, and its anchor occurs exactly once (probe: hits=1). The installed text's md5 is `a5b27ec1149c9ae68546cd2c52c27578`. Version-1 text is unchanged outside the block. Readiness for the first 300 finish receipts digested to `4a4e153a22b800768ccd7a1d62c18072` (all ok) before the change, and the same digest is checked after.

## Proof

- Before: rolled-back probe, manager context, three doors -> `42883 function public.fn_assert_tournament_manager_write_scope(uuid) does not exist`.
- Scope logic on production (a pg_temp copy of the exact body, the real delegate and a fixture protocol-2 lease on completed event `f9d25d29-...`, rolled back): exact manager admitted. Other tournament, service actor, missing generation, malformed generation (22023), other generation, stale heartbeat and protocol 1 were each refused.
- Local PG16 dry run of the migration against stub preimages: it applies, the postimage check finds nothing, the door reaches the scope check, and re-applying it refuses on the changed preimage.
- Native CI (`Accounting transactions (PostgreSQL 17)` shard 4, `test-satellite-qualifiers.py`): the LEGACY_DEAL and PROPOSAL_DEAL cases now install the original-request authority, then this migration's scope check. The consent fixture and the HTTP transport no longer set the Stage-B marker, so the proposal deal runs through begin review -> votes -> durable executor -> `fn_complete_tournament_terminal_proposal` under production's hook semantics.
- Law: `tests/the-final-deal-doors-resolve-their-manager-scope.law.test.ts`.
