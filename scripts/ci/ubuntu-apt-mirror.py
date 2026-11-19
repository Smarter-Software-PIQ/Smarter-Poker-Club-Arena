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
    changed = 0
    for path in existing:
        before = path.read_text()
        after = ""
        for line in before.splitlines(keepends=True):
            active, marker, comment = line.partition("#")
            for found in CLOUD_MIRROR_URI.findall(active):
                REWRITTEN_HOSTS.add(found.split("/")[2])
            after += CLOUD_MIRROR_URI.sub("https://archive.ubuntu.com/ubuntu", active) + marker + comment
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
    hosts = ", ".join(sorted(REWRITTEN_HOSTS)) or "none (already primary)"
    print(f"Ubuntu primary HTTPS mirror: updated {count} source files; cloud mirrors replaced: {hosts}")
