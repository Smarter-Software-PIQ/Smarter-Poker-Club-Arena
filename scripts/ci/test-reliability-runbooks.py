#!/usr/bin/env python3
"""Native proof for 20261119234324_the_controller_runs_recovery_runbooks.

Runs the migration against a throwaway PostgreSQL 17 cluster (never
production), over the Stage B controller (its own migration on the copied
production objects of scripts/ci/fixtures/reliability-controller-production-objects.sql)
and minimal stand-ins for the platform objects the four runbooks read. It proves:

  * install: the four runbooks are enabled through the catalog, no row can
    name eligibility.incident_class (so no class's escalation is silenced), the
    executor is scheduled, mutation_paused is released, and the live proof holds;
  * spin_seat_first_fill seats ONE horse through the seat door on an overdue
    horse-only Spin board, never offers a busy, benched, non-member or
    budget-bound horse, never touches a board with a person, never acts before
    the rung is overdue, in the :55 freeze or the 04:00-06:00 closed window,
    backs off, observes only while mutation_paused, and creates no board;
  * cron_proof_run runs only an allowlisted function, only after a migration
    naming it installed after the failure, only in the closed window, records
    proved when the function records its run, needs newer fix evidence after a
    run that recorded nothing, records a raising run as failed with its effects
    undone, and refuses a job that is not on the allowlist;
  * cutover_diagnosis attaches the precise cause (uncertified freeze baseline,
    uninstalled migrations carried by the owed build) and requests nothing;
  * hand_gap_classification classifies every slow hand (tournament break,
    maintenance break, rebuy, hand-for-hand once its table exists, other),
    resolves an alert only when every slow hand is an intended wait, and never
    resolves another source's alert;
  * every attempt is one runbook_attempts row and one runbook_attempt event
    with a unique command key; a spent budget writes runbook_exhausted once;
  * a dry run writes nothing; the escalation names the runbook instead of
    "No automatic recovery exists"; browser roles can execute nothing.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'scripts/ci/fixtures/reliability-controller-production-objects.sql'
STAGE_B = ROOT / 'supabase/migrations/20261110000020_reliability_controller_stage_b.sql'
MIGRATION = ROOT / 'supabase/migrations/20261119234324_the_controller_runs_recovery_runbooks.sql'
# Installed after it: a cron proof's fix evidence is a migration that redefines the function,
# and CutoverReadinessAtRisk is classified as release and diagnosed by cutover_diagnosis.
FOLLOW_UPS = [
    ROOT / 'supabase/migrations/20261120011743_a_cron_proof_needs_a_migration_that_redefines_the_function.sql',
    ROOT / 'supabase/migrations/20261122145848_cutover_readiness_classification_resolution_and_cron_recover.sql',
]

PLATFORM = r"""
ALTER TABLE public.profiles ADD COLUMN is_horse boolean, ADD COLUMN horse_status text;
CREATE TABLE public.tournaments (id uuid PRIMARY KEY, tournament_type text, status text, prize_pool_finalized boolean,
  max_players integer, club_id uuid, union_id uuid, break_started_at timestamptz, break_ends_at timestamptz,
  is_rebuy boolean DEFAULT false, is_reentry boolean DEFAULT false);
CREATE TABLE public.tables (id uuid PRIMARY KEY, tournament_id uuid);
CREATE FUNCTION public.fn_tournament_primary_table(p uuid) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM public.tables WHERE tournament_id = p LIMIT 1 $$;
CREATE TABLE public.table_seats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid,
  joined_at timestamptz, left_at timestamptz);
CREATE TABLE public.tournament_players (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid, status text);
CREATE TABLE public.club_members (club_id uuid, user_id uuid, status text);
CREATE TABLE public.clubs (id uuid PRIMARY KEY, union_id uuid);
CREATE TABLE public.union_clubs (union_id uuid, club_id uuid);
CREATE TABLE public.stub_budget (user_id uuid);
CREATE FUNCTION public.fn_horses_at_tournament_reservation_budget() RETURNS uuid[] LANGUAGE sql STABLE AS
  $$ SELECT coalesce(array_agg(user_id), '{}') FROM public.stub_budget $$;
CREATE TABLE public.stub_door_calls (tournament_id uuid, user_id uuid, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.stub_door_refuses (user_id uuid);
CREATE FUNCTION public.fn_seat_horse_in_seat_first_game(p_tournament_id uuid, p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.stub_door_calls (tournament_id, user_id) VALUES (p_tournament_id, p_user_id);
  IF EXISTS (SELECT 1 FROM public.stub_door_refuses WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance');
  END IF;
  INSERT INTO public.table_seats (table_id, user_id, joined_at) VALUES (public.fn_tournament_primary_table(p_tournament_id), p_user_id, clock_timestamp());
  INSERT INTO public.tournament_players (tournament_id, user_id, status) VALUES (p_tournament_id, p_user_id, 'registered');
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, start_time timestamptz, return_message text);
CREATE TABLE public.ca_detector_runs (id bigserial PRIMARY KEY, detector text, ran_at timestamptz DEFAULT clock_timestamp(), detail jsonb);
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
CREATE TABLE public.stub_drill (mode text);
INSERT INTO public.stub_drill VALUES ('record');
CREATE TABLE public.stub_drill_effects (at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.fn_ca_alarm_drill() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m text := (SELECT mode FROM public.stub_drill);
BEGIN
  INSERT INTO public.stub_drill_effects DEFAULT VALUES;
  IF m = 'raise' THEN RAISE EXCEPTION 'drill arm failed'; END IF;
  IF m = 'record' THEN INSERT INTO public.ca_detector_runs (detector, detail) VALUES ('fn_ca_alarm_drill', '{}'); END IF;
  RETURN jsonb_build_object('pass', true);
END $$;
CREATE FUNCTION public.fn_other_job() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE TABLE public.financial_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, source text, message text,
  context jsonb, resolved boolean DEFAULT false, resolved_at timestamptz, created_at timestamptz DEFAULT clock_timestamp(), resolution text);
CREATE TABLE public.hand_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, tournament_id uuid,
  started_at timestamptz, ended_at timestamptz, created_at timestamptz, actions jsonb DEFAULT '[]', players jsonb DEFAULT '[]',
  pots jsonb DEFAULT '[]', rit_boards jsonb, showdown jsonb DEFAULT '[]');
CREATE TABLE public.lightning_hand (hand_history_id uuid);
CREATE TABLE public.engine_maintenance_break_log (break_started_at timestamptz, break_ended_at timestamptz);
CREATE TABLE smarter_private.ca_engine_cutover_days (chicago_day date PRIMARY KEY, checked_at timestamptz, serving_sha text,
  serving_since timestamptz, owed_sha text, owed_committed_at timestamptz, verdict text, reason text, alert_id bigint, resolved_at timestamptz);
CREATE TABLE smarter_private.ca_cutover_readiness_runs (id bigserial PRIMARY KEY, cutover_day date NOT NULL, checked_at timestamptz NOT NULL,
  verdict text NOT NULL, reasons jsonb NOT NULL DEFAULT '[]', unknowns jsonb NOT NULL DEFAULT '[]', facts jsonb NOT NULL DEFAULT '{}', alert_id bigint);
CREATE TABLE public.engine_leader (id boolean PRIMARY KEY DEFAULT true, instance_id text, engine_version text, acquired_at timestamptz, heartbeat_at timestamptz);
CREATE TABLE public.ca_guard_defs (proname text PRIMARY KEY, def_hash text, updated_at timestamptz, declared_ref text, declared_at timestamptz);
CREATE TABLE public.ca_guard_inventory (kind text, object_a text, active boolean);
CREATE TABLE public.ca_drift_incidents (id uuid PRIMARY KEY, status text NOT NULL);
CREATE FUNCTION public.fn_ca_declare_guard_redefinition(p_proname text, p_ref text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ca_guard_defs (proname, def_hash, updated_at, declared_ref, declared_at)
  VALUES (p_proname, md5(p_proname), now(), p_ref, now())
  ON CONFLICT (proname) DO UPDATE SET declared_ref = EXCLUDED.declared_ref, declared_at = now();
  RETURN md5(p_proname);
END $$;
CREATE FUNCTION public.fn_ca_raise_drift_incident(p_source text, p_kind text, p_severity text, p_key text,
  a5 numeric, a6 numeric, a7 numeric, a8 text, a9 text, a10 text, a11 text, a12 text, a13 text, a14 text,
  a15 text, a16 text, a17 text, a18 text, p_detail text, a20 jsonb, p_context jsonb) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_ledger_invariant_refusal_watch() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.fn_cron_failing_jobs() RETURNS TABLE(jobname text, is_guard boolean, failed_in_a_row integer, failing_since timestamptz, failed_of_last_20 integer, last_success timestamptz, last_error text) LANGUAGE sql AS $$ SELECT NULL::text, false, 0, NULL::timestamptz, 0, NULL::timestamptz, NULL::text WHERE false $$;
CREATE TABLE public.engine_deploy_exit_paths (run_id text, stage text, outcome text, error text, release_result text,
  recorded_at timestamptz, target_sha text);
CREATE TABLE public.stub_http (url_like text, body jsonb);
CREATE TABLE public.stub_http_calls (url text);
CREATE FUNCTION smarter_private.ca_cutover_http_json(p_url text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.stub_http_calls VALUES (p_url);
  RETURN (SELECT body FROM public.stub_http WHERE p_url LIKE url_like LIMIT 1);
END $$;
"""

OWED = 'b' * 40
SERVING = 'a' * 40
CLUB = '00000000-0000-0000-0000-0000000000c1'
UNION = '00000000-0000-0000-0000-0000000000a1'
OUTSIDE = '00000000-0000-0000-0000-0000000000c9'


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
    scratch = Path(tempfile.mkdtemp(prefix='runbooks-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgr', dir='/tmp'))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    port = str(56000 + os.getpid() % 4000)
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

        def num(text):
            return int(sql(text))

        def refused(text, needle):
            r = psql(['-c', text])
            assert r.returncode != 0 and needle in r.stderr, f'{text}\nexpected "{needle}", got: {r.stdout} {r.stderr}'

        def ok(name):
            passed.append(name)
            print(f'ok - {name}')

        def run(at, dry=False, incident=None):
            args = [f"'{at}'::timestamptz", 'true' if dry else 'false', f"'{incident}'::uuid" if incident else 'NULL']
            return json.loads(sql(f"SELECT smarter_private.reliability_runbooks_run({', '.join(args)})"))

        def incident(cls, alertname, scope='{}', status='escalated', evidence='{}'):
            return sql("INSERT INTO smarter_private.reliability_incidents (fingerprint, incident_class, title, severity, status, source, alertname, "
                       "group_key, scope, latest_evidence, first_observed_at, last_observed_at, opened_at) VALUES "
                       f"(md5(random()::text), '{cls}', '{alertname} ({cls})', 'critical', '{status}', 'test', '{alertname}', "
                       f"'{cls}:{alertname}', '{scope}'::jsonb, '{evidence}'::jsonb, now(), now(), now()) RETURNING id")

        def attempts(iid, key=None):
            where = f" AND runbook_key = '{key}'" if key else ''
            return json.loads(sql("SELECT coalesce(jsonb_agg(jsonb_build_object('attempt', attempt, 'outcome', outcome, 'mode', mode, "
                                  "'summary', summary, 'detail', detail) ORDER BY id), '[]') FROM smarter_private.reliability_runbook_attempts "
                                  f"WHERE incident_id = '{iid}'{where}"))

        def events(iid, kind):
            return num(f"SELECT count(*) FROM smarter_private.reliability_incident_events WHERE incident_id = '{iid}' AND kind = '{kind}'")

        for f in (FIXTURE, STAGE_B):
            r = psql(['-f', str(f)])
            assert r.returncode == 0, f'{f}\n{r.stderr}'
        r = psql(['-c', PLATFORM])
        assert r.returncode == 0, r.stderr
        early = incident('table_liveness', 'TableStoppedDealing')

        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        text = MIGRATION.read_text()
        proof = re.search(r'^-- @live-proof: (.+)$', text, re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
        assert sql('SELECT mutation_paused FROM smarter_private.reliability_settings') == 'f'
        assert sql("SELECT string_agg(key || ':' || mode || ':' || mutates, ',' ORDER BY key) FROM smarter_private.reliability_runbooks") == \
            'cron_proof_run:enabled:true,cutover_diagnosis:enabled:false,hand_gap_classification:enabled:true,spin_seat_first_fill:enabled:true'
        assert sql("SELECT schedule || ' ' || command FROM cron.job WHERE jobname = 'reliability-controller-runbooks'") == \
            '*/2 * * * * SELECT smarter_private.reliability_runbooks_run()'
        refused("INSERT INTO smarter_private.reliability_runbooks (key, version, enabled, mode, eligibility) VALUES "
                "('x', 1, true, 'enabled', '{\"incident_class\": \"spin_lifecycle\"}')", 'reliability_runbooks_never_silence_a_class')
        refused("INSERT INTO smarter_private.reliability_runbooks (key, version, enabled, mode) VALUES ('x', 1, true, 'disabled')",
                'reliability_runbooks_enabled_matches_mode')
        ok('install enables four runbooks through the catalog, schedules the executor, and no runbook can silence a class')

        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        assert num('SELECT count(*) FROM smarter_private.reliability_runbooks') == 4
        assert num("SELECT count(*) FROM cron.job WHERE jobname = 'reliability-controller-runbooks'") == 1
        ok('the migration is idempotent')
        for follow in FOLLOW_UPS:
            r = psql(['-f', str(follow)])
            assert r.returncode == 0, f'{follow}\n{r.stderr}'
            proof = re.search(r'^-- @live-proof: (.+)$', follow.read_text(), re.M).group(1)
            assert sql(f'SELECT {proof}') == 't', f'live proof must hold after {follow.name}'

        for role in ('anon', 'authenticated'):
            for fn in ('reliability_runbooks_run(timestamptz,boolean,uuid)', 'reliability_runbook_select(uuid)',
                       'reliability_runbook_spin_seat_first_fill(uuid,boolean,jsonb,timestamptz)',
                       'reliability_runbook_cron_proof_run(uuid,boolean,jsonb,timestamptz)',
                       'reliability_runbook_cutover_diagnosis(uuid,boolean,jsonb,timestamptz)',
                       'reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)'):
                assert sql(f"SELECT has_function_privilege('{role}', 'smarter_private.{fn}', 'EXECUTE')") == 'f', (role, fn)
            assert sql(f"SELECT has_table_privilege('{role}', 'smarter_private.reliability_runbook_attempts', 'SELECT')") == 'f'
        ok('browser roles can execute and read nothing')

        # ------------------------------------------------------------- spin
        # 19:00 UTC = 13:00 Chicago (open hours).
        T0 = '2026-11-19 19:00:00+00'
        def horse_hash(text):
            h = 0
            for ch in text:
                h = (h * 31 + ord(ch)) % 4294967296
            return h

        def active(hid, hour):  # server/src/services/HorseBehavior.ts isActiveNow
            h = horse_hash(hid)
            return (hour - h % 24 + 24) % 24 < 10 + ((h >> 5) % 8)
        pool = [f'00000000-0000-0000-0000-000000{n:06d}' for n in range(400)]
        for hid in pool[:60]:
            for hour in (0, 7, 13, 19, 23):
                assert sql(f"SELECT smarter_private.reliability_horse_active_now('{hid}', {hour})") == ('t' if active(hid, hour) else 'f'), (hid, hour)
        sleeper = next(h for h in pool if not active(h, 19) and not active(h, 20))
        horses = [h for h in pool if all(active(h, hr) for hr in (19, 20))][:20]
        ok('the active-hours arithmetic equals the engine\'s HorseBehavior.isActiveNow')
        human = '00000000-0000-0000-0000-000000000999'
        sql("INSERT INTO public.profiles (id, is_horse, horse_status) VALUES " + ','.join(f"('{h}', true, 'available')" for h in horses)
            + f", ('{human}', false, NULL)")
        # Spins are hosted by the union's own club; the horses are members of a union club (the engine's scope).
        sql(f"INSERT INTO public.clubs VALUES ('{UNION}', '{UNION}'), ('{OUTSIDE}', NULL)")
        sql(f"INSERT INTO public.union_clubs VALUES ('{UNION}', '{CLUB}')")
        sql("INSERT INTO public.club_members (club_id, user_id, status) VALUES " + ','.join(f"('{CLUB}', '{h}', 'active')" for h in horses))
        boards = {}
        joined_at = {'overdue': "'2026-11-19 17:30+00'", 'fresh': "'2026-11-19 18:30+00'", 'human': "'2026-11-19 16:00+00'",
                     'one': "'2026-11-19 17:00+00'"}
        for name, seats in (('overdue', [horses[0], horses[1]]), ('fresh', [horses[2], horses[3]]), ('human', [horses[4], human]), ('one', [horses[5]])):
            tid = sql(f"INSERT INTO public.tournaments (id, tournament_type, status, prize_pool_finalized, max_players, club_id, union_id) VALUES "
                      f"(gen_random_uuid(), 'SPIN', 'REGISTERING', false, 3, '{UNION}', '{UNION}') RETURNING id")
            sql(f"INSERT INTO public.tables VALUES (gen_random_uuid(), '{tid}')")
            for u in seats:
                sql(f"INSERT INTO public.table_seats (table_id, user_id, joined_at) VALUES (public.fn_tournament_primary_table('{tid}'), '{u}', {joined_at[name]})")
                sql(f"INSERT INTO public.tournament_players (tournament_id, user_id, status) VALUES ('{tid}', '{u}', 'registered')")
            boards[name] = tid
        # Busy horses (seated at a cash table), a benched horse, a budget-bound horse and a non-member.
        sql("INSERT INTO public.table_seats (table_id, user_id, joined_at) VALUES " + ','.join(f"(gen_random_uuid(), '{h}', now())" for h in horses[6:9]))
        sql(f"UPDATE public.profiles SET horse_status = 'disabled' WHERE id = '{horses[9]}'")
        sql(f"INSERT INTO public.stub_budget VALUES ('{horses[10]}')")
        sql(f"UPDATE public.club_members SET club_id = '{OUTSIDE}' WHERE user_id = '{horses[11]}'")
        sql(f"INSERT INTO public.profiles (id, is_horse, horse_status) VALUES ('{sleeper}', true, 'available')")
        sql(f"INSERT INTO public.club_members (club_id, user_id, status) VALUES ('{CLUB}', '{sleeper}', 'active')")
        spin = incident('spin_lifecycle', 'SpinFleetProducingNothing')
        tournaments_before = num('SELECT count(*) FROM public.tournaments')

        def seated(board):
            return num(f"SELECT count(*) FROM public.table_seats WHERE table_id = public.fn_tournament_primary_table('{boards[board]}') AND left_at IS NULL")

        dry = run(T0, dry=True, incident=spin)
        plan = dry['runs'][0]['plan']
        results = {b['tournament_id']: b['result'] for b in plan['boards']}
        assert results == {boards['overdue']: 'would_offer_one_horse', boards['human']: 'skipped_human_present',
                           boards['one']: 'would_offer_one_horse'}, plan
        assert num('SELECT count(*) FROM public.stub_door_calls') == 0 and num('SELECT count(*) FROM smarter_private.reliability_runbook_attempts') == 0
        assert num("SELECT count(*) FROM smarter_private.reliability_incident_events WHERE kind LIKE 'runbook%'") == 0
        ok('a dry run selects the right boards and writes nothing')

        run(T0)
        a = attempts(spin)
        assert len(a) == 1 and a[0]['outcome'] == 'acted' and a[0]['mode'] == 'enabled', a
        assert num('SELECT count(*) FROM public.stub_door_calls') == 2
        offered = sql("SELECT string_agg(user_id::text, ',') FROM public.stub_door_calls").split(',')
        assert not (set(offered) & (set(horses[:12]) | {sleeper})), offered
        assert (seated('overdue'), seated('one'), seated('fresh'), seated('human')) == (3, 2, 2, 2)
        assert num('SELECT count(*) FROM public.tournaments') == tournaments_before
        assert events(spin, 'runbook_attempt') == 1 and events(spin, 'runbook_containment') == 1
        ok('the spin runbook seats one horse per overdue horse-only board through the door, never a busy, benched, budget-bound or non-member horse, never a board with a person, and creates no board')

        out = run('2026-11-19 19:05:00+00')
        assert len(attempts(spin)) == 1 and 'backoff' in out['runs'][0]['blocked'], out
        ok('the spin runbook backs off between attempts')

        sql(f"UPDATE public.table_seats SET joined_at = '2026-11-19 16:00+00' WHERE table_id = public.fn_tournament_primary_table('{boards['fresh']}')")
        out = run('2026-11-19 19:56:00+00')
        assert 'freeze' in out['runs'][0]['blocked'], out
        out = run('2026-11-20 10:30:00+00')  # 04:30 Chicago
        assert 'closed maintenance window' in out['runs'][0]['blocked'], out
        sql('UPDATE smarter_private.reliability_settings SET mutation_paused = true')
        calls = num('SELECT count(*) FROM public.stub_door_calls')
        run('2026-11-19 19:20:00+00')
        a = attempts(spin)
        assert a[-1]['outcome'] == 'observed' and a[-1]['mode'] == 'observe' and num('SELECT count(*) FROM public.stub_door_calls') == calls, a
        sql('UPDATE smarter_private.reliability_settings SET mutation_paused = false')
        ok('the spin runbook never acts in the :55 freeze or the closed window, and only observes while mutation is paused')

        sql("INSERT INTO public.stub_door_refuses SELECT p.id FROM public.profiles p WHERE p.is_horse")
        run('2026-11-19 19:40:00+00')
        a = attempts(spin)
        refusal = [b for b in a[-1]['detail']['boards'] if b['result'] == 'door_refused']
        assert a[-1]['outcome'] == 'refused' and len(refusal) == 1 and refusal[0]['tournament_id'] == boards['fresh'], a
        assert refusal[0]['tried'] == 3 and seated('fresh') == 2
        ok('the seat door stays the authority: a refusal is recorded, three candidates at most')

        sql(f"INSERT INTO smarter_private.reliability_runbook_attempts (incident_id, runbook_key, runbook_version, attempt, command_key, mode, outcome, summary, started_at) "
            f"SELECT '{spin}', 'spin_seat_first_fill', 1, 100 + g, md5('pad' || g), 'enabled', 'refused', 'pad', '2026-11-19 19:41+00' FROM generate_series(1, 10) g")
        out = run('2026-11-19 20:00:00+00')
        assert 'budget spent' in out['runs'][0]['blocked'], out
        run('2026-11-19 20:10:00+00')
        assert events(spin, 'runbook_exhausted') == 1
        ok('a spent budget stops the runbook and records runbook_exhausted once')

        # ------------------------------------------------------------- cron
        sql("INSERT INTO cron.job (jobname, schedule, command) VALUES ('ca-alarm-drill-weekly', '7 11 * * 1', 'SELECT public.fn_ca_alarm_drill()'), "
            "('other-weekly', '0 1 * * 1', 'SELECT public.fn_other_job()')")
        sql("INSERT INTO cron.job_run_details (jobid, status, start_time, return_message) SELECT jobid, 'failed', '2026-11-16 11:07+00', 'boom' FROM cron.job "
            "WHERE jobname IN ('ca-alarm-drill-weekly', 'other-weekly')")
        cron = incident('database', 'fn_ca_cron_failure_watch', '{"jobname": "ca-alarm-drill-weekly"}')
        other = incident('database', 'fn_ca_cron_failure_watch', '{"jobname": "other-weekly"}')
        noscope = incident('database', 'fn_ca_cron_failure_watch', '{}')
        assert sql(f"SELECT (smarter_private.reliability_runbook_select('{noscope}')).key IS NULL") == 't'
        W = '2026-11-20 10:10:00+00'  # 04:10 Chicago
        # A migration that only NAMES the function (as the controller's own install does) is not a fix.
        sql("INSERT INTO supabase_migrations.schema_migrations VALUES ('20261119234324', ARRAY['... SELECT public.fn_ca_alarm_drill() ... \"allow_functions\": [\"fn_ca_alarm_drill\"] ...'], 'names it')")
        run('2026-11-20 03:00:00+00', incident=cron)
        a = attempts(cron)
        assert a[-1]['outcome'] == 'nothing_to_do' and 'not shown fixed' in a[-1]['summary'], a
        sql("INSERT INTO supabase_migrations.schema_migrations VALUES ('20261119183127', ARRAY['CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill() ...'], 'fix')")
        run('2026-11-20 04:10:00+00', incident=cron)  # 22:10 Chicago, outside the window
        a = attempts(cron)
        assert a[-1]['outcome'] == 'nothing_to_do' and 'waits for the closed window' in a[-1]['summary'], a
        assert num('SELECT count(*) FROM public.stub_drill_effects') == 0
        sql("UPDATE public.stub_drill SET mode = 'silent'")
        run(W, incident=cron)
        a = attempts(cron)
        assert a[-1]['outcome'] == 'acted' and 'recorded no completed run' in a[-1]['summary'], a
        run('2026-11-20 11:20:00+00', incident=cron)
        a = attempts(cron)
        assert a[-1]['outcome'] == 'nothing_to_do' and 'is unchanged since the proof run' in a[-1]['summary'], a
        assert num('SELECT count(*) FROM public.stub_drill_effects') == 1
        ok('the cron proof run waits for fix evidence and the closed window, and a run that recorded nothing needs a newer fix')

        # A fix to the drill's body (here: a new definition) makes the next proof run due.
        sql("CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill() RETURNS jsonb LANGUAGE plpgsql AS $$ "
            "DECLARE m text := (SELECT mode FROM public.stub_drill); BEGIN INSERT INTO public.stub_drill_effects DEFAULT VALUES; "
            "IF m = 'raise' THEN RAISE EXCEPTION 'drill arm failed'; END IF; "
            "IF m = 'record' THEN INSERT INTO public.ca_detector_runs (detector, detail) VALUES ('fn_ca_alarm_drill', '{}'); END IF; "
            "RETURN jsonb_build_object('pass', true, 'fixed', true); END $$")
        sql("UPDATE public.stub_drill SET mode = 'raise'")
        run('2026-11-21 10:10:00+00', incident=cron)
        a = attempts(cron)
        assert a[-1]['outcome'] == 'failed' and 'drill arm failed' in a[-1]['summary'], a
        assert num('SELECT count(*) FROM public.stub_drill_effects') == 1, 'a failed proof run leaves no effect'
        sql("UPDATE public.stub_drill SET mode = 'record'")
        run('2026-11-21 11:15:00+00', incident=cron)
        a = attempts(cron)
        assert a[-1]['outcome'] == 'proved' and num("SELECT count(*) FROM public.ca_detector_runs WHERE detector = 'fn_ca_alarm_drill'") == 1, a
        assert events(cron, 'runbook_containment') == 2
        run('2026-11-21 11:50:00+00', incident=cron)
        run('2026-11-21 12:30:00+00', incident=cron)
        a = attempts(cron)
        assert a[-1]['outcome'] == 'nothing_to_do' and 'already recorded' in a[-1]['summary'], a
        run(W, incident=other)
        assert attempts(other)[-1]['outcome'] == 'refused' and 'allowlist' in attempts(other)[-1]['summary']
        ok('a raising proof run is recorded as failed with its effects undone, a recording run is proved, and a job off the allowlist is refused')

        # ------------------------------------------------------------- release
        sql(f"INSERT INTO smarter_private.ca_engine_cutover_days (chicago_day, serving_sha, owed_sha, verdict, reason, alert_id) "
            f"VALUES ('2026-11-19', '{SERVING}', '{OWED}', 'missed', 'refused selection', 445308)")
        sql(f"""INSERT INTO public.stub_http VALUES
          ('%/commits/{OWED}/statuses%', '[{{"context": "backup-engine/certified", "state": "success", "created_at": "2026-11-18T20:00:00Z"}}]'),
          ('%/actions/artifacts?name=daily-engine-selection-2026-11-19%', '{{"total_count": 1, "artifacts": [{{"workflow_run": {{"id": 77}}}}]}}'),
          ('%/actions/runs/77', '{{"id": 77, "conclusion": "success", "html_url": "https://example.invalid/77"}}'),
          ('%/compare/{SERVING}...{OWED}', '{{"files": [{{"filename": "supabase/migrations/20261119181143_x.sql", "status": "added"}}, {{"filename": "server/a.ts", "status": "modified"}}]}}')""")
        sql("INSERT INTO supabase_migrations.schema_migrations VALUES ('20261119181143', '{}', 'x')")
        rel = incident('release', 'EngineCutoverMissed', '{}', 'escalated', '{"inbox_event_id": 445308}')
        run(T0, incident=rel)
        a = attempts(rel)
        assert a[-1]['outcome'] == 'diagnosed' and a[-1]['detail']['cause'] == 'freeze_baseline_uncertified', a
        assert 'before the freeze' in a[-1]['summary'] and 'nothing was requested' in a[-1]['summary'], a
        assert a[-1]['detail']['certification_request'].startswith('none')
        calls = sql("SELECT string_agg(url, ' ') FROM public.stub_http_calls")
        assert 'dispatches' not in calls and all('api.github.com' in u for u in calls.split(' ')), calls
        sql("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261119181143'")
        sql(f"DELETE FROM smarter_private.reliability_runbook_attempts WHERE incident_id = '{rel}'")
        run(T0, incident=rel)
        a = attempts(rel)
        assert a[-1]['detail']['cause'] == 'owed_build_carries_uninstalled_migrations' and a[-1]['detail']['uninstalled_migrations'] == ['20261119181143'], a
        ok('the cutover runbook attaches the precise cause, reads only GitHub GETs and requests nothing')

        # CutoverReadinessAtRisk classifies as release, rakeback_settler_read_horizon_held as money_integrity,
        # and cutover_diagnosis diagnoses CutoverReadinessAtRisk from ca_cutover_readiness_runs with zero dispatches.
        assert sql("SELECT (smarter_private.reliability_classify('cutover-readiness-watch', 'CutoverReadinessAtRisk', 'critical', false)).incident_class") == 'release'
        assert sql("SELECT (smarter_private.reliability_classify('rakeback-settler-read-horizon', 'rakeback_settler_read_horizon_held', 'warning', false)).incident_class") == 'money_integrity'
        sql(f"""INSERT INTO smarter_private.ca_cutover_readiness_runs (cutover_day, checked_at, verdict, reasons, facts, alert_id)
                VALUES ('2026-11-22', '2026-11-22 09:00:00+00', 'not_ready',
                        '["no Backup-certified build the 03:30 selection can take"]'::jsonb,
                        jsonb_build_object('serving_sha', '{SERVING}', 'baseline_sha', '{OWED}'), 447351)""")
        readiness_inc = incident('release', 'CutoverReadinessAtRisk', '{}', 'escalated', '{"inbox_event_id": 447351}')
        run(T0, incident=readiness_inc)
        a = attempts(readiness_inc)
        assert a[-1]['outcome'] == 'diagnosed' and a[-1]['detail']['cause'] == 'cutover_readiness_at_risk', a
        assert 'no Backup-certified build' in a[-1]['summary'] and 'nothing was requested' in a[-1]['summary'], a
        ok('CutoverReadinessAtRisk classifies as release and cutover_diagnosis diagnoses it read-only')

        # ------------------------------------------------------------- hand gap
        tt = sql("INSERT INTO public.tournaments (id, tournament_type, status, club_id, break_started_at, break_ends_at, is_rebuy) VALUES "
                 "(gen_random_uuid(), 'MTT', 'RUNNING', NULL, '2026-11-19 22:21:00+00', '2026-11-19 22:21:30+00', true) RETURNING id")
        tbl = sql('SELECT gen_random_uuid()')

        def hand(start, end, created, players='[]'):
            sql(f"INSERT INTO public.hand_history (table_id, tournament_id, started_at, ended_at, created_at, players) VALUES "
                f"('{tbl}', '{tt}', '{start}', '{end}', '{created}', '{players}'::jsonb)")
        # Fold hands owe 500+1100+250+1500 = 3350 ms; budget 250.
        hand('2026-11-19 22:20:00+00', '2026-11-19 22:20:50+00', '2026-11-19 22:20:50+00')
        hand('2026-11-19 22:21:05+00', '2026-11-19 22:21:40+00', '2026-11-19 22:21:40+00')   # 15 s gap across the tournament break
        hand('2026-11-19 22:21:43.5+00', '2026-11-19 22:22:30+00', '2026-11-19 22:22:30+00')  # 3.5 s gap: 150 ms unintended, under budget
        hand('2026-11-19 22:22:40+00', '2026-11-19 22:23:10+00', '2026-11-19 22:23:10+00', '[{"stack": 0}]')  # 10 s gap, no reason yet
        hand('2026-11-19 22:23:20+00', '2026-11-19 22:23:50+00', '2026-11-19 22:23:50+00')   # 10 s after a bust in a rebuy event
        fa = sql("INSERT INTO public.financial_alerts (severity, source, message, context) VALUES ('critical', 'fn_ca_hand_gap_watch', 'gap', "
                 "'{\"kind\": \"tournament\", \"shape\": \"fold\", \"window_end\": \"2026-11-19T22:25:00Z\", \"budget_ms\": 250}') RETURNING id")
        foreign = sql("INSERT INTO public.financial_alerts (severity, source, message, context) VALUES ('critical', 'fn_other_watch', 'x', "
                      "'{\"kind\": \"tournament\", \"shape\": \"fold\", \"window_end\": \"2026-11-19T22:25:00Z\"}') RETURNING id")
        gap = incident('money_integrity', 'fn_ca_hand_gap_watch')
        run('2026-11-19 22:26:00+00', incident=gap)
        a = attempts(gap)
        assert a[-1]['outcome'] == 'diagnosed', a
        al = a[-1]['detail']['alerts'][0]
        by = al['by_class']
        assert by.get('tournament_break') == 1 and by.get('rebuy') == 1 and by.get('other') == 1 and not al['all_intended'], al
        assert sql(f"SELECT resolved FROM public.financial_alerts WHERE id = '{fa}'") == 'f'
        assert a[-1]['detail']['hand_for_hand_table'] is False
        # The 'other' hand (22:22:30 -> 22:22:40) is a hand-for-hand wait once the table exists.
        sql("CREATE TABLE public.ca_tournament_hand_for_hand (tournament_id uuid, started_at timestamptz, ended_at timestamptz)")
        sql(f"INSERT INTO public.ca_tournament_hand_for_hand VALUES ('{tt}', '2026-11-19 22:22:20+00', '2026-11-19 22:22:45+00')")
        run('2026-11-19 22:42:00+00', incident=gap)
        a = attempts(gap)
        al = a[-1]['detail']['alerts'][0]
        assert al['by_class'].get('hand_for_hand') == 1 and al['all_intended'] and a[-1]['outcome'] == 'resolved_producer', a
        assert sql(f"SELECT resolved::text || ' ' || (resolution LIKE 'reliability runbook hand_gap_classification%')::text FROM public.financial_alerts WHERE id = '{fa}'") == 'true true'
        assert sql(f"SELECT resolved FROM public.financial_alerts WHERE id = '{foreign}'") == 'f'
        ok('the hand gap runbook classifies every slow hand and resolves only its own alert, only when every slow hand is an intended wait')

        # ------------------------------------------------------------- render
        body = sql(f"SELECT smarter_private.reliability_render_escalation('{cron}', 'escalation', NULL)")
        assert 'Attempted: runbook cron_proof_run v1 attempt' in body and 'No automatic recovery exists' not in body, body
        assert 'an enabled runbook is working this incident' in body
        body = sql(f"SELECT smarter_private.reliability_render_escalation('{early}', 'escalation', NULL)")
        assert 'Attempted: No automatic recovery exists for this class yet.' in body and 'has no enabled runbook' in body, body
        fresh = incident('release', 'EngineCutoverMissed', '{}', 'escalated', '{"inbox_event_id": 1}')
        body = sql(f"SELECT smarter_private.reliability_render_escalation('{fresh}', 'escalation', NULL)")
        assert 'Attempted: runbook cutover_diagnosis v1 (enabled) is queued' in body, body
        ok('the escalation names the runbook and its last outcome; a class without one keeps the old line')

        # One attempt row was deleted above to replay the cutover diagnosis; its event stays (append-only).
        assert num("SELECT count(*) FROM smarter_private.reliability_runbook_attempts WHERE summary <> 'pad'") + 1 == \
            num("SELECT count(*) FROM smarter_private.reliability_incident_events WHERE kind = 'runbook_attempt'")
        assert num('SELECT count(DISTINCT command_key) FROM smarter_private.reliability_runbook_attempts') == \
            num('SELECT count(*) FROM smarter_private.reliability_runbook_attempts')
        sql(f"UPDATE smarter_private.reliability_incidents SET status = 'recovered' WHERE id = '{rel}'")
        run('2026-11-22 19:00:00+00')
        assert num(f"SELECT count(*) FROM smarter_private.reliability_runbook_attempts WHERE incident_id = '{rel}'") == 1
        ok('every attempt is one row and one event with a unique command key, and a recovered incident is left alone')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)
    print(f'{len(passed)} checks passed')


if __name__ == '__main__':
    main()
