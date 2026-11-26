import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('selector', ROOT / 'scripts/ci/select-daily-engine.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class DailySelection(unittest.TestCase):
    def test_chicago_cutoff_tracks_dst(self):
        for day, hour in [('2026-11-07', 9), ('2026-07-01', 8)]:
            value = datetime.fromtimestamp(mod.cutoff(day), timezone.utc)
            self.assertEqual((value.hour, value.minute), (hour, 30))

    def test_backup_refuses_qualification_time_without_offset(self):
        status = {'state': 'SUCCESS', 'createdAt': '2026-11-07T03:29:00'}
        with self.assertRaisesRegex(ValueError, 'UTC offset'):
            mod.backup('o/r', 'a' * 40, mod.cutoff('2026-11-07'), status)

    def test_future_status_and_failed_status_never_enter_certificate_read(self):
        for state, stamp in [('PENDING', '2026-11-07T09:00:00Z'), ('SUCCESS', '2026-11-07T09:30:01Z')]:
            with patch.object(mod, 'api', side_effect=AssertionError):
                self.assertIsNone(mod.backup('o/r', 'a' * 40, mod.cutoff('2026-11-07'),
                                             {'state': state, 'createdAt': stamp}))

    def test_exact_backup_run_artifact_binds_schema_seed_and_control(self):
        sha, control = 'a' * 40, 'b' * 40
        stamp = '2026-11-07T09:29:00Z'
        run = {'path': '.github/workflows/backup-engine.yml', 'head_branch': 'main',
               'head_sha': control, 'conclusion': 'success', 'id': 42, 'run_attempt': 2, 'updated_at': stamp}
        status = {'state': 'SUCCESS', 'createdAt': stamp, 'targetUrl': 'https://github.com/o/r/actions/runs/42'}
        artifact = {'artifacts': [{'id': 99, 'name': f'backup-certificate-{sha}-2',
                                   'expired': False, 'size_in_bytes': 512}]}
        db = {'restoreValidated': True, 'restoreErrors': 0, 'restoredAt': stamp,
              'dumpSha256': 'f' * 64, 'ownersSha256': 'b' * 64}
        cert = {'sha': sha, 'verdict': 'pass', 'reasons': [], 'fatalLogLines': 0, 'soakSeconds': 1800,
                'certifiedAt': stamp, 'database': db, 'seed': {'tablesFailed': 0, 'seededAt': stamp}}
        def bundle():
            data = mod.io.BytesIO()
            with mod.zipfile.ZipFile(data, 'w') as store:
                store.writestr('certificate.json', mod.json.dumps(cert))
                store.writestr('compatibility.json', mod.json.dumps({'controlSha': control, 'targetSha': sha}))
            return data.getvalue()
        def read():
            with patch.object(mod, 'api', side_effect=[run, artifact]), patch.object(mod, 'command', return_value=bundle()):
                return mod.backup('o/r', sha, mod.cutoff('2026-11-07'), status)
        self.assertEqual(read()['artifactId'], 99)
        producer = control
        control = sha
        run['event'] = 'push'
        with patch.object(mod, 'git', side_effect=[producer, '']):
            self.assertEqual(read()['producerSha'], producer)
        for result in [['c' * 40], [producer, '.github/workflows/backup-engine.yml']]:
            with patch.object(mod, 'git', side_effect=result), self.assertRaisesRegex(ValueError, 'retarget'):
                read()
        # A 900 s soak (since 2026-11-26) is selectable only with a passing
        # memory growth check; the 1800 s certificate above has no such key.
        with patch.object(mod, 'git', side_effect=[producer, '']):
            cert['soakSeconds'] = 900
            with self.assertRaisesRegex(ValueError, 'conflicts with certificate contents'):
                read()
        for check, accepted in [({'status': 'pass'}, True), ({'status': 'fail'}, False),
                                ({'status': 'unreadable'}, False), (None, False)]:
            cert['memoryGrowthCheck'] = check
            with patch.object(mod, 'git', side_effect=[producer, '']):
                if accepted:
                    self.assertEqual(read()['artifactId'], 99)
                else:
                    with self.assertRaisesRegex(ValueError, 'conflicts with certificate contents'):
                        read()
        run['event'] = 'workflow_dispatch'
        with self.assertRaisesRegex(ValueError, 'retarget'):
            read()
        control = producer
        cert['seed']['tablesFailed'] = 1
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            read()

    def test_schema_change_after_backup_restore_requires_new_evidence(self):
        # Replaced 2026-11-08: commit time against restore time was the test
        # that called the stale copy of Backup 42519319251 fresh. The owners
        # digest still decides; freshness is the copy's contents, proved in
        # tests/operations/backup-installed-migrations.test.py. A copy that
        # records no contents is never fresh, whatever its timestamps.
        db = {'restoredAt': '2026-11-07T09:00:00Z', 'ownersSha256': mod.hashlib.sha256(b'owners').hexdigest()}
        for source, reason in [(b'different', 'different standby owners'),
                               (b'owners', 'records no installed schema evidence')]:
            with patch.object(mod, 'git', return_value='2026-11-07T08:00:00Z'), patch.object(mod, 'command', return_value=source):
                fresh, why, diagnostics = mod.current_schema('b' * 40, {'database': db})
            self.assertFalse(fresh)
            self.assertIn(reason, why)
            self.assertEqual(diagnostics['restoredAt'], db['restoredAt'])

    def test_unreadable_qualification_never_selects_older_sha(self):
        old, newest, serving = ('a' * 40, 'b' * 40, 'c' * 40)
        args = types.SimpleNamespace(repo='o/r', control=newest, serving=serving)
        with (patch.object(mod, 'git', side_effect=[newest+'\\n'+old, serving]),
              patch.object(mod, 'current_schema', return_value=(True, '', {})),
              patch.object(mod, 'statuses', return_value=[(newest, {}), (old, {})]),
              patch.object(mod, 'backup', return_value={'runId': 123, 'rehearsedServingSha': serving, 'playerReconnectedBothDirections': True,
                                                       'rollbackAdoptionSeconds': 135, 'forwardAdoptionSeconds': 7}) as backup,
              patch.object(mod.subprocess, 'run', return_value=mod.subprocess.CompletedProcess([], 2))):
            with self.assertRaises(mod.subprocess.CalledProcessError):
                mod.select(args, {'cutoffEpoch': 1, 'deferredCandidates': []})
            self.assertEqual(backup.call_count, 1)

    def test_selection_defers_unrehearsed_or_over_budget_rollback(self):
        newest, serving = 'b' * 40, 'c' * 40
        args = types.SimpleNamespace(repo='o/r', control=newest, serving=serving)
        for predecessor, duration, reconnected in [(newest, 1, True), (serving, 136, True),
                                                 (serving, None, True), (serving, 5, False)]:
            report = {'cutoffEpoch': 1, 'deferredCandidates': []}
            evidence = dict(playerReconnectedBothDirections=reconnected,
                            rehearsedServingSha=predecessor, rollbackAdoptionSeconds=duration,
                            forwardAdoptionSeconds=3)
            with (patch.object(mod, 'git', side_effect=[newest, serving]),
                  patch.object(mod, 'statuses', return_value=[(newest, {})]),
                  patch.object(mod, 'backup', return_value=evidence)):
                mod.select(args, report)
            self.assertEqual(report['deferredCandidates'][0]['reason'], 'serving rollback rehearsal unavailable')

    def test_newest_missing_qualification_yields_the_pinned_older_candidate(self):
        old, newest, serving = ('a' * 40, 'b' * 40, 'c' * 40)
        args = types.SimpleNamespace(repo='o/r', control=newest, serving=serving)
        qual = mod.json.dumps({'targetSha': old, 'controlSha': newest})
        processes = [mod.subprocess.CompletedProcess([], 3),
                     mod.subprocess.CompletedProcess([], 0, qual),
                     mod.subprocess.CompletedProcess([], 0, '{}')]
        report = {'cutoffEpoch': 1, 'deferredCandidates': []}
        with (patch.object(mod, 'git', side_effect=[newest+'\n'+old, serving]),
              patch.object(mod, 'current_schema', return_value=(True, '', {})),
              patch.object(mod, 'statuses', return_value=[(newest, {}), (old, {})]),
              patch.object(mod, 'backup', return_value={'runId': 123, 'rehearsedServingSha': serving, 'playerReconnectedBothDirections': True,
                                                       'rollbackAdoptionSeconds': 135, 'forwardAdoptionSeconds': 7}),
              patch.object(mod.subprocess, 'run', side_effect=processes)):
            mod.select(args, report)
        self.assertEqual(report['targetSha'], old)
        self.assertEqual(report['outcome'], 'selected')
        self.assertEqual(report['deferredCandidates'][0]['sha'], newest)
        self.assertEqual(report['deferredCandidates'][0]['detail'], 'no refusal text')

    def test_deferred_prequalification_keeps_the_helpers_refusal(self):
        # 2026-11-21: the 03:30 receipt said only "prequalification unavailable"
        # for ac1d44ba; the helper had said why. The receipt now keeps it.
        old, newest, serving = ('a' * 40, 'b' * 40, 'c' * 40)
        args = types.SimpleNamespace(repo='o/r', control=newest, serving=serving)
        refusal = b'qualification inputs differ from selected control\n'
        processes = [mod.subprocess.CompletedProcess([], 3, b'', refusal)] * 2
        report = {'cutoffEpoch': 1, 'deferredCandidates': []}
        with (patch.object(mod, 'git', side_effect=[newest+'\n'+old, serving]),
              patch.object(mod, 'current_schema', return_value=(True, '', {})),
              patch.object(mod, 'statuses', return_value=[(newest, {}), (old, {})]),
              patch.object(mod, 'backup', return_value={'runId': 123, 'rehearsedServingSha': serving, 'playerReconnectedBothDirections': True,
                                                       'rollbackAdoptionSeconds': 135, 'forwardAdoptionSeconds': 7}),
              patch.object(mod.subprocess, 'run', side_effect=processes)):
            mod.select(args, report)
        self.assertEqual([d['reason'] for d in report['deferredCandidates']], ['prequalification unavailable'] * 2)
        self.assertEqual({d['detail'] for d in report['deferredCandidates']},
                         {'qualification inputs differ from selected control'})

    def test_keep_serving_deferred_prequalification_preserves_refusal_detail_and_run_id(self):
        old, newest, serving = ('a' * 40, 'b' * 40, 'c' * 40)
        args = types.SimpleNamespace(repo='o/r', control=newest, serving=serving)
        refusal = b'latest qualification is incomplete, unsuccessful or untrusted (run 44878744051, status=completed, conclusion=failure)\n'
        processes = [mod.subprocess.CompletedProcess([], 3, b'', refusal),
                     mod.subprocess.CompletedProcess([], 3, b'', b'qualification inputs differ from selected control\n')]
        report = {'outcome': 'keep-serving', 'targetSha': None, 'cutoffEpoch': 1, 'deferredCandidates': []}
        with (patch.object(mod, 'git', side_effect=[newest + '\n' + old, serving]),
              patch.object(mod, 'current_schema', return_value=(True, '', {})),
              patch.object(mod, 'statuses', return_value=[(newest, {}), (old, {})]),
              patch.object(mod, 'backup', return_value={'runId': 123, 'rehearsedServingSha': serving, 'playerReconnectedBothDirections': True,
                                                       'rollbackAdoptionSeconds': 135, 'forwardAdoptionSeconds': 7}),
              patch.object(mod.subprocess, 'run', side_effect=processes)):
            mod.select(args, report)
        self.assertEqual(report['outcome'], 'keep-serving')
        self.assertIsNone(report['targetSha'])
        self.assertEqual([d['reason'] for d in report['deferredCandidates']], ['prequalification unavailable'] * 2)
        self.assertEqual(report['deferredCandidates'][0]['sha'], newest)
        self.assertIn('run 44878744051', report['deferredCandidates'][0]['detail'])
        self.assertIn('conclusion=failure', report['deferredCandidates'][0]['detail'])
        self.assertEqual(report['deferredCandidates'][1]['detail'], 'qualification inputs differ from selected control')

    def test_owner_ancestor_keeps_exact_controls_cutoff_and_admission_expiry(self):
        newest, old, serving = 'b'*40, 'a'*40, 'c'*40
        args = types.SimpleNamespace(repo='o/r', control=newest, serving=serving, owner_window='finite-owner')
        for compatible in (False, True):
            report = {'cutoffEpoch':100, 'ownerExpiresEpoch':200, 'deferredCandidates':[]}
            processes = [mod.subprocess.CompletedProcess([], 3),
                         mod.subprocess.CompletedProcess([], 0,
                         mod.json.dumps({'targetSha':old,'controlSha':newest})),
                         mod.subprocess.CompletedProcess([], 0 if compatible else 1, '')]
            with (patch.object(mod, 'git', side_effect=[newest+'\n'+old, serving]),
                  patch.object(mod, 'statuses', return_value=[(newest,{}),(old,{})]) as statuses,
                  patch.object(mod, 'backup', return_value=dict(runId=123, rehearsedServingSha=serving,
                       playerReconnectedBothDirections=True, rollbackAdoptionSeconds=7, forwardAdoptionSeconds=7)),
                  patch.object(mod, 'current_schema', return_value=(True, '', {})),
                  patch.object(mod.subprocess, 'run', side_effect=processes) as run):
                mod.select(args, report)
                statuses.assert_called_once_with('o/r', [newest,old])
                self.assertEqual(run.call_args_list[0].args[0][-1], '100')
                self.assertIn('nov7-owner', run.call_args.args[0])
                self.assertEqual(run.call_args.args[0][-1], '200')
                if compatible:
                    self.assertEqual(report['targetSha'], old)
                else:
                    self.assertNotIn('targetSha', report)

    def test_unavailable_intent_identity_keeps_other_items_reportable(self):
        report = {'controlSha': None, 'targetSha': None, 'cutoffEpoch': 1}
        with patch.object(mod, 'api', side_effect=mod.subprocess.CalledProcessError(1, ['gh'])), \
             patch.object(mod, 'git', side_effect=AssertionError):
            rows = mod.check_intent(report, 'o/r', [7], ['supabase/migrations/1_example.sql'])
        self.assertEqual([row['state'] for row in rows], ['blocked', 'blocked'])
        self.assertIsNone(rows[0]['headSha'])
        self.assertIsNone(rows[1]['intendedBlob'])

    def test_pr_and_schema_report_distinguish_open_closed_and_newer_bytes(self):
        target, control = 'a'*40, 'b'*40
        def fetch(url):
            number = int(url.rsplit('/',1)[1])
            return {'merged_at': None, 'state': 'open' if number == 1 else 'closed',
                    'head': {'sha': str(number)*40}}
        with patch.object(mod,'api',side_effect=fetch), patch.object(mod,'git',side_effect=[
                '100644 blob '+control+'\tmigration.sql', '100644 blob '+target+'\tmigration.sql']):
            rows = mod.check_intent({'controlSha': control, 'targetSha': target, 'cutoffEpoch': 1},
                                    'o/r',[1,2],['supabase/migrations/1_example.sql'])
        self.assertEqual([r['state'] for r in rows], ['deferred','blocked','deferred'])
        self.assertEqual(rows[-1]['selectedBlob'], target)

if __name__ == '__main__':
    unittest.main()
