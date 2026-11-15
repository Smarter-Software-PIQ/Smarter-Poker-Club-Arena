#!/usr/bin/env python3
"""Real PostgreSQL permissions and public-only observed replay, no production writes."""
import os, socket, subprocess, tempfile, shutil, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
candidates=[os.environ.get('PG_BIN',''),'/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin','/usr/lib/postgresql/16/bin']
if shutil.which('pg_config'):
 candidates.append(subprocess.check_output(['pg_config','--bindir'],text=True).strip())
PG=next((Path(p) for p in candidates if p and (Path(p)/'initdb').is_file()),None)
if PG is None: raise RuntimeError('PostgreSQL tools required for observed-hand privacy qualification')
Path(os.environ.get('TMPDIR',str(ROOT/'work'))).mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='observed-hands-',dir=os.environ.get('TMPDIR',str(ROOT/'work'))) as tmp:
 folder=Path(tmp)
 def run(args,sql=None):
  p=subprocess.run([str(a) for a in args],input=sql,text=True,capture_output=True,timeout=45)
  if p.returncode:raise RuntimeError(p.stdout+p.stderr)
  return p.stdout.strip()
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 run([PG/'initdb','-D',folder/'db','-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
 run([PG/'pg_ctl','-D',folder/'db','-l',folder/'log','-o',f"-h 127.0.0.1 -p {port} -k ''",'-w','start'])
 def q(sql):return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres'],sql)
 try:
  q('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE hand_history(id uuid PRIMARY KEY,table_id uuid,hand_number bigint,tournament_id uuid,players jsonb,hole_cards jsonb,community_cards jsonb,actions jsonb);
ALTER TABLE hand_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON hand_history TO authenticated;
CREATE POLICY own_hand ON hand_history TO authenticated USING(players @> jsonb_build_array(jsonb_build_object('userId',auth.uid()::text)));
''')
  q((ROOT/'supabase/migrations/20261115144452_completed_observers_can_review_public_hands.sql').read_text())
  observer='11111111-1111-4111-8111-111111111111'; outsider='22222222-2222-4222-8222-222222222222'; table='33333333-3333-4333-8333-333333333333'; hand='44444444-4444-4444-8444-444444444444'; hidden='55555555-5555-4555-8555-555555555555'
  q(f"INSERT INTO hand_history VALUES('{hand}','{table}',2,NULL,'[]','{{\"shown\":[\"As\",\"Ks\"]}}','[\"Qs\"]','[]'),('{hidden}','{table}',1,NULL,'[]','{{}}','[]','[]'); INSERT INTO ca_observed_hands VALUES('{observer}','{hand}','{table}',2,now());")
  def as_user(user,sql):return q(f"SET ROLE authenticated; SET request.jwt.claim.sub='{user}'; {sql}")
  assert as_user(observer,f"SELECT count(*) FROM hand_history WHERE id='{hand}';")=='0'
  assert as_user(observer,f"SELECT hand_number||':'||hole_cards::text FROM ca_table_review_hands(p_table_id=>'{table}');")=='2:{"shown": ["As", "Ks"]}'
  assert as_user(outsider,f"SELECT count(*) FROM ca_table_review_hands(p_table_id=>'{table}');")=='0'
  projection='66666666-6666-4666-8666-666666666666'
  q(f"UPDATE ca_observed_hands SET table_id='{projection}' WHERE viewer_id='{observer}';")
  assert as_user(observer,f"SELECT count(*) FROM ca_table_review_hands(p_table_id=>'{projection}');")=='1'
  assert as_user(outsider,f"SELECT count(*) FROM ca_table_review_hands(p_table_id=>'{projection}');")=='0'

  assert as_user(observer,f"SELECT count(*) FROM ca_table_review_hands(p_hand_ids=>ARRAY['{hidden}'::uuid]);")=='0'
  assert as_user(observer,'SELECT count(*) FROM ca_table_review_hands();')=='0'
  assert as_user(observer,f"SELECT count(*) FROM ca_table_review_hands(p_table_id=>'{table}',p_before=>2);")=='0'
  assert q("SELECT has_table_privilege('authenticated','ca_observed_hands','INSERT') OR has_table_privilege('authenticated','ca_observed_hands','UPDATE') OR has_function_privilege('anon','ca_table_review_hands(uuid,uuid[],bigint,integer,text,integer)','EXECUTE');")=='f'
  # Compare actual planner routes with the archive's production indexes.
  # A projected room has no matching physical table rows. The original OR
  # nevertheless walks the global archive to find its one observed hand.
  q("CREATE INDEX idx_hand_history_table_handnum ON hand_history(table_id,hand_number DESC); CREATE INDEX idx_hand_history_hand_number_lookup ON hand_history(hand_number); CREATE INDEX idx_hand_history_players_gin ON hand_history USING gin(players jsonb_path_ops);")
  q("INSERT INTO hand_history SELECT gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,100+g,NULL,'[]','{}','[]','[]' FROM generate_series(1,50000) g; ANALYZE hand_history; ANALYZE ca_observed_hands;")
  def plan(body):
   args={'p_table_id':"'"+projection+"'::uuid",'p_hand_ids':'NULL::uuid[]','p_before':'NULL::bigint','p_limit':'50','p_game_mode':'NULL::text','p_offset':'0'}
   for name,value in args.items():body=re.sub(r'\b'+name+r'\b','('+value+')',body)
   return json.loads(q(f"SET request.jwt.claim.sub='{observer}'; EXPLAIN (FORMAT JSON) "+body))
  def nodes(value):
   if isinstance(value,dict):
    yield value
    for child in value.values():yield from nodes(child)
   elif isinstance(value,list):
    for child in value:yield from nodes(child)
  def global_archive_walk(value):
   return [n for n in nodes(value) if n.get('Relation Name')=='hand_history' and
    (n.get('Node Type')=='Seq Scan' or (n.get('Index Name')=='idx_hand_history_hand_number_lookup' and not re.search(r'hand_number = ',n.get('Index Cond',''))))]
  before=plan((ROOT/'tests/fixtures/observed-review-preimage.sql').read_text())
  candidate=(ROOT/'supabase/migrations/20261115144452_completed_observers_can_review_public_hands.sql').read_text().split('AS $$',1)[1].split('$$;',1)[0]
  after=plan(candidate)
  assert global_archive_walk(before),'baseline must reproduce the global archive walk'
  assert not global_archive_walk(after),'projected replay must begin at indexed viewer receipts: '+json.dumps(after)
  # Each source can fill the page. UNION deduplicates a played-and-watched hand.
  participated='99999999-9999-4999-8999-999999999999'
  q(f"INSERT INTO hand_history VALUES('{participated}','{projection}',5,NULL,'[{{\"userId\":\"{observer}\"}}]','{{}}','[]','[]'); INSERT INTO ca_observed_hands VALUES('{observer}','{participated}','{projection}',5,now());")
  assert as_user(observer,f"SELECT string_agg(hand_number::text,',' ORDER BY hand_number DESC) FROM ca_table_review_hands(p_table_id=>'{projection}');")=='5,2'
  assert as_user(observer,f"SELECT hand_number FROM ca_table_review_hands(p_table_id=>'{projection}',p_limit=>1,p_offset=>1);")=='2'
  assert as_user(observer,f"SELECT hand_number FROM ca_table_review_hands(p_table_id=>'{projection}',p_before=>5);")=='2'
  assert as_user(observer,f"SELECT count(*) FROM ca_table_review_hands(p_hand_ids=>ARRAY['{participated}'::uuid,'{hand}'::uuid]);")=='2'
  assert as_user(outsider,f"SELECT count(*) FROM ca_table_review_hands(p_table_id=>'{projection}');")=='0'
  print('Observed replay query: global archive walk reproduced; indexed bounded routes PASS')
  # The original archive transaction owns its observer receipt, preserving
  # its existing defaults, award insertion and private authority.
  pre=json.loads((ROOT/'tests/fixtures/observed-hand-inserter-preimage.json').read_text())
  q("CREATE TABLE bomb_pot_award_units(hand_history_id uuid,table_id uuid,hand_number bigint,pot_index int,board int,side text,user_id uuid,amount numeric,hand_name text, UNIQUE(hand_history_id,pot_index,board,side,user_id));")
  q(pre['definition'])
  q("REVOKE ALL ON FUNCTION fn_ca_insert_hand_with_awards(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;")
  archive='77777777-7777-4777-8777-777777777777'
  row={'id':archive,'table_id':table,'hand_number':3,'players':[], 'hole_cards':{},'community_cards':[], 'actions':[], '_observed_hands':[{'table_id':projection,'hand_number':3,'viewer_id':observer}]*2}
  def literal(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
  # Before the fix the exact immutable submission silently discards receipts.
  q(f"SELECT fn_ca_insert_hand_with_awards({literal(row)});")
  assert q(f"SELECT count(*) FROM ca_observed_hands WHERE hand_id='{archive}';")=='0'
  q(f"DELETE FROM hand_history WHERE id='{archive}';")
  q((ROOT/'supabase/migrations/20261115154641_observer_replay_receipts_commit_with_the_original_hand.sql').read_text())
  units=[{'table_id':table,'hand_number':3,'pot_index':0,'board':1,'side':'high','user_id':outsider,'amount':6}]
  q(f"SELECT fn_ca_insert_hand_with_awards({literal(row)},{literal(units)});")
  assert as_user(observer,f"SELECT count(*) FROM ca_table_review_hands(p_table_id=>'{projection}');")=='3'
  assert q(f"SELECT count(*) FROM ca_observed_hands WHERE hand_id='{archive}';")=='1'
  assert q(f"SELECT sum(amount) FROM bomb_pot_award_units WHERE hand_history_id='{archive}';")=='6'
  assert q("SELECT has_function_privilege('authenticated','fn_ca_insert_hand_with_awards(jsonb,jsonb)','EXECUTE') OR has_function_privilege('service_role','fn_ca_insert_hand_with_awards(jsonb,jsonb)','EXECUTE');")=='f'
  assert q("SELECT has_table_privilege('service_role','ca_observed_hands','INSERT');")=='f'
  bad='88888888-8888-4888-8888-888888888888'
  row['id']=bad;row['hand_number']=4
  # Invalid receipt rejects the original transaction, including archive/awards.
  q(f"DO $test$ BEGIN BEGIN PERFORM fn_ca_insert_hand_with_awards({literal(row)},{literal(units)}); RAISE EXCEPTION 'expected rejection'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END; END $test$;")
  assert q(f"SELECT count(*) FROM hand_history WHERE id='{bad}';")=='0'
  assert q(f"SELECT count(*) FROM bomb_pot_award_units WHERE hand_history_id='{bad}';")=='0'
  row['_observed_hands'][0]['viewer_id']='invalid-uuid';row['_observed_hands'][0]['hand_number']=4
  q(f"DO $test$ BEGIN BEGIN PERFORM fn_ca_insert_hand_with_awards({literal(row)}); RAISE EXCEPTION 'expected rejection'; EXCEPTION WHEN invalid_text_representation THEN NULL; END; END $test$;")
  assert q(f"SELECT count(*) FROM hand_history WHERE id='{bad}';")=='0'
  row.pop('_observed_hands');q(f"SELECT fn_ca_insert_hand_with_awards({literal(row)});")
  assert q(f"SELECT count(*) FROM hand_history WHERE id='{bad}';")=='1'
  print('Observed replay: real RLS, entitlement, keyset paging and public cards PASS')
 finally:run([PG/'pg_ctl','-D',folder/'db','-m','fast','-w','stop'])
