#!/usr/bin/env python3
"""Disk space for the ops-mac heartbeat (2026-11-22).

The work and archive drives remount on this Mac as "/Volumes/SmarterWork 1"
and "/Volumes/SmarterArchives 1", while "/Volumes/SmarterWork" and
"/Volumes/SmarterArchives" stay behind as folders on the boot disk
(docs/agent-policy/OWNER-POLICY.md). statvfs() on such a folder answers for the
boot disk, so the heartbeat reported the boot disk three times - root, work and
archives all 35.2 GB / 3.8% free on 2026-11-22 23:40Z (alerts 447666-447668) -
and never measured either SSD at all.

A volume is therefore measured only at a path that is a mount point. A name
with no mounted path is reported as not mounted, with no free_pct, so the
database's under-5% check cannot read a boot-disk number as the drive's, and
heartbeat.sh raises HostVolumeNotMounted for it instead of saying nothing.
"""
import glob, json, os, re, sys

VOLUMES = {"work": "SmarterWork", "archives": "SmarterArchives"}


def measure(path):
    try:
        s = os.statvfs(path)
        tot = s.f_blocks * s.f_frsize
        free = s.f_bavail * s.f_frsize
        return {"path": path, "mounted": True,
                "free_pct": round(100 * free / tot, 2), "free_gb": round(free / 2**30, 1)}
    except Exception as e:  # unreadable is its own answer, never a number
        return {"path": path, "mounted": True, "error": str(e)[:80]}


def mounted_path(volumes_root, name):
    """The mounted path for a volume name: the exact name or a macOS remount
    suffix (" 1", " 2", ...). Never a folder that is not a mount point."""
    pat = re.compile(re.escape(name) + r"( [0-9]+)?$")
    cands = [p for p in glob.glob(os.path.join(glob.escape(volumes_root), glob.escape(name) + "*"))
             if pat.fullmatch(os.path.basename(p))]
    cands.sort(key=lambda p: (os.path.basename(p) != name, p))
    for p in cands:
        if os.path.ismount(p):
            return p, cands
    return None, cands


def volume(volumes_root, name):
    p, cands = mounted_path(volumes_root, name)
    if p:
        return measure(p)
    return {"mounted": False,
            "error": "not mounted; not a mount point: " + (", ".join(cands) if cands else "no such path")[:120]}


def report(volumes_root="/Volumes"):
    out = {"root": measure("/")}
    for key, name in VOLUMES.items():
        out[key] = volume(volumes_root, name)
    return out


if __name__ == "__main__":
    print(json.dumps(report(sys.argv[1] if len(sys.argv) > 1 else "/Volumes")))
