#!/usr/bin/env python3
"""Final reconciliation table.
usage: fleet_reconciliation.py REPO FLEET_JSON FEATURE_MAP APPLICABILITY SERVING_SHA HEALTH_JSON [--manifests J] [--config J]
Separate observations, never merged: source in serving release (delivery), #10376 per-worker health (its own contract),
activation manifest (newer contract, only where its producer is in the release), stored configuration (aggregate readback),
eligibility rule (hand-level), naturally observed Horses (bound witnesses only). Absent evidence is UNKNOWN or UNVERIFIED.
Source absent from the serving release is PENDING_DELIVERY, not a qualification failure."""
import argparse, json, subprocess
MANIFEST_PRODUCER = '1094cd8ca7a6'  # PR #10454 introduces horseUpgradeManifest

def in_release(repo, sha, serving):
    if sha is None: return None
    r = subprocess.run(['git', '-C', repo, 'merge-base', '--is-ancestor', sha, serving], capture_output=True)
    return True if r.returncode == 0 else False if r.returncode == 1 else None

def worker_health_contract(health, serving):
    """#10376 contract: liveHorseDecision.workers[] each with index, phase, solverStores."""
    if health.get('releaseSha') != serving: raise ValueError('health_not_for_serving_release')
    live = health.get('liveHorseDecision') or {}; ws = live.get('workers')
    if not isinstance(ws, list) or not ws: return {'status': 'UNVERIFIED_no_per_worker_rows', 'workers': []}
    rows = [{'index': w.get('index'), 'phase': w.get('phase'), 'postflopV31': (w.get('solverStores') or {}).get('postflopV31')} for w in ws]
    ok = len(rows) == live.get('workerCount') and len({r['index'] for r in rows}) == len(rows) and all(r['phase'] == 'ready' for r in rows)
    return {'status': 'PASS' if ok else 'NOT_PASS', 'workers': rows,
            'r7r8StoresZeroOnEveryWorker': all(r['postflopV31'] == 0 for r in rows) if all(r['postflopV31'] is not None for r in rows) else None}

def activation_manifest(producer_in_release, manifests, serving):
    if producer_in_release is False: return 'N/A_producer_not_in_serving_release'
    if producer_in_release is None or manifests is None: return 'UNVERIFIED_no_manifest_evidence'
    if manifests.get('servingSha') != serving: raise ValueError('manifest_evidence_not_for_serving_release')
    return manifests['verdict'] + f" ({len(manifests['workers'])} workers read individually)"

def lane_eligible(formats, config):
    if formats is None: return None
    lanes = (config or {}).get('laneUnretired')
    if not lanes: return 'UNKNOWN_no_configuration_readback'
    n = lanes.get('both', 0) + sum(lanes.get(k, 0) for k, f in (('cash', 'cash'), ('events', 'tournament')) if f in formats)
    return f'{n} by stored lane'

def rows(repo, fleet, fmap, appl, serving, health, manifests=None, config=None):
    if fleet['observationEpoch']['servingReleaseSha'] != serving: raise ValueError('fleet_report_not_for_serving_release')
    features = fleet['featureList']
    if set(fmap) != set(features) or not set(features) <= set(appl): raise ValueError('feature_map_mismatch')
    wh = worker_health_contract(health, serving)
    man = activation_manifest(in_release(repo, MANIFEST_PRODUCER, serving), manifests, serving)
    out = []
    for f in features:
        s = fleet['featureSummaries'][f]; a = appl[f]; src = in_release(repo, fmap[f], serving)
        seen = s['naturally_observed']['true']; excluded = a['unit'] == 'excluded'
        if excluded:
            off = seen == 0 and s['invoked']['true'] == 0
            if not off: result = 'FAIL_excluded_feature_observed'
            elif f.startswith('excluded_r7_r8'): result = 'PASS_stores_zero_on_every_worker' if wh['status'] == 'PASS' and wh.get('r7r8StoresZeroOnEveryWorker') else 'UNVERIFIED_disabled_state'
            elif src is False: result = 'N/A_source_not_in_serving_release'
            else: result = 'PASS_kept_off' if man.startswith('PASS') else 'UNVERIFIED_disabled_state'
        elif src is False: result = 'PENDING_DELIVERY_not_in_serving_release'
        elif src is None: result = 'UNKNOWN'
        elif a['unit'] == 'worker': result = wh['status'] + '_per_worker_health_contract'
        elif seen == 0: result = 'UNOBSERVED_live_exercise'
        else: result = 'OBSERVED_PARTIAL'
        out.append({'feature': f, 'sourceCommit': fmap[f], 'servingRelease': serving, 'sourceInServingRelease': src,
                    'availability': None if excluded else ('fleet-wide on serving release' if src else 'not serving'),
                    'unit': a['unit'], 'eligibilityFormats': a['formats'], 'eligibilityVariants': a['variants'], 'eligibilitySituation': a['situation'],
                    'laneEligibleHorses': lane_eligible(a['formats'], config) if a['unit'] in ('horse_decision', 'hand') else None,
                    'storedConfigurationAvailable': (config or {}).get('byRetiredStatus', {}).get('unretired/available', 'UNKNOWN_no_configuration_readback'),
                    'effectiveRuntimeConfiguration': 'UNVERIFIED',
                    'workerHealthContract10376': wh['status'], 'activationManifestContract': man,
                    'naturallyObservedHorses': seen, 'boundCommittedHorses': s['committed']['true'], 'result': result})
    return out

if __name__ == '__main__':
    p = argparse.ArgumentParser(); [p.add_argument(a) for a in ('repo', 'fleet', 'map', 'applicability', 'serving', 'health')]
    p.add_argument('--manifests'); p.add_argument('--config'); a = p.parse_args()
    L = lambda f: json.load(open(f)) if f else None
    print(json.dumps(rows(a.repo, L(a.fleet), L(a.map), L(a.applicability), a.serving, L(a.health), L(a.manifests), L(a.config)), indent=1))
