"""Native PG17 probe for 20261111131639: the player index refresh leaves young hands to the live projection.
No production connection. Installs the live body of ca_refresh_hand_player_index
(md5-pinned capture) over a minimal schema and proves, predecessor first:
  (r) the live body makes a live index insert of a young hand wait on its open
      transaction; the new body does not;
  (s) the live body closes its window past a hand whose writer is still open and
      skips it for good; the new body holds idx_ceil at that writer's start and
      indexes the hand exactly once after commit (real 5-minute wait);
  (v) the live body re-inserts a voided player-hand; the new body does not;
  (o) older hands are still indexed; idx_ceil never passes now() - 5 minutes;
  plus authority, replay and drift refusal.
"""
import json, os, pathlib, re, select, shutil, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[2]
PRE = (root / 'scripts/ci/probes/idx-refresh-lag/live-predecessor.sql').read_text()
PRE_MD5 = '8a0a2d56f0bb0c89b0b71005d753671e'
MIG = (root / 'supabase/migrations/20261111131639_the_player_index_refresh_leaves_young_hands_to_the_live_projection.sql').read_text()
pg = pathlib.Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
cluster = pathlib.Path(tempfile.mkdtemp(prefix='ca-idx-lag-', dir='/tmp'))
sock = cluster / 'socket'; sock.mkdir()
psql = [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-p', '55863', '-U', 'postgres', '-d', 'postgres']
sessions, checks = [], []
def run(cmd, source=None):
    r = subprocess.run([str(x) for x in cmd], input=source, text=True, capture_output=True, env=env, timeout=60)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
def sql(s): return run(psql, s)
def refused(s):
    r = subprocess.run(psql, input=s, text=True, capture_output=True, env=env, timeout=60)
    return r.returncode != 0, r.stderr
def check(name, cond):
    assert cond, name
    checks.append(name); print('PASS:', name, flush=True)
class Session:
    def __init__(self, name):
        self.name = name
        self.p = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**env, 'PGAPPNAME': name})
        self.buf, self.n = b'', 0
        sessions.append(self)
    def send(self, s):
        self.n += 1; self.mark = f'READY_{self.n}'.encode()
        self.p.stdin.write((s + f'\n\\echo READY_{self.n}\n').encode()); self.p.stdin.flush()
    def finish(self, secs=15):
        end, out = time.monotonic() + secs, []
        while time.monotonic() < end:
            while b'\n' in self.buf:
                line, self.buf = self.buf.split(b'\n', 1)
                if line == self.mark: return {'ok': True, 'out': b'\n'.join(out).decode()}
                out.append(line)
            if self.p.poll() is not None: return {'ok': False}
            if select.select([self.p.stdout], [], [], .03)[0]: self.buf += os.read(self.p.stdout.fileno(), 65536)
        return None
    def execute(self, s):
        self.send(s); r = self.finish()
        if not r or not r['ok']: raise RuntimeError(self.name + ': ' + str(r))
        return r['out']
    def close(self):
        if self.p.poll() is None:
            self.p.stdin.close()
            try: self.p.wait(timeout=3)
            except subprocess.TimeoutExpired: self.p.terminate()
def waiting(name, secs=4):
    end = time.monotonic() + secs
    while time.monotonic() < end:
        if sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND wait_event='transactionid';") == '1': return True
        time.sleep(.04)
    return False
A, B = '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b'
OLD, YOUNG, LATE, H2 = ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
                        '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004')
PL = f"""'[{{"userId":"{A}"}},{{"userId":"{B}"}}]'::jsonb"""
REFRESH = 'SELECT hands_indexed FROM public.ca_refresh_hand_player_index(60000);'
LIVE = (f"SET LOCAL statement_timeout='3s'; INSERT INTO ca_hand_player_idx(user_id,created_at,hand_id) "
        f"SELECT '{A}',created_at,id FROM hand_history WHERE id='{YOUNG}' ON CONFLICT DO NOTHING;")
def seed(ceil="now() - interval '1 hour'"):
    sql(f"""TRUNCATE hand_history, ca_hand_player_idx, ca_hand_fact_revisions;
      INSERT INTO hand_history VALUES ('{OLD}', now() - interval '10 minutes', {PL}), ('{YOUNG}', now() - interval '10 seconds', {PL});
      UPDATE ca_hand_player_idx_state SET idx_ceil = {ceil}, idx_floor = now() - interval '2 hours', backfill_complete = true;""")
def rows(h=None):
    w = f" WHERE hand_id='{h}'" if h else ''
    return sql(f"SELECT coalesce(string_agg(hand_id::text||':'||user_id::text, ',' ORDER BY hand_id,user_id),'') FROM ca_hand_player_idx{w};")
def race(label):
    roll, live = Session(label + '-refresh'), Session(label + '-live')
    roll.execute('BEGIN; ' + REFRESH)
    live.send('BEGIN; ' + LIVE + ' COMMIT;')
    blocked = waiting(live.name)
    roll.execute('COMMIT;'); out = live.finish()
    roll.close(); live.close()
    return blocked, out
def open_writer(label, wait):
    """LATE is inserted by a transaction still open while a later hand H2 commits."""
    sql("TRUNCATE hand_history, ca_hand_player_idx, ca_hand_fact_revisions;"
        "UPDATE ca_hand_player_idx_state SET idx_ceil = now() - interval '1 hour';")
    w = Session(label + '-writer')
    w.execute(f"BEGIN; INSERT INTO hand_history VALUES ('{LATE}', now(), {PL});")
    start = w.execute('SELECT now();').strip()
    while sql(f"SELECT now() > '{start}'::timestamptz + interval '{wait}';") != 't': time.sleep(2)
    sql(f"INSERT INTO hand_history VALUES ('{H2}', '{start}'::timestamptz + interval '1 second', {PL});")
    sql(REFRESH)
    held = sql(f"SELECT idx_ceil <= '{start}'::timestamptz FROM ca_hand_player_idx_state;") == 't'
    w.execute('COMMIT;'); w.close()
    sql(REFRESH); sql(REFRESH)
    return held, sql(f"SELECT count(*) FROM ca_hand_player_idx WHERE hand_id='{LATE}';")
def voided():
    seed()
    sql(f"INSERT INTO ca_hand_fact_revisions VALUES ('{OLD}','{A}');")
    sql(REFRESH)
    got = rows(OLD)
    sql('TRUNCATE ca_hand_fact_revisions;')
    return got
def pairs():
    m = MIG
    return [(re.search(r"v_old%d text := \$f\$(.*?)\$f\$;" % i, m, re.S).group(1), re.search(r"v_new%d text := \$f\$(.*?)\$f\$;" % i, m, re.S).group(1)) for i in (1, 2, 3)]
def reverse(d):
    for o, n in pairs():
        assert d.count(n) == 1
        d = d.replace(n, o)
    return d
def body_md5(): return sql("SELECT md5(pg_get_functiondef('public.ca_refresh_hand_player_index(integer)'::regprocedure));")
def authority(): return sql("SELECT pg_get_userbyid(proowner)||'|'||proacl::text||'|'||proconfig::text||'|'||prosecdef FROM pg_proc WHERE oid='public.ca_refresh_hand_player_index(integer)'::regprocedure;")
started = False
try:
    run([pg / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
    run([pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p 55863 -c listen_addresses='' -c deadlock_timeout=200ms", '-w', 'start', '-l', cluster / 'log'])
    started = True
    check('uses PostgreSQL 17', 'PostgreSQL) 17.' in run([pg / 'postgres', '--version']))
    sql("""CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE hand_history(id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), players jsonb);
      CREATE TABLE ca_hand_player_idx(user_id uuid, created_at timestamptz, hand_id uuid, PRIMARY KEY (user_id, hand_id));
      CREATE TABLE ca_hand_player_idx_state(id boolean PRIMARY KEY CHECK (id), watermark timestamptz, rows_indexed bigint NOT NULL DEFAULT 0,
        updated_at timestamptz, idx_floor timestamptz, idx_ceil timestamptz, backfill_complete boolean NOT NULL DEFAULT false);
      INSERT INTO ca_hand_player_idx_state(id) VALUES (true);
      CREATE TABLE ca_hand_fact_revisions(hand_id uuid, user_id uuid);""")
    sql(PRE + ';\nREVOKE ALL ON FUNCTION public.ca_refresh_hand_player_index(integer) FROM PUBLIC;\n'
        'GRANT EXECUTE ON FUNCTION public.ca_refresh_hand_player_index(integer) TO service_role;')
    check('captured predecessor is the live body (md5 ' + PRE_MD5 + ')', body_md5() == PRE_MD5)
    auth = authority()
    check('predecessor authority is the live authority',
          auth == 'postgres|{postgres=X/postgres,service_role=X/postgres}|{search_path=public,statement_timeout=10min}|true')
    seed(); blocked, out = race('before')
    check('live body: a live index insert of a 10 s old hand waits on the open refresh', blocked and out and out['ok'])
    check('live body: a voided player-hand is re-inserted', f'{OLD}:{A}' in voided())
    held, n = open_writer('before', '2 seconds')
    check('live body: the window closes past an open writer and its hand is skipped for good', not held and n == '0')
    sql(MIG)
    check('owner, grants, proconfig and SECURITY DEFINER retained', authority() == auth)
    MIGDEF = sql("SELECT pg_get_functiondef('public.ca_refresh_hand_player_index(integer)'::regprocedure);") + "\n"
    check('reverse substitution reproduces the live body', __import__('hashlib').md5(reverse(MIGDEF).encode()).hexdigest() == PRE_MD5)
    post = body_md5(); sql(MIG)
    check('migration replays as a no-op', body_md5() == post and authority() == auth)
    seed(); blocked, out = race('after')
    check('(r) a live index insert of a 10 s old hand does not wait', not blocked and out and out['ok'])
    check('(o) the 10 minute old hand is indexed for every player', rows(OLD) == f'{OLD}:{A},{OLD}:{B}')
    check('(o) idx_ceil is at or before now() - 5 minutes', sql("SELECT idx_ceil <= statement_timestamp() - interval '5 minutes' FROM ca_hand_player_idx_state;") == 't')
    check('(v) a voided player-hand is not re-inserted, the other player is', voided() == f'{OLD}:{B}')
    held, n = open_writer('after', '5 minutes 2 seconds')
    check('(s) idx_ceil holds at an open writer\'s start and its hand is indexed exactly once after commit', held and n == '2')
    sql("CREATE OR REPLACE FUNCTION public.ca_refresh_hand_player_index(p_max_hands integer DEFAULT 50000) RETURNS TABLE(hands_indexed integer, rows_added integer, floor_at timestamptz, ceil_at timestamptz, complete boolean) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '10min' AS $f$ SELECT 0, 0, NULL::timestamptz, NULL::timestamptz, true $f$;")
    drifted = body_md5(); no, err = refused(MIG)
    check('a drifted body is refused and left untouched', no and 'not the pinned text' in err and body_md5() == drifted)
    print(json.dumps({'passed': True, 'checks': len(checks)}))
finally:
    for s in sessions: s.close()
    if started: subprocess.run([str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-m', 'immediate', 'stop'], env=env, capture_output=True)
    shutil.rmtree(cluster, ignore_errors=True)
