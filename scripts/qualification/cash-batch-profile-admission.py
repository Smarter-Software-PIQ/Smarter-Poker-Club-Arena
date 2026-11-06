#!/usr/bin/env python3
"""Isolated current cash batch versus actual wallet writer; never production.

Uses the maintained replay fixture's real batch/process/apply/profile functions.
Accrual and launch readers remain controlled as in that fixture. Diamond wallet
storage is typed, with no production ledger triggers: this proves profile lock
admission and exact local credits, not the complete tournament payout ledger.
"""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import shutil
import uuid

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('replay_keys', HERE / 'replay-locks-and-player-stats-keys.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
CAPTURE = HERE / 'cash-batch-profile-admission-capture.json'


def setup_wallet(cl):
    cl.q("""
      ALTER TABLE profiles ADD COLUMN diamonds bigint DEFAULT 100,
        ADD COLUMN diamond_balance bigint DEFAULT 100,
        ADD COLUMN diamond_multiplier numeric DEFAULT 1,
        ADD COLUMN updated_at timestamptz DEFAULT now();
      CREATE TABLE diamond_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid, amount bigint, transaction_type text, type text, description text,
        balance_after bigint, reference_id text, metadata jsonb, counterparty text,
        issuance_class text, UNIQUE(user_id,reference_id));
      CREATE TABLE diamond_debts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,
        amount bigint,purchase_id uuid,reason text,created_at timestamptz,settled_at timestamptz,settled_by text);
      CREATE TABLE ca_payout_freeze(scope text,cleared_at timestamptz);
      -- Exact tournament credits always supply a reference. Refuse if this
      -- unrelated rule reader is actually called rather than merely planned.
      CREATE FUNCTION fn_ca_diamond_rule_mode(text) RETURNS text LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'unexpected unreferenced-credit rule lookup'; END $$;
    """)
    for f in json.loads(CAPTURE.read_text())['functions']:
        assert hashlib.md5(f['definition'].encode()).hexdigest() == f['definition_md5']
        assert f['owner'] == 'postgres' and f['security_definer'] is True
        assert f['acl'] == '{postgres=X/postgres,service_role=X/postgres}'
        sig = 'public.' + f['signature']
        cl.q(f['definition'] + '; REVOKE ALL ON FUNCTION ' + sig + ' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ' + sig + ' TO service_role;')
        assert cl.q("SELECT md5(pg_get_functiondef('%s'::regprocedure))" % sig) == f['definition_md5']
    cl.q("""
      CREATE TRIGGER accounting_cash_source_immutable BEFORE INSERT OR DELETE OR UPDATE
      ON rake_attributions FOR EACH ROW EXECUTE FUNCTION fn_accounting_cash_source_immutable();
      CREATE TRIGGER accounting_cash_source_immutable BEFORE DELETE OR UPDATE
      ON rake_records FOR EACH ROW EXECUTE FUNCTION fn_accounting_cash_source_immutable();
    """)


def seed(cl, label, users=('b', 'a'), retry=False):
    cl.q('TRUNCATE diamond_transactions,diamond_debts,ca_payout_freeze;')
    h.reset_b(cl)
    club = str(uuid.uuid5(uuid.NAMESPACE_URL, label + '/club'))
    a, b = h.ordered(label, 'users')
    c = str(uuid.uuid5(uuid.NAMESPACE_URL, label + '/third'))
    cl.q("INSERT INTO clubs(id) VALUES ('%s') ON CONFLICT DO NOTHING; INSERT INTO profiles(id) VALUES ('%s'),('%s'),('%s');" % (club,a,b,c))
    ids = {'a':a,'b':b,'c':c}
    rr = h.seed_hands(cl,label,club,[ids[u] for u in users],[(a,club),(b,club),(c,club)])
    if retry:
        for i,(rec,_) in enumerate(rr):
            cl.q("INSERT INTO accounting_cash_source_work(rake_record_id,status,attempts,next_attempt_at) VALUES('%s','blocked',%d,now()-interval '1 hour')" % (rec,i+1))
        return ids,rr,'SELECT public.fn_retry_cash_accounting_sources(50);'
    items = json.dumps([{'source_type':'cash_rake_record','source_id':r} for r,_ in rr])
    return ids, rr, "SELECT public.fn_credit_agent_commissions_batch('%s'::jsonb);" % items


def credit(user, ref):
    return "SELECT public.add_diamonds_to_balance('%s',17,'tournament_prize','isolated original payout','%s',NULL);" % (user,ref)


def objects(output):
    return [json.loads(line) for line in output.splitlines() if line.startswith('{')]


def profile_cycle(cl, state, retry=False):
    ids, rr, batch = seed(cl,'cycle/'+state,retry=retry)
    cl.q("INSERT INTO harness_pause(id) VALUES ('%s');" % rr[1][1])
    ctl,B,P = h.Session(cl,'control'),h.Session(cl,'batch'),h.Session(cl,'payout')
    offset = cl.log_size()
    try:
        ctl.run('SELECT pg_advisory_lock(%d);' % h.GATE)
        bs = B.send(batch)
        assert h.waiting_for(cl,B.pid) == [ctl.pid], 'batch did not reach original second item'
        ps = P.send('BEGIN; '+credit(ids['a'],'first')+credit(ids['b'],'second')+' COMMIT;')
        assert h.waiting_for(cl,P.pid) == [B.pid], 'wallet writer did not wait on batch'
        ctl.run('SELECT pg_advisory_unlock(%d);' % h.GATE)
        bout,_ = B.wait(bs)
        pout,_ = P.wait(ps)
        result = {'case':'opposite-payout-profile-order','state':state,
                  'deadlocks':cl.deadlocks_since(offset),'batch':objects(bout)[-1],
                  'credits':objects(pout),
                  'wallets':json.loads(cl.q("SELECT json_agg(diamonds ORDER BY id) FROM profiles WHERE id IN('%s','%s')" % (ids['a'],ids['b']))),
                  'stats':json.loads(cl.q("SELECT json_agg(hands_played ORDER BY user_id) FROM player_stats WHERE user_id IN('%s','%s')" % (ids['a'],ids['b']))),
                  'wallet_receipts':int(cl.q('SELECT count(*) FROM diamond_transactions'))}
        return result
    finally:
        for session in (ctl,B,P): session.close()


def held_profile(cl, label, shared_item=False, retry=False):
    ids,rr,batch = seed(cl,'held/'+label,('b','a','c'),retry=retry)
    if shared_item:
        cl.q("INSERT INTO rake_attributions(hand_id,player_id,rake_amount,rake_record_id,club_id,weighted_rake_credit) SELECT hand_id,'%s',1,id,club_id,1 FROM rake_records WHERE id='%s';" % (ids['a'],rr[0][0]))
    P,B = h.Session(cl,'payout'),h.Session(cl,'batch')
    offset = cl.log_size()
    try:
        P.run('BEGIN; '+credit(ids['a'],'held'))
        first,_ = B.wait(B.send(batch))
        first = objects(first)[-1]
        written = json.loads(cl.q('SELECT coalesce(json_agg(rake_record_id ORDER BY rake_record_id),\'[]\') FROM rakeback_stats_applied'))
        P.run(credit(ids['b'],'after-batch')+' COMMIT;')
        second,_ = B.wait(B.send(batch))
        replay,_ = B.wait(B.send(batch))
        expected_deferred = [rr[0][0],rr[1][0]] if shared_item else [rr[1][0]]
        return {'case':label,'deadlocks':cl.deadlocks_since(offset),'first':first,
                'expected_deferred':expected_deferred,'written_before_release':written,
                'second':objects(second)[-1],'replay':objects(replay)[-1],
                'applied':int(cl.q('SELECT count(*) FROM rakeback_stats_applied')),
                'expected_applied':4 if shared_item else 3,
                'stats':json.loads(cl.q('SELECT json_object_agg(user_id,hands_played) FROM player_stats')),
                'expected_stats':{ids['a']:7 if shared_item else 6,ids['b']:6,ids['c']:6}}
    finally:
        P.close(); B.close()


def expanded_source(cl,retry=False):
    ids,rr,batch=seed(cl,'expanded-source',retry=retry)
    extra=str(uuid.uuid5(uuid.NAMESPACE_URL,'expanded-source/new-player'))
    cl.q("INSERT INTO profiles(id) VALUES ('%s');" % extra)
    E,P,B=h.Session(cl,'source'),h.Session(cl,'payout'),h.Session(cl,'batch')
    try:
        E.run("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('accounting_cash_hand:%s',0));" % rr[0][1])
        P.run('BEGIN; '+credit(extra,'held-new-player'))
        original_work=cl.q("SELECT row_to_json(w) FROM accounting_cash_source_work w WHERE rake_record_id='%s'" % rr[0][0])
        pending=B.send(batch)
        assert h.waiting_for(cl,B.pid)==[E.pid], 'batch did not reach original source key'
        E.run("INSERT INTO rake_attributions(hand_id,player_id,rake_amount,rake_record_id,club_id,weighted_rake_credit) SELECT hand_id,'%s',1,id,club_id,1 FROM rake_records WHERE id='%s'; COMMIT;" % (extra,rr[0][0]))
        first=objects(B.wait(pending)[0])[-1]
        written=int(cl.q("SELECT row_to_json(w) FROM accounting_cash_source_work w WHERE rake_record_id='%s'" % rr[0][0]) != original_work)
        P.run('COMMIT;')
        second=objects(B.wait(B.send(batch))[0])[-1]
        counts=json.loads(cl.q("SELECT json_agg(hands_played ORDER BY user_id) FROM player_stats WHERE user_id IN('%s','%s')" % (ids['a'],ids['b'])))
        new_count=int(cl.q("SELECT hands_played FROM player_stats WHERE user_id='%s'" % extra))
        return {'first':first,'new_source_writes_while_unowned':written,'expected_deferred':[rr[0][0]],'second':second,'original_counts':counts,'new_count':new_count}
    finally:
        for session in (E,P,B): session.close()


def retry_window(cl):
    ids,rr,_=seed(cl,'retry-window',('a','b','c'),retry=True)
    P=h.Session(cl,'payout')
    try:
        P.run('BEGIN; '+credit(ids['a'],'held-head'))
        result=objects(cl.q('SELECT public.fn_retry_cash_accounting_sources(1);'))[-1]
        untouched=json.loads(cl.q("SELECT json_object_agg(rake_record_id,attempts) FROM accounting_cash_source_work WHERE status='blocked'"))
        assert result['ok']==1 and result['failed']==0 and result['deferred']==[],result
        assert untouched=={rr[0][0]:1,rr[2][0]:3},untouched
        assert result['receipts'][0]['rake_record_id']==rr[1][0],result
        P.run('COMMIT;')
        return {'passed':True,'limit':1,'untouched_work':untouched}
    finally:P.close()


def missing_profile(cl):
    ids,rr,batch=seed(cl,'missing-profile')
    cl.q("DELETE FROM profiles WHERE id='%s';" % ids['b'])
    result=objects(cl.q(batch))[-1]
    return {'result':result,'wallet_created':int(cl.q("SELECT count(*) FROM profiles WHERE id='%s'" % ids['b'])),
            'hands':int(cl.q("SELECT hands_played FROM player_stats WHERE user_id='%s'" % ids['b']))}


def installer_refusals(cl,migration):
    import re
    source=pathlib.Path(migration).read_text()
    body=re.sub(r'^BEGIN;\n','',source,count=1,flags=re.M)
    body=re.sub(r'COMMIT;\s*$','',body)
    sig='public.fn_credit_agent_commissions_batch(jsonb)'
    original=cl.q("SELECT md5(pg_get_functiondef('%s'::regprocedure))||proacl::text FROM pg_proc WHERE oid='%s'::regprocedure" % (sig,sig))
    outcomes={}
    cases=[('preimage',"CREATE OR REPLACE FUNCTION public.fn_credit_agent_commissions_batch(p_items jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;",'preimage changed'),
           ('retry_preimage',"CREATE OR REPLACE FUNCTION public.fn_retry_cash_accounting_sources(p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;",'retry profile admission preimage changed'),
           ('immutability','ALTER TABLE rake_attributions DISABLE TRIGGER accounting_cash_source_immutable;','source mutation authority changed'),
           ('permissions','REVOKE EXECUTE ON FUNCTION '+sig+' FROM service_role;','metadata changed'),
           ('dependency',"CREATE OR REPLACE FUNCTION public.fn_process_cash_accounting_source(p_rake_record_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;",'source owner changed')]
    for name,change,expected in cases:
        try: cl.q('BEGIN;'+change+body+'ROLLBACK;')
        except RuntimeError as error:
            assert expected in str(error),(name,str(error))
        else: raise AssertionError('installer accepted '+name)
        outcomes[name]=cl.q("SELECT md5(pg_get_functiondef('%s'::regprocedure))||proacl::text FROM pg_proc WHERE oid='%s'::regprocedure" % (sig,sig))==original
    return outcomes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--migration')
    a = ap.parse_args()
    work = pathlib.Path(a.work).resolve()
    if work.exists() and any(work.iterdir()): raise SystemExit('work must be empty')
    work.mkdir(parents=True,exist_ok=True)
    cl = h.Cluster(work)
    report = {'scope':__doc__,'checks':{},'sources':{}}
    try:
        cl.start()
        cl.psql('postgres','-c','CREATE DATABASE '+h.DB)
        for suffix in ('-schema.sql','-live.sql'):
            cl.psql(h.DB,'-f',str(HERE/('replay-locks-and-player-stats-keys'+suffix)))
        pins = json.loads((HERE/'replay-locks-and-player-stats-keys.manifest.json').read_text())['functions']
        for sig in ('fn_process_cash_accounting_source(uuid)','apply_rakeback_player_stats(uuid,uuid,uuid,integer,numeric)','fn_sync_profile_total_hands()'):
            assert cl.q("SELECT md5(pg_get_functiondef('public.%s'::regprocedure))" % sig) == pins[sig]
        setup_wallet(cl)
        report['before'] = profile_cycle(cl,'before')
        report['retry_before'] = profile_cycle(cl,'retry-before',True)
        if a.migration:
            report['installer_refusals'] = installer_refusals(cl,a.migration)
            report['migration'] = cl.psql(h.DB,'-f',str(pathlib.Path(a.migration).resolve()))
            report['after'] = profile_cycle(cl,'after')
            report['retry_after'] = profile_cycle(cl,'retry-after',True)
            report['held'] = [held_profile(cl,'busy-player-keeps-unrelated-hands'),held_profile(cl,'one-busy-player-defers-whole-hand',True),held_profile(cl,'retry-busy-player',retry=True),held_profile(cl,'retry-shared-hand',True,True)]
            report['expanded_source'] = expanded_source(cl)
            report['retry_expanded_source'] = expanded_source(cl,True)
            report['retry_window'] = retry_window(cl)
            report['missing_profile'] = missing_profile(cl)
        else:
            report['after'] = report['before']
        before,after = report['before'],report['after']
        checks = report['checks']
        checks['counterfactual reproduces current profile cycle'] = before['deadlocks'] > 0
        checks['candidate avoids cycle and completes both hands'] = after['deadlocks']==0 and after['batch']['ok']==2 and after['batch']['failed']==0 and after['batch']['deferred']==[]
        checks['both original wallet credits commit once'] = after['wallets']==[117,117] and after['wallet_receipts']==2 and len(after['credits'])==2 and all(r.get('success') for r in after['credits'])
        checks['both original hand counters commit once'] = after['stats']==[6,6]
        for row in report.get('held',[]):
            checks[row['case']] = row['deadlocks']==0 and row['first']['deferred']==row['expected_deferred'] and row['first']['failed']==0 and not(set(row['written_before_release']) & set(row['expected_deferred'])) and row['second']['failed']==0 and row['second']['deferred']==[] and row['replay']['failed']==0 and row['applied']==row['expected_applied'] and row['stats']==row['expected_stats']
        if a.migration:
            rb,ra=report['retry_before'],report['retry_after']
            checks['retry counterfactual and corrected payout complete'] = rb['deadlocks']>0 and ra['deadlocks']==0 and ra['batch']['ok']==2 and ra['batch']['failed']==0 and ra['batch']['deferred']==[] and ra['wallets']==[117,117] and ra['wallet_receipts']==2 and ra['stats']==[6,6]
            checks['installer refuses changed authority and rolls back'] = all(report['installer_refusals'].values())
            e=report['expanded_source']
            checks['expanded source defers before writes and original resubmission completes'] = e['first']['deferred']==e['expected_deferred'] and e['first']['failed']==0 and e['new_source_writes_while_unowned']==0 and e['second']['failed']==0 and e['second']['deferred']==[] and e['original_counts']==[6,6] and e['new_count']==1
            e=report['retry_expanded_source']
            checks['retry expanded source stays original and untouched'] = e['first']['deferred']==e['expected_deferred'] and e['first']['failed']==0 and e['new_source_writes_while_unowned']==0 and e['second']['failed']==0 and e['second']['deferred']==[] and e['original_counts']==[6,6] and e['new_count']==1
            checks['retry bounded window skips busy head without changing pending work'] = report['retry_window']['passed']
            m=report['missing_profile']
            checks['missing profile keeps existing stats-only behavior'] = m['result']['ok']==2 and m['result']['failed']==0 and m['wallet_created']==0 and m['hands']==6
        report['installed'] = cl.q("SELECT md5(pg_get_functiondef('public.fn_credit_agent_commissions_batch(jsonb)'::regprocedure))")
        for p in (pathlib.Path(__file__),CAPTURE,HERE/'replay-locks-and-player-stats-keys.py',HERE/'replay-locks-and-player-stats-keys-schema.sql',HERE/'replay-locks-and-player-stats-keys-live.sql',HERE/'replay-locks-and-player-stats-keys.manifest.json',*([pathlib.Path(a.migration)] if a.migration else [])):
            report['sources'][str(p.resolve().relative_to(h.ROOT))] = hashlib.sha256(p.read_bytes()).hexdigest()
        report['passed'] = all(checks.values())
    finally:
        cl.stop()
        report['postgres_log'] = str(cl.log)
        pathlib.Path(a.out).write_text(json.dumps(report,indent=2)+'\n')
    for label,passed in report['checks'].items(): print(('PASS ' if passed else 'FAIL ')+label)
    if report.get('passed'): shutil.rmtree(work/'pg')
    raise SystemExit(0 if report.get('passed') else 1)

if __name__=='__main__': main()
