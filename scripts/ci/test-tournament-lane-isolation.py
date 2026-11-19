"""Native PostgreSQL proof: one tournament's lane never pauses another's tables.

Migration 20261118160405 (incident 075013fd, lane T) moves every table writer
off the platform key G ('ca:tournament-terminal-settlement:v1') onto the hand
barrier B ('ca:hand-settlement-barrier:v1'). This builds a throwaway cluster
on a Unix socket, installs the EXACT production pre-images
(scripts/ci/fixtures/tournament-lane-isolation/preimages.json, md5-checked),
drives real concurrent sessions BEFORE the migration (to show the defect) and
AFTER it (to show the fix and that every fence still holds), then runs a
randomised mixed workload under the documented lock orders and requires zero
deadlocks in the server log. No network, no production connection.

Usage: PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/ci/test-tournament-lane-isolation.py [--output DIR]
       --print-post-images  apply the substitutions only and print each md5
"""
import argparse
import hashlib
import json
import os
import pathlib
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261118160405_tournament_table_writers_never_wait_on_the_platform_lane.sql'
MIG2 = ROOT / 'supabase/migrations/20261118171613_tournament_and_club_lanes_fence_only_their_own_tables.sql'
FIX = json.loads((ROOT / 'scripts/ci/fixtures/tournament-lane-isolation/preimages.json').read_text())
require_hash = '56830fd23ccf2f89472a5cadefdca0b9836e72c27ed3027e7b3a3e702bfa29eb'
require_hash2 = 'd2185dae53729403bb3d5cde55b96ba7384e1866fecdc11faaff60178ce5e2c8'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/tournament-lane-isolation')
parser.add_argument('--print-post-images', action='store_true')
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)

migration = MIG.read_text()
mig_hash = hashlib.sha256(migration.encode()).hexdigest()
migration2 = MIG2.read_text()
mig2_hash = hashlib.sha256(migration2.encode()).hexdigest()
if not args.print_post_images and (mig_hash != require_hash or mig2_hash != require_hash2):
    sys.exit(f'migration bytes changed: sha256 {mig_hash} / {mig2_hash} are not the qualified pair')
# The 30 caller substitutions are pinned to production pre- and post-images
# computed read-only on production; their bodies are not in this cluster, so
# the native run applies everything else in the file and leaves that block to
# the md5 pins (the law test checks the block's shape).
migration2_native = re.sub(r'-- @begin caller substitutions.*?-- @end caller substitutions\n', '', migration2, flags=re.S)
assert migration2_native != migration2

pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='lane-isolation-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55871'
LOG = cluster / 'log'
results = {'checks': [], 'production_mutations': False, 'migration_sha256': mig_hash}

G = "hashtextextended('ca:tournament-terminal-settlement:v1',0)"
B = "hashtextextended('ca:hand-settlement-barrier:v1',0)"


def T(uuid):
    return f"hashtextextended('ca:tournament-terminal-settlement:v1:{uuid}',0)"


def psql(sql, db='w', check=True, timeout=60):
    cmd = as_owner + [str(pg / 'psql'), '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                      '-h', str(sock), '-p', PORT, '-U', 'postgres', '-d', db]
    p = subprocess.run(cmd, input=sql, capture_output=True, text=True, env=env, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f'psql failed: {p.stderr}\n--- sql ---\n{sql[:2000]}')
    return p


def q(sql, db='w'):
    return psql(sql, db).stdout.strip()


def bg(sql, db='w'):
    cmd = as_owner + [str(pg / 'psql'), '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                      '-h', str(sock), '-p', PORT, '-U', 'postgres', '-d', db]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, env=env)
    p.stdin.write(sql)
    p.stdin.close()
    return p


def timed(sql, db='w'):
    t0 = time.monotonic()
    p = psql(sql, db, check=False)
    return time.monotonic() - t0, p.returncode, (p.stdout + p.stderr).strip()


def check(name, ok, detail=''):
    results['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)
    if not ok:
        raise SystemExit(f'check failed: {name}: {detail}')


def wait_until_waiting(n, db='w', timeout=5.0):
    """Block until at least n advisory-lock requests are waiting."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if int(q("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted", db)) >= n:
            return
        time.sleep(0.05)
    raise RuntimeError(f'expected {n} waiting advisory requests')


TA = 'aaaaaaaa-0000-0000-0000-00000000000a'  # tournament A (its settlement holds the lane)
TB = 'bbbbbbbb-0000-0000-0000-00000000000b'  # tournament B (an unrelated event)
TC = 'cccccccc-0000-0000-0000-00000000000c'  # tournament C (a slow rolling authority)
CLUB = '11111111-0000-0000-0000-000000000001'
TBL = {TA: 'aaaaaaaa-1111-0000-0000-00000000000a', TB: 'bbbbbbbb-1111-0000-0000-00000000000b',
       TC: 'cccccccc-1111-0000-0000-00000000000c'}
CASH = 'dddddddd-1111-0000-0000-00000000000d'
CLUB2 = '22222222-0000-0000-0000-000000000002'   # another club
TD = 'dddddddd-0000-0000-0000-00000000000d'      # tournament D, hosted by club 2
TS = 'eeeeeeee-0000-0000-0000-00000000000e'      # a satellite of club 1 into tournament A
CASH2 = 'ffffffff-1111-0000-0000-00000000000f'   # a cash table of club 2
TBL[TD] = 'dddddddd-1111-0000-0000-0000000000dd'
TBL[TS] = 'eeeeeeee-1111-0000-0000-00000000000e'
SEAT_B = 'bbbbbbbb-2222-0000-0000-00000000000b'

ROLES = "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
SCHEMA = f"""
CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE TABLE public.clubs(id uuid PRIMARY KEY, union_id uuid);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, club_id uuid, variant text, tournament_type text,
  satellite_target_id uuid, satellite_target uuid, status text DEFAULT 'RUNNING');
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid, club_id uuid, status text DEFAULT 'active',
  lifecycle text DEFAULT 'open', is_deleted boolean DEFAULT false, f06_lifecycle bigint, current_players int DEFAULT 0,
  updated_at timestamptz DEFAULT now());
CREATE SEQUENCE smarter_private.f06_lifecycle_seq;
CREATE TABLE smarter_private.f06_operations(source_table_id uuid, state text);
CREATE TABLE public.table_seats(id uuid PRIMARY KEY, table_id uuid, user_id uuid, seat_number int,
  left_at timestamptz, stack numeric, status text, joined_at timestamptz, club_id uuid);
CREATE TABLE public.table_hole_cards(table_id uuid, hand_number int, cards text);
CREATE TABLE smarter_private.f06_hand_permits(table_id uuid, hand_number int, tournament_id uuid);
CREATE TABLE smarter_private.f06_unsettled_hand_aborts(table_id uuid, hand_number int);
CREATE TABLE smarter_private.f06_generation_abort_hands(table_id uuid, hand_number int);
CREATE TABLE smarter_private.f06_mixed_abort_hands(table_id uuid, hand_number int);
CREATE TABLE smarter_private.f06_prepared_hand_cancellations(table_id uuid, hand_number int);
CREATE TABLE smarter_private.f06_no_start_continuations(table_id uuid, hand_number int);
CREATE FUNCTION smarter_private.f06_authority(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION smarter_private.f06_authority(uuid, uuid, boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
-- The two other finish-lane helpers the doctrine expects to name F.
INSERT INTO public.clubs VALUES ('{CLUB}', NULL), ('{CLUB2}', NULL);
INSERT INTO public.tournaments VALUES ('{TA}','{CLUB}','regular','MTT',NULL,NULL),
  ('{TB}','{CLUB}','regular','MTT',NULL,NULL), ('{TC}','{CLUB}','regular','MTT',NULL,NULL),
  ('{TD}','{CLUB2}','regular','MTT',NULL,NULL), ('{TS}','{CLUB}','satellite','SATELLITE','{TA}',NULL);
INSERT INTO public.tables VALUES ('{TBL[TA]}','{TA}','{CLUB}'), ('{TBL[TB]}','{TB}','{CLUB}'),
  ('{TBL[TC]}','{TC}','{CLUB}'), ('{CASH}',NULL,'{CLUB}'), ('{TBL[TD]}','{TD}','{CLUB2}'),
  ('{TBL[TS]}','{TS}','{CLUB}'), ('{CASH2}',NULL,'{CLUB2}');
INSERT INTO public.table_seats VALUES ('{SEAT_B}','{TBL[TB]}',gen_random_uuid(),1,NULL,100,'active',now(),'{CLUB}');
INSERT INTO smarter_private.f06_hand_permits VALUES ('{TBL[TB]}',7,'{TB}'), ('{TBL[TA]}',7,'{TA}');
"""

TRIGGERS = """
CREATE TRIGGER a00_f06_cancelled_preparation BEFORE INSERT OR UPDATE ON public.table_hole_cards
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_cancelled_preparation_writer_guard();
CREATE TRIGGER a00_f06_aborted_hand BEFORE INSERT OR UPDATE ON public.table_hole_cards
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_aborted_hand_guard();
CREATE TRIGGER a00_f06_source_seat BEFORE INSERT OR UPDATE OR DELETE ON public.table_seats
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_source_guard();
CREATE TRIGGER a00_f06_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.tables
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_table_guard();
-- production's ACL on the one owner-only observer the doctrine excepts
REVOKE ALL ON FUNCTION smarter_private.cancellation_lane(uuid) FROM PUBLIC;
"""


def install_preimages(db):
    for f in FIX['functions']:
        assert hashlib.md5(f['definition'].encode()).hexdigest() == f['md5'], f['signature']
        psql(f['definition'], db)
        live = q(f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))", db)
        assert live == f['md5'], (f['signature'], live, f['md5'])
    psql(TRIGGERS, db)


GLOBAL = "DO $g$BEGIN PERFORM public.fn_ca_lock_settlement_lane_global(); END$g$;"


# The writer shapes production runs, each as one transaction.
def w_wait(table):  # insert_hole_cards / snapshot / post-commit / projection
    return (f"BEGIN; SELECT smarter_private.f06_wait_table_lane('{table}'); "
            f"INSERT INTO public.table_hole_cards VALUES ('{table}',7,'x'); COMMIT;")


def w_share(t, table):  # f06 begin / finish / continuation / hand number
    return f"BEGIN; SELECT public.fn_ca_f06_share_table_lane('{t}', gen_random_uuid(), '{table}'); COMMIT;"


def w_commit(table):  # the hand commit (cash or tournament)
    return (f"BEGIN; SET LOCAL lock_timeout='4s'; SELECT public.fn_ca_share_settlement_lane_for_table('{table}'); "
            f"UPDATE public.table_seats SET stack = stack WHERE table_id = '{table}'; COMMIT;")


def scenario_global_queued_behind_slow_authority(label):
    """A rolling authority of C holds G shared for 6 s; a global authority
    queues for G exclusive behind it; then tournament B's and the cash
    table's writers run. Returns their timings."""
    slow = bg(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TC}'); SELECT pg_sleep(6); COMMIT;")
    time.sleep(0.4)
    glob = bg(f"BEGIN; {GLOBAL} SELECT pg_sleep(0.2); COMMIT;")
    wait_until_waiting(1)
    jobs = {
        'wait_lane_B': w_wait(TBL[TB]),
        'share_lane_B': f"SET lock_timeout='4s'; {w_share(TB, TBL[TB])}",
        'hand_commit_B': w_commit(TBL[TB]),
        'hand_commit_cash': w_commit(CASH),
        'direct_guarded_insert_B': f"INSERT INTO public.table_hole_cards VALUES ('{TBL[TB]}',7,'direct');",
    }
    res = {}

    def run(k, sql):
        res[k] = timed(sql)

    # All at once, while the global request is queued (the slow holder has
    # about 5 s left, so a writer that queues behind G hits its 4 s bound).
    ths = [threading.Thread(target=run, args=kv) for kv in jobs.items()]
    for th in ths:
        th.start()
    for th in ths:
        th.join()
    slow.wait(30)
    glob.wait(30)
    return res


try:
    psql_init = as_owner + [str(pg / 'initdb'), '-D', str(cluster / 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale']
    subprocess.run(psql_init, check=True, capture_output=True, env=env)
    subprocess.run(as_owner + [str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-l', str(LOG), '-o',
                   f"-k {sock} -p {PORT} -c listen_addresses='' -c log_lock_waits=on -c deadlock_timeout=200ms "
                   "-c max_connections=60", '-w', 'start'], check=True, capture_output=True, env=env)
    subprocess.run(as_owner + [str(pg / 'createdb'), '-h', str(sock), '-p', PORT, '-U', 'postgres', 'w'],
                   check=True, env=env)
    psql(ROLES)
    psql(SCHEMA)
    install_preimages('w')
    check(f"pre-images are byte-identical to production ({len(FIX['functions'])} md5s)", True)

    if args.print_post_images:
        psql(migration)
        stripped = re.sub(r'DO \$post\$.*?END \$post\$;', '', migration2_native, flags=re.S)
        p = psql(stripped, check=False)
        print(p.stderr[-3000:])
        for sig in ['public.fn_ca_lock_settlement_lane_global()', 'public.fn_ca_share_settlement_lane_for_table(uuid)',
                    'smarter_private.f06_table_guard()', 'smarter_private.cancellation_lane(uuid)',
                    'public.fn_ca_settlement_lane_doctrine()', 'public.fn_ca_lock_settlement_lane_for_club(uuid)',
                    'public.fn_ca_lock_settlement_lane_for_event(uuid,boolean)']:
            print(sig, q(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))"))
        sys.exit(0)

    # ---------------- BEFORE: the defect, on the exact live bodies ----------------
    before = scenario_global_queued_behind_slow_authority('before')
    secs, rc, txt = before['wait_lane_B']
    check('before: B hole-card writer is refused after 4 s while a global authority only QUEUES for G',
          rc != 0 and 'F06_RETRY_CANONICAL_LANE' in txt and secs >= 3.5, f'{secs:.2f}s rc={rc}')
    secs, rc, txt = before['hand_commit_cash']
    check('before: a CASH hand commit is paused by the queued global authority',
          rc != 0 and secs >= 3.5, f'{secs:.2f}s rc={rc}')
    secs, rc, txt = before['direct_guarded_insert_B']
    check('before: B guarded write is refused while the global authority only queues',
          rc != 0 and 'F06_RETRY_CANONICAL_LANE' in txt, f'{secs:.2f}s')
    results['before'] = {k: [round(v[0], 3), v[1]] for k, v in before.items()}

    # ---------------- the migration, exact bytes ----------------
    p = psql(migration, check=False)
    check('migration applies in one transaction', p.returncode == 0, p.stderr.strip()[-400:])
    check('doctrine answers ok after the change',
          q("SELECT public.fn_ca_settlement_lane_doctrine()->>'ok'") == 'true')
    for sig in ['public.fn_ca_lock_settlement_lane_global()',
                'public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)',
                'public.fn_ca_lock_settlement_lane_for_finish(uuid)']:
        pre = next(f['md5'] for f in FIX['functions'] if f['signature'] == sig)
        check(f'authority helper unchanged: {sig}',
              q(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))") == pre)
    check('no table writer names G any more',
          q("""SELECT count(*) FROM pg_proc WHERE oid = ANY(ARRAY[
                'smarter_private.f06_wait_table_lane(uuid)'::regprocedure,
                'public.fn_ca_f06_share_table_lane(uuid,uuid,uuid)','public.fn_ca_share_settlement_lane_for_table(uuid)',
                'smarter_private.f06_aborted_hand_guard()','smarter_private.f06_cancelled_preparation_writer_guard()',
                'smarter_private.f06_source_guard()']::regprocedure[])
               AND prosrc ~ 'hashtextextended\\(\\s*''ca:tournament-terminal-settlement:v1''\\s*,'""") == '0')

    # ---------------- AFTER: the same interleaving ----------------
    after = scenario_global_queued_behind_slow_authority('after')
    for k in ['wait_lane_B', 'share_lane_B', 'hand_commit_B', 'hand_commit_cash', 'direct_guarded_insert_B']:
        secs, rc, txt = after[k]
        check(f'after: {k} completes at once while a global authority queues for G', rc == 0 and secs < 1.0,
              f'{secs:.2f}s rc={rc} {txt[-160:]}')
    results['after'] = {k: [round(v[0], 3), v[1]] for k, v in after.items()}

    # ---- The owner's case: A's settlement holds its lane 10 s ----
    hold = bg(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_finish('{TA}'); SELECT pg_sleep(10); COMMIT;")
    time.sleep(0.5)
    sB = timed(w_wait(TBL[TB]))
    check("A's settlement holds its lane 10 s: B's hole-card writer completes at once", sB[1] == 0 and sB[0] < 1.0,
          f'{sB[0]:.2f}s')
    sB2 = timed(w_commit(TBL[TB]))
    check("A's settlement holds its lane 10 s: B's hand commit completes at once", sB2[1] == 0 and sB2[0] < 1.0,
          f'{sB2[0]:.2f}s')
    sCash = timed(w_commit(CASH))
    check("A's settlement holds its lane 10 s: a cash hand commit completes at once", sCash[1] == 0 and sCash[0] < 1.0,
          f'{sCash[0]:.2f}s')
    sA = timed(w_wait(TBL[TA]))
    check("A's own table waits for A's settlement (bounded 4 s, F06_RETRY sentinel)",
          sA[1] != 0 and 'F06_RETRY_CANONICAL_LANE' in sA[2] and 3.5 <= sA[0] < 6, f'{sA[0]:.2f}s')
    hold.wait(30)
    short = bg(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_finish('{TA}'); SELECT pg_sleep(1.5); COMMIT;")
    time.sleep(0.3)
    sA2 = timed(w_wait(TBL[TA]))
    short.wait(30)
    check("A's own table waits for a short settlement, then writes", sA2[1] == 0 and 1.0 <= sA2[0] < 3.0,
          f'{sA2[0]:.2f}s')

    # ---- The fence still holds while a global authority HOLDS the lane ----
    gh = bg(f"BEGIN; {GLOBAL} SELECT pg_sleep(2.5); COMMIT;")
    time.sleep(0.4)
    d = timed(f"INSERT INTO public.table_hole_cards VALUES ('{TBL[TB]}',7,'direct');")
    check('a direct guarded write is refused while a global authority HOLDS the lane',
          d[1] != 0 and 'F06_RETRY_CANONICAL_LANE' in d[2], f'{d[0]:.2f}s')
    s = timed(f"UPDATE public.table_seats SET stack = stack + 0 WHERE id = '{SEAT_B}';")
    check('a direct payload seat update is refused by the source guard while a global HOLDS the lane',
          s[1] != 0 and 'F06_RETRY_CANONICAL_LANE' in s[2], f'{s[0]:.2f}s')
    w = timed(w_wait(TBL[TB]))
    check('a writer waits for a global authority that HOLDS the lane, then writes (fence preserved)',
          w[1] == 0 and 1.5 <= w[0] < 4.0, f'{w[0]:.2f}s')
    gh.wait(30)

    # ---- An authority cannot start while a writer is open (both directions) ----
    wopen = bg(f"BEGIN; SELECT smarter_private.f06_wait_table_lane('{TBL[TB]}'); SELECT pg_sleep(1.5); COMMIT;")
    time.sleep(0.3)
    g = timed(f"BEGIN; SET LOCAL lock_timeout='0.5s'; {GLOBAL} COMMIT;")
    a = timed(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TB}'); COMMIT;")
    wopen.wait(30)
    check("B's rolling authority waits for B's open writer (T fence)", a[1] == 0 and a[0] >= 0.4, f'{a[0]:.2f}s')
    check('a global authority cannot take the lane over an open writer (B fence)',
          g[1] != 0 and 'lock timeout' in g[2], f'{g[0]:.2f}s')

    # ---- Rolling authority of B still fences B's writers ----
    rh = bg(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TB}'); SELECT pg_sleep(1.5); COMMIT;")
    time.sleep(0.3)
    r = timed(w_wait(TBL[TB]))
    rh.wait(30)
    check("B's rolling authority still pauses only B's writer, which then writes", r[1] == 0 and r[0] >= 1.0,
          f'{r[0]:.2f}s')

    # ---- The doctrine catches a writer that takes G again ----
    wait_pre = next(f['definition'] for f in FIX['functions'] if f['signature'] == 'smarter_private.f06_wait_table_lane(uuid)')
    p = psql("BEGIN;\n" + wait_pre + ";\nSELECT public.fn_ca_settlement_lane_doctrine()::text;\nROLLBACK;")
    check('doctrine rule 5 names a writer that takes G again',
          'table_writers_never_take_g' in p.stdout and 'f06_wait_table_lane' in p.stdout)

    # =============== PART 2: 20261118171613, scoped club and event lanes ===============
    p = psql(migration2_native, check=False)
    check('scoped-lane migration applies (helpers, hand commit, table guard, cancellation, doctrine)',
          p.returncode == 0, p.stderr.strip()[-400:])
    check('doctrine answers ok with the club and event lanes',
          q("SELECT public.fn_ca_settlement_lane_doctrine()->>'ok'") == 'true')

    t = timed("SELECT public.fn_ca_lock_settlement_lane_global();")
    check('a script can no longer take the global lane as its own top-level statement',
          t[1] != 0 and 'GLOBAL_LANE_IS_NOT_A_SCRIPT_LOCK' in t[2], t[2][-120:])
    t = timed(f"BEGIN; {GLOBAL} COMMIT;")
    check('a function body still takes the global lane', t[1] == 0, t[2][-120:])

    def hold(sql_lane, secs):
        h = bg(f"BEGIN; {sql_lane} SELECT pg_sleep({secs}); COMMIT;")
        time.sleep(0.5)
        return h

    def in_parallel(jobs):
        res = {}
        ths = [threading.Thread(target=lambda k=k, v=v: res.__setitem__(k, timed(v))) for k, v in jobs.items()]
        for th in ths:
            th.start()
        for th in ths:
            th.join()
        return res

    def fast(r):
        return r[1] == 0 and r[0] < 1.0

    def blocked(r):
        return r[1] != 0 and r[0] >= 0.9

    short_commit = lambda table: w_commit(table).replace("lock_timeout='4s'", "lock_timeout='1s'")

    # A club operation (retirement, welcome unwind, the certification job) holds its club lane 10 s.
    h = hold(f"SELECT public.fn_ca_lock_settlement_lane_for_club('{CLUB}');", 10)
    r = in_parallel({
        'other_club_cash': short_commit(CASH2), 'other_club_tournament_writer': w_wait(TBL[TD]),
        'other_club_tournament_commit': short_commit(TBL[TD]),
        'own_club_cash': short_commit(CASH), 'own_club_tournament_writer': w_wait(TBL[TA]),
    })
    h.wait(30)
    check('a club lane held 10 s: another club\'s cash hand commits at once', fast(r['other_club_cash']), str(r['other_club_cash'][:2]))
    check('a club lane held 10 s: another club\'s tournament writer writes at once',
          fast(r['other_club_tournament_writer']) and fast(r['other_club_tournament_commit']),
          f"{r['other_club_tournament_writer'][:2]} {r['other_club_tournament_commit'][:2]}")
    check('a club lane held 10 s: its own club\'s cash hand waits for it', blocked(r['own_club_cash']), str(r['own_club_cash'][:2]))
    check('a club lane held 10 s: its own club\'s tournament writer waits for it (bounded 4 s)',
          r['own_club_tournament_writer'][1] != 0 and 'F06_RETRY_CANONICAL_LANE' in r['own_club_tournament_writer'][2],
          str(r['own_club_tournament_writer'][:2]))

    # One event's own authority (deal review, standalone settle) holds its event lane 10 s.
    h = hold(f"SELECT public.fn_ca_lock_settlement_lane_for_event('{TA}');", 10)
    r = in_parallel({'B_writer': w_wait(TBL[TB]), 'B_commit': short_commit(TBL[TB]), 'cash': short_commit(CASH),
                     'other_club': w_wait(TBL[TD]), 'A_writer': w_wait(TBL[TA])})
    h.wait(30)
    check('an event lane held 10 s: other events\' writers and cash hands carry on at once',
          all(fast(r[k]) for k in ['B_writer', 'B_commit', 'cash', 'other_club']),
          json.dumps({k: [round(v[0], 2), v[1]] for k, v in r.items()}))
    check('an event lane held 10 s: its own event\'s writer waits (bounded 4 s)',
          r['A_writer'][1] != 0 and 'F06_RETRY_CANONICAL_LANE' in r['A_writer'][2], str(r['A_writer'][:2]))

    # A cancellation-type authority (diamond / managed-game / retired-event void) holds the exclusive event lane.
    h = hold(f"SELECT public.fn_ca_lock_settlement_lane_for_event('{TB}', true);", 10)
    r = in_parallel({'A_writer': w_wait(TBL[TA]), 'cash': short_commit(CASH), 'other_club': short_commit(TBL[TD]),
                     'B_writer': w_wait(TBL[TB])})
    h.wait(30)
    check('an exclusive (cancellation) event lane held 10 s: no other event\'s table or cash hand waits',
          all(fast(r[k]) for k in ['A_writer', 'cash', 'other_club']),
          json.dumps({k: [round(v[0], 2), v[1]] for k, v in r.items()}))
    check('an exclusive (cancellation) event lane held 10 s: its own event\'s writer waits',
          r['B_writer'][1] != 0, str(r['B_writer'][:2]))

    # A satellite takes both events' keys in uuid order.
    h = hold(f"SELECT public.fn_ca_lock_settlement_lane_for_event('{TS}');", 10)
    r = in_parallel({'target_writer': w_wait(TBL[TA]), 'satellite_writer': w_wait(TBL[TS]),
                     'B_writer': w_wait(TBL[TB]), 'cash': short_commit(CASH)})
    h.wait(30)
    check('a satellite lane held 10 s: the satellite and its target wait, nothing else does',
          r['target_writer'][1] != 0 and r['satellite_writer'][1] != 0 and fast(r['B_writer']) and fast(r['cash']),
          json.dumps({k: [round(v[0], 2), v[1]] for k, v in r.items()}))

    # Re-entry and nesting rules.
    t = timed(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_finish('{TA}'); "
              f"SELECT public.fn_ca_lock_settlement_lane_for_event('{TA}'); {GLOBAL} COMMIT;")
    check('inside a finish lane the event lane re-enters it', t[1] == 0, t[2][-160:])
    t = timed(f"BEGIN; {GLOBAL} SELECT public.fn_ca_lock_settlement_lane_for_event('{TA}'); "
              f"SELECT public.fn_ca_lock_settlement_lane_for_club('{CLUB}'); COMMIT;")
    check('under the global lane the event and club lanes re-enter it', t[1] == 0, t[2][-160:])
    t = timed(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_club('{CLUB}'); "
              f"SELECT public.fn_ca_lock_settlement_lane_for_event('{TA}'); "
              f"SELECT smarter_private.cancellation_lane('{TB}'); "
              f"SELECT public.fn_ca_lock_settlement_lane_for_club('{CLUB}'); COMMIT;")
    check("inside a club lane: its events' lanes and cancellations are its own", t[1] == 0, t[2][-160:])
    t = timed(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_club('{CLUB}'); "
              f"SELECT smarter_private.cancellation_lane('{TD}'); COMMIT;")
    check("inside a club lane: another club's cancellation is refused",
          t[1] != 0 and 'CANCELLATION_CLUB_AUTHORITY_INCOMPLETE' in t[2], t[2][-160:])
    t = timed(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_club('{CLUB}'); "
              f"SELECT public.fn_ca_lock_settlement_lane_for_event('{TD}'); COMMIT;")
    check("inside a club lane: another club's event lane is refused", t[1] != 0 and 'outside the club lane' in t[2], t[2][-160:])
    t = timed(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_event('{TB}', true); "
              f"SELECT smarter_private.cancellation_lane('{TB}'); COMMIT;")
    check('cancellation accepts the exclusive event lane of its own event', t[1] == 0, t[2][-160:])

    # The table guard no longer refuses a counter-only update while a global authority queues.
    slow = bg(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TC}'); SELECT pg_sleep(3); COMMIT;")
    time.sleep(0.3)
    glob = bg(f"BEGIN; {GLOBAL} COMMIT;")
    wait_until_waiting(1)
    c1 = timed(f"BEGIN; SELECT public.fn_ca_share_settlement_lane_for_table('{TBL[TB]}'); "
               f"UPDATE public.tables SET current_players = current_players + 1 WHERE id = '{TBL[TB]}'; COMMIT;")
    c2 = timed(f"UPDATE public.tables SET status = 'inactive' WHERE id = '{TBL[TB]}';")
    slow.wait(30)
    glob.wait(30)
    check('the table guard lets a hand commit update its counter while a global authority queues', fast(c1), c1[2][-160:])
    check('the table guard still refuses a lifecycle update while a global authority queues',
          c2[1] != 0 and 'F06_RETRY_CANONICAL_LANE' in c2[2], c2[2][-120:])

    # ---- The migration refuses a drifted pre-image and changes nothing ----
    subprocess.run(as_owner + [str(pg / 'createdb'), '-h', str(sock), '-p', PORT, '-U', 'postgres', 'd'],
                   check=True, env=env)
    psql(SCHEMA, 'd')
    install_preimages('d')
    psql("CREATE OR REPLACE FUNCTION smarter_private.f06_cancelled_preparation_writer_guard() RETURNS trigger "
         "LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;", 'd')
    p = psql(migration, 'd', check=False)
    still = q("SELECT md5(pg_get_functiondef('smarter_private.f06_wait_table_lane(uuid)'::regprocedure))", 'd')
    check('a drifted pre-image refuses the whole migration and nothing changes',
          p.returncode != 0 and 'not the pinned pre-image' in p.stderr and still == '4cd46ed5819cd9a91f87c93d4f112e45')

    # ---- Randomised mixed workload: no deadlock under the documented orders ----
    errors = []
    tours = [TA, TB, TC, TD]

    def worker(seed):
        rnd = random.Random(seed)
        for _ in range(40):
            t = rnd.choice(tours)
            kind = rnd.random()
            if kind < 0.30:
                sql = w_wait(TBL[t])
            elif kind < 0.45:
                sql = f"SET lock_timeout='4s'; {w_share(t, TBL[t])}"
            elif kind < 0.60:
                sql = w_commit(rnd.choice([TBL[t], CASH, CASH2]))
            elif kind < 0.70:  # resume: authority lane first, then the hand lane (G s, T x, B s)
                sql = (f"BEGIN; SET LOCAL lock_timeout='4s'; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{t}'); "
                       f"SELECT public.fn_ca_share_settlement_lane_for_table('{TBL[t]}'); COMMIT;")
            elif kind < 0.82:
                sql = (f"BEGIN; SET LOCAL lock_timeout='4s'; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{t}'); "
                       f"SELECT pg_sleep({rnd.random() * 0.05:.3f}); COMMIT;")
            elif kind < 0.90:
                sql = (f"BEGIN; SET LOCAL lock_timeout='4s'; SELECT public.fn_ca_lock_settlement_lane_for_finish('{t}'); "
                       f"SELECT pg_sleep({rnd.random() * 0.05:.3f}); COMMIT;")
            elif kind < 0.95:
                sql = (f"BEGIN; SET LOCAL lock_timeout='4s'; SELECT public.fn_ca_lock_settlement_lane_for_club('{rnd.choice([CLUB, CLUB2])}'); "
                       f"SELECT pg_sleep({rnd.random() * 0.03:.3f}); COMMIT;")
            elif kind < 0.975:
                sql = (f"BEGIN; SET LOCAL lock_timeout='4s'; SELECT public.fn_ca_lock_settlement_lane_for_event('{rnd.choice(tours + [TS])}', {rnd.choice(['true', 'false'])}); "
                       f"SELECT pg_sleep({rnd.random() * 0.03:.3f}); COMMIT;")
            else:
                sql = (f"BEGIN; SET LOCAL lock_timeout='4s'; {GLOBAL} "
                       f"SELECT public.fn_ca_lock_settlement_lane_for_tournament('{t}'); "
                       f"SELECT pg_sleep({rnd.random() * 0.03:.3f}); COMMIT;")
            p = psql(sql, check=False)
            if p.returncode != 0:
                errors.append(p.stderr.strip()[:400])

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
    t0 = time.monotonic()
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    log = LOG.read_text()
    deadlocks = log.count('deadlock detected')
    bounded = lambda e: 'F06_RETRY' in e or 'lock timeout' in e or 'settlement lane busy' in e  # all 55P03, retried
    timeouts = sum(bounded(e) for e in errors)
    others = [e for e in errors if not bounded(e)]
    results['mixed_workload'] = {'transactions': 480, 'seconds': round(time.monotonic() - t0, 2),
                                 'deadlocks': deadlocks, 'bounded_lock_timeouts': timeouts,
                                 'other_errors': others[:5]}
    check('480 mixed writer/authority/finish/global transactions: zero deadlocks', deadlocks == 0,
          json.dumps(results['mixed_workload']))
    check('mixed workload: no error other than a bounded lock wait', not others, '; '.join(others[:3]))
    check('nothing left holding a lane', q("SELECT count(*) FROM pg_locks WHERE locktype='advisory'") == '0')
finally:
    subprocess.run(as_owner + [str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-m', 'immediate', 'stop'],
                   capture_output=True, env=env)
    (out / 'result.json').write_text(json.dumps(results, indent=1))
    shutil.rmtree(cluster, ignore_errors=True)
print(f"ALL {len(results['checks'])} CHECKS PASSED")
