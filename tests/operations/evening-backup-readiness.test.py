import importlib.util
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('evening', Path(__file__).resolve().parents[2] / 'scripts/ops/evening-backup-readiness.py')
evening = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evening)


class Readiness(unittest.TestCase):
    def test_source_missing_in_production_and_restore_missing_installed_version_are_distinct(self):
        required = {'1': 'held', '3': 'needed'}
        prod = {'1':'held', '2':'just_installed'}
        self.assertEqual(evening.candidate_missing(required, prod), [{'version':'3','name':'needed'}])
        self.assertEqual(evening.missing(prod, {'1':'held'})['missingInBackup'], [{'version':'2','name':'just_installed'}])

    def test_cutoff_on_chicago_clock_during_both_dst_changes(self):
        for now, cutoff in [('2026-03-08T07:30:00+00:00', '2026-03-08T08:30:00+00:00'),
                            ('2026-11-01T07:30:00+00:00', '2026-11-01T09:30:00+00:00')]:
            self.assertEqual(evening.next_cutoff(datetime.fromisoformat(now)).isoformat(), cutoff)

    def test_targets_require_status_link_and_estimate_requires_physical_execution(self):
        now = evening.when('2026-11-09T09:01:00Z')
        runs = [dict(id=3,status='in_progress',url='run/3',headSha='provider',conclusion=None),
                dict(id=2,status='completed',conclusion='success'),
                dict(id=1,status='completed',conclusion='success')]
        active = {'certify': {'status':'in_progress','started_at':'2026-11-09T09:00:00Z'}}
        inherited = {'certify': {'conclusion':'skipped'}}
        past = {'certify': {'conclusion':'success','started_at':'2026-11-08T08:00:00Z',
                            'completed_at':'2026-11-08T08:40:00Z', 'steps':[
            {'name':'Build, boot, crash, soak and judge on the Backup Engine','conclusion':'success'}]}}
        with patch.object(evening, 'jobs', side_effect=[active,inherited,past]):
            t = evening.timing('o/r', runs, [], now)
        self.assertIsNone(t['targetSha'])
        self.assertEqual(t['runId'], 3)
        self.assertEqual(t['samples'], [{'runId':1,'seconds':2400}])
        self.assertEqual(t['marginMinutes'], -10)
        walked = [{'sha':'candidate','certified':'pending','certificate':{'targetUrl':'https://github.com/o/r/actions/runs/3'}}]
        with patch.object(evening, 'jobs', side_effect=[active,inherited]):
            t = evening.timing('o/r', runs[:2], walked, now)
        self.assertEqual(t['targetSha'], 'candidate')
        self.assertEqual(t['state'], 'UNKNOWN')

    def test_unknown_archive_retains_owner_and_known_missing_version(self):
        sha = 'a'*40
        p = dict(repo='o/r', generatedAt='2026-11-09T02:00:00Z', backupLane={'state':'read','runs':[]},
                 production={'releaseSha':'b'*40}, queue={'state':'read','installedRows':[['1','old']]},
                 walk={'candidate':sha,'walked':[{'sha':sha,'certificate':{'targetUrl':'https://github.com/o/r/actions/runs/9'}}]})
        with patch.object(evening.installed,'window_versions',return_value=set()), \
             patch.object(evening.installed,'required_by',return_value={'2':'missing'}), \
             patch.object(evening,'certificate',side_effect=ValueError('archive unavailable')):
            result = evening.report(p)
        self.assertEqual(result['certificateRunId'],9)
        self.assertEqual(result['candidateMissingInProduction'],[{'version':'2','name':'missing'}])
        self.assertEqual(result['state'],'UNKNOWN')


if __name__ == '__main__':
    unittest.main()
