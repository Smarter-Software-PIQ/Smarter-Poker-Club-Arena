#!/usr/bin/env python3
"""Actual protected-source archive metadata meets the unchanged execution guard."""
import io
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
ENV.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
           GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1', GIT_OPTIONAL_LOCKS='0')
WORKFLOW = (ROOT/'.github/workflows/auto-deploy-hetzner.yml').read_text()
INSTALLER = (ROOT/'server/scripts/install-engine-supervisor.sh').read_text()
HELPER = (ROOT/'server/scripts/quarantine-generated-control-cache.py').read_bytes()
LINE = next(line.strip().removesuffix(' \\') for line in WORKFLOW.splitlines()
            if 'archive "$CONTROL_SHA" server/scripts' in line)
GUARD = INSTALLER[INSTALLER.index('quarantine_known_generated_cache() {'):]
GUARD = GUARD.split('\nimport os, stat, subprocess, sys\n', 1)[1].split('\nPY\n', 1)[0]
GUARD = 'import os, stat, subprocess, sys\n' + GUARD
# Mac native parity checks the same exact-owner rule with the fixture owner.
# Required Linux execution below runs this unmodified UID0 guard as real root.
if sys.platform != 'linux':
    assert GUARD.count('before.st_uid == 0') == 1
    GUARD = GUARD.replace('before.st_uid == 0', 'before.st_uid == os.getuid()')


class ArchiveCustody(unittest.TestCase):
    def scene(self, folder):
        repo = Path(folder)/'repo'; scripts = repo/'server/scripts'; scripts.mkdir(parents=True)
        (scripts/'quarantine-generated-control-cache.py').write_bytes(HELPER)
        (scripts/'install-engine-supervisor.sh').write_text(INSTALLER)
        (scripts/'install-engine-supervisor.sh').chmod(0o755)
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repo), *args], env=ENV,
                                           stderr=subprocess.PIPE, timeout=10).decode().strip()
        git('init', '--template=', '-q'); git('config', 'user.name', 'Archive fixture')
        git('config', 'user.email', 'archive-fixture@example.invalid')
        git('config', 'tar.umask', '0002'); git('add', '.'); git('commit', '-qm', 'actual maintained control source')
        return repo, git('rev-parse', 'HEAD'), git

    def archive(self, folder, repo, sha, line=LINE):
        stage = Path(folder); stage.mkdir(mode=0o700)
        env = {**ENV, 'REPO_DIR': str(repo), 'CONTROL_SHA': sha, 'STAGE': str(stage)}
        raw = subprocess.check_output(['bash', '-euo', 'pipefail', '-c', line], env=env, timeout=10)
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
            member = archive.getmember('server/scripts/quarantine-generated-control-cache.py')
            self.assertTrue(member.isfile()); self.assertEqual(member.uid, 0)
            self.assertEqual(archive.extractfile(member).read(), HELPER)
            mode = member.mode
        # GNU tar preserves member permissions by default for root. Native Mac
        # non-root parity requests that same behavior explicitly; Linux uses the
        # exact producer extraction flags and must run as UID0.
        args = ['tar', '--no-same-owner'] + ([] if os.geteuid() == 0 else ['--same-permissions'])
        subprocess.run(args + ['-xf', '-', '-C', str(stage)], input=raw, env=env, check=True, timeout=10)
        helper = stage/'server/scripts/quarantine-generated-control-cache.py'
        self.assertEqual(helper.stat().st_mode & 0o777, mode)
        self.assertEqual(stage.stat().st_mode & 0o777, 0o700)
        self.assertEqual(helper.stat().st_uid, os.geteuid())
        return helper

    def guard(self, repo, sha, helper):
        return subprocess.run([sys.executable, '-I', '-B', '-c', GUARD, str(repo), sha, str(helper)],
                              env=ENV, capture_output=True, timeout=10)

    def test_actual_archive_old_red_current_guard_green(self):
        with tempfile.TemporaryDirectory(prefix='control-archive-custody-') as folder:
            repo, sha, _ = self.scene(folder)
            old = self.archive(Path(folder)/'old', repo, sha, LINE.replace('-c tar.umask=0022 ', ''))
            self.assertEqual(old.stat().st_mode & 0o777, 0o664)
            self.assertNotEqual(self.guard(repo, sha, old).returncode, 0)
            helper = self.archive(Path(folder)/'fixed', repo, sha)
            self.assertEqual(helper.stat().st_mode & 0o777, 0o644)
            result = self.guard(repo, sha, helper)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(helper.read_bytes(), HELPER)

    def test_command_mask_does_not_depend_on_repository_configuration(self):
        with tempfile.TemporaryDirectory(prefix='control-archive-mask-') as folder:
            repo, sha, git = self.scene(folder)
            for index, mask in enumerate(('0000', '0002', '0077')):
                git('config', 'tar.umask', mask)
                helper = self.archive(Path(folder)/str(index), repo, sha)
                self.assertEqual(helper.stat().st_mode & 0o777, 0o644)
                self.assertEqual(self.guard(repo, sha, helper).returncode, 0)
                self.assertEqual(git('config', '--get', 'tar.umask'), mask)

    def test_unchanged_guard_refuses_tamper_symlink_and_writable_input(self):
        with tempfile.TemporaryDirectory(prefix='control-archive-refusal-') as folder:
            repo, sha, _ = self.scene(folder)
            cases = ['tamper', 'symlink', 'writable', 'oversize', 'directory']
            if os.geteuid() == 0: cases.append('foreign-owner')
            for index, case in enumerate(cases):
                helper = self.archive(Path(folder)/str(index), repo, sha)
                if case == 'tamper': helper.write_bytes(HELPER + b'\n# changed\n')
                if case == 'symlink': helper.unlink(); helper.symlink_to(repo/'server/scripts/quarantine-generated-control-cache.py')
                if case == 'writable': helper.chmod(0o664)
                if case == 'oversize': helper.write_bytes(b'x' * 65537)
                if case == 'directory': helper.unlink(); helper.mkdir()
                if case == 'foreign-owner': os.chown(helper, 65534, 65534)
                def state():
                    info = helper.lstat()
                    identity = (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                                info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
                    data = os.readlink(helper) if helper.is_symlink() else helper.read_bytes() if stat.S_ISREG(info.st_mode) else 'directory'
                    return identity, data
                before = state()
                self.assertNotEqual(self.guard(repo, sha, helper).returncode, 0)
                after = state()
                self.assertEqual(before, after)


if __name__ == '__main__':
    if sys.platform == 'linux' and os.geteuid() != 0:
        # One credential-free isolated fixture process on the existing Linux
        # runner; no production paths, network, host service or global Git write.
        raise SystemExit(subprocess.run(['sudo', '-n', '--preserve-env=TMPDIR', sys.executable,
                                        '-B', str(Path(__file__).resolve())], env=ENV).returncode)
    print('CONTROL_STAGING_ARCHIVE_NATIVE_UID=' + str(os.geteuid()), flush=True)
    unittest.main()
