# Mongo BB display repair

Owner: chat 01a19a02-30fe-7db0-bc70-67f84438ec5d. User authorizes investigation, source fix, hardening and delivery.
Scope: tournament BB display compatibility and connected preference controls; no chip, financial or engine mutations.
Acceptance: reproduce old-engine incompatibility, preserve strict hand-bound validation for modern engine, invalid denominator stays chips, test actual components and canonical chip actions; protected merge, publication and live proof.
Worktree: /Volumes/SmarterWork/agent-work/shared-capacity/mongo-bb-01a19a02/ca
Branch: fix/mongo-bb-display-20261101. Base: 3634e37fa52db1c76de3028470c9328cc3d242f0.

Read canonical policy reader full emitted files (truncated segments reread separately), full root AGENTS/CLAUDE/playbook/PUBLISHING/deploy paths, storage guide and prior preference checkpoint. No nested src/tests instructions found. Canonical policy comparison passed. Policy 2.9 manifest 7c7f308e580f0e2b9170085bb3a454c89ff7234627570c74ab68f5e7846b5b52. Receipt:

- AGENTS.md: `73c17bed0bc531031283fa33c0b45d4546869166beef9d714bcfe76cfcdb9fdb`
- AGENT-OPERATING-LAW.md: `a8bc3c04dce3354ebdd51a89c0b7d715af3344edcc794d33f6b3ad64506961d5`
- AGENT-HARDENING-STANDARD.md: `d5fc451ce5caf6d6b5e64597a13883e1246581678fe53c962339d0a66136993e`
- AGENT-REFERENCE-INDEX.md: `adce89c3f838f2f373cd504a00329d53906404d1dd42a647f672af6c16f95555`

Evidence 2026-11-02 UTC: Mongo saved show_stack_in_bb=true; active tournament seat table 1d979c16-afeb-4f4a-9fed-7bea535dd45d. Public engine version eed06fe5. Client 3634e37 includes d2954bd (#8827); that client requires hand_blinds for tournaments, but serving engine source has no hand_blinds. Existing code returns denominator 0 despite valid metadata, hence effectiveShowStackInBB=false. This proves source/deployment mismatch; no claim of inspecting Mongo's private browser.

Repair: distinguish absent optional contract (undefined, legacy metadata permitted) from rejected supplied contract (null, tournament fail-closed). Valid matching hand contract retains priority. Metadata must be finite and positive. Legacy metadata has the existing limitation of not being a frozen hand snapshot; full hand-bound accuracy requires the already-maintained engine addition to be installed. This client fix does not authorize or require engine restart.
Regression before fix: tests/handBoundBigBlind.test.ts had 5 failures/4 passes. Retained in archive before.log. Focused after result pending. Private locked dependencies installed on SSD. No production writes performed.

A second connected defect was reproduced with two real hook instances: once a control had changed a key, its lifetime touched-key guard rejected subsequent user changes from the other control. The guard now rejects stale database echoes only; newer local gestures synchronize all mounted instances and fence pending hydration. The failing regression was captured before the fix (6 passed, 1 failed).

## Delivery and final validation

Final canonical policy reader reread fully at 2026-11-02T02:18:46.061Z; version 2.9 and all four hashes unchanged from above. Full emitted receipt retained in archive final-policy-read.txt. Current source f19f513bfeaae69bea672f64600eb9577899f8ca, tree 26c472bd48850ec53dd799bbe779ada214e307d6. Exact final TypeScript and Vite build passed. Focused 42 tests passed. Normal pre-push passed 347 changed/source-contract tests plus 1,627 related tests (120 files); source bindings and policy/preflight safeguards passed. Receipt in private Git metadata agent-policy-preflight.json. One pre-commit lint-staged stash-cleanup race failed after formatting; unchanged source was preserved and normal commit succeeded on the next attempt, without bypass.

Configured environment GitHub token lacked PR-create permission; configured keychain identity Smarter-Poker supported PR edit, secret-name metadata read and protected merge. Existing reviewed branch-proposal workflow had already opened PR9254; reused it. No secret values were read or printed. All required exact-head checks passed. Protected squash merge completed 2026-11-02T02:31:03Z, merge ca0544d3dfa934b975cea717c0abfcebc7fec553. Client publisher41378156832 running; no duplicate dispatch.

Live pre-fix evidence: downloaded public compiled parser/display code yields 0 where a legacy tournament with BB50 requires50. A temporary spectator initially tried direct union membership and could not view the table; guarded cleanup verified bb56070e-a565-4250-a324-14f5cc510a31. Correct supported club entry through KINGS CLUB admitted the second temporary account acb30bff-65e9-4188-ad3f-250c7978b6ea. The actual Mongo tournament rendered, its BB control was clicked, and the first visible stack remained19,850 chips for the full20s assertion. No seat or betting action was taken. Guarded cleanup verified. Before fixtures, installed cleanup migration history, all six exact function hashes and owner-only helper permission matched the maintained prerequisite.

Public browser proof after publication remains pending; script prepared with actual isolated account, real settings persistence, reload, no-seat assertion, serving client/engine identity continuity and guarded cleanup. Legacy blind metadata limitation remains explicit; no frozen-hand guarantee claimed on an engine lacking the new contract.

Resumption/final-validation policy read 2026-11-02T02:33:59.288Z: canonical four policies and repository references reread; policy2.9 and hashes unchanged. Full emitted receipt retained as resume-policy-read.txt. Recovered existing publisher41378156832 in progress; no duplicate operation.

## Completed scoped acceptance

Publisher41378156832 terminal SUCCESS. Both required public build-info endpoints independently returned ca0544d3dfa934b975cea717c0abfcebc7fec553, built2026-11-02T02:36:07Z, run41378156832. Actual public TablePage-Pqew2UOe-v6.js passed all9 compiled parser/denomination boundary assertions.
Live browser proof passed2026-11-02T02:38:05.520Z on actual Mongo tournament table: chips to BB, persisted setting true, reload retains BB, back to chips. Actual loaded TablePage asset matched published source. Client and engine identities unchanged throughout; engine eed06fe5. No seat/bet action. Reserved account1b83b566-736b-41d6-bbaa-aaf8c9965e95 cleanup verified by maintained guarded helper.
42 focused tests and1974 normal pre-push tests passed; all required PR checks and all16 publication test groups passed. Broader post-deploy run41378737301 is still running, with publication confirmation passed; no claim of whole-platform certification. Scoped real-browser compatibility proof passed against serving engine. Legacy metadata remains current table blinds, not an engine-frozen hand snapshot. No engine changes, migration, player-account alteration or financial repair.
Evidence archive holds source scripts, before/after logs, screenshot, policy receipts, preflight, required checks and publisher-final.json. This latest checkpoint is archived before removing own merged worktree and task scratch/dependencies.

Cleanup complete: own Git worktree removed through git worktree remove; own task scratch, dependencies and build output deleted. Evidence retained on archives SSD.

## Engine follow-up authorized November 1

User explicitly requests completing engine support, root repair, regression hardening, deployment and live verification for hand-frozen BB across level changes. Own follow-up branch fix/mongo-hand-blinds-20261101 at1da8c4272af; worktree /Volumes/SmarterWork/agent-work/shared-capacity/mongo-hand-blinds-01a19a02/ca. Prior client PR9254 complete. Scope now includes engine hand-blind serialization and required protected engine delivery. No tournament holds or financial writes.
Canonical full policy2.9 read2026-11-02T02:52:12.021Z, same manifest/four file hashes above; root AGENTS, full CLAUDE, playbook, PUBLISHING and deploy-paths freshly read. No nested server instructions. SSD shared-capacity mount verified. Existing engine run41379310363 targets9f8219ae08053f72a7ccc0a903f75219e29e042b; do not duplicate/compete. Serving engine eed06fe5 still lacks hand_blinds.
Existing source from8827 supplies dealt snapshots; identified gap: rejected hand identity omits field, wrongly permits legacy metadata fallback. Modern invalid/unavailable active hand data must be explicit null. Acceptance includes actual level refresh, all serializers, recovery/reconnect, next-hand rollover, protected checks/merge, certified engine activation/sealed receipt and real serving behavior.

Engine regression before:5failed/34passed. After:42engine tests (including projection equivalence) and11client tests passed. Server TypeScript passed. Private root/server dependencies installed in own SSD worktree. Exact engine deployment and live proof pending.
