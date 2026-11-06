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


class OriginalHeroCardRecoveryTests(unittest.TestCase):
    def recovered(self):
        h,p=fixture();h['players'][0]['cards']=[]
        h['hole_cards']={'horse':[{'rank':r,'suit':s} for r,s in [('A','hearts'),('K','hearts'),('Q','clubs'),('J','clubs'),('T','spades')]],'human':['As']*5}
        return h,p

    def test_original_cards_normalized_actor_only_and_provenanced(self):
        h,p=self.recovered();d=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(d['informationSet']['heroCards'],['Ah','Kh','Qc','Jc','Ts'])
        self.assertEqual(d['heroCardProvenance'],{'source':'hand_history.hole_cards','actorId':'horse','accepted':True})
        h['hole_cards']['human']=['9s']*5
        self.assertEqual(d,analyze_hand(h,p)['decisions'][0])
        del h['hole_cards']['horse']
        self.assertIsNone(analyze_hand(h,p)['decisions'][0]['informationSet']['heroCards'])

    def test_precedence_preserved(self):
        h,p=self.recovered();h['players'][0]['cards']=['Ac','Kc','Qh','Jh','Th']
        self.assertEqual(analyze_hand(h,p)['decisions'][0]['informationSet']['heroCards'],h['players'][0]['cards'])
        facts={'horse':['Ad','Ks','Qs','Js','Tc']}
        self.assertEqual(analyze_hand(h,p,facts)['decisions'][0]['informationSet']['heroCards'],facts['horse'])

    def test_invalid_duplicate_count_and_visible_board_collision_rejected(self):
        for cards in [['Ah']*5,['Ah'],['XX','Kh','Qc','Jc','Ts'],['As','Kh','Qc','Jc','Ts']]:
            with self.subTest(cards=cards):
                h,p=self.recovered();h['hole_cards']['horse']=cards
                self.assertIsNone(analyze_hand(h,p)['decisions'][0]['informationSet']['heroCards'])

    def test_future_board_ignored_and_missing_node_not_invented(self):
        h,p=self.recovered();h['community_cards']=['Ah'];del h['actions'][0]['publicNode']
        d=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(d['informationSet']['heroCards'],['Ah','Kh','Qc','Jc','Ts'])
        self.assertEqual(d['informationSet']['publicState'],{})
        self.assertIn('original_public_node_missing_or_mismatched',d['gaps'])

    def test_discard_game_and_short_deck_invalid_originals_not_recovered(self):
        for variant,cards in [('pineapple',['Ah','Kh','Qc']),('short_deck',['2h','Kh'])]:
            h,p=self.recovered();h['game_variant']=variant;h['hole_cards']['horse']=cards
            self.assertIsNone(analyze_hand(h,p)['decisions'][0]['informationSet']['heroCards'])


class PineappleStreetHoldingTests(unittest.TestCase):
    def fixture(self, street):
        h,p=fixture('pineapple');h['actions'][0]['stage']=street
        node=h['actions'][0]['publicNode'];node['street']=street
        node['boards']=[{'preflop':'','flop':'AsKd7h','turn':'AsKd7h6c','river':'AsKd7h6c2s'}[street]]
        h['players'][0]['cards']=['Ah','Kh']
        return h,p

    def test_future_discard_choice_cannot_change_preflop_information(self):
        h,p=self.fixture('preflop');h['actions'].append({'userId':'horse','action':'discard','stage':'pineapple_discard','cardIndex':0})
        a=analyze_hand(h,p)['decisions'][0]
        h['players'][0]['cards']=['Qc','Jc'];h['actions'][1]['cardIndex']=2
        b=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(a,b)
        self.assertIsNone(a['informationSet']['heroCards'])
        self.assertIn('pineapple_original_three_cards_unavailable',a['gaps'])

    def test_preflop_original_three_recovered_without_final_pair_leakage(self):
        h,p=self.fixture('preflop');h['hole_cards']={'horse':['Ah','Kh','Qc'],'human':['As','Ks','Qs']}
        d=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(d['informationSet']['heroCards'],['Ah','Kh','Qc'])
        self.assertEqual(d['heroCardProvenance']['source'],'hand_history.hole_cards')
        h['players'][0]['cards']=['Jc','Tc']
        self.assertEqual(d,analyze_hand(h,p)['decisions'][0])

    def test_postflop_three_or_unproven_pair_withheld(self):
        for street in ['flop','turn','river']:
            h,p=self.fixture(street)
            self.assertIsNone(analyze_hand(h,p)['decisions'][0]['informationSet']['heroCards'])
            h['actions'].insert(0,{'userId':'horse','action':'discard','stage':'pineapple_discard'})
            self.assertEqual(analyze_hand(h,p)['decisions'][0]['informationSet']['heroCards'],['Ah','Kh'])
            h['players'][0]['cards']=['Ah','Kh','Qc']
            self.assertIsNone(analyze_hand(h,p)['decisions'][0]['informationSet']['heroCards'])


if __name__=='__main__': unittest.main()
