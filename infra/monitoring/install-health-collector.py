#!/usr/bin/env python3
"""Install the authenticated monitoring payload into the existing collector slot.

The owning deploy.sh validates the complete protected-main payload and its
compare-and-swap receipt first. This changes no unit, cadence or engine control.
"""
import argparse
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import time


def install(source, destination, lock_path, expected_current, lock_timeout=20):
    if len(expected_current) != 64 or any(c not in "0123456789abcdef" for c in expected_current):
        raise RuntimeError("collector predecessor must be one sha256")
    source, destination, lock_path = map(Path, (source, destination, lock_path))
    if source.is_symlink() or not source.is_file():
        raise RuntimeError("collector source must be a regular payload file")
    if destination.is_symlink() or not destination.is_file():
        raise RuntimeError("existing stable collector must be a regular file")
    candidate = source.read_bytes()
    subprocess.run(["bash", "-n", str(source)], check=True, capture_output=True)
    # Reuse the exact engine-control source lock; do not compete with its writer.
    with lock_path.open("a") as lock:
        deadline = time.monotonic() + lock_timeout
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("engine source writer is busy; nothing installed")
                time.sleep(min(0.05, max(0, deadline - time.monotonic())))
        current = hashlib.sha256(destination.read_bytes()).hexdigest()
        desired = hashlib.sha256(candidate).hexdigest()
        if current not in (expected_current, desired):
            raise RuntimeError("stable collector advanced after authorization; nothing installed")
        subprocess.run(["systemctl", "is-active", "--quiet", "club-arena-money-health.timer"], check=True)
        def property_value(name):
            return subprocess.check_output(
                ["systemctl", "show", "club-arena-money-health.service", f"--property={name}", "--value"],
                text=True,
            ).strip()
        if property_value("Type") != "oneshot":
            raise RuntimeError("existing health collector is not a oneshot")
        command = property_value("ExecStart")
        if f"argv[]=/bin/bash {destination} ;" not in command:
            raise RuntimeError("existing health service does not use the stable collector")
        staged = None
        try:
            with tempfile.NamedTemporaryFile(prefix=".monitoring-health-", dir=destination.parent, delete=False) as out:
                staged = Path(out.name)
                out.write(candidate)
                os.fchmod(out.fileno(), 0o755)
                out.flush()
                os.fsync(out.fileno())
            os.replace(staged, destination)
            staged = None
            directory = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            if destination.read_bytes() != candidate:
                raise RuntimeError("installed collector differs from the authenticated payload")
        finally:
            if staged is not None:
                staged.unlink(missing_ok=True)
    return hashlib.sha256(candidate).hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--destination", default="/usr/local/lib/club-arena/collect-monitoring-health.sh")
    parser.add_argument("--source-lock", default="/var/lock/club-arena-source.lock")
    parser.add_argument("--expected-current", required=True)
    args = parser.parse_args()
    print("Installed existing read-only health collector sha256=" + install(args.source, args.destination, args.source_lock, args.expected_current))
