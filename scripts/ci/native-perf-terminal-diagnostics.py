#!/usr/bin/env python3
"""Read one original terminal installation. No installation or state writes.

The protected provider sends these bytes to isolated Python stdin only after
validating the original immutable controller's terminal receipt. Only a numeric
operation is accepted; original source/profile/identity bindings remain intact.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
from types import SimpleNamespace

STATE = Path('/var/lib/club-arena-perf-install')
INSTALLER = '4cfa83762ebe45e7fec31bb002f475cd9c983d0874c1d418d899ec4fed26ab7b'
NATIVE = '020c6c74be9e6942feadb2b9b3eca80db41f8af1515deaa48f9b8ba5d6d76a72'
PLAN = '739f7ea64f41d7aa0ba421362ba200ed6fcc767a9d227351011cb5de951155ac'
PHASES = frozenset(('prepared', 'preparing', 'installing', 'verifying', 'verified', 'refused'))
SCHEMA = 'native-perf-terminal-diagnostics/v1'
BINDINGS = ('operation', 'sourceSHA256', 'profileSHA256', 'profilePurpose', 'engineSHA', 'originalIdentitySHA256')


class DiagnosticDeadline(BaseException):
    pass


def refuse():
    raise ValueError('terminal_diagnostics_unproven')


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            refuse()
        result[key] = value
    return result


def trusted_folder(op):
    if not isinstance(op, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', op):
        refuse()
    path = STATE / op
    current = Path('/')
    for part in path.parts[1:]:
        current /= part
        value = current.lstat()
        if not stat.S_ISDIR(value.st_mode) or value.st_uid != 0 or value.st_mode & 0o022:
            refuse()
        if current in (STATE, path) and value.st_mode & 0o077:
            refuse()
    return path


def load_original(folder):
    # Validate the fixed original source before executing even its read helpers.
    fd = os.open(folder / 'installer.py', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(fd)
        raw = os.read(fd, 131073)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o077 or metadata.st_nlink != 1 or hashlib.sha256(raw).hexdigest() != INSTALLER:
            refuse()
    finally:
        os.close(fd)
    namespace = {'__name__': 'original_installer_reader', '__file__': str(folder / 'installer.py')}
    exec(compile(raw, str(folder / 'installer.py'), 'exec'), namespace)
    helper = SimpleNamespace(**namespace)
    native = helper.load('original_native_reader', 'native-fault-observation.py', NATIVE)
    planner = helper.load('original_plan_reader', 'package-plan.py', PLAN)
    return helper, native, planner


def package_rows(status, policy, names, version_pattern):
    """Only the fixed public names and closed Debian versions leave this reader."""
    rows = {name: {'package': name, 'status': 'absent', 'installedVersion': None,
        'candidateVersion': None} for name in names}
    seen = set()
    for line in status.decode('ascii').splitlines():
        parts = line.split('\t')
        if len(parts) != 3:
            refuse()
        name, state, version = parts
        name = name.removesuffix(':amd64')
        if name not in rows or name in seen or not version_pattern.fullmatch(version):
            refuse()
        seen.add(name)
        rows[name].update(status='installed' if state == 'install ok installed' else 'other', installedVersion=version)
    current = None
    candidates, headings = set(), set()
    for line in policy.decode('ascii').splitlines():
        if line and not line[0].isspace():
            if not line.endswith(':'):
                refuse()
            current = line[:-1].removesuffix(':amd64')
            if current not in rows or current in headings:
                refuse()
            headings.add(current)
        elif line.startswith('  Candidate: '):
            value = line.removeprefix('  Candidate: ')
            if current is None or current in candidates or value != '(none)' and not version_pattern.fullmatch(value):
                refuse()
            candidates.add(current)
            rows[current]['candidateVersion'] = None if value == '(none)' else value
    if headings != set(names) or candidates != set(names):
        refuse()
    return [rows[name] for name in names]


def packages(helper, native, planner):
    names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
    if any(native.prerequisite_tool(path) != {'available': True, 'reason': 'available'}
            for path in ('/usr/bin/dpkg-query', '/usr/bin/apt-cache', '/usr/bin/dpkg')):
        return {'verified': False, 'rows': [], 'dpkgAuditClean': None}
    try:
        # No apt-get/update, cache write, online query, package action or raw log.
        status = helper.run(['/usr/bin/dpkg-query', '--show', '--showformat=${binary:Package}\t${Status}\t${Version}\n', *names], timeout=3, accepted=(0, 1))
        # apt.conf(5): empty cache names disable on-disk generation.
        policy = helper.run(['/usr/bin/apt-cache', '-o', 'Dir::Cache::pkgcache=',
            '-o', 'Dir::Cache::srcpkgcache=', 'policy', *names], timeout=3)
        audit = helper.run(['/usr/bin/dpkg', '--audit'], timeout=3)
        return {'verified': True, 'rows': package_rows(status, policy, names, planner.DEBIAN_VERSION),
            'dpkgAuditClean': not bool(audit)}
    except Exception:
        return {'verified': False, 'rows': [], 'dpkgAuditClean': None}


def read_terminal(op):
    folder = trusted_folder(op)
    helper, native, planner = load_original(folder)
    original = helper.read(folder / 'operation.json')
    record = json.loads(original, object_pairs_hook=unique)
    if record.get('operation') != op or record.get('sourceSHA256') != INSTALLER or record.get('planSourceSHA256') != PLAN:
        refuse()
    profile = helper.profile(helper.read(folder / 'profile.json'), record.get('profileSHA256'))
    if profile['purpose'] != record.get('profilePurpose'):
        refuse()
    receipt = helper.receipt(native, op)
    checked = helper.receipt_outcome(json.dumps(receipt).encode(), op, record['profileSHA256'], INSTALLER,
        record['profilePurpose'], record.get('target', {}).get('sha'), 0)
    if checked.get('validReceipt') is not True or not all(checked.get(key) is True
            for key in ('sameInvocation', 'terminal', 'helperCgroupEmpty')) or checked.get('managerTerminalEvidence') == 'unproven':
        refuse()
    phase = record.get('phase')
    failure = helper.command_failure_outcome(record.get('commandFailure'))
    if phase not in PHASES or 'commandFailure' in record and failure is None:
        refuse()
    try:
        attempt = helper.read(folder / 'apt-attempt.json', 16384)
    except FileNotFoundError:
        attempt = None
    if attempt is not None:
        intent = json.loads(attempt, object_pairs_hook=unique)
        plan = intent.get('packagePlan')
        if set(intent) != {'operation', 'invocation', 'packagePlan'} or intent['operation'] != op or intent['invocation'] != record.get('invocation') or not isinstance(plan, dict) or not plan or any(name not in set(planner.TARGETS) | planner.DEPENDENCIES or not isinstance(version, str) or not planner.DEBIAN_VERSION.fullmatch(version) for name, version in plan.items()):
            refuse()
        if helper.digest(json.dumps(plan, sort_keys=True).encode()) != record.get('packagePlanSHA256'):
            refuse()
    public_packages = packages(helper, native, planner)
    try:
        after_attempt = helper.read(folder / 'apt-attempt.json', 16384)
    except FileNotFoundError:
        after_attempt = None
    if helper.read(folder / 'operation.json') != original or after_attempt != attempt:
        refuse()
    return {'schema': SCHEMA, 'readOnly': True, 'diagnosticReadVerified': True,
        **{key: checked[key] for key in BINDINGS}, 'identityControllerSHA256': NATIVE,
        'planSourceSHA256': PLAN, 'phase': phase, 'commandFailure': failure,
        'aptAttemptRecorded': attempt is not None, 'originalRecordsUnchanged': True,
        'packages': public_packages, 'retryAllowed': False, 'nativeCauseProven': False}


def diagnostic_outcome(raw, receipt, transport_exit, planner, helper):
    """Keep diagnostics separate; they can never alter installation authority."""
    if transport_exit != 0 or type(transport_exit) is not int or not isinstance(raw, bytes) or len(raw) > 32768:
        return None
    try:
        value = json.loads(raw, object_pairs_hook=unique)
        fields = {'schema', 'readOnly', 'diagnosticReadVerified', *BINDINGS, 'identityControllerSHA256',
            'planSourceSHA256', 'phase', 'commandFailure', 'aptAttemptRecorded', 'originalRecordsUnchanged',
            'packages', 'retryAllowed', 'nativeCauseProven'}
        if not isinstance(value, dict) or set(value) != fields or value['schema'] != SCHEMA or any(value[key] != receipt[key] for key in BINDINGS):
            return None
        if receipt.get('validReceipt') is not True or not all(receipt.get(key) is True for key in ('terminal', 'sameInvocation', 'helperCgroupEmpty')):
            return None
        if value['identityControllerSHA256'] != NATIVE or value['planSourceSHA256'] != PLAN or value['sourceSHA256'] != INSTALLER or value['phase'] not in PHASES:
            return None
        if any(value[key] is not True for key in ('readOnly', 'diagnosticReadVerified', 'originalRecordsUnchanged')) or type(value['aptAttemptRecorded']) is not bool or value['retryAllowed'] is not False or value['nativeCauseProven'] is not False:
            return None
        if value['commandFailure'] is not None and helper.command_failure_outcome(value['commandFailure']) is None:
            return None
        packages = value['packages']
        if not isinstance(packages, dict) or set(packages) != {'verified', 'rows', 'dpkgAuditClean'} or type(packages['verified']) is not bool:
            return None
        names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
        if packages['verified']:
            if type(packages['dpkgAuditClean']) is not bool or not isinstance(packages['rows'], list) or len(packages['rows']) != len(names):
                return None
            for row, name in zip(packages['rows'], names):
                if not isinstance(row, dict) or set(row) != {'package', 'status', 'installedVersion', 'candidateVersion'} or row['package'] != name or row['status'] not in ('installed', 'absent', 'other') or (row['status'] == 'absent') != (row['installedVersion'] is None) or any(v is not None and (not isinstance(v, str) or not planner.DEBIAN_VERSION.fullmatch(v)) for v in (row['installedVersion'], row['candidateVersion'])):
                    return None
        elif packages != {'verified': False, 'rows': [], 'dpkgAuditClean': None}:
            return None
        return value
    except (ValueError, TypeError, KeyError, RuntimeError):
        return None


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2 or os.geteuid() != 0 or sys.platform != 'linux':
            refuse()
        def expired(*_):
            raise DiagnosticDeadline()
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(20)
        value = read_terminal(sys.argv[1])
        print(json.dumps(value, separators=(',', ':')))
    except (Exception, DiagnosticDeadline):
        print(json.dumps({'schema': SCHEMA, 'diagnosticReadVerified': False}))
        raise SystemExit(1)
