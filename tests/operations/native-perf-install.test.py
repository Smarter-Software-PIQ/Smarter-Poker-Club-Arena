import importlib.util
from pathlib import Path
import re
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('perf_install', Path(__file__).resolve().parents[2] / 'scripts/ci/native-perf-install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fixture_spec = importlib.util.spec_from_file_location('perf_fixture', Path(__file__).resolve().parents[1] / 'fixtures/engine-native-fault/qualify_perf_packages.py')
fixture = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(fixture)


def transcript(rows):
    return ('0 upgraded, %s newly installed, 0 to remove and 14 not upgraded.\n' % len(rows)
        + ''.join('Inst %s (%s Ubuntu:24.04/noble-updates [amd64])\n' % row for row in rows)
        + ''.join('Conf %s (%s Ubuntu:24.04/noble-updates [amd64])\n' % row for row in rows)).encode()


class PackagePlan(unittest.TestCase):
    def test_qualification_run_survives_sudo_environment_boundary(self):
        workflow = (fixture.ROOT / '.github/workflows/profile-engine-main-thread.yml').read_text()
        command = re.search(r'(?m)^\s*sudo env (.*?) python3 -B tests/fixtures/engine-native-fault/qualify_perf_packages.py \\\s*$', workflow)
        self.assertIsNotNone(command)
        # Exercise the actual carrier assignments across an empty environment,
        # modeling sudo sanitization without invoking sudo or package tools.
        for run_id in ('123456789', '987654321'):
            result = subprocess.run(['/bin/sh', '-c', '/usr/bin/env -i ' + command.group(1) + ' /usr/bin/env'],
                env={'RUNNER_TEMP': '/owned qualification', 'GITHUB_RUN_ID': run_id,
                    'UNTRUSTED_SELECTOR': 'must-not-cross'}, capture_output=True, text=True, timeout=5, check=True)
            forwarded = dict(line.split('=', 1) for line in result.stdout.splitlines())
            self.assertEqual(forwarded.get('GITHUB_RUN_ID'), run_id)
            self.assertEqual(forwarded.get('TMPDIR'), '/owned qualification/native-perf-packages')
            self.assertNotIn('UNTRUSTED_SELECTOR', forwarded)

    def test_installed_tools_are_not_a_fresh_install_or_downgrade(self):
        self.assertEqual(module.installed_targets({}), 'installation_needed')
        self.assertEqual(module.installed_targets({name: module.VERSION for name in module.TARGETS}), 'tools_already_installed')
        for version in ('6.8.0-148.148', '6.8.0-146.146'):
            self.assertEqual(module.installed_targets({module.TARGETS[0]: version}), 'tools_version_conflict')
        with self.assertRaises(ValueError):
            module.installed_targets({'private-package': 'bad value'})

    def test_failure_receipt_is_closed_and_keeps_actual_child_exit(self):
        self.assertEqual(fixture.closed_failure(fixture.Failure('qualification_command_nonzero', 100), 'package_plan'),
            {'phase': 'package_plan', 'reason': 'qualification_command_nonzero', 'exitCode': 100})
        self.assertEqual(fixture.closed_failure(ValueError('package_closure_refused'), 'package_plan')['reason'], 'package_closure_refused')
        self.assertEqual(fixture.closed_failure(fixture.Failure('secret raw stderr', 'private'), 'private path'),
            {'phase': 'admission', 'reason': 'qualification_data_unproven', 'exitCode': None})

    def test_exact_tools_and_new_runtime_dependency(self):
        rows = [(name, module.VERSION) for name in module.TARGETS] + [('libtraceevent1', '1:1.8.2-1build1')]
        self.assertEqual(module.plan(transcript(rows)), dict(rows))

    def test_refused_public_package_is_actionable_without_exporting_untrusted_data(self):
        with self.assertRaises(fixture.helper.PlanRefusal) as context:
            fixture.helper.plan(transcript([('libc6', '2.39-0ubuntu8.6')]))
        self.assertEqual(fixture.closed_failure(context.exception, 'package_plan')['refusedPackage'], 'libc6')
        error = fixture.helper.PlanRefusal('package_closure_refused', 'private path', 'secret value')
        self.assertNotIn('refusedPackage', fixture.closed_failure(error, 'package_plan'))

    def test_already_installed_dependencies_need_no_install(self):
        self.assertEqual(module.plan(transcript([(module.TARGETS[2], module.VERSION)])), {module.TARGETS[2]: module.VERSION})

    def test_upgrades_removals_critical_unknown_and_wrong_versions_refuse(self):
        good = transcript([(module.TARGETS[2], module.VERSION)])
        bad = [good.replace(b' (6.8', b' [6.7] (6.8', 1),
            good + b'Remv openssl [3.0]\n', good.replace(b'0 upgraded,', b'1 upgraded,'),
            transcript([('libc6', '2.39-0ubuntu8.6')]), transcript([('systemd', '255.4-1ubuntu8')]),
            transcript([(module.TARGETS[2], '6.8.0-148.148')]), good + b'W: unauthenticated\n']
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.plan(value)

    def test_explicit_absent_state_requires_exact_fixed_evidence(self):
        self.assertTrue(fixture.explicit_uninstalled('hwdata', 0, b'unknown ok not-installed\t', b''))
        self.assertTrue(fixture.explicit_uninstalled('linux-tools-common', 1, b'', b'dpkg-query: no packages found matching linux-tools-common\n'))
        for name, code, out, err in [('hwdata', 0, b'', b''), ('hwdata', 1, b'', b''),
                ('private', 0, b'unknown ok not-installed\t', b''),
                ('hwdata', 0, b'deinstall ok config-files\t', b''),
                ('hwdata', 1, b'', b'dpkg-query: no packages found matching private\n'),
                ('hwdata', 1, b'', b'dpkg-query: no packages found matching hwdata\nprivate')]:
            self.assertFalse(fixture.explicit_uninstalled(name, code, out, err))

    def test_four_package_proposal_requires_new_run_and_real_fresh_evidence(self):
        import copy, json
        original = json.loads((fixture.ROOT / 'scripts/ci/native-perf-install-profile.json').read_bytes())
        rows = [*original['packages'], fixture.HWDATA]
        proof = {'hwdataFreshInstallVerified': True, 'cleanupConfirmed': True,
            'hwdataSHA256': fixture.HWDATA['sha256'], 'hwdataVersion': fixture.HWDATA['version'],
            'noUpgradesOrRemovals': True, 'combinedRecoveryTransactionQualified': False}
        value = fixture.profile_proposal(rows, '123456', proof)
        self.assertEqual(value['qualificationRun'], '123456')
        self.assertEqual(len(value['packages']), 4)
        self.assertFalse(value['combinedRecoveryTransactionQualified'])
        self.assertFalse(value['productionInstallationQualified'])
        for run in ('', '0', '01', 'private', '1' * 21, '\u0661\u0662'):
            with self.assertRaises(fixture.Failure): fixture.profile_proposal(rows, run, proof)
        with self.assertRaises(fixture.Failure): fixture.profile_proposal(rows, '123456', {})
        for key, value in [('hwdataSHA256', 'a' * 64), ('hwdataVersion', '1'), ('combinedRecoveryTransactionQualified', True)]:
            with self.assertRaises(fixture.Failure): fixture.profile_proposal(rows, '123456', {**proof, key: value})
        with self.assertRaises(fixture.Failure): fixture.profile_proposal(rows[:3], '123456', proof)
        bad = copy.deepcopy(rows); bad[-1]['sha256'] = 'a' * 64
        with self.assertRaises(fixture.Failure): fixture.profile_proposal(bad, '123456', proof)

    def test_hwdata_public_candidate_requires_exact_bytes_and_control_shape(self):
        from unittest.mock import patch
        fields = {'Package': 'hwdata', 'Version': '0.379-1', 'Architecture': 'all'}
        with self.assertRaises(fixture.Failure): fixture.verify_hwdata(b'', fields, ['control', 'md5sums'], 'pci.ids, usb.ids')
        # Parser boundary only; genuine signed bytes/install qualification is Linux-only.
        with patch.object(fixture, 'sha', return_value=fixture.HWDATA['sha256']):
            raw = b'x' * fixture.HWDATA['bytes']
            fixture.verify_hwdata(raw, fields, ['control', 'md5sums'], 'pci.ids, usb.ids')
            for names, deps in [(['control', 'md5sums', 'postinst'], 'pci.ids, usb.ids'), (['control', 'md5sums'], 'systemd')]:
                with self.assertRaises(fixture.Failure): fixture.verify_hwdata(raw, fields, names, deps)

    def test_disposable_hwdata_inventory_rejects_ambiguous_rows(self):
        missing_spec = importlib.util.spec_from_file_location('missing_fixture', fixture.ROOT / 'tests/fixtures/engine-native-fault/qualify_perf_missing_archive.py')
        missing = importlib.util.module_from_spec(missing_spec); missing_spec.loader.exec_module(missing)
        raw = b'hwdata\tinstall ok installed\t0.379-1\n'
        self.assertEqual(missing.inventory(raw, module), {'hwdata': ('install ok installed', '0.379-1')})
        tombstone = b'hwdata\tunknown ok not-installed\t\n'
        self.assertEqual(missing.inventory(tombstone, module), {'hwdata': ('unknown ok not-installed', None)})
        for value in (b'', raw + raw, raw + tombstone, b'hwdata\tinstall ok installed\t\n', b'hwdata\tdeinstall ok config-files\t\n', b'private/path\tinstall ok installed\t1\n'):
            with self.assertRaises(RuntimeError): missing.inventory(value, module)

    def test_duplicates_missing_config_and_truncation_refuse(self):
        row = (module.TARGETS[0], module.VERSION)
        for value in [transcript([row, row]), transcript([row]).split(b'Conf ')[0], b'', b'x' * 65537]:
            with self.assertRaises(ValueError):
                module.plan(value)


if __name__ == '__main__':
    unittest.main()
