import unittest
from omaha_reference import five,omaha,share,river_bet_model

class OmahaReferenceTests(unittest.TestCase):
    def test_exact_two_hole_cards_not_board_royal(self):
        high,_=omaha(['2c','3d','4c','5d'],['As','Ks','Qs','Js','Ts'],'plo4')
        self.assertEqual(high[0],0)

    def test_naked_ace_is_not_a_flush(self):
        high,_=omaha(['As','2d','4c','5d'],['Ks','Qs','7s','8h','9c'],'plo4')
        self.assertNotEqual(high[0],5)

    def test_all_hole_card_pairs_considered(self):
        b=['As','Ks','Qs','2h','3c']
        for v,h in [('plo4',['4d','5d','Js','Ts']),('plo5',['4d','5d','6h','Js','Ts']),('plo6',['4d','5d','6h','7h','Js','Ts'])]:
            self.assertEqual(omaha(h,b,v)[0],(8,14))

    def test_wheel_and_full_house(self):
        self.assertEqual(five(('As','2h','3c','4d','5s'))[0],(4,5))
        self.assertEqual(five(('As','Ah','Ac','Kd','Ks'))[0],(6,14,13))

    def test_low_requires_five_distinct_ranks(self):
        self.assertIsNone(five(('As','Ah','2c','3d','4s'))[1])
        self.assertEqual(five(('As','2h','3c','4d','8s'))[1],(8,4,3,2,1))

    def test_plo8_quarter_and_three_quarters(self):
        b=['3s','4h','8c','Kd','Ks'];a=['Ac','2c','Qd','Jh'];o=['Ad','2d','Kh','Qc']
        self.assertEqual(share(a,o,b,'plo8'),0.25)
        self.assertEqual(share(o,a,b,'plo8'),0.75)
        self.assertEqual(share(a,o,b,'plo4'),0)

    def test_duplicate_card_rejected(self):
        with self.assertRaises(ValueError): omaha(['As','As','3d','4d'],['2c','3c','4c','5c','6c'],'plo4')

    def test_bluff_break_even_is_conditional_not_a_recommendation(self):
        h=['2c','3d','4c','5d'];b=['As','Ks','Qs','8h','9c'];o=['Js','Ts','6h','7h']
        r=river_bet_model(h,b,'plo4',100,100,[{'cards':o,'weight':1,'foldProbability':0.5}])
        self.assertEqual(r['betEv'],0)
        self.assertEqual(r['checkThroughEv'],0)
        self.assertFalse(r['qualified']);self.assertFalse(r['activationAllowed'])

    def test_card_order_and_suit_relabel_invariance(self):
        h=['Ac','2c','Qd','Jh'];o=['Ad','2d','Kh','Qc'];b=['3s','4h','8c','Kd','Ks']
        change=lambda cards:[c[0]+{'c':'h','h':'d','d':'s','s':'c'}[c[1]] for c in cards]
        self.assertEqual(share(h,o,b,'plo8'),share(change(h[::-1]),change(o),change(b[::-1]),'plo8'))

if __name__=='__main__':unittest.main()
