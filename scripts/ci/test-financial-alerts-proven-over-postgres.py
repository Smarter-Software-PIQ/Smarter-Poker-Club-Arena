"""Settled accounting and Lightning alerts close on evidence, never on silence.

Runs the actual smarter_private.financial_alerts_proven_over from the
migration on a disposable PostgreSQL 17 cluster, plus the actual production
fn_resolve_settled_financial_alerts body (md5-pinned preimage) with the
migration's own call-site patch, which must compile.

Each closing case has a refusing twin: a week finished before the alert, a
failed week, a malformed period, an unfinished recent union week, a Lightning
instance still past its deadline, a failed reap inside the window, a frozen
Cluster, a page younger than 15 minutes, and echoes whose parent is open,
closed only by ageing, or of another source. A dry run writes nothing and
reports what an apply closes; a second apply closes nothing; unrelated alerts
are untouched.
"""
import json, os, pathlib, re, shutil, subprocess, tempfile
R=pathlib.Path(__file__).resolve().parents[2]
F=R/'scripts/ci/fixtures/financial-alerts-proven-over'
M=next((R/'supabase/migrations').glob('*_settled_accounting_and_lightning_alerts_close_on_evidence.sql')).read_text()
PG=pathlib.Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
parent=pathlib.Path(os.environ['ACCOUNTING_FIXTURE_PARENT'])
w=pathlib.Path(tempfile.mkdtemp(prefix='a-',dir=parent)); sock=w/'s';sock.mkdir()
port=os.environ.get('ALERTS_PROVEN_OVER_PG_PORT','55683');started=False
env=dict(os.environ,LC_ALL='C',LANG='C')
def run(args,text=None):
 r=subprocess.run(args,input=text,text=True,capture_output=True,env=env,timeout=60)
 assert r.returncode==0,(r.stdout+r.stderr)[:2000]
 return r.stdout.strip()
def sql(s):
 return run([str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-h',str(sock),'-p',port,'-d','postgres'],s)
fn=re.search(r'(CREATE OR REPLACE FUNCTION smarter_private\.financial_alerts_proven_over.*?\n\$function\$;)',M,re.S).group(1)
U=lambda n:'00000000-0000-0000-0000-%012d'%n
try:
 run([str(PG/'initdb'),'-D',str(w/'data'),'-U','postgres','-A','trust','--no-locale','-E','UTF8'])
 run([str(PG/'pg_ctl'),'-D',str(w/'data'),'-l',str(w/'server.log'),'-o',f"-k {sock} -p {port} -h '' -c shared_buffers=16MB",'-w','start']);started=True
 sql("""CREATE SCHEMA smarter_private;
CREATE TABLE public.financial_alerts(id uuid PRIMARY KEY,severity text,source text,message text,context jsonb,resolved boolean DEFAULT false,
 resolved_at timestamptz,created_at timestamptz DEFAULT now(),resolved_by uuid,resolution text);
CREATE TABLE public.union_accounting_runs(union_id uuid,period_start timestamptz,period_end timestamptz,scheduled_at timestamptz,status text,attempts integer,
 started_at timestamptz,finished_at timestamptz,result jsonb,standalone_club_id uuid,scope_kind text,scope_id uuid,last_scheduler_visit_at timestamptz);
CREATE TABLE public.cash_games(id uuid PRIMARY KEY,cluster_mode text);
CREATE TABLE public.lightning_instance(id uuid DEFAULT gen_random_uuid(),cluster_id uuid,state text,deadline_at timestamptz);
CREATE TABLE public.cash_cluster_events(id bigserial,game_id uuid,kind text,at timestamptz);
CREATE FUNCTION public.fn_lightning_config(p_cluster_id uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"alert_window_ms":600000}'::jsonb$$;
""")
 sql(fn)
 club,union=U(900),U(901)
 def alert(i,source,message,ctx,created="now()-interval '9 days'",resolved='false',resolution='NULL'):
  return f"INSERT INTO public.financial_alerts(id,severity,source,message,context,created_at,resolved,resolution) VALUES('{U(i)}','critical','{source}','{message}','{json.dumps(ctx)}'::jsonb,{created},{resolved},{resolution});"
 def run_row(kind,scope,ps,pe,status,ok,finished):
  return f"INSERT INTO public.union_accounting_runs(scope_kind,scope_id,period_start,period_end,status,result,finished_at,attempts) VALUES('{kind}','{scope}',{ps},{pe},'{status}','{{\"success\":{ok}}}'::jsonb,{finished},3);"
 W="'Weekly club accounting is incomplete'";S="'A weekly inventory seal step did not fit the bounded close tick'"
 wk=lambda d:f"date_trunc('day',now())-interval '{d} days'"
 ctx=lambda d:{'club_id':club,'period_start':sql(f"SELECT to_char(({wk(d)}) AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS')||'+00:00'"),'period_end':sql(f"SELECT to_char(({wk(d-7)}) AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS')||'+00:00'")}
 data=''
 # (a) club weeks
 data+=alert(1,'weekly_club_accounting',W[1:-1],ctx(30))+run_row('club',club,wk(30),wk(23),'complete','true',"now()-interval '2 days'")
 data+=alert(2,'weekly_club_accounting',W[1:-1],ctx(40))+run_row('club',club,wk(40),wk(33),'complete','true',"now()-interval '20 days'")
 data+=alert(3,'weekly_club_accounting',W[1:-1],ctx(50))+run_row('club',club,wk(50),wk(43),'failed','false',"now()-interval '1 day'")
 data+=alert(4,'weekly_club_accounting',W[1:-1],{'club_id':club,'period_start':'not a time','period_end':'x'})
 # (b) union seal step: alert 10 at day -60 (weeks complete), alert 11 at day -100 (a recent week unfinished)
 for d in (88,81,74,67):data+=run_row('union',union,wk(d),wk(d-7),'complete','true',"now()-interval '50 days'" if d==67 else f"now()-interval '{d-8} days'")
 data+=alert(10,'union_accounting_scheduler',S[1:-1],{'statement_timeout':'4min'},created=wk(60)+"+interval '4 hours'")
 for d in (121,114,107):data+=run_row('union',union,wk(d),wk(d-7),'complete' if d!=114 else 'failed','true' if d!=114 else 'false',"now()-interval '90 days'")
 data+=alert(11,'union_accounting_scheduler',S[1:-1],{'statement_timeout':'4min'},created=wk(100)+"+interval '4 hours'")
 # (c) lightning reaper pages
 for i,mode in [(20,'lightning'),(21,'lightning'),(22,'lightning'),(23,'frozen'),(24,'lightning')]:
  data+=f"INSERT INTO public.cash_games VALUES('{U(100+i)}','{mode}');"
  data+=alert(i,'lightning_alerts','LIGHTNING_REAPER_FAILURE',{'check':'reaper_failure','cluster_id':U(100+i)},created="now()-interval '5 minutes'" if i==24 else "now()-interval '9 days'")
 data+=f"INSERT INTO public.lightning_instance(cluster_id,state,deadline_at) VALUES('{U(120)}','dealing',now()+interval '1 minute'),('{U(120)}','completed',now()-interval '1 day'),('{U(121)}','forming',now()-interval '11 minutes');"
 data+=f"INSERT INTO public.cash_cluster_events(game_id,kind,at) VALUES('{U(120)}','lightning_pending_on_reap_failed',now()-interval '11 minutes'),('{U(122)}','lightning_pending_off_reap_failed',now()-interval '2 minutes');"
 data+=alert(25,'lightning_alerts','LIGHTNING_DRIVE_ERROR',{'check':'drive_error','cluster_id':U(120)})
 # (d) echoes
 for i,p,src in [(30,1,'weekly_club_accounting'),(31,2,'weekly_club_accounting'),(32,20,'lightning_alerts'),(33,40,'union_accounting_scheduler'),(34,41,'union_accounting_scheduler'),(35,1,'lightning_alerts')]:
  data+=alert(i,'drift_incident:financial_alerts:'+src,'unknown drift 0 chips',{'alert_id':U(p)})
 data+=alert(40,'union_accounting_scheduler','A weekly accounting scope did not finish its scheduler visit',{},resolved='true',resolution="'verified: a later scheduler visit to this union scope finished.'")
 data+=alert(41,'union_accounting_scheduler','A weekly accounting scope did not finish its scheduler visit',{},resolved='true',resolution="'Aged out.'")
 data+=alert(50,'fn_union_integrity_sweep','Union integrity sweep raised 1 signal(s) - review by agent',{})
 sql(data)
 digest=lambda:sql("SELECT md5(string_agg(to_jsonb(a)::text,'|' ORDER BY id)) FROM public.financial_alerts a")
 before=digest()
 dry=json.loads(sql("SELECT smarter_private.financial_alerts_proven_over(false,5000)"))
 assert digest()==before
 expect_proven=sorted(U(i) for i in (1,10,20));expect_echo=sorted(U(i) for i in (30,32,33))
 assert sorted(dry['proven_ids'])==expect_proven,dry
 assert sorted(dry['echo_ids'])==expect_echo,dry
 print('PASS dry run: writes nothing; proves 3 conditions over and 3 echoes, refuses 13 twins and leaves 2 unrelated alerts')
 got=json.loads(sql("SELECT smarter_private.financial_alerts_proven_over(true,5000)"))
 assert got['proven_over']==3 and got['echoes_closed']==3,got
 closed=sql("SELECT string_agg(id::text,',' ORDER BY id) FROM public.financial_alerts WHERE resolved AND resolution LIKE 'verified:%' AND context->>'resolved_by_fn'='fn_resolve_settled_financial_alerts'")
 assert closed.split(',')==sorted(expect_proven+expect_echo),closed
 assert sql(f"SELECT count(*) FROM public.financial_alerts WHERE id IN('{U(2)}','{U(3)}','{U(4)}','{U(11)}','{U(21)}','{U(22)}','{U(23)}','{U(24)}','{U(25)}','{U(31)}','{U(34)}','{U(35)}','{U(50)}') AND resolved")=='0'
 assert sql(f"SELECT resolution LIKE 'verified: club {club} week %recorded complete in union_accounting_runs at % (attempt 3), after this alert.' FROM public.financial_alerts WHERE id='{U(1)}'")=='t'
 assert sql(f"SELECT resolution LIKE 'verified: the alert this incident echo repeats ({U(1)}) is resolved: verified: club %' FROM public.financial_alerts WHERE id='{U(30)}'")=='t'
 assert sql(f"SELECT resolution LIKE 'verified: re-measured at %Lightning Cluster {U(120)} is not frozen%(1 live now)%' FROM public.financial_alerts WHERE id='{U(20)}'")=='t'
 print('PASS apply: closes exactly those 6 with evidence-citing resolutions; every refusing twin and unrelated alert stays open')
 again=json.loads(sql("SELECT smarter_private.financial_alerts_proven_over(true,5000)"))
 assert again['proven_over']==0 and again['echoes_closed']==0,again
 print('PASS idempotent: a second apply closes nothing')
 # The call site: the actual production resolver body, patched by this migration, compiles.
 pre=(F/'resolver-preimage.sql').read_text()
 import hashlib
 pin=re.search(r"md5\(pg_get_functiondef\(sig::regprocedure\)\)<>'([0-9a-f]{32})'",M).group(1)
 assert hashlib.md5(pre.encode()).hexdigest()==pin
 pairs=[(re.search(r'\$o%d\$(.*?)\$o%d\$'%(i,i),M,re.S).group(1),re.search(r'\$n%d\$(.*?)\$n%d\$'%(i,i),M,re.S).group(1)) for i in (1,2)]
 for o,n in pairs: assert pre.count(o)==1
 # The whole migration, exactly as Apply Merged Migration sends it, over the preimage.
 sql('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;'+pre+';')
 assert sql("SELECT md5(pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure))")==pin
 sql(M)
 assert sql("SELECT position('smarter_private.financial_alerts_proven_over(p_apply, p_limit)' in pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure))>0")=='t'
 assert sql("SELECT bool_or(has_function_privilege(r,'smarter_private.financial_alerts_proven_over(boolean,integer)','EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r")=='f'
 try: sql(M); raise SystemExit('a replay must refuse')
 except AssertionError as e: assert 'financial_alerts_proven_over_preimage_changed' in str(e)
 print('PASS install: the migration installs over the pinned production resolver, grants no browser role, and refuses a replay')
finally:
 if started:subprocess.run([str(PG/'pg_ctl'),'-D',str(w/'data'),'-m','immediate','stop'],capture_output=True,env=env)
 shutil.rmtree(w)
