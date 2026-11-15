# Sourced by run-capture-steps.sh, run-originals.sh, run-originals-host.sh. One named operator per capture folder, and one running step at a time.
# 1. Operator lock: the first caller with HVH_OPERATOR creates <capture>/.operation.lock atomically (mkdir); any other operator is refused (exit 7).
# 2. Run lock: every reading step also takes <capture>/.run.lock atomically (mkdir) holding PID, host, step and start time, and releases it on exit (trap).
#    A second invocation while it is held is refused (exit 8), even by the same operator. A lock whose PID is no longer alive on this host is NOT
#    taken over silently: the caller is refused (exit 8) and must inspect the interrupted step's outputs, then move the stale lock aside by hand
#    (mv .run.lock .run.lock.stale-<UTC>), which leaves a record.
hvh_operator_lock(){ local cap=$1 l=$1/.operation.lock
  [ -n "${HVH_OPERATOR:-}" ] || { echo "refused: HVH_OPERATOR is required (one named operator per capture)"; return 7; }
  if mkdir "$l" 2>/dev/null; then printf '%s\n' "$HVH_OPERATOR" > "$l/OPERATOR"; date -u +%FT%TZ > "$l/TAKEN_AT"; else
    [ "$(cat "$l/OPERATOR" 2>/dev/null)" = "$HVH_OPERATOR" ] || { echo "refused: capture $cap is operated by $(cat "$l/OPERATOR" 2>/dev/null); verify its outputs instead of reading again"; return 7; }; fi
  hvh_run_lock "$cap" "${HVH_STEP:-$(basename "$0")}"; }
hvh_run_lock(){ local cap=$1 step=$2 r=$1/.run.lock
  if mkdir "$r" 2>/dev/null; then
    printf 'pid=%s host=%s step=%s operator=%s started=%s\n' "$$" "$(hostname -s)" "$step" "$HVH_OPERATOR" "$(date -u +%FT%TZ)" > "$r/RUN"
    HVH_RUN_LOCK=$r; trap 'rm -rf "$HVH_RUN_LOCK"' EXIT; return 0; fi
  local pid; pid=$(sed -n 's/^pid=\([0-9]*\).*/\1/p' "$r/RUN" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "refused: step already running in $cap ($(cat "$r/RUN"))"; return 8; fi
  echo "refused: stale run lock in $cap ($(cat "$r/RUN" 2>/dev/null)); the step was interrupted: inspect its outputs, then mv .run.lock .run.lock.stale-<UTC>"; return 8; }
