import unittest
from horse_river_opportunities import river_opportunity
from test_horse_strategy_review import decision


class RiverOpportunityTests(unittest.TestCase):
    def test_legal_open_node_is_denominator_not_mistake_or_bluff(self):
        info=decision()['informationSet'];info['publicState']['pot']=100
        r=river_opportunity(info,'bet')
        self.assertTrue(r['openBetAvailable'])
        self.assertIsNone(r['actualActionIsBluff'])
        self.assertEqual(r['pureBluffSensitivity'][3]['breakEvenAllFoldProbability'],0.5)
        self.assertFalse(r['activationAllowed'])

    def test_all_in_opponent_counts_in_pot_but_cannot_respond(self):
        info=decision()['informationSet'];info['publicState']['seats'][0][6]=2
        r=river_opportunity(info,'check')
        self.assertEqual(r['opponentsStillInHand'],1)
        self.assertEqual(r['opponentsAbleToRespond'],0)

    def test_single_suited_ace_removal_is_not_made_flush_or_scoop(self):
        info=decision()['informationSet']
        info['heroCards']=['As','Ad','Qc','2d'];info['publicState']['boards']=['KsJs8s7c3h']
        r=river_opportunity(info,'check');b=r['blockerFacts'][0]
        self.assertTrue(b['holdsHighestOffBoardSuitCard']);self.assertEqual(b['heroSuitCount'],1)
        self.assertIsNone(r['actualActionIsBluff'])

    def test_short_all_in_call_does_not_become_raise(self):
        info=decision()['informationSet']
        info['priorPublicActions']=[{'seat':1,'stage':'turn','action':'all_in','isFullRaise':False}]
        self.assertFalse(river_opportunity(info,'check')['opponentTurnAggressionObserved'])
        info['priorPublicActions'][0]['isFullRaise']=True
        self.assertTrue(river_opportunity(info,'check')['opponentTurnAggressionObserved'])

    def test_facing_bet_has_no_open_bet_denominator(self):
        info=decision()['informationSet'];info['publicState']['toCall']=20
        info['legalActions']=['fold','call','raise']
        r=river_opportunity(info,'call')
        self.assertFalse(r['openBetAvailable']);self.assertEqual(r['pureBluffSensitivity'],[])

    def test_checked_to_does_not_require_last_position(self):
        info=decision()['informationSet']
        info['priorPublicActions']=[{'seat':1,'stage':'river','action':'check'}]
        info['publicState']['seats'].append([7,100,0,20,0,0,0])
        r=river_opportunity(info,'check')
        self.assertTrue(r['priorOpponentCheckObserved'])
        self.assertEqual(r['opponentsAbleToRespond'],2)


if __name__=='__main__':unittest.main()
