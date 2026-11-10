"""Actual installed table producer on the existing disposable Lightning estate.
Only the picker clock is adapted; no production access or replacement writer.
"""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import subprocess
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PG = Path(os.environ['PG_BIN'])
SOCKET = os.environ['LIGHTNING_ZERO_PAYER_SOCKET']
PORT = os.environ['LIGHTNING_ZERO_PAYER_PORT']
GAME = 'c79d8ec2-2281-411d-b4e1-42b5610849e2'
MIGRATION = ROOT/'supabase/migrations/20261110001650_plo_lightning_opens_its_paced_startup_feeder.sql'
assert Path(SOCKET).is_absolute(), 'Disposable socket required'

def sql(text, database='postgres'):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql') as f:
        f.write('SET client_min_messages=warning;\n'+text); f.flush()
        p = subprocess.run([str(PG/'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
            '-h', SOCKET, '-p', PORT, '-d', database, '-f', f.name],
            text=True, capture_output=True, timeout=60)
    if p.returncode:
        raise RuntimeError(p.stdout+p.stderr)
    return p.stdout.strip()

assert sql("SELECT inet_server_addr() IS NULL AND current_setting('listen_addresses')='' AND to_regnamespace('harness') IS NOT NULL;") == 't'
# Preserve all existing fixture constraints/defaults while adding the captured
# column projection needed by the current real opener and rule projector.
projection = ''
for table, columns in re.findall(r'CREATE TABLE public\.(\w+)\((.*?)\);', (HERE/'schema.sql').read_text()):
    for column in columns.split(','):
        name, kind = column.split(' ', 1)
        kind = kind.split(' PRIMARY KEY')[0].split(' DEFAULT ')[0]
        projection += f'ALTER TABLE public.{table} ADD COLUMN IF NOT EXISTS {name} {kind};\n'
base = (HERE/'installed-functions.sql').read_text()
physical = '\n'.join(re.findall(r'CREATE OR REPLACE FUNCTION public.fn_cash_(?:apply_ruleset|cluster_open_table)\([\s\S]*?(?=CREATE OR REPLACE FUNCTION|\Z)', base))
original = (ROOT/'supabase/migrations/20261109141301_plo_lightning_gradual_admission_and_feeder_lifecycle.sql').read_text()
physical += '\nDO $physical$'+original.split('DO $physical$', 1)[1].split('END $physical$;', 1)[0]+'END $physical$;\n'
predicates = (HERE/'installed-capacity-predicates.sql').read_text()
raw_pick = re.search(r'CREATE OR REPLACE FUNCTION public.fn_cash_game_second_table_picked[\s\S]*?(?=CREATE OR REPLACE FUNCTION|\Z)', predicates).group()
raw_pick = raw_pick.replace('public.fn_cash_game_second_table_picked', 'harness.raw_second_table_picked', 1)
clock = """
CREATE OR REPLACE FUNCTION public.fn_cash_game_second_table_picked(p_game_id uuid,p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT harness.raw_second_table_picked(p_game_id,coalesce(nullif(current_setting('harness.pick_at',true),'')::timestamptz,p_at)) $$;
"""
# The current census includes the full-ring reservation table even for6-max.
# Load its maintained schema/census, with no full-ring fixtures or new behavior.
full_ring=(ROOT/'supabase/migrations/20261108193515_a_full_ring_feeder_starts_with_the_last_two_to_sit.sql').read_text()
starts=re.search(r'CREATE TABLE IF NOT EXISTS public.cash_cluster_feeder_starts \([\s\S]*?\n\);',full_ring).group()

sql("SET SESSION AUTHORIZATION postgres; CREATE TABLE IF NOT EXISTS public.profiles(id uuid PRIMARY KEY,is_horse boolean); ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS asset text;\n"+projection+starts+physical+predicates+raw_pick+clock+(HERE/'installed-cluster-tick.sql').read_text())

def seed(game=GAME):
    return f"""DO $seed$ DECLARE g uuid:='{game}'; t uuid; u uuid; n integer; BEGIN
 INSERT INTO cash_games(id,club_id,union_id,name,template_name,variant,sb,bb,handedness,
 ruleset_snapshot,created_by,must_move,cap_mains,allow_second_feeder,lightning_enabled,enabled,cluster_mode,cluster_epoch)
 VALUES(g,'cb000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f1',
 'PLO producer','madness','plo4',1,2,6,
 '{{"seats":6,"template":"madness","lightning":{{"on_threshold":10,"off_threshold":4,"always_on":false}}}}',
 '00000000-0000-0000-0000-0000000000aa',true,8,false,true,true,'must_move',0);
 t:=fx9_table(g,'producer Main1','main',1,6);
 UPDATE tables SET game_variant='plo4',is_private=false WHERE id=t;
 FOR n IN 1..6 LOOP
  u:=gen_random_uuid(); INSERT INTO profiles(id,is_horse) VALUES(u,n>1);
  PERFORM fxr_join(g,t,n,400,n>1,true,u);
 END LOOP;
 END $seed$;"""

def picker(picked, game=GAME):
    return f"SELECT set_config('harness.pick_at',(SELECT t::text FROM generate_series('2026-11-01Z'::timestamptz,'2026-11-14Z'::timestamptz,interval '3 hours')t WHERE harness.raw_second_table_picked('{game}',t) IS {'TRUE' if picked else 'FALSE'} LIMIT 1),false);"

def check(opened, buyers=0, game=GAME):
    return f"""DO $check$ DECLARE r jsonb; n integer; BEGIN
 r:=fn_cash_cluster_tick('{game}',{buyers});
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Producer refused: %',r; END IF;
 SELECT count(*) INTO n FROM tables WHERE cluster_id='{game}' AND role='feeder' AND lifecycle='opening';
 IF (SELECT sum(ts.stack) FROM table_seats ts JOIN tables tb ON tb.id=ts.table_id WHERE tb.cluster_id='{game}' AND ts.left_at IS NULL)<>2400 THEN RAISE EXCEPTION 'Producer changed funded stacks'; END IF;
 IF n<>{opened} THEN RAISE EXCEPTION 'Actual producer expected {opened} feeder(s), got %: %',n,r; END IF;
 END $check$;"""

sql('BEGIN;'+seed()+picker(True)+check(0,1)+'ROLLBACK;')
sql('BEGIN;'+seed()+picker(False)+check(0,2)+'ROLLBACK;')
print('PASS: original actual producer stalls at six for one buyer or an unpicked one-table cap')
sql(MIGRATION.read_text())
sql(MIGRATION.read_text())  # exact definition/ACL owner and replay invariance
for picked in (False, True):
    sql('BEGIN;'+seed()+picker(picked)+check(1)+check(1)+'ROLLBACK;')
for edit in (
    "UPDATE profiles SET is_horse=true;",
    "UPDATE table_seats SET is_sitting_out=true WHERE user_id IN (SELECT id FROM profiles WHERE NOT is_horse);",
    "UPDATE table_seats SET leave_pending=true WHERE user_id IN (SELECT id FROM profiles WHERE NOT is_horse);",
    "UPDATE table_seats SET is_sitting_out=true WHERE user_id IN (SELECT id FROM profiles WHERE is_horse LIMIT 1);",
    f"UPDATE cash_games SET ruleset_snapshot=jsonb_set(ruleset_snapshot,'{{lightning,on_threshold}}','18') WHERE id='{GAME}';",
    f"INSERT INTO cash_cluster_events(game_id,kind) VALUES('{GAME}','feeder_abandoned');",
):
    sql('BEGIN;'+seed()+picker(True)+edit+check(0)+'ROLLBACK;')
other = 'c79d8ec2-2281-411d-b4e1-42b5610849e3'
sql('BEGIN;'+seed(other)+picker(True,other)+check(0,1,other)+check(1,2,other)+'ROLLBACK;')
print('PASS: picked/unpicked startup, replay, no human, pending/sitout/short-ready, config, cooldown and unrelated two-buyer controls')
# Actual concurrent backends share committed full-six rows, on a private clone
# of this existing fixture estate. The parent stays clean for pool composition.
child = 'plo_producer_'+uuid4().hex[:12]
try:
    sql(f'CREATE DATABASE {child} TEMPLATE postgres;')
    sql(seed(), child)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: sql(picker(False)+f"SELECT fn_cash_cluster_tick('{GAME}',0);", child), range(2)))
    assert sql(f"SELECT count(*)=1 FROM tables WHERE cluster_id='{GAME}' AND role='feeder' AND lifecycle='opening';", child) == 't'
    print('PASS: two actual concurrent producer backends open exactly one feeder')
finally:
    sql(f'DROP DATABASE IF EXISTS {child};')
assert sql(f"SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='{child}');") == 't'
print('PASS: disposable producer clone removed; parent ready for actual paced feeder/conversion/settlement composition')
