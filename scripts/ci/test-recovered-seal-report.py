#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('report', Path(__file__).with_name('recovered-seal-report.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class RecoveryReport(unittest.TestCase):
    def setUp(self):
        self.repo = 'owner/repo'
        self.run = dict(id=123, run_attempt=1, display_title='Engine Release '+'a'*40,
                        path='.github/workflows/auto-deploy-hetzner.yml', status='completed',
                        conclusion='failure', html_url='https://github.com/owner/repo/actions/runs/123')
        self.seal = dict(schema=1, result='sealed', runId='123-1', sha='a'*40,
                         containerId='b'*64, imageId='sha256:'+'c'*64, instanceId='instance', startedAt='timestamp')
        self.seal['completionRuntime'] = {k:self.seal[k] for k in ('containerId','instanceId','startedAt')}
        self.seal['completionRuntime']['invocationId'] = 'd'*32
        self.runtime = dict(Id='b'*64, Image='sha256:'+'c'*64, State=dict(StartedAt='timestamp', Running=True))
        self.health = dict(status='ok', releaseSha='a'*40, instanceId='instance', leadership=dict(holder='instance'), maintenance=dict(active=False, phase='idle'))
    def build(self):
        return m.build_report(self.repo,self.run,self.seal,self.runtime,self.health,'https://github.com/owner/repo/actions/runs/456/attempts/1')
    def test_links_original_failure_without_rewriting_inputs(self):
        before = copy.deepcopy((self.run,self.seal,self.runtime,self.health))
        report, summary, check = self.build()
        self.assertEqual(before,(self.run,self.seal,self.runtime,self.health))
        self.assertIn('/runs/123/attempts/1',summary)
        self.assertIn('remains **failure**',summary)
        self.assertEqual(report['originalConclusion'],'failure')
        self.assertEqual(check['external_id'],'recovered-engine-release:123-1')
        self.assertFalse(report['releaseMutation'])
    def test_refuses_wrong_run_sha_container_invocation_or_serving_identity(self):
        for obj,field,value in [(self.seal,'runId','124-1'),(self.seal,'sha','e'*40),
                                (self.runtime,'Id','e'*64),(self.run,'conclusion','success'),
                                (self.run,'path','.github/workflows/other.yml'),
                                (self.run,'html_url','https://github.com/other/repo/actions/runs/123')]:
            with self.subTest(field=field):
                old=obj[field];obj[field]=value
                with self.assertRaises(ValueError):self.build()
                obj[field]=old
        self.seal['completionRuntime']['invocationId']=''
        with self.assertRaises(ValueError):self.build()
    def test_refuses_active_maintenance_or_stopped_runtime(self):
        self.health['maintenance']['active']=True
        with self.assertRaises(ValueError):self.build()
        self.health['maintenance']['active']=False
        self.runtime['State']['Running']=False
        with self.assertRaises(ValueError):self.build()
    def test_superseded_seal_remains_historical(self):
        self.health.update(releaseSha='e'*40,instanceId='new-instance')
        report,summary,_=self.build()
        self.assertFalse(report['currentlyServing'])
        self.assertIn('Historical sealed SHA',summary)
        self.assertIn('e'*40,summary)
        self.assertEqual(report['originalConclusion'],'failure')
    def test_workflow_has_no_release_or_financial_mutation(self):
        text=(Path(__file__).parents[2]/'.github/workflows/report-recovered-engine-seal.yml').read_text()
        self.assertNotIn('schedule:',text)
        self.assertNotIn('repository_dispatch',text)
        self.assertNotIn('DATABASE_URL',text)
        self.assertNotIn('systemctl',text)
        self.assertIn('docker inspect',text)
        self.assertIn('recovered-seal-report.py',text)

if __name__=='__main__':unittest.main()
