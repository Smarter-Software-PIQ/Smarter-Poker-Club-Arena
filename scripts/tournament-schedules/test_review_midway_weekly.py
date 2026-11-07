import copy
import importlib.util
import json
from pathlib import Path
import unittest
import tempfile
import subprocess
import sys
from datetime import datetime, timezone, timedelta
import zipfile
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('review', HERE / 'review-midway-weekly.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((HERE.parent.parent / 'docs/tournament-schedules/midway-weekly-2026-11-07.json').read_text())

    def test_full_canonical_and_expanded_live_match(self):
        live = copy.deepcopy(self.catalog)
        live.pop('profiles')
        for event in live['events']:
            ladder = self.catalog['profiles'][event.pop('blindProfile')]
            event['terms']['blind_structure'] = json.dumps(ladder)
            event['config'].update(blindStructure=ladder, midwayWeeklyTerms=event['terms'], levelMinutes=ladder[0]['durationMinutes'])
            event.pop('sourceName')
            event.pop('sourceScheduleId')
        result = review.review(self.catalog, live)
        self.assertTrue(result['valid'], result['validationErrors'])
        self.assertEqual(result['changes'], [])
        self.assertIsNone(result['occurrenceImpacts'])

    def test_invalid_uuid_days_clock_stack_game_and_target(self):
        candidate = copy.deepcopy(self.catalog)
        event = candidate['events'][0]
        event.update(id='invalid', days=[True, 7], times=['24:00'], blindProfile='missing')
        event['terms'].update(starting_chips=0, addon_break_minutes=None, game_type='PLO6')
        event['config']['satelliteTargetName'] = 'absent'
        result = review.review(candidate, self.catalog)
        self.assertFalse(result['valid'])
        self.assertGreaterEqual(len(result['validationErrors']), 7)

    def test_duplicate_uuid_and_ladder(self):
        candidate = copy.deepcopy(self.catalog)
        candidate['events'].append(copy.deepcopy(candidate['events'][0]))
        candidate['profiles']['B1'][1]['bigBlind'] = 1
        errors = review.validate(candidate)
        self.assertTrue(any('UUID' in e['message'] for e in errors))
        self.assertTrue(any('nondecreasing' in e['message'] for e in errors))

    def test_full_diff_profile_propagation_and_impacts(self):
        candidate = copy.deepcopy(self.catalog)
        event = candidate['events'][0]
        event['config']['nested'] = {'new': 2}
        event['terms']['starting_chips'] += 100
        event['config']['startingStack'] += 100
        candidate['profiles'][event['blindProfile']][0]['durationMinutes'] += 1
        occurrences = [dict(id='eligible', scheduleId=event['id'], status='REGISTERING', startedAt=None, registrations=3, refundChips=16.5, refundCoverageComplete=True, refundAuthorityVerified=True), dict(id='started', scheduleId=event['id'], status='RUNNING', startedAt='date'), dict(id='unknown', scheduleId=event['id'], status='REGISTERING')]
        result = review.review(candidate, self.catalog, occurrences)
        changes = next(c for c in result['changes'] if c['scheduleId'] == event['id'])
        self.assertTrue(any(f['path'] == '/config/nested' for f in changes['fields']))
        self.assertTrue(any(f['path'] == '/resolvedBlindStructure' for f in changes['fields']))
        self.assertEqual([i['decision'] for i in result['occurrenceImpacts']], ['eligible_unstarted', 'started_contract_preserved', 'unknown'])
        self.assertTrue(result['occurrenceImpacts'][0]['financialImpactKnown'])
        self.assertFalse(result['occurrenceImpacts'][1]['financialImpactKnown'])
        self.assertIsNone(result['occurrenceImpacts'][1]['finalRefundChips'])

    def workbook_fixture(self, path, changes=None):
        base = copy.deepcopy(self.catalog)
        base['events'] = [base['events'][0]]
        event = base['events'][0]
        event['days'] = [0]
        base['profiles'] = {event['blindProfile']: base['profiles'][event['blindProfile']]}
        b = base['profiles'][event['blindProfile']][0]
        row = dict(A='Sunday', B=8/24, C=event['name'], D=250, E='Fixed Bounty', F='Yes', G='Yes', H=5.5, I=5000, J=f"{b['durationMinutes']} min; starts {b['smallBlind']}/{b['bigBlind']}", K=12, M='NLH', N='Yes', P=event['blindProfile'], U=event['id'])
        row.update(changes or {})
        def xmlrow(index, values):
            cells = []
            for col, value in values.items():
                if isinstance(value, str):
                    cells.append(f'<c r="{col}{index}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
                else:
                    cells.append(f'<c r="{col}{index}"><v>{value}</v></c>')
            return f'<row r="{index}">' + ''.join(cells) + '</row>'
        main = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sunday" r:id="r1"/><sheet name="Blind structures" r:id="r2"/></sheets></workbook>')
            archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>')
            archive.writestr('xl/worksheets/sheet1.xml', main + xmlrow(6, row) + '</sheetData></worksheet>')
            levels = []
            for i, level in enumerate(base['profiles'][event['blindProfile']], 6):
                levels.append(xmlrow(i, dict(zip('ABCDEF', [event['blindProfile'], level['level'], level['smallBlind'], level['bigBlind'], level['ante'], level['durationMinutes']]))))
            archive.writestr('xl/worksheets/sheet2.xml', main + ''.join(levels) + '</sheetData></worksheet>')
        return base

    def test_xlsx_stable_ids_and_price_rejection(self):
        # CI-owned temporary directory is isolated; no production workbook is modified.
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            path = Path(folder) / 'fixture.xlsx'
            base = self.workbook_fixture(path)
            candidate = review.candidate_from_workbook(path, base)
            self.assertEqual(review.review(candidate, base)['changes'], [])
            base = self.workbook_fixture(path, {'H': 6})
            with self.assertRaisesRegex(ValueError, 'explicit terms.buy_in_amount'):
                review.candidate_from_workbook(path, base)
            base = self.workbook_fixture(path, {'U': ''})
            with self.assertRaisesRegex(ValueError, 'Schedule ID is required'):
                review.candidate_from_workbook(path, base)
            base = self.workbook_fixture(path, {'J': '8 min; starts 50/100'})
            with self.assertRaisesRegex(ValueError, 'agree with existing profile'):
                review.candidate_from_workbook(path, base)


    def test_natural_duplicate_and_live_duplicate_rejected(self):
        candidate = copy.deepcopy(self.catalog)
        duplicate = copy.deepcopy(candidate['events'][0])
        duplicate['id'] = '12345678-1234-4234-8234-123456789abc'
        duplicate['name'] = duplicate['name'].upper()
        candidate['events'].append(duplicate)
        self.assertTrue(any('name/day/time' in error['message'] for error in review.validate(candidate)))
        live = copy.deepcopy(self.catalog)
        live['events'].append(copy.deepcopy(live['events'][0]))
        self.assertFalse(review.review(self.catalog, live)['valid'])
        live['events'][0]['terms'] = None
        self.assertFalse(review.review(self.catalog, live)['valid'])


    def test_names_and_producer_types_are_coherent(self):
        candidate = copy.deepcopy(self.catalog)
        candidate['events'][0]['terms']['name'] = 'Different name'
        self.assertTrue(any('/name' in e['path'] for e in review.validate(candidate)))
        candidate = copy.deepcopy(self.catalog)
        satellite = next(e for e in candidate['events'] if e['terms']['variant'] == 'satellite')
        satellite['config']['type'] = 'freezeout'
        self.assertTrue(any('Producer type' in e['message'] for e in review.validate(candidate)))
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            path = Path(folder) / 'fixture.xlsx'
            base = self.workbook_fixture(path, {'E': 'Satellite'})
            with self.assertRaisesRegex(ValueError, 'format conversion requires explicit canonical'):
                review.candidate_from_workbook(path, base)


    def test_cli_requires_fresh_timestamp(self):
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            candidate = Path(folder) / 'candidate.json'
            live = Path(folder) / 'live.json'
            output = Path(folder) / 'output.json'
            candidate.write_text(json.dumps(self.catalog))
            for delta in (None, -60, 60):
                snapshot = copy.deepcopy(self.catalog)
                if delta is not None:
                    snapshot['asOf'] = (datetime.now(timezone.utc) + timedelta(minutes=delta)).isoformat()
                live.write_text(json.dumps(snapshot))
                result = subprocess.run([sys.executable, str(HERE / 'review-midway-weekly.py'), '--candidate', str(candidate), '--live', str(live), '--output', str(output)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse(json.loads(output.read_text())['valid'])

    def test_preserved_contract_never_promises_refund(self):
        candidate = copy.deepcopy(self.catalog)
        candidate['events'][0]['terms']['starting_chips'] += 100
        candidate['events'][0]['config']['startingStack'] += 100
        occurrence = dict(id='started', scheduleId=candidate['events'][0]['id'], status='RUNNING', startedAt='date', registrations=1, refundChips=100, refundCoverageComplete=True, refundAuthorityVerified=True)
        impact = review.review(candidate, self.catalog, [occurrence])['occurrenceImpacts'][0]
        self.assertIsNone(impact['finalRefundChips'])
        self.assertEqual(impact['cancellationRefundStatus'], 'preserved_contract')
        self.assertFalse(impact['financialImpactKnown'])


    def test_add_remove_and_null_distinct_from_missing(self):
        candidate = copy.deepcopy(self.catalog)
        removed = candidate['events'].pop()
        new = copy.deepcopy(candidate['events'][0])
        new['id'] = '12345678-1234-4234-8234-123456789abc'
        new['name'] = new['terms']['name'] = new['config']['name'] = 'New distinct event'
        candidate['events'].append(new)
        result = review.review(candidate, self.catalog)
        self.assertEqual(next(c['kind'] for c in result['changes'] if c['scheduleId'] == removed['id']), 'removed')
        self.assertEqual(next(c['kind'] for c in result['changes'] if c['scheduleId'] == new['id']), 'added')
        self.assertEqual(review.recursive_diff({}, {'x': None}), [{'path': '/x', 'kind': 'added', 'after': None}])


if __name__ == '__main__':
    unittest.main()
