#!/usr/bin/env python3
"""Native PG17 original round admission/receipt protocol, no production access.
Payment boundary adapters record calls; actual financial owners remain qualified
by the adjacent maintained financial-phase suite. Clock is explicit and local.
"""
import argparse, json, os, selectors, shutil, socket, subprocess, sys, tempfile, time
from pathlib import Path
R=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--scratch',required=True);a=p.parse_args()
S=Path(a.scratch).resolve()
if sys.platform=='darwin' and not S.is_relative_to('/Volumes/SmarterWork/agent-work'):raise RuntimeError('owned SSD scratch required')
if os.environ.get('DATABASE_URL'):raise RuntimeError('remote database forbidden')
S.mkdir(parents=True,exist_ok=True);W=Path(tempfile.mkdtemp(prefix='wr-',dir=S));D=W/'data';started=False
PG=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'if sys.platform=='darwin'else'/usr/lib/postgresql/17/bin'))
E={k:v for k,v in os.environ.items()if not k.startswith('PG')};E.update(LC_ALL='C',LANG='C',PGTZ='UTC')
with socket.socket()as sk:sk.bind(('127.0.0.1',0));port=str(sk.getsockname()[1])
command=[str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres']
def run(cmd,s=None):return subprocess.run(list(map(str,cmd)),input=s,text=True,capture_output=True,env=E,check=True,timeout=60).stdout.strip()
def sql(s):return run(command,s)
def function(version,name,delimiter='$function$;'):
 t=next((R/'supabase/migrations').glob(version+'_*')).read_text();start=t.index('FUNCTION '+name+'(');start=t.rfind('CREATE ',0,start);end=t.index(delimiter,start)+len(delimiter);return t[start:end]
def tick():return json.loads(sql("SET statement_timeout='1500s';SELECT smarter_private.weekly_payout_next_round();"))
def session(s):
 proc=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=E)
 proc.stdin.write("\\o /dev/null\n"+s+"\n\\o\n\\echo BARRIER\n");proc.stdin.flush()
 deadline=time.monotonic()+10
 with selectors.DefaultSelector()as selector:
  selector.register(proc.stdout,selectors.EVENT_READ)
  while True:
   if not selector.select(max(0,deadline-time.monotonic())):
    proc.kill();proc.wait();raise RuntimeError('session barrier timed out')
   line=proc.stdout.readline()
   if line.strip()=='BARRIER':break
   if not line:raise RuntimeError(proc.stderr.read())
 return proc
def finish(proc,s='ROLLBACK;'):
 out,err=proc.communicate(s,timeout=10);assert proc.returncode==0,(out,err)
def count():return sql('SELECT count(*)FROM fixture_calls;')
try:
 assert ' 17.' in run([PG/'postgres','--version'])
 run([PG/'initdb','-D',D,'-U','postgres','-A','trust','--no-locale','-E','UTF8'])
 run([PG/'pg_ctl','-D',D,'-l',W/'server.log','-w','start','-o',f"-k '' -p {port} -h127.0.0.1"]);started=True
 sql("""CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA smarter_private;
 CREATE TABLE weekly_accounting_payout_pauses(run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),period_start timestamptz,period_end timestamptz,attempt_no int,announced_at timestamptz,money_starts_at timestamptz,money_deadline_at timestamptz,expires_at timestamptz,scope_plan jsonb,phase text,acknowledged_at timestamptz,instance_id text,lease_claims jsonb);
 CREATE TABLE fixture_clock(n timestamptz);INSERT INTO fixture_clock VALUES('2026-11-09 10:00Z');
 CREATE FUNCTION fixture_now()RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT n FROM fixture_clock$$;
 CREATE TABLE fixture_freeze(frozen boolean);INSERT INTO fixture_freeze VALUES(false);
 CREATE FUNCTION fn_entry_purchases_frozen()RETURNS boolean LANGUAGE sql VOLATILE AS $$SELECT frozen FROM fixture_freeze$$;
 CREATE FUNCTION fn_platform_frozen()RETURNS boolean LANGUAGE sql VOLATILE AS $$SELECT frozen FROM fixture_freeze$$;
 CREATE FUNCTION fn_caller_is_engine()RETURNS boolean LANGUAGE sql AS $$SELECT current_user='postgres'$$;
 CREATE TABLE fixture_calls(seq bigserial,scope_id uuid,round_no int);
 CREATE TABLE smarter_private.weekly_payout_owned_transactions(backend_pid int,transaction_id bigint,run_id uuid,scope_kind text,scope_id uuid,period_start timestamptz,period_end timestamptz,round_no int,PRIMARY KEY(backend_pid,transaction_id));
 CREATE TABLE accounting_routed_settlement_runs(scope_kind text,scope_id uuid,period_start timestamptz,period_end timestamptz,round_no int,result jsonb);
 CREATE FUNCTION fn_weekly_accounting_attempt_begin(boolean)RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE FUNCTION fn_weekly_accounting_attempt_end()RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE FUNCTION fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)RETURNS jsonb LANGUAGE sql AS $$SELECT '{"success":true}'::jsonb$$;
 CREATE FUNCTION fixture_payment(c uuid,r int)RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_calls(scope_id,round_no)VALUES(c,r);RETURN '{"ok":true,"success":true,"routing_version":"3","source_version":"2"}'::jsonb;END$$;
 CREATE FUNCTION fn_bank_standalone_week_rake(uuid,timestamptz,timestamptz)RETURNS jsonb LANGUAGE sql AS $$SELECT fixture_payment($1,1)$$;
 CREATE FUNCTION fn_settle_accounting_commission_stage(k text,c uuid,s timestamptz,e timestamptz)RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r jsonb;BEGIN r:=fixture_payment(c,2);INSERT INTO accounting_routed_settlement_runs VALUES(k,c,s,e,2,r);RETURN r;END$$;
 CREATE FUNCTION fn_settle_accounting_rakeback_stage(k text,c uuid,s timestamptz,e timestamptz)RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r jsonb;BEGIN r:=fixture_payment(c,3);INSERT INTO accounting_routed_settlement_runs VALUES(k,c,s,e,3,r);RETURN r;END$$;
 CREATE FUNCTION smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$;
 CREATE FUNCTION smarter_private.weekly_payout_finalize(uuid)RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('stage','finalized','run_id',$1)$$;
 CREATE FUNCTION smarter_private.certification_retention_admission()RETURNS void LANGUAGE sql AS $$SELECT pg_advisory_xact_lock(530090,2)$$;
 """)
 sql((R/'tests/fixtures/weekly-close-scale/preimage/fn_union_week_start.sql').read_text())
 for ver,name in [('20260907044041','public.fn_union_prev_week_start'),('20260914110557','public.fn_union_accounting_run_at'),('20261029172107','smarter_private.maintenance_write_admission')]:sql(function(ver,name))
 old=next((R/'supabase/migrations').glob('20261102191635_*')).read_text()
 sql(old[old.index('CREATE TABLE IF NOT EXISTS smarter_private.weekly_payout_rounds_config'):old.index('-- The round runner')])
 policy=next((R/'supabase/migrations').glob('20261103193545_*')).read_text()
 sql(policy[policy.index('CREATE TABLE IF NOT EXISTS smarter_private.daily_window_policy'):policy.index('CREATE OR REPLACE FUNCTION public.fn_daily_window_policy')])
 original=function('20261102191635','smarter_private.weekly_payout_next_round','$f$;')
 sql(original)
 migration=next((R/'supabase/migrations').glob('20261108210509_*')).read_text()
 assert sql("SELECT md5(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure))")=='86c572334023dd7a9231704cfc14868a'
 sql(migration.replace('COMMIT;','ROLLBACK;'))
 assert sql("SELECT md5(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure))")=='86c572334023dd7a9231704cfc14868a'
 sql(migration)
 print('POSTIMAGE',sql("SELECT md5(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure)),md5(prosrc) FROM pg_proc WHERE oid='smarter_private.weekly_payout_next_round()'::regprocedure"),flush=True)
 exact=sql("SELECT pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure)")
 # Explicit clock adapters only; transaction locks and financial coordinator unchanged.
 def clocked(definition):return definition.replace('clock_timestamp()','public.fixture_now()').replace('statement_timestamp()','public.fixture_now()')
 sql(clocked(exact))
 sql("""INSERT INTO weekly_accounting_payout_pauses VALUES('00000000-0000-0000-0000-000000000001','2026-11-02 08:00Z','2026-11-09 08:00Z',1,'2026-11-09 09:58Z','2026-11-09 10:00Z','2026-11-10 06:00Z','2026-11-10 06:01Z','[{"kind":"club","id":"00000000-0000-0000-0000-000000000002","period_start":"2026-11-02T08:00:00Z","period_end":"2026-11-09T08:00:00Z"}]','ready','2026-11-09 10:00Z','weekly-payout-rounds','[]');""")
 assert sql("SELECT fn_union_accounting_run_at(fn_union_week_start('2026-11-09 10:00Z'))='2026-11-09 10:00Z'::timestamptz")=='t'
 sql('UPDATE fixture_freeze SET frozen=true;')
 sql(clocked(original));assert tick()['stage']=='round_paid';assert count()=='1'
 sql("TRUNCATE fixture_calls,smarter_private.weekly_payout_round_receipts;UPDATE weekly_accounting_payout_pauses SET phase='ready';")
 sql(clocked(exact));assert tick()['stage']=='maintenance_frozen';assert count()=='0'
 print('PASS preimage pays during freeze; postimage Nov9 announcement-first defers without financial call',flush=True)
 sql('UPDATE fixture_freeze SET frozen=false;')
 proc=session('BEGIN;SELECT smarter_private.maintenance_write_admission();UPDATE fixture_freeze SET frozen=true;')
 try:assert tick()['stage']=='maintenance_busy';assert count()=='0'
 finally:finish(proc,'COMMIT;')
 assert tick()['stage']=='maintenance_frozen'
 sql("UPDATE fixture_freeze SET frozen=false;UPDATE fixture_clock SET n='2026-11-09 10:06Z';")
 proc=session("BEGIN;SET LOCAL statement_timeout='1500s';SELECT smarter_private.weekly_payout_next_round();")
 try:
  result=subprocess.run(command,input='SELECT smarter_private.maintenance_write_admission();',text=True,capture_output=True,env=E,timeout=5)
  assert result.returncode and 'maintenance writer lane lock_not_available' in result.stderr,result.stderr
  assert count()=='0','uncommitted payment leaked'
 finally:finish(proc,'COMMIT;')
 # Lost reply is recovered by the original durable receipt, then next unpaid unit.
 assert count()=='1';assert sql('SELECT count(*)FROM smarter_private.weekly_payout_round_receipts;')=='1'
 r=tick();assert r['round']==2 and r['run_id']=='00000000-0000-0000-0000-000000000001';assert count()=='2'
 sql('SELECT smarter_private.maintenance_write_admission();')
 # Attach the departed Horse board at the payment boundary. The coordinator,
 # its R3 receipt, the split trigger and the deferred ledger guard are real.
 # The other financial-phase suite exercises the public R3 owner directly.
 split=R/'scripts/ci/fixtures/split-late-return'
 sql((split/'schema.sql').read_text())
 for definition in json.loads((split/'actual-functions.json').read_text()):
  sql('SET check_function_bodies=false;'+definition['body'])
 sql((split/'wiring.sql').read_text())
 sql("""CREATE FUNCTION fixture_r3_horse_credit() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  PERFORM set_config('app.ledger_autoskip_club_members','1',true);
  PERFORM sr_pay(601.94);
  RETURN NEW;
 END $$;
 CREATE TRIGGER fixture_r3_horse_credit AFTER INSERT ON fixture_calls
 FOR EACH ROW WHEN (NEW.round_no=3) EXECUTE FUNCTION fixture_r3_horse_credit();""")
 receipt_query="""SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY round_no),'[]')
 FROM smarter_private.weekly_payout_round_receipts r"""
 money_query="""SELECT jsonb_build_object(
  'bank',(SELECT chip_treasury FROM clubs),
  'horse',(SELECT chip_balance FROM club_members),
  'returns',(SELECT count(*) FROM ca_horse_club_split_late_returns),
  'alerts',(SELECT count(*) FROM financial_alerts),
  'legs',(SELECT coalesce(jsonb_agg(jsonb_build_array(category,from_type,to_type,amount)
     ORDER BY category),'[]') FROM chip_ledger))"""
 first_two=json.loads(sql(receipt_query))
 assert len(first_two)==2
 before=json.loads(sql(money_query))
 assert before=={'bank':1000,'horse':0,'returns':0,'alerts':0,'legs':[]}
 original_round="BEGIN;SET LOCAL statement_timeout='1500s';SELECT smarter_private.weekly_payout_next_round();COMMIT;"
 refused=subprocess.run(command,input=original_round,text=True,capture_output=True,env=E,timeout=10)
 assert refused.returncode and 'balance_moved_without_its_ledger_row' in refused.stderr,refused.stderr
 assert json.loads(sql(receipt_query))==first_two and json.loads(sql(money_query))==before
 sql(next((R/'supabase/migrations').glob('20261109140919_*')).read_text())
 sql(original_round)  # Ignore the response. A new connection recovers the original receipt.
 receipts=json.loads(sql(receipt_query))
 assert len(receipts)==3 and receipts[:2]==first_two
 assert receipts[2]['round_no']==3 and receipts[2]['run_id']==r['run_id']
 paid=json.loads(sql(money_query))
 assert paid=={'bank':1000,'horse':0,'returns':1,'alerts':0,'legs':[
   ['club_bank_claim','player_wallet','club_treasury',601.94],
   ['rakeback','club_treasury','player_wallet',601.94]]},paid
 assert sql("""SELECT bool_and(CASE category WHEN 'rakeback' THEN
  from_entity_id=md5('club')::uuid AND to_entity_id=md5('horse')::uuid ELSE
  from_entity_id=md5('horse')::uuid AND to_entity_id=md5('club')::uuid END)
  AND count(DISTINCT idempotency_key)=2 FROM chip_ledger""")=='t'
 assert tick()['stage']=='finalized' and count()=='3'
 assert json.loads(sql(receipt_query))==receipts and json.loads(sql(money_query))==paid
 print('PASS original R3 outer commit refuses missing split leg; lost ACK retains one R3 and both conserved legs',flush=True)
 assert sql('SELECT count(*)FROM smarter_private.weekly_payout_owned_transactions;')=='0'
 print('PASS both concurrent lock orders; committed unknown response continues same run once; admission releases',flush=True)
 sql("UPDATE fixture_clock SET n='2026-11-10 09:34Z';")
 assert tick()['stage']=='maintenance_headroom';assert count()=='3'
 sql("UPDATE fixture_clock SET n='2026-11-10 09:32Z';")
 assert tick()['stage']=='finalized'
 assert json.loads(sql("SET statement_timeout=0;SELECT smarter_private.weekly_payout_next_round();"))['stage']=='maintenance_budget_unbounded'
 print('PASS next03:58 policy notice retains existing25min budget; unbounded refuses without financial touch',flush=True)
 assert sql("SELECT NOT has_function_privilege('service_role','smarter_private.weekly_payout_next_round()','EXECUTE')")=='t'
 print('PASS original ACL',flush=True)
finally:
 if started:run([PG/'pg_ctl','-D',D,'-m','immediate','-w','stop'])
 shutil.rmtree(W)
