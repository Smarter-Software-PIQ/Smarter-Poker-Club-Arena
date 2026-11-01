#!/usr/bin/env python3
"""Atomic staged creation against current creator and stage authorities on PG17.
Captured creator, permission, validator, format and satellite-target authorities
and table checks execute. Session, commerce and maintenance-release inputs are
synthetic; unrelated production triggers and live gameplay are not claimed.
"""
import argparse, hashlib, json, os, select, shutil, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CREATE_MIGRATION=ROOT/'supabase/migrations/20261101031811_tournament_creates_retain_their_original_request.sql'
MIGRATION=ROOT/'supabase/migrations/20261101034459_staged_tournament_creation_seals_its_plan_atomically.sql'
STAGES=ROOT/'scripts/ci/fixtures/tournament-create-request/current-stage-authority.json'
CAPTURE=ROOT/'scripts/ci/fixtures/tournament-create-request/current-authority.json'
DEPS=ROOT/'scripts/ci/fixtures/tournament-create-request/current-dependencies.json'
p=argparse.ArgumentParser();p.add_argument('--work-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--pg-bin',type=Path,default=Path(os.environ.get('PG_BIN','/usr/lib/postgresql/17/bin')));a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=False)
cluster=Path(tempfile.mkdtemp(prefix='stcreate-',dir=a.work_root));socket=cluster/'s';socket.mkdir()
env={k:v for k,v in os.environ.items() if not k.startswith('PG')};env['LC_ALL']='C'
cmd=[str(a.pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-h',str(socket),'-p','55472','-U','postgres','postgres']
report={'passed':False,'cleanup':False,'cases':[],'source_sha256':{str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [CAPTURE,DEPS,CREATE_MIGRATION,STAGES,MIGRATION]}}
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
 stage=json.loads(STAGES.read_text())
 stage_fixture="CREATE TABLE public.tournament_players(tournament_id uuid,user_id uuid);CREATE FUNCTION public.fn_capability_available(text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;"
 for rel in stage['relations']:
  cols=['"'+c['name']+'" '+c['type']+(' DEFAULT '+c['default'] if c['default'] else '')+(' NOT NULL' if c['notnull'] else '') for c in rel['columns']]
  stage_fixture+='CREATE TABLE public.'+rel['relname']+'('+','.join(cols+rel['checks'])+');'
  for trigger in rel['triggers']:stage_fixture+=trigger['function']+';'+trigger['definition']+';'
 for f in stage['functions']:
  require(hashlib.md5(f['definition'].encode()).hexdigest()==f['md5'],'Stage source drift')
  stage_fixture+=f['definition']+';'
 sql('stage-fixture',stage_fixture)
 sql('request-adapter-install',CREATE_MIGRATION.read_text())
 plan={'time_zone':'America/Chicago','stages':[{'stage_no':1,'end_after_level':20,'scheduled_start_utc':None},{'stage_no':2,'end_after_level':None,'scheduled_start_utc':'2099-11-03T18:00:00Z'}]}
 def staged(key=REQUEST,config=payload,chosen=plan,actor=OWNER,club=CLUB):
  return "public.fn_create_staged_tournament_request('"+club+"',"+quoted(config)+",'"+key+"','"+actor+"',"+quoted(chosen)+')'
 def seal(event,chosen=plan):return "public.fn_operator_seal_stage_plan('"+event+"',"+quoted(chosen)+')'
 def state():return "SELECT (SELECT count(*) FROM public.tournaments)||':'||(SELECT count(*) FROM smarter_private.tournament_create_receipts)||':'||(SELECT count(*) FROM public.fixture_commerce_basis)||':'||(SELECT count(*) FROM public.tournament_stage_plans);"
 old=json.loads(sql('before-create',user('SELECT '+call(key=None)+';')))['tournament_id']
 # This is an explicit row interleaving, not a production registration/money probe.
 sql('before-registration-interleaving',"INSERT INTO public.tournament_players VALUES('"+old+"','"+OWNER+"');")
 sql('before-seal-refused',user('SELECT '+seal(old)+"->>'reason';"),'players_registered')
 sql('missing-new-contract-no-write',user('SELECT '+staged()+';'),error='does not exist')
 sql('before-counts',state(),'1:0:1:0')
 sql('install',MIGRATION.read_text())
 first=json.loads(sql('atomic-create',user('SELECT '+staged()+';')))
 require(first['success'] and first['stage_plan']['ok'],'Positive stage receipt')
 event=first['tournament_id']
 sql('atomic-counts',state(),'2:1:2:1')
 sql('plan-bound-to-request',"SELECT (payload->'stagePlan'="+quoted(plan)+")::text FROM smarter_private.tournament_create_receipts WHERE request_id='"+REQUEST+"';",'true')
 sql('register-after-commit',"INSERT INTO public.tournament_players VALUES('"+event+"','"+OWNER+"');UPDATE public.tournaments SET status='RUNNING' WHERE id='"+event+"';")
 replay=json.loads(sql('registered-running-original-replay',user('SELECT '+staged()+';')))
 require(replay['tournament_id']==event and replay['stage_plan']['plan_hash']==first['stage_plan']['plan_hash'] and replay['stage_plan']['replay'],'Original sealed replay')
 changed={**plan,'time_zone':'UTC'}
 sql('changed-plan-refused',user('SELECT '+staged(chosen=changed)+"->>'error';"),'tournament_request_payload_changed')
 sql('changed-config-refused',user('SELECT '+staged(config={**payload,'name':'changed'})+"->>'error';"),'tournament_request_payload_changed')
 sql('wrong-actor',user('SELECT '+staged(actor=OTHER)+"->>'error';"),'not_authenticated')
 sql('foreign-club',user('SELECT '+staged(club=CLUB2)+"->>'error';"),'not_authorised')
 sql('anon-refused','SET ROLE anon;SELECT '+staged()+';',error='permission denied')
 invalid={**plan,'time_zone':'Unknown/Zone'};refused='22222222-2222-4222-8222-222222222222'
 answer=json.loads(sql('invalid-plan-rollback',user('SELECT '+staged(key=refused,chosen=invalid)+';')))
 require(answer=={'success':False,'error':'staged_tournament_plan_refused','reason':'time_zone_unknown','request_state':'not_created','request_id':refused,'user_id':OWNER,'club_id':CLUB},'Exact rollback receipt')
 sql('invalid-plan-no-partial-event',state(),'2:1:2:1')
 sql('corrected-same-id-rollback',user('BEGIN;SELECT '+staged(key=refused)+"->>'success';ROLLBACK;"),'true')
 sql('explicit-rollback-counts',state(),'2:1:2:1')
 sql('late-seal-fault-trigger',"CREATE FUNCTION public.fixture_stage_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'native_stage_fault';END$$;CREATE TRIGGER z_stage_fault AFTER INSERT ON public.tournament_stage_transitions FOR EACH ROW EXECUTE FUNCTION public.fixture_stage_fault();")
 sql('late-seal-fault',user('SELECT '+staged(key=refused)+';'),error='native_stage_fault')
 sql('late-seal-fault-counts',state(),'2:1:2:1')
 sql('remove-late-fault','DROP TRIGGER z_stage_fault ON public.tournament_stage_transitions;')
 # A request accepted through the earlier adapter cannot be called not_created.
 orphan_key='33333333-3333-4333-8333-333333333333'
 orphan=json.loads(sql('preexisting-unsealed-request',user('SELECT '+call({**payload,'stagePlan':plan},orphan_key)+';')))['tournament_id']
 sql('preexisting-registration',"INSERT INTO public.tournament_players VALUES('"+orphan+"','"+OWNER+"');")
 sql('preexisting-never-not-created',user('SELECT '+staged(key=orphan_key)+';'),error='staged_tournament_existing_request_unsealed')
 sql('preexisting-preserved',state(),'3:2:3:1')
 race='44444444-4444-4444-8444-444444444444'
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env);waiting=None
 try:
  proc.stdin.write(user('BEGIN;SELECT '+staged(key=race)+';')+'\n');proc.stdin.flush()
  require(bool(select.select([proc.stdout],[],[],10)[0]),'Atomic create did not answer')
  held=json.loads(proc.stdout.readline());held_id=held['tournament_id']
  sql('second-backend-no-unsealed-visibility',"SELECT (SELECT count(*) FROM public.tournaments WHERE id='"+held_id+"')||':'||(SELECT count(*) FROM public.tournament_stage_plans WHERE tournament_id='"+held_id+"');",'0:0')
  waiting=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
  waiting.stdin.write("SET application_name='native_staged_request_waiter';"+user('SELECT '+staged(key=race)+';')+'\n');waiting.stdin.close()
  deadline=time.monotonic()+10;blocked=False
  while time.monotonic()<deadline:
   r=command(cmd,"SELECT count(*) FROM pg_stat_activity WHERE application_name='native_staged_request_waiter' AND wait_event_type='Lock' AND wait_event='advisory';")
   require(r.returncode==0,r.stderr)
   if r.stdout.strip()=='1':blocked=True;break
   if waiting.poll() is not None:break
   time.sleep(0.02)
  require(blocked,'Concurrent original request lock not observed')
  proc.stdin.write('COMMIT;\n');proc.stdin.close();proc.wait(timeout=10);require(proc.returncode==0,proc.stderr.read())
  require(bool(select.select([waiting.stdout],[],[],10)[0]),'Concurrent replay did not answer')
  concurrent=json.loads(waiting.stdout.readline());waiting.wait(timeout=10);require(waiting.returncode==0,waiting.stderr.read())
  require(concurrent['tournament_id']==held_id and concurrent['stage_plan']['plan_hash']==held['stage_plan']['plan_hash'],'Concurrent original identity changed')
  report['cases'].append({'name':'observed-lock-original-sealed-replay','passed':True})
 finally:
  for child in [proc,waiting]:
   if child is not None and child.poll() is None:child.terminate();child.wait(timeout=5)
 sql('committed-event-and-plan-visible',"SELECT (SELECT count(*) FROM public.tournaments WHERE id='"+held_id+"')||':'||(SELECT count(*) FROM public.tournament_stage_plans WHERE tournament_id='"+held_id+"');",'1:1')
 sql('final-counts',state(),'4:3:4:2')
 sql('unchanged-authorities',"SELECT md5(pg_get_functiondef('public.fn_create_tournament(uuid,jsonb)'::regprocedure))||':'||md5(pg_get_functiondef('public.fn_operator_seal_stage_plan(uuid,jsonb)'::regprocedure))||':'||md5(pg_get_functiondef('public.fn_seal_tournament_stage_plan(uuid,jsonb)'::regprocedure));",'d3585069bf906c99bdb3ae795ac4304d:8ec06ec0a3cce9fcf2d15b2e78aaeaf4:c2b49a7ab4fd7f796edec122bfccd7d2')
 report['passed']=True
finally:
 if started:
  r=command([a.pg_bin/'pg_ctl','-D',cluster/'data','-m','immediate','-w','stop']);require(r.returncode==0,r.stderr)
 shutil.rmtree(cluster);report['cleanup']=not cluster.exists();(a.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
