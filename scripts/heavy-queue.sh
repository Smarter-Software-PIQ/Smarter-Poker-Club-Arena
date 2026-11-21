#!/usr/bin/env bash
# THE MAC'S HEAVY-JOB QUEUE, FROM THE COMMAND LINE (2026-11-19).
#
#   bash scripts/heavy-queue.sh status [--prune]
#       Who holds a heavy-job slot, who is waiting and in what order, the slot
#       count and the machine load. --prune also removes tickets whose holder
#       process is gone (every waiter does this by itself as well).
#   bash scripts/heavy-queue.sh run [--label <text>] -- <command> [args...]
#       Wait FIFO for a slot, run the command, give the slot back. Returns the
#       command's own exit code. Nothing about the command changes.
#   bash scripts/heavy-queue.sh npm-ci [<dir>...]
#       `npm ci --ignore-scripts --no-audit --no-fund` in each directory (default:
#       this tree's root and server/ when present), queued, with npm's download
#       cache on the authorized SSD when it is writable.
#
# The queue logic and every environment knob are in scripts/lib/heavy-queue.sh.
# The pre-push hook and scripts/agent-push.sh use the same library, so a push
# and a manual vitest run wait in the same line. A broken queue never blocks a
# job: it warns and runs it at once (fail open).
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/heavy-queue.sh
. "$SCRIPT_DIR/lib/heavy-queue.sh"

usage() {
  sed -n '3,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

# npm's download cache on the authorized SSD (shared, content-addressed and
# safe for concurrent installs). Only when the caller did not choose one and
# the directory can be written; otherwise npm keeps its own setting.
hq_npm_cache() {
  [ -z "${npm_config_cache:-}" ] || return 0
  [ "$(hq_env_value AGENT_SSD_USE_AUTHORIZED)" = true ] || return 0
  local base
  base=$(hq_env_value SSD2_SHARED_CACHES_DIR)
  [ -n "$base" ] && [ -d "$base" ] || return 0
  if mkdir -p "$base/npm-cache" 2>/dev/null && [ -w "$base/npm-cache" ]; then
    npm_config_cache="$base/npm-cache"
    export npm_config_cache
    hq_say "npm download cache: $npm_config_cache"
  fi
}

cmd_status() {
  local prune=0 q slots now t state label pid age cwd since running=0 waiting=0 stale=0 line
  [ "${1:-}" = --prune ] && prune=1
  q=$(hq_dir) || { echo "heavy-job queue: UNAVAILABLE (no writable queue directory); heavy jobs run unqueued."; return 0; }
  slots=$(hq_slots)
  now=$(date +%s)
  echo "heavy-job queue: $q"
  [ -n "${HQ_DIR_NOTE:-}" ] && echo "  note: $HQ_DIR_NOTE"
  echo "  slots: $slots concurrent heavy jobs ($(hq_cores) cores); load averages: $(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | awk '{ $1 = $1; print }')"
  echo "  load ceiling: $(hq_load_ceiling) (a free slot waits while the 1-minute load is above it and a heavy job runs; 0 = off)"
  local typ
  if typ=$(hq_typical_run "$q"); then
    echo "  typical heavy job: $(( (typ + 59) / 60 )) min (median of the last $(wc -l < "$q/history" | tr -d ' ') runs)"
  fi
  echo "  still running in pre-2026-11-20 queue folders (they hold slots here): $(hq_legacy_running)"
  printf '  %-8s %-7s %-8s %-7s %-40s %s\n' TICKET STATE PID AGE LABEL WORKTREE
  for t in "$q"/tickets/*; do
    case "$t" in *.run | *'*') continue ;; esac
    [ -f "$t" ] || continue
    label=$(hq_field "$t" label)
    pid=$(hq_field "$t" pid)
    cwd=$(hq_field "$t" cwd)
    since=$(hq_field "$t" enqueued)
    if ! hq_ticket_alive "$t"; then
      state=STALE
      stale=$((stale + 1))
      if [ "$prune" = 1 ]; then hq_reap "$t"; state=REMOVED; fi
    elif [ -f "$t.run" ]; then
      state=RUNNING
      running=$((running + 1))
      since=$(cat "$t.run" 2>/dev/null)
    else
      state=WAITING
      waiting=$((waiting + 1))
    fi
    case "$since" in '' | *[!0-9]*) since=$now ;; esac
    age=$(( now - since ))
    line=$(printf '  %-8s %-7s %-8s %-7s %-40s %s' "$((10#$(basename "$t")))" "$state" "$pid" "${age}s" "${label:0:40}" "$cwd")
    echo "$line"
  done
  echo "  running $running, waiting $waiting, stale $stale"
}

cmd_run() {
  local label=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --label) label=${2:-}; shift 2 ;;
      --) shift; break ;;
      *) break ;;
    esac
  done
  [ "$#" -gt 0 ] || usage
  [ -n "$label" ] || label="$*"
  case "$1" in npm | npx) hq_npm_cache ;; esac
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  trap 'hq_release' EXIT
  hq_acquire "$label"
  "$@"
  local rc=$?
  hq_release
  return "$rc"
}

cmd_npm_ci() {
  local top dirs=("$@") d rc=0
  if [ "${#dirs[@]}" -eq 0 ]; then
    top=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not in a git tree; name the directories" >&2; return 2; }
    dirs=("$top")
    [ -f "$top/server/package-lock.json" ] && dirs+=("$top/server")
  fi
  hq_npm_cache
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  trap 'hq_release' EXIT
  hq_acquire "npm ci ${dirs[*]}"
  for d in "${dirs[@]}"; do
    hq_say "npm ci in $d"
    (cd "$d" && npm ci --ignore-scripts --no-audit --no-fund) || { rc=$?; break; }
  done
  hq_release
  return "$rc"
}

case "${1:-}" in
  status) shift; cmd_status "$@" ;;
  run) shift; cmd_run "$@" ;;
  npm-ci) shift; cmd_npm_ci "$@" ;;
  *) usage ;;
esac
