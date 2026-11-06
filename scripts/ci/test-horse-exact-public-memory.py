#!/usr/bin/env python3
"""Isolated PG17 proof of accepted public-memory domain storage and compatibility."""
import argparse, json, os, re, shutil, subprocess, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--scratch', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a=p.parse_args(); a.scratch.mkdir(parents=True,exist_ok=True); a.output.mkdir(parents=True,exist_ok=True)
pg=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
cluster=Path(tempfile.mkdtemp(prefix='memory-',dir=a.scratch)); sock=cluster/'s'; sock.mkdir()
env={k:v for k,v in os.environ.items() if not k.startswith('PG')};env['LC_ALL']='C'
def command(cmd, sql=None):
 r=subprocess.run([str(x) for x in cmd],input=sql,text=True,capture_output=True,env=env,timeout=60)
 if r.returncode: raise RuntimeError(r.stdout+r.stderr)
 return r.stdout
psql=[pg/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',sock,'-U','postgres','-d','postgres']
def run(name,sql):
 result=command(psql,sql);(a.output/(name+'.log')).write_text(result);return result.strip()
started=False
try:
 command([pg/'initdb','-D',cluster/'data','-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8'])
 with (cluster/'data/postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(sock)+"'\nshared_buffers='16MB'\nmax_connections=10\n")
 command([pg/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-w','start']);started=True
 legacy=(ROOT/'supabase/migrations/20261023183513_durable_variant_scoped_horse_opponent_memory.sql').read_text()
 prefix=legacy[legacy.index('CREATE TABLE'):legacy.index('CREATE FUNCTION public.fn_horse_exploit_profiles_read')]
 run('fixture',"CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE hand_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),table_id uuid,hand_number bigint,game_variant text, tournament_id uuid,players jsonb DEFAULT '[]',actions jsonb DEFAULT '[]', UNIQUE(table_id,hand_number));"+prefix)
 # Use the actual maintained insert function: JSON-only caller fields survive only when a column exists.
 insert=(ROOT/'supabase/migrations/20260906113554_the_atomic_hand_insert_lets_the_defaults_apply_and_proves_it.sql').read_text()
 insert=insert[insert.index('CREATE OR REPLACE FUNCTION'):insert.index('REVOKE ALL ON FUNCTION')]
 run('insert-fixture',"CREATE TABLE bomb_pot_award_units(hand_history_id uuid,table_id uuid,hand_number bigint,pot_index int,board int,side text,user_id uuid,amount numeric,hand_name text, UNIQUE(hand_history_id,pot_index,board,side,user_id));"+insert)
 run('install',(ROOT/'supabase/migrations/20261106091733_horse_public_memory_exact_rule_domains.sql').read_text())
 actions=[{'userId':'actor','action':'raise','stage':'preflop'},{'userId':'villain','action':'fold','stage':'preflop'}]
 def accept(n,domain=None):
  row={'table_id':'00000000-0000-4000-8000-000000000001','hand_number':n,'game_variant':'plo4','horse_exploit_dealt_count':6,'players':[],'actions':actions}
  if domain is not None:row['public_memory_domain']=domain
  return run('accept-'+str(n),"SELECT fn_ca_insert_hand_with_awards('"+json.dumps(row)+"'::jsonb);")
 for i,d in enumerate([None,7,[],{}, {'version':2,'speed':'table','ante':'none'}],1):accept(i,d)
 assert run('unknown-skip',"SELECT count(*) FROM horse_exact_profiles;")=='0'
 assert run('legacy-retained',"SELECT sum(observed_hands) FROM horse_exploit_profiles;")=='10'
 for i,(speed,ante) in enumerate([('table','none'),('lightning','none'),('table','big_blind'),('table','individual')],10):accept(i,{'version':1,'speed':speed,'ante':ante})
 assert run('exact-separated',"SELECT count(*)||':'||sum(observed_hands) FROM horse_exact_profiles;")=='8:8'
 accept(20,{'ante':'none','speed':'table','version':1})
 assert run('repeat-domain',"SELECT observed_hands FROM horse_exact_profiles WHERE user_id='actor' AND public_memory_domain->>'speed'='table' AND public_memory_domain->>'ante'='none';")=='2'
 run('duplicate-accepted-hand', "DO $$ BEGIN BEGIN INSERT INTO hand_history SELECT * FROM hand_history WHERE hand_number=10; RAISE EXCEPTION 'duplicate unexpectedly accepted'; EXCEPTION WHEN unique_violation THEN NULL; END; IF (SELECT sum(observed_hands) FROM horse_exact_profiles)<>10 THEN RAISE EXCEPTION 'duplicate changed counters'; END IF; END $$;")
 assert run('read-exact',"SET ROLE service_role; SELECT count(*) FROM fn_horse_exact_profiles_read(ARRAY['actor'],'plo4','cash','full','lightning','none');")=='1'
 assert run('deny-grants',"SELECT has_function_privilege('anon','fn_horse_exact_profiles_read(text[],text,text,text,text,text)','EXECUTE') OR has_table_privilege('service_role','horse_exact_profiles','INSERT');")=='f'
 assert run('private-invariance',"SELECT fn_horse_exploit_increments('[{\"userId\":\"a\",\"action\":\"check\",\"stage\":\"river\",\"holeCards\":[\"As\",\"Ah\"]}]')=fn_horse_exploit_increments('[{\"userId\":\"a\",\"action\":\"check\",\"stage\":\"river\"}]');")=='t'
 (a.output/'result.json').write_text(json.dumps({'passed':True,'scope':'isolated original insert, legacy trigger, exact learner, saved read, permissions and private-card invariance; no production installation'},indent=2))
 print('PASS isolated exact public memory compatibility')
finally:
 if started:command([pg/'pg_ctl','-D',cluster/'data','-m','immediate','-w','stop'])
 if (cluster/'server.log').exists():shutil.copy2(cluster/'server.log',a.output/'postgres.log')
 shutil.rmtree(cluster)
