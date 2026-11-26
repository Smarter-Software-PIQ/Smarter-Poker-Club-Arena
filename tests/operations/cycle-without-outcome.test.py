#!/usr/bin/env python3
"""Every cycle has an owner or says so (O32): the look-back, replayed.

Runs the real scripts/release/cycle-without-outcome.py with injected readers
against the Stage runs GitHub recorded on 2026-11-26, when the 10:00
America/Chicago cycle had no owner, and the real gap handling of
scripts/ci/cutover-outcome-ledger.py.
"""
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


L = load('cycle_without_outcome', 'scripts/release/cycle-without-outcome.py')
LEDGER = load('cutover_outcome_ledger', 'scripts/ci/cutover-outcome-ledger.py')


def epoch(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp())


RESERVATION = 'Daily engine reservation'
BACKUP = 'Automatic Backup daily reservation'
OUTSIDE = 'Backup completion outside election'


def run(rid, event, title, created, updated=None, conclusion='success', status='completed'):
    return {'id': rid, 'event': event, 'display_title': title, 'created_at': created,
            'updated_at': updated or created, 'status': status, 'conclusion': conclusion,
            'run_attempt': 1, 'head_branch': 'main'}


# Every Stage run GitHub lists between 13:00Z and 16:30Z on 2026-11-26 (read
# from the API that day). The 10:00 CST cycle starts 16:00Z: cutoff 15:30Z,
# election window 13:50Z to 15:50Z. The pushes are before and after it; the
# three completions inside it are failed Backups, refused by run title.
NOV26 = [
    run(45825254280, 'push', RESERVATION, '2026-11-26T13:02:19Z', '2026-11-26T13:02:38Z'),
    run(45826428013, 'push', RESERVATION, '2026-11-26T13:09:36Z', '2026-11-26T13:10:03Z'),
    run(45827342754, 'push', RESERVATION, '2026-11-26T13:15:14Z', '2026-11-26T13:15:36Z'),
    run(45827378501, 'push', RESERVATION, '2026-11-26T13:15:27Z', '2026-11-26T13:15:46Z'),
    run(45827415694, 'push', RESERVATION, '2026-11-26T13:15:40Z', '2026-11-26T13:16:04Z'),
    run(45827433760, 'workflow_run', BACKUP, '2026-11-26T13:15:46Z', '2026-11-26T13:16:09Z'),
    run(45827452208, 'push', RESERVATION, '2026-11-26T13:15:53Z', '2026-11-26T13:16:14Z'),
    run(45830221058, 'workflow_run', OUTSIDE, '2026-11-26T13:33:03Z', '2026-11-26T13:33:04Z', 'skipped'),
    run(45832428826, 'workflow_run', BACKUP, '2026-11-26T13:46:34Z', '2026-11-26T13:47:00Z'),
    run(45842790604, 'workflow_run', OUTSIDE, '2026-11-26T14:49:01Z', '2026-11-26T14:49:02Z', 'skipped'),
    run(45846574486, 'workflow_run', OUTSIDE, '2026-11-26T15:11:30Z', '2026-11-26T15:11:32Z', 'skipped'),
    run(45850278483, 'workflow_run', OUTSIDE, '2026-11-26T15:33:31Z', '2026-11-26T15:33:41Z', 'skipped'),
    run(45857765392, 'push', RESERVATION, '2026-11-26T16:20:01Z', '2026-11-26T16:20:22Z'),
]
TEN = epoch('2026-11-26T16:00:00Z')
SEALED_07 = {'body': 'Cycle: 2026-11-26 07:00 CST\nResult: SEALED\nSealed SHA: `' + 'a' * 40 + '`\n'}
EARLIER = [
    {'body': 'Cycle: 2026-11-25 %s CST\nResult: KEEP-SERVING (the serving engine keeps running)\n' % hour}
    for hour in ('10:00', '13:00', '16:00', '19:00', '22:00')
] + [
    {'body': 'Cycle: 2026-11-26 01:00 CST\nResult: KEEP-SERVING (the serving engine keeps running)\n'},
    {'body': 'Cycle: 2026-11-26 04:00 CST\nResult: SEALED\nSealed SHA: `' + 'b' * 40 + '`\n'},
    {'body': 'Cycle: 2026-11-26 07:00 CST | Readiness at T-45m: IN_FLIGHT 132ef19f0770\nStage: x\n'},
    SEALED_07,
]


class Fail(Exception):
    pass


def readers(runs=NOV26, comments=None, ledger=(), jobs=None, serving=True, fail=()):
    comments = list(EARLIER if comments is None else comments)
    asked = {'jobs': [], 'runs': []}

    def refuse(name):
        if name in fail:
            raise L.CouldNotTell(name + ' unreadable')

    def read_runs(low, high):
        refuse('runs')
        asked['runs'].append((low, high))
        return [r for r in runs if low <= r['created_at'] < high]

    def read_jobs(rid):
        refuse('jobs')
        asked['jobs'].append(rid)
        if jobs is None or rid not in jobs:
            raise L.CouldNotTell('no job record')
        return jobs[rid]

    def read_comments(since):
        refuse('comments')
        return list(comments)

    def read_ledger():
        refuse('ledger')
        return [dict(r) for r in ledger]

    def read_serving():
        refuse('serving')
        return serving

    return {'runs': read_runs, 'jobs': read_jobs, 'comments': read_comments, 'ledger': read_ledger,
            'serving_three_hourly': read_serving, '_comments': comments, '_asked': asked}


def detect_jobs(cutoff_step):
    return {'total_count': 1, 'jobs': [{'name': L.DETECT_JOB, 'status': 'completed', 'conclusion': 'success',
                                        'run_attempt': 1,
                                        'steps': [{'name': L.CUTOFF_STEP, 'status': 'completed',
                                                   'conclusion': cutoff_step}]}]}


class Schedule(unittest.TestCase):
    def test_the_eight_cycles_of_an_ordinary_day_and_their_windows(self):
        starts = L.cycle_starts(epoch('2026-11-26T06:00:00Z'), epoch('2026-11-27T05:59:59Z'), L.THREE_HOURLY_HOURS)
        self.assertEqual([L.identity(s) for s in starts],
                         ['2026-11-26T01', '2026-11-26', '2026-11-26T07', '2026-11-26T10', '2026-11-26T13',
                          '2026-11-26T16', '2026-11-26T19', '2026-11-26T22'])
        self.assertEqual(L.label(TEN), '2026-11-26 10:00 CST')
        low, high, cutoff = L.election_window(TEN, True)
        self.assertEqual((L.stamp(low), L.stamp(high), L.stamp(cutoff)),
                         ('2026-11-26T13:50:00Z', '2026-11-26T15:50:00Z', '2026-11-26T15:30:00Z'))
        # The task's wording of the same window: [start - 130 min, start - 10 min).
        self.assertEqual((TEN - low, TEN - high), (130 * 60, 10 * 60))

    def test_spring_forward_two_cycles_two_real_hours_apart_never_share_a_window(self):
        starts = L.cycle_starts(epoch('2027-03-14T06:00:00Z'), epoch('2027-03-15T04:59:59Z'), L.THREE_HOURLY_HOURS)
        self.assertEqual([L.stamp(s) for s in starts[:3]],
                         ['2027-03-14T07:00:00Z', '2027-03-14T09:00:00Z', '2027-03-14T12:00:00Z'])
        self.assertEqual([L.label(s) for s in starts[:2]], ['2027-03-14 01:00 CST', '2027-03-14 04:00 CDT'])
        self.assertEqual(L.identity(starts[1]), '2027-03-14')
        first, second = L.election_window(starts[0], True), L.election_window(starts[1], True)
        self.assertLessEqual(first[1], second[0])
        self.assertEqual(len(starts), 8)

    def test_fall_back_the_repeated_hour_is_one_cycle(self):
        starts = L.cycle_starts(epoch('2026-11-01T05:00:00Z'), epoch('2026-11-02T05:59:59Z'), L.THREE_HOURLY_HOURS)
        self.assertEqual([L.stamp(s) for s in starts[:2]], ['2026-11-01T06:00:00Z', '2026-11-01T10:00:00Z'])
        self.assertEqual(L.label(starts[0]), '2026-11-01 01:00 CDT')
        self.assertEqual(L.identity(starts[0]), '2026-11-01T01')
        self.assertEqual(len(starts), 8)
        # Every window of both days is disjoint from the next, in order.
        for day in ('2026-11-01', '2027-03-14', '2026-11-26'):
            base = epoch(day + 'T05:00:00Z')
            cycles = L.cycle_starts(base, base + 26 * 3600, L.THREE_HOURLY_HOURS)
            windows = [L.election_window(s, True) for s in cycles]
            for a, b in zip(windows, windows[1:]):
                self.assertLessEqual(a[1], b[0], day)

    def test_the_daily_policy_has_one_cycle_and_a_five_hour_reservation(self):
        starts = L.cycle_starts(epoch('2026-11-26T06:00:00Z'), epoch('2026-11-27T05:59:59Z'), L.DAILY_HOURS)
        self.assertEqual([L.identity(s) for s in starts], ['2026-11-26'])
        low, high, cutoff = L.election_window(starts[0], False)
        self.assertEqual((cutoff - low, high - cutoff), (5 * 3600, 20 * 60))


class November26(unittest.TestCase):
    def test_the_real_timeline_has_no_eligible_run_in_the_window(self):
        found = L.replay_election(TEN, True, readers()['runs'], readers()['jobs'])
        self.assertEqual((found['verdict'], found['ownerRunId'], found['eligible']), ('no-owner', None, 0))

    def test_the_next_run_of_any_kind_says_no_owner_once(self):
        # 16:20:01Z: the push after the window. The window closed at 15:50Z.
        r = readers()
        report = L.look_back(epoch('2026-11-26T16:20:30Z'), True, r)
        self.assertEqual([(f['cycle'], f['verdict']) for f in report['announce']], [('2026-11-26T10', 'no-owner')])
        self.assertEqual(report['unknown'], [])
        self.assertEqual(report['gaps'], [{'cycle': '2026-11-26T10', 'outcome': 'no-owner', 'ownerRunId': None}])
        posted = []
        notes = L.announce(report, r, lambda body: (posted.append(body), r['_comments'].append({'body': body})),
                           'https://example.test/runs/45857765392')
        self.assertEqual(len(posted), 1)
        self.assertEqual(posted[0].split('\n')[:2],
                         ['Cycle: 2026-11-26 10:00 CST', 'Result: NO OWNER (the serving engine keeps running)'])
        self.assertIn('Election window 07:50 CST to 09:50 CST: 0 eligible run(s)', posted[0])
        self.assertNotIn('Sealed SHA', posted[0])
        self.assertEqual(notes, [{
            'cycle': '2026-11-26T10',
            'note': 'The 10:00 AM engine cutover on November 26 did not run: nothing started it. '
                    'The engine kept running the current version.'}])
        # The comment is the cycle's result: the next run finds nothing to say.
        again = L.look_back(epoch('2026-11-26T16:25:00Z'), True, r)
        self.assertEqual(again['announce'], [])
        self.assertIn('2026-11-26T10', again['accounted'])
        # ... and still hands the gap to the ledger's single writer.
        self.assertEqual(again['gaps'], [{'cycle': '2026-11-26T10', 'outcome': 'no-owner', 'ownerRunId': None}])

    def test_it_is_said_as_soon_as_the_window_has_closed_and_not_before(self):
        before = L.look_back(epoch('2026-11-26T15:51:59Z'), True, readers())
        self.assertEqual(before['announce'], [])
        self.assertNotIn('2026-11-26T10', before['accounted'] + before['pending'])
        after = L.look_back(epoch('2026-11-26T15:52:00Z'), True, readers())
        self.assertEqual([f['cycle'] for f in after['announce']], ['2026-11-26T10'])
        self.assertEqual(after['announce'][0]['note'],
                         'The 10:00 AM engine cutover on November 26 will not run: nothing started it. '
                         'The engine keeps running the current version.')

    def test_with_the_failed_backup_completion_admitted_the_cycle_has_an_owner(self):
        # O32: run 45842790604 (the 14:49:01Z completion of failed push Backup
        # 45827343954) carries the reservation title and holds its job open.
        runs = [dict(r, display_title=BACKUP, status='in_progress', conclusion=None)
                if r['id'] == 45842790604 else r for r in NOV26]
        found = L.replay_election(TEN, True, readers(runs)['runs'], readers(runs)['jobs'])
        self.assertEqual((found['verdict'], found['ownerRunId']), ('no-outcome', 45842790604))
        # While its owner works, nothing is said.
        waiting = L.look_back(epoch('2026-11-26T16:20:30Z'), True, readers(runs))
        self.assertEqual((waiting['announce'], waiting['pending']), ([], ['2026-11-26T10']))
        # Its result on the log accounts for the cycle.
        logged = EARLIER + [{'body': 'Cycle: 2026-11-26 10:00 CST\nResult: KEEP-SERVING (the serving engine keeps running)\n'}]
        done = L.look_back(epoch('2026-11-26T16:31:00Z'), True, readers(runs, comments=logged))
        self.assertEqual((done['announce'], done['pending'], done['unknown']), ([], [], []))
        # So does its record on the ledger alone.
        ledgered = L.look_back(epoch('2026-11-26T16:31:00Z'), True,
                               readers(runs, ledger=[{'cycle': '2026-11-26T10', 'outcome': 'keep-serving'}]))
        self.assertEqual(ledgered['announce'], [])
        # An owner that left no result anywhere is named, 30 minutes after the start.
        silent = L.look_back(epoch('2026-11-26T16:30:00Z'), True, readers(runs))
        self.assertEqual([(f['verdict'], f['ownerRunId']) for f in silent['announce']],
                         [('no-outcome', 45842790604)])
        self.assertIn('was started (run 45842790604) but left no result on record', silent['announce'][0]['note'])
        body = L.log_comment(TEN, silent['announce'][0], '')
        self.assertEqual(body.split('\n')[1], 'Result: NO OUTCOME (no result was recorded for this cycle)')


class WhoHeldTheCycle(unittest.TestCase):
    CUTOFF = epoch('2026-11-26T15:30:00Z')

    def verdict(self, runs, jobs=None):
        r = readers(runs, jobs=jobs)
        return L.replay_election(TEN, True, r['runs'], r['jobs']), r['_asked']

    def test_a_run_that_finished_green_well_before_the_cutoff_stood_down(self):
        push = run(1, 'push', RESERVATION, '2026-11-26T14:00:00Z', '2026-11-26T14:00:25Z')
        found, asked = self.verdict([push])
        self.assertEqual((found['verdict'], found['eligible'], asked['jobs']), ('no-owner', 1, []))

    def test_a_late_green_run_is_asked_through_its_own_job_record(self):
        late = run(2, 'schedule', RESERVATION, '2026-11-26T15:31:00Z', '2026-11-26T15:31:30Z')
        stood, asked = self.verdict([late], {2: detect_jobs('skipped')})
        self.assertEqual((stood['verdict'], asked['jobs']), ('no-owner', [2]))
        held, _ = self.verdict([late], {2: detect_jobs('success')})
        self.assertEqual((held['verdict'], held['ownerRunId']), ('no-outcome', 2))
        with self.assertRaises(L.CouldNotTell):
            self.verdict([late])  # its job record cannot be read

    def test_a_failed_cancelled_replayed_or_running_run_held_it(self):
        for change in ({'conclusion': 'failure'}, {'conclusion': 'cancelled'}, {'run_attempt': 2},
                       {'status': 'in_progress', 'conclusion': None}):
            first = dict(run(3, 'push', RESERVATION, '2026-11-26T14:00:00Z', '2026-11-26T15:31:00Z'), **change)
            found, _ = self.verdict([first])
            self.assertEqual((found['verdict'], found['ownerRunId']), ('no-outcome', 3), change)

    def test_eligibility_is_the_admissions_own_rule(self):
        low, high, cutoff = L.election_window(TEN, True)
        yes = [
            run(1, 'push', RESERVATION, '2026-11-26T13:50:00Z'),
            run(2, 'schedule', RESERVATION, '2026-11-26T15:49:59Z'),
            run(3, 'workflow_run', BACKUP, '2026-11-26T14:49:01Z'),
            dict(run(4, 'repository_dispatch', 'Original operator daily preparation', '2026-11-26T15:31:00Z'),
                 actor={'type': 'User'}),
        ]
        no = [
            run(5, 'push', RESERVATION, '2026-11-26T13:49:59Z'),
            run(6, 'push', RESERVATION, '2026-11-26T15:50:00Z'),
            run(7, 'workflow_run', OUTSIDE, '2026-11-26T14:49:01Z'),
            run(8, 'workflow_dispatch', 'anything', '2026-11-26T14:00:00Z'),
            dict(run(9, 'repository_dispatch', 'Original operator daily preparation', '2026-11-26T15:00:00Z'),
                 actor={'type': 'User'}),
            dict(run(10, 'repository_dispatch', 'Original operator daily preparation', '2026-11-26T15:31:00Z'),
                 actor={'type': 'Bot'}),
            dict(run(11, 'push', RESERVATION, '2026-11-26T14:00:00Z'), head_branch='other'),
        ]
        self.assertTrue(all(L.eligible(r, low, high, cutoff) for r in yes))
        self.assertFalse(any(L.eligible(r, low, high, cutoff) for r in no))


class CouldNotTellIsNeverYesOrNo(unittest.TestCase):
    NOW = epoch('2026-11-26T16:20:30Z')

    def test_an_unreadable_log_judges_nothing_and_posts_nothing(self):
        r = readers(fail=('comments',))
        report = L.look_back(self.NOW, True, r)
        self.assertEqual((report['announce'], report['gaps'], report['accounted']), ([], [], []))
        self.assertEqual(len(report['unknown']), 9)
        self.assertTrue(all(item['why'].startswith('cutover log:') for item in report['unknown']))

    def test_an_unreadable_run_list_job_record_or_ledger_is_unknown_for_that_cycle(self):
        for failing in ('runs', 'ledger'):
            report = L.look_back(self.NOW, True, readers(fail=(failing,)))
            self.assertEqual(report['announce'], [], failing)
            self.assertEqual([item['cycle'] for item in report['unknown']], ['2026-11-26T10'], failing)
            self.assertEqual(report['gaps'], [], failing)
        late = NOV26 + [run(45850000000, 'schedule', RESERVATION, '2026-11-26T15:31:00Z', '2026-11-26T15:31:40Z')]
        report = L.look_back(self.NOW, True, readers(late))
        self.assertEqual((report['announce'], [i['cycle'] for i in report['unknown']]), ([], ['2026-11-26T10']))

    def test_a_malformed_run_list_or_comment_is_unknown(self):
        for bad in ({'not': 'a list'}, [{'id': 'x'}], [{'id': 1}, {'id': 1}], [{'id': 0}]):
            with self.assertRaises(L.CouldNotTell):
                L.replay_election(TEN, True, lambda low, high, bad=bad: bad, lambda rid: {})
        with self.assertRaises(L.CouldNotTell):
            L.results_on_log([{'body': None}])
        with self.assertRaises(L.CouldNotTell):
            L.cycles_on_ledger([{'no': 'cycle'}])

    def test_the_log_is_read_again_before_posting_and_a_second_caller_posts_nothing(self):
        first, second = readers(), readers()
        a = L.look_back(self.NOW, True, first)
        b = L.look_back(self.NOW, True, second)
        self.assertEqual(len(a['announce']), 1)
        self.assertEqual(len(b['announce']), 1)
        shared, posted = first['_comments'], []
        second['_comments'] = shared
        second['comments'] = lambda since: list(shared)

        def post(body):
            posted.append(body)
            shared.append({'body': body})
        self.assertEqual(len(L.announce(a, first, post, 'run-a')), 1)
        self.assertEqual(L.announce(b, second, post, 'run-b'), [])
        self.assertEqual(len(posted), 1)

    def test_when_the_second_read_fails_nothing_is_posted_and_no_note_is_owed(self):
        r = readers()
        report = L.look_back(self.NOW, True, r)
        r['comments'] = lambda since: (_ for _ in ()).throw(L.CouldNotTell('gone'))
        posted = []
        self.assertEqual(L.announce(report, r, posted.append, ''), [])
        self.assertEqual(posted, [])

    def test_a_failed_post_still_owes_the_owner_note(self):
        r = readers()
        report = L.look_back(self.NOW, True, r)

        def post(body):
            raise L.CouldNotTell('403')
        self.assertEqual([n['cycle'] for n in L.announce(report, r, post, '')], ['2026-11-26T10'])

    def test_a_cycle_the_serving_engine_does_not_break_on_is_not_a_missing_cycle(self):
        daily_serving = L.look_back(self.NOW, True, readers(comments=[], serving=False))
        self.assertEqual([f['cycle'] for f in daily_serving['announce']], ['2026-11-26'])
        self.assertEqual(len(daily_serving['notScheduled']), 8)
        unreadable = L.look_back(self.NOW, True, readers(comments=[], fail=('serving',)))
        self.assertEqual([f['cycle'] for f in unreadable['announce']], ['2026-11-26'])
        self.assertEqual(len(unreadable['unknown']), 8)
        self.assertTrue(all(i['why'].startswith('serving schedule:') for i in unreadable['unknown']))
        daily_policy = L.look_back(self.NOW, False, readers(comments=[]))
        self.assertEqual([f['cycle'] for f in daily_policy['announce']], ['2026-11-26'])

    def test_notes_and_comments_are_plain(self):
        for start, clock in ((epoch('2026-11-26T07:00:00Z'), '1:00 AM'), (epoch('2026-11-26T19:00:00Z'), '1:00 PM'),
                             (epoch('2026-11-27T04:00:00Z'), '10:00 PM'), (epoch('2026-11-26T10:00:00Z'), '4:00 AM')):
            for verdict in L.GAP_OUTCOMES:
                note = L.owner_note(start, verdict, 7, start + 3600)
                self.assertTrue(note.startswith(f'The {clock} engine cutover on November 26'), note)
                self.assertNotIn(chr(0x2014), note)
                self.assertLessEqual(len(note), 500)
        finding = {'verdict': 'no-owner', 'windowStart': TEN - 7800, 'windowEnd': TEN - 600, 'eligible': 0,
                   'ownerRunId': None}
        body = L.log_comment(TEN, finding, 'url')
        self.assertRegex(body, L.RESULT_LINE)
        self.assertEqual(L.results_on_log([{'body': body}]), {'2026-11-26 10:00 CST': 'NO OWNER'})
        self.assertEqual(L.results_on_log(EARLIER)['2026-11-26 07:00 CST'], 'SEALED')
        self.assertNotIn(chr(0x2014), body)


class TheLedgerLearnsOfTheGap(unittest.TestCase):
    def selection(self, reason='Backup copy lacks installed migration 1'):
        return {'outcome': 'keep-serving', 'servingSha': 'c' * 40, 'controlSha': 'd' * 40, 'targetSha': None,
                'deferredCandidates': [{'sha': 'e' * 40, 'reason': reason}]}

    def record(self, previous, cycle, gaps, selection=None):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            (folder / 'selection.json').write_text(json.dumps(selection or self.selection()))
            (folder / 'previous.json').write_text(json.dumps({'schema': 1, 'records': previous}))
            arguments = ['record', '--selection', str(folder / 'selection.json'), '--cycle', cycle, '--run-id', '9',
                         '--previous-ledger', str(folder / 'previous.json'), '--seed', str(folder / 'previous.json'),
                         '--output', str(folder / 'out.json'), '--verdict', str(folder / 'verdict.json')]
            if gaps is not None:
                (folder / 'gaps.json').write_text(gaps if isinstance(gaps, str) else json.dumps(gaps))
                arguments += ['--gaps', str(folder / 'gaps.json')]
            code = LEDGER.main(arguments)
            return code, json.loads((folder / 'out.json').read_text())['records'], \
                json.loads((folder / 'verdict.json').read_text())

    def test_a_no_owner_cycle_is_recorded_between_its_neighbours(self):
        previous = [LEDGER.record_from_selection(self.selection('rollback rehearsal unavailable'), '2026-11-26T07', '1')]
        gaps = [{'cycle': '2026-11-26T10', 'outcome': 'no-owner', 'ownerRunId': None},
                {'cycle': '2026-11-26T04', 'outcome': 'no-owner', 'ownerRunId': None},   # never a cycle id, and older
                {'cycle': '2026-11-26', 'outcome': 'no-owner', 'ownerRunId': None},      # older than the last record
                {'cycle': '2026-11-26T13', 'outcome': 'no-owner', 'ownerRunId': None},   # this very cycle
                {'cycle': '2026-11-26T10', 'outcome': 'no-owner', 'ownerRunId': None}]   # twice
        code, records, _ = self.record(previous, '2026-11-26T13', gaps)
        self.assertEqual(code, 0)
        self.assertEqual([(r['cycle'], r['outcome'], r['gate']) for r in records],
                         [('2026-11-26T07', 'keep-serving', 'serving-rollback-rehearsal-unavailable'),
                          ('2026-11-26T10', 'no-owner', 'no-owner'),
                          ('2026-11-26T13', 'keep-serving', 'backup-lacks-installed-migration')])
        # Recorded again by the next owner: still once.
        code, again, _ = self.record(records, '2026-11-26T16', gaps)
        self.assertEqual([r['cycle'] for r in again].count('2026-11-26T10'), 1)

    def test_a_gap_never_hides_a_gate_refused_on_both_sides_of_it(self):
        previous = [LEDGER.record_from_selection(self.selection(), '2026-11-26T07', '1')]
        code, records, verdict = self.record(previous, '2026-11-26T13',
                                             [{'cycle': '2026-11-26T10', 'outcome': 'no-owner', 'ownerRunId': None}])
        self.assertEqual(code, 3)
        self.assertEqual((verdict['gate'], verdict['streak'], verdict['cycles']),
                         ('backup-lacks-installed-migration', 2, ['2026-11-26T07', '2026-11-26T13']))
        self.assertEqual(len(records), 3)

    def test_a_selected_cycle_is_still_reconciled_across_a_gap(self):
        target = 'f' * 40
        previous = [{'schema': 1, 'cycle': '2026-11-26T07', 'runId': '1', 'outcome': 'selected', 'gate': None,
                     'refusedSha': None, 'reason': None, 'servingSha': 'a' * 40, 'targetSha': target}]
        now = dict(self.selection(), servingSha=target)
        _, records, _ = self.record(previous, '2026-11-26T13',
                                    [{'cycle': '2026-11-26T10', 'outcome': 'no-outcome', 'ownerRunId': 5}], now)
        self.assertEqual([(r['cycle'], r['outcome']) for r in records],
                         [('2026-11-26T07', 'sealed'), ('2026-11-26T10', 'no-outcome'), ('2026-11-26T13', 'keep-serving')])
        self.assertEqual(records[1]['runId'], '5')

    def test_no_gaps_or_unreadable_gaps_change_nothing(self):
        previous = [LEDGER.record_from_selection(self.selection('rollback rehearsal unavailable'), '2026-11-26T07', '1')]
        for gaps in (None, [], 'not json', '{"a": 1}', [{'cycle': '2026-11-26T10', 'outcome': 'sealed'}]):
            code, records, _ = self.record(previous, '2026-11-26T13', gaps)
            self.assertEqual((code, [r['cycle'] for r in records]), (0, ['2026-11-26T07', '2026-11-26T13']), gaps)


class TheCommandItself(unittest.TestCase):
    """The real `run` command with gh replaced by a script that serves files."""

    def invoke(self, runs, comments, now, post=True, health=True, artifacts_fail=False):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            (folder / 'runs.json').write_text(json.dumps([{'total_count': len(runs), 'workflow_runs': runs}]))
            (folder / 'comments.json').write_text(json.dumps(comments))
            (folder / 'artifacts.json').write_text(json.dumps({'artifacts': []}))
            (folder / 'health.json').write_text(json.dumps(
                {'maintenance': {'schedule': {'frequency': 'three-hourly', 'startHours': [1, 4, 7, 10, 13, 16, 19, 22]}}}
                if health else {}))
            (folder / 'policy.json').write_text(json.dumps({'frequency': 'three-hourly'}))
            (folder / 'seed.json').write_text(json.dumps({'schema': 1, 'records': [{'cycle': '2026-11-18', 'outcome': 'keep-serving'}]}))
            artifacts = 'exit 1' if artifacts_fail else f"cat '{folder}/artifacts.json'"
            gh = folder / 'bin' / 'gh'
            gh.parent.mkdir()
            gh.write_text(f'''#!/usr/bin/env bash
set -eu
[ "$1" = api ]
case "$*" in
  *"--method POST"*) printf '%s\\n' "$*" >> '{folder}/posted.log'; echo '{{}}' ;;
  *"/workflows/stage-engine-release.yml/runs?created=2026-11-26T13:50:00Z..2026-11-26T15:50:00Z"*) cat '{folder}/runs.json' ;;
  *"/workflows/stage-engine-release.yml/runs?"*) echo '[{{"total_count":0,"workflow_runs":[]}}]' ;;
  *"/issues/11599/comments?since="*) cat '{folder}/comments.json' ;;
  *"/actions/artifacts?name=cutover-outcome-ledger"*) {artifacts} ;;
  *) exit 1 ;;
esac
''')
            gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
            environment = dict(os.environ, PATH=f"{gh.parent}:{os.environ['PATH']}",
                               GITHUB_OUTPUT=str(folder / 'output'), CYCLE_LOOK_BACK_HEALTH_FILE=str(folder / 'health.json'))
            result = subprocess.run(
                [sys.executable, '-B', str(ROOT / 'scripts/release/cycle-without-outcome.py'), 'run', '--repo', 'o/r',
                 '--policy', str(folder / 'policy.json'), '--seed', str(folder / 'seed.json'),
                 '--out', str(folder / 'report.json'), '--run-id', '45857765392', '--run-url', 'https://x/45857765392',
                 '--now', str(now)] + (['--post'] if post else []),
                capture_output=True, text=True, env=environment, timeout=60)
            outputs = dict(line.split('=', 1) for line in (folder / 'output').read_text().splitlines()) \
                if (folder / 'output').exists() else {}
            posted = (folder / 'posted.log').read_text() if (folder / 'posted.log').exists() else ''
            report = json.loads((folder / 'report.json').read_text()) if (folder / 'report.json').exists() else None
            return result, outputs, posted, report

    def test_november_26_end_to_end(self):
        result, outputs, posted, report = self.invoke(NOV26, EARLIER, epoch('2026-11-26T16:20:30Z'))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(posted.count('--method POST'), 1)
        self.assertIn('repos/o/r/issues/11599/comments', posted)
        self.assertIn('Result: NO OWNER (the serving engine keeps running)', posted)
        self.assertEqual(json.loads(outputs['notes'])[0]['cycle'], '2026-11-26T10')
        self.assertEqual(json.loads(outputs['gaps']), [{'cycle': '2026-11-26T10', 'outcome': 'no-owner', 'ownerRunId': None}])
        self.assertIn('posted NO OWNER to issue #11599', result.stdout)
        self.assertEqual(len(report['accounted']), 8)

    def test_without_post_it_only_reports(self):
        result, outputs, posted, _ = self.invoke(NOV26, EARLIER, epoch('2026-11-26T16:20:30Z'), post=False)
        self.assertEqual((result.returncode, posted, outputs['notes']), (0, '', ''))
        self.assertIn('2026-11-26T10', outputs['gaps'])

    def test_nothing_missing_writes_empty_outputs(self):
        logged = EARLIER + [{'body': 'Cycle: 2026-11-26 10:00 CST\nResult: SEALED\n'}]
        result, outputs, posted, _ = self.invoke(NOV26, logged, epoch('2026-11-26T16:20:30Z'))
        self.assertEqual((result.returncode, posted, outputs), (0, '', {'notes': '', 'gaps': ''}))

    def test_unreadable_reads_end_green_and_say_unknown(self):
        result, outputs, posted, report = self.invoke(NOV26, EARLIER, epoch('2026-11-26T16:20:30Z'), artifacts_fail=True)
        self.assertEqual((result.returncode, posted, outputs['notes'], outputs['gaps']), (0, '', '', ''))
        self.assertIn('::warning title=CYCLE LOOK-BACK UNKNOWN::Cycle 2026-11-26 10:00 CST', result.stdout)
        self.assertEqual([i['cycle'] for i in report['unknown']], ['2026-11-26T10'])
        result, outputs, posted, report = self.invoke(NOV26, EARLIER, epoch('2026-11-26T16:20:30Z'), health=False)
        self.assertEqual((result.returncode, posted), (0, ''))
        self.assertEqual(report['notScheduled'], ['2026-11-26T10'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
