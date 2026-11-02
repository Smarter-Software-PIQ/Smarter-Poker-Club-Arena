import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


adapter = load('adapter', 'scripts/ci/native-perf-terminal-diagnostics.py')
helper = load('original', 'scripts/ci/native-perf-install-controller.py')
planner = load('planner', 'scripts/ci/native-perf-install.py')


def fixture():
    receipt = {'validReceipt': True, 'operation': '123', 'sourceSHA256': adapter.INSTALLER,
        'profileSHA256': 'a' * 64, 'profilePurpose': 'production', 'engineSHA': 'b' * 40,
        'originalIdentitySHA256': 'c' * 64, 'sameInvocation': True, 'terminal': True,
        'helperCgroupEmpty': True}
    value = {'schema': adapter.SCHEMA, 'readOnly': True, 'diagnosticReadVerified': True,
        **{key: receipt[key] for key in adapter.BINDINGS}, 'identityControllerSHA256': adapter.NATIVE,
        'planSourceSHA256': adapter.PLAN, 'phase': 'refused',
        'commandFailure': {'command': 'apt_simulation', 'exitCode': 100, 'categories': ['archive_missing'],
            'boundExceeded': False, 'errorWords': ['unable', 'to', 'open', '_']},
        'aptAttemptRecorded': False, 'originalRecordsUnchanged': True,
        'packages': {'verified': False, 'rows': [], 'dpkgAuditClean': None},
        'retryAllowed': False, 'nativeCauseProven': False}
    return receipt, value


class TerminalDiagnostics(unittest.TestCase):
    def test_exact_closed_binding_and_failed_installation_stay_separate(self):
        receipt, value = fixture()
        self.assertEqual(adapter.diagnostic_outcome(json.dumps(value).encode(), receipt, 0, planner, helper), value)
        for key in adapter.BINDINGS:
            forged = copy.deepcopy(value); forged[key] = 'forged'
            self.assertIsNone(adapter.diagnostic_outcome(json.dumps(forged).encode(), receipt, 0, planner, helper))
        for transport in (1, 255, True, None):
            self.assertIsNone(adapter.diagnostic_outcome(json.dumps(value).encode(), receipt, transport, planner, helper))
        for key in ('terminal', 'sameInvocation', 'helperCgroupEmpty'):
            self.assertIsNone(adapter.diagnostic_outcome(json.dumps(value).encode(), {**receipt, key: False}, 0, planner, helper))

    def test_duplicate_extra_private_and_malformed_fields_never_escape(self):
        receipt, value = fixture()
        for raw in [b'x' * 32769, json.dumps(value).encode()[:-1] + b',"phase":"refused"}',
                json.dumps({**value, 'rawLog': '/private/secret'}).encode()]:
            self.assertIsNone(adapter.diagnostic_outcome(raw, receipt, 0, planner, helper))
        for override in [ {'retryAllowed': True}, {'installationVerified': True},
                {'phase': '/private/secret'}, {'commandFailure': {**value['commandFailure'], 'errorWords': ['secret']}},
                {'packages': {'verified': True, 'rows': [{'package': 'private'}], 'dpkgAuditClean': True}} ]:
            self.assertIsNone(adapter.diagnostic_outcome(json.dumps({**value, **override}).encode(), receipt, 0, planner, helper))

    def test_public_package_projection_rejects_unknown_names_and_values(self):
        names = ['libc6', 'linux-tools-common']
        rows = adapter.package_rows(b'libc6:amd64\tinstall ok installed\t2.39-0ubuntu8.6\n',
            b'libc6:\n  Candidate: 2.39-0ubuntu8.6\nlinux-tools-common:\n  Candidate: (none)\n', names, planner.DEBIAN_VERSION)
        self.assertEqual(rows[0]['installedVersion'], '2.39-0ubuntu8.6')
        self.assertEqual(rows[1]['status'], 'absent')
        for status, policy in [(b'secret\tinstall ok installed\t1\n', b''), (b'', b'libc6:\n  Candidate: /secret\n'),
                (b'', b'libc6:\n  Candidate: 1\n  Candidate: 2\n'), (b'', b'')]:
            with self.assertRaises(ValueError):
                adapter.package_rows(status, policy, names, planner.DEBIAN_VERSION)

    def test_reader_keeps_original_record_and_apt_intent_unchanged(self):
        receipt, _ = fixture()
        with tempfile.TemporaryDirectory(prefix='perf-terminal-read-') as temporary:
            folder = Path(temporary)
            profile_raw = (ROOT / 'scripts/ci/native-perf-install-profile.json').read_bytes()
            profile_sha = helper.digest(profile_raw)
            receipt.update(profileSHA256=profile_sha)
            record = {'operation': '123', 'sourceSHA256': adapter.INSTALLER, 'planSourceSHA256': adapter.PLAN,
                'profileSHA256': profile_sha, 'profilePurpose': 'production', 'phase': 'refused',
                'invocation': 'd' * 32, 'target': {'sha': receipt['engineSHA'], 'private': 'never export'}}
            intent = {'operation': '123', 'invocation': 'd' * 32, 'packagePlan': {'linux-tools-common': planner.VERSION}}
            record['packagePlanSHA256'] = helper.digest(json.dumps(intent['packagePlan'], sort_keys=True).encode())
            for name, raw in [('operation.json', json.dumps(record).encode()), ('apt-attempt.json', json.dumps(intent).encode()), ('profile.json', profile_raw)]:
                (folder / name).write_bytes(raw)
            before = {p.name: p.read_bytes() for p in folder.iterdir()}
            fake = SimpleNamespace(**vars(helper))
            fake.read = lambda path, limit=1048576: path.read_bytes()
            fake.receipt = lambda native, op: receipt
            fake.receipt_outcome = lambda *args: receipt
            native = SimpleNamespace()
            with patch.object(adapter, 'trusted_folder', return_value=folder), patch.object(adapter, 'load_original', return_value=(fake, native, planner)), patch.object(adapter, 'packages', return_value={'verified': False, 'rows': [], 'dpkgAuditClean': None}):
                result = adapter.read_terminal('123')
            self.assertTrue(result['originalRecordsUnchanged'])
            self.assertTrue(result['aptAttemptRecorded'])
            self.assertNotIn('private', json.dumps(result))
            self.assertEqual({p.name: p.read_bytes() for p in folder.iterdir()}, before)
            record['packagePlanSHA256'] = '0' * 64
            (folder / 'operation.json').write_text(json.dumps(record))
            with patch.object(adapter, 'trusted_folder', return_value=folder), patch.object(adapter, 'load_original', return_value=(fake, native, planner)), patch.object(adapter, 'packages', return_value={'verified': False, 'rows': [], 'dpkgAuditClean': None}), self.assertRaises(ValueError):
                adapter.read_terminal('123')

    def test_fixed_source_and_no_mutating_entrypoint(self):
        self.assertEqual(helper.digest((ROOT / 'scripts/ci/native-perf-install-controller.py').read_bytes()), adapter.INSTALLER)
        self.assertEqual(helper.digest((ROOT / 'scripts/ci/native-fault-observation.py').read_bytes()), adapter.NATIVE)
        self.assertEqual(helper.digest((ROOT / 'scripts/ci/native-perf-install.py').read_bytes()), adapter.PLAN)
        tree = ast.parse((ROOT / 'scripts/ci/native-perf-terminal-diagnostics.py').read_text())
        attributes = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
        self.assertFalse(attributes & {'write_json', 'write_bytes', 'write_text', 'mkdir', 'unlink', 'rename', 'admit', 'execute', 'stop_post'})


if __name__ == '__main__':
    unittest.main()
