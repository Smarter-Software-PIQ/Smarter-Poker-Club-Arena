import json
import os
import stat
import tempfile
import unittest
from pathlib import Path

import blind_review


def _make_record(idx: int, changed: bool, action: str = 'call', edge: float = 1.8, delta_ev: float = 1.5) -> dict:
    return {
        'sourceId': f'hand-{idx}:turn-1',
        'hand': f'hand-{idx}',
        'changed': changed,
        'game': {'variant': 'plo4', 'mode': 'cash', 'bigBlind': 2},
        'rake': {'pct': 0.05, 'capBb': 3.0},
        'heroCards': ['Ah', 'Kh', 'Qd', 'Jd'],
        'board': ['Th', '9c', '2s'],
        'seats': [{'seat': 1, 'stack': 200}, {'seat': 2, 'stack': 200}],
        'actionLog': [{'stage': 'flop', 'seat': 1, 'action': 'bet', 'amount': 12}],
        'pot': 28,
        'price': 0.30,
        'effectiveStack': 188,
        'spr': 6.7,
        'legalActions': ['fold', 'call', 'raise'],
        'actionTaken': {'action': action, 'amount': 12 if action != 'fold' else 0},
        'journaledReadFrame': {'vpip': 0.28, 'pfr': 0.19},
        'computedLayer': {'potOdds': 0.30},
        'edgeBb': edge,
        'samplingSeBb': 0.30,
        'ratesSeBb': 0.20,
        'realizationSeBb': 0.20,
        'deltaEvActualBb': delta_ev,
        # Forbidden fields on input record must be stripped from reviewer packets:
        'opponentCards': ['2c', '2d', '7s', '8c'],
        'netBbResult': 14.0,
        'candidateAction': 'call',
    }


class TestBlindReview(unittest.TestCase):
    def setUp(self):
        base = os.environ.get('HVH_TEST_TMP')
        self.tmp = tempfile.TemporaryDirectory(dir=base)
        self.out = Path(self.tmp.name) / 'review-run'

    def tearDown(self):
        self.tmp.cleanup()

    def test_action_matched_batches_permissions_and_label_scoring(self):
        records = (
            [_make_record(i, True, 'call', edge=2.0, delta_ev=1.2) for i in range(6)]
            + [_make_record(10 + i, False, 'call', edge=0.5, delta_ev=0.0) for i in range(8)]
            + [_make_record(30 + i, True, 'fold', edge=1.9, delta_ev=0.9) for i in range(6)]
            + [_make_record(40 + i, False, 'fold', edge=0.4, delta_ev=0.0) for i in range(7)]
        )
        res = blind_review.build_blind_batches(records, self.out, seed=20261120, batch_size=10)
        self.assertEqual((res['changedCount'], res['controlCount'], res['totalPackets']), (12, 12, 24))
        self.assertEqual(res['batches'], ['batch-01.json', 'batch-02.json', 'batch-03.json'])

        priv_dir = self.out / 'private'
        key_file = priv_dir / 'key.json'
        self.assertEqual(stat.S_IMODE(priv_dir.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(key_file.stat().st_mode), 0o600)

        # Verify reviewer packets contain NO outcomes, opponent cards, candidate outputs, or group tags
        seen_pids = []
        for bname in res['batches']:
            bdoc = json.loads((self.out / 'batches' / bname).read_text(encoding='utf-8'))
            for pkt in bdoc['packets']:
                seen_pids.append(pkt['packetId'])
                dumped = json.dumps(pkt).lower()
                for forbidden in ('opponentcard', 'netbb', 'candidateaction', 'group', 'deltaev'):
                    self.assertNotIn(forbidden, dumped)

        key_doc = json.loads(key_file.read_text(encoding='utf-8'))
        # Verify 1:1 matching on recordedAction
        ch_acts = sorted(v['recordedAction'] for v in key_doc['packets'].values() if v['group'] == 'changed')
        ct_acts = sorted(v['recordedAction'] for v in key_doc['packets'].values() if v['group'] == 'control')
        self.assertEqual(ch_acts, ct_acts)

        # Incomplete label set -> INSUFFICIENT
        partial = {seen_pids[0]: 'correct'}
        self.assertEqual(blind_review.score_blind_labels(partial, key_doc)['verdict'], 'INSUFFICIENT')

        # Complete label set with hyphen/space variants ('acceptable-close', 'acceptable close')
        full_labels = {}
        for idx, pid in enumerate(seen_pids):
            full_labels[pid] = 'correct' if idx % 2 == 0 else ('acceptable-close' if idx % 4 == 1 else 'acceptable close')
        scored = blind_review.score_blind_labels(full_labels, key_doc, seed=20261120)
        self.assertEqual(scored['status'], 'COMPLETE')
        self.assertEqual(scored['verdict'], 'PASS')
        self.assertEqual(scored['changedCorrectOrAcceptableClose'], 12)
        self.assertEqual(scored['controlCorrectOrAcceptableClose'], 12)

    def test_refuses_when_same_action_controls_are_insufficient(self):
        records = [
            _make_record(1, True, 'call'),
            _make_record(2, True, 'call'),
            _make_record(3, False, 'fold'),
            _make_record(4, False, 'fold'),
        ]
        with self.assertRaisesRegex(ValueError, "insufficient matched unchanged controls with recorded action 'call'"):
            blind_review.build_blind_batches(records, self.out)

    def test_bar_e_prime_fails_when_edge_below_2se(self):
        records = [
            _make_record(1, True, 'call', edge=0.20, delta_ev=1.0),  # tot_se = sqrt(0.09+0.04+0.04)=0.412 -> 2*SE = 0.825 > 0.20
            _make_record(2, False, 'call', edge=0.50, delta_ev=0.0),
        ]
        blind_review.build_blind_batches(records, self.out, seed=7)
        key_doc = json.loads((self.out / 'private' / 'key.json').read_text(encoding='utf-8'))
        labels = {pid: 'correct' for pid in key_doc['packets']}
        scored = blind_review.score_blind_labels(labels, key_doc, seed=7)
        self.assertEqual(scored['verdict'], 'FAIL')
        self.assertFalse(scored['barEPrimeI_edgeGt2Se']['pass'])


if __name__ == '__main__':
    unittest.main()
