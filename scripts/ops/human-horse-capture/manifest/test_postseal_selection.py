import unittest
from postseal_selection import bound_candidates, classify_roster, select

EXCLUDED_A, EXCLUDED_B = 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'
EXCL = {EXCLUDED_A, EXCLUDED_B}
H = lambda n: {'userId': f'00000000-0000-4000-8000-{n:012d}', 'is_horse': True}
P = lambda n: {'userId': f'11111111-1111-4111-8111-{n:012d}', 'is_horse': False}
X = lambda uid: {'userId': uid, 'is_horse': False}

def row(i, roster, variant='plo5', tournament=False, speed='table', flag=True, minute=0):
    return {'hand_id': f'22222222-2222-4222-8222-{i:012d}', 'game_variant': variant, 'tournament': tournament,
            'original_speed': speed, 'has_human': flag, 'created_at': f'2026-11-12T01:{minute:02d}:00+00:00', 'roster': roster}

class Classification(unittest.TestCase):
    def test_exclusions_first_then_a_real_human_and_horse_are_required(self):
        self.assertEqual(classify_roster([H(1), H(2), P(1)], EXCL)['class'], 'eligible_mixed')
        self.assertEqual(classify_roster([H(1), X(EXCLUDED_A), P(1)], EXCL)['class'], 'eligible_mixed')   # mixed with an excluded subject
        self.assertEqual(classify_roster([H(1), X(EXCLUDED_A), X(EXCLUDED_B)], EXCL)['class'], 'excluded_human_only')
        self.assertEqual(classify_roster([H(1), H(2)], EXCL)['class'], 'horse_only')
        self.assertEqual(classify_roster([P(1), P(2)], EXCL)['class'], 'no_horse')
        # an excluded subject stays excluded even if its profile row is missing or says Horse
        self.assertEqual(classify_roster([H(1), {'userId': EXCLUDED_A, 'is_horse': None}], EXCL)['class'], 'excluded_human_only')
        self.assertEqual(classify_roster([H(1), {'userId': EXCLUDED_B, 'is_horse': True}], EXCL)['class'], 'excluded_human_only')

    def test_unknown_rosters_stay_unknown(self):
        for roster in (None, [], 'x', [H(1), {'userId': 'human1', 'is_horse': False}],
                       [H(1), {'userId': P(1)['userId'], 'is_horse': None}], [H(1), {}], [H(1), X(EXCLUDED_A), {'userId': None}]):
            with self.subTest(roster=roster):
                self.assertEqual(classify_roster(roster, EXCL)['class'], 'unknown_roster')
        mixed = classify_roster([H(1), P(1), {'userId': 'legacy', 'is_horse': None}], EXCL)
        self.assertEqual((mixed['class'], mixed['reason']), ('eligible_mixed', 'unknown_member_present'))

class Selection(unittest.TestCase):
    def test_flag_never_decides_and_gaps_are_explicit(self):
        rows = [row(1, [H(1), H(2)], flag=True, minute=9),                 # flagged human, Horse-only roster
                row(2, [H(1), X(EXCLUDED_A)], flag=True, minute=8),              # excluded-only
                row(3, [H(1), P(1)], flag=False, minute=1),                # eligible mixed, not flagged
                row(4, None, flag=True, minute=7),                         # unknown roster
                row(5, [H(1), P(2)], flag=True, minute=2),
                row(6, [H(1), P(3)], flag=True, minute=3, speed='unknown'),
                row(7, [H(1), H(3)], variant='nlh', tournament=True, flag=False, minute=5)]
        targets, d = select(rows, EXCL)
        cell = [t for t in targets if t['pick'] == 'cell' and t['game_variant'] == 'plo5']
        self.assertEqual([t['hand_id'][-1] for t in cell], ['5', '3'])       # eligible mixed first, latest first; never 1, 2 or 4
        self.assertEqual([t['hand_id'][-1] for t in targets if t['pick'] == 'extra_eligible_mixed'], ['6'])
        self.assertNotIn('4', [t['hand_id'][-1] for t in targets])
        self.assertEqual(d['byClass'], {'horse_only': 2, 'excluded_human_only': 1, 'eligible_mixed': 3, 'unknown_roster': 1})
        self.assertEqual(d['headerFlagDisagreements'], {'flagged_human_but_no_human_in_roster': 1, 'flagged_human_excluded_subjects_only': 1,
                                                        'eligible_mixed_not_flagged_human': 1, 'flagged_human_unknown_roster': 1})
        self.assertIn('nlh/tournament/table', d['cellsWithoutEligibleMixedHand'])
        self.assertNotIn('nlh/tournament/table', d['cellsWithoutAnySelectedHand'])
        self.assertEqual(len(d['cellsWithoutAnySelectedHand']), 10)
        self.assertEqual(d['unknownSpeedByClass'], {'eligible_mixed': 1})

    def test_fill_order_bounds_and_duplicates(self):
        rows = [row(i, [H(1), H(2)], minute=i) for i in range(1, 4)] + [row(9, [H(1), X(EXCLUDED_B)], minute=30)]
        targets, _ = select(rows, EXCL)
        self.assertEqual([t['roster_class']['class'] for t in targets], ['horse_only', 'horse_only'])   # Horse-only fills before excluded-only
        many = [row(100 + i, [H(1), P(i)], minute=i % 60) for i in range(40)]
        targets, _ = select(many, EXCL)
        self.assertEqual((len(targets), len({t['hand_id'] for t in targets})), (10, 10))   # 2 in the cell + 8 extras
        with self.assertRaisesRegex(ValueError, 'duplicate_candidate_hand'):
            select([rows[0], rows[0]], EXCL)

class FromCensus(unittest.TestCase):
    def test_selection_uses_precomputed_census_classes_and_only_bound_target_hands(self):
        def census(i, cls, binding='accepted_terminal_sealed_source', variant='plo5', minute=0):
            r = row(i, None, variant=variant, minute=minute); del r['roster']
            return {**r, 'binding': binding, 'roster_class': {'class': cls, 'reason': None}}
        hands = [census(1, 'eligible_mixed', minute=1), census(2, 'horse_only', minute=9), census(3, 'eligible_mixed', binding='no_horse_binding'),
                 census(4, 'eligible_mixed', binding='accepted_terminal_other_source'), census(5, 'eligible_mixed', binding='post_commit_pending'),
                 census(6, 'eligible_mixed', variant='plo8'), census(7, 'unknown_roster', minute=8),
                 {**census(8, 'horse_only', binding='lightning_journal_identity', variant='nlh'), 'original_speed': 'lightning'}]
        bound = bound_candidates(hands)
        self.assertEqual(sorted(h['hand_id'][-1] for h in bound), ['1', '2', '7', '8'])
        targets, d = select(bound, EXCL)
        self.assertEqual([t['hand_id'][-1] for t in targets], ['8', '1', '2'])
        self.assertEqual(d['byClass'], {'eligible_mixed': 1, 'horse_only': 2, 'unknown_roster': 1})
        self.assertNotIn('roster', targets[0])

if __name__ == '__main__':
    unittest.main()
