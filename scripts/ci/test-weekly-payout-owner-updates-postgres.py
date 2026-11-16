#!/usr/bin/env python3
"""Native PostgreSQL proof of the weekly payout owner updates (2026-11-15).

Applies 20261115205037_weekly_payout_owner_updates_and_invoice_self_check.sql
BYTE FOR BYTE to a throwaway private PostgreSQL 17 cluster (no TCP listener,
trust auth over a temporary unix socket, never production) holding minimal
stand-ins for the payout tables it reads, the production body of
public.fn_raise_notification (newest migration that defines it), and stubs for
the week clock, the operational alert recorder and the Club Data reader. Then
it proves:

  * outside the window (before the run time, 24 h after, or another week) the
    tick returns NULL and sends nothing;
  * with every source table empty the tick never raises and sends nothing;
  * "payout late" is sent once at run time + 30 min when round 1 is missing;
  * clubs / agents / players paid are each sent exactly once across repeated
    ticks, from either the pauses result or union_settlement_rounds, with
    plain-English titles and chip amounts to 2 decimals;
  * statements sent fires only when every club statement (house row
    excluded) has a delivery row;
  * the self-check reads one club per tick, skips the house row, stores the
    comparison, names the mismatch in ONE invoices_checked notice and records
    exactly ONE operational alert; an all-matching week records none;
  * a failing notification insert never raises out of the tick and is
    retried (not lost) on the next tick;
  * anon / authenticated / service_role cannot execute the functions and
    the cron job is scheduled with its own 20 s / 1 s limits.

Run locally: python3 scripts/ci/test-weekly-payout-owner-updates-postgres.py
  --pg-bin /opt/homebrew/opt/postgresql@17/bin   (LC_ALL=C is set inside).
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261115205037_weekly_payout_owner_updates_and_invoice_self_check.sql'

parser = argparse.ArgumentParser()
parser.add_argument('--pg-bin', default=os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
parser.add_argument('--scratch', default=os.environ.get('RUNNER_TEMP', tempfile.gettempdir()))
args = parser.parse_args()
pg = Path(args.pg_bin).resolve()
env = {'PATH': str(pg) + ':/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'PGCONNECT_TIMEOUT': '5'}
cluster = Path(tempfile.mkdtemp(prefix='ca-wpo-', dir=args.scratch))
data = cluster / 'data'
socket = cluster / 's'
socket.mkdir(mode=0o700)
start_attempted = False

UNION = 'fade0000-0000-0000-0000-000000000001'
OWNER = '00000000-0000-4000-8000-0000000000a1'
KINGS = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
FELT = 'a0000000-0000-0000-0000-000000000001'
DEEP = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'
WEEK = '2026-11-16 08:00+00'      # period_end; run time 10:00Z
PREV = '2026-11-09 08:00+00'


def run(argv, sql=None):
    return subprocess.run([str(v) for v in argv], input=sql, text=True,
                          capture_output=True, env=env, timeout=120)


def psql(sql):
    r = run([pg / 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-h', socket,
             '-U', 'postgres', '-d', 'postgres', '-p', '5432'], sql)
    if r.returncode:
        raise RuntimeError(r.stderr + r.stdout)
    return r.stdout.strip()


def newest_block(head, terminator):
    for path in sorted(MIGRATIONS.glob('*.sql'), reverse=True):
        if path.name >= MIGRATION.name:
            continue
        text = path.read_text()
        start = text.rfind(head)
        if start < 0:
            continue
        end = text.find(terminator, start)
        assert end > start, f'{path.name}: {head} has no terminator'
        return path.name, text[start:end + len(terminator)]
    raise AssertionError(f'No migration defines {head}')


def tick(at):
    out = psql(f"SELECT smarter_private.weekly_payout_owner_notify_tick('{at}'::timestamptz);")
    return json.loads(out) if out else None


def notes():
    return json.loads(psql("SELECT coalesce(json_agg(json_build_object('m', data->>'milestone', 't', title, 'u', user_id, "
                           "'type', type, 'link', link) ORDER BY created_at, title), '[]') FROM public.notifications;"))


def alerts():
    return int(psql("SELECT count(*) FROM public.operational_alert_events;"))


try:
    raise_source, raise_sql = newest_block('CREATE OR REPLACE FUNCTION public.fn_raise_notification(', '$$;')
    for argv in ([pg / 'initdb', '-D', data, '-U', 'postgres', '--auth-local=trust',
                  '--auth-host=reject', '--no-locale', '--encoding=UTF8'],):
        r = run(argv)
        assert r.returncode == 0, r
    with (data / 'postgresql.conf').open('a') as conf:
        conf.write("\nlisten_addresses = ''\nunix_socket_directories = '" + str(socket) + "'\nautovacuum = off\n")
    start_attempted = True
    r = run([pg / 'pg_ctl', '-D', data, '-l', cluster / 'server.log', '-w', 'start'])
    assert r.returncode == 0, r

    psql(f"""
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA smarter_private;
      CREATE SCHEMA cron;
      CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
      CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
        $$ INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
      CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS
        $$ DELETE FROM cron.job WHERE jobid = p_id RETURNING true $$;
      -- Week clock: Monday 02:00 Chicago (08:00Z in November); payout two hours later.
      CREATE FUNCTION public.fn_union_week_start(p timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS
        $$ SELECT (date_trunc('week', (p - interval '8 hours') AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + interval '8 hours' $$;
      CREATE FUNCTION public.fn_union_accounting_run_at(p timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS
        $$ SELECT p + interval '2 hours' $$;
      CREATE FUNCTION public.fn_ca_accounting_day(p timestamptz) RETURNS date LANGUAGE sql STABLE AS
        $$ SELECT ((p AT TIME ZONE 'America/Chicago') - interval '2 hours')::date $$;
      CREATE TABLE public.unions(id uuid PRIMARY KEY, name text, owner_id uuid);
      CREATE TABLE public.clubs(id uuid PRIMARY KEY, name text);
      CREATE TABLE public.union_settlement_rounds(id uuid DEFAULT gen_random_uuid(), union_id uuid, period_start timestamptz,
        period_end timestamptz, round_no int, round_name text, payers int, payees int, amount numeric, detail jsonb,
        executed_at timestamptz DEFAULT now());
      CREATE TABLE public.weekly_accounting_payout_pauses(run_id uuid DEFAULT gen_random_uuid(), period_start timestamptz,
        period_end timestamptz, phase text, instance_id text, attempt_no int, result jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE public.settlement_invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, invoice_type text,
        from_entity_type text, from_entity_id text, to_entity_type text, to_entity_id text, breakdown jsonb,
        invoice_number text, status text DEFAULT 'generated', created_at timestamptz DEFAULT now());
      CREATE TABLE public.accounting_invoice_deliveries(invoice_id uuid, recipient_id uuid, delivered_at timestamptz DEFAULT now());
      CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text,
        message text, link text, data jsonb, created_at timestamptz DEFAULT clock_timestamp());
      CREATE TABLE public.operational_alert_events(id bigserial PRIMARY KEY, source text, event_key text, alertname text,
        status text, severity text, payload jsonb, UNIQUE(source, event_key));
      CREATE FUNCTION public.fn_record_operational_alert(p_source text, p_event_key text, p_alertname text, p_status text,
        p_severity text, p_payload jsonb) RETURNS bigint LANGUAGE sql AS
        $$ INSERT INTO public.operational_alert_events(source, event_key, alertname, status, severity, payload)
           VALUES (p_source, p_event_key, p_alertname, p_status, p_severity, p_payload)
           ON CONFLICT (source, event_key) DO UPDATE SET payload = EXCLUDED.payload RETURNING id $$;
      -- Club Data reader stand-in: figures per club and day range; 'fail' raises.
      CREATE TABLE public.test_screen(club_id uuid, first_day date, last_day date, fee numeric, winnings numeric, fail boolean DEFAULT false);
      CREATE TABLE public.test_screen_calls(club_id uuid, first_day date, last_day date);
      CREATE FUNCTION public.ca_club_data_screen(p_club_id uuid, p_start date, p_end date, p_game text, p_stakes text,
        p_search text, p_limit int) RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE s record;
      BEGIN
        INSERT INTO public.test_screen_calls VALUES (p_club_id, p_start, p_end);
        SELECT * INTO s FROM public.test_screen t WHERE t.club_id = p_club_id AND t.first_day = p_start AND t.last_day = p_end;
        IF NOT FOUND THEN RETURN jsonb_build_object('summary', jsonb_build_object('fee', 0, 'total_winnings', 0)); END IF;
        IF s.fail THEN RAISE EXCEPTION 'reader failed'; END IF;
        RETURN jsonb_build_object('summary', jsonb_build_object('fee', s.fee, 'total_winnings', s.winnings));
      END $$;
      INSERT INTO public.unions VALUES ('{UNION}', 'Midway Union', '{OWNER}');
      INSERT INTO public.clubs VALUES ('{KINGS}', 'KINGS CLUB'), ('{FELT}', 'Felt'), ('{DEEP}', 'Deep Stack'), ('{UNION}', 'Midway Union');
    """)
    psql(raise_sql)
    r = run([pg / 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', 'postgres', '-d', 'postgres',
             '-p', '5432', '-f', MIGRATION])
    assert r.returncode == 0, r.stderr

    # The schedule and the privileges.
    job = json.loads(psql("SELECT json_agg(json_build_object('s', schedule, 'c', command, 'a', active)) FROM cron.job;"))
    assert job == [{'s': '* * * * *', 'a': True, 'c': "SELECT set_config('statement_timeout','20s',false),"
                    "set_config('lock_timeout','1s',false); SELECT smarter_private.weekly_payout_owner_notify_tick();"}], job
    for role in ('anon', 'authenticated', 'service_role', 'public'):
        assert psql(f"SELECT bool_or(has_function_privilege('{role}', p.oid, 'EXECUTE')) FROM pg_proc p "
                    "JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'smarter_private';") == 'f', role
    for role in ('anon', 'authenticated'):
        for t in ('weekly_payout_owner_updates', 'weekly_invoice_club_data_checks'):
            assert psql(f"SELECT has_table_privilege('{role}', 'smarter_private.{t}', 'SELECT');") == 'f'
    assert psql("SELECT bool_and(prosecdef = false) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'smarter_private';") == 't'

    # Outside the window: nothing, whatever the tables hold.
    assert tick('2026-11-16 09:59:59+00') is None
    assert tick('2026-11-17 10:00:00+00') is None
    assert tick('2026-11-15 12:00:00+00') is None
    # Empty sources inside the window: never raises, sends nothing.
    out = tick('2026-11-16 10:01+00')
    assert out and 'error' not in out and out['sent'] == [] and out['check'] is None, out
    assert notes() == [] and alerts() == 0

    # Late: no round 1 at 10:30Z.
    assert tick('2026-11-16 10:29+00')['sent'] == []
    assert tick('2026-11-16 10:30+00')['sent'] == ['payout_late']
    assert tick('2026-11-16 10:31+00')['sent'] == []
    late = notes()
    assert len(late) == 1 and late[0]['t'] == 'Weekly Rakeback: Payout Late (Clubs Not Paid By 4:30 AM)', late
    assert late[0]['u'] == OWNER and late[0]['type'] == 'system' and late[0]['link'] == f'/hub/club-arena/unions/{UNION}/statements'

    # Round 1 appears in the pauses result first (union scope; club scopes ignored).
    psql(f"""INSERT INTO public.weekly_accounting_payout_pauses(period_end, instance_id, attempt_no, result) VALUES
      ('{WEEK}', 'weekly-payout-rounds', 1, '{{"rounds":[{{"round":1,"amount":0.10,"payees":0,"scope_kind":"club","scope_id":"{KINGS}"}}]}}'),
      ('{WEEK}', 'weekly-payout-rounds', 2, '{{"rounds":[{{"round":1,"amount":840213.67,"payees":3,"scope_kind":"union","scope_id":"{UNION}"}}]}}');""")
    assert tick('2026-11-16 10:52+00')['sent'] == ['clubs_paid']
    psql(f"INSERT INTO public.union_settlement_rounds(union_id, period_end, round_no, payees, amount) VALUES ('{UNION}', '{WEEK}', 1, 3, 840213.67);")
    assert tick('2026-11-16 10:53+00')['sent'] == []
    psql(f"INSERT INTO public.union_settlement_rounds(union_id, period_end, round_no, payees, amount) VALUES ('{UNION}', '{WEEK}', 2, 20, 695.49);")
    assert tick('2026-11-16 10:54+00')['sent'] == ['agents_paid']
    psql(f"INSERT INTO public.union_settlement_rounds(union_id, period_end, round_no, payees, amount) VALUES ('{UNION}', '{WEEK}', 3, 1253, 625491.38);")
    psql(f"INSERT INTO public.union_settlement_rounds(union_id, period_end, round_no, payees, amount) VALUES ('{UNION}', '{PREV}', 3, 9, 9);")
    assert tick('2026-11-16 11:00+00')['sent'] == ['players_paid']
    for t in ('2026-11-16 11:01+00', '2026-11-16 11:02+00'):
        assert tick(t)['sent'] == []
    titles = [n['t'] for n in notes()]
    assert titles == ['Weekly Rakeback: Payout Late (Clubs Not Paid By 4:30 AM)',
                      'Weekly Rakeback: Clubs Paid (3 Clubs, 840,213.67 Chips)',
                      'Weekly Rakeback: Agents Paid (20 Agents, 695.49 Chips)',
                      'Weekly Rakeback: Players Paid (1,253 Payees, 625,491.38 Chips)'], titles

    # Statements: three clubs and the house row. Felt's statement disagrees with Club Data.
    bd = lambda club, rg, pw: json.dumps({'rake_generated': rg, 'players_won': pw, 'club_id': club,
                                          'period_start': '2026-11-09T08:00:00+00:00', 'period_end': '2026-11-16T08:00:00+00:00'})
    psql(f"""INSERT INTO public.settlement_invoices(id, club_id, invoice_type, from_entity_type, from_entity_id, to_entity_type, to_entity_id, breakdown, invoice_number, created_at) VALUES
      ('00000000-0000-4000-8000-000000000101', '{KINGS}', 'union_weekly_squareup', 'club', '{KINGS}', 'union', '{UNION}', '{bd(KINGS, '25854.24000000000000000000', '-37160.83')}', 'MIDWAY-2026-000042', '2026-11-16 11:05+00'),
      ('00000000-0000-4000-8000-000000000102', '{FELT}', 'union_weekly_squareup', 'club', '{FELT}', 'union', '{UNION}', '{bd(FELT, '455510.12', '-473091.31')}', 'MIDWAY-2026-000043', '2026-11-16 11:05+00'),
      ('00000000-0000-4000-8000-000000000103', '{DEEP}', 'union_weekly_squareup', 'club', '{DEEP}', 'union', '{UNION}', '{bd(DEEP, '0', '0')}', 'MIDWAY-2026-000044', '2026-11-16 11:05+00'),
      ('00000000-0000-4000-8000-000000000104', '{UNION}', 'union_weekly_squareup', 'union', '{UNION}', 'club', '{UNION}', '{bd(UNION, '96', '7749.31')}', 'MIDWAY-2026-000045', '2026-11-16 11:05+00');
      INSERT INTO public.test_screen VALUES
      ('{KINGS}', '2026-11-09', '2026-11-15', 25854.24, -37160.83),
      ('{FELT}', '2026-11-09', '2026-11-15', 455510.13, -473091.31);
      INSERT INTO public.accounting_invoice_deliveries(invoice_id) VALUES
      ('00000000-0000-4000-8000-000000000101'), ('00000000-0000-4000-8000-000000000101'), ('00000000-0000-4000-8000-000000000102');""")
    seen = []
    for i, t in enumerate(('2026-11-16 11:06+00', '2026-11-16 11:07+00', '2026-11-16 11:08+00')):
        out = tick(t)
        seen.append(out['check']['invoice_number'])
        assert int(psql("SELECT count(*) FROM smarter_private.weekly_invoice_club_data_checks;")) == i + 1
        if i < 2:
            assert out['sent'] == [] and alerts() == 0, out
    assert seen == ['MIDWAY-2026-000042', 'MIDWAY-2026-000043', 'MIDWAY-2026-000044'], seen
    assert out['sent'] == ['invoices_checked'] and out['alert'] == 'recorded', out
    calls = psql("SELECT string_agg(DISTINCT first_day || '..' || last_day, ',') || '/' || count(*) || '/' || "
                 f"count(*) FILTER (WHERE club_id = '{UNION}') FROM public.test_screen_calls;")
    assert calls == '2026-11-09..2026-11-15/3/0', calls
    assert psql("SELECT string_agg(invoice_number || ':' || matches, ',' ORDER BY invoice_number) "
                "FROM smarter_private.weekly_invoice_club_data_checks;") == \
        'MIDWAY-2026-000042:true,MIDWAY-2026-000043:false,MIDWAY-2026-000044:true'
    for t in ('2026-11-16 11:09+00', '2026-11-16 11:10+00'):
        out = tick(t)
        assert out['sent'] == [] and out['check'] is None and out['alert'] is None, out
    assert alerts() == 1
    alert = json.loads(psql("SELECT json_build_object('k', event_key, 'n', alertname, 's', severity) FROM public.operational_alert_events;"))
    assert alert == {'k': 'invoice-vs-club-data:2026-11-16T08:00Z', 'n': 'WeeklyInvoiceDiffersFromClubData', 's': 'critical'}, alert
    checked = [n for n in notes() if n['m'] == 'invoices_checked']
    assert len(checked) == 1 and checked[0]['t'] == 'Weekly Rakeback: Invoices Do Not Match Club Data (2 Of 3 Clubs Match)', checked
    msg = psql("SELECT message FROM public.notifications WHERE data->>'milestone' = 'invoices_checked';")
    assert 'Felt (MIDWAY-2026-000043): statement rake 455,510.12 vs Club Data 455,510.13' in msg, msg

    # Statements sent only once every club statement (house row excluded) is delivered.
    assert 'statements_sent' not in [n['m'] for n in notes()]
    # A failing notification insert never raises and is retried.
    psql("""CREATE FUNCTION public.test_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notifications down'; END $$;
            CREATE TRIGGER test_refuse BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.test_refuse();""")
    psql("INSERT INTO public.accounting_invoice_deliveries(invoice_id) VALUES ('00000000-0000-4000-8000-000000000103');")
    out = tick('2026-11-16 11:20+00')
    assert out['sent'] == [] and out['failed'] == ['statements_sent: P0001'] and 'error' not in out, out
    assert psql("SELECT count(*) FROM smarter_private.weekly_payout_owner_updates WHERE milestone = 'statements_sent';") == '0'
    psql("DROP TRIGGER test_refuse ON public.notifications;")
    assert tick('2026-11-16 11:21+00')['sent'] == ['statements_sent']
    assert tick('2026-11-16 11:22+00')['sent'] == []
    st = [n['t'] for n in notes() if n['m'] == 'statements_sent']
    assert st == ['Weekly Rakeback: Statements Sent (3 Of 3 Clubs)'], st
    # A whole tick that hits a broken source returns its error instead of raising.
    psql("ALTER TABLE public.union_settlement_rounds RENAME TO usr_hidden;")
    out = tick('2026-11-16 11:23+00')
    assert out and 'error' in out, out
    psql("ALTER TABLE public.usr_hidden RENAME TO union_settlement_rounds;")

    # Every milestone exactly once for the week.
    counts = psql("SELECT string_agg(m || '=' || c, ',' ORDER BY m) FROM (SELECT data->>'milestone' m, count(*) c "
                  "FROM public.notifications GROUP BY 1) z;")
    assert counts == ('agents_paid=1,clubs_paid=1,invoices_checked=1,payout_late=1,players_paid=1,statements_sent=1'), counts
    # After the window closes, nothing more for that week.
    assert tick('2026-11-17 10:00+00') is None

    # The next week: on time and all matching -> no late notice, no alert.
    W2 = '2026-11-23 08:00+00'
    psql(f"""INSERT INTO public.union_settlement_rounds(union_id, period_end, round_no, payees, amount) VALUES ('{UNION}', '{W2}', 1, 1, 5);
      INSERT INTO public.settlement_invoices(id, club_id, invoice_type, from_entity_type, from_entity_id, to_entity_type, to_entity_id, breakdown, invoice_number, created_at) VALUES
      ('00000000-0000-4000-8000-000000000201', '{KINGS}', 'union_weekly_squareup', 'club', '{KINGS}', 'union', '{UNION}',
       '{{"rake_generated":"1.00","players_won":"-2.00","period_start":"2026-11-16T08:00:00+00:00","period_end":"2026-11-23T08:00:00+00:00"}}', 'MIDWAY-2026-000046', '2026-11-23 10:10+00');
      INSERT INTO public.test_screen VALUES ('{KINGS}', '2026-11-16', '2026-11-22', 1, -2);""")
    out = tick('2026-11-23 10:45+00')
    assert sorted(out['sent']) == ['clubs_paid', 'invoices_checked'] and out['alert'] is None, out
    assert tick('2026-11-23 10:46+00')['sent'] == []
    w2 = [n['t'] for n in notes() if n['t'].startswith('Weekly Rakeback') and n not in late]
    assert 'Weekly Rakeback: Clubs Paid (1 Club, 5.00 Chips)' in w2
    assert 'Weekly Rakeback: Invoices Match Club Data (1 Of 1 Clubs)' in w2
    assert alerts() == 1
    assert psql(f"SELECT count(*) FROM public.notifications WHERE data->>'period_end' LIKE '2026-11-23%' AND data->>'milestone' = 'payout_late';") == '0'

    # An accepted lock-screen banner cannot be recalled. Update the originating
    # bell and still-pending carriers without generating another delivery.
    _, promo_source = newest_block('CREATE OR REPLACE FUNCTION public.fn_midway_weekly_horse_promo_due(', 'END $function$;')
    psql('SET check_function_bodies=off; ' + promo_source.replace('horses that played raked cash or tournament hands', 'active Midway horses'))
    psql("""CREATE TABLE public.push_outbox(related_entity_id uuid,event text,status text,title text,body text);
      INSERT INTO public.push_outbox SELECT id,type,'sent',title,message FROM public.notifications WHERE data->>'milestone'='players_paid';
      INSERT INTO public.push_outbox SELECT id,type,'pending',title,message FROM public.notifications WHERE data->>'milestone'='agents_paid';""")
    before_count = len(notes())
    psql(next(MIGRATIONS.glob('20261116164001_*.sql')).read_text())
    assert len(notes()) == before_count
    assert psql("SELECT count(*) FROM public.push_outbox") == '2'
    assert psql("SELECT count(*) FROM public.notifications WHERE data->>'milestone'='players_paid' AND title LIKE 'Player Rakeback Paid (% Players,%' AND message LIKE 'Player Rakeback for % players,%' AND message NOT ILIKE '%horse%'") == '1'
    assert psql("SELECT count(*) FROM public.push_outbox WHERE status='sent' AND body LIKE 'Player and horse rakeback%'") == '1'
    assert psql("SELECT count(*) FROM public.push_outbox WHERE status='pending' AND body LIKE 'Agent Rakeback for %'") == '1'
    assert psql(f"SELECT bool_and(title ~ '^(Club|Agent|Player) Rakeback Paid' AND message !~* 'horse') FROM smarter_private.weekly_payout_owner_milestones('{WEEK}','{WEEK}','{UNION}') WHERE milestone IN ('clubs_paid','agents_paid','players_paid')") == 't'

    print(json.dumps({
        'ok': True,
        'migration': MIGRATION.name,
        'raise_notification_source': raise_source,
        'server_version': psql('SHOW server_version;'),
        'checks': ['cron_job_own_limits', 'no_role_can_execute', 'tables_not_readable_by_clients', 'outside_window_null',
                   'empty_sources_never_raise', 'late_once', 'clubs_agents_players_once', 'titles_plain_english',
                   'one_club_per_tick_house_skipped', 'mismatch_one_alert', 'statements_sent_after_all_delivered',
                   'failed_notification_retried_not_raised', 'broken_source_returns_error', 'matching_week_no_alert'],
    }))
finally:
    if start_attempted:
        subprocess.run([str(pg / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'],
                       capture_output=True, env=env, timeout=60)
    shutil.rmtree(cluster, ignore_errors=True)
