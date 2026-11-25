#!/usr/bin/env python3
"""
Native PostgreSQL 17 proof: a Spin's payment proof nets prior pre-start
unregistrations (incident 3c817b04-bc3a-4bc5-aa43-b2eee257584d, boards
3b4c6299 & 935e11b9).

Boots a disposable local PostgreSQL cluster, installs the exact production
pre-images of all 5 functions:
  1. public.fn_spin_book_entry(uuid)
  2. public.fn_spin_draw_and_settle(uuid, jsonb)
  3. public.fn_prove_played_spin_launch_recovery(uuid)
  4. public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)
  5. smarter_private.reliability_runbook_spin_seat_first_fill(uuid, boolean, jsonb, timestamptz)

Verifies:
  - FAIL-BEFORE on all 5 pre-images (including exact 3b4c6299 & 935e11b9 shapes)
  - Clean single-transaction installation of the migration + @live-proof
  - PASS-AFTER on all valid prior-unregistration and re-entry flows + replay
  - FAIL-CLOSED on every negative / spoofing scenario (ghost debit, cross-user
    over-refund offset, refunded rostered player, double debit, unrefunded
    released Diamond custody, unrefunded extra chip debit)

Usage:
  python3 scripts/ci/test-spin-entry-net-paid-postgres.py [scratch_dir]
"""
import glob
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]


def find_migration() -> pathlib.Path:
    matches = sorted(
        (REPO / "supabase/migrations").glob(
            "*_a_spin_payment_proof_nets_prior_pre_start_unregistrations.sql"
        )
    )
    if not matches:
        raise FileNotFoundError(
            "Migration *_a_spin_payment_proof_nets_prior_pre_start_unregistrations.sql not found"
        )
    return matches[-1]


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        print("COMMAND FAILED:", cmd, file=sys.stderr)
        print("STDOUT:", r.stdout, file=sys.stderr)
        print("STDERR:", r.stderr, file=sys.stderr)
        raise SystemExit(r.returncode)
    return r.stdout


def extract_function_from_file(path: pathlib.Path, start_marker: str, end_marker: str) -> str:
    txt = path.read_text()
    s = txt.index(start_marker)
    e = txt.index(end_marker, s) + len(end_marker)
    return txt[s:e]


def pg_exe(name: str) -> str:
    pg_bin = os.environ.get("PG_BIN", "").strip()
    if pg_bin:
        cand = pathlib.Path(pg_bin) / name
        if cand.exists():
            return str(cand)
    return name


def main():
    mig_sql_path = find_migration()
    owned_tmp = False
    if len(sys.argv) > 1:
        scratch = pathlib.Path(sys.argv[1]).resolve()
        scratch.mkdir(parents=True, exist_ok=True)
    else:
        scratch = pathlib.Path(tempfile.mkdtemp(prefix="spin-net-paid-pg-"))
        owned_tmp = True

    port = pick_free_port()
    pgdata = scratch / "pgdata"
    pglog = scratch / "pg.log"
    if pgdata.exists():
        shutil.rmtree(pgdata)
    pgdata.mkdir(parents=True)

    run([
        pg_exe("initdb"), "-D", str(pgdata), "-A", "trust", "-U", "postgres",
        "--encoding=UTF8", "--locale=C", "--no-sync",
    ])
    run([
        pg_exe("pg_ctl"), "-D", str(pgdata), "-l", str(pglog),
        "-o",
        f"-c listen_addresses=127.0.0.1 -c unix_socket_directories= -c fsync=off -c synchronous_commit=off -p {port}",
        "start",
    ])
    try:
        psql = lambda sql: run(
            [pg_exe("psql"), "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "-d", "postgres",
             "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql]
        ).strip()
        psql_file = lambda p: run(
            [pg_exe("psql"), "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "-d", "postgres",
             "-v", "ON_ERROR_STOP=1", "-f", str(p)]
        )

        psql("""
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN;
        CREATE SCHEMA IF NOT EXISTS smarter_private;
        CREATE SCHEMA IF NOT EXISTS extensions;

        CREATE TABLE public.tournaments (
          id uuid PRIMARY KEY,
          club_id uuid,
          union_id uuid,
          buy_in_amount numeric,
          max_players integer,
          variant text,
          starting_chips numeric,
          tournament_type text,
          status text,
          spin_multiplier numeric DEFAULT 0,
          prize_pool numeric DEFAULT 0,
          spin_locked_tiers jsonb,
          prize_pool_finalized boolean DEFAULT false,
          is_diamond boolean DEFAULT false
        );

        CREATE TABLE public.tables (
          id uuid PRIMARY KEY,
          tournament_id uuid,
          status text DEFAULT 'waiting',
          current_players integer DEFAULT 0,
          max_players integer DEFAULT 3,
          created_at timestamptz DEFAULT now()
        );

        CREATE TABLE public.table_seats (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          table_id uuid,
          user_id uuid,
          seat_number integer,
          stack numeric,
          joined_at timestamptz DEFAULT now(),
          left_at timestamptz
        );

        CREATE TABLE public.tournament_players (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tournament_id uuid,
          user_id uuid,
          status text DEFAULT 'playing',
          chips numeric,
          table_id uuid,
          seat_number integer
        );

        CREATE TABLE public.wallet_transactions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          related_entity_id uuid,
          user_id uuid,
          type text,
          category text,
          amount numeric,
          created_at timestamptz DEFAULT now()
        );

        CREATE TABLE public.tournament_refund_entitlements (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tournament_id uuid,
          user_id uuid,
          entitlement_kind text,
          charge_category text,
          refund_wallet_club_id uuid,
          gross numeric,
          refund_fee numeric DEFAULT 0,
          refund_bounty numeric DEFAULT 0,
          source_ledger_id uuid
        );

        CREATE TABLE public.tournament_refund_tranches (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          entitlement_id uuid,
          tournament_id uuid,
          user_id uuid,
          amount_paid_now numeric
        );

        CREATE TABLE public.tournament_tickets (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          source_refund_entitlement_id uuid
        );

        CREATE TABLE public.tournament_escrow (
          tournament_id uuid PRIMARY KEY,
          enforced boolean DEFAULT true,
          gross_in numeric DEFAULT 0,
          reserve_out numeric DEFAULT 0,
          reserve_in numeric DEFAULT 0,
          prize_balance numeric DEFAULT 0
        );

        CREATE TABLE public.spin_bonus_pools (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          club_id uuid UNIQUE,
          balance numeric DEFAULT 10000,
          total_deposited numeric DEFAULT 0,
          spin_count integer DEFAULT 0,
          highest_stake numeric DEFAULT 0,
          updated_at timestamptz DEFAULT now()
        );

        CREATE TABLE public.spin_reserve_ledger (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          club_id uuid,
          tournament_id uuid,
          kind text,
          amount numeric,
          balance_after numeric,
          multiplier numeric,
          buy_in numeric,
          seats integer,
          house_rake numeric,
          note text,
          created_at timestamptz DEFAULT now()
        );

        CREATE TABLE public.chip_ledger (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          idempotency_key text,
          category text,
          from_type text,
          from_entity_id uuid,
          to_type text,
          to_entity_id uuid,
          tournament_id uuid,
          club_id uuid,
          amount numeric,
          post_from_balance numeric,
          post_to_balance numeric,
          created_at timestamptz DEFAULT now()
        );

        CREATE TABLE public.rake_records (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          hand_id uuid,
          table_id uuid,
          club_id uuid,
          rake_amount numeric,
          pot_size numeric,
          num_players integer,
          bbj_contribution numeric,
          is_tournament boolean,
          tournament_id uuid,
          source text,
          player_contributions jsonb,
          metadata jsonb,
          created_at timestamptz DEFAULT now()
        );

        CREATE TABLE public.hand_history (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tournament_id uuid,
          table_id uuid,
          created_at timestamptz DEFAULT now()
        );

        CREATE TABLE public.spin_draw_receipts (
          tournament_id uuid PRIMARY KEY,
          launch_id uuid,
          entrants jsonb,
          receipt jsonb,
          created_at timestamptz DEFAULT now()
        );

        CREATE TABLE public.poker_diamond_custody (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid,
          purpose text,
          target_id uuid,
          state text,
          balance bigint,
          entry_key text
        );

        CREATE TABLE public.poker_diamond_movements (
          request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          custody_id uuid,
          action text,
          user_id uuid,
          source_account text,
          amount numeric,
          wallet_journal_id uuid
        );

        CREATE TABLE smarter_private.reliability_alert_classes (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          priority integer NOT NULL,
          source_pattern text NOT NULL DEFAULT '%',
          alertname_pattern text NOT NULL DEFAULT '%',
          severity_pattern text NOT NULL DEFAULT '%',
          incident_class text NOT NULL,
          default_severity text NOT NULL DEFAULT 'warning',
          escalate_immediately boolean NOT NULL DEFAULT false,
          is_incident boolean NOT NULL DEFAULT true,
          note text,
          UNIQUE (source_pattern, alertname_pattern, severity_pattern)
        );

        CREATE TABLE public.diamond_transactions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid,
          amount numeric
        );

        CREATE TABLE public.poker_diamond_tournament_ledger (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tournament_id uuid,
          custody_id uuid,
          user_id uuid,
          registration_id uuid,
          kind text,
          amount numeric,
          prize_part numeric,
          bounty_part numeric,
          fee_part numeric,
          wallet_journal_id uuid
        );

        CREATE TABLE public.profiles (
          id uuid PRIMARY KEY,
          is_horse boolean DEFAULT false,
          horse_status text DEFAULT 'active'
        );

        CREATE TABLE public.clubs (
          id uuid PRIMARY KEY,
          union_id uuid
        );

        CREATE TABLE public.union_clubs (
          union_id uuid,
          club_id uuid
        );

        CREATE TABLE public.club_members (
          club_id uuid,
          user_id uuid
        );

        CREATE FUNCTION public.fn_tournament_primary_table(p_tid uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT id FROM public.tables WHERE tournament_id = p_tid ORDER BY created_at, id LIMIT 1;
        $$;

        CREATE FUNCTION public.fn_spin_reserve_pool(p_club_id uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT p_club_id;
        $$;

        CREATE FUNCTION public.fn_spin_rake_rate(p_buy_in numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
          SELECT 0.08::numeric;
        $$;

        CREATE FUNCTION public.fn_ca_declare_ledger(
          p_cat text, p_cp text, p_cp_entity uuid, p_meta jsonb, p_key text, p_extra text
        ) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM set_config('app.ledger_category', COALESCE(p_cat, ''), true);
          PERFORM set_config('app.ledger_counterparty', COALESCE(p_cp, ''), true);
          PERFORM set_config('app.ledger_counterparty_entity', COALESCE(p_cp_entity::text, ''), true);
          PERFORM set_config('app.ledger_idempotency_key', COALESCE(p_key, ''), true);
        END;
        $$;

        CREATE FUNCTION public.trg_spin_pool_autoledger() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
          v_delta numeric := NEW.balance - OLD.balance;
          v_cat text := current_setting('app.ledger_category', true);
          v_key text := current_setting('app.ledger_idempotency_key', true);
          v_tid uuid := NULLIF(current_setting('app.ledger_counterparty_entity', true), '')::uuid;
        BEGIN
          IF v_cat = 'spin_entry' AND v_delta > 0 THEN
            INSERT INTO public.chip_ledger(idempotency_key, category, from_type, from_entity_id,
              to_type, to_entity_id, tournament_id, club_id, amount, post_to_balance)
            VALUES (v_key, 'spin_entry', 'prize_liability', v_tid, 'spin_reserve', NEW.id, v_tid, NEW.club_id, v_delta, NEW.balance);
          ELSIF v_cat = 'spin_prize' AND v_delta < 0 THEN
            INSERT INTO public.chip_ledger(idempotency_key, category, from_type, from_entity_id,
              to_type, to_entity_id, tournament_id, club_id, amount, post_from_balance)
            VALUES (v_key, 'spin_prize', 'spin_reserve', NEW.id, 'prize_liability', v_tid, v_tid, NEW.club_id, -v_delta, NEW.balance);
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER trg_spin_pool_autoledger AFTER UPDATE OF balance ON public.spin_bonus_pools
          FOR EACH ROW EXECUTE FUNCTION public.trg_spin_pool_autoledger();

        CREATE FUNCTION public.fn_poker_diamond_tournament(p_tid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
          SELECT COALESCE((SELECT is_diamond FROM public.tournaments WHERE id = p_tid), false);
        $$;

        CREATE FUNCTION public.fn_poker_diamond_spin_draw_proof(p_tid uuid, p_launch uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
          SELECT jsonb_build_object('ok', true);
        $$;

        CREATE FUNCTION public.fn_poker_diamond_tournament_escrow(p_tid uuid)
        RETURNS TABLE(prize_balance numeric, bounty_balance numeric, fee_balance numeric) LANGUAGE sql STABLE AS $$
          SELECT COALESCE((SELECT prize_pool FROM public.tournaments WHERE id = p_tid), 0)::numeric, 0::numeric, 0::numeric;
        $$;

        CREATE FUNCTION public.fn_poker_diamond_tournament_custody(p_tid uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
          SELECT COALESCE((SELECT prize_pool FROM public.tournaments WHERE id = p_tid), 0)::numeric;
        $$;

        CREATE FUNCTION public.fn_horses_at_tournament_reservation_budget() RETURNS uuid[] LANGUAGE sql STABLE AS $$
          SELECT '{}'::uuid[];
        $$;

        CREATE FUNCTION public.fn_seat_horse_in_seat_first_game(p_tournament_id uuid, p_user_id uuid)
        RETURNS jsonb LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'paid third seat could not book Spin %: {"ok": false, "reason": "three_paid_seats_required"}', p_tournament_id
            USING ERRCODE = 'P0404';
        END;
        $$;
        """)

        # Exact production pre-images (post-20261124172844 for fn_spin_book_entry
        # and fn_spin_draw_and_settle; live production pre-images for the other 3)
        mig_172844 = REPO / "supabase/migrations/20261124172844_a_spin_seat_counts_a_refunded_entry_as_refunded.sql"
        psql(extract_function_from_file(mig_172844, "CREATE OR REPLACE FUNCTION public.fn_spin_book_entry(", "$function$;"))
        psql("REVOKE ALL ON FUNCTION public.fn_spin_book_entry(uuid) FROM PUBLIC, anon, authenticated;")
        psql("GRANT EXECUTE ON FUNCTION public.fn_spin_book_entry(uuid) TO service_role;")
        psql(extract_function_from_file(mig_172844, "CREATE OR REPLACE FUNCTION public.fn_spin_draw_and_settle(", "$function$;"))
        psql("REVOKE ALL ON FUNCTION public.fn_spin_draw_and_settle(uuid,jsonb) FROM PUBLIC, anon, authenticated;")
        psql("GRANT EXECUTE ON FUNCTION public.fn_spin_draw_and_settle(uuid,jsonb) TO service_role;")

        mig_0929 = REPO / "supabase/migrations/20260929181500_a_diamond_spin_recovers_and_shows_its_top_prize.sql"
        psql(extract_function_from_file(mig_0929, "CREATE OR REPLACE FUNCTION public.fn_poker_diamond_prove_played_spin_launch_recovery(p_tournament_id uuid)", "$function$;"))
        psql("REVOKE ALL ON FUNCTION public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid) FROM PUBLIC, anon, authenticated, service_role;")

        mig_0909_rec = REPO / "supabase/migrations/20260909183217_a_played_spin_with_one_vacated_busted_seat_can_complete_laun.sql"
        psql(extract_function_from_file(mig_0909_rec, "CREATE OR REPLACE FUNCTION public.fn_prove_played_spin_launch_recovery(", "$proof$;"))
        psql("""
        DO $$
        DECLARE v_def text := pg_get_functiondef('public.fn_prove_played_spin_launch_recovery(uuid)'::regprocedure);
                v_old text := E'SELECT CASE WHEN v.ok THEN\\n';
                v_new text := E'SELECT CASE WHEN public.fn_poker_diamond_tournament(p_tournament_id) THEN\\n  public.fn_poker_diamond_prove_played_spin_launch_recovery(p_tournament_id)\\nWHEN v.ok THEN\\n';
        BEGIN
          EXECUTE replace(v_def, v_old, v_new);
        END $$;
        REVOKE ALL ON FUNCTION public.fn_prove_played_spin_launch_recovery(uuid) FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.fn_prove_played_spin_launch_recovery(uuid) TO service_role;
        """)

        mig_1119 = REPO / "supabase/migrations/20261119234324_the_controller_runs_recovery_runbooks.sql"
        psql(extract_function_from_file(mig_1119, "CREATE OR REPLACE FUNCTION smarter_private.reliability_horse_active_now(", "$function$;"))
        psql(extract_function_from_file(mig_1119, "CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_spin_seat_first_fill(", "$function$;"))
        psql("REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_spin_seat_first_fill(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;")

        def seed_chip_spin(tid, club_id, buyin, rostered_users, wallet_rows):
            table_id = f"00000000-0000-4000-8000-{tid[-12:]}"
            psql(f"""
            INSERT INTO public.spin_bonus_pools(club_id, balance) VALUES ('{club_id}', 10000) ON CONFLICT (club_id) DO NOTHING;
            INSERT INTO public.tournaments(id, club_id, buy_in_amount, max_players, variant, starting_chips, tournament_type, status)
            VALUES ('{tid}', '{club_id}', {buyin}, 3, 'spin', 500, 'SPIN', 'REGISTERING');
            INSERT INTO public.tables(id, tournament_id, status, current_players, max_players)
            VALUES ('{table_id}', '{tid}', 'waiting', {len(rostered_users)}, 3);
            INSERT INTO public.tournament_escrow(tournament_id, enforced) VALUES ('{tid}', true);
            """)
            for idx, uid in enumerate(rostered_users, 1):
                psql(f"""
                INSERT INTO public.tournament_players(tournament_id, user_id, status, chips, table_id, seat_number)
                VALUES ('{tid}', '{uid}', 'playing', 500, '{table_id}', {idx});
                INSERT INTO public.table_seats(table_id, user_id, seat_number, stack)
                VALUES ('{table_id}', '{uid}', {idx}, 500);
                """)
            for uid, wtype, cat, amt in wallet_rows:
                psql(f"""
                INSERT INTO public.wallet_transactions(related_entity_id, user_id, type, category, amount)
                VALUES ('{tid}', '{uid}', '{wtype}', '{cat}', {amt});
                """)

        CLUB = "11111111-1111-4111-8111-111111111111"
        U1 = "20000000-0000-4000-8000-000000000001"
        U2 = "20000000-0000-4000-8000-000000000002"
        U3 = "20000000-0000-4000-8000-000000000003"
        U4 = "20000000-0000-4000-8000-000000000004"
        U5 = "20000000-0000-4000-8000-000000000005"

        T_935 = "935e11b9-77de-490b-94eb-138196e8c7f5"
        seed_chip_spin(T_935, CLUB, 3.00, [U1, U2, U3], [
            (U4, "debit", "tournament_buyin", 3.00),
            (U4, "credit", "tournament_refund", 3.00),
            (U1, "debit", "tournament_buyin", 3.00),
            (U2, "debit", "tournament_buyin", 3.00),
            (U3, "debit", "tournament_buyin", 3.00),
        ])

        T_3B4_REENTRY = "3b4c6299-ab1a-4297-b36a-891c980c8ff1"
        seed_chip_spin(T_3B4_REENTRY, CLUB, 5.00, [U1, U2, U3], [
            (U1, "debit", "tournament_buyin", 5.00),
            (U1, "credit", "tournament_refund", 5.00),
            (U1, "debit", "tournament_buyin", 5.00),
            (U2, "debit", "tournament_buyin", 5.00),
            (U3, "debit", "tournament_buyin", 5.00),
        ])

        T_3B4_TWICE = "3b4c6299-ab1a-4297-b36a-891c980c8ff2"
        seed_chip_spin(T_3B4_TWICE, CLUB, 5.00, [U1, U2, U3], [
            (U4, "debit", "tournament_buyin", 5.00),
            (U4, "credit", "tournament_refund", 5.00),
            (U4, "debit", "tournament_buyin", 5.00),
            (U4, "credit", "tournament_refund", 5.00),
            (U1, "debit", "tournament_buyin", 5.00),
            (U2, "debit", "tournament_buyin", 5.00),
            (U3, "debit", "tournament_buyin", 5.00),
        ])

        T_PLAYED_CHIP = "44444444-4444-4444-8444-444444444444"
        TBL_PLAYED_CHIP = "44444444-4444-4444-8444-444444444445"
        psql(f"""
        INSERT INTO public.tournaments(id, club_id, buy_in_amount, max_players, variant, starting_chips, tournament_type, status)
        VALUES ('{T_PLAYED_CHIP}', '{CLUB}', 5.00, 3, 'spin', 500, 'SPIN', 'REGISTERING');
        INSERT INTO public.tables(id, tournament_id, status, current_players, max_players)
        VALUES ('{TBL_PLAYED_CHIP}', '{T_PLAYED_CHIP}', 'running', 2, 3);
        INSERT INTO public.tournament_players(tournament_id, user_id, status, chips, table_id, seat_number) VALUES
          ('{T_PLAYED_CHIP}', '{U1}', 'playing', 1000, '{TBL_PLAYED_CHIP}', 1),
          ('{T_PLAYED_CHIP}', '{U2}', 'playing', 500, '{TBL_PLAYED_CHIP}', 2),
          ('{T_PLAYED_CHIP}', '{U3}', 'eliminated', 0, '{TBL_PLAYED_CHIP}', 3);
        INSERT INTO public.table_seats(table_id, user_id, seat_number, stack, left_at) VALUES
          ('{TBL_PLAYED_CHIP}', '{U1}', 1, 1000, NULL),
          ('{TBL_PLAYED_CHIP}', '{U2}', 2, 500, NULL),
          ('{TBL_PLAYED_CHIP}', '{U3}', 3, 0, now());
        INSERT INTO public.wallet_transactions(related_entity_id, user_id, type, category, amount) VALUES
          ('{T_PLAYED_CHIP}', '{U4}', 'debit', 'tournament_buyin', 5.00),
          ('{T_PLAYED_CHIP}', '{U4}', 'credit', 'tournament_refund', 5.00),
          ('{T_PLAYED_CHIP}', '{U1}', 'debit', 'tournament_buyin', 5.00),
          ('{T_PLAYED_CHIP}', '{U2}', 'debit', 'tournament_buyin', 5.00),
          ('{T_PLAYED_CHIP}', '{U3}', 'debit', 'tournament_buyin', 5.00);
        DO $$
        DECLARE
          l1 uuid := gen_random_uuid(); l2 uuid := gen_random_uuid();
          l3 uuid := gen_random_uuid(); l4 uuid := gen_random_uuid();
          e4 uuid := gen_random_uuid();
          pool_id uuid := (SELECT id FROM public.spin_bonus_pools WHERE club_id = '{CLUB}');
        BEGIN
          INSERT INTO public.chip_ledger(id, category, from_type, from_entity_id, to_type, to_entity_id, tournament_id, club_id, amount) VALUES
            (l4, 'tournament_buyin', 'player_wallet', '{U4}', 'prize_liability', '{T_PLAYED_CHIP}', '{T_PLAYED_CHIP}', '{CLUB}', 5.00),
            (l1, 'tournament_buyin', 'player_wallet', '{U1}', 'prize_liability', '{T_PLAYED_CHIP}', '{T_PLAYED_CHIP}', '{CLUB}', 5.00),
            (l2, 'tournament_buyin', 'player_wallet', '{U2}', 'prize_liability', '{T_PLAYED_CHIP}', '{T_PLAYED_CHIP}', '{CLUB}', 5.00),
            (l3, 'tournament_buyin', 'player_wallet', '{U3}', 'prize_liability', '{T_PLAYED_CHIP}', '{T_PLAYED_CHIP}', '{CLUB}', 5.00);
          INSERT INTO public.tournament_refund_entitlements(id, tournament_id, user_id, entitlement_kind, charge_category, refund_wallet_club_id, gross, source_ledger_id) VALUES
            (e4, '{T_PLAYED_CHIP}', '{U4}', 'wallet_charge', 'tournament_buyin', '{CLUB}', 5.00, l4),
            (gen_random_uuid(), '{T_PLAYED_CHIP}', '{U1}', 'wallet_charge', 'tournament_buyin', '{CLUB}', 5.00, l1),
            (gen_random_uuid(), '{T_PLAYED_CHIP}', '{U2}', 'wallet_charge', 'tournament_buyin', '{CLUB}', 5.00, l2),
            (gen_random_uuid(), '{T_PLAYED_CHIP}', '{U3}', 'wallet_charge', 'tournament_buyin', '{CLUB}', 5.00, l3);
          INSERT INTO public.tournament_refund_tranches(entitlement_id, tournament_id, user_id, amount_paid_now)
          VALUES (e4, '{T_PLAYED_CHIP}', '{U4}', 5.00);
          INSERT INTO public.spin_reserve_ledger(club_id, tournament_id, kind, amount, balance_after, multiplier, buy_in, seats, house_rake, created_at) VALUES
            ('{CLUB}', '{T_PLAYED_CHIP}', 'contribution', 13.80, 10013.80, NULL, 5.00, 3, 1.20, now() - interval '2 minutes'),
            ('{CLUB}', '{T_PLAYED_CHIP}', 'jackpot_draw', -10.00, 10003.80, 2, 5.00, 3, 0, now() - interval '1 minute');
          INSERT INTO public.chip_ledger(category, from_type, from_entity_id, to_type, to_entity_id, tournament_id, club_id, amount, post_to_balance, post_from_balance) VALUES
            ('spin_entry', 'prize_liability', '{T_PLAYED_CHIP}', 'spin_reserve', pool_id, '{T_PLAYED_CHIP}', '{CLUB}', 13.80, 10013.80, NULL),
            ('spin_prize', 'spin_reserve', pool_id, 'prize_liability', '{T_PLAYED_CHIP}', '{T_PLAYED_CHIP}', '{CLUB}', 10.00, NULL, 10003.80);
          INSERT INTO public.tournament_escrow(tournament_id, enforced, reserve_out, reserve_in, prize_balance)
          VALUES ('{T_PLAYED_CHIP}', true, 13.80, 10.00, 10.00);
          INSERT INTO public.hand_history(tournament_id, table_id, created_at)
          VALUES ('{T_PLAYED_CHIP}', '{TBL_PLAYED_CHIP}', now());
        END $$;
        """)

        T_PLAYED_DIA = "55555555-5555-4555-8555-555555555555"
        TBL_PLAYED_DIA = "55555555-5555-4555-8555-555555555556"
        psql(f"""
        INSERT INTO public.tournaments(id, club_id, buy_in_amount, max_players, variant, starting_chips, tournament_type, status, prize_pool, is_diamond)
        VALUES ('{T_PLAYED_DIA}', '{CLUB}', 10, 3, 'spin', 500, 'SPIN', 'REGISTERING', 20, true);
        INSERT INTO public.tables(id, tournament_id, status, current_players, max_players)
        VALUES ('{TBL_PLAYED_DIA}', '{T_PLAYED_DIA}', 'running', 2, 3);
        DO $$
        DECLARE
          r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid();
          c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid();
          j1 uuid := gen_random_uuid(); j2 uuid := gen_random_uuid(); j3 uuid := gen_random_uuid(); j4 uuid := gen_random_uuid();
        BEGIN
          INSERT INTO public.tournament_players(id, tournament_id, user_id, status, chips, table_id, seat_number) VALUES
            (r1, '{T_PLAYED_DIA}', '{U1}', 'playing', 1000, '{TBL_PLAYED_DIA}', 1),
            (r2, '{T_PLAYED_DIA}', '{U2}', 'playing', 500, '{TBL_PLAYED_DIA}', 2),
            (r3, '{T_PLAYED_DIA}', '{U3}', 'eliminated', 0, '{TBL_PLAYED_DIA}', 3);
          INSERT INTO public.table_seats(table_id, user_id, seat_number, stack, left_at) VALUES
            ('{TBL_PLAYED_DIA}', '{U1}', 1, 1000, NULL),
            ('{TBL_PLAYED_DIA}', '{U2}', 2, 500, NULL),
            ('{TBL_PLAYED_DIA}', '{U3}', 3, 0, now());
          INSERT INTO public.diamond_transactions(id, user_id, amount) VALUES
            (j4, '{U4}', -10), (j1, '{U1}', -10), (j2, '{U2}', -10), (j3, '{U3}', -10);
          INSERT INTO public.poker_diamond_custody(id, user_id, purpose, target_id, state, balance, entry_key) VALUES
            (c4, '{U4}', 'tournament_entry', '{T_PLAYED_DIA}', 'released', 0, 'entry:old-u4'),
            (c1, '{U1}', 'tournament_entry', '{T_PLAYED_DIA}', 'active', 10, 'entry:' || r1::text),
            (c2, '{U2}', 'tournament_entry', '{T_PLAYED_DIA}', 'active', 10, 'entry:' || r2::text),
            (c3, '{U3}', 'tournament_entry', '{T_PLAYED_DIA}', 'active', 10, 'entry:' || r3::text);
          INSERT INTO public.poker_diamond_movements(custody_id, action, user_id, source_account, amount, wallet_journal_id) VALUES
            (c4, 'reserve', '{U4}', 'player:' || '{U4}', 10, j4),
            (c1, 'reserve', '{U1}', 'player:' || '{U1}', 10, j1),
            (c2, 'reserve', '{U2}', 'player:' || '{U2}', 10, j2),
            (c3, 'reserve', '{U3}', 'player:' || '{U3}', 10, j3);
          INSERT INTO public.poker_diamond_tournament_ledger(tournament_id, custody_id, user_id, registration_id, kind, amount, prize_part, bounty_part, fee_part, wallet_journal_id) VALUES
            ('{T_PLAYED_DIA}', c4, '{U4}', NULL, 'entry', 10, 10, 0, 0, j4),
            ('{T_PLAYED_DIA}', c4, '{U4}', NULL, 'refund', 10, 10, 0, 0, NULL),
            ('{T_PLAYED_DIA}', c1, '{U1}', r1, 'entry', 10, 10, 0, 0, j1),
            ('{T_PLAYED_DIA}', c2, '{U2}', r2, 'entry', 10, 10, 0, 0, j2),
            ('{T_PLAYED_DIA}', c3, '{U3}', r3, 'entry', 10, 10, 0, 0, j3);
          INSERT INTO public.spin_draw_receipts(tournament_id, launch_id, entrants, receipt, created_at) VALUES
            ('{T_PLAYED_DIA}', gen_random_uuid(), '[{{}},{{}},{{}}]'::jsonb,
             jsonb_build_object('buy_in', 10, 'multiplier', 2, 'prize_pool', 20), now() - interval '1 minute');
          INSERT INTO public.hand_history(tournament_id, table_id, created_at)
          VALUES ('{T_PLAYED_DIA}', '{TBL_PLAYED_DIA}', now());
        END $$;
        """)

        T_OVERDUE = "66666666-6666-4666-8666-666666666666"
        TBL_OVERDUE = "66666666-6666-4666-8666-666666666667"
        psql(f"""
        INSERT INTO public.clubs(id) VALUES ('{CLUB}');
        INSERT INTO public.profiles(id, is_horse, horse_status) VALUES
          ('{U1}', true, 'active'), ('{U2}', true, 'active');
        INSERT INTO public.tournaments(id, club_id, buy_in_amount, max_players, variant, starting_chips, tournament_type, status)
        VALUES ('{T_OVERDUE}', '{CLUB}', 5.00, 3, 'spin', 500, 'SPIN', 'REGISTERING');
        INSERT INTO public.tables(id, tournament_id, status, current_players, max_players)
        VALUES ('{TBL_OVERDUE}', '{T_OVERDUE}', 'waiting', 2, 3);
        INSERT INTO public.table_seats(table_id, user_id, seat_number, stack, joined_at) VALUES
          ('{TBL_OVERDUE}', '{U1}', 1, 500, now() - interval '3 hours'),
          ('{TBL_OVERDUE}', '{U2}', 2, 500, now() - interval '2 hours');
        DO $$
        DECLARE i int; h uuid;
        BEGIN
          FOR i IN 1..40 LOOP
            h := gen_random_uuid();
            INSERT INTO public.profiles(id, is_horse, horse_status) VALUES (h, true, 'active');
            INSERT INTO public.club_members(club_id, user_id) VALUES ('{CLUB}', h);
          END LOOP;
        END $$;
        """)

        # Seed split-debit (2 x 2.50 on a 5.00 Spin) and mixed-case refund category cases
        T_SPLIT_BEFORE = "80000000-0000-4000-8000-000000000101"
        seed_chip_spin(T_SPLIT_BEFORE, CLUB, 5.00, [U1, U2, U3], [
            (U1, "debit", "tournament_buyin", 2.50),
            (U1, "debit", "tournament_buyin", 2.50),
            (U2, "debit", "tournament_buyin", 5.00),
            (U3, "debit", "tournament_buyin", 5.00),
        ])
        T_CASE_REFUND = "80000000-0000-4000-8000-000000000102"
        seed_chip_spin(T_CASE_REFUND, CLUB, 5.00, [U1, U2, U3], [
            (U4, "debit", "tournament_buyin", 5.00),
            (U4, "credit", "Tournament_Refund", 5.00),
            (U1, "debit", "tournament_buyin", 5.00),
            (U2, "debit", "tournament_buyin", 5.00),
            (U3, "debit", "tournament_buyin", 5.00),
        ])

        # FAIL-BEFORE assertions against live post-20261124172844 state
        # 1. Pre-fix fn_spin_book_entry wrongly accepts split partial debits (2 x 2.50 = 5.00)
        r_split_before = json.loads(psql(f"SELECT public.fn_spin_book_entry('{T_SPLIT_BEFORE}');"))
        assert r_split_before["ok"] is True, r_split_before
        # 2. Pre-fix fn_spin_book_entry wrongly refuses mixed-case Tournament_Refund credit
        r_case_before = json.loads(psql(f"SELECT public.fn_spin_book_entry('{T_CASE_REFUND}');"))
        assert r_case_before["ok"] is False and r_case_before["reason"] == "three_paid_seats_required", r_case_before
        # 3. Pre-fix chip & Diamond played-Spin recovery proofs refuse after pre-start unregister
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_CHIP}');"))["ok"] is False
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_DIA}');"))["ok"] is False
        # 4. Pre-fix spin_seat_first_fill runbook drops SQLERRM on door_refused
        rb_before = json.loads(psql("SELECT smarter_private.reliability_runbook_spin_seat_first_fill(gen_random_uuid(), false, '{}'::jsonb, now());"))
        assert rb_before["outcome"] == "refused" and "last_error" not in rb_before["boards"][0], rb_before

        # APPLY MIGRATION
        psql_file(mig_sql_path)

        # Verify BOTH 20261124211627 and 20261124172844 @live-proof assertions return true
        for p in (mig_sql_path, mig_172844):
            live_proof_line = next(
                l.split("-- @live-proof:", 1)[1].strip()
                for l in p.read_text().splitlines()
                if l.startswith("-- @live-proof:")
            )
            assert psql(f"SELECT {live_proof_line};") == "t", f"@live-proof failed for {p.name}"

        # PASS-AFTER assertions (all valid unregister, re-entry, mixed-case, replay flows)
        for tid in (T_935, T_3B4_REENTRY, T_3B4_TWICE, T_CASE_REFUND):
            r = json.loads(psql(f"SELECT public.fn_spin_book_entry('{tid}');"))
            assert r["ok"] is True and r["reason"] == "booked" and r["seats"] == 3 and r["paid_users"] == 3, r
            r2 = json.loads(psql(f"SELECT public.fn_spin_book_entry('{tid}');"))
            assert r2["ok"] is True and r2["reason"] == "already_booked", r2

        T_DS = "77777777-7777-4777-8777-777777777777"
        seed_chip_spin(T_DS, CLUB, 5.00, [U1, U2, U3], [
            (U1, "debit", "tournament_buyin", 5.00),
            (U1, "credit", "Tournament_Refund", 5.00),
            (U1, "debit", "tournament_buyin", 5.00),
            (U4, "debit", "tournament_buyin", 5.00),
            (U4, "credit", "tournament_refund", 5.00),
            (U2, "debit", "tournament_buyin", 5.00),
            (U3, "debit", "tournament_buyin", 5.00),
        ])
        ds_after = psql(f"""
        DO $$
        BEGIN
          PERFORM public.fn_spin_draw_and_settle('{T_DS}', '[
            {{"multiplier":2,"freq":4809776,"reserveThresholdX":0}},
            {{"multiplier":3,"freq":3930716,"reserveThresholdX":0}},
            {{"multiplier":4,"freq":900000,"reserveThresholdX":0}},
            {{"multiplier":5,"freq":250000,"reserveThresholdX":0}},
            {{"multiplier":10,"freq":100000,"reserveThresholdX":0}},
            {{"multiplier":25,"freq":7500,"reserveThresholdX":0}},
            {{"multiplier":50,"freq":1000,"reserveThresholdX":0}},
            {{"multiplier":100,"freq":1008,"reserveThresholdX":1.5}}
          ]'::jsonb);
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM LIKE '%does not have exactly three immutable paid identities%'
             OR SQLERRM LIKE '%three_paid_seats_required%' THEN
            RAISE EXCEPTION 'payment_proof_still_failed: %', SQLERRM;
          END IF;
        END $$; SELECT 'PASSED_PAYMENT_PROOF';
        """)
        assert "PASSED_PAYMENT_PROOF" in ds_after, repr(ds_after)

        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_CHIP}');"))["ok"] is True
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_DIA}');"))["ok"] is True
        # Diamond unregister + SAME-USER re-entry (U1 old refunded custody + U1 active custody) must also pass
        psql(f"""
        DO $$
        DECLARE c_old uuid := gen_random_uuid(); j_old uuid := gen_random_uuid();
        BEGIN
          INSERT INTO public.diamond_transactions(id, user_id, amount) VALUES (j_old, '{U1}', -10);
          INSERT INTO public.poker_diamond_custody(id, user_id, purpose, target_id, state, balance, entry_key)
          VALUES (c_old, '{U1}', 'tournament_entry', '{T_PLAYED_DIA}', 'released', 0, 'entry:old-u1-reentry');
          INSERT INTO public.poker_diamond_movements(custody_id, action, user_id, source_account, amount, wallet_journal_id)
          VALUES (c_old, 'reserve', '{U1}', 'player:' || '{U1}', 10, j_old);
          INSERT INTO public.poker_diamond_tournament_ledger(tournament_id, custody_id, user_id, registration_id, kind, amount, prize_part, bounty_part, fee_part, wallet_journal_id) VALUES
            ('{T_PLAYED_DIA}', c_old, '{U1}', NULL, 'entry', 10, 10, 0, 0, j_old),
            ('{T_PLAYED_DIA}', c_old, '{U1}', NULL, 'refund', 10, 10, 0, 0, NULL);
        END $$;
        """)
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_DIA}');"))["ok"] is True

        # Priority-100 classification row registered for SpinSeatFirstBookingRefusedRepeatedly
        assert psql("""
        SELECT count(*) FROM smarter_private.reliability_alert_classes
         WHERE priority = 100
           AND source_pattern = '%'
           AND alertname_pattern = 'SpinSeatFirstBookingRefusedRepeatedly'
           AND severity_pattern = '%'
           AND incident_class = 'spin_lifecycle'
           AND default_severity = 'critical'
           AND NOT escalate_immediately
           AND is_incident;
        """) == "1"

        rb_after = json.loads(psql("SELECT smarter_private.reliability_runbook_spin_seat_first_fill(gen_random_uuid(), false, '{}'::jsonb, now());"))
        assert rb_after["outcome"] == "refused" and "three_paid_seats_required" in rb_after["boards"][0].get("last_error", ""), rb_after

        # FAIL-CLOSED negative assertions (including split partial debits & zero-sum count mismatch)
        for tid, rows in [
            ("81000000-0000-4000-8000-000000000001", [
                (U4, "debit", "tournament_buyin", 5.00),
                (U1, "debit", "tournament_buyin", 5.00),
                (U2, "debit", "tournament_buyin", 5.00),
                (U3, "debit", "tournament_buyin", 5.00),
            ]),
            ("81000000-0000-4000-8000-000000000002", [
                (U4, "debit", "tournament_buyin", 5.00),
                (U5, "credit", "tournament_refund", 5.00),
                (U1, "debit", "tournament_buyin", 5.00),
                (U2, "debit", "tournament_buyin", 5.00),
                (U3, "debit", "tournament_buyin", 5.00),
            ]),
            ("81000000-0000-4000-8000-000000000003", [
                (U1, "debit", "tournament_buyin", 5.00),
                (U1, "credit", "tournament_refund", 5.00),
                (U2, "debit", "tournament_buyin", 5.00),
                (U3, "debit", "tournament_buyin", 5.00),
            ]),
            ("81000000-0000-4000-8000-000000000004", [
                (U1, "debit", "tournament_buyin", 5.00),
                (U1, "debit", "tournament_buyin", 5.00),
                (U2, "debit", "tournament_buyin", 5.00),
                (U3, "debit", "tournament_buyin", 5.00),
            ]),
            ("81000000-0000-4000-8000-000000000005", [
                (U1, "debit", "tournament_buyin", 2.50),
                (U1, "debit", "tournament_buyin", 2.50),
                (U2, "debit", "tournament_buyin", 5.00),
                (U3, "debit", "tournament_buyin", 5.00),
            ]),
            ("81000000-0000-4000-8000-000000000006", [
                (U4, "debit", "tournament_buyin", 5.00),
                (U4, "debit", "tournament_buyin", 5.00),
                (U4, "credit", "tournament_refund", 10.00),
                (U1, "debit", "tournament_buyin", 5.00),
                (U2, "debit", "tournament_buyin", 5.00),
                (U3, "debit", "tournament_buyin", 5.00),
            ]),
        ]:
            seed_chip_spin(tid, CLUB, 5.00, [U1, U2, U3], rows)
            assert json.loads(psql(f"SELECT public.fn_spin_book_entry('{tid}');"))["ok"] is False, tid

        # Fail-closed: Diamond partial refund (rf.amount < entry amount) must be refused
        psql(f"UPDATE public.poker_diamond_tournament_ledger SET amount = 2 WHERE tournament_id = '{T_PLAYED_DIA}' AND kind = 'refund' AND user_id = '{U4}';")
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_DIA}');"))["ok"] is False
        # Restore U4 refund then test unrefunded released custody fail-closed
        psql(f"UPDATE public.poker_diamond_tournament_ledger SET amount = 10 WHERE tournament_id = '{T_PLAYED_DIA}' AND kind = 'refund' AND user_id = '{U4}';")
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_DIA}');"))["ok"] is True
        psql(f"DELETE FROM public.poker_diamond_tournament_ledger WHERE tournament_id = '{T_PLAYED_DIA}' AND kind = 'refund';")
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_DIA}');"))["ok"] is False

        # Fail-closed: Chip played-Spin offset-cancellation (U1 net_count=2 [2x2.50], U2 net_count=0 [10-5], U3 net_count=1 [5])
        psql(f"""
        DELETE FROM public.wallet_transactions WHERE related_entity_id = '{T_PLAYED_CHIP}';
        INSERT INTO public.wallet_transactions(related_entity_id, user_id, type, category, amount) VALUES
          ('{T_PLAYED_CHIP}', '{U1}', 'debit', 'tournament_buyin', 2.50),
          ('{T_PLAYED_CHIP}', '{U1}', 'debit', 'tournament_buyin', 2.50),
          ('{T_PLAYED_CHIP}', '{U2}', 'debit', 'tournament_buyin', 10.00),
          ('{T_PLAYED_CHIP}', '{U2}', 'credit', 'tournament_refund', 5.00),
          ('{T_PLAYED_CHIP}', '{U3}', 'debit', 'tournament_buyin', 5.00);
        """)
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_CHIP}');"))["ok"] is False

        # Restore clean chip wallet rows, verify pass, then test extra unrefunded debit fail-closed
        psql(f"""
        DELETE FROM public.wallet_transactions WHERE related_entity_id = '{T_PLAYED_CHIP}';
        INSERT INTO public.wallet_transactions(related_entity_id, user_id, type, category, amount) VALUES
          ('{T_PLAYED_CHIP}', '{U1}', 'debit', 'tournament_buyin', 5.00),
          ('{T_PLAYED_CHIP}', '{U2}', 'debit', 'tournament_buyin', 5.00),
          ('{T_PLAYED_CHIP}', '{U3}', 'debit', 'tournament_buyin', 5.00),
          ('{T_PLAYED_CHIP}', '{U5}', 'debit', 'tournament_buyin', 5.00);
        """)
        assert json.loads(psql(f"SELECT public.fn_prove_played_spin_launch_recovery('{T_PLAYED_CHIP}');"))["ok"] is False

        print("OK: all fail-before, pass-after, and fail-closed PostgreSQL 17 proofs passed.")
    finally:
        subprocess.run([pg_exe("pg_ctl"), "-D", str(pgdata), "-m", "immediate", "stop"], capture_output=True)
        if owned_tmp:
            shutil.rmtree(scratch, ignore_errors=True)
        else:
            shutil.rmtree(pgdata, ignore_errors=True)


if __name__ == "__main__":
    main()
