"""Immutable exit decisions and their actual admission/opener consumers.
Runs only on the existing disposable socket-only Phase6 estate. Receipt fixtures
represent the original cash-out owner's retained outcome, never a money probe.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import tempfile
from uuid import UUID, uuid4

ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
PG=Path(os.environ['PG_BIN'])
SOCKET=os.environ['LIGHTNING_ZERO_PAYER_SOCKET']
PORT=os.environ['LIGHTNING_ZERO_PAYER_PORT']
GAME='c79d8ec2-2281-411d-b4e1-42b5610849e2'
M=ROOT/'supabase/migrations/20261110023119_plo_post_human_demand_follows_its_original_cash_out.sql'
child='plo_demand_'+uuid4().hex[:12]

def sql(body,database='postgres',ok=True):
    with tempfile.NamedTemporaryFile(mode='w',suffix='.sql') as f:
        f.write('SET client_min_messages=warning;\n'+body);f.flush()
        r=subprocess.run([str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',SOCKET,'-p',PORT,'-d',database,'-f',f.name],capture_output=True,text=True,timeout=60)
    if ok and r.returncode: raise RuntimeError(r.stdout+r.stderr)
    return r

def demand():
    return json.loads(sql('SELECT fn_plo_lightning_post_human_demand();',child).stdout)

assert sql("SELECT inet_server_addr() IS NULL AND current_setting('listen_addresses')='' AND to_regnamespace('harness') IS NOT NULL;").stdout.strip()=='t'
# Exercise the maintained concurrent preamble parser, then each index alone
# and the complete original transaction body, exactly as the installer does.
shape=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{splitConcurrentPreamble}from'./scripts/ci/migration-concurrent-preamble.mjs';console.log(JSON.stringify(splitConcurrentPreamble(readFileSync(process.argv[1],'utf8'))));",str(M)],cwd=ROOT,text=True))
assert shape['ok']
original=(ROOT/'supabase/migrations/20261109141301_plo_lightning_gradual_admission_and_feeder_lifecycle.sql').read_text()
component='CREATE TABLE public.lightning_horse_admission'+original.split('CREATE TABLE public.lightning_horse_admission',1)[1].split('DO $guard$',1)[0]
receipt_source=(ROOT/'supabase/migrations/20260908220604_bind_cashout_requests_to_seat_occupancy.sql').read_text()
receipt=re.search(r'CREATE TABLE IF NOT EXISTS public.seat_cashout_receipts \([\s\S]*?\n\);',receipt_source).group()
human=str(uuid4()); table=str(uuid4()); horse=str(uuid4())
events={b:next(str(UUID(int=i)) for i in range(1,100) if int(hashlib.md5(str(UUID(int=i)).encode()).hexdigest()[:8],16)%5==b) for b in (0,1)}

def event(occupancy,at='2026-11-10T01:00:00Z',stack=400,credited=True,player=None):
    player=player or human
    return f"""INSERT INTO seat_cashout_receipts(occupancy_id,user_id,table_id,seat_id,seat_number,receipt,created_at)
 VALUES('{occupancy}','{player}','{table}',gen_random_uuid(),1,
 jsonb_build_object('ok',true,'credited',{str(credited).lower()},'stack',{stack},'tournament_table',false,
 'user_id','{player}'::uuid,'table_id','{table}'::uuid,'seat_number',1,'occupancy_id','{occupancy}'::uuid,
 'idempotency_key','cashout:occupancy:{occupancy}'),'{at}');"""
def all_in_keeps_choice():
    expected=json.dumps(demand())
    sql(f"BEGIN; UPDATE table_seats SET stack=0 WHERE table_id='{table}' AND left_at IS NULL; DO $$ BEGIN IF fn_plo_lightning_post_human_demand() IS DISTINCT FROM '{expected}'::jsonb THEN RAISE EXCEPTION 'All-in occupied chairs lost their original decision';END IF;END $$;ROLLBACK;",child)

try:
    sql(f'CREATE DATABASE {child} TEMPLATE postgres;')
    sql("ALTER TABLE public.table_waitlist ADD COLUMN IF NOT EXISTS notified_at timestamptz;"+receipt+component+f"""
 INSERT INTO cash_games(id,club_id,union_id,name,template_name,variant,sb,bb,handedness,ruleset_snapshot,created_by,must_move,lightning_enabled,enabled,cluster_mode,cluster_epoch)
 VALUES('{GAME}','cb000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f1','PLO demand','madness','plo4',1,2,6,
 '{{"lightning":{{"on_threshold":10,"off_threshold":4,"always_on":false}}}}','00000000-0000-0000-0000-0000000000aa',true,true,true,'must_move',0);
 SELECT fx9_table('{GAME}','Main1','main',1,6);
 UPDATE tables SET id='{table}',game_variant='plo4',is_private=false WHERE cluster_id='{GAME}';
 INSERT INTO profiles(id,is_horse) VALUES('{human}',false),('{horse}',true);
 DO $$ DECLARE u uuid; BEGIN FOR n IN 1..5 LOOP u:=gen_random_uuid();INSERT INTO profiles VALUES(u,true);PERFORM fxr_join('{GAME}','{table}',n+1,400,true,true,u);END LOOP;END $$;
 """,child)
    before=sql(f"SELECT fn_plo_lightning_horse_admit('{table}','{horse}','2026-11-10T01:00:00Z');",child,False)
    assert before.returncode and 'LIGHTNING_ADMISSION_DEMAND' in before.stderr, (before.stdout,before.stderr)
    for index in shape['indexes']: sql(index['statement'],child)
    sql(shape['body'],child)
    sql(shape['body'],child)
    assert demand()['event_id'] is None and not demand()['continues'] and not demand()['wind_down']
    sql(f"INSERT INTO table_seats(table_id,user_id,seat_number,stack,left_at,occupancy_id) VALUES('{table}','{human}',1,400,'2026-11-10T01:00:00Z','{events[0]}');"+event(events[0]),child)
    expected=demand();assert expected['continues'] and not expected['wind_down'] and expected['event_id']==events[0]
    for _ in range(3): assert demand()==expected
    all_in_keeps_choice()
    # The old physical chair disappears during a real buy-in. The receipt
    # decision must survive both that deletion and its new Horse occupant.
    sql(f"DELETE FROM table_seats WHERE table_id='{table}' AND user_id='{human}';",child)
    assert demand()==expected
    sql(f"SELECT fn_plo_lightning_horse_admit('{table}','{horse}','2026-11-10T01:00:00Z');",child)
    paced=sql(f"SELECT fn_plo_lightning_horse_admit('{table}','{horse}','2026-11-10T01:00:01Z');",child,False)
    assert paced.returncode and 'LIGHTNING_ADMISSION_PACED' in paced.stderr
    sql(f"SELECT fxr_join('{GAME}','{table}',1,400,true,true,'{horse}');",child)
    assert demand()==expected
    # Actual zero-forecast opener expands a continuing all-Horse game.
    sql(f"SELECT fn_cash_cluster_tick('{GAME}',0);",child)
    assert sql(f"SELECT count(*)=1 FROM tables WHERE cluster_id='{GAME}' AND role='feeder' AND lifecycle='opening';",child).stdout.strip()=='t'
    assert demand()==expected
    sql(event(events[1],'2026-11-10T02:00:00Z'),child)
    assert demand()['wind_down'] and not demand()['continues']
    denied=sql(f"SELECT fn_plo_lightning_horse_admit('{table}','{horse}','2026-11-10T03:00:00Z');",child,False)
    assert denied.returncode and 'LIGHTNING_ADMISSION_DEMAND' in denied.stderr
    all_in_keeps_choice()
    # A zero-stack cash-out is also an actual exit (nothing needs crediting).
    zero=next(str(UUID(int=i)) for i in range(200,300) if int(hashlib.md5(str(UUID(int=i)).encode()).hexdigest()[:8],16)%5==0)
    sql(event(zero,'2026-11-10T03:00:00Z',0,False),child)
    assert demand()['event_id']==zero and demand()['continues']
    # Continuing demand still adds individuals through the original gate and
    # real feeder, then refuses an eleventh automated participant.
    for n in range(4):
        u=str(uuid4())
        at=f'2026-11-10T03:{(n*90)//60:02d}:{(n*90)%60:02d}Z'
        sql(f"INSERT INTO profiles VALUES('{u}',true); SELECT fn_plo_lightning_horse_admit((SELECT id FROM tables WHERE cluster_id='{GAME}' AND role='feeder'),'{u}','{at}'); SELECT fxr_join('{GAME}',(SELECT id FROM tables WHERE cluster_id='{GAME}' AND role='feeder'),{n+1},400,true,true,'{u}');",child)
        if n==1: sql(f"SELECT fn_cash_cluster_tick('{GAME}',0);",child)
    assert sql(f"SELECT fn_cash_cluster_live_eligible('{GAME}')=10;",child).stdout.strip()=='t'
    extra=str(uuid4());sql(f"INSERT INTO profiles VALUES('{extra}',true);",child)
    capped=sql(f"SELECT fn_plo_lightning_horse_admit('{table}','{extra}','2026-11-10T03:20:00Z');",child,False)
    assert capped.returncode and 'LIGHTNING_ADMISSION_DEMAND' in capped.stderr
    all_in_keeps_choice()
    # Failed/non-cash outcomes are not a new last-human cash-out.
    invalid=str(UUID(int=999))
    sql(event(invalid,'2026-11-10T04:00:00Z').replace("'tournament_table',false","'tournament_table',true"),child)
    assert demand()['event_id']==zero and demand()['continues']
    # A real occupied human remains a human while all-in, away or leaving.
    for flags in ['0,true,false','0,false,true','400,false,false']:
        stack,away,leaving=flags.split(',')
        # Keep each temporary return and assertion in one rolled-back transaction.
        sql(f"BEGIN; INSERT INTO table_seats(table_id,user_id,seat_number,stack,is_sitting_out,leave_pending) SELECT id,'{human}',5,{stack},{away},{leaving} FROM tables WHERE cluster_id='{GAME}' AND role='feeder'; DO $$ BEGIN IF (fn_plo_lightning_post_human_demand()->>'wind_down')::boolean OR (fn_plo_lightning_post_human_demand()->>'continues')::boolean THEN RAISE EXCEPTION 'Occupied human lost protection';END IF;END $$;ROLLBACK;",child)
    sql(f"BEGIN; UPDATE table_seats s SET left_at=now() FROM tables t WHERE t.id=s.table_id AND t.cluster_id='{GAME}' AND s.left_at IS NULL; DO $$ BEGIN IF (fn_plo_lightning_post_human_demand()->>'wind_down')::boolean OR (fn_plo_lightning_post_human_demand()->>'continues')::boolean THEN RAISE EXCEPTION 'Empty game reseeded';END IF;END $$;ROLLBACK;",child)
    assert sql("SELECT NOT has_function_privilege('authenticated','fn_plo_lightning_post_human_demand()','EXECUTE') AND NOT has_function_privilege('anon','fn_plo_lightning_post_human_demand()','EXECUTE') AND has_function_privilege('service_role','fn_plo_lightning_post_human_demand()','EXECUTE');",child).stdout.strip()=='t'
    print(sql("SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p WHERE p.oid IN ('public.fn_plo_lightning_post_human_demand()'::regprocedure,'public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)'::regprocedure,'public.fn_cash_cluster_tick(uuid,integer)'::regprocedure);",child).stdout.strip())
    print('PASS: actual immutable exit chooses stable continuation, survives chair reuse; human return/empty end/ACL/replay/pacing/admission/opener hold')
finally:
    sql(f'DROP DATABASE IF EXISTS {child};')
assert sql(f"SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='{child}');").stdout.strip()=='t'
