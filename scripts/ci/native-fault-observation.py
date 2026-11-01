#!/usr/bin/env python3
"""One explicit host-owned native fault observation. Never signals the engine.

Private process identities, maps, registers and stacks are never public output.
Only the closed receipt is eligible for export. No retry or second arm occurs.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

STATE = Path('/var/lib/club-arena-native-fault')
RAW = Path('/run/club-arena-native-fault')
CONTAINER = 'club-arena-engine'
OBSERVATION_SECONDS = 120
UNIT_SECONDS = 160
PREPARE_SECONDS = 20
STOP_SECONDS = 5
DECODE_SECONDS = 10
RECEIPT_SECONDS = 5
MAX_PERF_BYTES = 4 * 1024 * 1024
MAX_MODULE_BYTES = 256 * 1024 * 1024
OPERATION = re.compile(r'[1-9][0-9]{0,19}')
SHA = re.compile(r'[0-9a-f]{40}')
INVOCATION = re.compile(r'[0-9a-f]{32}')


REFUSAL_CODES = frozenset({
    'boot_identity_refused',
    'bounded_perf_capture_refused',
    'cleanup_invocation_refused',
    'cleanup_source_refused',
    'command_refused',
    'container_identity_refused',
    'container_mount_metadata_refused',
    'decode_bound',
    'engine_health_identity_refused',
    'engine_health_response_bound',
    'engine_health_socket_owner_unproven',
    'engine_pid1_unproven',
    'engine_process_command_refused',
    'engine_process_identity_raced',
    'engine_working_directory_refused',
    'expected_sha_refused',
    'fixed_engine_health_binding_unproven',
    'health_socket_descriptor_bound',
    'health_socket_metadata_bound',
    'leader_identity_refused',
    'mapped_module_custody_refused',
    'maps_bound',
    'module_build_id_unproven',
    'module_copy_incomplete',
    'module_copy_raced',
    'module_copy_short_write',
    'retained_module_attestation_refused',
    'module_storage_bound',
    'native_event_bound',
    'native_module_count_bound',
    'native_prerequisite_unavailable',
    'native_task_attribution_refused',
    'native_unwind_refused',
    'observed_original_target_changed',
    'operation_boot_changed',
    'operation_refused',
    'original_target_changed',
    'perf_control_refused',
    'perf_control_timeout',
    'post_enable_original_task_identity_changed',
    'prearm_original_task_identity_changed',
    'preparation_deadline',
    'prior_operation_unresolved',
    'private_ancestry_refused',
    'private_record_bound',
    'private_record_refused',
    'public_coordinates_bound',
    'public_coordinates_refused',
    'public_refusal_category_refused',
    'release_lock_metadata_refused',
    'required_module_custody_unproven',
    'root_linux_required',
    'source_bound',
    'source_identity_refused',
    'supported_dwarf_backend_unavailable',
    'task_census_refused',
    'task_identity_bound',
    'task_start_refused',
    'unit_invocation_required',
    'unit_state_bound',
    'unit_state_unproven',
    'wait_mode_refused',
})


def closed_refusal(error):
    value = str(error) if isinstance(error, RuntimeError) else None
    return value if value in REFUSAL_CODES else 'native_operation_unproven'

def refuse(reason):
    raise RuntimeError(reason)


def operation(value):
    if not isinstance(value, str) or not OPERATION.fullmatch(value):
        refuse('operation_refused')
    return value


def unit_name(op):
    return 'ca-native-fault-' + operation(op) + '.service'


def command(args, timeout=3):
    # stdout is private; callers must classify rather than export command text.
    value = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout, env={**os.environ, 'DEBUGINFOD_URLS': ''})
    if value.returncode != 0 or len(value.stdout) > 1024 * 1024:
        refuse('command_refused')
    return value.stdout


def trusted_directory(path, create=False):
    """Every ancestor is root-owned, directory, non-writable and no-follow."""
    current = Path('/')
    for part in path.parts[1:]:
        current /= part
        if create and not current.exists():
            current.mkdir(mode=0o700)
        value = current.lstat()
        if (not stat.S_ISDIR(value.st_mode) or value.st_uid != 0
                or value.st_mode & 0o022):
            refuse('private_ancestry_refused')
    return path


def read_json(path, limit=1024 * 1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        value = os.fstat(fd)
        if not stat.S_ISREG(value.st_mode) or value.st_uid != 0 or value.st_mode & 0o077:
            refuse('private_record_refused')
        raw = os.read(fd, limit + 1)
        if len(raw) > limit:
            refuse('private_record_bound')
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            refuse('private_record_refused')
        return parsed
    finally:
        os.close(fd)


def write_json(path, value, exclusive=False):
    data = json.dumps(value, separators=(',', ':')).encode()
    if len(data) > 1024 * 1024:
        refuse('private_record_bound')
    import tempfile
    fd, temporary_name = tempfile.mkstemp(prefix=path.name + '.pending-', dir=path.parent)
    temporary = Path(temporary_name)
    os.fchmod(fd, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        if exclusive:
            os.link(temporary, path, follow_symlinks=False)
        else:
            if path.exists():
                read_json(path)  # Do not replace an untrusted record.
            os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def proc_start(pid, tid=None):
    path = f'/proc/{pid}/stat' if tid is None else f'/proc/{pid}/task/{tid}/stat'
    raw = Path(path).read_bytes()
    if len(raw) > 16384:
        refuse('task_identity_bound')
    value = raw.rsplit(b')', 1)[1].split()[19]
    if not value.isdigit():
        refuse('task_start_refused')
    return value.decode()



def engine_health_identity(pid, value, expected):
    import urllib.request
    command_line = Path(f'/proc/{pid}/cmdline').read_bytes()
    executable = os.readlink(f'/proc/{pid}/exe')
    if (executable != '/usr/local/bin/node' or command_line not in
            (b'node\0dist/index.js\0', b'/usr/local/bin/node\0dist/index.js\0')
            or value.get('Config', {}).get('Cmd') != ['node', 'dist/index.js']):
        refuse('engine_process_command_refused')
    cwd = os.stat(f'/proc/{pid}/cwd')
    app = os.stat(f'/proc/{pid}/root/app')
    if (cwd.st_dev, cwd.st_ino) != (app.st_dev, app.st_ino):
        refuse('engine_working_directory_refused')
    status = Path(f'/proc/{pid}/status').read_bytes()
    ns = re.search(rb'^NSpid:\s*([0-9 \t]+)$', status, re.M)
    if len(status) > 65536 or ns is None or ns[1].split()[-1] != b'1':
        refuse('engine_pid1_unproven')
    network = value.get('HostConfig', {}).get('NetworkMode')
    bindings = value.get('NetworkSettings', {}).get('Ports')
    if not isinstance(bindings, dict):
        refuse('fixed_engine_health_binding_unproven')
    ports = bindings.get('8080/tcp')
    published = isinstance(ports, list) and any(isinstance(row, dict) and row.get('HostPort') == '8080'
                and row.get('HostIp') in ('127.0.0.1', '0.0.0.0') for row in ports)
    if network != 'host' and not published:
        refuse('fixed_engine_health_binding_unproven')
    listening = set()
    for name in ('tcp', 'tcp6'):
        raw = Path(f'/proc/{pid}/net/{name}').read_bytes()
        if len(raw) > 1024 * 1024:
            refuse('health_socket_metadata_bound')
        for line in raw.splitlines()[1:]:
            fields = line.split()
            if len(fields) >= 10 and fields[1].rsplit(b':', 1)[-1] == b'1F90' and fields[3] == b'0A':
                listening.add(fields[9].decode())
    owned = False
    for index, entry in enumerate(Path(f'/proc/{pid}/fd').iterdir()):
        if index >= 4096:
            refuse('health_socket_descriptor_bound')
        try:
            descriptor = os.readlink(entry)
        except FileNotFoundError:
            continue
        match = re.fullmatch(r'socket:\[([0-9]+)\]', descriptor)
        if match and match[1] in listening:
            owned = True
            break
    if not owned:
        refuse('engine_health_socket_owner_unproven')
    request = urllib.request.Request('http://127.0.0.1:8080/health', headers={'Cache-Control': 'no-cache, no-store'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=2) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        refuse('engine_health_response_bound')
    health = json.loads(raw)
    if (not isinstance(health, dict) or health.get('releaseSha') != expected
            or health.get('running') is not True or type(health.get('pid')) is not int or health['pid'] != 1
            or not isinstance(health.get('instanceId'), str) or not re.fullmatch(r'1-[0-9a-f]{8}', health['instanceId'])):
        refuse('engine_health_identity_refused')
    return health['instanceId']


DOCKER_IDENTITY_FORMAT = r'''[{"Id":{{json .Id}},"Image":{{json .Image}},"State":{"Pid":{{.State.Pid}},"Running":{{.State.Running}},"Restarting":{{.State.Restarting}},"StartedAt":{{json .State.StartedAt}}},"Config":{"Cmd":{{json .Config.Cmd}},"Labels":{"org.opencontainers.image.revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}},"HostConfig":{"NetworkMode":{{json .HostConfig.NetworkMode}}},"NetworkSettings":{"Ports":{"8080/tcp":{{json (index .NetworkSettings.Ports "8080/tcp")}}}},"Mounts":[{{range $i,$m := .Mounts}}{{if $i}},{{end}}{"Destination":{{json $m.Destination}},"RW":{{$m.RW}}}{{end}}]}]'''


def projected_container():
    # Never read Config.Env, healthcheck logs, or host mount source paths.
    return json.loads(command(['docker', 'inspect', '--format', DOCKER_IDENTITY_FORMAT, CONTAINER]))

def target_identity(expected):
    if not SHA.fullmatch(expected):
        refuse('expected_sha_refused')
    raw = projected_container()
    if not isinstance(raw, list) or len(raw) != 1:
        refuse('container_identity_refused')
    value = raw[0]
    if not isinstance(value, dict) or not isinstance(value.get('Config'), dict) or not isinstance(value['Config'].get('Labels'), dict):
        refuse('container_identity_refused')
    if any(not isinstance(value.get(key), dict) for key in ('State', 'HostConfig', 'NetworkSettings')):
        refuse('container_identity_refused')
    state = value['State']
    pid = state.get('Pid')
    image = value.get('Image', '')
    identifier = value.get('Id', '')
    if (state.get('Running') is not True or state.get('Restarting') is not False
            or type(pid) is not int or pid < 2
            or not re.fullmatch(r'[0-9a-f]{64}', identifier)
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', image)
            or value.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != expected):
        refuse('container_identity_refused')
    before_start = proc_start(pid)
    health_instance = engine_health_identity(pid, value, expected)
    tasks = {}
    for index, entry in enumerate(Path(f'/proc/{pid}/task').iterdir()):
        if index >= 64 or not entry.name.isdigit():
            refuse('task_census_refused')
        tasks[entry.name] = proc_start(pid, int(entry.name))
    if str(pid) not in tasks:
        refuse('leader_identity_refused')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if not re.fullmatch(r'[0-9a-f-]{36}', boot):
        refuse('boot_identity_refused')
    if proc_start(pid) != before_start:
        refuse('engine_process_identity_raced')
    mounts = value.get('Mounts', [])
    if not isinstance(mounts, list) or len(mounts) > 64:
        refuse('container_mount_metadata_refused')
    destinations = [m.get('Destination') for m in mounts if isinstance(m, dict)]
    if len(destinations) != len(mounts) or any(not isinstance(m, str) or not m.startswith('/') for m in destinations):
        refuse('container_mount_metadata_refused')
    return {'container': identifier, 'image': image, 'startedAt': state.get('StartedAt'),
            'pid': pid, 'start': before_start, 'tasks': tasks, 'boot': boot, 'sha': expected,
            'healthInstance': health_instance, 'mountDestinations': destinations}


def same_target(original):
    try:
        current = target_identity(original['sha'])
        return (all(current[key] == original[key] for key in ('container', 'image', 'startedAt', 'pid', 'start', 'boot', 'sha', 'healthInstance', 'mountDestinations'))
                and all(current['tasks'].get(tid) == start for tid, start in original['tasks'].items()))
    except (OSError, ValueError, KeyError, TypeError, AttributeError, RuntimeError, subprocess.SubprocessError):
        return False


def systemd_state(op):
    fields = ('InvocationID', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'ControlGroup', 'LoadState')
    response = subprocess.run(['systemctl', 'show', unit_name(op), '--no-pager',
                   '--property=' + ','.join(fields)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
    raw = response.stdout
    if len(raw) > 16384:
        refuse('unit_state_bound')
    values = dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)
    if set(values) != set(fields) or response.returncode and values.get('LoadState') != 'not-found':
        refuse('unit_state_unproven')
    return values




def refusal_category(error, perf_stderr=b''):
    if isinstance(error, PermissionError):
        return 'permission'
    raw = perf_stderr.lower() if isinstance(perf_stderr, bytes) and len(perf_stderr) <= 8192 else b''
    for category, tokens in (
        ('permission', (b'permission denied', b'operation not permitted', b'perf_event_paranoid')),
        ('tracepoint', (b'unknown tracepoint', b'cannot find tracepoint', b'unable to find debugfs')),
        ('decode', (b'cannot unwind', b'libdw', b'unsupported register'))):
        if any(token in raw for token in tokens):
            return category
    reason = str(error) if isinstance(error, RuntimeError) else ''
    for category, token in (('deadline', 'deadline'), ('module', 'module'), ('task_identity', 'target'),
                            ('task_identity', 'task_identity'), ('source_identity', 'source_identity'),
                            ('storage', 'storage'), ('control', 'control'), ('decode', 'unwind'),
                            ('backend', 'backend')):
        if token in reason:
            return category
    return 'other'

def public_result(result):
    reasons = {'native_fault_coordinates', 'native_callsite_unproven',
               'expired_without_admitted_fault', 'native_capture_refused'}
    if not isinstance(result, dict) or result.get('verdict') != 'UNKNOWN' or result.get('reason') not in reasons:
        return {'verdict': 'UNKNOWN', 'reason': 'native_capture_refused', 'coordinates': []}
    coordinates = result.get('coordinates', [])
    if not isinstance(coordinates, list) or len(coordinates) > 256:
        refuse('public_coordinates_bound')
    rows = []
    for row in coordinates:
        if (not isinstance(row, dict) or set(row) != {'event', 'module', 'buildID', 'binarySHA256', 'offset', 'symbol'}
                or type(row['event']) is not int or not 0 <= row['event'] < 8
                or row['module'] not in ('node', 'libc', 'addon')
                or not isinstance(row['buildID'], str) or not re.fullmatch(r'[0-9a-f]{16,128}', row['buildID'])
                or not isinstance(row['binarySHA256'], str) or not re.fullmatch(r'[0-9a-f]{64}', row['binarySHA256'])
                or type(row['offset']) is not int or not 0 <= row['offset'] <= MAX_MODULE_BYTES
                or row['symbol'] is not None and (not isinstance(row['symbol'], str)
                    or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_:$<>., ()~*&+@/-]{0,159}', row['symbol']))):
            refuse('public_coordinates_refused')
        rows.append(dict(row))
    category = result.get('refusalCategory')
    if category not in (None, 'permission', 'tracepoint', 'decode', 'deadline', 'module', 'task_identity', 'source_identity', 'storage', 'control', 'backend', 'other'):
        refuse('public_refusal_category_refused')
    code = result.get('refusalCode')
    phase = result.get('refusalPhase')
    if code is not None and code not in REFUSAL_CODES and code != 'native_operation_unproven':
        refuse('public_refusal_category_refused')
    if phase not in (None, 'preparing', 'arming', 'observing', 'decoding'):
        refuse('public_refusal_category_refused')
    counts = {}
    for key, maximum in (('eventCount', 8), ('unresolvedFrameCount', 1000000)):
        value = result.get(key)
        if value is not None and (type(value) is not int or not 0 <= value <= maximum):
            refuse('public_coordinates_refused')
        counts[key] = value
    exited = result.get('originalLeaderExited')
    if exited is not None and type(exited) is not bool:
        refuse('public_coordinates_refused')
    return {'verdict': 'UNKNOWN', 'reason': result['reason'], 'coordinates': rows, **counts,
            'originalLeaderExited': exited, 'refusalCategory': category, 'refusalCode': code, 'refusalPhase': phase}

def terminal_witness(op, record, state, raw_empty, cgroup_empty):
    """Pure closed terminal proof. A helper-written receipt alone cannot certify."""
    invocation = record.get('invocation')
    same = bool(isinstance(invocation, str) and INVOCATION.fullmatch(invocation)
                and state.get('InvocationID') == invocation)
    terminal = state.get('ActiveState') in ('inactive', 'failed') and state.get('SubState') in ('dead', 'failed')
    result = public_result(record.get('result', {}))
    cleanup = record.get('cleanup') == 'removed' and raw_empty is True and cgroup_empty is True
    return {'schema': 'native-fault-observation/v1', 'operation': operation(op),
            'sameInvocation': same, 'terminal': terminal,
            'helperCgroupEmpty': cgroup_empty is True, 'privateRawRemoved': raw_empty is True,
            'cleanupConfirmed': same and terminal and cleanup,
            'verdict': result.get('verdict', 'UNKNOWN') if same and terminal and cleanup else 'UNKNOWN',
            'reason': result.get('reason', 'terminal_proof_pending') if same and terminal and cleanup else 'terminal_proof_pending',
            'coordinates': result.get('coordinates', []) if same and terminal and cleanup else [],
            'taskCoverage': 'original_snapshot_only_new_threads_unknown',
            'refusalCategory': result.get('refusalCategory') if same and terminal and cleanup else None,
            'refusalCode': result.get('refusalCode') if same and terminal and cleanup else None,
            'refusalPhase': result.get('refusalPhase') if same and terminal and cleanup else None,
            'eventCount': result.get('eventCount') if same and terminal and cleanup else None,
            'unresolvedFrameCount': result.get('unresolvedFrameCount') if same and terminal and cleanup else None,
            'originalLeaderExited': result.get('originalLeaderExited') if same and terminal and cleanup else None,
            'offsetKind': 'mapped_elf_file_offset',
            'productionCauseProven': False}


def cgroup_is_empty(op, state):
    expected = '/system.slice/' + unit_name(op)
    reported = state.get('ControlGroup')
    if reported not in ('', expected):
        return False
    group = Path('/sys/fs/cgroup' + expected)
    if not group.exists():
        return True
    try:
        # KillMode=control-group applies only to this dedicated helper unit.
        raw = (group / 'cgroup.events').read_text()
        return bool(re.search(r'^populated 0$', raw, re.M))
    except OSError:
        return False



MANAGER_SUCCESS = '7ad2d189f7e94e70a38c781354912448'
MANAGER_FAILURE = 'd9b373ed55a64feb8242e02dbe79a49c'


def journal_terminal_witness(op, record, rows):
    """PID1's structured terminal event, never worker text or a start-job event."""
    if not isinstance(rows, list) or not 1 <= len(rows) < 32:
        return False
    invocation = record.get('invocation', '')
    target = record.get('target', {})
    boot = target.get('boot', '').replace('-', '')
    admitted = record.get('admittedMonotonicUS')
    cleanup = record.get('cleanupMonotonicUS')
    if (not isinstance(invocation, str) or not INVOCATION.fullmatch(invocation) or not re.fullmatch(r'[0-9a-f]{32}', boot)
            or type(admitted) is not int or type(cleanup) is not int or cleanup < admitted):
        return False
    matches = []
    for row in rows:
        if not isinstance(row, dict):
            return False
        timestamp = row.get('__MONOTONIC_TIMESTAMP')
        if (row.get('_PID') != '1' or row.get('_UID') != '0' or row.get('_TRANSPORT') != 'journal'
                or row.get('_BOOT_ID') != boot or row.get('UNIT') != unit_name(op)
                or row.get('INVOCATION_ID') != invocation
                or row.get('MESSAGE_ID') not in (MANAGER_SUCCESS, MANAGER_FAILURE)
                or not isinstance(timestamp, str) or not timestamp.isdigit()
                or not admitted <= cleanup <= int(timestamp)):
            return False
        matches.append(row)
    return len(matches) == 1


def manager_journal_terminal(op, record):
    invocation = record.get('invocation', '')
    if not isinstance(invocation, str) or not INVOCATION.fullmatch(invocation):
        return False
    fields = '_PID,_UID,_TRANSPORT,_BOOT_ID,UNIT,INVOCATION_ID,MESSAGE_ID,__MONOTONIC_TIMESTAMP'
    raw = command(['journalctl', '--boot=0', '--no-pager', '--quiet', '--output=json',
                   '--output-fields=' + fields, '--lines=32', '_PID=1', '_UID=0',
                   'UNIT=' + unit_name(op), 'INVOCATION_ID=' + invocation,
                   'MESSAGE_ID=' + MANAGER_SUCCESS, 'MESSAGE_ID=' + MANAGER_FAILURE], timeout=3)
    if len(raw) > 65536:
        return False
    return journal_terminal_witness(op, record, [json.loads(line) for line in raw.splitlines()])


def receipt(op):
    folder = trusted_directory(STATE / operation(op))
    record = read_json(folder / 'operation.json')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if record.get('target', {}).get('boot') != boot:
        refuse('operation_boot_changed')
    state = systemd_state(op)
    raw = RAW / op
    raw_empty = not os.path.lexists(raw)
    evidence = 'loaded_manager_state'
    if (state.get('InvocationID') != record.get('invocation')
            or state.get('ActiveState') not in ('inactive', 'failed')):
        if state.get('LoadState') == 'not-found' and manager_journal_terminal(op, record):
            state = {'InvocationID': record['invocation'], 'ActiveState': 'inactive',
                     'SubState': 'dead', 'ControlGroup': ''}
            evidence = 'manager_terminal_journal'
    result = terminal_witness(op, record, state, raw_empty, cgroup_is_empty(op, state))
    result['managerTerminalEvidence'] = evidence if result['cleanupConfirmed'] else 'unproven'
    expected = record.get('target', {}).get('sha', '')
    result['engineSHA'] = expected if isinstance(expected, str) and SHA.fullmatch(expected) else None
    result['originalIdentitySHA256'] = hashlib.sha256(json.dumps(record['target'],sort_keys=True,separators=(',', ':')).encode()).hexdigest()
    return result


def unit_arguments(op, source):
    """Closed target and finite helper cgroup; no observed-engine process in it."""
    return ['systemd-run', '--unit=' + unit_name(op), '--service-type=exec', '--quiet',
            '--property=Restart=no', '--property=RuntimeMaxSec=' + str(UNIT_SECONDS),
            '--property=TimeoutStopSec=5', '--property=KillMode=control-group',
            '--property=UMask=0077', '--property=LimitCORE=0', '--property=MemoryMax=512M', '--property=TasksMax=16',
            '--property=LimitFSIZE=' + str(MAX_MODULE_BYTES), '--property=NoNewPrivileges=yes',
            '--property=ExecStopPost=/usr/bin/python3 ' + str(source) + ' stop-post --operation ' + op,
            '/usr/bin/python3', str(source), 'collect', '--operation', op]


def admit(op, expected, source):
    if os.geteuid() != 0 or sys.platform != 'linux':
        refuse('root_linux_required')
    trusted_directory(STATE, create=True)
    trusted_directory(RAW, create=True)
    lock = os.open(STATE / 'admission.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        active = STATE / 'active.json'
        if active.exists():
            prior = read_json(active)
            if prior.get('operation') == op:
                # A missing/unknown acknowledgement never permits a second start.
                return {'operation': op, 'phase': 'existing_operation_read_receipt'}
            if not receipt(operation(prior.get('operation')))['cleanupConfirmed']:
                refuse('prior_operation_unresolved')
        release = os.open('/var/lock/club-arena-engine-up.lock', os.O_RDWR | os.O_NOFOLLOW)
        try:
            release_meta = os.fstat(release)
            if not stat.S_ISREG(release_meta.st_mode) or release_meta.st_uid != 0 or release_meta.st_mode & 0o022:
                refuse('release_lock_metadata_refused')
            fcntl.flock(release, fcntl.LOCK_EX | fcntl.LOCK_NB)
            original = target_identity(expected)
            # No tool installation, tracefs mount or host configuration mutation.
            for tool in ('/usr/bin/perf', '/usr/bin/systemd-run', '/usr/bin/readelf'):
                if not Path(tool).is_file() or not os.access(tool, os.X_OK):
                    refuse('native_prerequisite_unavailable')
            folder = STATE / op
            folder.mkdir(mode=0o700)
            source_raw = Path(source).read_bytes()
            if len(source_raw) > 128 * 1024:
                refuse('source_bound')
            destination = folder / 'controller.py'
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(source_raw); stream.flush(); os.fsync(stream.fileno())
            record = {'operation': op, 'target': original, 'sourceSHA256': hashlib.sha256(source_raw).hexdigest(),
                      'phase': 'prepared', 'invocation': None, 'cleanup': 'pending',
                      'admittedMonotonicUS': time.monotonic_ns() // 1000}
            write_json(folder / 'operation.json', record, exclusive=True)
            write_json(active, {'operation': op})
        finally:
            os.close(release)
        # Exclusive durable operation is now authoritative. Engine lock is closed
        # before the host-owned unit starts or waits; replacement refuses in collect.
        command(unit_arguments(op, destination), timeout=5)
        return {'operation': op, 'phase': 'submitted_read_receipt'}
    finally:
        os.close(lock)



def build_id(path):
    raw = command(['/usr/bin/readelf', '--notes', str(path)], timeout=2)
    matches = re.findall(rb'Build ID: ([0-9a-f]{16,128})', raw)
    if len(matches) != 1:
        refuse('module_build_id_unproven')
    return matches[0].decode()



def mapped_module_class(path, original):
    if not isinstance(path, str) or len(path) > 512:
        return None
    mounts = original.get('mountDestinations', [])
    if any(path == mount or path.startswith(mount.rstrip('/') + '/') for mount in mounts):
        return None
    if path == '/usr/local/bin/node':
        return 'node'
    if path in ('/usr/lib/x86_64-linux-gnu/libc.so.6', '/lib/x86_64-linux-gnu/libc.so.6'):
        return 'libc'
    if (re.fullmatch(r'/app/(?:[A-Za-z0-9_.@+-]+/)*[A-Za-z0-9_.+-]+\.node', path)
            and not any(part in ('.', '..') for part in Path(path).parts)):
        return 'addon'
    return None


def copy_module_bytes(fd, destination, size, deadline):
    """Attest the retained bytes, never merely the bytes read from the source."""
    if type(size) is not int or not 1 <= size <= MAX_MODULE_BYTES:
        refuse('module_storage_bound')
    source_digest = hashlib.sha256()
    out = os.open(destination, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        remaining = size
        while remaining:
            if time.monotonic() >= deadline:
                refuse('preparation_deadline')
            block = os.read(fd, min(1024 * 1024, remaining))
            if not block:
                refuse('module_copy_incomplete')
            if os.write(out, block) != len(block):
                refuse('module_copy_short_write')
            source_digest.update(block)
            remaining -= len(block)
        os.fsync(out)
        if os.fstat(out).st_size != size:
            refuse('retained_module_attestation_refused')
        os.lseek(out, 0, os.SEEK_SET)
        retained_digest = hashlib.sha256()
        remaining = size
        while remaining:
            if time.monotonic() >= deadline:
                refuse('preparation_deadline')
            block = os.read(out, min(1024 * 1024, remaining))
            if not block:
                refuse('retained_module_attestation_refused')
            retained_digest.update(block)
            remaining -= len(block)
        if retained_digest.digest() != source_digest.digest() or os.fstat(out).st_size != size:
            refuse('retained_module_attestation_refused')
        return retained_digest.hexdigest()
    finally:
        os.close(out)

def prepare_modules(original, folder, deadline):
    """Copy only fixed mapped ELF modules, before observation under unit custody."""
    pid = original['pid']
    raw = Path(f'/proc/{pid}/maps').read_bytes()
    if len(raw) > 1024 * 1024:
        refuse('maps_bound')
    maps = []
    modules = {}
    total = 0
    symfs = folder / 'symfs'
    symfs.mkdir(mode=0o700)
    for line in raw.decode().splitlines():
        fields = line.split(maxsplit=5)
        if len(fields) != 6:
            continue
        span, permissions, offset, device, inode, path = fields
        module_class = mapped_module_class(path, original)
        if module_class is None:
            continue
        if 'x' not in permissions:
            continue
        if time.monotonic() >= deadline:
            refuse('preparation_deadline')
        start, end = [int(value, 16) for value in span.split('-')]
        fd = os.open(f'/proc/{pid}/root' + path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            meta = os.fstat(fd)
            major, minor = [int(value, 16) for value in device.split(':')]
            if (not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o022
                    or meta.st_ino != int(inode) or os.major(meta.st_dev) != major
                    or os.minor(meta.st_dev) != minor):
                refuse('mapped_module_custody_refused')
            if path not in modules:
                if module_class == 'addon' and sum(m['class'] == 'addon' for m in modules.values()) >= 16:
                    refuse('native_module_count_bound')
                total += meta.st_size
                if meta.st_size < 1 or total > MAX_MODULE_BYTES:
                    refuse('module_storage_bound')
                destination = symfs / path.lstrip('/')
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                retained_hash = copy_module_bytes(fd, destination, meta.st_size, deadline)
                after = os.fstat(fd)
                if (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                        meta.st_ino, meta.st_size, meta.st_mtime_ns, meta.st_ctime_ns):
                    refuse('module_copy_raced')
                modules[path] = {'class': module_class, 'buildID': build_id(destination),
                                 'sha256': retained_hash}
            maps.append({'start': start, 'end': end, 'offset': int(offset, 16), 'path': path})
        finally:
            os.close(fd)
    if not {'node', 'libc'}.issubset({value['class'] for value in modules.values()}):
        refuse('required_module_custody_unproven')
    return {'maps': maps, 'modules': modules, 'symfs': str(symfs)}


def read_ack(fd, timeout):
    import select
    end = time.monotonic() + min(3, timeout)
    expected, value = b'ack\n\0', b''
    while len(value) < len(expected):
        left = end - time.monotonic()
        if left <= 0 or not select.select([fd], [], [], left)[0]:
            refuse('perf_control_timeout')
        block = os.read(fd, len(expected) + 1 - len(value))
        if not block:
            refuse('perf_control_refused')
        value += block
        if not expected.startswith(value):
            refuse('perf_control_refused')
    if select.select([fd], [], [], 0)[0]:
        refuse('perf_control_refused')


def decoded_coordinates(raw, original, custody):
    """Only module-relative static ELF coordinates; unresolved frames stay UNKNOWN."""
    if not isinstance(raw, str) or len(raw) > 8 * 1024 * 1024:
        refuse('decode_bound')
    events = []
    for line in raw.splitlines():
        if 'signal:signal_generate:' in line:
            if len(events) >= 8:
                refuse('native_event_bound')
            prefix = line.split('signal:signal_generate:', 1)[0]
            numbers = re.findall(r'(?<![A-Za-z0-9_])[0-9]+', prefix)
            if (len(numbers) != 2 or int(numbers[0]) != original['pid']
                    or numbers[1] not in original['tasks']
                    or not re.search(r'\bsig=11\b', line) or not re.search(r'\bcode=128\b', line)):
                refuse('native_task_attribution_refused')
            events.append({'coordinates': [], 'unresolved': 0})
        elif events and re.match(r'^\s*[0-9a-fA-F]+\s+', line):
            match = re.fullmatch(r'\s*([0-9a-fA-F]+)\s+(.{1,512}?)\s+\(([^\n]{1,512})\)\s*', line)
            if not match:
                events[-1]['unresolved'] += 1; continue
            address = int(match[1], 16)
            mapped = [m for m in custody['maps'] if m['start'] <= address < m['end'] and m['path'] == match[3]]
            if len(mapped) != 1 or len(events[-1]['coordinates']) >= 32:
                events[-1]['unresolved'] += 1; continue
            region = mapped[0]
            module = custody['modules'][region['path']]
            relative = address - region['start'] + region['offset']
            # Symbols are optional: coordinates remain tied to exact ELF custody.
            symbol = match[2]
            resolved = bool(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_:$<>., ()~*&+@/-]{0,159}', symbol)
                            and '[unknown]' not in symbol)
            events[-1]['coordinates'].append({'module': module['class'], 'buildID': module['buildID'],
                                               'binarySHA256': module['sha256'], 'offset': relative,
                                               'symbol': symbol if resolved else None})
    coordinates = []
    for index, event in enumerate(events):
        for frame in event['coordinates']:
            coordinates.append({'event': index, **frame})
    return {'verdict': 'UNKNOWN', 'reason': 'native_fault_coordinates' if coordinates else 'native_callsite_unproven',
            'eventCount': len(events), 'coordinates': coordinates,
            'unresolvedFrameCount': sum(e['unresolved'] for e in events),
            'taskCoverage': 'original_snapshot_only_new_threads_unknown',
            'productionCauseProven': False}


def collect(op):
    import resource
    import select
    import tempfile
    folder = trusted_directory(STATE / op)
    path = folder / 'operation.json'
    record = read_json(path)
    invocation = os.environ.get('INVOCATION_ID', '')
    if not isinstance(invocation, str) or not INVOCATION.fullmatch(invocation):
        refuse('unit_invocation_required')
    source = Path(__file__).read_bytes()
    if hashlib.sha256(source).hexdigest() != record['sourceSHA256']:
        refuse('source_identity_refused')
    record.update(invocation=invocation, phase='preparing')
    write_json(path, record)
    raw_folder = RAW / op
    raw_folder.mkdir(mode=0o700)
    original = record['target']
    pidfd = os.pidfd_open(original['pid'])
    perf = None
    descriptors = []
    try:
        deadline = time.monotonic() + PREPARE_SECONDS
        if not same_target(original):
            refuse('original_target_changed')
        features = command(['/usr/bin/perf', 'version', '--build-options'], timeout=2)
        if not re.search(rb'libdw-dwarf-unwind:\s*\[\s*on\s*\]', features):
            refuse('supported_dwarf_backend_unavailable')
        custody = prepare_modules(original, raw_folder, deadline)
        if time.monotonic() >= deadline or not same_target(original):
            refuse('prearm_original_task_identity_changed')
        ctl_read, ctl_write = os.pipe(); ack_read, ack_write = os.pipe()
        descriptors = [ctl_read, ctl_write, ack_read, ack_write]
        data = raw_folder / 'perf.data'
        error = raw_folder / 'perf.stderr'
        stderr = error.open('xb'); os.chmod(error, 0o600)
        def limits():
            os.umask(0o077)
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_PERF_BYTES, MAX_PERF_BYTES))
        args = ['/usr/bin/perf', 'record', '--quiet', '--no-inherit', '--no-buildid-cache', '--delay=-1',
                '--control=fd:' + str(ctl_read) + ',' + str(ack_write),
                '--event=signal:signal_generate', '--filter=sig == 11 && code == 128',
                '--tid=' + ','.join(original['tasks']), '--call-graph=dwarf,8192', '--mmap-pages=64',
                '--max-size=256K', '--output=' + str(data)]
        record.update(phase='arming'); write_json(path, record)
        perf = subprocess.Popen(args, pass_fds=(ctl_read, ack_write), stdout=subprocess.DEVNULL,
                                stderr=stderr, preexec_fn=limits, env={**os.environ, 'DEBUGINFOD_URLS': ''})
        os.close(ctl_read); os.close(ack_write); descriptors = [ctl_write, ack_read]
        for action in ('ping', 'enable'):
            if not same_target(original) or time.monotonic() >= deadline:
                refuse('prearm_original_task_identity_changed')
            os.write(ctl_write, (action + '\n').encode())
            read_ack(ack_read, min(3, deadline - time.monotonic()))
        if not same_target(original):
            refuse('post_enable_original_task_identity_changed')
        record.update(phase='observing', armed=True)
        write_json(path, record)
        exited = bool(select.select([pidfd], [], [], OBSERVATION_SECONDS)[0])
        if perf.poll() is None:
            os.write(ctl_write, b'stop\n')
        perf.wait(timeout=STOP_SECONDS)
        stderr.close()
        if perf.returncode != 0 or not data.is_file() or data.stat().st_size > MAX_PERF_BYTES:
            refuse('bounded_perf_capture_refused')
        if not exited and not same_target(original):
            refuse('observed_original_target_changed')
        record.update(phase='decoding'); write_json(path, record)
        # Decoding writes to a private bounded file, never a terminal or artifact.
        rendered = raw_folder / 'decoded.private'
        with rendered.open('xb') as stream, error.open('ab') as errors:
            os.chmod(rendered, 0o600)
            decoded = subprocess.run(['/usr/bin/perf', 'script', '--input=' + str(data),
                                      '--symfs=' + custody['symfs'], '-F', 'comm,pid,tid,event,ip,sym,dso,trace'],
                                     stdout=stream, stderr=errors, timeout=DECODE_SECONDS,
                                     preexec_fn=limits, env={**os.environ, 'DEBUGINFOD_URLS': ''})
        if decoded.returncode != 0 or rendered.stat().st_size > MAX_PERF_BYTES:
            refuse('native_unwind_refused')
        result = decoded_coordinates(rendered.read_text(errors='replace'), original, custody)
        result['originalLeaderExited'] = exited
        if not exited and result['eventCount'] == 0:
            result['reason'] = 'expired_without_admitted_fault'
        record.update(phase='collected', result=result)
        write_json(path, record)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError) as failure:
        private_error = b''
        if 'error' in locals() and error.is_file():
            with error.open('rb') as stream:
                private_error = stream.read(8192)
        category = refusal_category(failure, private_error)
        refusal_phase = record['phase'] if record['phase'] in ('preparing', 'arming', 'observing', 'decoding') else None
        record.update(phase='refused', result={'verdict': 'UNKNOWN', 'reason': 'native_capture_refused',
                                              'coordinates': [], 'refusalCategory': category,
                                              'refusalCode': closed_refusal(failure), 'refusalPhase': refusal_phase})
        write_json(path, record)
        # Manager owns finite stop and post-stop cleanup even if perf is stuck.
        raise
    finally:
        os.close(pidfd)
        for fd in descriptors:
            try:
                os.close(fd)
            except OSError:
                pass
    return None


def stop_post(op):
    import shutil
    folder = trusted_directory(STATE / op)
    path = folder / 'operation.json'
    record = read_json(path)
    invocation = os.environ.get('INVOCATION_ID', '')
    if not isinstance(invocation, str) or not INVOCATION.fullmatch(invocation):
        refuse('cleanup_invocation_refused')
    manager = systemd_state(op)
    if manager.get('InvocationID') != invocation or record.get('invocation') not in (None, invocation):
        refuse('cleanup_invocation_refused')
    if hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != record['sourceSHA256']:
        refuse('cleanup_source_refused')
    # Only the manager's matching stop-post invocation may remove its fixed raw
    # directory. A killed controller before its first write still has this proof.
    raw = RAW / op
    if os.path.lexists(raw):
        trusted_directory(raw)
        shutil.rmtree(raw)
    record.update(invocation=invocation, cleanup='removed', phase='stopped',
                  cleanupMonotonicUS=time.monotonic_ns() // 1000)
    write_json(path, record)
    return None


def wait_receipt(op):
    deadline = time.monotonic() + UNIT_SECONDS + STOP_SECONDS + RECEIPT_SECONDS
    while True:
        value = receipt(op)
        if value['cleanupConfirmed'] or time.monotonic() >= deadline:
            return value
        # A bounded, read-only wait on this one operation; never an arm/retry.
        time.sleep(min(.5, max(0, deadline - time.monotonic())))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('admit', 'collect', 'stop-post', 'receipt'))
    parser.add_argument('--operation', required=True)
    parser.add_argument('--expected-engine-sha')
    parser.add_argument('--wait', action='store_true')
    args = parser.parse_args()
    op = operation(args.operation)
    if args.wait and args.mode != 'receipt':
        refuse('wait_mode_refused')
    if args.mode == 'admit':
        result = admit(op, args.expected_engine_sha or '', Path(__file__).resolve())
    elif args.mode == 'receipt':
        result = wait_receipt(op) if args.wait else receipt(op)
    elif args.mode == 'collect':
        result = collect(op)
    else:
        result = stop_post(op)
    if result is not None:
        print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({'verdict': 'UNKNOWN', 'reason': 'native_observation_refused',
                          'refusalCode': closed_refusal(error),
                          'refusalPhase': sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ('admit', 'collect', 'stop-post', 'receipt') else 'entry'}, separators=(',', ':')))
        sys.exit(1)
