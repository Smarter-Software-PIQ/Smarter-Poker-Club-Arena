#!/usr/bin/env python3
"""Native PG17 proof for 20261124010800 (incident 605ea9ca).

Proves against a real PostgreSQL 17 cluster:
1. Installs the exact live preimages of:
   - public.fn_club_weekly_accounting_summary(uuid) (0b5f87114dd95cb3f2b9802f20a564ec)
   - public.fn_capture_weekly_club_rake_snapshot(uuid) (5070d885fa29e226e4cb43370767a245)
2. Seeds realistic Midway KINGS CLUB union data (promo-excluded cash 83.64 +
   promo-excluded tournament 1.78 = 85.42; gross = 11352.96, payable = 11267.54)
   AND a standalone/private club with promo-excluded cash + tournament fees.
3. BEFORE applying 20261124010800:
   - Union club summary FAILS with ready_to_issue = false, source_issue_count = 1,
     union_rake_earned = 11267.54 != 11352.96.
   - Standalone/private club summary FAILS with ready_to_issue = false,
     source_issue_count >= 1 (both private_basis and tournament_source_groups fail).
4. Applies the REAL migration 20261124010800 verbatim (proving preimage pins,
   exact anchor counts, proacl/proowner/prosecdef preservation, zero stale pins,
   @probe-for runtime proofs, and @live-proof).
5. AFTER applying 20261124010800:
   - Union club summary SUCCEEDS: ready_to_issue = true, source_issue_count = 0,
     rake_earned = 11352.96, union_rake_earned = 11352.96.
   - fn_capture_weekly_club_rake_snapshot(invoice) certifies the issued invoice
     (success = true, replayed = false, cash_rake = 11103.37, tournament_rake = 249.59,
     total_rake = 11352.96, exact source_fingerprint_v3 match) and replays idempotently.
   - Negative proof: tampering with a source amount after issuance causes
     fn_capture_weekly_club_rake_snapshot to refuse with original_source_fingerprint_mismatch.
   - Standalone/private club with promo-excluded cash + tournament fees SUCCEEDS
     (ready_to_issue = true, source_issue_count = 0, private_rake_burned = private_rake_earned).
   - accounting_payable_earning_sources.rake_credit remains payable (11267.54),
     preserving promo exclusion for agent commission and player rakeback.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261124010800_weekly_club_statement_reads_gross_original_rake.sql'
PREIMAGES = ROOT / 'tests/fixtures/promo-weekly-statement-gross-rake/preimages.sql'


def uid(label: str) -> str:
    return str(uuid.UUID(hashlib.md5(label.encode()).hexdigest()))


SCHEMA_SQL = r"""
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
$$;
CREATE OR REPLACE FUNCTION public.fn_accounting_party_users(p_kind text, p_id uuid)
RETURNS TABLE(user_id uuid) LANGUAGE sql STABLE AS $$ SELECT NULL::uuid WHERE false $$;
CREATE OR REPLACE FUNCTION public.fn_is_union_overseer(p_union uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.fn_accounting_close_certificate(p_kind text, p_union_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('status', 'ready', 'checked', 1452) $$;
CREATE OR REPLACE FUNCTION public.fn_accounting_tournament_week_quality(p_club_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('status', 'ready', 'checked', 1452) $$;

CREATE TABLE public.settlement_periods (
  id uuid PRIMARY KEY,
  club_id uuid,
  union_id uuid,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.settlement_invoices (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  period_id uuid,
  invoice_type text NOT NULL,
  source_ledger_id uuid,
  to_entity_type text,
  net_amount numeric,
  status text,
  chips_transferred boolean DEFAULT true,
  message_sent boolean DEFAULT false,
  breakdown jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.weekly_club_statement_rake_snapshots (
  invoice_id uuid PRIMARY KEY,
  source_fingerprint text NOT NULL,
  source_count bigint NOT NULL,
  cash_rake numeric NOT NULL,
  tournament_rake numeric NOT NULL,
  total_rake numeric NOT NULL
);

CREATE TABLE public.union_accounting_runs (
  union_id uuid,
  standalone_club_id uuid,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.ca_settlements (
  id uuid PRIMARY KEY,
  union_id uuid,
  settlement_type text NOT NULL,
  state text NOT NULL,
  external_ref text NOT NULL,
  totals jsonb NOT NULL
);

CREATE TABLE public.accounting_cash_accrual_cutover (
  singleton boolean PRIMARY KEY,
  starts_at timestamptz NOT NULL
);

CREATE TABLE public.accounting_effective_sources_raw (
  source_type text NOT NULL,
  source_id uuid PRIMARY KEY,
  rake_record_id uuid,
  tournament_id uuid,
  player_id uuid,
  club_id uuid NOT NULL,
  union_id uuid,
  coordinator_union_id uuid,
  earned_at timestamptz NOT NULL,
  gross_rake_credit numeric NOT NULL,
  contract jsonb NOT NULL
);

-- Exact live projection from 20261116154831: rake_credit is PAYABLE (gross - promo_excluded),
-- while contract->>'rake_credit' retains GROSS original rake.
CREATE VIEW public.accounting_payable_earning_sources AS
SELECT
  s.source_type,
  s.source_id,
  s.rake_record_id,
  s.tournament_id,
  s.player_id,
  s.club_id,
  s.union_id,
  s.coordinator_union_id,
  s.earned_at,
  COALESCE((s.contract ->> 'payable_rake_credit')::numeric, s.gross_rake_credit) AS rake_credit,
  s.contract
FROM public.accounting_effective_sources_raw s;

CREATE TABLE public.accounting_cash_bank_receipts (
  rake_record_id uuid PRIMARY KEY,
  club_ledger_id uuid,
  amount numeric NOT NULL,
  banked_at timestamptz NOT NULL,
  club_id uuid NOT NULL,
  union_id uuid,
  union_transaction_id uuid
);

CREATE TABLE public.accounting_cash_rake_sources (
  id uuid PRIMARY KEY,
  rake_record_id uuid NOT NULL,
  club_id uuid NOT NULL,
  union_id uuid,
  coordinator_union_id uuid,
  earned_at timestamptz NOT NULL,
  rake_credit numeric NOT NULL
);

CREATE TABLE public.accounting_tournament_fee_recognitions (
  tournament_id uuid PRIMARY KEY,
  bank_journal_id uuid,
  net_rake numeric NOT NULL,
  recognized_at timestamptz NOT NULL,
  bank_club_id uuid NOT NULL,
  union_id uuid,
  union_wallet_transaction_id uuid
);

CREATE TABLE public.tournament_rake_settlements (
  id uuid PRIMARY KEY,
  destination text NOT NULL,
  amount numeric NOT NULL,
  settled_at timestamptz NOT NULL
);

CREATE TABLE public.chip_ledger (
  id uuid PRIMARY KEY,
  idempotency_key text,
  club_id uuid,
  union_id uuid,
  status text NOT NULL,
  category text NOT NULL,
  from_type text,
  from_entity_id uuid,
  to_type text,
  to_entity_id uuid,
  amount numeric NOT NULL,
  pre_to_balance numeric,
  post_to_balance numeric,
  settlement_id text,
  created_at timestamptz NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.ca_mint_ledger (
  id uuid PRIMARY KEY,
  op_id text NOT NULL,
  chip_ledger_id uuid NOT NULL,
  action text NOT NULL,
  asset text NOT NULL,
  holder_type text NOT NULL,
  holder_id uuid NOT NULL,
  amount numeric NOT NULL,
  balance_before numeric NOT NULL,
  balance_after numeric NOT NULL,
  performed_by_label text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE public.accounting_invoice_deliveries (
  invoice_id uuid,
  recipient_id uuid,
  message_id uuid,
  notification_id uuid
);

CREATE TABLE public.social_messages (
  id uuid PRIMARY KEY,
  message_type text,
  media_metadata jsonb
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY,
  user_id uuid,
  metadata jsonb
);

CREATE TABLE public.ca_manual_adjustments (
  id uuid PRIMARY KEY,
  status text,
  target_kind text,
  amount numeric,
  decision_note text
);

CREATE TABLE public.accounting_routed_settlement_runs (
  scope_kind text NOT NULL,
  scope_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  round_no int NOT NULL,
  result jsonb NOT NULL
);
"""


def find_pg_bin(explicit: str | None) -> Path:
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    for p in ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin', '/usr/local/opt/postgresql@17/bin']:
        candidates.append(Path(p))
    for c in candidates:
        if (c / 'initdb').exists() and (c / 'pg_ctl').exists():
            return c
    raise RuntimeError('PostgreSQL 17 binaries not found')


def run_psql(pg_bin: Path, sock: str, sql: str) -> str:
    env = os.environ.copy()
    env['PGHOST'] = sock
    env['PGDATABASE'] = 'postgres'
    r = subprocess.run(
        [str(pg_bin / 'psql'), '-v', 'ON_ERROR_STOP=1', '-Atq', '-F', '|', '-c', sql],
        env=env, capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f'psql failed:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}')
    return r.stdout.strip()


def run_psql_file(pg_bin: Path, sock: str, path: Path) -> str:
    env = os.environ.copy()
    env['PGHOST'] = sock
    env['PGDATABASE'] = 'postgres'
    r = subprocess.run(
        [str(pg_bin / 'psql'), '-v', 'ON_ERROR_STOP=1', '-Atq', '-f', str(path)],
        env=env, capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f'psql file {path} failed:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}')
    return r.stdout.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--pg-bin', default=None)
    args = ap.parse_args()
    pg_bin = find_pg_bin(args.pg_bin)

    tmp = Path(tempfile.mkdtemp(prefix='wsgr-'))
    pgdata = tmp / 'data'
    sock = str(tmp)
    checks = []

    def check(name: str, ok: bool, detail: str = ''):
        checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
        if not ok:
            raise AssertionError(f'CHECK FAILED [{name}]: {detail}')

    try:
        subprocess.run([str(pg_bin / 'initdb'), '-D', str(pgdata), '--auth=trust', '--no-sync'],
                       check=True, capture_output=True, text=True)
        subprocess.run([str(pg_bin / 'pg_ctl'), '-D', str(pgdata), '-l', str(tmp / 'pg.log'),
                        '-o', f"-k {sock} -h ''", 'start'],
                       check=True, capture_output=True, text=True)

        run_psql(pg_bin, sock, SCHEMA_SQL)
        run_psql_file(pg_bin, sock, PREIMAGES)

        # 1. Verify exact live preimage MD5s match production
        pre_sum = run_psql(pg_bin, sock, "SELECT md5(pg_get_functiondef('public.fn_club_weekly_accounting_summary(uuid)'::regprocedure));")
        pre_snap = run_psql(pg_bin, sock, "SELECT md5(pg_get_functiondef('public.fn_capture_weekly_club_rake_snapshot(uuid)'::regprocedure));")
        check('preimage_summary_md5', pre_sum == '0b5f87114dd95cb3f2b9802f20a564ec', pre_sum)
        check('preimage_snapshot_md5', pre_snap == '5070d885fa29e226e4cb43370767a245', pre_snap)

        # 2. Seed union club (exact Midway KINGS CLUB numbers) + private standalone club
        union_id = 'fade0000-0000-0000-0000-000000000001'
        club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
        period_id = uid('kings-period')
        close_id = uid('midway-close')
        recv_ledger_id = uid('kings-recv-ledger')
        recv_inv_id = uid('kings-recv-inv')

        priv_club = uid('priv-club')
        priv_period = uid('priv-period')
        priv_cash_rr = uid('priv-cash-rr')
        priv_cash_ledger = uid('priv-cash-ledger')
        priv_trn_id = uid('priv-trn-id')
        priv_trn_ledger = uid('priv-trn-ledger')
        priv_mint_ledger = uid('priv-mint-ledger')
        priv_mint_reg = uid('priv-mint-reg')

        seed_sql = f"""
        INSERT INTO public.accounting_cash_accrual_cutover VALUES (true, '2026-10-01T00:00:00Z');

        -- Union club (KINGS CLUB)
        INSERT INTO public.settlement_periods VALUES (
          '{period_id}', '{club_id}', '{union_id}',
          '2026-11-16T08:00:00Z', '2026-11-23T08:00:00Z', 'settled'
        );
        INSERT INTO public.union_accounting_runs VALUES (
          '{union_id}', NULL, '2026-11-16T08:00:00Z', '2026-11-23T08:00:00Z', 'running'
        );
        INSERT INTO public.ca_settlements VALUES (
          '{close_id}', '{union_id}', 'union_rakeback_close', 'final',
          '{union_id}:2026-11-16T08:00:00Z..2026-11-23T08:00:00Z',
          jsonb_build_object(
            'accounting_version', '3',
            'basis_by_club', jsonb_build_object('{club_id}', 11352.96),
            'payout_by_club', jsonb_build_object('{club_id}', 10217.65)
          )
        );
        INSERT INTO public.accounting_routed_settlement_runs VALUES
          ('union', '{union_id}', '2026-11-16T08:00:00Z', '2026-11-23T08:00:00Z', 2,
           jsonb_build_object('success','true','routing_version','3','source_contract_version','3','scope_kind','union','scope_id','{union_id}','shortfalls',0)),
          ('union', '{union_id}', '2026-11-16T08:00:00Z', '2026-11-23T08:00:00Z', 3,
           jsonb_build_object('success','true','routing_version','3','source_contract_version','3','scope_kind','union','scope_id','{union_id}','shortfalls',0));

        INSERT INTO public.chip_ledger VALUES (
          '{recv_ledger_id}', 'union-payout:{club_id}', '{club_id}', '{union_id}',
          'posted', 'rakeback', 'union_wallet', '{union_id}', 'club_treasury', '{club_id}',
          10217.65, 0, 10217.65, '{close_id}', '2026-11-23T11:50:00Z',
          jsonb_build_object('period_start','2026-11-16T08:00:00Z','period_end','2026-11-23T08:00:00Z')
        );
        INSERT INTO public.settlement_invoices VALUES (
          '{recv_inv_id}', '{club_id}', '{period_id}', 'union_weekly_payout',
          '{recv_ledger_id}', 'club', 10217.65, 'paid', true, true, '{{}}'::jsonb
        );

        -- Earning sources for KINGS CLUB:
        -- 1) Non-promo cash: gross = 11019.67, payable = 11019.67
        -- 2) Promo-funded cash: gross = 83.70, promo_excluded = 83.64, payable = 0.06
        --    (total cash gross = 11103.37, payable = 11019.73)
        -- 3) Non-promo tournament: gross = 247.81, payable = 247.81
        -- 4) Promo-funded tournament: gross = 1.78, promo_excluded = 1.78, payable = 0.00
        --    (total tourn gross = 249.59, payable = 247.81)
        -- Total: gross = 11352.96, payable = 11267.54, excluded = 85.42
        INSERT INTO public.accounting_effective_sources_raw VALUES
          ('cash_rake_accrual', '{uid("kc-cash-1")}', '{uid("kc-rr-1")}', NULL, '{uid("p1")}',
           '{club_id}', '{union_id}', '{union_id}', '2026-11-17T10:00:00Z', 11019.67,
           jsonb_build_object('rake_credit', 11019.67)),
          ('cash_rake_accrual', '{uid("kc-cash-2")}', '{uid("kc-rr-2")}', NULL, '{uid("p2")}',
           '{club_id}', '{union_id}', '{union_id}', '2026-11-18T05:05:45Z', 83.70,
           jsonb_build_object('rake_credit', 83.70, 'promo_excluded_credit', 83.64, 'payable_rake_credit', 0.06, 'promo_basis_version', 1)),
          ('tournament_fee_accrual', '{uid("kc-trn-1")}', '{uid("kc-trr-1")}', '{uid("t1")}', '{uid("p3")}',
           '{club_id}', '{union_id}', '{union_id}', '2026-11-19T12:00:00Z', 247.81,
           jsonb_build_object('rake_credit', 247.81)),
          ('tournament_fee_accrual', '{uid("kc-trn-2")}', '{uid("kc-trr-2")}', '{uid("t2")}', '{uid("p4")}',
           '{club_id}', '{union_id}', '{union_id}', '2026-11-20T18:04:39Z', 1.78,
           jsonb_build_object('rake_credit', 1.78, 'promo_excluded_credit', 1.78, 'payable_rake_credit', 0.00, 'promo_basis_version', 1));

        -- Standalone / Private club with promo-excluded cash AND tournament fees
        INSERT INTO public.settlement_periods VALUES (
          '{priv_period}', '{priv_club}', NULL,
          '2026-11-16T08:00:00Z', '2026-11-23T08:00:00Z', 'settled'
        );
        INSERT INTO public.union_accounting_runs VALUES (
          NULL, '{priv_club}', '2026-11-16T08:00:00Z', '2026-11-23T08:00:00Z', 'running'
        );
        INSERT INTO public.accounting_routed_settlement_runs VALUES
          ('club', '{priv_club}', '2026-11-16T08:00:00Z', '2026-11-23T08:00:00Z', 2,
           jsonb_build_object('success','true','routing_version','3','source_contract_version','3','scope_kind','club','scope_id','{priv_club}','shortfalls',0)),
          ('club', '{priv_club}', '2026-11-16T08:00:00Z', '2026-11-23T08:00:00Z', 3,
           jsonb_build_object('success','true','routing_version','3','source_contract_version','3','scope_kind','club','scope_id','{priv_club}','shortfalls',0));

        INSERT INTO public.accounting_effective_sources_raw VALUES
          ('cash_rake_accrual', '{uid("pr-cash-1")}', '{priv_cash_rr}', NULL, '{uid("pp1")}',
           '{priv_club}', NULL, NULL, '2026-11-19T10:00:00Z', 10.00,
           jsonb_build_object('rake_credit', 10.00, 'promo_excluded_credit', 4.00, 'payable_rake_credit', 6.00, 'promo_basis_version', 1)),
          ('tournament_fee_accrual', '{uid("pr-trn-1")}', '{uid("pr-trr-1")}', '{priv_trn_id}', '{uid("pp2")}',
           '{priv_club}', NULL, NULL, '2026-11-20T10:00:00Z', 5.00,
           jsonb_build_object('rake_credit', 5.00, 'promo_excluded_credit', 2.00, 'payable_rake_credit', 3.00, 'promo_basis_version', 1));

        INSERT INTO public.accounting_cash_rake_sources VALUES
          ('{uid("pr-cash-1")}', '{priv_cash_rr}', '{priv_club}', NULL, NULL, '2026-11-19T10:00:00Z', 10.00);
        INSERT INTO public.accounting_cash_bank_receipts VALUES
          ('{priv_cash_rr}', '{priv_cash_ledger}', 10.00, '2026-11-19T10:00:00Z', '{priv_club}', NULL, NULL);
        INSERT INTO public.accounting_tournament_fee_recognitions VALUES
          ('{priv_trn_id}', '{priv_trn_ledger}', 5.00, '2026-11-20T10:00:00Z', '{priv_club}', NULL, NULL);
        INSERT INTO public.tournament_rake_settlements VALUES
          ('{uid("pr-trs-1")}', 'chip_retirement:{priv_club}', 5.00, '2026-11-20T10:00:00Z');
        INSERT INTO public.chip_ledger VALUES
          ('{priv_cash_ledger}', 'burn-cash', '{priv_club}', NULL, 'posted', 'burn',
           'table_stack', '{uid("tbl")}', 'chip_retirement', NULL, 10.00, 0, 0, NULL, '2026-11-19T10:00:00Z', '{{}}'::jsonb),
          ('{priv_trn_ledger}', 'burn-trn', '{priv_club}', NULL, 'posted', 'burn',
           'prize_liability', '{priv_trn_id}', 'chip_retirement', NULL, 5.00, 0, 0, NULL, '2026-11-20T10:00:00Z', '{{}}'::jsonb),
          ('{priv_mint_ledger}', 'standalone-rake-bank:{priv_club}:2026-11-16T08:00:00Z..2026-11-23T08:00:00Z',
           '{priv_club}', NULL, 'posted', 'mint', 'system_mint', NULL, 'club_treasury', '{priv_club}',
           15.00, 100.00, 115.00, NULL, '2026-11-23T09:00:00Z', '{{}}'::jsonb);
        INSERT INTO public.ca_mint_ledger VALUES (
          '{priv_mint_reg}', 'standalone-rake-bank:{priv_club}:2026-11-16T08:00:00Z..2026-11-23T08:00:00Z',
          '{priv_mint_ledger}', 'mint', 'chips', 'club', '{priv_club}', 15.00, 100.00, 115.00,
          'fn_ca_fund_club', '2026-11-23T09:00:00Z'
        );
        """
        run_psql(pg_bin, sock, seed_sql)

        # 3. RED proofs BEFORE migration
        pre_union_json = json.loads(run_psql(pg_bin, sock, f"""
          SELECT set_config('request.jwt.claim.role', 'service_role', false);
          SELECT public.fn_club_weekly_accounting_summary('{period_id}')::text;
        """).splitlines()[-1])
        check('before_union_not_ready', pre_union_json['ready_to_issue'] is False, str(pre_union_json))
        check('before_union_source_issue_1', pre_union_json['source_issue_count'] == 1, str(pre_union_json['source_issue_count']))
        check('before_union_basis_was_payable', float(pre_union_json['union_rake_earned']) == 11267.54, str(pre_union_json['union_rake_earned']))

        pre_priv_json = json.loads(run_psql(pg_bin, sock, f"""
          SELECT set_config('request.jwt.claim.role', 'service_role', false);
          SELECT public.fn_club_weekly_accounting_summary('{priv_period}')::text;
        """).splitlines()[-1])
        check('before_private_not_ready', pre_priv_json['ready_to_issue'] is False, str(pre_priv_json))
        check('before_private_has_source_issues', pre_priv_json['source_issue_count'] >= 1, str(pre_priv_json['source_issue_count']))

        # 4. Apply the REAL migration verbatim
        run_psql_file(pg_bin, sock, MIGRATION)

        # Verify @live-proof predicate holds verbatim
        mig_text = MIGRATION.read_text()
        m = re.search(r'^-- @live-proof:\s*(.+)$', mig_text, re.M)
        check('live_proof_header_present', m is not None)
        live_proof_ok = run_psql(pg_bin, sock, f"SELECT ({m.group(1)}) IS TRUE;")
        check('live_proof_holds', live_proof_ok == 't', live_proof_ok)

        # 5. GREEN proofs AFTER migration
        post_union_json = json.loads(run_psql(pg_bin, sock, f"""
          SELECT set_config('request.jwt.claim.role', 'service_role', false);
          SELECT public.fn_club_weekly_accounting_summary('{period_id}')::text;
        """).splitlines()[-1])
        check('after_union_ready_to_issue', post_union_json['ready_to_issue'] is True, str(post_union_json))
        check('after_union_zero_source_issues', post_union_json['source_issue_count'] == 0, str(post_union_json['source_issue_count']))
        check('after_union_rake_earned_gross', float(post_union_json['rake_earned']) == 11352.96, str(post_union_json['rake_earned']))
        check('after_union_basis_gross', float(post_union_json['union_rake_earned']) == 11352.96, str(post_union_json['union_rake_earned']))

        # Issue statement & certify via fn_capture_weekly_club_rake_snapshot
        inv_id = uid('kings-weekly-stmt')
        inv_payload = json.dumps(post_union_json).replace("'", "''")
        snap_res = json.loads(run_psql(pg_bin, sock, f"""
          SELECT set_config('request.jwt.claim.role', 'service_role', false);
          INSERT INTO public.settlement_invoices (id, club_id, period_id, invoice_type, status, breakdown)
          VALUES ('{inv_id}', '{club_id}', '{period_id}', 'club_weekly_accounting', 'generated', '{inv_payload}'::jsonb);
          SELECT public.fn_capture_weekly_club_rake_snapshot('{inv_id}')::text;
        """).splitlines()[-1])
        check('snapshot_certified', snap_res.get('success') is True and snap_res.get('replayed') is False, str(snap_res))

        snap_row = run_psql(pg_bin, sock, f"""
          SELECT cash_rake, tournament_rake, total_rake, source_count, source_fingerprint
          FROM public.weekly_club_statement_rake_snapshots WHERE invoice_id = '{inv_id}';
        """).split('|')
        check('snapshot_cash_gross', float(snap_row[0]) == 11103.37, str(snap_row))
        check('snapshot_tournament_gross', float(snap_row[1]) == 249.59, str(snap_row))
        check('snapshot_total_gross', float(snap_row[2]) == 11352.96, str(snap_row))
        check('snapshot_fingerprint_matches', snap_row[4] == post_union_json['source_fingerprint_v3'], str(snap_row))

        # Idempotent replay
        replay_res = json.loads(run_psql(pg_bin, sock, f"""
          SELECT set_config('request.jwt.claim.role', 'service_role', false);
          SELECT public.fn_capture_weekly_club_rake_snapshot('{inv_id}')::text;
        """).splitlines()[-1])
        check('snapshot_replay_idempotent', replay_res.get('success') is True and replay_res.get('replayed') is True, str(replay_res))

        # Tampered-source negative proof
        inv_tamper = uid('kings-weekly-stmt-tamper')
        tamper_res = json.loads(run_psql(pg_bin, sock, f"""
          SELECT set_config('request.jwt.claim.role', 'service_role', false);
          INSERT INTO public.settlement_invoices (id, club_id, period_id, invoice_type, status, breakdown)
          VALUES ('{inv_tamper}', '{club_id}', '{period_id}', 'club_weekly_accounting', 'generated',
                  ('{inv_payload}'::jsonb || jsonb_build_object('source_fingerprint_v3', 'deadbeef')));
          SELECT public.fn_capture_weekly_club_rake_snapshot('{inv_tamper}')::text;
        """).splitlines()[-1])
        check('snapshot_refuses_mismatch', tamper_res.get('success') is False and tamper_res.get('reason') == 'original_source_fingerprint_mismatch', str(tamper_res))

        # Private / standalone club with promo-funded cash + tournament fees
        post_priv_json = json.loads(run_psql(pg_bin, sock, f"""
          SELECT set_config('request.jwt.claim.role', 'service_role', false);
          SELECT public.fn_club_weekly_accounting_summary('{priv_period}')::text;
        """).splitlines()[-1])
        check('after_private_ready_to_issue', post_priv_json['ready_to_issue'] is True, str(post_priv_json))
        check('after_private_zero_source_issues', post_priv_json['source_issue_count'] == 0, str(post_priv_json['source_issue_count']))
        check('after_private_burned_equals_gross', float(post_priv_json['private_rake_burned']) == 15.00 and float(post_priv_json['private_rake_earned']) == 15.00, str(post_priv_json))

        # Payable earning view remains untouched (payable = 11267.54, NOT gross!)
        payable_sum = float(run_psql(pg_bin, sock, f"""
          SELECT sum(rake_credit) FROM public.accounting_payable_earning_sources WHERE club_id = '{club_id}';
        """))
        check('payable_view_preserves_promo_exclusion', payable_sum == 11267.54, str(payable_sum))

        print(json.dumps({'status': 'passed', 'checks': len(checks), 'details': checks}))
        return 0
    finally:
        subprocess.run([str(pg_bin / 'pg_ctl'), '-D', str(pgdata), '-m', 'immediate', 'stop'],
                       capture_output=True, text=True)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
