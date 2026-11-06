import copy
import unittest
from horse_snapshot_cards import recover_own_cards
from horse_hand_analysis import analyze_hand
from test_horse_hand_analysis import fixture
import test_horse_study_report as report_tests


def snapshot_fixture():
    hand, profiles = fixture()
    cards = hand['players'][0].pop('cards')
    hand['hand_number'] = 42
    row = dict(hand_id='hand', expected_table_id='table', hero_id='horse',
        table_id='table', hand_number=42, game_variant='plo5', hero_seat='1',
        snapshot_id='snapshot', hero_cards=cards,
        snapshot_created_at='2026-11-06T00:00:00+00:00',
        committed_at='2026-11-06T00:00:02+00:00',
        snapshot_updated_at='2026-11-06T00:00:03+00:00',
        hand_started_at='2026-11-06T00:00:00.140843+00:00',
        hand_ended_at='2026-11-06T00:00:01+00:00',
        original_config=dict(tableId='table',handNumber=42,gameVariant='plo5'))
    return hand, profiles, row


class SnapshotCardsTests(unittest.TestCase):
    def test_fixed_holding_same_database_clock_and_late_completion(self):
        h,p,r=snapshot_fixture()
        got=analyze_hand(h,p,snapshot_rows={'horse':[(r,{'sha256':'abc'})]})['decisions'][0]
        self.assertEqual(set(got['informationSet']['heroCards']),set(r['hero_cards']))
        self.assertTrue(got['snapshotOwnCardRecovery']['accepted'])
        self.assertFalse(got['activationAllowed'])

    def test_identity_mismatch_and_after_commit_are_refused(self):
        h,p,r=snapshot_fixture()
        for field,value in [('table_id','other'),('expected_table_id','other'),('hero_id','human'),
                            ('hand_number',43),('hero_seat','2'),('game_variant','plo4'),
                            ('snapshot_created_at','2026-11-06T00:00:04+00:00')]:
            with self.subTest(field=field):
                bad={**r,field:value}
                self.assertIsNone(recover_own_cards(h,'horse',[(bad,{})])['cards'])
        bad=copy.deepcopy(r);bad['original_config']['handNumber']=43
        self.assertIsNone(recover_own_cards(h,'horse',[(bad,{})])['cards'])

    def test_conflicting_duplicates_withheld_not_selected(self):
        h,p,r=snapshot_fixture();other=copy.deepcopy(r)
        other['hero_cards'][0]='9h'
        result=recover_own_cards(h,'horse',[(r,{}),(other,{})])
        self.assertIsNone(result['cards'])
        self.assertIn('snapshot_conflicting_own_holdings',result['gaps'])
        other['hero_cards']=list(reversed(r['hero_cards']))
        self.assertIsNotNone(recover_own_cards(h,'horse',[(r,{}),(other,{})])['cards'])

    def test_current_visible_board_collision_and_variant_mismatch_refused(self):
        h,p,r=snapshot_fixture();r['hero_cards'][0]='As'
        result=analyze_hand(h,p,snapshot_rows={'horse':[(r,{})]})['decisions'][0]
        self.assertIsNone(result['informationSet']['heroCards'])
        self.assertFalse(result['snapshotOwnCardRecovery']['accepted'])
        self.assertIn('hero_cards_conflict_with_visible_board',result['gaps'])

    def test_pineapple_invalid_cards_and_missing_identity_refused(self):
        h,p,r=snapshot_fixture()
        for variant in ('pineapple','unknown'):
            h['game_variant']=variant
            self.assertIsNone(recover_own_cards(h,'horse',[(r,{})])['cards'])
        h['game_variant']='plo5';r['hero_cards']=['Ah']*5
        self.assertIsNone(recover_own_cards(h,'horse',[(r,{})])['cards'])
        h.pop('hand_number')
        self.assertIsNone(recover_own_cards(h,'horse',[(r,{})])['cards'])

    def test_outcomes_future_board_and_opponent_cards_are_not_inputs(self):
        h,p,r=snapshot_fixture()
        before=analyze_hand(h,p,snapshot_rows={'horse':[(r,{})]})['decisions'][0]
        r.update(winners=['horse'],board=['Ah'],opponent_cards=['Ah'],net_bb=10000)
        h['community_cards']=['Ah'];h['winners']=['horse']
        h['players'][1]['cards']=['Ah']*5
        after=analyze_hand(h,p,snapshot_rows={'horse':[(r,{})]})['decisions'][0]
        self.assertEqual(before,after)


class SnapshotReportTests(unittest.TestCase):
    setUp = report_tests.ReportIntegrationTests.setUp
    tearDown = report_tests.ReportIntegrationTests.tearDown
    write = report_tests.ReportIntegrationTests.write
    # Reuse the maintained receipted-source fixture, not the inherited test cases.
    def test_original_snapshot_reaches_report_and_digest_manifest(self):
        import json,gzip,sqlite3
        from contextlib import closing
        from horse_study_store import hand_review
        from test_horse_study_report import report
        h,p,row=snapshot_fixture()
        self.write('flagged-2026-11-05',[h])
        self.write('snapshot-own-originals-0000',[row])
        receipt=self.source/'snapshot-own-originals-0000.receipt.json'
        data=json.loads(receipt.read_text());data.update(readOnly=True,querySha256='a'*64)
        receipt.write_text(json.dumps(data))
        result=report.run(self.source,self.output)
        self.assertEqual(result['counts']['snapshotOwnCardsAccepted'],1)
        self.assertEqual(len(result['snapshotOwnCardSources']),1)
        with closing(sqlite3.connect(self.output/'study.sqlite')) as db:
            d=hand_review(db,'hand')['decisions'][0]
        self.assertEqual(set(d['informationSet']['heroCards']),set(row['hero_cards']))
        self.assertEqual(d['snapshotOwnCardRecovery']['snapshots'][0]['querySha256'],'a'*64)


if __name__=='__main__':unittest.main()
