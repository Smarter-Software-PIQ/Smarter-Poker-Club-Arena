#!/usr/bin/env python3
"""Real PostgreSQL permissions and public-only observed replay, no production writes."""
import os, socket, subprocess, tempfile, shutil
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
  print('Observed replay: real RLS, entitlement, keyset paging and public cards PASS')
 finally:run([PG/'pg_ctl','-D',folder/'db','-m','fast','-w','stop'])
