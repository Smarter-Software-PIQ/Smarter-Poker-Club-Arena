#!/usr/bin/env python3
"""The one-command owner-window booking, executed against a disposable copy.

Every case copies the release controls into a temporary tree and points
scripts/release/book-owner-engine-window.py at it with --repo. Nothing in this
checkout is written; no host, network or production call is made.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/release/book-owner-engine-window.py'
SUITE = 'tests/operations/engine-activation-floor.test.py'
WINDOWS = 'server/release/owner-maintenance-windows.json'
FLOOR = 'server/release/activation-floor.json'
FLOOR_PY = 'server/scripts/engine-release-activation-floor.py'
SEAL = 'server/scripts/engine-release-seal.py'
TRANSACTION = 'server/scripts/engine-release-transaction.sh'
RECOVERY = 'scripts/ci/read-scoped-release-recovery.py'
NOTICES = 'src/utils/ownerMaintenanceNotices.json'
FLOOR_LAW = 'tests/an-engine-activation-floor-precedes-runtime-writes.law.test.ts'
DAILY_LAW = 'tests/daily-engine-maintenance.law.test.ts'
NOTICE_LAW = 'tests/a-booked-window-gives-players-notice.law.test.ts'
# Everything the booking edits plus everything the native floor suite reads.
COPIED_DIRS = ('server/scripts', 'server/release', 'server/src/maintenance', '.github/workflows')
COPIED_FILES = (RECOVERY, NOTICES, 'scripts/generate-owner-maintenance-notices.mjs', 'PUBLISHING.md',
                'docs/ENGINE-RELEASE-RUNBOOK.md', SUITE, 'tests/operations/engine-drill-admission.py',
                FLOOR_LAW, DAILY_LAW, NOTICE_LAW)
SUITE_TIMEOUT = 900

A = dict(window_id='2026-11-20-owner-test-engine-0606z', predecessor='a1' * 20, contains='c3' * 20,
         notice_at='2026-11-20T05:40:00Z', not_before='2026-11-20T06:06:00Z', not_after='2026-11-20T08:30:00Z',
         slug='synthetic-owner-window-a')
# B keeps A's predecessor: an unused booking rebooked against the same serving engine.
B = dict(window_id='2026-11-21-owner-test-engine-0712z', predecessor='a1' * 20, contains='d4' * 20,
         notice_at='2026-11-21T06:45:00Z', not_before='2026-11-21T07:12:00Z', not_after='2026-11-21T09:00:00Z',
         slug='synthetic-owner-window-b')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def order_text(predecessor):
    return ('Synthetic test order: one single-use replacement of exact serving ' + predecessor
            + ' after twenty minutes of public notice, a full 1800-second soak, the full 285s reserve, '
              'zero opportunities reported honestly; the consumed booking is not extended.')


class BookOwnerEngineWindow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.repo = base / 'repo'
        self.inputs = base / 'inputs'
        self.inputs.mkdir()
        for name in COPIED_DIRS:
            shutil.copytree(ROOT / name, self.repo / name)
        for name in COPIED_FILES:
            (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, self.repo / name)
        (self.repo / 'docs/changelog').mkdir(parents=True)
        # The suite reads one booked migration; the directory is large and never written.
        (self.repo / 'supabase').mkdir()
        os.symlink(ROOT / 'supabase/migrations', self.repo / 'supabase/migrations')

    def book(self, spec, order=None, dry_run=False, **changes):
        spec = dict(spec, **changes)
        tag = spec['window_id']
        files = {'order': order if order is not None else order_text(spec['predecessor']),
                 'summary': f'**Synthetic booking:** single-use `{tag}` exists only inside a test.',
                 'changelog': f'# Synthetic booking {tag}\n\nWritten by a test into a disposable tree.\n'}
        for name, text in files.items():
            (self.inputs / f'{tag}-{name}.txt').write_text(text + '\n')
        command = [sys.executable, '-B', str(SCRIPT), '--repo', str(self.repo),
                   '--window-id', tag, '--predecessor', spec['predecessor'], '--contains', spec['contains'],
                   '--notice-at', spec['notice_at'], '--not-before', spec['not_before'],
                   '--not-after', spec['not_after'], '--slug', spec['slug'],
                   '--owner-order-file', str(self.inputs / f'{tag}-order.txt'),
                   '--summary-file', str(self.inputs / f'{tag}-summary.txt'),
                   '--changelog-file', str(self.inputs / f'{tag}-changelog.txt')]
        if dry_run:
            command.append('--dry-run')
        return subprocess.run(command, text=True, capture_output=True, timeout=SUITE_TIMEOUT)

    def snapshot(self):
        return {str(path.relative_to(self.repo)): (sha(path), path.stat().st_mode & 0o777)
                for path in sorted(self.repo.rglob('*')) if path.is_file() and not path.is_symlink()
                and 'supabase' not in path.relative_to(self.repo).parts}

    def read(self, name):
        return (self.repo / name).read_text()

    def constant(self, name, source):
        return re.search(rf"^{name} = '([^']+)'$", self.read(source), re.M).group(1)

    def assert_refused(self, result, pattern, before):
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertRegex(result.stderr, pattern)
        self.assertIn('REFUSED, nothing written', result.stderr)
        self.assertEqual(self.snapshot(), before)

    def assert_booked(self, spec, previous_id, previous_pair, windows_before):
        tag, predecessor = spec['window_id'], spec['predecessor']
        doc = json.loads(self.read(WINDOWS))
        self.assertEqual(len(doc['windows']), len(windows_before['windows']) + 1)
        self.assertEqual(doc['windows'][:-1], windows_before['windows'])
        self.assertEqual(doc['databaseWindows'], windows_before['databaseWindows'])
        window = doc['windows'][-1]
        floor_digest = sha(self.repo / FLOOR)
        self.assertEqual(window, {
            'id': tag, 'ownerOrder': order_text(predecessor), 'contains': spec['contains'],
            'playerNoticeAt': spec['notice_at'], 'notBefore': spec['not_before'], 'notAfter': spec['not_after'],
            'announcementPolicy': 'earliest-certified', 'supersedesPhase1Schedule': True, 'migrations': [],
            'releaseWitness': {'path': FLOOR, 'sha256': floor_digest}})
        self.assertEqual(json.loads(self.read(FLOOR)), {
            'schema': 'engine-release-activation-floor/v2-owner-window', 'preparationAt': spec['not_before'],
            'activationAt': spec['not_before'], 'expiresAt': spec['not_after'], 'timeZone': 'America/Chicago',
            'ownerWindowId': tag, 'clientPublicationAt': spec['not_before']})
        self.assertEqual(self.constant('NOV7_OWNER_ID', FLOOR_PY), tag)
        self.assertEqual(self.constant('NOV7_MANIFEST_DIGEST', FLOOR_PY), floor_digest)
        self.assertEqual(self.constant('NOV7_ORDER_DIGEST', FLOOR_PY), hashlib.sha256(
            json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest())
        seal = self.read(SEAL)
        self.assertEqual(self.constant('NOV7_OWNER_CLAIM', SEAL), f'engine-release-owner-{tag}.json')
        self.assertEqual(self.constant('NOV7_PREDECESSOR', SEAL), predecessor)
        self.assertIn("datetime.fromisoformat('%s')" % spec['not_after'].replace('Z', '+00:00'), seal)
        self.assertNotIn(previous_id, seal)
        transaction = self.read(TRANSACTION)
        self.assertEqual(transaction.count(tag), 4)
        self.assertEqual(transaction.count(predecessor), 2)
        self.assertNotIn(previous_id, transaction)
        pair = "{'engine-release-seal.py': '%s', 'engine-release-transaction.sh': '%s'}" % (
            sha(self.repo / SEAL), sha(self.repo / TRANSACTION))
        recovery = self.read(RECOVERY)
        self.assertIn('RETAINED_REFUSAL_SOURCES = ' + pair + '\n', recovery)
        prior = re.search(r'^RETAINED_REFUSAL_PRIOR_SOURCES = (\(.*\))$', recovery, re.M).group(1)
        self.assertEqual(ast.literal_eval(prior)[-1], ast.literal_eval(previous_pair))
        ast.parse(recovery)
        notices = json.loads(self.read(NOTICES))['notices']
        self.assertEqual([n for n in notices if n['id'] == tag], [{
            'id': tag, 'kind': 'engine', 'noticeAt': spec['notice_at'],
            'notBefore': spec['not_before'], 'notAfter': spec['not_after']}])
        self.assertEqual(notices, sorted(notices, key=lambda n: (n['notBefore'], n['id'])))
        summary = f'**Synthetic booking:** single-use `{tag}` exists only inside a test.\n\n'
        for name in ('PUBLISHING.md', 'docs/ENGINE-RELEASE-RUNBOOK.md'):
            self.assertTrue(self.read(name).startswith(summary), name)
        changelog = self.repo / f"docs/changelog/{spec['not_before'][:10]}-{spec['slug']}.md"
        self.assertEqual(changelog.read_text(), f'# Synthetic booking {tag}\n\nWritten by a test into a disposable tree.\n')
        self.assertEqual(self.read(DAILY_LAW).count(f"  expect(doc.windows.pop().id).toBe('{tag}');\n"
                                                    f"  expect(doc.windows.pop().id).toBe('{previous_id}');\n"), 1)
        notice_law = self.read(NOTICE_LAW)
        self.assertEqual(notice_law.count(f"(n) => n.id === '{tag}'"), 1)
        self.assertIn(f"expect(own?.notAfterMs).toBe(Date.parse('{spec['not_after']}'));", notice_law)
        self.assertTrue(notice_law.endswith('});\n'))
        self.assert_law_lists_the_suite()

    def assert_law_lists_the_suite(self):
        """The law's case list is exactly the suite's runtime collection."""
        law = self.read(FLOOR_LAW)
        listed = re.findall(r"^      '(test_[A-Za-z0-9_]+)',$", law, re.M)
        tree = ast.parse(self.read(SUITE))
        suite = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'ActivationFloor')
        defined = [n.name for n in suite.body if isinstance(n, ast.FunctionDef) and n.name.startswith('test_')]
        self.assertEqual(sorted(listed), sorted(defined))
        self.assertEqual(len(set(listed)), len(listed))
        self.assertIn(f'expect(selected).toHaveLength({len(listed)});', law)

    def run_suite(self):
        return subprocess.run([sys.executable, '-B', SUITE], cwd=self.repo, text=True,
                              capture_output=True, timeout=SUITE_TIMEOUT)

    def test_books_one_window_then_the_next_and_the_floor_suite_passes_each_time(self):
        windows = json.loads(self.read(WINDOWS))
        old_id = self.constant('NOV7_OWNER_ID', FLOOR_PY)
        # The predecessor the repository pins before A is booked; A replaces it
        # and B carries the "absent from the transaction" pin for it.
        old_pred = self.constant('NOV7_PREDECESSOR', SEAL)
        old_pair = "{'engine-release-seal.py': '%s', 'engine-release-transaction.sh': '%s'}" % (
            sha(self.repo / SEAL), sha(self.repo / TRANSACTION))
        cases = len(re.findall(r'^    def test_', self.read(SUITE), re.M))
        untouched = self.snapshot()

        plan = self.book(A, dry_run=True)
        self.assertEqual(plan.returncode, 0, plan.stdout + plan.stderr)
        self.assertIn('DRY RUN: nothing written.', plan.stdout)
        self.assertIn(A['window_id'], plan.stdout)
        self.assertEqual(self.snapshot(), untouched)

        first = self.book(A)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertIn(f'{SUITE}: PASS', first.stdout)
        self.assertNotIn('WARNING', first.stdout)
        self.assertRegex(first.stdout, rf'Ran {cases + 1} tests')
        self.assert_booked(A, old_id, old_pair, windows)
        # The command's verdict is the suite's own: run it again, independently.
        again = self.run_suite()
        self.assertEqual(again.returncode, 0, again.stderr[-4000:])
        self.assertRegex(again.stderr, rf'Ran {cases + 1} tests')
        self.assertNotRegex(again.stderr, r'skipped=')
        suite = self.read(SUITE)
        self.assertEqual(suite.count(f"self.assertEqual(floor.NOV7_OWNER_ID, '{A['window_id']}')"), 1)
        self.assertNotIn(f"self.assertEqual(floor.NOV7_OWNER_ID, '{old_id}')", suite)
        self.assertIn(f"self.assertEqual(windows['windows'][-2]['id'], '{old_id}')", suite)
        self.assertIn("stamp = int(datetime.fromisoformat('2026-11-20T06:48:00+00:00').timestamp()) * 1000", suite)

        # A second use of the same id is refused and writes nothing.
        booked = self.snapshot()
        self.assert_refused(self.book(A, slug='synthetic-owner-window-again'), r'already booked', booked)

        # Booking B on top of A: A's generated test is demoted in turn and every index moves again.
        windows_a = json.loads(self.read(WINDOWS))
        pair_a = "{'engine-release-seal.py': '%s', 'engine-release-transaction.sh': '%s'}" % (
            sha(self.repo / SEAL), sha(self.repo / TRANSACTION))
        second = self.book(B)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertIn(f'{SUITE}: PASS', second.stdout)
        self.assertRegex(second.stdout, rf'Ran {cases + 2} tests')
        self.assert_booked(B, A['window_id'], pair_a, windows_a)
        suite = self.read(SUITE)
        self.assertEqual(suite.count(f"self.assertEqual(floor.NOV7_OWNER_ID, '{B['window_id']}')"), 1)
        self.assertNotIn(f"self.assertEqual(floor.NOV7_OWNER_ID, '{A['window_id']}')", suite)
        self.assertIn(f"window, raw = self.historical_floor('{A['window_id']}')", suite)
        self.assertIn(f"self.assertEqual(windows['windows'][-2]['id'], '{A['window_id']}')", suite)
        self.assertIn(f"self.assertEqual(windows['windows'][-3]['id'], '{old_id}')", suite)
        # The predecessor did not change, so the earlier "absent from the transaction" pin is carried.
        self.assertEqual(suite.count(f"self.assertEqual(transaction.count('{B['predecessor']}'), 2)"), 1)
        self.assertEqual(suite.count(f"self.assertNotIn('{old_pred}', transaction)"), 1)
        for chain in re.findall(r"(?:        self\.assertEqual\(windows\['windows'\]\.pop\(\)\['id'\], '[^']+'\)\n)+", suite):
            self.assertTrue(chain.startswith(
                f"        self.assertEqual(windows['windows'].pop()['id'], '{B['window_id']}')\n"
                f"        self.assertEqual(windows['windows'].pop()['id'], '{A['window_id']}')\n"
                f"        self.assertEqual(windows['windows'].pop()['id'], '{old_id}')\n"), chain[:300])

    def test_refuses_each_invalid_booking_before_writing_anything(self):
        before = self.snapshot()
        refusals = (
            (dict(notice_at='2026-11-20T05:46:01Z'), None, r'notice lead is 1199 s'),
            (dict(not_before='2026-11-20T06:05:29Z', notice_at='2026-11-20T05:40:00Z'), None, r'329 s past the hour'),
            (dict(not_before='2026-11-20T06:49:01Z', notice_at='2026-11-20T06:20:00Z'), None, r'2941 s past the hour'),
            (dict(not_after='2026-11-20T06:12:59Z'), None, r'419 s; announcement plus 420 s must fit'),
            # 03:30 America/Chicago on November 20 is 09:30 UTC (CST).
            (dict(not_before='2026-11-20T06:06:00Z', not_after='2026-11-20T09:30:00Z'), None, r'not before the next 03:30 America/Chicago'),
            # 03:30 America/Chicago on July 10 is 08:30 UTC (CDT): the same UTC span is refused in summer.
            (dict(window_id='2026-07-10-owner-test-engine-0606z', notice_at='2026-07-10T05:40:00Z',
                  not_before='2026-07-10T06:06:00Z', not_after='2026-07-10T08:30:00Z'), None,
             r'routine preparation after notBefore \(2026-07-10T08:30:00Z\)'),
            (dict(not_after='2026-11-20T12:06:01Z'), None, r'not before the next 03:30|bounds a window'),
            (dict(predecessor='A1' * 20), None, r'--predecessor must be a 40-hex'),
            (dict(contains='c3' * 19), None, r'--contains must be a 40-hex'),
            (dict(window_id='2026-11-20 owner;test'), None, r'--window-id must be lowercase'),
            # The runtime floor refuses ids longer than 64 characters, so the command does too.
            (dict(window_id='2026-11-20-owner-test-engine-0606z-' + 'x' * 30), None, r'--window-id must be lowercase'),
            (dict(not_before='2026-11-20T06:06:00+00:00'), None, r'--not-before must be UTC ISO'),
            (dict(), order_text(A['predecessor']).replace('twenty minutes', '20 minutes'), r"lacks required text.*'twenty minutes'"),
            (dict(), order_text(A['predecessor']).replace('not extended', 'kept'), r"lacks required text.*'not extended'"),
            (dict(), order_text('b2' * 20), r'lacks required text.*' + A['predecessor']),
        )
        for changes, order, pattern in refusals:
            with self.subTest(pattern=pattern):
                self.assert_refused(self.book(A, order=order, **changes), pattern, before)

    def test_a_booking_keeps_the_executable_bit_of_the_scripts_it_edits(self):
        for name in ('server/scripts/engine-release-seal.py', 'server/scripts/engine-release-transaction.sh'):
            (self.repo / name).chmod(0o755)
        result = self.book(A)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for name in ('server/scripts/engine-release-seal.py', 'server/scripts/engine-release-transaction.sh'):
            self.assertEqual((self.repo / name).stat().st_mode & 0o777, 0o755, name)

    def test_a_failure_while_staging_leaves_no_temp_and_changes_nothing(self):
        import importlib.util
        from unittest import mock
        self.book(A, dry_run=True)
        before = self.snapshot()
        tag = A['window_id']
        spec = importlib.util.spec_from_file_location('book_window_staging', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        real, calls = os.chmod, []

        def flaky(path, mode):
            calls.append(path)
            if len(calls) == 2:
                raise OSError(28, 'No space left on device')
            return real(path, mode)

        argv = ['--repo', str(self.repo), '--window-id', tag, '--predecessor', A['predecessor'],
                '--contains', A['contains'], '--notice-at', A['notice_at'], '--not-before', A['not_before'],
                '--not-after', A['not_after'], '--slug', A['slug'],
                '--owner-order-file', str(self.inputs / f'{tag}-order.txt'),
                '--summary-file', str(self.inputs / f'{tag}-summary.txt'),
                '--changelog-file', str(self.inputs / f'{tag}-changelog.txt')]
        with mock.patch.object(module.os, 'chmod', flaky):
            self.assertEqual(module.main(argv), 2)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual([p.name for p in self.repo.rglob('*.booking-*')], [])

    def test_a_restore_that_cannot_complete_is_reported_as_partly_written(self):
        import importlib.util
        from unittest import mock
        self.book(A, dry_run=True)
        tag = A['window_id']
        spec = importlib.util.spec_from_file_location('book_window_restore', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        real, calls = os.replace, []

        def flaky(src, dst):
            calls.append(dst)
            if len(calls) == 3 or str(src).endswith('.booking-restore'):
                raise OSError(5, 'Input/output error')
            return real(src, dst)

        argv = ['--repo', str(self.repo), '--window-id', tag, '--predecessor', A['predecessor'],
                '--contains', A['contains'], '--notice-at', A['notice_at'], '--not-before', A['not_before'],
                '--not-after', A['not_after'], '--slug', A['slug'],
                '--owner-order-file', str(self.inputs / f'{tag}-order.txt'),
                '--summary-file', str(self.inputs / f'{tag}-summary.txt'),
                '--changelog-file', str(self.inputs / f'{tag}-changelog.txt')]
        import contextlib, io
        err = io.StringIO()
        with mock.patch.object(module.os, 'replace', flaky), contextlib.redirect_stderr(err):
            self.assertEqual(module.main(argv), 1)
        self.assertIn('PARTLY WRITTEN', err.getvalue())
        self.assertIn('could not undo', err.getvalue())
        self.assertEqual([p.name for p in self.repo.rglob('*.booking-*')], [])

    def test_a_write_that_fails_part_way_restores_every_file(self):
        # Run the command in process and make the third rename into place fail
        # after two files were already replaced: every original must come back.
        import importlib.util
        from unittest import mock
        before = self.snapshot()
        tag = A['window_id']
        self.book(A, dry_run=True)
        spec = importlib.util.spec_from_file_location('book_window_under_test', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        real, calls = os.replace, []

        def flaky(src, dst):
            calls.append(dst)
            if len(calls) == 3:
                raise OSError(28, 'No space left on device')
            return real(src, dst)

        argv = ['--repo', str(self.repo), '--window-id', tag, '--predecessor', A['predecessor'],
                '--contains', A['contains'], '--notice-at', A['notice_at'], '--not-before', A['not_before'],
                '--not-after', A['not_after'], '--slug', A['slug'],
                '--owner-order-file', str(self.inputs / f'{tag}-order.txt'),
                '--summary-file', str(self.inputs / f'{tag}-summary.txt'),
                '--changelog-file', str(self.inputs / f'{tag}-changelog.txt')]
        with mock.patch.object(module.os, 'replace', flaky):
            status = module.main(argv)
        self.assertEqual(status, 2)
        # Three renames into place (the third fails), then the two replaced
        # files are restored atomically through their own rename each.
        self.assertEqual(len(calls), 5)
        self.assertEqual(calls[3:], calls[1::-1])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(sorted(p.name for p in self.repo.rglob('*.booking-tmp')), [])

    def test_refuses_when_an_expected_occurrence_count_is_wrong(self):
        current = self.constant('NOV7_OWNER_ID', FLOOR_PY)
        for name, find, replace, pattern in (
                (TRANSACTION, current, 'some-other-window', r'engine-release-transaction\.sh: expected .* exactly 4 time\(s\), found 3'),
                (SUITE, f"self.assertEqual(transaction.count('{current}'), 4)", 'pass', r'exactly one transaction\.count pin'),
                (DAILY_LAW, f"  expect(doc.windows.pop().id).toBe('{current}');\n", '', r'daily-engine-maintenance\.law\.test\.ts: expected .* exactly 1 time\(s\), found 0'),
                (SEAL, "NOV7_PREDECESSOR = '", "NOV7_PREDECESSOR  = '", r'expected exactly one NOV7_PREDECESSOR, found 0')):
            with self.subTest(file=name):
                original = self.read(name)
                self.assertIn(find, original)
                (self.repo / name).write_text(original.replace(find, replace, 1))
                before = self.snapshot()
                self.assert_refused(self.book(A), pattern, before)
                (self.repo / name).write_text(original)

    def test_a_failing_floor_suite_is_reported_and_exits_nonzero(self):
        # Break something the booking does not validate, so the write happens and the suite must say FAIL.
        suite = self.repo / SUITE
        text = suite.read_text()
        needle = "        self.assertNotIn('2026-11-09-owner-asap-engine-2230z', transaction)\n"
        self.assertEqual(text.count(needle), 1)
        suite.write_text(text.replace(needle, needle + "        self.fail('deliberate fixture failure')\n"))
        result = self.book(A)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(f'{SUITE}: FAIL', result.stdout)
        self.assertIn('deliberate fixture failure', result.stdout)
        self.assertNotIn(f'{SUITE}: PASS', result.stdout)
        self.assertIn('WRITTEN and a check FAILED', result.stderr)

    def test_an_overlapping_notice_is_booked_with_a_warning_and_a_narrower_case(self):
        # Overlap the current window's still-shipped promise: its notAfter is not before the new notice.
        current = json.loads(self.read(WINDOWS))['windows'][-1]
        spec = dict(A, window_id='2026-11-14-owner-test-engine-0712z', notice_at='2026-11-14T06:45:00Z',
                    not_before='2026-11-14T07:12:00Z', not_after='2026-11-14T09:00:00Z')
        self.assertGreater(current['notAfter'], spec['notice_at'])
        result = self.book(spec, dry_run=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # The overlap list is sorted and may also name earlier windows still shipped.
        self.assertRegex(result.stdout, r'WARNING: the new notice interval overlaps a shipped notice \([^)]*' + re.escape(current['id']))


if __name__ == '__main__':
    unittest.main()
