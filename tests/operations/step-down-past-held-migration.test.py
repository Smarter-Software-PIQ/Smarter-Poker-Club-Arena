"""A held migration does not block the commit below it (O29, 2026-11-26).

The incident: main read, oldest to newest, c951436a6ead (server), a5e971803865
(release control), 6f062e8f0d1d (adds migration 20261126021630, held until
04:15 CST). Backup run 45758112198 answered DEFERRED for 6f062e8f and nothing
certified a5e97180, so the 01:00 CST cycle of 2026-11-26 kept serving.

Every case builds that shape in a real disposable git repository and runs the
real scripts/release/step-down-past-held-migration.py with the real release
control reader (scripts/ci/read-engine-prequalification.py) and the real
installed-migrations reader; production is a saved file and /health a file URL.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = str(ROOT / 'scripts/release/step-down-past-held-migration.py')
PREQUAL = str(ROOT / 'scripts/ci/read-engine-prequalification.py')
INSTALLED = str(ROOT / 'server/scripts/engine-release-installed-migrations.py')
HELD, HELD_TWO = '20261126021630', '20261126030000'
ENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sd = load('step_down', SCRIPT)
se = load('schema_evidence', str(ROOT / 'server/standby/schema-evidence.py'))


class Repo:
    def __init__(self, tmp):
        self.path = Path(tmp, 'repo')
        self.path.mkdir()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Step down fixture')
        self.git('config', 'commit.gpgsign', 'false')
        self.production = Path(tmp, 'production.json')
        self.installed([])

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.path), *args], text=True, env=ENV).strip()

    def commit(self, message, files):
        for name, text in files.items():
            target = self.path / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        self.git('add', '-A')
        self.git('commit', '-q', '-m', message)
        return self.git('rev-parse', 'HEAD')

    def installed(self, versions):
        # An empty installed set reads as unreadable production, so one old row is always present.
        self.production.write_text(json.dumps({'migrations': sorted([v, 'fixture'] for v in ['20260101000000', *versions]),
                                               'functions': {s: s for s in se.SIGNATURES}}))

    def health(self, sha, running=True):
        path = self.path.parent / 'health.json'
        path.write_text(json.dumps({'running': running, 'releaseSha': sha}))
        return path.as_uri()

    def run(self, *, sha, control, pending=HELD, serving='', producer=None, extra=()):
        result = subprocess.run(
            [sys.executable, '-B', SCRIPT, '--sha', sha, '--control', control, '--producer', producer or control,
             '--serving', serving, '--pending', pending, '--prequal', PREQUAL, '--installed-tool', INSTALLED,
             '--production', str(self.production), *extra],
            cwd=self.path, capture_output=True, text=True, env=ENV)
        return result.returncode, result.stdout.strip()


def tonight(repo):
    """serving, a server commit, a release-control commit, the migration commit, a later docs commit."""
    serving = repo.commit('serving build', {'server/src/a.ts': 'a\n',
                                            '.github/workflows/stage-engine-release.yml': 'v1\n'})
    server = repo.commit('engine change (c951436a)', {'server/src/a.ts': 'b\n'})
    control = repo.commit('release control change (a5e97180)', {'.github/workflows/stage-engine-release.yml': 'v2\n'})
    migration = repo.commit('fix with a migration (6f062e8f)',
                            {'supabase/migrations/%s_fix.sql' % HELD: 'SELECT 1;\n', 'src/x.ts': 'x\n'})
    docs = repo.commit('docs only', {'docs/note.md': 'n\n'})
    return serving, server, control, migration, docs


class StepDownPastHeldMigration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='o29-step-down-')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = Repo(self.tmp)

    def test_tonights_shape_steps_down_to_the_release_control_commit(self):
        serving, server, control, migration, _docs = tonight(self.repo)
        code, out = self.repo.run(sha=migration, control=migration, serving=serving)
        self.assertEqual((code, out), (0, 'fallback=' + control))
        self.assertNotEqual(control, server)

    def test_the_serving_build_is_read_from_health_when_no_seal_names_it(self):
        serving, _server, control, migration, docs = tonight(self.repo)
        code, out = self.repo.run(sha=docs, control=docs, extra=('--health-url', self.repo.health(serving)))
        self.assertEqual((code, out), (0, 'fallback=' + control))
        # A stopped engine or an unreadable /health is "could not tell", never a guess.
        for url in (self.repo.health(serving, running=False), Path(self.tmp, 'absent.json').as_uri()):
            code, out = self.repo.run(sha=migration, control=migration, extra=('--health-url', url))
            self.assertEqual(code, 3, out)
            self.assertIn('reason=the serving build could not be read', out)

    def test_no_fallback_when_the_commit_below_carries_different_release_controls(self):
        repo = self.repo
        serving = repo.commit('serving build', {'server/src/a.ts': 'a\n',
                                                '.github/workflows/stage-engine-release.yml': 'v1\n'})
        server = repo.commit('engine change', {'server/src/a.ts': 'b\n'})
        # The migration commit also rewrites a release control: the commit below differs from control.
        migration = repo.commit('migration and control', {'supabase/migrations/%s_fix.sql' % HELD: 'SELECT 1;\n',
                                                          '.github/workflows/stage-engine-release.yml': 'v2\n'})
        code, out = repo.run(sha=migration, control=migration, serving=serving)
        self.assertEqual(code, 1, out)
        self.assertIn(server[:12], out)
        self.assertIn('release controls that differ', out)

    def test_no_fallback_when_nothing_below_is_ahead_of_the_serving_build(self):
        repo = self.repo
        serving = repo.commit('serving build', {'server/src/a.ts': 'a\n'})
        migration = repo.commit('migration', {'supabase/migrations/%s_fix.sql' % HELD: 'SELECT 1;\n'})
        code, out = repo.run(sha=migration, control=migration, serving=serving)
        self.assertEqual(code, 1, out)
        self.assertIn('not ahead of the serving build', out)
        # The serving build itself already carries the held file: nothing below to certify.
        later = repo.commit('engine change', {'server/src/a.ts': 'c\n'})
        code, out = repo.run(sha=later, control=later, serving=migration)
        self.assertEqual(code, 1, out)
        self.assertIn('was not added between the serving build and this run\'s control', out)

    def test_two_held_migrations_step_below_the_older_one(self):
        repo = self.repo
        serving = repo.commit('serving build', {'server/src/a.ts': 'a\n'})
        below = repo.commit('engine change one', {'server/src/a.ts': 'b\n'})
        repo.commit('older migration', {'supabase/migrations/%s_one.sql' % HELD: 'SELECT 1;\n'})
        between = repo.commit('engine change two', {'server/src/a.ts': 'c\n'})
        newer = repo.commit('newer migration', {'supabase/migrations/%s_two.sql' % HELD_TWO: 'SELECT 1;\n'})
        for order in (HELD + ',' + HELD_TWO, HELD_TWO + ',' + HELD):
            code, out = repo.run(sha=newer, control=newer, serving=serving, pending=order)
            self.assertEqual((code, out), (0, 'fallback=' + below))
        # Only the newer one is still held: the commit between them is shippable.
        repo.installed([HELD])
        code, out = repo.run(sha=newer, control=newer, serving=serving, pending=HELD_TWO)
        self.assertEqual((code, out), (0, 'fallback=' + between))
        # The older one named as pending but the commit between still carries it uninstalled.
        repo.installed([])
        code, out = repo.run(sha=newer, control=newer, serving=serving, pending=HELD_TWO)
        self.assertEqual(code, 1, out)
        self.assertIn('itself carries uninstalled migration(s) ' + HELD, out)

    def test_a_target_already_below_the_held_migration_is_its_own_answer(self):
        # The post-seal shape: the target is main's newest server or control
        # commit, the run's control is main's head, the migration sits between.
        serving, _server, control, _migration, docs = tonight(self.repo)
        code, out = self.repo.run(sha=control, control=docs, serving=serving)
        self.assertEqual((code, out), (0, 'fallback=' + control))

    def test_an_explicit_sha_input_is_never_stepped_down(self):
        serving, _server, _control, migration, _docs = tonight(self.repo)
        code, out = self.repo.run(sha=migration, control=migration, serving=serving,
                                  extra=('--input-sha', migration))
        self.assertEqual((code, out), (1, 'reason=an explicit sha input is certified exactly as named'))

    def test_a_retargeted_run_is_never_stepped_down(self):
        # select-daily-engine.py admits control != producer only when control == sha.
        serving, _server, control, migration, docs = tonight(self.repo)
        code, out = self.repo.run(sha=docs, control=docs, producer=migration, serving=serving)
        self.assertEqual(code, 1, out)
        self.assertIn('retargeted', out)
        self.assertNotIn('fallback=', out)

    def test_an_unreadable_git_or_reader_is_could_not_tell(self):
        serving, _server, _control, migration, _docs = tonight(self.repo)
        # Production unreadable: the installed reader prints no pending= line.
        self.repo.production.unlink()
        code, out = self.repo.run(sha=migration, control=migration, serving=serving)
        self.assertEqual(code, 3, out)
        self.assertIn('installed migrations could not be read', out)
        self.repo.installed([])
        # The release-control reader is missing.
        code, out = self.repo.run(sha=migration, control=migration, serving=serving,
                                  extra=('--prequal', str(Path(self.tmp, 'absent.py'))))
        self.assertEqual(code, 3, out)
        # Not a git repository at all.
        empty = Path(self.tmp, 'empty')
        empty.mkdir()
        result = subprocess.run(
            [sys.executable, '-B', SCRIPT, '--sha', migration, '--control', migration, '--producer', migration,
             '--serving', serving, '--pending', HELD, '--prequal', PREQUAL, '--installed-tool', INSTALLED,
             '--production', str(self.repo.production)],
            cwd=empty, capture_output=True, text=True, env={**ENV, 'GIT_CEILING_DIRECTORIES': self.tmp})
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertNotIn('fallback=', result.stdout)
        # Malformed identities are never an answer about a commit.
        for bad in ({'sha': 'main'}, {'pending': 'not-a-version'}):
            code, out = self.repo.run(**{'sha': migration, 'control': migration, 'serving': serving, **bad})
            self.assertEqual(code, 3, out)

    def test_decide_folds_a_failed_injected_reader_into_unknown_only(self):
        serving, _server, control, migration, _docs = tonight(self.repo)

        def git(*args):
            result = subprocess.run(['git', '-C', str(self.repo.path), *args], capture_output=True, text=True, env=ENV)
            return result.returncode, result.stdout

        def boom(*_args):
            raise sd.Unreadable('reader down')

        base = dict(sha=migration, control=migration, producer=migration, serving=serving, pending=[HELD],
                    input_sha='', git=git, projection=lambda sha: 'same',
                    control_inputs=lambda: ['.github/workflows/stage-engine-release.yml'],
                    pending_reader=lambda sha: [])
        self.assertEqual(sd.decide(**base), (0, control))
        for name in ('projection', 'control_inputs', 'pending_reader'):
            self.assertEqual(sd.decide(**{**base, name: boom}), (3, 'reader down'))
        self.assertEqual(sd.decide(**{**base, 'git': lambda *a: (128, '')})[0], 3)
        self.assertEqual(sd.decide(**{**base, 'control_inputs': lambda: []})[0], 3)
        self.assertEqual(sd.decide(**{**base, 'serving': ''})[0], 3)

    def test_o37_held_migration_skips_prequal_failed_commit_below_it(self):
        # 2026-11-27 13:31 CST incident: f9abf5eb carried an uninstallable migration,
        # ec879864 below it had already failed Engine release prequalification, and
        # a044fa56 below that was good. Stepping down skips ec879864 to a044fa56.
        repo = self.repo
        serving = repo.commit('serving build', {'server/src/a.ts': 'a\n'})
        good = repo.commit('good build (a044fa56)', {'server/src/a.ts': 'b\n'})
        bad_pq = repo.commit('failed prequal (ec879864)', {'server/src/a.ts': 'c\n'})
        migration = repo.commit('held migration (f9abf5eb)',
                                {'supabase/migrations/%s_fix.sql' % HELD: 'SELECT 1;\n'})

        def git(*args):
            result = subprocess.run(['git', '-C', str(repo.path), *args], capture_output=True, text=True, env=ENV)
            return result.returncode, result.stdout

        res = sd.decide(
            sha=migration, control=migration, producer=migration, serving=serving, pending=[HELD],
            input_sha='', git=git, projection=lambda _sha: 'same',
            control_inputs=lambda: ['.github/workflows/stage-engine-release.yml'],
            pending_reader=lambda _sha: [],
            prequal_reader=lambda c: 'failed' if c == bad_pq else 'passed',
            backup_reader=lambda _c: 'missing',
        )
        self.assertEqual(res, (0, good))

    def test_o37_skip_failed_prequal_walks_past_multiple_bad_commits_to_first_good(self):
        # 2026-11-27 07:00 CST incident: two newest commits failed prequalification
        # in 4m; stepping down with allow_empty_pending=True lands on the good commit
        # below them instead of spending 108m certifying unselectable commits.
        repo = self.repo
        serving = repo.commit('serving build', {'server/src/a.ts': 'a\n'})
        good = repo.commit('good build', {'server/src/a.ts': 'b\n'})
        bad_backup = repo.commit('failed backup', {'server/src/a.ts': 'c\n'})
        bad_pq_1 = repo.commit('failed prequal 1', {'server/src/a.ts': 'd\n'})
        bad_pq_2 = repo.commit('failed prequal 2', {'server/src/a.ts': 'e\n'})

        def git(*args):
            result = subprocess.run(['git', '-C', str(repo.path), *args], capture_output=True, text=True, env=ENV)
            return result.returncode, result.stdout

        res = sd.decide(
            sha=bad_pq_2, control=bad_pq_2, producer=bad_pq_2, serving=serving, pending=[],
            input_sha='', git=git, projection=lambda _sha: 'same',
            control_inputs=lambda: ['.github/workflows/stage-engine-release.yml'],
            pending_reader=lambda _sha: [],
            prequal_reader=lambda c: 'failed' if c in (bad_pq_1, bad_pq_2) else 'passed',
            backup_reader=lambda c: 'failure' if c == bad_backup else 'missing',
            allow_empty_pending=True,
        )
        self.assertEqual(res, (0, good))

        # Unknown prequalification (API unreadable) is NEVER treated as failed (CLAUDE.md 10.86),
        # AND BUG 1B: with allow_empty_pending=True the caller already proved `sha` itself
        # failed prequalification, so the walk starts strictly below `sha` (`sha^1`), never
        # re-querying or returning `sha` itself.
        seen_prequal = []
        res_unknown = sd.decide(
            sha=bad_pq_2, control=bad_pq_2, producer=bad_pq_2, serving=serving, pending=[],
            input_sha='', git=git, projection=lambda _sha: 'same',
            control_inputs=lambda: ['.github/workflows/stage-engine-release.yml'],
            pending_reader=lambda _sha: [],
            prequal_reader=lambda c: (seen_prequal.append(c), 'unknown')[1],
            backup_reader=lambda _c: 'unknown',
            allow_empty_pending=True,
        )
        self.assertEqual(res_unknown, (0, bad_pq_1))
        self.assertNotIn(bad_pq_2, seen_prequal)

        # Even when a held migration sits above `sha` (control == producer == mig_above),
        # allow_empty_pending=True excludes `sha` itself.
        mig_above = repo.commit('held migration above failed sha',
                                {'supabase/migrations/%s_fix.sql' % HELD: 'SELECT 1;\n'})
        res_below_mig = sd.decide(
            sha=bad_pq_2, control=mig_above, producer=mig_above, serving=serving,
            pending=['  ' + HELD + '\n'],
            input_sha='', git=git, projection=lambda _sha: 'same',
            control_inputs=lambda: ['.github/workflows/stage-engine-release.yml'],
            pending_reader=lambda _sha: [],
            prequal_reader=lambda _c: 'unknown',
            backup_reader=lambda _c: 'unknown',
            allow_empty_pending=True,
        )
        self.assertEqual(res_below_mig, (0, bad_pq_1))
        self.assertNotEqual(res_below_mig[1], mig_above)

    def test_o37_walk_stops_at_release_control_mismatch_and_reports_none_when_exhausted(self):
        repo = self.repo
        serving = repo.commit('serving build', {'server/src/a.ts': 'a\n',
                                                '.github/workflows/stage-engine-release.yml': 'v1\n'})
        old_ctrl = repo.commit('below control change', {'server/src/a.ts': 'b\n'})
        new_ctrl = repo.commit('control change that failed prequal',
                               {'.github/workflows/stage-engine-release.yml': 'v2\n'})

        def git(*args):
            result = subprocess.run(['git', '-C', str(repo.path), *args], capture_output=True, text=True, env=ENV)
            return result.returncode, result.stdout

        code, reason = sd.decide(
            sha=new_ctrl, control=new_ctrl, producer=new_ctrl, serving=serving, pending=[],
            input_sha='', git=git,
            projection=lambda c: 'v2' if c == new_ctrl else 'v1',
            control_inputs=lambda: ['.github/workflows/stage-engine-release.yml'],
            pending_reader=lambda _sha: [],
            prequal_reader=lambda c: 'failed' if c == new_ctrl else 'passed',
            allow_empty_pending=True,
        )
        self.assertEqual(code, 1)
        self.assertIn('release controls that differ', reason)
        self.assertNotIn(old_ctrl, reason)

        # With an additional failed-prequal commit above the control boundary, both reasons are summarized.
        bad_above_ctrl = repo.commit('second failed prequal on v2', {'server/src/a.ts': 'c\n'})
        code2, reason2 = sd.decide(
            sha=bad_above_ctrl, control=bad_above_ctrl, producer=bad_above_ctrl, serving=serving, pending=[],
            input_sha='', git=git,
            projection=lambda c: 'v2' if c in (new_ctrl, bad_above_ctrl) else 'v1',
            control_inputs=lambda: ['.github/workflows/stage-engine-release.yml'],
            pending_reader=lambda _sha: [],
            prequal_reader=lambda c: 'failed' if c in (new_ctrl, bad_above_ctrl) else 'passed',
            allow_empty_pending=True,
        )
        self.assertEqual(code2, 1)
        self.assertIn('failed prequalification', reason2)
        self.assertIn('different release controls', reason2)
        self.assertNotIn(old_ctrl, reason2)

    def test_o37_check_prequal_only_mode_reports_unknown_without_network(self):
        sha = 'a' * 40
        result = subprocess.run(
            [sys.executable, '-B', SCRIPT, '--check-prequal-only', '--sha', sha, '--repo', ''],
            cwd=self.repo.path, capture_output=True, text=True, env=ENV)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'prequal=unknown')

    def test_o37b_prequal_state_enforces_read_engine_prequalification_trust_predicates(self):
        from unittest.mock import patch

        sha = 'a' * 40
        repo = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena'
        base_run = {
            'id': 999,
            'head_sha': sha,
            'head_branch': 'main',
            'event': 'push',
            'path': '.github/workflows/engine-release-prequalification.yml',
            'repository': {'full_name': repo},
            'head_repository': {'full_name': repo},
            'status': 'completed',
            'conclusion': 'success',
        }

        def fake_run(payload, rc=0):
            return subprocess.CompletedProcess(
                args=['gh'], returncode=rc,
                stdout=json.dumps(payload) if isinstance(payload, dict) else str(payload),
                stderr='',
            )

        with patch.object(sd.subprocess, 'run', return_value=fake_run({'workflow_runs': [base_run]})):
            self.assertEqual(sd.prequal_state(repo, sha), ('passed', '999', 'success'))
        for bad_conclusion in ('failure', 'cancelled', 'timed_out'):
            with patch.object(sd.subprocess, 'run',
                              return_value=fake_run({'workflow_runs': [{**base_run, 'conclusion': bad_conclusion}]})):
                self.assertEqual(sd.prequal_state(repo, sha), ('failed', '999', bad_conclusion))
        with patch.object(sd.subprocess, 'run',
                          return_value=fake_run({'workflow_runs': [{**base_run, 'status': 'in_progress', 'conclusion': ''}]})):
            self.assertEqual(sd.prequal_state(repo, sha), ('pending', '999', ''))
        with patch.object(sd.subprocess, 'run', return_value=fake_run({'workflow_runs': []})):
            self.assertEqual(sd.prequal_state(repo, sha), ('absent', '', ''))

        # Any untrusted provenance field fails safe to 'unknown' (CLAUDE.md 10.86),
        # matching scripts/ci/read-engine-prequalification.py.
        for field, bad_val in (
            ('head_sha', 'b' * 40),
            ('head_branch', 'feature'),
            ('event', 'pull_request'),
            ('path', '.github/workflows/other.yml'),
            ('repository', {'full_name': 'fork/other'}),
            ('head_repository', {'full_name': 'fork/other'}),
        ):
            with self.subTest(field=field), patch.object(
                    sd.subprocess, 'run',
                    return_value=fake_run({'workflow_runs': [{**base_run, field: bad_val}]})):
                self.assertEqual(sd.prequal_state(repo, sha), ('unknown', '', ''))

        with patch.object(sd.subprocess, 'run', return_value=fake_run('', rc=1)):
            self.assertEqual(sd.prequal_state(repo, sha), ('unknown', '', ''))


if __name__ == '__main__':
    unittest.main()
