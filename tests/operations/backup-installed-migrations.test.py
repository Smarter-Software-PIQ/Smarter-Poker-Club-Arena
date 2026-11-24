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

    def test_refresh_due_emits_pending_versions_and_omits_when_unreadable(self):
        with tempfile.TemporaryDirectory(prefix='refresh-due-pending-') as tmp:
            repo = Path(tmp, 'repo')
            repo.mkdir()
            run_git = lambda *a: subprocess.check_output(['git', '-C', str(repo), *a], text=True).strip()
            run_git('init', '-q')
            run_git('config', 'user.email', 'fixture@example.invalid')
            run_git('config', 'user.name', 'Migration fixture')
            mig_dir = repo / 'supabase' / 'migrations'
            mig_dir.mkdir(parents=True)
            (mig_dir / '20261122025656_share_previews.sql').write_text('SELECT 1;\n')
            (mig_dir / '20261122025900_hu_wait_mode.sql').write_text('SELECT 1;\n')
            (mig_dir / '20261122030000_window_only.sql').write_text(
                '-- @install-window: daily-maintenance\nSELECT 1;\n')
            run_git('add', '.')
            run_git('commit', '-qm', 'add frozen migrations')
            control = run_git('rev-parse', 'HEAD')
            copy, prod = Path(tmp, 'copy.json'), Path(tmp, 'production.json')
            same = {s: hashlib.sha256(s.encode()).hexdigest() for s in se.SIGNATURES}
            copy.write_bytes(evidence(AFTER, same))
            prod.write_text(json.dumps({'migrations': sorted([v, n] for v, n in AFTER.items()),
                                        'functions': {s: s for s in se.SIGNATURES}}))
            sha = hashlib.sha256(copy.read_bytes()).hexdigest()
            # Two ordinary recently-added migrations absent from production; window migration excluded.
            res = subprocess.run(
                ['python3', '-B', HELPER, 'refresh-due', '--repo', str(repo),
                 '--copy-evidence', str(copy), '--copy-evidence-sha', sha,
                 '--production', str(prod), '--control', control, '--wait', '1'],
                capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn('due=false\n', res.stdout)
            self.assertIn('pending=20261122025656,20261122025900\n', res.stdout)
            self.assertNotIn('20261122030000', res.stdout)
            # Once both ordinary migrations are installed, pending= is empty.
            installed = {**AFTER, '20261122025656': 'share_previews', '20261122025900': 'hu_wait_mode'}
            prod.write_text(json.dumps({'migrations': sorted([v, n] for v, n in installed.items()),
                                        'functions': {s: s for s in se.SIGNATURES}}))
            res_ok = subprocess.run(
                ['python3', '-B', HELPER, 'refresh-due', '--repo', str(repo),
                 '--copy-evidence', str(copy), '--copy-evidence-sha', sha,
                 '--production', str(prod), '--control', control, '--wait', '1'],
                capture_output=True, text=True)
            self.assertEqual(res_ok.returncode, 0, res_ok.stderr)
            self.assertIn('pending=\n', res_ok.stdout)
            # Unreadable production omits pending= (fail-open, never falsely defers).
            res_err = subprocess.run(
                ['python3', '-B', HELPER, 'refresh-due', '--repo', str(repo),
                 '--copy-evidence', str(copy), '--copy-evidence-sha', sha,
                 '--production', str(Path(tmp, 'missing.json')), '--control', control, '--wait', '1'],
                capture_output=True, text=True)
            self.assertEqual(res_err.returncode, 0, res_err.stderr)
            self.assertIn('due=true\n', res_err.stdout)
            self.assertNotIn('pending=', res_err.stdout)
            self.assertNotIn('comparable=', res_err.stdout)

    def test_refresh_due_emits_comparable_digest_excluding_window_versions(self):
        with tempfile.TemporaryDirectory(prefix='refresh-due-comparable-') as tmp:
            repo = Path(tmp, 'repo')
            repo.mkdir()
            run_git = lambda *a: subprocess.check_output(['git', '-C', str(repo), *a], text=True).strip()
            run_git('init', '-q')
            run_git('config', 'user.email', 'fixture@example.invalid')
            run_git('config', 'user.name', 'Migration fixture')
            mig_dir = repo / 'supabase' / 'migrations'
            mig_dir.mkdir(parents=True)
            (mig_dir / '20261122030000_window_only.sql').write_text(
                '-- @install-window: daily-maintenance\nSELECT 1;\n')
            run_git('add', '.')
            run_git('commit', '-qm', 'add window migration')
            cand = run_git('rev-parse', 'HEAD')
            # Production includes the window version; comparable digest must exclude it.
            with_window = {**AFTER, '20261122030000': 'window_only'}
            copy, prod = Path(tmp, 'copy.json'), Path(tmp, 'production.json')
            same = {s: hashlib.sha256(s.encode()).hexdigest() for s in se.SIGNATURES}
            copy.write_bytes(evidence(with_window, same))
            prod.write_text(json.dumps({'migrations': sorted([v, n] for v, n in with_window.items()),
                                        'functions': {s: s for s in se.SIGNATURES}}))
            sha = hashlib.sha256(copy.read_bytes()).hexdigest()
            expected_comparable = im.digest(AFTER)
            res = subprocess.run(
                ['python3', '-B', HELPER, 'refresh-due', '--repo', str(repo),
                 '--copy-evidence', str(copy), '--copy-evidence-sha', sha,
                 '--production', str(prod), '--sha', cand],
                capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn(f'production={im.digest(with_window)}\n', res.stdout)
            self.assertIn(f'comparable={expected_comparable}\n', res.stdout)
            # Fallback to --control when --sha is omitted.
            res_ctrl = subprocess.run(
                ['python3', '-B', HELPER, 'refresh-due', '--repo', str(repo),
                 '--copy-evidence', str(copy), '--copy-evidence-sha', sha,
                 '--production', str(prod), '--control', cand],
                capture_output=True, text=True)
            self.assertEqual(res_ctrl.returncode, 0, res_ctrl.stderr)
            self.assertIn(f'comparable={expected_comparable}\n', res_ctrl.stdout)
            # Omit comparable= when neither --sha nor --control is supplied (fail-open).
            res_none = subprocess.run(
                ['python3', '-B', HELPER, 'refresh-due', '--repo', str(repo),
                 '--copy-evidence', str(copy), '--copy-evidence-sha', sha,
                 '--production', str(prod)],
                capture_output=True, text=True)
            self.assertEqual(res_none.returncode, 0, res_none.stderr)
            self.assertNotIn('comparable=', res_none.stdout)


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


class RecordedCandidateNames(unittest.TestCase):
    VERSION = '20261116044125'
    FILE = 'supabase/migrations/20261116044125_whole_chip_split.sql'
    NAME = 'a_shared_mystery_chest_settles_in_the_whole_chips_it_was_split_in'
    MANIFEST = 'scripts/ci/recorded-migrations.manifest.json'
    SQL = b'SELECT 1;\r\n'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='recorded-candidate-')
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.run_git('init', '-q')
        self.run_git('config', 'user.email', 'fixture@example.invalid')
        self.run_git('config', 'user.name', 'Migration fixture')
        self.run_git('commit', '-qm', 'before', '--allow-empty')
        self.before = self.run_git('rev-parse', 'HEAD')
        self.row = {'version': self.VERSION, 'name': self.NAME, 'file': self.FILE,
                    'md5': hashlib.md5(self.SQL).hexdigest()}

    def run_git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True).strip()

    def commit(self, rows=None, raw=None, extra=None):
        path = self.repo / self.FILE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.SQL)
        if extra:
            (self.repo / extra).write_bytes(self.SQL)
        manifest = self.repo / self.MANIFEST
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(raw if raw is not None else json.dumps(
            {'recordings': [self.row] if rows is None else rows}))
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'candidate')
        return self.run_git('rev-parse', 'HEAD')

    def required(self, target):
        return _real_required_by(str(self.repo), self.before, target)

    def test_recorded_name_is_taken_from_exact_target_and_exact_bytes(self):
        target = self.commit()
        # Neither mutable checkout bytes nor a newer checkout manifest owns target.
        (self.repo / self.FILE).write_bytes(b'changed after commit')
        (self.repo / self.MANIFEST).write_text('{broken checkout')
        required = self.required(target)
        self.assertEqual(required, {self.VERSION: self.NAME})
        live = {self.VERSION: self.NAME}
        data = evidence(live)
        self.assertTrue(im.judge(data, database(data), production(live), required)[0])
        wrong = {self.VERSION: 'whole_chip_split'}
        data = evidence(wrong)
        self.assertFalse(im.judge(data, database(data), production(wrong), required)[0])

    def test_unrecorded_and_matching_normal_files_keep_filename_names(self):
        self.assertEqual(self.required(self.commit(rows=[])), {self.VERSION: 'whole_chip_split'})

    def test_matching_filename_recording_is_still_byte_bound(self):
        self.row['name'] = 'whole_chip_split'
        self.assertEqual(self.required(self.commit()), {self.VERSION: 'whole_chip_split'})

    def test_changed_recorded_bytes_refuse(self):
        self.row['md5'] = hashlib.md5(b'other SQL').hexdigest()
        with self.assertRaises(ValueError):
            self.required(self.commit())

    def test_malformed_manifest_refuses(self):
        with self.assertRaises(ValueError):
            self.required(self.commit(raw='{broken'))

    def test_repeated_json_fields_refuse(self):
        with self.assertRaises(ValueError):
            self.required(self.commit(raw='{"recordings":[],"recordings":' + json.dumps([self.row]) + '}'))

    def test_original_44_target_uses_its_recorded_installed_name(self):
        required = _real_required_by(str(ROOT), '3529e86663daa427b380a8ab9bd09347270c670e',
                                     '44c1bde95b30adf12cd11bc46c4bbfc4a6fc4e19')
        self.assertEqual(required[self.VERSION], self.NAME)

    def test_malformed_claims_refuse(self):
        for field, value in [('version', 'not-a-version'), ('name', ''), ('md5', 'bad'),
                             ('file', 'supabase/migrations/../outside.sql')]:
            with self.subTest(field=field):
                row = {**self.row, field: value}
                with self.assertRaises(ValueError):
                    self.required(self.commit(rows=[row]))

    def test_duplicate_manifest_versions_refuse(self):
        with self.assertRaises(ValueError):
            self.required(self.commit(rows=[self.row, self.row]))

    def test_manifest_path_version_and_candidate_path_must_match(self):
        self.row['file'] = 'supabase/migrations/20261116044126_other.sql'
        with self.assertRaises(ValueError):
            self.required(self.commit())

    def test_same_version_other_path_is_not_an_alias(self):
        self.row['file'] = 'supabase/migrations/20261116044125_other.sql'
        with self.assertRaises(ValueError):
            self.required(self.commit())

    def test_candidate_version_collision_refuses(self):
        with self.assertRaises(ValueError):
            self.required(self.commit(extra='supabase/migrations/20261116044125_other.sql'))

    def test_operator_preflight_uses_the_same_all_ordinary_candidate_requirements(self):
        target = self.commit()
        saved = self.repo / 'production.json'
        def run(rows):
            saved.write_text(json.dumps({'migrations': rows}))
            return subprocess.run(['python3', '-B', HELPER, 'candidate-ready', '--repo', str(self.repo),
                                   '--serving', self.before, '--sha', target,
                                   '--production', str(saved)], capture_output=True, text=True)
        self.assertEqual(run([[self.VERSION, self.NAME]]).returncode, im.READY)
        self.assertEqual(run([[self.VERSION, self.NAME[:55]]]).returncode, im.READY)
        for rows in ([[self.VERSION, 'whole_chip_split']], [['20261116044126', 'other']]):
            refused = run(rows)
            self.assertEqual(refused.returncode, im.REFUSED, refused.stdout + refused.stderr)
            self.assertIn(self.VERSION, refused.stdout)
        self.assertEqual(run('unreadable').returncode, im.UNKNOWN)


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
        # O23: the extra version must be one Club Arena ships (a version no tree
        # ships is foreign and not compared; see ForeignMigration).
        shipped = im.tree_versions(str(ROOT), self.TARGET, self.CONTROL)
        extra = max(v for v in shipped if len(v) == 14 and v not in live)
        for copy, words in [({**live, extra: 'later'}, 'production does not have ' + extra),
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


class SupersededFile(unittest.TestCase):
    """2026-11-12: #10558 added 20261112013714; #10561 marked it "SUPERSEDED BY
    20261112022726" and the applier refused it ("must never run") while the
    successor installed. Every later candidate was deferred as lacking
    20261112013714, a file production can never record."""
    BEFORE = '08cdcf0adb48859c6683a3f5a6786cc3680602db'
    ADDED = '4850f85345272627c1b07af38e938e84095ab195'
    MARKED = '27f24451615207a80d7dbff0520f33c609ef47e9'

    def test_a_superseded_file_is_not_required_and_its_successor_is(self):
        required = _real_required_by(str(ROOT), self.BEFORE, self.MARKED)
        self.assertNotIn('20261112013714', required)
        self.assertEqual(required.get('20261112022726'), 'the_nightly_20k_rebuy_pays_the_starting_stack')
        self.assertEqual(im.superseded_versions(str(ROOT), self.MARKED) & {'20261112013714'}, {'20261112013714'})

    def test_an_unmarked_file_is_still_required(self):
        required = _real_required_by(str(ROOT), self.BEFORE, self.ADDED)
        self.assertEqual(required.get('20261112013714'), 'unfinished_rebuys_pay_the_starting_stack')

    def test_supersession_resolves_fail_closed(self):
        resolve = im.resolve_superseded
        present = {'A', 'B', 'C', 'D', 'E'}
        # Two files naming each other: neither is removed.
        self.assertEqual(resolve({'A': 'B', 'B': 'A'}, present), set())
        # A tail into a cycle removes nothing either.
        self.assertEqual(resolve({'A': 'B', 'B': 'C', 'C': 'B'}, present), set())
        # A chain to an unmarked present file removes every link before it.
        self.assertEqual(resolve({'A': 'B', 'B': 'C'}, present), {'A', 'B'})
        # A successor missing from the tree keeps its predecessor required.
        self.assertEqual(resolve({'A': 'B', 'B': 'Z'}, present), {'A'})
        self.assertEqual(resolve({'A': 'Z'}, present), set())

    def test_a_refresh_does_not_wait_for_a_superseded_file(self):
        recent = im.recently_added(str(ROOT), self.MARKED, hours=24 * 365 * 10)
        self.assertNotIn('20261112013714', recent)
        self.assertIn('20261112022726', recent)


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


class ForeignMigration(unittest.TestCase):
    """2026-11-24 (O23): World Hub, which shares production's history table,
    installed 20261124052600, 20261124060500 and 20261124061800 during the
    nightly freeze. Candidate d749a61e4c94 was certified at 06:29:38Z on a copy
    taken ~05:30Z and the selector refused it: "Backup copy lacks installed
    migration 20261124060500, 20261124061800" (Stage run 45330329311). None is
    a Club Arena file; the serving engine already runs against them."""
    T1, T2, T3 = '20261124052600', '20261124060500', '20261124061800'
    TRIVIA = {T1: 'trivia_tournament_health_activation_window', T2: 'trivia_p3_v3_solo_hardening',
              T3: 'trivia_finalize_question_lock_order'}
    CA = {'20261123000000': 'ca_ordinary', '20261123010000': 'ca_second'}
    WINDOW, OLD, NEW, MAIN = '20261123020000', '20261123030000', '20261123040000', '20261124010000'
    MANUAL = {'manual': 'training_api_indexes.sql'}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='foreign-migration-')
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name, 'repo')
        mig = self.repo / 'supabase' / 'migrations'
        mig.mkdir(parents=True)
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Migration fixture')
        (self.repo / 'README').write_text('empty tree\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'no migrations yet')
        self.empty = self.git('rev-parse', 'HEAD')
        owners = self.repo / 'server' / 'standby' / 'standby-owners.sql'
        owners.parent.mkdir(parents=True)
        owners.write_text('-- owners fixture\n')
        for v, n in self.CA.items():
            (mig / f'{v}_{n}.sql').write_text('SELECT 1;\n')
        (mig / f'{self.WINDOW}_window_only.sql').write_text('-- @install-window: daily-maintenance\nSELECT 1;\n')
        (mig / f'{self.OLD}_superseded.sql').write_text(f'-- SUPERSEDED BY {self.NEW}\nSELECT 1;\n')
        (mig / f'{self.NEW}_successor.sql').write_text('SELECT 2;\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'target')
        self.target = self.git('rev-parse', 'HEAD')
        (mig / f'{self.MAIN}_ca_main_only.sql').write_text('SELECT 3;\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'main after target')
        self.control = self.git('rev-parse', 'HEAD')
        # Production tonight: ours (successor installed, window not yet), the
        # manual row, and all three trivia versions; the copy lacks two of them.
        self.ours = {**self.CA, self.NEW: 'successor', self.MAIN: 'ca_main_only'}
        self.production = {**self.ours, **self.MANUAL, **self.TRIVIA}
        self.copy = {**self.ours, **self.MANUAL, self.T1: self.TRIVIA[self.T1]}

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True).strip()

    def tree(self):
        return im.tree_versions(str(self.repo), self.target, self.control)

    def judge(self, copy, prod, tree, required=None, functions=None):
        data = evidence(copy, functions)
        return im.judge(data, database(data), production(prod), required, tree)

    def test_tonight_replay_the_selector_accepts_the_copy_lacking_only_world_hub_versions(self):
        tree = self.tree()
        self.assertEqual(tree & set(self.TRIVIA), set())
        self.assertIn(self.MAIN, tree)
        ok, why = self.judge(self.copy, self.production, tree)
        self.assertTrue(ok, why)
        self.assertIn('never shipped left out', why)
        # The same copy through the selector itself, run in the tree.
        owners = (self.repo / 'server/standby/standby-owners.sql').read_bytes()
        data = evidence(self.copy)
        certified = {'database': {**database(data), 'ownersSha256': hashlib.sha256(owners).hexdigest()},
                     'schemaEvidence': data}
        cwd = os.getcwd()
        os.chdir(self.repo)
        try:
            ok, why, _ = sel.current_schema(self.control, certified, self.empty, self.target,
                                            production(self.production))
        finally:
            os.chdir(cwd)
        self.assertTrue(ok, why)
        # Without a readable tree the refusal is exactly tonight's.
        ok, why = self.judge(self.copy, self.production, None)
        self.assertFalse(ok)
        self.assertIn('lacks installed migration 20261124060500, 20261124061800', why)

    def test_a_foreign_version_in_the_copy_but_not_production_is_not_compared(self):
        prod = {**self.ours, **self.MANUAL}
        ok, why = self.judge(self.copy, prod, self.tree())
        self.assertTrue(ok, why)
        self.assertFalse(self.judge(self.copy, prod, None)[0])

    def test_a_club_arena_version_missing_from_the_copy_is_still_refused(self):
        for version in ('20261123010000', self.MAIN):  # the target's, and main's after the target
            with self.subTest(version=version):
                copy = {v: n for v, n in self.copy.items() if v != version}
                for tree in (self.tree(), None):
                    ok, why = self.judge(copy, self.production, tree)
                    self.assertFalse(ok)
                    self.assertEqual(why, 'Backup copy lacks installed migration ' + version
                                     + ('' if tree else ', 20261124060500, 20261124061800'))

    def test_a_club_arena_version_under_another_name_still_differs(self):
        copy = {**self.copy, '20261123000000': 'ca_renamed'}
        ok, why = self.judge(copy, self.production, self.tree())
        self.assertFalse(ok)
        self.assertIn('holds a different name for 20261123000000', why)

    def test_required_definitions_are_still_compared_over_all_evidence(self):
        changed = {**FUNCTIONS, PAYOUT: '0' * 64}
        ok, why = self.judge(self.copy, self.production, self.tree(), functions=changed)
        self.assertFalse(ok)
        self.assertIn(PAYOUT, why)

    def test_window_and_superseded_files_are_handled_as_before(self):
        required = _real_required_by(str(self.repo), self.empty, self.target,
                                     im.window_versions(str(self.repo), self.target))
        self.assertEqual(set(required), {*self.CA, self.NEW})
        self.assertTrue(self.judge(self.copy, self.production, self.tree(), required)[0])
        lacking = {v: n for v, n in self.copy.items() if v != self.NEW}
        ok, why = self.judge(lacking, {v: n for v, n in self.production.items() if v != self.NEW},
                             self.tree(), required)
        self.assertFalse(ok)
        self.assertIn('lacks the exact candidate migration(s) ' + self.NEW, why)

    def test_an_unreadable_tree_leaves_nothing_out(self):
        repo = str(self.repo)
        for tree in (im.tree_versions(repo), im.tree_versions(repo, self.target, ''),
                     im.tree_versions(repo, self.target, 'f' * 40), im.tree_versions(repo, 'not-a-sha'),
                     im.tree_versions(repo, self.empty), im.tree_versions(str(Path(self.tmp.name, 'none')), self.target)):
            self.assertIsNone(tree)
        self.assertEqual(im.ours(self.production, None), self.production)
        self.assertFalse(self.judge(self.copy, self.production, None)[0])

    def helper(self, *args, env=None):
        return subprocess.run(['python3', '-B', HELPER, *args], capture_output=True, text=True,
                              env={**os.environ, **(env or {})})

    def files(self, copy, prod):
        same = {s: hashlib.sha256(s.encode()).hexdigest() for s in se.SIGNATURES}
        tmp = Path(self.tmp.name)
        data = evidence(copy, same)
        (tmp / 'copy.json').write_bytes(data)
        (tmp / 'production.json').write_text(json.dumps({'migrations': sorted([v, n] for v, n in prod.items()),
                                                         'functions': {s: s for s in se.SIGNATURES}}))
        (tmp / 'certificate.json').write_text(json.dumps({'sha': self.target, 'database': database(data)}))
        (tmp / 'listing.json').write_text(json.dumps(sorted([v, n] for v, n in prod.items())))
        return tmp, hashlib.sha256(data).hexdigest()

    def test_refresh_due_is_not_due_when_only_world_hub_moved(self):
        tmp, sha = self.files(self.copy, self.production)
        base = ['refresh-due', '--copy-evidence', str(tmp / 'copy.json'), '--copy-evidence-sha', sha,
                '--production', str(tmp / 'production.json')]
        # The O16 mid-soak call: --control only, in the workflow checkout.
        res = self.helper(*base, '--repo', str(self.repo), '--control', self.control)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn('due=false\n', res.stdout)
        # The refresh job's call: --control and --sha.
        res = self.helper(*base, '--repo', str(self.repo), '--control', self.control, '--sha', self.target)
        self.assertIn('due=false\n', res.stdout)
        # No tree given, or an unreadable one: due exactly as today.
        self.assertIn('due=true\n', self.helper(*base, '--repo', str(self.repo)).stdout)
        self.assertIn('due=true\n', self.helper(*base, '--repo', str(tmp / 'none'), '--control', self.control).stdout)
        # A Club Arena version (main's) the copy lacks is still due.
        tmp, sha = self.files({v: n for v, n in self.copy.items() if v != self.MAIN}, self.production)
        res = self.helper('refresh-due', '--copy-evidence', str(tmp / 'copy.json'), '--copy-evidence-sha', sha,
                          '--production', str(tmp / 'production.json'), '--repo', str(self.repo),
                          '--control', self.control)
        self.assertIn('due=true\n', res.stdout)
        self.assertIn('lacks installed migration ' + self.MAIN, res.stderr)

    def test_status_agrees_with_the_certified_digest_when_only_world_hub_moved(self):
        # Certified on the ~05:30Z copy (trivia T1 only); production then gained T2, T3.
        tmp, _ = self.files(self.copy, self.production)
        named = self.helper('certified-digest', '--evidence', str(tmp / 'copy.json'), '--certificate',
                            str(tmp / 'certificate.json'), '--repo', str(self.repo), '--sha', self.target,
                            '--control', self.control)
        self.assertEqual(named.returncode, 0, named.stderr)
        digest = named.stdout.strip()
        self.assertEqual(digest, im.digest(self.ours))
        due = self.helper('refresh-due', '--copy-evidence', str(tmp / 'copy.json'), '--copy-evidence-sha',
                          hashlib.sha256((tmp / 'copy.json').read_bytes()).hexdigest(), '--production',
                          str(tmp / 'production.json'), '--repo', str(self.repo), '--control', self.control,
                          '--sha', self.target)
        self.assertIn(f'comparable={digest}\n', due.stdout)
        def status(prod, *extra):
            listing = tmp / 'listing.json'
            listing.write_text(json.dumps(sorted([v, n] for v, n in prod.items())))
            return self.helper('status', '--env-file', '/nonexistent', '--repo', str(self.repo), '--sha', self.target,
                               '--certified', digest, *extra,
                               env={'ENGINE_INSTALLED_MIGRATIONS_PRODUCTION_FIXTURE': str(listing)})
        ready = status(self.production, '--control', self.control)
        self.assertEqual(ready.returncode, im.READY, ready.stdout)
        # The window file installing in the break is left to the door check, as before.
        self.assertEqual(status({**self.production, self.WINDOW: 'window_only'}, '--control', self.control).returncode,
                         im.READY)
        # A Club Arena migration merged and installed after certification (in the
        # release host's newer control tree) still refuses; not yet installed, READY.
        (self.repo / 'supabase/migrations/20261124020000_ca_later.sql').write_text('SELECT 4;\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'merged after certification')
        newer = self.git('rev-parse', 'HEAD')
        self.assertEqual(status(self.production, '--control', newer).returncode, im.READY)
        later = status({**self.production, '20261124020000': 'ca_later'}, '--control', newer)
        self.assertEqual(later.returncode, im.REFUSED, later.stdout)
        self.assertIn('installed or changed after certification', later.stdout)
        renamed = status({**self.production, self.MAIN: 'other'}, '--control', self.control)
        self.assertEqual(renamed.returncode, im.REFUSED, renamed.stdout)
        # No control, or an unreadable one, leaves nothing out: refused, never READY.
        self.assertEqual(status(self.production).returncode, im.REFUSED)
        self.assertEqual(status(self.production, '--control', 'e' * 40).returncode, im.REFUSED)
        # On the release host the transaction passes no --control: the helper
        # reads its own immutable generation's control-sha manifest.
        generation = tmp / 'generation'
        generation.mkdir()
        helper = generation / 'engine-release-installed-migrations.py'
        helper.write_bytes(Path(HELPER).read_bytes())
        listing = tmp / 'listing.json'
        def host(manifest):
            (generation / 'control-sha').write_text(manifest)
            listing.write_text(json.dumps(sorted([v, n] for v, n in self.production.items())))
            return subprocess.run(['python3', '-B', str(helper), 'status', '--env-file', '/nonexistent', '--repo',
                                   str(self.repo), '--sha', self.target, '--certified', digest],
                                  capture_output=True, text=True,
                                  env={**os.environ, 'ENGINE_INSTALLED_MIGRATIONS_PRODUCTION_FIXTURE': str(listing)})
        self.assertEqual(host(self.control + '\n').returncode, im.READY)
        for manifest in ('', 'not-a-sha\n', 'e' * 40 + '\n'):
            with self.subTest(manifest=manifest):
                self.assertEqual(host(manifest).returncode, im.REFUSED)
        self.assertEqual(im.generation_control(generation / 'absent'), '')


if __name__ == '__main__':
    unittest.main()
