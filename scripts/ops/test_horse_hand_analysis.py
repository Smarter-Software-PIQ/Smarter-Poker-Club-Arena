import copy
import unittest
from horse_hand_analysis import analyze_hand, analyze_decision, stage_context


def fixture(variant='plo5', tournament=False):
    node={'status':'captured','actorSeat':1,'street':'river','variant':variant,
          'structure':'pot_limit','toCall':0,'pot':100,'boards':['AsKd7h6c2s'],
          'seats':[[1,100,0,0,0,0,0],[2,100,0,0,0,0,0]],
          'legalActions':['check','bet'],'ante':2,'anteType':'big_blind'}
    h={'id':'hand','table_id':'table','tournament_id':'event' if tournament else None,
       'game_variant':variant,'players':[{'userId':'horse','seat':1,'cards':['Ah','Kh','Qc','Jc','Ts']},
       {'userId':'human','seat':2,'cards':['2h','3h','4h','5h','6h']}],
       'actions':[{'userId':'horse','seat':1,'stage':'river','action':'check','amount':0,'publicNode':node}]}
    p={'horse':{'is_horse':True},'human':{'is_horse':False}}
    return h,p


class HistoricalStudyTests(unittest.TestCase):
    def test_prior_public_line_is_retained_without_future_or_private_payload(self):
        h,p=fixture()
        earlier={'userId':'human','seat':2,'action':'check','stage':'river',
                 'amount':0,'cards':['As'],'publicNode':{'private':'not-for-policy'}}
        h['actions'].insert(0,earlier)
        first=analyze_hand(h,p)['decisions'][0]
        h['actions'].append({'userId':'human','action':'raise','amount':10000,'stage':'river'})
        second=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(first,second)
        prior=first['informationSet']['priorPublicActions']
        self.assertEqual(prior,[{'userId':'human','seat':2,'action':'check','stage':'river','amount':0}])

    def test_small_and_losing_hands_not_filtered(self):
        h,p=fixture()
        for result in [-100,0,100]:
            h['pot_size']=1;h['net_bb']=result
            r=analyze_hand(h,p)
            self.assertEqual(r['status'],'included')
            self.assertEqual(len(r['decisions']),1)

    def test_exclusions_are_subject_ids_not_names(self):
        h,p=fixture();excluded='excluded-subject'
        h['players'][1]['userId']=excluded;p[excluded]={'is_horse':False}
        self.assertEqual(analyze_hand(h,p,excluded_ids={excluded})['status'],'excluded')
        h['players'].append({'userId':'human','seat':3,'username':'KingFish'})
        r=analyze_hand(h,p,excluded_ids={excluded})
        self.assertEqual(r['status'],'included')
        self.assertEqual(r['humanIds'],['human'])
        self.assertEqual(r['excludedHumansPresent'],[excluded])

    def test_results_and_opponent_cards_never_enter_information_set(self):
        h,p=fixture();a=analyze_hand(h,p)['decisions'][0]
        h['community_cards']=['9s']*5;h['board']=['8h']*5
        h['winners']=[{'userId':'horse','amount':100000}]
        h['players'][1]['cards']=['As']*5
        b=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(a,b)

    def test_missing_tournament_context_never_becomes_cash(self):
        h,p=fixture(tournament=True)
        r=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(r['informationSet']['tournamentStage']['phase'],'unknown')
        self.assertIn('historical_tournament_stage_unavailable',r['gaps'])

    def test_each_variant_retained_without_collapsing_omaha(self):
        for v in ['plo4','plo5','plo6','plo8','flo8','nlh','short_deck','pineapple']:
            h,p=fixture(v)
            r=analyze_hand(h,p)
            self.assertEqual(r['variant'],v)
            self.assertEqual(r['decisions'][0]['informationSet']['variant'],v)

    def test_bubble_and_zero_regular_prizes_are_distinct(self):
        for left,paid,phase in [(11,10,'stone_bubble'),(10,10,'in_money'),(20,0,'no_regular_paid_places'),(30,10,'pre_money')]:
            r=stage_context({'tournamentStage':{'status':'captured','playersLeft':left,'spotsPaid':paid}},True)
            self.assertEqual(r['phase'],phase)
            self.assertFalse(r['fullUtilityContextAvailable'])

    def test_forced_posts_and_refunds_are_not_decisions(self):
        h,p=fixture()
        h['actions'] += [{'userId':'horse','action':'return'}, {'userId':'horse','action':'bet','origin':'forced'}, {'userId':'horse','action':'call','dead':True}]
        self.assertEqual(len(analyze_hand(h,p)['decisions']),1)

    def test_short_stack_call_price_is_capped(self):
        h,p=fixture();a=h['actions'][0];a['action']='call'
        a['publicNode']['toCall']=200;a['publicNode']['seats'][0][1]=20
        a['publicNode']['legalActions']=['fold','call']
        d=analyze_hand(h,p)['decisions'][0]
        self.assertAlmostEqual(d['callPriceFractionBeforeCosts'],20/120)
        self.assertEqual(d['strategicVerdict'],'insufficient_evidence')

    def test_free_fold_candidate_and_timeout_origin_preserved(self):
        h,p=fixture();h['actions'][0]['action']='fold';h['actions'][0]['origin']='timeout'
        r=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(r['origin'],'timeout')
        self.assertTrue(any(f['kind']=='fold_with_free_check_available' for f in r['findings']))
        self.assertFalse(r['activationAllowed'])

    def test_bb_ante_is_preserved(self):
        h,p=fixture();r=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(r['informationSet']['publicState']['anteType'],'big_blind')
        self.assertEqual(r['informationSet']['publicState']['ante'],2)

    def test_missing_hero_cards_never_replaced_with_opponent_cards(self):
        h,p=fixture();h['players'][0]['cards']=[]
        r=analyze_hand(h,p)['decisions'][0]
        self.assertIsNone(r['informationSet']['heroCards'])
        self.assertIn('hero_cards_missing',r['gaps'])

    def test_streets_without_actions_not_invented(self):
        h,p=fixture();r=analyze_hand(h,p)
        self.assertEqual(set(r['horses'][0]['streets']),{'preflop','flop','turn','river'})
        self.assertEqual(r['horses'][0]['streets']['flop']['status'],'no_recorded_decision')
        self.assertFalse(r['analysisComplete'])

    def test_future_cards_in_node_rejected(self):
        h,p=fixture();h['actions'][0]['stage']='flop';h['actions'][0]['publicNode']['street']='flop'
        r=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(r['informationSet']['publicState'],{})
        self.assertIsNone(r['callPriceFractionBeforeCosts'])

    def test_historical_classification_overrides_current_profile(self):
        h,p=fixture();p['horse']['is_horse']=False
        roster=[{'userId':'horse','classification':'horse'},{'userId':'human','classification':'human'}]
        r=analyze_hand(h,p,accepted_roster=roster)
        self.assertEqual(r['status'],'included')
        self.assertEqual(r['horses'][0]['classificationBasis'],'historical_roster')


if __name__=='__main__': unittest.main()
