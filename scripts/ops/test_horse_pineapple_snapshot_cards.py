import copy
import json
import unittest
from horse_hand_analysis import analyze_hand
from horse_snapshot_cards import recover_pineapple_original_three, recover_own_cards
from test_horse_snapshot_cards import snapshot_fixture
import test_horse_study_report as report_tests


def pineapple():
    h,p,r=snapshot_fixture();h['game_variant']='pineapple';r['game_variant']='pineapple'
    r['original_config']['gameVariant']='pineapple';r['hero_cards']=['Ah','Kh','Qc']
    a=h['actions'][0];a['stage']='preflop';a['publicNode'].update(street='preflop',variant='pineapple',boards=[''])
    d={'hand_id':'hand','table_id':'table','hand_number':42,'hero_id':'horse',
       'own_discard_id':'discard','own_discard_created_at':'2026-11-06T00:00:01+00:00',
       'own_discarded_card':{'rank':'Q','suit':'clubs'}}
    return h,p,r,d


def analyze(h,p,r,d):
    return analyze_hand(h,p,snapshot_rows={'horse':[(r,{})]},discard_rows={'horse':[(d,{})]})['decisions']


class PineappleSnapshotTests(unittest.TestCase):
    def test_original_three_and_recorded_discard_union_agree(self):
        h,p,r,d=pineapple()
        original=analyze(h,p,r,d)[0]
        self.assertEqual(set(original['informationSet']['heroCards']),{'Ah','Kh','Qc'})
        r['hero_cards']=['Ah','Kh']
        reconstructed=analyze(h,p,r,d)[0]
        self.assertEqual(original['informationSet'],reconstructed['informationSet'])
        self.assertIsNone(recover_own_cards(h,'horse',[(r,{})])['cards'])

    def test_final_pair_does_not_enter_preflop_and_original_three_never_enters_flop(self):
        h,p,r,d=pineapple();r['hero_cards']=['Ah','Kh'];h['players'][0]['cards']=['Ah','Kh']
        preflop=h['actions'][0]
        discard={'userId':'horse','seat':1,'action':'discard','stage':'pineapple_discard'}
        flop=copy.deepcopy(preflop);flop['stage']='flop';flop['publicNode'].update(street='flop',boards=['2c3d4h'])
        h['actions']=[preflop,discard,flop]
        result=analyze(h,p,r,d)
        self.assertEqual(len(result[0]['informationSet']['heroCards']),3)
        self.assertEqual(result[1]['informationSet']['heroCards'],['Ah','Kh'])
        self.assertNotIn('snapshotOwnCardRecovery',result[1])
        h['players'][0].pop('cards')
        self.assertIsNone(analyze(h,p,r,d)[1]['informationSet']['heroCards'])

    def test_prior_own_discard_blocks_reconstructed_preflop_any_stage(self):
        h,p,r,d=pineapple()
        h['actions'].insert(0,{'userId':'horse','seat':1,'action':'discard','stage':'flop'})
        got=analyze(h,p,r,d)[0]
        self.assertIsNone(got['informationSet']['heroCards'])
        self.assertFalse(got['snapshotOwnCardRecovery']['accepted'])

    def test_missing_conflicting_invalid_or_late_original_discard_refused(self):
        h,p,r,d=pineapple();r['hero_cards']=['Ah','Kh']
        self.assertIsNone(recover_pineapple_original_three(h,'horse',[(r,{})],[])['cards'])
        for field,value in [('hero_id','human'),('hand_number',43),('table_id','other'),
                            ('own_discard_created_at','2026-11-06T00:00:03+00:00'),
                            ('own_discarded_card','Ah')]:
            with self.subTest(field=field):
                bad={**d,field:value}
                self.assertIsNone(recover_pineapple_original_three(h,'horse',[(r,{})],[(bad,{})])['cards'])
        other={**d,'own_discarded_card':'Jc'}
        self.assertIsNone(recover_pineapple_original_three(h,'horse',[(r,{})],[(d,{}),(other,{})])['cards'])

    def test_later_action_outcomes_and_future_board_cannot_change_original_holdings(self):
        h,p,r,d=pineapple();r['hero_cards']=['Ah','Kh']
        first=analyze(h,p,r,d)[0]
        h.update(winners=['human'],board=['Ah','Kh','Qc']);r['board']=['Ah'];d['opponent_cards']=['As']
        h['actions'].append({'userId':'horse','action':'discard','stage':'pineapple_discard'})
        self.assertEqual(first,analyze(h,p,r,d)[0])


class PineappleReportTests(unittest.TestCase):
    setUp=report_tests.ReportIntegrationTests.setUp
    tearDown=report_tests.ReportIntegrationTests.tearDown
    write=report_tests.ReportIntegrationTests.write

    def test_receipted_own_discard_is_wired_into_report(self):
        h,p,r,d=pineapple();r['hero_cards']=['Ah','Kh']
        self.write('flagged-2026-11-05',[h])
        for name,row in [('snapshot-own-originals-0000',r),('remaining-own-delivery-0000',d)]:
            self.write(name,[row]);path=self.source/(name+'.receipt.json')
            receipt=json.loads(path.read_text());receipt.update(readOnly=True,querySha256='b'*64)
            path.write_text(json.dumps(receipt))
        result=report_tests.report.run(self.source,self.output)
        self.assertEqual(result['counts']['snapshotOwnCardsAccepted'],1)
        self.assertEqual(len(result['originalOwnDiscardSources']),1)
        self.assertFalse(result['activationAllowed'])


if __name__=='__main__':unittest.main()
