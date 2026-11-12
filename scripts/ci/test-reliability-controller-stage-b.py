#!/usr/bin/env python3
"""Native proof for 20261110000020_reliability_controller_stage_b.

Runs the exact migration against a throwaway PostgreSQL 17 cluster (never
production), over minimal copies of the production objects it touches
(scripts/ci/fixtures/reliability-controller-production-objects.sql: the inbox
table and its writer, the Messenger tables, the real bodies of
fn_messenger_send_allowed and fn_send_message_once, and push_outbox with its
recipient guard). It proves:

  * a duplicate and a redelivered alert are one incident with the right count;
  * an out-of-order delivery changes nothing and time never runs backwards;
  * a resolved row acts only on its own record and episode and only when it
    is later than the last firing; it reaches verifying, the tick confirms
    recovered, a new firing reopens the same row as a recurrence, and a
    resolved row for a closed incident reopens nothing;
  * a malformed payload is written to intake_rejections and the inbox insert
    still commits;
  * an unknown alert name is an escalated 'unclassified' incident;
  * info, test, canary and development rows open nothing;
  * tables, tournaments and variants never merge, a hand id never splits, a
    wrapper joins its inner alert only through the record id it carries, and
    a wrapper without one is linked, not merged;
  * escalations are digested: one message per group, scopes counted;
  * observe mode sends nothing, a send delivered twice or replayed is one
    message, the hourly limit holds, a push row follows each sent message and
    a guard that diverts or refuses it never undoes the message;
  * a source with no resolve protocol becomes stale_unverified, never
    recovered;
  * two concurrent ticks, transitions and deliveries produce one transition
    and one message, and a backlog is worked 50 rows a tick;
  * reminders stop after 4 per incident;
  * the controller's own failures are one incident per kind and never loop;
  * anon and authenticated can read, write and execute nothing;
  * after every later controller migration (20261110045731, 20261110174051 and
    the function patch of 20261110224707), 20261111133716 installs once: the
    corrected producers land on their read classes, and the escalation drill
    enters through fn_record_operational_alert, escalates once, sends one DM
    and one push in critical_only, is idempotent per drill id, refuses a
    second drill inside 10 minutes, resolves through a producer-style resolved
    row, and cannot be called by anon or authenticated.
  * 20261111222330 installs once over those bodies (proven equal to
    production by its own preimage check): a class row with a hold-down holds
    a firing incident (nothing sent) until it has stayed firing
    hold_down_seconds or started hold_down_flaps episodes in the window, at
    intake or from the tick; a resolve resets it; the class quiet window
    decides recovery; classes without a hold-down are unchanged; a close keeps
    its named basis; the three producer families land on their found classes.
"""
import json
import os
import re
import shutil
import subprocess
import time
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261110000020_reliability_controller_stage_b.sql'
FOLLOW_UP = ROOT / 'supabase/migrations/20261110144203_reliability_controller_drift_mirrors_are_incidents_and_push_.sql'
FIXTURE = ROOT / 'scripts/ci/fixtures/reliability-controller-production-objects.sql'
# Installed in production after the two above, in this order; the drill installs over all of them.
INSTALLED_AFTER = [ROOT / 'supabase/migrations' / name for name in (
    '20261110045731_reliability_controller_health_function_and_seed_corrections.sql',
    '20261110174051_reliability_controller_sends_critical_escalations.sql')]
# Its function patch only: its data section reconciles three production incident ids, which a native cluster does not hold.
LATCH_FIX = ROOT / 'supabase/migrations/20261110224707_a_recovered_reliability_incident_is_no_longer_escalated.sql'
DRILL = ROOT / 'supabase/migrations/20261111133716_reliability_escalation_drill_and_class_tuning.sql'
HOLD_DOWN = ROOT / 'supabase/migrations/20261111222330_reliability_hold_down_and_found_producers.sql'
OWNER = '47965354-0e56-43ef-931c-ddaab82af765'
# md5 of the whitespace-normalized definition, read from production (PokerIQ,
# PostgreSQL 17.6) on 2026-11-10 with the same expressions this file runs.
PRODUCTION_FUNCTIONS = {
    'auth.role()': '80d4655662c5d6d6a9bbcccaf6ffaca4',
    'auth.uid()': 'd533173f6acd170b27133c6e2e08aeac',
    'public.fn_record_operational_alert(text,text,text,text,text,jsonb)': '7603463d0d8f37a73d5e436e7a5157ec',
    'public.fn_messenger_send_allowed(uuid,uuid)': '7d30bd73554b848336afb2d802c32478',
    'public.fn_send_message_once(uuid,uuid,uuid,text,text,jsonb)': 'e33145582ae742b57cc26c277c0c4d9b',
    'public.fn_is_platform_operational_alert(text,text,jsonb)': '6fccefd41b1264bcfa4cbcd25b68d836',
    'public.fn_is_platform_alert_recipient(uuid)': '44f3a6510becd28a6e6b0276136b65b0',
    'public.fn_platform_push_recipient_guard()': '9effb38a59929906cfd1a427911dd34c',
}
PRODUCTION_COLUMNS = {
    'operational_alert_events': 'cc5c3df6f1477455b08a191f1106b8df',
    'social_conversations': '91139a6ec085292fd73ed73f8d0c064f',
    'social_conversation_participants': 'c0dc7dabe27b9f8e9bfebfa6ef2272d8',
    'social_messages': '37701a62a950023ae0adb274dece2a82',
    'messenger_send_requests': 'f1aa33ffcb132f395686e1d9fd097220',
    'messenger_blocked': '010633e71e9381e2bd950a1dd6b7776a',
    'push_outbox': '39e406f0548037b5f28e0a6d6d1ae4cc',
}
# CHECK, PRIMARY KEY and UNIQUE constraints. operational_alert_events is hashed
# without operational_alert_events_owner_accounting_addressed (a per-row
# allowlist for one other source), which the fixture leaves out.
PRODUCTION_CONSTRAINTS = {
    'operational_alert_events': '516a1295c6c629ea6c3320e626199317',
    'social_conversation_participants': '0f0e92ebfd72b98786df7fbaf7426b45',
    'messenger_send_requests': '41a29e48e2c7f2a1ba49ad65d7bc7d51',
    'messenger_blocked': '45ef20e3781d5488c986112ef2e92748',
}
PRODUCTION_PUSH_GUARD_TRIGGER = 'e4421be5e03c838c7e990ef6fb25447e'

SENDER = '2d1cd6c3-5700-4af9-a271-d4863fdab20d'
ACCEPTANCE = 'Acceptance criteria: Identify root cause, fix at source, verify alert clears and stays clear.'


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='reliability-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir='/tmp'))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
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

        def am(key, alertname, status='firing', severity='critical', fingerprint='fp', starts=None, ends=None, labels=None, summary=None):
            if alertname == 'HorseDecisionFallbacks':
                labels = {'variant': 'plo4', **(labels or {})}
            alert = {'status': status, 'fingerprint': fingerprint,
                     'labels': {'alertname': alertname, 'severity': severity, 'component': 'club-arena-engine', **(labels or {})},
                     'annotations': {'summary': summary or f'{alertname} summary'},
                     'startsAt': starts or '2026-11-09T19:48:49.182Z', 'endsAt': ends or '0001-01-01T00:00:00Z'}
            return record('alertmanager', key, alertname, status, severity, {'alert': alert, 'receiver': 'codex-inbox'})

        def incident(alertname, field='status'):
            return sql(f"SELECT {field} FROM smarter_private.reliability_incidents WHERE alertname = $a${alertname}$a$ ORDER BY created_at DESC LIMIT 1")

        def incidents(alertname=None):
            where = f"WHERE alertname = $a${alertname}$a$" if alertname else ''
            return num(f'SELECT count(*) FROM smarter_private.reliability_incidents {where}')

        def notes(alertname, kind='escalation', state=None):
            return num("SELECT count(*) FROM smarter_private.reliability_notifications n JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id "
                       f"WHERE i.alertname = $a${alertname}$a$ AND n.kind = '{kind}'" + (f" AND n.state = '{state}'" if state else ''))

        def now(offset=''):
            return sql(f"SELECT to_char((clock_timestamp() {offset}) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")

        def tick(at=None):
            return json.loads(sql('SELECT smarter_private.reliability_tick(%s)' % (f"'{at}'::timestamptz" if at else '')))

        def messages():
            return num('SELECT count(*) FROM public.social_messages')

        r = psql(['-f', str(FIXTURE)])
        assert r.returncode == 0, r.stderr
        # ---- the fixture is the production definition, compared mechanically (see FIXTURE-PARITY.md).
        mismatches = {}
        for name, expected in PRODUCTION_FUNCTIONS.items():
            got = sql(f"SELECT md5(regexp_replace(pg_get_functiondef('{name}'::regprocedure), '\\s+', ' ', 'g'))")
            if got != expected:
                mismatches[name] = got
        for name, expected in PRODUCTION_COLUMNS.items():
            got = sql("SELECT md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' "
                      "|| coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attname)) FROM pg_attribute a "
                      "LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum "
                      f"WHERE a.attrelid = 'public.{name}'::regclass AND a.attnum > 0 AND NOT a.attisdropped")
            if got != expected:
                mismatches['columns ' + name] = got
        for name, expected in PRODUCTION_CONSTRAINTS.items():
            got = sql("SELECT md5(string_agg(regexp_replace(pg_get_constraintdef(oid), '\\s+', ' ', 'g'), ' | ' ORDER BY pg_get_constraintdef(oid))) "
                      f"FROM pg_constraint WHERE contype IN ('c', 'p', 'u') AND conrelid = 'public.{name}'::regclass")
            if got != expected:
                mismatches['constraints ' + name] = got
        got = sql("SELECT md5(regexp_replace(pg_get_triggerdef(oid), '\\s+', ' ', 'g')) FROM pg_trigger WHERE tgname = 'aa_platform_push_recipient_guard'")
        if got != PRODUCTION_PUSH_GUARD_TRIGGER:
            mismatches['trigger aa_platform_push_recipient_guard'] = got
        assert not mismatches, mismatches
        ok('every production function, column list, constraint set and trigger the fixture copies hashes to what production returned')

        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
        # ---- Rows Stage B skipped before the follow-up existed (production shapes, 2026-11-10).
        # Inbox ids continue from the first row received after Stage B installed (374266).
        sql('ALTER TABLE public.operational_alert_events ALTER COLUMN id RESTART WITH 374266')

        def premarked(key, alertname, payload, severity='critical', received_at=None):
            when = f"'{received_at}'::timestamptz" if received_at else 'clock_timestamp()'
            return int(sql("INSERT INTO public.operational_alert_events(source, event_key, alertname, status, severity, payload, investigation_status, investigation, received_at, last_received_at) "
                           f"VALUES ('drift-incidents-updates', '{key}', $a${alertname}$a$, 'firing', '{severity}', $a${json.dumps(payload)}$a$::jsonb, 'informational', "
                           f"'{{\"rule\": \"mirror_duplicate_of_captured_original\"}}', {when}, {when}) RETURNING id"))

        inner_name = 'fn_tournament_money_conservation'
        inner_row = int(sql("SELECT public.fn_record_operational_alert('financial-alerts-backfill', 'fa-rc1', $a$%s$a$, 'firing', 'critical', "
                            "$a${\"original_event\": {\"id\": \"fa-rc1\", \"context\": {\"tournament_id\": \"T-rc\"}}}$a$::jsonb)" % inner_name))
        inner_id = sql(f"SELECT id FROM smarter_private.reliability_incidents WHERE alertname = '{inner_name}'")
        assert inner_row == 374266 and sql(f"SELECT status || ' ' || occurrence_count FROM smarter_private.reliability_incidents WHERE id = '{inner_id}'") == 'escalated 1'
        wrapper_row = premarked('dd-rc1:1', f'financial_alerts:{inner_name}', {'original_incident': {'id': 'dd-rc1', 'metadata': {'alert_id': 'fa-rc1', 'tournament_id': 'T-rc'}}})
        lone = 'fn_ca_escrow_balance_drift'
        lone_rows = [premarked(f'dd-rc2:{n}', lone, {'original_incident': {'id': 'dd-rc2', 'metadata': {}, 'source': lone}}) for n in range(3)]
        early_row = premarked('dd-rc3:1', 'fn_ca_mint_velocity_watch', {'original_incident': {'id': 'dd-rc3'}}, received_at='2026-11-10 07:00:00+00')
        skipped = [wrapper_row] + lone_rows + [early_row]
        assert num(f"SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id IN ({','.join(map(str, skipped))})") == 0
        incidents_before = num('SELECT count(*) FROM smarter_private.reliability_incidents')
        notes_before = num('SELECT count(*) FROM smarter_private.reliability_notifications')

        # The observation-findings follow-up installs over the exact Stage B definitions; everything below runs against both.
        r = psql(['-f', str(FOLLOW_UP)])
        assert r.returncode == 0, r.stderr
        assert 'reliability reconciliation: 4 skipped inbox row(s) admitted' in r.stderr, r.stderr
        assert num('SELECT count(*) FROM smarter_private.reliability_incidents') == incidents_before + 1
        assert num('SELECT count(*) FROM smarter_private.reliability_notifications') == notes_before
        assert num(f"SELECT count(*) FROM smarter_private.reliability_incidents WHERE alertname LIKE '%{inner_name}'") == 1
        assert sql(f'SELECT incident_id FROM smarter_private.reliability_observations WHERE inbox_event_id = {wrapper_row}') == inner_id
        assert sql(f"SELECT status || ' ' || occurrence_count || ' ' || awaiting_live_delivery FROM smarter_private.reliability_incidents WHERE id = '{inner_id}'") == 'escalated 2 false'
        lone_id = sql(f"SELECT id FROM smarter_private.reliability_incidents WHERE alertname = '{lone}'")
        assert sql(f"SELECT status || ' ' || occurrence_count || ' ' || awaiting_live_delivery || ' ' || escalation_state || ' ' || (latest_evidence->>'drift_incident_id') "
                   f"FROM smarter_private.reliability_incidents WHERE id = '{lone_id}'") == 'investigating 3 true none dd-rc2'
        assert num(f"SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id = {early_row}") == 0
        events = json.loads(sql("SELECT jsonb_object_agg(i.alertname, e.detail) FROM smarter_private.reliability_incident_events e "
                                "JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id WHERE e.kind = 'reconciled'"))
        assert events[lone]['inbox_event_ids'] == lone_rows and events[lone]['opened_by_reconciliation'] is True, events
        assert events[inner_name]['inbox_event_ids'] == [wrapper_row] and events[inner_name]['opened_by_reconciliation'] is False, events
        ok('one-time admission of the skipped rows: the wrapper is an observation of its inner incident, the standalone drift record is one incident '
           'awaiting a live delivery, a row from before the install is left alone, and no notification is created')
        admit = re.search(r'^DO \$admit_skipped\$.*?^\$admit_skipped\$;', FOLLOW_UP.read_text(), re.M | re.S).group(0)
        counts = "SELECT (SELECT count(*) FROM smarter_private.reliability_incidents) || ' ' || (SELECT count(*) FROM smarter_private.reliability_observations) " \
                 "|| ' ' || (SELECT count(*) FROM smarter_private.reliability_incident_events) || ' ' || (SELECT count(*) FROM smarter_private.reliability_notifications)"
        before_rerun = sql(counts)
        r = psql([], f'BEGIN; {admit} COMMIT;')
        assert r.returncode == 0 and '0 skipped inbox row(s) admitted' in r.stderr, r.stderr
        assert sql(counts) == before_rerun
        ok('running the admission again creates no incident, observation, event or notification')
        sql(f"UPDATE smarter_private.reliability_incidents SET opened_at = clock_timestamp() - interval '2 hours' WHERE id = '{lone_id}'")
        tick()
        assert sql(f"SELECT status FROM smarter_private.reliability_incidents WHERE id = '{lone_id}'") == 'investigating'
        assert num(f"SELECT count(*) FROM smarter_private.reliability_notification_incidents WHERE incident_id = '{lone_id}'") == 0
        refused(f"BEGIN; SELECT set_config('reliability.replay', 'on', true); SELECT smarter_private.reliability_escalate('{lone_id}', 'x'); COMMIT;",
                'RELIABILITY_REPLAY_MAY_NOT_NOTIFY')
        live = premarked('dd-rc2:live', lone, {'original_incident': {'id': 'dd-rc2', 'metadata': {}, 'source': lone}})
        assert sql(f"SELECT status || ' ' || occurrence_count || ' ' || awaiting_live_delivery FROM smarter_private.reliability_incidents WHERE id = '{lone_id}'") == 'escalated 4 false'
        assert num(f"SELECT count(*) FROM smarter_private.reliability_notification_incidents WHERE incident_id = '{lone_id}'") == 1
        assert num(f"SELECT count(*) FROM smarter_private.reliability_incident_events WHERE incident_id = '{lone_id}' AND kind = 'live_delivery_after_reconciliation' "
                   f"AND detail->>'observation_id' = (SELECT id::text FROM smarter_private.reliability_observations WHERE inbox_event_id = {live})") == 1
        assert 'public.ca_drift_incidents dd-rc2' in sql(f"SELECT body FROM smarter_private.reliability_notifications WHERE incident_id = '{lone_id}'")
        ok('a reconciled incident is not escalated by the tick and escalation refuses while reconciling; its first live delivery starts normal policy')
        proof = re.search(r'^-- @live-proof: (.+)$', FOLLOW_UP.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'follow-up live proof must hold after install'
        r = psql(['-f', str(FOLLOW_UP)])
        assert r.returncode != 0 and 'RELIABILITY_FINDINGS_PREIMAGE_CHANGED' in r.stderr, r.stderr
        assert sql("SELECT mutation_paused::text || ' ' || notify_mode || ' ' || system_sender_id || ' ' || owner_user_id FROM smarter_private.reliability_settings") == f'true observe {SENDER} {OWNER}'
        refused(f"UPDATE smarter_private.reliability_settings SET owner_user_id = '{SENDER}' WHERE id", 'settings_')
        refused("UPDATE smarter_private.reliability_settings SET owner_user_id = gen_random_uuid() WHERE id", 'settings_recipient_is_owner')
        assert num('SELECT count(*) FROM smarter_private.reliability_runbooks') == 0
        assert num("SELECT count(*) FROM smarter_private.reliability_alert_classes WHERE priority = 100") == 164
        names = {'lightning_card_incident': 'money_integrity', 'LightningHandHost.post_commit_obligations_pending': 'unclassified',
                 'ServerTableEngine.street_integrity_violation': 'money_integrity', 'fn_ca_conservation_sweep:fn_ca_tables_that_cannot_deal': 'tournament_lifecycle',
                 'fn_ca_writer_lock_sentinel': 'database', 'fn_ca_guard_defs_watch': 'monitoring_self', 'fn_ca_bounty_only_final_two_watch': 'money_integrity',
                 'TournamentRecurring.freeBuyAudit': 'tournament_lifecycle', 'CriticalPage.midway_free_buy_missing': 'tournament_lifecycle',
                 'fn_horse_daily_audit_watchdog': 'unclassified', 'fn_gto_v31_round_stall_check': 'unclassified', 'union_promo_duplicate_2026_11_07': 'unclassified',
                 'OpenClawJobStale': 'unclassified', 'lightning_alerts': 'table_liveness', 'drift_incident:financial_alerts:fn_ca_cron_failure_watch': 'database'}
        for name, expected in names.items():
            got = sql(f"SELECT (smarter_private.reliability_classify('financial-alerts-backfill', smarter_private.reliability_normalize_alertname($a${name}$a$), 'warning', false)).incident_class")
            assert got == expected, (name, got, expected)
        triggers = sql("SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.operational_alert_events'::regclass AND NOT tgisinternal")
        existing = ['a00_operational_alert_stamp_destination', 'a0_operational_alert_mirror_classify', 'a_operational_alert_investigation_touched',
                    'b_operational_alert_resolved_twin_closes_firing', 'ca_native_alert_committed', 'zz_a_real_alert_reaches_the_owner']
        assert triggers == 'zzz_reliability_intake_insert,zzz_reliability_intake_update' and all(t > max(existing) for t in triggers.split(',')), triggers
        ok('the exact migration installs, its live proof holds, it ships observe mode with no runbook, the recipient is constrained to the owner, and its triggers sort after every existing one')

        # ---- critical: one incident, escalated at once, exactly one escalation, nothing sent in observe mode.
        e1 = now("- interval '10 minutes'")
        first = am('k1', 'HorseDecisionFallbacks', labels={'page': 'sms', 'email': 'someone@example.com'},
                   summary='297.7 horse decisions/min are falling back \u2014 check/fold', starts=e1)
        assert incidents('HorseDecisionFallbacks') == 1
        assert incident('HorseDecisionFallbacks', "incident_class || ' ' || status || ' ' || severity || ' ' || occurrence_count || ' ' || escalation_reason") \
            == 'horse_decision_delivery escalated critical 1 no eligible recovery'
        assert notes('HorseDecisionFallbacks') == 1 and notes('HorseDecisionFallbacks', state='suppressed_observe') == 1
        body = sql("SELECT n.body FROM smarter_private.reliability_notifications n JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id "
                   "WHERE n.kind = 'escalation' AND i.alertname = 'HorseDecisionFallbacks' ORDER BY n.id LIMIT 1")
        lines = body.split('\n')
        iid = incident('HorseDecisionFallbacks', 'id')
        assert lines[0] == 'AI AGENT NEEDED' and len(body) <= 2000, body
        assert lines[1] == f'Incident ID: {iid}' and lines[2] == 'Severity: CRITICAL', body
        for needle in ('Owner: unassigned, needs an AI coding agent', 'First detected: ', 'Latest observation: ', ' America/Chicago',
                       'Affected scopes: 1 (variant=plo4)', 'Attempted: No automatic recovery exists for this class yet.',
                       'Why automatic handling cannot complete: no eligible recovery', 'Containment: None verified.',
                       'Current uncertainty: Root cause is not established.', 'Next action: Read the evidence below', '\nAgent Handoff\n',
                       'Alert name: HorseDecisionFallbacks', 'Source: alertmanager', 'Occurrence count: 1', 'Rule summary: 297.7 horse decisions/min',
                       'component=club-arena-engine', 'variant=plo4',
                       f'Evidence: smarter_private.reliability_incidents {iid}, inbox events {first}..{first}'):
            assert needle in body, (needle, body)
        assert lines[-1] == ACCEPTANCE, body
        assert 'someone@example.com' not in body and 'page=' not in body and '\u2014' not in body, body
        ok('a critical alert is one escalated incident with exactly one escalation in the fixed template: owner, next action, uncertainty, evidence, allowlisted labels only, no em dash')

        # ---- redelivery and duplicate.
        assert am('k1', 'HorseDecisionFallbacks') == first and am('k1', 'HorseDecisionFallbacks') == first
        assert sql(f'SELECT delivery_count FROM public.operational_alert_events WHERE id = {first}') == '3'
        assert incidents('HorseDecisionFallbacks') == 1 and incident('HorseDecisionFallbacks', 'occurrence_count') == '3'
        assert num(f'SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id = {first}') == 3
        again = sql("SELECT coalesce(smarter_private.reliability_ingest_alert(o.id, o.source, o.event_key, o.alertname, o.status, o.severity, o.payload, "
                    "o.received_at, o.last_received_at, o.delivery_count, o.investigation_status, 'REDELIVERY')::text, 'ignored') "
                    f"FROM public.operational_alert_events o WHERE o.id = {first}")
        assert again == 'ignored' and incident('HorseDecisionFallbacks', 'occurrence_count') == '3'
        assert num(f'SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id = {first}') == 3
        assert notes('HorseDecisionFallbacks') == 1
        ok('two redeliveries count three occurrences on one incident, the same delivery twice counts once, and no second escalation is queued')

        # ---- out of order: an older firing delivery changes nothing.
        seen = incident('HorseDecisionFallbacks', 'last_observed_at')
        stale = am('k1-late', 'HorseDecisionFallbacks', starts='2026-11-01T00:00:00Z')
        assert incident('HorseDecisionFallbacks', 'last_observed_at') == seen, (seen, incident('HorseDecisionFallbacks', 'last_observed_at'))
        assert incident('HorseDecisionFallbacks', 'occurrence_count') == '3'
        assert sql(f'SELECT disposition FROM smarter_private.reliability_observations WHERE inbox_event_id = {stale}') == 'stale'
        ok('a delivery older than the recorded state is kept as an observation and last_observed_at never regresses')

        # ---- resolution safety: only the incident's own record, only later than its last firing.
        other = am('k1-other-record', 'HorseDecisionFallbacks', status='resolved', fingerprint='never-seen-firing', ends=now())
        assert incident('HorseDecisionFallbacks') == 'escalated'
        assert sql(f'SELECT disposition FROM smarter_private.reliability_observations WHERE inbox_event_id = {other}') == 'resolved_not_of_this_episode'
        assert incident('HorseDecisionFallbacks', 'resolution_state') == 'uncertain'
        assert sql("SELECT resolution_state FROM smarter_private.reliability_v_open_incidents WHERE alertname = 'HorseDecisionFallbacks'") == 'uncertain'
        assert num("SELECT count(*) FROM smarter_private.reliability_incident_events WHERE kind = 'resolution_uncertain' AND detail->>'status_kept' = 'escalated'") == 1
        assert 'whether it cleared is uncertain' in sql(f"SELECT smarter_private.reliability_render_escalation('{iid}', 'escalation', NULL)")
        ok('a resolved row that cannot be bound to a record this episode saw firing changes no status and marks the resolution uncertain')
        am('k1-resolved', 'HorseDecisionFallbacks', status='resolved', starts=e1, ends=now())
        assert incident('HorseDecisionFallbacks') == 'verifying' and incident('HorseDecisionFallbacks', 'closure_basis') == 'resolved_signal'
        assert incident('HorseDecisionFallbacks', 'resolution_state') == 'none'
        am('k1-same-episode-again', 'HorseDecisionFallbacks', starts=e1)
        assert incident('HorseDecisionFallbacks') == 'verifying'
        am('k1-later-still', 'HorseDecisionFallbacks', starts='2026-11-02T00:00:00Z')
        assert incident('HorseDecisionFallbacks') == 'verifying'
        tick()
        assert incident('HorseDecisionFallbacks') == 'verifying'
        sql("UPDATE smarter_private.reliability_incidents SET status_changed_at = clock_timestamp() - interval '31 minutes' WHERE alertname = 'HorseDecisionFallbacks' AND status = 'verifying'")
        tick()
        assert incident('HorseDecisionFallbacks') == 'recovered'
        ok('resolved moves the incident to verifying, a late firing does not reopen it, and the tick marks it recovered after 30 quiet minutes')

        # ---- firing after recovery: the same row, as a recurrence, with a new escalation decision.
        e2 = now()
        k2 = am('k2', 'HorseDecisionFallbacks', starts=e2)
        assert incidents('HorseDecisionFallbacks') == 1
        assert incident('HorseDecisionFallbacks', "status || ' ' || recurrence_count || ' ' || occurrence_count") == 'escalated 1 4'
        assert num("SELECT count(*) FROM smarter_private.reliability_incident_events e JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id "
                   "WHERE i.alertname = 'HorseDecisionFallbacks' AND e.kind = 'recurrence'") == 1
        assert notes('HorseDecisionFallbacks') == 1 and num("SELECT count(*) FROM smarter_private.reliability_incident_events WHERE kind = 'escalation_attached'") == 1
        ok('a new firing after recovery reopens the same incident as a recurrence; inside the reminder window it joins the existing escalation, no second message')

        # ---- one clock per comparison: the episode decides, not endsAt against a receipt time.
        old = am('k2-older-episode-resolved', 'HorseDecisionFallbacks', status='resolved', starts=e1, ends=now())
        assert incident('HorseDecisionFallbacks') == 'escalated'
        assert sql(f'SELECT disposition FROM smarter_private.reliability_observations WHERE inbox_event_id = {old}') == 'resolved_older_episode'
        ok('a resolved row of an older episode arriving after a newer firing is an observation and changes no state')
        assert am('k2', 'HorseDecisionFallbacks', starts=e2) == k2
        early = now("- interval '5 minutes'")
        assert sql(f"SELECT ('{early}'::timestamptz < last_firing_received_at)::text FROM smarter_private.reliability_incidents WHERE alertname = 'HorseDecisionFallbacks'") == 'true'
        same = am('k2-resolved', 'HorseDecisionFallbacks', status='resolved', starts=e2, ends=early)
        assert incident('HorseDecisionFallbacks') == 'verifying'
        assert sql(f'SELECT disposition FROM smarter_private.reliability_observations WHERE inbox_event_id = {same}') == 'applied'
        ok('a resolved row of the current episode applies even when its endsAt is earlier than the last firing receipt')
        e3 = now()
        am('k3', 'HorseDecisionFallbacks', starts=e3)
        assert incident('HorseDecisionFallbacks') == 'escalated' and notes('HorseDecisionFallbacks') == 1
        ok('a firing delivery of a newer episode while verifying returns the incident to escalated')
        # ---- no episode on either side: database receipt times only.
        record('some-new-producer', 'rc1', 'ReceiptClockOnly', 'firing', 'critical', {'detail': 'x'})
        sql("UPDATE smarter_private.reliability_alert_members SET episode = NULL, last_firing_received_at = clock_timestamp() + interval '1 hour' WHERE member_key = 'some-new-producer:rc1'")
        before_receipt = record('some-new-producer', 'rc1:resolved', 'ReceiptClockOnly', 'resolved', 'critical', {'resolved_at': now()})
        assert incident('ReceiptClockOnly') == 'escalated'
        assert sql(f'SELECT disposition FROM smarter_private.reliability_observations WHERE inbox_event_id = {before_receipt}') == 'resolved_before_last_firing_receipt'
        assert incident('ReceiptClockOnly', 'resolution_state') == 'none'
        sql("UPDATE smarter_private.reliability_alert_members SET last_firing_received_at = NULL WHERE member_key = 'some-new-producer:rc1'")
        sql("SELECT public.fn_record_operational_alert('some-new-producer', 'rc1:resolved', 'ReceiptClockOnly', 'resolved', 'critical', '{}'::jsonb)")
        assert incident('ReceiptClockOnly', "status || ' ' || resolution_state") == 'escalated uncertain'
        assert sql("SELECT disposition FROM smarter_private.reliability_observations o JOIN smarter_private.reliability_incidents i ON i.id = o.incident_id "
                   "WHERE i.alertname = 'ReceiptClockOnly' ORDER BY o.id DESC LIMIT 1") == 'resolution_order_unknown'
        sql("UPDATE smarter_private.reliability_alert_members SET last_firing_received_at = clock_timestamp() - interval '1 minute' WHERE member_key = 'some-new-producer:rc1'")
        sql("SELECT public.fn_record_operational_alert('some-new-producer', 'rc1:resolved', 'ReceiptClockOnly', 'resolved', 'critical', '{}'::jsonb)")
        assert incident('ReceiptClockOnly', "status || ' ' || resolution_state") == 'verifying none'
        ok('with no episode identity a resolved row applies only when its database receipt is later than the last firing receipt; with no order at all the incident keeps its status and is marked uncertain')

        # ---- closed, then a late resolved row: recorded, nothing reopens. Then a firing opens a new row.
        am('k3-resolved', 'HorseDecisionFallbacks', status='resolved', starts=e3, ends=now())
        sql("UPDATE smarter_private.reliability_incidents SET status_changed_at = clock_timestamp() - interval '31 minutes' WHERE alertname = 'HorseDecisionFallbacks' AND status = 'verifying'")
        tick()
        sql("UPDATE smarter_private.reliability_incidents SET status_changed_at = clock_timestamp() - interval '25 hours' WHERE alertname = 'HorseDecisionFallbacks'")
        tick()
        assert incident('HorseDecisionFallbacks') == 'closed'
        late = am('k3-resolved-again', 'HorseDecisionFallbacks', status='resolved', starts=e3, ends=now())
        assert incidents('HorseDecisionFallbacks') == 1 and incident('HorseDecisionFallbacks') == 'closed'
        assert sql(f'SELECT disposition FROM smarter_private.reliability_observations WHERE inbox_event_id = {late}') == 'late_resolved'
        assert num("SELECT count(*) FROM smarter_private.reliability_incident_events WHERE kind = 'late_resolved'") == 1
        am('k4', 'HorseDecisionFallbacks', starts=now())
        assert incidents('HorseDecisionFallbacks') == 2 and incident('HorseDecisionFallbacks') == 'escalated'
        ok('recovered closes after 24 hours, a late resolved row for the closed incident is recorded and reopens nothing, a later firing opens a new incident')

        # ---- malformed payload: the inbox insert commits, the rejection is recorded.
        before = incidents()
        bad = record('alertmanager', 'bad-1', 'HorseTurnTimeouts', 'firing', 'warning', {'alert': 'not-an-object'})
        assert num(f'SELECT count(*) FROM public.operational_alert_events WHERE id = {bad}') == 1
        assert sql(f'SELECT reason FROM smarter_private.reliability_intake_rejections WHERE inbox_event_id = {bad}').startswith('malformed alertmanager payload')
        assert incidents() == before
        ok('a malformed payload is written to intake_rejections and the inbox insert still succeeds')

        # ---- unknown alert name: unclassified, escalated.
        record('some-new-producer', 'u1', 'SomethingNobodyClassified', 'firing', 'warning', {'detail': 'x'})
        assert incident('SomethingNobodyClassified', "incident_class || ' ' || status || ' ' || escalation_reason") == 'unclassified escalated no eligible recovery'
        assert notes('SomethingNobodyClassified') == 1
        ok("an unknown alert name becomes an escalated 'unclassified' incident")

        # ---- never incidents.
        before = incidents()
        record('club-arena.post-deploy-e2e', 'ep:failed-release:1', 'PostDeployVerificationIncomplete', 'info', 'info', {'kind': 'failed-release'})
        sql("INSERT INTO public.operational_alert_events(source, event_key, alertname, status, severity, payload, investigation_status) "
            "VALUES ('install-queue', 't1', 'InstallQueueJobFailed', 'firing', 'critical', '{}', 'test'), "
            "('drift-incidents-updates', 'info-1:h', 'ca_manual_adjustments', 'info', 'info', '{\"original_incident\": {\"id\": \"info-1\"}}', 'informational')")
        am('canary-1', 'MonitoringCanary', severity='canary')
        am('canary-2', 'HorseTurnTimeouts', severity='warning', labels={'severity': 'canary'})
        record('mac-studio-git-maintenance', 'g1', 'Git Maintenance Not Keeping Up', 'firing', 'warning', {'repo': 'x'})
        record('club-arena.post-deploy-e2e', 'ep2', 'PostDeployVerificationIncomplete', 'firing', 'warning', {'kind': 'episode'})
        record('reliability-controller', 'self-1', 'ReliabilityIntakeRejections', 'firing', 'critical', {'detail': 'x'})
        assert incidents() == before and num('SELECT count(*) FROM smarter_private.reliability_intake_rejections') == 1
        assert num("SELECT count(*) FROM smarter_private.reliability_observations o JOIN public.operational_alert_events e ON e.id = o.inbox_event_id "
                   "WHERE e.source = 'reliability-controller'") == 0
        record('club-arena.post-deploy-e2e', 'ep3', 'PostDeployVerificationIncomplete', 'firing', 'critical', {'kind': 'episode'})
        assert incident('PostDeployVerificationIncomplete', "incident_class || ' ' || status") == 'release escalated'
        record('club-arena.post-deploy-e2e', 'ep3:resolved', 'PostDeployVerificationIncomplete', 'resolved', 'info', {'resolves': 'ep3'})
        assert incident('PostDeployVerificationIncomplete') == 'verifying'
        ok("info, test, informational, canary, development and the controller's own rows open nothing; a critical post-deploy episode is a release incident its info receipt resolves")

        # ---- a mirror row the inbox pre-marked informational is still an incident (production shapes, 2026-11-10).
        def drift(key, alertname, incident_id, metadata, severity='critical', status='firing', mark='informational'):
            payload = {'captured_at': '2026-11-10T14:37:01.788561+00:00', 'snapshot_kind': 'update_new', 'original_inbox_id': 373382,
                       'original_incident': {'id': incident_id, 'layer': 'reporting', 'source': alertname.replace('financial_alerts:', ''), 'status': 'open',
                                             'hand_id': None, 'table_id': None, 'tournament_id': None, 'metadata': metadata, 'severity': severity,
                                             'dedupe_key': 'k', 'occurrences': 35}}
            return int(sql("INSERT INTO public.operational_alert_events(source, event_key, alertname, status, severity, payload, investigation_status, investigation) "
                           f"VALUES ('drift-incidents-updates', '{key}', $a${alertname}$a$, '{status}', '{severity}', $a${json.dumps(payload)}$a$::jsonb, '{mark}', "
                           "'{\"rule\": \"mirror_duplicate_of_captured_original\"}') RETURNING id"))

        before = incidents()
        d1 = drift('c3f667d5-422b-47bb-9b1b-0898fa1c7003:5f93', 'fn_ca_cron_failure_watch', 'c3f667d5-422b-47bb-9b1b-0898fa1c7003',
                   {'jobname': 'ca-collusion-daily', 'fails_24h': 1, 'failed_in_a_row': 3})
        assert incidents() == before + 1 and incidents('fn_ca_cron_failure_watch') == 1
        assert incident('fn_ca_cron_failure_watch', "incident_class || ' ' || status || ' ' || severity || ' ' || source || ' ' || scope::text") \
            == 'database escalated critical drift-incidents {"jobname": "ca-collusion-daily"}'
        assert incident('fn_ca_cron_failure_watch', "latest_evidence->>'drift_incident_id'") == 'c3f667d5-422b-47bb-9b1b-0898fa1c7003'
        assert notes('fn_ca_cron_failure_watch') == 1 and num(f'SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id = {d1}') == 1
        drift('c3f667d5-422b-47bb-9b1b-0898fa1c7003:2995', 'fn_ca_cron_failure_watch', 'c3f667d5-422b-47bb-9b1b-0898fa1c7003', {'jobname': 'ca-collusion-daily'})
        assert incidents('fn_ca_cron_failure_watch') == 1 and incident('fn_ca_cron_failure_watch', 'occurrence_count') == '2'
        drift('aaaa1111:1', 'fn_ca_cron_failure_watch', 'aaaa1111', {'jobname': 'another-job'})
        assert incidents('fn_ca_cron_failure_watch') == 2
        ok('a critical drift mirror row the inbox pre-marked informational, with no inner alert, is an escalated incident per failing job that names its drift incident id')
        held = 'ServerTableEngine.authoritative_hand_semantic_refusal'
        record('financial-alerts-backfill', 'fa-77', held, 'firing', 'critical', {'original_event': {'id': 'fa-77', 'context': {'table_id': 'tbl-77', 'hand_id': 'h-1'}}})
        inner = incident(held, 'id')
        w = drift('dd-77:1', f'financial_alerts:{held}', 'dd-77', {'alert_id': 'fa-77', 'table_id': 'tbl-77'})
        assert incidents(f'financial_alerts:{held}') == 0 and incidents(held) == 1
        assert sql(f'SELECT incident_id FROM smarter_private.reliability_observations WHERE inbox_event_id = {w}') == inner
        assert incident(held, 'occurrence_count') == '2' and notes(held) == 1
        ok('a pre-marked wrapper that carries its inner record id is an observation on the inner incident, never a second incident')
        before = incidents()
        drift('info-2:1', 'ca_manual_adjustments', 'info-2', {}, severity='info', status='info')
        record('drift-incidents-updates', 'info-3:1', 'ca_manual_adjustments', 'info', 'info', {'original_incident': {'id': 'info-3'}})
        assert incidents() == before
        ok('a row whose status and severity are both info is still a record and opens nothing')

        # ---- grouping: scopes never merge, a hand id never splits, wrappers join by record id only.
        dark = 'fn_ca_tournament_dark_while_running'
        record('financial-alerts-backfill', 'a1', dark, 'firing', 'warning', {'original_event': {'id': 'a1', 'context': {'tournament_id': 'T1'}}})
        record('financial-alerts-backfill', 'w1', f'drift_incident:financial_alerts:{dark}', 'firing', 'warning',
               {'original_event': {'id': 'w1', 'context': {'alert_id': 'a1', 'tournament_id': 'T1', 'incident_id': 'd1'}}})
        record('drift-incidents-backfill', 'd1', f'financial_alerts:{dark}', 'firing', 'warning',
               {'original_incident': {'id': 'd1', 'metadata': {'alert_id': 'a1'}}})
        assert incidents(dark) == 1 and incident(dark, "occurrence_count || ' ' || scope::text") == '3 {"tournament_id": "T1"}'
        assert incidents(f'drift_incident:financial_alerts:{dark}') == 0 and incidents(f'financial_alerts:{dark}') == 0
        record('financial-alerts-backfill', 'a2', dark, 'firing', 'warning', {'original_event': {'id': 'a2', 'context': {'tournament_id': 'T2'}}})
        assert incidents(dark) == 2
        t1 = sql(f"SELECT id FROM smarter_private.reliability_incidents WHERE alertname = '{dark}' AND scope->>'tournament_id' = 'T1'")
        record('financial-alerts-backfill', 'w9', f'drift_incident:financial_alerts:{dark}', 'firing', 'warning',
               {'original_event': {'id': 'w9', 'context': {'tournament_id': 'T1'}}})
        assert incidents(f'drift_incident:financial_alerts:{dark}') == 1 and incidents(dark) == 2
        assert incident(f'drift_incident:financial_alerts:{dark}', 'related_incident_id') == t1
        assert sql(f"SELECT occurrence_count FROM smarter_private.reliability_incidents WHERE id = '{t1}'") == '3'
        ok('a wrapper that carries the inner record id joins that incident, another tournament is its own incident, and a wrapper with no id is linked, not merged')
        sql("INSERT INTO public.operational_alert_events(source, event_key, alertname, status, severity, payload, investigation_status) "
            f"VALUES ('drift-incidents-updates', 'd1:h', 'financial_alerts:{dark}', 'resolved', 'warning', "
            "'{\"original_incident\": {\"id\": \"d1\", \"metadata\": {\"alert_id\": \"a1\"}}}', 'informational')")
        assert sql(f"SELECT status FROM smarter_private.reliability_incidents WHERE id = '{t1}'") == 'verifying'
        assert sql(f"SELECT string_agg(DISTINCT status, ',') FROM smarter_private.reliability_incidents WHERE alertname LIKE '%{dark}' AND id <> '{t1}'") == 'investigating'
        ok('the resolved receipt of that record verifies its own incident and no other')
        pending = 'LightningHandHost.post_commit_obligations_pending'
        for n in range(3):
            record('financial-alerts-backfill', f'h{n}', pending, 'firing', 'warning',
                   {'original_event': {'id': f'h{n}', 'context': {'table_id': 'tbl-1' if n < 2 else 'tbl-2', 'hand_id': f'hand-{n}', 'lightning_hand_id': f'hand-{n}'}}})
        assert incidents(pending) == 2
        assert num(f"SELECT count(*) FROM smarter_private.reliability_incidents WHERE alertname = '{pending}' AND scope::text LIKE '%hand%'") == 0
        assert sql(f"SELECT occurrence_count FROM smarter_private.reliability_incidents WHERE alertname = '{pending}' AND scope->>'table_id' = 'tbl-1'") == '2'
        s1 = record('ca-stall-watch', 'table:t-1:1', 'TableStoppedDealing', 'firing', 'critical', {'table_id': 't-1', 'tournament_id': 'm-1'})
        s2 = record('ca-stall-watch', 'table:t-2:1', 'TableStoppedDealing', 'firing', 'critical', {'table_id': 't-2', 'tournament_id': 'm-1'})
        assert incidents('TableStoppedDealing') == 2
        sql(f"UPDATE public.operational_alert_events SET status = 'resolved' WHERE id = {s1}")
        assert sql("SELECT string_agg(status, ',' ORDER BY scope->>'table_id') FROM smarter_private.reliability_incidents WHERE alertname = 'TableStoppedDealing'") == 'verifying,escalated'
        am('v-4', 'HorseBrainOutsideDomainSurge', severity='warning', fingerprint='v4', labels={'variant': 'plo4'}, starts=now())
        am('v-6', 'HorseBrainOutsideDomainSurge', severity='warning', fingerprint='v6', labels={'variant': 'plo6'}, starts=now())
        am('v-6i', 'HorseBrainOutsideDomainSurge', severity='warning', fingerprint='v6i', labels={'variant': 'plo6', 'instance': 'engine-02:3000'}, starts=now())
        assert incidents('HorseBrainOutsideDomainSurge') == 3
        ok('two tables, two variants and two instances are separate incidents for every source, a hand id never splits one, and a table resolved in place verifies only itself')
        assert notes('TableStoppedDealing') == 1
        assert num("SELECT count(*) FROM smarter_private.reliability_notification_incidents ni JOIN smarter_private.reliability_incidents i ON i.id = ni.incident_id "
                   "WHERE i.alertname = 'TableStoppedDealing'") == 2
        ok('two escalated tables of one alert share one escalation notification')

        # ---- a warning escalates from the tick after 30 minutes still firing.
        am('w1', 'ClusterPassErrors', severity='warning', starts=now())
        assert incident('ClusterPassErrors') == 'investigating' and notes('ClusterPassErrors') == 0
        tick()
        assert incident('ClusterPassErrors') == 'investigating'
        sql("UPDATE smarter_private.reliability_incidents SET opened_at = clock_timestamp() - interval '31 minutes' WHERE alertname = 'ClusterPassErrors'")
        tick()
        assert incident('ClusterPassErrors', "status || ' ' || escalation_reason") == 'escalated no eligible recovery: still firing after 30 minutes'
        assert notes('ClusterPassErrors') == 1
        ok('a warning stays investigating, then the tick escalates it once it is still firing after 30 minutes')

        # ---- the controller's own failures: one incident per kind, no loop.
        assert incidents('ReliabilityIntakeRejections') == 1
        assert incident('ReliabilityIntakeRejections', "incident_class || ' ' || status || ' ' || source") == 'monitoring_self escalated reliability-controller'
        tick()
        tick()
        assert incidents('ReliabilityIntakeRejections') == 1 and incident('ReliabilityIntakeRejections', 'occurrence_count') == '1'
        assert notes('ReliabilityIntakeRejections') == 1
        assert sql("SELECT rejections_24h FROM smarter_private.reliability_v_controller_health") == '1'
        ok('an intake rejection is surfaced in the health view and raises exactly one monitoring_self incident, however many ticks run')

        # ---- the state machine.
        iid = incident('ClusterPassErrors', 'id')
        refused(f"SELECT smarter_private.reliability_transition('{iid}', 'recovered', 'skip ahead')", 'illegal reliability transition escalated -> recovered')
        refused(f"SELECT smarter_private.reliability_transition('{iid}', 'nonsense', 'x')", 'illegal reliability transition')
        closed = sql("SELECT id FROM smarter_private.reliability_incidents WHERE status = 'closed' LIMIT 1")
        refused(f"SELECT smarter_private.reliability_transition('{closed}', 'investigating', 'reopen')", 'illegal reliability transition closed -> investigating')
        stale_candidate = incident('SomethingNobodyClassified', 'id')
        refused(f"SELECT smarter_private.reliability_transition('{stale_candidate}', 'recovered', 'x')", 'illegal reliability transition')
        sql("INSERT INTO smarter_private.reliability_incidents (fingerprint, incident_class, title, severity, status, source, alertname, group_key, first_observed_at, last_observed_at, opened_at) "
            "VALUES ('manual-stale', 'unclassified', 't', 'warning', 'stale_unverified', 's', 'ManualStale', 'unclassified|ManualStale', now(), now(), now())")
        refused(f"SELECT smarter_private.reliability_transition('{incident('ManualStale', 'id')}', 'recovered', 'x')", 'illegal reliability transition stale_unverified -> recovered')
        refused(f"SELECT smarter_private.reliability_transition('{incident('ManualStale', 'id')}', 'verifying', 'x')", 'illegal reliability transition stale_unverified -> verifying')
        sql(f"SELECT smarter_private.reliability_transition('{incident('ManualStale', 'id')}', 'closed', 'operator closed it')")
        refused("UPDATE smarter_private.reliability_incident_events SET kind = 'x' WHERE true", 'append-only')
        refused("DELETE FROM smarter_private.reliability_incident_events WHERE true", 'append-only')
        ok('an illegal transition raises (stale_unverified can never become recovered or verifying), a legal one writes history, and history cannot be updated or deleted')

        # ---- two sessions at once: one transition.
        def together(first_sql, second_sql, hold=1.5):
            """first_sql runs and keeps its transaction open; second_sql runs meanwhile. Returns (first, second) results."""
            a = subprocess.Popen([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A',
                                  '-v', 'ON_ERROR_STOP=1', '-c', f'BEGIN; {first_sql}; SELECT pg_sleep({hold}); COMMIT;'],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            time.sleep(0.5)
            b = psql(['-c', second_sql])
            out, err = a.communicate(timeout=30)
            assert a.returncode == 0, err
            return out, b

        def events(i, to_status):
            return num(f"SELECT count(*) FROM smarter_private.reliability_incident_events WHERE incident_id = '{i}' AND to_status = '{to_status}'")

        _, b = together(f"SELECT smarter_private.reliability_transition('{iid}', 'contained', 'operator parked it', '{{\"by\": \"a\"}}')",
                        f"SELECT smarter_private.reliability_transition('{iid}', 'contained', 'operator parked it', '{{\"by\": \"b\"}}')")
        assert b.returncode != 0 and 'illegal reliability transition contained -> contained' in b.stderr, b.stderr
        assert events(iid, 'contained') == 1 and sql(f"SELECT detail->>'by' FROM smarter_private.reliability_incident_events WHERE incident_id = '{iid}' AND to_status = 'contained'") == 'a'
        ec = now("- interval '50 minutes'")
        am('cc-1', 'ClusterMovesExpiring', severity='warning', fingerprint='cc', starts=ec)
        am('cc-1r', 'ClusterMovesExpiring', severity='warning', status='resolved', fingerprint='cc', starts=ec, ends=now("- interval '40 minutes'"))
        cc = incident('ClusterMovesExpiring', 'id')
        assert incident('ClusterMovesExpiring') == 'verifying'
        sql("UPDATE smarter_private.reliability_incidents SET status_changed_at = clock_timestamp() - interval '31 minutes' WHERE alertname = 'ClusterMovesExpiring'")
        _, b = together('SELECT smarter_private.reliability_tick()', 'SELECT smarter_private.reliability_tick()')
        assert b.returncode == 0 and json.loads(b.stdout) == {'skipped': 'overlap'}, (b.stdout, b.stderr)
        assert incident('ClusterMovesExpiring') == 'recovered' and events(cc, 'recovered') == 1
        ok('two concurrent transitions of one incident write one transition, and two concurrent ticks run once')

        # ---- a backlog is worked 50 rows a tick; 55 tables are 55 incidents and one escalation.
        sql("SELECT public.fn_record_operational_alert('alertmanager', 'bl-' || g, 'SLOTableHasStalled', 'firing', 'critical', "
            "jsonb_build_object('alert', jsonb_build_object('fingerprint', 'bl' || g, 'startsAt', '2026-11-09T10:00:00Z', "
            "'labels', jsonb_build_object('alertname', 'SLOTableHasStalled', 'table_id', 'bl-' || lpad(g::text, 2, '0'))))) FROM generate_series(1, 55) g")
        assert incidents('SLOTableHasStalled') == 55 and notes('SLOTableHasStalled') == 1
        assert num("SELECT count(*) FROM smarter_private.reliability_notification_incidents ni JOIN smarter_private.reliability_incidents i ON i.id = ni.incident_id "
                   "WHERE i.alertname = 'SLOTableHasStalled'") == 55
        sql("SELECT public.fn_record_operational_alert('alertmanager', 'bl-r-' || g, 'SLOTableHasStalled', 'resolved', 'critical', "
            "jsonb_build_object('alert', jsonb_build_object('fingerprint', 'bl' || g, 'startsAt', '2026-11-09T10:00:00Z', 'endsAt', '2026-11-09T10:20:00Z', "
            "'labels', jsonb_build_object('alertname', 'SLOTableHasStalled', 'table_id', 'bl-' || lpad(g::text, 2, '0'))))) FROM generate_series(1, 55) g")
        assert num("SELECT count(*) FROM smarter_private.reliability_incidents WHERE alertname = 'SLOTableHasStalled' AND status = 'verifying'") == 55
        assert tick()['recovered'] == 0
        sql("UPDATE smarter_private.reliability_incidents SET status_changed_at = clock_timestamp() - interval '31 minutes' WHERE alertname = 'SLOTableHasStalled'")
        assert tick()['recovered'] == 50
        assert num("SELECT count(*) FROM smarter_private.reliability_incidents WHERE alertname = 'SLOTableHasStalled' AND status = 'recovered'") == 50
        assert tick()['recovered'] == 5 and tick()['recovered'] == 0
        ok('55 stalled tables are 55 incidents under one escalation, and a backlog of 55 is recovered 50 and then 5 over two ticks')

        # ---- delivery. Observe mode sent nothing so far.
        assert messages() == 0 and num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE state <> 'suppressed_observe'") == 0
        assert num('SELECT count(*) FROM public.push_outbox') == 0 and num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE push_state <> 'not_requested'") == 0
        ok('observe mode writes every escalation as suppressed_observe and sends no message and no push')
        sql("UPDATE smarter_private.reliability_settings SET notify_mode = 'critical_only' WHERE id")
        am('w2', 'ClusterPassSlow', severity='warning', starts=now())
        sql("UPDATE smarter_private.reliability_incidents SET opened_at = clock_timestamp() - interval '31 minutes' WHERE alertname = 'ClusterPassSlow'")
        tick()
        assert notes('ClusterPassSlow', state='suppressed_observe') == 1 and messages() == 0

        # ---- digest: 12 tables, one message, scopes counted, ten listed.
        for n in range(12):
            am(f'pt-{n}', 'PokerTablesFrozen', fingerprint=f'pt{n}', labels={'table_id': f'tbl-{n:02d}-0000-4000-8000-00000000{n:04d}'}, starts=now())
        assert incidents('PokerTablesFrozen') == 12 and notes('PokerTablesFrozen') == 1 and notes('PokerTablesFrozen', state='queued') == 1
        digest = sql("SELECT n.body FROM smarter_private.reliability_notifications n JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id WHERE i.alertname = 'PokerTablesFrozen'")
        scopes = [line for line in digest.split('\n') if line.startswith('Affected scopes: ')][0]
        assert scopes.startswith('Affected scopes: 12 (table_id=tbl-00') and scopes.count('table_id=') == 10 and scopes.endswith('; and more)'), scopes
        assert len(digest) <= 2000 and digest.split('\n')[0] == 'AI AGENT NEEDED' and digest.split('\n')[-1] == ACCEPTANCE, digest
        assert num("SELECT count(*) FROM smarter_private.reliability_incident_events WHERE kind = 'escalation_attached' AND detail->>'lead_incident_id' = "
                   "(SELECT n.incident_id::text FROM smarter_private.reliability_notifications n JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id WHERE i.alertname = 'PokerTablesFrozen')") == 11
        ok('twelve frozen tables are twelve incidents and ONE escalation whose body counts 12 scopes and lists ten, inside 2000 characters')

        # ---- two sessions deliver at once: one message.
        a_out, b = together('SELECT smarter_private.reliability_deliver_notifications(10)', 'SELECT smarter_private.reliability_deliver_notifications(10)')
        assert json.loads(a_out.strip().split('\n')[0])['sent'] == 1 and json.loads(b.stdout) == {'skipped': 'busy'}, (a_out, b.stdout)
        assert messages() == 1 and notes('PokerTablesFrozen', state='persisted_in_messenger') == 1
        assert json.loads(sql('SELECT smarter_private.reliability_deliver_notifications(10)'))['sent'] == 0 and messages() == 1
        row = json.loads(sql("SELECT jsonb_build_object('type', m.message_type, 'meta', m.media_metadata, 'sender', m.sender_id, 'same', m.id = n.message_id, "
                             "'content', m.content = n.body, 'request', m.request_id = n.request_id, 'incident', n.incident_id, 'conv', m.conversation_id, "
                             "'push_state', n.push_state, 'push_id', n.push_outbox_id) FROM public.social_messages m "
                             "JOIN smarter_private.reliability_notifications n ON n.message_id = m.id"))
        assert row['type'] == 'text' and row['sender'] == SENDER and row['same'] and row['content'] and row['request'], row
        assert row['meta'] == {'kind': 'reliability_incident', 'incident_id': row['incident'], 'notification_kind': 'escalation', 'handoff_version': 1}, row
        conv = sql('SELECT conversation_id FROM smarter_private.reliability_settings')
        assert conv == row['conv'] and num('SELECT count(*) FROM public.social_conversations') == 1
        assert sql(f"SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM public.social_conversation_participants WHERE conversation_id = '{conv}'") \
            == ','.join(sorted([OWNER, SENDER]))
        push = json.loads(sql('SELECT to_jsonb(p) FROM public.push_outbox p'))
        assert push['id'] == row['push_id'] and row['push_state'] == 'pending' and push['status'] == 'pending', (push, row)
        assert push['event'] == 'reliability_escalation' and push['tag'] == f"reliability:{row['incident']}" and push['recipient_user_id'] == OWNER, push
        assert push['url'] == f'/hub/messenger?conversation={conv}' and push['related_entity_id'] == row['incident'] and push['failure_reason'] is None, push
        assert push['title'].startswith('AI Agent Needed: PokerTablesFrozen'), push
        ok('two concurrent deliveries send one text message from the platform service identity into one dedicated conversation, with one pending push row the guard leaves alone')
        mid = sql("SELECT message_id FROM smarter_private.reliability_notifications WHERE state = 'persisted_in_messenger'")
        sql("UPDATE smarter_private.reliability_notifications SET state = 'queued', message_id = NULL WHERE state = 'persisted_in_messenger'")
        assert json.loads(sql('SELECT smarter_private.reliability_deliver_notifications(10)'))['sent'] == 1
        assert messages() == 1 and sql("SELECT message_id FROM smarter_private.reliability_notifications WHERE state = 'persisted_in_messenger'") == mid
        assert num('SELECT count(*) FROM public.messenger_send_requests') == 1 and num('SELECT count(*) FROM public.push_outbox') == 1
        ok('replaying the same request id returns the same single message and queues no second push')

        # ---- rate limit.
        sql("UPDATE smarter_private.reliability_settings SET notify_mode = 'all', max_dm_per_hour = 2 WHERE id")
        for i, name in enumerate(('EngineLivenessDead', 'EngineHandsStopped', 'DatabaseNotAnswering')):
            am(f'r{i}', name, starts=now())
        assert json.loads(sql('SELECT smarter_private.reliability_deliver_notifications(10)')) == {'sent': 1, 'rate_limited': 2, 'failed': 0, 'suppressed': 0}
        assert messages() == 2 and num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE state = 'rate_limited'") == 2
        assert tick()['delivery']['sent'] == 0 and messages() == 2
        sql("UPDATE smarter_private.reliability_settings SET max_dm_per_hour = 100 WHERE id")
        assert tick()['delivery']['sent'] == 2 and messages() == 4
        assert num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE state IN ('queued', 'rate_limited')") == 0
        assert num('SELECT count(*) FROM public.push_outbox') == 4 and num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE push_state = 'pending'") == 4
        ok('past max_dm_per_hour a notification is rate_limited, stays unsent with no push, and a later tick sends it once the hour allows')

        # ---- push_state follows what push_outbox records, and 'sent' is named for what it is.
        pid = sql("SELECT n.push_outbox_id FROM smarter_private.reliability_notifications n JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id "
                  "WHERE i.alertname = 'PokerTablesFrozen'")

        def mirrored():
            return sql(f"SELECT push_state || '|' || push_detail FROM smarter_private.reliability_notifications WHERE push_outbox_id = '{pid}'")

        sql(f"UPDATE public.push_outbox SET status = 'processing', claimed_at = now() WHERE id = '{pid}'")
        assert tick()['push_states_refreshed'] == 1 and mirrored() == 'claimed|processing'
        sql(f"UPDATE public.push_outbox SET status = 'failed', attempts = 1, failure_reason = 'no_active_subscription' WHERE id = '{pid}'")
        assert tick()['push_states_refreshed'] == 1 and mirrored() == 'failed|failed, attempts 1: no_active_subscription'
        sql(f"UPDATE public.push_outbox SET status = 'sent', attempts = 2, failure_reason = NULL, sent_at = '2026-11-10 07:28:15.244+00' WHERE id = '{pid}'")
        assert tick()['push_states_refreshed'] == 1
        assert mirrored() == 'provider_accepted|sent, attempts 2, accepted by the push provider at 2026-11-10T07:28:15Z (not proof of delivery to a device)'
        sql(f"UPDATE public.push_outbox SET status = 'failed' WHERE id = '{pid}'")
        assert tick()['push_states_refreshed'] == 0 and mirrored().startswith('provider_accepted|')
        assert num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE push_state IN ('delivered', 'read', 'sent')") == 0
        refused("UPDATE smarter_private.reliability_notifications SET push_state = 'delivered' WHERE true", 'reliability_notifications_push_state_check')
        other = sql("SELECT push_outbox_id FROM smarter_private.reliability_notifications WHERE push_state = 'pending' ORDER BY id LIMIT 1")
        sql(f"UPDATE public.push_outbox SET status = 'skipped', failure_reason = 'recipient_opted_out' WHERE id = '{other}'")
        assert tick()['push_states_refreshed'] == 1
        assert sql(f"SELECT push_state || '|' || push_detail FROM smarter_private.reliability_notifications WHERE push_outbox_id = '{other}'") == 'skipped|skipped: recipient_opted_out'
        assert num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE push_state = 'pending'") == 2
        ok('the tick mirrors push_outbox: processing is claimed, sent is provider_accepted (never delivered or read), failed carries its reason, skipped is skipped, and a terminal state is not re-read')

        # ---- a guard that diverts or refuses the push never undoes the message.
        sql("CREATE FUNCTION public.test_divert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
            "IF NEW.title LIKE '%EngineDown%' THEN NEW.status := 'skipped'; NEW.failure_reason := 'routed_to_production_alerts'; END IF; "
            "IF NEW.title LIKE '%PostgresDown%' THEN RAISE EXCEPTION 'push refused by a guard'; END IF; RETURN NEW; END $$; "
            "CREATE TRIGGER zz_test_divert BEFORE INSERT ON public.push_outbox FOR EACH ROW EXECUTE FUNCTION public.test_divert()")
        am('c1', 'EngineDown', starts=now())
        am('f1', 'PostgresDown', starts=now())
        assert json.loads(sql('SELECT smarter_private.reliability_deliver_notifications(10)'))['sent'] == 2 and messages() == 6
        assert sql("SELECT n.state || ' ' || n.push_state || ' ' || n.push_detail || ' ' || p.status FROM smarter_private.reliability_notifications n "
                   "JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id JOIN public.push_outbox p ON p.id = n.push_outbox_id WHERE i.alertname = 'EngineDown'") \
            == 'persisted_in_messenger diverted_by_guard skipped: routed_to_production_alerts skipped'
        assert sql("SELECT n.state || ' ' || n.push_state || ' ' || (n.push_outbox_id IS NULL)::text || ' ' || n.push_detail FROM smarter_private.reliability_notifications n "
                   "JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id WHERE i.alertname = 'PostgresDown'") \
            == 'persisted_in_messenger refused true P0001: push refused by a guard'
        assert sql('SELECT pushes_not_accepted FROM smarter_private.reliability_v_controller_health') == '2'
        sql('DROP TRIGGER zz_test_divert ON public.push_outbox')
        ok('a push the guard diverts is mirrored as diverted_by_guard, a push it refuses as refused, and both messages are still in Messenger')

        # ---- a failed send is kept and retried; its incident never announces itself through delivery.
        sql(f"INSERT INTO public.messenger_blocked(blocker_id, blocked_id) VALUES ('{OWNER}', '{SENDER}')")
        am('f2', 'ReplicationSlotInactive', starts=now())
        assert json.loads(sql('SELECT smarter_private.reliability_deliver_notifications(10)'))['failed'] == 1 and messages() == 6
        assert sql("SELECT state || ' ' || attempts || ' ' || push_state || ' ' || last_error FROM smarter_private.reliability_notifications n JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id "
                   "WHERE i.alertname = 'ReplicationSlotInactive'") == 'queued 1 not_requested 42501: Cannot Send To This Conversation'
        tick()
        tick()
        assert incidents('ReliabilityDeliveryFailing') == 1 and incident('ReliabilityDeliveryFailing', "incident_class || ' ' || status") == 'monitoring_self escalated'
        assert notes('ReliabilityDeliveryFailing') == 0
        assert num("SELECT count(*) FROM smarter_private.reliability_notification_incidents ni JOIN smarter_private.reliability_incidents i ON i.id = ni.incident_id WHERE i.alertname = 'ReliabilityDeliveryFailing'") == 0
        assert num("SELECT count(*) FROM smarter_private.reliability_incident_events e JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id "
                   "WHERE i.alertname = 'ReliabilityDeliveryFailing' AND e.kind = 'notification_withheld'") == 1
        assert sql('SELECT delivery_retries_pending FROM smarter_private.reliability_v_controller_health') == '1'
        sql('DELETE FROM public.messenger_blocked WHERE true')
        assert tick()['delivery']['sent'] == 1 and messages() == 7
        tick()
        assert incident('ReliabilityDeliveryFailing') == 'verifying' and incidents('ReliabilityDeliveryFailing') == 1
        ok('a refused send stays queued with its error and is sent later; delivery failure is one monitoring_self incident that enqueues no notification')

        # ---- the dedicated conversation is recreated only when a party left it.
        sql(f"DELETE FROM public.social_conversation_participants WHERE conversation_id = '{conv}' AND user_id = '{OWNER}'")
        am('c2', 'EngineScrapeDown', starts=now())
        assert json.loads(sql('SELECT smarter_private.reliability_deliver_notifications(10)'))['sent'] == 1
        conv2 = sql('SELECT conversation_id FROM smarter_private.reliability_settings')
        assert conv2 != conv and num('SELECT count(*) FROM public.social_conversations') == 2
        am('c3', 'EngineCoreSaturated', starts=now())
        assert json.loads(sql('SELECT smarter_private.reliability_deliver_notifications(10)'))['sent'] == 1
        assert sql('SELECT conversation_id FROM smarter_private.reliability_settings') == conv2 and num('SELECT count(*) FROM public.social_conversations') == 2
        ok('the controller conversation is reused while both parties are in it and replaced only when one has left')

        # ---- reminders: one per group per window, four per incident, then they stop.
        sent = messages()
        for round_number in range(1, 5):
            sql("UPDATE smarter_private.reliability_notifications SET created_at = created_at - interval '7 hours' WHERE group_key = 'table_liveness|EngineDown'")
            assert tick()['reminders'] == 1, round_number
            assert notes('EngineDown', kind='reminder', state='persisted_in_messenger') == round_number and messages() == sent + round_number
        assert sql("SELECT body FROM smarter_private.reliability_notifications WHERE kind = 'reminder' ORDER BY id LIMIT 1").split('\n')[:2] \
            == ['AI AGENT NEEDED', 'Reminder: this incident is still escalated.']
        assert tick()['reminders'] == 0
        for _ in range(2):
            sql("UPDATE smarter_private.reliability_notifications SET created_at = created_at - interval '7 hours' WHERE group_key = 'table_liveness|EngineDown'")
            assert tick()['reminders'] == 0
        assert notes('EngineDown', kind='reminder') == 4 and messages() == sent + 4
        assert sql("SELECT count(*) || ' ' || max(detail->>'reason') FROM smarter_private.reliability_incident_events e JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id "
                   "WHERE i.alertname = 'EngineDown' AND e.kind = 'reminders_stopped'") == '1 reminders stopped after 4; the incident is still escalated'
        ok('a critical incident that stays escalated is reminded once a window, four times, then one "reminders stopped" line and nothing more')

        # ---- validation message in observe mode.
        sql("UPDATE smarter_private.reliability_settings SET notify_mode = 'observe' WHERE id")
        sent = messages()
        v = json.loads(sql("SELECT smarter_private.reliability_send_validation_message('Stage B wiring check')"))
        assert v['state'] == 'persisted_in_messenger' and messages() == sent + 1, v
        assert sql(f"SELECT content FROM public.social_messages WHERE id = '{v['message_id']}'") == 'RELIABILITY CONTROLLER VALIDATION\nStage B wiring check'
        assert sql(f"SELECT n.push_state || ' ' || p.event || ' ' || p.title || ' ' || p.tag FROM smarter_private.reliability_notifications n JOIN public.push_outbox p ON p.id = n.push_outbox_id "
                   f"WHERE n.id = {v['notification_id']}") == f"pending reliability_escalation Reliability Controller Validation reliability:validation:{v['notification_id']}"
        am('o1', 'ClusterControllerStalled', starts=now())
        tick()
        assert notes('ClusterControllerStalled', state='suppressed_observe') == 1 and messages() == sent + 1
        ok('the validation message is sent and pushed in observe mode, labelled, while escalations stay suppressed')

        # ---- a source with no resolve protocol becomes stale_unverified, never recovered.
        record('sp-daily-digest', 'sp-digest:2026-11-08:stuck', 'DailyDigest.stuck_tournament', 'firing', 'critical', {'summary': 'x', 'tournament_id': 'T9'})
        assert incident('DailyDigest.stuck_tournament', "incident_class || ' ' || status") == 'tournament_lifecycle escalated'
        tick()
        assert incident('DailyDigest.stuck_tournament') == 'escalated'
        sql("UPDATE smarter_private.reliability_incidents SET last_firing_received_at = clock_timestamp() - interval '7 hours' WHERE alertname IN ('DailyDigest.stuck_tournament', 'ClusterControllerStalled')")
        aged = tick()
        assert aged['stale_unverified'] == 1 and aged['resolve_signal_missing'] == 0, aged
        assert incident('DailyDigest.stuck_tournament', "status || ' ' || closure_basis") == 'stale_unverified no_resolve_protocol'
        assert incident('ClusterControllerStalled') == 'escalated'
        sql("UPDATE smarter_private.reliability_incidents SET last_firing_received_at = clock_timestamp() - interval '25 hours' WHERE alertname = 'ClusterControllerStalled'")
        aged = tick()
        assert aged['stale_unverified'] == 0 and aged['resolve_signal_missing'] == 1, aged
        assert incident('ClusterControllerStalled', "status || ' ' || closure_basis") == 'stale_unverified resolve_signal_missing'
        assert num("SELECT count(*) FROM smarter_private.reliability_incident_events e JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id "
                   "WHERE i.alertname = 'ClusterControllerStalled' AND e.to_status IN ('verifying', 'recovered', 'closed')") == 0
        ok('an incident from a resolving source with no firing delivery and no resolved signal for 24 hours becomes stale_unverified (resolve_signal_missing), never recovered')
        record('sp-daily-digest', 'x:resolved', 'DailyDigest.stuck_tournament', 'resolved', 'critical', {'tournament_id': 'T9'})
        sql("UPDATE smarter_private.reliability_incidents SET status_changed_at = clock_timestamp() - interval '30 hours' WHERE alertname = 'DailyDigest.stuck_tournament'")
        tick()
        assert incident('DailyDigest.stuck_tournament') == 'stale_unverified'
        assert num("SELECT count(*) FROM smarter_private.reliability_incident_events e JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id "
                   "WHERE i.alertname = 'DailyDigest.stuck_tournament' AND e.to_status IN ('verifying', 'recovered', 'closed')") == 0
        record('sp-daily-digest', 'sp-digest:2026-11-09:stuck', 'DailyDigest.stuck_tournament', 'firing', 'critical', {'summary': 'x', 'tournament_id': 'T9'})
        assert incidents('DailyDigest.stuck_tournament') == 1
        assert incident('DailyDigest.stuck_tournament', "status || ' ' || recurrence_count") == 'escalated 1'
        ok('an incident fed only by a source that never resolves becomes stale_unverified after 6 hours, is never verifying or recovered, and a new firing returns it as the same incident, recurrence + 1')

        # ---- a failing tick step is recorded and the tick still completes.
        sql('ALTER TABLE smarter_private.reliability_sources_without_resolve RENAME TO reliability_sources_without_resolve_gone; ALTER TABLE smarter_private.reliability_runbooks RENAME TO reliability_runbooks_gone')
        failing = tick()
        assert [e['step'] for e in failing['errors']][:1] == ['escalate'] and 'recovered' in failing, failing
        health = json.loads(sql('SELECT to_jsonb(h) FROM smarter_private.reliability_v_controller_health h'))
        assert health['tick_step_errors'] >= 1 and health['heartbeat_age_seconds'] < 60, health
        bad2 = record('some-new-producer', 'u3', 'AnotherUnknownThing', 'firing', 'warning', {'detail': 'y'})
        assert num(f'SELECT count(*) FROM public.operational_alert_events WHERE id = {bad2}') == 1
        assert num(f'SELECT count(*) FROM smarter_private.reliability_intake_rejections WHERE inbox_event_id = {bad2}') == 1 and incidents('AnotherUnknownThing') == 0
        sql('ALTER TABLE smarter_private.reliability_sources_without_resolve_gone RENAME TO reliability_sources_without_resolve; ALTER TABLE smarter_private.reliability_runbooks_gone RENAME TO reliability_runbooks')
        assert tick()['errors'] == []
        assert incidents('ReliabilityIntakeRejections') == 1
        ok('a tick step that raises is recorded in the heartbeat and the health view, the other steps still run, and intake broken by the controller itself still commits the inbox row')

        # ---- authorization: browser roles reach nothing.
        relations = sql("SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE n.nspname = 'smarter_private' AND c.relname LIKE 'reliability\\_%' AND c.relkind IN ('r', 'v')").split(',')
        functions = sql("SELECT string_agg(p.oid::regprocedure::text, ';' ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                        "WHERE n.nspname = 'smarter_private' AND p.proname LIKE 'reliability\\_%'").split(';')
        assert sql("SELECT has_schema_privilege('anon', 'smarter_private', 'USAGE')::text || has_schema_privilege('authenticated', 'smarter_private', 'USAGE')::text") == 'truetrue'
        assert len(relations) == 15 and len(functions) == 22, (len(relations), len(functions))
        for role in ('anon', 'authenticated'):
            for relation in relations:
                refused(f'SET ROLE {role}; SELECT 1 FROM smarter_private.{relation} LIMIT 1', f'permission denied for')
                assert sql(f"SELECT has_table_privilege('{role}', 'smarter_private.{relation}', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')") == 'f', relation
            assert sql(f"SELECT has_sequence_privilege('{role}', 'smarter_private.reliability_notifications_id_seq', 'USAGE, SELECT, UPDATE')") == 'f'
            for function in functions:
                assert sql(f"SELECT has_function_privilege('{role}', '{function}', 'EXECUTE')") == 'f', function
            refused(f"SET ROLE {role}; SELECT smarter_private.reliability_tick()", 'permission denied')
            refused(f"SET ROLE {role}; SELECT smarter_private.reliability_send_validation_message('x')", 'permission denied')
            refused(f"SET ROLE {role}; SELECT smarter_private.reliability_transition(gen_random_uuid(), 'closed', 'x')", 'permission denied')
            refused(f"SET ROLE {role}; SELECT smarter_private.reliability_deliver_notifications(1)", 'permission denied')
            refused(f"SET ROLE {role}; INSERT INTO smarter_private.reliability_settings (id, owner_user_id, system_sender_id) VALUES (true, '{OWNER}', '{SENDER}')", 'permission denied')
            refused(f"SET ROLE {role}; UPDATE smarter_private.reliability_settings SET notify_mode = 'all' WHERE id", 'permission denied')
            refused(f"SET ROLE {role}; UPDATE smarter_private.reliability_incidents SET status = 'closed' WHERE true", 'permission denied')
            refused(f"SET ROLE {role}; INSERT INTO smarter_private.reliability_runbooks (key, version, enabled) VALUES ('x', 1, true)", 'permission denied')
            refused(f"SET ROLE {role}; DELETE FROM smarter_private.reliability_notifications WHERE true", 'permission denied')
            # Schema usage is open to browser roles, as on production; the objects themselves refuse.
            refused(f'SET ROLE {role}; SELECT 1 FROM smarter_private.reliability_incidents LIMIT 1', 'permission denied for table reliability_incidents')
            refused(f'SET ROLE {role}; SELECT 1 FROM smarter_private.reliability_v_controller_health', 'permission denied for view reliability_v_controller_health')
            refused(f"SET ROLE {role}; SELECT smarter_private.reliability_tick()", 'permission denied for function reliability_tick')
            refused(f"SET ROLE {role}; SELECT nextval('smarter_private.reliability_notifications_id_seq')", 'permission denied for sequence reliability_notifications_id_seq')
            refused(f"SET ROLE {role}; UPDATE smarter_private.reliability_settings SET notify_mode = 'all' WHERE id", 'permission denied for table reliability_settings')
        assert sql('SELECT notify_mode FROM smarter_private.reliability_settings') == 'observe'
        # ---- the authorized callers work: service_role and the object owner (the role pg_cron runs as).
        sequences = sql("SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE n.nspname = 'smarter_private' AND c.relname LIKE 'reliability\\_%' AND c.relkind = 'S'").split(',')
        assert len(sequences) == 5, sequences
        for role in ('anon', 'authenticated', 'service_role'):
            for sequence in sequences:
                assert sql(f"SELECT has_sequence_privilege('{role}', 'smarter_private.{sequence}', 'USAGE, SELECT, UPDATE')") == 'f', (role, sequence)
        assert num("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'smarter_private' "
                   "AND p.proname LIKE 'reliability\\_%' AND (p.proacl IS NULL OR has_function_privilege('public', p.oid, 'EXECUTE'))") == 0
        assert sql("SELECT string_agg(DISTINCT pg_get_userbyid(c.relowner), ',') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                   "WHERE n.nspname = 'smarter_private' AND c.relname LIKE 'reliability\\_%'") == 'postgres'
        definers = sql("SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                       "WHERE p.prosecdef AND ((n.nspname = 'smarter_private' AND p.proname LIKE 'reliability\\_%') OR p.proname = 'fn_reliability_incident_for_owner') "
                       "AND p.proconfig::text LIKE '%search_path=pg_catalog, smarter_private%'")
        assert definers == ('fn_reliability_incident_for_owner,reliability_deliver_notifications,reliability_send_validation_message,'
                            'reliability_tick,reliability_transition,reliability_trg_operational_alert_intake'), definers
        granted = sql("SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                      "WHERE n.nspname = 'smarter_private' AND p.proname LIKE 'reliability\\_%' AND has_function_privilege('service_role', p.oid, 'EXECUTE')")
        assert granted == 'reliability_deliver_notifications,reliability_send_validation_message,reliability_tick,reliability_transition', granted
        # service_role writes the inbox the way World Hub does; the intake trigger runs as its owner.
        sid = sql("SET ROLE service_role; SELECT public.fn_record_operational_alert('alertmanager', 'svc-1', 'MttBreakDidNotEnd', 'firing', 'critical', "
                  "'{\"alert\": {\"fingerprint\": \"svc1\", \"startsAt\": \"2026-11-10T01:00:00Z\", \"labels\": {\"alertname\": \"MttBreakDidNotEnd\"}}}'::jsonb)")
        assert incident('MttBreakDidNotEnd', "incident_class || ' ' || status") == 'tournament_lifecycle escalated'
        assert num(f'SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id = {sid}') == 1
        sql("SET ROLE service_role; SELECT public.fn_record_operational_alert('alertmanager', 'svc-1', 'MttBreakDidNotEnd', 'firing', 'critical', '{}'::jsonb)")
        assert incident('MttBreakDidNotEnd', 'occurrence_count') == '2'
        sql(f"SET ROLE service_role; UPDATE public.operational_alert_events SET status = 'resolved' WHERE id = {sid}")
        assert num(f"SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id = {sid} AND status = 'resolved'") == 1
        assert num('SELECT count(*) FROM smarter_private.reliability_intake_rejections') == 2
        # the same writes as the owner role, which is what a pg_cron job and a SECURITY DEFINER producer are.
        assert sql('SELECT current_user') == 'postgres' and sql("SELECT command FROM cron.job WHERE jobname = 'reliability-controller-tick'").count('reliability_tick()') == 1
        record('ca-stall-watch', 'table:cron-1:1', 'TableStoppedDealing', 'firing', 'warning', {'table_id': 'cron-1'})
        assert num("SELECT count(*) FROM smarter_private.reliability_incidents WHERE alertname = 'TableStoppedDealing' AND scope->>'table_id' = 'cron-1'") == 1
        assert json.loads(sql(sql("SELECT command FROM cron.job WHERE jobname = 'reliability-controller-tick'")))['errors'] == []
        # service_role: reads everything, runs the four entry points, writes nothing directly, reaches no internal function.
        for relation in relations:
            sql(f'SET ROLE service_role; SELECT count(*) FROM smarter_private.{relation}')
            assert sql(f"SELECT has_table_privilege('service_role', 'smarter_private.{relation}', 'INSERT, UPDATE, DELETE, TRUNCATE')") == 'f', relation
        assert json.loads(sql('SET ROLE service_role; SELECT smarter_private.reliability_deliver_notifications(1)'))['sent'] == 0
        park = incident('MttBreakDidNotEnd', 'id')
        sql(f"SET ROLE service_role; SELECT smarter_private.reliability_transition('{park}', 'investigating', 'service role reopened it')")
        assert incident('MttBreakDidNotEnd') == 'investigating'
        v2 = json.loads(sql("SET ROLE service_role; SELECT smarter_private.reliability_send_validation_message('service role check')"))
        assert v2['state'] == 'persisted_in_messenger', v2
        refused("SET ROLE service_role; UPDATE smarter_private.reliability_settings SET notify_mode = 'all' WHERE id", 'permission denied for table reliability_settings')
        refused("SET ROLE service_role; INSERT INTO smarter_private.reliability_runbooks (key, version, enabled) VALUES ('x', 1, true)", 'permission denied for table reliability_runbooks')
        refused(f"SET ROLE service_role; SELECT smarter_private.reliability_escalate('{park}', 'x')", 'permission denied for function reliability_escalate')
        refused(f"SET ROLE service_role; SELECT smarter_private.reliability_enqueue_notification('{park}', 'escalation')", 'permission denied for function reliability_enqueue_notification')
        refused("SET ROLE service_role; SELECT smarter_private.reliability_owner_conversation()", 'permission denied for function reliability_owner_conversation')
        ok('service_role and the owner role write the inbox and intake runs; service_role reads every object, runs tick, deliver, transition and validation, and reaches no table write and no internal function')

        # ---- the one browser surface: the owner reads one incident, nobody else does.
        target = sql("SELECT i.id FROM smarter_private.reliability_incidents i JOIN smarter_private.reliability_notifications n ON n.incident_id = i.id WHERE i.alertname = 'PokerTablesFrozen'")
        owner_fn = f"SELECT public.fn_reliability_incident_for_owner('{target}')"
        refused(f'SET ROLE anon; {owner_fn}', 'permission denied for function fn_reliability_incident_for_owner')
        refused(f"SET ROLE anon; SET request.jwt.claim.sub = '{OWNER}'; {owner_fn}", 'permission denied for function fn_reliability_incident_for_owner')
        refused(f'SET ROLE authenticated; {owner_fn}', 'Not Authorized')
        refused(f"SET ROLE authenticated; SET request.jwt.claim.sub = '{SENDER}'; {owner_fn}", 'Not Authorized')
        refused(f"SET ROLE authenticated; SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111'; {owner_fn}", 'Not Authorized')
        refused(f'SET ROLE service_role; {owner_fn}', 'permission denied for function fn_reliability_incident_for_owner')
        seen = json.loads(sql(f"SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}'; {owner_fn}"))
        assert seen['incident_id'] == target and seen['status'] == 'escalated' and seen['resolution_state'] == 'none' and seen['handoff_version'] == 1, seen
        assert seen['scope']['table_id'].startswith('tbl-') and seen['occurrence_count'] == 1 and seen['escalation_reason'] == 'no eligible recovery', seen
        assert seen['handoff'].split('\n')[0] == 'AI AGENT NEEDED' and 'Affected scopes: 12 (' in seen['handoff'] and seen['handoff'].split('\n')[-1] == ACCEPTANCE, seen
        assert 1 <= len(seen['events']) <= 20 and {'at', 'kind', 'from_status', 'to_status', 'reason'} == set(seen['events'][0]), seen['events']
        assert set(seen['labels']) <= {'alertname', 'severity', 'source', 'component', 'format', 'job', 'table_id', 'tournament_id', 'variant', 'instance'}, seen['labels']
        assert seen['first_inbox_event_id'] == seen['latest_inbox_event_id'] and 'payload' not in json.dumps(seen), seen
        assert sql(f"SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}'; SELECT public.fn_reliability_incident_for_owner(gen_random_uuid()) IS NULL") == 't'
        refused(f"SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}'; SELECT 1 FROM smarter_private.reliability_incidents LIMIT 1", 'permission denied')
        ok('public.fn_reliability_incident_for_owner answers the owner with the incident, its events and the handoff text, and refuses anon, other authenticated users and service_role')
        refused("SET request.jwt.claim.role = 'authenticated'; SELECT smarter_private.reliability_tick()", 'service-only')
        assert json.loads(sql("SET ROLE service_role; SELECT smarter_private.reliability_tick()"))['errors'] == []
        ok('anon and authenticated cannot select any reliability table or view, execute any reliability function, or insert, update or delete; service_role can tick')

        # ---- health, schedule, second install.
        health = json.loads(sql('SELECT to_jsonb(h) FROM smarter_private.reliability_v_controller_health h'))
        assert health['heartbeat_age_seconds'] is not None and health['heartbeat_age_seconds'] < 60 and health['tick_count'] > 10, health
        assert health['rejections_24h'] == 2 and health['mutation_paused'] is True and health['notify_mode'] == 'observe', health
        assert health['queued_notifications'] == 0 and health['tick_step_errors'] == 0 and health['failed_notifications'] == 0, health
        assert num('SELECT count(*) FROM smarter_private.reliability_v_open_incidents') == num("SELECT count(*) FROM smarter_private.reliability_incidents WHERE status <> 'closed'")
        assert sql("SELECT schedule || ' ' || (command LIKE '%pg_try_advisory_lock%smarter_private.reliability_tick()%')::text FROM cron.job "
                   "WHERE jobname = 'reliability-controller-tick'") == '* * * * * true'
        assert num("SELECT count(*) FROM smarter_private.reliability_runbooks WHERE enabled") == 0
        assert num("SELECT count(*) FROM (SELECT fingerprint FROM smarter_private.reliability_incidents WHERE status <> 'closed' GROUP BY 1 HAVING count(*) > 1) d") == 0
        assert num("SELECT count(*) FROM (SELECT request_id FROM public.social_messages GROUP BY 1 HAVING count(*) > 1) d") == 0
        # ---- leaving observe mode sends nothing about the past; the next new critical sends once.
        assert sql('SELECT notify_mode FROM smarter_private.reliability_settings') == 'observe'
        sent, pushes = messages(), num('SELECT count(*) FROM public.push_outbox')
        am('act-1', 'TournamentFleetUnserved', fingerprint='act1', labels={'instance': 'engine-a'}, starts=now())
        am('act-2', 'SpinPrizeUnpaid', fingerprint='act2', starts=now())
        groups = "('tournament_lifecycle|TournamentFleetUnserved', 'money_integrity|SpinPrizeUnpaid')"
        assert num(f"SELECT count(*) FROM smarter_private.reliability_notifications WHERE group_key IN {groups} AND state = 'suppressed_observe'") == 2
        group_rows = num(f'SELECT count(*) FROM smarter_private.reliability_notifications WHERE group_key IN {groups}')
        sql("UPDATE smarter_private.reliability_settings SET notify_mode = 'critical_only' WHERE id")
        sql(f"UPDATE smarter_private.reliability_notifications SET created_at = created_at - interval '7 hours' WHERE group_key IN {groups}")
        result = tick()
        assert result['reminders'] == 0 and result['delivery']['sent'] == 0, result
        assert messages() == sent and num('SELECT count(*) FROM public.push_outbox') == pushes
        assert num(f'SELECT count(*) FROM smarter_private.reliability_notifications WHERE group_key IN {groups}') == group_rows
        assert num("SELECT count(*) FROM smarter_private.reliability_notifications WHERE state IN ('queued', 'rate_limited')") == 0
        ok('escalations suppressed in observe mode, then a switch to critical_only and a tick past the reminder window: zero messages, zero pushes, no reminder')
        am('act-3', 'TournamentFleetUnserved', fingerprint='act3', labels={'instance': 'engine-b'}, starts=now())
        fresh = sql("SELECT n.state || ' ' || n.kind FROM smarter_private.reliability_notifications n JOIN smarter_private.reliability_incidents i ON i.id = n.incident_id "
                    "WHERE i.alertname = 'TournamentFleetUnserved' AND i.scope->>'instance' = 'engine-b'")
        assert fresh == 'queued escalation', fresh
        assert tick()['delivery']['sent'] == 1 and messages() == sent + 1 and num('SELECT count(*) FROM public.push_outbox') == pushes + 1
        assert tick()['delivery']['sent'] == 0 and messages() == sent + 1
        ok('the first new critical incident after the switch, in a group whose earlier escalation was suppressed, sends exactly one message and one push')

        r = psql(['-f', str(MIGRATION)])
        assert r.returncode != 0, 'a second install must be refused'
        ok('the health view reports the heartbeat and the queue, no fingerprint is open twice, no request id was sent twice, the job is scheduled once, and a second install is refused')

        # ---- the escalation drill and the class corrections (20261111133716), over every installed controller migration.
        for path in INSTALLED_AFTER:
            r = psql(['-f', str(path)])
            assert r.returncode == 0, (path.name, r.stderr)
        latch = ' '.join(re.search(r'^DO \$%s\$.*?^\$%s\$;' % (b, b), LATCH_FIX.read_text(), re.M | re.S).group(0) for b in ('pre', 'latch'))
        r = psql([], f'BEGIN; {latch} COMMIT;')
        assert r.returncode == 0, r.stderr
        assert "CLEARED ON A TERMINAL STATUS (20261110224707)" in sql("SELECT pg_get_functiondef('smarter_private.reliability_transition(uuid,text,text,jsonb)'::regprocedure)")
        r = psql(['-f', str(DRILL)])
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', DRILL.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'drill live proof must hold after install'
        r = psql(['-f', str(DRILL)])
        assert r.returncode != 0, 'a second install of the drill must be refused'
        corrected = {('financial-alerts-backfill', 'LightningHandHost.post_commit_obligations_pending', 'critical'): 'money_integrity warning',
                     ('financial-alerts-updates', 'ServerTableEngine.post_commit_obligations_pending', 'critical'): 'money_integrity warning',
                     ('migration-install-watch', 'MergedMigrationNotInstalled', 'critical'): 'release critical',
                     ('engine-alerts-backfill', 'OpenClawJobStale', 'warning'): 'monitoring_self warning',
                     ('workers.deploy-error-poll', 'VercelDeploymentFailed', 'critical'): 'release critical',
                     ('workers.deploy-error-poll', 'AutofixRebuildFailed', 'critical'): 'release critical',
                     ('workers.deploy-error-poll', 'DeploymentMonitorUnavailable', 'critical'): 'monitoring_self critical',
                     ('workers.deploy-error-poll', 'SomethingElse', 'critical'): 'unclassified warning',
                     ('mac-studio-git-maintenance', 'Git Maintenance Not Keeping Up', 'warning'): 'unclassified warning',
                     ('financial-alerts-backfill', 'union_promo_duplicate_2026_11_07', 'warning'): 'unclassified warning',
                     ('midway-weekly-payout-followup', 'engine_release_stall_check_uuid_into_bigint', 'warning'): 'unclassified warning',
                     ('reliability-drill', 'Drill No Action Needed d-anything', 'critical'): 'reliability_drill critical'}
        for (source, name, severity), expected in corrected.items():
            got = sql(f"SELECT c.incident_class || ' ' || c.default_severity || ' ' || c.is_incident FROM smarter_private.reliability_classify('{source}', $a${name}$a$, '{severity}', false) c")
            assert got == expected + ' true', (source, name, got, expected)
        ok('the corrected producers land on their read classes (post-commit envelopes money_integrity, a merged migration not installed and a failed '
           'World Hub deployment release, a stale Open Claw job and a blind deploy monitor monitoring_self), the three unread families stay unclassified, '
           'and every one is still an incident')

        assert sql('SELECT notify_mode || mutation_paused::text FROM smarter_private.reliability_settings') == 'critical_onlytrue'
        # Earlier sections sent many messages inside this hour; the hourly cap is not what the drill proves.
        sql('UPDATE smarter_private.reliability_settings SET max_dm_per_hour = 1000 WHERE id')
        drill = lambda action, drill_id: json.loads(sql(f"SET ROLE service_role; SELECT public.fn_reliability_drill('{action}', '{drill_id}')"))
        for role in ('anon', 'authenticated'):
            refused(f"SET ROLE {role}; SELECT public.fn_reliability_drill('start', 'drill-native-1')", 'permission denied for function fn_reliability_drill')
        refused("SET request.jwt.claim.role = 'authenticated'; SELECT public.fn_reliability_drill('start', 'drill-native-1')", 'service-only')
        refused("SET ROLE authenticated; SELECT 1 FROM smarter_private.reliability_drills", 'permission denied')
        refused("SET ROLE service_role; SELECT public.fn_reliability_drill('start', 'BAD ID')", 'RELIABILITY_DRILL_INVALID')
        assert num("SELECT count(*) FROM public.operational_alert_events WHERE source = 'reliability-drill'") == 0
        sent, pushes = messages(), num('SELECT count(*) FROM public.push_outbox')
        started = drill('start', 'drill-native-1')
        did = started['incident_id']
        assert started['idempotent'] is False and did, started
        assert sql(f"SELECT investigation_status || ' ' || status || ' ' || severity FROM public.operational_alert_events WHERE id = {started['firing_inbox_event_id']}") == 'new firing critical'
        assert sql(f"SELECT incident_class || ' ' || status || ' ' || severity || ' ' || escalation_state || ' ' || title FROM smarter_private.reliability_incidents WHERE id = '{did}'") \
            == 'reliability_drill escalated critical escalated Drill No Action Needed drill-native-1 (reliability drill)'
        assert sql(f"SELECT state || ' ' || kind FROM smarter_private.reliability_notifications WHERE incident_id = '{did}'") == 'queued escalation'
        assert messages() == sent, 'the drill sends nothing itself; the tick delivers the outbox'
        assert drill('verify', 'drill-native-1')['delivered'] is False
        result = tick()
        assert result['delivery']['sent'] == 1 and messages() == sent + 1 and num('SELECT count(*) FROM public.push_outbox') == pushes + 1, result
        body = sql(f"SELECT m.content FROM public.social_messages m JOIN smarter_private.reliability_notifications n ON n.message_id = m.id WHERE n.incident_id = '{did}'")
        for needle in ('Title: Drill No Action Needed drill-native-1 (reliability drill)', 'Severity: CRITICAL',
                       'Rule summary: This is a Reliability Controller escalation drill (drill drill-native-1). No action is needed',
                       'Affected scopes: 1 (run=drill-native-1)'):
            assert needle in body, (needle, body)
        push = sql(f"SELECT title || ' | ' || event || ' | ' || status FROM public.push_outbox WHERE related_entity_id = '{did}'")
        assert push == 'AI Agent Needed: Drill No Action Needed drill-native-1 (reliability drill) | reliability_escalation | pending', push
        pending = drill('verify', 'drill-native-1')
        assert pending['delivered'] is False and pending['notification']['push_state'] == 'pending' and pending['message']['says_drill'] is True, pending
        # The push dispatcher (outside the database) accepts the row; the next tick mirrors it.
        sql(f"UPDATE public.push_outbox SET status = 'sent', attempts = 1, sent_at = clock_timestamp() WHERE related_entity_id = '{did}'")
        tick()
        seen = drill('verify', 'drill-native-1')
        assert seen['delivered'] is True and seen['resolved'] is False and seen['pass'] is False, seen
        assert seen['escalation_notifications'] == 1 and seen['messages_for_request'] == 1 and seen['push_rows'] == 1, seen
        assert seen['notification']['state'] == 'persisted_in_messenger' and seen['notification']['push_state'] == 'provider_accepted', seen
        assert seen['message']['to_owner_conversation'] is True and seen['message']['sender_id'] == SENDER, seen
        ok('a drill enters through fn_record_operational_alert, opens one critical reliability_drill incident, escalates once, and the tick sends '
           'exactly one Messenger DM (it says drill and no action needed) and one push in critical_only; verify reads back the DM and the push')

        inbox = num("SELECT count(*) FROM public.operational_alert_events")
        again = drill('start', 'drill-native-1')
        assert again['idempotent'] is True and again['incident_id'] == did, again
        assert num("SELECT count(*) FROM public.operational_alert_events") == inbox and tick()['delivery']['sent'] == 0 and messages() == sent + 1
        refused("SET ROLE service_role; SELECT public.fn_reliability_drill('start', 'drill-native-2')", 'RELIABILITY_DRILL_REFUSED')
        assert num("SELECT count(*) FROM public.operational_alert_events") == inbox and num('SELECT count(*) FROM smarter_private.reliability_drills') == 1
        ok('a repeated drill id writes nothing and sends nothing; a new drill inside 10 minutes is refused before it reaches the inbox')

        resolved = drill('resolve', 'drill-native-1')
        assert resolved['idempotent'] is False, resolved
        assert sql(f"SELECT status FROM smarter_private.reliability_incidents WHERE id = '{did}'") == 'verifying'
        assert sql(f"SELECT escalation_state FROM smarter_private.reliability_incidents WHERE id = '{did}'") == 'escalated'
        done = drill('verify', 'drill-native-1')
        assert done['pass'] is True and done['resolved_disposition'] == 'applied', done
        assert drill('resolve', 'drill-native-1')['idempotent'] is True
        assert num(f"SELECT count(*) FROM public.operational_alert_events WHERE source = 'reliability-drill'") == 2
        tick(now("+ interval '31 minutes'"))
        assert sql(f"SELECT status || ' ' || escalation_state FROM smarter_private.reliability_incidents WHERE id = '{did}'") == 'recovered none'
        assert messages() == sent + 1 and num(f"SELECT count(*) FROM smarter_private.reliability_notifications WHERE incident_id = '{did}'") == 1
        ok('the drill resolves through a producer-style resolved row: the incident verifies, the tick confirms recovered and clears the escalation, '
           'verify reports PASS, a repeated resolve writes nothing, and no further message is sent')

        sql("UPDATE smarter_private.reliability_drills SET requested_at = requested_at - interval '11 minutes'")
        second = drill('start', 'drill-native-2')
        assert second['incident_id'] and second['incident_id'] != did, second
        assert num(f"SELECT count(*) FROM smarter_private.reliability_notification_incidents WHERE incident_id = '{second['incident_id']}'") == 1
        assert tick()['delivery']['sent'] == 1 and messages() == sent + 2
        drill('resolve', 'drill-native-2')
        assert drill('verify', 'drill-native-2')['resolved'] is True
        ok('a second drill ten minutes later is its own incident and its own message, never attached to the first drill digest')
        # ---- the per-class hold-down and the found producers (20261111222330), over every installed controller migration.
        record('mac-studio-git-maintenance', 'pack-backlog:/pre:1', 'Git Maintenance Not Keeping Up', 'firing', 'warning', {'host': 'm', 'repo': '/pre', 'pack_files': 1406, 'limit': 400})
        assert sql("SELECT incident_class || ' ' || status FROM smarter_private.reliability_incidents WHERE source = 'mac-studio-git-maintenance' AND status <> 'closed'") == 'unclassified investigating'
        r = psql(['-f', str(HOLD_DOWN)])
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', HOLD_DOWN.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'hold-down live proof must hold after install'
        r = psql(['-f', str(HOLD_DOWN)])
        assert r.returncode != 0 and 'RELIABILITY_HOLD_DOWN_ALREADY_INSTALLED' in r.stderr, 'a second install must be refused'
        refused("UPDATE smarter_private.reliability_alert_classes SET hold_down_flaps = 3 WHERE alertname_pattern = 'ClusterPassErrors'", 'reliability_alert_classes_hold_down_flaps')
        refused("UPDATE smarter_private.reliability_alert_classes SET hold_down_seconds = 5 WHERE alertname_pattern = 'ClusterPassErrors'", 'reliability_alert_classes_hold_down_seconds_range')
        refused("UPDATE smarter_private.reliability_alert_classes SET quiet_window_seconds = 0 WHERE alertname_pattern = 'ClusterPassErrors'", 'reliability_alert_classes_quiet_window_range')
        for role in ('anon', 'authenticated', 'service_role'):
            assert sql(f"SELECT has_function_privilege('{role}', 'smarter_private.reliability_episode_count(text,timestamptz)', 'EXECUTE')") == 'f', role
        got = sql("SELECT string_agg(c.hold_down_seconds || '/' || c.hold_down_flaps || '/' || c.hold_down_flap_window_seconds || '/' || c.quiet_window_seconds, ' ') "
                  "FROM (SELECT (smarter_private.reliability_classify('financial-alerts-backfill', 'LightningHandHost.post_commit_obligations_pending', 'critical', false)).* "
                  "UNION ALL SELECT (smarter_private.reliability_classify('alertmanager', 'DatabaseRepliesLost', 'warning', false)).*) c")
        assert got == '1200/5/3600/1800 900/6/3600/1800', got
        assert sql("SELECT count(*) FROM smarter_private.reliability_alert_classes WHERE hold_down_seconds IS NOT NULL") == '2'
        ok('the hold-down installs once over production-identical bodies, its bounds are constraints, its helper is reachable by no role, '
           'and exactly the two flagged names carry the measured numbers')

        PC = 'LightningHandHost.post_commit_obligations_pending'
        def pc(key, status='firing', starts=None, ends=None, table='hd-1'):
            return am(key, PC, status=status, severity='critical', fingerprint='fp-' + table, starts=starts, ends=ends, labels={'table_id': table})
        def held(table, field="status || ' ' || escalation_state"):
            return sql(f"SELECT {field} FROM smarter_private.reliability_incidents WHERE alertname = $a${PC}$a$ AND scope->>'table_id' = '{table}' AND status <> 'closed'")
        def kinds(table, kind):
            return num("SELECT count(*) FROM smarter_private.reliability_incident_events e JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id "
                       f"WHERE i.alertname = $a${PC}$a$ AND i.scope->>'table_id' = '{table}' AND e.kind = '{kind}'")
        tick()
        sent, base, base_sent = messages(), notes(PC), notes(PC, state='persisted_in_messenger')
        # fire: held, nothing sent; resolve: verifying; quiet window: recovered; nothing ever sent.
        f1 = now()
        pc('hd1-a', starts=f1)
        assert held('hd-1') == 'investigating none' and kinds('hd-1', 'hold_down') == 1, held('hd-1')
        assert held('hd-1', "class_rule_id IS NOT NULL AND firing_since IS NOT NULL") == 't'
        pc('hd1-a-again', starts=f1)
        assert held('hd-1') == 'investigating none' and kinds('hd-1', 'hold_down') == 1
        tick(now("+ interval '19 minutes'"))
        assert held('hd-1') == 'investigating none', 'a critical inside its 1200 s hold-down is not escalated by the tick'
        pc('hd1-a-resolved', status='resolved', starts=f1, ends=now())
        assert held('hd-1', "status || ' ' || coalesce(firing_since::text, 'cleared')") == 'verifying cleared'
        tick(now("+ interval '29 minutes'"))
        assert held('hd-1') == 'verifying none'
        tick(now("+ interval '31 minutes'"))
        assert sql(f"SELECT status FROM smarter_private.reliability_incidents WHERE alertname = $a${PC}$a$ AND scope->>'table_id' = 'hd-1'") == 'recovered'
        assert notes(PC) == base and tick()['delivery']['sent'] == 0
        ok('fire then resolve inside the hold-down: the critical post-commit incident is held (one hold_down event, nothing sent, the tick leaves it), '
           'verifies on the resolve, recovers after the class quiet window, and no message is ever sent')

        # flap: every episode resolves inside the hold-down, but the fifth inside an hour escalates once.
        for n in range(2, 6):
            fs = now()
            pc(f'hd1-f{n}', starts=fs)
            if n < 5:
                assert held('hd-1') == 'investigating none', (n, held('hd-1'))
                pc(f'hd1-f{n}-resolved', status='resolved', starts=fs, ends=now())
                assert held('hd-1') == 'verifying none', n
        assert held('hd-1', "status || ' ' || escalation_reason") == 'escalated no eligible recovery: fired 5 times in 3600 seconds (hold-down)'
        assert held('hd-1', 'recurrence_count') == '1' and kinds('hd-1', 'refire') == 3 and kinds('hd-1', 'escalation') == 1
        tick()
        assert notes(PC) == base + 1 and notes(PC, state='persisted_in_messenger') == base_sent + 1, (base, base_sent, notes(PC))
        ok('flapping: four episodes that each resolve stay held and verifying with nothing sent; the fifth inside 3600 s escalates once and sends one message')

        # held long enough: at intake when the delivery itself shows it, and from the tick when no further delivery comes.
        pc('hd2-a', starts=now("- interval '21 minutes'"), table='hd-2')
        assert held('hd-2', "status || ' ' || escalation_reason") == 'escalated no eligible recovery: still firing after 1200 seconds (hold-down)'
        s3 = now()
        pc('hd3-a', starts=s3, table='hd-3')
        assert held('hd-3') == 'investigating none'
        tick(now("+ interval '19 minutes'"))
        assert held('hd-3') == 'investigating none'
        tick(now("+ interval '21 minutes'"))
        assert held('hd-3', "status || ' ' || escalation_reason") == 'escalated no eligible recovery: still firing after 1200 seconds (hold-down)'
        # a refire while verifying after escalation goes back to escalated, as before; recovery clears it.
        pc('hd3-a-resolved', status='resolved', starts=s3, ends=now(), table='hd-3')
        assert held('hd-3') == 'verifying escalated'
        tick(now("+ interval '31 minutes'"))
        assert sql("SELECT status || ' ' || escalation_state FROM smarter_private.reliability_incidents WHERE scope->>'table_id' = 'hd-3'") == 'recovered none'
        ok('a held critical that stays firing escalates: at intake when its delivery has been firing 1200 s, from the tick at 1200 s when no delivery comes, '
           'and never before; recovery after the quiet window clears the escalation')

        # the warning name: 30 minutes open is not enough when the current episode is young; 900 s of continuous firing is.
        DB = 'DatabaseRepliesLost'
        am('db-1', DB, severity='warning', fingerprint='db-1', starts=now(), labels={'instance': 'hd-db'})
        dbi = lambda f="status || ' ' || escalation_state": sql(f"SELECT {f} FROM smarter_private.reliability_incidents WHERE alertname = '{DB}' AND scope->>'instance' = 'hd-db'")
        sql(f"UPDATE smarter_private.reliability_incidents SET opened_at = clock_timestamp() - interval '40 minutes', firing_since = clock_timestamp() - interval '5 minutes' WHERE alertname = '{DB}' AND scope->>'instance' = 'hd-db'")
        tick()
        assert dbi() == 'investigating none', 'an old flapping warning whose current episode is 5 minutes old stays held'
        sql(f"UPDATE smarter_private.reliability_incidents SET firing_since = clock_timestamp() - interval '16 minutes' WHERE alertname = '{DB}' AND scope->>'instance' = 'hd-db'")
        tick()
        assert dbi("status || ' ' || escalation_reason") == 'escalated no eligible recovery: still firing after 900 seconds (hold-down)'
        ok('a DatabaseRepliesLost warning open 40 minutes is held while its current episode is younger than 900 s and escalates once it has fired 900 s')

        # a class row's own quiet window, and every other class unchanged.
        sql("INSERT INTO smarter_private.reliability_alert_classes (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, "
            "escalate_immediately, is_incident, hold_down_seconds, quiet_window_seconds, note) VALUES (5, 'alertmanager', 'HoldDownQuietProbe', '%', 'cluster', 'warning', "
            "false, true, 600, 600, 'native test only')")
        qs = now()
        am('q-1', 'HoldDownQuietProbe', severity='critical', fingerprint='q-1', starts=qs)
        assert incident('HoldDownQuietProbe') == 'investigating'
        am('q-1-resolved', 'HoldDownQuietProbe', status='resolved', severity='critical', fingerprint='q-1', starts=qs, ends=now())
        tick(now("+ interval '9 minutes'"))
        assert incident('HoldDownQuietProbe') == 'verifying'
        tick(now("+ interval '11 minutes'"))
        assert incident('HoldDownQuietProbe') == 'recovered'
        assert sql("SELECT e.detail->>'reason' FROM smarter_private.reliability_incident_events e JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id "
                   "WHERE i.alertname = 'HoldDownQuietProbe' AND e.kind = 'quiet_window_passed'") == 'the alert stayed resolved for 600 seconds (class quiet window)'
        am('plain-1', 'MttFleetNotDealing', severity='critical', fingerprint='plain-1', starts=now(), labels={'instance': 'plain-1'})
        assert incident('MttFleetNotDealing', "status || ' ' || escalation_reason") == 'escalated no eligible recovery'
        s4 = now()
        am('plain-2', 'ClusterTickingNothing', severity='warning', fingerprint='plain-2', starts=s4, labels={'instance': 'plain-2'})
        sql("UPDATE smarter_private.reliability_incidents SET opened_at = clock_timestamp() - interval '31 minutes' WHERE alertname = 'ClusterTickingNothing'")
        tick()
        assert incident('ClusterTickingNothing', "status || ' ' || escalation_reason") == 'escalated no eligible recovery: still firing after 30 minutes'
        am('plain-2-resolved', 'ClusterTickingNothing', status='resolved', severity='warning', fingerprint='plain-2', starts=s4, ends=now(), labels={'instance': 'plain-2'})
        tick(now("+ interval '29 minutes'"))
        assert incident('ClusterTickingNothing') == 'verifying'
        tick(now("+ interval '31 minutes'"))
        assert incident('ClusterTickingNothing') == 'recovered'
        assert sql("SELECT e.detail::text FROM smarter_private.reliability_incident_events e JOIN smarter_private.reliability_incidents i ON i.id = e.incident_id "
                   "WHERE i.alertname = 'ClusterTickingNothing' AND e.kind = 'quiet_window_passed'") == '{"kind": "quiet_window_passed", "reason": "the alert stayed resolved for 30 minutes"}'
        ok('a class row with its own quiet window recovers after it; a class without a hold-down still escalates a critical on arrival, a warning after 30 minutes, '
           'and recovers after 30 quiet minutes with the Stage B wording')

        # closure evidence, and the found producers.
        cid = incident('MttFleetNotDealing', 'id')
        sql(f"SELECT smarter_private.reliability_transition('{cid}', 'closed', 'closed with evidence', jsonb_build_object('closure_basis', 'producer_never_resolves_successor_ready'))")
        assert sql(f"SELECT status || ' ' || closure_basis || ' ' || escalation_state FROM smarter_private.reliability_incidents WHERE id = '{cid}'") == 'closed producer_never_resolves_successor_ready none'
        before = incidents()
        record('mac-studio-git-maintenance', 'pack-backlog:/repo:hd', 'Git Maintenance Not Keeping Up', 'firing', 'warning', {'host': 'm', 'repo': '/repo', 'pack_files': 1406, 'limit': 400})
        record('financial-alerts-backfill', 'promo-hd', 'union_promo_duplicate_2026_11_07', 'firing', 'warning', {'labels': {}})
        record('midway-weekly-payout-followup', 'note-hd', 'engine_release_stall_check_uuid_into_bigint', 'firing', 'warning', {'owner': 'x'})
        assert incidents() == before
        assert sql("SELECT count(*) FROM smarter_private.reliability_incidents WHERE source = 'mac-studio-git-maintenance' AND status <> 'closed'") == '0'
        assert sql("SELECT string_agg(DISTINCT closure_basis, ',') FROM smarter_private.reliability_incidents WHERE source = 'mac-studio-git-maintenance'") == 'reclassified_not_an_incident'
        assert sql("SELECT (smarter_private.reliability_classify('financial-alerts-backfill', 'union_promo_duplicate_2026_11_08', 'warning', false)).is_incident") == 't'
        assert sql("SELECT (smarter_private.reliability_classify('some-source', 'engine_release_stall_check_other', 'warning', false)).is_incident") == 't'
        ok('a hand close keeps the closure basis it names; the git maintenance guard is a development notification whose open incident is closed with that basis, '
           'the two hand-written rows match only their exact names and open nothing, and any other name still does')
        print(f'{len(passed)}/{len(passed)} behaviours proven')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)


if __name__ == '__main__':
    main()
