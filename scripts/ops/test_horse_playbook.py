import unittest
from horse_playbook import build_playbook


class PlaybookTests(unittest.TestCase):
    def test_no_evidence_is_promoted_and_domains_stay_separate(self):
        summary={'uniqueHistoryRows':3,'counts':{'included':3,'decisions':3},
            'strategicReviewCandidates':{'cash/plo5/lightning/strong_hand_checkback':1,
                'cash/plo6/table/strong_hand_checkback':1,
                'tournament/plo8/table/strong_hand_checkback':1}}
        book=build_playbook(summary)
        self.assertFalse(book['activationAllowed'])
        self.assertEqual(len(book['entries']),3)
        for entry in book['entries']:
            self.assertFalse(entry['activationAllowed'])
            self.assertIsNone(entry['qualifiedArtifact'])
            self.assertIsNone(entry['sourceFix'])
            self.assertTrue(all(v=='not_proved_by_this_report' for v in entry['gates'].values()))
        self.assertIn('historical_whole_field_stacks_payouts_and_bounties',book['entries'][-1]['requiredInputs'])


if __name__=='__main__':unittest.main()
