"""A Backup copy is certified by the migrations it holds, never by a clock.

The incident (2026-11-08): Backup 42519319251 restored its copy at 20:38:05Z.
Migration 20261108193515 merged at 20:36:58Z and installed in production at
20:38:11Z, six seconds after the restore, so the copy lacked it. The old rules
compared the commit time with the restore time and called the copy fresh.
Run 42521781581 exported 21:37:58Z-21:42:51Z while 20261108210509 installed
at 21:38:56Z, and lacked it too: its smarter_private.weekly_payout_next_round()
hashed 86c572334023dd7a9231704cfc14868a against production's
332b762a004a779e32dc3fd2d1aef60d.

The contents are the Backup export's own schema evidence (#10113,
server/standby/schema-evidence.py), consumed by
server/scripts/engine-release-installed-migrations.py.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


im = load('installed', 'server/scripts/engine-release-installed-migrations.py')
se = load('schema_evidence', 'server/standby/schema-evidence.py')
sel = load('selector', 'scripts/ci/select-daily-engine.py')
sel.installed = lambda: im
_required, _windows = {}, {}
_real_required_by, _real_window_versions = im.required_by, im.window_versions


def _cached_required_by(repo, serving, target, skip=frozenset()):
    key = (repo, serving, target, frozenset(skip))
    if key not in _required:
        _required[key] = _real_required_by(repo, serving, target, skip)
    return _required[key]


def _cached_window_versions(repo, sha):
    if (repo, sha) not in _windows:
        _windows[(repo, sha)] = _real_window_versions(repo, sha)
    return _windows[(repo, sha)]


im.required_by, im.window_versions = _cached_required_by, _cached_window_versions
HELPER = str(ROOT / 'server/scripts/engine-release-installed-migrations.py')

FEEDER = '20261108193515'
WEEKLY = '20261108210509'
COMMITTED = '2026-11-08T20:36:58Z'      # merge commit of PR #10078
RESTORED = '2026-11-08T20:38:05Z'       # Backup 42519319251 restoredAt
INSTALLED = '2026-11-08T20:38:11Z'      # Apply Merged Migration 42521078335
PAYOUT = 'smarter_private.weekly_payout_next_round()'
DUMP = hashlib.sha256(b'dump bytes').hexdigest()

BASE = {f'202611{d:02d}000000': f'base_{d}' for d in range(1, 8)}
BEFORE = dict(BASE)                                                   # production at 20:38:05Z
AFTER = {**BASE, FEEDER: 'a_full_ring_feeder_starts_with_the_last_two_to_sit'}  # at 20:38:11Z
FUNCTIONS = {s: hashlib.sha256(s.encode()).hexdigest() for s in se.SIGNATURES}


def evidence(rows, functions=None, dump=DUMP):
    doc = {'schema': se.SCHEMA, 'capturedAt': RESTORED,
           'migrations': sorted([v, n] for v, n in rows.items()),
           'functions': dict(functions or FUNCTIONS), 'dumpSha256': dump}
    se.validate(doc)
    return json.dumps(doc, sort_keys=True, indent=2).encode() + b'\n'


def production(rows, functions=None):
    return {'migrations': dict(rows), 'functions': dict(functions or FUNCTIONS)}


def database(evidence_bytes, dump=DUMP):
    return {'restoredAt': RESTORED, 'dumpSha256': dump, 'schemaEvidenceValidated': True,
            'schemaEvidenceSha256': hashlib.sha256(evidence_bytes).hexdigest()}


class Contents(unittest.TestCase):
    def test_the_exact_incident_copy_lacks_the_migration_its_clock_called_fresh(self):
        # The superseded rule: newest migration COMMIT <= restoredAt.
        self.assertLess(sel.epoch(COMMITTED), sel.epoch(RESTORED))
        self.assertEqual(sel.epoch(INSTALLED) - sel.epoch(RESTORED), 6)
        difference = im.compare(BEFORE, AFTER)
        self.assertEqual(difference, {'missing': [FEEDER], 'extra': [], 'differs': []})
        self.assertIn('lacks installed migration ' + FEEDER, im.describe(difference))

    def test_the_set_digest_is_canonical_and_null_names_are_kept(self):
        rows = {**AFTER, 'manual': None}
        self.assertEqual(im.digest(rows), im.digest(dict(reversed(list(rows.items())))))
        self.assertNotEqual(im.digest(rows), im.digest(AFTER))
        with self.assertRaises(ValueError):
            im.rows_of([['x', 'a'], ['x', 'b']])
        with self.assertRaises(ValueError):
            im.rows_of([])


class RefreshDue(unittest.TestCase):
    def test_the_stale_copy_forces_a_refresh_and_a_matching_copy_does_not(self):
        stale = evidence(BEFORE)
        due, why = im.refresh_due(stale, hashlib.sha256(stale).hexdigest(), production(AFTER))
        self.assertTrue(due)
        self.assertIn('lacks installed migration ' + FEEDER, why)
        fresh = evidence(AFTER)
        self.assertFalse(im.refresh_due(fresh, hashlib.sha256(fresh).hexdigest(), production(AFTER))[0])

    def test_absent_or_unbound_evidence_is_due(self):
        fresh = evidence(AFTER)
        self.assertTrue(im.refresh_due(b'', '', production(AFTER))[0])
        self.assertTrue(im.refresh_due(fresh, 'f' * 64, production(AFTER))[0])

    def test_a_changed_definition_is_due_even_with_an_equal_set(self):
        fresh = evidence(AFTER, {**FUNCTIONS, PAYOUT: '0' * 64})
        due, why = im.refresh_due(fresh, hashlib.sha256(fresh).hexdigest(), production(AFTER))
        self.assertTrue(due)
        self.assertIn(PAYOUT, why)

    def test_the_command_reads_contents_and_an_unreadable_production_is_due(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy, prod = Path(tmp, 'copy.json'), Path(tmp, 'production.json')
            copy.write_bytes(evidence(BEFORE))
            prod.write_text(json.dumps({'migrations': sorted([v, n] for v, n in AFTER.items()),
                                        'functions': {s: s for s in se.SIGNATURES}}))
            run = lambda sha, p=prod: subprocess.run(
                ['python3', '-B', HELPER, 'refresh-due', '--copy-evidence', str(copy), '--copy-evidence-sha', sha,
                 '--production', str(p)], capture_output=True, text=True)
            self.assertIn('due=true', run(hashlib.sha256(copy.read_bytes()).hexdigest()).stdout)
            same = {s: hashlib.sha256(s.encode()).hexdigest() for s in se.SIGNATURES}
            copy.write_bytes(evidence(AFTER, same))
            self.assertIn('due=false', run(hashlib.sha256(copy.read_bytes()).hexdigest()).stdout)
            self.assertIn('due=true', run(hashlib.sha256(copy.read_bytes()).hexdigest(), Path(tmp, 'none')).stdout)

    def test_a_refresh_waits_for_a_merged_migration_production_has_not_installed(self):
        reads = iter([production(BEFORE), production(BEFORE), production(AFTER)])
        now = [0]
        rows, pending = im.await_installed({FEEDER}, lambda: next(reads), wait=60, pause=6,
                                           clock=lambda: now[0], sleep=lambda s: now.__setitem__(0, now[0] + s))
        self.assertEqual((rows['migrations'], pending), (AFTER, []))
        self.assertEqual(now[0], 12)
        _, pending = im.await_installed({FEEDER}, lambda: production(BEFORE), wait=10, pause=6,
                                        clock=lambda: now[0], sleep=lambda s: now.__setitem__(0, now[0] + s))
        self.assertEqual(pending, [FEEDER])


class InstalledDuringExport(unittest.TestCase):
    """Run 42521781581: 20261108210509 installed inside the export."""
    def test_the_export_bracket_refuses_a_dump_taken_while_a_migration_installed(self):
        before = json.loads(evidence(AFTER))
        after = json.loads(evidence({**AFTER, WEEKLY: 'weekly_rounds_respect_maintenance_admission'},
                                    {**FUNCTIONS, PAYOUT: '3' * 64}))
        with self.assertRaisesRegex(ValueError, 'changed'):
            se.compare(before, after)

    def test_a_copy_exported_under_the_older_set_is_never_selected(self):
        later = {**AFTER, WEEKLY: 'weekly_rounds_respect_maintenance_admission'}
        stale = evidence(AFTER, {**FUNCTIONS, PAYOUT: '8' * 64})
        ok, why = im.judge(stale, database(stale), production(later, {**FUNCTIONS, PAYOUT: '3' * 64}))
        self.assertFalse(ok)
        self.assertIn('lacks installed migration ' + WEEKLY, why)
        # Even with an equal set, the payout definition alone refuses.
        same_set = evidence(later, {**FUNCTIONS, PAYOUT: '8' * 64})
        ok, why = im.judge(same_set, database(same_set), production(later, {**FUNCTIONS, PAYOUT: '3' * 64}))
        self.assertFalse(ok)
        self.assertIn(PAYOUT, why)


class Selector(unittest.TestCase):
    SERVING, TARGET, CONTROL = ('391f7bc0d57c71637bd4af5181f70520661e3593',
                                '20c0ab1c93178c102a5b7353905fa1bee7b5ccb9',
                                '20c0ab1c93178c102a5b7353905fa1bee7b5ccb9')

    def certified(self, rows, functions=None, dump=DUMP, **db):
        owners = subprocess.check_output(['git', '-C', str(ROOT), 'show',
                                          self.CONTROL + ':server/standby/standby-owners.sql'])
        data = evidence(rows, functions, dump)
        return {'database': {**database(data), 'ownersSha256': hashlib.sha256(owners).hexdigest(), **db},
                'schemaEvidence': data}

    def judge(self, certified, prod):
        cwd = os.getcwd()
        os.chdir(ROOT)
        try:
            return sel.current_schema(self.CONTROL, certified, self.SERVING, self.TARGET, prod)
        finally:
            os.chdir(cwd)

    def candidate_set(self):
        return {**BASE, **im.required_by(str(ROOT), self.SERVING, self.TARGET)}

    def test_the_gate_rejects_the_exact_stale_copy(self):
        live = self.candidate_set()
        self.assertIn(FEEDER, live)
        stale = {v: n for v, n in live.items() if v != FEEDER}
        ok, why, diagnostics = self.judge(self.certified(stale), production(live))
        self.assertFalse(ok)
        self.assertIn('lacks installed migration ' + FEEDER, why)
        # The clock still says fresh; it is reported, never decisive.
        self.assertEqual(diagnostics['restoredAt'], RESTORED)
        self.assertIn('diagnosis only', diagnostics['note'])

    def test_a_matching_copy_is_accepted(self):
        live = self.candidate_set()
        ok, why, diagnostics = self.judge(self.certified(live), production(live))
        self.assertTrue(ok, why)
        self.assertGreaterEqual(diagnostics['requiredMigrations'], 1)

    def test_extra_or_renamed_copies_are_rejected(self):
        live = self.candidate_set()
        for copy, words in [({**live, '20261109000000': 'later'}, 'production does not have'),
                            ({**live, FEEDER: 'other'}, 'different name for ' + FEEDER)]:
            ok, why, _ = self.judge(self.certified(copy), production(live))
            self.assertFalse(ok)
            self.assertIn(words, why)

    def test_a_copy_equal_to_production_but_lacking_the_candidate_migration_is_rejected(self):
        live = {v: n for v, n in self.candidate_set().items() if v != FEEDER}
        ok, why, _ = self.judge(self.certified(live), production(live))
        self.assertFalse(ok)
        self.assertIn('lacks the exact candidate migration(s) ' + FEEDER, why)

    def test_a_definition_that_differs_from_production_is_rejected(self):
        live = self.candidate_set()
        ok, why, _ = self.judge(self.certified(live, {**FUNCTIONS, PAYOUT: '0' * 64}), production(live))
        self.assertFalse(ok)
        self.assertIn(PAYOUT, why)

    def test_unbound_tampered_or_absent_evidence_is_rejected(self):
        live = self.candidate_set()
        tampered = self.certified(live)
        tampered['schemaEvidence'] += b' '
        other_dump = self.certified(live, dump='e' * 64)
        unvalidated = self.certified(live, schemaEvidenceValidated=False)
        absent = self.certified(live)
        absent['schemaEvidence'] = None
        for case, words in [(tampered, 'not the evidence its copy recorded'), (other_dump, 'different dump'),
                            (unvalidated, 'did not validate'), (absent, 'records no installed schema evidence')]:
            ok, why, _ = self.judge(case, production(live))
            self.assertFalse(ok)
            self.assertIn(words, why)

    def test_the_selector_defers_the_stale_candidate_and_reads_production_once(self):
        live = self.candidate_set()
        stale = {v: n for v, n in live.items() if v != FEEDER}
        args = types.SimpleNamespace(repo='o/r', control=self.CONTROL, serving=self.SERVING)
        report = {'cutoffEpoch': 1, 'deferredCandidates': []}
        certified = {**self.certified(stale), 'rehearsedServingSha': self.SERVING,
                     'playerReconnectedBothDirections': True, 'rollbackAdoptionSeconds': 7, 'forwardAdoptionSeconds': 7}
        reads = []
        fake = types.SimpleNamespace(**{k: getattr(im, k) for k in dir(im) if not k.startswith('__')})
        fake.read_production_psql = lambda: reads.append(1) or production(live)
        cwd = os.getcwd()
        os.chdir(ROOT)
        try:
            with (patch.object(sel, 'git', side_effect=lambda *a: {('rev-list',): self.TARGET}.get(a[:1], '')
                               if a[0] != 'rev-parse' else self.SERVING),
                  patch.object(sel, 'statuses', return_value=[(self.TARGET, {}), ('a' * 40, {})]),
                  patch.object(sel, 'backup', side_effect=lambda *a: dict(certified)),
                  patch.object(sel, 'installed', new=lambda: fake)):
                sel.select(args, report)
        finally:
            os.chdir(cwd)
        self.assertEqual(report.get('outcome'), None)
        self.assertEqual(len(report['deferredCandidates']), 2)
        self.assertIn('lacks installed migration ' + FEEDER, report['deferredCandidates'][0]['reason'])
        self.assertEqual(len(reads), 1)


class Cutover(unittest.TestCase):
    TARGET = '20c0ab1c93178c102a5b7353905fa1bee7b5ccb9'

    def status(self, prod, certified):
        with tempfile.NamedTemporaryFile('w', delete=False) as handle:
            handle.write(prod if isinstance(prod, str) else json.dumps(sorted([v, n] for v, n in prod.items())))
        try:
            env = {**os.environ, 'ENGINE_INSTALLED_MIGRATIONS_PRODUCTION_FIXTURE': handle.name}
            return subprocess.run(['python3', '-B', HELPER, 'status', '--env-file', '/nonexistent',
                                   '--repo', str(ROOT), '--sha', self.TARGET, '--certified', certified],
                                  capture_output=True, text=True, env=env)
        finally:
            os.unlink(handle.name)

    def certified_digest(self, rows, sha=None):
        with tempfile.TemporaryDirectory() as tmp:
            data = evidence(rows)
            Path(tmp, 'e.json').write_bytes(data)
            Path(tmp, 'c.json').write_text(json.dumps({'sha': sha or self.TARGET, 'database': database(data)}))
            return subprocess.run(['python3', '-B', HELPER, 'certified-digest', '--evidence', str(Path(tmp, 'e.json')),
                                   '--certificate', str(Path(tmp, 'c.json')), '--repo', str(ROOT),
                                   '--sha', self.TARGET], capture_output=True, text=True)

    def test_cutover_passes_when_production_is_unchanged_since_certification(self):
        named = self.certified_digest(AFTER)
        self.assertEqual(named.returncode, 0, named.stderr)
        result = self.status(AFTER, named.stdout.strip())
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('READY', result.stdout)

    def test_cutover_refuses_when_production_installs_a_migration_after_certification(self):
        named = self.certified_digest(AFTER).stdout.strip()
        result = self.status({**AFTER, WEEKLY: 'weekly_rounds_respect_maintenance_admission'}, named)
        self.assertEqual(result.returncode, 1)
        self.assertIn('installed or changed after certification', result.stdout)

    def test_cutover_reads_unknown_and_absent_certificates_as_refusals_to_proceed(self):
        self.assertEqual(self.status('unreadable', im.digest(AFTER)).returncode, 3)
        self.assertEqual(self.status(AFTER, '').returncode, 1)
        self.assertEqual(self.certified_digest(AFTER, sha='b' * 40).returncode, 1)

    def test_the_certificate_names_the_set_and_an_older_certificate_names_none(self):
        rows = [{'context': 'backup-engine/certified', 'state': 'success',
                 'description': 'Certified on the Backup Engine; installed migrations ' + 'f' * 64}]
        with tempfile.NamedTemporaryFile('w', delete=False) as handle:
            json.dump(rows, handle)
        try:
            env = {**os.environ, 'ENGINE_INSTALLED_MIGRATIONS_STATUS_FIXTURE': handle.name}
            run = lambda: subprocess.run(['python3', '-B', HELPER, 'certified', '--sha', self.TARGET],
                                         capture_output=True, text=True, env=env)
            self.assertEqual(run().stdout.strip(), 'f' * 64)
            rows[0]['description'] = 'Certified on the Backup Engine: built, booted, crash-recovered and soaked'
            Path(handle.name).write_text(json.dumps(rows))
            self.assertEqual(run().returncode, 1)
            rows[0]['state'] = 'failure'
            Path(handle.name).write_text(json.dumps(rows))
            self.assertEqual(run().returncode, 1)
        finally:
            os.unlink(handle.name)



class SupersededFilesAreNeverRequired(unittest.TestCase):
    """2026-11-12: 20261112013714 (SUPERSEDED BY 20261112022726) deferred
    every candidate as 'Backup copy lacks the exact candidate migration(s)'
    although the applier refuses it by design and no copy can hold it."""

    def repo(self, files):
        root = tempfile.mkdtemp()
        run = lambda *a: subprocess.check_output(['git', '-C', root, *a])
        run('init', '-q')
        run('config', 'user.email', 't@t'); run('config', 'user.name', 't')
        (Path(root) / 'supabase/migrations').mkdir(parents=True)
        (Path(root) / 'supabase/migrations/20260101000000_base.sql').write_text('select 1;\n')
        run('add', '-A'); run('commit', '-qm', 'base')
        serving = run('rev-parse', 'HEAD').decode().strip()
        for name, body in files.items():
            (Path(root) / 'supabase/migrations' / name).write_text(body)
        run('add', '-A'); run('commit', '-qm', 'target')
        return root, serving, run('rev-parse', 'HEAD').decode().strip()

    def test_a_marked_file_with_its_successor_in_the_tree_is_not_required(self):
        root, serving, target = self.repo({
            '20261112013714_old.sql': '-- SUPERSEDED BY 20261112022726\nselect 1;\n',
            '20261112022726_new.sql': 'select 2;\n',
        })
        self.assertEqual(_real_required_by(root, serving, target), {'20261112022726': 'new'})

    def test_an_unverifiable_claim_stays_required(self):
        root, serving, target = self.repo({
            '20261112013714_old.sql': '-- SUPERSEDED BY 20991231000000\nselect 1;\n',
        })
        self.assertEqual(_real_required_by(root, serving, target), {'20261112013714': 'old'})

    def test_a_refresh_does_not_wait_for_a_superseded_file(self):
        root, _, target = self.repo({
            '20261112013714_old.sql': '-- SUPERSEDED BY 20261112022726\nselect 1;\n',
            '20261112022726_new.sql': 'select 2;\n',
        })
        waited = im.recently_added(root, target)
        self.assertNotIn('20261112013714', waited)
        self.assertIn('20261112022726', waited)

    def test_a_marker_past_the_header_is_ignored(self):
        root, serving, target = self.repo({
            '20261112013714_old.sql': ('-- x\n' * 120) + '-- SUPERSEDED BY 20261112022726\n',
            '20261112022726_new.sql': 'select 2;\n',
        })
        self.assertIn('20261112013714', _real_required_by(root, serving, target))

if __name__ == '__main__':
    unittest.main()
