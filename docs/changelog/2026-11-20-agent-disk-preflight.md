# agent-disk-preflight: a read-only free-space check for the agent volumes

On 2026-11-20 the SSD2 volume that holds `extreme-capacity` and `extreme-archive` (the shared coordination inbox
and all lane evidence) fell to 1.1 GiB free, and at about 5:52 PM Chicago SSD1 (`shared-capacity`) dropped off the
Mac entirely: its mount point stayed behind as an empty folder on the internal disk, so anything written there
would have filled the system disk, and worktrees, gates and queue tickets on it failed (coordination inbox,
23:55Z-00:07Z).

`scripts/ops/agent-disk-preflight.sh [--floor-gib N] [PATH ...]` reads `df -Pk` for each path (default: the three
agent volumes, each of which is its own mount point, so the volume itself is read, never its parent) and exits 1
with one clear line when a path is missing or unreadable ("Device not configured"), lands on the root/system disk
(`/` or `/System/Volumes/Data`: the volume is not attached), or its volume has less than the floor free (default
25 GiB, `AGENT_DISK_FLOOR_GIB`). It writes nothing.

Tests: `bash scripts/ops/tests/test-agent-disk-preflight.sh` (fake `df` on PATH, 14 cases: above/below floor, path
under a volume, empty mount point, lost device, missing path, several paths, floor flag/env, mount with a space,
usage errors, root-mount override, read-only).

It is NOT wired into `scripts/agent-push.sh`: that is shared release tooling owned by RELEASE-7; the one-line hook
was proposed to RELEASE-7 / PLO lead-2 in the coordination inbox for their decision.
