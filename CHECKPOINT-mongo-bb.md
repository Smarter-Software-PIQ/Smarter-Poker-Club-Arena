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
