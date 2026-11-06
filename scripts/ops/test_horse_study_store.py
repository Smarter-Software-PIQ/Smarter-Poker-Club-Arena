import sqlite3
import unittest
from horse_study_store import initialize,put_hand,put_decision,hand_review,candidates


class StudyStoreTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.db.execute('PRAGMA foreign_keys=ON');initialize(self.db)
        put_hand(self.db,{'handId':'h','status':'included','horses':[]},'cash/plo5/table')

    def tearDown(self):self.db.close()

    def item(self,n):
        return {'decisionId':'h:'+str(n),'handId':'h','domain':'cash/plo5/table','street':'river',
            'action':'check','origin':'horse_policy','review':{'candidates':['strong_hand_checkback']}}

    def test_every_decision_retrievable_in_original_order(self):
        put_decision(self.db,self.item(10));put_decision(self.db,self.item(2))
        self.assertEqual([x['decisionId'] for x in hand_review(self.db,'h')['decisions']],['h:2','h:10'])
        self.assertEqual(len(candidates(self.db,'strong_hand_checkback')),2)

    def test_duplicate_or_orphan_cannot_inflate_count(self):
        d=self.item(2);put_decision(self.db,d)
        with self.assertRaises(sqlite3.IntegrityError):put_decision(self.db,d)
        d=self.item(3);d['handId']='missing'
        with self.assertRaises(sqlite3.IntegrityError):put_decision(self.db,d)

    def test_parameterized_lookup_and_named_absence(self):
        with self.assertRaises(ValueError):hand_review(self.db,"h' OR 1=1 --")
        self.assertEqual(candidates(self.db,"x' OR 1=1 --"),[])
        with self.assertRaises(ValueError):candidates(self.db,'x',1001)

    def test_manifest_domain_does_not_mix_cash_tournament_or_variants(self):
        put_decision(self.db,self.item(2))
        other=self.item(3);other['domain']='tournament/plo8/table'
        put_decision(self.db,other)
        found=candidates(self.db,'strong_hand_checkback',domain='cash/plo5/table')
        self.assertEqual([d['decisionId'] for d in found],['h:2'])
        self.assertEqual(candidates(self.db,'strong_hand_checkback',domain='cash/plo6/table'),[])


if __name__=='__main__':unittest.main()
