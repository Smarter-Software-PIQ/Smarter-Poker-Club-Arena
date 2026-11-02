#!/usr/bin/env python3
"""A terminal failed routine owner is released only by a locked, recorded proof.

Real seal module functions over isolated state files; host Docker/systemd
answers are supplied through the module's own probe functions, never real IO.
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

DEAD_RUN = '555000111-1'
LIVE_RUN = '777000333-1'
A_SHA, B_SHA = 'a' * 40, 'b' * 40
A_IMAGE = 'sha256:' + 'a' * 64
OTHER_IMAGE = 'sha256:' + 'c' * 64
INVOCATION = 'e' * 32
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
        self.failure = {'schema': 1, 'runId': DEAD_RUN, 'result': 'failed', 'sha': B_SHA, 'controlSha': B_SHA,
            'invocationId': 'f' * 32, 'transactionExitStatus': 1, 'recoveredDesiredSha': A_SHA,
            'recoveredDesiredImageId': A_IMAGE, 'completedAt': start + 330}
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f', 'policyDigest': 'd' * 64,
            'startsAt': start, 'endsAt': start + 300, 'runId': DEAD_RUN, 'sha': B_SHA, 'controlSha': B_SHA,
            'status': 'reserved', 'failure': self.failure}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None, 'generation': 1,
            'updatedAt': start, 'routineMaintenanceCycles': {str(start): self.cycle}}
        seal.write_state(copy.deepcopy(self.base))
        seal.AUDIT_FILE.write_text('{"event":"original_fixture_receipt"}\n')
        seal.write_json_atomic(seal.result_path(DEAD_RUN), self.failure)
        self.units = {}
        self.probes = []
        for name, fake in {'container_identity': lambda _n: ('running', A_IMAGE),
                           'native_unit': self.native_unit, 'require_engine_lock': lambda _fd: None}.items():
            p = patch.object(seal, name, side_effect=fake); self.mocks = getattr(self, 'mocks', {})
            self.mocks[name] = p.start(); self.addCleanup(p.stop)

    def native_unit(self, unit):
        self.probes.append(unit)
        return dict(self.units.get(unit, GONE))

    def quiet(self, call):
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()):
            call()
        return out.getvalue().strip()

    def refused(self, call):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            call()

    def resolve(self):
        return self.quiet(lambda: seal.cmd_resolve_terminal_routine_failures(
            Namespace(engine_lock_fd=9, run_id=LIVE_RUN, invocation_id=INVOCATION)))

    def owner(self, run_id=LIVE_RUN):
        return self.quiet(lambda: seal.cmd_check_routine_owner(Namespace(run_id=run_id)))

    def test_proved_terminal_owner_is_recorded_without_rewriting_history(self):
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
        self.assertTrue(seal.AUDIT_FILE.read_text().startswith(before_audit))
        self.assertIn('routine_terminal_failure_proved', seal.AUDIT_FILE.read_text())
        self.probes.clear()
        self.assertEqual(self.owner(), 'none')
        self.assertEqual(self.probes, [], 'the owner gate probed native state')
        self.assertEqual(self.resolve(), 'not-needed')

    def test_every_missing_or_unknown_proof_keeps_the_owner(self):
        cases = {
            'window not settled': lambda: self.settle(10 * 3600 * 1000),
            'desired changed': lambda: self.edit_state(desired={'sha': A_SHA, 'imageId': OTHER_IMAGE, 'legacyUnlabelled': False}),
            'container other image': lambda: self.mocks['container_identity'].configure_mock(side_effect=lambda _n: ('running', OTHER_IMAGE)),
            'container stopped': lambda: self.mocks['container_identity'].configure_mock(side_effect=lambda _n: ('exited', A_IMAGE)),
            'docker unknown': lambda: self.mocks['container_identity'].configure_mock(side_effect=lambda _n: seal.die('docker unknown')),
            'request retained': lambda: (self.request_root / f'{DEAD_RUN}.request').write_text('x'),
            'intent retained': lambda: (self.request_root / f'{DEAD_RUN}.intent').write_text('x'),
            'unit active': lambda: self.unit('release', 'service', ActiveState='active', SubState='running', MainPID='42'),
            'unit control pid': lambda: self.unit('intake', 'service', ControlPID='7'),
            'unit queued job': lambda: self.unit('intake', 'path', Job='12'),
            'unit enabled': lambda: self.unit('release', 'service', LoadState='loaded', UnitFileState='enabled'),
            'unit masked': lambda: self.unit('intake', 'service', LoadState='masked'),
            'systemd unknown': lambda: self.mocks['native_unit'].configure_mock(side_effect=lambda _u: seal.die('bus unavailable')),
            'durable failure differs': lambda: seal.write_json_atomic(seal.result_path(DEAD_RUN), {**self.failure, 'completedAt': 1}),
        }
        for name, arrange in cases.items():
            with self.subTest(name):
                self.setUp_again()
                arrange()
                before = seal.STATE_FILE.read_bytes()
                outcome = self.resolve_or_refusal()
                self.assertNotEqual(outcome, DEAD_RUN)
                self.assertNotIn(DEAD_RUN, seal.load_state().get('routineFailureResolutions', {}))
                if name != 'durable failure differs':
                    self.assertEqual(seal.STATE_FILE.read_bytes(), before)
                self.refused(self.owner)

    def test_recorded_resolution_must_match_its_original_cycle_exactly(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        good = seal.load_state()
        for name, mutate in {
            'changed cycle': lambda r: r['originalCycle'].update(sha=A_SHA),
            'self verified': lambda r: r.update(verifiedByRunId=DEAD_RUN),
            'extra field': lambda r: r.update(note='x'),
            'wrong result': lambda r: r.update(result='retired'),
            'before window end': lambda r: r.update(observedAt=self.cycle['startsAt']),
        }.items():
            with self.subTest(name):
                state = copy.deepcopy(good)
                mutate(state['routineFailureResolutions'][DEAD_RUN])
                seal.write_state(state)
                self.refused(self.owner)
        seal.write_state(good)

    # helpers
    def setUp_again(self):
        seal.write_state(copy.deepcopy(self.base))
        seal.write_json_atomic(seal.result_path(DEAD_RUN), self.failure)
        for p in self.request_root.iterdir():
            p.unlink()
        self.units.clear()
        self.mocks['container_identity'].configure_mock(side_effect=lambda _n: ('running', A_IMAGE))
        self.mocks['native_unit'].configure_mock(side_effect=self.native_unit)
        self.settle(60_000)

    def settle(self, milliseconds):
        seal.TERMINAL_OWNER_SETTLE_MS = milliseconds

    def resolve_or_refusal(self):
        try:
            return self.resolve()
        except SystemExit:
            return 'refused'

    def edit_state(self, **fields):
        state = seal.load_state(); state.update(fields); seal.write_state(state)

    def unit(self, prefix, extension, **fields):
        name = f'club-arena-engine-{prefix}-v1@{DEAD_RUN}.{extension}'
        self.units[name] = {**GONE, 'LoadState': 'loaded', **fields}


if __name__ == '__main__':
    unittest.main()
