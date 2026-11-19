"""Real PostgreSQL regression: a post-commit handoff pages on harm, not on handoff.

Incident ee77584d (2026-11-11). 20261110234927 gave fn_post_commit_handoff_is_a_warning()
a Lightning branch, but trigger a2_post_commit_handoff_is_a_warning (20261105174016)
admitted only the ServerTableEngine source, so every Lightning predecessor handoff
kept paging critical. 20261111133739 widens the WHEN clause.

Built from the migration files themselves, never from copies: the trigger preimage is
the 20261105174016 statement, the function is the 20261110234927 body, the candidate
is the whole 20261111133739 file. Proves, on PostgreSQL 17:
  * preimage: a Lightning handoff with a durable envelope stays critical (the defect);
  * candidate: that row becomes a warning, while a statement timeout, a handoff with
    NO durable envelope, a malformed hand id, the stranded-envelope watchdog's own row
    and an unrelated source all stay critical, and the ServerTableEngine owner-change
    handoff keeps its warning;
  * the install refuses while post-commit-stranded-watchdog-5m is inactive, and
    refuses if the Lightning branch of the function is missing.
"""
import os, pathlib, re, shutil, subprocess, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase' / 'migrations'
PG = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
BASE = pathlib.Path(tempfile.mkdtemp(prefix='pch-')); SOCK = BASE / 's'; SOCK.mkdir()
CMD = [str(PG / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', str(SOCK), '-p', '55883', '-U', 'postgres']
checks = []

def command(args, source=None):
    r = subprocess.run(list(map(str, args)), input=source, text=True, capture_output=True,
                       env=dict(os.environ, LC_ALL='C'), timeout=60)
    if r.returncode:
        raise RuntimeError(r.stderr + r.stdout)
    return r.stdout.strip()

def sql(s): return command(CMD, s)

def refuses(name, s, reason):
    try:
        sql(s)
    except RuntimeError as e:
        assert reason in str(e), str(e)
        checks.append(name); return
    raise AssertionError(name + ' unexpectedly succeeded')

LIGHT = 'LightningHandHost.post_commit_obligations_pending'
TABLE = 'ServerTableEngine.post_commit_obligations_pending'
PENDING = 'post-commit obligations refused (predecessor_pending)'
TIMEOUT = 'post-commit obligations RPC failed: canceling statement due to statement timeout (57014)'
DURABLE = '11111111-1111-1111-1111-111111111111'
NO_ENVELOPE = '22222222-2222-2222-2222-222222222222'
CASES = [
    # name, source, error, hand_id, expected severity after the fix, expected before
    ('lightning-handoff-with-durable-envelope', LIGHT, PENDING, DURABLE, 'warning', 'critical'),
    ('lightning-timeout-is-unknown-outcome', LIGHT, TIMEOUT, DURABLE, 'critical', 'critical'),
    ('lightning-handoff-without-envelope', LIGHT, PENDING, NO_ENVELOPE, 'critical', 'critical'),
    ('lightning-handoff-malformed-hand', LIGHT, PENDING, 'not-a-uuid', 'critical', 'critical'),
    ('stranded-watchdog-still-pages', 'fn_post_commit_stranded_watchdog', PENDING, DURABLE, 'critical', 'critical'),
    ('unrelated-source-untouched', 'some.other.source', PENDING, DURABLE, 'critical', 'critical'),
    ('table-engine-owner-change-handoff', TABLE, 'f06_owner_changed', None, 'warning', 'warning'),
]

def insert_cases():
    sql('TRUNCATE public.financial_alerts')
    for name, source, err, hand, _, _ in CASES:
        ctx = {'error': err, 'case': name}
        if hand: ctx['hand_id'] = hand
        import json
        sql("INSERT INTO public.financial_alerts(severity,source,context) VALUES('critical',%s,%s::jsonb)" % (
            "'" + source.replace("'", "''") + "'", "'" + json.dumps(ctx).replace("'", "''") + "'"))

def assert_severities(column):
    for name, *_rest in CASES:
        want = dict(after=_rest[3], before=_rest[4])[column]
        got = sql("SELECT severity FROM public.financial_alerts WHERE context->>'case'='%s'" % name)
        assert got == want, '%s/%s: expected %s, got %s' % (column, name, want, got)
        checks.append(column + ':' + name + '=' + want)

def section(text, start, end_marker):
    i = text.index(start)
    j = text.index(end_marker, i) + len(end_marker)
    return text[i:j]

try:
    command([PG / 'initdb', '-D', BASE / 'db', '-A', 'trust', '-U', 'postgres', '--no-locale'])
    command([PG / 'pg_ctl', '-D', BASE / 'db', '-l', BASE / 'log', '-o',
             f"-k {SOCK} -p 55883 -c listen_addresses='' -c shared_buffers=16MB", '-w', 'start'])
    sql("""CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text, active boolean);
    INSERT INTO cron.job VALUES ('post-commit-stranded-watchdog-5m', true);
    CREATE TABLE public.financial_alerts(id bigserial PRIMARY KEY, severity text, source text, context jsonb);
    CREATE TABLE public.hand_atomic_commits(hand_id uuid PRIMARY KEY, post_commit_payload jsonb);
    INSERT INTO public.hand_atomic_commits VALUES ('%s','{"envelope":true}'), ('%s', NULL);""" % (DURABLE, NO_ENVELOPE))

    fn_src = (MIG / '20261110234927_the_lightning_handoff_warning_needs_a_successor.sql').read_text()
    fn = section(fn_src, 'CREATE OR REPLACE FUNCTION public.fn_post_commit_handoff_is_a_warning()', 'end $function$;')
    trg_src = (MIG / '20261105174016_post_commit_alert_pages_on_harm_not_handoff.sql').read_text()
    trg = section(trg_src, 'create trigger a2_post_commit_handoff_is_a_warning', 'execute function public.fn_post_commit_handoff_is_a_warning();')
    candidate = (MIG / '20261111133739_the_lightning_handoff_trigger_reaches_its_lightning_branch.sql').read_text()

    # The install refuses before the Lightning branch exists.
    sql("CREATE FUNCTION public.fn_post_commit_handoff_is_a_warning() RETURNS trigger LANGUAGE plpgsql AS $$ begin return new; end $$;")
    refuses('refuses-without-lightning-branch', candidate, 'POST_COMMIT_HANDOFF_PREIMAGE_CHANGED')

    sql(fn); sql(trg)
    insert_cases(); assert_severities('before')

    sql("UPDATE cron.job SET active=false")
    refuses('refuses-while-stranded-watchdog-inactive', candidate, 'POST_COMMIT_STRANDED_WATCHDOG_NOT_ACTIVE')
    sql("UPDATE cron.job SET active=true")

    sql(candidate)
    insert_cases(); assert_severities('after')
    reclassified = sql("SELECT count(*) FROM public.financial_alerts WHERE context ? 'reclassified' AND source='%s'" % LIGHT)
    assert reclassified == '1', reclassified
    checks.append('only-the-durable-lightning-handoff-is-reclassified')
    # Run the real original watchdog and successor against its existing open alert.
    sql("""TRUNCATE public.financial_alerts, public.hand_atomic_commits;
        ALTER TABLE public.hand_atomic_commits ADD table_id uuid, ADD hand_number bigint,
          ADD committed_at timestamptz, ADD post_commit_completed_at timestamptz;
        CREATE INDEX pending_receipts ON public.hand_atomic_commits(table_id,hand_number)
          WHERE post_commit_payload IS NOT NULL AND post_commit_completed_at IS NULL;
        CREATE TABLE public.lightning_hand(hand_history_id uuid UNIQUE);
        ALTER TABLE public.financial_alerts ADD message text, ADD created_at timestamptz DEFAULT now(),
          ADD resolved boolean NOT NULL DEFAULT false, ADD resolved_at timestamptz, ADD resolution text;
        ALTER TABLE cron.job ADD jobid bigint DEFAULT 552, ADD schedule text DEFAULT '*/5 * * * *',
          ADD command text DEFAULT 'select public.fn_post_commit_stranded_watchdog()';
        CREATE FUNCTION cron.alter_job(job_id bigint, schedule text) RETURNS void LANGUAGE sql AS
          'UPDATE cron.job SET schedule=$2 WHERE jobid=$1';""")
    old_watchdog = section(trg_src, 'create or replace function public.fn_post_commit_stranded_watchdog()', 'end $f$;')
    sql(old_watchdog)
    sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;")
    sql("REVOKE ALL ON FUNCTION public.fn_post_commit_stranded_watchdog() FROM PUBLIC, anon, authenticated; "
        "GRANT EXECUTE ON FUNCTION public.fn_post_commit_stranded_watchdog() TO service_role;")
    watchdog = "SELECT public.fn_post_commit_stranded_watchdog()"
    signature = "'public.fn_post_commit_stranded_watchdog()'::regprocedure"
    settings = sql(f"SELECT proowner,proacl,proconfig,prosecdef FROM pg_proc WHERE oid={signature}")
    sql("""INSERT INTO public.hand_atomic_commits(hand_id,table_id,hand_number,committed_at,post_commit_payload)
        VALUES ('00000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',1,now()-interval '13 minutes','{}'),
               ('00000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000',2,now()-interval '35 seconds','{"pending_addons":{}}');
        INSERT INTO public.lightning_hand VALUES ('00000000-0000-0000-0000-000000000002')""")
    import json
    assert json.loads(sql(watchdog))['stranded'] == 1
    sql("UPDATE hand_atomic_commits SET post_commit_completed_at=now() WHERE hand_number=1")
    assert json.loads(sql(watchdog))['stranded'] == 0
    # Start another genuine ten-minute incident, then introduce newer cash work.
    sql("UPDATE hand_atomic_commits SET committed_at=now()-interval '12 minutes' WHERE hand_number=2")
    assert json.loads(sql(watchdog))['stranded'] == 1
    active_id = sql("SELECT id FROM financial_alerts WHERE NOT resolved")
    sql("""INSERT INTO hand_atomic_commits(hand_id,table_id,hand_number,committed_at,post_commit_payload)
        SELECT md5(n::text)::uuid,'aaaaaaaa-0000-0000-0000-000000000000'::uuid,n,
               now()-interval '45 seconds', '{"pending_addons":{}}'::jsonb FROM generate_series(3,15)n;
        INSERT INTO hand_atomic_commits(hand_id,hand_number,committed_at,post_commit_payload)
        VALUES (md5('tournament')::uuid,16,now()-interval '9 minutes','{"pending_addons":null}'),
               (md5('young')::uuid,17,now()-interval '1 second','{"pending_addons":{}}'),
               (md5('archive')::uuid,18,now()-interval '1 hour',NULL);
        INSERT INTO financial_alerts(severity,source,context)
        VALUES ('critical','fn_post_commit_stranded_watchdog','{"finding":"separate_case"}');""")
    assert json.loads(sql(watchdog))['stranded'] == 1
    assert sql(f"SELECT context->>'stranded' FROM financial_alerts WHERE id={active_id}") == '1'
    current = (MIG / '20261118013305_cash_settlement_alert_tracks_the_oldest_pending_receipt.sql').read_text()
    sql(current)
    fingerprint = sql(f"SELECT md5(pg_get_functiondef({signature}))")
    assert fingerprint == '03e6c9ebf4d1f86b58e90f923cbe5fc8', fingerprint
    assert fingerprint in current.splitlines()[3]
    assert sql(f"SELECT has_function_privilege('authenticated',{signature},'EXECUTE') OR "
               f"has_function_privilege('anon',{signature},'EXECUTE')") == 'f'
    assert sql(f"SELECT has_function_privilege('service_role',{signature},'EXECUTE')") == 't'
    print('receipt watchdog postimage:', fingerprint)
    assert sql(f"SELECT proowner,proacl,proconfig,prosecdef FROM pg_proc WHERE oid={signature}") == settings
    assert sql("SELECT count(*) FROM cron.job WHERE active AND schedule='* * * * *'") == '1'
    result = json.loads(sql(watchdog))
    assert result['stranded'] == 14 and len(result['sample']) == 10
    assert result['oldest_cash']['mode'] == 'lightning' and result['oldest_cash']['hand_number'] == 2
    assert result['sample'][0]['hand_id'] == result['oldest_cash']['hand_id']
    assert sql(f"SELECT context->>'stranded' FROM financial_alerts WHERE id={active_id}") == '14'
    revision = sql(f"SELECT xmin FROM financial_alerts WHERE id={active_id}")
    assert json.loads(sql(watchdog)) == result
    assert sql(f"SELECT xmin FROM financial_alerts WHERE id={active_id}") == revision
    sql("UPDATE hand_atomic_commits SET post_commit_completed_at=now() WHERE hand_number=2")
    assert json.loads(sql(watchdog))['oldest_cash']['mode'] == 'cash'
    sql("UPDATE hand_atomic_commits SET post_commit_completed_at=now() WHERE hand_number BETWEEN 3 AND 15")
    assert json.loads(sql(watchdog))['stranded'] == 0
    assert sql(f"SELECT resolved FROM financial_alerts WHERE id={active_id}") == 't'
    assert sql("SELECT resolved FROM financial_alerts WHERE context->>'finding'='separate_case'") == 'f'
    sql("UPDATE hand_atomic_commits SET committed_at=now()-interval '11 minutes' WHERE hand_number=16")
    legacy = json.loads(sql(watchdog))
    assert legacy['stranded'] == 1 and legacy['oldest_cash'] is None and legacy['sample'][0]['hand_number'] == 16
    checks.append('original-id-count-age-sample-cash-lightning-and-legacy-tournament-watchdog')
    print('post-commit handoff classification: %d checks passed' % len(checks))
    for c in checks: print('  ok ' + c)
finally:
    subprocess.run([str(PG / 'pg_ctl'), '-D', str(BASE / 'db'), '-m', 'fast', 'stop'], capture_output=True)
    shutil.rmtree(BASE, ignore_errors=True)
