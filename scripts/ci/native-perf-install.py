#!/usr/bin/env python3
"""Closed package-plan primitives for the missing-perf repair.

No production installation entry point is admitted until the real Ubuntu
qualification supplies its reviewed signed package/hook/trigger profile.
"""
import re

VERSION = '6.8.0-147.147'
TARGETS = ('linux-tools-common', 'linux-tools-6.8.0-147', 'linux-tools-6.8.0-147-generic')
# Only runtime dependencies declared by the exact tools DEBs. These names are
# qualification candidates, NOT a production package/version/hash allowlist.
DEPENDENCIES = frozenset(('lsb-release', 'hwdata', 'pci.ids', 'usb.ids', 'libc6', 'libcap2', 'libdw1t64',
    'libelf1t64', 'liblzma5', 'libnl-3-200', 'libnl-genl-3-200', 'libnuma1',
    'libpci3', 'libpython3.12t64', 'libslang2', 'libssl3t64', 'libstdc++6',
    'libtraceevent1', 'libudev1', 'libunwind8', 'libzstd1', 'zlib1g'))
# Already-installed dependencies may satisfy the solver. Installing/replacing
# these foundational packages is outside this explicit tools repair.
CRITICAL = frozenset(('libc6', 'libssl3t64', 'libstdc++6', 'libudev1', 'liblzma5',
    'libcap2', 'zlib1g', 'libzstd1', 'lsb-release'))
PACKAGE = re.compile(r'[a-z0-9][a-z0-9+.-]*(?::amd64)?')
DEBIAN_VERSION = re.compile(r'[0-9][A-Za-z0-9.+:~\-]{0,95}')
PLAN_REFUSALS = frozenset(('package_plan_unproven', 'package_plan_refused', 'package_upgrade_or_malformed',
    'package_identity_refused', 'package_closure_refused', 'tools_version_refused',
    'package_configuration_refused', 'package_totals_refused', 'package_plan_incomplete'))


class PlanRefusal(ValueError):
    def __init__(self, reason, package, version):
        super().__init__(reason)
        self.package = package
        self.version = version


def installed_targets(installed):
    if not isinstance(installed, dict) or any(name not in TARGETS or not isinstance(version, str)
            or not DEBIAN_VERSION.fullmatch(version) for name, version in installed.items()):
        raise ValueError('package_identity_refused')
    if any(version != VERSION for version in installed.values()):
        return 'tools_version_conflict'
    if set(installed) == set(TARGETS):
        return 'tools_already_installed'
    return 'installation_needed'


def plan(raw):
    """Parse C-locale apt simulation, refusing upgrades/removals/unknown new deps."""
    if not isinstance(raw, bytes) or len(raw) > 65536:
        raise ValueError('package_plan_unproven')
    text = raw.decode('ascii')
    rows, configured, summary = {}, set(), None
    for line in text.splitlines():
        if line.startswith(('Remv ', 'Purg ', 'E:', 'W:')):
            raise ValueError('package_plan_refused')
        if line.startswith('Inst '):
            match = re.fullmatch(r'Inst (\S+) \((\S+) [^\r\n]+\)', line)
            if not match:  # Includes the [old-version] upgrade shape.
                raise ValueError('package_upgrade_or_malformed')
            name, version = match.groups()
            if not PACKAGE.fullmatch(name) or not DEBIAN_VERSION.fullmatch(version):
                raise ValueError('package_identity_refused')
            name = name.removesuffix(':amd64')
            if name in rows or name in CRITICAL or name not in set(TARGETS) | DEPENDENCIES:
                raise PlanRefusal('package_closure_refused', name, version)
            if name in TARGETS and version != VERSION:
                raise PlanRefusal('tools_version_refused', name, version)
            rows[name] = version
        elif line.startswith('Conf '):
            match = re.fullmatch(r'Conf (\S+) \((\S+) [^\r\n]+\)', line)
            if not match:
                raise ValueError('package_configuration_refused')
            name, version = match.groups()
            name = name.removesuffix(':amd64')
            if name not in rows or rows[name] != version or name in configured:
                raise ValueError('package_configuration_refused')
            configured.add(name)
        elif re.match(r'\d+ upgraded,', line):
            match = re.fullmatch(r'0 upgraded, (\d+) newly installed, 0 to remove and \d+ not upgraded\.', line)
            if not match or summary is not None:
                raise ValueError('package_totals_refused')
            summary = int(match[1])
    if summary != len(rows) or configured != set(rows) or not rows:
        raise ValueError('package_plan_incomplete')
    return rows
