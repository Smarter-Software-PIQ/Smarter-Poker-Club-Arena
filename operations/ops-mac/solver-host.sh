#!/bin/bash
# solver-host.sh - the one supported way for an agent on the Ops Mac to reach the
# Windows PioSOLVER hosts M1 (SmarterPoker2) and M2 (SmarterPoker).
#
# Why it exists (2026-11-08): the agent terminal on this Mac runs under a node
# binary that macOS never asked about Local Network access, so every plain LAN
# connection from it (ping, nc, ssh) fails with "No route to host" even while
# M1 and M2 are up. Agents read that as "the PCs are asleep" and stalled the
# R8 solver round for hours. Root is exempt from the Local Network check, so
# this helper connects through `sudo -n ssh` with the dedicated controller key
# and the pinned host keys. A plain ping/nc/ssh "down" from the agent terminal
# proves nothing; only this helper's answer counts.
#
# Usage:
#   solver-host.sh check             reachability, last boot and PioSOLVER processes for both hosts
#   solver-host.sh m1|m2 <command>   run one command on that host (PowerShell/cmd syntax)
#   solver-host.sh scp <args>        scp with the same key, host keys and root route
#
# Exit codes: 0 ok, 2 bad usage, 3 host unreachable or command failed, 4 key or
# pinned host keys missing, 5 passwordless sudo unavailable.
# Ownership is unchanged: only the current solver-round single writer (see
# HORSE-LANES-STATUS.md) runs work on M1/M2; everyone else uses `check` only.
set -u

KEY="${SOLVER_HOST_KEY:-$HOME/.ssh/v31_solver_controller_ed25519}"
PINS="${SOLVER_HOST_KNOWN_HOSTS:-$HOME/claude-work/v31/known_hosts}"
M1_TARGET="danie@192.168.0.51"
M2_TARGET="danbe@192.168.0.155"

usage() {
  sed -n '14,18p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[ $# -ge 1 ] || usage
[ -r "$KEY" ] || { echo "solver-host: controller key not found at $KEY" >&2; exit 4; }
[ -r "$PINS" ] || { echo "solver-host: pinned host keys not found at $PINS" >&2; exit 4; }
sudo -n true 2>/dev/null || { echo "solver-host: passwordless sudo is unavailable; run from Terminal.app instead" >&2; exit 5; }

SSH_OPTS=(-F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY"
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$PINS" -o ConnectTimeout=10)

target_for() {
  case "$1" in
    m1|M1) echo "$M1_TARGET" ;;
    m2|M2) echo "$M2_TARGET" ;;
    *) return 1 ;;
  esac
}

run_on() {
  local t="$1"; shift
  sudo -n ssh "${SSH_OPTS[@]}" "$t" "$@" </dev/null
}

case "$1" in
  check)
    rc=0
    for h in m1 m2; do
      t=$(target_for $h)
      out=$(run_on "$t" 'powershell -NoProfile -Command "$o=Get-CimInstance Win32_OperatingSystem; Write-Output (\"host=\"+$env:COMPUTERNAME+\" boot=\"+$o.LastBootUpTime.ToUniversalTime().ToString(\"s\")+\"Z pio=\"+@(Get-Process PioSOLVER* -ErrorAction SilentlyContinue).Count)"' 2>&1)
      if [ $? -eq 0 ] && printf '%s' "$out" | grep -q 'host='; then
        echo "$h up $(printf '%s' "$out" | grep 'host=' | tr -d '\r')"
      else
        echo "$h UNREACHABLE: $(printf '%s' "$out" | tail -1 | tr -d '\r')"
        rc=3
      fi
    done
    exit $rc
    ;;
  m1|M1|m2|M2)
    t=$(target_for "$1"); shift
    [ $# -ge 1 ] || usage
    run_on "$t" "$@" || exit 3
    ;;
  scp)
    shift
    [ $# -ge 2 ] || usage
    sudo -n scp "${SSH_OPTS[@]}" "$@" </dev/null || exit 3
    ;;
  *) usage ;;
esac
