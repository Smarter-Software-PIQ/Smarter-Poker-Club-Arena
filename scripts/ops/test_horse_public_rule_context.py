import unittest
from horse_hand_analysis import analyze_hand,stage_context
from test_horse_hand_analysis import fixture

class PublicRuleContextTests(unittest.TestCase):
    def test_fixed_limit_asset_and_bet_size_are_retained_and_hashed(self):
        h,p=fixture('flo8');h['players'][0]['cards']=['Ah','Kh','Qc','Jc']
        node=h['actions'][0]['publicNode'];node.update(structure='fixed_limit',asset='chips',fixedBetSize=0.5)
        first=analyze_hand(h,p)['decisions'][0]
        self.assertEqual(first['informationSet']['publicState']['asset'],'chips')
        self.assertEqual(first['informationSet']['publicState']['fixedBetSize'],0.5)
        node['asset']='diamonds';second=analyze_hand(h,p)['decisions'][0]
        self.assertNotEqual(first['informationSha256'],second['informationSha256'])
        node['fixedBetSize']=1;third=analyze_hand(h,p)['decisions'][0]
        self.assertNotEqual(second['informationSha256'],third['informationSha256'])

    def test_missing_fields_are_not_invented_or_recovered_from_final_hand(self):
        h,p=fixture();h.update(asset='diamonds',fixedBetSize=100)
        d=analyze_hand(h,p)['decisions'][0]
        self.assertNotIn('asset',d['informationSet']['publicState'])
        self.assertNotIn('fixedBetSize',d['informationSet']['publicState'])
        node=h['actions'][0]['publicNode'];node.update(asset='chips',fixedBetSize=None,status='unavailable')
        d=analyze_hand(h,p)['decisions'][0]
        self.assertNotIn('asset',d['informationSet']['publicState'])
        self.assertNotIn('fixedBetSize',d['informationSet']['publicState'])

    def test_one_paid_place_heads_up_is_distinguished_without_prize_inference(self):
        for fmt in ('spin','hu_sng','mtt',None):
            node={'tournamentStage':{'status':'captured','playersLeft':2,'spotsPaid':1,'format':fmt}}
            result=stage_context(node,True)
            self.assertEqual(result['phase'],'stone_bubble')
            self.assertEqual(result['paidPlaceGeometry'],'heads_up_one_regular_paid_place')
            self.assertFalse(result['fullUtilityContextAvailable'])
            self.assertNotIn('payouts',result)
        result=stage_context({'tournamentStage':{'status':'captured','playersLeft':11,'spotsPaid':10}},True)
        self.assertEqual(result['paidPlaceGeometry'],'multi_regular_paid_place_bubble')
        result=stage_context({'tournamentStage':{'status':'captured','playersLeft':2,'spotsPaid':0}},True)
        self.assertEqual(result['paidPlaceGeometry'],'not_stone_bubble')

if __name__=='__main__':unittest.main()
