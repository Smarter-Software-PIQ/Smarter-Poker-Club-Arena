"""Private fleet evidence reconciliation. Read-only inputs; no release or policy activation.

Domain activity, serving source, worker health and feature execution are different
observations. Null means unknown; absence of a journal witness never means false.
"""
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
from horse_study_subjects import read_subjects

P1A = '#10455_v87_p1a_presumed_preflop'
P1B = '#10455_v87_p1b_omaha_hand_class'
P2 = '#10455_v87_p2_river_stab_excluded'
P3 = '#10455_v87_p3_postflop_bigbet_commit'
P4 = '#10455_v87_p4_tourney_nlh_turn'
R78 = 'excluded_r7_r8_postflop_v31'
COUNTERS = ('available_on_serving_workers', 'effectively_configured', 'eligible',
            'naturally_observed', 'evaluated', 'invoked', 'locally_applied',
            'changed_action', 'validated', 'committed', 'failed')
RULE_FEATURES = {
    'presumed_opener': P1A,
    **{r: P1B for r in ('hand_class', 'limp_bar', 'cold_call_bar', 'price_relief', 'call_floor', 'blind_floor')},
    **{r: P3 for r in ('plo6_big_bet', 'flop_cap', 'raised_commitment')},
    **{r: P4 for r in ('priced_in_floor', 'nlh_turn_shade')},
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timestamp_requires_timezone')
    return parsed.timestamp() * 1000


def ancestor(repo, required, serving):
    if not all(isinstance(s, str) and re.fullmatch('[0-9a-f]{40}', s) for s in (required, serving)):
        return None
    result = subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', required, serving],
                            capture_output=True, timeout=20)
    return True if result.returncode == 0 else False if result.returncode == 1 else None


def worker_health(health):
    pool = health.get('liveHorseDecision')
    if not isinstance(pool, dict):
        return {'status': 'unknown', 'reason': 'worker_pool_unavailable'}
    workers = pool.get('workers')
    expected = pool.get('workerCount')
    if not isinstance(workers, list) or type(expected) is not int or expected < 1 or len(workers) != expected:
        return {'status': 'unknown', 'reason': 'worker_census_incomplete'}
    if {w.get('index') for w in workers} != set(range(expected)):
        return {'status': 'unknown', 'reason': 'worker_ids_missing_or_duplicated'}
    ready = all(w.get('phase') == 'ready' for w in workers)
    v31 = [w.get('solverStores', {}).get('postflopV31') for w in workers]
    return {'status': 'ready' if ready else 'not_ready', 'workerCount': expected,
            'postflopV31Zero': all(type(n) is int and n == 0 for n in v31) if all(n is not None for n in v31) else None,
            'source': 'liveHorseDecision.workers',
            'limitation': 'Worker health and solver schema do not identify a per-Horse strategy invocation.'}


def in_window(at, windows):
    return any(timestamp(w['startUtc']) <= at < timestamp(w['endUtc']) for w in windows)


def validate_record(record):
    fields = ('version', 'producerId', 'sequence', 'eventId', 'atMs', 'sourceRelease',
              'kind', 'handKey', 'turnKey', 'bytes', 'body')
    body = record['body']
    encoded = json.dumps([record[k] for k in fields], ensure_ascii=False, separators=(',', ':')).encode()
    event = json.dumps(['horse-journal-event-v1', record['producerId'], record['sequence']], separators=(',', ':')).encode()
    if record['version'] != 1 or digest(encoded) != record['sha256'] or digest(event) != record['eventId'] or len(body.encode()) != record['bytes']:
        raise ValueError('journal_record_digest_mismatch')
    return json.loads(body)


def journal_snapshot_hashes(values):
    # The producer sorts object keys and uses JavaScript number serialization.
    # Python's 1.0 / exponent formatting cannot authenticate those bytes.
    script = """const fs=require('node:fs'), crypto=require('node:crypto');
function ordered(v) {
  if(Array.isArray(v)) return v.map(ordered);
  if(v && typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])]));
  return v;
}
process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(v=>
  crypto.createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex'))));
"""
    result = subprocess.run(['node', '-e', script], input=json.dumps(values, allow_nan=False),
                            text=True, capture_output=True, timeout=30, check=True)
    return json.loads(result.stdout)


def deep_dive_features(value, snapshot_hash, decision, frame_hash):
    """Consume HorseDeepDiveReceipt v1; local applications are not causal effects."""
    if value is None:
        return {}
    fields = {'version', 'status', 'inputSha256', 'readFrameSha256', 'effectiveEnabled', 'pillar2', 'rules', 'result'}
    if (not isinstance(value, dict) or set(value) != fields or value['version'] != 'horse-deep-dive-v1'
            or value['status'] not in ('observed', 'not_reached', 'refused')
            or value['inputSha256'] != snapshot_hash or value['readFrameSha256'] != frame_hash
            or type(value['effectiveEnabled']) not in (bool, type(None))
            or value['pillar2'] != 'excluded_by_qualification'
            or value['result'] != {'action': decision['action'], 'amount': decision.get('amount')}
            or not isinstance(value['rules'], list) or len(value['rules']) > len(RULE_FEATURES)):
        raise ValueError('deep_dive_binding_invalid')
    enabled, rules, status = value['effectiveEnabled'], value['rules'], value['status']
    if ((status == 'observed' and (enabled is None or decision.get('policyFallback')))
            or (status == 'not_reached' and (enabled is not None or rules))
            or (enabled is not True and rules)):
        raise ValueError('deep_dive_status_invalid')
    seen = set()
    for row in rules:
        if (not isinstance(row, dict) or set(row) != {'rule', 'evaluated', 'eligible', 'changed'}
                or row['rule'] not in RULE_FEATURES or row['rule'] in seen
                or any(type(row[k]) is not int for k in ('evaluated', 'eligible', 'changed'))
                or not 0 <= row['changed'] <= row['eligible'] <= row['evaluated'] <= 32 or row['evaluated'] < 1):
            raise ValueError('deep_dive_rule_invalid')
        seen.add(row['rule'])
    if status != 'observed':
        return {}
    out = {fid: {'effectively_configured': enabled, 'changed_action': None}
           for fid in (P1A, P1B, P3, P4)}
    out[P2] = {'effectively_configured': False, 'changed_action': None}
    for row in rules:
        feature = out[RULE_FEATURES[row['rule']]]
        feature['evaluated'] = True
        feature.setdefault('ruleEvidence', []).append(row)
        if row['eligible'] > 0:
            feature.update(eligible=True, invoked=True)
        if row['changed'] > 0:
            feature['locally_applied'] = True
    return out


def journal_witnesses(captures, serving, windows, excluded_ids=()):
    """Bind existing original decision/execution/accepted-hand records before attribution.

This credits only receipt formats whose meaning is already established by the
owning source. It does not infer V87 pillars from generic BrainTelemetry counters.
"""
    witnesses, omissions = [], []
    seen_events = set()
    deep_records = [(record['eventId'], json.loads(record['body'])['snapshot'])
                    for capture in captures for record in capture['records']
                    if record['kind'] == 'decision' and json.loads(record['body']).get('deepDive') is not None]
    deep_hashes = dict(zip((key for key, _ in deep_records),
                          journal_snapshot_hashes([value for _, value in deep_records]) if deep_records else []))
    for capture in captures:
        records = capture['records']
        bodies = {r['eventId']: validate_record(r) for r in records}
        if len(bodies) != len(records):
            raise ValueError('duplicate_journal_event')
        if seen_events.intersection(bodies):
            raise ValueError('duplicate_capture_event')
        seen_events.update(bodies)
        review = capture.get('review', {})
        if review.get('status') != 'reconciled' or review.get('gaps') != []:
            # An empty read is unknown (wrong key, pruned or unreadable journal), never evidence of no Horse activity.
            omissions.append({'handKey': capture.get('key'),
                              'reason': 'original_reconciliation_incomplete' if records else 'no_journal_records_for_key'})
            continue
        # The owning reader checks action selection, normalization and permitted
        # acceptance-time authority withdrawals. Its verdict applies only to this
        # exact unordered record set, not a later edited or partial capture.
        pairs = sorted([r['eventId'], r['sha256']] for r in records)
        manifest = digest(json.dumps(pairs, separators=(',', ':')).encode())
        if (type(review.get('version')) is not int or review['version'] != 1 or review.get('scope') != 'single_retained_hand'
                or type(review.get('retainedRecords')) is not int
                or review['retainedRecords'] != len(records) or review.get('manifest') != manifest):
            raise ValueError('review_manifest_mismatch')
        hand_keys = {r['handKey'] for r in records}
        if len(hand_keys) != 1 or (capture.get('key') is not None and capture['key'] not in hand_keys):
            raise ValueError('review_hand_mismatch')
        terminals = [r for r in records if r['kind'] == 'accepted_hand']
        if len(terminals) != 1:
            raise ValueError('unique_accepted_hand_required')
        terminal_record = terminals[0]
        terminal = bodies[terminal_record['eventId']]
        actors, roster_source, roster_complete = accepted_roster(terminal, [bodies[r['eventId']] for r in records if r['kind'] == 'decision'])
        human_ids = [a['userId'] for a in actors if a['classification'] == 'human' and a['userId'] not in excluded_ids]
        # A positively identified eligible human is presence. Absence is only claimed from a complete roster.
        human_present = True if human_ids else (False if roster_complete else None)
        bound_actions = set()
        for record in records:
            if record['kind'] != 'decision':
                continue
            decision = bodies[record['eventId']]
            snapshot = decision['snapshot']
            at = snapshot['decisionTimeMs']
            if record['sourceRelease'] != serving or terminal_record['sourceRelease'] != serving or not in_window(at, windows):
                omissions.append({'eventId': record['eventId'], 'reason': 'outside_exact_source_or_window'})
                continue
            matches = [r for r in records if r['kind'] == 'execution' and r['turnKey'] == record['turnKey']]
            if len(matches) != 1:
                omissions.append({'eventId': record['eventId'], 'reason': 'execution_not_unique'})
                continue
            execution_record = matches[0]
            execution = bodies[execution_record['eventId']]
            if execution.get('executionStatus') != 'intended' or execution.get('policyFallback') is not None:
                omissions.append({'eventId': record['eventId'], 'reason': 'worker_not_executed_as_intended'})
                continue
            identity = execution['identity']
            if execution_record['sourceRelease'] != serving or any(identity[k] != snapshot[k] for k in ('decisionKey', 'decisionTimeMs', 'fence', 'generation', 'requestId')):
                raise ValueError('execution_snapshot_identity_mismatch')
            frame = decision['readFrame']
            if digest(frame['json'].encode()) != frame['sha256'] or len(frame['json'].encode()) != frame['bytes']:
                raise ValueError('read_frame_digest_mismatch')
            anchor = execution['handAnchor']
            hero = snapshot['player']['user_id']
            ordinal = anchor['actionOrdinal']
            if (record['handKey'] != terminal_record['handKey'] or execution_record['handKey'] != record['handKey']
                    or type(ordinal) is not int or ordinal < 0):
                raise ValueError('hand_or_action_ordinal_mismatch')
            if anchor['status'] != 'anchored' or anchor['actorId'] != hero or anchor['seat'] != snapshot['player']['seat']:
                raise ValueError('actor_anchor_mismatch')
            accepted = [a['record'] for a in execution['acceptedActions'] if a.get('intended') is True]
            same = lambda a: len(accepted) == 1 and all(a.get(k) == accepted[0].get(k) for k in ('userId', 'seat', 'stage', 'action', 'amount', 'timestamp'))
            if roster_source == 'lightning_decision_snapshots':
                # Lightning accepts simultaneous fast-fold decisions made on the same public state, so several
                # decisions share one prior-action count. Bind by the exact accepted action instead of its position.
                positions = [i for i, a in enumerate(terminal['actions']) if same(a)]
            else:
                if ordinal >= len(terminal['actions']):
                    raise ValueError('hand_or_action_ordinal_mismatch')
                positions = [ordinal] if same(terminal['actions'][ordinal]) else []
            if len(positions) != 1:
                raise ValueError('accepted_action_mismatch')
            if positions[0] in bound_actions:
                raise ValueError('accepted_action_bound_twice')
            bound_actions.add(positions[0])
            action = terminal['actions'][positions[0]]
            if action.get('origin') != 'horse_policy' or action.get('userId') != hero or not any(a['userId'] == hero and a['classification'] == 'horse' for a in actors):
                raise ValueError('accepted_actor_or_origin_mismatch')
            executed_amount = execution['executedAmount']
            if executed_amount is None and execution['executedAction'] in ('fold', 'check'):
                executed_amount = 0  # The owning witness represents no wager with null.
            if action['action'] != execution['executedAction'] or action['amount'] != executed_amount:
                raise ValueError('executed_action_mismatch')
            if action['timestamp'] < at:
                raise ValueError('accepted_before_decision')
            features = deep_dive_features(decision.get('deepDive'), deep_hashes.get(record['eventId']), decision['decision'], frame['sha256'])
            players = snapshot.get('gameState', {}).get('players')
            responding_humans = None
            if isinstance(players, list):
                responding_humans = [p['user_id'] for p in players
                                     if p.get('user_id') in human_ids and p.get('is_folded') is False
                                     and p.get('is_all_in') is False and type(p.get('stack')) in (int, float)
                                     and p['stack'] > 0]
            reads = decision.get('observerReads', {})
            pooled = reads.get('pooledPublicProfiles', {})
            if (review.get('publicReadProvenanceVerified') is True and pooled.get('version') == 2
                    and reads.get('cutoffMs') == at and pooled.get('profiles', 0) > 0):
                clocks = [reads.get('learnedThroughMs'), pooled.get('availableAtMs')]
                if any(type(v) not in (int, float) or not math.isfinite(v) or v > at for v in clocks):
                    raise ValueError('donor_available_after_decision')
                features['#10332_pooled_memory_cutoff'] = {'eligible': True, 'invoked': True, 'changed_action': None}
            authority = decision['decision'].get('preflopAuthority')
            if identity.get('variant') in ('plo4', 'plo5', 'plo6') and identity.get('stage') == 'preflop' and authority is not None:
                if authority != execution.get('preflopAuthority'):
                    raise ValueError('preflop_authority_mismatch')
                features['#10398_plo_preflop_provenance'] = {'eligible': True, 'invoked': True, 'changed_action': False}
            domain = snapshot.get('gameState', {}).get('publicMemoryDomain', {})
            speed = domain.get('speed') if isinstance(domain, dict) and domain.get('version') == 1 else None
            speed = speed if speed in ('table', 'lightning') else 'unknown'
            witnesses.append({'horse_id': hero, 'handKey': record['handKey'], 'decisionEventId': record['eventId'],
                              'executionEventId': execution_record['eventId'], 'acceptedEventId': terminal_record['eventId'],
                              'sourceRelease': serving, 'decisionTimeMs': at, 'features': features,
                              'eligibleHumanPresent': human_present, 'rosterSource': roster_source, 'mode': identity['gameMode'],
                              'eligibleHumanAbleToRespond': bool(responding_humans) if responding_humans is not None else None,
                              'variant': identity['variant'], 'street': identity['stage'], 'speed': speed,
                              'validated': True, 'committed': True})
    return witnesses, omissions


def accepted_roster(terminal, decisions):
    """Actor classifications for one hand: (actors, source, complete).

    Ordinary terminals carry the accepted actor roster. A Lightning terminal does not, so its
    roster comes from the original decision-time player lists of the same hand; it is complete
    only when every settled participant was classified. Any other terminal without a roster refuses.
    """
    block = terminal.get('acceptedActorRoster')
    if block is not None:
        return block['roster']['actors'], 'accepted_actor_roster', True
    domain = terminal.get('publicMemoryDomain')
    if not isinstance(domain, dict) or domain.get('version') != 1 or domain.get('speed') != 'lightning':
        raise ValueError('accepted_actor_roster_required')
    classes = {}
    for decision in decisions:
        players = decision['snapshot'].get('gameState', {}).get('players')
        for player in players if isinstance(players, list) else []:
            user, horse = player.get('user_id'), player.get('is_horse')
            if not isinstance(user, str) or type(horse) is not bool or classes.setdefault(user, horse) is not horse:
                raise ValueError('decision_roster_conflict')
    results = terminal.get('results')
    settled = {r.get('user_id') for r in results} if isinstance(results, list) and results else None
    actors = [{'userId': user, 'classification': 'horse' if horse else 'human'} for user, horse in sorted(classes.items())]
    return actors, 'lightning_decision_snapshots', settled is not None and settled <= set(classes)


def coverage_summary(witnesses, features):
    """Captured decision coverage, never a census of natural opportunities."""
    groups = {(mode, variant, speed): []
              for variant in ('nlh', 'plo4', 'plo5', 'plo6')
              for mode, speed in (('cash', 'table'), ('cash', 'lightning'), ('tournament', 'table'))}
    for witness in witnesses:
        groups.setdefault((witness['mode'], witness['variant'], witness.get('speed', 'unknown')), []).append(witness)
    out = []
    for (mode, variant, speed), rows in sorted(groups.items()):
        counts = {field: {label: sum(row.get(field) is value for row in rows)
                          for label, value in (('true', True), ('false', False), ('unknown', None))}
                  for field in ('eligibleHumanPresent', 'eligibleHumanAbleToRespond')}
        out.append({'mode': mode, 'variant': variant, 'speed': speed,
                    'status': 'captured_originals' if rows else 'not_observed_in_capture',
                    'uniqueHands': len({r['handKey'] for r in rows}),
                    'uniqueHorses': len({r['horse_id'] for r in rows}), 'decisions': len(rows),
                    **counts,
                    'features': {feature: {field: {label: sum(r['features'].get(feature, {}).get(field) is value for r in rows)
                                                   for label, value in (('true', True), ('false', False), ('unknown', None))}
                                          for field in ('evaluated', 'eligible', 'invoked', 'locally_applied')}
                                 for feature in sorted(features)}})
    return {'scope': 'exact_source_window_bound_captured_decisions', 'cells': out,
            'limitation': 'Zero captured decisions is not zero natural opportunities. Missing original speed stays unknown. Feature counts are observed evidence, not full eligibility denominators.'}


def reconcile_matrix(legacy, inclusions, witnesses=()):
    rows = legacy['rows']
    keys = {(r['horse_id'], r['feature_id']) for r in rows}
    horses = {h for h, _ in keys}
    features = set(legacy['featureList'])
    if len(keys) != len(rows) or keys != {(h, f) for h in horses for f in features}:
        raise ValueError('matrix_is_not_unique_cartesian_product')
    if len(horses) != legacy['uniqueHorseCount'] or len(features) != legacy['featureCount']:
        raise ValueError('matrix_declared_dimensions_mismatch')
    epoch = legacy['observationEpoch']
    by_key = {}
    for witness in witnesses:
        if witness['sourceRelease'] != epoch['servingReleaseSha'] or not in_window(witness['decisionTimeMs'], epoch['windows']):
            raise ValueError('witness_outside_epoch')
        for feature, proof in witness['features'].items():
            if feature not in features or witness['horse_id'] not in horses:
                raise ValueError('witness_not_in_fleet_contract')
            if inclusions.get(feature) is not True:
                raise ValueError('witness_feature_not_in_serving_source')
            by_key.setdefault((witness['horse_id'], feature), []).append((witness, proof))
    out = []
    for original in rows:
        feature = original['feature_id']
        excluded = feature in (P2, R78)
        row = {k: original[k] for k in ('horse_id', 'feature_id', 'username', 'configured_style') if k in original}
        row.update({k: None for k in COUNTERS})
        row.update(source_included=inclusions.get(feature), excluded_by_contract=excluded,
                   domain_policy_turns_observed=original.get('domain_policy_turns_observed'),
                   domain_fallback_turns_observed=original.get('domain_fallback_turns_observed'),
                   activity_basis='retained_domain_counts_not_feature_opportunities', evidence=[])
        if inclusions.get(feature) is False:
            row['available_on_serving_workers'] = False
        row['disposition'] = ('excluded_by_contract_runtime_evidence_separate' if excluded else
                              'not_in_serving_source' if inclusions.get(feature) is False else
                              'feature_attribution_unknown')
        proofs = by_key.get((original['horse_id'], feature), [])
        if proofs:
            row['disposition'] = 'bound_feature_configuration_or_evaluation'
            for witness, proof in proofs:
                for field in ('eligible', 'evaluated', 'invoked', 'locally_applied', 'changed_action'):
                    if proof.get(field) is True:
                        row[field] = True
                if type(proof.get('effectively_configured')) is bool:
                    row.setdefault('observed_configuration_values', [])
                    if proof['effectively_configured'] not in row['observed_configuration_values']:
                        row['observed_configuration_values'].append(proof['effectively_configured'])
                    row['effectively_configured'] = (row['observed_configuration_values'][0]
                        if len(row['observed_configuration_values']) == 1 else None)
                if proof.get('invoked') is True:
                    row['disposition'] = 'at_least_one_bound_feature_execution'
                    row['naturally_observed'] = True
                    row['validated'] = witness['validated']
                    row['committed'] = witness['committed']
                row['evidence'].append(witness['decisionEventId'])
            if feature == '#10398_plo_preflop_provenance':
                row['changed_action'] = False  # A reference provenance receipt does not change strategy.
        row['unknown'] = any(row[k] is None for k in COUNTERS)
        out.append(row)
    summaries = {}
    for feature in sorted(features):
        selected = [r for r in out if r['feature_id'] == feature]
        summaries[feature] = {field: {label: sum(r[field] is value for r in selected)
                                      for label, value in (('true', True), ('false', False), ('unknown', None))}
                              for field in COUNTERS}
    return {'schemaVersion': '3.0.0', 'status': 'partial_feature_evidence',
            'completeFleetActivation': False, 'activationAllowed': False,
            'observationEpoch': epoch, 'uniqueHorseCount': len(horses), 'featureCount': len(features),
            'rowCount': len(out), 'featureList': sorted(features), 'featureSummaries': summaries, 'rows': out,
            'boundDecisionWitnesses': list(witnesses),
            'capturedCoverage': coverage_summary(witnesses, features),
            'limitations': ['True means at least one bound witness, not universal coverage.',
                            'Health/schema readiness does not prove effective per-Horse feature configuration.',
                            'Ordinary atomic/history parity does not prove whether crash recovery executed.',
                            'No witness is unknown, including Horses with no domain actions.',
                            'Validated means the retained original/execution/action binding checks passed, not qualified strategy or profitable play.',
                            'Local rule applications do not establish that the final accepted action changed because of that rule.',
                            'Eligible human participation in a hand is separate from an eligible human able to respond at the decision.',
                            'Legacy P1b/P4 broad domain counters are not exact eligibility denominators.']}


def read_journal_captures(journal_paths, sources):
    """Every named capture file must contribute at least one capture: an empty file is a failed capture, not an empty window."""
    captures = []
    for path in journal_paths:
        path = Path(path)
        data = path.read_bytes()
        sources[str(path)] = digest(data)
        try:
            item = json.loads(data)
            found = item if isinstance(item, list) else [item]
        except json.JSONDecodeError:
            found = [json.loads(line) for line in data.splitlines() if line.strip()]
        if not found:
            raise ValueError('journal_capture_empty')
        captures.extend(found)
    return captures


def write_fleet_report(source, output, repo, journal_paths=(), health_path=None, *, subject_config=None, epoch_path=None):
    source, output = Path(source), Path(output)
    raw = source.read_bytes()
    legacy = json.loads(raw)
    subjects = read_subjects(subject_config)
    sources = {str(source): digest(raw), str(subject_config): digest(Path(subject_config).read_bytes())}
    retained_epoch = legacy['observationEpoch']
    if epoch_path is not None:
        epoch_bytes = Path(epoch_path).read_bytes()
        sources[str(epoch_path)] = digest(epoch_bytes)
        epoch = json.loads(epoch_bytes)
        if (not re.fullmatch('[a-f0-9]{40}', epoch.get('servingReleaseSha', ''))
                or not isinstance(epoch.get('windows'), list) or not epoch['windows']
                or epoch.get('design') not in ('prospective_declared', 'retrospective')):
            raise ValueError('explicit_epoch_source_windows_design_required')
        for window in epoch['windows']:
            if timestamp(window['startUtc']) >= timestamp(window['endUtc']):
                raise ValueError('epoch_window_invalid')
            if epoch['design'] == 'prospective_declared' and timestamp(epoch['selectedAtUtc']) > timestamp(window['startUtc']):
                raise ValueError('prospective_epoch_selected_after_start')
        legacy['observationEpoch'] = epoch
    inclusions = {fid: ancestor(repo, value.get('required_commit_sha'), legacy['observationEpoch']['servingReleaseSha'])
                  for fid, value in legacy['featureSummaries'].items()}
    captures = read_journal_captures(journal_paths, sources)
    witnesses, omissions = journal_witnesses(captures, legacy['observationEpoch']['servingReleaseSha'], legacy['observationEpoch']['windows'], subjects['excludedSubjectIds'])
    report = reconcile_matrix(legacy, inclusions, witnesses)
    if health_path is not None:
        data = Path(health_path).read_bytes()
        sources[str(health_path)] = digest(data)
        health = json.loads(data)
        report['separateWorkerHealthObservation'] = {
            **worker_health(health), 'releaseSha': health.get('releaseSha'),
            'instanceId': health.get('instanceId'),
            'sampledAtMs': health.get('liveHorseDecision', {}).get('statusSampledAt'),
            'sameSourceAsEpoch': health.get('releaseSha') == legacy['observationEpoch']['servingReleaseSha'],
        }
    report.update(sourceFileHashes=sources, journalOmissions=omissions,
                  subjectSelection=subjects, retainedActivityEpoch=retained_epoch,
                  observationDesign=legacy['observationEpoch'].get('design', 'historical_window_c_retrospective'),
                  sourceCodeSha256=digest(Path(__file__).read_bytes()),
                  generatedAtUtc=dt.datetime.now(dt.timezone.utc).isoformat())
    if any((output / name).exists() for name in ('fleet-acceptance.json', 'fleet-acceptance.tsv')):
        raise ValueError('new_output_required')
    with (output / 'fleet-acceptance.json').open('x') as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
    columns = ('horse_id', 'feature_id', 'source_included', *COUNTERS, 'unknown', 'disposition')
    with (output / 'fleet-acceptance.tsv').open('x') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, delimiter='\t', extrasaction='ignore')
        writer.writeheader()
        for row in report['rows']:
            writer.writerow({k: 'unknown' if v is None else v for k, v in row.items()})
    return report
