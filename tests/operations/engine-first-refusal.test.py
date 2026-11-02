#!/usr/bin/env python3
"""Actual retained producer and shell traps; no Docker/DB/release side effects."""
import hashlib
import importlib.util
from types import SimpleNamespace
from unittest.mock import patch
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
SEAL = Path(os.environ.get('FIRST_REFUSAL_TEST_SEAL', str(REPO / 'server/scripts/engine-release-seal.py')))
TRANSACTION = REPO / 'server/scripts/engine-release-transaction.sh'


class FirstRefusalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='first-refusal-', dir=os.environ.get('TMPDIR') or (str(REPO) if sys.platform == 'darwin' else None))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.generation = self.root / 'generation'
        self.generation.mkdir(mode=0o700)
        (self.generation / TRANSACTION.name).write_bytes(TRANSACTION.read_bytes())
        (self.generation / SEAL.name).write_bytes(SEAL.read_bytes())
        self.requests = self.root / 'requests'
        self.pins = self.root / 'pins'
        self.requests.mkdir(mode=0o700)
        self.pins.mkdir(mode=0o700)
        self.request = self.requests / '123-1.request'
        self.pin = self.pins / '123-1.generation'
        self.request.write_text(f"{'a'*40}\nhttps://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/123\nactor\n{self.generation}\n{'b'*40}\n1999999999\n")
        self.pin.write_text(f"{self.generation}\n{'b'*40}\n")
        self.request.chmod(0o600)
        self.pin.chmod(0o600)
        self.env = {**os.environ, 'ENGINE_RELEASE_STATE_DIR': str(self.root),
                    'ENGINE_RELEASE_REQUEST_ROOT': str(self.requests),
                    'ENGINE_RELEASE_PIN_ROOT': str(self.pins), 'PYTHONDONTWRITEBYTECODE': '1'}
        self.args = ['--run-id', '123-1', '--sha', 'a'*40, '--control-sha', 'b'*40,
                     '--invocation-id', 'c'*32, '--generation', str(self.generation),
                     '--request', str(self.request), '--pin', str(self.pin),
                     '--run-url', 'https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/123']
        self.record = self.root / 'engine-release-diagnostics/123-1.first-refusal.json'

    def invoke(self, mode='diagnostic-first-refusal', extra=(), args=None):
        return subprocess.run(['python3', str(SEAL), mode, *(args or self.args), *extra], env=self.env,
                              capture_output=True, text=True, timeout=5)

    def test_attempt_missing_terminal_is_unknown_and_not_authority(self):
        self.assertEqual(self.invoke('diagnostic-attempt-begin').returncode, 0)
        attempt = json.loads(next((self.root / 'engine-release-diagnostics').glob('*.json')).read_text())
        self.assertEqual(attempt['terminalObservation'], 'UNKNOWN_UNTIL_FIRST_REFUSAL_OR_CANONICAL_RESULT')
        self.assertFalse(self.record.exists())
        self.assertFalse((self.root / 'engine-release-seal.json').exists())
        self.assertFalse((self.root / 'engine-release-results').exists())

    def test_first_survives_recovery75_retry_cleanup_container_replacement(self):
        self.assertEqual(self.invoke(extra=['--origin', 'die', '--exit-code', '17']).returncode, 0)
        original = self.record.read_bytes()
        args = self.args.copy()
        args[args.index('--invocation-id')+1] = 'd'*32
        self.assertEqual(self.invoke(extra=['--exit-code', '75'], args=args).returncode, 0)
        self.assertEqual(self.record.read_bytes(), original)
        # Request cleanup/container replacement cannot remove retained host evidence.
        self.request.unlink()
        self.pin.unlink()
        self.assertEqual(self.invoke().returncode, 1)
        self.assertEqual(self.record.read_bytes(), original)
        self.assertEqual(self.record.stat().st_mode & 0o777, 0o600)

    def test_private_symlink_corrupt_and_conflicting_identity_refuse(self):
        self.request.chmod(0o644)
        self.assertEqual(self.invoke().returncode, 1)
        self.request.chmod(0o600)
        self.assertEqual(self.invoke().returncode, 0)
        original = self.record.read_bytes()
        changed = self.args.copy()
        changed[changed.index('--sha')+1] = 'e'*40
        self.assertEqual(self.invoke(args=changed).returncode, 1)
        self.assertEqual(self.record.read_bytes(), original)
        self.record.write_text('{}')
        self.assertEqual(self.invoke().returncode, 1)
        self.record.unlink()
        self.record.symlink_to(self.request)
        before = self.request.read_bytes()
        self.assertEqual(self.invoke().returncode, 1)
        self.assertEqual(self.request.read_bytes(), before)

    def shell(self, body):
        text = TRANSACTION.read_text()
        functions = text[text.index('# Persist first observation'):text.index('# The ladder is derived')]
        setup = '\n'.join([
            'set -Eeuo pipefail', f'RELEASE_SEAL={SEAL}', 'RUN_ID=123-1', 'SHA='+'a'*40,
            'CONTROL_SHA='+'b'*40, 'INVOCATION_ID='+'c'*32,
            f'CONTROL_DIR={self.generation}', f'REQUEST_FILE={self.request}',
            'RUN_URL=https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/123',
            f'DIAGNOSTIC_PIN_FILE={self.pin}', functions, 'DIAGNOSTIC_READY=1',
            '''trap 'diagnostic_err "$-" "$?" "$LINENO" "${FUNCNAME[0]:-UNKNOWN}"' ERR''',
            'trap diagnostic_exit_fallback EXIT', body])
        return subprocess.run(['bash', '-c', setup], env=self.env, text=True, capture_output=True, timeout=8)

    def test_pipeline_function_substitution_die_and_explicit_exit(self):
        for body, rc, origin in [('false | true', 1, 'err'),
                                 ('f(){ return 19; }; f', 19, 'err'),
                                 ('x="$(exit 23)"', 23, 'err'),
                                 ('die "private-secret-must-not-be-recorded"', 1, 'die'),
                                 ('exit 75', 75, 'exit')]:
            with self.subTest(body=body):
                if self.record.exists(): self.record.unlink()
                result = self.shell(body)
                self.assertEqual(result.returncode, rc, result.stderr)
                record = json.loads(self.record.read_text())
                self.assertEqual(record['exitCode'], rc)
                self.assertEqual(record['origin'], origin)
                self.assertNotIn('private-secret', self.record.read_text())
                self.assertEqual(record['signal'], 'UNKNOWN')

    def read_retained(self):
        return subprocess.run(['python3', '-B', str(SEAL), 'diagnostic-read', '--run-id', '123-1',
                               '--sha', 'a'*40, '--control-sha', 'b'*40, '--generation', str(self.generation),
                               '--invocation-id', 'c'*32], env=self.env, capture_output=True, text=True, timeout=5)

    def test_retained_read_after_cleanup_no_source_or_authority_mutation(self):
        self.assertEqual(self.invoke(extra=['--origin', 'die', '--exit-code', '41']).returncode, 0)
        original = self.record.read_bytes()
        self.request.unlink()
        self.pin.unlink()
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.read_retained()
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertTrue(value['diagnosticOnly'])
        self.assertEqual(value['firstRefusal']['exitCode'], 41)
        self.assertEqual(self.record.read_bytes(), original)
        self.assertEqual(before, {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        (self.generation / TRANSACTION.name).write_text('changed source')
        self.assertEqual(self.read_retained().returncode, 1)

    def test_retained_attempt_without_refusal_remains_unknown(self):
        self.assertEqual(self.invoke('diagnostic-attempt-begin').returncode, 0)
        self.request.unlink()
        self.pin.unlink()
        result = self.read_retained()
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value['observation'], 'UNKNOWN_NO_REFUSAL_RECORDED')
        self.assertIsNone(value['firstRefusal'])
        self.assertEqual(value['attempt']['terminalObservation'], 'UNKNOWN_UNTIL_FIRST_REFUSAL_OR_CANONICAL_RESULT')

    def test_same_size_changed_input_metadata_is_refused(self):
        spec = importlib.util.spec_from_file_location('diagnostic_seal_test', SEAL)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        real = os.stat(self.request)
        calls = [real, SimpleNamespace(st_dev=real.st_dev, st_ino=real.st_ino, st_size=real.st_size,
                                       st_mtime_ns=real.st_mtime_ns+1, st_ctime_ns=real.st_ctime_ns)]
        with patch.object(module.os, 'fstat', side_effect=calls):
            with self.assertRaisesRegex(ValueError, 'changed'):
                module.diagnostic_read(self.request)

    def test_expected_probes_do_not_replace_later_actual_refusal(self):
        result = self.shell('set +e; x="$(exit 2)"; probe=$?; false; set -e; f(){ return 4; }; if ! f; then :; fi; if x="$(exit 6)"; then :; fi; exit 37')
        self.assertEqual(result.returncode, 37)
        self.assertEqual(json.loads(self.record.read_text())['exitCode'], 37)
        self.assertEqual(json.loads(self.record.read_text())['origin'], 'exit')

    def test_duplicate_keys_and_wrong_validated_url_refuse(self):
        self.assertEqual(self.invoke().returncode, 0)
        value = self.record.read_text()
        self.record.write_text(value.replace('"exitCode":1', '"exitCode":2,"exitCode":1'))
        self.assertEqual(self.invoke().returncode, 1)
        self.record.unlink()
        args = self.args.copy()
        args[args.index('--run-url')+1] = 'https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/124'
        self.assertEqual(self.invoke(args=args).returncode, 1)
        self.assertFalse(self.record.exists())

    def test_known_selected_inputs_zero_and_unknown_remain_distinct(self):
        (self.root / 'engine-release-seal.json').write_text('{"desired":{"sha":"' + 'e'*40 + '"}}')
        (self.root / 'engine-release-seal.json').chmod(0o600)
        deadline = self.request.with_suffix('.break-deadline')
        deadline.write_text('1999999999\n')
        deadline.chmod(0o600)
        result = self.shell("LEGACY_CHECKPOINT_REQUIRED=1; DRAINED_PREDECESSOR_CUTOVER=0; LEGACY_CHECKPOINT_PROFILE=eed-80s-v1; LEGACY_CHECKPOINT_BUDGET_SECONDS=80; LEGACY_CHECKPOINT_WORK_MS=65000; PREPARED=0; MUTATION_STARTED=0; LOCK_HELD=1; CHECKPOINT_PREDECESSOR_SHA=" + 'e'*40 + "; CERTIFICATE_RC=2; BREAK_END_EPOCH=1999999999; exit 31")
        self.assertEqual(result.returncode, 31)
        value = json.loads(self.record.read_text())
        self.assertEqual(value['shellState']['prepared'], 0)
        self.assertEqual(value['shellState']['checkpointProfile'], 'eed-80s-v1')
        self.assertEqual(value['shellState']['checkpointBudgetSeconds'], 80)
        self.assertEqual(value['shellState']['checkpointRequired'], 1)
        self.assertEqual(value['shellState']['drainedCutover'], 0)
        self.assertEqual(value['predecessor']['selectedSha'], 'e'*40)
        self.assertEqual(value['certificate']['deadlineSha256'], hashlib.sha256(deadline.read_bytes()).hexdigest())
        self.assertEqual(value['certificate']['exitStatus'], 2)
        self.record.unlink()
        self.assertEqual(self.invoke().returncode, 0)
        self.assertEqual(json.loads(self.record.read_text())['shellState']['prepared'], 'UNKNOWN')
        self.record.unlink()
        self.assertEqual(self.invoke(extra=['--checkpoint-profile', 'arbitrary-secret']).returncode, 1)
        self.assertFalse(self.record.exists())

    def test_sigkill_is_not_fabricated_as_a_captured_refusal(self):
        self.assertEqual(self.invoke('diagnostic-attempt-begin').returncode, 0)
        result = self.shell('kill -KILL $$')
        self.assertEqual(result.returncode, -9)
        self.assertFalse(self.record.exists())
        self.assertEqual(len(list((self.root / 'engine-release-diagnostics').glob('*.attempt-*.json'))), 1)

    def test_diagnostic_failure_does_not_recurse_or_change_exit(self):
        self.record.parent.mkdir(mode=0o700)
        self.record.symlink_to(self.request)
        before = self.request.read_bytes()
        result = self.shell('f(){ return 29; }; f')
        self.assertEqual(result.returncode, 29)
        self.assertIn('UNKNOWN', result.stderr)
        self.assertLess(len(result.stderr), 2000)
        self.assertEqual(self.request.read_bytes(), before)

    def test_producer_precedes_recovery_and_preserves_original_rc(self):
        text = TRANSACTION.read_text()
        recover = text[text.index('recover_on_exit()'):text.index('trap recover_on_exit EXIT')]
        self.assertLess(recover.index('diagnostic_refusal exit'), recover.index('rm -f'))
        self.assertLess(recover.index('diagnostic_refusal exit'), recover.index('release_lightning_hold'))
        self.assertIn('exit "$rc"', recover)
        result = self.shell('trap \'rc=$?; diagnostic_refusal exit "$rc" 0 UNKNOWN; rm -f "$REQUEST_FILE" "$DIAGNOSTIC_PIN_FILE"; exit "$rc"\' EXIT; exit 37')
        self.assertEqual(result.returncode, 37)
        self.assertEqual(json.loads(self.record.read_text())['exitCode'], 37)


if __name__ == '__main__':
    unittest.main()
