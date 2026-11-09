#!/usr/bin/env python3
"""Scoped seat transition on disposable PostgreSQL; no production connection.
The wallet harness checks PostgreSQL rollback around the real installed seat
trigger. Full Lightning settlement/conversion remains in its existing route.
"""
from pathlib import Path
import concurrent.futures
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
MIGRATION = ROOT / 'supabase/migrations/20261109141301_plo_lightning_gradual_admission_and_feeder_lifecycle.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
SCRATCH = Path(os.environ.get('TMPDIR', ROOT / 'work'))
SCRATCH.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='plo-life-', dir=SCRATCH))
socket = work / 's'
socket.mkdir()
GAME = 'c79d8ec2-2281-411d-b4e1-42b5610849e2'
HUMAN = '00000000-0000-0000-0000-000000000001'
TABLE = '00000000-0000-0000-0000-000000000100'

def run(args, ok=True):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, timeout=60)
    if ok and result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result

def sql(text, ok=True):
    # Unique files let real concurrent backend requests overlap.
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', dir=work, delete=False) as f:
        f.write(text)
        name = f.name
    try:
        return run([PG/'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket,
                    '-U', 'postgres', '-d', 'postgres', '-f', name], ok)
    finally:
        Path(name).unlink()

def check(text, expected='t'):
    got = sql(text).stdout.strip()
    assert got == expected, (text, got, expected)

def horse(n):
    return f'00000000-0000-0000-0000-{n:012d}'

def buy(n, at='2026-11-09T12:00:00Z'):
    return f"SELECT set_config('harness.now','{at}',false); SELECT harness.buy('{horse(n)}','{TABLE}',100);"

try:
    shared = Path(run([PG/'pg_config', '--sharedir']).stdout.strip())
    if not (shared/'postgres.bki').exists():
        shared = PG.parent/'share/postgresql'
    run([PG/'initdb', '-L', shared, '-D', work/'data', '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run([PG/'pg_ctl', '-D', work/'data', '-l', work/'postgres.log', '-o', f"-h '' -k {socket}", '-w', 'start'])
    check("SELECT inet_server_addr() IS NULL AND current_setting('listen_addresses')='';")
    sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA harness;
CREATE TABLE profiles(id uuid PRIMARY KEY,is_horse boolean,status text,horse_status text);
CREATE TABLE clubs(id uuid,asset text,is_platform boolean,union_id uuid);
CREATE TABLE ca_horse_active_roster(horse_id uuid);
CREATE TABLE ca_horse_fleet_register(horse_id uuid,retired_at timestamptz);
CREATE TABLE table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid,user_id uuid,
  stack numeric,left_at timestamptz,is_sitting_out boolean DEFAULT false,leave_pending boolean DEFAULT false,
  active_game_scope uuid,seat_number integer);
CREATE TABLE table_waitlist(table_id uuid,user_id uuid,status text,hold_expires_at timestamptz,notified_at timestamptz);
CREATE TABLE lightning_pool_session(cluster_id uuid,cluster_epoch integer,player_id uuid,anchor_seat_id uuid,state text,exited_at timestamptz);
CREATE TABLE lightning_reservation(cluster_id uuid,player_id uuid,state text,expires_at timestamptz);
CREATE TABLE cash_cluster_events(game_id uuid,table_id uuid,kind text,payload jsonb);
CREATE FUNCTION fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION fn_lightning_anchor_is_live_eligible(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM table_seats WHERE id=$1 AND user_id=$3 AND left_at IS NULL AND stack>0 AND NOT is_sitting_out AND NOT leave_pending) $$;
CREATE FUNCTION fn_cash_stakes_label(numeric,numeric,text) RETURNS text LANGUAGE sql AS $$ SELECT $1||'/'||$2 $$;
CREATE FUNCTION fn_kill_pot_configuration_refusal(text,text,text,uuid,boolean,numeric,uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION fn_capability_available(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE harness.wallet(player_id uuid PRIMARY KEY,balance numeric NOT NULL CHECK(balance>=0));
CREATE FUNCTION harness.buy(p uuid,t uuid,amount numeric) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 UPDATE harness.wallet SET balance=balance-amount WHERE player_id=p;
 INSERT INTO table_seats(table_id,user_id,stack,active_game_scope) SELECT t,p,amount,cluster_id FROM tables WHERE id=t;
END $$;
''')
    sql((HERE/'schema.sql').read_text())
    sql((HERE/'installed-functions.sql').read_text())
    sql(f'''CREATE TRIGGER zzzzzz_horse_roster_seat_guard BEFORE INSERT OR UPDATE OF user_id,table_id,left_at
 ON table_seats FOR EACH ROW WHEN (NEW.left_at IS NULL) EXECUTE FUNCTION fn_ca_horse_roster_seat_guard();
INSERT INTO cash_games(id,club_id,name,variant,sb,bb,handedness,template_name,enabled,lightning_enabled,must_move,cluster_mode,cluster_epoch,ruleset_snapshot)
VALUES('{GAME}',gen_random_uuid(),'PLO 1/2 Lightning Games','plo4',1,2,6,'madness',true,true,true,'must_move',0,
 '{{"lightning":{{"always_on":true,"on_threshold":5,"off_threshold":4}}}}');
INSERT INTO tables(id,cluster_id,game_variant,small_blind,big_blind,max_players,lifecycle,is_deleted,auto_start_players)
 VALUES('{TABLE}','{GAME}','plo4',1,2,6,'live',false,6);
INSERT INTO profiles VALUES('{HUMAN}',false,'active',NULL);
INSERT INTO table_seats(table_id,user_id,stack) VALUES('{TABLE}','{HUMAN}',400);
INSERT INTO profiles SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,true,'active','available' FROM generate_series(2,80)i;
INSERT INTO ca_horse_active_roster SELECT id FROM profiles WHERE is_horse;
INSERT INTO harness.wallet SELECT id,1000 FROM profiles;
''')
    # Non-vacuous before: the real installed roster guard allows a 21-body burst.
    sql('BEGIN;'+''.join(f"SELECT harness.buy('{horse(n)}','{TABLE}',100);" for n in range(2,23))+
        "DO $$ BEGIN IF (SELECT count(*) FROM table_seats)<>22 THEN RAISE EXCEPTION 'baseline did not burst'; END IF; END $$; ROLLBACK;")
    print('PASS: original admission burst reproduced with 21 actual inserts')
    sql(MIGRATION.read_text())
    check(f"SELECT auto_start_players=2 FROM tables WHERE id='{TABLE}';")
    check(f"SELECT ruleset_snapshot#>>'{{lightning,on_threshold}}'='10' AND ruleset_snapshot#>>'{{lightning,off_threshold}}'='4' AND ruleset_snapshot#>>'{{lightning,always_on}}'='false' FROM cash_games WHERE id='{GAME}';")
    # Opening-feeder priority cannot strand the human without an opponent.
    sql(f"INSERT INTO tables(id,cluster_id,game_variant,small_blind,big_blind,max_players,lifecycle,is_deleted) VALUES('00000000-0000-0000-0000-000000000102','{GAME}','plo4',1,2,6,'live',false);")
    wrong=sql(f"SELECT harness.buy('{horse(2)}','00000000-0000-0000-0000-000000000102',100);",ok=False)
    assert wrong.returncode and 'heads-up opponent' in wrong.stderr
    check('SELECT count(*)=0 FROM lightning_horse_admission;')
    print('PASS: a different empty feeder cannot consume the heads-up opponent')
    # Real clock adapter first: original trigger invokes the private gate once.
    sql(f"BEGIN; SELECT harness.buy('{horse(2)}','{TABLE}',100);")
    # Connection end rolls the complete request back; progress and chips must too.
    check('SELECT count(*)=0 FROM lightning_horse_admission;')
    check('SELECT sum(balance)=80000 FROM harness.wallet;')
    # Clock is controlled only in this isolated adapter. The admission function,
    # table trigger transition, lock and transaction code remain unmodified.
    sql('''CREATE FUNCTION harness.now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT current_setting('harness.now')::timestamptz $$;
DO $$ DECLARE s text:=pg_get_functiondef('fn_ca_horse_roster_seat_guard()'::regprocedure); BEGIN
 IF (length(s)-length(replace(s,'clock_timestamp()','')))/length('clock_timestamp()')<>1 THEN RAISE EXCEPTION 'clock adapter changed'; END IF;
 EXECUTE replace(s,'clock_timestamp()','harness.now()'); END $$;''')
    sql(buy(2))
    check('SELECT admitted_count=1 AND next_admission_at-last_admitted_at BETWEEN interval \'70 seconds\' AND interval \'90 seconds\' FROM lightning_horse_admission;')
    run([PG/'pg_ctl', '-D', work/'data', '-m', 'fast', '-w', 'stop'])
    run([PG/'pg_ctl', '-D', work/'data', '-l', work/'postgres.log', '-o', f"-h '' -k {socket}", '-w', 'start'])
    check('SELECT admitted_count=1 AND last_player_id=\'00000000-0000-0000-0000-000000000002\'::uuid FROM lightning_horse_admission;')
    print('PASS: PostgreSQL restart retains the admission identity and deadline')
    before = sql('SELECT sum(balance) FROM harness.wallet; SELECT sum(stack) FROM table_seats;').stdout
    refused = sql(buy(3), ok=False)
    assert refused.returncode and 'LIGHTNING_ADMISSION_PACED' in refused.stderr, refused.stderr
    assert sql('SELECT sum(balance) FROM harness.wallet; SELECT sum(stack) FROM table_seats;').stdout == before
    print('PASS: individual pacing, rollback of debit and admission progress, real trigger clock wiring')
    # First Horse creates heads-up. Eight further admissions reach ten ready
    # participants at 12 minutes with ordinary 30-second ticks, never catching up.
    for n in range(3,11):
        minute = (n-2)*90
        at = f"2026-11-09T12:{minute//60:02d}:{minute%60:02d}Z"
        sql(buy(n,at))
    check('SELECT count(*)=10 FROM table_seats WHERE left_at IS NULL;')
    check('SELECT admitted_count=9 AND last_admitted_at=\'2026-11-09T12:12:00Z\'::timestamptz FROM lightning_horse_admission;')
    refused = sql(buy(11,'2026-11-09T12:30:00Z'),ok=False)
    assert refused.returncode and 'LIGHTNING_ADMISSION_DEMAND' in refused.stderr
    # Existing occupied rebuy/sit-out chairs are outstanding holds. Otherwise
    # admitting replacements while they are unready overshoots on their return.
    for unavailable in ['stack=0', 'is_sitting_out=true']:
        sql(f"UPDATE table_seats SET {unavailable} WHERE user_id='{horse(2)}';")
        held = sql(buy(11,'2026-11-09T12:30:00Z'),ok=False)
        assert held.returncode and 'LIGHTNING_ADMISSION_DEMAND' in held.stderr, 'held rebuy/sit-out identity was replaced'
        sql(f"UPDATE table_seats SET stack=100,is_sitting_out=false WHERE user_id='{horse(2)}';")
        check('SELECT count(*)=10 FROM table_seats WHERE left_at IS NULL AND stack>0 AND NOT is_sitting_out;')
        check('SELECT admitted_count=9 FROM lightning_horse_admission;')
    print('PASS: occupied rebuy/sit-out holds refuse replacement and return without new admission')
    # Returning human and a second connection do not reset the durable sequence.
    sql(f"UPDATE table_seats SET left_at='2026-11-09T12:20:00Z' WHERE user_id='{HUMAN}';")
    refused = sql(buy(11,'2026-11-09T12:30:00Z'),ok=False)
    assert refused.returncode and 'LIGHTNING_ADMISSION_DEMAND' in refused.stderr
    check('SELECT admitted_count=9 FROM lightning_horse_admission;')
    sql(f"INSERT INTO table_seats(table_id,user_id,stack) VALUES('{TABLE}','{HUMAN}',400);")
    check('SELECT admitted_count=9 FROM lightning_horse_admission;')
    print('PASS: heads-up to ten in 12 minutes, last-human departure and return preserve progress')
    # Free capacity, duplicate every ready participant into its pool and multiple
    # reservations: none may be counted twice, and holds for OTHER players count.
    sql(f"UPDATE table_seats SET left_at=now() WHERE user_id IN ('{horse(9)}','{horse(10)}');")
    sql(f"INSERT INTO table_waitlist VALUES('{TABLE}','{horse(20)}','notified','2026-11-09T13:00:00Z',NULL),('{TABLE}','{horse(21)}','notified','2026-11-09T13:00:00Z',NULL);")
    refused = sql(buy(11,'2026-11-09T12:30:00Z'),ok=False)
    assert refused.returncode and 'LIGHTNING_ADMISSION_DEMAND' in refused.stderr
    sql('DELETE FROM table_waitlist;')
    sql(f"INSERT INTO lightning_pool_session SELECT '{GAME}',0,user_id,id,'active',NULL FROM table_seats WHERE left_at IS NULL;")
    sql(f"INSERT INTO lightning_reservation SELECT '{GAME}',user_id,'pending','2026-11-09T13:00:00Z' FROM table_seats WHERE left_at IS NULL;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(lambda n: sql(buy(n,'2026-11-09T12:30:00Z'),ok=False),range(30,34)))
    assert sum(x.returncode==0 for x in outcomes)==1, [(x.returncode,x.stderr) for x in outcomes]
    assert sum('LIGHTNING_ADMISSION_PACED' in x.stderr for x in outcomes)==3
    check('SELECT admitted_count=10 AND last_admitted_at=\'2026-11-09T12:30:00Z\'::timestamptz AND next_admission_at>last_admitted_at FROM lightning_horse_admission;')
    print('PASS: real concurrent fill requests, pool/reservation deduplication and delayed-tick no catch-up burst')
    # Same participant stack updates, exits, and already-owned moves remain legal.
    sql(f"UPDATE table_seats SET stack=stack+1 WHERE user_id='{horse(2)}' AND left_at IS NULL;")
    check('SELECT admitted_count=10 FROM lightning_horse_admission;')
    # The owned move's temporary second representation is not a new player.
    sql(f"""BEGIN;
INSERT INTO tables(id,cluster_id,game_variant,small_blind,big_blind,max_players,lifecycle,is_deleted)
 VALUES('00000000-0000-0000-0000-000000000101','{GAME}','plo4',1,2,6,'live',false);
INSERT INTO table_seats(table_id,user_id,stack,active_game_scope)
 SELECT '00000000-0000-0000-0000-000000000101',user_id,stack,active_game_scope
 FROM table_seats WHERE table_id='{TABLE}' AND user_id='{horse(2)}' AND left_at IS NULL;
UPDATE table_seats SET stack=0,left_at=now() WHERE table_id='{TABLE}' AND user_id='{horse(2)}' AND left_at IS NULL;
COMMIT;""")
    check('SELECT admitted_count=10 FROM lightning_horse_admission;')
    snapshot=sql('SELECT admitted_count,next_admission_at FROM lightning_horse_admission; SELECT sum(balance) FROM harness.wallet;').stdout
    failed=sql('BEGIN;'+buy(50,'2026-11-09T13:00:00Z')+'SELECT 1/0;',ok=False)
    assert failed.returncode and 'division by zero' in failed.stderr
    assert sql('SELECT admitted_count,next_admission_at FROM lightning_horse_admission; SELECT sum(balance) FROM harness.wallet;').stdout==snapshot
    sql(f"UPDATE harness.wallet SET balance=0 WHERE player_id='{horse(51)}';")
    insolvent=sql(buy(51,'2026-11-09T13:00:00Z'),ok=False)
    assert insolvent.returncode and 'check constraint' in insolvent.stderr
    check('SELECT admitted_count=10 FROM lightning_horse_admission;')
    print('PASS: destination-before-source move, insufficient funds, post-admission failure and durable progress rollback')
    check("SELECT NOT has_function_privilege('authenticated','fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)','EXECUTE') AND NOT has_function_privilege('service_role','fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)','EXECUTE');")
    # Reapply refuses and cannot undo the successful installation.
    retry = sql(MIGRATION.read_text(),ok=False)
    assert retry.returncode and 'already exists' in retry.stderr
    print('PASS: existing-seat updates, private access and migration replay refusal')
finally:
    if (work/'data/postmaster.pid').exists():
        run([PG/'pg_ctl','-D',work/'data','-m','immediate','-w','stop'])
    shutil.rmtree(work)
