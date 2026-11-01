# Full Session Hands

Owner: Codex chat 01a1950b. Request: Player Hub shows only 17 tournament hands; track every hand in the full session/tournament.
Checkout: /Volumes/SmarterWork/agent-work/shared-capacity/full-session-hands-01a1950b/ca
Branch: fix/full-session-hands-01a1950b. Base: 44385faf19.

Acceptance: persisted completed dealt-in hands, full tournament across tables/reconnects; cash bounded to actual session; VPIP/PFR same denominator; final hand included without successor; loading/errors never fabricated totals; preserve artwork, financial behavior, active games. Required local checks, protected delivery and live proof remain pending.

Read canonical four policies through agent-policy.mjs read, plus MAC-STORAGE, repository AGENTS/CLAUDE/AGENT-PLAYBOOK, PUBLISHING, deploy-paths. Version 2.9; manifest 7c7f308e580f0e2b9170085bb3a454c89ff7234627570c74ab68f5e7846b5b52. Full emitted receipt: work/policy-read.txt. Canonical comparison passed. Isolated SSD volume verified /dev/disk5s1. GitHub authenticated; Supabase configured project kuklfnapbkmacvwxktbh read access verified.

Cause: Player Hub reads SessionStatsService browser counters; no persisted tournament hydration. Current main already preserves browser state across confirmed moves (#8530), but one-hour local backup and observation-only count cannot recover complete tournament history. Preserve that newer work.
Live read: Kingfish 47965354-0e56-43ef-931c-ddaab82af765, Saturday Mystery 329aa86f-08a9-46f1-8916-59c230aca349 had 56 ca_hand_facts rows at investigation, not panel's 17. Historical screenshot instant total not yet established. No production mutations.

## Final candidate qualification, 2026-11-01 03:13 UTC

Fresh canonical reader emitted 03:13:04.445Z; full four policies read again. Same version2.9 / manifest7c7f308e580f0e2b9170085bb3a454c89ff7234627570c74ab68f5e7846b5b52 and file hashes as startup receipt. Read-only review and local browser subagents authorized by owner's latest explicit request for swarm; no delegated release operation.

Screenshot-time production read independently matched hand_history and ca_hand_facts:56 hands,26 VPIP,19 PFR. One table, so no claim that a move caused this particular sample. Current sample is browser-only; full records survived. Read-only aggregate query optimized from a table-scan plan to indexed joins:67.724ms on production data. No DDL or historical write used for diagnosis.

Implementation: new self-only SQL snapshot union/deduplication, same complete denominator for count/VPIP/PFR; cash sitting boundaries and confirmed occupancy receipt chain; optional as-of binds final cards before leave so a subsequent sitting cannot replace them; original transaction's TABLE_UNLOCKED refresh includes final hand. Existing Lightning pool-session reader retained. All three open readers receive engine reconnect revision. Final cash/tournament cards recover durable hand totals, preserving Diamond custody and financial payloads. Scope remains stats only; no engine replacement, no game/admission/payment mutations.

Local evidence: isolated PG17 runner passed 1,205 tournament hands, A-B-A cash moves with removed source seats, independent table exclusion, finished/fresh sittings, Diamond custody, as-of binding, registered-before-start timing, incomplete facts, permissions and duplicate reads. Focused hooks/source-wiring:37 passed; summary/regression suite24 passed; final summary refinement3 passed. Player Hub browser proof at375/393 px:56/46.4%/33.9%, final settlement57, reload56. Browser test used synthetic RPC fixture, not production user login. Exact files/evidence retained in task scratch/browser. TypeScript passed. Copy gates passed. Source binding verifier1,822 pins passed, cash preflight6 tests passed; only reviewed active pins were restamped with source-only audits, no historical certificates.

A broad optional local Vitest invocation was stopped after owner's efficiency steering; it is not passing evidence. Final scoped pre-push and required hosted checks remain mandatory. No success claim until protected merge, exact SQL installation/readback, successful existing static publisher, both live identities and affected behavior proof.

Latest exact-source checks after review fixes:40 focused hook/summary/CI-wiring tests passed; PG17 as-of/new-sitting qualification passed; TypeScript compile passed. Local production build completed (dummy public fixture config, never a publisher). Upstream1a0fb947 integrated by normal fast-forward; concurrent avatar/catalogue changes preserved. Normal pre-push will qualify final committed tree.
