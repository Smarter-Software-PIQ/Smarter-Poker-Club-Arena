#!/usr/bin/env python3
"""Exact migration, v3 workers and retained-capsule kernel in private PostgreSQL.
The private fixture shifts PostgreSQL's clock, never the candidate policy or SQL.
No production connection, runtime patch or synthetic production financial input.
"""
import importlib.util
import json
import re
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('promise', ROOT/'scripts/ci/test-maintenance-promise-floor.py')
pm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pm)
ot = pm.ot
MIG = ROOT/'supabase/migrations/20261104232431_certify_scoped_eed_recovery_before_the_original_thaw.sql'
EED = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
POLICY = '2026-11-04-tournament-fourfold-certified-recovery'
KERNEL = ROOT/'supabase/migrations/20261029093051_attest_frozen_original_hand_continuation_custody.sql'
PRIVATE = r"""
CREATE SCHEMA smarter_private;
CREATE SCHEMA extensions;
CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT public.digest($1,$2)$$;
CREATE TABLE public.engine_leader(id boolean PRIMARY KEY,engine_version text,instance_id text,heartbeat_at timestamptz);
ALTER TABLE public.engine_maintenance_break ADD COLUMN declared_by text;
ALTER TABLE public.tables ADD COLUMN f06_lifecycle bigint;
CREATE TABLE public.hand_history(table_id uuid,hand_number bigint);
CREATE TABLE smarter_private.hand_continuations(tournament_id uuid,table_id uuid,hand_number bigint,
 writer_generation uuid,sequence bigint,payload_sha256 text,payload text,permit_id uuid,
 original_generation uuid,created_at timestamptz);
CREATE TABLE smarter_private.f06_hand_permits(permit_id uuid,state text,evidence_id uuid,table_id uuid,
 tournament_id uuid,hand_number bigint,generation uuid,lifecycle bigint,custody_id uuid);
CREATE TABLE smarter_private.hand_continuation_dispositions(table_id uuid,hand_number bigint,disposition text);
CREATE TABLE smarter_private.hand_submissions(table_id uuid,hand_number bigint);
CREATE TABLE smarter_private.hand_submission_dispositions(table_id uuid,hand_number bigint);
"""
# Offset clock stays real-time within an operation, so native worker budgets and
# statement cancellation retain actual elapsed time. Only the fixture can move it.
CLOCK = r"""
CREATE TABLE public.test_clock(delta interval NOT NULL);
INSERT INTO public.test_clock VALUES('2026-11-04T23:30:00Z'::timestamptz-clock_timestamp());
ALTER FUNCTION pg_catalog.clock_timestamp() RENAME TO fixture_real_clock;
CREATE FUNCTION pg_catalog.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS
 $$SELECT pg_catalog.fixture_real_clock()+delta FROM public.test_clock$$;
ALTER FUNCTION pg_catalog.statement_timestamp() RENAME TO fixture_real_statement_clock;
CREATE FUNCTION pg_catalog.statement_timestamp() RETURNS timestamptz LANGUAGE sql STABLE AS
 $$SELECT pg_catalog.fixture_real_statement_clock()+delta FROM public.test_clock$$;
"""

def sqljson(value):
    return "'"+json.dumps(value).replace("'", "''")+"'::jsonb"

def setclock(c, moment):
    c.psql("UPDATE test_clock SET delta='%s'::timestamptz-pg_catalog.fixture_real_clock()"%moment)

def request(c, run='12345-1'):
    return {'runKey':run, 'targetSha':'a'*40, 'controlSha':'b'*40,
      'predecessorSha':EED,'instanceId':'1-eed-test','announcedAt':c.val("SELECT to_char(announced_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM engine_maintenance_break"),
      'ownershipToken':ot.TOKEN,'policyId':POLICY}

def register(c, req):
    return c.rpc('public.fn_register_engine_certified_recovery(%s)'%sqljson(req))

def proof(c, req):
    return c.rpc("public.fn_engine_certified_recovery_proof('%s','%s','%s','%s')"%(req['runKey'],req['targetSha'],req['controlSha'],req['announcedAt']))

def announce(c, at='2026-11-04T23:30:00Z'):
    c.psql('TRUNCATE engine_maintenance_break,engine_maintenance_thaws,engine_maintenance_thaw_targets,smarter_private.engine_certified_recoveries,engine_leader,test_parameters;')
    setclock(c, at)
    c.psql("INSERT INTO engine_leader VALUES(true,'%s','1-eed-test',clock_timestamp()); INSERT INTO engine_maintenance_break(id,phase,announced_at,enforce_freeze,ownership_token,reason,declared_by) VALUES(true,'last_hand','%s',true,'%s','Deployment Recovery','old EED');"%(EED[:8],at,ot.TOKEN))

def countdown(c, req, elapsed=220, early=True):
    delta='119.999' if early else '120'
    c.psql("UPDATE engine_maintenance_break SET phase='counting_down',break_started_at=announced_at+interval '%s seconds',break_ends_at=announced_at+interval '%s seconds'; INSERT INTO test_parameters SELECT break_started_at,break_ends_at FROM engine_maintenance_break; UPDATE test_clock SET delta=(SELECT break_started_at+interval '%s seconds' FROM engine_maintenance_break)-pg_catalog.fixture_real_clock();"%(delta,str(float(delta)+300),elapsed))

def call(c, req, token=ot.TOKEN):
    return c.rpc("public.fn_thaw_platform('%s',(SELECT freeze_start FROM test_parameters),300,'%s','qualification EED')"%(req['announcedAt'],token))

def finish(c, req, token=ot.TOKEN):
    answers=[]
    for _ in range(40):
        r=call(c,req,token); answers.append(r)
        if r.get('complete'): return answers
        ot.require(r.get('ok') and r.get('retryable'),'bounded installment retains exact owner')
    raise AssertionError('bounded registered thaw did not complete')

def expect_register_error(c, req, error):
    c.psql('SET ROLE service_role; SELECT public.fn_register_engine_certified_recovery(%s);'%sqljson(req),error=error)

def qualify_host_registration(c):
    # Execute the maintained host caller, including its durable request and
    # single-POST/readback path. Only transport, clock and the root-only file
    # ownership boundary are adapted to this unprivileged private PG fixture.
    spec=importlib.util.spec_from_file_location('host_proof',ROOT/'server/scripts/engine-release-database-proof.py')
    host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
    base_ms=1793835000000
    for fraction in (76,1,999,0):
        stamp='2026-11-04T23:30:00.%03dZ'%fraction
        announce(c,stamp)
        calls=[]
        def rpc(_url,_key,name,parameters=None,write=False):
            calls.append((name,parameters,write))
            if name=='fn_register_engine_certified_recovery':
                ot.require(write is True,'host registration is the sole write RPC')
                return register(c,parameters['p_request'])
            ot.require(write is False,'host proof remains read only')
            if name=='fn_engine_certified_recovery_contract':
                return c.rpc('public.fn_engine_certified_recovery_contract()')
            ot.require(name=='fn_engine_certified_recovery_proof','host uses existing proof RPC')
            return proof(c,dict(runKey=parameters['p_run_key'],targetSha=parameters['p_target_sha'],
                controlSha=parameters['p_control_sha'],announcedAt=parameters['p_announced_at']))
        def local_request(path):
            ot.require(path.stat().st_mode&0o777==0o600,'host request retains private file mode')
            return json.loads(path.read_text())
        with tempfile.TemporaryDirectory(prefix='host-register-') as directory:
            args=SimpleNamespace(sha=EED,certified_mode='register',target_sha='a'*40,control_sha='b'*40,
                window_announced_ms=base_ms+fraction,certified_request_root=directory,
                run_id='12345-1',instance_id='1-eed-test',certified_health_stdin=False,minimum_ms=0)
            with patch.object(host,'certified_rpc',side_effect=rpc),\
                 patch.object(host,'read_maintenance_promise',side_effect=lambda *_:c.rpc('public.fn_engine_maintenance_promise_proof()')),\
                 patch.object(host,'read_certified_request',side_effect=local_request),\
                 patch.object(host,'time',SimpleNamespace(time=lambda:float(c.val('SELECT extract(epoch FROM clock_timestamp())')))):
                first=host.operate_certified(args,'https://private-pg.invalid','fixture')
                ot.require(first['request']['announcedAt']==stamp,'actual host emits canonical milliseconds '+stamp)
                ot.require(c.val('SELECT (extract(epoch FROM announced_at)*1000)::bigint FROM smarter_private.engine_certified_recoveries')==str(base_ms+fraction),'registration preserves exact millisecond instant')
                path=host.certified_request_file(directory,args.run_id);saved=path.read_bytes()
                replay=host.operate_certified(args,'https://private-pg.invalid','fixture')
                ot.require(replay['request']==first['request'] and path.read_bytes()==saved,'host replay retains original durable request')
                ot.require(sum(write for _,_,write in calls)==1,'host replay never repeats registration POST')
                ot.require(c.val('SELECT count(*) FROM smarter_private.engine_certified_recoveries')=='1','host replay retains one immutable registration')
                malformed={**first['request'],'announcedAt':stamp[:-1]+'000Z'}
                expect_register_error(c,malformed,'CERTIFIED_RECOVERY_REQUEST_INVALID')
                ot.require(c.val('SELECT count(*) FROM smarter_private.engine_certified_recoveries')=='1','strict SQL still refuses six fractional digits')
    c.psql('TRUNCATE smarter_private.engine_certified_recoveries;')

def frozen_kernel(c, error=None):
    expr="smarter_private.attest_frozen_hand_continuation('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',123,0,(SELECT payload_sha256 FROM smarter_private.hand_continuations))"
    result=c.psql('BEGIN READ ONLY; SELECT '+expr+'; COMMIT;',error=error)
    if error is None:return json.loads(result.splitlines()[-1])

def seed_capsule(c):
    c.psql(r"""
INSERT INTO tournaments(id,status) VALUES('11111111-1111-4111-8111-111111111111','RUNNING');
INSERT INTO engine_tournament_leases(tournament_id,protocol_version,lease_generation,heartbeat_at,instance_id) VALUES('11111111-1111-4111-8111-111111111111',2,'22222222-2222-4222-8222-222222222222',clock_timestamp(),'1-eed-test');
INSERT INTO tables(id,tournament_id,f06_lifecycle,status) VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',7,'playing');
INSERT INTO smarter_private.f06_hand_permits VALUES('44444444-4444-4444-8444-444444444444','reserved',NULL,'33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',123,'22222222-2222-4222-8222-222222222222',7,'55555555-5555-4555-8555-555555555555');
INSERT INTO smarter_private.hand_continuation_dispositions VALUES('33333333-3333-4333-8333-333333333333',123,'retained');
INSERT INTO smarter_private.hand_continuations
 SELECT h.tournament_id,h.table_id,h.hand_number,h.generation,0,encode(public.digest(convert_to(p.doc,'UTF8'),'sha256'),'hex'),p.doc,h.permit_id,h.generation,clock_timestamp()
 FROM smarter_private.f06_hand_permits h CROSS JOIN LATERAL(SELECT jsonb_build_object('version',1,
 'batch',jsonb_build_object('version',1,'sequence',0,'controller','private retained state'),
 'original',jsonb_build_object('tournament_id',h.tournament_id,'table_id',h.table_id,
 'hand_number',h.hand_number,'permit_id',h.permit_id,'lifecycle',h.lifecycle,
 'custody_id',h.custody_id,'lease_generation',h.generation))::text doc) p;
""")

def main():
    with tempfile.TemporaryDirectory(prefix='certified-') as directory:
        c=ot.base.Cluster(directory)
        try:
            c.start(); c.psql(CLOCK); c.psql(ot.base.FIXTURE+ot.EXTRA)
            c.psql((ot.FIX/'bypass.sql').read_text()+(ot.FIX/'authority.sql').read_text())
            for name in ('20261018172103_prepare_the_certified_thaw_before_the_advertised_hour.sql','20261020011548_a_heavy_thaw_releases_on_the_hour_when_nothing_is_left_to_cr.sql'):
                c.psql((ROOT/'supabase/migrations'/name).read_text())
            c.psql(PRIVATE)
            old=KERNEL.read_text(); old=old[old.index('CREATE FUNCTION smarter_private.attest_frozen_hand_continuation'):old.index('CREATE FUNCTION public.fn_f06_attest_frozen_hand_continuation')]
            c.psql(old)
            c.psql(pm.MIG.read_text())
            pm.reset(c,270)
            c.psql(MIG.read_text(),error='CERTIFIED_RECOVERY_REQUIRES_QUIESCENT_INSTALL')
            c.psql('TRUNCATE engine_maintenance_break;')
            c.psql(MIG.read_text())
            print(c.val("SELECT jsonb_object_agg(n.nspname||'.'||p.proname,md5(pg_get_functiondef(p.oid)))::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN ('fn_thaw_platform','fn_register_engine_certified_recovery','fn_engine_certified_recovery_proof','engine_certified_recovery_targets','engine_certified_recovery_frozen_original','attest_frozen_hand_continuation') AND (p.proname<>'fn_thaw_platform' OR p.pronargs=5)"),flush=True)
            c.psql(MIG.read_text(),error='CERTIFIED_RECOVERY_PREIMAGE_DRIFT')
            ot.require(c.val("SELECT md5(pg_get_functiondef('%s'::regprocedure))"%ot.SIG)!='cb733d7201725719813ffd1b1e099b1b','exact new thaw installed')
            for sig in ['public.fn_register_engine_certified_recovery(jsonb)','public.fn_engine_certified_recovery_proof(text,text,text,timestamptz)','public.fn_engine_certified_recovery_contract()']:
                for role in ('anon','authenticated'):
                    ot.require(c.val("SELECT has_function_privilege('%s','%s','execute')::text"%(role,sig))=='false',role+' denied '+sig)
                ot.require(c.val("SELECT has_function_privilege('service_role','%s','execute')::text"%sig)=='true','service door '+sig)
            for role in ('anon','authenticated','service_role'):
                ot.require(c.val("SELECT has_table_privilege('%s','smarter_private.engine_certified_recoveries','select,insert,update,delete')::text"%role)=='false','private policy rows denied '+role)
            contract=c.rpc('public.fn_engine_certified_recovery_contract()')
            ot.require(contract['schema']=='engine-certified-recovery-contract/v1' and contract['policyId']==POLICY and contract['profile']['freezeMs']==780000 and contract['thawDefinitionMd5']=='e2530d18c33dd11f10d5e40bed4bd2e1','preannouncement contract derives qualified installed definitions')
            c.psql("BEGIN; ALTER FUNCTION public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text) SET statement_timeout='34s'; SELECT public.fn_engine_certified_recovery_contract(); ROLLBACK;", error='CERTIFIED_RECOVERY_INSTALLED_CONTRACT_UNPROVEN')
            qualify_host_registration(c)
            # No policy preserves the deployed original promise and every existing replay.
            pm.reset(c,270)
            normal=pm.finish(c)[-1]
            ot.require(float(normal['effective_frozen_seconds'])==300.001,'ordinary promise remains 300.001 seconds')
            announce(c); req=request(c)
            for field,value in [('policyId','other'),('predecessorSha','c'*40),('targetSha',EED),('nativeQueryMs','240000')]:
                bad=dict(req);bad[field]=value;expect_register_error(c,bad,'CERTIFIED_RECOVERY_REQUEST_INVALID')
            c.psql("UPDATE engine_leader SET heartbeat_at=clock_timestamp()-interval '31 seconds'")
            expect_register_error(c,req,'CERTIFIED_RECOVERY_ORIGINAL_OWNER_UNPROVEN')
            c.psql('UPDATE engine_leader SET heartbeat_at=clock_timestamp()')
            absent=proof(c,req)
            ot.require(set(absent)=={'schema','policyId','runKey','targetSha','controlSha','announcedAt','observedAt','platformFrozen','entryPurchasesFrozen'}
              and absent['schema']=='engine-certified-recovery-absent/v1' and absent['runKey']==req['runKey']
              and absent['targetSha']==req['targetSha'] and absent['controlSha']==req['controlSha'],
              'missing registration has explicit closed absence, not ambiguous identity refusal')
            first=register(c,req)
            ot.require(first['request']==req and first['thaw'] is None and first['targets']=={'familyCount':0,'allCredited':False,'complete':False},'registration reports real pre-thaw state')
            for bad in [{**req,'targetSha':'c'*40},{**req,'controlSha':'c'*40},{**req,'runKey':'99999-1'}]:
                c.psql("SELECT public.fn_engine_certified_recovery_proof('%s','%s','%s','%s')"%(bad['runKey'],bad['targetSha'],bad['controlSha'],bad['announcedAt']),error='CERTIFIED_RECOVERY_IDENTITY_UNPROVEN')
            original=c.val('SELECT to_jsonb(r)::text FROM smarter_private.engine_certified_recoveries r')
            register(c,req)
            ot.require(c.val('SELECT to_jsonb(r)::text FROM smarter_private.engine_certified_recoveries r')==original,'identical registration is immutable')
            bad=dict(req);bad['controlSha']='c'*40;expect_register_error(c,bad,'CERTIFIED_RECOVERY_REQUEST_CHANGED')
            other=dict(req);other['runKey']='99999-1';expect_register_error(c,other,'CERTIFIED_RECOVERY_ORIGINAL_OWNER_UNPROVEN')
            countdown(c,req,100)
            ot.require(call(c,req)['reason']=='maintenance_break_not_due','new profile still refuses early preparation')
            ot.require(c.val('SELECT count(*) FROM engine_maintenance_thaws')=='0','early call creates no checkpoint')
            # Countdown retains the original timestamps; registration cannot be added now.
            c.psql('TRUNCATE smarter_private.engine_certified_recoveries')
            expect_register_error(c,req,'CERTIFIED_RECOVERY_NEW_WINDOW_REQUIRED')
            announce(c);req=request(c);register(c,req);countdown(c,req,220)
            source=(ROOT/'scripts/ci/test-on-time-maintenance-thaw.py').read_text()
            seed=re.search(r'c.psql\(r"""\n(INSERT INTO public.tournaments.*?)"""\)',source,re.S).group(1)
            # The native fixture's default now() is wall time; reconnect records
            # explicitly belong to this virtual cycle before snapshot selection.
            c.psql(seed)
            c.psql('UPDATE hand_state_snapshots SET updated_at=(SELECT freeze_start FROM test_parameters)')
            deadlines=re.search(r'CREATE TABLE public.test_deadlines_before AS\n(.*?);\nCREATE TRIGGER',source,re.S).group(1)
            c.psql('CREATE VIEW public.test_deadlines_after AS '+deadlines+';')
            seed_capsule(c)
            before=ot.fingerprint(c)
            oldproof=frozen_kernel(c)
            ot.require(oldproof['frozen'] is True,'ordinary raw F06 branch proves actual retained capsule')
            ot.require(call(c,req,ot.NEXT)['reason']=='maintenance_ownership_changed','foreign thaw token refused')
            partial=call(c,req)
            ot.require(not partial['complete'],'registered thaw commits real partial installment')
            ot.require(c.val('SELECT (frozen_seconds=780.001)::text FROM engine_maintenance_thaws')=='true','initial credit uses 780.001 at original preparation time')
            # The established raw-row claim remains authoritative after interruption.
            c.psql("UPDATE engine_maintenance_break SET ownership_token='%s'"%ot.NEXT)
            ot.require(call(c,req)['reason']=='maintenance_ownership_changed','old token fenced after legal row claim')
            answers=finish(c,req,ot.NEXT);final=answers[-1]
            got=proof(c,req)
            c.psql("BEGIN READ ONLY; SET LOCAL ROLE service_role; SELECT public.fn_engine_certified_recovery_proof('%s','%s','%s','%s'); COMMIT;"%(req['runKey'],req['targetSha'],req['controlSha'],req['announcedAt']))
            ot.require(got['targets']=={'familyCount':15,'allCredited':True,'complete':True},'all fifteen count keys and target credits prove completion')
            ot.require(float(final['effective_frozen_seconds'])==780.001,'old caller receives full certified duration')
            ot.require(c.val("SELECT (release_target_at=announced_at+interval '900 seconds')::text FROM engine_maintenance_thaws")=='true','release exactly announcement plus 900 seconds')
            ot.require(c.val("SELECT bool_and(credited_seconds=780.001)::text FROM engine_maintenance_thaw_targets")=='true','all fifteen target families credit once')
            ot.require(c.val("SELECT bool_and(a.at=b.at+interval '780.001 seconds')::text FROM test_deadlines_after a JOIN test_deadlines_before b USING(kind,id)")=='true','every deadline gets actual full pause')
            ot.require(c.val("SELECT bool_and(t.level_started_at IS NOT DISTINCT FROM (CASE WHEN t.on_break OR b.level_started_at IS NULL THEN b.level_started_at ELSE b.level_started_at+interval '780.001 seconds' END))::text FROM tournaments t JOIN test_level_before b USING(id)")=='true','level clocks retain independent pause and null semantics')
            ot.require(c.val("SELECT bool_and((disconnect_states->'player'->>'reconnectDeadlineMs')::numeric=extract(epoch FROM freeze_start+interval '840.001 seconds')*1000)::text FROM (SELECT disconnect_states FROM engine_presence_parked UNION ALL SELECT disconnect_states FROM hand_state_snapshots) r CROSS JOIN test_parameters")=='true','both reconnect families receive complete actual duration')
            ot.require(ot.fingerprint(c)==before,'wallets stacks roster and table identities preserved')
            ot.require(got['platformFrozen'] and got['entryPurchasesFrozen'] and got['rawMaintenance']['ownership_token']==ot.TOKEN,'future certificate freezes both doors and retains original raw owner')
            ot.require(got['thaw']['ownership_token']==ot.NEXT,'receipt proves legal adopted token separately')
            frozen=frozen_kernel(c)
            ot.require(frozen==oldproof,'F06 certificate returns exact original custody and raw tuple after row clear')
            clocks=c.val('SELECT jsonb_agg(to_jsonb(d) ORDER BY kind,id)::text FROM test_deadlines_after d')
            ot.require(call(c,req,ot.NEXT)['reason']=='release_receipt_recovered','lost response reads original completed receipt')
            register(c,req)
            ot.require(c.val('SELECT jsonb_agg(to_jsonb(d) ORDER BY kind,id)::text FROM test_deadlines_after d')==clocks,'both duplicate doors preserve every credited clock')
            # Real private read-only F06 call refuses incomplete / changed evidence.
            for mutation in ["UPDATE engine_maintenance_thaws SET shifted=shifted-'complete'", "UPDATE engine_maintenance_thaws SET release_target_at=release_target_at+interval '1 second'", "UPDATE engine_maintenance_thaws SET ownership_token=gen_random_uuid()", "UPDATE engine_maintenance_thaw_targets SET credited_seconds=0", "UPDATE engine_maintenance_thaws SET shifted=jsonb_set(shifted,'{_target_counts,sit_out_at}','999')"]:
                count=c.val('BEGIN;'+mutation+'; SELECT count(*) FROM smarter_private.engine_certified_recovery_frozen_original(); ROLLBACK;')
                ot.require(count=='0','changed certificate refuses original custody')
            # Expiry releases both established readers; no old cycle is extended.
            setclock(c,'2026-11-04T23:45:01Z')
            c.psql('UPDATE engine_tournament_leases SET heartbeat_at=clock_timestamp()')
            ot.require(c.val('SELECT (NOT fn_platform_frozen() AND NOT fn_entry_purchases_frozen())::text')=='true','both readers release only after certified boundary')
            frozen_kernel(c,error='HAND_CONTINUATION_ATTESTATION_REQUIRES_FREEZE')
            before=c.val('SELECT to_jsonb(t)::text FROM engine_maintenance_thaws t')
            register(c,req)
            ot.require(c.val('SELECT to_jsonb(t)::text FROM engine_maintenance_thaws t')==before,'expired duplicate cannot extend previous cycle')
            announce(c,'2026-11-05T04:45:00.001Z');req=request(c)
            expect_register_error(c,req,'CERTIFIED_RECOVERY_NEW_WINDOW_REQUIRED')
            # Empty families still produce all fifteen zero counts, not a false failure.
            c.psql('DROP TRIGGER zz_freeze_entry_guard ON tournament_players; DROP TRIGGER zz_freeze_entry_guard ON table_seats; TRUNCATE tournaments,tables,table_seats,tournament_players,table_waitlist,chip_transactions,tournament_bounty_awards,cash_player_session,cash_rejoin_constraints,cash_seat_moves,engine_presence_parked,hand_state_snapshots,lightning_cluster_drain CASCADE;')
            announce(c);req=request(c);register(c,req);countdown(c,req,310,False);finish(c,req)
            ot.require(proof(c,req)['targets']=={'familyCount':15,'allCredited':True,'complete':True},'late original preparation and empty targets retain all fifteen families')
            print(json.dumps({'passed':True,'thawDefinitionMd5':c.val("SELECT md5(pg_get_functiondef('%s'::regprocedure))"%ot.SIG),'f06BodyMd5':c.val("SELECT md5(prosrc) FROM pg_proc WHERE oid='smarter_private.attest_frozen_hand_continuation(uuid,uuid,uuid,bigint,bigint,text)'::regprocedure"),'productionWrites':False}))
        finally:c.stop()

if __name__=='__main__':main()
