import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import declaration_guard

TOOL = Path(__file__).resolve().parents[1] / 'declaration_guard.py'
SHA_A = '3529e86663daa427b380a8ab9bd09347270c670e'
SHA_B = '26c2e74930dd0ec05a4a86a62f04e8fe05be04d1'


class TestDeclarationGuard(unittest.TestCase):
    def setUp(self):
        base = os.environ.get('HVH_TEST_TMP')
        self.tmp = tempfile.TemporaryDirectory(dir=base)
        self.obs = Path(self.tmp.name) / 'obs'

    def tearDown(self):
        self.tmp.cleanup()

    def _valid_payload(self, sha=SHA_A):
        return {
            'declaredAt': '2026-11-20T03:00:00Z',
            'window': {'startUtc': '2026-11-20T03:00:00Z', 'halfOpen': True},
            'release': {'sha': sha, 'instanceId': '1-abcdef12'},
            'method': 'TIGHT-MANIAC-METHOD-v1 af0bd14cbae3d66a',
            'expectations_before_outcomes': 'Grade tight and sustained maniac facing wagers before reading outcomes.',
            'selection': {'cells': ['nlh_cash', 'plo4_cash']},
        }

    def test_init_and_verify_roundtrip(self):
        meta = declaration_guard.write_declaration(self.obs, self._valid_payload())
        self.assertTrue(meta['ok'])
        self.assertEqual(meta['releaseSha'], SHA_A)
        checked = declaration_guard.verify_declaration(self.obs, expected_sha=SHA_A)
        self.assertEqual(checked['declarationSha256'], meta['declarationSha256'])

        # Refuses overwriting an existing declaration
        with self.assertRaises(FileExistsError):
            declaration_guard.write_declaration(self.obs, self._valid_payload())

    def test_missing_or_tampered_declaration_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'missing .*DECLARATION.json'):
            declaration_guard.verify_declaration(self.obs)

        declaration_guard.write_declaration(self.obs, self._valid_payload())
        # Wrong expected release SHA
        with self.assertRaisesRegex(ValueError, 'release.sha'):
            declaration_guard.verify_declaration(self.obs, expected_sha=SHA_B)

        # Tamper with DECLARATION.json after freezing DECLARATION.sha256
        os.chmod(self.obs / 'DECLARATION.json', 0o644)
        tampered = self._valid_payload()
        tampered['expectations_before_outcomes'] = 'Changed after peeking at outcomes.'
        (self.obs / 'DECLARATION.json').write_text(json.dumps(tampered), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'sha256 mismatch'):
            declaration_guard.verify_declaration(self.obs, expected_sha=SHA_A)

    def test_missing_selection_and_expectations_is_refused(self):
        bad = self._valid_payload()
        del bad['expectations_before_outcomes']
        del bad['selection']
        with self.assertRaisesRegex(ValueError, 'expectations_before_outcomes, selection, or bars'):
            declaration_guard.write_declaration(self.obs, bad)

    def test_cli_init_and_verify(self):
        payload_file = Path(self.tmp.name) / 'payload.json'
        payload_file.write_text(json.dumps(self._valid_payload()), encoding='utf-8')
        r1 = subprocess.run(
            [sys.executable, '-B', str(TOOL), 'init', str(self.obs), str(payload_file)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(r1.returncode, 0, r1.stderr)
        r2 = subprocess.run(
            [sys.executable, '-B', str(TOOL), 'verify', str(self.obs), SHA_A],
            capture_output=True,
            text=True,
        )
        self.assertEqual(r2.returncode, 0, r2.stderr)
        self.assertTrue(json.loads(r2.stdout)['ok'])


if __name__ == '__main__':
    unittest.main()
