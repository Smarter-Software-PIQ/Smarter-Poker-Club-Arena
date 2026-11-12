import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from horse_fleet_acceptance import (ancestor, read_journal_captures, digest, journal_witnesses, reconcile_matrix,
    worker_health, timestamp, journal_snapshot_hashes, coverage_summary, P1A, P1B, P2, P3, P4)

SERVING = 'a' * 40
FEATURE = '#10398_plo_preflop_provenance'
WINDOWS = [{'startUtc': '2026-11-11T12:00:00Z', 'endUtc': '2026-11-11T13:00:00Z'}]


def record(sequence, kind, body, turn='c' * 64):
    raw = json.dumps(body, separators=(',', ':'), sort_keys=True)
    producer = '00000000-0000-4000-8000-000000000001'
    event = digest(json.dumps(['horse-journal-event-v1', producer, sequence], separators=(',', ':')).encode())
    fields = [1, producer, sequence, event, 100, SERVING, kind, 'b' * 64, turn, len(raw.encode()), raw]
    names = ('version', 'producerId', 'sequence', 'eventId', 'atMs', 'sourceRelease', 'kind', 'handKey', 'turnKey', 'bytes', 'body')
    return {**dict(zip(names, fields)), 'sha256': digest(json.dumps(fields, separators=(',', ':')).encode())}


def capture():
    at = timestamp('2026-11-11T12:30:00Z')
    snap = {'decisionKey': 'key', 'decisionTimeMs': at, 'fence': 'fence', 'generation': 1,
            'requestId': 1, 'player': {'user_id': 'horse', 'seat': 2}}
    authority = {'version': 1, 'context': {'isOmaha': True}}
    action = {'userId': 'horse', 'seat': 2, 'stage': 'preflop', 'action': 'call', 'amount': 2,
              'timestamp': at + 2, 'origin': 'horse_policy'}
    decision = {'snapshot': snap, 'readFrame': {'json': '{}', 'bytes': 2, 'sha256': digest(b'{}')},
                'decision': {'preflopAuthority': authority}}
    execution = {'identity': {k: v for k, v in snap.items() if k != 'player'},
                 'executionStatus': 'intended', 'policyFallback': None, 'executedAction': 'call',
                 'executedAmount': 2, 'preflopAuthority': authority,
                 'handAnchor': {'status': 'anchored', 'actorId': 'horse', 'seat': 2, 'actionOrdinal': 0},
                 'acceptedActions': [{'intended': True, 'record': action}]}
    execution['identity'].update(variant='plo4', gameMode='cash', stage='preflop')
    terminal = {'actions': [action], 'acceptedActorRoster': {'roster': {'actors': [
        {'userId': 'horse', 'classification': 'horse'}, {'userId': 'human', 'classification': 'human'}]}}}
    return reviewed({'records': [record(1, 'decision', decision), record(2, 'execution', execution),
                                  record(3, 'accepted_hand', terminal)]})


def reviewed(value):
    pairs = sorted([r['eventId'], r['sha256']] for r in value['records'])
    value['review'] = {'version': 1, 'scope': 'single_retained_hand', 'status': 'reconciled', 'gaps': [],
                       'retainedRecords': len(pairs),
                       'manifest': digest(json.dumps(pairs, separators=(',', ':')).encode())}
    return value


def matrix():
    return {'rows': [{'horse_id': 'horse', 'feature_id': FEATURE, 'effectively_configured': True,
                      'eligible': True, 'invoked': 'yes', 'validated': 'yes', 'committed': 'yes',
                      'domain_policy_turns_observed': 500, 'domain_fallback_turns_observed': 0}],
            'uniqueHorseCount': 1, 'featureCount': 1, 'featureList': [FEATURE],
            'observationEpoch': {'servingReleaseSha': SERVING, 'windows': WINDOWS}}


class FleetAcceptanceTests(unittest.TestCase):
    def deep_capture(self, enabled=True, rules=None):
        value = capture()
        decision = json.loads(value['records'][0]['body'])
        decision['decision'].update(action='call', amount=2)
        decision['deepDive'] = {
            'version': 'horse-deep-dive-v1', 'status': 'observed',
            'inputSha256': journal_snapshot_hashes([decision['snapshot']])[0],
            'readFrameSha256': decision['readFrame']['sha256'], 'effectiveEnabled': enabled,
            'pillar2': 'excluded_by_qualification',
            'rules': rules if rules is not None else [{'rule': 'hand_class', 'evaluated': 1, 'eligible': 1, 'changed': 1}],
            'result': {'action': 'call', 'amount': 2}}
        value['records'][0] = record(1, 'decision', decision)
        return reviewed(value)

    def test_reconciled_review_must_describe_the_exact_original_records(self):
        value = capture()
        body = json.loads(value['records'][0]['body'])
        body['decision'].update(action='raise', amount=999)
        value['records'][0] = record(1, 'decision', body)
        with self.assertRaisesRegex(ValueError, 'review_manifest_mismatch'):
            journal_witnesses([value], SERVING, WINDOWS)
        for field, replacement in [('version', 2), ('version', True), ('scope', 'different_hand'),
                                   ('retainedRecords', 2), ('retainedRecords', True),
                                   ('manifest', None)]:
            value = capture(); value['review'][field] = replacement
            with self.subTest(field=field, replacement=replacement):
                with self.assertRaisesRegex(ValueError, 'review_manifest_mismatch'):
                    journal_witnesses([value], SERVING, WINDOWS)

    def test_review_binding_is_order_independent_and_accepts_missing_capture_key(self):
        value = capture(); value['records'].reverse()
        self.assertEqual(len(journal_witnesses([value], SERVING, WINDOWS)[0]), 1)
        value['key'] = 'd' * 64
        with self.assertRaisesRegex(ValueError, 'review_hand_mismatch'):
            journal_witnesses([value], SERVING, WINDOWS)

    def test_pooled_read_credit_requires_the_owning_review_provenance_verdict(self):
        for flag in (None, False, True):
            value = capture(); body = json.loads(value['records'][0]['body'])
            at = body['snapshot']['decisionTimeMs']
            body['observerReads'] = {'cutoffMs': at, 'learnedThroughMs': at - 1,
                                     'pooledPublicProfiles': {'version': 2, 'profiles': 1, 'availableAtMs': at - 1}}
            value['records'][0] = record(1, 'decision', body)
            reviewed(value)
            if flag is not None:
                value['review']['publicReadProvenanceVerified'] = flag
            proof = journal_witnesses([value], SERVING, WINDOWS)[0][0]['features']
            self.assertEqual('#10332_pooled_memory_cutoff' in proof, flag is True)

    def test_original_speed_is_preserved_and_missing_speed_stays_unknown(self):
        for domain, speed in [({'version': 1, 'speed': 'table'}, 'table'),
                              ({'version': 1, 'speed': 'lightning'}, 'lightning'),
                              ({'version': 2, 'speed': 'table'}, 'unknown'), (None, 'unknown')]:
            value = capture(); body = json.loads(value['records'][0]['body'])
            body['snapshot']['gameState'] = {'publicMemoryDomain': domain}
            value['records'][0] = record(1, 'decision', body); reviewed(value)
            witness = journal_witnesses([value], SERVING, WINDOWS)[0][0]
            self.assertEqual(witness['speed'], speed)
            self.assertEqual(witness['handKey'], value['records'][0]['handKey'])

    def test_coverage_separates_speed_human_response_and_absent_samples(self):
        base = {'mode': 'cash', 'variant': 'plo4', 'speed': 'table', 'horse_id': 'horse',
                'handKey': 'one', 'eligibleHumanPresent': True, 'eligibleHumanAbleToRespond': False,
                'features': {P1B: {'evaluated': True, 'eligible': True, 'invoked': True}}}
        rows = [base, {**base, 'eligibleHumanAbleToRespond': True},
                {**base, 'handKey': 'two', 'speed': 'lightning', 'eligibleHumanPresent': False,
                 'eligibleHumanAbleToRespond': False, 'features': {}},
                {**base, 'handKey': 'three', 'speed': 'unknown', 'eligibleHumanAbleToRespond': None, 'features': {}}]
        result = coverage_summary(rows, [P1B])
        cells = {(r['mode'], r['variant'], r['speed']): r for r in result['cells']}
        self.assertEqual(len(cells), 13)  # Twelve expected cells plus explicit unknown speed.
        table = cells['cash', 'plo4', 'table']
        self.assertEqual((table['uniqueHands'], table['decisions']), (1, 2))
        self.assertEqual(table['eligibleHumanAbleToRespond'], {'true': 1, 'false': 1, 'unknown': 0})
        self.assertEqual(table['features'][P1B]['invoked']['true'], 2)
        self.assertEqual(cells['cash', 'plo4', 'lightning']['features'][P1B]['invoked']['unknown'], 1)
        self.assertEqual(cells['tournament', 'plo6', 'table']['status'], 'not_observed_in_capture')

    def test_actual_rule_application_is_not_final_causal_action_change(self):
        witnesses, _ = journal_witnesses([self.deep_capture()], SERVING, WINDOWS)
        proof = witnesses[0]['features'][P1B]
        for key in ('effectively_configured', 'evaluated', 'eligible', 'invoked', 'locally_applied'):
            self.assertTrue(proof[key])
        self.assertIsNone(proof['changed_action'])
        self.assertFalse(witnesses[0]['features'][P2]['effectively_configured'])
        self.assertNotIn('invoked', witnesses[0]['features'][P1A])

    def test_disabled_and_ineligible_rule_evaluations_do_not_credit_invocations(self):
        for enabled, rules in [(False, []), (True, [{'rule': 'flop_cap', 'evaluated': 2, 'eligible': 0, 'changed': 0}])]:
            witnesses, _ = journal_witnesses([self.deep_capture(enabled, rules)], SERVING, WINDOWS)
            proof = witnesses[0]['features'][P3]
            self.assertEqual(proof['effectively_configured'], enabled)
            self.assertNotIn('invoked', proof)

    def test_cross_request_frame_result_duplicate_and_impossible_rule_counts_are_refused(self):
        for field, replacement in [('inputSha256', 'e' * 64), ('readFrameSha256', 'e' * 64),
                                   ('result', {'action': 'raise', 'amount': 99}),
                                   ('rules', [{'rule': 'hand_class', 'evaluated': 1, 'eligible': 0, 'changed': 1}]),
                                   ('rules', [{'rule': 'hand_class', 'evaluated': 1, 'eligible': 1, 'changed': 0}] * 2)]:
            value = self.deep_capture(); body = json.loads(value['records'][0]['body'])
            body['deepDive'][field] = replacement
            value['records'][0] = record(1, 'decision', body)
            reviewed(value)
            with self.assertRaisesRegex(ValueError, 'deep_dive_'):
                journal_witnesses([value], SERVING, WINDOWS)

    def test_journal_hash_uses_javascript_sorted_key_and_number_bytes(self):
        self.assertEqual(journal_snapshot_hashes([{'z': 1.0, 'a': 1e-7}]),
                         [digest(b'{"a":1e-7,"z":1}')])

    def lightning_capture(self, players, results, domain=None, second=None):
        value = capture()
        decision, terminal = json.loads(value['records'][0]['body']), json.loads(value['records'][2]['body'])
        del terminal['acceptedActorRoster']
        terminal['publicMemoryDomain'] = {'version': 1, 'speed': 'lightning'} if domain is None else domain
        terminal['results'] = results
        decision['snapshot']['gameState'] = {'players': players}
        value['records'][0], value['records'][2] = record(1, 'decision', decision), record(3, 'accepted_hand', terminal)
        if second is not None:
            other = copy.deepcopy(decision); other['snapshot']['gameState'] = {'players': second}
            value['records'].append(record(4, 'decision', other))
        return reviewed(value)

    def test_lightning_roster_comes_from_original_decision_frames_and_gaps_stay_unknown(self):
        seat = lambda user, horse: {'user_id': user, 'is_horse': horse, 'is_folded': False, 'is_all_in': False, 'stack': 10}
        everyone = [{'user_id': 'horse'}, {'user_id': 'human'}]
        proof = journal_witnesses([self.lightning_capture([seat('horse', True), seat('human', False)], everyone)], SERVING, WINDOWS)[0][0]
        self.assertEqual((proof['eligibleHumanPresent'], proof['eligibleHumanAbleToRespond'], proof['rosterSource']),
                         (True, True, 'lightning_decision_snapshots'))
        excluded = journal_witnesses([self.lightning_capture([seat('horse', True), seat('human', False)], everyone)],
                                     SERVING, WINDOWS, ['human'])[0][0]
        self.assertIs(excluded['eligibleHumanPresent'], False)
        horse_only = journal_witnesses([self.lightning_capture([seat('horse', True)], [{'user_id': 'horse'}])], SERVING, WINDOWS)[0][0]
        self.assertIs(horse_only['eligibleHumanPresent'], False)
        for results in ([{'user_id': 'horse'}, {'user_id': 'never_seen'}], [], None):
            with self.subTest(results=results):
                gap = journal_witnesses([self.lightning_capture([seat('horse', True)], results)], SERVING, WINDOWS)[0][0]
                self.assertIsNone(gap['eligibleHumanPresent'])
        self.assertEqual(journal_witnesses([capture()], SERVING, WINDOWS)[0][0]['rosterSource'], 'accepted_actor_roster')

    def test_missing_ordinary_roster_and_conflicting_lightning_frames_refuse(self):
        seat = lambda user, horse: {'user_id': user, 'is_horse': horse}
        for domain in ({'version': 1, 'speed': 'table'}, {'version': 2, 'speed': 'lightning'}, {}, 'lightning'):
            with self.subTest(domain=domain), self.assertRaisesRegex(ValueError, 'accepted_actor_roster_required'):
                journal_witnesses([self.lightning_capture([seat('horse', True)], [{'user_id': 'horse'}], domain=domain)], SERVING, WINDOWS)
        for players, second in (([seat('horse', True), seat('human', False)], [seat('horse', True), seat('human', True)]),
                                ([seat('horse', True), seat('human', None)], None), ([seat('horse', True), {'is_horse': False}], None)):
            with self.subTest(players=players), self.assertRaisesRegex(ValueError, 'decision_roster_conflict'):
                journal_witnesses([self.lightning_capture(players, [{'user_id': 'horse'}], second=second)], SERVING, WINDOWS)
        with self.assertRaisesRegex(ValueError, 'accepted_actor_or_origin_mismatch'):
            journal_witnesses([self.lightning_capture([seat('horse', False)], [{'user_id': 'horse'}])], SERVING, WINDOWS)

    def test_lightning_binds_simultaneous_decisions_by_their_exact_action_once(self):
        seat = lambda user, horse, n: {'user_id': user, 'is_horse': horse, 'seat': n}
        value = self.lightning_capture([seat('horse', True, 2), seat('other', True, 3)], [{'user_id': 'horse'}, {'user_id': 'other'}])
        decision, execution, terminal = (json.loads(value['records'][i]['body']) for i in range(3))
        first = terminal['actions'][0]
        second = dict(first, userId='other', seat=3, timestamp=first['timestamp'] + 1)
        terminal['actions'] = [second, first]      # same prior-action count, accepted in the other order
        d2, e2 = copy.deepcopy(decision), copy.deepcopy(execution)
        d2['snapshot'].update(decisionKey='key2', requestId=2, player={'user_id': 'other', 'seat': 3})
        e2['identity'].update(decisionKey='key2', requestId=2)
        e2['handAnchor'].update(actorId='other', seat=3)
        e2['acceptedActions'] = [{'intended': True, 'record': second}]
        value['records'] = [value['records'][0], value['records'][1], record(3, 'accepted_hand', terminal),
                            record(4, 'decision', d2, 'e' * 64), record(5, 'execution', e2, 'e' * 64)]
        proofs = journal_witnesses([reviewed(value)], SERVING, WINDOWS)[0]
        self.assertEqual(sorted(p['horse_id'] for p in proofs), ['horse', 'other'])
        self.assertEqual(len({p['decisionEventId'] for p in proofs}), 2)
        e2['acceptedActions'] = [{'intended': True, 'record': first}]; e2['handAnchor'].update(actorId='horse', seat=2)
        d2['snapshot']['player'] = {'user_id': 'horse', 'seat': 2}
        value['records'][3:] = [record(4, 'decision', d2, 'e' * 64), record(5, 'execution', e2, 'e' * 64)]
        with self.assertRaisesRegex(ValueError, 'accepted_action_bound_twice'):
            journal_witnesses([reviewed(value)], SERVING, WINDOWS)
        terminal['actions'] = [second]
        value['records'][2] = record(3, 'accepted_hand', terminal)
        with self.assertRaisesRegex(ValueError, 'accepted_action_mismatch'):
            journal_witnesses([reviewed(value)], SERVING, WINDOWS)

    def test_empty_and_unreconciled_reads_are_distinct_omissions_not_zero_activity(self):
        empty = {'key': 'f' * 64, 'records': [], 'review': {'version': 1, 'scope': 'single_retained_hand', 'status': 'unavailable', 'retainedRecords': 0}}
        partial = capture(); partial['review']['status'] = 'unavailable'
        proofs, omissions = journal_witnesses([empty, partial], SERVING, WINDOWS)
        self.assertEqual(proofs, [])
        self.assertEqual([o['reason'] for o in omissions], ['no_journal_records_for_key', 'original_reconciliation_incomplete'])
        self.assertEqual(omissions[0]['handKey'], 'f' * 64)

    def test_private_research_exclusions_do_not_erase_the_hand(self):
        witnesses, _ = journal_witnesses([capture()], SERVING, WINDOWS, excluded_ids=['human'])
        self.assertEqual(len(witnesses), 1)
        self.assertFalse(witnesses[0]['eligibleHumanPresent'])

    def test_null_amount_means_zero_only_for_fold_or_check(self):
        for action, expected_count in [('fold', 1), ('check', 1), ('call', 0)]:
            value = capture()
            execution = json.loads(value['records'][1]['body'])
            terminal = json.loads(value['records'][2]['body'])
            execution.update(executedAction=action, executedAmount=None)
            execution['acceptedActions'][0]['record'].update(action=action, amount=0)
            terminal['actions'][0].update(action=action, amount=0)
            value['records'][1] = record(2, 'execution', execution)
            value['records'][2] = record(3, 'accepted_hand', terminal)
            reviewed(value)
            if expected_count:
                self.assertEqual(len(journal_witnesses([value], SERVING, WINDOWS)[0]), expected_count)
            else:
                with self.assertRaisesRegex(ValueError, 'executed_action_mismatch'):
                    journal_witnesses([value], SERVING, WINDOWS)

    def test_domain_activity_and_legacy_passes_do_not_prove_feature_execution(self):
        result = reconcile_matrix(matrix(), {FEATURE: True})
        row = result['rows'][0]
        for key in ('eligible', 'invoked', 'validated', 'committed', 'effectively_configured', 'failed'):
            self.assertIsNone(row[key])
        self.assertTrue(row['unknown'])
        self.assertEqual(row['domain_policy_turns_observed'], 500)
        self.assertFalse(result['completeFleetActivation'])

    def test_original_receipts_bind_the_exact_feature_and_committed_action(self):
        witnesses, omitted = journal_witnesses([capture()], SERVING, WINDOWS)
        self.assertEqual(omitted, [])
        self.assertTrue(witnesses[0]['eligibleHumanPresent'])
        row = reconcile_matrix(matrix(), {FEATURE: True}, witnesses)['rows'][0]
        for key in ('eligible', 'invoked', 'validated', 'committed'):
            self.assertTrue(row[key])
        self.assertFalse(row['changed_action'])
        self.assertIsNone(row['effectively_configured'])

    def test_tampering_and_action_mismatch_fail_closed(self):
        bad = capture(); bad['records'][0]['body'] += ' '
        with self.assertRaisesRegex(ValueError, 'digest_mismatch'):
            journal_witnesses([bad], SERVING, WINDOWS)
        bad = capture(); body = json.loads(bad['records'][2]['body']); body['actions'][0]['amount'] = 200
        bad['records'][2] = record(3, 'accepted_hand', body)
        reviewed(bad)
        with self.assertRaisesRegex(ValueError, 'accepted_action_mismatch'):
            journal_witnesses([bad], SERVING, WINDOWS)

    def test_stale_source_outside_window_and_unexecuted_workers_receive_no_credit(self):
        for source, windows in [('d' * 40, WINDOWS), (SERVING, [{'startUtc': '2026-11-12T12:00:00Z', 'endUtc': '2026-11-12T13:00:00Z'}])]:
            witnesses, omissions = journal_witnesses([capture()], source, windows)
            self.assertEqual(witnesses, []); self.assertEqual(len(omissions), 1)
        bad = capture(); body = json.loads(bad['records'][1]['body']); body['executionStatus'] = 'not_executed'
        bad['records'][1] = record(2, 'execution', body)
        reviewed(bad)
        self.assertEqual(journal_witnesses([bad], SERVING, WINDOWS)[0], [])

    def test_missing_git_evidence_is_unknown_not_not_deployed(self):
        with patch('horse_fleet_acceptance.subprocess.run') as run:
            for code, expected in ((0, True), (1, False), (128, None)):
                run.return_value.returncode = code
                self.assertIs(ancestor('.', 'b' * 40, SERVING), expected)

    def test_worker_inventory_is_system_evidence_and_missing_stores_are_unknown(self):
        self.assertEqual(worker_health({})['status'], 'unknown')
        health = {'liveHorseDecision': {'workerCount': 2, 'workers': [
            {'index': 0, 'phase': 'ready', 'solverStores': {'postflopV31': 0}},
            {'index': 1, 'phase': 'ready'}]}}
        self.assertIsNone(worker_health(health)['postflopV31Zero'])
        health['liveHorseDecision']['workers'][1]['index'] = 0
        self.assertEqual(worker_health(health)['status'], 'unknown')

    def test_duplicate_matrix_rows_and_duplicate_capture_cannot_inflate_coverage(self):
        bad = matrix(); bad['rows'] *= 2
        with self.assertRaisesRegex(ValueError, 'unique_cartesian'):
            reconcile_matrix(bad, {FEATURE: True})
        with self.assertRaisesRegex(ValueError, 'duplicate_capture'):
            journal_witnesses([capture(), capture()], SERVING, WINDOWS)

    def test_an_empty_capture_file_is_a_failed_capture_not_an_empty_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            good, lines, empty, blank, bare = (Path(tmp) / n for n in ('good.json', 'lines.jsonl', 'empty.jsonl', 'blank.jsonl', 'bare.json'))
            good.write_text(json.dumps([capture()])); lines.write_text(json.dumps(capture()) + '\n\n')
            empty.write_bytes(b''); blank.write_text('\n  \n'); bare.write_text('[]')
            sources = {}
            self.assertEqual(len(read_journal_captures([good, lines], sources)), 2)
            self.assertEqual(set(sources), {str(good), str(lines)})
            for path in (empty, blank, bare):
                with self.subTest(path=path.name), self.assertRaisesRegex(ValueError, 'journal_capture_empty'):
                    read_journal_captures([good, path], {})


if __name__ == '__main__':
    unittest.main()
