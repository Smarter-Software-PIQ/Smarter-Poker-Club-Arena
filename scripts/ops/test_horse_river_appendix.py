import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from horse_river_appendix import review_opportunity, build_appendix


def fixture():
    return {
        'decisionId': 'synthetic:3', 'handId': 'synthetic', 'domain': 'cash/plo5/lightning',
        'street': 'river', 'action': 'check', 'amount': 0, 'origin': 'horse_policy',
        'informationSha256': 'synthetic-information-hash',
        'ruleContext': {'format': 'cash', 'variant': 'plo5', 'speedFormat': 'lightning',
                        'anteType': 'big_blind', 'ante': 2, 'asset': 'chips', 'tournamentStage': 'cash'},
        'informationSet': {'heroSeat': 2, 'heroCards': ['Ac', 'Kd', '8h', '7s', '2c'],
                           'variant': 'plo5', 'legalActions': ['fold', 'check', 'bet'],
                           'priorPublicActions': [], 'tournamentStage': {'phase': 'cash'},
                           'publicState': {'pot': 500, 'toCall': 0, 'currentBet': 0,
                                           'minRaiseTo': 2, 'maxRaiseTo': 500, 'chipUnit': 1,
                                           'asset': 'chips', 'boards': ['AsKc9h6d3s'],
                                           'seats': [[1, 700, 0, 250, 0, 0, 0], [2, 600, 0, 250, 0, 0, 0]]}},
        'review': {'facts': {'closingUnbetStreet': True,
                             'madeHandsByBoard': [{'highCategory': 'two_pair', 'qualifyingLow': None}],
                             'riverOpportunity': {'blockerFacts': []}}},
    }


class RiverAppendixTests(unittest.TestCase):
    def test_incremental_raise_risk_uses_existing_hero_wager(self):
        d = fixture()
        i = d['informationSet']; p = i['publicState']
        i['legalActions'] = ['fold', 'call', 'raise']
        p.update(toCall=60, currentBet=100, minRaiseTo=200, maxRaiseTo=400)
        p['seats'][0][2] = 100; p['seats'][1][2] = 40
        row = review_opportunity(d)
        size = next(x for x in row['conditionalLegalSizeDiagnostics'] if x['raiseTo']['exact'] == '200')
        self.assertEqual(size['incrementalRisk']['exact'], '160')
        self.assertEqual(size['pureBluffBreakEvenJointAllFoldNoCosts']['exact'], '8/33')
        self.assertEqual(size['headsUpFullCallAdditionalOpponentContribution']['exact'], '100')
        self.assertIn('Calling has separate unknown value', size['compareToCheckRequirement'])

    def test_short_call_and_all_in_opponent_are_not_priced_as_actual_bluff_ev(self):
        d = fixture(); d['informationSet']['publicState']['seats'][0][1] = 10
        row = review_opportunity(d)
        self.assertIn('uncalled_returns_and_short_calls', row['requiredEvidence'])
        self.assertTrue(all('Short calls/uncalled returns' in x['conditionalFormula']
                            for x in row['conditionalLegalSizeDiagnostics']))
        d['informationSet']['publicState']['seats'][0][1] = 0
        d['informationSet']['publicState']['seats'][0][6] = 2
        row = review_opportunity(d)
        self.assertTrue(all(not x['allOpponentsCanRespondAndFold'] for x in row['conditionalLegalSizeDiagnostics']))
        self.assertIsNone(row['recommendedBluff'])
        d['informationSet']['publicState']['seats'][0][6] = 4
        self.assertEqual(review_opportunity(d)['opponentsInHand'], 0)

    def test_domain_asset_ante_and_tournament_geometry_are_preserved(self):
        d = fixture(); d['domain'] = 'tournament/plo8/table'
        d['informationSet']['variant'] = 'plo8'; d['informationSet']['heroCards'].pop()
        d['ruleContext'].update(format='tournament', variant='plo8', speedFormat='table',
                                asset='diamonds', tournamentStage='stone_bubble',
                                paidPlaceGeometry='heads_up_one_regular_paid_place')
        d['informationSet']['publicState']['asset'] = 'diamonds'
        d['informationSet']['tournamentStage'] = {'phase': 'stone_bubble', 'playersLeft': 2, 'spotsPaid': 1}
        row = review_opportunity(d)
        self.assertEqual(row['ruleContext'], d['ruleContext'])
        self.assertIn('full_field_payout_stack_bounty_utility', row['requiredEvidence'])
        self.assertIn('joint_high_low_holdings_scoop_quartering_response_model', row['requiredEvidence'])
        self.assertFalse(row['gtoVerified']); self.assertFalse(row['activationAllowed'])

    def test_sitting_out_all_in_opponent_still_contests_the_pot(self):
        d = fixture()
        seats = d['informationSet']['publicState']['seats']
        seats[0][1] = 0
        seats[0][6] = 6  # all-in plus sitting out is still an eligible hand
        seats.append([3, 500, 0, 250, 0, 0, 0])
        row = review_opportunity(d)
        self.assertEqual(row['opponentsInHand'], 2)
        self.assertEqual(row['opponentsAbleToRespond'], 1)
        self.assertTrue(all(not x['allOpponentsCanRespondAndFold']
                            for x in row['conditionalLegalSizeDiagnostics']))
        from horse_river_opportunities import river_opportunity
        original = river_opportunity({**d['informationSet'], 'street': 'river'}, 'check')
        self.assertEqual(original['opponentsStillInHand'], 2)
        self.assertEqual(original['opponentsAbleToRespond'], 1)

    def test_missing_node_and_bad_price_stay_unknown(self):
        d = fixture(); d['informationSet']['publicState'] = {}; d['informationSet']['legalActions'] = None
        row = review_opportunity(d)
        self.assertEqual(row['conditionalLegalSizeDiagnostics'], [])
        self.assertIsNone(row['opponentsInHand'])
        self.assertIn('original_public_node_unavailable', row['requiredEvidence'])
        d = fixture(); d['informationSet']['publicState']['maxRaiseTo'] = float('nan')
        row = review_opportunity(d)
        self.assertEqual(row['conditionalLegalSizeDiagnostics'], [])
        self.assertIn('captured_price_bounds_or_chip_unit_unavailable', row['requiredEvidence'])

    def test_outcomes_private_opponent_cards_and_future_actions_are_excluded(self):
        d = fixture(); baseline = review_opportunity(d)
        d.update(winners=['private'], netResult=10000, opponentCards=['Qh', 'Qs'],
                 futureActions=[{'action': 'fold'}])
        d['review']['outcome'] = {'winner': 'private'}
        self.assertEqual(review_opportunity(d), baseline)
        self.assertIsNone(baseline['actualActionIsBluff'])
        for variant in ('nlh', 'flo8'):
            other = copy.deepcopy(d); other['informationSet']['variant'] = variant
            self.assertIsNone(review_opportunity(other))

    def test_existing_study_report_generates_appendix_for_new_batch(self):
        from test_horse_hand_analysis import fixture as hand_fixture
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as temp:
            root = Path(temp); source = root / 'raw'; source.mkdir(mode=0o700)
            hand, profiles = hand_fixture()
            (source / 'exclusions.json').write_text('[]')
            for name, rows in [('profiles', [{'id': k, **v} for k, v in profiles.items()]),
                               ('flagged-2026-01-01', [hand])]:
                data = gzip.compress(('\n'.join(json.dumps(row) for row in rows) + '\n').encode())
                (source / (name + '.jsonl.gz')).write_bytes(data)
                (source / (name + '.receipt.json')).write_text(json.dumps({
                    'sha256': hashlib.sha256(data).hexdigest(), 'rows': len(rows)}))
            output = root / 'report'
            import importlib.util
            spec = importlib.util.spec_from_file_location('study_report', Path(__file__).with_name('horse-study-report.py'))
            report = importlib.util.module_from_spec(spec); spec.loader.exec_module(report)
            output.mkdir(mode=0o700)
            report.run(source, output, river_opportunities=True)
            receipt = json.loads((output / 'river-opportunities/summary.json').read_text())
            self.assertEqual(receipt['counts']['decisions'], 1)
            self.assertEqual(receipt['sourceSummarySha256'],
                             hashlib.sha256((output / 'summary.json').read_bytes()).hexdigest())
            self.assertFalse(receipt['activationAllowed'])

    def test_private_cli_batch_integrity_and_no_overwrite(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as temp:
            root = Path(temp); review = root / 'review'; review.mkdir(mode=0o700)
            with gzip.open(review / 'decisions.jsonl.gz', 'wt') as f:
                f.write(json.dumps(fixture()) + '\n')
            digest = hashlib.sha256((review / 'decisions.jsonl.gz').read_bytes()).hexdigest()
            (review / 'summary.json').write_text(json.dumps({'decisions.jsonl.gz': {'sha256': digest}}))
            output = root / 'appendix'
            command = [sys.executable, str(Path(__file__).with_name('horse_river_appendix.py')),
                       '--review', str(review), '--output', str(output)]
            done = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            receipt = json.loads((output / 'summary.json').read_text())
            self.assertEqual(receipt['counts']['decisions'], 1)
            self.assertEqual(receipt['sourceDecisionsSha256'], digest)
            self.assertEqual((output / 'summary.json').stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(ValueError, 'new_output_directory'): build_appendix(review, output)
            review.chmod(0o755)
            with self.assertRaisesRegex(ValueError, 'owner_private_directory'): build_appendix(review, root / 'exposed')
            review.chmod(0o700)
            (review / 'summary.json').write_text(json.dumps({'decisions.jsonl.gz': {'sha256': 'wrong'}}))
            with self.assertRaisesRegex(ValueError, 'source_decisions_hash'): build_appendix(review, root / 'bad-hash')
            self.assertFalse((root / 'bad-hash').exists())


if __name__ == '__main__':
    unittest.main()
