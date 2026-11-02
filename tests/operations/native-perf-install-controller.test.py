import importlib.util
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[2] / 'scripts/ci/native-perf-install-controller.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class CanonicalArchives(unittest.TestCase):
    def test_verified_bytes_seed_canonical_cache_once_without_overwriting(self):
        with tempfile.TemporaryDirectory(prefix='perf-archives-') as temporary:
            folder = Path(temporary); (folder / 'packages').mkdir()
            payload = b'isolated public archive bytes'
            row = {'package': 'linux-tools-6.8.0-147', 'version': '6.8.0-147.147',
                'architecture': 'amd64', 'bytes': len(payload), 'sha256': helper.digest(payload)}
            (folder / 'packages' / (row['package'] + '.deb')).write_bytes(payload)
            class Native:
                @staticmethod
                def trusted_directory(path, create=False):
                    if create: path.mkdir(exist_ok=True)
                    return path
            # Only root ownership is substituted on macOS; the actual file copy,
            # digest, canonical name, fsync and duplicate refusal execute.
            with patch.object(helper, 'read', side_effect=lambda path, limit: path.read_bytes()):
                cache, names = helper.seed_archives(Native, folder, [row])
                target = cache / 'linux-tools-6.8.0-147_6.8.0-147.147_amd64.deb'
                self.assertEqual(names, {row['package']: str(target)})
                self.assertEqual(target.read_bytes(), payload)
                with self.assertRaises(RuntimeError): helper.seed_archives(Native, folder, [row])
                self.assertEqual(target.read_bytes(), payload)


class CommandDiagnostics(unittest.TestCase):
    def test_failed_command_exports_only_closed_operation_and_stderr_categories(self):
        response = helper.subprocess.CompletedProcess([], 100, b'', b'Unsupported file /PRIVATE/SECRET.deb given on commandline')
        with patch.object(helper.subprocess, 'run', return_value=response):
            with self.assertRaises(helper.CommandFailure) as caught:
                helper.run(['/usr/bin/apt-get', '--simulate', 'install', '/PRIVATE/SECRET.deb'])
        value = caught.exception.public
        self.assertEqual(value, {'command': 'apt_simulation', 'exitCode': 100,
            'categories': ['unsupported_file'], 'boundExceeded': False,
            'errorWords': ['unsupported', 'file', 'given', 'on', '_']})
        self.assertNotIn('PRIVATE', json.dumps(value))
        words = helper.command_error_words(b'E: Archives directory /PRIVATE/SECRET is missing',
            b'E: Failed to fetch https://USER:TOKEN@PRIVATE/SECRET \"PASSWORD\"')
        self.assertNotIn('PRIVATE', json.dumps(words).upper())
        self.assertNotIn('TOKEN', json.dumps(words).upper())
        self.assertLessEqual(len(words), 96)
        self.assertEqual(helper.command_failure_outcome(value), value)
        for key, bad in [('command', 'PRIVATE'), ('command', []), ('categories', ['PRIVATE']), ('categories', [{}]), ('exitCode', True), ('errorWords', ['PRIVATE'])]:
            self.assertIsNone(helper.command_failure_outcome({**value, key: bad}))


class QualificationDiagnostics(unittest.TestCase):
    def test_private_ssh_text_only_exports_bounded_closed_categories(self):
        path = Path(__file__).resolve().parents[1] / 'fixtures/engine-native-fault/qualify_perf_install.py'
        spec = importlib.util.spec_from_file_location('qualification_metadata', path)
        fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
        result = fixture.ssh_diagnostics(b'Missing privilege separation directory: /PRIVATE/SECRET\nAccepted publickey for PRIVATE_USER')
        self.assertEqual(result, {'categories': ['authentication_accepted', 'privilege_directory_missing'], 'boundExceeded': False})
        self.assertNotIn('PRIVATE', json.dumps(result))
        result = fixture.ssh_diagnostics(b'x' * 65537 + b'Accepted publickey PRIVATE')
        self.assertEqual(result, {'categories': ['unknown'], 'boundExceeded': True})


class ManagerState(unittest.TestCase):
    def response(self, code, load='loaded', missing=None, extra=False, oversized=False):
        fields = {'LoadState': load, 'ActiveState': 'inactive', 'SubState': 'dead',
            'InvocationID': '', 'MainPID': '0', 'ExecMainCode': '0', 'ExecMainStatus': '0',
            'ControlGroup': '', 'Result': 'success'}
        if missing is not None: fields.pop(missing)
        if extra: fields['Unexpected'] = 'refuse'
        raw = ''.join(key + '=' + value + '\n' for key, value in fields.items()).encode()
        if oversized: raw += b'x' * 16385
        return helper.subprocess.CompletedProcess([], code, raw, b'')

    def test_exact_notfound_nonzero_reaches_journal_fallback(self):
        with patch.object(helper.subprocess, 'run', return_value=self.response(4, 'not-found')):
            self.assertEqual(helper.manager('123')['LoadState'], 'not-found')

    def test_arbitrary_nonzero_incomplete_extra_and_oversized_refuse(self):
        for response in (self.response(1), self.response(4, 'not-found', missing='Result'),
                self.response(4, 'not-found', extra=True), self.response(0, oversized=True)):
            with self.subTest(response=response), patch.object(helper.subprocess, 'run', return_value=response):
                with self.assertRaises(RuntimeError): helper.manager('123')

    def test_loaded_zero_keeps_exact_property_contract(self):
        with patch.object(helper.subprocess, 'run', return_value=self.response(0)) as command:
            self.assertEqual(helper.manager('123')['LoadState'], 'loaded')
            self.assertEqual(command.call_args.kwargs['timeout'], 3)
            self.assertIn('--no-pager', command.call_args.args[0])


class DraftBoundaries(unittest.TestCase):
    def receipt_value(self):
        return {'schema': 'native-perf-install/v1', 'operation': '123', 'readOnly': True,
            'profileSHA256': 'a' * 64, 'sourceSHA256': 'b' * 64, 'profilePurpose': 'production',
            'engineSHA': 'e' * 40, 'originalIdentitySHA256': 'f' * 64,
            'sameInvocation': True, 'terminal': True, 'helperCgroupEmpty': True, 'installationVerified': True,
            'productionInstallationQualified': True, 'wrapperKernelDispatchQualified': True,
            'reason': 'install_verified', 'managerTerminalEvidence': 'loaded_manager_state',
            'identityControllerSHA256': helper.CONTROLLER_SHA, 'retryAllowed': False, 'nativeCauseProven': False}

    def outcome(self, raw, status=0):
        return helper.receipt_outcome(raw, '123', 'a' * 64, 'b' * 64, 'production', 'e' * 40, status)

    def test_exact_bound_closed_receipt_and_transport_failure(self):
        raw = json.dumps(self.receipt_value()).encode()
        self.assertTrue(self.outcome(raw)['validReceipt'])
        failed = self.outcome(raw, 100)
        self.assertFalse(failed['validReceipt'])
        self.assertEqual(failed['transportExit'], 100)
        self.assertFalse(failed['installationVerified'])

    def test_wrong_bindings_extra_keys_duplicates_and_boolean_coercion_refuse(self):
        for key, value in [('operation', '124'), ('profileSHA256', 'c' * 64), ('sourceSHA256', 'd' * 64),
                ('profilePurpose', 'isolated-qualification'), ('identityControllerSHA256', 'e' * 64),
                ('engineSHA', 'a' * 40), ('originalIdentitySHA256', 'bad'),
                ('terminal', 1), ('helperCgroupEmpty', False), ('managerTerminalEvidence', 'unproven'),
                ('hole_cards', 'NEVER_EXPORT')]:
            item = self.receipt_value(); item[key] = value
            result = self.outcome(json.dumps(item).encode())
            self.assertFalse(result['validReceipt'], key)
            self.assertNotIn('NEVER_EXPORT', json.dumps(result))
        raw = json.dumps(self.receipt_value()).encode()
        self.assertFalse(self.outcome(raw[:-1] + b',"terminal":true}')['validReceipt'])
        self.assertFalse(self.outcome(b'x' * 16385)['validReceipt'])

    def test_controller_refusal_is_closed_without_raw_error(self):
        value = {'schema': 'native-perf-install/v1', 'installationVerified': False,
            'reason': 'package_plan_refused', 'retryAllowed': False}
        self.assertEqual(self.outcome(json.dumps(value).encode())['refusalCode'], 'package_plan_refused')
        value['reason'] = 'PRIVATE RAW ERROR'
        result = self.outcome(json.dumps(value).encode())
        self.assertFalse(result['validReceipt'])
        self.assertNotIn('PRIVATE RAW ERROR', json.dumps(result))

    def example(self):
        # Synthetic parser data ONLY; never emitted as an eligible profile.
        return {'schema': 'native-perf-install-profile/v1', 'qualified': True, 'purpose': 'production',
            'os': 'ubuntu', 'version': '24.04', 'arch': 'amd64', 'kernel': '6.8.0-147-generic',
            'qualificationRun': '123', 'packages': [
                {'package': name, 'version': '6.8.0-147.147', 'architecture': 'all' if name == 'linux-tools-common' else 'amd64',
                 'bytes': 100, 'sha256': 'a' * 64} for name in
                ('linux-tools-common', 'linux-tools-6.8.0-147', 'linux-tools-6.8.0-147-generic')]}

    def test_profile_requires_exact_digest_and_qualified_exact_platform(self):
        raw = json.dumps(self.example()).encode()
        self.assertEqual(helper.profile(raw, helper.digest(raw))['qualificationRun'], '123')
        with self.assertRaises(RuntimeError):
            helper.profile(raw, 'b' * 64)
        for field, value in [('qualified', False), ('kernel', '6.8.0-148-generic'), ('arch', 'arm64')]:
            data = self.example()
            data[field] = value
            raw = json.dumps(data).encode()
            with self.assertRaises(RuntimeError):
                helper.profile(raw, helper.digest(raw))

    def test_fixture_kernel_is_explicit_and_never_a_production_profile(self):
        data = self.example()
        data['purpose'] = 'isolated-qualification'
        data['kernel'] = '7.0.0-1017-azure'
        raw = json.dumps(data).encode()
        self.assertEqual(helper.profile(raw, helper.digest(raw))['kernel'], data['kernel'])
        self.assertEqual(helper.verified_perf_path(data), '/usr/lib/linux-tools-6.8.0-147/perf')
        data['purpose'] = 'production'
        with self.assertRaises(RuntimeError):
            helper.verified_perf_path(data)
        raw = json.dumps(data).encode()
        with self.assertRaises(RuntimeError):
            helper.profile(raw, helper.digest(raw))
        self.assertEqual(helper.verified_perf_path(self.example()), '/usr/bin/perf')

    def test_duplicate_and_large_package_profile_refuses(self):
        for change in ('duplicate', 'size'):
            data = self.example()
            if change == 'duplicate':
                data['packages'][1] = data['packages'][0]
            else:
                data['packages'][0]['bytes'] = 64 * 1024 * 1024
            raw = json.dumps(data).encode()
            with self.assertRaises(RuntimeError):
                helper.profile(raw, helper.digest(raw))

    def test_unit_is_finite_exec_and_only_own_cgroup(self):
        args = helper.unit_arguments('123', Path('/var/lib/club-arena-perf-install/123/installer.py'))
        for flag in ('--service-type=exec', '--property=RuntimeMaxSec=180', '--property=KillMode=control-group', '--property=Restart=no', '--property=Slice=system.slice'):
            self.assertIn(flag, args)
        with self.assertRaises(RuntimeError):
            helper.unit_arguments('../foreign', Path('/anything'))

    def test_helper_claim_cannot_fake_manager_success(self):
        record = {'invocation': 'a' * 32, 'profileSHA256': 'b' * 64, 'sourceSHA256': 'c' * 64,
            'target': {'sha': 'e' * 40},
            'operation': '123', 'cleanup': 'retained_public_packages_only', 'result': 'install_verified', 'serviceResult': True, 'exitZero': True}
        class Native:
            trusted_directory = staticmethod(lambda path: path)
            read_json = staticmethod(lambda path: record)
        state = {'InvocationID': 'a' * 32, 'ActiveState': 'inactive', 'SubState': 'dead',
            'Result': 'success', 'ExecMainCode': '1', 'ExecMainStatus': '0', 'ControlGroup': ''}
        with patch.object(helper, 'manager', return_value=state), patch.object(helper, 'read', return_value=b'fixture source'), patch.object(helper, 'digest', return_value='c' * 64):
            self.assertTrue(helper.receipt(Native, '123')['installationVerified'])
            state['ExecMainStatus'] = '1'
            self.assertFalse(helper.receipt(Native, '123')['installationVerified'])
            state['ExecMainStatus'] = '0'
            state['InvocationID'] = 'd' * 32
            self.assertFalse(helper.receipt(Native, '123')['installationVerified'])


if __name__ == '__main__':
    unittest.main()
