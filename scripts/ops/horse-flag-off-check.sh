#!/usr/bin/env bash
# HORSE FLAG-OFF CHECK: does <head-ref> change any Horse decision that <base-ref> makes, with the option switches
# exactly as they are in production?
#
#   scripts/ops/horse-flag-off-check.sh <base-ref> <head-ref> --scratch <dir on the external SSD>
#        [--set quick|full] [--options <file>] [--variant +option=on]... [--memory some|off|all]
#        [--node-modules <installed server/node_modules>] [--json <report.json>] [--keep]
#
# What it does: makes two throwaway worktrees (base, head) in its own new folder under --scratch, generates the
# seeded decision states on the head build, runs them through HorseLogic.decide on both builds with the production
# switch snapshot (docs/horse-option-switch-state.json of THIS checkout), and compares every decision.
#
# Prints "0 differences" (exit 0) or the differing decisions grouped by receipt (exit 1). Exit 2: it could not
# run or the two replays cannot be compared; that is never a pass.
#
# It reads nothing from production and writes nothing outside its own folder under --scratch, which it removes
# when it ends (with both worktrees) unless --keep is given. --scratch must be on an external volume, never the
# boot drive (owner direction, September 29, 2026). It is NOT a required check and proves less than it sounds like:
# read "What this does not cover" in docs/ops/horse-flag-off-check.md before quoting a 0.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$SCRIPT_DIR/../.." && pwd)
TOOL="$SCRIPT_DIR/horse-decision-crossbuild-replay.mjs"

say() { printf '[horse-flag-off-check] %s\n' "$*" >&2; }
usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; }

BASE_REF=""; HEAD_REF=""; SCRATCH="${HORSE_FLAG_OFF_SCRATCH:-}"; SET="quick"; OPTIONS=""; MEMORY=""; NODE_MODULES=""; JSON=""; KEEP=no
VARIANTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --scratch) SCRATCH="${2:-}"; shift 2 ;;
    --set) SET="${2:-}"; shift 2 ;;
    --options) OPTIONS="${2:-}"; shift 2 ;;
    --variant) VARIANTS+=("${2:-}"); shift 2 ;;
    --memory) MEMORY="${2:-}"; shift 2 ;;
    --node-modules) NODE_MODULES="${2:-}"; shift 2 ;;
    --json) JSON="${2:-}"; shift 2 ;;
    --keep) KEEP=yes; shift ;;
    --*) say "unknown option $1"; usage; exit 2 ;;
    *) if [ -z "$BASE_REF" ]; then BASE_REF="$1"; elif [ -z "$HEAD_REF" ]; then HEAD_REF="$1"; else say "unexpected argument $1"; exit 2; fi; shift ;;
  esac
done
if [ -z "$BASE_REF" ] || [ -z "$HEAD_REF" ]; then usage; exit 2; fi
if [ -z "$SCRATCH" ]; then say "REFUSING: give --scratch <dir on the external SSD> (or HORSE_FLAG_OFF_SCRATCH). No default: it never guesses a place on the boot drive."; exit 2; fi
if [ ! -d "$SCRATCH" ] || [ ! -w "$SCRATCH" ]; then say "REFUSING: scratch dir $SCRATCH does not exist or is not writable"; exit 2; fi
SCRATCH=$(cd "$SCRATCH" && pwd -P)

# NEVER THE BOOT DRIVE. On macOS the scratch dir must sit on a different device from "/" and from the user's home
# (the Data volume). /Volumes/SmarterWork itself can be an internal scaffold with an external volume mounted
# inside it, so the device of the exact directory is compared, not its path. Elsewhere (a Linux runner has one
# disk) the caller's choice is taken as given.
device_of() { df -P "$1" 2>/dev/null | awk 'NR==2 {print $1}'; }
if [ "$(uname -s)" = "Darwin" ]; then
  SCRATCH_DEV=$(device_of "$SCRATCH")
  if [ -z "$SCRATCH_DEV" ] || [ "$SCRATCH_DEV" = "$(device_of /)" ] || [ "$SCRATCH_DEV" = "$(device_of "$HOME")" ]; then
    say "REFUSING: $SCRATCH is on the boot drive (${SCRATCH_DEV:-unknown device}). Use a directory on the external SSD."
    exit 2
  fi
fi

BASE_SHA=$(git -C "$REPO" rev-parse --verify "${BASE_REF}^{commit}" 2>/dev/null) || { say "REFUSING: base ref $BASE_REF is not a commit here"; exit 2; }
HEAD_SHA=$(git -C "$REPO" rev-parse --verify "${HEAD_REF}^{commit}" 2>/dev/null) || { say "REFUSING: head ref $HEAD_REF is not a commit here"; exit 2; }
[ -n "$OPTIONS" ] || OPTIONS="$REPO/docs/horse-option-switch-state.json"
[ -f "$OPTIONS" ] || { say "REFUSING: options file $OPTIONS not found"; exit 2; }
[ -n "$NODE_MODULES" ] || NODE_MODULES="$REPO/server/node_modules"
[ -d "$NODE_MODULES/tsx" ] || { say "REFUSING: $NODE_MODULES has no tsx. Give --node-modules <an installed server/node_modules>."; exit 2; }
NODE_MODULES=$(cd "$NODE_MODULES" && pwd -P)

# Both builds run on clones of ONE installed node_modules. Say so when a lockfile says they should not.
LOCK_HERE=$(git -C "$REPO" rev-parse "HEAD:server/package-lock.json" 2>/dev/null || echo unknown)
for pair in "base:$BASE_SHA" "head:$HEAD_SHA"; do
  LOCK=$(git -C "$REPO" rev-parse "${pair#*:}:server/package-lock.json" 2>/dev/null || echo missing)
  [ "$LOCK" = "$LOCK_HERE" ] || say "WARNING: the ${pair%%:*} build's server/package-lock.json differs from this checkout's; both builds still run on $NODE_MODULES"
done

RUN=$(mktemp -d "$SCRATCH/horse-flag-off.XXXXXXXX") || { say "REFUSING: could not create a folder under $SCRATCH"; exit 2; }
ADDED=()
cleanup() {
  if [ "$KEEP" = yes ]; then say "kept $RUN (remove its worktrees with: git -C $REPO worktree remove --force <dir>)"; return; fi
  for wt in ${ADDED[@]+"${ADDED[@]}"}; do git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || say "could not remove worktree $wt"; done
  # only this run's own folder, made by mktemp above
  case "$RUN" in "$SCRATCH"/horse-flag-off.*) rm -rf "$RUN" ;; esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export TMPDIR="$RUN/tmp"; mkdir -p "$TMPDIR"
for pair in "base:$BASE_SHA" "head:$HEAD_SHA"; do
  wt="$RUN/${pair%%:*}"
  git -C "$REPO" worktree add --detach "$wt" "${pair#*:}" >/dev/null 2>&1 || { say "could not create the ${pair%%:*} worktree at ${pair#*:}"; exit 2; }
  ADDED+=("$wt")
  # The tree owns its node_modules: a copy-on-write clone (APFS: no extra disk),
  # else a plain copy. Never a symlink: npm writes through one, so an npm ci in
  # this throwaway tree would empty the installed source (2026-11-26).
  cp -Rc "$NODE_MODULES" "$wt/server/node_modules" 2>/dev/null \
    || { rm -rf "$wt/server/node_modules"; cp -R "$NODE_MODULES" "$wt/server/node_modules"; } || exit 2
done

COMMON=(--options "$OPTIONS")
for v in ${VARIANTS[@]+"${VARIANTS[@]}"}; do COMMON+=(--variant "$v"); done
REPLAY=("${COMMON[@]}")
[ -z "$MEMORY" ] || REPLAY+=(--memory "$MEMORY")

say "base $BASE_SHA ($BASE_REF)"
say "head $HEAD_SHA ($HEAD_REF)"
say "node $(node --version), state set: $SET, options: $OPTIONS"
node "$TOOL" capture --build "$RUN/head" --out "$RUN/states" --set "$SET" "${COMMON[@]}" >&2 || { say "capture failed"; exit 2; }
node "$TOOL" replay --build "$RUN/head" --states "$RUN/states" --out "$RUN/replay-head" "${REPLAY[@]}" >&2 || { say "replay on head failed"; exit 2; }
node "$TOOL" replay --build "$RUN/base" --states "$RUN/states" --out "$RUN/replay-base" "${REPLAY[@]}" >&2 || { say "replay on base failed"; exit 2; }
DIFF=(--head "$RUN/replay-head" --base "$RUN/replay-base" --states "$RUN/states")
[ -z "$JSON" ] || DIFF+=(--json "$JSON")
node "$TOOL" diff "${DIFF[@]}"
exit $?
