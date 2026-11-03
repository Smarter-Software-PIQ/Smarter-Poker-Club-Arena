#!/usr/bin/env python3
"""Qualify fixed-limit migration against captured live owner functions on disposable PostgreSQL."""
import argparse,subprocess,tempfile,shutil,json,getpass,socket
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('--pg-bin',type=Path,required=True);ap.add_argument('--scratch',type=Path,required=True);a=ap.parse_args()
port_socket=socket.socket();port_socket.bind(('127.0.0.1',0));port=port_socket.getsockname()[1];port_socket.close()
root=Path(__file__).resolve().parents[2];base=Path(tempfile.mkdtemp(prefix='fixed-limit-',dir=a.scratch));data=base/'data';started=False

def run(args):return subprocess.run([str(x) for x in args],capture_output=True,text=True,check=True).stdout
try:
 run([a.pg_bin/'initdb','-D',data,'-A','trust','--no-locale']);run([a.pg_bin/'pg_ctl','-D',data,'-l',base/'pg.log','-o',f"-k '' -p {port} -h 127.0.0.1",'-w','start']);started=True
 def sql(s):
  r=subprocess.run([str(a.pg_bin/'psql'),'-h','127.0.0.1','-p',str(port),'-U',getpass.getuser(),'-d','postgres','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At'],input=s,capture_output=True,text=True)
  if r.returncode:raise RuntimeError(r.stderr)
  return r.stdout
 f=root/'scripts/ci/fixtures/fixed-limit-policy';sql((f/'schema.sql').read_text())
 sql("""CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
 CREATE FUNCTION fn_can_create_games(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.allowed',true)='yes'$$;
 CREATE FUNCTION fn_ca_tournament_is_unlimited(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE clubs(id uuid,asset text,union_id uuid,lifecycle_status text DEFAULT 'active');CREATE TABLE unions(id uuid);CREATE TABLE table_seats(table_id uuid,seat_number integer,left_at timestamptz);
 CREATE TABLE cash_cluster_events(game_id uuid,table_id uuid,kind text,payload jsonb);
 CREATE FUNCTION fn_club_union_context(uuid) RETURNS TABLE(member_union_id uuid,own_union_id uuid) LANGUAGE sql AS $$SELECT NULL::uuid,NULL::uuid$$;
 CREATE FUNCTION fn_cash_stakes_label(numeric,numeric,text) RETURNS text LANGUAGE sql AS $$SELECT $1::text||'/'||$2::text$$;
 ALTER TABLE cash_games ALTER COLUMN enabled SET DEFAULT true;ALTER TABLE cash_games ALTER COLUMN cluster_mode SET DEFAULT 'must_move';
 """)
 for n in ['fn_cash_template_defaults','fn_cash_cluster_open_table','fn_cash_game_ensure','fn_cash_apply_ruleset','fn_cash_game_floor_from_template','fn_cash_game_max_stake_guard','fn_update_managed_game']:sql((f/(n+'.sql')).read_text())
 sql("CREATE TRIGGER floor BEFORE INSERT OR UPDATE ON cash_games FOR EACH ROW EXECUTE FUNCTION fn_cash_game_floor_from_template();CREATE TRIGGER stakes BEFORE INSERT OR UPDATE ON cash_games FOR EACH ROW EXECUTE FUNCTION fn_cash_game_max_stake_guard();")
 sql("INSERT INTO clubs VALUES ('11111111-1111-4111-8111-111111111111','chips',NULL,'active');SELECT fn_cash_game_ensure('11111111-1111-4111-8111-111111111111','flh',.5,1);SELECT fn_cash_game_ensure('11111111-1111-4111-8111-111111111111','flo8',.5,1);")
 sql("""INSERT INTO clubs VALUES('44444444-4444-4444-8444-444444444444','chips',NULL,'active'),('55555555-5555-4555-8555-555555555555','chips',NULL,'active');
 SELECT fn_cash_game_ensure('44444444-4444-4444-8444-444444444444','flh',.5,1);
 SELECT fn_cash_game_ensure('55555555-5555-4555-8555-555555555555','flo8',.5,1);
 UPDATE clubs SET lifecycle_status='retired' WHERE id='44444444-4444-4444-8444-444444444444';
 DELETE FROM clubs WHERE id='55555555-5555-4555-8555-555555555555';""")
 sql((f/'fn_guard_retired_club_mutation.sql').read_text())
 sql("CREATE TRIGGER retirement BEFORE INSERT OR UPDATE OR DELETE ON cash_games FOR EACH ROW EXECUTE FUNCTION fn_guard_retired_club_mutation();CREATE TRIGGER retirement BEFORE INSERT OR UPDATE OR DELETE ON tables FOR EACH ROW EXECUTE FUNCTION fn_guard_retired_club_mutation();")
 preserved="SELECT jsonb_build_object('games',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM cash_games g WHERE club_id<>'11111111-1111-4111-8111-111111111111'),'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tables t WHERE club_id<>'11111111-1111-4111-8111-111111111111'))"
 protected_before=sql(preserved)
 try:sql((f/'pre_correction_data_owners.sql').read_text())
 except RuntimeError as error:assert 'CLUB_RETIRED' in str(error) and '55000' in str(error)
 else:raise AssertionError('old source did not reproduce CLUB_RETIRED')
 assert sql(preserved)==protected_before
 migration=(root/'supabase/migrations/20261103121552_fixed_limit_stakes_and_unlimited_buyins.sql').read_text()
 metadata="SELECT jsonb_agg(jsonb_build_array(proname,proowner,proacl,prosecdef,provolatile,proconfig) ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('fn_cash_apply_ruleset','fn_cash_cluster_open_table','fn_cash_template_defaults','fn_cash_game_floor_from_template','fn_cash_game_max_stake_guard','fn_update_managed_game')"
 sql("DO $$DECLARE f regprocedure;BEGIN FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('fn_cash_apply_ruleset','fn_cash_cluster_open_table','fn_cash_template_defaults','fn_cash_game_floor_from_template','fn_cash_game_max_stake_guard','fn_update_managed_game') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO service_role';END LOOP;END$$;")
 before=sql(metadata)
 assert sql("SELECT count(*) FROM tables WHERE max_buy_in IS NOT NULL AND club_id='11111111-1111-4111-8111-111111111111'").strip()=='2'
 try:sql(migration.replace('COMMIT;',"DO $$BEGIN RAISE EXCEPTION 'forced_rollback';END$$;COMMIT;"))
 except RuntimeError as error:assert 'forced_rollback' in str(error)
 else:raise AssertionError('forced rollback did not abort')
 assert sql(metadata)==before
 assert sql('SELECT count(*) FROM cash_games').strip()=='4'
 sql(migration)
 assert sql(metadata)==before
 assert sql(preserved)==protected_before
 sql((root/'supabase/tests/fixed_limit_buyin_policy.sql').read_text())
 sql("DO $$BEGIN IF (SELECT count(*) FROM cash_games WHERE enabled AND variant IN ('flh','flo8') AND club_id='11111111-1111-4111-8111-111111111111')<>8 THEN RAISE EXCEPTION 'catalogue incomplete';END IF;IF EXISTS(SELECT 1 FROM tables WHERE game_variant IN ('flh','flo8') AND club_id='11111111-1111-4111-8111-111111111111' AND (max_buy_in IS NOT NULL OR min_buy_in<=0))THEN RAISE EXCEPTION 'projection wrong';END IF;END$$;")
 sql("""SET test.uid='11111111-1111-4111-8111-111111111111';SET test.allowed='yes';
 INSERT INTO tables(id,club_id,current_players,status,name,small_blind,big_blind,min_buy_in,max_buy_in,max_players,game_variant,updated_at) VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',0,'waiting','Limit',1,2,80,NULL,6,'flh',now());
 DO $$DECLARE r jsonb;BEGIN
 r:=fn_update_managed_game('table','22222222-2222-4222-8222-222222222222','{"name":"Limit","max_buy_in":400}');
 IF r->>'ok'<>'true' OR (SELECT max_buy_in FROM tables WHERE id='22222222-2222-4222-8222-222222222222') IS NOT NULL THEN RAISE EXCEPTION 'finite cap restored';END IF;
 r:=fn_update_managed_game('table','22222222-2222-4222-8222-222222222222','{"name":"Too High","small_blind":5,"big_blind":11}');
 IF r->>'reason'<>'invalid_table_limits' OR (SELECT big_blind FROM tables WHERE id='22222222-2222-4222-8222-222222222222')<>2 THEN RAISE EXCEPTION 'managed fixed-limit blind ceiling lost';END IF;
 UPDATE tables SET game_variant='flo8',max_buy_in=400,status='running',current_players=1 WHERE id='22222222-2222-4222-8222-222222222222';
 PERFORM fn_update_managed_game('table','22222222-2222-4222-8222-222222222222','{"name":"Active"}');
 IF (SELECT max_buy_in FROM tables WHERE id='22222222-2222-4222-8222-222222222222') IS NOT NULL THEN RAISE EXCEPTION 'active cap retained';END IF;
 UPDATE tables SET game_variant='nlh',max_buy_in=400,status='waiting',current_players=0 WHERE id='22222222-2222-4222-8222-222222222222';
 r:=fn_update_managed_game('table','22222222-2222-4222-8222-222222222222','{"name":"NLH","max_buy_in":40}');
 IF r->>'reason'<>'invalid_table_limits' THEN RAISE EXCEPTION 'non-limit minimum guard lost';END IF;
 PERFORM set_config('test.allowed','no',false);
 r:=fn_update_managed_game('table','22222222-2222-4222-8222-222222222222','{"name":"Denied"}');
 IF r->>'reason'<>'not_authorized' THEN RAISE EXCEPTION 'authorization lost';END IF;
 END$$;""")
 print(json.dumps({'qualification':'passed','real_owner_functions':8,'retired_and_missing_hosts_preserved':True,'original_retirement_failure_reproduced':True,'requested_stake_games':6,'projection_max_null':True,'minimum_preserved':True,'rollback_preserved':True,'owner_and_grants_preserved':True}))
finally:
 if started:run([a.pg_bin/'pg_ctl','-D',data,'-m','immediate','-w','stop'])
 shutil.rmtree(base)
