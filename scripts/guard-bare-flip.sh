#!/usr/bin/env bash
# A CLONE WITH A WORKING TREE IS NEVER core.bare=true (2026-11-07).
#
# Twice on 2026-11-07 ~/Documents/club-arena carried core.bare=true, and every
# worktree of it stopped working ("this operation must be run in a work tree").
# What set it: git exports GIT_DIR to its hooks, and in a linked worktree that
# is <clone>/.git/worktrees/<name>. .husky/pre-push runs Node test contracts,
# and scripts/ci/v31-*.test.mjs built their fixtures with `git -C <tmp> init`
# under `{...process.env}`. With GIT_DIR inherited, that `init` re-initialised
# the worktree's git dir instead of the temp directory, guessed "bare" (a git
# dir not named .git), and wrote core.bare=true into the SHARED config.
# The hooks now drop GIT_DIR and friends before running anything, and those
# fixtures strip GIT_* themselves; this guard is the refusal that names the
# state instead of letting a push or a new worktree fail obscurely.
#
# Exit 0 when the clone is sound (or is a genuinely bare repository); exit 1
# with the repair command when a clone that has a working tree says bare.
set -uo pipefail

COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
# A genuinely bare repository's git dir is not named .git: nothing to judge.
case "$COMMON" in */.git) ;; *) exit 0 ;; esac
[ "$(git config --file "$COMMON/config" --get core.bare 2>/dev/null)" = true ] || exit 0

CLONE=${COMMON%/.git}
cat >&2 <<MSG
REFUSED: $CLONE is a clone with a working tree, but its shared config says
core.bare=true, so every worktree of it is treated as bare and git commands in
them fail. Something ran \`git init\` (or \`git config core.bare true\`) with this
clone's GIT_DIR inherited - see scripts/guard-bare-flip.sh for the 2026-11-07
cause. Restore it, then run this command again:

  git config --file "$COMMON/config" core.bare false
MSG
exit 1
