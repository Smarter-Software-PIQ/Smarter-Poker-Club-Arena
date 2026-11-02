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
    def invoke(self, mode, effects, fixture_profile=False):
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
            commands = []
            def command(args, **kwargs):
                commands.append((args, kwargs))
                if mode == 'install' and len(commands) == 1:
                    if isinstance(effects, Exception):
                        raise effects
                    return effects, b''
                return 0, json.dumps(value).encode()
            argv = ['provider', mode, '--operation', '123', '--expected-engine-sha', 'a' * 40,
                '--host', 'configured.invalid', '--ssh-directory', folder, '--output', str(output)]
            with patch('builtins.print'), patch.object(sys, 'argv', argv), patch.object(provider, 'PROFILE', profile_path), \
                    patch.object(provider, 'command', side_effect=command), \
                    patch.object(provider, 'bundle', return_value=(b'public-only', {'package-plan.py': b'planner'})) as bundle:
                if fixture_profile:
                    with self.assertRaises(SystemExit):
                        provider.main()
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
        self.assertEqual(len(commands), 1)
        self.assertIn('receipt --operation 123 --wait', commands[0][0][-1])
        self.assertNotIn('input', commands[0][1])

    def test_isolated_profile_cannot_reach_production_transport(self):
        result, commands, bundles = self.invoke('install', 0, fixture_profile=True)
        self.assertFalse(result['validReceipt'])
        self.assertFalse(result['installationVerified'])
        self.assertEqual(result['reason'], 'production_profile_refused')
        self.assertEqual(commands, [])
        self.assertEqual(bundles, 0)


if __name__ == '__main__':
    unittest.main()
