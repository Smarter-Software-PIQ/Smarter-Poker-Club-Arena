#!/usr/bin/env python3
"""Real Linux/systemd/cgroup-v2 qualification in the disposable provider VM."""
import argparse
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import stat
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('failed_routine_native', ROOT / 'server/scripts/engine-release-seal.py')
seal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seal)


def run(arguments, *, check=True):
    return subprocess.run(arguments, capture_output=True, text=True, timeout=10, check=check).stdout.strip()


def deadline():
    return time.monotonic() + 8


def fixture_manager_row(unit, until):
    raw = seal.failed_routine_command(['busctl', '--system', '--timeout=1s', 'call',
        'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
        'ListUnitsByPatterns', 'asas', '0', '1', unit], until, 4096)
    fields = shlex.split(raw)
    assert len(fields) >= 2 and fields[0] == 'a(ssssssouso)'
    if fields[1] == '0':
        assert len(fields) == 2
        return None
    assert fields[1] == '1' and len(fields) == 12 and fields[2] == unit
    assert fields[4] == 'loaded' and fields[5] in {'active', 'inactive', 'failed'}
    assert fields[6] in {'active', 'dead', 'failed'} and fields[7] == ''
    assert seal.re.fullmatch(r'/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+', fields[8])
    assert fields[9:] == ['0', '', '/']  # No queued foreign job may be stopped.
    return {'activeState': fields[5], 'subState': fields[6]}


def await_unloaded(unit):
    until = deadline()
    while time.monotonic() < until:
        if fixture_manager_row(unit, until) is None:
            return
        time.sleep(.05)
    raise AssertionError('Owned fixture did not naturally unload before its finite deadline')


def genuine_lookup_refusal(unit):
    try:
        seal.failed_routine_command(['busctl', '--system', '--timeout=1s', 'call',
            'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
            'GetUnit', 's', unit], deadline(), 4096)
    except seal.FailedRoutineProcessLookup as error:
        assert error.status > 0 and error.stdout == b''
        assert error.stderr.strip() == ('Call failed: Unit ' + unit + ' not loaded.').encode()
        return
    raise AssertionError('Real GetUnit did not exercise the unloaded native fallback')


def owned_group_state(path, owned):
    """Only an exact fixture-owned path; unreadable never means absent."""
    assert path in owned and path != Path('/sys/fs/cgroup/system.slice')
    try:
        info = path.lstat()
        assert stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and path.resolve(strict=True) == path
        directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            descriptor = os.open('cgroup.events', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                raw = os.read(descriptor, 1025)
            finally:
                os.close(descriptor)
        finally:
            os.close(directory)
    except FileNotFoundError as error:
        assert error.errno == errno.ENOENT
        try:
            path.lstat()
        except FileNotFoundError as confirmed:
            assert confirmed.errno == errno.ENOENT
            return 'absent'
        raise AssertionError('Owned cgroup remains but its kernel evidence is missing')
    assert len(raw) <= 1024
    rows = [line.split() for line in raw.decode('ascii').splitlines()]
    assert all(len(row) == 2 for row in rows)
    values = dict(rows)
    assert len(values) == len(rows) and values.get('populated') == '0'
    return 'empty'


def retire_owned_group(path, owned):
    if owned_group_state(path, owned) == 'absent':
        return
    try:
        path.rmdir()  # Nonempty/permission/foreign-child refusals stay failures.
    except FileNotFoundError as error:
        assert error.errno == errno.ENOENT
    assert owned_group_state(path, owned) == 'absent'


def retire_fixture_unit(unit, group, owned_groups, owned_units):
    assert unit in owned_units and group in owned_groups
    owned_group_state(group, owned_groups)
    row = fixture_manager_row(unit, deadline())
    if row is None:
        # Already-unloaded is established by two successful typed manager reads
        # plus kernel evidence, never by a failed stop or lookup command.
        assert fixture_manager_row(unit, deadline()) is None
        owned_group_state(group, owned_groups)
        return 'already-absent'
    if unit.endswith('.service'):
        assert row['activeState'] in {'inactive', 'failed'}
    run(['systemctl', 'stop', unit])  # Any unexpected nonzero still fails.
    after = fixture_manager_row(unit, deadline())
    if after is not None and after['activeState'] == 'failed':
        run(['systemctl', 'reset-failed', unit])
    await_unloaded(unit)
    owned_group_state(group, owned_groups)
    return 'stopped-owned-empty-unit'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-linux', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'linux':
        if args.require_linux:
            raise AssertionError('Native qualification requires actual Linux')
        print('SKIP: Linux systemd/cgroup fixture unavailable; no native certificate')
        return
    assert os.geteuid() == 0
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'Linux'
    assert Path(os.environ['GITHUB_WORKSPACE']).resolve() == ROOT.resolve()
    assert Path('/proc/1/comm').read_text().strip() == 'systemd'
    os.environ['PATH'] = '/usr/sbin:/usr/bin:/sbin:/bin'
    version = run(['systemctl', 'show', '--property=Version'])
    prefix = 'failed-routine-native-' + uuid.uuid4().hex[:16]
    unit = prefix + '@41349091113-1.service'
    template = Path('/etc/systemd/system') / (prefix + '@.service')
    slice_name = 'system-' + prefix.replace('-', r'\x2d') + '.slice'
    slice_group = Path('/sys/fs/cgroup/system.slice') / slice_name
    target_group = slice_group / unit
    owned_cgroups = (slice_group, target_group)
    owned_units = (unit, slice_name)
    content = '[Unit]\nDescription=Isolated failed routine native proof\n[Service]\nType=oneshot\nExecStart=/bin/true\n'
    group = None
    template_created = False
    passed = False
    receipt = {'schema': 'failed-routine-native-custody/v1', 'status': 'failed',
        'productCertificate': False, 'systemdVersion': version, 'fixtureUnit': unit,
        'sourceRevision': run(['git', '-c', 'safe.directory='+str(ROOT), '-C', str(ROOT), 'rev-parse', 'HEAD']),
        'sealSourceSha256': hashlib.sha256((ROOT / 'server/scripts/engine-release-seal.py').read_bytes()).hexdigest(),
        'cases': {}, 'cleanup': {}}
    try:
        # Never replace an existing template or use a real release unit name.
        with template.open('x') as handle:
            handle.write(content)
        template_created = True
        template.chmod(0o644)
        run(['systemctl', 'daemon-reload'])
        # Bind both cleanup paths before starting the fixture. The slice may
        # be created by systemd, not by the explicit empty-cgroup case below.
        before = seal.failed_routine_unit_snapshot(unit, deadline())
        group = seal.failed_routine_service_group(unit, before, deadline())
        assert Path('/sys/fs/cgroup') / group.lstrip('/') == target_group
        run(['systemctl', 'start', unit])
        before = seal.failed_routine_unit_snapshot(unit, deadline())
        group = seal.failed_routine_service_group(unit, before, deadline())
        await_unloaded(unit)
        genuine_lookup_refusal(unit)
        route = seal.failed_routine_service_empty(unit, before, deadline())
        assert route == 'unloaded-manager-cgroup-empty'
        receipt['cases']['naturalUnloadedFallback'] = {'passed': True, 'route': route,
            'realGetUnitNonzero': True, 'nativeMetadataUnchanged': True}

        # Qualify both real kernel outcomes at this exact source-derived path.
        # These are only this fixture's empty cgroups, never production groups.
        target = Path('/sys/fs/cgroup') / group.lstrip('/')
        before = seal.failed_routine_unit_snapshot(unit, deadline())
        await_unloaded(unit)
        if target.exists():
            assert seal.failed_routine_cgroup_empty(group, deadline()) == 'populated-zero'
            target.rmdir()
        assert seal.failed_routine_cgroup_empty(group, deadline()) == 'absent'
        genuine_lookup_refusal(unit)
        assert seal.failed_routine_service_empty(unit, before, deadline()) == 'unloaded-manager-cgroup-empty'
        receipt['cases']['genuineKernelEnoent'] = {'passed': True, 'route': 'unloaded-manager-cgroup-empty'}

        before = seal.failed_routine_unit_snapshot(unit, deadline())
        await_unloaded(unit)
        assert target.parent.parent == Path('/sys/fs/cgroup/system.slice')
        if not target.parent.exists():
            target.parent.mkdir()
        target.mkdir()
        assert seal.failed_routine_cgroup_empty(group, deadline()) == 'populated-zero'
        genuine_lookup_refusal(unit)
        assert seal.failed_routine_service_empty(unit, before, deadline()) == 'unloaded-manager-cgroup-empty'
        receipt['cases']['realKernelPopulatedZero'] = {'passed': True, 'route': 'unloaded-manager-cgroup-empty'}
        passed = True
    except BaseException as error:
        receipt['failureType'] = type(error).__name__
        raise
    finally:
        cleanup_ok = True
        if template_created:
            try:
                service_cleanup = retire_fixture_unit(unit, target_group, owned_cgroups, owned_units)
                assert not template.is_symlink() and template.read_text() == content
                template.unlink()
                run(['systemctl', 'daemon-reload'])
                await_unloaded(unit)
                receipt['cleanup']['unitAbsent'] = True
                receipt['serviceCleanupRoute'] = service_cleanup
                receipt['cleanup']['templateAbsent'] = not template.exists()
                # Only this unique, kernel-proven-empty fixture slice may be
                # stopped. Never stop or remove the shared system.slice.
                owned_group_state(target_group, owned_cgroups)
                retire_owned_group(target_group, owned_cgroups)
                if owned_group_state(slice_group, owned_cgroups) != 'absent':
                    # Never ask systemd to stop a slice containing an
                    # unexpected descendant, even if that descendant is empty.
                    assert not any(stat.S_ISDIR(item.lstat().st_mode) for item in slice_group.iterdir())
                slice_cleanup = retire_fixture_unit(slice_name, slice_group, owned_cgroups, owned_units)
                await_unloaded(slice_name)
                retire_owned_group(slice_group, owned_cgroups)
                assert retire_fixture_unit(slice_name, slice_group, owned_cgroups, owned_units) == 'already-absent'
                receipt['cases']['realAlreadyAbsentCleanup'] = {'passed': True, 'typedManagerEmptyTwice': True, 'ownedKernelAbsent': True}
                receipt['sliceCleanupRoute'] = slice_cleanup
                receipt['cleanup']['sliceUnitAbsent'] = True
                receipt['cleanup']['ownedCgroupsAbsent'] = all(owned_group_state(item, owned_cgroups) == 'absent' for item in owned_cgroups)
            except BaseException as error:
                cleanup_ok = False
                receipt['cleanup']['failureType'] = type(error).__name__
        receipt['status'] = 'passed' if passed and cleanup_ok and all(receipt['cleanup'].values()) else 'failed'
        out = ROOT / 'work/engine-build-resource-proof'
        assert out.is_dir() and out.resolve() == out
        destination = out / 'failed-routine-native-custody.json'
        assert not destination.exists() and not destination.is_symlink()
        destination.write_text(json.dumps(receipt, indent=2) + '\n')
        destination.chmod(0o644)  # Source/own-fixture facts only; provider uploader can read.
        if not cleanup_ok:
            raise AssertionError('Owned native fixture cleanup failed')
    assert receipt['status'] == 'passed'
    print('Actual Linux unloaded fallback, kernel absence/populated-zero and owned cleanup passed; product certificate false.')


if __name__ == '__main__':
    main()
