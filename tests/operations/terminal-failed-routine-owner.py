#!/usr/bin/env python3
"""A terminal failed routine owner is released only by a locked, recorded proof.

Real seal module functions over isolated state files; host Docker, systemd,
/proc, health and database answers are supplied through the module's own probe
functions, never real host IO.
"""
from argparse import Namespace
from contextlib import redirect_stderr, redirect_stdout
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('terminal_owner_seal', ROOT / 'server/scripts/engine-release-seal.py')
seal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seal)
observer_spec = importlib.util.spec_from_file_location('terminal_owner_observer',
                                                       ROOT / 'scripts/ci/read-scoped-release-recovery.py')
observer = importlib.util.module_from_spec(observer_spec)
observer_spec.loader.exec_module(observer)

# The one owner the terminal proof may release: the exact 9f census refusal.
DEAD_RUN = seal.NINEF_RUN
LIVE_RUN = '777000333-1'
A_SHA, B_SHA = 'eed06fe51dea622069c661a6213d5b031ff3a9e3', seal.NINEF_SHA
TARGET_SHA, CONTROL_SHA = 'c' * 40, 'c' * 40
A_IMAGE = 'sha256:2eb1c5a7279032240c5fff8a6b3ecf5dc6af735cc1227a51430d50dcae1b065b'
OTHER_IMAGE = 'sha256:' + 'c' * 64
CONTAINER = 'd' * 64
INVOCATION = 'e' * 32
INSTANCE = '1-2899e4d9'
GONE = {'LoadState': 'not-found', 'ActiveState': 'inactive', 'SubState': 'dead', 'MainPID': '0',
        'ControlPID': '0', 'Job': '', 'UnitFileState': ''}


class TerminalFailedRoutineOwner(unittest.TestCase):
    def setUp(self):
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        temporary = tempfile.TemporaryDirectory(prefix='terminal-owner-', dir=scratch)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        state_dir = self.root / 'state'
        (state_dir / 'results').mkdir(parents=True)
        for name, value in {'STATE_DIR': state_dir, 'STATE_FILE': state_dir / 'seal.json',
                            'AUDIT_FILE': state_dir / 'audit.jsonl', 'RESULT_DIR': state_dir / 'results',
                            'LOCK_FILE': state_dir / 'lock'}.items():
            if hasattr(seal, name):
                p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        self.request_root = self.root / 'requests'
        self.request_root.mkdir()
        env = patch.dict(os.environ, {'ENGINE_RELEASE_REQUEST_ROOT': str(self.request_root),
            'ENGINE_RELEASE_PIN_ROOT': str(self.root / 'pins'), 'ENGINE_RELEASE_INTAKE_ROOT': str(self.root / 'intake'),
            'ENGINE_RELEASE_IMAGE_LEASE_ROOT': str(self.root / 'leases'),
            'ENGINE_RELEASE_LOCK_FILE': str(state_dir / 'lock')})
        env.start(); self.addCleanup(env.stop)
        start = 1793592000
        self.start = start
        self.failure = {'schema': 1, 'runId': DEAD_RUN, 'result': 'failed', 'sha': B_SHA, 'controlSha': B_SHA,
            'invocationId': seal.NINEF_INVOCATION, 'transactionExitStatus': 1, 'recoveredDesiredSha': A_SHA,
            'recoveredDesiredImageId': A_IMAGE, 'completedAt': seal.NINEF_COMPLETED_AT}
        self.assertEqual(seal.failed_routine_digest(self.failure), seal.NINEF_FAILURE)
        self.window = dict(seal.NINEF_WINDOW)
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST,
            'startsAt': start, 'endsAt': start + 300, 'runId': DEAD_RUN, 'sha': B_SHA, 'controlSha': B_SHA,
            'status': 'reserved', 'failure': self.failure, 'window': self.window}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None, 'generation': 1,
            'updatedAt': start, 'routineMaintenanceCycles': {str(start): self.cycle}}
        self.intent = {'instance': '1-24d59baf', 'container': CONTAINER,
            'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(start - 3600)),
            'hostPid': 666945, 'source': A_SHA, 'runId': DEAD_RUN, 'controlSha': B_SHA, 'at': start + 19.4,
            'retryAllowed': False, 'nativeCensus': {'candidateSHA': B_SHA, 'sourceSHA256': seal.NINEF_CENSUS_SOURCE}}
        self.units, self.probes = {}, []
        self.mocks = {}
        for name, fake in {'failed_routine_unit_snapshot': self.native_unit,
                           'failed_routine_service_empty': self.service_empty,
                           'require_engine_lock': lambda _fd: None,
                           'terminal_inspect_container': self.container, 'failed_routine_command': self.command,
                           'terminal_proc_birth': self.birth, 'ninef_sources': self.sources,
                           'failed_routine_current': self.current,
                           # Production reads root-owned 0600 files only; the fixture runs unprivileged.
                           'failed_routine_json': lambda path: json.loads(Path(path).read_text())}.items():
            p = patch.object(seal, name, side_effect=fake); self.mocks[name] = p.start(); self.addCleanup(p.stop)
        self.reset()

    # host fakes
    def sources(self, _deadline):
        if not self.sources_ok:
            seal.die('fixture source pin differs')
        return dict(seal.NINEF_SOURCES)

    def current(self, args, _deadline):
        self.current_calls += 1
        return {'requestDigest': '0' * 64, 'unit': {'InvocationID': args.invocation_id},
                'drift': self.current_calls if self.current_drift else 0}

    def reset(self):
        seal.write_state(copy.deepcopy(self.base))
        seal.write_json_atomic(seal.result_path(DEAD_RUN), self.failure)
        seal.AUDIT_FILE.write_text('{"event":"original_fixture_receipt"}\n')
        for p in list(self.request_root.iterdir()) + list(seal.RESULT_DIR.glob('*.terminal-resolution.json')):
            p.unlink()
        self.units.clear(); self.probes.clear(); self.cgroup_empty = True; self.unit_flip = None
        self.sources_ok, self.current_calls, self.current_drift = True, 0, False
        self.write_intent()
        self.live = {'Id': CONTAINER, 'Image': A_IMAGE,
                     'State': {'Status': 'running', 'Pid': 758052,
                               'StartedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.start + 1600))}}
        self.health = {'releaseSha': A_SHA, 'status': 'ok', 'instanceId': INSTANCE, 'running': True,
                       'liveness': 'ok', 'maintenance': {'active': False, 'phase': 'idle', 'durableConfirmed': False}}
        self.public_health = None
        self.database = {'schema': 'terminal-owned-thaw/v1', 'sha': A_SHA, 'instanceId': INSTANCE,
                         'databaseIdle': True, 'freshLeader': True, 'ownedV3Thaw': True,
                         'announcedAt': self.window['announcedAt'], 'startsAt': self.window['startsAt'],
                         'endsAt': self.window['endsAt']}
        self.old_birth = None
        refusal = {'ok': False, 'reason': 'inspector cleanup not verified', 'retryAllowed': False,
                   'checkpointInvoked': False, 'inspectorClosed': False, 'cleanupConnections': 0,
                   'transportDetail': 'op=queryObjects,cause=request_timeout,method=Runtime.evaluate,'
                                      'allowanceMs=59000,waitedMs=59052,invoked=no'}
        self.journal = [{'MESSAGE': json.dumps(refusal), '_SYSTEMD_UNIT': f'club-arena-engine-release-v1@{DEAD_RUN}.service',
                         '_SYSTEMD_INVOCATION_ID': self.failure['invocationId'],
                         '__REALTIME_TIMESTAMP': str((self.start + 80) * 1000000)}]
        seal.TERMINAL_OWNER_SETTLE_MS = 60_000

    def native_unit(self, unit, _deadline=None):
        self.probes.append(unit)
        if unit in self.units:
            seal.die('fixture unit is not stopped/disabled')
        if self.unit_flip == unit and self.probes.count(unit) > 1:
            return {**GONE, 'Job': '9'}
        return dict(GONE)

    def service_empty(self, unit, _before, _deadline):
        if not self.cgroup_empty:
            seal.die('fixture cgroup retains a process')
        return unit

    def container(self, _deadline):
        self.probes.append('docker')
        return copy.deepcopy(self.live)

    def birth(self, _pid):
        return self.old_birth

    def command(self, command, _deadline, _limit=32768):
        self.probes.append(command[0])
        if command[0] == 'curl':
            local = '127.0.0.1' in command[-1]
            return json.dumps(self.health if local or self.public_health is None else self.public_health)
        if command[0] == 'journalctl':
            return '\n'.join(json.dumps(r) for r in self.journal)
        if command[0].endswith('engine-release-database-proof.py'):
            if isinstance(self.database, Exception):
                raise self.database
            return json.dumps(self.database)
        raise AssertionError(command)

    def quiet(self, call):
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()):
            call()
        return out.getvalue().strip()

    def refused(self, call):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            call()

    def resolve(self, invocation=INVOCATION):
        # Production runs as root; only the resolver sees euid 0 (the observer keeps the real owner check).
        with patch.object(seal.os, 'geteuid', return_value=0):
            return self.quiet(lambda: seal.cmd_resolve_terminal_routine_failures(
                Namespace(engine_lock_fd=9, run_id=LIVE_RUN, sha=TARGET_SHA, control_sha=CONTROL_SHA,
                          invocation_id=invocation)))

    def resolve_or_refusal(self):
        try:
            return self.resolve()
        except SystemExit:
            return 'refused'

    def owner(self, run_id=LIVE_RUN):
        return self.quiet(lambda: seal.cmd_check_routine_owner(Namespace(run_id=run_id)))

    def unit(self, prefix, extension, **fields):
        self.units[f'club-arena-engine-{prefix}-v1@{DEAD_RUN}.{extension}'] = fields

    def write_intent(self, **fields):
        (self.request_root / f'{DEAD_RUN}.legacy-checkpoint-intent').write_text(json.dumps({**self.intent, **fields}))

    # cases
    def test_proved_terminal_owner_is_recorded_without_rewriting_history(self):
        for old_pid_birth in (None, 'reused'):
            with self.subTest(old_pid=old_pid_birth):
                self.reset()
                if old_pid_birth:
                    self.old_birth = self.start + 1500
                before_audit = seal.AUDIT_FILE.read_text()
                self.refused(self.owner)
                self.assertEqual(self.resolve(), DEAD_RUN)
                state = seal.load_state()
                self.assertEqual(state['routineMaintenanceCycles'], self.base['routineMaintenanceCycles'])
                self.assertEqual(seal.load_failure(DEAD_RUN), self.failure)
                self.assertNotIn('retiredRoutineCycles', state)
                resolution = state['routineFailureResolutions'][DEAD_RUN]
                self.assertEqual(resolution['result'], 'terminal-failure-proved')
                self.assertEqual(resolution['originalCycle'], self.cycle)
                self.assertEqual((resolution['verifiedByControlSha'], resolution['verifiedByTargetSha']),
                                 (CONTROL_SHA, TARGET_SHA))
                self.assertEqual(resolution['proof']['sourceDigests'], seal.NINEF_SOURCES)
                self.assertGreaterEqual(self.current_calls, 2, 'the current verifier was not re-read before the CAS')
                self.assertEqual(resolution['proof']['originalProcess'],
                                 'pid-reused-after-intent' if old_pid_birth else 'kernel-enoent')
                receipt = seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION)
                self.assertEqual(json.loads(receipt.read_text()), resolution)
                audit = seal.AUDIT_FILE.read_text()
                self.assertTrue(audit.startswith(before_audit))
                self.assertIn(f'routine_terminal_failure_proved:{DEAD_RUN}:{LIVE_RUN}:{INVOCATION}', audit)
                self.probes.clear()
                self.assertEqual(self.owner(), 'none')
                self.assertEqual(self.probes, [], 'the owner gate probed host state')
                self.assertEqual(self.resolve(), 'not-needed')

    def test_interrupted_proof_resumes_with_its_original_receipt_bytes(self):
        proof = seal.terminal_owner_proof(seal.load_state(), self.cycle, time.monotonic() + 45)
        original = {'schema': 1, 'result': 'terminal-failure-proved', 'originalCycle': self.cycle,
                    'verifiedByRunId': LIVE_RUN, 'verifiedByControlSha': CONTROL_SHA,
                    'verifiedByTargetSha': TARGET_SHA, 'invocationId': INVOCATION, 'observedAt': self.start + 900,
                    'proof': proof}
        seal.write_json_atomic(seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION), original)
        self.assertEqual(self.resolve(), DEAD_RUN)
        self.assertEqual(seal.load_state()['routineFailureResolutions'][DEAD_RUN], original)
        # A receipt for this invocation that disagrees with the fresh proof refuses.
        self.reset()
        seal.write_json_atomic(seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION),
                               {**original, 'proof': {**proof, 'originalProcess': 'pid-reused-after-intent'}})
        self.refused(self.resolve)
        self.assertNotIn('routineFailureResolutions', seal.load_state())

    def test_every_missing_or_unknown_proof_keeps_the_owner(self):
        bad_intent = lambda **f: lambda: self.write_intent(**f)
        cases = {
            'window not settled': lambda: setattr(seal, 'TERMINAL_OWNER_SETTLE_MS', 10 * 3600 * 1000),
            'desired changed': lambda: seal.write_state({**seal.load_state(), 'desired': {
                'sha': A_SHA, 'imageId': OTHER_IMAGE, 'legacyUnlabelled': False}}),
            'durable failure differs': lambda: seal.write_json_atomic(
                seal.result_path(DEAD_RUN), {**self.failure, 'completedAt': 1}),
            'request retained': lambda: (self.request_root / f'{DEAD_RUN}.request').write_text('x'),
            'intent retained': lambda: (self.request_root / f'{DEAD_RUN}.intent').write_text('x'),
            'awaiting certificate retained': lambda: (self.request_root / f'{DEAD_RUN}.awaiting-certificate').write_text('x'),
            'lightning hold unreleased': lambda: (self.request_root / f'{DEAD_RUN}.lightning-hold.json').write_text('{}'),
            'activation entry retained': lambda: (self.request_root / f'{DEAD_RUN}.activation-entry').write_text('x'),
            'inspector retirement intent retained': lambda: (self.request_root /
                f'{DEAD_RUN}.main-inspector-retirement-intent').write_text('x'),
            'release unit not stopped': lambda: self.unit('release', 'service', ActiveState='active'),
            'intake path enabled': lambda: self.unit('intake', 'path', UnitFileState='enabled'),
            'service cgroup not empty': lambda: setattr(self, 'cgroup_empty', False),
            'unit changed during proof': lambda: setattr(self, 'unit_flip',
                f'club-arena-engine-release-v1@{DEAD_RUN}.service'),
            'systemd unknown': lambda: self.mocks['failed_routine_unit_snapshot'].configure_mock(
                side_effect=lambda _u, _d=None: seal.die('bus unavailable')),
            'no checkpoint intent': lambda: (self.request_root / f'{DEAD_RUN}.legacy-checkpoint-intent').unlink(),
            'unannounced window': lambda: seal.write_state({**seal.load_state(), 'routineMaintenanceCycles': {
                str(self.start): {k: v for k, v in self.cycle.items() if k != 'window'}}}),
            'unverified window': lambda: seal.write_state({**seal.load_state(), 'routineMaintenanceCycles': {
                str(self.start): {**self.cycle, 'window': {**self.window, 'verified': False}}}}),
            'checkpoint in another container': bad_intent(container='e' * 64),
            'checkpoint retry allowed': bad_intent(retryAllowed=True),
            'checkpoint before the break': bad_intent(at=self.start - 10),
            'restart before failure completed': lambda: self.live['State'].update(
                StartedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.start + 100))),
            'serving instance is the checkpointed one': lambda: (self.health.update(instanceId='1-24d59baf'),
                self.database.update(instanceId='1-24d59baf')),
            'container other image': lambda: self.live.update(Image=OTHER_IMAGE),
            'container stopped': lambda: self.live['State'].update(Status='exited'),
            'docker unknown': lambda: self.mocks['terminal_inspect_container'].configure_mock(
                side_effect=lambda _d: seal.die('docker unknown')),
            'checkpoint process not replaced': lambda: self.live['State'].update(StartedAt=self.intent['startedAt']),
            'checkpoint pid still original': lambda: self.live['State'].update(Pid=666945),
            'old pid alive from before intent': lambda: setattr(self, 'old_birth', self.start + 10),
            'checkpoint for another source': bad_intent(source=B_SHA),
            'checkpoint for another run': bad_intent(runId=LIVE_RUN),
            'checkpoint intent unreadable': lambda: (self.request_root /
                f'{DEAD_RUN}.legacy-checkpoint-intent').write_text('{not json'),
            'maintenance active': lambda: self.health['maintenance'].update(active=True, phase='counting_down'),
            'health on another source': lambda: self.health.update(releaseSha=B_SHA),
            'public health another instance': lambda: setattr(self, 'public_health',
                {**self.health, 'instanceId': '1-deadbeef'}),
            'database maintenance owner': lambda: setattr(self, 'database', RuntimeError('owner present')),
            'database other leader': lambda: self.database.update(instanceId='1-deadbeef'),
            'original thaw unproved': lambda: self.database.update(ownedV3Thaw=False),
            'no checkpoint refusal in journal': lambda: self.journal.clear(),
            'two checkpoint refusals': lambda: self.journal.append(dict(self.journal[0])),
            'checkpoint was invoked': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'checkpointInvoked': True})),
            'checkpoint result present': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'checkpoint': {}})),
            'inspector request invoked': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'transportDetail': 'op=queryObjects,invoked=yes'})),
            'refusal from another invocation': lambda: self.journal[0].update(_SYSTEMD_INVOCATION_ID='0' * 32),
            'refusal outside the break': lambda: self.journal[0].update(
                __REALTIME_TIMESTAMP=str((self.start - 600) * 1000000)),
            'thaw for another window': lambda: self.database.update(startsAt=self.window['startsAt'] + 1),
            'later checkpoint invoked row': lambda: self.journal.append({**self.journal[0], 'MESSAGE': json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'ok': True, 'checkpointInvoked': True})}),
            'refusal for another reason': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'reason': 'deadline'})),
            'inspector closed': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'inspectorClosed': True})),
            'cleanup connections left': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'cleanupConnections': 1})),
            'refusal for another operation': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']),
                 'transportDetail': 'op=heapSnapshot,cause=request_timeout,invoked=no'})),
            'census for another candidate': bad_intent(nativeCensus={'candidateSHA': A_SHA,
                                                                     'sourceSHA256': seal.NINEF_CENSUS_SOURCE}),
            'census from another source': bad_intent(nativeCensus={'candidateSHA': B_SHA, 'sourceSHA256': '0' * 64}),
            'census missing': bad_intent(nativeCensus=None),
            'original sources unproved': lambda: setattr(self, 'sources_ok', False),
            'verifier changed during proof': lambda: setattr(self, 'current_drift', True),
            'verifier unknown': lambda: self.mocks['failed_routine_current'].configure_mock(
                side_effect=lambda _a, _d: seal.die('request unreadable')),
            'engine not running': lambda: self.health.update(running=False),
            'liveness not ok': lambda: self.health.update(liveness='degraded'),
            'durable break confirmed': lambda: self.health['maintenance'].update(durableConfirmed=True),
            'cycle failure invocation differs': lambda: (seal.write_state({**seal.load_state(),
                'routineMaintenanceCycles': {str(self.start): {**self.cycle,
                    'failure': {**self.failure, 'invocationId': '0' * 32}}}}),
                seal.write_json_atomic(seal.result_path(DEAD_RUN), {**self.failure, 'invocationId': '0' * 32})),
        }
        for name, arrange in cases.items():
            with self.subTest(name):
                self.reset()
                arrange()
                outcome = self.resolve_or_refusal()
                self.assertNotEqual(outcome, DEAD_RUN)
                self.assertNotIn(DEAD_RUN, seal.load_state().get('routineFailureResolutions', {}))
                self.assertFalse(list(seal.RESULT_DIR.glob('*.terminal-resolution.json')))
                self.refused(self.owner)

    def test_recovery_observer_reads_only_an_exact_receipted_terminal_record(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        resolution = seal.load_state()['routineFailureResolutions'][DEAD_RUN]
        receipt = seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION)
        os.chmod(receipt, 0o600)
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, fd)
        blank = lambda: {'present': False}
        answer, observation = observer.terminal_failure_resolution(resolution, self.cycle, self.failure, fd, blank())
        self.assertTrue(answer['present'] and answer['receiptMatches'] and answer['databaseIdleRecorded'])
        self.assertEqual(observation[0], receipt.name)
        for name, value, cycle in [
                ('changed record', {**resolution, 'observedAt': resolution['observedAt'] + 1}, self.cycle),
                ('self verified', {**resolution, 'verifiedByRunId': DEAD_RUN}, self.cycle),
                ('other cycle', resolution, {**self.cycle, 'sha': A_SHA}),
                ('sources differ', {**resolution, 'proof': {**resolution['proof'], 'sourceDigests': {}}}, self.cycle),
                ('verifier targets 9f', {**resolution, 'verifiedByTargetSha': B_SHA}, self.cycle),
                ('database unchecked', {**resolution, 'proof': {**resolution['proof'], 'database': None}}, self.cycle),
                ('instances both absent', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {k: v for k, v in resolution['proof']['runtime'].items() if k != 'instanceId'},
                    'database': {k: v for k, v in resolution['proof']['database'].items() if k != 'instanceId'}}},
                 self.cycle),
                ('database sha differs', {**resolution, 'proof': {**resolution['proof'],
                    'database': {**resolution['proof']['database'], 'sha': B_SHA}}}, self.cycle),
                ('runtime pid not int', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'hostPid': '1'}}}, self.cycle),
                ('started not a timestamp', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'startedAt': 'yesterday'}}}, self.cycle),
                ('started without zone', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'startedAt': '2026-11-02T05:54:48.403092401'}}}, self.cycle),
                ('started before failure', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'startedAt': '2026-11-02T04:05:00Z'}}}, self.cycle),
                ('instance malformed', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'instanceId': 'engine.a'},
                    'database': {**resolution['proof']['database'], 'instanceId': 'engine.a'}}}, self.cycle),
                ('extra field', {**resolution, 'note': 'x'}, self.cycle)]:
            with self.subTest(name), self.assertRaisesRegex(ValueError, 'Routine owner evidence refused'):
                observer.terminal_failure_resolution(value, cycle, self.failure, fd, blank())
        receipt.unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            observer.terminal_failure_resolution(resolution, self.cycle, self.failure, fd, blank())

    def test_no_other_failed_owner_is_ever_terminally_resolved(self):
        other = '555000111-1'
        failure = {**self.failure, 'runId': other, 'invocationId': 'f' * 32}
        cycle = {**self.cycle, 'runId': other, 'failure': failure}
        seal.write_json_atomic(seal.result_path(other), failure)
        state = {**copy.deepcopy(self.base), 'routineMaintenanceCycles': {str(self.start): cycle}}
        seal.write_state(state)
        self.assertIsNone(seal.terminal_owner_proof(state, cycle, time.monotonic() + 45))
        self.assertEqual(self.resolve(), 'not-needed')
        self.refused(self.owner)
        # A fabricated record for that owner, receipt included, is refused rather than honoured.
        record = {'schema': 1, 'result': 'terminal-failure-proved', 'originalCycle': cycle,
                  'verifiedByRunId': LIVE_RUN, 'verifiedByControlSha': CONTROL_SHA, 'verifiedByTargetSha': TARGET_SHA,
                  'invocationId': INVOCATION, 'observedAt': self.start + 900, 'proof': {}}
        seal.write_json_atomic(seal.terminal_receipt_path(other, LIVE_RUN, INVOCATION), record)
        seal.write_state({**state, 'routineFailureResolutions': {other: record}})
        self.refused(self.owner)

    def test_database_witness_requires_the_exact_v3_thaw_ledger(self):
        spec = importlib.util.spec_from_file_location('terminal_owner_db', ROOT / 'server/scripts/engine-release-database-proof.py')
        db = importlib.util.module_from_spec(spec); spec.loader.exec_module(db)
        targets = {k: i for i, k in enumerate(sorted(db.TERMINAL_THAW_TARGETS))}
        good = {'freeze_started_at': '2026-11-02T04:00:04.929+00:00', 'announced_at': '2026-11-02T03:58:04.929+00:00',
                'release_target_at': '2026-11-02T04:05:04.929+00:00', 'thawed_at': '2026-11-02T04:05:05+00:00',
                'frozen_seconds': 300, 'contract_version': 3, 'release_generation': 1,
                'ownership_token': '0b6c1f2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b', 'thawed_by': A_SHA[:8],
                'shifted': {'complete': True, '_targets_snapshotted': True, '_target_counts': dict(targets), **targets}}
        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *_): return False
        def run(row, breaks=(b'[]', b'[]')):
            replies = list(breaks)
            class Opener:
                def open(self, request, timeout):
                    url = request.full_url
                    if 'engine_maintenance_break' in url:
                        return Reply(replies.pop(0))
                    return Reply(b'[]' if 'release_target_at=gt' in url else json.dumps([row]).encode())
            with patch.object(db, 'build_opener', lambda *_: Opener()), \
                    patch.object(db, 'read_leader', lambda *_: (A_SHA[:8], INSTANCE, 1)):
                return db.verify_terminal_owned_thaw('https://db.invalid', 'k', A_SHA, INSTANCE, 15,
                                                     *(self.window[k] for k in ('announcedAt', 'startsAt', 'endsAt')))
        self.assertTrue(run(good)['ownedV3Thaw'])
        self.assertNotIn('ownership_token', json.dumps(run(good)))
        first = sorted(targets)[1]
        for name, mutate in {
            'count is boolean true': lambda r: (r['shifted'].update({first: 1}), r['shifted']['_target_counts'].update({first: True})),
            'count is boolean false': lambda r: r['shifted']['_target_counts'].update({sorted(targets)[0]: False}),
            'shifted is boolean': lambda r: r['shifted'].update({first: True}),
            'count differs': lambda r: r['shifted']['_target_counts'].update({first: 99}),
            'negative shift': lambda r: (r['shifted'].update({first: -1}), r['shifted']['_target_counts'].update({first: -1})),
            'extra ledger key': lambda r: r['shifted'].update(tournaments=0),
            'target missing': lambda r: r['shifted'].pop(first),
            'not snapshotted': lambda r: r['shifted'].update(_targets_snapshotted=False),
            'incomplete': lambda r: r['shifted'].update(complete=False),
            'token absent': lambda r: r.update(ownership_token=None),
            'token malformed': lambda r: r.update(ownership_token='not-a-uuid'),
        }.items():
            with self.subTest(name), self.assertRaises(ValueError):
                row = copy.deepcopy(good); mutate(row); run(row)
        with self.subTest('maintenance row at the closing bookend'), self.assertRaises(ValueError):
            run(good, breaks=(b'[]', b'[{"id":1}]'))

    def test_a_recorded_resolution_needs_its_identical_receipt(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        self.assertEqual(self.owner(), 'none')
        receipt = seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION)
        original = receipt.read_text()
        receipt.write_text(original.replace('"verifiedByRunId"', '"verifiedByRunId" ', 1).replace(
            str(json.loads(original)['observedAt']), str(json.loads(original)['observedAt'] + 1)))
        self.refused(self.owner)
        receipt.unlink()
        self.refused(self.owner)

    def test_a_resolved_failed_source_can_never_reserve_or_prepare_again(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        state = seal.load_state()
        self.assertTrue(seal.resolved_failed_source(state, B_SHA))
        self.assertFalse(seal.resolved_failed_source(state, A_SHA))
        self.refused(lambda: seal.cmd_reserve_routine_cycle(Namespace(
            repo=str(self.root), sha=B_SHA, control_sha=B_SHA, run_id='888000444-1')))
        self.assertEqual(seal.load_state()['routineMaintenanceCycles'], state['routineMaintenanceCycles'])

    def test_canonical_routine_observation_reports_the_recorded_terminal_owner(self):
        import shutil
        self.assertEqual(self.resolve(), DEAD_RUN)
        root = self.root / 'observer-root'
        results = root / 'engine-release-results'
        results.mkdir(parents=True)
        os.chmod(root, 0o700); os.chmod(results, 0o700)
        shutil.copyfile(seal.STATE_FILE, root / 'engine-release-seal.json')
        for source in (seal.result_path(DEAD_RUN), seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION)):
            shutil.copyfile(source, results / source.name)
        for path in [root / 'engine-release-seal.json', *results.iterdir()]:
            os.chmod(path, 0o600)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, fd)
        reply = observer.routine_remote(observer.ROUTINE_REQUEST, fd)
        observer.validate_routine_reply(reply, observer.ROUTINE_REQUEST)
        [row] = [r for r in reply['owners'] if r['runId'] == DEAD_RUN]
        self.assertTrue(row['failureResolution']['present'])
        self.assertFalse(row['unresolvedOwner'])
        # Removing the receipt makes the canonical observation refuse rather than guess.
        (results / seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION).name).unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            observer.routine_remote(observer.ROUTINE_REQUEST, fd)

    def test_recorded_resolution_must_match_its_original_cycle_exactly(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        good = seal.load_state()
        for name, mutate in {
            'changed cycle': lambda r: r['originalCycle'].update(sha=A_SHA),
            'self verified': lambda r: r.update(verifiedByRunId=DEAD_RUN),
            'extra field': lambda r: r.update(note='x'),
            'wrong result': lambda r: r.update(result='retired'),
            'before window end': lambda r: r.update(observedAt=self.cycle['startsAt']),
            'database not idle': lambda r: r['proof']['database'].update(databaseIdle=False),
            'unknown process state': lambda r: r['proof'].update(originalProcess='no-checkpoint-entered'),
            'thaw not recorded': lambda r: r['proof']['database'].update(ownedV3Thaw=False),
            'refusal digest missing': lambda r: r['proof'].update(checkpointRefusalDigest=None),
            'failure digest differs': lambda r: r['proof'].update(failureDigest='0' * 64),
            'sources differ': lambda r: r['proof'].update(sourceDigests={}),
            'verifier targets 9f': lambda r: r.update(verifiedByTargetSha=B_SHA),
            'verifier control missing': lambda r: r.pop('verifiedByControlSha'),
            'runtime instance missing': lambda r: (r['proof']['runtime'].pop('instanceId'),
                                                   r['proof']['database'].pop('instanceId')),
            'runtime extra key': lambda r: r['proof']['runtime'].update(note='x'),
            'runtime pid not int': lambda r: r['proof']['runtime'].update(hostPid='758052'),
            'runtime container malformed': lambda r: r['proof']['runtime'].update(containerId='x'),
            'started not a timestamp': lambda r: r['proof']['runtime'].update(startedAt='yesterday'),
            'started without zone': lambda r: r['proof']['runtime'].update(startedAt='2026-11-02T05:54:48.403092401'),
            'started before failure': lambda r: r['proof']['runtime'].update(startedAt='2026-11-02T04:05:00Z'),
            'database sha differs': lambda r: r['proof']['database'].update(sha=B_SHA),
            'database other instance': lambda r: r['proof']['database'].update(instanceId='1-deadbeef'),
            'database boolean as int': lambda r: r['proof']['database'].update(databaseIdle=1),
        }.items():
            with self.subTest(name):
                state = copy.deepcopy(good)
                mutate(state['routineFailureResolutions'][DEAD_RUN])
                seal.write_state(state)
                self.refused(self.owner)
        seal.write_state(good)


class CancelledAnnouncementOwner(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'])
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, value in {'STATE_DIR': self.root, 'STATE_FILE': self.root / 'engine-release-seal.json',
                'AUDIT_FILE': self.root / 'audit.jsonl', 'RESULT_DIR': self.root / 'engine-release-results',
                'LOCK_FILE': self.root / 'lock'}.items():
            p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        seal.RESULT_DIR.mkdir(mode=0o700)
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST, 'startsAt': 1793602800, 'endsAt': 1793603100,
            'runId': seal.CANCELLED_PHASE1_RUN, 'sha': seal.CANCELLED_PHASE1_SHA,
            'controlSha': seal.CANCELLED_PHASE1_SHA, 'status': 'reserved',
            'window': dict(seal.CANCELLED_PHASE1_WINDOW)}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None,
            'generation': 312, 'routineMaintenanceCycles': {'1793602800': self.cycle}}
        seal.write_state(copy.deepcopy(self.base))
        self.proof = {'schema': 'cancelled-routine-announcement-proof/v1', 'originalCycle': self.cycle,
            'recordHashes': dict.fromkeys(('receipt','intent','quiescent','stop-issued'), 'a' * 64),
            'retainedHashes': dict.fromkeys(('entryHash','reservationHash','releasedHoldHash'), 'b' * 64),
            'sourceHashes': dict(seal.CANCELLED_PHASE1_SOURCES), 'thaw': dict(seal.CANCELLED_PHASE1_THAW),
            'container': {'id': CONTAINER, 'startedAt': '2026-11-02T05:54:48.403092401Z', 'image': A_IMAGE},
            'instanceId': '1-2ced3e43'}
        self.commands = []
        def command(argv, deadline, limit=32768, **kw):
            self.commands.append(argv)
            if argv[0] == 'git': return '# qualified read-only helper'
            self.assertEqual(argv[1:3], ['-B', '-c'])
            self.assertEqual(argv[-1], '--phase1-cancellation-proof')
            return json.dumps(self.proof)
        for name, value in [('require_engine_lock', lambda fd: None),
                ('failed_routine_current', lambda a,d: {'same': True}),
                ('failed_routine_command', command),
                ('failed_routine_json', lambda p: json.loads(Path(p).read_text()))]:
            p = patch.object(seal, name, side_effect=value); p.start(); self.addCleanup(p.stop)

    def resolve(self):
        with patch.object(seal.os, 'geteuid', return_value=0), redirect_stdout(io.StringIO()) as out:
            args = seal.parser().parse_args(['resolve-terminal-routine-failures', '--engine-lock-fd', '9',
                '--run-id', LIVE_RUN, '--sha', TARGET_SHA, '--control-sha', CONTROL_SHA,
                '--invocation-id', INVOCATION])
            self.assertEqual(args.repo, '/opt/club-arena')
            args.handler(args)
        return out.getvalue().strip()

    def test_cancellation_resolves_without_fabricating_a_failure_and_replays(self):
        self.assertEqual(self.resolve(), seal.CANCELLED_PHASE1_RUN)
        state = seal.load_state()
        self.assertEqual(state['routineMaintenanceCycles'], self.base['routineMaintenanceCycles'])
        self.assertFalse(seal.result_path(seal.CANCELLED_PHASE1_RUN).exists())
        resolution = state['routineFailureResolutions'][seal.CANCELLED_PHASE1_RUN]
        self.assertEqual(resolution['result'], 'cancelled-announcement-proved')
        self.assertEqual(self.resolve(), 'not-needed')
        self.assertFalse(seal.routine_owner_unresolved(state, self.cycle))
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        try:
            answer, _ = observer.routine_failure_resolution(resolution, self.cycle, None, fd)
            self.assertTrue(answer['present'] and answer['receiptMatches'])
            for field, change in [('sourceHashes', {}), ('thaw', {}), ('container', {})]:
                bad = copy.deepcopy(resolution); bad['proof'][field] = change
                with self.assertRaises((ValueError, KeyError)):
                    observer.routine_failure_resolution(bad, self.cycle, None, fd)
        finally: os.close(fd)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            observed = observer.routine_remote(dict(observer.ROUTINE_REQUEST), root_fd)
            self.assertFalse(observed['owners'][0]['unresolvedOwner'])
            self.assertFalse(observed['owners'][0]['failurePresent'])
        finally: os.close(root_fd)
        self.assertEqual(len([a for a in self.commands if a[0] == 'git']), 2)
        self.assertTrue(all(a[4] == CONTROL_SHA + ':scripts/ci/withdraw-waiting-engine-release.py'
                            for a in self.commands if a[0] == 'git'))

    def test_receipt_audit_and_state_interruptions_resume_one_resolution(self):
        for edge in ('audit_once', 'write_state'):
            with self.subTest(edge=edge):
                seal.write_state(copy.deepcopy(self.base))
                for p in seal.RESULT_DIR.iterdir(): p.unlink()
                seal.AUDIT_FILE.unlink(missing_ok=True)
                with patch.object(seal, edge, side_effect=RuntimeError('crash')):
                    with self.assertRaises(RuntimeError): self.resolve()
                receipt = seal.terminal_receipt_path(seal.CANCELLED_PHASE1_RUN, LIVE_RUN, INVOCATION)
                before = receipt.read_bytes()
                self.assertNotIn('routineFailureResolutions', seal.load_state())
                self.assertEqual(self.resolve(), seal.CANCELLED_PHASE1_RUN)
                self.assertEqual(receipt.read_bytes(), before)
                rows = [json.loads(x) for x in seal.AUDIT_FILE.read_text().splitlines()]
                self.assertEqual(len(rows), 1)

    def test_changed_window_source_thaw_and_live_transaction_refuse(self):
        for field in ('pending', 'finalization', 'committed', 'window', 'source', 'thaw', 'startedAt', 'proofChanged'):
            with self.subTest(field=field):
                state = copy.deepcopy(self.base); proof = copy.deepcopy(self.proof)
                if field in ('pending','finalization'): state[field] = {'runId': LIVE_RUN, 'sha': TARGET_SHA, 'imageId': OTHER_IMAGE}
                if field == 'committed': state['committedRuns'][seal.CANCELLED_PHASE1_RUN] = {'sha': seal.CANCELLED_PHASE1_SHA, 'imageId': OTHER_IMAGE}
                if field == 'window': state['routineMaintenanceCycles']['1793602800']['window']['startsAt'] -= 1
                if field == 'source': proof['sourceHashes'] = {}
                if field == 'thaw': proof['thaw']['freezeStartedAtMs'] += 1
                if field == 'startedAt': proof['container']['startedAt'] = 'unknown'
                seal.write_state(state)
                for p in seal.RESULT_DIR.iterdir(): p.unlink()
                original = self.proof; self.proof = proof
                if field == 'proofChanged':
                    self.proof['originalCycle'] = {**self.cycle, 'sha': A_SHA}
                try:
                    with redirect_stderr(io.StringIO()), self.assertRaises((SystemExit, ValueError)):
                        self.resolve()
                    self.assertNotIn('routineFailureResolutions', json.loads(seal.STATE_FILE.read_text()))
                    self.assertEqual(list(seal.RESULT_DIR.iterdir()), [])
                finally: self.proof = original


if __name__ == '__main__':
    unittest.main()
