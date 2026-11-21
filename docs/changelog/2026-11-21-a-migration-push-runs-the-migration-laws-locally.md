# 2026-11-21: a migration push runs the migration laws locally; a lowercase clone URL is the same repository

## Migration census in pre-push

Eleven law tests read every file in `supabase/migrations/` with `readdirSync`,
so the hook's basename search and `related` never selected them when a
migration was added; each failure surfaced first in hosted CI (on 2026-11-21:
a missing `@probe-for`, the money-trigger declaration and window-rule pins).
`.husky/pre-push` now adds them whenever a `supabase/migrations/*.sql` file is
pushed, as it already does for the workflow and test-tree censuses. Measured:
about twelve seconds on a two-core cloud container. The two semantic horse
scans (13 s each) and the full 500-file migration corpus (over ten minutes
here) stay with the hosted Client Unit Tests job.

## The merged-branch guard and a lowercase clone URL

GitHub repository names are case-insensitive. A cloud session that cloned
`.../smarter-poker-club-arena` could not push at all: `scripts/guard-merged-branch.sh`
compared exact approved names and answered "GitHub did not identify the
trusted destination repository". It now canonicalizes the one known name
before asking GitHub; the immutable repository ID is still required
(`tests/unit/aLowercaseCloneUrlIsTheSameRepository.test.ts`, which fails on the
previous guard).

## Not fixable from this repository (recorded so nobody chases them here)

- `gh auth status` in a cloud session reports the injected `GH_TOKEN` as
  invalid while `gh api` calls through it succeed: read the API result, not the
  status line, before routing around `gh` (CLAUDE.md 10.86).
- git against the mounted repository on the Cowork device VM failed with
  "too many open files"; work in a cloud clone or a worktree created by
  `scripts/agent-workspace.sh` instead.

## The scratch-root tests hold for a root session

`tests/unit/prePushScratchIsExternal.test.ts` modelled an unwritable scratch
root as a mode-555 directory, which root can write, so it failed in every root
cloud session that touched the hook. The stub is now a file (nobody can create
a child under it), and the `ca_dir_writable` case asserts the probe agrees with
what the kernel actually admits for the 555 directory, plus a file case.
