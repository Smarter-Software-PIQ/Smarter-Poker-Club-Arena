#!/usr/bin/env python3
"""Native PostgreSQL proof of the Weekly Rakeback Status reader (2026-11-15).

Applies 20261116020505_weekly_rakeback_status_for_union_owners.sql BYTE FOR
BYTE to a throwaway private PostgreSQL 17 cluster (no TCP listener, trust auth
over a temporary unix socket, never production) holding minimal stand-ins for
the tables it reads, the production body of public.ca_can_oversee_union
(captured 2026-11-15, pg_get_functiondef) with a stub overseer check, and a
week clock whose run time the test moves around now(). Then it proves:

  * the period is named exactly, 2:00 AM America/Chicago to 2:00 AM
    America/Chicago, with its zone;
  * before the run: payout stages waiting, the two verification stages
    (Invoices Match Club Data, Books Closed) Not Checked Yet, never green;
  * past the run time with nothing recorded: Not Finished Yet with the run
    time, elapsed time and the deadline, NOT late; late only once a deadline
    the payout code enforces has passed (the automatic window, run time + 24
    hours, or a booked run's money_deadline_at);
  * mid-run after round 1: Agents Paid running, club-scoped rows ignored;
  * no verification record, partial checks and a check of an older statement
    stay Not Checked Yet; a mismatching or unreadable check fails the stage;
  * Statements Sent has no deadline: still Not Finished Yet three days later;
  * books not closed (no row, pending, complete without success) are Not
    Checked Yet; running is running; failed is failed; a failed run fails
    the unpaid rounds;
  * only the union overseer or a platform admin may read it (42501
    otherwise, the Union Statements board rule), anon and PUBLIC cannot
    execute it, authenticated can;
  * it holds only ACCESS SHARE locks and carries its own 5 s / 1 s limits.

Run locally: python3 scripts/ci/test-weekly-rakeback-status-postgres.py
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
MIGRATION = ROOT / 'supabase/migrations/20261116020505_weekly_rakeback_status_for_union_owners.sql'

parser = argparse.ArgumentParser()
parser.add_argument('--pg-bin', default=os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
parser.add_argument('--scratch', default=os.environ.get('RUNNER_TEMP', tempfile.gettempdir()))
args = parser.parse_args()
pg = Path(args.pg_bin).resolve()
env = {'PATH': str(pg) + ':/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'PGCONNECT_TIMEOUT': '5'}
cluster = Path(tempfile.mkdtemp(prefix='ca-wrs-', dir=args.scratch))
data = cluster / 'data'
socket = cluster / 's'
socket.mkdir(mode=0o700)
start_attempted = False

UNION = 'fade0000-0000-0000-0000-000000000001'
OWNER = '00000000-0000-4000-8000-0000000000a1'
ADMIN = '00000000-0000-4000-8000-0000000000a2'
STRANGER = '00000000-0000-4000-8000-0000000000a3'
KINGS = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
FELT = 'a0000000-0000-0000-0000-000000000001'
DEEP = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'
SAVAGE = '946747c6-b991-4220-b0cb-effbea46ecd2'
WEEK = '2026-11-16 08:00+00'
KEYS = ['preparation', 'clubs_paid', 'agents_paid', 'players_paid', 'statements_sent', 'invoices_match', 'books_closed']

# Production public.ca_can_oversee_union, pg_get_functiondef 2026-11-15.
OVERSEE = """CREATE OR REPLACE FUNCTION public.ca_can_oversee_union(p_union_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_union_id IS NULL THEN RETURN false; END IF;
  IF fn_is_union_overseer(p_union_id, v_uid) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM profiles p
                  WHERE p.id = v_uid AND COALESCE(p.is_admin, false));
END;
$function$
"""


def run(argv, sql=None):
    return subprocess.run([str(v) for v in argv], input=sql, text=True,
                          capture_output=True, env=env, timeout=120)


def psql(sql, check=True):
    r = run([pg / 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-h', socket,
             '-U', 'postgres', '-d', 'postgres', '-p', '5432'], sql)
    if check and r.returncode:
        raise RuntimeError(r.stderr + r.stdout)
    return r if not check else r.stdout.strip()


def due(offset):
    psql(f"UPDATE public.test_clock SET due = now() + interval '{offset}';")


def status(user=OWNER, role='authenticated'):
    out = psql(f"SET ROLE {role}; SELECT set_config('request.jwt.claim.sub', '{user}', false); "
               f"SELECT public.ca_union_weekly_rakeback_status('{UNION}', '{WEEK}')::text;")
    return json.loads(out.splitlines()[-1])


def states(s):
    assert [x['key'] for x in s['stages']] == KEYS, s
    return {x['key']: x['state'] for x in s['stages']}


def stage(s, key):
    return next(x for x in s['stages'] if x['key'] == key)


try:
    r = run([pg / 'initdb', '-D', data, '-U', 'postgres', '--auth-local=trust',
             '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    assert r.returncode == 0, r
    with (data / 'postgresql.conf').open('a') as conf:
        conf.write("\nlisten_addresses = ''\nunix_socket_directories = '" + str(socket) + "'\nautovacuum = off\ntimezone = 'UTC'\n")
    start_attempted = True
    r = run([pg / 'pg_ctl', '-D', data, '-l', cluster / 'server.log', '-w', 'start'])
    assert r.returncode == 0, r

    psql(f"""
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;
      CREATE TABLE public.test_clock(due timestamptz);
      INSERT INTO public.test_clock VALUES (now());
      CREATE FUNCTION public.fn_union_week_start(p timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS
        $$ SELECT p + interval '1 day' - interval '7 days' $$;
      CREATE FUNCTION public.fn_union_accounting_run_at(p timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS
        $$ SELECT due FROM public.test_clock $$;
      CREATE FUNCTION public.fn_ca_accounting_day(p timestamptz) RETURNS date LANGUAGE sql STABLE AS
        $$ SELECT ((p AT TIME ZONE 'America/Chicago') - interval '2 hours')::date $$;
      CREATE TABLE public.unions(id uuid PRIMARY KEY, name text, owner_id uuid);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_admin boolean);
      CREATE FUNCTION public.fn_is_union_overseer(p_union uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT EXISTS (SELECT 1 FROM public.unions u WHERE u.id = p_union AND u.owner_id = p_user) $$;
      CREATE TABLE public.clubs(id uuid PRIMARY KEY, name text);
      CREATE TABLE public.union_clubs(union_id uuid, club_id uuid);
      CREATE TABLE public.weekly_accounting_payout_pauses(run_id uuid DEFAULT gen_random_uuid(), period_start timestamptz,
        period_end timestamptz, announced_at timestamptz, money_starts_at timestamptz, money_deadline_at timestamptz,
        acknowledged_at timestamptz, phase text, instance_id text, attempt_no int, result jsonb,
        created_at timestamptz DEFAULT now());
      CREATE TABLE public.union_settlement_rounds(id uuid DEFAULT gen_random_uuid(), union_id uuid, period_start timestamptz,
        period_end timestamptz, round_no int, round_name text, payers int, payees int, amount numeric, detail jsonb,
        executed_at timestamptz DEFAULT now());
      CREATE TABLE public.accounting_routed_settlement_runs(union_id uuid, period_start timestamptz, period_end timestamptz,
        round_no int, result jsonb, completed_at timestamptz, scope_kind text, scope_id uuid);
      CREATE TABLE public.rakeback_periods(id uuid DEFAULT gen_random_uuid(), club_id uuid, period_start date, status text);
      CREATE TABLE public.settlement_invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, invoice_type text,
        breakdown jsonb, invoice_number text, net_amount numeric, status text DEFAULT 'generated',
        adjusts_invoice_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE public.accounting_invoice_deliveries(invoice_id uuid, recipient_id uuid, delivered_at timestamptz DEFAULT now());
      CREATE TABLE public.union_accounting_runs(union_id uuid, period_start timestamptz, period_end timestamptz,
        status text, attempts int, started_at timestamptz, finished_at timestamptz, scope_kind text, scope_id uuid, result jsonb);
      CREATE TABLE smarter_private.weekly_invoice_club_data_checks(period_end timestamptz NOT NULL, club_id uuid NOT NULL,
        invoice_id uuid NOT NULL, invoice_number text, matches boolean, read_error text,
        checked_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (period_end, club_id));
      REVOKE ALL ON SCHEMA smarter_private FROM PUBLIC;
      INSERT INTO public.unions VALUES ('{UNION}', 'Midway Union', '{OWNER}');
      INSERT INTO public.profiles VALUES ('{OWNER}', false), ('{ADMIN}', true), ('{STRANGER}', false);
      INSERT INTO public.clubs VALUES ('{KINGS}', 'KINGS CLUB'), ('{FELT}', 'The Felt Society'),
        ('{DEEP}', 'Deep Stack Society'), ('{SAVAGE}', 'Club Savage'), ('{UNION}', 'Midway Union');
      INSERT INTO public.union_clubs VALUES ('{UNION}', '{KINGS}'), ('{UNION}', '{FELT}'), ('{UNION}', '{DEEP}'), ('{UNION}', '{SAVAGE}');
      INSERT INTO public.rakeback_periods(club_id, period_start, status)
        SELECT '{KINGS}', '2026-11-09', 'pending' FROM generate_series(1, 5);
    """)
    psql(OVERSEE)
    r = run([pg / 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', 'postgres', '-d', 'postgres',
             '-p', '5432', '-f', MIGRATION])
    assert r.returncode == 0, r.stderr

    # Privileges and limits, as the Union Statements board reader.
    fn = "'public.ca_union_weekly_rakeback_status(uuid,timestamptz)'"
    for role, want in (('anon', 'f'), ('public', 'f'), ('authenticated', 't'), ('service_role', 't')):
        assert psql(f"SELECT has_function_privilege('{role}', {fn}, 'EXECUTE');") == want, role
    cfg = psql(f"SELECT prosecdef || ' ' || provolatile::text || ' ' || array_to_string(proconfig, ',') FROM pg_proc WHERE oid = {fn}::regprocedure;")
    assert cfg == 'true s search_path=public,statement_timeout=5s,lock_timeout=1s', cfg

    # Authorization: only the overseer or a platform admin.
    for who in (STRANGER, ''):
        r = psql(f"SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '{who}', false); "
                 f"SELECT public.ca_union_weekly_rakeback_status('{UNION}', '{WEEK}');", check=False)
        assert r.returncode != 0 and 'not authorized for this union' in r.stderr, r.stderr
    r = psql(f"SET ROLE anon; SELECT public.ca_union_weekly_rakeback_status('{UNION}', '{WEEK}');", check=False)
    assert r.returncode != 0 and 'permission denied' in r.stderr, r.stderr
    assert status(ADMIN)['union_id'] == UNION

    LABEL = 'Mon Nov 9, 2026 2:00 AM CST To Mon Nov 16, 2026 2:00 AM CST (America/Chicago)'

    # 1. Before the run: nothing ran, the two verification stages say Not Checked Yet.
    due('1 hour')
    s = status()
    st = states(s)
    assert st == {'preparation': 'waiting', 'clubs_paid': 'waiting', 'agents_paid': 'waiting',
                  'players_paid': 'waiting', 'statements_sent': 'waiting', 'invoices_match': 'not_checked',
                  'books_closed': 'not_checked'}, st
    assert s['in_progress'] is False and s['statements'] == [] and s['last_updated'] is None, s
    assert stage(s, 'preparation')['count'] == 5 and s['period']['end'].startswith('2026-11-16T08:00:00'), s
    assert s['period']['start'].startswith('2026-11-09T08:00:00'), s
    assert s['period']['time_zone'] == 'America/Chicago' and s['period']['label'] == LABEL, s['period']
    assert s['period']['start_local'] == 'Mon Nov 9, 2026 2:00 AM CST', s['period']
    assert stage(s, 'invoices_match')['detail'] == 'Not Checked Yet: No Club Statements Issued Yet', s
    assert stage(s, 'books_closed')['detail'] == 'Not Checked Yet: No Book Close Record For This Week', s
    assert all(x['elapsed_seconds'] is None for x in s['stages'] if x['state'] == 'waiting'), s

    # 2. An hour past the run time with no run: NOT late (no deadline has passed),
    #    Not Finished Yet with the run time, elapsed time and the window deadline.
    due('-1 hour')
    s = status()
    st = states(s)
    assert st['preparation'] == 'not_finished' and st['clubs_paid'] == 'not_finished', st
    assert 'late' not in st.values() and 'done' not in st.values(), st
    assert st['statements_sent'] == 'not_finished', st
    assert st['invoices_match'] == 'not_checked' and st['books_closed'] == 'not_checked', st
    assert s['in_progress'] is True
    p = stage(s, 'preparation')
    assert 3590 <= p['elapsed_seconds'] <= 3700, p
    assert p['detail'] == 'Not Finished Yet: No Payout Run Booked (5 Rakeback Periods)', p
    assert p['scheduled_at'] == s['scheduled_for'] and p['deadline_source'].startswith('Automatic Payout Window'), p
    c = stage(s, 'clubs_paid')
    assert c['deadline_at'] == p['deadline_at'] and c['detail'] == 'Not Finished Yet', c
    ss = stage(s, 'statements_sent')
    assert ss['deadline_at'] is None and ss['deadline_source'] is None and ss['elapsed_seconds'] >= 3590, ss

    # 3. Late only past the authoritative window close (run time + 24 hours).
    due('-25 hours')
    s = status()
    st = states(s)
    assert st['preparation'] == 'late' and st['clubs_paid'] == 'late' and st['players_paid'] == 'late', st
    assert st['statements_sent'] == 'not_finished' and st['books_closed'] == 'not_checked', st
    assert s['in_progress'] is False, s
    assert stage(s, 'clubs_paid')['detail'].startswith('Not Paid By '), s

    # 4. Mid-run after round 1 (club-scoped rows ignored): a booked run carries
    #    its own money deadline; the later rounds are not late before it.
    due('-20 minutes')
    psql(f"""INSERT INTO public.weekly_accounting_payout_pauses(period_end, instance_id, attempt_no, phase, announced_at,
               money_starts_at, money_deadline_at, acknowledged_at, result) VALUES
      ('{WEEK}', 'weekly-payout-rounds', 1, 'released', now() - interval '25 minutes', now() - interval '23 minutes',
       now() + interval '20 hours', now() - interval '23 minutes',
       '{{"rounds":[{{"round":1,"amount":0.10,"payees":0,"scope_kind":"club","scope_id":"{KINGS}"}}],"success":true}}'),
      ('{WEEK}', 'weekly-payout-rounds', 2, 'paying', now() - interval '21 minutes', now() - interval '19 minutes',
       now() + interval '19 hours 41 minutes', now() - interval '19 minutes', NULL);
      INSERT INTO public.union_settlement_rounds(union_id, period_end, round_no, payees, amount, executed_at)
        VALUES ('{UNION}', '{WEEK}', 1, 3, 840213.67, now() - interval '10 minutes');""")
    s = status()
    st = states(s)
    assert st == {'preparation': 'done', 'clubs_paid': 'done', 'agents_paid': 'running', 'players_paid': 'not_finished',
                  'statements_sent': 'not_finished', 'invoices_match': 'not_checked', 'books_closed': 'not_checked'}, st
    c = stage(s, 'clubs_paid')
    assert c['amount'] == 840213.67 and c['count'] == 3 and c['detail'] == '3 Clubs Paid', c
    a = stage(s, 'agents_paid')
    assert a['detail'] == 'Paying Now' and a['deadline_source'].startswith('Payout Run Money Deadline'), a
    assert stage(s, 'players_paid')['detail'] == 'Not Finished Yet: Waiting For Agents Paid'
    assert s['in_progress'] is True and s['last_updated'] == c['at'], s

    # 5. A booked run past its money deadline: the unpaid rounds are late.
    psql("UPDATE public.weekly_accounting_payout_pauses SET money_deadline_at = now() - interval '1 minute' WHERE attempt_no = 2;")
    st = states(status())
    assert st['clubs_paid'] == 'done' and st['agents_paid'] == 'late' and st['players_paid'] == 'late', st
    psql("UPDATE public.weekly_accounting_payout_pauses SET money_deadline_at = now() + interval '19 hours' WHERE attempt_no = 2;")

    # 6. Rounds paid, statements issued, not all delivered, NO verification
    #    record: Invoices Match and Books Closed stay Not Checked Yet.
    psql(f"""INSERT INTO public.union_settlement_rounds(union_id, period_end, round_no, payees, amount)
        VALUES ('{UNION}', '{WEEK}', 2, 20, 695.49);
      UPDATE public.weekly_accounting_payout_pauses SET phase = 'released',
        result = '{{"success":true,"rounds":[{{"round":3,"amount":642268.52,"payees":1339,"scope_kind":"union","scope_id":"{UNION}"}},
                   {{"round":3,"amount":0,"payees":0,"scope_kind":"club","scope_id":"{KINGS}"}}],
                   "financial_finished_at":"2026-11-16T14:42:22.282777+00:00"}}'
        WHERE attempt_no = 2;
      UPDATE public.rakeback_periods SET status = 'paid';""")
    bd = lambda d: json.dumps({'union_id': UNION, 'period_end': '2026-11-16T08:00:00+00:00', 'direction': d})
    psql(f"""INSERT INTO public.settlement_invoices(id, club_id, invoice_type, breakdown, invoice_number, net_amount) VALUES
      ('00000000-0000-4000-8000-000000000137', '{SAVAGE}', 'union_weekly_squareup', '{bd('square')}', 'MIDWAY-2026-000037', 0),
      ('00000000-0000-4000-8000-000000000138', '{DEEP}', 'union_weekly_squareup', '{bd('club owes union')}', 'MIDWAY-2026-000038', 96919.54),
      ('00000000-0000-4000-8000-000000000139', '{KINGS}', 'union_weekly_squareup', '{bd('club owes union')}', 'MIDWAY-2026-000039', 6042.96),
      ('00000000-0000-4000-8000-000000000140', '{UNION}', 'union_weekly_squareup', '{bd('union owes club')}', 'MIDWAY-2026-000040', 21.25),
      ('00000000-0000-4000-8000-000000000141', '{FELT}', 'union_weekly_squareup', '{bd('club owes union')}', 'MIDWAY-2026-000041', 88305.04),
      ('00000000-0000-4000-8000-000000000136', '{FELT}', 'union_weekly_squareup',
        '{{"union_id":"{UNION}","period_end":"2026-11-09T08:00:00+00:00"}}', 'MIDWAY-2026-000036', 1);
      INSERT INTO public.settlement_invoices(id, club_id, invoice_type, breakdown, invoice_number, net_amount, adjusts_invoice_id) VALUES
      ('00000000-0000-4000-8000-000000000145', '{KINGS}', 'union_weekly_credit_note', '{bd(None)}', 'MIDWAY-2026-000045', 21.25,
       '00000000-0000-4000-8000-000000000139');
      INSERT INTO public.accounting_invoice_deliveries(invoice_id) VALUES
      ('00000000-0000-4000-8000-000000000137'), ('00000000-0000-4000-8000-000000000138'),
      ('00000000-0000-4000-8000-000000000139'), ('00000000-0000-4000-8000-000000000139'),
      ('00000000-0000-4000-8000-000000000145');""")
    s = status()
    st = states(s)
    assert st['players_paid'] == 'done' and st['statements_sent'] == 'not_finished', st
    assert st['invoices_match'] == 'not_checked' and st['books_closed'] == 'not_checked', st
    assert stage(s, 'statements_sent')['detail'] == 'Not Finished Yet: 3 Of 4 Club Statements Delivered', s
    assert stage(s, 'invoices_match')['detail'] == 'Not Checked Yet: 0 Of 4 Club Statements Checked', s
    assert all(x['matches_club_data'] is None for x in s['statements']), s
    p = stage(s, 'players_paid')
    assert p['amount'] == 642268.52 and p['count'] == 1339 and p['at'] == '2026-11-16T14:42:22.282777+00:00', p
    assert p['detail'] == '1,339 Payees Paid (5 Of 5 Rakeback Periods Paid)', p

    # 7. Still not delivered three days after the run: no deadline, so never late.
    due('-3 days')
    s = status()
    ss = stage(s, 'statements_sent')
    assert ss['state'] == 'not_finished' and ss['deadline_at'] is None and ss['elapsed_seconds'] >= 3 * 86400 - 60, ss
    due('-20 minutes')

    # 8. Partial checks (all matching so far) are still Not Checked Yet; a
    #    check row for an older statement of the club does not count.
    psql(f"""INSERT INTO public.accounting_invoice_deliveries(invoice_id) VALUES ('00000000-0000-4000-8000-000000000141');
      INSERT INTO smarter_private.weekly_invoice_club_data_checks(period_end, club_id, invoice_id, invoice_number, matches)
      SELECT '{WEEK}', i.club_id, i.id, i.invoice_number, true FROM public.settlement_invoices i
       WHERE i.invoice_type = 'union_weekly_squareup' AND i.club_id <> '{UNION}'
         AND i.invoice_number IN ('MIDWAY-2026-000037', 'MIDWAY-2026-000038', 'MIDWAY-2026-000039');
      INSERT INTO smarter_private.weekly_invoice_club_data_checks(period_end, club_id, invoice_id, invoice_number, matches)
        VALUES ('{WEEK}', '{FELT}', '00000000-0000-4000-8000-000000000136', 'MIDWAY-2026-000036', true);""")
    s = status()
    assert stage(s, 'statements_sent')['state'] == 'done', s
    im = stage(s, 'invoices_match')
    assert im['state'] == 'not_checked' and im['detail'] == 'Not Checked Yet: 3 Of 4 Club Statements Checked', im

    # 9. Books not closed: a close row that is not complete and successful is
    #    Not Checked Yet; 'running' is running; 'complete' without success is not done.
    psql(f"""INSERT INTO public.union_accounting_runs(union_id, period_end, status, attempts, started_at, finished_at, scope_kind, scope_id, result)
        VALUES ('{UNION}', '{WEEK}', 'pending', 0, NULL, NULL, 'union', '{UNION}', NULL);""")
    b = stage(status(), 'books_closed')
    assert b['state'] == 'not_checked' and b['detail'] == 'Not Checked Yet: The Close Record Does Not Show A Successful Close', b
    psql("UPDATE public.union_accounting_runs SET status = 'running', attempts = 1, started_at = now();")
    assert stage(status(), 'books_closed')['state'] == 'running'
    psql("UPDATE public.union_accounting_runs SET status = 'complete', finished_at = now(), result = '{\"success\":false}';")
    assert stage(status(), 'books_closed')['state'] == 'not_checked'

    # 10. All done: every check matches and the close succeeded.
    psql(f"""DELETE FROM smarter_private.weekly_invoice_club_data_checks WHERE club_id = '{FELT}';
      INSERT INTO smarter_private.weekly_invoice_club_data_checks(period_end, club_id, invoice_id, invoice_number, matches)
        VALUES ('{WEEK}', '{FELT}', '00000000-0000-4000-8000-000000000141', 'MIDWAY-2026-000041', true);
      UPDATE public.union_accounting_runs SET result = '{{"success":true}}', finished_at = now() - interval '1 minute';""")
    s = status()
    assert set(states(s).values()) == {'done'}, states(s)
    assert s['in_progress'] is False, s
    assert stage(s, 'statements_sent')['detail'] == '4 Of 4 Club Statements Delivered'
    assert stage(s, 'invoices_match')['detail'] == '4 Of 4 Club Statements Match'
    assert all(x['elapsed_seconds'] is None for x in s['stages']), s
    nums = [(x['number'], x['house'], x['delivered'], x['matches_club_data']) for x in s['statements']]
    assert nums == [('MIDWAY-2026-000037', False, True, True), ('MIDWAY-2026-000038', False, True, True),
                    ('MIDWAY-2026-000039', False, True, True), ('MIDWAY-2026-000040', True, False, None),
                    ('MIDWAY-2026-000041', False, True, True)], nums
    k = next(x for x in s['statements'] if x['number'] == 'MIDWAY-2026-000039')
    assert k['club'] == 'KINGS CLUB' and k['amount'] == 6042.96 and k['direction'] == 'club owes union', k
    assert k['credit_notes'] == [{'number': 'MIDWAY-2026-000045', 'amount': 21.25, 'delivered': True}], k

    # 11. Failures from records: a mismatching check, an unreadable check, a
    #     failed close, a failed run.
    psql(f"UPDATE smarter_private.weekly_invoice_club_data_checks SET matches = false WHERE invoice_number = 'MIDWAY-2026-000041';"
         f"UPDATE smarter_private.weekly_invoice_club_data_checks SET matches = NULL, read_error = 'timeout' WHERE invoice_number = 'MIDWAY-2026-000038';"
         f"UPDATE public.union_accounting_runs SET status = 'failed', attempts = 7;")
    s = status()
    im = stage(s, 'invoices_match')
    assert im['state'] == 'failed', im
    assert im['detail'] == 'Differs From Club Data: The Felt Society. Club Data Could Not Be Read: Deep Stack Society', im
    b = stage(s, 'books_closed')
    assert b['state'] == 'failed' and b['detail'] == 'The Last Close Attempt Failed (7 Attempts)', b
    assert next(x for x in s['statements'] if x['number'] == 'MIDWAY-2026-000041')['matches_club_data'] is False
    assert next(x for x in s['statements'] if x['number'] == 'MIDWAY-2026-000038')['matches_club_data'] is False
    psql("DELETE FROM public.union_settlement_rounds WHERE round_no = 2;"
         "UPDATE public.weekly_accounting_payout_pauses SET result = '{\"success\":false,\"error\":\"x\"}' WHERE attempt_no = 2;")
    s = status()
    st = states(s)
    assert st['clubs_paid'] == 'done' and st['agents_paid'] == 'failed' and st['players_paid'] == 'failed', st

    # 6. Plain reads only: ACCESS SHARE locks, no row locks.
    locks = psql(f"BEGIN; SELECT set_config('request.jwt.claim.sub', '{OWNER}', true); "
                 f"SELECT public.ca_union_weekly_rakeback_status('{UNION}', '{WEEK}') IS NOT NULL; "
                 "SELECT string_agg(DISTINCT mode, ',') FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'relation' "
                 "AND relation IN (SELECT oid FROM pg_class WHERE relnamespace IN ('public'::regnamespace, 'smarter_private'::regnamespace) "
                 "AND relname <> 'pg_locks'); ROLLBACK;").splitlines()
    assert locks[-1] == 'AccessShareLock', locks

    print(json.dumps({
        'ok': True,
        'migration': MIGRATION.name,
        'server_version': psql('SHOW server_version;'),
        'checks': ['privileges_as_board_reader', 'own_limits', 'overseer_or_admin_only', 'before_run_waiting',
                   'period_label_america_chicago', 'past_run_time_not_finished_not_late', 'late_only_after_window_close',
                   'mid_run_after_round_1', 'club_scope_ignored', 'late_after_booked_money_deadline',
                   'no_verification_record_not_checked', 'round_3_from_result', 'no_deadline_never_late',
                   'partial_and_stale_checks_not_checked', 'books_not_closed_not_checked', 'books_running',
                   'all_done', 'statements_house_credit_notes', 'club_data_mismatch_failed', 'club_data_unread_failed',
                   'close_failed', 'run_failed', 'access_share_only'],
    }))
finally:
    if start_attempted:
        subprocess.run([str(pg / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'],
                       capture_output=True, env=env, timeout=60)
    shutil.rmtree(cluster, ignore_errors=True)
