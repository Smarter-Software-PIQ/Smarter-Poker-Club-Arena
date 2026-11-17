#!/usr/bin/env python3
"""Stuck-tournament notices resolve at their source (20261117173255).

Disposable PostgreSQL 17. Installs the exact captured production preimage of
fn_sp_critical_scan(), proves the defect (a stuck_tournament notice of a
tournament that stopped RUNNING stays 'firing' forever), applies the
migration, and proves: both sp notices of an ended condition move to
'resolved' in place, through the status-change path the Reliability
Controller intake trigger listens on; a notice whose tournament still runs,
a malformed one and other pager rules stay firing; the pass is idempotent;
the migration is a replay no-op and refuses a changed preimage.
"""
import json, os, pathlib, socket, subprocess, tempfile

root = pathlib.Path(__file__).resolve().parents[2]
pg = pathlib.Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
parent = os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')
if not parent:
    raise RuntimeError('Set TMPDIR to owned SSD scratch or provider runner temp')
if os.uname().sysname == 'Darwin' and not parent.startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('Mac fixture storage must be on SmarterWork')
migration = root / 'supabase/migrations/20261117173255_stuck_tournament_pages_resolve_when_the_tournament_stops_running.sql'
preimage = root / 'tests/fixtures/sp-critical-scan-preimage-20261117.sql'

SCHEMA = r'''
CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE operational_alert_events(
  id bigserial PRIMARY KEY, source text, event_key text, alertname text, status text, severity text,
  payload jsonb, investigation_status text DEFAULT 'new', received_at timestamptz DEFAULT clock_timestamp(),
  last_received_at timestamptz DEFAULT clock_timestamp(), delivery_count int DEFAULT 1, UNIQUE(source, event_key));
CREATE FUNCTION fn_record_operational_alert(p_source text, p_event_key text, p_alertname text, p_status text, p_severity text, p_payload jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE v bigint; BEGIN
  INSERT INTO operational_alert_events(source,event_key,alertname,status,severity,payload)
  VALUES(p_source,p_event_key,p_alertname,p_status,p_severity,p_payload)
  ON CONFLICT (source,event_key) DO UPDATE SET delivery_count=operational_alert_events.delivery_count+1
  RETURNING id INTO v; RETURN v; END $$;
-- What the controller's zzz_reliability_intake_update trigger listens on.
CREATE TABLE intake_seen(alert_id bigint, old_status text, new_status text);
CREATE FUNCTION intake_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO intake_seen VALUES (NEW.id, OLD.status, NEW.status); RETURN NULL; END $$;
CREATE TRIGGER zzz_intake_probe AFTER UPDATE OF delivery_count, status ON operational_alert_events
  FOR EACH ROW WHEN (OLD.delivery_count IS DISTINCT FROM NEW.delivery_count OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION intake_probe();
CREATE TABLE sp_critical_pages(id bigserial PRIMARY KEY, dedupe_key text UNIQUE, rule text, title text, detail jsonb,
  alert_event_id bigint, detected_at timestamptz DEFAULT now(), emailed_at timestamptz, sms_at timestamptz, attempts int DEFAULT 0);
CREATE TABLE tournaments(id uuid PRIMARY KEY, tournament_type text, name text, status text, started_at timestamptz, current_players int);
CREATE TABLE ca_ledger_invariant_findings(txid bigint, account_key text, balance_delta numeric, ledger_net numeric, actor_service text, found_at timestamptz);
CREATE TABLE ca_supply_snapshots(id bigint, taken_at timestamptz, unexplained numeric);
CREATE TABLE stripe_webhook_events(event_id text, event_type text, processing_status text, processed_at timestamptz);
CREATE TABLE vip_lifetime_purchases(id uuid, dispute_id text, dispute_status text, price_usd numeric, updated_at timestamptz);
CREATE TABLE wheel_configs(host_id uuid, enabled boolean, exposure_allowance_chips numeric);
CREATE TABLE diamond_game_configs(host_id uuid, enabled boolean, exposure_allowance_chips numeric);
CREATE FUNCTION fn_sp_setting(text, numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT $2 $$;
CREATE FUNCTION fn_diamond_spins_allowance_floor() RETURNS numeric LANGUAGE sql AS $$ SELECT 2500 $$;
CREATE FUNCTION fn_sp_midway_free_buy_watch() RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
'''

A = '0000000a-0000-0000-0000-000000000001'  # stuck: RUNNING 20 h
B = '0000000b-0000-0000-0000-000000000002'  # ended: COMPLETED
C = '0000000c-0000-0000-0000-000000000003'  # young: RUNNING 1 h
D = '0000000d-0000-0000-0000-000000000004'  # deleted after it paged

SEED = f'''
INSERT INTO tournaments VALUES
 ('{A}','MTT','Stuck','RUNNING',now()-interval '20 hours',1),
 ('{B}','MTT','Ended','COMPLETED',now()-interval '20 hours',0),
 ('{C}','MTT','Young','RUNNING',now()-interval '1 hour',9);
-- Earlier passes: B and D were paged while stuck; the digest reported B and D.
SELECT fn_record_operational_alert('sp-critical-pager','stuck:{B}','CriticalPage.stuck_tournament','firing','critical',
  jsonb_build_object('summary','B stuck','detail',jsonb_build_object('tournament_id','{B}','players',1)));
INSERT INTO sp_critical_pages(dedupe_key,rule,title,detail) VALUES ('stuck:{B}','stuck_tournament','B','{{}}');
SELECT fn_record_operational_alert('sp-critical-pager','stuck:{D}','CriticalPage.stuck_tournament','firing','critical',
  jsonb_build_object('detail',jsonb_build_object('tournament_id','{D}')));
INSERT INTO sp_critical_pages(dedupe_key,rule,title,detail) VALUES ('stuck:{D}','stuck_tournament','D','{{}}');
SELECT fn_record_operational_alert('sp-daily-digest','sp-digest:2026-11-16:stuck_tournament:{B}','DailyDigest.stuck_tournament','firing','critical',
  jsonb_build_object('day','2026-11-16','detail',jsonb_build_object('tournament_id','{B}')));
SELECT fn_record_operational_alert('sp-daily-digest','sp-digest:2026-11-16:stuck_tournament:{A}','DailyDigest.stuck_tournament','firing','critical',
  jsonb_build_object('day','2026-11-16','detail',jsonb_build_object('tournament_id','{A}')));
SELECT fn_record_operational_alert('sp-daily-digest','sp-digest:2026-11-16:stuck_tournament:bad','DailyDigest.stuck_tournament','firing','critical',
  jsonb_build_object('day','2026-11-16','detail',jsonb_build_object('tournament_id','not-a-uuid')));
-- A point-in-time page of another rule, and another source's stuck name.
SELECT fn_record_operational_alert('sp-critical-pager','ledger:1:x','CriticalPage.ledger_findings','firing','critical',
  jsonb_build_object('detail',jsonb_build_object('tournament_id','{B}')));
SELECT fn_record_operational_alert('other-source','stuck:{B}','CriticalPage.stuck_tournament','firing','critical',
  jsonb_build_object('detail',jsonb_build_object('tournament_id','{B}')));
'''

with tempfile.TemporaryDirectory(prefix='stuck-notices-', dir=parent) as folder:
    scratch = pathlib.Path(folder)

    def run(tool, *args, input=None, check=True):
        result = subprocess.run([str(pg / tool), *args], input=input, text=True, capture_output=True, timeout=90)
        if check and result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        return result

    run('initdb', '-D', str(scratch / 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8')
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1', 0)); port = str(reserve.getsockname()[1])
    run('pg_ctl', '-D', str(scratch / 'data'), '-l', str(scratch / 'server.log'),
        '-o', f'-k {parent} -p {port} -h 127.0.0.1', 'start')
    try:
        def sql(source, check=True):
            return run('psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
                       '-h', '127.0.0.1', '-p', port, '-d', 'postgres', input=source, check=check)

        def statuses():
            out = sql("SELECT jsonb_object_agg(source||'|'||event_key, status) FROM operational_alert_events;").stdout
            return json.loads(out)

        def scan():
            return json.loads(sql('SELECT public.fn_sp_critical_scan();').stdout)

        sql('SET search_path TO public;\n' + SCHEMA)
        sql(preimage.read_text())
        assert sql("SELECT md5(pg_get_functiondef('public.fn_sp_critical_scan()'::regprocedure));").stdout.strip() \
            == 'ef4c2c3dfdcba816c46a1e360c71a3d1', 'fixture is not the captured production preimage'
        sql("REVOKE ALL ON FUNCTION public.fn_sp_critical_scan() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.fn_sp_critical_scan() TO service_role;")
        acl_before = sql("SELECT proacl::text||'|'||prosecdef||'|'||coalesce(proconfig::text,'') FROM pg_proc WHERE proname='fn_sp_critical_scan';").stdout
        sql(SEED)

        # THE DEFECT: the preimage pages A and never closes B or D.
        before = scan()
        s = statuses()
        assert 'resolved' not in before
        assert s[f'sp-critical-pager|stuck:{A}'] == 'firing'
        assert s[f'sp-critical-pager|stuck:{B}'] == 'firing', 'preimage must show the defect'
        assert s[f'sp-daily-digest|sp-digest:2026-11-16:stuck_tournament:{B}'] == 'firing'

        sql(migration.read_text())
        assert acl_before == sql("SELECT proacl::text||'|'||prosecdef||'|'||coalesce(proconfig::text,'') FROM pg_proc WHERE proname='fn_sp_critical_scan';").stdout
        sql("DELETE FROM intake_seen;")

        first = scan()
        s = statuses()
        assert first['resolved'] == 3, first           # B page, B digest, D page
        assert s[f'sp-critical-pager|stuck:{B}'] == 'resolved'
        assert s[f'sp-daily-digest|sp-digest:2026-11-16:stuck_tournament:{B}'] == 'resolved'
        assert s[f'sp-critical-pager|stuck:{D}'] == 'resolved'
        assert s[f'sp-critical-pager|stuck:{A}'] == 'firing', 'a tournament still RUNNING keeps its page'
        assert s[f'sp-daily-digest|sp-digest:2026-11-16:stuck_tournament:{A}'] == 'firing'
        assert s['sp-daily-digest|sp-digest:2026-11-16:stuck_tournament:bad'] == 'firing', 'malformed id is never guessed'
        assert s['sp-critical-pager|ledger:1:x'] == 'firing', 'other pager rules are point-in-time findings'
        assert s[f'other-source|stuck:{B}'] == 'firing', 'only the two sp sources are this producer'
        notes = json.loads(sql(f"SELECT jsonb_object_agg(event_key, payload->>'resolution') FROM operational_alert_events WHERE status='resolved';").stdout)
        assert notes[f'stuck:{B}'] == 'the tournament is COMPLETED, no longer RUNNING'
        assert notes[f'stuck:{D}'] == 'the tournament no longer exists'
        seen = json.loads(sql("SELECT jsonb_agg(jsonb_build_array(old_status,new_status)) FROM intake_seen;").stdout)
        assert seen == [['firing', 'resolved']] * 3, 'each resolution reaches the intake status-change path once'
        assert first['new'] == 0

        # Idempotent: nothing more to resolve, nothing re-sent.
        sql("DELETE FROM intake_seen;")
        assert scan()['resolved'] == 0
        assert sql("SELECT count(*) FROM intake_seen;").stdout.strip() == '0'

        # The condition ends for A: both of its notices close on the next pass.
        sql(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{A}';")
        assert scan()['resolved'] == 2
        s = statuses()
        assert s[f'sp-critical-pager|stuck:{A}'] == 'resolved'
        assert s[f'sp-daily-digest|sp-digest:2026-11-16:stuck_tournament:{A}'] == 'resolved'

        # Replay is a no-op; a changed preimage is refused.
        post = sql("SELECT md5(pg_get_functiondef('public.fn_sp_critical_scan()'::regprocedure));").stdout
        sql(migration.read_text())
        assert post == sql("SELECT md5(pg_get_functiondef('public.fn_sp_critical_scan()'::regprocedure));").stdout
        sql(preimage.read_text().replace("v_new int := 0;", "v_new int := 0; v_other int;"))
        refused = sql(migration.read_text(), check=False)
        assert refused.returncode != 0 and 'SP_CRITICAL_SCAN_PREIMAGE_CHANGED' in refused.stderr, refused.stderr
        print('PASS: preimage defect shown; ended page+digest notices resolve in place via the intake status path; '
              'running/malformed/other-rule/other-source stay firing; idempotent; ACL kept; replay no-op; changed preimage refused')
    finally:
        run('pg_ctl', '-D', str(scratch / 'data'), '-m', 'immediate', 'stop')
