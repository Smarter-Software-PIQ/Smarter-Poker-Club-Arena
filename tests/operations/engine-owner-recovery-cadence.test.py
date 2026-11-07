#!/usr/bin/env python3
"""Actual seal reservation with disposable Git and durable terminal receipts."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'server/scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


seal = module('cadence_seal', 'engine-release-seal.py')


class OwnerRecoveryCadence(unittest.TestCase):
    def setUp(self):
        clean = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        clean.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
        self.enterContext(patch.dict(os.environ, clean, clear=True))
        self.temp = tempfile.TemporaryDirectory(prefix='owner-cadence-')
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'core.hooksPath', str(self.repo / 'no-hooks'))
        self.git('config', 'user.name', 'Isolated fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        path = self.repo / 'server/scripts/engine-release-seal.py'
        path.parent.mkdir(parents=True)
        path.write_bytes((ROOT / 'server/scripts/engine-release-seal.py').read_bytes())
        self.base = self.commit()
        self.now = 1800001200
        (self.repo / 'server/candidate').write_text('qualified next source')
        self.target = self.commit()
        self.state = {'desired': {'sha': self.base}, 'highWaterSha': self.base,
                      'pending': None, 'finalization': None}
        self.state_dir = self.repo / 'state'; self.state_dir.mkdir()
        self.results = self.state_dir / 'engine-release-results'; self.results.mkdir()
        for key, value in [('STATE_DIR', self.state_dir), ('RESULT_DIR', self.results),
                           ('LOCK_FILE', self.repo / 'seal.lock')]:
            self.enterContext(patch.object(seal, key, value))
        self.enterContext(patch.object(seal, 'load_state', return_value=self.state))
        self.enterContext(patch.object(seal, 'audit_once'))
        self.enterContext(patch.object(seal.time, 'time', return_value=self.now))
        self.args = argparse.Namespace(sha=self.target, run_id='902-1', repo=str(self.repo), cause='urgent',
            control_sha=self.target, scheduled_cycle_start=None, include_eligibility=True)
        self.prior = {'runId': '901-1', 'sha': self.target, 'announcedAt': (self.now - 600) * 1000, 'cause': 'urgent'}
        self.reservation = self.state_dir / 'engine-recovery-window-901-1.json'
        self.reservation.write_text(json.dumps(self.prior))
        self.failure = {'schema': 1, 'runId': '901-1', 'result': 'failed', 'sha': self.target,
                        'controlSha': self.target, 'invocationId': 'a' * 32, 'transactionExitStatus': 1,
                        'recoveredDesiredSha': self.base, 'recoveredDesiredImageId': 'sha256:' + 'b' * 64,
                        'completedAt': self.now - 100}
        (self.results / '901-1.json').write_text(json.dumps(self.failure))

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True).strip()

    def commit(self):
        self.git('add', 'server'); self.git('commit', '-qm', 'isolated fixture')
        sha = self.git('rev-parse', 'HEAD'); self.git('update-ref', 'refs/remotes/origin/main', sha)
        return sha

    def reserve(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output): seal.cmd_reserve_recovery_window(self.args)
        return output.getvalue().strip()

    def test_completed_engine_recovery_does_not_impose_an_extra_hour(self):
        for cause in ('urgent', 'engine-degraded'):
            with self.subTest(cause=cause):
                self.args.cause = cause
                self.assertEqual(self.reserve(), str(self.now * 1000))
                self.assertEqual(json.loads(self.reservation.read_text()), self.prior)
                self.assertEqual(self.reserve(), str(self.now * 1000))
                (self.state_dir / 'engine-recovery-window-902-1.json').unlink()

    def test_successful_sealed_window_also_has_a_known_terminal_outcome(self):
        runtime = {'instanceId': '1-1234abcd', 'containerId': 'c' * 64,
                   'startedAt': '2027-01-15T08:10:00Z', 'invocationId': 'd' * 32}
        result = {'schema': 1, 'runId': '901-1', 'result': 'sealed', 'sha': self.target,
                  'imageId': 'sha256:' + 'b' * 64, 'controlSha': self.target,
                  **{k: v for k, v in runtime.items() if k != 'invocationId'},
                  'invocationIds': [runtime['invocationId']], 'completionRuntime': runtime,
                  'completedAt': self.now - 100}
        (self.results / '901-1.json').write_text(json.dumps(result))
        self.assertEqual(self.reserve(), str(self.now * 1000))

    def test_database_only_reader_preserves_its_original_rolling_hour(self):
        self.assertEqual(seal.recovery_window_eligibility('902-1', self.now * 1000),
                         ('901-1', self.prior['announcedAt'] + 3600000))
        self.assertEqual(seal.recent_recovery_window('902-1', self.now * 1000), '901-1')
        self.assertEqual(self.reserve(), str(self.now * 1000))

    def test_unknown_or_unfinished_previous_window_does_not_qualify(self):
        (self.results / '901-1.json').unlink()
        self.assertTrue(self.reserve().startswith('rate-limited:'))
        (self.results / '901-1.json').write_text(json.dumps(self.failure))
        self.prior['announcedAt'] = (self.now - 419) * 1000
        self.reservation.write_text(json.dumps(self.prior))
        self.assertTrue(self.reserve().startswith('rate-limited:'))

    def test_corrupt_or_foreign_terminal_receipt_never_qualifies(self):
        for change in ({'runId': '999-1'}, {'sha': 'c' * 40}, {'result': 'unknown'}, {'completedAt': self.now + 1}):
            with self.subTest(change=change):
                (self.results / '901-1.json').write_text(json.dumps({**self.failure, **change}))
                with self.assertRaises(SystemExit): self.reserve()
                self.assertFalse((self.state_dir / 'engine-recovery-window-902-1.json').exists())

    def test_absent_or_unrecognized_cause_cannot_create_an_engine_window(self):
        self.args.cause = None
        self.assertEqual(self.reserve(), 'unavailable')
        self.args.cause = 'routine'
        with self.assertRaises(SystemExit): self.reserve()
        self.assertFalse((self.state_dir / 'engine-recovery-window-902-1.json').exists())

    def test_pending_or_finalizing_owner_cannot_be_bypassed(self):
        for key in ('pending', 'finalization'):
            with self.subTest(key=key), patch.dict(self.state, {key: {'runId': '901-1'}}):
                self.assertEqual(self.reserve(), 'unavailable')

    def test_nov7_unreviewed_target_cannot_consume_global_claim(self):
        self.args.nov7_owner = True
        self.args.deadline = 1794084300
        self.enterContext(patch.object(seal, 'NOV7_PREDECESSOR', self.base))
        self.enterContext(patch.object(seal.time, 'time', return_value=1794064800))
        self.reservation.unlink()
        with self.assertRaises(SystemExit):
            self.reserve()
        self.assertFalse((self.state_dir / seal.NOV7_OWNER_CLAIM).exists())

    def test_nov7_one_announcement_across_runs_targets_and_unknown_outcome(self):
        self.enterContext(patch.object(seal, 'require_nov7_reservation_authority'))
        self.args.nov7_owner = True
        self.enterContext(patch.object(seal, 'NOV7_PREDECESSOR', self.base))
        self.assertEqual(self.reserve(), str(self.now * 1000))
        claim = self.state_dir / seal.NOV7_OWNER_CLAIM
        self.assertEqual(json.loads(claim.read_text())['runId'], '902-1')
        self.assertEqual(self.reserve(), 'unavailable')
        (self.state_dir / 'engine-recovery-window-902-1.json').unlink()
        # A crash after the claim but before the per-run receipt is UNKNOWN.
        self.assertEqual(self.reserve(), 'unavailable')
        self.args.run_id = '903-1'
        (self.repo / 'server/candidate').write_text('another protected descendant')
        self.args.sha = self.commit()
        self.assertEqual(self.reserve(), 'unavailable')
        self.assertFalse((self.state_dir / 'engine-recovery-window-903-1.json').exists())

    def test_nov7_final_gate_binds_original_run_control_sha_and_active_countdown(self):
        self.enterContext(patch.object(seal, 'require_nov7_reservation_authority'))
        self.args.nov7_owner = True
        self.enterContext(patch.object(seal, 'NOV7_PREDECESSOR', self.base))
        stamp = int(self.reserve())
        self.args.announced_at = stamp
        self.args.promise_floor_proof = None
        self.now += 121
        self.enterContext(patch.object(seal.time, 'time', return_value=self.now))
        presentation = dict(active=True, phase='counting_down', reason='Deployment Recovery',
                            break_id=stamp, break_ends_at=stamp+420000, scheduled_ends_at=stamp+420000)
        health = dict(running=True, releaseSha=self.base, weeklyPayout=None,
                      maintenance=dict(active=True, phase='counting_down', reason='Deployment Recovery',
                                       breakEndsAt=stamp+420000, durableConfirmed=True, presentation=presentation))
        def bind():
            with patch('sys.stdin', io.StringIO(json.dumps(health))), contextlib.redirect_stdout(io.StringIO()):
                seal.cmd_bind_recovery_window(self.args)
        bind()
        with patch.object(self.args, 'control_sha', self.base), self.assertRaises(SystemExit):
            bind()
        with patch.object(self.args, 'run_id', '905-1'), self.assertRaises(SystemExit):
            bind()
        with patch.dict(health['maintenance'], phase='last_hand'), self.assertRaises(SystemExit):
            bind()
        with patch.dict(health, releaseSha=self.target), self.assertRaises(SystemExit):
            bind()

    def test_transaction_keeps_owner_and_cleanup_guards_before_reservation(self):
        source = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        body = source[source.index('request_recovery_window() {'):source.index('persist_break_deadline() {')]
        call = body.index('15s "$RELEASE_SEAL" reserve-recovery-window')
        for required in ('refuse_foreign_floor_owner', 'main-inspector-retirement.py', 'record_floor_runtime_entry announcement-entry'):
            self.assertLess(body.index(required), call)
        self.assertIn('--scheduled-cycle-start "$PHASE1_CYCLE_START" --control-sha "$CONTROL_SHA"', body)
        self.assertTrue('BREAK_CUTOVER_PROOF_SECONDS=150\n' in source)
        self.assertTrue('BREAK_ROLLBACK_RESERVE_SECONDS=135\n' in source)


if __name__ == '__main__':
    unittest.main()
