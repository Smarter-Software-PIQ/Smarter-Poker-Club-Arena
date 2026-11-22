#!/bin/bash
# agent-disk-preflight.sh: read-only free-space check for the agent work volumes, run before heavy work or a push.
#
#   scripts/ops/agent-disk-preflight.sh [--floor-gib N] [PATH ...]
#
# With no PATH it checks the three shared agent volumes (each path IS a mount point, so its own volume is read,
# never the parent's):
#   /Volumes/SmarterWork/agent-work/shared-capacity
#   /Volumes/SmarterWork/agent-work/extreme-capacity
#   /Volumes/SmarterArchives/agent-evidence/extreme-archive
# A PATH below a volume (a worktree, an evidence folder) is checked on the volume that holds it.
#
# One line per path: "OK" or "FAIL", free GiB, the mount point it sits on, the floor. Exit status:
#   0  every path is on a mounted external volume with at least the floor free
#   1  a path is missing or unreadable (e.g. "Device not configured"), sits on the root/system disk (an empty mount
#      point: the volume is not attached, as SSD1 on 2026-11-20 ~5:52 PM Chicago), or its volume is below the floor
#   2  usage error
# Floor: --floor-gib N, else AGENT_DISK_FLOOR_GIB, else 25 (GiB). Whole GiB only.
# Root/system mount points (a path landing on one means its own volume is absent): AGENT_DISK_ROOT_MOUNTS,
# colon-separated, default "/:/System/Volumes/Data".
# It writes nothing and changes nothing.
set -uo pipefail

floor="${AGENT_DISK_FLOOR_GIB:-25}"
paths=()
while [ $# -gt 0 ]; do
  case "$1" in
    --floor-gib) [ $# -ge 2 ] || { echo "agent-disk-preflight: --floor-gib needs a value" >&2; exit 2; }; floor="$2"; shift 2 ;;
    --floor-gib=*) floor="${1#--floor-gib=}"; shift ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; paths+=("$@"); break ;;
    -*) echo "agent-disk-preflight: unknown option $1" >&2; exit 2 ;;
    *) paths+=("$1"); shift ;;
  esac
done
case "$floor" in ''|*[!0-9]*) echo "agent-disk-preflight: floor must be a whole number of GiB, got '$floor'" >&2; exit 2 ;; esac
if [ ${#paths[@]} -eq 0 ]; then
  paths=(/Volumes/SmarterWork/agent-work/shared-capacity
         /Volumes/SmarterWork/agent-work/extreme-capacity
         /Volumes/SmarterArchives/agent-evidence/extreme-archive)
fi
root_mounts="${AGENT_DISK_ROOT_MOUNTS:-/:/System/Volumes/Data}"
floor_kib=$((floor * 1024 * 1024))
rc=0

for p in "${paths[@]}"; do
  if [ ! -e "$p" ]; then
    echo "FAIL $p: path does not exist (volume not attached or wrong path)"; rc=1; continue
  fi
  # df -P: one POSIX line per filesystem; -k: 1024-byte blocks. Mount point is field 6 onward (may hold spaces).
  if ! out=$(df -Pk "$p" 2>&1); then
    echo "FAIL $p: df could not read it ($(printf '%s' "$out" | tail -n 1))"; rc=1; continue
  fi
  line=$(printf '%s\n' "$out" | sed -n '2p')
  avail_kib=$(printf '%s\n' "$line" | awk '{print $4}')
  mnt=$(printf '%s\n' "$line" | awk '{for (i = 6; i <= NF; i++) printf "%s%s", $i, (i < NF ? " " : "")}')
  case "$avail_kib" in ''|*[!0-9]*) echo "FAIL $p: df output not understood: $line"; rc=1; continue ;; esac
  free_gib=$(awk -v k="$avail_kib" 'BEGIN { printf "%.1f", k / 1048576 }')
  on_root=0
  IFS=: read -r -a roots <<< "$root_mounts"
  for r in "${roots[@]}"; do [ -n "$r" ] && [ "$mnt" = "$r" ] && on_root=1; done
  if [ $on_root = 1 ]; then
    echo "FAIL $p: not on its own volume (it sits on the system disk at '$mnt', ${free_gib} GiB free there): the volume is not mounted; writing here fills the internal disk"
    rc=1
  elif [ "$avail_kib" -lt "$floor_kib" ]; then
    echo "FAIL $p: ${free_gib} GiB free on '$mnt', below the ${floor} GiB floor: free space before heavy work or a push"
    rc=1
  else
    echo "OK   $p: ${free_gib} GiB free on '$mnt' (floor ${floor} GiB)"
  fi
done
exit $rc
