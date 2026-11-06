import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing
from test_horse_hand_analysis import fixture
from horse_study_store import hand_review

spec=importlib.util.spec_from_file_location('study_report',Path(__file__).with_name('horse-study-report.py'))
report=importlib.util.module_from_spec(spec);spec.loader.exec_module(report)


class ReportIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.source=self.root/'raw';self.source.mkdir()
        (self.source/'exclusions.json').write_text('[]')
        self.output=self.root/'report';self.output.mkdir()
        h,p=fixture();self.hand=h
        self.write('profiles',[{'id':k,**v} for k,v in p.items()])
        self.write('flagged-2026-11-05',[h])

    def tearDown(self):self.tmp.cleanup()

    def write(self,name,rows):
        data=gzip.compress(('\n'.join(json.dumps(r) for r in rows)+'\n').encode(),mtime=0)
        (self.source/(name+'.jsonl.gz')).write_bytes(data)
        (self.source/(name+'.receipt.json')).write_text(json.dumps({'sha256':hashlib.sha256(data).hexdigest(),'rows':len(rows)}))

    def test_receipted_inputs_reach_hand_decision_store_and_manifest(self):
        result=report.run(self.source,self.output)
        self.assertEqual(result['counts']['decisions'],1)
        self.assertFalse(result['strategicAnalysisComplete'])
        with closing(sqlite3.connect(self.output/'study.sqlite')) as db:
            hand=hand_review(db,'hand')
        self.assertEqual(len(hand['decisions']),1)
        self.assertIn('review',hand['decisions'][0])
        self.assertEqual(hand['decisions'][0]['ruleContext']['anteType'],'big_blind')
        manifest=json.loads((self.output/'implementation-playbook.json').read_text())
        self.assertFalse(manifest['activationAllowed'])
        self.assertEqual(result['study.sqlite']['sha256'],hashlib.sha256((self.output/'study.sqlite').read_bytes()).hexdigest())
        with gzip.open(self.output/'individual-hand-reviews.md.gz','rt') as f:narrative=f.read()
        self.assertIn('# Hand hand',narrative)
        for street in ('Preflop','Flop','Turn','River'):self.assertIn('### '+street,narrative)
        self.assertIn('Verdict: unresolved',narrative)
        self.assertEqual(result['riverOpportunityCounts']['cash/plo5/table/open_bet_opportunities'],1)

    def test_corrupt_input_is_not_certified(self):
        (self.source/'flagged-2026-11-05.jsonl.gz').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'source_digest_mismatch'):report.run(self.source,self.output)
        self.assertFalse((self.output/'summary.json').exists())

    def test_captured_asset_limit_and_paid_places_reach_exact_rule_context(self):
        h=self.hand;h['game_variant']='flo8';h['tournament_id']='event'
        h['players'][0]['cards']=['Ah','Kh','Qc','Jc']
        node=h['actions'][0]['publicNode']
        node.update(variant='flo8',structure='fixed_limit',asset='diamonds',fixedBetSize=20,
                    tournamentStage={'status':'captured','playersLeft':2,'spotsPaid':1})
        self.write('flagged-2026-11-05',[h])
        result=report.run(self.source,self.output)
        with closing(sqlite3.connect(self.output/'study.sqlite')) as db:
            decision=hand_review(db,'hand')['decisions'][0]
        context=decision['ruleContext']
        self.assertEqual(context['asset'],'diamonds')
        self.assertEqual(context['fixedBetSize'],20)
        self.assertEqual(context['paidPlaceGeometry'],'heads_up_one_regular_paid_place')
        self.assertEqual(context['tournamentStage'],'stone_bubble')
        self.assertFalse(result['strategicAnalysisComplete'])

    def test_missing_exclusion_configuration_cannot_silently_include_everyone(self):
        (self.source/'exclusions.json').unlink()
        with self.assertRaises(FileNotFoundError):report.run(self.source,self.output)
        self.assertFalse((self.output/'summary.json').exists())

    def test_current_day_batches_are_included(self):
        self.hand['id']='today'
        self.write('today-flagged-20261106-0022',[self.hand])
        result=report.run(self.source,self.output)
        self.assertEqual(result['uniqueHistoryRows'],2)


if __name__=='__main__':unittest.main()
