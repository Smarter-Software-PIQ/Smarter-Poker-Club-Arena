"""Native PG17 probe for 20261111204211: the add-on resolver reads only open hand envelopes.
No production connection. Installs the live body of fn_ca_resolve_unbound_pending_addons
(md5-pinned capture) over a minimal schema with a stub resolve_pending_addon that
records every delivery, and proves on fixed inputs:
  (p) the old body reads every commit payload of a long table history; the new one
      reads only open envelopes (old slow, new fast, same answer);
  (e) old and new return byte-identical receipts and leave identical add-on states
      for: several unfrozen pending add-ons (order created_at, id), one frozen in an
      open envelope (delayed post-commit), one resolved and frozen in a completed
      envelope, one resolved and unfrozen, a commit with a NULL payload;
  (d) duplicate calls and retries deliver each add-on exactly once;
  (i) an interrupted call (rollback) changes nothing and the retry delivers once;
  (c) a concurrent post-commit processor and the resolver serialize on the
      hand-post-commit mutex and never deliver an add-on twice, in either order;
  plus authority, replay and drift refusal.
"""
import json, os, pathlib, select, shutil, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[2]
PRE = (root / 'scripts/ci/probes/addon-resolver-bound/live-predecessor.sql').read_text()
PRE_MD5 = '763f593d8a9cf7739150d3a65cebd1c7'
MIG = (root / 'supabase/migrations/20261111204211_the_addon_resolver_reads_only_open_hand_envelopes.sql').read_text()
SIG = 'public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid)'
pg = pathlib.Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
cluster = pathlib.Path(tempfile.mkdtemp(prefix='ca-addon-bound-', dir='/tmp'))
sock = cluster / 'socket'; sock.mkdir()
psql = [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-p', '55864', '-U', 'postgres', '-d', 'postgres']
sessions, checks = [], []
def run(cmd, source=None):
    r = subprocess.run([str(x) for x in cmd], input=source, text=True, capture_output=True, env=env, timeout=120)
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
        self.err = tempfile.TemporaryFile(); self.p = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, env={**env, 'PGAPPNAME': name})
        self.buf, self.n = b'', 0
        sessions.append(self)
    def send(self, s):
        self.n += 1; self.mark = f'READY_{self.n}'.encode()
        self.p.stdin.write((s + f'\n\\echo READY_{self.n}\n').encode()); self.p.stdin.flush()
    def finish(self, secs=20):
        end, out = time.monotonic() + secs, []
        while time.monotonic() < end:
            while b'\n' in self.buf:
                line, self.buf = self.buf.split(b'\n', 1)
                if line == self.mark: return {'ok': True, 'out': b'\n'.join(out).decode()}
                out.append(line)
            if self.p.poll() is not None:
                self.err.seek(0); return {'ok': False, 'err': self.err.read().decode()[-400:]}
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
        if sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND wait_event_type='Lock';") == '1': return True
        time.sleep(.04)
    return False
T = '00000000-0000-0000-0000-0000000000f1'
GEN = '00000000-0000-0000-0000-0000000000e1'
U = ['00000000-0000-0000-0000-00000000000%d' % i for i in range(1, 7)]
A = {k: '00000000-0000-0000-0000-0000000001%02d' % i for i, k in enumerate(['p1', 'p2', 'p3', 'frozen_open', 'frozen_done', 'resolved'], 1)}
CALL = f"SELECT public.fn_ca_resolve_unbound_pending_addons('{T}', 200, 'inst-1', '{GEN}')::text;"
def seed(history=0):
    sql(f"""TRUNCATE table_pending_addons, hand_atomic_commits, deliveries;
      INSERT INTO table_pending_addons(id, table_id, user_id, amount, kind, created_at, resolved_at) VALUES
        ('{A['p2']}', '{T}', '{U[1]}', 60, 'rebuy', '2026-11-11 10:00:02', NULL),
        ('{A['p1']}', '{T}', '{U[0]}', 50, 'addon', '2026-11-11 10:00:01', NULL),
        ('{A['p3']}', '{T}', '{U[2]}', 70, NULL,    '2026-11-11 10:00:02', NULL),
        ('{A['frozen_open']}', '{T}', '{U[3]}', 80, 'addon', '2026-11-11 09:59:00', NULL),
        ('{A['frozen_done']}', '{T}', '{U[4]}', 90, 'addon', '2026-11-11 09:58:00', '2026-11-11 09:59:30'),
        ('{A['resolved']}', '{T}', '{U[5]}', 95, 'addon', '2026-11-11 09:57:00', '2026-11-11 09:57:30');
      INSERT INTO hand_atomic_commits(table_id, hand_number, post_commit_payload, post_commit_completed_at) VALUES
        ('{T}', 1, jsonb_build_object('pending_addons', jsonb_build_object('ids', jsonb_build_array('{A['frozen_done']}'))), '2026-11-11 09:59:30'),
        ('{T}', 2, NULL, NULL),
        ('{T}', 3, jsonb_build_object('pending_addons', jsonb_build_object('ids', jsonb_build_array('{A['frozen_open']}'))), NULL);
      INSERT INTO hand_atomic_commits(table_id, hand_number, post_commit_payload, post_commit_completed_at)
        SELECT '{T}', 100 + i, jsonb_build_object('pad', repeat(md5(i::text), 120), 'pending_addons', jsonb_build_object('ids', '[]'::jsonb)), now()
          FROM generate_series(1, {history}) i;
      ANALYZE hand_atomic_commits;""")
def state():
    return sql("SELECT string_agg(id::text||':'||coalesce(resolved_at::text,'-'), ',' ORDER BY id) FROM table_pending_addons;") + ' | ' + \
           sql("SELECT coalesce(string_agg(addon_id::text, ',' ORDER BY seq), '') FROM deliveries;")
def trial(history=0):
    """Run one resolver call in a rolled-back transaction; return receipt, resulting state, ms."""
    seed(history)
    s = Session('trial')
    s.execute("SET client_min_messages = warning; BEGIN;")
    t0 = time.monotonic(); receipt = s.execute(CALL); ms = (time.monotonic() - t0) * 1000
    st = s.execute("SELECT string_agg(id::text||':'||(resolved_at IS NOT NULL)::text, ',' ORDER BY id) FROM table_pending_addons;") + ' | ' + \
         s.execute("SELECT coalesce(string_agg(addon_id::text, ',' ORDER BY seq), '') FROM deliveries;")
    s.execute('ROLLBACK;'); s.close()
    return receipt, st, ms
def body_md5(): return sql(f"SELECT md5(pg_get_functiondef('{SIG}'::regprocedure));")
def authority(): return sql(f"SELECT pg_get_userbyid(proowner)||'|'||proacl::text||'|'||proconfig::text||'|'||prosecdef FROM pg_proc WHERE oid='{SIG}'::regprocedure;")
started = False
try:
    run([pg / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
    run([pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p 55864 -c listen_addresses='' -c deadlock_timeout=200ms", '-w', 'start', '-l', cluster / 'log'])
    started = True
    check('uses PostgreSQL 17', 'PostgreSQL) 17.' in run([pg / 'postgres', '--version']))
    sql(f"""CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA extensions;
      CREATE TABLE tables(id uuid PRIMARY KEY, tournament_id uuid);
      CREATE TABLE engine_table_leases(table_id uuid PRIMARY KEY, instance_id text, lease_generation uuid, protocol_version integer, heartbeat_at timestamptz);
      CREATE FUNCTION fn_engine_lease_stale_seconds() RETURNS integer LANGUAGE sql AS $$ SELECT 3600 $$;
      CREATE TABLE table_pending_addons(id uuid PRIMARY KEY, table_id uuid, user_id uuid, amount numeric, kind text, created_at timestamptz, resolved_at timestamptz,
        applied_to_stack numeric, refunded numeric);
      CREATE TABLE hand_atomic_commits(table_id uuid, hand_number bigint, post_commit_payload jsonb, post_commit_completed_at timestamptz, PRIMARY KEY (table_id, hand_number));
      CREATE INDEX idx_hand_atomic_commits_post_commit_pending ON hand_atomic_commits(table_id, hand_number)
        WHERE post_commit_payload IS NOT NULL AND post_commit_completed_at IS NULL;
      CREATE TABLE deliveries(seq bigserial PRIMARY KEY, addon_id uuid, applied numeric);
      -- Stub with the real contract: idempotent per row, delivers once, echoes on replay.
      CREATE FUNCTION resolve_pending_addon(p_id uuid, p_max numeric, OUT applied numeric, OUT refunded numeric) LANGUAGE plpgsql AS $$
      DECLARE r table_pending_addons%ROWTYPE; v_a numeric; v_r numeric;
      BEGIN
        SELECT * INTO r FROM table_pending_addons WHERE id = p_id FOR UPDATE;
        IF r.resolved_at IS NOT NULL THEN applied := r.applied_to_stack; refunded := r.refunded; RETURN; END IF;
        v_a := least(r.amount, coalesce(p_max, r.amount)); v_r := r.amount - v_a;
        INSERT INTO deliveries(addon_id, applied) VALUES (p_id, v_a);
        UPDATE table_pending_addons t SET resolved_at = clock_timestamp(), applied_to_stack = v_a, refunded = v_r WHERE t.id = p_id;
        applied := v_a; refunded := v_r;
      END $$;
      -- The post-commit processor's contract for frozen ids: same mutex, resolve every
      -- frozen id, then complete, in one transaction.
      CREATE FUNCTION process_post_commit(p_table uuid, p_hand bigint) RETURNS void LANGUAGE plpgsql AS $$
      DECLARE v jsonb; i jsonb;
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended('hand-post-commit:' || p_table::text, 0));
        SELECT post_commit_payload INTO v FROM hand_atomic_commits WHERE table_id = p_table AND hand_number = p_hand AND post_commit_completed_at IS NULL FOR UPDATE;
        IF v IS NULL THEN RETURN; END IF;
        FOR i IN SELECT * FROM jsonb_array_elements(v #> '{{pending_addons,ids}}') LOOP
          PERFORM resolve_pending_addon((i #>> '{{}}')::uuid, NULL);
        END LOOP;
        UPDATE hand_atomic_commits SET post_commit_completed_at = clock_timestamp() WHERE table_id = p_table AND hand_number = p_hand;
      END $$;
      INSERT INTO tables VALUES ('{T}', NULL);
      INSERT INTO engine_table_leases VALUES ('{T}', 'inst-1', '{GEN}', 2, now());""")
    sql(PRE + ';\nREVOKE ALL ON FUNCTION ' + SIG.replace(',', ', ') + ' FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION ' + SIG.replace(',', ', ') + ' TO service_role;')
    check('captured predecessor is the live body (md5 ' + PRE_MD5 + ')', body_md5() == PRE_MD5)
    auth = authority()
    check('predecessor authority is the live authority',
          auth == 'postgres|{postgres=X/postgres,service_role=X/postgres}|{"search_path=public, extensions, pg_temp"}|true')
    old_small = trial(0)
    old_big = trial(60000)
    sql(MIG)
    check('migration keeps owner, grants, proconfig and SECURITY DEFINER', authority() == auth)
    post = body_md5(); sql(MIG)
    check('migration replays as a no-op', body_md5() == post and authority() == auth)
    new_small = trial(0)
    new_big = trial(60000)
    check('(e) receipts are byte-identical on fixed inputs', old_small[0] == new_small[0] and old_big[0] == new_big[0])
    check('(e) resulting add-on states and deliveries are identical', old_small[1] == new_small[1] and old_big[1] == new_big[1])
    r = json.loads(new_small[0])
    check('(e) exactly the three unfrozen unresolved add-ons, in created_at then id order',
          [x['id'] for x in r['rows']] == [A['p1'], A['p2'], A['p3']] and r['resolved'] == 3)
    check('(e) the add-on frozen in an open envelope is left to its hand', A['frozen_open'] not in new_small[0])
    print(f"timing: old {old_big[2]:.0f} ms, new {new_big[2]:.0f} ms over a 60,000-commit history", flush=True)
    check('(p) the old body pays for the whole history; the new one does not', old_big[2] > 5 * new_big[2] and new_big[2] < 500)
    seed(0)
    first, again = sql(CALL), sql(CALL)
    check('(d) a duplicate call delivers nothing more', json.loads(again)['resolved'] == 0 and
          sql("SELECT count(*)||':'||count(DISTINCT addon_id) FROM deliveries;") == '3:3')
    seed(0)
    s = Session('interrupted'); s.execute('BEGIN;'); s.execute(CALL); s.execute('ROLLBACK;'); s.close()
    check('(i) an interrupted call leaves no delivery and no resolution',
          sql("SELECT count(*) FROM deliveries;") == '0' and sql(f"SELECT count(*) FROM table_pending_addons WHERE resolved_at IS NOT NULL;") == '2')
    sql(CALL)
    check('(i) the retry delivers each eligible add-on exactly once', sql("SELECT count(*)||':'||count(DISTINCT addon_id) FROM deliveries;") == '3:3')
    for first_actor in ('processor', 'resolver'):
        seed(0)
        a, b = Session('c-' + first_actor), Session('c-other')
        if first_actor == 'processor':
            a.execute(f"BEGIN; SELECT process_post_commit('{T}', 3);")
            b.send('BEGIN; ' + CALL + ' COMMIT;')
        else:
            a.execute('BEGIN; ' + CALL)
            b.send(f"BEGIN; SELECT process_post_commit('{T}', 3); COMMIT;")
        blocked = waiting(b.name)
        a.execute('COMMIT;'); out = b.finish(); a.close(); b.close()
        check(f'(c) {first_actor} first: the other waits on the hand-post-commit mutex and every add-on is delivered exactly once',
              blocked and out and out['ok'] and sql("SELECT count(*)||':'||count(DISTINCT addon_id) FROM deliveries;") == '4:4')
    sql("CREATE OR REPLACE FUNCTION " + SIG.replace(',', ', ').replace('(uuid, numeric, text, uuid)', '(p_table_id uuid, p_max_buy_in numeric, p_instance_id text, p_lease_generation uuid)') +
        " RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $f$ SELECT '{}'::jsonb $f$;")
    drifted = body_md5(); no, err = refused(MIG)
    check('a drifted body is refused and left untouched', no and 'not the pinned text' in err and body_md5() == drifted)
    print(json.dumps({'passed': True, 'checks': len(checks)}))
finally:
    for s in sessions: s.close()
    if started: subprocess.run([str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-m', 'immediate', 'stop'], env=env, capture_output=True)
    shutil.rmtree(cluster, ignore_errors=True)
