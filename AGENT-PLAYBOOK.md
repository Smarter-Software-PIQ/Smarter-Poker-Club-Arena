**Owner direction November 6, 2026 (chat `01a1b095-8bd5-7d42-afcf-1a0843448274`):** All engine upgrades are staged and certified on isolated Backup during the day. Production replacements require certification for the exact version and may activate ONLY in the 04:00-04:05 America/Chicago maintenance window, after the 03:58 notice and all existing custody, freeze, proof, rollback and thaw safeguards. The temporary Phase1 hourly exception and historical urgent/degraded/owner-window replacement exceptions are revoked. A successful sealed release triggers a fresh Backup copy. Agents work in owned branches and merge through required checks; they never edit the live engine or a shared running Backup directly. A failed or missing certificate leaves the current engine running. Source preparation and non-engine delivery continue throughout the day.

# Agent playbook

Use the [Backup and daily engine launch runbook](PUBLISHING.md#backup-and-daily-engine-launch) for candidate selection, certification, activation and verification, and the step-by-step [engine release runbook](docs/ENGINE-RELEASE-RUNBOOK.md) when adding to the engine or managing a 04:00 cutover. Hourly tournament breaks remain independent.

**Non-engine delivery: push, publish, verify and finish immediately; never wait for an engine window.** Apply the maintenance cutover only to an actual engine replacement or a specifically identified dependency on new engine behavior. A Club Arena client using existing engine APIs, an unrelated pending engine release, and a generic engine-health check do not create that dependency. Required checks and normal client publication/live proof still apply.

Read [AGENTS.md](AGENTS.md) first, then the full references in [the reference index](docs/agent-policy/REFERENCE-INDEX.md). [The operating law](docs/agent-policy/OPERATING-LAW.md) owns scope, resumption, blocker recovery and productive waiting. [The hardening standard](docs/agent-policy/HARDENING.md) owns implementation and regression protection. [PUBLISHING.md](PUBLISHING.md) owns the approved delivery route. Product and financial rules in `CLAUDE.md`, where present, still apply.

Run `node docs/agent-policy/agent-policy.mjs read` on start/resumption, read its full output and the other required references, then record the version/hash receipt in the existing checkpoint. `plan origin/main HEAD` classifies the exact candidate; `report` and `timing` summarize actual evidence. See the reference index for schemas and limits. The normal pre-push hook and existing CI run policy integrity/scenario checks.

## Preserve work and authority

Recover the assigned worktree, branch, PR and evidence. Use an owned linked worktree; a unique writable directory on `/Volumes/SmarterWork/agent-work` is permitted when mounted. Do not reset, clean, stash, move or commit another task's changes. Stage explicit paths and use normal hooks and the configured Git identity. Resolve conflicts by inspecting both sides; never blanket-accept one side or force-push main. Integrate current main into the owned branch when needed and revalidate affected evidence.

Use configured Git/GitHub tools; verify availability in the current environment. Prefer authenticated CLI/API tools for repository operations, with other authorized tools when needed. An unavailable interface is not proof that all access is unavailable. Never read `.env` values or scrape tokens from remotes, documents or sibling repos.

## Workspace, credentials and guard references

`scripts/agent-workspace.sh <agent-name> <branch-slug> --print-path` is the maintained workspace-preparation helper; it puts the tree on `/Volumes/SmarterWork/agent-work` whenever that volume is mounted, and `AGENT_WORKTREE_ROOT` overrides it. Inspect its current checkout and preserve existing ownership before using it; an existing owned SSD worktree does not need to be recreated. Finishing a delivery includes the workspace: once the branch is pushed and merged, remove the worktree (`git worktree remove <path>`) instead of leaving it registered, and never leave `node_modules`, `dist` or a report directory behind in a tree you are done with. `scripts/agent-tree-janitor.sh` sweeps what is left: regenerable weight out of idle trees, then the clean pushed ones removed by `scripts/prune-stale-worktrees.sh`. Keep the `reference-transaction` Git hook that protects retained commits from destructive ref changes. The `estate-integrity` workflow audits repository guards read-only; it does not publish or repair releases.

Use configured authenticated GitHub tools. Repository Actions may use the configured GitHub App identifier `AUTOPILOT_APP_ID`; that secret name is a location reference, not permission to extract secret values or reactivate retired autopilot. Necessary assigned credential repairs follow the current owner policy. Read `PUBLISHING.md` for the actual route. Verify Club Arena client provenance with `build-info.json` at both required public endpoints, and engine identity separately.

## Read the actual check result

Use `node scripts/ci/pr-status.mjs <PR-number>` or the authenticated Actions API for the exact head revision. `GET /commits/:sha/status` reports legacy commit statuses and can say pending with zero results even when Actions has failed. A denied `/commits/:sha/check-runs` read is UNKNOWN, never proof that no check failed. Read `/actions/runs?head_sha=<sha>` and its jobs to identify the actual result. On this Mac `/opt/homebrew/bin` must be on PATH for the configured `gh` executable; check the current environment before declaring it unavailable. A green check still requires the authorized agent to complete protected merge and publication under PUBLISHING.md.

To read why a job failed, read its log: `gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs`, or `gh run view <run-id> --log-failed`. The API answers with a redirect to Actions log storage (`*.blob.core.windows.net`), and a cloud session's egress allowlist or the desktop Linux sandbox may refuse that host (403 at CONNECT, checked 2026-10-21), while check-run annotations carry only the exit code. When the session is linked to this Mac, run the same `gh` command in the host terminal, which reaches log storage directly. A log you could not read is UNKNOWN, never a pass.

Never fetch Actions artifacts or logs through a browser pane or Chrome on the owner's Mac. Every browser download opens a Save dialog on his screen, and on 2026-10-22 a session pulling `p102-*` benchmark artifacts this way raised one every four seconds (53 files). Use `gh run download <run-id> -n <artifact> -D <scratch dir>` in the host terminal instead, write into the task's own scratch folder rather than `~/Downloads`, and read logs with `gh` as above.

## Complete the assigned result

Do not stop at a push when authorized delivery is unfinished. Find or create the PR, pass applicable checks, complete protected merge, and verify the actual publication and behavior. Reuse a remote commit or PR already present. If its PR has merged, a new follow-up needs an owned branch and PR; pushing into a closed PR does not deliver it.

Failed delivery enters immediate blocker recovery under the operating law. Compare the last successful equivalent, fix the cause, validate affected inputs and promptly continue through the existing route when eligible. Unknown remote outcome requires readback before retry. Keep pending work and remaining verification in the existing checkpoint. Never bypass a failing gate or add a release timer, watcher or recurring agent.

Evidence must match the actual inputs and component. A merge badge, successful command, open PR, frontend version or filled form is not proof of every downstream result. For a write, read back the persisted row and affected consumer safely. Prove inclusion when a newer protected version contains concurrent work; do not overwrite it to force an older SHA.

## Preserve product rules

The owner's ban on “em bars” means em dashes in user-visible text. It does not ban the hamburger menu. Preserve the approved artwork and navigation enforced by `tests/approvedHamburgerGearGuard.law.test.ts`, financial safeguards and task-specific product laws. Do not use real chips or active games for destructive tests. Unrelated TODOs are not an assignment, and unavailable verification must be reported rather than invented.
