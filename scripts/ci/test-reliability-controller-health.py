#!/usr/bin/env python3
"""Native proof for 20261110045731_reliability_controller_health_function_and_seed_corrections.

Runs the exact migration against a throwaway PostgreSQL 17 cluster (never
production), over the Stage B fixture and the Stage B migration it requires
(20261110000020). It proves:

  * installed ahead of Stage B it raises, names what is missing and changes
    nothing;
  * public.fn_reliability_controller_health() returns exactly one row: a NULL
    heartbeat before the first tick, a fresh one after it, and counts that
    follow the outbox and the rejection table (queued only, failed and
    rejected in the last 24 hours only);
  * anon, authenticated and PUBLIC cannot execute it and service_role can;
  * the four ReliabilityController* alerts classify as monitoring_self and
    open no incident and no notification, firing or resolved;
  * InstallQueue* opens nothing, the unknown families are unclassified
    incidents, and both stuck_tournament names are tournament_lifecycle;
  * an incident opened before the corrections keeps its class;
  * a second install succeeds and changes no row.

Stage B's files are read from this checkout. Before Stage B has merged, point
RELIABILITY_STAGE_B_ROOT at a checkout that has them; nothing is skipped when
they are absent, the run fails.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGE_B_ROOT = Path(os.environ.get('RELIABILITY_STAGE_B_ROOT') or ROOT)
MIGRATION = ROOT / 'supabase/migrations/20261110045731_reliability_controller_health_function_and_seed_corrections.sql'
STAGE_B = STAGE_B_ROOT / 'supabase/migrations/20261110000020_reliability_controller_stage_b.sql'
FIXTURE = STAGE_B_ROOT / 'scripts/ci/fixtures/reliability-controller-production-objects.sql'
HEALTH = 'public.fn_reliability_controller_health()'
OWN_ALERTS = {
    'ReliabilityControllerStale': 'critical',
    'ReliabilityControllerMetricsAbsent': 'critical',
    'ReliabilityControllerOutboxStuck': 'warning',
    'ReliabilityControllerIntakeRejections': 'warning',
}


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


def main():
    for required in (MIGRATION, STAGE_B, FIXTURE):
        if not required.exists():
            raise SystemExit(f'{required} is required and is missing (Stage B must be in this checkout, or set RELIABILITY_STAGE_B_ROOT)')
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='reliability-health-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir='/tmp'))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    port = str(50000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses=''",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    passed = []
    try:
        def psql(args, text=None):
            return subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                                   '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', *args],
                                  input=text, capture_output=True, text=True)

        def sql(text):
            r = psql(['-c', text])
            assert r.returncode == 0, f'{text}\n{r.stderr}'
            return r.stdout.strip()

        def refused(text, needle):
            r = psql(['-c', text])
            assert r.returncode != 0 and needle in r.stderr, f'{text}\nexpected "{needle}", got: {r.stdout} {r.stderr}'

        def ok(name):
            passed.append(name)
            print(f'ok - {name}')

        def num(text):
            return int(sql(text))

        def record(source, key, alertname, status, severity, payload):
            return int(sql("SELECT public.fn_record_operational_alert($a$%s$a$, $a$%s$a$, $a$%s$a$, '%s', '%s', $a$%s$a$::jsonb)"
                           % (source, key, alertname, status, severity, json.dumps(payload))))

        def am(key, alertname, status, severity, starts):
            alert = {'status': status, 'fingerprint': 'fp-' + alertname,
                     'labels': {'alertname': alertname, 'severity': severity, 'component': 'reliability-controller'},
                     'annotations': {'summary': f'{alertname} summary'},
                     'startsAt': starts, 'endsAt': '0001-01-01T00:00:00Z' if status == 'firing' else starts}
            return record('alertmanager', key, alertname, status, severity, {'alert': alert, 'receiver': 'codex-inbox'})

        def incidents(alertname=None):
            where = f"WHERE alertname = $a${alertname}$a$" if alertname else ''
            return num(f'SELECT count(*) FROM smarter_private.reliability_incidents {where}')

        def health(role=None):
            rows = json.loads(sql((f'SET ROLE {role}; ' if role else '') + f"SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) FROM {HEALTH} h"))
            assert len(rows) == 1, rows
            return rows[0]

        def classes_hash():
            return sql("SELECT md5(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id)) FROM smarter_private.reliability_alert_classes c")

        def state_hash():
            return hashlib.md5('|'.join(sql(f"SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text)), '') FROM smarter_private.{name} t")
                                        for name in ('reliability_incidents', 'reliability_observations', 'reliability_alert_members',
                                                     'reliability_incident_events', 'reliability_notifications', 'reliability_settings')).encode()).hexdigest()

        def classify(source, alertname, severity='warning'):
            return sql("SELECT c.incident_class || ' ' || c.is_incident::text || ' ' || c.escalate_immediately::text "
                       f"FROM smarter_private.reliability_classify($a${source}$a$, $a${alertname}$a$, '{severity}', false) c")

        r = psql(['-f', str(FIXTURE)])
        assert r.returncode == 0, r.stderr

        # ---- ahead of Stage B: refused, named, nothing changed.
        r = psql(['-f', str(MIGRATION)])
        assert r.returncode != 0 and 'Stage B (migration 20261110000020) is not installed' in r.stderr and 'Nothing was changed' in r.stderr, r.stderr
        assert 'smarter_private.reliability_heartbeat' in r.stderr, r.stderr
        assert sql(f"SELECT to_regprocedure('{HEALTH}') IS NULL") == 't'
        ok('installed ahead of Stage B it raises, names the missing objects and creates nothing')

        r = psql(['-f', str(STAGE_B)])
        assert r.returncode == 0, r.stderr

        # ---- what Stage B alone does with these names, and an incident that predates the corrections.
        starts = sql("SELECT to_char((clock_timestamp() - interval '10 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
        assert classify('install-queue', 'InstallQueueJobFailed') == 'unclassified true false'
        assert classify('mac-studio-git-maintenance', 'Git Maintenance Not Keeping Up') == 'development_notification false false'
        assert classify('alertmanager', 'ReliabilityControllerStale', 'critical') == 'unclassified true true'
        record('install-queue', 'failed:before', 'InstallQueueJobFailed', 'firing', 'warning', {'pr': 1, 'host': 'ops-mac'})
        assert incidents('InstallQueueJobFailed') == 1
        before_incident = sql("SELECT to_jsonb(i)::text FROM smarter_private.reliability_incidents i WHERE alertname = 'InstallQueueJobFailed'")
        before_state = state_hash()

        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
        assert state_hash() == before_state
        assert sql("SELECT to_jsonb(i)::text FROM smarter_private.reliability_incidents i WHERE alertname = 'InstallQueueJobFailed'") == before_incident
        assert sql("SELECT incident_class FROM smarter_private.reliability_incidents WHERE alertname = 'InstallQueueJobFailed'") == 'unclassified'
        ok('the exact migration installs after Stage B, its live proof holds, and no incident, observation, member, event, notification or setting changed')

        # ---- the function: one row, NULL before the first tick, sane after it.
        never = health()
        assert never['heartbeat_at_unix'] is None and never['heartbeat_age_seconds'] is None, never
        assert never['mutation_paused'] is True and never['notify_mode'] == 'observe', never
        assert sorted(never) == ['heartbeat_age_seconds', 'heartbeat_at_unix', 'intake_rejections_24h', 'mutation_paused',
                                 'notifications_failed_24h', 'notifications_queued', 'notify_mode'], never
        ok('before the first tick the heartbeat is NULL, never zero')

        errors = json.loads(sql('SELECT smarter_private.reliability_tick()'))['errors']
        assert errors == [], errors
        ticked = health()
        assert 0 <= ticked['heartbeat_age_seconds'] < 30, ticked
        assert abs(ticked['heartbeat_at_unix'] - time.time()) < 30, ticked
        assert abs(ticked['heartbeat_at_unix'] - float(sql('SELECT extract(epoch FROM tick_at) FROM smarter_private.reliability_heartbeat'))) < 0.001
        base = (ticked['notifications_queued'], ticked['notifications_failed_24h'], ticked['intake_rejections_24h'])
        assert base == (0, 0, 0), ticked
        sql("UPDATE smarter_private.reliability_heartbeat SET tick_at = clock_timestamp() - interval '400 seconds' WHERE id")
        assert 399 <= health()['heartbeat_age_seconds'] < 430
        sql("UPDATE smarter_private.reliability_heartbeat SET tick_at = clock_timestamp() + interval '5 seconds' WHERE id")
        assert health()['heartbeat_age_seconds'] == 0, 'a heartbeat ahead of the reader clamps to 0, never negative'
        sql('SELECT smarter_private.reliability_tick()')
        ok('after a tick it returns one row with a fresh heartbeat, the heartbeat time as written, and an age that follows the table')

        note = ("INSERT INTO smarter_private.reliability_notifications (seq, kind, request_id, body, state, created_at) "
                "VALUES (%d, 'validation', gen_random_uuid(), 'x', '%s', clock_timestamp() - interval '%s')")
        sql(note % (1, 'queued', '0 hours'))
        sql(note % (2, 'queued', '30 hours'))
        sql(note % (3, 'rate_limited', '0 hours'))
        sql(note % (4, 'failed', '1 hour'))
        sql(note % (5, 'failed', '25 hours'))
        sql(note % (6, 'suppressed_observe', '0 hours'))
        sql("INSERT INTO smarter_private.reliability_intake_rejections (reason, at) VALUES ('x', clock_timestamp()), ('x', clock_timestamp() - interval '23 hours'), ('x', clock_timestamp() - interval '25 hours')")
        counted = health()
        assert (counted['notifications_queued'], counted['notifications_failed_24h'], counted['intake_rejections_24h']) == (2, 1, 2), counted
        sql("UPDATE smarter_private.reliability_settings SET mutation_paused = false, notify_mode = 'critical_only' WHERE id")
        changed = health()
        assert changed['mutation_paused'] is False and changed['notify_mode'] == 'critical_only', changed
        sql("UPDATE smarter_private.reliability_settings SET mutation_paused = true, notify_mode = 'observe' WHERE id")
        sql('DELETE FROM smarter_private.reliability_notifications WHERE incident_id IS NULL')
        sql('DELETE FROM smarter_private.reliability_intake_rejections')
        ok('queued counts state queued of any age and not rate_limited, failed and rejections count the last 24 hours only, and the settings are read as stored')

        # ---- access.
        for role in ('anon', 'authenticated'):
            refused(f'SET ROLE {role}; SELECT * FROM {HEALTH}', 'permission denied for function fn_reliability_controller_health')
            assert sql(f"SELECT has_function_privilege('{role}', '{HEALTH}', 'EXECUTE')") == 'f'
        assert sql(f"SELECT has_function_privilege('public', '{HEALTH}', 'EXECUTE')") == 'f'
        sql('CREATE ROLE reliability_health_stranger NOLOGIN')
        refused(f'SET ROLE reliability_health_stranger; SELECT * FROM {HEALTH}', 'permission denied')
        served = health('service_role')
        assert served['notify_mode'] == 'observe' and served['heartbeat_age_seconds'] < 30, served
        assert sql(f"SELECT p.prosecdef::text || ' ' || p.provolatile::text || ' ' || array_to_string(p.proconfig, ';') FROM pg_proc p WHERE p.oid = '{HEALTH}'::regprocedure") \
            == 'true s search_path=pg_catalog, smarter_private'
        ok('anon, authenticated and any other role are refused; service_role reads it; it is a stable definer with a fixed search_path')

        # ---- the controller's own alerts: monitoring_self, never an incident, never a notification.
        # The incident that predates the corrections escalates on its own clock; let it, then take the baseline.
        sql("SELECT smarter_private.reliability_tick(clock_timestamp() + interval '50 minutes')")
        notifications = num('SELECT count(*) FROM smarter_private.reliability_notifications')
        open_before = incidents()
        for name, severity in OWN_ALERTS.items():
            assert classify('alertmanager', name, severity) == 'monitoring_self false false', name
            am(f'own-{name}-firing', name, 'firing', severity, starts)
            am(f'own-{name}-firing', name, 'firing', severity, starts)
        sql('SELECT smarter_private.reliability_tick()')
        sql("SELECT smarter_private.reliability_tick(clock_timestamp() + interval '45 minutes')")
        for name, severity in OWN_ALERTS.items():
            am(f'own-{name}-resolved', name, 'resolved', severity, starts)
        sql("SELECT smarter_private.reliability_tick(clock_timestamp() + interval '50 minutes')")
        sql('SELECT smarter_private.reliability_tick()')
        for name in OWN_ALERTS:
            assert incidents(name) == 0, name
        assert incidents() == open_before
        assert num('SELECT count(*) FROM smarter_private.reliability_notifications') == notifications
        assert num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE body ILIKE '%ReliabilityController%'") == 0
        assert num("SELECT count(*) FROM public.operational_alert_events WHERE alertname LIKE 'ReliabilityController%'") == 8
        assert num('SELECT count(*) FROM smarter_private.reliability_intake_rejections') == 0
        ok('the four controller alerts are kept in the inbox and open no incident and no notification, firing, redelivered, aged 45 minutes or resolved')

        # ---- the corrections, as intake answers them.
        record('install-queue', 'failed:after', 'InstallQueueJobFailed', 'firing', 'warning', {'pr': 2, 'host': 'ops-mac'})
        record('install-queue', 'queue-down:ops-mac:1', 'InstallQueueServiceDown', 'firing', 'critical', {'host': 'ops-mac'})
        assert incidents('InstallQueueServiceDown') == 0
        assert sql("SELECT occurrence_count::text || ' ' || incident_class FROM smarter_private.reliability_incidents WHERE alertname = 'InstallQueueJobFailed'") == '1 unclassified', \
            'the incident that predates the correction is neither fed nor reclassified'
        assert classify('install-queue', 'InstallQueueJobFailed') == 'development_notification false false'
        unknown = [('engine-alerts-backfill', 'OpenClawJobStale'), ('workers.deploy-error-poll', 'VercelDeploymentFailed'),
                   ('workers.deploy-error-poll', 'DeploymentMonitorUnavailable'), ('mac-studio-git-maintenance', 'Git Maintenance Not Keeping Up'),
                   ('financial-alerts-backfill', 'union_promo_duplicate_2026_11_07'), ('midway-weekly-payout-followup', 'engine_release_stall_check_uuid_into_bigint')]
        for source, name in unknown:
            assert classify(source, name) == 'unclassified true false', (source, name)
        assert classify('worldhub.deploy-monitor', 'VercelDeploymentFailed') == 'unclassified true false', 'the other source of this name is left as Stage B seeded it'
        record('mac-studio-git-maintenance', 'pack-backlog:/repo:1', 'Git Maintenance Not Keeping Up', 'firing', 'warning', {'host': 'mac-studio', 'repo': '/repo'})
        record('workers.deploy-error-poll', 'deploy-1', 'VercelDeploymentFailed', 'firing', 'warning', {'deploymentId': 'dpl_1'})
        assert sql("SELECT incident_class || ' ' || status FROM smarter_private.reliability_incidents WHERE alertname = 'Git Maintenance Not Keeping Up'") == 'unclassified investigating'
        assert sql("SELECT incident_class || ' ' || status FROM smarter_private.reliability_incidents WHERE alertname = 'VercelDeploymentFailed'") == 'unclassified investigating'
        for source, name, severity in (('sp-critical-pager', 'CriticalPage.stuck_tournament', 'critical'), ('sp-daily-digest', 'DailyDigest.stuck_tournament', 'warning')):
            assert classify(source, name, severity) == 'tournament_lifecycle true false', name
            record(source, f'stuck:{name}', name, 'firing', severity, {'summary': 'stuck', 'detail': {'tournament_id': '11111111-1111-1111-1111-111111111111'}})
            assert sql(f"SELECT incident_class FROM smarter_private.reliability_incidents WHERE alertname = '{name}'") == 'tournament_lifecycle'
        assert classify('sp-daily-digest', 'DailyDigest.signups_dropped') == 'unclassified true false'
        assert num('SELECT count(*) FROM smarter_private.reliability_intake_rejections') == 0
        ok('InstallQueue opens nothing, the unknown families are unclassified incidents that do not escalate at once, both stuck_tournament names are tournament_lifecycle, and other names are as Stage B seeded them')

        # ---- a second install is harmless.
        classes = classes_hash()
        rows = num('SELECT count(*) FROM smarter_private.reliability_alert_classes')
        everything = state_hash()
        oid = sql(f"SELECT '{HEALTH}'::regprocedure::oid")
        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        assert classes_hash() == classes and num('SELECT count(*) FROM smarter_private.reliability_alert_classes') == rows
        assert state_hash() == everything
        assert sql(f"SELECT '{HEALTH}'::regprocedure::oid") == oid
        assert sql(f'SELECT {proof}') == 't'
        refused(f'SET ROLE anon; SELECT * FROM {HEALTH}', 'permission denied')
        assert health('service_role')['notify_mode'] == 'observe'
        assert num("SELECT count(*) FROM (SELECT source_pattern, alertname_pattern, severity_pattern FROM smarter_private.reliability_alert_classes GROUP BY 1, 2, 3 HAVING count(*) > 1) d") == 0
        ok('a second install succeeds, rewrites no class row, keeps the grants and changes nothing else')
        print(f'{len(passed)}/{len(passed)} behaviours proven')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)


if __name__ == '__main__':
    main()
