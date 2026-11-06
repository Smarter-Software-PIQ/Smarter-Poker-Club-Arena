#!/usr/bin/env python3
"""A committed owner parked by unreadable request bytes is restarted, never replaced.

Production 2026-11-06: run 42190145714-1 sealed a6a4dd17, then its exact desired
recovery raised 'retirement source file is unsafe' on its hard-linked request
and parked failed while owning finalization and its routine cycle.
"""
import argparse
import contextlib
import copy
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('seal', str(ROOT / 'server/scripts/engine-release-seal.py'))
seal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seal)
SHA = 'a' * 40
CONTROL = 'c' * 40
IMAGE = 'sha256:' + 'b' * 64
OWNER = '42190145714-1'
CALLER = '42199305508-1'


class ParkedCommittedOwner(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='parked-committed-owner-')
        self.root = Path(self.temp.name).resolve()
        self.addCleanup(self.temp.cleanup)
        for name, path in [('STATE_DIR', self.root), ('STATE_FILE', self.root / 'seal.json'),
                           ('RESULT_DIR', self.root / 'results'), ('AUDIT_FILE', self.root / 'audit.jsonl'),
                           ('LOCK_FILE', self.root / 'seal.lock')]:
            p = patch.object(seal, name, path); p.start(); self.addCleanup(p.stop)
        p = patch.object(seal, 'ROOT_UID', os.getuid()); p.start(); self.addCleanup(p.stop)
        self.engine_lock = self.root / 'engine.lock'
        self.fd = os.open(self.engine_lock, os.O_RDWR | os.O_CREAT, 0o600)
        self.addCleanup(os.close, self.fd)
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        self.requests = self.root / 'engine-release-requests'; self.requests.mkdir(mode=0o700)
        self.pins = self.root / 'engine-release-generation-pins'; self.pins.mkdir(mode=0o700)
        p = patch.dict(os.environ, {'ENGINE_LOCK_FILE': str(self.engine_lock),
                                    'ENGINE_RELEASE_REQUEST_ROOT': str(self.requests),
                                    'ENGINE_RELEASE_PIN_ROOT': str(self.pins)})
        p.start(); self.addCleanup(p.stop)
        self.generation = self.root / 'generations' / CONTROL
        self.generation.mkdir(parents=True)
        (self.generation / 'control-sha').write_text(CONTROL + '\n')
        # The exact pinned 3169b577 read_private rule that cannot read a linked request.
        (self.generation / 'engine-supervisor.sh').write_text(
            "def read_private(path, private=True):\n"
            "        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or s.st_size > 131072 or s.st_mode & (0o077 if private else 0o022):\n")
        self.payload = '\n'.join([SHA, 'https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/actions/runs/42190145714',
                                  'github-actions[bot]', str(self.generation), CONTROL, '1793967358']) + '\n'
        self.request = self.requests / (OWNER + '.request')
        self.intent = self.requests / (OWNER + '.intent')
        self.private(self.intent, self.payload)
        os.link(self.intent, self.request)
        self.private(self.pins / (OWNER + '.generation'), f'{self.generation}\n{CONTROL}\n')
        self.state = {'schema': 1, 'generation': 316,
                      'desired': {'sha': SHA, 'imageId': IMAGE, 'legacyUnlabelled': False},
                      'highWaterSha': SHA, 'pending': None,
                      'committedRuns': {OWNER: {'sha': SHA, 'imageId': IMAGE}},
                      'finalization': {'runId': OWNER, 'sha': SHA, 'imageId': IMAGE},
                      'updatedBy': {'actor': 'github-actions[bot]', 'runId': OWNER}, 'updatedAt': 1793959327}
        seal.write_state(copy.deepcopy(self.state))
        self.unit = {'LoadState': 'loaded', 'ActiveState': 'failed', 'SubState': 'failed', 'MainPID': '0',
                     'ControlPID': '0', 'Job': '', 'InvocationID': '', 'ControlGroup': '', 'UnitFileState': 'enabled'}
        self.commands = []
        for target, effect in (('native_unit', lambda unit: dict(self.unit)),
                               ('run', lambda command: self.commands.append(command) or '')):
            p = patch.object(seal, target, side_effect=effect); p.start(); self.addCleanup(p.stop)

    def private(self, path, text):
        path.write_text(text); path.chmod(0o600)

    def invoke(self, run_id=CALLER):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            seal.cmd_restart_parked_committed_owner(argparse.Namespace(run_id=run_id, engine_lock_fd=self.fd))
        return out.getvalue().strip()

    def assert_untouched(self):
        self.assertEqual(self.request.stat().st_nlink, 2)
        self.assertEqual(self.commands, [])
        self.assertEqual(seal.load_state()['finalization'], self.state['finalization'])

    def test_parked_owner_gets_its_identical_request_on_its_own_inode_and_is_restarted(self):
        before = self.request.stat()
        self.assertEqual(self.invoke(), f'restarted {OWNER}')
        after, intent = self.request.stat(), self.intent.stat()
        self.assertEqual((after.st_ino, after.st_nlink), (before.st_ino, 1))
        self.assertNotEqual(intent.st_ino, before.st_ino)
        self.assertEqual(intent.st_nlink, 1)
        self.assertEqual(oct(intent.st_mode & 0o777), '0o600')
        self.assertEqual(self.request.read_text(), self.payload)
        self.assertEqual(self.intent.read_text(), self.payload)
        self.assertEqual(self.commands, [['systemctl', 'reset-failed', f'club-arena-engine-release-v1@{OWNER}.service'],
                                         ['systemctl', 'start', '--no-block', f'club-arena-engine-release-v1@{OWNER}.service']])
        # Never a result, seal field or authorship claim: the owner finalizes itself.
        self.assertEqual(json.loads(seal.STATE_FILE.read_text())['finalization'], self.state['finalization'])
        self.assertFalse(seal.result_path(OWNER).exists())
        events = [json.loads(line) for line in seal.AUDIT_FILE.read_text().splitlines()]
        self.assertEqual([e['event'] for e in events], ['parked_committed_owner_restarted'])
        self.assertEqual(events[0]['owner'], OWNER)
        self.assertEqual(sorted(p.name for p in self.requests.iterdir()), [OWNER + '.intent', OWNER + '.request'])
        # A second pass finds an unshared request and leaves everything alone.
        self.commands.clear()
        self.assertEqual(self.invoke(), 'not-needed')
        self.assertEqual(self.commands, [])

    def test_live_queued_or_unknown_owner_keeps_its_own_recovery(self):
        for change in ({'ActiveState': 'activating', 'SubState': 'start', 'MainPID': '7'},
                       {'ActiveState': 'activating', 'SubState': 'auto-restart'},
                       {'Job': '91'}, {'ControlPID': '9'}, {'LoadState': 'not-found'}):
            with self.subTest(change=change):
                self.unit.update(change)
                self.assertEqual(self.invoke(), 'not-needed'); self.assert_untouched()
                self.setUp_unit()

    def setUp_unit(self):
        self.unit = {'LoadState': 'loaded', 'ActiveState': 'failed', 'SubState': 'failed', 'MainPID': '0',
                     'ControlPID': '0', 'Job': '', 'InvocationID': '', 'ControlGroup': '', 'UnitFileState': 'enabled'}

    def test_owner_bytes_that_read_their_own_link_finish_on_retry(self):
        with (self.generation / 'engine-supervisor.sh').open('a') as f:
            f.write('def sibling_intent_link(path, s):\n')
        self.assertEqual(self.invoke(), 'not-needed'); self.assert_untouched()

    def test_no_foreign_authority(self):
        self.assertEqual(self.invoke(OWNER), 'not-needed'); self.assert_untouched()
        state = copy.deepcopy(self.state); state['finalization'] = None
        seal.write_state(state)
        self.assertEqual(self.invoke(), 'not-needed'); self.assert_untouched_files()

    def assert_untouched_files(self):
        self.assertEqual(self.request.stat().st_nlink, 2); self.assertEqual(self.commands, [])

    def test_existing_result_or_pending_work_is_not_parked(self):
        seal.RESULT_DIR.mkdir(exist_ok=True); seal.result_path(OWNER).write_text('{}')
        self.assertEqual(self.invoke(), 'not-needed'); self.assert_untouched()

    def test_foreign_link_mismatched_pin_or_shared_root_refuses(self):
        alias = self.root / 'alias'; os.link(self.request, alias)
        with self.assertRaises(SystemExit): self.invoke()
        alias.unlink(); self.assertEqual(self.commands, [])
        self.private(self.pins / (OWNER + '.generation'), f'{self.generation}\n{"f" * 40}\n')
        with self.assertRaises(SystemExit): self.invoke()
        self.private(self.pins / (OWNER + '.generation'), f'{self.generation}\n{CONTROL}\n')
        self.requests.chmod(0o750)
        with self.assertRaises(SystemExit): self.invoke()
        self.requests.chmod(0o700)
        self.intent.chmod(0o644)
        with self.assertRaises(SystemExit): self.invoke()
        self.intent.chmod(0o600)
        self.assert_untouched()


if __name__ == '__main__':
    unittest.main()
