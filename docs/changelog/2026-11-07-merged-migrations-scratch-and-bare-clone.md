# Merged migrations install from every merge; push scratch and the bare clone (2026-11-07)

## Merged migrations were never dispatched

`dispatch-merged-migrations` lived in `agent-autopilot.yml`. Agent Autopilot
has been `disabled_manually` since 2026-10-28 (owner instruction, PUBLISHING.md),
so the job never ran — not for the App's merges and not after #9932 removed the
App-only rule. #9858 and #9957 (GitHub auto-merge armed by the owner account)
left their migrations uninstalled until hand dispatches.

The job now has its own workflow, `.github/workflows/dispatch-merged-migrations.yml`,
on the native `pull_request_target` `closed` event of every PR merged into the
default branch from this repository. The trust is the protected merge, not the
merger. It uses the job token (`contents: write`; a `repository_dispatch` sent
with it does start the applier). Every other guard in
`.github/scripts/dispatch-merged-migrations.sh` is unchanged: added files only,
filename order, window files skipped, the bounded break-window wait, never
retried. The autopilot workflow is back to its pre-2026-10-25 shape.

## Pre-push kept an unwritable TMPDIR

A caller's TMPDIR under `/Volumes` was kept on its path alone. While
`/Volumes/SmarterWork` is the read-only root stub, vitest's first `mkdtemp`
failed with EACCES. The hook now keeps a caller's TMPDIR only when it can make
a directory in it, and otherwise takes its own external run scratch.

## core.bare flipped to true

git exports `GIT_DIR` to hooks (`<clone>/.git/worktrees/<name>` in a worktree).
The pre-push Node contracts `scripts/ci/v31-*.test.mjs` ran `git -C <tmp> init`
with that inherited, which re-initialised the worktree's git dir, guessed
"bare", and wrote `core.bare=true` into the shared clone's config. The hooks
now unset `GIT_DIR` and friends first, the fixtures strip `GIT_*`, and
`scripts/guard-bare-flip.sh` (run by pre-push and `agent-push.sh`; inlined in
`agent-workspace.sh`) refuses a clone that says bare, with the repair command.
