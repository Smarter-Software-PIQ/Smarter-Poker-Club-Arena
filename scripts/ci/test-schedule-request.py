#!/usr/bin/env python3
"""Actual schedule SQL and immutable request receipt, on a disposable PG17 cluster.
Auth session and commerce policy inputs are synthetic. Captured current upsert,
validator, authorization, all schedule triggers and their pure helpers are real.
No production connection, credentials, financial mutation or automatic retry.
"""
import argparse, hashlib, json, os, shutil, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261101021323_schedule_creates_keep_their_request_receipt.sql'
CAPTURE = ROOT / 'scripts/ci/fixtures/schedule-request/current-authority.json'
p = argparse.ArgumentParser()
p.add_argument('--work-root', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--pg-bin', type=Path, default=Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin')))
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=False)
cluster = Path(tempfile.mkdtemp(prefix='schedreq-', dir=a.work_root))
socket = cluster / 's'; socket.mkdir()
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
cmd = [str(a.pg_bin/'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', str(socket), '-p', '55471', '-U', 'postgres', 'postgres']
report = {'passed': False, 'cleanup': False, 'cases': [], 'source_sha256': {str(f.relative_to(ROOT)): hashlib.sha256(f.read_bytes()).hexdigest() for f in [CAPTURE, MIGRATION]}}
ADMIN='00000000-0000-4000-8000-0000000000a1'
STRANGER='00000000-0000-4000-8000-0000000000b2'
CLUB='00000000-0000-4000-8000-00000000c1ab'
OTHER='00000000-0000-4000-8000-00000000c2ab'
REQUEST='11111111-1111-4111-8111-111111111111'
payload={'clubId':CLUB,'name':'Native Request','daysOfWeek':[1],'startTimesUtc':['18:00'],'config':{'type':'mtt'}}

def command(argv, sql=None):
    return subprocess.run([str(x) for x in argv], input=sql, text=True, capture_output=True, env=env, timeout=30)
def require(ok, message):
    if not ok: raise AssertionError(message)
def sql(name, query, expected=None, error=None):
    r=command(cmd,query); (a.output/(name+'.log')).write_text(r.stdout+r.stderr)
    ok=(r.returncode!=0 and error in r.stderr) if error else r.returncode==0
    if expected is not None: ok=ok and r.stdout.strip()==expected
    report['cases'].append({'name':name,'passed':ok})
    require(ok,name+': '+r.stdout[-1000:]+r.stderr[-1500:]); return r.stdout.strip()
def quoted(value): return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
def call(data=payload,key=REQUEST,actor=ADMIN):
    return ('public.fn_create_tournament_schedule_request('+quoted(data)+", '"+key+"'::uuid, '"+actor+"'::uuid)") if key else 'public.fn_upsert_tournament_schedule('+quoted(data)+')'
def as_user(query,user=ADMIN):
    return "SET ROLE authenticated;SET request.jwt.claim.sub='"+user+"';SET request.jwt.claim.role='authenticated';"+query
started=False
try:
    report['postgres']=command([a.pg_bin/'postgres','--version']).stdout.strip()
    require('17.' in report['postgres'],'PG17 required')
    r=command([a.pg_bin/'initdb','-D',cluster/'data','-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']);require(r.returncode==0,r.stderr)
    with (cluster/'data/postgresql.conf').open('a') as f:
        f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(socket)+"'\nport=55471\nshared_buffers='16MB'\nmax_connections=10\n")
    r=command([a.pg_bin/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-w','start']);require(r.returncode==0,r.stderr);started=True
    captured=json.loads(CAPTURE.read_text())
    functions=captured['functions']+captured['triggers']+captured['triggerDependencies']
    for f in functions: require(hashlib.md5(f['definition'].encode()).hexdigest()==f['definition_md5'],'Captured source drift '+f['signature'])
    fixture=(ROOT/'scripts/ci/fixtures/schedule-time-zone/fixture.sql').read_text()
    fixture+='''
CREATE SCHEMA smarter_private;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,lifecycle_status text NOT NULL DEFAULT 'active',asset text NOT NULL DEFAULT 'chips');
CREATE TABLE public.union_clubs(union_id uuid,club_id uuid);
CREATE TABLE public.fixture_commerce(allowed boolean NOT NULL);
INSERT INTO public.fixture_commerce VALUES(true);
CREATE FUNCTION public.fn_ca_commerce_admit(text,uuid,text,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('allowed',allowed) FROM public.fixture_commerce $$;
'''
    fixture+="INSERT INTO public.clubs(id) VALUES('"+CLUB+"'),('"+OTHER+"');INSERT INTO public.fixture_club_admins VALUES('"+OTHER+"','"+STRANGER+"');"
    # Install actual known-zone helper before its table constraint.
    fixture+=next(f['definition'] for f in captured['functions'] if f['signature'].startswith('fn_schedule_time_zone'))+';'
    for rel in captured['relations']:
        cols=['"'+c['name']+'" '+c['type']+(' DEFAULT '+c['default'] if c['default'] else '')+(' NOT NULL' if c['notnull'] else '') for c in rel['columns']]
        fixture+='CREATE TABLE public.'+rel['relname']+'('+','.join(cols+rel['constraints'])+');'
    for f in functions: fixture+=f['definition']+';'
    for rel in captured['relations']:
        for t in rel['triggers']: fixture+=t+';'
    fixture+='REVOKE ALL ON FUNCTION public.fn_upsert_tournament_schedule(jsonb) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.fn_upsert_tournament_schedule(jsonb) TO authenticated,service_role;'
    sql('fixture',fixture)
    sql('current-source',"SELECT md5(pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure));",'43602000c9c65c773bbfe96cd40b6e0f')
    sql('missing-overload-is-no-write',as_user('SELECT '+call()+';'),error='does not exist')
    sql('missing-overload-count','SELECT count(*) FROM public.tournament_schedules;','0')
    sql('before-lost-acknowledgement',as_user('SELECT '+call(key=None)+';SELECT '+call(key=None)+';'))
    sql('before-duplicates','SELECT count(*) FROM public.tournament_schedules;','2')
    sql('install',MIGRATION.read_text())
    sql('postimage',"SELECT md5(pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure)),md5(pg_get_functiondef('public.fn_create_tournament_schedule_request(jsonb,uuid,uuid)'::regprocedure));")
    first=json.loads(sql('first-accepted',as_user('SELECT '+call()+';')))
    require(first['ok'] is True and first['request_id']==REQUEST,'Receipt identity')
    schedule=first['schedule_id']
    again=json.loads(sql('lost-acknowledgement-replay',as_user('SELECT '+call()+';')))
    require(again==first,'Replay must return exact first receipt')
    sql('after-replay-count','SELECT count(*) FROM public.tournament_schedules;','3')
    sql('actual-trigger-preserved',"SELECT config->>'banChat' FROM public.tournament_schedules WHERE id='"+schedule+"';",'true')
    sql('changed-payload-refused',as_user('SELECT '+call({**payload,'name':'Edited'})+"->>'error';"),'schedule_request_payload_changed')
    sql('payload-conflict-is-not-a-new-refusal',as_user('SELECT coalesce('+call({**payload,'name':'Edited'})+"->>'request_state','unknown');"),'unknown')
    sql('wrong-actor-refused',as_user('SELECT '+call({**payload,'clubId':OTHER},actor=STRANGER)+"->>'error';",STRANGER),'not_authorised')
    sql('actor-changed-before-submit',as_user('SELECT '+call(actor=STRANGER)+"->>'error';"),'not_authorised')
    sql('no-auth',"SELECT "+call()+"->>'error';",'not_authenticated')
    sql('anon-no-execute','SET ROLE anon;SELECT '+call()+';',error='permission denied')
    sql('no-direct-receipt-read','SET ROLE authenticated;SELECT * FROM smarter_private.tournament_schedule_create_receipts;',error='permission denied')
    sql('receipt-update-refused',"UPDATE smarter_private.tournament_schedule_create_receipts SET payload='{}' WHERE request_id='"+REQUEST+"';",error='schedule_create_receipt_is_immutable')
    sql('receipt-delete-refused',"DELETE FROM smarter_private.tournament_schedule_create_receipts WHERE request_id='"+REQUEST+"';",error='schedule_create_receipt_is_immutable')
    sql('receipt-truncate-refused','TRUNCATE smarter_private.tournament_schedule_create_receipts;',error='schedule_create_receipt_is_immutable')
    sql('deactivate-original',"UPDATE public.tournament_schedules SET active=false WHERE id='"+schedule+"';")
    require(json.loads(sql('replay-does-not-reactivate',as_user('SELECT '+call()+';')))==first,'Original receipt retained')
    sql('still-inactive',"SELECT active FROM public.tournament_schedules WHERE id='"+schedule+"';",'f')
    sql('rollback',as_user("BEGIN;SELECT "+call(key='22222222-2222-4222-8222-222222222222')+";ROLLBACK;"))
    sql('rollback-counts','SELECT (SELECT count(*) FROM public.tournament_schedules)||\':\'||(SELECT count(*) FROM smarter_private.tournament_schedule_create_receipts);','3:1')
    sql('refusal-no-receipt',as_user('SELECT '+call({**payload,'daysOfWeek':[]},'33333333-3333-4333-8333-333333333333')+"->>'error';"),'days_of_week_required')
    sql('definitive-refusal-state',as_user('SELECT '+call({**payload,'daysOfWeek':[]},'33333333-3333-4333-8333-333333333333')+"->>'request_state';"),'not_created')
    sql('corrected-refusal-same-key',as_user('BEGIN;SELECT '+call(key='33333333-3333-4333-8333-333333333333')+"->>'ok';ROLLBACK;"),'true')
    sql('commerce-refusal-fixture','UPDATE public.fixture_commerce SET allowed=false;')
    sql('commerce-refusal-preserved',as_user('SELECT '+call(key='44444444-4444-4444-8444-444444444444')+"->>'error';"),'operating_access_required')
    sql('commerce-restore','UPDATE public.fixture_commerce SET allowed=true;')
    # Failure after the authoritative schedule insert must roll back BOTH rows.
    sql('late-fault-fixture',"CREATE FUNCTION public.fixture_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native_late_fault';END $$;CREATE TRIGGER z_native_fault AFTER INSERT ON smarter_private.tournament_schedule_create_receipts FOR EACH ROW EXECUTE FUNCTION public.fixture_receipt_fault();")
    sql('late-fault-atomicity',as_user('SELECT '+call(key='55555555-5555-4555-8555-555555555555')+';'),error='native_late_fault')
    sql('late-fault-counts','SELECT (SELECT count(*) FROM public.tournament_schedules)||\':\'||(SELECT count(*) FROM smarter_private.tournament_schedule_create_receipts);','3:1')
    sql('remove-native-fault','DROP TRIGGER z_native_fault ON smarter_private.tournament_schedule_create_receipts;')
    race='66666666-6666-4666-8666-666666666666'
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    proc.stdin.write(as_user('BEGIN;SELECT '+call(key=race)+';SELECT pg_sleep(0.5);COMMIT;'));proc.stdin.close()
    prior=json.loads(proc.stdout.readline()) # committed receipt has been built; transaction still owns key
    following=json.loads(sql('concurrent-same-key',as_user('SELECT '+call(key=race)+';')))
    proc.wait(timeout=15);require(proc.returncode==0,proc.stderr.read());require(prior==following,'Concurrent replay changed receipt')
    report['cases'].append({'name':'two-backend-first-receipt','passed':True})
    sql('race-counts','SELECT (SELECT count(*) FROM public.tournament_schedules)||\':\'||(SELECT count(*) FROM smarter_private.tournament_schedule_create_receipts);','4:2')
    sql('new-intent',as_user('SELECT '+call(key='77777777-7777-4777-8777-777777777777')+';'))
    sql('new-intent-count','SELECT count(*) FROM public.tournament_schedules;','5')
    sql('revoke-owner','DELETE FROM public.fixture_club_admins WHERE club_id=\''+CLUB+"';")
    sql('replay-current-auth',as_user('SELECT '+call()+"->>'error';"),'not_authorised')
    sql('restore-owner',"INSERT INTO public.fixture_club_admins VALUES('"+CLUB+"','"+ADMIN+"');")
    sql('moved-target-fixture',"UPDATE public.tournament_schedules SET club_id='"+OTHER+"' WHERE id='"+schedule+"';")
    moved=json.loads(sql('moved-target-terminal-receipt',as_user('SELECT '+call()+';')))
    require(moved=={'error':'schedule_request_target_changed','request_state':'retired','request_id':REQUEST,'user_id':ADMIN,'schedule_id':schedule},'Moved terminal receipt identity')
    sql('moved-target-restore',"UPDATE public.tournament_schedules SET club_id='"+CLUB+"' WHERE id='"+schedule+"';")
    sql('missing-target-fixture',"DELETE FROM public.tournament_schedules WHERE id='"+schedule+"';")
    sql('missing-target-not-recreated',as_user('SELECT '+call()+"->>'error';"),'schedule_request_target_changed')
    retired=json.loads(sql('missing-target-terminal-receipt',as_user('SELECT '+call()+';')))
    require(retired=={'error':'schedule_request_target_changed','request_state':'retired','request_id':REQUEST,'user_id':ADMIN,'schedule_id':schedule},'Terminal receipt identity')
    sql('missing-target-count','SELECT count(*) FROM public.tournament_schedules;','4')
    retained=json.loads(sql('terminal-receipt-original-preserved',"SELECT receipt FROM smarter_private.tournament_schedule_create_receipts WHERE request_id='"+REQUEST+"';"))
    require(retained==first,'Retirement rewrote original accepted receipt')
    report['passed']=True
finally:
    if started:
        r=command([a.pg_bin/'pg_ctl','-D',cluster/'data','-m','immediate','-w','stop'])
        require(r.returncode==0,'Cleanup failed: '+r.stderr)
    shutil.rmtree(cluster);report['cleanup']=True
    (a.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report['passed'],'cases':len(report['cases']),'cleanup':report['cleanup']}))
