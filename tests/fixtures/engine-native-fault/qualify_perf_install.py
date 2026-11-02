#!/usr/bin/env python3
"""DRAFT full isolated installer path, then actual180s manager expiry.

Uses the maintained Scene's health-only Node target and loopback SSH machinery.
The first transaction invokes actual admit/execute/APT/stop-post/receipt using
an explicitly isolated profile bound to the actual CI kernel. No kernel is
faked and no guard is disabled; production stage rejects this fixture profile.
No native fault or production game is involved. Full180s expiry is real.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import socket
import shutil
import signal
import stat
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
SOURCES = {
    'installer.py': ROOT / 'scripts/ci/native-perf-install-controller.py',
    'native-fault-observation.py': ROOT / 'scripts/ci/native-fault-observation.py',
    'package-plan.py': ROOT / 'scripts/ci/native-perf-install.py',
}

RUNNER = r'''
import argparse,importlib.util,json,os,sys,time
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('mode',choices=('launch','execute','stop-post'))
parser.add_argument('--operation',required=True)
arguments=parser.parse_args()
mode,op=arguments.mode,arguments.operation
folder=Path(__file__).parent
spec=importlib.util.spec_from_file_location('owned_installer',folder/'installer.py')
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
native=helper.load('qualified_identity','native-fault-observation.py',helper.CONTROLLER_SHA)
if mode=='launch':
    helper.run(helper.unit_arguments(op,Path(__file__)))
elif mode=='execute':
    work,record=helper.begin_operation(native,op)
    # Controlled transaction ONLY. No platform/target guard is changed and no
    # production execute/APT operation is invoked by this lifecycle fixture.
    while not (work/'fixture-release').exists():time.sleep(.05)
    record.update(phase='fixture-finished',result='installer_unproven')
    native.write_json(work/'operation.json',record)
elif mode=='stop-post':
    helper.stop_post(native,op)
else:raise SystemExit(1)
'''


def ssh_diagnostics(raw):
    # Closed categories only; private paths, keys, identities and text never escape.
    limited = raw[:65536].lower()
    markers = {
        'privilege_directory_missing': (b'missing privilege separation directory',),
        'listen_refused': (b'address already in use', b'cannot bind any address'),
        'host_key_refused': (b'could not load host key', b'no hostkeys available'),
        'authentication_refused': (b'failed publickey', b'authentication refused'),
        'authentication_accepted': (b'accepted publickey',),
        'account_refused': (b'account is locked', b'not allowed because'),
    }
    return {'categories': sorted(name for name, needles in markers.items()
        if any(needle in limited for needle in needles)) or ['unknown'],
        'boundExceeded': len(raw) > 65536}


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def wait(callback, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = callback()
        if result:
            return result
        time.sleep(.2)
    raise RuntimeError('fixture_bounded_wait_unproven')


def start_target(scene, machinery, folder):
    # Reuse the maintained pinned-image/health/namespace-isolation Scene. No
    # addon is loaded, no fire marker exists and no native fault is requested.
    with socket.socket() as port:
        port.bind(('127.0.0.1', 8080))
    scene.docker('pull', machinery.IMAGE, timeout=90)
    name = 'ca-perf-installer-network-' + str(os.getpid())
    if scene.docker('network', 'ls', '--filter', 'name=^' + name + '$', '--format', '{{.ID}}'):
        raise RuntimeError('fixture_foreign_network_present')
    scene.network = scene.docker('network', 'create', name)
    if not re.fullmatch(r'[0-9a-f]{64}', scene.network):
        raise RuntimeError('fixture_network_identity_unproven')
    scene.resource_ack_unknown = False
    context = folder / 'node-image'; context.mkdir(mode=0o700)
    script = machinery.ENGINE_TARGET.split('const timer=', 1)[0].replace("const addon=require('/app/native/build/fixture_fault.node');\n", '')
    if 'addon' in script or '.node' in script:
        raise RuntimeError('fixture_health_only_target_unproven')
    # Independent finite subject lifetime even if the qualifier is killed.
    script += '\nsetTimeout(() => process.exit(0), 480000).unref();\n'
    (context / 'index.js').write_text(script.replace('__EXPECTED_ENGINE_SHA__', scene.expected))
    (context / 'Dockerfile').write_text('FROM ' + machinery.IMAGE + '\nWORKDIR /app\n'
        'COPY index.js /app/dist/index.js\nLABEL org.opencontainers.image.revision=' + scene.expected
        + '\nENTRYPOINT []\nCMD ["node","dist/index.js"]\n')
    tag = 'ca-perf-installer-fixture-' + str(os.getpid())
    scene.docker('build', '--network=none', '--pull=false', '--tag', tag, str(context), timeout=60)
    image = scene.docker('image', 'inspect', '--format', '{{.Id}}', tag)
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
        raise RuntimeError('fixture_target_image_unproven')
    scene.images['optimized'] = image
    scene.resource_ack_unknown = False
    scene.start()
    scene.resource_ack_unknown = False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', type=Path, required=True)
    parser.add_argument('--profile', type=Path, required=True)
    parser.add_argument('--packages', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = {'schema': 'native-perf-installer-lifecycle-qualification/v1', 'qualified': False,
        'productionPlatformQualified': False, 'productionInstallationQualified': False,
        'aptInstallExecuted': False, 'productionEngineActionExecuted': False,
        'nativeFaultTriggered': False, 'cases': [], 'cleanupConfirmed': False}
    helper = None
    source = None
    native = None
    work = None
    phase = 'admission'
    scene = None
    owned_units = []
    created_state = False
    temporary = None
    def expired(signum, frame):
        raise RuntimeError('fixture_deadline')
    signal.signal(signal.SIGALRM, expired)
    signal.signal(signal.SIGTERM, expired)
    signal.alarm(300)  # Own deadline enters finally before the480s outer bound.
    try:
        if os.geteuid() != 0 or not Path('/proc/1/comm').read_text().strip() == 'systemd':
            raise RuntimeError('fixture_real_root_systemd_required')
        phase = 'source_binding'
        result['prerequisiteTools'] = {name: os.path.isfile(path) and os.access(path, os.X_OK)
            for name, path in {'sshd': '/usr/sbin/sshd', 'ip': '/usr/sbin/ip', 'nsenter': '/usr/bin/nsenter'}.items()}
        source = load(SOURCES['installer.py'], 'maintained_installer')
        if os.path.lexists(source.STATE):
            raise RuntimeError('fixture_foreign_installer_state_present')
        machinery = load(args.scene, 'existing_scene')
        # Existing Scene's cleanup owns the native-capture roots only when they
        # were absent initially. This fixture creates none of those roots.
        if any(os.path.lexists(path) for path in (machinery.STATE, machinery.RAW, machinery.LOCK)):
            raise RuntimeError('fixture_foreign_capture_state_present')
        temporary = tempfile.TemporaryDirectory(prefix='ca-perf-installer-unit-', dir='/run')
        if temporary is not None:
            folder = Path(temporary.name)
            for name in ('installer.py', 'native-fault-observation.py', 'package-plan.py'):
                destination = folder / name
                destination.write_bytes(SOURCES[name].read_bytes())
                destination.chmod(0o600)
            (folder / 'runner.py').write_text(RUNNER)
            (folder / 'runner.py').chmod(0o600)
            helper = load(folder / 'installer.py', 'owned_installer_source')
            native = helper.load('qualified_identity', 'native-fault-observation.py', helper.CONTROLLER_SHA)
            phase = 'state_creation'
            helper.STATE.mkdir(mode=0o700)
            created_state = True
            class InstallerScene(machinery.Scene):
                resource_ack_unknown = False
                def docker(self, *args, **kwargs):
                    if args[:2] in (('run', '-d'), ('network', 'create')) or args[:1] == ('build',):
                        # Record uncertainty BEFORE the daemon may create a
                        # resource. Clear only after its owned identity is kept.
                        self.resource_ack_unknown = True
                    if args[:2] == ('run', '-d'):
                        args = (*args[:2], '--rm', *args[2:])
                    return super().docker(*args, **kwargs)
            scene = InstallerScene(folder)
            fd = os.open(machinery.LOCK, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            scene.lock_identity = os.fstat(fd).st_ino; os.close(fd)
            phase = 'target_creation'
            start_target(scene, machinery, folder)
            phase = 'target_identity'
            original = native.target_identity(scene.expected)
            phase = 'profile_binding'
            public = args.profile.read_bytes()
            qualified = helper.profile(public, hashlib.sha256(public).hexdigest())
            if qualified['purpose'] != 'production':
                raise RuntimeError('fixture_original_package_profile_unproven')
            qualified['purpose'] = 'isolated-qualification'
            qualified['kernel'] = os.uname().release
            profile_raw = json.dumps(qualified, separators=(',', ':')).encode()
            profile_sha = hashlib.sha256(profile_raw).hexdigest()
            helper.profile(profile_raw, profile_sha)  # Exact actual uname, not a waiver.
            phase = 'ssh_setup'
            # OpenSSH's compiled privilege-separation directory is an OS
            # prerequisite, independent of this private daemon's own files.
            # Prepare it only on this isolated host; preserve existing metadata.
            privilege = Path('/run/sshd')
            created = False
            try:
                privilege.mkdir(mode=0o755)
                privilege.chmod(0o755)  # Own new prerequisite; independent of caller umask.
                created = True
            except FileExistsError:
                pass
            metadata = privilege.lstat()
            if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o755:
                raise RuntimeError('fixture_ssh_runtime_prerequisite_refused')
            result['sshRuntimePrerequisite'] = 'created' if created else 'existing'
            # Like installed CI prerequisite packages, this empty standard OS
            # directory stays until the disposable VM is retired. Never remove
            # a directory another SSH service could subsequently need.
            result['retainedPrerequisites'] = ['standard-ssh-runtime-directory'] if created else []
            result['cleanupScope'] = 'owned_units_target_and_installer_state'
            scene.start_sshd()
            base = str(os.getpid()) + str(int(time.time()))[-7:]
            boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()

            def prepare(number):
                op = base + str(number)
                work = helper.STATE / op
                work.mkdir(mode=0o700)
                if number == 1:
                    for name in ('installer.py', 'native-fault-observation.py', 'package-plan.py'):
                        (work / name).write_bytes(SOURCES[name].read_bytes())
                        (work / name).chmod(0o600)
                    (work / 'profile.json').write_bytes(profile_raw)
                    (work / 'profile.json').chmod(0o600)
                    (work / 'packages').mkdir(mode=0o700)
                    for row in qualified['packages']:
                        source = args.packages / (row['package'] + '_' + row['version'] + '_' + row['architecture'] + '.deb')
                        if source.is_symlink() or not source.is_file() or source.stat().st_size != row['bytes'] or hashlib.sha256(source.read_bytes()).hexdigest() != row['sha256']:
                            raise RuntimeError('fixture_public_deb_unproven')
                        destination = work / 'packages' / (row['package'] + '.deb')
                        destination.write_bytes(source.read_bytes()); destination.chmod(0o600)
                    owned_units.append(helper.unit(op))
                    return op, work
                record = {'operation': op, 'phase': 'prepared', 'profileSHA256': '0' * 64,
                    'sourceSHA256': hashlib.sha256((folder / 'installer.py').read_bytes()).hexdigest(),
                    'planSourceSHA256': hashlib.sha256((folder / 'package-plan.py').read_bytes()).hexdigest(),
                    # No eligible package profile is fabricated. This is a
                    # lifecycle-only record and can NEVER verify installation.
                    'target': original, 'invocation': None,
                    'admittedMonotonicUS': time.monotonic_ns() // 1000,
                    'cleanup': 'pending', 'result': 'installer_unproven', 'profilePurpose': 'isolated-qualification'}
                native.write_json(work / 'operation.json', record, exclusive=True)
                native.write_json(helper.STATE / 'active.json', {'operation': op}, exclusive=number == 1)
                owned_units.append(helper.unit(op))
                return op, work

            def started(op, work):
                if not (work / 'operation.json').exists(): return None
                record = native.read_json(work / 'operation.json')
                return record if record.get('invocation') else None

            def terminal(op, source, expected_profile):
                child = machinery.run(['/usr/bin/python3', '-I', '-B', str(source),
                    'receipt', '--operation', op, '--wait'], timeout=210, check=False)
                source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
                checked = helper.receipt_outcome(child.stdout, op, expected_profile, source_sha,
                    'isolated-qualification', scene.expected, child.returncode)
                if not checked['validReceipt'] or not all(checked[key] for key in ('sameInvocation', 'terminal', 'helperCgroupEmpty')) or checked['managerTerminalEvidence'] == 'unproven':
                    raise RuntimeError('fixture_terminal_receipt_unproven')
                return checked

            phase = 'operation_prepare'
            op, work = prepare(1)
            remote = '/usr/bin/python3 -I -B ' + shlex.quote(str(work / 'installer.py')) + ' admit --operation ' + op + ' --expected-engine-sha ' + scene.expected + ' --profile-sha ' + profile_sha + ' && exec cat >/dev/null'
            phase = 'ssh_admission'
            client = subprocess.Popen(['ssh', '-F', '/dev/null', '-p', str(scene.port), '-i', str(scene.keys / 'client'),
                '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'UserKnownHostsFile=' + str(scene.keys / 'known'), '-o', 'GlobalKnownHostsFile=/dev/null',
                'root@127.0.0.1', remote], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            scene.client = client
            phase = 'install_begin'
            record = wait(lambda: started(op, work), 15)
            if record.get('phase') not in ('preparing', 'installing', 'verifying'):
                raise RuntimeError('fixture_install_interval_not_observed')
            invocation = record['invocation']
            state = scene.state(helper.unit(op))
            if state.get('Type') != 'exec' or state.get('KillMode') != 'control-group' or machinery.span(state.get('RuntimeMaxUSec', '')) != 180:
                raise RuntimeError('fixture_actual_unit_contract_unproven')
            # Only this fixture's own SSH client dies. Host systemd owns the
            # actual package transaction independently of this SSH client.
            client.kill(); client.wait(timeout=3); client.stdin.close(); scene.client = None
            phase = 'duplicate_read'
            duplicate = helper.admit(native, op, None, None)
            if duplicate.get('reason') != 'duplicate_operation_read_only' or scene.state(helper.unit(op)).get('InvocationID') != invocation:
                raise RuntimeError('fixture_duplicate_operation_unproven')
            phase = 'install_receipt'
            receipt = terminal(op, work / 'installer.py', profile_sha)
            result['installerOutcome'] = {key: receipt[key] for key in ('reason', 'installationVerified',
                'productionInstallationQualified', 'wrapperKernelDispatchQualified', 'managerTerminalEvidence', 'profilePurpose')}
            if not receipt['installationVerified'] or receipt['productionInstallationQualified'] or receipt['wrapperKernelDispatchQualified'] or not native.same_target(original):
                raise RuntimeError('fixture_exact_install_path_unproven')
            attempt_before = (work / 'apt-attempt.json').read_bytes()
            duplicate = helper.admit(native, op, None, None)
            if duplicate.get('reason') != 'duplicate_operation_read_only' or (work / 'apt-attempt.json').read_bytes() != attempt_before:
                raise RuntimeError('fixture_duplicate_operation_unproven')
            result['aptInstallExecuted'] = True
            result['cases'].append({'case': 'actual_install_ssh_loss_same_operation', 'passed': True,
                'duplicateRefused': True, 'sameInvocation': True, 'terminalEvidence': receipt['managerTerminalEvidence'],
                'actualKernel': qualified['kernel'], 'profilePurpose': qualified['purpose'],
                'wrapperKernelDispatchQualified': False, 'productionInstallationQualified': False})

            phase = 'terminal_diagnostics'
            # Read the already-terminal actual install; no new install, unit,
            # expiry or native fault is introduced for this diagnostic proof.
            adapter = load(ROOT / 'scripts/ci/native-perf-terminal-diagnostics.py', 'terminal_adapter')
            before_records = {name: (work / name).read_bytes() for name in ('operation.json', 'apt-attempt.json')}
            before_entries = set(work.iterdir())
            child = machinery.run(['/usr/bin/python3', '-I', '-B', '-', op],
                input=(ROOT / 'scripts/ci/native-perf-terminal-diagnostics.py').read_bytes(), timeout=25, check=False)
            planner = helper.load('original_terminal_plan', 'package-plan.py', adapter.PLAN)
            diagnostic = adapter.diagnostic_outcome(child.stdout, receipt, child.returncode, planner, helper)
            if diagnostic is None or diagnostic['phase'] != 'verified' or diagnostic['aptAttemptRecorded'] is not True or diagnostic['packages']['schema'] != adapter.PACKAGE_SCHEMA or diagnostic['packages']['verified'] is not True or not all(query['verified'] and query['stage'] == 'complete' and query['reason'] == 'verified' and query['commandFailure'] is None for query in diagnostic['packages']['queries'].values()):
                raise RuntimeError('fixture_terminal_diagnostics_unproven')
            if set(work.iterdir()) != before_entries or any((work / name).read_bytes() != raw for name, raw in before_records.items()):
                raise RuntimeError('fixture_terminal_diagnostics_wrote_state')
            result['cases'].append({'case': 'terminal_read_preserves_original_records', 'passed': True,
                'originalRecordsUnchanged': True, 'aptAttemptRecorded': True,
                'packageReadbackVerified': True, 'productionInstallationQualified': False})

            phase = 'expiry_prepare'
            op, work = prepare(2)
            machinery.run(helper.unit_arguments(op, folder / 'runner.py'))
            wait(lambda: started(op, work), 10)
            began = time.monotonic()
            phase = 'expiry_receipt'
            receipt = terminal(op, folder / 'installer.py', '0' * 64)
            elapsed = time.monotonic() - began
            if receipt['installationVerified'] or elapsed < 170 or elapsed > 195:
                raise RuntimeError('fixture_expiry_unproven')
            result['cases'].append({'case': 'actual180_second_manager_expiry', 'passed': True,
                'elapsedSeconds': round(elapsed, 3), 'terminalEvidence': receipt['managerTerminalEvidence']})
            # Retire only this already-terminal owned failed fixture unit so
            # systemd may GC it. The original invocation's manager journal is
            # now mandatory; no new transaction, expiry or native fault runs.
            phase = 'gc_receipt'
            machinery.run(['systemctl', 'reset-failed', helper.unit(op)], check=False)
            wait(lambda: scene.state(helper.unit(op)).get('LoadState') == 'not-found', 5)
            gc_receipt = terminal(op, folder / 'installer.py', '0' * 64)
            if gc_receipt['managerTerminalEvidence'] != 'manager_terminal_journal' or gc_receipt['installationVerified']:
                raise RuntimeError('fixture_unit_gc_unproven')
            result['cases'].append({'case': 'forced_unit_gc_journal_readback', 'passed': True,
                'sameInvocation': gc_receipt['sameInvocation'], 'helperCgroupEmpty': gc_receipt['helperCgroupEmpty'],
                'terminalEvidence': gc_receipt['managerTerminalEvidence'], 'productionInstallationQualified': False})
            result['qualified'] = True
            phase = 'complete'
    except Exception as error:
        known = {'fixture_deadline', 'fixture_real_root_systemd_required', 'fixture_foreign_installer_state_present',
            'fixture_foreign_capture_state_present', 'fixture_bounded_wait_unproven',
            'fixture_actual_unit_contract_unproven', 'fixture_duplicate_operation_unproven',
            'fixture_false_installation_claim', 'fixture_expiry_unproven',
            'fixture_original_package_profile_unproven', 'fixture_public_deb_unproven',
            'fixture_install_interval_not_observed', 'fixture_exact_install_path_unproven',
            'fixture_foreign_network_present', 'fixture_network_identity_unproven', 'fixture_health_only_target_unproven', 'fixture_target_image_unproven',
            'fixture_terminal_receipt_unproven', 'fixture_terminal_diagnostics_unproven', 'fixture_terminal_diagnostics_wrote_state', 'fixture_unit_gc_unproven', 'fixture_ssh_runtime_prerequisite_refused'}
        known |= {'fixture_command_refused', 'fixture_command_output_bound', 'fixture_foreign_container_present',
            'fixture_container_id_refused', 'fixture_target_readiness', 'fixture_pinned_target_refused',
            'fixture_network_subject_refused', 'fixture_actual_health_publication_refused',
            'fixture_health_response_bound', 'fixture_published_health_refused', 'fixture_local_ssh_readiness'}
        known |= set(getattr(native, 'REFUSAL_CODES', ())) | set(getattr(source, 'REASONS', ()))
        result['reason'] = str(error) if str(error) in known else 'fixture_lifecycle_unproven'
        result['failurePhase'] = phase
        result['failureType'] = type(error).__name__ if type(error).__name__ in {
            'RuntimeError', 'ValueError', 'KeyError', 'TypeError', 'AttributeError', 'NameError', 'OSError', 'PermissionError', 'FileNotFoundError', 'TimeoutExpired', 'AssertionError'} else 'unproven'
        result['errno'] = error.errno if isinstance(error, OSError) and type(error.errno) is int else None
        if scene is not None and scene.ssh_log is not None:
            try:
                with scene.ssh_log.open('rb') as stream:
                    result['sshDiagnostics'] = ssh_diagnostics(stream.read(65537))
            except OSError:
                result['sshDiagnostics'] = {'categories': ['unknown'], 'boundExceeded': False}
        if work is not None and native is not None:
            try:
                record = native.read_json(work / 'operation.json')
                result['operationState'] = {
                    'commandFailure': source.command_failure_outcome(record.get('commandFailure')),
                    'phase': record.get('phase') if record.get('phase') in {'prepared', 'preparing', 'installing', 'verifying', 'verified', 'refused'} else 'unproven',
                    'reason': record.get('result') if record.get('result') in getattr(source, 'REASONS', ()) else 'unproven',
                    'aptAttemptRecorded': (work / 'apt-attempt.json').is_file()}
            except Exception:
                result['operationState'] = {
                    'commandFailure': source.command_failure_outcome(record.get('commandFailure')),'phase': 'unproven'}
    finally:
        signal.alarm(0)  # Parent reserves180s for the bounded Scene cleanup.
        try:
            if scene is not None:
                # These exact names were registered by prepare(), never globbed.
                for name in owned_units:
                    scene.units.append(name)
                scene.cleanup()
                if scene.resource_ack_unknown:
                    raise RuntimeError('fixture_cleanup_unproven')
                if scene.docker('ps', '--all', '--no-trunc', '--filter',
                        'name=^/' + machinery.CONTAINER + '$', '--format', '{{.ID}}'):
                    raise RuntimeError('fixture_cleanup_unproven')
            if created_state:
                if helper.STATE.is_symlink() or not helper.STATE.is_dir() or not shutil.rmtree.avoids_symlink_attacks:
                    raise RuntimeError('fixture_cleanup_unproven')
                shutil.rmtree(helper.STATE)
            if temporary is not None:
                temporary.cleanup()
            result['cleanupConfirmed'] = True
        except Exception:
            result['cleanupConfirmed'] = False
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, separators=(',', ':')))
    if not result['qualified'] or not result['cleanupConfirmed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
