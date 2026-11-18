#!/usr/bin/env python3
"""Every Lightning game admits Horses one at a time (20261111214248).

Disposable PostgreSQL 17 only; never a production connection. Builds on the
same isolated projection and exact installed predecessors as the
plo-lightning-lifecycle harness, installs 20261109141301 (the original
one-game route) and then this migration, and drives the REAL roster seat
trigger with ordinary seat inserts. Fails if any Lightning game other than
c79d8ec2 admits Horses faster than the slow-join schedule.

20261112005012 (owner, Dan, 2026-11-11): the approved 70 to 90 second Horse
arrival pace holds in EVERY game at any pool size. The busy-pool law below
seeds 80 committed players and fails on the 20261111214248 body, which
divided the spacing by whole Lightning starts (4.4 s in an 80-player pool).
"""
from pathlib import Path
import concurrent.futures
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
PLO = ROOT / 'scripts/qualification/plo-lightning-lifecycle'
PREDECESSOR = ROOT / 'supabase/migrations/20261109141301_plo_lightning_gradual_admission_and_feeder_lifecycle.sql'
MIGRATION = ROOT / 'supabase/migrations/20261111214248_every_lightning_game_joins_horses_one_at_a_time.sql'
FIX = ROOT / 'supabase/migrations/20261112005012_lightning_horse_arrivals_keep_the_70_to_90_second_pace_in_ev.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
SCRATCH = Path(os.environ.get('TMPDIR', ROOT / 'work'))
SCRATCH.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='ls-join-', dir=SCRATCH))
socket = work / 's'
socket.mkdir()
PLO_GAME = 'c79d8ec2-2281-411d-b4e1-42b5610849e2'
GAME = 'f67a1436-e842-4b49-8644-3e184bd77ba6'
HUMAN = '00000000-0000-0000-0000-000000000001'
TABLE = '00000000-0000-0000-0000-000000000200'
OTHER = '00000000-0000-0000-0000-000000000201'
PLO_TABLE = '00000000-0000-0000-0000-000000000100'
BUSY = '00000000-0000-0000-0000-0000000b0510'
BUSY_TABLE = '00000000-0000-0000-0000-0000000b0511'
MIN_GAP, MAX_GAP = 70, 90
# Installed production body of fn_lightning_horse_admit_paced after
# 20261111214248 (read-only check, 2026-11-12); 20261112005012 refuses any other.
ACCELERATED_MD5 = '55fb815245ccef227f084ac8d0c6a47d'


def run(args, ok=True):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, timeout=120)
    if ok and result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result


def sql(text, ok=True):
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


def at(seconds):
    return f"2026-11-11T15:{seconds // 60:02d}:{seconds % 60:02d}Z" if seconds < 3600 else \
        f"2026-11-11T16:{(seconds - 3600) // 60:02d}:{seconds % 60:02d}Z"


def buy(n, seconds, table=TABLE):
    return (f"SELECT set_config('harness.now','{at(seconds)}',false);"
            f"SELECT harness.buy('{horse(n)}','{table}',100);")


def horse_pace_law(gaps):
    """Every consecutive Horse admission is 70 to 90 s apart, at any pool size
    (+5 s for the attempt grid: a due arrival waits for the next attempt)."""
    assert gaps, 'no consecutive Horse admissions to measure'
    fast = [g for g in gaps if g < MIN_GAP]
    assert not fast, f'Horse admissions under {MIN_GAP} s apart: {fast} in {gaps}'
    late = [g for g in gaps if g > MAX_GAP + 5]
    assert not late, f'a due Horse admission was skipped: {late} in {gaps}'


def busy_run(start, seconds, step, first_horse):
    """A Horse-only pool of 80 committed players asked every `step` seconds."""
    admitted, n = [], first_horse
    for second in range(start, start + seconds + 1, step):
        result = sql(buy(n, second, BUSY_TABLE), ok=False)
        if result.returncode == 0:
            admitted.append(second)
            n += 1
        else:
            assert 'LIGHTNING_ADMISSION_PACED' in result.stderr, result.stderr
    return [b - a for a, b in zip(admitted, admitted[1:])], n


def admissions():
    return int(sql(f"SELECT coalesce((SELECT admitted_count FROM lightning_horse_admission WHERE game_id='{GAME}'),0);").stdout.strip())


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
    sql((PLO/'schema.sql').read_text())
    sql((PLO/'installed-functions.sql').read_text())
    # The creator's installed always_on line, verbatim, on a stub that returns
    # the snapshot it would write. Production holds exactly one such anchor
    # (read-only check, 2026-11-11); the migration refuses any other count.
    sql('''CREATE FUNCTION public.fn_cash_game_create_impl_20260905(p_club uuid,p_name text,p_variant text,p_sb numeric,p_bb numeric,p_hand integer,p_opts jsonb,p_template text,p_lightning boolean)
RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN
  RETURN jsonb_build_object('lightning',
      jsonb_build_object('always_on',true,'on_threshold',5,'off_threshold',4,'worker_mode','form'));
END $f$;''')
    sql(f'''CREATE TRIGGER zzzzzz_horse_roster_seat_guard BEFORE INSERT OR UPDATE OF user_id,table_id,left_at
 ON table_seats FOR EACH ROW WHEN (NEW.left_at IS NULL) EXECUTE FUNCTION fn_ca_horse_roster_seat_guard();
INSERT INTO cash_games(id,club_id,name,variant,sb,bb,handedness,template_name,enabled,lightning_enabled,must_move,cluster_mode,cluster_epoch,ruleset_snapshot)
VALUES('{PLO_GAME}',gen_random_uuid(),'PLO4 1.00/2.00 Lightning Games','plo4',1,2,6,'madness',true,true,true,'must_move',0,
 '{{"lightning":{{"always_on":true,"on_threshold":5,"off_threshold":4}}}}'),
 ('{GAME}',gen_random_uuid(),'PLO5 1.00/2.00 Lightning Games','plo5',1,2,6,'madness',true,true,true,'must_move',0,
 '{{"lightning":{{"always_on":true,"on_threshold":5,"off_threshold":4,"worker_mode":"form"}}}}'),
 ('{BUSY}',gen_random_uuid(),'NLH 0.25/0.50 Lightning Games','nlh',0.25,0.5,6,'madness',true,true,true,'must_move',0,
 '{{"lightning":{{"always_on":true,"on_threshold":5,"off_threshold":4,"worker_mode":"form"}}}}');
INSERT INTO tables(id,cluster_id,game_variant,small_blind,big_blind,max_players,lifecycle,is_deleted,auto_start_players) VALUES
 ('{PLO_TABLE}','{PLO_GAME}','plo4',1,2,6,'live',false,6),
 ('{TABLE}','{GAME}','plo5',1,2,6,'live',false,6),
 ('{OTHER}','{GAME}','plo5',1,2,6,'live',false,6),
 ('{BUSY_TABLE}','{BUSY}','nlh',0.25,0.5,6,'live',false,6);
INSERT INTO profiles VALUES('{HUMAN}',false,'active',NULL);
INSERT INTO profiles SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,true,'active','available' FROM generate_series(2,400)i;
INSERT INTO ca_horse_active_roster SELECT id FROM profiles WHERE is_horse;
INSERT INTO harness.wallet SELECT id,100000 FROM profiles;
''')
    sql(PREDECESSOR.read_text())
    check("SELECT md5(pg_get_functiondef('fn_ca_horse_roster_seat_guard()'::regprocedure))='de802845406367520558e78abbca1bef';")
    check("SELECT md5(pg_get_functiondef('fn_cash_apply_ruleset(uuid)'::regprocedure))='766d39e686bbebb6232887e5f8c43780';")
    check("SELECT md5(pg_get_functiondef('fn_cash_cluster_open_table(uuid,text,integer,text,uuid)'::regprocedure))='da2ad50fe8c8a0852ab60b21c1117615';")
    print('PASS: harness predecessors equal the installed production bodies (guard, projector, opener)')

    # Non-vacuous before: the exact incident. A person sits in PLO5 and the
    # fleet seats thirty-five Horses in one pass; the installed guard lets them.
    sql(f"INSERT INTO table_seats(table_id,user_id,stack) VALUES('{TABLE}','{HUMAN}',400);")
    sql('BEGIN;' + ''.join(f"SELECT harness.buy('{horse(n)}','{TABLE if n % 2 else OTHER}',100);" for n in range(2, 37)) +
        "DO $$ BEGIN IF (SELECT count(*) FROM table_seats WHERE left_at IS NULL)<>36 THEN RAISE EXCEPTION 'baseline did not burst'; END IF; END $$; ROLLBACK;")
    print('PASS: before 20261111214248 the installed guard seats 35 Horses at once in PLO5 1/2 (incident reproduced)')

    sql(MIGRATION.read_text())
    check(f"SELECT ruleset_snapshot#>>'{{lightning,always_on}}'='false' AND ruleset_snapshot#>>'{{lightning,on_threshold}}'='5' AND ruleset_snapshot#>>'{{lightning,off_threshold}}'='4' AND ruleset_snapshot#>>'{{lightning,worker_mode}}'='form' FROM cash_games WHERE id='{GAME}';")
    check(f"SELECT bool_and(auto_start_players=2) FROM tables WHERE cluster_id IN ('{GAME}','{PLO_GAME}');")
    check("SELECT position('c79d8ec2' in pg_get_functiondef('fn_cash_apply_ruleset(uuid)'::regprocedure))=0;")
    check("SELECT fn_cash_game_create_impl_20260905(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)#>>'{lightning,always_on}'='false';")
    print('PASS: every Lightning game and the creator are feeder-first (always_on false), thresholds kept, heads-up feeder minimum')

    # The clock is controlled only through this isolated adapter; function,
    # trigger, locks and transactions are the installed ones.
    sql('''CREATE FUNCTION harness.now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT current_setting('harness.now')::timestamptz $$;
DO $$ DECLARE s text:=pg_get_functiondef('fn_ca_horse_roster_seat_guard()'::regprocedure); BEGIN
 IF (length(s)-length(replace(s,'clock_timestamp()','')))/length('clock_timestamp()')<>2 THEN RAISE EXCEPTION 'clock adapter changed'; END IF;
 EXECUTE replace(s,'clock_timestamp()','harness.now()'); END $$;''')

    # THE BUSY-POOL LAW, non-vacuous: the installed 20261111214248 body (equal
    # to production) seats Horses seconds apart in a Horse-only pool of 80.
    check(f"SELECT md5(pg_get_functiondef('fn_lightning_horse_admit_paced(uuid,uuid,timestamptz)'::regprocedure))='{ACCELERATED_MD5}';")
    sql(f"""INSERT INTO lightning_pool_session SELECT '{BUSY}',0,('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,NULL,'active',NULL FROM generate_series(1001,1080)i;""")
    old_gaps, next_horse = busy_run(1000, 180, 2, 200)
    try:
        horse_pace_law(old_gaps)
    except AssertionError:
        pass
    else:
        raise AssertionError(f'the busy-pool law did not catch the accelerated body: {old_gaps}')
    print(f'PASS: before 20261112005012 an 80-player Horse-only pool admits Horses {min(old_gaps)}-{max(old_gaps)} s apart (acceleration reproduced; the law fails it)')

    sql(FIX.read_text())
    check("SELECT position('v_streams' in pg_get_functiondef('fn_lightning_horse_admit_paced(uuid,uuid,timestamptz)'::regprocedure))=0;")
    busy_gaps, next_horse = busy_run(1300, 900, 5, next_horse)
    horse_pace_law(busy_gaps)
    assert len(busy_gaps) >= 8, busy_gaps
    print(f'PASS: after 20261112005012 the same 80-player pool admits {len(busy_gaps) + 1} Horses, every gap {min(busy_gaps)}-{max(busy_gaps)} s')

    # The first opponent goes to the lone person's table, at once.
    wrong = sql(buy(2, 0, OTHER), ok=False)
    assert wrong.returncode and 'heads-up opponent' in wrong.stderr, wrong.stderr
    sql(buy(2, 0))
    check(f"SELECT admitted_count=1 AND next_admission_at-last_admitted_at BETWEEN interval '{MIN_GAP} seconds' AND interval '{MAX_GAP} seconds' FROM lightning_horse_admission WHERE game_id='{GAME}';")
    print('PASS: the lone person gets one heads-up opponent at once, at their own table')

    # THE SLOW-JOIN LAW. A fleet that asks every 5 seconds for 15 minutes is
    # admitted one Horse at a time, each 70 to 90 seconds after the last.
    before_money = sql('SELECT sum(balance) FROM harness.wallet;').stdout
    admitted = [0]
    n = 3
    for second in range(5, 15 * 60 + 1, 5):
        count_before = admissions()
        result = sql(buy(n, second), ok=False)
        if result.returncode == 0:
            admitted.append(second)
            n += 1
        else:
            assert 'LIGHTNING_ADMISSION_PACED' in result.stderr, result.stderr
            assert admissions() == count_before
    gaps = [b - a for a, b in zip(admitted, admitted[1:])]
    # Through the first Lightning start and beyond: never faster than one
    # Horse per 70 seconds, never a skipped due arrival.
    horse_pace_law(gaps)
    first_start = admitted[4] - admitted[0]
    assert 4 * MIN_GAP <= first_start <= 4 * MAX_GAP + 20, first_start
    after_money = sql('SELECT sum(balance) FROM harness.wallet;').stdout
    assert int(float(before_money)) - int(float(after_money)) == 100 * (len(admitted) - 1)
    print(f'PASS: 180 fleet attempts in 15 minutes admitted {len(admitted)} Horses, gaps {min(gaps)}-{max(gaps)} s; every refusal rolled back its debit, seat and progress')

    # Never two at once: real concurrent buy-ins when one is due.
    due = admitted[-1] + MAX_GAP + 1
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(lambda k: sql(buy(k, due), ok=False), range(60, 64)))
    assert sum(x.returncode == 0 for x in outcomes) == 1, [(x.returncode, x.stderr) for x in outcomes]
    assert sum('LIGHTNING_ADMISSION_PACED' in x.stderr for x in outcomes) == 3
    print('PASS: four concurrent due buy-ins admit exactly one Horse')

    # People are never paced or capped.
    sql(f"SELECT set_config('harness.now','{at(due + 1)}',false); UPDATE profiles SET is_horse=false WHERE id='{horse(70)}'; SELECT harness.buy('{horse(70)}','{OTHER}',100);")
    print('PASS: a person buys in inside the spacing without consuming Horse progress')

    # An established pool is paced exactly like an empty one (owner,
    # 2026-11-11): its size never shortens the 70 to 90 second spacing.
    sql(f"""INSERT INTO lightning_pool_session SELECT '{GAME}',0,('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,NULL,'active',NULL FROM generate_series(80,95)i;""")
    population = int(sql(f"SELECT count(DISTINCT user_id) FROM table_seats s JOIN tables t ON t.id=s.table_id WHERE t.cluster_id='{GAME}' AND s.left_at IS NULL;").stdout) + 16
    nxt = int(sql(f"SELECT extract(epoch FROM next_admission_at - '2026-11-11T15:00:00Z'::timestamptz)::int FROM lightning_horse_admission WHERE game_id='{GAME}';").stdout) + 1
    # The second person sat alone at the other table, so its opponent goes there.
    sql(buy(64, nxt, OTHER))
    gap = float(sql(f"SELECT extract(epoch FROM next_admission_at-last_admitted_at) FROM lightning_horse_admission WHERE game_id='{GAME}';").stdout)
    assert MIN_GAP <= gap <= MAX_GAP and gap == int(gap), (gap, population)
    refused = sql(buy(65, nxt, OTHER), ok=False)
    assert refused.returncode and 'LIGHTNING_ADMISSION_PACED' in refused.stderr
    print(f'PASS: an established pool of {population} still spaces arrivals {gap:.0f} s apart, one at a time')

    # The owner-specific c79d8ec2 route is untouched and separately paced.
    check(f"SELECT NOT EXISTS(SELECT 1 FROM lightning_horse_admission WHERE game_id='{PLO_GAME}');")
    sql(f"INSERT INTO table_seats(table_id,user_id,stack) VALUES('{PLO_TABLE}','{HUMAN}',400);")
    sql(f"SELECT set_config('harness.now','{at(nxt)}',false); SELECT harness.buy('{horse(100)}','{PLO_TABLE}',100);")
    check(f"SELECT admitted_count=1 FROM lightning_horse_admission WHERE game_id='{PLO_GAME}';")
    print('PASS: c79d8ec2 keeps its own admission route and progress row')

    # A Classic game is never touched.
    sql(f"""INSERT INTO cash_games(id,club_id,name,variant,sb,bb,handedness,template_name,enabled,lightning_enabled,must_move,cluster_mode,cluster_epoch,ruleset_snapshot)
VALUES('00000000-0000-0000-0000-00000000c1a5',gen_random_uuid(),'Classic','plo5',1,2,6,'classic',true,false,true,'must_move',0,'{{}}');
INSERT INTO tables(id,cluster_id,game_variant,small_blind,big_blind,max_players,lifecycle,is_deleted) VALUES('00000000-0000-0000-0000-0000000c1a50','00000000-0000-0000-0000-00000000c1a5','plo5',1,2,6,'live',false);""")
    sql('BEGIN;' + ''.join(f"SELECT harness.buy('{horse(k)}','00000000-0000-0000-0000-0000000c1a50',100);" for k in range(101, 106)) + 'COMMIT;')
    check("SELECT count(*)=5 FROM table_seats WHERE table_id='00000000-0000-0000-0000-0000000c1a50';")
    check("SELECT NOT EXISTS(SELECT 1 FROM lightning_horse_admission WHERE game_id='00000000-0000-0000-0000-00000000c1a5');")
    print('PASS: a Classic game is not paced by the Lightning route')

    check("SELECT NOT has_function_privilege('authenticated','fn_lightning_horse_admit_paced(uuid,uuid,timestamptz)','EXECUTE') AND NOT has_function_privilege('service_role','fn_lightning_horse_admit_paced(uuid,uuid,timestamptz)','EXECUTE');")
    retry = sql(MIGRATION.read_text(), ok=False)
    assert retry.returncode and 'already exists' in retry.stderr
    retry = sql(FIX.read_text(), ok=False)
    assert retry.returncode and 'predecessor changed' in retry.stderr, retry.stderr
    print('PASS: private helper and migration replay refusal')
finally:
    if (work/'data/postmaster.pid').exists():
        run([PG/'pg_ctl', '-D', work/'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work)
