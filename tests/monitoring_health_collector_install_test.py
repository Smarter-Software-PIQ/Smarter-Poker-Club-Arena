"""Real filesystem/lock qualification; systemd is an isolated read-only fixture."""
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('collector_install', Path(__file__).resolve().parents[1] / 'infra/monitoring/install-health-collector.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CollectorInstall(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='collector-install-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source.sh'
        self.destination = self.root / 'stable.sh'
        self.lock = self.root / 'source.lock'
        self.source.write_text('#!/bin/bash\nprintf SHOULD_NOT_EXECUTE\n')
        self.destination.write_text('old collector\n')
        self.expected_current = hashlib.sha256(self.destination.read_bytes()).hexdigest()
        self.calls = []
        self.kind = 'oneshot'
        self.command = f'{{ path=/bin/bash ; argv[]=/bin/bash {self.destination} ; ignore_errors=no ; }}'
        self.timer = True
        original_run = subprocess.run
        def run(args, **kwargs):
            if args[0] != 'systemctl':
                return original_run(args, **kwargs)
            self.calls.append(args)
            self.assertEqual(args, ['systemctl', 'is-active', '--quiet', 'club-arena-money-health.timer'])
            if not self.timer:
                raise subprocess.CalledProcessError(3, args)
            return subprocess.CompletedProcess(args, 0)
        def output(args, **kwargs):
            self.calls.append(args)
            self.assertEqual(args[:3], ['systemctl', 'show', 'club-arena-money-health.service'])
            self.assertEqual(args[-1], '--value')
            return {'--property=Type': self.kind, '--property=ExecStart': self.command}[args[3]]
        self.addCleanup(patch.stopall)
        patch.object(module.subprocess, 'run', side_effect=run).start()
        patch.object(module.subprocess, 'check_output', side_effect=output).start()

    def install(self):
        return module.install(self.source, self.destination, self.lock, self.expected_current, lock_timeout=0.03)

    def test_another_writer_cannot_be_overwritten_after_authorization(self):
        self.destination.write_text('a newer collector\n')
        with self.assertRaisesRegex(RuntimeError, 'advanced after authorization'):
            self.install()
        self.assertEqual(self.destination.read_text(), 'a newer collector\n')
        self.assertEqual(self.calls, [])

    def test_atomic_and_idempotent_without_executing_or_scheduling_anything(self):
        expected = hashlib.sha256(self.source.read_bytes()).hexdigest()
        for _ in range(2):
            self.assertEqual(self.install(), expected)
            self.assertEqual(self.source.read_bytes(), self.destination.read_bytes())
            self.assertEqual(self.destination.stat().st_mode & 0o777, 0o755)
        self.assertFalse(list(self.root.glob('.monitoring-health-*')))
        self.assertEqual(len(self.calls), 6)  # only is-active and two show reads

    def test_busy_source_writer_preserves_original(self):
        with self.lock.open('a') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, 'writer is busy'):
                self.install()
        self.assertEqual(self.destination.read_text(), 'old collector\n')
        self.assertEqual(self.calls, [])

    def test_wrong_service_target_or_type_preserves_original(self):
        for kind, command in [('simple', self.command), ('oneshot', '{ argv[]=/bin/bash /engine.sh ; }')]:
            self.kind, self.command = kind, command
            with self.assertRaises(RuntimeError):
                self.install()
            self.assertEqual(self.destination.read_text(), 'old collector\n')

    def test_inactive_timer_does_not_create_or_enable_one(self):
        self.timer = False
        with self.assertRaises(subprocess.CalledProcessError):
            self.install()
        self.assertEqual(self.destination.read_text(), 'old collector\n')

    def test_symlink_slot_is_never_followed(self):
        other = self.root / 'other'
        other.write_text('untouched')
        self.destination.unlink()
        self.destination.symlink_to(other)
        with self.assertRaisesRegex(RuntimeError, 'regular file'):
            self.install()
        self.assertEqual(other.read_text(), 'untouched')

    def test_invalid_shell_preserves_old_file(self):
        self.source.write_text('if ; then\n')
        with self.assertRaises(subprocess.CalledProcessError):
            self.install()
        self.assertEqual(self.destination.read_text(), 'old collector\n')


if __name__ == '__main__':
    unittest.main()
