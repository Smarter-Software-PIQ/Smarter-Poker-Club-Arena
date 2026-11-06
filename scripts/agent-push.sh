#!/usr/bin/env bash
# ONE WAY TO PUSH AN AGENT BRANCH, AND PROOF THAT IT LANDED (2026-11-05).
#
# USAGE (from your own worktree, on your own branch):
#   bash scripts/agent-push.sh
#
# WHY THIS EXISTS. Two failure modes cost agents real time on 2026-11-05:
#
#   1. SSH goes quiet, git exits 141. `.husky/pre-push` runs for minutes while
#      the SSH connection to GitHub sits idle. After the hook PASSES, git died
#      with SIGPIPE (exit 141), no ref pushed and no error text. Twice.
#   2. A bare HTTPS URL is refused. `git push https://github.com/... HEAD:x`
#      gives the hook a literal URL instead of a remote, so it cannot find the
#      tracking main and stops with "[push baseline] UNKNOWN: Push destination
#      tracking main is unavailable".
#
# WHAT WORKS: keep the remote NAME (origin, so the hook resolves origin/main)
# and change only the transport, to HTTPS authenticated by `gh`. Then do not
# trust the exit code: ask the remote what the branch now points at.
#
# This helper never forces, never passes --no-verify and never skips a hook.
# The full pre-push hook runs exactly as it does for a plain `git push`.
#
# Exit codes: git's own code when fetch or push fail (141 included);
#             2 refused before pushing (shared clone, main, detached HEAD);
#             3 push reported success but the remote ref is not HEAD.
set -uo pipefail

REMOTE=${AGENT_PUSH_REMOTE:-origin}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

say() { printf '[agent-push] %s\n' "$*" >&2; }

# HTTPS instead of SSH for github.com, credentials from `gh`, and no ambient
# GH_TOKEN/GITHUB_TOKEN (they override gh's own login with whatever a parent
# process exported). On a non-GitHub remote (tests use a local bare repo) the
# rewrite simply never matches.
remote_git() {
  env -u GH_TOKEN -u GITHUB_TOKEN git \
    -c url.https://github.com/.insteadOf=git@github.com: \
    -c url.https://github.com/.insteadOf=ssh://git@github.com/ \
    -c credential.helper= \
    -c 'credential.helper=!gh auth git-credential' \
    "$@" </dev/null
}

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  say "REFUSED: not inside a git repository."
  exit 2
fi

# The repository's own rule: no push from the shared clone. Reuse the guard so
# the rule lives in one place.
if ! bash "$SCRIPT_DIR/guard-shared-clone.sh" push; then
  say "REFUSED: push from your own worktree (scripts/agent-workspace.sh)."
  exit 2
fi

BRANCH=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
if [ -z "$BRANCH" ]; then
  say "REFUSED: detached HEAD. Check out a named branch first."
  exit 2
fi
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  say "REFUSED: $BRANCH is protected. Push a branch and open a PR."
  exit 2
fi
HEAD_SHA=$(git rev-parse HEAD)

say "fetching $REMOTE main (the pre-push hook compares against it)"
remote_git fetch "$REMOTE" main
rc=$?
if [ "$rc" -ne 0 ]; then
  say "FAILED: git fetch $REMOTE main exited $rc."
  exit "$rc"
fi
# A plain `git fetch <remote> main` updates refs/remotes/<remote>/main only
# when a fetch refspec exists for it; make sure the hook sees the fresh tip.
git update-ref "refs/remotes/$REMOTE/main" FETCH_HEAD

# A SATURATED MAC FAILS THE GATE ON TIMING, NOT CONTENT (2026-11-06). With a
# 1-minute load of 60-140 on the 28-core Mac Studio (other sessions' suites),
# the hook's shell tests missed their 3-second spawn budgets and a correct
# push was refused after 25 minutes. Waiting for the load to fall below 1.5x
# the core count costs minutes; a refused run costs the whole gate again. This
# only delays the push: the hook and every check it runs are unchanged, and
# after AGENT_PUSH_LOAD_WAIT_SECONDS (default 900, 0 disables) it pushes anyway.
if [ "$(uname -s)" = Darwin ]; then
  cores=$(sysctl -n hw.ncpu 2>/dev/null || echo 0)
  budget=${AGENT_PUSH_LOAD_WAIT_SECONDS:-900}
  waited=0
  while [ "$cores" -gt 0 ] && [ "$waited" -lt "$budget" ]; do
    load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{ print int($2) }')
    [ -n "$load" ] && [ "$load" -lt $(( cores * 3 / 2 )) ] && break
    [ "$waited" -eq 0 ] && say "waiting for the Mac's load ($load on $cores cores) to fall below $(( cores * 3 / 2 )) before running the gate (up to ${budget}s)"
    sleep 15
    waited=$(( waited + 15 ))
  done
fi

say "pushing $BRANCH ($HEAD_SHA) to $REMOTE; the pre-push hook can take minutes"
remote_git push -u "$REMOTE" "refs/heads/$BRANCH:refs/heads/$BRANCH"
rc=$?
if [ "$rc" -ne 0 ]; then
  if [ "$rc" -eq 141 ]; then
    say "FAILED: git push died with SIGPIPE (exit 141); the connection closed under it."
  else
    say "FAILED: git push exited $rc."
  fi
  exit "$rc"
fi

# Exit 0 is not proof. Ask the remote.
REMOTE_LINE=$(remote_git ls-remote "$REMOTE" "refs/heads/$BRANCH")
rc=$?
if [ "$rc" -ne 0 ]; then
  say "FAILED: could not verify the push; git ls-remote exited $rc."
  exit "$rc"
fi
REMOTE_SHA=$(printf '%s\n' "$REMOTE_LINE" | awk -v ref="refs/heads/$BRANCH" '$2 == ref { print $1 }')
if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then
  say "NOT PUSHED: git push said success but $REMOTE refs/heads/$BRANCH is '${REMOTE_SHA:-missing}', HEAD is $HEAD_SHA."
  say "Nothing landed. Run this helper again; do not open or merge a PR for this commit yet."
  exit 3
fi

say "VERIFIED: $REMOTE refs/heads/$BRANCH = $HEAD_SHA"
exit 0
