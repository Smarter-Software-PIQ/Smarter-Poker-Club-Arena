"""Use Ubuntu's primary HTTPS mirror for browser dependencies on hosted CI."""
import argparse
from pathlib import Path
import re

# Any regional or cloud subdomain of the Ubuntu archive: azure.archive.ubuntu.com
# (Azure-hosted runners) and us-east-2.ec2.archive.ubuntu.com (the AWS-hosted
# runners GitHub moved to; on 2026-11-18 Post-Deploy E2E stalled at its
# 10-minute browser-install bound on that mirror in 3 of 7 failed runs while
# this script reported "updated 0 source files", because it matched Azure
# only). The primary archive.ubuntu.com, security.ubuntu.com, ports.ubuntu.com
# and look-alike paths such as /ubuntu-extra are never touched.
CLOUD_MIRROR_URI = re.compile(r"https?://(?:[a-z0-9-]+\.)+archive\.ubuntu\.com/ubuntu(?=/|\s|$)")
MIRROR_FILE = re.compile(r"mirror\+file:(/[^\s#]+)")
PRIORITY = re.compile(r"priority:(\d+)")
FALLBACK_MARK = "ca-fallback: replaced mirror, tried last"
# An idle connection fails over to the next mirror instead of holding the
# install until its job bound (apt's default idle timeout is 120 s per fetch
# and a stalled mirror can hold a whole install for tens of minutes).
BOUNDED_FETCH = 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "3";\n'


def bound_fetches(root: Path) -> bool:
    conf = root / "apt.conf.d" / "80-ca-bounded-fetch"
    if conf.is_file() and conf.read_text() == BOUNDED_FETCH:
        return False
    conf.parent.mkdir(parents=True, exist_ok=True)
    conf.write_text(BOUNDED_FETCH)
    return True


def rewrite_sources(root: Path) -> int:
    paths = [root / "sources.list"]
    parts = root / "sources.list.d"
    paths += sorted(parts.glob("*.list")) + sorted(parts.glob("*.sources"))
    existing = [path for path in paths if path.is_file()]
    if not existing:
        raise RuntimeError(f"No APT sources found under {root}")
    # Hosted Ubuntu images can select their mirrors through a local mirrorlist
    # instead of embedding the URI in ubuntu.sources. Follow only active source
    # references inside /etc/apt; never traverse outside the supplied root.
    for source in tuple(existing):
        for line in source.read_text().splitlines():
            active = line.partition("#")[0]
            for reference in MIRROR_FILE.findall(active):
                try:
                    relative = Path(reference).relative_to("/etc/apt")
                except ValueError:
                    continue
                candidate = (root / relative).resolve()
                if candidate.is_relative_to(root.resolve()) and candidate.is_file():
                    if candidate not in existing:
                        existing.append(candidate)
    mirrorlists = set(existing[len([q for q in paths if q.is_file()]):])
    changed = 0
    for path in existing:
        before = path.read_text()
        after = ""
        fallbacks = []
        for line in before.splitlines(keepends=True):
            active, marker, comment = line.partition("#")
            if FALLBACK_MARK in comment:
                after += line
                continue
            found_here = CLOUD_MIRROR_URI.findall(active)
            for found in found_here:
                REWRITTEN_HOSTS.add(found.split("/")[2])
            if found_here and path in mirrorlists:
                fallbacks.append(active.rstrip("\r\n"))
            after += CLOUD_MIRROR_URI.sub("https://archive.ubuntu.com/ubuntu", active) + marker + comment
        if fallbacks:
            # A STALLED MIRROR FAILS OVER (2026-11-19). Pinning one host only
            # moves the stall: the cloud mirrors stalled on 2026-10-26 and
            # 2026-11-18, and the primary stalled Post-Deploy E2E's browser
            # install for 20+ minutes on 2026-11-19 with every fallback line
            # naming the same primary host. The replaced cloud mirror stays
            # listed last, so apt's mirror method has a different host to try.
            top = max([int(n) for n in PRIORITY.findall(after)] or [0])
            if not after.endswith("\n"):
                after += "\n"
            for offset, entry in enumerate(fallbacks, start=1):
                entry = PRIORITY.sub(f"priority:{top + offset}", entry) if PRIORITY.search(entry) else entry
                after += f"{entry} # {FALLBACK_MARK}\n"
        if after != before:
            path.write_text(after)
            changed += 1
    return changed


REWRITTEN_HOSTS: set = set()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/etc/apt"))
    args = parser.parse_args()
    count = rewrite_sources(args.root)
    bounded = bound_fetches(args.root)
    hosts = ", ".join(sorted(REWRITTEN_HOSTS)) or "none (already primary)"
    print(f"Ubuntu primary HTTPS mirror: updated {count} source files; cloud mirrors replaced: {hosts}; "
          f"bounded fetches {'set' if bounded else 'already set'}")
