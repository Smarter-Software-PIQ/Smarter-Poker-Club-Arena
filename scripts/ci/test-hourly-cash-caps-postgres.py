#!/usr/bin/env python3
"""Finite isolated admission/closure proof; original financial kernel is unchanged.
The injected cashout records calls and value conservation; the existing accounting
qualification owns that kernel's actual wallet/ledger behavior. No live writes.
"""
import json, os, pathlib, shutil, subprocess, sys, tempfile
P=pathlib.Path
ROOT=P(__file__).resolve().parents[2]
if os.environ.get('PG_BIN'):
 PG=P(os.environ['PG_BIN'])
elif os.uname().sysname=='Darwin':
 PG=P('/opt/homebrew/opt/postgresql@17/bin')
else:
 # ubuntu-latest changes its bundled major. Prefer production's PG17 when
 # present, otherwise exercise the installed server, never silently skip.
 installed=sorted(P('/usr/lib/postgresql').glob('*/bin'),key=lambda p:int(p.parent.name) if p.parent.name.isdigit() else -1,reverse=True)
 PG=next((p for p in [P('/usr/lib/postgresql/17/bin'),*installed] if (p/'initdb').is_file()),None)
 if PG is None:raise SystemExit('PostgreSQL server binaries unavailable; provide PG_BIN')
parent=P(os.environ.get('TMPDIR',str(ROOT/'work'))); parent.mkdir(exist_ok=True)
w=P(tempfile.mkdtemp(prefix='hc-',dir=parent)); sock=w/'s';sock.mkdir()
env={'PATH':str(PG)+':/usr/bin:/bin','LC_ALL':'C','LANG':'C'}
def run(args,sql=None):
 r=subprocess.run([str(x) for x in args],input=sql,text=True,capture_output=True,env=env,timeout=60)
 if r.returncode: raise RuntimeError(r.stdout+r.stderr)
 return r.stdout.strip()
def q(sql):return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',sock,'-U','postgres','-d','postgres'],sql)
def assert_sql(expression,label):
 assert q('SELECT ('+expression+') IS TRUE;')=='t',label
try:
 run([PG/'initdb','-D',w/'d','-U','postgres','-A','trust','--no-locale','-E','UTF8'])
 run([PG/'pg_ctl','-D',w/'d','-l',w/'pg.log','-o',f"-h '' -k {sock}",'-w','start'])
 assert_sql("inet_server_addr() IS NULL AND current_setting('listen_addresses')=''",'socket only')
 q('''CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA smarter_private;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
 CREATE TABLE profiles(id uuid PRIMARY KEY,is_horse boolean,status text,horse_status text,balance numeric DEFAULT 0);
 CREATE TABLE clubs(id uuid PRIMARY KEY,asset text,is_platform boolean,union_id uuid);
 CREATE TABLE tables(id uuid PRIMARY KEY,club_id uuid,union_id uuid,tournament_id uuid,is_spins boolean DEFAULT false,
 is_template boolean DEFAULT false,is_deleted boolean DEFAULT false,status text DEFAULT 'waiting',lifecycle text DEFAULT 'live',
 live_at timestamptz,opened_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz,
 current_players integer,max_players integer DEFAULT 6,cluster_id uuid,game_variant text DEFAULT 'nlh',small_blind numeric DEFAULT 1,big_blind numeric DEFAULT 2);
 CREATE TABLE table_seats(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,table_id uuid,user_id uuid,seat_number integer,
 occupancy_id uuid DEFAULT gen_random_uuid(),left_at timestamptz,active_game_scope text,stack numeric DEFAULT 100,is_sitting_out boolean DEFAULT false,leave_pending boolean DEFAULT false);
 ALTER TABLE table_seats ADD COLUMN member_id uuid,ADD COLUMN sit_out_at timestamptz,
 ADD COLUMN is_away boolean,ADD COLUMN joined_at timestamptz DEFAULT now(),ADD COLUMN horse_id uuid,
 ADD COLUMN status text,ADD COLUMN auto_rebuy boolean,ADD COLUMN time_bank_remaining integer,
 ADD COLUMN time_bank_uses_remaining integer,ADD COLUMN club_id uuid,ADD COLUMN entry_hold text,
 ADD COLUMN entry_post_agreed boolean;
 CREATE TABLE cash_seat_moves(id uuid PRIMARY KEY,game_id uuid,player_id uuid,from_table_id uuid,
 to_table_id uuid,swap_move_id uuid,state text DEFAULT 'pending',ready_at timestamptz DEFAULT now(),
 expires_at timestamptz DEFAULT now()+interval '10 minutes',note text,executed_at timestamptz,to_seat_number integer);
 CREATE TABLE cash_cluster_events(game_id uuid,table_id uuid,kind text,payload jsonb);
 CREATE TABLE cash_games(id uuid PRIMARY KEY,cluster_mode text DEFAULT 'must_move',cluster_epoch integer DEFAULT 1,enabled boolean DEFAULT true,lightning_enabled boolean DEFAULT true,variant text,sb numeric,bb numeric);
 CREATE TABLE ca_horse_fleet_register(horse_id uuid,retired_at timestamptz);
 CREATE TABLE ca_horse_active_roster(horse_id uuid);
 CREATE TABLE engine_table_leases(table_id uuid,instance_id text,lease_generation uuid);
 CREATE TABLE engine_leader(id boolean PRIMARY KEY,instance_id text);
 INSERT INTO engine_leader VALUES(true,'engine');
 CREATE FUNCTION fn_platform_frozen() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.frozen',true),'false')='true'$$;
 CREATE FUNCTION fn_caller_is_engine() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.engine',true),'true')='true'$$;
 CREATE FUNCTION fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION fn_plo_lightning_horse_admit(uuid,uuid,timestamptz) RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE FUNCTION fn_lightning_horse_admit_paced(uuid,uuid,timestamptz) RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE TABLE cash_cluster_epoch(cluster_id uuid,epoch integer,ended_at timestamptz);
 CREATE TABLE ca_operator_policy(restrictions_enforced boolean);
 CREATE TABLE lightning_pool_session(id uuid,cluster_id uuid,player_id uuid,state text,cluster_epoch integer,anchor_seat_id uuid,stop_requested_at timestamptz,entered_at timestamptz,exited_at timestamptz,cash_player_session_id uuid);
 CREATE TABLE lightning_pool_slot(id uuid,cluster_id uuid,player_id uuid,closed_at timestamptz,cluster_epoch integer,pool_session_id uuid);
 CREATE TABLE cash_player_session(id uuid,closed_at timestamptz,closed_reason text,player_id uuid,scope_type text,scope_id uuid,table_id uuid);
 CREATE TABLE lightning_reservation(cluster_id uuid,player_id uuid,state text,lightning_instance_id uuid);
 CREATE TABLE lightning_instance(id uuid,state text);
 CREATE FUNCTION fn_lightning_config(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
 CREATE FUNCTION smarter_private.lightning_top_up_pending(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION fn_lightning_pool_stack(uuid) RETURNS numeric LANGUAGE sql AS $$SELECT 100$$;
 CREATE FUNCTION fn_lightning_anchor_is_live_eligible(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION fn_ca_player_restricted(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION fn_rg_require_not_excluded(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":true}'::jsonb$$;
 CREATE FUNCTION fn_lightning_hands_owed(uuid,boolean) RETURNS integer LANGUAGE sql AS $$SELECT 0$$;
 CREATE FUNCTION fn_lightning_player_in_hand(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('test.in_hand',true),'false')='true'$$;
 CREATE TYPE restriction AS(reason_code text);
 CREATE FUNCTION fn_ca_player_restriction_for(uuid,text) RETURNS restriction LANGUAGE sql AS $$SELECT ROW(null::text)::restriction$$;
 CREATE TABLE test_cashouts(occupancy_id uuid PRIMARY KEY,amount numeric,receipt jsonb);
 CREATE FUNCTION fn_cashout_seat_occupancy(p_user_id uuid,p_table_id uuid,p_seat_number integer,p_occupancy_id uuid,p_leave_mode text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE s table_seats%ROWTYPE;r jsonb;BEGIN
 SELECT receipt INTO r FROM test_cashouts WHERE occupancy_id=p_occupancy_id;IF FOUND THEN RETURN r;END IF;
 IF current_setting('test.in_hand',true)='true' THEN RAISE EXCEPTION 'LIGHTNING_HAND_IN_PROGRESS'; END IF;
 IF current_setting('test.fail_user',true)=p_user_id::text THEN RAISE EXCEPTION 'injected_cashout_refusal';END IF;
 SELECT * INTO STRICT s FROM table_seats WHERE occupancy_id=p_occupancy_id AND table_id=p_table_id AND user_id=p_user_id AND seat_number=p_seat_number AND left_at IS NULL FOR UPDATE;
 IF p_leave_mode<>'forced' THEN RAISE EXCEPTION 'wrong mode';END IF;
 r:=jsonb_build_object('ok',true,'stack',s.stack,'credited',true,'seat_number',p_seat_number,'occupancy_id',p_occupancy_id,
 'user_id',p_user_id,'table_id',p_table_id,'idempotency_key','cashout:occupancy:'||p_occupancy_id,'tournament_table',false);
 UPDATE profiles SET balance=balance+s.stack WHERE id=p_user_id;UPDATE table_seats SET left_at=clock_timestamp() WHERE id=s.id;
 INSERT INTO test_cashouts VALUES(p_occupancy_id,s.stack,r);RETURN r;END$$;
 ''')
 fixtures=ROOT/'scripts/ci/fixtures/hourly-cash-caps'
 q((fixtures/'roster.sql').read_text());q((fixtures/'lightning-legality.sql').read_text());q((fixtures/'seat-swap.sql').read_text())
 q('CREATE TRIGGER roster_guard BEFORE INSERT OR UPDATE OF user_id,table_id,left_at ON table_seats FOR EACH ROW WHEN(NEW.left_at IS NULL) EXECUTE FUNCTION fn_ca_horse_roster_seat_guard();')
 migration=(ROOT/'supabase/migrations/20261116153902_enforce_owner_hourly_cash_table_caps_with_human_expansion.sql').read_text()
 successor=(ROOT/'supabase/migrations/20261116194028_human_started_cash_games_remain_additional_hourly_capacity.sql').read_text()
 try:q(successor)
 except RuntimeError as e:assert 'cash_hourly_human_expansion_predecessor_changed' in str(e),str(e)
 else:raise AssertionError('successor accepted without original policy')
 assert_sql("to_regclass('public.cash_hourly_table_origins') IS NULL",'missing predecessor installs nothing')
 q(migration)
 q(successor)
 assert_sql('NOT fn_cash_hourly_table_enabled()','migration alone leaves serving predecessor unchanged')
 # The same maintained native fixture qualifies the catalog-only throughput producer.
 q((ROOT/'supabase/migrations/20261112105743_lightning_throughput_baseline_names_the_installed_admission_.sql').read_text())
 original_cohort=q('SELECT fingerprint FROM fn_lightning_admission_policy();')
 cohort_migration=(ROOT/'supabase/migrations/20261116200642_cash_throughput_cohorts_name_the_adopted_hourly_admission_co.sql').read_text()
 def cohort_refuses(statement,reason):
  try:q(statement)
  except RuntimeError as error:assert reason in str(error),str(error)
  else:raise AssertionError('unreviewed producer replacement accepted: '+reason)
 metadata_sql="SELECT jsonb_build_object('definition',pg_get_functiondef(oid),'owner',proowner::regrole::text,'acl',proacl::text) FROM pg_proc WHERE oid='public.fn_lightning_admission_policy()'::regprocedure"
 original_producer=q(metadata_sql)
 q('CREATE ROLE cohort_unreviewed;ALTER FUNCTION fn_lightning_admission_policy() OWNER TO cohort_unreviewed;')
 cohort_refuses(cohort_migration,'cash_admission_policy_authority_changed')
 assert q("SELECT pg_get_function_result('fn_lightning_admission_policy()'::regprocedure)")=='TABLE(fingerprint bigint)'
 q('ALTER FUNCTION fn_lightning_admission_policy() OWNER TO postgres;')
 for grant in ['authenticated','PUBLIC','cohort_unreviewed']:
  q('GRANT EXECUTE ON FUNCTION fn_lightning_admission_policy() TO '+grant)
  cohort_refuses(cohort_migration,'cash_admission_policy_authority_changed')
  q('REVOKE EXECUTE ON FUNCTION fn_lightning_admission_policy() FROM '+grant)
 q('GRANT service_role TO authenticated')
 cohort_refuses(cohort_migration,'cash_admission_policy_authority_changed')
 q('REVOKE service_role FROM authenticated')
 q('REVOKE EXECUTE ON FUNCTION fn_lightning_admission_policy() FROM service_role')
 cohort_refuses(cohort_migration,'cash_admission_policy_authority_changed')
 q('GRANT EXECUTE ON FUNCTION fn_lightning_admission_policy() TO service_role')
 old_definition=q("SELECT pg_get_functiondef('fn_lightning_admission_policy()'::regprocedure)")
 q(old_definition.replace('AS $function$','AS $function$\n-- unreviewed body',1))
 cohort_refuses(cohort_migration,'cash_admission_policy_preimage_changed')
 q(old_definition)
 assert q(metadata_sql)==original_producer
 q('CREATE VIEW cohort_dependent AS SELECT * FROM fn_lightning_admission_policy()')
 cohort_refuses(cohort_migration,'other objects depend on it')
 assert q(metadata_sql)==original_producer
 q('DROP VIEW cohort_dependent')
 cohort_refuses(cohort_migration.replace('COMMIT;',"DO $$BEGIN RAISE EXCEPTION 'injected_after_replacement';END$$;COMMIT;"),'injected_after_replacement')
 assert q(metadata_sql)==original_producer,'failed replacement must restore original definition, owner and ACL'
 q(cohort_migration)
 assert_sql("(SELECT proowner='postgres'::regrole AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog','statement_timeout=5s'] FROM pg_proc WHERE oid='fn_lightning_admission_policy()'::regprocedure)",'producer owner and execution metadata preserved')
 assert q('SELECT fingerprint FROM fn_lightning_admission_policy();')==original_cohort
 assert_sql("(SELECT hourly_contract='cash-hourly-tables/v1' AND hourly_fingerprint>=0 AND hourly_fingerprint<4503599627370496 FROM fn_lightning_admission_policy())",'full catalog producer is readable before activation')
 hourly_cohort=q('SELECT hourly_fingerprint FROM fn_lightning_admission_policy();')
 signatures=[
  'fn_cash_hourly_table_range(timestamptz)','fn_cash_hourly_table_census()',
  'fn_cash_hourly_table_capacity_census()',
  'fn_cash_hourly_table_excess(uuid)','fn_cash_hourly_table_enabled()',
  'fn_cash_hourly_table_delay(uuid)','fn_cash_hourly_table_drain_candidate()',
  'fn_cash_hourly_table_admit(uuid,uuid)','fn_cash_hourly_table_admissions()',
  'fn_cash_hourly_table_close(uuid,uuid,text,uuid)','fn_ca_horse_roster_seat_guard()',
  'fn_lightning_player_legality(uuid,timestamptz,uuid[],jsonb)']
 for signature in signatures:
  definition=q("SELECT pg_get_functiondef('"+signature+"'::regprocedure)")
  changed=definition.replace('AS $function$','AS $function$\n-- changed admission definition',1)
  assert changed!=definition
  q(changed)
  assert q('SELECT hourly_fingerprint FROM fn_lightning_admission_policy();')!=hourly_cohort,signature
  assert q('SELECT fingerprint FROM fn_lightning_admission_policy();')==original_cohort
  q(definition)
  name=signature.split('(')[0]
  q('ALTER FUNCTION '+signature+' RENAME TO cohort_missing_input')
  assert_sql('(SELECT hourly_fingerprint IS NULL FROM fn_lightning_admission_policy())','missing source never becomes zero or legacy')
  q('ALTER FUNCTION cohort_missing_input('+signature.split('(',1)[1]+' RENAME TO '+name)
 assert q('SELECT hourly_fingerprint FROM fn_lightning_admission_policy();')==hourly_cohort
 for signature,old,new in [('fn_cash_hourly_table_range(timestamptz)','ARRAY[18,15','ARRAY[19,15'),
                           ('fn_cash_hourly_table_delay(uuid)','120+','121+')]:
  definition=q("SELECT pg_get_functiondef('"+signature+"'::regprocedure)")
  assert old in definition
  q(definition.replace(old,new))
  assert q('SELECT hourly_fingerprint FROM fn_lightning_admission_policy();')!=hourly_cohort
  q(definition)
 assert_sql("has_function_privilege('service_role','fn_lightning_admission_policy()','EXECUTE') AND NOT has_function_privilege('anon','fn_lightning_admission_policy()','EXECUTE') AND NOT has_function_privilege('authenticated','fn_lightning_admission_policy()','EXECUTE')",'catalog producer remains service-only')

 for table in ['cash_hourly_table_pacing','cash_hourly_table_starts','cash_hourly_table_closures','cash_hourly_table_origins']:
  assert_sql("NOT has_table_privilege('service_role','"+table+"','SELECT,INSERT,UPDATE,DELETE')",'engine uses definer doors, no direct pacing/receipt writes')
 for signature in ['fn_cash_hourly_table_capacity_census()','fn_cash_hourly_table_excess(uuid)','fn_cash_hourly_table_drain_candidate()','fn_cash_hourly_table_admit(uuid,uuid)','fn_cash_hourly_table_admissions()']:
  for role in ['anon','authenticated']:
   assert_sql("NOT has_function_privilege('"+role+"','"+signature+"','EXECUTE')",'successor policy remains private')
  assert_sql("has_function_privilege('service_role','"+signature+"','EXECUTE')",'original engine still executes policy')

 assert q('SET ROLE service_role;SELECT count(*) FROM fn_cash_hourly_table_admissions();')=='0'
 expected=[(18,25),(15,18),(15,18),(12,15),(7,10),(5,8),(5,7),(7,9),(9,11),(10,13),(12,16),(13,17),(15,17),(15,18),(15,18),(15,18),(15,20),(18,22),(22,30),(25,33),(30,40),(30,40),(30,40),(25,29)]
 for hour,(lo,hi) in enumerate(expected):
  assert q(f"SELECT target_min||','||table_cap FROM fn_cash_hourly_table_range('2026-11-16 {hour:02}:00 America/Chicago');")==f'{lo},{hi}'
 assert q("SELECT local_hour FROM fn_cash_hourly_table_range('2026-11-01 06:30+00');")=='1'
 assert q("SELECT local_hour FROM fn_cash_hourly_table_range('2026-11-01 07:30+00');")=='1'
 assert q("SELECT local_hour FROM fn_cash_hourly_table_range('2026-03-08 08:00+00');")=='3'
 cap=int(q('SELECT table_cap FROM fn_cash_hourly_table_range();'))
 # Build preexisting floor with the original ingress, before the new policy.
 q('ALTER TABLE table_seats DISABLE TRIGGER roster_guard;')
 q(f'''INSERT INTO profiles(id,is_horse) SELECT md5('horse'||i)::uuid,true FROM generate_series(1,200)i;
 INSERT INTO ca_horse_active_roster SELECT id FROM profiles;
 INSERT INTO profiles(id,is_horse) VALUES(md5('human')::uuid,false);
 INSERT INTO tables(id,created_at) SELECT md5('table'||i)::uuid,now()+i*interval '1 second' FROM generate_series(1,{cap+3})i;
 INSERT INTO table_seats(table_id,user_id,seat_number) SELECT md5('table'||i)::uuid,md5('horse'||i)::uuid,1 FROM generate_series(1,{cap+2})i;
 INSERT INTO engine_table_leases SELECT id,'engine',md5('lease')::uuid FROM tables;
 ALTER TABLE table_seats ENABLE TRIGGER roster_guard;''')
 q("SELECT fn_cash_hourly_table_close(md5('table1')::uuid,gen_random_uuid(),'engine',md5('lease')::uuid);")
 assert_sql('fn_cash_hourly_table_enabled()','new serving boundary activates policy')
 candidate=q('SELECT fn_cash_hourly_table_drain_candidate();')
 assert candidate==q(f"SELECT md5('table{cap+2}')::uuid;")
 def refuses(sql,reason):
  try:q(sql)
  except RuntimeError as e:assert reason in str(e),str(e)
  else:raise AssertionError('accepted '+reason)
 refuses(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('table{cap+3}')::uuid,md5('horse190')::uuid,1);",'cash_hourly_table_cap_reached')
 assert_sql(f"(SELECT NOT allowed FROM fn_cash_hourly_table_admissions() WHERE table_id=md5('table{cap+3}')::uuid)",'fleet does not attempt a capped replacement')
 # Human entry is permitted above cap; only their own table can gain support.
 q(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('table{cap+3}')::uuid,md5('human')::uuid,1);")
 assert_sql(f"(SELECT allowed AND max_horses=1 AND NOT starts_game FROM fn_cash_hourly_table_admissions() WHERE table_id=md5('table{cap+3}')::uuid)",'human-started game support is individually paced')
 q(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('table{cap+3}')::uuid,md5('horse190')::uuid,2);")
 assert_sql(f"(SELECT NOT allowed FROM fn_cash_hourly_table_admissions() WHERE table_id=md5('table{cap+3}')::uuid)",'fleet waits for the next individual arrival')
 refuses(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('table{cap+3}')::uuid,md5('horse191')::uuid,3);",'cash_hourly_horse_arrival_paced')
 assert_sql(f"NOT fn_cash_hourly_table_excess(md5('table{cap+3}')::uuid)",'human protected')
 # Human-started expansion is additional capacity, not a reason to displace
 # another established game. A human joining a Horse-started game grants no
 # unrelated autonomous opening. The exception ends when its last human leaves.
 q(f"""BEGIN;
 UPDATE table_seats SET left_at=now() WHERE table_id IN(md5('table{cap+1}')::uuid,md5('table{cap+2}')::uuid);
 DO $$BEGIN IF fn_cash_hourly_table_drain_candidate() IS NOT NULL THEN
 RAISE EXCEPTION 'human-started extra game displaces a retained Horse game';END IF;END$$;
 INSERT INTO tables(id) VALUES(md5('unrelated-extra')::uuid);
 UPDATE cash_hourly_table_pacing SET next_open_at='-infinity';
 DO $$BEGIN IF (SELECT allowed FROM fn_cash_hourly_table_admissions() WHERE table_id=md5('unrelated-extra')::uuid) THEN
 RAISE EXCEPTION 'human expansion opens an unrelated Horse game';END IF;END$$;
 INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('table1')::uuid,md5('human')::uuid,2);
 DO $$BEGIN IF (SELECT allowed FROM fn_cash_hourly_table_admissions() WHERE table_id=md5('unrelated-extra')::uuid) THEN
 RAISE EXCEPTION 'joining a Horse-started game expands autonomous capacity';END IF;END$$;
 UPDATE table_seats SET left_at=now() WHERE table_id=md5('table{cap+3}')::uuid AND user_id=md5('human')::uuid;
 DO $$BEGIN IF NOT fn_cash_hourly_table_excess(md5('table{cap+3}')::uuid) THEN
 RAISE EXCEPTION 'human expansion stays exempt after the last human leaves';END IF;END$$;
 UPDATE table_seats SET left_at=now() WHERE table_id IN(md5('table{cap+3}')::uuid,md5('table2')::uuid);
 UPDATE cash_hourly_table_starts SET next_horse_at='-infinity';
 INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('table{cap+3}')::uuid,md5('horse191')::uuid,1);
 INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('table{cap+3}')::uuid,md5('human')::uuid,2);
 DO $$BEGIN IF (SELECT human_started FROM cash_hourly_table_origins WHERE table_id=md5('table{cap+3}')::uuid)
 OR (SELECT count(*) FROM fn_cash_hourly_table_capacity_census())<>{cap} THEN
 RAISE EXCEPTION 'a new Horse start inherits an old human expansion';END IF;END$$;
 ROLLBACK;""")
 # A late human, including sit-out, cancels eligibility immediately.
 q(f"INSERT INTO table_seats(table_id,user_id,seat_number,is_sitting_out) VALUES('{candidate}',md5('human')::uuid,2,true);")
 assert_sql(f"fn_cash_hourly_table_drain_candidate() IS DISTINCT FROM '{candidate}'::uuid",'late human protected')
 q(f"UPDATE table_seats SET left_at=now() WHERE table_id='{candidate}' AND user_id=md5('human')::uuid;")
 operation=q('SELECT gen_random_uuid();')
 close=f"SELECT fn_cash_hourly_table_close('{candidate}','{operation}','engine',md5('lease')::uuid);"
 # In-flight pooled hand and refusal preserve the entire table.
 refuses("SET test.in_hand='true';"+close,'LIGHTNING_HAND_IN_PROGRESS')
 assert_sql(f"EXISTS(SELECT 1 FROM table_seats WHERE table_id='{candidate}' AND left_at IS NULL)",'hand preserved')
 before=q('SELECT coalesce(sum(balance),0)+coalesce((SELECT sum(stack) FROM table_seats WHERE left_at IS NULL),0) FROM profiles;')
 receipt=json.loads(q(close));assert receipt['closed'] and len(receipt['departures'])==1
 assert q('SELECT coalesce(sum(balance),0)+coalesce((SELECT sum(stack) FROM table_seats WHERE left_at IS NULL),0) FROM profiles;')==before
 assert json.loads(q(close))==receipt
 assert int(q('SELECT count(*) FROM test_cashouts;'))==1
 assert_sql('fn_cash_hourly_table_drain_candidate() IS NULL','closures staggered')
 # Actual original legality: no new hand for selected anchor; IN_HAND wins.
 q("UPDATE cash_hourly_table_pacing SET next_close_at='-infinity';")
 candidate2=q('SELECT fn_cash_hourly_table_drain_candidate();');assert candidate2
 q(f'''INSERT INTO cash_games(id,cluster_mode) VALUES(md5('pool')::uuid,'lightning');
 INSERT INTO cash_cluster_epoch VALUES(md5('pool')::uuid,1,NULL);
 UPDATE tables SET cluster_id=md5('pool')::uuid WHERE id='{candidate2}';
 INSERT INTO cash_player_session VALUES(md5('session')::uuid,NULL);
 INSERT INTO lightning_pool_session SELECT md5('ps')::uuid,md5('pool')::uuid,user_id,'active',1,id,NULL,now(),NULL,md5('session')::uuid FROM table_seats WHERE table_id='{candidate2}' AND left_at IS NULL;
 INSERT INTO lightning_pool_slot SELECT md5('slot')::uuid,cluster_id,player_id,NULL,1,id FROM lightning_pool_session;''')
 assert q("SELECT reason_code FROM fn_lightning_player_legality(md5('pool')::uuid,now(),'{}',NULL);")=='CASH_HOURLY_CAP_DRAIN'
 assert q("SET test.in_hand='true';SELECT reason_code FROM fn_lightning_player_legality(md5('pool')::uuid,now(),'{}',NULL);")=='IN_HAND'
 # A human anywhere in this shared Lightning game protects the entire pool.
 q(f"INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{candidate2}',md5('human')::uuid,2);")
 assert_sql(f"NOT fn_cash_hourly_table_excess('{candidate2}')",'shared human pool protected')
 # Tournament seats, existing stack updates and departures remain untouched.
 q("INSERT INTO tables(id,tournament_id) VALUES(md5('tournament')::uuid,gen_random_uuid());INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('tournament')::uuid,md5('horse199')::uuid,1);UPDATE table_seats SET stack=stack+1 WHERE left_at IS NULL;")
 assert_sql("NOT EXISTS(SELECT 1 FROM fn_cash_hourly_table_census() WHERE table_id=md5('tournament')::uuid)",'tournament excluded')
 assert_sql("NOT has_function_privilege('authenticated','fn_cash_hourly_table_close(uuid,uuid,text,uuid)','EXECUTE')",'private close')
 # Capacity can grow again: after normal closures, a retained empty door starts
 # again through the SAME ingress; then every new game and new seat is paced.
 q("ALTER TABLE table_seats DISABLE TRIGGER roster_guard;UPDATE table_seats SET left_at=now() WHERE left_at IS NULL AND table_id<>md5('tournament')::uuid;ALTER TABLE table_seats ENABLE TRIGGER roster_guard;UPDATE cash_hourly_table_pacing SET next_open_at='-infinity';")
 q("INSERT INTO tables(id) VALUES(md5('restart')::uuid),(md5('addmore')::uuid);INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('restart')::uuid,md5('horse195')::uuid,1);")
 refuses("INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('addmore')::uuid,md5('horse196')::uuid,1);",'cash_hourly_table_start_paced')
 q("UPDATE cash_hourly_table_pacing SET next_open_at='-infinity';INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('addmore')::uuid,md5('horse196')::uuid,1);")
 # Two concurrent starts cannot reserve the same last slot. The original
 # transaction holds capacity; the competitor fails before any seat or debit.
 psql=[str(x) for x in [PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',sock,'-U','postgres','-d','postgres']]
 child=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 child.stdin.write("BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('cash_hourly_table_capacity',0));SELECT 'HELD';\n");child.stdin.flush()
 while child.stdout.readline().strip()!='HELD':
  if child.poll() is not None: raise AssertionError(child.stderr.read())
 try:
  q("INSERT INTO tables(id) VALUES(md5('concurrent')::uuid);UPDATE cash_hourly_table_pacing SET next_open_at='-infinity';")
  refuses("INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('concurrent')::uuid,md5('horse197')::uuid,1);",'cash_hourly_table_capacity_busy')
  assert_sql("NOT EXISTS(SELECT 1 FROM table_seats WHERE table_id=md5('concurrent')::uuid)",'no concurrent start side effect')
 finally:
  child.stdin.write('ROLLBACK;\n');child.stdin.close();child.wait(timeout=10)
 assert child.returncode==0,child.stderr.read()
 q("INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('concurrent')::uuid,md5('horse197')::uuid,1);")
 # Full close is atomic even if the second original cashout refuses.
 q(f'''ALTER TABLE table_seats DISABLE TRIGGER roster_guard;
 INSERT INTO tables(id,created_at) SELECT md5('refill'||i)::uuid,now()+i*interval '1 hour' FROM generate_series(1,{cap})i;
 INSERT INTO table_seats(table_id,user_id,seat_number) SELECT md5('refill'||i)::uuid,md5('horse'||i)::uuid,1 FROM generate_series(1,{cap})i;
 INSERT INTO engine_table_leases SELECT id,'engine',md5('lease')::uuid FROM tables WHERE id NOT IN(SELECT table_id FROM engine_table_leases);
 ALTER TABLE table_seats ENABLE TRIGGER roster_guard;UPDATE cash_hourly_table_pacing SET next_close_at='-infinity';''')
 selected=q('SELECT fn_cash_hourly_table_drain_candidate();')
 q(f"ALTER TABLE table_seats DISABLE TRIGGER roster_guard;INSERT INTO table_seats(table_id,user_id,seat_number) VALUES('{selected}',md5('horse198')::uuid,2);ALTER TABLE table_seats ENABLE TRIGGER roster_guard;")
 fail_user=q(f"SELECT user_id FROM table_seats WHERE table_id='{selected}' AND left_at IS NULL ORDER BY user_id DESC LIMIT 1;")
 second_op=q('SELECT gen_random_uuid();')
 second_close=f"SELECT fn_cash_hourly_table_close('{selected}','{second_op}','engine',md5('lease')::uuid);"
 total_before=q('SELECT sum(balance) FROM profiles;')
 refuses(f"SET test.fail_user='{fail_user}';"+second_close,'injected_cashout_refusal')
 assert q('SELECT sum(balance) FROM profiles;')==total_before
 assert_sql(f"(SELECT count(*)=2 FROM table_seats WHERE table_id='{selected}' AND left_at IS NULL)",'no partial close')
 # Lost-response replay joins the ORIGINAL transaction even if another game
 # empties and the floor changes while that original response is still unknown.
 original=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 original.stdin.write('BEGIN;'+second_close+"SELECT 'CLOSED_NOT_COMMITTED';\n");original.stdin.flush()
 original_receipt=None
 while True:
  line=original.stdout.readline().strip()
  if line.startswith('{'):original_receipt=json.loads(line)
  if line=='CLOSED_NOT_COMMITTED':break
  if original.poll() is not None:raise AssertionError(original.stderr.read())
 # An open settled-close transaction is still a holder: its heartbeat renews
 # without queueing, while the original takeover's FOR UPDATE stays fenced.
 assert q(f"WITH renewable AS (SELECT table_id FROM engine_table_leases WHERE table_id='{selected}' FOR NO KEY UPDATE SKIP LOCKED), renewed AS (UPDATE engine_table_leases l SET instance_id=l.instance_id FROM renewable r WHERE l.table_id=r.table_id RETURNING 1) SELECT count(*) FROM renewed;")=='1','closure does not starve lease heartbeat'
 refuses(f"SELECT 1 FROM engine_table_leases WHERE table_id='{selected}' FOR UPDATE NOWAIT;",'could not obtain lock on row')
 replay=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 replay.stdin.write(second_close);replay.stdin.close()
 import time
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  if q("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event='advisory');")=='t':break
  time.sleep(.02)
 else:raise AssertionError('original operation replay did not wait')
 original.stdin.write('COMMIT;\n');original.stdin.close();original.wait(timeout=10)
 replay.wait(timeout=10)
 assert original.returncode==0,original.stderr.read()
 assert replay.returncode==0,replay.stderr.read()
 assert json.loads(replay.stdout.read().strip())==original_receipt
 assert_sql(f"(SELECT count(*)=1 FROM cash_hourly_table_closures WHERE operation_id='{second_op}')",'one original closure')
 # A multirow producer is still one original transaction: neither global
 # starts nor a new table's individual arrivals can bypass pacing in a batch.
 q("ALTER TABLE table_seats DISABLE TRIGGER roster_guard;UPDATE table_seats SET left_at=now() WHERE left_at IS NULL;ALTER TABLE table_seats ENABLE TRIGGER roster_guard;UPDATE cash_hourly_table_pacing SET next_open_at='-infinity';INSERT INTO tables(id) VALUES(md5('batch1')::uuid),(md5('batch2')::uuid),(md5('batch-human')::uuid);")
 refuses("INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('batch1')::uuid,md5('horse191')::uuid,1),(md5('batch2')::uuid,md5('horse192')::uuid,1);",'cash_hourly_table_start_paced')
 assert_sql("NOT EXISTS(SELECT 1 FROM table_seats WHERE table_id IN(md5('batch1')::uuid,md5('batch2')::uuid))",'batch floor starts roll back together')
 q("INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('batch-human')::uuid,md5('human')::uuid,1);")
 refuses("INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('batch-human')::uuid,md5('horse193')::uuid,2),(md5('batch-human')::uuid,md5('horse194')::uuid,3);",'cash_hourly_horse_arrival_paced')
 assert_sql("(SELECT count(*)=1 FROM table_seats WHERE table_id=md5('batch-human')::uuid)",'batch arrivals roll back together')
 # Actual original swaps clear both chairs before revival, even when both
 # games are still assembling and both opening/arrival clocks are held.
 q("INSERT INTO cash_games(id) VALUES(md5('moves')::uuid);INSERT INTO tables(id,cluster_id) SELECT md5(x)::uuid,md5('moves')::uuid FROM unnest(ARRAY['move-src','move-dst','move-extra'])x;ALTER TABLE table_seats DISABLE TRIGGER roster_guard;INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('move-src')::uuid,md5('horse195')::uuid,1),(md5('move-dst')::uuid,md5('horse196')::uuid,1);ALTER TABLE table_seats ENABLE TRIGGER roster_guard;INSERT INTO cash_hourly_table_starts VALUES(md5('move-src')::uuid,now(),now()+interval '1 hour'),(md5('move-dst')::uuid,now(),now()+interval '1 hour');UPDATE cash_hourly_table_pacing SET next_open_at=now()+interval '1 hour';INSERT INTO cash_seat_moves(id,game_id,player_id,from_table_id,to_table_id,swap_move_id) VALUES(md5('swap1')::uuid,md5('moves')::uuid,md5('horse195')::uuid,md5('move-src')::uuid,md5('move-dst')::uuid,md5('swap2')::uuid),(md5('swap2')::uuid,md5('moves')::uuid,md5('horse196')::uuid,md5('move-dst')::uuid,md5('move-src')::uuid,md5('swap1')::uuid);")
 assert_sql("(fn_cash_seat_swap_execute_before_maintenance_gate(md5('swap1')::uuid)->>'ok')::boolean",'original atomic swap completes through the real roster trigger')
 assert_sql("(SELECT count(*)=2 AND sum(stack)=200 FROM table_seats WHERE table_id IN(md5('move-src')::uuid,md5('move-dst')::uuid) AND left_at IS NULL)",'original swap preserves both chairs and stacks')
 assert_sql("EXISTS(SELECT 1 FROM table_seats WHERE table_id=md5('move-dst')::uuid AND user_id=md5('horse195')::uuid AND left_at IS NULL)",'swap actually moved its player')
 # A one-way transfer is an arrival into an assembling game. It may not
 # turn the old funded-seat exemption into an instant ring.
 # (This pins 20261116194028 as installed. 20261123013241 lets the game's own
 # sanctioned moves and called names past the arrival clock, never the cap;
 # scripts/ci/test-a-called-name-keeps-its-place-postgres.py proves that one.)
 refuses("BEGIN;SET LOCAL app.cash_seat_move='on';INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('move-dst')::uuid,md5('horse196')::uuid,2);COMMIT;",'cash_hourly_horse_arrival_paced')
 q("UPDATE cash_hourly_table_starts SET next_horse_at='-infinity' WHERE table_id=md5('move-dst')::uuid;")
 q("BEGIN;SET LOCAL app.cash_seat_move='on';INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('move-dst')::uuid,md5('horse196')::uuid,2);UPDATE table_seats SET stack=0,left_at=now() WHERE table_id=md5('move-src')::uuid AND user_id=md5('horse196')::uuid;COMMIT;")
 assert_sql("(SELECT count(*)=2 AND sum(stack)=200 FROM table_seats WHERE table_id=md5('move-dst')::uuid AND left_at IS NULL)",'one-way funded arrival succeeds at its later permitted window')
 refuses("BEGIN;SET LOCAL app.cash_seat_move='on';INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('move-extra')::uuid,md5('horse195')::uuid,1);COMMIT;",'cash_hourly_table_start_paced')
 q("ALTER TABLE table_seats DISABLE TRIGGER roster_guard;UPDATE cash_hourly_table_pacing SET next_open_at='-infinity';INSERT INTO tables(id) SELECT md5('move-cap'||i)::uuid FROM generate_series(1,"+str(cap)+")i;INSERT INTO table_seats(table_id,user_id,seat_number) SELECT md5('move-cap'||i)::uuid,md5('horse180')::uuid,1 FROM generate_series(1,"+str(cap)+")i;ALTER TABLE table_seats ENABLE TRIGGER roster_guard;")
 refuses("BEGIN;SET LOCAL app.cash_seat_move='on';INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('move-extra')::uuid,md5('horse195')::uuid,1);COMMIT;",'cash_hourly_table_cap_reached')
 q("UPDATE engine_leader SET instance_id='older-rollback';")
 assert_sql('NOT fn_cash_hourly_table_enabled()','older rollback does not inherit unsupported drains')
 assert_sql('fn_cash_hourly_table_drain_candidate() IS NULL','rollback does not park pooled hands')
 # Origin is seating truth, including while an older leader disables caps.
 # Reusing an emptied human-started table must not preserve its old exception.
 q("UPDATE table_seats SET left_at=now() WHERE table_id=md5('batch-human')::uuid AND left_at IS NULL;INSERT INTO table_seats(table_id,user_id,seat_number) VALUES(md5('batch-human')::uuid,md5('horse188')::uuid,1);")
 assert_sql("(SELECT human_started IS FALSE FROM cash_hourly_table_origins WHERE table_id=md5('batch-human')::uuid)",'inactive leader seating resets an old human origin')
 refuses(migration,'already exists')
 assert q('SELECT hourly_fingerprint FROM fn_lightning_admission_policy();')==hourly_cohort,'activation/rollback/live population are not policy definitions'
 refuses(successor,'cash_hourly_human_expansion_predecessor_changed')
 print(json.dumps({'producer_authority_and_atomicity':True,'throughput_policy_inputs':12,'base_cohort_preserved':True,'missing_and_changed_inputs':True,'passed':True,'postgres_version_num':q('SHOW server_version_num;'),'hours':24,'dst':True,'human_start_and_late_arrival':True,'human_expansion_is_additional':True,'arrival_and_game_pacing':True,'lightning_original_legality':True,'current_hand_preserved':True,'closure_replay_once':True,'conservation_forwarding':True,'tournaments_excluded':True,'restart_and_addmore':True,'financial_kernel_changed':False}))
finally:
 if (w/'d/postmaster.pid').exists():run([PG/'pg_ctl','-D',w/'d','-m','immediate','-w','stop'])
 shutil.rmtree(w)
# Also verify 20261125040442 single-pass census & fast-path close (incident 1e532243).
subprocess.run([sys.executable,'-B',str(ROOT/'scripts/ci/test-hourly-cash-census-single-pass-postgres.py')],check=True)
