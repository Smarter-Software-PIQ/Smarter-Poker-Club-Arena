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
 atomic=(ROOT/'supabase/migrations/20260908042100_an_accepted_hand_is_one_commit_and_stats_leave_the_hot_path.sql').read_text()
 atomic=atomic[atomic.index('CREATE TABLE IF NOT EXISTS public.hand_atomic_commits'):atomic.index('ALTER TABLE public.hand_projection_outbox ENABLE ROW LEVEL SECURITY')]
 run('receipt-fixture',atomic+"ALTER TABLE hand_atomic_commits ENABLE ROW LEVEL SECURITY; REVOKE ALL ON hand_atomic_commits FROM PUBLIC,anon,authenticated,service_role; GRANT SELECT ON hand_atomic_commits TO service_role;")
 run('install',(ROOT/'supabase/migrations/20261106091733_horse_public_memory_exact_rule_domains.sql').read_text())
 actions=[{'userId':'actor','action':'raise','stage':'preflop'},{'userId':'villain','action':'fold','stage':'preflop'}]
 def accept(n,domain=None,receipt=True):
  row={'table_id':'00000000-0000-4000-8000-000000000001','hand_number':1000000+n,'game_variant':'plo4','horse_exploit_dealt_count':6,'players':[],'actions':actions}
  if domain is not None:row['public_memory_domain']=domain
  sql="SELECT fn_ca_insert_hand_with_awards('"+json.dumps(row)+"'::jsonb);"
  if receipt:sql="BEGIN; "+sql+"INSERT INTO hand_atomic_commits(table_id,hand_number,hand_id,payload_hash,stack_result) SELECT table_id,hand_number,id,repeat('a',64),'{}' FROM hand_history WHERE hand_number="+str(1000000+n)+"; COMMIT;"
  return run('accept-'+str(n),sql)
 for i,d in enumerate([None,7,[],{}, {'version':2,'speed':'table','ante':'none'}],1):accept(i,d)
 assert run('unknown-skip',"SELECT count(*) FROM horse_exact_profiles;")=='0'
 assert run('legacy-retained',"SELECT sum(observed_hands) FROM horse_exploit_profiles;")=='10'
 accept(9,{'version':1,'speed':'table','ante':'none'},receipt=False)
 assert run('manual-history-not-accepted',"SELECT count(*) FROM horse_exact_profiles;")=='0'
 assert run('receipt-service-insert-denied',"SELECT has_table_privilege('service_role','hand_atomic_commits','INSERT');")=='f'
 for i,(speed,ante) in enumerate([('table','none'),('lightning','none'),('table','big_blind'),('table','individual')],10):accept(i,{'version':1,'speed':speed,'ante':ante})
 assert run('exact-separated',"SELECT count(*)||':'||sum(observed_hands) FROM horse_exact_profiles;")=='8:8'
 accept(20,{'ante':'none','speed':'table','version':1})
 assert run('repeat-domain',"SELECT observed_hands FROM horse_exact_profiles WHERE user_id='actor' AND public_memory_domain->>'speed'='table' AND public_memory_domain->>'ante'='none';")=='2'
 run('duplicate-accepted-hand', "DO $$ BEGIN BEGIN INSERT INTO hand_history SELECT * FROM hand_history WHERE hand_number=1000010; RAISE EXCEPTION 'duplicate unexpectedly accepted'; EXCEPTION WHEN unique_violation THEN NULL; END; IF (SELECT sum(observed_hands) FROM horse_exact_profiles)<>10 THEN RAISE EXCEPTION 'duplicate changed counters'; END IF; END $$;")
 run('duplicate-receipt', "DO $$ BEGIN BEGIN INSERT INTO hand_atomic_commits SELECT * FROM hand_atomic_commits WHERE hand_number=1000010; RAISE EXCEPTION 'duplicate unexpectedly accepted'; EXCEPTION WHEN unique_violation THEN NULL; END; IF (SELECT sum(observed_hands) FROM horse_exact_profiles)<>10 THEN RAISE EXCEPTION 'duplicate receipt changed counters'; END IF; END $$;")
 run('receipt-update-no-relearn', "UPDATE hand_atomic_commits SET stack_result=stack_result||'{\"completion\":true}'::jsonb WHERE hand_number=1000010;")
 assert run('update-unchanged',"SELECT sum(observed_hands) FROM horse_exact_profiles;")=='10'
 run('rollback-receipt', "BEGIN; INSERT INTO hand_atomic_commits(table_id,hand_number,hand_id,payload_hash,stack_result) SELECT table_id,hand_number,id,repeat('a',64),'{}' FROM hand_history WHERE hand_number=1000009; ROLLBACK;")
 assert run('rollback-unchanged',"SELECT sum(observed_hands) FROM horse_exact_profiles;")=='10'
 run('mismatched-receipt', "INSERT INTO hand_atomic_commits(table_id,hand_number,hand_id,payload_hash,stack_result) SELECT table_id,1000099,id,repeat('a',64),'{}' FROM hand_history WHERE hand_number=1000009;")
 assert run('mismatch-unchanged',"SELECT sum(observed_hands) FROM horse_exact_profiles;")=='10'
 assert run('read-exact',"SET ROLE service_role; SELECT count(*) FROM fn_horse_exact_profiles_read(ARRAY['actor'],'plo4','cash','full','lightning','none');")=='1'
 assert run('deny-grants',"SELECT has_function_privilege('anon','fn_horse_exact_profiles_read(text[],text,text,text,text,text)','EXECUTE') OR has_table_privilege('service_role','horse_exact_profiles','INSERT');")=='f'
 assert run('private-invariance',"SELECT fn_horse_exploit_increments('[{\"userId\":\"a\",\"action\":\"check\",\"stage\":\"river\",\"holeCards\":[\"As\",\"Ah\"]}]')=fn_horse_exploit_increments('[{\"userId\":\"a\",\"action\":\"check\",\"stage\":\"river\"}]');")=='t'
 # Install the current cold reader before verifying both historical and exact adapters.
 bounded=(ROOT/'supabase/migrations/20261024023547_horse_opponent_bounded_original_request_reads.sql').read_text()
 run('bounded-fixture',bounded[bounded.index('CREATE OR REPLACE FUNCTION'):bounded.index('REVOKE ALL ON FUNCTION')])
 human='00000000-0000-4000-8000-000000000002'
 horse='00000000-0000-4000-8000-000000000003'
 run('roster-fixture',"CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_horse boolean); INSERT INTO profiles VALUES ('"+human+"',false),('"+horse+"',true); ALTER TABLE hand_history ADD COLUMN created_at timestamptz DEFAULT now();")
 domain={'version':1,'speed':'table','ante':'none'}
 actions=[{'userId':horse,'stage':'preflop','action':'raise','origin':'horse_policy'},{'userId':human,'stage':'preflop','action':'fold','origin':'forced'}]
 accept(30,domain)
 corrective=(ROOT/'supabase/migrations/20261107160549_horse_memory_excludes_forced_folds.sql').read_text()
 run('install-fold-provenance',corrective)
 assert run('epoch-archive',"SELECT count(*) FROM horse_memory_before_fold_provenance WHERE profile->>'user_id'='"+human+"';")=='2'
 assert run('epoch-isolated',"SELECT count(*) FROM horse_exact_profiles WHERE user_id='"+horse+"';")=='1'
 assert run('untrusted-read-denied',"SELECT has_table_privilege('service_role','horse_memory_before_fold_provenance','SELECT');")=='f'
 accept(31,domain)
 assert run('forced-only-skipped',"SELECT count(*) FROM horse_exact_profiles WHERE user_id='"+human+"';")=='0'
 actions.insert(0,{'userId':human,'action':'raise','stage':'preflop','origin':'player'})
 accept(32,domain)
 assert run('mixed-hand',"SELECT observed_hands||':'||(counters->>'pfr')||':'||(counters->>'foldTo3BetOpp') FROM horse_exact_profiles WHERE user_id='"+human+"';")=='1:1:0'
 run('repeat-cutoff',corrective)
 assert run('repeat-preserves-clean',"SELECT observed_hands FROM horse_exact_profiles WHERE user_id='"+human+"';")=='1'
 for origin,expected in [(None,False),('unknown',False),('horse_fallback',False),('forced',False),('pre_action',True),('player',True),('horse_policy',True)]:
  act={'userId':human,'action':'fold','stage':'river'}
  if origin is not None:act['origin']=origin
  data="'"+json.dumps([act])+"'::jsonb"
  assert run('reducer-'+str(origin),"SELECT (fn_horse_exploit_increments("+data+") ? '"+human+"')::int||':'||(fn_horse_exploit_increments("+data+",'"+human+"') ? '"+human+"')::int;")==('1:1' if expected else '0:0')
 # Two original legacy rows, one authenticated fold and one later forced fold.
 # Native BEFORE/AFTER triggers are disabled only in this isolated fixture to
 # represent rows predating the original durable-memory installation.
 cold='00000000-0000-4000-8000-000000000004'
 seed="ALTER TABLE hand_history DISABLE TRIGGER USER;"
 for stamp,origin in [('2026-10-01','pre_action'),('2026-10-02','forced')]:
  roster=json.dumps([{'userId':cold},{'userId':horse}])
  actions_json=json.dumps([{'userId':cold,'stage':'preflop','action':'fold','origin':origin}])
  seed+="INSERT INTO hand_history(created_at,players,actions,game_variant) VALUES ('"+stamp+"','"+roster+"','"+actions_json+"','nlh');"
 run('cold-fixture',seed+"ALTER TABLE hand_history ENABLE TRIGGER USER;")
 assert run('cold-no-phantom-decay',"SELECT legacy_hands||':'||(counters->>'hands')::numeric FROM fn_horse_exploit_profiles_read(ARRAY['"+cold+"'],'nlh','cash','hu');")=='1:1'
 (a.output/'result.json').write_text(json.dumps({'passed':True,'scope':'isolated original history insert, protected accepted receipt, legacy compatibility, manual-insert refusal, receipt identity/duplicate/update/rollback, saved read, permissions and private-card invariance, fold provenance and archived human epoch, mixed hands, filtered cold history and rerun idempotence; no production installation'},indent=2))
 print('PASS isolated exact public memory compatibility')
finally:
 if started:command([pg/'pg_ctl','-D',cluster/'data','-m','immediate','-w','stop'])
 if (cluster/'server.log').exists():shutil.copy2(cluster/'server.log',a.output/'postgres.log')
 shutil.rmtree(cluster)
