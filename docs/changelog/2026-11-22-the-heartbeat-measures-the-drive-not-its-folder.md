# The heartbeat measures the drive, not the folder it left behind (2026-11-22)

Production Alerts 447666, 447667 and 447668 (23:40Z) reported `HostDiskNearlyFull`
for root, work and archives on `ops-mac-studio`, all three at exactly 35.2 GB /
3.8% free. Three different volumes cannot share one free-space number to the
tenth of a gigabyte; they were one volume read three times.

## Cause

`operations/ops-mac/heartbeat.sh` called `statvfs()` on the fixed paths
`/Volumes/SmarterWork` and `/Volumes/SmarterArchives`. Since the 2026-11-07
remount those are boot-disk compatibility folders, and the drives are mounted at
`/Volumes/SmarterWork 1` and `/Volumes/SmarterArchives 1`
(`docs/agent-policy/OWNER-POLICY.md`). `statvfs()` on a plain folder answers for
the disk under it, so the heartbeat reported the boot disk as both SSDs and
never measured either SSD.

## Fix

- `operations/ops-mac/disk_report.py` measures a volume only at a path that is a
  mount point: the exact name or a macOS remount suffix (`" 1"`, `" 2"`, ...).
  With no mounted path it reports `mounted: false` and no `free_pct`, so the
  database's under-5% check cannot read a boot-disk number as the drive's.
- `heartbeat.sh` raises `HostVolumeNotMounted` (warning, once a day per volume)
  for an unmounted drive instead of saying nothing, and a missing or broken
  `disk_report.py` can never silence the heartbeat itself.
- `setup.sh` installs the new file.
- Pinned by `tests/ops-mac-services.test.ts` (fails on the previous code).

## What is still real

The root volume reading is genuine: the boot disk had 35.2 GB (3.8%) free at
23:40Z. Alert 447666 stays open until space is freed on the Mac; this change does
not touch it. The fix reaches the Mac on the next `operations/ops-mac/setup.sh`.
