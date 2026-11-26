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
#             4 refused before pushing: the clone push lock (or the PLO core
#               gate) stayed busy past AGENT_PUSH_LOCK_WAIT_SECONDS, or could
#               not be evaluated (see "EVERY PUSH HOLDS THE CLONE PUSH LOCK");
#             129/130/143 stopped by SIGHUP (or its parent going away; see
#             the detached-launch rule below), SIGINT or SIGTERM: the tree it
#             started is terminated and nothing further is pushed. A stop
#             during the push or verify phase cannot prove the remote ref did
#             not move: read it (git ls-remote) before reporting.
set -uo pipefail

REMOTE=${AGENT_PUSH_REMOTE:-origin}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

say() { printf '[agent-push] %s\n' "$*" >&2; }

# IT OWNS THE PROCESS TREE IT STARTS (2026-11-15). Agents launch this helper
# detached (`screen -dmS name bash -c 'bash scripts/agent-push.sh > log 2>&1'`)
# and "stopped" it with `screen -S name -X quit`. That killed the screen and the
# outer shell, but this script, git push, the pre-push hook and its vitest
# workers ran on for up to 40 minutes on the shared Mac, and a run that went
# green would still have PUSHED a branch its agent believed it had stopped.
# Three times on 2026-11-15. Bash runs a trap only after its foreground child
# returns, and the hook's own HUP trap waits on vitest the same way, so a
# hangup reached nothing that could act on it.
#
# So every step that can take time runs as a background job, and this shell
# waits on it with `wait`, which a trapped signal interrupts at once. The job
# stays in THIS shell's process group (no `set -m`): whoever kills the group
# with SIGKILL, which no trap can see, takes git push, the hook and its workers
# with it, exactly as before this helper owned anything (review of 6016f5d6,
# B1: a separate step group survived such a kill and pushed later).
#
# Stops, and what each does:
#   SIGHUP, SIGINT, SIGTERM: the trap terminates the step and every process
#     descended from it (SIGKILL after five seconds, re-checking each pid's
#     start time first, so a pid reused in a later second is not hit; ps start
#     times have one-second resolution), prints one STOPPED line and exits
#     129, 130 or 143.
#   The parent went away (see the rule below): a one-second watcher signals
#     this shell, which stops the same way (exit 129).
#   This shell itself is killed outright (SIGKILL of its pid alone): the
#     watcher, which outlives it, terminates the step it was running.
#   SIGKILL of the whole process group: the kernel takes everything at once.
# The step is always the real command (git, node, sleep), never a shell
# function, so the recorded pid is git itself: a stop that kills this
# script's shells by name (pkill -f agent-push.sh matches this shell and its
# watcher, never git) cannot leave git push running unrecorded (review of
# b18e25b7, finding 1). The watcher also keeps a snapshot of the step's whole
# tree, so its workers are still found after the step's own pid is gone.
#
# THE DETACHED-LAUNCH RULE (deterministic, never by timing): the helper stops
# when its parent process goes away, from its first instant (started with
# parent pid 1 counts as gone), UNLESS SIGHUP was ignored on entry (it was
# launched with `nohup`) or AGENT_PUSH_DETACHED=1 is set; it prints one line
# when the rule is off. Those two launches are not stopped when their parent
# goes away, but they stay in the launcher's process group, so a launcher that
# kills its whole group takes them too. The launch that outlives the tool call
# is the `screen -dmS` line above (PUBLISHING.md, "Push and protected merge").
# The rule reads an orphan as reparented to pid 1 (macOS, where the shared
# lanes run). Under a Linux child subreaper, a helper whose launcher exited
# before it started records the subreaper as its parent and is not stopped by
# this rule; a later change of parent still stops it.
STEP_PID=
STEP_START=
PHASE=before
MAIN_PID=$$
ORIG_PPID=$PPID
MAIN_PGID=$(ps -o pgid= -p "$MAIN_PID" 2>/dev/null | tr -d ' ')
# This shell leads its own process group (setsid, a terminal job): its
# orphaned group members are part of what it stops.
SWEEP=0
if [ -n "$MAIN_PGID" ] && [ "$MAIN_PGID" = "$MAIN_PID" ]; then
  SWEEP=1
fi
WATCHER=
STATE_FILE=
STARTING=
PENDING_REASON=
PENDING_CODE=

# Was SIGHUP ignored on entry? Signals ignored on entry cannot be trapped in a
# non-interactive shell, and `trap -p` shows them in bash 5 but not in bash
# 3.2, so ask directly: trap it and send it to this shell alone.
HUP_LIVE=
trap 'HUP_LIVE=1' HUP
kill -HUP "$MAIN_PID"
:
trap - HUP
# The same question for SIGTERM. Ignored on entry, the TERM trap below cannot
# be set and every step inherits the ignore, so a SIGTERM, or a SIGTERM to the
# whole group, cannot stop this run: say so (review of 73cdaaa9, note 2).
TERM_LIVE=
trap 'TERM_LIVE=1' TERM
kill -TERM "$MAIN_PID"
:
trap - TERM
if [ -z "$TERM_LIVE" ]; then
  say "SIGTERM was ignored when this helper started: a SIGTERM cannot stop this run or its steps. Stop it with SIGHUP or SIGINT where those are live, or SIGKILL its process group, and read the remote ref before reporting."
fi
WATCH_PARENT=1
if [ "${AGENT_PUSH_DETACHED:-}" = 1 ]; then
  WATCH_PARENT=0
  say "the lost-parent stop is off: AGENT_PUSH_DETACHED=1 is set."
elif [ -z "$HUP_LIVE" ]; then
  WATCH_PARENT=0
  say "the lost-parent stop is off: SIGHUP was ignored on entry (nohup, or an ancestor that ignores it)."
fi

# "pid|start" for each listed pid that exists, from one ps call. The start is
# ps's lstart with its spacing normalised: it tells a process from a later one
# that reused its pid.
starts_of() {
  [ "$#" -gt 0 ] || return 0
  local IFS=,
  ps -o pid= -o lstart= -p "$*" 2>/dev/null |
    awk '{ p = $1; $1 = ""; sub(/^ /, ""); print p "|" $0 }'
}

# The start time of pid $1 (empty when it is gone).
pid_start() {
  local line
  line=$(starts_of "$1")
  [ -n "$line" ] && printf '%s\n' "${line#*|}"
}

# The listed pids and every pid descended from them, read from one process
# table (pid and ppid only).
# shellcheck disable=SC2329 # reached from the signal traps and the watcher
tree_of() {
  [ "$#" -gt 0 ] || return 0
  ps -A -o pid= -o ppid= 2>/dev/null | awk -v roots="$*" '
    BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) found[r[i]] = 1 }
    { parent[$1] = $2; order[NR] = $1 }
    END {
      grew = 1
      while (grew) {
        grew = 0
        for (i = 1; i <= NR; i++) {
          p = order[i]
          if (!(p in found) && (parent[p] in found)) { found[p] = 1; grew = 1 }
        }
      }
      for (p in found) print p
    }'
}

# True while any pid in the list $1 is still running (a zombie awaiting its
# parent does not count).
# shellcheck disable=SC2329 # reached from the signal traps below
tree_running() {
  ps -A -o pid= -o stat= 2>/dev/null | awk -v list=" $1 " '
    $2 !~ /^Z/ && index(list, " " $1 " ") { found = 1 }
    END { exit !found }'
}

# Is pid $1 still the process this run started? $2 is its start time as
# recorded. Without one (ps failed when it was recorded) it is accepted only as
# this shell's own child or as an orphan (parent pid 1) in this shell's process
# group; anything else is not signalled (review of b18e25b7, finding 4a).
# shellcheck disable=SC2329 # reached from the signal traps and the watcher
ours() {
  local now
  [ -n "${1:-}" ] || return 1
  now=$(pid_start "$1")
  [ -n "$now" ] || return 1
  if [ -n "${2:-}" ]; then
    # explicit status: a bare return inside a signal trap returns the status
    # of the command the trap interrupted (bash 5.2), not this test's
    [ "$now" = "$2" ]
    return $?
  fi
  [ -n "$MAIN_PGID" ] || return 1
  case "$(ps -o ppid= -o pgid= -p "$1" 2>/dev/null | awk '{ print $1 " " $2 }')" in
    "$MAIN_PID $MAIN_PGID" | "1 $MAIN_PGID") return 0 ;;
  esac
  return 1
}

# Terminate the step $1 (start time $2) and every process descended from it,
# every process the watcher saw in the step's tree that is still the same
# process, and, when $3 is 1 (this shell leads its own process group), the
# members of that group orphaned to pid 1 other than this shell and its
# watcher (review of b18e25b7, finding 2). SIGTERM to all, then after five
# seconds SIGKILL to each that is still the same process. Returns 1 when there
# was nothing to signal.
# shellcheck disable=SC2329 # reached from the signal traps and the watcher
stop_tree() {
  local roots='' tree pid line snap tries=0
  if ours "${1:-}" "${2:-}"; then roots=$1; fi
  if [ -n "$STATE_FILE" ] && [ -s "$STATE_FILE.tree" ]; then
    # shellcheck disable=SC2046 # one pid per word
    roots="$roots $(starts_of $(cut -d'|' -f1 "$STATE_FILE.tree") |
      awk -F'|' -v seen="$STATE_FILE.tree" '
        BEGIN { while ((getline l < seen) > 0) { split(l, a, "|"); was[a[1]] = a[2] } }
        ($1 in was) && was[$1] != "" && was[$1] == $2 { print $1 }' | tr '\n' ' ')"
  fi
  if [ "${3:-}" = 1 ]; then
    roots="$roots $(ps -A -o pid= -o ppid= -o pgid= 2>/dev/null |
      awk -v g="$MAIN_PID" -v w="${WATCHER:-0}" \
        '$2 == 1 && $3 == g && $1 != g && $1 != w { print $1 }' | tr '\n' ' ')"
  fi
  [ -n "${roots// /}" ] || return 1
  # shellcheck disable=SC2086 # one pid per word
  tree=$(tree_of $roots | tr '\n' ' ')
  # shellcheck disable=SC2086 # one pid per word
  snap=$(starts_of $tree)
  for pid in $tree; do kill -TERM "$pid" 2>/dev/null; done
  while tree_running "$tree"; do
    if [ "$tries" -ge 20 ]; then
      while IFS='|' read -r pid line; do
        [ -n "$pid" ] && [ -n "$line" ] || continue
        [ "$(pid_start "$pid")" = "$line" ] && kill -KILL "$pid" 2>/dev/null
      done <<SNAP
$snap
SNAP
      break
    fi
    sleep 0.25
    tries=$((tries + 1))
  done
  return 0
}

# Signal the watcher only while it is still this shell's child (it exits by
# itself after a lost-parent stop; its pid may be reused after that).
# shellcheck disable=SC2329 # reached from the signal traps below
stop_watcher() {
  if [ -n "$WATCHER" ] &&
    [ "$(ps -o ppid= -p "$WATCHER" 2>/dev/null | tr -d ' ')" = "$MAIN_PID" ]; then
    # SIGKILL, not SIGTERM: a watcher that inherited an ignored SIGTERM would
    # outlive a SIGTERM and the wait would never return (review of 73cdaaa9).
    kill -KILL "$WATCHER" 2>/dev/null
    wait "$WATCHER" 2>/dev/null
  fi
  WATCHER=
}

# shellcheck disable=SC2329 # reached from the signal traps below
on_stop() {
  trap '' HUP INT TERM USR1
  local outcome='nothing was pushed' what='terminated the process tree this run started'
  [ "$PHASE" = push ] && outcome='git push was interrupted and may or may not have updated the remote ref'
  [ "$PHASE" = verify ] && outcome='git push had already returned; the remote ref was not verified'
  stop_tree "$STEP_PID" "$STEP_START" "$SWEEP" || what='found no process of this run still running'
  STEP_PID=
  stop_watcher
  say "STOPPED: $1; $what; $outcome."
  say "Before reporting this run stopped, read the remote ref: git ls-remote $REMOTE refs/heads/<branch>."
  exit "$2"
}

# A stop that lands while a step is being started and recorded is held until
# the record exists, then acted on (review of 6016f5d6, N3).
# shellcheck disable=SC2329 # reached from the signal traps below
request_stop() {
  if [ -n "$STARTING" ]; then
    PENDING_REASON=$1
    PENDING_CODE=$2
    return 0
  fi
  on_stop "$1" "$2"
}
trap 'request_stop "received SIGHUP" 129' HUP
trap 'request_stop "received SIGINT" 130' INT
trap 'request_stop "received SIGTERM" 143' TERM
trap 'request_stop "its parent process went away" 129' USR1
# Drop what this run took of the clone push lock (see "EVERY PUSH HOLDS THE
# CLONE PUSH LOCK" below). `release --pid` removes only a lock whose recorded
# holder is this shell's pid: a lock the calling wrapper holds stays held.
PUSH_LOCK_JS="$SCRIPT_DIR/ops/push-lock.mjs"
PUSH_LOCK_TAKEN=
release_push_lock() {
  [ -n "$PUSH_LOCK_TAKEN" ] || return 0
  PUSH_LOCK_TAKEN=
  node "$PUSH_LOCK_JS" release --pid "$MAIN_PID" </dev/null >&2 || say "WARNING: could not release the clone push lock for pid $MAIN_PID; the next acquire takes it over once this pid is gone."
}
trap 'stop_watcher; release_push_lock; [ -n "$STATE_FILE" ] && rm -f "$STATE_FILE" "$STATE_FILE.tree" "$STATE_FILE.tree.new"; if [ -n "${HQ_TICKET:-}" ]; then hq_release; fi' EXIT

if [ "$WATCH_PARENT" = 1 ] && [ "$ORIG_PPID" -le 1 ]; then
  say "STOPPED: its parent process went away before it started (launched in the background without nohup or AGENT_PUSH_DETACHED=1); nothing was pushed."
  exit 129
fi

# Run "$@" as a job of this shell and wait for it. "$@" is a real command, not
# a shell function, so the job's pid is the command itself. Returns its exit
# code; a stop signal interrupts the wait and on_stop takes the job's tree
# down. The pid is written to the state file at once and its start time right
# after, so a helper killed between the two still leaves a record (review of
# b18e25b7, finding 5).
owned() {
  STARTING=1
  "$@" &
  STEP_PID=$!
  [ -n "$STATE_FILE" ] && printf '%s|\n' "$STEP_PID" > "$STATE_FILE"
  STEP_START=$(pid_start "$STEP_PID")
  [ -n "$STEP_START" ] || STEP_START=$(pid_start "$STEP_PID")
  [ -n "$STATE_FILE" ] && printf '%s|%s\n' "$STEP_PID" "$STEP_START" > "$STATE_FILE"
  STARTING=
  if [ -n "$PENDING_REASON" ]; then on_stop "$PENDING_REASON" "$PENDING_CODE"; fi
  wait "$STEP_PID"
  local rc=$?
  STEP_PID=
  STEP_START=
  # A step that ended on its own with a failure (killed by name, crashed) can
  # leave its workers orphaned: stop what of its snapshot is still the same
  # process (second review of 4550cae7, note 3).
  if [ "$rc" -ne 0 ]; then stop_tree "" "" "$SWEEP"; fi
  if [ -n "$STATE_FILE" ]; then
    : > "$STATE_FILE"
    : > "$STATE_FILE.tree"
  fi
  return "$rc"
}

# Keep agent-push's own state file and child TMPDIR off the macOS boot drive
# (/tmp or /var/folders symlink) when an external SmarterWork scratch root is
# writable. Matches .husky/pre-push's external-SSD scratch policy.
if [ "$(uname -s)" = Darwin ]; then
  case "${TMPDIR:-}" in
    /Volumes/*)
      if [ -d "$TMPDIR" ] && [ -w "$TMPDIR" ]; then
        TMPDIR=$(cd "$TMPDIR" 2>/dev/null && pwd -P) || true
        export TMPDIR
      else
        TMPDIR=""
      fi
      ;;
    *) TMPDIR="" ;;
  esac
  if [ -z "${TMPDIR:-}" ]; then
    for ca_tmp_root in ${CA_PUSH_TMP_ROOT:-/Volumes/SmarterWork/agent-work/.t /Volumes/SmarterWork/agent-work/extreme-capacity/.t}; do
      if mkdir -p "$ca_tmp_root" 2>/dev/null && [ -w "$ca_tmp_root" ]; then
        TMPDIR=$(cd "$ca_tmp_root" 2>/dev/null && pwd -P) || TMPDIR="$ca_tmp_root"
        export TMPDIR
        break
      fi
    done
  fi
fi

# The watcher outlives this shell. It stops the running step when this shell
# is gone (killed outright), keeps a once-a-second snapshot of the step's whole
# tree, and, under the detached-launch rule above, tells this shell to stop
# when its parent goes away. "Gone" is decided by kill -0 (no fork), so a
# failed ps on a loaded Mac does not read as a dead helper (finding 3).
STATE_FILE=$(mktemp "${TMPDIR:-/tmp}/agent-push-step.XXXXXX" 2>/dev/null) || STATE_FILE=
MAIN_START=$(pid_start "$MAIN_PID")
(
  trap '' HUP INT
  while :; do
    gone=
    if ! kill -0 "$MAIN_PID" 2>/dev/null; then
      gone=1
    else
      # a killed helper that its parent has not reaped yet is a zombie
      case "$(ps -o stat= -p "$MAIN_PID" 2>/dev/null)" in *Z*) gone=1 ;; esac
      if [ -z "$gone" ] && [ -n "$MAIN_START" ]; then
        now=$(pid_start "$MAIN_PID")
        [ -n "$now" ] && [ "$now" != "$MAIN_START" ] && gone=1
      fi
    fi
    step=
    [ -n "$STATE_FILE" ] && step=$(cat "$STATE_FILE" 2>/dev/null)
    if [ -n "$gone" ]; then
      if [ -n "$step" ] || { [ -n "$STATE_FILE" ] && [ -s "$STATE_FILE.tree" ]; }; then
        if stop_tree "${step%%|*}" "${step#*|}" 0; then
          say "STOPPED: the helper itself was killed; its watcher terminated the step it was running. Read the remote ref before reporting."
        else
          say "STOPPED: the helper itself was killed; nothing of the step it was running was left. Read the remote ref before reporting."
        fi
      fi
      [ -n "$STATE_FILE" ] && rm -f "$STATE_FILE" "$STATE_FILE.tree" "$STATE_FILE.tree.new"
      exit 0
    fi
    if [ -n "$step" ] && [ -n "${step#*|}" ] &&
      [ "$(pid_start "${step%%|*}")" = "${step#*|}" ]; then
      # shellcheck disable=SC2046 # one pid per word
      starts_of $(tree_of "${step%%|*}") > "$STATE_FILE.tree.new" 2>/dev/null &&
        mv -f "$STATE_FILE.tree.new" "$STATE_FILE.tree"
    fi
    if [ "$WATCH_PARENT" = 1 ]; then
      now=$(ps -o ppid= -p "$MAIN_PID" 2>/dev/null | tr -d ' ')
      if [ -n "$now" ] && [ "$now" != "$ORIG_PPID" ]; then
        [ "$(pid_start "$MAIN_PID")" = "$MAIN_START" ] && kill -USR1 "$MAIN_PID" 2>/dev/null
        exit 0
      fi
    fi
    sleep 1
  done
) </dev/null &
WATCHER=$!

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
REMOTE_GIT=(env ${AMBIENT_TOKEN_STRIP[@]+"${AMBIENT_TOKEN_STRIP[@]}"} git
  -c url.https://github.com/.insteadOf=git@github.com:
  -c url.https://github.com/.insteadOf=ssh://git@github.com/
  -c credential.helper=
  -c 'credential.helper=!gh auth git-credential'
  -c agentpush.helper=agent-push.sh)
# The quick reads (ls-remote) call this in the foreground. The long steps
# (fetch, push) run "${REMOTE_GIT[@]}" through owned, so the job is git itself.
# The inert agentpush.helper setting puts this script's name in git's own
# arguments, so a stop or a check by name (pkill -f / pgrep -f agent-push.sh)
# also reaches git push (second review of 4550cae7, note 4).
remote_git() {
  "${REMOTE_GIT[@]}" "$@" </dev/null
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
rc=0
for fetch_attempt in 1 2 3; do
  owned "${REMOTE_GIT[@]}" fetch "$REMOTE" main
  rc=$?
  [ "$rc" -eq 0 ] && break
  [ "$rc" -ge 128 ] && break
  if [ "$fetch_attempt" -lt 3 ]; then
    say "git fetch $REMOTE main exited $rc (transient ref lock?); retrying ($fetch_attempt/3)..."
    sleep 1
  fi
done
if [ "$rc" -ne 0 ]; then
  say "FAILED: git fetch $REMOTE main exited $rc."
  exit "$rc"
fi
# A plain `git fetch <remote> main` updates refs/remotes/<remote>/main only
# when a fetch refspec exists for it; make sure the hook sees the fresh tip.
# Retry briefly if a sibling worktree is updating the same shared remote ref.
ref_rc=0
for ref_attempt in 1 2 3; do
  git update-ref "refs/remotes/$REMOTE/main" FETCH_HEAD && { ref_rc=0; break; }
  ref_rc=$?
  [ "$ref_attempt" -lt 3 ] && sleep 1
done
if [ "$ref_rc" -ne 0 ]; then
  say "FAILED: git update-ref refs/remotes/$REMOTE/main exited $ref_rc."
  exit "$ref_rc"
fi

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
#
# ONLY A HEAVY LOCAL STAGE IS WORTH WAITING FOR (Dan, 2026-11-19 12:54
# Chicago: "EVEN SIMPLE CHANGES LIKE UI ARE GOING THROUGH A 7 LAYER
# VERIFICATIONS"). The hook starts the engine project only for a push that
# changes an engine, database or dependency-manifest path; every other push
# runs static guards and a handful of directly related tests, so holding it
# for up to fifteen minutes bought nothing. CA_HEAVY_PATHS is the same
# expression the hook uses. A diff that cannot be read counts as heavy.
CA_HEAVY_PATHS='^(server/|supabase/|package(-lock)?\.json$)'
heavy_local_stage() {
  local base changed
  base=$(git merge-base HEAD "refs/remotes/$REMOTE/main" 2>/dev/null) || return 0
  [ -n "$base" ] || return 0
  changed=$(git diff --name-only "$base" HEAD 2>/dev/null) || return 0
  # Strictly isolated non-engine/non-runtime diffs (non-SQL scripts/ops, non-PG
  # tests/unit, non-policy docs, benchmark-only server/src/benchmark +
  # server/src/scripts/horseLeagueCard.ts) run the fast exact-candidate local
  # pre-push path and never need the heavy-job queue or 15-minute load wait.
  # Any other path, or any selector error, fails closed to CA_HEAVY_PATHS below.
  if [ -n "$changed" ] && [ -f "$SCRIPT_DIR/ci/prepush-fast-selector.mjs" ] && \
    printf '%s\n' "$changed" | node "$SCRIPT_DIR/ci/prepush-fast-selector.mjs" --is-fast --stdin >/dev/null 2>&1; then
    return 1
  fi
  printf '%s\n' "$changed" | grep -qE "$CA_HEAVY_PATHS"
}
if [ "$(uname -s)" = Darwin ] && ! heavy_local_stage; then
  say "not waiting on the Mac's load: this push changes no engine, database or dependency-manifest path, so the hook runs static guards and directly related tests only"
elif [ "$(uname -s)" = Darwin ]; then
  # THE HOST-WIDE HEAVY-JOB QUEUE (Dan, 2026-11-19 17:26 Chicago). Load alone
  # could not stop dozens of agents from starting their gates in the same
  # minute: each saw the load fall, and all of them started. A heavy push now
  # first takes a FIFO slot in the machine's queue (scripts/lib/heavy-queue.sh,
  # slots = cores / 7) and holds it through git push, so the pre-push hook
  # under it runs inside this slot and never takes a second one
  # (HQ_HELD_TICKET). The load wait below still runs after admission, for
  # load the queue does not see. A broken queue warns and changes nothing.
  # Check the line: bash scripts/heavy-queue.sh status
  if [ -f "$SCRIPT_DIR/lib/heavy-queue.sh" ] && . "$SCRIPT_DIR/lib/heavy-queue.sh" 2>/dev/null; then
    HQ_OWNER_PID=$MAIN_PID hq_acquire "agent-push $BRANCH" || true
  else
    say "WARNING: scripts/lib/heavy-queue.sh is missing or unreadable; pushing without the heavy-job queue (no check is skipped)."
  fi
  cores=$(sysctl -n hw.ncpu 2>/dev/null || echo 0)
  # Cap local Vitest workers to this heavy-queue slot's CPU share when the
  # caller did not set VITEST_MAX_THREADS explicitly (concurrent heavy jobs
  # spawning uncapped workers drove load >40 and timed out spawnSync tests).
  if [ -z "${VITEST_MAX_THREADS:-}" ] && [ "${cores:-0}" -gt 0 ]; then
    hq_slots=$(( cores / 7 ))
    [ "$hq_slots" -ge 1 ] || hq_slots=1
    per_slot=$(( cores / hq_slots ))
    [ "$per_slot" -ge 2 ] || per_slot=2
    [ "$per_slot" -le 6 ] || per_slot=6
    export VITEST_MAX_THREADS="$per_slot"
    say "capping local Vitest workers to VITEST_MAX_THREADS=$VITEST_MAX_THREADS for this heavy-queue slot ($cores cores / $hq_slots slots)"
  fi
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

# EVERY PUSH HOLDS THE CLONE PUSH LOCK (2026-11-26). The one push lock
# (scripts/ops/push-lock.mjs, in the shared clone's git common directory, see
# docs/ops/single-drive-loss.md) only worked for the lanes whose private
# wrapper took it: the other wrappers took only the SSD1 shepherd.lock, and a
# push launched without a wrapper took nothing. So two pre-push gates could
# run at once on the shared Mac, and with SSD1 gone nothing was held at all.
# This one entry point now holds the lock for the length of git push:
#   - held for this push already (the wrapper that called this helper holds
#     it with its own pid, an ancestor of this shell, or it is pushing this
#     exact branch and commit): not taken again, and never waited for;
#   - free: taken with this shell's pid and released as soon as git push
#     returns, and by the EXIT trap on every other way out;
#   - held by another push: waited for (bounded poll, one log line a minute),
#     never stolen. After AGENT_PUSH_LOCK_WAIT_SECONDS (default 3600) nothing
#     is pushed (exit 4).
# On the Mac it also asks the repository copy of core-gate-running.py whether
# the PLO core gate is running; an unreadable inbox counts as running.
# Only a push to GitHub takes it: the lock serialises lane pushes into the one
# repository, and a push to a local fixture remote (the tests' bare repos)
# must not contend with live lanes for the Mac's lock.
push_remote_url=$(git config --get "remote.$REMOTE.pushurl" 2>/dev/null || git config --get "remote.$REMOTE.url" 2>/dev/null || true)
case "$push_remote_url" in
  *github.com[:/]*)
    if [ ! -f "$PUSH_LOCK_JS" ]; then
      say "REFUSED: $PUSH_LOCK_JS is missing, so the clone push lock cannot be taken; nothing was pushed. Merge origin/main into this branch."
      exit 4
    fi
    gate_args=()
    if [ "$(uname -s)" = Darwin ]; then
      if [ ! -f "$SCRIPT_DIR/ops/core-gate-running.py" ]; then
        say "REFUSED: scripts/ops/core-gate-running.py is missing, so the PLO core gate cannot be confirmed clear; nothing was pushed. Merge origin/main into this branch."
        exit 4
      fi
      gate_args=(--gate-script "$SCRIPT_DIR/ops/core-gate-running.py")
    fi
    say "taking the clone push lock for $BRANCH ($HEAD_SHA)"
    # Set first: whatever the step manages to take before a stop is released.
    PUSH_LOCK_TAKEN=1
    owned node "$PUSH_LOCK_JS" wait-acquire \
      --owner "agent-push.sh push of $BRANCH $HEAD_SHA" --pid "$MAIN_PID" \
      --branch "$BRANCH" --head "$HEAD_SHA" \
      --wait-seconds "${AGENT_PUSH_LOCK_WAIT_SECONDS:-3600}" \
      ${gate_args[@]+"${gate_args[@]}"}
    rc=$?
    if [ "$rc" -ne 0 ]; then
      release_push_lock
      say "REFUSED: the clone push lock was not held for this push (push-lock.mjs exit $rc); nothing was pushed."
      exit 4
    fi
    ;;
esac

say "pushing $BRANCH ($HEAD_SHA) to $REMOTE; the pre-push hook can take minutes"
PHASE=push
owned "${REMOTE_GIT[@]}" push -u "$REMOTE" "refs/heads/$BRANCH:refs/heads/$BRANCH"
rc=$?
release_push_lock
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
