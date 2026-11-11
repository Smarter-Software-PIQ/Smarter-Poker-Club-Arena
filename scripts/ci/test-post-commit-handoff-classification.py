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
    print('post-commit handoff classification: %d checks passed' % len(checks))
    for c in checks: print('  ok ' + c)
finally:
    subprocess.run([str(PG / 'pg_ctl'), '-D', str(BASE / 'db'), '-m', 'fast', 'stop'], capture_output=True)
    shutil.rmtree(BASE, ignore_errors=True)
