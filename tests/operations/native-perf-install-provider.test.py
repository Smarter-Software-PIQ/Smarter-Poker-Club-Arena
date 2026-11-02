import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import shlex
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('provider', ROOT / 'scripts/ci/native-perf-install-provider.py')
provider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provider)


class ProviderBoundaries(unittest.TestCase):
    def invoke(self, mode, effects, fixture_profile=False, failed_install=False, terminal=True, diagnostic_good=False):
        with tempfile.TemporaryDirectory(prefix='perf-provider-boundary-') as folder:
            output = Path(folder) / 'receipt.json'
            profile = json.loads(provider.PROFILE.read_text())
            if fixture_profile:
                profile.update(purpose='isolated-qualification', kernel='7.0.0-1017-azure')
            profile_path = Path(folder) / 'profile.json'
            profile_path.write_text(json.dumps(profile))
            value = {'schema': 'native-perf-install/v1', 'operation': '123', 'readOnly': True,
                'profileSHA256': hashlib.sha256(profile_path.read_bytes()).hexdigest(),
                'sourceSHA256': hashlib.sha256(provider.CONTROLLER.read_bytes()).hexdigest(),
                'profilePurpose': 'production', 'engineSHA': 'a' * 40,
                'originalIdentitySHA256': 'b' * 64,
                'sameInvocation': True, 'terminal': True, 'helperCgroupEmpty': True,
                'installationVerified': True, 'productionInstallationQualified': True,
                'wrapperKernelDispatchQualified': True, 'reason': 'install_verified',
                'managerTerminalEvidence': 'loaded_manager_state',
                'identityControllerSHA256': '020c6c74be9e6942feadb2b9b3eca80db41f8af1515deaa48f9b8ba5d6d76a72',
                'retryAllowed': False, 'nativeCauseProven': False}
            if failed_install:
                value.update(installationVerified=False, productionInstallationQualified=False, wrapperKernelDispatchQualified=False, reason='apt_failed_unknown_partial_state')
            value['terminal'] = terminal
            commands = []
            def command(args, **kwargs):
                commands.append((args, kwargs))
                if mode == 'install' and len(commands) == 1:
                    if isinstance(effects, Exception):
                        raise effects
                    return effects, b''
                if mode == 'receipt' and len(commands) == 2 and diagnostic_good:
                    diagnostic = {'schema': 'native-perf-terminal-diagnostics/v1', 'readOnly': True,
                        'diagnosticReadVerified': True, **{key: value[key] for key in (
                            'operation', 'sourceSHA256', 'profileSHA256', 'profilePurpose', 'engineSHA', 'originalIdentitySHA256')},
                        'identityControllerSHA256': value['identityControllerSHA256'],
                        'planSourceSHA256': '739f7ea64f41d7aa0ba421362ba200ed6fcc767a9d227351011cb5de951155ac',
                        'phase': 'refused', 'commandFailure': None, 'aptAttemptRecorded': False,
                        'originalRecordsUnchanged': True, 'packages': {'verified': False, 'rows': [], 'dpkgAuditClean': None},
                        'retryAllowed': False, 'nativeCauseProven': False}
                    return 0, json.dumps(diagnostic).encode()
                return 0, json.dumps(value).encode()
            argv = ['provider', mode, '--operation', '123', '--expected-engine-sha', 'a' * 40,
                '--host', 'configured.invalid', '--ssh-directory', folder, '--output', str(output)]
            with patch('builtins.print'), patch.object(sys, 'argv', argv), patch.object(provider, 'PROFILE', profile_path), \
                    patch.object(provider, 'command', side_effect=command), \
                    patch.object(provider, 'bundle', return_value=(b'public-only', {'package-plan.py': b'planner'})) as bundle:
                if fixture_profile:
                    with self.assertRaises(SystemExit):
                        provider.main()
                elif failed_install:
                    with self.assertRaises(SystemExit) as stopped:
                        provider.main()
                    self.assertEqual(stopped.exception.code, 1)
                else:
                    provider.main()
                return json.loads(output.read_text()), commands, bundle.call_count

    def test_unknown_ack_only_reads_original_operation_once(self):
        for effect in (255, subprocess.TimeoutExpired('ssh', 40), RuntimeError('provider_output_bound')):
            with self.subTest(effect=type(effect).__name__):
                result, commands, bundles = self.invoke('install', effect)
                self.assertTrue(result['validReceipt'])
                self.assertEqual(bundles, 1)
                self.assertEqual(len(commands), 2)
                self.assertEqual(shlex.split(commands[0][0][-1])[5], '123')
                self.assertIn('/123/installer.py receipt --operation 123 --wait', commands[1][0][-1])
                self.assertNotIn('admit', commands[1][0][-1])
                self.assertNotIn('input', commands[1][1])

    def test_receipt_mode_never_downloads_or_stages(self):
        result, commands, bundles = self.invoke('receipt', None)
        self.assertTrue(result['installationVerified'])
        self.assertEqual(bundles, 0)
        self.assertEqual(len(commands), 2)
        self.assertIn('receipt --operation 123 --wait', commands[0][0][-1])
        self.assertEqual(shlex.split(commands[1][0][-1]), ['/usr/bin/python3', '-I', '-B', '-', '123'])
        self.assertIn(b'Read one original terminal installation', commands[1][1]['input'])
        self.assertFalse(result['diagnosticReadVerified'])
        self.assertNotIn('input', commands[0][1])

    def test_failed_installation_keeps_failed_exit_when_diagnostic_is_unknown(self):
        result, commands, bundles = self.invoke('receipt', None, failed_install=True)
        self.assertTrue(result['validReceipt'])
        self.assertFalse(result['installationVerified'])
        self.assertFalse(result['retryAllowed'])
        self.assertFalse(result['diagnosticReadVerified'])
        self.assertEqual(result['reason'], 'apt_failed_unknown_partial_state')
        self.assertEqual(bundles, 0)
        self.assertEqual(len(commands), 2)

    def test_diagnostic_success_never_promotes_failed_installation_or_retry(self):
        result, commands, bundles = self.invoke('receipt', None, failed_install=True, diagnostic_good=True)
        self.assertTrue(result['diagnosticReadVerified'])
        self.assertEqual(result['terminalDiagnostics']['phase'], 'refused')
        self.assertFalse(result['installationVerified'])
        self.assertFalse(result['retryAllowed'])
        self.assertEqual(result['reason'], 'apt_failed_unknown_partial_state')
        self.assertEqual(bundles, 0)
        self.assertEqual(len(commands), 2)

    def test_nonterminal_receipt_never_executes_adapter(self):
        result, commands, bundles = self.invoke('receipt', None, failed_install=True, terminal=False)
        self.assertFalse(result['diagnosticReadVerified'])
        self.assertEqual(len(commands), 1)
        self.assertEqual(bundles, 0)

    def test_isolated_profile_cannot_reach_production_transport(self):
        result, commands, bundles = self.invoke('install', 0, fixture_profile=True)
        self.assertFalse(result['validReceipt'])
        self.assertFalse(result['installationVerified'])
        self.assertEqual(result['reason'], 'production_profile_refused')
        self.assertEqual(commands, [])
        self.assertEqual(bundles, 0)


if __name__ == '__main__':
    unittest.main()
