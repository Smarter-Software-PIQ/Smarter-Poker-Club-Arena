"""Offline checks for operations/release/fixture/debian-pins.py (no network)."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('debian_pins', ROOT / 'operations/release/fixture/debian-pins.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

DOCKERFILE = (ROOT / 'operations/release/fixture/Dockerfile').read_text()


class DebianPins(unittest.TestCase):
    def test_reads_every_stage_pin_and_both_sources(self):
        pinned = m.pins(DOCKERFILE)
        for package in ('postgresql-17', 'postgresql-client-17', 'libpq5', 'libpq-dev',
                        'postgresql-server-dev-17', 'postgresql-17-pgvector', 'postgresql-17-wal2json'):
            self.assertIn(package, pinned)
        # One ABI: every stage names the same single PostgreSQL version.
        for package in ('postgresql-17', 'postgresql-client-17', 'libpq5', 'libpq-dev', 'postgresql-server-dev-17'):
            self.assertEqual(len(pinned[package]), 1, package)
        self.assertEqual(m.sources(DOCKERFILE), [
            ('https://deb.debian.org/debian', 'trixie', 'main'),
            ('https://deb.debian.org/debian-security', 'trixie-security', 'main'),
        ])

    def test_names_a_pin_the_archive_dropped(self):
        index = ('Package: postgresql-17\nVersion: 17.12-0+deb13u1\nArchitecture: amd64\n\n'
                 'Package: libpq5\nVersion: 17.12-0+deb13u1\n')
        gaps = m.missing({'postgresql-17': {'17.11-0+deb13u1'}, 'libpq5': {'17.12-0+deb13u1'},
                          'gone': {'1.0-1'}}, m.served(index))
        self.assertEqual(gaps, [('gone', '1.0-1', []),
                                ('postgresql-17', '17.11-0+deb13u1', ['17.12-0+deb13u1'])])

    def test_ignores_wildcards_and_unpinned_packages(self):
        text = "RUN apt-get install -y a=1.0-1 b c=2.* \\\n      d=3:4.5-6+deb13u1 && echo e=9\n"
        self.assertEqual(m.pins(text), {'a': {'1.0-1'}, 'd': {'3:4.5-6+deb13u1'}})

    def test_the_workflow_checks_pins_before_any_build(self):
        workflow = (ROOT / '.github/workflows/component-fixture-native-smoke.yml').read_text()
        check = workflow.index('python3 -B operations/release/fixture/debian-pins.py')
        self.assertLess(check, workflow.index('npm ci --prefix server'))
        self.assertLess(check, workflow.index('operations/release/ci/fixture-smoke.py'))
        self.assertIn('python3 -B tests/operations/fixture-debian-pins.test.py', workflow)


if __name__ == '__main__':
    unittest.main()
