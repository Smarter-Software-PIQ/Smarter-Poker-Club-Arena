# tests/a-hook-child-never-flips-the-clone-bare.law.test.ts

No git child of a hook inherits the hook's `GIT_DIR`. On 2026-11-07, a `git -C <tmp> init` fixture under an inherited worktree git dir wrote `core.bare=true` into the shared clone's config twice. Now the hooks unset `GIT_DIR` and its siblings first, the fixtures strip `GIT_*`, and `guard-bare-flip.sh`, `agent-push.sh` and `agent-workspace.sh` refuse a clone that says bare and print the repair command.
