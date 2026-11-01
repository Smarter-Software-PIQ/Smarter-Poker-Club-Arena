#!/usr/bin/env python3
"""Real isolated systemd qualification; never a production controller entry point.

The fixed engine name, observation roots and lock must initially be absent. Only
containers/units created by this process may be stopped. No raw perf/journal,
process identities, paths, private keys or target data enter the output receipt.
"""
import argparse
import ast
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import textwrap
import time

ROOT = Path(__file__).resolve().parents[3]
CONTROLLER = ROOT / 'scripts/ci/native-fault-observation.py'
SSH_FAILURE_EVIDENCE = None
SSH_DIAGNOSTIC_LIMIT = 65536


class PrivatePipe:
    """Drain continuously without blocking SSH or retaining unbounded diagnostics."""
    def __init__(self, stream):
        self.data = bytearray()
        self.truncated = False
        self.lock = threading.Lock()
        def drain():
            try:
                while block := os.read(stream.fileno(), 4096):
                    with self.lock:
                        remaining = SSH_DIAGNOSTIC_LIMIT - len(self.data)
                        self.data.extend(block[:remaining])
                        self.truncated |= len(block) > remaining
            except OSError:
                pass
        self.thread = threading.Thread(target=drain, daemon=True)
        self.thread.start()

    def snapshot(self):
        with self.lock:
            return bytes(self.data), self.truncated


def closed_ssh_evidence(stdout, stderr, server, status, truncated=False):
    """Only closed categories/codes escape; private text, paths and keys never do."""
    markers = {
        'authentication_refused': (b'permission denied (publickey', b'failed publickey', b'authentication refused'),
        'authentication_accepted': (b'authenticated to ', b'accepted publickey'),
        'account_refused': (b'account is locked', b'account configuration', b'not allowed because'),
        'host_key_refused': (b'host key verification failed', b'remote host identification has changed'),
        'connection_refused': (b'connection refused', b'connection timed out', b'no route to host'),
        'session_refused': (b'open failed: administratively prohibited', b'could not chdir', b'cannot execute'),
    }
    private = (stderr + b'\n' + server).lower()
    categories = [name for name, needles in markers.items() if any(needle in private for needle in needles)]
    # Read only the maintained finite code declaration, never execute the controller.
    codes = set()
    for node in ast.parse(CONTROLLER.read_text()).body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'REFUSAL_CODES' for target in node.targets):
            codes = set(ast.literal_eval(node.value.args[0])) | {'native_operation_unproven'}
    remote_code = remote_phase = None
    if not truncated:
        for line in stdout.splitlines()[:8]:
            try:
                value = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if not isinstance(value, dict):
                continue
            if isinstance(value.get('refusalCode'), str) and value['refusalCode'] in codes:
                remote_code = value['refusalCode']
                phase = value.get('refusalPhase')
                remote_phase = phase if phase in ('admit', 'collect', 'stop-post', 'receipt', 'entry', 'preparing', 'arming', 'observing', 'decoding') else None
    if remote_code:
        categories.append('remote_admit_refused')
    return {'categories': sorted(set(categories)) or ['unknown'],
            'clientState': 'running' if status is None else 'exited',
            'clientExitStatus': status if type(status) is int and -128 <= status <= 255 else None,
            'remoteRefusalCode': remote_code, 'remoteRefusalPhase': remote_phase,
            'diagnosticBoundExceeded': bool(truncated)}
ASSETS = Path(__file__).resolve().parent
IMAGE = 'node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5'
STATE = Path('/var/lib/club-arena-native-fault')
RAW = Path('/run/club-arena-native-fault')
LOCK = Path('/var/lock/club-arena-engine-up.lock')
CONTAINER = 'club-arena-engine'
SUCCESS = '7ad2d189f7e94e70a38c781354912448'
FAILURE = 'd9b373ed55a64feb8242e02dbe79a49c'
FIELDS = 'MESSAGE_ID,UNIT,INVOCATION_ID,UNIT_RESULT,_PID,_UID,_BOOT_ID,_TRANSPORT,__MONOTONIC_TIMESTAMP'
OPTIMIZED_FAULT = r'''
#include <node_api.h>
#include <stdint.h>
__attribute__((noinline,visibility("default"))) void sp_fault_leaf(void) {
    *(volatile uint64_t *)(uintptr_t)0x8000000000000000ULL = 1;
}
__attribute__((noinline,visibility("default"))) void sp_fault_caller(void) {
    sp_fault_leaf();
    __asm__ volatile("" ::: "memory");
}
static napi_value fault(napi_env env, napi_callback_info info) {
    (void)env; (void)info; sp_fault_caller(); return NULL;
}
static napi_value init(napi_env env, napi_value exports) {
    napi_value fn; napi_create_function(env,"fault",5,fault,NULL,&fn);
    napi_set_named_property(env,exports,"fault",fn); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
'''
ENGINE_TARGET = r'''
// Disposable engine-shaped qualification subject; no product code or games.
const fs=require('node:fs'), http=require('node:http'), crypto=require('node:crypto');
const addon=require('/app/native/build/fixture_fault.node');
const instanceId=`${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const health={running:true,pid:process.pid,releaseSha:'__EXPECTED_ENGINE_SHA__',instanceId};
const server=http.createServer((req,res)=>{res.writeHead(req.url==='/health'?200:404,{'content-type':'application/json'});res.end(JSON.stringify(req.url==='/health'?health:{}));});
server.listen(8080,'0.0.0.0',()=>fs.writeFileSync('/fixture-control/ready',JSON.stringify({pid:process.pid,version:process.version})));
const timer=setInterval(()=>{if(!fs.existsSync('/fixture-control/fire'))return;clearInterval(timer);if(process.env.FIXTURE_MODE==='storm'){addon.storm();server.close();}else addon.fault();},10);
'''



def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def run(args, timeout=10, check=True, pass_fds=(), input=None):
    value = subprocess.run(args, stdin=subprocess.DEVNULL if input is None else None, input=input, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout, pass_fds=pass_fds,
                           env={**os.environ, 'DEBUGINFOD_URLS': '', 'PYTHONDONTWRITEBYTECODE': '1'})
    require(len(value.stdout) + len(value.stderr) <= 1024 * 1024, 'fixture_command_output_bound')
    require(not check or value.returncode == 0, 'fixture_command_refused')
    return value


def wait_for(callback, seconds, reason, interval=.05):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = callback()
        if value:
            return value
        time.sleep(interval)
    raise RuntimeError(reason)


def read_json(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_size <= 1024 * 1024,
            'fixture_private_record_refused')
    return json.loads(path.read_bytes())


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


def span(value):
    if value.isdigit():
        return int(value) / 1000000
    pieces = re.findall(r'([0-9]+)(min|ms|us|s|h)', value)
    require(pieces and re.sub(r'([0-9]+)(min|ms|us|s|h)|\s+', '', value) == '',
            'fixture_unit_duration_refused')
    return sum(int(number) * {'us': .000001, 'ms': .001, 's': 1, 'min': 60, 'h': 3600}[unit]
               for number, unit in pieces)


def isolated_routes(rows, version):
    require(isinstance(rows, list) and len(rows) <= 128, 'fixture_route_metadata_bound')
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get('dst'), str), 'fixture_route_metadata_refused')
        require(row['dst'] != 'default' and 'gateway' not in row, 'fixture_external_route_present')
        try:
            network = ipaddress.ip_network(row['dst'], strict=False)
        except ValueError:
            raise RuntimeError('fixture_route_metadata_refused') from None
        require(network.version == version and network.prefixlen > 0, 'fixture_external_route_present')
        if version == 6:
            require(network.is_loopback or network.is_link_local or network.is_multicast,
                    'fixture_external_ipv6_route_present')


class Scene:
    def __init__(self, folder):
        self.folder = folder
        self.operations = []
        self.containers = set()
        self.units = []
        self.client = None
        self.current = None
        self.case_number = 0
        self.base = str(os.getpid()) + str(int(time.time()))[-7:]
        self.expected = hashlib.sha1(CONTROLLER.read_bytes()).hexdigest()
        self.ssh_unit = 'ca-native-fixture-sshd-' + str(os.getpid()) + '.service'
        self.lock_identity = None
        self.modules = {}
        self.images = {}
        self.network = None
        self.client_pipes = []
        self.ssh_log = None

    def docker(self, *args, **kwargs):
        return run(['docker', *args], **kwargs).stdout.decode().strip()

    def start(self, kind='optimized'):
        require(not self.docker('ps', '-a', '--filter', 'name=^/' + CONTAINER + '$', '--format', '{{.ID}}'),
                'fixture_foreign_container_present')
        destination = self.folder / ('target-' + str(len(self.containers)))
        destination.mkdir(mode=0o700)
        image = self.images[kind]
        identifier = self.docker('run', '-d', '--name', CONTAINER, '--network=' + self.network,
                                 '--publish', '127.0.0.1:8080:8080', '--dns', '127.0.0.1', '--read-only',
                                 '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=512m',
                                 '--memory-swap=512m', '--pids-limit=64', '--ulimit', 'core=0',
                                 '-v', str(destination) + ':/fixture-control', image)
        require(re.fullmatch(r'[0-9a-f]{64}', identifier), 'fixture_container_id_refused')
        self.containers.add(identifier)
        self.current = identifier
        wait_for(lambda: (destination / 'ready').exists(), 10, 'fixture_target_readiness')
        require(read_json(destination / 'ready') == {'pid': 1, 'version': 'v22.23.2'},
                'fixture_pinned_target_refused')
        self.isolate_target_network(identifier)
        return destination

    def network_binding(self, identifier):
        require(identifier in self.containers and identifier == self.current, 'fixture_foreign_network_subject')
        template = ('{"id":{{json .Id}},"pid":{{.State.Pid}},"running":{{.State.Running}},'
                    '"started":{{json .State.StartedAt}},"dns":{{json .HostConfig.Dns}},'
                    '"ports":{{json .NetworkSettings.Ports}}}')
        value = json.loads(self.docker('inspect', '--format', template, identifier))
        pid = value.get('pid')
        require(value.get('id') == identifier and value.get('running') is True and type(pid) is int and pid > 1
                and isinstance(value.get('started'), str) and value['started']
                and value.get('dns') == ['127.0.0.1'], 'fixture_network_subject_refused')
        ports = value.get('ports', {}).get('8080/tcp')
        require(ports == [{'HostIp': '127.0.0.1', 'HostPort': '8080'}], 'fixture_actual_health_publication_refused')
        raw = Path(f'/proc/{pid}/stat').read_bytes()
        require(len(raw) <= 16384, 'fixture_process_identity_bound')
        start = raw.rsplit(b')', 1)[1].split()[19]
        require(start.isdigit(), 'fixture_process_start_refused')
        namespace = os.stat(f'/proc/{pid}/ns/net')
        return value, start, (namespace.st_dev, namespace.st_ino)

    def isolate_target_network(self, identifier):
        # Internal Docker networks suppress publication. Only this disposable
        # namespace loses its default route; explicit loopback DNS has no server.
        # The trusted fixture JS performs no outbound request during setup.
        before = self.network_binding(identifier)
        pid = before[0]['pid']
        fd = os.open(f'/proc/{pid}/ns/net', os.O_RDONLY | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            require((info.st_dev, info.st_ino) == before[2]
                    and self.network_binding(identifier) == before, 'fixture_network_subject_changed')
            namespace = ['/usr/bin/nsenter', '--net=/proc/self/fd/' + str(fd), '--', '/usr/sbin/ip', '-j']
            run([*namespace, '-4', 'route', 'del', 'default'], pass_fds=(fd,))
            for version in (4, 6):
                rows = json.loads(run([*namespace, '-' + str(version), 'route', 'show', 'table', 'all'],
                                      pass_fds=(fd,)).stdout)
                isolated_routes(rows, version)
            require(self.network_binding(identifier) == before, 'fixture_network_subject_changed')
            # Exercise the same fixed host endpoint that production admission uses.
            import urllib.request
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open('http://127.0.0.1:8080/health', timeout=3) as response:
                raw = response.read(4097)
                require(response.status == 200 and len(raw) <= 4096, 'fixture_health_response_bound')
            health = json.loads(raw)
            require(isinstance(health, dict) and health.get('running') is True and health.get('pid') == 1
                    and health.get('releaseSha') == self.expected
                    and isinstance(health.get('instanceId'), str)
                    and re.fullmatch(r'1-[0-9a-f]{8}', health['instanceId']), 'fixture_published_health_refused')
            require(self.network_binding(identifier) == before, 'fixture_network_subject_changed')
        finally:
            os.close(fd)

    def remove_target(self):
        if self.current is not None:
            require(self.current in self.containers, 'fixture_foreign_container_cleanup')
            self.docker('rm', '-f', self.current)
            self.current = None

    def new_operation(self):
        self.case_number += 1
        op = self.base + str(self.case_number).zfill(2)
        require(re.fullmatch(r'[1-9][0-9]{0,19}', op), 'fixture_operation_bound')
        self.operations.append(op)
        self.units.append('ca-native-fault-' + op + '.service')
        return op

    def cli(self, mode, op, expected=None, check=True):
        args = ['/usr/bin/python3', '-B', str(CONTROLLER), mode, '--operation', op]
        if expected is not None:
            args += ['--expected-engine-sha', expected]
        value = run(args, check=check)
        return value, json.loads(value.stdout)

    def record(self, op):
        return read_json(STATE / op / 'operation.json')

    def state(self, unit):
        fields = ('LoadState', 'Type', 'Restart', 'KillMode', 'RuntimeMaxUSec', 'TimeoutStopUSec',
                  'MainPID', 'ControlPID', 'InvocationID', 'ControlGroup', 'ActiveState', 'SubState')
        value = run(['systemctl', 'show', unit, '--no-pager', '--property=' + ','.join(fields)], check=False)
        return dict(line.split('=', 1) for line in value.stdout.decode().splitlines() if '=' in line)

    def armed(self, op):
        def ready():
            record = self.record(op)
            require(record.get('phase') not in ('refused', 'stopped'), 'fixture_observation_refused_before_arm')
            return record if record.get('phase') == 'observing' and record.get('armed') is True else None
        record = wait_for(ready, 25, 'fixture_arm_deadline')
        state = self.state('ca-native-fault-' + op + '.service')
        require(state.get('Type') == 'exec' and state.get('Restart') == 'no'
                and state.get('KillMode') == 'control-group' and span(state.get('RuntimeMaxUSec', '')) == 160
                and span(state.get('TimeoutStopUSec', '')) == 5
                and state.get('InvocationID') == record.get('invocation')
                and re.fullmatch(r'[0-9a-f]{32}', record['invocation']), 'fixture_real_unit_contract')
        group = state['ControlGroup']
        require(group == '/system.slice/ca-native-fault-' + op + '.service', 'fixture_helper_cgroup_identity')
        target_pid = record['target']['pid']
        require(('0::' + group) not in Path(f'/proc/{target_pid}/cgroup').read_text().splitlines(),
                'fixture_target_inside_helper_cgroup')
        with LOCK.open('rb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.private_tree(op)
        return record

    def private_tree(self, op):
        root = RAW / op
        count = total = 0
        device = root.stat().st_dev
        def visit(path, depth=0):
            nonlocal count, total
            info = path.lstat(); count += 1
            require(depth < 20 and count <= 64 and info.st_uid == 0 and info.st_dev == device,
                    'fixture_private_namespace_bound')
            if stat.S_ISDIR(info.st_mode):
                require(stat.S_IMODE(info.st_mode) == 0o700, 'fixture_private_directory_mode')
                for item in path.iterdir(): visit(item, depth + 1)
            else:
                require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                        and info.st_nlink == 1, 'fixture_private_file_mode')
                total += info.st_size
                require(total <= 256 * 1024 * 1024 + 3 * 4 * 1024 * 1024,
                        'fixture_private_total_storage_bound')
        visit(root)

    def journal(self, op, invocation, since):
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', '')
        value = run(['journalctl', '--quiet', '--no-pager', '-b', boot,
                     '_PID=1', '_UID=0', 'UNIT=ca-native-fault-' + op + '.service',
                     'INVOCATION_ID=' + invocation, 'MESSAGE_ID=' + SUCCESS, 'MESSAGE_ID=' + FAILURE,
                     '-n', '16', '-o', 'json', '--output-fields=' + FIELDS])
        require(len(value.stdout) <= 65536, 'fixture_terminal_journal_bound')
        rows = [json.loads(line) for line in value.stdout.splitlines()]
        require(len(rows) < 16, 'fixture_terminal_journal_truncated')
        admitted = [row for row in rows if row.get('_PID') == '1' and row.get('_UID') == '0'
                    and row.get('_BOOT_ID') == boot and row.get('_TRANSPORT') == 'journal'
                    and row.get('UNIT') == 'ca-native-fault-' + op + '.service'
                    and row.get('INVOCATION_ID') == invocation
                    and row.get('MESSAGE_ID') in (SUCCESS, FAILURE)
                    and str(row.get('__MONOTONIC_TIMESTAMP', '')).isdigit()
                    and since <= int(row['__MONOTONIC_TIMESTAMP']) <= time.monotonic_ns() // 1000]
        return bool(admitted)

    def terminal(self, op, original, since, seconds=145, cleanup=True):
        invocation = original['invocation']
        wait_for(lambda: self.journal(op, invocation, since), seconds, 'fixture_manager_terminal_unproven', interval=.5)
        state = self.state('ca-native-fault-' + op + '.service')
        require(state.get('ActiveState') in ('inactive', 'failed')
                or state.get('LoadState') == 'not-found', 'fixture_nonterminal_manager')
        group = Path('/sys/fs/cgroup/system.slice/ca-native-fault-' + op + '.service')
        require(not group.exists() or re.search(r'^populated 0$', (group / 'cgroup.events').read_text(), re.M),
                'fixture_live_helper_cgroup')
        require(not (RAW / op).exists() if cleanup else os.path.lexists(RAW / op),
                'fixture_raw_cleanup_state')
        _, receipt = self.cli('receipt', op)
        require(receipt.get('verdict') == 'UNKNOWN', 'fixture_native_cause_overclaim')
        require(receipt.get('cleanupConfirmed') is cleanup, 'fixture_cleanup_receipt_mismatch')
        if cleanup:
            require(receipt.get('sameInvocation') is True and receipt.get('terminal') is True
                    and receipt.get('helperCgroupEmpty') is True and receipt.get('privateRawRemoved') is True,
                    'fixture_external_terminal_receipt')
        else:
            require(not receipt.get('coordinates'), 'fixture_unproved_cleanup_exported_coordinates')
        return receipt

    def wait_collected(self, op):
        return wait_for(lambda: self.record(op) if self.record(op).get('phase') in ('collected', 'refused', 'stopped') else None,
                        20, 'fixture_collection_deadline')

    def stop_fixture_unit(self, op):
        # Allowed only for this disposable qualification's own helper unit.
        require(op in self.operations, 'fixture_foreign_unit_stop')
        unit = 'ca-native-fault-' + op + '.service'
        run(['systemctl', 'stop', unit], check=False)
        state = self.state(unit)
        require(state.get('ActiveState') in ('inactive', 'failed') or state.get('LoadState') == 'not-found',
                'fixture_helper_stop_unproven')

    def copy_module(self, path, name):
        destination = self.folder / (name + '.elf')
        self.docker('cp', '-L', self.current + ':' + path, str(destination))
        require(destination.is_file() and destination.stat().st_size <= 256 * 1024 * 1024,
                'fixture_module_copy_bound')
        notes = run(['/usr/bin/readelf', '--notes', str(destination)]).stdout
        ids = re.findall(rb'Build ID: ([0-9a-f]{16,128})', notes)
        require(len(ids) == 1, 'fixture_module_build_id')
        self.modules[name] = {'sha256': digest(destination), 'buildID': ids[0].decode(), 'bytes': destination.stat().st_size}

    def start_sshd(self):
        keys = self.folder / 'ssh'; keys.mkdir(mode=0o700)
        self.ssh_log = keys / 'diagnostic.log'
        fd = os.open(self.ssh_log, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        for name in ('host', 'client'):
            run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(keys / name)])
        (keys / 'authorized').write_bytes((keys / 'client.pub').read_bytes()); (keys / 'authorized').chmod(0o600)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0)); self.port = reservation.getsockname()[1]
        (keys / 'known').write_text('[127.0.0.1]:' + str(self.port) + ' ' + (keys / 'host.pub').read_text())
        (keys / 'known').chmod(0o600)
        config = keys / 'sshd.conf'
        config.write_text('\n'.join(['ListenAddress 127.0.0.1', 'Port ' + str(self.port),
            'HostKey ' + str(keys / 'host'), 'AuthorizedKeysFile ' + str(keys / 'authorized'),
            'PidFile ' + str(keys / 'pid'), 'PermitRootLogin prohibit-password', 'PasswordAuthentication no',
            'KbdInteractiveAuthentication no', 'UsePAM yes', 'StrictModes yes', 'PrintMotd no', 'LogLevel VERBOSE']) + '\n')
        run(['systemd-run', '--unit=' + self.ssh_unit, '--service-type=exec', '--quiet',
             '--property=Restart=no', '--property=RuntimeMaxSec=200', '--property=TimeoutStopSec=3',
             '--property=KillMode=control-group', '--property=LimitFSIZE=1048576',
             '/usr/sbin/sshd', '-D', '-E', str(self.ssh_log), '-f', str(config)])
        def listening():
            try:
                with socket.create_connection(('127.0.0.1', self.port), timeout=.1): return True
            except OSError: return False
        wait_for(listening, 5, 'fixture_local_ssh_readiness')
        self.keys = keys

    def ssh_admit(self, op):
        # The only SSH endpoint is this qualification's own loopback daemon.
        import shlex
        remote = '/usr/bin/python3 -B ' + shlex.quote(str(CONTROLLER)) + ' admit --operation ' + op
        remote += ' --expected-engine-sha ' + self.expected + ' && exec cat >/dev/null'
        self.client = subprocess.Popen(['ssh', '-v', '-F', '/dev/null', '-p', str(self.port), '-i', str(self.keys / 'client'),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'UserKnownHostsFile=' + str(self.keys / 'known'), '-o', 'GlobalKnownHostsFile=/dev/null',
            'root@127.0.0.1', remote], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.client_pipes = [PrivatePipe(self.client.stdout), PrivatePipe(self.client.stderr)]

    def ssh_failure_evidence(self):
        status = self.client.poll() if self.client is not None else None
        if status is not None:
            for pipe in self.client_pipes:
                pipe.thread.join(timeout=.2)
        streams = [pipe.snapshot() for pipe in self.client_pipes]
        stdout, stderr = (streams[0][0], streams[1][0]) if len(streams) == 2 else (b'', b'')
        server = b''; bounded = any(item[1] for item in streams)
        if self.ssh_log is not None:
            fd = os.open(self.ssh_log, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600,
                        'fixture_private_ssh_log_refused')
                server = os.read(fd, SSH_DIAGNOSTIC_LIMIT)
                bounded |= info.st_size > SSH_DIAGNOSTIC_LIMIT
            finally:
                os.close(fd)
        return closed_ssh_evidence(stdout, stderr, server, status, bounded)

    def cleanup(self):
        if self.client:
            if self.client.poll() is None:
                self.client.kill(); self.client.wait(timeout=3)
            self.client.stdin.close()
            for pipe in self.client_pipes:
                pipe.thread.join(timeout=1)
        failed = False
        for unit in [*self.units, self.ssh_unit]:
            value = run(['systemctl', 'stop', unit], check=False)
            state = self.state(unit)
            if state.get('ActiveState') not in ('inactive', 'failed') and state.get('LoadState') != 'not-found':
                failed = True
            run(['systemctl', 'reset-failed', unit], check=False)
        for identifier in self.containers:
            run(['docker', 'rm', '-f', identifier], check=False)
            if run(['docker', 'inspect', identifier], check=False).returncode == 0: failed = True
        for image in self.images.values():
            run(['docker', 'image', 'rm', image], check=False)
        if self.network is not None:
            run(['docker', 'network', 'rm', self.network], check=False)
            if run(['docker', 'network', 'inspect', self.network], check=False).returncode == 0: failed = True
        require(not failed, 'fixture_terminal_cleanup_unproven')
        for path in (RAW, STATE):
            if path.exists():
                require(path.is_dir() and not path.is_symlink() and path.stat().st_uid == 0,
                        'fixture_cleanup_ancestry_refused')
                require(shutil.rmtree.avoids_symlink_attacks, 'fixture_fd_safe_cleanup_unavailable')
                shutil.rmtree(path)
        if self.lock_identity is not None:
            require(LOCK.lstat().st_ino == self.lock_identity, 'fixture_lock_replaced')
            LOCK.unlink()


def qualify(output, feasibility):
    require(platform.system() == 'Linux' and platform.machine() == 'x86_64' and os.geteuid() == 0
            and Path('/proc/1/comm').read_text().strip() == 'systemd', 'actual_isolated_root_systemd_required')
    previous = read_json(feasibility)
    require(previous.get('passed') is True and previous.get('productionCapture') is False
            and previous.get('pinnedNodeImage') == IMAGE and previous.get('cleanup') == 'confirmed',
            'fixture_linux_feasibility_prerequisite')
    require(not os.path.lexists(STATE) and not os.path.lexists(RAW) and not os.path.lexists(LOCK),
            'fixture_foreign_native_state_present')
    for tool in ('/usr/bin/perf', '/usr/bin/readelf', '/usr/bin/systemd-run', '/usr/sbin/sshd',
                 '/usr/bin/nsenter', '/usr/sbin/ip'):
        require(Path(tool).is_file(), 'fixture_host_prerequisite_unavailable')
    require(not run(['docker', 'ps', '-a', '--filter', 'name=^/' + CONTAINER + '$', '--format', '{{.ID}}']).stdout.strip(),
            'fixture_foreign_engine_present')
    evidence = {'schema': 'isolated-native-host-unit/v1', 'productionCapture': False,
                'controllerSHA256': digest(CONTROLLER), 'cases': [], 'passed': False}
    with tempfile.TemporaryDirectory(prefix='ca-native-unit-fixture-', dir='/run') as tmp:
        folder = Path(tmp); folder.chmod(0o700); scene = Scene(folder)
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            scene.lock_identity = os.fstat(fd).st_ino; os.close(fd)
            scene.docker('pull', IMAGE, timeout=180)
            seed = 'ca-native-fixture-headers-' + str(os.getpid())
            identifier = scene.docker('create', '--name', seed, IMAGE); scene.containers.add(identifier)
            scene.docker('cp', identifier + ':/usr/local/include/node', str(folder / 'headers'))
            (folder / 'optimized.c').write_text(OPTIMIZED_FAULT)
            for kind, source, flags in [('optimized', folder / 'optimized.c', ['-O2', '-g0', '-fomit-frame-pointer', '-fno-builtin']),
                                        ('storm', ASSETS / 'fault.c', ['-O0', '-g', '-fno-omit-frame-pointer'])]:
                run(['cc', '-shared', '-fPIC', '-Wl,--build-id=sha1', '-DNODE_GYP_MODULE_NAME=fault',
                     '-I' + str(folder / 'headers'), *flags, str(source), '-o', str(folder / (kind + '.node'))], timeout=30)
            run(['strip', '--strip-all', str(folder / 'optimized.node')])
            sections = run(['/usr/bin/readelf', '--sections', str(folder / 'optimized.node')]).stdout
            require(b'.debug_info' not in sections and b'.symtab' not in sections, 'fixture_optimized_strip_unproven')
            # Own bridge plus namespace-local route isolation; fixed health port is private.
            with socket.socket() as port:
                port.bind(('127.0.0.1', 8080))
            network_name = 'ca-native-unit-fixture-' + str(os.getpid())
            require(not scene.docker('network', 'ls', '--filter', 'name=^' + network_name + '$', '--format', '{{.ID}}'),
                    'fixture_foreign_network_present')
            scene.network = scene.docker('network', 'create', network_name)
            require(re.fullmatch(r'[0-9a-f]{64}', scene.network), 'fixture_network_identity')
            for kind in ('optimized', 'storm'):
                context = folder / ('image-' + kind); context.mkdir(mode=0o700)
                shutil.copyfile(folder / (kind + '.node'), context / 'fault.node')
                (context / 'index.js').write_text(ENGINE_TARGET.replace('__EXPECTED_ENGINE_SHA__', scene.expected))
                (context / 'Dockerfile').write_text('FROM ' + IMAGE + '\nWORKDIR /app\n'
                    'COPY fault.node /app/native/build/fixture_fault.node\n'
                    'COPY index.js /app/dist/index.js\n'
                    'LABEL org.opencontainers.image.revision=' + scene.expected + '\n'
                    'ENV FIXTURE_MODE=' + kind + '\nENTRYPOINT []\nCMD ["node","dist/index.js"]\n')
                tag = 'ca-native-unit-fixture-' + str(os.getpid()) + ':' + kind
                scene.docker('build', '--network=none', '--pull=false', '--tag', tag, str(context), timeout=60)
                image = scene.docker('image', 'inspect', '--format', '{{.Id}}', tag)
                require(re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'fixture_image_identity')
                scene.images[kind] = image
            # Full production budgets, actual SSH loss and exact original operation.
            target = scene.start(); op = scene.new_operation(); since = time.monotonic_ns() // 1000
            # Run the exact qualified-source in-memory prerequisite bootstrap,
            # before any controller state, recorder or owned helper unit exists.
            units_before = run(['systemctl', 'list-units', '--all', '--plain', '--no-legend', 'ca-native-fault-*.service']).stdout
            require(not os.path.lexists(STATE) and not os.path.lexists(RAW), 'fixture_preflight_state_already_present')
            workflow = (ROOT / '.github/workflows/profile-engine-main-thread.yml').read_text()
            section = workflow.split('if [ "$NATIVE_MODE" = native_prerequisites ]; then\n', 1)[1]
            bootstrap = textwrap.dedent(section.split("bootstrap=r'''", 1)[1].split("'''", 1)[0])
            source_digest = digest(CONTROLLER)
            preflight = json.loads(run(['/usr/bin/python3', '-I', '-B', '-c', bootstrap, scene.expected, source_digest],
                                       input=CONTROLLER.read_bytes(), timeout=25).stdout)
            require(preflight.get('schema') == 'native-prerequisites/v1' and preflight.get('readOnly') is True
                    and preflight.get('engineSHA') == scene.expected and preflight.get('sourceSHA256') == source_digest
                    and set(preflight.get('tools', {})) == {'perf', 'readelf', 'systemdRun'}
                    and all(row == {'available': True, 'reason': 'available'} for row in preflight['tools'].values()),
                    'fixture_prerequisite_metadata_unproven')
            require(not os.path.lexists(STATE) and not os.path.lexists(RAW)
                    and run(['systemctl', 'list-units', '--all', '--plain', '--no-legend', 'ca-native-fault-*.service']).stdout == units_before,
                    'fixture_read_only_preflight_mutated_state')
            evidence['cases'].append({'case': 'read_only_prerequisites', 'passed': True,
                                      'noStateOrHelperUnitCreated': True, 'exactSourceBound': True})
            scene.start_sshd()
            scene.ssh_admit(op)
            wait_for(lambda: (STATE / op / 'operation.json').exists(), 10, 'fixture_ssh_admission')
            original = scene.armed(op)
            observation_started = time.monotonic()
            scene.client.kill(); scene.client.wait(timeout=3); scene.client.stdin.close(); scene.client = None
            _, duplicate = scene.cli('admit', op, scene.expected)
            require(duplicate.get('phase') == 'existing_operation_read_receipt', 'fixture_duplicate_arm_not_refused')
            require(scene.state('ca-native-fault-' + op + '.service')['InvocationID'] == original['invocation'],
                    'fixture_duplicate_invocation')
            receipt = scene.terminal(op, original, since)
            elapsed = time.monotonic() - observation_started
            require(119 <= elapsed <= 145, 'fixture_actual_observation_ttl_unproven')
            require(scene.docker('inspect', '--format', '{{.State.Pid}}', scene.current) == str(original['target']['pid']),
                    'fixture_ssh_loss_changed_target')
            require(receipt.get('reason') == 'expired_without_admitted_fault', 'fixture_expiry_reason')
            require(scene.record(op)['sourceSHA256'] == evidence['controllerSHA256'], 'fixture_source_copy_identity')
            evidence['cases'].append({'case': 'production_ttl_ssh_loss_duplicate_expiry', 'passed': True,
                                      'productionTTLSeconds': 120, 'unitMaxSeconds': 160,
                                      'observedElapsedSeconds': round(elapsed, 3),
                                      'managerTerminalBound': True, 'cleanupConfirmed': True})
            scene.remove_target()
            # Actual optimized/stripped addon fault: exact static ELF leaf/caller coordinates.
            target = scene.start(); scene.copy_module('/usr/local/bin/node', 'node')
            scene.copy_module('/usr/lib/x86_64-linux-gnu/libc.so.6', 'libc')
            scene.copy_module('/app/native/build/fixture_fault.node', 'addon')
            op = scene.new_operation(); since = time.monotonic_ns() // 1000
            scene.cli('admit', op, scene.expected); original = scene.armed(op); (target / 'fire').touch()
            receipt = scene.terminal(op, original, since, seconds=35)
            coordinates = receipt.get('coordinates', [])
            ranges = {}
            symbols = run(['/usr/bin/readelf', '--wide', '--dyn-syms', str(folder / 'optimized.node')]).stdout.decode()
            for name in ('sp_fault_leaf', 'sp_fault_caller'):
                matches = re.findall(r'^\s*\d+:\s+([0-9a-fA-F]+)\s+(\d+)\s+FUNC\s+\S+\s+\S+\s+\S+\s+' + name + r'\s*$', symbols, re.M)
                require(len(matches) == 1 and int(matches[0][1]) > 0, 'fixture_static_symbol_range')
                ranges[name] = (int(matches[0][0], 16), int(matches[0][1]))
            loads = run(['/usr/bin/readelf', '--wide', '--program-headers', str(folder / 'optimized.node')]).stdout.decode()
            executable = [line.split() for line in loads.splitlines() if line.strip().startswith('LOAD ')]
            require(all(any('E' in row[6:-1] and int(row[1], 16) == int(row[2], 16)
                            and int(row[2], 16) <= start < start + length <= int(row[2], 16) + int(row[4], 16)
                            for row in executable) for start, length in ranges.values()), 'fixture_elf_offset_layout')
            require(all(any(frame.get('module') == 'addon' and type(frame.get('offset')) is int
                            and start <= frame['offset'] < start + length for frame in coordinates)
                        for start, length in ranges.values()), 'fixture_addon_leaf_caller_coordinates_unproven')
            for frame in coordinates:
                module = scene.modules.get(frame.get('module'))
                require(module and frame.get('buildID') == module['buildID']
                        and frame.get('binarySHA256') == module['sha256'] and type(frame.get('offset')) is int
                        and 0 <= frame['offset'] < module['bytes'], 'fixture_elf_coordinate_custody')
            # Force collection of the old transient unit, then prove the same journal-bound receipt.
            scene.stop_fixture_unit(op); run(['systemctl', 'reset-failed', 'ca-native-fault-' + op + '.service'], check=False)
            wait_for(lambda: scene.state('ca-native-fault-' + op + '.service').get('LoadState') == 'not-found',
                     5, 'fixture_gc_not_observed')
            require(scene.cli('receipt', op)[1].get('cleanupConfirmed') is True, 'fixture_post_gc_terminal_proof')
            evidence['cases'].append({'case': 'optimized_stripped_coordinate_custody_and_gc', 'passed': True,
                                      'addonLeafAndCallerCoordinates': True, 'exactELFBound': True, 'postGCProof': True})
            scene.remove_target()
            # A killed collector cannot leave perf or private files behind.
            target = scene.start(); op = scene.new_operation(); since = time.monotonic_ns() // 1000
            scene.cli('admit', op, scene.expected); original = scene.armed(op)
            main = scene.state('ca-native-fault-' + op + '.service').get('MainPID', '')
            require(main.isdigit() and int(main) > 1 and int(main) != original['target']['pid'], 'fixture_helper_pid_refused')
            os.kill(int(main), signal.SIGKILL)
            scene.terminal(op, original, since, seconds=15)
            evidence['cases'].append({'case': 'collector_sigkill', 'passed': True, 'cleanupConfirmed': True})
            scene.remove_target()
            # Replacement never rebinds the old observation to a new engine task.
            target = scene.start(); op = scene.new_operation(); since = time.monotonic_ns() // 1000
            scene.cli('admit', op, scene.expected); original = scene.armed(op)
            scene.remove_target(); replacement = scene.start(); (replacement / 'fire').touch()
            receipt = scene.terminal(op, original, since, seconds=35)
            require(not receipt.get('coordinates'), 'fixture_replacement_sample_admitted')
            evidence['cases'].append({'case': 'replacement_no_retarget', 'passed': True, 'foreignCoordinates': False})
            scene.remove_target()
            # Real handled GPF storm must remain inside the private recording envelope.
            target = scene.start('storm'); op = scene.new_operation(); since = time.monotonic_ns() // 1000
            scene.cli('admit', op, scene.expected); original = scene.armed(op)
            data_fd = os.open(RAW / op / 'perf.data', os.O_RDONLY | os.O_NOFOLLOW)
            try:
                require(stat.S_ISREG(os.fstat(data_fd).st_mode), 'fixture_perf_file_identity')
                (target / 'fire').touch()
                wait_for(lambda: scene.journal(op, original['invocation'], since), 35,
                         'fixture_storm_terminal_unproven', interval=.5)
                # Stat the already-open original inode even after manager cleanup;
                # never read its raw bytes and never accept a vacuous missing-file bound.
                size = os.fstat(data_fd).st_size
                require(256 * 1024 <= size <= 4 * 1024 * 1024, 'fixture_private_perf_bound')
            finally:
                os.close(data_fd)
            receipt = scene.terminal(op, original, since, seconds=5)
            evidence['cases'].append({'case': 'private_storage_bound', 'passed': True, 'cleanupConfirmed': True})
            scene.remove_target()
            # Unknown durable ownership cannot start a replacement observation.
            scene.start()
            active = STATE / 'active.json'; saved = active.read_bytes(); unknown = scene.new_operation()
            active.write_text(json.dumps({'operation': unknown})); active.chmod(0o600)
            proposed = scene.new_operation(); value, _ = scene.cli('admit', proposed, scene.expected, check=False)
            require(value.returncode != 0 and not (STATE / proposed).exists(), 'fixture_unknown_claim_rearmed')
            active.write_bytes(saved)
            evidence['cases'].append({'case': 'unknown_claim_refuses_new_arm', 'passed': True})
            scene.remove_target()
            # A hostile cleanup root is not followed and cannot certify a result.
            target = scene.start(); op = scene.new_operation(); since = time.monotonic_ns() // 1000
            scene.cli('admit', op, scene.expected); original = scene.armed(op)
            preserved = RAW / (op + '.fixture-preserved'); (RAW / op).rename(preserved)
            sentinel = folder / 'outside'; sentinel.mkdir(mode=0o700); (sentinel / 'keep').write_text('fixture sentinel')
            (RAW / op).symlink_to(sentinel, target_is_directory=True)
            scene.stop_fixture_unit(op)
            scene.terminal(op, original, since, seconds=15, cleanup=False)
            require((sentinel / 'keep').read_text() == 'fixture sentinel', 'fixture_foreign_cleanup_followed')
            (RAW / op).unlink(); preserved.rename(RAW / op)
            evidence['cases'].append({'case': 'cleanup_refusal', 'passed': True, 'unprovedResultWithheld': True})
            scene.remove_target()
            evidence['passed'] = True
        except BaseException:
            # Capture before cleanup changes client exit state or removes private logs.
            global SSH_FAILURE_EVIDENCE
            try:
                SSH_FAILURE_EVIDENCE = scene.ssh_failure_evidence()
            except (OSError, ValueError, RuntimeError):
                SSH_FAILURE_EVIDENCE = {'categories': ['diagnostic_unavailable']}
            raise
        finally:
            scene.cleanup()
    evidence['cleanup'] = 'confirmed'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2) + '\n')
    print('Actual isolated host-owned native unit qualification passed; production capture remains disabled.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--feasibility-receipt', type=Path, required=True)
    args = parser.parse_args()
    try:
        qualify(args.output, args.feasibility_receipt)
    except BaseException as error:
        reason = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[a-z0-9_]{1,100}', str(error)) else type(error).__name__
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({'schema': 'isolated-native-host-unit/v1', 'passed': False,
                                          'productionCapture': False, 'failure': reason,
                                          'sshAdmissionEvidence': SSH_FAILURE_EVIDENCE,
                                          'cleanup': 'not_certified_by_success_receipt'}) + '\n')
        print('Isolated native host-unit qualification refused; sanitized receipt retained.', file=sys.stderr)
        sys.exit(1)
