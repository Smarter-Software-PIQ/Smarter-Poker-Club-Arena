"""Native PG17 probe for 20261111093132: the VPIP sample reads only the sitting.
No production connection. Installs the live bodies of fn_nit_sample and
fn_nit_hands_since (from 20261111003710, md5-pinned) over a minimal schema and
proves: (1) before, the generic plan cannot bound played_at; (2) after, it is an
index condition; (3) both functions return exactly the predecessor's answers
for every argument shape (since NULL / set, rolling / cumulative, cluster /
table, > vs >= boundary); (4) authority is unchanged; (5) drift is refused.
"""
import os, pathlib, re, shutil, subprocess, tempfile, json
root = pathlib.Path(__file__).resolve().parents[2]
PRED = (root / 'supabase/migrations/20261111003710_the_classic_floor_judges_thirty_dealt_hands_and_warns_before.sql').read_text()
MIG = (root / 'supabase/migrations/20261111093132_the_vpip_sample_reads_only_the_sitting.sql').read_text()
pg = pathlib.Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
cluster = pathlib.Path(tempfile.mkdtemp(prefix='ca-vpip-sargable-', dir='/tmp'))
sock = cluster / 'socket'; sock.mkdir()
psql = [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-p', '55862', '-U', 'postgres', '-d', 'postgres']
checks = []
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
def grab(name):
    i = PRED.index('CREATE OR REPLACE FUNCTION public.' + name + '(')
    j = PRED.index('$function$;', PRED.index('AS $function$', i) + 5) + len('$function$;')
    return PRED[i:j]
SAMPLE, HANDS = grab('fn_nit_sample'), grab('fn_nit_hands_since')
MD5 = {'fn_nit_sample': 'aa2d137ebcf2cad719cb5a40913a142f', 'fn_nit_hands_since': '6bc3fb588d3c28aef69dc112c8c6dcc9'}
SIG = {'fn_nit_sample': 'public.fn_nit_sample(uuid,uuid,uuid,timestamptz,boolean,integer)', 'fn_nit_hands_since': 'public.fn_nit_hands_since(uuid,uuid,uuid,timestamptz)'}
def md5(n): return sql(f"SELECT md5(pg_get_functiondef('{SIG[n]}'::regprocedure));")
def authority(n): return sql(f"SELECT pg_get_userbyid(proowner)||'|'||proacl::text||'|'||proconfig::text||'|'||prosecdef||'|'||provolatile::text FROM pg_proc WHERE oid='{SIG[n]}'::regprocedure;")
U, G, T1, T2, TX = ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1',
                    '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b9')
SHAPES = []
for game, table in ((G, T1), ('NULL', T1)):
    for since in ("NULL", "now() - interval '90 minutes'", "(SELECT played_at FROM ca_hand_facts WHERE hand_id = '00000000-0000-0000-0000-000000000150')"):
        for rolling, window in (('true', 30), ('false', 30), ('true', 1), ('NULL', 10)):
            SHAPES.append((game, table, since, rolling, window))
def answers():
    out = []
    for game, table in ((G, T1), ('NULL', T1)):
        g = 'NULL' if game == 'NULL' else f"'{game}'"
        for since in ("NULL", "now() - interval '90 minutes'", "(SELECT played_at FROM ca_hand_facts WHERE hand_id = '00000000-0000-0000-0000-000000000150')"):
            for rolling, window in (('true', 30), ('false', 30), ('true', 1), ('NULL', 10)):
                out.append(sql(f"SELECT row(s.*)::text FROM public.fn_nit_sample('{table}', {g}::uuid, '{U}', {since}, {rolling}, {window}) s;"))
            out.append(sql(f"SELECT public.fn_nit_hands_since('{table}', {g}::uuid, '{U}', {since});"))
    return out
def generic_plan():
    return sql(f"""SET plan_cache_mode = force_generic_plan;
      PREPARE p(uuid,uuid,uuid,timestamptz,boolean,integer) AS
        SELECT * FROM public.fn_nit_sample($1,$2,$3,$4,$5,$6);
      SELECT 1;""")
started = False
try:
    run([pg / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
    run([pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p 55862 -c listen_addresses=''", '-w', 'start', '-l', cluster / 'log'])
    started = True
    check('uses PostgreSQL 17', 'PostgreSQL) 17.' in run([pg / 'postgres', '--version']))
    sql(f"""CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE tables(id uuid PRIMARY KEY, cluster_id uuid);
      CREATE INDEX tables_cluster_id_idx ON tables(cluster_id);
      CREATE TABLE ca_hand_facts(hand_id uuid, user_id uuid NOT NULL, table_id uuid, played_at timestamptz NOT NULL, vpip boolean NOT NULL,
        PRIMARY KEY (hand_id, user_id));
      CREATE INDEX idx_ca_hand_facts_user_time ON ca_hand_facts(user_id, played_at DESC);
      INSERT INTO tables VALUES ('{T1}','{G}'),('{T2}','{G}'),('{TX}',NULL);
      -- 200 hands over 200 minutes: table alternates T1/T2/TX, vpip every third.
      INSERT INTO ca_hand_facts SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '{U}',
        (ARRAY['{T1}','{T2}','{TX}']::uuid[])[1 + i % 3], now() - (i || ' minutes')::interval, i % 3 = 0
        FROM generate_series(1,200) i;
      -- Bulk history for a planner-realistic size, on another table only.
      INSERT INTO ca_hand_facts SELECT gen_random_uuid(), '{U}', '{TX}', now() - interval '1 day' - (i || ' seconds')::interval, false
        FROM generate_series(1,50000) i;
      ANALYZE;
      {SAMPLE}
      {HANDS}
      REVOKE ALL ON FUNCTION public.fn_nit_sample(uuid, uuid, uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.fn_nit_sample(uuid, uuid, uuid, timestamptz, boolean, integer) TO service_role;
      REVOKE ALL ON FUNCTION public.fn_nit_hands_since(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.fn_nit_hands_since(uuid, uuid, uuid, timestamptz) TO service_role;""")
    for n in MD5:
        check(f'predecessor {n} is the live body (md5 {MD5[n]})', md5(n) == MD5[n])
    auth = {n: authority(n) for n in MD5}
    check('predecessor authority is the live authority',
          auth['fn_nit_sample'] == 'postgres|{postgres=X/postgres,service_role=X/postgres}|{"search_path=public, pg_temp"}|false|s')
    PLAN = ("SET plan_cache_mode = force_generic_plan; "
            "PREPARE q(uuid,timestamptz) AS SELECT f.vpip FROM public.ca_hand_facts f WHERE f.user_id = $1 AND {pred} ORDER BY f.played_at DESC LIMIT 30; "
            f"EXPLAIN EXECUTE q('{U}', now());")
    before_plan = sql(PLAN.format(pred="($2 IS NULL OR f.played_at >= $2)"))
    after_plan = sql(PLAN.format(pred="f.played_at >= COALESCE($2, '-infinity'::timestamptz)"))
    check('before: the generic plan cannot bound played_at (filter, not index condition)',
          re.search(r'Index Cond: \(user_id = \$1\)\n', before_plan + '\n') is not None and 'played_at >= $2' in before_plan)
    check('after: the generic plan bounds played_at as an index condition',
          re.search(r'Index Cond: \(\(user_id = \$1\) AND \(played_at >= COALESCE', after_plan) is not None)
    before = answers()
    sql(MIG)
    for n in MD5:
        check(f'{n}: authority unchanged', authority(n) == auth[n])
    check('both functions return exactly the predecessor answers for every argument shape', answers() == before)
    check('the shapes include non-empty and boundary samples', any(a.startswith('(30,') for a in before) and len(set(before)) > 6)
    post = {n: md5(n) for n in MD5}
    sql(MIG)
    check('migration replays as a no-op', all(md5(n) == post[n] for n in MD5))
    check('browser roles still cannot execute them',
          sql("SELECT has_function_privilege('anon','public.fn_nit_sample(uuid,uuid,uuid,timestamptz,boolean,integer)','EXECUTE') OR has_function_privilege('authenticated','public.fn_nit_hands_since(uuid,uuid,uuid,timestamptz)','EXECUTE');") == 'f')
    # Drift is refused and nothing changes.
    sql("CREATE OR REPLACE FUNCTION public.fn_nit_hands_since(p_table_id uuid, p_game_id uuid, p_user_id uuid, p_since timestamptz) RETURNS integer LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$ SELECT 0 $function$;")
    drifted = md5('fn_nit_hands_since')
    no, err = refused(MIG)
    check('a drifted body is refused and left untouched', no and 'not the pinned text' in err and md5('fn_nit_hands_since') == drifted)
    print(json.dumps({'passed': True, 'checks': len(checks)}))
finally:
    if started:
        subprocess.run([str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-m', 'immediate', 'stop'], env=env, capture_output=True)
    shutil.rmtree(cluster, ignore_errors=True)
