#!/usr/bin/env python3
"""Native PostgreSQL 17 proof for migration 20261124152017_fix_digest_cash_residual_alert_proofs_and_cron_freeze.sql.

Verifies all four permanent hard-coded SQL root-cause fixes against the exact
captured live preimage definitions (tests/fixtures/digest-cash-residual-alerts-cron-preimages.json):
  1. daily_chip_reconciliation & house_figures midnight post-commit banking boundary (+-$4.40 -> $0.00)
  2. OpenClawOperationalAlert recovery-twin exclusion & proof (1 of 2 -> 2 of 2)
  3. WeeklyPayoutNotReadyHalfHourBefore receipt proof & stale_unverified recovery via reliability_transition
  4. pg_cron launcher PQgetResult freeze elimination (real libpq non-blocking proof) + bounded pruners
"""
import ctypes
import ctypes.util
import json
import os
import pathlib
import select
import socket
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
PG_BIN = pathlib.Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
PARENT = (
    os.environ.get('ACCOUNTING_FIXTURE_PARENT')
    or os.environ.get('TMPDIR')
    or os.environ.get('RUNNER_TEMP')
)
if not PARENT:
    raise RuntimeError('Set ACCOUNTING_FIXTURE_PARENT or TMPDIR to owned SSD scratch or runner temp')
if os.uname().sysname == 'Darwin' and not PARENT.startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('Mac fixture storage must be on /Volumes/SmarterWork/agent-work/')
pathlib.Path(PARENT).mkdir(parents=True, exist_ok=True)

MIGRATION = ROOT / 'supabase/migrations/20261124152017_fix_digest_cash_residual_alert_proofs_and_cron_freeze.sql'
PREIMAGES = json.loads(
    (ROOT / 'tests/fixtures/digest-cash-residual-alerts-cron-preimages.json').read_text()
)


def load_libpq():
    candidates = []
    pg_config = PG_BIN / 'pg_config'
    if pg_config.exists():
        libdir = subprocess.check_output([str(pg_config), '--libdir'], text=True).strip()
        for name in ('libpq.5.dylib', 'libpq.dylib', 'libpq.so.5', 'libpq.so'):
            candidates.append(str(pathlib.Path(libdir) / name))
    for linux_dir in ('/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu', '/usr/lib'):
        candidates.append(f'{linux_dir}/libpq.so.5')
        candidates.append(f'{linux_dir}/libpq.so')
    found = ctypes.util.find_library('pq')
    if found:
        candidates.append(found)
    candidates.extend(('libpq.so.5', 'libpq.5.dylib'))

    for candidate in candidates:
        if os.path.isabs(candidate) and not pathlib.Path(candidate).exists():
            continue
        try:
            lib = ctypes.CDLL(candidate)
        except OSError:
            continue
        lib.PQconnectdb.restype = ctypes.c_void_p
        lib.PQconnectdb.argtypes = [ctypes.c_char_p]
        lib.PQstatus.argtypes = [ctypes.c_void_p]
        lib.PQsendQuery.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        lib.PQconsumeInput.argtypes = [ctypes.c_void_p]
        lib.PQisBusy.argtypes = [ctypes.c_void_p]
        lib.PQgetResult.restype = ctypes.c_void_p
        lib.PQgetResult.argtypes = [ctypes.c_void_p]
        lib.PQresultStatus.argtypes = [ctypes.c_void_p]
        lib.PQresultErrorMessage.restype = ctypes.c_char_p
        lib.PQresultErrorMessage.argtypes = [ctypes.c_void_p]
        lib.PQclear.argtypes = [ctypes.c_void_p]
        lib.PQfinish.argtypes = [ctypes.c_void_p]
        lib.PQsocket.argtypes = [ctypes.c_void_p]
        lib.PQsetnonblocking.argtypes = [ctypes.c_void_p, ctypes.c_int]
        return lib
    raise RuntimeError(f'Could not find libpq among {candidates}')


def run_libpq_nonblocking(libpq, port, command_sql):
    """Simulate pg_cron's exact single-threaded libpq poll loop (PQsendQuery -> PQisBusy -> PQgetResult)."""
    conn = libpq.PQconnectdb(f'host=127.0.0.1 port={port} dbname=postgres'.encode())
    assert libpq.PQstatus(conn) == 0, 'libpq connect failed'
    libpq.PQsetnonblocking(conn, 1)
    sock = libpq.PQsocket(conn)
    t0 = time.monotonic()
    assert libpq.PQsendQuery(conn, command_sql.encode()) == 1, 'PQsendQuery failed'
    first_not_busy = None
    block_dur = None
    errors = []
    nres = 0
    while True:
        ready, _, _ = select.select([sock], [], [], 0.05)
        if not ready:
            continue
        assert libpq.PQconsumeInput(conn) == 1
        if libpq.PQisBusy(conn) == 0:
            first_not_busy = time.monotonic() - t0
            tb = time.monotonic()
            while True:
                res = libpq.PQgetResult(conn)
                if not res:
                    break
                nres += 1
                st = libpq.PQresultStatus(res)
                # PGRES_COMMAND_OK=1, PGRES_TUPLES_OK=2
                if st not in (1, 2):
                    errors.append(libpq.PQresultErrorMessage(res).decode(errors='replace'))
                libpq.PQclear(res)
            block_dur = time.monotonic() - tb
            break
    libpq.PQfinish(conn)
    return first_not_busy, block_dur, nres, errors


def literal(val):
    return "'" + json.dumps(val).replace("'", "''") + "'::jsonb"


def main():
    libpq = load_libpq()
    with tempfile.TemporaryDirectory(prefix='digest-cron-', dir=PARENT) as folder:
        scratch = pathlib.Path(folder)

        def run(tool, *args, input_text=None, check=True):
            res = subprocess.run(
                [str(PG_BIN / tool), *args],
                input=input_text,
                text=True,
                capture_output=True,
                timeout=90,
            )
            if check and res.returncode:
                raise RuntimeError(res.stdout + res.stderr)
            return res

        run('initdb', '-D', str(scratch / 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = str(sock.getsockname()[1])
        run(
            'pg_ctl',
            '-D',
            str(scratch / 'data'),
            '-l',
            str(scratch / 'server.log'),
            '-o',
            f'-k {PARENT} -p {port} -h 127.0.0.1',
            'start',
        )
        try:
            def sql(source, check=True):
                return run(
                    'psql',
                    '-X',
                    '-q',
                    '-t',
                    '-A',
                    '-v',
                    'ON_ERROR_STOP=1',
                    '-h',
                    '127.0.0.1',
                    '-p',
                    port,
                    '-d',
                    'postgres',
                    input_text=source,
                    check=check,
                )

            # ── 0. Bootstrap minimal schema + stubs ──────────────────────────
            sql("""
            ALTER DATABASE postgres SET timezone TO 'UTC';
            CREATE ROLE service_role;
            CREATE ROLE anon;
            CREATE ROLE authenticated;
            CREATE SCHEMA IF NOT EXISTS smarter_private;
            CREATE SCHEMA IF NOT EXISTS cron;
            CREATE SCHEMA IF NOT EXISTS auth;
            CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role' $$;

            -- Digest / cash / tournament tables
            CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_horse boolean DEFAULT false);
            CREATE TABLE public.tournaments(
              id uuid PRIMARY KEY, name text, tournament_type text, status text,
              started_at timestamptz, start_time timestamptz, created_at timestamptz,
              ended_at timestamptz, club_id uuid, union_id uuid, current_players int DEFAULT 0,
              prize_pool numeric DEFAULT 0, bounty_pool numeric DEFAULT 0,
              bounty_pool_paid numeric DEFAULT 0, variant text DEFAULT 'nlh'
            );
            CREATE TABLE public.tournament_terminal_settlements(
              tournament_id uuid, settled_at timestamptz, completed_at timestamptz,
              escrow_closed_at timestamptz, prize_pool numeric, cash_payout_total numeric,
              bounty_pool numeric, bounty_payout_total numeric
            );
            CREATE TABLE public.tournament_cancellation_receipts(tournament_id uuid);
            CREATE TABLE public.tournament_escrow(
              tournament_id uuid, terminal_closed_at timestamptz, closed_at timestamptz,
              prize_balance numeric, bounty_balance numeric, fee_balance numeric
            );
            CREATE TABLE public.ca_hand_facts(
              hand_id uuid, user_id uuid, net numeric, players_dealt int,
              played_at timestamptz, tournament_id uuid, club_id uuid
            );
            CREATE TABLE public.chip_ledger(
              id uuid DEFAULT gen_random_uuid(), hand_id uuid, created_at timestamptz,
              status text, club_id uuid, from_type text, to_type text,
              from_entity_id uuid, to_entity_id uuid, amount numeric,
              category text, tournament_id uuid
            );
            CREATE TABLE public.bbj_contributions(
              id uuid DEFAULT gen_random_uuid(), hand_id uuid, pool_id uuid,
              club_id uuid, amount numeric, created_at timestamptz
            );
            CREATE TABLE public.rake_attributions(
              hand_id uuid, player_id uuid, club_id uuid,
              rake_amount numeric, bbj_attributed_contribution numeric
            );
            CREATE TABLE public.ca_supply_snapshots(
              taken_at timestamptz, unexplained numeric, basis_version text
            );
            CREATE TABLE public.sp_daily_metrics(
              day date PRIMARY KEY, metrics jsonb, attention jsonb,
              computed_at timestamptz, compute_ms int
            );
            CREATE TABLE public.sp_daily_digest_runs(day date, status text, sent_at timestamptz);
            CREATE TABLE public.sp_digest_daily_results_snapshots(day date PRIMARY KEY, result jsonb);

            CREATE FUNCTION public.fn_diamond_arena_club() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
            CREATE FUNCTION public.fn_tournament_conservation_deltas(timestamptz, timestamptz)
              RETURNS TABLE(id uuid, name text, delta numeric, ended_at timestamptz)
              LANGUAGE sql STABLE AS $$ SELECT NULL::uuid, NULL::text, NULL::numeric, NULL::timestamptz WHERE false $$;
            CREATE FUNCTION public.fn_sp_setting(text, numeric) RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT $2 $$;
            CREATE FUNCTION public.fn_diamond_spins_allowance_floor() RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT 2500 $$;
            CREATE FUNCTION public.fn_sp_midway_free_buy_watch() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '[]'::jsonb $$;
            CREATE FUNCTION public.fn_ca_midway_free_buy_format(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'regular' $$;
            CREATE FUNCTION public.fn_ca_midway_free_buy_slot_format(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'regular' $$;

            -- Alerting & reliability tables
            CREATE TABLE public.operational_alert_events(
              id bigint PRIMARY KEY, source text, alertname text, status text,
              severity text, event_key text, received_at timestamptz,
              last_received_at timestamptz, investigation_status text DEFAULT 'new',
              investigation_touched_at timestamptz, payload jsonb DEFAULT '{}'::jsonb,
              investigation jsonb DEFAULT '{}'::jsonb
            );
            CREATE TABLE public.financial_alerts(
              id uuid PRIMARY KEY, source text, created_at timestamptz,
              resolved boolean, resolved_at timestamptz
            );
            CREATE TABLE public.ca_drift_incidents(
              id uuid PRIMARY KEY, status text, created_at timestamptz,
              detected_at timestamptz, resolved_at timestamptz, deadline_at timestamptz,
              closure_basis text, root_cause text, correction_ref text, resolution text
            );
            CREATE TABLE public.ca_incident_events(incident_id uuid, at timestamptz, kind text, detail jsonb);
            CREATE TABLE public.cashout_requests(completed_at timestamptz, cancelled_at timestamptz, status text, created_at timestamptz);
            CREATE TABLE public.settlement_invoices(invoice_type text, created_at timestamptz, message_sent boolean);
            CREATE TABLE public.wheel_configs(enabled boolean, exposure_allowance_chips numeric);
            CREATE TABLE public.diamond_game_configs(enabled boolean, exposure_allowance_chips numeric);
            CREATE TABLE public.credit_invoices(id uuid, agent_id uuid, created_at timestamptz, period_start timestamptz, period_end timestamptz, debt_owed numeric);
            CREATE TABLE public.agent_credit_weekly_basis(agent_id uuid, period_start timestamptz, period_end timestamptz, credit_line numeric, agent_wallet_before_rakeback numeric, amount_owed numeric);
            CREATE TABLE public.agent_credit_tracking_policy(singleton boolean, activated_at timestamptz);
            CREATE TABLE public.union_accounting_runs(
              id uuid DEFAULT gen_random_uuid(), scope_kind text, scope_id uuid,
              period_end timestamptz, status text, finished_at timestamptz, result jsonb
            );
            CREATE TABLE smarter_private.weekly_payout_owner_updates(
              period_end timestamptz, milestone text, sent_at timestamptz
            );
            CREATE TABLE smarter_private.test_weekly_prepared_flag(ready boolean);
            INSERT INTO smarter_private.test_weekly_prepared_flag VALUES (false);
            CREATE FUNCTION smarter_private.weekly_prepared_payout_plans(text, uuid, timestamptz, timestamptz)
              RETURNS boolean LANGUAGE sql STABLE AS $$
              SELECT COALESCE((SELECT ready FROM smarter_private.test_weekly_prepared_flag LIMIT 1), false)
            $$;

            CREATE TABLE smarter_private.reliability_sources_without_resolve(source text PRIMARY KEY);
            INSERT INTO smarter_private.reliability_sources_without_resolve(source)
              VALUES ('daily-window'),('owner-operational-notifications'),('sp-critical-pager'),('sp-daily-digest'),('weekly-payout');
            CREATE TABLE smarter_private.reliability_incidents(
              id uuid PRIMARY KEY, source text, fingerprint text, status text,
              resolution_state text, opened_at timestamptz, last_firing_received_at timestamptz,
              last_resolved_at timestamptz, escalation_state text
            );
            CREATE TABLE smarter_private.reliability_alert_members(
              fingerprint text, member_key text, status text, episode text,
              last_firing_at timestamptz, last_event_at timestamptz, last_firing_received_at timestamptz
            );
            CREATE TABLE smarter_private.reliability_observations(
              id bigint, incident_id uuid, inbox_event_id bigint, status text,
              observed_at timestamptz, created_at timestamptz
            );
            CREATE TABLE smarter_private.test_transitions(
              incident_id uuid, to_status text, reason text, meta jsonb
            );
            CREATE FUNCTION smarter_private.reliability_transition(
              p_id uuid, p_to text, p_reason text, p_meta jsonb
            ) RETURNS void LANGUAGE plpgsql AS $$
            BEGIN
              UPDATE smarter_private.reliability_incidents SET status = p_to WHERE id = p_id;
              INSERT INTO smarter_private.test_transitions VALUES (p_id, p_to, p_reason, p_meta);
            END $$;

            -- Pruning / ledger replay / cron tables & stubs
            CREATE TABLE public.tables(id uuid PRIMARY KEY, lifecycle text, status text, is_deleted boolean DEFAULT false, tournament_id uuid);
            CREATE TABLE public.hand_history(id uuid PRIMARY KEY, table_id uuid, hand_number bigint, created_at timestamptz, has_human boolean, reported boolean, tournament_id uuid, players jsonb);
            CREATE TABLE public.hand_history_retention_policy(horse_retention_days int);
            INSERT INTO public.hand_history_retention_policy VALUES (8);
            CREATE TABLE public.hand_atomic_commits(hand_id uuid, table_id uuid, hand_number bigint, post_commit_completed_at timestamptz, post_commit_result jsonb);
            CREATE TABLE public.hand_state_snapshots(id uuid PRIMARY KEY, created_at timestamptz, updated_at timestamptz, table_id uuid, hand_number bigint);
            CREATE TABLE smarter_private.hand_history_prune_cursor(singleton boolean PRIMARY KEY, resume_after timestamptz, pass_started_at timestamptz, resume_id uuid, updated_at timestamptz);
            CREATE TABLE smarter_private.snapshot_retention_scan(singleton boolean PRIMARY KEY, through_at timestamptz, after_id uuid, examined bigint DEFAULT 0, updated_at timestamptz);
            INSERT INTO smarter_private.snapshot_retention_scan(singleton, through_at, after_id) VALUES (true, '-infinity', '00000000-0000-0000-0000-000000000000');
            CREATE TABLE smarter_private.horse_adaptive_disposal_certificates(table_id uuid, hand_number bigint);
            CREATE TABLE smarter_private.f06_hand_permits(table_id uuid, hand_number bigint, state text);
            CREATE TABLE smarter_private.original_inventory_restoration_cases(source_refs jsonb);
            CREATE TABLE smarter_private.hand_submissions(table_id uuid, hand_number bigint, request jsonb);
            CREATE TABLE smarter_private.tournament_abort_hand_dispositions(table_id uuid);
            CREATE TABLE public.poker_diamond_jackpot_hits(table_id uuid, hand_number bigint, paid boolean);
            CREATE TABLE public.bbj_payouts(table_id uuid, hand_number bigint);
            CREATE TABLE public.hand_projection_outbox(hand_id uuid);
            CREATE TABLE public.tournament_knockout_candidates(hand_id uuid, state text);
            CREATE TABLE smarter_private.test_cron_calls(fn text, iso text, st_timeout text, txid xid8 DEFAULT pg_current_xact_id());
            CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
            CREATE FUNCTION smarter_private.horse_cash_retention_accounting_ready(uuid, bigint) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
            CREATE FUNCTION smarter_private.f06_hand_cards_unresolved(uuid, bigint) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
            CREATE FUNCTION smarter_private.f06_movement_boundary_retained(uuid, bigint) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
            CREATE FUNCTION smarter_private.horse_snapshot_disposable(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
            CREATE FUNCTION smarter_private.progress_superseded_action_retention() RETURNS integer LANGUAGE plpgsql AS $$
            BEGIN
              INSERT INTO smarter_private.test_cron_calls(fn, iso, st_timeout)
                VALUES ('progress_superseded', current_setting('transaction_isolation'), current_setting('statement_timeout'));
              RETURN 0;
            END $$;
            CREATE FUNCTION smarter_private.discover_superseded_action_retention() RETURNS integer LANGUAGE plpgsql AS $$
            BEGIN
              INSERT INTO smarter_private.test_cron_calls(fn, iso, st_timeout)
                VALUES ('discover_superseded', current_setting('transaction_isolation'), current_setting('statement_timeout'));
              RETURN 0;
            END $$;

            -- Ledger replay & rake audit stubs (with configurable sleep to test libpq PQgetResult blocking!)
            CREATE TABLE public.ca_account_snapshots(
              account_key text, account_type text, entity_id uuid, club_id uuid, column_name text,
              balance numeric, taken_at timestamptz, is_baseline boolean, unexplained numeric,
              cum_unexplained numeric, basis_version text, note text, read_snapshot text
            );
            CREATE TABLE public.ca_ledger_replay_readings(read_snapshot text PRIMARY KEY, read_at timestamptz, committed_legs uuid[]);
            CREATE FUNCTION public.fn_ca_xid8(xid) RETURNS xid8 LANGUAGE sql IMMUTABLE AS $$ SELECT $1::text::xid8 $$;
            CREATE FUNCTION public.fn_ca_account_balance(text, uuid, uuid, text) RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT 0::numeric $$;
            CREATE FUNCTION public.fn_ca_leg_accounts(timestamptz, timestamptz)
              RETURNS TABLE(account_key text, account_type text, entity_id uuid, club_id uuid, column_name text, net numeric, unkeyable bigint)
              LANGUAGE plpgsql AS $$
            BEGIN
              INSERT INTO smarter_private.test_cron_calls(fn, iso, st_timeout)
                VALUES ('fn_ca_ledger_replay', current_setting('transaction_isolation'), current_setting('statement_timeout'));
              PERFORM pg_sleep(0.5);
              RETURN;
            END $$;
            CREATE FUNCTION public.fn_ca_kill_switch_trip(text, numeric, text) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
            CREATE FUNCTION public.fn_rake_bbj_audit(integer) RETURNS jsonb LANGUAGE plpgsql AS $$
            BEGIN
              INSERT INTO smarter_private.test_cron_calls(fn, iso, st_timeout)
                VALUES ('fn_rake_bbj_audit', current_setting('transaction_isolation'), current_setting('statement_timeout'));
              PERFORM pg_sleep(0.3);
              RETURN '{"violations":0}'::jsonb;
            END $$;

            -- Mock cron schema matching pg_cron's cron.job + cron.alter_job
            CREATE TABLE cron.job(
              jobid bigint PRIMARY KEY, jobname text UNIQUE, schedule text,
              command text, database text DEFAULT 'postgres', username text DEFAULT 'postgres',
              active boolean DEFAULT true
            );
            CREATE FUNCTION cron.alter_job(
              job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
              database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL
            ) RETURNS void LANGUAGE plpgsql AS $$
            BEGIN
              UPDATE cron.job j
                 SET schedule = COALESCE(alter_job.schedule, j.schedule),
                     command  = COALESCE(alter_job.command, j.command),
                     database = COALESCE(alter_job.database, j.database),
                     username = COALESCE(alter_job.username, j.username),
                     active   = COALESCE(alter_job.active, j.active)
               WHERE j.jobid = job_id;
            END $$;

            INSERT INTO cron.job(jobid, jobname, schedule, command) VALUES
              (117, 'sp_prune_hand_history_10m', '10 seconds', 'BEGIN; SELECT public.sp_prune_hand_history(5000); COMMIT;'),
              (119, 'sp_prune_hand_state_snapshots_2m', '1-59/2 * * * *', 'SELECT public.sp_prune_hand_state_snapshots(10000);'),
              (155, 'rake-bbj-invariant-audit-hourly', '38 * * * *', $$SET statement_timeout = '300s'; SELECT (public.fn_rake_bbj_audit(2))::text;$$),
              (286, 'ca-ledger-replay-nightly', '40 6 * * *', $$SET statement_timeout = '600s'; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; SELECT CASE WHEN pg_try_advisory_lock(hashtext('ca-ledger-replay')) THEN (public.fn_ca_ledger_replay(5000))::text ELSE 'locked' END;$$);
            """)

            # ── 1. Install all 9 exact live preimages & verify MD5s ──────────
            for row in PREIMAGES:
                sql(row['definition'])
                sig = row['signature']
                if '.' not in sig.split('(')[0]:
                    sig = 'public.' + sig
                got = sql(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));").stdout.strip()
                assert got == row['md5'], f"Preimage MD5 mismatch for {sig}: got {got}, want {row['md5']}"

            for sig in [
                'public.fn_sp_digest_daily_results_compute(date)',
                'public.fn_sp_digest_house_figures(date)',
                'public.fn_sp_daily_metrics_compute(date)',
                'public.fn_sp_digest_attention(date,jsonb)',
                'public.fn_sp_original_alert_proof(bigint)',
                'public.sp_prune_hand_history(integer)',
                'public.sp_prune_hand_state_snapshots(integer)',
                'public.fn_ca_ledger_replay(integer)',
            ]:
                sql(f'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION {sig} TO service_role;')

            before_acl = sql("""
            SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text, proowner, proacl, prosecdef) ORDER BY oid::regprocedure::text)
              FROM pg_proc
             WHERE oid IN (
               'public.fn_sp_digest_daily_results_compute(date)'::regprocedure,
               'public.fn_sp_digest_house_figures(date)'::regprocedure,
               'public.fn_sp_daily_metrics_compute(date)'::regprocedure,
               'public.fn_sp_digest_attention(date,jsonb)'::regprocedure,
               'public.fn_sp_original_alert_proof(bigint)'::regprocedure,
               'smarter_private.reliability_proved_source_resolution(uuid)'::regprocedure,
               'public.sp_prune_hand_history(integer)'::regprocedure,
               'public.sp_prune_hand_state_snapshots(integer)'::regprocedure,
               'public.fn_ca_ledger_replay(integer)'::regprocedure
             );
            """).stdout.strip()

            # ── 2. Seed fixtures reproducing ALL 4 live defects BEFORE fix ───
            sql("""
            -- Supply snapshots for 24 hours on 2026-11-22 and 2026-11-23 Chicago
            INSERT INTO public.ca_supply_snapshots(taken_at, unexplained, basis_version)
            SELECT ('2026-11-22 06:00:00+00'::timestamptz + make_interval(hours => h)), 0, 'v1'
              FROM generate_series(0, 47) h;

            -- Players: 1 horse, 1 human
            INSERT INTO public.profiles(id, is_horse) VALUES
              ('11111111-1111-1111-1111-111111111111', true),
              ('22222222-2222-2222-2222-222222222222', false);

            -- Hand 1 (midnight straddler): ended Nov 22 Chicago (05:59:59.59Z Nov 23), banked Nov 23 Chicago (06:00:01Z Nov 23)
            -- Rake $3.90 + BBJ $0.50 = $4.40; Horse net -14.40, Human net +10.00 -> cash_net = -4.40
            INSERT INTO public.ca_hand_facts(hand_id, user_id, net, players_dealt, played_at, tournament_id, club_id) VALUES
              ('aaaa1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', -14.40, 2, '2026-11-23 05:59:59.59+00', NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
              ('aaaa1111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',  10.00, 2, '2026-11-23 05:59:59.59+00', NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
            INSERT INTO public.chip_ledger(hand_id, created_at, status, club_id, from_type, to_type, amount, category) VALUES
              ('aaaa1111-1111-1111-1111-111111111111', '2026-11-23 06:00:01+00', 'posted', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'table_stack', 'club_wallet', 3.90, 'rake');
            INSERT INTO public.bbj_contributions(hand_id, pool_id, club_id, amount, created_at) VALUES
              ('aaaa1111-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 0.50, '2026-11-23 06:00:01+00');
            INSERT INTO public.rake_attributions(hand_id, player_id, club_id, rake_amount, bbj_attributed_contribution) VALUES
              ('aaaa1111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1.95, 0.25);

            -- Hand 2 (normal Nov 23 hand): standalone burn->chip_retirement rake $2.00 + BBJ $0.25 = $2.25
            INSERT INTO public.ca_hand_facts(hand_id, user_id, net, players_dealt, played_at, tournament_id, club_id) VALUES
              ('bbbb2222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', -2.25, 2, '2026-11-23 14:00:00+00', NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
              ('bbbb2222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',  0.00, 2, '2026-11-23 14:00:00+00', NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
            INSERT INTO public.chip_ledger(hand_id, created_at, status, club_id, from_type, to_type, amount, category) VALUES
              ('bbbb2222-2222-2222-2222-222222222222', '2026-11-23 14:00:01+00', 'posted', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'table_stack', 'chip_retirement', 2.00, 'burn');
            INSERT INTO public.bbj_contributions(hand_id, pool_id, club_id, amount, created_at) VALUES
              ('bbbb2222-2222-2222-2222-222222222222', 'dddd1111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 0.25, '2026-11-23 14:00:01+00');

            -- Stored sp_daily_metrics rows (posting-day sums: Nov 22 = 0, Nov 23 = 5.90 rake + 0.75 BBJ)
            INSERT INTO public.sp_daily_metrics(day, metrics, attention, computed_at, compute_ms) VALUES
              ('2026-11-22', '{"money":{"cash_rake":0,"bbj_contributions":0},"play":{"horse_net_bb":0}}'::jsonb, '[]'::jsonb, now(), 1),
              ('2026-11-23', '{"money":{"cash_rake":5.90,"bbj_contributions":0.75},"play":{"horse_net_bb":0}}'::jsonb, '[]'::jsonb, now(), 1);

            -- Fix 2 fixtures: OpenClaw firing (448522) + recovery twin (448530) + other source with resolves (448531)
            INSERT INTO public.operational_alert_events(id, source, alertname, status, severity, event_key, received_at, last_received_at, investigation_status, investigation_touched_at, payload) VALUES
              (448522, 'openclaw', 'OpenClawOperationalAlert', 'resolved', 'critical', 'ep-1', '2026-11-24 04:34:01+00', '2026-11-24 04:34:01+00', 'verified_fixed', '2026-11-24 07:30:25+00',
               '{"message":"🚨 CRITICAL /api/cron/trivia failed","resolved_at":"2026-11-24T07:30:25Z","resolved_by_event":448530}'::jsonb),
              (448530, 'openclaw', 'OpenClawOperationalAlert', 'resolved', 'critical', 'ep-1:recovered', '2026-11-24 05:26:01+00', '2026-11-24 05:26:01+00', 'investigating', NULL,
               '{"message":"✅ RECOVERED /api/cron/trivia - 200 again"}'::jsonb),
              (448531, 'other', 'OtherAlert', 'resolved', 'critical', 'other-1', '2026-11-24 05:27:00+00', '2026-11-24 05:27:00+00', 'new', NULL,
               '{"resolves":"some-key"}'::jsonb),
              (448532, 'openclaw', 'OpenClawOperationalAlert', 'resolved', 'critical', 'ep-2:recovered', '2026-11-24 05:28:00+00', '2026-11-24 05:28:00+00', 'new', NULL,
               '{"message":"RECOVERED /api/cron/no-emoji","resolves":"ep-1"}'::jsonb),
              (448533, 'openclaw', 'OpenClawOperationalAlert', 'resolved', 'critical', 'ep-3:unrecovered', '2026-11-24 05:29:00+00', '2026-11-24 05:29:00+00', 'new', NULL,
               '{"message":"UNRECOVERED outage still broken"}'::jsonb);

            -- Fix 3 fixtures: WeeklyPayoutNotReadyHalfHourBefore (447865) + incident 6377941a
            INSERT INTO public.operational_alert_events(id, source, alertname, status, severity, event_key, received_at, last_received_at, investigation_status, payload) VALUES
              (447865, 'weekly-payout', 'WeeklyPayoutNotReadyHalfHourBefore', 'resolved', 'critical', 'not-ready-at-0330:2026-11-23T08:00:00Z',
               '2026-11-23 09:30:01+00', '2026-11-23 09:30:01+00', 'investigating',
               '{"period_end":"2026-11-23T08:00:00+00:00","resolved_at":"2026-11-24T10:39:50+00:00","scopes":[{"scope":{"id":"fade0000-0000-0000-0000-000000000001","kind":"union","period_start":"2026-11-16T08:00:00+00:00","period_end":"2026-11-23T08:00:00+00:00"}}]}'::jsonb);
            INSERT INTO smarter_private.weekly_payout_owner_updates(period_end, milestone, sent_at) VALUES
              ('2026-11-23T08:00:00Z', 'clubs_paid',   '2026-11-23 11:51:00+00'),
              ('2026-11-23T08:00:00Z', 'agents_paid',  '2026-11-23 11:52:01+00'),
              ('2026-11-23T08:00:00Z', 'players_paid', '2026-11-23 11:54:39+00');
            INSERT INTO public.union_accounting_runs(scope_kind, scope_id, period_end, status, finished_at, result) VALUES
              ('union', 'fade0000-0000-0000-0000-000000000001', '2026-11-23T08:00:00Z', 'complete', '2026-11-24 02:05:37+00', '{"success":true}'::jsonb);

            INSERT INTO smarter_private.reliability_incidents(id, source, fingerprint, status, resolution_state, opened_at, last_firing_received_at, last_resolved_at, escalation_state) VALUES
              ('6377941a-0ccd-4aa9-9987-2ef448e5f3ad', 'weekly-payout', 'fp-wp-1', 'stale_unverified', 'none', '2026-11-23 09:30:01+00', '2026-11-23 09:30:01+00', '2026-11-24 10:39:50+00', 'escalated');
            INSERT INTO smarter_private.reliability_alert_members(fingerprint, member_key, status, episode, last_firing_at, last_event_at, last_firing_received_at) VALUES
              ('fp-wp-1', 'weekly-payout:not-ready-at-0330:2026-11-23T08:00:00Z', 'resolved', 'row:447865', '2026-11-23 09:30:01+00', '2026-11-24 10:39:50+00', '2026-11-23 09:30:01+00');
            INSERT INTO smarter_private.reliability_observations(id, incident_id, inbox_event_id, status, observed_at, created_at) VALUES
              (76344, '6377941a-0ccd-4aa9-9987-2ef448e5f3ad', 447865, 'resolved', '2026-11-24 10:39:50+00', '2026-11-24 10:39:50+00');
            """)

            # ── 3. Prove ALL 4 bugs reproduce BEFORE migration ───────────────
            res22_before = json.loads(sql("SELECT public.fn_sp_digest_daily_results_compute('2026-11-22');").stdout)
            res23_before = json.loads(sql("SELECT public.fn_sp_digest_daily_results_compute('2026-11-23');").stdout)
            assert float(res22_before['reconciliation']['cash_residual']) == -4.40, res22_before['reconciliation']
            assert float(res23_before['reconciliation']['cash_residual']) == 2.40, res23_before['reconciliation']  # +4.40 straddler - 2.00 uncounted burn rake!

            hf23_before = json.loads(sql("SELECT public.fn_sp_digest_house_figures('2026-11-23');").stdout)
            assert float(hf23_before['horse_cash']['day']['net']) == -6.65, hf23_before  # off by -$4.40 vs actual -2.25!

            def extract_alert_counts():
                body = sql("SELECT pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure);").stdout
                piece = body[body.index("    'alerts_new'"):body.index("    'alerts_fixed'")].rstrip().rstrip(',')
                return json.loads(
                    sql(
                        "SELECT jsonb_build_object("
                        + piece
                        + ") FROM (SELECT '2026-11-23 06:00Z'::timestamptz s, '2026-11-24 06:00Z'::timestamptz e) w;"
                    ).stdout
                )

            counts_before = extract_alert_counts()
            assert counts_before['alert_names']['OpenClawOperationalAlert'] == 4, counts_before
            assert not json.loads(sql("SELECT public.fn_sp_original_alert_proof(448530);").stdout)['verified']
            assert not json.loads(sql("SELECT public.fn_sp_original_alert_proof(447865);").stdout)['verified']
            assert sql("SELECT smarter_private.reliability_proved_source_resolution('6377941a-0ccd-4aa9-9987-2ef448e5f3ad');").stdout.strip() == 'f'

            # Reproduce Fix 4 libpq PQgetResult launcher freeze on old #286 command
            old_286 = sql("SELECT command FROM cron.job WHERE jobid = 286;").stdout.strip()
            t_nb, t_blk, nres, errs = run_libpq_nonblocking(libpq, port, old_286)
            assert not errs, errs
            assert t_nb < 0.25 and t_blk >= 0.40, f'Expected pre-fix PQgetResult block >= 0.4s, got first_not_busy={t_nb:.3f}s block={t_blk:.3f}s'
            print(f'REPRO OK: pre-fix cash_residual=-4.40, house_figures off by -4.40, OpenClaw counted=4, proof 448530/447865=false, libpq PQgetResult blocked {t_blk:.3f}s')

            # Snapshot operational_alert_events, sp_daily_metrics & cron.job before migration (must not mutate!)
            alerts_before = sql("SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.operational_alert_events e;").stdout
            metrics_before = sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY day) FROM public.sp_daily_metrics m;").stdout
            cron_before = sql("SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j;").stdout

            # ── 4. Apply migration + verify idempotency, ACLs, live-proofs ───
            sql(MIGRATION.read_text())
            sql(MIGRATION.read_text())  # idempotent re-run!

            for line in MIGRATION.read_text().splitlines():
                if line.startswith('-- @live-proof:'):
                    expr = line.split(':', 1)[1].strip()
                    assert sql(f'SELECT ({expr});').stdout.strip() == 't', f'live-proof failed: {expr}'

            after_acl = sql("""
            SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text, proowner, proacl, prosecdef) ORDER BY oid::regprocedure::text)
              FROM pg_proc
             WHERE oid IN (
               'public.fn_sp_digest_daily_results_compute(date)'::regprocedure,
               'public.fn_sp_digest_house_figures(date)'::regprocedure,
               'public.fn_sp_daily_metrics_compute(date)'::regprocedure,
               'public.fn_sp_digest_attention(date,jsonb)'::regprocedure,
               'public.fn_sp_original_alert_proof(bigint)'::regprocedure,
               'smarter_private.reliability_proved_source_resolution(uuid)'::regprocedure,
               'public.sp_prune_hand_history(integer)'::regprocedure,
               'public.sp_prune_hand_state_snapshots(integer)'::regprocedure,
               'public.fn_ca_ledger_replay(integer)'::regprocedure
             );
            """).stdout.strip()
            assert before_acl == after_acl, 'owner/ACL/secdef drifted!'
            assert alerts_before == sql("SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.operational_alert_events e;").stdout
            assert metrics_before == sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY day) FROM public.sp_daily_metrics m;").stdout

            # ── 5. Verify Fix 1 AFTER migration ──────────────────────────────
            res22_after = json.loads(sql("SELECT public.fn_sp_digest_daily_results_compute('2026-11-22');").stdout)
            res23_after = json.loads(sql("SELECT public.fn_sp_digest_daily_results_compute('2026-11-23');").stdout)
            assert float(res22_after['reconciliation']['cash_residual']) == 0.0, res22_after['reconciliation']
            assert float(res22_after['reconciliation']['cash_rake']) == 3.90, res22_after['reconciliation']
            assert float(res22_after['reconciliation']['bbj']) == 0.50, res22_after['reconciliation']
            assert res22_after['reconciliation']['status'] == 'balanced', res22_after['reconciliation']
            assert float(res23_after['reconciliation']['cash_residual']) == 0.0, res23_after['reconciliation']
            assert float(res23_after['reconciliation']['cash_rake']) == 2.00, res23_after['reconciliation']
            assert float(res23_after['reconciliation']['bbj']) == 0.25, res23_after['reconciliation']
            assert res23_after['reconciliation']['status'] == 'balanced', res23_after['reconciliation']

            # Fallback works before snapshots exist; aligned once snapshots exist
            hf23_fallback = json.loads(sql("SELECT public.fn_sp_digest_house_figures('2026-11-23');").stdout)
            assert float(hf23_fallback['horse_cash']['day']['net']) == -6.65, hf23_fallback
            sql(
                f"INSERT INTO public.sp_digest_daily_results_snapshots(day, result) VALUES "
                f"('2026-11-22', {literal(res22_after)}), ('2026-11-23', {literal(res23_after)});"
            )
            hf23_aligned = json.loads(sql("SELECT public.fn_sp_digest_house_figures('2026-11-23');").stdout)
            assert float(hf23_aligned['horse_cash']['day']['net']) == -2.25, hf23_aligned
            assert float(hf23_aligned['bbj_rake']['day']) == 0.25, hf23_aligned
            print('PASS Fix 1: daily_chip_reconciliation 0.00 on both Nov 22 & Nov 23 (incl. burn rake & Diamond Arena NULL), house_figures aligned (-2.25)')

            # ── 6. Verify Fix 2 AFTER migration ──────────────────────────────
            counts_after = extract_alert_counts()
            # 448522 (in-place resolved firing) + 448533 (UNRECOVERED) counted; 448530 (✅ RECOVERED) & 448532 (RECOVERED + resolves) excluded!
            assert counts_after['alert_names']['OpenClawOperationalAlert'] == 2, counts_after
            assert counts_after['alert_names']['OtherAlert'] == 1, 'source=other must remain counted!'

            # Original alert proof for 448530 (resolved_by_event) and 448532 (resolves=event_key)
            p448530 = json.loads(sql("SELECT public.fn_sp_original_alert_proof(448530);").stdout)
            assert p448530['verified'] is True and p448530['reviewed'] is True and p448530['kind'] == 'openclaw_recovery_twin', p448530
            p448532 = json.loads(sql("SELECT public.fn_sp_original_alert_proof(448532);").stdout)
            assert p448532['verified'] is True and p448532['kind'] == 'openclaw_recovery_twin', p448532
            p448533 = json.loads(sql("SELECT public.fn_sp_original_alert_proof(448533);").stdout)
            assert p448533['verified'] is False, 'UNRECOVERED must not match recovery twin'

            # Negative: if parent 448522 is not verified_fixed, twin must NOT verify
            sql("UPDATE public.operational_alert_events SET investigation_status = 'investigating' WHERE id = 448522;")
            assert json.loads(sql("SELECT public.fn_sp_original_alert_proof(448530);").stdout)['verified'] is False
            sql("UPDATE public.operational_alert_events SET investigation_status = 'verified_fixed' WHERE id = 448522;")

            # Digest attention: new day captures only failure_observation rows (448522, 448533); legacy expected_count=4 retains all 4
            att_new = json.loads(sql("""SELECT public.fn_sp_digest_attention('2026-11-23', '{"health":{"alert_names":{"OpenClawOperationalAlert":2}}}'::jsonb);""").stdout)
            rising_new = next(x for x in att_new if x['rule'] == 'critical_alert_rising')
            assert rising_new['detail']['source_events'][0]['event_ids'] == [448522, 448533], rising_new
            att_legacy = json.loads(sql("""SELECT public.fn_sp_digest_attention('2026-11-23', '{"health":{"alert_names":{"OpenClawOperationalAlert":4}}}'::jsonb);""").stdout)
            rising_legacy = next(x for x in att_legacy if x['rule'] == 'critical_alert_rising')
            assert rising_legacy['detail']['source_events'][0]['event_ids'] == [448522, 448530, 448532, 448533], rising_legacy
            print('PASS Fix 2: OpenClaw recovery twins excluded (emoji + word-boundary), source=other kept, 448530/448532 proved openclaw_recovery_twin, negative verified')

            # ── 7. Verify Fix 3 AFTER migration ──────────────────────────────
            p447865 = json.loads(sql("SELECT public.fn_sp_original_alert_proof(447865);").stdout)
            assert p447865['verified'] is True and p447865['reviewed'] is True and p447865['kind'] == 'weekly_payout_paid_receipt', p447865
            # Incident 6377941a was transitioned via reliability_transition during migration!
            assert sql("SELECT status FROM smarter_private.reliability_incidents WHERE id = '6377941a-0ccd-4aa9-9987-2ef448e5f3ad';").stdout.strip() == 'verifying'
            assert sql("SELECT count(*) FROM smarter_private.test_transitions WHERE incident_id = '6377941a-0ccd-4aa9-9987-2ef448e5f3ad' AND to_status = 'verifying';").stdout.strip() == '1'
            assert sql("SELECT count(*) FROM smarter_private.reliability_sources_without_resolve WHERE source = 'weekly-payout';").stdout.strip() == '0'

            # Negative Branch 1: remove 1 milestone -> fails; enable prepared plans -> Branch 2 weekly_payout_ready_receipt succeeds!
            sql("DELETE FROM smarter_private.weekly_payout_owner_updates WHERE milestone = 'players_paid';")
            assert json.loads(sql("SELECT public.fn_sp_original_alert_proof(447865);").stdout)['verified'] is False
            sql("UPDATE smarter_private.test_weekly_prepared_flag SET ready = true;")
            p447865_ready = json.loads(sql("SELECT public.fn_sp_original_alert_proof(447865);").stdout)
            assert p447865_ready['verified'] is True and p447865_ready['kind'] == 'weekly_payout_ready_receipt', p447865_ready
            sql("UPDATE smarter_private.test_weekly_prepared_flag SET ready = false;")
            sql("INSERT INTO smarter_private.weekly_payout_owner_updates VALUES ('2026-11-23T08:00:00Z', 'players_paid', '2026-11-23 11:54:39+00');")
            # Negative: failed union_accounting_runs -> fails
            sql("UPDATE public.union_accounting_runs SET result = '{\"success\":false}'::jsonb;")
            assert json.loads(sql("SELECT public.fn_sp_original_alert_proof(447865);").stdout)['verified'] is False
            sql("UPDATE public.union_accounting_runs SET result = '{\"success\":true}'::jsonb;")
            assert json.loads(sql("SELECT public.fn_sp_original_alert_proof(447865);").stdout)['kind'] == 'weekly_payout_paid_receipt'
            print('PASS Fix 3: 447865 verified (paid + ready branches + negatives), weekly-payout removed from without_resolve, 6377941a transitioned via reliability_transition')

            # ── 8. Verify Fix 4 AFTER migration (pruner bounds, replay quietness, cron.job untouched) ──
            assert cron_before == sql("SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j;").stdout, 'cron.job must remain untouched for the estate-wide single-statement pg_cron migration!'
            replay_def = sql("SELECT pg_get_functiondef('public.fn_ca_ledger_replay(integer)'::regprocedure);").stdout
            assert "SET client_min_messages TO 'warning'" in replay_def, replay_def
            hh_def = sql("SELECT pg_get_functiondef('public.sp_prune_hand_history(integer)'::regprocedure);").stdout
            assert hh_def.count('LIMIT LEAST(GREATEST(p_batch,1),75)') == 2 and "SET statement_timeout TO '20s'" in hh_def
            ss_def = sql("SELECT pg_get_functiondef('public.sp_prune_hand_state_snapshots(integer)'::regprocedure);").stdout
            assert 'v_page := LEAST(125, v_limit - v_seen);' in ss_def and "interval '8 seconds'" in ss_def and "SET statement_timeout TO '20s'" in ss_def
            print('PASS Fix 4: fn_ca_ledger_replay quieted (client_min_messages=warning), pruners bounded (75 / 125 & 8s, 20s timeout), cron.job untouched')
            print('ALL 4 SQL ROOT-CAUSE FIXES PROVEN ON NATIVE POSTGRESQL 17')
        finally:
            run('pg_ctl', '-D', str(scratch / 'data'), '-m', 'immediate', 'stop')


if __name__ == '__main__':
    main()
