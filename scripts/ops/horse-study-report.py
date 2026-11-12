#!/usr/bin/env python3
"""Build a private, reproducible hand/decision inventory from receipted sources."""
import argparse
from collections import Counter
import gzip
import hashlib
import importlib.util
import json
import os
import sqlite3
import uuid
from pathlib import Path
from horse_hand_analysis import analyze_hand
from horse_strategy_review import review_decision
from horse_study_store import initialize,put_hand,put_decision
from horse_playbook import build_playbook
from horse_hand_narrative import render_hand


def read_rows(path):
    receipt_path=path.with_name(path.name.removesuffix('.jsonl.gz')+'.receipt.json')
    receipt=json.loads(receipt_path.read_text())
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if digest!=receipt['sha256']:raise ValueError('source_digest_mismatch:'+path.name)
    count=0
    with gzip.open(path,'rt') as f:
        for line in f:
            count+=1;yield json.loads(line)
    if count!=receipt['rows']:raise ValueError('source_count_mismatch:'+path.name)


def run(source,output,river_opportunities=False):
    exclusion_bytes=(source/'exclusions.json').read_bytes()
    exclusion_config=json.loads(exclusion_bytes)
    if not isinstance(exclusion_config,list) or any(not isinstance(x,str) for x in exclusion_config):
        raise ValueError('explicit_exclusion_ids_required')
    excluded_ids={str(uuid.UUID(x)) for x in exclusion_config}
    if len(excluded_ids)!=len(exclusion_config):raise ValueError('duplicate_exclusion_id')
    profiles={r['id']:r for r in read_rows(source/'profiles.jsonl.gz')}
    snapshots={};snapshot_sources=[]
    for path in sorted(source.glob('snapshot-own-originals-*.jsonl.gz')):
        receipt_path=path.with_name(path.name.removesuffix('.jsonl.gz')+'.receipt.json')
        receipt=json.loads(receipt_path.read_text())
        if receipt.get('readOnly') is not True or not isinstance(receipt.get('querySha256'),str) or len(receipt['querySha256'])!=64:
            raise ValueError('snapshot_query_receipt_required')
        proof={'file':path.name,'sha256':receipt['sha256'],'querySha256':receipt['querySha256'],
               'receiptSha256':hashlib.sha256(receipt_path.read_bytes()).hexdigest()}
        snapshot_sources.append(proof)
        for ordinal,row in enumerate(read_rows(path)):
            snapshots.setdefault(row.get('hand_id'),{}).setdefault(row.get('hero_id'),[]).append((row,{**proof,'row':ordinal}))
    discards={};discard_sources=[]
    for path in sorted(source.glob('remaining-own-delivery-*.jsonl.gz')):
        receipt_path=path.with_name(path.name.removesuffix('.jsonl.gz')+'.receipt.json')
        receipt=json.loads(receipt_path.read_text())
        if receipt.get('readOnly') is not True or not isinstance(receipt.get('querySha256'),str) or len(receipt['querySha256'])!=64:
            raise ValueError('own_discard_query_receipt_required')
        proof={'file':path.name,'sha256':receipt['sha256'],'querySha256':receipt['querySha256'],
               'receiptSha256':hashlib.sha256(receipt_path.read_bytes()).hexdigest()}
        discard_sources.append(proof)
        for ordinal,row in enumerate(read_rows(path)):
            discards.setdefault(row.get('hand_id'),{}).setdefault(row.get('hero_id'),[]).append((row,{**proof,'row':ordinal}))
    enriched={}
    for path in sorted(source.glob('enrichment-*.jsonl.gz')):
        for r in read_rows(path):
            if r['hand_id'] in enriched:raise ValueError('duplicate_enrichment')
            enriched[r['hand_id']]=r
    lightning={}
    for path in sorted(source.glob('lightning-[0-9]*.jsonl.gz')):
        for r in read_rows(path):
            lightning.setdefault(r.get('hand_history_id') or r['hand_id'],set()).add(r['hand_id'])
    indices={}
    for path in sorted(source.glob('participants-*.jsonl.gz')):
        for r in read_rows(path):indices.setdefault(r['hand_id'],set()).add(r['user_id'])
    counts=Counter(included=0, decisions=0);domains=Counter();stages=Counter();gaps=Counter();findings=Counter();seen=set();strategic_candidates=Counter();rules=Counter();river_counts=Counter()
    recovered=[]
    for path in sorted(source.glob('missing-recovery-*.jsonl.gz')):
        for r in read_rows(path):
            hand=r.get('original_history')
            if isinstance(hand,dict) and hand.get('id')==r['id']:
                recovered.append(hand)
                enriched[r['id']]={'accepted_facts':r.get('accepted_facts'),'roster':r.get('roster'),
                    'fact_cards':{f['user_id']:f.get('hole_cards') for f in (r.get('player_facts') or [])}}
    hand_path=output/'hands.jsonl.gz';decision_path=output/'decisions.jsonl.gz'
    narrative_path=output/'individual-hand-reviews.md.gz'
    database=output/'study.sqlite'
    with database.open('xb'):pass
    connection=sqlite3.connect(database)
    try:
        connection.execute('PRAGMA foreign_keys=ON')
        initialize(connection)
        def all_hands():
            for path in sorted(source.glob('flagged-2*.jsonl.gz')):
                yield from read_rows(path)
            yield from recovered
            for path in sorted(source.glob('today-flagged-*.jsonl.gz')):
                yield from read_rows(path)
        with gzip.open(hand_path,'xt') as hf,gzip.open(decision_path,'xt') as df,gzip.open(narrative_path,'xt') as nf:
            for hand in all_hands():
                if hand['id'] in seen:raise ValueError('duplicate_history')
                seen.add(hand['id'])
                extra=enriched.get(hand['id'],{})
                facts=extra.get('fact_cards') or {}
                accepted=extra.get('accepted_facts') or {}
                for f in (accepted.get('stats_facts') or {}).get('facts',[]):
                    if f.get('hole_cards'):facts[f['user_id']]=f['hole_cards']
                roster=(extra.get('roster') or {}).get('actors')
                report=analyze_hand(hand,profiles,facts,roster,excluded_ids,snapshots.get(hand['id']),discards.get(hand['id']))
                report['acquisition']={'acceptedSourcePresent':bool(extra.get('accepted_facts')),
                    'historicalRosterPresent':bool(roster),'participantIndexPresent':hand['id'] in indices,
                    'lightningHandIds':sorted(lightning.get(hand['id'],[]))}
                if not extra:report['gaps'].append('enrichment_not_acquired')
                counts[report['status']]+=1
                counts['horseAppearances']+=len(report['horses'])
                domain=report['format']+'/'+str(report['variant'])+'/'+('lightning' if hand['id'] in lightning else 'table')
                if report['status']=='included':domains[domain]+=1
                decisions=report.pop('decisions')
                put_hand(connection,report,domain)
                for d in decisions:
                    counts['decisions']+=1
                    recovery=d.get('snapshotOwnCardRecovery')
                    if recovery:counts['snapshotOwnCardsAccepted' if recovery['accepted'] else 'snapshotOwnCardsWithheld']+=1
                    stage=d['informationSet']['tournamentStage']['phase']
                    stages[domain+'/'+stage]+=1
                    for g in d['gaps']:gaps[g]+=1
                    for f in d['findings']:findings[f['kind']]+=1
                    d['handId']=hand['id'];d['domain']=domain
                    info=d['informationSet'];state=info['publicState']
                    d['ruleContext']={'format':report['format'],'variant':info['variant'],
                        'bettingStructure':info['structure'],'speedFormat':'lightning' if hand['id'] in lightning else 'table',
                        'anteType':state.get('anteType'),'ante':state.get('ante'),
                        'asset':state.get('asset'),'fixedBetSize':state.get('fixedBetSize'),
                        'bigBlind':state.get('bigBlind'),'boardCount':state.get('boardCount'),
                        'bombPot':state.get('bombPot'),'allInOrFold':state.get('allInOrFold'),
                        'tournamentStage':info['tournamentStage']['phase'],
                        'paidPlaceGeometry':info['tournamentStage'].get('paidPlaceGeometry')}
                    rules[json.dumps(d['ruleContext'],sort_keys=True,separators=(',',':'))]+=1
                    d['review']=review_decision(d,exact_river_ceiling=True)
                    opportunity=d['review']['facts'].get('riverOpportunity')
                    if opportunity is not None:
                        river_counts[domain+'/river_decisions']+=1
                        if opportunity['openBetAvailable']:
                            river_counts[domain+'/open_bet_opportunities']+=1
                            river_counts[domain+'/open_bet_actual_'+str(d['action'])]+=1
                            if opportunity['opponentsAbleToRespond']==0:river_counts[domain+'/open_bet_no_responder']+=1
                    for candidate in d['review']['candidates']:strategic_candidates[domain+'/'+candidate]+=1
                    put_decision(connection,d)
                    df.write(json.dumps(d,separators=(',',':'))+'\n')
                hf.write(json.dumps(report,separators=(',',':'))+'\n')
                if report['status']=='included':nf.write(render_hand(report,decisions))
        connection.commit()
        integrity=connection.execute('PRAGMA integrity_check').fetchall()
        foreign=connection.execute('PRAGMA foreign_key_check').fetchall()
    finally:
        connection.close()
    if integrity!=[('ok',)] or foreign:raise ValueError('study_database_integrity_failed')
    summary={'schemaVersion':1,'status':'preliminary_decision_inventory',
        'excludedSubjectIds':sorted(excluded_ids),'exclusionsSha256':hashlib.sha256(exclusion_bytes).hexdigest(),
        'snapshotOwnCardSources':snapshot_sources,'originalOwnDiscardSources':discard_sources,
        'uniqueHistoryRows':len(seen),'indexedUniqueHands':len(indices),
        'indexedWithoutHistory':len(set(indices)-seen),'historyWithoutIndex':len(seen-set(indices)),
        'lightningSourceUniqueHands':len({h for group in lightning.values() for h in group}),
        'lightningWithoutLoadedHistory':len(set(lightning)-seen),
        'recoveredOriginalHistories':len(recovered),'counts':dict(counts),
        'includedHandsByDomain':dict(sorted(domains.items())),
        'decisionsByDomainAndStage':dict(sorted(stages.items())),
        'decisionGaps':dict(gaps),'executionCandidates':dict(findings),
        'strategicReviewCandidates':dict(strategic_candidates),
        'riverOpportunityCounts':dict(sorted(river_counts.items())),
        'decisionsByExactRuleContext':[{'context':json.loads(key),'decisions':value} for key,value in sorted(rules.items())],
        'completeHistory':False,'strategicAnalysisComplete':False,'gtoVerified':False,'activationAllowed':False,
        'limitations':['Current-profile index acquisition must be reconciled with historical classifications and archives.',
            'No qualified strategy reference has yet been bound to these historical decisions.',
            'Public tournament stage alone cannot supply payout utility or whole-field historical stacks.']}
    playbook_path=output/'implementation-playbook.json'
    playbook_path.write_text(json.dumps(build_playbook(summary),indent=2)+'\n')
    for path in (hand_path,decision_path,database,playbook_path,narrative_path):
        with path.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
        summary[path.name]={'sha256':digest,'bytes':path.stat().st_size}
    (output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    if river_opportunities:
        from horse_river_appendix import build_appendix
        build_appendix(output,output/'river-opportunities')
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--river-opportunities',action='store_true',
                        help='Generate the private conditional PLO river appendix after this study batch')
    parser.add_argument('--exact-variant-report',action='store_true',
                        help='Read a frozen four-domain evidence directory and write per-horse.json')
    parser.add_argument('--census-audit',action='store_true',
                        help='Reproduce the frozen November 10 census with explicit missing-return evidence')
    parser.add_argument('--subject-config', help='Private explicit excludedSubjectIds and comparisonSubjectId JSON')
    parser.add_argument('--observation-epoch', help='Explicit private source/window JSON for a new fleet observation')
    parser.add_argument('--predecessor', help='Original study directory required by --census-audit')
    parser.add_argument('--refund-evidence', help='Private pre-cutoff unregistration refund acquisition JSON for --census-audit')
    parser.add_argument('--fleet-acceptance', action='store_true',
                        help='Reconcile the retained 1,000-by-13 fleet matrix with original journal witnesses')
    parser.add_argument('--journal', action='append', default=[], help='Original private journal capture JSON/JSONL')
    parser.add_argument('--health-evidence', help='Separate private health JSON; never per-Horse execution evidence')
    args=parser.parse_args();os.umask(0o077)
    if sum((args.river_opportunities, args.exact_variant_report, args.census_audit, args.fleet_acceptance)) > 1:
        parser.error('select one report mode')
    if (args.census_audit or args.fleet_acceptance) and not args.subject_config:
        parser.error('census and fleet reports require --subject-config')
    if args.census_audit and not args.predecessor:
        parser.error('--census-audit requires --predecessor')
    spec=importlib.util.spec_from_file_location('acquisition',Path(__file__).with_name('horse-human-study.py'))
    acquisition=importlib.util.module_from_spec(spec);spec.loader.exec_module(acquisition)
    source=acquisition.private_directory(args.source);destination=Path(args.output)
    if destination.exists():raise ValueError('new_output_directory_required')
    output=acquisition.private_directory(destination)
    if args.fleet_acceptance:
        from horse_fleet_acceptance import write_fleet_report
        write_fleet_report(source/'audit/inherited_and_fleet/fleet_1000_x_13_features_authoritative.json',
                           output, Path(__file__).resolve().parents[2], args.journal, args.health_evidence,
                           subject_config=args.subject_config, epoch_path=args.observation_epoch)
        print(output/'fleet-acceptance.json')
        raise SystemExit(0)
    if args.census_audit:
        from horse_census_audit import run_audit
        run_audit(source, Path(args.predecessor), output, args.subject_config,
                  refund_evidence=args.refund_evidence)
        raise SystemExit(0)
    if args.exact_variant_report:
        if args.river_opportunities:
            parser.error('select one report mode')
        from horse_variant_report import write_variant_report
        write_variant_report(source, output/'per-horse.json')
        print(output/'per-horse.json')
        raise SystemExit(0)
    result=run(source,output,river_opportunities=args.river_opportunities)
    print(json.dumps({k:result[k] for k in ('status','uniqueHistoryRows','counts','completeHistory','strategicAnalysisComplete','activationAllowed')}))
