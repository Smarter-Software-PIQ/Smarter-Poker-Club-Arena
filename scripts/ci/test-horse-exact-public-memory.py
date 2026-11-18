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
 showdown_rows=None; board_cards=None; board_cards2=None
 def accept(n,domain=None,receipt=True,tournament=None):
  row={'table_id':'00000000-0000-4000-8000-000000000001','hand_number':1000000+n,'game_variant':'plo4','horse_exploit_dealt_count':6,'players':[],'actions':actions}
  if domain is not None:row['public_memory_domain']=domain
  if showdown_rows is not None:row['showdown']=showdown_rows
  if board_cards is not None:row['community_cards']=board_cards
  if board_cards2 is not None:row['community_cards2']=board_cards2
  if tournament is not None:row['tournament_id']=tournament
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
 # The ordinary read RPC may precede either daily-maintenance column.
 run('install-saved-presence',(ROOT/'supabase/migrations/20261115011318_horse_saved_profile_presence_at_original_deal.sql').read_text())
 presence_fixture=(ROOT/'scripts/ci/fixtures/horse-saved-profile-presence.sql').read_text()
 run('saved-presence-no-columns',presence_fixture)
 # Clone the actual pre-lineage state for the independently scheduled reverse install.
 run('reverse-install-fixture','CREATE DATABASE long_first TEMPLATE postgres;')
 lineage=(ROOT/'supabase/migrations/20261115010037_bind_horse_exact_profiles_to_their_accepted_hand.sql').read_text()
 lineage_proof=next(line.removeprefix('-- @live-proof: ') for line in lineage.splitlines() if line.startswith('-- @live-proof: '))
 assert run('lineage-proof-before-install','SELECT '+lineage_proof)=='f'
 run('install-accepted-lineage',lineage)
 assert run('lineage-live-proof','SELECT '+lineage_proof)=='t'
 run('saved-presence-lineage-only',presence_fixture)
 assert run('legacy-lineage-unknown',"SELECT count(*) FROM horse_exact_profiles WHERE last_accepted_hand_id IS NOT NULL;")=='0'
 legacy_projection="SELECT presence,exact_profile FROM fn_horse_saved_profile_presence(ARRAY['"+horse+"'],'plo4','cash','full','"+json.dumps(domain)+"')"
 assert run('saved-legacy-exact',"SET ROLE service_role; SELECT presence='exact' AND (exact_profile->>'observed_hands')::int>0 AND (exact_profile->'counters'->>'hands')::float>0 AND exact_profile->'last_accepted_hand_id'='null'::jsonb FROM ("+legacy_projection+") p;")=='t'
 actions.insert(0,{'userId':human,'action':'raise','stage':'preflop','origin':'player'})
 accept(32,domain)
 assert run('mixed-hand',"SELECT observed_hands||':'||(counters->>'pfr')||':'||(counters->>'foldTo3BetOpp') FROM horse_exact_profiles WHERE user_id='"+human+"';")=='1:1:0'
 assert run('first-lineage',"SELECT p.observed_hands||':'||(p.last_accepted_hand_id=h.id)::text FROM fn_horse_exact_profiles_read(ARRAY['"+human+"'],'plo4','cash','full','table','none') p CROSS JOIN hand_history h WHERE h.hand_number=1000032;")=='1:true'
 accepted_id=run('accepted-lineage-id',"SELECT id FROM hand_history WHERE hand_number=1000032;")
 projection="SELECT presence||':'||(exact_profile->>'observed_hands')||':'||(exact_profile->>'last_accepted_hand_id')||':'||(exact_profile->'counters'->>'pfr') FROM fn_horse_saved_profile_presence(ARRAY['"+human+"'],'plo4','cash','full','"+json.dumps(domain)+"');"
 assert run('saved-original-lineage',"SET ROLE service_role; "+projection)=='exact:1:'+accepted_id+':1'
 run('repeat-cutoff',corrective)
 assert run('repeat-preserves-clean',"SELECT observed_hands FROM horse_exact_profiles WHERE user_id='"+human+"';")=='1'
 for origin,expected in [(None,False),('unknown',False),('horse_fallback',False),('forced',False),('pre_action',True),('player',True),('horse_policy',True)]:
  act={'userId':human,'action':'fold','stage':'river'}
  if origin is not None:act['origin']=origin
  data="'"+json.dumps([act])+"'::jsonb"
  assert run('reducer-'+str(origin),"SELECT (fn_horse_exploit_increments("+data+") ? '"+human+"')::int||':'||(fn_horse_exploit_increments("+data+",'"+human+"') ? '"+human+"')::int;")==('1:1' if expected else '0:0')
 forced_check=json.dumps([{'userId':human,'action':'check','stage':'river','origin':'forced'}])
 assert run('forced-check-ignored',"SELECT fn_horse_exploit_increments('"+forced_check+"')='{}'::jsonb AND fn_horse_exploit_increments('"+forced_check+"','"+human+"')='{}'::jsonb;")=='t'
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
 # 2026-11-15 the long participation window: same learner, forward only, no back-fill.
 longmig=(ROOT/'supabase/migrations/20261115015341_the_exact_opponent_profile_keeps_a_long_participation_window.sql').read_text()
 snapshot="SELECT string_agg(user_id||':'||variant||':'||mode||':'||size||':'||public_memory_domain::text||':'||observed_hands||':'||counters::text,'|' ORDER BY user_id,variant,mode,size,public_memory_domain::text) FROM horse_exact_profiles;"
 before=run('long-before',snapshot)
 run('install-long',longmig)
 run('saved-presence-both-columns',presence_fixture)
 assert run('long-no-backfill',"SELECT count(*) FROM horse_exact_profiles WHERE long_counters IS NOT NULL;")=='0'
 assert run('long-rows-untouched',snapshot)==before
 assert run('long-add-private',"SELECT has_function_privilege('service_role','fn_horse_long_participation_add(jsonb,jsonb)','EXECUTE') OR has_function_privilege('anon','fn_horse_long_participation_add(jsonb,jsonb)','EXECUTE');")=='f'
 decay=0.5**(1/120); expected=[0.0,0.0,0.0]
 for i in range(12):
  act=['raise','call','fold'][i%3]
  actions=[{'userId':horse,'stage':'preflop','action':'raise','origin':'horse_policy'},{'userId':human,'stage':'preflop','action':act,'origin':'player'}]
  accept(40+i,domain)
  inc=[1,0 if act=='fold' else 1,1 if act=='raise' else 0]
  expected=[expected[k]*decay+inc[k] for k in range(3)]
 long_of="SELECT (long_counters->>'lHands')||','||(long_counters->>'lVpip')||','||(long_counters->>'lPfr')||','||(SELECT count(*) FROM jsonb_object_keys(counters)) FROM horse_exact_profiles WHERE user_id='"+human+"';"
 got=run('long-learned',long_of); vals=[float(x) for x in got.split(',')]
 assert all(abs(vals[k]-expected[k])<1e-12 for k in range(3)) and vals[3]==27, (got,expected)
 actions=[{'userId':horse,'stage':'preflop','action':'raise','origin':'horse_policy'},{'userId':human,'stage':'preflop','action':'fold','origin':'unknown'}]
 accept(60,domain)
 assert run('long-unattributed-fold-not-learned',long_of)==got
 actions=[{'userId':horse,'stage':'preflop','action':'raise','origin':'horse_policy'},{'userId':human,'stage':'preflop','action':'fold','origin':'forced'}]
 accept(61,domain)
 assert run('long-forced-fold-not-learned',long_of)==got
 newcomer='00000000-0000-4000-8000-000000000005'
 actions=[{'userId':newcomer,'stage':'preflop','action':'raise','origin':'player'}]
 accept(62,domain)
 assert run('long-new-row',"SELECT long_counters::text FROM horse_exact_profiles WHERE user_id='"+newcomer+"';")=='{"lPfr": 1, "lVpip": 1, "lHands": 1}'
 run('repeat-long',longmig)
 assert run('long-repeat-unchanged',long_of)==got
 assert run('long-read',"SET ROLE service_role; SELECT (long_counters->>'lHands')::text FROM fn_horse_exact_profiles_read(ARRAY['"+human+"'],'plo4','cash','full','table','none');")==got.split(',')[0]
 # Compare both installed trigger definitions, then exercise a preexisting
 # long-window row and a new row through the protected receipt in reverse order.
 trigger_def="SELECT pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure);"
 forward=run('lineage-then-long-definition',trigger_def)
 psql[-1]='long_first'
 run('reverse-install-long',longmig)
 run('saved-presence-long-only',presence_fixture)
 actions=[{'userId':human,'stage':'preflop','action':'raise','origin':'player'}]
 accept(130,domain)
 prior=run('reverse-prior-long',long_of)
 run('reverse-install-lineage',lineage)
 assert run('reverse-lineage-live-proof','SELECT '+lineage_proof)=='t'
 assert run('long-then-lineage-definition',trigger_def)==forward
 assert run('reverse-preserves-long',long_of)==prior
 assert run('reverse-no-lineage-backfill',"SELECT count(*) FROM horse_exact_profiles WHERE last_accepted_hand_id IS NOT NULL;")=='0'
 actions.append({'userId':newcomer,'stage':'preflop','action':'call','origin':'player'})
 accept(131,domain)
 state_sql="SELECT user_id,observed_hands,last_accepted_hand_id,long_counters FROM horse_exact_profiles WHERE user_id IN ('"+human+"','"+newcomer+"') ORDER BY user_id;"
 learned=run('reverse-accepted-state',state_sql)
 assert run('reverse-binds-insert-and-update',f"""
   SELECT count(*) FROM horse_exact_profiles p JOIN hand_history h ON h.id=p.last_accepted_hand_id
    WHERE h.hand_number=1000131 AND (
      (p.user_id='{human}' AND observed_hands=2
       AND abs((long_counters->>'lHands')::float8-(1+power(0.5::float8,1.0/120)))<1e-12)
      OR (p.user_id='{newcomer}' AND observed_hands=1
          AND long_counters=jsonb_build_object('lHands',1,'lVpip',1,'lPfr',0)));
 """)=='2'
 actions=[{'userId':human,'stage':'preflop','action':'fold','origin':'forced'}]
 accept(132,domain)
 assert run('reverse-forced-preserves-lineage-and-long',state_sql)==learned
 # 2026-11-15 the durable shown river record (20261115144258): the same learner, forward only, no back-fill.
 rivermig=(ROOT/'supabase/migrations/20261115144258_the_exact_opponent_profile_remembers_shown_river_strength.sql').read_text()
 river_proof=next(line.removeprefix('-- @live-proof: ') for line in rivermig.splitlines() if line.startswith('-- @live-proof: '))
 river_snapshot="SELECT string_agg(user_id||':'||variant||':'||mode||':'||size||':'||public_memory_domain::text||':'||observed_hands||':'||counters::text||':'||coalesce(long_counters::text,'-')||':'||coalesce(last_accepted_hand_id::text,'-'),'|' ORDER BY user_id,variant,mode,size,public_memory_domain::text) FROM horse_exact_profiles;"
 def first_river_buckets(acts):
  # The engine's HorseOpponentStyle.riverFirstBetFractions and sizeBucketOf, ported line by line.
  out={}; street={}; pot=0.0; stage=None; fresh=True
  for a in acts:
   if not isinstance(a,dict): continue
   st=a.get('stage')
   if fresh or st!=stage: stage=st; fresh=False; street={}
   uid=a.get('userId') if isinstance(a.get('userId'),str) else None
   sid=uid or ''
   prev=street.get(sid,0.0)
   amt=a.get('amount'); amt=max(0.0,float(amt)) if isinstance(amt,(int,float)) and not isinstance(amt,bool) else 0.0
   act=a.get('action'); wager=act in ('bet','raise','all_in')
   inc=0.0 if act in ('fold','check') else (max(0.0,amt-prev) if wager else amt)
   if stage=='river' and uid and wager and inc>0 and pot>0 and uid not in out:
    f=inc/pot; out[uid]='small' if f<0.5 else 'medium' if f<0.66 else 'large' if f<=1 else 'overbet'
   pot+=inc; street[sid]=prev+inc
  return out
 STRONG={'two pair','three of a kind','straight','flush','full house','four of a kind','straight flush','royal flush'}
 def river_increments(acts,showdown):
  res={}
  for uid,b in first_river_buckets(acts).items():
   sd=next((e for e in (showdown if isinstance(showdown,list) else []) if isinstance(e,dict) and isinstance(e.get('user_id'),str) and e['user_id']==uid),None)
   shown=0 if sd is None else 1
   strong=1 if sd is not None and sd.get('mucked') is not True and isinstance(sd.get('hand_name'),str) and sd['hand_name'].lower() in STRONG else 0
   res[uid]={'b':b,'shown':shown,'strong':strong}
  return res
 RIVER_DECAY=0.5**(1/40)
 def river_add(base,delta,at):
  if delta is None: return base
  f=RIVER_DECAY if delta['shown']>0 else 1.0
  buckets={}
  for k in ['small','medium','large','overbet']:
   cell=(base or {}).get('buckets',{}).get(k); here=delta['b']==k
   if cell is None and not here: continue
   buckets[k]={'bets':(cell['bets']*f if cell else 0)+(1 if here else 0),'shown':(cell['shown']*f if cell else 0)+(delta['shown'] if here else 0),'strong':(cell['strong']*f if cell else 0)+(delta['strong'] if here else 0)}
  return {'since':base['since'] if base else at,'buckets':buckets}
 def close(x,y):
  if x is None or y is None: return x is y
  if x['since']!=y['since'] or set(x['buckets'])!=set(y['buckets']): return False
  return all(abs(x['buckets'][k][f]-y['buckets'][k][f])<1e-12 for k in x['buckets'] for f in ('bets','shown','strong'))
 # Install in each database: first without the public showdown column (refused, rolled back), then with it.
 for db in ['postgres','long_first']:
  psql[-1]=db
  assert run('river-proof-before-'+db,'SELECT '+river_proof)=='f'
  before=run('river-before-'+db,river_snapshot)
  try:
   run('river-install-no-showdown-'+db,rivermig); raise AssertionError('installed without hand_history.showdown')
  except RuntimeError as e: assert 'needs hand_history.showdown' in str(e),str(e)
  assert run('river-refusal-rolled-back-'+db,"SELECT count(*) FROM pg_attribute WHERE attrelid='horse_exact_profiles'::regclass AND attname='shown_river';")=='0'
  run('river-showdown-fixture-'+db,"ALTER TABLE hand_history ADD COLUMN showdown jsonb;")
  run('river-install-'+db,rivermig)
  assert run('river-proof-'+db,'SELECT '+river_proof)=='t'
  assert run('river-no-backfill-'+db,"SELECT count(*) FROM horse_exact_profiles WHERE shown_river IS NOT NULL;")=='0'
  assert run('river-rows-untouched-'+db,river_snapshot)==before
  assert run('river-private-'+db,"SELECT has_function_privilege('service_role','fn_horse_shown_river_add(jsonb,jsonb,bigint)','EXECUTE') OR has_function_privilege('anon','fn_horse_shown_river_increments(jsonb,jsonb)','EXECUTE') OR has_function_privilege('service_role','fn_horse_shown_river_increments(jsonb,jsonb)','EXECUTE');")=='f'
  run('river-saved-presence-'+db,presence_fixture)
 psql[-1]='long_first'; reverse_def=run('river-long-first-definition',trigger_def)
 psql[-1]='postgres'; forward_def=run('river-lineage-first-definition',trigger_def)
 assert reverse_def==forward_def
 # The fixed vectors HorseLongShownMemory.test.ts pins for the engine twin: the SQL gives the same increments.
 vectors=json.loads((ROOT/'scripts/ci/fixtures/horse-shown-river-vectors.json').read_text())
 for i,v in enumerate(vectors):
  got=json.loads(run('river-vector-'+str(i),"SELECT fn_horse_shown_river_increments('"+json.dumps(v['actions']).replace("'","''")+"'::jsonb,'"+json.dumps(v['showdown']).replace("'","''")+"'::jsonb)::text;"))
  assert got==v['expected']==river_increments(v['actions'],v['showdown']),(i,got,v['expected'])
 # Random public action logs: the SQL replay and the line-by-line port agree exactly.
 import random
 rng=random.Random(20261115); ids=['00000000-0000-4000-8000-0000000000a'+str(k) for k in range(4)]
 cases=[]
 for n in range(300):
  acts=[]
  for stg in ['preflop','flop','turn','river'][:rng.choice([1,2,3,4,4,4])]:
   for _ in range(rng.randint(1,7)):
    act={'userId':rng.choice(ids),'stage':stg,'action':rng.choice(['bet','raise','all_in','call','check','fold','post_blind'])}
    if rng.random()<0.9:act['amount']=rng.choice([0,1,2,3,4.5,6,8,10,12.25,20,35,50,80,120])
    acts.append(act)
  sd=[{'user_id':u,'mucked':rng.random()<0.25,**({'hand_name':rng.choice(['High Card','One Pair','Two Pair','Flush','Full House','Straight'])} if rng.random()<0.9 else {})} for u in ids if rng.random()<0.4]
  cases.append((acts,sd))
 values=",".join("("+str(k)+",'"+json.dumps(x).replace("'","''")+"'::jsonb,'"+json.dumps(y).replace("'","''")+"'::jsonb)" for k,(x,y) in enumerate(cases))
 out=run('river-random',"SELECT string_agg(fn_horse_shown_river_increments(a,s)::text,E'\\n' ORDER BY k) FROM (VALUES "+values+") v(k,a,s);").split('\n')
 assert len(out)==len(cases)
 nonempty=0
 for k,(acts,sd) in enumerate(cases):
  expected=river_increments(acts,sd); nonempty+=bool(expected)
  assert json.loads(out[k])==expected,(k,out[k],expected)
 assert nonempty>=100,nonempty
 # The add rule against its port, through a chain of hands, to 1e-12.
 chain=None; sql_chain='NULL::jsonb'
 for k in range(60):
  d={'b':rng.choice(['small','medium','large','overbet']),'shown':1 if rng.random()<0.6 else 0}; d['strong']=1 if d['shown'] and rng.random()<0.7 else 0
  chain=river_add(chain,d,1700000000000+k)
  sql_chain="fn_horse_shown_river_add("+sql_chain+",'"+json.dumps(d)+"'::jsonb,"+str(1700000000000+k)+")"
  if k%10==9:
   got=json.loads(run('river-add-'+str(k),"SELECT "+sql_chain+"::text;")); sql_chain="'"+json.dumps(got)+"'::jsonb"
   assert close(got,chain),(k,got,chain)
 assert run('river-add-no-delta',"SELECT fn_horse_shown_river_add('{\"since\":5,\"buckets\":{\"large\":{\"bets\":2,\"shown\":1,\"strong\":1}}}'::jsonb,NULL,9)::text;")=='{"since": 5, "buckets": {"large": {"bets": 2, "shown": 1, "strong": 1}}}'
 assert run('river-add-null-base',"SELECT fn_horse_shown_river_add(NULL,NULL,9) IS NULL;")=='t'
 # Learning through the protected accepted receipt (postgres database, the forward install order).
 bettor='00000000-0000-4000-8000-000000000006'; caller='00000000-0000-4000-8000-000000000007'
 record_of=lambda mode='cash': "SELECT coalesce(shown_river::text,'null') FROM horse_exact_profiles WHERE user_id='"+bettor+"' AND mode='"+mode+"';"
 def river_hand(size,showdown_entry,origin='player'):
  global actions,showdown_rows
  acts=[{'userId':bettor,'stage':'preflop','action':'raise','amount':6,'origin':'player'},{'userId':caller,'stage':'preflop','action':'call','amount':6,'origin':'player'},
        {'userId':bettor,'stage':'river','action':'bet','amount':size,'origin':origin},{'userId':caller,'stage':'river','action':'call','amount':size,'origin':'player'}]
  actions=acts; showdown_rows=[showdown_entry] if showdown_entry else None
  return acts
 expected=None; shown_count=0
 plan=[(9,{'user_id':bettor,'mucked':False,'hand_name':'Two Pair'})]*5+[(9,None),(6,{'user_id':bettor,'mucked':False,'hand_name':'Flush'}),(3,{'user_id':bettor,'mucked':True}),(20,{'user_id':bettor,'mucked':False,'hand_name':'One Pair'})]
 for k,(size,sd) in enumerate(plan):
  acts=river_hand(size,sd)
  t0=int(run('river-clock-'+str(k),"SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint;"))
  accept(200+k,domain)
  got=json.loads(run('river-learned-'+str(k),record_of()))
  inc=river_increments(acts,showdown_rows)[bettor]
  expected=river_add(expected,inc,got['since'] if expected is None else None)
  # since: the accept time of the first river first bet, then kept
  assert (k>0 or got['since']>=t0) and close(got,expected),(k,got,expected)
 since=expected['since']
 assert set(expected['buckets'])=={'small','medium','large','overbet'}
 assert abs(expected['buckets']['large']['shown']-(sum(RIVER_DECAY**j for j in range(3,8))))<1e-12  # five shown large bets, then three later shown bets aged them
 # The caller never bet the river: his row learns the hand and holds no record.
 assert run('river-caller-no-record',"SELECT count(*) FROM horse_exact_profiles WHERE user_id='"+caller+"' AND shown_river IS NULL;")=='1'
 learned=run('river-learned-state',record_of())
 # The record learns exactly the hands its row learns: a hand the reducer does not learn for him (a forced fold
 # only) touches neither his counters nor his record.
 counters_of="SELECT observed_hands||':'||coalesce(shown_river::text,'null') FROM horse_exact_profiles WHERE user_id='"+bettor+"' AND mode='cash';"
 row_before=run('river-row-before-forced',counters_of)
 actions=[{'userId':bettor,'stage':'preflop','action':'fold','origin':'forced'}]; showdown_rows=None
 accept(230,domain)
 assert run('river-forced-not-learned',counters_of)==row_before
 # Tournament evidence stays in the tournament row; the cash record is unchanged.
 tour_row="SELECT shown_river->'buckets'->'large'->>'shown' FROM horse_exact_profiles WHERE user_id='"+bettor+"' AND mode='tournament';"
 river_hand(9,{'user_id':bettor,'mucked':False,'hand_name':'Straight'})
 accept(231,domain,tournament='00000000-0000-4000-8000-0000000000f1')
 assert run('river-tournament-row',tour_row)=='1'
 assert run('river-cash-untouched-by-tournament',record_of())==learned
 # A hand with no river bet leaves the record exactly as it was (no ageing).
 actions=[{'userId':bettor,'stage':'preflop','action':'raise','amount':6,'origin':'player'},{'userId':caller,'stage':'preflop','action':'fold','origin':'player'}]; showdown_rows=None
 accept(232,domain)
 assert run('river-no-bet-unchanged',record_of())==learned
 # Rerun idempotence and the read the engine uses.
 run('repeat-river',rivermig)
 assert run('river-repeat-definition',trigger_def)==forward_def
 assert run('river-repeat-unchanged',record_of())==learned
 assert json.loads(run('river-read',"SET ROLE service_role; SELECT shown_river::text FROM fn_horse_exact_profiles_read(ARRAY['"+bettor+"'],'plo4','cash','full','table','none');"))['since']==since
 # 2026-11-17 the postflop read by street and flop texture (20261117175407): the same learner, forward only, no
 # back-fill. The engine reducer (HorseOmahaStreetRead) and the SQL reducer are compared on the same hands: the
 # fixture's `expected` is what the engine computes (HorseOmahaStreetReadVectors.test.ts pins that side).
 streetmig=(ROOT/'supabase/migrations/20261117175407_the_exact_opponent_profile_keeps_a_postflop_read_by_street_a.sql').read_text()
 street_proof=next(line.removeprefix('-- @live-proof: ') for line in streetmig.splitlines() if line.startswith('-- @live-proof: '))
 street_snapshot="SELECT string_agg(user_id||':'||variant||':'||mode||':'||size||':'||public_memory_domain::text||':'||observed_hands||':'||counters::text||':'||coalesce(long_counters::text,'-')||':'||coalesce(last_accepted_hand_id::text,'-')||':'||coalesce(shown_river::text,'-'),'|' ORDER BY user_id,variant,mode,size,public_memory_domain::text) FROM horse_exact_profiles;"
 STREETS=['flop','turn','river']; TEXTURES=['paired','rainbow','twoTone','monotone']
 STREET_STATS=[('bet',STREETS),('foldToBet',STREETS),('foldToRaise',STREETS),('cbet',TEXTURES),('flopBet',TEXTURES)]
 CELLS=[(st,k) for st,keys in STREET_STATS for k in keys]
 def street_row(rec):
  # exactly the five statistics, each exactly its streets or textures, each cell exactly hit and opp
  assert list(sorted(rec))==sorted(st for st,_ in STREET_STATS),rec
  for st,keys in STREET_STATS:
   assert sorted(rec[st])==sorted(keys),rec
   for k in keys: assert sorted(rec[st][k])==['hit','opp'],rec
  return [rec[st][k][f] for st,k in CELLS for f in ('hit','opp')]
 def street_record(digits): return {st:{k:{'hit':int(digits[2*CELLS.index((st,k))]),'opp':int(digits[2*CELLS.index((st,k))+1])} for k in keys} for st,keys in STREET_STATS}
 def text_array(x): return 'NULL::text[]' if x is None else 'ARRAY['+','.join("'"+str(c).replace("'","''")+"'" for c in x)+']::text[]'
 def jsonb_literal(x): return "'"+json.dumps(x).replace("'","''")+"'::jsonb"
 def decode_log(log):
  out=[]
  for token in log.split(' '):
   if not token: continue
   uid,stage,action,origin,full=token.split(',')
   act={'stage':stage,'action':action}
   if uid!='-':act['userId']=uid
   if origin!='-':act['origin']=origin
   if full!='-':act['isFullRaise']=full=='1'
   out.append(act)
  return out
 # Install in each database: first without the public board columns (refused, rolled back), then with them.
 for db in ['postgres','long_first']:
  psql[-1]=db
  assert run('street-proof-before-'+db,'SELECT '+street_proof)=='f'
  before=run('street-before-'+db,street_snapshot)
  try:
   run('street-install-no-boards-'+db,streetmig); raise AssertionError('installed without hand_history.community_cards')
  except RuntimeError as e: assert 'needs hand_history.community_cards' in str(e),str(e)
  assert run('street-refusal-rolled-back-'+db,"SELECT count(*) FROM pg_attribute WHERE attrelid='horse_exact_profiles'::regclass AND attname='street_counters';")=='0'
  run('street-board-fixture-'+db,"ALTER TABLE hand_history ADD COLUMN community_cards text[] DEFAULT '{}', ADD COLUMN community_cards2 text[];")
  run('street-install-'+db,streetmig)
  assert run('street-proof-'+db,'SELECT '+street_proof)=='t'
  assert run('street-no-backfill-'+db,"SELECT count(*) FROM horse_exact_profiles WHERE street_counters IS NOT NULL;")=='0'
  assert run('street-rows-untouched-'+db,street_snapshot)==before
  assert run('street-private-'+db,"SELECT bool_or(has_function_privilege(r,f,'EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['fn_horse_flop_texture(text[],text[])','fn_horse_street_read_increments(jsonb,text[],text[])','fn_horse_street_read_add(jsonb,jsonb)']) f;")=='f'
  run('street-saved-presence-'+db,presence_fixture)
 psql[-1]='long_first'; street_reverse_def=run('street-long-first-definition',trigger_def)
 psql[-1]='postgres'; street_forward_def=run('street-lineage-first-definition',trigger_def)
 assert street_reverse_def==street_forward_def
 # Public information only: the reducer is handed the action log and the board, never hole cards or the showdown.
 assert run('street-signature',"SELECT pg_get_function_identity_arguments('public.fn_horse_street_read_increments(jsonb,text[],text[])'::regprocedure);")=='p_actions jsonb, p_community_cards text[], p_community_cards2 text[]'
 assert 'showdown' not in street_forward_def.split('street_read_inc:=')[1].split(';')[0] and 'hole_cards' not in street_forward_def
 street_vectors=json.loads((ROOT/'scripts/ci/fixtures/horse-street-read-vectors.json').read_text())
 def sql_increments(got): return {uid:''.join(str(x) for x in street_row(rec)) for uid,rec in got.items()}
 for i,v in enumerate(street_vectors['named']):
  got=json.loads(run('street-vector-'+str(i),"SELECT fn_horse_street_read_increments("+jsonb_literal(v['actions'])+","+text_array(v['community_cards'])+","+text_array(v['community_cards2'])+")::text;"))
  assert sql_increments(got)==v['expected'],(v['name'],sql_increments(got),v['expected'])
 assert street_vectors['named'][0]['expected']==street_vectors['named'][1]['expected'] and any('holeCards' in a for a in street_vectors['named'][1]['actions'])
 # 240 seeded random public action logs: the SQL replay and the engine reducer agree exactly.
 cases=street_vectors['random']
 values=",".join("("+str(k)+","+jsonb_literal(decode_log(v['log']))+","+text_array(v['community_cards'])+","+text_array(v['community_cards2'])+")" for k,v in enumerate(cases))
 out=run('street-random',"SELECT string_agg(fn_horse_street_read_increments(a,c,c2)::text,E'\\n' ORDER BY k) FROM (VALUES "+values+") v(k,a,c,c2);").split('\n')
 assert len(out)==len(cases)>=200
 textured=0
 for k,v in enumerate(cases):
  got=sql_increments(json.loads(out[k])); textured+=any('1' in d[18:] for d in got.values())
  assert got==v['expected'],(k,got,v['expected'])
 assert textured>=60,textured
 # The add rule against the engine's, through a chain of 120 hands, to 1e-12.
 sql_chain='NULL::jsonb'; checkpoints={c['after']:c['row'] for c in street_vectors['chain']['checkpoints']}
 for k,digits in enumerate(street_vectors['chain']['steps'],1):
  sql_chain="fn_horse_street_read_add("+sql_chain+","+jsonb_literal(street_record(digits))+")"
  if k in checkpoints:
   raw=run('street-add-'+str(k),"SELECT coalesce("+sql_chain+"::text,'null');"); got=json.loads(raw); sql_chain=jsonb_literal(got) if got is not None else 'NULL::jsonb'
   want=checkpoints[k]
   assert (got is None)==(want is None),(k,got,want)
   if got is not None: assert all(abs(x-y)<1e-12 for x,y in zip(street_row(got),want)) and len(want)==34,(k,got,want)
 assert checkpoints[1] is None and checkpoints[120] is not None and max(checkpoints[120])>5
 assert run('street-add-null-delta',"SELECT fn_horse_street_read_add(NULL,NULL) IS NULL AND fn_horse_street_read_add('{\"x\":1}'::jsonb,NULL)='{\"x\":1}'::jsonb;")=='t'
 # A damaged stored record never raises inside the accepted hand: a cell that is not a number counts as 0.
 damaged=json.loads(run('street-add-damaged',"SELECT fn_horse_street_read_add('{\"bet\":{\"flop\":{\"hit\":\"x\",\"opp\":[1]},\"turn\":7},\"cbet\":\"y\"}'::jsonb,"+jsonb_literal(street_record('11'+'0'*32))+")::text;"))
 assert street_row(damaged)==[1,1]+[0]*32,damaged
 assert json.loads(run('street-add-scalar-base',"SELECT fn_horse_street_read_add('7'::jsonb,"+jsonb_literal(street_record('01'+'0'*32))+")::text;"))['bet']['flop']=={'hit':0,'opp':1}
 assert run('street-increments-not-array',"SELECT fn_horse_street_read_increments('{}'::jsonb,NULL,NULL)::text||fn_horse_street_read_increments(NULL,NULL,NULL)::text||fn_horse_street_read_increments('[1,null,\"x\",[],{}]'::jsonb,ARRAY[NULL,NULL,NULL]::text[],ARRAY[NULL]::text[])::text;")=='{}{}{}'
 # Learning through the protected accepted receipt (postgres database, the forward install order).
 raiser='00000000-0000-4000-8000-000000000008'; defender='00000000-0000-4000-8000-000000000009'
 street_of=lambda uid,mode='cash': "SELECT coalesce(street_counters::text,'null') FROM horse_exact_profiles WHERE user_id='"+uid+"' AND mode='"+mode+"';"
 def street_hand(flop_action,board,board2=None):
  global actions,showdown_rows,board_cards,board_cards2
  actions=[{'userId':raiser,'stage':'preflop','action':'raise','origin':'player'},{'userId':defender,'stage':'preflop','action':'call','origin':'player'},
           {'userId':defender,'stage':'flop','action':'check','origin':'player'},{'userId':raiser,'stage':'flop','action':flop_action,'origin':'player'}]
  if flop_action=='bet':actions.append({'userId':defender,'stage':'flop','action':'fold','origin':'player'})
  showdown_rows=None; board_cards=board; board_cards2=board2
 RAINBOW=['Kspades','8hearts','3clubs']; PAIRED_FLOP=['8spades','8hearts','Qclubs']
 plan=[('bet',RAINBOW,None),('bet',RAINBOW,None),('check',RAINBOW,None),('bet',PAIRED_FLOP,None),('bet',RAINBOW,['Qspades','Qhearts','2clubs']),('bet',RAINBOW,None)]
 for k,(flop_action,board,board2) in enumerate(plan):
  street_hand(flop_action,board,board2)
  prior={u:run('street-prior-'+str(k)+u[-1],street_of(u)) for u in (raiser,defender)}
  accept(300+k,domain)
  for u in (raiser,defender):
   # The accepted hand wrote exactly add(prior record, this hand's increments for him).
   want=run('street-want-'+str(k)+u[-1],"SELECT coalesce(fn_horse_street_read_add("+("NULL" if prior[u] in ('null','') else "'"+prior[u]+"'")+"::jsonb,fn_horse_street_read_increments("+jsonb_literal(actions)+","+text_array(board)+","+text_array(board2)+")->'"+u+"')::text,'null');")
   assert run('street-learned-'+str(k)+u[-1],street_of(u))==want!='null',(k,u,want)
 learned=json.loads(run('street-learned-state',street_of(raiser))); sd=0.5**(1/30)
 street_row(learned)
 # Six flops with no bet yet (five bet); the rainbow continuation bet saw four of them (three bet), the paired one
 # one, and the double-board hand taught the street cell and no texture cell.
 assert abs(learned['bet']['flop']['opp']-sum(sd**j for j in range(6)))<1e-12 and abs(learned['bet']['flop']['hit']-(sd**5+sd**4+sd**2+sd+1))<1e-12,learned
 assert abs(learned['cbet']['rainbow']['opp']-(sd**3+sd**2+sd+1))<1e-12 and abs(learned['cbet']['rainbow']['hit']-(sd**3+sd**2+1))<1e-12,learned
 assert learned['cbet']['paired']=={'hit':1,'opp':1} and learned['flopBet']['paired']=={'hit':1,'opp':1} and learned['cbet']['monotone']=={'hit':0,'opp':0},learned
 assert learned['flopBet']['rainbow']==learned['cbet']['rainbow'] and learned['foldToBet']['flop']=={'hit':0,'opp':0},learned
 folded=json.loads(run('street-defender-state',street_of(defender)))
 assert abs(folded['foldToBet']['flop']['opp']-sum(sd**j for j in range(5)))<1e-12 and folded['foldToBet']['flop']['hit']==folded['foldToBet']['flop']['opp'] and folded['cbet']['rainbow']=={'hit':0,'opp':0},folded
 learned_text=run('street-learned-text',street_of(raiser))
 # A hand the reducer does not learn for him (a forced fold only) touches neither his counters nor his record.
 street_counters_of="SELECT observed_hands||':'||coalesce(street_counters::text,'null') FROM horse_exact_profiles WHERE user_id='"+raiser+"' AND mode='cash';"
 row_before=run('street-row-before-forced',street_counters_of)
 actions=[{'userId':raiser,'stage':'flop','action':'fold','origin':'forced'}]; board_cards=RAINBOW; board_cards2=None
 accept(330,domain)
 assert run('street-forced-not-learned',street_counters_of)==row_before
 # A hand with no postflop opportunity for him leaves the record exactly as it was (no ageing); a new player whose
 # only hand ended preflop has a row and no record.
 preflop_only='00000000-0000-4000-8000-00000000000a'
 actions=[{'userId':raiser,'stage':'preflop','action':'raise','origin':'player'},{'userId':preflop_only,'stage':'preflop','action':'fold','origin':'player'}]; board_cards=[]
 accept(331,domain)
 assert run('street-preflop-unchanged',street_of(raiser))==learned_text
 assert run('street-preflop-only-null',"SELECT count(*) FROM horse_exact_profiles WHERE user_id='"+preflop_only+"' AND street_counters IS NULL AND observed_hands=1;")=='1'
 # Tournament evidence stays in the tournament row; the cash record is unchanged.
 street_hand('bet',PAIRED_FLOP)
 accept(332,domain,tournament='00000000-0000-4000-8000-0000000000f2')
 assert run('street-tournament-row',"SELECT street_counters->'cbet'->'paired'->>'opp' FROM horse_exact_profiles WHERE user_id='"+raiser+"' AND mode='tournament';")=='1'
 assert run('street-cash-untouched-by-tournament',street_of(raiser))==learned_text
 # The 27-key counters, the long window and the shown river record are written exactly as before.
 assert run('street-counters-shape',"SELECT (SELECT count(*) FROM jsonb_object_keys(counters))||':'||(long_counters IS NOT NULL)::text FROM horse_exact_profiles WHERE user_id='"+raiser+"' AND mode='cash';")=='27:true'
 # Rerun idempotence and the read the engine uses.
 run('repeat-street',streetmig)
 assert run('street-repeat-definition',trigger_def)==street_forward_def
 assert run('street-repeat-unchanged',street_of(raiser))==learned_text
 assert run('street-read',"SET ROLE service_role; SELECT street_counters::text FROM fn_horse_exact_profiles_read(ARRAY['"+raiser+"'],'plo4','cash','full','table','none');")==learned_text
 board_cards=None; board_cards2=None
 # 2026-11-18 how a re-raiser answers a raise of his own re-raise (20261118023000): the same learner, forward only,
 # no back-fill; public actions only. Engine twin: HorseOmahaReraiseResponse.
 rrmig=(ROOT/'supabase/migrations/20261118023000_exact_profile_keeps_reraiser_answers.sql').read_text()
 rr_proof=next(line.removeprefix('-- @live-proof: ') for line in rrmig.splitlines() if line.startswith('-- @live-proof: '))
 RR_NODES=['threeBetFacesFourBet','fourBetFacesFiveBet']; RR_FIELDS=['opp','fold','call','raise']
 def rr_row(rec):
  # exactly the two nodes, each exactly its four fields
  assert sorted(rec)==sorted(RR_NODES) and all(sorted(rec[n])==sorted(RR_FIELDS) for n in RR_NODES),rec
  return [rec[n][f] for n in RR_NODES for f in RR_FIELDS]
 def rr_record(digits): return {n:{f:int(digits[4*i+j]) for j,f in enumerate(RR_FIELDS)} for i,n in enumerate(RR_NODES)}
 rr_of=lambda uid,mode='cash': "SELECT coalesce(reraise_response::text,'null') FROM horse_exact_profiles WHERE user_id='"+uid+"' AND mode='"+mode+"';"
 rr_defs={}
 for db in ['long_first','postgres']:
  psql[-1]=db
  assert run('rr-proof-before-'+db,'SELECT '+rr_proof)=='f'
  rr_before=run('rr-before-'+db,"SELECT count(*)||':'||coalesce(md5(string_agg(user_id||variant||mode||size||counters::text||coalesce(street_counters::text,'-'),'|' ORDER BY user_id,variant,mode,size,public_memory_domain::text)),'-') FROM horse_exact_profiles;")
  run('rr-install-'+db,rrmig)
  assert run('rr-proof-'+db,'SELECT '+rr_proof)=='t'
  assert run('rr-no-backfill-'+db,"SELECT count(*) FROM horse_exact_profiles WHERE reraise_response IS NOT NULL;")=='0'
  assert run('rr-rows-untouched-'+db,"SELECT count(*)||':'||coalesce(md5(string_agg(user_id||variant||mode||size||counters::text||coalesce(street_counters::text,'-'),'|' ORDER BY user_id,variant,mode,size,public_memory_domain::text)),'-') FROM horse_exact_profiles;")==rr_before
  assert run('rr-private-'+db,"SELECT bool_or(has_function_privilege(r,f,'EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['fn_horse_reraise_response_increments(jsonb)','fn_horse_reraise_response_add(jsonb,jsonb)']) f;")=='f'
  rr_defs[db]=run('rr-definition-'+db,trigger_def)
  run('rr-repeat-'+db,rrmig)
  assert run('rr-repeat-definition-'+db,trigger_def)==rr_defs[db]
 assert rr_defs['long_first']==rr_defs['postgres']
 assert 'showdown' not in rr_defs['postgres'].split('reraise_response_inc:=')[1].split(';')[0] and 'h.actions' in rr_defs['postgres'].split('reraise_response_inc:=')[1].split(';')[0]
 rr_vectors=json.loads((ROOT/'scripts/ci/fixtures/horse-reraise-response-vectors.json').read_text())
 def rr_sql(got): return {uid:rr_row(rec) for uid,rec in got.items()}
 for i,v in enumerate(rr_vectors['named']):
  got=json.loads(run('rr-vector-'+str(i),"SELECT fn_horse_reraise_response_increments("+jsonb_literal(v['actions'])+")::text;"))
  assert rr_sql(got)==v['expected'],(v['name'],got,v['expected'])
 rr_cases=rr_vectors['random']
 rr_values=",".join("("+str(k)+","+jsonb_literal(decode_log(v['log']))+")" for k,v in enumerate(rr_cases))
 rr_out=run('rr-random',"SELECT string_agg(fn_horse_reraise_response_increments(a)::text,E'\\n' ORDER BY k) FROM (VALUES "+rr_values+") v(k,a);").split('\n')
 assert len(rr_out)==len(rr_cases)>=200
 rr_live=0
 for k,v in enumerate(rr_cases):
  got=rr_sql(json.loads(rr_out[k])); rr_live+=bool(got)
  assert got==v['expected'],(k,got,v['expected'])
 assert rr_live>=30,rr_live
 # The add rule against the engine's, through a chain of 120 hands, to 1e-12.
 rr_chain='NULL::jsonb'; rr_checkpoints={c['after']:c['row'] for c in rr_vectors['chain']['checkpoints']}
 for k,digits in enumerate(rr_vectors['chain']['steps'],1):
  rr_chain="fn_horse_reraise_response_add("+rr_chain+","+jsonb_literal(rr_record(digits))+")"
  if k in rr_checkpoints:
   raw=run('rr-add-'+str(k),"SELECT coalesce("+rr_chain+"::text,'null');"); got=json.loads(raw); rr_chain=jsonb_literal(got) if got is not None else 'NULL::jsonb'
   want=rr_checkpoints[k]
   assert (got is None)==(want is None),(k,got,want)
   if got is not None: assert all(abs(x-y)<1e-12 for x,y in zip(rr_row(got),want)) and len(want)==8,(k,got,want)
 assert len(rr_checkpoints)>=12
 assert run('rr-add-null-delta',"SELECT fn_horse_reraise_response_add(NULL,NULL) IS NULL AND fn_horse_reraise_response_add('{\"x\":1}'::jsonb,NULL)='{\"x\":1}'::jsonb;")=='t'
 # A damaged stored record never raises inside the accepted hand: a field that is not a number counts as 0.
 rr_damaged=json.loads(run('rr-add-damaged',"SELECT fn_horse_reraise_response_add('{\"threeBetFacesFourBet\":{\"opp\":\"x\",\"fold\":[1]},\"fourBetFacesFiveBet\":7}'::jsonb,"+jsonb_literal(rr_record('10100000'))+")::text;"))
 assert rr_row(rr_damaged)==[1,0,1,0,0,0,0,0],rr_damaged
 assert run('rr-increments-not-array',"SELECT fn_horse_reraise_response_increments('{}'::jsonb)::text||fn_horse_reraise_response_increments(NULL)::text||fn_horse_reraise_response_increments('[7,\"x\",null,{\"userId\":5}]'::jsonb)::text;")=='{}{}{}'
 # Learning through the protected accepted receipt.
 rr3='00000000-0000-4000-8000-00000000000b'; rr4='00000000-0000-4000-8000-00000000000c'
 pf=lambda uid,action: {'userId':uid,'stage':'preflop','action':action,'origin':'player'}
 rr_plan=[[pf(rr4,'raise'),pf(rr3,'raise'),pf(rr4,'raise'),pf(rr3,'call')],
          [pf(rr4,'raise'),pf(rr3,'raise'),pf(rr4,'raise'),pf(rr3,'fold')],
          [pf(rr4,'raise'),pf(rr3,'raise'),pf(rr4,'raise'),pf(rr3,'raise'),pf(rr4,'call')],
          [pf(rr4,'raise'),pf(rr3,'call')]]
 for k,hand in enumerate(rr_plan):
  actions=hand; showdown_rows=None
  prior={u:run('rr-prior-'+str(k)+u[-1],rr_of(u)) for u in (rr3,rr4)}
  accept(400+k,domain)
  for u in (rr3,rr4):
   want=run('rr-want-'+str(k)+u[-1],"SELECT coalesce(fn_horse_reraise_response_add("+("NULL" if prior[u] in ('null','') else "'"+prior[u]+"'")+"::jsonb,fn_horse_reraise_response_increments("+jsonb_literal(hand)+")->'"+u+"')::text,'null');")
   assert run('rr-learned-'+str(k)+u[-1],rr_of(u))==want,(k,u,want)
 rr_learned=json.loads(run('rr-learned-state',rr_of(rr3))); sd=0.5**(1/30)
 # Three 4-bets faced after his 3-bet (call, fold, raise); the fourth hand gave no opportunity and aged nothing.
 t3=rr_learned['threeBetFacesFourBet']
 assert abs(t3['opp']-(sd*sd+sd+1))<1e-12 and abs(t3['call']-sd*sd)<1e-12 and abs(t3['fold']-sd)<1e-12 and t3['raise']==1,rr_learned
 assert rr_learned['fourBetFacesFiveBet']=={'opp':0,'fold':0,'call':0,'raise':0},rr_learned
 rr4_state=json.loads(run('rr-fourbettor-state',rr_of(rr4)))
 assert rr4_state['fourBetFacesFiveBet']=={'opp':1,'fold':0,'call':1,'raise':0} and rr4_state['threeBetFacesFourBet']['opp']==0,rr4_state
 # Tournament evidence stays in the tournament row; the 27-key counters and the street record are written as before.
 actions=rr_plan[0]; rr_text=run('rr-text',rr_of(rr3))
 accept(410,domain,tournament='00000000-0000-4000-8000-0000000000f3')
 assert run('rr-tournament-row',"SELECT reraise_response->'threeBetFacesFourBet'->>'opp' FROM horse_exact_profiles WHERE user_id='"+rr3+"' AND mode='tournament';")=='1'
 assert run('rr-cash-untouched-by-tournament',rr_of(rr3))==rr_text
 assert run('rr-counters-shape',"SELECT (SELECT count(*) FROM jsonb_object_keys(counters))::text FROM horse_exact_profiles WHERE user_id='"+rr3+"' AND mode='cash';")=='27'
 assert run('rr-read',"SET ROLE service_role; SELECT reraise_response::text FROM fn_horse_exact_profiles_read(ARRAY['"+rr3+"'],'plo4','cash','full','table','none');")==rr_text
 (a.output/'result.json').write_text(json.dumps({'passed':True,'scope':'isolated original history insert, protected accepted receipt, legacy compatibility, manual-insert refusal, receipt identity/duplicate/update/rollback, saved read, permissions and private-card invariance, fold provenance and archived human epoch, mixed hands, filtered cold history and rerun idempotence; long participation window forward-only learning, no back-fill, unattributed and forced folds excluded, new row, rerun idempotence and saved read; both lineage/long install orders preserve the same learner and original accepted receipt; shown river record: SQL increments equal to the engine port on pinned vectors and 300 random public action logs, the 40-shown-bet half-life to 1e-12, refused without hand_history.showdown, forward-only learning with no back-fill, unattributed actor not learned, cash and tournament apart, a hand with no river bet leaves it unchanged, both install orders converge, rerun idempotence and saved read; street read: SQL increments equal to the engine reducer on pinned vectors (hole cards on the log change nothing) and 240 random public action logs with boards, the 30-opportunity half-life to 1e-12 through 120 hands, refused without hand_history.community_cards, forward-only learning with no back-fill, exact cell values through the accepted receipt, a double-board hand teaches no texture cell, forced and preflop-only hands leave it unchanged, cash and tournament apart, both install orders converge, rerun idempotence and saved read; no production installation'},indent=2))
 print('PASS isolated exact public memory compatibility')
finally:
 if started:command([pg/'pg_ctl','-D',cluster/'data','-m','immediate','-w','stop'])
 if (cluster/'server.log').exists():shutil.copy2(cluster/'server.log',a.output/'postgres.log')
 shutil.rmtree(cluster)
