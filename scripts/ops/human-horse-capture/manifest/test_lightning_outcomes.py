import datetime, unittest
import lightning_outcomes as lo
U = datetime.timezone.utc; S = datetime.datetime(2026, 11, 12, 1, 0, tzinfo=U); M = datetime.timedelta(minutes=1)
def row(i, minute=0, **k):
    base = {'lightning_hand_id': f'L{i}', 'hand_history_id': None, 'formed_at': (S + minute * M).isoformat(), 'settled': False, 'voided': False,
            'numbered': False, 'void_reason_class': '', 'instance_state': 'dealing', 'history_row_present': False}
    return base | k
class T(unittest.TestCase):
    def test_each_outcome_is_distinct(self):
        self.assertEqual(lo.classify(row(1, settled=True, hand_history_id='H1', history_row_present=True)), 'committed')
        self.assertEqual(lo.classify(row(1, settled=True, hand_history_id='H1')), 'settled_history_missing')
        self.assertEqual(lo.classify(row(1, settled=True)), 'settled_unlinked')
        self.assertEqual(lo.classify(row(1, voided=True, instance_state='abandoned')), 'voided')
        self.assertEqual(lo.classify(row(1, instance_state='abandoned')), 'abandoned_unresolved')
        self.assertEqual(lo.classify(row(1)), 'open_in_flight')
        for bad in (row(1, settled=True, voided=True), row(1, voided=True, hand_history_id='H1'), row(1, settled=None)):
            self.assertEqual(lo.classify(bad), 'contradictory')
    def test_voids_are_counted_not_dropped_and_failed_slices_are_missing(self):
        data = {0: [row(1, settled=True, hand_history_id='H1', history_row_present=True), row(2, voided=True, numbered=True, void_reason_class='leadership_lost', instance_state='abandoned')],
                1: [row(3, 1, voided=True, void_reason_class='begin_dealing refused', instance_state='abandoned')]}
        def reader(a, b):
            m = int((a - S) / M)
            if m == 2: raise RuntimeError('ERROR: canceling statement due to statement timeout')
            return data.get(m, [])
        slices, total, hands = lo.read_outcomes(S, S + 4 * M, reader)
        self.assertEqual([s['status'] for s in slices], ['read', 'read', 'MISSING_SERIES', 'read'])
        self.assertEqual((total['committed'], total['voided'], total['voided|dealt_numbered|leadership_lost'], total['voided|never_dealt|begin_dealing refused']), (1, 2, 1, 1))
        self.assertEqual(slices[3]['hands'], 0)   # read and empty is not the same as missing
        self.assertEqual(len(hands), 3)
    def test_retry_duplicate_and_boundary_refuse_the_slice(self):
        dup = lambda a, b: [row(1), row(1)]
        self.assertIn('duplicate', lo.read_outcomes(S, S + M, dup)[0][0]['reason'])
        again = lambda a, b: [row(1, int((a - S) / M))]
        s, total, hands = lo.read_outcomes(S, S + 2 * M, again)
        self.assertEqual((s[0]['status'], s[1]['status'], len(hands)), ('read', 'MISSING_SERIES', 1))
        late = lambda a, b: [row(1, 5)]
        self.assertIn('boundary', lo.read_outcomes(S, S + M, late)[0][0]['reason'])
    def test_reconcile_never_double_counts_or_promotes_a_void(self):
        census = [{'hand_id': 'H1', 'original_speed': 'lightning'}, {'hand_id': 'H9', 'original_speed': 'lightning'}, {'hand_id': 'T1', 'original_speed': 'table'}]
        hands = [{'lightning_hand_id': 'L1', 'hand_history_id': 'H1', 'outcome': 'committed'}, {'lightning_hand_id': 'L2', 'hand_history_id': None, 'outcome': 'voided'},
                 {'lightning_hand_id': 'L3', 'hand_history_id': None, 'outcome': 'open_in_flight'}, {'lightning_hand_id': 'L4', 'hand_history_id': 'H7', 'outcome': 'committed'}]
        r = lo.reconcile(hands, census, True, True)
        self.assertEqual(r['counts'], {'census_lightning_headers_without_outcome_row': 1, 'committed_in_census': 1, 'committed_outside_census_window_or_missing_slice': 1,
                                       'open_in_flight_not_in_census': 1, 'voided_not_in_census': 1})
        self.assertFalse(r['defect'])
        two = hands + [{'lightning_hand_id': 'L5', 'hand_history_id': 'H1', 'outcome': 'committed'}]
        self.assertTrue(lo.reconcile(two, census, True, True)['defect'])
        wrong = [{'lightning_hand_id': 'L6', 'hand_history_id': 'T1', 'outcome': 'committed'}]
        self.assertTrue(lo.reconcile(wrong, census, True, True)['defect'])
        self.assertFalse(lo.reconcile(hands, census, True, False)['complete'])
