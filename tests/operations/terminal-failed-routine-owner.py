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

DEAD_RUN = '555000111-1'
LIVE_RUN = '777000333-1'
A_SHA, B_SHA = 'a' * 40, 'b' * 40
A_IMAGE = 'sha256:' + 'a' * 64
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
        start = (int(time.time()) // 3600 - 2) * 3600
        self.start = start
        self.failure = {'schema': 1, 'runId': DEAD_RUN, 'result': 'failed', 'sha': B_SHA, 'controlSha': B_SHA,
            'invocationId': 'f' * 32, 'transactionExitStatus': 1, 'recoveredDesiredSha': A_SHA,
            'recoveredDesiredImageId': A_IMAGE, 'completedAt': start + 330}
        announced = start * 1000 + 4929 - 120000
        self.window = {'announcedAt': announced, 'startsAt': announced + 120000, 'endsAt': announced + 420000,
                       'verified': True}
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f', 'policyDigest': 'd' * 64,
            'startsAt': start, 'endsAt': start + 300, 'runId': DEAD_RUN, 'sha': B_SHA, 'controlSha': B_SHA,
            'status': 'reserved', 'failure': self.failure, 'window': self.window}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None, 'generation': 1,
            'updatedAt': start, 'routineMaintenanceCycles': {str(start): self.cycle}}
        self.intent = {'instance': '1-24d59baf', 'container': CONTAINER,
            'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(start - 3600)),
            'hostPid': 666945, 'source': A_SHA, 'runId': DEAD_RUN, 'controlSha': B_SHA, 'at': start + 19.4,
            'retryAllowed': False, 'nativeCensus': {}}
        self.units, self.probes = {}, []
        self.mocks = {}
        for name, fake in {'failed_routine_unit_snapshot': self.native_unit,
                           'failed_routine_service_empty': self.service_empty,
                           'require_engine_lock': lambda _fd: None,
                           'terminal_inspect_container': self.container, 'failed_routine_command': self.command,
                           'terminal_proc_birth': self.birth,
                           # Production reads root-owned 0600 files only; the fixture runs unprivileged.
                           'failed_routine_json': lambda path: json.loads(Path(path).read_text())}.items():
            p = patch.object(seal, name, side_effect=fake); self.mocks[name] = p.start(); self.addCleanup(p.stop)
        self.reset()

    # host fakes
    def reset(self):
        seal.write_state(copy.deepcopy(self.base))
        seal.write_json_atomic(seal.result_path(DEAD_RUN), self.failure)
        seal.AUDIT_FILE.write_text('{"event":"original_fixture_receipt"}\n')
        for p in list(self.request_root.iterdir()) + list(seal.RESULT_DIR.glob('*.terminal-resolution.json')):
            p.unlink()
        self.units.clear(); self.probes.clear(); self.cgroup_empty = True; self.unit_flip = None
        self.write_intent()
        self.live = {'Id': CONTAINER, 'Image': A_IMAGE,
                     'State': {'Status': 'running', 'Pid': 758052,
                               'StartedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.start + 1600))}}
        self.health = {'releaseSha': A_SHA, 'status': 'ok', 'instanceId': INSTANCE,
                       'maintenance': {'active': False, 'phase': 'idle'}}
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
        return self.quiet(lambda: seal.cmd_resolve_terminal_routine_failures(
            Namespace(engine_lock_fd=9, run_id=LIVE_RUN, invocation_id=invocation)))

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
                    'verifiedByRunId': LIVE_RUN, 'invocationId': INVOCATION, 'observedAt': self.start + 900,
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
                ('extra field', {**resolution, 'note': 'x'}, self.cycle)]:
            with self.subTest(name), self.assertRaisesRegex(ValueError, 'Routine owner evidence refused'):
                observer.terminal_failure_resolution(value, cycle, self.failure, fd, blank())
        receipt.unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            observer.terminal_failure_resolution(resolution, self.cycle, self.failure, fd, blank())

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
        }.items():
            with self.subTest(name):
                state = copy.deepcopy(good)
                mutate(state['routineFailureResolutions'][DEAD_RUN])
                seal.write_state(state)
                self.refused(self.owner)
        seal.write_state(good)


if __name__ == '__main__':
    unittest.main()
