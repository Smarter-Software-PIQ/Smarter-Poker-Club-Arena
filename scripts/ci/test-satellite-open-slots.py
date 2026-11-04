#!/usr/bin/env python3
"""Real isolated PostgreSQL: exact planner preimage and migration, no live chips."""
import argparse,json,os,subprocess,tempfile
from pathlib import Path
R=Path(__file__).resolve().parents[2]
M=R/'supabase/migrations/20261104083238_satellite_horse_slots_use_eligible_admission_hours.sql'
p=argparse.ArgumentParser();p.add_argument('--scratch',type=Path,required=True);p.add_argument('--pg-bin',default='/opt/homebrew/opt/postgresql@17/bin');a=p.parse_args();a.scratch=a.scratch.resolve();pg=Path(a.pg_bin);a.scratch.mkdir(parents=True,exist_ok=True)
pre=json.loads((R/'scripts/ci/fixtures/satellite-open-slots-preimage.json').read_text());cases=[]
with tempfile.TemporaryDirectory(prefix='slots-',dir=a.scratch) as tmp:
 root=Path(tmp);sock=root/'s';sock.mkdir();data=root/'d';env={**os.environ,'PGHOST':str(sock),'PGUSER':'postgres','PGDATABASE':'postgres','PGSSLMODE':'disable'}
 def run(cmd,s=None,error=None):
  r=subprocess.run(list(map(str,cmd)),input=s,text=True,capture_output=True,env=env,timeout=45)
  if error: assert r.returncode and error in r.stderr,(error,r.stdout,r.stderr)
  else: assert r.returncode==0,(r.stdout,r.stderr)
  return r.stdout.strip()
 def q(s,error=None):return run([pg/'psql','-XAtq','-v','ON_ERROR_STOP=1'],s,error)
 run([pg/'initdb','-D',data,'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8'])
 with (data/'postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(sock)+"'\ntimezone='UTC'\n")
 run([pg/'pg_ctl','-D',data,'-l',root/'log','-w','start'])
 try:
  q('''CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA smarter_private;CREATE SCHEMA fixture;
CREATE TABLE smarter_private.daily_window_policy(singleton boolean,time_zone text,spin_sng_stop time,window_end time);
INSERT INTO smarter_private.daily_window_policy VALUES(true,'America/Chicago','03:00','06:00');
CREATE TABLE tournaments(id uuid,union_id uuid,format_contract text,status text,start_time timestamptz,satellite_target_id uuid,satellite_target uuid,tournament_type text,variant text,max_players int,min_players int,table_size int,satellite_seats int,current_players int);
CREATE TABLE profiles(id uuid,is_horse boolean);CREATE TABLE tournament_players(tournament_id uuid,user_id uuid,status text,registered_at timestamptz);
CREATE TABLE smarter_private.sng_horse_days(union_id uuid,local_day date,slots jsonb,PRIMARY KEY(union_id,local_day));
CREATE TABLE smarter_private.sng_horse_claims(tournament_id uuid PRIMARY KEY,union_id uuid,local_day date,slot int,first_paid_at timestamptz,wait_seconds int,legacy boolean DEFAULT false);
CREATE FUNCTION fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION fn_ca_is_fixed_sng_satellite(jsonb) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION fn_ca_satellite_target_accepts_new_feeder(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION smarter_private.sng_horse_wait_until(timestamptz,integer) RETURNS timestamptz LANGUAGE sql AS 'SELECT $1+make_interval(secs=>$2)';
'''+pre['definition']+''';REVOKE ALL ON FUNCTION smarter_private.sng_horse_plan(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fixture.assert_true(b boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION '%',msg;END IF;END$$;
''')
  assert q("SELECT md5(pg_get_functiondef('smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure));")==pre['digest']
  # Real old planner creates impossible slots: controlled random stream only in fixture.
  q("""SELECT setseed(0.25);DO $$DECLARE u uuid; t uuid; target uuid; i int;BEGIN FOR i IN 1..40 LOOP
 u:=md5('union'||i)::uuid;t:=md5('board'||i)::uuid;target:=md5('target'||i)::uuid;
 INSERT INTO tournaments VALUES(target,u,'mtt-v2','REGISTERING',now()+interval '2 days',NULL,NULL,'MTT','mtt',100,2,9,0,0);
 INSERT INTO tournaments VALUES(t,u,'sng-v1','REGISTERING',now(),target,NULL,'SNG','sng',9,9,9,2,0);
 PERFORM smarter_private.sng_horse_plan(t,false);END LOOP;END$$;""")
  assert int(q("SELECT count(*) FROM smarter_private.sng_horse_days d,LATERAL jsonb_array_elements(slots)s WHERE tstzrange((s->>'due')::timestamptz,(s->>'expires')::timestamptz,'[)') && tstzrange((local_day+time '03:00') AT TIME ZONE 'America/Chicago',(local_day+time '06:00') AT TIME ZONE 'America/Chicago','[)');"))>0
  cases.append('exact_old_planner_generates_closed_hour_slots')
  owner=q("SELECT jsonb_build_array(proowner,proacl,prosecdef,proconfig) FROM pg_proc WHERE oid='smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure")
  q("GRANT EXECUTE ON FUNCTION smarter_private.sng_horse_plan(uuid,boolean) TO authenticated;")
  q(M.read_text(),'SNG_OPEN_SLOTS_OWNER_CHANGED')
  q("REVOKE EXECUTE ON FUNCTION smarter_private.sng_horse_plan(uuid,boolean) FROM authenticated;")
  cases.append('unexpected_planner_acl_refuses_installation')
  q(M.read_text())
  assert q("SELECT jsonb_build_array(proowner,proacl,prosecdef,proconfig) FROM pg_proc WHERE oid='smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure")==owner
  cases.append('exact_migration_preserves_planner_owner_acl_security')
  q(M.read_text(),'SNG_OPEN_SLOTS_PREIMAGE_CHANGED');cases.append('replay_refuses_changed_preimage')
  proof=next(x.removeprefix('-- @live-proof: ') for x in M.read_text().splitlines() if x.startswith('-- @live-proof: '))
  assert q('SELECT '+proof+';')=='t';cases.append('exact_live_proof_passes')
  q("DELETE FROM smarter_private.sng_horse_days;SELECT setseed(0.25);DO $$DECLARE t record;BEGIN FOR t IN SELECT id FROM tournaments WHERE format_contract='sng-v1' LOOP PERFORM smarter_private.sng_horse_plan(t.id,false);END LOOP;END$$;")
  assert q("SELECT count(*) FROM smarter_private.sng_horse_days d,LATERAL jsonb_array_elements(slots)s WHERE tstzrange((s->>'due')::timestamptz,(s->>'expires')::timestamptz,'[)') && tstzrange((local_day+time '03:00') AT TIME ZONE 'America/Chicago',(local_day+time '06:00') AT TIME ZONE 'America/Chicago','[)');")=='0'
  assert q("SELECT bool_and(jsonb_array_length(slots) BETWEEN 3 AND 5) FROM smarter_private.sng_horse_days")=='t'
  cases.append('exact_new_planner_same_random_stream_has_only_eligible_slots')
  # Explicit deterministic calendar fixtures exercise full, partial, current,
  # expired and claimed slots; each retains its array index and selected board.
  q('''CREATE FUNCTION fixture.slots(d date) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_array(
 jsonb_build_object('slot',0,'due',(d+time '03:18') AT TIME ZONE 'America/Chicago','expires',(d+time '03:38') AT TIME ZONE 'America/Chicago','tournament_id','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
 jsonb_build_object('slot',1,'due',(d+time '14:12') AT TIME ZONE 'America/Chicago','expires',(d+time '14:32') AT TIME ZONE 'America/Chicago'),
 jsonb_build_object('slot',2,'due',(d+time '17:35') AT TIME ZONE 'America/Chicago','expires',(d+time '17:55') AT TIME ZONE 'America/Chicago'))$$;
DO $$DECLARE d date;s jsonb;r jsonb;r2 jsonb;at_time timestamptz;BEGIN
 FOREACH d IN ARRAY ARRAY['2026-11-04'::date,'2026-03-08'::date,'2026-11-01'::date] LOOP
  s:=fixture.slots(d);at_time:=(d+time '02:30') AT TIME ZONE 'America/Chicago';
  r:=smarter_private.sng_horse_open_slots(d,s,'{}',at_time);
  PERFORM fixture.assert_true(jsonb_array_length(r)=3 AND r->0->>'slot'='0' AND r->0->>'tournament_id'=s->0->>'tournament_id' AND r->1=s->1 AND r->2=s->2,'count identity board and valid windows preserved');
  PERFORM fixture.assert_true(NOT(tstzrange((r->0->>'due')::timestamptz,(r->0->>'expires')::timestamptz,'[)') && tstzrange((d+time '03:00') AT TIME ZONE 'America/Chicago',(d+time '06:00') AT TIME ZONE 'America/Chicago','[)')),'ordinary and DST closed hours excluded');
  r2:=smarter_private.sng_horse_open_slots(d,r,'{}',at_time);PERFORM fixture.assert_true(r2=r,'normalization idempotent');
  PERFORM fixture.assert_true(smarter_private.sng_horse_open_slots(d,s,ARRAY[0],at_time)=s,'claimed window immutable');
  PERFORM fixture.assert_true(smarter_private.sng_horse_open_slots(d,s,'{}',(d+time '06:00') AT TIME ZONE 'America/Chicago')=s,'expired impossible window not resurrected');
  r:=smarter_private.sng_horse_open_slots(d,s,'{}',(d+time '03:25') AT TIME ZONE 'America/Chicago');
  PERFORM fixture.assert_true((r->0->>'due')::timestamptz>=(d+time '06:00') AT TIME ZONE 'America/Chicago','already due unexpired impossible window resampled after reopening');
 END LOOP;
 d:='2026-11-04';s:=fixture.slots(d);
 s:=jsonb_set(s,'{0}',s->0||jsonb_build_object('due','2026-11-04T08:50:00Z','expires','2026-11-04T09:10:00Z'));
 r:=smarter_private.sng_horse_open_slots(d,s,'{}','2026-11-04T08:40Z');
 PERFORM fixture.assert_true((r->0->>'due')::timestamptz='2026-11-04T08:50Z' AND (r->0->>'expires')::timestamptz='2026-11-04T09:00Z','partial window trimmed without new random opportunity');
 PERFORM fixture.assert_true(smarter_private.sng_horse_open_slots(d,s,'{}','2026-11-04T09:05Z')=s,'elapsed eligible portion not reopened');
 s:=jsonb_set(s,'{0}',s->0||jsonb_build_object('due','2026-11-04T11:50:00Z','expires','2026-11-04T12:10:00Z'));
 r:=smarter_private.sng_horse_open_slots(d,s,'{}','2026-11-04T08:40Z');
 PERFORM fixture.assert_true((r->0->>'due')::timestamptz='2026-11-04T12:00Z' AND (r->0->>'expires')::timestamptz='2026-11-04T12:10Z','partial reopening window retains original expiry');
 END$$;''')
  cases+=['ordinary_spring_and_fall_dst','claimed_and_expired_immutable','selected_board_and_slot_indices_preserved','idempotence','already_due_closed_window','partial_windows_trimmed','missed_eligible_portion_not_reopened']
  q("""BEGIN;UPDATE smarter_private.daily_window_policy SET time_zone='America/New_York';
DO $$DECLARE r jsonb; BEGIN r:=smarter_private.sng_horse_open_slots('2026-11-04',fixture.slots('2026-11-04'),'{}','2026-11-04T06:00Z');
PERFORM fixture.assert_true(NOT(tstzrange((r->0->>'due')::timestamptz,(r->0->>'expires')::timestamptz,'[)') && tstzrange('2026-11-04T08:00Z','2026-11-04T11:00Z','[)')),'policy New York closure with Chicago allocation day');END$$;ROLLBACK;
BEGIN;UPDATE smarter_private.daily_window_policy SET time_zone='Europe/London';
DO $$DECLARE s jsonb;r jsonb;BEGIN s:=jsonb_set(fixture.slots('2026-11-04'),'{0}',jsonb_build_object('slot',0,'due','2026-11-05T03:18Z','expires','2026-11-05T03:38Z'));
r:=smarter_private.sng_horse_open_slots('2026-11-04',s,'{}','2026-11-04T06:00Z');
PERFORM fixture.assert_true((r->0->>'due')::timestamptz>='2026-11-04T06:00Z' AND (r->0->>'expires')::timestamptz<='2026-11-05T03:00Z','adjacent policy date closure subtracted without changing Chicago day');END$$;ROLLBACK;""");cases.append('alternate_policy_zones_keep_Chicago_day_and_subtract_adjacent_closure')
  # Exercise the existing-day paid/planning fork deterministically, only after
  # exact migration/live-proof qualification. Substitute only this planner's
  # wall-clock reads in the isolated database; restore its exact definition.
  real_definition=json.loads(q("SELECT to_json(pg_get_functiondef('smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure));"))
  real_hash=q("SELECT md5(pg_get_functiondef('smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure));")
  assert real_definition.count('clock_timestamp()')==3
  deterministic=real_definition.replace('clock_timestamp()', "TIMESTAMPTZ '2026-11-04 08:30:00+00'")
  try:
   q(deterministic)
   q("""INSERT INTO tournaments VALUES
 ('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','mtt-v2','REGISTERING','2026-11-05T20:00Z',NULL,NULL,'MTT','mtt',100,2,9,0,0),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','sng-v1','REGISTERING','2026-11-04T08:30Z','cccccccc-cccc-cccc-cccc-cccccccccccc',NULL,'SNG','sng',9,9,9,2,0);
INSERT INTO smarter_private.sng_horse_days VALUES('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-11-04',fixture.slots('2026-11-04'));
DO $$DECLARE before_slots jsonb;after_slots jsonb;before_claims jsonb;r jsonb;BEGIN
 SELECT slots INTO before_slots FROM smarter_private.sng_horse_days WHERE union_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND local_day='2026-11-04';
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY tournament_id),'[]') INTO before_claims FROM smarter_private.sng_horse_claims c;
 r:=smarter_private.sng_horse_plan('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
 PERFORM fixture.assert_true(r->>'reason'='plan_not_initialized' AND r->>'ok'='false'
  AND before_slots=(SELECT slots FROM smarter_private.sng_horse_days WHERE union_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND local_day='2026-11-04')
  AND before_claims=(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY tournament_id),'[]') FROM smarter_private.sng_horse_claims c),'paid normalization refuses without persisting draw or claim');
 PERFORM smarter_private.sng_horse_plan('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
 SELECT slots INTO after_slots FROM smarter_private.sng_horse_days WHERE union_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND local_day='2026-11-04';
 PERFORM fixture.assert_true(after_slots IS DISTINCT FROM before_slots AND jsonb_array_length(after_slots)=3
  AND after_slots->0->>'tournament_id'=before_slots->0->>'tournament_id'
  AND NOT(tstzrange((after_slots->0->>'due')::timestamptz,(after_slots->0->>'expires')::timestamptz,'[)') && tstzrange('2026-11-04T09:00Z','2026-11-04T12:00Z','[)'))
  AND before_claims=(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY tournament_id),'[]') FROM smarter_private.sng_horse_claims c),'planning caller persists eligible timing without claim');
 PERFORM smarter_private.sng_horse_plan('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
 PERFORM fixture.assert_true(after_slots=(SELECT slots FROM smarter_private.sng_horse_days WHERE union_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND local_day='2026-11-04')
  AND before_claims=(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY tournament_id),'[]') FROM smarter_private.sng_horse_claims c),'repeat planning retains the committed draw');
END$$;""")
  finally:q(real_definition)
  assert q("SELECT md5(pg_get_functiondef('smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure));")==real_hash
  assert q("SELECT jsonb_build_array(proowner,proacl,prosecdef,proconfig) FROM pg_proc WHERE oid='smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure")==owner
  assert q('SELECT '+proof+';')=='t'
  cases+=['paid_normalization_refuses_without_persisting_draw_or_claim','planning_normalization_persists','repeat_planning_retains_draw','real_planner_definition_hash_acl_restored']
  q("SET ROLE anon;SELECT smarter_private.sng_horse_open_slots(NULL,NULL,NULL,NULL);",'permission denied');cases.append('private_helper_denies_public')
  hashes=json.loads(q("SELECT jsonb_object_agg(proname,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='smarter_private' AND proname IN('sng_horse_plan','sng_horse_open_slots');"))
  print(json.dumps({'passed':cases,'count':len(cases),'migration':M.name,'hashes':hashes},indent=2))
 finally:run([pg/'pg_ctl','-D',data,'-m','immediate','-w','stop'])
