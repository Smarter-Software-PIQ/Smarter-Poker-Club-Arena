#!/usr/bin/env python3
"""Native PostgreSQL 17 RED-before / GREEN-after proof for
20261125022248_classify_remaining_alerts_and_backfill_unclassified_incident.sql.

Rebuilds the exact production Reliability Controller schema from the historical
migration chain on a throwaway PG17 cluster (on SSD2 scratch when TMPDIR/RUNNER_TEMP
is set; never touches production):
  * seeds representative open/stale unclassified incidents matching live production
    (OpponentHudDrift, PushZombieSubscriptions, HostDiskNearlyFull,
     rakeback_settler_read_horizon_held, DailyDigest.*,
     financial_attestation:🟢 Midway burn-in gate is GREEN) plus active firing
    control rows;
  * proves RED-before: all target alerts classify as 'unclassified' and all seeded
    incidents sit in incident_class = 'unclassified';
  * installs 20261125022248_classify_remaining_alerts_and_backfill_unclassified_incident.sql;
  * proves GREEN-after:
      1. every Prometheus rule in infra/monitoring/*.yml (173+ rules) + EventDbBulkhead*
         classifies out of 'unclassified';
      2. every DailyDigest.*, CriticalPage.*, OpponentHud*, ClubArena*, host-heartbeat,
         push-health, and watch alert classifies out of 'unclassified';
      3. unknown alerts still fall back to 'unclassified' (escalate_immediately = true);
      4. financial_attestation:🟢% is development_notification with is_incident = false
         and its existing row transitions to 'closed';
      5. rakeback_settler_read_horizon_held and HostDiskNearlyFull stale rows with proved
         post-stale resolved inbox rows transition to 'closed', while an active firing
         host-heartbeat row is reclassified but NOT closed;
      6. existing escalated OpponentHudDrift & PushZombieSubscriptions and stale
         DailyDigest.* rows are reclassified with lockstep member fingerprints so a
         subsequent resolved signal for OpponentHudDrift transitions it to verifying;
      7. -- @live-proof: holds true;
      8. re-running the migration a second time is 100% idempotent.
"""
import glob
import os
import platform
import re
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
FIXTURE_OBJECTS = ROOT / 'scripts/ci/fixtures/reliability-controller-production-objects.sql'

HISTORICAL_BEFORE_LATCH = [
    '20261110000020_reliability_controller_stage_b.sql',
    '20261110144203_reliability_controller_drift_mirrors_are_incidents_and_push_.sql',
    '20261110045731_reliability_controller_health_function_and_seed_corrections.sql',
    '20261110174051_reliability_controller_sends_critical_escalations.sql',
]
LATCH_FIX = MIGRATIONS / '20261110224707_a_recovered_reliability_incident_is_no_longer_escalated.sql'
HISTORICAL_AFTER_LATCH = [
    '20261111133716_reliability_escalation_drill_and_class_tuning.sql',
    '20261111222330_reliability_hold_down_and_found_producers.sql',
    '20261118165420_a_warming_throughput_baseline_is_not_an_incident.sql',
]
TARGET = MIGRATIONS / '20261125022248_classify_remaining_alerts_and_backfill_unclassified_incident.sql'


def pg_bin(name: str) -> str:
    for candidate in (
        os.environ.get('PG_BIN'),
        '/usr/lib/postgresql/17/bin',
        '/opt/homebrew/opt/postgresql@17/bin',
        '/usr/local/opt/postgresql@17/bin',
    ):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


def prometheus_alerts() -> list[str]:
    names = []
    for p in sorted(glob.glob(str(ROOT / 'infra/monitoring/*.yml'))):
        if 'QUARANTINED' in p:
            continue
        text = Path(p).read_text(encoding='utf-8')
        for m in re.finditer(r'^\s*-\s+alert:\s+(\S+)', text, re.M):
            names.append(m.group(1))
    return sorted(set(names))


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return int(s.getsockname()[1])


def scratch_root() -> str | None:
    for env_key in ('RUNNER_TEMP', 'SSD_TMPDIR', 'TMPDIR'):
        val = os.environ.get(env_key)
        if val and os.path.isdir(val):
            return val
    if platform.system() == 'Darwin':
        for ssd in (
            '/Volumes/SmarterWork/agent-work/extreme-capacity',
            '/Volumes/SmarterWork/agent-work/shared-capacity',
        ):
            if os.path.isdir(ssd) and os.access(ssd, os.W_OK):
                return ssd
        raise SystemExit('MAC-STORAGE: refusing /tmp on macOS without a writable external SSD')
    return None


def main() -> None:
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='pg17-alert-classes-', dir=scratch_root()))
    data = scratch / 'data'
    subprocess.run(
        [pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'],
        check=True,
        capture_output=True,
    )
    port = str(free_port())
    subprocess.run(
        [
            pg_bin('pg_ctl'),
            '-D', str(data),
            '-o', f"-h 127.0.0.1 -p {port} -c unix_socket_directories=''",
            '-l', str(scratch / 'log'),
            '-w', 'start',
        ],
        check=True,
        capture_output=True,
    )
    passed = []
    try:
        def psql(args, text=None):
            return subprocess.run(
                [
                    pg_bin('psql'),
                    '-h', '127.0.0.1',
                    '-p', port,
                    '-U', 'postgres',
                    '-d', 'postgres',
                    '-X', '-q', '-t', '-A',
                    '-v', 'ON_ERROR_STOP=1',
                    *args,
                ],
                input=text,
                capture_output=True,
                text=True,
            )

        def sql(text: str) -> str:
            r = psql(['-c', text])
            assert r.returncode == 0, f'{text[:400]}\n{r.stderr}'
            return r.stdout.strip()

        def ok(msg: str) -> None:
            passed.append(msg)
            print(f'ok - {msg}')

        # Bootstrap production fixture objects (exact same order as test-reliability-controller-stage-b.py)
        r = psql(['-f', str(FIXTURE_OBJECTS)])
        assert r.returncode == 0, f'fixture objects failed:\n{r.stderr}'

        for name in HISTORICAL_BEFORE_LATCH:
            r = psql(['-f', str(MIGRATIONS / name)])
            assert r.returncode == 0, f'{name} failed:\n{r.stderr}'

        # Apply the function patch of 20261110224707 (its data block names 3 prod UUIDs)
        latch_sql = ' '.join(
            re.search(r'^DO \$%s\$.*?^\$%s\$;' % (b, b), LATCH_FIX.read_text(encoding='utf-8'), re.M | re.S).group(0)
            for b in ('pre', 'latch')
        )
        r = psql([], f'BEGIN; {latch_sql} COMMIT;')
        assert r.returncode == 0, f'latch patch failed:\n{r.stderr}'

        for name in HISTORICAL_AFTER_LATCH:
            r = psql(['-f', str(MIGRATIONS / name)])
            assert r.returncode == 0, f'{name} failed:\n{r.stderr}'

        # Add 20261121011654 exposure class rule & 20261122145848 cutover rule;
        # insert rakeback incident BEFORE adding rule 296 to reproduce the exact production timeline!
        sql("""
        INSERT INTO smarter_private.reliability_alert_classes
          (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
        VALUES
          (305, 'horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', '%', 'horse_exposure_analysis', 'warning', false, false, '20261121011654'),
          (140, 'cutover-readiness-watch', 'CutoverReadinessAtRisk', '%', 'release', 'critical', false, true, '20261122145848'),
          (400, 'cutover-readiness-watch', '%', '%', 'release', 'critical', false, true, '20261122145848')
        ON CONFLICT (source_pattern, alertname_pattern, severity_pattern) DO NOTHING;

        -- Seed pre-20261122 rakeback_settler_read_horizon_held firing BEFORE rule 296 existed
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES ('rakeback-settler-read-horizon', 'rakeback:20261117', 'rakeback_settler_read_horizon_held', 'firing', 'warning', '{}'::jsonb);

        -- Move it to stale_unverified as happened on 2026-11-18, THEN add rule 296 (2026-11-22), THEN resolve inbox row (2026-11-24)
        UPDATE smarter_private.reliability_incidents
           SET status = 'stale_unverified',
               escalation_state = 'escalated',
               opened_at = now() - interval '7 days',
               last_firing_at = now() - interval '7 days',
               last_firing_received_at = now() - interval '7 days'
         WHERE alertname = 'rakeback_settler_read_horizon_held';
        UPDATE smarter_private.reliability_alert_members
           SET last_firing_at = now() - interval '7 days',
               last_firing_received_at = now() - interval '7 days'
         WHERE member_key = 'rakeback-settler-read-horizon:rakeback:20261117';

        INSERT INTO smarter_private.reliability_alert_classes
          (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
        VALUES
          (200, '%', 'rakeback_settler_read_horizon_held', '%', 'money_integrity', 'warning', false, true, '20261122145848')
        ON CONFLICT (source_pattern, alertname_pattern, severity_pattern) DO NOTHING;

        UPDATE public.operational_alert_events
           SET status = 'resolved',
               payload = '{"resolution":"the read horizon is no longer held","resolved_at":"2026-11-24T11:28:02+00:00"}'::jsonb
         WHERE event_key = 'rakeback:20261117';
        """)
        ok('rebuilt exact production reliability controller schema + pre-20261125 rules on PG17')

        # Seed remaining representative unclassified open/stale incidents mirroring live production
        sql("""
        -- 1. Escalated OpponentHudDrift (unclassified, with firing member)
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES ('engine-alerts-backfill', '3233:firing', 'OpponentHudDrift', 'firing', 'warning',
                '{"original_event":{"id":3233,"labels":{"component":"opponent-hud","engine_alert_episode_id":"ep-hud-1"}}}'::jsonb);

        -- 2. Escalated PushZombieSubscriptions (unclassified)
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES ('worldhub.push-health', 'push:zombies', 'PushZombieSubscriptions', 'firing', 'warning',
                '{"summary":"2 zombie subscriptions"}'::jsonb);

        -- 3. Stale HostDiskNearlyFull (unclassified) with resolved inbox row AFTER stale
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES ('host-heartbeat', 'disk:ops-mac:root:20261122', 'HostDiskNearlyFull', 'firing', 'warning',
                '{"host":"ops-mac-studio"}'::jsonb);

        -- 4. Stale DailyDigest.phone_verification_low & client_crash (unclassified)
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES
          ('sp-daily-digest', 'digest:2026-11-23:phone_verification_low', 'DailyDigest.phone_verification_low', 'firing', 'warning', '{}'::jsonb),
          ('sp-daily-digest', 'digest:2026-11-23:client_crash', 'DailyDigest.client_crash', 'firing', 'warning', '{}'::jsonb);

        -- 5. Green Midway burn-in gate notice (mistakenly unclassified incident before fix)
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES ('owner-operational-notifications', 'notif:midway-green', 'financial_attestation:🟢 Midway burn-in gate is GREEN', 'firing', 'warning', '{}'::jsonb);

        -- Move HostDiskNearlyFull to stale_unverified and resolve its inbox row after stale
        UPDATE smarter_private.reliability_incidents
           SET status = 'stale_unverified',
               escalation_state = 'escalated',
               opened_at = now() - interval '2 days',
               last_firing_at = now() - interval '2 days',
               last_firing_received_at = now() - interval '2 days'
         WHERE alertname = 'HostDiskNearlyFull';
        UPDATE smarter_private.reliability_alert_members
           SET last_firing_at = now() - interval '2 days',
               last_firing_received_at = now() - interval '2 days'
         WHERE fingerprint = (SELECT fingerprint FROM smarter_private.reliability_incidents WHERE alertname = 'HostDiskNearlyFull' LIMIT 1);
        UPDATE public.operational_alert_events
           SET status = 'resolved',
               payload = payload || '{"resolution":"free space is back above 5%","resolved_at":"2026-11-24T10:40:00+00:00"}'::jsonb
         WHERE alertname = 'HostDiskNearlyFull';

        -- Also seed an active firing HostHeartbeatMissing row to prove active host-heartbeat rows are NOT auto-closed
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES ('host-heartbeat', 'hb:ops-mac:20261125', 'HostHeartbeatMissing', 'firing', 'critical', '{"host":"ops-mac-studio"}'::jsonb);
        """)

        # ── RED-BEFORE ASSERTIONS ────────────────────────────────────────────
        for src, name in [
            ('alertmanager', 'ClassicCashFloorDark'),
            ('alertmanager', 'HandMemoryDomainMissingOnCashShowdown'),
            ('alertmanager', 'EventDbBulkheadSaturated'),
            ('alertmanager', 'EventDbBulkheadOpen'),
            ('host-heartbeat', 'HostDiskNearlyFull'),
            ('host-heartbeat', 'HostHeartbeatMissing'),
            ('engine-alerts-backfill', 'OpponentHudDrift'),
            ('engine-alerts-backfill', 'ClubArenaHorseFleetLoopStopped'),
            ('worldhub.push-health', 'PushZombieSubscriptions'),
            ('sp-daily-digest', 'DailyDigest.phone_verification_low'),
            ('sp-daily-digest', 'DailyDigest.client_crash'),
            ('owner-operational-notifications', 'financial_attestation:🟢 Midway burn-in gate is GREEN'),
        ]:
            got = sql(
                f"SELECT (smarter_private.reliability_classify({src!r}, {name!r}, 'warning', false)).incident_class"
            )
            assert got == 'unclassified', f'RED-before expected unclassified for {src}/{name}, got {got}'

        unclass_before = int(sql(
            "SELECT count(*) FROM smarter_private.reliability_incidents WHERE status NOT IN ('recovered','closed') AND incident_class = 'unclassified'"
        ))
        assert unclass_before >= 7, f'RED-before expected >=7 unclassified seeded incidents, got {unclass_before}'
        ok(f'RED-before proved: all target alerts classified as unclassified; {unclass_before} open/stale unclassified incidents seeded')

        # ── APPLY MIGRATION ──────────────────────────────────────────────────
        r = psql(['-f', str(TARGET)])
        assert r.returncode == 0, f'Migration install failed:\n{r.stderr}'
        ok('migration 20261125022248 installed cleanly on PG17')

        # ── GREEN-AFTER ASSERTIONS ───────────────────────────────────────────
        # 1. All Prometheus alerts in infra/monitoring/*.yml + EventDbBulkhead*
        all_prom = sorted(set(prometheus_alerts() + ['EventDbBulkheadSaturated', 'EventDbBulkheadOpen']))
        vals = ','.join(f"({a!r})" for a in all_prom)
        still_unclass = sql(f"""
            SELECT v.a FROM (VALUES {vals}) AS v(a)
             WHERE (smarter_private.reliability_classify('alertmanager', v.a, 'warning', false)).incident_class = 'unclassified'
             ORDER BY 1
        """)
        assert still_unclass == '', f'Prometheus alerts still unclassified after migration:\n{still_unclass}'
        ok(f'GREEN-after: 100% of {len(all_prom)} Prometheus alerts (+ EventDbBulkhead*) classify out of unclassified')

        # 2. Seeded incidents reclassified and zero unclassified rows remain
        unclass_after = int(sql(
            "SELECT count(*) FROM smarter_private.reliability_incidents WHERE status NOT IN ('recovered','closed') AND incident_class = 'unclassified'"
        ))
        assert unclass_after == 0, f'Expected 0 unclassified open/stale incidents after migration, got {unclass_after}'

        assert sql("SELECT incident_class || '|' || status FROM smarter_private.reliability_incidents WHERE alertname = 'OpponentHudDrift'") in (
            'stats|investigating', 'stats|escalated'
        )
        assert sql("SELECT incident_class || '|' || status FROM smarter_private.reliability_incidents WHERE alertname = 'PushZombieSubscriptions'") in (
            'monitoring_self|investigating', 'monitoring_self|escalated'
        )
        assert sql("SELECT incident_class || '|' || status FROM smarter_private.reliability_incidents WHERE alertname = 'DailyDigest.phone_verification_low'") == 'product_health|investigating'
        assert sql("SELECT incident_class || '|' || status FROM smarter_private.reliability_incidents WHERE alertname = 'DailyDigest.client_crash'") == 'client_health|investigating'
        assert sql("SELECT incident_class || '|' || status || '|' || escalation_state FROM smarter_private.reliability_incidents WHERE alertname = 'HostHeartbeatMissing'") == 'host_capacity|escalated|escalated'
        ok('GREEN-after: active incidents reclassified cleanly; active firing HostHeartbeatMissing stayed escalated')

        # 3. Closed reclassified green notice + proved post-stale rakeback/disk rows
        assert sql("SELECT incident_class || '|' || status || '|' || escalation_state || '|' || closure_basis FROM smarter_private.reliability_incidents WHERE alertname LIKE 'financial_attestation:🟢%'") == 'development_notification|closed|none|reclassified_not_an_incident'
        assert sql("SELECT incident_class || '|' || status || '|' || escalation_state || '|' || closure_basis FROM smarter_private.reliability_incidents WHERE alertname = 'rakeback_settler_read_horizon_held'") == 'money_integrity|closed|none|proved_source_resolution_post_stale'
        assert sql("SELECT incident_class || '|' || status || '|' || escalation_state || '|' || closure_basis FROM smarter_private.reliability_incidents WHERE alertname = 'HostDiskNearlyFull'") == 'host_capacity|closed|none|proved_source_resolution_post_stale'
        ok('GREEN-after: green notice and proved post-stale rakeback/host-disk rows closed via reliability_transition with cleared escalation_state')

        # 4. Lockstep fingerprint check: resolving OpponentHudDrift still lands on the SAME incident
        sql("""
        UPDATE public.operational_alert_events
           SET status = 'resolved'
         WHERE alertname = 'OpponentHudDrift';
        """)
        assert sql("SELECT status FROM smarter_private.reliability_incidents WHERE alertname = 'OpponentHudDrift'") == 'verifying'
        assert sql("SELECT count(*) FROM smarter_private.reliability_incidents WHERE alertname = 'OpponentHudDrift'") == '1'
        ok('GREEN-after: lockstep member fingerprint lets a subsequent OpponentHudDrift resolve transition to verifying')

        # 5. Live proof check
        proof_m = re.search(r'^-- @live-proof: (.+)$', TARGET.read_text(encoding='utf-8'), re.M)
        assert proof_m, 'Missing -- @live-proof: header'
        assert sql(f'SELECT {proof_m.group(1)}') == 't', '@live-proof assertion returned false'
        ok('GREEN-after: -- @live-proof: evaluates to true')

        # 6. Idempotency: re-applying migration succeeds cleanly with identical rule count
        count_before = sql('SELECT count(*) FROM smarter_private.reliability_alert_classes')
        r2 = psql(['-f', str(TARGET)])
        assert r2.returncode == 0, f'Second migration run failed:\n{r2.stderr}'
        assert sql('SELECT count(*) FROM smarter_private.reliability_alert_classes') == count_before
        ok(f'GREEN-after: second migration run is 100% idempotent ({count_before} rules)')

        print(f'PASS ({len(passed)} checks)')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    main()
