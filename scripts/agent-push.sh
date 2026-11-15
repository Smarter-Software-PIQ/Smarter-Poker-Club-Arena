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
#             3 push reported success but the remote ref is not HEAD;
#             129/130/143 stopped by SIGHUP (or its parent shell going away),
#             SIGINT or SIGTERM: the whole tree it started is terminated and
#             nothing further is pushed.
set -uo pipefail

REMOTE=${AGENT_PUSH_REMOTE:-origin}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

say() { printf '[agent-push] %s\n' "$*" >&2; }

# IT OWNS THE PROCESS TREE IT STARTS (2026-11-15). Agents launch this helper
# detached (`screen -dmS name bash -c 'bash scripts/agent-push.sh > log 2>&1'`)
# and "stop" it with `screen -S name -X quit`. That killed the screen and the
# outer shell, but this script, git push, the pre-push hook and its vitest
# workers ran on for up to 40 minutes on the shared Mac, and a run that went
# green would still have PUSHED a branch its agent believed it had stopped.
# Three times on 2026-11-15. Bash runs a trap only after its foreground child
# returns, and the hook's own HUP trap waits on vitest the same way, so a
# hangup reached nothing that could act on it.
#
# So every step that can take time runs as a background job in a process
# group of its own (`set -m` around the launch; bash 3.2 and 5, with or
# without a terminal), and this shell waits on it with `wait`, which a trapped
# signal interrupts at once. On SIGHUP, SIGINT or SIGTERM, or when a watcher
# sees that this script's parent is gone (it was reparented), the handler
# terminates that group and every process descended from it, escalates to
# SIGKILL after five seconds, prints one STOPPED line and exits non-zero
# without starting or finishing a push. Nothing here forces, skips a hook or
# changes what the gate runs.
STEP_PGID=
PHASE=before
MAIN_PID=$$
ORIG_PPID=$PPID
WATCHER=

# Every pid descended from $1, read from one process table (pid and ppid only).
# shellcheck disable=SC2329 # reached from the signal traps below
descendants_of() {
  ps -A -o pid= -o ppid= 2>/dev/null | awk -v root="$1" '
    { parent[$1] = $2; order[NR] = $1 }
    END {
      found[root] = 1
      grew = 1
      while (grew) {
        grew = 0
        for (i = 1; i <= NR; i++) {
          p = order[i]
          if (!(p in found) && (parent[p] in found)) { found[p] = 1; grew = 1; print p }
        }
      }
    }'
}

# True while any process of group $1, or any pid in the list $2, is still
# running (a zombie awaiting its parent does not count).
# shellcheck disable=SC2329 # reached from the signal traps below
tree_running() {
  ps -A -o pid= -o pgid= -o stat= 2>/dev/null | awk -v g="$1" -v list=" $2 " '
    $3 !~ /^Z/ && ($2 == g || index(list, " " $1 " ")) { found = 1 }
    END { exit !found }'
}

# shellcheck disable=SC2329 # reached from the signal traps below
stop_step_tree() {
  [ -n "$STEP_PGID" ] || return 0
  local tree pid tries=0
  tree=$(descendants_of "$STEP_PGID" | tr '\n' ' ')
  kill -TERM -- "-$STEP_PGID" 2>/dev/null
  for pid in $STEP_PGID $tree; do kill -TERM "$pid" 2>/dev/null; done
  while tree_running "$STEP_PGID" "$tree"; do
    if [ "$tries" -ge 20 ]; then
      kill -KILL -- "-$STEP_PGID" 2>/dev/null
      for pid in $STEP_PGID $tree; do kill -KILL "$pid" 2>/dev/null; done
      break
    fi
    sleep 0.25
    tries=$((tries + 1))
  done
  STEP_PGID=
}

# shellcheck disable=SC2329 # reached from the signal traps below
stop_watcher() {
  [ -n "$WATCHER" ] && kill "$WATCHER" 2>/dev/null
  WATCHER=
}

# shellcheck disable=SC2329 # reached from the signal traps below
on_stop() {
  trap '' HUP INT TERM USR1
  local outcome='nothing was pushed'
  [ "$PHASE" = push ] && outcome='git push was stopped before it completed'
  [ "$PHASE" = verify ] && outcome='git push had already returned; the remote ref was not verified'
  stop_step_tree
  stop_watcher
  say "STOPPED: $1; terminated the process tree this run started; $outcome."
  exit "$2"
}
trap 'on_stop "received SIGHUP" 129' HUP
trap 'on_stop "received SIGINT" 130' INT
trap 'on_stop "received SIGTERM" 143' TERM
trap 'on_stop "its parent process went away" 129' USR1
trap 'stop_watcher' EXIT

# Run "$@" as a job with its own process group and wait for it. Returns its
# exit code; a stop signal interrupts the wait and on_stop takes the group down.
owned() {
  set -m
  "$@" &
  STEP_PGID=$!
  set +m
  wait "$STEP_PGID"
  local rc=$?
  STEP_PGID=
  return "$rc"
}

# A launcher that exits (the screen session or its shell is killed) leaves
# this script reparented; nothing then signals it. Watch for that. A run
# started directly under pid 1 has no launcher to lose and is not watched.
if [ "$ORIG_PPID" -gt 1 ]; then
  (
    while kill -0 "$MAIN_PID" 2>/dev/null; do
      now=$(ps -o ppid= -p "$MAIN_PID" 2>/dev/null | tr -d ' ')
      if [ -n "$now" ] && [ "$now" != "$ORIG_PPID" ]; then
        kill -USR1 "$MAIN_PID" 2>/dev/null
        exit 0
      fi
      sleep 1
    done
  ) </dev/null &
  WATCHER=$!
fi

# HTTPS instead of SSH for github.com, credentials from `gh`, and no ambient
# GH_TOKEN/GITHUB_TOKEN (they override gh's own login with whatever a parent
# process exported). On a non-GitHub remote (tests use a local bare repo) the
# rewrite simply never matches.
#
# ONLY WHEN gh HAS A LOGIN OF ITS OWN (2026-11-06). In a cloud agent session
# the ambient GH_TOKEN IS the configured identity and gh has no stored login:
# stripping it left the pre-push merged-branch guard unable to ask GitHub
# anything, so every push from a cloud session was BLOCKED ("GitHub did not
# identify the trusted destination repository"). Keep the token there.
AMBIENT_TOKEN_STRIP=()
if env -u GH_TOKEN -u GITHUB_TOKEN gh auth status >/dev/null 2>&1; then
  AMBIENT_TOKEN_STRIP=(-u GH_TOKEN -u GITHUB_TOKEN)
fi
remote_git() {
  env ${AMBIENT_TOKEN_STRIP[@]+"${AMBIENT_TOKEN_STRIP[@]}"} git \
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

# A clone whose shared config says core.bare=true breaks every worktree and
# makes the hook below fail obscurely; refuse up front with the repair.
if ! bash "$SCRIPT_DIR/guard-bare-flip.sh"; then
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
owned remote_git fetch "$REMOTE" main
rc=$?
if [ "$rc" -ne 0 ]; then
  say "FAILED: git fetch $REMOTE main exited $rc."
  exit "$rc"
fi
# A plain `git fetch <remote> main` updates refs/remotes/<remote>/main only
# when a fetch refspec exists for it; make sure the hook sees the fresh tip.
git update-ref "refs/remotes/$REMOTE/main" FETCH_HEAD

# A repeated request for the exact already-pushed source needs no new push or
# hook execution. Read back the remote outcome first; never infer it from a
# prior command's acknowledgement. New source still follows all normal hooks.
if ! git diff --quiet HEAD --; then
  say "REFUSED: commit tracked working edits before pushing the candidate."
  exit 2
fi
EXISTING_LINE=$(remote_git ls-remote "$REMOTE" "refs/heads/$BRANCH")
rc=$?
if [ "$rc" -ne 0 ]; then
  say "UNKNOWN: could not read the remote branch before push ($rc)."
  exit "$rc"
fi
EXISTING_SHA=$(printf '%s\n' "$EXISTING_LINE" | awk -v ref="refs/heads/$BRANCH" '$2 == ref { print $1 }')
if [ "$EXISTING_SHA" = "$HEAD_SHA" ]; then
  say "ALREADY PRESENT: $REMOTE refs/heads/$BRANCH = $HEAD_SHA; no new push required."
  exit 0
fi

# SAY WHAT THE HOOK WILL BLOCK ON, BEFORE IT SPENDS MINUTES (2026-11-07). The
# pre-push hook refuses a push touching src/** or server/** when that package
# root's node_modules does not satisfy its lockfile, and a fresh worktree has
# reached that refusal twice today. This is the same read-only probe the hook
# runs; it changes nothing and refuses nothing, it names the exact command.
TREE_TOP=$(git rev-parse --show-toplevel)
for pkg in "$TREE_TOP" "$TREE_TOP/server"; do
  [ -f "$pkg/package.json" ] && [ -f "$pkg/package-lock.json" ] || continue
  if [ "$(node "$SCRIPT_DIR/local-dependency-policy.mjs" "$pkg" 2>/dev/null)" != local ]; then
    say "WARNING: $pkg/node_modules does not satisfy its lockfile; the pre-push hook will BLOCK a push touching it."
    say "  remedy: (cd \"$pkg\" && npm ci --ignore-scripts --no-audit --no-fund)"
  fi
done

# Show existing admission before expensive hooks; never skips a gate.
owned node "$SCRIPT_DIR/ci/execution-preview.mjs"
rc=$?
if [ "$rc" -ne 0 ]; then
  say "FAILED: execution preview could not inspect this candidate ($rc)."
  exit "$rc"
fi

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
    owned sleep 15
    waited=$(( waited + 15 ))
  done
fi

say "pushing $BRANCH ($HEAD_SHA) to $REMOTE; the pre-push hook can take minutes"
PHASE=push
owned remote_git push -u "$REMOTE" "refs/heads/$BRANCH:refs/heads/$BRANCH"
rc=$?
PHASE=verify
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
