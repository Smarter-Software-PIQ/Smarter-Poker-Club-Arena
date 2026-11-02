#!/usr/bin/env python3
"""Native isolated PostgreSQL qualification; no production connection or credentials."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261026231712_halve_cash_capacity_and_rank_cash_horses_by_performance.sql"
sql = MIGRATION.read_text()
# The maintained latest scope guard must qualify in the existing accounting job.
SCOPE = ROOT / "supabase/migrations/20261027152318_scope_the_horse_cash_roster_to_club_arena.sql"
scope_sql = SCOPE.read_text()
def definition(name):
    match = re.search(r"CREATE OR REPLACE FUNCTION public\." + name + r"\([\s\S]*?AS \$function\$[\s\S]*?\$function\$;", sql)
    assert match, name
    return match.group(0)

bootstrap = """
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TYPE public.cash_cluster_census_row AS (id uuid,role text,main_index integer,lifecycle text,status text,created_at timestamptz,max_players integer,seated integer,reserved integer,open_unreserved integer,breaking boolean);
CREATE FUNCTION fn_platform_frozen() RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE TABLE cash_games(enabled boolean,closed_at timestamptz,state text);
INSERT INTO cash_games VALUES(true,null,'live'),(false,null,'live'),(true,now(),'live');
CREATE TABLE profiles(id uuid primary key,is_horse boolean,status text,horse_status text);
CREATE TABLE ca_horse_fleet_register(horse_id uuid primary key,retired_at timestamptz);
CREATE TABLE horse_daily_nets(horse_user_id uuid, hands bigint,net_bb numeric,format text,day date,game_variant text);
CREATE TABLE ca_horse_active_roster(horse_id uuid primary key,rank integer,hands bigint,bb100 numeric);
CREATE TABLE ca_horse_plo_roster(horse_id uuid primary key,rank integer,plo_hands bigint,plo_bb100 numeric);
CREATE TABLE stable_hand_membership_tags(
 horse_id uuid NOT NULL,club_id uuid NOT NULL,mode text NOT NULL,cash_freeroll boolean NOT NULL DEFAULT false,
 persona_cash text,persona_mtt text,variants text[] NOT NULL DEFAULT '{}',preferred_stakes numeric[] NOT NULL DEFAULT '{}',
 max_tables smallint NOT NULL DEFAULT 1,tagged_at timestamptz NOT NULL DEFAULT now(),tag_seed text NOT NULL,
 PRIMARY KEY(horse_id,club_id),
 CONSTRAINT sh_cash_persona_presence CHECK (((mode='tourney') AND persona_cash IS NULL) OR ((mode<>'tourney') AND persona_cash IS NOT NULL)),
 CONSTRAINT sh_freeroll_is_cash_only CHECK (NOT cash_freeroll OR mode='cash'),
 CONSTRAINT sh_tourney_only_one_table CHECK (mode<>'tourney' OR max_tables=1),
 CHECK (max_tables BETWEEN 0 AND 4),CHECK (mode IN ('cash','tourney','both')),
 CHECK (persona_cash IN ('grinder','regular','mixer','night_owl','weekend_heavy')),
 CHECK (persona_mtt IN ('mtt_grinder','mtt_regular','mtt_late_reg')));
CREATE TABLE ca_horse_roster_cash_tag_backup(
 horse_id uuid NOT NULL,club_id uuid NOT NULL,mode text NOT NULL,cash_freeroll boolean NOT NULL,
 persona_cash text,persona_mtt text,variants text[] NOT NULL,preferred_stakes numeric[] NOT NULL,max_tables smallint NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(horse_id,club_id));
CREATE TABLE ca_horse_roster_log(size integer,demand integer,active uuid[],plo uuid[],result jsonb);
CREATE TABLE clubs(id uuid primary key,asset text,is_platform boolean,union_id uuid);
CREATE TABLE tables(id uuid primary key,tournament_id uuid,club_id uuid,union_id uuid);
CREATE TABLE table_seats(user_id uuid,table_id uuid,left_at timestamptz,active_game_scope uuid,stack numeric);
INSERT INTO profiles SELECT lpad(i::text,32,'0')::uuid,true,'active',case when i=13 then 'disabled' else 'available' end FROM generate_series(1,14) i;
INSERT INTO ca_horse_fleet_register SELECT id,case when id=lpad('14',32,'0')::uuid then now() else null end FROM profiles;
INSERT INTO horse_daily_nets SELECT id,case when id=lpad('12',32,'0')::uuid then 10 else 6000 end,
  case when id in(lpad('12',32,'0')::uuid,lpad('13',32,'0')::uuid,lpad('14',32,'0')::uuid) then 999999 else 1000-i*100 end,
  'cash',current_date,'nlh' FROM profiles p JOIN generate_series(1,14) i ON p.id=lpad(i::text,32,'0')::uuid WHERE i<>11;
INSERT INTO stable_hand_membership_tags(horse_id,club_id,mode,cash_freeroll,persona_cash,persona_mtt,variants,preferred_stakes,max_tables,tag_seed)
 SELECT id,lpad('99',32,'0')::uuid,CASE WHEN id=lpad('1',32,'0')::uuid THEN 'cash' ELSE 'both' END,
 id=lpad('1',32,'0')::uuid,'grinder','mtt_regular',array['nlh'],array[1]::numeric[],4,'roster-cash' FROM profiles;
CREATE TEMP TABLE original_tags AS SELECT * FROM stable_hand_membership_tags;
"""
capacity = re.search(r"  v_table_cap := g.cap_mains \+ 1;[\s\S]*?v_table_cap := greatest\(1, floor\(v_table_cap \* 0.5\)::integer\);", definition("fn_cash_cluster_tick")).group(0)
capacity_proof = """
CREATE FUNCTION pg_temp.table_cap(p_cap integer,p_second boolean) RETURNS integer LANGUAGE plpgsql AS $cap$
DECLARE g record;v_table_cap integer;
BEGIN SELECT p_cap cap_mains,p_second allow_second_feeder INTO g;
""" + capacity + """
RETURN v_table_cap; END $cap$;
DO $proof$ DECLARE cap integer;second boolean;expected integer; BEGIN
FOR cap IN 1..32 LOOP FOREACH second IN ARRAY ARRAY[false,true] LOOP
 expected := floor((cap+1+CASE WHEN second THEN 1 ELSE 0 END)::numeric/2);
 IF pg_temp.table_cap(cap,second)<>expected THEN RAISE EXCEPTION 'capacity not half'; END IF;
END LOOP; END LOOP;
IF (fn_cash_cluster_tick(lpad('1',32,'0')::uuid)->>'skipped') <> 'frozen' THEN RAISE EXCEPTION 'freeze guard lost'; END IF;
END $proof$;
"""
assertions = """
DO $proof$ BEGIN
 IF has_function_privilege('anon','public.fn_ca_horse_roster_seat_guard()','EXECUTE')
    OR has_function_privilege('authenticated','public.fn_ca_horse_roster_seat_guard()','EXECUTE')
    OR NOT has_function_privilege('service_role','public.fn_ca_horse_roster_seat_guard()','EXECUTE')
    OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.fn_ca_horse_roster_seat_guard()'::regprocedure)
 THEN RAISE EXCEPTION 'scope migration changed service-role-only security definer contract'; END IF;
END $proof$;
SELECT fn_ca_horse_roster_refresh(999);
DO $proof$ BEGIN
  IF (SELECT demand FROM ca_horse_roster_log ORDER BY size LIMIT 1)<>1 THEN RAISE EXCEPTION 'live game demand was fabricated'; END IF;
  IF (SELECT array_agg(rank order by rank) FROM ca_horse_active_roster) <> array[1,2,3,4,5,6]
    OR (SELECT count(*) FROM ca_horse_active_roster WHERE horse_id IN(SELECT lpad(i::text,32,'0')::uuid FROM generate_series(1,6)i))<>6
  THEN RAISE EXCEPTION 'top half or sample admission wrong'; END IF;
  IF (SELECT count(*) FROM stable_hand_membership_tags WHERE mode='tourney')<>8
    OR (SELECT count(*) FROM ca_horse_roster_cash_tag_backup)<>8
  THEN RAISE EXCEPTION 'cash bench not persisted'; END IF;
  IF EXISTS(SELECT 1 FROM stable_hand_membership_tags WHERE mode='tourney' AND (persona_cash IS NOT NULL OR cash_freeroll OR max_tables<>1))
  THEN RAISE EXCEPTION 'benched tag violates live cash/tournament constraints'; END IF;
  IF EXISTS(SELECT 1 FROM stable_hand_membership_tags t JOIN original_tags o USING(horse_id,club_id)
    WHERE t.persona_mtt IS DISTINCT FROM o.persona_mtt OR t.tag_seed IS DISTINCT FROM o.tag_seed OR t.tagged_at IS DISTINCT FROM o.tagged_at)
  THEN RAISE EXCEPTION 'bench changed tournament persona or tag provenance'; END IF;
  IF EXISTS(SELECT 1 FROM ca_horse_plo_roster WHERE plo_hands<>0 OR plo_bb100 IS NOT NULL)
  THEN RAISE EXCEPTION 'PLO measurements fabricated from NLH'; END IF;
END $proof$;
SELECT fn_ca_horse_roster_refresh();
DO $proof$ BEGIN
 IF (SELECT count(*) FROM ca_horse_roster_cash_tag_backup)<>8 THEN RAISE EXCEPTION 'duplicate backup'; END IF;
END $proof$;
INSERT INTO clubs VALUES(lpad('99',32,'0')::uuid,'chips',false,null),
 (lpad('98',32,'0')::uuid,'diamonds',true,null),
 (lpad('97',32,'0')::uuid,'diamonds',false,null);
INSERT INTO tables VALUES(lpad('101',32,'0')::uuid,null,lpad('99',32,'0')::uuid,null),
 (lpad('102',32,'0')::uuid,lpad('1001',32,'0')::uuid,lpad('99',32,'0')::uuid,null),
 (lpad('103',32,'0')::uuid,null,lpad('98',32,'0')::uuid,null),
 (lpad('104',32,'0')::uuid,null,lpad('98',32,'0')::uuid,lpad('88',32,'0')::uuid),
 (lpad('105',32,'0')::uuid,null,lpad('97',32,'0')::uuid,null);

CREATE TRIGGER roster BEFORE INSERT OR UPDATE ON table_seats FOR EACH ROW EXECUTE FUNCTION fn_ca_horse_roster_seat_guard();
INSERT INTO table_seats VALUES(lpad('1',32,'0')::uuid,lpad('101',32,'0')::uuid,null,null,100);
INSERT INTO table_seats VALUES(lpad('8',32,'0')::uuid,lpad('102',32,'0')::uuid,null,null,100);
DO $proof$ BEGIN
 BEGIN
  INSERT INTO table_seats VALUES(lpad('8',32,'0')::uuid,lpad('101',32,'0')::uuid,null,null,100);
  RAISE EXCEPTION 'benched cash admission succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $proof$;
-- The same off-roster horse may buy a Diamond seat, but not fake/union arenas.
INSERT INTO table_seats VALUES(lpad('8',32,'0')::uuid,lpad('103',32,'0')::uuid,null,null,100);
DO $proof$ DECLARE target integer;horse integer; BEGIN
 FOREACH target IN ARRAY ARRAY[104,105] LOOP
  BEGIN
   INSERT INTO table_seats VALUES(lpad('8',32,'0')::uuid,lpad(target::text,32,'0')::uuid,null,null,100);
   RAISE EXCEPTION 'malformed Diamond scope bypassed Club roster';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 FOREACH horse IN ARRAY ARRAY[13,14] LOOP
  BEGIN
   INSERT INTO table_seats VALUES(lpad(horse::text,32,'0')::uuid,lpad('103',32,'0')::uuid,null,null,100);
   RAISE EXCEPTION 'disabled/retired horse gained new Diamond admission';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $proof$;
-- Bench the already-seated horse through a genuine performance reorder.
UPDATE horse_daily_nets SET net_bb=-9999 WHERE horse_user_id=lpad('1',32,'0')::uuid;
SELECT fn_ca_horse_roster_refresh();
UPDATE table_seats SET stack=110 WHERE user_id=lpad('1',32,'0')::uuid;
UPDATE table_seats SET left_at=now() WHERE user_id=lpad('1',32,'0')::uuid;
UPDATE horse_daily_nets SET net_bb=9999 WHERE horse_user_id=lpad('1',32,'0')::uuid;
SELECT fn_ca_horse_roster_refresh();
DO $proof$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM stable_hand_membership_tags t JOIN original_tags o USING(horse_id,club_id) WHERE t.horse_id=lpad('1',32,'0')::uuid AND to_jsonb(t)=to_jsonb(o))
 THEN RAISE EXCEPTION 'returned performer lost original tag'; END IF;
 IF (SELECT count(*) FROM table_seats)<>3 THEN RAISE EXCEPTION 'existing seats changed'; END IF;
 IF (SELECT count(*) FROM profiles WHERE horse_status='disabled')<>1 THEN RAISE EXCEPTION 'global horse state changed'; END IF;
END $proof$;
"""
# November owner update: qualify the exact migration on the same isolated database.
NOVEMBER = ROOT / "supabase/migrations/20261102015546_restrict_horse_cash_games_and_reduce_schedule_at_chicago_midnight.sql"
november_sql = NOVEMBER.read_text()
cluster_before = (ROOT / "scripts/qualification/fixtures/horse-cash-november/cluster-before.sql").read_text()
november_setup = """
ALTER TABLE tables ADD COLUMN game_variant text DEFAULT 'nlh', ADD COLUMN small_blind numeric DEFAULT 0.5, ADD COLUMN big_blind numeric DEFAULT 1;
"""
november_assertions = """
DO $proof$ DECLARE v text; BEGIN
 FOREACH v IN ARRAY ARRAY['pineapple','crazy_pineapple','short_deck','shortdeck','6+','plo8','plo4','plo5','plo6'] LOOP
  IF NOT fn_horse_cash_game_allowed(v,2,5,null,'2026-11-02 05:59:59.999+00')
   OR fn_horse_cash_game_allowed(v,2,5,null,'2026-11-02 06:00+00')
   OR NOT fn_horse_cash_game_allowed(v,2,5,lpad('1001',32,'0')::uuid,'2026-11-02 06:00+00')
  THEN RAISE EXCEPTION 'boundary, tournament preservation or exclusion failed: %',v; END IF;
 END LOOP;
 FOREACH v IN ARRAY ARRAY['plo4','plo5','plo6'] LOOP
  IF NOT fn_horse_cash_game_allowed(v,.5,1,null,'2026-11-02 06:00+00')
   OR fn_horse_cash_game_allowed(v,1,2,null,'2026-11-02 06:00+00')
   OR fn_horse_cash_game_allowed(v,.5,null,null,'2026-11-02 06:00+00')
  THEN RAISE EXCEPTION 'PLO limit or unknown stake failed: %',v; END IF;
 END LOOP;
 IF NOT fn_horse_cash_game_allowed('nlh',1,2,null,'2026-11-02 06:00+00')
   OR NOT fn_horse_cash_game_allowed('flo8',.5,1,null,'2026-11-02 06:00+00')
 THEN RAISE EXCEPTION 'unrelated cash game changed'; END IF;
 IF has_function_privilege('anon','fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)','EXECUTE')
   OR NOT has_function_privilege('service_role','fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'cash policy ACL wrong'; END IF;
 IF (fn_cash_cluster_tick(lpad('1',32,'0')::uuid)->>'skipped') <> 'frozen' THEN RAISE EXCEPTION 'freeze guard lost'; END IF;
END $proof$;
"""
# Exercise the installed guard at a future date without changing the host clock.
# Only the helper's DEFAULT argument is fixed in this isolated database;
# the candidate body and the trigger remain byte-for-byte the installed source.
helper = re.search(r"CREATE OR REPLACE FUNCTION public\.fn_horse_cash_game_allowed\([\s\S]*?\$function\$;", november_sql).group(0)
future_helper = helper.replace('DEFAULT now()', "DEFAULT '2026-11-02 06:00+00'::timestamptz")
november_guard_proof = """
UPDATE tables SET game_variant='plo5',small_blind=2,big_blind=5;
DO $proof$ DECLARE target integer; BEGIN
 FOREACH target IN ARRAY ARRAY[101,103] LOOP
  BEGIN
   INSERT INTO table_seats VALUES(lpad('1',32,'0')::uuid,lpad(target::text,32,'0')::uuid,null,null,100);
   RAISE EXCEPTION 'restricted horse admitted in Club or Diamond cash';
  EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM NOT LIKE 'horse_cash_game_restricted:%' THEN RAISE; END IF;
  END;
 END LOOP;
END $proof$;
-- Tournament seats, humans, settlement updates and pending owned moves survive.
INSERT INTO table_seats VALUES(lpad('1',32,'0')::uuid,lpad('102',32,'0')::uuid,null,null,100);
INSERT INTO profiles VALUES(lpad('90',32,'0')::uuid,false,'active',null);
INSERT INTO table_seats VALUES(lpad('90',32,'0')::uuid,lpad('101',32,'0')::uuid,null,null,100);
UPDATE table_seats SET stack=105,active_game_scope=lpad('77',32,'0')::uuid WHERE table_id=lpad('103',32,'0')::uuid;
INSERT INTO table_seats VALUES(lpad('8',32,'0')::uuid,lpad('101',32,'0')::uuid,null,lpad('77',32,'0')::uuid,105);
UPDATE table_seats SET left_at=now() WHERE user_id=lpad('8',32,'0')::uuid;
"""
capacity_after = re.search(r"  v_table_cap := g.cap_mains \+ 1;[\s\S]*?v_table_cap := greatest\(1, floor\(v_table_cap \* 0.5\)::integer\);", cluster_before).group(0)
replacement = re.search(r"\$insert\$(v_table_cap := greatest[\s\S]*?)\$insert\$", november_sql).group(1)
capacity_after = capacity_after.replace('v_table_cap := greatest(1, floor(v_table_cap * 0.5)::integer);',replacement)
november_capacity_proof = """
CREATE FUNCTION pg_temp.november_cap(p_cap integer,p_second boolean,p_at timestamptz) RETURNS integer LANGUAGE plpgsql AS $cap$
DECLARE g record;v_table_cap integer;v_now timestamptz:=p_at;
BEGIN SELECT p_cap cap_mains,p_second allow_second_feeder INTO g;
""" + capacity_after + """
RETURN v_table_cap; END $cap$;
DO $proof$ DECLARE cap integer;second boolean; BEGIN
FOR cap IN 1..32 LOOP FOREACH second IN ARRAY ARRAY[false,true] LOOP
 IF pg_temp.november_cap(cap,second,'2026-11-02 05:59:59+00') <> greatest(1,floor((cap+1+CASE WHEN second THEN 1 ELSE 0 END)*.5)::integer)
 OR pg_temp.november_cap(cap,second,'2026-11-02 06:00+00') <> greatest(1,floor((cap+1+CASE WHEN second THEN 1 ELSE 0 END)*.2)::integer)
 THEN RAISE EXCEPTION 'dated capacity reduction wrong'; END IF;
END LOOP; END LOOP;
END $proof$;
"""
guarantee_sql = (ROOT / "supabase/migrations/20261102022808_halve_unentered_future_tournament_guarantees_except_sunday_2.sql").read_text()
guarantee_setup = (ROOT / "scripts/qualification/fixtures/horse-cash-november/guarantees.sql").read_text()
guarantee_proof = (ROOT / "scripts/qualification/fixtures/horse-cash-november/guarantee-proof.sql").read_text()
work = Path(os.environ.get("RUNNER_TEMP", str(ROOT / "work")))
work.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="cash-half-pg-", dir=work) as directory:
    d = Path(directory)
    bindir = Path(os.environ["PG_BIN"]) if "PG_BIN" in os.environ else Path(shutil.which("initdb") or "/opt/homebrew/bin/initdb").parent
    env = {**os.environ, "PGHOST": str(d), "PGPORT": "55439", "PGUSER": os.environ.get("USER", "smarter.poker"), "PGDATABASE": "postgres"}
    subprocess.run([str(bindir/"initdb"), "-D", str(d/"data"), "-A", "trust", "--no-locale"], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(bindir/"pg_ctl"), "-D", str(d/"data"), "-l", str(d/"postgres.log"), "-o", f"-k {d} -p 55439 -c listen_addresses='' -c fsync=off", "start"], check=True, stdout=subprocess.DEVNULL)
    try:
        subprocess.run([str(bindir/"psql"), "-X", "-v", "ON_ERROR_STOP=1"], input=bootstrap+definition("fn_ca_horse_roster_refresh")+definition("fn_ca_horse_roster_seat_guard")+scope_sql+definition("fn_cash_cluster_tick")+capacity_proof+assertions+november_setup+cluster_before+november_sql+november_assertions+future_helper+november_guard_proof+november_capacity_proof+guarantee_setup+guarantee_sql+guarantee_proof+guarantee_sql+guarantee_proof, text=True, env=env, check=True, stdout=subprocess.DEVNULL)
        print("PASS: guarantee reduction and repeat application, entered/running/locked/finalized preservation, accurate labels; November midnight policy, every prohibited variant, PLO ceiling, tournament/human/owned-move/settlement preservation, both dated capacity branches; native ranking/sample/disabled/retired, idempotency, bench/restore, truthful PLO metrics, Club cash denial, Diamond off-roster admission, malformed Diamond/disabled/retired refusal, tournament admission, existing-seat update/exit")
    finally:
        subprocess.run([str(bindir/"pg_ctl"), "-D", str(d/"data"), "stop", "-m", "fast"], check=True, stdout=subprocess.DEVNULL)
