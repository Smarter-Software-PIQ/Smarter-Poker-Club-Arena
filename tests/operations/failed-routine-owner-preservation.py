#!/usr/bin/env python3
"""Real seal subprocess regressions; isolated files only, no production IO."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
SEAL = ROOT / 'server/scripts/engine-release-seal.py'
DEAD_RUN = '555000111-1'
NEXT_RUN = '666000222-1'
A_SHA, B_SHA = 'a' * 40, 'b' * 40
A_IMAGE = 'sha256:' + 'a' * 64


class FailedRoutineOwnerPreservation(unittest.TestCase):
    def setUp(self):
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        self.temporary = tempfile.TemporaryDirectory(prefix='failed-owner-custody-', dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state_dir = self.root / 'state'
        self.results = self.root / 'results'
        self.bin = self.root / 'bin'
        for p in (self.state_dir, self.results, self.bin, self.root / 'repo'):
            p.mkdir()
        self.state_path = self.state_dir / 'seal.json'
        self.audit_path = self.state_dir / 'audit.jsonl'
        self.result_path = self.results / (DEAD_RUN + '.json')
        self.native_log = self.root / 'native-probes.jsonl'
        systemctl = self.bin / 'systemctl'
        systemctl.write_text('''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['NATIVE_PROBE_LOG'], 'a') as f:
    f.write(json.dumps(sys.argv[1:])+'\\n')
sys.stderr.write(os.environ.get('SYSTEMCTL_ERROR', ''))
raise SystemExit(int(os.environ.get('SYSTEMCTL_EXIT', '1')))
''')
        systemctl.chmod(0o700)
        self.env = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ.get('PATH', ''),
            'PYTHONDONTWRITEBYTECODE': '1', 'NATIVE_PROBE_LOG': str(self.native_log),
            'ENGINE_RELEASE_STATE_DIR': str(self.state_dir),
            'ENGINE_RELEASE_STATE_FILE': str(self.state_path),
            'ENGINE_RELEASE_AUDIT_FILE': str(self.audit_path),
            'ENGINE_RELEASE_RESULT_DIR': str(self.results),
            'ENGINE_RELEASE_LOCK_FILE': str(self.root / 'seal.lock')}
        start = (int(time.time()) // 3600 - 2) * 3600
        self.failure = {'schema': 1, 'runId': DEAD_RUN, 'result': 'failed', 'sha': B_SHA,
            'controlSha': B_SHA, 'invocationId': 'f' * 32, 'transactionExitStatus': 70,
            'recoveredDesiredSha': A_SHA, 'recoveredDesiredImageId': A_IMAGE,
            'completedAt': start - 60}
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': 'd' * 64, 'startsAt': start, 'endsAt': start + 300,
            'runId': DEAD_RUN, 'sha': B_SHA, 'controlSha': B_SHA,
            'status': 'reserved', 'failure': self.failure}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE,
            'legacyUnlabelled': False}, 'highWaterSha': A_SHA, 'committedRuns': {},
            'pending': None, 'finalization': None, 'generation': 1, 'updatedAt': start,
            'routineMaintenanceCycles': {str(start): self.cycle}}
        self.audit_path.write_text('{"event":"original_fixture_receipt"}\n')
        self.result_path.write_text(json.dumps(self.failure, indent=2) + '\n')
        self.write_state(self.base)

    def write_state(self, state):
        self.state_path.write_text(json.dumps(state, indent=2) + '\n')

    def snapshot(self):
        return {p: p.read_bytes() for p in (self.state_path, self.audit_path, self.result_path)}

    def invoke(self, action, run_id=NEXT_RUN, **environment):
        args = [sys.executable, '-B', str(SEAL), action, '--run-id', run_id]
        if action == 'reserve-routine-cycle':
            args += ['--repo', str(self.root / 'repo'), '--sha', B_SHA, '--control-sha', B_SHA]
        return subprocess.run(args, env={**self.env, **environment}, capture_output=True,
            text=True, timeout=10)

    def assert_preserved(self, before):
        self.assertEqual(self.snapshot(), before, 'seal/audit/original failure bytes changed')
        self.assertFalse(self.native_log.exists(), 'ownership check probed native unit state')

    def test_expired_failed_foreign_owner_survives_every_is_enabled_outcome(self):
        # Any nonzero exit was previously misread as disabled/cleaned. None is
        # retirement authority; the read-only owner gate must not call it at all.
        for code, diagnostic in [('0', ''), ('1', 'disabled'),
                ('1', 'Failed to connect to bus: No such file or directory'),
                ('4', 'Unit is unknown'), ('126', 'Permission denied')]:
            with self.subTest(exit=code, diagnostic=diagnostic):
                before = self.snapshot()
                result = self.invoke('check-routine-owner', SYSTEMCTL_EXIT=code,
                    SYSTEMCTL_ERROR=diagnostic)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn('foreign pending or unknown routine cycle owner remains authoritative', result.stderr)
                self.assert_preserved(before)
                state = json.loads(self.state_path.read_text())
                self.assertEqual(state['routineMaintenanceCycles'], self.base['routineMaintenanceCycles'])
                self.assertNotIn('retiredRoutineCycles', state)

    def test_new_reservation_cannot_erase_a_failed_foreign_owner(self):
        before = self.snapshot()
        result = self.invoke('reserve-routine-cycle', SYSTEMCTL_EXIT='1', SYSTEMCTL_ERROR='bus unavailable')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('prior pending or unknown routine owner remains authoritative', result.stderr)
        self.assert_preserved(before)

    def test_original_failed_owner_cannot_self_replay(self):
        before = self.snapshot()
        result = self.invoke('reserve-routine-cycle', DEAD_RUN)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('original routine failure retains unresolved cleanup/custody ownership', result.stderr)
        self.assert_preserved(before)

    def test_nonempty_or_malformed_retirement_history_refuses_without_reconstruction(self):
        retired = {str(self.cycle['startsAt']): {**self.cycle,
            'retiredAt': self.cycle['endsAt'] + 60, 'retiredBy': 'expired-terminal-failure'}}
        for history in (retired, {'unexpected': {}}, None, [], ['unverified'], '', 'unverified', 0, False):
            for cycles in (self.base['routineMaintenanceCycles'], {}):
                with self.subTest(history=history, has_cycle=bool(cycles)):
                    state = copy.deepcopy(self.base)
                    state.update(retiredRoutineCycles=history, routineMaintenanceCycles=cycles)
                    self.write_state(state)
                    for action in ('check-routine-owner', 'reserve-routine-cycle'):
                        before = self.snapshot()
                        result = self.invoke(action)
                        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                        self.assertIn('retiredRoutineCycles', result.stderr)
                        self.assertIn('custody', result.stderr)
                        self.assert_preserved(before)

    def test_absent_or_empty_retirement_history_preserves_valid_owner_reads(self):
        for has_history in (False, True):
            for has_cycle in (False, True):
                with self.subTest(history=has_history, cycle=has_cycle):
                    state = copy.deepcopy(self.base)
                    if has_history:
                        state['retiredRoutineCycles'] = {}
                    if not has_cycle:
                        state['routineMaintenanceCycles'] = {}
                    self.write_state(state)
                    before = self.snapshot()
                    result = self.invoke('check-routine-owner', DEAD_RUN)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(result.stdout.strip(), 'owned' if has_cycle else 'none')
                    self.assert_preserved(before)


if __name__ == '__main__':
    unittest.main()
