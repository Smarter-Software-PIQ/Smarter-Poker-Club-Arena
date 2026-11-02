import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import time
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


def unknown_packages():
    names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
    return adapter.package_report({kind: adapter.empty_query(kind, names) for kind in adapter.QUERY_COMMANDS}, names)


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
        'packages': unknown_packages(),
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
        rows = adapter.status_rows(b'libc6:amd64\tinstall ok installed\t2.39-0ubuntu8.6\n', names, planner.DEBIAN_VERSION)
        self.assertEqual(rows[0]['installedVersion'], '2.39-0ubuntu8.6')
        self.assertEqual(rows[1]['status'], 'unknown')
        self.assertFalse(rows[1]['verified'])
        policy = adapter.policy_rows(b'libc6:\n  Candidate: 2.39-0ubuntu8.6\nlinux-tools-common:\n  Candidate: (none)\n', names, planner.DEBIAN_VERSION)
        self.assertTrue(all(row['verified'] for row in policy))
        self.assertIsNone(policy[1]['candidateVersion'])
        for raw in [b'libc6:\n  Candidate: /secret\n', b'libc6:\n  Candidate: 1\n  Candidate: 2\n']:
            with self.assertRaises(ValueError):
                adapter.policy_rows(raw, names, planner.DEBIAN_VERSION)
        rows, malformed = adapter.status_result(b'secret\tinstall ok installed\t1\n', names, planner.DEBIAN_VERSION)
        self.assertTrue(malformed)
        self.assertTrue(all(not row['verified'] for row in rows))

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
            with patch.object(adapter, 'trusted_folder', return_value=folder), patch.object(adapter, 'load_original', return_value=(fake, native, planner)), patch.object(adapter, 'packages', return_value=unknown_packages()):
                result = adapter.read_terminal('123')
            self.assertTrue(result['originalRecordsUnchanged'])
            self.assertTrue(result['aptAttemptRecorded'])
            self.assertNotIn('private', json.dumps(result))
            self.assertEqual({p.name: p.read_bytes() for p in folder.iterdir()}, before)
            record['packagePlanSHA256'] = '0' * 64
            (folder / 'operation.json').write_text(json.dumps(record))
            with patch.object(adapter, 'trusted_folder', return_value=folder), patch.object(adapter, 'load_original', return_value=(fake, native, planner)), patch.object(adapter, 'packages', return_value=unknown_packages()), self.assertRaises(ValueError):
                adapter.read_terminal('123')

    def test_empty_policy_does_not_discard_verified_status_and_audit(self):
        names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
        status = ''.join(name + '\tinstall ok installed\t1.0\n' for name in names).encode()
        native = SimpleNamespace(prerequisite_tool=lambda path: {'available': True, 'reason': 'available'})
        def output(args, **kwargs):
            raw = status if args[0].endswith('dpkg-query') else b''
            return raw
        fake = SimpleNamespace(**vars(helper)); fake.run = output
        import subprocess
        def result(args): return subprocess.CompletedProcess(args, 0, output(args), b'')
        with patch.object(adapter, 'run_read', side_effect=result, create=True):
            value = adapter.packages(fake, native, planner)
        self.assertTrue(value['queries']['status']['verified'])
        self.assertTrue(value['queries']['audit']['verified'])
        self.assertTrue(value['queries']['audit']['auditClean'])
        self.assertFalse(value['queries']['policy']['verified'])
        self.assertEqual(value['queries']['policy']['reason'], 'policy_empty')
        self.assertFalse(value['verified'])
        self.assertEqual(value['rows'], [])

    def test_independent_tool_command_parse_and_partial_failure_are_closed(self):
        import subprocess
        names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
        good_status = ''.join(name + '\tinstall ok installed\t1.0\n' for name in names).encode()
        good_policy = ''.join(name + ':\n  Candidate: 1.0\n' for name in names).encode()
        for mode in ('tool', 'nonzero', 'timeout', 'bound', 'status_parse', 'policy_parse', 'partial_status', 'audit_failed'):
            def tool(path):
                return {'available': False, 'reason': 'missing'} if mode == 'tool' and path.endswith('apt-cache') else {'available': True, 'reason': 'available'}
            def command(args):
                kind = 'status' if args[0].endswith('dpkg-query') else 'policy' if args[0].endswith('apt-cache') else 'audit'
                stdout, stderr, code = good_status if kind == 'status' else good_policy if kind == 'policy' else b'', b'', 0
                if mode == 'nonzero' and kind == 'policy': code, stderr = 100, b'E: could not open /private/secret-token'
                if mode == 'timeout' and kind == 'policy': raise subprocess.TimeoutExpired('private path', 3)
                if mode == 'bound' and kind == 'policy': stderr = b'x' * 65537
                if mode == 'status_parse' and kind == 'status': stdout = b'private malformed status'
                if mode == 'policy_parse' and kind == 'policy': stdout = good_policy.rsplit(names[-1].encode() + b':', 1)[0]
                if mode == 'partial_status' and kind == 'status': code, stdout = 1, good_status.splitlines(keepends=True)[0]
                if mode == 'audit_failed' and kind == 'audit': code, stderr = 2, b'E: private audit-token /private/path'
                return subprocess.CompletedProcess(args, code, stdout, stderr)
            with self.subTest(mode=mode), patch.object(adapter, 'run_read', side_effect=command):
                result = adapter.packages(helper, SimpleNamespace(prerequisite_tool=tool), planner)
                self.assertTrue(adapter.valid_package_report(result, planner, helper))
                self.assertFalse(result['verified'])
                self.assertEqual(result['rows'], [])
                self.assertNotIn('secret-token', json.dumps(result))
                self.assertNotIn('/private', json.dumps(result))
                self.assertTrue(result['queries']['audit']['verified'] if mode != 'audit_failed' else not result['queries']['audit']['verified'])
                if mode not in ('status_parse', 'partial_status'):
                    self.assertTrue(result['queries']['status']['verified'])
                if mode == 'partial_status':
                    self.assertTrue(result['queries']['status']['rows'][0]['verified'])
                    self.assertFalse(result['queries']['status']['rows'][1]['verified'])
                    self.assertEqual(result['queries']['status']['commandFailure']['exitCode'], 1)
                if mode == 'tool': self.assertEqual(result['queries']['policy']['reason'], 'tool_missing')
                if mode == 'nonzero': self.assertEqual(result['queries']['policy']['commandFailure']['exitCode'], 100)
                if mode == 'timeout': self.assertEqual(result['queries']['policy']['reason'], 'command_timeout')
                if mode == 'bound': self.assertTrue(result['queries']['policy']['commandFailure']['boundExceeded'])
                if mode == 'status_parse': self.assertEqual(result['queries']['status']['reason'], 'status_malformed')
                if mode == 'policy_parse': self.assertEqual(result['queries']['policy']['reason'], 'policy_incomplete')

    def test_malformed_status_row_preserves_independent_positive_facts(self):
        names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
        native = SimpleNamespace(prerequisite_tool=lambda path: {'available': True, 'reason': 'available'})
        status = (names[0] + '\tinstall ok installed\t1.0\n' + names[1] + '\tunknown ok not-installed\t\n').encode()
        def command(args):
            return subprocess.CompletedProcess(args, 1 if args[0].endswith('dpkg-query') else 0,
                status if args[0].endswith('dpkg-query') else b'', b'')
        with patch.object(adapter, 'run_read', side_effect=command):
            value = adapter.packages(helper, native, planner)
        query = value['queries']['status']
        self.assertTrue(query['rows'][0]['verified'])
        self.assertEqual(query['rows'][0]['reason'], 'verified')
        self.assertFalse(query['rows'][1]['verified'])
        self.assertEqual(query['rows'][1]['reason'], 'version_missing')
        self.assertEqual(query['rows'][2]['reason'], 'not_observed')
        self.assertFalse(query['verified'])
        self.assertEqual(query['reason'], 'status_malformed')
        self.assertEqual(query['commandFailure']['exitCode'], 1)
        self.assertTrue(adapter.valid_package_report(value, planner, helper))
        self.assertFalse(value['verified'])

    def test_status_rows_close_duplicate_architecture_and_malformed_boundaries(self):
        names = ['libc6', 'libdw1', 'libelf1']
        good = b'libc6:amd64\tinstall ok installed\t1.0\n'
        for suffix, reason in [
                (b'libdw1\tinstall ok installed\t/private/secret\n', 'version_malformed'),
                (b'libdw1\tunknown ok not-installed\t\n', 'version_missing'),
                (b'libdw1\tinvalid private state\t1\n', 'status_malformed'),
                (b'libdw1\tinstall ok installed\n', 'malformed_fields'),
                (b'libdw1:arm64\tinstall ok installed\t1\n', 'unsupported_architecture'),
                (b'libdw1:amd64:private\tinstall ok installed\t1\n', 'unsupported_architecture'),
                (b'libdw1\tinstall ok installed\t\xff\n', 'non_ascii'),
                (b'libdw1\tinstall ok installed\t1\nlibdw1:amd64\tinstall ok installed\t2\n', 'duplicate')]:
            with self.subTest(reason=reason):
                rows, malformed = adapter.status_result(good + suffix, names, planner.DEBIAN_VERSION)
                self.assertTrue(malformed)
                self.assertTrue(rows[0]['verified'])
                self.assertFalse(rows[1]['verified'])
                self.assertEqual(rows[1]['reason'], reason)
                self.assertIsNone(rows[1]['installedVersion'])
                self.assertEqual(rows[2]['reason'], 'not_observed')
                self.assertNotIn('private', json.dumps(rows))
        rows, malformed = adapter.status_result(good + b'foreign-private\tinstall ok installed\t1\n', names, planner.DEBIAN_VERSION)
        self.assertTrue(malformed)
        self.assertTrue(rows[0]['verified'])
        self.assertEqual(rows[1]['reason'], 'not_observed')
        self.assertNotIn('foreign-private', json.dumps(rows))
        rows, malformed = adapter.status_result(good, names, planner.DEBIAN_VERSION)
        self.assertFalse(malformed)  # Normal trailing newline is not another row.

    def test_status_row_reason_packet_cannot_forge_verified_facts(self):
        value = unknown_packages()
        for reason in ('/private/secret', None, ['verified'], 'verified'):
            forged = copy.deepcopy(value)
            forged['queries']['status']['rows'][0]['reason'] = reason
            self.assertFalse(adapter.valid_package_report(forged, planner, helper))

    def test_empty_status_and_policy_never_become_verified_absence(self):
        import subprocess
        native = SimpleNamespace(prerequisite_tool=lambda path: {'available': True, 'reason': 'available'})
        with patch.object(adapter, 'run_read', side_effect=lambda args: subprocess.CompletedProcess(args, 0, b'', b'')):
            result = adapter.packages(helper, native, planner)
        self.assertFalse(result['queries']['status']['verified'])
        self.assertFalse(result['queries']['policy']['verified'])
        self.assertTrue(result['queries']['audit']['auditClean'])
        self.assertTrue(all(row['status'] == 'unknown' and row['installedVersion'] is None for row in result['queries']['status']['rows']))
        forged = copy.deepcopy(result); forged['verified'] = True
        self.assertFalse(adapter.valid_package_report(forged, planner, helper))
        forged = copy.deepcopy(result); forged['queries']['status']['reason'] = '/private/secret'
        self.assertFalse(adapter.valid_package_report(forged, planner, helper))

    def test_dirty_audit_is_a_verified_read_and_never_clean_installation(self):
        names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
        status = ''.join(name + '\tinstall ok installed\t1.0\n' for name in names).encode()
        policy = ''.join(name + ':\n  Candidate: 1.0\n' for name in names).encode()
        native = SimpleNamespace(prerequisite_tool=lambda path: {'available': True, 'reason': 'available'})
        def result(args):
            raw = status if args[0].endswith('dpkg-query') else policy if args[0].endswith('apt-cache') else b'private package audit detail /private/path'
            return subprocess.CompletedProcess(args, 0, raw, b'')
        with patch.object(adapter, 'run_read', side_effect=result):
            value = adapter.packages(helper, native, planner)
        self.assertTrue(value['verified'])
        self.assertFalse(value['dpkgAuditClean'])
        self.assertTrue(adapter.valid_package_report(value, planner, helper))
        self.assertNotIn('private package', json.dumps(value))

    def test_each_tool_metadata_failure_is_distinct_and_keeps_other_queries(self):
        names = sorted(set(planner.TARGETS) | planner.DEPENDENCIES)
        status = ''.join(name + '\tinstall ok installed\t1.0\n' for name in names).encode()
        for reason in ('missing', 'untrusted', 'not-executable', 'unknown'):
            native = SimpleNamespace(prerequisite_tool=lambda path: {'available': False, 'reason': reason} if path.endswith('apt-cache') else {'available': True, 'reason': 'available'})
            with patch.object(adapter, 'run_read', side_effect=lambda args: subprocess.CompletedProcess(args, 0, status if args[0].endswith('dpkg-query') else b'', b'')):
                value = adapter.packages(helper, native, planner)
            self.assertEqual(value['queries']['policy']['stage'], 'tool_metadata')
            self.assertEqual(value['queries']['policy']['reason'], 'tool_' + reason.replace('-', '_'))
            self.assertTrue(value['queries']['status']['verified'])
            self.assertTrue(value['queries']['audit']['verified'])
            self.assertTrue(adapter.valid_package_report(value, planner, helper))

    def test_actual_private_pipe_bound_and_timeout_leave_no_reader_child(self):
        result = adapter.run_read([sys.executable, '-c', 'import sys;sys.stderr.write("x"*70000)'])
        self.assertLessEqual(len(result.stderr), 65537)
        self.assertGreater(len(result.stderr), 65536)
        owned = []
        original = subprocess.Popen
        def child(*args, **kwargs):
            value = original(*args, **kwargs); owned.append(value); return value
        began = time.monotonic()
        with patch.object(adapter.subprocess, 'Popen', side_effect=child), self.assertRaises(subprocess.TimeoutExpired):
            adapter.run_read([sys.executable, '-c', 'import time;time.sleep(4)'])
        self.assertLess(time.monotonic() - began, 3.5)
        self.assertTrue(owned and all(value.poll() is not None for value in owned))

    def test_fixed_source_and_no_mutating_entrypoint(self):
        self.assertEqual(helper.digest((ROOT / 'scripts/ci/native-perf-install-controller.py').read_bytes()), adapter.INSTALLER)
        self.assertEqual(helper.digest((ROOT / 'scripts/ci/native-fault-observation.py').read_bytes()), adapter.NATIVE)
        self.assertEqual(helper.digest((ROOT / 'scripts/ci/native-perf-install.py').read_bytes()), adapter.PLAN)
        tree = ast.parse((ROOT / 'scripts/ci/native-perf-terminal-diagnostics.py').read_text())
        attributes = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
        self.assertFalse(attributes & {'write_json', 'write_bytes', 'write_text', 'mkdir', 'unlink', 'rename', 'admit', 'execute', 'stop_post'})


if __name__ == '__main__':
    unittest.main()
