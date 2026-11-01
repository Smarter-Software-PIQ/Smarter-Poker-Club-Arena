#!/usr/bin/env python3
"""Finite installer for the source-bound reviewed missing-perf package profile.

The existing protected provider stages exact source, profile and public DEBs. No package, path, repository or target selector is a
manual input. The CLI never fetches packages or changes repository metadata.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

STATE = Path('/var/lib/club-arena-perf-install')
CONTROLLER_SHA = '020c6c74be9e6942feadb2b9b3eca80db41f8af1515deaa48f9b8ba5d6d76a72'
OP = re.compile(r'[1-9][0-9]{0,19}')
SHA = re.compile(r'[0-9a-f]{64}')
UNIT_SECONDS = 180
REASONS = frozenset(('root_linux_required', 'operation_refused', 'source_identity_refused',
    'profile_refused', 'profile_unqualified', 'platform_refused', 'bundle_refused', 'prior_operation_unresolved',
    'duplicate_operation_read_only', 'package_state_unproven', 'tools_version_conflict',
    'package_plan_refused', 'apt_failed_unknown_partial_state', 'target_changed',
    'manager_identity_unproven', 'installed_tool_unproven', 'install_verified', 'installer_unproven',
    'release_lock_unavailable', 'release_lock_metadata_refused'))


def refuse(reason):
    raise RuntimeError(reason)


def operation(value):
    if not isinstance(value, str) or not OP.fullmatch(value):
        refuse('operation_refused')
    return value


def unit(op):
    return 'ca-perf-install-' + operation(op) + '.service'


def read(path, limit=1024 * 1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_mode & 0o077 or before.st_nlink != 1 or before.st_size > limit:
            refuse('bundle_refused')
        raw = b''
        while len(raw) <= limit:
            part = os.read(fd, min(1048576, limit + 1 - len(raw)))
            if not part:
                break
            raw += part
        after = os.fstat(fd)
        if len(raw) > limit or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            refuse('bundle_refused')
        return raw
    finally:
        os.close(fd)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def load(name, filename, expected=None):
    source = Path(__file__).parent / filename
    raw = read(source, 131072)
    if expected is not None and digest(raw) != expected:
        refuse('source_identity_refused')
    namespace = {'__name__': name, '__file__': str(source)}
    exec(compile(raw, str(source), 'exec'), namespace)
    return type('Module', (), namespace)


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            refuse('profile_refused')
        value[key] = item
    return value


def profile(raw, expected):
    if not isinstance(expected, str) or not SHA.fullmatch(expected) or digest(raw) != expected:
        refuse('profile_refused')
    value = json.loads(raw, object_pairs_hook=unique)
    if set(value) != {'schema', 'qualified', 'purpose', 'os', 'version', 'arch', 'kernel', 'packages', 'qualificationRun'} or value['schema'] != 'native-perf-install-profile/v1' or value['qualified'] is not True:
        refuse('profile_unqualified')
    if (value['os'], value['version'], value['arch']) != ('ubuntu', '24.04', 'amd64') or not OP.fullmatch(str(value['qualificationRun'])):
        refuse('profile_refused')
    if value['purpose'] not in ('production', 'isolated-qualification') or not isinstance(value['kernel'], str) or not re.fullmatch(r'[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,3}-[0-9]{1,6}-(?:generic|azure)', value['kernel']):
        refuse('profile_refused')
    if value['purpose'] == 'production' and value['kernel'] != '6.8.0-147-generic':
        refuse('profile_refused')
    if not isinstance(value['packages'], list) or not 3 <= len(value['packages']) <= 32:
        refuse('profile_refused')
    names = set()
    for row in value['packages']:
        if set(row) != {'package', 'version', 'architecture', 'bytes', 'sha256'} or not re.fullmatch(r'[a-z0-9][a-z0-9+.-]{0,95}', row['package']) or not re.fullmatch(r'[0-9][A-Za-z0-9.+:~\-]{0,95}', row['version']) or row['architecture'] not in ('all', 'amd64') or type(row['bytes']) is not int or not 0 < row['bytes'] <= 64 * 1024 * 1024 or not SHA.fullmatch(row['sha256']) or row['package'] in names:
            refuse('profile_refused')
        names.add(row['package'])
    if sum(row['bytes'] for row in value['packages']) > 64 * 1024 * 1024:
        refuse('profile_refused')
    return value


def run(args, timeout=10, accepted=(0,)):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, timeout=timeout, env={**os.environ, 'LC_ALL': 'C',
        'DEBIAN_FRONTEND': 'noninteractive', 'NEEDRESTART_MODE': 'l'})
    if result.returncode not in accepted or len(result.stdout) > 65536:
        refuse('apt_failed_unknown_partial_state')
    return result.stdout


def platform_guard(native, qualified):
    info = native.prerequisite_os()
    if info != {'id': qualified['os'], 'versionId': qualified['version'], 'kernelRelease': qualified['kernel']} or os.uname().machine != 'x86_64':
        refuse('platform_refused')


def verify_bundle(folder, rows):
    directory = folder / 'packages'
    names = {row['package'] + '.deb' for row in rows}
    if set(os.listdir(directory)) != names:
        refuse('bundle_refused')
    for row in rows:
        raw = read(directory / (row['package'] + '.deb'), row['bytes'])
        if len(raw) != row['bytes'] or digest(raw) != row['sha256']:
            refuse('bundle_refused')
        fields = run(['/usr/bin/dpkg-deb', '--field', str(directory / (row['package'] + '.deb')), 'Package', 'Version', 'Architecture']).decode()
        actual = dict(line.split(': ', 1) for line in fields.splitlines())
        if actual != {'Package': row['package'], 'Version': row['version'], 'Architecture': row['architecture']}:
            refuse('bundle_refused')


def unit_arguments(op, source):
    return ['/usr/bin/systemd-run', '--unit=' + unit(op), '--service-type=exec', '--quiet',
        '--property=Restart=no', '--property=Slice=system.slice', '--property=RuntimeMaxSec=180',
        '--property=TimeoutStopSec=10', '--property=KillMode=control-group', '--property=UMask=0077',
        '--property=LimitCORE=0', '--property=MemoryMax=512M', '--property=TasksMax=64',
        '--property=ExecStopPost=/usr/bin/python3 ' + str(source) + ' stop-post --operation ' + op,
        '/usr/bin/python3', str(source), 'execute', '--operation', op]


def apt_arguments(cache):
    return ['/usr/bin/apt-get', '--no-download', '--no-upgrade', '--no-remove', '--no-install-recommends',
        '-o', 'APT::Get::AllowUnauthenticated=false', '-o', 'Acquire::AllowInsecureRepositories=false',
        '-o', 'Acquire::AllowDowngradeToInsecureRepositories=false', '-o', 'Acquire::AllowWeakRepositories=false',
        '-o', 'DPkg::Lock::Timeout=0', '-o', 'Dir::Cache::archives=' + str(cache)]


def verified_perf_path(qualified):
    if qualified['purpose'] == 'production' and qualified['kernel'] == '6.8.0-147-generic':
        return '/usr/bin/perf'
    if qualified['purpose'] == 'isolated-qualification':
        return '/usr/lib/linux-tools-6.8.0-147/perf'
    refuse('profile_refused')


def manager(op):
    raw = run(['/usr/bin/systemctl', 'show', unit(op), '--property=LoadState,ActiveState,SubState,InvocationID,MainPID,ExecMainCode,ExecMainStatus,ControlGroup,Result'])
    return dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)


def admit(native, op, expected, profile_sha):
    native.trusted_directory(STATE, create=True)
    folder = native.trusted_directory(STATE / op)
    lock = os.open(STATE / 'admission.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    release = None
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        active = STATE / 'active.json'
        if active.exists():
            prior = native.read_json(active)
            if prior.get('operation') == op:
                return {'operation': op, 'reason': 'duplicate_operation_read_only', 'retryAllowed': False}
            refuse('prior_operation_unresolved')
        try:
            release = os.open('/var/lock/club-arena-engine-up.lock', os.O_RDWR | os.O_NOFOLLOW)
            metadata = os.fstat(release)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
                refuse('release_lock_metadata_refused')
            fcntl.flock(release, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            refuse('release_lock_unavailable')
        qualified = profile(read(folder / 'profile.json'), profile_sha)
        platform_guard(native, qualified)
        original = native.target_identity(expected)
        native.trusted_directory(folder / 'packages')
        verify_bundle(folder, qualified['packages'])
        if not native.same_target(original):
            refuse('target_changed')
        record = {'operation': op, 'phase': 'prepared', 'profileSHA256': profile_sha,
            'sourceSHA256': digest(read(Path(__file__), 131072)), 'target': original,
            'admittedMonotonicUS': time.monotonic_ns() // 1000, 'invocation': None,
            'cleanup': 'pending', 'result': 'installer_unproven', 'profilePurpose': qualified['purpose'],
            'planSourceSHA256': digest(read(folder / 'package-plan.py', 131072))}
        native.write_json(folder / 'operation.json', record, exclusive=True)
        native.write_json(active, {'operation': op, 'profileSHA256': profile_sha}, exclusive=True)
        # Intent is durable BEFORE submit. A timeout/nonzero acknowledgement
        # leaves it owned, even if no unit became observable; never resubmit.
        run(unit_arguments(op, Path(__file__)), timeout=10)
        return {'operation': op, 'phase': 'submitted', 'retryAllowed': False}
    finally:
        if release is not None:
            os.close(release)
        os.close(lock)


def begin_operation(native, op):
    """Shared actual unit boundary; a fixture may exercise it without APT."""
    folder = native.trusted_directory(STATE / op)
    record = native.read_json(folder / 'operation.json')
    state = manager(op)
    invocation = os.environ.get('INVOCATION_ID', '')
    if not re.fullmatch(r'[0-9a-f]{32}', invocation) or state.get('InvocationID') != invocation or state.get('MainPID') != str(os.getpid()) or state.get('ControlGroup') != '/system.slice/' + unit(op):
        refuse('manager_identity_unproven')
    if digest(read(Path(__file__), 131072)) != record['sourceSHA256']:
        refuse('source_identity_refused')
    record.update(invocation=invocation, phase='preparing')
    native.write_json(folder / 'operation.json', record)
    return folder, record


def execute(native, op):
    folder, record = begin_operation(native, op)
    try:
        qualified = profile(read(folder / 'profile.json'), record['profileSHA256'])
        platform_guard(native, qualified)
        if not native.same_target(record['target']):
            refuse('target_changed')
        native.trusted_directory(folder / 'packages')
        verify_bundle(folder, qualified['packages'])
        if run(['/usr/bin/dpkg', '--audit']):
            refuse('package_state_unproven')
        new = []
        for row in qualified['packages']:
            status = run(['/usr/bin/dpkg-query', '--show', '--showformat=${Status}\t${Version}', row['package']], accepted=(0, 1)).decode()
            if status.startswith('install ok installed\t'):
                if status.split('\t')[1] != row['version']:
                    refuse('tools_version_conflict')
            elif status:
                refuse('package_state_unproven')
            else:
                new.append(row)
        if not new:
            refuse('installed_tool_unproven')  # No fresh install was exercised.
        cache = native.trusted_directory(folder / 'archives', create=True)
        native.trusted_directory(cache / 'partial', create=True)
        arguments = apt_arguments(cache)
        files = [str(folder / 'packages' / (row['package'] + '.deb')) for row in new]
        planner = load('qualified_plan', 'package-plan.py', record['planSourceSHA256'])
        planned = planner.plan(run([*arguments, '--simulate', 'install', *files], timeout=15))
        if planned != {row['package']: row['version'] for row in new}:
            refuse('package_plan_refused')
        native.write_json(folder / 'apt-attempt.json', {'operation': op,
            'invocation': record['invocation'], 'packagePlan': planned}, exclusive=True)
        record.update(phase='installing', packagePlanSHA256=digest(json.dumps(planned, sort_keys=True).encode()))
        native.write_json(folder / 'operation.json', record)
        # Normal APT hooks/locks remain enabled. Missing unqualified archives
        # must fail before dpkg; that boundary needs REAL Ubuntu qualification.
        run([*arguments, '-y', 'install', *files], timeout=100)
        record['phase'] = 'verifying'
        native.write_json(folder / 'operation.json', record)
        for row in qualified['packages']:
            if run(['/usr/bin/dpkg-query', '--show', '--showformat=${Status}\t${Version}', row['package']]).decode() != 'install ok installed\t' + row['version']:
                refuse('installed_tool_unproven')
        if run(['/usr/bin/dpkg', '--audit']) or native.prerequisite_tool('/usr/bin/perf') != {'available': True, 'reason': 'available'} or not run([verified_perf_path(qualified), '--version']).startswith(b'perf version '):
            refuse('installed_tool_unproven')
        if not native.same_target(record['target']):
            refuse('target_changed')
        record.update(result='install_verified', phase='verified')
    except Exception as error:
        reason = str(error)
        result = reason if reason in REASONS else 'apt_failed_unknown_partial_state' if record.get('phase') == 'installing' else 'installer_unproven'
        record.update(result=result, phase='refused')
        raise
    finally:
        native.write_json(folder / 'operation.json', record)


def stop_post(native, op):
    folder = native.trusted_directory(STATE / op)
    record = native.read_json(folder / 'operation.json')
    invocation = os.environ.get('INVOCATION_ID', '')
    if not re.fullmatch(r'[0-9a-f]{32}', invocation) or manager(op).get('InvocationID') != invocation or record['invocation'] not in (None, invocation):
        refuse('manager_identity_unproven')
    record.update(invocation=invocation, serviceResult=os.environ.get('SERVICE_RESULT') == 'success',
        exitZero=os.environ.get('EXIT_CODE') == 'exited' and os.environ.get('EXIT_STATUS') == '0',
        cleanup='retained_public_packages_only', cleanupMonotonicUS=time.monotonic_ns() // 1000)
    native.write_json(folder / 'operation.json', record)


def receipt(native, op):
    folder = native.trusted_directory(STATE / op)
    record = native.read_json(folder / 'operation.json')
    if record.get('operation') != op or not isinstance(record.get('profileSHA256'), str) or not SHA.fullmatch(record['profileSHA256']) or not isinstance(record.get('sourceSHA256'), str) or not SHA.fullmatch(record['sourceSHA256']) or digest(read(Path(__file__), 131072)) != record['sourceSHA256']:
        refuse('source_identity_refused')
    target = record.get('target')
    if not isinstance(target, dict) or not isinstance(target.get('sha'), str) or not re.fullmatch(r'[0-9a-f]{40}', target['sha']):
        refuse('source_identity_refused')
    state = manager(op)
    invocation = record.get('invocation')
    same = isinstance(invocation, str) and re.fullmatch(r'[0-9a-f]{32}', invocation) and state.get('InvocationID') == invocation
    terminal = state.get('ActiveState') in ('inactive', 'failed') and state.get('SubState') in ('dead', 'failed')
    success = state.get('Result') == 'success' and state.get('ExecMainCode') == '1' and state.get('ExecMainStatus') == '0'
    evidence = 'loaded_manager_state' if same and terminal else 'unproven'
    if state.get('LoadState') == 'not-found':
        journal = terminal_journal(native, op, record)
        if journal is not None:
            same, terminal, success, evidence = True, True, journal, 'manager_terminal_journal'
    group = Path('/sys/fs/cgroup/system.slice/' + unit(op))
    empty = state.get('ControlGroup', '') in ('', '/system.slice/' + unit(op)) and (not group.exists() or bool(re.search(r'^populated 0$', (group / 'cgroup.events').read_text(), re.M)))
    proven = bool(same and terminal and empty and record.get('cleanup') == 'retained_public_packages_only')
    verified = bool(proven and success and record.get('result') == 'install_verified'
        and record.get('serviceResult') is True and record.get('exitZero') is True)
    return {'schema': 'native-perf-install/v1', 'operation': op, 'readOnly': True,
        'profileSHA256': record['profileSHA256'], 'sourceSHA256': record['sourceSHA256'],
        'engineSHA': target['sha'],
        'originalIdentitySHA256': digest(json.dumps(target, sort_keys=True, separators=(',', ':')).encode()),
        'profilePurpose': record.get('profilePurpose') if record.get('profilePurpose') in ('production', 'isolated-qualification') else None,
        'sameInvocation': bool(same), 'terminal': terminal, 'helperCgroupEmpty': empty,
        'installationVerified': verified,
        'productionInstallationQualified': verified and record.get('profilePurpose') == 'production',
        'wrapperKernelDispatchQualified': verified and record.get('profilePurpose') == 'production',
        'reason': record.get('result') if proven and record.get('result') in REASONS else 'installer_unproven',
        'managerTerminalEvidence': evidence if proven else 'unproven',
        'identityControllerSHA256': CONTROLLER_SHA,
        'retryAllowed': False, 'nativeCauseProven': False}


def receipt_outcome(raw, op, profile_sha, source_sha, purpose, expected_engine_sha, transport_exit):
    """Strict provider boundary: no unknown fields, coercion or raw error export."""
    operation(op)
    if not isinstance(profile_sha, str) or not isinstance(source_sha, str) or not SHA.fullmatch(profile_sha) or not SHA.fullmatch(source_sha) or purpose not in ('production', 'isolated-qualification') or not isinstance(expected_engine_sha, str) or not re.fullmatch(r'[0-9a-f]{40}', expected_engine_sha):
        raise ValueError('receipt_binding_refused')
    failure = {'schema': 'native-perf-install-readback/v1', 'validReceipt': False,
        'operation': op, 'profileSHA256': profile_sha, 'sourceSHA256': source_sha,
        'engineSHA': expected_engine_sha,
        'profilePurpose': purpose, 'installationVerified': False,
        'productionInstallationQualified': False, 'reason': 'receipt_transport_unproven',
        'transportExit': transport_exit if type(transport_exit) is int and -255 <= transport_exit <= 255 else None}
    if type(transport_exit) is not int or transport_exit != 0:
        return failure
    failure['reason'] = 'receipt_shape_unproven'
    try:
        if not isinstance(raw, bytes) or len(raw) > 16384:
            return failure
        value = json.loads(raw, object_pairs_hook=unique)
        if isinstance(value, dict) and set(value) == {'schema', 'installationVerified', 'reason', 'retryAllowed'} and value['schema'] == 'native-perf-install/v1' and value['installationVerified'] is False and value['retryAllowed'] is False and value['reason'] in REASONS:
            return {**failure, 'reason': 'controller_refused', 'refusalCode': value['reason']}
        fields = {'schema', 'operation', 'readOnly', 'profileSHA256', 'sourceSHA256', 'profilePurpose', 'engineSHA', 'originalIdentitySHA256',
            'sameInvocation', 'terminal', 'helperCgroupEmpty', 'installationVerified',
            'productionInstallationQualified', 'wrapperKernelDispatchQualified', 'reason',
            'managerTerminalEvidence', 'identityControllerSHA256', 'retryAllowed', 'nativeCauseProven'}
        if not isinstance(value, dict) or set(value) != fields:
            return failure
        if (value['schema'] != 'native-perf-install/v1' or value['operation'] != op
                or value['profileSHA256'] != profile_sha or value['sourceSHA256'] != source_sha
                or value['profilePurpose'] != purpose or value['identityControllerSHA256'] != CONTROLLER_SHA
                or value['engineSHA'] != expected_engine_sha or not isinstance(value['originalIdentitySHA256'], str)
                or not SHA.fullmatch(value['originalIdentitySHA256'])):
            return failure
        booleans = ('readOnly', 'sameInvocation', 'terminal', 'helperCgroupEmpty', 'installationVerified',
            'productionInstallationQualified', 'wrapperKernelDispatchQualified', 'retryAllowed', 'nativeCauseProven')
        if any(type(value[key]) is not bool for key in booleans) or value['readOnly'] is not True or value['retryAllowed'] is not False or value['nativeCauseProven'] is not False:
            return failure
        if value['reason'] not in REASONS or value['managerTerminalEvidence'] not in ('loaded_manager_state', 'manager_terminal_journal', 'unproven'):
            return failure
        verified = value['installationVerified']
        if verified and (not all(value[key] for key in ('sameInvocation', 'terminal', 'helperCgroupEmpty'))
                or value['reason'] != 'install_verified' or value['managerTerminalEvidence'] == 'unproven'):
            return failure
        if value['productionInstallationQualified'] != (verified and purpose == 'production') or value['wrapperKernelDispatchQualified'] != (verified and purpose == 'production'):
            return failure
        return {**value, 'validReceipt': True, 'transportExit': 0}
    except (ValueError, RuntimeError, TypeError, UnicodeError):
        return failure


def wait_receipt(native, op):
    """One bounded read-only205s wait. Child argv can never submit or run APT."""
    record = native.read_json(native.trusted_directory(STATE / op) / 'operation.json')
    deadline = time.monotonic() + 204  # Reserve1s of205 for own child teardown.
    last = None
    while time.monotonic() < deadline:
        child = subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(Path(__file__)),
            'receipt', '--operation', op], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL, start_new_session=True)
        try:
            raw, _ = child.communicate(timeout=min(15, max(.01, deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            # Own receipt-only child group; never the external engine/helper unit.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.communicate(timeout=1)
            raw = b''
        checked = receipt_outcome(raw, op, record['profileSHA256'], record['sourceSHA256'],
            record['profilePurpose'], record['target']['sha'], child.returncode)
        if checked['validReceipt']:
            last = json.loads(raw)
            if last['sameInvocation'] and last['terminal'] and last['helperCgroupEmpty'] and last['managerTerminalEvidence'] != 'unproven':
                return last
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(.5, remaining))
    if last is None:
        refuse('installer_unproven')
    return last


def terminal_journal(native, op, record):
    invocation = record.get('invocation')
    boot = record.get('target', {}).get('boot', '').replace('-', '')
    if not isinstance(invocation, str) or not re.fullmatch(r'[0-9a-f]{32}', invocation) or boot != Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', ''):
        return None
    fields = '_PID,_UID,_TRANSPORT,_BOOT_ID,UNIT,INVOCATION_ID,MESSAGE_ID,__MONOTONIC_TIMESTAMP'
    raw = run(['/usr/bin/journalctl', '--boot=0', '--no-pager', '--quiet', '--output=json',
        '--output-fields=' + fields, '--lines=32', '_PID=1', '_UID=0', 'UNIT=' + unit(op),
        'INVOCATION_ID=' + invocation, 'MESSAGE_ID=' + native.MANAGER_SUCCESS,
        'MESSAGE_ID=' + native.MANAGER_FAILURE], timeout=3)
    rows = [json.loads(line) for line in raw.splitlines()]
    if not 1 <= len(rows) < 32:
        return None
    admitted, cleanup = record.get('admittedMonotonicUS'), record.get('cleanupMonotonicUS')
    if type(admitted) is not int or type(cleanup) is not int or cleanup < admitted:
        return None
    for row in rows:
        timestamp = row.get('__MONOTONIC_TIMESTAMP')
        if (row.get('_PID') != '1' or row.get('_UID') != '0' or row.get('_TRANSPORT') != 'journal'
                or row.get('_BOOT_ID') != boot or row.get('UNIT') != unit(op)
                or row.get('INVOCATION_ID') != invocation or row.get('MESSAGE_ID') not in (native.MANAGER_SUCCESS, native.MANAGER_FAILURE)
                or not isinstance(timestamp, str) or not timestamp.isdigit() or int(timestamp) < cleanup):
            return None
    if len(rows) != 1:
        return None
    return rows[0]['MESSAGE_ID'] == native.MANAGER_SUCCESS


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('admit', 'execute', 'stop-post', 'receipt'))
    parser.add_argument('--operation', required=True)
    parser.add_argument('--expected-engine-sha')
    parser.add_argument('--profile-sha')
    parser.add_argument('--wait', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0 or sys.platform != 'linux':
        refuse('root_linux_required')
    native = load('qualified_native_identity', 'native-fault-observation.py', CONTROLLER_SHA)
    op = operation(args.operation)
    if args.wait and args.mode != 'receipt':
        refuse('operation_refused')
    value = admit(native, op, args.expected_engine_sha, args.profile_sha) if args.mode == 'admit' else execute(native, op) if args.mode == 'execute' else stop_post(native, op) if args.mode == 'stop-post' else wait_receipt(native, op) if args.wait else receipt(native, op)
    if value is not None:
        print(json.dumps(value, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        reason = str(error)
        print(json.dumps({'schema': 'native-perf-install/v1', 'installationVerified': False,
            'reason': reason if reason in REASONS else 'installer_unproven', 'retryAllowed': False}))
        raise SystemExit(1)
