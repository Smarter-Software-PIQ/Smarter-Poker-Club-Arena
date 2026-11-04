#!/usr/bin/env python3
"""Finite qualification of the original transaction-only terminal boundary."""
from contextlib import ExitStack
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import shutil
import shlex
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

# A pre-push hook exports its owning GIT_DIR. Every Git call below must
# resolve the explicitly selected source or disposable proof repository.
# Inheriting the hook pointer makes the pinned floor traverse today's main
# instead and can write fixture refs into the caller's repository.
for _git_name in tuple(os.environ):
    if _git_name.startswith('GIT_'):
        os.environ.pop(_git_name)

# macOS requires the caller's owned SSD TMPDIR; hosted Linux supplies RUNNER_TEMP.
TEST_TMP = os.environ.get('TMPDIR') or (os.environ.get('RUNNER_TEMP') if sys.platform.startswith('linux') else None)
if not TEST_TMP:
    raise RuntimeError('An explicit owned TMPDIR or hosted Linux RUNNER_TEMP is required')
TEST_TMP = str(Path(TEST_TMP).resolve(strict=True))

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('withdrawal', ROOT / 'scripts/ci/withdraw-waiting-engine-release.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


history_spec = importlib.util.spec_from_file_location('pinned_history_sources',
    ROOT / 'tests/operations/pinned-history-sources.py')
history = importlib.util.module_from_spec(history_spec)
history_spec.loader.exec_module(history)
hydrate_historical_sources = history.hydrate_historical_sources

def prepare_history(allow_fetch=False):
    controls = [value for name, value in vars(module).items()
                if name.endswith('_CONTROL') and isinstance(value, str)]
    paths = ['server/scripts/' + name for name in module.GENERIC_SOURCE_NAMES] + [
        'server/scripts/engine-release-unit-wrapper.sh',
        'server/scripts/engine-release-intake.sh',
        'server/release/activation-floor.json',
        'server/release/owner-maintenance-windows.json',
        'server/src/maintenance/maintenanceSchedulePolicy.json',
        '.gitattributes', '.gitmodules']
    hydrate_historical_sources(ROOT, controls, paths,
        budget_seconds=90 if allow_fetch else 10, allow_fetch=allow_fetch)
    # Missing source during any of the behavioral cases is now a named failure,
    # not an implicit network transaction inside the unchanged sixty-second run.
    os.environ['GIT_NO_LAZY_FETCH'] = '1'


def setUpModule():
    prepare_history()


class HistoricalSourceHydration(unittest.TestCase):
    def test_exact_promisor_blobs_arrive_in_one_batch_without_ref_or_fallback_writes(self):
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        def git(*args, cwd=None, extra=None):
            return subprocess.run(['git', *args], cwd=cwd, env={**env, **(extra or {})},
                capture_output=True, text=True, check=True, timeout=10).stdout.strip()
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as directory:
            root = Path(directory); source = root / 'source'; source.mkdir()
            git('init', '-q', cwd=source)
            for name in ('one', 'two', 'unrequested'):
                (source / (name + '.txt')).write_text(name + ' original bytes\n')
            git('add', '.', cwd=source)
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                'commit', '-qm', 'fixture', cwd=source)
            revision = git('rev-parse', 'HEAD', cwd=source)
            git('config', 'uploadpack.allowFilter', 'true', cwd=source)
            log = root / 'fetch.log'; wrapper = root / 'upload-pack'
            wrapper.write_text('#!/bin/sh\nprintf "fetch\\n" >> ' + shlex.quote(str(log)) +
                               '\nexec git-upload-pack "$@"\n')
            wrapper.chmod(0o700)
            for name, batch in [('before', False), ('after', True)]:
                client = root / name
                git('clone', '--filter=blob:none', '--no-checkout', '--bare',
                    source.as_uri(), str(client))
                git('config', 'remote.origin.uploadpack', str(wrapper), cwd=client)
                log.write_text('')
                refs = git('show-ref', cwd=client); head = (client / 'HEAD').read_bytes()
                if batch:
                    with self.assertRaisesRegex(ValueError, 'network-free behavior'):
                        hydrate_historical_sources(client, [revision], ['one.txt', 'two.txt'], allow_fetch=False)
                    self.assertEqual(log.read_text(), '')
                    self.assertEqual(hydrate_historical_sources(client, [revision], ['one.txt', 'two.txt']), 2)
                    self.assertEqual(hydrate_historical_sources(client, [revision], ['one.txt', 'two.txt'], allow_fetch=False), 0)
                for path in ('one.txt', 'two.txt'):
                    self.assertEqual(git('show', revision + ':' + path, cwd=client,
                        extra={'GIT_NO_LAZY_FETCH': '1'} if batch else {}),
                        (source / path).read_text().strip())
                self.assertEqual(len(log.read_text().splitlines()), 1 if batch else 2)
                self.assertEqual(git('show-ref', cwd=client), refs)
                self.assertEqual((client / 'HEAD').read_bytes(), head)
                oid = git('rev-parse', revision + ':unrequested.txt', cwd=client)
                absent = subprocess.run(['git', '-C', str(client), 'cat-file', '--batch-check'],
                    input=oid + '\n', env={**env, 'GIT_NO_LAZY_FETCH': '1'},
                    capture_output=True, text=True, check=True, timeout=5).stdout.strip()
                self.assertEqual(absent, oid + ' missing')
            # Unknown references and missing blobs without the configured
            # promisor are refusals, not requests to broaden the fetch.
            log.write_text('')
            for bad in ('main', 'f' * 40):
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    hydrate_historical_sources(client, [bad], ['unrequested.txt'])
            git('config', 'remote.origin.promisor', 'false', cwd=client)
            with self.assertRaises(ValueError):
                hydrate_historical_sources(client, [revision], ['unrequested.txt'])
            self.assertEqual(log.read_text(), '')
            git('config', 'remote.origin.promisor', 'true', cwd=client)
            wrapper.write_text('#!/bin/sh\nprintf "fetch\\n" >> ' + shlex.quote(str(log)) + '\nexit 73\n')
            with self.assertRaises(subprocess.CalledProcessError):
                hydrate_historical_sources(client, [revision], ['unrequested.txt'])
            self.assertEqual(log.read_text().splitlines(), ['fetch'])
            # A delayed remote child retaining the pipes must be killed with
            # its Git parent, not escape the bootstrap's wall-clock bound.
            pid_file = root / 'transport-child.pid'
            wrapper.write_text('#!/bin/sh\nsleep 30 &\necho $! > ' + shlex.quote(str(pid_file)) + '\nwait\n')
            started = time.monotonic()
            with self.assertRaises(subprocess.TimeoutExpired):
                hydrate_historical_sources(client, [revision], ['unrequested.txt'], budget_seconds=2)
            self.assertLess(time.monotonic() - started, 2.5)
            child = int(pid_file.read_text())
            expiry = time.monotonic() + 1
            while time.monotonic() < expiry:
                try: os.kill(child, 0)
                except ProcessLookupError: break
                time.sleep(0.01)
            else: self.fail('Owned timed-out transport child survived cleanup')
            self.assertEqual(git('show-ref', cwd=client), refs)
            self.assertEqual((client / 'HEAD').read_bytes(), head)


class Withdrawal(unittest.TestCase):
    def setUp(self):
        self.request = {'runKey': '39902613436-2', 'releaseSha': 'a' * 40,
                        'controlSha': 'b' * 40, 'desiredSha': 'c' * 40,
                        'instanceId': '1-8c0c99a7'}
        self.health = {'releaseSha': 'c' * 40, 'instanceId': '1-8c0c99a7',
                       'running': True, 'liveness': 'ok',
                       'maintenance': {'active': False, 'phase': 'idle'}}

    def test_exact_attempt_is_required(self):
        self.assertEqual(module.selection(self.request), self.request)
        for key, bad in [('runKey', '39902613436'), ('runKey', '../39902613436-2'),
                         ('runKey', '39902613436-0'), ('releaseSha', 'a' * 8),
                         ('releaseSha', 'A' * 40), ('controlSha', None),
                         ('desiredSha', 'a' * 40), ('instanceId', '1-*')]:
            with self.subTest(key=key, bad=bad), self.assertRaises(ValueError):
                module.selection({**self.request, key: bad})
        for key in self.request:
            bad = dict(self.request)
            del bad[key]
            with self.subTest(missing=key), self.assertRaises(ValueError):
                module.selection(bad)
        with self.assertRaises(ValueError):
            module.selection({**self.request, 'command': 'restart'})

    def test_new_generation_or_break_refuses(self):
        module.healthy(self.health, self.request)
        for change in [{'releaseSha': 'a' * 40}, {'instanceId': '1-deadbeef'},
                       {'running': False}, {'running': 1}, {'liveness': 'dead'},
                       {'maintenance': {'active': True, 'phase': 'last_hand'}},
                       {'maintenance': {'active': False, 'phase': 'counting_down'}},
                       {'maintenance': {}}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.healthy({**self.health, **change}, self.request)

    def test_exact_child_command_only(self):
        expected = ['/managed/control/engine-release-transaction.sh', '--run-id', '39902613436-2']
        self.assertTrue(module.bash_command(['bash', *expected], expected))
        for args in [['bash', *expected, '--force'], ['sh', *expected],
                     ['bash', expected[0], '--run-id', '39902613436-1'],
                     ['bash', '/managed/engine-release-unit-wrapper-v1.sh', 'start', '39902613436-2']]:
            self.assertFalse(module.bash_command(args, expected))

    def test_container_read_never_selects_runtime_environment(self):
        value = {'id': 'a' * 64, 'image': 'sha256:' + 'c' * 64,
                 'running': True, 'startedAt': 'original', 'releaseSha': self.request['desiredSha']}
        with patch.object(module, 'command', return_value=json.dumps(value)) as command:
            self.assertEqual(module.container_identity(self.request)['id'], 'a' * 64)
            args = command.call_args.args[0]
            self.assertEqual(args[:4], ['docker', 'container', 'inspect', '--format'])
            self.assertNotIn('Env', args[4])
            self.assertNotIn('{{json .Config}}', args[4])
            self.assertEqual(args[-1], 'club-arena-engine')

    def test_lost_ack_reads_terminal_without_a_second_signal(self):
        with patch.object(os.path, 'lexists', return_value=True), \
             patch.object(os, 'getuid', return_value=0), \
             patch.object(module, 'terminal', return_value={'result': 'terminal'}) as terminal, \
             patch.object(os, 'pidfd_open', create=True) as opened, \
             patch.object(signal, 'pidfd_send_signal', create=True) as sent:
            self.assertEqual(module.remote(self.request), {'result': 'terminal'})
            terminal.assert_called_once_with(self.request)
            opened.assert_not_called()
            sent.assert_not_called()

    def test_current_sources_keep_original_recovery_authority(self):
        transaction = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        wrapper = (ROOT / 'server/scripts/engine-release-unit-wrapper.sh').read_text()
        self.assertIn("trap 'exit 130' INT", transaction)
        self.assertIn('[ "$TRANSACTION_RC" -eq 75 ] && exit 75', wrapper)
        start = wrapper.index('# A permanent proof/application failure first restores')
        tail = wrapper[start:]
        self.assertLess(tail.index('--mode retryable'), tail.index('record-failure'))
        self.assertLess(tail.index('record-failure'), tail.index('attest-failure'))
        self.assertLess(tail.index('attest-failure'), tail.index('--mode terminal'))

    def test_receiver_separates_withdrawal_from_image_authority(self):
        workflow = (ROOT / '.github/workflows/auto-deploy-hetzner.yml').read_text()
        job = workflow.split('  withdraw-waiting-release:', 1)[1].split('\n  preflight:', 1)[0]
        self.assertIn("if: github.event.action == 'withdraw-club-arena-engine'", job)
        self.assertIn('waiting-engine-release-withdrawal.test.py', job)
        self.assertIn('withdraw-waiting-engine-release.py', job)
        self.assertIn('group: club-arena-engine-withdrawal-${{ github.event.client_payload.withdrawal.runKey }}', job)
        self.assertIn('cancel-in-progress: false', job)
        for prohibited in ['docker ', 'engine-up', 'stage-engine', 'DATABASE_URL', 'deploy-club-arena-engine']:
            self.assertNotIn(prohibited, job)
        preflight = workflow.split('\n  preflight:', 1)[1].split('\n  engine-doors:', 1)[0]
        self.assertIn("if: github.event.action == 'deploy-club-arena-engine'", preflight)

    def test_remote_has_no_record_rewrite_or_unit_signal(self):
        source = (ROOT / 'scripts/ci/withdraw-waiting-engine-release.py').read_text()
        remote = source.split('def remote(request):', 1)[1].split('\ndef main():', 1)[0]
        self.assertIn('signal.pidfd_send_signal(pid_fd, signal.SIGINT)', remote)
        for forbidden in ['os.kill(', 'SIGTERM', 'SIGKILL', 'systemctl stop', 'systemctl kill',
                          '.write_text(', '.unlink(', 'record-failure', 'prepare', 'commit']:
            self.assertNotIn(forbidden, remote)

    def test_connected_admission_signal_and_original_receipt_readback(self):
        for refusal in (None, 'pending', 'foreign-marker', 'foreign-parent', 'active-break',
                        'unit-race', 'database-refusal', 'changed-container'):
            with self.subTest(refusal=refusal), tempfile.TemporaryDirectory(
                    prefix='withdrawal-owner-', dir=os.environ.get('TMPDIR')) as directory, ExitStack() as patches:
                root = Path(directory) / 'state'
                parent = Path(directory) / 'control'
                proc = Path(directory) / 'proc'
                generation = parent / 'engine-control-generations' / self.request['controlSha']
                generation.mkdir(parents=True)
                (generation / 'control-sha').write_text(self.request['controlSha'] + '\n')
                request_root = root / 'engine-release-requests'
                pin_root = root / 'engine-release-generation-pins'
                result_root = root / 'engine-release-results'
                for d in (request_root, pin_root, result_root):
                    d.mkdir(parents=True)
                key = self.request['runKey']
                request_file = request_root / (key + '.request')
                request_file.write_text('\n'.join([self.request['releaseSha'], 'url', 'actor', str(generation), self.request['controlSha'], '1999999999']) + '\n')
                request_file.chmod(0o600)
                pin_file = pin_root / (key + '.generation')
                pin_file.write_text(str(generation) + '\n' + self.request['controlSha'] + '\n')
                pin_file.chmod(0o600)
                marker = request_root / (key + '.awaiting-certificate')
                marker.write_text(('d' * 40 if refusal == 'foreign-marker' else self.request['releaseSha']) + '\n')
                task = proc / '12/task/12'
                task.mkdir(parents=True)
                (task / 'children').write_text('13')
                engine_lock = Path(directory) / 'lock'
                engine_lock.touch()
                invocation = 'f' * 32
                state = {'MainPID': '12', 'InvocationID': invocation, 'ActiveState': 'active', 'Result': 'success', 'ExecMainStatus': '0'}
                withdrawn = []
                property_calls = []

                def properties(_unit):
                    property_calls.append(_unit)
                    if withdrawn:
                        return {**state, 'MainPID': '0', 'ActiveState': 'inactive'}
                    return {**state, 'MainPID': '14' if refusal == 'unit-race' and len(property_calls) > 1 else '12'}

                def process(pid):
                    return {'pid': pid, 'parent': 9 if refusal == 'foreign-parent' else (1 if pid == 12 else 12), 'start': '100',
                            'argv': ['bash', str(parent / 'engine-release-unit-wrapper-v1.sh'), 'start', key] if pid == 12 else
                                    ['bash', str(generation / 'engine-release-transaction.sh'), '--run-id', key]}

                def command(args, timeout=5):
                    if 'pending-owner' in args:
                        return 'active other false 1999999999' if refusal == 'pending' else 'none'
                    if 'desired-sha' in args:
                        return self.request['desiredSha']
                    if args[0].endswith('engine-release-database-proof.py'):
                        if refusal == 'database-refusal':
                            raise ValueError('Database leader differs')
                        return 'proved'
                    if 'attest-failure' in args:
                        self.assertTrue(withdrawn)
                        return 'failed'
                    if args[0] == 'systemctl' and args[-1] == '--value':
                        return 'inactive'
                    raise AssertionError('Unexpected command ' + str(args))

                container_reads = []

                def identity(_request):
                    container_reads.append(True)
                    return {'id': 'b' * 64 if refusal == 'changed-container' and len(container_reads) > 1 else 'a' * 64,
                            'startedAt': 'original', 'image': 'sha256:' + 'c' * 64}

                def health(_request):
                    if refusal == 'active-break':
                        raise ValueError('Maintenance active')

                def original_wrapper(fd, sent_signal):
                    self.assertEqual(sent_signal, signal.SIGINT)
                    self.assertFalse(withdrawn)
                    withdrawn.append(True)
                    result = {'result': 'failed', 'transactionExitStatus': 130, 'runId': key,
                              'sha': self.request['releaseSha'], 'controlSha': self.request['controlSha'],
                              'recoveredDesiredSha': self.request['desiredSha'], 'invocationId': invocation}
                    (result_root / (key + '.json')).write_text(json.dumps(result))
                    for path in (request_file, pin_file, marker):
                        path.unlink()

                original_fstat = os.fstat

                def root_owned(fd):
                    data = list(original_fstat(fd))
                    data[4] = 0
                    return os.stat_result(data)

                for name, value in [('ROOT', root), ('PARENT', parent), ('PROC', proc), ('ENGINE_LOCK', engine_lock),
                                    ('properties', properties), ('process', process), ('command', command),
                                    ('health_pair', health), ('container_identity', identity)]:
                    patches.enter_context(patch.object(module, name, value))
                patches.enter_context(patch.object(os, 'getuid', return_value=0))
                patches.enter_context(patch.object(os, 'fstat', side_effect=root_owned))
                patches.enter_context(patch.object(os, 'pidfd_open', create=True, side_effect=lambda pid: os.open(os.devnull, os.O_RDONLY)))
                sent = patches.enter_context(patch.object(signal, 'pidfd_send_signal', create=True, side_effect=original_wrapper))
                if refusal:
                    with self.assertRaises(ValueError):
                        module.remote(self.request)
                    sent.assert_not_called()
                else:
                    answer = module.remote(self.request)
                    self.assertEqual(answer['result'], 'withdrawn-before-mutation')
                    self.assertTrue(answer['originalTerminalEdgesRetired'])
                    self.assertTrue(answer['servingInstanceUnchanged'])
                    sent.assert_called_once()
                    self.assertEqual(module.remote(self.request), answer)
                    sent.assert_called_once()

    def test_native_transaction_int_exits_through_the_terminal_boundary(self):
        # The maintained production INT trap is exercised in a real child;
        # Linux additionally exercises the exact pidfd signal primitive.
        transaction = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        trap = next(line for line in transaction.splitlines() if line == "trap 'exit 130' INT")
        with tempfile.TemporaryDirectory(prefix='withdrawal-signal-', dir=os.environ.get('TMPDIR')) as directory:
            path = Path(directory) / 'transaction.sh'
            path.write_text(trap + "\nprintf 'ready\\n'\nwhile :; do sleep 0.05; done\n")
            process = subprocess.Popen(['bash', str(path)], stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(process.stdout.readline(), 'ready\n')
                if hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'):
                    fd = os.pidfd_open(process.pid)
                    try:
                        signal.pidfd_send_signal(fd, signal.SIGINT)
                    finally:
                        os.close(fd)
                else:
                    os.kill(process.pid, signal.SIGINT)
                self.assertEqual(process.wait(timeout=3), 130)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=3)
                process.stdout.close()


class AnnouncedCancellation(unittest.TestCase):
    def phase1_request(self):
        return {'runKey': module.PHASE1_RUN, 'releaseSha': module.PHASE1_TARGET,
            'controlSha': module.PHASE1_CONTROL, 'desiredSha': module.PHASE1_DESIRED,
            'instanceId': '1-2ced3e43', 'mode': 'cancel_expired_announcement'}

    def test_exact26_successor_requires_positive_kernel_incarnation(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder:
            proc = Path(folder); pid = 12345; row = proc / str(pid); row.mkdir()
            (row / 'ns').mkdir(); (row / 'ns/pid').symlink_to('pid:[987654]')
            (proc / 'stat').write_text('btime 1793638800\n')
            fields = ['S', '1'] + ['0'] * 17 + ['390000']
            (row / 'stat').write_text(str(pid) + ' (node) ' + ' '.join(fields))
            (row / 'status').write_text('Name:\tnode\nNSpid:\t12345\t1\n')
            group = '/system.slice/docker-' + 'a' * 64 + '.scope'
            (row / 'cgroup').write_text('0::' + group + '\n')
            receipt_ms = 1793641918674
            with patch.object(module, 'PROC', proc), patch.object(module.os, 'sysconf', return_value=100), \
                 patch.object(module.time, 'time', return_value=1793643300):
                witness = module.current26_kernel_identity(pid, 'a' * 64, receipt_ms)
                self.assertEqual(witness['pid'], pid)
                self.assertEqual(witness['startTicks'], 390000)
                for field, bad in [('stat', str(pid) + ' (node) ' + ' '.join(fields[:19] + ['1'])),
                                   ('stat', str(pid) + ' (node) ' + ' '.join(['Z'] + fields[1:])),
                                   ('status', 'NSpid:\t12345\t2\n'), ('status', 'NSpid:\t999\t1\n'),
                                   ('cgroup', '0::/system.slice/docker-' + 'b' * 64 + '.scope\n')]:
                    path = row / field; before = path.read_text(); path.write_text(bad)
                    with self.subTest(field=field, bad=bad), self.assertRaises(ValueError):
                        module.current26_kernel_identity(pid, 'a' * 64, receipt_ms)
                    path.write_text(before)
                (row / 'ns/pid').unlink(); (row / 'ns/pid').symlink_to('unknown')
                with self.assertRaises(ValueError): module.current26_kernel_identity(pid, 'a' * 64, receipt_ms)

    def test_exact26_successor_runtime_binds_native_and_both_health_endpoints(self):
        class Response:
            def __init__(self, url, value): self.url, self.value = url, value
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def geturl(self): return self.url
            def read(self, maximum): return json.dumps(self.value).encode()
        request = {'runKey': module.CURRENT26_RUN, 'releaseSha': module.CURRENT26_TARGET,
                   'controlSha': module.CURRENT26_CONTROL, 'desiredSha': module.PHASE1_DESIRED,
                   'instanceId': '1-43c66515', 'mode': 'cancel_expired_announcement'}
        image = 'sha256:2eb1c5a7279032240c5fff8a6b3ecf5dc6af735cc1227a51430d50dcae1b065b'
        old = {'id': 'a' * 64, 'image': image, 'startedAt': '2026-11-02T17:45:06Z'}
        receipt = {'container': old, 'observedAt': '2026-11-02T17:51:58.674442+00:00'}
        live = old | {'startedAt': '2026-11-02T18:05:00Z'}
        native = live | {'pid': 12345, 'status': 'running', 'running': True}
        health = {'instanceId': '1-17a6d6ef', 'releaseSha': request['desiredSha'],
                  'running': True, 'liveness': 'ok', 'maintenance': {'active': False, 'phase': 'idle'}}
        seen = []
        def response(url, timeout):
            seen.append(url.split('?',1)[0]); return Response(url, health)
        with patch.object(module, 'container_identity', return_value=live), \
             patch.object(module, 'command', return_value=json.dumps(native)), \
             patch.object(module, 'current26_kernel_identity', return_value={'pid': 12345, 'startTicks': 390000}) as kernel, \
             patch.object(module.urllib.request, 'urlopen', side_effect=response), \
             patch.object(module.time, 'time', return_value=1793643300):
            witness = module.current26_cancelled_runtime(request, receipt)
            self.assertEqual(witness['request']['instanceId'], '1-17a6d6ef')
            self.assertEqual(witness['container'], live)
            self.assertEqual(request['instanceId'], '1-43c66515')
            self.assertEqual(receipt['container'], old)
            self.assertEqual(seen, ['http://127.0.0.1:8080/health', 'http://127.0.0.1:8080/health', 'https://engine.smarter.poker/health'])
            self.assertEqual(kernel.call_count, 2)
            for changed in [native | {'pid': 0}, native | {'pid': True}, native | {'running': False},
                            native | {'id': 'b' * 64}, native | {'image': 'sha256:' + 'b' * 64}]:
                with patch.object(module, 'command', return_value=json.dumps(changed)), self.assertRaises(ValueError):
                    module.current26_cancelled_runtime(request, receipt)
            with patch.object(module, 'command', side_effect=[json.dumps(native), json.dumps(native | {'pid': 45678})]), self.assertRaises(ValueError):
                module.current26_cancelled_runtime(request, receipt)
            for changed in [live | {'id': 'b' * 64}, live | {'image': 'sha256:' + 'b' * 64},
                            live | {'startedAt': '2026-11-02T17:50:00Z'}]:
                with patch.object(module, 'container_identity', return_value=changed), self.assertRaises(ValueError):
                    module.current26_cancelled_runtime(request, receipt)
            with patch.object(module, 'current26_kernel_identity', side_effect=[{'pid': 12345}, {'pid': 45678}]), self.assertRaises(ValueError):
                module.current26_cancelled_runtime(request, receipt)
            for changed in [health | {'instanceId': request['instanceId']}, health | {'releaseSha': module.CURRENT26_TARGET},
                            health | {'maintenance': {'active': True, 'phase': 'counting_down'}}]:
                with patch.object(module.urllib.request, 'urlopen', side_effect=lambda url,timeout:Response(url,changed)), self.assertRaises(ValueError):
                    module.current26_cancelled_runtime(request, receipt)
            calls = iter([health, health, health | {'instanceId': '1-deadbeef'}])
            with patch.object(module.urllib.request, 'urlopen', side_effect=lambda url,timeout:Response(url,next(calls))), self.assertRaises(ValueError):
                module.current26_cancelled_runtime(request, receipt)

    def test_exact26_proof_projects_current_runtime_preserving_historical_receipts(self):
        with patch.dict(module.__dict__, clear=False):
            module.select_current26_profile()
            current = {'container': {'id': 'a' * 64, 'image': 'sha256:' + 'b' * 64,
                       'startedAt': '2026-11-02T18:05:00Z'},
                       'request': self.phase1_request() | {'instanceId': '1-17a6d6ef'},
                       'process': {'pid': 12345, 'startTicks': 390000}}
            self.test_phase1_final_proof_requires_immutable_receipts_quiescence_and_no_custody(current)

    def test_historical_final_proofs_do_not_use_successor_capability(self):
        for second in (False, True):
            with self.subTest(second=second), patch.dict(module.__dict__, clear=False):
                if second: module.select_second_phase1_profile()
                with patch.object(module, 'current26_cancelled_runtime', side_effect=AssertionError('historical profile broadened')):
                    self.test_phase1_final_proof_requires_immutable_receipts_quiescence_and_no_custody()

    def test_exact26_distinct_target_control_and_deadline(self):
        with patch.dict(module.__dict__, clear=False):
            module.select_current26_profile()
            request = self.phase1_request() | {'releaseSha': module.CURRENT26_TARGET}
            profile = module.cancellation_profile(request)
            self.assertNotEqual(profile['target'], profile['control'])
            self.assertEqual(profile['deadline'], '1793644848')
            self.assertEqual(profile['hashes'], module.CURRENT26_HASHES)
            for key, value in [('releaseSha', module.CURRENT26_CONTROL), ('controlSha', module.CURRENT26_TARGET),
                               ('desiredSha', module.CURRENT26_TARGET), ('runKey', '41469215622-2')]:
                with self.subTest(key=key), self.assertRaises(ValueError):
                    module.cancellation_profile(request | {key: value})
    def test_exact26_observation_retains_unknown_without_mutation(self):
        with patch.dict(module.__dict__, clear=False):
            request = {'runKey': module.CURRENT26_RUN, 'releaseSha': module.CURRENT26_TARGET,
                       'controlSha': module.CURRENT26_CONTROL, 'desiredSha': module.PHASE1_DESIRED,
                       'instanceId': '1-b22cba29', 'mode': 'observe_expired_announcement'}
            with patch.object(os, 'getuid', return_value=0), patch.object(module, 'own_wants_edge'), \
                 patch.object(module, 'health_pair'), patch.object(module, 'container_identity', return_value={'id': 'known'}), \
                 patch.object(module, 'collect_cancellation_admission', side_effect=ValueError('UNKNOWN process')) as collect, \
                 patch.object(module, 'cancellation_directory', side_effect=AssertionError('mutation')), \
                 patch.object(module.os, 'open', side_effect=AssertionError('lock')):
                answer = module.remote(request)
                self.assertEqual(answer['result'], 'unproved')
                self.assertTrue(answer['readOnly']); self.assertFalse(answer['retryAllowed'])
                self.assertNotIn('UNKNOWN process', json.dumps(answer))
                self.assertEqual(collect.call_args.kwargs, {'read_only': True})
            # Actual immutable blobs, rather than a fixture hash stub, establish
            # the profile's complete six-file source identity.
            for name, digest in module.CURRENT26_HASHES.items():
                raw = subprocess.check_output(['git', 'show', module.CURRENT26_CONTROL + ':server/scripts/' + name], cwd=ROOT, timeout=30)
                self.assertEqual(module.digest(raw), digest)

    def test_exact26_guarded_empty_withdrawal_interruption_and_unknown(self):
        with patch.dict(module.__dict__, clear=False):
            module.select_current26_profile()
            # Reuse the real filesystem/lock/immutable-record harness and its
            # interruption, changed-invocation and lost-ack cases for this exact
            # distinct controller. Original cause is not a fabricated failure.
            self.test_phase1_mask_only_empty_retry_retires_once_without_signalling()
            self.test_phase1_live_invocation_refuses_before_mask_or_stop()
            self.test_phase1_unproved_empty_admission_cannot_create_masks_or_issue_stop()

    def test_canonical_only_large_history_bound_and_private_stability(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder:
            path = Path(folder) / 'canonical'
            actual = module.os.fstat
            def root_owned(fd):
                row = actual(fd)
                return SimpleNamespace(**{k: (0 if k == 'st_uid' else getattr(row, k)) for k in
                    ('st_dev','st_ino','st_mode','st_uid','st_size','st_mtime_ns','st_ctime_ns')})
            with patch.object(module.os, 'fstat', side_effect=root_owned):
                path.write_text('x' * 65537); path.chmod(0o600)
                self.assertEqual(len(module.canonical_seal_bytes(path)), 65537)
                with self.assertRaises(ValueError): module.regular(path, 0o600)
                with path.open('wb') as out: out.truncate(16 * 1024 * 1024 + 1)
                with self.assertRaises(ValueError): module.canonical_seal_bytes(path)
                path.write_text('small'); path.chmod(0o644)
                with self.assertRaises(ValueError): module.canonical_seal_bytes(path)
                path.chmod(0o600)
                link = Path(folder) / 'link'; link.symlink_to(path)
                with self.assertRaises(OSError): module.canonical_seal_bytes(link)
                fd = os.open(path, os.O_RDONLY)
                try: before = root_owned(fd)
                finally: os.close(fd)
                with patch.object(module.os, 'fstat', side_effect=[before, SimpleNamespace(**(vars(before) | {'st_mtime_ns': before.st_mtime_ns + 1}))]):
                    with self.assertRaises(ValueError): module.canonical_seal_bytes(path)

    def test_exact26_actual_pinned_floor_and_distinct_cycle(self):
        with patch.dict(module.__dict__, clear=False):
            module.select_current26_profile()
            self.test_phase1_actual_pinned_v3_floor_bootstrap_and_no_bytecode()

    def test_second_early_timer_profile_and_actual_original_controller(self):
        # A separate module namespace models one remote helper process. Old
        # profile tests below continue to exercise the original 197 identity.
        with patch.dict(module.__dict__, clear=False):
            module.select_second_phase1_profile()
            self.assertEqual(module.PHASE1_RUN,'41432783729-1')
            self.test_phase1_profile_and_original_sources_are_exact()
            self.test_phase1_thaw_is_exact_historical_tuple_not_a_timestamp_tolerance()
            self.test_phase1_seal_requires_original_uncommitted_cycle_and_no_transaction()
            self.test_phase1_actual_pinned_v3_floor_bootstrap_and_no_bytecode()

    def test_generic_later_owner_profile_is_derived_from_its_own_records(self):
        # A later announcement-only owner needs no new code: its window comes
        # from its own reservation, its sources from protected-main Git, and
        # the freeze must sit exactly on the announced marks (no tolerance).
        control = module.SECOND_PHASE1_CONTROL
        request = {'runKey': '41599999999-1', 'releaseSha': 'c' * 40, 'controlSha': control,
                   'desiredSha': module.PHASE1_DESIRED, 'instanceId': '1-b22cba29',
                   'mode': 'cancel_expired_announcement'}
        stamp = 1793635085893
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, patch.dict(module.__dict__, clear=False), \
                patch.dict(module.MARKERLESS_ORIGINALS, clear=False):
            root = Path(folder)
            (root / 'engine-release-requests').mkdir()
            reservation = {'runId': request['runKey'], 'sha': request['releaseSha'], 'announcedAt': stamp, 'cause': 'urgent'}
            entry = {'schema': 'engine-release-activation-floor/v3-phase1', 'runId': request['runKey'],
                     'targetSha': request['releaseSha'], 'controlSha': control,
                     'manifestSha256': module.PHASE1_POLICY, 'phase': 'announcement'}
            def write(path, value):
                path.write_text(json.dumps(value)); path.chmod(0o600)
            write(root / ('engine-recovery-window-' + request['runKey'] + '.json'), reservation)
            write(root / 'engine-release-requests' / (request['runKey'] + '.activation-entry'), entry)
            req = root / 'engine-release-requests' / (request['runKey'] + '.request')
            req.write_text('\n'.join([request['releaseSha'], 'url', 'actor', '/g', control, '1793644848']) + '\n'); req.chmod(0o600)
            module.ROOT = root; module.REPO = ROOT
            real_regular = module.regular
            module.regular = lambda path, mode=None: Path(path).read_text()
            try:
                module.select_profile(request)
            finally:
                module.regular = real_regular
            self.assertEqual((module.PHASE1_RUN, module.PHASE1_CONTROL, module.PHASE1_TARGET),
                             (request['runKey'], control, request['releaseSha']))
            self.assertEqual((module.PHASE1_STAMP, module.PHASE1_START, module.PHASE1_END),
                             (stamp, stamp + 120000, stamp + 420000))
            self.assertIsNone(module.PHASE1_TOKEN)
            self.assertEqual(module.PHASE1_HASHES, module.SECOND_PHASE1_HASHES)
            self.assertEqual(module.MARKERLESS_ORIGINALS[request['runKey']], '1793644848')
            profile = module.cancellation_profile(request)
            self.assertEqual((profile['control'], profile['target']), (control, request['releaseSha']))
            for field in ('releaseSha', 'controlSha', 'desiredSha'):
                with self.subTest(field=field), self.assertRaises(ValueError):
                    module.cancellation_profile(request | {field: 'a' * 40})
            iso = lambda ms: module.datetime.datetime.fromtimestamp(ms / 1000, module.datetime.timezone.utc).isoformat()
            row = {'contract_version': 3, 'announced_at': iso(stamp), 'freeze_started_at': iso(stamp + 120000),
                'release_target_at': iso(stamp + 420000), 'thawed_at': iso(stamp + 341600),
                'ownership_token': 'a993695f-4a6a-4cb3-99af-b88765f21c99', 'release_generation': 1, 'frozen_seconds': 300,
                'shifted': dict.fromkeys(module.THAW_STEPS, 0) | {'complete': True, '_targets_snapshotted': True,
                    '_target_counts': dict.fromkeys(module.THAW_STEPS, 0)}}
            prove = lambda value: module.prove_thaw([value], [], stamp, stamp + 500000, control)
            self.assertEqual(prove(row)['thawRecordedAtMs'], stamp + 341600)
            for change in ({'freeze_started_at': iso(stamp + 119999)}, {'release_target_at': iso(stamp + 419999)},
                           {'release_generation': 2}):
                with self.subTest(change=change), self.assertRaises(ValueError): prove(row | change)
        for pinned in ('41400905104-1', module.E9_RUN, '41177442979-1'):
            with self.subTest(pinned=pinned), self.assertRaises(ValueError):
                module.select_generic_phase1_profile(request | {'runKey': pinned})

    def test_phase1_actual_pinned_v3_floor_bootstrap_and_no_bytecode(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
            state = Path(folder) / 'state'; state.mkdir()
            parent = Path(folder) / 'parent'; parent.mkdir()
            request = self.phase1_request(); key = request['runKey']
            generation = parent / 'engine-control-generations' / module.PHASE1_CONTROL
            generation.mkdir(parents=True)
            for name in ('engine-release-activation-floor.py', 'engine-release-seal.py'):
                raw = subprocess.check_output(['git', 'show', module.PHASE1_CONTROL + ':server/scripts/' + name], cwd=ROOT)
                (generation / name).write_bytes(raw)
            (generation / 'engine-release-lightning-hold.py').write_text("def own_record(path,key): return {'phase':'released'}\n")
            reqroot = state / 'engine-release-requests'; reqroot.mkdir()
            raw = '\n'.join([module.PHASE1_TARGET, 'url', 'actor', str(generation), module.PHASE1_CONTROL, module.MARKERLESS_ORIGINALS[module.PHASE1_RUN]]) + '\n'
            for suffix in ('request', 'intent'): (reqroot / (key + '.' + suffix)).write_text(raw)
            entry = {'schema': 'engine-release-activation-floor/v3-phase1', 'runId': key,
                'targetSha': module.PHASE1_TARGET, 'controlSha': module.PHASE1_CONTROL,
                'manifestSha256': module.PHASE1_POLICY, 'phase': 'announcement'}
            (reqroot / (key + '.activation-entry')).write_text(json.dumps(entry))
            (reqroot / (key + '.activation-entry')).chmod(0o600)
            (reqroot / (key + '.lightning-hold.json.released')).write_text('released')
            window = {'announcedAt': module.PHASE1_STAMP, 'startsAt': module.PHASE1_STAMP + 120000,
                'endsAt': module.PHASE1_STAMP + 420000, 'verified': True}
            cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f', 'policyDigest': module.PHASE1_POLICY,
                'startsAt': (module.PHASE1_STAMP+120000)//3600000*3600, 'endsAt': (module.PHASE1_STAMP+120000)//3600000*3600+300, 'runId': key, 'sha': module.PHASE1_TARGET,
                'controlSha': module.PHASE1_CONTROL, 'status': 'reserved', 'window': window}
            seal = {'schema': 1, 'generation': 312, 'highWaterSha': module.PHASE1_DESIRED,
                'desired': {'sha': module.PHASE1_DESIRED, 'imageId': 'sha256:' + 'a' * 64},
                'pending': None, 'finalization': None, 'committedRuns': {}, 'routineMaintenanceCycles': {str(cycle['startsAt']): cycle}}
            (state / 'engine-release-seal.json').write_text(json.dumps(seal))
            reservation = state / ('engine-recovery-window-' + key + '.json')
            reservation.write_text(json.dumps({'runId': key, 'sha': module.PHASE1_TARGET, 'announcedAt': module.PHASE1_STAMP, 'cause': 'urgent'}))
            reservation.chmod(0o600)
            pins = state / 'engine-release-generation-pins'; pins.mkdir()
            (pins / (key + '.generation')).write_text(str(generation) + '\n' + module.PHASE1_CONTROL + '\n')
            # Build a private immutable commit graph and exact policy closure.
            # Shared pack lookups alone consumed the five-second CLI budget,
            # even after warming the cache. No source bytes or ancestry are faked.
            source_paths = [
                'server/release/activation-floor.json',
                'server/release/owner-maintenance-windows.json',
                'server/src/maintenance/maintenanceSchedulePolicy.json',
                'server/scripts/engine-release-intake.sh',
                'server/scripts/engine-release-transaction.sh',
                'server/scripts/engine-release-recover.sh',
                'server/scripts/engine-release-activation-floor.py',
                'server/scripts/engine-release-seal.py',
            ]
            proof_repo = Path(folder) / 'proof.git'
            # Git exports repository-local variables to push hooks. A -C path
            # does not override GIT_DIR: clear Git's own enumerated local
            # environment before accessing the independent proof repository.
            private_env = dict(os.environ)
            local_names = subprocess.check_output(['git', 'rev-parse',
                '--local-env-vars'], cwd=ROOT, text=True, timeout=5).splitlines()
            for name in local_names:
                private_env.pop(name, None)
            subprocess.run(['git', 'init', '--bare', '-q', str(proof_repo)],
                env=private_env, check=True)
            # Copy real reachable commits only, not the unrelated historical
            # file corpus. The helper still proves the actual policy ancestor.
            revisions = list(dict.fromkeys([request['releaseSha'], request['controlSha']]))
            graph = subprocess.check_output(['git', 'rev-list', *revisions],
                cwd=ROOT, timeout=30)
            graph_pack = Path(folder) / 'commits.pack'
            with graph_pack.open('wb') as output:
                subprocess.run(['git', 'pack-objects', '--quiet', '--stdout'], cwd=ROOT,
                    input=graph, stdout=output, check=True, timeout=60)
            with graph_pack.open('rb') as source:
                subprocess.run(['git', '-C', str(proof_repo), 'index-pack', '--stdin'],
                    stdin=source, stdout=subprocess.PIPE, env=private_env, check=True, timeout=30)
            graph_pack.unlink()
            copied_graph = subprocess.check_output(['git', '-C', str(proof_repo),
                'rev-list', *revisions], env=private_env, timeout=30)
            self.assertEqual(set(copied_graph.splitlines()), set(graph.splitlines()))
            specs = []
            for revision in revisions:
                paths = source_paths + subprocess.check_output(['git', 'ls-tree', '--name-only',
                    revision, '--', '.gitattributes', '.gitmodules'],
                    cwd=ROOT, text=True, timeout=30).splitlines()
                specs.append(revision + '^{tree}')
                for source_path in paths:
                    parts = source_path.split('/')
                    specs.extend(revision + ':' + '/'.join(parts[:n])
                                 for n in range(1, len(parts) + 1))
            specs = list(dict.fromkeys(specs))
            object_ids = subprocess.check_output(['git', 'rev-parse', *specs], cwd=ROOT,
                                                  text=True, timeout=30).splitlines()
            self.assertEqual(len(object_ids), len(specs))
            # This batch hydrates the exact promisor object closure through
            # the configured source before any network-free helper deadline.
            object_bytes = subprocess.check_output(['git', 'cat-file', '--batch'], cwd=ROOT,
                input=('\n'.join(object_ids) + '\n').encode(), timeout=30)
            stream = io.BytesIO(object_bytes); records = []
            for oid in object_ids:
                header = stream.readline().decode().split()
                self.assertEqual(header[0], oid)
                self.assertIn(header[1], ('blob', 'tree'))
                records.append((oid, header[1], stream.read(int(header[2]))))
                self.assertEqual(stream.read(1), b'\n')
            self.assertEqual(stream.read(), b'')
            # Attribute blobs precede trees so normal Git fsck remains enabled.
            for oid, kind, data in sorted(records, key=lambda row: row[1] != 'blob'):
                copied = subprocess.check_output(['git', '-C', str(proof_repo),
                    'hash-object', '-t', kind, '-w', '--stdin'], input=data,
                    env=private_env, timeout=30).decode().strip()
                self.assertEqual(copied, oid)
                local_object = proof_repo / 'objects' / oid[:2] / oid[2:]
                self.assertTrue(local_object.is_file() and not local_object.is_symlink())
            self.assertFalse((proof_repo / 'objects/info/alternates').exists())
            subprocess.run(['git', '-C', str(proof_repo), 'update-ref', 'refs/remotes/origin/main', module.PHASE1_CONTROL], env=private_env, check=True)
            calls = []
            def command(args, timeout=5):
                calls.append(args)
                self.assertEqual(args[:2], ['python3', '-B'])
                # Real pinned floor CLI and imported seal, against exact original
                # policy bytes and isolated canonical files. No production IO.
                selected = [str(proof_repo) if arg == '/opt/club-arena' else arg for arg in args]
                env = dict(private_env); env.pop('PYTHONDONTWRITEBYTECODE', None)
                return subprocess.check_output(selected, env=env, timeout=timeout, text=True).strip()
            for name, value in [('ROOT', state), ('PARENT', parent)]:
                patches.enter_context(patch.object(module, name, value))
            patches.enter_context(patch.object(module, 'regular', side_effect=lambda p, mode=None: Path(p).read_text()))
            patches.enter_context(patch.object(module, 'canonical_seal_bytes', side_effect=lambda p: Path(p).read_text()))
            patches.enter_context(patch.object(module, 'source_hash', side_effect=lambda p: module.WRAPPER_HASH if p.name == 'engine-release-unit-wrapper-v1.sh' else module.PHASE1_HASHES[p.name]))
            patches.enter_context(patch.object(module, 'command', side_effect=command))
            patches.enter_context(patch.object(module, 'own_thaw', return_value={'complete': True}))
            # Cycle is expired, although the request deadline is still future.
            patches.enter_context(patch.object(module.time, 'time', return_value=(module.PHASE1_END+100000)/1000))
            answer = module.announcement_evidence(request, read_only=True)
            self.assertEqual(answer['entryHash'], module.digest((reqroot / (key + '.activation-entry')).read_bytes()))
            self.assertEqual(len(calls), 1 if key == module.CURRENT26_RUN else 2)
            self.assertIn('--request-root', calls[0])
            self.assertFalse((generation / '__pycache__').exists())
            if key == module.CURRENT26_RUN:
                for field in ('stamp', 'window', 'target', 'control'):
                    original_seal = (state / 'engine-release-seal.json').read_text()
                    original_reservation = reservation.read_text()
                    if field == 'stamp':
                        changed = json.loads(original_reservation); changed['announcedAt'] += 1
                        reservation.write_text(json.dumps(changed))
                    else:
                        changed = json.loads(original_seal)
                        selected = changed['routineMaintenanceCycles'][str(cycle['startsAt'])]
                        if field == 'window': selected['window']['endsAt'] += 1
                        elif field == 'target': selected['sha'] = module.PHASE1_CONTROL
                        else: selected['controlSha'] = module.PHASE1_TARGET
                        (state / 'engine-release-seal.json').write_text(json.dumps(changed))
                    with self.subTest(field=field), self.assertRaises((ValueError, SystemExit)):
                        module.announcement_evidence(request, read_only=True)
                    (state / 'engine-release-seal.json').write_text(original_seal)
                    reservation.write_text(original_reservation)
                for suffix in ('request', 'intent'):
                    (reqroot / (key + '.' + suffix)).write_text(raw.replace('1793644848', '1793644849'))
                with self.assertRaises(ValueError): module.announcement_evidence(request, read_only=True)
                for suffix in ('request', 'intent'): (reqroot / (key + '.' + suffix)).write_text(raw)
            for field, value in [('manifestSha256', 'a' * 64), ('schema', 'engine-release-activation-floor/v2-owner-window')]:
                (reqroot / (key + '.activation-entry')).write_text(json.dumps(entry | {field: value}))
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    module.announcement_evidence(request, read_only=True)
                (reqroot / (key + '.activation-entry')).write_text(json.dumps(entry))

    def test_phase1_final_proof_requires_immutable_receipts_quiescence_and_no_custody(self, runtime=None):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
            root = Path(folder); directory = root / 'engine-release-cancellations'; directory.mkdir()
            reqroot = root / 'engine-release-requests'; reqroot.mkdir()
            request = self.phase1_request(); key = module.PHASE1_RUN
            container = {'id': 'a' * 64, 'image': 'sha256:' + 'b' * 64, 'startedAt': '2026-11-02T05:54:48Z'}
            states = [{'MainPID': '0', 'ActiveState': 'inactive'} for _ in range(3)]
            bindings = {u: '/system.slice/' + u for u in module.cancel_units(key)[:2]}
            retained = {'entryHash': reqroot / (key + '.activation-entry'),
                'reservationHash': root / ('engine-recovery-window-' + key + '.json'),
                'releasedHoldHash': reqroot / (key + '.lightning-hold.json.released')}
            for name, path in retained.items(): path.write_text(name)
            thaw = {'announcedAtMs': module.PHASE1_STAMP, 'freezeStartedAtMs': module.PHASE1_START,
                'releasedThroughMs': module.PHASE1_END, 'ownershipToken': module.PHASE1_TOKEN, 'generation': 1, 'thawRecordedAtMs': module.PHASE1_START + 221400}
            evidence = {name: module.digest(path.read_bytes()) for name, path in retained.items()} | {'thaw': thaw}
            intent = {'schema': module.EMPTY_CANCEL_SCHEMA, 'request': request, 'container': container,
                'admission': 'positive-empty-auto-restart', 'originalProcess': None, 'originalChild': None,
                'unitCgroups': bindings, 'evidence': evidence}
            receipt = {'schema': module.EMPTY_CANCEL_SCHEMA, 'request': request, 'container': container,
                'result': 'cancelled-expired-announcement', 'servingInstanceUnchanged': True,
                'originalTerminalEdgesRetired': True, 'quiescent': True, 'actualUnitStates': states,
                'unitCgroups': bindings, 'originalControlGroup': '', 'stopDisposition': 'not-needed-already-quiescent'}
            raw_intent = json.dumps(intent)
            records = {'intent': raw_intent, 'receipt': json.dumps(receipt),
                'quiescent': json.dumps({'schema': module.EMPTY_CANCEL_SCHEMA, 'actualUnitStates': states}),
                'stop-issued': json.dumps({'schema': module.EMPTY_CANCEL_SCHEMA,
                    'intentHash': module.digest(raw_intent.encode()), 'stopDisposition': 'not-needed-already-quiescent'})}
            for name, raw in records.items(): (directory / (key + '.' + name + '.json')).write_text(raw)
            patches.enter_context(patch.object(module, 'ROOT', root))
            patches.enter_context(patch.object(module.os, 'getuid', return_value=0))
            patches.enter_context(patch.object(module, 'regular', side_effect=lambda p, mode=None: Path(p).read_text()))
            patches.enter_context(patch.object(module, 'source_hash', side_effect=lambda p: module.WRAPPER_HASH if p.name == 'engine-release-unit-wrapper-v1.sh' else module.PHASE1_HASHES[p.name]))
            patches.enter_context(patch.object(module, 'masked', return_value=True))
            patches.enter_context(patch.object(module, 'own_wants_edge', side_effect=lambda unit: root / ('absent-' + unit)))
            quiet = patches.enter_context(patch.object(module, 'quiet_units'))
            patches.enter_context(patch.object(module, 'container_identity', return_value=container))
            patches.enter_context(patch.object(module, 'health_pair'))
            patches.enter_context(patch.object(module, 'own_thaw', return_value=thaw))
            patches.enter_context(patch.object(module, 'phase1_seal_evidence', return_value={'original': True}))
            if runtime is not None:
                patches.enter_context(patch.object(module, 'current26_cancelled_runtime', return_value=runtime))
            proof = module.phase1_cancellation_proof()
            self.assertEqual(proof['recordHashes'], {name: module.digest(raw.encode()) for name, raw in records.items()})
            self.assertEqual(quiet.call_count, 2)
            if runtime is not None:
                self.assertEqual(proof['container'], runtime['container'])
                self.assertEqual(proof['instanceId'], runtime['request']['instanceId'])
                self.assertEqual(json.loads(records['receipt'])['request']['instanceId'], request['instanceId'])
                with patch.object(module, 'current26_cancelled_runtime', side_effect=[runtime, runtime | {'process': {'pid': 99999}}]):
                    with self.assertRaises(ValueError): module.phase1_cancellation_proof()
            for suffix in ('request', 'intent', 'break-deadline', 'legacy-checkpoint-intent', 'main-inspector-retirement-intent', 'lightning-hold.json'):
                path = reqroot / (key + '.' + suffix); path.write_text('retained')
                with self.subTest(suffix=suffix), self.assertRaises(ValueError): module.phase1_cancellation_proof()
                path.unlink()
            with patch.object(module, 'quiet_units', side_effect=ValueError('successor process')):
                with self.assertRaises(ValueError): module.phase1_cancellation_proof()
            if runtime is None:
                with patch.object(module, 'container_identity', return_value=container | {'startedAt': '2026-11-02T07:30:00Z'}):
                    with self.assertRaises(ValueError): module.phase1_cancellation_proof()
            receipt['stopDisposition'] = 'requested'
            (directory / (key + '.receipt.json')).write_text(json.dumps(receipt))
            with self.assertRaises(ValueError): module.phase1_cancellation_proof()

    def test_phase1_profile_and_original_sources_are_exact(self):
        request = self.phase1_request()
        profile = module.cancellation_profile(request)
        for name, expected in profile['hashes'].items():
            raw = subprocess.check_output(['git', 'show', module.PHASE1_CONTROL + ':server/scripts/' + name], cwd=ROOT)
            self.assertEqual(module.digest(raw), expected)
        for field in ('runKey', 'releaseSha', 'controlSha', 'desiredSha'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.cancellation_profile(request | {field: '41400905104-2' if field == 'runKey' else 'a' * 40})

    def test_phase1_thaw_is_exact_historical_tuple_not_a_timestamp_tolerance(self):
        stamp = module.PHASE1_STAMP
        iso = lambda ms: module.datetime.datetime.fromtimestamp(ms / 1000, module.datetime.timezone.utc).isoformat()
        row = {'contract_version': 3, 'announced_at': iso(stamp), 'freeze_started_at': iso(module.PHASE1_START),
            'release_target_at': iso(module.PHASE1_END), 'thawed_at': iso(module.PHASE1_END - 1000),
            'ownership_token': module.PHASE1_TOKEN, 'release_generation': 1, 'frozen_seconds': 300,
            'shifted': dict.fromkeys(module.THAW_STEPS, 0) | {'complete': True, '_targets_snapshotted': True,
                '_target_counts': dict.fromkeys(module.THAW_STEPS, 0)}}
        prove = lambda value: module.prove_thaw([value], [], stamp, stamp + 500000, module.PHASE1_CONTROL)
        self.assertEqual(prove(row)['freezeStartedAtMs'], module.PHASE1_START)
        self.assertEqual(prove(row)['thawRecordedAtMs'], module.PHASE1_END - 1000)
        for change in ({'freeze_started_at': iso(module.PHASE1_START + 1)},
                {'release_target_at': iso(module.PHASE1_END + 1)}, {'ownership_token': 'a' * 36},
                {'release_generation': 2}, {'contract_version': 2}, {'shifted': {'complete': True}}):
            with self.subTest(change=change), self.assertRaises(ValueError): prove(row | change)
        with self.assertRaises(ValueError): module.prove_thaw([row], [], stamp, stamp + 500000)

    def test_phase1_seal_requires_original_uncommitted_cycle_and_no_transaction(self):
        cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f', 'policyDigest': module.PHASE1_POLICY,
            'startsAt': (module.PHASE1_STAMP+120000)//3600000*3600, 'endsAt': (module.PHASE1_STAMP+120000)//3600000*3600+300, 'runId': module.PHASE1_RUN,
            'sha': module.PHASE1_CONTROL, 'controlSha': module.PHASE1_CONTROL, 'status': 'reserved',
            'window': {'announcedAt': module.PHASE1_STAMP, 'startsAt': module.PHASE1_STAMP + 120000,
                'endsAt': module.PHASE1_STAMP + 420000, 'verified': True}}
        state = {'desired': {'sha': module.PHASE1_DESIRED}, 'pending': None, 'finalization': None,
            'committedRuns': {}, 'routineMaintenanceCycles': {str(cycle['startsAt']): cycle}}
        with patch.object(module, 'observe_seal_state', return_value=state):
            self.assertEqual(module.phase1_seal_evidence(Path('unused')), cycle)
        for change in ({'pending': {}}, {'finalization': {}}, {'committedRuns': {module.PHASE1_RUN: {}}},
                {'desired': {'sha': 'a' * 40}}, {'routineMaintenanceCycles': {}}):
            with self.subTest(change=change), patch.object(module, 'observe_seal_state', return_value=state | change), self.assertRaises(ValueError):
                module.phase1_seal_evidence(Path('unused'))

    def test_e9_source_profile_is_exact_and_pinned_source_bytes_match(self):
        request = {'runKey':'41283363258-1','releaseSha':'e9f00025bd4e2670ed9d1b5714ef94135bcf0224',
                   'controlSha':'303d8cc7d38a97c3bcdc32a577b555232ad726bf','desiredSha':'c'*40,
                   'instanceId':'1-1234abcd','mode':'cancel_expired_announcement'}
        profile = module.cancellation_profile(request)
        self.assertEqual(profile['deadline'], '1793528863')
        for name, expected in profile['hashes'].items():
            raw = subprocess.check_output(['git','show',request['controlSha']+':server/scripts/'+name],cwd=ROOT)
            self.assertEqual(module.digest(raw), expected, name)
        raw = subprocess.check_output(['git','show',request['releaseSha']+':server/release/activation-floor.json'],cwd=ROOT)
        self.assertEqual(module.digest(raw), profile['manifest'])
        raw = subprocess.check_output(['git','show',request['controlSha']+':server/scripts/engine-release-unit-wrapper.sh'],cwd=ROOT)
        self.assertEqual(module.digest(raw), profile['wrapper'])
        for field in ['runKey','releaseSha','controlSha']:
            changed = request | {field: '41283363258-2' if field=='runKey' else 'a'*40}
            with self.assertRaises(ValueError): module.cancellation_profile(changed)

    def e9_request(self):
        return {'runKey':'41283363258-1','releaseSha':'e9f00025bd4e2670ed9d1b5714ef94135bcf0224',
                'controlSha':'303d8cc7d38a97c3bcdc32a577b555232ad726bf','desiredSha':'c'*40,
                'instanceId':'1-1234abcd','mode':'cancel_expired_announcement'}

    def test_e9_real_announcement_custody_refuses_all_changed_or_unknown_facts(self):
        for failure in [None,'target','control','run','deadline','unexpired','runtime','manifest','checkpoint','retirement','hold','pending','source','thaw','disposition','reservation']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                request=self.e9_request(); profile=module.cancellation_profile(request); key=request['runKey']
                root=Path(folder); state=root/'state';state.mkdir(); parent=root/'parent';parent.mkdir()
                generation=parent/'engine-control-generations'/request['controlSha'];generation.mkdir(parents=True)
                reqroot=state/'engine-release-requests';reqroot.mkdir()
                deadline='1793528864' if failure=='deadline' else profile['deadline']
                raw='\n'.join([request['releaseSha'],'url','actor',str(generation),request['controlSha'],deadline])+'\n'
                for suffix in ['request','intent']:(reqroot/(key+'.'+suffix)).write_text(raw)
                entry={'schema':'engine-release-activation-floor/v2-owner-window','runId':key,'targetSha':request['releaseSha'],
                       'controlSha':request['controlSha'],'manifestSha256':profile['manifest'],'phase':'announcement'}
                if failure=='runtime':entry['phase']='runtime'
                if failure=='manifest':entry['manifestSha256']='0'*64
                (reqroot/(key+'.activation-entry')).write_text(json.dumps(entry))
                (reqroot/(key+'.lightning-hold.json.released')).write_text('released')
                (generation/'engine-release-lightning-hold.py').write_text("def own_record(path,key):return {'phase':'released'}\n")
                stamp=1793518000000
                (state/('engine-recovery-window-'+key+'.json')).write_text(json.dumps({'runId':key,'sha':request['releaseSha'],'announcedAt':stamp,'cause':'urgent'}))
                pins=state/'engine-release-generation-pins';pins.mkdir();(pins/(key+'.generation')).write_text(str(generation)+'\n'+request['controlSha']+'\n')
                suffix={'checkpoint':'legacy-checkpoint-intent','retirement':'main-inspector-retirement-intent','hold':'lightning-hold.json'}.get(failure)
                if suffix:(reqroot/(key+'.'+suffix)).write_text('present')
                def command(args,timeout=5):
                    if 'disposition' in args:return 'entered' if failure=='disposition' else 'announced'
                    if 'reservation' in args:return str(stamp+1 if failure=='reservation' else stamp)
                    if 'pending-owner' in args:return 'other' if failure=='pending' else 'none'
                    return request['desiredSha']
                patches.enter_context(patch.object(module,'ROOT',state));patches.enter_context(patch.object(module,'PARENT',parent))
                patches.enter_context(patch.object(module,'regular',side_effect=lambda p,mode=None:Path(p).read_text()))
                patches.enter_context(patch.object(module,'source_hash',side_effect=lambda p:'0'*64 if failure=='source' else profile['wrapper'] if p.name=='engine-release-unit-wrapper-v1.sh' else profile['hashes'][p.name]))
                patches.enter_context(patch.object(module,'command',side_effect=command))
                thaw_read=patches.enter_context(patch.object(module,'own_thaw',side_effect=ValueError('incomplete') if failure=='thaw' else None,return_value={'verified':True}))
                patches.enter_context(patch.object(module.time,'time',return_value=int(profile['deadline'])+(-1 if failure=='unexpired' else 1)))
                if failure in ['target','control','run']:
                    field={'target':'releaseSha','control':'controlSha','run':'runKey'}[failure]
                    request[field]='41283363258-2' if field=='runKey' else 'a'*40
                if failure is not None:
                    with self.assertRaises(ValueError):module.announcement_evidence(request)
                else:
                    # Execute the actual pinned generation-local hold module through
                    # announcement_evidence, with only its already separately tested
                    # custody read replaced. Python bytecode is enabled as on the
                    # actual remote cancellation entry (local -B does not propagate).
                    hold_source=subprocess.check_output(['git','show',request['controlSha']+':server/scripts/engine-release-lightning-hold.py'],cwd=ROOT)
                    (generation/'engine-release-lightning-hold.py').write_bytes(hold_source)
                    manifest={'engine-supervisor.sh','engine-up.sh','engine-release-protocol-v1.schema',
                              'engine-release-seal.py','verify-recovery-stack.sh','engine-release-lightning-hold.py'}
                    for name in manifest-{'engine-release-lightning-hold.py'}:
                        (generation/name).write_bytes(subprocess.check_output(['git','show',request['controlSha']+':server/scripts/'+name],cwd=ROOT))
                    (generation/'generation-files').write_text('\n'.join(sorted(manifest))+'\n')
                    (generation/'control-sha').write_text(request['controlSha']+'\n')
                    self.assertEqual({p.name for p in generation.iterdir()},manifest|{'generation-files','control-sha'})
                    before={p.name:p.read_bytes() for p in generation.iterdir()}
                    original_exec=importlib.machinery.SourceFileLoader.exec_module
                    for prior_flag in (False,True):
                        for import_failure in (False,True):
                            with self.subTest(prior_flag=prior_flag,import_failure=import_failure):
                                thaw_read.reset_mock()
                                # Each matrix cell gets a clean fixture-only cache state.
                                cache=generation/'__pycache__'
                                if cache.exists(): shutil.rmtree(cache)
                                def execute(loader, loaded):
                                    original_exec(loader,loaded)
                                    if loaded.__name__=='qualified_withdrawal_hold_reader':
                                        if import_failure: raise ValueError('isolated hold import failure')
                                        loaded.own_record=lambda path,key:{'phase':'released'}
                                with patch.object(module.sys,'dont_write_bytecode',prior_flag), \
                                     patch.object(importlib.machinery.SourceFileLoader,'exec_module',execute):
                                    if import_failure:
                                        with self.assertRaisesRegex(ValueError,'isolated hold import failure'):
                                            module.announcement_evidence(request)
                                    else:
                                        proof=module.announcement_evidence(request)
                                        self.assertEqual(proof['thaw'],{'verified':True})
                                        self.assertEqual(proof['entryHash'],module.digest((reqroot/(key+'.activation-entry')).read_bytes()))
                                    self.assertIs(module.sys.dont_write_bytecode,prior_flag)
                                if import_failure:
                                    thaw_read.assert_not_called()
                                else:
                                    thaw_read.assert_called_once_with(stamp,request['controlSha'])
                                self.assertFalse((generation/'__pycache__').exists(), 'hold-reader import changed immutable generation inventory')
                                self.assertEqual(before,{p.name:p.read_bytes() for p in generation.iterdir()})

    def test_phase1_mask_only_empty_retry_retires_once_without_signalling(self):
        for race in [False,True]:
            with self.subTest(race=race), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                request,control,state,entry,reservation,units=self.harness(folder,patches,self.phase1_request())
                patches.enter_context(patch.object(module,'own_thaw',return_value={'released':True, 'thawRecordedAtMs':module.PHASE1_START + 221400}))
                patches.enter_context(patch.object(module,'phase1_seal_evidence'))
                patches.enter_context(patch.object(module,'phase1_cancellation_proof'))
                evidence=module.announcement_evidence(request);marker='engine-release-requests/'+request['runKey']+'.awaiting-certificate'
                evidence['originals'].pop(marker);(state/marker).unlink();snapshot=module.unit_snapshot.side_effect
                def retry_snapshot(unit,service_context=False):
                    row=snapshot(unit)
                    if unit==units[0] and not control['stopped']:
                        row.update(MainPID='0',SubState='auto-restart',ControlGroup='')
                        if race and any(cmd[:2]==['systemctl','daemon-reload'] for cmd in control['commands']):row.update(MainPID='22',InvocationID='e'*32,SubState='start')
                    if service_context:row.update(Slice='system-fixture.slice',ControlPID='0')
                    return row
                with patch.object(module,'unit_snapshot',side_effect=retry_snapshot),patch.object(module,'empty_retry_admission'), \
                     patch.object(module,'prove_unit_empty',side_effect=lambda unit,bindings=None:retry_snapshot(unit)), \
                     patch.object(module,'configured_service_cgroup',side_effect=lambda unit,context:'/system.slice/'+unit):
                    # Mask acknowledgment may be lost/race; never stop a successor.
                    with patch.object(module.time,'monotonic',side_effect=[0,1000,2000,3000,4000,5000]), self.assertRaises(ValueError):module.cancel_announced(request)
                    self.assertEqual(control['stopCount'],0)
                    self.assertTrue((state/'engine-release-cancellations'/(request['runKey']+'.intent.json')).exists())
                    control['stopped']=True
                    answer=module.cancel_announced(request);again=module.cancel_announced(request)
                    self.assertEqual(answer,again);self.assertEqual(answer['stopDisposition'],'not-needed-already-quiescent')
                    self.assertTrue(answer['originalTerminalEdgesRetired']);self.assertEqual(control['stopCount'],0)
                    self.assertTrue(entry.exists());self.assertTrue(reservation.exists())
                    self.assertFalse(any(cmd[:2]==['systemctl','stop'] for cmd in control['commands']))

    def test_phase1_live_invocation_refuses_before_mask_or_stop(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder,ExitStack() as patches:
            request,control,state,_,_,units=self.harness(folder,patches,self.phase1_request())
            with self.assertRaises(ValueError):module.cancel_announced(request)
            self.assertEqual(control['stopCount'],0)
            self.assertFalse(any((module.SYSTEMD/unit).exists() for unit in units))

    def test_phase1_runtime_birth_refuses_inside_window_or_unknown_before_mask(self):
        for stamp in ('2026-11-02T06:58:02.415Z', '2026-11-02T07:02:00Z',
                      '2026-11-02T07:05:02.415Z', '2099-01-01T00:00:00Z',
                      '2026-11-02T07:21:51.848', 'unknown'):
            with self.subTest(stamp=stamp), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                request,control,state,_,_,units=self.harness(folder,patches,self.phase1_request())
                control['container']['startedAt'] = stamp
                with self.assertRaises(ValueError): module.cancel_announced(request)
                self.assertEqual(control['stopCount'], 0)
                self.assertFalse(any((module.SYSTEMD/unit).exists() for unit in units))
                self.assertFalse((state/'engine-release-cancellations'/(request['runKey']+'.intent.json')).exists())

    def test_phase1_unproved_empty_admission_cannot_create_masks_or_issue_stop(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder,ExitStack() as patches:
            request,control,state,_,_,units=self.harness(folder,patches,self.phase1_request())
            snapshot=module.unit_snapshot.side_effect
            def empty_snapshot(unit,service_context=False):
                row=snapshot(unit)
                if unit==units[0]:row.update(MainPID='0',SubState='auto-restart')
                return row
            with patch.object(module,'unit_snapshot',side_effect=empty_snapshot), \
                 patch.object(module,'empty_retry_admission',side_effect=ValueError('native evidence unavailable')):
                with self.assertRaises(ValueError):module.cancel_announced(request)
            self.assertEqual(control['stopCount'],0)
            self.assertFalse(any((module.SYSTEMD/unit).exists() for unit in units))
            self.assertFalse((state/'engine-release-cancellations'/(request['runKey']+'.intent.json')).exists())

    def test_e9_mask_only_empty_retry_retires_once_without_signalling(self):
        for race in [False,True]:
            with self.subTest(race=race), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                request,control,state,entry,reservation,units=self.harness(folder,patches,self.e9_request())
                evidence=module.announcement_evidence(request);marker='engine-release-requests/'+request['runKey']+'.awaiting-certificate'
                evidence['originals'].pop(marker);(state/marker).unlink();snapshot=module.unit_snapshot.side_effect
                def retry_snapshot(unit,service_context=False):
                    row=snapshot(unit)
                    if unit==units[0] and not control['stopped']:
                        row.update(MainPID='0',SubState='auto-restart',ControlGroup='')
                        if race and any(cmd[:2]==['systemctl','daemon-reload'] for cmd in control['commands']):row.update(MainPID='22',InvocationID='e'*32,SubState='start')
                    if service_context:row.update(Slice='system-fixture.slice',ControlPID='0')
                    return row
                with patch.object(module,'unit_snapshot',side_effect=retry_snapshot),patch.object(module,'empty_retry_admission'), \
                     patch.object(module,'prove_unit_empty',side_effect=lambda unit,bindings=None:retry_snapshot(unit)), \
                     patch.object(module,'configured_service_cgroup',side_effect=lambda unit,context:'/system.slice/'+unit):
                    # Mask acknowledgment may be lost/race; never stop a successor.
                    with patch.object(module.time,'monotonic',side_effect=[0,1000,2000,3000,4000,5000]), self.assertRaises(ValueError):module.cancel_announced(request)
                    self.assertEqual(control['stopCount'],0)
                    self.assertTrue((state/'engine-release-cancellations'/(request['runKey']+'.intent.json')).exists())
                    control['stopped']=True
                    answer=module.cancel_announced(request);again=module.cancel_announced(request)
                    self.assertEqual(answer,again);self.assertEqual(answer['stopDisposition'],'not-needed-already-quiescent')
                    self.assertTrue(answer['originalTerminalEdgesRetired']);self.assertEqual(control['stopCount'],0)
                    self.assertTrue(entry.exists());self.assertTrue(reservation.exists())
                    self.assertFalse(any(cmd[:2]==['systemctl','stop'] for cmd in control['commands']))

    def test_e9_live_invocation_refuses_before_mask_or_stop(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder,ExitStack() as patches:
            request,control,state,_,_,units=self.harness(folder,patches,self.e9_request())
            with self.assertRaises(ValueError):module.cancel_announced(request)
            self.assertEqual(control['stopCount'],0)
            self.assertFalse(any((module.SYSTEMD/unit).exists() for unit in units))

    def test_e9_unproved_empty_admission_cannot_create_masks_or_issue_stop(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder,ExitStack() as patches:
            request,control,state,_,_,units=self.harness(folder,patches,self.e9_request())
            snapshot=module.unit_snapshot.side_effect
            def empty_snapshot(unit,service_context=False):
                row=snapshot(unit)
                if unit==units[0]:row.update(MainPID='0',SubState='auto-restart')
                return row
            with patch.object(module,'unit_snapshot',side_effect=empty_snapshot), \
                 patch.object(module,'empty_retry_admission',side_effect=ValueError('native evidence unavailable')):
                with self.assertRaises(ValueError):module.cancel_announced(request)
            self.assertEqual(control['stopCount'],0)
            self.assertFalse(any((module.SYSTEMD/unit).exists() for unit in units))
            self.assertFalse((state/'engine-release-cancellations'/(request['runKey']+'.intent.json')).exists())

    def test_e9_empty_retry_requires_native_empty_contract_and_marker_absence(self):
        key='41283363258-1'; unit=module.cancel_units(key)[0]
        state={'MainPID':'0','ActiveState':'activating','SubState':'auto-restart'}
        config='Type=oneshot\nRestart=on-failure\nRestartUSec=30s'
        with patch.object(module,'command',return_value=config), patch.object(module,'prove_unit_empty',return_value=state) as native:
            module.empty_retry_admission(unit,state,key,{'originals':{}})
            native.assert_called_once_with(unit)
            for changed in [state|{'MainPID':'12'},state|{'SubState':'start'},state|{'ActiveState':'failed'}]:
                with self.assertRaises(ValueError): module.empty_retry_admission(unit,changed,key,{'originals':{}})
            with self.assertRaises(ValueError): module.empty_retry_admission(unit,state,key,{'originals':{'engine-release-requests/'+key+'.awaiting-certificate':'hash'}})
        with patch.object(module,'command',return_value=config), patch.object(module,'prove_unit_empty',side_effect=ValueError('unknown')), self.assertRaises(ValueError):
            module.empty_retry_admission(unit,state,key,{'originals':{}})

    def test_child_recovery_is_only_admitted_for_expired_markerless_original(self):
        key = '41177442979-1'
        generation = module.PARENT / 'engine-control-generations' / module.CANCEL_CONTROL
        args = ['bash', str(generation / 'engine-release-recover.sh'), '--run-id', key, '--mode', 'retryable']
        self.assertEqual(module.cancellation_child_class(args, key, {'originals': {}}), 'pinned_announcement_recovery')
        marker = 'engine-release-requests/'+key+'.awaiting-certificate'
        self.assertEqual(module.cancellation_child_class(args, key, {'originals': {marker: 'hash'}}), 'unproven')
        for bad in [args[:-1]+['terminal'], args+['extra'], ['python3']+args[1:], args[:1]+['/other/recover.sh']+args[2:]]:
            self.assertEqual(module.cancellation_child_class(bad, key, {'originals': {}}), 'unproven')

    def test_observation_reuses_collector_without_creating_state_or_locks(self):
        request={'runKey':'41177442979-1','releaseSha':module.CANCEL_CONTROL,'controlSha':module.CANCEL_CONTROL,
                 'desiredSha':'c'*40,'instanceId':'1-1234abcd','mode':'observe_expired_announcement'}
        with patch.object(os,'getuid',return_value=0), patch.object(module,'own_wants_edge'), patch.object(module,'health_pair'), \
             patch.object(module,'container_identity',return_value={'id':'known'}), patch.object(module,'collect_cancellation_admission',return_value={}) as collect, \
             patch.object(module,'cancellation_directory',side_effect=AssertionError('must not create')), patch.object(module.os,'open',side_effect=AssertionError('must not lock')):
            answer=module.remote(request)
            self.assertEqual(answer['result'],'predicates_passed_at_read')
            self.assertTrue(answer['readOnly']); self.assertFalse(answer['retryAllowed'])
            self.assertEqual(collect.call_args.args[0]['mode'],'cancel_expired_announcement')

    def test_observation_reads_pinned_seal_without_locks_directories_or_bytecode(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder:
            root=Path(folder); generation=root/'generation';generation.mkdir()
            source=subprocess.run(['git','show',module.CANCEL_CONTROL+':server/scripts/engine-release-seal.py'],cwd=ROOT,capture_output=True,text=True,check=True).stdout
            (generation/'engine-release-seal.py').write_text(source)
            seal=root/'engine-release-seal.json'
            seal.write_text(json.dumps({'schema':1,'desired':{'sha':'c'*40,'imageId':'sha256:'+'d'*64},'highWaterSha':'c'*40,'generation':1,'pending':None}))
            seal.chmod(0o600)
            original_exec=importlib.machinery.SourceFileLoader.exec_module
            def execute(loader, loaded):
                original_exec(loader,loaded)
                if loaded.__name__=='qualified_withdrawal_seal_observer':
                    def forbidden(*args,**kwargs): raise AssertionError('Read-only seal tried to create or lock')
                    loaded.SealLock=forbidden;loaded.ensure_dirs=forbidden
            before={str(path.relative_to(root)):path.read_bytes() for path in root.rglob('*') if path.is_file()}
            with patch.object(module,'ROOT',root), patch.object(module,'canonical_seal_bytes',side_effect=lambda path:Path(path).read_text()), \
                 patch.object(importlib.machinery.SourceFileLoader,'exec_module',execute):
                value=module.observe_seal_state(generation)
            self.assertEqual(value['desired']['sha'],'c'*40)
            after={str(path.relative_to(root)):path.read_bytes() for path in root.rglob('*') if path.is_file()}
            self.assertEqual(before,after)
            self.assertFalse((generation/'__pycache__').exists())

    def test_observation_failure_exports_only_closed_provenance(self):
        request={'runKey':'41177442979-1','releaseSha':module.CANCEL_CONTROL,'controlSha':module.CANCEL_CONTROL,
                 'desiredSha':'c'*40,'instanceId':'1-1234abcd','mode':'observe_expired_announcement'}
        with patch.object(os,'getuid',return_value=0), patch.object(module,'own_wants_edge'), patch.object(module,'health_pair',side_effect=ValueError('SECRET token /private/path')):
            answer=module.observe_cancellation(request)
        self.assertEqual(answer['result'],'unproved')
        self.assertNotIn('SECRET',json.dumps(answer)); self.assertNotIn('/private',json.dumps(answer))
        module.validate_diagnostic(answer,request)
        with self.assertRaises(ValueError): module.validate_diagnostic(answer|{'raw':'secret'},request)

    def test_thaw_requires_exact_complete_owned_release(self):
        stamp = 1793429586934
        iso = lambda ms: module.datetime.datetime.fromtimestamp(ms / 1000, module.datetime.timezone.utc).isoformat()
        row = {'contract_version': 3, 'announced_at': iso(stamp), 'freeze_started_at': iso(stamp + 120000),
               'release_target_at': iso(stamp + 420000), 'thawed_at': iso(stamp + 410000),
               'ownership_token': '12345678-1234-1234-1234-123456789abc', 'release_generation': 1,
               'shifted': dict.fromkeys(module.THAW_STEPS, 0) | {'complete': True, '_targets_snapshotted': True, '_target_counts': dict.fromkeys(module.THAW_STEPS, 0)}, 'frozen_seconds': 300}
        self.assertEqual(module.prove_thaw([row], [], stamp, stamp + 430000)['announcedAtMs'], stamp)
        bad = [{'contract_version': 2}, {'announced_at': iso(stamp + 1)}, {'freeze_started_at': iso(stamp)},
               {'release_target_at': iso(stamp + 440000)}, {'shifted': {'complete': True}},
               {'ownership_token': None}, {'release_generation': 0}, {'frozen_seconds': 200}]
        for change in bad:
            with self.subTest(change=change), self.assertRaises((ValueError, TypeError)):
                module.prove_thaw([row | change], [], stamp, stamp + 430000)
        for rows, active in [([], []), ([row, row], []), ([row], [{'id': True}])]:
            with self.assertRaises(ValueError): module.prove_thaw(rows, active, stamp, stamp + 430000)

    def test_durable_records_are_create_once_and_symlinks_refuse(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder:
            path = Path(folder) / 'intent'
            # The host requires root ownership; fixture reads its own immutable bytes.
            with patch.object(module, 'regular', side_effect=lambda p, mode=None: Path(p).read_text()):
                module.save_once(path, {'value': 1})
                module.save_once(path, {'value': 1})
                with self.assertRaises(ValueError): module.save_once(path, {'value': 2})
                self.assertEqual(json.loads(path.read_text()), {'value': 1})

    def harness(self, folder, patches, selected=None):
        root = Path(folder); state = root / 'state'; state.mkdir()
        systemd = root / 'systemd'; systemd.mkdir(); (systemd / 'multi-user.target.wants').mkdir()
        proc = root / 'proc'; proc.mkdir(); parent = root / 'control'; parent.mkdir()
        lock = root / 'engine.lock'; lock.touch()
        request = {'runKey': '41177442979-1', 'releaseSha': module.CANCEL_CONTROL,
                   'controlSha': module.CANCEL_CONTROL, 'desiredSha': 'c' * 40,
                   'instanceId': '1-1234abcd', 'mode': 'cancel_expired_announcement'}
        if selected is not None: request = selected
        key = request['runKey']; units = module.cancel_units(key); group = '/system.slice/' + units[0]
        original = {'MainPID': '12', 'InvocationID': 'f' * 32, 'ActiveState': 'activating',
                    'SubState': 'start', 'Result': 'success', 'ExecMainCode': '0', 'ExecMainStatus': '0', 'ControlGroup': group}
        ended = original | {'MainPID': '0', 'ActiveState': 'failed', 'SubState': 'failed',
                            'Result': 'exit-code', 'ExecMainCode': '1', 'ExecMainStatus': '75', 'ControlGroup': ''}
        idle = ended | {'Result': 'success', 'ExecMainStatus': '0'}
        generation = parent / 'engine-control-generations' / request['controlSha']
        processes = {12: {'pid': 12, 'parent': 1, 'start': '100', 'argv': ['bash', str(parent / 'engine-release-unit-wrapper-v1.sh'), 'start', key]},
                     13: {'pid': 13, 'parent': 12, 'start': '101', 'argv': ['bash', str(generation / 'engine-release-transaction.sh'), '--run-id', key]}}
        for pid in [12, 13, 14]:
            (proc / str(pid)).mkdir(); (proc / str(pid) / 'cgroup').write_text('0::' + (group if pid != 14 else '/engine') + '\n')
        (proc / '12/task/12').mkdir(parents=True); (proc / '12/task/12/children').write_text('13')
        originals = {}
        for directory, suffix in [('engine-release-requests', 'request'), ('engine-release-requests', 'intent'),
                                  ('engine-release-requests', 'awaiting-certificate'), ('engine-release-generation-pins', 'generation'),
                                  ('engine-intake-requests', 'request'), ('engine-image-leases', 'lease')]:
            path = state / directory / (key + '.' + suffix); path.parent.mkdir(exist_ok=True); path.write_text(suffix)
            originals[str(path.relative_to(state))] = module.digest(path.read_bytes())
        entry = state / 'engine-release-requests' / (key + '.activation-entry'); entry.write_text('announcement')
        reservation = state / ('engine-recovery-window-' + key + '.json'); reservation.write_text('original')
        released = state / 'engine-release-requests' / (key + '.lightning-hold.json.released'); released.write_text('released')
        evidence = {'releasedHoldHash': module.digest(released.read_bytes()), 'originals': originals, 'entryHash': module.digest(entry.read_bytes()),
                    'reservationHash': module.digest(reservation.read_bytes()), 'thaw': {'released': True, **({'thawRecordedAtMs': module.PHASE1_START + 221400} if key == module.PHASE1_RUN else {})}}
        control = {'stopped': False, 'stopCount': 0, 'unknownStop': False, 'cgroupEmpty': True,
                   'evidenceFails': False, 'commands': [], 'container': {'id': 'a' * 64, 'image': 'sha256:' + 'b' * 64, 'startedAt': '2026-11-02T07:21:51.848Z' if key == module.PHASE1_RUN else 'original'}}
        def command(args, timeout=5):
            control['commands'].append(args)
            if args[:3] == ['systemctl', 'stop', '--no-block']:
                control['stopCount'] += 1
                if control['unknownStop']: raise subprocess.TimeoutExpired(args, 5)
                control['stopped'] = True; return ''
            if args[:2] == ['systemctl', 'show']: return 'masked'
            if args[:3] == ['docker', 'container', 'inspect']: return '14'
            return ''
        def check_evidence(_, after_stop=False):
            if control['evidenceFails']: raise ValueError('runtime promotion')
            return evidence
        for name, value in [('ROOT', state), ('PARENT', parent), ('SYSTEMD', systemd), ('PROC', proc), ('ENGINE_LOCK', lock)]:
            patches.enter_context(patch.object(module, name, value))
        patches.enter_context(patch.object(os, 'getuid', return_value=0))
        patches.enter_context(patch.object(module, 'cancellation_directory', side_effect=lambda p: p.mkdir(exist_ok=True)))
        patches.enter_context(patch.object(module, 'regular', side_effect=lambda p, mode=None: Path(p).read_text()))
        patches.enter_context(patch.object(module, 'announcement_evidence', side_effect=check_evidence))
        patches.enter_context(patch.object(module, 'container_identity', side_effect=lambda _: control['container']))
        patches.enter_context(patch.object(module, 'health_pair'))
        patches.enter_context(patch.object(module, 'loaded_stop_contract', return_value={'qualified': True}))
        patches.enter_context(patch.object(module, 'process', side_effect=lambda pid: processes[pid]))
        patches.enter_context(patch.object(module, 'unit_snapshot', side_effect=lambda unit: (ended if control['stopped'] else original).copy() if unit == units[0] else idle.copy()))
        patches.enter_context(patch.object(module, 'cgroup_empty', side_effect=lambda _: control['cgroupEmpty']))
        patches.enter_context(patch.object(module, 'command', side_effect=command))
        patches.enter_context(patch.object(module.time, 'sleep'))
        clock = iter(range(0, 100000, 70)); patches.enter_context(patch.object(module.time, 'monotonic', side_effect=lambda: next(clock)))
        return request, control, state, entry, reservation, units

    def test_actual_exit_is_retained_and_repeat_only_reads(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
            request, control, state, entry, reservation, units = self.harness(folder, patches)
            answer = module.cancel_announced(request)
            module.validate_cancellation_reply(answer, request)
            self.assertEqual(answer['actualUnitStates'][0]['ExecMainStatus'], '75')
            self.assertEqual(control['stopCount'], 1)
            self.assertEqual(module.cancel_announced(request), answer)
            self.assertEqual(control['stopCount'], 1)
            self.assertTrue(entry.exists()); self.assertTrue(reservation.exists())
            self.assertFalse((state / 'engine-release-requests' / (request['runKey'] + '.request')).exists())
            self.assertFalse(any('record-failure' in args for args in control['commands']))

    def test_unknown_stop_never_reissues_and_can_finish_from_quiescence(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
            request, control, state, *_ = self.harness(folder, patches)
            control['unknownStop'] = True
            for _ in range(2):
                with self.assertRaises(ValueError): module.cancel_announced(request)
            self.assertEqual(control['stopCount'], 1)
            self.assertTrue((state / 'engine-release-requests' / (request['runKey'] + '.request')).exists())
            control['stopped'] = True
            answer = module.cancel_announced(request)
            self.assertTrue(answer['quiescent']); self.assertEqual(control['stopCount'], 1)

    def test_nonempty_cgroup_never_retires(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
            request, control, state, *_ = self.harness(folder, patches)
            control['cgroupEmpty'] = False
            with self.assertRaises(ValueError): module.cancel_announced(request)
            self.assertTrue((state / 'engine-release-requests' / (request['runKey'] + '.request')).exists())
            self.assertFalse((state / 'engine-release-cancellations' / (request['runKey'] + '.receipt.json')).exists())

    def test_source_or_runtime_proof_refusal_has_no_stop_or_mask(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
            request, control, state, _, _, units = self.harness(folder, patches)
            control['evidenceFails'] = True
            with self.assertRaises(ValueError): module.cancel_announced(request)
            self.assertEqual(control['stopCount'], 0)
            self.assertFalse(any((module.SYSTEMD / unit).exists() for unit in units))

    def test_crashes_at_each_durable_edge_preserve_one_stop_and_history(self):
        for edge in ['intent.json', 'stop-issued.json', 'quiescent.json', 'receipt.json']:
            with self.subTest(edge=edge), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                request, control, state, entry, reservation, units = self.harness(folder, patches)
                original_save = module.save_once
                def crashed(path, value):
                    original_save(path, value)
                    if path.name.endswith(edge): raise OSError('crash after durable create')
                with patch.object(module, 'save_once', side_effect=crashed), self.assertRaises(OSError):
                    module.cancel_announced(request)
                if edge == 'stop-issued.json':
                    with self.assertRaises(ValueError): module.cancel_announced(request)
                    self.assertEqual(control['stopCount'], 0)  # Unknown issue gap is never replayed.
                    control['stopped'] = True
                answer = module.cancel_announced(request)
                self.assertTrue(answer['quiescent']); self.assertLessEqual(control['stopCount'], 1)
                self.assertTrue(entry.exists()); self.assertTrue(reservation.exists())

    def test_partial_mask_and_foreign_mask_fail_closed(self):
        for foreign in [False, True]:
            with self.subTest(foreign=foreign), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                request, control, state, _, _, units = self.harness(folder, patches)
                path = module.SYSTEMD / units[0]
                if foreign:
                    path.symlink_to('/foreign')
                    with self.assertRaises(ValueError): module.cancel_announced(request)
                else:
                    symlink = os.symlink
                    def interrupted(src, dst, **kwargs):
                        symlink(src, dst, **kwargs)
                        raise OSError('mask crash')
                    with patch.object(os, 'symlink', side_effect=interrupted), self.assertRaises(OSError): module.cancel_announced(request)
                    self.assertEqual(control['stopCount'], 0)
                    self.assertTrue(module.cancel_announced(request)['quiescent'])
                self.assertLessEqual(control['stopCount'], 1)


    def test_original_announced_recovery_exits_before_engine_lock_or_supervisor(self):
        # This cancellation profile owns the immutable original control, whose
        # announced branch cannot finish itself. New controls qualify their own
        # expiry/receipt cleanup in the activation-floor behavioral suite.
        source = subprocess.check_output(['git', 'show', module.CANCEL_CONTROL +
            ':server/scripts/engine-release-recover.sh'], cwd=ROOT, text=True)
        branch = source.split('case "$FLOOR_DISPOSITION" in', 1)[1].split('\nif [ "$RECOVERY_MODE"', 1)[0]
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as directory:
            lock = Path(directory) / 'must-not-open'
            result = subprocess.run(['bash', '-c', 'set -eu\nFLOOR_DISPOSITION=announced\nENGINE_LOCK="$1"\ncase "$FLOOR_DISPOSITION" in' + branch, 'fixture', str(lock)], capture_output=True, text=True, timeout=3)
            self.assertEqual(result.returncode, 75, result.stderr)
            self.assertIn('announcement-only owner retained', result.stderr)
            self.assertFalse(lock.exists())

    def test_admission_checks_real_announcement_files_and_refuses_changed_custody(self):
        for failure in [None, 'runtime', 'foreign', 'manifest', 'checkpoint', 'hold', 'pending', 'source', 'missing_expired', 'missing_unexpired', 'missing_wrong_disposition']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                root = Path(folder); state = root / 'state'; state.mkdir(); parent = root / 'parent'; parent.mkdir()
                generation = parent / 'engine-control-generations' / module.CANCEL_CONTROL; generation.mkdir(parents=True)
                request = {'runKey': '41177442979-1', 'releaseSha': module.CANCEL_CONTROL, 'controlSha': module.CANCEL_CONTROL,
                           'desiredSha': 'c' * 40, 'instanceId': '1-1234abcd', 'mode': 'cancel_expired_announcement'}
                key = request['runKey']; reqroot = state / 'engine-release-requests'; reqroot.mkdir()
                lines = '\n'.join([module.CANCEL_CONTROL, 'url', 'actor', str(generation), module.CANCEL_CONTROL, '1793440868']) + '\n'
                for suffix, raw in [('request', lines), ('intent', lines), ('awaiting-certificate', module.CANCEL_CONTROL + '\n')]:
                    (reqroot / (key + '.' + suffix)).write_text(raw)
                if failure and failure.startswith('missing_'):
                    (reqroot / (key + '.awaiting-certificate')).unlink()
                # The expected manifest is derived from the exact retained source blob.
                manifest = subprocess.check_output(['git', 'show', module.CANCEL_CONTROL + ':server/release/activation-floor.json'], cwd=ROOT)
                entry = {'schema': 'engine-release-activation-floor/v2-owner-window', 'runId': key,
                         'targetSha': module.CANCEL_CONTROL, 'controlSha': module.CANCEL_CONTROL,
                         'manifestSha256': module.digest(manifest), 'phase': 'announcement'}
                if failure == 'runtime': entry['phase'] = 'runtime'
                if failure == 'foreign': entry['runId'] = '1-1'
                if failure == 'manifest': entry['manifestSha256'] = '0' * 64
                (reqroot / (key + '.activation-entry')).write_text(json.dumps(entry))
                (reqroot / (key + '.lightning-hold.json.released')).write_text('released')
                (generation / 'engine-release-lightning-hold.py').write_text("def own_record(path, key): return {'phase': 'released'}\n")
                stamp = 1793429586934
                (state / ('engine-recovery-window-' + key + '.json')).write_text(json.dumps({'runId': key, 'sha': module.CANCEL_CONTROL, 'announcedAt': stamp, 'cause': 'urgent'}))
                pin = state / 'engine-release-generation-pins'; pin.mkdir(); (pin / (key + '.generation')).write_text(str(generation) + '\n' + module.CANCEL_CONTROL + '\n')
                if failure in {'checkpoint', 'hold'}:
                    (reqroot / (key + ('.legacy-checkpoint-intent' if failure == 'checkpoint' else '.lightning-hold.json'))).write_text('present')
                def command(args, timeout=5):
                    if 'disposition' in args: return 'entered' if failure == 'missing_wrong_disposition' else 'announced'
                    if 'reservation' in args: return str(stamp)
                    if 'pending-owner' in args: return 'other' if failure == 'pending' else 'none'
                    return request['desiredSha']
                patches.enter_context(patch.object(module, 'ROOT', state)); patches.enter_context(patch.object(module, 'PARENT', parent))
                patches.enter_context(patch.object(module, 'regular', side_effect=lambda p, mode=None: Path(p).read_text()))
                patches.enter_context(patch.object(module, 'source_hash', side_effect=lambda p: '0' * 64 if failure == 'source' else module.WRAPPER_HASH if p.name == 'engine-release-unit-wrapper-v1.sh' else module.CANCEL_HASHES[p.name]))
                patches.enter_context(patch.object(module, 'command', side_effect=command))
                patches.enter_context(patch.object(module, 'own_thaw', return_value={'verified': True}))
                patches.enter_context(patch.object(module.time, 'time', return_value=(1793440868 - 1 if failure == 'missing_unexpired' else 1793440868 + 1)))
                if failure and failure != 'missing_expired':
                    with self.assertRaises(ValueError): module.announcement_evidence(request)
                else: self.assertEqual(module.announcement_evidence(request)['thaw'], {'verified': True})

    def test_expired_retry_after_intent_masks_without_signalling_new_invocation(self):
        for outcome in ['absent', 'reused', 'unreadable']:
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                request, control, state, _, _, units = self.harness(folder, patches)
                marker = 'engine-release-requests/'+request['runKey']+'.awaiting-certificate'
                evidence = module.announcement_evidence(request)
                evidence['originals'].pop(marker)
                (state/marker).unlink()
                save = module.save_once
                def saved_then_exit(path, value):
                    save(path, value)
                    if path.name.endswith('.intent.json'): raise OSError('original invocation ended')
                with patch.object(module, 'save_once', side_effect=saved_then_exit), self.assertRaises(OSError):
                    module.cancel_announced(request)
                snapshot = module.unit_snapshot.side_effect
                def changed(unit):
                    value = snapshot(unit)
                    if unit == units[0] and not control['stopped']:
                        return value | {'InvocationID': 'e'*32, 'MainPID': '22'}
                    return value
                def old_process(pid):
                    if outcome == 'absent': raise FileNotFoundError()
                    if outcome == 'unreadable': raise PermissionError()
                    return {'pid': pid, 'parent': 99, 'start':'999', 'argv':['foreign']}
                if outcome == 'absent':
                    for pid in [12,13]: shutil.rmtree(module.PROC / str(pid))
                with patch.object(module, 'unit_snapshot', side_effect=changed), patch.object(module, 'process', side_effect=old_process):
                    with self.assertRaises((ValueError, PermissionError)):
                        module.cancel_announced(request)
                    self.assertEqual(control['stopCount'], 0)
                    self.assertFalse((state/'engine-release-cancellations'/(request['runKey']+'.stop-issued.json')).exists())
                    self.assertEqual(all((module.SYSTEMD/unit).is_symlink() for unit in units), outcome == 'absent')
                    if outcome == 'absent':
                        control['stopped'] = True
                        answer = module.cancel_announced(request)
                        self.assertEqual(answer['stopDisposition'],'not-needed-already-quiescent')
                        self.assertEqual(control['stopCount'], 0)

    def test_empty_retry_masks_without_stop_and_resumes_only_after_quiet(self):
        for race in [False, True]:
            with self.subTest(race=race), tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
                request, control, state, _, _, units = self.harness(folder, patches)
                evidence = module.announcement_evidence(request)
                marker = 'engine-release-requests/'+request['runKey']+'.awaiting-certificate'
                evidence['originals'].pop(marker); (state/marker).unlink()
                snapshot = module.unit_snapshot.side_effect
                def retry_snapshot(unit, service_context=False):
                    row = snapshot(unit)
                    if unit == units[0] and not control['stopped']:
                        row.update(MainPID='0', SubState='auto-restart', ControlGroup='')
                        if race and any(cmd[:2] == ['systemctl','daemon-reload'] for cmd in control['commands']):
                            row.update(MainPID='22', InvocationID='e'*32, SubState='start')
                    if service_context: row.update(Slice='system-fixture.slice',ControlPID='0')
                    return row
                with patch.object(module, 'unit_snapshot', side_effect=retry_snapshot), \
                     patch.object(module, 'empty_retry_admission') as admitted, \
                     patch.object(module, 'prove_unit_empty', side_effect=lambda unit, bindings=None: retry_snapshot(unit)), \
                     patch.object(module, 'configured_service_cgroup', side_effect=lambda unit, context: '/system.slice/'+unit):
                    with self.assertRaises(ValueError): module.cancel_announced(request)
                    self.assertEqual(control['stopCount'], 0)
                    path = state/'engine-release-cancellations'/(request['runKey']+'.intent.json')
                    intent = json.loads(path.read_text())
                    self.assertEqual(intent['schema'], module.EMPTY_CANCEL_SCHEMA)
                    self.assertIsNone(intent['originalProcess']); self.assertIsNone(intent['originalChild'])
                    self.assertFalse(path.with_name(request['runKey']+'.stop-issued.json').exists())
                    self.assertTrue(all((module.SYSTEMD/unit).is_symlink() for unit in units))
                    control['stopped'] = True
                    answer = module.cancel_announced(request)
                    self.assertIsNone(answer['originalControlGroup'])
                    self.assertEqual(answer['stopDisposition'], 'not-needed-already-quiescent')
                    self.assertEqual(control['stopCount'], 0)
                    module.validate_cancellation_reply(answer, request)

    def test_positive_native_empty_proof_refuses_unknown_foreign_and_live_process(self):
        unit = module.cancel_units('41177442979-1')[0]
        state = {'MainPID':'0', 'ControlGroup':''}
        path = '/org/freedesktop/systemd1/unit/exact'
        def command(args, timeout=5):
            if 'GetUnitProcesses' in args: return 'a(sus) 0'
            if 'GetUnit' in args: return 'o '+path
            if args[-1] == 'ControlPID': return 'u 0'
            if args[-1] == 'Id': return 's '+unit
            raise AssertionError(args)
        with patch.object(module, 'unit_snapshot', return_value=state), patch.object(module,'command',side_effect=command):
            self.assertEqual(module.prove_unit_empty(unit),state)
        for field, result in [('GetUnitProcesses',''),('GetUnitProcesses','a(sus) 1 /foreign 22 process'),('ControlPID','u 22'),('Id','s foreign')]:
            def bad(args, timeout=5): return result if field in args else command(args, timeout)
            with self.subTest(field=field,result=result), patch.object(module,'unit_snapshot',return_value=state), patch.object(module,'command',side_effect=bad), self.assertRaises(ValueError):
                module.prove_unit_empty(unit)
        with patch.object(module,'unit_snapshot',side_effect=[state,state|{'MainPID':'22'}]), patch.object(module,'command',side_effect=command), self.assertRaises(ValueError):
            module.prove_unit_empty(unit)

    def test_path_snapshot_preserves_inapplicable_process_fields_and_unreadable_cgroup_refuses(self):
        unit = module.cancel_units('41177442979-1')[2]
        values={'InvocationID':'', 'ActiveState':'inactive','SubState':'dead','Result':'success'}
        with patch.object(module,'command',return_value='\n'.join(k+'='+v for k,v in values.items())) as call:
            row=module.unit_snapshot(unit)
            self.assertIsNone(row['MainPID']); self.assertIsNone(row['ControlGroup'])
            self.assertEqual(row['unitType'],'path')
            self.assertNotIn('MainPID',call.call_args.args[0])
        with patch.object(module.os,'lstat',side_effect=PermissionError()), self.assertRaises(PermissionError):
            module.cgroup_empty('/system.slice/exact.service')
        with patch.object(module.os,'lstat',side_effect=FileNotFoundError(module.errno.ENOENT,'gone')):
            self.assertTrue(module.cgroup_empty('/system.slice/exact.service'))

    def test_gc_absence_requires_typed_manager_empty_and_actual_template_slice(self):
        unit = module.cancel_units('41177442979-1')[1]
        state={'MainPID':'0','ControlGroup':'','ActiveState':'inactive','SubState':'dead'}
        slice_name='system-club\\x2darena\\x2dengine\\x2dintake\\x2dv1.slice'
        context=state|{'ControlPID':'0','Slice':slice_name}
        expected='/system.slice/'+slice_name+'/'+unit
        def command(args, timeout=5):
            if 'ListUnitsByPatterns' in args: return 'a(ssssssouso) 0'
            if '-.slice' in args: return 'ControlGroup=/'
            raise AssertionError(args)
        with patch.object(module,'unit_snapshot',return_value=context), patch.object(module,'command',side_effect=command), patch.object(module,'cgroup_empty',return_value=True) as empty:
            self.assertEqual(module.prove_unloaded_unit_empty(unit,state),state)
            empty.assert_called_with(expected)
        for field,value in [('Slice','system-foreign.slice'),('ControlPID','22'),('MainPID','22')]:
            with self.subTest(field=field), patch.object(module,'unit_snapshot',return_value=context|{field:value}), patch.object(module,'command',side_effect=command), self.assertRaises(ValueError):
                module.prove_unloaded_unit_empty(unit,state)
        for reply in ['', 'a(ssssssouso) 1', 'as 0']:
            def bad(args, timeout=5): return reply if 'ListUnitsByPatterns' in args else command(args,timeout)
            with self.subTest(reply=reply), patch.object(module,'unit_snapshot',return_value=context), patch.object(module,'command',side_effect=bad), self.assertRaises(ValueError):
                module.prove_unloaded_unit_empty(unit,state)

    def test_masked_gc_proof_uses_retained_binding_without_reloading_configuration(self):
        unit=module.cancel_units('41177442979-1')[0]
        state={'MainPID':'0','ControlGroup':'','ActiveState':'inactive','SubState':'dead'}
        binding={unit:'/system.slice/system-original.slice/'+unit}
        with patch.object(module,'unit_snapshot',return_value=state), patch.object(module,'masked',return_value=True), \
             patch.object(module,'manager_unit_absent',return_value=True), patch.object(module,'cgroup_empty',return_value=True) as empty, \
             patch.object(module,'command',side_effect=AssertionError('No reload or command property guessing')):
            self.assertEqual(module.loaded_stop_contract(unit,'41177442979-1',allow_masked=True,bindings=binding),{'maskedEmpty':True})
            self.assertEqual(module.prove_unloaded_unit_empty(unit,state,binding),state)
            empty.assert_called_with(binding[unit])
        with patch.object(module,'manager_unit_absent',return_value=True), patch.object(module,'cgroup_empty',side_effect=PermissionError()), self.assertRaises(PermissionError):
            module.prove_unloaded_unit_empty(unit,state,binding)

    def test_unloaded_path_requires_exact_companion_service_empty(self):
        unit=module.cancel_units('41177442979-1')[2]
        state={'MainPID':None,'ControlGroup':None,'ActiveState':'inactive','unitType':'path'}
        with patch.object(module,'prove_unit_empty',return_value={'ActiveState':'inactive'}) as companion, patch.object(module,'manager_unit_absent',return_value=True) as absent:
            self.assertEqual(module.prove_unloaded_unit_empty(unit,state,{}),state)
            companion.assert_called_once_with(unit[:-5]+'.service',{})
            self.assertEqual(absent.call_count,2)
        with patch.object(module,'prove_unit_empty',side_effect=PermissionError()), self.assertRaises(PermissionError):
            module.prove_unloaded_unit_empty(unit,state,{})

    def test_empty_retry_admission_requires_exact_loaded_retry_contract(self):
        key='41177442979-1'; unit=module.cancel_units(key)[0]
        state={'MainPID':'0','ActiveState':'activating','SubState':'auto-restart'}
        config='Type=oneshot\nRestart=on-failure\nRestartUSec=30s'
        with patch.object(module,'command',return_value=config), patch.object(module,'prove_unit_empty',return_value=state):
            module.empty_retry_admission(unit,state,key,{'originals':{}})
            for changed in [state|{'MainPID':'12'},state|{'SubState':'start'},state|{'ActiveState':'failed'}]:
                with self.assertRaises(ValueError): module.empty_retry_admission(unit,changed,key,{'originals':{}})
            with self.assertRaises(ValueError): module.empty_retry_admission(unit,state,'other',{'originals':{}})
            with self.assertRaises(ValueError): module.empty_retry_admission(unit,state,key,{'originals':{'engine-release-requests/'+key+'.awaiting-certificate':'hash'}})
        with patch.object(module,'command',return_value=config.replace('30s','1s')), self.assertRaises(ValueError):
            module.empty_retry_admission(unit,state,key,{'originals':{}})

    def test_partial_retirement_resumes_without_another_stop(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
            request, control, state, entry, reservation, units = self.harness(folder, patches)
            original_unlink = Path.unlink; fired = False
            def interrupted(path, *args, **kwargs):
                nonlocal fired
                original_unlink(path, *args, **kwargs)
                if path.name == request['runKey'] + '.intent' and not fired:
                    fired = True; raise OSError('crash after partial retirement')
            with patch.object(Path, 'unlink', interrupted), self.assertRaises(OSError): module.cancel_announced(request)
            answer = module.cancel_announced(request)
            self.assertTrue(answer['quiescent']); self.assertEqual(control['stopCount'], 1)
            self.assertTrue(entry.exists()); self.assertTrue(reservation.exists())


    def test_loaded_stop_authority_refuses_foreign_commands_and_propagation(self):
        key = '41177442979-1'; unit = module.cancel_units(key)[0]
        wrapper = str(module.PARENT / 'engine-release-unit-wrapper-v1.sh')
        command = lambda argv: '{ path=' + wrapper + ' ; argv[]=' + argv + ' ; ignore_errors=no ; start_time=n/a ; stop_time=n/a ; pid=0 ; code=(null) ; status=0/0 }'
        config = {'ExecStart': command(wrapper + ' start ' + key), 'ExecStop': '',
                  'ExecStopPost': command(wrapper + ' recover ' + key + ' ${SERVICE_RESULT} ${EXIT_CODE} ${EXIT_STATUS}'),
                  'KillMode': 'control-group', 'FragmentPath': str(module.SYSTEMD / 'club-arena-engine-release-v1@.service'),
                  'DropInPaths': '', 'RequiredBy': '', 'RequisiteOf': '', 'BoundBy': '', 'ConsistsOf': '', 'PropagatesStopTo': ''}
        render = lambda value: '\n'.join(k + '=' + v for k, v in value.items())
        def real_empty_property_behavior(args):
            return render(config if '--all' in args else {k: v for k, v in config.items() if v})
        with patch.object(module, 'command', side_effect=real_empty_property_behavior):
            module.loaded_stop_contract(unit, key)
        for field in config:
            bad = config | {field: 'foreign'}
            with self.subTest(field=field), patch.object(module, 'command', return_value=render(bad)), self.assertRaises(ValueError):
                module.loaded_stop_contract(unit, key)
        for fragment in ['/dev/null', str(module.SYSTEMD / unit), '/etc/systemd/system/foreign.service']:
            empty = config | {'FragmentPath': fragment, 'ExecStart': '', 'ExecStopPost': ''}
            for positive_mask in [True, False]:
                with self.subTest(fragment=fragment, mask=positive_mask), patch.object(module, 'command', return_value=render(empty)), patch.object(module, 'masked', return_value=positive_mask):
                    if positive_mask and fragment != '/etc/systemd/system/foreign.service':
                        self.assertEqual(module.loaded_stop_contract(unit, key, allow_masked=True), {'maskedEmpty': True})
                    else:
                        with self.assertRaises(ValueError): module.loaded_stop_contract(unit, key, allow_masked=True)
                    with self.assertRaises(ValueError): module.loaded_stop_contract(unit, key)
        with patch.object(module, 'command', return_value=render(config | {'ExecStopPost': config['ExecStopPost'] + config['ExecStopPost']})), self.assertRaises(ValueError):
            module.loaded_stop_contract(unit, key)

    def test_missing_exec_needs_positive_typed_empty_for_exact_unit(self):
        unit = module.cancel_units('41177442979-1')[0]
        path = '/org/freedesktop/systemd1/unit/exact_2eservice'
        for failure in [None, 'foreign', 'path', 'nonempty', 'type', 'unknown', 'changed']:
            with self.subTest(failure=failure):
                reads = []
                def response(args):
                    reads.append(args)
                    if 'GetUnit' in args:
                        return 'o "' + (path if failure != 'path' else '/foreign') + '"'
                    if args[-1] == 'Id':
                        changed = failure == 'foreign' or (failure == 'changed' and len(reads) > 3)
                        return 's "' + ('foreign.service' if changed else unit) + '"'
                    if failure == 'unknown': raise subprocess.CalledProcessError(1, args)
                    return 'as 0' if failure == 'type' else 'a(sasbttttuii) ' + ('1' if failure == 'nonempty' else '0')
                with patch.object(module, 'command', side_effect=response):
                    if failure:
                        with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                            module.prove_empty_exec_properties(unit, {'ExecStop'})
                    else: module.prove_empty_exec_properties(unit, {'ExecStop'})
        with patch.object(module, 'command') as read, self.assertRaises(ValueError):
            module.prove_empty_exec_properties(unit, {'DropInPaths'})
        read.assert_not_called()

    def test_pre_stop_interruption_with_positive_quiescence_needs_no_stop(self):
        with tempfile.TemporaryDirectory(dir=TEST_TMP) as folder, ExitStack() as patches:
            request, control, state, entry, reservation, units = self.harness(folder, patches)
            original_save = module.save_once
            def crash(path, value):
                original_save(path, value)
                if path.name.endswith('.intent.json'): raise OSError('interrupted before masks/stop')
            with patch.object(module, 'save_once', side_effect=crash), self.assertRaises(OSError): module.cancel_announced(request)
            control['stopped'] = True  # Original may have exited while the helper was absent.
            answer = module.cancel_announced(request)
            self.assertTrue(answer['quiescent']); self.assertEqual(control['stopCount'], 0)
            self.assertFalse((state / 'engine-release-requests' / (request['runKey'] + '.request')).exists())
            self.assertTrue(entry.exists()); self.assertTrue(reservation.exists())


    # A Linux host booted without systemd (an agent container) cannot run the
    # real fixture, exactly as macOS cannot. Hosted CI (GITHUB_ACTIONS=true)
    # never skips: a runner without systemd fails qualification there.
    @unittest.skipUnless(
        sys.platform.startswith('linux') and (os.environ.get('GITHUB_ACTIONS') == 'true' or Path('/run/systemd/system').is_dir()),
        'Real systemd qualification requires Linux booted with systemd; required Linux CI never skips',
    )
    def test_real_linux_mask_reload_and_stop_contract(self):
        result = subprocess.run(['sudo', '-n', sys.executable, '-B', str(ROOT / 'tests/operations/withdrawal-systemd-fixture.py')], capture_output=True, text=True, timeout=50)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('owned fixture retired', result.stdout)
        self.assertIn('30-second auto-restart empty admission and natural masked quiescence passed without stop.', result.stdout)


class BytecodeCustody(unittest.TestCase):
    def test_actual_dynamic_import_and_own_thaw_never_pollutes_generation(self):
        for import_failure in [False,True]:
            with self.subTest(import_failure=import_failure),tempfile.TemporaryDirectory(dir=TEST_TMP) as folder:
                parent=Path(folder);generation=parent/'engine-control-generations'/module.E9_CONTROL;generation.mkdir(parents=True)
                helper=generation/'engine-release-database-proof.py'
                helper.write_text('raise RuntimeError("import sentinel")\n' if import_failure else 'def read_fixed_env(path):\n    raise RuntimeError("read sentinel")\n')
                digest=module.hashlib.sha256(helper.read_bytes()).hexdigest()
                with patch.object(sys,'dont_write_bytecode',False):
                    # Original CPython loader genuinely writes into the exact-manifest directory.
                    spec=importlib.util.spec_from_file_location('native_old_bytecode_fixture',helper)
                    old=importlib.util.module_from_spec(spec)
                    try: spec.loader.exec_module(old)
                    except RuntimeError: pass
                    self.assertTrue((generation/'__pycache__').is_dir())
                    shutil.rmtree(generation/'__pycache__')
                    with patch.object(module,'PARENT',parent),patch.object(module,'E9_HASHES',{helper.name:digest}),patch.object(module,'source_hash',side_effect=lambda p:module.hashlib.sha256(p.read_bytes()).hexdigest()):
                        with self.assertRaisesRegex(RuntimeError,'sentinel'): module.own_thaw(1,module.E9_CONTROL)
                    self.assertFalse(sys.dont_write_bytecode)
                    self.assertFalse((generation/'__pycache__').exists())
                    self.assertEqual([p.name for p in generation.iterdir()],[helper.name])


if __name__ == '__main__':
    if sys.argv[1:] == ['--prepare-history']:
        prepare_history(allow_fetch=True)
    else:
        unittest.main()
