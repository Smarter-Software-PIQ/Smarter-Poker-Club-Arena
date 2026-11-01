#!/usr/bin/env python3
"""Request identity against actual current tournament creators on disposable PG17.
Captured creator, permission, validator, format and satellite-target authorities
and table checks execute. Session, commerce and maintenance-release inputs are
synthetic; unrelated production triggers and live gameplay are not claimed.
"""
import argparse, hashlib, json, os, select, shutil, subprocess, sys, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
MIGRATION=ROOT/'supabase/migrations/20261101031811_tournament_creates_retain_their_original_request.sql'
CAPTURE=ROOT/'scripts/ci/fixtures/tournament-create-request/current-authority.json'
DEPS=ROOT/'scripts/ci/fixtures/tournament-create-request/current-dependencies.json'
p=argparse.ArgumentParser();p.add_argument('--work-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--pg-bin',type=Path,default=Path(os.environ.get('PG_BIN','/usr/lib/postgresql/17/bin')));a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=False)
cluster=Path(tempfile.mkdtemp(prefix='tcreate-',dir=a.work_root));socket=cluster/'s';socket.mkdir()
env={k:v for k,v in os.environ.items() if not k.startswith('PG')};env['LC_ALL']='C'
cmd=[str(a.pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-h',str(socket),'-p','55472','-U','postgres','postgres']
report={'passed':False,'cleanup':False,'cases':[],'source_sha256':{str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [CAPTURE,DEPS,MIGRATION]}}
OWNER='00000000-0000-4000-8000-0000000000a1';OTHER='00000000-0000-4000-8000-0000000000b2';CLUB='00000000-0000-4000-8000-00000000c1ab';CLUB2='00000000-0000-4000-8000-00000000c2ab'
REQUEST='11111111-1111-4111-8111-111111111111'
payload={'name':'Native Original','type':'mtt','gameVariant':'NLH','buyIn':100,'startingStack':10000,'minPlayers':3,'maxPlayers':100,'tableSize':9,'blindStructure':[{'level':1,'smallBlind':25,'bigBlind':50,'ante':0,'durationMinutes':10}],'payoutStructure':[{'place':1,'percentage':100}],'payoutPercent':15}
def command(argv,query=None):return subprocess.run([str(x) for x in argv],input=query,text=True,capture_output=True,env=env,timeout=30)
def require(ok,message):
 if not ok:raise AssertionError(message)
def sql(name,query,expected=None,error=None):
 r=command(cmd,query);(a.output/(name+'.log')).write_text(r.stdout+r.stderr)
 ok=(r.returncode!=0 and error in r.stderr) if error else r.returncode==0
 if expected is not None:ok=ok and r.stdout.strip()==expected
 report['cases'].append({'name':name,'passed':ok});require(ok,name+': '+r.stdout[-1000:]+r.stderr[-1800:]);return r.stdout.strip()
def quoted(value):return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
def call(data=payload,key=REQUEST,actor=OWNER,club=CLUB):
 return ('public.fn_create_tournament_request(\''+club+"',"+quoted(data)+",'"+key+"','"+actor+"')") if key else 'public.fn_create_tournament(\''+club+"',"+quoted(data)+')'
def user(query,actor=OWNER):return "SET ROLE authenticated;SET request.jwt.claim.sub='"+actor+"';"+query
def counts():return "SELECT (SELECT count(*) FROM public.tournaments)||':'||(SELECT count(*) FROM smarter_private.tournament_create_receipts)||':'||(SELECT count(*) FROM public.fixture_commerce_basis);"
started=False
try:
 report['postgres']=command([a.pg_bin/'postgres','--version']).stdout.strip();require('17.' in report['postgres'],'PG17 required')
 r=command([a.pg_bin/'initdb','-D',cluster/'data','-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']);require(r.returncode==0,r.stderr)
 with (cluster/'data/postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(socket)+"'\nport=55472\nshared_buffers='16MB'\nmax_connections=10\n")
 r=command([a.pg_bin/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-w','start']);require(r.returncode==0,r.stderr);started=True
 captured=json.loads(CAPTURE.read_text());deps=json.loads(DEPS.read_text());functions=captured['functions']+deps
 for f in functions:require(hashlib.md5(f['definition'].encode()).hexdigest()==f['definition_md5'],'Source drift '+f['signature'])
 fixture='''
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE SCHEMA smarter_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,owner_id uuid,lifecycle_status text DEFAULT 'active',asset text DEFAULT 'chips',is_platform boolean DEFAULT false,is_union boolean DEFAULT false,union_id uuid);
CREATE TABLE public.unions(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.union_admins(union_id uuid,user_id uuid);
CREATE TABLE public.club_members(club_id uuid,user_id uuid,role text,status text);
CREATE TABLE public.union_clubs(club_id uuid,union_id uuid);
CREATE TABLE public.fixture_policy(session_live boolean,commerce_allowed boolean,release_until timestamptz);
INSERT INTO public.fixture_policy VALUES(true,true,null);
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT session_live FROM public.fixture_policy$$;
CREATE FUNCTION public.fn_ca_commerce_admit(text,uuid,text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('allowed',commerce_allowed) FROM public.fixture_policy$$;
CREATE TABLE public.fixture_commerce_basis(event_id uuid PRIMARY KEY);
CREATE FUNCTION public.fn_ca_commerce_record_event_basis(text,uuid,text,uuid,text) RETURNS void LANGUAGE sql AS $$INSERT INTO public.fixture_commerce_basis VALUES($2)$$;
CREATE FUNCTION public.is_club_admin(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.clubs WHERE id=$1 AND owner_id=$2)$$;
CREATE TABLE public.ca_mtt_admission_contract(singleton boolean PRIMARY KEY,abi text);INSERT INTO public.ca_mtt_admission_contract VALUES(true,'unlimited-mtt-v2');
CREATE TABLE public.engine_maintenance_break(enforce_freeze boolean,announced_at timestamptz,phase text,break_started_at timestamptz,break_ends_at timestamptz);
CREATE FUNCTION public.fn_active_maintenance_release_boundary() RETURNS timestamptz LANGUAGE sql AS $$SELECT release_until FROM public.fixture_policy$$;
'''
 fixture+="INSERT INTO public.clubs(id,owner_id) VALUES('"+CLUB+"','"+OWNER+"'),('"+CLUB2+"','"+OTHER+"');"
 rel=captured['relations'][0]
 cols=['"'+c['name']+'" '+c['type']+(' DEFAULT '+c['default'] if c['default'] else '')+(' NOT NULL' if c['notnull'] else '') for c in rel['columns']]
 fixture+='CREATE TABLE public.tournaments('+','.join(cols+['PRIMARY KEY(id)']+rel['checks'])+');'
 # SQL-language dependencies resolve immediately; PL/pgSQL resolves statements on execution.
 fixture+='SET check_function_bodies=off;'
 for f in functions:fixture+=f['definition']+';'
 fixture+='SET check_function_bodies=on;'
 selected={'a0_tournaments_dual_entry_capacity','a2_tournaments_new_satellite_target','tournaments_creation_guard','zzzzzzz_tournaments_record_format'}
 for t in rel['insert_triggers']:
  if t['name'] in selected:fixture+=t['definition']+';'
 report['executed_original_triggers']=sorted(selected);report['other_original_triggers_not_executed']=[t['name'] for t in rel['insert_triggers'] if t['name'] not in selected]
 fixture+='REVOKE ALL ON FUNCTION public.fn_create_tournament(uuid,jsonb) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.fn_create_tournament(uuid,jsonb) TO authenticated,service_role;'
 sql('fixture',fixture)
 sql('current-authority',"SELECT md5(pg_get_functiondef('public.fn_create_tournament(uuid,jsonb)'::regprocedure));",'d3585069bf906c99bdb3ae795ac4304d')
 sql('missing-adapter-no-write',user('SELECT '+call()+';'),error='does not exist')
 sql('missing-adapter-count','SELECT count(*) FROM public.tournaments;','0')
 sql('before-lost-ack',user('SELECT '+call(key=None)+';SELECT '+call(key=None)+';'))
 sql('before-duplicates','SELECT count(*) FROM public.tournaments;','2')
 sql('install',MIGRATION.read_text())
 first=json.loads(sql('first-accepted',user('SELECT '+call()+';')));require(first['success'] and first['request_id']==REQUEST,'Canonical request receipt')
 replay=json.loads(sql('same-request-replay',user('SELECT '+call()+';')));require(first==replay,'Original immutable reply')
 sql('after-replay',counts(),'3:1:3')
 # Each assertion reads persisted rows; no elapsed-time guess decides a race.
 accepted=first['tournament_id']
 sql('selected-fee-persisted',"SELECT buy_in_amount||':'||buy_in_fee||':'||payout_depth_percent FROM public.tournaments WHERE id='"+accepted+"';",'90.00:10.00:15.00')
 sql('changed-payload',user('SELECT '+call({**payload,'name':'changed'})+"->>'error';"),'tournament_request_payload_changed')
 sql('changed-payload-is-not-retirable',user('SELECT coalesce('+call({**payload,'name':'changed'})+"->>'request_state','unknown');"),'unknown')
 sql('wrong-actor',user('SELECT '+call(actor=OTHER)+"->>'error';"),'not_authenticated')
 sql('foreign-actor-replay',user('SELECT '+call(actor=OTHER,club=CLUB2)+"->>'error';",OTHER),'not_authorised')
 sql('unauthenticated','SELECT '+call()+"->>'error';",'not_authenticated')
 sql('anonymous-acl','SET ROLE anon;SELECT '+call()+';',error='permission denied')
 sql('private-receipt-acl','SET ROLE authenticated;SELECT * FROM smarter_private.tournament_create_receipts;',error='permission denied')
 sql('service-direct-receipt-acl','SET ROLE service_role;SELECT * FROM smarter_private.tournament_create_receipts;',error='permission denied')
 sql('receipt-update',"UPDATE smarter_private.tournament_create_receipts SET payload='{}' WHERE request_id='"+REQUEST+"';",error='tournament_create_receipt_is_immutable')
 sql('receipt-delete',"DELETE FROM smarter_private.tournament_create_receipts WHERE request_id='"+REQUEST+"';",error='tournament_create_receipt_is_immutable')
 sql('receipt-truncate','TRUNCATE smarter_private.tournament_create_receipts;',error='tournament_create_receipt_is_immutable')
 sql('session-revoked','UPDATE public.fixture_policy SET session_live=false;')
 sql('revoked-session-replay',user('SELECT '+call()+"->>'error';"),'not_authenticated')
 sql('session-restored','UPDATE public.fixture_policy SET session_live=true;')
 sql('owner-revoked',"UPDATE public.clubs SET owner_id='"+OTHER+"' WHERE id='"+CLUB+"';")
 sql('revoked-owner-replay',user('SELECT '+call()+"->>'error';"),'not_authorised')
 sql('owner-restored',"UPDATE public.clubs SET owner_id='"+OWNER+"' WHERE id='"+CLUB+"';")
 sql('explicit-rollback',user('BEGIN;SELECT '+call(key='22222222-2222-4222-8222-222222222222')+';ROLLBACK;'))
 sql('explicit-rollback-counts',counts(),'3:1:3')
 invalid={**payload,'startingStack':0};refused='33333333-3333-4333-8333-333333333333'
 refusal=json.loads(sql('canonical-refusal',user('SELECT '+call(invalid,refused)+';')))
 require(refusal['request_state']=='not_created' and refusal['request_id']==refused and refusal['user_id']==OWNER and refusal['club_id']==CLUB,'Verified non-creation receipt')
 sql('refusal-no-row',counts(),'3:1:3')
 sql('corrected-same-request',user('BEGIN;SELECT '+call(key=refused)+"->>'success';ROLLBACK;"),'true')
 sql('commerce-refused','UPDATE public.fixture_policy SET commerce_allowed=false;')
 sql('commerce-authority-preserved',user('SELECT '+call(key=refused)+"->>'error';"),'operating_access_required')
 sql('commerce-restored','UPDATE public.fixture_policy SET commerce_allowed=true;')
 sql('freeze-fixture',"UPDATE public.fixture_policy SET release_until=clock_timestamp()+interval '5 minutes';")
 sql('creation-freeze-preserved',user('SELECT '+call(key=refused)+';'),error='MTT_CREATION_PLATFORM_FROZEN')
 sql('freeze-released','UPDATE public.fixture_policy SET release_until=null;')
 sql('late-fault-trigger',"CREATE FUNCTION public.fixture_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native_receipt_fault';END $$;CREATE TRIGGER z_native_fault AFTER INSERT ON smarter_private.tournament_create_receipts FOR EACH ROW EXECUTE FUNCTION public.fixture_receipt_fault();")
 sql('late-fault-rollback',user('SELECT '+call(key=refused)+';'),error='native_receipt_fault')
 sql('late-fault-counts',counts(),'3:1:3')
 sql('remove-late-fault','DROP TRIGGER z_native_fault ON smarter_private.tournament_create_receipts;')
 race='44444444-4444-4444-8444-444444444444'
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 waiting=None
 try:
  proc.stdin.write(user('BEGIN;SELECT '+call(key=race)+';')+'\n');proc.stdin.flush()
  require(bool(select.select([proc.stdout],[],[],10)[0]),'First request did not answer inside its open transaction')
  prior=json.loads(proc.stdout.readline())
  waiting=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
  waiting.stdin.write("SET application_name='native_tournament_request_waiter';"+user('SELECT '+call(key=race)+';')+'\n');waiting.stdin.close()
  deadline=time.monotonic()+10;blocked=False
  while time.monotonic()<deadline:
   observed=command(cmd,"SELECT count(*) FROM pg_stat_activity WHERE application_name='native_tournament_request_waiter' AND wait_event_type='Lock' AND wait_event='advisory';")
   require(observed.returncode==0,observed.stderr)
   if observed.stdout.strip()=='1':blocked=True;break
   if waiting.poll() is not None:break
   time.sleep(0.02)
  require(blocked,'Second backend did not wait on the original request lock')
  proc.stdin.write('COMMIT;\n');proc.stdin.close();proc.wait(timeout=10);require(proc.returncode==0,proc.stderr.read())
  require(bool(select.select([waiting.stdout],[],[],10)[0]),'Waiting request did not answer after commit')
  following=json.loads(waiting.stdout.readline());waiting.wait(timeout=10);require(waiting.returncode==0,waiting.stderr.read())
  require(prior==following,'Concurrent duplicate changed receipt')
  report['cases'].append({'name':'two-backend-lock-observed-exact-replay','passed':True})
 finally:
  for child_process in [proc,waiting]:
   if child_process is not None and child_process.poll() is None:
    child_process.terminate();child_process.wait(timeout=5)
 sql('concurrent-counts',counts(),'4:2:4')
 # All four requested formats use the unchanged authority. The satellite
 # points to the exact previously created main; no invented target is used.
 for index,kind in enumerate(['sng','spin','satellite']):
  key=f'55555555-5555-4555-8555-55555555555{index}'
  config={**payload,'type':kind,'name':'Native '+kind,'maxPlayers':9 if kind=='sng' else 3}
  if kind=='satellite':config.update(satelliteTargetId=accepted,satelliteSeats=1)
  answer=json.loads(sql('format-'+kind,user('SELECT '+call(config,key)+';')));require(answer['success'],'Format refused '+kind)
  require(json.loads(sql('format-'+kind+'-replay',user('SELECT '+call(config,key)+';')))==answer,'Format duplicate')
 sql('all-format-counts',counts(),'7:5:7')
 # Simulate a form with an accepted main and first satellite, then a fault in
 # the second child's receipt. Replay cannot duplicate either accepted event.
 main_key='66666666-6666-4666-8666-666666666660';child1_key='66666666-6666-4666-8666-666666666661';child2_key='66666666-6666-4666-8666-666666666662'
 main=json.loads(sql('parent-accepted',user('SELECT '+call(key=main_key)+';')))
 child={**payload,'type':'satellite','satelliteTargetId':main['tournament_id'],'satelliteSeats':1,'name':'Native Child1'}
 child1=json.loads(sql('child1-accepted',user('SELECT '+call(child,child1_key)+';')))
 child2={**child,'name':'Native Child2'}
 sql('child2-fault','CREATE TRIGGER z_native_fault AFTER INSERT ON smarter_private.tournament_create_receipts FOR EACH ROW EXECUTE FUNCTION public.fixture_receipt_fault();')
 sql('child2-rolled-back',user('SELECT '+call(child2,child2_key)+';'),error='native_receipt_fault')
 sql('partial-counts',counts(),'9:7:9')
 sql('child2-remove-fault','DROP TRIGGER z_native_fault ON smarter_private.tournament_create_receipts;')
 require(json.loads(sql('parent-replay',user('SELECT '+call(key=main_key)+';')))==main,'Parent duplicate')
 require(json.loads(sql('child1-replay',user('SELECT '+call(child,child1_key)+';')))==child1,'First child duplicate')
 second=json.loads(sql('child2-original-request',user('SELECT '+call(child2,child2_key)+';')));require(second['success'],'Second child failed')
 sql('partial-recovery-counts',counts(),'10:8:10')
 sql('child-targets-preserved',"SELECT count(*) FROM public.tournaments WHERE satellite_target_id='"+main['tournament_id']+"';",'2')
 sql('retire-original',"DELETE FROM public.tournaments WHERE id='"+prior['tournament_id']+"';")
 retired=json.loads(sql('retired-replay',user('SELECT '+call(key=race)+';')))
 require(retired=={'success':False,'error':'tournament_request_target_retired','request_state':'retired','request_id':race,'user_id':OWNER,'club_id':CLUB,'tournament_id':prior['tournament_id']},'Verified retired identity')
 sql('retired-not-recreated',counts(),'9:8:10')
 sql('original-receipt-preserved',"SELECT receipt->>'tournament_id' FROM smarter_private.tournament_create_receipts WHERE request_id='"+race+"';",prior['tournament_id'])
 sql('all-source-unchanged',"SELECT md5(pg_get_functiondef('public.fn_create_tournament(uuid,jsonb)'::regprocedure))||':'||md5(pg_get_functiondef('public.fn_create_tournament_governed_legacy(uuid,jsonb)'::regprocedure));",'d3585069bf906c99bdb3ae795ac4304d:3d40ead690de9769287475c206341668')
 # The same required accounting step owns the connected staged-create path.
 staged_output=a.output/'staged-create'
 staged=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/ci/test-tournament-staged-create-request.py'),
   '--work-root',str(a.work_root),'--output',str(staged_output),'--pg-bin',str(a.pg_bin)],
   text=True,capture_output=True,env=env,timeout=120)
 (a.output/'staged-create.log').write_text(staged.stdout+staged.stderr)
 require(staged.returncode==0,'Staged creation qualification failed: '+staged.stderr[-1800:])
 stage_report=json.loads((staged_output/'report.json').read_text())
 require(stage_report.get('passed') is True and stage_report.get('cleanup') is True
   and stage_report.get('cases') and all(case.get('passed') is True for case in stage_report['cases']),
   'Staged creation qualification incomplete')
 report['staged_create_report']='staged-create/report.json'
 report['passed']=True
finally:
 if started:
  r=command([a.pg_bin/'pg_ctl','-D',cluster/'data','-m','immediate','-w','stop']);require(r.returncode==0,r.stderr)
 shutil.rmtree(cluster);report['cleanup']=not cluster.exists();(a.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
