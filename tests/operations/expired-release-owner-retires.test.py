#!/usr/bin/env python3
"""An expired announcement-only release owner retires on any serving release.

Production 2026-11-05: run 42099609162-1 announced an hourly break, missed its
window, and then looped in systemd for 2.5 hours (222 restarts) because the
retirement proof was pinned to the Oct 29 eed06fe5 desired state. Every newer
release died with "fresh scheduled release cannot compete with active runtime
owner". These laws pin the four properties that end that class of outage:

1. the expired-announcement proof reads the SEALED desired identity, never a
   release constant;
2. a refused custody proof names the invariant that failed;
3. a release unit parked in systemd auto-restart is not a live owner;
4. the release unit bounds its restarts through a drop-in, and the frozen v1
   template renders byte-identical to production.
"""
import ast
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SEAL = ROOT / 'server/scripts/engine-release-seal.py'
TRANSACTION = ROOT / 'server/scripts/engine-release-transaction.sh'
SUPERVISOR = ROOT / 'server/scripts/install-engine-supervisor.sh'


class ExpiredOwnerRetiresGenerically(unittest.TestCase):
    def test_expired_announcement_proof_is_not_pinned_to_one_release(self):
        tree = ast.parse(SEAL.read_text())
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == 'cmd_prove_expired_recovery_announcement')
        names = {n.id for n in ast.walk(fn) if isinstance(n, ast.Name)}
        self.assertNotIn('FAILED_ROUTINE_DESIRED', names)
        self.assertNotIn('FAILED_ROUTINE_IMAGE', names)
        # The proof passes the sealed desired identity into the runtime proof.
        calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Name) and n.func.id == 'failed_routine_runtime']
        self.assertTrue(calls)
        for call in calls:
            self.assertIn('desired', {k.arg for k in call.keywords})

    def test_runtime_proof_accepts_a_desired_identity(self):
        tree = ast.parse(SEAL.read_text())
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == 'failed_routine_runtime')
        self.assertIn('desired', [a.arg for a in fn.args.args])

    def test_refused_custody_names_its_reason(self):
        code = ("import importlib.util,sys\n"
                f"spec=importlib.util.spec_from_file_location('seal', {str(SEAL)!r})\n"
                "m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
                "m.failed_routine_require(False, 'recovery window has not expired')\n")
        proc = subprocess.run([sys.executable, '-B', '-c', code], capture_output=True, text=True)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('exact failed routine custody is unproved', proc.stderr)
        self.assertIn('(recovery window has not expired)', proc.stderr)

    def test_auto_restart_unit_is_not_a_live_owner(self):
        source = TRANSACTION.read_text()
        start = source.index('newer_release_in_flight() {')
        end = source.index('\n}\n', start) + 3
        function = source[start:end]
        other = '0' * 40
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'requests').mkdir()
            (root / 'requests' / '42099609162-1.request').write_text(other + '\nurl\nactor\n')
            fake = root / 'bin'
            fake.mkdir()
            script = fake / 'systemctl'
            script.write_text('#!/bin/sh\n'
                              'case "$*" in *ActiveState*) echo activating ;; *SubState*) cat "$SUB_FILE" ;; esac\n')
            script.chmod(script.stat().st_mode | stat.S_IEXEC)
            sub_file = root / 'sub'
            for sub, expected in (('auto-restart', 1), ('start', 0)):
                sub_file.write_text(sub + '\n')
                proc = subprocess.run(
                    ['bash', '-c', function + '\nnewer_release_in_flight any'],
                    env={**os.environ, 'PATH': f'{fake}:{os.environ["PATH"]}', 'SUB_FILE': str(sub_file),
                         'REQUEST_ROOT': str(root / 'requests'), 'RUN_ID': '42126015699-1',
                         'SHA': '1' * 40, 'REPO_DIR': tmp},
                    capture_output=True, text=True)
                self.assertEqual(proc.returncode, expected, (sub, proc.stdout, proc.stderr))
                if expected == 0:
                    self.assertEqual(proc.stdout.split(), ['42099609162-1', other])

    def test_release_unit_template_bounds_restarts(self):
        source = SUPERVISOR.read_text()
        unit = source[source.index('club-arena-engine-release-v1@.service" <<UNIT'):]
        unit = unit[:unit.index('\nUNIT\n')]
        # The bound is a drop-in: the v1 template itself is frozen byte for byte.
        self.assertNotIn('StartLimitBurst', unit)
        dropin = source[source.index("<<'DROPIN'\n") + len("<<'DROPIN'\n"):]
        dropin = dropin[:dropin.index('\nDROPIN\n')]
        self.assertIn('[Unit]', dropin)
        self.assertIn('StartLimitIntervalSec=20min', dropin)
        self.assertIn('StartLimitBurst=5', dropin)
        self.assertIn('$RELEASE_UNIT_V1.d', source)
        self.assertIn('mv -T "$NEXT_DROPIN" "$RELEASE_UNIT_V1_DROPIN"', source)

    def test_frozen_release_v1_template_renders_byte_identical_to_production(self):
        # 2026-11-05 run 42162399056-1: a two-line edit to this template made
        # every later control generation fail install permanently with
        # "frozen release v1 unit differs". The template must render to the
        # exact bytes installed on the production host since 2026-09-11.
        source = SUPERVISOR.read_text()
        marker = 'club-arena-engine-release-v1@.service" <<UNIT\n'
        unit = source[source.index(marker) + len(marker):]
        unit = unit[:unit.index('\nUNIT\n') + 1]
        rendered = (unit.replace('$UNIT_WRAPPER_V1', '/usr/local/lib/club-arena/engine-release-unit-wrapper-v1.sh')
                        .replace('\\${', '${'))
        self.assertNotIn('$UNIT_WRAPPER_V1', rendered)
        frozen = (ROOT / 'tests' / 'fixtures' / 'frozen-club-arena-engine-release-v1@.service').read_text()
        self.assertEqual(rendered, frozen)


if __name__ == '__main__':
    unittest.main()
