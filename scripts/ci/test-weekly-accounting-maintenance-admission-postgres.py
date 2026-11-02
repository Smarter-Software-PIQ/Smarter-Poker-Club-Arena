#!/usr/bin/env python3
"""Private PG17 CASE/helper admission proof; no money bodies or real pg_cron execution."""
import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
R = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(); p.add_argument('--scratch', required=True); a = p.parse_args()
S = Path(a.scratch).resolve()
if sys.platform == 'darwin' and not S.is_relative_to('/Volumes/SmarterWork/agent-work'):
    raise RuntimeError('owned SSD scratch required')
if os.environ.get('DATABASE_URL'): raise RuntimeError('remote database forbidden')
S.mkdir(parents=True, exist_ok=True)
W = Path(tempfile.mkdtemp(prefix='tick-', dir=S)); D = W/'data'; started = False
PG = Path('/opt/homebrew/opt/postgresql@17/bin' if sys.platform == 'darwin' else '/usr/lib/postgresql/17/bin')
if len(str(W/'.s.PGSQL.5432').encode()) >= 104:
    shutil.rmtree(W); raise RuntimeError('private socket path must be shorter than104 bytes')
E = dict(os.environ, LC_ALL='C', LANG='C', PGTZ='UTC')
f = json.loads((R/'scripts/ci/fixtures/weekly-accounting-maintenance-admission.json').read_text())
M = next((R/'supabase/migrations').glob('20261102040938_*')).read_text()
def run(args, text=None, error=None):
    q = subprocess.run(list(map(str,args)), input=text, text=True, capture_output=True, env=E, timeout=30)
    if error: assert q.returncode and error in q.stderr, (error,q.stdout,q.stderr)
    else: assert q.returncode == 0, q.stdout+q.stderr
    return q.stdout.strip()
def sql(text, error=None):
    return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',W,'-U','postgres','-d','postgres'], text,error)
def quote(s): return "'"+s.replace("'","''")+"'"
def command(): return sql('SELECT command FROM cron.job WHERE jobid=272;')
def reset(): sql('TRUNCATE engine_maintenance_break,engine_maintenance_thaws,fixture_calls;')
def admission(label, setup, expected):
    reset(); sql(setup); sql(command())
    count = int(sql('SELECT count(*) FROM fixture_calls;'))
    assert (count > 0) is expected, (label,count)
    print('PASS '+label, flush=True)
try:
    assert ' 17.' in run([PG/'postgres','--version'])
    run([PG/'initdb','-D',D,'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8'])
    with (D/'postgresql.conf').open('a') as out: out.write("\nlisten_addresses=''\nunix_socket_directories='"+str(W)+"'\n")
    run([PG/'pg_ctl','-D',D,'-l',W/'server.log','-w','start']); started=True
    sql("""CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
    CREATE TABLE engine_maintenance_break(enforce_freeze boolean,announced_at timestamptz,phase text,break_started_at timestamptz,break_ends_at timestamptz);
    CREATE TABLE engine_maintenance_thaws(contract_version integer,release_target_at timestamptz,shifted jsonb);
    CREATE TABLE fixture_calls(name text);
    CREATE TABLE union_accounting_runs(status text,result jsonb,finished_at timestamptz);
    INSERT INTO union_accounting_runs VALUES('running','{"chunk_committed":true}',now());
    CREATE FUNCTION fn_union_week_start(timestamptz) RETURNS timestamptz LANGUAGE sql AS $$SELECT now()$$;
    CREATE FUNCTION fn_union_accounting_run_at(timestamptz) RETURNS timestamptz LANGUAGE sql AS $$SELECT now()+interval '1 day'$$;
    CREATE FUNCTION fn_union_settlement_cascade_due() RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_calls VALUES('cascade');RETURN '{}'::jsonb;END;$$;
    CREATE FUNCTION fn_accounting_close_gate_lifted_unstarted() RETURNS boolean LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_calls VALUES('gate');RETURN true;END;$$;
    CREATE FUNCTION fn_union_pnl_inventory_seal_in_progress() RETURNS boolean LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_calls VALUES('seal');RETURN true;END;$$;
    CREATE FUNCTION fn_weekly_close_first_visits_pending() RETURNS boolean LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_calls VALUES('visits');RETURN true;END;$$;
    CREATE SCHEMA cron;
    CREATE TABLE cron.job(jobid bigint PRIMARY KEY,schedule text,command text,nodename text,nodeport integer,database text,username text,active boolean,jobname text);
    -- Controlled catalog adapter only: the proof below executes real CASE/helpers.
    CREATE FUNCTION cron.alter_job(job_id bigint,command text) RETURNS void LANGUAGE sql AS $$UPDATE cron.job SET command=$2 WHERE jobid=$1$$;
    """)
    for h in f['helpers']:
        assert hashlib.md5(h['definition'].encode()).hexdigest() == h['md5']
        sql(h['definition'])
        assert sql('SELECT md5(pg_get_functiondef('+quote('public.'+h['signature'])+'::regprocedure));') == h['md5']
    assert hashlib.md5(f['command'].encode()).hexdigest()==f['commandMD5']
    sql("INSERT INTO cron.job VALUES(272,'*/5 * * * *',"+quote(f['command'])+",'localhost',5432,'postgres','postgres',true,'union-weekly-rakeback-close');")
    original_meta = sql("SELECT (to_jsonb(j)-'command')::text FROM cron.job j;")
    notice="INSERT INTO engine_maintenance_break VALUES(true,clock_timestamp()-interval '30 seconds','last_hand',NULL,NULL);"
    reset(); sql(notice); sql(f['command']); assert int(sql('SELECT count(*) FROM fixture_calls;')) > 0
    print('PASS BEFORE original tick enters original gate/cascade during real last_hand predicate',flush=True)
    sql("CREATE OR REPLACE FUNCTION public.fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql SET search_path=public,pg_temp AS $$SELECT NULL::boolean$$;")
    before=sql('SELECT to_jsonb(j)::text FROM cron.job j;')
    sql(M,'weekly_accounting_maintenance_admission_helpers_changed')
    assert sql('SELECT to_jsonb(j)::text FROM cron.job j;')==before
    sql(next(h['definition'] for h in f['helpers'] if h['signature']=='fn_entry_purchases_frozen()'))
    print('PASS changed helper refuses before cron update, preserving catalog row',flush=True)
    sql(M)
    new = command(); prefix,inner=f['command'].split(' SELECT ',1)
    assert new == prefix+' SELECT CASE WHEN public.fn_entry_purchases_frozen() IS FALSE AND public.fn_platform_frozen() IS FALSE THEN ('+inner[:-1]+') END;'
    assert sql("SELECT (to_jsonb(j)-'command')::text FROM cron.job j;")==original_meta
    print('PASS exact inner CASE/settings and all cron metadata preserved',flush=True)
    admission('AFTER last_hand skips every original gate/cascade',notice,False)
    admission('AFTER counting_down skips every original gate/cascade',"INSERT INTO engine_maintenance_break VALUES(true,clock_timestamp()-interval '3 minutes','counting_down',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes');",False)
    steps=['sit_out_at','hold_expires_at','addon_period_ends_at','reversible_until','reveal_deadline_at','rebuy_prompt_until','bomb_pot_next_due_at','cash_stay_last_tick_at','cash_rejoin_expires_at','level_started_at','cluster_break_eligible_since','cluster_move_expires_at','reconnect_presence','reconnect_snapshots']
    shifted=dict.fromkeys(steps,True);shifted['complete']=True
    admission('AFTER complete v3 future release skips original gates',"INSERT INTO engine_maintenance_thaws VALUES(3,clock_timestamp()+interval '1 minute',"+quote(json.dumps(shifted))+"::jsonb);",False)
    admission('idle preserves original admitted tick','',True)
    admission('unenforced notice preserves original admitted tick',notice.replace('VALUES(true,','VALUES(false,'),True)
    admission('future notice outside canonical allowance remains unarmed',notice.replace("-interval '30 seconds'","+interval '1 minute'"),True)
    admission('expired release remains unarmed',"INSERT INTO engine_maintenance_thaws VALUES(3,clock_timestamp()-interval '1 minute',"+quote(json.dumps(shifted))+"::jsonb);",True)
    for name in ['fn_entry_purchases_frozen','fn_platform_frozen']:
        sql('CREATE OR REPLACE FUNCTION public.'+name+"() RETURNS boolean LANGUAGE sql SET search_path=public,pg_temp AS $$SELECT NULL::boolean$$;")
        admission(name+' NULL fails closed','',False)
        h=next(x for x in f['helpers'] if x['signature']==name+'()');sql(h['definition'])
    sql(M,'weekly_accounting_maintenance_admission_preimage_changed')
    assert command()==new
    sql('UPDATE cron.job SET command='+quote(f['command'])+";UPDATE cron.job SET schedule='1 * * * *';")
    before=sql('SELECT to_jsonb(j)::text FROM cron.job j;');sql(M,'weekly_accounting_maintenance_admission_preimage_changed');assert sql('SELECT to_jsonb(j)::text FROM cron.job j;')==before
    sql("UPDATE cron.job SET schedule='*/5 * * * *';CREATE OR REPLACE FUNCTION cron.alter_job(job_id bigint,command text) RETURNS void LANGUAGE sql AS $$UPDATE cron.job SET command=$2,schedule='broken' WHERE jobid=$1$$;")
    before=sql('SELECT to_jsonb(j)::text FROM cron.job j;');sql(M,'weekly_accounting_maintenance_admission_metadata_changed');assert sql('SELECT to_jsonb(j)::text FROM cron.job j;')==before
    print('PASS replay/foreign preimage/metadata mutation refuse atomically',flush=True)
    print(json.dumps({'status':'passed','qualification':'real PG17 CASE/captured helper predicates; controlled cron catalog adapter only','productionMoneyExecuted':False}),flush=True)
finally:
    if started: run([PG/'pg_ctl','-D',D,'-m','immediate','-w','stop'])
    shutil.rmtree(W)
