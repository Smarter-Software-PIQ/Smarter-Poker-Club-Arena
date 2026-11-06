#!/usr/bin/env python3
"""Every frozen v1 host protocol file renders byte-identical to production.

The installers refuse to overwrite these files ("frozen ... differs; install a
new protocol version instead"), so ANY byte change in the repo makes every
later control generation fail install permanently. Production 2026-11-05: a
two-line StartLimit edit to the release v1 template (#9630) killed release run
42162399056-1 at intake, and would have killed the 4 AM build the same way.
Policy changes go in a drop-in or a separately named v2 protocol, never here.
The hashes are the bytes installed on the Hetzner engine host.
"""
import hashlib
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'server' / 'scripts'
WRAPPER_V1_PATH = '/usr/local/lib/club-arena/engine-release-unit-wrapper-v1.sh'

PRODUCTION_SHA256 = {
    'club-arena-engine-release-v1@.service': '651c90e811ee564099051181f840aba8b2b6d5206c3e77d8ee0b515fcf09978f',
    'club-arena-engine-intake-v1@.service': '4bfdb7b0c15afc8cc8748def8f4d485043dbb909192ee450170c73c715db5e1d',
    'club-arena-engine-intake-v1@.path': '429db0bdaf2c7bcbf9de8c4860a4ee5fdc51c5a48c09aa3c627b76d8e6be0962',
    'engine-release-unit-wrapper-v1.sh': 'e9abdbe2c97c3594b32a920285e78858c1e0497f00a8a7edd21b99ba0491dc9c',
}


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def heredoc(source: str, opener: str) -> str:
    start = source.index(opener) + len(opener)
    return source[start:source.index('\nUNIT\n', start) + 1]


class FrozenHostProtocolBoundaries(unittest.TestCase):
    def test_release_v1_unit(self):
        source = (SCRIPTS / 'install-engine-supervisor.sh').read_text()
        unit = heredoc(source, 'club-arena-engine-release-v1@.service" <<UNIT\n')
        rendered = unit.replace('$UNIT_WRAPPER_V1', WRAPPER_V1_PATH).replace('\\${', '${')
        self.assertNotIn('$UNIT_WRAPPER_V1', rendered)
        fixture = ROOT / 'tests' / 'fixtures' / 'frozen-club-arena-engine-release-v1@.service'
        self.assertEqual(rendered, fixture.read_text())
        self.assertEqual(sha(rendered), PRODUCTION_SHA256['club-arena-engine-release-v1@.service'])

    def test_intake_v1_units(self):
        source = (SCRIPTS / 'install-engine-intake.sh').read_text()
        self.assertEqual(sha(heredoc(source, 'cat > "$UNIT_STAGE" <<\'UNIT\'\n')),
                         PRODUCTION_SHA256['club-arena-engine-intake-v1@.service'])
        self.assertEqual(sha(heredoc(source, 'cat > "$PATH_STAGE" <<\'UNIT\'\n')),
                         PRODUCTION_SHA256['club-arena-engine-intake-v1@.path'])

    def test_release_unit_wrapper_v1(self):
        wrapper = (SCRIPTS / 'engine-release-unit-wrapper.sh').read_bytes()
        self.assertEqual(hashlib.sha256(wrapper).hexdigest(),
                         PRODUCTION_SHA256['engine-release-unit-wrapper-v1.sh'])

    def test_frozen_files_are_never_rewritten_in_place(self):
        supervisor = (SCRIPTS / 'install-engine-supervisor.sh').read_text()
        intake = (SCRIPTS / 'install-engine-intake.sh').read_text()
        self.assertIn('frozen release v1 unit differs', supervisor)
        self.assertIn('stable release wrapper v1 differs', supervisor)
        self.assertIn('frozen intake v1 unit differs', intake)
        self.assertIn('frozen intake v1 path unit differs', intake)
        # The restart bound is mutable policy and lives beside the template.
        self.assertRegex(supervisor, re.compile(r'RELEASE_UNIT_V1_DROPIN="\$RELEASE_UNIT_V1_DROPIN_DIR/bounded-restarts\.conf"'))


if __name__ == '__main__':
    unittest.main()
