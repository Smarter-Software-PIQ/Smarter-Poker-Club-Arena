#!/usr/bin/env python3
"""Fail fast when the archive no longer serves a version the fixture Dockerfile pins.

Debian's main archive keeps only the current point release of a package, so an
exact pin such as postgresql-17=17.11-0+deb13u1 stops resolving the day Debian
publishes the next point release. Without this check the native fixture spends
its dependency and image build before apt reports "Version ... was not found".

Reads every `deb <url> <suite> <component>` source and every exact
`package=version` pin from operations/release/fixture/Dockerfile, downloads the
amd64 Packages index of each source once, and exits 1 naming each pin that no
source serves, with the versions it does serve. Read-only; no retries beyond
the request timeout. An optional argument names another Dockerfile to check.
"""
import lzma
import re
import sys
import urllib.request
from pathlib import Path

DOCKERFILE = Path(__file__).resolve().with_name('Dockerfile')
SOURCE = re.compile(r"'deb (https://\S+) (\S+) (\S+)'")
PIN = re.compile(r'(?<![\w.+-])([a-z0-9][a-z0-9.+-]*)=([0-9][A-Za-z0-9.+~:-]*)(?=\s|$)')


def installs(text):
    """One logical `apt-get install` command per entry, continuations joined."""
    joined = text.replace('\\\n', ' ')
    out = []
    for line in joined.split('\n'):
        for part in line.split('&&'):
            if 'apt-get install' in part:
                out.append(part)
    return out


def pins(text):
    found = {}
    for command in installs(text):
        for package, version in PIN.findall(command):
            found.setdefault(package, set()).add(version)
    return found


def sources(text):
    return [(url.rstrip('/'), suite, component) for url, suite, component in SOURCE.findall(text)]


def index_url(url, suite, component):
    return f'{url}/dists/{suite}/{component}/binary-amd64/Packages.xz'


def served(packages_text):
    available = {}
    for stanza in packages_text.split('\n\n'):
        fields = dict(
            line.split(': ', 1) for line in stanza.splitlines() if ': ' in line and not line[0].isspace()
        )
        if 'Package' in fields and 'Version' in fields:
            available.setdefault(fields['Package'], set()).add(fields['Version'])
    return available


def missing(pinned, available):
    return [
        (package, version, sorted(available.get(package, ())))
        for package in sorted(pinned)
        for version in sorted(pinned[package])
        if version not in available.get(package, ())
    ]


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'fixture-debian-pins'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return lzma.decompress(response.read()).decode('utf-8', 'replace')


def main(argv):
    text = Path(argv[0] if argv else DOCKERFILE).read_text()
    pinned, repos = pins(text), sources(text)
    if not pinned or not repos:
        print('debian-pins: found no exact apt pins or no Debian sources in the Dockerfile', file=sys.stderr)
        return 2
    available = {}
    for repo in repos:
        url = index_url(*repo)
        for package, versions in served(fetch(url)).items():
            available.setdefault(package, set()).update(versions)
        print(f'debian-pins: read {url}')
    gaps = missing(pinned, available)
    for package, version, offered in gaps:
        print(
            f'debian-pins: {package}={version} is not served by the Dockerfile sources '
            f'(they serve: {", ".join(offered) or "nothing"}). Debian keeps only the current '
            'point release: re-pin every stage of operations/release/fixture/Dockerfile together.',
            file=sys.stderr,
        )
    if gaps:
        return 1
    count = sum(len(v) for v in pinned.values())
    print(f'debian-pins: all {count} exact pins are served')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
