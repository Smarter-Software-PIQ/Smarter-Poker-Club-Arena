"""Point a hosted runner's Ubuntu sources at a multi-host fallback mirror list.

Called through scripts/ci/ubuntu-apt.sh, the one entry point for Ubuntu package
installs in CI. The extra hosts come from scripts/ci/ubuntu-apt-mirrors.txt, the
one mirror list the native qualification image also builds from.
"""
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
SHARED_MARK = "ca-shared: scripts/ci/ubuntu-apt-mirrors.txt"
SHARED_LIST = Path(__file__).resolve().with_name("ubuntu-apt-mirrors.txt")
SHARED_URI = re.compile(r"https?://[a-z0-9.-]+/ubuntu/?")
HOST = re.compile(r"https?://([^/\s]+)")
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


def shared_mirrors(path: Path) -> list:
    """The active URIs of the one shared list, in order. Fails closed: a missing
    or empty list must never quietly leave a runner on one host."""
    uris = []
    for line in path.read_text().splitlines():
        active = line.partition("#")[0].strip()
        if not active:
            continue
        if not SHARED_URI.fullmatch(active):
            raise RuntimeError(f"Unsupported shared mirror entry in {path}: {active}")
        uris.append(active)
    if len(uris) < 2:
        raise RuntimeError(f"The shared mirror list {path} must name at least two hosts")
    return uris


def _active_host(line: str):
    found = HOST.search(line.partition("#")[0])
    return found.group(1) if found else None


def mirror_lists(root: Path) -> list:
    """Every apt mirrorlist file an active source names, inside root."""
    paths = [root / "sources.list"]
    parts = root / "sources.list.d"
    paths += sorted(parts.glob("*.list")) + sorted(parts.glob("*.sources"))
    found = []
    for source in (path for path in paths if path.is_file()):
        for line in source.read_text().splitlines():
            for reference in MIRROR_FILE.findall(line.partition("#")[0]):
                try:
                    relative = Path(reference).relative_to("/etc/apt")
                except ValueError:
                    continue
                candidate = (root / relative).resolve()
                if candidate.is_relative_to(root.resolve()) and candidate.is_file() and candidate not in found:
                    found.append(candidate)
    return found


def rotate_mirrors(root: Path) -> list:
    """Move the host apt tries first to the back of every referenced mirrorlist,
    so a retried install starts on a different mirror. Returns the new first
    host of each rotated list."""
    firsts = []
    for path in mirror_lists(root):
        lines = path.read_text().splitlines(keepends=True)
        active = [i for i, line in enumerate(lines) if _active_host(line)]
        if len(active) < 2:
            continue
        weights = {i: PRIORITY.search(lines[i].partition("#")[0]) for i in active}
        if all(weights.values()):
            ranked = sorted(active, key=lambda i: int(weights[i].group(1)))
            first, top = ranked[0], max(int(w.group(1)) for w in weights.values())
            lines[first] = PRIORITY.sub(f"priority:{top + 1}", lines[first], count=1)
            firsts.append(_active_host(lines[ranked[1]]))
        else:
            first = lines.pop(active[0])
            if not first.endswith("\n"):
                first += "\n"
            if lines and not lines[-1].endswith("\n"):
                lines[-1] += "\n"
            lines.append(first)
            firsts.append(_active_host(lines[active[1] - 1]))
        path.write_text("".join(lines))
    return firsts


def rewrite_sources(root: Path, shared: list = ()) -> int:
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
            if FALLBACK_MARK in comment or SHARED_MARK in comment:
                after += line
                continue
            found_here = CLOUD_MIRROR_URI.findall(active)
            for found in found_here:
                REWRITTEN_HOSTS.add(found.split("/")[2])
            if found_here and path in mirrorlists:
                fallbacks.append(active.rstrip("\r\n"))
            after += CLOUD_MIRROR_URI.sub("https://archive.ubuntu.com/ubuntu", active) + marker + comment
        extras = []
        if path in mirrorlists and shared:
            # THE SHARED LIST BACKS EVERY MIRRORLIST (2026-11-19). The runner's
            # own list names one or two hosts; the hosts of
            # scripts/ci/ubuntu-apt-mirrors.txt it does not already name follow
            # them, before the replaced cloud mirror.
            present = {_active_host(line) for line in after.splitlines()} | {
                _active_host(entry) for entry in fallbacks
            }
            extras = [uri for uri in shared if _active_host(uri) not in present]
        if extras:
            top = max([int(n) for n in PRIORITY.findall(after)] or [0])
            weighted = bool(PRIORITY.search(after))
            if after and not after.endswith("\n"):
                after += "\n"
            for offset, uri in enumerate(extras, start=1):
                entry = f"{uri}\tpriority:{top + offset}" if weighted else uri
                after += f"{entry} # {SHARED_MARK}\n"
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
    parser.add_argument("--mirrors", type=Path, default=SHARED_LIST,
                        help="the one shared mirror list (default: scripts/ci/ubuntu-apt-mirrors.txt)")
    parser.add_argument("--rotate", action="store_true",
                        help="move the first-tried host of every mirrorlist to the back")
    args = parser.parse_args()
    if args.rotate:
        rotated = rotate_mirrors(args.root)
        print("Ubuntu mirror rotated; now first: " + (", ".join(rotated) or "no multi-host mirrorlist"))
        raise SystemExit(0)
    count = rewrite_sources(args.root, shared_mirrors(args.mirrors))
    bounded = bound_fetches(args.root)
    hosts = ", ".join(sorted(REWRITTEN_HOSTS)) or "none (already primary)"
    print(f"Ubuntu primary HTTPS mirror: updated {count} source files; cloud mirrors replaced: {hosts}; "
          f"bounded fetches {'set' if bounded else 'already set'}")
