"""Real PostgreSQL proof for migration 20261118072500 (incident 075013fd).

1. Equivalence: the same resolutions, run against the production preimage
   (AFTER UPDATE OF resolved FOR EACH ROW, md5 41c8d8f0) and against the
   migration (FOR EACH STATEMENT with transition tables), leave identical
   incidents and alerts: versioned and legacy cause groups, a mirror, a
   storm, the drift_incident:* echo cascade, and the cases that must stay
   open (a member of another source, a resolver that is not a member, an
   occurrence count that does not match).
2. Scale: one statement resolving N=5,000 alerts against one incident with
   8,000 members finishes far inside the job's 2 min statement_timeout, and
   resolving the rest closes the incident 'verified_remeasured'.
3. Committed pages: the pager commits each page, so a page that fails keeps
   every page before it.
The preimage is timed on a small N for contrast (FULL_PREIMAGE=1 runs the
full N=5,000 under the production 2 min timeout).
"""
import json, os, pathlib, shutil, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
FX = ROOT / 'scripts/ci/fixtures/an-alert-resolution-reaches-its-incident-once-per-statement'
MIGRATION = ROOT / 'supabase/migrations/20261118072500_an_alert_resolution_reaches_its_incident_once_per_statement.sql'
PG = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
PORT = '55917'
BASE = pathlib.Path(tempfile.mkdtemp(prefix='rollup-'))
SOCK = BASE / 's'
SOCK.mkdir()
checks = []
timings = {}


def command(args, source=None, timeout=600):
    r = subprocess.run(list(map(str, args)), input=source, text=True, capture_output=True,
                       env=dict(os.environ, LC_ALL='C'), timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr + r.stdout)
    return r.stdout.strip()


def sql(db, s, timeout=600):
    return command([PG / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', SOCK, '-p', PORT,
                    '-U', 'postgres', '-d', db], s, timeout)


def timed(db, name, s, timeout=600):
    t = time.monotonic()
    out = sql(db, s, timeout)
    timings[name] = round(time.monotonic() - t, 3)
    return out


def check(db, name, s):
    got = sql(db, 'SELECT (' + s + ')::text')
    assert got == 'true', f'{name}: {got}'
    checks.append(name)


PRE_TRIGGER = ('CREATE TRIGGER zz_ca_alert_resolution_reaches_the_incident AFTER UPDATE OF resolved '
               'ON public.financial_alerts FOR EACH ROW EXECUTE FUNCTION fn_ca_alert_resolution_reaches_the_incident();')


def install(db):
    sql('postgres', f'CREATE DATABASE {db};')
    sql(db, (FX / 'schema.sql').read_text())
    sql(db, (FX / 'helpers.sql').read_text())
    sql(db, """CREATE TRIGGER trg_ca_resolution_needs_a_cause BEFORE UPDATE ON ca_drift_incidents
                 FOR EACH ROW EXECUTE FUNCTION fn_ca_resolution_needs_a_cause();
               CREATE TRIGGER zz_ca_incident_resolution_reaches_the_alerts AFTER UPDATE OF status, closure_basis
                 ON ca_drift_incidents FOR EACH ROW EXECUTE FUNCTION fn_ca_incident_resolution_reaches_the_alerts();""")
    sql(db, (FX / 'preimage-fn_ca_alert_resolution_reaches_the_incident.sql').read_text() + ';\n' + PRE_TRIGGER)
    sql(db, """REVOKE ALL ON FUNCTION fn_ca_alert_resolution_reaches_the_incident() FROM PUBLIC, anon, authenticated;
               GRANT EXECUTE ON FUNCTION fn_ca_alert_resolution_reaches_the_incident() TO postgres, service_role;""")
    cmd = (FX / 'job-354-command.txt').read_text()
    sql(db, "INSERT INTO cron.job(jobid,schedule,command,database,username,active,jobname) VALUES "
            "(354,'4,24,44 * * * *',$cmd$" + cmd + "$cmd$,'postgres','postgres',true,'ca-resolve-settled-alerts-20m');")


# Functional scenarios. Group keys are computed exactly as the raise path does.
SCENARIOS = r"""
CREATE FUNCTION h(p_message text) RETURNS text LANGUAGE sql AS
$$ SELECT md5(fn_ca_normalize_alert_text(left(p_message,200)) || '|' || fn_ca_normalize_alert_text('')) $$;
CREATE FUNCTION u(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT md5(p)::uuid $$;
CREATE FUNCTION member(p_incident text, p_alert text, p_source text, p_kind text DEFAULT 'recurred') RETURNS void LANGUAGE sql AS
$$ INSERT INTO ca_incident_events(incident_id,kind,detail) VALUES
   (u(p_incident),p_kind,jsonb_build_object('source',p_source,'alert_id',u(p_alert)::text,'financial_member_version',1)) $$;

-- G1: versioned cause group of five, with an echo alert and a non-member event.
INSERT INTO financial_alerts(id,severity,source,message) SELECT u('a'||g),'critical','Src.group','post commit pending for hand '||g FROM generate_series(1,5) g;
INSERT INTO ca_drift_incidents(id,source,dedupe_key,occurrences,metadata) VALUES
  (u('G1'),'financial_alerts:Src.group','fa:Src.group:'||h('post commit pending for hand 1'),5,jsonb_build_object('alert_id',u('a5')::text));
SELECT member('G1','a1','financial_alerts:Src.group','created');
SELECT member('G1','a'||g,'financial_alerts:Src.group') FROM generate_series(2,5) g;
INSERT INTO ca_incident_events(incident_id,kind,detail) VALUES (u('G1'),'notify_withheld','{"kind":"raised"}');
INSERT INTO financial_alerts(id,severity,source,message,context) VALUES
  (u('e1'),'critical','drift_incident:financial_alerts:Src.group','echo',jsonb_build_object('incident_id',u('G1')::text));

-- G2: legacy (unversioned) same-transaction set of three.
INSERT INTO financial_alerts(id,severity,source,message,created_at) SELECT u('l'||g),'critical','Src.legacy','legacy finding '||g,'2026-11-01 00:00:00+00' FROM generate_series(1,3) g;
INSERT INTO ca_drift_incidents(id,source,dedupe_key,occurrences) VALUES
  (u('G2'),'financial_alerts:Src.legacy','fa:Src.legacy:'||h('legacy finding 1'),3);
INSERT INTO ca_incident_events(incident_id,at,kind,detail) SELECT u('G2'),'2026-11-01 00:00:00+00','recurred','{"source":"financial_alerts:Src.legacy"}' FROM generate_series(1,3);

-- M1 / M2: plain mirrors; M2's source names another alert source.
INSERT INTO financial_alerts(id,severity,source,message) VALUES (u('b1'),'warning','Src.mirror','mirror one'),(u('b2'),'warning','Src.mirror2','mirror two');
INSERT INTO ca_drift_incidents(id,source,dedupe_key,metadata) VALUES
  (u('M1'),'engine:Src.mirror','mirror:1',jsonb_build_object('alert_id',u('b1')::text)),
  (u('M2'),'financial_alerts:Other','mirror:2',jsonb_build_object('alert_id',u('b2')::text));

-- ST: capped storm of three.
INSERT INTO financial_alerts(id,severity,source,message) SELECT u('c'||g),'critical','Src.storm','storm '||g FROM generate_series(1,3) g;
INSERT INTO ca_drift_incidents(id,source,dedupe_key,occurrences) VALUES (u('ST'),'financial_alerts:Src.storm','storm:financial_alerts:Src.storm',3);
SELECT member('ST','c'||g,'financial_alerts:Src.storm') FROM generate_series(1,3) g;

-- G3: a member whose alert belongs to another source never closes it.
INSERT INTO financial_alerts(id,severity,source,message) VALUES (u('g31'),'critical','Src.bad','bad member'),(u('g32'),'critical','Src.other','bad member');
INSERT INTO ca_drift_incidents(id,source,dedupe_key,occurrences) VALUES (u('G3'),'financial_alerts:Src.bad','fa:Src.bad:'||h('bad member'),2);
SELECT member('G3','g31','financial_alerts:Src.bad','created'); SELECT member('G3','g32','financial_alerts:Src.bad');

-- G4: every member already resolved; the resolver shares the cause but is not a member.
INSERT INTO financial_alerts(id,severity,source,message,resolved) VALUES (u('g41'),'critical','Src.nm','same cause',true),(u('g42'),'critical','Src.nm','same cause',true),(u('d9'),'critical','Src.nm','same cause',false);
INSERT INTO ca_drift_incidents(id,source,dedupe_key,occurrences) VALUES (u('G4'),'financial_alerts:Src.nm','fa:Src.nm:'||h('same cause'),2);
SELECT member('G4','g41','financial_alerts:Src.nm','created'); SELECT member('G4','g42','financial_alerts:Src.nm');

-- G5: membership proof does not match the occurrence count.
INSERT INTO financial_alerts(id,severity,source,message) VALUES (u('g51'),'critical','Src.occ','occ'),(u('g52'),'critical','Src.occ','occ');
INSERT INTO ca_drift_incidents(id,source,dedupe_key,occurrences) VALUES (u('G5'),'financial_alerts:Src.occ','fa:Src.occ:'||h('occ'),3);
SELECT member('G5','g51','financial_alerts:Src.occ','created'); SELECT member('G5','g52','financial_alerts:Src.occ');
"""

STEPS = [
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:00+00', resolution='r12' WHERE id IN (u('a1'),u('a2'));",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:01+00', resolution='r3' WHERE id=u('a3');",
    "UPDATE financial_alerts SET resolution='note only' WHERE id=u('a4');",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:02+00', resolution='r45' WHERE id IN (u('a4'),u('a5'));",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:03+00', resolution='l1' WHERE id=u('l1');",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:04+00', resolution='l23' WHERE id IN (u('l2'),u('l3'));",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:05+00', resolution='fixed at the source' WHERE id IN (u('b1'),u('b2'));",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:06+00', resolution='c12' WHERE id IN (u('c1'),u('c2'));",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:07+00', resolution='c3' WHERE id=u('c3');",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:08+00', resolution='g3' WHERE id IN (u('g31'),u('g32'));",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:09+00', resolution='d9' WHERE id=u('d9');",
    "UPDATE financial_alerts SET resolved=true, resolved_at='2026-11-18 01:10+00', resolution='g5' WHERE id IN (u('g51'),u('g52'));",
    # re-resolving an already-resolved row is not a transition
    "UPDATE financial_alerts SET resolved=true WHERE id=u('a1');",
]

# Which member of a multi-row statement is named as "the final original
# transition" was the row trigger's queue order; it is any member resolved by
# that statement, so the id is normalised.
STATE = r"""
SELECT jsonb_build_object(
 'incidents',(SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'basis',closure_basis,
    'ref',correction_ref,'cause',root_cause,'resolved',resolved_at IS NOT NULL,
    'resolution',regexp_replace(resolution,'transition was [0-9a-f-]{36}','transition was <member>')) ORDER BY id) FROM ca_drift_incidents),
 'alerts',(SELECT jsonb_agg(jsonb_build_object('id',id,'resolved',resolved,
    'resolution',regexp_replace(resolution,'transition was [0-9a-f-]{36}','transition was <member>')) ORDER BY id) FROM financial_alerts),
 'failures',(SELECT count(*) FROM ca_incident_file_failures))
"""


def perf_fixture(db, members, settled, source='LightningHandHost.post_commit_obligations_pending'):
    sql(db, f"""
    INSERT INTO financial_alerts(id,severity,source,message,context,created_at)
      SELECT md5('{source}'||g)::uuid,'critical','{source}','post-commit obligations pending for hand '||g,
             CASE WHEN g<={settled} THEN '{{"settled":"true"}}'::jsonb ELSE '{{}}'::jsonb END,
             '2026-11-17 23:00+00'::timestamptz + g*interval '1 second'
        FROM generate_series(1,{members}) g;
    INSERT INTO ca_drift_incidents(id,source,dedupe_key,occurrences,metadata)
      VALUES (md5('incident:{source}')::uuid,'financial_alerts:{source}',
              'fa:{source}:'||md5(fn_ca_normalize_alert_text('post-commit obligations pending for hand 1')||'|'||fn_ca_normalize_alert_text('')),
              {members},jsonb_build_object('alert_id',md5('{source}1')::uuid::text));
    INSERT INTO ca_incident_events(incident_id,at,kind,detail)
      SELECT md5('incident:{source}')::uuid,'2026-11-17 23:00+00'::timestamptz + g*interval '1 second',
             CASE WHEN g=1 THEN 'created' ELSE 'recurred' END,
             jsonb_build_object('source','financial_alerts:{source}','alert_id',md5('{source}'||g)::uuid::text,'financial_member_version',1)
        FROM generate_series(1,{members}) g;
    INSERT INTO ca_incident_events(incident_id,kind,detail) VALUES (md5('incident:{source}')::uuid,'notify_withheld','{{}}');
    INSERT INTO financial_alerts(severity,source,message,context)
      VALUES ('critical','drift_incident:financial_alerts:{source}','echo',jsonb_build_object('incident_id',md5('incident:{source}')::uuid::text));
    ANALYZE;""")


try:
    command([PG / 'initdb', '-D', BASE / 'db', '-A', 'trust', '-U', 'postgres', '--no-locale'])
    command([PG / 'pg_ctl', '-D', BASE / 'db', '-l', BASE / 'log', '-o',
             f"-k {SOCK} -p {PORT} -c listen_addresses='' -c shared_buffers=128MB -c fsync=off",
             '-w', 'start'])

    # ── 1. preimage, as production runs it ──
    install('pre')
    check('pre', 'preimage-fixture-is-production',
          "md5(pg_get_functiondef('fn_ca_alert_resolution_reaches_the_incident()'::regprocedure))='41c8d8f028e06087ffff5bd89aea8ed2'")
    check('pre', 'incident-to-alert-cascade-fixture-is-production',
          "md5(pg_get_functiondef('fn_ca_incident_resolution_reaches_the_alerts()'::regprocedure))='63475ec2c730b162d09a56bff86dc87f'")
    check('pre', 'resolution-cause-guard-fixture-is-production',
          "md5(pg_get_functiondef('fn_ca_resolution_needs_a_cause()'::regprocedure))='3688cf5d15276cbed2e2cc1cd781b5ac'")
    sql('pre', SCENARIOS)
    for s in STEPS:
        sql('pre', s)
    pre_state = json.loads(sql('pre', STATE))

    # ── 2. the migration, byte for byte, over the same preimage ──
    install('post')
    sql('post', MIGRATION.read_text())
    check('post', 'statement-level-with-transition-tables',
          "(SELECT tgtype::int & 1 = 0 AND tgoldtable='ca_alert_resolution_old' AND tgnewtable='ca_alert_resolution_new' "
          "FROM pg_trigger WHERE tgname='zz_ca_alert_resolution_reaches_the_incident')")
    check('post', 'job-354-calls-the-pager',
          "(SELECT command='CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);' AND schedule='4,24,44 * * * *' AND active FROM cron.job WHERE jobid=354)")
    check('post', 'browser-roles-cannot-execute',
          "NOT has_function_privilege('anon','fn_ca_alert_resolution_reaches_the_incident()','EXECUTE') "
          "AND NOT has_function_privilege('authenticated','sp_ca_resolve_settled_financial_alerts_in_pages(integer,integer)','EXECUTE')")
    sql('post', SCENARIOS)
    for s in STEPS:
        sql('post', s)
    post_state = json.loads(sql('post', STATE))
    assert pre_state == post_state, json.dumps({'pre': pre_state, 'post': post_state}, indent=1)
    checks.append('identical-incidents-and-alerts-to-the-preimage')
    check('post', 'group-closed-verified', "(SELECT status='resolved' AND closure_basis='verified_remeasured' FROM ca_drift_incidents WHERE id=u('G1'))")
    check('post', 'echo-closed-by-cascade', "(SELECT resolved FROM financial_alerts WHERE id=u('e1'))")
    check('post', 'legacy-closed', "(SELECT status='resolved' FROM ca_drift_incidents WHERE id=u('G2'))")
    check('post', 'mirror-closed-other-source-left', "(SELECT status='resolved' FROM ca_drift_incidents WHERE id=u('M1')) AND (SELECT status='open' FROM ca_drift_incidents WHERE id=u('M2'))")
    check('post', 'storm-closed', "(SELECT status='resolved' AND closure_basis='verified_remeasured' FROM ca_drift_incidents WHERE id=u('ST'))")
    check('post', 'unprovable-groups-stay-open', "(SELECT bool_and(status='open') FROM ca_drift_incidents WHERE id IN (u('G3'),u('G4'),u('G5')))")
    check('post', 'no-filed-failures', "(SELECT count(*)=0 FROM ca_incident_file_failures)")

    # ── 3. scale: N=5,000 resolved in one statement, incident of 8,000 members ──
    perf_fixture('post', 8000, 5000)
    timed('post', 'post_5000_of_8000_one_statement',
          "SET statement_timeout='120s'; UPDATE financial_alerts SET resolved=true, resolved_at=now(), resolution='verified: receipt' "
          "WHERE context->>'settled'='true' AND NOT resolved;")
    check('post', 'five-thousand-resolved-incident-open',
          "(SELECT count(*)=5000 FROM financial_alerts WHERE source='LightningHandHost.post_commit_obligations_pending' AND resolved) "
          "AND (SELECT status='open' FROM ca_drift_incidents WHERE source='financial_alerts:LightningHandHost.post_commit_obligations_pending')")
    timed('post', 'post_last_3000_close_incident',
          "SET statement_timeout='120s'; UPDATE financial_alerts SET resolved=true, resolved_at=now(), resolution='verified: receipt' "
          "WHERE source='LightningHandHost.post_commit_obligations_pending' AND NOT resolved;")
    check('post', 'eight-thousand-member-incident-closed-verified',
          "(SELECT status='resolved' AND closure_basis='verified_remeasured' AND resolution LIKE 'Verified all 8000 exact original source alert members resolved%' "
          "FROM ca_drift_incidents WHERE source='financial_alerts:LightningHandHost.post_commit_obligations_pending')")
    check('post', 'eight-thousand-member-echo-closed',
          "(SELECT resolved FROM financial_alerts WHERE source='drift_incident:financial_alerts:LightningHandHost.post_commit_obligations_pending')")
    assert timings['post_5000_of_8000_one_statement'] < 10, timings
    assert timings['post_last_3000_close_incident'] < 10, timings
    checks.append('scale-well-inside-the-2-minute-timeout')

    # One alert resolved on its own against the open 8,000-member incident.
    perf_fixture('post', 8000, 0, 'Src.single')
    timed('post', 'post_single_alert_on_8000_member_incident',
          "UPDATE financial_alerts SET resolved=true, resolved_at=now(), resolution='one' WHERE id=md5('Src.single4000')::uuid;")

    # ── 4. the pager: N=5,000 settled, pages of 500, every page committed ──
    perf_fixture('post', 8000, 5000, 'Src.paged')
    sql('post', "UPDATE financial_alerts SET context=context-'settled' WHERE source<>'Src.paged'; UPDATE closer_calls SET n=0, fail_on_call=NULL; TRUNCATE landed_calls;")
    timed('post', 'pager_5000_in_pages_of_500',
          "SET statement_timeout='120s'; CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);")
    check('post', 'pager-closed-all-settled', "(SELECT count(*)=5000 FROM financial_alerts WHERE source='Src.paged' AND resolved)")
    check('post', 'pager-took-eleven-pages', "(SELECT n=11 FROM closer_calls)")

    perf_fixture('post', 3000, 3000, 'Src.fault')
    sql('post', "UPDATE financial_alerts SET context=context-'settled' WHERE source<>'Src.fault'; UPDATE closer_calls SET n=0, fail_on_call=3;")
    try:
        sql('post', "CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);")
        raise AssertionError('injected page failure did not surface')
    except RuntimeError as e:
        assert 'injected page failure' in str(e), str(e)
    check('post', 'failed-page-keeps-earlier-pages', "(SELECT count(*)=1000 FROM financial_alerts WHERE source='Src.fault' AND resolved)")
    check('post', 'unreachable-resolver-ran-before-the-failed-pager', "(SELECT count(*)=2 FROM landed_calls)")

    # The lock is released on the failure path, in the SAME session (pg_cron
    # aside, a pooled session would otherwise keep it).
    out = sql('post', """\\set ON_ERROR_STOP 0
UPDATE closer_calls SET n=0, fail_on_call=1;
CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);
SELECT 'locks_held=' || count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid();""")
    assert 'locks_held=0' in out, out
    checks.append('lock-released-after-a-failed-page')

    # A statement timeout during a page: earlier pages stay, the lock is
    # released, the run reports the cancellation (57014).
    perf_fixture('post', 2000, 2000, 'Src.slow')
    sql('post', "UPDATE financial_alerts SET context=context-'settled' WHERE source<>'Src.slow'; UPDATE closer_calls SET n=0, fail_on_call=NULL, sleep_on_call=3;")
    out = sql('post', """\\set ON_ERROR_STOP 0
SET statement_timeout='3s';
CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);
RESET statement_timeout;
SELECT 'locks_held=' || count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid();""")
    assert 'locks_held=0' in out, out
    check('post', 'timed-out-page-keeps-earlier-pages', "(SELECT count(*)=1000 FROM financial_alerts WHERE source='Src.slow' AND resolved)")
    sql('post', "UPDATE closer_calls SET sleep_on_call=NULL;")

    # Busy: another session holds the closer lock -> WARNING, nothing runs.
    holder = subprocess.Popen([str(PG / 'psql'), '-XqAt', '-h', str(SOCK), '-p', PORT, '-U', 'postgres', '-d', 'post', '-c',
                               "SELECT pg_advisory_lock(hashtext('ca-resolve-settled-alerts')), pg_sleep(6);"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    r = subprocess.run([str(PG / 'psql'), '-XqAt', '-h', str(SOCK), '-p', PORT, '-U', 'postgres', '-d', 'post', '-c',
                        "CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);"],
                       text=True, capture_output=True, timeout=30)
    holder.wait(timeout=30)
    assert r.returncode == 0 and 'WARNING:  ca-resolve-settled-alerts busy' in r.stderr, r.stderr
    checks.append('busy-is-a-warning')

    # ── 5. contrast: the preimage on the same 8,000-member incident ──
    n = 5000 if os.environ.get('FULL_PREIMAGE') == '1' else 200
    perf_fixture('pre', 8000, n)
    try:
        timed('pre', f'pre_{n}_of_8000_one_statement',
              "SET statement_timeout='120s'; UPDATE financial_alerts SET resolved=true, resolved_at=now(), resolution='verified: receipt' "
              "WHERE context->>'settled'='true' AND NOT resolved;", timeout=200)
    except RuntimeError as e:
        assert 'statement timeout' in str(e), str(e)
        timings[f'pre_{n}_of_8000_one_statement'] = 'cancelled at 120 s statement_timeout'
    print(json.dumps({'passed': len(checks), 'checks': checks, 'seconds': timings}, indent=1))
finally:
    if (BASE / 'db/postmaster.pid').exists():
        command([PG / 'pg_ctl', '-D', BASE / 'db', '-m', 'fast', '-w', 'stop'])
    shutil.rmtree(BASE)
