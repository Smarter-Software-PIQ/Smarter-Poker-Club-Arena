"""Native PostgreSQL probe for 20261127121037: the player index bound waits only for hand writers.

No production connection. Installs, over a minimal schema, the live body of
ca_refresh_hand_player_index (the body 20261111131639 installs; md5
189b93e13db1ced3dd258aebfc46cd49 read from production on 2026-11-27) and
proves, predecessor first, with one real five-minute wait:
  (u) an UNRELATED transaction (no lock on hand_history) open for more than
      five minutes stops the live body's index for as long as it stays open;
      the new body indexes past it;
  (w) a hand WRITER open for more than five minutes still holds idx_ceil at
      its start under the new body, and its hand is indexed exactly once after
      it commits;
  plus authority, replay and drift refusal.
"""
import hashlib, json, os, pathlib, shutil, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[2]
PRE = (root / 'scripts/ci/probes/idx-refresh-lag/live-predecessor.sql').read_text()
PREV_MIG = (root / 'supabase/migrations/20261111131639_the_player_index_refresh_leaves_young_hands_alone.sql').read_text()
MIG = (root / 'supabase/migrations/20261127121037_the_player_index_bound_waits_only_for_hand_writers.sql').read_text()
LIVE_MD5 = '189b93e13db1ced3dd258aebfc46cd49'
WAIT = os.environ.get('IDX_PROBE_WAIT', '5 minutes 2 seconds')
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
cluster = pathlib.Path(tempfile.mkdtemp(prefix='ca-idx-xact-', dir='/tmp'))
sock = cluster / 'socket'; sock.mkdir()
psql = [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-p', '55864', '-U', 'postgres', '-d', 'postgres']
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
    """One psql process holding one connection, so a transaction stays open between calls."""
    def __init__(self, name):
        self.name, self.n = name, 0
        self.p = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**env, 'PGAPPNAME': name})
        sessions.append(self)
    def execute(self, s):
        self.n += 1; mark = f'READY_{self.n}'
        self.p.stdin.write((s + f'\n\\echo {mark}\n').encode()); self.p.stdin.flush()
        out = []
        while True:
            line = self.p.stdout.readline().decode().rstrip('\n')
            if not line and self.p.poll() is not None: raise RuntimeError(self.name + ' exited')
            if line == mark: return '\n'.join(out)
            out.append(line)
    def close(self):
        if self.p.poll() is None:
            self.p.stdin.close()
            try: self.p.wait(timeout=3)
            except subprocess.TimeoutExpired: self.p.terminate()
A, B = '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b'
LATE, H2 = '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004'
PL = f"""'[{{"userId":"{A}"}},{{"userId":"{B}"}}]'::jsonb"""
REFRESH = 'SELECT hands_indexed FROM public.ca_refresh_hand_player_index(60000);'
def create_of(m):
    s = m.index('CREATE OR REPLACE FUNCTION public.ca_refresh_hand_player_index')
    return m[s:m.index('$function$;', s) + len('$function$;')]
OLD_BODY, NEW_BODY = create_of(PREV_MIG), create_of(MIG)
def body_md5(): return sql("SELECT md5(pg_get_functiondef('public.ca_refresh_hand_player_index(integer)'::regprocedure));")
def authority(): return sql("SELECT pg_get_userbyid(proowner)||'|'||proacl::text||'|'||proconfig::text||'|'||prosecdef FROM pg_proc WHERE oid='public.ca_refresh_hand_player_index(integer)'::regprocedure;")
def ceil_after(start, body):
    """Install body, run one refresh with the ceil reset to an hour ago, report whether idx_ceil passed start."""
    sql(body)
    sql("UPDATE ca_hand_player_idx_state SET idx_ceil = now() - interval '1 hour';")
    sql(REFRESH)
    return sql(f"SELECT idx_ceil > '{start}'::timestamptz FROM ca_hand_player_idx_state;") == 't'
def idx_count(h): return sql(f"SELECT count(*) FROM ca_hand_player_idx WHERE hand_id='{h}';")
started = False
try:
    run([pg / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
    run([pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p 55864 -c listen_addresses=''", '-w', 'start', '-l', cluster / 'log'])
    started = True
    ver = run([pg / 'postgres', '--version'])
    check('uses PostgreSQL 16 or later (' + ver + ')', int(ver.split(')')[1].strip().split('.')[0]) >= 16)
    sql("""CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE hand_history(id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), players jsonb);
      CREATE TABLE ca_hand_player_idx(user_id uuid, created_at timestamptz, hand_id uuid, PRIMARY KEY (user_id, hand_id));
      CREATE TABLE ca_hand_player_idx_state(id boolean PRIMARY KEY CHECK (id), watermark timestamptz, rows_indexed bigint NOT NULL DEFAULT 0,
        updated_at timestamptz, idx_floor timestamptz, idx_ceil timestamptz, backfill_complete boolean NOT NULL DEFAULT false);
      INSERT INTO ca_hand_player_idx_state(id, idx_floor, backfill_complete) VALUES (true, now() - interval '2 hours', true);
      CREATE TABLE ca_hand_fact_revisions(hand_id uuid, user_id uuid);
      CREATE TABLE unrelated(x int); INSERT INTO unrelated VALUES (1);""")
    sql(PRE + ';\nREVOKE ALL ON FUNCTION public.ca_refresh_hand_player_index(integer) FROM PUBLIC;\n'
        'GRANT EXECUTE ON FUNCTION public.ca_refresh_hand_player_index(integer) TO service_role;')
    sql(PREV_MIG)
    check('the 20261111131639 body is the live body (md5 ' + LIVE_MD5 + ')', body_md5() == LIVE_MD5)
    auth = authority()
    # One wait serves every case: an unrelated reader and a hand writer open together.
    u, w = Session('unrelated-reader'), Session('hand-writer')
    u.execute('BEGIN; SELECT count(*) FROM unrelated;')
    start = u.execute('SELECT now();').strip()
    w.execute(f"BEGIN; INSERT INTO hand_history VALUES ('{LATE}', now(), {PL});")
    wstart = w.execute('SELECT now();').strip()
    while sql(f"SELECT now() > '{wstart}'::timestamptz + interval '{WAIT}';") != 't': time.sleep(2)
    sql(f"INSERT INTO hand_history VALUES ('{H2}', '{wstart}'::timestamptz + interval '1 second', {PL});")
    check('both bodies: an open hand writer holds idx_ceil at its start',
          not ceil_after(wstart, OLD_BODY) and not ceil_after(wstart, NEW_BODY))
    w.execute('COMMIT;'); w.close()
    check('(u) live body: an unrelated open transaction stops the index past its start', not ceil_after(start, OLD_BODY))
    check('(u) new body: the index passes an unrelated open transaction', ceil_after(start, NEW_BODY))
    check('(w) the writer\'s hand is indexed for every player exactly once after commit',
          idx_count(LATE) == '2' and idx_count(H2) == '2')
    sql(REFRESH)
    check('(w) a further refresh adds nothing', idx_count(LATE) == '2' and idx_count(H2) == '2')
    u.execute('COMMIT;'); u.close()
    check('(o) idx_ceil is at or before now() - 5 minutes', sql("SELECT idx_ceil <= statement_timestamp() - interval '5 minutes' FROM ca_hand_player_idx_state;") == 't')
    sql(OLD_BODY)
    sql(MIG)
    check('the migration installs over the live body', body_md5() != LIVE_MD5)
    check('owner, grants, proconfig and SECURITY DEFINER retained', authority() == auth)
    new_def = sql("SELECT pg_get_functiondef('public.ca_refresh_hand_player_index(integer)'::regprocedure);") + '\n'
    old_line = MIG.split('v_old1 text := $f$', 1)[1].split('$f$;', 1)[0]
    new_line = MIG.split('v_new1 text := $f$', 1)[1].split('$f$;', 1)[0]
    check('the change is exactly the one v_bound line', new_def.count(new_line) == 1 and old_line not in new_def
          and hashlib.md5(new_def.replace(new_line, old_line).encode()).hexdigest() == LIVE_MD5)
    post = body_md5(); sql(MIG)
    check('migration replays as a no-op', body_md5() == post and authority() == auth)
    sql("CREATE OR REPLACE FUNCTION public.ca_refresh_hand_player_index(p_max_hands integer DEFAULT 50000) RETURNS TABLE(hands_indexed integer, rows_added integer, floor_at timestamptz, ceil_at timestamptz, complete boolean) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '10min' AS $f$ SELECT 0, 0, NULL::timestamptz, NULL::timestamptz, true $f$;")
    drifted = body_md5(); no, err = refused(MIG)
    check('a drifted body is refused and left untouched', no and 'not the pinned text' in err and body_md5() == drifted)
    print(json.dumps({'passed': True, 'checks': len(checks)}))
finally:
    for s in sessions: s.close()
    if started: subprocess.run([str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-m', 'immediate', 'stop'], env=env, capture_output=True)
    shutil.rmtree(cluster, ignore_errors=True)
