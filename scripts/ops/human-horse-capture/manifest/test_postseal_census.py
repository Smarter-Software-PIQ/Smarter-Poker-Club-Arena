import datetime, unittest
from postseal_census import read_window, window_slices
UTC = datetime.timezone.utc
T = lambda h, m, s=0: datetime.datetime(2026, 11, 12, h, m, s, tzinfo=UTC)
H = {'userId': '00000000-0000-4000-8000-000000000001', 'is_horse': True}
P = {'userId': '11111111-1111-4111-8111-000000000001', 'is_horse': False}
def hand(i, at, roster=(H, P), speed='table', binding='accepted_terminal_sealed_source'):
    return {'hand_id': f'h{i}', 'game_variant': 'plo5', 'tournament': False, 'original_speed': speed, 'binding': binding,
            'has_human': True, 'created_at': at.isoformat(), 'roster': list(roster) if roster is not None else None}

class Census(unittest.TestCase):
    def test_slices_are_contiguous_half_open_and_cover_the_window_once(self):
        s = window_slices(T(1, 0), T(2, 0))
        self.assertEqual(len(s), 60); self.assertEqual(s[0][0], T(1, 0)); self.assertEqual(s[-1][1], T(2, 0))
        self.assertTrue(all(a[1] == b[0] for a, b in zip(s, s[1:])))
        self.assertEqual(window_slices(T(1, 0), T(1, 2)), [(T(1, 0), T(1, 1)), (T(1, 1), T(1, 2))])
        with self.assertRaises(ValueError): window_slices(T(1, 0), T(1, 0))

    def test_boundary_hands_empty_slices_and_failed_slices_stay_distinct(self):
        data = {T(1, 0): [hand(1, T(1, 0)), hand(2, T(1, 0, 59)), hand(3, T(1, 0, 20), roster=None), hand(4, T(1, 0, 30), roster=(H,), speed='lightning', binding='lightning_journal_identity')],
                T(1, 1): []}
        def reader(a, b):
            if a == T(1, 2): raise RuntimeError('ERROR: canceling statement due to statement timeout')
            return data[a]
        slices, total, hands = read_window(T(1, 0), T(1, 3), reader, set())
        self.assertEqual([(s['status'], s.get('hands')) for s in slices], [('read', 4), ('read', 0), ('MISSING_SERIES', None)])
        self.assertIn('statement timeout', slices[2]['reason'])
        self.assertEqual(total['plo5|cash|table|accepted_terminal_sealed_source|eligible_mixed|flagged_human'], 2)
        self.assertEqual(total['plo5|cash|table|accepted_terminal_sealed_source|unknown_roster|flagged_human'], 1)
        self.assertEqual(total['plo5|cash|lightning|lightning_journal_identity|horse_only|flagged_human'], 1)
        self.assertEqual([h['hand_id'] for h in hands], ['h1', 'h2', 'h3', 'h4'])
        self.assertEqual(hands[2]['roster_class']['class'], 'unknown_roster'); self.assertNotIn('roster', hands[0])

    def test_speed_resolved_by_lightning_link_is_recorded_per_hand_and_never_inflates_totals(self):
        rows = [hand(1, T(1, 0, 1)), {**hand(2, T(1, 0, 2)), 'speed_source': 'resolved_by_lightning_link'},
                {**hand(3, T(1, 0, 3), speed='unknown'), 'speed_source': 'contradictory_recorded_vs_lightning_link'}]
        slices, total, hands = read_window(T(1, 0), T(1, 1), lambda a, b: rows, set())
        self.assertEqual(sum(total.values()), 3)
        self.assertEqual(slices[0]['speedSources'], {'contradictory_recorded_vs_lightning_link': 1, 'recorded': 1, 'resolved_by_lightning_link': 1})
        self.assertEqual([h['speed_source'] for h in hands], ['recorded', 'resolved_by_lightning_link', 'contradictory_recorded_vs_lightning_link'])
        self.assertEqual(total['plo5|cash|unknown|accepted_terminal_sealed_source|eligible_mixed|flagged_human'], 1)

    def test_truncated_duplicate_and_out_of_boundary_slices_are_missing_not_counted(self):
        cases = {'slice_truncated': [hand(i, T(1, 0, 1)) for i in range(6001)],
                 'duplicate_hand': [hand(1, T(1, 0, 1)), hand(1, T(1, 0, 2))],
                 'hand_outside_slice_boundary': [hand(1, T(1, 1))]}       # end is exclusive
        for reason, rows in cases.items():
            with self.subTest(reason=reason):
                slices, total, hands = read_window(T(1, 0), T(1, 1), lambda a, b: rows, set())
                self.assertEqual(slices[0]['status'], 'MISSING_SERIES'); self.assertIn(reason, slices[0]['reason']); self.assertEqual(sum(total.values()), 0)
        repeat = lambda a, b: [hand(7, a)]     # the same hand id returned by two slices
        slices, total, hands = read_window(T(1, 0), T(1, 2), repeat, set())
        self.assertEqual([s['status'] for s in slices], ['read', 'MISSING_SERIES']); self.assertEqual(sum(total.values()), 1)

if __name__ == '__main__':
    unittest.main()
