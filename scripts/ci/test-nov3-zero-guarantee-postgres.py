#!/usr/bin/env python3
"""Exact migration on isolated PostgreSQL; no production money or credentials."""
import argparse, hashlib, json, os, shutil, socket, subprocess, tempfile
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('--pg-bin',type=Path,required=True);ap.add_argument('--scratch',type=Path,required=True)
a=ap.parse_args();root=Path(__file__).resolve().parents[2];fixture=root/'scripts/ci/fixtures/nov3-zero-guarantee'
base=Path(tempfile.mkdtemp(prefix='nov3-',dir=a.scratch));data=base/'data';started=False
with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=str(listener.getsockname()[1])
def run(argv,content=None,error=None):
 p=subprocess.run([str(x) for x in argv],input=content,text=True,capture_output=True,timeout=30)
 if error:assert p.returncode and error in p.stderr,p.stdout+p.stderr
 else:assert p.returncode==0,p.stdout+p.stderr
 return p.stdout.strip()
def sql(s,error=None):return run([a.pg_bin/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres'],s,error)
try:
 run([a.pg_bin/'initdb','-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
 run([a.pg_bin/'pg_ctl','-D',data,'-l',base/'log','-o',f"-h 127.0.0.1 -k '' -p {port}",'-w','start']);started=True
 sql("""CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE SCHEMA smarter_private;
 CREATE TABLE ca_declared_money_triggers(table_name text,trigger_name text,note text,PRIMARY KEY(table_name,trigger_name));
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE TABLE tournaments(id uuid PRIMARY KEY,name text NOT NULL,description text,short_description text,club_id uuid,status text,start_time timestamptz,started_at timestamptz,guaranteed_prize numeric,buy_in_amount numeric,buy_in_fee numeric,bounty_amount numeric,is_bounty boolean,is_pko boolean,is_mystery_bounty boolean,format_contract text,current_players integer,max_players integer,prize_pool numeric DEFAULT 0,prize_pool_finalized boolean DEFAULT false);
 CREATE TABLE tournament_players(tournament_id uuid);CREATE TABLE tournament_refund_entitlements(tournament_id uuid);
 CREATE TABLE clubs(id uuid,union_id uuid);
 CREATE FUNCTION fn_ca_read_mtt_admission_contract() RETURNS text LANGUAGE sql AS $$SELECT 'unlimited-mtt-v2'::text$$;
 CREATE FUNCTION fn_tournament_entry_split(numeric,numeric,numeric,boolean) RETURNS TABLE(charge numeric) LANGUAGE sql AS $$SELECT $1+$2$$;
 """)
 sql("""ALTER TABLE tournaments ADD COLUMN variant text, ADD COLUMN tournament_type text,
 ADD COLUMN bounty_pool numeric DEFAULT 0, ADD COLUMN satellite_seats integer DEFAULT 0,
 ADD COLUMN satellite_target_id uuid, ADD COLUMN satellite_target uuid, ADD COLUMN payout_depth_percent numeric,
 ADD COLUMN payout_percent numeric, ADD COLUMN payout_structure text, ADD COLUMN is_private boolean DEFAULT false,
 ADD COLUMN union_id uuid;
 ALTER TABLE clubs ADD COLUMN asset text,ADD COLUMN guarantee_enforcement_enabled boolean DEFAULT true,
 ADD COLUMN name text,ADD COLUMN guarantee_treasury_floor numeric DEFAULT 0,ADD COLUMN chip_treasury numeric DEFAULT 0,
 ADD COLUMN updated_at timestamptz;
 CREATE TABLE union_wallets(union_id uuid,chip_balance numeric,updated_at timestamptz);
 CREATE TABLE chip_ledger(performed_by uuid,from_type text,from_entity_id uuid,to_type text,to_entity_id uuid,amount numeric,category text,club_id uuid,tournament_id uuid,description text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
 CREATE FUNCTION fn_tournament_payout_terms_committed_v1(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 DROP FUNCTION fn_tournament_entry_split(numeric,numeric,numeric,boolean);
 """)
 for owner in json.loads((fixture/'funding-owners.json').read_text()):sql(owner['definition'])
 sql("""CREATE TRIGGER aa_diamond_guarantee_copy BEFORE INSERT OR UPDATE OF name,description,short_description ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_diamond_guarantee_copy_trigger();
 CREATE TRIGGER tournaments_guarantee_affordable_ins BEFORE INSERT ON tournaments FOR EACH ROW WHEN(NEW.guaranteed_prize>0) EXECUTE FUNCTION trg_tournaments_guarantee_affordable();
 CREATE TRIGGER zz_ca_fund_overlay_on_lock BEFORE UPDATE OF status ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_fund_overlay_on_lock();
 """)
 sql((fixture/'original-overlay.sql').read_text())
 sql('REVOKE ALL ON FUNCTION fn_overlay_at_risk(uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION fn_overlay_at_risk(uuid) TO service_role;')
 overlay_acl=sql("SELECT proowner::text||':'||proacl::text FROM pg_proc WHERE oid='fn_overlay_at_risk(uuid)'::regprocedure")
 rows=json.loads((fixture/'offers.json').read_text())
 for r in rows:
  sql("INSERT INTO tournaments(id,name,status,start_time,guaranteed_prize,buy_in_amount,buy_in_fee,format_contract) VALUES('%s','%s','REGISTERING','%s',%s,%s,%s,'mtt-v2')"%(r['id'],r['name'].replace("'","''"),r['start_time'],r['guaranteed_prize'],r['buy_in_amount'],r['buy_in_fee']))
 migration=root/'supabase/migrations/20261103232526_nov3_zero_guarantee_preserves_attendance.sql'
 before=sql("SELECT jsonb_agg(to_jsonb(t)-'guaranteed_prize'-'name' ORDER BY id) FROM tournaments t")
 sql(migration.read_text())
 assert before==sql("SELECT jsonb_agg(to_jsonb(t)-'guaranteed_prize'-'name' ORDER BY id) FROM tournaments t")
 assert overlay_acl==sql("SELECT proowner::text||':'||proacl::text FROM pg_proc WHERE oid='fn_overlay_at_risk(uuid)'::regprocedure")
 actual=json.loads(sql("SELECT json_agg(json_build_object('id',t.id,'guarantee',t.guaranteed_prize,'floor',a.attendance_floor)) FROM tournaments t JOIN smarter_private.nov3_tournament_attendance a ON a.tournament_id=t.id"))
 assert len(actual)==14
 expected={r['id']:r['original_attendance_coverage_floor'] for r in rows}
 assert all(r['guarantee']==0 and r['floor']==expected[r['id']] for r in actual)
 # All five creation boundaries, plus repeat writes retain the original plan.
 sql("""INSERT INTO tournaments(id,name,status,start_time,guaranteed_prize,buy_in_amount,buy_in_fee,format_contract)
 SELECT md5('scope-'||g)::uuid,'Fixture - 1K GTD','REGISTERING',s,1000,9,1,'mtt-v2'
 FROM (VALUES(1,'2026-11-03 05:59:59Z'::timestamptz),(2,'2026-11-03 06:00Z'::timestamptz),(3,'2026-11-04 05:59:59Z'::timestamptz),(4,'2026-11-04 06:00Z'::timestamptz))v(g,s);
 UPDATE tournaments SET guaranteed_prize=0 WHERE id=md5('scope-2')::uuid;""")
 assert sql("SELECT string_agg(guaranteed_prize::text,',' ORDER BY start_time) FROM tournaments WHERE id IN(SELECT md5('scope-'||g)::uuid FROM generate_series(1,4)g)")=='1000,0,0,1000'
 assert sql("SELECT attendance_floor FROM smarter_private.nov3_tournament_attendance WHERE tournament_id=md5('scope-2')::uuid")=='100'
 assert sql("SELECT name FROM tournaments WHERE id=md5('scope-2')::uuid")=='Fixture'
 sql("SET ROLE anon;SELECT * FROM public.fn_ca_nov3_tournament_attendance('{}')",'permission denied')
 sql("SET ROLE authenticated;SELECT * FROM smarter_private.nov3_tournament_attendance",'permission denied')
 sql("SET ROLE service_role;SELECT * FROM public.fn_ca_nov3_tournament_attendance('{}')",'service_role_required')
 assert sql("SET ROLE service_role;SET request.jwt.claim.role='service_role';SELECT count(*) FROM public.fn_ca_nov3_tournament_attendance(ARRAY[md5('scope-2')::uuid])")=='1'
 sql("SET ROLE service_role;INSERT INTO smarter_private.nov3_tournament_attendance VALUES(NULL)",'permission denied')
 # Exact private floor survives restart/read; overlay result carries zero money guarantee.
 # Move transaction clock relative dates only in query fixture to exercise unchanged time predicate.
 definition=sql("SELECT pg_get_functiondef('fn_overlay_at_risk(uuid)'::regprocedure)")
 timed=definition.replace('now()',"TIMESTAMPTZ '2026-11-04 00:00Z'")
 sql(timed)
 result=json.loads(sql("SELECT json_agg(json_build_object('id',tournament_id,'guarantee',guaranteed_prize,'floor',entries_needed)) FROM fn_overlay_at_risk(NULL)"))
 assert result and all(r['guarantee']==0 and r['floor']==expected[r['id']] for r in result)
 # Redating does not manufacture a promise or apply attendance to another day.
 sql("UPDATE tournaments SET start_time='2026-11-05 12:00Z',guaranteed_prize=700 WHERE id=md5('scope-2')::uuid")
 assert sql("SET ROLE service_role;SET request.jwt.claim.role='service_role';SELECT count(*) FROM public.fn_ca_nov3_tournament_attendance(ARRAY[md5('scope-2')::uuid])")=='0'
 assert sql("SELECT guaranteed_prize FROM tournaments WHERE id=md5('scope-2')::uuid")=='700'
 sql("UPDATE tournaments SET start_time='2026-11-03 12:00Z' WHERE id=md5('scope-2')::uuid")
 assert sql("SELECT attendance_floor FROM smarter_private.nov3_tournament_attendance WHERE tournament_id=md5('scope-2')::uuid")=='100'
 sql("INSERT INTO tournaments(id,name,status,start_time,guaranteed_prize,buy_in_amount,buy_in_fee) VALUES(md5('draft')::uuid,'Draft','DRAFT','2026-11-03 12:00Z',800,9,1);UPDATE tournaments SET status='REGISTERING' WHERE id=md5('draft')::uuid")
 assert sql("SELECT guaranteed_prize FROM tournaments WHERE id=md5('draft')::uuid")=='0'
 # Actual installed copy/affordability/overlay trigger owners run in their real ordering.
 sql("INSERT INTO clubs(id,asset,chip_treasury,name) VALUES(md5('club')::uuid,'chips',500,'Fixture');UPDATE tournaments SET club_id=md5('club')::uuid WHERE id=md5('scope-3')::uuid;UPDATE tournaments SET status='RUNNING' WHERE id=md5('scope-3')::uuid")
 assert sql("SELECT chip_treasury FROM clubs WHERE id=md5('club')::uuid")=='500'
 assert sql("SELECT count(*) FROM chip_ledger")=='0'
 assert sql("SELECT prize_pool FROM tournaments WHERE id=md5('scope-3')::uuid")=='0'
 # Satellite tickets remain an independently funded contract, not invented cash GTD.
 sql("INSERT INTO tournaments(id,name,status,start_time,guaranteed_prize,buy_in_amount,buy_in_fee) VALUES(md5('target')::uuid,'Target','REGISTERING','2026-11-05 12:00Z',0,45,5)")
 sql("INSERT INTO tournaments(id,name,status,start_time,guaranteed_prize,buy_in_amount,buy_in_fee,variant,satellite_seats,satellite_target_id,club_id) VALUES(md5('sat')::uuid,'Satellite - 5K GTD','REGISTERING','2026-11-03 13:00Z',0,4.5,.5,'satellite',1,md5('target')::uuid,md5('club')::uuid);UPDATE tournaments SET status='RUNNING' WHERE id=md5('sat')::uuid")
 assert sql("SELECT guaranteed_prize||':'||satellite_seats||':'||prize_pool FROM tournaments WHERE id=md5('sat')::uuid")=='0:1:50.00'
 assert sql("SELECT chip_treasury FROM clubs WHERE id=md5('club')::uuid")=='450.00'
 assert sql("SELECT amount FROM chip_ledger WHERE tournament_id=md5('sat')::uuid")=='50.00'
 # Existing funded/registered promises are refused, never quietly reduced.
 sql("INSERT INTO tournament_players VALUES(md5('registered')::uuid)")
 sql("INSERT INTO tournaments(id,name,status,start_time,guaranteed_prize,buy_in_amount,buy_in_fee) VALUES(md5('registered')::uuid,'Funded','REGISTERING','2026-11-03 12:00Z',500,9,1)",'nov3_existing_financial_contract_refused')
 print(json.dumps({'passed':True,'migration_sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'fourteen_floors_preserved':True,'date_boundaries':True,'real_role_acl':True,'overlay_zero_financial_guarantee':True,'limitation':'Isolated schema; no live financial execution or whole-engine certificate'}))
finally:
 if started:run([a.pg_bin/'pg_ctl','-D',data,'-m','fast','-w','stop'])
 shutil.rmtree(base)
