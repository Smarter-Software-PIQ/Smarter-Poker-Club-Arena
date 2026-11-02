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
import selectors
import time
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


PACKAGE_SCHEMA = 'native-perf-package-readback/v2'
QUERY_STAGES = {
    'tool_metadata': frozenset(('tool_missing', 'tool_untrusted', 'tool_not_executable', 'tool_unknown')),
    'command': frozenset(('command_nonzero', 'command_bound', 'command_timeout', 'command_unavailable')),
    'parse': frozenset(('status_empty', 'status_incomplete', 'status_malformed', 'policy_empty', 'policy_incomplete', 'policy_malformed')),
    'complete': frozenset(('verified',)),
}
QUERY_COMMANDS = {'status': 'package_status', 'policy': 'unproven', 'audit': 'package_audit'}


def empty_query(kind, names):
    rows = [] if kind == 'audit' else [dict(package=name, verified=False,
        **({'status': 'unknown', 'installedVersion': None} if kind == 'status' else {'candidateVersion': None})) for name in names]
    return {'verified': False, 'stage': 'tool_metadata', 'reason': 'tool_unknown',
        'commandFailure': None, 'rows': rows, 'auditClean': None}


def status_rows(raw, names, version_pattern):
    rows = empty_query('status', names)['rows']
    indexed = {row['package']: row for row in rows}
    seen = set()
    for line in raw.decode('ascii').splitlines():
        parts = line.split('\t')
        if len(parts) != 3:
            refuse()
        name, state, version = parts
        name = name.removesuffix(':amd64')
        if name not in indexed or name in seen or not version_pattern.fullmatch(version) or not re.fullmatch(r'(?:unknown|install|hold|deinstall|purge) (?:ok|reinstreq) (?:not-installed|config-files|half-installed|unpacked|half-configured|triggers-awaited|triggers-pending|installed)', state):
            refuse()
        seen.add(name)
        indexed[name].update(verified=True, status='installed' if state == 'install ok installed' else 'other', installedVersion=version)
    return rows


def policy_rows(raw, names, version_pattern):
    rows = empty_query('policy', names)['rows']
    indexed = {row['package']: row for row in rows}
    current, headings, candidates = None, set(), set()
    for line in raw.decode('ascii').splitlines():
        if line and not line[0].isspace():
            if not line.endswith(':'):
                refuse()
            current = line[:-1].removesuffix(':amd64')
            if current not in indexed or current in headings:
                refuse()
            headings.add(current)
        elif line.startswith('  Candidate: '):
            value = line.removeprefix('  Candidate: ')
            if current is None or current in candidates or value != '(none)' and not version_pattern.fullmatch(value):
                refuse()
            candidates.add(current)
            indexed[current].update(verified=True, candidateVersion=None if value == '(none)' else value)
    return rows


def run_read(args):
    """Three fixed read commands only; bounded private pipes, no host files."""
    child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, 'LC_ALL': 'C'})
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    deadline = time.monotonic() + 2.75  # Remaining250ms is own-reader teardown.
    selector = selectors.DefaultSelector()
    try:
        selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
        selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired('fixed_package_read', 3)
            for key, _ in selector.select(remaining):
                chunk = os.read(key.fileobj.fileno(), min(8192, 65537 - len(buffers[key.data])))
                if not chunk:
                    selector.unregister(key.fileobj)
                else:
                    buffers[key.data].extend(chunk)
                    if len(buffers[key.data]) > 65536:
                        child.kill(); child.wait(timeout=.25)
                        return subprocess.CompletedProcess(args, child.returncode, bytes(buffers['stdout']), bytes(buffers['stderr']))
        child.wait(timeout=max(.001, deadline - time.monotonic()))
        return subprocess.CompletedProcess(args, child.returncode, bytes(buffers['stdout']), bytes(buffers['stderr']))
    finally:
        selector.close()
        if child.poll() is None:
            child.kill(); child.wait(timeout=.25)  # Only this read-only child.
        child.stdout.close(); child.stderr.close()


def package_query(helper, native, planner, kind, names, args):
    value = empty_query(kind, names)
    tool = native.prerequisite_tool(args[0])
    if tool != {'available': True, 'reason': 'available'}:
        reason = tool.get('reason') if isinstance(tool, dict) else 'unknown'
        value['reason'] = 'tool_' + {'missing': 'missing', 'untrusted': 'untrusted', 'not-executable': 'not_executable'}.get(reason, 'unknown')
        return value
    value.update(stage='command', reason='command_unavailable')
    try:
        result = run_read(args)
    except subprocess.TimeoutExpired:
        value['reason'] = 'command_timeout'
        return value
    except (OSError, subprocess.SubprocessError):
        return value
    bound = len(result.stdout) > 65536 or len(result.stderr) > 65536
    if result.returncode != 0 or bound:
        value.update(reason='command_bound' if bound else 'command_nonzero',
            commandFailure=helper.command_failure_outcome(helper.CommandFailure(args, result).public))
        # dpkg-query exit1 may contain some successfully queried fixed names.
        # Missing names remain explicit UNKNOWN, never inferred absent.
        if kind != 'status' or result.returncode != 1 or bound:
            return value
    if kind == 'audit':
        value.update(verified=True, stage='complete', reason='verified', auditClean=not bool(result.stdout))
        return value
    try:
        parsed = status_rows(result.stdout, names, planner.DEBIAN_VERSION) if kind == 'status' else policy_rows(result.stdout, names, planner.DEBIAN_VERSION)
    except (ValueError, UnicodeError, TypeError):
        value.update(stage='parse', reason=kind + '_malformed')
        return value
    value['rows'] = parsed
    if value['commandFailure'] is not None:
        return value
    complete = all(row['verified'] for row in parsed)
    value.update(verified=complete, stage='complete' if complete else 'parse',
        reason='verified' if complete else kind + ('_empty' if not result.stdout.strip() else '_incomplete'))
    return value


def package_report(queries, names):
    complete = all(query['verified'] for query in queries.values())
    rows = []
    if complete:
        rows = [{'package': name, 'status': status['status'], 'installedVersion': status['installedVersion'],
            'candidateVersion': policy['candidateVersion']} for name, status, policy in zip(names, queries['status']['rows'], queries['policy']['rows'])]
    return {'schema': PACKAGE_SCHEMA, 'verified': complete, 'rows': rows,
        'dpkgAuditClean': queries['audit']['auditClean'] if complete else None, 'queries': queries}


def packages(helper, native, planner):
    names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
    # Independent fixed reads preserve positive evidence when another query fails.
    commands = {
        'status': ['/usr/bin/dpkg-query', '--show', '--showformat=${binary:Package}\t${Status}\t${Version}\n', *names],
        'policy': ['/usr/bin/apt-cache', '-o', 'Dir::Cache::pkgcache=', '-o', 'Dir::Cache::srcpkgcache=', 'policy', *names],
        'audit': ['/usr/bin/dpkg', '--audit'],
    }
    return package_report({kind: package_query(helper, native, planner, kind, names, args)
        for kind, args in commands.items()}, names)


def valid_package_report(value, planner, helper):
    names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
    if not isinstance(value, dict) or set(value) != {'schema', 'verified', 'rows', 'dpkgAuditClean', 'queries'} or value['schema'] != PACKAGE_SCHEMA or type(value['verified']) is not bool or not isinstance(value['queries'], dict) or set(value['queries']) != set(QUERY_COMMANDS):
        return False
    for kind, query in value['queries'].items():
        if not isinstance(query, dict) or set(query) != {'verified', 'stage', 'reason', 'commandFailure', 'rows', 'auditClean'} or type(query['verified']) is not bool or not isinstance(query['stage'], str) or not isinstance(query['reason'], str) or query['stage'] not in QUERY_STAGES or query['reason'] not in QUERY_STAGES[query['stage']] or query['verified'] != (query['stage'] == 'complete') or not isinstance(query['rows'], list):
            return False
        failure = query['commandFailure']
        if failure is not None and (helper.command_failure_outcome(failure) is None or failure['command'] != QUERY_COMMANDS[kind] or query['stage'] not in ('command', 'parse')):
            return False
        if query['stage'] == 'command' and (query['reason'] in ('command_nonzero', 'command_bound')) != (failure is not None):
            return False
        if failure is not None:
            if query['reason'] == 'command_nonzero' and (failure['exitCode'] == 0 or failure['boundExceeded']):
                return False
            if query['reason'] == 'command_bound' and not failure['boundExceeded']:
                return False
            if query['stage'] == 'parse' and (kind != 'status' or failure['exitCode'] != 1 or failure['boundExceeded']):
                return False
        if query['stage'] == 'parse' and (kind == 'audit' or not query['reason'].startswith(kind + '_')):
            return False
        if kind == 'audit':
            if query['rows'] != []:
                return False
            if query['verified']:
                if type(query['auditClean']) is not bool:
                    return False
            elif query['auditClean'] is not None:
                return False
            continue
        if query['auditClean'] is not None or len(query['rows']) != len(names):
            return False
        for row, name in zip(query['rows'], names):
            expected = {'package', 'verified', 'status', 'installedVersion'} if kind == 'status' else {'package', 'verified', 'candidateVersion'}
            if not isinstance(row, dict) or set(row) != expected or row['package'] != name or type(row['verified']) is not bool:
                return False
            version = row['installedVersion'] if kind == 'status' else row['candidateVersion']
            if version is not None and (not isinstance(version, str) or not planner.DEBIAN_VERSION.fullmatch(version)):
                return False
            if kind == 'status':
                if row['verified'] and (row['status'] not in ('installed', 'other') or version is None):
                    return False
                if not row['verified'] and (row['status'] != 'unknown' or version is not None):
                    return False
            if kind == 'policy' and not row['verified'] and version is not None:
                return False
        if query['verified'] and not all(row['verified'] for row in query['rows']):
            return False
        # Only a successfully parsed partial status/policy output can carry
        # positive rows in an incomplete query. Metadata/timeouts/truncation
        # and malformed output cannot manufacture installed/candidate facts.
        partial = query['stage'] == 'parse' and query['reason'] == kind + '_incomplete'
        partial = partial or (kind == 'status' and query['stage'] in ('command', 'parse') and failure is not None and failure['exitCode'] == 1 and not failure['boundExceeded'] and query['reason'] not in ('status_empty', 'status_malformed'))
        if not query['verified'] and not partial and any(row['verified'] for row in query['rows']):
            return False
    if value['verified']:
        if type(value['dpkgAuditClean']) is not bool:
            return False
    elif value['dpkgAuditClean'] is not None:
        return False
    return value == package_report(value['queries'], names)


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
        if not valid_package_report(value['packages'], planner, helper):
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
