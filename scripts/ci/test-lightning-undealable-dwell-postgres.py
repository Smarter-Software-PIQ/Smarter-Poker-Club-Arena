#!/usr/bin/env python3
"""Captured production dwell owners, exercised in an isolated PostgreSQL cluster."""
import os,socket,subprocess,tempfile,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
paths=[os.environ.get('PG_BIN',''),'/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin','/usr/lib/postgresql/16/bin']
if shutil.which('pg_config'):paths.append(subprocess.check_output(['pg_config','--bindir'],text=True).strip())
PG=next((Path(p) for p in paths if p and (Path(p)/'initdb').is_file()),None)
if PG is None:raise RuntimeError('PostgreSQL tools required')
Path(os.environ.get('TMPDIR',str(ROOT/'work'))).mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='lightning-dwell-',dir=os.environ.get('TMPDIR',str(ROOT/'work'))) as tmp:
 f=Path(tmp)
 def run(args,sql=None):
  p=subprocess.run([str(a) for a in args],input=sql,text=True,capture_output=True,timeout=45)
  if p.returncode:raise RuntimeError(p.stdout+p.stderr)
  return p.stdout.strip()
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 run([PG/'initdb','-D',f/'db','-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
 run([PG/'pg_ctl','-D',f/'db','-l',f/'log','-o',f"-h 127.0.0.1 -p {port} -k ''",'-w','start'])
 def q(sql):return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres'],sql)
 try:
  q('''CREATE TABLE cash_games(id uuid PRIMARY KEY,cluster_mode text,cluster_epoch integer,lightning_enabled boolean,enabled boolean,must_move boolean,handedness integer,template_name text,closed_at timestamptz,ruleset_snapshot jsonb,lightning_on_condition_since timestamptz,lightning_off_condition_since timestamptz,updated_at timestamptz,population integer);
CREATE TABLE cash_cluster_conversion(id uuid DEFAULT gen_random_uuid(),cluster_id uuid,conversion_request_id uuid,from_mode text,to_mode text,trigger_population integer,on_threshold integer,off_threshold integer,epoch_before integer,epoch_after integer,status text DEFAULT 'pending',abort_reason text,opened_at timestamptz DEFAULT now(),closed_at timestamptz,chips_at_begin numeric);
CREATE TABLE lightning_cluster_drain(cluster_id uuid,conversion_id uuid,completed_at timestamptz);
CREATE TABLE lightning_operator_request(cluster_id uuid,created_at timestamptz,action text,answer jsonb);
CREATE TABLE lightning_instance(id uuid,cluster_id uuid,state text);
CREATE TABLE tables(id uuid,cluster_id uuid);
CREATE TABLE table_seats(table_id uuid,stack numeric,left_at timestamptz);
CREATE TABLE cash_cluster_events(game_id uuid,kind text,payload jsonb,request_id uuid);
CREATE FUNCTION fn_cash_cluster_lightning_state(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('verdict',jsonb_build_object('live_eligible',population,'would_turn_off',population<=4,'would_turn_on',population>=10),'thresholds',jsonb_build_object('off',4,'on',10)) FROM cash_games WHERE id=$1$$;
CREATE FUNCTION fn_lightning_config_number(jsonb,text,numeric,numeric,numeric,boolean) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('value',coalesce(($1->>$2)::numeric,$3))$$;
CREATE FUNCTION fn_cash_cluster_begin_pending_on(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION fn_cash_cluster_abort_pending_on(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION fn_cash_cluster_commit_lightning(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION fn_cash_cluster_abort_pending_off(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION fn_cash_cluster_commit_must_move(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION fn_lightning_drain_advance(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
''')
  for item in json.loads((ROOT/'scripts/ci/fixtures/lightning-undealable-dwell-preimages.json').read_text()):q(item['definition'])
  g='11111111-1111-4111-8111-111111111111'
  q(f"INSERT INTO cash_games VALUES('{g}','lightning',1,true,true,true,6,'action',NULL,'{{\"lightning\":{{\"always_on\":false}}}}',NULL,NULL,now(),3); INSERT INTO cash_cluster_conversion(cluster_id,status,from_mode,to_mode,closed_at) VALUES('{g}','committed','must_move','lightning',now());")
  assert q(f"SELECT fn_cash_cluster_lightning_drive('{g}')->>'action';")=='min_mode_dwell'
  q((ROOT/'supabase/migrations/20261115144938_an_undealable_lightning_pool_does_not_dwell.sql').read_text())
  for population in range(4):
   q(f"DELETE FROM cash_cluster_conversion WHERE status='pending'; UPDATE cash_games SET population={population},cluster_mode='lightning',lightning_off_condition_since=NULL;")
   assert q(f"SELECT fn_cash_cluster_lightning_drive('{g}')->>'action';")=='begin_pending_off'
   assert q('SELECT cluster_mode FROM cash_games;')=='pending_off'
  q("DELETE FROM cash_cluster_conversion WHERE status='pending'; UPDATE cash_games SET population=4,cluster_mode='lightning',lightning_off_condition_since=NULL;")
  assert q(f"SELECT fn_cash_cluster_lightning_drive('{g}')->>'action';")=='min_mode_dwell'
  q("UPDATE cash_games SET ruleset_snapshot='{\"lightning\":{\"min_mode_dwell_ms\":0}}';")
  assert q(f"SELECT fn_cash_cluster_lightning_drive('{g}')->'result'->>'reason';")=='off_condition_dwell'
  q("UPDATE cash_games SET population=3,ruleset_snapshot='{\"lightning\":{\"always_on\":true}}';")
  assert q(f"SELECT fn_cash_cluster_lightning_drive('{g}')->>'action';")=='hold'
  assert q('SELECT count(*) FROM table_seats;')=='0'
  print('Captured Lightning defect fails before; 0..3 bypass dwell, 4 retains dwell, always-on preserved PASS')
 finally:run([PG/'pg_ctl','-D',f/'db','-m','fast','-w','stop'])
