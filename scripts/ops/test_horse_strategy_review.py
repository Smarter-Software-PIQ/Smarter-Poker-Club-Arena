import copy
import unittest
from horse_strategy_review import made_hand,closes_unbet_street,review_decision
from omaha_reference import river_high_ceiling,omaha,share


def decision():
    return {'decisionId':'hand:9','informationSha256':'original-input-digest',
        'action':'check','origin':'horse_policy','gaps':[],
        'informationSet':{'heroSeat':5,'heroCards':['Ah','Ad','Kc','2c'],
            'variant':'plo4','street':'river','legalActions':['check','bet'],
            'publicState':{'boards':['AsKhKdQcJs'],'toCall':0,'currentBet':0,
                'dealerSeat':5,'seats':[[1,100,0,20,0,0,0],[5,100,0,20,0,0,0]],
                'anteType':'big_blind','minRaiseTo':2,'maxRaiseTo':40}}}


class StrategyReviewTests(unittest.TestCase):
    def test_short_deck_variant_order_and_low_straight(self):
        flush=made_hand(['Ah','Kh'],['Qh','Jh','8h','Ac','Ad'],'short_deck')
        boat=made_hand(['Ac','Ad'],['Ah','Kc','Kd','Qh','Js'],'short_deck')
        self.assertEqual(flush['highCategory'],'flush')
        self.assertEqual(boat['highCategory'],'full_house')
        self.assertGreater(flush['highRank'],boat['highRank'])
        self.assertEqual(made_hand(['Ac','6d'],['7h','8s','9c'],'short_deck')['highRank'],[4,9])
        with self.assertRaisesRegex(ValueError,'short_deck'):
            made_hand(['Ac','2d'],['7h','8s','9c'],'short_deck')

    def test_pineapple_post_discard_uses_only_retained_pair(self):
        self.assertEqual(made_hand(['Ac','Ad'],['Ah','Kc','Kd'],'pineapple')['highCategory'],'full_house')
        with self.assertRaises(ValueError):
            made_hand(['Ac','Ad','Kh'],['Ah','Kc','Kd'],'pineapple')

    def test_top_boat_blocks_only_quad(self):
        c=river_high_ceiling(['Ah','Ad','Kc','2c'],['As','Kh','Kd','Qc','Js'],'plo4')
        self.assertTrue(c['highUnbeatableAndUntieable'])
        self.assertEqual(c['heroHigh'],[6,14,13])
        self.assertEqual(c['higherPairs']+c['tyingPairs']+c['lowerPairs'],903)

    def test_top_boat_with_quads_live_is_not_nuts(self):
        c=river_high_ceiling(['Ah','Ad','4c','5c'],['As','Kh','Kd','Qc','Js'],'plo4')
        self.assertTrue(c['higherHighPossible'])
        self.assertEqual(c['maximumOpponentHigh'][0],7)
        self.assertEqual(c['fullHousePosition']['tier'],'top')
        self.assertTrue(c['fullHousePosition']['quadsPossible'])

    def test_middle_and_bottom_boats_are_not_collapsed_into_dominated(self):
        board=['Kh','Kd','7s','4c','2h']
        middle=river_high_ceiling(['7h','7d','Ac','Qc'],board,'plo4')['fullHousePosition']
        bottom=river_high_ceiling(['2s','2d','Ac','Qc'],board,'plo4')['fullHousePosition']
        self.assertEqual(middle['tier'],'middle');self.assertEqual(bottom['tier'],'bottom')
        self.assertTrue(middle['lowerFullHouseRanks']);self.assertTrue(middle['higherFullHouseRanks'])

    def test_flop_rank_is_not_river_equity(self):
        h=['Ah','Ad','Kc','2c'];b=['As','Kh','Kd']
        self.assertEqual(omaha(h,b,'plo4')[0],(6,14,13))
        with self.assertRaises(ValueError):share(h,['Qs','Qh','Jc','Tc'],b,'plo4')
        with self.assertRaises(ValueError):river_high_ceiling(h,b,'plo4')

    def test_holdem_can_play_board_but_omaha_cannot(self):
        b=['As','Ks','Qs','Js','Ts']
        self.assertEqual(made_hand(['2c','3d'],b,'nlh')['highCategory'],'straight_flush')
        self.assertEqual(made_hand(['2c','3d','4c','5d'],b,'plo4')['highCategory'],'high_card')

    def test_checked_back_nuts_is_candidate_not_automatic_ev(self):
        r=review_decision(decision(),True)
        self.assertIn('strong_hand_checkback',r['candidates'])
        self.assertTrue(r['facts']['omahaHighCeiling']['highUnbeatable'])
        self.assertEqual(r['strategicVerdict'],'unresolved')
        self.assertFalse(r['activationAllowed'])
        self.assertTrue(all(a['ev'] is None for a in r['alternatives']))

    def test_check_before_opponent_not_mislabeled_checkback(self):
        d=decision();d['informationSet']['heroSeat']=1
        self.assertFalse(closes_unbet_street(d['informationSet']))
        self.assertNotIn('strong_hand_checkback',review_decision(d)['candidates'])

    def test_all_in_seat_has_no_remaining_action(self):
        d=decision();d['informationSet']['publicState']['seats'].append([7,0,0,100,0,0,2])
        self.assertTrue(closes_unbet_street(d['informationSet']))

    def test_sitting_out_seat_cannot_act_behind_or_respond(self):
        d=decision();d['informationSet']['publicState']['dealerSeat']=7
        d['informationSet']['publicState']['seats'].append([7,100,0,0,0,0,4])
        r=review_decision(d)
        self.assertTrue(r['facts']['closingUnbetStreet'])
        self.assertEqual(r['facts']['riverOpportunity']['opponentsStillInHand'],1)
        self.assertEqual(r['facts']['riverOpportunity']['opponentsAbleToRespond'],1)

    def test_no_outcome_or_hidden_card_leakage(self):
        d=decision();before=review_decision(d,True)
        d.update({'winners':['villain'],'opponentCards':['As'],'netAmount':-10000})
        self.assertEqual(before,review_decision(d,True))

    def test_bad_cards_are_unavailable_not_guessed(self):
        d=decision();d['informationSet']['heroCards'][0]='As'
        r=review_decision(d,True)
        self.assertNotIn('madeHandsByBoard',r['facts'])
        self.assertIn('card_reference_input_invalid_or_unsupported',r['requiredEvidence'])

    def test_multiple_boards_not_single_board_certificate(self):
        d=decision();d['informationSet']['publicState']['boards'].append('QsQdQh2h3h')
        r=review_decision(d,True)
        self.assertNotIn('omahaHighCeiling',r['facts'])
        self.assertIn('joint_multiple_board_pot_share_model',r['requiredEvidence'])

    def test_low_variant_does_not_confuse_high_nuts_with_scoop(self):
        d=decision();d['informationSet']['variant']='plo8'
        r=review_decision(d,True)
        self.assertIn('joint_high_low_scoop_quartering_and_counterfeit_model',r['requiredEvidence'])
        self.assertFalse(r['facts']['omahaHighCeiling']['lowShareEvaluated'])


if __name__=='__main__':unittest.main()
