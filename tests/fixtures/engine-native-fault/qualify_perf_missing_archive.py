#!/usr/bin/env python3
"""Draft real APT no-download boundary in ONE disposable Ubuntu24 container.

No production host package or engine is touched. This does not waive the
installer's exact production platform guard or prove its systemd lifecycle.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import signal
import time

DEADLINE = 0


def run(args, *, accepted=(0,), timeout=40, input=None):
    remaining = DEADLINE - time.monotonic()
    if remaining <= 0:
        raise RuntimeError('fixture_deadline')
    value = subprocess.run(args, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=min(timeout, remaining), check=False)
    if value.returncode not in accepted or len(value.stdout) > 262144 or len(value.stderr) > 262144:
        raise RuntimeError('fixture_command_refused')
    return value


def inventory(raw, planner):
    value = {}
    for line in raw.decode('ascii').splitlines():
        parts = line.split('\t')
        if len(parts) != 3:
            raise RuntimeError('fixture_inventory_unproven')
        name, state, version = parts
        name = name.removesuffix(':amd64')
        empty_tombstone = state == 'unknown ok not-installed' and version == ''
        if not re.fullmatch(r'[a-z0-9][a-z0-9+.-]{0,95}', name) or name in value or not empty_tombstone and not planner.DEBIAN_VERSION.fullmatch(version) or not re.fullmatch(r'(?:unknown|install|hold|deinstall|purge) (?:ok|reinstreq) (?:not-installed|config-files|half-installed|unpacked|half-configured|triggers-awaited|triggers-pending|installed)', state):
            raise RuntimeError('fixture_inventory_unproven')
        value[name] = state, None if empty_tombstone else version
    if not value:
        raise RuntimeError('fixture_inventory_unproven')
    return value


def main():
    global DEADLINE
    parser = argparse.ArgumentParser()
    parser.add_argument('--deb', required=True, type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--hwdata-deb', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    started = time.monotonic()
    DEADLINE = started + 230
    result = {'schema': 'native-perf-missing-archive-qualification/v1', 'qualified': False,
        'productionPlatformQualified': False, 'productionInstallationQualified': False,
        'reason': 'fixture_unproven', 'cleanupConfirmed': False}
    container = None
    def expired(signum, frame):
        raise RuntimeError('fixture_deadline')
    signal.signal(signal.SIGALRM, expired)
    signal.signal(signal.SIGTERM, expired)
    signal.alarm(230)
    try:
        if not re.fullmatch(r'[0-9a-f]{64}', args.sha256) or args.deb.is_symlink() or not args.deb.is_file() or not 0 < args.deb.stat().st_size <= 1024 * 1024 or hashlib.sha256(args.deb.read_bytes()).hexdigest() != args.sha256:
            raise RuntimeError('fixture_public_deb_refused')
        fields = run(['dpkg-deb', '--field', str(args.deb), 'Package', 'Version', 'Architecture']).stdout.decode()
        if dict(line.split(': ', 1) for line in fields.splitlines()) != {
                'Package': 'linux-tools-common', 'Version': '6.8.0-147.147', 'Architecture': 'all'}:
            raise RuntimeError('fixture_public_deb_refused')
        qualification_spec = importlib.util.spec_from_file_location('package_qualification', Path(__file__).resolve().parents[3] / 'tests/fixtures/engine-native-fault/qualify_perf_packages.py')
        qualification = importlib.util.module_from_spec(qualification_spec); qualification_spec.loader.exec_module(qualification)
        hwdata = qualification.HWDATA
        if args.hwdata_deb.is_symlink() or not args.hwdata_deb.is_file() or args.hwdata_deb.stat().st_size != hwdata['bytes'] or hashlib.sha256(args.hwdata_deb.read_bytes()).hexdigest() != hwdata['sha256']:
            raise RuntimeError('fixture_public_deb_refused')
        # A public Docker source is bound to its actual immutable image identity
        # before the container is created. No existing named container is used.
        run(['docker', 'pull', 'ubuntu:24.04'], timeout=60)
        image = run(['docker', 'image', 'inspect', '--format={{.Id}}', 'ubuntu:24.04']).stdout.decode().strip()
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
            raise RuntimeError('fixture_image_identity_refused')
        container = run(['docker', 'run', '--rm', '--detach', '--memory=512m', '--pids-limit=64',
            '--label=club-arena-qualification=native-perf-missing-archive', image,
            '/bin/sh', '-c', 'exec sleep 240']).stdout.decode().strip()
        if not re.fullmatch(r'[0-9a-f]{64}', container):
            raise RuntimeError('fixture_container_identity_refused')
        observed = run(['docker', 'inspect', '--format={{.Image}}', container]).stdout.decode().strip()
        if observed != image:
            raise RuntimeError('fixture_container_identity_refused')
        run(['docker', 'exec', container, 'mkdir', '-m', '0700', '/owned'])
        run(['docker', 'cp', str(args.deb), container + ':/owned/tools-common.deb'])
        # Signed repository metadata only, not an install or upgrade. This
        # disposable image has its original package state and normal hooks.
        run(['docker', 'exec', '-e', 'LC_ALL=C', container, 'apt-get',
            '-o', 'APT::Get::AllowUnauthenticated=false',
            '-o', 'Acquire::AllowInsecureRepositories=false', 'update'], timeout=90)
        before = run(['docker', 'exec', container, 'sha256sum', '/var/lib/dpkg/status']).stdout.split()[0]
        plan = run(['docker', 'exec', '-e', 'LC_ALL=C', container, 'apt-get', '--simulate',
            '--no-install-recommends', '--no-upgrade', '--no-remove', 'install', '/owned/tools-common.deb']).stdout
        missing = set(re.findall(rb'^Inst ([a-z0-9+.-]+) ', plan, re.M)) - {b'linux-tools-common'}
        if not missing or not missing <= {b'hwdata', b'lsb-release', b'pci.ids', b'usb.ids'}:
            raise RuntimeError('fixture_expected_missing_dependency_unproven')
        run(['docker', 'exec', container, 'mkdir', '-p', '/owned/cache/partial'])
        # Supply the reviewed target itself. ONLY its unexpected runtime
        # dependencies remain missing, matching the production cache contract.
        cached = '/owned/cache/linux-tools-common_6.8.0-147.147_all.deb'
        run(['docker', 'cp', str(args.deb), container + ':' + cached])
        observed = run(['docker', 'exec', container, 'sha256sum', cached]).stdout.split()[0].decode()
        if observed != args.sha256:
            raise RuntimeError('fixture_public_deb_refused')
        spec = importlib.util.spec_from_file_location('installer_arguments', Path(__file__).resolve().parents[3] / 'scripts/ci/native-perf-install-controller.py')
        helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
        install = run(['docker', 'exec', '-e', 'LC_ALL=C', '-e', 'NEEDRESTART_MODE=l',
            '-e', 'DEBIAN_FRONTEND=noninteractive', container, *helper.apt_arguments('/owned/cache'), '-y',
            # Appends an observation marker; canonical hooks are not suppressed.
            '-o', 'DPkg::Pre-Invoke::=/usr/bin/touch /owned/dpkg-invoked',
            'install', cached], accepted=(100,))
        after = run(['docker', 'exec', container, 'sha256sum', '/var/lib/dpkg/status']).stdout.split()[0]
        marker = run(['docker', 'exec', container, 'test', '!', '-e', '/owned/dpkg-invoked']).returncode
        if before != after or marker != 0:
            raise RuntimeError('fixture_dpkg_boundary_failed')
        # Necessary fresh hwdata package proof in THIS disposable Ubuntu,
        # after preserving the original missing-archive/no-dpkg boundary.
        run(['docker', 'cp', str(args.hwdata_deb), container + ':/owned/hwdata.deb'])
        if run(['docker', 'exec', container, 'sha256sum', '/owned/hwdata.deb']).stdout.split()[0].decode() != hwdata['sha256']:
            raise RuntimeError('fixture_public_deb_refused')
        absent = run(['docker', 'exec', '-e', 'LC_ALL=C', container, 'dpkg-query', '--show',
            '--showformat=${Status}\t${Version}', 'hwdata'], accepted=(0, 1))
        if not qualification.explicit_uninstalled('hwdata', absent.returncode, absent.stdout, absent.stderr):
            raise RuntimeError('fixture_hwdata_not_fresh')
        inventory_command = ['docker', 'exec', '-e', 'LC_ALL=C', container, 'dpkg-query', '--show',
            '--showformat=${binary:Package}\t${Status}\t${Version}\n']
        inventory_before = inventory(run(inventory_command).stdout, qualification.helper)
        apt = ['docker', 'exec', '-e', 'LC_ALL=C', '-e', 'NEEDRESTART_MODE=l',
            '-e', 'DEBIAN_FRONTEND=noninteractive', container, '/usr/bin/apt-get',
            *qualification.APT_AUTH, '--no-upgrade', '--no-remove', '--no-install-recommends']
        fresh_plan = qualification.helper.plan(run([*apt, '--simulate', 'install', '/owned/hwdata.deb']).stdout)
        if fresh_plan.get('hwdata') != hwdata['version'] or not set(fresh_plan) <= {'hwdata', 'pci.ids', 'usb.ids'}:
            raise RuntimeError('fixture_hwdata_closure_refused')
        run([*apt, '-y', 'install', '/owned/hwdata.deb'], timeout=60)
        inventory_after = inventory(run(inventory_command).stdout, qualification.helper)
        expected_inventory = {**inventory_before, **{name: ('install ok installed', version) for name, version in fresh_plan.items()}}
        if inventory_after != expected_inventory or run(['docker', 'exec', container, 'dpkg', '--audit']).stdout:
            raise RuntimeError('fixture_hwdata_install_unproven')
        result.update(hwdataFreshInstallVerified=True, hwdataSHA256=hwdata['sha256'],
            hwdataVersion=hwdata['version'], normalAptHooksPreserved=True,
            noUpgradesOrRemovals=True, installedDependencyVersions=fresh_plan,
            combinedRecoveryTransactionQualified=False)
        result.update(qualified=True, reason='missing_private_archive_refused_before_dpkg',
            aptExitCode=install.returncode, packageStateUnchanged=True, dpkgInvocationMarkerAbsent=True,
            missingDependencyCount=len(missing), imageSHA256=image.removeprefix('sha256:'),
            publicDebSHA256=args.sha256)
    except Exception as error:
        code = str(error)
        known = {'fixture_deadline', 'fixture_command_refused', 'fixture_public_deb_refused',
            'fixture_image_identity_refused', 'fixture_container_identity_refused',
            'fixture_expected_missing_dependency_unproven', 'fixture_dpkg_boundary_failed',
            'fixture_hwdata_not_fresh', 'fixture_hwdata_closure_refused', 'fixture_hwdata_install_unproven',
            'fixture_inventory_unproven'}
        result['reason'] = code if code in known else 'fixture_unproven'
    finally:
        signal.alarm(0)
        DEADLINE = started + 240  # Existing outer budget reserves10s cleanup.
        if container is not None:
            try:
                run(['docker', 'rm', '--force', container], accepted=(0, 1), timeout=5)
                absent = run(['docker', 'inspect', container], accepted=(1,), timeout=3)
                result['cleanupConfirmed'] = absent.returncode == 1
            except Exception:
                result['cleanupConfirmed'] = False
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, separators=(',', ':')))
    if not result['qualified'] or not result['cleanupConfirmed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
