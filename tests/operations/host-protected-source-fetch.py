#!/usr/bin/env python3
"""Execute all three maintained host fetch commands against isolated real Git."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
URL = 'https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena.git'
FILES = ['.github/workflows/auto-deploy-hetzner.yml',
         'server/scripts/install-engine-supervisor.sh',
         'server/scripts/engine-release-transaction.sh']
START = 'env -u GIT_CONFIG -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS'
END = "' -- \"$REPO_DIR\""
COMMANDS = []
for file in FILES:
    text = (ROOT/file).read_text()
    begin = text.index(START)
    COMMANDS.append(text[begin:text.index(END, begin)+len(END)])
REAL_GIT = shutil.which('git')
ENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
ENV.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
           GIT_TERMINAL_PROMPT='0')

class PublicProtectedSource(unittest.TestCase):
    def scene(self, folder):
        folder = Path(folder)
        upstream = folder/'upstream'; upstream.mkdir()
        repo = folder/'repo'; repo.mkdir()
        def git(where, *args):
            return subprocess.check_output([REAL_GIT, '-C', str(where), *args], env=ENV,
                                           stderr=subprocess.PIPE, timeout=10).decode().strip()
        for where in (upstream, repo):
            git(where, 'init', '--template=', '-q', '-b', 'main')
            git(where, 'config', 'user.name', 'Public source fixture')
            git(where, 'config', 'user.email', 'fixture@example.invalid')
        (upstream/'source').write_text('protected source')
        git(upstream, 'add', '.'); git(upstream, 'commit', '-qm', 'protected')
        target = git(upstream, 'rev-parse', 'HEAD')
        git(repo, 'remote', 'add', 'origin', 'git@github.com:unavailable/poisoned.git')
        (repo/'foreign').write_text('unrelated history')
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'foreign')
        foreign = git(repo, 'rev-parse', 'HEAD')
        binary = folder/'bin'; binary.mkdir()
        marker = folder/'transport.json'
        shim = binary/'git'
        shim.write_text('#!' + shutil.which('python3') + '\n' + '''import json, os, sys
from pathlib import Path
args = sys.argv[1:]
if 'fetch' in args:
    assert args[-2:] == [os.environ['FIXTURE_CANONICAL'], '+refs/heads/main:refs/remotes/origin/main']
    assert 'origin' not in args
    for option in ('credential.helper=', 'core.askPass=/bin/false', 'http.extraHeader=',
                   'http.followRedirects=false', 'http.sslVerify=true',
                   'protocol.allow=never', 'protocol.https.allow=always'):
        assert option in args, option
    assert os.environ['GIT_CONFIG_GLOBAL'] == '/dev/null'
    assert os.environ['GIT_CONFIG_NOSYSTEM'] == '1'
    assert os.environ['GIT_TERMINAL_PROMPT'] == '0'
    for name in ('GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
                 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_SSL_NO_VERIFY'):
        assert name not in os.environ, name
    Path(os.environ['FIXTURE_MARKER']).write_text(json.dumps(args))
    if os.environ.get('FIXTURE_FAIL') == '1': sys.exit(73)
    args[-2] = os.environ['FIXTURE_UPSTREAM']
    # Only the isolated test adapter admits file transport; production never does.
    args = ['-c', 'protocol.file.allow=always'] + args
os.execv(os.environ['FIXTURE_GIT'], [os.environ['FIXTURE_GIT']] + args)
''')
        shim.chmod(0o755)
        hostile = folder/'global-config'
        hostile.write_text('[url "ssh://forbidden.invalid/"]\n insteadOf = https://github.com/\n')
        env = {**ENV, 'PATH': str(binary)+os.pathsep+ENV['PATH'], 'REPO_DIR': str(repo),
               'FIXTURE_GIT': REAL_GIT, 'FIXTURE_UPSTREAM': str(upstream),
               'FIXTURE_CANONICAL': URL, 'FIXTURE_MARKER': str(marker),
               'GIT_CONFIG_GLOBAL': str(hostile), 'GIT_ASKPASS': '/never-run',
               'SSH_ASKPASS': '/never-run', 'GIT_SSL_NO_VERIFY': '1'}
        return repo, target, foreign, marker, env, git

    def test_actual_callers_fetch_exact_main_without_host_ssh_or_configuration_writes(self):
        for command in COMMANDS:
            with self.subTest(command=command[:60]), tempfile.TemporaryDirectory() as folder:
                repo, target, foreign, marker, env, git = self.scene(folder)
                before = (repo/'.git/config').read_bytes()
                result = subprocess.run(['bash', '-euo', 'pipefail', '-c', command], env=env,
                                        capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(marker.exists())
                self.assertEqual(git(repo, 'rev-parse', 'origin/main'), target)
                self.assertEqual((repo/'.git/config').read_bytes(), before)
                self.assertEqual(git(repo, 'rev-parse', 'HEAD'), foreign)
                self.assertEqual(subprocess.run([REAL_GIT, '-C', str(repo), 'merge-base',
                    '--is-ancestor', target, 'origin/main'], env=ENV).returncode, 0)
                self.assertNotEqual(subprocess.run([REAL_GIT, '-C', str(repo), 'merge-base',
                    '--is-ancestor', foreign, 'origin/main'], env=ENV).returncode, 0)

    def test_local_redirect_headers_and_include_refuse_without_transport_or_mutation(self):
        for command in COMMANDS:
            for key, value in [('url.https://wrong.invalid/.insteadOf', 'https://github.com/'),
                               ('http.https://github.com/.extraheader', 'fixture-header'),
                               ('include.path', '/nonexistent')]:
                with self.subTest(key=key), tempfile.TemporaryDirectory() as folder:
                    repo, _, _, marker, env, git = self.scene(folder)
                    git(repo, 'config', key, value)
                    before = (repo/'.git/config').read_bytes()
                    result = subprocess.run(['bash', '-euo', 'pipefail', '-c', command], env=env,
                                            capture_output=True, timeout=15)
                    self.assertEqual(result.returncode, 78, result.stderr)
                    self.assertFalse(marker.exists())
                    self.assertEqual((repo/'.git/config').read_bytes(), before)

    def test_unavailable_source_refuses_without_advancing_main(self):
        for command in COMMANDS:
            with tempfile.TemporaryDirectory() as folder:
                repo, _, foreign, marker, env, git = self.scene(folder)
                result = subprocess.run(['bash', '-euo', 'pipefail', '-c', command],
                    env={**env, 'FIXTURE_FAIL': '1'}, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 73, result.stderr)
                self.assertTrue(marker.exists())
                self.assertEqual(git(repo, 'rev-parse', 'HEAD'), foreign)
                self.assertNotEqual(subprocess.run([REAL_GIT, '-C', str(repo), 'show-ref',
                    '--verify', '--quiet', 'refs/remotes/origin/main'], env=ENV).returncode, 0)

if __name__ == '__main__':
    unittest.main()
