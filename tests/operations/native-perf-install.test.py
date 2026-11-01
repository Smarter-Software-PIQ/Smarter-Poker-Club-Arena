import importlib.util
from pathlib import Path
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

    def test_duplicates_missing_config_and_truncation_refuse(self):
        row = (module.TARGETS[0], module.VERSION)
        for value in [transcript([row, row]), transcript([row]).split(b'Conf ')[0], b'', b'x' * 65537]:
            with self.assertRaises(ValueError):
                module.plan(value)


if __name__ == '__main__':
    unittest.main()
