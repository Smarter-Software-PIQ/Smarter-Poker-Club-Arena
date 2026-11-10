"""Rebuild the variant supplement from the frozen Horse Hands receipts."""
import collections, gzip, hashlib, json, pathlib

def write_variant_report(source, destination):
    originals = source.parents[1] / 'forced-fold-memory'
    def records(name):
        path = originals / ('final-activation-3217-' + name + '.jsonl.gz')
        digest = json.loads(path.with_suffix('').with_suffix('.receipt.json').read_text())['sha256']
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('receipt_digest_mismatch')
        with gzip.open(path, 'rt') as stream:
            yield from map(json.loads, stream)

    variants = {'nlh':'no-limit','flh':'fixed-limit','plo4':'pot-limit','plo5':'pot-limit','plo6':'pot-limit'}
    baseline = json.loads((source / 'four-domain-by-horse.json').read_text())
    roster = {r['horse_id']:hashlib.sha256(r['horse_id'].encode()).hexdigest() for r in records('roster') if r['registered_nonretired'] and r['profile_status']=='active' and r['horse_status']=='available'}
    if set(roster.values()) != set(baseline) or len(roster) != 1000:
        raise ValueError('roster_mismatch')
    counts = collections.Counter()
    for r in records('opportunities'):
        v = r['game_variant']
        if v not in variants or not r['started_at'] or r['started_at'] < '2026-11-10T01:09:29.201945' or r['committed_at'] >= '2026-11-10T01:10:45': continue
        lease = r['submission_lease']
        if not (lease or r['accepted_lease']): continue
        if lease and (not r['exact_submission'] or r['instance_id'] != '1-cc09e13a' or r['accepted_lease'] not in (None,'',lease)): continue
        mode = 'tournament' if r['tournament'] else 'cash'
        for a in r['actions']:
            if a['origin']=='horse_policy' and a['node']=='captured' and a['actor'] in roster and a['action'] in (a['legal'] or []) and a['seat']==a['nodeSeat']:
                counts[roster[a['actor']],mode,v] += 1

    rows=[]
    for horse, domains in baseline.items():
        for mode in ('cash','tournament'):
            for family, group in [('holdem',('nlh','flh')),('plo',('plo4','plo5','plo6'))]:
                if sum(counts[horse,mode,v] for v in group)!=domains[family+'/'+mode]['originalPublicOpportunities']:
                    raise ValueError('domain_count_mismatch')
                for v in group:
                    n=counts[horse,mode,v]
                    rows.append(dict(horse=horse,mode=mode,variant=v,structureFromVariant=variants[v],recordedBettingStructure=None,publicOpportunities=n,featureEligibility=None,featureApplied=None,featureChangedAction=None,featureCommittedReceipt=None,disposition='missing_feature_telemetry' if n else 'no_observed_public_opportunity'))
    destination.write_text(json.dumps(rows,separators=(',',':'))+'\n')
